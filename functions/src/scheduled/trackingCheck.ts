import { FinancialRecoveryBlocked } from "../utils/financialRecoveryInterlock";
import { financialRecoveryCommitCheckpoint } from "../utils/financialRecoverySources";
import { withFinancialRecoveryScope } from "../utils/financialRecoveryInterlock";
/**
 * Scheduled tracking check (safety-net poller)
 * Firebase Functions v2 - onSchedule, region northamerica-northeast1
 *
 * The PRIMARY tracking path is now the ShipEngine webhook (http/shipEngineWebhook.ts).
 * This poller is a SPACED-OUT safety net: it runs every 12 hours and reconciles
 * any parcel whose webhook was missed, by polling ShipEngine directly.
 *
 * For each SHIPPING transaction in `label_created`, `shipped`, `delivered` or `completed`:
 *   - DELIVERED  -> applyTrackingOutcome moves pendingBalance -> heldBalance and
 *                   stamps fundsReleaseAt = +7d (held-funds contract); status
 *                   becomes 'delivered' (release handled by releaseHeldFunds).
 *   - FAILURE    -> status 'delivery_failed', funds frozen, both parties notified
 *                   (refund resolved by the admin refund callable).
 *   - TRANSIT/IN_TRANSIT (first real carrier scan) -> label_created becomes
 *                   'shipped' (decouples label printing from actual shipment).
 *
 * It also nudges sellers whose label_created parcel has had NO carrier scan for
 * LABEL_STALE_DAYS (printed a label but never dropped it off).
 *
 * Pagination: bounded document-ID cycles include orders with unknown dates.
 * Versioned per-status cursors and token leases prevent overlapping scans and
 * keep persistent early parcels from starving later parcels or another status.
 * An unqualified business date is a private operator review, never a carrier call.
 */
import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as logger from 'firebase-functions/logger';
import { db, FieldValue } from '../config/firebase';
import { Timestamp } from 'firebase-admin/firestore';
import { createHash, randomUUID } from 'crypto';
import { getShipEngine, ShipEngineClient, trackingObservationDisposition } from '../config/shipEngine';
import { prepareOperationalNotices, readOperationalNoticeReceipt, type OperationalNoticeInput } from '../utils/notifications';
import { applyTrackingOutcome, readQualifiedTracking, trackingOutcomeMatches } from '../utils/trackingTransition';
import { processReturnDelivered } from '../utils/returnRefund';
import { hasRefundTransportDossier } from '../utils/lateTransportIncident';
import { trackingIdentity, trackingProofMatches, providerUtc } from '../config/shipEngine';
import { readLabelLifecyclePurchasedSource, labelReminderAcquisitionClock, labelLifecycleAllowsLeg, type LabelPurchasedReference } from '../utils/labelLifecycle';
import { supportSourceHash } from '../utils/supportRequest';
import { pollTransportReviewFollowUps, observeLabelDepositDeadline } from '../utils/transportReview';
import {committedReturnReceipt} from '../utils/returnRequest';

/** Page size per Firestore query. */
const PAGE_SIZE = 200;

/** Hard cap on parcels processed per run (across all statuses) to bound time. */
const MAX_TRANSACTIONS_PER_RUN = 600;

/**
 * F79: a GUARANTEED budget reserved for the return leg (return_requested), so a
 * large backlog of forward parcels (label_created/shipped) can never starve the
 * returns whose physical arrival requires examination (never a new refund).
 * Returns are polled FIRST, up to this cap; the remainder of MAX_TRANSACTIONS_PER_RUN
 * goes to the forward legs.
 */
const RETURN_LEG_RESERVED_BUDGET = 200;

/** Forward leg and delivered history, polled after returns. */
// Keep observing completed history: a carrier can later correct delivery. The
// per-status finite cycles also cover corrections whose webhook was lost.
const REFUND_TRANSPORT_STATUSES = ['refunded', 'refund_action_required', 'refund_in_progress'] as const;
const FORWARD_STATUSES = ['label_created', 'shipped', 'delivered', 'completed', ...REFUND_TRANSPORT_STATUSES] as const;

/** Throttle between ShipEngine tracking calls (ms) to respect rate limits. */
const SHIPENGINE_THROTTLE_MS = 150;

/** Stop launching work a minute before the function's execution timeout. */
const TRACKING_RUN_WORK_MS = 8 * 60 * 1000;
const CHECKPOINT_TIME_RESERVE_MS = 10 * 1000;
const FORWARD_LINE_TIME_RESERVE_MS = 75 * 1000;
const RETURN_LINE_TIME_RESERVE_MS = 2 * 60 * 1000;

/** A label_created parcel with no carrier scan after this many days nudges the seller. */
const LABEL_STALE_DAYS = 3;
const LABEL_STALE_MS = LABEL_STALE_DAYS * 24 * 60 * 60 * 1000;

