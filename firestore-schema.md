# Firestore Data Model - Second

## Collections Overview

| # | Collection | Type | Description |
|---|-----------|------|-------------|
| 1 | `articles` | Root | Main product listings (source of truth for articles) |
| 2 | `products` | Root | Legacy product docs (search index source, kept in sync) |
| 3 | `users` | Root | User profiles and preferences |
| 4 | `users/{uid}/savedSearches` | Sub-collection | User's saved search alerts |
| 5 | `users/{uid}/searchHistory` | Sub-collection | User's recent search queries |
| 6 | `favorites` | Root | Per-user favorite article IDs |
| 7 | `chats` | Root | Chat threads between two users |
| 8 | `messages` | Root | Individual chat messages |
| 9 | `transactions` | Root | Purchase transactions (Stripe Connect payments) |
| 10 | `withdrawal_requests` | Root | Seller withdrawal requests |
| 11 | `avis` | Root | User reviews / ratings |
| 12 | `swaps` | Root | Swap proposals between users (optional Stripe cash top-up) |
| 13 | `swapParties` | Root | Single permanent generalist Swap Zone (doc id `generalist`) |
| 14 | `swapPartyItems` | Root | Articles deposited in the Swap Zone |
| 16 | `notifications` | Root | Push notification records |
| 17 | `drafts` | Root | Unsaved article drafts |
| 18 | `guest_preferences` | Root | Onboarding preferences for unauthenticated users |
| 19 | `moments` | Root | Seasonal/event moments for curated feeds |
| 20 | `embeddings` | Root | Vertex AI multimodal embeddings per article |
| 21 | `search_index` | Root | Denormalized search documents |
| 22 | `stats` | Root | Aggregated platform statistics |
| 23 | `rate_limits` | Root | Rate limiting counters for Cloud Functions |
| 24 | `wallets` | Root | Virtual wallet balances (all amounts in cents) |
| 25 | `wallets/{uid}/ledger` | Sub-collection | Wallet transaction ledger entries |
| 26 | `platform_ledger` | Root | Platform accounting ledger (shipping cost variance, server-only) |
| 27 | `failed_operations` | Root | Dead-letter queue for failed money/shipping side-effects (server-only, replayed by `retryFailedOperations`) |
| 28 | `stripe_events` | Root | Stripe webhook idempotency markers keyed by `event.id` (server-only) |

---

## Security Rules — server-only enforcement (P1/P2 hardening)

The following are CF-only (Admin SDK) and **rejected on any client write**
(`firestore.rules`). Audit any future feature against this list before touching
the rules.

**Server-only collections** (no client write; read restricted as noted):

| Collection | Client read | Client write |
| --- | --- | --- |
| `wallets/{uid}` (+ `ledger`) | owner only | denied |
| `withdrawal_requests` | owner / admin | denied |
| `stripe_events` | admin only | denied |
| `failed_operations` | admin only | denied |
| `platform_ledger` | admin only | denied |
| `rate_limits` | denied | denied |

**`transactions` — client-immutable fields** (a client may only confirm a
meetup: `status: meetup_pending -> meetup_confirmed` by the seller, optionally
with `meetupConfirmedAt`/`updatedAt`). Every field below is blocked by
`diff().affectedKeys().hasAny([...])` and may change **only** via Cloud
Functions: `status`, `amount`, `totalAmount`, `sellerPayout`, `serviceFee`,
`serviceFeePercent`, `sellerCreditedCents`, `walletAmountUsed`, `paidVia`,
`shippingCost`, `actualShippingCost`, `shippingCostDelta`, `insuranceCost`,
`shippingReconciledAt`, `fundsReleaseAt`, `fundsReleasedAt`, `disputed`,
`disputeId`, `disputedAt`, `disputeReason`, `statusBeforeDispute`,
`disputeOutcome`, `disputeClosedAt`, `labelCreationPending`, `labelCreationNote`,
`labelAttempts`, `lastLabelAttemptAt`, `labelStaleNudgedAt`, `shipEngineRateId`,
`shipEngineLabelId`, `trackingNumber`, `trackingUrl`, `trackingStatus`,
`shippingLabelUrl`, `carrierCode`, `stripePaymentIntentId`, `stripeChargeId`,
`stripeRefundId`, `stripeRefundIssuedAt`, `refundReason`, `refundStartedAt`,
`refundedAt`, `cancelReason`, `cancelledBy`, `cancelledAt`, `meetupSpot`
(immutable after creation), `deliveryType`, and all server timestamps
(`paidAt`, `labelCreatedAt`, `shippedAt`, `deliveredAt`, `deliveryFailedAt`,
`completedAt`, `createdAt`).

The `wallets` balance buckets (`balance`, `pendingBalance`, `heldBalance`,
`sellerDebt`) are protected by the blanket `wallets` write-deny (this collection
replaced the removed legacy `seller_balances`).

---

## Document Structures

### `articles/{articleId}`

Main product listing collection. Source of truth for article data.

