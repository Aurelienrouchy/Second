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
exports.getTrendingBrands = exports.saveOnboardingPreferences = exports.generateStyleProfile = exports.getMomentProducts = exports.getActiveMoments = exports.requestReturn = exports.reportTransactionProblem = exports.requestRefund = exports.adminRefundTransaction = exports.reportMeetupNoShow = exports.completeMeetupTransaction = exports.confirmMeetupTransaction = exports.acceptMeetupOffer = exports.cancelPendingTransaction = exports.checkTrackingStatus = exports.findPickupPoints = exports.getStripeAccountStatus = exports.addBankAccount = exports.createStripeConnectAccount = exports.createStripeCheckout = exports.createTransaction = exports.getServiceFee = exports.getShippingEstimate = exports.removeItemFromPartySecure = exports.addItemToPartySecure = exports.getSwapPartyLeaderboard = exports.openSwapDispute = exports.rateSwap = exports.confirmSwapReception = exports.confirmSwapShipping = exports.uploadSwapPhotos = exports.setSwapExchangeMode = exports.cancelSwap = exports.declineSwap = exports.createSwapTopUpCheckout = exports.acceptSwap = exports.proposeMultiSwap = exports.getActiveSwapPartyInfo = exports.ensureGeneralistZone = exports.markSavedSearchViewed = exports.toggleArticleSold = exports.toggleProductLike = exports.incrementProductView = exports.updateArticle = exports.createArticle = exports.backfillEmbeddings = exports.getSimilarProducts = exports.visualSearch = exports.consolidateChatDuplicates = exports.analyzeProductImage = void 0;
exports.checkSavedSearchNotifications = exports.expireStaleProposedSwaps = exports.updatePopularityScores = exports.cleanupSearchIndex = exports.updateGlobalStats = exports.onArticleInfoUpdated = exports.onArticleSold = exports.onArticleSoftDeleted = exports.onUserProfileUpdated = exports.onArticlePriceDropped = exports.onArticleFavorited = exports.onSwapStatusUpdated = exports.onSwapCreated = exports.sendOfferStatusNotification = exports.sendMessageNotification = exports.generateEmbeddingOnUpdate = exports.generateEmbeddingOnCreate = exports.updateShopArticlesCount = exports.updateUserStats = exports.updateSearchIndex = exports.triageReport = exports.getPendingReports = exports.suspendShop = exports.rejectShop = exports.approveShop = exports.getAutomatedDecisionLog = exports.contestAutomatedDecision = exports.notifyAffectedUsers = exports.escalatePrivacyIncidentToCAI = exports.getPrivacyIncidentsLog = exports.reportPrivacyIncident = exports.assignUsername = exports.setMarketingConsent = exports.recordSignupConsent = exports.deleteUserAccount = exports.getUserPublicProfile = exports.getUserReviews = exports.createReview = exports.refundWalletPayment = exports.payWithWallet = exports.walletWithdraw = exports.getWalletInfo = exports.activateWallet = exports.getHomeFeed = exports.recordPriceDrop = exports.getLikedSellers = exports.toggleSellerLike = exports.getNewArrivals = exports.getFeaturedSellers = exports.getPriceDrops = void 0;
exports.shipEngineWebhook = exports.stripeWebhook = exports.retentionPurge = exports.reconcileFinances = exports.retryFailedOperations = exports.sweepPendingLabels = exports.releaseHeldFunds = exports.checkShippedTracking = exports.expireOrphanedTransactions = exports.expireStaleOffers = exports.cleanupExpiredDrafts = void 0;
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
Object.defineProperty(exports, "backfillEmbeddings", { enumerable: true, get: function () { return search_1.backfillEmbeddings; } });
// Product Functions
var products_1 = require("./callable/products");
Object.defineProperty(exports, "createArticle", { enumerable: true, get: function () { return products_1.createArticle; } });
Object.defineProperty(exports, "updateArticle", { enumerable: true, get: function () { return products_1.updateArticle; } });
Object.defineProperty(exports, "incrementProductView", { enumerable: true, get: function () { return products_1.incrementProductView; } });
Object.defineProperty(exports, "toggleProductLike", { enumerable: true, get: function () { return products_1.toggleProductLike; } });
Object.defineProperty(exports, "toggleArticleSold", { enumerable: true, get: function () { return products_1.toggleArticleSold; } });
Object.defineProperty(exports, "markSavedSearchViewed", { enumerable: true, get: function () { return products_1.markSavedSearchViewed; } });
// Swap Functions
// Single permanent generalist Swap Zone (no join/leave/participants).
// cashTopUp is paid via Stripe (createSwapTopUpCheckout + swap_topup webhook).
var swaps_1 = require("./callable/swaps");
Object.defineProperty(exports, "ensureGeneralistZone", { enumerable: true, get: function () { return swaps_1.ensureGeneralistZone; } });
Object.defineProperty(exports, "getActiveSwapPartyInfo", { enumerable: true, get: function () { return swaps_1.getActiveSwapPartyInfo; } });
Object.defineProperty(exports, "proposeMultiSwap", { enumerable: true, get: function () { return swaps_1.proposeMultiSwap; } });
Object.defineProperty(exports, "acceptSwap", { enumerable: true, get: function () { return swaps_1.acceptSwap; } });
Object.defineProperty(exports, "createSwapTopUpCheckout", { enumerable: true, get: function () { return swaps_1.createSwapTopUpCheckout; } });
Object.defineProperty(exports, "declineSwap", { enumerable: true, get: function () { return swaps_1.declineSwap; } });
Object.defineProperty(exports, "cancelSwap", { enumerable: true, get: function () { return swaps_1.cancelSwap; } });
Object.defineProperty(exports, "setSwapExchangeMode", { enumerable: true, get: function () { return swaps_1.setSwapExchangeMode; } });
Object.defineProperty(exports, "uploadSwapPhotos", { enumerable: true, get: function () { return swaps_1.uploadSwapPhotos; } });
Object.defineProperty(exports, "confirmSwapShipping", { enumerable: true, get: function () { return swaps_1.confirmSwapShipping; } });
Object.defineProperty(exports, "confirmSwapReception", { enumerable: true, get: function () { return swaps_1.confirmSwapReception; } });
Object.defineProperty(exports, "rateSwap", { enumerable: true, get: function () { return swaps_1.rateSwap; } });
Object.defineProperty(exports, "openSwapDispute", { enumerable: true, get: function () { return swaps_1.openSwapDispute; } });
Object.defineProperty(exports, "getSwapPartyLeaderboard", { enumerable: true, get: function () { return swaps_1.getSwapPartyLeaderboard; } });
Object.defineProperty(exports, "addItemToPartySecure", { enumerable: true, get: function () { return swaps_1.addItemToPartySecure; } });
Object.defineProperty(exports, "removeItemFromPartySecure", { enumerable: true, get: function () { return swaps_1.removeItemFromPartySecure; } });
// Payment & Shipping Functions
var payments_1 = require("./callable/payments");
Object.defineProperty(exports, "getShippingEstimate", { enumerable: true, get: function () { return payments_1.getShippingEstimate; } });
Object.defineProperty(exports, "getServiceFee", { enumerable: true, get: function () { return payments_1.getServiceFee; } });
Object.defineProperty(exports, "createTransaction", { enumerable: true, get: function () { return payments_1.createTransaction; } });
Object.defineProperty(exports, "createStripeCheckout", { enumerable: true, get: function () { return payments_1.createStripeCheckout; } });
Object.defineProperty(exports, "createStripeConnectAccount", { enumerable: true, get: function () { return payments_1.createStripeConnectAccount; } });
Object.defineProperty(exports, "addBankAccount", { enumerable: true, get: function () { return payments_1.addBankAccount; } });
Object.defineProperty(exports, "getStripeAccountStatus", { enumerable: true, get: function () { return payments_1.getStripeAccountStatus; } });
Object.defineProperty(exports, "findPickupPoints", { enumerable: true, get: function () { return payments_1.findPickupPoints; } });
Object.defineProperty(exports, "checkTrackingStatus", { enumerable: true, get: function () { return payments_1.checkTrackingStatus; } });
Object.defineProperty(exports, "cancelPendingTransaction", { enumerable: true, get: function () { return payments_1.cancelPendingTransaction; } });
Object.defineProperty(exports, "acceptMeetupOffer", { enumerable: true, get: function () { return payments_1.acceptMeetupOffer; } });
Object.defineProperty(exports, "confirmMeetupTransaction", { enumerable: true, get: function () { return payments_1.confirmMeetupTransaction; } });
Object.defineProperty(exports, "completeMeetupTransaction", { enumerable: true, get: function () { return payments_1.completeMeetupTransaction; } });
Object.defineProperty(exports, "reportMeetupNoShow", { enumerable: true, get: function () { return payments_1.reportMeetupNoShow; } });
Object.defineProperty(exports, "adminRefundTransaction", { enumerable: true, get: function () { return payments_1.adminRefundTransaction; } });
// Buyer Recourse Functions (anti-fraud refund & dispute & return)
var recourse_1 = require("./callable/recourse");
Object.defineProperty(exports, "requestRefund", { enumerable: true, get: function () { return recourse_1.requestRefund; } });
Object.defineProperty(exports, "reportTransactionProblem", { enumerable: true, get: function () { return recourse_1.reportTransactionProblem; } });
Object.defineProperty(exports, "requestReturn", { enumerable: true, get: function () { return recourse_1.requestReturn; } });
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
// Wallet Functions
var wallet_1 = require("./callable/wallet");
Object.defineProperty(exports, "activateWallet", { enumerable: true, get: function () { return wallet_1.activateWallet; } });
Object.defineProperty(exports, "getWalletInfo", { enumerable: true, get: function () { return wallet_1.getWalletInfo; } });
Object.defineProperty(exports, "walletWithdraw", { enumerable: true, get: function () { return wallet_1.walletWithdraw; } });
Object.defineProperty(exports, "payWithWallet", { enumerable: true, get: function () { return wallet_1.payWithWallet; } });
Object.defineProperty(exports, "refundWalletPayment", { enumerable: true, get: function () { return wallet_1.refundWalletPayment; } });
// Review Functions
var reviews_1 = require("./callable/reviews");
Object.defineProperty(exports, "createReview", { enumerable: true, get: function () { return reviews_1.createReview; } });
Object.defineProperty(exports, "getUserReviews", { enumerable: true, get: function () { return reviews_1.getUserReviews; } });
Object.defineProperty(exports, "getUserPublicProfile", { enumerable: true, get: function () { return reviews_1.getUserPublicProfile; } });
// User Account Functions
var users_1 = require("./callable/users");
Object.defineProperty(exports, "deleteUserAccount", { enumerable: true, get: function () { return users_1.deleteUserAccount; } });
// Consent & Age-Gate Functions
// setMarketingConsent: retrait/octroi du consentement marketing — journalisé
// append-only (preuve Loi 25 art. 14 / LCAP) ET appliqué serveur (coupe les
// prefs notifications marketing relues par les triggers).
var consent_1 = require("./callable/consent");
Object.defineProperty(exports, "recordSignupConsent", { enumerable: true, get: function () { return consent_1.recordSignupConsent; } });
Object.defineProperty(exports, "setMarketingConsent", { enumerable: true, get: function () { return consent_1.setMarketingConsent; } });
// Username assignment — génère + réserve + persiste le @handle unique, immuable,
// dérivé du displayName, atomiquement (runTransaction). Idempotent: appelable
// après la création du doc users pour les 3 providers (email/Google/Apple).
var username_1 = require("./callable/username");
Object.defineProperty(exports, "assignUsername", { enumerable: true, get: function () { return username_1.assignUsername; } });
// Privacy Incident Register Functions (admin-only; Loi 25 / RGPD breach log)
var privacyIncidents_1 = require("./callable/privacyIncidents");
Object.defineProperty(exports, "reportPrivacyIncident", { enumerable: true, get: function () { return privacyIncidents_1.reportPrivacyIncident; } });
Object.defineProperty(exports, "getPrivacyIncidentsLog", { enumerable: true, get: function () { return privacyIncidents_1.getPrivacyIncidentsLog; } });
Object.defineProperty(exports, "escalatePrivacyIncidentToCAI", { enumerable: true, get: function () { return privacyIncidents_1.escalatePrivacyIncidentToCAI; } });
Object.defineProperty(exports, "notifyAffectedUsers", { enumerable: true, get: function () { return privacyIncidents_1.notifyAffectedUsers; } });
// Automated-decision transparency & contestation (Loi 25, art. 12.1)
// contestAutomatedDecision: party opens a human-review request (reverses NOTHING).
// getAutomatedDecisionLog: party reads the transparent log for one transaction.
var automatedDecisions_1 = require("./callable/automatedDecisions");
Object.defineProperty(exports, "contestAutomatedDecision", { enumerable: true, get: function () { return automatedDecisions_1.contestAutomatedDecision; } });
Object.defineProperty(exports, "getAutomatedDecisionLog", { enumerable: true, get: function () { return automatedDecisions_1.getAutomatedDecisionLog; } });
// Shop & Report Moderation (admin-only; B2/B3). Shop status + report lifecycle
// are admin-owned fields LOCKED by firestore.rules, so they mutate via these
// Cloud Functions (Admin SDK bypasses rules) under runTransaction.
// approve/reject/suspendShop set the shop validation status; getPendingReports
// + triageReport process the reports collection.
var shopModeration_1 = require("./callable/shopModeration");
Object.defineProperty(exports, "approveShop", { enumerable: true, get: function () { return shopModeration_1.approveShop; } });
Object.defineProperty(exports, "rejectShop", { enumerable: true, get: function () { return shopModeration_1.rejectShop; } });
Object.defineProperty(exports, "suspendShop", { enumerable: true, get: function () { return shopModeration_1.suspendShop; } });
Object.defineProperty(exports, "getPendingReports", { enumerable: true, get: function () { return shopModeration_1.getPendingReports; } });
Object.defineProperty(exports, "triageReport", { enumerable: true, get: function () { return shopModeration_1.triageReport; } });
// ============================================================
// TRIGGER FUNCTIONS (onDocument*)
// ============================================================
// Product Triggers
var products_2 = require("./triggers/products");
Object.defineProperty(exports, "updateSearchIndex", { enumerable: true, get: function () { return products_2.updateSearchIndex; } });
Object.defineProperty(exports, "updateUserStats", { enumerable: true, get: function () { return products_2.updateUserStats; } });
Object.defineProperty(exports, "updateShopArticlesCount", { enumerable: true, get: function () { return products_2.updateShopArticlesCount; } });
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
Object.defineProperty(exports, "onArticleInfoUpdated", { enumerable: true, get: function () { return articles_1.onArticleInfoUpdated; } });
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
// updateSwapPartyStatuses + sendSwapZoneReminders are OBSOLETE with the single
// permanent generalist Swap Zone (no time window) and are no longer exported.
// expireStaleProposedSwaps replaces cleanupEndedParty: it frees items locked by
// proposed swaps that were never accepted/declined (7-day expiry).
var swaps_3 = require("./scheduled/swaps");
Object.defineProperty(exports, "expireStaleProposedSwaps", { enumerable: true, get: function () { return swaps_3.expireStaleProposedSwaps; } });
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
// Release held funds (hourly: heldBalance -> balance after 7-day dispute window)
var releaseHeldFunds_1 = require("./scheduled/releaseHeldFunds");
Object.defineProperty(exports, "releaseHeldFunds", { enumerable: true, get: function () { return releaseHeldFunds_1.releaseHeldFunds; } });
// Sweep pending shipping labels (hourly: re-rate + retry createLabel; credit
// seller on success, refund buyer after N failed attempts)
var sweepPendingLabels_1 = require("./scheduled/sweepPendingLabels");
Object.defineProperty(exports, "sweepPendingLabels", { enumerable: true, get: function () { return sweepPendingLabels_1.sweepPendingLabels; } });
// Dead-letter replay (every 30min: re-drive failed_operations with backoff;
// mark resolved/exhausted — covers refunds, transfer/payout reversals, mismatch)
var retryFailedOperations_1 = require("./scheduled/retryFailedOperations");
Object.defineProperty(exports, "retryFailedOperations", { enumerable: true, get: function () { return retryFailedOperations_1.retryFailedOperations; } });
// Reconciliation (every 6h: lost PI/payout webhooks + wallet invariant checks;
// CRITICAL log + dead-letter on divergence)
var reconcile_1 = require("./scheduled/reconcile");
Object.defineProperty(exports, "reconcileFinances", { enumerable: true, get: function () { return reconcile_1.reconcileFinances; } });
// Data-retention purge (daily: hard-delete stale personal data — inactive
// articles > 3y, guest_preferences > 90d, notifications > 180d, searchHistory
// > 12mo. NEVER touches transactions — 7-year legal retention. Loi 25 / RGPD)
var retentionPurge_1 = require("./scheduled/retentionPurge");
Object.defineProperty(exports, "retentionPurge", { enumerable: true, get: function () { return retentionPurge_1.retentionPurge; } });
// ============================================================
// HTTP ENDPOINTS (webhooks)
// ============================================================
// Stripe Webhook (payment confirmation + Connect account updates)
var webhooks_1 = require("./http/webhooks");
Object.defineProperty(exports, "stripeWebhook", { enumerable: true, get: function () { return webhooks_1.stripeWebhook; } });
// ShipEngine tracking webhook (primary tracking path; poller is the safety net)
var shipEngineWebhook_1 = require("./http/shipEngineWebhook");
Object.defineProperty(exports, "shipEngineWebhook", { enumerable: true, get: function () { return shipEngineWebhook_1.shipEngineWebhook; } });
//# sourceMappingURL=index.js.map