# CODEBASE_INDEX.md — Second

> Cartographie complète du projet. Permet aux agents de localiser n'importe quel fichier sans scanner le filesystem. Mise à jour à chaque ajout/suppression significatif.

---

## Routes — `app/`

Expo Router v4 file-based. Chaque fichier = 1 écran (`export default function`).

### Tabs — `app/(tabs)/`
| Route | Fichier | Description |
|-------|---------|-------------|
| `/` (Home) | `(tabs)/index.tsx` | Feed principal, sections discover/trending/price-drops |
| `/favorites` | `(tabs)/favorites.tsx` | Articles favoris |
| `/sell` | `(tabs)/sell.tsx` | Entry point vente |
| `/messages` | `(tabs)/messages.tsx` | Liste conversations |
| `/profile` | `(tabs)/profile.tsx` | Profil utilisateur |

### Stacks autonomes
| Route | Fichier | Description |
|-------|---------|-------------|
| `/article/[id]` | `article/[id].tsx` | Détail article |
| `/article/edit/[id]` | `article/edit/[id].tsx` | Édition article |
| `/chat/[id]` | `chat/[id].tsx` | Conversation |
| `/search` | `search.tsx` | Recherche + filtres |
| `/onboarding` | `onboarding.tsx` | Onboarding préférences |
| `/notifications` | `notifications.tsx` | Centre notifications |
| `/my-articles` | `my-articles.tsx` | Mes articles en vente |
| `/my-orders` | `my-orders.tsx` | Mes commandes (acheteur) |
| `/my-sales` | `my-sales.tsx` | Mes ventes (vendeur) |
| `/my-swaps` | `my-swaps.tsx` | Mes échanges |
| `/liked-sellers` | `liked-sellers.tsx` | Vendeurs suivis |
| `/propose-swap` | `propose-swap.tsx` | Proposer un échange (multi-articles 1 vendeur + complément $ Stripe) |
| `/swap/[id]` | `swap/[id].tsx` | Détail échange (+ paiement complément Stripe si payment_pending) |
| `/swap-zone` | `swap-zone.tsx` | Swap Zone généraliste (dark, filtres canoniques, dépôt + troc) |
| `/swap-parties` | `swap-parties.tsx` | Legacy → Redirect `/swap-zone` |
| `/swap-party/[id]` | `swap-party/[id].tsx` | Legacy → Redirect `/swap-zone` |
| `/shop/[id]` | `shop/[id].tsx` | Boutique vendeur |
| `/user/[id]` | `user/[id].tsx` | Profil public |
| `/payment/[txId]` | `payment/[transactionId].tsx` | Paiement Stripe |
| `/review/[txId]` | `review/[transactionId].tsx` | Laisser un avis (post-transaction) |
| `/visual-search-results` | `visual-search-results.tsx` | Résultats recherche visuelle |
| `/saved-searches` | `saved-searches.tsx` | Recherches sauvegardées (liste, suppression, toggle notifs) |
| `/wallet` | `wallet.tsx` | Porte-monnaie (activation, solde, historique, retrait) |

### Checkout — `app/checkout/`
| Route | Fichier |
|-------|---------|
| `/checkout` | `checkout/index.tsx` |
| `/checkout/shipping` | `checkout/shipping.tsx` |
| `/checkout/meetup` | `checkout/meetup.tsx` |
| `/checkout/success` | `checkout/success.tsx` |

### Sell flow — `app/sell/`
| Route | Fichier |
|-------|---------|
| `/sell/capture` | `sell/capture.tsx` |
| `/sell/photos-review` | `sell/photos-review.tsx` (photos + inline AI analysis) |
| `/sell/details` | `sell/details.tsx` |
| `/sell/pricing` | `sell/pricing.tsx` |
| `/sell/preview` | `sell/preview.tsx` |

