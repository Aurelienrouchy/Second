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
exports.updateUserStats = exports.updateShopArticlesCount = exports.updateSearchIndex = void 0;
/**
 * Article Firestore triggers (search index + user stats)
 * Firebase Functions v7 - using onDocumentWritten
 */
const firestore_1 = require("firebase-functions/v2/firestore");
const logger = __importStar(require("firebase-functions/logger"));
const firebase_1 = require("../config/firebase");
const geohash_1 = require("../utils/geohash");
const search_1 = require("../utils/search");
const debounce_1 = require("../utils/debounce");
/**
 * Update search index when article is created/updated/deleted
 *
 * TODO: the client currently searches via articlesService.ts client-side filtering.
 * Migrate to search_index queries for better performance.
 */
exports.updateSearchIndex = (0, firestore_1.onDocumentWritten)({ document: 'articles/{articleId}', region: 'northamerica-northeast1', memory: '512MiB' }, async (event) => {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l;
    const articleId = event.params.articleId;
    try {
        // If document was deleted, remove from search index
        if (!((_b = (_a = event.data) === null || _a === void 0 ? void 0 : _a.after) === null || _b === void 0 ? void 0 : _b.exists)) {
            await firebase_1.db.collection('search_index').doc(articleId).delete();
            logger.info(`Removed article ${articleId} from search index`);
            return;
        }
        const articleData = event.data.after.data();
        if (!articleData)
            return;
        // Only index active, non-rejected articles.
        // IMPORTANT: legacy articles predate the `moderationStatus` field, so an
        // ABSENT value must be treated as approved (legacy). We only de-index on
        // an EXPLICIT moderation block ('pending' | 'rejected'); never on absence,
        // otherwise the pre-existing catalogue would be wiped from search at the
        // next write (R3).
        const moderationStatus = articleData.moderationStatus;
        const isModerationBlocked = moderationStatus === 'pending' || moderationStatus === 'rejected';
        if (!articleData.isActive || isModerationBlocked) {
            await firebase_1.db.collection('search_index').doc(articleId).delete();
            return;
        }
        // Generate geohash for location
        let geohash = '';
        if ((_c = articleData.location) === null || _c === void 0 ? void 0 : _c.coordinates) {
            const { lat, lon } = articleData.location.coordinates;
            geohash = (0, geohash_1.encodeGeohash)(lat, lon, 7);
        }
        // Normalize array fields (support both singular and array formats)
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
        // Generate search keywords
        const brandsText = brands.join(' ');
        const searchText = `${articleData.title} ${articleData.description} ${brandsText} ${articleData.category || ''}`;
        const keywords = (0, search_1.generateSearchKeywords)(searchText);
        // Calculate popularity score
        const popularityScore = (0, search_1.calculatePopularityScore)(articleData.views || 0, articleData.likes || 0, ((_d = articleData.createdAt) === null || _d === void 0 ? void 0 : _d.toDate()) || new Date());
        // Create search index document
        const searchIndexData = {
            articleId,
            title: articleData.title,
            titleLowercase: articleData.title.toLowerCase(),
            description: articleData.description,
            keywords,
            // Filterable fields
            category: articleData.category,
            // Hierarchical category IDs — mirrored so the search_index path can
            // filter by category when a text term is present (C1).
            categoryIds: articleData.categoryIds || [],
            subcategory: articleData.subcategory || null,
            brands: brands,
            colors: colors,
            materials: materials,
            brand: brands[0] || null,
            color: colors[0] || null,
            material: materials[0] || null,
            // ArticleSize is an object { value, system }; mirror verbatim (or null).
            size: (_e = articleData.size) !== null && _e !== void 0 ? _e : null,
            condition: articleData.condition,
            price: articleData.price,
            // Location data
            location: {
                city: ((_f = articleData.location) === null || _f === void 0 ? void 0 : _f.city) || '',
                geohash,
                coordinates: ((_g = articleData.location) === null || _g === void 0 ? void 0 : _g.coordinates) || null,
            },
            // Cached display data
            sellerId: articleData.sellerId,
            sellerName: articleData.sellerName,
            sellerRating: articleData.sellerRating || null,
            firstImage: ((_j = (_h = articleData.images) === null || _h === void 0 ? void 0 : _h[0]) === null || _j === void 0 ? void 0 : _j.url) || null,
            // Status
            isActive: articleData.isActive,
            isSold: articleData.isSold,
            isPromoted: articleData.isPromoted || false,
            // Metrics for ranking
            views: articleData.views || 0,
            likes: articleData.likes || 0,
            createdAt: articleData.createdAt,
            // Search optimization
            popularityScore,
            lastIndexed: firebase_1.FieldValue.serverTimestamp(),
        };
        // Write search index. On the INITIAL creation we must await the write
        // directly: debounceUpdate is a fire-and-forget setTimeout, and on
        // Cloud Functions v2 (Cloud Run) the instance can be frozen/terminated
        // as soon as the handler returns — the timer would never fire and the
        // article would never be indexed (P1-7). We only debounce subsequent
        // updates (frequent metric writes: views/likes/popularity).
        const updateKey = `search_index_${articleId}`;
        const isCreation = !((_k = event.data.before) === null || _k === void 0 ? void 0 : _k.exists);
        if (isCreation) {
            await firebase_1.db
                .collection('search_index')
                .doc(articleId)
                .set(searchIndexData, { merge: true });
            logger.info(`Indexed new article ${articleId}`);
        }
        else {
            (0, debounce_1.debounceUpdate)(updateKey, async () => {
                await firebase_1.db
                    .collection('search_index')
                    .doc(articleId)
                    .set(searchIndexData, { merge: true });
                logger.info(`Updated search index for article ${articleId}`);
            });
        }
        // Update article with geohash if not present
        if (geohash && !((_l = articleData.location) === null || _l === void 0 ? void 0 : _l.geohash)) {
            const geoKey = `article_geohash_${articleId}`;
            (0, debounce_1.debounceUpdate)(geoKey, async () => {
                await firebase_1.db.collection('articles').doc(articleId).update({
                    'location.geohash': geohash,
                });
                logger.info(`Added geohash to article ${articleId}`);
            });
        }
    }
    catch (error) {
        logger.error(`Error updating search index for article ${articleId}`, { error });
    }
});
/**
 * Maintain `shops/{shopId}.articlesCount` (boutiques-admin P1-2).
 *
 * No writer existed for this counter — the shop read path
 * (`shopService.getShopArticles`) lists articles where
 * `shopId == X AND isActive == true AND isSold == false`, and the UI gates the
 * shop display on `articlesCount > 0`. We mirror that exact predicate: an
 * article contributes +1 to its shop's count iff it has a `shopId`, is active,
 * and is not sold.
 *
 * The trigger applies the DELTA between the before/after contributions per
 * shop, so it is correct across create, delete, sold toggle, deactivation, and
 * a `shopId` change (old shop -1, new shop +1). Increments are idempotent by
 * delta and each shop write is isolated in its own try/catch (the boutique may
 * have been deleted) so one missing shop never aborts the others.
 */
