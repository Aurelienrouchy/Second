# Audit Recherche + Filtres — Second

> Généré le 2026-05-29 via workflow multi-agents (36 agents, 135 findings vérifiés adversarialement). Trace par dimension : UI → hook → service → query Firestore → index.

---

## ✅ STATUT — Lot de correctifs implémenté (2026-05-29)

**Décisions d'archi (fondateur)** : moteur de recherche = **Firestore maison réparé** (pas de moteur dédié) · filtre `patterns` **supprimé** · tailles = modèle **`{value, system}`** (`ArticleSize`) avec migration · périmètre = **tout** (criticals → low).

**Code livré** (couche app `rn-expo-dev` + couche données `firebase-backend`, `tsc` propre hors erreurs pré-existantes non liées) :
- **C1** ✅ `search_index` écrit `categoryIds` + match par IDs canoniques, fallback `data.category` cassé supprimé.
- **C2** ✅ `orderBy('price')` mène le tri quand une inégalité prix est présente (+ `createdAt` secondaire).
- **H1** ✅ `normalizeSearchText` (NFD + strip diacritiques/ponctuation) **byte-identique** indexeur ↔ client. Test unitaire 20/20 vert.
- **H4/H7/M4** ✅ boucle de remplissage (cap 5 batches), curseur = dernier doc **fetché**, `hasMore` bout-en-bout hook↔service.
- **H5/H6** ✅ re-tri client supprimé en mode texte ; l'UI masque le tri prix/date quand un terme est saisi.
- **H2/H3** ✅ index manquants ajoutés à `firestore.indexes.json` (**à déployer manuellement**).
- **M1/L1/L2/L6** ✅ match exact (couleurs/matières par appartenance, marques normalisées, tailles `value+system`, condition `'bon état'`).
- **M5/M6/M7/L3** ✅ parité `anyFilterActive`, restore `selectedSort`/prix, chips retirables (X câblé sur `handleFilterRemove`).
- **M8/L8** ✅ dédup historique, export RGPD lit `timestamp`.
- **L7** ✅ `distanceResultField: '__distance__'` sur les 2 `findNearest` (visualSearch + getSimilarProducts).
- **patterns** ✅ supprimé (types, services, matcher notif, hooks). `Article.pattern` (métadonnée) conservé.

