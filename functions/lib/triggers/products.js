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
exports.updateUserStats = exports.updateSearchIndex = void 0;
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
    var _a, _b, _c, _d, _e, _f, _g, _h, _j;
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
        // Only index active, approved articles
        if (!articleData.isActive || articleData.moderationStatus !== 'approved') {
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
            subcategory: articleData.subcategory || null,
            brands: brands,
            colors: colors,
            materials: materials,
            brand: brands[0] || null,
            color: colors[0] || null,
            material: materials[0] || null,
            size: articleData.size || null,
            condition: articleData.condition,
            price: articleData.price,
            // Location data
            location: {
                city: ((_e = articleData.location) === null || _e === void 0 ? void 0 : _e.city) || '',
                geohash,
                coordinates: ((_f = articleData.location) === null || _f === void 0 ? void 0 : _f.coordinates) || null,
            },
            // Cached display data
            sellerId: articleData.sellerId,
            sellerName: articleData.sellerName,
            sellerRating: articleData.sellerRating || null,
            firstImage: ((_h = (_g = articleData.images) === null || _g === void 0 ? void 0 : _g[0]) === null || _h === void 0 ? void 0 : _h.url) || null,
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
        // Update search index with debouncing
        const updateKey = `search_index_${articleId}`;
        (0, debounce_1.debounceUpdate)(updateKey, async () => {
            await firebase_1.db
                .collection('search_index')
                .doc(articleId)
                .set(searchIndexData, { merge: true });
            logger.info(`Updated search index for article ${articleId}`);
        });
        // Update article with geohash if not present
        if (geohash && !((_j = articleData.location) === null || _j === void 0 ? void 0 : _j.geohash)) {
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