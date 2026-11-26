/**
 * Scheduled inspection of operational data-retention candidates
 * Firebase Functions v2 — region northamerica-northeast1
 *
 * Operational age candidates, not a finding that legal retention has ended.
 * No disposal policy is qualified: every present candidate is conserved.
 * A privacy request is an additional preservation reason, never permission to
 * erase when absent. Contractual, evidentiary and legal obligations are unknown.
 *
 * INSPECTION TARGETS & OPERATIONAL AGE THRESHOLDS:
 *   1. inactive articles last updated more than 3 years ago
 *   2. guest_preferences created more than 90 days ago
 *   3. notifications created more than 180 days ago
 *   4. users/{uid}/searchHistory entries older than 12 months
 *   5. drafts last updated more than 90 days ago
 *
 * NEVER TOUCHES `transactions`; their retention requires a separate policy.
 *
 * Idempotency & safety:
 *   - Guard, native ownership and current age are inspected in one read-only
 *     transaction. No new erasure is authorized by this job.
 *   - Per-collection per-run cap bounds inspection, without claiming the retained
 *     backlog has drained or that later runs cover every document.
 *   - Each target is wrapped in its own try/catch so one failing target does not
 *     abort the others. Counts are logged per target.
 */
import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as logger from 'firebase-functions/logger';
import { db } from '../config/firebase';
import { Timestamp } from 'firebase-admin/firestore';
import {privacyRetentionDecision, type PrivacyCategory} from '../utils/privacyRetention';
import {randomUUID} from 'node:crypto';
import {SUPPORT_COLLECTION, supportDeadlineItem} from '../utils/supportRequest';
import {readSupportBankDeadlineItem} from '../utils/supportBankDeadline';
import {recordSupportDeadlineAlert} from '../utils/supportDeadlineNotices';

const REGION = 'northamerica-northeast1';

/** Per-collection inspection cap per run. Retained candidates are not drained. */
const MAX_PER_TARGET = 2000;
const SUPPORT_MONITOR_PAGE_SIZE = 200;
const SUPPORT_MONITOR_LEASE_MS = 10 * 60_000;
const SUPPORT_MONITOR_PROTOCOL = 'support_deadline_monitor_v1';
type SupportMonitorCounts = {inspected: number; privacy: number; dated: number; unknown: number;
  overdue: number; dueToday: number; pending: number; responseRecorded: number};
const emptySupportMonitorCounts = (): SupportMonitorCounts => ({inspected: 0, privacy: 0, dated: 0, unknown: 0,
  overdue: 0, dueToday: 0, pending: 0, responseRecorded: 0});
type SupportMonitorPass = {protocol: typeof SUPPORT_MONITOR_PROTOCOL; cycleId: string; passNumber: number;
  startedAt: Timestamp; untilId: string | null; lastId: string | null; completedAt: Timestamp | null; counts: SupportMonitorCounts};
const monitorId = (v: unknown): v is string => typeof v === 'string' && !!v && !v.includes('/') &&
  !['.', '..'].includes(v) && Buffer.byteLength(v, 'utf8') <= 1500;
const monitorTime = (v: unknown): v is Timestamp => v instanceof Timestamp && v.toMillis() >= 0 && v.toMillis() <= Date.now();
function supportMonitorPass(raw: any): SupportMonitorPass | null {
  if (raw == null) return null;
  const counts = emptySupportMonitorCounts();
  if (raw.protocol !== SUPPORT_MONITOR_PROTOCOL || typeof raw.cycleId !== 'string' || !raw.cycleId ||
      !Number.isSafeInteger(raw.passNumber) || raw.passNumber < 1 || !monitorTime(raw.startedAt) ||
      raw.untilId !== null && !monitorId(raw.untilId) || raw.lastId !== null && (!monitorId(raw.lastId) ||
        raw.untilId === null || Buffer.compare(Buffer.from(raw.lastId), Buffer.from(raw.untilId)) > 0) ||
      raw.completedAt !== null && (!monitorTime(raw.completedAt) || raw.completedAt.toMillis() < raw.startedAt.toMillis()) ||
      !raw.counts || Object.keys(raw.counts).length !== Object.keys(counts).length ||
      Object.keys(counts).some(k => !Number.isSafeInteger(raw.counts[k]) || raw.counts[k] < 0) ||
      raw.counts.privacy !== raw.counts.dated + raw.counts.unknown || raw.counts.inspected < raw.counts.privacy ||
      raw.counts.responseRecorded > raw.counts.privacy ||
      raw.counts.dated !== raw.counts.overdue + raw.counts.dueToday + raw.counts.pending) {
    throw new Error('Support deadline monitor checkpoint requires reconciliation.');
  }
  return raw as SupportMonitorPass;
}
/** The bounded pass is not a global snapshot or legal completion. Alert and
 * notice failures leave the source page eligible for the next existing run. */
