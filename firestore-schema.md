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
| 10 | `seller_balances` | Root | Seller payout balances |
| 11 | `withdrawal_requests` | Root | Seller withdrawal requests |
| 12 | `avis` | Root | User reviews / ratings |
| 13 | `swaps` | Root | Swap proposals between users |
| 14 | `swapParties` | Root | Swap party (zone) events |
| 15 | `swapPartyParticipants` | Root | Users enrolled in a swap party |
| 16 | `swapPartyItems` | Root | Articles submitted to a swap party |
| 17 | `notifications` | Root | Push notification records |
| 18 | `drafts` | Root | Unsaved article drafts |
| 19 | `guest_preferences` | Root | Onboarding preferences for unauthenticated users |
| 20 | `moments` | Root | Seasonal/event moments for curated feeds |
| 21 | `embeddings` | Root | Vertex AI multimodal embeddings per article |
| 22 | `search_index` | Root | Denormalized search documents |
| 23 | `stats` | Root | Aggregated platform statistics |
| 24 | `rate_limits` | Root | Rate limiting counters for Cloud Functions |

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
  size?: string;
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
    sizes?: string[];
    colors?: string[];
    materials?: string[];
    patterns?: string[];
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

Chat thread between two users. Document ID is deterministic: `${minUid}__${maxUid}`.

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

  // Amounts
  amount: number;                // Article price
  shippingCost?: number;
  serviceFee?: number;
  serviceFeePercent?: number;
  totalAmount?: number;          // What the buyer pays (amount + shipping + fee)
  sellerPayout?: number;         // What the seller receives

  // Status flow:
  //   Shipping: pending_payment -> paid -> shipped -> delivered | cancelled | disputed | refunded
  //   Meetup:   meetup_pending -> meetup_confirmed -> meetup_completed | cancelled
  //   Failed:   pending_payment -> cancelled (via payment_failed webhook)
  status: 'pending_payment' | 'meetup_pending' | 'meetup_confirmed'
        | 'meetup_completed' | 'paid' | 'shipped' | 'delivered'
        | 'cancelled' | 'disputed' | 'refunded';

  // Stripe Connect payment
  stripePaymentIntentId?: string;  // Stripe PaymentIntent ID
  stripeCheckoutCreatedAt?: Timestamp;
  stripeChargeId?: string;         // Latest charge ID from webhook
  stripeRefundId?: string;         // Stripe refund ID (if refunded)

  // Dispute / cancellation
  disputeId?: string;              // Stripe dispute ID
  disputedAt?: Timestamp;
  disputeReason?: string;
  cancelReason?: string;           // Machine-readable reason (payment_failed, meetup_expired_48h, pending_payment_expired_1h, seller_did_not_ship_7d, etc.)
  cancelledBy?: string;            // UID of user who cancelled (manual cancel only)
  refundedAt?: Timestamp;

  // Delivery type
  deliveryType: 'shipping' | 'meetup';

  // Shipping (ShipEngine)
  shipEngineRateId?: string;
  trackingNumber?: string;
  trackingUrl?: string;
  trackingStatus?: string;       // e.g. 'TRANSIT', 'DELIVERED'
  shippingLabelUrl?: string;
  shipEngineLabelId?: string;
  carrierCode?: string;
  labelCreationPending?: boolean;  // True when label must be created manually (fallback rateId or API error)
  labelCreationNote?: string;      // Explanation of why label creation was skipped

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
  shippedAt?: Timestamp;          // When shipping label was created
  deliveredAt?: Timestamp;
  cancelledAt?: Timestamp;
  completedAt?: Timestamp;        // When meetup was completed
  updatedAt?: Timestamp;
}
```

### `seller_balances/{userId}`

Tracks a seller's financial balance. Mutations are always server-side via `runTransaction`.

```typescript
interface SellerBalanceDocument {
  userId: string;
  availableBalance: number;      // Funds ready for withdrawal
  pendingBalance: number;        // Funds held until delivery confirmed
  totalEarnings: number;         // Lifetime earnings (shipping + meetup combined)
  totalMeetupEarnings?: number;  // Meetup-only earnings (in-person, not platform-processed)

  // Embedded transaction log
  transactions: {
    id: string;                  // Transaction or withdrawal ID
    type: 'sale' | 'withdrawal';
    amount: number;              // Positive for sales, negative for withdrawals
    description: string;
    createdAt: Timestamp | Date;
    status: 'pending' | 'completed';
  }[];

  updatedAt: Timestamp;
}
```

### `withdrawal_requests/{withdrawalId}`

Withdrawal record. Created atomically with balance debit, then updated
with Stripe payout result.

```typescript
interface WithdrawalRequestDocument {
  withdrawalId: string;
  userId: string;
  amount: number;
  bankAccountLast4: string;       // Last 4 digits of Canadian bank account
  stripeAccountId: string;        // Seller's Stripe Connect Custom account
  stripePayoutId?: string;        // Stripe Payout ID (po_xxx) — set after payout created
  status: 'processing' | 'completed' | 'failed';
  failureReason?: string;         // Set if status is 'failed'
  failedAt?: Timestamp;           // Set if status is 'failed'
  createdAt: Timestamp;
}
```

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

  status: 'proposed' | 'accepted' | 'declined' | 'cancelled'
        | 'photos_pending' | 'shipping' | 'completed';
  message?: string;
  cashTopUp?: {
    amount: number;
    payerId: string;
  };
  partyId?: string;              // Linked swap party

  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

### `swapParties/{partyId}`

Swap party / zone events with time windows.

```typescript
interface SwapPartyDocument {
  name: string;
  emoji?: string;
  description?: string;
  theme?: string;
  isGeneralist?: boolean;
  status: 'upcoming' | 'active' | 'ended';
  startDate: Timestamp;
  endDate: Timestamp;
  participantsCount?: number;
  itemsCount?: number;
  swapsCount?: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

### `swapPartyParticipants/{docId}`

```typescript
interface SwapPartyParticipantDocument {
  partyId: string;
  userId: string;
  userName: string;              // Display name (written by joinSwapPartySecure)
  userImage?: string;            // Profile image URL (optional)
  itemIds: string[];             // Article IDs added to the party by this user
  joinedAt: Timestamp;
}
```

### `swapPartyItems/{docId}`

```typescript
interface SwapPartyItemDocument {
  partyId: string;
  articleId: string;
  sellerId: string;
  sellerName: string;            // Seller display name
  sellerImage?: string;          // Seller profile image URL
  title: string;                 // Article title
  price: number;                 // Article price
  imageUrl?: string;             // Article image URL
  isSwapped: boolean;            // Whether this item has been swapped (managed by Cloud Functions)
  isPending?: boolean;           // Item is in an active swap proposal (managed by Cloud Functions)
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
  size?: string;
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
  subcategory?: string;
  brand?: string;
  brands?: string[];
  color?: string;
  colors?: string[];
  material?: string;
  materials?: string[];
  size?: string;
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
