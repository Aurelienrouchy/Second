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
 * - stripe: ^22.1.1
 *
 * File structure:
 * - /config       - Firebase, Stripe, ShipEngine, Gemini initialization
 * - /services     - AI services, brand matching
 * - /utils        - Geohash, search, notifications, debounce
 * - /callable     - onCall functions (client-callable)
 * - /triggers     - Firestore triggers (onDocument*)
 * - /scheduled    - Scheduled functions (pubsub)
 * - /http         - HTTP endpoints (webhooks)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getHomeFeed = exports.recordPriceDrop = exports.getLikedSellers = exports.toggleSellerLike = exports.getNewArrivals = exports.getFeaturedSellers = exports.getPriceDrops = exports.getTrendingBrands = exports.saveOnboardingPreferences = exports.generateStyleProfile = exports.getMomentProducts = exports.getActiveMoments = exports.completeMeetupTransaction = exports.cancelPendingTransaction = exports.requestWithdrawal = exports.checkTrackingStatus = exports.findPickupPoints = exports.getStripeAccountStatus = exports.getStripeAccountLink = exports.createStripeConnectAccount = exports.createStripeCheckout = exports.createTransaction = exports.getServiceFee = exports.getShippingEstimate = exports.removeItemFromPartySecure = exports.addItemToPartySecure = exports.leaveSwapPartySecure = exports.joinSwapPartySecure = exports.getSwapPartyLeaderboard = exports.getActiveSwapPartyInfo = exports.openSwapDispute = exports.rateSwap = exports.confirmSwapReception = exports.confirmSwapShipping = exports.uploadSwapPhotos = exports.setSwapExchangeMode = exports.cancelSwap = exports.declineSwap = exports.acceptSwap = exports.proposeMultiSwap = exports.markSavedSearchViewed = exports.toggleArticleSold = exports.toggleProductLike = exports.incrementProductView = exports.updateArticle = exports.createArticle = exports.getSimilarProducts = exports.visualSearch = exports.consolidateChatDuplicates = exports.analyzeProductImage = void 0;
