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
  { invoker: 'public', memory: '512MiB' },
  async (request) => {
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
 */
export const toggleProductLike = onCall({ memory: '512MiB' }, async (request) => {
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
    const searchIndexRef = db.collection('search_index').doc(productId);
    const favoritesRef = db.collection('favorites').doc(userId);

    await db.runTransaction(async (transaction) => {
      const productDoc = await transaction.get(productRef);

      if (!productDoc.exists) {
        throw new HttpsError('not-found', 'Product not found');
      }

      const productData = productDoc.data()!;
      const currentLikes = productData.likes || 0;
      const likedBy = productData.likedBy || [];

      let newLikes = currentLikes;
      let newLikedBy = [...likedBy];

      if (isLiked && !likedBy.includes(userId)) {
        // Add like
        newLikes = currentLikes + 1;
        newLikedBy.push(userId);
      } else if (!isLiked && likedBy.includes(userId)) {
        // Remove like
        newLikes = Math.max(0, currentLikes - 1);
        newLikedBy = likedBy.filter((id: string) => id !== userId);
      }

      // Update product
      transaction.update(productRef, {
        likes: newLikes,
        likedBy: newLikedBy,
      });

      // Update search index
      transaction.update(searchIndexRef, {
        likes: newLikes,
      });

      // Update user favorites
      if (isLiked) {
        const favoriteData = {
          productId,
          addedAt: FieldValue.serverTimestamp(),
          productTitle: productData.title,
          productPrice: productData.price,
          productImage: productData.images?.[0]?.url || null,
          sellerId: productData.sellerId,
        };

        transaction.set(
          favoritesRef,
          {
            userId,
            products: FieldValue.arrayUnion(favoriteData),
            totalCount: FieldValue.increment(1),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      } else {
        // Remove from favorites
        const favoritesDoc = await transaction.get(favoritesRef);
        if (favoritesDoc.exists) {
          const favoritesData = favoritesDoc.data()!;
          const updatedProducts = (favoritesData.products || []).filter(
            (p: { productId: string }) => p.productId !== productId
          );

          transaction.update(favoritesRef, {
            products: updatedProducts,
            totalCount: updatedProducts.length,
            updatedAt: FieldValue.serverTimestamp(),
          });
        }
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
export const markSavedSearchViewed = onCall({ memory: '512MiB' }, async (request) => {
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
