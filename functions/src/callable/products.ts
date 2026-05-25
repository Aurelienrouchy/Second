/**
 * Product callable functions
 * Firebase Functions v7 - using onCall
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db, FieldValue } from '../config/firebase';

/**
 * Increment product view count
 */
export const incrementProductView = onCall(
  { region: 'northamerica-northeast1', memory: '512MiB' },
  async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'User must be authenticated');
  }

  const { productId } = request.data;

  if (!productId) {
    throw new HttpsError('invalid-argument', 'Product ID is required');
  }

  try {
    const productRef = db.collection('products').doc(productId);
    const searchIndexRef = db.collection('search_index').doc(productId);

    // Use transaction to ensure consistency
    await db.runTransaction(async (transaction) => {
      const productDoc = await transaction.get(productRef);

      if (!productDoc.exists) {
        throw new HttpsError('not-found', 'Product not found');
      }

      const currentViews = productDoc.data()?.views || 0;
      const newViews = currentViews + 1;

      // Update product views
      transaction.update(productRef, { views: newViews });

      // Update search index views
      transaction.update(searchIndexRef, { views: newViews });
    });

    return { success: true, message: 'View count incremented' };
  } catch (error) {
    console.error('Error incrementing product view:', error);
    throw new HttpsError('internal', 'Failed to increment view count');
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
export const toggleProductLike = onCall({ region: 'northamerica-northeast1', memory: '512MiB' }, async (request) => {
  const { productId, isLiked } = request.data;

  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'User must be authenticated');
  }

  if (!productId || typeof isLiked !== 'boolean') {
    throw new HttpsError(
      'invalid-argument',
      'Product ID and like status are required'
    );
  }

  const userId = request.auth.uid;

  try {
    const productRef = db.collection('products').doc(productId);
    const articleRef = db.collection('articles').doc(productId);
    const searchIndexRef = db.collection('search_index').doc(productId);
    const favoritesRef = db.collection('favorites').doc(userId);

    await db.runTransaction(async (transaction) => {
      const productDoc = await transaction.get(productRef);

      if (!productDoc.exists) {
        throw new HttpsError('not-found', 'Product not found');
      }

      const productData = productDoc.data()!;
      const currentLikes = productData.likes || 0;
      const likedBy: string[] = productData.likedBy || [];

      let newLikes = currentLikes;
      let newLikedBy = [...likedBy];

      if (isLiked && !likedBy.includes(userId)) {
        newLikes = currentLikes + 1;
        newLikedBy.push(userId);
      } else if (!isLiked && likedBy.includes(userId)) {
        newLikes = Math.max(0, currentLikes - 1);
        newLikedBy = likedBy.filter((id: string) => id !== userId);
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
        transaction.set(
          favoritesRef,
          {
            userId,
            articleIds: FieldValue.arrayUnion(productId),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      } else {
        transaction.set(
          favoritesRef,
          {
            userId,
            articleIds: FieldValue.arrayRemove(productId),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }
    });

    return { success: true, message: 'Like status updated' };
  } catch (error) {
    console.error('Error toggling product like:', error);
    throw new HttpsError('internal', 'Failed to update like status');
  }
});

/**
 * Mark saved search as viewed (resets newItemsCount)
 */
export const markSavedSearchViewed = onCall({ region: 'northamerica-northeast1', memory: '512MiB' }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'User must be authenticated');
  }

  const { searchId } = request.data;
  if (!searchId) {
    throw new HttpsError('invalid-argument', 'Search ID is required');
  }

  const userId = request.auth.uid;

  try {
    await db
      .collection('users')
      .doc(userId)
      .collection('savedSearches')
      .doc(searchId)
      .update({
        newItemsCount: 0,
      });

    return { success: true };
  } catch (error: unknown) {
    console.error('Error marking saved search as viewed:', error);
    throw new HttpsError('internal', 'Failed to update saved search');
  }
});
