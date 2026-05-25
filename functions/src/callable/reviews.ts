/**
 * Reviews callable functions
 * Firebase Functions v7 - using onCall
 *
 * Handles user reviews/evaluations after completed transactions.
 * Reviews are tied to a specific transaction (vente/achat/swap).
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import { db, FieldValue } from '../config/firebase';

// =============================================================================
// TYPES
// =============================================================================

interface ReviewData {
  targetUserId: string;
  transactionId: string;
  transactionType: 'achat' | 'vente' | 'swap';
  note: number; // 1-5
  text: string;
  articleId?: string;
}

interface ReviewResponse {
  id: string;
  reviewerId: string;
  reviewerName: string;
  reviewerImage?: string;
  note: number;
  text: string;
  transactionType: string;
  articleTitle?: string;
  createdAt: string;
}

// =============================================================================
// CREATE REVIEW
// =============================================================================

/**
 * Submit a review for another user after a completed transaction
 */
export const createReview = onCall(
  { region: 'northamerica-northeast1', memory: '512MiB' },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const { targetUserId, transactionId, transactionType, note, text, articleId } =
      request.data as ReviewData;
    const reviewerId = request.auth.uid;

    // Validate inputs
    if (!targetUserId || !transactionId || !transactionType) {
      throw new HttpsError(
        'invalid-argument',
        'targetUserId, transactionId, and transactionType are required',
      );
    }

    if (!note || note < 1 || note > 5) {
      throw new HttpsError(
        'invalid-argument',
        'note must be between 1 and 5',
      );
    }

    if (!text || text.trim().length < 5) {
      throw new HttpsError(
        'invalid-argument',
        'Review text must be at least 5 characters',
      );
    }

    if (reviewerId === targetUserId) {
      throw new HttpsError(
        'invalid-argument',
        'Cannot review yourself',
      );
    }

    try {
      // Check if review already exists for this transaction + reviewer
      const existingReview = await db
        .collection('avis')
        .where('reviewerId', '==', reviewerId)
        .where('transactionId', '==', transactionId)
        .limit(1)
        .get();

      if (!existingReview.empty) {
        throw new HttpsError(
          'already-exists',
          'You have already reviewed this transaction',
        );
      }

      // Get reviewer info
      const reviewerDoc = await db.collection('users').doc(reviewerId).get();
      const reviewerData = reviewerDoc.exists ? reviewerDoc.data()! : {};

      // Get article title if articleId provided
      let articleTitle: string | undefined;
      if (articleId) {
        const articleDoc = await db.collection('articles').doc(articleId).get();
        if (articleDoc.exists) {
          articleTitle = articleDoc.data()!.title;
        }
      }

      // Create the review
      const reviewRef = db.collection('avis').doc();
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
        createdAt: FieldValue.serverTimestamp(),
      };

      await reviewRef.set(reviewData);

      // Update target user's aggregate rating
      await updateUserRating(targetUserId);

      return {
        success: true,
        reviewId: reviewRef.id,
      };
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      logger.error('[createReview]', error);
      throw new HttpsError('internal', 'Failed to create review');
    }
  },
);

// =============================================================================
// GET USER REVIEWS
// =============================================================================

/**
 * Fetch reviews for a specific user with pagination
 */
export const getUserReviews = onCall(
  { region: 'northamerica-northeast1', memory: '512MiB' },
  async (request) => {
    const { userId, limit: limitCount, startAfter } = request.data;

    if (!userId) {
      throw new HttpsError('invalid-argument', 'userId is required');
    }

    const cappedLimit = Math.min(Math.max(1, limitCount || 20), 100);

    try {
      let query = db
        .collection('avis')
        .where('vendeurId', '==', userId)
        .orderBy('createdAt', 'desc')
        .limit(cappedLimit);

      if (startAfter) {
        const startDoc = await db.collection('avis').doc(startAfter).get();
        if (startDoc.exists) {
          query = query.startAfter(startDoc);
        }
      }

      const snapshot = await query.get();

      const reviews: ReviewResponse[] = snapshot.docs.map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          reviewerId: data.reviewerId,
          reviewerName: data.reviewerName || 'Utilisateur',
          reviewerImage: data.reviewerImage || undefined,
          note: data.note,
          text: data.text,
          transactionType: data.transactionType,
          articleTitle: data.articleTitle || undefined,
          createdAt: data.createdAt?.toDate?.()?.toISOString() || new Date().toISOString(),
        };
      });

      // Get aggregate stats
      const allReviewsSnapshot = await db
        .collection('avis')
        .where('vendeurId', '==', userId)
        .get();

      const allNotes = allReviewsSnapshot.docs.map((d) => d.data().note || 0);
      const totalReviews = allNotes.length;
      const averageRating =
        totalReviews > 0
          ? allNotes.reduce((sum, n) => sum + n, 0) / totalReviews
          : 0;

      return {
        reviews,
        totalReviews,
        averageRating: Math.round(averageRating * 10) / 10,
        hasMore: snapshot.docs.length === cappedLimit,
        lastDocId:
          snapshot.docs.length > 0
            ? snapshot.docs[snapshot.docs.length - 1].id
            : null,
      };
    } catch (error) {
      logger.error('[getUserReviews]', error);
      throw new HttpsError('internal', 'Failed to fetch reviews');
    }
  },
);

