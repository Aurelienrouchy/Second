/**
 * Article Firestore triggers (search index + user stats)
 * Firebase Functions v7 - using onDocumentWritten
 */
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import * as logger from 'firebase-functions/logger';
import { db, FieldValue } from '../config/firebase';
import { encodeGeohash } from '../utils/geohash';
import {
  generateSearchKeywords,
  calculatePopularityScore,
} from '../utils/search';
import { debounceUpdate } from '../utils/debounce';

/**
 * Update search index when article is created/updated/deleted
 *
 * TODO: the client currently searches via articlesService.ts client-side filtering.
 * Migrate to search_index queries for better performance.
 */
export const updateSearchIndex = onDocumentWritten(
  { document: 'articles/{articleId}', region: 'northamerica-northeast1', memory: '512MiB' },
  async (event) => {
    const articleId = event.params.articleId;

    try {
      // If document was deleted, remove from search index
      if (!event.data?.after?.exists) {
        await db.collection('search_index').doc(articleId).delete();
        logger.info(`Removed article ${articleId} from search index`);
        return;
      }

      const articleData = event.data.after.data();
      if (!articleData) return;

      // Only index active, approved articles
      if (!articleData.isActive || articleData.moderationStatus !== 'approved') {
        await db.collection('search_index').doc(articleId).delete();
        return;
      }

      // Generate geohash for location
      let geohash = '';
      if (articleData.location?.coordinates) {
        const { lat, lon } = articleData.location.coordinates;
        geohash = encodeGeohash(lat, lon, 7);
      }

      // Normalize array fields (support both singular and array formats)
      const getBrands = (): string[] => {
        if (articleData.brands && Array.isArray(articleData.brands))
          return articleData.brands;
        if (articleData.brand) return [articleData.brand];
        return [];
      };
      const getColors = (): string[] => {
        if (articleData.colors && Array.isArray(articleData.colors))
          return articleData.colors;
        if (articleData.color) return [articleData.color];
        return [];
      };
      const getMaterials = (): string[] => {
        if (articleData.materials && Array.isArray(articleData.materials))
          return articleData.materials;
        if (articleData.material) return [articleData.material];
        return [];
      };

      const brands = getBrands();
      const colors = getColors();
      const materials = getMaterials();

      // Generate search keywords
      const brandsText = brands.join(' ');
      const searchText = `${articleData.title} ${articleData.description} ${brandsText} ${articleData.category || ''}`;
      const keywords = generateSearchKeywords(searchText);

      // Calculate popularity score
      const popularityScore = calculatePopularityScore(
        articleData.views || 0,
        articleData.likes || 0,
        articleData.createdAt?.toDate() || new Date()
      );

      // Create search index document
      const searchIndexData = {
        articleId,
        title: articleData.title,
        titleLowercase: articleData.title.toLowerCase(),
        description: articleData.description,
        keywords,

        // Filterable fields
        category: articleData.category,
        subcategory: articleData.subcategory || null,
        brands: brands,
        colors: colors,
        materials: materials,
        brand: brands[0] || null,
        color: colors[0] || null,
        material: materials[0] || null,
        size: articleData.size || null,
        condition: articleData.condition,
        price: articleData.price,

        // Location data
        location: {
          city: articleData.location?.city || '',
          geohash,
          coordinates: articleData.location?.coordinates || null,
        },

        // Cached display data
        sellerId: articleData.sellerId,
        sellerName: articleData.sellerName,
        sellerRating: articleData.sellerRating || null,
        firstImage: articleData.images?.[0]?.url || null,

        // Status
        isActive: articleData.isActive,
        isSold: articleData.isSold,
        isPromoted: articleData.isPromoted || false,

        // Metrics for ranking
        views: articleData.views || 0,
        likes: articleData.likes || 0,
        createdAt: articleData.createdAt,

        // Search optimization
        popularityScore,
        lastIndexed: FieldValue.serverTimestamp(),
      };

      // Update search index with debouncing
      const updateKey = `search_index_${articleId}`;
      debounceUpdate(updateKey, async () => {
        await db
          .collection('search_index')
          .doc(articleId)
          .set(searchIndexData, { merge: true });
        logger.info(`Updated search index for article ${articleId}`);
      });

      // Update article with geohash if not present
      if (geohash && !articleData.location?.geohash) {
        const geoKey = `article_geohash_${articleId}`;
        debounceUpdate(geoKey, async () => {
          await db.collection('articles').doc(articleId).update({
            'location.geohash': geohash,
          });
          logger.info(`Added geohash to article ${articleId}`);
        });
      }
    } catch (error) {
      logger.error(`Error updating search index for article ${articleId}`, { error });
    }
  }
);

/**
 * Update user stats when article is created/updated/sold
 */
export const updateUserStats = onDocumentWritten(
  { document: 'articles/{articleId}', region: 'northamerica-northeast1', memory: '512MiB' },
  async (event) => {
    const articleId = event.params.articleId;

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

          // Get current user articles
          const userArticlesSnapshot = await db
            .collection('articles')
            .where('sellerId', '==', sellerId)
            .get();

          let articlesListed = 0;
          let articlesActive = 0;
          let articlesSold = 0;
          let totalViews = 0;
          let totalLikes = 0;
          let totalEarnings = 0;
          let salesCount = 0;

          userArticlesSnapshot.forEach((doc) => {
            const article = doc.data();
            articlesListed++;

            if (article.isActive && !article.isSold) {
              articlesActive++;
            }

            if (article.isSold) {
              articlesSold++;
              totalEarnings += article.price || 0;
              salesCount++;
            }

            totalViews += article.views || 0;
            totalLikes += article.likes || 0;
          });

          const averageSalePrice =
            salesCount > 0 ? totalEarnings / salesCount : 0;

          // Update user stats
          await userStatsRef.set(
            {
              userId: sellerId,
              productsListed: articlesListed,
              productsActive: articlesActive,
              productsSold: articlesSold,
              productsViews: totalViews,
              productsLikes: totalLikes,
              totalEarnings,
              averageSalePrice,
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true }
          );

          logger.info(`Updated stats for user ${sellerId}`);
        },
        10000
      ); // 10 second debounce
    } catch (error) {
      logger.error(`Error updating user stats for article ${articleId}`, { error });
    }
  }
);