### Settings — `app/settings/`
| Route | Fichier |
|-------|---------|
| `/settings` | `settings/index.tsx` |
| `/settings/profile-details` | `settings/profile-details.tsx` |
| `/settings/address` | `settings/address.tsx` |
| `/settings/email` | `settings/email.tsx` |
| `/settings/password` | `settings/password.tsx` |
| `/settings/phone` | `settings/phone.tsx` |
| `/settings/payments` | `settings/payments.tsx` |
| `/settings/shipping-options` | `settings/shipping-options.tsx` |
| `/settings/notifications` | `settings/notifications.tsx` |
| `/settings/preferences` | `settings/preferences.tsx` |
| `/settings/privacy` | `settings/privacy.tsx` |
| `/settings/blocked-users` | `settings/blocked-users.tsx` |
| `/settings/help` | `settings/help.tsx` |
| `/settings/about` | `settings/about.tsx` |
| `/settings/terms` | `settings/terms.tsx` |
| `/settings/privacy-policy` | `settings/privacy-policy.tsx` |
| `/settings/legal-notice` | `settings/legal-notice.tsx` |
| `/settings/verify-email` | `settings/verify-email.tsx` |
| `/settings/export-data` | `settings/export-data.tsx` |
| `/settings/delete-account` | `settings/delete-account.tsx` |
| `/settings/stripe-onboarding` | `settings/stripe-onboarding.tsx` |

### Admin — `app/admin/`
| Route | Fichier |
|-------|---------|
| `/admin/shops` | `admin/shops.tsx` |
| `/admin/shop-detail/[id]` | `admin/shop-detail/[id].tsx` |

---

## Features — `features/`

Chaque feature a un barrel `index.ts` (API publique). Imports externes via `@/features/<name>`.

### `features/home/` — Sections du feed principal
```
discover/DiscoverGrid.tsx          # Grille articles discover
discover/useDiscoverArticles.ts    # Hook RQ articles discover
featured-sellers/FeaturedSellersSection.tsx
featured-sellers/useFeaturedSellers.ts
featured-sellers/useSellerLike.ts
header/HomeHeader.tsx
header/useHomeHeader.ts
new-arrivals/NewArrivalsSection.tsx
new-arrivals/useNewArrivals.ts
price-drops/PriceDropsSection.tsx
price-drops/usePriceDrops.ts
swap-zone/SwapZoneSection.tsx      # export: SwapZoneWrapper
swap-zone/useSwapParties.ts
trending-brands/TrendingBrandsSection.tsx
trending-brands/useTrendingBrands.ts
query-keys.ts                      # homeKeys
SectionErrorBoundary.tsx
index.ts                           # barrel
```

### `features/article/` — Détail article
```
components/ArticleCTABar.tsx
components/ArticleDetails.tsx
components/ArticleHero.tsx         # + ArticleFloatingHeader
components/HeaderButton.tsx        # interne
components/LoadingState.tsx        # ErrorState, LoadingState
hooks/useArticleActions.ts
styles.ts
utils.ts                           # buildTags, formatArticleDate, getDiscountPercent, spotEmoji
index.ts                           # barrel
```

### `features/search/` — Recherche & filtres
```
components/FilterChipsRow.tsx      # + type FilterChip
components/PriceRangeInputs.tsx
components/SearchHeader.tsx
hooks/useSearchScreen.ts
constants.ts                       # CONDITION_ITEMS, SORT_ITEMS
styles.ts
index.ts                           # barrel
```

### `features/onboarding/` — Préférences tailles/style
```
components/SexOption.tsx
components/SizeChip.tsx
constants/sizes.ts                 # SEXE_OPTIONS, SIZES_*
styles.ts
types.ts                           # OnboardingPreferences, SizeSystem
index.ts                           # barrel
```

### `features/user-profile/` — Profil public utilisateur
```
components/ArticleGrid.tsx         # FlashList grille articles vendeur
components/ArticleGridItem.tsx     # Thumbnail article avec badge prix/vendu
components/ProfileHeader.tsx       # Avatar, nom, bio, style tags, stats row
components/ProfileSkeleton.tsx     # Skeleton shimmer loading state
components/ProfileTabs.tsx         # Sticky tab bar Articles/Avis
components/ReviewItem.tsx          # Carte avis avec avatar + etoiles
components/ReviewList.tsx          # Resume note + liste avis
components/StatItem.tsx            # Cellule stat (Articles, Ventes, Note, Abonnes)
components/StyleTag.tsx            # Tag style vestimentaire
components/UserActions.tsx         # Boutons Contacter + S'abonner
types.ts                           # ProfileTab, Review
index.ts                           # barrel
```

