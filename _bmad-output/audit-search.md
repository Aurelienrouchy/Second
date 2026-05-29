# RAPPORT D'AUDIT -- SEARCH (Recherche de produits)

## Resume executif

| Severite | Nombre |
|----------|--------|
| CRITIQUE | 2 |
| HAUTE | 6 |
| MOYENNE | 8 |
| BASSE | 5 |
| **Total** | **21** |

Les deux findings critiques sont (1) une pagination cassee quand des filtres client-side sont actifs, et (2) les notifications de saved searches qui ne filtrent jamais par marque correctement car elles interrogent un champ `brands` qui n'existe pas sur les documents `articles`.

---

## 1. PAGINATION ET RESULTATS

### [CRITIQUE] Pagination cassee avec filtres client-side (text, colors, sizes, materials, brands, patterns)

**Scenario** : L'utilisateur cherche "Nike" avec le filtre couleur "noir". La page 1 retourne 20 resultats apres filtrage. L'utilisateur scroll vers le bas pour charger la page 2. Le curseur `lastVisible` pointe vers le dernier document Firestore de la page 1 (le 60eme document recupere, pas le 20eme affiche), ce qui saute potentiellement des dizaines d'articles correspondants.

**Code** : `services/articlesService.ts:360-361` -- `fetchLimit = hasClientSideFilter ? limitCount * 3 : limitCount` et `:471-479` :

```typescript
const limitedArticles = articles.slice(0, limitCount);
const lastVisibleDoc = querySnapshot.docs.length > 0
  ? querySnapshot.docs[querySnapshot.docs.length - 1] as QueryDocumentSnapshot
  : null;
return { articles: limitedArticles, lastVisible: lastVisibleDoc };
```

Le curseur est le **dernier document du batch Firestore** (60eme), pas le dernier des 20 articles filtres affiches. Resultat : la page suivante demarre apres le 60eme document, sautant les documents 21 a 60 qui auraient pu correspondre au filtre.

**Impact** : Des articles pertinents deviennent invisibles pour l'utilisateur. Plus les filtres sont selectifs, plus le trou est grand.

**Recommandation** : Utiliser le dernier document affiche comme curseur, ou migrer le filtrage vers le backend (search_index ou Firestore where-clauses).

---

### [HAUTE] search_index existe mais n'est jamais utilise pour la recherche

**Scenario** : Un trigger Cloud Function (`functions/src/triggers/products.ts:21-159`) maintient une collection `search_index` avec keywords, popularityScore, geohash, etc. Mais la recherche client (`services/articlesService.ts:305-484`) interroge directement `articles` et fait le filtrage texte en memoire.

**Code** : `functions/src/triggers/products.ts:17-19` commente :
```
TODO: the client currently searches via articlesService.ts client-side filtering.
Migrate to search_index queries for better performance.
```

**Impact** :
- Les `keywords` generes ne servent a rien
- Le `popularityScore` n'est pas utilise pour le tri
- Le `geohash` pour la recherche geo n'est pas exploite
- Le filtrage texte `includes()` cote client est imprecis et lent
- Chaque recherche lit 3x plus de documents que necessaire

**Recommandation** : Migrer vers `search_index` avec `where('keywords', 'array-contains', searchTerm.toLowerCase())`.

---

### [MOYENNE] Compteur de resultats affiche le nombre local, pas le total reel

**Code** : `app/search.tsx:101-103` -- `screen.articles.length` est le nombre d'articles charges localement, pas le total.

**Impact** : L'utilisateur pense qu'il n'y a que 20 resultats alors qu'il peut en charger plus.

**Recommandation** : Afficher "20+ articles trouves" ou supprimer le compteur exact.

---

## 2. SAVED SEARCHES (Recherches sauvegardees)

### [CRITIQUE] Filtre par marque dans savedSearches interroge un champ inexistant

