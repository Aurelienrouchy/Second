import { FinancialRecoveryBlocked } from "../utils/financialRecoveryInterlock";
import { financialRecoveryCommitCheckpoint } from "../utils/financialRecoverySources";
import {financialRecoverySourceFields} from '../utils/financialRecoverySources';
import { withFinancialRecoveryScope } from "../utils/financialRecoveryInterlock";
/**
 * Scheduled swap functions
 * Firebase Functions v2 — region northamerica-northeast1
 *
 * SWAP ZONE MODEL: ONE permanent, generalist, always-open zone with NO time
 * window, NO themes, NO join/leave. The old thematic schedulers
 * (updateSwapPartystatuses / sendSwapZoneReminders) are gone.
 *
 * Only native proposals that have never been accepted may expire here.
 * Accepted exchanges, including payment_pending, remain under human review;
 * their age never authorizes cancellation, refund or inventory release.
 */
import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as logger from 'firebase-functions/logger';
import { Timestamp } from 'firebase-admin/firestore';
import { db, FieldValue } from '../config/firebase';
import { prepareOperationalNotices, type OperationalNoticeInput } from '../utils/notifications';
import { createHash, randomUUID } from 'node:crypto';
import { prepareHoldReview, HOLD_OPERATIONAL_AGING_THRESHOLD_MS, type HoldSource } from '../utils/holdReview';
import { captureServerEvent } from '../lib/analytics';
import { hasNativeUnacceptedSwapAgreement, hasUnreservedSwapProposal } from '../utils/swapLaunchPolicy';
import { inventoryEngagementMatches, planInventoryFinish, type InventoryPlan } from '../utils/inventoryUnit';
import {readFinancialRecoveryControl, type QualifiedRecoveryControl} from '../config/recoveryControl';
import {localAgreementWitnessMatches} from '../utils/localAgreement';
import {hasPhase1LocalAgreement} from '../utils/phase1CronPartition';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function swapExpirationNotices(swapId: string, data: FirebaseFirestore.DocumentData, phase: 'proposal' | 'post_acceptance'): OperationalNoticeInput[] {
  const anchor = data.updatedAt instanceof Timestamp ? data.updatedAt.toMillis() : null;
  return [data.initiatorId, data.receiverId].map(userId => ({ eventKey: `swap_expired:${swapId}:${phase}:${data.status}:${anchor}`,
    userId, type: 'swap_update', title: 'Expiration de l’échange enregistrée',
    message: phase === 'proposal'
      ? 'Cette proposition d’échange a expiré sans progression. Consultez l’échange pour son état courant et contactez le support en cas de désaccord.'
      : 'Cet échange a expiré sans progression. Consultez son état courant, ainsi que le suivi d’un éventuel complément, ou contactez le support en cas de désaccord.',
    data: { swapId, sourceStatus: data.status, expiryPhase: phase },
  }));
}

function swapDaysOpen(swap: FirebaseFirestore.DocumentData): number {
  const createdAt = swap.createdAt;
  if (createdAt && typeof createdAt.toMillis === 'function') {
    return Math.round(((Date.now() - createdAt.toMillis()) / MS_PER_DAY) * 100) / 100;
  }
  return 0;
}

/** Resolve items arrays with backward compat for legacy single-item swaps */
function getSwapItems(swap: any, side: 'initiator' | 'receiver'): any[] {
  if (side === 'initiator') {
    return swap.initiatorItems || (swap.initiatorItem ? [swap.initiatorItem] : []);
  }
  return swap.receiverItems || (swap.receiverItem ? [swap.receiverItem] : []);
}

/**
 * Release all `swapPartyItems` linked to a swap (isPending -> false) for both
 * sides.
 */
async function readSwapPartyRelease(tx: FirebaseFirestore.Transaction, swap: FirebaseFirestore.DocumentData) {
  const refs = new Map<string, FirebaseFirestore.DocumentReference>();
  if (!swap.partyId || hasUnreservedSwapProposal(swap)) return {commit: () => undefined};
  const partyItemsRef = db.collection('swapPartyItems');
  for (const side of ['initiator', 'receiver'] as const) {
    const sellerId = side === 'initiator' ? swap.initiatorId : swap.receiverId;
    for (const item of getSwapItems(swap, side)) {
      if (!item?.articleId) continue;
      const q = await tx.get(partyItemsRef
        .where('partyId', '==', swap.partyId)
        .where('articleId', '==', item.articleId)
        .where('sellerId', '==', sellerId)
        .limit(101));
      if (q.size >= 101) throw new Error('Swap zone rows require reconciliation');
      for (const d of q.docs) refs.set(d.ref.path, d.ref);
    }
  }
  return {commit: () => {for (const ref of refs.values()) tx.update(ref, {isPending: false});}};
}

/** Seven-day expiry is limited to a native, never-accepted proposal. */
const STALE_SWAP_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

/** A status alone does not prove that an exchange was never accepted.
 * Presence of an acceptance/progression marker is unknown even when its value
 * is null or malformed. The native proposal declaration must precede creation. */
