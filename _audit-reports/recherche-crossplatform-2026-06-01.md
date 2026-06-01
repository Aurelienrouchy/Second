# Audit Recherche — Cross-platform iOS/Android (2026-06-01)

## Résumé exécutif

Audit ciblé du domaine **Recherche** (textuelle, filtres, catégories/marques/discovery, recherche visuelle, recherches sauvegardées, historique, préparation déploiement) sur la cohérence iOS ↔ Android et l'intégrité données/backend. Chaque finding ci-dessous a été **revérifié dans le code réel** (file:line), pas supposé. Le constat dominant : la nouvelle recherche maison Firestore (`search_index`) n'est **pas prête à passer en prod** sans une séquence stricte de migration/index, et plusieurs promesses de la feature « recherches sauvegardées » sont **silencieusement cassées** (notif marque, tap notification, dédup historique). Côté UX cross-plateforme, les écarts réels sont concentrés sur la cartographie (Google Maps sans clé), les permissions caméra Android (régénération native) et des timings de focus/transition. Plusieurs findings « code mort » (BrandGrid, CategoryTree, NotificationContext) constituent de la dette à purger.

Trois P0 bloquent une mise en prod : **(1)** tap sur notification de recherche sauvegardée ne navigue jamais (mismatch de clé `searchId` vs `savedSearchId`) ; **(2)** absence de backfill `search_index` → catalogue préexistant invisible en recherche texte et tri Populaire ; **(3)** `moderationStatus` absent sur les articles legacy → toute réindexation naïve **supprime** leur entrée `search_index`.

| Sévérité | Nombre |
|----------|--------|
| P0 | 3 |
| P1 | 12 |
| P2 | 13 |
| P3 | 18 |
| **Total confirmés** | **46** |

> Note : 3 findings ont été rétrogradés à l'issue de la revérification (channel Android `saved_searches` P1→P2, `pattern` mort P2→P3, NotificationContext mort P2→P3, resultCount P2→P3) et 1 P0 nuancé en P1 (permission caméra : iOS faux positif, Android réel). Les sévérités du tableau reflètent les sévérités **révisées**.

---

## Findings P0 — bloquants / failles

### P0-1 — Le tap sur une notification de recherche sauvegardée ne navigue jamais (clé payload `searchId` vs `savedSearchId`)
- **Sévérité** : P0
- **Plateforme** : both
- **Fichiers** : `functions/src/scheduled/savedSearches.ts:226-233`, `functions/src/scheduled/savedSearches.ts:98`, `hooks/useNotificationSetup.ts:97-119`, `store/notificationStore.ts:23-46`, `app/_layout.tsx:132`, `contexts/NotificationContext.tsx:137-162`
- **Description** : Le job planifié émet le payload FCM avec la clé `searchId` (`savedSearches.ts:228`, où `searchId = searchDoc.id` ligne 98). Le handler de tap réellement monté (`useNotificationSetup`, branché `app/_layout.tsx:132`) lit `data.savedSearchId` et conditionne TOUTE la navigation, le fetch ET le reset du compteur dessus : `case 'saved_search': if (data.savedSearchId && userId) { ... }`. Le contrat de type `PushNotificationData` (`notificationStore.ts:29`) déclare `savedSearchId` — c'est le producteur qui diverge. Le handler dupliqué `contexts/NotificationContext.tsx:138` porte le même bug mais est du code mort (Provider jamais monté).
- **Impact** : L'utilisateur active « Alertes nouveautés », reçoit une push « X nouveaux articles », tape dessus → l'app s'ouvre sans rien faire (le `return` du case saute le fallback), et `newItemsCount` n'est jamais remis à zéro. La promesse cœur (ramener vers les résultats) est totalement cassée, iOS comme Android, sur le tap foreground ET le cold-start (`handleInitialNotification`).
- **Recommandation** : Aligner les clés — renommer `searchId`→`savedSearchId` (et `searchName`→`savedSearchName`) dans `savedSearches.ts:228-229` (respecte le type existant), OU lire `data.searchId` dans `useNotificationSetup.ts:98`. Ajouter un test croisant la clé producteur/consommateur.

### P0-2 — Aucun backfill de `search_index` : les articles existants/seed sont invisibles en recherche texte et tri populaire
- **Sévérité** : P0
- **Plateforme** : backend
- **Fichiers** : `functions/src/triggers/products.ts:21`, `functions/src/triggers/products.ts:141`, `functions/src/index.ts:148,176,179`, `services/articlesService.ts:405`, `services/articlesService.ts:434`, `scripts/seed-articles.js:935`
- **Description** : `search_index` n'est alimenté QUE par le trigger `updateSearchIndex` (onDocumentWritten d'un article) via `set(..., { merge: true })` (`products.ts:141`). Aucun script ni callable de backfill/reindex n'existe (`grep reindex|backfill search_index scripts/` = 0 ; `index.ts` n'exporte qu'`updateSearchIndex`, `cleanupSearchIndex` (delete only), `updatePopularityScores` (update only) ; `backfillEmbeddings` concerne les embeddings Vertex, pas `search_index`). Or le client route TOUTE recherche texte ET tout tri `popular` vers `search_index` (`articlesService.ts:405` : `useSearchIndex = trimmedSearch.length > 0 || sortBy === 'popular'`). Les articles seed (`seed-articles.js:935`, `batch.set` sur `articles`) et tout article antérieur au déploiement du trigger n'ont pas d'entrée `search_index`.
- **Impact** : Si la recherche part en prod avant migration, un mot-clé tapé (ou tri « Populaire ») renvoie ZÉRO résultat pour tout le catalogue préexistant. La recherche paraît cassée. Le browse récent/prix (route `articles`) n'est pas affecté. Comportement serveur identique iOS/Android.
- **Recommandation** : Avant toute mise en prod recherche, exécuter un backfill admin (script Node admin SDK ou callable) qui écrit/ré-écrit chaque article actif pour produire son doc `search_index`. **Attention** : un re-write naïf est dangereux (cf. P0-3). Vérifier 100 % de couverture `search_index` des articles actifs avant de router le client.

### P0-3 — `moderationStatus` absent sur les articles legacy : leur entrée `search_index` est SUPPRIMÉE au prochain write
- **Sévérité** : P0
- **Plateforme** : backend
- **Fichiers** : `functions/src/triggers/products.ts:38`, `functions/src/callable/products.ts:364`, `functions/src/callable/products.ts:84,149,789`, `scripts/seed-articles.js:935`, `firestore.rules:104`, `firestore.rules:122`
- **Description** : Le trigger supprime l'entrée si `!isActive || moderationStatus !== 'approved'` (`products.ts:38-39`, sur le doc complet after-image). `moderationStatus: 'approved'` n'est posé QUE par la callable `createArticle` récente (`products.ts:364` ; seule autre occurrence du champ = la lecture ligne 38). Le seed (`seed-articles.js:935`) et tout article pré-refonte n'ont pas le champ. Dès qu'un tel article est ré-écrit — `incrementArticleView` (`products.ts:84`), `toggleProductLike` (`products.ts:149`), `updateArticle` (`products.ts:789`), un update `isSold`, ou un backfill naïf — le trigger considère `moderationStatus !== 'approved'` et **supprime** l'entrée `search_index`. À noter : `incrementArticleView`/`toggleProductLike` écrivent aussi `search_index` dans leur transaction, mais le trigger async s'exécute après et désindexe quand même.
- **Impact** : Un backfill qui se contente de re-toucher les articles legacy les DÉSINDEXE au lieu de les indexer. Les articles seed sont 0 % indexables. L'ordre de migration est impératif.
- **Recommandation** : **Étape 1** : setter `moderationStatus: 'approved'` sur tous les articles actifs legacy/seed (côté serveur — `firestore.rules:122` interdit au client de modifier ce champ). **Étape 2 seulement ensuite** : déclencher le backfill `search_index` (P0-2). Ne viser que `isActive == true` (sinon le trigger supprime de toute façon).

