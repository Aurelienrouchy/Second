/**
 * Home page callable functions
 * Firebase Functions v7 - using onCall
 *
 * Each home section has its own dedicated callable.
 * N+1 seller fetches replaced with batchFetchSellerNames().
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db, FieldValue } from '../config/firebase';
import { brandKey, brandDisplay } from '../utils/normalizeBrand';

// =============================================================================
// SHARED TYPES
// =============================================================================

interface TrendingBrand {
  name: string;
  articleCount: number;
}

interface PriceDropArticle {
  id: string;
  title: string;
  brand?: string;
  price: number;
  originalPrice: number;
  reduction: string;
  images: Array<{ url: string; blurhash?: string }>;
  sellerId: string;
  sellerName: string;
}

interface FeaturedSeller {
  id: string;
  displayName: string;
  profileImage?: string;
  rating: number;
  articlesCount: number;
  sellerLikesCount: number;
}

interface Article {
  id: string;
  title: string;
  brand?: string;
  price: number;
  images: Array<{ url: string; blurhash?: string }>;
  sellerId: string;
  sellerName: string;
  size?: string;
  condition?: string;
}

// =============================================================================
// BATCH SELLER FETCH — eliminates N+1
// =============================================================================

/**
 * Fetch displayNames for a list of seller IDs in groups of 10
 * (Firestore 'in' operator limit).
 */
