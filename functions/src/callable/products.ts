/**
 * Product callable functions
 * Firebase Functions v7 - using onCall
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import { db, FieldValue } from '../config/firebase';
import { matchBrand, BRAND_MATCHING } from '../services/brands';
import { brandDisplay } from '../utils/normalizeBrand';
import { sanitizeArticleSize } from '../shared/article';

/**
 * Normalise a raw brand string for storage.
 *
 * Strategy: canonical-otherwise-Title-Case.
 *  - If the brand matches a known entry in the `brands` collection (exact, or
 *    fuzzy with confidence >= strongThreshold), store the canonical name.
 *  - Otherwise store a clean Title Case version (handling DS exceptions like
 *    COS, A.P.C.).
 * Result is trimmed and truncated to 100 chars, as before.
 */
async function resolveBrand(rawBrand: string): Promise<string> {
  const trimmed = rawBrand.trim();
  if (trimmed.length === 0) return '';

  let resolved: string;
  try {
    const brandMatch = await matchBrand(trimmed);
    if (
      brandMatch.brandName &&
      (brandMatch.matchType === 'exact' ||
        brandMatch.confidence >= BRAND_MATCHING.strongThreshold)
    ) {
      // Use the canonical name from the brands collection.
      resolved = brandMatch.brandName;
    } else {
      // No confident match → clean Title Case.
      resolved = brandDisplay(trimmed);
    }
  } catch (error) {
    // Never block article create/update on brand matching failures.
    logger.warn('resolveBrand: matchBrand failed, falling back to Title Case', {
      rawBrand: trimmed,
      error: error instanceof Error ? error.message : String(error),
    });
    resolved = brandDisplay(trimmed);
  }

  return resolved.substring(0, 100);
}

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
 * Toggle article like/unlike.
 *
 * Canonical write contract (P1-3 / P1-4): the `favorites/{userId}.articleIds`
 * array is the single source of truth. The `onArticleFavorited` trigger reacts
 * to changes on that array and is the ONLY writer of the article engagement
 * counters (`favoritesCount` / `likes`) and the `search_index` likes, via
 * `FieldValue.increment`. This callable therefore mutates ONLY the favorites
 * doc — writing the counters here too would double-count against the trigger.
 *
 * The standard client path is `toggleFavorite` (which writes the same favorites
 * doc directly). This callable is kept as a server-side equivalent and must
 * stay aligned with that contract.
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
    const favoritesRef = db.collection('favorites').doc(userId);

    // Favorites doc only — arrayUnion/arrayRemove are idempotent, so no read is
    // needed. The onArticleFavorited trigger owns counter propagation.
    await favoritesRef.set(
      {
        userId,
        articleIds: isLiked
          ? FieldValue.arrayUnion(productId)
          : FieldValue.arrayRemove(productId),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

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
    // Always read the user doc once: we need it both for the displayName
    // fallback AND for the `showProfilePhoto` privacy preference that gates the
    // denormalized `sellerImage` (P2-4). The doc is the trusted source.
    let sellerName: string = data.sellerName || '';
    let sellerImage: string | null = data.sellerImage || null;

    const userSnap = await db.collection('users').doc(uid).get();
    const userData = userSnap.exists ? userSnap.data() : undefined;

    if (!sellerName) {
      sellerName = userData?.displayName || 'Utilisateur';
      sellerImage = sellerImage || userData?.profileImage || null;
    }

    // Privacy gate (P2-4): when the seller has explicitly turned off
    // `showProfilePhoto`, never denormalize their photo onto the article — even
    // if the client passed one (the client URL is untrusted for this purpose).
    // `undefined`/`true` keep the existing behaviour (photo shown by default).
    const showProfilePhoto = userData?.preferences?.privacy?.showProfilePhoto;
    if (showProfilePhoto === false) {
      sellerImage = null;
    }

    // NOTE: Stripe Custom account creation is no longer done silently at
    // article publish. Sellers must complete full in-app onboarding via
    // createStripeConnectAccount (identity, address, bank account) before
    // their shipping articles can be purchased. The createTransaction
    // callable enforces this check at purchase time.

    // ── 4b. Link to the seller's shop (P1-2) ──
    // If this seller owns an approved shop, stamp its id on the article so it
    // shows under the shop and feeds the shop's articlesCount trigger. Resolved
    // server-side from the trusted uid (never from client input). Best-effort:
    // a lookup failure must never block publishing — the field is simply omitted
    // (no boutique linked === no shopId, never `undefined`).
    let shopId: string | null = null;
    try {
      // Single equality filter on ownerId → covered by the automatic
      // single-field index (no composite index required). Approved-status
      // filtering is done in memory to avoid a composite index.
      const shopSnap = await db
        .collection('shops')
        .where('ownerId', '==', uid)
        .get();
      const approvedShop = shopSnap.docs.find(
        (d) => d.data()?.status === 'approved',
      );
      if (approvedShop) {
        shopId = approvedShop.id;
      }
    } catch (error) {
      logger.warn('createArticle: shop lookup failed, publishing without shopId', {
        sellerId: uid,
        error: error instanceof Error ? error.message : String(error),
      });
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
    // Shop link (P1-2) — only when the seller has an approved boutique.
    if (shopId) article.shopId = shopId;
    // Size — accept the ArticleSize object { value, system } (current client),
    // or a legacy plain string (back-compat → defaults to system 'EU').
    // On create there is no "erasure": a null/empty/malformed size simply omits
    // the field (never write undefined).
    const sanitizedSize = sanitizeArticleSize(data.size);
    if (sanitizedSize) {
      article.size = sanitizedSize;
    }
    if (typeof data.brand === 'string' && data.brand.trim()) {
      article.brand = await resolveBrand(data.brand);
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

    // Neighborhoods (meetup locations) — server-validate the MeetupNeighborhood
    // shape (P2-8). Each entry must carry non-empty id/name/borough strings;
    // anything malformed is rejected so we never persist garbage meetup data.
    if (Array.isArray(data.neighborhoods) && data.neighborhoods.length > 0) {
      const cleaned = data.neighborhoods
        .slice(0, 10)
        .map(sanitizeNeighborhood);
      if (cleaned.some((n: MeetupNeighborhood | null) => n === null)) {
        throw new HttpsError('invalid-argument', 'Quartier invalide');
      }
      article.neighborhoods = cleaned;
      article.neighborhood = cleaned[0];
    } else if (data.neighborhood && typeof data.neighborhood === 'object') {
      const cleaned = sanitizeNeighborhood(data.neighborhood);
      if (cleaned === null) {
        throw new HttpsError('invalid-argument', 'Quartier invalide');
      }
      article.neighborhood = cleaned;
      article.neighborhoods = [cleaned];
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
 * Update an existing article server-side with validation and sanitisation.
 *
 * The client sends { articleId, updates } where `updates` contains only the
 * modifiable fields. This callable validates ownership, prevents editing sold
 * articles, sanitises text inputs and applies price-drop tracking when the
 * price decreases.
 *
 * Returns { success: true }.
 */
export const updateArticle = onCall(
  { region: 'northamerica-northeast1', memory: '512MiB' },
  async (request) => {
    // ── 1. Auth check ──
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Utilisateur non connecte');
    }

    const uid = request.auth.uid;
    const { articleId, updates } = request.data ?? {};

    if (!articleId || typeof articleId !== 'string') {
      throw new HttpsError('invalid-argument', 'articleId requis');
    }
    if (!updates || typeof updates !== 'object') {
      throw new HttpsError('invalid-argument', 'updates requis');
    }

    // ── 2. Sanitise helper ──
    const stripHtml = (s: string): string =>
      s.replace(/<[^>]*>/g, '').trim();

    // ── 3. Validate individual fields from `updates` ──
    const sanitized: Record<string, unknown> = {};

    // Title
    if ('title' in updates) {
      if (
        typeof updates.title !== 'string' ||
        updates.title.trim().length < 3
      ) {
        throw new HttpsError(
          'invalid-argument',
          'Le titre doit contenir au moins 3 caracteres',
        );
      }
      sanitized.title = stripHtml(updates.title).substring(0, 200);
    }

    // Description
    if ('description' in updates) {
      if (typeof updates.description !== 'string') {
        throw new HttpsError('invalid-argument', 'Description invalide');
      }
      sanitized.description = stripHtml(updates.description).substring(0, 5000);
    }

    // Price
    if ('price' in updates) {
      if (
        typeof updates.price !== 'number' ||
        updates.price < 0.01 ||
        updates.price > 10000
      ) {
        throw new HttpsError(
          'invalid-argument',
          'Le prix doit etre entre 0.01 et 10 000 $',
        );
      }
      sanitized.price = updates.price;
    }

    // Condition
    const validConditions = ['neuf', 'très bon état', 'bon état', 'satisfaisant'];
    if ('condition' in updates) {
      if (!validConditions.includes(updates.condition)) {
        throw new HttpsError('invalid-argument', 'Condition invalide');
      }
      sanitized.condition = updates.condition;
    }

    // CategoryIds
    if ('categoryIds' in updates) {
      if (
        !Array.isArray(updates.categoryIds) ||
        updates.categoryIds.length === 0
      ) {
        throw new HttpsError(
          'invalid-argument',
          'Au moins une categorie est requise',
        );
      }
      sanitized.categoryIds = updates.categoryIds;
    }

    // Category (string)
    if ('category' in updates) {
      if (typeof updates.category === 'string') {
        sanitized.category = updates.category;
      }
    }

    // Images
    if ('images' in updates) {
      if (
        !Array.isArray(updates.images) ||
        updates.images.length === 0
      ) {
        throw new HttpsError(
          'invalid-argument',
          'Au moins une image est requise',
        );
      }
      if (updates.images.length > 10) {
        throw new HttpsError(
          'invalid-argument',
          'Maximum 10 images autorisees',
        );
      }
      for (const img of updates.images) {
        if (!img || typeof img.url !== 'string' || img.url.trim().length === 0) {
          throw new HttpsError(
            'invalid-argument',
            'Chaque image doit avoir une URL valide',
          );
        }
      }
      sanitized.images = updates.images.map(
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
    }

    // Optional scalar fields
    // Size — only touch when the caller sent the key. Accept the ArticleSize
    // object { value, system }, a legacy plain string (→ system 'EU'), or an
    // explicit null (erasure → store null). A malformed/empty value is ignored
    // (field left untouched, never write undefined).
    if ('size' in updates) {
      const sanitizedSize = sanitizeArticleSize(updates.size);
      if (sanitizedSize !== undefined) {
        sanitized.size = sanitizedSize; // ArticleSize object or null (erasure)
      }
    }
    if ('brand' in updates && typeof updates.brand === 'string') {
      sanitized.brand = await resolveBrand(updates.brand);
    }
    if ('pattern' in updates && typeof updates.pattern === 'string') {
      sanitized.pattern = updates.pattern.trim().substring(0, 100);
    }

    // Colors
    if ('colors' in updates && Array.isArray(updates.colors)) {
      sanitized.colors = updates.colors
        .filter((c: unknown) => typeof c === 'string')
        .slice(0, 20);
      sanitized.color = (sanitized.colors as string[])[0] || null;
    } else if ('color' in updates && typeof updates.color === 'string') {
      sanitized.color = updates.color.trim();
    }

    // Materials
    if ('materials' in updates && Array.isArray(updates.materials)) {
      sanitized.materials = updates.materials
        .filter((m: unknown) => typeof m === 'string')
        .slice(0, 20);
      sanitized.material = (sanitized.materials as string[])[0] || null;
    } else if ('material' in updates && typeof updates.material === 'string') {
      sanitized.material = updates.material.trim();
    }

    // Delivery options
    if ('isHandDelivery' in updates) {
      sanitized.isHandDelivery = updates.isHandDelivery === true;
    }
    if ('isShipping' in updates) {
      sanitized.isShipping = updates.isShipping === true;
    }

    // Package size
    const validPackageSizes = ['small', 'medium', 'large'];
    if (
      'packageSize' in updates &&
      typeof updates.packageSize === 'string' &&
      validPackageSizes.includes(updates.packageSize)
    ) {
      sanitized.packageSize = updates.packageSize;
    }

    // Neighborhoods
    if ('neighborhoods' in updates && Array.isArray(updates.neighborhoods)) {
      sanitized.neighborhoods = updates.neighborhoods.slice(0, 10);
      sanitized.neighborhood = updates.neighborhoods[0] || null;
    }

    // isActive (allow seller to deactivate/reactivate)
    if ('isActive' in updates && typeof updates.isActive === 'boolean') {
      sanitized.isActive = updates.isActive;
    }

    // Check we have at least one field to update
    if (Object.keys(sanitized).length === 0) {
      throw new HttpsError('invalid-argument', 'Aucun champ valide a mettre a jour');
    }

    // ── 4. Transaction lock: reject if an active transaction exists (P-LOCK) ──
    // Query BEFORE the Firestore transaction (queries not allowed inside tx).
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
        'Une transaction est en cours sur cet article. Modification impossible.',
      );
    }

    // ── 5. Transaction: ownership + sold/active check + price drop + write ──
    const articleRef = db.collection('articles').doc(articleId);

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(articleRef);
      if (!snap.exists) {
        throw new HttpsError('not-found', 'Article introuvable');
      }

      const existing = snap.data()!;

      // Ownership check
      if (existing.sellerId !== uid) {
        throw new HttpsError('permission-denied', 'Pas votre article');
      }

      // Block editing sold articles
      if (existing.isSold === true) {
        throw new HttpsError(
          'failed-precondition',
          'Impossible de modifier un article vendu',
        );
      }

      // Block editing deactivated articles (task #14)
      if (existing.isActive === false) {
        throw new HttpsError(
          'failed-precondition',
          'Impossible de modifier un article desactive',
        );
      }

      // Price drop tracking
      if (sanitized.price !== undefined && typeof sanitized.price === 'number') {
        const newPrice = sanitized.price as number;
        if (newPrice < existing.price) {
          // Price decreased → record (or refresh) the drop against the baseline.
          const originalPrice = existing.originalPrice || existing.price;
          const priceDropPercent = Math.round(
            ((originalPrice - newPrice) / originalPrice) * 100,
          );
          sanitized.originalPrice = originalPrice;
          sanitized.priceDropPercent = priceDropPercent;
          sanitized.lastPriceDropAt = FieldValue.serverTimestamp();
        } else if (
          existing.originalPrice !== undefined &&
          newPrice >= existing.originalPrice
        ) {
          // Price raised back to (or above) the original baseline → the drop no
          // longer holds. Clear the tracking fields so we never show a stale or
          // negative reduction. (delete() is a no-op if the field is absent.)
          sanitized.originalPrice = FieldValue.delete();
          sanitized.priceDropPercent = FieldValue.delete();
          sanitized.lastPriceDropAt = FieldValue.delete();
        }
      }

      // Always set updatedAt
      sanitized.updatedAt = FieldValue.serverTimestamp();

      tx.update(articleRef, sanitized);
    });

    logger.info('Article updated via callable', {
      articleId,
      sellerId: uid,
      updatedFields: Object.keys(sanitized).filter((k) => k !== 'updatedAt'),
    });

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
