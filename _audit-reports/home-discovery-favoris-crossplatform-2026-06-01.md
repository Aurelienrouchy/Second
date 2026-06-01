# Audit Home, Discovery & Favoris — Cross-platform iOS/Android (2026-06-01)

## Résumé exécutif

Audit cross-plateforme des écrans Home, sections de découverte, feed personnalisé/invité, favoris (articles et vendeurs), proximité géographique et système d'espacement DS. **49 findings confirmés ou nuancés** (1 faux positif écarté), tous vérifiés ligne par ligne dans le code réel. **Aucun P0** (le seul candidat P0 — clés iOS NSLocation absentes — est un faux positif : l'arbre `ios/` committé contient déjà les clés). Trois clusters dominants : (1) **double système de like** où la Cloud Function `toggleProductLike` n'est jamais appelée → compteurs `likes`/`favoritesCount`/`search_index.likes` figés à 0 (P1, casse aussi le ranking recherche) ; (2) **proximité géographique morte de bout en bout** — le flow de vente n'écrit aucune coordonnée, le hook `useUserLocation` est un stub, et 3-4 schémas de `location` incompatibles coexistent (P1) ; (3) **personnalisation "Pour toi" inopérante** — taille cassée (string[] vs `{value,system}`), tracking invité mort, styleProfile IA jamais généré (P1/P2). S'ajoutent des écarts iOS↔Android réels (flow Vendre divergent, espacement bas non systématisé, haptique tab bar iOS-only) et de la dette de discovery (Nouveautés ⊂ Découvrez, DiscoverGrid non virtualisé).

| Sévérité | Nombre |
|----------|--------|
| P0 | 0 |
| P1 | 12 |
| P2 | 21 |
| P3 | 16 |
| **Total** | **49** |

---

## Findings P0

Aucun finding P0. Le seul candidat (clés iOS `NSLocation*` absentes d'`app.config.js`) est un **faux positif** : l'arbre natif `ios/` est committé et `ios/Seconde/Info.plist` contient déjà les trois clés de localisation. Voir l'annexe.

---

## Findings P1 — bugs & écarts iOS ↔ Android

### P1-1 — Personnalisation par taille cassée : `string[]` passé à un filtre qui exige `{value, system}`
- **Sévérité** : P1 · **Plateforme** : both
- **Fichiers** : `hooks/usePersonalizedFeed.ts:46-52,61,109-110` · `services/articlesService.ts:380,757-760,771-776` · `functions/src/callable/onboarding.ts:67,73` · `types/index.ts:1-2,57,177-180` · `functions/src/callable/style.ts:41` · `features/home/pour-toi/PourToiSection.tsx:61`
- **Description** : Les tailles sont stockées en chaînes plates (`onboarding.ts:73` `preferences: { sizes: allSizes }`, `suggestedSizes: {top:'M', bottom:'38'}`). `usePersonalizedFeed.ts:49-52` les pousse dans un `string[]` passé tel quel à `filters.sizes` (:110). Or `matchesClientSideFilters` (`articlesService.ts:758-760`) compare `f.value === articleSize.value && f.system === articleSize.system` ; sur une chaîne, `f.value`/`f.system` valent `undefined` → toujours faux. Pire, `:757` exclut tout article sans objet `size`.
- **Impact** : La personnalisation par taille ne matche JAMAIS. Pour un profil taille-seule (sans marque), le feed renvoie zéro article et `PourToiSection.tsx:61` masque le rail. La personnalisation par marque fonctionne (`brandKey`, :771-776).
- **Recommandation** : Mapper les chaînes vers `ArticleSize {value, system}` avant `searchArticles`, ou relâcher le matcher sur `value` seul (attention aux collisions US/EU prévenues volontairement, cf. commentaire `articlesService.ts:733`). Aligner les types `preferences.sizes` / `suggestedSizes`.

### P1-2 — Tracking comportemental invité entièrement mort : `trackView/trackLike/trackSearch` jamais appelés
- **Sévérité** : P1 · **Plateforme** : both
- **Fichiers** : `services/guestPreferencesService.ts:112,140,167,195,216,294` · `services/authMergeService.ts:10,59,62-67` · `app/article/[id].tsx:125-135` · `hooks/useFavorites.ts:165-172` · `store/authStore.ts:286-308` · `app/search.tsx:123-128`
- **Description** : Les méthodes d'écriture comportementale de `guestPreferencesService` n'ont AUCUN appelant (grep exhaustif = 0). La seule "vue" trackée (`article/[id].tsx:129`) appelle la CF serveur `incrementProductView`, pas `guestPreferencesService.trackView`. Le like invité (`useFavorites.ts:165-172`) écrit un `string[]` plat dans AsyncStorage, jamais `trackLike`. `app/search.tsx` a son propre `RecentSearches`, jamais `trackSearch`.
- **Impact** : La session invité reste vide à vie → `totalInteractions = 0 < STYLE_PROFILE_MIN_INTERACTIONS (5)` → `generateStyleProfile` jamais déclenché. Sous-système de préférences invité entièrement inerte ; promesse de profil IA basé comportement non tenue.
- **Recommandation** : Câbler `trackView` dans `article/[id].tsx`, `trackLike` dans le toggle favoris invité, `trackSearch` dans la recherche ; ou supprimer le code mort.

### P1-3 — Deux systèmes de like parallèles : la CF `toggleProductLike` jamais appelée, `likes`/`favoritesCount` figés à 0
- **Sévérité** : P1 · **Plateforme** : both
- **Fichiers** : `functions/src/callable/products.ts:105,148-156` · `hooks/useFavorites.ts:138,147-173` · `features/article/hooks/useArticleActions.ts:51` · `components/ProductCard.tsx:194` · `features/article/components/ArticleDetails.tsx:74` · `app/my-articles.tsx:229` · `services/userStatsService.ts:48` · `hooks/useArticleSearch.ts:107`
- **Description** : (1) Chemin client : `useFavorites.ts:147-173` écrit DIRECTEMENT `favorites/{userId}.articleIds` via SDK (arrayUnion/arrayRemove) — utilisé par toutes les surfaces UI. (2) Chemin serveur : la callable `toggleProductLike` (`products.ts:105`) maintient atomiquement `likes` + `likedBy` + `favoritesCount` (:148-153), `search_index.likes` (:156) et `favorites/{userId}`. Grep exhaustif : `toggleProductLike` n'est appelée NULLE PART (seul l'export `index.ts:36`).
- **Impact** : Liker incrémente `articleIds` mais jamais `likes/likedBy/favoritesCount/search_index.likes`. Compteurs d'engagement faux (toujours 0) lus partout (`ArticleDetails.tsx:74`, `my-articles.tsx:229`, agrégat `userStatsService.ts:48`) ET ranking recherche faussé (`useArticleSearch.ts:107`).
- **Recommandation** : Router `toggleFavorite` via la callable `toggleProductLike` (maintient compteurs + ranking atomiquement), ou retirer `toggleProductLike` et le champ `likes` de l'UI.

