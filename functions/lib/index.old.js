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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendSwapZoneReminders = exports.onArticlePriceDropped = exports.onArticleFavorited = exports.generateStyleProfile = exports.getSwapPartyLeaderboard = exports.getActiveSwapPartyInfo = exports.onSwapStatusUpdated = exports.onSwapCreated = exports.updateSwapPartyStatuses = exports.getMomentProducts = exports.getActiveMoments = exports.regenerateAllEmbeddings = exports.getSimilarProducts = exports.visualSearch = exports.generateArticleEmbedding = exports.analyzeProductImage = exports.markSavedSearchViewed = exports.checkSavedSearchNotifications = exports.checkTrackingStatus = exports.stripeWebhook = exports.createPaymentIntent = exports.getShippingEstimate = exports.sendOfferStatusNotification = exports.sendMessageNotification = exports.toggleProductLike = exports.incrementProductView = exports.updatePopularityScores = exports.cleanupSearchIndex = exports.updateGlobalStats = exports.updateUserStats = exports.updateSearchIndex = void 0;
const admin = __importStar(require("firebase-admin"));
const firestore_1 = require("firebase-admin/firestore");
const params_1 = require("firebase-functions/params");
const genai_1 = require("@google/genai");
// Define secrets for v6
const geminiApiKey = (0, params_1.defineSecret)('GEMINI_API_KEY');
const stripeSecretKeyParam = (0, params_1.defineSecret)('STRIPE_SECRET_KEY');
const shippoApiKeyParam = (0, params_1.defineSecret)('SHIPPO_API_KEY');
const shippo_1 = require("shippo");
const stripe_1 = __importDefault(require("stripe"));
const fuse_js_1 = __importDefault(require("fuse.js"));
const productReference_1 = require("./productReference");
// Initialize Firebase Admin
admin.initializeApp();
const db = admin.firestore();
// Initialize Stripe (lazy initialization to avoid deployment errors)
const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
let stripe = null;
const getStripe = () => {
    if (!stripe && stripeSecretKey) {
        stripe = new stripe_1.default(stripeSecretKey, {
            apiVersion: '2025-11-17.clover',
        });
    }
    return stripe;
};
// Initialize Shippo (lazy initialization to avoid deployment errors)
const shippoApiKey = process.env.SHIPPO_API_KEY;
let shippoClient = null;
const getShippo = () => {
    if (!shippoClient && shippoApiKey) {
        shippoClient = new shippo_1.Shippo({ apiKeyHeader: shippoApiKey });
    }
    return shippoClient;
};
// Geohash utility functions
const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';
function encodeGeohash(latitude, longitude, precision = 7) {
    let idx = 0;
    let bit = 0;
    let evenBit = true;
    let geohash = '';
    let latMin = -90.0;
    let latMax = 90.0;
    let lonMin = -180.0;
    let lonMax = 180.0;
    while (geohash.length < precision) {
        if (evenBit) {
            // longitude
            const mid = (lonMin + lonMax) / 2;
            if (longitude >= mid) {
                idx = (idx << 1) + 1;
                lonMin = mid;
            }
            else {
                idx = idx << 1;
                lonMax = mid;
            }
        }
        else {
            // latitude
            const mid = (latMin + latMax) / 2;
            if (latitude >= mid) {
                idx = (idx << 1) + 1;
                latMin = mid;
            }
            else {
                idx = idx << 1;
                latMax = mid;
            }
        }
        evenBit = !evenBit;
        if (++bit === 5) {
            geohash += BASE32[idx];
            bit = 0;
            idx = 0;
        }
    }
    return geohash;
}
// Brand matching thresholds
const BRAND_MATCHING = {
    autoSelectThreshold: 0.90, // Auto-select without confirmation
    strongThreshold: 0.75, // Strong match (lowered from 0.85)
    suggestionThreshold: 0.50, // Show in suggestions
    fuseThreshold: 0.4, // Fuse.js threshold (increased from 0.3)
    maxSuggestions: 5,
};
// In-memory cache for brands (refreshed every 10 minutes)
let brandsCache = null;
let brandsCacheTimestamp = 0;
let brandsFuse = null;
const BRANDS_CACHE_TTL = 60 * 60 * 1000; // 1 hour (brands don't change often)
/**
 * Load brands from Firestore with caching
 */
async function loadBrands() {
    const now = Date.now();
    // Return cached brands if still valid
    if (brandsCache && (now - brandsCacheTimestamp) < BRANDS_CACHE_TTL) {
        console.log(`   [brands] Using cached brands (${brandsCache.length} brands, age: ${Math.round((now - brandsCacheTimestamp) / 1000)}s)`);
        return brandsCache;
    }
    const loadStart = Date.now();
    console.log('   [brands] Loading brands from Firestore...');
    const brandsSnapshot = await db.collection('brands').get();
    const firestoreTime = Date.now() - loadStart;
    brandsCache = brandsSnapshot.docs.map(doc => ({
        id: doc.id,
        name: doc.data().name || doc.id,
        aliases: doc.data().aliases || [],
        popularity: doc.data().popularity || 0,
    }));
    brandsCacheTimestamp = now;
    // Rebuild Fuse index with optimized settings
    const fuseStart = Date.now();
    brandsFuse = new fuse_js_1.default(brandsCache, {
        keys: [
            { name: 'name', weight: 1.0 },
            { name: 'aliases', weight: 0.8 },
        ],
        threshold: BRAND_MATCHING.fuseThreshold, // Increased from 0.3 for better partial matching
        includeScore: true,
        ignoreLocation: true,
        minMatchCharLength: 2,
        findAllMatches: true,
    });
    const fuseTime = Date.now() - fuseStart;
    console.log(`   [brands] Loaded ${brandsCache.length} brands (Firestore: ${firestoreTime}ms, Fuse index: ${fuseTime}ms)`);
    return brandsCache;
}
/**
 * Get or build Fuse index
 */
async function getBrandsFuse() {
    if (!brandsFuse || !brandsCache || (Date.now() - brandsCacheTimestamp) >= BRANDS_CACHE_TTL) {
        await loadBrands();
    }
    return brandsFuse;
}
/**
 * Fuzzy match a detected brand name against the brands database
 * Uses three-tier matching:
 * - Auto-select: confidence >= 0.90 (auto-fill without confirmation)
 * - Strong match: confidence >= 0.75 (suggest with confirmation request)
 * - Suggestions: confidence >= 0.50 (show in suggestions list)
 */
