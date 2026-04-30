"use strict";
/**
 * Firebase Cloud Functions - Modular v7 Entry Point
 *
 * This file re-exports all functions from modular files.
 *
 * Package versions:
 * - firebase-admin: ^13.6.0
 * - firebase-functions: ^7.0.3
 * - @google/genai: ^1.37.0
 *
 * File structure:
 * - /config       - Firebase, Stripe, Intelcom, Gemini initialization
 * - /services     - AI services, brand matching
 * - /utils        - Geohash, search, notifications, debounce
 * - /callable     - onCall functions (client-callable)
 * - /triggers     - Firestore triggers (onDocument*)
 * - /scheduled    - Scheduled functions (pubsub)
 * - /http         - HTTP endpoints (webhooks)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.stripeWebhook = exports.checkSavedSearchNotifications = exports.sendSwapZoneReminders = exports.updateSwapPartyStatuses = exports.updatePopularityScores = exports.cleanupSearchIndex = exports.updateGlobalStats = exports.onArticlePriceDropped = exports.onArticleFavorited = exports.onSwapStatusUpdated = exports.onSwapCreated = exports.sendOfferStatusNotification = exports.sendMessageNotification = exports.generateEmbeddingOnUpdate = exports.generateEmbeddingOnCreate = exports.updateUserStats = exports.updateSearchIndex = exports.getUserPublicProfile = exports.getUserReviews = exports.createReview = exports.getHomeFeed = exports.recordPriceDrop = exports.getLikedSellers = exports.toggleSellerLike = exports.getNewArrivals = exports.getFeaturedSellers = exports.getPriceDrops = exports.getTrendingBrands = exports.saveOnboardingPreferences = exports.generateStyleProfile = exports.getMomentProducts = exports.getActiveMoments = exports.checkTrackingStatus = exports.createPaymentIntent = exports.getShippingEstimate = exports.getSwapPartyLeaderboard = exports.getActiveSwapPartyInfo = exports.proposeMultiSwap = exports.markSavedSearchViewed = exports.toggleProductLike = exports.incrementProductView = exports.getSimilarProducts = exports.visualSearch = exports.analyzeProductImage = void 0;
// ============================================================
// CALLABLE FUNCTIONS (onCall)
// ============================================================
// AI Functions
var ai_1 = require("./callable/ai");
Object.defineProperty(exports, "analyzeProductImage", { enumerable: true, get: function () { return ai_1.analyzeProductImage; } });
// Visual Search & Similar Products
var search_1 = require("./callable/search");
Object.defineProperty(exports, "visualSearch", { enumerable: true, get: function () { return search_1.visualSearch; } });
Object.defineProperty(exports, "getSimilarProducts", { enumerable: true, get: function () { return search_1.getSimilarProducts; } });
// Product Functions
var products_1 = require("./callable/products");
Object.defineProperty(exports, "incrementProductView", { enumerable: true, get: function () { return products_1.incrementProductView; } });
Object.defineProperty(exports, "toggleProductLike", { enumerable: true, get: function () { return products_1.toggleProductLike; } });
Object.defineProperty(exports, "markSavedSearchViewed", { enumerable: true, get: function () { return products_1.markSavedSearchViewed; } });
// Swap Functions
var swaps_1 = require("./callable/swaps");
Object.defineProperty(exports, "proposeMultiSwap", { enumerable: true, get: function () { return swaps_1.proposeMultiSwap; } });
Object.defineProperty(exports, "getActiveSwapPartyInfo", { enumerable: true, get: function () { return swaps_1.getActiveSwapPartyInfo; } });
Object.defineProperty(exports, "getSwapPartyLeaderboard", { enumerable: true, get: function () { return swaps_1.getSwapPartyLeaderboard; } });
// Payment Functions
var payments_1 = require("./callable/payments");
Object.defineProperty(exports, "getShippingEstimate", { enumerable: true, get: function () { return payments_1.getShippingEstimate; } });
Object.defineProperty(exports, "createPaymentIntent", { enumerable: true, get: function () { return payments_1.createPaymentIntent; } });
Object.defineProperty(exports, "checkTrackingStatus", { enumerable: true, get: function () { return payments_1.checkTrackingStatus; } });
// Moments Functions
var moments_1 = require("./callable/moments");
Object.defineProperty(exports, "getActiveMoments", { enumerable: true, get: function () { return moments_1.getActiveMoments; } });
Object.defineProperty(exports, "getMomentProducts", { enumerable: true, get: function () { return moments_1.getMomentProducts; } });
// Style Functions
var style_1 = require("./callable/style");
Object.defineProperty(exports, "generateStyleProfile", { enumerable: true, get: function () { return style_1.generateStyleProfile; } });
// Onboarding Functions
var onboarding_1 = require("./callable/onboarding");
Object.defineProperty(exports, "saveOnboardingPreferences", { enumerable: true, get: function () { return onboarding_1.saveOnboardingPreferences; } });
// Home Functions
var home_1 = require("./callable/home");
// Individual section callables (preferred)
Object.defineProperty(exports, "getTrendingBrands", { enumerable: true, get: function () { return home_1.getTrendingBrands; } });
Object.defineProperty(exports, "getPriceDrops", { enumerable: true, get: function () { return home_1.getPriceDrops; } });
Object.defineProperty(exports, "getFeaturedSellers", { enumerable: true, get: function () { return home_1.getFeaturedSellers; } });
Object.defineProperty(exports, "getNewArrivals", { enumerable: true, get: function () { return home_1.getNewArrivals; } });
// Seller interactions
Object.defineProperty(exports, "toggleSellerLike", { enumerable: true, get: function () { return home_1.toggleSellerLike; } });
Object.defineProperty(exports, "getLikedSellers", { enumerable: true, get: function () { return home_1.getLikedSellers; } });
Object.defineProperty(exports, "recordPriceDrop", { enumerable: true, get: function () { return home_1.recordPriceDrop; } });
// Legacy combined feed
Object.defineProperty(exports, "getHomeFeed", { enumerable: true, get: function () { return home_1.getHomeFeed; } });
// Review Functions
var reviews_1 = require("./callable/reviews");
Object.defineProperty(exports, "createReview", { enumerable: true, get: function () { return reviews_1.createReview; } });
Object.defineProperty(exports, "getUserReviews", { enumerable: true, get: function () { return reviews_1.getUserReviews; } });
Object.defineProperty(exports, "getUserPublicProfile", { enumerable: true, get: function () { return reviews_1.getUserPublicProfile; } });
// ============================================================
// TRIGGER FUNCTIONS (onDocument*)
// ============================================================
// Product Triggers
var products_2 = require("./triggers/products");
Object.defineProperty(exports, "updateSearchIndex", { enumerable: true, get: function () { return products_2.updateSearchIndex; } });
Object.defineProperty(exports, "updateUserStats", { enumerable: true, get: function () { return products_2.updateUserStats; } });
// Embedding Triggers
var embeddings_1 = require("./triggers/embeddings");
Object.defineProperty(exports, "generateEmbeddingOnCreate", { enumerable: true, get: function () { return embeddings_1.generateEmbeddingOnCreate; } });
Object.defineProperty(exports, "generateEmbeddingOnUpdate", { enumerable: true, get: function () { return embeddings_1.generateEmbeddingOnUpdate; } });
// Message Triggers
var messages_1 = require("./triggers/messages");
Object.defineProperty(exports, "sendMessageNotification", { enumerable: true, get: function () { return messages_1.sendMessageNotification; } });
Object.defineProperty(exports, "sendOfferStatusNotification", { enumerable: true, get: function () { return messages_1.sendOfferStatusNotification; } });
// Swap Triggers
var swaps_2 = require("./triggers/swaps");
Object.defineProperty(exports, "onSwapCreated", { enumerable: true, get: function () { return swaps_2.onSwapCreated; } });
Object.defineProperty(exports, "onSwapStatusUpdated", { enumerable: true, get: function () { return swaps_2.onSwapStatusUpdated; } });
// Favorite Triggers
var favorites_1 = require("./triggers/favorites");
Object.defineProperty(exports, "onArticleFavorited", { enumerable: true, get: function () { return favorites_1.onArticleFavorited; } });
Object.defineProperty(exports, "onArticlePriceDropped", { enumerable: true, get: function () { return favorites_1.onArticlePriceDropped; } });
// ============================================================
// SCHEDULED FUNCTIONS (pubsub)
// ============================================================
// Stats
var stats_1 = require("./scheduled/stats");
Object.defineProperty(exports, "updateGlobalStats", { enumerable: true, get: function () { return stats_1.updateGlobalStats; } });
// Cleanup
var cleanup_1 = require("./scheduled/cleanup");
Object.defineProperty(exports, "cleanupSearchIndex", { enumerable: true, get: function () { return cleanup_1.cleanupSearchIndex; } });
// Popularity
var popularity_1 = require("./scheduled/popularity");
Object.defineProperty(exports, "updatePopularityScores", { enumerable: true, get: function () { return popularity_1.updatePopularityScores; } });
// Swaps
var swaps_3 = require("./scheduled/swaps");
Object.defineProperty(exports, "updateSwapPartyStatuses", { enumerable: true, get: function () { return swaps_3.updateSwapPartyStatuses; } });
Object.defineProperty(exports, "sendSwapZoneReminders", { enumerable: true, get: function () { return swaps_3.sendSwapZoneReminders; } });
// Saved Searches
var savedSearches_1 = require("./scheduled/savedSearches");
Object.defineProperty(exports, "checkSavedSearchNotifications", { enumerable: true, get: function () { return savedSearches_1.checkSavedSearchNotifications; } });
// ============================================================
// HTTP ENDPOINTS (webhooks)
// ============================================================
// Stripe Webhook
var webhooks_1 = require("./http/webhooks");
Object.defineProperty(exports, "stripeWebhook", { enumerable: true, get: function () { return webhooks_1.stripeWebhook; } });
//# sourceMappingURL=index.js.map