export function proposalCanAutoExpire(data:FirebaseFirestore.DocumentData,cutoffMs:number,observedAtMs:number):boolean {
  if(data.status!=='proposed'||!Number.isSafeInteger(cutoffMs)||!Number.isSafeInteger(observedAtMs)||
    cutoffMs<=0||cutoffMs>observedAtMs||!(data.createdAt instanceof Timestamp)||
    !Number.isFinite(data.createdAt.toMillis())||data.createdAt.toMillis()<=0||data.createdAt.toMillis()>=cutoffMs||
    data.createdAt.toMillis()>observedAtMs||data.articleDeclarationProposalVersion!==1||
    !(data.articleDeclarationProposalRecordedAt instanceof Timestamp)||data.articleDeclarationProposalRecordedAt.toMillis()<=0||
    data.articleDeclarationProposalRecordedAt.toMillis()>data.createdAt.toMillis())return false;
  const parties=[data.initiatorId,data.receiverId];
  if(parties.some(v=>typeof v!=='string'||!v||v.includes('/')||v.length>200)||parties[0]===parties[1])return false;
  const hasNativeProposedMode=hasNativeUnacceptedSwapAgreement(data);
  if(('exchangeMode' in data || 'exchangeAgreement' in data || 'swapLaunchPolicyVersion' in data)&&!hasNativeProposedMode)return false;
  const progress=['acceptedAt','initiatorPhotos','receiverPhotos','initiatorShippedAt','receiverShippedAt',
    'initiatorReceivedAt','receiverReceivedAt','completedAt','statusBeforeDispute','cancelledAt','cancelReason','expiredAt',
    'paymentIntentId','stripePaymentIntentId','stripeChargeId','bankDispute'];
  if(Object.keys(data).some(key=>progress.includes(key)||/^(topup|refund|dispute)/i.test(key)))return false;
  const top=data.cashTopUp;
  if(top!=null&&(typeof top!=='object'||Array.isArray(top)||Object.keys(top).sort().join(',')!=='amount,payerId'||
    !Number.isSafeInteger(top.amount)||top.amount<=0||!parties.includes(top.payerId)))return false;
  return true;
}

/** F81: bound each unfiltered status query so a backlog cannot OOM the run. */
const MAX_PER_STATUS = 300;

/**
 * Cancel only native never-accepted proposals older than seven days. Current
 * status, creation clock, declaration and absence of acceptance are reread in
 * the same transaction as cancellation and the two notice receipts.
 * Accepted exchanges have no automatic expiry, including unpaid complements.
 * Runs hourly; existing index: swaps (status ASC, createdAt ASC).
 */
