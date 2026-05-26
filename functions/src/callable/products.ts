/**
 * Product callable functions
 * Firebase Functions v7 - using onCall
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import { db, FieldValue } from '../config/firebase';

/**
 * Increment article view count
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
    const articleRef = db.collection('articles').doc(productId);
    const searchIndexRef = db.collection('search_index').doc(productId);

    // Use transaction to ensure consistency
    await db.runTransaction(async (transaction) => {
      const articleDoc = await transaction.get(articleRef);

      if (!articleDoc.exists) {
        throw new HttpsError('not-found', 'Article not found');
      }

      const currentViews = articleDoc.data()?.views || 0;
      const newViews = currentViews + 1;

      // Update article views
      transaction.update(articleRef, { views: newViews });

      // Update search index views (set+merge in case doc doesn't exist yet)
      transaction.set(searchIndexRef, { views: newViews }, { merge: true });
    });

    return { success: true, message: 'View count incremented' };
  } catch (error) {
    logger.error('Error incrementing article view:', error);
    throw new HttpsError('internal', 'Failed to increment view count');
  }
});

/**
 * Toggle article like/unlike
 *
 * Updates atomically in a single transaction:
 * 1. articles/{productId} — likes counter + likedBy array + favoritesCount
 * 2. search_index/{productId} — likes for ranking
 * 3. favorites/{userId} — articleIds array (unified structure)
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
    const articleRef = db.collection('articles').doc(productId);
    const searchIndexRef = db.collection('search_index').doc(productId);
    const favoritesRef = db.collection('favorites').doc(userId);

    await db.runTransaction(async (transaction) => {
      const articleDoc = await transaction.get(articleRef);

      if (!articleDoc.exists) {
        throw new HttpsError('not-found', 'Article not found');
      }

      const articleData = articleDoc.data()!;
      const currentLikes = articleData.likes || 0;
      const likedBy: string[] = articleData.likedBy || [];

      let newLikes = currentLikes;
      let newLikedBy = [...likedBy];

      if (isLiked && !likedBy.includes(userId)) {
        newLikes = currentLikes + 1;
        newLikedBy.push(userId);
      } else if (!isLiked && likedBy.includes(userId)) {
        newLikes = Math.max(0, currentLikes - 1);
        newLikedBy = likedBy.filter((id: string) => id !== userId);
      }

      // 1. Update article likes + likedBy + favoritesCount
      transaction.update(articleRef, {
        likes: newLikes,
        likedBy: newLikedBy,
        favoritesCount: newLikes,
      });

      // 2. Update search index for ranking (set+merge in case doc doesn't exist yet)
      transaction.set(searchIndexRef, { likes: newLikes }, { merge: true });

      // 3. Unified favorites — articleIds array only
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
    logger.error('Error toggling article like:', error);
    throw new HttpsError('internal', 'Failed to update like status');
  }
});

/**
 * Create article server-side with validation and sanitisation.
 *
 * The client uploads images to Storage first, then passes the download URLs
 * here. This callable validates every field, sanitises text inputs (strip
 * HTML, trim, enforce length bounds), and creates the article atomically.
 *
 * Returns { articleId: string }.
 */
