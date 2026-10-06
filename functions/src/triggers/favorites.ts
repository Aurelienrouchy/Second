/**
 * Favorites Firestore triggers
 * Firebase Functions v7 - using onDocumentWritten
 */
import { onDocumentUpdated, onDocumentWritten } from 'firebase-functions/v2/firestore';
import { db, FieldValue } from '../config/firebase';
import * as logger from 'firebase-functions/logger';
import { sendPushNotification } from '../utils/notifications';

/**
 * Canonical writer of article engagement counters (P1-3 / P1-5).
 *
 * The `favorites/{userId}.articleIds` array is the single source of truth for
 * likes. This trigger reacts to changes on that array and is the ONLY writer of
 * `articles.favoritesCount`, `articles.likes` and `search_index.likes`, applied
 * via a transactional count of the live source, so retries and late events
 * cannot replay a delta. The
 * `toggleProductLike` callable and the client `toggleFavorite` therefore mutate
 * ONLY the favorites doc — writing the counters there too would double-count.
 *
 * On top of counter maintenance, it notifies the seller of newly added
 * favorites.
 */
export const onArticleFavorited = onDocumentWritten(
  { document: 'favorites/{userId}', region: 'northamerica-northeast1', memory: '512MiB', retry: true },
  async (event) => {
    try {
      const beforeData = event.data?.before?.data();
      const afterData = event.data?.after?.data();

      const beforeIds: string[] = beforeData?.articleIds || [];
      const afterIds: string[] = afterData?.articleIds || [];
      const beforeSet = new Set(beforeIds);
      const afterSet = new Set(afterIds);
      const touched = new Set([...beforeSet].filter((id) => !afterSet.has(id)).concat([...afterSet].filter((id) => !beforeSet.has(id))));
      const buyerUserId = event.params.userId;
      const newFavoriteIds: string[] = [];

      // Per-user projection is transactional and reads the LIVE source. Duplicate
      // delivery and out-of-order events cannot count a like twice or resurrect
      // an unlike. The first document creation and deletion are also handled.
      for (const id of touched) {
        const added = await db.runTransaction(async (tx) => {
          const favoriteRef = db.collection('favorites').doc(buyerUserId);
          const articleRef = db.collection('articles').doc(id);
          const memberRef = db.collection('favorite_memberships').doc(id).collection('users').doc(buyerUserId);
          const indexRef = db.collection('search_index').doc(id);
          const countQuery = db.collection('favorites').where('articleIds', 'array-contains', id).count();
          const [favorite, article, member, index, total] = await Promise.all([
            tx.get(favoriteRef), tx.get(articleRef), tx.get(memberRef), tx.get(indexRef),
            tx.get(countQuery),
          ]);
          const desired = (favorite.data()?.articleIds || []).includes(id);
          const added = desired && !beforeSet.has(id) && member.data()?.counted !== true;
          tx.set(memberRef, { counted: desired, updatedAt: FieldValue.serverTimestamp() });
          if (!article.exists) return false;
          // Aggregation repairs existing drift too (including the old missed
          // first-like bug). Cost scales with index entries, not full docs.
          const count = total.data().count;
          tx.update(articleRef, { favoritesCount: count, likes: count });
          if (index.exists) tx.update(indexRef, { likes: count });
          return added;
        });
        if (added) newFavoriteIds.push(id);
      }

      if (newFavoriteIds.length === 0) {
        return; // No new favorites to notify about
      }

      // Get buyer info
      const buyerDoc = await db.collection('users').doc(buyerUserId).get();
      const buyerName = buyerDoc.exists
        ? buyerDoc.data()?.displayName || "Quelqu'un"
        : "Quelqu'un";

      // Process each new favorite
      for (const articleId of newFavoriteIds) {
        // Get article info
        const articleDoc = await db.collection('articles').doc(articleId).get();
        if (!articleDoc.exists) continue;

        const articleData = articleDoc.data()!;
        const sellerId = articleData.sellerId;

        // Don't notify if seller is the one who favorited
        if (sellerId === buyerUserId) continue;

        // Check seller's notification preferences
        const sellerDoc = await db.collection('users').doc(sellerId).get();
        if (sellerDoc.exists) {
          const sellerPrefs = sellerDoc.data()?.preferences?.notifications;
          if (sellerPrefs?.articleFavorited === false) {
            console.log(
              `Seller ${sellerId} has article_favorited notifications disabled`
            );
            continue;
          }
        }

        // Send notification to seller
        await sendPushNotification(
          sellerId,
          'Nouvel intérêt pour votre article',
          `${buyerName} a ajouté "${articleData.title}" à ses favoris`,
          {
            articleId,
            articleTitle: articleData.title,
            userName: buyerName,
          },
          'article_favorited'
        );

        console.log(
          `Notified seller ${sellerId} about favorite on article ${articleId}`
        );
      }
    } catch (error) {
      logger.error('Error in onArticleFavorited', { error });
      throw error; // Retry failed projections; transactional memberships dedupe.
    }
  }
);

/**
 * When an article's price drops, notify users who have it in favorites
 */
export const onArticlePriceDropped = onDocumentUpdated(
  { document: 'articles/{articleId}', region: 'northamerica-northeast1', memory: '512MiB' },
  async (event) => {
    try {
      const beforeData = event.data?.before?.data();
      const afterData = event.data?.after?.data();

      if (!beforeData || !afterData) return;

      const oldPrice = beforeData?.price;
      const newPrice = afterData?.price;

      // Only trigger if price decreased
      if (!oldPrice || !newPrice || newPrice >= oldPrice) {
        return;
      }

      const articleId = event.params.articleId;
      const articleTitle = afterData?.title || 'Article';
      const discount = Math.round(((oldPrice - newPrice) / oldPrice) * 100);

      console.log(
        `Price dropped on ${articleId}: ${oldPrice} $ → ${newPrice} $ (-${discount}%)`
      );

      // Find all users who have this article in favorites
      const favoritesSnapshot = await db
        .collection('favorites')
        .where('articleIds', 'array-contains', articleId)
        .get();

      if (favoritesSnapshot.empty) {
        console.log('No users have this article in favorites');
        return;
      }

      // Send notifications to all users (in batches to avoid overload)
      const userIds = favoritesSnapshot.docs.map((doc) => doc.id);
      console.log(`Notifying ${userIds.length} users about price drop`);

      // Process in batches of 10
      const batchSize = 10;
      for (let i = 0; i < userIds.length; i += batchSize) {
        const batch = userIds.slice(i, i + batchSize);

        await Promise.all(
          batch.map(async (userId) => {
            // Don't notify the seller
            if (userId === afterData?.sellerId) return;

            // Check user's notification preferences
            const userDoc = await db.collection('users').doc(userId).get();
            if (userDoc.exists) {
              const userPrefs = userDoc.data()?.preferences?.notifications;
              if (userPrefs?.priceDrops === false) {
                console.log(
                  `User ${userId} has price drop notifications disabled`
                );
                return;
              }
            }

            await sendPushNotification(
              userId,
              'Baisse de prix !',
              `"${articleTitle}" est passé de ${oldPrice} $ à ${newPrice} $ (-${discount}%)`,
              {
                articleId,
                articleTitle,
                oldPrice: oldPrice.toString(),
                newPrice: newPrice.toString(),
              },
              'price_drop'
            );
          })
        );
      }

      console.log(`Price drop notifications sent for article ${articleId}`);
    } catch (error) {
      console.error('Error in onArticlePriceDropped:', error);
    }
  }
);
