# Source Tree

## Project Structure Overview

```
Seconde/
├── app/                          # Expo Router screens (36 screens)
│   ├── _layout.tsx              # Root layout with providers
│   ├── index.tsx                # Entry redirect
│   ├── auth.tsx                 # Authentication screen
│   ├── onboarding.tsx           # First-time user flow
│   ├── +not-found.tsx           # 404 handler
│   │
│   ├── (tabs)/                  # Main tab navigator (5 tabs)
│   │   ├── _layout.tsx          # Tab bar configuration
│   │   ├── index.tsx            # Home feed
│   │   ├── search.tsx           # Search & explore
│   │   ├── sell.tsx             # Create listing
│   │   ├── messages.tsx         # Chat list
│   │   └── profile.tsx          # User profile
│   │
│   ├── settings/                # Settings stack (14 screens)
│   │   ├── _layout.tsx          # Settings navigation
│   │   ├── index.tsx            # Settings menu
│   │   ├── profile-details.tsx  # Edit profile
│   │   ├── address.tsx          # Delivery address
│   │   ├── email.tsx            # Change email
│   │   ├── password.tsx         # Change password
│   │   ├── phone.tsx            # Phone number
│   │   ├── payments.tsx         # Payment methods
│   │   ├── shipping-options.tsx # Shipping preferences
│   │   ├── notifications.tsx    # Notification settings
│   │   ├── preferences.tsx      # App preferences
│   │   ├── privacy.tsx          # Privacy settings
│   │   ├── help.tsx             # Help & support
│   │   └── about.tsx            # About app
│   │
│   ├── article/
│   │   └── [id].tsx             # Article detail page
│   │
│   ├── chat/
│   │   └── [id].tsx             # Chat conversation
│   │
│   ├── shop/
│   │   └── [id].tsx             # Shop profile page
│   │
│   ├── payment/
│   │   └── [transactionId].tsx  # Payment flow
│   │
│   ├── admin/                   # Admin screens
│   │   ├── shops.tsx            # Shop moderation list
│   │   └── shop-detail/
│   │       └── [id].tsx         # Shop approval detail
│   │
│   ├── favorites.tsx            # Saved articles
│   ├── my-articles.tsx          # User's listings
│   ├── seller-balance.tsx       # Earnings dashboard
│   ├── search-results.tsx       # Search results
│   └── filters.tsx              # Advanced filters
│
├── components/                   # Reusable components (40+)
│   ├── ProductCard.tsx          # Article card display
│   ├── ProductGrid.tsx          # Grid of articles
│   ├── ArticleGrid.tsx          # Alternative article grid
│   ├── ProductLocationMap.tsx   # Map showing item location
│   ├── SimilarProducts.tsx      # Similar items section
│   │
│   ├── ChatBubble.tsx           # Message bubble
│   ├── OfferBubble.tsx          # Offer message display
│   │
│   ├── AuthBottomSheet.tsx      # Login/register modal
│   ├── CategoryBottomSheet.tsx  # Category picker
│   ├── SearchFiltersBottomSheet.tsx  # Search filters
│   ├── SelectionBottomSheet.tsx # Generic selection sheet
│   ├── FiltersModal.tsx         # Filters modal
│   │
│   ├── MakeOfferModal/          # Multi-step offer flow
│   │   ├── index.tsx            # Main component
│   │   ├── OfferStep.tsx        # Price input step
│   │   ├── AddressStep.tsx      # Address input step
│   │   ├── ShippingStep.tsx     # Shipping selection
│   │   ├── ConfirmStep.tsx      # Confirmation step
│   │   └── types.ts             # Type definitions
│   │
│   ├── ShippingAddressForm.tsx  # Address input form
│   ├── ShipmentTracking.tsx     # Tracking display
│   │
│   ├── ActiveFilters.tsx        # Active filter chips
│   ├── FilterChips.tsx          # Filter selection chips
│   ├── ImageGallery.tsx         # Image viewer/carousel
│   │
│   ├── search/                  # Search-specific components
│   │   ├── BrandGrid.tsx        # Brand selection grid
│   │   ├── BrandSelectionSheet.tsx  # Brand picker
│   │   ├── ShopCard.tsx         # Shop listing card
│   │   └── ShopMap.tsx          # Shops on map
│   │
│   ├── onboarding/              # Onboarding flow components
│   │   ├── AccountTypeSelector.tsx  # User/Shop selection
│   │   ├── BrandSelector.tsx    # Favorite brands
│   │   ├── LocationInput.tsx    # Location picker
│   │   ├── OpeningHoursSelector.tsx  # Shop hours
│   │   └── ShopContactForm.tsx  # Shop contact info
│   │
│   ├── admin/                   # Admin components
│   │   ├── ShopValidationCard.tsx  # Shop review card
│   │   └── RejectionModal.tsx   # Rejection reason modal
│   │
│   ├── ui/                      # Base UI components
│   │   ├── IconSymbol.tsx       # Platform icons
│   │   └── TabBarBackground.tsx # Tab bar styling
│   │
│   ├── ThemedText.tsx           # Themed text component
│   ├── ThemedView.tsx           # Themed view wrapper
│   ├── Collapsible.tsx          # Expandable section
│   ├── ExternalLink.tsx         # External link handler
│   ├── HapticTab.tsx            # Haptic feedback tab
│   └── ParallaxScrollView.tsx   # Parallax scroll effect
│
├── contexts/                     # React Context providers (6)
│   ├── AuthContext.tsx          # User authentication state
│   ├── AuthRequiredContext.tsx  # Auth guard context
│   ├── ChatContext.tsx          # Active chat management
│   ├── FavoritesContext.tsx     # User favorites
│   ├── LanguageContext.tsx      # i18n/localization
│   └── NotificationContext.tsx  # Push notification state
│
├── hooks/                        # Custom React hooks (7)
│   ├── useArticleSearch.ts      # Article search with filters
│   ├── useAuthRequired.ts       # Auth guard hook
│   ├── useBottomSheetBackHandler.ts  # Sheet back gesture
│   ├── useChat.ts               # Chat functionality
│   ├── useColorScheme.ts        # Theme detection
│   ├── useColorScheme.web.ts    # Web theme detection
│   └── useThemeColor.ts         # Theme colors
│
├── services/                     # Business logic layer (11)
│   ├── articlesService.ts       # Article CRUD & search
│   ├── authService.ts           # Authentication flows
│   ├── chatService.ts           # Real-time messaging
│   ├── favoritesService.ts      # User favorites
│   ├── notificationService.ts   # Push notifications
│   ├── sellerBalanceService.ts  # Seller earnings
│   ├── shopService.ts           # Shop management
│   ├── transactionService.ts    # Purchase records
│   ├── userService.ts           # User profiles
│   ├── userStatsService.ts      # User statistics
│   └── addressService.ts        # Address management
│
├── data/                         # Static data files (8)
│   ├── brands-list.json         # 4000+ brand names
│   ├── brands.ts                # Brand utilities
│   ├── categories-v2.ts         # Hierarchical categories
│   ├── colors.ts                # Color options
│   ├── materials.ts             # Material options
│   ├── patterns.ts              # Pattern options
│   ├── sizes.ts                 # Size charts by category
│   └── shipping.ts              # Shipping carrier configs
│
├── types/                        # TypeScript definitions (2)
│   ├── index.ts                 # Main type definitions
│   └── search.ts                # Search-related types
│
├── config/                       # Configuration (2)
│   ├── firebaseConfig.ts        # Firebase initialization
│   └── i18n.ts                  # Internationalization
│
├── constants/                    # App constants
│   └── Colors.ts                # Theme colors
│
├── utils/                        # Utility functions
│   └── imageUtils.ts            # Image processing helpers
│
├── assets/                       # Static assets
│   ├── fonts/                   # Custom fonts
│   └── images/                  # App images
│
├── functions/                    # Firebase Cloud Functions
│   ├── src/
│   │   └── index.ts             # All cloud functions
│   ├── package.json             # Functions dependencies
│   └── tsconfig.json            # TypeScript config
│
├── docs/                         # Project documentation
│   ├── 01-project-overview.md
│   ├── 02-technology-stack.md
│   ├── 03-architecture.md
│   ├── 04-data-models.md
│   ├── 05-api-reference.md
│   ├── 06-services-layer.md
│   ├── 07-cloud-functions.md
│   ├── 08-security-rules.md
│   ├── 09-development-guide.md
│   └── 10-source-tree.md
│
├── app.config.js                # Expo configuration
├── package.json                 # Dependencies
├── tsconfig.json               # TypeScript configuration
├── firebase.json               # Firebase project config
├── firestore.rules             # Firestore security rules
├── firestore.indexes.json      # Firestore indexes
├── storage.rules               # Storage security rules
└── eas.json                    # EAS Build config
```

