/**
 * One-shot backfill: moderationStatus (legacy articles) + search_index rebuild.
 *
 * WHY (R2):
 *   The `search_index` collection is populated ONLY by the `updateSearchIndex`
 *   trigger (functions/src/triggers/products.ts), which fires on article writes.
 *   Articles that predate the trigger / that never received a write since the
 *   trigger went live have NO `search_index` entry → the pre-existing catalogue
 *   is invisible in search and in the "Populaire" sort. There is no automatic
 *   recovery: a doc that is never written again is never indexed.
 *
 * WHAT THIS DOES (two phases, in order):
 *   Phase 1 — moderationStatus: stamp `moderationStatus: 'approved'` on every
 *     legacy article that is MISSING the field. New articles already get it on
 *     creation (callable/products.ts). We treat ABSENT as legacy/approved,
 *     consistent with the de-index guard in the trigger (R3). We never touch an
 *     article that already has an explicit status ('approved'|'pending'|
 *     'rejected') — moderation decisions are authoritative.
 *   Phase 2 — search_index: rebuild a `search_index/{articleId}` document for
 *     every indexable article, mirroring VERBATIM the document shape produced by
 *     the `updateSearchIndex` trigger so the indexer and the backfill cannot
 *     diverge. Non-indexable articles (inactive, or moderation-blocked) get their
 *     stale `search_index` entry removed.
 *
 * INDEXABILITY (must match the trigger exactly):
 *   indexable === isActive === true && moderationStatus NOT IN ('pending','rejected')
 *   (absent moderationStatus is treated as approved/legacy)
 *
 * IMPERATIVE ORDER OF OPERATIONS — DO NOT REORDER:
 *   1. Run Phase 1 (moderationStatus) and let it fully complete.
 *   2. THEN run Phase 2 (search_index rebuild).
 *   3. ONLY THEN switch the production search to read from `search_index`.
 *   Rationale: if search reads from `search_index` before the rebuild, the
 *   catalogue appears empty; if Phase 2 runs before Phase 1, freshly-stamped
 *   legacy articles would still be evaluated correctly (absent === approved),
 *   but running Phase 1 first makes the data self-describing and idempotent.
 *
 * THIS SCRIPT IS NOT A CLOUD FUNCTION. It is intentionally NOT exported from
 * functions/src/index.ts, so it never deploys. It is meant to be run ONCE,
 * manually, by an operator with Admin SDK credentials:
 *
 *   # from functions/
 *   npm run build
 *   GOOGLE_APPLICATION_CREDENTIALS=/abs/path/serviceAccount.json \
 *     node lib/scripts/backfillSearchIndex.js --dry-run     # inspect first
 *   GOOGLE_APPLICATION_CREDENTIALS=/abs/path/serviceAccount.json \
 *     node lib/scripts/backfillSearchIndex.js               # execute
 *
 * Flags:
 *   --dry-run         compute and log counts; write NOTHING.
 *   --phase=1         run only Phase 1 (moderationStatus).
 *   --phase=2         run only Phase 2 (search_index rebuild).
 *   (no --phase)      run Phase 1 then Phase 2.
 */
import * as admin from 'firebase-admin';
import { encodeGeohash } from '../utils/geohash';
import {
  generateSearchKeywords,
  calculatePopularityScore,
} from '../utils/search';

// ── Admin init (explicit, standalone — NOT the functions runtime singleton) ──
if (!admin.apps.length) {
  // Uses GOOGLE_APPLICATION_CREDENTIALS / ADC. Project is inferred from the
  // service account. Fail loudly if credentials are missing.
  admin.initializeApp();
}
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

const BATCH_LIMIT = 400; // < 500 Firestore batch hard limit, leave headroom

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const phaseArg = args.find((a) => a.startsWith('--phase='));
const ONLY_PHASE = phaseArg ? Number(phaseArg.split('=')[1]) : 0; // 0 = both

function log(...parts: unknown[]): void {
  // eslint-disable-next-line no-console
  console.log('[backfillSearchIndex]', ...parts);
}

/**
 * Mirror of the indexability guard in updateSearchIndex (R3-safe):
 * absent moderationStatus === approved/legacy.
 */
function isIndexable(article: FirebaseFirestore.DocumentData): boolean {
  const moderationStatus = article.moderationStatus;
  const blocked =
    moderationStatus === 'pending' || moderationStatus === 'rejected';
  return article.isActive === true && !blocked;
}

/**
 * Build the search_index document for an article, byte-for-byte aligned with
 * the shape produced by updateSearchIndex (triggers/products.ts). If you change
 * the trigger's shape, change it here too.
 */