export async function scanSupportDeadlineMonitor(bank = false) {
  const collection = bank ? 'bank_dispute_cases' : SUPPORT_COLLECTION;
  const ref = db.collection('job_locks').doc(bank ? 'bank_deadline_monitor_cursor' : 'support_deadline_monitor_cursor'), ownerId = randomUUID();
  const acquired = await db.runTransaction(async tx => {
    const data = (await tx.get(ref)).data(), lease = data?.scanLease;
    if (lease != null && (lease.protocol !== SUPPORT_MONITOR_PROTOCOL || typeof lease.ownerId !== 'string' ||
        !lease.ownerId || !(lease.lockedUntil instanceof Timestamp))) throw new Error('Support deadline monitor lease requires reconciliation.');
    if (lease?.lockedUntil.toMillis() > Date.now()) return null;
    let pass = supportMonitorPass(data?.scanPass);
    if (!pass || pass.completedAt !== null) {
      if (pass?.passNumber === Number.MAX_SAFE_INTEGER) throw new Error('Support deadline monitor pass counter requires reconciliation.');
      const upper = await tx.get(db.collection(collection).orderBy('__name__', 'desc').limit(1));
      pass = {protocol: SUPPORT_MONITOR_PROTOCOL, cycleId: randomUUID(), passNumber: (pass?.passNumber ?? 0) + 1,
        startedAt: Timestamp.now(), untilId: upper.docs[0]?.id ?? null, lastId: null,
        completedAt: upper.empty ? Timestamp.now() : null, counts: emptySupportMonitorCounts()};
    }
    tx.set(ref, {scanPass: pass, scanLease: {protocol: SUPPORT_MONITOR_PROTOCOL, ownerId,
      lockedUntil: Timestamp.fromMillis(Date.now() + SUPPORT_MONITOR_LEASE_MS)}}, {merge: true});
    return pass;
  });
  if (!acquired) return {...emptySupportMonitorCounts(), passNumber: null, boundedPassCompleted: false,
    hasContinuation: true, leaseBusy: true, globalCoverage: false, deadlineExtended: false, deleted: 0};
  let pass = acquired;
  const run = emptySupportMonitorCounts();
  try {
    while (pass.completedAt === null && run.inspected < MAX_PER_TARGET) {
      const previous = pass;
      const result = await db.runTransaction(async tx => {
        const data = (await tx.get(ref)).data(), lease = data?.scanLease, current = supportMonitorPass(data?.scanPass);
        if (lease?.ownerId !== ownerId || !(lease.lockedUntil instanceof Timestamp) || lease.lockedUntil.toMillis() <= Date.now() ||
            !current || current.cycleId !== previous.cycleId || current.lastId !== previous.lastId ||
            current.untilId !== previous.untilId || current.completedAt !== null || current.counts.inspected !== previous.counts.inspected) {
          throw new Error('Support deadline monitor checkpoint changed.');
        }
        const limit = Math.min(SUPPORT_MONITOR_PAGE_SIZE, MAX_PER_TARGET - run.inspected);
        let query = db.collection(collection).where('__name__', '<=', current.untilId!).orderBy('__name__', 'asc').limit(limit);
        if (current.lastId) query = query.startAfter(current.lastId);
        const page = await tx.get(query), pageCounts = emptySupportMonitorCounts(), nowMs = Date.now();
        pageCounts.inspected = page.size;
        for (const row of page.docs) {
          const item = bank ? await readSupportBankDeadlineItem(tx, row, nowMs) : supportDeadlineItem(row, nowMs);
          if (!item) continue;
          pageCounts.privacy++;
          if (item.responseRecorded) pageCounts.responseRecorded++;
          if (item.clock.qualification === 'unknown') pageCounts.unknown++;
          else {
            pageCounts.dated++;
            if (item.clock.state === 'overdue') pageCounts.overdue++;
            else if (item.clock.state === 'due_today') pageCounts.dueToday++;
            else pageCounts.pending++;
          }
        }
        const lastId = page.docs.at(-1)?.id ?? current.lastId;
        const completed = page.size < limit || lastId === current.untilId;
        const counts = Object.fromEntries(Object.entries(current.counts).map(([k, n]) =>
          [k, n + pageCounts[k as keyof SupportMonitorCounts]])) as SupportMonitorCounts;
        if (Object.values(counts).some(n => !Number.isSafeInteger(n))) throw new Error('Support deadline monitor counters require reconciliation.');
        const next = {...current, lastId, counts, completedAt: completed ? Timestamp.now() : null};
        return {next, pageCounts, ids: page.docs.map(row => row.id)};
      });
      for (const id of result.ids) {
        if (!await recordSupportDeadlineAlert(id, previous.cycleId, ref, ownerId, bank)) {
          return {...run, passNumber: pass.passNumber, boundedPassCompleted: false, hasContinuation: true, leaseBusy: false,
            globalCoverage: false, deadlineExtended: false, deleted: 0};
        }
      }
      await db.runTransaction(async tx => {
        const data = (await tx.get(ref)).data(), lease = data?.scanLease, current = supportMonitorPass(data?.scanPass);
        if (lease?.ownerId !== ownerId || !(lease.lockedUntil instanceof Timestamp) || lease.lockedUntil.toMillis() <= Date.now() ||
            !current || current.cycleId !== previous.cycleId || current.lastId !== previous.lastId ||
            current.untilId !== previous.untilId || current.counts.inspected !== previous.counts.inspected) {
          throw new Error('Support deadline monitor checkpoint changed.');
        }
        tx.set(ref, {scanPass: result.next, scanLease: {protocol: SUPPORT_MONITOR_PROTOCOL, ownerId,
          lockedUntil: Timestamp.fromMillis(Date.now() + SUPPORT_MONITOR_LEASE_MS)}}, {merge: true});
      });
      pass = result.next;
      for (const k of Object.keys(run) as (keyof SupportMonitorCounts)[]) run[k] += result.pageCounts[k];
    }
    return {...run, passNumber: pass.passNumber, boundedPassCompleted: pass.completedAt !== null,
      hasContinuation: pass.completedAt === null, leaseBusy: false, globalCoverage: false, deadlineExtended: false, deleted: 0};
  } finally {
    await db.runTransaction(async tx => {
      if ((await tx.get(ref)).data()?.scanLease?.ownerId !== ownerId) return;
      tx.update(ref, {'scanLease.lockedUntil': Timestamp.fromMillis(0)});
    });
  }
}

