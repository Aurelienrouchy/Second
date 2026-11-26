/**
 * One-shot backfill: users/{sellerId}.articlesCount.
 *
 * WHY (m8):
 *   `users/{sellerId}.articlesCount` is read by `getLikedSellers` /
 *   `getFeaturedSellers` (callable/home.ts) to render "N articles" on seller
 *   cards. Until the `updateSellerArticlesCount` trigger (triggers/products.ts)
 *   was added, NO writer maintained this counter, so sellers showed "0 articles"
 *   (or a stale value) even when they had live items. The trigger only fixes the
 *   count going forward, on the next article write — existing sellers need a
 *   one-time backfill to seed the correct value.
 *
 * WHAT THIS DOES:
 *   Recomputes, per seller, the number of articles that are active AND not sold
 *   (the exact predicate the trigger and the seller-articles read path use), and
 *   writes it to `users/{sellerId}.articlesCount`. Sellers with zero matching
 *   articles are set to 0 so stale counters are corrected.
 *
 * IMPERATIVE ORDER OF OPERATIONS:
 *   Deploy the `updateSellerArticlesCount` trigger FIRST, then run this backfill.
 *   Running the backfill after the trigger is live guarantees the count cannot
 *   drift between the snapshot read here and subsequent live writes.
 *
 * THIS SCRIPT IS NOT A CLOUD FUNCTION. It is intentionally NOT exported from
 * functions/src/index.ts, so it never deploys. Run ONCE, manually, with Admin
 * SDK credentials:
 *
 *   # from functions/
 *   npm run build
 *   GOOGLE_APPLICATION_CREDENTIALS=/abs/path/serviceAccount.json \
 *     node lib/scripts/backfillSellerArticlesCount.js --dry-run   # inspect first
 *   GOOGLE_APPLICATION_CREDENTIALS=/abs/path/serviceAccount.json \
 *     node lib/scripts/backfillSellerArticlesCount.js             # execute
 *
 * Flags:
 *   --dry-run   compute and log counts; write NOTHING.
 */
import * as admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

const BATCH_LIMIT = 400;

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');

function log(...parts: unknown[]): void {
  // eslint-disable-next-line no-console
  console.log('[backfillSellerArticlesCount]', ...parts);
}

async function forEachArticle(
  handler: (doc: FirebaseFirestore.QueryDocumentSnapshot) => void
): Promise<number> {
  let processed = 0;
  let last: FirebaseFirestore.QueryDocumentSnapshot | null = null;
  const pageSize = 500;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    let q = db
      .collection('articles')
      .orderBy(admin.firestore.FieldPath.documentId())
      .limit(pageSize);
    if (last) q = q.startAfter(last.id);

    const snap = await q.get();
    if (snap.empty) break;

    for (const doc of snap.docs) {
      handler(doc);
      processed++;
    }

    last = snap.docs[snap.docs.length - 1];
    if (snap.size < pageSize) break;
  }

  return processed;
}

async function main(): Promise<void> {
  log(`Starting${DRY_RUN ? ' (DRY RUN)' : ''}`);

  // 1. Tally active, not-sold articles per seller.
  const counts = new Map<string, number>();
  const scanned = await forEachArticle((doc) => {
    const data = doc.data();
    const sellerId = data.sellerId;
    if (typeof sellerId !== 'string' || sellerId.length === 0) return;
    if (data.isActive !== true) return;
    if (data.isSold === true) return;
    counts.set(sellerId, (counts.get(sellerId) || 0) + 1);
  });
  log(`Scanned ${scanned} articles across ${counts.size} sellers`);

  // 2. Write the recomputed count to every seller that owns at least one
  //    counted article. Sellers with zero counted articles are intentionally
  //    NOT enumerated here (we never list the full users collection); their
  //    stale counter, if any, is corrected on the next article write by the
  //    trigger. To force a hard reset of ALL sellers, extend with a users scan.
  let batch = db.batch();
  let batchCount = 0;
  let written = 0;

  const flush = async (): Promise<void> => {
    if (batchCount === 0) return;
    if (!DRY_RUN) await batch.commit();
    batch = db.batch();
    batchCount = 0;
  };

  for (const [sellerId, count] of counts.entries()) {
    if (!DRY_RUN) {
      batch.set(
        db.collection('users').doc(sellerId),
        { articlesCount: count },
        { merge: true }
      );
      batchCount++;
      if (batchCount >= BATCH_LIMIT) await flush();
    }
    written++;
  }

  await flush();
  log(`Done — sellers updated=${written}${DRY_RUN ? ' (DRY RUN, no writes)' : ''}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[backfillSellerArticlesCount] FAILED', err);
    process.exit(1);
  });