---

## Stores — `store/`

Zustand 5 + `subscribeWithSelector`. Tous ont `reset()` appelé dans `store/resetAllStores.ts`.

| Store | Fichier | Responsabilité |
|-------|---------|----------------|
| `authStore` | `authStore.ts` | User auth state, hydrateFromFirebase |
| `authSheetStore` | `authSheetStore.ts` | Auth bottom sheet UI state |
| `chatStore` | `chatStore.ts` | Messages, conversations actives |
| `notificationStore` | `notificationStore.ts` | Badge count, notification list |
| `immersiveOverlayStore` | `immersiveOverlayStore.ts` | Immersive overlay JS-side active flag |
| `resetAllStores` | `resetAllStores.ts` | Reset global tous stores + clear React Query cache |

---

## Hooks — `hooks/`

| Hook | Fichier | Domaine |
|------|---------|---------|
| `useAuthListener` | `useAuthListener.ts` | Auth — Firebase onAuthStateChanged → authStore |
| `useAuthRequired` | `useAuthRequired.ts` | Auth — gate (→ authSheetStore.show) |
| `useUserProfile` | `useUserProfile.ts` | User — profil Firestore |
| `useChat` | `useChat.ts` | Chat — envoi messages |
| `useChatListener` | `useChatListener.ts` | Chat — listener real-time |
| `useFavorites` | `useFavorites.ts` | Favoris — toggle + liste |
| `useSellerLikes` | `useSellerLikes.ts` | Vendeurs — follow/unfollow |
| `useArticleSearch` | `useArticleSearch.ts` | Recherche — query Firestore |
| `useNearbyArticles` | `useNearbyArticles.ts` | Recherche — géoloc |
| `usePersonalizedFeed` | `usePersonalizedFeed.ts` | Feed — algo personnalisé |
| `useDraft` | `useDraft.ts` | Vente — brouillon article |
| `useMoments` | `useMoments.ts` | Social — moments/stories |
| `useFcmToken` | `useFcmToken.ts` | Notif — token FCM |
| `useNotificationSetup` | `useNotificationSetup.ts` | Notif — permissions + setup |
| `useGuestTracking` | `useGuestTracking.ts` | Analytics — visiteur non-auth |
| `useCategoryNavigation` | `useCategoryNavigation.ts` | Nav — catégories |
| `useBottomSheetBackHandler` | `useBottomSheetBackHandler.ts` | UI — Android back + bottom sheet |
| `useColorScheme` | `useColorScheme.ts` | UI — dark/light mode |
| `useThemeColor` | `useThemeColor.ts` | UI — couleur thème |
| `useWallet` | `useWallet.ts` | Wallet — RQ hook (info, activate, withdraw, pay) |
| `useDebounce` | `useDebounce.ts` | Util — debounce valeur |
| `useDeepLinking` | `useDeepLinking.ts` | Nav — deep links |
| `useFonts` | `useFonts.ts` | UI — chargement fonts |

---

## Services — `services/`

Couche data Firestore + API. Fonctions pures, pas de hooks.