/** Operational candidate ages in milliseconds; these are not disposal policies. */
const DAY_MS = 24 * 60 * 60 * 1000;
const ARTICLE_INACTIVE_MS = 3 * 365 * DAY_MS; // ~3 years
const GUEST_PREFS_MS = 90 * DAY_MS; // 90 days
const NOTIFICATIONS_MS = 180 * DAY_MS; // 180 days
const SEARCH_HISTORY_MS = 365 * DAY_MS; // 12 months
const DRAFTS_MS = 90 * DAY_MS; // 90 days (abandoned sell-flow drafts)

/**
 * The query identifies candidates only. Even a known owner, old timestamp and
 * absent privacy request do not qualify the end of retention. Keep the bounded
 * native inspection but perform no write or erasure.
 */
async function inspectByQuery(
  buildQuery: () => FirebaseFirestore.Query,
  label: string,
  target: {category: PrivacyCategory; cutoff: Timestamp; clock: string;
    owner: (row: FirebaseFirestore.DocumentSnapshot) => string | null;
    stillMatches?: (data: FirebaseFirestore.DocumentData) => boolean},
) {
  let inspected = 0, retained = 0, absent = 0;
  let sourceUnqualified = 0, privacyRequestBlocked = 0, dispositionUnqualified = 0;
  let lastDoc: FirebaseFirestore.QueryDocumentSnapshot | null = null;
  const PAGE = 100;

  while (inspected < MAX_PER_TARGET) {
    let q = buildQuery().limit(Math.min(PAGE, MAX_PER_TARGET - inspected));
    if (lastDoc) q = q.startAfter(lastDoc);
    const snap = await q.get();
    if (snap.empty) break;

    for (let offset = 0; offset < snap.docs.length; offset += 8) {
      const results = await Promise.all(snap.docs.slice(offset, offset + 8).map(d => db.runTransaction(async tx => {
        const current = await tx.get(d.ref), data = current.data();
        if (!data) return 'absent';
        const ownerId = target.owner(current), clock = data[target.clock];
        // Unknown subject association or chronology never qualifies disposal.
        if (!ownerId || !(clock instanceof Timestamp) || clock.toMillis() <= 0 ||
            clock.toMillis() >= target.cutoff.toMillis() || target.stillMatches && !target.stillMatches(data)) return 'source_unqualified';
        const preservation = await privacyRetentionDecision(tx, ownerId, {category: target.category, id: current.id});
        if (preservation.qualification === 'native_preservation' && preservation.blocked) return 'privacy_request_preservation';
        if (preservation.qualification !== 'no_targeted_preservation' || preservation.blocked) return 'source_unqualified';
        // Absence of a written preservation request is not a disposal decision.
        // In particular, linked orders, tickets and evidence have not been
        // exhaustively qualified here. No age-based erasure may proceed.
        return 'disposition_policy_unqualified';
      })));
      inspected += results.length;
      absent += results.filter(result => result === 'absent').length;
      retained += results.filter(result => result !== 'absent').length;
      sourceUnqualified += results.filter(result => result === 'source_unqualified').length;
      privacyRequestBlocked += results.filter(result => result === 'privacy_request_preservation').length;
      dispositionUnqualified += results.filter(result => result === 'disposition_policy_unqualified').length;
    }
    lastDoc = snap.docs[snap.docs.length - 1];
    if (snap.size < PAGE) break;
  }

  const result = {inspected, retained, absent, sourceUnqualified, privacyRequestBlocked, dispositionUnqualified, deleted: 0,
    disposalPolicyQualified: false, legalExpiryEstablished: false, exhaustiveCoverageVerified: false};
  logger.info('[retentionPurge] target inspected', {target: label, ...result});
  return result;
}