exports.updateShopArticlesCount = (0, firestore_1.onDocumentWritten)({ document: 'articles/{articleId}', region: 'northamerica-northeast1', memory: '512MiB' }, async (event) => {
    var _a, _b, _c, _d, _e, _f;
    const articleId = event.params.articleId;
    try {
        const before = ((_b = (_a = event.data) === null || _a === void 0 ? void 0 : _a.before) === null || _b === void 0 ? void 0 : _b.exists) ? (_c = event.data.before.data()) !== null && _c !== void 0 ? _c : null : null;
        const after = ((_e = (_d = event.data) === null || _d === void 0 ? void 0 : _d.after) === null || _e === void 0 ? void 0 : _e.exists) ? (_f = event.data.after.data()) !== null && _f !== void 0 ? _f : null : null;
        // Does this article state count toward a shop's `articlesCount`?
        // Returns the shopId it contributes to, or null if it counts for none.
        const countedShopId = (data) => {
            if (!data)
                return null;
            const shopId = data.shopId;
            if (typeof shopId !== 'string' || shopId.length === 0)
                return null;
            // Mirror getShopArticles: active AND not sold.
            if (data.isActive !== true)
                return null;
            if (data.isSold === true)
                return null;
            return shopId;
        };
        const beforeShopId = countedShopId(before);
        const afterShopId = countedShopId(after);
        // No change in shop membership → nothing to do (idempotent no-op).
        if (beforeShopId === afterShopId)
            return;
        // Compute per-shop deltas. A shopId change yields -1 on the old shop and
        // +1 on the new one; create/delete/toggle yields a single +/-1.
        const deltas = new Map();
        if (beforeShopId) {
            deltas.set(beforeShopId, (deltas.get(beforeShopId) || 0) - 1);
        }
        if (afterShopId) {
            deltas.set(afterShopId, (deltas.get(afterShopId) || 0) + 1);
        }
        await Promise.all(Array.from(deltas.entries()).map(async ([shopId, delta]) => {
            if (delta === 0)
                return;
            try {
                await firebase_1.db
                    .collection('shops')
                    .doc(shopId)
                    .update({ articlesCount: firebase_1.FieldValue.increment(delta) });
                logger.info(`Adjusted articlesCount for shop ${shopId} by ${delta} (article ${articleId})`);
            }
            catch (error) {
                // Shop may have been deleted — never abort sibling updates.
                logger.warn(`Could not update articlesCount for shop ${shopId}`, { articleId, delta, error: error instanceof Error ? error.message : String(error) });
            }
        }));
    }
    catch (error) {
        logger.error(`Error updating shop articlesCount for article ${articleId}`, { error });
    }
});
/**
 * Update user stats when article is created/updated/sold
 */