**⏳ PENDING — déploiement (NON exécuté ; bloqué garde-fou prod, à lancer côté fondateur)** :
1. `firebase deploy --only "functions:updateSearchIndex,functions:createArticle,functions:updateArticle,functions:visualSearch,functions:getSimilarProducts,functions:getNewArrivals,functions:getPriceDrops,functions:getFeaturedSellers,functions:getHomeFeed,functions:checkSavedSearchNotifications,functions:generateStyleProfile"` — **ciblé par nom, jamais `--force`/blanket** (protège l'orphelin financier `requestWithdrawal`).
2. `firebase deploy --only firestore:indexes` puis attendre statut `READY`.

**~~Migration de données~~ ANNULÉE (2026-06-01)** : wipe complet des comptes + articles prévu → aucune donnée existante à migrer. Les scripts `migrateArticleSize`/`backfillSearchIndexCategoryIds` ont été **supprimés**. Les nouveaux articles créés après le wipe auront directement `size: {value,system}` (via `createArticle` corrigé) et `search_index.categoryIds` (via le trigger `updateSearchIndex`).

> Le verdict ci-dessous décrit l'état **avant** correctifs.

## 1. Verdict global

**Non, la recherche avec filtres ne fonctionne pas de bout en bout** : le cas nominal (tri Récent, sans terme, filtres client) marche, mais dès qu'on combine un **terme texte** ou un **tri** avec des filtres, plusieurs chemins renvoient **0 résultat à tort**, **crashent sur index manquant**, ou paginent de façon incohérente — sur une marketplace mono-FR, l'asymétrie d'accents et le filtre catégorie mort en recherche texte sont rédhibitoires.

## 2. Tableau récapitulatif par dimension

| Dimension | Status | Réglable UI | Filtrage | Index OK |
|---|---|---|---|---|
| text-query | partial | oui | mixte (1er mot serveur, reste client) | oui (keywords+popularityScore) |
| categoryIds | partial | oui | mixte (serveur sans terme / **mort** avec terme) | partiel |
| colors | partial | oui | client | n/a |
| sizes | works | oui | client | n/a |
| materials | works | oui | client | n/a |
| condition | partial | oui | mixte | **partiel** |
| price-range | partial | oui | mixte | **partiel** |
| brands | partial | oui | client | n/a |
| patterns | **dead** | **non** | client | n/a |
| sortBy | partial | oui | mixte | **partiel** |
| pagination-x-filters | **broken** | oui | mixte | oui |
| filter-chips-clear | partial | partiel | mixte | n/a |
| saved-searches | partial | oui | mixte | oui |
| search-history | partial | n/a | n/a | n/a |
| visual-search | works | partiel | serveur | partiel |
| index-coverage | **broken** | oui | mixte | **partiel** |

## 3. Ce qui FONCTIONNE

- **Tailles (`sizes`)** et **matières (`materials`)** : câblage UI → query → filtre client-side complet et cohérent (vocabulaire d'IDs partagé entre création et recherche). `articlesService.ts:648-651` (sizes), `:653-660` (materials).
- **Recherche visuelle** : flux complet et branché (Cloud Function `visualSearch` réelle, Vertex AI 1408 dims, `findNearest` COSINE), chemin nominal sans filtre fonctionnel. `functions/src/callable/search.ts:83-219`.
- **Round-trip données des recherches sauvegardées** : tous les champs persistés reviennent identiques dans la query, aucun `undefined` écrit dans Firestore. `services/savedSearchService.ts:254-289`.
- **Cas par défaut (tri Récent, sans terme texte)** : filtre catégorie + condition + prix appliqués server-side avec index présents. `articlesService.ts:541-570`.
- **« Effacer tout »** reset correctement filtres + catégorie + tri + prix. `useSearchScreen.ts:210-221`.

## 4. Ce qui est CASSÉ / à risque (trié par sévérité)

### CRITICAL

**C1 — Filtre catégorie totalement mort en recherche textuelle (et tri Populaire)**
`functions/src/triggers/products.ts:87-133` + `services/articlesService.ts:479-484`
- **Vérifié** : `searchIndexData` (products.ts:87-133) n'écrit AUCUN champ `categoryIds`. Côté lecture, `articlesService.ts:481` lit `data.categoryIds || []` (toujours `[]`), `includes(target)` toujours faux, puis fallback `data.category !== targetCategoryId` (`:483`) qui compare un **libellé d'affichage** (ex. « Manteaux ») à un **ID feuille hiérarchique** (ex. `women_clothing_coats_coats`) — jamais égal.
- **Impact** : toute recherche combinant un terme texte (ou tri Populaire) + filtre catégorie renvoie **systématiquement 0 résultat**.
- **Correctif** : ajouter `categoryIds: articleData.categoryIds || []` dans `searchIndexData` (products.ts) + backfill du `search_index`, OU supprimer le fallback `data.category` et n'utiliser que `categoryIds`.

**C2 — Inégalité `price` + `orderBy(createdAt)` en tri Récent : requête Firestore invalide**
`services/articlesService.ts:552-570`
- **Vérifié** : avec `minPrice/maxPrice` (inégalité sur `price`) ET `sortBy='recent'` (défaut), le code émet `where(price>=) + where(price<=) + orderBy('createdAt','desc')`. Firestore exige que le champ d'inégalité soit le **premier orderBy**. Les index existants (`isActive+isSold+price ASC+createdAt DESC`) mènent par `price`, pas par `createdAt`.
- **Impact** : appliquer une fourchette de prix avec le tri par défaut → erreur runtime, écran d'erreur après `retry:3`.
- **Correctif** : forcer `orderBy('price')` en premier quand une fourchette prix est présente, ou réordonner les contraintes.

### HIGH

**H1 — Asymétrie d'accents indexation vs requête : les recherches accentuées ne matchent jamais**
`functions/src/utils/search.ts:12-16` vs `services/articlesService.ts:402-404`
- **Vérifié** : l'indexeur fait `.replace(/[^\w\s]/g, ' ')` SANS flag unicode (search.ts:14) → tous les accents (é, è, à…) sont supprimés avant génération des keywords. Le client (articlesService.ts:402) ne fait que `toLowerCase().split(/\s+/)` SANS strip d'accents ni de ponctuation. `where('keywords','array-contains','été')` ne matchera jamais un keyword désaccentué.
- **Impact** : sur une marketplace **mono-FR**, « robe d'été », « décontracté », « manteau » renvoient 0/mauvais résultats. La ponctuation (`c'est`, `nike,`) casse aussi le match.
- **Correctif** : partager une fonction de normalisation unique (NFD + strip diacritiques + strip ponctuation) entre `functions/utils/search.ts` et le client, ou ajouter le flag `u` + normalisation des deux côtés.

**H2 — Index manquant : `price_desc` + `condition` (avec/sans catégorie)**
`services/articlesService.ts:548-565` + `firestore.indexes.json`
- **Vérifié sur les 50 index** : le seul `price:DESCENDING` est `isActive+isSold+categoryIds CONTAINS+price DESC`. Il n'existe NI `isActive+isSold+price DESC` simple, NI `isActive+isSold+condition+price DESC`, NI `isActive+isSold+categoryIds+condition+price DESC`.
- **Impact crash runtime** : tri « Prix décroissant » **sans catégorie**, ou + condition, ou + catégorie + condition → `FAILED_PRECONDITION needs index` → écran d'erreur.
- **Correctif** : ajouter les index composites manquants en `price DESC`.

**H3 — Index manquant : tri Populaire + condition (sans terme, sur `search_index`)**
`services/articlesService.ts:411-421` + `firestore.indexes.json`
- **Vérifié** : aucun index `search_index` ne contient `condition`. La branche `sortBy=popular` sans terme émet `where(isActive)+where(isSold)+where(condition)+orderBy(popularityScore)`.
- **Impact** : tri Populaires + filtre État → crash needs index.
- **Correctif** : index `search_index` `isActive+isSold+condition+popularityScore DESC`.

**H4 — Pagination s'arrête prématurément quand une page est entièrement filtrée client-side**
`services/articlesService.ts:506-511` (search_index) et `:610-615` (articles) + `hooks/useArticleSearch.ts:209-210`
- **Vérifié** : le curseur `lastVisible` dérive du dernier article RETENU après filtrage. Si les `limitCount*5` (=100) docs fetchés sont tous éliminés (ex. filtre couleur rouge mais 100 docs noirs), `limitedArticles=[]` → `lastVisibleDoc=null` → `getNextPageParam` renvoie `undefined` → `hasNextPage=false`.
- **Impact** : faux « Aucun résultat » / liste tronquée alors que des matches existent plus loin dans la collection. Touche colors/sizes/materials/brands/patterns + prix/condition en mode texte.
- **Correctif** : boucle de remplissage (re-fetch jusqu'à atteindre `limitCount` ou épuisement), et conserver le dernier doc FETCHÉ comme curseur (pas le dernier RETENU).

**H5 — Re-tri client-side intra-page sur `search_index` : ordre global faux + docs sautés**
`services/articlesService.ts:408, 502-504, 506-511`
- **Vérifié** : avec un terme texte, l'ordre serveur est TOUJOURS `popularityScore DESC` (`:408`), mais si `sortBy=price_asc/desc/recent`, on re-trie en JS la seule page courante (`:502-504`) avant `slice`. Le curseur (`:508-511`) pointe alors sur le dernier article après tri prix, pas dans l'ordre `popularityScore` du `startAfter` → docs sautés/dupliqués entre pages.
- **Impact** : en recherche texte + tri prix/date, l'ordre affiché est faux dès qu'on scrolle et des résultats sont perdus.
- **Correctif** : ne pas proposer le tri prix/date en mode texte, OU rapatrier suffisamment puis trier globalement, OU indexer un champ de tri exploitable côté serveur.

**H6 — Filtre prix ignoré par Firestore en recherche textuelle (échantillon par popularité)**
`services/articlesService.ts:372, 493-494, 438`
- **Vérifié** : avec un terme, le prix est filtré client-side sur 100 docs triés par `popularityScore`. « manteau » + maxPrice 50$ peut renvoyer 0 résultat si les manteaux <50$ ne sont pas dans le top 100 populaires.
- **Correctif** : idem H5 (le prix n'est pas indexable en parallèle du `keywords array-contains`).

**H7 — Filtrage marque uniquement client-side : pagination peut s'arrêter prématurément**
`services/articlesService.ts:576-621, 426-517` — même mécanisme que H4 appliqué aux marques peu fréquentes.

### MEDIUM

**M1 — Match couleur/marque/matière par `includes()` (substring) → faux positifs**
`articlesService.ts:642-644` (colors), `:656-657` (materials), `:662-669` (brands)
- **Vérifié** : `ac.toLowerCase().includes(color.toLowerCase())`. Conséquences : filtre `bleu` remonte `bleu-marine`/`bleu-clair` ; `or` (data/colors.ts:40) est sous-chaîne de `bordeaux`/`corail`/`orange` ; `cuir` remonte `cuir-synthetique` ; marque `Gap` remonte `Gap Kids`.
- **Correctif** : égalité stricte `===` (filtre et stockage partagent les mêmes IDs canoniques) ; pour brands, normaliser puis comparer exactement.

**M2 — Recherche multi-mots : seul le 1er mot interroge Firestore, les autres filtrés sur titre+marque uniquement (pas description)**
`articlesService.ts:452-477` — un article dont le 2e mot n'est que dans la description (indexé dans `keywords` mais absent de `titleLowercase`/`brand`) est fetché puis rejeté → faux négatifs.

**M3 — Condition filtrée incohéremment : serveur (articles) vs client sous-échantillonné (search_index avec terme)**
`articlesService.ts:489-491` — en recherche texte, la condition n'est PAS un `where()` Firestore, filtrée sur 100 docs → résultats valides tronqués.

**M4 — Pages de taille irrégulière (<20) non consolidées**
`articlesService.ts:579, 610` — overfetch x5 sans boucle de remplissage ; sur petit écran, `onEndReached` (threshold 0.8) peut ne pas se déclencher → pagination bloquée.

**M5 — Filtre `patterns` fantôme : actif sans chip et impossible à effacer**
`useSearchScreen.ts:400-402` (anyFilterActive SANS patterns) vs `useArticleSearch.ts:245` (hasActiveFilters AVEC patterns) — un `patterns` injecté par deep-link/saved-search filtre les résultats mais le bouton « Effacer tout » ne s'affiche pas → filtre bloqué non retirable.

**M6 — Désync chip Trier au restore (deep-link / saved-search)**
`useSearchScreen.ts:75, 386, 398` — `selectedSort` (source du label/état du chip) initialisé à `'recent'` et jamais hydraté depuis `initialFilters.sortBy`. La query trie bien (ex. price_asc) mais le chip affiche « Plus récents » inactif. Sync présente seulement dans `handleRecentSearchTap` (`:186`), absente du flux saved-search.

**M7 — Désync champs prix au restore**
`useSearchScreen.ts:77-78` — `minPriceText/maxPriceText` jamais resynchronisés ; après restore d'une recherche avec fourchette prix, les inputs apparaissent vides et un re-Apply écraserait le prix restauré.

**M8 — Historique sans déduplication**
`searchHistoryService.ts:43-73` — `addDoc` inconditionnel ; 3× la même recherche crée 3 docs ; « Recherches récentes » se remplit de doublons.

### LOW (sélection)

- **L1** — Ambiguïté US/EU sur les tailles : valeur stockée en string nue sans système, les listes US/EU se chevauchent numériquement (`sizes.ts:21` vs `:29`) → faux positifs/négatifs. `articlesService.ts:650`.
- **L2** — Match sizes case-sensitive (`includes` strict) alors que colors/materials/brands sont insensibles à la casse → faux négatif si casse divergente. `articlesService.ts:648-651`.
- **L3** — `handleFilterRemove` est du code mort : aucun retrait par chip (pas d'icône X), le seul retrait direct est « Effacer tout ». `useArticleSearch.ts:272-308` jamais appelé par `app/search.tsx`.
- **L4** — Articles sans couleur enregistrée systématiquement exclus quand un filtre couleur est actif. `articlesService.ts:640-641`.
- **L5** — Recherche prefix-only (pas de substring/infixe/suffixe), mots ≤2 chars non cherchables. `functions/src/utils/search.ts:28-35`.
- **L6** — `mapSearchIndexToArticle` fallback `condition: data.condition ?? 'bon etat'` (sans accent) ≠ valeur canonique `'bon état'`. `articlesService.ts:329`.
- **L7** — Bug `__distance__` dans `visualSearch`/`getSimilarProducts` : lu sans `distanceResultField` → non matérialisé avec @google-cloud/firestore@7.11.6 → similarité 100% pour tous, seuil 0.55 inopérant. `getSimilarProducts` est câblé en prod (`SimilarProducts.tsx:57`). `functions/src/callable/search.ts:192-200, 320-323`.
- **L8** — Export RGPD historique lit `data.searchedAt` alors que le service écrit `timestamp` → horodatage toujours `undefined`. `userService.ts:539-545`.

## 5. Champs morts

- **`patterns`** : entièrement câblé (logique + service + persistance) mais **AUCUNE affordance UI** (pas de chip dans `app/search.tsx:64-73`, pas de handler dans `useSearchScreen`). Injectable seulement par deep-link/saved-search, et alors **non retirable** (cf. M5). Le matcher backend de notifications saved-search déclare aussi `patterns` mais ne l'applique jamais (`functions/src/scheduled/savedSearches.ts`).
- **`category` (legacy)** : forcé à `undefined` dans `searchFilters` (`useArticleSearch.ts:142`), jamais persisté par `sanitizeFilters`. Champ mort confirmé.
- **`VisualSearchFilters` (categoryIds/priceRange/excludeArticleId)** : la Cloud Function les applique server-side mais le seul appelant `visual-search-results.tsx:76` n'envoie jamais de 2e argument → filtrage visuel inatteignable.
- **`handleFilterRemove`** : implémenté + ré-exporté jusqu'au retour de `useSearchScreen` mais jamais invoqué (cf. L3).
- **`resultCount` (historique)** : accepté par le service mais jamais passé par `handleSearch` (3 args) → sous-ligne « N articles » jamais affichée.

## 6. Risques d'index Firestore au runtime

Index `articles` présents (vérifié, 50 index) : seul `price DESC` couvert est `isActive+isSold+categoryIds CONTAINS+price DESC`. Combinaisons productibles depuis l'UI qui **crashent** :

| Combinaison productible | Index requis | Présent ? |
|---|---|---|
| `price_desc` seul (sans catégorie) | isActive+isSold+price DESC | **NON** → crash |
| `price_desc` + condition | isActive+isSold+condition+price DESC | **NON** → crash |
| `price_desc` + catégorie + condition | isActive+isSold+categoryIds+condition+price DESC | **NON** → crash |
| fourchette prix + tri Récent | inégalité-first (price puis createdAt) | shape invalide → crash (C2) |
| tri Populaire + condition (sans terme) | search_index isActive+isSold+condition+popularityScore | **NON** → crash |
| `price_desc` + catégorie SANS condition | isActive+isSold+categoryIds+price DESC | OUI → OK |
| tri Récent / price_asc (avec/sans catégorie/condition) | présents | OUI → OK |

**Action index** : ajouter dans `firestore.indexes.json` (puis déploiement explicite, **jamais `--force`**) : `articles` [isActive+isSold+price DESC], [isActive+isSold+condition+price DESC], [isActive+isSold+categoryIds CONTAINS+condition+price DESC] ; `search_index` [isActive+isSold+condition+popularityScore DESC]. Et corriger le code C2 (inégalité-first).

---

**Conclusion** : 2 dimensions saines (sizes, materials), 1 fonctionnelle isolée (visual-search), mais le cœur recherche+filtres présente **2 cassures critiques** (catégorie morte en recherche texte, inégalité prix invalide), **plusieurs HIGH** (accents FR, index price_desc/condition manquants, pagination qui s'arrête à tort) et un filtre **mort** (patterns). La réponse à « est-ce que tout fonctionne ? » est **non**.
