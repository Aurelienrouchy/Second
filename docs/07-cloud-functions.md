# Cloud Functions

## Overview

Firebase Cloud Functions provide serverless backend functionality for Freepe. All functions are written in TypeScript and deployed to Firebase.

**Location**: `/functions/src/index.ts`
**Runtime**: Node.js 20
**Region**: Default (us-central1 or configured)

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    CLOUD FUNCTIONS                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │   CALLABLE      │  │   TRIGGERS      │  │   SCHEDULED     │ │
│  │   FUNCTIONS     │  │   (Firestore)   │  │   (PubSub)      │ │
│  ├─────────────────┤  ├─────────────────┤  ├─────────────────┤ │
│  │ incrementView   │  │ updateSearch    │  │ updateGlobal    │ │
│  │ toggleLike      │  │ Index           │  │ Stats           │ │
│  │ getShipping     │  │                 │  │                 │ │
│  │ Estimate        │  │ updateUser      │  │ cleanupSearch   │ │
│  │                 │  │ Stats           │  │ Index           │ │
│  │ createPayment   │  │                 │  │                 │ │
│  │ Intent          │  │ sendMessage     │  │ updatePopular   │ │
│  │                 │  │ Notification    │  │ ityScores       │ │
│  │ checkTracking   │  │                 │  │                 │ │
│  │ Status          │  │ sendOffer       │  │                 │ │
│  │                 │  │ StatusNotif     │  │                 │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │                    HTTP ENDPOINTS                           │ │
│  │  • stripeWebhook - Handles Stripe payment events            │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
                              │
           ┌──────────────────┼──────────────────┐
           ▼                  ▼                  ▼
    ┌─────────────┐   ┌─────────────┐   ┌─────────────┐
    │   Stripe    │   │   Shippo    │   │  Firebase   │
    │  Payments   │   │  Shipping   │   │   Admin     │
    └─────────────┘   └─────────────┘   └─────────────┘
```

---

## External Service Integrations

### Stripe

Payment processing with lazy initialization.

```typescript
const getStripe = () => {
  if (!stripe && stripeSecretKey) {
    stripe = new Stripe(stripeSecretKey, {
      apiVersion: '2025-11-17.clover',
    });
  }
  return stripe;
};
```

**Capabilities:**
- Payment Intent creation
- Webhook event verification
- Payment confirmation

### Shippo

Shipping label generation and tracking.

```typescript
const getShippo = () => {
  if (!shippoClient && shippoApiKey) {
    shippoClient = new Shippo({ apiKeyHeader: shippoApiKey });
  }
  return shippoClient;
};
```

**Capabilities:**
- Shipping rate quotes
- Label generation
- Tracking status

### Google Gemini AI

AI-powered product analysis for automatic form filling.

```typescript
const getGenAI = () => {
  if (!genAI && GEMINI_API_KEY) {
    genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  }
  return genAI;
};

