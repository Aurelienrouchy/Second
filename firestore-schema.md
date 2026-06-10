# Firestore Data Model - Second

## Collections Overview

| # | Collection | Type | Description |
|---|-----------|------|-------------|
| 1 | `articles` | Root | Main product listings (source of truth for articles) |
| 2 | `products` | Root | Legacy product docs (search index source, kept in sync) |
| 3 | `users` | Root | User profiles and preferences |
| 4 | `users/{uid}/savedSearches` | Sub-collection | User's saved search alerts |
| 5 | `users/{uid}/searchHistory` | Sub-collection | User's recent search queries |
| 5b | `users/{uid}/consents` | Sub-collection | Legal consent records (CGU, privacy policy, marketing) — server-write only |
| 5c | `usernames` | Root | Uniqueness registry for the immutable `@handle` (doc id = username) — server-only |
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
| 29 | `privacy_incidents` | Root | Privacy/security incident register (Loi 25 / RGPD breach log) — admin-read, server-write only |
| 30 | `disputes` | Root | Buyer "delivered but problem" tickets (CF-owned, freezes the linked transaction) |
| 31 | `automatic_decisions_log` | Root | Transparency log of automated decisions (Loi 25 art. 12.1) — party-read, server-write only |
| 32 | `automated_decision_contestations` | Root | Human-review requests against automated decisions (Loi 25 art. 12.1) — author-create, author/admin-read |
| 33 | `admin_alerts` | Root | Operator-facing alerts for non-auto-recoverable financial cases (F43/F85) — server-write only |
| 34 | `job_locks` | Root | Anti-overlap locks for scheduled jobs with paid side-effects (F82) — server-only |
| 35 | `brands` | Root | Brand catalog (seeded from `vinted-brands.txt`). Powers UI brand picker + IA brand matching. |

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
| `admin_alerts` | admin only | denied |
| `job_locks` | denied | denied |
| `platform_ledger` | admin only | denied |
| `privacy_incidents` | admin only | denied |
| `automatic_decisions_log` | party (buyer/seller of tx) / admin | denied |
| `automated_decision_contestations` | author / admin | author-create only (must be party to tx + self-tag `userId`); update/delete denied |
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
(immutable after creation), `deliveryType`, `buyerReport`, and the buyer-return
(B2) fields `returnLabelId`, `returnTrackingNumber`, `returnLabelUrl`,
`returnCarrierCode`, `returnLabelCost`, `returnReason`, `returnTrackingStatus`,
`returnRequestedAt`, `returnDeliveredAt`, and all server timestamps
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
  // Auto-approved on creation (no moderation flow yet). ABSENT on legacy
  // articles created before this field existed; the search-index trigger and
  // the backfill script treat absent === approved and only de-index on an
  // explicit 'pending' | 'rejected'.
  moderationStatus?: 'approved' | 'pending' | 'rejected';

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
  displayName: string;           // Freely editable; DECOUPLED from username.
  // Persistent, unique, IMMUTABLE @handle (e.g. "marie.dupont"). Derived ONCE
  // from displayName at account creation by the assignUsername callable (Admin
  // SDK, runTransaction) and reserved in the usernames/{username} registry.
  // Never chosen or editable by the user. Client cannot add/edit/remove it
  // (protected in firestore.rules on both create and update). Optional to
  // tolerate the brief transient state before assignment completes.
  username?: string;
  profileImage?: string;
  authProvider: 'password' | 'google' | 'apple'; // Set by onUserCreated trigger

  // Profile
  bio?: string;
  phoneNumber?: string;
  accountType?: 'user' | 'seller' | 'admin';

  // Age gate — ISO "YYYY-MM-DD" string (NOT a Date/object, to avoid timezone
  // drift). Written server-side by the recordSignupConsent callable after
  // validating age >= 16 (MIN_AGE_REGISTER). Selling (Stripe Connect onboarding)
  // additionally requires age >= 18 (MIN_AGE_SELL, enforced in createStripeConnectAccount).
  dateOfBirth?: string;

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
    sizes?: string[];                                    // Onboarding-derived clothing sizes (top + bottom merged)
    shoesSizes?: string[];                               // Onboarding-derived shoe sizes
    sex?: 'femme' | 'homme' | 'les-deux' | 'enfant';     // Onboarding-derived audience
    // AI profiling opt-in (RGPD). ABSENT or false => profilage IA DÉSACTIVÉ.
    // This is an opt-in flag: default = false.
    aiProfilingConsent?: boolean;
  };

  // Onboarding
  // NOTE: the legacy nested `onboardingPreferences` snapshot is no longer written
  // by saveOnboardingPreferences. Onboarding answers now live exclusively in the
  // canonical flat `preferences` map above (sizes / shoesSizes / sex). Some pre-
  // existing user docs may still carry an inert `onboardingPreferences` field that
  // is never read.
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

  // Stripe Connect Custom — ALL CF-only (Stripe webhook + onboarding callables
  // via Admin SDK). Locked in firestore.rules: a client can never self-set or
  // mutate these (payout redirect / KYC skip / fake bank verification).
  stripeAccountId?: string;        // Stripe Connect Custom account ID (acct_xxx)
  stripeAccountStatus?: 'pending' | 'pending_verification' | 'partially_active' | 'restricted' | 'active';
  stripeChargesEnabled?: boolean;  // Can receive payments via platform
  stripePayoutsEnabled?: boolean;  // Can receive payouts from Stripe
  stripeDetailsSubmitted?: boolean; // Onboarding details submitted
  stripeAccountCreatedAt?: Timestamp;
  stripeBankAccountAdded?: boolean;  // Bank account attached to Custom account
  stripeBankAccountLast4?: string;   // Last 4 digits of default bank account
  stripeBankAccountStatus?: string;  // Default external account verification (new|validated|verified|errored)
  // KYC continuous remediation (F59) — written by handleAccountUpdated +
  // getStripeAccountStatus + uploadStripeIdentityDocument. Never undefined.
  stripeRequirementsCurrentlyDue?: string[];   // Stripe requirements currently due
  stripeRequirementsPastDue?: string[];        // Past-due requirements (=> restricted)
  stripeRequirementsDisabledReason?: string | null; // Payout disabled reason, or null
  stripeRequirementsCurrentDeadline?: number | null; // Unix seconds deadline, or null

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