**Scenario** : Un utilisateur sauvegarde une recherche avec filtre marque "Nike". Le Cloud Function tente `where('brands', 'array-contains-any', ...)` sur `articles`. Or `createArticle` n'ecrit qu'un champ `brand` (string singulier), jamais `brands` (array). Seule `search_index` ecrit `brands` comme array.

**Code** : `functions/src/scheduled/savedSearches.ts:115-120`
```typescript
} else if (filters.brands && filters.brands.length > 0) {
  articlesQuery = articlesQuery.where(
    'brands',
    'array-contains-any',
    filters.brands.slice(0, 10)
  );
}
```

**Impact** : Les utilisateurs qui sauvegardent une recherche avec filtre marque ne recevront **jamais** de notification.

**Recommandation** : Interroger `search_index` au lieu de `articles`, ou faire le filtrage `brand` en memoire.

---

### [HAUTE] Aucun ecran pour consulter/gerer les saved searches

**Scenario** : L'utilisateur sauvegarde une recherche via `SaveSearchButton`. Mais aucun ecran dans l'app ne permet de lister, relancer, modifier ou supprimer ses recherches sauvegardees.

**Code** : Les methodes `getSavedSearches()`, `deleteSavedSearch()`, `toggleNotifications()` existent dans le service mais ne sont appelees nulle part dans le UI.

**Impact** : L'utilisateur peut creer des saved searches mais ne peut ni les voir, ni les supprimer, ni desactiver les notifications. Dead-end UX complet.

**Recommandation** : Creer un ecran "Mes recherches sauvegardees" accessible depuis le profil.

---

### [HAUTE] Incoherence du matching couleur entre recherche live et saved search

**Code** :
- Client (`services/articlesService.ts:403-404`) : `ac.toLowerCase().includes(color.toLowerCase())` (fuzzy partial, case-insensitive)
- Cloud Function (`functions/src/scheduled/savedSearches.ts:176-177`) : `articleColors.includes(filterColor)` (strict exact, case-sensitive)

**Impact** : Les notifications rapportent moins de resultats que la recherche live pour le meme filtre.

**Recommandation** : Aligner la logique de matching couleur entre les deux systemes.

---

### [HAUTE] Saved search notifications ne filtrent pas les articles du vendeur

**Code** : `functions/src/scheduled/savedSearches.ts:99-121` -- Aucun filtre `sellerId != userId`. La recherche live a `excludeUserId` (`services/articlesService.ts:384`).

**Impact** : Le vendeur recoit des notifications pour ses propres articles.

**Recommandation** : Ajouter `matchingArticles = matchingArticles.filter(a => a.sellerId !== userId)`.

---

### [MOYENNE] Index collectionGroup manquant pour savedSearches

**Code** : `functions/src/scheduled/savedSearches.ts:38-40` -- `db.collectionGroup('savedSearches').where('notifyNewItems', '==', true)`

Aucun index collectionGroup pour `savedSearches` dans `firestore.indexes.json`.

**Impact** : La requete peut echouer en production ou etre lente.

**Recommandation** : Ajouter l'index dans `firestore.indexes.json` :
```json
{
  "collectionGroup": "savedSearches",
  "queryScope": "COLLECTION_GROUP",
  "fields": [
    { "fieldPath": "notifyNewItems", "order": "ASCENDING" }
  ]
}
```

---

## 3. INDEX FIRESTORE

### [MOYENNE] Index manquant : condition seule + createdAt (sans prix)

**Scenario** : L'utilisateur filtre uniquement par condition "neuf" sans filtre de prix.

L'index existant pour condition exige aussi `price` : `isActive ASC, isSold ASC, condition ASC, price ASC, createdAt DESC`. Sans le filtre prix, cet index ne couvre pas la requete.

**Impact** : Firestore retourne une erreur "missing index" ou utilise un scan complet.

**Recommandation** : Ajouter un index `[isActive ASC, isSold ASC, condition ASC, createdAt DESC]`.

---

