# RAPPORT D'AUDIT COMPLET — Application "Second"

7 agents spécialisés ont analysé l'app en parallèle (architecture, state, services, perf, hooks/composants, routing/auth, sécurité). Voici la synthèse exhaustive.

---

## 0. Résumé exécutif

**État général : fonctionnel mais avec des risques critiques en sécurité financière, et une dette architecturale importante.**

L'app est une marketplace Expo/Firebase mature (323 fichiers TS/TSX, 21 services, Cloud Functions, paiements Helcim, IA, swap, chat temps réel). Le code fonctionne, la stack technique est moderne (Expo 55, React 19, RN 0.83, Reanimated 4, FlashList 2, React Query 5, Zustand 5). Mais **CLAUDE.md décrit une architecture qui n'est plus celle du projet** (pas de `src/`, pas de Lingui, pas d'axios, palette divergente, fonts différentes), et plusieurs règles fondamentales (Context API interdit, `resetAllStores` obligatoire) sont violées partout.

### 🔴 Top 5 risques bloquants

| # | Risque | Fichier:ligne | Impact |
|---|---|---|---|
| 1 | **Webhook Helcim sans vérif de signature obligatoire** — paiement contournable | `functions/src/http/webhooks.ts:77-90` | Fraude |
| 2 | **Toutes les transactions lisibles par tout user authentifié** | `firestore.rules:445` (TODO laissé en prod) | Fuite données financières |
| 3 | **Routes `/admin/*` sans aucun guard** | `app/admin/shops.tsx:30` | Privilege escalation |
| 4 | **Storage : uploads illimités, sans validation MIME** | `storage.rules:10-27` | Abuse / DoS coûts |
| 5 | **`checkTrackingStatus` CF n'auth-checke pas l'appelant** | `functions/src/callable/payments.ts:246` | Transfert de fonds forcé |

---

## 1. Architecture & conformité CLAUDE.md

### 1.1 Écart structurel majeur

| Règle CLAUDE.md | Réalité | Sévérité |
|---|---|---|
| Code dans `src/` | À la racine (`app/`, `components/`, `hooks/`, `services/`, `store/`, `contexts/`, `features/`, `constants/`, `utils/`) | ❌ |
| Alias `@/` → `src/` | `tsconfig.json:7` → `./` (racine) | ❌ |
| Lingui 5.9+ | **Pas installé** dans `package.json` | ❌ |
| axios + axios-retry | **Pas installé** (Cloud Functions `httpsCallable` à la place) | ❌ |
| Font Figtree uniquement | `app/_layout.tsx:78-87` charge Cormorant Garamond + Satoshi | ❌ |
| Couleurs PRIMARY `#3B82F6` | `constants/theme.ts:19` → PRIMARY `#C4603A` (rust), thème "Editorial Luxe" | ❌ |
| Glassmorphism iOS | Style Cream/Charcoal/Rust | ❌ |
| Context API interdit (→ Zustand) | **4 Contexts actifs** : Auth, Chat, Language, AuthRequired | ❌ CRITIQUE |
| `resetAllStores()` au logout | **N'existe pas** ; seul `notificationStore.reset()` est appelé | ❌ |
| Pas de `Screen` dans `features/` | ✅ Respecté |
| Stores Zustand corrects | ✅ `notificationStore` est conforme (mais c'est le **seul** store) |
| Services = fonctions pures | ⚠️ 15/21 sont des **classes statiques** (pas conformes) |
| `StyleSheet.create()` (pas inline) | ⚠️ Quelques inline styles dans `_layout.tsx`, `index.tsx` |
| Modals partagés via Layout+Store | ❌ Aucun groupe `(tabs)/_layout.tsx` ne rend de modals partagés ; chaque écran duplique |

### 1.2 Structure réelle des features

Une seule feature organisée FSD-like : `features/home/` avec 7 sous-features bien structurées (`discover/`, `featured-sellers/`, `header/`, `new-arrivals/`, `price-drops/`, `swap-zone/`, `trending-brands/`) + `query-keys.ts` centralisé. **Tout le reste vit dans `app/`, `components/`, `hooks/`, `contexts/`, `services/`** — il n'y a pas de `features/auth/`, `features/chat/`, `features/sell/`, `features/article/`, alors que ce sont les domaines majeurs de l'app.

### 1.3 Doublons & dead code repérés

- `components/MakeOfferModal.tsx` (re-export wrapper) + `components/MakeOfferModal/index.tsx` (impl) → wrapper inutile
- `components/atoms/Button.tsx` ↔ `components/ui/Button.tsx` (variants différents)
- `components/atoms/Badge.tsx` ↔ `components/ui/Tag.tsx` (export Badge)
- `components/home/SectionHeader.tsx` ↔ `components/ui/SectionHeader.tsx`
- `hooks/useAuthRequired.ts` (35 lignes) ↔ `contexts/AuthRequiredContext.tsx` — bridge superflu
- `contexts/ChatContext.tsx` ↔ `hooks/useChat.ts` (`useChats`) — **double listener Firestore actif en permanence**
- `useNewArrivals` ↔ `useDiscoverArticles` — même Cloud Function
- `CameraCapture.tsx` ↔ `VisualSearchCamera.tsx` — logique permission dupliquée
- `@stripe/stripe-react-native` dans `package.json` mais 100% Helcim utilisé
- `stripe@^20.0.0` dans `functions/package.json` non utilisé
- `firebase` & `firebase-admin` en `devDependencies` au lieu de `dependencies`
- `mcp-servers/` à la racine + `@composio/mcp` en dep de prod

---

## 2. State management (Zustand · Contexts · React Query)

### 2.1 Inventaire des stores Zustand

| Store | LOC | `initialState` | `reset()` | Sélecteurs | Persist | Side-effects |
|---|---|---|---|---|---|---|
| `store/notificationStore.ts` | 100 | ✅ (l.69) | ✅ (l.86) | ✅ (l.92-99) | ❌ | ❌ |

**C'est le seul store du projet.** Il est conforme au CLAUDE.md.

### 2.2 Inventaire des Contexts (anti-pattern selon CLAUDE.md)

| Context | LOC | Rôle | Migrer ? |
|---|---|---|---|
| `AuthContext` | 320 | user, isLoading, isFirstLaunch, guestSession + 12 méthodes | ✅ **OUI — Critique** |
| `ChatContext` | 162 | chats, messages, currentChat (2 listeners Firestore globaux) | ✅ **OUI** |
| `LanguageContext` | 60 | langue + dict statique custom | ✅ Migration vers `persist` Zustand |
| `AuthRequiredContext` | 45 | ref impérative bottom sheet | ⚠️ Légitime (ref) |

**Problèmes structurels** :
- `AuthContext` viole 3 règles : Context API, `mergeGuestToUser` appelle `httpsCallable` dans le contexte (devrait être un service), `signOut` reset un seul store + zéro `queryClient.clear()`.
- `ChatContext` est rendu dans `app/_layout.tsx` → **listener Firestore actif en permanence sur tous les chats** uniquement pour calculer le badge unread dans `app/(tabs)/_layout.tsx:57`.
- **Race condition** : `checkAuthState()` (AsyncStorage) et `onAuthStateChanged` (Firebase) tournent en parallèle au démarrage (`AuthContext:56-83`) → fenêtre d'incohérence visible.
- **Hydratation `setUser(JSON.parse(savedUser))` sans re-validation Firebase** (`AuthContext:100-101`) → si token révoqué, user "connecté" pendant plusieurs secondes.

### 2.3 React Query

`QueryClient` configuré dans `app/_layout.tsx:24-31` avec `staleTime: 10min`, `retry: 2`. **`gcTime` non défini** (défaut 5min < staleTime → incohérence, GC avant expiration).

**Bonnes pratiques observées** : `features/home/query-keys.ts` factory centralisée, `useFavorites` avec optimistic + rollback (l.183-265), `useDiscoverArticles` en `useInfiniteQuery`.

**Mauvaises pratiques** :
- `app/article/[id].tsx:256-268` : useState + loadArticle plain (pas de cache, refetch à chaque visite).
- `hooks/useArticleSearch.ts` (337 lignes) : réimplémente pagination + retry manuel + state machine — devrait être un `useInfiniteQuery`. **Pas de debounce sur `searchQuery`** (`l.261-264`) → requête à chaque keystroke.
- `app/my-articles.tsx:53-57` : `useFocusEffect` reload complet sans cache.
- `app/(tabs)/favorites.tsx` : double source (`useFavorites()` ids + `useInfiniteQuery` articles) avec invalidation fragile.

### 2.4 AsyncStorage

5+ usages manuels (`user_data`, `has_launched_before`, `user_language`, `user_favorites`, `ONBOARDING_COMPLETED_KEY`). **Aucune migration de schéma** — risque de crash silencieux si `User` évolue. Aucun usage de `zustand/middleware persist`.

---

## 3. Services & Firebase

### 3.1 Récap par service (21 services, ~7 800 LOC totales)

| Service | LOC | Pattern | Pagination | Risques |
|---|---|---|---|---|
| `articlesService` | 653 | classe statique | partielle | `searchArticles` over-fetch `limit*5`, filtrage client, dupplique `fixStorageUrl` |
| `chatService` | 1213 | classe statique | ❌ `listenToMessages` sans `limit` | Race `unreadCount`, 30+ logs PII, `markMessagesAsRead` sans batch |
| `swapService` | 1051 | fonctions exportées | ❌ | N+1 dans accept/decline/cancel multi-items |
| `aiService` | 614 | fonctions | N/A | OK |
| `userService` | 489 | classe statique | N/A | catch silencieux retournant `null` |
| `transactionService` | 370 | classe statique | ❌ `getUserTransactions` | Écritures financières directes côté client |
| `notificationService` | 401 | classe statique | ❌ | Double-écriture `addDoc`+`updateDoc(id)` ; règle `allow create: if false` mais service appelle `addDoc` → écrit jamais en prod ! |
| `sellerBalanceService` | 264 | classe statique | N/A | **read-modify-write non atomique** sur des soldes |
| `userStatsService` | 237 | classe statique | ❌ | **N+1** `getDoc` en boucle, collection `ventes` qui n'existe plus dans les rules |
| `moderationService` | 275 | classe statique | ❌ | **Mismatch champs** vs `firestore.rules:412-433` — reports rejetés silencieusement |
| `shopService` | 452 | classe statique | ❌ `getApprovedShops` | `approveShop`/`rejectShop` sans guard admin |

### 3.2 Décalage Firestore Rules ↔ Indexes ↔ Services

- `firestore.indexes.json` contient des indexes pour `products` (avec `moderationStatus`) — collection **legacy** ; l'app utilise `articles`. La majorité des indexes `products` sont obsolètes.
- `articles` n'a **pas** de validation `isValidArticleData()` dans les rules (contrairement à `products`).
- `notifications` : règle `allow create: if false` (l.65-69) mais `notificationService.ts:40` fait un `addDoc` direct → toutes les notifications créées côté client sont rejetées.

### 3.3 Stripe vs Helcim

Le flux actif est 100% Helcim (`createHelcimCheckout`, `helcimWebhook`). Le package `@stripe/stripe-react-native` côté client et `stripe@^20.0.0` côté functions sont des résidus d'une migration → **dead code à supprimer**.

### 3.4 Cloud Functions

Architecture modulaire propre (`callable/`, `triggers/`, `scheduled/`, `http/`). 30+ fonctions, Node 20, `memory: 512MiB` sur les fonctions lourdes. Singletons Firebase OK (`config/firebaseConfig.ts:1-31`, double-init protégée).

---

## 4. Performance — Top 20 problèmes

### 🔴 Impact HAUT

1. **`searchArticles` over-fetch `limit*5`** (`services/articlesService.ts:434`) — 100 docs transférés pour 20 affichés à chaque keystroke.
2. **`useArticleSearch` sans debounce** (`hooks/useArticleSearch.ts:261-264`) — requête à chaque caractère.
3. **Double listener Firestore chats** — `ChatContext:41-63` + `useChats` dans `messages.tsx:31` font le **même** abonnement.
4. **`DiscoverGrid` = ScrollView + .map()** (`features/home/discover/DiscoverGrid.tsx:55-73`) — 100+ ProductCard rendus simultanément, pas de virtualisation.
5. **`ImageGallery` charge toutes les images d'un coup** (`components/ImageGallery.tsx:121-139`) — pas de lazy load, pas de `recyclingKey`.
6. **`useToggleFavorite` instancie `useFavorites()` complet par carte** (`hooks/useFavorites.ts:283-286`) — 80 abonnements RQ pour 40 cartes.
7. **`console.log` non gardés** dans `articlesService` (10+/recherche), `chatService` (30+), `useArticleSearch`.
8. **4 Contexts imbriqués au root** — chaque setState d'un Context re-rend tout l'arbre.
9. **`AuthContext` `contextValue` non stable** (`l.296-313`) — méthodes pas en `useCallback` → re-render de tous les consumers à chaque changement.
10. **`LanguageContext` value non mémoïsée** (`l.55-57`).

### 🟡 Impact MOYEN

11. `MessagesScreen` et `ChatScreen` utilisent `FlatList` au lieu de `FlashList`.
12. `renderMessage` inline non-mémo dans `app/chat/[id].tsx:328-353`.
13. `SimilarProducts` ScrollView+map (`components/SimilarProducts.tsx:151-173`).
14. Handlers `onPress` non `useCallback` dans cards mémoïsées (Brand, PriceDrop, Seller).
15. `my-articles.tsx` reload complet à chaque focus (`l.53-57`).
16. `article/[id].tsx` sans React Query (`l.256-268`).
17. Animations `FadeInDown.delay(index*50)` recréées à chaque render.
18. `gcTime` non défini (`app/_layout.tsx:24-31`).
19. **`fixStorageUrl` dupliqué dans 3 fichiers** + non mémoïsé → regex 40× par render dans `DiscoverGrid`.

### 🟢 Impact BAS

20. `pinchGesture` partagé entre toutes les images zoom dans `ImageGallery`.

### Top fichiers les plus longs

| Fichier | Lignes |
|---|---|
| `services/chatService.ts` | 1213 |
| `services/swapService.ts` | 1051 |
| `app/search.tsx` | ~913 |
| `app/onboarding.tsx` | 730 |
| `services/articlesService.ts` | 653 |
| `components/OfferBubble.tsx` | ~640 |
| `services/aiService.ts` | 614 |
| `app/chat/[id].tsx` | ~580 |
| `app/(tabs)/messages.tsx` | 546 |
| `components/ProductCard.tsx` | ~512 |
| `components/AuthBottomSheet.tsx` | ~475 |

### Listes — virtualisation

| ✅ FlashList | ⚠️ FlatList | ❌ ScrollView+map |
|---|---|---|
| `ProductGrid`, `my-articles` | `messages.tsx:193`, `chat/[id]:472` | `DiscoverGrid`, `SimilarProducts`, `NewArrivalsSection`, `TrendingBrandsSection`, `ImageGallery` |

### Quick wins (< 30 min)

1. `useDebounce(searchQuery, 350)` dans `useArticleSearch`.
2. Wrapper `console.log` dans `if (__DEV__)` (chatService + articlesService).
3. Remplacer `DiscoverGrid` par `ProductGrid` (FlashList déjà existant).
4. Supprimer le double listener chat (`useChats` dans messages.tsx).
5. `gcTime: 15 * 60 * 1000` dans QueryClient.

---

## 5. Hooks & Composants

### 5.1 22 hooks audités

**Top à refactorer** :
- `useArticleSearch` (270 LOC) — à découper, manque debounce, déps useEffect manquantes.
- `useChat` + `useChats` dans le **même** fichier (`hooks/useChat.ts`) — viole "1 export/fichier".
- `useNearbyArticles` — fetch 100 articles client + filtre Haversine local, pas de pagination ni abort.
- `usePersonalizedFeed:75` — `getPersonalizationData()` appelée 2× par render.
- `useDiscoverArticles` + `useNewArrivals` — appellent la même CF, à fusionner.

### 5.2 60+ composants

Familles : Bottom Sheets (8), Home Sections (7), UI Kit (20+), Cards (5), Caméra (3), Chat/Offres (2), Search (3), Atoms legacy (2).

**Composants à refactorer** :
- `app/article/[id].tsx` (~770 LOC) — extraire `ArticleHero`, `ArticleDetails`, `ArticleCTABar`.
- `components/AuthBottomSheet.tsx` (~475 LOC) — 3 modes (signin/signup/forgot) en FSM dans 1 fichier.
- `components/OfferBubble.tsx` (~640 LOC) — gère display + actions + paiement, **pas mémoïsé alors que dans une FlatList**.
- `app/search.tsx` — extraire `useSearchScreen` hook + sous-composants.
- `app/onboarding.tsx` (730 LOC) — `SizeChip`, `SexOption` inline + grosses constantes → déplacer dans `features/onboarding/`.

**Manque `React.memo`** : OfferBubble, SectionHeader (home), SimilarProducts, ProductGrid, SaveSearchButton, RecentSearches, CategoryGrid, VisualSearchCamera.

### 5.3 i18n

Lingui n'est pas installé. Système custom `config/i18n.ts` + `LanguageContext`. **~200+ strings UI hardcodés en français** dans ~30 fichiers (`"Voir tout"`, `"Plus récents"`, dates en français inline, pluriels manuels). L'app n'est **pas localisable** sans réécriture.

---

## 6. Routing & Auth

### 6.1 Architecture des routes

**Pas de groupes `(auth)` ni `(app)`** comme décrit dans CLAUDE.md. Tout est un Stack racine. Seuls `(tabs)` et `sell/` sont des sous-Stacks.

### 6.2 Problèmes critiques

| # | Issue | Fichier:ligne |
|---|---|---|
| P1 | **`/admin/*` sans aucun guard** | `app/admin/shops.tsx:30`, `app/admin/shop-detail/[id].tsx` |
| P2 | **Routes `/swap-party/[id]`, `/swap/[id]`, `/user/[id]` référencées par push notifications mais inexistantes** → crash sur tap notif | `hooks/useNotificationSetup.ts:77-82` |
| P3 | Hydratation user depuis AsyncStorage sans revalidation | `contexts/AuthContext.tsx:100-101` |
| P4 | Pas de `resetAllStores()` au logout | `contexts/AuthContext.tsx:190-207` |
| P5 | Auth via Context API (interdit) | `contexts/AuthContext.tsx` |
| P6 | Race `checkAuthState` ↔ `onAuthStateChanged` | `contexts/AuthContext.tsx:56-83` |
| P7 | `onboarding.tsx` 730 LOC, composants inline | `app/onboarding.tsx:46-730` |
| P8 | `filters.tsx` modal duplique la logique de `search.tsx` | `app/filters.tsx:22-50` |
| P9 | `+not-found.tsx` = template Expo non customisé | `app/+not-found.tsx` |
| P10 | Aucune Error Boundary globale (seulement `SectionErrorBoundary` home) | — |

### 6.3 Deep linking

`useDeepLinking` couvre `seconde://article/`, `chat/`, `shop/`, `search`. Manque la couverture de `swap-party/`, `swap/`, `user/` mentionnés dans `app.config.js` Android intent filters → **3 trous de couverture** qui crashent les push notifs correspondantes.

### 6.4 Push notifications

`useNotificationSetup` demande `requestPermissionsAsync()` immédiatement à la connexion (`l.192-213`) → mauvais timing iOS, taux d'acceptation faible.

---

## 7. Sécurité — Détails

### 7.1 Webhook Helcim — fraude possible

`functions/src/http/webhooks.ts:77-90` : si `helcimSecretToken` ou header signature absent, **vérification skipée silencieusement**. POC :
```
POST /helcimWebhook { invoiceNumber, status: "APPROVED" }
→ marque transaction "paid" → crédite vendeur → génère étiquette ShipEngine
```
**Fix obligatoire** : rejeter en 401 si signature absente, sans condition.

### 7.2 Firestore Rules — fuite financière en prod

`firestore.rules:445` :
```
// TODO: Optimize with composite index
allow read: if isAuthenticated();
```
→ **toute transaction de tout user lisible**. À fixer immédiatement avec filtre `buyerId == request.auth.uid || sellerId == request.auth.uid` + index composite.

### 7.3 Storage Rules — abuse

`storage.rules:10-27` : pas de limite de taille, pas de validation MIME sur `/products/`, `/articles/`, `/drafts/`. Un utilisateur authentifié peut uploader 1 GB de n'importe quoi.

### 7.4 `checkTrackingStatus` non protégé

`functions/src/callable/payments.ts:246-354` : pas de check `request.auth.uid ∈ {buyerId, sellerId}` → n'importe qui peut forcer le statut `DELIVERED` et déclencher le transfert au vendeur.

### 7.5 Race conditions financières

- `sellerBalanceService.movePendingToAvailable` et `requestWithdrawal` : read-modify-write non atomique côté **client** → double crédit / retrait possible.
- `chatService:260-267` : `unreadCount + 1` après getDoc → counter cassé en cas de messages quasi-simultanés. Utiliser `increment(1)`.

### 7.6 Logs PII en prod

`chatService.ts` : 30+ `console.log` affichant participantIds, message contents. `AuthContext:270-278` : navigation guest. À conditionner avec `__DEV__`.

### 7.7 Credentials

Clés Firebase Web SDK en dur dans `config/firebaseConfig.ts:8-15` (`.env.example` les prévoit pourtant). Pas critique (rules protègent) mais signal de mauvaise hygiène.

---

## 8. Plan d'action priorisé

### 🔥 Sprint 1 — Bloquants sécurité (1-2 jours, à faire avant la prochaine release)

| # | Action | Fichier | Effort |
|---|---|---|---|
| 1 | Webhook Helcim : rejeter si signature absente | `functions/src/http/webhooks.ts` | S |
| 2 | Firestore rule `transactions` : filtrer par buyer/seller | `firestore.rules:445` | S + index |
| 3 | Guards admin sur `app/admin/_layout.tsx` (custom claim) | nouveau fichier | S |
| 4 | `checkTrackingStatus` : check appelant ∈ {buyer, seller} | `functions/src/callable/payments.ts:246` | S |
| 5 | Storage rules : taille max 10MB + MIME `image/*` | `storage.rules:10-27` | S |
| 6 | `sellerBalance*` & `transactionService` mutations sensibles → CF avec `runTransaction` | services + functions | M |
| 7 | `chatService.unreadCount` : `increment(1)` | `chatService.ts:265` | S |
| 8 | Migrer credentials Firebase vers `EXPO_PUBLIC_*` | `config/firebaseConfig.ts` | S |

### 🟠 Sprint 2 — Architecture state (3-5 jours)

| # | Action | Effort |
|---|---|---|
| 9 | Migrer `AuthContext` → `authStore` Zustand + sortir `mergeGuestToUser` dans un service | L |
| 10 | Migrer `ChatContext` → `chatStore` + supprimer le double listener (`useChats` redondant) | M |
| 11 | Migrer `LanguageContext` → Zustand `persist` middleware | S |
| 12 | Créer `core/utils/resetAllStores.ts` + `queryClient.clear()` au logout | S |
| 13 | `article/[id]` → `useQuery({queryKey:['article',id]})` | S |
| 14 | `useArticleSearch` → `useInfiniteQuery` + `useDebounce(searchQuery, 350)` | M |
| 15 | `my-articles` → `useQuery` (supprimer `useFocusEffect` reload) | S |

### 🟡 Sprint 3 — Performance (2-3 jours)

| # | Action | Effort |
|---|---|---|
| 16 | `DiscoverGrid` → `FlashList` (réutiliser `ProductGrid`) | S |
| 17 | `MessagesScreen` + `ChatScreen` → `FlashList` + `renderItem` mémo | M |
| 18 | Mémoïser `OfferBubble`, `SimilarProducts`, `ProductGrid`, `SaveSearchButton`, `RecentSearches`, `CategoryGrid` | S |
| 19 | `console.log` → `if (__DEV__)` (chatService, articlesService, useArticleSearch) | S |
| 20 | `gcTime: 15 * 60 * 1000` dans QueryClient | S |
| 21 | Centraliser `fixStorageUrl` dans `utils/` + mémoïser dans cards | S |
| 22 | `searchArticles` : déplacer filtres couleur/taille/marque côté Firestore (indexes composites) ou CF | M |
| 23 | `onPress` handlers en `useCallback` dans cards mémoïsées | S |
| 24 | `notificationService.createNotification` : `setDoc(doc(...))` au lieu de `addDoc + updateDoc` | S |
| 25 | `swapService` accept/decline/cancel : `writeBatch` au lieu de N+1 | M |

### 🟢 Sprint 4 — Dette & cohérence (1 semaine)

- Splitter `app/onboarding.tsx`, `app/article/[id].tsx`, `app/search.tsx`, `OfferBubble`, `AuthBottomSheet` en sous-composants/hooks.
- Créer `features/auth/`, `features/chat/`, `features/article/`, `features/sell/`, `features/search/`, `features/onboarding/`.
- Supprimer doublons : `atoms/Button` ↔ `ui/Button`, `home/SectionHeader` ↔ `ui/SectionHeader`, wrapper `MakeOfferModal.tsx`.
- Supprimer dead code Stripe (client + functions).
- Créer routes manquantes `/swap-party/[id]`, `/swap/[id]`, `/user/[id]`.
- Customiser `+not-found.tsx`.
- Ajouter `ErrorBoundary` global au root layout.
- Décider : i18n complète avec Lingui OU assumer le mono-langue et supprimer `LanguageContext`.
- **Mettre à jour CLAUDE.md** pour refléter la vraie architecture (racine vs `src/`, vrai design system, vraie stack).

### 🔵 Sprint 5 — Backend cleanup

- Supprimer indexes Firestore obsolètes pour collection `products`.
- Ajouter `isValidArticleData()` rule pour `articles`.
- Aligner `moderationService` ↔ rule `isValidReportData` (mismatch de noms de champs).
- Décider : `userStatsService` legacy à supprimer (collection `ventes` n'existe plus) ou réécrire en CF.
- Helcim webhook : valider que `metadata.transactionId` existe avant de matcher par `invoiceNumber`.

---

## 9. Métriques globales

| Indicateur | Valeur |
|---|---|
| Fichiers TS/TSX (hors node_modules/native) | 323 |
| Services | 21 (~7 800 LOC) |
| Hooks | 22 |
| Composants | 60+ (à plat dans `components/`) |
| Stores Zustand | 1 |
| Contexts React (anti-pattern) | 4 |
| Cloud Functions | 30+ |
| Strings UI hardcodés (estim.) | 200+ |
| Fichiers > 500 LOC | 11 |
| `console.log` non-DEV (chatService seul) | 30+ |
| `as any` (chatService seul) | 20+ |
| TODO laissés en prod (rules) | au moins 1 critique |
| Listes non virtualisées | 5 (DiscoverGrid, SimilarProducts, ImageGallery, NewArrivals, TrendingBrands) |

---

## 10. Fichiers clés à connaître

**Pour comprendre l'archi** : `app/_layout.tsx`, `tsconfig.json`, `constants/theme.ts`, `package.json`, `features/home/query-keys.ts`.

**Points de douleur principaux** : `contexts/AuthContext.tsx`, `contexts/ChatContext.tsx`, `services/chatService.ts`, `services/articlesService.ts`, `services/sellerBalanceService.ts`, `hooks/useArticleSearch.ts`, `firestore.rules:445`, `functions/src/http/webhooks.ts:77`, `functions/src/callable/payments.ts:246`.

**Bons exemples à généraliser** : `features/home/*` (FSD propre), `store/notificationStore.ts` (pattern Zustand), `hooks/useFavorites.ts` (RQ + optimistic update), `hooks/useNotificationSetup.ts` (lifecycle propre).

---

**Conclusion** : l'app est techniquement solide sur les fondations (stack moderne, RQ bien utilisé sur home, services modulaires) mais souffre de **3 problèmes structurels** qui se renforcent : (1) divergence forte entre CLAUDE.md et le code → équipe sans boussole, (2) state global en Context API → re-renders + couplage + impossibilité de `resetAllStores`, (3) services côté client qui font des opérations financières → exposition rules + race conditions. Les bloquants sécurité (webhook, rules transactions, admin guards) doivent être traités cette semaine ; le reste peut suivre un plan de 4-5 sprints.