#### Sub-collection: `users/{uid}/consents/{autoId}`

Legal consent ledger. One document per accepted consent, append-only.

**Written SERVER-SIDE ONLY** by the `recordSignupConsent` and
`setMarketingConsent` callables (Admin SDK). Firestore rules: owner can READ;
`create/update/delete: if false` (no client writes ever). The `acceptedAt`
timestamp and `version` are authoritative proof of consent and must never be
client-tamperable.

```typescript
interface ConsentDocument {
  type: 'terms' | 'privacy_policy' | 'marketing';
  version: string;        // Policy version, e.g. "2026-05-31" (POLICY_VERSION)
  acceptedAt: Timestamp;  // serverTimestamp()
  channel: 'app';
  // Present on type 'marketing' docs written by setMarketingConsent:
  // true = consent granted, false = consent withdrawn. Each grant/withdrawal
  // appends a NEW doc (never mutates prior ones) — the ledger keeps the full
  // history (Loi 25 art. 14 / LCAP proof). Absent on legacy signup-time
  // marketing docs (implicitly granted at signup).
  granted?: boolean;
}
```

At signup, `recordSignupConsent` always writes `terms` + `privacy_policy`, and
additionally `marketing` only when the user opted in (`marketingOptIn === true`).

**`setMarketingConsent({ enabled })`** (callable, region
`northamerica-northeast1`): handles marketing consent grant/withdrawal post-signup.
It (a) appends a new `marketing` consent doc with `granted: enabled` (append-only
proof — existing docs are never modified), and (b) enforces the effect server-side
by setting `users/{uid}.preferences.marketingConsent = enabled` and the marketing
notification flags `preferences.notifications.{priceDrops, articleFavorited,
swapZoneReminder} = enabled`. Those flags are re-read by the favorites triggers
before any send, so a withdrawal stops all marketing emissions. Returns
`{ ok: true, enabled }`.

The `users/{uid}.preferences.aiProfilingConsent` boolean flag (opt-in AI
profiling, default **false** / absent ⇒ disabled) is a SEPARATE preference,
managed via the preferences flow — NOT written by `recordSignupConsent`.

### `usernames/{username}`

Uniqueness registry for the unique, immutable `@handle`. The document ID **is**
the username (e.g. `usernames/marie.dupont`). Acts as a lock: reserving the doc in
a transaction guarantees a username is owned by exactly one user.

**WRITTEN SERVER-SIDE ONLY** (Admin SDK, inside a `runTransaction`) by:
`recordSignupConsent` (chosen-username reservation at signup, primary path),
`assignUsername` (auto-derived legacy/rescue path), and the `backfillUsernames`
script. Firestore rules: `read, write: if false` — fully server-only (no client
read either: this prevents username enumeration and the mapping leaks nothing
useful client-side).

```typescript
interface UsernameDocument {
  uid: string;          // The user that owns this username
  createdAt: Timestamp; // serverTimestamp() (or the user's createdAt for backfilled entries)
  backfilled?: boolean; // present only on entries created by backfillUsernames
}
```

**PIVOT (2026-06): user-chosen handle.** The handle is now CHOSEN by the user on
the signup route (not auto-derived). The format rules for a chosen handle live in
`functions/src/callable/username.ts` as `validateChosenUsername()`:
- length **3–20** (`USERNAME_MIN_LEN = 3`, `CHOSEN_USERNAME_MAX_LEN = 20`),
- charset `[a-z0-9._-]`,
- no leading/trailing separator, no doubled separators.
Input is trimmed + lowercased, otherwise accepted/rejected as typed (no
transliteration). This validator is shared by both the availability probe and the
submit, so they can never drift.

