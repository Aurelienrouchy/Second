# CLAUDE.md — Architecture & Conventions

> Lu automatiquement par Claude a chaque session. Definit les regles du projet.

## STACK

Expo SDK 55+ · Expo Router v4+ (file-based) · Zustand 5+ · Firebase Web SDK modular v12+ · axios + axios-retry · Lingui 5.9+ · dayjs · Reanimated 4 · expo-image · @shopify/flash-list · @gorhom/bottom-sheet v5+ · @shopify/react-native-skia · react-native-gesture-handler · AsyncStorage · TypeScript 5.3+ strict

Path aliases : `@/` → `src/`, `@app/` → `app/`

---

## ARCHITECTURE (FSD — Feature-Sliced Design)

```
app/                        # Expo Router — ecrans complets (export default function)
├── _layout.tsx             # Root layout : providers, fonts, bootstrap auth
├── (auth)/                 # Routes non-authentifiees
└── (app)/(tabs)/           # Routes protegees, chaque fichier = 1 ecran complet

src/
├── core/                   # Noyau partage (config, hooks, services, store, types, utils)
│   └── services/firebase/  # Singletons : app, auth, database, storage, functions
├── ui/                     # Design system (tokens, primitives, buttons, cards, inputs, layout, modals, feedback)
└── features/{feature}/     # Modules business isoles
    ├── components/hooks/services/store/types/constants/utils/
    └── index.ts            # Barrel exports (PAS de Screen export)
```

### Imports (stricte)

```
core/          → importable par tout le monde
ui/            → importable par features/ et app/
features/{A}   → peut importer core/ et ui/ UNIQUEMENT
features/{A}   → ❌ NE PEUT PAS importer features/{B}
app/           → orchestre : importe features/, core/, ui/
```

### Promotion (regle de trois)

1 feature → reste local · 2 features → tolere temporairement · 3+ features → promouvoir dans core/

### Ecrans (REGLE CRITIQUE)

```
⚠️ PAS DE COMPOSANTS "Screen" DANS features/ !

Le contenu d'un ecran (state, hooks, data, JSX) va DIRECTEMENT dans le fichier route.
  app/(app)/(tabs)/(dashboard)/sales.tsx  ← export default function SalesPage() { ... }
  features/dashboard/sales/              ← composants, hooks, services, types, utils, constants

❌ features/dashboard/sales/SalesScreen.tsx
❌ <SalesScreen /> wrapper dans app/sales.tsx
```

Route files → `export default function` · Feature components → named exports + `React.memo`

---

## INTERDICTIONS

```
❌ Redux, moment, react-router-native, @react-native-firebase/* SDK natif
❌ react-native-fast-image (→ expo-image), fichiers .js, any non documente
❌ require() images, styles inline (→ StyleSheet.create), Context API (→ Zustand)
❌ Emojis dans l'UI (→ SVG/images), 2 components dans un fichier
❌ Composants Screen dans features/, cross-imports entre features
❌ import { t } from '@lingui/macro' (→ '@lingui/core/macro')
❌ Format functions avec prefixe/suffixe en dur ($/h → props valuePrefix/valueSuffix)
```

---

## CONVENTIONS

| Type | Convention | Exemple |
|------|-----------|---------|
| Composant | PascalCase | `ShiftCard.tsx` |
| Hook | camelCase + `use` | `useWeeklySchedule.ts` |
| Store | camelCase + `Store` | `authStore.ts` |
| Service | camelCase + `Service` | `chatService.ts` |
| Type | PascalCase | `UserWithUid` |
| Constante | UPPER_SNAKE_CASE | `MAX_HOURS_PER_WEEK` |
| Dossier feature | kebab-case | `media-gallery/` |

Import order (Prettier) : React/RN → libs externes → @/core → @/ui → @/features → relatifs

---

## PATTERNS

**Store** : `create<State>()` avec `initialState` extrait, action `reset()` obligatoire, selecteurs exportes. `resetAllStores()` au logout.

**Service** : fonctions async pures (pas classes, pas hooks). Interagissent avec Firebase/API. Ne touchent JAMAIS aux stores.