```typescript
interface ArticleDocument {
  id: string;                    // Document ID
  title: string;                 // Article title
  description: string;           // Detailed description
  price: number;                 // Current price in CAD
  originalPrice?: number;        // Original price before price drop

  // Media
  images: {
    url: string;                 // Firebase Storage URL
    blurhash?: string;           // Blur placeholder hash
    width?: number;
    height?: number;
    order: number;               // Display order (0-based)
  }[];

  // Categorization
  category?: string;             // Main category
  categoryId?: string;           // Category ID
  categoryIds?: string[];        // Full category path IDs
  subcategory?: string;
  brand?: string;                // Primary brand
  brands?: string[];             // All brands (multi-brand support)
  size?: { value: string; system: 'US' | 'EU' } | null;  // ArticleSize object (US/EU never collide)
  color?: string;
  colors?: string[];
  material?: string;
  materials?: string[];
  pattern?: string;
  condition: 'neuf' | 'tres bon etat' | 'bon etat' | 'satisfaisant';

  // Seller
  sellerId: string;
  sellerName: string;
  sellerImage?: string;

  // Location
  location?: {
    city?: string;
    postalCode?: string;
    province?: string;
    coordinates?: { lat: number; lon: number };
    geohash?: string;
  };

  // Delivery
  isHandDelivery?: boolean;        // Supports in-person pickup
  isShipping?: boolean;            // Supports shipping
  packageSize?: 'small' | 'medium' | 'large'; // For shipping cost estimation
  deliveryOptions?: {              // Legacy structure (some older articles)
    pickup: boolean;
    shipping: boolean;
    shippingCost?: number;
  };

  // Meetup neighborhoods
  neighborhoods?: {                // Preferred meetup locations (max 10)
    id: string;
    name: string;
    city?: string;
  }[];
  neighborhood?: {                 // Primary meetup location (first of neighborhoods)
    id: string;
    name: string;
    city?: string;
  };

  // Status
  isActive: boolean;             // Visible in listings
  isSold: boolean;               // Has been sold
  isPromoted?: boolean;          // Sponsored listing
  moderationStatus?: 'approved'; // Auto-approved on creation (no moderation flow yet)

  // Engagement
  views?: number;
  likes?: number;
  likedBy?: string[];
  favoritesCount?: number;       // Denormalized from favorites

  // Price drop tracking
  lastPriceDropAt?: Timestamp;
  priceDropPercent?: number;
  promotionActive?: boolean;

  // Timestamps
  createdAt: Timestamp;
  updatedAt: Timestamp;
  soldAt?: Timestamp;
  deletedAt?: Timestamp;         // Set during GDPR cleanup

  // Search
  searchKeywords?: string[];
}
```

### `products/{productId}`

Legacy product documents used for search index updates. Kept in sync with `articles`.

Same structure as `articles` plus:
- `moderationStatus: 'pending' | 'approved' | 'rejected'`
- `isReported: boolean`
- `titleLowercase: string`

### `users/{userId}`