**`checkUsernameAvailability()`** (callable, `northamerica-northeast1`, 512MiB,
auth required): read-only probe (client debounces ~350ms). Input `{ username }`.
Output `{ ok: true, available: boolean, reason?: 'too_short' | 'too_long' |
'invalid_chars' | 'taken' }`. Reserves NOTHING; a direct `usernames/{username}`
doc lookup (no query). Anti-enumeration: never reveals the owning uid.

**`recordSignupConsent()`** (callable, single submit entry point): reserves the
chosen handle ATOMICALLY with the consent write in one `runTransaction`. Input
adds `desiredUsername?`. Re-validates format server-side; if taken by ANOTHER uid
→ `HttpsError('already-exists', …, { field: 'username' })` (NO auto suffix —
inline field error client-side, account NOT rolled back). Idempotent: an existing
`users/{uid}.username` is immutable and returned unchanged. Output
`{ ok: true, age, username? }`.

**`assignUsername()`** (callable, `northamerica-northeast1`, 512MiB): LEGACY /
RESCUE auto-derivation. Derives a slug from `displayName` (transliterate accents →
lowercase → spaces to `.` → strip chars outside `[a-z0-9._-]` → collapse repeated
separators → trim borders, bounded 3–30 chars, deterministic `user.<uid6>`
fallback). If the slug is taken, appends a numeric suffix (`.2`, `.3`, …). Reserves
`usernames/{final}` + writes `users/{uid}.username = final` in a transaction.
**Idempotent / immutable**. Still wired as the `authStore` rescue net for legacy
accounts that signed up before the chosen-username route existed.

**`backfillUsernames` script** (`functions/scripts/backfillUsernames.ts`, run by
the founder locally, NOT deployed): one-shot idempotent backfill that guarantees
every `users/*` with a `username` has a matching `usernames/{username}` entry.
Conflicts (registry entry owned by a different uid) are logged and LEFT UNTOUCHED.
Run order prerequisite — see deploy order below.

### `privacy_incidents/{incidentId}`

Privacy/security incident register (Loi 25 / RGPD breach log). **WRITTEN
SERVER-SIDE ONLY** (Admin SDK via the `reportPrivacyIncident` callable and
automated handlers such as the `deletion_failed` path in `deleteUserAccount`).
Firestore rules: **admin READ only**; `create/update/delete: if false`.

```typescript
interface PrivacyIncidentDocument {
  type: string;            // e.g. "data_breach", "deletion_failed", "unauthorized_access"
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  detectedAt: Timestamp;   // serverTimestamp()
  affectedUserIds: string[];
  affectedDataFields: string[];
  measures: string;        // mitigation/remediation taken or planned
  notifiedCAI: boolean;    // whether the Commission d'accès à l'information was notified
  notifiedCAIAt?: Timestamp;  // serverTimestamp() — set by escalatePrivacyIncidentToCAI
  caiReference?: string | null; // CAI dossier reference, or null if none provided
  notifiedUsersAt?: Timestamp;  // serverTimestamp() — set by notifyAffectedUsers once fan-out completes
  status: 'open' | 'investigating' | 'contained' | 'resolved';
}
```

**Escalation thresholds (Loi 25 — "incident de confidentialité"):** `severity`
`critical`/`high` ⇒ CAI notification **mandatory**; `medium` ⇒ at the privacy
officer's discretion; `low` ⇒ register-only. Target delay: **72 h** from
`detectedAt` to `notifiedCAIAt` / `notifiedUsersAt` (auditable via those stamps).

Escalation is performed **server-side only** by two admin-only callables:
- `escalatePrivacyIncidentToCAI(incidentId, caiReference?)` — sets `notifiedCAI=true`,
  `notifiedCAIAt`, `caiReference`, and advances `status` `open → investigating`
  (never regresses a more advanced status).
- `notifyAffectedUsers(incidentId, message)` — sends a `privacy_incident` in-app
  notification (best-effort per user) to each `affectedUserIds` entry and stamps
  `notifiedUsersAt`.

### Data-retention purge (`retentionPurge` scheduled function)

Daily hard-delete of stale personal data (Loi 25 / RGPD data minimisation):

| Target | Threshold | Notes |
|--------|-----------|-------|
| `articles` (`isActive === false`) | `updatedAt` > 3 years | composite index `(isActive ASC, updatedAt ASC)` |
| `guest_preferences` | `createdAt` > 90 days | |
| `notifications` | `createdAt` > 180 days | |
| `users/{uid}/searchHistory` | `timestamp` > 12 months | collection-group index on `timestamp` |
| `drafts` | `updatedAt` > 90 days | abandoned sell-flow drafts; staleness = last modification |