async function matchBrand(detectedBrand) {
    if (!detectedBrand || detectedBrand.trim() === '') {
        return {
            brandId: null,
            brandName: null,
            confidence: 0,
            matchType: 'none',
            needsConfirmation: false,
            suggestions: [],
        };
    }
    const normalizedInput = detectedBrand.trim().toLowerCase();
    const brands = await loadBrands();
    // 1. Try exact match first (case-insensitive)
    const exactMatch = brands.find(b => {
        var _a;
        return b.name.toLowerCase() === normalizedInput ||
            ((_a = b.aliases) === null || _a === void 0 ? void 0 : _a.some(a => a.toLowerCase() === normalizedInput));
    });
    if (exactMatch) {
        return {
            brandId: exactMatch.id,
            brandName: exactMatch.name,
            confidence: 1.0,
            matchType: 'exact',
            needsConfirmation: false, // Exact matches don't need confirmation
            suggestions: [],
        };
    }
    // 2. Fuzzy search
    const fuse = await getBrandsFuse();
    const results = fuse.search(detectedBrand, { limit: BRAND_MATCHING.maxSuggestions });
    if (results.length === 0) {
        return {
            brandId: null,
            brandName: null,
            confidence: 0,
            matchType: 'none',
            needsConfirmation: false,
            suggestions: [],
        };
    }
    // Convert Fuse score (0 = perfect, 1 = worst) to confidence (1 = perfect, 0 = worst)
    const topResult = results[0];
    const confidence = 1 - (topResult.score || 0);
    // Three-tier matching:
    // 1. Auto-select (>= 0.90): Very confident, auto-fill without asking
    // 2. Strong match (>= 0.75): Confident but should confirm with user
    // 3. Suggestions (>= 0.50): Show as suggestions but don't auto-fill
    const isAutoSelect = confidence >= BRAND_MATCHING.autoSelectThreshold;
    const isStrongMatch = confidence >= BRAND_MATCHING.strongThreshold;
    // Filter suggestions to only include those above the suggestion threshold
    const suggestions = results
        .filter(r => (1 - (r.score || 0)) >= BRAND_MATCHING.suggestionThreshold)
        .map(r => ({
        brandId: r.item.id,
        brandName: r.item.name,
        score: 1 - (r.score || 0),
    }));
    return {
        brandId: isStrongMatch ? topResult.item.id : null,
        brandName: isStrongMatch ? topResult.item.name : null,
        confidence: confidence,
        matchType: isStrongMatch ? 'fuzzy' : 'none',
        needsConfirmation: isStrongMatch && !isAutoSelect, // Strong but not auto-select
        suggestions,
    };
}
// Generate search keywords from text
function generateSearchKeywords(text) {
    if (!text)
        return [];
    const words = text
        .toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter(word => word.length > 2);
    const keywords = new Set();
    // Add individual words
    words.forEach(word => keywords.add(word));
    // Add word combinations (bigrams)
    for (let i = 0; i < words.length - 1; i++) {
        keywords.add(`${words[i]} ${words[i + 1]}`);
    }
    // Add partial matches (prefixes)
    words.forEach(word => {
        if (word.length > 3) {
            for (let i = 3; i <= word.length; i++) {
                keywords.add(word.substring(0, i));
            }
        }
    });
    return Array.from(keywords);
}
// Calculate popularity score for ranking
function calculatePopularityScore(views, likes, createdAt) {
    const now = new Date();
    const ageInDays = (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24);
    // Decay factor: newer items get higher scores
    const ageFactor = Math.exp(-ageInDays / 30); // 30-day half-life
    // Engagement score
    const engagementScore = (views * 0.1) + (likes * 2);
    // Final score with time decay
    return engagementScore * ageFactor;
}
// Debounce utility for batching updates
const updateQueues = new Map();
function debounceUpdate(key, updateFn, delay = 5000) {
    // Clear existing timeout
    const existingTimeout = updateQueues.get(key);
    if (existingTimeout) {
        clearTimeout(existingTimeout);
    }
    // Set new timeout
    const timeout = setTimeout(async () => {
        try {
            await updateFn();
            updateQueues.delete(key);
        }
        catch (error) {
            console.error(`Debounced update failed for ${key}:`, error);
            updateQueues.delete(key);
        }
    }, delay);
    updateQueues.set(key, timeout);
}
// Cloud Function: Update search index when product is created/updated
exports.updateSearchIndex = functions.firestore
    .document('products/{productId}')
    .onWrite(async (change, context) => {
    var _a, _b, _c, _d, _e, _f, _g;
    const productId = context.params.productId;
    try {
        // If document was deleted, remove from search index
        if (!change.after.exists) {
            await db.collection('search_index').doc(productId).delete();
            console.log(`Removed product ${productId} from search index`);
            return;
        }
        const productData = change.after.data();
        if (!productData)
            return;
        // Only index active, approved products
        if (!productData.isActive || productData.moderationStatus !== 'approved') {
            await db.collection('search_index').doc(productId).delete();
            return;
        }
        // Generate geohash for location
        let geohash = '';
        if ((_a = productData.location) === null || _a === void 0 ? void 0 : _a.coordinates) {
            const { lat, lon } = productData.location.coordinates;
            geohash = encodeGeohash(lat, lon, 7);
        }
        // Normalize array fields (support both singular and array formats)
        const getBrands = () => {
            if (productData.brands && Array.isArray(productData.brands))
                return productData.brands;
            if (productData.brand)
                return [productData.brand];
            return [];
        };
        const getColors = () => {
            if (productData.colors && Array.isArray(productData.colors))
                return productData.colors;
            if (productData.color)
                return [productData.color];
            return [];
        };
        const getMaterials = () => {
            if (productData.materials && Array.isArray(productData.materials))
                return productData.materials;
            if (productData.material)
                return [productData.material];
            return [];
        };
        const brands = getBrands();
        const colors = getColors();
        const materials = getMaterials();
        // Generate search keywords (include array values)
        const brandsText = brands.join(' ');
        const searchText = `${productData.title} ${productData.description} ${brandsText} ${productData.category || ''}`;
        const keywords = generateSearchKeywords(searchText);
        // Calculate popularity score
        const popularityScore = calculatePopularityScore(productData.views || 0, productData.likes || 0, ((_b = productData.createdAt) === null || _b === void 0 ? void 0 : _b.toDate()) || new Date());
        // Create search index document
        const searchIndexData = {
            productId,
            title: productData.title,
            titleLowercase: productData.title.toLowerCase(),
            description: productData.description,
            keywords,
            // Filterable fields - using arrays for multi-value attributes
            category: productData.category,
            subcategory: productData.subcategory || null,
            // Array fields for multi-select filtering
            brands: brands,
            colors: colors,
            materials: materials,
            // Keep singular fields for backwards compatibility
            brand: brands[0] || null,
            color: colors[0] || null,
            material: materials[0] || null,
            size: productData.size || null,
            condition: productData.condition,
            price: productData.price,
            // Location data
            location: {
                city: ((_c = productData.location) === null || _c === void 0 ? void 0 : _c.city) || '',
                geohash,
                coordinates: ((_d = productData.location) === null || _d === void 0 ? void 0 : _d.coordinates) || null,
            },
            // Cached display data
            sellerId: productData.sellerId,
            sellerName: productData.sellerName,
            sellerRating: productData.sellerRating || null,
            firstImage: ((_f = (_e = productData.images) === null || _e === void 0 ? void 0 : _e[0]) === null || _f === void 0 ? void 0 : _f.url) || null,
            // Status
            isActive: productData.isActive,
            isSold: productData.isSold,
            isPromoted: productData.isPromoted || false,
            // Metrics for ranking
            views: productData.views || 0,
            likes: productData.likes || 0,
            createdAt: productData.createdAt,
            // Search optimization
            popularityScore,
            lastIndexed: firestore_1.FieldValue.serverTimestamp(),
        };
        // Update search index with debouncing
        const updateKey = `search_index_${productId}`;
        debounceUpdate(updateKey, async () => {
            await db.collection('search_index').doc(productId).set(searchIndexData, { merge: true });
            console.log(`Updated search index for product ${productId}`);
        });
        // Update product with geohash if not present
        if (geohash && !((_g = productData.location) === null || _g === void 0 ? void 0 : _g.geohash)) {
            const updateKey = `product_geohash_${productId}`;
            debounceUpdate(updateKey, async () => {
                await db.collection('products').doc(productId).update({
                    'location.geohash': geohash
                });
                console.log(`Added geohash to product ${productId}`);
            });
        }
    }
    catch (error) {
        console.error(`Error updating search index for product ${productId}:`, error);
    }
});
// Cloud Function: Update user stats when product is created/updated/sold
exports.updateUserStats = functions.firestore
    .document('products/{productId}')
    .onWrite(async (change, context) => {
    const productId = context.params.productId;
    try {
        const after = change.after.exists ? change.after.data() : null;
        if (!after)
            return; // Document deleted
        const sellerId = after.sellerId;
        if (!sellerId)
            return;
        // Debounce user stats update
        const updateKey = `user_stats_${sellerId}`;
        debounceUpdate(updateKey, async () => {
            const userStatsRef = db.collection('stats').doc(`user_${sellerId}`);
            // Get current user products
            const userProductsSnapshot = await db
                .collection('products')
                .where('sellerId', '==', sellerId)
                .get();
            let productsListed = 0;
            let productsActive = 0;
            let productsSold = 0;
            let totalViews = 0;
            let totalLikes = 0;
            let totalEarnings = 0;
            let salesCount = 0;
            userProductsSnapshot.forEach(doc => {
                const product = doc.data();
                productsListed++;
                if (product.isActive && !product.isSold) {
                    productsActive++;
                }
                if (product.isSold) {
                    productsSold++;
                    totalEarnings += product.price || 0;
                    salesCount++;
                }
                totalViews += product.views || 0;
                totalLikes += product.likes || 0;
            });
            const averageSalePrice = salesCount > 0 ? totalEarnings / salesCount : 0;
            // Update user stats
            await userStatsRef.set({
                userId: sellerId,
                productsListed,
                productsActive,
                productsSold,
                productsViews: totalViews,
                productsLikes: totalLikes,
                totalEarnings,
                averageSalePrice,
                updatedAt: firestore_1.FieldValue.serverTimestamp(),
            }, { merge: true });
            console.log(`Updated stats for user ${sellerId}`);
        }, 10000); // 10 second debounce for user stats
    }
    catch (error) {
        console.error(`Error updating user stats for product ${productId}:`, error);
    }
});
// Cloud Function: Update global stats periodically
exports.updateGlobalStats = functions.pubsub
    .schedule('every 1 hours')
    .onRun(async (context) => {
    try {
        console.log('Starting global stats update...');
        // Get total counts
        const [productsSnapshot, usersSnapshot] = await Promise.all([
            db.collection('products')
                .where('isActive', '==', true)
                .where('isSold', '==', false)
                .get(),
            db.collection('users')
                .where('isActive', '==', true)
                .get()
        ]);
        const totalProducts = productsSnapshot.size;
        const totalUsers = usersSnapshot.size;
        // Calculate sales and revenue
        const soldProductsSnapshot = await db
            .collection('products')
            .where('isSold', '==', true)
            .get();
        let totalSales = 0;
        let totalRevenue = 0;
        const categoryStats = {};
        soldProductsSnapshot.forEach(doc => {
            const product = doc.data();
            totalSales++;
            totalRevenue += product.price || 0;
            const category = product.category;
            if (category) {
                if (!categoryStats[category]) {
                    categoryStats[category] = {
                        productCount: 0,
                        totalSales: 0,
                        totalRevenue: 0,
                    };
                }
                categoryStats[category].totalSales++;
                categoryStats[category].totalRevenue += product.price || 0;
            }
        });
        // Count active products by category
        productsSnapshot.forEach(doc => {
            const product = doc.data();
            const category = product.category;
            if (category) {
                if (!categoryStats[category]) {
                    categoryStats[category] = {
                        productCount: 0,
                        totalSales: 0,
                        totalRevenue: 0,
                    };
                }
                categoryStats[category].productCount++;
            }
        });
        // Calculate average prices
        Object.keys(categoryStats).forEach(category => {
            const stats = categoryStats[category];
            stats.averagePrice = stats.totalSales > 0
                ? stats.totalRevenue / stats.totalSales
                : 0;
        });
        // Update global stats
        await db.collection('stats').doc('global').set({
            totalProducts,
            totalUsers,
            totalSales,
            totalRevenue,
            categoryStats,
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
        }, { merge: true });
        console.log('Global stats updated successfully');
    }
    catch (error) {
        console.error('Error updating global stats:', error);
    }
});
// Cloud Function: Clean up old search index entries
exports.cleanupSearchIndex = functions.pubsub
    .schedule('every 24 hours')
    .onRun(async (context) => {
    try {
        console.log('Starting search index cleanup...');
        const batch = db.batch();
        let deleteCount = 0;
        // Find search index entries for inactive or sold products
        const searchIndexSnapshot = await db
            .collection('search_index')
            .where('isActive', '==', false)
            .get();
        searchIndexSnapshot.forEach(doc => {
            batch.delete(doc.ref);
            deleteCount++;
        });
        // Find search index entries for sold products
        const soldSearchIndexSnapshot = await db
            .collection('search_index')
            .where('isSold', '==', true)
            .get();
        soldSearchIndexSnapshot.forEach(doc => {
            batch.delete(doc.ref);
            deleteCount++;
        });
        if (deleteCount > 0) {
            await batch.commit();
            console.log(`Cleaned up ${deleteCount} search index entries`);
        }
        else {
            console.log('No search index entries to clean up');
        }
    }
    catch (error) {
        console.error('Error cleaning up search index:', error);
    }
});
// Cloud Function: Update popularity scores
exports.updatePopularityScores = functions.pubsub
    .schedule('every 6 hours')
    .onRun(async (context) => {
    try {
        console.log('Starting popularity scores update...');
        const batch = db.batch();
        let updateCount = 0;
        // Get all active products from search index
        const searchIndexSnapshot = await db
            .collection('search_index')
            .where('isActive', '==', true)
            .where('isSold', '==', false)
            .get();
        searchIndexSnapshot.forEach(doc => {
            var _a;
            const data = doc.data();
            const newPopularityScore = calculatePopularityScore(data.views || 0, data.likes || 0, ((_a = data.createdAt) === null || _a === void 0 ? void 0 : _a.toDate()) || new Date());
            // Only update if score changed significantly
            const currentScore = data.popularityScore || 0;
            if (Math.abs(newPopularityScore - currentScore) > 0.1) {
                batch.update(doc.ref, {
                    popularityScore: newPopularityScore,
                    lastIndexed: firestore_1.FieldValue.serverTimestamp(),
                });
                updateCount++;
            }
        });
        if (updateCount > 0) {
            await batch.commit();
            console.log(`Updated ${updateCount} popularity scores`);
        }
        else {
            console.log('No popularity scores needed updating');
        }
    }
    catch (error) {
        console.error('Error updating popularity scores:', error);
    }
});
// Cloud Function: Handle product view increment
exports.incrementProductView = functions.https.onCall(async (data, context) => {
    const { productId } = data;
    if (!productId) {
        throw new functions.https.HttpsError('invalid-argument', 'Product ID is required');
    }
    try {
        const productRef = db.collection('products').doc(productId);
        const searchIndexRef = db.collection('search_index').doc(productId);
        // Use transaction to ensure consistency
        await db.runTransaction(async (transaction) => {
            var _a;
            const productDoc = await transaction.get(productRef);
            if (!productDoc.exists) {
                throw new functions.https.HttpsError('not-found', 'Product not found');
            }
            const currentViews = ((_a = productDoc.data()) === null || _a === void 0 ? void 0 : _a.views) || 0;
            const newViews = currentViews + 1;
            // Update product views
            transaction.update(productRef, { views: newViews });
            // Update search index views
            transaction.update(searchIndexRef, { views: newViews });
        });
        return { success: true, message: 'View count incremented' };
    }
    catch (error) {
        console.error('Error incrementing product view:', error);
        throw new functions.https.HttpsError('internal', 'Failed to increment view count');
    }
});
// Cloud Function: Handle product like/unlike
exports.toggleProductLike = functions.https.onCall(async (data, context) => {
    const { productId, isLiked } = data;
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    }
    if (!productId || typeof isLiked !== 'boolean') {
        throw new functions.https.HttpsError('invalid-argument', 'Product ID and like status are required');
    }
    const userId = context.auth.uid;
    try {
        const productRef = db.collection('products').doc(productId);
        const searchIndexRef = db.collection('search_index').doc(productId);
        const favoritesRef = db.collection('favorites').doc(userId);
        await db.runTransaction(async (transaction) => {
            var _a, _b;
            const productDoc = await transaction.get(productRef);
            if (!productDoc.exists) {
                throw new functions.https.HttpsError('not-found', 'Product not found');
            }
            const productData = productDoc.data();
            const currentLikes = productData.likes || 0;
            const likedBy = productData.likedBy || [];
            let newLikes = currentLikes;
            let newLikedBy = [...likedBy];
            if (isLiked && !likedBy.includes(userId)) {
                // Add like
                newLikes = currentLikes + 1;
                newLikedBy.push(userId);
            }
            else if (!isLiked && likedBy.includes(userId)) {
                // Remove like
                newLikes = Math.max(0, currentLikes - 1);
                newLikedBy = likedBy.filter((id) => id !== userId);
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
                    addedAt: firestore_1.FieldValue.serverTimestamp(),
                    productTitle: productData.title,
                    productPrice: productData.price,
                    productImage: ((_b = (_a = productData.images) === null || _a === void 0 ? void 0 : _a[0]) === null || _b === void 0 ? void 0 : _b.url) || null,
                    sellerId: productData.sellerId,
                };
                transaction.set(favoritesRef, {
                    userId,
                    products: firestore_1.FieldValue.arrayUnion(favoriteData),
                    totalCount: firestore_1.FieldValue.increment(1),
                    updatedAt: firestore_1.FieldValue.serverTimestamp(),
                }, { merge: true });
            }
            else {
                // Remove from favorites (this is simplified - in production you'd need to handle array removal properly)
                const favoritesDoc = await transaction.get(favoritesRef);
                if (favoritesDoc.exists) {
                    const favoritesData = favoritesDoc.data();
                    const updatedProducts = (favoritesData.products || []).filter((p) => p.productId !== productId);
                    transaction.update(favoritesRef, {
                        products: updatedProducts,
                        totalCount: updatedProducts.length,
                        updatedAt: firestore_1.FieldValue.serverTimestamp(),
                    });
                }
            }
        });
        return { success: true, message: 'Like status updated' };
    }
    catch (error) {
        console.error('Error toggling product like:', error);
        throw new functions.https.HttpsError('internal', 'Failed to update like status');
    }
});
// Cloud Function: Send push notification when message is sent
exports.sendMessageNotification = functions.firestore
    .document('messages/{messageId}')
    .onCreate(async (snapshot, context) => {
    var _a;
    try {
        const message = snapshot.data();
        const { chatId, senderId, receiverId, type, content } = message;
        if (!receiverId || !senderId || !chatId) {
            console.log('Missing required fields for notification');
            return;
        }
        // Get receiver's FCM tokens
        const receiverDoc = await db.collection('users').doc(receiverId).get();
        if (!receiverDoc.exists) {
            console.log(`Receiver user ${receiverId} not found`);
            return;
        }
        const receiverData = receiverDoc.data();
        const fcmTokens = receiverData.fcmTokens || [];
        if (fcmTokens.length === 0) {
            console.log(`No FCM tokens found for user ${receiverId}`);
            return;
        }
        // Get sender info
        const senderDoc = await db.collection('users').doc(senderId).get();
        const senderName = senderDoc.exists
            ? senderDoc.data().displayName || 'Un utilisateur'
            : 'Un utilisateur';
        // Get chat info for article title
        const chatDoc = await db.collection('chats').doc(chatId).get();
        const chatData = chatDoc.exists ? chatDoc.data() : null;
        const articleTitle = chatData === null || chatData === void 0 ? void 0 : chatData.articleTitle;
        // Build notification based on message type
        let title = '';
        let body = '';
        let notificationType = type;
        switch (type) {
            case 'text':
                title = senderName;
                body = articleTitle
                    ? `À propos de "${articleTitle}"`
                    : content.substring(0, 100);
                notificationType = 'message';
                break;
            case 'image':
                title = senderName;
                body = articleTitle
                    ? `📷 Photo - "${articleTitle}"`
                    : '📷 Vous a envoyé une photo';
                notificationType = 'message';
                break;
            case 'offer':
                const amount = ((_a = message.offer) === null || _a === void 0 ? void 0 : _a.amount) || 0;
                title = `Nouvelle offre de ${senderName}`;
                body = articleTitle
                    ? `${amount}€ pour "${articleTitle}"`
                    : `Offre de ${amount}€`;
                notificationType = 'offer';
                break;
            case 'system':
                // Don't send notifications for system messages
                return;
            default:
                title = 'Nouveau message';
                body = senderName;
        }
        // Send notification to all user's devices
        const messages = fcmTokens.map((token) => ({
            token,
            notification: {
                title,
                body,
            },
            data: {
                type: notificationType,
                chatId,
                senderId,
                senderName,
                articleTitle: articleTitle || '',
            },
            android: {
                priority: 'high',
                notification: {
                    sound: 'default',
                    channelId: 'messages',
                    priority: 'high',
                },
            },
            apns: {
                payload: {
                    aps: {
                        sound: 'default',
                        badge: 1,
                    },
                },
            },
        }));
        // Send all notifications
        const results = await admin.messaging().sendEach(messages);
        let successCount = 0;
        let failureCount = 0;
        results.responses.forEach((response, index) => {
            var _a, _b;
            if (response.success) {
                successCount++;
            }
            else {
                failureCount++;
                console.error(`Failed to send to token ${fcmTokens[index]}:`, response.error);
                // Remove invalid tokens
                if (((_a = response.error) === null || _a === void 0 ? void 0 : _a.code) === 'messaging/invalid-registration-token' ||
                    ((_b = response.error) === null || _b === void 0 ? void 0 : _b.code) === 'messaging/registration-token-not-registered') {
                    db.collection('users')
                        .doc(receiverId)
                        .update({
                        fcmTokens: admin.firestore.FieldValue.arrayRemove(fcmTokens[index]),
                    })
                        .catch((err) => console.error('Error removing invalid token:', err));
                }
            }
        });
        console.log(`Notifications sent: ${successCount} successful, ${failureCount} failed`);
    }
    catch (error) {
        console.error('Error sending message notification:', error);
    }
});
// Cloud Function: Send notification when offer status changes
exports.sendOfferStatusNotification = functions.firestore
    .document('messages/{messageId}')
    .onUpdate(async (change, context) => {
    try {
        const before = change.before.data();
        const after = change.after.data();
        // Check if offer status changed
        if (!before.offer ||
            !after.offer ||
            before.offer.status === after.offer.status) {
            return;
        }
        const { chatId, senderId, receiverId } = after;
        const offerStatus = after.offer.status;
        const amount = after.offer.amount;
        // Only send notification for accepted/rejected offers
        if (offerStatus !== 'accepted' && offerStatus !== 'rejected') {
            return;
        }
        // Get offer sender's (original buyer) FCM tokens
        const buyerDoc = await db.collection('users').doc(senderId).get();
        if (!buyerDoc.exists) {
            console.log(`Buyer user ${senderId} not found`);
            return;
        }
        const buyerData = buyerDoc.data();
        const fcmTokens = buyerData.fcmTokens || [];
        if (fcmTokens.length === 0) {
            console.log(`No FCM tokens found for user ${senderId}`);
            return;
        }
        // Get seller info
        const sellerDoc = await db.collection('users').doc(receiverId).get();
        const sellerName = sellerDoc.exists
            ? sellerDoc.data().displayName || 'Le vendeur'
            : 'Le vendeur';
        // Build notification
        const title = offerStatus === 'accepted'
            ? 'Offre acceptée ! 🎉'
            : 'Offre refusée';
        const body = offerStatus === 'accepted'
            ? `${sellerName} a accepté votre offre de ${amount}€`
            : `${sellerName} a refusé votre offre de ${amount}€`;
        // Send notification to all buyer's devices
        const messages = fcmTokens.map((token) => ({
            token,
            notification: {
                title,
                body,
            },
            data: {
                type: `offer_${offerStatus}`,
                chatId,
                senderId: receiverId,
                senderName: sellerName,
                amount: amount.toString(),
            },
            android: {
                priority: 'high',
                notification: {
                    sound: 'default',
                    channelId: 'offers',
                    priority: 'high',
                },
            },
            apns: {
                payload: {
                    aps: {
                        sound: 'default',
                        badge: 1,
                    },
                },
            },
        }));
        // Send all notifications
        const results = await admin.messaging().sendEach(messages);
        let successCount = 0;
        let failureCount = 0;
        results.responses.forEach((response, index) => {
            if (response.success) {
                successCount++;
            }
            else {
                failureCount++;
                console.error(`Failed to send to token ${fcmTokens[index]}:`, response.error);
            }
        });
        console.log(`Offer status notifications sent: ${successCount} successful, ${failureCount} failed`);
    }
    catch (error) {
        console.error('Error sending offer status notification:', error);
    }
});
// ========== SHIPPO & STRIPE INTEGRATION ==========
/**
 * Get shipping estimate from Shippo
 */