**Hook** : orchestrent services ↔ composants. Appellent services, mettent a jour stores, gerent lifecycle (cleanup useEffect).

**Composant** : named export + `React.memo`, interface `{Name}Props`, `StyleSheet.create()` en bas, constantes au niveau module.

**Route guard** : lecture synchrone stores Zustand, `<Redirect />` pour protection, `<Slot />` pour enfants.

**Formulaire** : useState local dans hook, validation avec fonctions pures, retourne `{ form, setField, handleSubmit }`.

---

## i18n — LINGUI 5.9+

```typescript
// ✅ Macros depuis les sous-modules
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
// ❌ DEPRECATED : import { t } from '@lingui/macro'

// Runtime (pas des macros)
import { I18nProvider, useLingui } from '@lingui/react';
```

Source locale : francais · babel plugin `@lingui/babel-plugin-lingui-macro`

---

## FIREBASE

Singletons dans `core/services/firebase/` (app, auth, database, storage, functions). Client API dans `core/services/api/client.ts` : axios avec intercepteurs auth (injecte token, refresh sur 401).

Auth flow : `app/_layout.tsx` → `useAuth()` → `onAuthStateChanged` → hydrate stores ou `resetAllStores()`

---

## DESIGN SYSTEM

Style : **Glassmorphism iOS moderne** · Font : **Figtree uniquement** · Icones : SVG dans `assets/icons/`, JAMAIS d'emojis

Coins : 16-24px (cards), 12px (petits elements), 9999 (avatars) · Fonds : BlurView iOS / rgba fallback Android · Ombres : legeres (shadowOpacity 0.06-0.08) · Espacement base 4px : xs:4 sm:8 md:12 lg:16 xl:24 xxl:32

Couleurs principales : PRIMARY #3B82F6 · SURFACE #F2F2F7 · TEXT_PRIMARY #1A1A1A · TEXT_SECONDARY #74809B · SUCCESS #34C759 · ERROR #FF3B30 · BORDER #DFE9F2

Typographie : HEADING_XL 28px ExtraBold → BODY 15px Regular → CAPTION 12px Medium

Composants : CARD borderRadius 20 / BUTTON_PRIMARY borderRadius 14 h48 / INPUT borderRadius 14 h48 / PAGESHEET_HEADER via ui/layout/PageSheetHeader paddingTop 16

Primitives : Text (resout fontWeight→ttf Android), PressableBounce, Image (expo-image), BlurView

---

## MODALS PARTAGES (REGLE D'ARCHITECTURE)

Les modals utilises par plusieurs ecrans d'un meme groupe (ex: CalendarModal, TimePeriodModal, CustomRangeCalendar dans le dashboard) ne sont PAS dupliques dans chaque ecran.

```
Pattern : Layout + Store

1. Les modals sont rendus UNE SEULE FOIS dans le _layout.tsx du groupe
   Ex: app/(app)/(tabs)/(dashboard)/_layout.tsx rend CalendarModal, TimePeriodModal, etc.

2. Un store Zustand dedie pilote l'etat des modals
   Ex: features/dashboard/store/modalStore.ts
   → openCalendarModal(onSelect, buttonPosition), closeCalendarModal(), etc.

3. Chaque ecran appelle simplement openCalendarModal() au lieu de gerer le state local

❌ Dupliquer CalendarModal + state dans chaque ecran
✅ Un seul rendu dans le layout, pilote par un store
```

---

## CONFIG

tsconfig : `strict: true`, paths `@/` → `src/`, `@app/` → `app/`
babel : `babel-preset-expo` + `@lingui/babel-plugin-lingui-macro` + `react-native-worklets/plugin` (dernier)
prettier : singleQuote, semi, printWidth 100, tri imports via `@trivago/prettier-plugin-sort-imports`

---

## CHECKLIST

```
[ ] npx tsc --noEmit → 0 erreurs
[ ] Aucun import interdit (redux, moment, @lingui/macro, @react-native-firebase)
[ ] Aucun Screen dans features/, aucun cross-import entre features
[ ] Stores avec reset(), services = fonctions pures, StyleSheet.create()
[ ] Format functions sans prefixe/suffixe en dur
```