async function batchFetchSellerNames(
  sellerIds: string[]
): Promise<Map<string, string>> {
  const unique = [...new Set(sellerIds)];
  const map = new Map<string, string>();

  for (let i = 0; i < unique.length; i += 10) {
    const batch = unique.slice(i, i + 10);
    const snap = await db
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

async function _getTrendingBrands(): Promise<TrendingBrand[]> {
  const snapshot = await db
    .collection('articles')
    .where('isActive', '==', true)
    .where('isSold', '==', false)
    .limit(500)
    .get();

  // Group case-insensitively so "SELECTED" / "selected" / "Selected" merge
  // into a single bucket. Articles without a brand are skipped entirely.
  const brandCounts = new Map<string, number>();
  snapshot.docs.forEach((doc) => {
    const key = brandKey(doc.data().brand);
    if (!key) return; // skip empty / missing brands (no more "Unknown")
    brandCounts.set(key, (brandCounts.get(key) || 0) + 1);
  });

  return Array.from(brandCounts.entries())
    .map(([key, count]) => ({ name: brandDisplay(key), articleCount: count }))
    .sort((a, b) => b.articleCount - a.articleCount)
    .slice(0, 10);
}

async function _getPriceDrops(): Promise<PriceDropArticle[]> {
  // Use a targeted query with composite index instead of full-scan + client filter.
  // Requires index: {isActive ASC, isSold ASC, lastPriceDropAt DESC}
  const snapshot = await db
    .collection('articles')
    .where('isActive', '==', true)
    .where('isSold', '==', false)
    .where('lastPriceDropAt', '!=', null)
    .orderBy('lastPriceDropAt', 'desc')
    .limit(20)
    .get();

  if (snapshot.docs.length === 0) return [];

  // Single batch read for all sellers — no N+1
  const sellerMap = await batchFetchSellerNames(
    snapshot.docs.map((d) => d.data().sellerId)
  );

  const items: PriceDropArticle[] = snapshot.docs.reduce<PriceDropArticle[]>(
    (acc, doc) => {
      const data = doc.data();
      const originalPrice = data.originalPrice || data.price;
      // Guard: only surface a price-drop badge when there is a real reduction.
      if (!originalPrice || originalPrice <= data.price) return acc;
      const reductionPercent = Math.round(
        ((originalPrice - data.price) / originalPrice) * 100
      );
      acc.push({
        id: doc.id,
        title: data.title,
        brand: data.brand,
        price: data.price,
        originalPrice,
        reduction: `-${reductionPercent}%`,
        images: data.images || [],
        sellerId: data.sellerId,
        sellerName: sellerMap.get(data.sellerId) || 'Unknown',
      });
      return acc;
    },
    []
  );

  return items.sort((a, b) => {
    const aP = parseInt(a.reduction.replace(/[^0-9]/g, ''), 10) || 0;
    const bP = parseInt(b.reduction.replace(/[^0-9]/g, ''), 10) || 0;
    return bP - aP;
  });
}

async function _getFeaturedSellers(): Promise<FeaturedSeller[]> {
  const snapshot = await db
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

async function _getNewArrivals(
  lastDocId: string | null,
  limit: number = 20
): Promise<{ articles: Article[]; lastDocId: string | null }> {
  let query: FirebaseFirestore.Query = db
    .collection('articles')
    .where('isActive', '==', true)
    .where('isSold', '==', false)
    .orderBy('createdAt', 'desc')
    .limit(limit + 1);

  if (lastDocId) {
    const lastDoc = await db.collection('articles').doc(lastDocId).get();
    if (lastDoc.exists) {
      query = query.startAfter(lastDoc);
    }
  }

  const snapshot = await query.get();
  const docs = snapshot.docs.slice(0, Math.min(snapshot.docs.length, limit));

  if (docs.length === 0) return { articles: [], lastDocId: null };

  // Single batch read for all sellers — no N+1
  const sellerMap = await batchFetchSellerNames(
    docs.map((d) => d.data().sellerId)
  );

  const articles: Article[] = docs.map((doc) => {
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
      size: data.size?.value ?? null,
      condition: data.condition,
    };
  });

  const nextLastDocId =
    snapshot.docs.length > limit ? snapshot.docs[limit - 1].id : null;

  return { articles, lastDocId: nextLastDocId };
}

// =============================================================================
// INDIVIDUAL CALLABLE FUNCTIONS — one per home section
// =============================================================================

/** Trending brands section */
export const getTrendingBrands = onCall(
  { region: 'northamerica-northeast1', invoker: 'public', memory: '512MiB', timeoutSeconds: 15 },
  async () => {
    try {
      return await _getTrendingBrands();
    } catch (error) {
      console.error('[getTrendingBrands]', error);
      throw new HttpsError('internal', 'Failed to load trending brands');
    }
  }
);

/** Price drops section */
export const getPriceDrops = onCall(
  { region: 'northamerica-northeast1', invoker: 'public', memory: '512MiB', timeoutSeconds: 15 },
  async () => {
    try {
      return await _getPriceDrops();
    } catch (error) {
      console.error('[getPriceDrops]', error);
      throw new HttpsError('internal', 'Failed to load price drops');
    }
  }
);

/** Featured sellers section */
export const getFeaturedSellers = onCall(
  { region: 'northamerica-northeast1', invoker: 'public', memory: '512MiB', timeoutSeconds: 15 },
  async () => {
    try {
      return await _getFeaturedSellers();
    } catch (error) {
      console.error('[getFeaturedSellers]', error);
      throw new HttpsError('internal', 'Failed to load featured sellers');
    }
  }
);

/** New arrivals — first page for Nouveautés + cursor pagination for Discover */
export const getNewArrivals = onCall(
  { region: 'northamerica-northeast1', invoker: 'public', memory: '512MiB', timeoutSeconds: 15 },
  async (request) => {
    try {
      const { lastDocId = null, limit = 20 } = request.data ?? {};
      return await _getNewArrivals(lastDocId, limit);
    } catch (error) {
      console.error('[getNewArrivals]', error);
      throw new HttpsError('internal', 'Failed to load new arrivals');
    }
  }
);

// =============================================================================
// LEGACY — kept for any existing callers during migration
// =============================================================================

/** @deprecated Use the individual section callables instead. */
export const getHomeFeed = onCall(
  { region: 'northamerica-northeast1', invoker: 'public', memory: '512MiB', timeoutSeconds: 30 },
  async () => {
    try {
      const [trendingBrands, priceDrops, featuredSellers, newArrivals] =
        await Promise.all([
          _getTrendingBrands(),
          _getPriceDrops(),
          _getFeaturedSellers(),
          _getNewArrivals(null, 20),
        ]);
      return { trendingBrands, priceDrops, featuredSellers, newArrivals };
    } catch (error) {
      console.error('[getHomeFeed]', error);
      throw new HttpsError('internal', 'Failed to load home feed');
    }
  }
);

// =============================================================================
// SELLER LIKE
// =============================================================================

export const toggleSellerLike = onCall(
  { region: 'northamerica-northeast1', memory: '512MiB' },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const { sellerId, isLiked } = request.data;
    const userId = request.auth.uid;

    if (!sellerId || typeof isLiked !== 'boolean') {
      throw new HttpsError(
        'invalid-argument',
        'sellerId and isLiked status are required'
      );
    }

    if (sellerId === userId) {
      throw new HttpsError(
        'invalid-argument',
        'Vous ne pouvez pas vous abonner à vous-même'
      );
    }

    try {
      const userRef = db.collection('users').doc(userId);
      const sellerRef = db.collection('users').doc(sellerId);

      await db.runTransaction(async (transaction) => {
        const userDoc = await transaction.get(userRef);
        const sellerDoc = await transaction.get(sellerRef);

        if (!sellerDoc.exists) {
          throw new HttpsError('not-found', 'Seller not found');
        }

        const userData = userDoc.exists ? userDoc.data() ?? {} : {};
        const sellerData = sellerDoc.data()!;
        let likedSellers =
          (userData as Record<string, any>).likedSellers || [];
        const currentLikesCount = sellerData.sellerLikesCount || 0;

        if (isLiked && !likedSellers.includes(sellerId)) {
          likedSellers.push(sellerId);
          transaction.set(
            userRef,
            { likedSellers, updatedAt: FieldValue.serverTimestamp() },
            { merge: true }
          );
          transaction.update(sellerRef, {
            sellerLikesCount: currentLikesCount + 1,
            updatedAt: FieldValue.serverTimestamp(),
          });
        } else if (!isLiked && likedSellers.includes(sellerId)) {
          likedSellers = likedSellers.filter((id: string) => id !== sellerId);
          transaction.set(
            userRef,
            { likedSellers, updatedAt: FieldValue.serverTimestamp() },
            { merge: true }
          );
          transaction.update(sellerRef, {
            sellerLikesCount: Math.max(0, currentLikesCount - 1),
            updatedAt: FieldValue.serverTimestamp(),
          });
        }
      });

      return { success: true };
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      console.error('[toggleSellerLike]', error);
      throw new HttpsError('internal', 'Failed to update seller like status');
    }
  }
);

export const getLikedSellers = onCall(
  { region: 'northamerica-northeast1', memory: '512MiB' },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    try {
      const userDoc = await db
        .collection('users')
        .doc(request.auth.uid)
        .get();

      if (!userDoc.exists) return { sellers: [] };

      const likedSellerIds: string[] = userDoc.data()?.likedSellers ?? [];
      if (likedSellerIds.length === 0) return { sellers: [] };

      const sellers: FeaturedSeller[] = [];
      for (let i = 0; i < likedSellerIds.length; i += 10) {
        const batch = likedSellerIds.slice(i, i + 10);
        const snap = await db
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
    } catch (error) {
      console.error('[getLikedSellers]', error);
      throw new HttpsError('internal', 'Failed to load liked sellers');
    }
  }
);

export const recordPriceDrop = onCall(
  { region: 'northamerica-northeast1', memory: '512MiB' },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const { productId, oldPrice, newPrice } = request.data;
    const userId = request.auth.uid;

    if (
      !productId ||
      typeof oldPrice !== 'number' ||
      typeof newPrice !== 'number'
    ) {
      throw new HttpsError(
        'invalid-argument',
        'productId, oldPrice, and newPrice are required'
      );
    }

    if (newPrice >= oldPrice) {
      throw new HttpsError(
        'invalid-argument',
        'New price must be lower than old price'
      );
    }

    try {
      const productRef = db.collection('articles').doc(productId);

      await db.runTransaction(async (transaction) => {
        const productDoc = await transaction.get(productRef);

        if (!productDoc.exists) {
          throw new HttpsError('not-found', 'Product not found');
        }

        const productData = productDoc.data()!;
        if (productData.sellerId !== userId) {
          throw new HttpsError(
            'permission-denied',
            'You can only record price drops for your own products'
          );
        }

        const originalPrice = productData.originalPrice || productData.price;
        const priceDropPercent = Math.round(
          ((oldPrice - newPrice) / originalPrice) * 100
        );

        transaction.update(productRef, {
          price: newPrice,
          originalPrice,
          priceDropPercent,
          lastPriceDropAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
      });

      return { success: true };
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      console.error('[recordPriceDrop]', error);
      throw new HttpsError('internal', 'Failed to record price drop');
    }
  }
);