### P1-4 — Compteur de likes affiché sur le détail article toujours à 0 (jamais incrémenté)
- **Sévérité** : P1 · **Plateforme** : both
- **Fichiers** : `features/article/components/ArticleDetails.tsx:71-75` · `functions/src/callable/products.ts:360-363` · `hooks/useFavorites.ts:147-173` · `features/article/hooks/useArticleActions.ts:55-67` · `types/index.ts:205`
- **Description** : `ArticleDetails.tsx:74` affiche `{article.likes}` dans la ligne engagement. `article.likes` est initialisé à 0 (`products.ts:361`) et jamais incrémenté côté client (seule `toggleProductLike` le ferait, jamais appelée — cf. P1-3). Le toggle favori du détail passe par `useFavorites` qui ne touche que `favorites/{userId}.articleIds`.
- **Impact** : "0" perpétuel sur chaque fiche → décrédibilise la fiche ET fausse le signal de popularité (ranking recherche `useArticleSearch.ts:107`, `scheduled/popularity.ts:33`).
- **Recommandation** : Brancher le toggle favori sur `toggleProductLike`, ou masquer `{article.likes}` tant qu'aucun mécanisme ne l'alimente.

### P1-5 — `favoritesCount` dénormalisé jamais maintenu, alors que rules et recherche en dépendent
- **Sévérité** : P1 · **Plateforme** : backend
- **Fichiers** : `functions/src/triggers/favorites.ts:12,25` · `firestore.rules:109,121` · `functions/src/utils/search.ts:78` · `services/favoritesService.ts:9` · `functions/src/callable/products.ts:152,363` · `functions/src/scheduled/popularity.ts:33` · `functions/src/triggers/products.ts:82`
- **Description** : `favoritesCount` est censé être le compteur dénormalisé (`favoritesService.ts:9`), protégé par les rules (`rules:109` création à 0, `:121` immuable client). La trigger `onArticleFavorited` (`favorites.ts:12`) calcule le delta (`:25`) pour la notif mais n'écrit JAMAIS `favoritesCount`. Le seul writer est `toggleProductLike` (`products.ts:152`), jamais appelée. Le ranking pondère `views*0.1 + likes*2` (`search.ts:78`) sur un `likes` figé à 0.
- **Impact** : `favoritesCount` et `search_index.likes` restent à 0 en prod → terme `likes*2` du ranking mort, compteur favoris inexact.
- **Recommandation** : Faire de `onArticleFavorited` le writer canonique : calculer le delta `beforeIds/afterIds` (déjà disponible) et appliquer `FieldValue.increment` sur `articles.favoritesCount` + `search_index.likes`.

### P1-6 — Écran "Vendeurs aimés" orphelin : liste des vendeurs suivis inaccessible dans toute l'app
- **Sévérité** : P1 · **Plateforme** : both
- **Fichiers** : `app/liked-sellers.tsx:157,208` · `app/(tabs)/profile.tsx:101-174` · `app/settings/index.tsx` · `features/user-profile/components/UserActions.tsx:65` · `app/user/[id].tsx:227-240`
- **Description** : `app/liked-sellers.tsx` est complet (FlashList, compteur, toggle, empty state, callable `getLikedSellers`) mais aucun `router.push('/liked-sellers')` ni `<Link>` n'existe dans l'app (la seule autre occurrence est une query-key React Query `query-keys.ts:17`, pas une cible de navigation). Le menu profil (`profile.tsx:101-174`) et settings n'ont aucune entrée.
- **Impact** : La promesse "suivre un vendeur pour le retrouver" (`AUTH_MESSAGES.follow`) est cassée côté consultation. Feature livrée à moitié.
- **Recommandation** : Ajouter une entrée "Vendeurs suivis" au menu profil via `router.push('/liked-sellers')`. **Nuance** : la route est déjà auto-enregistrée par Expo Router (file-based) ; la déclaration explicite dans le Stack racine est facultative, l'écran est atteignable par code dès qu'un point d'entrée existe.