| Service | Fichier | Domaine |
|---------|---------|---------|
| `authService` | `authService.ts` | Auth Firebase (sign in/up/out) |
| `authMergeService` | `authMergeService.ts` | Merge comptes (guest → auth) |
| `userService` | `userService.ts` | CRUD profil utilisateur |
| `userStatsService` | `userStatsService.ts` | Stats utilisateur |
| `articlesService` | `articlesService.ts` | CRUD articles |
| `chatService` | `chatService.ts` | Messages + conversations |
| `favoritesService` | `favoritesService.ts` | Favoris Firestore |
| `transactionService` | `transactionService.ts` | Transactions (Stripe) |
| `shopService` | `shopService.ts` | Boutiques |
| `draftService` | `draftService.ts` | Brouillons articles |
| `searchHistoryService` | `searchHistoryService.ts` | Historique recherche |
| `savedSearchService` | `savedSearchService.ts` | Recherches sauvegardées |
| `recommendationService` | `recommendationService.ts` | Recommandations |
| `styleProfileService` | `styleProfileService.ts` | Profil style |
| `guestPreferencesService` | `guestPreferencesService.ts` | Préférences guest |
| `notificationService` | `notificationService.ts` | Notifications |
| `reviewService` | `reviewService.ts` | Avis vendeur |
| `moderationService` | `moderationService.ts` | Modération contenu |
| `swapService` | `swapService.ts` | Échanges |
| `momentsService` | `momentsService.ts` | Stories/moments |
| `addressService` | `addressService.ts` | Adresses livraison |
| `aiService` | `aiService.ts` | Appels IA (analyse photo) |
| `visualSearchService` | `visualSearchService.ts` | Recherche visuelle |
| `walletService` | `walletService.ts` | Porte-monnaie (callables: activate, info, withdraw, pay) |

---

## Components — `components/`

### UI primitives — `components/ui/`
Avatar, Button, CategoryChip, IconSymbol, ImmersiveOverlay, Input, PersonalizedHeader, ScreenHeader, SearchBar, Skeleton, TabBar, TabBarBackground, TabBarIcons, Tag, Text, ThemedBottomSheet

#### `components/ui/ImmersiveOverlay/` — Immersive sell-flow transition
```
index.tsx          # ImmersiveOverlay wrapper + useImmersiveOverlay hook
Overlay.tsx        # Full-screen animated overlay layer
Gradient.tsx       # Skia Canvas (expanding circle + breathing bg circles)
constants.ts       # ENTERING_TIME, EXITING_TIME, OVERLAY_COLORS
```

### Atoms — `components/atoms/`
FilterChip, Pill, Tag

### Molecules — `components/molecules/`
AIInsight, AIProcessing, FeatureBanner, FormFieldRow, PriceSuggestion, ProductCardGrid, ProductCardPortrait, SearchBar, SectionHeader, SellerCard, StepIndicator, TextareaField

### Organisms — `components/organisms/`
BottomTabBar, CategoryRow, DetailActions, DetailHeader, FilterRow, TopBar

### Composants racine (smart + UI partagée)
| Composant | Fichier | Type |
|-----------|---------|------|
| ProductCard | `ProductCard.tsx` | Smart — carte article |
| ProductGrid | `ProductGrid.tsx` | UI — grille FlashList |
| AuthBottomSheet | `AuthBottomSheet.tsx` | Smart — auth modal |
| CategoryBottomSheet | `CategoryBottomSheet.tsx` | Smart — sélection catégorie |
| MakeOfferModal | `MakeOfferModal/` | Smart — offre (3 steps) |
| OfferBubble | `OfferBubble.tsx` | Smart — bulle offre chat |
| SwapBubble | `SwapBubble.tsx` | Smart — bulle swap chat |
| StripePayment | `StripePayment.tsx` | Smart — paiement Stripe (Payment Sheet natif) |
| ShipmentTracking | `ShipmentTracking.tsx` | Smart — suivi colis |
| SimilarProducts | `SimilarProducts.tsx` | Smart — produits similaires |
| CameraCapture | `CameraCapture.tsx` | Smart — capture photo |
| VisualSearchCamera | `VisualSearchCamera.tsx` | Smart — recherche visuelle |
| ReportBottomSheet | `ReportBottomSheet.tsx` | Smart — signalement |
| NotificationBellIcon | `NotificationBellIcon.tsx` | Smart — badge notifs |
| DraftResumeModal | `DraftResumeModal.tsx` | Smart — reprise brouillon |
| SaveSearchButton | `SaveSearchButton.tsx` | Smart — sauvegarder recherche |
| ThemedText/View | `ThemedText.tsx`, `ThemedView.tsx` | UI — wrappers thème |