// IMPORTANT: Always use this exact model name
const model = genAI.getGenerativeModel({ model: 'gemini-3-flash-preview' });
```

> **CRITICAL**: The model MUST be `gemini-3-flash-preview` (Gemini 3 Flash).
> Do NOT use `gemini-2.0-flash`, `gemini-1.5-flash`, or other older models.

**Capabilities:**
- Multi-image analysis (up to 5 photos)
- Label/tag detection for exact brand, size, and material composition
- Category classification with confidence scores
- Condition assessment
- Color and material detection
- Package size estimation

**Environment Variable:**
```
GEMINI_API_KEY=your_api_key_here
```

---

## Utility Functions

### Geohash Encoding

Converts coordinates to geohash for location-based queries.

```typescript
function encodeGeohash(
  latitude: number,
  longitude: number,
  precision: number = 7
): string
```

**Usage**: Enables efficient geo-queries in Firestore without GeoFirestore library.

---

### Search Keyword Generation

Generates searchable keywords from text.

```typescript
function generateSearchKeywords(text: string): string[]
```

**Features:**
- Extracts individual words (min 3 chars)
- Creates bigrams (word pairs)
- Generates prefix matches for autocomplete

**Example:**
```typescript
generateSearchKeywords("vintage leather jacket")
// Returns: ["vintage", "leather", "jacket", "vintage leather",
//          "leather jacket", "vin", "vint", "vinta", "vintag", ...]
```

---

### Popularity Score Calculation

Ranks products by engagement with time decay.

```typescript
function calculatePopularityScore(
  views: number,
  likes: number,
  createdAt: Date
): number
```

**Algorithm:**
```
engagementScore = (views * 0.1) + (likes * 2)
ageFactor = exp(-ageInDays / 30)  // 30-day half-life
popularityScore = engagementScore * ageFactor
```

---

### Debounced Updates

Batches rapid updates to reduce Firestore writes.

```typescript
function debounceUpdate(
  key: string,
  updateFn: () => Promise<void>,
  delay: number = 5000
): void
```

**Usage:**
- Search index updates: 5s debounce
- User stats updates: 10s debounce

---

## Search Indexing

### `updateSearchIndex` Function

**Trigger**: `products/{productId}` write events

**Index Document Structure:**
```typescript
{
  productId: string;
  title: string;
  titleLowercase: string;
  description: string;
  keywords: string[];           // Generated search terms

  // Filterable fields
  category: string;
  subcategory: string | null;
  brand: string | null;
  size: string | null;
  color: string | null;
  condition: string;
  price: number;

  // Location data
  location: {
    city: string;
    geohash: string;           // For geo-queries
    coordinates: { lat, lon } | null;
  };

  // Cached display data
  sellerId: string;
  sellerName: string;
  sellerRating: number | null;
  firstImage: string | null;

  // Status
  isActive: boolean;
  isSold: boolean;
  isPromoted: boolean;

  // Metrics
  views: number;
  likes: number;
  createdAt: Timestamp;
  popularityScore: number;
  lastIndexed: Timestamp;
}
```

---

## Payment Flow

### Payment Intent Creation

1. Client calls `createPaymentIntent` with transaction ID
2. Function verifies user is the buyer
3. Reuses existing Payment Intent if available
4. Creates new Payment Intent via Stripe
5. Stores `paymentIntentId` in transaction
6. Returns `clientSecret` for Stripe SDK

### Webhook Processing (`stripeWebhook`)

1. Verifies Stripe signature
2. Handles `payment_intent.succeeded` event
3. Creates shipping label via Shippo
4. Updates transaction status to `paid`
5. Marks article as sold
6. Adds funds to seller's pending balance
7. Sends system message with label URL

---

## Notification System

### Message Notifications

**Trigger**: New message document created

**Notification Channels:**
| Platform | Config |
|----------|--------|
| Android | Channel: `messages`, Priority: high |
| iOS | Sound: default, Badge: 1 |

**Token Management:**
- Invalid tokens automatically removed on send failure
- Error codes handled: `invalid-registration-token`, `registration-token-not-registered`

---

## Scheduled Jobs

| Function | Schedule | Purpose |
|----------|----------|---------|
| `updateGlobalStats` | Every 1 hour | Platform metrics |
| `cleanupSearchIndex` | Every 24 hours | Remove stale entries |
| `updatePopularityScores` | Every 6 hours | Recalculate rankings |

---

## Development

### Local Development

```bash
cd functions

# Install dependencies
npm install

# Build TypeScript
npm run build

# Run emulator
firebase emulators:start --only functions

# Watch mode
npm run build:watch
```

### Environment Variables

Set in `functions/.env`:

```env
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
SHIPPO_API_KEY=shippo_test_...
```

Or via Firebase config:

```bash
firebase functions:config:set \
  stripe.secret="sk_..." \
  stripe.webhook="whsec_..." \
  shippo.key="..."
```

### Deployment

```bash
# Deploy all functions
firebase deploy --only functions

# Deploy specific function
firebase deploy --only functions:updateSearchIndex

# View logs
firebase functions:log
```

---

## Error Handling

All callable functions use `HttpsError` for consistent error responses:

```typescript
throw new functions.https.HttpsError(
  'invalid-argument',    // Code
  'Error message',       // User-facing message
  { field: 'value' }     // Optional details
);
```

**Error Codes Used:**
- `invalid-argument` - Missing or invalid parameters
- `unauthenticated` - User not logged in
- `permission-denied` - User not authorized
- `not-found` - Resource doesn't exist
- `failed-precondition` - External service not configured
- `internal` - Unexpected server error
