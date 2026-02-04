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
 * - /config       - Firebase, Stripe, Shippo, Gemini initialization
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

// Visual Search & Similar Products
export { visualSearch, getSimilarProducts } from './callable/search';

// Product Functions
export { incrementProductView, toggleProductLike, markSavedSearchViewed } from './callable/products';

// Swap Functions
export { getActiveSwapPartyInfo, getSwapPartyLeaderboard } from './callable/swaps';

// Payment Functions
export { getShippingEstimate, createPaymentIntent, checkTrackingStatus } from './callable/payments';

// Moments Functions
export { getActiveMoments, getMomentProducts } from './callable/moments';

// Style Functions
export { generateStyleProfile } from './callable/style';

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

// ============================================================
// HTTP ENDPOINTS (webhooks)
// ============================================================

// Stripe Webhook
export { stripeWebhook } from './http/webhooks';
