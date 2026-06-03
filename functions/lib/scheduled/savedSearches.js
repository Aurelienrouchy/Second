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
const logger = __importStar(require("firebase-functions/logger"));
const admin = __importStar(require("firebase-admin"));
const firebase_1 = require("../config/firebase");
const notifications_1 = require("../utils/notifications");
const normalizeBrand_1 = require("../utils/normalizeBrand");
const article_1 = require("../shared/article");
/**
 * Compute the user's REAL unread badge count for the APNs payload:
 * unread in-app notifications + unread chat messages.
 *
 * Mirrors utils/notifications.computeBadgeCount (kept local because this
 * scheduled job builds FCM messages inline rather than going through
 * sendPushNotification). The previous implementation hardcoded the badge to
 * the per-search new-items count, which clobbered the device badge with a
 * value unrelated to the user's true unread total. Best-effort: on any read
 * error we fall back to 1 so the push still surfaces a badge.
 */
async function computeBadgeCount(userId) {
    try {
        const [notifSnap, chatsSnap] = await Promise.all([
            firebase_1.db
                .collection('notifications')
                .where('userId', '==', userId)
                .where('isRead', '==', false)
                .count()
                .get(),
            firebase_1.db
                .collection('chats')
                .where('participants', 'array-contains', userId)
                .get(),
        ]);
        const unreadNotifications = notifSnap.data().count;
        let unreadMessages = 0;
        chatsSnap.forEach((doc) => {
            var _a, _b;
            const raw = (_b = (_a = doc.data()) === null || _a === void 0 ? void 0 : _a.unreadCount) === null || _b === void 0 ? void 0 : _b[userId];
            if (typeof raw === 'number' && raw > 0) {
                unreadMessages += raw;
            }
        });
        return unreadNotifications + unreadMessages;
    }
    catch (error) {
        logger.warn('Failed to compute badge count, falling back to 1', {
            userId,
            error: error instanceof Error ? error.message : error,
        });
        return 1;
    }
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
exports.checkSavedSearchNotifications = (0, scheduler_1.onSchedule)({ schedule: 'every 15 minutes', region: 'northamerica-northeast1', memory: '512MiB' }, async () => {
    var _a;
    logger.info('Starting saved search notification check...');
    try {
        // Use collectionGroup query to find all active saved searches across all users
        const activeSavedSearches = await firebase_1.db
            .collectionGroup('savedSearches')
            .where('notifyNewItems', '==', true)
            .get();
        if (activeSavedSearches.empty) {
            logger.info('No active saved searches with notifications enabled');
            return;
        }
        logger.info('Found active saved searches', { count: activeSavedSearches.docs.length });
        // Pre-fetch user data for all unique userIds (to check fcmTokens)
        const userIds = new Set();
        for (const doc of activeSavedSearches.docs) {
            // Path: users/{userId}/savedSearches/{searchId}
            const pathSegments = doc.ref.path.split('/');
            const userId = pathSegments[1]; // users/{userId}/...
            if (userId)
                userIds.add(userId);
        }
        // Batch-fetch user docs for FCM tokens
        const userDataMap = new Map();
        const userIdArray = Array.from(userIds);
        for (let i = 0; i < userIdArray.length; i += 30) {
            const batch = userIdArray.slice(i, i + 30);
            const userDocs = await Promise.all(batch.map((uid) => firebase_1.db.collection('users').doc(uid).get()));
            for (const userDoc of userDocs) {
                if (userDoc.exists) {
                    const data = userDoc.data();
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
            if (!userId)
                continue;
            // Skip users without FCM tokens
            const userData = userDataMap.get(userId);
            if (!userData)
                continue;
            // Raw APNs tokens (iOS native tokens) are not sendable via FCM and must
            // not be pruned on send failure — partition them out.
            const { fcmTokens } = (0, notifications_1.partitionTokens)(userData.fcmTokens);
            // No FCM-routable tokens (e.g. iOS-only with raw APNs token): skip.
            if (fcmTokens.length === 0)
                continue;
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
            // Apply the single server-side equality filter we can index cheaply
            // (only the first filter, due to Firestore single-array-membership and
            // index limitations). Brand is intentionally NOT pushed server-side:
            // articles store a single `brand` STRING (not a `brands` array), so an
            // `array-contains-any` would match nothing and would also require an
            // extra composite index. The brand filter is applied in memory below.
            if (filters.categoryIds && filters.categoryIds.length > 0) {
                const mostSpecificCategory = filters.categoryIds[filters.categoryIds.length - 1];
                articlesQuery = articlesQuery.where('categoryIds', 'array-contains', mostSpecificCategory);
            }
            // Limit results
            articlesQuery = articlesQuery.limit(50);
            const matchingArticlesSnapshot = await articlesQuery.get();
            // Apply additional filters in memory
            let matchingArticles = matchingArticlesSnapshot.docs.map((doc) => (Object.assign({ id: doc.id }, doc.data())));
            // Filter by text query if present. Title/description stay substring
            // (free-text). Brand is matched EXACT on brandKey() to mirror the client
            // (articlesService matchesClientSideFilters) so e.g. a query of "gap"
            // never matches the brand "Gap Kids" via substring.
            if (searchQuery) {
                const queryLower = searchQuery.toLowerCase();
                const queryBrandKey = (0, normalizeBrand_1.brandKey)(searchQuery);
                matchingArticles = matchingArticles.filter((article) => {
                    var _a, _b;
                    const matchesTitle = (_a = article.title) === null || _a === void 0 ? void 0 : _a.toLowerCase().includes(queryLower);
                    const matchesDesc = (_b = article.description) === null || _b === void 0 ? void 0 : _b.toLowerCase().includes(queryLower);
                    const articleBrand = article.brand;
                    const matchesBrand = !!articleBrand && (0, normalizeBrand_1.brandKey)(articleBrand) === queryBrandKey;
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
            // Filter by sizes (ArticleSize objects { value, system } — exact match
            // on both value and system so US/EU sizes never collide). Legacy sizes
            // stored as a plain string are normalised via sanitizeArticleSize
            // (back-compat → { value, system: 'EU' }) so they are not silently
            // excluded before the real data migration (be-migration-sizes) lands.
            if (filters.sizes && filters.sizes.length > 0) {
                matchingArticles = matchingArticles.filter((article) => {
                    const articleSize = (0, article_1.sanitizeArticleSize)(article.size);
                    if (!articleSize)
                        return false;
                    return filters.sizes.some((f) => f.value === articleSize.value && f.system === articleSize.system);
                });
            }
            // Filter by colors
            if (filters.colors && filters.colors.length > 0) {
                matchingArticles = matchingArticles.filter((article) => {
                    const articleColors = article.colors || (article.color ? [article.color] : []);
                    return filters.colors.some((filterColor) => articleColors.includes(filterColor));
                });
            }
            // Filter by brand (structured `filters.brands`). Articles store a single
            // `brand` string; mirror the client filter (articlesService
            // matchesClientSideFilters) which compares with brandKey() exact-match
            // (lowercase + trim) so `Gap` never matches `Gap Kids`. Articles without
            // a brand are excluded.
            if (filters.brands && filters.brands.length > 0) {
                const wantedBrandKeys = filters.brands.map((b) => (0, normalizeBrand_1.brandKey)(b));
                matchingArticles = matchingArticles.filter((article) => {
                    if (!article.brand)
                        return false;
                    const docKey = (0, normalizeBrand_1.brandKey)(article.brand);
                    return wantedBrandKeys.some((k) => k === docKey);
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
                // Real APNs badge = unread notifications + unread chat messages
                // (NOT the per-search new-items count, which would clobber the badge
                // with an unrelated value).
                const badge = await computeBadgeCount(userId);
                // Send notification to all user's devices
                const messages = fcmTokens.map((token) => ({
                    token,
                    notification: {
                        title,
                        body,
                    },
                    data: {
                        type: 'saved_search',
                        // Client reads `savedSearchId` (hooks/useNotificationSetup.ts +
                        // buildDeepLink). Emitting `searchId` here broke tap routing.
                        savedSearchId: searchId,
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
                                badge,
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
                            logger.error('Failed to send notification', { error: response.error });
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
                                    .catch((err) => logger.error('Error removing invalid token', { error: err }));
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
                        logger.info('Sent notification for saved search', {
                            searchName: search.name,
                            userId,
                            newItemsCount: matchingArticles.length,
                        });
                    }
                }
                catch (sendError) {
                    logger.error('Error sending notification for search', { searchId, error: sendError });
                }
            }
        }
        logger.info('Saved search check complete', { searchesChecked, notificationsSent });
    }
    catch (error) {
        logger.error('Error in saved search notification check', { error });
    }
});
//# sourceMappingURL=savedSearches.js.map