### [MOYENNE] Index manquant : categoryIds + condition + price + createdAt

**Scenario** : L'utilisateur filtre par categorie + condition + prix.

Les index existants couvrent chaque paire mais pas la combinaison des trois.

**Impact** : La requete echoue si l'utilisateur combine categorie + condition + prix.

**Recommandation** : Ajouter l'index composite ou restructurer la recherche.

---

### [MOYENNE] Aucun index pour le tri par prix (price_asc, price_desc)

**Code** : `services/articlesService.ts:361` : `constraints.push(orderBy('createdAt', 'desc'))` -- toujours par date, jamais par prix.

Le tri par prix se fait cote client (`services/articlesService.ts:453-458`) sur les N documents de la page courante.

**Impact** : Le tri par prix ne s'applique qu'a la page courante, pas a l'ensemble des resultats. Un article bon marche en page 3 ne sera jamais vu en premier.

**Recommandation** : Quand `sortBy === 'price_asc'`, utiliser `orderBy('price', 'asc')` dans la requete Firestore.

---

## 4. PERFORMANCE

### [HAUTE] Recherche textuelle en O(n) sur le client sans utiliser search_index

**Code** : `services/articlesService.ts:390-395`
```typescript
const searchLower = searchTerm.toLowerCase();
const titleMatch = (article.title || '').toLowerCase().includes(searchLower);
const descMatch = (article.description || '').toLowerCase().includes(searchLower);
const brandMatch = (article.brand || '').toLowerCase().includes(searchLower);
matches = matches && (titleMatch || descMatch || brandMatch);
```

**Impact** :
- Lit 3x plus de documents que necessaire
- Le matching `includes()` est trop simpliste : "pull" matche "manipulation"
- Pas de ranking par pertinence
- Les `keywords` de `search_index` ne sont jamais utilises

**Recommandation** : Migrer vers `search_index` avec `array-contains` sur `keywords`.

---

### [HAUTE] Recherche textuelle -- pas de ranking par pertinence

Les resultats filtres par texte sont retournes dans l'ordre `createdAt DESC`, pas par pertinence de match. Un match dans le titre vaut autant qu'un match au milieu de la description.

**Recommandation** : Utiliser le `popularityScore` de `search_index` et/ou implementer un score de pertinence (titre > marque > description).

---

## 5. COHERENCE FRONT/BACK

### [MOYENNE] Schema doc `firestore-schema.md` inconsistant avec les valeurs reelles de condition

**Code** :
- Schema : `firestore-schema.md:70` : `'tres bon etat'` (sans accents)
- Callable : `functions/src/callable/products.ts:579` : `['neuf', 'tres bon etat', 'bon etat', 'satisfaisant']` (avec accents)
- Search constants : `features/search/constants.ts:7` : `{ value: 'tres bon etat', label: 'Tres bon etat' }` (avec accents)

Les valeurs reelles (callable, rules, search) sont coherentes entre elles (avec accents). Seul le schema doc est faux.

**Recommandation** : Corriger `firestore-schema.md` pour refleter les valeurs avec accents.

---

### [MOYENNE] Debounce du query texte pas connecte au search submit

**Code** : `hooks/useArticleSearch.ts:127-128` -- Debounce 350ms sur `searchQuery`. Mais `features/search/hooks/useSearchScreen.ts:170` -- `handleSearch` appelle `setActiveSearchQuery` sans passer par le debounce.

**Impact** : La recherche peut se declencher deux fois (une par submit, une par debounce).

**Recommandation** : Clarifier le flow : soit toujours par submit (pas de debounce auto), soit toujours auto-trigger par debounce.

---

### [MOYENNE] Pas de deduplication de l'historique de recherche

**Code** : `services/searchHistoryService.ts:43-73` -- `addSearchToHistory` ajoute systematiquement un nouveau document sans verifier les doublons.

**Impact** : L'historique est encombre de doublons. La limite de 20 est atteinte plus vite.