exports.updateUserStats = (0, firestore_1.onDocumentWritten)({ document: 'articles/{articleId}', region: 'northamerica-northeast1', memory: '512MiB' }, async (event) => {
    var _a, _b;
    const articleId = event.params.articleId;
    try {
        const after = ((_b = (_a = event.data) === null || _a === void 0 ? void 0 : _a.after) === null || _b === void 0 ? void 0 : _b.exists) ? event.data.after.data() : null;
        if (!after)
            return; // Document deleted
        const sellerId = after.sellerId;
        if (!sellerId)
            return;
        // Debounce user stats update
        const updateKey = `user_stats_${sellerId}`;
        (0, debounce_1.debounceUpdate)(updateKey, async () => {
            const userStatsRef = firebase_1.db.collection('stats').doc(`user_${sellerId}`);
            // Get current user articles
            const userArticlesSnapshot = await firebase_1.db
                .collection('articles')
                .where('sellerId', '==', sellerId)
                .get();
            let articlesListed = 0;
            let articlesActive = 0;
            let articlesSold = 0;
            let totalViews = 0;
            let totalLikes = 0;
            let totalEarnings = 0;
            let salesCount = 0;
            userArticlesSnapshot.forEach((doc) => {
                const article = doc.data();
                articlesListed++;
                if (article.isActive && !article.isSold) {
                    articlesActive++;
                }
                if (article.isSold) {
                    articlesSold++;
                    totalEarnings += article.price || 0;
                    salesCount++;
                }
                totalViews += article.views || 0;
                totalLikes += article.likes || 0;
            });
            const averageSalePrice = salesCount > 0 ? totalEarnings / salesCount : 0;
            // Update user stats
            await userStatsRef.set({
                userId: sellerId,
                productsListed: articlesListed,
                productsActive: articlesActive,
                productsSold: articlesSold,
                productsViews: totalViews,
                productsLikes: totalLikes,
                totalEarnings,
                averageSalePrice,
                updatedAt: firebase_1.FieldValue.serverTimestamp(),
            }, { merge: true });
            logger.info(`Updated stats for user ${sellerId}`);
        }, 10000); // 10 second debounce
    }
    catch (error) {
        logger.error(`Error updating user stats for article ${articleId}`, { error });
    }
});
//# sourceMappingURL=products.js.map