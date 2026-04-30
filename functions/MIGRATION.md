# 🚀 Firebase Functions V7 Migration Tracker

**Date**: 2026-01-25
**Auteur**: Migration automatisée
**Objectif**: Migrer vers Firebase Functions v7.0.3, firebase-admin v13.6.0, @google/genai v1.37.0

---

## 📊 Versions

| Package | Avant | Après | Status |
|---------|-------|-------|--------|
| `firebase-functions` | ^6.3.0 | ^7.0.3 | ✅ DONE |
| `firebase-admin` | ^13.0.0 | ^13.6.0 | ✅ DONE |
| `@google/genai` | ^1.0.0 | ^1.37.0 | ✅ DONE |
| Gemini Model | gemini-2.5-flash | gemini-2.5-flash | ✅ (keeping stable) |

---

## 📁 Nouvelle Structure de Fichiers

```
functions/src/
├── index.ts                    # ✅ Entry point - re-exports all functions
├── config/
│   ├── firebase.ts             # ✅ Firebase admin init
│   ├── secrets.ts              # ✅ Secret definitions
│   ├── gemini.ts               # ✅ Gemini AI config & client
│   ├── stripe.ts               # ✅ Stripe client init
│   ├── shippo.ts               # ⚠️ Deprecated - redirects to intelcom.ts
│   └── intelcom.ts             # ✅ Intelcom (Dragonfly) client init
├── utils/
│   ├── geohash.ts              # ✅ Geohash encoding
│   ├── search.ts               # ✅ Search keywords generation
│   ├── debounce.ts             # ✅ Debounce utility
│   └── notifications.ts        # ✅ Push notification helpers
├── services/
│   ├── brands.ts               # ✅ Brand matching logic
│   └── ai.ts                   # ✅ AI services (embeddings, image analysis)
├── triggers/
│   ├── products.ts             # ✅ Product triggers (search index, user stats)
│   ├── articles.ts             # ✅ Article embedding trigger
│   ├── messages.ts             # ✅ Message notifications
│   ├── swaps.ts                # ✅ Swap triggers
│   └── favorites.ts            # ✅ Favorite triggers
├── scheduled/
│   ├── stats.ts                # ✅ Global stats update
│   ├── cleanup.ts              # ✅ Search index cleanup
│   ├── popularity.ts           # ✅ Popularity scores update
│   ├── swaps.ts                # ✅ Swap party status updates
│   └── savedSearches.ts        # ✅ Saved search notifications
├── callable/
│   ├── products.ts             # ✅ Product views, likes
│   ├── ai.ts                   # ✅ AI analysis functions
│   ├── search.ts               # ✅ Visual search, similar products
│   ├── payments.ts             # ✅ Stripe payment intents, shipping
│   ├── swaps.ts                # ✅ Swap party functions
│   ├── moments.ts              # ✅ Moments functions
│   └── style.ts                # ✅ Style profile generation
└── http/
    └── webhooks.ts             # ✅ Stripe webhook
```

---

## ✅ Migration Checklist

### Phase 1: Package Updates
- [x] 1.1 Update `package.json` dependencies
- [x] 1.2 Run `npm install`
- [x] 1.3 Fix any peer dependency issues

### Phase 2: Syntax Migration (index.ts)
- [x] 2.1 Add missing imports (`onRequest`)
- [x] 2.2 Replace `functions.https.HttpsError` → `HttpsError`
- [x] 2.3 Replace `functions.https.onCall` → `onCall`
- [x] 2.4 Replace `functions.https.onRequest` → `onRequest`
- [x] 2.5 Replace `functions.firestore.document().onWrite` → `onDocumentWritten`
- [x] 2.6 Replace `functions.firestore.document().onCreate` → `onDocumentCreated`
- [x] 2.7 Replace `functions.firestore.document().onUpdate` → `onDocumentUpdated`
- [x] 2.8 Replace `functions.pubsub.schedule().onRun` → `onSchedule`
- [x] 2.9 Update callback signatures (`data, context` → `request`)