exports.getShippingEstimate = functions.https.onCall(async (data, context) => {
    var _a, _b, _c;
    const { fromAddress, toAddress, weight, dimensions } = data;
    if (!fromAddress || !toAddress) {
        throw new functions.https.HttpsError('invalid-argument', 'From and to addresses are required');
    }
    const shippo = getShippo();
    if (!shippo) {
        throw new functions.https.HttpsError('failed-precondition', 'Shippo API not configured');
    }
    try {
        // Use provided dimensions or default values
        const parcelDimensions = {
            length: ((_a = dimensions === null || dimensions === void 0 ? void 0 : dimensions.length) === null || _a === void 0 ? void 0 : _a.toString()) || '30',
            width: ((_b = dimensions === null || dimensions === void 0 ? void 0 : dimensions.width) === null || _b === void 0 ? void 0 : _b.toString()) || '25',
            height: ((_c = dimensions === null || dimensions === void 0 ? void 0 : dimensions.height) === null || _c === void 0 ? void 0 : _c.toString()) || '10',
            distanceUnit: 'cm',
            weight: (weight === null || weight === void 0 ? void 0 : weight.toString()) || '0.5',
            massUnit: 'kg',
        };
        console.log('📦 Creating Shippo shipment with:', {
            fromAddress,
            toAddress,
            parcelDimensions,
        });
        // Create shipment object
        const shipment = await shippo.shipments.create({
            addressFrom: {
                name: fromAddress.name,
                street1: fromAddress.street,
                city: fromAddress.city,
                zip: fromAddress.postalCode,
                country: fromAddress.country,
            },
            addressTo: {
                name: toAddress.name,
                street1: toAddress.street,
                city: toAddress.city,
                zip: toAddress.postalCode,
                country: toAddress.country,
                phone: toAddress.phoneNumber || '',
            },
            parcels: [parcelDimensions],
            async: false,
        });
        // Extract rates
        const rates = shipment.rates.map((rate) => ({
            carrier: rate.provider,
            serviceName: rate.servicelevel.name,
            estimatedDays: rate.estimatedDays || '3-5',
            amount: parseFloat(rate.amount),
            currency: rate.currency,
            shippoRateId: rate.objectId,
        }));
        console.log(`✅ Retrieved ${rates.length} shipping rates`);
        // Return cheapest and fastest options
        return {
            success: true,
            rates: rates.slice(0, 3), // Return top 3 options
        };
    }
    catch (error) {
        console.error('Error getting shipping estimate:', error);
        throw new functions.https.HttpsError('internal', `Failed to get shipping estimate: ${error.message}`);
    }
});
/**
 * Create Stripe Payment Intent
 */
exports.createPaymentIntent = functions.https.onCall(async (data, context) => {
    const { transactionId } = data;
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    }
    if (!transactionId) {
        throw new functions.https.HttpsError('invalid-argument', 'Transaction ID is required');
    }
    const stripeClient = getStripe();
    if (!stripeClient) {
        throw new functions.https.HttpsError('failed-precondition', 'Stripe API not configured');
    }
    try {
        // Get transaction details
        const transactionDoc = await db.collection('transactions').doc(transactionId).get();
        if (!transactionDoc.exists) {
            throw new functions.https.HttpsError('not-found', 'Transaction not found');
        }
        const transaction = transactionDoc.data();
        // Verify the user is the buyer
        if (transaction.buyerId !== context.auth.uid) {
            throw new functions.https.HttpsError('permission-denied', 'You are not authorized for this transaction');
        }
        // Check if payment intent already exists
        if (transaction.paymentIntentId) {
            const existingIntent = await stripeClient.paymentIntents.retrieve(transaction.paymentIntentId);
            if (existingIntent.status !== 'canceled') {
                return {
                    success: true,
                    clientSecret: existingIntent.client_secret,
                    paymentIntentId: existingIntent.id,
                };
            }
        }
        // Create new payment intent
        const paymentIntent = await stripeClient.paymentIntents.create({
            amount: Math.round(transaction.totalAmount * 100), // Convert to cents
            currency: 'eur',
            metadata: {
                transactionId,
                buyerId: transaction.buyerId,
                sellerId: transaction.sellerId,
                articleId: transaction.articleId,
            },
            automatic_payment_methods: {
                enabled: true,
            },
        });
        // Update transaction with payment intent ID
        await db.collection('transactions').doc(transactionId).update({
            paymentIntentId: paymentIntent.id,
        });
        return {
            success: true,
            clientSecret: paymentIntent.client_secret,
            paymentIntentId: paymentIntent.id,
        };
    }
    catch (error) {
        console.error('Error creating payment intent:', error);
        throw new functions.https.HttpsError('internal', `Failed to create payment intent: ${error.message}`);
    }
});
/**
 * Stripe Webhook - Confirm payment and create shipping label
 */
exports.stripeWebhook = functions.https.onRequest(async (req, res) => {
    var _a;
    const sig = req.headers['stripe-signature'];
    const stripeClient = getStripe();
    if (!stripeClient) {
        res.status(500).send('Stripe API not configured');
        return;
    }
    let event;
    try {
        // Verify webhook signature
        event = stripeClient.webhooks.constructEvent(req.rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET || '');
    }
    catch (err) {
        console.error('Webhook signature verification failed:', err.message);
        res.status(400).send(`Webhook Error: ${err.message}`);
        return;
    }
    // Handle payment_intent.succeeded event
    if (event.type === 'payment_intent.succeeded') {
        const paymentIntent = event.data.object;
        const { transactionId, sellerId, articleId } = paymentIntent.metadata;
        try {
            // Get transaction details
            const transactionDoc = await db.collection('transactions').doc(transactionId).get();
            if (!transactionDoc.exists) {
                throw new Error('Transaction not found');
            }
            const transaction = transactionDoc.data();
            const shippo = getShippo();
            if (!shippo) {
                throw new Error('Shippo API not configured');
            }
            // Create shipping label via Shippo
            const shipment = await shippo.transactions.create({
                rate: (_a = transaction.shippingEstimate) === null || _a === void 0 ? void 0 : _a.shippoRateId,
                labelFileType: 'PDF',
                async: false,
            });
            // Update transaction with shipping info
            await db.collection('transactions').doc(transactionId).update({
                status: 'paid',
                paidAt: firestore_1.FieldValue.serverTimestamp(),
                shippoTransactionId: shipment.objectId,
                shippingLabelUrl: shipment.labelUrl,
                trackingNumber: shipment.trackingNumber,
                trackingUrl: shipment.trackingUrlProvider,
                trackingStatus: 'TRANSIT',
            });
            // Mark article as sold
            await db.collection('articles').doc(articleId).update({
                isSold: true,
                soldAt: firestore_1.FieldValue.serverTimestamp(),
            });
            // Add amount to seller's pending balance
            const sellerBalanceRef = db.collection('seller_balances').doc(sellerId);
            const sellerBalanceDoc = await sellerBalanceRef.get();
            const saleTransaction = {
                id: transactionId,
                type: 'sale',
                amount: transaction.amount,
                description: `Vente de l'article`,
                createdAt: firestore_1.FieldValue.serverTimestamp(),
                status: 'pending',
            };
            if (!sellerBalanceDoc.exists) {
                await sellerBalanceRef.set({
                    userId: sellerId,
                    availableBalance: 0,
                    pendingBalance: transaction.amount,
                    totalEarnings: 0,
                    transactions: [saleTransaction],
                    updatedAt: firestore_1.FieldValue.serverTimestamp(),
                });
            }
            else {
                await sellerBalanceRef.update({
                    pendingBalance: firestore_1.FieldValue.increment(transaction.amount),
                    transactions: firestore_1.FieldValue.arrayUnion(saleTransaction),
                    updatedAt: firestore_1.FieldValue.serverTimestamp(),
                });
            }
            // Send system message in chat with shipping label
            const chatQuery = await db.collection('chats')
                .where('articleId', '==', articleId)
                .where('participants', 'array-contains', transaction.buyerId)
                .limit(1)
                .get();
            if (!chatQuery.empty) {
                const chatId = chatQuery.docs[0].id;
                await db.collection('messages').add({
                    chatId,
                    senderId: 'system',
                    receiverId: 'system',
                    type: 'system',
                    content: `📦 Paiement confirmé ! Étiquette d'expédition générée.\n\nNuméro de suivi: ${shipment.trackingNumber}\n\nLe vendeur peut maintenant expédier l'article.`,
                    timestamp: firestore_1.FieldValue.serverTimestamp(),
                    status: 'sent',
                    isRead: true,
                    shippingLabel: {
                        labelUrl: shipment.labelUrl,
                        trackingNumber: shipment.trackingNumber,
                        trackingUrl: shipment.trackingUrlProvider,
                    },
                });
            }
            console.log(`Payment confirmed and label created for transaction ${transactionId}`);
        }
        catch (error) {
            console.error('Error processing payment webhook:', error);
        }
    }
    res.json({ received: true });
});
/**
 * Check tracking status from Shippo
 */
exports.checkTrackingStatus = functions.https.onCall(async (data, context) => {
    var _a, _b;
    const { transactionId } = data;
    if (!transactionId) {
        throw new functions.https.HttpsError('invalid-argument', 'Transaction ID is required');
    }
    try {
        // Get transaction
        const transactionDoc = await db.collection('transactions').doc(transactionId).get();
        if (!transactionDoc.exists) {
            throw new functions.https.HttpsError('not-found', 'Transaction not found');
        }
        const transaction = transactionDoc.data();
        if (!transaction.trackingNumber) {
            throw new functions.https.HttpsError('failed-precondition', 'No tracking number available');
        }
        const shippo = getShippo();
        if (!shippo) {
            throw new functions.https.HttpsError('failed-precondition', 'Shippo API not configured');
        }
        // Get tracking info from Shippo
        const tracking = await shippo.trackingStatus.get(transaction.trackingNumber, ((_a = transaction.shippingEstimate) === null || _a === void 0 ? void 0 : _a.carrier) || 'usps');
        const trackingStatus = ((_b = tracking.trackingStatus) === null || _b === void 0 ? void 0 : _b.status) || 'UNKNOWN';
        // Update transaction
        await db.collection('transactions').doc(transactionId).update({
            trackingStatus,
        });
        // If delivered, move funds from pending to available
        if (trackingStatus === 'DELIVERED') {
            await db.collection('transactions').doc(transactionId).update({
                status: 'delivered',
                deliveredAt: firestore_1.FieldValue.serverTimestamp(),
            });
            const sellerId = transaction.sellerId;
            const amount = transaction.amount;
            // Move from pending to available balance
            const sellerBalanceRef = db.collection('seller_balances').doc(sellerId);
            const sellerBalanceDoc = await sellerBalanceRef.get();
            if (sellerBalanceDoc.exists) {
                const balanceData = sellerBalanceDoc.data();
                const transactions = balanceData.transactions || [];
                // Update the sale transaction status to completed
                const updatedTransactions = transactions.map((t) => {
                    if (t.id === transactionId) {
                        return Object.assign(Object.assign({}, t), { status: 'completed' });
                    }
                    return t;
                });
                await sellerBalanceRef.update({
                    pendingBalance: firestore_1.FieldValue.increment(-amount),
                    availableBalance: firestore_1.FieldValue.increment(amount),
                    totalEarnings: firestore_1.FieldValue.increment(amount),
                    transactions: updatedTransactions,
                    updatedAt: firestore_1.FieldValue.serverTimestamp(),
                });
            }
            // Send system message
            const chatQuery = await db.collection('chats')
                .where('articleId', '==', transaction.articleId)
                .where('participants', 'array-contains', transaction.buyerId)
                .limit(1)
                .get();
            if (!chatQuery.empty) {
                const chatId = chatQuery.docs[0].id;
                await db.collection('messages').add({
                    chatId,
                    senderId: 'system',
                    receiverId: 'system',
                    type: 'system',
                    content: '✅ Colis livré ! La transaction est terminée. Les fonds ont été transférés au vendeur.',
                    timestamp: firestore_1.FieldValue.serverTimestamp(),
                    status: 'sent',
                    isRead: true,
                });
            }
        }
        return {
            success: true,
            trackingStatus,
            trackingHistory: tracking.trackingHistory || [],
        };
    }
    catch (error) {
        console.error('Error checking tracking status:', error);
        throw new functions.https.HttpsError('internal', `Failed to check tracking: ${error.message}`);
    }
});
/**
 * Cloud Function: Check saved searches and notify users of new matching articles
 * Runs every 15 minutes
 */
