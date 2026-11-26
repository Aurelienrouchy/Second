/**
 * Review Service
 * Client-side service for user reviews/evaluations
 *
 * Uses Firebase Cloud Functions for create/read operations.
 * Follows service pattern: async functions, no classes.
 */

import { doc, getDoc } from 'firebase/firestore';
import { phase1HttpsCallable as httpsCallable } from '@/services/phase1Callable';
import { firestore, functions } from '@/config/firebaseConfig';
import {isPublicReviewVisible} from '@/utils/reviewVisibility';

// =============================================================================
// TYPES
// =============================================================================

export interface Review {
  id: string;
  reviewerId: string;
  reviewerName: string;
  reviewerImage?: string;
  note: number;
  text: string;
  transactionType: 'achat' | 'vente' | 'swap';
  articleTitle?: string;
  createdAt: string;
}

export interface ReviewsResponse {
  reviews: Review[];
  totalReviews: number | null;
  averageRating: number | null;
  reviewStatsQualification?: 'native_visible_reviews' | 'unknown';
  hasMore: boolean;
  lastDocId: string | null;
}

export interface UserPublicProfile {
  profile: {
    id: string;
    displayName: string;
    username: string | null;
    profileImage: string | null;
    bio: string | null;
    createdAt: string;
    rating: number | null;
    accountType: 'user' | 'shop';
    sellerLikesCount: number;
  };
  articles: Array<{
    id: string;
    title: string;
    price: number;
    images: Array<{ url: string; blurhash?: string }>;
    isSold: boolean;
    condition: string;
    brand?: string;
  }>;
  stats: {
    articlesEnVente: number;
    articlesVendus: number;
    totalReviews: number | null;
    averageRating: number | null;
    reviewStatsQualification?: 'native_visible_reviews' | 'unknown';
    sellerLikesCount: number;
  };
  reviews: Review[];
  isFollowing: boolean;
}

// =============================================================================
// CALLABLE REFERENCES
// =============================================================================

const createReviewFn = httpsCallable(functions, 'createReview');
const getUserReviewsFn = httpsCallable(functions, 'getUserReviews');
const getUserPublicProfileFn = httpsCallable(functions, 'getUserPublicProfile');

// =============================================================================
// SERVICE FUNCTIONS
// =============================================================================

/**
 * Check if a user has already reviewed a specific transaction.
 * Uses the deterministic doc ID pattern: `${reviewerId}_${transactionId}`.
 * Requires authenticated user (Firestore rules on `avis/` enforce auth).
 */
export async function hasUserReviewedTransaction(
  reviewerId: string,
  transactionId: string,
): Promise<boolean> {
  try {
    const reviewDocId = `${reviewerId}_${transactionId}`;
    const reviewRef = doc(firestore, 'avis', reviewDocId);
    const reviewSnap = await getDoc(reviewRef);
    return reviewSnap.exists();
  } catch (error) {
    if (__DEV__) console.error('Error checking review existence:', error);
    return false;
  }
}

/**
 * Submit a review for another user after a completed transaction
 */
export async function createReview(params: {
  targetUserId: string;
  transactionId: string;
  transactionType: 'achat' | 'vente' | 'swap';
  note: number;
  text: string;
  articleId?: string;
}): Promise<{ success: boolean; reviewId: string }> {
  try {
    const result = await createReviewFn(params);
    return result.data as { success: boolean; reviewId: string };
  } catch (error) {
    if (__DEV__) console.error('Error creating review:', error);
    throw error;
  }
}

/**
 * Fetch reviews for a specific user with pagination
 */
export async function getUserReviews(params: {
  userId: string;
  limit?: number;
  startAfter?: string;
}): Promise<ReviewsResponse> {
  try {
    const result = await getUserReviewsFn(params);
    const response = result.data as ReviewsResponse;
    return {...response,reviews:response.reviews.filter(isPublicReviewVisible)};
  } catch (error) {
    if (__DEV__) console.error('Error fetching reviews:', error);
    throw error;
  }
}

/**
 * Fetch a user's complete public profile (user + stats + articles + reviews)
 * Single call to avoid multiple round trips
 */
export async function getUserPublicProfile(
  userId: string,
): Promise<UserPublicProfile> {
  try {
    const result = await getUserPublicProfileFn({ userId });
    const response = result.data as UserPublicProfile;
    return {...response,reviews:response.reviews.filter(isPublicReviewVisible)};
  } catch (error) {
    if (__DEV__) console.error('Error fetching user public profile:', error);
    throw error;
  }
}
