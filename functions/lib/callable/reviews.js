"use strict";
/**
 * Reviews callable functions
 * Firebase Functions v7 - using onCall
 *
 * Handles user reviews/evaluations after completed transactions.
 * Reviews are tied to a specific transaction (vente/achat/swap).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getUserPublicProfile = exports.getUserReviews = exports.createReview = void 0;
const https_1 = require("firebase-functions/v2/https");
const firebase_1 = require("../config/firebase");
// =============================================================================
// CREATE REVIEW
// =============================================================================
/**
 * Submit a review for another user after a completed transaction
 */
exports.createReview = (0, https_1.onCall)({ memory: '512MiB' }, async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'User must be authenticated');
    }
    const { targetUserId, transactionId, transactionType, note, text, articleId } = request.data;
    const reviewerId = request.auth.uid;
    // Validate inputs
    if (!targetUserId || !transactionId || !transactionType) {
        throw new https_1.HttpsError('invalid-argument', 'targetUserId, transactionId, and transactionType are required');
    }
    if (!note || note < 1 || note > 5) {
        throw new https_1.HttpsError('invalid-argument', 'note must be between 1 and 5');
    }
    if (!text || text.trim().length < 5) {
        throw new https_1.HttpsError('invalid-argument', 'Review text must be at least 5 characters');
    }
    if (reviewerId === targetUserId) {
        throw new https_1.HttpsError('invalid-argument', 'Cannot review yourself');
    }
    try {
        // Check if review already exists for this transaction + reviewer
        const existingReview = await firebase_1.db
            .collection('avis')
            .where('reviewerId', '==', reviewerId)
            .where('transactionId', '==', transactionId)
            .limit(1)
            .get();
        if (!existingReview.empty) {
            throw new https_1.HttpsError('already-exists', 'You have already reviewed this transaction');
        }
        // Get reviewer info
        const reviewerDoc = await firebase_1.db.collection('users').doc(reviewerId).get();
        const reviewerData = reviewerDoc.exists ? reviewerDoc.data() : {};
        // Get article title if articleId provided
        let articleTitle;
        if (articleId) {
            const articleDoc = await firebase_1.db.collection('articles').doc(articleId).get();
            if (articleDoc.exists) {
                articleTitle = articleDoc.data().title;
            }
        }
        // Create the review
        const reviewRef = firebase_1.db.collection('avis').doc();
        const reviewData = {
            id: reviewRef.id,
            reviewerId,
            reviewerName: reviewerData.displayName || 'Utilisateur',
            reviewerImage: reviewerData.profileImage || null,
            vendeurId: targetUserId, // kept as 'vendeurId' for backwards compat with UserStatsService
            transactionId,
            transactionType,
            articleId: articleId || null,
            articleTitle: articleTitle || null,
            note,
            text: text.trim(),
            createdAt: firebase_1.FieldValue.serverTimestamp(),
        };
        await reviewRef.set(reviewData);
        // Update target user's aggregate rating
        await updateUserRating(targetUserId);
        return {
            success: true,
            reviewId: reviewRef.id,
        };
    }
    catch (error) {
        if (error instanceof https_1.HttpsError)
            throw error;
        console.error('[createReview]', error);
        throw new https_1.HttpsError('internal', 'Failed to create review');
    }
});
// =============================================================================
// GET USER REVIEWS
// =============================================================================
/**
 * Fetch reviews for a specific user with pagination
 */
exports.getUserReviews = (0, https_1.onCall)({ memory: '512MiB' }, async (request) => {
    const { userId, limit: limitCount = 20, startAfter } = request.data;
    if (!userId) {
        throw new https_1.HttpsError('invalid-argument', 'userId is required');
    }
    try {
        let query = firebase_1.db
            .collection('avis')
            .where('vendeurId', '==', userId)
            .orderBy('createdAt', 'desc')
            .limit(limitCount);
        if (startAfter) {
            const startDoc = await firebase_1.db.collection('avis').doc(startAfter).get();
            if (startDoc.exists) {
                query = query.startAfter(startDoc);
            }
        }
        const snapshot = await query.get();
        const reviews = snapshot.docs.map((doc) => {
            var _a, _b, _c;
            const data = doc.data();
            return {
                id: doc.id,
                reviewerName: data.reviewerName || 'Utilisateur',
                reviewerImage: data.reviewerImage || undefined,
                note: data.note,
                text: data.text,
                transactionType: data.transactionType,
                articleTitle: data.articleTitle || undefined,
                createdAt: ((_c = (_b = (_a = data.createdAt) === null || _a === void 0 ? void 0 : _a.toDate) === null || _b === void 0 ? void 0 : _b.call(_a)) === null || _c === void 0 ? void 0 : _c.toISOString()) || new Date().toISOString(),
            };
        });
        // Get aggregate stats
        const allReviewsSnapshot = await firebase_1.db
            .collection('avis')
            .where('vendeurId', '==', userId)
            .get();
        const allNotes = allReviewsSnapshot.docs.map((d) => d.data().note || 0);
        const totalReviews = allNotes.length;
        const averageRating = totalReviews > 0
            ? allNotes.reduce((sum, n) => sum + n, 0) / totalReviews
            : 0;
        return {
            reviews,
            totalReviews,
            averageRating: Math.round(averageRating * 10) / 10,
            hasMore: snapshot.docs.length === limitCount,
            lastDocId: snapshot.docs.length > 0
                ? snapshot.docs[snapshot.docs.length - 1].id
                : null,
        };
    }
    catch (error) {
        console.error('[getUserReviews]', error);
        throw new https_1.HttpsError('internal', 'Failed to fetch reviews');
    }
});
// =============================================================================
// GET USER PUBLIC PROFILE
// =============================================================================
/**
 * Fetch a user's public profile with stats, articles, and reviews summary
 * in a single call to avoid multiple round trips
 */
