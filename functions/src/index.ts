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
export { visualSearch, getSimilarProducts, backfillEmbeddings } from './callable/search';

// Product Functions
export { createArticle, updateArticle, incrementProductView, toggleProductLike, toggleArticleSold, markSavedSearchViewed } from './callable/products';

// Swap Functions
// Single permanent generalist Swap Zone (no join/leave/participants).
// cashTopUp is paid via Stripe (createSwapTopUpCheckout + swap_topup webhook).
export {
  ensureGeneralistZone,
  getActiveSwapPartyInfo,
  proposeMultiSwap,
  acceptSwap,
  createSwapTopUpCheckout,
  declineSwap,
  cancelSwap,
  setSwapExchangeMode,
  uploadSwapPhotos,
  confirmSwapShipping,
  confirmSwapReception,
  rateSwap,
  openSwapDispute,
  getSwapPartyLeaderboard,
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
  cancelPendingTransaction,
  sellerCancelTransaction,
  acceptMeetupOffer,
  confirmMeetupTransaction,
  completeMeetupTransaction,
  reportMeetupNoShow,
  adminRefundTransaction,
  resolveDispute,
} from './callable/payments';

// Buyer Recourse Functions (anti-fraud refund & dispute & return)
export {
  requestRefund,
  reportTransactionProblem,
  requestReturn,
} from './callable/recourse';

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

// Consent & Age-Gate Functions
// setMarketingConsent: retrait/octroi du consentement marketing — journalisé
// append-only (preuve Loi 25 art. 14 / LCAP) ET appliqué serveur (coupe les
// prefs notifications marketing relues par les triggers).
export { recordSignupConsent, setMarketingConsent } from './callable/consent';

// Username assignment — génère + réserve + persiste le @handle unique, immuable,
// dérivé du displayName, atomiquement (runTransaction). Idempotent: appelable
// après la création du doc users pour les 3 providers (email/Google/Apple).
// Filet de rattrapage legacy (auto-dérivation) — le pseudo CHOISI passe par
// checkUsernameAvailability (probe) + recordSignupConsent (réservation au submit).
export { assignUsername } from './callable/username';

// Username availability — probe lecture seule (debounce client ~350ms) pour la
// route "choisis ton @pseudo". Ne réserve RIEN ; la réservation atomique a lieu
// au submit dans recordSignupConsent. Anti-énumération: ne révèle jamais le uid.
export { checkUsernameAvailability } from './callable/checkUsernameAvailability';

// Privacy Incident Register Functions (admin-only; Loi 25 / RGPD breach log)
export {
  reportPrivacyIncident,
  getPrivacyIncidentsLog,
  escalatePrivacyIncidentToCAI,
  notifyAffectedUsers,
} from './callable/privacyIncidents';

// Automated-decision transparency & contestation (Loi 25, art. 12.1)
// contestAutomatedDecision: party opens a human-review request (reverses NOTHING).
// getAutomatedDecisionLog: party reads the transparent log for one transaction.
export {
  contestAutomatedDecision,
  getAutomatedDecisionLog,
} from './callable/automatedDecisions';

// Shop & Report Moderation (admin-only; B2/B3). Shop status + report lifecycle
// are admin-owned fields LOCKED by firestore.rules, so they mutate via these
// Cloud Functions (Admin SDK bypasses rules) under runTransaction.
// approve/reject/suspendShop set the shop validation status; getPendingReports
// + triageReport process the reports collection. submitReport (B7) creates a
// report with server-side anti-spam dedup (1 per reporter/target/type).
export {
  approveShop,
  rejectShop,
  suspendShop,
  getPendingReports,
  triageReport,
  submitReport,
} from './callable/shopModeration';

// ============================================================
// TRIGGER FUNCTIONS (onDocument*)
// ============================================================

// Product Triggers
export { updateSearchIndex, updateUserStats, updateShopArticlesCount } from './triggers/products';

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
// updateSwapPartyStatuses + sendSwapZoneReminders are OBSOLETE with the single
// permanent generalist Swap Zone (no time window) and are no longer exported.
// expireStaleProposedSwaps replaces cleanupEndedParty: it frees items locked by
// proposed swaps that were never accepted/declined (7-day expiry).
export { expireStaleProposedSwaps } from './scheduled/swaps';

// Saved Searches
export { checkSavedSearchNotifications } from './scheduled/savedSearches';

// Draft image cleanup
export { cleanupExpiredDrafts } from './scheduled/cleanupDrafts';

// Offer expiration (hourly cleanup of stale pending offers)
export { expireStaleOffers } from './scheduled/offerExpiration';

// Transaction expiration (meetup_pending 48h + pending_payment 1h + paid-not-shipped 7d)
export { expireOrphanedTransactions } from './scheduled/transactionExpiration';

// Tracking check (poll ShipEngine every 12h for shipped transactions — the 12h
// safety-net poller covering missed/undelivered ShipEngine webhooks; both legs)
export { checkShippedTracking } from './scheduled/trackingCheck';

// Release held funds (hourly: heldBalance -> balance after 7-day dispute window)
export { releaseHeldFunds } from './scheduled/releaseHeldFunds';

// Sweep pending shipping labels (hourly: re-rate + retry createLabel; credit
// seller on success, refund buyer after N failed attempts)
export { sweepPendingLabels } from './scheduled/sweepPendingLabels';

// Dead-letter replay (every 30min: re-drive failed_operations with backoff;
// mark resolved/exhausted — covers refunds, transfer/payout reversals, mismatch)
export { retryFailedOperations } from './scheduled/retryFailedOperations';

// Reconciliation (every 6h: lost PI/payout webhooks + wallet invariant checks;
// CRITICAL log + dead-letter on divergence)
export { reconcileFinances } from './scheduled/reconcile';

// Data-retention purge (daily: hard-delete stale personal data — inactive
// articles > 3y, guest_preferences > 90d, notifications > 180d, searchHistory
// > 12mo. NEVER touches transactions — 7-year legal retention. Loi 25 / RGPD)
export { retentionPurge } from './scheduled/retentionPurge';

// ============================================================
// HTTP ENDPOINTS (webhooks)
// ============================================================

// Stripe Webhook (payment confirmation + Connect account updates)
export { stripeWebhook } from './http/webhooks';

// ShipEngine tracking webhook (intended primary tracking path once deployed +
// registered with ShipEngine; until then the every-12h poller above is the
// de-facto path and remains the safety net for missed webhooks). Requires the
// SHIPENGINE_WEBHOOK_SECRET secret and manual endpoint registration in ShipEngine.
export { shipEngineWebhook } from './http/shipEngineWebhook';