export const retentionPurge = onSchedule(
  {
    schedule: 'every 24 hours',
    timeZone: 'America/Toronto',
    region: REGION,
    memory: '512MiB',
    timeoutSeconds: 540,
  },
  async () => {
    const now = Date.now();
    const summary: Record<string, Awaited<ReturnType<typeof inspectByQuery>> | Awaited<ReturnType<typeof scanSupportDeadlineMonitor>> | {bankCases: number; inspected: number} | string> = {};

    // Keep this independent of erasure candidates and financial maintenance.
    // An ordinary recorded response never proves a privacy obligation ended.
    try {
      summary.supportDeadlines = await scanSupportDeadlineMonitor();
      logger.info('[retentionPurge] support deadline inspection', summary.supportDeadlines);
    } catch {
      summary.supportDeadlines = 'error';
      logger.error('[retentionPurge] support deadline inspection failed', {resumeCheckpointRetained: true, globalCoverage: false});
    }

    try {
      const {privacy: bankCases, ...coverage} = await scanSupportDeadlineMonitor(true);
      summary.bankDeadlines = {...coverage, bankCases};
      logger.info('[retentionPurge] recorded bank deadline inspection', summary.bankDeadlines);
    } catch {
      summary.bankDeadlines = 'error';
      logger.error('[retentionPurge] bank deadline inspection failed', {resumeCheckpointRetained: true, currentProviderStateVerified: false});
    }

    // 1. Inactive articles older than 3 years (isActive === false + updatedAt cutoff).
    //    Uses the composite index (isActive ASC, updatedAt ASC).
    try {
      const cutoff = Timestamp.fromMillis(now - ARTICLE_INACTIVE_MS);
      summary.articles = await inspectByQuery(
        () =>
          db
            .collection('articles')
            .where('isActive', '==', false)
            .where('updatedAt', '<', cutoff)
            .orderBy('updatedAt', 'asc'),
        'articles (inactive > 3y)',
        {category: 'articles', cutoff, clock: 'updatedAt', owner: row => row.data()?.sellerId ?? null,
          stillMatches: data => data.isActive === false},
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('[retentionPurge] articles inspection failed', { error: message });
      summary.articles = 'error';
    }

    // 2. Guest preferences older than 90 days.
    try {
      const cutoff = Timestamp.fromMillis(now - GUEST_PREFS_MS);
      summary.guest_preferences = await inspectByQuery(
        () =>
          db
            .collection('guest_preferences')
            .where('createdAt', '<', cutoff)
            .orderBy('createdAt', 'asc'),
        'guest_preferences (> 90d)',
        // Anonymous device IDs are not a qualified native account association.
        {category: 'other_or_unknown', cutoff, clock: 'createdAt', owner: () => null},
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('[retentionPurge] guest_preferences inspection failed', { error: message });
      summary.guest_preferences = 'error';
    }

    // 3. Notifications older than 180 days.
    try {
      const cutoff = Timestamp.fromMillis(now - NOTIFICATIONS_MS);
      summary.notifications = await inspectByQuery(
        () =>
          db
            .collection('notifications')
            .where('createdAt', '<', cutoff)
            .orderBy('createdAt', 'asc'),
        'notifications (> 180d)',
        {category: 'notifications', cutoff, clock: 'createdAt', owner: row => row.data()?.userId ?? null},
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('[retentionPurge] notifications inspection failed', { error: message });
      summary.notifications = 'error';
    }

    // 4. Search history entries older than 12 months — collection-group query
    //    across all users/{uid}/searchHistory (uses the COLLECTION_GROUP index
    //    on `timestamp`).
    try {
      const cutoff = Timestamp.fromMillis(now - SEARCH_HISTORY_MS);
      summary.searchHistory = await inspectByQuery(
        () =>
          db
            .collectionGroup('searchHistory')
            .where('timestamp', '<', cutoff)
            .orderBy('timestamp', 'asc'),
        'searchHistory (> 12mo)',
        {category: 'search_history', cutoff, clock: 'timestamp', owner: row => {
          const owner = row.ref.parent.parent;
          return owner?.parent.path === 'users' ? owner.id : null;
        }},
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('[retentionPurge] searchHistory inspection failed', { error: message });
      summary.searchHistory = 'error';
    }

    // 5. Abandoned sell-flow drafts older than 90 days (by last modification).
    //    `updatedAt` is the staleness signal: a draft untouched for 90 days is
    //    considered abandoned. Uses the single-field index on `updatedAt`.
    try {
      const cutoff = Timestamp.fromMillis(now - DRAFTS_MS);
      summary.drafts = await inspectByQuery(
        () =>
          db
            .collection('drafts')
            .where('updatedAt', '<', cutoff)
            .orderBy('updatedAt', 'asc'),
        'drafts (> 90d)',
        {category: 'drafts', cutoff, clock: 'updatedAt', owner: row => row.data()?.userId ?? null},
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('[retentionPurge] drafts inspection failed', { error: message });
      summary.drafts = 'error';
    }

    logger.info('[retentionPurge] run complete', summary);
  },
);