```typescript
interface UserDocument {
  id: string;                    // Firebase Auth UID
  email: string;
  displayName: string;
  profileImage?: string;
  authProvider: 'password' | 'google' | 'apple'; // Set by onUserCreated trigger

  // Profile
  bio?: string;
  phoneNumber?: string;
  accountType?: 'user' | 'seller' | 'admin';

  // Addresses
  addresses?: {
    id: string;
    label: string;
    street: string;
    city: string;
    postalCode: string;
    province?: string;
    country: string;
    coordinates?: { lat: number; lon: number };
    isDefault: boolean;
  }[];

  // Preferences
  preferences?: {
    notifications?: {
      email?: boolean;
      push?: boolean;
      messages?: boolean;
      likes?: boolean;
      sales?: boolean;
      articleFavorited?: boolean;
      priceDrops?: boolean;
      swapZoneReminder?: boolean;
    };
    privacy?: {
      showEmail?: boolean;
      showPhone?: boolean;
      showProfilePhoto?: boolean;  // When false, getUserPublicProfile returns null profileImage
      showLastSeen?: boolean;
    };
    sizes?: string[];
    shoesSizes?: string[];
    sex?: string;
  };

  // Onboarding
  onboardingPreferences?: {
    sex: 'femme' | 'homme' | 'les-deux' | 'enfant';
    sizesTop: string[];
    sizesBottom: string[];
    sizesShoes: string[];
    updatedAt: Timestamp;
  };
  onboardingCompleted?: boolean;

  // Style profile (AI-generated)
  styleProfile?: {
    styleTags: string[];
    styleDescription: string;
    recommendedBrands: string[];
    suggestedSizes: { top: string; bottom: string };
    confidence: number;
    generatedAt: Timestamp;
  };

  // Social
  likedSellers?: string[];      // User IDs of liked sellers
  sellerLikesCount?: number;    // How many users liked this seller
  fcmTokens?: string[];         // FCM push notification tokens

  // Stats
  rating?: number;              // Average review rating (0-5)
  reviewCount?: number;
  articlesCount?: number;

  // Stripe Connect Custom
  stripeAccountId?: string;        // Stripe Connect Custom account ID (acct_xxx)
  stripeAccountStatus?: 'pending' | 'pending_verification' | 'partially_active' | 'active';
  stripeChargesEnabled?: boolean;  // Can receive payments via platform
  stripePayoutsEnabled?: boolean;  // Can receive payouts from Stripe
  stripeDetailsSubmitted?: boolean; // Onboarding details submitted
  stripeAccountCreatedAt?: Timestamp;
  stripeBankAccountAdded?: boolean;  // Bank account attached to Custom account
  stripeBankAccountLast4?: string;   // Last 4 digits of bank account number

  // Status
  isVerified?: boolean;
  isActive: boolean;
  isAdmin?: boolean;             // Admin flag (protected, cannot be self-set)
  lastSeen?: Timestamp;

  // Timestamps
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

#### Sub-collection: `users/{uid}/savedSearches/{searchId}`

```typescript
interface SavedSearchDocument {
  name?: string;                 // User-defined search name
  query?: string;               // Text query
  filters?: {
    categoryIds?: string[];
    brands?: string[];
    sizes?: { value: string; system: 'US' | 'EU' }[];  // ArticleSize objects (patterns removed)
    colors?: string[];
    materials?: string[];
    condition?: string;
    minPrice?: number;
    maxPrice?: number;
  };
  notifyNewItems: boolean;       // Push notifications enabled
  lastNotifiedAt?: Timestamp;
  newItemsCount?: number;        // Count of unviewed new matches
  createdAt: Timestamp;
}
```

#### Sub-collection: `users/{uid}/searchHistory/{entryId}`

```typescript
interface SearchHistoryEntry {
  query: string;
  timestamp: Timestamp;
}
```

### `favorites/{userId}`

Single document per user containing all favorite article IDs.

```typescript
interface FavoritesDocument {
  userId: string;
  articleIds: string[];          // Array of favorited article IDs
  updatedAt: Timestamp;
}
```

### `chats/{chatId}`

Chat thread between two users, optionally scoped to an article.

**Document ID format (dual-format, both coexist in production):**
- General chat (from profile): `${minUid}__${maxUid}` (2 segments)
- Article-scoped chat: `${minUid}__${maxUid}__${articleId}` (3 segments)
- Legacy chats may also have auto-generated IDs (pre-deterministic fix)

New chats initiated from an article page use the 3-segment format so that
two users can have separate conversations per article. Chats initiated
from a profile page (no article context) use the 2-segment format.

```typescript
interface ChatDocument {
  participants: string[];        // Exactly 2 user IDs
  // NOTE: Two formats exist in production (dual-format, both must be handled):
  //   Map format (current): { [userId]: { userName, profileImage } }
  //   Array format (legacy): [{ odlUserId, userName, userImage }]
  // New code writes map format. Reads must handle both.
  participantsInfo: {
    [userId: string]: {
      userName: string;
      profileImage?: string | null;  // Legacy array format uses `userImage` instead
    };
  };
  // Article context (set when chat initiated from an article)
  sellerId?: string;             // Seller UID — optional, may be null on legacy
                                 // chats created before this field was added.
                                 // Cloud Functions (e.g. createTransaction) read
                                 // sellerId from the article, not the chat.
  articleId?: string;            // Article being discussed
  articleTitle?: string;
  articleImage?: string;
  articlePrice?: number;

