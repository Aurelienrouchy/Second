/**
 * Scheduled saved search functions
 * Firebase Functions v7 - using onSchedule
 */
import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';
import { db, FieldValue } from '../config/firebase';

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

      // Pre-fetch user data for all unique userIds (to check fcmTokens)
      const userIds = new Set<string>();
      for (const doc of activeSavedSearches.docs) {
        // Path: users/{userId}/savedSearches/{searchId}
        const pathSegments = doc.ref.path.split('/');
        const userId = pathSegments[1]; // users/{userId}/...
        if (userId) userIds.add(userId);
      }

      // Batch-fetch user docs for FCM tokens
      const userDataMap = new Map<string, { fcmTokens: string[] }>();
      const userIdArray = Array.from(userIds);
      for (let i = 0; i < userIdArray.length; i += 30) {
        const batch = userIdArray.slice(i, i + 30);
        const userDocs = await Promise.all(
          batch.map((uid) => db.collection('users').doc(uid).get())
        );
        for (const userDoc of userDocs) {
          if (userDoc.exists) {
            const data = userDoc.data()!;
            const fcmTokens = data.fcmTokens || [];
            if (fcmTokens.length > 0) {
              userDataMap.set(userDoc.id, { fcmTokens });
            }
          }
        }
      }

      let notificationsSent = 0;
      let searchesChecked = 0;

      for (const searchDoc of activeSavedSearches.docs) {
        // Extract userId from the document path
        const pathSegments = searchDoc.ref.path.split('/');
        const userId = pathSegments[1];
        if (!userId) continue;

        // Skip users without FCM tokens
        const userData = userDataMap.get(userId);
        if (!userData) continue;
        const { fcmTokens } = userData;

        searchesChecked++;
        const search = searchDoc.data();
        const searchId = searchDoc.id;
        const lastNotifiedAt = search.lastNotifiedAt?.toDate() || new Date(0);
        const filters: SavedSearchFilters = search.filters || {};
        const searchQuery = search.query || '';

        // Build query for matching articles
        let articlesQuery: admin.firestore.Query = db
          .collection('articles')
          .where('isActive', '==', true)
          .where('isSold', '==', false)
          .where('createdAt', '>', lastNotifiedAt);

        // Apply filters (only first filter due to Firestore limitations)
        if (filters.categoryIds && filters.categoryIds.length > 0) {
          const mostSpecificCategory =
            filters.categoryIds[filters.categoryIds.length - 1];
          articlesQuery = articlesQuery.where(
            'categoryIds',
            'array-contains',
            mostSpecificCategory
          );
        } else if (filters.brands && filters.brands.length > 0) {
          articlesQuery = articlesQuery.where(
            'brands',
            'array-contains-any',
            filters.brands.slice(0, 10)
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

        // Filter by text query if present
        if (searchQuery) {
          const queryLower = searchQuery.toLowerCase();
          matchingArticles = matchingArticles.filter((article: any) => {
            const matchesTitle = article.title
              ?.toLowerCase()
              .includes(queryLower);
            const matchesDesc = article.description
              ?.toLowerCase()
              .includes(queryLower);
            const brands = article.brands || (article.brand ? [article.brand] : []);
            const matchesBrand = brands.some((b: string) =>
              b.toLowerCase().includes(queryLower)
            );
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

        // Filter by sizes
        if (filters.sizes && filters.sizes.length > 0) {
          matchingArticles = matchingArticles.filter((article: any) =>
            filters.sizes!.includes(article.size)
          );
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

          // Send notification to all user's devices
          const messages = fcmTokens.map((token: string) => ({
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
              filters: JSON.stringify(filters),
              query: searchQuery,
            },
            android: {
              priority: 'high' as const,
              notification: {
                sound: 'default',
                channelId: 'saved_searches',
                priority: 'high' as const,
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
              if (response.success) {
                successCount++;
              } else {
                logger.error('Failed to send notification', { error: response.error });

                // Remove invalid tokens
                if (
                  response.error?.code ===
                    'messaging/invalid-registration-token' ||
                  response.error?.code ===
                    'messaging/registration-token-not-registered'
                ) {
                  db.collection('users')
                    .doc(userId)
                    .update({
                      fcmTokens: admin.firestore.FieldValue.arrayRemove(
                        fcmTokens[index]
                      ),
                    })
                    .catch((err) =>
                      logger.error('Error removing invalid token', { error: err })
                    );
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