`transactions` are **never** purged (7-year legal/accounting retention).

### `automatic_decisions_log/{logId}`

Transparency log of decisions taken **without human intervention** (Loi 25,
art. 12.1). **WRITTEN SERVER-SIDE ONLY** by the `logAutomatedDecision` helper,
called from the scheduled jobs `releaseHeldFunds` / `expireOrphanedTransactions`
/ `sweepPendingLabels` **after** the monetary move succeeds (best-effort, never
rolls back the money move). Firestore rules: **READ by a party** (buyer or
seller of the linked transaction, resolved via `get()`) **or admin**;
`create/update/delete: if false`.

```typescript
interface AutomaticDecisionLogDocument {
  transactionId: string;        // links the decision to a transaction
  userId: string;               // the party the decision concerns (seller for funds_released, buyer for refunds/expiry)
  decisionType: 'funds_released' | 'transaction_expired' | 'label_refund';
  criteria: Record<string, unknown>; // human-readable criteria that drove the decision (e.g. { status, disputed, fundsReleaseAt, disputeWindowDays })
  result: string;               // human-readable outcome summary
  executedAt: Timestamp;        // serverTimestamp()
}
```

The three automated decisions: `funds_released` (heldBalance→balance after the
7-day dispute window, `releaseHeldFunds`), `transaction_expired`
(meetup 48h / pending_payment 1h / paid-not-shipped 7d cancellation,
`expireOrphanedTransactions`), `label_refund` (refund after the shipping label
could never be created, `sweepPendingLabels`). At the moment of each decision
the affected party also receives an in-app/push notification stating the
decision was **automatic** and that it can be contested.

Composite index required (used by `getAutomatedDecisionLog`):
`(transactionId ASC, executedAt DESC)`.

### `automated_decision_contestations/{contestationId}`

Human-review requests against an automated decision (Loi 25, art. 12.1 right to
request human intervention). Opened by the `contestAutomatedDecision` callable
(Admin SDK). **REVERSES NOTHING automatically** — a human agent decides the
outcome out-of-band. Firestore rules: **READ by the author** (`userId`) **or
admin**; **CREATE allowed for the authenticated author** scoped to being a party
(buyer/seller) of the linked transaction and self-tagging `userId == uid`;
`update/delete: if false`.

```typescript
interface AutomatedDecisionContestationDocument {
  transactionId: string;
  userId: string;               // the contesting user (author == request.auth.uid)
  buyerId: string | null;       // snapshot of the transaction parties
  sellerId: string | null;
  decisionType: 'funds_released' | 'transaction_expired' | 'label_refund';
  reason: string;               // free-text justification (capped 2000 chars)
  status: 'open';               // opened; resolution is admin/CF-owned
  createdAt: Timestamp;         // serverTimestamp()
}
```