**Recommandation** : Verifier si une recherche identique existe deja et mettre a jour son timestamp au lieu de creer un doublon.

---

## 6. EDGE CASES

### [BASSE] L'historique de recherche ne supporte pas l'update (firestore rules)

**Code** : `firestore.rules:187-196` -- autorise `read`, `create`, `delete`, mais pas `update`.

**Impact** : Bloquant uniquement si la deduplication est implementee.

**Recommandation** : Ajouter `allow update: if isOwner(userId)`.

---

### [BASSE] resultCount jamais passe a l'historique de recherche

**Code** : `features/search/hooks/useSearchScreen.ts:164-166` -- `addSearchToHistory` ne passe pas le 4eme parametre `resultCount`.

**Impact** : Le texte "X articles" dans les recherches recentes ne s'affiche jamais.

**Recommandation** : Passer `articles.length` apres que les resultats arrivent.

---

### [BASSE] useUserLocation est un stub vide sans implementation

**Code** : `hooks/useArticleSearch.ts:324-329` -- Le hook exporte `location` mais ne l'initialise jamais.

**Impact** : La recherche geolocalisee n'est pas fonctionnelle via ce hook.

**Recommandation** : Soit supprimer ce stub, soit l'implementer en reutilisant la logique de `useNearbyArticles`.

---

### [BASSE] Trending searches en dur, pas dynamiques

**Code** : `components/search/RecentSearches.tsx:31-39` -- `TRENDING_SEARCHES` codees en dur.

**Impact** : Les suggestions stagnent. Pas de personnalisation ni de saisonnalite.

**Recommandation** : Stocker dans une collection Firestore ou calculer a partir des recherches recentes.

---

### [BASSE] SearchBar utilise withSpring (interdit par les regles projet)

**Code** : `components/ui/SearchBar.tsx:73,77,91,95` -- `withSpring` au lieu de `withTiming`.

La memoire projet indique : "Pas de withSpring/springify/bounce, toujours withTiming + ease-out".

**Recommandation** : Remplacer `withSpring` par `withTiming` avec easing ease-out.

---

## 7. MAPPING REQUETES -- INDEX

| Requete (articlesService.searchArticles) | Index requis | Existe ? |
|------------------------------------------|-------------|----------|
| `isActive + isSold + createdAt DESC` | Base | OUI |
| `isActive + isSold + categoryIds(contains) + createdAt DESC` | Avec categoryIds | OUI |
| `isActive + isSold + condition + createdAt DESC` | Condition seule | **NON** |
| `isActive + isSold + price >= X + createdAt DESC` | Avec prix range | OUI |
| `isActive + isSold + categoryIds(contains) + condition + createdAt DESC` | Cat + condition | OUI |
| `isActive + isSold + categoryIds(contains) + price >= X + createdAt DESC` | Cat + prix | OUI |
| `isActive + isSold + condition + price >= X + createdAt DESC` | Condition + prix | OUI |
| `isActive + isSold + categoryIds(contains) + condition + price >= X + createdAt DESC` | Cat + condition + prix | **NON** |

---

## 8. RESUME DES RECOMMANDATIONS PRIORITAIRES

1. **P0** : Corriger la pagination avec filtres client-side (curseur sur le mauvais document)
2. **P0** : Corriger savedSearches CF pour interroger `brand` (string) au lieu de `brands` (array inexistant)
3. **P1** : Creer un ecran "Mes recherches sauvegardees"
4. **P1** : Migrer la recherche textuelle vers `search_index` avec `array-contains` sur `keywords`
5. **P1** : Aligner le matching couleur/materiau entre client et Cloud Function
6. **P2** : Ajouter les indexes manquants (condition seule, categoryIds+condition+price)
7. **P2** : Implementer le tri par prix cote Firestore
8. **P2** : Ajouter le filtre `sellerId != userId` dans savedSearches notifications
9. **P3** : Deduplication historique, trending dynamiques, resultCount, schema doc
