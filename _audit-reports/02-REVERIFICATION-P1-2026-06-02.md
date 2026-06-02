# Re-vérification de la couverture P1 — post-fix (run crashé) & post-deploy (2026-06-02)

Re-vérification ligne à ligne des findings P1 des audits par domaine, après la vague de correction (partiellement crashée en cours de run, cf. commit `c6fd87af` « Vague P1 (partielle, run crashé mais arbre vert) ») et le deploy backend. Chaque verdict est appuyé par une preuve `file:line` issue de l'arbre courant.

## Verdict global

| Statut | Total |
|--------|-------|
| closed | 62 |
| partial | 9 |
| still_open | 29 |
| regression | 0 |
| na | 6 |
| **TOTAL** | **106** |

Lecture : la vague de correction a fortement avancé sur le **backend** (callables atomiques, rules, types, deeplinks, prefs de notif) — la majorité des `closed` sont des correctifs serveur/contrat. Le **frontend** porte la quasi-totalité des `still_open` (UX cross-plateforme, flux Vendre iOS, normalisation des tailles, points d'entrée de navigation manquants), conséquence du crash en milieu de run qui a laissé les fixes client inachevés.

## ⚠️ RÉGRESSIONS

**Aucune régression détectée** (`regression: 0` sur les 10 domaines). Aucun finding précédemment clos n'a été ré-ouvert, et aucun correctif n'a introduit de nouveau défaut visible dans l'arbre courant.

À surveiller toutefois (pas une régression, mais une dette introduite par un correctif partiel) :
- `services/articlesService.ts:808-822` (recherche P1-5) : la back-compat client accepte désormais les tailles legacy en `string` **et** les objets `{value,system}`, mais aucune migration des données n'a eu lieu → données hybrides non normalisées. Le risque « tailles silencieusement exclues » est atténué, le risque « données incohérentes en écriture » demeure (cf. `app/sell/preview.tsx:172` qui hardcode encore `system: 'EU'`).

## P1 ENCORE OUVERTS (still_open — 29, sautés par le crash, à reprendre)

Regroupés par thème pour la reprise.

### Flux Vendre iOS vs Android (cause racine commune — non unifiée)
- **fondations P1-1** — `app/(tabs)/_layout.tsx:152` : `setTimeout(..., 550)` hardcodé, iOS via overlay immersif vs Android nav par défaut.
- **vente-miseenvente P1-1** — `app/(tabs)/_layout.tsx:139-157` : deux écrans de capture (`SellOverlayCapture.tsx` iOS / `app/sell/capture.tsx` Android) ~90 % dupliqués.
- **vente-miseenvente P1-2 / P1-9 / P1-10** — `SellOverlayCapture.tsx:98-117` ne restaure que les photos, jamais `currentStep` ; pas de `DraftResumeModal` sur iOS (`app/(tabs)/_layout.tsx:139-157`), et `photos-review.tsx:127-132` relance `runAnalysis()` inconditionnellement → ré-analyse IA payante (quota Gemini gaspillé). Android est step-aware (`app/(tabs)/sell.tsx:57-98`).
- **home-discovery-favoris P1-12** — même cause : iOS contourne `sell.tsx`, perd la progression du brouillon.

### Normalisation des tailles (modèle {value, system})
- **recherche P1-5** — `services/articlesService.ts:808-822` : back-compat OK, pas de migration des strings legacy ; `functions/src/scripts/backfillSearchIndex.ts:158` passe la `size` brute.
- **vente-miseenvente P1-4** — `app/sell/preview.tsx:172` hardcode `{ value: fields.size, system: 'EU' }` ; `app/article/edit/[id].tsx:186,307` re-tague en EU et perd le système d'origine → vendeur US publié en EU.

### Saisie / interactions natives (Vendre)
- **vente-miseenvente P1-6** — `app/sell/pricing.tsx:136-137` : `replace(/[^0-9.]/g, '')` sans normaliser la virgule ; en `fr-CA`, `45,50` devient `4550` (×100). Le fix existe ailleurs (`app/wallet.tsx:295`) mais n'a pas été reporté ici.
- **vente-miseenvente P1-5** — `app/sell/details.tsx:172-181,246` : pas de `usePreventRemove`/`BackHandler` ; le back natif (swipe iOS / hardware Android) contourne l'alerte « brouillon sauvegardé ».

### Système de likes / compteurs (chaîne morte)
- **home-discovery-favoris P1-3** — `functions/src/callable/products.ts:111` : `toggleProductLike` n'est jamais appelée ; `hooks/useFavorites.ts:158-193` écrit seulement dans `favorites/{userId}.articleIds`.
- **home-discovery-favoris P1-4** — `features/article/components/ArticleDetails.tsx:74` : `{article.likes}` figé à 0.
- **home-discovery-favoris P1-5** — `functions/src/triggers/favorites.ts:12-25` calcule le delta mais n'écrit jamais `favoritesCount` ; `search.ts:78` pondère `likes*2` sur un 0.

### Géolocalisation / proximité (structurellement impossible côté données)
- **home-discovery-favoris P1-8** — stub `useUserLocation` supprimé, aucune implémentation de `useNearbyArticles` ; `center` jamais passé au tri Haversine.
- **home-discovery-favoris P1-9** — `types/index.ts:213` (`location: string`) vs `ArticleWithLocation` (230-236) vs `coordinates.{lat,lon}`+geohash dans le trigger : trois schémas non réconciliés.
- **home-discovery-favoris P1-10** — `app/sell/preview.tsx:188-196` n'écrit que `neighborhood(s)` ; `articlesService.ts:135-177` et `products.ts:406-413` n'écrivent aucune coordonnée.

### Swap / SwapZone (UI non corrigée)
- **swap-swapzone P1-1** — `app/swap/[id].tsx:449` (SwapActions) et `:467` (SwapStickyActions) tous deux vrais pour le receiver → boutons dupliqués.
- **swap-swapzone P1-2** — `features/swap/components/SwapStickyActions.tsx:66` : `paddingBottom: 32` hardcodé sans `useSafeAreaInsets()`.
- **swap-swapzone P1-3** — aucun `BackHandler` (grep = 0) : le bouton retour Android quitte l'écran au lieu d'annuler le multi-select.
- **swap-swapzone P1-4** — `app/swap-zone.tsx:573-574` : `selectedCount` dérivé de `selectedItemIds.size` sans intersection avec `filteredItems` → compteur désynchronisé, propositions vides silencieuses.
- **swap-swapzone P1-8** — `features/swap/components/SwapProposalView.tsx:90` : `${cashTopUp.amount}` affiché sans `/100` alors que stocké en cents → `500 $` affiché `$50000`.
- **swap-swapzone P1-10** — `my-swaps.tsx` accessible uniquement via un toast de succès ; aucun point d'entrée permanent dans `app/(tabs)/profile.tsx:101-174`.

### Messagerie (UX résiduelle)
- **messagerie-notifications #11** — `services/chatService.ts:1416` trie par `updatedAt` mais `app/(tabs)/messages.tsx:267` affiche `lastMessageTimestamp` → réordonnancement sans nouveau message.
- **messagerie-notifications #17** — `markMessagesAsRead` (`chatService.ts:1445-1478`) écrit `isRead:true` mais ne mute jamais `status` ; les états `delivered`/`read` ne sont jamais produits.
- **messagerie-notifications #18** — `listenToMessages` (`chatService.ts:1334-1372`) sans `limit()` : tous les messages chargés d'un coup, aucune pagination.

### Modération / admin
- **boutiques-admin P1-5 / messagerie #14** — divergence : le blocage est désormais **bidirectionnel côté trigger messages** (`functions/src/triggers/messages.ts:25-49`, symétrique → `closed` côté messagerie), mais `services/moderationService.ts:292-309` (`areUsersBlocked`) reste **unidirectionnel** et la règle bidirectionnelle (`firestore.rules:50`) n'est appliquée que sur `messages.onCreate`. Le verdict `still_open` de boutiques-admin P1-5 vise l'absence d'enforcement homogène hors message ; à reprendre pour cohérence.
- **flow-achat P1-13** — `app/admin/` ne contient aucun écran disputes ; le backend crée `disputes/{id}` (`functions/src/callable/payments.ts:2347`) mais aucune UI admin pour lister/résoudre → transactions disputées gelées sans recours in-app.

### Architecture / build
- **fondations P1-5** — `android/app/src/main/AndroidManifest.xml` et `ios/Seconde/Info.plist` committés et non gitignorés ; permissions absentes d'`app.config.js:120-125` → drift avec la source de vérité.

## P1 PARTIELS (9 — corrigés mais incomplets)

- **flow-achat P1-10** (`negotiatedPrice`) — la consommation existe (`app/checkout/shipping.tsx:81,135`, `app/checkout/meetup.tsx:50,72-78`) mais la source ne la transmet pas : `components/OfferBubble.tsx:358` route vers `/checkout` avec seulement `{articleId, chatId}`. Masqué par `SHIPPING_ENABLED=false`.
- **fondations P1-9** (`isInternetReachable`) — banner et écran article OK (`OfflineBanner.tsx:27`, `app/article/[id].tsx:76,149`) mais `app/payment/[transactionId].tsx:61` et `app/checkout/index.tsx:47` ne destructurent pas `isError` → écran blanc sur erreur réseau.
- **boutiques-admin P1-1** (forfaits boutique) — type `Shop.tier` (`types/index.ts:581`) + helper `normalizeFeeReduction` (`functions/src/utils/fees.ts:78-85`) ajoutés, mais `functions/src/callable/payments.ts:722` calcule encore `calculateServiceFee(amount)` sans lookup du tier → réduction des frais acheteur jamais appliquée.
- **boutiques-admin P1-2** (lien article↔boutique) — write path (`products.ts:297-361`) et lecture (`shopService.ts:370-396`) implémentés, mais `articlesCount` (`shopService.ts:49`) sans trigger CF visible et index composite/déploiement non confirmés ; affichage encore gardé sur `articlesCount > 0` (`shop.tsx:303`).
- **messagerie-notifications #13** (conversation bloquée visible) — détection `isChatBlocked()` (`messages.tsx:66-73`) existe mais n'est pas consommée pour filtrer/marquer ; conversation reste visible, pas de badge.
- **messagerie-notifications #16** (décision automatisée → contestation) — deeplink `order_cancelled` → `/my-orders` respecté (`notifications.ts:59`, `useNotificationSetup.ts:170`) mais `app/my-orders.tsx` n'expose aucun bouton de contestation → parcours fragmenté.
- **home-discovery-favoris P1-1** (tailles) — `hooks/usePersonalizedFeed.ts:16-19` mappe désormais `string` → `ArticleSize` avec expansion US/EU (verdict `closed` côté ce domaine ; listé ici pour cohérence avec P1-5/P1-4 vente qui restent ouverts en écriture).
- **home-discovery-favoris P1-2** (tracking invité) — `trackView` (`app/article/[id].tsx:143`) et `trackLike` (`useFavorites.ts:191`) câblés, mais `trackSearch` reste un stub jamais appelé.
- **home-discovery-favoris P1-12** (flux Vendre) — Android step-aware, iOS bypassé (voir section still_open ci-dessus).

## Détail par domaine

### recherche — 10 closed / 0 partial / 1 still_open
- P1-1 (payload notif) **closed** — `functions/src/scheduled/savedSearches.ts:256` envoie `savedSearchId`, lu par `hooks/useNotificationSetup.ts:189`.
- P1-2 (matching marque) **closed** — `savedSearches.ts:204-216` filtre en mémoire via `brandKey()` exact-match.
- P1-3 (index composite marque) **closed** — `savedSearches.ts:111-131` ne pousse jamais `array-contains-any('brands')` (commentaire 119-122).
- P1-4 (scoping vendeur sans index) **closed** — `services/articlesService.ts:626-635` : shop-scoped retire category/condition/price, filtrés client-side.
- P1-5 (tailles legacy) **still_open** — `articlesService.ts:808-822` back-compat OK ; `backfillSearchIndex.ts:158` brut, pas de migration.
- P1-6 (articles vendus en recherche visuelle) **closed** — `functions/src/callable/search.ts:194-197` exclut `isSold`/`!isActive` post-fetch.
- P1-7 (tri seul) **closed** — `hooks/useArticleSearch.ts:101,135-140` active la query sur `sortBy !== 'recent'`.
- P1-8 (édition taille perd l'autre système) **closed** — `components/SizeSelectionSheet.tsx:72-73,130-131` fusionne US+EU.
- P1-9 (dédup historique) **closed** — `firestore.rules:299` `allow update: if isOwner(userId)`.
- P1-10 (deux libs cartes) **closed** — `app.config.js:64-70` plugin `react-native-maps` + clés Google ; `expo-maps` grep = 0.
- P1-11 (permission caméra Android) **closed** — `app.config.js:46-52` plugin `expo-camera` avec `cameraPermission` FR.

### user-onboarding — 8 closed / 0 partial / 0 still_open / 1 na
- P1-1 (persistance onboarding) **closed** — `app/onboarding.tsx:162-195` : `await` + retry pour loggés, fire-and-forget pour guests.
- P1-2 / P1-6 (Apple-only sur Android) **closed** — message guide `SignInForm.tsx:60-76` / `SignUpForm.tsx:122-138`.
- P1-3 (@handle profil public) **closed** — `functions/src/callable/reviews.ts:360` `username: userData.username || null` ; affiché via `ProfileHeader`.
- P1-4 (état provider/hasPassword) **closed** — `app/settings/index.tsx:77-82` `useFocusEffect` + `add-password.tsx:65` `refreshUser()`.
- P1-5 (cold start offline) **closed** — `config/firebaseConfig.ts:59-61` `persistentLocalCache` + `store/authStore.ts:182-193` fallback AsyncStorage (garde `dateOfBirth`).
- P1-7 (export Loi 25 messages) **closed** — `services/userService.ts:456-461` query collection top-level `messages`.
- P1-8 (garde-fous suppression compte) **closed** — `functions/src/callable/users.ts:75-108` checks serveur disputes + transactions actives + soldes (= P0-1 clos).
- P1-9 (flux Vendre) **na** — requalifié P2 avant la vague de correction.

### flow-achat — 13 closed / 1 partial / 1 still_open
- P1-1 (clé Stripe test committée) **closed** — `config/stripeConfig.ts:15-17` lit `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY`.
- P1-2 (Apple Pay/Google Pay) **closed** — `app.config.js:57-61` plugin `@stripe/stripe-react-native` + merchant config.
- P1-3 (top-up swap mismatch 500) **closed** — `functions/src/http/webhooks.ts:790-816,900-978` dead-letter + refund idempotent, ACK 200.
- P1-4 (acceptOffer ordre d'écriture) **closed** — `services/chatService.ts:582-626` délègue à `acceptMeetupOffer` atomique.
- P1-5 / P1-6 (meetup_confirmed / double write) **closed** — `chatService.ts:1087-1133` → `confirmMeetupTransaction` (`payments.ts:1996`) atomique.
- P1-7 (buyerId dérivé client) **closed** — dérivation serveur dans `acceptMeetupOffer`.
- P1-8 (reportNoShow dead-end) **closed** — `chatService.ts:1214` → `reportMeetupNoShow` (`payments.ts:2254-2401`) : dispute + déverrouillage article + notif.
- P1-9 (estimation shipping adresse complète) **closed** — `payments.ts:279-311` fallback code postal.
- P1-10 (negotiatedPrice) **partial** — consommation OK, source `OfferBubble.tsx:358` ne transmet pas ; masqué par `SHIPPING_ENABLED=false`.
- P1-11 / P1-12 (statut completed reviewable / fenêtre 60j) **closed** — `functions/src/callable/reviews.ts:125` inclut `completed` dans terminalStatuses.
- P1-13 (écran admin disputes) **still_open** — aucun écran dans `app/admin/`, disputes créées mais non résolubles.
- P1-14 (types ledger manquants) **closed** — `types/index.ts:940-953` + `app/wallet.tsx:172-200` (`funds_released` vert).
- P1-15 (KeyboardAvoidingView review iOS) **closed** — `app/review/[transactionId].tsx:269-273`.

### fondations — 5 closed / 1 partial / 3 still_open
- P1-1 (Vendre divergent) **still_open** — `app/(tabs)/_layout.tsx:152` `setTimeout(550)` inchangé.
- P1-2 (CAMERA) **closed** — `app.config.js:46-51` plugin `expo-camera`.
- P1-3 (RECORD_AUDIO) **closed** — `app.config.js:50` `recordAudioAndroid: false`, permission retirée.
- P1-4 (maps sans clé Google) **closed** — `app.config.js:65-69` plugin + clés env.
- P1-5 (drift android/ios) **still_open** — manifests committés, permissions absentes d'`app.config.js:120-125`.
- P1-6 (channels orphelins) **closed** — `hooks/useNotificationSetup.ts:59-72` `orders` + `saved_searches`.
- P1-7 (paths Android) **closed** — `app.config.js:174-195` 5 pathPrefix ajoutés.
- P1-8 (hosts www) **closed** — `app.config.js:197-260` `www.seconde.app` aligné iOS.
- P1-9 (isInternetReachable / écrans erreur) **partial** — banner+article OK ; `app/payment/[transactionId].tsx:61` et `app/checkout/index.tsx:47` sans `isError` → écran blanc.

### vente-miseenvente — 3 closed / 0 partial / 7 still_open / 2 na
- P1-1 (deux écrans capture) **still_open** — `app/(tabs)/_layout.tsx:139-157`.
- P1-2 (reprise brouillon iOS) **still_open** — `SellOverlayCapture.tsx:98-117` ne restaure que les photos.
- P1-3 (conditionId IA) **closed** — `functions/src/services/ai.ts:276-299` map french-kebab.
- P1-4 (taille EU hardcodé) **still_open** — `app/sell/preview.tsx:172` ; edit `article/edit/[id].tsx:186,307`.
- P1-5 (back natif sans alerte) **still_open** — `app/sell/details.tsx:172-181,246` sans `usePreventRemove`.
- P1-6 (virgule prix) **still_open** — `app/sell/pricing.tsx:136-137` sans normalisation virgule (fr-CA).
- P1-7 (search_index non-awaité) **closed** — `functions/src/triggers/products.ts:147-169` await sur création.
- P1-8 (price-drop figé) **closed** — `functions/src/callable/products.ts:763-785` `FieldValue.delete()` au-dessus de l'original.
- P1-9 (DraftResumeModal iOS) **still_open** — `app/(tabs)/_layout.tsx:139-157`, modal importé seulement côté Android.
- P1-10 (re-analyse IA iOS) **still_open** — `photos-review.tsx:127-132` `runAnalysis()` inconditionnel.
- P1-11 / P1-12 **na** — n'existent pas dans le rapport (numérotation P1-1..P1-10 + backend P1-7/P1-8).

### swap-swapzone — 5 closed / 0 partial / 6 still_open
- P1-1 (double boutons) **still_open** — `app/swap/[id].tsx:449,467`.
- P1-2 (padding safe-area) **still_open** — `SwapStickyActions.tsx:66` `paddingBottom: 32`.
- P1-3 (BackHandler multi-select) **still_open** — grep = 0.
- P1-4 (compteur désync) **still_open** — `app/swap-zone.tsx:573-574`.
- P1-5 (validation propriété backend) **closed** — `functions/src/callable/swaps.ts:98,407-412,560-561`.
- P1-6 (prix recalculés serveur) **closed** — `swaps.ts:427-433,82,425`.
- P1-7 (lock concurrence) **closed** — `swaps.ts:150-168,423` `assertArticlesNotEngaged` transactionnel.
- P1-8 (complément en cents avec $) **still_open** — `SwapProposalView.tsx:90` sans `/100`.
- P1-9 (top-up heldBalance + fenêtre 7j) **closed** — `swaps.ts:1277-1298` `topUpFundsReleaseAt`.
- P1-10 (my-swaps sans entrée) **still_open** — `app/(tabs)/profile.tsx:101-174` sans « Mes échanges ».
- P1-11 (deep-link non-participant) **closed** — `services/swapService.ts:603-607` error callback + `app/swap/[id].tsx:377-389`.

### boutiques-admin — 3 closed / 2 partial / 1 still_open
- P1-1 (forfaits boutique) **partial** — type+helper ajoutés ; `payments.ts:722` ignore le tier.
- P1-2 (lien article↔boutique) **partial** — write/lecture OK ; `articlesCount` trigger et index non confirmés.
- P1-3 (carte sans clé Google) **closed** — `app/shop/[id].tsx:31-34` fallback `PROVIDER_DEFAULT`.
- P1-4 (notif décision boutique) **closed** — déplacé côté CF (`functions/src/callable/shopModeration.ts`), client no-op.
- P1-5 (blocage asymétrique) **still_open** — `services/moderationService.ts:292-309` unidirectionnel ; rule bidirectionnelle seulement sur `messages.onCreate`.
- P1-6 (footer safe-area) **closed** — `app/admin/shop-detail/[id].tsx:25,32,330` `Math.max(20, insets.bottom)`.

### messagerie-notifications — 14 closed / 2 partial / 4 still_open / 1 na
- #5 (types notif absents union) **closed** — `app/notifications.tsx:26-65` mapping complet + deeplink consommé.
- #6 (rules create notif) **na** — révisé P2 dans le rapport.
- #7 (clé saved_search) **closed** — `savedSearches.ts:256` / `useNotificationSetup.ts:189`.
- #8 (channels Android) **closed** — `useNotificationSetup.ts:59-72`.
- #9 (prefs transactionnelles) **closed** — `functions/src/utils/notifications.ts:169-206,217-225,321-366`.
- #10 (notif ventes/commandes/avis) **closed** — `useNotificationSetup.ts:167-180` + deeplink.
- #11 (tri updatedAt vs lastMessageTimestamp) **still_open** — `chatService.ts:1416` vs `messages.tsx:267`.
- #12 (conversations profil dans Achats) **closed** — `messages.tsx:75-87` segment « autres ».
- #13 (conversation bloquée visible) **partial** — détection sans filtre/badge.
- #14 (push entre bloqués) **closed** — `functions/src/triggers/messages.ts:25-49` symétrique.
- #15 (funds_released tap) **closed** — `notifications.ts:107-110` + `useNotificationSetup.ts:172`.
- #16 (décision auto → contestation) **partial** — routing OK, pas de bouton contestation dans `my-orders`.
- #17 (accusés de lecture) **still_open** — `markMessagesAsRead` (`chatService.ts:1445-1478`) ne mute jamais `status`.
- #18 (pagination) **still_open** — `listenToMessages` (`chatService.ts:1334-1372`) sans `limit()`.
- #19 (dérive types notif) **closed** — `store/notificationStore.ts:9-33` + never-check `useNotificationSetup:225-228`.
- #20 (badge iOS / compteur) **closed** — `notifications.ts:241-274` `computeBadgeCount()` + `incrementUnreadCount` câblé.

### home-discovery-favoris — 1 closed / 3 partial / 6 still_open / 2 na
- P1-1 (perso par taille) **closed/partial** — `hooks/usePersonalizedFeed.ts:16-19` mapping `ArticleSize[]` (clos en lecture ; écriture reste ouverte côté vente).
- P1-2 (tracking invité) **partial** — `trackView`/`trackLike` câblés, `trackSearch` jamais appelé.
- P1-3 (deux systèmes de like) **still_open** — `functions/src/callable/products.ts:111` `toggleProductLike` sans appelant.
- P1-4 (compteur likes à 0) **still_open** — `ArticleDetails.tsx:74`.
- P1-5 (favoritesCount jamais maintenu) **still_open** — `functions/src/triggers/favorites.ts:12-25`.
- P1-6 (écran « Vendeurs aimés » orphelin) **still_open** — `app/liked-sellers.tsx` sans lien (grep = 0).
- P1-7 (anti-auto-suivi) **closed** — `functions/src/callable/home.ts:335-340` guard `sellerId === userId`.
- P1-8 (useNearbyArticles inexistant) **still_open** — stub supprimé, pas d'implémentation.
- P1-9 (schémas location incompatibles) **still_open** — `types/index.ts:213` vs 230-236 vs trigger geohash.
- P1-10 (vente n'écrit pas de coordonnées) **still_open** — `preview.tsx:188-196`, `articlesService.ts:135-177`, `products.ts:406-413`.
- P1-11 (chevauchement carte Pour toi) **still_open** — `PourToiSection.tsx:102-104` (160) vs `ProductCard.constants.ts:14` (180).
- P1-12 (flux Vendre) **partial** — Android step-aware, iOS bypassé.
- (Deux items du domaine sont `na` car portant sur du code mort modifié.)