Opening a contestation also writes a low-severity `privacy_incidents` register
entry (`type: 'automated_decision_contestation'`) so the on-call admin dashboard
surfaces it for human review.

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
  //   Buyer return (B2 — non-conforming item, anti-fraud): delivered (shipping,
  //   inside the 7-day window) -> return_requested. requestReturn buys a RETURN
  //   label (origin=buyer, destination=seller), freezes funds (disputed=true),
  //   stores returnLabelId/returnTrackingNumber/returnLabelUrl/returnLabelCost/
  //   returnReason. NO refund yet. The refund (buyer = total - returnLabelCost,
  //   seller debited their payout) is issued ONLY when the carrier confirms the
  //   RETURN parcel DELIVERED back to the seller (poller + ShipEngine webhook ->
  //   utils/returnRefund.ts), at which point return_requested -> refunded with
  //   returnDeliveredAt. The buyer bears the return label cost.
  status: 'pending_payment' | 'meetup_pending' | 'meetup_confirmed'
        | 'meetup_completed' | 'paid' | 'label_created' | 'shipped'
        | 'delivered' | 'completed' | 'cancelled' | 'disputed' | 'refunded'
        | 'refund_in_progress' | 'delivery_failed' | 'lost' | 'return_requested';
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
  disputed?: boolean;              // True while a dispute is open (Stripe chargeback OR buyer report).
                                   // Blocks seller withdrawals AND held-funds release (releaseHeldFunds
                                   // no-ops while disputed === true).
  disputedAt?: Timestamp;
  disputeReason?: string;
  statusBeforeDispute?: string;    // Status captured at dispute.created (or buyer report), restored if won
  disputeFreezeCents?: number;     // Exact amount moved balance -> heldBalance at dispute.created;
                                   // released back to balance by dispute.closed (won/closed, or LOST surplus)
  disputeOutcome?: 'won' | 'lost' | 'dismissed' | string; // Set by charge.dispute.closed; 'dismissed' by resolveDispute (admin closes in favor of seller, no refund)
  disputeClosedAt?: Timestamp;
  disputeResolvedAt?: Timestamp;   // Set by resolveDispute (admin dismissal — F27/F88/F10)
  disputeResolutionNote?: string;  // Optional admin note attached by resolveDispute (<= 500 chars)
  returnEscalatedAt?: Timestamp;   // F26: set ONCE by expireOrphanedTransactions when a return_requested
                                   // leg has no DELIVERED scan after 21d — a dispute doc is opened for admin review
  buyerReport?: {                  // Set by reportTransactionProblem (buyer "delivered but problem").
    reason: 'not_received_despite_delivered' | 'not_as_described' | 'damaged' | 'other';
    details?: string;              // Optional free text (<= 1000 chars; omitted when empty)
    reportedAt: Timestamp;
  };
  refundInitiatedAt?: Timestamp;   // Stamped by requestRefund when status -> refund_in_progress
                                   // (buyer auto-refund on carrier-confirmed delivery_failed/lost).
                                   // Cleared on rollback if the refund core throws.

  // Buyer return leg (B2) — set by requestReturn; refund issued on return DELIVERED.
  returnLabelId?: string;          // ShipEngine label id of the RETURN parcel (buyer -> seller)
  returnTrackingNumber?: string;   // Tracking number of the RETURN parcel (polled / webhook-matched)
  returnLabelUrl?: string | null;  // Downloadable PDF of the return label
  returnCarrierCode?: string | null; // Carrier of the return parcel (poller getTracking)
  returnLabelCost?: number;        // Real cost of the return label in DOLLARS; borne by the buyer
                                   // (return refund = totalAmount - returnLabelCost).
  returnReason?: 'not_as_described' | 'damaged' | 'wrong_item' | 'other';
  returnTrackingStatus?: string;   // Best-effort visibility of the return parcel's mapped status
  returnRequestedAt?: Timestamp;   // Stamped when the buyer requested the return (status -> return_requested)
  returnDeliveredAt?: Timestamp;   // Stamped when the carrier confirmed the seller received the return
                                   // (the moment the return-leg refund is issued -> status 'refunded').

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
  stripeTransferId?: string;      // Platform->connected transfer (tr_xxx) — persisted at walletWithdraw
                                  // so a lost payout.failed can be reverted (revertFailedPayout)
  stripePayoutId?: string;        // Stripe Payout ID (po_xxx) — persisted at walletWithdraw + payout.* webhook
  status: 'processing' | 'completed' | 'failed';
  failureReason?: string;         // Set if status is 'failed'
  failedAt?: Timestamp;           // Set if status is 'failed'
  completedAt?: Timestamp;        // Set if status is 'completed'
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

### `shops/{shopId}` — paid-tier fields (F134)

Shops are owner-writable for profile fields but the validation status, the
verification metadata, and the **paid forfait tier** are admin/Cloud-Function
owned (firestore.rules `match /shops`). The fee-reduction tier and its expiry are
set ONLY by the `shop_tier` webhook (`handleShopTierSucceeded`) after a
`purchaseShopTier` PaymentIntent succeeds — a client can never self-attribute a
tier (CF-only fields locked on both create and update).

```typescript
interface ShopTierFields {
  // CF-ONLY (locked in firestore.rules — set by the shop_tier webhook):
  tier?: 'pro' | 'premium';        // basic (absent) → 0 reduction; pro → 0.5; premium → 1
  tierPaidUntil?: Timestamp;       // Forfait active only while > now; expired → basic (reduction 0)
  tierPaymentIntentId?: string;    // Idempotence guard (replay of same PI is a no-op)
  tierChargeId?: string | null;
}
```

The buyer-fee reduction (`resolveBuyerFeeReduction`, `callable/payments.ts`) is
honoured ONLY when `status === 'approved'` AND `tierPaidUntil > now`. Pricing:
`SHOP_TIER_PRO_MONTHLY_CENTS` (2999) / `SHOP_TIER_PREMIUM_MONTHLY_CENTS` (7999),
overridable by env. Swap top-ups DELIBERATELY do not get the reduction (peer
balancing payment, no shop relationship).

### `platform_ledger/{entryId}`

Append-only platform accounting ledger (server-only). Records platform-side
revenue and financial variances for tax/audit traceability — does not move user
funds. Writers:
 - `reconcileShippingCost` (`utils/labelFulfillment.ts`) — shipping cost variance.
 - `recordTransactionRevenue` (`utils/labelFulfillment.ts`, E6/F133c) — gross
   revenue + tax per purchase (deterministic doc id, idempotent).
 - `handleShopTierSucceeded` (`http/webhooks.ts`, F134) — paid-shop forfait revenue.

Doc ids are DETERMINISTIC for the revenue entries (`service_fee_revenue_${txId}`,
`tax_collected_${txId}`, `shop_tier_revenue_${paymentIntentId}`) so a webhook
replay overwrites the same id — exactly one entry per transaction / forfait.