exports.checkSavedSearchNotifications = functions.pubsub
    .schedule('every 15 minutes')
    .onRun(async (context) => {
    var _a;
    console.log('Starting saved search notification check...');
    try {
        // Get all users with saved searches
        const usersSnapshot = await db.collection('users').get();
        let notificationsSent = 0;
        let searchesChecked = 0;
        for (const userDoc of usersSnapshot.docs) {
            const userId = userDoc.id;
            const userData = userDoc.data();
            const fcmTokens = userData.fcmTokens || [];
            // Skip users without FCM tokens
            if (fcmTokens.length === 0)
                continue;
            // Get user's saved searches with notifications enabled
            const savedSearchesSnapshot = await db
                .collection('users')
                .doc(userId)
                .collection('savedSearches')
                .where('notifyNewItems', '==', true)
                .get();
            for (const searchDoc of savedSearchesSnapshot.docs) {
                searchesChecked++;
                const search = searchDoc.data();
                const searchId = searchDoc.id;
                const lastNotifiedAt = ((_a = search.lastNotifiedAt) === null || _a === void 0 ? void 0 : _a.toDate()) || new Date(0);
                const filters = search.filters || {};
                const searchQuery = search.query || '';
                // Build query for matching articles
                let articlesQuery = db
                    .collection('articles')
                    .where('isActive', '==', true)
                    .where('isSold', '==', false)
                    .where('createdAt', '>', lastNotifiedAt);
                // Apply filters (only first filter due to Firestore limitations)
                // In production, you'd want to use composite indexes or filter client-side
                if (filters.categoryIds && filters.categoryIds.length > 0) {
                    // Use the most specific category (last in path)
                    const mostSpecificCategory = filters.categoryIds[filters.categoryIds.length - 1];
                    articlesQuery = articlesQuery.where('categoryId', '==', mostSpecificCategory);
                }
                else if (filters.brands && filters.brands.length > 0) {
                    // Use array-contains-any for array fields (brands)
                    // Note: array-contains-any only checks if ANY brand in the article's brands array matches ANY brand in the filter
                    articlesQuery = articlesQuery.where('brands', 'array-contains-any', filters.brands.slice(0, 10));
                }
                // Limit results
                articlesQuery = articlesQuery.limit(50);
                const matchingArticlesSnapshot = await articlesQuery.get();
                // Apply additional filters in memory
                let matchingArticles = matchingArticlesSnapshot.docs.map(doc => (Object.assign({ id: doc.id }, doc.data())));
                // Filter by text query if present
                if (searchQuery) {
                    const queryLower = searchQuery.toLowerCase();
                    matchingArticles = matchingArticles.filter((article) => {
                        var _a, _b;
                        // Check title and description
                        const matchesTitle = (_a = article.title) === null || _a === void 0 ? void 0 : _a.toLowerCase().includes(queryLower);
                        const matchesDesc = (_b = article.description) === null || _b === void 0 ? void 0 : _b.toLowerCase().includes(queryLower);
                        // Check brands array (or singular brand for backwards compatibility)
                        const brands = article.brands || (article.brand ? [article.brand] : []);
                        const matchesBrand = brands.some((b) => b.toLowerCase().includes(queryLower));
                        return matchesTitle || matchesDesc || matchesBrand;
                    });
                }
                // Filter by price
                if (filters.minPrice !== undefined) {
                    matchingArticles = matchingArticles.filter((article) => article.price >= filters.minPrice);
                }
                if (filters.maxPrice !== undefined) {
                    matchingArticles = matchingArticles.filter((article) => article.price <= filters.maxPrice);
                }
                // Filter by sizes
                if (filters.sizes && filters.sizes.length > 0) {
                    matchingArticles = matchingArticles.filter((article) => filters.sizes.includes(article.size));
                }
                // Filter by colors (array field)
                if (filters.colors && filters.colors.length > 0) {
                    matchingArticles = matchingArticles.filter((article) => {
                        const articleColors = article.colors || (article.color ? [article.color] : []);
                        return filters.colors.some(filterColor => articleColors.includes(filterColor));
                    });
                }
                // Filter by materials (array field)
                if (filters.materials && filters.materials.length > 0) {
                    matchingArticles = matchingArticles.filter((article) => {
                        const articleMaterials = article.materials || (article.material ? [article.material] : []);
                        return filters.materials.some(filterMaterial => articleMaterials.includes(filterMaterial));
                    });
                }
                // Filter by condition
                if (filters.condition) {
                    matchingArticles = matchingArticles.filter((article) => article.condition === filters.condition);
                }
                // If we have matching articles, send notification
                if (matchingArticles.length > 0) {
                    const title = `${matchingArticles.length} nouvel${matchingArticles.length > 1 ? 's' : ''} article${matchingArticles.length > 1 ? 's' : ''}`;
                    const body = search.name
                        ? `Nouvelle correspondance pour "${search.name}"`
                        : searchQuery
                            ? `Résultats pour "${searchQuery}"`
                            : 'De nouveaux articles correspondent à votre recherche';
                    // Send notification to all user's devices
                    const messages = fcmTokens.map((token) => ({
                        token,
                        notification: {
                            title,
                            body,
                        },
                        data: {
                            type: 'saved_search',
                            searchId,
                            searchName: search.name || '',
                            newItemsCount: matchingArticles.length.toString(),
                            // Include filters for deep linking
                            filters: JSON.stringify(filters),
                            query: searchQuery,
                        },
                        android: {
                            priority: 'high',
                            notification: {
                                sound: 'default',
                                channelId: 'saved_searches',
                                priority: 'high',
                            },
                        },
                        apns: {
                            payload: {
                                aps: {
                                    sound: 'default',
                                    badge: matchingArticles.length,
                                },
                            },
                        },
                    }));
                    try {
                        const results = await admin.messaging().sendEach(messages);
                        let successCount = 0;
                        results.responses.forEach((response, index) => {
                            var _a, _b;
                            if (response.success) {
                                successCount++;
                            }
                            else {
                                console.error(`Failed to send notification:`, response.error);
                                // Remove invalid tokens
                                if (((_a = response.error) === null || _a === void 0 ? void 0 : _a.code) === 'messaging/invalid-registration-token' ||
                                    ((_b = response.error) === null || _b === void 0 ? void 0 : _b.code) === 'messaging/registration-token-not-registered') {
                                    db.collection('users')
                                        .doc(userId)
                                        .update({
                                        fcmTokens: admin.firestore.FieldValue.arrayRemove(fcmTokens[index]),
                                    })
                                        .catch((err) => console.error('Error removing invalid token:', err));
                                }
                            }
                        });
                        if (successCount > 0) {
                            notificationsSent++;
                            // Update lastNotifiedAt and newItemsCount
                            await db
                                .collection('users')
                                .doc(userId)
                                .collection('savedSearches')
                                .doc(searchId)
                                .update({
                                lastNotifiedAt: firestore_1.FieldValue.serverTimestamp(),
                                newItemsCount: matchingArticles.length,
                            });
                            console.log(`Sent notification for search "${search.name}" to user ${userId}: ${matchingArticles.length} new items`);
                        }
                    }
                    catch (sendError) {
                        console.error(`Error sending notification for search ${searchId}:`, sendError);
                    }
                }
            }
        }
        console.log(`Saved search check complete. Checked ${searchesChecked} searches, sent ${notificationsSent} notifications.`);
        return null;
    }
    catch (error) {
        console.error('Error in saved search notification check:', error);
        return null;
    }
});
/**
 * Cloud Function: Mark saved search as viewed (resets newItemsCount)
 */
exports.markSavedSearchViewed = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    }
    const { searchId } = data;
    if (!searchId) {
        throw new functions.https.HttpsError('invalid-argument', 'Search ID is required');
    }
    const userId = context.auth.uid;
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
    }
    catch (error) {
        console.error('Error marking saved search as viewed:', error);
        throw new functions.https.HttpsError('internal', 'Failed to update saved search');
    }
});
// ============================================
// AI Product Analysis with Gemini
// ============================================
// Gemini client is initialized per-request to use the secret
// Using new @google/genai SDK (GA since May 2025)
const getGenAI = () => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        console.error('GEMINI_API_KEY not found in environment');
        return null;
    }
    return new genai_1.GoogleGenAI({ apiKey });
};
// ============================================================
// VISUAL SEARCH V2 - Unified Embeddings with Firestore Vector Search
// ============================================================
// Architecture:
// - Uses text-embedding-004 for ALL embeddings (768 dimensions)
// - Gemini analyzes images and generates semantic descriptions
// - Embeddings stored directly in articles collection
// - Firestore Vector Search (KNN) for scalable similarity search
// - No auth required for search (discovery-friendly)
// - Similarity threshold to filter irrelevant results
// ============================================================
const VISUAL_SEARCH_CONFIG = {
    // Using gemini-embedding-001 (3072 dims) - latest GA embedding model
    embeddingModel: 'gemini-embedding-001',
    embeddingDimensions: 3072,
    // Vision model for image analysis
    visionModel: 'gemini-2.5-flash',
    similarityThreshold: 0.5, // Minimum similarity score (0-1)
    defaultLimit: 20,
    maxLimit: 50,
};
/**
 * Analyze image with Gemini and generate a rich semantic description
 * This description will be used to create the embedding
 */
async function analyzeImageForSearch(imageBase64, mimeType) {
    var _a, _b, _c, _d, _e;
    const ai = getGenAI();
    if (!ai) {
        throw new Error('Gemini API not configured');
    }
    const prompt = `Tu es un expert en mode et vêtements. Analyse cette image et identifie l'article de mode principal.

IMPORTANT:
- Concentre-toi UNIQUEMENT sur le vêtement/accessoire principal, ignore le décor
- Sois précis sur le type d'article, les couleurs, le style et la matière

Réponds en JSON strict:
{
  "itemType": "type précis (ex: chemise, robe midi, sneakers, sac à main)",
  "description": "Description riche et détaillée pour la recherche (50-80 mots). Inclus: type, couleurs, style, coupe, détails distinctifs, occasion de port.",
  "attributes": {
    "colors": ["couleur1", "couleur2"],
    "style": "casual|formel|sportif|bohème|vintage|streetwear|chic|minimaliste",
    "material": "coton|lin|cuir|soie|laine|synthétique|denim|velours|null si pas visible",
    "brand": "marque si visible ou null",
    "category": "femmes|hommes|enfants"
  }
}`;
    try {
        const result = await retryWithBackoff(async () => {
            return await ai.models.generateContent({
                model: VISUAL_SEARCH_CONFIG.visionModel,
                contents: [
                    { text: prompt },
                    {
                        inlineData: {
                            mimeType,
                            data: imageBase64,
                        },
                    },
                ],
            });
        });
        const responseText = result.text || '';
        // Parse JSON from response
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            console.error('No JSON found in Gemini response:', responseText);
            // Fallback to basic description
            return {
                description: 'Article de mode',
                itemType: 'vêtement',
                attributes: { colors: [], style: 'casual' },
            };
        }
        const parsed = JSON.parse(jsonMatch[0]);
        console.log('Image analysis result:', JSON.stringify(parsed).slice(0, 200));
        return {
            description: parsed.description || 'Article de mode',
            itemType: parsed.itemType || 'vêtement',
            attributes: {
                colors: ((_a = parsed.attributes) === null || _a === void 0 ? void 0 : _a.colors) || [],
                style: ((_b = parsed.attributes) === null || _b === void 0 ? void 0 : _b.style) || 'casual',
                material: ((_c = parsed.attributes) === null || _c === void 0 ? void 0 : _c.material) || undefined,
                brand: ((_d = parsed.attributes) === null || _d === void 0 ? void 0 : _d.brand) || undefined,
                category: ((_e = parsed.attributes) === null || _e === void 0 ? void 0 : _e.category) || undefined,
            },
        };
    }
    catch (error) {
        console.error('Error analyzing image:', error);
        return {
            description: 'Article de mode',
            itemType: 'vêtement',
            attributes: { colors: [], style: 'casual' },
        };
    }
}
/**
 * Generate text embedding using Gemini gemini-embedding-001
 * Returns a 3072-dimension vector (latest GA embedding model)
 */
async function generateUnifiedEmbedding(text) {
    var _a, _b;
    const ai = getGenAI();
    if (!ai) {
        console.error('Gemini API not configured');
        return null;
    }
    try {
        const result = await ai.models.embedContent({
            model: VISUAL_SEARCH_CONFIG.embeddingModel,
            contents: text,
            config: {
                taskType: 'RETRIEVAL_DOCUMENT', // Optimize for search/retrieval
            },
        });
        // Extract embedding values from response
        const embedding = (_b = (_a = result.embeddings) === null || _a === void 0 ? void 0 : _a[0]) === null || _b === void 0 ? void 0 : _b.values;
        if (!embedding) {
            console.error('No embedding returned from API');
            return null;
        }
        if (embedding.length !== VISUAL_SEARCH_CONFIG.embeddingDimensions) {
            console.warn(`Unexpected embedding dimension: ${embedding.length}, expected ${VISUAL_SEARCH_CONFIG.embeddingDimensions}`);
        }
        return embedding;
    }
    catch (error) {
        console.error('Error generating embedding:', error);
        return null;
    }
}
/**
 * Build a rich semantic text for embedding from article data
 * This text captures the essence of the article for similarity matching
 */
function buildArticleEmbeddingText(article) {
    const parts = [];
    // Title and description are primary
    if (article.title)
        parts.push(article.title);
    if (article.description)
        parts.push(article.description);
    // Category path provides context
    if (article.categoryPath && Array.isArray(article.categoryPath)) {
        parts.push(article.categoryPath.join(' '));
    }
    else if (article.category) {
        parts.push(article.category);
    }
    // Attributes add specificity
    if (article.brand)
        parts.push(`marque ${article.brand}`);
    if (article.color)
        parts.push(`couleur ${article.color}`);
    if (article.material)
        parts.push(`matière ${article.material}`);
    if (article.condition)
        parts.push(`état ${article.condition}`);
    if (article.style)
        parts.push(`style ${article.style}`);
    // Size can help for category matching
    if (article.size)
        parts.push(`taille ${article.size}`);
    const text = parts.filter(Boolean).join('. ');
    // Limit length for embedding model
    return text.slice(0, 2000);
}
/**
 * Compute cosine similarity between two vectors
 */
