"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.markSavedSearchViewed = exports.updateArticle = exports.toggleArticleSold = exports.createArticle = exports.toggleProductLike = exports.incrementProductView = void 0;
/**
 * Product callable functions
 * Firebase Functions v7 - using onCall
 */
const https_1 = require("firebase-functions/v2/https");
const logger = __importStar(require("firebase-functions/logger"));
const firebase_1 = require("../config/firebase");
const brands_1 = require("../services/brands");
const normalizeBrand_1 = require("../utils/normalizeBrand");
const article_1 = require("../shared/article");
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
async function resolveBrand(rawBrand) {
    const trimmed = rawBrand.trim();
    if (trimmed.length === 0)
        return '';
    let resolved;
    try {
        const brandMatch = await (0, brands_1.matchBrand)(trimmed);
        if (brandMatch.brandName &&
            (brandMatch.matchType === 'exact' ||
                brandMatch.confidence >= brands_1.BRAND_MATCHING.strongThreshold)) {
            // Use the canonical name from the brands collection.
            resolved = brandMatch.brandName;
        }
        else {
            // No confident match → clean Title Case.
            resolved = (0, normalizeBrand_1.brandDisplay)(trimmed);
        }
    }
    catch (error) {
        // Never block article create/update on brand matching failures.
        logger.warn('resolveBrand: matchBrand failed, falling back to Title Case', {
            rawBrand: trimmed,
            error: error instanceof Error ? error.message : String(error),
        });
        resolved = (0, normalizeBrand_1.brandDisplay)(trimmed);
    }
    return resolved.substring(0, 100);
}
/**
 * Increment article view count
 */