/**
 * Statuses whose parcels we poll by document ID:
 *   - return_requested: reverse leg (seller-bound), polled FIRST with a reserved
 *     budget (F79), via returnTrackingNumber.
 *   - label_created / shipped: forward leg (buyer-bound), polled via trackingNumber.
 */

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const checkShippedTracking = onSchedule(
  {
    schedule: 'every 12 hours',
    region: 'northamerica-northeast1',
    memory: '512MiB',
    timeoutSeconds: 540,
    secrets: ['SHIPENGINE_API_KEY', 'STRIPE_SECRET_KEY'],
  },
  async () => {
    return withFinancialRecoveryScope({operation: "scheduled/trackingCheck.checkShippedTracking"}, async () => {
    const shipEngine = getShipEngine();
    if (!shipEngine) {
      logger.warn('[checkShippedTracking] ShipEngine not configured; reviewing dates without polling');
    }

    let deliveredCount = 0;
    let shippedCount = 0;
    let failedCount = 0;
    let staleNudged = 0;
    let returnRefundedCount = 0;
    let errorCount = 0;
    let processed = 0;
    let dateReviews = 0;
    let inquiryFollowUps = 0;
    let depositDeadlineReviews = 0;

    const now = Date.now();
    const workDeadlineMs = now + TRACKING_RUN_WORK_MS;

    // F79: poll the RETURN leg FIRST with a reserved budget so a forward-parcel
    // backlog can never starve returns (a return DELIVERED scan records parcel
    // arrival for human examination). Returns get up to RETURN_LEG_RESERVED_BUDGET; the forward legs get
    // the remainder of MAX_TRANSACTIONS_PER_RUN. Each phase has its own cap so the
    // total still respects MAX_TRANSACTIONS_PER_RUN.
    // Independently traverse actual saved return-label references. A commercial
    // status change must not hide a late physical return from observation.
    if (shipEngine) processed += await pollLateReturnLabels(Math.min(workDeadlineMs, Date.now() + 90_000));
    const forwardOffset = await nextForwardStatusOffset();
    const forwardStatuses = [...FORWARD_STATUSES.slice(forwardOffset), ...FORWARD_STATUSES.slice(0, forwardOffset)];
    const phases: { statuses: readonly string[]; cap: number }[] = [
      { statuses: ['return_requested'], cap: Math.min(RETURN_LEG_RESERVED_BUDGET, MAX_TRANSACTIONS_PER_RUN) },
      { statuses: forwardStatuses, cap: MAX_TRANSACTIONS_PER_RUN },
    ];

    for (const phase of phases) {
      // Returns keep their reserved share, but cannot consume the whole run.
      // Unused return time is available to the following forward statuses.
      const phaseDeadlineMs = phase.statuses[0] === 'return_requested'
        ? Math.min(workDeadlineMs, Date.now() + TRACKING_RUN_WORK_MS / 3) : workDeadlineMs;
      for (let statusIndex = 0; statusIndex < phase.statuses.length; statusIndex++) {
        const status = phase.statuses[statusIndex];
        const remainingStatuses = phase.statuses.length - statusIndex;
        const lineTimeReserveMs = status === 'return_requested' ? RETURN_LINE_TIME_RESERVE_MS : FORWARD_LINE_TIME_RESERVE_MS;
        // A growing set of terminal statuses must not divide every share below
        // one bounded GET. Rotation gives the statuses deferred by the global
        // deadline first position on a subsequent run; each has its own cursor.
        const statusDeadlineMs = Math.min(phaseDeadlineMs, Date.now() + Math.max(
          lineTimeReserveMs + CHECKPOINT_TIME_RESERVE_MS,
          Math.max(0, phaseDeadlineMs - Date.now()) / remainingStatuses));
        if (Date.now() + CHECKPOINT_TIME_RESERVE_MS >= statusDeadlineMs) continue;
        const statusEnd = Math.min(MAX_TRANSACTIONS_PER_RUN, processed + Math.ceil(Math.max(0, phase.cap - processed) / remainingStatuses));
        if (processed >= statusEnd) continue;
        const cursorRef = db.collection('job_locks').doc(`checkShippedTracking_${status}_cursor`);
        const scan = await acquireTrackingScan(cursorRef);
        if (!scan) continue;
        try {
          const checkpointCursor = qualifiedTrackingCursor(scan.checkpoint);
          let cursor: TrackingScanCursor = checkpointCursor ?? await startTrackingCycle(status);
          if (!checkpointCursor && !await saveTrackingCursor(cursorRef, scan.ownerId, cursor)) continue;
          if (!cursor.untilId) continue;
          let keepGoing = true;
          while (keepGoing && processed < statusEnd) {
            if (Date.now() + CHECKPOINT_TIME_RESERVE_MS >= statusDeadlineMs) break;
            if (!await refreshTrackingLease(cursorRef, scan.ownerId)) break;
            const pageSize = Math.min(PAGE_SIZE, statusEnd - processed);
            let query = db.collection('transactions')
              .where('status', '==', status)
              .orderBy('__name__', 'asc')
              .endAt(cursor.untilId)
              .limit(pageSize + 1);
            if (cursor.lastId) query = query.startAfter(cursor.lastId);
            const snap = await query.get();
            const inspected = snap.docs.slice(0, pageSize);
            if (!inspected.length) {
              await saveTrackingCursor(cursorRef, scan.ownerId, completedTrackingCycle(cursor));
              break;
            }
            let pageStopped = false;
            for (const doc of inspected) {
              const data = doc.data();
              const transactionId = doc.id;
              const cycleRow = doc.createTime.seconds < cursor.startedAt.seconds ||
                doc.createTime.seconds === cursor.startedAt.seconds && doc.createTime.nanoseconds <= cursor.startedAt.nanoseconds;
              const cashWithoutParcel = data.deliveryType === 'meetup' && !data.trackingNumber && !data.shipEngineLabelId &&
                !data.returnTrackingNumber && !data.returnLabelId;
              const terminalRefund = (REFUND_TRANSPORT_STATUSES as readonly string[]).includes(status);
              const qualifiedRefundParcel = terminalRefund && hasRefundTransportDossier(data) && !!trackingIdentity(transactionId, data, 'forward');
              const mayPoll = cycleRow && !cashWithoutParcel && !!shipEngine &&
                (qualifiedRefundParcel || !terminalRefund && !unqualifiedOrderDate(data.createdAt, now)) &&
                !!(status === 'return_requested' ? data.returnTrackingNumber : data.trackingNumber);
              const timeReserveMs = mayPoll ? lineTimeReserveMs : CHECKPOINT_TIME_RESERVE_MS;
              if (Date.now() + timeReserveMs >= statusDeadlineMs ||
                  Date.now() + timeReserveMs >= workDeadlineMs) {
                pageStopped = true;
                break;
              }
              // Save only after this row's awaited processing has terminated.
              // A crash/timeout inside it leaves the preceding native cursor.
              await (async () => {
                // The native createTime only bounds this observation cycle. It is
                // never used as an order, shipping, payment or policy timestamp.
                if (!cycleRow) return;
                // Documentary human follow-up remains available even when a
                // label/date/provider is unknown. It never changes money or
                // interprets elapsed transit time as loss.
                try { inquiryFollowUps += await pollTransportReviewFollowUps(transactionId); }
                catch (err) {
      if (err instanceof FinancialRecoveryBlocked) throw err;
                  errorCount++;
                  logger.error('[checkShippedTracking] transport inquiry follow-up unavailable', {
                    transactionId, error: err instanceof Error ? err.message : String(err),
                  });
                }
                // E18 uses the accepted payment-policy deadline, independently
                // of createdAt and provider availability. No new clock/effect.
                if (status === 'label_created') try {
                  if (await observeLabelDepositDeadline(transactionId)) depositDeadlineReviews++;
                } catch (err) {
      if (err instanceof FinancialRecoveryBlocked) throw err;
                  errorCount++;
                  logger.error('[checkShippedTracking] label deposit deadline review unavailable', {
                    transactionId, error: err instanceof Error ? err.message : String(err),
                  });
                }
                // Ordinary cash meetups have no parcel to reconcile. Conflicting
                // label/tracking references still require examination.
                if (cashWithoutParcel) return;
                // Terminal refunds have no financial transition here. Observe
                // only an attributable, genuinely committed parcel, even when
                // the order date is missing: its temporal relation stays unknown.
                if (terminalRefund) {
                  if (!qualifiedRefundParcel || !shipEngine) return;
                  try {
                    await sleep(SHIPENGINE_THROTTLE_MS);
                    await readQualifiedTracking(transactionId, data, 'forward');
                  } catch (err) {
      if (err instanceof FinancialRecoveryBlocked) throw err;
                    errorCount++;
                    logger.error('[checkShippedTracking] late transport observation unavailable', {
                      transactionId, error: err instanceof Error ? err.message : String(err),
                    });
                  }
                  return;
                }
                if (unqualifiedOrderDate(data.createdAt, now)) {
                  try {
                    if (await recordUnqualifiedTrackingDate(doc, status, now)) dateReviews++;
                  } catch (err) {
      if (err instanceof FinancialRecoveryBlocked) throw err;
                    errorCount++;
                    logger.error('[checkShippedTracking] could not record date review', {
                      transactionId, error: err instanceof Error ? err.message : err,
                    });
                  }
                  return;
                }
                if (!shipEngine) return;

                // ---- RETURN leg: exact parcel arrival; no new refund ----
                if (status === 'return_requested') {
                  if (!data.returnTrackingNumber) {
                    return;
                  }
                  try {
                    await sleep(SHIPENGINE_THROTTLE_MS);
                    const tracking = await readQualifiedTracking(transactionId, data, 'return');
                    const mappedReturn = ShipEngineClient.mapStatus(tracking.statusCode);

                    if (mappedReturn === 'DELIVERED') {
                      const r = await processReturnDelivered(transactionId, 'poller', tracking.proof);
                      if (r.refunded) returnRefundedCount++;
                    } else {
                      // Best-effort visibility refresh; no money movement.
                      await db.runTransaction(async tx => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
                        const current = (await tx.get(doc.ref)).data();
                        if (current && await trackingOutcomeMatches(tx, transactionId, current, tracking.proof, 'return')) {
                          const snapshot = trackingObservationDisposition(current, tracking.proof, 'return') === 'snapshot';
                          await recoveryCommit({refs: [(doc.ref).path]});
    tx.update(doc.ref, {...(!current.returnDeliveredAt ? {returnTrackingStatus: mappedReturn} : {}),
                            [snapshot ? 'returnTrackingSnapshot' : 'returnTrackingObservation']: {...tracking.proof, source: 'poller', recordedAt: FieldValue.serverTimestamp()}});
                        }
                      });
                    }
                  } catch (err) {
      if (err instanceof FinancialRecoveryBlocked) throw err;
                    errorCount++;
                    logger.error('[checkShippedTracking] error checking return tracking', {
                      transactionId,
                      returnTrackingNumber: data.returnTrackingNumber,
                      error: err instanceof Error ? err.message : err,
                    });
                  }
                  return;
                }

                // No tracking number yet (label_created may have one already).
                if (!data.trackingNumber) {
                  // Nudge sellers who printed a label but never got a carrier scan.
                  if (status === 'label_created') {
                    await maybeNudgeStaleLabel(doc.ref, data, transactionId, now).then(
                      (nudged) => {
                        if (nudged) staleNudged++;
                      }
                    );
                  }
                  return;
                }

                try {
                  await sleep(SHIPENGINE_THROTTLE_MS);
                  const tracking = await readQualifiedTracking(transactionId, data, 'forward');
                  const mapped = ShipEngineClient.mapStatus(tracking.statusCode);

                  const result = await applyTrackingOutcome(transactionId, mapped, 'poller', tracking.proof);

                  if (result.kind === 'delivered' && result.changed) deliveredCount++;
                  else if (result.kind === 'shipped' && result.changed) shippedCount++;
                  else if (result.kind === 'failed' && result.changed) failedCount++;

                  // Stale-label nudge for label_created parcels still without a scan.
                  if (status === 'label_created' && result.kind !== 'shipped') {
                    const nudged = await maybeNudgeStaleLabel(doc.ref, data, transactionId, now);
                    if (nudged) staleNudged++;
                  }
                } catch (err) {
      if (err instanceof FinancialRecoveryBlocked) throw err;
                  errorCount++;
                  logger.error('[checkShippedTracking] error checking tracking', {
                    transactionId,
                    trackingNumber: data.trackingNumber,
                    error: err instanceof Error ? err.message : err,
                  });
                }
              })();
              const nextCursor: TrackingScanCursor = { ...cursor, lastId: transactionId };
              if (!await saveTrackingCursor(cursorRef, scan.ownerId, nextCursor)) {
                pageStopped = true;
                break;
              }
              cursor = nextCursor;
              processed++;
            }
            if (pageStopped) break;
            keepGoing = snap.size > pageSize;
            // Each completed row is already persisted. Mark the cycle complete
            // only after the entire page was consumed and no lookahead remains.
            if (!keepGoing && !await saveTrackingCursor(cursorRef, scan.ownerId, completedTrackingCycle(cursor))) break;
          }
        } finally {
          await releaseTrackingLease(cursorRef, scan.ownerId);
        }
      }
    }

    logger.info('[checkShippedTracking] run complete', {
      processed,
      shipped: shippedCount,
      delivered: deliveredCount,
      failed: failedCount,
      staleNudged,
      returnRefunded: returnRefundedCount,
      dateReviews,
      inquiryFollowUps,
      depositDeadlineReviews,
      errors: errorCount,
    });

    });
  }
);