function computeCosineSimilarity(a, b) {
    if (a.length !== b.length)
        return 0;
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
        dotProduct += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
    return magnitude === 0 ? 0 : dotProduct / magnitude;
}
// Retry helper for Gemini API calls (handles 503 Service Unavailable)
async function retryWithBackoff(fn, maxRetries = 3, baseDelay = 1000) {
    var _a, _b;
    let lastError;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            return await fn();
        }
        catch (error) {
            lastError = error;
            const isRetryable = error.status === 503 || error.status === 429 ||
                ((_a = error.message) === null || _a === void 0 ? void 0 : _a.includes('overloaded')) ||
                ((_b = error.message) === null || _b === void 0 ? void 0 : _b.includes('rate limit'));
            if (!isRetryable || attempt === maxRetries - 1) {
                throw error;
            }
            const delay = baseDelay * Math.pow(2, attempt); // Exponential backoff
            console.log(`Gemini API returned ${error.status || 'error'}, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    throw lastError;
}
// ============================================
// SINGLE-STEP ULTRA-COMPACT ANALYSIS PROMPT
// ============================================
// Cached prompt (generated once)
let cachedAnalysisPrompt = null;
function generateSingleStepAnalysisPrompt() {
    // Use cached prompt if available
    if (cachedAnalysisPrompt)
        return cachedAnalysisPrompt;
    // Categories: compact grouped format (~500 tokens instead of ~37K!)
    const categoryLabels = (0, productReference_1.generateCompactCategoryPrompt)();
    // Colors: just names
    const colors = productReference_1.COLOR_REFERENCE.map(c => c.name).join(', ');
    // Materials: just names
    const materials = productReference_1.MATERIAL_REFERENCE.map(m => m.name).join(', ');
    cachedAnalysisPrompt = `Analyse cet article de mode. Réponds en JSON uniquement.

CATÉGORIES (choisis la plus précise):
${categoryLabels}

COULEURS: ${colors}
MATIÈRES: ${materials}
ÉTATS: Neuf avec étiquette, Très bon état, Bon état, Satisfaisant

{
  "genre": "Femmes|Hommes|Enfants",
  "category": "Label exact de la liste",
  "title": "Titre court accrocheur",
  "description": "Description 50-100 mots",
  "condition": "neuf|tres-bon-etat|bon-etat|satisfaisant",
  "color": "Couleur principale",
  "material": "Matière principale",
  "size": "Taille lue sur étiquette ou null",
  "brand": "Marque détectée ou null",
  "packageSize": "small|medium|large",
  "labelFound": true/false,
  "confidence": 0.0-1.0
}`;
    return cachedAnalysisPrompt;
}
/**
 * Get category icon based on the category path
 */
function getCategoryIcon(path) {
    if (!path || path.length === 0)
        return '📦';
    const root = path[0];
    const type = path.length > 1 ? path[1] : '';
    // Root level icons
    const rootIcons = {
        women: '👩',
        men: '👨',
        kids: '👶',
        home: '🏠',
        electronics: '📱',
        entertainment: '🎮',
        other: '📦',
    };
    // Type-specific icons (second level)
    const typeIcons = {
        // Women
        women_clothing: '👗',
        women_shoes: '👠',
        women_bags: '👜',
        women_accessories: '💍',
        // Men
        men_clothing: '👔',
        men_shoes: '👞',
        men_bags: '🎒',
        men_accessories: '⌚',
        // Kids
        kids_girls: '👧',
        kids_boys: '👦',
        kids_baby: '👶',
        // More specific
        _coats: '🧥',
        _jackets: '🧥',
        _shirts: '👕',
        _pants: '👖',
        _dresses: '👗',
        _sweaters: '🧶',
        _sportswear: '🏃',
    };
    // Check for type-specific icon
    if (typeIcons[type])
        return typeIcons[type];
    // Check for partial matches in path
    const pathStr = path.join('_').toLowerCase();
    for (const [key, icon] of Object.entries(typeIcons)) {
        if (pathStr.includes(key))
            return icon;
    }
    // Fallback to root icon
    return rootIcons[root] || '📦';
}
function getSizeCategoryType(categoryPath) {
    var _a;
    if (!categoryPath || categoryPath.length === 0)
        return 'women_clothing';
    const pathStr = categoryPath.join('_').toLowerCase();
    const root = ((_a = categoryPath[0]) === null || _a === void 0 ? void 0 : _a.toLowerCase()) || '';
    // Kids
    if (root === 'kids' || pathStr.includes('enfant')) {
        if (pathStr.includes('shoes') || pathStr.includes('chaussure'))
            return 'kids_shoes';
        return 'kids_clothing';
    }
    // Men
    if (root === 'men' || pathStr.includes('homme')) {
        if (pathStr.includes('shoes') || pathStr.includes('chaussure'))
            return 'men_shoes';
        if (pathStr.includes('bags') || pathStr.includes('accessories') || pathStr.includes('sac') || pathStr.includes('accessoire')) {
            return 'accessories';
        }
        return 'men_clothing';
    }
    // Women (default)
    if (pathStr.includes('shoes') || pathStr.includes('chaussure'))
        return 'women_shoes';
    if (pathStr.includes('bags') || pathStr.includes('accessories') || pathStr.includes('sac') || pathStr.includes('accessoire')) {
        return 'accessories';
    }
    return 'women_clothing';
}
/**
 * Normalize a detected size against the valid sizes for a category
 * Returns the normalized size if found, or the original detected size
 */
function normalizeSize(detectedSize, categoryPath) {
    if (!detectedSize)
        return { normalized: null, isValid: false };
    const categoryType = getSizeCategoryType(categoryPath);
    const sizeRef = productReference_1.SIZE_REFERENCE.find(s => s.categoryType === categoryType);
    if (!sizeRef)
        return { normalized: detectedSize, isValid: false };
    const normalizedInput = detectedSize.trim().toUpperCase();
    // Try exact match (case-insensitive)
    const exactMatch = sizeRef.sizes.find(s => s.toUpperCase() === normalizedInput);
    if (exactMatch)
        return { normalized: exactMatch, isValid: true };
    // Try partial match for common variations
    // e.g., "T.38" or "Taille 38" -> "38", "EUR 38" -> "38"
    const numericMatch = normalizedInput.match(/\d+(\.\d+)?/);
    if (numericMatch) {
        const numericSize = numericMatch[0];
        const foundSize = sizeRef.sizes.find(s => s === numericSize || s === numericSize.replace('.', ','));
        if (foundSize)
            return { normalized: foundSize, isValid: true };
    }
    // Handle letter sizes with common variations
    // e.g., "SMALL" -> "S", "MEDIUM" -> "M", "LARGE" -> "L"
    const letterMap = {
        'EXTRA SMALL': 'XS',
        'X-SMALL': 'XS',
        'SMALL': 'S',
        'MEDIUM': 'M',
        'LARGE': 'L',
        'EXTRA LARGE': 'XL',
        'X-LARGE': 'XL',
        'XX-LARGE': 'XXL',
        'XXX-LARGE': 'XXXL',
    };
    const mappedSize = letterMap[normalizedInput];
    if (mappedSize && sizeRef.sizes.includes(mappedSize)) {
        return { normalized: mappedSize, isValid: true };
    }
    // Return original if no match found
    return { normalized: detectedSize, isValid: false };
}
/**
 * Validates and normalizes the Gemini response.
 * Converts SIMPLE format from LLM to STRUCTURED format for frontend.
 *
 * INPUT (from LLM - simple strings):
 * { title, description, category (label), condition, color, material, size, brand, packageSize, labelFound, confidence }
 *
 * OUTPUT (for frontend - structured objects):
 * { title, description, category: AICategory, condition, colors, materials, size, brand, packageSize, labelFound }
 */
async function validateAndNormalizeResponse(response) {
    var _a, _b, _c, _d, _e, _f;
    console.log('   [normalize] Starting validation & normalization...');
    const normalizeStart = Date.now();
    const globalConfidence = response.confidence || 0.7;
    const topLevelCategory = ((_a = response._analysisMetadata) === null || _a === void 0 ? void 0 : _a.topLevelCategory) || 'women';
    // ========================================
    // 1. CATEGORY: Label string → Structured object
    // ========================================
    let categoryResult = {
        categoryId: '',
        categoryPath: [],
        displayName: '',
        fullLabel: '',
        icon: '📦',
        confidence: globalConfidence,
        validated: false,
    };
    if (response.category && typeof response.category === 'string') {
        // New format: just a label string
        const categoryLabel = response.category;
        console.log(`   [normalize] Looking up category: "${categoryLabel}" (scope: ${topLevelCategory})`);
        // Use improved fuzzy matching
        const category = (0, productReference_1.findCategoryByLabelFuzzy)(categoryLabel, topLevelCategory);
        if (category) {
            categoryResult = {
                categoryId: category.id,
                categoryPath: category.path,
                displayName: category.label,
                fullLabel: category.fullLabel,
                icon: getCategoryIcon(category.path),
                confidence: globalConfidence,
                validated: true,
            };
            console.log(`Category matched: "${categoryLabel}" → ${category.id}`);
        }
        else {
            console.warn(`Category not found: "${categoryLabel}"`);
            categoryResult.displayName = categoryLabel;
        }
    }
    else if ((_b = response.category) === null || _b === void 0 ? void 0 : _b.categoryId) {
        // Legacy format: already structured
        categoryResult = response.category;
    }
    // ========================================
    // 2. COLOR: Name string → Structured object
    // ========================================
    let colorsResult = {
        colorIds: [],
        primaryColorId: '',
        confidence: globalConfidence,
    };
    if (response.color && typeof response.color === 'string') {
        const color = (0, productReference_1.findColorByNameOrAlias)(response.color);
        if (color) {
            colorsResult = {
                colorIds: [color.id],
                primaryColorId: color.id,
                confidence: globalConfidence,
            };
            console.log(`Color matched: "${response.color}" → ${color.id}`);
        }
        else {
            console.warn(`Color not found: "${response.color}"`);
        }
    }
    else if ((_c = response.colors) === null || _c === void 0 ? void 0 : _c.primaryColorId) {
        // Legacy format
        const primaryColor = (0, productReference_1.findColorByNameOrAlias)(response.colors.primaryColorId);
        colorsResult = {
            colorIds: response.colors.colorIds || [],
            primaryColorId: (primaryColor === null || primaryColor === void 0 ? void 0 : primaryColor.id) || response.colors.primaryColorId,
            confidence: response.colors.confidence || globalConfidence,
        };
    }
    // ========================================
    // 3. MATERIAL: Name string → Structured object
    // ========================================
    let materialsResult = {
        materialIds: [],
        primaryMaterialId: '',
        composition: null,
        confidence: globalConfidence,
    };
    if (response.material && typeof response.material === 'string') {
        const material = (0, productReference_1.findMaterialByNameOrAlias)(response.material);
        if (material) {
            materialsResult = {
                materialIds: [material.id],
                primaryMaterialId: material.id,
                composition: null,
                confidence: globalConfidence,
            };
            console.log(`Material matched: "${response.material}" → ${material.id}`);
        }
        else {
            console.warn(`Material not found: "${response.material}"`);
        }
    }
    else if ((_d = response.materials) === null || _d === void 0 ? void 0 : _d.primaryMaterialId) {
        // Legacy format
        const primaryMaterial = (0, productReference_1.findMaterialByNameOrAlias)(response.materials.primaryMaterialId);
        materialsResult = {
            materialIds: response.materials.materialIds || [],
            primaryMaterialId: (primaryMaterial === null || primaryMaterial === void 0 ? void 0 : primaryMaterial.id) || response.materials.primaryMaterialId,
            composition: response.materials.composition || null,
            confidence: response.materials.confidence || globalConfidence,
        };
    }
    // ========================================
    // 4. CONDITION: Normalize ID
    // ========================================
    const validConditions = ['neuf', 'tres-bon-etat', 'bon-etat', 'satisfaisant'];
    let conditionId = 'bon-etat';
    if (response.condition && typeof response.condition === 'string') {
        const inputCondition = response.condition.toLowerCase().trim()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/\s+/g, '-');
        if (validConditions.includes(inputCondition)) {
            conditionId = inputCondition;
        }
        else {
            const fallbackMap = {
                'new': 'neuf', 'neuf-avec-etiquette': 'neuf',
                'like-new': 'tres-bon-etat',
                'good': 'bon-etat',
                'fair': 'satisfaisant',
            };
            conditionId = fallbackMap[inputCondition] || 'bon-etat';
        }
    }
    else if ((_e = response.condition) === null || _e === void 0 ? void 0 : _e.conditionId) {
        conditionId = response.condition.conditionId;
    }
    const conditionResult = { conditionId, confidence: globalConfidence };
    // ========================================
    // 5. SIZE: Normalize against valid sizes for category
    // ========================================
    const detectedSize = response.size || null;
    const { normalized: normalizedSize, isValid: sizeIsValid } = normalizeSize(detectedSize, categoryResult.categoryPath);
    if (detectedSize) {
        console.log(`   [normalize] Size: "${detectedSize}" → "${normalizedSize}" (valid: ${sizeIsValid})`);
    }
    const sizeResult = {
        detected: detectedSize,
        normalized: normalizedSize,
        isValid: sizeIsValid,
        confidence: detectedSize ? (sizeIsValid ? globalConfidence : globalConfidence * 0.5) : 0,
    };
    // ========================================
    // 6. BRAND: Name string → Matched object
    // ========================================
    const brandStart = Date.now();
    let brandResult = {
        detected: null,
        brandId: null,
        brandName: null,
        matchConfidence: 0,
        matchType: 'none',
        needsConfirmation: false,
        suggestions: [],
        confidence: globalConfidence,
    };
    const detectedBrand = typeof response.brand === 'string' ? response.brand : (_f = response.brand) === null || _f === void 0 ? void 0 : _f.detected;
    if (detectedBrand && detectedBrand.toLowerCase() !== 'null') {
        console.log(`   [normalize] Matching brand: "${detectedBrand}"`);
        const brandMatch = await matchBrand(detectedBrand);
        brandResult = {
            detected: detectedBrand,
            brandId: brandMatch.brandId,
            brandName: brandMatch.brandName || detectedBrand,
            matchConfidence: brandMatch.confidence,
            matchType: brandMatch.matchType,
            needsConfirmation: brandMatch.needsConfirmation,
            suggestions: brandMatch.suggestions,
            confidence: globalConfidence,
        };
        const brandTime = Date.now() - brandStart;
        console.log(`   [normalize] Brand match: "${detectedBrand}" → ${brandMatch.brandId || 'no match'} (${brandMatch.matchType}) [${brandTime}ms]`);
    }
    // ========================================
    // 7. PACKAGE SIZE: Normalize
    // ========================================
    const validPackageSizes = ['small', 'medium', 'large'];
    const packageSizeSuggested = validPackageSizes.includes(response.packageSize) ? response.packageSize : 'medium';
    const packageSizeResult = { suggested: packageSizeSuggested, confidence: globalConfidence };
    // ========================================
    // BUILD FINAL RESPONSE
    // ========================================
    const normalizeTime = Date.now() - normalizeStart;
    console.log(`   [normalize] Completed in ${normalizeTime}ms`);
    return {
        title: response.title || '',
        titleConfidence: globalConfidence,
        description: response.description || '',
        descriptionConfidence: globalConfidence,
        category: categoryResult,
        condition: conditionResult,
        colors: colorsResult,
        materials: materialsResult,
        size: sizeResult,
        brand: brandResult,
        packageSize: packageSizeResult,
        labelFound: response.labelFound === true,
        _analysisMetadata: response._analysisMetadata,
    };
}
// Helper to estimate tokens (rough: ~4 chars per token for text, base64 is ~0.75 bytes per char)
function estimateTokens(text, isBase64 = false) {
    if (isBase64) {
        // Base64 images: ~0.75 bytes per char, ~4 bytes per token
        return Math.ceil(text.length * 0.75 / 4);
    }
    return Math.ceil(text.length / 4);
}
exports.analyzeProductImage = functions
    .runWith({
    secrets: ['GEMINI_API_KEY'],
    memory: '1GB',
    timeoutSeconds: 120,
    minInstances: 1, // Keep one instance warm to avoid cold starts
})
    .https.onCall(async (data, context) => {
    var _a, _b, _c, _d;
    const totalStartTime = Date.now();
    const timings = {};
    const tokenCounts = {};
    // Verify authentication
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    }
    // Support both single image (legacy) and multiple images
    const { imageBase64, mimeType, images } = data;
    // Build images array
    let imageDataArray = [];
    if (images && Array.isArray(images)) {
        // New format: array of images
        imageDataArray = images.map((img) => ({
            base64: img.base64,
            mimeType: img.mimeType || 'image/jpeg',
        }));
    }
    else if (imageBase64 && mimeType) {
        // Legacy format: single image
        imageDataArray = [{ base64: imageBase64, mimeType }];
    }
    if (imageDataArray.length === 0) {
        throw new functions.https.HttpsError('invalid-argument', 'At least one image is required');
    }
    // Calculate image stats
    const imageSizes = imageDataArray.map(img => img.base64.length);
    const totalImageBytes = imageSizes.reduce((a, b) => a + b, 0);
    const imageTokens = imageDataArray.reduce((sum, img) => sum + estimateTokens(img.base64, true), 0);
    console.log('='.repeat(60));
    console.log('🔍 ANALYSIS START (SINGLE-STEP OPTIMIZED)');
    console.log('='.repeat(60));
    console.log(`📸 Images: ${imageDataArray.length}`);
    console.log(`📏 Image sizes: ${imageSizes.map(s => `${Math.round(s / 1024)}KB`).join(', ')}`);
    console.log(`📊 Total image data: ${Math.round(totalImageBytes / 1024)}KB`);
    console.log(`🎯 Estimated image tokens: ~${imageTokens.toLocaleString()}`);
    tokenCounts['images'] = imageTokens;
    const ai = getGenAI();
    if (!ai) {
        console.error('Gemini API key not configured');
        throw new functions.https.HttpsError('failed-precondition', 'AI service not configured');
    }
    try {
        // Helper to build image parts for Gemini (new SDK format)
        const buildImageParts = () => imageDataArray.map(imgData => ({
            inlineData: {
                mimeType: imgData.mimeType,
                data: imgData.base64,
            },
        }));
        // ========================================
        // SINGLE-STEP ANALYSIS (Ultra-compact prompt)
        // ========================================
        console.log('-'.repeat(40));
        console.log('📍 SINGLE-STEP: Full analysis with compact categories');
        const analysisStartTime = Date.now();
        const analysisPrompt = generateSingleStepAnalysisPrompt();
        const promptTokens = estimateTokens(analysisPrompt);
        tokenCounts['prompt'] = promptTokens;
        console.log(`   Prompt tokens: ~${promptTokens} (was ~37K with old 2-step!)`);
        console.log(`   Total tokens: ~${(promptTokens + imageTokens).toLocaleString()}`);
        console.log('-'.repeat(40));
        console.log('📝 PROMPT SENT TO GEMINI:');
        console.log('-'.repeat(40));
        console.log(analysisPrompt);
        console.log('-'.repeat(40));
        // Build contents array for new SDK (text first, then images)
        const contents = [
            { text: analysisPrompt },
            ...buildImageParts(),
        ];
        // Start brand preloading in parallel
        const brandsPreloadStart = Date.now();
        const brandsPreloadPromise = loadBrands();
        const apiStart = Date.now();
        const analysisResult = await retryWithBackoff(() => ai.models.generateContent({
            model: 'gemini-2.5-flash', // Latest stable model
            contents,
        }));
        const apiTime = Date.now() - apiStart;
        timings['api'] = apiTime;
        console.log(`   ⏱️  API call: ${apiTime}ms`);
        // Ensure brands are loaded (should be ready by now)
        await brandsPreloadPromise;
        const brandsPreloadTime = Date.now() - brandsPreloadStart;
        timings['brands_preload'] = brandsPreloadTime;
        console.log(`   ⏱️  Brands preload (parallel): ${brandsPreloadTime}ms`);
        const responseText = analysisResult.text || '';
        const responseTokens = estimateTokens(responseText);
        tokenCounts['response'] = responseTokens;
        console.log(`   Response tokens: ~${responseTokens}`);
        // Parse response
        let jsonResponse;
        try {
            const jsonMatch = responseText.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                jsonResponse = JSON.parse(jsonMatch[0]);
            }
            else {
                throw new Error('No JSON found in response');
            }
        }
        catch (parseError) {
            console.error('   ❌ Failed to parse response:', responseText);
            throw new functions.https.HttpsError('internal', 'Failed to parse AI response');
        }
        // Map genre to topLevelCategory for compatibility
        const genreMap = {
            'femmes': 'women',
            'hommes': 'men',
            'enfants': 'kids',
        };
        const topCategory = genreMap[(_a = jsonResponse.genre) === null || _a === void 0 ? void 0 : _a.toLowerCase()] || 'women';
        console.log(`   Genre: ${jsonResponse.genre} → topCategory: ${topCategory}`);
        const analysisTotalTime = Date.now() - analysisStartTime;
        timings['analysis_total'] = analysisTotalTime;
        console.log(`   ⏱️  Analysis total: ${analysisTotalTime}ms`);
        // Add metadata to response
        jsonResponse._analysisMetadata = {
            topLevelCategory: topCategory,
            singleStepApproach: true,
        };
        // ========================================
        // POST-PROCESSING: Validation & Brand Matching
        // ========================================
        console.log('-'.repeat(40));
        console.log('📍 POST-PROCESSING: Validation & Brand Matching');
        const postProcessStart = Date.now();
        // Validate and normalize the response (includes brand fuzzy matching)
        const normalizedResponse = await validateAndNormalizeResponse(jsonResponse);
        const postProcessTime = Date.now() - postProcessStart;
        timings['post_processing'] = postProcessTime;
        console.log(`   ⏱️  Post-processing: ${postProcessTime}ms`);
        // ========================================
        // FINAL SUMMARY
        // ========================================
        const totalTime = Date.now() - totalStartTime;
        timings['total'] = totalTime;
        const totalTokens = (tokenCounts['prompt'] || 0) + (tokenCounts['images'] || 0);
        console.log('='.repeat(60));
        console.log('📊 ANALYSIS COMPLETE - SUMMARY');
        console.log('='.repeat(60));
        console.log(`⏱️  TIMINGS:`);
        console.log(`   API call:          ${timings['api']}ms`);
        console.log(`   Brands preload:    ${timings['brands_preload']}ms`);
        console.log(`   Post-processing:   ${timings['post_processing']}ms`);
        console.log(`   TOTAL:             ${totalTime}ms`);
        console.log('');
        console.log(`🎯 TOKEN ESTIMATES (SINGLE-STEP):`);
        console.log(`   Prompt:            ~${tokenCounts['prompt']}`);
        console.log(`   Images:            ~${(_b = tokenCounts['images']) === null || _b === void 0 ? void 0 : _b.toLocaleString()}`);
        console.log(`   TOTAL INPUT:       ~${totalTokens.toLocaleString()}`);
        console.log(`   (Old 2-step would have been: ~${(tokenCounts['images'] * 2 + 37000).toLocaleString()})`);
        console.log('='.repeat(60));
        return normalizedResponse;
    }
    catch (error) {
        console.error('Gemini API error - Full details:', {
            message: error.message,
            code: error.code,
            status: error.status,
            name: error.name,
        });
        if (error.code === 'functions/failed-precondition') {
            throw error;
        }
        // Return more specific error codes for the client
        if (error.status === 503 || ((_c = error.message) === null || _c === void 0 ? void 0 : _c.includes('overloaded'))) {
            throw new functions.https.HttpsError('unavailable', 'AI service temporarily unavailable. Please try again.');
        }
        if (error.status === 429 || ((_d = error.message) === null || _d === void 0 ? void 0 : _d.includes('rate limit'))) {
            throw new functions.https.HttpsError('resource-exhausted', 'Too many requests. Please wait and try again.');
        }
        throw new functions.https.HttpsError('internal', 'AI analysis failed: ' + (error.message || 'Unknown error'));
    }
});
// ============================================
// Visual Search V2 - Exported Functions
// ============================================
// Helper: Get price range bucket
function getPriceRange(price) {
    if (price < 20)
        return 'low';
    if (price <= 100)
        return 'medium';
    return 'high';
}
/**
 * Generate/update embedding for an article when created or updated
 * Uses unified text embeddings (768 dimensions) stored directly in article
 */
exports.generateArticleEmbedding = functions.firestore
    .document('articles/{articleId}')
    .onWrite(async (change, context) => {
    var _a, _b, _c, _d;
    const articleId = context.params.articleId;
    // If deleted, nothing to do (embedding was in the article)
    if (!change.after.exists) {
        console.log(`Article ${articleId} deleted`);
        return;
    }
    const article = change.after.data();
    const beforeData = change.before.exists ? change.before.data() : null;
    // Check if we need to regenerate embedding
    // Regenerate if: new article, image changed, or key attributes changed
    const needsNewEmbedding = !change.before.exists ||
        ((_b = (_a = article.images) === null || _a === void 0 ? void 0 : _a[0]) === null || _b === void 0 ? void 0 : _b.url) !== ((_d = (_c = beforeData === null || beforeData === void 0 ? void 0 : beforeData.images) === null || _c === void 0 ? void 0 : _c[0]) === null || _d === void 0 ? void 0 : _d.url) ||
        article.title !== (beforeData === null || beforeData === void 0 ? void 0 : beforeData.title) ||
        article.description !== (beforeData === null || beforeData === void 0 ? void 0 : beforeData.description) ||
        article.category !== (beforeData === null || beforeData === void 0 ? void 0 : beforeData.category);
    if (!needsNewEmbedding) {
        console.log(`No embedding update needed for ${articleId}`);
        return;
    }
    // Skip if article is not active or is sold
    if (!article.isActive || article.isSold) {
        console.log(`Skipping embedding for inactive/sold article ${articleId}`);
        return;
    }
    try {
        console.log(`Generating unified embedding for article ${articleId}`);
        const startTime = Date.now();
        // Build rich semantic text from article data
        const embeddingText = buildArticleEmbeddingText(article);
        // Generate embedding
        const embedding = await generateUnifiedEmbedding(embeddingText);
        if (!embedding) {
            console.error(`Failed to generate embedding for ${articleId}`);
            return;
        }
        // Store embedding directly in the article document as an array
        // Note: For true Firestore Vector Search with findNearest(), upgrade to Admin SDK 12+
        // and create a vector index. For now, we store as array and do client-side similarity.
        await db.collection('articles').doc(articleId).update({
            embedding: embedding,
            embeddingUpdatedAt: firestore_1.FieldValue.serverTimestamp(),
        });
        const duration = Date.now() - startTime;
        console.log(`Generated embedding for ${articleId} in ${duration}ms (${embedding.length} dims)`);
    }
    catch (error) {
        console.error(`Error generating embedding for ${articleId}:`, error);
    }
});
/**
 * Visual Search V2 - Find similar products from an image
 *
 * Improvements over V1:
 * - No auth required (discovery-friendly)
 * - Uses Firestore Vector Search (KNN) - scales to millions
 * - Unified embeddings (768 dims) - no dimension mismatch
 * - Similarity threshold - filters irrelevant results
 * - Always returns query description
 */
exports.visualSearch = functions
    .runWith({
    timeoutSeconds: 60,
    memory: '512MB',
})
    .https.onCall(async (data, context) => {
    var _a, _b;
    const startTime = Date.now();
    console.log('visualSearch V2 called, auth:', context.auth ? context.auth.uid : 'guest');
    const { imageBase64, mimeType = 'image/jpeg', filters = {}, limit = VISUAL_SEARCH_CONFIG.defaultLimit } = data;
    if (!imageBase64) {
        throw new functions.https.HttpsError('invalid-argument', 'Image is required');
    }
    const effectiveLimit = Math.min(limit, VISUAL_SEARCH_CONFIG.maxLimit);
    try {
        // Step 1: Analyze image with Gemini to get semantic description
        console.log('Step 1: Analyzing image with Gemini...');
        const analysisStart = Date.now();
        const analysis = await analyzeImageForSearch(imageBase64, mimeType);
        console.log(`Image analysis completed in ${Date.now() - analysisStart}ms`);
        console.log(`Detected: ${analysis.itemType} - ${analysis.attributes.colors.join(', ')}`);
        // Step 2: Generate embedding from description
        console.log('Step 2: Generating search embedding...');
        const embeddingStart = Date.now();
        const searchEmbedding = await generateUnifiedEmbedding(analysis.description);
        if (!searchEmbedding) {
            throw new functions.https.HttpsError('internal', 'Failed to generate search embedding');
        }
        console.log(`Embedding generated in ${Date.now() - embeddingStart}ms`);
        // Step 3: Perform vector search using Firestore
        console.log('Step 3: Searching for similar articles...');
        const searchStart = Date.now();
        // Build base query
        let query = db.collection('articles')
            .where('isActive', '==', true)
            .where('isSold', '==', false);
        // Apply category filter if specified
        if ((_a = filters.categoryIds) === null || _a === void 0 ? void 0 : _a.length) {
            // Note: Firestore array-contains-any is limited to 30 values
            const categoryFilter = filters.categoryIds.slice(0, 30);
            query = query.where('categoryIds', 'array-contains-any', categoryFilter);
        }
        // Fetch articles with embeddings
        // Note: For production scale, use Firestore Vector Search with findNearest()
        // For now, we use a hybrid approach: fetch candidates then compute similarity
        const snapshot = await query
            .where('embedding', '!=', null)
            .limit(1000) // Fetch more candidates for better results
            .get();
        console.log(`Found ${snapshot.docs.length} candidate articles`);
        // Compute similarities
        const similarities = [];
        for (const doc of snapshot.docs) {
            if (doc.id === filters.excludeArticleId)
                continue;
            const article = doc.data();
            const articleEmbedding = article.embedding;
            // Skip if no embedding or wrong format
            if (!articleEmbedding)
                continue;
            // Handle Firestore Vector type
            const embeddingArray = Array.isArray(articleEmbedding)
                ? articleEmbedding
                : ((_b = articleEmbedding.toArray) === null || _b === void 0 ? void 0 : _b.call(articleEmbedding)) || [];
            if (embeddingArray.length !== searchEmbedding.length)
                continue;
            const score = computeCosineSimilarity(searchEmbedding, embeddingArray);
            // Apply similarity threshold
            if (score >= VISUAL_SEARCH_CONFIG.similarityThreshold) {
                similarities.push({ docId: doc.id, score, article });
            }
        }
        // Sort by similarity (highest first)
        similarities.sort((a, b) => b.score - a.score);
        console.log(`${similarities.length} articles above threshold (${VISUAL_SEARCH_CONFIG.similarityThreshold})`);
        // Apply price filter if specified
        let filtered = similarities;
        if (filters.priceRange) {
            filtered = similarities.filter(s => getPriceRange(s.article.price) === filters.priceRange);
        }
        // Take top results
        const topMatches = filtered.slice(0, effectiveLimit);
        console.log(`Search completed in ${Date.now() - searchStart}ms`);
        // Build results
        const results = topMatches.map(match => {
            var _a, _b;
            return ({
                articleId: match.docId,
                similarity: Math.round(match.score * 100),
                title: match.article.title,
                price: match.article.price,
                imageUrl: (_b = (_a = match.article.images) === null || _a === void 0 ? void 0 : _a[0]) === null || _b === void 0 ? void 0 : _b.url,
                brand: match.article.brand || null,
                condition: match.article.condition,
                size: match.article.size || null,
            });
        });
        const totalDuration = Date.now() - startTime;
        console.log(`Visual search V2 completed in ${totalDuration}ms, returning ${results.length} results`);
        return {
            results,
            queryDescription: analysis.description,
            queryAttributes: analysis.attributes,
            searchMetrics: {
                totalTimeMs: totalDuration,
                candidatesScanned: snapshot.docs.length,
                resultsAboveThreshold: similarities.length,
                resultsReturned: results.length,
            },
        };
    }
    catch (error) {
        console.error('Error in visual search V2:', error);
        throw new functions.https.HttpsError('internal', 'Visual search failed: ' + error.message);
    }
});
/**
 * Get similar products for a given article
 * Uses the article's stored embedding for similarity search
 */
exports.getSimilarProducts = functions.https.onCall(async (data, context) => {
    var _a, _b;
    console.log('getSimilarProducts V2 called');
    const { articleId, limit = 10, includeScore = false } = data;
    if (!articleId) {
        throw new functions.https.HttpsError('invalid-argument', 'articleId is required');
    }
    try {
        // Get source article
        const articleDoc = await db.collection('articles').doc(articleId).get();
        if (!articleDoc.exists) {
            console.log(`Article ${articleId} not found`);
            return { results: [], error: 'Article not found' };
        }
        const sourceArticle = articleDoc.data();
        const sourceEmbedding = sourceArticle.embedding;
        if (!sourceEmbedding) {
            console.log(`No embedding for article ${articleId}`);
            return { results: [], fallback: true };
        }
        // Convert Firestore Vector to array
        const embeddingArray = Array.isArray(sourceEmbedding)
            ? sourceEmbedding
            : ((_a = sourceEmbedding.toArray) === null || _a === void 0 ? void 0 : _a.call(sourceEmbedding)) || [];
        // Fetch candidate articles
        const snapshot = await db.collection('articles')
            .where('isActive', '==', true)
            .where('isSold', '==', false)
            .where('embedding', '!=', null)
            .limit(500)
            .get();
        // Compute similarities
        const similarities = [];
        for (const doc of snapshot.docs) {
            if (doc.id === articleId)
                continue;
            const article = doc.data();
            const articleEmbedding = article.embedding;
            if (!articleEmbedding)
                continue;
            const targetArray = Array.isArray(articleEmbedding)
                ? articleEmbedding
                : ((_b = articleEmbedding.toArray) === null || _b === void 0 ? void 0 : _b.call(articleEmbedding)) || [];
            if (targetArray.length !== embeddingArray.length)
                continue;
            const score = computeCosineSimilarity(embeddingArray, targetArray);
            if (score >= VISUAL_SEARCH_CONFIG.similarityThreshold) {
                similarities.push({ docId: doc.id, score, article });
            }
        }
        // Sort and take top results
        similarities.sort((a, b) => b.score - a.score);
        const topMatches = similarities.slice(0, limit);
        // Build results
        const results = topMatches.map(match => {
            var _a, _b;
            const result = {
                articleId: match.docId,
                title: match.article.title,
                price: match.article.price,
                imageUrl: (_b = (_a = match.article.images) === null || _a === void 0 ? void 0 : _a[0]) === null || _b === void 0 ? void 0 : _b.url,
                brand: match.article.brand || null,
                condition: match.article.condition,
            };
            if (includeScore) {
                result.similarity = Math.round(match.score * 100);
            }
            return result;
        });
        return { results };
    }
    catch (error) {
        console.error('Error getting similar products:', error);
        throw new functions.https.HttpsError('internal', 'Failed to get similar products');
    }
});
/**
 * Regenerate embeddings for all active articles
 * Utility function for migration or reindexing
 */
exports.regenerateAllEmbeddings = functions
    .runWith({
    timeoutSeconds: 540,
    memory: '1GB',
})
    .https.onCall(async (data, context) => {
    // Admin only
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Must be authenticated');
    }
    const { batchSize = 50, dryRun = true } = data;
    console.log(`Regenerating embeddings (dryRun: ${dryRun}, batchSize: ${batchSize})`);
    try {
        // Get all active articles without embeddings or with old embeddings
        const snapshot = await db.collection('articles')
            .where('isActive', '==', true)
            .where('isSold', '==', false)
            .limit(batchSize)
            .get();
        const articlesToProcess = snapshot.docs.filter(doc => {
            const data = doc.data();
            return !data.embedding || !data.embeddingUpdatedAt;
        });
        console.log(`Found ${articlesToProcess.length} articles needing embeddings`);
        if (dryRun) {
            return {
                dryRun: true,
                articlesFound: snapshot.docs.length,
                articlesNeedingEmbeddings: articlesToProcess.length,
                sampleIds: articlesToProcess.slice(0, 5).map(d => d.id),
            };
        }
        let processed = 0;
        let errors = 0;
        for (const doc of articlesToProcess) {
            try {
                const article = doc.data();
                const embeddingText = buildArticleEmbeddingText(article);
                const embedding = await generateUnifiedEmbedding(embeddingText);
                if (embedding) {
                    await doc.ref.update({
                        embedding: embedding,
                        embeddingUpdatedAt: firestore_1.FieldValue.serverTimestamp(),
                    });
                    processed++;
                }
                else {
                    errors++;
                }
                // Rate limiting
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            catch (err) {
                console.error(`Error processing ${doc.id}:`, err);
                errors++;
            }
        }
        return {
            processed,
            errors,
            total: articlesToProcess.length,
        };
    }
    catch (error) {
        console.error('Error regenerating embeddings:', error);
        throw new functions.https.HttpsError('internal', error.message);
    }
});
// ============================================================
// MOMENTS - Seasonal/Event-based product discovery
// ============================================================
/**
 * Get currently active moments based on date
 */
exports.getActiveMoments = functions.https.onCall(async (data, context) => {
    try {
        const today = new Date();
        const monthDay = `${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
        const momentsSnapshot = await db.collection('moments')
            .where('isActive', '==', true)
            .orderBy('priority', 'asc')
            .get();
        const activeMoments = [];
        momentsSnapshot.docs.forEach(doc => {
            const moment = doc.data();
            const { start, end } = moment.dateRange;
            // Handle year wrap (e.g., 12-20 to 01-07)
            let isActive = false;
            if (start <= end) {
                // Normal range within same year
                isActive = monthDay >= start && monthDay <= end;
            }
            else {
                // Wraps around year end
                isActive = monthDay >= start || monthDay <= end;
            }
            if (isActive) {
                activeMoments.push({
                    id: moment.id,
                    name: moment.name,
                    emoji: moment.emoji,
                    priority: moment.priority,
                });
            }
        });
        return { moments: activeMoments };
    }
    catch (error) {
        console.error('Error getting active moments:', error);
        throw new functions.https.HttpsError('internal', 'Failed to get active moments: ' + error.message);
    }
});
/**
 * Get products matching a specific moment using vector similarity
 */