async function expireProposedSwaps(partition: 'current' | 'phase1') {
    return withFinancialRecoveryScope({operation: "scheduled/swaps.expireStaleProposedSwaps"}, async () => {
    if (partition === 'current' && process.env.SECONDE_PHASE1_RUNTIME_SERVICE_ACCOUNT) {
      throw new FinancialRecoveryBlocked('phase1_partitioned_scheduler_required');
    }
    let localControl: QualifiedRecoveryControl | null = null;
    if (partition === 'phase1') {
      localControl = await readFinancialRecoveryControl();
      if (localControl.control.financialEnvironment !== 'unconfigured' || localControl.control.mode !== 'normal') return;
    }
    const observedAtMs=Date.now(),cutoffMs=observedAtMs-STALE_SWAP_EXPIRY_MS;
    const cutoff = new Date(cutoffMs);

    try {
      // Payment-pending already has an accepted agreement and is reviewed by
      // the documentary job below; it is never an expiry candidate.
      let query: FirebaseFirestore.Query = db.collection('swaps').where('status','==','proposed').where('createdAt','<',cutoff);
      if (localControl) query = query.where('localAgreementWitness.protocol', '==', 'local_agreement_source_v1')
        .where('localAgreementWitness.installationId', '==', localControl.control.installationId)
        .where('localAgreementWitness.epoch', '==', localControl.control.epoch);
      const proposedSnap=await query
        .limit(MAX_PER_STATUS).get();
      const staleDocs=proposedSnap.docs;

      if (staleDocs.length === 0) {
        logger.info('[expireStaleProposedSwaps] No stale swaps found');
        return;
      }

      logger.info('[expireStaleProposedSwaps] Cancelling stale swaps', {
        proposed: proposedSnap.size,
      });

      // A concurrent acceptance changes both status and acceptedAt. Native
      // guards are read under the write lock; an accepted agreement is never overwritten.
      const cancelled: { id: string; data: FirebaseFirestore.DocumentData }[] = [];
      for (const doc of staleDocs) {
        try {
          const swap = await db.runTransaction(async (tx) => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
            const snap = await tx.get(doc.ref);
            if (!snap.exists) return null;
            const data = snap.data()!;
            if (localControl && !localAgreementWitnessMatches('swap', doc.ref.path, data, localControl.control)) return null;
            if (!localControl && process.env.FINANCIAL_RECOVERY_ENVIRONMENT !== 'unconfigured' &&
                hasPhase1LocalAgreement(data)) return null;
            if(!proposalCanAutoExpire(data,cutoffMs,observedAtMs))return null;
            const inventoryPlans: InventoryPlan[] = [], seenArticles = new Set<string>(), seenUnits = new Set<unknown>();
            const sides = (['initiator', 'receiver'] as const).map(side => ({side, items: getSwapItems(data, side)}));
            // A malformed/unbounded proposal is reviewed rather than partly
            // cancelled. Every unit read precedes cancellation and every unit
            // release commits with it, including all listing aliases.
            if (sides.some(({items}) => !Array.isArray(items) || items.length === 0) ||
                sides.some(({items}) => items.length > 20)) return null;
            if (Object.prototype.hasOwnProperty.call(data, 'inventoryUnitCommitments') &&
                (!Array.isArray(data.inventoryUnitCommitments) || data.inventoryUnitCommitments.length !== sides.reduce((n, {items}) => n + items.length, 0))) return null;
            for (const {side, items} of sides) for (const item of items) {
              if (typeof item?.articleId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(item.articleId) || seenArticles.has(item.articleId)) return null;
              seenArticles.add(item.articleId);
              if (hasUnreservedSwapProposal(data)) continue; // Never release stock owned by another accepted agreement.
              const article = (await tx.get(db.collection('articles').doc(item.articleId))).data();
              if (!article || article.sellerId !== data[side + 'Id']) return null;
              const engagement = {kind: 'swap' as const, id: doc.id, sourceArticleId: item.articleId};
              const capture = data.inventoryUnitCommitments?.filter((v: any) => v?.articleId === item.articleId);
              if (capture && (capture.length !== 1 || !await inventoryEngagementMatches(tx, item.articleId, article, engagement, capture[0]))) return null;
              const plan = await planInventoryFinish(tx, item.articleId, article, engagement);
              if (Object.prototype.hasOwnProperty.call(article, 'inventoryUnit') && !plan) return null;
              if (plan) {
                if (seenUnits.has(plan.commitment.unitId)) return null;
                seenUnits.add(plan.commitment.unitId); inventoryPlans.push(plan);
              }
            }
            const partyRelease = await readSwapPartyRelease(tx, data);
            const notices = await prepareOperationalNotices(tx, swapExpirationNotices(doc.id, data, 'proposal'));
            await recoveryCommit({refs: [(doc.ref).path]});
    const expiredFields={
              status: 'cancelled',
              cancelReason:'proposed_expired_7d',
              updatedAt: FieldValue.serverTimestamp(),
            };
    tx.update(doc.ref,process.env.FINANCIAL_RECOVERY_ENVIRONMENT==='unconfigured'?await financialRecoverySourceFields('swap',doc.ref,data,expiredFields):expiredFields);
            for (const plan of inventoryPlans) plan.commit();
            partyRelease.commit();
            notices.commit();
            return data;
          });
          if (swap) cancelled.push({ id: doc.id, data: swap });
        } catch (cancelErr) {
      if (cancelErr instanceof FinancialRecoveryBlocked) throw cancelErr;
          logger.error('[expireStaleProposedSwaps] failed to cancel swap', {
            swapId: doc.id,
            error: cancelErr instanceof Error ? cancelErr.message : cancelErr,
          });
        }
      }

      // Inventory, zone rows and notices already committed atomically. Never
      // reset a row here: a newer accepted agreement may now own its pending flag.
      for (const { id: swapId, data: swap } of cancelled) {
        if (swap.initiatorId) {
          // Both party notices committed with the expiry; optional push is
          // resumed independently after item-release interruptions too.
          // Analytics (§12): swap_expired — distinct_id = initiator.
          await captureServerEvent(swap.initiatorId, 'swap_expired', {
            swap_id: swapId,
            status_before: typeof swap.status === 'string' ? swap.status : null,
            days_open: swapDaysOpen(swap),
            $insert_id: `swap_expired_${swapId}`,
          });
        }
      }

      logger.info(`[expireStaleProposedSwaps] Expired ${cancelled.length} stale swaps`);
    } catch (error) {
      if (error instanceof FinancialRecoveryBlocked) throw error;
      logger.error('[expireStaleProposedSwaps] Error expiring stale swaps', {
        error: error instanceof Error ? error.message : error,
      });
    }

    });
}

export const expireStaleProposedSwaps = onSchedule({schedule: 'every 1 hours', region: 'northamerica-northeast1', memory: '512MiB'},
  () => expireProposedSwaps('current'));

/** A disjoint modern partition; the production historical cron skips every
 * witness-bearing source. Only a native never-accepted local proposal expires.
 * Accepted meetings/swaps acquire no new automatic cancellation deadline. */
export const expirePhase1LocalProposals = onSchedule({schedule: 'every 1 hours', region: 'northamerica-northeast1', memory: '512MiB'},
  () => expireProposedSwaps('phase1'));

/**
 * Operational follow-up only. Accepted exchanges have no automatic expiry.
 * Fourteen days triggers human review, never an abandonment term, refund,
 * reservation change, or physical return/relisting. Historical observations
 * retain their original unknown-deadline qualifications and receipt protocol.
 */
const POST_ACCEPTANCE_REVIEW_THRESHOLD_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

