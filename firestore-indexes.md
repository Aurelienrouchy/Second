# Required Firestore Indexes for useProducts Hook

## Data-retention purge indexes (`retentionPurge`)

Added for the daily `retentionPurge` scheduled function (Loi 25 / RGPD):

- Composite index on `articles` — `(isActive ASC, updatedAt ASC)` — purge of
  inactive articles older than 3 years (`where isActive == false && updatedAt < cutoff`).
- Collection-group single-field index on `searchHistory.timestamp` (ASC,
  `COLLECTION_GROUP` scope) — purge of search-history entries older than 12
  months via `collectionGroup('searchHistory')`.

`guest_preferences` and `notifications` purges use single-field range queries on
`createdAt` only (automatic single-field index — no composite index required).

```json
{
  "collectionGroup": "articles",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "isActive", "order": "ASCENDING" },
    { "fieldPath": "updatedAt", "order": "ASCENDING" }
  ]
}
```

```json
// fieldOverrides entry
{
  "collectionGroup": "searchHistory",
  "fieldPath": "timestamp",
  "indexes": [
    { "order": "ASCENDING", "queryScope": "COLLECTION_GROUP" }
  ]
}
```

`drafts` purge (`updatedAt < cutoff` + `orderBy updatedAt`) is a single-field
range query — automatic single-field index, no composite index required.

## Automated-decision transparency log (`getAutomatedDecisionLog`)

Loi 25 art. 12.1. The `getAutomatedDecisionLog` callable queries one
transaction's automated-decision log entries, most-recent first:
`where transactionId == X` + `orderBy executedAt desc`. Requires a composite
index.

```json
{
  "collectionGroup": "automatic_decisions_log",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "transactionId", "order": "ASCENDING" },
    { "fieldPath": "executedAt", "order": "DESCENDING" }
  ]
}
```

## Composite Indexes

Add these indexes to your `firestore.indexes.json` file or create them in the Firebase Console:

```json
{
  "indexes": [
    {
      "collectionGroup": "avis",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "vendeurId", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "avis",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "reviewerId", "order": "ASCENDING" },
        { "fieldPath": "transactionId", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "articles",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "sellerId", "order": "ASCENDING" },
        { "fieldPath": "isActive", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "articles",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "sellerId", "order": "ASCENDING" },
        { "fieldPath": "isActive", "order": "ASCENDING" },
        { "fieldPath": "isSold", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "articles",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "sellerId", "order": "ASCENDING" },
        { "fieldPath": "isSold", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "articles",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "isActive", "order": "ASCENDING" },
        { "fieldPath": "isSold", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "articles",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "isActive", "order": "ASCENDING" },
        { "fieldPath": "isSold", "order": "ASCENDING" },
        { "fieldPath": "categoryIds", "arrayConfig": "CONTAINS" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "articles",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "isActive", "order": "ASCENDING" },
        { "fieldPath": "isSold", "order": "ASCENDING" },
        { "fieldPath": "categoryIds", "arrayConfig": "CONTAINS" },
        { "fieldPath": "condition", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "articles",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "isActive", "order": "ASCENDING" },
        { "fieldPath": "isSold", "order": "ASCENDING" },
        { "fieldPath": "categoryIds", "arrayConfig": "CONTAINS" },
        { "fieldPath": "price", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "articles",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "isActive", "order": "ASCENDING" },
        { "fieldPath": "isSold", "order": "ASCENDING" },
        { "fieldPath": "categoryIds", "arrayConfig": "CONTAINS" },
        { "fieldPath": "condition", "order": "ASCENDING" },
        { "fieldPath": "price", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "articles",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "isActive", "order": "ASCENDING" },
        { "fieldPath": "isSold", "order": "ASCENDING" },
        { "fieldPath": "categoryIds", "arrayConfig": "CONTAINS" },
        { "fieldPath": "price", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "articles",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "isActive", "order": "ASCENDING" },
        { "fieldPath": "isSold", "order": "ASCENDING" },
        { "fieldPath": "price", "order": "DESCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "articles",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "isActive", "order": "ASCENDING" },
        { "fieldPath": "isSold", "order": "ASCENDING" },
        { "fieldPath": "condition", "order": "ASCENDING" },
        { "fieldPath": "price", "order": "DESCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "articles",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "isActive", "order": "ASCENDING" },
        { "fieldPath": "isSold", "order": "ASCENDING" },
        { "fieldPath": "categoryIds", "arrayConfig": "CONTAINS" },
        { "fieldPath": "price", "order": "DESCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "articles",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "isActive", "order": "ASCENDING" },
        { "fieldPath": "isSold", "order": "ASCENDING" },
        { "fieldPath": "categoryIds", "arrayConfig": "CONTAINS" },
        { "fieldPath": "condition", "order": "ASCENDING" },
        { "fieldPath": "price", "order": "DESCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "articles",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "isActive", "order": "ASCENDING" },
        { "fieldPath": "isSold", "order": "ASCENDING" },
        { "fieldPath": "condition", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "articles",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "isActive", "order": "ASCENDING" },
        { "fieldPath": "isSold", "order": "ASCENDING" },
        { "fieldPath": "price", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "articles",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "isActive", "order": "ASCENDING" },
        { "fieldPath": "isSold", "order": "ASCENDING" },
        { "fieldPath": "lastPriceDropAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "articles",
      "queryScope": "COLLECTION", 
      "fields": [
        { "fieldPath": "isActive", "order": "ASCENDING" },
        { "fieldPath": "isSold", "order": "ASCENDING" },
        { "fieldPath": "category", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "articles",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "isActive", "order": "ASCENDING" },
        { "fieldPath": "isSold", "order": "ASCENDING" },
        { "fieldPath": "condition", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "articles",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "isActive", "order": "ASCENDING" },
        { "fieldPath": "isSold", "order": "ASCENDING" },
        { "fieldPath": "price", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "articles",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "isActive", "order": "ASCENDING" },
        { "fieldPath": "isSold", "order": "ASCENDING" },
        { "fieldPath": "category", "order": "ASCENDING" },
        { "fieldPath": "condition", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "articles",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "isActive", "order": "ASCENDING" },
        { "fieldPath": "isSold", "order": "ASCENDING" },
        { "fieldPath": "category", "order": "ASCENDING" },
        { "fieldPath": "price", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "articles",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "isActive", "order": "ASCENDING" },
        { "fieldPath": "isSold", "order": "ASCENDING" },
        { "fieldPath": "condition", "order": "ASCENDING" },
        { "fieldPath": "price", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "articles",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "sellerId", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "transactions",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "status", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "transactions",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "status", "order": "ASCENDING" },
        { "fieldPath": "fundsReleaseAt", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "transactions",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "sellerId", "order": "ASCENDING" },
        { "fieldPath": "disputed", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "transactions",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "labelCreationPending", "order": "ASCENDING" },
        { "fieldPath": "status", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "withdrawal_requests",
      "queryScope": "COLLECTION",
      "comment": "reconcileFinances: withdrawals stuck 'processing' past createdAt cutoff (lost payout webhook)",
      "fields": [
        { "fieldPath": "status", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "swaps",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "status", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "swaps",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "partyId", "order": "ASCENDING" },
        { "fieldPath": "status", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "swapPartyItems",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "partyId", "order": "ASCENDING" },
        { "fieldPath": "articleId", "order": "ASCENDING" },
        { "fieldPath": "sellerId", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "messages",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "type", "order": "ASCENDING" },
        { "fieldPath": "offer.status", "order": "ASCENDING" },
        { "fieldPath": "offer.expiresAt", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "messages",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "chatId", "order": "ASCENDING" },
        { "fieldPath": "type", "order": "ASCENDING" },
        { "fieldPath": "offer.status", "order": "ASCENDING" }
      ]
    }
  ],
  "fieldOverrides": []
}
```