  lastMessage?: string;
  lastMessageType?: 'text' | 'image' | 'offer' | 'system';
  lastMessageTimestamp?: Timestamp;
  unreadCount?: { [userId: string]: number };
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

### `messages/{messageId}`

Individual message within a chat.

```typescript
interface MessageDocument {
  chatId: string;                // Reference to parent chat
  senderId: string;              // Sender UID or 'system'
  receiverId: string;            // Receiver UID or 'system'
  participants: string[];        // Copy of chat participants (for rules)

  // Content
  content: string;
  type: 'text' | 'image' | 'offer' | 'system';
  status: 'sent' | 'delivered' | 'read';
  isRead: boolean;

  // Offer data (type === 'offer')
  offer?: {
    amount: number;
    status: 'pending' | 'accepted' | 'rejected' | 'completed'
          | 'counter_price' | 'counter_location' | 'counter_time'
          | 'expired';
    message?: string;
    shippingAddress?: ShippingAddress;
    shippingEstimate?: ShippingEstimate;
    totalAmount?: number;            // amount + shipping
    expiresAt?: Timestamp;
    offerId?: string;                // Reference to MeetupOffer document

    // Meetup details (present when offer involves in-person exchange)
    meetup?: {
      location: MeetupSpot;          // { name, address, category, neighborhood }
      dateTime?: Timestamp;          // Optional — date/time agreed via chat
      proposedBy: 'buyer' | 'seller';
      confirmedAt?: Timestamp;
      completedAt?: Timestamp;
      noShow?: {
        reportedBy: string;          // userId who reported
        reportedAt: Timestamp;
        reason?: string;
      };
    };

    // Negotiation history (counter-offers, status changes)
    history?: {
      action: string;                // e.g. 'created', 'counter_price', 'accepted'
      by: string;                    // userId
      timestamp: Timestamp;
      previousValue?: any;
      newValue?: any;
      message?: string;
    }[];
  };

  // Shipping label (system messages)
  shippingLabel?: {
    labelUrl: string;
    trackingNumber: string;
    trackingUrl: string;
  };

  // Timestamps
  timestamp: Timestamp;
  readAt?: Timestamp;
}
```

### `transactions/{transactionId}`

Purchase transaction tracking from checkout to delivery.

```typescript
interface TransactionDocument {
  // Parties
  buyerId: string;
  buyerName?: string;
  buyerEmail?: string;
  sellerId: string;
  sellerName?: string;

  // Article
  articleId: string;
  articleTitle?: string;
  articleImage?: string;

  // Amounts (dollars)
  amount: number;                // Article price
  shippingCost?: number;         // Estimated shipping cost billed to the buyer (server re-priced)
  actualShippingCost?: number;   // Real ShipEngine label cost (shipment_cost + insurance_cost),
                                 // set when the label is created (reconcileShippingCost)
  shippingCostDelta?: number;    // actualShippingCost - shippingCost. > $2 absolute => CRITICAL log
                                 // + platform_ledger 'shipping_cost_variance' entry
  insuranceCost?: number;        // Real insurance cost on the label (dollars), 0 when none
  shippingReconciledAt?: Timestamp; // When the label cost was reconciled
  serviceFee?: number;
  serviceFeePercent?: number;
  totalAmount?: number;          // What the buyer pays (amount + shipping + fee)
  sellerPayout?: number;         // What the seller receives

  // Status flow:
  //   Shipping: pending_payment -> paid -> label_created -> shipped -> delivered -> completed
  //             | cancelled | disputed | refunded | delivery_failed
  //   DECOUPLED (P1): the shipping label being purchased sets 'label_created'
  //   (NOT 'shipped'). 'shipped' is set only on the FIRST real carrier scan
  //   (tracking poller / ShipEngine webhook). This distinguishes a seller who
  //   printed a label from one who actually handed the parcel to the carrier;
  //   the tracking poller nudges sellers whose label_created parcel has had no
  //   scan for 3 days (labelStaleNudgedAt).
  //   Delivered funds enter a 7-day dispute window (heldBalance). At J+7 without
  //   dispute, releaseHeldFunds moves delivered -> completed (heldBalance -> balance).
  //   Meetup:   meetup_pending -> meetup_confirmed -> meetup_completed | cancelled
  //   Failed:   pending_payment -> cancelled (via payment_failed webhook)
  //   Expiry (P1): pending_payment -> cancelled only after expireOrphanedTransactions
  //   confirms the Stripe PaymentIntent is NOT in flight (retrieve -> not in
  //   requires_capture/processing/succeeded) and cancels the PI. An in-flight PI
  //   defers expiry (avoids cancelling a captured payment). A PI.succeeded landing
  //   AFTER cancellation triggers an idempotent auto-refund (rf_${txId}).
  //   Seller-no-ship refund (P1): paid -> refund_in_progress -> refunded. The
  //   3-phase refund (mark in_progress -> Stripe refund w/ idempotencyKey
  //   rf_${txId} + persist stripeRefundId -> apply wallet movements + set
  //   refunded) is crash-safe; a stuck refund_in_progress is resumed by the same
  //   scheduled job (re-uses persisted stripeRefundId, no double refund). Final
  //   status 'refunded' makes the inbound charge.refunded webhook a no-op.
  //   Delivery failure (carrier FAILURE/exception via poller or ShipEngine
  //   webhook): label_created|shipped -> delivery_failed (disputed=true, funds
  //   NOT released). Resolution = adminRefundTransaction.
  //   Dispute:  paid|label_created|shipped|delivered -> disputed
  //             -> (won: restore prev status) | (lost: refunded)
  status: 'pending_payment' | 'meetup_pending' | 'meetup_confirmed'
        | 'meetup_completed' | 'paid' | 'label_created' | 'shipped'
        | 'delivered' | 'completed' | 'cancelled' | 'disputed' | 'refunded'
        | 'refund_in_progress' | 'delivery_failed' | 'lost';
        // 'refund_in_progress' (P1): transient state during the seller-no-ship
        // 3-phase refund (Stripe refund issued, wallet movements pending). Always
        // resolves to 'refunded' within the same or a subsequent scheduled run.

  // Payment method
  paidVia?: 'wallet' | 'wallet_and_card';  // Set when wallet is used (absent = card-only destination charge)
  walletAmountUsed?: number;       // Wallet portion in cents (for mixed payments)
  sellerCreditedCents?: number;    // EXACT amount credited to the seller's wallet (in cents).
                                   // ATOMICITY (P1): for SHIPPING transactions the seller is credited
                                   // ONLY after the shipping label is successfully created (label step
                                   // or sweepPendingLabels), so this field is ABSENT while a shipping
                                   // tx is still 'paid' + labelCreationPending. For non-shipping it is
                                   // set at payment. Its presence is the authoritative signal that the
                                   // seller was credited: a refund/lost dispute debits precisely this
                                   // figure (cascading pendingBalance -> heldBalance -> balance); when
                                   // ABSENT the debit target is 0 (never credited => no false debt).
                                   // Any shortfall already withdrawn is recorded as sellerDebt.

  // Stripe Connect payment
  stripePaymentIntentId?: string;  // Stripe PaymentIntent ID
  stripeCheckoutCreatedAt?: Timestamp;
  stripeChargeId?: string;         // Latest charge ID from webhook
  stripeRefundId?: string;         // Stripe refund ID (if refunded)
  stripeRefundIssuedAt?: Timestamp; // P1: stamped when the expiry job / auto-refund
                                   // successfully calls Stripe refunds.create (before
                                   // wallet movements). Crash-recovery marker so a
                                   // resumed refund_in_progress skips re-calling Stripe.
  refundReason?: string;           // P1: machine-readable refund reason set at PHASE 1
                                   // (e.g. seller_did_not_ship_7d)
  refundStartedAt?: Timestamp;     // P1: stamped when status -> refund_in_progress

  // Dispute window (7-day held funds)
  fundsReleaseAt?: Timestamp;      // deliveredAt + 7d; when heldBalance becomes withdrawable
  fundsReleasedAt?: Timestamp;     // Set by releaseHeldFunds when heldBalance -> balance

  // Dispute / cancellation
  disputeId?: string;              // Stripe dispute ID
  disputed?: boolean;              // True while a Stripe dispute is open (blocks seller withdrawals)
  disputedAt?: Timestamp;
  disputeReason?: string;
  statusBeforeDispute?: string;    // Status captured at dispute.created, restored if won
  disputeOutcome?: 'won' | 'lost' | string; // Set by charge.dispute.closed
  disputeClosedAt?: Timestamp;
  cancelReason?: string;           // Machine-readable reason (payment_failed, meetup_expired_48h, pending_payment_expired_1h, seller_did_not_ship_7d, label_creation_failed, etc.)
  cancelledBy?: string;            // UID of user who cancelled (manual cancel only)
  refundedAt?: Timestamp;

  // Delivery type
  deliveryType: 'shipping' | 'meetup';

  // Shipping (ShipEngine)
  shipEngineRateId?: string;
  trackingNumber?: string;
  trackingUrl?: string;
  trackingStatus?: string;       // 'LABEL_CREATED' (label bought, no carrier scan yet),
                                 // 'TRANSIT' | 'IN_TRANSIT' (carrier scanned -> status 'shipped'),
                                 // 'DELIVERED', 'FAILURE' (-> status 'delivery_failed'), 'UNKNOWN'
  shippingLabelUrl?: string;
  shipEngineLabelId?: string;
  carrierCode?: string;
  labelCreationPending?: boolean;  // True when the shipping label could not be created at payment
                                   // (ShipEngine down/5xx, expired or fallback_* rateId). The tx stays
                                   // 'paid', the seller is NOT credited, and sweepPendingLabels (hourly)
                                   // re-rates + retries createLabel. Cleared (false) on success.
  labelCreationNote?: string;      // Human-readable reason the label was deferred
  labelAttempts?: number;          // Number of sweepPendingLabels createLabel attempts. After 4 failures
                                   // the buyer is refunded and the transaction is cancelled.
  lastLabelAttemptAt?: Timestamp;  // Timestamp of the last sweepPendingLabels attempt
  labelStaleNudgedAt?: Timestamp;  // Last time the tracking poller nudged the seller about a
                                   // label_created parcel with no carrier scan (3-day window)
  actualShippingCost?: number;     // Real ShipEngine label cost (dollars), reconcileShippingCost
  shippingCostDelta?: number;      // actualShippingCost - estimated shippingCost (dollars)
  insuranceCost?: number;          // Real insurance cost on the label (dollars)
  shippingReconciledAt?: Timestamp;

  // Shipping address (deliveryType === 'shipping')
  shippingAddress?: {
    name?: string;
    street: string;
    city: string;
    postalCode: string;
    province?: string;
    country: string;
  };

  // Meetup (deliveryType === 'meetup')
  meetupSpot?: {                   // Agreed meeting location
    name: string;
    address: string;
    category: string;              // e.g. 'cafe', 'metro', 'parc'
    neighborhood: {
      id: string;
      name: string;
      city?: string;
    };
    coordinates?: { lat: number; lon: number };
  };
  meetupConfirmedAt?: Timestamp;
  meetupCompletedAt?: Timestamp;

  // Chat
  chatId?: string;

  // Timestamps
  createdAt: Timestamp;
  paidAt?: Timestamp;
  labelCreatedAt?: Timestamp;     // When the shipping label was purchased (status 'label_created')
  shippedAt?: Timestamp;          // When the carrier FIRST scanned the parcel (status 'shipped')
  deliveredAt?: Timestamp;
  deliveryFailedAt?: Timestamp;   // When a carrier FAILURE/exception flipped the tx to delivery_failed
  cancelledAt?: Timestamp;
  completedAt?: Timestamp;        // When meetup was completed
  refundReason?: string;          // Free-text reason set by adminRefundTransaction
  updatedAt?: Timestamp;
}
```

### `withdrawal_requests/{withdrawalId}`

Withdrawal record. Created atomically (`status: 'processing'`) inside the
`walletWithdraw` debit transaction, then closed out asynchronously by the
`payout.paid` (-> `completed`) / `payout.failed` (-> `failed` + re-credit)
Stripe webhook handlers, matched via `metadata.withdrawalRequestId` on the
Stripe payout. Server-only (see rules chantier).

```typescript
interface WithdrawalRequestDocument {
  withdrawalId: string;
  userId: string;
  amount: number;                 // In CENTS
  currency: 'cad';
  ledgerEntryId: string;          // Linked wallets/{userId}/ledger entry id
  stripeAccountId: string;        // Seller's Stripe Connect Custom account
  stripePayoutId?: string;        // Stripe Payout ID (po_xxx) — set by payout.* webhook
  status: 'processing' | 'completed' | 'failed';
  failureReason?: string;         // Set if status is 'failed'
  failedAt?: Timestamp;           // Set if status is 'failed'
  completedAt?: Timestamp;        // Set if status is 'completed'
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

### `platform_ledger/{entryId}`

Append-only platform accounting ledger (server-only). Records platform-side
financial variances for tax/audit traceability — does not move user funds.
Written by `reconcileShippingCost` (label cost reconciliation, P1).

```typescript
interface PlatformLedgerDocument {
  type: 'shipping_cost_variance';   // Real label cost differed from the billed estimate
  transactionId: string;
  estimatedShippingCost: number;    // shippingCost billed to the buyer (dollars)
  actualShippingCost: number;       // Real ShipEngine label cost (dollars)
  delta: number;                    // actual - estimated (dollars). Logged CRITICAL when |delta| > $2
  currency: 'cad';
  createdAt: Timestamp;
}
```

### `failed_operations/{opId}`

Dead-letter queue (server-only). A doc is written at every critical money/
shipping side-effect that fails after the point of no return (Stripe refund,
transfer/payout reversal, webhook amount mismatch, label give-up). The scheduled
`retryFailedOperations` (every 30 min) re-drives each `pending` doc idempotently
with exponential backoff, marking it `resolved` on success or `exhausted` after
6 attempts (a `CRITICAL` log fires on exhaustion for a log-based alert). The
`reconcileFinances` job (every 6h) also writes here when it detects a lost
PaymentIntent/payout webhook. Written via the `writeFailedOperation` helper
(`utils/failedOperations.ts`), which never throws.

```typescript
interface FailedOperationDocument {
  type:
    | 'stripe_refund_failed'      // a refunds.create failed
    | 'transfer_reversal_failed'  // transfers.createReversal failed after a payout error
    | 'payout_reversal_failed'    // a payout could not be reversed/cancelled (or lost payout webhook)
    | 'amount_mismatch'           // webhook PI.succeeded amount != expected (deterministic)
    | 'label_refund_failed'       // legacy alias (older docs) — treated as stripe_refund_failed
    | 'admin_refund_failed';      // legacy alias (older docs) — treated as stripe_refund_failed
  refId: string;                  // Primary entity id (transactionId / withdrawalRequestId / swapId / eventId)
  payload: Record<string, any>;   // Everything the replay handler needs (paymentIntentId, transferId, amounts, autoRefund…)
  error: string;                  // Last error message
  attempts: number;               // Replay attempts so far (starts at 0)
  status: 'pending' | 'resolved' | 'exhausted';
  createdAt: Timestamp;
  lastTriedAt: Timestamp | null;
  resolvedAt?: Timestamp;         // Set when status -> 'resolved'
  exhaustedAt?: Timestamp;        // Set when status -> 'exhausted'
}
```

> NOTE: earlier chantiers wrote a leaner shape (`transactionId`/`paymentIntentId`/
> `reason` at the top level, no `attempts`/`payload`). `retryFailedOperations`
> normalizes those legacy docs (transactionId→refId, reason→error) before
> dispatch, so both shapes are replayable.

### `avis/{reviewId}`

User reviews tied to completed transactions (sales or swaps).

**Review window**: Reviews can only be submitted within 60 days of transaction completion (`deliveredAt`, `meetupCompletedAt`, or swap `completedAt`).

**Doc ID format**:
- Sale reviews: `{reviewerId}_{transactionId}`
- Swap reviews: `{reviewerId}_swap_{swapId}`

```typescript
interface AvisDocument {
  id: string;
  reviewerId: string;
  reviewerName: string;
  reviewerImage?: string | null;
  vendeurId: string;             // Target user receiving the review (TODO: rename to targetUserId)
  transactionId: string;         // Transaction ID (sale) or Swap ID (swap)
  transactionType: 'achat' | 'vente' | 'swap';
  articleId?: string | null;
  articleTitle?: string | null;   // For swaps: title of the first exchanged article
  note: number;                  // 1-5 rating
  text: string;
  createdAt: Timestamp;
}
```

### `swaps/{swapId}`

Multi-article swap proposal between two users.

```typescript
interface SwapDocument {
  initiatorId: string;
  initiatorName: string;
  initiatorImage?: string;
  initiatorItems: {
    articleId: string;
    title: string;
    price?: number;
    image?: string;
  }[];
  initiatorTotalValue: number;