export const createArticle = onCall(
  { region: 'northamerica-northeast1', memory: '512MiB' },
  async (request) => {
    // ── 1. Auth check ──
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Utilisateur non connecte');
    }
    // Email verification required before publishing.
    // Google/Apple sign-in users always have email_verified: true.
    if (!request.auth.token.email_verified) {
      throw new HttpsError(
        'permission-denied',
        'Veuillez verifier votre adresse e-mail avant de publier.',
      );
    }
    const uid = request.auth.uid;
    const data = request.data;

    // ── 2. Validate required fields ──
    if (!data || typeof data !== 'object') {
      throw new HttpsError('invalid-argument', 'Donnees manquantes');
    }

    // Title
    if (
      !data.title ||
      typeof data.title !== 'string' ||
      data.title.trim().length < 3
    ) {
      throw new HttpsError(
        'invalid-argument',
        'Le titre doit contenir au moins 3 caracteres',
      );
    }

    // Price
    if (
      data.price == null ||
      typeof data.price !== 'number' ||
      data.price < 0.01 ||
      data.price > 10000
    ) {
      throw new HttpsError(
        'invalid-argument',
        'Le prix doit etre entre 0.01 et 10 000 $',
      );
    }

    // Images — at least one image object with a url string
    if (
      !data.images ||
      !Array.isArray(data.images) ||
      data.images.length === 0
    ) {
      throw new HttpsError(
        'invalid-argument',
        'Au moins une image est requise',
      );
    }
    // Client limit: 5, server safety limit: 10
    if (data.images.length > 10) {
      throw new HttpsError(
        'invalid-argument',
        'Maximum 10 images autorisees',
      );
    }
    for (const img of data.images) {
      if (!img || typeof img.url !== 'string' || img.url.trim().length === 0) {
        throw new HttpsError(
          'invalid-argument',
          'Chaque image doit avoir une URL valide',
        );
      }
    }

    // Condition
    const validConditions = [
      'neuf',
      'très bon état',
      'bon état',
      'satisfaisant',
    ];
    if (data.condition && !validConditions.includes(data.condition)) {
      throw new HttpsError(
        'invalid-argument',
        'Condition invalide',
      );
    }

    // CategoryIds (required by publish flow)
    if (
      !data.categoryIds ||
      !Array.isArray(data.categoryIds) ||
      data.categoryIds.length === 0
    ) {
      throw new HttpsError(
        'invalid-argument',
        'Au moins une categorie est requise',
      );
    }

    // ── 3. Sanitise text fields ──
    const stripHtml = (s: string): string =>
      s.replace(/<[^>]*>/g, '').trim();

    const sanitizedTitle = stripHtml(data.title).substring(0, 200);
    const sanitizedDescription = data.description
      ? stripHtml(String(data.description)).substring(0, 5000)
      : '';

    // ── 4. Fetch seller info from Auth / Firestore ──
    let sellerName: string = data.sellerName || '';
    let sellerImage: string | null = data.sellerImage || null;

    if (!sellerName) {
      // Try to get displayName from Firestore user doc
      const userSnap = await db.collection('users').doc(uid).get();
      if (userSnap.exists) {
        const userData = userSnap.data();
        sellerName = userData?.displayName || 'Utilisateur';
        sellerImage = sellerImage || userData?.profileImage || null;
      } else {
        sellerName = 'Utilisateur';
      }
    }

    // ── 5. Build sanitised images array ──
    const sanitizedImages: { url: string; blurhash?: string }[] =
      data.images.map(
        (img: { url: string; blurhash?: string }) => {
          const entry: { url: string; blurhash?: string } = {
            url: img.url.trim(),
          };
          if (img.blurhash && typeof img.blurhash === 'string') {
            entry.blurhash = img.blurhash;
          }
          return entry;
        },
      );

    // ── 6. Build the article document ──
    // Only include defined fields (no undefined → Firestore rejects them)
    const article: Record<string, unknown> = {
      sellerId: uid,
      sellerName,
      title: sanitizedTitle,
      description: sanitizedDescription,
      price: data.price,
      images: sanitizedImages,
      category: typeof data.category === 'string' ? data.category : '',
      categoryIds: data.categoryIds,
      condition: data.condition || 'très bon état',
      isActive: sanitizedImages.length > 0,
      isSold: false,
      isHandDelivery: data.isHandDelivery === true,
      isShipping: data.isShipping === true,
      views: 0,
      likes: 0,
      likedBy: [],
      favoritesCount: 0,
      moderationStatus: 'approved',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };

    // Optional scalar fields
    if (sellerImage) article.sellerImage = sellerImage;
    if (typeof data.size === 'string' && data.size.trim()) {
      article.size = data.size.trim().substring(0, 50);
    }
    if (typeof data.brand === 'string' && data.brand.trim()) {
      article.brand = data.brand.trim().substring(0, 100);
    }
    if (typeof data.pattern === 'string' && data.pattern.trim()) {
      article.pattern = data.pattern.trim().substring(0, 100);
    }

    // Colors — multi-select + backward compat single value
    if (Array.isArray(data.colors) && data.colors.length > 0) {
      article.colors = data.colors
        .filter((c: unknown) => typeof c === 'string')
        .slice(0, 20);
      article.color = (article.colors as string[])[0] || null;
    } else if (typeof data.color === 'string' && data.color.trim()) {
      article.color = data.color.trim();
    }

    // Materials — multi-select + backward compat single value
    if (Array.isArray(data.materials) && data.materials.length > 0) {
      article.materials = data.materials
        .filter((m: unknown) => typeof m === 'string')
        .slice(0, 20);
      article.material = (article.materials as string[])[0] || null;
    } else if (typeof data.material === 'string' && data.material.trim()) {
      article.material = data.material.trim();
    }

    // Neighborhoods (meetup locations)
    if (Array.isArray(data.neighborhoods) && data.neighborhoods.length > 0) {
      article.neighborhoods = data.neighborhoods.slice(0, 10);
      article.neighborhood = data.neighborhoods[0];
    } else if (data.neighborhood && typeof data.neighborhood === 'object') {
      article.neighborhood = data.neighborhood;
      article.neighborhoods = [data.neighborhood];
    }

    // Package size
    const validPackageSizes = ['small', 'medium', 'large'];
    if (
      typeof data.packageSize === 'string' &&
      validPackageSizes.includes(data.packageSize)
    ) {
      article.packageSize = data.packageSize;
    }

    // ── 7. Create in Firestore ──
    const docRef = await db.collection('articles').add(article);

    logger.info('Article created via callable', {
      articleId: docRef.id,
      sellerId: uid,
      title: sanitizedTitle,
      imagesCount: sanitizedImages.length,
    });

    return { articleId: docRef.id };
  },
);

