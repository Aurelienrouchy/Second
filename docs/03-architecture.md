# Architecture

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         FREEPE ARCHITECTURE                         │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   iOS App       │     │  Android App    │     │   (Web App)     │
│   (Expo)        │     │   (Expo)        │     │   (Optional)    │
└────────┬────────┘     └────────┬────────┘     └────────┬────────┘
         │                       │                       │
         └───────────────────────┼───────────────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │   Firebase Services     │
                    │  ┌───────────────────┐  │
                    │  │   Authentication  │  │
                    │  │   (Email/Social)  │  │
                    │  └───────────────────┘  │
                    │  ┌───────────────────┐  │
                    │  │ Cloud Firestore   │  │
                    │  │    (Database)     │  │
                    │  └───────────────────┘  │
                    │  ┌───────────────────┐  │
                    │  │  Cloud Storage    │  │
                    │  │    (Images)       │  │
                    │  └───────────────────┘  │
                    │  ┌───────────────────┐  │
                    │  │ Cloud Functions   │  │
                    │  │   (Backend)       │──┼──┐
                    │  └───────────────────┘  │  │
                    │  ┌───────────────────┐  │  │
                    │  │ Cloud Messaging   │  │  │
                    │  │   (Push)          │  │  │
                    │  └───────────────────┘  │  │
                    └─────────────────────────┘  │
                                                 │
                    ┌────────────────────────────┼────────────────┐
                    │    External Services       │                │
                    │  ┌───────────────────┐     │                │
                    │  │     Stripe        │◄────┘                │
                    │  │   (Payments)      │                      │
                    │  └───────────────────┘                      │
                    │  ┌───────────────────┐                      │
                    │  │     Shippo        │◄─────────────────────┤
                    │  │   (Shipping)      │                      │
                    │  └───────────────────┘                      │
                    └─────────────────────────────────────────────┘
```

## Mobile App Architecture

### Layer Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     PRESENTATION LAYER                          │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    Screens (app/)                        │   │
│  │  • (tabs)/ - Main navigation                            │   │
│  │  • settings/ - User settings                            │   │
│  │  • article/[id] - Article detail                        │   │
│  │  • chat/[id] - Chat conversation                        │   │
│  │  • shop/[id] - Shop profile                             │   │
│  └─────────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                   Components (components/)               │   │
│  │  • ProductCard, ProductGrid, ArticleGrid                │   │
│  │  • ChatBubble, OfferBubble                              │   │
│  │  • SearchFiltersBottomSheet                              │   │
│  │  • ShippingAddressForm, ShipmentTracking                │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      STATE LAYER                                │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                  Contexts (contexts/)                    │   │
│  │  • AuthContext - User authentication state              │   │
│  │  • ChatContext - Active chat management                 │   │
│  │  • FavoritesContext - Favorited articles                │   │
│  │  • NotificationContext - Push notification state        │   │
│  │  • LanguageContext - i18n                               │   │
│  └─────────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    Hooks (hooks/)                        │   │
│  │  • useArticleSearch - Article search with filters       │   │
│  │  • useChat - Chat functionality                         │   │
│  │  • useAuthRequired - Auth guard                         │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     SERVICE LAYER                               │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                 Services (services/)                     │   │
│  │  • articlesService - Article CRUD & search              │   │
│  │  • authService - Authentication flows                   │   │
│  │  • chatService - Messaging                              │   │
│  │  • shopService - Shop management                        │   │
│  │  • transactionService - Payments & orders               │   │
│  │  • userService - User profiles                          │   │
│  │  • favoritesService - Favorites management              │   │
│  │  • notificationService - Push notifications             │   │
│  │  • sellerBalanceService - Seller earnings               │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      DATA LAYER                                 │
│  ┌──────────────────────┐  ┌────────────────────────────────┐  │
│  │   Firebase SDK       │  │      Types (types/)            │  │
│  │   • Firestore        │  │  • Article, User, Chat         │  │
│  │   • Auth             │  │  • Transaction, Shop           │  │
│  │   • Storage          │  │  • Message, Notification       │  │
│  │   • Functions        │  │  • SearchFilters               │  │
│  └──────────────────────┘  └────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## Navigation Structure

```
app/
├── _layout.tsx              # Root layout (providers)
├── index.tsx                # Entry point (redirect)
├── auth.tsx                 # Authentication screen
├── onboarding.tsx           # First-time user flow
├── +not-found.tsx           # 404 handler
│
├── (tabs)/                  # Tab navigator
│   ├── _layout.tsx          # Tab bar configuration
│   ├── index.tsx            # Home feed
│   ├── search.tsx           # Search & explore
│   ├── sell.tsx             # Create listing
│   ├── messages.tsx         # Chat list
│   └── profile.tsx          # User profile
│
├── settings/                # Settings stack
│   ├── _layout.tsx          # Settings navigation
│   ├── index.tsx            # Settings menu
│   ├── profile-details.tsx  # Edit profile
│   ├── address.tsx          # Delivery address
│   ├── payments.tsx         # Payment methods
│   ├── shipping-options.tsx # Shipping preferences
│   ├── notifications.tsx    # Notification settings
│   ├── privacy.tsx          # Privacy settings
│   └── ... (10+ screens)
│
├── article/
│   └── [id].tsx             # Article detail
│
├── chat/
│   └── [id].tsx             # Chat conversation
│
├── shop/
│   └── [id].tsx             # Shop profile
│
├── payment/
│   └── [transactionId].tsx  # Payment flow
│
├── admin/
│   ├── shops.tsx            # Shop moderation list
│   └── shop-detail/
│       └── [id].tsx         # Shop approval
│
├── favorites.tsx            # Saved articles
├── my-articles.tsx          # User's listings
├── seller-balance.tsx       # Earnings dashboard
├── search-results.tsx       # Search results
└── filters.tsx              # Advanced filters
```

## Cloud Functions Architecture

```
functions/src/index.ts
│
├── SEARCH & INDEXING
│   ├── updateSearchIndex     - Triggered on article create/update
│   └── cleanupSearchIndex    - Scheduled daily cleanup
│
├── STATISTICS
│   ├── updateUserStats       - Triggered on article changes
│   ├── updateGlobalStats     - Aggregates platform metrics
│   └── updatePopularityScores - Scheduled score calculation
│
├── USER ACTIONS
│   ├── incrementProductView  - Called to track views
│   └── toggleProductLike     - Called to like/unlike
│
├── MESSAGING
│   ├── sendMessageNotification      - Triggered on new message
│   └── sendOfferStatusNotification  - Triggered on offer status change
│
├── SHIPPING (Shippo)
│   └── getShippingEstimate   - Callable for rate quotes
│
└── PAYMENTS (Stripe)
    ├── createPaymentIntent   - Callable for checkout
    ├── stripeWebhook        - HTTP endpoint for Stripe events
    └── checkTrackingStatus   - Scheduled tracking updates
