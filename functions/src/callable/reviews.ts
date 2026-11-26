/**
 * Reviews callable functions
 * Firebase Functions v7 - using onCall
 *
 * Handles user reviews/evaluations after completed transactions.
 * Reviews are tied to a specific transaction (vente/achat/swap).
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import {PHASE1_CONTRACT} from '../utils/phase1LegacyFence';
import * as logger from 'firebase-functions/logger';
import { db, FieldValue } from '../config/firebase';
import { prepareOperationalNotices } from '../utils/notifications';
import { publicProfileImage, articlePrivacyWithdrawn } from '../utils/publicProfile';
import {publicReviewVisible, visibleReviewSummary, prepareVisibleRating} from '../utils/reviewVisibility';
import { assertPrivateAccountSession, withPrivateAccountSession } from '../utils/privateAccountSession';
import {withFinancialRecoveryScope,assertFinancialRecoveryEffect} from '../utils/financialRecoveryInterlock';
import {assertLocalAgreementReadable} from '../utils/localAgreement';

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
  async (request) => withFinancialRecoveryScope({operation:'callable/reviews.createReview'},()=>withPrivateAccountSession(request, async () => {
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

    if (text.trim().length > 2000) {
      throw new HttpsError(
        'invalid-argument',
        'Review text too long',
      );
    }

    // Correction #8: basic profanity filter (FR)
    const PROFANITY_LIST = [
      'putain', 'merde', 'connard', 'connasse', 'enculé', 'enculer',
      'salaud', 'salope', 'batard', 'bâtard', 'nique', 'ntm', 'fdp',
      'pd ', 'pédé', 'tapette', 'gouine', 'négro', 'negro',
    ];
    const lowerText = text.toLowerCase();
    const hasProfanity = PROFANITY_LIST.some((word) => lowerText.includes(word));
    if (hasProfanity) {
      throw new HttpsError(
        'invalid-argument',
        'Votre avis contient des termes inappropriés. Veuillez le reformuler.',
      );
    }

    if (reviewerId === targetUserId) {
      throw new HttpsError(
        'invalid-argument',
        'Cannot review yourself',
      );
    }

    try {
      // ---------------------------------------------------------------
      // SECURITY: Verify the transaction exists, is completed, and the
      // caller is actually a party to it. Without this, any authed user
      // could submit a review for any other user with an arbitrary
      // transactionId.
      // ---------------------------------------------------------------
      const txDoc = await db.collection('transactions').doc(transactionId).get();
      if (!txDoc.exists) {
        throw new HttpsError('not-found', 'Transaction not found');
      }
      const txData = txDoc.data()!;

      // Terminal/completed statuses eligible for reviews:
      // - 'delivered': shipping order delivered (funds held during dispute window)
      // - 'completed': shipping order finalized after the dispute window
      // - 'meetup_completed': both parties confirmed an in-person exchange
      const terminalStatuses = new Set(['delivered', 'completed', 'meetup_completed']);
      if (!terminalStatuses.has(txData.status)) {
        throw new HttpsError(
          'failed-precondition',
          'Transaction must be completed before reviewing',
        );
      }

      // Correction #7: 60-day review window
      const completionDate = txData.completedAt?.toDate?.()
        || txData.deliveredAt?.toDate?.()
        || txData.meetupCompletedAt?.toDate?.();
      if (completionDate) {
        const daysSinceCompletion = (Date.now() - completionDate.getTime()) / (1000 * 60 * 60 * 24);
        if (daysSinceCompletion > 60) {
          // 'failed-precondition' (distinct from 'already-exists' for duplicates
          // and 'invalid-argument' for profanity) so the client (C-REVIEW) can
          // map this to a specific "review window expired" message.
          throw new HttpsError(
            'failed-precondition',
            'La période pour laisser un avis est expirée (60 jours).',
          );
        }
      }

      if (txData.buyerId !== reviewerId && txData.sellerId !== reviewerId) {
        throw new HttpsError('permission-denied', 'You are not a party to this transaction');
      }

      if (targetUserId !== txData.buyerId && targetUserId !== txData.sellerId) {
        throw new HttpsError('invalid-argument', 'Target must be the other party in the transaction');
      }

      if (targetUserId === reviewerId) {
        throw new HttpsError('invalid-argument', 'Cannot review yourself');
      }

      const reviewerRef = db.collection('users').doc(reviewerId);
      const targetDoc = await db.collection('users').doc(targetUserId).get();

      // Noter un compte supprimé créait un avis que personne ne verrait jamais
      // — la note est agrégée sur un profil qui n'existe plus — tout en
      // réinscrivant l'uid effacé dans une nouvelle collection, à rebours de la
      // suppression demandée.
      if (!targetDoc.exists) {
        throw new HttpsError(
          'failed-precondition',
          'Cette personne a supprimé son compte : aucun avis ne peut lui être laissé.',
        );
      }

      // Deterministic doc ID prevents duplicate reviews atomically:
      // two simultaneous calls will both try to set the same doc, and
      // only one will succeed because we check for existence inside
      // the transaction.
      const reviewDocId = `${reviewerId}_${transactionId}`;
      const reviewRef = db.collection('avis').doc(reviewDocId);

      await db.runTransaction(async (tx) => {
        await assertPrivateAccountSession(request, tx);
        const [existingSnap, currentReviewer, currentArticle, currentTransaction, currentTarget] = await Promise.all([tx.get(reviewRef), tx.get(reviewerRef),
          articleId ? tx.get(db.collection('articles').doc(articleId)) : Promise.resolve(null), tx.get(txDoc.ref), tx.get(targetDoc.ref)]);
        const reviewerData = currentReviewer.data() ?? {};
        if (existingSnap.exists) {
          throw new HttpsError(
            'already-exists',
            'You have already reviewed this transaction',
          );
        }

        const nativeTransaction = currentTransaction.data();
        if (!nativeTransaction || !terminalStatuses.has(nativeTransaction.status) || !currentTarget.exists ||
            ![nativeTransaction.buyerId, nativeTransaction.sellerId].includes(reviewerId) ||
            ![nativeTransaction.buyerId, nativeTransaction.sellerId].includes(targetUserId)) {
          throw new HttpsError('failed-precondition', 'La transaction ou le destinataire de cet avis a changé.');
        }
        const notices = await prepareOperationalNotices(tx, [{ eventKey: `review:${reviewDocId}:created`, userId: targetUserId,
          type: 'review_received', title: 'Nouvel avis reçu', message: `Un participant vous a laissé un avis ${note}/5. Consultez vos évaluations.`,
          data: { reviewId: reviewDocId, reviewerId } }]);

        const reviewData = {
          phase1Contract: PHASE1_CONTRACT,
          id: reviewDocId,
          reviewerId,
          reviewerName: reviewerData.displayName || 'Utilisateur',
          reviewerImage: publicProfileImage(reviewerData),
          // TODO: rename vendeurId to targetUserId in next schema migration
          vendeurId: targetUserId, // kept as 'vendeurId' for backwards compat with UserStatsService
          transactionId,
          transactionType,
          articleId: articleId || null,
          articleTitle: articlePrivacyWithdrawn(currentArticle?.data()) ? 'Annonce retirée pour confidentialité' : currentArticle?.data()?.title || null,
          note,
          text: text.trim(),
          createdAt: FieldValue.serverTimestamp(),
        };
        const rating = await prepareVisibleRating(tx, targetUserId, {id: reviewDocId, data: reviewData});
        if(process.env.FINANCIAL_RECOVERY_ENVIRONMENT==='unconfigured') {
          await assertFinancialRecoveryEffect('firestore_commit',{refs:[reviewRef.path]});
          assertLocalAgreementReadable('purchase',txDoc.ref.path,nativeTransaction);
        }
        tx.set(reviewRef, reviewData);
        rating.commit();
        notices.commit();
      });

      return {
        success: true,
        reviewId: reviewDocId,
        notificationCommitted: true, deviceDeliveryVerified: false, readingVerified: false,
      };
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      logger.error('[createReview]', error);
      throw new HttpsError('internal', 'Failed to create review');
    }
  })),
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

      const reviews: ReviewResponse[] = await Promise.all(snapshot.docs.filter(d => publicReviewVisible(d.data())).map(async (doc) => {
        const data = doc.data();
        const reviewer = typeof data.reviewerId === 'string' ? (await db.collection('users').doc(data.reviewerId).get()).data() : undefined;
        return {
          id: doc.id,
          reviewerId: data.reviewerId,
          reviewerName: data.reviewerName || 'Utilisateur',
          reviewerImage: publicProfileImage(reviewer) || undefined,
          note: data.note,
          text: data.text,
          transactionType: data.transactionType,
          articleTitle: data.articleTitle || undefined,
          createdAt: data.createdAt?.toDate?.()?.toISOString() || new Date().toISOString(),
        };
      }));

      // Get aggregate stats
      const allReviewsSnapshot = await db
        .collection('avis')
        .where('vendeurId', '==', userId)
        .limit(1001)
        .get();
      const summary = visibleReviewSummary(allReviewsSnapshot.docs.map(d => ({id: d.id, data: d.data()})), allReviewsSnapshot.size > 1000);

      return {
        reviews,
        totalReviews: summary.totalReviews,
        averageRating: summary.averageRating,
        reviewStatsQualification: summary.qualification,
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
      // Respect privacy preference: if showProfilePhoto is explicitly false, hide the image
      const profile = {
        id: userId,
        displayName: userData.displayName || 'Utilisateur',
        username: userData.username || null,
        profileImage: publicProfileImage(userData),
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
          // Keep candidates until the canonical client resolver has normalized
          // legacy strings/objects and discarded malformed entries.
          images: Array.isArray(data.images) ? data.images : [],
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

      // Reviews summary — use pre-calculated values from updateUserRating()
      // instead of recalculating from the limited (10) snapshot
      const totalReviews = userData.reviewCount ?? null;
      const averageRating = userData.rating ?? null;

      const reviews = await Promise.all(reviewsSnapshot.docs.filter(d => publicReviewVisible(d.data())).map(async (doc) => {
        const data = doc.data();
        const reviewer = typeof data.reviewerId === 'string' ? (await db.collection('users').doc(data.reviewerId).get()).data() : undefined;
        return {
          id: doc.id,
          reviewerName: data.reviewerName || 'Utilisateur',
          reviewerImage: publicProfileImage(reviewer),
          note: data.note,
          text: data.text,
          transactionType: data.transactionType,
          createdAt: data.createdAt?.toDate?.()?.toISOString(),
        };
      }));

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
          averageRating,
          reviewStatsQualification: userData.reviewStatsQualification ?? 'unknown',
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
 * Update aggregate rating on user document.
 * Exported so that swap rating (rateSwap) can also recalculate the target user's average.
 */
export async function updateUserRating(userId: string): Promise<void> {
  try {
    await db.runTransaction(async tx => {const rating = await prepareVisibleRating(tx, userId); rating.commit();});
  } catch (error) {
    logger.error('[updateUserRating]', error);
  }
}