```typescript
type PlatformLedgerDocument =
  | {
      type: 'shipping_cost_variance';   // Real label cost differed from the billed estimate
      transactionId: string;
      estimatedShippingCost: number;    // shippingCost billed to the buyer (dollars)
      actualShippingCost: number;       // Real ShipEngine label cost (dollars)
      delta: number;                    // actual - estimated (dollars). Logged CRITICAL when |delta| > $2
      currency: 'cad';
      createdAt: Timestamp;
    }
  | {
      // E6 / F133c — platform GROSS revenue for one successful purchase. Net
      // margin = serviceFee − processorFees − shippingCost (computable here).
      type: 'service_fee_revenue';
      transactionId: string;
      sellerId: string;
      serviceFee: number;               // buyer protection fee collected (dollars)
      taxCollected: number;             // TPS/TVQ on the fee (dollars; 0 when TAX_ENABLED=false)
      shippingCostCollected: number;    // shipping billed to the buyer (dollars)
      grossRevenue: number;             // serviceFee + taxCollected + shippingCostCollected
      processorFees?: number;           // Stripe fee on the charge (balance_transaction.fee, dollars)
      netMargin?: number;               // serviceFee − processorFees − shippingCostCollected
      currency: 'cad';
      createdAt: Timestamp;
    }
  | {
      // F133c — tax remittance register entry (only when TAX_ENABLED=true).
      type: 'tax_collected';
      transactionId: string;
      taxTotal: number;                 // TPS + TVQ on the service fee (dollars)
      currency: 'cad';
      createdAt: Timestamp;
    }
  | {
      // F134 — paid-shop forfait revenue (direct platform charge).
      type: 'shop_tier_revenue';
      shopId: string;
      ownerId: string | null;
      tier: 'pro' | 'premium';
      periodMonths: number;
      amount: number;                   // forfait price paid (dollars)
      paymentIntentId: string;
      chargeId: string | null;
      currency: 'cad';
      createdAt: Timestamp;
    };
```

> **Taxes TPS/TVQ (F133) — activation = DÉCISION FISCALE DU FONDATEUR.** Le rail
> de taxe (`utils/fees.ts`, flag `TAX_ENABLED`, défaut `false`) est une
> infrastructure : OFF, la taxe vaut 0 et `buyerTotal` est inchangé. Activer
> `TAX_ENABLED=true` exige l'**immatriculation TPS (fédéral) + TVQ (Revenu
> Québec)** et le dépassement du seuil de petit fournisseur (30 000 $/4 trim.).
> Seul le **service fee** est taxé (fourniture taxable en facilitateur de
> marketplace) ; le **shipping refacturé est HORS SCOPE** — à trancher avec un
> fiscaliste avant de le taxer. Taux réglables par env : `GST_RATE` (0.05),
> `QST_RATE` (0.09975).

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

### `admin_alerts/{alertId}` (F43/F85)

Operator-facing alerts for financial cases code CANNOT self-heal — distinct from
`failed_operations` (the auto-retry queue). Written via `writeAdminAlert`
(`utils/failedOperations.ts`, best-effort, never throws). The admin console reads
`status == 'open'`. Server-write only; admin read.

```typescript
interface AdminAlertDocument {
  kind:
    | 'payout_recredit_no_wallet'  // payout failed but the wallet to re-credit is gone (F43)
    | 'dead_letter_exhausted'      // a failed_operation exhausted MAX_ATTEMPTS (F85)
    | 'refund_failed'              // Stripe refund.failed — buyer not reimbursed (F104)
    | 'wallet_invariant_breach';   // reconcileBalances found a negative bucket (F85)
  severity: 'critical' | 'warning';
  refId: string;                   // primary entity id (withdrawal/transaction/PI/wallet)
  message: string;                 // human-readable (FR) console message
  context: Record<string, any>;    // triage data
  status: 'open';                  // operators close manually
  createdAt: Timestamp;
}
```

### `job_locks/{jobName}` (F82)

Anti-overlap lock for scheduled jobs that perform PAID external side-effects (e.g.
`sweepPendingLabels` — ShipEngine labels). `acquireJobLock(jobName, ttlMs)` runs a
transaction that takes the lock only if free OR expired (TTL guards a crashed run);
`releaseJobLock` clears it in a `finally`. Server-only.

```typescript
interface JobLockDocument {
  lockedAt: Timestamp;
  lockedUntil: Timestamp;  // now + ttlMs while held; Timestamp(0) when released
  releasedAt?: Timestamp;
}
```

### Webhook infrastructure (`stripeWebhook` / `shipEngineWebhook`)

`stripeWebhook` (`http/webhooks.ts`) accepts events from **two distinct Stripe
endpoint registrations that must both point at the same Cloud Function URL**
(`https://northamerica-northeast1-seconde-b47a6.cloudfunctions.net/stripeWebhook`):