exports.incrementProductView = (0, https_1.onCall)({ region: 'northamerica-northeast1', memory: '512MiB' }, async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'User must be authenticated');
    }
    const { productId } = request.data;
    if (!productId) {
        throw new https_1.HttpsError('invalid-argument', 'Product ID is required');
    }
    try {
        const articleRef = firebase_1.db.collection('articles').doc(productId);
        const searchIndexRef = firebase_1.db.collection('search_index').doc(productId);
        // Use transaction to ensure consistency
        await firebase_1.db.runTransaction(async (transaction) => {
            var _a;
            const articleDoc = await transaction.get(articleRef);
            if (!articleDoc.exists) {
                throw new https_1.HttpsError('not-found', 'Article not found');
            }
            const currentViews = ((_a = articleDoc.data()) === null || _a === void 0 ? void 0 : _a.views) || 0;
            const newViews = currentViews + 1;
            // Update article views
            transaction.update(articleRef, { views: newViews });
            // Update search index views (set+merge in case doc doesn't exist yet)
            transaction.set(searchIndexRef, { views: newViews }, { merge: true });
        });
        return { success: true, message: 'View count incremented' };
    }
    catch (error) {
        logger.error('Error incrementing article view:', error);
        throw new https_1.HttpsError('internal', 'Failed to increment view count');
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
exports.toggleProductLike = (0, https_1.onCall)({ region: 'northamerica-northeast1', memory: '512MiB' }, async (request) => {
    const { productId, isLiked } = request.data;
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'User must be authenticated');
    }
    if (!productId || typeof isLiked !== 'boolean') {
        throw new https_1.HttpsError('invalid-argument', 'Product ID and like status are required');
    }
    const userId = request.auth.uid;
    try {
        const articleRef = firebase_1.db.collection('articles').doc(productId);
        const searchIndexRef = firebase_1.db.collection('search_index').doc(productId);
        const favoritesRef = firebase_1.db.collection('favorites').doc(userId);
        await firebase_1.db.runTransaction(async (transaction) => {
            const articleDoc = await transaction.get(articleRef);
            if (!articleDoc.exists) {
                throw new https_1.HttpsError('not-found', 'Article not found');
            }
            const articleData = articleDoc.data();
            const currentLikes = articleData.likes || 0;
            const likedBy = articleData.likedBy || [];
            let newLikes = currentLikes;
            let newLikedBy = [...likedBy];
            if (isLiked && !likedBy.includes(userId)) {
                newLikes = currentLikes + 1;
                newLikedBy.push(userId);
            }
            else if (!isLiked && likedBy.includes(userId)) {
                newLikes = Math.max(0, currentLikes - 1);
                newLikedBy = likedBy.filter((id) => id !== userId);
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
                transaction.set(favoritesRef, {
                    userId,
                    articleIds: firebase_1.FieldValue.arrayUnion(productId),
                    updatedAt: firebase_1.FieldValue.serverTimestamp(),
                }, { merge: true });
            }
            else {
                transaction.set(favoritesRef, {
                    userId,
                    articleIds: firebase_1.FieldValue.arrayRemove(productId),
                    updatedAt: firebase_1.FieldValue.serverTimestamp(),
                }, { merge: true });
            }
        });
        return { success: true, message: 'Like status updated' };
    }
    catch (error) {
        logger.error('Error toggling article like:', error);
        throw new https_1.HttpsError('internal', 'Failed to update like status');
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
exports.createArticle = (0, https_1.onCall)({ region: 'northamerica-northeast1', memory: '512MiB' }, async (request) => {
    // ── 1. Auth check ──
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'Utilisateur non connecte');
    }
    // Email verification required before publishing.
    // Google/Apple sign-in users always have email_verified: true.
    if (!request.auth.token.email_verified) {
        throw new https_1.HttpsError('permission-denied', 'Veuillez verifier votre adresse e-mail avant de publier.');
    }
    const uid = request.auth.uid;
    const data = request.data;
    // ── 2. Validate required fields ──
    if (!data || typeof data !== 'object') {
        throw new https_1.HttpsError('invalid-argument', 'Donnees manquantes');
    }
    // Title
    if (!data.title ||
        typeof data.title !== 'string' ||
        data.title.trim().length < 3) {
        throw new https_1.HttpsError('invalid-argument', 'Le titre doit contenir au moins 3 caracteres');
    }
    // Price
    if (data.price == null ||
        typeof data.price !== 'number' ||
        data.price < 0.01 ||
        data.price > 10000) {
        throw new https_1.HttpsError('invalid-argument', 'Le prix doit etre entre 0.01 et 10 000 $');
    }
    // Images — at least one image object with a url string
    if (!data.images ||
        !Array.isArray(data.images) ||
        data.images.length === 0) {
        throw new https_1.HttpsError('invalid-argument', 'Au moins une image est requise');
    }
    // Client limit: 5, server safety limit: 10
    if (data.images.length > 10) {
        throw new https_1.HttpsError('invalid-argument', 'Maximum 10 images autorisees');
    }
    for (const img of data.images) {
        if (!img || typeof img.url !== 'string' || img.url.trim().length === 0) {
            throw new https_1.HttpsError('invalid-argument', 'Chaque image doit avoir une URL valide');
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
        throw new https_1.HttpsError('invalid-argument', 'Condition invalide');
    }
    // CategoryIds (required by publish flow)
    if (!data.categoryIds ||
        !Array.isArray(data.categoryIds) ||
        data.categoryIds.length === 0) {
        throw new https_1.HttpsError('invalid-argument', 'Au moins une categorie est requise');
    }
    // ── 3. Sanitise text fields ──
    const stripHtml = (s) => s.replace(/<[^>]*>/g, '').trim();
    const sanitizedTitle = stripHtml(data.title).substring(0, 200);
    const sanitizedDescription = data.description
        ? stripHtml(String(data.description)).substring(0, 5000)
        : '';
    // ── 4. Fetch seller info from Auth / Firestore ──
    let sellerName = data.sellerName || '';
    let sellerImage = data.sellerImage || null;
    if (!sellerName) {
        // Try to get displayName from Firestore user doc
        const userSnap = await firebase_1.db.collection('users').doc(uid).get();
        if (userSnap.exists) {
            const userData = userSnap.data();
            sellerName = (userData === null || userData === void 0 ? void 0 : userData.displayName) || 'Utilisateur';
            sellerImage = sellerImage || (userData === null || userData === void 0 ? void 0 : userData.profileImage) || null;
        }
        else {
            sellerName = 'Utilisateur';
        }
    }
    // NOTE: Stripe Custom account creation is no longer done silently at
    // article publish. Sellers must complete full in-app onboarding via
    // createStripeConnectAccount (identity, address, bank account) before
    // their shipping articles can be purchased. The createTransaction
    // callable enforces this check at purchase time.
    // ── 5. Build sanitised images array ──
    const sanitizedImages = data.images.map((img) => {
        const entry = {
            url: img.url.trim(),
        };
        if (img.blurhash && typeof img.blurhash === 'string') {
            entry.blurhash = img.blurhash;
        }
        return entry;
    });
    // ── 6. Build the article document ──
    // Only include defined fields (no undefined → Firestore rejects them)
    const article = {
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
        createdAt: firebase_1.FieldValue.serverTimestamp(),
        updatedAt: firebase_1.FieldValue.serverTimestamp(),
    };
    // Optional scalar fields
    if (sellerImage)
        article.sellerImage = sellerImage;
    // Size — accept the ArticleSize object { value, system } (current client),
    // or a legacy plain string (back-compat → defaults to system 'EU').
    // On create there is no "erasure": a null/empty/malformed size simply omits
    // the field (never write undefined).
    const sanitizedSize = (0, article_1.sanitizeArticleSize)(data.size);
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
            .filter((c) => typeof c === 'string')
            .slice(0, 20);
        article.color = article.colors[0] || null;
    }
    else if (typeof data.color === 'string' && data.color.trim()) {
        article.color = data.color.trim();
    }
    // Materials — multi-select + backward compat single value
    if (Array.isArray(data.materials) && data.materials.length > 0) {
        article.materials = data.materials
            .filter((m) => typeof m === 'string')
            .slice(0, 20);
        article.material = article.materials[0] || null;
    }
    else if (typeof data.material === 'string' && data.material.trim()) {
        article.material = data.material.trim();
    }
    // Neighborhoods (meetup locations)
    if (Array.isArray(data.neighborhoods) && data.neighborhoods.length > 0) {
        article.neighborhoods = data.neighborhoods.slice(0, 10);
        article.neighborhood = data.neighborhoods[0];
    }
    else if (data.neighborhood && typeof data.neighborhood === 'object') {
        article.neighborhood = data.neighborhood;
        article.neighborhoods = [data.neighborhood];
    }
    // Package size
    const validPackageSizes = ['small', 'medium', 'large'];
    if (typeof data.packageSize === 'string' &&
        validPackageSizes.includes(data.packageSize)) {
        article.packageSize = data.packageSize;
    }
    // ── 7. Create in Firestore ──
    const docRef = await firebase_1.db.collection('articles').add(article);
    logger.info('Article created via callable', {
        articleId: docRef.id,
        sellerId: uid,
        title: sanitizedTitle,
        imagesCount: sanitizedImages.length,
    });
    return { articleId: docRef.id };
});
/**
 * Toggle article sold status (mark as sold / unmark)
 *
 * Only the seller can toggle. Rejects if an active transaction exists
 * on this article (pending, meetup_pending, meetup_confirmed,
 * shipping_pending, shipping_in_transit).
 */
