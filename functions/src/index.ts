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

import { setGlobalOptions } from 'firebase-functions/v2/options';
import { isProductionRuntime, requireRuntimeProjectId } from './config/runtimeEnvironment';

// A phase-1 deployment uses its independently qualified runtime and control.
// The isolated staging profile supplies this value only for selected functions;
// ordinary Dev keeps its existing commerce-test runtime.
const phase1Runtime = process.env.SECONDE_PHASE1_RUNTIME_SERVICE_ACCOUNT;
const runtimeProject = requireRuntimeProjectId();
if (phase1Runtime && !new RegExp(`^[a-z][a-z0-9-]{4,28}@${runtimeProject.split('.').join('\\.')}\\.iam\\.gserviceaccount\\.com$`).test(phase1Runtime)) {
  throw new Error('Le compte de service phase 1 doit appartenir au projet Firebase exact.');
}
if (phase1Runtime || !isProductionRuntime()) setGlobalOptions({
  ...(!isProductionRuntime() ? {maxInstances: 2} : {}),
  serviceAccount: phase1Runtime ?? `seconde-dev-runtime@${runtimeProject}.iam.gserviceaccount.com`,
});

// ============================================================
// CALLABLE FUNCTIONS (onCall)
// ============================================================

// AI Functions
export { analyzeProductImage } from './callable/ai';

// Chat admin functions
export { consolidateChatDuplicates } from './callable/chats';

// Messages « système » d'une conversation — rendus serveur à partir d'un
// catalogue fermé. La création cliente est fermée par les règles : un
// participant pouvait sinon forger un message de la plateforme au contenu libre.
export { postChatSystemMessage } from './callable/chatSystemMessage';

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
  resolveSwapDispute,
  getSwapPartyLeaderboard,
  addItemToPartySecure,
  removeItemFromPartySecure,
} from './callable/swaps';

