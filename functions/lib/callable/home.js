"use strict";
/**
 * Home page callable functions
 * Firebase Functions v7 - using onCall
 *
 * Each home section has its own dedicated callable.
 * N+1 seller fetches replaced with batchFetchSellerNames().
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordPriceDrop = exports.getLikedSellers = exports.toggleSellerLike = exports.getHomeFeed = exports.getNewArrivals = exports.getFeaturedSellers = exports.getPriceDrops = exports.getTrendingBrands = void 0;
const https_1 = require("firebase-functions/v2/https");
const firebase_1 = require("../config/firebase");
const normalizeBrand_1 = require("../utils/normalizeBrand");
// =============================================================================
// BATCH SELLER FETCH — eliminates N+1
// =============================================================================
/**
 * Fetch displayNames for a list of seller IDs in groups of 10
 * (Firestore 'in' operator limit).
 */
async function batchFetchSellerNames(sellerIds) {
    const unique = [...new Set(sellerIds)];
    const map = new Map();
    for (let i = 0; i < unique.length; i += 10) {
        const batch = unique.slice(i, i + 10);
        const snap = await firebase_1.db
            .collection('users')
            .where('__name__', 'in', batch)
            .get();
        snap.docs.forEach((doc) => {
            map.set(doc.id, doc.data().displayName || 'Unknown');
        });
    }
    return map;
}
// =============================================================================
// INTERNAL HELPERS
// =============================================================================
async function _getTrendingBrands() {
    const snapshot = await firebase_1.db
        .collection('articles')
        .where('isActive', '==', true)
        .where('isSold', '==', false)
        .limit(500)
        .get();
    // Group case-insensitively so "SELECTED" / "selected" / "Selected" merge
    // into a single bucket. Articles without a brand are skipped entirely.
    const brandCounts = new Map();
    snapshot.docs.forEach((doc) => {
        const key = (0, normalizeBrand_1.brandKey)(doc.data().brand);
        if (!key)
            return; // skip empty / missing brands (no more "Unknown")
        brandCounts.set(key, (brandCounts.get(key) || 0) + 1);
    });
    return Array.from(brandCounts.entries())
        .map(([key, count]) => ({ name: (0, normalizeBrand_1.brandDisplay)(key), articleCount: count }))
        .sort((a, b) => b.articleCount - a.articleCount)
        .slice(0, 10);
}
async function _getPriceDrops() {
    // Use a targeted query with composite index instead of full-scan + client filter.
    // Requires index: {isActive ASC, isSold ASC, lastPriceDropAt DESC}
    const snapshot = await firebase_1.db
        .collection('articles')
        .where('isActive', '==', true)
        .where('isSold', '==', false)
        .where('lastPriceDropAt', '!=', null)
        .orderBy('lastPriceDropAt', 'desc')
        .limit(20)
        .get();
    if (snapshot.docs.length === 0)
        return [];
    // Single batch read for all sellers — no N+1
    const sellerMap = await batchFetchSellerNames(snapshot.docs.map((d) => d.data().sellerId));
    const items = snapshot.docs.map((doc) => {
        const data = doc.data();
        const originalPrice = data.originalPrice || data.price;
        const reductionPercent = Math.round(((originalPrice - data.price) / originalPrice) * 100);
        return {
            id: doc.id,
            title: data.title,
            brand: data.brand,
            price: data.price,
            originalPrice,
            reduction: `-${reductionPercent}%`,
            images: data.images || [],
            sellerId: data.sellerId,
            sellerName: sellerMap.get(data.sellerId) || 'Unknown',
        };
    });
    return items.sort((a, b) => {
        const aP = parseInt(a.reduction.replace(/[^0-9]/g, ''), 10) || 0;
        const bP = parseInt(b.reduction.replace(/[^0-9]/g, ''), 10) || 0;
        return bP - aP;
    });
}
async function _getFeaturedSellers() {
    const snapshot = await firebase_1.db
        .collection('users')
        .where('sellerLikesCount', '>', 0)
        .orderBy('sellerLikesCount', 'desc')
        .limit(20)
        .get();
    return snapshot.docs.map((doc) => {
        const data = doc.data();
        return {
            id: doc.id,
            displayName: data.displayName || 'Unknown',
            profileImage: data.profileImage,
            rating: data.rating || 0,
            articlesCount: data.articlesCount || 0,
            sellerLikesCount: data.sellerLikesCount || 0,
        };
    });
}
async function _getNewArrivals(lastDocId, limit = 20) {
    let query = firebase_1.db
        .collection('articles')
        .where('isActive', '==', true)
        .where('isSold', '==', false)
        .orderBy('createdAt', 'desc')
        .limit(limit + 1);
    if (lastDocId) {
        const lastDoc = await firebase_1.db.collection('articles').doc(lastDocId).get();
        if (lastDoc.exists) {
            query = query.startAfter(lastDoc);
        }
    }
    const snapshot = await query.get();
    const docs = snapshot.docs.slice(0, Math.min(snapshot.docs.length, limit));
    if (docs.length === 0)
        return { articles: [], lastDocId: null };
    // Single batch read for all sellers — no N+1
    const sellerMap = await batchFetchSellerNames(docs.map((d) => d.data().sellerId));
    const articles = docs.map((doc) => {
        var _a, _b;
        const data = doc.data();
        return {
            id: doc.id,
            title: data.title,
            brand: data.brand,
            price: data.price,
            images: data.images || [],
            sellerId: data.sellerId,
            sellerName: sellerMap.get(data.sellerId) || 'Unknown',
            // data.size is now an ArticleSize object { value, system }; the DTO
            // exposes a plain string to the client.
            size: (_b = (_a = data.size) === null || _a === void 0 ? void 0 : _a.value) !== null && _b !== void 0 ? _b : null,
            condition: data.condition,
        };
    });
    const nextLastDocId = snapshot.docs.length > limit ? snapshot.docs[limit - 1].id : null;
    return { articles, lastDocId: nextLastDocId };
}
// =============================================================================
// INDIVIDUAL CALLABLE FUNCTIONS — one per home section
// =============================================================================
/** Trending brands section */
exports.getTrendingBrands = (0, https_1.onCall)({ region: 'northamerica-northeast1', invoker: 'public', memory: '512MiB', timeoutSeconds: 15 }, async () => {
    try {
        return await _getTrendingBrands();
    }
    catch (error) {
        console.error('[getTrendingBrands]', error);
        throw new https_1.HttpsError('internal', 'Failed to load trending brands');
    }
});
/** Price drops section */
exports.getPriceDrops = (0, https_1.onCall)({ region: 'northamerica-northeast1', invoker: 'public', memory: '512MiB', timeoutSeconds: 15 }, async () => {
    try {
        return await _getPriceDrops();
    }
    catch (error) {
        console.error('[getPriceDrops]', error);
        throw new https_1.HttpsError('internal', 'Failed to load price drops');
    }
});
/** Featured sellers section */
exports.getFeaturedSellers = (0, https_1.onCall)({ region: 'northamerica-northeast1', invoker: 'public', memory: '512MiB', timeoutSeconds: 15 }, async () => {
    try {
        return await _getFeaturedSellers();
    }
    catch (error) {
        console.error('[getFeaturedSellers]', error);
        throw new https_1.HttpsError('internal', 'Failed to load featured sellers');
    }
});
/** New arrivals — first page for Nouveautés + cursor pagination for Discover */
exports.getNewArrivals = (0, https_1.onCall)({ region: 'northamerica-northeast1', invoker: 'public', memory: '512MiB', timeoutSeconds: 15 }, async (request) => {
    var _a;
    try {
        const { lastDocId = null, limit = 20 } = (_a = request.data) !== null && _a !== void 0 ? _a : {};
        return await _getNewArrivals(lastDocId, limit);
    }
    catch (error) {
        console.error('[getNewArrivals]', error);
        throw new https_1.HttpsError('internal', 'Failed to load new arrivals');
    }
});
// =============================================================================
// LEGACY — kept for any existing callers during migration
// =============================================================================
/** @deprecated Use the individual section callables instead. */
exports.getHomeFeed = (0, https_1.onCall)({ region: 'northamerica-northeast1', invoker: 'public', memory: '512MiB', timeoutSeconds: 30 }, async () => {
    try {
        const [trendingBrands, priceDrops, featuredSellers, newArrivals] = await Promise.all([
            _getTrendingBrands(),
            _getPriceDrops(),
            _getFeaturedSellers(),
            _getNewArrivals(null, 20),
        ]);
        return { trendingBrands, priceDrops, featuredSellers, newArrivals };
    }
    catch (error) {
        console.error('[getHomeFeed]', error);
        throw new https_1.HttpsError('internal', 'Failed to load home feed');
    }
});
// =============================================================================
// SELLER LIKE
// =============================================================================
exports.toggleSellerLike = (0, https_1.onCall)({ region: 'northamerica-northeast1', memory: '512MiB' }, async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'User must be authenticated');
    }
    const { sellerId, isLiked } = request.data;
    const userId = request.auth.uid;
    if (!sellerId || typeof isLiked !== 'boolean') {
        throw new https_1.HttpsError('invalid-argument', 'sellerId and isLiked status are required');
    }
    try {
        const userRef = firebase_1.db.collection('users').doc(userId);
        const sellerRef = firebase_1.db.collection('users').doc(sellerId);
        await firebase_1.db.runTransaction(async (transaction) => {
            var _a;
            const userDoc = await transaction.get(userRef);
            const sellerDoc = await transaction.get(sellerRef);
            if (!sellerDoc.exists) {
                throw new https_1.HttpsError('not-found', 'Seller not found');
            }
            const userData = userDoc.exists ? (_a = userDoc.data()) !== null && _a !== void 0 ? _a : {} : {};
            const sellerData = sellerDoc.data();
            let likedSellers = userData.likedSellers || [];
            const currentLikesCount = sellerData.sellerLikesCount || 0;
            if (isLiked && !likedSellers.includes(sellerId)) {
                likedSellers.push(sellerId);
                transaction.set(userRef, { likedSellers, updatedAt: firebase_1.FieldValue.serverTimestamp() }, { merge: true });
                transaction.update(sellerRef, {
                    sellerLikesCount: currentLikesCount + 1,
                    updatedAt: firebase_1.FieldValue.serverTimestamp(),
                });
            }
            else if (!isLiked && likedSellers.includes(sellerId)) {
                likedSellers = likedSellers.filter((id) => id !== sellerId);
                transaction.set(userRef, { likedSellers, updatedAt: firebase_1.FieldValue.serverTimestamp() }, { merge: true });
                transaction.update(sellerRef, {
                    sellerLikesCount: Math.max(0, currentLikesCount - 1),
                    updatedAt: firebase_1.FieldValue.serverTimestamp(),
                });
            }
        });
        return { success: true };
    }
    catch (error) {
        if (error instanceof https_1.HttpsError)
            throw error;
        console.error('[toggleSellerLike]', error);
        throw new https_1.HttpsError('internal', 'Failed to update seller like status');
    }
});
exports.getLikedSellers = (0, https_1.onCall)({ region: 'northamerica-northeast1', memory: '512MiB' }, async (request) => {
    var _a, _b;
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'User must be authenticated');
    }
    try {
        const userDoc = await firebase_1.db
            .collection('users')
            .doc(request.auth.uid)
            .get();
        if (!userDoc.exists)
            return { sellers: [] };
        const likedSellerIds = (_b = (_a = userDoc.data()) === null || _a === void 0 ? void 0 : _a.likedSellers) !== null && _b !== void 0 ? _b : [];
        if (likedSellerIds.length === 0)
            return { sellers: [] };
        const sellers = [];
        for (let i = 0; i < likedSellerIds.length; i += 10) {
            const batch = likedSellerIds.slice(i, i + 10);
            const snap = await firebase_1.db
                .collection('users')
                .where('__name__', 'in', batch)
                .get();
            snap.docs.forEach((doc) => {
                const data = doc.data();
                sellers.push({
                    id: doc.id,
                    displayName: data.displayName || 'Unknown',
                    profileImage: data.profileImage,
                    rating: data.rating || 0,
                    articlesCount: data.articlesCount || 0,
                    sellerLikesCount: data.sellerLikesCount || 0,
                });
            });
        }
        return { sellers };
    }
    catch (error) {
        console.error('[getLikedSellers]', error);
        throw new https_1.HttpsError('internal', 'Failed to load liked sellers');
    }
});
exports.recordPriceDrop = (0, https_1.onCall)({ region: 'northamerica-northeast1', memory: '512MiB' }, async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'User must be authenticated');
    }
    const { productId, oldPrice, newPrice } = request.data;
    const userId = request.auth.uid;
    if (!productId ||
        typeof oldPrice !== 'number' ||
        typeof newPrice !== 'number') {
        throw new https_1.HttpsError('invalid-argument', 'productId, oldPrice, and newPrice are required');
    }
    if (newPrice >= oldPrice) {
        throw new https_1.HttpsError('invalid-argument', 'New price must be lower than old price');
    }
    try {
        const productRef = firebase_1.db.collection('articles').doc(productId);
        await firebase_1.db.runTransaction(async (transaction) => {
            const productDoc = await transaction.get(productRef);
            if (!productDoc.exists) {
                throw new https_1.HttpsError('not-found', 'Product not found');
            }
            const productData = productDoc.data();
            if (productData.sellerId !== userId) {
                throw new https_1.HttpsError('permission-denied', 'You can only record price drops for your own products');
            }
            const originalPrice = productData.originalPrice || productData.price;
            const priceDropPercent = Math.round(((oldPrice - newPrice) / originalPrice) * 100);
            transaction.update(productRef, {
                price: newPrice,
                originalPrice,
                priceDropPercent,
                lastPriceDropAt: firebase_1.FieldValue.serverTimestamp(),
                updatedAt: firebase_1.FieldValue.serverTimestamp(),
            });
        });
        return { success: true };
    }
    catch (error) {
        if (error instanceof https_1.HttpsError)
            throw error;
        console.error('[recordPriceDrop]', error);
        throw new https_1.HttpsError('internal', 'Failed to record price drop');
    }
});
//# sourceMappingURL=home.js.map