/** Time spent in a slow forward status must not always penalize the same
 * later statuses. This is observation scheduling, never order authority. */
async function nextForwardStatusOffset(): Promise<number> {
  const ref = db.collection('job_locks').doc('checkShippedTracking_forward_rotation');
  return db.runTransaction(async tx => {
    const data = (await tx.get(ref)).data();
    const offset = data?.schemaVersion === 1 && Number.isSafeInteger(data.nextOffset) &&
      data.nextOffset >= 0 && data.nextOffset < FORWARD_STATUSES.length ? data.nextOffset as number : 0;
    tx.set(ref, { schemaVersion: 1, nextOffset: (offset + 1) % FORWARD_STATUSES.length,
      observedAt: FieldValue.serverTimestamp() }, { merge: true });
    return offset;
  });
}

/** A lease outlives this job's 540-second execution timeout. */
const TRACKING_SCAN_LEASE_MS = 10 * 60 * 1000;
interface TrackingScanCursor {
  schemaVersion: 2;
  cycleId: string;
  startedAt: Timestamp;
  untilId: string | null;
  lastId: string | null;
  completedAt: Timestamp | null;
}
const validDocumentId = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && Buffer.byteLength(value, 'utf8') <= 1500 && !value.includes('/');

function qualifiedTrackingCursor(raw: unknown): TrackingScanCursor | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Partial<TrackingScanCursor>;
  if (c.schemaVersion !== 2 || typeof c.cycleId !== 'string' || !c.cycleId ||
      !(c.startedAt instanceof Timestamp) || !Number.isFinite(c.startedAt.toMillis()) ||
      c.startedAt.toMillis() > Date.now() || !validDocumentId(c.untilId) ||
      (c.lastId !== null && (!validDocumentId(c.lastId) || Buffer.compare(Buffer.from(c.lastId, 'utf8'), Buffer.from(c.untilId, 'utf8')) > 0)) || c.completedAt !== null) return null;
  return { schemaVersion: 2, cycleId: c.cycleId, startedAt: c.startedAt,
    untilId: c.untilId, lastId: c.lastId, completedAt: null };
}