### Phase 3: Model Updates
- [x] 3.1 Keep Gemini vision model at `gemini-2.5-flash` (stable)
- [x] 3.2 Using `gemini-embedding-001` for embeddings (3072 dims)

### Phase 4: File Split
- [x] 4.1 Create config/ directory
- [x] 4.2 Create utils/ directory
- [x] 4.3 Create services/ directory
- [x] 4.4 Create triggers/ directory
- [x] 4.5 Create scheduled/ directory
- [x] 4.6 Create callable/ directory
- [x] 4.7 Create http/ directory
- [x] 4.8 Update index.ts to re-export

### Phase 5: Testing & Deployment
- [x] 5.1 Run `npm run build` ✅ BUILD SUCCESSFUL
- [ ] 5.2 Test locally with emulators
- [ ] 5.3 Deploy to Firebase

---

## 🔄 Breaking Changes Applied

1. **Node.js 20** - Using Node.js 20 runtime ✅
2. **defineSecret** - Using params module for secrets ✅
3. **v2 API syntax** - All functions use v2 imports ✅
4. **TypeScript strict** - All types properly handled ✅

---

## 🎯 Functions Migrated

| Function Name | Type | File | Status |
|--------------|------|------|--------|
| `updateSearchIndex` | onDocumentWritten | triggers/products.ts | ✅ |
| `updateUserStats` | onDocumentWritten | triggers/products.ts | ✅ |
| `generateArticleEmbedding` | onDocumentWritten | triggers/articles.ts | ✅ |
| `sendMessageNotification` | onDocumentCreated | triggers/messages.ts | ✅ |
| `sendOfferStatusNotification` | onDocumentUpdated | triggers/messages.ts | ✅ |
| `onSwapCreated` | onDocumentCreated | triggers/swaps.ts | ✅ |
| `onSwapStatusUpdated` | onDocumentUpdated | triggers/swaps.ts | ✅ |
| `onArticleFavorited` | onDocumentUpdated | triggers/favorites.ts | ✅ |
| `onArticlePriceDropped` | onDocumentUpdated | triggers/favorites.ts | ✅ |
| `updateGlobalStats` | onSchedule | scheduled/stats.ts | ✅ |
| `cleanupSearchIndex` | onSchedule | scheduled/cleanup.ts | ✅ |
| `updatePopularityScores` | onSchedule | scheduled/popularity.ts | ✅ |
| `updateSwapPartyStatuses` | onSchedule | scheduled/swaps.ts | ✅ |
| `sendSwapZoneReminders` | onSchedule | scheduled/swaps.ts | ✅ |
| `checkSavedSearchNotifications` | onSchedule | scheduled/savedSearches.ts | ✅ |
| `incrementProductView` | onCall | callable/products.ts | ✅ |
| `toggleProductLike` | onCall | callable/products.ts | ✅ |
| `markSavedSearchViewed` | onCall | callable/products.ts | ✅ |
| `analyzeProductImage` | onCall | callable/ai.ts | ✅ |
| `regenerateAllEmbeddings` | onCall | callable/ai.ts | ✅ |
| `visualSearch` | onCall | callable/search.ts | ✅ |
| `getSimilarProducts` | onCall | callable/search.ts | ✅ |
| `getShippingEstimate` | onCall | callable/payments.ts | ✅ |
| `createPaymentIntent` | onCall | callable/payments.ts | ✅ |
| `checkTrackingStatus` | onCall | callable/payments.ts | ✅ |
| `getActiveSwapPartyInfo` | onCall | callable/swaps.ts | ✅ |
| `getSwapPartyLeaderboard` | onCall | callable/swaps.ts | ✅ |
| `getActiveMoments` | onCall | callable/moments.ts | ✅ |
| `getMomentProducts` | onCall | callable/moments.ts | ✅ |
| `generateStyleProfile` | onCall | callable/style.ts | ✅ |
| `stripeWebhook` | onRequest | http/webhooks.ts | ✅ |

**Total: 31/31 functions migrated**

---

## 🚦 Current Progress

- **Completed**: 31/31 functions ✅
- **Build Status**: ✅ SUCCESSFUL
- **Ready for**: Local testing & deployment

Last Updated: 2026-01-25
