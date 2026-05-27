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

// ============================================================
// CALLABLE FUNCTIONS (onCall)
// ============================================================

// AI Functions
export { analyzeProductImage } from './callable/ai';

// Chat admin functions
export { consolidateChatDuplicates } from './callable/chats';

// Visual Search & Similar Products
export { visualSearch, getSimilarProducts } from './callable/search';

// Product Functions
export { createArticle, updateArticle, incrementProductView, toggleProductLike, toggleArticleSold, markSavedSearchViewed } from './callable/products';

// Swap Functions
export {
  proposeMultiSwap,
  acceptSwap,
  declineSwap,
  cancelSwap,
  setSwapExchangeMode,
  uploadSwapPhotos,
  confirmSwapShipping,
  confirmSwapReception,
  rateSwap,
  openSwapDispute,
  getActiveSwapPartyInfo,
  getSwapPartyLeaderboard,
  joinSwapPartySecure,
  leaveSwapPartySecure,
  addItemToPartySecure,
  removeItemFromPartySecure,
} from './callable/swaps';

// Payment & Shipping Functions
export {
  getShippingEstimate,
  getServiceFee,
  createTransaction,
  createStripeCheckout,
  createStripeConnectAccount,
  addBankAccount,
  getStripeAccountStatus,
  findPickupPoints,
  checkTrackingStatus,
  requestWithdrawal,
  cancelPendingTransaction,
  completeMeetupTransaction,
} from './callable/payments';

// Moments Functions
export { getActiveMoments, getMomentProducts } from './callable/moments';

// Style Functions
export { generateStyleProfile } from './callable/style';

// Onboarding Functions
export { saveOnboardingPreferences } from './callable/onboarding';

// Home Functions
export {
  // Individual section callables (preferred)
  getTrendingBrands,
  getPriceDrops,
  getFeaturedSellers,
  getNewArrivals,
  // Seller interactions
  toggleSellerLike,
  getLikedSellers,
  recordPriceDrop,
  // Legacy combined feed
  getHomeFeed,
} from './callable/home';

// Wallet Functions
export { activateWallet, getWalletInfo, walletWithdraw, payWithWallet, refundWalletPayment } from './callable/wallet';

// Review Functions
export { createReview, getUserReviews, getUserPublicProfile } from './callable/reviews';

// User Account Functions
export { deleteUserAccount } from './callable/users';

// ============================================================
// TRIGGER FUNCTIONS (onDocument*)
// ============================================================

// Product Triggers
export { updateSearchIndex, updateUserStats } from './triggers/products';

// Embedding Triggers
export { generateEmbeddingOnCreate, generateEmbeddingOnUpdate } from './triggers/embeddings';

// Message Triggers
export { sendMessageNotification, sendOfferStatusNotification } from './triggers/messages';

// Swap Triggers
export { onSwapCreated, onSwapStatusUpdated } from './triggers/swaps';

// Favorite Triggers
export { onArticleFavorited, onArticlePriceDropped } from './triggers/favorites';

// User Profile Triggers
export { onUserProfileUpdated } from './triggers/users';

// Article Triggers
export { onArticleSoftDeleted, onArticleSold, onArticleInfoUpdated } from './triggers/articles';

// ============================================================
// SCHEDULED FUNCTIONS (pubsub)
// ============================================================

// Stats
export { updateGlobalStats } from './scheduled/stats';

// Cleanup
export { cleanupSearchIndex } from './scheduled/cleanup';

// Popularity
export { updatePopularityScores } from './scheduled/popularity';

// Swaps
export { updateSwapPartyStatuses, sendSwapZoneReminders } from './scheduled/swaps';

// Saved Searches
export { checkSavedSearchNotifications } from './scheduled/savedSearches';

// Draft image cleanup
export { cleanupExpiredDrafts } from './scheduled/cleanupDrafts';

// Offer expiration (hourly cleanup of stale pending offers)
export { expireStaleOffers } from './scheduled/offerExpiration';

// Transaction expiration (meetup_pending 48h + pending_payment 1h + paid-not-shipped 7d)
export { expireOrphanedTransactions } from './scheduled/transactionExpiration';

// Tracking check (poll ShipEngine every 6h for shipped transactions)
export { checkShippedTracking } from './scheduled/trackingCheck';

// ============================================================
// HTTP ENDPOINTS (webhooks)
// ============================================================

// Stripe Webhook (payment confirmation + Connect account updates)
export { stripeWebhook } from './http/webhooks';