async function startTrackingCycle(status: string): Promise<TrackingScanCursor> {
  const startedAt = Timestamp.now();
  const tail = await db.collection('transactions').where('status', '==', status)
    .orderBy('__name__', 'desc').limit(1).get();
  return { schemaVersion: 2, cycleId: randomUUID(), startedAt,
    untilId: tail.docs[0]?.id ?? null, lastId: null, completedAt: tail.empty ? Timestamp.now() : null };
}
function completedTrackingCycle(cursor: TrackingScanCursor): TrackingScanCursor {
  return { ...cursor, completedAt: Timestamp.now() };
}

async function acquireTrackingScan(ref: FirebaseFirestore.DocumentReference): Promise<{
  ownerId: string; checkpoint: unknown;
} | null> {
  const ownerId = randomUUID();
  return db.runTransaction(async tx => {
    const data = (await tx.get(ref)).data();
    if (data?.scanLease?.lockedUntil instanceof Timestamp && data.scanLease.lockedUntil.toMillis() > Date.now()) return null;
    const checkpoint: unknown = data?.scanCursor;
    // Retain the old observation checkpoint for inspection. It is never a
    // business date or the starting position of the version-2 ID traversal.
    const preserveLegacy = checkpoint !== undefined &&
      (checkpoint === null || typeof checkpoint !== 'object' || (checkpoint as { schemaVersion?: unknown }).schemaVersion !== 2) &&
      data?.legacyScanCursor === undefined;
    tx.set(ref, {
      scanLease: { schemaVersion: 1, ownerId, lockedAt: Timestamp.now(),
        lockedUntil: Timestamp.fromMillis(Date.now() + TRACKING_SCAN_LEASE_MS) },
      ...(preserveLegacy ? { legacyScanCursor: checkpoint } : {}),
    }, { merge: true });
    return { ownerId, checkpoint };
  });
}
function ownsTrackingLease(data: FirebaseFirestore.DocumentData | undefined, ownerId: string): boolean {
  return data?.scanLease?.schemaVersion === 1 && data.scanLease.ownerId === ownerId &&
    data.scanLease.lockedUntil instanceof Timestamp && data.scanLease.lockedUntil.toMillis() > Date.now();
}
async function refreshTrackingLease(ref: FirebaseFirestore.DocumentReference, ownerId: string): Promise<boolean> {
  return db.runTransaction(async tx => {
    if (!ownsTrackingLease((await tx.get(ref)).data(), ownerId)) return false;
    tx.update(ref, { 'scanLease.lockedUntil': Timestamp.fromMillis(Date.now() + TRACKING_SCAN_LEASE_MS) });
    return true;
  });
}
async function saveTrackingCursor(ref: FirebaseFirestore.DocumentReference, ownerId: string,
  cursor: TrackingScanCursor | LateReturnScanCursor): Promise<boolean> {
  return db.runTransaction(async tx => {
    if (!ownsTrackingLease((await tx.get(ref)).data(), ownerId)) return false;
    tx.update(ref, { scanCursor: cursor });
    return true;
  });
}