| Stripe endpoint | Events | Signing secret |
| --- | --- | --- |
| PLATFORM | `payment_intent.*`, `charge.refunded`, `charge.dispute.*` (incl. `funds_withdrawn`/`funds_reinstated`), `refund.failed`/`refund.updated`, `transfer.reversed` | `STRIPE_WEBHOOK_SECRET` |
| CONNECT  | `payout.paid`, `payout.failed`, `payout.canceled`, `account.updated`, connected-account disputes | `STRIPE_CONNECT_WEBHOOK_SECRET` |

Each endpoint signs with its own secret. The handler tries `constructEvent` with
every configured secret and only rejects (401) when **none** verify (F100). Both
secrets live in Secret Manager and are declared in the function `secrets` array.

Newly-handled events (F42/F104/F106): `payout.canceled` (treated like
`payout.failed` → `revertFailedPayout`); `refund.failed` / `refund.updated`→failed
(raise a critical `admin_alerts` doc — the internal tx says 'refunded' but the
buyer was never reimbursed); `charge.dispute.funds_withdrawn`/`funds_reinstated`,
`transfer.reversed` (informational — log + ACK 200, never 400). A lost
`payment_intent.succeeded` is dead-lettered (`kind: lost_pi_succeeded_webhook`) and
auto-replayed by `retryFailedOperations` via `redrivePaymentIntentSucceeded` (F77).

Idempotence: each event is deduped by a `stripe_events/{event.id}` marker that is
written **only after the handler succeeds** — a handler that throws leaves no
marker so Stripe re-delivers (3-day retry window) and the event is replayed; the
per-handler status guards make a replay safe (F3). The collection is server-only.
Each marker carries `expiresAt = now + 90d` (F107) so a Firestore **TTL policy on
`stripe_events.expiresAt`** can purge old markers (90d ≫ Stripe's 3-day retry
window). The TTL policy itself is a console/gcloud action (founder).

`shipEngineWebhook` (`http/shipEngineWebhook.ts`) is the intended primary tracking
path (the every-12h `checkShippedTracking` poller is the safety net). It is
authenticated by the `SHIPENGINE_WEBHOOK_SECRET` shared secret (header
`X-ShipEngine-Webhook-Secret` or `?secret=` query, timing-safe; fail-closed 500 if
the secret is unset). The function must be DEPLOYED and its URL+secret REGISTERED in
ShipEngine for the webhook to fire (else it returns 404 — manual founder action).

### `disputes/{disputeId}`

Dispute tickets (server-only writes). Created by `reportTransactionProblem`
(buyer flags a delivered-but-problematic order), `reportMeetupNoShow`
(`type: 'meetup_no_show'`), or `expireOrphanedTransactions`
(`type: 'return_not_delivered'`, F26 — a return leg never scanned DELIVERED).
NO money moves at creation — the parent transaction is frozen (`disputed=true`).
A dispute is CLOSED by either `adminRefundTransaction` (refund the buyer →
`resolution: 'refunded'`) or `resolveDispute` (admin dismisses in favor of the
seller, no refund → `resolution: 'dismissed'`). Closing a dispute is what lets
the admin list empty AND unblocks both parties' account deletion (F27/F88).