```

## Data Flow Patterns

### Article Creation Flow
```
User                 App                  Service              Firebase
 │                    │                      │                    │
 │─ Fill form ───────>│                      │                    │
 │                    │─ createArticle() ───>│                    │
 │                    │                      │─ addDoc() ────────>│
 │                    │                      │<─ docRef ──────────│
 │                    │                      │─ uploadImages() ──>│
 │                    │                      │<─ URLs ────────────│
 │                    │                      │─ updateDoc() ─────>│
 │                    │<─ articleId ─────────│                    │
 │<─ Success ─────────│                      │                    │
 │                    │                      │                    │
                         Firebase Trigger: updateSearchIndex()
```

### Purchase Flow
```
Buyer        App           Functions         Stripe        Shippo
 │            │                │                │             │
 │─ Accept ──>│                │                │             │
 │            │─ getShipping ─>│                │             │
 │            │                │────────────────────────────>│
 │            │                │<─────── rates ──────────────│
 │            │<── rates ──────│                │             │
 │─ Confirm ─>│                │                │             │
 │            │─ createPayment>│                │             │
 │            │                │─ PaymentIntent>│             │
 │            │                │<─── clientSecret│             │
 │            │<─ clientSecret─│                │             │
 │─ Pay ─────>│                │                │             │
 │            │───────────────────────────────>│             │
 │            │<──────────── success ──────────│             │
 │            │                │<── webhook ───│             │
 │            │                │─── createLabel ────────────>│
 │            │                │<──── labelUrl ──────────────│
 │<─ Success ─│                │                │             │
```

## State Management

### Context Providers Hierarchy
```tsx
<QueryClientProvider>       // React Query
  <AuthProvider>            // Authentication state
    <NotificationProvider>  // Push notifications
      <FavoritesProvider>   // Favorites state
        <LanguageProvider>  // Localization
          <GestureHandler>  // Gestures
            <BottomSheetModal>
              <NavigationContainer>
                {/* App content */}
              </NavigationContainer>
            </BottomSheetModal>
          </GestureHandler>
        </LanguageProvider>
      </FavoritesProvider>
    </NotificationProvider>
  </AuthProvider>
</QueryClientProvider>
```

### Key State Locations

| State Type | Location | Persistence |
|------------|----------|-------------|
| Auth User | AuthContext | Firebase Auth |
| User Profile | Firestore | Cloud |
| Favorites | FavoritesContext + Firestore | Cloud |
| Chat State | ChatContext | Memory + Firestore |
| Search Filters | Local State | Memory |
| Settings | AsyncStorage | Device |
| Push Token | NotificationContext | Cloud |