/** A single-field label index already includes __name__; no status catalogue
 * or collection-wide scan. The tuple checkpoint advances after awaited work,
 * under the existing lease, and cycles through at most 40 rows each run. */
interface LateReturnScanCursor {
  schemaVersion: 2; kind: 'late_return_labels'; cycleId: string; startedAt: Timestamp;
  until: {labelId: string; id: string} | null; last: {labelId: string; id: string} | null; completedAt: Timestamp | null;
}
const labelTuple = (v: any): v is {labelId: string; id: string} => !!v && validDocumentId(v.id) &&
  typeof v.labelId === 'string' && v.labelId.length > 0 && Buffer.byteLength(v.labelId, 'utf8') <= 1500;
function lateReturnCursor(raw: any): LateReturnScanCursor | null {
  return raw?.schemaVersion === 2 && raw.kind === 'late_return_labels' && typeof raw.cycleId === 'string' &&
    raw.startedAt instanceof Timestamp && raw.startedAt.toMillis() <= Date.now() && labelTuple(raw.until) &&
    (raw.last === null || labelTuple(raw.last)) && raw.completedAt === null ? raw : null;
}
async function pollLateReturnLabels(deadlineMs: number): Promise<number> {
  const ref = db.collection('job_locks').doc('checkShippedTracking_late_return_cursor'), scan = await acquireTrackingScan(ref);
  if (!scan) return 0;
  let inspected = 0;
  try {
    let cursor = lateReturnCursor(scan.checkpoint);
    if (!cursor) {
      const tail = await db.collection('transactions').where('returnLabelId', '>', '').orderBy('returnLabelId', 'desc')
        .orderBy('__name__', 'desc').limit(1).get();
      cursor = {schemaVersion: 2, kind: 'late_return_labels', cycleId: randomUUID(), startedAt: Timestamp.now(),
        until: tail.empty ? null : {labelId: tail.docs[0].get('returnLabelId'), id: tail.docs[0].id}, last: null,
        completedAt: tail.empty ? Timestamp.now() : null};
      if (!await saveTrackingCursor(ref, scan.ownerId, cursor)) return 0;
    }
    if (!cursor.until) return 0;
    let query = db.collection('transactions').where('returnLabelId', '>', '').orderBy('returnLabelId').orderBy('__name__')
      .endAt(cursor.until.labelId, cursor.until.id).limit(41);
    if (cursor.last) query = query.startAfter(cursor.last.labelId, cursor.last.id);
    const page = await query.get();
    for (const row of page.docs.slice(0, 40)) {
      if (Date.now() + 20_000 >= deadlineMs || !await refreshTrackingLease(ref, scan.ownerId)) return inspected;
      const order = row.data(), key = {labelId: order.returnLabelId as string, id: row.id};
      const fromThisCycle = row.createTime.seconds < cursor.startedAt.seconds ||
        row.createTime.seconds === cursor.startedAt.seconds && row.createTime.nanoseconds <= cursor.startedAt.nanoseconds;
      if (fromThisCycle && order.status !== 'return_requested' && committedReturnReceipt(row.id, order) &&
          trackingIdentity(row.id, order, 'return')) {
        try {
          await sleep(SHIPENGINE_THROTTLE_MS);
          const tracking = await readQualifiedTracking(row.id, order, 'return');
          if (tracking.statusCode === 'DE') await processReturnDelivered(row.id, 'late_return_poller', tracking.proof);
          else await db.runTransaction(async tx => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
            const current = (await tx.get(row.ref)).data();
            if (!current || !committedReturnReceipt(row.id, current) ||
                !await trackingOutcomeMatches(tx, row.id, current, tracking.proof, 'return')) return;
            const field = trackingObservationDisposition(current, tracking.proof, 'return') === 'snapshot' ? 'returnTrackingSnapshot' : 'returnTrackingObservation';
            await recoveryCommit({refs: [(row.ref).path]});
    tx.update(row.ref, {[field]: {...tracking.proof, source: 'late_return_poller', recordedAt: FieldValue.serverTimestamp()}});
          });
        } catch (error) {
      if (error instanceof FinancialRecoveryBlocked) throw error;logger.warn('[checkShippedTracking] late return requires examination', {transactionId: row.id,
          error: error instanceof Error ? error.message : 'unknown'});}
      }
      const next: LateReturnScanCursor = {...cursor, last: key};
      if (!await saveTrackingCursor(ref, scan.ownerId, next)) return inspected;
      cursor = next; inspected++;
    }
    if (page.size <= 40) await saveTrackingCursor(ref, scan.ownerId, {...cursor, completedAt: Timestamp.now()});
    return inspected;
  } finally {await releaseTrackingLease(ref, scan.ownerId);}
}
async function releaseTrackingLease(ref: FirebaseFirestore.DocumentReference, ownerId: string): Promise<void> {
  try {
    await db.runTransaction(async tx => {
      const data = (await tx.get(ref)).data();
      // An expired runner must never release its successor's lease.
      if (data?.scanLease?.ownerId !== ownerId) return;
      tx.update(ref, { 'scanLease.lockedUntil': Timestamp.fromMillis(0), 'scanLease.releasedAt': Timestamp.now() });
    });
  } catch (err) {
      if (err instanceof FinancialRecoveryBlocked) throw err;
    logger.warn('[checkShippedTracking] could not release scan lease', {
      cursorId: ref.id, error: err instanceof Error ? err.message : err,
    });
  }
}