exports.getUserPublicProfile = (0, https_1.onCall)({ memory: '512MiB' }, async (request) => {
    var _a, _b, _c, _d, _e;
    const { userId } = request.data;
    const currentUserId = (_a = request.auth) === null || _a === void 0 ? void 0 : _a.uid;
    if (!userId) {
        throw new https_1.HttpsError('invalid-argument', 'userId is required');
    }
    try {
        // Fetch user, articles, and reviews in parallel
        const [userDoc, articlesSnapshot, reviewsSnapshot] = await Promise.all([
            firebase_1.db.collection('users').doc(userId).get(),
            firebase_1.db
                .collection('articles')
                .where('sellerId', '==', userId)
                .where('isActive', '==', true)
                .orderBy('createdAt', 'desc')
                .limit(30)
                .get(),
            firebase_1.db
                .collection('avis')
                .where('vendeurId', '==', userId)
                .orderBy('createdAt', 'desc')
                .limit(10)
                .get(),
        ]);
        if (!userDoc.exists) {
            throw new https_1.HttpsError('not-found', 'User not found');
        }
        const userData = userDoc.data();
        // Build public profile (exclude sensitive fields)
        const profile = {
            id: userId,
            displayName: userData.displayName || 'Utilisateur',
            profileImage: userData.profileImage || null,
            bio: userData.bio || null,
            createdAt: (_d = (_c = (_b = userData.createdAt) === null || _b === void 0 ? void 0 : _b.toDate) === null || _c === void 0 ? void 0 : _c.call(_b)) === null || _d === void 0 ? void 0 : _d.toISOString(),
            rating: userData.rating || null,
            accountType: userData.accountType || 'user',
            sellerLikesCount: userData.sellerLikesCount || 0,
        };
        // Articles (public data only)
        const articles = articlesSnapshot.docs.map((doc) => {
            var _a;
            const data = doc.data();
            return {
                id: doc.id,
                title: data.title,
                price: data.price,
                images: ((_a = data.images) === null || _a === void 0 ? void 0 : _a.slice(0, 1)) || [], // Only first image
                isSold: data.isSold || false,
                condition: data.condition,
                brand: data.brand,
            };
        });
        // Stats
        const allArticlesSnapshot = await firebase_1.db
            .collection('articles')
            .where('sellerId', '==', userId)
            .get();
        const allArticles = allArticlesSnapshot.docs.map((d) => d.data());
        const articlesEnVente = allArticles.filter((a) => a.isActive && !a.isSold).length;
        const articlesVendus = allArticles.filter((a) => a.isSold).length;
        // Reviews summary
        const allReviews = reviewsSnapshot.docs.map((d) => d.data());
        const totalReviews = allReviews.length;
        const averageRating = totalReviews > 0
            ? allReviews.reduce((sum, r) => sum + (r.note || 0), 0) / totalReviews
            : 0;
        const reviews = reviewsSnapshot.docs.map((doc) => {
            var _a, _b, _c;
            const data = doc.data();
            return {
                id: doc.id,
                reviewerName: data.reviewerName || 'Utilisateur',
                reviewerImage: data.reviewerImage || null,
                note: data.note,
                text: data.text,
                transactionType: data.transactionType,
                createdAt: (_c = (_b = (_a = data.createdAt) === null || _a === void 0 ? void 0 : _a.toDate) === null || _b === void 0 ? void 0 : _b.call(_a)) === null || _c === void 0 ? void 0 : _c.toISOString(),
            };
        });
        // Check if current user is following this user
        let isFollowing = false;
        if (currentUserId) {
            const currentUserDoc = await firebase_1.db
                .collection('users')
                .doc(currentUserId)
                .get();
            if (currentUserDoc.exists) {
                const likedSellers = ((_e = currentUserDoc.data()) === null || _e === void 0 ? void 0 : _e.likedSellers) || [];
                isFollowing = likedSellers.includes(userId);
            }
        }
        return {
            profile,
            articles,
            stats: {
                articlesEnVente,
                articlesVendus,
                totalReviews,
                averageRating: Math.round(averageRating * 10) / 10,
                sellerLikesCount: userData.sellerLikesCount || 0,
            },
            reviews,
            isFollowing,
        };
    }
    catch (error) {
        if (error instanceof https_1.HttpsError)
            throw error;
        console.error('[getUserPublicProfile]', error);
        throw new https_1.HttpsError('internal', 'Failed to fetch user profile');
    }
});
// =============================================================================
// HELPERS
// =============================================================================
/**
 * Update aggregate rating on user document
 */
async function updateUserRating(userId) {
    try {
        const reviewsSnapshot = await firebase_1.db
            .collection('avis')
            .where('vendeurId', '==', userId)
            .get();
        const notes = reviewsSnapshot.docs.map((d) => d.data().note || 0);
        const totalReviews = notes.length;
        const averageRating = totalReviews > 0
            ? notes.reduce((sum, n) => sum + n, 0) / totalReviews
            : 0;
        await firebase_1.db
            .collection('users')
            .doc(userId)
            .update({
            rating: Math.round(averageRating * 10) / 10,
            reviewCount: totalReviews,
            updatedAt: firebase_1.FieldValue.serverTimestamp(),
        });
    }
    catch (error) {
        console.error('[updateUserRating]', error);
    }
}
//# sourceMappingURL=reviews.js.map