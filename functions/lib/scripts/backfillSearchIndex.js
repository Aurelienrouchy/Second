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
const admin = __importStar(require("firebase-admin"));
const geohash_1 = require("../utils/geohash");
const search_1 = require("../utils/search");
const article_1 = require("../shared/article");
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
function log(...parts) {
    // eslint-disable-next-line no-console
    console.log('[backfillSearchIndex]', ...parts);
}
/**
 * Mirror of the indexability guard in updateSearchIndex (R3-safe):
 * absent moderationStatus === approved/legacy.
 */
function isIndexable(article) {
    const moderationStatus = article.moderationStatus;
    const blocked = moderationStatus === 'pending' || moderationStatus === 'rejected';
    return article.isActive === true && !blocked;
}
/**
 * Build the search_index document for an article, byte-for-byte aligned with
 * the shape produced by updateSearchIndex (triggers/products.ts). If you change
 * the trigger's shape, change it here too.
 */
function buildSearchIndexData(articleId, articleData) {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    let geohash = '';
    if ((_a = articleData.location) === null || _a === void 0 ? void 0 : _a.coordinates) {
        const { lat, lon } = articleData.location.coordinates;
        geohash = (0, geohash_1.encodeGeohash)(lat, lon, 7);
    }
    const getBrands = () => {
        if (articleData.brands && Array.isArray(articleData.brands))
            return articleData.brands;
        if (articleData.brand)
            return [articleData.brand];
        return [];
    };
    const getColors = () => {
        if (articleData.colors && Array.isArray(articleData.colors))
            return articleData.colors;
        if (articleData.color)
            return [articleData.color];
        return [];
    };
    const getMaterials = () => {
        if (articleData.materials && Array.isArray(articleData.materials))
            return articleData.materials;
        if (articleData.material)
            return [articleData.material];
        return [];
    };
    const brands = getBrands();
    const colors = getColors();
    const materials = getMaterials();
    const brandsText = brands.join(' ');
    const searchText = `${articleData.title} ${articleData.description} ${brandsText} ${articleData.category || ''}`;
    const keywords = (0, search_1.generateSearchKeywords)(searchText);
    const popularityScore = (0, search_1.calculatePopularityScore)(articleData.views || 0, articleData.likes || 0, ((_c = (_b = articleData.createdAt) === null || _b === void 0 ? void 0 : _b.toDate) === null || _c === void 0 ? void 0 : _c.call(_b)) || new Date());
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
        // Normalize legacy/hybrid sizes to the {value, system} contract before
        // writing. sanitizeArticleSize preserves an existing object verbatim, maps a
        // legacy bare string to its back-compat default (system: 'EU' — the same
        // default used by the callable/trigger, never a hardcoded system at write),
        // and yields undefined for empty/malformed input → store null (never
        // undefined to Firestore).
        size: (_d = (0, article_1.sanitizeArticleSize)(articleData.size)) !== null && _d !== void 0 ? _d : null,
        condition: articleData.condition,
        price: articleData.price,
        location: {
            city: ((_e = articleData.location) === null || _e === void 0 ? void 0 : _e.city) || '',
            geohash,
            coordinates: ((_f = articleData.location) === null || _f === void 0 ? void 0 : _f.coordinates) || null,
        },
        sellerId: articleData.sellerId,
        sellerName: articleData.sellerName,
        sellerRating: articleData.sellerRating || null,
        firstImage: ((_h = (_g = articleData.images) === null || _g === void 0 ? void 0 : _g[0]) === null || _h === void 0 ? void 0 : _h.url) || null,
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
async function forEachArticle(handler) {
    let processed = 0;
    let last = null;
    const pageSize = 500;
    // eslint-disable-next-line no-constant-condition
    while (true) {
        let q = db
            .collection('articles')
            .orderBy(admin.firestore.FieldPath.documentId())
            .limit(pageSize);
        if (last)
            q = q.startAfter(last.id);
        const snap = await q.get();
        if (snap.empty)
            break;
        for (const doc of snap.docs) {
            await handler(doc);
            processed++;
        }
        last = snap.docs[snap.docs.length - 1];
        if (snap.size < pageSize)
            break;
    }
    return processed;
}
// ── Phase 1: stamp moderationStatus on legacy articles missing the field ──
async function phase1() {
    log('Phase 1 — moderationStatus backfill (legacy articles)');
    let scanned = 0;
    let toStamp = 0;
    let batch = db.batch();
    let batchCount = 0;
    const flush = async () => {
        if (batchCount === 0)
            return;
        if (!DRY_RUN)
            await batch.commit();
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
                if (batchCount >= BATCH_LIMIT)
                    await flush();
            }
        }
    });
    await flush();
    log(`Phase 1 done — scanned=${scanned} stamped=${toStamp}${DRY_RUN ? ' (DRY RUN, no writes)' : ''}`);
}
// ── Phase 2: rebuild search_index from articles ──
async function phase2() {
    log('Phase 2 — search_index rebuild');
    let scanned = 0;
    let indexed = 0;
    let removed = 0;
    let batch = db.batch();
    let batchCount = 0;
    const flush = async () => {
        if (batchCount === 0)
            return;
        if (!DRY_RUN)
            await batch.commit();
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
        }
        else {
            removed++;
            if (!DRY_RUN) {
                batch.delete(ref);
                batchCount++;
            }
        }
        if (batchCount >= BATCH_LIMIT)
            await flush();
    });
    await flush();
    log(`Phase 2 done — scanned=${scanned} indexed=${indexed} removed=${removed}${DRY_RUN ? ' (DRY RUN, no writes)' : ''}`);
}
async function main() {
    log(`Starting${DRY_RUN ? ' (DRY RUN)' : ''} — phase=${ONLY_PHASE === 0 ? 'all' : ONLY_PHASE}`);
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
//# sourceMappingURL=backfillSearchIndex.js.map