### Sous-dossiers spécialisés
- `components/auth-bottom-sheet/` — Forms auth (SignIn, SignUp, ForgotPassword)
- `components/search/` — BrandGrid, BrandSelectionSheet, CategoryTree, RecentSearches, ShopCard, ShopMap
- `components/sell/` — BlurOverlay, CameraGuides, ConfidenceDots, FormFieldGroup, FormSectionTitle, StepProgressBar, SuccessModal
- `components/swap/` — SwapItemCard, SwapItemSelector, SwapPartyCard, SwapSeparator, SwapSummaryBox, ValueDifferenceBox
- `components/offer-bubble/` — CounterPriceInput, MeetupActions, OfferActions, useOfferTransaction
- `components/home/` — SectionHeader, SwapZoneSection

---

## Lib — `lib/`

| Fichier | Rôle |
|---------|------|
| `queryClient.ts` | Instance React Query |

## Utils — `utils/`

| Fichier | Rôle |
|---------|------|
| `fixStorageUrl.ts` | Normalise URLs Firebase Storage |
| `formatName.ts` | Formatage noms |
| `imageUtils.ts` | Helpers images |

## Config — `config/`

| Fichier | Rôle |
|---------|------|
| `firebaseConfig.ts` | Config Firebase SDK |
| `aiConfig.ts` | Config IA (prompts, modèles) |
| `i18n.ts` | i18n config (mono-FR) |

## Constants — `constants/`

| Fichier | Rôle |
|---------|------|
| `theme.ts` | Tokens DS (couleurs, fonts, spacing) |
| `Colors.ts` | Palette couleurs light/dark |
| `authMessages.ts` | Messages d'erreur auth FR |
| `storageKeys.ts` | Clés AsyncStorage |

## Types — `types/`

| Fichier | Rôle |
|---------|------|
| `index.ts` | Types partagés (Article, User, Transaction, Swap, etc.) |
| `ai.ts` | Types IA (AIAnalysis, etc.) |
| `search.ts` | Types recherche (SearchFilters, etc.) |

## Contexts — `contexts/` (shims legacy)

| Fichier | Délègue à |
|---------|-----------|
| `AuthContext.tsx` | `authStore` — utiliser `useUser()`, `useAuthActions()` |
| `ChatContext.tsx` | `chatStore` — utiliser sélecteurs directs |
| `AuthRequiredContext.tsx` | `authSheetStore` — utiliser `.getState().show()` |
| `NotificationContext.tsx` | `notificationStore` |

---

## Cloud Functions — `functions/src/`

### Callable — `functions/src/callable/`
| Fichier | Domaine |
|---------|---------|
| `ai.ts` | Analyse IA (photos, descriptions) |
| `chats.ts` | Envoi messages |
| `home.ts` | Données feed |
| `moments.ts` | Stories/moments |
| `onboarding.ts` | Préférences onboarding |
| `payments.ts` | Paiement Stripe Connect Custom (checkout, full in-app account onboarding with identity+bank, addBankAccount for updates, tracking via `checkTrackingStatus` avec garde de statut + `applyTrackingOutcome`, meetup completion, status). `adminRefundTransaction` (admin-only) : délègue au coeur partagé `utils/refund.ts` (`issueTransactionRefund`), idempotent `rf_admin_<txId>` reverse_transfer + débit vendeur pendingBalance/heldBalance/balance + status `refunded` (résout disputed/delivery_failed/lost/return_requested), re-liste l'article |
| `recourse.ts` | Recours acheteur anti-fraude. `requestRefund` (buyer-only, rate-limit 5/min) : auto-refund idempotent `rf_buyer_<txId>` UNIQUEMENT si status ∈ `delivery_failed`/`lost` (signal transporteur), réutilise `issueTransactionRefund`, NE re-liste PAS l'article (colis perdu), `refund_in_progress`→`refunded`, notifie les deux. `reportTransactionProblem` (buyer-only, rate-limit 5/min) : « livré mais problème », AUCUN mouvement d'argent, pose `disputed=true`+`buyerReport`+status `disputed` (gel des fonds), crée doc `disputes`, log `ADMIN_REVIEW`, refuse un re-signalement. `requestReturn` (buyer-only, rate-limit 3/min) : retour « non conforme » — autorisé si status `delivered` + `deliveryType` shipping + dans la fenêtre 7j ; achète une étiquette RETOUR via `createReturnLabel` (origine=acheteur `shippingAddress`, destination=vendeur via `resolveSellerOriginAddress`), stocke `returnLabelId`/`returnTrackingNumber`/`returnLabelUrl`/`returnLabelCost`/`returnReason`, gèle les fonds (`disputed=true`, status `return_requested`), notifie le vendeur. PAS de refund ici (déclenché au scan DELIVERED du retour via `utils/returnRefund`) |
| `products.ts` | CRUD articles server-side (createArticle, updateArticle, incrementProductView, toggleProductLike, toggleArticleSold, markSavedSearchViewed) |
| `reviews.ts` | Avis vendeurs |
| `search.ts` | Recherche visuelle (visualSearch, getSimilarProducts, backfillEmbeddings) |
| `style.ts` | Profil style |
| `swaps.ts` | Échanges |
| `users.ts` | Suppression compte (GDPR Art. 17 / Loi 25) |
| `wallet.ts` | Porte-monnaie virtuel (activateWallet, getWalletInfo, walletWithdraw, payWithWallet, refundWalletPayment, getOrCreateSellerWallet helper) |

