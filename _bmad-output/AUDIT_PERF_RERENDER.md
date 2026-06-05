Tout est confirmé. `useAuthRequired` s'abonne bien à `user` (full) ET `isLoading` (L14-15), même pour les consumers qui ne lisent que `requireAuth`/`showAuthSheet` (AUTH-RR-02 confirmé). Les hooks de `useAuth.ts` sont propres et scopés. J'ai assez de preuves pour le rapport.

---

# RAPPORT PERF & RE-RENDER — Second

> Audit re-renders / mémoïsation. Tous les findings ci-dessous ont été vérifiés par lecture du code réel. **Fait fondateur corrigé** : contrairement à l'énoncé initial, **le React Compiler n'est PAS actif** sur ce build. `babel.config.js` ne charge que `babel-preset-expo` + `react-native-worklets/plugin`, et `app.config.js:298` ne contient que `experiments.typedRoutes` (pas de `reactCompiler: true`). **Conséquence directe : il n'y a aucun filet d'auto-mémoïsation.** Tous les findings de mémo cassée (item non `React.memo` + `renderItem` inline, set-state-in-effect, callbacks instables) sont donc **pleinement réels**, sans amortissement compiler. C'est ce qui fait remonter plusieurs P2 « théoriques » au rang de vrais coûts runtime.

---

## 1. Verdict global

**Globalement sain, mais pas « bon à laisser tel quel ».** L'architecture de fond est solide (hooks d'auth scopés, `useShallow` correctement placé, FlashList partout, ~117 `React.memo`, infra de liste partagée propre). Mais il reste **2 défauts structurels P1 de virtualisation cassée** et **un faisceau de re-renders parasites réels** parce que le React Compiler — sur lequel reposait l'hypothèse « le compiler couvre tout » — **est désactivé**.

Décompte des findings confirmés : **0 P0** · **2 P1** réels (LIST-01 virtualisation cassée au profil ; ZUS-1/FX-10 souscription store entière dans le root layout qui re-render tout l'arbre à chaque notification) · le reste en **P2/P3** (mémo de liste à resserrer, cascades d'effets, polish images). Pas une seule boucle de render infinie, pas une seule violation de la règle d'or Zustand. C'est un travail de durcissement ciblé, pas un sauvetage.

> Note de cadrage honnête : plusieurs items étaient libellés P0/P1 dans le scan initial en supposant le compiler actif ou en surestimant l'impact. Après vérif, leur sévérité réelle est P2 (mémo manuelle déjà en place, ScrollView non virtualisé à rails courts, primitives stables). Je les classe à leur sévérité réelle, pas à leur sévérité annoncée.

---

## 2. La migration des hooks d'auth : a-t-elle laissé les re-renders en bon état ?

**Oui, nettement mieux que l'ancien `useAuth()` agrégé. C'est une réussite.** Vérifié dans `hooks/useAuth.ts:25-55` :
- `useUser`, `useIsLoading`, `useIsFirstLaunch`, `useIsGuest`, `useGuestSession` sont des **sélecteurs mono-champ** retournant des primitives/refs stables (Object.is) → zéro re-render parasite.
- `useAuthActions` lit 13 actions via **`useShallow`** (L37-55) → identité d'objet stable, conforme à la règle d'or. Aucun consumer ne reconstruit un objet auth sans `useShallow`. La règle d'or n'est violée **nulle part**.

**Deux scories résiduelles**, pas dans `useAuth.ts` lui-même mais dans `useAuthRequired.ts` et chez quelques consumers :
- `useAuthRequired` (`useAuthRequired.ts:14-15`) s'abonne à `user` **full** ET `isLoading`, même quand le consumer ne destructure que `requireAuth`/`showAuthSheet` (cas de ProductCard, SaveSearchButton, favorites, swap-zone, messages…). Ces composants chauds re-exécutent leur hook sur chaque `refreshUser()` et chaque flip de `isLoading` sans nécessité (**AUTH-RR-02**, P2).
- Des items de liste (`ConversationItem` dans la FlashList messages) rappellent `useUser()` par ligne pour ne lire que `user.id`, donc se ré-abonnent au store et re-render tous ensemble quand l'objet `user` change d'identité (**AUTH-RR-03 / FX-05**, P2).

Verdict net : **la migration a amélioré l'état des re-renders, pas régressé.** Les 2 scories sont des optimisations de finition, pas des dettes introduites par la migration.

---

## 3. P0 / P1 — re-renders parasites à corriger

### Listes / virtualisation
**[LIST-01 — P1] FlashList `scrollEnabled={false}` imbriquée dans un ScrollView au profil vendeur**
`features/user-profile/components/ArticleGrid.tsx:51-59`, rendue dans `app/user/[id].tsx:406-449`.
La grille articles est une FlashList non-scrollable enfant d'un `<ScrollView>` → **virtualisation totalement neutralisée** : pour un vendeur à 50-200 articles, tous les `ArticleGridItem` (chacun avec `useSharedValue` + `useAnimatedStyle` + Image expo-image) montent d'un coup → jank/freeze à l'ouverture de l'onglet + pic mémoire.
**Fix** : supprimer le ScrollView parent ; faire de la FlashList le seul conteneur scrollable, passer ProfileHeader/UserActions/ProfileTabs en `ListHeaderComponent` (sticky via `stickyHeaderIndices` de la FlashList), retirer `scrollEnabled={false}`.

