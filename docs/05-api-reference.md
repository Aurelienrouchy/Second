# API Reference

## Cloud Functions API

All Cloud Functions are deployed to Firebase and can be called from the mobile app using the Firebase Functions SDK.

---

## Callable Functions

### `incrementProductView`

Increments the view count for a product.

**Authentication**: Not required

**Request:**
```typescript
{
  productId: string;  // Product document ID
}
```

**Response:**
```typescript
{
  success: boolean;
  message: string;
}
```

**Errors:**
| Code | Description |
|------|-------------|
| `invalid-argument` | Product ID is required |
| `not-found` | Product not found |
| `internal` | Failed to increment view count |

---

### `toggleProductLike`

Likes or unlikes a product and updates the user's favorites.

**Authentication**: Required

**Request:**
```typescript
{
  productId: string;   // Product document ID
  isLiked: boolean;    // true to like, false to unlike
}
```

**Response:**
```typescript
{
  success: boolean;
  message: string;
}
```

**Errors:**
| Code | Description |
|------|-------------|
| `unauthenticated` | User must be authenticated |
| `invalid-argument` | Product ID and like status are required |
| `not-found` | Product not found |
| `internal` | Failed to update like status |

---

### `getShippingEstimate`

Gets shipping rate quotes from Shippo.

**Authentication**: Not required

**Request:**
```typescript
{
  fromAddress: {
    name: string;
    street: string;
    city: string;
    postalCode: string;
    country: string;
  };
  toAddress: {
    name: string;
    street: string;
    city: string;
    postalCode: string;
    country: string;
    phoneNumber?: string;
  };
  weight?: number;          // Weight in kg (default: 0.5)
  dimensions?: {
    length?: number;        // cm (default: 30)
    width?: number;         // cm (default: 25)
    height?: number;        // cm (default: 10)
  };
}
```

**Response:**
```typescript
{
  success: boolean;
  rates: {
    carrier: string;        // e.g., "La Poste"
    serviceName: string;    // Service description
    estimatedDays: string;  // e.g., "2-3"
    amount: number;         // Price in EUR
    currency: string;       // "EUR"
    shippoRateId: string;   // Use for label creation
  }[];
}
```

**Errors:**
| Code | Description |
|------|-------------|
| `invalid-argument` | From and to addresses are required |
| `failed-precondition` | Shippo API not configured |
| `internal` | Failed to get shipping estimate |

---

### `createPaymentIntent`

Creates a Stripe Payment Intent for a transaction.

**Authentication**: Required (buyer only)

**Request:**
```typescript
{
  transactionId: string;  // Transaction document ID
}
```

**Response:**
```typescript
{
  success: boolean;
  clientSecret: string;    // Stripe client secret for payment sheet
  paymentIntentId: string; // Stripe Payment Intent ID
}
```

**Errors:**
| Code | Description |
|------|-------------|
| `unauthenticated` | User must be authenticated |
| `invalid-argument` | Transaction ID is required |
| `not-found` | Transaction not found |
| `permission-denied` | You are not authorized for this transaction |
| `failed-precondition` | Stripe API not configured |
| `internal` | Failed to create payment intent |

---

### `checkTrackingStatus`

Gets current tracking status from Shippo.

**Authentication**: Not required

**Request:**
```typescript
{
  transactionId: string;  // Transaction document ID
}
```

**Response:**
```typescript
{
  success: boolean;
  trackingStatus: string;  // e.g., "TRANSIT", "DELIVERED"
  trackingHistory: {
    status: string;
    location: string;
    date: string;
  }[];
}
```

**Errors:**
| Code | Description |
|------|-------------|
| `invalid-argument` | Transaction ID is required |
| `not-found` | Transaction not found |
| `failed-precondition` | No tracking number available / Shippo API not configured |
| `internal` | Failed to check tracking |

---

## HTTP Endpoints

### `stripeWebhook`

**URL**: `https://<region>-<project>.cloudfunctions.net/stripeWebhook`

**Method**: POST

**Purpose**: Handles Stripe webhook events for payment confirmation.

**Headers:**
```
stripe-signature: <Stripe webhook signature>
Content-Type: application/json
```

**Handled Events:**
- `payment_intent.succeeded` - Confirms payment, creates shipping label, updates transaction

**Response:**
```json
{ "received": true }
```

---

## Triggered Functions

### `updateSearchIndex`

**Trigger**: `products/{productId}` - onCreate, onUpdate, onDelete

**Purpose**: Maintains search index for product discovery.

**Actions:**
- Creates/updates search index document with keywords and filters
- Generates geohash for location-based search
- Calculates popularity score
- Removes deleted/inactive products from index

---

### `updateUserStats`

**Trigger**: `products/{productId}` - onCreate, onUpdate, onDelete

**Purpose**: Maintains user statistics (products listed, sold, earnings).

**Actions:**
- Counts user's products (listed, active, sold)
- Calculates total views and likes
- Updates earnings totals

---

### `updateGlobalStats`

**Trigger**: Scheduled (every 1 hour)

**Purpose**: Calculates platform-wide statistics.

**Actions:**
- Counts total products, users, sales
- Aggregates revenue
- Calculates per-category statistics

---

### `cleanupSearchIndex`

**Trigger**: Scheduled (every 24 hours)

**Purpose**: Removes stale search index entries.

**Actions:**
- Deletes entries for inactive products
- Deletes entries for sold products

---

### `updatePopularityScores`

**Trigger**: Scheduled (every 6 hours)

**Purpose**: Recalculates product popularity for ranking.

**Algorithm:**
```typescript
popularityScore = (views * 0.1 + likes * 2) * exp(-ageInDays / 30)
```

---

### `sendMessageNotification`

**Trigger**: `messages/{messageId}` - onCreate

**Purpose**: Sends push notifications for new messages.

**Notification Types:**
| Message Type | Title | Body |
|--------------|-------|------|
| `text` | Sender name | Article title or message preview |
| `image` | Sender name | "Photo - {articleTitle}" |
| `offer` | "Nouvelle offre de {sender}" | "{amount} for {articleTitle}" |
| `system` | (no notification) | - |

---

### `sendOfferStatusNotification`

**Trigger**: `messages/{messageId}` - onUpdate

**Purpose**: Notifies buyer when offer is accepted/rejected.

**Notifications:**
| Status | Title | Body |
|--------|-------|------|
| `accepted` | "Offre acceptée!" | "{seller} a accepte votre offre de {amount}" |
| `rejected` | "Offre refusee" | "{seller} a refuse votre offre de {amount}" |

---

## Calling Functions from React Native

```typescript
import { getFunctions, httpsCallable } from '@react-native-firebase/functions';

// Initialize
const functions = getFunctions();

// Call a function
const getShippingEstimate = httpsCallable(functions, 'getShippingEstimate');

const result = await getShippingEstimate({
  fromAddress: {...},
  toAddress: {...},
  weight: 0.5,
});

console.log(result.data.rates);
```

---

## Environment Variables

Cloud Functions require these environment variables:

| Variable | Description |
|----------|-------------|
| `STRIPE_SECRET_KEY` | Stripe API secret key |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret |
| `SHIPPO_API_KEY` | Shippo API key |

Set via Firebase CLI:
```bash
firebase functions:config:set stripe.secret="sk_..." stripe.webhook="whsec_..." shippo.key="..."
```