type UnqualifiedOrderDate = 'missing' | 'malformed' | 'future';
function unqualifiedOrderDate(value: unknown, nowMs: number): UnqualifiedOrderDate | null {
  if (value == null) return 'missing';
  if (!(value instanceof Timestamp)) return 'malformed';
  const millis = value.toMillis();
  if (!Number.isFinite(millis) || millis < 0) return 'malformed';
  return millis > nowMs ? 'future' : null;
}

async function recordUnqualifiedTrackingDate(doc: FirebaseFirestore.QueryDocumentSnapshot,
  status: string, nowMs: number): Promise<boolean> {
  const leg = status === 'return_requested' ? 'return' : 'forward';
  const finality = 'tracking_order_date_reconciliation';
  const alertRef = db.collection('admin_alerts').doc('tracking_date_' +
    createHash('sha256').update(JSON.stringify([doc.id, leg, finality])).digest('hex'));
  return db.runTransaction(async tx => {
    const fresh = await tx.get(doc.ref);
    const current = fresh.data();
    // The alert describes the current native source examined by this page;
    // intervening edits or status transitions wait for another observation.
    if (!current || current.status !== status || !fresh.updateTime?.isEqual(doc.updateTime)) return false;
    const reason = unqualifiedOrderDate(current.createdAt, nowMs);
    if (!reason || (await tx.get(alertRef)).exists) return false;
    const labelId = leg === 'return' ? current.returnLabelId : current.shipEngineLabelId;
    const trackingNumber = leg === 'return' ? current.returnTrackingNumber : current.trackingNumber;
    tx.create(alertRef, { kind: 'tracking_date_reconciliation', severity: 'warning', refId: doc.id,
      status: 'open', createdAt: FieldValue.serverTimestamp(),
      message: 'La date native de cette commande doit être rapprochée avant le suivi automatique. Aucun appel transporteur ni changement financier ou de statut n’a été effectué pour ce signalement.',
      context: { schemaVersion: 1, leg, finality, reason, observedStatus: current.status,
        sourceRevision: fresh.updateTime!, observedAt: Timestamp.fromMillis(nowMs),
        orderCreatedAt: current.createdAt instanceof Timestamp ? current.createdAt : null,
        labelId: typeof labelId === 'string' ? labelId : null,
        trackingNumber: typeof trackingNumber === 'string' ? trackingNumber : null } });
    return true;
  });
}