## Search + Filters fix (audit AUDIT_SEARCH_FILTERS.md — H2/H3/C2)

> Source de vérité = `firestore.indexes.json`. À déployer manuellement :
> `firebase deploy --only firestore:indexes` (JAMAIS `--force` : la prod a des
> orphelins absents du local).

Index ajoutés par le fix recherche+filtres :

`articles` (tri Prix décroissant + secondaire `createdAt DESC`, requis par le
chemin `searchViaArticles` corrigé) :
- `isActive + isSold + price DESC + createdAt DESC`
- `isActive + isSold + condition + price DESC + createdAt DESC`
- `isActive + isSold + categoryIds CONTAINS + price DESC + createdAt DESC`
- `isActive + isSold + categoryIds CONTAINS + condition + price DESC + createdAt DESC`

Les variantes `price ASC + createdAt DESC` (utilisées par C2 quand une fourchette
de prix est présente, et par les tris recent/price_asc) existaient déjà.

`search_index` (tri Populaire + filtre État, sans terme texte) :
- `isActive + isSold + condition + popularityScore DESC`

Sur le chemin recherche TEXTE, le seul index serveur utilisé reste
`keywords CONTAINS + popularityScore DESC` (déjà présent) : l'ordre est toujours
`popularityScore DESC` et tous les autres filtres sont appliqués client-side.

## Paiement / Livraison — indexes des jobs scheduled & callables (P1/P2)

> Source de vérité = `firestore.indexes.json`. Déploiement manuel :
> `firebase deploy --only firestore:indexes` (JAMAIS `--force` : la prod a des
> orphelins absents du local, dont des fonctions financières).

Chaque index ci-dessous est requis par une requête réelle (vérifiée dans le code
des chantiers paiement/livraison). Tous sont déjà présents dans
`firestore.indexes.json`.

