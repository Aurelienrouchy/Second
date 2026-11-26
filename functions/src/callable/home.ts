/**
 * Home page callable functions
 * Firebase Functions v7 - using onCall
 *
 * Each home section has its own dedicated callable.
 * N+1 seller fetches replaced with batchFetchSellerNames().
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { Timestamp } from 'firebase-admin/firestore';
import { db, FieldValue } from '../config/firebase';
import { brandKey, brandDisplay } from '../utils/normalizeBrand';
import { publicProfileImage } from '../utils/publicProfile';
import { assertPrivateAccountSession, withPrivateAccountSession } from '../utils/privateAccountSession';

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
  profileImage?: string | null;
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

// La section lit jusqu'à 500 articles par appel et son classement bouge
// lentement : on garde le résultat une heure par instance chaude.
const TRENDING_BRANDS_TTL_MS = 60 * 60 * 1000;
let trendingBrandsCache: { at: number; brands: TrendingBrand[] } | null = null;

async function _getTrendingBrands(): Promise<TrendingBrand[]> {
  if (trendingBrandsCache && Date.now() - trendingBrandsCache.at < TRENDING_BRANDS_TTL_MS) {
    return trendingBrandsCache.brands;
  }

  const snapshot = await db
    .collection('articles')
    .where('isActive', '==', true)
    .where('isSold', '==', false)
    // Le nombre de lectures facturées ne change pas, mais chaque document
    // arrive sans ses images, sa description ni son tableau de mots-clés.
    .select('brand')
    .limit(500)
    .get();

  // Group case-insensitively so "SELECTED" / "selected" / "Selected" merge
  // into a single bucket. Articles without a brand are skipped entirely.
  const brandCounts = new Map<string, number>();
  const brandLabels = new Map<string, string>();
  snapshot.docs.forEach((doc) => {
    const raw = doc.data().brand;
    const key = brandKey(raw);
    if (!key) return; // skip empty / missing brands (no more "Unknown")
    brandCounts.set(key, (brandCounts.get(key) || 0) + 1);
    // On affiche la marque telle qu'elle est écrite sur les articles : la
    // reconstruction depuis la clé normalisée rendait « MSGM » en « Msgm ».
    if (!brandLabels.has(key)) brandLabels.set(key, String(raw).trim());
  });

  const brands = Array.from(brandCounts.entries())
    .map(([key, count]) => ({
      name: brandLabels.get(key) || brandDisplay(key),
      articleCount: count,
    }))
    .sort((a, b) => b.articleCount - a.articleCount)
    .slice(0, 10);

  trendingBrandsCache = { at: Date.now(), brands };
  return brands;
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
      profileImage: publicProfileImage(data),
      rating: data.rating || 0,
      articlesCount: data.articlesCount || 0,
      sellerLikesCount: data.sellerLikesCount || 0,
    };
  });
}

const SHOP_PROJECTION = 'shop_public_projection_v1';
const shopRecord = (value: unknown): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
const shopText = (value: unknown, max = 2000): string => typeof value === 'string' && value.length <= max ? value : '';
const shopCount = (value: unknown): number => Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : 0;
const shopCoordinate = (value: unknown, maximum: number): number | null =>
  typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= maximum ? value : null;
function shopDate(value: unknown): string | null {
  if (!(value instanceof Timestamp)) return null;
  try { return value.toDate().toISOString(); } catch { return null; }
}
/** Construct every nested public field. Legacy maps, provider references,
 * verification notes and fiscal/bank data must never be spread into a DTO. */