exports.toggleArticleSold = (0, https_1.onCall)({ region: 'northamerica-northeast1', memory: '512MiB' }, async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'Non connecte');
    }
    const { articleId } = request.data;
    if (!articleId || typeof articleId !== 'string') {
        throw new https_1.HttpsError('invalid-argument', 'articleId requis');
    }
    const uid = request.auth.uid;
    const articleRef = firebase_1.db.collection('articles').doc(articleId);
    // Query for active transactions BEFORE the transaction (Firestore
    // transactions only support doc gets via t.get(), not queries).
    const activeTransactions = await firebase_1.db
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
        throw new https_1.HttpsError('failed-precondition', 'Une transaction est en cours sur cet article');
    }
    await firebase_1.db.runTransaction(async (t) => {
        const doc = await t.get(articleRef);
        if (!doc.exists) {
            throw new https_1.HttpsError('not-found', 'Article introuvable');
        }
        const data = doc.data();
        if (data.sellerId !== uid) {
            throw new https_1.HttpsError('permission-denied', 'Pas votre article');
        }
        const newSoldState = !data.isSold;
        t.update(articleRef, {
            isSold: newSoldState,
            updatedAt: firebase_1.FieldValue.serverTimestamp(),
        });
    });
    logger.info('Article sold status toggled', { articleId, sellerId: uid });
    return { success: true };
});
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
exports.updateArticle = (0, https_1.onCall)({ region: 'northamerica-northeast1', memory: '512MiB' }, async (request) => {
    var _a;
    // ── 1. Auth check ──
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'Utilisateur non connecte');
    }
    const uid = request.auth.uid;
    const { articleId, updates } = (_a = request.data) !== null && _a !== void 0 ? _a : {};
    if (!articleId || typeof articleId !== 'string') {
        throw new https_1.HttpsError('invalid-argument', 'articleId requis');
    }
    if (!updates || typeof updates !== 'object') {
        throw new https_1.HttpsError('invalid-argument', 'updates requis');
    }
    // ── 2. Sanitise helper ──
    const stripHtml = (s) => s.replace(/<[^>]*>/g, '').trim();
    // ── 3. Validate individual fields from `updates` ──
    const sanitized = {};
    // Title
    if ('title' in updates) {
        if (typeof updates.title !== 'string' ||
            updates.title.trim().length < 3) {
            throw new https_1.HttpsError('invalid-argument', 'Le titre doit contenir au moins 3 caracteres');
        }
        sanitized.title = stripHtml(updates.title).substring(0, 200);
    }
    // Description
    if ('description' in updates) {
        if (typeof updates.description !== 'string') {
            throw new https_1.HttpsError('invalid-argument', 'Description invalide');
        }
        sanitized.description = stripHtml(updates.description).substring(0, 5000);
    }
    // Price
    if ('price' in updates) {
        if (typeof updates.price !== 'number' ||
            updates.price < 0.01 ||
            updates.price > 10000) {
            throw new https_1.HttpsError('invalid-argument', 'Le prix doit etre entre 0.01 et 10 000 $');
        }
        sanitized.price = updates.price;
    }
    // Condition
    const validConditions = ['neuf', 'très bon état', 'bon état', 'satisfaisant'];
    if ('condition' in updates) {
        if (!validConditions.includes(updates.condition)) {
            throw new https_1.HttpsError('invalid-argument', 'Condition invalide');
        }
        sanitized.condition = updates.condition;
    }
    // CategoryIds
    if ('categoryIds' in updates) {
        if (!Array.isArray(updates.categoryIds) ||
            updates.categoryIds.length === 0) {
            throw new https_1.HttpsError('invalid-argument', 'Au moins une categorie est requise');
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
        if (!Array.isArray(updates.images) ||
            updates.images.length === 0) {
            throw new https_1.HttpsError('invalid-argument', 'Au moins une image est requise');
        }
        if (updates.images.length > 10) {
            throw new https_1.HttpsError('invalid-argument', 'Maximum 10 images autorisees');
        }
        for (const img of updates.images) {
            if (!img || typeof img.url !== 'string' || img.url.trim().length === 0) {
                throw new https_1.HttpsError('invalid-argument', 'Chaque image doit avoir une URL valide');
            }
        }
        sanitized.images = updates.images.map((img) => {
            const entry = {
                url: img.url.trim(),
            };
            if (img.blurhash && typeof img.blurhash === 'string') {
                entry.blurhash = img.blurhash;
            }
            return entry;
        });
    }
    // Optional scalar fields
    // Size — only touch when the caller sent the key. Accept the ArticleSize
    // object { value, system }, a legacy plain string (→ system 'EU'), or an
    // explicit null (erasure → store null). A malformed/empty value is ignored
    // (field left untouched, never write undefined).
    if ('size' in updates) {
        const sanitizedSize = (0, article_1.sanitizeArticleSize)(updates.size);
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
            .filter((c) => typeof c === 'string')
            .slice(0, 20);
        sanitized.color = sanitized.colors[0] || null;
    }
    else if ('color' in updates && typeof updates.color === 'string') {
        sanitized.color = updates.color.trim();
    }
    // Materials
    if ('materials' in updates && Array.isArray(updates.materials)) {
        sanitized.materials = updates.materials
            .filter((m) => typeof m === 'string')
            .slice(0, 20);
        sanitized.material = sanitized.materials[0] || null;
    }
    else if ('material' in updates && typeof updates.material === 'string') {
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
    if ('packageSize' in updates &&
        typeof updates.packageSize === 'string' &&
        validPackageSizes.includes(updates.packageSize)) {
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
        throw new https_1.HttpsError('invalid-argument', 'Aucun champ valide a mettre a jour');
    }
    // ── 4. Transaction lock: reject if an active transaction exists (P-LOCK) ──
    // Query BEFORE the Firestore transaction (queries not allowed inside tx).
    const activeTransactions = await firebase_1.db
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
        throw new https_1.HttpsError('failed-precondition', 'Une transaction est en cours sur cet article. Modification impossible.');
    }
    // ── 5. Transaction: ownership + sold/active check + price drop + write ──
    const articleRef = firebase_1.db.collection('articles').doc(articleId);
    await firebase_1.db.runTransaction(async (tx) => {
        const snap = await tx.get(articleRef);
        if (!snap.exists) {
            throw new https_1.HttpsError('not-found', 'Article introuvable');
        }
        const existing = snap.data();
        // Ownership check
        if (existing.sellerId !== uid) {
            throw new https_1.HttpsError('permission-denied', 'Pas votre article');
        }
        // Block editing sold articles
        if (existing.isSold === true) {
            throw new https_1.HttpsError('failed-precondition', 'Impossible de modifier un article vendu');
        }
        // Block editing deactivated articles (task #14)
        if (existing.isActive === false) {
            throw new https_1.HttpsError('failed-precondition', 'Impossible de modifier un article desactive');
        }
        // Price drop tracking: if price has decreased, record it
        if (sanitized.price !== undefined &&
            typeof sanitized.price === 'number' &&
            sanitized.price < existing.price) {
            const originalPrice = existing.originalPrice || existing.price;
            const priceDropPercent = Math.round(((originalPrice - sanitized.price) / originalPrice) * 100);
            sanitized.originalPrice = originalPrice;
            sanitized.priceDropPercent = priceDropPercent;
            sanitized.lastPriceDropAt = firebase_1.FieldValue.serverTimestamp();
        }
        // Always set updatedAt
        sanitized.updatedAt = firebase_1.FieldValue.serverTimestamp();
        tx.update(articleRef, sanitized);
    });
    logger.info('Article updated via callable', {
        articleId,
        sellerId: uid,
        updatedFields: Object.keys(sanitized).filter((k) => k !== 'updatedAt'),
    });
    return { success: true };
});
/**
 * Mark saved search as viewed (resets newItemsCount)
 */
exports.markSavedSearchViewed = (0, https_1.onCall)({ region: 'northamerica-northeast1', memory: '512MiB' }, async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'User must be authenticated');
    }
    const { searchId } = request.data;
    if (!searchId) {
        throw new https_1.HttpsError('invalid-argument', 'Search ID is required');
    }
    const userId = request.auth.uid;
    try {
        await firebase_1.db
            .collection('users')
            .doc(userId)
            .collection('savedSearches')
            .doc(searchId)
            .update({
            newItemsCount: 0,
        });
        return { success: true };
    }
    catch (error) {
        logger.error('Error marking saved search as viewed:', error);
        throw new https_1.HttpsError('internal', 'Failed to update saved search');
    }
});
//# sourceMappingURL=products.js.map