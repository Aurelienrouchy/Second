"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkSavedSearchNotifications = void 0;
/**
 * Scheduled saved search functions
 * Firebase Functions v7 - using onSchedule
 */
const scheduler_1 = require("firebase-functions/v2/scheduler");
const admin = __importStar(require("firebase-admin"));
const firebase_1 = require("../config/firebase");
/**
 * Check saved searches and notify users of new matching articles
 * Runs every 15 minutes
 */
exports.checkSavedSearchNotifications = (0, scheduler_1.onSchedule)({ schedule: 'every 15 minutes', memory: '512MiB' }, async () => {
    var _a;
    console.log('Starting saved search notification check...');
    try {
        // Get all users with saved searches
        const usersSnapshot = await firebase_1.db.collection('users').get();
        let notificationsSent = 0;
        let searchesChecked = 0;
        for (const userDoc of usersSnapshot.docs) {
            const userId = userDoc.id;
            const userData = userDoc.data();
            const fcmTokens = userData.fcmTokens || [];
            // Skip users without FCM tokens
            if (fcmTokens.length === 0)
                continue;
            // Get user's saved searches with notifications enabled
            const savedSearchesSnapshot = await firebase_1.db
                .collection('users')
                .doc(userId)
                .collection('savedSearches')
                .where('notifyNewItems', '==', true)
                .get();
            for (const searchDoc of savedSearchesSnapshot.docs) {
                searchesChecked++;
                const search = searchDoc.data();
                const searchId = searchDoc.id;
                const lastNotifiedAt = ((_a = search.lastNotifiedAt) === null || _a === void 0 ? void 0 : _a.toDate()) || new Date(0);
                const filters = search.filters || {};
                const searchQuery = search.query || '';
                // Build query for matching articles
                let articlesQuery = firebase_1.db
                    .collection('articles')
                    .where('isActive', '==', true)
                    .where('isSold', '==', false)
                    .where('createdAt', '>', lastNotifiedAt);
                // Apply filters (only first filter due to Firestore limitations)
                if (filters.categoryIds && filters.categoryIds.length > 0) {
                    const mostSpecificCategory = filters.categoryIds[filters.categoryIds.length - 1];
                    articlesQuery = articlesQuery.where('categoryId', '==', mostSpecificCategory);
                }
                else if (filters.brands && filters.brands.length > 0) {
                    articlesQuery = articlesQuery.where('brands', 'array-contains-any', filters.brands.slice(0, 10));
                }
                // Limit results
                articlesQuery = articlesQuery.limit(50);
                const matchingArticlesSnapshot = await articlesQuery.get();
                // Apply additional filters in memory
                let matchingArticles = matchingArticlesSnapshot.docs.map((doc) => (Object.assign({ id: doc.id }, doc.data())));
                // Filter by text query if present
                if (searchQuery) {
                    const queryLower = searchQuery.toLowerCase();
                    matchingArticles = matchingArticles.filter((article) => {
                        var _a, _b;
                        const matchesTitle = (_a = article.title) === null || _a === void 0 ? void 0 : _a.toLowerCase().includes(queryLower);
                        const matchesDesc = (_b = article.description) === null || _b === void 0 ? void 0 : _b.toLowerCase().includes(queryLower);
                        const brands = article.brands || (article.brand ? [article.brand] : []);
                        const matchesBrand = brands.some((b) => b.toLowerCase().includes(queryLower));
                        return matchesTitle || matchesDesc || matchesBrand;
                    });
                }
                // Filter by price
                if (filters.minPrice !== undefined) {
                    matchingArticles = matchingArticles.filter((article) => article.price >= filters.minPrice);
                }
                if (filters.maxPrice !== undefined) {
                    matchingArticles = matchingArticles.filter((article) => article.price <= filters.maxPrice);
                }
                // Filter by sizes
                if (filters.sizes && filters.sizes.length > 0) {
                    matchingArticles = matchingArticles.filter((article) => filters.sizes.includes(article.size));
                }
                // Filter by colors
                if (filters.colors && filters.colors.length > 0) {
                    matchingArticles = matchingArticles.filter((article) => {
                        const articleColors = article.colors || (article.color ? [article.color] : []);
                        return filters.colors.some((filterColor) => articleColors.includes(filterColor));
                    });
                }
                // Filter by materials
                if (filters.materials && filters.materials.length > 0) {
                    matchingArticles = matchingArticles.filter((article) => {
                        const articleMaterials = article.materials || (article.material ? [article.material] : []);
                        return filters.materials.some((filterMaterial) => articleMaterials.includes(filterMaterial));
                    });
                }
                // Filter by condition
                if (filters.condition) {
                    matchingArticles = matchingArticles.filter((article) => article.condition === filters.condition);
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
                    const messages = fcmTokens.map((token) => ({
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
                            priority: 'high',
                            notification: {
                                sound: 'default',
                                channelId: 'saved_searches',
                                priority: 'high',
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
                            var _a, _b;
                            if (response.success) {
                                successCount++;
                            }
                            else {
                                console.error(`Failed to send notification:`, response.error);
                                // Remove invalid tokens
                                if (((_a = response.error) === null || _a === void 0 ? void 0 : _a.code) ===
                                    'messaging/invalid-registration-token' ||
                                    ((_b = response.error) === null || _b === void 0 ? void 0 : _b.code) ===
                                        'messaging/registration-token-not-registered') {
                                    firebase_1.db.collection('users')
                                        .doc(userId)
                                        .update({
                                        fcmTokens: admin.firestore.FieldValue.arrayRemove(fcmTokens[index]),
                                    })
                                        .catch((err) => console.error('Error removing invalid token:', err));
                                }
                            }
                        });
                        if (successCount > 0) {
                            notificationsSent++;
                            // Update lastNotifiedAt and newItemsCount
                            await firebase_1.db
                                .collection('users')
                                .doc(userId)
                                .collection('savedSearches')
                                .doc(searchId)
                                .update({
                                lastNotifiedAt: firebase_1.FieldValue.serverTimestamp(),
                                newItemsCount: matchingArticles.length,
                            });
                            console.log(`Sent notification for search "${search.name}" to user ${userId}: ${matchingArticles.length} new items`);
                        }
                    }
                    catch (sendError) {
                        console.error(`Error sending notification for search ${searchId}:`, sendError);
                    }
                }
            }
        }
        console.log(`Saved search check complete. Checked ${searchesChecked} searches, sent ${notificationsSent} notifications.`);
    }
    catch (error) {
        console.error('Error in saved search notification check:', error);
    }
});
//# sourceMappingURL=savedSearches.js.map