exports.getMomentProducts = functions.https.onCall(async (data, context) => {
    var _a, _b;
    try {
        const { momentId, limit: limitParam = 20, minScore = 0.5 } = data;
        if (!momentId) {
            throw new functions.https.HttpsError('invalid-argument', 'momentId is required');
        }
        // 1. Get moment embedding
        const momentDoc = await db.collection('moments').doc(momentId).get();
        if (!momentDoc.exists) {
            throw new functions.https.HttpsError('not-found', 'Moment not found');
        }
        const momentData = momentDoc.data();
        const momentEmbedding = momentData.embedding;
        if (!momentEmbedding || momentEmbedding.length === 0) {
            throw new functions.https.HttpsError('internal', 'Moment has no embedding');
        }
        // 2. Get all active article embeddings
        const embeddingsSnapshot = await db.collection('embeddings')
            .where('isActive', '==', true)
            .where('isSold', '==', false)
            .limit(500)
            .get();
        if (embeddingsSnapshot.empty) {
            return {
                results: [],
                moment: {
                    id: momentData.id,
                    name: momentData.name,
                    emoji: momentData.emoji
                }
            };
        }
        // 3. Compute similarities
        const similarities = [];
        embeddingsSnapshot.docs.forEach(doc => {
            const docEmbedding = doc.data().embedding;
            if (docEmbedding && docEmbedding.length === momentEmbedding.length) {
                const score = computeCosineSimilarity(momentEmbedding, docEmbedding);
                if (score >= minScore) {
                    similarities.push({ articleId: doc.id, score });
                }
            }
        });
        // 4. Sort by similarity and take top N
        similarities.sort((a, b) => b.score - a.score);
        const topMatches = similarities.slice(0, Math.min(limitParam, 50));
        // 5. Batch fetch article details
        const results = [];
        for (const match of topMatches) {
            const articleDoc = await db.collection('articles').doc(match.articleId).get();
            if (articleDoc.exists) {
                const article = articleDoc.data();
                results.push({
                    articleId: match.articleId,
                    similarity: Math.round(match.score * 100),
                    title: article.title,
                    price: article.price,
                    imageUrl: (_b = (_a = article.images) === null || _a === void 0 ? void 0 : _a[0]) === null || _b === void 0 ? void 0 : _b.url,
                    brand: article.brand || null,
                    condition: article.condition,
                });
            }
        }
        return {
            results,
            moment: {
                id: momentData.id,
                name: momentData.name,
                emoji: momentData.emoji,
            },
        };
    }
    catch (error) {
        console.error('Error getting moment products:', error);
        if (error instanceof functions.https.HttpsError) {
            throw error;
        }
        throw new functions.https.HttpsError('internal', 'Failed to get moment products: ' + error.message);
    }
});
// ============================================================
// SWAP ZONE - Swap Parties & Trading
// ============================================================
/**
 * Scheduled function: Update swap party statuses automatically
 * Runs every 5 minutes to transition parties: upcoming -> active -> ended
 */