/** Statuses eligible for a documentary progression review. */
const POST_ACCEPTANCE_STALE_STATUSES = ['payment_pending', 'accepted', 'photos_pending', 'shipping'] as const;
type PostAcceptanceStatus = typeof POST_ACCEPTANCE_STALE_STATUSES[number];
const POST_ACCEPTANCE_SCAN_PAGE_SIZE = 25;
const POST_ACCEPTANCE_SCAN_LEASE_MS = 10 * 60 * 1000;
const POST_ACCEPTANCE_SCAN_BUDGET_MS = 45 * 1000;
type PostAcceptanceCursor = {schemaVersion: 1; kind: 'swap_post_acceptance_review_by_id_v1'; status: PostAcceptanceStatus;
  cycleId: string; startedAt: Timestamp; cutoff: Timestamp; untilId: string | null; lastId: string | null; completedAt: Timestamp | null};
const postAcceptanceId = (value: unknown): value is string => typeof value === 'string' && !!value &&
  !value.includes('/') && value !== '.' && value !== '..' && Buffer.byteLength(value, 'utf8') <= 1500;

function postAcceptanceCursor(raw: any, status: PostAcceptanceStatus): PostAcceptanceCursor | null {
  if (raw?.schemaVersion !== 1 || raw.kind !== 'swap_post_acceptance_review_by_id_v1' || raw.status !== status ||
      !postAcceptanceId(raw.cycleId) || !(raw.startedAt instanceof Timestamp) || raw.startedAt.toMillis() <= 0 ||
      raw.startedAt.toMillis() > Date.now() || !(raw.cutoff instanceof Timestamp) ||
      !raw.cutoff.isEqual(Timestamp.fromMillis(raw.startedAt.toMillis() - POST_ACCEPTANCE_REVIEW_THRESHOLD_MS)) ||
      raw.untilId !== null && !postAcceptanceId(raw.untilId) ||
      raw.lastId !== null && (!postAcceptanceId(raw.lastId) || raw.untilId === null ||
        Buffer.compare(Buffer.from(raw.lastId), Buffer.from(raw.untilId)) > 0) ||
      raw.completedAt !== null && (!(raw.completedAt instanceof Timestamp) ||
        raw.completedAt.toMillis() < raw.startedAt.toMillis() || raw.completedAt.toMillis() > Date.now()) ||
      raw.untilId === null && (raw.lastId !== null || raw.completedAt === null)) return null;
  return raw as PostAcceptanceCursor;
}

function ownsPostAcceptanceLease(data: FirebaseFirestore.DocumentData | undefined, ownerId: string): boolean {
  return data?.scanLease?.schemaVersion === 1 && data.scanLease.ownerId === ownerId &&
    data.scanLease.lockedUntil instanceof Timestamp && data.scanLease.lockedUntil.toMillis() > Date.now();
}

function samePostAcceptanceCursor(raw: unknown, expected: PostAcceptanceCursor): boolean {
  const current = postAcceptanceCursor(raw, expected.status);
  return current !== null && current.cycleId === expected.cycleId && current.startedAt.isEqual(expected.startedAt) &&
    current.cutoff.isEqual(expected.cutoff) && current.untilId === expected.untilId && current.lastId === expected.lastId &&
    current.completedAt === null && expected.completedAt === null;
}

export function postAcceptanceStaleSource(candidate: FirebaseFirestore.DocumentSnapshot, current: FirebaseFirestore.DocumentSnapshot,
  cutoff: Timestamp, observedAt: Timestamp): 'qualified'|'changed'|'unknown' {
  const before = candidate.data(), now = current.data();
  // The ordinary TEST monitor does not own the phase-1 local partition.
  if (hasPhase1LocalAgreement(before) || hasPhase1LocalAgreement(now)) return 'changed';
  if (!candidate.exists || !current.exists || !before || !now || candidate.id !== current.id) return 'changed';
  const dates = [before.updatedAt, now.updatedAt, candidate.updateTime, current.updateTime];
  if (dates.some(date => !(date instanceof Timestamp) || date.toMillis() <= 0 || date.toMillis() > observedAt.toMillis())) return 'unknown';
  if (!(POST_ACCEPTANCE_STALE_STATUSES as readonly unknown[]).includes(before.status) || now.status !== before.status ||
      !before.updatedAt.isEqual(now.updatedAt) || !candidate.updateTime!.isEqual(current.updateTime!) ||
      now.updatedAt.toMillis() >= cutoff.toMillis()) return 'changed';
  return 'qualified';
}