```typescript
interface DisputeDocument {
  transactionId: string;           // Parent transaction
  buyerId: string | null;          // Reporting/affected buyer (== transaction.buyerId)
  sellerId: string | null;
  articleId: string | null;
  articleTitle: string | null;
  type?: 'meetup_no_show' | 'return_not_delivered' | string; // omitted for the buyer "delivered but problem" report
  reason:
    | 'not_received_despite_delivered'
    | 'not_as_described'
    | 'damaged'
    | 'return_leg_stale'
    | 'other'
    | string;
  details?: string;                // Optional free text (<= 1000 chars; omitted when empty)
  reportedBy?: string;             // Who filed (meetup no-show / generic reports)
  reportedAgainst?: string | null; // The accused party (meetup no-show)
  status: 'open' | 'resolved';     // 'open' at creation; closed by admin CFs
  resolution?: 'refunded' | 'dismissed'; // Set when status -> 'resolved'
  resolvedBy?: string;             // Admin uid that closed the dispute
  resolvedAt?: Timestamp;
  resolutionNote?: string;         // Optional admin note (<= 500 chars)
  statusBeforeDispute: string;     // Transaction status captured at report time
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

  // Full lifecycle (ordered). 'payment_pending' only occurs when cashTopUp is set:
  //   proposed -> accepted -> photos_pending -> shipping -> completed
  //   proposed -> payment_pending -> accepted -> ... (cash top-up swaps)
  //   proposed -> declined | cancelled
  //   payment_pending -> cancelled (initiator) | expired by cron
  //   accepted | photos_pending | shipping | completed(in-window) -> disputed (openSwapDispute, F48)
  //   accepted | photos_pending | shipping -> expired (expireStalePostAcceptanceSwaps, 14d, F51/F52)
  //   disputed -> cancelled (admin refund_payer) | completed (admin release_payee) (resolveSwapDispute, F48)
  status: 'proposed' | 'payment_pending' | 'accepted' | 'declined' | 'cancelled'
        | 'photos_pending' | 'shipping' | 'completed' | 'disputed' | 'expired';
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
  topUpPaidAt?: Timestamp;       // set on payment_intent.succeeded (swap_topup): pendingBalance credited
  // Post-reception buyer-protection window (7 days), mirrors a delivered purchase:
  topUpFundsHeldAt?: Timestamp;  // set at confirmSwapReception: pendingBalance -> heldBalance
  topUpFundsReleaseAt?: Timestamp; // = topUpFundsHeldAt + 7d; releaseHeldFunds sweeps when due
  topUpReleasedAt?: Timestamp;   // set by releaseHeldFunds OR resolveSwapDispute(release_payee)
                                 // (held/pending -> balance, withdrawable). While UNSET (pre-reception
                                 // or in-window), the top-up is still refundable to the payer.
  topUpRefundId?: string;        // Stripe refund id (cancel/dispute/expiration)
  topUpRefundedAt?: Timestamp;
  topUpRefundReconciledAt?: Timestamp; // wallet debit reconciled via charge.refunded

  // Dispute fields (F48). openSwapDispute FREEZES the swap (no auto-refund); the
  // money decision is reserved for the admin callable resolveSwapDispute.
  statusBeforeDispute?: string;  // status captured when the dispute was opened
  disputeReason?: string;        // free text (<=1000 chars)
  disputeOpenedBy?: string;      // uid of the participant who opened it
  disputeOpenedAt?: Timestamp;
  disputeResolvedBy?: string;    // admin uid (resolveSwapDispute)
  disputeResolvedAt?: Timestamp;
  disputeOutcome?: 'refund_payer' | 'release_payee'; // admin ruling
  disputeResolutionNote?: string; // admin note (<=500 chars)
  cancelReason?: string;         // e.g. cancelled_by_initiator | dispute_resolved_refund_payer
                                 //      | post_acceptance_expired_14d_from_<status>

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
- `sellerDebt` — shortfall owed after a refund or lost dispute where the seller's funds were already withdrawn; blocks all future withdrawals until cleared. **Recovered automatically**: the next sale credit (`creditSellerForSale`) and the 7-day release (`releaseHeldFunds`) pay it down FIRST, with a `debt_repayment` ledger entry, before the remainder lands in `pendingBalance`/`balance`.

**Single-rail money model (separate charges & transfers).** Every buyer charge — pure card, mixed wallet+card, and swap top-up — lands on the PLATFORM account (NO `transfer_data.destination`, NO `application_fee_amount` at capture). The platform keeps the funds (which include the `shippingCost` used to pay the ShipEngine label and the `serviceFee`). The seller is credited ONLY in the wallet ledger and paid out by the SINGLE platform→connected transfer in `walletWithdraw`. Consequently a refund is a plain `stripe.refunds.create` on the platform PaymentIntent — there is NO transfer to reverse and NO application fee to claw back.

Fund flow per sale: `pendingBalance` (paid) → `heldBalance` (delivered, `applyDeliveredHeldFunds`) → `balance` (`releaseHeldFunds` after 7d). On `charge.dispute.created` any released portion is moved `balance → heldBalance` and the exact amount is persisted as `transactions.disputeFreezeCents`; `charge.dispute.closed` releases the frozen hold back to `balance` (won / warning_closed, `dispute_hold_released`) or debits the seller (lost, cascading `pendingBalance → heldBalance → balance`, recording `sellerDebt` if insufficient, and releasing any frozen surplus the debit did not consume).

Refund debit (any path: `charge.refunded` FULL only, `refundWalletPayment`, lost dispute): the seller is debited of EXACTLY `transactions.sellerCreditedCents` (the amount credited at payment), cascading `pendingBalance → heldBalance → balance` to drain wherever the funds currently sit. Any remainder the seller no longer holds (already withdrawn) is added to `sellerDebt` and recorded in a `refund_debit` ledger entry with `debtRecorded` — never masked with `min()`. On a mixed wallet+card refund, the buyer's wallet portion (`walletAmountUsed`) is re-credited to the buyer's wallet (internal movement) while the card portion is returned to the card by the upstream plain Stripe refund. A PARTIAL `charge.refunded` (`amount_refunded < amount`) does NOT unwind the sale — it is dead-lettered for human review.

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
    | 'dispute_hold_released' // dispute won/closed: heldBalance -> balance (hold returned)
    | 'debt_repayment'     // sale credit / release applied to sellerDebt first
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