exports.updateSwapPartyStatuses = functions.pubsub
    .schedule('every 5 minutes')
    .onRun(async (context) => {
    var _a, _b;
    console.log('Checking swap party statuses...');
    const now = new Date();
    try {
        // Get all non-ended parties
        const partiesSnapshot = await db.collection('swapParties')
            .where('status', 'in', ['upcoming', 'active'])
            .get();
        let updatedCount = 0;
        for (const partyDoc of partiesSnapshot.docs) {
            const party = partyDoc.data();
            const startDate = (_a = party.startDate) === null || _a === void 0 ? void 0 : _a.toDate();
            const endDate = (_b = party.endDate) === null || _b === void 0 ? void 0 : _b.toDate();
            let newStatus = null;
            if (party.status === 'upcoming' && startDate && now >= startDate) {
                newStatus = 'active';
            }
            else if (party.status === 'active' && endDate && now >= endDate) {
                newStatus = 'ended';
            }
            if (newStatus) {
                await db.collection('swapParties').doc(partyDoc.id).update({
                    status: newStatus,
                    updatedAt: firestore_1.FieldValue.serverTimestamp(),
                });
                updatedCount++;
                console.log(`Updated party ${partyDoc.id} status to ${newStatus}`);
            }
        }
        console.log(`Swap party status check complete. Updated ${updatedCount} parties.`);
        return null;
    }
    catch (error) {
        console.error('Error updating swap party statuses:', error);
        return null;
    }
});
/**
 * Trigger: Send notification when a swap is proposed
 */
exports.onSwapCreated = functions.firestore
    .document('swaps/{swapId}')
    .onCreate(async (snapshot, context) => {
    var _a;
    try {
        const swap = snapshot.data();
        const swapId = context.params.swapId;
        if (!swap.receiverId) {
            console.log('No receiver for swap notification');
            return;
        }
        // Get receiver's FCM tokens
        const receiverDoc = await db.collection('users').doc(swap.receiverId).get();
        if (!receiverDoc.exists) {
            console.log(`Receiver user ${swap.receiverId} not found`);
            return;
        }
        const receiverData = receiverDoc.data();
        const fcmTokens = receiverData.fcmTokens || [];
        if (fcmTokens.length === 0) {
            console.log(`No FCM tokens for user ${swap.receiverId}`);
            return;
        }
        // Build notification
        const title = '🔄 Nouvelle proposition d\'échange';
        const body = `${swap.initiatorName} te propose un échange pour "${(_a = swap.receiverItem) === null || _a === void 0 ? void 0 : _a.title}"`;
        const messages = fcmTokens.map((token) => ({
            token,
            notification: {
                title,
                body,
            },
            data: {
                type: 'swap_proposed',
                swapId,
                initiatorId: swap.initiatorId,
                initiatorName: swap.initiatorName,
            },
            android: {
                priority: 'high',
                notification: {
                    sound: 'default',
                    channelId: 'swaps',
                    priority: 'high',
                },
            },
            apns: {
                payload: {
                    aps: {
                        sound: 'default',
                        badge: 1,
                    },
                },
            },
        }));
        const results = await admin.messaging().sendEach(messages);
        let successCount = 0;
        results.responses.forEach((response, index) => {
            var _a, _b;
            if (response.success) {
                successCount++;
            }
            else {
                console.error(`Failed to send swap notification:`, response.error);
                // Remove invalid tokens
                if (((_a = response.error) === null || _a === void 0 ? void 0 : _a.code) === 'messaging/invalid-registration-token' ||
                    ((_b = response.error) === null || _b === void 0 ? void 0 : _b.code) === 'messaging/registration-token-not-registered') {
                    db.collection('users')
                        .doc(swap.receiverId)
                        .update({
                        fcmTokens: admin.firestore.FieldValue.arrayRemove(fcmTokens[index]),
                    })
                        .catch((err) => console.error('Error removing invalid token:', err));
                }
            }
        });
        console.log(`Swap proposal notification sent: ${successCount} successful`);
    }
    catch (error) {
        console.error('Error sending swap proposal notification:', error);
    }
});
/**
 * Trigger: Send notification when swap status changes
 */
exports.onSwapStatusUpdated = functions.firestore
    .document('swaps/{swapId}')
    .onUpdate(async (change, context) => {
    try {
        const before = change.before.data();
        const after = change.after.data();
        const swapId = context.params.swapId;
        // Only process if status changed
        if (before.status === after.status) {
            return;
        }
        const newStatus = after.status;
        let targetUserId;
        let title;
        let body;
        switch (newStatus) {
            case 'accepted':
                targetUserId = after.initiatorId;
                title = '✅ Échange accepté !';
                body = `${after.receiverName} a accepté ton échange`;
                break;
            case 'declined':
                targetUserId = after.initiatorId;
                title = '❌ Échange refusé';
                body = `${after.receiverName} a refusé ton échange`;
                break;
            case 'cancelled':
                targetUserId = after.receiverId;
                title = '🚫 Échange annulé';
                body = `${after.initiatorName} a annulé l'échange`;
                break;
            case 'photos_pending':
                // Notify both parties
                await sendSwapNotification(after.initiatorId, swapId, '📸 Photos requises', 'N\'oublie pas d\'envoyer les photos de ton article', after);
                await sendSwapNotification(after.receiverId, swapId, '📸 Photos requises', 'N\'oublie pas d\'envoyer les photos de ton article', after);
                return;
            case 'shipping':
                // Notify both parties
                await sendSwapNotification(after.initiatorId, swapId, '📦 Prêt à expédier', 'Les photos sont validées, tu peux envoyer ton article', after);
                await sendSwapNotification(after.receiverId, swapId, '📦 Prêt à expédier', 'Les photos sont validées, tu peux envoyer ton article', after);
                return;
            case 'completed':
                // Notify both parties
                await sendSwapNotification(after.initiatorId, swapId, '🎉 Échange terminé !', 'L\'échange est complet. N\'oublie pas de laisser une note.', after);
                await sendSwapNotification(after.receiverId, swapId, '🎉 Échange terminé !', 'L\'échange est complet. N\'oublie pas de laisser une note.', after);
                return;
            default:
                return;
        }
        await sendSwapNotification(targetUserId, swapId, title, body, after);
    }
    catch (error) {
        console.error('Error sending swap status notification:', error);
    }
});
/**
 * Helper: Send swap notification to a user
 */
async function sendSwapNotification(userId, swapId, title, body, swapData) {
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists)
        return;
    const userData = userDoc.data();
    const fcmTokens = userData.fcmTokens || [];
    if (fcmTokens.length === 0)
        return;
    const messages = fcmTokens.map((token) => ({
        token,
        notification: {
            title,
            body,
        },
        data: {
            type: 'swap_update',
            swapId,
            status: swapData.status,
        },
        android: {
            priority: 'high',
            notification: {
                sound: 'default',
                channelId: 'swaps',
                priority: 'high',
            },
        },
        apns: {
            payload: {
                aps: {
                    sound: 'default',
                    badge: 1,
                },
            },
        },
    }));
    try {
        await admin.messaging().sendEach(messages);
    }
    catch (error) {
        console.error(`Failed to send swap notification to ${userId}:`, error);
    }
}
/**
 * Get active swap party info for homepage
 */
exports.getActiveSwapPartyInfo = functions.https.onCall(async (data, context) => {
    var _a, _b, _c;
    try {
        // Get currently active party
        const activeSnapshot = await db.collection('swapParties')
            .where('status', '==', 'active')
            .limit(1)
            .get();
        if (!activeSnapshot.empty) {
            const party = activeSnapshot.docs[0];
            const partyData = party.data();
            return {
                hasActiveParty: true,
                party: {
                    id: party.id,
                    name: partyData.name,
                    emoji: partyData.emoji,
                    description: partyData.description,
                    theme: partyData.theme,
                    isGeneralist: partyData.isGeneralist,
                    endDate: (_a = partyData.endDate) === null || _a === void 0 ? void 0 : _a.toDate().toISOString(),
                    participantsCount: partyData.participantsCount || 0,
                    itemsCount: partyData.itemsCount || 0,
                    swapsCount: partyData.swapsCount || 0,
                },
                nextParty: null,
            };
        }
        // No active party, get next upcoming
        const upcomingSnapshot = await db.collection('swapParties')
            .where('status', '==', 'upcoming')
            .orderBy('startDate', 'asc')
            .limit(1)
            .get();
        if (!upcomingSnapshot.empty) {
            const party = upcomingSnapshot.docs[0];
            const partyData = party.data();
            return {
                hasActiveParty: false,
                party: null,
                nextParty: {
                    id: party.id,
                    name: partyData.name,
                    emoji: partyData.emoji,
                    description: partyData.description,
                    theme: partyData.theme,
                    isGeneralist: partyData.isGeneralist,
                    startDate: (_b = partyData.startDate) === null || _b === void 0 ? void 0 : _b.toDate().toISOString(),
                    endDate: (_c = partyData.endDate) === null || _c === void 0 ? void 0 : _c.toDate().toISOString(),
                },
            };
        }
        return {
            hasActiveParty: false,
            party: null,
            nextParty: null,
        };
    }
    catch (error) {
        console.error('Error getting active swap party info:', error);
        throw new functions.https.HttpsError('internal', 'Failed to get swap party info: ' + error.message);
    }
});
/**
 * Get swap party leaderboard (top swappers)
 */
exports.getSwapPartyLeaderboard = functions.https.onCall(async (data, context) => {
    const { partyId, limit: limitParam = 10 } = data;
    if (!partyId) {
        throw new functions.https.HttpsError('invalid-argument', 'partyId is required');
    }
    try {
        // Get all completed swaps for this party
        const swapsSnapshot = await db.collection('swaps')
            .where('partyId', '==', partyId)
            .where('status', '==', 'completed')
            .get();
        // Count swaps per user
        const userSwapCounts = {};
        swapsSnapshot.docs.forEach(doc => {
            const swap = doc.data();
            // Count initiator
            if (!userSwapCounts[swap.initiatorId]) {
                userSwapCounts[swap.initiatorId] = {
                    count: 0,
                    name: swap.initiatorName,
                    image: swap.initiatorImage,
                };
            }
            userSwapCounts[swap.initiatorId].count++;
            // Count receiver
            if (!userSwapCounts[swap.receiverId]) {
                userSwapCounts[swap.receiverId] = {
                    count: 0,
                    name: swap.receiverName,
                    image: swap.receiverImage,
                };
            }
            userSwapCounts[swap.receiverId].count++;
        });
        // Sort by count and take top N
        const leaderboard = Object.entries(userSwapCounts)
            .map(([userId, data]) => (Object.assign({ userId }, data)))
            .sort((a, b) => b.count - a.count)
            .slice(0, limitParam);
        return { leaderboard };
    }
    catch (error) {
        console.error('Error getting swap party leaderboard:', error);
        throw new functions.https.HttpsError('internal', 'Failed to get leaderboard: ' + error.message);
    }
});
/**
 * Default profile when Gemini fails or insufficient data
 */
const DEFAULT_STYLE_PROFILE = {
    styleTags: [],
    styleDescription: '',
    recommendedBrands: [],
    suggestedSizes: { top: '', bottom: '' },
    confidence: 0,
};
/**
 * Structured prompt for style profile generation
 */
const STYLE_PROFILE_PROMPT = `Tu es un expert en mode et style vestimentaire.
Analyse les articles likés et les recherches de l'utilisateur ci-dessous.
Génère un profil style en JSON valide UNIQUEMENT (pas de texte avant ou après):
{
  "styleTags": ["tag1", "tag2", "tag3"],
  "styleDescription": "Description courte du style en français (1-2 phrases)",
  "recommendedBrands": ["marque1", "marque2", "marque3"],
  "suggestedSizes": {"top": "M", "bottom": "L"},
  "confidence": 0.85
}

Règles:
- styleTags: 2-4 tags de style (ex: "Streetwear", "Vintage", "Casual", "Sportswear", "Bohème", "Minimaliste")
- styleDescription: Description naturelle en français du style détecté
- recommendedBrands: 3-5 marques cohérentes avec le style
- suggestedSizes: Tailles les plus probables basées sur les articles vus
- confidence: Score entre 0 et 1 basé sur la quantité/cohérence des données

RÉPONDS UNIQUEMENT AVEC LE JSON, SANS AUCUN TEXTE SUPPLÉMENTAIRE.`;
/**
 * Generate style profile from user behavior using Gemini
 * Called after signup when guest data is merged
 */
