# CLAUDE.md — Architecture & Conventions

> Lu automatiquement par Claude à chaque session. Définit les règles RÉELLES du projet (audit 2026-04, sprints 1-5 livrés).

## STACK

Expo SDK 55+ · Expo Router v4+ (file-based) · React 19 · React Native 0.83 · Zustand 5 · React Query (TanStack) 5 · Firebase Web SDK modular v12+ · Helcim (paiement, via WebView/HelcimPay.js) · ShipEngine (shipping multi-carrier) · dayjs · Reanimated 4 · expo-image · @shopify/flash-list 2 · @gorhom/bottom-sheet 5+ · @shopify/react-native-skia · react-native-gesture-handler · AsyncStorage · TypeScript 5.3+ strict

Path aliases : `@/` → racine, `@app/` → `app/`

---

## ARCHITECTURE — racine plate (PAS `src/`)

```
app/                        # Expo Router — chaque fichier = 1 écran
├── _layout.tsx             # Root: providers (RQ, SafeArea, Theme), AppErrorBoundary, listeners (auth, chat), AuthBottomSheet
├── (tabs)/                 # Tabs (home, messages, favorites, sell, profile)
│   ├── _layout.tsx         # Badge unread via selectUnreadChatCount(uid)
│   ├── index.tsx           # Home : flat FlashList de sections
│   ├── messages.tsx        # FlashList de chats
│   └── ...
├── chat/[id].tsx           # FlashList de messages, header avatar live
├── article/[id].tsx
├── admin/
│   ├── _layout.tsx         # Guard centralisé (token.admin || isAdmin field)
│   ├── shops.tsx
│   └── shop-detail/[id].tsx
└── ...

components/                 # Composants UI réutilisés (PAS dans src/)
├── ui/                     # Design system primitives (Button, Tag, etc.)
├── home/                   # SectionHeader spécifique home
├── atoms/                  # Pill, FilterChip, Tag (Button/Badge supprimés — voir audit Sprint 4.5)
├── ProductCard.tsx         # mémoisé
├── ProductGrid.tsx         # mémoisé
├── OfferBubble.tsx         # mémoisé (rendu dans FlashList)
├── ChatBubble.tsx
├── AuthBottomSheet.tsx     # Drivé par authSheetStore
├── AppErrorBoundary.tsx    # Top-level safety net
└── ...

features/                   # Sous-features avec leur propre query-keys / hooks
└── home/                   # discover, featured-sellers, header, new-arrivals, price-drops, swap-zone, trending-brands

hooks/
├── useAuthListener.ts      # Mount onAuthStateChanged ONCE
├── useChatListener.ts      # Mount listenToUserChats ONCE
├── useAuthRequired.ts      # gating action via authSheetStore
├── useDebounce.ts
├── useFavorites.ts
├── useUserProfile.ts       # Live profile read (RQ-cached)
└── ...

services/                   # Fonctions pures async (Firebase, axios HTTP, etc.)
store/                      # Stores Zustand (authStore, chatStore, authSheetStore, notificationStore)
lib/                        # queryClient, resetAllStores
utils/                      # formatName, fixStorageUrl (centralisé), imageUtils
config/                     # firebaseConfig, i18n, aiConfig
constants/                  # theme (Editorial Luxe palette), authMessages, storageKeys
contexts/                   # SHIMS de compat — useAuth(), useChatContext(), useAuthRequired() délèguent aux stores. NE PAS étendre, préférer hooks ciblés.
types/                      # Types partagés
tests/security/             # Suite vitest + @firebase/rules-unit-testing
firestore.rules · storage.rules · firestore.indexes.json
functions/                  # Cloud Functions (callable, triggers, scheduled, http/webhooks)
```

### Imports

```
core (services, lib, utils, store, hooks) → importable partout
ui (components/, components/ui/)          → importable par features/, app/
features/{A}                               → peut importer core/ui UNIQUEMENT
features/{A}                               → ❌ pas d'import features/{B}
app/                                       → orchestre : importe features/, core/, ui/
```