---

## Findings P1 — bugs & écarts iOS ↔ Android

### P1-1 — Notifications de recherche sauvegardée par marque : ne se déclenchent jamais (champ `brands` inexistant sur les articles)
- **Sévérité** : P1 — **Plateforme** : backend
- **Fichiers** : `functions/src/scheduled/savedSearches.ts:104-125`, `functions/src/callable/products.ts:379-381,425`, `functions/src/triggers/products.ts:100`, `services/articlesService.ts:771-777`, `types/index.ts:192`, `services/savedSearchService.ts:269-271`
- **Description** : Si une recherche sauvegardée a des marques mais pas de catégorie, le job interroge `articles.where('brands','array-contains-any', filters.brands.slice(0,10))` (`savedSearches.ts:119-124`). Or les documents `articles` n'ont QUE `brand` (string) : la callable écrit `article.brand = await resolveBrand(...)` (`products.ts:379-381`), `types/index.ts:192` expose `brand?: string`. Le champ array `brands` n'existe QUE sur `search_index` (`products.ts:100`), jamais requêté par le job. Le fallback in-memory (`savedSearches.ts:148`) ne tourne que si `searchQuery` est présent → non rattrapé pour une recherche marque-seule.
- **Impact** : Toute recherche sauvegardée filtrée uniquement par marque ne déclenche jamais d'alerte. Feature « suivre une marque » silencieusement morte.
- **Recommandation** : Remplacer la branche par `where('brand','==',...)` mono-marque (préfiltre) OU retirer le préfiltre Firestore marque et filtrer en mémoire via `brandKey()`, pour parité notif ↔ recherche.

### P1-2 — Matching marque divergent entre notif (texte brut `includes`) et recherche réelle (`brandKey` exact)
- **Sévérité** : P1 — **Plateforme** : backend
- **Fichiers** : `functions/src/scheduled/savedSearches.ts:119-153`, `services/articlesService.ts:771-777`, `utils/normalizeBrand.ts:24-27`
- **Description** : La recherche cliente compare des clés canoniques exactes : `brandKey(data.brand) === brandKey(brand)` (`articlesService.ts:773-775`, `brandKey` = trim+lowercase). Le job, lui : (a) préfiltre `array-contains-any` sur le champ `brands` inexistant et ignoré si `categoryIds` présent (`else if` ligne 119) ; (b) ne réévalue JAMAIS `filters.brands` en mémoire ; (c) son seul rapprochement marque est un substring `b.toLowerCase().includes(queryLower)` (`savedSearches.ts:148-151`), et seulement si `searchQuery` existe. Sémantique opposée (`includes` vs égalité exacte).
- **Impact** : Désynchronisation notif/résultats : un article notifié peut ne pas réapparaître à l'écran et inversement (ex. « Gap » vs « Gap Kids »). Une recherche `brands + categoryIds` sans query n'applique aucun filtre marque côté job.
- **Recommandation** : Réévaluer `filters.brands` dans le job en mémoire avec `brandKey()` + égalité exacte, comme `matchesClientSideFilters`.