### P1-7 — Aucun garde-fou anti-auto-suivi côté Cloud Function : `sellerLikesCount` manipulable
- **Sévérité** : P1 · **Plateforme** : backend
- **Fichiers** : `functions/src/callable/home.ts:158-159,319-369` · `app/user/[id].tsx:363` · `app/(tabs)/profile.tsx:208` · `hooks/useSellerLikes.ts:74-78`
- **Description** : `getFeaturedSellers` trie sur `sellerLikesCount desc` (`home.ts:158-159`). `toggleSellerLike` (`home.ts:319-369`) ne vérifie jamais `request.auth.uid !== sellerId` : un vendeur peut s'auto-incrémenter en passant son propre uid. Le seul garde-fou est UI (`user/[id].tsx:363` masque le bouton si `isOwnProfile`), contournable via la callable directe (`useSellerLikes.ts:74-78`).
- **Impact** : Intégrité du compteur "Abonnés" (`profile.tsx:208`) et équité du classement "Vendeurs vedettes" compromises. **Nuance** : l'auto-like est idempotent (plafonné à +1 par `home.ts:347`), pas une boucle illimitée, mais un +1 déterministe par utilisateur fausse le classement.
- **Recommandation** : Dans `toggleSellerLike`, rejeter `HttpsError('invalid-argument')` si `sellerId === request.auth.uid` avant la transaction (sur le modèle du contrôle d'ownership de `recordPriceDrop`, `home.ts:466-471`). La callable utilise l'admin SDK → les rules ne couvrent pas ce chemin.

### P1-8 — `useNearbyArticles` inexistant + `useUserLocation` est un stub mort qui retourne toujours null
- **Sévérité** : P1 · **Plateforme** : both
- **Fichiers** : `hooks/useArticleSearch.ts:38-55,57-85,87-112,231-234,350-355` · `features/search/hooks/useSearchScreen.ts:112-117` · `components/ProductCard.tsx:54-55` · `components/ProductGrid.tsx:72-90`
- **Description** : `useNearbyArticles` n'existe nulle part (grep = 0). Le seul point d'entrée localisation, `useUserLocation` (`useArticleSearch.ts:350-355`), est un stub : `useState(null)` sans jamais appeler les setters ni `expo-location`, et sans aucun appelant. Le tri par distance (`sortArticles:93`, Haversine `:38-55`) est conditionné à `center`, jamais passé par le seul consommateur (`useSearchScreen.ts:112-117`).
- **Impact** : Fonctionnalité "articles à proximité / tri par distance" entièrement morte ; code mort trompeur qui piège tout futur dev. La proximité boutiques (geohash, `shopService.ts:211-215`) existe, mais PAS pour les articles.
- **Recommandation** : Soit câbler `useUserLocation` (`expo-location` + `getCurrentPositionAsync` + garde iOS plist) et passer `center` depuis `useSearchScreen`, soit supprimer le code mort (`useUserLocation`, `calculateDistance`, branches `center`, props `distance` de ProductCard/ProductGrid).

### P1-9 — Trois (quatre) schémas incompatibles pour la localisation d'un article
- **Sévérité** : P1 · **Plateforme** : both
- **Fichiers** : `types/index.ts:207,224-231` · `hooks/useArticleSearch.ts:62-79` · `functions/src/triggers/products.ts:45-47,113,115,154` · `services/articlesService.ts:135-177`
- **Description** : (1) `Article.location` typé `string` legacy (`types/index.ts:207`) ; (2) `ArticleWithLocation` redéfinit `{lat, lon, distance?, address?}` (`:224-231`) ; (3) le transform client lit `{lat, lon, address}` via cast `as` (`useArticleSearch.ts:66-67`) ; (4) la CF lit `articleData.location.coordinates.{lat,lon}` + `.city` + écrit `location.geohash` (`products.ts:45-47,113-154`). `createArticle` (`articlesService.ts:135-177`) ne pose AUCUN champ `location`.
- **Impact** : Le geohash d'article n'est jamais calculé (branche morte, échec muet), le tri distance client ne trouve jamais `lat/lon`, le cast `as` masque l'erreur de type. Dette bloquante pour toute reprise de la feature proximité.
- **Recommandation** : Unifier sur une forme unique (ex. `{ city?, coordinates?: {lat,lon}, geohash? }`), aligner type Article + transform client (retirer le cast `as`) + trigger, et faire écrire le champ par `createArticle`.

### P1-10 — Le flow de vente n'écrit jamais de coordonnées → aucun article n'est géolocalisable
- **Sévérité** : P1 · **Plateforme** : both
- **Fichiers** : `app/sell/pricing.tsx:107-114,180-187` · `app/sell/preview.tsx:156-198` · `types/index.ts:659-663` · `services/articlesService.ts:135-177` · `functions/src/callable/products.ts:406-413`
- **Description** : Le flow de vente ne collecte que des quartiers prédéfinis (`MeetupNeighborhood = {id, name, borough}`, `types/index.ts:659-663` — aucune coordonnée). `pricing.tsx`/`preview.tsx:188-196` n'écrivent que `neighborhood`/`neighborhoods`. Aucun champ `location` (string/objet/coordinates) n'est jamais écrit, ni client (`articlesService.ts`) ni CF (`products.ts:406-413`).
- **Impact** : Conséquence systémique : tout article publié n'a ni `location.lat/lon` ni `coordinates`. Même avec `useUserLocation` câblé, il n'y aurait rien à trier — feature proximité structurellement impossible côté données.
- **Recommandation** : Décider la stratégie : soit dériver des coordonnées approximatives depuis le quartier (table `borough→coords`) et les écrire dans `article.location` + geohash à la publication, soit assumer une approche "par quartier" (filtre `borough`) et retirer tout le code distance/lat/lon.

### P1-11 — PourToiSection : carte compact 180px dans wrapper 160px = chevauchement
- **Sévérité** : P1 · **Plateforme** : both
- **Fichiers** : `features/home/pour-toi/PourToiSection.tsx:45-46,99-104` · `components/ProductCard.tsx:230,241` · `components/ProductCard.constants.ts:14`
- **Description** : `PourToiSection.tsx:102-104` fixe `horizontalCardWrapper: { width: 160 }` ; la carte rendue `compact` sans `fillWidth` (:45-46) s'auto-impose `COMPACT_CARD_WIDTH = 180` (`ProductCard.tsx:230,241` ; `ProductCard.constants.ts:14`). Wrapper sans `overflow: hidden`. Les rails frères (NewArrivals `:90-92`, SimilarProducts `:113`) utilisent bien `COMPACT_CARD_WIDTH` ; seul PourToi a 160.
- **Impact** : Vignettes "Pour toi" qui se chevauchent. **Nuance chiffrée** : le débordement carte-vs-wrapper est de 20px (180−160), mais le chevauchement inter-cartes réel est de **12px** (180 − (160 + gap 8px)).
- **Recommandation** : Remplacer `160` par `COMPACT_CARD_WIDTH` (aligner sur NewArrivals/SimilarProducts) ou passer `fillWidth`.

### P1-12 — Flow Vendre divergent iOS (overlay immersif) vs Android (navigation directe) avec reprises de brouillon distinctes
- **Sévérité** : P1 · **Plateforme** : both
- **Fichiers** : `app/(tabs)/_layout.tsx:139-158` · `app/(tabs)/sell.tsx:27-96` · `features/sell/components/capture/SellOverlayCapture.tsx:97-134,195-208` · `app/sell/photos-review.tsx:127-132` · `services/draftService.ts:42-53`
- **Description** : Au tap "Vendre" : iOS = `e.preventDefault()` + overlay `SellOverlayCapture` puis `router.push('/sell/photos-review')` (`_layout.tsx:139-157`). Android = fall-through vers `sell.tsx` qui charge le brouillon et affiche `DraftResumeModal` (Reprendre/Supprimer) ou route selon `draft.currentStep` (`sell.tsx:65-96`).
- **Impact** : **Nuance importante** : contrairement au cadrage initial, l'overlay iOS recharge bien le brouillon (`SellOverlayCapture.tsx:98-117`) — pas de perte. La vraie divergence : (1) Android offre une modal de choix explicite, iOS re-injecte silencieusement les photos ; (2) Android est **step-aware** (reprend à pricing/preview), iOS restaure UNIQUEMENT les photos et renvoie TOUJOURS vers `photos-review` qui **relance l'analyse IA depuis zéro** (`photos-review.tsx:127-132`). Un vendeur arrivé à l'étape pricing perd sa progression sur iOS.
- **Recommandation** : Unifier la résolution `loadDraft`/`currentStep` sur les deux plateformes (l'overlay iOS doit honorer `currentStep` et offrir Reprendre/Supprimer).

---

## Findings P2 / P3

### P2-1 — Nouveautés est un sous-ensemble strict de Découvrez
- **Sévérité** : P2 (needs_nuance) · **Plateforme** : both
- **Fichiers** : `features/home/new-arrivals/useNewArrivals.ts:31,33` · `features/home/discover/useDiscoverArticles.ts:37,50,52,60` · `functions/src/callable/home.ts:184` · `app/(tabs)/index.tsx:50-58`
- **Description** : Les deux sections frappent la même callable `getNewArrivals` (tri unique `createdAt desc`, `home.ts:184`), depuis le même curseur null. Nouveautés demande les 10 premiers, Découvrez page 1 les 20 premiers → Découvrez ⊇ les 10 de Nouveautés, affichés deux fois sur le même scroll.
- **Impact** : Redite visuelle + travail CF redondant (deux query-keys distinctes). **Nuance** : Découvrez n'est PAS prefetché au démarrage (`prefetchHome.ts:43-48` ne warm que newArrivals + trendingBrands), il fire lazily au scroll — donc pas de "double cold-start simultané".
- **Recommandation** : Décaler Découvrez via cursor (démarrer après la fenêtre Nouveautés) ou changer sa source/tri.

### P2-2 — Aucune gestion `isError` dans les sections discovery
- **Sévérité** : P2 · **Plateforme** : both
- **Fichiers** : `features/home/discover/DiscoverGrid.tsx:73-79,94-103` · `features/home/discover/useDiscoverArticles.ts:56-65` · `features/home/SectionErrorBoundary.tsx:39-44`
- **Description** : `DiscoverGrid.tsx:73-79` ne destructure que `data/isLoading/...`, jamais `isError`/`refetch`. Le rendu (:94-103) n'a que deux branches : loading puis `length === 0` → affiche systématiquement "Aucun article trouvé". `useInfiniteQuery` sans `throwOnError` → l'erreur n'atteint pas le boundary (qui renvoie `null` par défaut).
- **Impact** : Faux vide ("Aucun article trouvé") en réseau dégradé, sans bouton Réessayer.
- **Recommandation** : Exposer `isError`/`refetch`, ajouter un "Réessayer", distinguer empty d'erreur.

### P2-3 — "Pour toi" totalement invisible pour les invités malgré l'onboarding invité
- **Sévérité** : P2 · **Plateforme** : both
- **Fichiers** : `features/home/pour-toi/PourToiSection.tsx:56-60` · `hooks/usePersonalizedFeed.ts:40,76` · `functions/src/callable/onboarding.ts:84-90` · `app/onboarding.tsx:152` · `constants/storageKeys.ts:7`
- **Description** : `PourToiSection.tsx:56` lit `useUser()` (null en invité) → `usePersonalizedFeed.ts:40` retourne null → `hasProfile=false` → `:60 return null`. La collection `guest_preferences` (écrite `onboarding.ts:84-90`) n'est jamais relue (seul `retentionPurge.ts:110` la supprime). **Nuance** : un 2e puits en écriture seule existe — `onboarding.tsx:152` écrit aussi `@onboarding_preferences` en AsyncStorage, jamais relu.
- **Impact** : L'invité fournit sexe+tailles → écrit dans 2 sinks jamais relus → "Pour toi" reste invisible. Effort utilisateur gaspillé.
- **Recommandation** : Soit afficher une variante invité alimentée par `guest_preferences`, soit ne pas demander ces préférences aux invités tant qu'elles ne sont pas exploitées.

### P2-4 — Feed personnalisé jamais rafraîchi : useState/useEffect sans React Query ni pull-to-refresh
- **Sévérité** : P2 · **Plateforme** : both
- **Fichiers** : `hooks/usePersonalizedFeed.ts:34-36,127,129-131,139` · `app/(tabs)/index.tsx:122-131` · `features/home/pour-toi/PourToiSection.tsx:57` · `features/home/query-keys.ts:8-18` · `features/home/prefetchHome.ts:32-49`
- **Description** : `usePersonalizedFeed` utilise état local + `useEffect` (dep `fetchPersonalizedFeed` → ne se relance qu'au changement d'objet `user`). Aucune query-key dans `homeKeys` → invisible aux invalidations globales. FlashList Home sans `refreshControl`. La fonction `refresh` exposée (`:139`) n'est consommée par personne.
- **Impact** : Section figée jusqu'à changement d'objet user ou remount. Données potentiellement périmées sans recours.
- **Recommandation** : Porter sur React Query (query-key dédiée intégrée prefetch/invalidation) ou exposer un pull-to-refresh appelant `refresh()`.

### P2-5 — styleProfile IA jamais généré en pratique : opt-in OFF par défaut + tracking invité mort
- **Sévérité** : P2 · **Plateforme** : both
- **Fichiers** : `services/authMergeService.ts:10,52,62-67,69` · `services/userService.ts:152-156` · `functions/src/callable/style.ts:23-29,65-93` · `services/authService.ts:189-203` · `app/settings/privacy.tsx:251-253` · `hooks/usePersonalizedFeed.ts:43`
- **Description** : Double verrou : (1) `authMergeService.ts:52` court-circuite si `aiProfilingConsent !== true` ; le champ est absent à l'inscription (`authService.ts:189-203`) et n'est activé que manuellement (`privacy.tsx:251-253`). (2) Tracking invité mort → `totalInteractions = 0 < 5` (`:62-67`). Preuve serveur supplémentaire : `style.ts:80-93` écrit un `DEFAULT_STYLE_PROFILE` avec `confidence: 0` qui échoue le gate `confidence > 0` de `usePersonalizedFeed.ts:43`.
- **Impact** : Priorité 1 (styleProfile) inatteignable en flux nominal ; seule la priorité 2 (preferences marque) alimente le feed (la taille étant cassée, cf. P1-1).
- **Recommandation** : Déclencher `generateStyleProfile` à l'activation du consentement (avec données user authentifié) ; documenter que le feed nominal repose sur `preferences.favoriteBrands`.

### P2-6 — Articles soft-deleted restent dans les favoris des AUTRES utilisateurs
- **Sévérité** : P2 · **Plateforme** : both
- **Fichiers** : `services/articlesService.ts:826-838` · `services/favoritesService.ts:104,143` · `app/(tabs)/favorites.tsx:228-238` · `app/article/[id].tsx:141` · `firestore.rules:79`
- **Description** : `deleteArticle` fait un soft delete (`isActive:false`, `articlesService.ts:833`), le doc continue d'exister. La pagination favoris (`favoritesService.ts:143`) ne considère orphelin qu'un id dont le doc n'existe pas → un soft-delete est `returned` donc jamais nettoyé. Aucun filtre `isActive`/`isSold`. `firestore.rules:79` `allow read: if true`. Aucune trigger ne purge les favoris des tiers.
- **Impact** : Favori "fantôme" cliquable d'un article supprimé par autrui (et même défaut pour `isSold`).
- **Recommandation** : Filtrer `isActive===true` (et gérer `isSold`) dans `getUserFavoriteArticlesPaginated`, OU ajouter une trigger `onDocumentUpdated(articles)` `isActive:false` → `arrayRemove` des favorites concernés.

### P2-7 — Chemin favoris invité (AsyncStorage) inatteignable : code mort gaté par requireAuth
- **Sévérité** : P2 · **Plateforme** : both
- **Fichiers** : `hooks/useFavorites.ts:85-110,165-172` · `components/ProductCard.tsx:214-222` · `features/home/price-drops/PriceDropsSection.tsx:88` · `features/article/hooks/useArticleActions.ts:63-66` · `app/(tabs)/favorites.tsx:167,196`
- **Description** : `useFavorites` supporte un mode invité complet (loadLocal/saveLocal/migration) mais tous les call sites de `toggleFavorite` sont gatés par `requireAuth` (`useAuthRequired.ts:26-33` : si `!isLoggedIn`, action différée jusqu'au login). La branche guest (`userId===null`) et la migration sont du code mort.
- **Impact** : Dette de maintenance / fausse complexité (3 fonctions + migration jamais exécutées).
- **Recommandation** : Soit autoriser le like invité (retirer `requireAuth` + garder AsyncStorage), soit supprimer la branche guest + migration. À trancher selon la matrice produit "invité = pas de favoris" (apparemment assumée vu `AUTH_MESSAGES.like`).

### P2-8 — Cap de 500 favoris : aucun garde-fou client, échec silencieux au-delà
- **Sévérité** : P2 · **Plateforme** : both
- **Fichiers** : `firestore.rules:236-239` · `hooks/useFavorites.ts:95-106,147-164,201-228,124`
- **Description** : Les rules cappent à 500 (`rules:239`). Au 501e like, l'optimistic update remplit le cœur (`useFavorites.ts:210-216`), l'écriture est rejetée, `onError` rollback SANS toast (`:220-228`). Aucun check de taille avant mutation. La migration au login (`:97-105` `arrayUnion`) peut dépasser 500 et échouer en bloc (catch silencieux `:124`).
- **Impact** : Power users (500+) : perte d'intégrité + échec UX silencieux.
- **Recommandation** : Vérifier `favoriteIds.length` avant toggle, afficher "Limite de 500 favoris atteinte" ; gérer le dépassement à la migration.

### P2-9 — Distance Nearby et likes acceptés mais jamais affichés (ProductCard)
- **Sévérité** : P2 · **Plateforme** : both
- **Fichiers** : `components/ProductCard.tsx:54-56,60,255-328,504-517` · `components/ProductGrid.tsx:71-92`
- **Description** : `ProductCard` déclare `location.distance` (:54-56) et `likes` (:60), `ProductGrid` les passe (:71-92), mais aucun rendu dans le JSX (footer = prix/taille/condition `:313-327`) ni dans le memo comparator (`:504-517`). Chemin de données mort.
- **Impact** : Promesse "près de chez toi" non rendue malgré donnée transmise. **Nuance** : `distance` n'a de valeur que pour un `ArticleWithLocation` (flux Nearby, lui-même mort).
- **Recommandation** : Afficher un badge distance/likes OU retirer ces champs des types/mapper/memo.

### P2-10 — `estimatedItemSize` passé à FlashList v2 via ts-expect-error = prop morte
- **Sévérité** : P2 · **Plateforme** : both
- **Fichiers** : `components/ProductGrid.tsx:190-191` · `app/visual-search-results.tsx:237-238` · `app/my-orders.tsx:240-241` · `app/my-articles.tsx:390-391` · `app/my-sales.tsx:236-237` · `components/MakeOfferModal/LocationStep.tsx:226-227,320-321` · `components/swap/SwapItemSelector.tsx:128-129` · `package.json:44`
- **Description** : flash-list 2.0.2 (v2) a retiré `estimatedItemSize` (absent de `FlashListProps.d.ts`). Elle est passée via `// @ts-expect-error` → ignorée. **Nuance** : le pattern est codebase-wide (7 fichiers, 8 sites), pas seulement les 2 cités.
- **Impact** : Aucun gain de perf, dette latente de refacto.
- **Recommandation** : Supprimer `estimatedItemSize` + les `@ts-expect-error` partout.

### P2-11 — Vocabulaire incohérent pour une seule action : S'ABONNER vs aimer vs coup de cœur vs suivre
- **Sévérité** : P2 · **Plateforme** : both
- **Fichiers** : `features/user-profile/components/UserActions.tsx:65` · `app/liked-sellers.tsx:208` · `constants/authMessages.ts:6,10` · `app/user/[id].tsx:229` · `features/home/featured-sellers/useSellerLike.ts:22` · `hooks/useSellerLikes.ts`
- **Description** : Le champ `users.likedSellers` (callable `toggleSellerLike`) est exposé sous 4-5 libellés : "S'ABONNER/ABONNÉ" + icône add/checkmark (`UserActions.tsx:65`), "Vendeurs aimés" + cœur (`liked-sellers.tsx:208`), "coups de cœur" (`authMessages.ts:6`), "suivre" (hardcodé `user/[id].tsx:229`). Tout converge vers `useSellerLikes`.
- **Impact** : Confusion du modèle mental ; mélange avec les favoris d'articles (même cœur).
- **Recommandation** : Terme canonique unique (recommandé "s'abonner/Abonnés"), uniformiser l'icône, pointer les gates vers `AUTH_MESSAGES.follow`.

### P2-12 — Mauvais message d'auth sur le cœur Vendeurs vedettes (message favoris au lieu de suivi)
- **Sévérité** : P2 (needs_nuance) · **Plateforme** : both
- **Fichiers** : `features/home/featured-sellers/useSellerLike.ts:19-23` · `constants/authMessages.ts:6,10` · `app/user/[id].tsx:229`
- **Description** : `useSellerLike.ts:22` passe `AUTH_MESSAGES.like` ("coups de cœur", wording favoris d'articles) alors que l'action est un suivi de vendeur. **Nuance** : l'evidence affirmait que `user/[id].tsx:229` utilise `AUTH_MESSAGES.follow` — FAUX, c'est une chaîne hardcodée différente ("Connectez-vous pour suivre..."). `AUTH_MESSAGES.follow` n'est référencé nulle part (constante morte).
- **Impact** : Invité induit en erreur ; trois wordings "suivre" coexistent.
- **Recommandation** : `useSellerLike.ts:22` → `AUTH_MESSAGES.follow` ; idéalement `user/[id].tsx:229` aussi.

### P2-13 — Désynchronisation compteur/liste sur "Vendeurs aimés" : badge décrémenté mais carte affichée jusqu'au refetch
- **Sévérité** : P2 · **Plateforme** : both
- **Fichiers** : `app/liked-sellers.tsx:159,185,212,240` · `hooks/useSellerLikes.ts:54-56,80-91,102-110` · `lib/queryKeys.ts:57-58`
- **Description** : Deux query-keys distinctes : `sellers.likedIds` (badge/cœur) et `sellers.liked` (liste). L'optimistic update (`useSellerLikes.ts:80-91`) ne touche que `likedIds` ; la liste détaillée n'est invalidée qu'en `onSettled` (:102-110). Fenêtre : badge N−1 + cœur vide mais carte présente.
- **Impact** : Incohérence visuelle transitoire (durée du round-trip).
- **Recommandation** : Mettre à jour optimistiquement `sellers.liked` dans `onMutate`, ou dériver `sellers.filter(s => likedSellerIds.includes(s.id))`.

### P2-14 — Position géographique collectée et sauvegardée sans finalité (enjeu Loi 25)
- **Sévérité** : P2 (needs_nuance) · **Plateforme** : both
- **Fichiers** : `app/settings/preferences.tsx:96-112,66-72,98,61` · `app/settings/privacy.tsx` · `services/userService.ts:114-123` · `components/legal/PrivacyPolicyContent.tsx:107-109,164`
- **Description** : `preferences.tsx:96-112` capture GPS précis + reverse-geocode + persiste `preferences.location`. Aucun consommateur (`useUserLocation` est un stub, cf. P1-8). Wording trompeur `:98` "nécessaire". **Nuance** : la collecte EST divulguée dans la Politique de confidentialité (`PrivacyPolicyContent.tsx:107-109`), donc pas "sans transparence" au sens strict ; le défaut réel est l'absence de finalité positive + minimisation.
- **Impact** : Collecte sans finalité active (Loi 25 : minimisation) + copy "nécessaire" mensonger.
- **Recommandation** : Soit câbler une vraie finalité proximité (et l'ajouter aux finalités de la politique), soit retirer la collecte ; corriger le wording de `preferences.tsx:98`.

### P2-15 — `getShopsNearLocation` : requête de proximité jamais appelée (code mort)
- **Sévérité** : P2 (needs_nuance) · **Plateforme** : both
- **Fichiers** : `services/shopService.ts:18,205-273,29,293,431-453` · `app/shop/[id].tsx:247-267`
- **Description** : `getShopsNearLocation` (`:205-273`, geohashQueryBounds + Haversine) n'a aucun appelant (grep = 1 hit = la définition). **Nuance** : l'import `geofire-common` n'est PAS uniquement pour ce chemin — `geohashForLocation` est utilisé par `createShop` (:29) et `updateShop` (:293), code vivant. Seul `geohashQueryBounds` (:215) est mort.
- **Impact** : Code mort donnant l'illusion d'une feature "boutiques près de moi".
- **Recommandation** : Exposer la recherche dans l'UI, OU supprimer `getShopsNearLocation` et retirer `geohashQueryBounds` de l'import (garder `geohashForLocation`).

### P2-16 — DiscoverGrid utilise un flexWrap '50%' (non virtualisé) au lieu de FlashList
- **Sévérité** : P2 · **Plateforme** : both
- **Fichiers** : `features/home/discover/DiscoverGrid.tsx:5-9,42-66,81-84,106-119,143-151` · `app/(tabs)/index.tsx:1-13,122-131` · `features/home/discover/useDiscoverArticles.ts:37,56-65`
- **Description** : Le Home (FlashList virtualisé, `index.tsx:1-13`) rend `discover` comme une cellule. À l'intérieur, `DiscoverGrid` rend TOUS les articles via `.map` dans un `View` flexWrap `width:'50%'` (`:106-119,143-151`) — non virtualisé. `useInfiniteQuery` cumule les pages (`:81-84`, PAGE_SIZE=20) → 40/60+ cartes toutes montées dans une cellule non recyclée.
- **Impact** : Perte de perf scroll croissante (mémoire/layout), pire sur Android entrée de gamme. Le bénéfice virtualisation ne couvre pas la section la plus longue.
- **Recommandation** : Basculer le Home entier vers un FlashList masonry à data plate, ou limiter les pages Discover rendues et déléguer à `/search`.

### P2-17 — Tab bar iOS absolute vs Android non-absolute + useBottomTabOverflow jamais consommé
- **Sévérité** : P2 (needs_nuance, P1→P2) · **Plateforme** : ios
- **Fichiers** : `app/(tabs)/_layout.tsx:79-91` · `components/ui/TabBarBackground.ios.tsx:17-19` · `app/(tabs)/messages.tsx:190-196,433-434` · `app/(tabs)/profile.tsx:238,256-258,312-314`
- **Description** : iOS = tab bar `position:'absolute'` (`_layout.tsx:81`), contenu sous la barre ; Android `default` non-absolute. Le helper `useBottomTabOverflow` existe mais n'est consommé NULLE PART (grep = 0 consommateur). **Nuance** : la preuve Profil est FAUSSE — `profile.tsx:238` rend un spacer `bottomPadding: { height: 100 }` (:312-314), dégagement total 132px > ~83px tab bar → Profil OK. Seul Messages présente vraiment le défaut (`conversationsList: paddingVertical spacing.sm` = 8px, `:433-434`).
- **Impact** : Sur iOS, la dernière conversation de Messages passe partiellement sous la tab bar (atteignable par léger scroll). Un seul écran impacté, pas deux.
- **Recommandation** : Faire consommer `useBottomTabBarHeight`/`useBottomTabOverflow` par les écrans scrollables d'onglet et l'ajouter au `paddingBottom`.

### P2-18 — paddingBottom des écrans d'onglet : valeurs magiques incohérentes (144/100/32/8 px)
- **Sévérité** : P2 · **Plateforme** : both
- **Fichiers** : `app/(tabs)/index.tsx:156-158` · `components/ProductGrid.tsx:229-232` · `app/(tabs)/profile.tsx:256-258` · `app/(tabs)/messages.tsx:433-435` · `constants/theme.ts:309` · `components/ui/TabBar.tsx:228`
- **Description** : Home = `spacing['4xl']+spacing['3xl']` (144px) ; ProductGrid/Favoris = `100` en dur ; Profil = `spacing.xl` (32px) ; Messages = `spacing.sm` (8px). Le token `sizing.tabBarHeight=64` (`theme.ts:309`) n'est consommé que par `components/ui/TabBar.tsx:228`, lui-même jamais monté par expo-router. Viole la règle "tokens only, no magic".
- **Impact** : Incohérence visuelle du blanc de fin de liste entre onglets + magic numbers.
- **Recommandation** : Définir un token unique de clearance tab bar (dérivé de `useBottomTabOverflow`) appliqué uniformément ; supprimer le `100` et le `4xl+3xl`.

### P2-19 — Home n'a pas de pull-to-refresh alors que toutes les autres listes en ont un
- **Sévérité** : P2 · **Plateforme** : both
- **Fichiers** : `app/(tabs)/index.tsx:122-131` · `components/ProductGrid.tsx:202-211` · `features/home/trending-brands/useTrendingBrands.ts:23` · `features/home/query-keys.ts:8`
- **Description** : Le FlashList Home (`index.tsx:122-131`) ne passe aucun `refreshControl`/`onRefresh` (grep = 0). Le pattern existe sur 9 fichiers (ProductGrid, my-articles, wallet, etc.). Sections Home avec staleTime longs (TrendingBrands 1h, `useTrendingBrands.ts:23`).
- **Impact** : Geste universellement attendu absent sur l'écran le plus consulté ; données périmées sans recours.
- **Recommandation** : Ajouter un RefreshControl branché sur `queryClient.invalidateQueries(homeKeys.all)`. Attention : prévoir un état de refresh agrégé (7 sections RQ + feed perso), sinon le spinner ne reflète pas l'état réel.

### P2-20 — Padding bas du Home divergent iOS et Android
- **Sévérité** : P2 · **Plateforme** : both
- **Fichiers** : `app/(tabs)/index.tsx:156-158` · `app/(tabs)/_layout.tsx:79-91` · `constants/theme.ts:213-222` · `components/ui/TabBarBackground.ios.tsx:17-19`
- **Description** : `paddingBottom` Home = 144px en dur (`index.tsx:156-158`, `4xl+3xl`). Tab bar absolute iOS vs en-flux Android (`_layout.tsx:79-91`). Aucun `useBottomTabBarHeight`. **Nuance** : iOS n'est pas pixel-perfect non plus (barre ~83px < 144px laisse du slack) ; c'est une différence d'ampleur du vide bas (plus grand sur Android car les 144px s'ajoutent à une barre déjà réservée), pas "iOS parfait / Android cassé".
- **Impact** : Vide en bas du Home plus grand sur Android.
- **Recommandation** : Utiliser `useBottomTabBarHeight` + marge éditoriale, ou conditionner au `Platform.OS`.

### P2-21 — `SortBy` sans option 'proximité' → tri distance inatteignable et écraserait le tri choisi
- **Sévérité** : P2 (needs_nuance, P1→P2) · **Plateforme** : both
- **Fichiers** : `types/index.ts:451` · `hooks/useArticleSearch.ts:92-98,231-234,350-355` · `features/search/constants.ts:9-14` · `features/search/hooks/useSearchScreen.ts:112-117,268-274`
- **Description** : `SortBy` ne propose que `recent|price_asc|price_desc|popular` (`types/index.ts:451`) ; le tri distance est implicitement forcé en tête dès que `center` existe (`useArticleSearch.ts:92-98` court-circuite price/popular). Aucune option UI (`constants.ts:9-14`). **Nuance** : le bloc distance est aujourd'hui CODE MORT (`center` jamais passé) → risque latent, pas un bug live.
- **Impact** : Dette de conception : couplage tri distance ↔ présence de `center` au lieu d'une option explicite.
- **Recommandation** : Ajouter `'nearby'` à `SortBy`, ne trier par distance que si `sortBy === 'nearby'`, exposer l'option dans le sheet.

---

### Findings P3 (synthèse condensée)

- **P3-1 — PourToiSection contourne React Query** (`features/home/pour-toi/PourToiSection.tsx`, `hooks/usePersonalizedFeed.ts:34-36,113,129-131`) : useState/useEffect + appel direct `ArticlesService.searchArticles`, aucun cache/retry, hors de `homeKeys` → migrer vers `useQuery` avec clé `homeKeys.pourToi`. *both.*
- **P3-2 — SwapZone "nouveautés cette semaine" plafonne à 6** (`features/home/swap-zone/useSwapZoneItems.ts:21,29-35,44`, `features/home/swap-zone/SwapZoneSection.tsx:36,56-57`, `services/swapService.ts:181-190`) : `newThisWeek` calculé sur PREVIEW_LIMIT=6 alors que le pill affiche `zone.itemsCount` réel. Calculer côté CF. *both.*
- **P3-3 — Spec d'orchestration Home obsolète : Nearby/useNearbyArticles absent de l'arbre réel** (`app/(tabs)/index.tsx:41-58`, `features/home/index.ts:5-19`, `CODEBASE_INDEX.md:202`) : 7 sections réelles, aucun Nearby ; docs (CODEBASE_INDEX) pointent vers des chemins morts. Aligner la carte de domaine. *na.*
- **P3-4 — Profil de style désynchronisé après changement de tailles/marques** (`hooks/usePersonalizedFeed.ts:43-57,60`, `functions/src/callable/style.ts:191`, `app/settings/preferences.tsx:66-81`, `services/userService.ts:107-123`) : priorité exclusive styleProfile > preferences, jamais régénéré sur édition. Fusionner (union normalisée) ou invalider/régénérer. *both.*
- **P3-5 — `handleRemoveFavorite` code mort + retrait via cœur sans confirmation** (`app/(tabs)/favorites.tsx:164-170,228-238`, `components/ProductGrid.tsx:40-64`, `components/ProductCard.tsx:286`, `hooks/useFavorites.ts:229-233`) : handler jamais branché ; le retrait passe par le cœur de la carte, sans undo. Supprimer le mort + ajouter undo/animation de sortie. *both.*
- **P3-6 — Pas de pull-to-refresh sur l'écran favoris** (`app/(tabs)/favorites.tsx:228-238`, `components/ProductGrid.tsx:202-211`) : `onRefresh` non passé → RefreshControl absent malgré la note projet. Passer un `onRefresh` invalidant `favoritesKeys.list(...)`. *both.*
- **P3-7 — Compteur d'en-tête favoris diverge du contenu (pagination)** (`app/(tabs)/favorites.tsx:147,161`, `services/favoritesService.ts:110,157`, `hooks/useFavorites.ts:73-79`) : `displayCount = favoriteArticles.length` (pages chargées seulement) sous-représente le total. Utiliser `articleIds.length`. *both.*
- **P3-8 — Ordre des vendeurs suivis ignore l'ordre de like** (`functions/src/callable/home.ts:396,400-419`, `app/liked-sellers.tsx:239-240`) : `where __name__ in batch` trie par doc ID (déterministe mais != ordre d'insertion). **Nuance** : pas un saut inter-session, mais un mauvais ordre dès le 1er lot. Réordonner selon `likedSellerIds`. *backend.*
- **P3-9 — Animation du cœur déclenchée avant la vérif d'auth (invité)** (`features/home/featured-sellers/FeaturedSellersSection.tsx:96-99`, `useSellerLike.ts:19-23`, `hooks/useAuthRequired.ts:26-33`) : `heartScale=withSpring(1.3)` joue avant `requireAuth` → cue de succès sur action bloquée (et jamais remis à 1). Gater sur `isLoggedIn`/succès. *both.*
- **P3-10 — `isFollowing` renvoyé par le backend mais ignoré par le client (donnée morte)** (`functions/src/callable/reviews.ts:410-420,433`, `app/user/[id].tsx:69`) : `getUserPublicProfile` fait un getDoc séquentiel pour `isFollowing` que le client n'utilise pas (dérive du cache `useSellerLikes`). Read + latence inutiles. Consommer ou supprimer le calcul backend. *both.*
- **P3-11 — PriceDropCard utilise `withSpring` bouncy, viole la règle no-spring** (`features/home/price-drops/PriceDropsSection.tsx:76,79,86`, `components/ProductCard.tsx:151-152,202,206`) : remplacer par `withTiming + Easing.out`. **Nuance** : le sous-claim "getConditionLabel renvoie null sur tirets" est FAUX (la dash-forme est convertie en espace-forme avant stockage via `CONDITION_DISPLAY`, `app/sell/details.tsx:67`). Le mismatch ratio loading `SimilarProducts.tsx:210` (5/4) vs `ProductCard.tsx:256` (4/3) est confirmé. *both.*
- **P3-12 — CARD_WIDTH figée au chargement, grille faussée en resize** (`components/ProductCard.constants.ts:9-13`, `components/ProductCard.tsx:230,241,256`, `components/ProductGrid.tsx:144-153`, `features/home/discover/DiscoverGrid.tsx:60,150-151`, `app.config.js:7,61,71`) : `Dimensions.get('window')` figé, largeur ET hauteur image gelées. **Nuance (P2→P3, android→both)** : l'app est verrouillée portrait (`app.config.js:7`) → pas de rotation phone ; exposition résiduelle = split-screen/foldable Android + iPad Split View (cross-plateforme). Utiliser `useWindowDimensions` ou `fillWidth`. *both.*
- **P3-13 — SectionHeader `paddingTop: 28` valeur magique hors tokens** (`components/home/SectionHeader.tsx:81-85,105`, `constants/theme.ts:213-222`) : 28 absent de l'échelle (4/8) ; aussi `marginBottom: 2` (:105) et typo hardcodée. Remplacer par `spacing.lg + spacing.xs` (=28). *both.*
- **P3-14 — paddingBottom des rails incohérent : PourToi `spacing.md`, autres `spacing.sm`** (`features/home/pour-toi/PourToiSection.tsx:100`, `new-arrivals:88`, `trending-brands:207`, `price-drops:242`, `featured-sellers:251`) : PourToi (16px) diverge des 4 autres rails (8px). **Nuance** : le commentaire "référence PourToi" porte sur le GAP inter-cartes, pas le paddingBottom ; aligner les 5 sur `spacing.sm` (canonique). *both.*
- **P3-15 — Haptique de tab bar iOS-only** (`components/HapticTab.tsx:9-15`, `components/home/SectionHeader.tsx:43`, `components/ProductCard.tsx:210`) : `Haptics.impactAsync` gardé par `process.env.EXPO_OS === 'ios'` (seule garde plateforme de tout l'arbre), alors que le reste de l'app vibre sur les deux. Retirer la garde ou documenter (template Expo non revu). *android.*
- **P3-16 — SwapZone "nouveautés" 2e plafond subtil** : `getRecentPartyItems` filtre aussi `isSwapped==false` (`services/swapService.ts:181`) — affaiblissement marginal additionnel du signal (regroupé avec P3-2).

---

## Matrice cross-plateforme

| Zone | iOS | Android | Écart |
|------|-----|---------|-------|
| **Tab bar (position)** | `position:'absolute'` (`_layout.tsx:81`), contenu sous la barre | en-flux (`default`), barre réserve sa place | **Oui** — clearance bas à compenser sur iOS uniquement |
| **Padding bas Home** | 144px > barre (~83px), slack | 144px s'ajoute à une barre réservée → vide plus grand | **Oui** (ampleur du vide bas) |
| **Messages (dernière conv.)** | passe sous la tab bar (8px de marge) | OK (barre en-flux) | **Oui** (clipping iOS, atteignable au scroll) |
| **Profil (bouton déconnexion)** | OK (spacer 100px) | OK | Non |
| **Flow Vendre** | overlay immersif → `photos-review`, restaure photos mais perd l'étape + re-analyse IA | navigation directe, modal Reprendre/Supprimer, step-aware | **Oui** (reprise de brouillon divergente) |
| **Haptique tap onglet** | impact léger | aucun retour | **Oui** (`HapticTab.tsx:10`) |
| **Haptique reste app** | vibre | vibre | Non |
| **Localisation (clés natives)** | `Info.plist` committé OK (prompt s'affiche) | permissions Android OK | Non (faux positif écarté) |
| **CARD_WIDTH resize** | iPad Split View affecté | split-screen/foldable affecté | Non (même bug, cross-plateforme) |
| **Likes / favoris / proximité / personnalisation** | logique JS partagée | identique | Non (bugs identiques sur les deux) |

---

## Plan d'action priorisé (P0 → P3)

**P0** — Aucun.

**P1 (12) — à traiter en priorité :**
1. **Cluster like/compteurs** (P1-3, P1-4, P1-5) : décider d'UNE source de vérité. Recommandé : router `toggleFavorite` via `toggleProductLike`, OU faire de la trigger `onArticleFavorited` le writer canonique de `favoritesCount`/`search_index.likes`. → `firebase-backend` + `rn-expo-dev`.
2. **Cluster proximité** (P1-8, P1-9, P1-10) : trancher la stratégie (coordonnées approximatives par quartier vs filtre par borough), unifier le schéma `location`, faire écrire le champ par `createArticle`, OU supprimer tout le code mort. → `firebase-backend` + `rn-expo-dev`.
3. **Cluster personnalisation** (P1-1) : mapper les tailles en `{value,system}` (correction la plus impactante, débloque le matching taille). → `rn-expo-dev`.
4. **Tracking invité mort** (P1-2) : câbler `trackView/trackLike/trackSearch` ou supprimer. → `rn-expo-dev`.
5. **Sécurité auto-suivi** (P1-7) : ajouter le garde `sellerId !== uid` dans `toggleSellerLike`. → `firebase-backend`.
6. **Layout PourToi** (P1-11) : remplacer `160` par `COMPACT_CARD_WIDTH`. → `rn-expo-dev` (fix rapide).
7. **Écran liked-sellers orphelin** (P1-6) : ajouter l'entrée menu profil. → `rn-expo-dev` (fix rapide).
8. **Flow Vendre divergent** (P1-12) : unifier la reprise de brouillon step-aware iOS/Android. → `rn-expo-dev`.

**P2 (21) :** corriger le cluster favoris (soft-delete fantôme P2-6, cap 500 P2-8, code mort guest P2-7) ; gestion d'erreur discovery (P2-2) ; pull-to-refresh Home + Favoris (P2-19, P3-6) ; espacement bas tokenisé (P2-17, P2-18, P2-20) ; vocabulaire vendeur unifié (P2-11, P2-12) ; "Pour toi" invité (P2-3) ; styleProfile IA (P2-5) ; conformité Loi 25 localisation (P2-14) ; nettoyer code mort (P2-15, P2-10) ; DiscoverGrid virtualisation (P2-16) ; redite Nouveautés/Découvrez (P2-1) ; feed perso → React Query (P2-4) ; SortBy proximité (P2-21) ; ProductCard distance/likes (P2-9).

**P3 (16) :** polish DS (P3-13, P3-14), haptique tab bar (P3-15), animations no-spring (P3-11), code mort divers (P3-5, P3-10, P3-1), cosmétiques compteurs/ordre (P3-2, P3-7, P3-8, P3-9), désync profil (P3-4, P3-12), spec obsolète CODEBASE_INDEX (P3-3, P3-16).

---

## Annexe — faux positifs écartés

### FP-1 — iOS : `NSLocationWhenInUseUsageDescription` absent → crash/refus runtime iOS (rejeté, candidat P0)
- **Verdict** : FAUX POSITIF sur la sévérité/l'impact.
- **Sous-faits vrais** : `app.config.js` ne contient ni `expo-location`, ni `NSLocation*`, ni `WhenInUse` ; le plugin `expo-location` est absent de `plugins` ; `preferences.tsx:96-102` appelle `requestForegroundPermissionsAsync`/`getCurrentPositionAsync` sans garde `Platform.OS`.
- **Preuve décisive du faux positif** : le projet n'utilise PAS la CNG managée — le dossier `ios/` est COMMITTÉ (`git ls-files ios/Seconde/` → `Info.plist`, `AppDelegate.swift`, `.entitlements`, `project.pbxproj` ; non gitignore). `ios/Seconde/Info.plist` contient DÉJÀ les 3 clés : `NSLocationAlwaysAndWhenInUseUsageDescription`, `NSLocationAlwaysUsageDescription`, `NSLocationWhenInUseUsageDescription`. Le pod `ExpoLocation` est intégré. En workflow natif committé, le build iOS lit l'`Info.plist` sur disque, PAS le bloc `infoPlist` d'`app.config.js`. → le prompt s'affiche, pas de crash, pas de rejet App Store, aucune divergence iOS/Android.
- **Nuance légitime (P3 hygiène, pas P0)** : `app.config.js` et l'`Info.plist` committé ont divergé. Un futur `npx expo prebuild --clean` régénérerait l'`Info.plist` sans les clés NSLocation* → risque latent de maintenabilité. Les usage strings actuels sont les valeurs Expo par défaut en anglais. Recommandation préventive : déclarer `expo-location` dans `plugins` avec `locationWhenInUsePermission` en FR pour resynchroniser config et natif.