### Écrans (RÈGLE CRITIQUE)

```
⚠️ PAS DE COMPOSANTS "Screen" DANS features/ !

Le contenu d'un écran (state, hooks, data, JSX) va DIRECTEMENT dans le fichier route.
  app/(tabs)/messages.tsx  ← export default function MessagesScreen() { ... }
  features/home/discover/  ← composants, hooks, services, types

❌ features/messages/MessagesScreen.tsx
❌ <MessagesScreen /> wrapper dans app/messages.tsx
```

Route files → `export default function` · Feature components → named exports + `React.memo` quand utile.

---

## STORE PATTERNS — Zustand (règles d'or)

1. **Lecture de 2+ champs d'un même store** → `useShallow` OBLIGATOIRE :
   ```typescript
   import { useShallow } from 'zustand/react/shallow';
   const { a, b } = useStore(useShallow((s) => ({ a: s.a, b: s.b })));
   ```
2. **Sélecteurs qui retournent un nouvel objet/array** (`Object.values`, `{...x}`, `filter()`) → soit memoïser dans le store (champ dérivé maintenu dans l'action — ex: `unreadCountByUser` recalculé dans `setChats`), soit consommer via `useShallow`.
3. **Listes lisant un dictionnaire indexé** → exporter un sélecteur indexé curried `selectXByUid(uid) => (state) => ...` pour qu'une mutation ciblée ne re-render qu'une seule row.
4. **Actions stables** → préférer `useStore.getState().action()` pour appels one-shot dans des effets, ou les sortir du hook via getters statiques.
5. **Compteurs/dérivés O(n)** → calculer dans l'action (`set({xCount, list})` au même moment).

### Middlewares Zustand 5 utilisés

- `subscribeWithSelector` : appliqué sur `authStore`, `chatStore`, `notificationStore` (stores hot). Permet `useStore.subscribe(selector, callback, { equalityFn })` depuis listeners Firebase.
- `immer` : **non utilisé** — toutes les actions sont des `set({field})` plats. Audit interne 2026-04 : coût > bénéfice.

### Stores actuels

| Store | Rôle | Reset |
|---|---|---|
| `authStore` | user, isLoading, guestSession, actions auth | ✅ |
| `chatStore` | chats list + unreadCountByUser dérivé | ✅ |
| `authSheetStore` | { isVisible, message, onSuccess } pour AuthBottomSheet | ✅ |
| `notificationStore` | unreadCount, pushToken, isSetupComplete | ✅ |

**`resetAllStores()` (dans `lib/resetAllStores.ts`)** : appelé au logout, reset chaque store + `queryClient.clear()`. Toujours ajouter les nouveaux stores ici.

### Hooks ciblés (préférer aux hooks aggregateurs legacy)

`useUser`, `useIsLoading`, `useIsGuest`, `useGuestSession`, `useIsFirstLaunch`, `useAuthActions` (auth) · `useChatStore(selectXxx)` directs (chat) · `useAuthSheetStore.getState().show()` (sheet).

---

## SHIMS DE COMPAT (à éviter en nouveau code)

Trois fichiers Context sont des **shims sans Provider** qui délèguent aux stores Zustand. Conservés pour ne pas casser les ~14 consumers historiques :

- `contexts/AuthContext.tsx` → `useAuth()` shim, préférer `useUser()` + `useAuthActions()`
- `contexts/ChatContext.tsx` → `useChatContext()` shim, préférer sélecteurs `chatStore`
- `contexts/AuthRequiredContext.tsx` → `useAuthRequired()` shim, préférer `useAuthSheetStore.getState().show()`

La règle : **ne pas étendre ces shims**. Migrer progressivement les consumers vers les hooks ciblés.

---

## INTERDICTIONS

```
❌ Redux, moment, react-router-native, @react-native-firebase/* SDK natif
❌ react-native-fast-image (→ expo-image), fichiers .js, any non documenté
❌ require() images, styles inline (→ StyleSheet.create), Context API NEW (→ Zustand)
❌ Emojis dans l'UI (→ SVG/images), 2 components dans un fichier
❌ Composants Screen dans features/, cross-imports entre features
❌ Stripe (le projet est 100% Helcim — Sprint 4.3 a supprimé toutes les déps)
❌ Lingui pour l'instant (mono-langue FR assumée — Sprint 2.1)
❌ console.log non gardés (toujours `if (__DEV__) console.log(...)`)
❌ Format functions avec préfixe/suffixe en dur
```

---

## CONVENTIONS

| Type | Convention | Exemple |
|------|-----------|---------|
| Composant | PascalCase | `ProductCard.tsx` |
| Hook | camelCase + `use` | `useUserProfile.ts` |
| Store | camelCase + `Store` | `authStore.ts` |
| Service | camelCase + `Service` | `chatService.ts` |
| Type | PascalCase | `UserWithUid` |
| Constante | UPPER_SNAKE_CASE | `SEARCH_DEBOUNCE_MS` |
| Dossier feature | kebab-case | `media-gallery/` |

Import order (Prettier) : React/RN → libs externes → @/ (alphabétique) → relatifs

---

## PATTERNS

**Store** : `create()(subscribeWithSelector((set, get) => ({ ...initialState, ...actions })))` avec `initialState` extrait, action `reset()` obligatoire, sélecteurs exportés (curried si paramétrés). `resetAllStores()` au logout.

**Service** : fonctions async pures (pas classes statique pour les nouveaux). Interagissent avec Firebase/API. Ne touchent JAMAIS aux stores. Si une action est sensible (paiement, balance, transition de status) → Cloud Function avec `runTransaction`.

**Hook** : orchestre services ↔ composants. Appelle services, met à jour stores via leurs actions, gère lifecycle (cleanup `useEffect`). Single-listener-pour-toute-l-app : monter dans `_layout.tsx` (ex: `useAuthListener`, `useChatListener`).

**Composant** : named export + `React.memo` quand sous une liste/parent re-render hot, interface `{Name}Props`, `StyleSheet.create()` en bas, constantes au niveau module.

**Route guard** : lecture sync stores Zustand, `<Redirect />` pour protection (ex: `app/admin/_layout.tsx`), `<Slot />` pour enfants.

**Modals partagés** : pattern Layout+Store. Un seul rendu dans `_layout.tsx`, piloté par store Zustand (ex: `AuthBottomSheet` ↔ `authSheetStore`).

**Firestore reads** : `useQuery` avec `staleTime` tuné par volatilité (1h trending brands, 30min sellers, 10min default). `gcTime: 15min` global. Pas de `useState + load on mount`.

**Listes** : `FlashList` pour toute liste virtualisable. `keyExtractor` + `renderItem` au scope module ou `useCallback`.

---

## i18n — STATUS

**Mono-langue FR assumée** (Sprint 2.1 — `LanguageContext` supprimé, ~200+ strings hardcodés en FR). Le dictionnaire `config/i18n.ts` est conservé pour une migration Lingui éventuelle. Pas de Lingui ni d'`@lingui/macro` aujourd'hui.

---

## FIREBASE

Singletons dans `config/firebaseConfig.ts` (auth, firestore, storage, functions). Auth credentials lues depuis `EXPO_PUBLIC_FIREBASE_*` avec fallback hardcodé (Sprint 1.8).

**Auth flow** : `app/_layout.tsx` → `useAuthListener()` → `onAuthStateChanged` → `authStore.hydrateFromFirebase` (single source). AsyncStorage lu seulement pour `isFirstLaunch` / guest session — n'authentifie jamais l'user.

**Sécurité** (Sprint 1) :
- Webhook Helcim : signature HMAC-SHA256 obligatoire (rejet 401 sinon)
- `transactions` : règles filtrent par buyerId/sellerId, indexes composites en place
- `seller_balances` : write-only via Cloud Functions (`runTransaction`), client refusé
- `users` : rule rejette `isAdmin/role/customClaims` en self-update (anti privilege-escalation)
- Storage : 10MB max + `image/.*` MIME sur tous les paths publics
- Admin guard centralisé (`app/admin/_layout.tsx`)

**Cloud Functions clés** :
- `helcimWebhook` (HTTP) — signature mandatory + invoiceNumber shape check
- `checkTrackingStatus` (callable) — auth check buyer|seller, marque delivered + transfère pending→available
- `requestWithdrawal` (callable) — `runTransaction` atomique, 10€ min
- `cancelPendingTransaction` (callable) — buyer-only, status pending uniquement
- `consolidateChatDuplicates` (callable, admin-only) — one-shot migration
- Home aggregators : `getTrendingBrands`, `getPriceDrops`, `getFeaturedSellers`, etc.

---

## DESIGN SYSTEM — Editorial Luxe

Style : **Editorial Luxe** (cream warm + charcoal foreground + rust primary)
Fonts : **Cormorant Garamond** (display/serif) + **Satoshi** (sans)
Icônes : SVG dans `assets/icons/`, `@expo/vector-icons` Ionicons, JAMAIS d'emojis

Couleurs principales :
- PRIMARY (rust) `#C4603A`
- SECONDARY (sage) `#7A8C6E`
- BACKGROUND (warm white) `#FAF8F4`
- SURFACE_WARM (cream) `#F5F0E8`
- FOREGROUND (charcoal) `#1A1814`
- DANGER `#D64545` · SUCCESS `#3D9970`

Coins : 14-20px (cards/buttons), 9999 (avatars/pills) · Espacement base 4px : xs:4 sm:8 md:12 lg:16 xl:24 xxl:32

---

## TESTS

```bash
# Tests règles Firestore + Storage (vitest + @firebase/rules-unit-testing)
npm run test:security

# Typecheck app
npx tsc --noEmit

# Typecheck functions
cd functions && npx tsc --noEmit
```

Suite : `tests/security/{transactions,seller_balances,users,storage}.rules.test.ts` + `helpers.ts`. 17 tests, doivent rester verts à chaque modif des rules.

---

## CHECKLIST RÉCURRENTE

```
[ ] npx tsc --noEmit → pas de NOUVELLE erreur (legacy errors documentés)
[ ] npm run test:security → 17/17 ✅
[ ] Aucun import interdit (redux, moment, @lingui/macro, @react-native-firebase, stripe, atoms/Button)
[ ] Aucun Screen dans features/, aucun cross-import entre features
[ ] Stores avec reset() + ajoutés à resetAllStores
[ ] useShallow appliqué dès qu'on lit 2+ champs d'un store
[ ] Sélecteurs paramétrés en curried `selectXByY(y) => state => …`
[ ] Listes virtualisées (FlashList), renderItem mémoïsé
[ ] console.log derrière `if (__DEV__)`
[ ] Mutations financières / status sensibles → Cloud Function (pas client)
```

---

## CONFIG

tsconfig : `strict: true`, paths `@/` → racine, `@app/` → `app/`
babel : `babel-preset-expo` + `react-native-worklets/plugin` (dernier)
prettier : singleQuote, semi, printWidth 100, tri imports via `@trivago/prettier-plugin-sort-imports`
firestore.rules + storage.rules : déployer via `firebase deploy --only firestore:rules,storage`
indexes : `firestore.indexes.json` est source de vérité, déployer via `firebase deploy --only firestore:indexes` (peut nécessiter `--force` pour purger les orphans serveur)

---

**Référence audit complet** : `AUDIT_REPORT.md` (sprints 1-5 livrés et déployés sur `seconde-b47a6`).