/** Reads the immutable witness and its presentation before returning any writes. */
async function preparePostAcceptanceReview(tx: FirebaseFirestore.Transaction, candidate: FirebaseFirestore.DocumentSnapshot,
  current: FirebaseFirestore.DocumentSnapshot, cutoff: Timestamp, observedAt: Timestamp) {
  const qualification = postAcceptanceStaleSource(candidate, current, cutoff, observedAt);
  if (qualification !== 'qualified') return {outcome: qualification, commit: () => {}};
  const data = current.data()!, version = current.updateTime!, swapId = candidate.id;
  const source = {swapId, status: data.status, updatedAt: data.updatedAt as Timestamp, documentVersion: version};
  const reviewId = createHash('sha256').update(JSON.stringify(['swap_progression_review_v1', swapId, source.status,
    source.updatedAt.seconds, source.updatedAt.nanoseconds, version.seconds, version.nanoseconds])).digest('hex');
  const reviewRef = candidate.ref.collection('expiry_reviews').doc(reviewId);
  const prior = await tx.get(reviewRef), alertRef = db.collection('admin_alerts').doc('swap_progression_' + reviewId);
  const alert = await tx.get(alertRef);
  if (prior.exists) {
    const receipt = prior.data();
    if (receipt?.protocol !== 'swap_progression_review_v1' || receipt.reviewId !== reviewId || receipt.alertId !== alertRef.id ||
        receipt.source?.swapId !== swapId || receipt.source?.status !== source.status ||
        !(receipt.source?.updatedAt instanceof Timestamp) || !receipt.source.updatedAt.isEqual(source.updatedAt) ||
        !(receipt.source?.documentVersion instanceof Timestamp) || !receipt.source.documentVersion.isEqual(version) ||
        !(receipt.observedAt instanceof Timestamp) || receipt.observedAt.toMillis() > observedAt.toMillis() ||
        !(receipt.detectionCutoff instanceof Timestamp) || receipt.source.updatedAt.toMillis() >= receipt.detectionCutoff.toMillis() ||
        receipt.detectionThresholdMs !== POST_ACCEPTANCE_REVIEW_THRESHOLD_MS || receipt.deadlineQualification !== 'unknown' ||
        receipt.deadlineOriginQualification !== 'unknown' || receipt.financialState !== 'unknown' || receipt.physicalState !== 'unknown' ||
        receipt.resolutionState !== 'review_required' || receipt.expiryAuthorized !== false || receipt.financialEffect !== 'none' ||
        receipt.refundAuthorized !== false || receipt.reservationReleaseAuthorized !== false || receipt.stockReleaseAuthorized !== false ||
        receipt.physicalReturnAuthorized !== false) throw new Error('Private swap progression review needs reconciliation.');
    // The witness proves original atomic creation. A deleted mutable alert is
    // not recreated and does not become a newly qualified presentation.
    if (!alert.exists) return {outcome: 'unknown', commit: () => {}};
    if (alert.data()?.kind !== 'swap_post_acceptance_progression_review' || alert.data()?.refId !== swapId ||
        alert.data()?.context?.reviewId !== reviewId || alert.data()?.context?.reviewPath !== reviewRef.path)
      throw new Error('Swap progression alert source needs reconciliation.');
    return {outcome: 'already_recorded', commit: () => {}};
  }
  if (alert.exists) throw new Error('Swap progression alert has no native review witness.');
  return {outcome: 'observed', commit: () => {
    tx.create(reviewRef, {protocol: 'swap_progression_review_v1', reviewId, source, alertId: alertRef.id, observedAt,
      detectionCutoff: cutoff, detectionThresholdMs: POST_ACCEPTANCE_REVIEW_THRESHOLD_MS,
      deadlineQualification: 'unknown', deadlineOriginQualification: 'unknown', financialState: 'unknown', physicalState: 'unknown',
      resolutionState: 'review_required', expiryAuthorized: false, financialEffect: 'none', refundAuthorized: false,
      reservationReleaseAuthorized: false, stockReleaseAuthorized: false, physicalReturnAuthorized: false});
    tx.create(alertRef, {kind: 'swap_post_acceptance_progression_review', severity: 'warning', refId: swapId,
      message: 'La progression de cet échange doit être examinée. Ce signalement ne constate ni expiration, ni abandon, ni remboursement ou restitution des articles.',
      context: {swapId, reviewId, reviewPath: reviewRef.path, sourceStatus: source.status,
        financialState: 'unknown', physicalState: 'unknown', automaticActionTaken: false}, status: 'open', createdAt: observedAt});
  }};
}

/**
 * Existing hourly job now records private, source-bound review observations.
 * Candidate and transaction reads must have the same native status, updatedAt,
 * and document updateTime. A changed source is skipped. The permanent witness
 * and canonical operator alert commit together, once per source version.
 * Neither physical nor financial state is inferred from this detection.
 *
 * A leased, ID-bounded cycle per status prevents old recorded candidates from
 * starving later rows. The age is qualified locally, so these name-ordered
 * status queries need no new composite index or unsupported inequality order.
 */