function buildSearchIndexData(
  articleId: string,
  articleData: FirebaseFirestore.DocumentData
): Record<string, unknown> {
  let geohash = '';
  if (articleData.location?.coordinates) {
    const { lat, lon } = articleData.location.coordinates;
    geohash = encodeGeohash(lat, lon, 7);
  }

  const getBrands = (): string[] => {
    if (articleData.brands && Array.isArray(articleData.brands))
      return articleData.brands;
    if (articleData.brand) return [articleData.brand];
    return [];
  };
  const getColors = (): string[] => {
    if (articleData.colors && Array.isArray(articleData.colors))
      return articleData.colors;
    if (articleData.color) return [articleData.color];
    return [];
  };
  const getMaterials = (): string[] => {
    if (articleData.materials && Array.isArray(articleData.materials))
      return articleData.materials;
    if (articleData.material) return [articleData.material];
    return [];
  };

  const brands = getBrands();
  const colors = getColors();
  const materials = getMaterials();

  const brandsText = brands.join(' ');
  const searchText = `${articleData.title} ${articleData.description} ${brandsText} ${articleData.category || ''}`;
  const keywords = generateSearchKeywords(searchText);

  const popularityScore = calculatePopularityScore(
    articleData.views || 0,
    articleData.likes || 0,
    articleData.createdAt?.toDate?.() || new Date()
  );

  return {
    articleId,
    title: articleData.title,
    titleLowercase: (articleData.title || '').toLowerCase(),
    description: articleData.description,
    keywords,

    category: articleData.category,
    categoryIds: articleData.categoryIds || [],
    subcategory: articleData.subcategory || null,
    brands: brands,
    colors: colors,
    materials: materials,
    brand: brands[0] || null,
    color: colors[0] || null,
    material: materials[0] || null,
    size: articleData.size ?? null,
    condition: articleData.condition,
    price: articleData.price,

    location: {
      city: articleData.location?.city || '',
      geohash,
      coordinates: articleData.location?.coordinates || null,
    },

    sellerId: articleData.sellerId,
    sellerName: articleData.sellerName,
    sellerRating: articleData.sellerRating || null,
    firstImage: articleData.images?.[0]?.url || null,

    isActive: articleData.isActive,
    isSold: articleData.isSold,
    isPromoted: articleData.isPromoted || false,

    views: articleData.views || 0,
    likes: articleData.likes || 0,
    createdAt: articleData.createdAt,

    popularityScore,
    lastIndexed: FieldValue.serverTimestamp(),
  };
}

/**
 * Iterate every article doc, paginated by document id, calling `handler` for
 * each. Avoids loading the whole collection into memory.
 */
async function forEachArticle(
  handler: (
    doc: FirebaseFirestore.QueryDocumentSnapshot
  ) => void | Promise<void>
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
      await handler(doc);
      processed++;
    }

    last = snap.docs[snap.docs.length - 1];
    if (snap.size < pageSize) break;
  }

  return processed;
}

// ── Phase 1: stamp moderationStatus on legacy articles missing the field ──
async function phase1(): Promise<void> {
  log('Phase 1 — moderationStatus backfill (legacy articles)');
  let scanned = 0;
  let toStamp = 0;
  let batch = db.batch();
  let batchCount = 0;

  const flush = async (): Promise<void> => {
    if (batchCount === 0) return;
    if (!DRY_RUN) await batch.commit();
    batch = db.batch();
    batchCount = 0;
  };

  await forEachArticle(async (doc) => {
    scanned++;
    const data = doc.data();
    // Only stamp articles that are MISSING the field. Never overwrite an
    // explicit moderation decision.
    if (data.moderationStatus === undefined || data.moderationStatus === null) {
      toStamp++;
      if (!DRY_RUN) {
        batch.update(doc.ref, { moderationStatus: 'approved' });
        batchCount++;
        if (batchCount >= BATCH_LIMIT) await flush();
      }
    }
  });

  await flush();
  log(
    `Phase 1 done — scanned=${scanned} stamped=${toStamp}${DRY_RUN ? ' (DRY RUN, no writes)' : ''}`
  );
}

// ── Phase 2: rebuild search_index from articles ──
async function phase2(): Promise<void> {
  log('Phase 2 — search_index rebuild');
  let scanned = 0;
  let indexed = 0;
  let removed = 0;
  let batch = db.batch();
  let batchCount = 0;

  const flush = async (): Promise<void> => {
    if (batchCount === 0) return;
    if (!DRY_RUN) await batch.commit();
    batch = db.batch();
    batchCount = 0;
  };

  await forEachArticle(async (doc) => {
    scanned++;
    const data = doc.data();
    const ref = db.collection('search_index').doc(doc.id);

    if (isIndexable(data)) {
      indexed++;
      if (!DRY_RUN) {
        batch.set(ref, buildSearchIndexData(doc.id, data), { merge: true });
        batchCount++;
      }
    } else {
      removed++;
      if (!DRY_RUN) {
        batch.delete(ref);
        batchCount++;
      }
    }

    if (batchCount >= BATCH_LIMIT) await flush();
  });

  await flush();
  log(
    `Phase 2 done — scanned=${scanned} indexed=${indexed} removed=${removed}${DRY_RUN ? ' (DRY RUN, no writes)' : ''}`
  );
}

async function main(): Promise<void> {
  log(
    `Starting${DRY_RUN ? ' (DRY RUN)' : ''} — phase=${ONLY_PHASE === 0 ? 'all' : ONLY_PHASE}`
  );

  if (ONLY_PHASE === 0 || ONLY_PHASE === 1) {
    await phase1();
  }
  if (ONLY_PHASE === 0 || ONLY_PHASE === 2) {
    await phase2();
  }

  log('Complete.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[backfillSearchIndex] FAILED', err);
    process.exit(1);
  });