// =============================================================================
// GET USER PUBLIC PROFILE
// =============================================================================

/**
 * Fetch a user's public profile with stats, articles, and reviews summary
 * in a single call to avoid multiple round trips
 */
export const getUserPublicProfile = onCall(
  { region: 'northamerica-northeast1', memory: '512MiB' },
  async (request) => {
    const { userId } = request.data;
    const currentUserId = request.auth?.uid;

    if (!userId) {
      throw new HttpsError('invalid-argument', 'userId is required');
    }

    try {
      // Fetch user, articles, and reviews in parallel
      const [userDoc, articlesSnapshot, reviewsSnapshot] = await Promise.all([
        db.collection('users').doc(userId).get(),
        db
          .collection('articles')
          .where('sellerId', '==', userId)
          .where('isActive', '==', true)
          .orderBy('createdAt', 'desc')
          .limit(30)
          .get(),
        db
          .collection('avis')
          .where('vendeurId', '==', userId)
          .orderBy('createdAt', 'desc')
          .limit(10)
          .get(),
      ]);

      if (!userDoc.exists) {
        throw new HttpsError('not-found', 'User not found');
      }

      const userData = userDoc.data()!;

      // Build public profile (exclude sensitive fields)
      const profile = {
        id: userId,
        displayName: userData.displayName || 'Utilisateur',
        profileImage: userData.profileImage || null,
        bio: userData.bio || null,
        createdAt: userData.createdAt?.toDate?.()?.toISOString(),
        rating: userData.rating || null,
        accountType: userData.accountType || 'user',
        sellerLikesCount: userData.sellerLikesCount || 0,
      };

      // Articles (public data only)
      const articles = articlesSnapshot.docs.map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          title: data.title,
          price: data.price,
          images: data.images?.slice(0, 1) || [], // Only first image
          isSold: data.isSold || false,
          condition: data.condition,
          brand: data.brand,
        };
      });

      // Stats
      const allArticlesSnapshot = await db
        .collection('articles')
        .where('sellerId', '==', userId)
        .get();

      const allArticles = allArticlesSnapshot.docs.map((d) => d.data());
      const articlesEnVente = allArticles.filter(
        (a) => a.isActive && !a.isSold,
      ).length;
      const articlesVendus = allArticles.filter((a) => a.isSold).length;

      // Reviews summary
      const allReviews = reviewsSnapshot.docs.map((d) => d.data());
      const totalReviews = allReviews.length;
      const averageRating =
        totalReviews > 0
          ? allReviews.reduce((sum, r) => sum + (r.note || 0), 0) / totalReviews
          : 0;

      const reviews = reviewsSnapshot.docs.map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          reviewerName: data.reviewerName || 'Utilisateur',
          reviewerImage: data.reviewerImage || null,
          note: data.note,
          text: data.text,
          transactionType: data.transactionType,
          createdAt: data.createdAt?.toDate?.()?.toISOString(),
        };
      });

      // Check if current user is following this user
      let isFollowing = false;
      if (currentUserId) {
        const currentUserDoc = await db
          .collection('users')
          .doc(currentUserId)
          .get();
        if (currentUserDoc.exists) {
          const likedSellers = currentUserDoc.data()?.likedSellers || [];
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
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      logger.error('[getUserPublicProfile]', error);
      throw new HttpsError('internal', 'Failed to fetch user profile');
    }
  },
);

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Update aggregate rating on user document
 */
async function updateUserRating(userId: string): Promise<void> {
  try {
    const reviewsSnapshot = await db
      .collection('avis')
      .where('vendeurId', '==', userId)
      .get();

    const notes = reviewsSnapshot.docs.map((d) => d.data().note || 0);
    const totalReviews = notes.length;
    const averageRating =
      totalReviews > 0
        ? notes.reduce((sum, n) => sum + n, 0) / totalReviews
        : 0;

    await db
      .collection('users')
      .doc(userId)
      .update({
        rating: Math.round(averageRating * 10) / 10,
        reviewCount: totalReviews,
        updatedAt: FieldValue.serverTimestamp(),
      });
  } catch (error) {
    logger.error('[updateUserRating]', error);
  }
}