exports.generateStyleProfile = functions
    .runWith({ secrets: ['GEMINI_API_KEY'], timeoutSeconds: 30 })
    .https.onCall(async (data, context) => {
    // Verify authentication
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    }
    const userId = context.auth.uid;
    const { likedArticles = [], viewedArticles = [], searches = [] } = data;
    // Check if we have enough data
    const totalInteractions = likedArticles.length + viewedArticles.length + searches.length;
    if (totalInteractions < 5) {
        console.log(`Insufficient data for style profile: ${totalInteractions} interactions`);
        // Store default profile and return
        await db.collection('users').doc(userId).set({ styleProfile: Object.assign(Object.assign({}, DEFAULT_STYLE_PROFILE), { generatedAt: firestore_1.FieldValue.serverTimestamp() }) }, { merge: true });
        return { success: true, profile: DEFAULT_STYLE_PROFILE };
    }
    // Get Gemini client (new @google/genai SDK)
    const ai = getGenAI();
    if (!ai) {
        console.error('Gemini API not configured, using default profile');
        await db.collection('users').doc(userId).set({ styleProfile: Object.assign(Object.assign({}, DEFAULT_STYLE_PROFILE), { generatedAt: firestore_1.FieldValue.serverTimestamp() }) }, { merge: true });
        return { success: true, profile: DEFAULT_STYLE_PROFILE };
    }
    try {
        // Build context for Gemini
        const likedContext = likedArticles.map((a) => `- ${a.category || 'Article'}: ${a.brand || 'Sans marque'}, taille ${a.size || 'NC'}, ${a.price}€`).join('\n');
        const viewedContext = viewedArticles.slice(0, 20).map((a) => `- ${a.category || 'Article'}: ${a.brand || 'Sans marque'}, taille ${a.size || 'NC'}`).join('\n');
        const searchContext = searches.slice(0, 10).join(', ');
        const userDataPrompt = `
ARTICLES LIKÉS (${likedArticles.length}):
${likedContext || 'Aucun'}

ARTICLES VUS (${Math.min(viewedArticles.length, 20)} sur ${viewedArticles.length}):
${viewedContext || 'Aucun'}

RECHERCHES RÉCENTES:
${searchContext || 'Aucune'}
`;
        const result = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: STYLE_PROFILE_PROMPT + '\n\n' + userDataPrompt,
        });
        const responseText = result.text || '';
        // Parse JSON response
        let profile;
        try {
            // Clean response (remove potential markdown code blocks)
            const cleanedResponse = responseText
                .replace(/```json\n?/g, '')
                .replace(/```\n?/g, '')
                .trim();
            profile = JSON.parse(cleanedResponse);
            // Validate structure
            if (!profile.styleTags || !Array.isArray(profile.styleTags)) {
                throw new Error('Invalid styleTags');
            }
            if (typeof profile.styleDescription !== 'string') {
                throw new Error('Invalid styleDescription');
            }
            if (!profile.recommendedBrands || !Array.isArray(profile.recommendedBrands)) {
                profile.recommendedBrands = [];
            }
            if (!profile.suggestedSizes || typeof profile.suggestedSizes !== 'object') {
                profile.suggestedSizes = { top: '', bottom: '' };
            }
            if (typeof profile.confidence !== 'number') {
                profile.confidence = 0.5;
            }
        }
        catch (parseError) {
            console.error('Failed to parse Gemini response:', parseError, responseText);
            profile = DEFAULT_STYLE_PROFILE;
        }
        // Store profile in Firestore
        await db.collection('users').doc(userId).set({ styleProfile: Object.assign(Object.assign({}, profile), { generatedAt: firestore_1.FieldValue.serverTimestamp() }) }, { merge: true });
        console.log(`Generated style profile for user ${userId}:`, profile.styleTags);
        return { success: true, profile };
    }
    catch (error) {
        console.error('Error generating style profile:', error);
        // Store default profile on error
        await db.collection('users').doc(userId).set({ styleProfile: Object.assign(Object.assign({}, DEFAULT_STYLE_PROFILE), { generatedAt: firestore_1.FieldValue.serverTimestamp() }) }, { merge: true });
        return { success: true, profile: DEFAULT_STYLE_PROFILE };
    }
});
// ========== NOTIFICATION SYSTEM ==========
/**
 * Helper function to send FCM notifications and create in-app notifications
 */
async function sendPushNotification(userId, title, body, data, notificationType) {
    var _a;
    try {
        // Get user's FCM tokens
        const userDoc = await db.collection('users').doc(userId).get();
        if (!userDoc.exists) {
            console.log(`User ${userId} not found`);
            return { success: false, sentCount: 0 };
        }
        const userData = userDoc.data();
        const fcmTokens = userData.fcmTokens || [];
        // Check notification preferences
        const prefs = (_a = userData.preferences) === null || _a === void 0 ? void 0 : _a.notifications;
        if ((prefs === null || prefs === void 0 ? void 0 : prefs.push) === false) {
            console.log(`User ${userId} has push notifications disabled`);
            // Still create in-app notification
            await createInAppNotification(userId, notificationType, title, body, data);
            return { success: true, sentCount: 0 };
        }
        // Create in-app notification regardless of push
        await createInAppNotification(userId, notificationType, title, body, data);
        if (fcmTokens.length === 0) {
            console.log(`No FCM tokens for user ${userId}`);
            return { success: true, sentCount: 0 };
        }
        // Build FCM messages
        const messages = fcmTokens.map((token) => ({
            token,
            notification: { title, body },
            data: Object.assign(Object.assign({}, data), { type: notificationType }),
            android: {
                priority: 'high',
                notification: {
                    sound: 'default',
                    channelId: 'notifications',
                    priority: 'high',
                },
            },
            apns: {
                payload: {
                    aps: {
                        sound: 'default',
                        badge: 1,
                    },
                },
            },
        }));
        // Send notifications
        const results = await admin.messaging().sendEach(messages);
        let successCount = 0;
        results.responses.forEach((response, index) => {
            var _a, _b;
            if (response.success) {
                successCount++;
            }
            else {
                console.error(`Failed to send to token ${index}:`, response.error);
                // Remove invalid tokens
                if (((_a = response.error) === null || _a === void 0 ? void 0 : _a.code) === 'messaging/invalid-registration-token' ||
                    ((_b = response.error) === null || _b === void 0 ? void 0 : _b.code) === 'messaging/registration-token-not-registered') {
                    db.collection('users')
                        .doc(userId)
                        .update({
                        fcmTokens: admin.firestore.FieldValue.arrayRemove(fcmTokens[index]),
                    })
                        .catch((err) => console.error('Error removing invalid token:', err));
                }
            }
        });
        return { success: true, sentCount: successCount };
    }
    catch (error) {
        console.error('Error sending push notification:', error);
        return { success: false, sentCount: 0 };
    }
}
/**
 * Helper function to create in-app notification in Firestore
 */
async function createInAppNotification(userId, type, title, message, data) {
    const notificationData = {
        userId,
        type,
        title,
        message,
        data,
        isRead: false,
        createdAt: firestore_1.FieldValue.serverTimestamp(),
    };
    const docRef = await db.collection('notifications').add(notificationData);
    await docRef.update({ id: docRef.id });
    return docRef.id;
}
/**
 * Trigger: When someone adds an article to favorites, notify the seller
 */
exports.onArticleFavorited = functions.firestore
    .document('favorites/{userId}')
    .onUpdate(async (change, context) => {
    var _a, _b, _c;
    try {
        const beforeData = change.before.data();
        const afterData = change.after.data();
        const beforeIds = (beforeData === null || beforeData === void 0 ? void 0 : beforeData.articleIds) || [];
        const afterIds = (afterData === null || afterData === void 0 ? void 0 : afterData.articleIds) || [];
        // Find newly added article IDs
        const newFavoriteIds = afterIds.filter(id => !beforeIds.includes(id));
        if (newFavoriteIds.length === 0) {
            return; // No new favorites added
        }
        const buyerUserId = context.params.userId;
        // Get buyer info
        const buyerDoc = await db.collection('users').doc(buyerUserId).get();
        const buyerName = buyerDoc.exists
            ? ((_a = buyerDoc.data()) === null || _a === void 0 ? void 0 : _a.displayName) || 'Quelqu\'un'
            : 'Quelqu\'un';
        // Process each new favorite
        for (const articleId of newFavoriteIds) {
            // Get article info
            const articleDoc = await db.collection('articles').doc(articleId).get();
            if (!articleDoc.exists)
                continue;
            const articleData = articleDoc.data();
            const sellerId = articleData.sellerId;
            // Don't notify if seller is the one who favorited
            if (sellerId === buyerUserId)
                continue;
            // Check seller's notification preferences
            const sellerDoc = await db.collection('users').doc(sellerId).get();
            if (sellerDoc.exists) {
                const sellerPrefs = (_c = (_b = sellerDoc.data()) === null || _b === void 0 ? void 0 : _b.preferences) === null || _c === void 0 ? void 0 : _c.notifications;
                if ((sellerPrefs === null || sellerPrefs === void 0 ? void 0 : sellerPrefs.articleFavorited) === false) {
                    console.log(`Seller ${sellerId} has article_favorited notifications disabled`);
                    continue;
                }
            }
            // Send notification to seller
            await sendPushNotification(sellerId, '❤️ Nouvel intérêt pour votre article', `${buyerName} a ajouté "${articleData.title}" à ses favoris`, {
                articleId,
                articleTitle: articleData.title,
                userName: buyerName,
            }, 'article_favorited');
            console.log(`Notified seller ${sellerId} about favorite on article ${articleId}`);
        }
    }
    catch (error) {
        console.error('Error in onArticleFavorited:', error);
    }
});
/**
 * Trigger: When an article's price drops, notify users who have it in favorites
 */
exports.onArticlePriceDropped = functions.firestore
    .document('articles/{articleId}')
    .onUpdate(async (change, context) => {
    try {
        const beforeData = change.before.data();
        const afterData = change.after.data();
        const oldPrice = beforeData === null || beforeData === void 0 ? void 0 : beforeData.price;
        const newPrice = afterData === null || afterData === void 0 ? void 0 : afterData.price;
        // Only trigger if price decreased
        if (!oldPrice || !newPrice || newPrice >= oldPrice) {
            return;
        }
        const articleId = context.params.articleId;
        const articleTitle = (afterData === null || afterData === void 0 ? void 0 : afterData.title) || 'Article';
        const discount = Math.round(((oldPrice - newPrice) / oldPrice) * 100);
        console.log(`Price dropped on ${articleId}: ${oldPrice}€ → ${newPrice}€ (-${discount}%)`);
        // Find all users who have this article in favorites
        const favoritesSnapshot = await db.collection('favorites')
            .where('articleIds', 'array-contains', articleId)
            .get();
        if (favoritesSnapshot.empty) {
            console.log('No users have this article in favorites');
            return;
        }
        // Send notifications to all users (in batches to avoid overload)
        const userIds = favoritesSnapshot.docs.map(doc => doc.id);
        console.log(`Notifying ${userIds.length} users about price drop`);
        // Process in batches of 10
        const batchSize = 10;
        for (let i = 0; i < userIds.length; i += batchSize) {
            const batch = userIds.slice(i, i + batchSize);
            await Promise.all(batch.map(async (userId) => {
                var _a, _b;
                // Don't notify the seller
                if (userId === (afterData === null || afterData === void 0 ? void 0 : afterData.sellerId))
                    return;
                // Check user's notification preferences
                const userDoc = await db.collection('users').doc(userId).get();
                if (userDoc.exists) {
                    const userPrefs = (_b = (_a = userDoc.data()) === null || _a === void 0 ? void 0 : _a.preferences) === null || _b === void 0 ? void 0 : _b.notifications;
                    if ((userPrefs === null || userPrefs === void 0 ? void 0 : userPrefs.priceDrops) === false) {
                        console.log(`User ${userId} has price drop notifications disabled`);
                        return;
                    }
                }
                await sendPushNotification(userId, '💰 Baisse de prix !', `"${articleTitle}" est passé de ${oldPrice}€ à ${newPrice}€ (-${discount}%)`, {
                    articleId,
                    articleTitle,
                    oldPrice: oldPrice.toString(),
                    newPrice: newPrice.toString(),
                }, 'price_drop');
            }));
        }
        console.log(`Price drop notifications sent for article ${articleId}`);
    }
    catch (error) {
        console.error('Error in onArticlePriceDropped:', error);
    }
});
/**
 * Scheduled function: Send swap zone reminders 3 days before start
 * Runs daily at 10:00 AM UTC
 */
exports.sendSwapZoneReminders = functions.pubsub
    .schedule('0 10 * * *')
    .timeZone('Europe/Paris')
    .onRun(async (context) => {
    try {
        // Calculate the target date (3 days from now)
        const now = new Date();
        const targetDate = new Date(now);
        targetDate.setDate(targetDate.getDate() + 3);
        // Set to start of day
        const startOfDay = new Date(targetDate);
        startOfDay.setHours(0, 0, 0, 0);
        // Set to end of day
        const endOfDay = new Date(targetDate);
        endOfDay.setHours(23, 59, 59, 999);
        console.log(`Looking for swap parties starting between ${startOfDay.toISOString()} and ${endOfDay.toISOString()}`);
        // Find swap parties starting in 3 days
        const partiesSnapshot = await db.collection('swapParties')
            .where('startDate', '>=', startOfDay)
            .where('startDate', '<=', endOfDay)
            .where('status', '==', 'upcoming')
            .get();
        if (partiesSnapshot.empty) {
            console.log('No swap parties starting in 3 days');
            return null;
        }
        console.log(`Found ${partiesSnapshot.docs.length} swap parties to notify about`);
        // Process each party
        for (const partyDoc of partiesSnapshot.docs) {
            const partyData = partyDoc.data();
            const partyId = partyDoc.id;
            const partyName = partyData.name || 'Swap Zone';
            // Get all participants
            const participantsSnapshot = await db.collection('swapPartyParticipants')
                .where('partyId', '==', partyId)
                .get();
            if (participantsSnapshot.empty) {
                console.log(`No participants for party ${partyId}`);
                continue;
            }
            const userIds = participantsSnapshot.docs.map(doc => doc.data().userId);
            console.log(`Notifying ${userIds.length} participants for party ${partyName}`);
            // Send notifications to all participants
            await Promise.all(userIds.map(async (userId) => {
                var _a, _b;
                // Check user's notification preferences
                const userDoc = await db.collection('users').doc(userId).get();
                if (userDoc.exists) {
                    const userPrefs = (_b = (_a = userDoc.data()) === null || _a === void 0 ? void 0 : _a.preferences) === null || _b === void 0 ? void 0 : _b.notifications;
                    if ((userPrefs === null || userPrefs === void 0 ? void 0 : userPrefs.swapZoneReminder) === false) {
                        console.log(`User ${userId} has swap zone reminder notifications disabled`);
                        return;
                    }
                }
                await sendPushNotification(userId, '📦 Swap Zone dans 3 jours !', `N'oubliez pas d'ajouter vos articles à "${partyName}"`, {
                    partyId,
                    partyName,
                    daysUntil: '3',
                }, 'swap_zone_reminder');
            }));
            console.log(`Sent reminders for party ${partyName}`);
        }
        return null;
    }
    catch (error) {
        console.error('Error in sendSwapZoneReminders:', error);
        return null;
    }
});
//# sourceMappingURL=index.old.js.map