  receiverId: string;
  receiverName: string;
  receiverImage?: string;
  receiverItems: {
    articleId: string;
    title: string;
    price?: number;
    image?: string;
  }[];
  receiverTotalValue: number;

  // Full lifecycle (ordered). 'payment_pending' only occurs when cashTopUp is set:
  //   proposed -> accepted -> photos_pending -> shipping -> completed
  //   proposed -> payment_pending -> accepted -> ... (cash top-up swaps)
  //   proposed -> declined | cancelled
  //   payment_pending -> cancelled (initiator) | expired by cron
  //   shipping | completed -> disputed
  status: 'proposed' | 'payment_pending' | 'accepted' | 'declined' | 'cancelled'
        | 'photos_pending' | 'shipping' | 'completed' | 'disputed';
  message?: string;

  // Optional cash adjustment, paid for real via Stripe with the SAME buyer
  // protection fee as a purchase (platform keeps the fee; payee receives the
  // base amount). The payer is one of the two participants.
  cashTopUp?: {
    amount: number;              // BASE amount in CENTS (> 0), fee excluded
    payerId: string;             // == initiatorId | receiverId
  } | null;

  // Top-up payment fields (set by createSwapTopUpCheckout + stripeWebhook).
  topUpPaymentIntentId?: string; // Stripe PaymentIntent id
  topUpChargeId?: string | null; // Stripe charge id (latest_charge)
  topUpFee?: number;             // application_fee_amount in CENTS
  topUpPaidAt?: Timestamp;       // set on payment_intent.succeeded (swap_topup)
  topUpReleasedAt?: Timestamp;   // set at confirmSwapReception (pending -> available)
  topUpRefundId?: string;        // Stripe refund id (cancel/dispute)
  topUpRefundedAt?: Timestamp;
  topUpRefundReconciledAt?: Timestamp; // wallet debit reconciled via charge.refunded

