"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.retentionPurge = void 0;
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
const scheduler_1 = require("firebase-functions/v2/scheduler");
const logger = __importStar(require("firebase-functions/logger"));
const firebase_1 = require("../config/firebase");
const firestore_1 = require("firebase-admin/firestore");
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
async function deleteByQuery(buildQuery, label) {
    const bulkWriter = firebase_1.db.bulkWriter();
    let deleted = 0;
    let lastDoc = null;
    const PAGE = 500;
    while (deleted < MAX_PER_TARGET) {
        let q = buildQuery().limit(PAGE);
        if (lastDoc)
            q = q.startAfter(lastDoc);
        const snap = await q.get();
        if (snap.empty)
            break;
        for (const d of snap.docs) {
            bulkWriter.delete(d.ref);
            deleted++;
            if (deleted >= MAX_PER_TARGET)
                break;
        }
        lastDoc = snap.docs[snap.docs.length - 1];
        if (snap.size < PAGE)
            break;
    }
    await bulkWriter.close();
    logger.info(`[retentionPurge] ${label}: ${deleted} doc(s) purged`);
    return deleted;
}
exports.retentionPurge = (0, scheduler_1.onSchedule)({
    schedule: 'every 24 hours',
    timeZone: 'America/Toronto',
    region: REGION,
    memory: '512MiB',
    timeoutSeconds: 540,
}, async () => {
    const now = Date.now();
    const summary = {};
    // 1. Inactive articles older than 3 years (isActive === false + updatedAt cutoff).
    //    Uses the composite index (isActive ASC, updatedAt ASC).
    try {
        const cutoff = firestore_1.Timestamp.fromMillis(now - ARTICLE_INACTIVE_MS);
        summary.articles = await deleteByQuery(() => firebase_1.db
            .collection('articles')
            .where('isActive', '==', false)
            .where('updatedAt', '<', cutoff)
            .orderBy('updatedAt', 'asc'), 'articles (inactive > 3y)');
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        logger.error('[retentionPurge] articles purge failed', { error: message });
        summary.articles = 'error';
    }
    // 2. Guest preferences older than 90 days.
    try {
        const cutoff = firestore_1.Timestamp.fromMillis(now - GUEST_PREFS_MS);
        summary.guest_preferences = await deleteByQuery(() => firebase_1.db
            .collection('guest_preferences')
            .where('createdAt', '<', cutoff)
            .orderBy('createdAt', 'asc'), 'guest_preferences (> 90d)');
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        logger.error('[retentionPurge] guest_preferences purge failed', { error: message });
        summary.guest_preferences = 'error';
    }
    // 3. Notifications older than 180 days.
    try {
        const cutoff = firestore_1.Timestamp.fromMillis(now - NOTIFICATIONS_MS);
        summary.notifications = await deleteByQuery(() => firebase_1.db
            .collection('notifications')
            .where('createdAt', '<', cutoff)
            .orderBy('createdAt', 'asc'), 'notifications (> 180d)');
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        logger.error('[retentionPurge] notifications purge failed', { error: message });
        summary.notifications = 'error';
    }
    // 4. Search history entries older than 12 months — collection-group query
    //    across all users/{uid}/searchHistory (uses the COLLECTION_GROUP index
    //    on `timestamp`).
    try {
        const cutoff = firestore_1.Timestamp.fromMillis(now - SEARCH_HISTORY_MS);
        summary.searchHistory = await deleteByQuery(() => firebase_1.db
            .collectionGroup('searchHistory')
            .where('timestamp', '<', cutoff)
            .orderBy('timestamp', 'asc'), 'searchHistory (> 12mo)');
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        logger.error('[retentionPurge] searchHistory purge failed', { error: message });
        summary.searchHistory = 'error';
    }
    // 5. Abandoned sell-flow drafts older than 90 days (by last modification).
    //    `updatedAt` is the staleness signal: a draft untouched for 90 days is
    //    considered abandoned. Uses the single-field index on `updatedAt`.
    try {
        const cutoff = firestore_1.Timestamp.fromMillis(now - DRAFTS_MS);
        summary.drafts = await deleteByQuery(() => firebase_1.db
            .collection('drafts')
            .where('updatedAt', '<', cutoff)
            .orderBy('updatedAt', 'asc'), 'drafts (> 90d)');
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        logger.error('[retentionPurge] drafts purge failed', { error: message });
        summary.drafts = 'error';
    }
    logger.info('[retentionPurge] run complete', summary);
});
//# sourceMappingURL=retentionPurge.js.map