// Payment & Shipping Functions
// Explicit participant tools for the isolated Dev transport simulation.
export { devAdvanceShipping } from './callable/devCommerce';
export {
  getArticleShippingParcel,
  quoteShippingPurchase,
  setArticleShippingParcel,
  getShippingEstimate,
  getServiceFee,
  createTransaction,
  createStripeCheckout,
  confirmStripeCheckout,
  retireLegacyStripeCheckout,
  createStripeConnectAccount,
  addBankAccount,
  uploadStripeIdentityDocument,
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
  retryPurchaseRefund,
  closeMeetupNoShow,
  inspectPaymentCaptureAnomaly,
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
// The inventory pilot and its Sandbox secret belong only to Seconde Dev.
// Do not load the module during production discovery: defineSecret registers
// its parameter at import time even for a narrowly selected deployment.
const squarePilot = !isProductionRuntime() && !phase1Runtime
  ? require('./callable/squareInventoryPilot') as typeof import('./callable/squareInventoryPilot')
  : undefined;
export const squareInventoryPilot = squarePilot?.squareInventoryPilot;
export const squareInventoryOAuthCallback = squarePilot?.squareInventoryOAuthCallback;

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
// Additive phase-1 contracts. Preserve deployed legacy names explicitly;
// aliases do not by themselves certify coexistence on the same native data.
export { createArticle as createArticleV2, updateArticle as updateArticleV2, toggleArticleSold as toggleArticleSoldV2, incrementProductView as incrementProductViewV2, toggleProductLike as toggleProductLikeV2, markSavedSearchViewed as markSavedSearchViewedV2 } from './callable/products';
export { recordSignupConsent as recordSignupConsentV2, setMarketingConsent as setMarketingConsentV2 } from './callable/consent';
export { declareSellerActivity as declareSellerActivityV2 } from './callable/eligibility';
export { sendMeetupProposal as sendMeetupProposalV2, rejectMeetupProposal as rejectMeetupProposalV2 } from './callable/offers';
export { acceptMeetupOffer as acceptMeetupOfferV2, confirmMeetupTransaction as confirmMeetupTransactionV2, completeMeetupTransaction as completeMeetupTransactionV2, reportMeetupNoShow as reportMeetupNoShowV2, closeMeetupNoShow as closeMeetupNoShowV2, cancelPendingTransaction as cancelPendingTransactionV2, sellerCancelTransaction as sellerCancelTransactionV2 } from './callable/payments';
export { setSwapExchangeMode as setSwapExchangeModeV2, uploadSwapPhotos as uploadSwapPhotosV2, confirmSwapShipping as confirmSwapShippingV2, ensureGeneralistZone as ensureGeneralistZoneV2, getActiveSwapPartyInfo as getActiveSwapPartyInfoV2, proposeMultiSwap as proposeMultiSwapV2, acceptSwap as acceptSwapV2, declineSwap as declineSwapV2, cancelSwap as cancelSwapV2, confirmSwapReception as confirmSwapReceptionV2, rateSwap as rateSwapV2, addItemToPartySecure as addItemToPartySecureV2, removeItemFromPartySecure as removeItemFromPartySecureV2 } from './callable/swaps';
export { createReview as createReviewV2 } from './callable/reviews';
export { deleteUserAccount as deleteUserAccountV2 } from './callable/users';
export {startAccountErasureAppleWeb,prepareAccountErasureAppleWeb,completeAccountErasureAppleWeb,
  accountErasureAppleWebCallback} from './callable/accountErasureAppleWeb';
export {manageAccountErasure} from './callable/accountErasureOperations';
export {continueAccountErasure} from './triggers/accountErasure';
export {eraseLateAccountStorage} from './triggers/accountErasureStorage';
export {resumeAccountErasures} from './scheduled/accountErasure';
export {getStripeAccountStatusPhase1,checkTrackingStatusPhase1} from './callable/phase1ReadPorts';
export { submitReport as submitReportV2, triageReport as triageReportV2, getPendingReports as getPendingReportsV2 } from './callable/shopModeration';
export {expirePhase1LocalProposals} from './scheduled/swaps';
export {expirePhase1LocalOffers} from './scheduled/phase1Offers';
export { getMyEligibility, declareSellerActivity, requestEligibilityReview, addEligibilityReviewDetails,
  getEligibilityReview, listMyEligibilityReviews, listAdminEligibilityReviews, getAdminEligibilityReview,
  flagEligibilityForReview, decideEligibilityReview } from './callable/eligibility';

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

export { deliverOperationalNotices } from './utils/notifications';
export { dispatchOperationalNoticeOnCreate } from './utils/notifications';
export { notifyReturnDelivered } from './utils/notifications';

// Authenticated privacy withdrawal and private evidence readers.
export { withdrawArticlePrivacy, readPrivateArticleEvidence, readPrivateArticleMedia } from './callable/articlePrivacy';
export { readPrivateProfileMedia } from './callable/profilePrivacy';

export { commandSupportRequest, readSupportRequests, administerSupportRequest } from './callable/supportRequests';
export { secureMyAccount } from './callable/accountSecurity';
export { accountAccessIntake } from './callable/accountAccessIntake';
export { declareShippingReceipt } from './callable/shippingReceiptDeclaration';

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

// Paid Shop Tier encashment (F134). purchaseShopTier creates a direct platform
// charge PaymentIntent for a pro/premium forfait; the webhook (shop_tier branch)
// stamps tier + tierPaidUntil on the shop AFTER payment + a shop_tier_revenue
// platform_ledger entry. tier/tierPaidUntil are CF-only (firestore.rules).
export { purchaseShopTier } from './callable/shopTier';

// ============================================================
// TRIGGER FUNCTIONS (onDocument*)
// ============================================================

// Product Triggers
export { updateSearchIndex, updateUserStats, updateShopArticlesCount, updateSellerArticlesCount } from './triggers/products';

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
// expireStalePostAcceptanceSwaps (F51/F52): unwinds money-bearing swaps stuck in
// accepted/photos_pending/shipping after 14d — refunds the top-up + frees items.
// alertAgingDisputes (B9): ops visibility on disputed swaps/transactions stuck >5d
// awaiting admin resolution (no auto-decide; idempotent admin_alert via stamp).
export {
  expireStaleProposedSwaps,
  expireStalePostAcceptanceSwaps,
  alertAgingDisputes,
} from './scheduled/swaps';

// Saved Searches
export { checkSavedSearchNotifications } from './scheduled/savedSearches';
export { checkExpoPushReceipts } from './scheduled/expoPushReceipts';

// Draft image cleanup
export { cleanupExpiredDrafts } from './scheduled/cleanupDrafts';

// Offer expiration (hourly cleanup of stale pending offers + accepted-unconsumed)
export { expireStaleOffers, expireStaleAcceptedOffers } from './scheduled/offerExpiration';

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

// Server-authoritative, atomic meetup negotiation.
export { sendMeetupProposal, rejectMeetupProposal } from './callable/offers';
export { sendShippingOffer, respondShippingOffer } from './callable/shippingOffers';
export { registerDevPushDestination } from './callable/devPush';