| Collection | Index composite | Requête servie (fichier) |
| --- | --- | --- |
| `transactions` | `status ASC, createdAt ASC` | `checkShippedTracking` pagination par statut (`scheduled/trackingCheck.ts`, `status == 'label_created'\|'shipped'\|'return_requested'` + `orderBy createdAt asc` + cursor) ; `reconcileFinances` lost-PI (`scheduled/reconcile.ts`, `status == 'pending_payment'` + `createdAt <`) ; `transactionExpiration` (`status == X` + `createdAt <`) |
| `transactions` | `status ASC, fundsReleaseAt ASC` | `releaseHeldFunds` (`scheduled/releaseHeldFunds.ts`, `status == 'delivered'` + `fundsReleaseAt <= now` + `orderBy fundsReleaseAt asc` + cursor) |
| `transactions` | `labelCreationPending ASC, status ASC, createdAt ASC` | `sweepPendingLabels` (`scheduled/sweepPendingLabels.ts`, `labelCreationPending == true` + `status == 'paid'` + `orderBy createdAt asc`) |
| `transactions` | `sellerId ASC, disputed ASC` | listing des litiges vendeur ouverts (blocage retrait) |
| `withdrawal_requests` | `status ASC, createdAt ASC` | `reconcileFinances` payouts bloqués (`scheduled/reconcile.ts`, `status == 'processing'` + `createdAt <`) |

### Requêtes SANS index composite (volontairement non ajoutées)

- `failed_operations` (`scheduled/retryFailedOperations.ts`) : filtre d'égalité
  UNIQUE `status == 'pending'` + `limit()`, **sans** `orderBy`. Un index
  mono-champ (auto-créé) suffit ; le backoff est filtré côté serveur en mémoire.
  Aucun index `status + createdAt` n'est créé pour éviter un index orphelin.
- `transactions status + shippedAt` : **aucune requête n'utilise `shippedAt`**.
  Le poller `checkShippedTracking` trie par `createdAt`, pas `shippedAt`. Pas
  d'index ajouté (orphelin évité).
- `wallets/{uid}/ledger` (`callable/wallet.ts`) : `orderBy createdAt desc` sur une
  sous-collection mono-champ → index auto-créé, pas de composite requis.
- `withdrawal_requests userId ==` (`callable/users.ts`, suppression de compte) :
  égalité mono-champ → index auto-créé.
- **Recours acheteur (B2/B3)** : `requestReturn` / `reportTransactionProblem` /
  `requestRefund` (`callable/recourse.ts`) et `processReturnDelivered`
  (`utils/returnRefund.ts`) ne font que des accès `doc(id)` directs — aucune
  requête `where`/`orderBy`. La collection `disputes` est uniquement écrite en
  `.doc()` (création server-only), jamais listée → aucun index `disputes` requis.
  Le poller `return_requested` réutilise l'index existant `transactions` (`status
  ASC, createdAt ASC`) — **aucun nouvel index n'est ajouté** par ce chantier.

## Single Field Indexes (Auto-created)

These are automatically created by Firestore:
- `isActive` (ascending/descending)
- `isSold` (ascending/descending) 
- `category` (ascending/descending)
- `condition` (ascending/descending)
- `price` (ascending/descending)
- `createdAt` (ascending/descending)
- `sellerId` (ascending/descending)

## Firebase CLI Commands

Deploy indexes using Firebase CLI:

```bash
# Deploy indexes
firebase deploy --only firestore:indexes

# Check index status
firebase firestore:indexes

# Delete unused indexes
firebase firestore:indexes:delete
```

## Performance Considerations

1. **Geolocation Queries**: The current implementation fetches more documents and sorts client-side. For better performance at scale, consider:
   - Using GeoFirestore library for geo-queries
   - Pre-calculating distance ranges in document fields
   - Using Algolia or Elasticsearch for complex geo-search

2. **Real-time Listeners**: Limited to top 10 items to minimize bandwidth and costs.

3. **Client-side Filtering**: Brand, size, and color filters are applied client-side since they require partial string matching.

## Required Article Document Structure

Ensure your articles collection documents have this structure:

```typescript
{
  id: string,
  title: string,
  price: number,
  category: string,
  condition: 'neuf' | 'très bon état' | 'bon état' | 'satisfaisant',
  isActive: boolean,
  isSold: boolean,
  createdAt: Timestamp,
  sellerId: string,
  sellerName: string,
  sellerImage?: string,
  images: ArticleImage[],
  location?: {
    lat: number,
    lon: number,
    address?: string
  },
  // Optional fields for filtering
  brand?: string,
  size?: string,
  color?: string,
  material?: string,
  pattern?: string,
  deliveryOption?: 'pickup' | 'shipping' | 'both'
}
```

## Security Rules

Add these Firestore security rules:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /articles/{articleId} {
      // Allow read for active, non-sold articles
      allow read: if resource.data.isActive == true && resource.data.isSold == false;
      
      // Allow write only for authenticated users and their own articles
      allow create: if request.auth != null && request.auth.uid == resource.data.sellerId;
      allow update: if request.auth != null && request.auth.uid == resource.data.sellerId;
      allow delete: if request.auth != null && request.auth.uid == resource.data.sellerId;
    }
  }
}
```



