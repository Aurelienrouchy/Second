/**
 * Scheduled data-retention purge
 * Firebase Functions v2 — region northamerica-northeast1
 *
 * Loi 25 (Québec) / RGPD data-minimisation: stale personal data is hard-deleted
 * once it is no longer needed. Runs daily.
 *
 * PURGE TARGETS & THRESHOLDS:
 *   1. articles where isActive === false AND updatedAt > 3 years ago  (hard delete)
 *   2. guest_preferences with createdAt > 90 days ago                 (hard delete)
 *   3. notifications with createdAt > 180 days ago                    (hard delete)
 *   4. users/{uid}/searchHistory entries with timestamp > 12 months   (hard delete)
 *   5. drafts with updatedAt > 90 days ago                            (hard delete)
 *
 * NEVER TOUCHES `transactions` (legal retention 7 years — accounting/tax).
 *
 * Idempotency & safety:
 *   - Hard-deletes via BulkWriter (the docs simply won't match next run once gone).
 *   - Per-collection per-run cap so a large backlog drains across successive daily
 *     runs without timing out a single invocation.
 *   - Each target is wrapped in its own try/catch so one failing target does not
 *     abort the others. Counts are logged per target.
 */
import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as logger from 'firebase-functions/logger';
import { db } from '../config/firebase';
import { Timestamp } from 'firebase-admin/firestore';

const REGION = 'northamerica-northeast1';

/** Per-collection cap per run. Backlog drains across successive daily runs. */
const MAX_PER_TARGET = 2000;

/** Retention windows (milliseconds). */
const DAY_MS = 24 * 60 * 60 * 1000;
const ARTICLE_INACTIVE_MS = 3 * 365 * DAY_MS; // ~3 years
const GUEST_PREFS_MS = 90 * DAY_MS; // 90 days
const NOTIFICATIONS_MS = 180 * DAY_MS; // 180 days
const SEARCH_HISTORY_MS = 365 * DAY_MS; // 12 months
const DRAFTS_MS = 90 * DAY_MS; // 90 days (abandoned sell-flow drafts)

/**
 * Delete documents matching a query in capped batches, via BulkWriter.
 * Returns the number of docs deleted. Pure single-collection delete; safe to
 * re-run (already-deleted docs simply won't match).
 */
async function deleteByQuery(
  buildQuery: () => FirebaseFirestore.Query,
  label: string,
): Promise<number> {
  const bulkWriter = db.bulkWriter();
  let deleted = 0;
  let lastDoc: FirebaseFirestore.QueryDocumentSnapshot | null = null;
  const PAGE = 500;

  while (deleted < MAX_PER_TARGET) {
    let q = buildQuery().limit(PAGE);
    if (lastDoc) q = q.startAfter(lastDoc);
    const snap = await q.get();
    if (snap.empty) break;

    for (const d of snap.docs) {
      bulkWriter.delete(d.ref);
      deleted++;
      if (deleted >= MAX_PER_TARGET) break;
    }
    lastDoc = snap.docs[snap.docs.length - 1];
    if (snap.size < PAGE) break;
  }

  await bulkWriter.close();
  logger.info(`[retentionPurge] ${label}: ${deleted} doc(s) purged`);
  return deleted;
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
    const summary: Record<string, number | string> = {};

    // 1. Inactive articles older than 3 years (isActive === false + updatedAt cutoff).
    //    Uses the composite index (isActive ASC, updatedAt ASC).
    try {
      const cutoff = Timestamp.fromMillis(now - ARTICLE_INACTIVE_MS);
      summary.articles = await deleteByQuery(
        () =>
          db
            .collection('articles')
            .where('isActive', '==', false)
            .where('updatedAt', '<', cutoff)
            .orderBy('updatedAt', 'asc'),
        'articles (inactive > 3y)',
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('[retentionPurge] articles purge failed', { error: message });
      summary.articles = 'error';
    }

    // 2. Guest preferences older than 90 days.
    try {
      const cutoff = Timestamp.fromMillis(now - GUEST_PREFS_MS);
      summary.guest_preferences = await deleteByQuery(
        () =>
          db
            .collection('guest_preferences')
            .where('createdAt', '<', cutoff)
            .orderBy('createdAt', 'asc'),
        'guest_preferences (> 90d)',
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('[retentionPurge] guest_preferences purge failed', { error: message });
      summary.guest_preferences = 'error';
    }

    // 3. Notifications older than 180 days.
    try {
      const cutoff = Timestamp.fromMillis(now - NOTIFICATIONS_MS);
      summary.notifications = await deleteByQuery(
        () =>
          db
            .collection('notifications')
            .where('createdAt', '<', cutoff)
            .orderBy('createdAt', 'asc'),
        'notifications (> 180d)',
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('[retentionPurge] notifications purge failed', { error: message });
      summary.notifications = 'error';
    }

    // 4. Search history entries older than 12 months — collection-group query
    //    across all users/{uid}/searchHistory (uses the COLLECTION_GROUP index
    //    on `timestamp`).
    try {
      const cutoff = Timestamp.fromMillis(now - SEARCH_HISTORY_MS);
      summary.searchHistory = await deleteByQuery(
        () =>
          db
            .collectionGroup('searchHistory')
            .where('timestamp', '<', cutoff)
            .orderBy('timestamp', 'asc'),
        'searchHistory (> 12mo)',
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('[retentionPurge] searchHistory purge failed', { error: message });
      summary.searchHistory = 'error';
    }

    // 5. Abandoned sell-flow drafts older than 90 days (by last modification).
    //    `updatedAt` is the staleness signal: a draft untouched for 90 days is
    //    considered abandoned. Uses the single-field index on `updatedAt`.
    try {
      const cutoff = Timestamp.fromMillis(now - DRAFTS_MS);
      summary.drafts = await deleteByQuery(
        () =>
          db
            .collection('drafts')
            .where('updatedAt', '<', cutoff)
            .orderBy('updatedAt', 'asc'),
        'drafts (> 90d)',
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('[retentionPurge] drafts purge failed', { error: message });
      summary.drafts = 'error';
    }

    logger.info('[retentionPurge] run complete', summary);
  },
);