export const expireStalePostAcceptanceSwaps = onSchedule(
  {
    schedule: 'every 1 hours',
    region: 'northamerica-northeast1',
    memory: '512MiB',
  },
  async () => {
    return withFinancialRecoveryScope({operation: "scheduled/swaps.expireStalePostAcceptanceSwaps"}, async () => {
    const lockRef = db.collection('job_locks').doc('swapPostAcceptanceReview_cursor'), ownerId = randomUUID();
    const stopAt = Date.now() + POST_ACCEPTANCE_SCAN_BUDGET_MS;
    const stats = {inspected: 0, observed: 0, alreadyRecorded: 0, skipped: 0, unknown: 0, errors: 0};
    try {
      const acquired = await db.runTransaction(async tx => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
        const data = (await tx.get(lockRef)).data(), lease = data?.scanLease;
        if (lease != null && (lease.schemaVersion !== 1 || typeof lease.ownerId !== 'string' || !lease.ownerId ||
            !(lease.lockedUntil instanceof Timestamp))) throw new Error('Swap progression scan lease needs reconciliation.');
        if (lease?.lockedUntil.toMillis() > Date.now()) return null;
        const start = data?.nextStatusIndex ?? 0;
        if (!Number.isSafeInteger(start) || start < 0 || start >= POST_ACCEPTANCE_STALE_STATUSES.length ||
            data?.scanCursors != null && (typeof data.scanCursors !== 'object' || Array.isArray(data.scanCursors)))
          throw new Error('Swap progression scan checkpoint needs reconciliation.');
        // Rotate before work: even an interrupted, slow first status does not
        // monopolize every subsequent invocation.
        await recoveryCommit({refs: [(lockRef).path]});
    tx.set(lockRef, {nextStatusIndex: (start + 1) % POST_ACCEPTANCE_STALE_STATUSES.length,
          scanLease: {schemaVersion: 1, ownerId, lockedAt: Timestamp.now(),
            lockedUntil: Timestamp.fromMillis(Date.now() + POST_ACCEPTANCE_SCAN_LEASE_MS)}}, {merge: true});
        return {start, cursors: data?.scanCursors ?? {}};
      });
      if (!acquired) return;
      try {
        for (let offset = 0; offset < POST_ACCEPTANCE_STALE_STATUSES.length && Date.now() < stopAt; offset++) {
          const status = POST_ACCEPTANCE_STALE_STATUSES[(acquired.start + offset) % POST_ACCEPTANCE_STALE_STATUSES.length];
          const stored: unknown = acquired.cursors[status];
          let cursor = stored === undefined ? null : postAcceptanceCursor(stored, status);
          if (stored !== undefined && !cursor) throw new Error('Swap progression status cursor needs reconciliation.');
          if (!cursor || cursor.completedAt !== null) {
            const startedAt = Timestamp.now();
            const tail = await db.collection('swaps').where('status', '==', status).orderBy('__name__', 'desc').limit(1).get();
            cursor = {schemaVersion: 1, kind: 'swap_post_acceptance_review_by_id_v1', status, cycleId: randomUUID(), startedAt,
              cutoff: Timestamp.fromMillis(startedAt.toMillis() - POST_ACCEPTANCE_REVIEW_THRESHOLD_MS),
              untilId: tail.docs[0]?.id ?? null, lastId: null, completedAt: tail.empty ? Timestamp.now() : null};
            const initial = cursor;
            const saved = await db.runTransaction(async tx => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
              const lock = (await tx.get(lockRef)).data();
              if (!ownsPostAcceptanceLease(lock, ownerId)) return false;
              await recoveryCommit({refs: [(lockRef).path]});
    tx.update(lockRef, {[`scanCursors.${status}`]: initial});
              return true;
            });
            if (!saved) return;
          }
          if (cursor.untilId === null) continue;
          let query = db.collection('swaps').where('status', '==', status).orderBy('__name__', 'asc')
            .endAt(cursor.untilId).limit(POST_ACCEPTANCE_SCAN_PAGE_SIZE);
          if (cursor.lastId !== null) query = query.startAfter(cursor.lastId);
          const page = await query.get();
          let pageFinished = true;
          for (const doc of page.docs) {
            if (Date.now() >= stopAt) {pageFinished = false; break;}
            const previous = cursor, next: PostAcceptanceCursor = {...cursor, lastId: doc.id};
            let outcome: string | null;
            try {
              outcome = await db.runTransaction(async tx => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
                const lock = (await tx.get(lockRef)).data();
                if (!ownsPostAcceptanceLease(lock, ownerId) || !samePostAcceptanceCursor(lock?.scanCursors?.[status], previous)) return null;
                const fresh = await tx.get(doc.ref), observedAt = Timestamp.now();
                const review = await preparePostAcceptanceReview(tx, doc, fresh, previous.cutoff, observedAt);
                if (!ownsPostAcceptanceLease(lock, ownerId)) return null;
                review.commit();
                await recoveryCommit({refs: [(lockRef).path]});
    tx.update(lockRef, {[`scanCursors.${status}`]: next,
                  'scanLease.lockedUntil': Timestamp.fromMillis(Date.now() + POST_ACCEPTANCE_SCAN_LEASE_MS),
                  lastRowObservation: {status, sourceId: doc.id, sourceVersion: fresh.updateTime ?? null, observedAt, result: review.outcome}});
                return review.outcome;
              });
            } catch (error) {
      if (error instanceof FinancialRecoveryBlocked) throw error;
              stats.errors++;
              logger.error('[expireStalePostAcceptanceSwaps] progression row requires another cycle', {
                swapId: doc.id, error: error instanceof Error ? error.message : error});
              // A malformed witness cannot starve all later rows. An explicit
              // error observation advances only under the same owner/cursor;
              // failed checkpoint writes stop the run and retain this row.
              outcome = await db.runTransaction(async tx => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
                const lock = (await tx.get(lockRef)).data();
                if (!ownsPostAcceptanceLease(lock, ownerId) || !samePostAcceptanceCursor(lock?.scanCursors?.[status], previous)) return null;
                const fresh = await tx.get(doc.ref);
                if (!ownsPostAcceptanceLease(lock, ownerId)) return null;
                await recoveryCommit({refs: [(lockRef).path]});
    tx.update(lockRef, {[`scanCursors.${status}`]: next,
                  'scanLease.lockedUntil': Timestamp.fromMillis(Date.now() + POST_ACCEPTANCE_SCAN_LEASE_MS),
                  lastRowObservation: {status, sourceId: doc.id, sourceVersion: fresh.updateTime ?? null,
                    observedAt: Timestamp.now(), result: 'review_error_next_cycle', effectConfirmed: false}});
                return 'review_error_next_cycle';
              });
            }
            if (outcome === null) return;
            stats.inspected++;
            if (outcome === 'observed') stats.observed++;
            else if (outcome === 'already_recorded') stats.alreadyRecorded++;
            else if (outcome === 'unknown') stats.unknown++;
            else if (outcome !== 'review_error_next_cycle') stats.skipped++;
            cursor = next;
          }
          if (pageFinished && (page.size < POST_ACCEPTANCE_SCAN_PAGE_SIZE || cursor.lastId === cursor.untilId)) {
            const completed = {...cursor, completedAt: Timestamp.now()}, previous = cursor;
            await db.runTransaction(async tx => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
              const lock = (await tx.get(lockRef)).data();
              if (ownsPostAcceptanceLease(lock, ownerId) && samePostAcceptanceCursor(lock?.scanCursors?.[status], previous))
                { await recoveryCommit({refs: [(lockRef).path]}); tx.update(lockRef, {[`scanCursors.${status}`]: completed}); }
            });
          }
        }
      } finally {
        await db.runTransaction(async tx => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
          if ((await tx.get(lockRef)).data()?.scanLease?.ownerId !== ownerId) return;
          await recoveryCommit({refs: [(lockRef).path]});
    tx.update(lockRef, {'scanLease.lockedUntil': Timestamp.fromMillis(0), 'scanLease.releasedAt': Timestamp.now()});
        });
      }
      logger.info('[expireStalePostAcceptanceSwaps] documentary run complete', {...stats,
        maxRows: POST_ACCEPTANCE_SCAN_PAGE_SIZE * POST_ACCEPTANCE_STALE_STATUSES.length,
        physicalState: 'unknown', financialState: 'unknown', automaticExpiryAuthorized: false, globalCoverage: false });
    } catch (error) {
      if (error instanceof FinancialRecoveryBlocked) throw error;
      logger.error('[expireStalePostAcceptanceSwaps] Error detecting post-acceptance progression reviews', {
        error: error instanceof Error ? error.message : error,
      });
    }

    });
  }
);