/** Resolve the exact current purchase before evaluating its operational clock.
 * Neither an old labelCreatedAt nor shippedAt participates in this source. */
async function currentLabelReminderSource(tx:FirebaseFirestore.Transaction,transactionId:string,data:FirebaseFirestore.DocumentData,nowMs:number) {
  if(data.status!=='label_created'||data.deliveryType!=='shipping'||typeof data.sellerId!=='string'||!data.sellerId)return null;
  const replacement=Object.prototype.hasOwnProperty.call(data.labelLifecycleCurrent??{},'forward');
  const marker=data.labelLifecycleCurrent?.forward;
  const selected:LabelPurchasedReference=replacement?{kind:'replacement',entryId:marker?.activation?.purchaseEntryId,
    contentHash:marker?.activation?.purchaseContentHash}:{kind:'initial'};
  const purchased=await readLabelLifecyclePurchasedSource(tx,transactionId,data,'forward',selected);
  const identity=purchased.identity;
  if(purchased.qualification!=='native_purchased_label'||purchased.currentness!=='current'||!identity||
    identity.labelId!==data.shipEngineLabelId||identity.trackingNumber!==(data.trackingNumber??null)||identity.carrierCode!==data.carrierCode||
    !purchased.purchaseSourceHash||!await labelLifecycleAllowsLeg(tx,transactionId,data,'forward'))return null;
  // Initial purchase provenance can legitimately omit the provider date. A
  // present malformed date is different from that absence and remains unknown.
  const rawProviderDate=selected.kind==='initial'?data.labelPurchase?.qualification?.providerCreatedAt:null;
  if(rawProviderDate!=null&&providerUtc(rawProviderDate)===null)return null;
  const acquiredAtMs=labelReminderAcquisitionClock(purchased.purchaseRecordedAt,identity.providerCreatedAtMs,nowMs);
  if(acquiredAtMs===null)return null;
  // Current native scan evidence wins even if a concurrent status writer has
  // not completed. Historical observations for another label are not current.
  let sameLabelObservation=false,latestNoScan=false;
  for(const key of ['trackingObservation','trackingIdentityProof','trackingSnapshot']){
    const proof=data[key];if(proof==null)continue;
    if(typeof proof!=='object'||Array.isArray(proof))return null;
    if(proof.labelId!==identity.labelId)continue;
    sameLabelObservation=true;
    // A positive scan is never erased by a later no-event snapshot.
    if(proof.statusCode!=='NY')return null;
    if(trackingProofMatches(transactionId,data,proof,'forward')){
      if(!(proof.recordedAt instanceof Timestamp)||proof.recordedAt.toMillis()>nowMs||
        proof.recordedAt.toMillis()<proof.observedAtMs||!Number.isSafeInteger(proof.providerLabelCreatedAtMs)||
        proof.providerLabelCreatedAtMs<0||proof.providerLabelCreatedAtMs>acquiredAtMs||
        identity.providerCreatedAtMs!==null&&proof.providerLabelCreatedAtMs!==identity.providerCreatedAtMs)return null;
      latestNoScan=true;
    } else if(!Number.isSafeInteger(proof.readVersion)||!Number.isSafeInteger(data.trackingRead?.version)||
      proof.readVersion>=data.trackingRead.version||proof.schemaVersion!==1||proof.provider!=='shipengine'||
      proof.transactionId!==transactionId||proof.leg!=='forward'||proof.sourceHash!==trackingIdentity(transactionId,data,'forward')?.sourceHash)return null;
  }
  if(sameLabelObservation&&!latestNoScan)return null;
  const source={transactionId,sellerId:data.sellerId,selected,identity,purchaseSourceHash:purchased.purchaseSourceHash,
    purchaseRecordedAt:purchased.purchaseRecordedAt,acquiredAtMs,clockBasis:'native_purchase_recorded_at',
    providerCreatedAtQualification:identity.providerCreatedAtMs===null?'not_recorded':'native_provider_date'};
  return {source,sourceHash:supportSourceHash(source)};
}
function staleLabelNotice(transactionId:string,sellerId:string,sourceHash:string,sequence:number):OperationalNoticeInput {
  return {eventKey:`label_stale_v2:${transactionId}:${sourceHash}:${sequence}`,userId:sellerId,
    type:'label_stale_reminder',title:'Dépôt du colis à vérifier',
    message:'L’étiquette est créée, mais aucune prise en charge du transporteur n’est enregistrée. Consultez la commande et contactez le support si vous avez déjà déposé le colis.',
    data:{transactionId}};
}
/** Current-label source, clock and idempotence marker are requalified in the
 * final TX before the notice and its native receipt commit atomically. */
