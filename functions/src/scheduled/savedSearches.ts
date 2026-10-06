/**
 * Scheduled saved search functions
 * Firebase Functions v7 - using onSchedule
 */
import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as logger from 'firebase-functions/logger';
import type { Query } from 'firebase-admin/firestore';
import { db, FieldValue } from '../config/firebase';
import { sendPushNotification } from '../utils/notifications';
import { brandKey } from '../utils/normalizeBrand';
import { sanitizeArticleSize } from '../shared/article';

interface SavedSearchSize {
  value: string;
  system: 'US' | 'EU';
}

interface SavedSearchFilters {
  categoryIds?: string[];
  brands?: string[];
  sizes?: SavedSearchSize[];
  colors?: string[];
  materials?: string[];
  condition?: string;
  minPrice?: number;
  maxPrice?: number;
}

/**
 * Check saved searches and notify users of new matching articles
 * Runs every 15 minutes
 *
 * Optimization: uses collectionGroup query on `savedSearches` with
 * `notifyNewItems == true` instead of scanning all users.
 * This only fetches the saved searches that actually have notifications
 * enabled, then extracts the parent userId from each doc ref path.
 */
export const checkSavedSearchNotifications = onSchedule(
  { schedule: 'every 15 minutes', region: 'northamerica-northeast1', memory: '512MiB' },
  async () => {
    logger.info('Starting saved search notification check...');

    try {
      // Use collectionGroup query to find all active saved searches across all users
      const activeSavedSearches = await db
        .collectionGroup('savedSearches')
        .where('notifyNewItems', '==', true)
        .get();

      if (activeSavedSearches.empty) {
        logger.info('No active saved searches with notifications enabled');
        return;
      }

      logger.info('Found active saved searches', { count: activeSavedSearches.docs.length });

      let notificationsSent = 0;
      let searchesChecked = 0;

      for (const searchDoc of activeSavedSearches.docs) {
        // Extract userId from the document path
        const pathSegments = searchDoc.ref.path.split('/');
        const userId = pathSegments[1];
        if (!userId) continue;

        searchesChecked++;
        const search = searchDoc.data();
        const searchId = searchDoc.id;
        const lastNotifiedAt = search.lastNotifiedAt?.toDate() || new Date(0);
        const filters: SavedSearchFilters = search.filters || {};
        const searchQuery = search.query || '';

        // Build query for matching articles
        let articlesQuery: Query = db
          .collection('articles')
          .where('isActive', '==', true)
          .where('isSold', '==', false)
          .where('createdAt', '>', lastNotifiedAt);

        // Apply the single server-side equality filter we can index cheaply
        // (only the first filter, due to Firestore single-array-membership and
        // index limitations). Brand is intentionally NOT pushed server-side:
        // articles store a single `brand` STRING (not a `brands` array), so an
        // `array-contains-any` would match nothing and would also require an
        // extra composite index. The brand filter is applied in memory below.
        if (filters.categoryIds && filters.categoryIds.length > 0) {
          const mostSpecificCategory =
            filters.categoryIds[filters.categoryIds.length - 1];
          articlesQuery = articlesQuery.where(
            'categoryIds',
            'array-contains',
            mostSpecificCategory
          );
        }

        // Limit results
        articlesQuery = articlesQuery.limit(50);

        const matchingArticlesSnapshot = await articlesQuery.get();

        // Apply additional filters in memory
        let matchingArticles = matchingArticlesSnapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));

        // Filter by text query if present. Title/description stay substring
        // (free-text). Brand is matched EXACT on brandKey() to mirror the client
        // (articlesService matchesClientSideFilters) so e.g. a query of "gap"
        // never matches the brand "Gap Kids" via substring.
        if (searchQuery) {
          const queryLower = searchQuery.toLowerCase();
          const queryBrandKey = brandKey(searchQuery);
          matchingArticles = matchingArticles.filter((article: any) => {
            const matchesTitle = article.title
              ?.toLowerCase()
              .includes(queryLower);
            const matchesDesc = article.description
              ?.toLowerCase()
              .includes(queryLower);
            const articleBrand = article.brand as string | undefined;
            const matchesBrand =
              !!articleBrand && brandKey(articleBrand) === queryBrandKey;
            return matchesTitle || matchesDesc || matchesBrand;
          });
        }

        // Filter by price
        if (filters.minPrice !== undefined) {
          matchingArticles = matchingArticles.filter(
            (article: any) => article.price >= filters.minPrice!
          );
        }
        if (filters.maxPrice !== undefined) {
          matchingArticles = matchingArticles.filter(
            (article: any) => article.price <= filters.maxPrice!
          );
        }

        // Filter by sizes (ArticleSize objects { value, system } — exact match
        // on both value and system so US/EU sizes never collide). Legacy sizes
        // stored as a plain string are normalised via sanitizeArticleSize
        // (back-compat → { value, system: 'EU' }) so they are not silently
        // excluded before the real data migration (be-migration-sizes) lands.
        if (filters.sizes && filters.sizes.length > 0) {
          matchingArticles = matchingArticles.filter((article: any) => {
            const articleSize = sanitizeArticleSize(article.size);
            if (!articleSize) return false;
            return filters.sizes!.some(
              (f) =>
                f.value === articleSize.value && f.system === articleSize.system
            );
          });
        }

        // Filter by colors
        if (filters.colors && filters.colors.length > 0) {
          matchingArticles = matchingArticles.filter((article: any) => {
            const articleColors =
              article.colors || (article.color ? [article.color] : []);
            return filters.colors!.some((filterColor) =>
              articleColors.includes(filterColor)
            );
          });
        }

        // Filter by brand (structured `filters.brands`). Articles store a single
        // `brand` string; mirror the client filter (articlesService
        // matchesClientSideFilters) which compares with brandKey() exact-match
        // (lowercase + trim) so `Gap` never matches `Gap Kids`. Articles without
        // a brand are excluded.
        if (filters.brands && filters.brands.length > 0) {
          const wantedBrandKeys = filters.brands.map((b) => brandKey(b));
          matchingArticles = matchingArticles.filter((article: any) => {
            if (!article.brand) return false;
            const docKey = brandKey(article.brand as string);
            return wantedBrandKeys.some((k) => k === docKey);
          });
        }

        // Filter by materials
        if (filters.materials && filters.materials.length > 0) {
          matchingArticles = matchingArticles.filter((article: any) => {
            const articleMaterials =
              article.materials || (article.material ? [article.material] : []);
            return filters.materials!.some((filterMaterial) =>
              articleMaterials.includes(filterMaterial)
            );
          });
        }

        // Filter by condition
        if (filters.condition) {
          matchingArticles = matchingArticles.filter(
            (article: any) => article.condition === filters.condition
          );
        }

        // If we have matching articles, send notification
        if (matchingArticles.length > 0) {
          const title = `${matchingArticles.length} nouvel${matchingArticles.length > 1 ? 's' : ''} article${matchingArticles.length > 1 ? 's' : ''}`;
          const body = search.name
            ? `Nouvelle correspondance pour "${search.name}"`
            : searchQuery
              ? `Résultats pour "${searchQuery}"`
              : 'De nouveaux articles correspondent à votre recherche';

          try {
            const result = await sendPushNotification(userId, title, body, {
              savedSearchId: searchId,
              searchName: search.name || '',
              newItemsCount: matchingArticles.length.toString(),
              filters: JSON.stringify(filters),
              query: searchQuery,
            }, 'saved_search');
            const successCount = result.sentCount;

            if (result.success) {
              if (successCount > 0) notificationsSent++;

              // Update lastNotifiedAt and newItemsCount
              await db
                .collection('users')
                .doc(userId)
                .collection('savedSearches')
                .doc(searchId)
                .update({
                  lastNotifiedAt: FieldValue.serverTimestamp(),
                  newItemsCount: matchingArticles.length,
                });

              logger.info('Sent notification for saved search', {
                searchName: search.name,
                userId,
                newItemsCount: matchingArticles.length,
              });
            }
          } catch (sendError) {
            logger.error('Error sending notification for search', { searchId, error: sendError });
          }
        }
      }

      logger.info('Saved search check complete', { searchesChecked, notificationsSent });
    } catch (error) {
      logger.error('Error in saved search notification check', { error });
    }
  }
);
