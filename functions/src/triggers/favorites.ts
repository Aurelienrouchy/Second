/**
 * Favorites Firestore triggers
 * Firebase Functions v7 - using onDocumentUpdated
 */
import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { db, FieldValue } from '../config/firebase';
import { sendPushNotification } from '../utils/notifications';

/**
 * Canonical writer of article engagement counters (P1-3 / P1-5).
 *
 * The `favorites/{userId}.articleIds` array is the single source of truth for
 * likes. This trigger reacts to changes on that array and is the ONLY writer of
 * `articles.favoritesCount`, `articles.likes` and `search_index.likes`, applied
 * via `FieldValue.increment` so concurrent (un)favorites stay consistent. The
 * `toggleProductLike` callable and the client `toggleFavorite` therefore mutate
 * ONLY the favorites doc — writing the counters there too would double-count.
 *
 * On top of counter maintenance, it notifies the seller of newly added
 * favorites.
 */
export const onArticleFavorited = onDocumentUpdated(
  { document: 'favorites/{userId}', region: 'northamerica-northeast1', memory: '512MiB' },
  async (event) => {
    try {
      const beforeData = event.data?.before?.data();
      const afterData = event.data?.after?.data();

      if (!beforeData || !afterData) return;

      const beforeIds: string[] = beforeData?.articleIds || [];
      const afterIds: string[] = afterData?.articleIds || [];

      const beforeSet = new Set(beforeIds);
      const afterSet = new Set(afterIds);

      // Find newly added / removed article IDs (the array is the source of truth)
      const newFavoriteIds = afterIds.filter((id) => !beforeSet.has(id));
      const removedFavoriteIds = beforeIds.filter((id) => !afterSet.has(id));

      // ── Maintain engagement counters (canonical writer) ──
      // Apply +1 / -1 increments per touched article on both the article doc
      // (favoritesCount + likes) and its search_index mirror (likes). Using
      // FieldValue.increment keeps counters correct under concurrent toggles.
      // Each article is updated independently so one missing/deleted doc cannot
      // break the others.
      await Promise.all(
        [
          ...newFavoriteIds.map((id) => ({ id, delta: 1 })),
          ...removedFavoriteIds.map((id) => ({ id, delta: -1 })),
        ].map(async ({ id, delta }) => {
          try {
            // Increments are fine; decrements are clamped at 0 inside a
            // transaction so a double-removal can never drive the counter
            // negative.
            if (delta >= 0) {
              await db
                .collection('articles')
                .doc(id)
                .update({
                  favoritesCount: FieldValue.increment(delta),
                  likes: FieldValue.increment(delta),
                });
            } else {
              await db.runTransaction(async (tx) => {
                const ref = db.collection('articles').doc(id);
                const snap = await tx.get(ref);
                if (!snap.exists) return;
                const data = snap.data() || {};
                const favoritesCount = Math.max(0, (data.favoritesCount || 0) + delta);
                const likes = Math.max(0, (data.likes || 0) + delta);
                tx.update(ref, { favoritesCount, likes });
              });
            }
          } catch (err) {
            // Article may have been hard-deleted; counter is moot then.
            console.error(
              `Failed to update favoritesCount for article ${id}:`,
              err
            );
          }
          try {
            await db
              .collection('search_index')
              .doc(id)
              .update({ likes: FieldValue.increment(delta) });
          } catch (err) {
            // No search_index entry (e.g. sold/deleted article) — non-fatal.
            console.error(
              `Failed to update search_index likes for article ${id}:`,
              err
            );
          }
        })
      );

      if (newFavoriteIds.length === 0) {
        return; // No new favorites to notify about
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
      console.error('Error in onArticleFavorited:', error);
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
