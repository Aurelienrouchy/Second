"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.markSavedSearchViewed = exports.toggleProductLike = exports.incrementProductView = void 0;
/**
 * Product callable functions
 * Firebase Functions v7 - using onCall
 */
const https_1 = require("firebase-functions/v2/https");
const firebase_1 = require("../config/firebase");
/**
 * Increment product view count
 */
exports.incrementProductView = (0, https_1.onCall)({ invoker: 'public', memory: '512MiB' }, async (request) => {
    const { productId } = request.data;
    if (!productId) {
        throw new https_1.HttpsError('invalid-argument', 'Product ID is required');
    }
    try {
        const productRef = firebase_1.db.collection('products').doc(productId);
        const searchIndexRef = firebase_1.db.collection('search_index').doc(productId);
        // Use transaction to ensure consistency
        await firebase_1.db.runTransaction(async (transaction) => {
            var _a;
            const productDoc = await transaction.get(productRef);
            if (!productDoc.exists) {
                throw new https_1.HttpsError('not-found', 'Product not found');
            }
            const currentViews = ((_a = productDoc.data()) === null || _a === void 0 ? void 0 : _a.views) || 0;
            const newViews = currentViews + 1;
            // Update product views
            transaction.update(productRef, { views: newViews });
            // Update search index views
            transaction.update(searchIndexRef, { views: newViews });
        });
        return { success: true, message: 'View count incremented' };
    }
    catch (error) {
        console.error('Error incrementing product view:', error);
        throw new https_1.HttpsError('internal', 'Failed to increment view count');
    }
});
/**
 * Toggle product like/unlike
 *
 * Updates atomically in a single transaction:
 * 1. products/{productId} — likes counter + likedBy array
 * 2. articles/{productId} — favoritesCount (denormalised, replaces getFavoriteCount query)
 * 3. search_index/{productId} — likes for ranking
 * 4. favorites/{userId} — articleIds array (unified structure, no more products[])
 */
exports.toggleProductLike = (0, https_1.onCall)({ memory: '512MiB' }, async (request) => {
    const { productId, isLiked } = request.data;
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'User must be authenticated');
    }
    if (!productId || typeof isLiked !== 'boolean') {
        throw new https_1.HttpsError('invalid-argument', 'Product ID and like status are required');
    }
    const userId = request.auth.uid;
    try {
        const productRef = firebase_1.db.collection('products').doc(productId);
        const articleRef = firebase_1.db.collection('articles').doc(productId);
        const searchIndexRef = firebase_1.db.collection('search_index').doc(productId);
        const favoritesRef = firebase_1.db.collection('favorites').doc(userId);
        await firebase_1.db.runTransaction(async (transaction) => {
            const productDoc = await transaction.get(productRef);
            if (!productDoc.exists) {
                throw new https_1.HttpsError('not-found', 'Product not found');
            }
            const productData = productDoc.data();
            const currentLikes = productData.likes || 0;
            const likedBy = productData.likedBy || [];
            let newLikes = currentLikes;
            let newLikedBy = [...likedBy];
            if (isLiked && !likedBy.includes(userId)) {
                newLikes = currentLikes + 1;
                newLikedBy.push(userId);
            }
            else if (!isLiked && likedBy.includes(userId)) {
                newLikes = Math.max(0, currentLikes - 1);
                newLikedBy = likedBy.filter((id) => id !== userId);
            }
            // 1. Update product likes + likedBy
            transaction.update(productRef, {
                likes: newLikes,
                likedBy: newLikedBy,
            });
            // 2. Denormalised favoritesCount on article (replaces expensive getFavoriteCount)
            transaction.update(articleRef, {
                favoritesCount: newLikes,
            });
            // 3. Update search index for ranking
            transaction.update(searchIndexRef, {
                likes: newLikes,
            });
            // 4. Unified favorites — articleIds array only (no more products[] with metadata)
            if (isLiked) {
                transaction.set(favoritesRef, {
                    userId,
                    articleIds: firebase_1.FieldValue.arrayUnion(productId),
                    updatedAt: firebase_1.FieldValue.serverTimestamp(),
                }, { merge: true });
            }
            else {
                transaction.set(favoritesRef, {
                    userId,
                    articleIds: firebase_1.FieldValue.arrayRemove(productId),
                    updatedAt: firebase_1.FieldValue.serverTimestamp(),
                }, { merge: true });
            }
        });
        return { success: true, message: 'Like status updated' };
    }
    catch (error) {
        console.error('Error toggling product like:', error);
        throw new https_1.HttpsError('internal', 'Failed to update like status');
    }
});
/**
 * Mark saved search as viewed (resets newItemsCount)
 */
exports.markSavedSearchViewed = (0, https_1.onCall)({ memory: '512MiB' }, async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'User must be authenticated');
    }
    const { searchId } = request.data;
    if (!searchId) {
        throw new https_1.HttpsError('invalid-argument', 'Search ID is required');
    }
    const userId = request.auth.uid;
    try {
        await firebase_1.db
            .collection('users')
            .doc(userId)
            .collection('savedSearches')
            .doc(searchId)
            .update({
            newItemsCount: 0,
        });
        return { success: true };
    }
    catch (error) {
        console.error('Error marking saved search as viewed:', error);
        throw new https_1.HttpsError('internal', 'Failed to update saved search');
    }
});
//# sourceMappingURL=products.js.map