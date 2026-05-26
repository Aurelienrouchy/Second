"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.consolidateChatDuplicates = void 0;
/**
 * Chat callable functions
 * Firebase Functions v7 — onCall
 */
const https_1 = require("firebase-functions/v2/https");
const firebase_1 = require("../config/firebase");
// =============================================================================
// CONSOLIDATE CHAT DUPLICATES — One-shot migration
// =============================================================================
/**
 * Consolidates legacy duplicate chat documents created with auto-IDs
 * into a single deterministic chat per pair of participants.
 *
 * Why this exists: before the deterministic-ID fix, two simultaneous
 * taps (push notification + article page) could both addDoc a fresh
 * chat. The same pair ended up with several threads, none of which the
 * UI could merge.
 *
 * What it does for each pair (max `dryRunLimit` pairs per call):
 *   1. Find every chat doc whose `participants` array equals the pair.
 *   2. Pick the canonical doc — the deterministic ID `${minUid}__${maxUid}`
 *      if it already exists, otherwise the most-recently-updated chat.
 *   3. For every other ("loser") chat:
 *        - Re-write its messages so chatId = canonicalId.
 *        - Recompute unreadCount on the canonical doc.
 *        - Delete the loser chat doc.
 *
 * Authorization: callable by an admin only (request.auth.token.admin).
 * Idempotent: re-running has no effect once each pair is single-doc.
 *
 * Usage from a privileged client / admin tool:
 *   const fn = httpsCallable(functions, 'consolidateChatDuplicates');
 *   await fn({ dryRun: true, maxPairs: 50 });
 */
exports.consolidateChatDuplicates = (0, https_1.onCall)({ region: 'northamerica-northeast1', memory: '1GiB', timeoutSeconds: 540 }, async (request) => {
    var _a, _b;
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'Sign-in required');
    }
    if (request.auth.token.admin !== true) {
        throw new https_1.HttpsError('permission-denied', 'Admin only');
    }
    const dryRun = ((_a = request.data) === null || _a === void 0 ? void 0 : _a.dryRun) !== false;
    const maxPairs = typeof ((_b = request.data) === null || _b === void 0 ? void 0 : _b.maxPairs) === 'number' ? request.data.maxPairs : 200;
    const summary = {
        pairsScanned: 0,
        pairsWithDuplicates: 0,
        messagesMoved: 0,
        chatsDeleted: 0,
        dryRun,
        examples: [],
    };
    // 1. Group all chats by their (sorted) participants pair.
    const allChats = await firebase_1.db.collection('chats').get();
    const byPair = new Map();
    for (const docSnap of allChats.docs) {
        const data = docSnap.data();
        const participants = (data.participants || []);
        if (participants.length !== 2)
            continue;
        const sorted = [...participants].sort();
        const key = `${sorted[0]}__${sorted[1]}`;
        if (!byPair.has(key))
            byPair.set(key, []);
        byPair.get(key).push(docSnap);
    }
    summary.pairsScanned = byPair.size;
    // 2. Process each pair that has more than one chat.
    let processed = 0;
    for (const [canonicalId, chats] of byPair.entries()) {
        if (chats.length < 2)
            continue;
        summary.pairsWithDuplicates++;
        if (processed >= maxPairs)
            continue;
        processed++;
        // Choose canonical: existing doc with deterministic ID wins;
        // otherwise the most-recently-updated chat in the group.
        const canonicalCandidate = chats.find((c) => c.id === canonicalId) ||
            [...chats].sort((a, b) => {
                var _a, _b, _c, _d, _e, _f;
                const at = (_c = (_b = (_a = a.data().updatedAt) === null || _a === void 0 ? void 0 : _a.toMillis) === null || _b === void 0 ? void 0 : _b.call(_a)) !== null && _c !== void 0 ? _c : 0;
                const bt = (_f = (_e = (_d = b.data().updatedAt) === null || _d === void 0 ? void 0 : _d.toMillis) === null || _e === void 0 ? void 0 : _e.call(_d)) !== null && _f !== void 0 ? _f : 0;
                return bt - at;
            })[0];
        const losers = chats.filter((c) => c.id !== canonicalCandidate.id);
        let movedMessagesForPair = 0;
        // 3a. Move messages from each loser to the canonical chat.
        for (const loser of losers) {
            const messagesQuery = await firebase_1.db
                .collection('messages')
                .where('chatId', '==', loser.id)
                .get();
            if (!dryRun && !messagesQuery.empty) {
                // writeBatch caps at 500 ops; chunk if needed.
                const docs = messagesQuery.docs;
                for (let i = 0; i < docs.length; i += 400) {
                    const batch = firebase_1.db.batch();
                    for (const m of docs.slice(i, i + 400)) {
                        batch.update(m.ref, { chatId: canonicalCandidate.id });
                    }
                    await batch.commit();
                }
            }
            movedMessagesForPair += messagesQuery.size;
            // 3b. Delete the loser chat doc.
            if (!dryRun) {
                await loser.ref.delete();
            }
            summary.chatsDeleted++;
        }
        summary.messagesMoved += movedMessagesForPair;
        // 3c. If the canonical lives at a non-deterministic ID (no
        // canonical doc existed), recreate it at the deterministic
        // address so future client lookups hit the fast path.
        if (!dryRun && canonicalCandidate.id !== canonicalId) {
            const targetRef = firebase_1.db.collection('chats').doc(canonicalId);
            const targetSnap = await targetRef.get();
            if (!targetSnap.exists) {
                await targetRef.set(Object.assign(Object.assign({}, canonicalCandidate.data()), { updatedAt: firebase_1.FieldValue.serverTimestamp() }));
                // Re-point messages from the auto-ID canonical to the new
                // deterministic doc as well.
                const ownMsgs = await firebase_1.db
                    .collection('messages')
                    .where('chatId', '==', canonicalCandidate.id)
                    .get();
                for (let i = 0; i < ownMsgs.docs.length; i += 400) {
                    const batch = firebase_1.db.batch();
                    for (const m of ownMsgs.docs.slice(i, i + 400)) {
                        batch.update(m.ref, { chatId: canonicalId });
                    }
                    await batch.commit();
                }
                await canonicalCandidate.ref.delete();
                summary.chatsDeleted++;
            }
        }
        if (summary.examples.length < 5) {
            summary.examples.push({
                canonicalId,
                loserIds: losers.map((l) => l.id),
                movedMessages: movedMessagesForPair,
            });
        }
    }
    return summary;
});
//# sourceMappingURL=chats.js.map