### Souscription Zustand au root layout (le vrai re-render d'arbre)
**[ZUS-1 / FX-10 — P1] Souscription au store notification ENTIER dans `useNotificationSetup`, monté à la racine de la nav**
`hooks/useNotificationSetup.ts:294-299` : `const { setUnreadCount, incrementUnreadCount, setSetupComplete, setPushToken } = useNotificationStore();` — **sans sélecteur**. Le store utilise des `set({...})` plats → chaque mutation (`incrementUnreadCount` à la réception d'une push, L413) change l'identité du snapshot complet. Le hook est monté dans `app/_layout.tsx` au sein de `RootLayoutNav`. Double peine : (1) re-render potentiel à la racine de l'arbre de nav à **chaque notification reçue / refresh de badge** ; (2) les actions capturées dans les deps de l'effet de setup (L471) font **teardown + recreate des 4 listeners** (received/response/token/appState) à chaque notif.
**Fix** : appeler les actions via `useNotificationStore.getState().incrementUnreadCount()` (pattern déjà présent ligne 488 du même fichier) et les sortir des deps de l'effet de setup ; ou à défaut sélecteurs mono-champ. L'effet ne doit se re-exécuter que sur changement de `userId`.

> Les autres items initialement étiquetés P1 (my-orders, my-sales, notifications, DiscoverGrid) sont **réels mais P2** : voir §4. Ils dégradent le scroll d'un écran donné, ils ne re-render pas l'arbre global et bénéficient du filet `React.memo`/comparateur déjà présent au niveau section.

---

## 4. P2 / P3 — améliorations (condensé)

### Mémoïsation de liste à resserrer (item non-`memo` + `renderItem` inline) — P2
Sans compiler, ces écrans re-render toutes les cellules visibles à chaque refetch/refresh :
- **LIST-03 / RC-01** `app/my-orders.tsx:55` (`OrderCard` non-memo) + `renderItem` inline `269-275`.
- **LIST-04** `app/my-sales.tsx:55` (`SaleCard`) + `renderItem` inline `240-246`.
- **LIST-05** `app/notifications.tsx:96` (`NotificationItem`) + `renderItem` inline `308-315` (+ handlers L162/L199 non-`useCallback`).
- **LIST-06** `app/my-swaps.tsx:192-195` (`SwapCard` non-memo + `renderItem`/`keyExtractor` inline).
**Fix commun** : `React.memo` sur l'item, `useCallback` sur `renderItem`, `keyExtractor`/`ItemSeparatorComponent` au scope module, passer l'id au handler (`onPress(item)`) plutôt qu'une closure par ligne.

### Virtualisation borderline — P2
- **LIST-02** `features/home/discover/DiscoverGrid.tsx:120-133` : la grille paginée est rendue en `.map()` dans **une cellule** de la FlashList home → 60-80 ProductCard montées après 3-4 « Charger plus ». Mitigé par `React.memo(DiscoverItem)` + comparateur ProductCard, mais coût mémoire/scroll réel. Fix : virtualiser Discover (FlashList racine + sections en `ListHeaderComponent`) ou plafonner `maxPages` côté RQ.

### Effets / cascades de render — P2
- **FX-03** préfill formulaire par `useEffect+setState` sur `[user]` : `app/settings/profile-details.tsx:42-48` et `app/settings/stripe-onboarding.tsx:143-164` → re-écrasement possible de la saisie quand `refreshUser()` remplace `user`. (`app/checkout/shipping.tsx:138-149` est un **faux positif** : deps `[]` + `getState()`.) Fix : lazy initializer `useState(() => …)` ou flag d'init.
- **FX-08** `app/checkout/shipping.tsx:228-230` : `fetchShippingEstimates` (deps incluant `city/province/fullName`, L226) relance un appel `httpsCallable` à chaque frappe → pas de debounce ni flag `cancelled`. Fix : déclencher sur `postalCode` validé (onBlur/debounce), lire les autres champs via ref/arg.
- **FX-06 / FX-07** `features/search/hooks/useSearchScreen.ts:143-151` et `297-303` : états dérivés (`isSearching`, snap-back du tri) gérés en effet → render + refetch parasites. Fix : dériver au render / déplacer dans le handler de commit.
- **FX-01 / FX-02** `components/EditableField.tsx:42-49` et `51-67` : `setTimeout(focus)` sans cleanup + `editValue` re-synchronisé par effet. Fix : `clearTimeout` au cleanup, supprimer l'effet de sync.
- **FX-09** `app/checkout/shipping.tsx:234-242` : fetch `getServiceFee` hors React Query (pas de cache/annulation, race possible). Fix : `useQuery`.
- **RC-05** `app/saved-searches.tsx:261-264,276-297` : anti-pattern `useState + load-on-mount` (cascade de 3 renders). Fix : migrer en `useQuery` (règle RQ du projet).

### Auth hooks — P2/P3
- **AUTH-RR-02** (P2) `useAuthRequired.ts:14` : sur-abonnement `user` full + `isLoading` pour les consumers action-only. Fix : sélecteur booléen `isLoggedIn` pour la branche action, ou split `useRequireAuth()`.
- **AUTH-RR-03 / FX-05** (P2) `app/(tabs)/messages.tsx:318` : `useUser()` par ligne de FlashList. Fix : passer `currentUserId` (string) en prop depuis le parent.
- **AUTH-RR-04** (P2/P3) `app/(tabs)/messages.tsx:50-51` : double abonnement `user` + `isLoading` non consommé. Hygiène.

### React Compiler / Reanimated — P2 (faux positifs structurels)
- **RC-02** `components/ui/ImmersiveOverlay/index.tsx` (écritures `SharedValue` dans callbacks captés par effet), **RC-03** cartes home (PriceDrop/FeaturedSeller/TrendingBrand), **RC-06** `EditableField` (RN `Animated` legacy), **RC-08** `app/user/[id].tsx:215,289` (cause réelle : `profileUser` objet inline L151-167 non `useMemo`, pas un « bail » compiler). Comme le compiler est inactif, l'enjeu n'est pas la perte d'auto-mémo mais : (a) stabiliser les callbacks via `useCallback`, (b) `useMemo` sur `profileUser`, (c) migrer `EditableField` vers Reanimated.

### Images de liste — P2 (polish)
- **IMG-01** `app/(tabs)/messages.tsx:347-351,361-366`, **IMG-02** `components/PhotoCarousel.tsx:39-48`, **IMG-03** `components/ImageGallery.tsx` (un seul `scale` partagé entre toutes les pages zoom + Image sans `cachePolicy`). Fix : `cachePolicy="memory-disk"` + `recyclingKey` (pattern déjà appliqué dans `PartyItemCard.tsx:59`), et isoler le `scale` par page dans ImageGallery.

### Animations — P3
- **ANIM-01** `FadeInDown.delay(index*50)` sur les rails home : impact minime (Reanimated natif, sections montées au scroll via FlashList). Polish, pas critique.

### Non-action — P3
- **ZUS-2** `components/AuthBottomSheet.tsx:75-78` : 4 sélecteurs mono-champ = **conforme**, ne PAS fusionner sans `useShallow`. Aucune action.

---

## 5. Ce qui est déjà sain (pour calibrer)

- **Hooks d'auth migrés** (`hooks/useAuth.ts:25-55`) : sélecteurs mono-champ + `useShallow` sur les actions. Modèle exemplaire. La règle d'or n'est violée nulle part.
- **`useShallow` bien placé** là où il faut (lectures multi-champs auth/chat). Le faible nombre d'usages (2 fichiers) n'est PAS un problème : la plupart des lectures sont déjà mono-champ.
- **117 `React.memo`** + comparateurs custom (ProductCard, DiscoverItem) : le filet manuel existe et fait son travail là où il est posé — d'où l'impact contenu de plusieurs findings.
- **FlashList partout (23 fichiers), zéro FlatList**. L'infra de liste partagée (ProductGrid, swap-zone, PartyItemCard, chat) est saine.
- **expo-image partout**, pattern `recyclingKey` + `cachePolicy` déjà standardisé (manque seulement sur 3 surfaces secondaires).
- **Zéro boucle de render infinie**, zéro `set({...})` reconstruisant un objet sélecteur sans `useShallow`. Les cascades détectées sont des +1/+2 renders bornés, pas des emballements.

---

## Recommandation : faut-il un chantier ?

**Oui, un chantier ciblé et court (1 sprint léger), pas une refonte.** Priorité stricte :

1. **ZUS-1/FX-10** (root layout → `getState()` dans `useNotificationSetup`) — un fichier, supprime un re-render d'arbre global + le churn des 4 listeners à chaque notif. **ROI maximal, risque minimal.**
2. **LIST-01** (virtualisation cassée au profil vendeur) — vrai défaut structurel, jank visible sur gros vendeurs. Refacto FlashList-as-root.
3. **Lot mémo de liste** (LIST-03/04/05/06) — pattern unique répétable (`React.memo` + `renderItem` `useCallback` + séparateur module-scope), à appliquer en série sur my-orders/my-sales/notifications/my-swaps.
4. **Décision React Compiler** : trancher explicitement. Soit l'activer (`experiments.reactCompiler: true` + `react-compiler-runtime`) — ce qui amortirait à lui seul la moitié des findings RC-* et FX-* — soit assumer son absence et resserrer la mémo manuelle. **À décider avant d'investir dans les fixes RC-*, qui deviennent en partie inutiles si le compiler est activé.**

Le reste (effets, images, auth hooks) est du durcissement opportuniste à faire au fil de l'eau quand on touche les fichiers concernés.