/** I04: operational follow-up only. Five days is not a legal holding limit. */
const DISPUTE_AGING_THRESHOLD_MS = HOLD_OPERATIONAL_AGING_THRESHOLD_MS;
const MAX_AGING_PER_COLLECTION = 300;
const AGING_SCAN_LEASE_MS = 10 * 60 * 1000;
type AgingCursor = {schemaVersion: 2; source: HoldSource; cycleId: string; startedAt: Timestamp;
  untilId: string | null; lastId: string | null; completedAt: Timestamp | null};
const agingId = (v: unknown): v is string => typeof v === 'string' && !!v && !v.includes('/') &&
  v !== '.' && v !== '..' && Buffer.byteLength(v, 'utf8') <= 1500;
function agingCursor(raw: any, source: HoldSource): AgingCursor | null {
  if (raw?.schemaVersion !== 2 || raw.source !== source || typeof raw.cycleId !== 'string' || !raw.cycleId ||
      !(raw.startedAt instanceof Timestamp) || raw.startedAt.toMillis() > Date.now() || raw.startedAt.toMillis() < 0 ||
      !agingId(raw.untilId) || raw.completedAt !== null ||
      raw.lastId !== null && (!agingId(raw.lastId) || Buffer.compare(Buffer.from(raw.lastId), Buffer.from(raw.untilId)) > 0)) return null;
  return raw as AgingCursor;
}
function ownsAgingLease(data: FirebaseFirestore.DocumentData | undefined, ownerId: string) {
  return data?.scanLease?.schemaVersion === 1 && data.scanLease.ownerId === ownerId &&
    data.scanLease.lockedUntil instanceof Timestamp && data.scanLease.lockedUntil.toMillis() > Date.now();
}
async function scanAgingDisputes(source: HoldSource) {
  const lockRef = db.collection('job_locks').doc(`alertAgingDisputes_${source}_cursor`), ownerId = randomUUID();
  const acquired = await db.runTransaction(async tx => {
    const data = (await tx.get(lockRef)).data(), lease = data?.scanLease;
    if (lease != null && (lease.schemaVersion !== 1 || typeof lease.ownerId !== 'string' || !lease.ownerId ||
        !(lease.lockedUntil instanceof Timestamp))) throw new Error('Dispute scan lease needs reconciliation.');
    if (lease?.lockedUntil.toMillis() > Date.now()) return null;
    tx.set(lockRef, {scanLease: {schemaVersion: 1, ownerId, lockedAt: Timestamp.now(),
      lockedUntil: Timestamp.fromMillis(Date.now() + AGING_SCAN_LEASE_MS)}}, {merge: true});
    return {checkpoint: data?.scanCursor};
  });
  if (!acquired) return {inspected: 0, alerted: 0, leaseBusy: true};
  let inspected = 0, alerted = 0;
  try {
    let cursor = agingCursor(acquired.checkpoint, source);
    if (!cursor) {
      const startedAt = Timestamp.now();
      const tail = await db.collection(source).where('status', '==', 'disputed').orderBy('__name__', 'desc').limit(1).get();
      cursor = {schemaVersion: 2, source, cycleId: randomUUID(), startedAt, untilId: tail.docs[0]?.id ?? null,
        lastId: null, completedAt: tail.empty ? Timestamp.now() : null};
      const initialCursor = cursor;
      const saved = await db.runTransaction(async tx => {
        const data = (await tx.get(lockRef)).data();
        if (!ownsAgingLease(data, ownerId)) return false;
        tx.update(lockRef, {scanCursor: initialCursor,
          ...(acquired.checkpoint !== undefined && data?.legacyScanCursor === undefined &&
            (acquired.checkpoint == null || acquired.checkpoint.schemaVersion !== 2) ? {legacyScanCursor: acquired.checkpoint} : {})});
        return true;
      });
      if (!saved) return {inspected, alerted, leaseBusy: true};
    }
    if (cursor.untilId === null) return {inspected, alerted, leaseBusy: false};
    // No date filter: an unknown native dispute date is itself a durable review.
    // The ID upper bound freezes the traversal scope, not the business state.
    let query = db.collection(source).where('status', '==', 'disputed').orderBy('__name__', 'asc')
      .endAt(cursor.untilId).limit(MAX_AGING_PER_COLLECTION);
    if (cursor.lastId) query = query.startAfter(cursor.lastId);
    const page = await query.get();
    for (const doc of page.docs) {
      const nextCursor: AgingCursor = {...cursor, lastId: doc.id};
      const outcome = await db.runTransaction(async tx => {
        if (!ownsAgingLease((await tx.get(lockRef)).data(), ownerId)) return null;
        const fresh = await tx.get(doc.ref), data = fresh.data(), observedAt = Timestamp.now();
        let review: Awaited<ReturnType<typeof prepareHoldReview>> | null = null;
        let result = 'source_changed';
        if (data?.status === 'disputed') {
          const opened = source === 'swaps' ? data.disputeOpenedAt : data.disputedAt;
          const ms = opened instanceof Timestamp ? opened.toMillis() : NaN;
          const openedAtMs = Number.isFinite(ms) && ms >= 0 && ms <= observedAt.toMillis() ? ms : null;
          const exceeded = openedAtMs === null ? null : observedAt.toMillis() - openedAtMs >= DISPUTE_AGING_THRESHOLD_MS;
          if (exceeded !== false) {
            review = await prepareHoldReview(tx, source, fresh, openedAtMs === null ? 'dispute_date_unqualified' : 'commercial_dispute',
              observedAt, {openedAtMs, thresholdMs: DISPUTE_AGING_THRESHOLD_MS, exceeded});
            result = 'review_recorded';
          } else result = 'threshold_not_reached';
        }
        // A failed review/alert commit leaves the preceding cursor intact.
        // An expired runner cannot checkpoint or release its successor's lease.
        review?.commit();
        tx.update(lockRef, {scanCursor: nextCursor, 'scanLease.lockedUntil': Timestamp.fromMillis(Date.now() + AGING_SCAN_LEASE_MS),
          lastRowObservation: {sourceId: doc.id, sourceVersion: fresh.updateTime ?? null, observedAt, result,
            holdObservationId: review?.observationId ?? null}});
        return {newAlert: review?.newAlert === true};
      });
      if (!outcome) return {inspected, alerted, leaseBusy: true};
      inspected++;
      if (outcome.newAlert) alerted++;
      cursor = nextCursor;
    }
    if (page.size < MAX_AGING_PER_COLLECTION || cursor.lastId === cursor.untilId) {
      const completed = {...cursor, completedAt: Timestamp.now()};
      await db.runTransaction(async tx => {
        if (ownsAgingLease((await tx.get(lockRef)).data(), ownerId)) tx.update(lockRef, {scanCursor: completed});
      });
    }
    return {inspected, alerted, leaseBusy: false};
  } finally {
    await db.runTransaction(async tx => {
      if ((await tx.get(lockRef)).data()?.scanLease?.ownerId !== ownerId) return;
      tx.update(lockRef, {'scanLease.lockedUntil': Timestamp.fromMillis(0), 'scanLease.releasedAt': Timestamp.now()});
    });
  }
}

export const alertAgingDisputes = onSchedule(
  {schedule: 'every 6 hours', region: 'northamerica-northeast1', memory: '512MiB'},
  async () => {
    return withFinancialRecoveryScope({operation: "scheduled/swaps.alertAgingDisputes"}, async () => {
    // Each collection owns its checkpoint: failure in one does not reset the other.
    for (const source of ['swaps', 'transactions'] as const) {
      try {
        logger.info('[alertAgingDisputes] bounded scan complete', {source, ...await scanAgingDisputes(source),
          limit: MAX_AGING_PER_COLLECTION, globalCoverage: false});
      } catch (error) {
      if (error instanceof FinancialRecoveryBlocked) throw error;
        logger.error('[alertAgingDisputes] row retained for retry', {source, error: error instanceof Error ? error.message : error});
      }
    }

    });
  }
);