/**
 * Toggle article sold status (mark as sold / unmark)
 *
 * Only the seller can toggle. Rejects if an active transaction exists
 * on this article (pending, meetup_pending, meetup_confirmed,
 * shipping_pending, shipping_in_transit).
 */
export const toggleArticleSold = onCall(
  { region: 'northamerica-northeast1', memory: '512MiB' },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Non connecte');
    }

    const { articleId } = request.data;
    if (!articleId || typeof articleId !== 'string') {
      throw new HttpsError('invalid-argument', 'articleId requis');
    }

    const uid = request.auth.uid;
    const articleRef = db.collection('articles').doc(articleId);

    // Query for active transactions BEFORE the transaction (Firestore
    // transactions only support doc gets via t.get(), not queries).
    const activeTransactions = await db
      .collection('transactions')
      .where('articleId', '==', articleId)
      .where('status', 'in', [
        'pending',
        'meetup_pending',
        'meetup_confirmed',
        'shipping_pending',
        'shipping_in_transit',
      ])
      .limit(1)
      .get();

    if (!activeTransactions.empty) {
      throw new HttpsError(
        'failed-precondition',
        'Une transaction est en cours sur cet article',
      );
    }

    await db.runTransaction(async (t) => {
      const doc = await t.get(articleRef);
      if (!doc.exists) {
        throw new HttpsError('not-found', 'Article introuvable');
      }

      const data = doc.data()!;
      if (data.sellerId !== uid) {
        throw new HttpsError('permission-denied', 'Pas votre article');
      }

      const newSoldState = !data.isSold;
      t.update(articleRef, {
        isSold: newSoldState,
        updatedAt: FieldValue.serverTimestamp(),
      });
    });

    logger.info('Article sold status toggled', { articleId, sellerId: uid });
    return { success: true };
  },
);

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
    logger.error('Error marking saved search as viewed:', error);
    throw new HttpsError('internal', 'Failed to update saved search');
  }
});