function projectShop(id: string, raw: FirebaseFirestore.DocumentData) {
  const address = shopRecord(raw.address), location = shopRecord(raw.location), social = shopRecord(raw.socialMedia), hours = shopRecord(raw.openingHours);
  const openingHours = Object.fromEntries(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map(day => {
    const value = shopRecord(hours[day]);
    return [day, typeof value.open === 'string' && typeof value.close === 'string'
      ? {open: shopText(value.open, 20), close: shopText(value.close, 20)} : null];
  }));
  return { id, ownerId: shopText(raw.ownerId, 128), name: shopText(raw.name, 300), description: shopText(raw.description, 8000), type: shopText(raw.type, 100),
    address: {street: shopText(address.street, 500), city: shopText(address.city, 200), postalCode: shopText(address.postalCode, 30), country: shopText(address.country, 100)},
    location: {latitude: shopCoordinate(location.latitude, 90), longitude: shopCoordinate(location.longitude, 180)},
    phoneNumber: shopText(raw.phoneNumber, 100), email: shopText(raw.email, 320), website: shopText(raw.website, 2048),
    socialMedia: {instagram: shopText(social.instagram, 2048), facebook: shopText(social.facebook, 2048)}, openingHours,
    logo: shopText(raw.logo, 2048), images: Array.isArray(raw.images) ? raw.images.filter((image: unknown) => typeof image === 'string' && image.length <= 2048).slice(0, 10) as string[] : [],
    status: ['approved', 'pending', 'rejected', 'suspended'].includes(raw.status) ? raw.status as string : null,
    tier: ['basic', 'pro', 'premium'].includes(raw.tier) ? raw.tier as string : 'basic', tierPaidUntil: shopDate(raw.tierPaidUntil),
    rating: typeof raw.rating === 'number' && Number.isFinite(raw.rating) && raw.rating >= 0 && raw.rating <= 5 ? raw.rating : null,
    reviewCount: shopCount(raw.reviewCount), articlesCount: shopCount(raw.articlesCount), createdAt: shopDate(raw.createdAt), updatedAt: shopDate(raw.updatedAt) };
}
function shopDocumentId(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 200 || value !== value.trim() || value.includes('/') ||
      value === '.' || value === '..' || /^__.*__$/.test(value)) throw new HttpsError('invalid-argument', 'Référence de boutique invalide.');
  return value;
}
function shopDistanceKm(latitude: number, longitude: number, targetLatitude: number, targetLongitude: number): number {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const a = Math.sin(radians(targetLatitude - latitude) / 2) ** 2 + Math.cos(radians(latitude)) * Math.cos(radians(targetLatitude)) * Math.sin(radians(targetLongitude - longitude) / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(Math.min(1, a)), Math.sqrt(Math.max(0, 1 - a)));
}
async function readShopProjection(request: any) {
  const data = shopRecord(request.data);
  if (data.capability !== SHOP_PROJECTION || !['detail', 'approved_page', 'nearby_page'].includes(data.mode)) {
    throw new HttpsError('invalid-argument', 'Version et mode de lecture de boutique requis.');
  }
  const keys = data.mode === 'detail' ? ['capability', 'mode', 'shopId', 'scope', 'expectedUid'] :
    ['capability', 'mode', 'cursor', 'limit', ...(data.mode === 'nearby_page' ? ['latitude', 'longitude', 'radiusKm'] : [])];
  if (Object.keys(data).some(key => !keys.includes(key))) throw new HttpsError('invalid-argument', 'Paramètres de lecture de boutique invalides.');
  if (data.mode === 'detail') {
    const id = shopDocumentId(data.shopId), scope = data.scope ?? 'public';
    if (!['public', 'owner_or_admin'].includes(scope) || scope === 'public' && data.expectedUid !== undefined) {
      throw new HttpsError('invalid-argument', 'Portée de lecture de boutique invalide.');
    }
    const read = () => db.runTransaction(async tx => {
      const session = scope === 'owner_or_admin' ? await assertPrivateAccountSession(request, tx) : null;
      const native = (await tx.get(db.collection('shops').doc(id))).data();
      if (!native) return null;
      if (scope === 'public') return native.status === 'approved' ? projectShop(id, native) : null;
      if (native.ownerId !== session!.uid) {
        const admin = (await tx.get(db.collection('users').doc(session!.uid))).data();
        if (admin && Object.prototype.hasOwnProperty.call(admin, 'isActive') && admin.isActive !== true ||
            !session!.currentAdminClaim && admin?.isAdmin !== true) throw new HttpsError('permission-denied', 'Boutique privée non autorisée.');
      }
      return projectShop(id, native);
    });
    if (scope === 'public') return {protocol: SHOP_PROJECTION, mode: 'detail', shop: await read()};
    if (!request.auth || data.expectedUid !== request.auth.uid) throw new HttpsError('permission-denied', 'Le compte de lecture privée a changé.');
    return withPrivateAccountSession(request, async () => {
      await read(); // Qualify before I/O; the final read rechecks role/owner and source.
      return {protocol: SHOP_PROJECTION, mode: 'detail', shop: await read()};
    });
  }
  const limit = data.limit ?? 20;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20) throw new HttpsError('invalid-argument', 'Page de boutique invalide.');
  const cursor = data.cursor == null ? null : shopDocumentId(data.cursor);
  let latitude: number | null = null, longitude: number | null = null;
  const radiusKm = data.radiusKm ?? 10;
  if (data.mode === 'nearby_page') {
    latitude = shopCoordinate(data.latitude, 90); longitude = shopCoordinate(data.longitude, 180);
    if (latitude === null || longitude === null || typeof radiusKm !== 'number' || !Number.isFinite(radiusKm) || radiusKm < 1 || radiusKm > 100) {
      throw new HttpsError('invalid-argument', 'Position ou rayon de boutique invalide.');
    }
  }
  let query = db.collection('shops').where('status', '==', 'approved').orderBy('__name__').limit(limit + 1);
  if (cursor) query = query.startAfter(cursor);
  const snapshot = await query.get(), inspected = snapshot.docs.slice(0, limit), shops = [];
  for (const document of inspected) {
    const native = document.data();
    if (native.status !== 'approved') continue;
    const shop = projectShop(document.id, native);
    if (data.mode === 'nearby_page' && (shop.location.latitude === null || shop.location.longitude === null ||
        shopDistanceKm(latitude!, longitude!, shop.location.latitude, shop.location.longitude) > radiusKm)) continue;
    shops.push(shop);
  }
  const hasMore = snapshot.size > limit;
  return {protocol: SHOP_PROJECTION, mode: data.mode, shops, nextCursor: hasMore ? inspected.at(-1)!.id : null,
    coverage: {scanned: inspected.length, limit, hasMore, exhaustive: false}};
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
  async (request) => {
    if (request.data?.capability !== undefined) return readShopProjection(request);
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
  async (request) => withPrivateAccountSession(request, async () => {
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
        await assertPrivateAccountSession(request, transaction);
        const userDoc = await transaction.get(userRef);
        const sellerDoc = await transaction.get(sellerRef);

        // On ne peut évidemment pas s'abonner à un compte qui n'existe plus.
        // Mais s'en DÉSABONNER doit rester possible : le compte suivi a pu être
        // supprimé après coup, et le refus indistinct enfermait l'abonné avec un
        // suivi fantôme qu'aucun écran ne lui montrait et qu'il ne pouvait pas
        // retirer.
        if (!sellerDoc.exists && isLiked) {
          throw new HttpsError('not-found', 'Seller not found');
        }

        const userData = userDoc.exists ? userDoc.data() ?? {} : {};
        const sellerData = sellerDoc.exists ? sellerDoc.data()! : null;
        let likedSellers =
          (userData as Record<string, any>).likedSellers || [];
        const currentLikesCount = sellerData?.sellerLikesCount || 0;

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
          // Le compteur d'un compte supprimé n'a plus de porteur : un
          // `update` sur un document absent ferait échouer toute la transaction.
          if (sellerData) {
            transaction.update(sellerRef, {
              sellerLikesCount: Math.max(0, currentLikesCount - 1),
              updatedAt: FieldValue.serverTimestamp(),
            });
          }
        }
      });

      return { success: true };
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      console.error('[toggleSellerLike]', error);
      throw new HttpsError('internal', 'Failed to update seller like status');
    }
  })
);