### Triggers — `functions/src/triggers/`
| Fichier | Événement |
|---------|-----------|
| `articles.ts` | onUpdate article → search_index cleanup + offer expiration on soft-delete (isActive→false) and sold (isSold→true) + propagation title/image/price vers chats |
| `embeddings.ts` | onCreate article → génère embeddings |
| `favorites.ts` | onWrite favoris → MAJ compteurs |
| `messages.ts` | onCreate message → notif push |
| `products.ts` | onWrite article → index, modération |
| `swaps.ts` | onWrite swap → notifications |
| `users.ts` | onUpdate user → propagation displayName/profileImage |

### Scheduled — `functions/src/scheduled/`
| Fichier | Schedule |
|---------|----------|
| `cleanup.ts` | Nettoyage données expirées (search_index) |
| `cleanupDrafts.ts` | Nettoyage images drafts expirés dans Storage (14j) |
| `offerExpiration.ts` | Expiration offres pending dont expiresAt est passé (toutes les heures) |
| `popularity.ts` | Recalcul scores popularité |
| `savedSearches.ts` | Notif nouvelles correspondances |
| `stats.ts` | Agrégation stats |
| `swaps.ts` | Expiration swaps stale (proposed + payment_pending non payés, 7j) → libère les items |
| `trackingCheck.ts` | Filet de sécurité (toutes les 12h, paginé orderBy createdAt + startAfter, throttle ShipEngine) : poll les transactions `label_created` + `shipped` + `return_requested` (même index `status,createdAt`). 1er scan transporteur → `shipped` ; DELIVERED → contrat heldBalance (+7j) ; FAILURE → `delivery_failed` ; relance vendeur si `label_created` sans scan depuis 3j. Branche RETOUR : poll `returnTrackingNumber`/`returnCarrierCode` ; DELIVERED → `utils/returnRefund.processReturnDelivered`. Délègue à `utils/trackingTransition` |
| `transactionExpiration.ts` | Expiration meetup_pending (48h), pending_payment (1h), paid-not-shipped (7j) orphelins |
| `releaseHeldFunds.ts` | Toutes les heures : libère heldBalance → balance après la fenêtre de litige 7j (delivered → completed). Expose `applyDeliveredHeldFunds` (contrat pending→held à la livraison) |
| `sweepPendingLabels.ts` | Toutes les heures : re-tarife (getRates) + retente createLabel pour les transactions `paid` + `labelCreationPending`. Succès → crédite le vendeur (pendingBalance) + réconcilie le coût réel + status `label_created`. Après 4 échecs → refund acheteur (reverse_transfer idempotent) + release article + cancel + notif. Dead-letter `failed_operations` si le refund échoue |
| `retryFailedOperations.ts` | Toutes les 30 min : rejoue la dead-letter `failed_operations` (status `pending`) avec backoff exponentiel. Dispatch par `type` (stripe_refund/transfer_reversal/payout_reversal/amount_mismatch), idempotent (mêmes clés Stripe que les call sites). `resolved` au succès, `exhausted` après 6 tentatives (log CRITICAL → alerte). Tolère le shape legacy (transactionId/reason) |
| `reconcile.ts` (`reconcileFinances`) | Toutes les 6h, filet de sécurité (détection seule, pas de mutation d'argent) : reconcilePayments (PI succeeded mais tx `pending_payment` = webhook perdu), reconcileWithdrawals (withdrawal_requests `processing` bloqués vs payout Stripe → `completed` ou dead-letter), reconcileBalances (invariants wallet : aucun bucket négatif). Log CRITICAL + dead-letter sur divergence |

### HTTP — `functions/src/http/`
| Fichier | Route |
|---------|-------|
| `webhooks.ts` | Webhook Stripe (signature, payment_intent.succeeded/failed, charge.dispute.created/closed, payout.failed/paid, charge.refunded, account.updated). Achat label → status `label_created` (PAS `shipped`) |
| `shipEngineWebhook.ts` | Webhook tracking ShipEngine (chemin principal). Secret partagé (header `X-ShipEngine-Webhook-Secret` ou `?secret=`, timing-safe, 401 sinon, 500 si non configuré). Match par `trackingNumber` (forward) → `utils/trackingTransition` (label_created→shipped, DELIVERED, FAILURE) ; sinon match par `returnTrackingNumber` (retour) → DELIVERED déclenche `utils/returnRefund.processReturnDelivered`. Le poller reste le filet de sécurité |

### Services backend — `functions/src/services/`
| Fichier | Rôle |
|---------|------|
| `ai.ts` | Intégration Gemini |
| `brands.ts` | Gestion marques |

### Config backend — `functions/src/config/`
firebase.ts, gemini.ts, intelcom.ts, secrets.ts, shipEngine.ts, shippo.ts, stripe.ts

### Utils backend — `functions/src/utils/`
debounce.ts, fees.ts, geohash.ts, notifications.ts, rateLimit.ts, search.ts (`normalizeSearchText` + `generateSearchKeywords` + `calculatePopularityScore`), labelFulfillment.ts (P1 : `creditSellerForSale` crédit vendeur après label réussi + `reconcileShippingCost` coût réel vs estimé, partagé webhook/wallet/sweep), trackingTransition.ts (P1 : `applyTrackingOutcome` machine à états tracking partagée poller/webhook/callable — label_created→shipped au 1er scan, DELIVERED→heldBalance, FAILURE→delivery_failed ; `DELIVERABLE_STATUSES` garde de statut), returnRefund.ts (B2 : `processReturnDelivered` — refund du retour partagé poller/webhook, déclenché au DELIVERED du colis retour ; status-guard `return_requested`, idempotent `rf_return_<txId>`, refund acheteur = `totalAmount - returnLabelCost` via `issueTransactionRefund` partiel carte/wallet, débit vendeur, status `refunded` + `returnDeliveredAt`), failedOperations.ts (P1 : `writeFailedOperation` — helper dead-letter `failed_operations`, best-effort jamais throw, schéma canonique type/refId/payload/error/attempts/status, consommé par `retryFailedOperations`)

### Scripts admin — `functions/src/scripts/` (RUN MANUEL, NON DÉPLOYÉS)
| Fichier | Rôle |
|---------|------|
| `backfillSearchIndexCategoryIds.ts` | Backfill `search_index.categoryIds` depuis l'article source (fix C1). `--dry-run` d'abord. |
| `migrateArticleSize.ts` | Migration `articles.size` + `search_index.size` : string → `{ value, system: 'EU' }`. `--dry-run` d'abord. |

> Scripts standalone admin SDK, NON exportés depuis `index.ts` → aucun orphelin déployé. Lancer via `node lib/scripts/<file>.js` après `npm run build`.

---

## Layers ESLint boundaries

```
shared  : lib/**, utils/**, constants/**, types/**, config/**
core    : services/**, store/**, hooks/**, contexts/**, components/**
features: features/*/** (barrel index.ts obligatoire)
app     : app/**
```

Règles : `shared` → shared | `core` → shared+core | `features` → shared+core (pas cross-feature) | `app` → tout.
Vérifier : `npm run lint:boundaries`.
