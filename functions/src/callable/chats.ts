/**
 * Chat callable functions
 * Firebase Functions v7 — onCall
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db, FieldValue } from '../config/firebase';
import {assertPrivateAccountSession,withPrivateAccountSession} from '../utils/privateAccountSession';

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
 * Authorization: current private session and current Auth admin claim.
 * Idempotent: re-running has no effect once each pair is single-doc.
 *
 * Usage from a privileged client / admin tool:
 *   const fn = httpsCallable(functions, 'consolidateChatDuplicates');
 *   await fn({ dryRun: true, maxPairs: 50 });
 */
export const consolidateChatDuplicates = onCall(
  { region: 'northamerica-northeast1', memory: '1GiB', timeoutSeconds: 540 },
  async (request) => withPrivateAccountSession(request, async () => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Sign-in required');
    }
    const admit = async (tx?: FirebaseFirestore.Transaction): Promise<void> => {
      if (!tx) return db.runTransaction(current => admit(current));
      const session = await assertPrivateAccountSession(request,tx);
      if (!session.currentAdminClaim) throw new HttpsError('permission-denied','Admin only');
    };
    await admit();

    const pairOf = (data: FirebaseFirestore.DocumentData): string[]|null => {
      const p=data.participants;
      return Array.isArray(p)&&p.length===2&&p.every(v=>typeof v==='string'&&v&&!v.includes('/'))&&p[0]!==p[1] ? [...p].sort() : null;
    };
    const source = (snap: FirebaseFirestore.DocumentSnapshot, expected: FirebaseFirestore.DocumentData) => {
      const current=snap.data(), pair=current&&pairOf(current), original=pairOf(expected);
      if(!current||!pair||!original||JSON.stringify(pair)!==JSON.stringify(original)||(current.articleId??null)!==(expected.articleId??null))
        throw new HttpsError('failed-precondition','La source de cette conversation a changé. Relancez la consolidation.');
      return current;
    };
    const moveMessages = async (from: FirebaseFirestore.DocumentReference, to: FirebaseFirestore.DocumentReference,
      fromData: FirebaseFirestore.DocumentData, toData: FirebaseFirestore.DocumentData, docs: FirebaseFirestore.QueryDocumentSnapshot[]) => {
      return db.runTransaction(async tx=>{
        await admit(tx);source(await tx.get(from),fromData);source(await tx.get(to),toData);
        const current=[];for(const doc of docs){const snap=await tx.get(doc.ref);if(snap.exists&&snap.data()?.chatId===from.id)current.push(snap);}
        await admit(tx);
        for(const snap of current)tx.update(snap.ref,{chatId:to.id});
        return current.length;
      });
    };
    const deleteEmptyChat = async (from: FirebaseFirestore.DocumentReference, to: FirebaseFirestore.DocumentReference,
      fromData: FirebaseFirestore.DocumentData, toData: FirebaseFirestore.DocumentData) => {
      await db.runTransaction(async tx=>{
        await admit(tx);source(await tx.get(from),fromData);source(await tx.get(to),toData);
        const remaining=await tx.get(db.collection('messages').where('chatId','==',from.id).limit(1));
        if(!remaining.empty)throw new HttpsError('aborted','De nouveaux messages sont arrivés. Relancez la consolidation.');
        await admit(tx);tx.delete(from);
      });
    };

    const dryRun = request.data?.dryRun !== false;
    const maxPairs: number =
      typeof request.data?.maxPairs === 'number' ? request.data.maxPairs : 200;

    const summary = {
      pairsScanned: 0,
      pairsWithDuplicates: 0,
      messagesMoved: 0,
      chatsDeleted: 0,
      dryRun,
      examples: [] as Array<{
        canonicalId: string;
        loserIds: string[];
        movedMessages: number;
      }>,
    };

    // 1. Group all chats by their (sorted) participants pair.
    const allChats = await db.collection('chats').get();
    await admit();

    const byPair = new Map<string, FirebaseFirestore.QueryDocumentSnapshot[]>();
    for (const docSnap of allChats.docs) {
      const data = docSnap.data();
      const sorted = pairOf(data);
      if (!sorted) continue;
      const key = `${sorted[0]}__${sorted[1]}`;
      if (!byPair.has(key)) byPair.set(key, []);
      byPair.get(key)!.push(docSnap);
    }

    summary.pairsScanned = byPair.size;

    // 2. Process each pair that has more than one chat.
    let processed = 0;
    for (const [canonicalId, chats] of byPair.entries()) {
      if (chats.length < 2) continue;
      summary.pairsWithDuplicates++;
      if (processed >= maxPairs) continue;
      processed++;

      // Choose canonical: existing doc with deterministic ID wins;
      // otherwise the most-recently-updated chat in the group.
      const canonicalCandidate =
        chats.find((c) => c.id === canonicalId) ||
        [...chats].sort((a, b) => {
          const at = (a.data().updatedAt as any)?.toMillis?.() ?? 0;
          const bt = (b.data().updatedAt as any)?.toMillis?.() ?? 0;
          return bt - at;
        })[0];

      const losers = chats.filter((c) => c.id !== canonicalCandidate.id);
      if(chats.some(c=>JSON.stringify(pairOf(c.data()))!==JSON.stringify(pairOf(canonicalCandidate.data()))))
        throw new HttpsError('failed-precondition','Les identités de ces conversations doivent être examinées.');
      let movedMessagesForPair = 0;

      // 3a. Move messages from each loser to the canonical chat.
      for (const loser of losers) {
        await db.runTransaction(async tx=>{
          await admit(tx);source(await tx.get(loser.ref),loser.data());source(await tx.get(canonicalCandidate.ref),canonicalCandidate.data());
        });
        const messagesQuery = await db
          .collection('messages')
          .where('chatId', '==', loser.id)
          .get();
        await admit();

        let moved=messagesQuery.size;
        if (!dryRun && !messagesQuery.empty) {
          // Each checkpoint re-reads source chats/messages and current authority.
          const docs = messagesQuery.docs;
          moved=0;
          for (let i = 0; i < docs.length; i += 100) {
            moved+=await moveMessages(loser.ref,canonicalCandidate.ref,loser.data(),canonicalCandidate.data(),docs.slice(i,i+100));
            await admit();
          }
        }

        movedMessagesForPair += moved;

        // 3b. Delete the loser chat doc.
        if (!dryRun) {
          await deleteEmptyChat(loser.ref,canonicalCandidate.ref,loser.data(),canonicalCandidate.data());
        }
        summary.chatsDeleted++;
      }

      summary.messagesMoved += movedMessagesForPair;

      // 3c. If the canonical lives at a non-deterministic ID (no
      // canonical doc existed), recreate it at the deterministic
      // address so future client lookups hit the fast path.
      if (!dryRun && canonicalCandidate.id !== canonicalId) {
        const targetRef = db.collection('chats').doc(canonicalId);
        const created=await db.runTransaction(async tx=>{
          await admit(tx);
          const current=source(await tx.get(canonicalCandidate.ref),canonicalCandidate.data()),target=await tx.get(targetRef);
          if(target.exists)return false;
          await admit(tx);tx.create(targetRef,{...current,updatedAt:FieldValue.serverTimestamp()});return true;
          });
        if (created) {
          // Re-point messages from the auto-ID canonical to the new
          // deterministic doc as well.
          await admit();
          const ownMsgs = await db
            .collection('messages')
            .where('chatId', '==', canonicalCandidate.id)
            .get();
          await admit();
          for (let i = 0; i < ownMsgs.docs.length; i += 100) {
            await moveMessages(canonicalCandidate.ref,targetRef,canonicalCandidate.data(),canonicalCandidate.data(),ownMsgs.docs.slice(i,i+100));
            await admit();
          }
          await deleteEmptyChat(canonicalCandidate.ref,targetRef,canonicalCandidate.data(),canonicalCandidate.data());
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

    await admit();
    return summary;
  })
);