export const getLikedSellers = onCall(
  { region: 'northamerica-northeast1', memory: '512MiB' },
  async (request) => withPrivateAccountSession(request, async () => {
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
            profileImage: publicProfileImage(data),
            rating: data.rating || 0,
            articlesCount: data.articlesCount || 0,
            sellerLikesCount: data.sellerLikesCount || 0,
          });
        });
      }

      return { sellers };
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      console.error('[getLikedSellers]', error);
      throw new HttpsError('internal', 'Failed to load liked sellers');
    }
  })
);

/**
 * Désactivée. Aucun code de l'app ne l'appelle, mais elle était déployée et
 * appelable par tout compte connecté : elle écrivait `price` sans borne, sans
 * verrou « vendu », « désactivé » ni « transaction en cours », et fabriquait
 * une baisse à partir d'un `oldPrice` fourni par l'appelant. `updateArticle`
 * fait le suivi de baisse avec toutes ces gardes. L'export reste le temps que
 * la fonction soit supprimée de la production
 * (`firebase functions:delete recordPriceDrop --region northamerica-northeast1`) :
 * retirer l'export seul laisserait la version ouverte en ligne.
 */
export const recordPriceDrop = onCall(
  { region: 'northamerica-northeast1', memory: '512MiB' },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }
    throw new HttpsError(
      'failed-precondition',
      'Le prix se modifie depuis la fiche de l’article (updateArticle).',
    );
  }
);
