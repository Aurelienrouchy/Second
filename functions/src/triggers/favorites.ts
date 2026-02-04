/**
 * Favorites Firestore triggers
 * Firebase Functions v7 - using onDocumentUpdated
 */
import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { db } from '../config/firebase';
import { sendPushNotification } from '../utils/notifications';

/**
 * When someone adds an article to favorites, notify the seller
 */
export const onArticleFavorited = onDocumentUpdated(
  { document: 'favorites/{userId}', memory: '512MiB' },
  async (event) => {
    try {
      const beforeData = event.data?.before?.data();
      const afterData = event.data?.after?.data();

      if (!beforeData || !afterData) return;

      const beforeIds: string[] = beforeData?.articleIds || [];
      const afterIds: string[] = afterData?.articleIds || [];

      // Find newly added article IDs
      const newFavoriteIds = afterIds.filter((id) => !beforeIds.includes(id));

      if (newFavoriteIds.length === 0) {
        return; // No new favorites added
      }

      const buyerUserId = event.params.userId;

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
          '❤️ Nouvel intérêt pour votre article',
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
      console.error('Error in onArticleFavorited:', error);
    }
  }
);

/**
 * When an article's price drops, notify users who have it in favorites
 */
export const onArticlePriceDropped = onDocumentUpdated(
  { document: 'articles/{articleId}', memory: '512MiB' },
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
        `Price dropped on ${articleId}: ${oldPrice}€ → ${newPrice}€ (-${discount}%)`
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
              '💰 Baisse de prix !',
              `"${articleTitle}" est passé de ${oldPrice}€ à ${newPrice}€ (-${discount}%)`,
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