### P1-3 — Requête notif `savedSearches` par marque sans index composite : missing-index à l'exécution (avorte tout le batch)
- **Sévérité** : P1 — **Plateforme** : backend
- **Fichiers** : `functions/src/scheduled/savedSearches.ts:104-125`, `functions/src/scheduled/savedSearches.ts:310-312`, `firestore.indexes.json:181-202`, `functions/src/index.ts:189`, `services/savedSearchService.ts:269-271`
- **Description** : `articlesQuery` = `isActive==true` + `isSold==false` + `createdAt > lastNotifiedAt`, puis (branche marque-seule) `+ array-contains-any('brands')`. Cette combinaison (2 égalités + inégalité + array-contains-any) exige un index composite `articles { isActive, isSold, brands CONTAINS, createdAt }` — `grep brands firestore.indexes.json` = 0 résultat. La branche `categoryIds` est, elle, couverte (`firestore.indexes.json:181-202`). L'erreur FAILED_PRECONDITION sur `.get()` (ligne 130) n'est PAS attrapée par le try/catch interne (qui n'entoure que `sendEach`) ; elle remonte au try/catch de boucle (`savedSearches.ts:310-312`) → **tout le run avorte** pour tous les utilisateurs, persistant à chaque run (15 min) tant que l'index manque.
- **Impact** : Une seule recherche marque-seule tue les alertes de tout le batch.
- **Recommandation** : Ajouter l'index `articles { isActive ASC, isSold ASC, brands CONTAINS, createdAt DESC }` AVANT activation, OU rabattre la branche marque en mémoire. Isoler aussi le `.get()` dans un try/catch par recherche pour éviter l'avortement global.

### P1-4 — Recherche scoping vendeur + filtre catégorie/prix/condition sans index : profil boutique filtré casse
- **Sévérité** : P1 — **Plateforme** : backend
- **Fichiers** : `services/articlesService.ts:619,623,630,634`, `features/search/hooks/useSearchScreen.ts:116`, `hooks/useArticleSearch.ts:158`, `app/shop/[id].tsx:313`, `app/search.tsx:142`, `firestore.indexes.json:32`
- **Description** : `searchViaArticles` (sans terme, tri ≠ popular) ajoute `where('sellerId','==',...)` (`:619`) puis selon le cas `categoryIds array-contains` (`:623`), `condition ==` (`:630`), `price >=/<=` (`:634`) + orderBy. `useSearchScreen.ts:116` passe `sellerId: params.shopId` avec `initialFilters` ; depuis `app/shop/[id].tsx:313` (`/search?shopId=...`) le combo vendeur+filtre est atteignable. Les seuls index `sellerId` (`firestore.indexes.json:32-88`) sont `sellerId+isActive+createdAt`, `sellerId+isActive+isSold+createdAt`, `sellerId+isSold+createdAt` — aucun n'inclut categoryIds/price/condition.
- **Impact** : Sur l'écran boutique, dès qu'on applique un filtre catégorie/prix/condition, la requête lève FAILED_PRECONDITION → `isError` → carte « Une erreur est survenue » (`app/search.tsx:142-152`). Identique iOS/Android.
- **Recommandation** : Ajouter les composites `sellerId + isActive + isSold + (categoryIds CONTAINS | condition | price) + createdAt`, OU déplacer ces filtres en client-side quand `sellerId` est présent (comme colors/sizes/materials/brands le sont déjà).

### P1-5 — `size` stocké en string sur les données legacy/seed : exclu de tous les filtres de taille (front + notifications)
- **Sévérité** : P1 — **Plateforme** : backend
- **Fichiers** : `scripts/seed-articles.js:187,928,942,975`, `services/articlesService.ts:757`, `services/articlesService.ts:357`, `functions/src/scheduled/savedSearches.ts:173`, `types/index.ts:177`, `functions/src/shared/article.ts:40`
- **Description** : Le contrat est `size: ArticleSize { value, system }` (`types/index.ts:177`). Le filtre taille exclut explicitement toute size non-objet : `if (!articleSize || typeof articleSize !== 'object') return false` (`articlesService.ts:757`, appliqué aux DEUX chemins articles + search_index ; idem notif `savedSearches.ts:173`). Le mapping search_index (`:357`) fait `size: data.size ?? null` sans normaliser. Le seed écrit `size` en string brute (`seed-articles.js:928,942`, `batch.set` ligne 975) sans passer par `sanitizeArticleSize`. Aucun script de migration string→objet n'existe.
- **Impact** : Tout article seed/legacy à size string est silencieusement exclu de TOUT filtre de taille (recherche + notifications). Perçu comme « le filtre taille ne marche pas ».
- **Recommandation** : Inclure dans la migration la conversion `'M'` → `{ value:'M', system:'EU' }` (cohérent avec le back-compat de `sanitizeArticleSize`, `article.ts:55-60`), sur `articles` ET `search_index` lors du backfill.

### P1-6 — Les articles VENDUS remontent dans la recherche visuelle (embeddings ne tracent jamais `isSold`)
- **Sévérité** : P1 — **Plateforme** : backend
- **Fichiers** : `functions/src/callable/search.ts:120-121,266-267,187-217`, `functions/src/triggers/embeddings.ts:203-213,237-243,282-303`, `functions/src/http/webhooks.ts:370-377`, `functions/src/callable/payments.ts:710-711`, `services/articlesService.ts:268-270`
- **Description** : `visualSearch` filtre seulement `where('isActive','==',true)` (`search.ts:120-121`), jamais `isSold`. La collection `embeddings` ne stocke pas `isSold` (`embeddings.ts:203-213`). Le trigger ne réagit qu'à `isActive true→false` (`embeddings.ts:282`), jamais à `isSold`. Or la vente n'écrit que `isSold: true` sans toucher `isActive` — via le webhook (`webhooks.ts:373-376`) ET surtout via le chemin dominant `createTransaction` (`payments.ts:710-711`). La recherche texte/listes, elle, exclut strictement les vendus (`articlesService.ts:268-270`).
- **Impact** : « Produits similaires » par photo retourne des articles déjà vendus → fiche article en état vendu (CTA désactivée). Écart visible avec la recherche texte.
- **Recommandation** : Filtrer côté `search.ts` via `articlesMap` (exclure `article.isSold === true`) ET/OU stocker+maintenir `isSold` dans `embeddings` avec un trigger sur la transition `isSold`.

### P1-7 — Tri seul (sans texte/filtre) → requête désactivée mais UI affiche un état de résultats incohérent
- **Sévérité** : P1 — **Plateforme** : both
- **Fichiers** : `hooks/useArticleSearch.ts:175-185,217-222,243-255`, `features/search/hooks/useSearchScreen.ts:138-146,254-261,453-457`, `app/search.tsx:104-134`, `features/search/constants.ts:9-14`
- **Description** : Le gate `enabled` de l'infinite query (`useArticleSearch.ts:217`) repose sur `debouncedSearchQuery || selectedCategoryPath.length>0 || hasNonDefaultFilters || sellerId` ; or `hasNonDefaultFilters` (`:175-185`) N'INCLUT PAS `sortBy`. En parallèle, `handleSortSelect` (`useSearchScreen.ts:254`) ne fait jamais `setIsSearching(true)`. Asymétrie aggravante : un SECOND memo `hasActiveFilters` (`useArticleSearch.ts:243-255`) inclut bien le tri (ligne 252) et empêche l'auto-hide de remettre `isSearching=false`, mais ne le passe jamais à true → `isSearching` reste figé à `hasInitialContext` (false sur recherche vierge).
- **Impact** : Sélectionner uniquement « Populaires » sur une recherche vierge affiche la barre « Effacer tout » parasite (`search.tsx:113`) + la liste des tendances (`!isSearching` ligne 122), mais la query est désactivée et le `ProductGrid` (gaté sur `isSearching` ligne 134) ne s'affiche jamais. État mort silencieux. Identique iOS/Android.
- **Recommandation** : Appeler `setIsSearching(true)` dans `handleSortSelect` (fix portant, car le grid est gaté sur `isSearching`) ET inclure `(filters.sortBy && filters.sortBy !== 'recent')` dans `hasNonDefaultFilters` (pour que la query tourne).

### P1-8 — Édition du filtre taille perd silencieusement les tailles de l'autre système (US/EU)
- **Sévérité** : P1 — **Plateforme** : both
- **Fichiers** : `components/SizeSelectionSheet.tsx:65-67,77-84,99-105,115-118`, `features/search/hooks/useSearchScreen.ts:314-320`, `app/search.tsx:205-210`, `app/swap-zone.tsx:627`, `types/index.ts:174-180`
- **Description** : La sheet ne manipule qu'UN système. État interne `localSelectedSizes: string[]` (value-only, `:65-67`), donc l'info `system` des autres systèmes n'existe nulle part dans la sheet. `show()` filtre sur `selectedSizes[0]?.system` et jette le reste (`:77-84`). `handleConfirm()` ré-emballe tout dans le système actif (`:115-118`). `handleSystemChange` vide la sélection (`:99-105`). `handleSizesConfirm` remplace tout le tableau sans merge (`useSearchScreen.ts:314-320`). `types/index.ts:174-180` documente pourtant que `system` existe « so US/EU values never collide » → l'état multi-système est voulu.
- **Impact** : Perte silencieuse des tailles d'un système ; en pratique impossible de construire un filtre EU + US via cette sheet (toute validation collapse vers un seul système).
- **Recommandation** : Conserver les sélections de tous les systèmes (état par système) et, au confirm, fusionner `localSelectedSizes` du système actif avec les `ArticleSize` des autres systèmes au lieu d'écraser.

### P1-9 — Déduplication de l'historique cassée : `updateDoc` refusé par les règles (`searchHistory` sans `allow update`)
- **Sévérité** : P1 — **Plateforme** : both
- **Fichiers** : `services/searchHistoryService.ts:67-76`, `firestore.rules:193-202`, `firestore.rules:186`, `features/search/hooks/useSearchScreen.ts:179-181`
- **Description** : `addSearchToHistory` déduplique (M8) : si une entrée existe (`findDuplicate` lit les 20 dernières — `read` autorisé donc le doublon EST trouvé), il rafraîchit le timestamp via `updateDoc` (`searchHistoryService.ts:67-76`). Or le bloc `match /searchHistory/{historyId}` (`firestore.rules:193-202`) ne déclare que `read`/`create`/`delete` — AUCUN `allow update`, contrairement à `savedSearches` (`:186`). Le parent `match /users/{userId}` n'utilise pas `{document=**}`, donc ses règles ne cascadent pas. L'`updateDoc` est rejeté `permission-denied`, avalé par le `.catch(console.error)` du call site (`useSearchScreen.ts:181`).
- **Impact** : La dédup ne fonctionne jamais en prod : relancer la même recherche n'actualise pas son timestamp (elle ne remonte pas en tête). M8 silencieusement morte. Identique iOS/Android.
- **Recommandation** : Ajouter `allow update: if isOwner(userId);` au bloc `searchHistory` (aligné sur `savedSearches`), puis redéployer les rules.

### P1-10 — Deux libs de cartes installées, plugin et code désynchronisés (`expo-maps` déclaré, `react-native-maps` utilisé)
- **Sévérité** : P1 — **Plateforme** : both
- **Fichiers** : `app.config.js:51`, `components/search/ShopMap.tsx:5`, `app/shop/[id].tsx:24`, `app/admin/shop-detail/[id].tsx:24`, `package.json:67,82`
- **Description** : Le seul plugin maps déclaré est `expo-maps` (`app.config.js:51`), mais tout le code carto importe `react-native-maps` (jamais `expo-maps` : `grep from 'expo-maps'` app/components = 0). `package.json` contient les DEUX deps (`:67` expo-maps, `:82` react-native-maps). Précision : `react-native-maps` FOURNIT bien un config plugin (`node_modules/react-native-maps/app.plugin.js`) capable d'injecter la clé Google (ios `GMSApiKey`/`GMSServices.provideAPIKey`, android `geo.API_KEY`) — mais ce plugin n'est PAS référencé dans `app.config.js` (seul `expo-maps` l'est), donc aucune clé n'est injectée.
- **Impact** : Stack incohérente : le build configure `expo-maps`, l'app rend du `react-native-maps` non provisionné. Cause racine de la carte non provisionnée (cf. P2-1).
- **Recommandation** : Choisir UNE lib — soit migrer le code vers `expo-maps`, soit remplacer le plugin par `["react-native-maps", { androidGoogleMapsApiKey, iosGoogleMapsApiKey }]` et retirer `expo-maps` de `package.json`.

### P1-11 — Permission caméra Android absente de `app.config.js` — casse au prochain `prebuild --clean`
- **Sévérité** : P1 (rétrogradé depuis P0 : volet iOS = faux positif) — **Plateforme** : android
- **Fichiers** : `app.config.js:40-45` (expo-image-picker, `photosPermission` seul), `app.config.js:101-107` (android.permissions, CAMERA absent), `components/VisualSearchCamera.tsx:22,47`, `app/search.tsx:180`, `app/(tabs)/index.tsx:139`, `android/app/src/main/AndroidManifest.xml:4`, `node_modules/expo-camera/plugin/build/withCamera.js:29-30`
- **Description** : `expo-camera` n'est pas dans `plugins[]` (`grep expo-camera app.config.js` = exit 1) et `android.permission.CAMERA` n'est pas dans `android.permissions`. Le seul plugin caméra présent, `expo-image-picker`, n'AJOUTE jamais `CAMERA` sur Android (`withImagePicker.js` ajoute seulement `RECORD_AUDIO`). Un config plugin ne s'exécute que s'il est listé — `withCamera.js:29-30` ajouterait `CAMERA` mais n'est pas référencé. La caméra est utilisée par `VisualSearchCamera` (`:22,47`) et les flux de vente.
  - **Volet iOS = faux positif** : `expo-image-picker` (présent dans plugins) fournit `NSCameraUsageDescription` par défaut via `createPermissionsPlugin` ; `Info.plist:57-58` contient exactement le littéral `CAMERA_USAGE` de `withImagePicker.js`. La clé SURVIT à `prebuild --clean`.
- **Impact** : Au prochain `expo prebuild --clean` / rebuild EAS qui régénère les natifs, `CAMERA` disparaît du manifest Android → `requestPermission()` échoue → écran « Accès caméra requis » en boucle → recherche visuelle ET capture de vente cassées sur Android. Pas en runtime sur les builds existants.
- **Recommandation** : Ajouter `["expo-camera", { cameraPermission: "Seconde utilise votre caméra pour photographier vos articles et rechercher par photo." }]` dans `plugins[]` (couvre Android + iOS proprement), OU a minima `android.permission.CAMERA` dans `android.permissions`.

---

## Findings P2 / P3

### P2-1 — Google Maps sans clé API → carte grise/vide (Android tuile grise, iOS pas de SDK Google)
- **Sévérité** : P2 (rétrogradé depuis P0 : sous-écran secondaire, garde `location`) — **Plateforme** : both
- **Fichiers** : `app/shop/[id].tsx:24,247,251`, `app/admin/shop-detail/[id].tsx:24,272`, `components/search/ShopMap.tsx:5,31` (code mort), `android/app/src/main/AndroidManifest.xml`, `ios/Seconde/Info.plist`, `ios/Podfile.lock:1717`, `app.config.js:51`
- **Description** : `provider={PROVIDER_GOOGLE}` force le SDK Google sur les 2 plateformes mais aucune clé n'existe (`grep geo.API_KEY` AndroidManifest = exit 1 ; `grep GMSApiKey` Info.plist = exit 1 ; aucun `googleMaps*` dans app.config.js). iOS n'a même pas le pod GoogleMaps (`Podfile.lock` : aucun `GoogleMaps`). Seul écran live user-facing = `app/shop/[id].tsx` (carte gardée par `shop.location` `:247`) ; `admin/shop-detail` = admin only ; `ShopMap.tsx` = code mort (0 importeur).
- **Impact** : Carte grise/vide sur la fiche boutique avec location renseignée. Fonctionnalité dégradée, non bloquante (pas un flux achat/auth).
- **Recommandation** : Injecter la clé (`android.config.googleMaps.apiKey` + `ios.config.googleMapsApiKey`), OU retirer `PROVIDER_GOOGLE` (provider natif par défaut), OU migrer vers `expo-maps`. Supprimer `ShopMap.tsx`.

### P2-2 — Saisie de prix avec virgule décimale (FR-CA) silencieusement tronquée
- **Sévérité** : P2 — **Plateforme** : both
- **Fichiers** : `features/search/components/PriceRangeInputs.tsx:43,56`, `features/search/hooks/useSearchScreen.ts:357-358`, `app/search.tsx:94-95`, `utils/formatPrice.ts:6-11`
- **Description** : Champs prix en `keyboardType="numeric"`, `onChangeText` branché sur les setters bruts (aucune sanitisation). `handlePriceApply` fait `parseFloat(minPriceText)` (`useSearchScreen.ts:357`) sans `.replace(',', '.')`. `parseFloat('45,50') === 45` → cents perdus sans message. Incohérent avec l'affichage qui utilise la virgule (`formatPrice.ts:10`, convention FR-CA documentée). Risque amplifié sur Android (clavier numérique expose la virgule en locale FR ; iOS `numeric` n'offre souvent aucun séparateur).
- **Impact** : Un prix max « 45,50 » filtre sur 45, sans avertissement.
- **Recommandation** : Normaliser `.replace(',', '.')` avant `parseFloat`, et/ou `keyboardType="decimal-pad"`.

> Note : un second finding « Saisie de prix incompatible virgule » (dimension Recherche textuelle) décrit le même bug aux mêmes lignes — il s'agit d'un doublon, à traiter en une seule correction.

### P2-3 — La chip Matière affiche l'ID brut au lieu du nom d'affichage
- **Sévérité** : P2 — **Plateforme** : both
- **Fichiers** : `features/search/hooks/useSearchScreen.ts:414-419`, `data/materials.ts:62-65,77-80`, `app/search.tsx:68`, `app/swap-zone.tsx:449`
- **Description** : `getMaterialLabel` retourne `sel[0]` (l'ID brut) quand une seule matière est sélectionnée (`useSearchScreen.ts:417`), sans mapper via `getMaterialName(id)` (qui existe `data/materials.ts:77-80` mais n'est pas importé). `filters.materials` contient bien des IDs (`getMaterialItems` mappe `value: material.id`). Contraste avec `getColorLabel` qui mappe correctement. La chip affiche « cuir-synthetique » / « elasthanne » au lieu de « Cuir synthétique » / « Élasthanne ».
- **Impact** : Chip de filtre matière illisible (IDs techniques avec tirets/sans accent) sur `/search` et `/swap-zone`.
- **Recommandation** : Importer `getMaterialName` depuis `@/data/materials` et faire `return getMaterialName(sel[0]);`.

### P2-4 — Sheets de filtre en thème CLAIR rendues dans SwapZone (univers SOMBRE)
- **Sévérité** : P2 — **Plateforme** : both
- **Fichiers** : `app/swap-zone.tsx:13,616,656`, `components/search/BrandSelectionSheet.tsx:548,574`, `components/CategoryBottomSheet.tsx:156,181`
- **Description** : `swap-zone.tsx` déclare une identité sombre (canvas `colors.deep` #0F0E0C, StatusBar light) mais réutilise `BrandSelectionSheet` et `CategoryBottomSheet` dont l'arrière-plan est hardcodé `colors.surface` (#FFFFFF) et le titre `colors.charcoal`. Aucune prop de theming n'existe (props vérifiées) ; couleurs figées en `StyleSheet.create`.
- **Impact** : Feuille blanche surgissant sur canvas sombre → rupture d'identité visuelle / flash blanc agressif.
- **Recommandation** : Injecter un variant `dark` dans ces sheets, OU dériver les couleurs du thème courant plutôt que de les hardcoder.

### P2-5 — Écran « Recherches sauvegardées » sans état d'erreur : un échec réseau affiche « Aucune recherche »
- **Sévérité** : P2 — **Plateforme** : both
- **Fichiers** : `app/saved-searches.tsx:241-242,260-281,364-368`, `services/savedSearchService.ts:76-103`
- **Description** : Deux seuls `useState` (`searches`, `isLoading`), aucun état d'erreur. Le catch de `load` ne fait que logger en `__DEV__` (`:267-273`), le `finally` repasse `isLoading=false`, `searches` reste `[]`. Le rendu tombe sur `EmptyState` « Aucune recherche sauvegardée » (`:366`). Le service re-throw bien (`savedSearchService.ts:101`). Aggravant : pas de pull-to-refresh ni bouton réessayer.
- **Impact** : Un utilisateur ayant des recherches mais hors-ligne voit « Aucune recherche » → faux signal de perte de données.
- **Recommandation** : Ajouter un état d'erreur dédié (offline + message + bouton Réessayer) au lieu de l'EmptyState quand le fetch échoue.

### P2-6 — La liste des recherches récentes reste périmée après une nouvelle recherche
- **Sévérité** : P2 — **Plateforme** : both
- **Fichiers** : `features/search/hooks/useSearchScreen.ts:129,149,176-188`, `app/search.tsx:122`, `services/searchHistoryService.ts:135`
- **Description** : `loadRecentSearches()` n'est appelé qu'au montage (`useEffect []`, `:133`) et utilise `getDocs` (pas de listener). `handleSearch` écrit l'historique (`:179`) mais ne re-fetch ni ne met à jour `recentSearches`. `setRecentSearches` n'apparaît qu'au montage (`:154`) et à la suppression (`:220`). Ni `handleClearAll` ni l'auto-hide ne rechargent.
- **Impact** : En revenant à l'écran vide, la recherche fraîche n'apparaît pas dans « RECHERCHES RÉCENTES » avant unmount/remount. Données persistées correctement ; seul l'affichage in-session est désynchronisé.
- **Recommandation** : Rappeler `loadRecentSearches()` après `addSearchToHistory` (ou dans le useEffect qui repasse en mode non-recherche).

> Note : un second finding « L'historique de recherche affiché ne se rafraîchit pas » (dimension Recherche textuelle, P3) décrit le même mécanisme — doublon à corriger en une fois.

### P2-7 — `formatSearchDisplay` ignore couleurs/matières/état/tri : recherches par ces seuls filtres affichées « Recherche »
- **Sévérité** : P2 — **Plateforme** : both
- **Fichiers** : `services/searchHistoryService.ts:52,234,287,322`, `components/search/RecentSearches.tsx:155`, `features/search/hooks/useSearchScreen.ts:178`
- **Description** : `formatSearchDisplay` (`:287-323`) ne formate que query, categoryIds (libellé générique « dans catégorie », jamais le vrai nom), brands, sizes, prix. Aucun bloc pour `colors`/`materials`/`condition`/`sortBy`. Le fallback est `'Recherche'` (`:322`). Or `addSearchToHistory` sauvegarde dès qu'un filtre actif existe sans texte (gate `:52`, `hasActiveFilters` couvre colors/materials/condition seuls).
- **Impact** : Une recherche « Noir » (couleur) / « Coton » (matière) / état seul s'affiche « Recherche », indistinguable. Catégorie jamais nommée.
- **Recommandation** : Étendre `formatSearchDisplay` pour rendre colors (`data/colors.ts`), materials, condition, et résoudre le vrai libellé via `getCategoryLabelFromIds` (`data/categories-v2.ts`).

### P2-8 — Recherche visuelle : fermeture du Modal et navigation simultanées (race iOS/Android)
- **Sévérité** : P2 — **Plateforme** : both
- **Fichiers** : `features/search/hooks/useSearchScreen.ts:248`, `app/search.tsx:174`, `app/_layout.tsx:227`
- **Description** : `handleVisualSearchCapture` fait `setShowVisualSearch(false)` puis `router.push(...)` dans le même tick (`:248-251`). Le Modal est `presentationStyle="fullScreen"` animation slide, sans `onDismiss` (`search.tsx:174-184`). La destination `/visual-search-results` est un push native-stack `slide_from_right` (`_layout.tsx:227`). Deux couches de présentation natives non coordonnées démarrent leurs animations dans le même tick.
- **Impact** : Transition saccadée/flash, rendu différent iOS vs Android.
- **Recommandation** : Naviguer après dismiss effectif (`onDismiss` du Modal, ou `InteractionManager.runAfterInteractions` / `requestAnimationFrame`).

### P2-9 — Index vectoriel manquant pour les recherches visuelles filtrées (categoryIds / priceRange + findNearest)
- **Sévérité** : P2 — **Plateforme** : backend
- **Fichiers** : `functions/src/callable/search.ts:123-139`, `firestore.indexes.json:1087-1102`, `functions/src/triggers/embeddings.ts:207-213`, `services/visualSearchService.ts:107-111`, `app/visual-search-results.tsx:76`
- **Description** : `visualSearch` accepte `categoryIds` (`array-contains-any`) et `priceRange` (`==`) combinés au `findNearest` sur `embedding` (`search.ts:123-131`). Le seul index vectoriel (`firestore.indexes.json:1087-1102`) couvre `isActive ASC + embedding vector` — pas de composite avec categoryIds/priceRange. Chemin filtré aujourd'hui mort côté UI (`visual-search-results.tsx:76` appelle `searchByImage(imageUri)` sans filters). Précision : `getSimilarProducts` (`search.ts:266-276`) ne filtre QUE `isActive` → couvert, ne peut pas déclencher le missing-index.
- **Impact** : Si un filtre catégorie/prix est branché un jour, la CF renvoie « internal » → « L'analyse de l'image a échoué ». Bug latent.
- **Recommandation** : Déclarer les index vectoriels composites, OU retirer le support de filtres de `visualSearch` tant qu'il n'est pas câblé.

### P2-10 — Incohérence de casse marque entre filtre sauvegardé et matching serveur in-memory
- **Sévérité** : P2 — **Plateforme** : backend
- **Fichiers** : `functions/src/scheduled/savedSearches.ts:119,148`, `functions/src/triggers/products.ts:100`, `services/articlesService.ts:150,774`, `utils/normalizeBrand.ts:24`
- **Description** : Le filtre stocke le label Title Case (`BrandSelectionSheet` → `brandDisplay`). La recherche live normalise via `brandKey()` des deux côtés (pas de bug de casse côté live). La CF n'utilise jamais `brandKey` ni ne valide `filters.brands` en mémoire ; son seul rapprochement marque est le substring texte (`savedSearches.ts:148`), conditionné à `searchQuery`. La cause racine reste le champ de requête erroné (`brands` sur `articles`, cf. P1-1) + absence totale de matching marque in-memory.
- **Impact** : Logiques de marque divergentes notif ↔ recherche.
- **Recommandation** : Centraliser `brandKey()` côté CF et valider la marque en mémoire même sans `searchQuery`.

### P2-11 — Le tri populaire sans terme route vers `search_index` mais saute le backfill et n'applique pas categoryIds hiérarchiques en serveur
- **Sévérité** : P2 — **Plateforme** : backend
- **Fichiers** : `services/articlesService.ts:405,468-481,521-524,502,544`, `firestore.indexes.json:470-587`, `functions/src/triggers/products.ts:141`
- **Description** : `sortBy==='popular'` sans terme interroge `search_index` avec `isActive+isSold (+category +condition) + orderBy(popularityScore desc)` (`:468-481`, index présents). MAIS `categoryIds` hiérarchique n'est appliqué qu'en client-side (`matchDoc :521`), sans `where` serveur, et aucun index `search_index` `isActive+isSold+categoryIds+popularityScore` n'existe. Le sur-fetch client est borné (`fetchLimit = limit*5`, `MAX_REFILL_BATCHES = 5`). Couplé à P0-2, le tri « Populaire » sur catalogue legacy renvoie vide/partiel.
- **Impact** : Résultats incomplets selon le remplissage de `search_index` ; filtre catégorie best-effort borné.
- **Recommandation** : Après backfill, vérifier le taux de couverture ; documenter le best-effort client-side borné, OU ajouter `where('categoryIds','array-contains',...)` + l'index `search_index` correspondant.

### P3 (regroupés)

**P3-1 — Double debounce 350ms sur la soumission explicite (OK / touche Rechercher)** — both
`features/search/hooks/useSearchScreen.ts:176-188,70`, `hooks/useArticleSearch.ts:133-134,163-173,197-223`, `SearchHeader.tsx:50-51`, `app/search.tsx:80-82`. La frappe ne traverse jamais le debounce (state local) ; seule la valeur committée (OK/Entrée/tap récente/tendance) passe par `useDebounce(..., 350)` → ~350 ms de latence après une validation explicite, sans justification. **Reco** : exposer un setter immédiat pour la soumission, ou ne pas faire transiter la valeur committée par `useDebounce`.

**P3-2 — Divergence de filtrage `moderationStatus` entre chemin texte (search_index) et browse (articles)** — backend
`functions/src/triggers/products.ts:38-41`, `services/articlesService.ts:614-617,701,736-780`, `functions/src/callable/products.ts:364`, `firestore.rules:103-104,122`. `searchViaArticles` ne filtre que `isActive`/`isSold`, jamais `moderationStatus` ; le texte hérite du filtre via la composition de `search_index`. Dormant (tout est `'approved'` + rules verrouillent la valeur). **Reco** : aligner les deux chemins, ou tracer la dette.

**P3-3 — Le sélecteur de tri n'affiche qu'une seule option en mode texte (sheet à un seul item)** — both
`features/search/hooks/useSearchScreen.ts:267-284`, `app/search.tsx:64,237-243`, `features/search/constants.ts:9-14`, `FilterChipsRow.tsx:49-98`. En mode texte `availableSortItems` = `['popular']` (contrainte Firestore H5/H6 documentée), mais la chip Tri reste active/tappable et ouvre une sheet à un seul choix figé. **Reco** : désactiver/griser la chip (« Tri : pertinence ») ou message explicatif dans la sheet.

**P3-4 — Format de prix anglophone ($ collé) dans les tags des recherches sauvegardées** — both
`app/saved-searches.tsx:78-86`, `utils/formatPrice.ts:6-11`, `features/search/hooks/useSearchScreen.ts:433-438`, `components/SaveSearchButton.tsx:214`. `buildFilterTags` produit « 20$ - 50$ » vs convention FR-CA « 20 $ - 50 $ » (espace). Incohérence inter-écrans (search vs saved-searches vs SaveSearchButton). **Reco** : réutiliser `formatPrice(min)/formatPrice(max)`.

**P3-5 — Champ `pattern` toujours écrit sur les articles alors que le concept est supprimé** — both
`services/articlesService.ts:151`, `data/patterns.ts:1`, `functions/src/callable/products.ts:382`, `services/swapService.ts:219`, `features/article/utils.ts:23`, `types/index.ts:197,805`. Écriture gardée jamais alimentée (aucun écran ne set `pattern`) + `data/patterns.ts` orphelin. Mais `pattern` reste vivant en lecture/affichage (tags fiche article) pour les legacy. **Reco** : nettoyer toute la surface (products.ts, utils.ts, swapService.ts, types) si suppression confirmée.

**P3-6 — `BrandGrid.tsx` : composant mort (radius magique 20, chargement 40 docs latent)** — both
`components/search/BrandGrid.tsx:25,37,62,181`, `constants/theme.ts:19,70`. 0 consommateur ; charge 40 docs `brands` si jamais monté ; `borderRadius: 20` absent de l'échelle `radius`. NB : la justification « primary/foreground obsolètes » du finding original était fausse (ce sont les tokens canoniques) ; le vrai smell est le radius magique. **Reco** : supprimer le fichier.

**P3-7 — `CategoryTree.tsx` inutilisé : la recherche utilise `CategoryBottomSheet`** — both
`components/search/CategoryTree.tsx:28,66`, `components/CategoryBottomSheet.tsx:121`, `app/search.tsx:187`, `app/swap-zone.tsx:616`, `app/sell/details.tsx:341`, `app/article/edit/[id].tsx:821`. Code mort (0 importeur, pas de barrel). Composant présentationnel orphelin (pas une « implémentation concurrente »). **Reco** : supprimer.

**P3-8 — Brand sheet single-select : feedback transitoire de sélection manquant** — both
`components/search/BrandSelectionSheet.tsx:88,303,320,401`, `app/sell/details.tsx:373`. En single-select `isSelected` dérive de la prop `selectedBrand` ; `toggleBrand` ferme aussitôt sans toucher l'état interne. Nuance : la pré-sélection à l'ouverture s'affiche bien cochée (impact « coche illusoire » du finding original surestimé). Défaut réel = highlight transitoire absent avant fermeture. **Reco** : `setSelectedBrands([brandLabel])` au tap si on veut le highlight.

**P3-9 — Brand sheet : recherche serveur non paginée (plafond 50 résultats)** — both
`components/search/BrandSelectionSheet.tsx:119,243,384`. En mode recherche, requête `limit(50)` sans `startAfter` ; `handleLoadMore` se désactive dès qu'une query texte est présente (commentaire promettant une « pagination différente » inexistante). >50 marques sur préfixe court → inaccessibles. **Reco** : pagination `startAfter` sur la recherche, ou indicateur « affinez votre recherche ».

**P3-10 — Channel Android `saved_searches` jamais enregistré → notifications dégradées sur Android** — android (rétrogradé P1→P2 dans le verdict, classé ici)
`functions/src/scheduled/savedSearches.ts:234-241`, `hooks/useNotificationSetup.ts:22-55`, `app.config.js:37-39`. Le job cible `channelId: 'saved_searches'` ; `setupAndroidChannels` n'enregistre que `messages`/`offers`/`notifications`/`swaps`. Sur Android, repli sur canal par défaut (son/importance non garantis), pas perte systématique. **Reco** : ajouter le channel `saved_searches` ou réutiliser `notifications`.

**P3-11 — Contrat client/serveur incohérent : le client envoie `mimeType`, le backend l'ignore** — backend
`services/visualSearchService.ts:92,126-136`, `functions/src/callable/search.ts:52-54,100`. Le client type/envoie `mimeType` (hardcodé `'image/jpeg'` à `:92`), le backend ne le déstructure pas (`:100`) et ne le passe pas à Vertex. Champ doublement inutile. **Reco** : supprimer `mimeType` du payload, ou l'exploiter côté backend.

**P3-12 — Détection HEIC morte : la conversion HEIC→JPEG ne se déclenche jamais** — both
`services/visualSearchService.ts:48-52,62,92`, `functions/src/callable/search.ts:47-54,100`, `components/VisualSearchCamera.tsx:67-90`, `app/visual-search-results.tsx:55-76`. `detectMimeType` ne renvoie que png/jpeg → `needsConversion` toujours false. Nuance : `mimeType` est hardcodé `'image/jpeg'` et ignoré par le backend ; la caméra produit du JPEG et le picker iOS transcode en mode Compatible → impact utilisateur non démontrable sur la chaîne réelle (d'où P3, pas P2). **Reco** : supprimer la branche morte et forcer toujours `ImageManipulator→JPEG`.

**P3-13 — Bouton « Rechercher » (confirm) sans garde anti double-tap dans VisualSearchCamera** — both
`components/VisualSearchCamera.tsx:107-111,188-191`, `features/search/hooks/useSearchScreen.ts:248-251`, `features/home/header/useHomeHeader.ts:22-28`, `app/(tabs)/index.tsx:133-143`, `app/search.tsx:174-184`, `functions/src/callable/search.ts:29-30`. `handleCapture` est gardé par `isCapturing` mais `handleConfirm` ne l'est pas → double-tap = 2 `router.push` → 2 écrans de résultats + 2 appels CF (rate limit 5/min non-auth, 20/min auth). **Reco** : flag `hasConfirmed` (useRef) + `disabled`.

**P3-14 — NSCameraUsageDescription en anglais générique pour une app FR-only** — ios
`ios/Seconde/Info.plist:57-58`, `app.config.js:19-67,77-92`, `node_modules/expo-camera/plugin/build/withCamera.js:5`. Texte « Allow $(PRODUCT_NAME) to access your camera » (placeholder du plugin). Le 1er prompt rencontré sera vraisemblablement la capture de vente (pas la recherche visuelle). **Reco** : `cameraPermission` FR via le plugin `expo-camera` (à AJOUTER), ou `NSCameraUsageDescription` dans `ios.infoPlist`.

**P3-15 — Handler de notifications dupliqué et mort (`NotificationContext`)** — both (rétrogradé P2→P3 : module 100 % orphelin)
`contexts/NotificationContext.tsx:91-185,138`, `hooks/useNotificationSetup.ts:97-118`, `functions/src/scheduled/savedSearches.ts:226-233`. Tout le fichier est code mort (0 import, 0 mount) et porte le même bug de clé que P0-1. **Reco** : supprimer le fichier entier (pas seulement réduire à un shim).

**P3-16 — `resultCount` jamais enregistré : l'UI « {N} articles » est du code mort** — both (rétrogradé P2→P3)
`features/search/hooks/useSearchScreen.ts:179`, `services/searchHistoryService.ts:44,72,83,157`, `components/search/RecentSearches.tsx:157`. Le 4e param `resultCount` n'est jamais passé → stocké `null` → branche `item.resultCount > 0` jamais atteinte. **Reco** : retirer la branche + le param, OU enregistrer `articles.length` APRÈS réception des résultats (pas dans `handleSearch`).

**P3-17 — `clearHistory()` implémenté mais aucun écran ne l'appelle** — both
`services/searchHistoryService.ts:184`, `features/search/hooks/useSearchScreen.ts:228`, `app/search.tsx:114`, `components/search/RecentSearches.tsx:50`. Méthode morte. Piège : le bouton « Effacer tout » (`search.tsx:114`) appelle `handleClearAll` (reset filtres), PAS l'historique. La purge serveur 12 mois + delete-account couvrent le risque vie privée. **Reco** : câbler `clearHistory` à un bouton « Effacer l'historique », ou retirer la méthode.

**P3-18 — Autofocus de la recherche via `setTimeout` → ouverture clavier divergente iOS/Android** — both
`features/search/hooks/useSearchScreen.ts:131`, `features/search/components/SearchHeader.tsx`, `app/_layout.tsx`, `features/home/header/useHomeHeader.ts`. `setTimeout(() => inputRef.current?.focus(), 100)` tiré pendant la transition `slide_from_right` ; pas de prop `autoFocus`, pas de mitigation `InteractionManager`. Android peut ne pas ouvrir le clavier. Dégradation gracieuse. **Reco** : `autoFocus` sur le TextInput, ou focus après `InteractionManager.runAfterInteractions` / `useFocusEffect`.

---

## Matrice cross-plateforme

| Zone | iOS | Android | Écart constaté |
|------|-----|---------|----------------|
| Tap notif recherche sauvegardée | Cassé (clé `savedSearchId` jamais présente) | Cassé (idem) | Aucun écart — cassé des deux côtés (P0-1) |
| Channel notif `saved_searches` | `channelId` ignoré (OK relatif) | Repli canal par défaut, son/importance non garantis | **Oui** — dégradation Android (P3-10) |
| Permission caméra (régénération native) | OK (NSCameraUsageDescription fourni par expo-image-picker) | CAMERA disparaît au prebuild --clean → recherche visuelle + vente cassées | **Oui** — Android seul (P1-11) |
| NSCameraUsageDescription | Texte EN générique sur app FR | Pas de rationale système par défaut | **Oui** — friction consentement iOS (P3-14) |
| Carte boutique (Google Maps) | Pas de SDK GoogleMaps → tuiles non rendues | Tuile grise + auth failure | Cassé des deux côtés, symptômes différents (P2-1) |
| Saisie prix virgule décimale | `numeric` n'expose souvent pas le séparateur | `numeric` expose la virgule en locale FR | **Oui** — risque amplifié Android (P2-2) |
| Autofocus champ recherche | Clavier ouvre (100 ms suffit généralement) | Clavier peut ne pas s'ouvrir (focus avant fin transition) | **Oui** — penche Android (P3-18) |
| Modal recherche visuelle → push résultats | Révélation écran sous modal possible | Dialog se ferme pendant le push | **Oui** — artefact transitoire différent (P2-8) |
| Recherche texte / filtres / tailles / chips | Logique JS partagée | Idem | Aucun — comportement identique (P1-7, P1-8, P2-3, etc.) |
| Backend (search_index, embeddings, notif, index) | n/a | n/a | Aucun écart de plateforme — bugs serveur communs |

---

## Préparation déploiement & migration (ordre d'opérations sûr)

> Ordre IMPÉRATIF (cohérent avec la note projet « migration AVANT recherche prod »). Toute inversion détruit l'index ou rend le catalogue invisible.

1. **Données — moderationStatus (P0-3)** : script admin SDK (serveur, les rules interdisent au client) → `set moderationStatus='approved'` sur tous les articles `isActive==true` legacy/seed. Ne PAS toucher les inactifs.
2. **Données — size (P1-5)** : dans le même passage, convertir `size: 'M'` (string) → `{ value:'M', system:'EU' }` sur `articles`. Inclure cette conversion dans le backfill `search_index`.
3. **Index Firestore (P1-3, P1-4, P2-9, P2-11)** : déployer AVANT la recherche prod :
   - `articles { isActive, isSold, brands CONTAINS, createdAt }` (notif marque).
   - `articles { sellerId, isActive, isSold, (categoryIds CONTAINS | condition | price), createdAt }` (boutique filtrée) — OU basculer ces filtres en client-side.
   - (optionnel) index vectoriels composites embeddings (categoryIds/priceRange) si on branche les filtres visuels.
   - (optionnel) `search_index { isActive, isSold, categoryIds, popularityScore }` si on veut un `where` serveur en tri populaire.
   - Attendre la fin du build des index (statut READY) avant l'étape suivante.
4. **Backfill search_index (P0-2)** : SEULEMENT après 1+2. Script admin qui produit/ré-écrit le doc `search_index` de chaque article actif (avec `moderationStatus='approved'` déjà posé, sinon le trigger supprime). Vérifier 100 % de couverture des articles actifs.
5. **Corriger les clés/contrats backend** : payload notif `searchId`→`savedSearchId` (P0-1), requête marque notif sur le champ réel (P1-1), parité `brandKey` (P1-2/P2-10), exclusion `isSold` recherche visuelle (P1-6).
6. **Rules** : ajouter `allow update` sur `searchHistory` (P1-9), puis `npm run test:security`.
7. **Native** : ajouter le plugin `expo-camera` + résoudre la lib de cartes (P1-10/P1-11/P2-1), puis `npx expo prebuild` et vérifier `AndroidManifest.xml` (CAMERA présent) + clé Maps.
8. **Mise en prod recherche** : router le client vers `search_index` seulement après validation de la couverture (étape 4) et des index (étape 3).

---

## Plan d'action priorisé (checklist ordonnée P0 → P3)

**P0 — avant toute mise en prod recherche**
- [ ] P0-3 : poser `moderationStatus='approved'` sur articles actifs legacy/seed (serveur).
- [ ] P0-2 : backfill `search_index` (après P0-3), vérifier couverture 100 %.
- [ ] P0-1 : aligner clé payload notif (`searchId`→`savedSearchId`) + test croisé producteur/consommateur.

**P1 — bloquants fonctionnels / écarts plateforme**
- [ ] P1-5 : migrer `size` string→objet (articles + search_index).
- [ ] P1-3 : index `articles brands CONTAINS` (ou rabattre en mémoire) + try/catch par recherche.
- [ ] P1-4 : index composites `sellerId+filtre` (ou filtres client-side).
- [ ] P1-1 / P1-2 : corriger requête marque notif (champ réel) + parité `brandKey()` in-memory.
- [ ] P1-6 : exclure `isSold` de la recherche visuelle (filtre `articlesMap` + trigger embeddings).
- [ ] P1-9 : `allow update` sur `searchHistory` + redéploiement rules.
- [ ] P1-7 : `setIsSearching(true)` dans `handleSortSelect` + `sortBy` dans `hasNonDefaultFilters`.
- [ ] P1-8 : merge multi-système dans `SizeSelectionSheet`.
- [ ] P1-10 / P1-11 : trancher la lib de cartes + ajouter plugin `expo-camera`, re-prebuild.

**P2 — qualité / cohérence**
- [ ] P2-1 : clé Google Maps ou provider natif ; supprimer `ShopMap.tsx`.
- [ ] P2-2 : normaliser virgule prix (`.replace(',', '.')` / `decimal-pad`).
- [ ] P2-3 : `getMaterialName` dans `getMaterialLabel`.
- [ ] P2-4 : variant dark des sheets pour SwapZone.
- [ ] P2-5 : état d'erreur dédié écran recherches sauvegardées.
- [ ] P2-6 : recharger `recentSearches` après recherche.
- [ ] P2-7 : étendre `formatSearchDisplay` (colors/materials/condition + libellé catégorie).
- [ ] P2-8 : séquencer dismiss modal → push.
- [ ] P2-9 / P2-11 : index vectoriels filtrés / couverture tri populaire (post-backfill).
- [ ] P2-10 : `brandKey()` côté CF.

**P3 — dette / polish**
- [ ] Supprimer code mort : `BrandGrid.tsx`, `CategoryTree.tsx`, `contexts/NotificationContext.tsx` (P3-6/7/15).
- [ ] P3-1 : setter immédiat pour la soumission explicite (retirer debounce sur valeur committée).
- [ ] P3-3 : désactiver/expliquer la chip Tri en mode texte.
- [ ] P3-4 : format prix FR-CA dans `buildFilterTags`.
- [ ] P3-5 : nettoyer toute la surface `pattern` (ou documenter).
- [ ] P3-8 / P3-9 : highlight transitoire brand sheet + pagination recherche marque.
- [ ] P3-11 / P3-12 : supprimer `mimeType` inutile + branche HEIC morte (forcer JPEG).
- [ ] P3-13 : garde anti double-tap `handleConfirm`.
- [ ] P3-14 : copy FR caméra iOS.
- [ ] P3-16 : `resultCount` (retirer la branche ou enregistrer après résultats).
- [ ] P3-17 : câbler ou retirer `clearHistory()`.
- [ ] P3-18 : `autoFocus` / focus post-transition.
- [ ] P3-2 / P3-10 : aligner `moderationStatus` browse (ou tracer dette) ; channel Android `saved_searches`.

---

## Annexe — faux positifs écartés

1. **« Le X de la chip Tri est un no-op en mode texte (boucle de re-snap) »** — Écarté. L'effet de snap a pour seule dépendance `[isTextMode]` (`useSearchScreen.ts:278-284`) ; `handleSortRemove` ne touche pas `activeSearchQuery`, donc `isTextMode` ne bascule pas et l'effet ne se re-déclenche pas. Le X retire réellement le tri (`isSortActive` → false, le X disparaît). La « boucle » décrite n'existe pas — mauvaise lecture du tableau de dépendances.

2. **« AI brand pre-fill ne fonctionne qu'une fois par montage (`hasInitializedSearch` jamais réinitialisé) »** — Écarté sur l'impact. Le ref non réinitialisé est réel mais bénin : `searchQuery` (state) PERSISTE entre fermeture et réouverture et le champ n'est pas vidé au close. La marque reste affichée à la réouverture ; la friction « champ vide, retaper » n'existe pas. Une nouvelle analyse IA = nouvelle navigation = instance neuve. Au mieux P3 cosmétique.

3. **« returnKeyType incohérent entre les deux barres de recherche »** — Réfuté. Il n'existe qu'UN champ de saisie de recherche (`SearchHeader.tsx:51`, `returnKeyType="search"`). `components/ui/SearchBar.tsx` est un Pressable sans TextInput ET du code mort (0 instanciation JSX). Le Home utilise son propre Pressable (`HomeHeader.tsx:45`). Aucune « deuxième UX » ni incohérence réelle ; les seuls autres TextInput (prix) sont `returnKeyType="done"`, correct pour leur rôle.
