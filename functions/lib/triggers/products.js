"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateUserStats = exports.updateSearchIndex = void 0;
/**
 * Product Firestore triggers
 * Firebase Functions v7 - using onDocumentWritten
 */
const firestore_1 = require("firebase-functions/v2/firestore");
const firebase_1 = require("../config/firebase");
const geohash_1 = require("../utils/geohash");
const search_1 = require("../utils/search");
const debounce_1 = require("../utils/debounce");
/**
 * Update search index when product is created/updated/deleted
 */
exports.updateSearchIndex = (0, firestore_1.onDocumentWritten)({ document: 'products/{productId}', memory: '512MiB' }, async (event) => {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j;
    const productId = event.params.productId;
    try {
        // If document was deleted, remove from search index
        if (!((_b = (_a = event.data) === null || _a === void 0 ? void 0 : _a.after) === null || _b === void 0 ? void 0 : _b.exists)) {
            await firebase_1.db.collection('search_index').doc(productId).delete();
            console.log(`Removed product ${productId} from search index`);
            return;
        }
        const productData = event.data.after.data();
        if (!productData)
            return;
        // Only index active, approved products
        if (!productData.isActive || productData.moderationStatus !== 'approved') {
            await firebase_1.db.collection('search_index').doc(productId).delete();
            return;
        }
        // Generate geohash for location
        let geohash = '';
        if ((_c = productData.location) === null || _c === void 0 ? void 0 : _c.coordinates) {
            const { lat, lon } = productData.location.coordinates;
            geohash = (0, geohash_1.encodeGeohash)(lat, lon, 7);
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
        // Generate search keywords
        const brandsText = brands.join(' ');
        const searchText = `${productData.title} ${productData.description} ${brandsText} ${productData.category || ''}`;
        const keywords = (0, search_1.generateSearchKeywords)(searchText);
        // Calculate popularity score
        const popularityScore = (0, search_1.calculatePopularityScore)(productData.views || 0, productData.likes || 0, ((_d = productData.createdAt) === null || _d === void 0 ? void 0 : _d.toDate()) || new Date());
        // Create search index document
        const searchIndexData = {
            productId,
            title: productData.title,
            titleLowercase: productData.title.toLowerCase(),
            description: productData.description,
            keywords,
            // Filterable fields
            category: productData.category,
            subcategory: productData.subcategory || null,
            brands: brands,
            colors: colors,
            materials: materials,
            brand: brands[0] || null,
            color: colors[0] || null,
            material: materials[0] || null,
            size: productData.size || null,
            condition: productData.condition,
            price: productData.price,
            // Location data
            location: {
                city: ((_e = productData.location) === null || _e === void 0 ? void 0 : _e.city) || '',
                geohash,
                coordinates: ((_f = productData.location) === null || _f === void 0 ? void 0 : _f.coordinates) || null,
            },
            // Cached display data
            sellerId: productData.sellerId,
            sellerName: productData.sellerName,
            sellerRating: productData.sellerRating || null,
            firstImage: ((_h = (_g = productData.images) === null || _g === void 0 ? void 0 : _g[0]) === null || _h === void 0 ? void 0 : _h.url) || null,
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
            lastIndexed: firebase_1.FieldValue.serverTimestamp(),
        };
        // Update search index with debouncing
        const updateKey = `search_index_${productId}`;
        (0, debounce_1.debounceUpdate)(updateKey, async () => {
            await firebase_1.db
                .collection('search_index')
                .doc(productId)
                .set(searchIndexData, { merge: true });
            console.log(`Updated search index for product ${productId}`);
        });
        // Update product with geohash if not present
        if (geohash && !((_j = productData.location) === null || _j === void 0 ? void 0 : _j.geohash)) {
            const geoKey = `product_geohash_${productId}`;
            (0, debounce_1.debounceUpdate)(geoKey, async () => {
                await firebase_1.db.collection('products').doc(productId).update({
                    'location.geohash': geohash,
                });
                console.log(`Added geohash to product ${productId}`);
            });
        }
    }
    catch (error) {
        console.error(`Error updating search index for product ${productId}:`, error);
    }
});
/**
 * Update user stats when product is created/updated/sold
 */
exports.updateUserStats = (0, firestore_1.onDocumentWritten)({ document: 'products/{productId}', memory: '512MiB' }, async (event) => {
    var _a, _b;
    const productId = event.params.productId;
    try {
        const after = ((_b = (_a = event.data) === null || _a === void 0 ? void 0 : _a.after) === null || _b === void 0 ? void 0 : _b.exists) ? event.data.after.data() : null;
        if (!after)
            return; // Document deleted
        const sellerId = after.sellerId;
        if (!sellerId)
            return;
        // Debounce user stats update
        const updateKey = `user_stats_${sellerId}`;
        (0, debounce_1.debounceUpdate)(updateKey, async () => {
            const userStatsRef = firebase_1.db.collection('stats').doc(`user_${sellerId}`);
            // Get current user products
            const userProductsSnapshot = await firebase_1.db
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
            userProductsSnapshot.forEach((doc) => {
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
                updatedAt: firebase_1.FieldValue.serverTimestamp(),
            }, { merge: true });
            console.log(`Updated stats for user ${sellerId}`);
        }, 10000); // 10 second debounce
    }
    catch (error) {
        console.error(`Error updating user stats for product ${productId}:`, error);
    }
});
//# sourceMappingURL=products.js.map