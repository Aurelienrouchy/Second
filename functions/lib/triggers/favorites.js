"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.onArticlePriceDropped = exports.onArticleFavorited = void 0;
/**
 * Favorites Firestore triggers
 * Firebase Functions v7 - using onDocumentUpdated
 */
const firestore_1 = require("firebase-functions/v2/firestore");
const firebase_1 = require("../config/firebase");
const notifications_1 = require("../utils/notifications");
/**
 * When someone adds an article to favorites, notify the seller
 */
exports.onArticleFavorited = (0, firestore_1.onDocumentUpdated)({ document: 'favorites/{userId}', memory: '512MiB' }, async (event) => {
    var _a, _b, _c, _d, _e, _f, _g;
    try {
        const beforeData = (_b = (_a = event.data) === null || _a === void 0 ? void 0 : _a.before) === null || _b === void 0 ? void 0 : _b.data();
        const afterData = (_d = (_c = event.data) === null || _c === void 0 ? void 0 : _c.after) === null || _d === void 0 ? void 0 : _d.data();
        if (!beforeData || !afterData)
            return;
        const beforeIds = (beforeData === null || beforeData === void 0 ? void 0 : beforeData.articleIds) || [];
        const afterIds = (afterData === null || afterData === void 0 ? void 0 : afterData.articleIds) || [];
        // Find newly added article IDs
        const newFavoriteIds = afterIds.filter((id) => !beforeIds.includes(id));
        if (newFavoriteIds.length === 0) {
            return; // No new favorites added
        }
        const buyerUserId = event.params.userId;
        // Get buyer info
        const buyerDoc = await firebase_1.db.collection('users').doc(buyerUserId).get();
        const buyerName = buyerDoc.exists
            ? ((_e = buyerDoc.data()) === null || _e === void 0 ? void 0 : _e.displayName) || "Quelqu'un"
            : "Quelqu'un";
        // Process each new favorite
        for (const articleId of newFavoriteIds) {
            // Get article info
            const articleDoc = await firebase_1.db.collection('articles').doc(articleId).get();
            if (!articleDoc.exists)
                continue;
            const articleData = articleDoc.data();
            const sellerId = articleData.sellerId;
            // Don't notify if seller is the one who favorited
            if (sellerId === buyerUserId)
                continue;
            // Check seller's notification preferences
            const sellerDoc = await firebase_1.db.collection('users').doc(sellerId).get();
            if (sellerDoc.exists) {
                const sellerPrefs = (_g = (_f = sellerDoc.data()) === null || _f === void 0 ? void 0 : _f.preferences) === null || _g === void 0 ? void 0 : _g.notifications;
                if ((sellerPrefs === null || sellerPrefs === void 0 ? void 0 : sellerPrefs.articleFavorited) === false) {
                    console.log(`Seller ${sellerId} has article_favorited notifications disabled`);
                    continue;
                }
            }
            // Send notification to seller
            await (0, notifications_1.sendPushNotification)(sellerId, '❤️ Nouvel intérêt pour votre article', `${buyerName} a ajouté "${articleData.title}" à ses favoris`, {
                articleId,
                articleTitle: articleData.title,
                userName: buyerName,
            }, 'article_favorited');
            console.log(`Notified seller ${sellerId} about favorite on article ${articleId}`);
        }
    }
    catch (error) {
        console.error('Error in onArticleFavorited:', error);
    }
});
/**
 * When an article's price drops, notify users who have it in favorites
 */
exports.onArticlePriceDropped = (0, firestore_1.onDocumentUpdated)({ document: 'articles/{articleId}', memory: '512MiB' }, async (event) => {
    var _a, _b, _c, _d;
    try {
        const beforeData = (_b = (_a = event.data) === null || _a === void 0 ? void 0 : _a.before) === null || _b === void 0 ? void 0 : _b.data();
        const afterData = (_d = (_c = event.data) === null || _c === void 0 ? void 0 : _c.after) === null || _d === void 0 ? void 0 : _d.data();
        if (!beforeData || !afterData)
            return;
        const oldPrice = beforeData === null || beforeData === void 0 ? void 0 : beforeData.price;
        const newPrice = afterData === null || afterData === void 0 ? void 0 : afterData.price;
        // Only trigger if price decreased
        if (!oldPrice || !newPrice || newPrice >= oldPrice) {
            return;
        }
        const articleId = event.params.articleId;
        const articleTitle = (afterData === null || afterData === void 0 ? void 0 : afterData.title) || 'Article';
        const discount = Math.round(((oldPrice - newPrice) / oldPrice) * 100);
        console.log(`Price dropped on ${articleId}: ${oldPrice}€ → ${newPrice}€ (-${discount}%)`);
        // Find all users who have this article in favorites
        const favoritesSnapshot = await firebase_1.db
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
            await Promise.all(batch.map(async (userId) => {
                var _a, _b;
                // Don't notify the seller
                if (userId === (afterData === null || afterData === void 0 ? void 0 : afterData.sellerId))
                    return;
                // Check user's notification preferences
                const userDoc = await firebase_1.db.collection('users').doc(userId).get();
                if (userDoc.exists) {
                    const userPrefs = (_b = (_a = userDoc.data()) === null || _a === void 0 ? void 0 : _a.preferences) === null || _b === void 0 ? void 0 : _b.notifications;
                    if ((userPrefs === null || userPrefs === void 0 ? void 0 : userPrefs.priceDrops) === false) {
                        console.log(`User ${userId} has price drop notifications disabled`);
                        return;
                    }
                }
                await (0, notifications_1.sendPushNotification)(userId, '💰 Baisse de prix !', `"${articleTitle}" est passé de ${oldPrice}€ à ${newPrice}€ (-${discount}%)`, {
                    articleId,
                    articleTitle,
                    oldPrice: oldPrice.toString(),
                    newPrice: newPrice.toString(),
                }, 'price_drop');
            }));
        }
        console.log(`Price drop notifications sent for article ${articleId}`);
    }
    catch (error) {
        console.error('Error in onArticlePriceDropped:', error);
    }
});
//# sourceMappingURL=favorites.js.map