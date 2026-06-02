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

      // Only index active, non-rejected articles.
      // IMPORTANT: legacy articles predate the `moderationStatus` field, so an
      // ABSENT value must be treated as approved (legacy). We only de-index on
      // an EXPLICIT moderation block ('pending' | 'rejected'); never on absence,
      // otherwise the pre-existing catalogue would be wiped from search at the
      // next write (R3).
      const moderationStatus = articleData.moderationStatus;
      const isModerationBlocked =
        moderationStatus === 'pending' || moderationStatus === 'rejected';
      if (!articleData.isActive || isModerationBlocked) {
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
        // Hierarchical category IDs — mirrored so the search_index path can
        // filter by category when a text term is present (C1).
        categoryIds: articleData.categoryIds || [],
        subcategory: articleData.subcategory || null,
        brands: brands,
        colors: colors,
        materials: materials,
        brand: brands[0] || null,
        color: colors[0] || null,
        material: materials[0] || null,
        // ArticleSize is an object { value, system }; mirror verbatim (or null).
        size: articleData.size ?? null,
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

      // Write search index. On the INITIAL creation we must await the write
      // directly: debounceUpdate is a fire-and-forget setTimeout, and on
      // Cloud Functions v2 (Cloud Run) the instance can be frozen/terminated
      // as soon as the handler returns — the timer would never fire and the
      // article would never be indexed (P1-7). We only debounce subsequent
      // updates (frequent metric writes: views/likes/popularity).
      const updateKey = `search_index_${articleId}`;
      const isCreation = !event.data.before?.exists;
      if (isCreation) {
        await db
          .collection('search_index')
          .doc(articleId)
          .set(searchIndexData, { merge: true });
        logger.info(`Indexed new article ${articleId}`);
      } else {
        debounceUpdate(updateKey, async () => {
          await db
            .collection('search_index')
            .doc(articleId)
            .set(searchIndexData, { merge: true });
          logger.info(`Updated search index for article ${articleId}`);
        });
      }

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
 * Maintain `shops/{shopId}.articlesCount` (boutiques-admin P1-2).
 *
 * No writer existed for this counter — the shop read path
 * (`shopService.getShopArticles`) lists articles where
 * `shopId == X AND isActive == true AND isSold == false`, and the UI gates the
 * shop display on `articlesCount > 0`. We mirror that exact predicate: an
 * article contributes +1 to its shop's count iff it has a `shopId`, is active,
 * and is not sold.
 *
 * The trigger applies the DELTA between the before/after contributions per
 * shop, so it is correct across create, delete, sold toggle, deactivation, and
 * a `shopId` change (old shop -1, new shop +1). Increments are idempotent by
 * delta and each shop write is isolated in its own try/catch (the boutique may
 * have been deleted) so one missing shop never aborts the others.
 */
export const updateShopArticlesCount = onDocumentWritten(
  { document: 'articles/{articleId}', region: 'northamerica-northeast1', memory: '512MiB' },
  async (event) => {
    const articleId = event.params.articleId;

    try {
      const before = event.data?.before?.exists ? event.data.before.data() : null;
      const after = event.data?.after?.exists ? event.data.after.data() : null;

      // Does this article state count toward a shop's `articlesCount`?
      // Returns the shopId it contributes to, or null if it counts for none.
      const countedShopId = (
        data: FirebaseFirestore.DocumentData | null,
      ): string | null => {
        if (!data) return null;
        const shopId = data.shopId;
        if (typeof shopId !== 'string' || shopId.length === 0) return null;
        // Mirror getShopArticles: active AND not sold.
        if (data.isActive !== true) return null;
        if (data.isSold === true) return null;
        return shopId;
      };

      const beforeShopId = countedShopId(before);
      const afterShopId = countedShopId(after);

      // No change in shop membership → nothing to do (idempotent no-op).
      if (beforeShopId === afterShopId) return;

      // Compute per-shop deltas. A shopId change yields -1 on the old shop and
      // +1 on the new one; create/delete/toggle yields a single +/-1.
      const deltas = new Map<string, number>();
      if (beforeShopId) {
        deltas.set(beforeShopId, (deltas.get(beforeShopId) || 0) - 1);
      }
      if (afterShopId) {
        deltas.set(afterShopId, (deltas.get(afterShopId) || 0) + 1);
      }

      await Promise.all(
        Array.from(deltas.entries()).map(async ([shopId, delta]) => {
          if (delta === 0) return;
          try {
            await db
              .collection('shops')
              .doc(shopId)
              .update({ articlesCount: FieldValue.increment(delta) });
            logger.info(
              `Adjusted articlesCount for shop ${shopId} by ${delta} (article ${articleId})`,
            );
          } catch (error) {
            // Shop may have been deleted — never abort sibling updates.
            logger.warn(
              `Could not update articlesCount for shop ${shopId}`,
              { articleId, delta, error: error instanceof Error ? error.message : String(error) },
            );
          }
        }),
      );
    } catch (error) {
      logger.error(`Error updating shop articlesCount for article ${articleId}`, { error });
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