---

## File Statistics

| Directory | Files | Purpose |
|-----------|-------|---------|
| `app/` | 36 | Screen components |
| `components/` | 40+ | Reusable UI |
| `services/` | 11 | Business logic |
| `hooks/` | 7 | Custom hooks |
| `contexts/` | 6 | State management |
| `data/` | 8 | Static data |
| `types/` | 2 | Type definitions |
| `config/` | 2 | Configuration |
| `functions/src/` | 1 | Cloud Functions |

---

## Key Entry Points

| File | Purpose |
|------|---------|
| `app/_layout.tsx` | Root layout with all providers |
| `app/index.tsx` | Entry point (redirects based on auth) |
| `config/firebaseConfig.ts` | Firebase SDK initialization |
| `functions/src/index.ts` | Cloud Functions entry |

---

## Navigation Flow

```
App Entry (app/index.tsx)
    │
    ├─► Not Authenticated
    │       └─► auth.tsx (Login/Register)
    │               └─► onboarding.tsx (First time)
    │
    └─► Authenticated
            └─► (tabs)/_layout.tsx
                    ├─► index.tsx (Home)
                    ├─► search.tsx (Explore)
                    ├─► sell.tsx (Create)
                    ├─► messages.tsx (Chats)
                    └─► profile.tsx (Profile)
```