async function maybeNudgeStaleLabel(ref:FirebaseFirestore.DocumentReference,data:FirebaseFirestore.DocumentData,
  transactionId:string,nowMs:number):Promise<boolean> {
  // The preceding provider read may finish after this scheduled run started.
  // Date qualification uses this observation, not the old run-start clock.
  nowMs=Math.max(nowMs,Date.now());
  try {
    const observed=await db.runTransaction(async tx=>{
      const current=(await tx.get(ref)).data();
      if(!current||current.shipEngineLabelId!==data.shipEngineLabelId||current.trackingNumber!==data.trackingNumber)return null;
      return currentLabelReminderSource(tx,transactionId,current,nowMs);
    });
    if(!observed||nowMs-observed.source.acquiredAtMs<LABEL_STALE_MS)return false;
    return await db.runTransaction(async tx=>{
    const recoveryCommit = financialRecoveryCommitCheckpoint();
      const current=(await tx.get(ref)).data();if(!current)return false;
      const fresh=await currentLabelReminderSource(tx,transactionId,current,nowMs);
      if(!fresh||fresh.sourceHash!==observed.sourceHash||nowMs-fresh.source.acquiredAtMs<LABEL_STALE_MS)return false;
      const prior=current.labelStaleReminder;
      let sequence=1;
      if(prior!==undefined){
        if(prior?.protocol!=='label_stale_reminder_v1'||prior.transactionId!==transactionId||prior.sellerId!==current.sellerId||
          typeof prior.sourceHash!=='string'||!/^[a-f0-9]{64}$/.test(prior.sourceHash)||
          !prior.source||prior.source.transactionId!==transactionId||prior.source.sellerId!==prior.sellerId||
          supportSourceHash(prior.source)!==prior.sourceHash||
          labelReminderAcquisitionClock(prior.source.purchaseRecordedAt,prior.source.identity?.providerCreatedAtMs,nowMs)!==prior.source.acquiredAtMs||
          !Number.isSafeInteger(prior.sequence)||prior.sequence<1||
          prior.sequence>=Number.MAX_SAFE_INTEGER||!(prior.nudgedAt instanceof Timestamp)||prior.nudgedAt.toMillis()>nowMs||
          prior.nudgedAt.toMillis()-prior.source.acquiredAtMs<LABEL_STALE_MS)return false;
        const oldNotice=await readOperationalNoticeReceipt(tx,staleLabelNotice(transactionId,prior.sellerId,prior.sourceHash,prior.sequence));
        if(!oldNotice||oldNotice.notificationId!==prior.notificationId||oldNotice.committedAt!==prior.nudgedAt.toDate().toISOString())return false;
        if(prior.sourceHash===fresh.sourceHash){
          if(nowMs-prior.nudgedAt.toMillis()<LABEL_STALE_MS)return false;
          sequence=prior.sequence+1;
        }
      } else if(fresh.source.selected.kind==='initial'&&Object.prototype.hasOwnProperty.call(current,'labelStaleNudgedAt')){
        // The old timestamp names neither a purchase nor its preceding notice.
        // Preserve the old receipt; never adopt it as a new source-bound clock.
        return false;
      }
      const notice=staleLabelNotice(transactionId,current.sellerId,fresh.sourceHash,sequence);
      const prepared=await prepareOperationalNotices(tx,[notice]);
      await recoveryCommit({refs: [(ref).path]});
    tx.update(ref,{labelStaleNudgedAt:FieldValue.serverTimestamp(),labelStaleReminder:{protocol:'label_stale_reminder_v1',
        transactionId,sellerId:current.sellerId,sourceHash:fresh.sourceHash,source:fresh.source,sequence,
        notificationId:prepared.notificationIds[0],nudgedAt:FieldValue.serverTimestamp()}});
      prepared.commit();return true;
    });
  } catch(err){
      if (err instanceof FinancialRecoveryBlocked) throw err;
    logger.warn('[checkShippedTracking] stale-label nudge failed',{transactionId,error:err instanceof Error?err.message:String(err)});
    return false;
  }
}