  partyId?: string;              // Linked Swap Zone (id 'generalist')

  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

### `swapParties/{partyId}`

Single permanent **generalist** Swap Zone. Lives at the deterministic document
id `swapParties/generalist`, bootstrapped idempotently by `ensureGeneralistZone`
(and self-healed by `getActiveSwapPartyInfo`). No themes, no time window, no
participants, no status. Open to all authenticated users.

```typescript
interface SwapPartyDocument {
  name: string;                  // 'Swap Zone'
  isGeneralist: true;
  itemsCount: number;            // live count of deposited items (CF-managed)
  swapsCount: number;            // completed swaps in the zone (CF-managed)
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

> Removed in the generalist refactor: `theme`, `emoji`, `description`,
> `status`, `startDate`, `endDate`, `participantsCount`, and the entire
> `swapPartyParticipants` collection (no join/leave model anymore).

### `swapPartyItems/{docId}`

```typescript
interface SwapPartyItemDocument {
  partyId: string;               // == 'generalist'
  articleId: string;
  sellerId: string;
  sellerName: string;            // Seller display name
  sellerImage?: string;          // Seller profile image URL
  title: string;                 // Article title
  price: number;                 // Article price
  imageUrl?: string;             // Article image URL
  isSwapped: boolean;            // Whether this item has been swapped (CF-managed)
  isPending?: boolean;           // Item is in an active swap proposal (CF-managed)
  addedAt: Timestamp;
}
```

### `notifications/{notificationId}`

```typescript
interface NotificationDocument {
  userId: string;                // Recipient user ID
  type: string;                  // e.g. 'message', 'offer', 'swap_proposed', etc.
  title: string;
  body: string;
  data?: Record<string, string>; // Custom payload
  isRead?: boolean;
  createdAt: Timestamp;
}
```

### `drafts/{draftId}`

Unsaved article drafts for the sell flow.

```typescript
interface DraftDocument {
  userId: string;
  title?: string;
  description?: string;
  price?: number;
  images?: { url: string; order: number }[];
  category?: string;
  brand?: string;
  size?: { value: string; system: 'US' | 'EU' } | null;  // ArticleSize object
  condition?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

### `guest_preferences/{docId}`

Onboarding preferences saved before account creation.

```typescript
interface GuestPreferencesDocument {
  sex: 'femme' | 'homme' | 'les-deux' | 'enfant';
  sizesTop: string[];
  sizesBottom: string[];
  sizesShoes: string[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

### `moments/{momentId}`

Seasonal or event-based moments for curated product feeds.

```typescript
interface MomentDocument {
  id: string;
  name: string;
  emoji: string;
  priority: number;
  isActive: boolean;
  dateRange: {
    start: string;               // MM-DD format
    end: string;                 // MM-DD format
  };
  embedding?: number[];          // Vertex AI embedding for similarity matching
  createdAt: Timestamp;
}
```

### `embeddings/{articleId}`

Vertex AI multimodal embeddings for visual search and similar products.

```typescript
interface EmbeddingDocument {
  articleId: string;
  embedding: VectorValue;        // 1408-dimension vector (Firestore VectorValue)
  imageUrl: string;
  categoryIds: string[];
  brand?: string | null;
  priceRange: 'low' | 'medium' | 'high';
  isActive: boolean;
  isSold?: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

### `search_index/{productId}`

Denormalized search documents for fast filtering and ranking.

```typescript
interface SearchIndexDocument {
  productId: string;
  title: string;
  titleLowercase: string;
  description: string;
  keywords: string[];

  // Filterable
  category: string;
  categoryIds: string[];         // Mirrored from articles (C1) — enables category filter in text search
  subcategory?: string;
  brand?: string;
  brands?: string[];
  color?: string;
  colors?: string[];
  material?: string;
  materials?: string[];
  size?: { value: string; system: 'US' | 'EU' } | null;  // ArticleSize object, mirrored verbatim
  condition: string;
  price: number;

  // Location
  location: {
    city: string;
    geohash: string;
    coordinates?: { lat: number; lon: number };
  };

  // Cached display
  sellerId: string;
  sellerName: string;
  sellerRating?: number;
  firstImage?: string;

  // Status
  isActive: boolean;
  isSold: boolean;
  isPromoted: boolean;

  // Ranking
  views: number;
  likes: number;
  popularityScore: number;
  createdAt: Timestamp;
  lastIndexed: Timestamp;
}
```

### `wallets/{userId}`

Virtual wallet for buyers and sellers. All amounts are in **cents** (not dollars) to avoid floating-point issues. Balance mutations are server-side only via Cloud Functions with `runTransaction`.

**Three-bucket seller funds model** (P1 dispute window):
- `pendingBalance` — sale paid, NOT yet delivered (escrow, in transit). Not withdrawable.
- `heldBalance` — delivered, inside the 7-day buyer-dispute window. Not withdrawable.
- `balance` — withdrawable (dispute window elapsed without claim, via `releaseHeldFunds`).
- `sellerDebt` — shortfall owed after a refund or lost dispute where the seller's funds were already withdrawn; blocks all future withdrawals until cleared.

Fund flow per sale: `pendingBalance` (paid) → `heldBalance` (delivered, `applyDeliveredHeldFunds`) → `balance` (`releaseHeldFunds` after 7d). On `charge.dispute.created` any released portion is moved `balance → heldBalance`; `charge.dispute.closed` releases (won) or debits `heldBalance`/`balance` (lost, recording `sellerDebt` if insufficient).

Refund debit (any path: `charge.refunded`, `refundWalletPayment`, lost dispute): the seller is debited of EXACTLY `transactions.sellerCreditedCents` (the amount credited at payment), cascading `pendingBalance → heldBalance → balance` to drain wherever the funds currently sit. Any remainder the seller no longer holds (already withdrawn) is added to `sellerDebt` and recorded in a `refund_debit` ledger entry with `debtRecorded` — never masked with `min()`. On a mixed wallet+card refund, the buyer's wallet portion (`walletAmountUsed`) is re-credited to the buyer's wallet (internal movement) while the card portion is returned to the card by the upstream Stripe refund (`reverse_transfer` when the original charge was a destination charge).

```typescript
interface WalletDocument {
  balance: number;           // Withdrawable balance in cents
  pendingBalance: number;    // Funds in transit (paid, not delivered), in cents
  heldBalance?: number;      // Delivered, inside 7-day dispute window, in cents
  sellerDebt?: number;       // Shortfall owed after a lost dispute, in cents
  currency: 'cad';
  status: 'active';
  activatedAt: Timestamp;
  updatedAt: Timestamp;
}
```

#### Sub-collection: `wallets/{userId}/ledger/{entryId}`

Immutable transaction log for the wallet.

```typescript
interface WalletLedgerEntry {
  type:
    | 'sale_credit'        // seller credited into pendingBalance (escrow)
    | 'funds_held'         // delivered: pendingBalance -> heldBalance
    | 'funds_released'     // dispute window elapsed: heldBalance -> balance
    | 'dispute_hold'       // dispute opened: balance -> heldBalance (frozen)
    | 'purchase_debit'
    | 'withdrawal'
    | 'refund_credit'
    | 'refund_debit'       // seller debited on refund / lost dispute
    | 'withdrawal_failed';
  amount: number;            // Positive, in cents
  balanceAfter: number;      // Wallet balance after this entry
  description: string;       // Human-readable description (FR)
  status?: 'pending' | 'held';
  transactionId?: string;    // Reference to transactions collection
  withdrawalRequestId?: string; // Reference to withdrawal_requests doc
  debtRecorded?: number;     // Shortfall added to sellerDebt (lost dispute), in cents
  createdAt: Timestamp;
}
```

### `rate_limits/{userId_function}`

Rate limiting documents for Cloud Functions. Document ID format: `{userId}_{functionName}`.

```typescript
interface RateLimitDocument {
  userId: string;
  count: number;                   // Number of calls in current window
  windowStartedAt: Timestamp;      // Start of the current sliding window
}
```

Currently used by:
- `analyzeProductImage` -- key: `{userId}_analyzeProduct`, limit: 10 calls/hour

---

### `stats/{statType}`

Aggregated platform statistics.

```typescript
// Document: /stats/global
interface GlobalStatsDocument {
  totalProducts: number;
  totalUsers: number;
  totalSales: number;
  totalRevenue: number;
  categoryStats: {
    [category: string]: {
      productCount: number;
      totalSales: number;
      totalRevenue: number;
      averagePrice?: number;
    };
  };
  updatedAt: Timestamp;
}

// Document: /stats/user_{userId}
interface UserStatsDocument {
  userId: string;
  productsListed: number;
  productsActive: number;
  productsSold: number;
  productsViews: number;
  productsLikes: number;
  totalEarnings: number;
  averageSalePrice: number;
  updatedAt: Timestamp;
}
```