exports.stripeWebhook = exports.checkShippedTracking = exports.expireOrphanedTransactions = exports.expireStaleOffers = exports.cleanupExpiredDrafts = exports.checkSavedSearchNotifications = exports.sendSwapZoneReminders = exports.updateSwapPartyStatuses = exports.updatePopularityScores = exports.cleanupSearchIndex = exports.updateGlobalStats = exports.onArticleSold = exports.onArticleSoftDeleted = exports.onUserProfileUpdated = exports.onArticlePriceDropped = exports.onArticleFavorited = exports.onSwapStatusUpdated = exports.onSwapCreated = exports.sendOfferStatusNotification = exports.sendMessageNotification = exports.generateEmbeddingOnUpdate = exports.generateEmbeddingOnCreate = exports.updateUserStats = exports.updateSearchIndex = exports.deleteUserAccount = exports.getUserPublicProfile = exports.getUserReviews = exports.createReview = void 0;
// ============================================================
// CALLABLE FUNCTIONS (onCall)
// ============================================================
// AI Functions
var ai_1 = require("./callable/ai");
Object.defineProperty(exports, "analyzeProductImage", { enumerable: true, get: function () { return ai_1.analyzeProductImage; } });
// Chat admin functions
var chats_1 = require("./callable/chats");
Object.defineProperty(exports, "consolidateChatDuplicates", { enumerable: true, get: function () { return chats_1.consolidateChatDuplicates; } });
// Visual Search & Similar Products
var search_1 = require("./callable/search");
Object.defineProperty(exports, "visualSearch", { enumerable: true, get: function () { return search_1.visualSearch; } });
Object.defineProperty(exports, "getSimilarProducts", { enumerable: true, get: function () { return search_1.getSimilarProducts; } });
// Product Functions
var products_1 = require("./callable/products");
Object.defineProperty(exports, "createArticle", { enumerable: true, get: function () { return products_1.createArticle; } });
Object.defineProperty(exports, "updateArticle", { enumerable: true, get: function () { return products_1.updateArticle; } });
Object.defineProperty(exports, "incrementProductView", { enumerable: true, get: function () { return products_1.incrementProductView; } });
Object.defineProperty(exports, "toggleProductLike", { enumerable: true, get: function () { return products_1.toggleProductLike; } });
Object.defineProperty(exports, "toggleArticleSold", { enumerable: true, get: function () { return products_1.toggleArticleSold; } });
Object.defineProperty(exports, "markSavedSearchViewed", { enumerable: true, get: function () { return products_1.markSavedSearchViewed; } });
// Swap Functions
var swaps_1 = require("./callable/swaps");
Object.defineProperty(exports, "proposeMultiSwap", { enumerable: true, get: function () { return swaps_1.proposeMultiSwap; } });
Object.defineProperty(exports, "acceptSwap", { enumerable: true, get: function () { return swaps_1.acceptSwap; } });
Object.defineProperty(exports, "declineSwap", { enumerable: true, get: function () { return swaps_1.declineSwap; } });
Object.defineProperty(exports, "cancelSwap", { enumerable: true, get: function () { return swaps_1.cancelSwap; } });
Object.defineProperty(exports, "setSwapExchangeMode", { enumerable: true, get: function () { return swaps_1.setSwapExchangeMode; } });
Object.defineProperty(exports, "uploadSwapPhotos", { enumerable: true, get: function () { return swaps_1.uploadSwapPhotos; } });
Object.defineProperty(exports, "confirmSwapShipping", { enumerable: true, get: function () { return swaps_1.confirmSwapShipping; } });
Object.defineProperty(exports, "confirmSwapReception", { enumerable: true, get: function () { return swaps_1.confirmSwapReception; } });
Object.defineProperty(exports, "rateSwap", { enumerable: true, get: function () { return swaps_1.rateSwap; } });
Object.defineProperty(exports, "openSwapDispute", { enumerable: true, get: function () { return swaps_1.openSwapDispute; } });
Object.defineProperty(exports, "getActiveSwapPartyInfo", { enumerable: true, get: function () { return swaps_1.getActiveSwapPartyInfo; } });
Object.defineProperty(exports, "getSwapPartyLeaderboard", { enumerable: true, get: function () { return swaps_1.getSwapPartyLeaderboard; } });
Object.defineProperty(exports, "joinSwapPartySecure", { enumerable: true, get: function () { return swaps_1.joinSwapPartySecure; } });
Object.defineProperty(exports, "leaveSwapPartySecure", { enumerable: true, get: function () { return swaps_1.leaveSwapPartySecure; } });
Object.defineProperty(exports, "addItemToPartySecure", { enumerable: true, get: function () { return swaps_1.addItemToPartySecure; } });
Object.defineProperty(exports, "removeItemFromPartySecure", { enumerable: true, get: function () { return swaps_1.removeItemFromPartySecure; } });
// Payment & Shipping Functions
var payments_1 = require("./callable/payments");
Object.defineProperty(exports, "getShippingEstimate", { enumerable: true, get: function () { return payments_1.getShippingEstimate; } });
Object.defineProperty(exports, "getServiceFee", { enumerable: true, get: function () { return payments_1.getServiceFee; } });
Object.defineProperty(exports, "createTransaction", { enumerable: true, get: function () { return payments_1.createTransaction; } });
Object.defineProperty(exports, "createStripeCheckout", { enumerable: true, get: function () { return payments_1.createStripeCheckout; } });
Object.defineProperty(exports, "createStripeConnectAccount", { enumerable: true, get: function () { return payments_1.createStripeConnectAccount; } });
Object.defineProperty(exports, "getStripeAccountLink", { enumerable: true, get: function () { return payments_1.getStripeAccountLink; } });
Object.defineProperty(exports, "getStripeAccountStatus", { enumerable: true, get: function () { return payments_1.getStripeAccountStatus; } });
Object.defineProperty(exports, "findPickupPoints", { enumerable: true, get: function () { return payments_1.findPickupPoints; } });
Object.defineProperty(exports, "checkTrackingStatus", { enumerable: true, get: function () { return payments_1.checkTrackingStatus; } });
Object.defineProperty(exports, "requestWithdrawal", { enumerable: true, get: function () { return payments_1.requestWithdrawal; } });
Object.defineProperty(exports, "cancelPendingTransaction", { enumerable: true, get: function () { return payments_1.cancelPendingTransaction; } });
Object.defineProperty(exports, "completeMeetupTransaction", { enumerable: true, get: function () { return payments_1.completeMeetupTransaction; } });
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
// User Account Functions
var users_1 = require("./callable/users");
Object.defineProperty(exports, "deleteUserAccount", { enumerable: true, get: function () { return users_1.deleteUserAccount; } });
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
// User Profile Triggers
var users_2 = require("./triggers/users");
Object.defineProperty(exports, "onUserProfileUpdated", { enumerable: true, get: function () { return users_2.onUserProfileUpdated; } });
// Article Triggers
var articles_1 = require("./triggers/articles");
Object.defineProperty(exports, "onArticleSoftDeleted", { enumerable: true, get: function () { return articles_1.onArticleSoftDeleted; } });
Object.defineProperty(exports, "onArticleSold", { enumerable: true, get: function () { return articles_1.onArticleSold; } });
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
// Draft image cleanup
var cleanupDrafts_1 = require("./scheduled/cleanupDrafts");
Object.defineProperty(exports, "cleanupExpiredDrafts", { enumerable: true, get: function () { return cleanupDrafts_1.cleanupExpiredDrafts; } });
// Offer expiration (hourly cleanup of stale pending offers)
var offerExpiration_1 = require("./scheduled/offerExpiration");
Object.defineProperty(exports, "expireStaleOffers", { enumerable: true, get: function () { return offerExpiration_1.expireStaleOffers; } });
// Transaction expiration (meetup_pending 48h + pending_payment 1h + paid-not-shipped 7d)
var transactionExpiration_1 = require("./scheduled/transactionExpiration");
Object.defineProperty(exports, "expireOrphanedTransactions", { enumerable: true, get: function () { return transactionExpiration_1.expireOrphanedTransactions; } });
// Tracking check (poll ShipEngine every 6h for shipped transactions)
var trackingCheck_1 = require("./scheduled/trackingCheck");
Object.defineProperty(exports, "checkShippedTracking", { enumerable: true, get: function () { return trackingCheck_1.checkShippedTracking; } });
// ============================================================
// HTTP ENDPOINTS (webhooks)
// ============================================================
// Stripe Webhook (payment confirmation + Connect account updates)
var webhooks_1 = require("./http/webhooks");
Object.defineProperty(exports, "stripeWebhook", { enumerable: true, get: function () { return webhooks_1.stripeWebhook; } });
//# sourceMappingURL=index.js.map