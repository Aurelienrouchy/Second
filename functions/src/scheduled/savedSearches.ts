/**
 * Scheduled saved search functions
 * Firebase Functions v7 - using onSchedule
 */
import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as admin from 'firebase-admin';
import { db, FieldValue } from '../config/firebase';

interface SavedSearchFilters {
  categoryIds?: string[];
  brands?: string[];
  sizes?: string[];
  colors?: string[];
  materials?: string[];
  patterns?: string[];
  condition?: string;
  minPrice?: number;
  maxPrice?: number;
}

/**
 * Check saved searches and notify users of new matching articles
 * Runs every 15 minutes
 */
export const checkSavedSearchNotifications = onSchedule(
  { schedule: 'every 15 minutes', memory: '512MiB' },
  async () => {
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
        if (fcmTokens.length === 0) continue;

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
              'categoryId',
              '==',
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
                  console.error(
                    `Failed to send notification:`,
                    response.error
                  );

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
                        console.error('Error removing invalid token:', err)
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

                console.log(
                  `Sent notification for search "${search.name}" to user ${userId}: ${matchingArticles.length} new items`
                );
              }
            } catch (sendError) {
              console.error(
                `Error sending notification for search ${searchId}:`,
                sendError
              );
            }
          }
        }
      }

      console.log(
        `Saved search check complete. Checked ${searchesChecked} searches, sent ${notificationsSent} notifications.`
      );
    } catch (error) {
      console.error('Error in saved search notification check:', error);
    }
  }
);
