/**
 * Product Firestore triggers
 * Firebase Functions v7 - using onDocumentWritten
 */
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { db, FieldValue } from '../config/firebase';
import { encodeGeohash } from '../utils/geohash';
import {
  generateSearchKeywords,
  calculatePopularityScore,
} from '../utils/search';
import { debounceUpdate } from '../utils/debounce';

/**
 * Update search index when product is created/updated/deleted
 */
export const updateSearchIndex = onDocumentWritten(
  { document: 'products/{productId}', memory: '512MiB' },
  async (event) => {
    const productId = event.params.productId;

    try {
      // If document was deleted, remove from search index
      if (!event.data?.after?.exists) {
        await db.collection('search_index').doc(productId).delete();
        console.log(`Removed product ${productId} from search index`);
        return;
      }

      const productData = event.data.after.data();
      if (!productData) return;

      // Only index active, approved products
      if (!productData.isActive || productData.moderationStatus !== 'approved') {
        await db.collection('search_index').doc(productId).delete();
        return;
      }

      // Generate geohash for location
      let geohash = '';
      if (productData.location?.coordinates) {
        const { lat, lon } = productData.location.coordinates;
        geohash = encodeGeohash(lat, lon, 7);
      }

      // Normalize array fields (support both singular and array formats)
      const getBrands = (): string[] => {
        if (productData.brands && Array.isArray(productData.brands))
          return productData.brands;
        if (productData.brand) return [productData.brand];
        return [];
      };
      const getColors = (): string[] => {
        if (productData.colors && Array.isArray(productData.colors))
          return productData.colors;
        if (productData.color) return [productData.color];
        return [];
      };
      const getMaterials = (): string[] => {
        if (productData.materials && Array.isArray(productData.materials))
          return productData.materials;
        if (productData.material) return [productData.material];
        return [];
      };

      const brands = getBrands();
      const colors = getColors();
      const materials = getMaterials();

      // Generate search keywords
      const brandsText = brands.join(' ');
      const searchText = `${productData.title} ${productData.description} ${brandsText} ${productData.category || ''}`;
      const keywords = generateSearchKeywords(searchText);

      // Calculate popularity score
      const popularityScore = calculatePopularityScore(
        productData.views || 0,
        productData.likes || 0,
        productData.createdAt?.toDate() || new Date()
      );

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
          city: productData.location?.city || '',
          geohash,
          coordinates: productData.location?.coordinates || null,
        },

        // Cached display data
        sellerId: productData.sellerId,
        sellerName: productData.sellerName,
        sellerRating: productData.sellerRating || null,
        firstImage: productData.images?.[0]?.url || null,

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
        lastIndexed: FieldValue.serverTimestamp(),
      };

      // Update search index with debouncing
      const updateKey = `search_index_${productId}`;
      debounceUpdate(updateKey, async () => {
        await db
          .collection('search_index')
          .doc(productId)
          .set(searchIndexData, { merge: true });
        console.log(`Updated search index for product ${productId}`);
      });

      // Update product with geohash if not present
      if (geohash && !productData.location?.geohash) {
        const geoKey = `product_geohash_${productId}`;
        debounceUpdate(geoKey, async () => {
          await db.collection('products').doc(productId).update({
            'location.geohash': geohash,
          });
          console.log(`Added geohash to product ${productId}`);
        });
      }
    } catch (error) {
      console.error(
        `Error updating search index for product ${productId}:`,
        error
      );
    }
  }
);

/**
 * Update user stats when product is created/updated/sold
 */
export const updateUserStats = onDocumentWritten(
  { document: 'products/{productId}', memory: '512MiB' },
  async (event) => {
    const productId = event.params.productId;

    try {
      const after = event.data?.after?.exists ? event.data.after.data() : null;

      if (!after) return; // Document deleted

      const sellerId = after.sellerId;
      if (!sellerId) return;

      // Debounce user stats update
      const updateKey = `user_stats_${sellerId}`;
      debounceUpdate(
        updateKey,
        async () => {
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

          const averageSalePrice =
            salesCount > 0 ? totalEarnings / salesCount : 0;

          // Update user stats
          await userStatsRef.set(
            {
              userId: sellerId,
              productsListed,
              productsActive,
              productsSold,
              productsViews: totalViews,
              productsLikes: totalLikes,
              totalEarnings,
              averageSalePrice,
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true }
          );

          console.log(`Updated stats for user ${sellerId}`);
        },
        10000
      ); // 10 second debounce
    } catch (error) {
      console.error(
        `Error updating user stats for product ${productId}:`,
        error
      );
    }
  }
);
