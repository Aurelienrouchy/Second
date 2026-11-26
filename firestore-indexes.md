# Required Firestore Indexes for useProducts Hook

## Bank-dispute withdrawal guards (production preparation, 2026-10-09)

`walletWithdraw` reads four targeted queries inside the wallet debit transaction,
each with `limit(201)`. Existing `(sellerId ASC, disputed ASC)` protects commercial
cases. Three composite indexes in `firestore.indexes.json` protect legacy bank
identities and orphaned freezes even when `disputed` was cleared:

- `transactions (sellerId ASC, disputeId ASC)` — `sellerId == uid && disputeId > ''`.
- `transactions (sellerId ASC, disputeFreezeCents ASC)` — `sellerId == uid && disputeFreezeCents > 0`.
- `transactions (sellerId ASC, bankDispute.reconciliationRequired ASC)` —
  `sellerId == uid && bankDispute.reconciliationRequired == true`. Added after
  the independent review to find closed histories even when older projections
  were lost; a local reconciliation requirement remains a financial guard.

Recognized new bank closures delete the legacy `disputeId` projection only when no
local reconciliation is required, while retaining
the historical identity in `bankDispute.id`; a retained commercial hold keeps its
freeze until commercial resolution. A full page fails closed for operator review,
so queries stay bounded. Pre-existing closed legacy identities must be inspected
and their projections cleaned by a separately approved migration when they reach
this threshold. This package executes no migration or deployment.

`retryFailedOperations` rotates a bounded page with
`where status == pending`, `orderBy __name__ ASC`, `startAfter(lastPendingId)` and
`limit(100)`, wrapping once on an empty page. The automatic single-field `status`
index already appends document name ASC, so no composite is added for this query.
Unlike timestamp ordering, document-name ordering includes old operations without
`createdAt` and cannot skip equal timestamps. The server cursor lives in
`job_locks/retryFailedOperations_cursor`.


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

## Report triage queue (`getPendingReports`)

Admin moderation (B3). The `getPendingReports` callable lists open reports,
most-recent first: `where status == 'pending'` + `orderBy createdAt desc`.
Requires a composite index on the `reports` collection.

```json
{
  "collectionGroup": "reports",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "status", "order": "ASCENDING" },
    { "fieldPath": "createdAt", "order": "DESCENDING" }
  ]
}
```

## Open-dispute deletion gate (`deleteUserAccount`)

GDPR Art. 17 / Loi 25. The `deleteUserAccount` callable
(`callable/users.ts`) refuses account deletion while an open dispute is tied to
the user, on either side. It runs two equality-only queries in parallel:

- `disputes where buyerId == uid && status == 'open'` + `limit(1)`
- `disputes where sellerId == uid && status == 'open'` + `limit(1)`

**Two equalities on two distinct fields require a composite index.** Firestore
does NOT auto-merge single-field indexes for two equalities in the same query;
without these composites the queries fail in prod (`FAILED_PRECONDITION`,
"requires an index"). The `limit(1)` and the absence of an `orderBy` do not
remove the requirement. Two composites are needed (one per buyer/seller side):

```json
{
  "collectionGroup": "disputes",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "buyerId", "order": "ASCENDING" },
    { "fieldPath": "status", "order": "ASCENDING" }
  ]
}
```

```json
{
  "collectionGroup": "disputes",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "sellerId", "order": "ASCENDING" },
    { "fieldPath": "status", "order": "ASCENDING" }
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
      "comment": "releaseHeldFunds: swap top-up funds released after the 7-day post-reception window (status == 'completed' + topUpFundsReleaseAt <= now + orderBy topUpFundsReleaseAt asc + cursor)",
      "fields": [
        { "fieldPath": "status", "order": "ASCENDING" },
        { "fieldPath": "topUpFundsReleaseAt", "order": "ASCENDING" }
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
| `transactions` | `status ASC, returnRequestedAt ASC` | **F26** — `expireOrphanedTransactions` route les retours périmés vers admin (`scheduled/transactionExpiration.ts`, `status == 'return_requested'` + `returnRequestedAt <`) |
| `transactions` | `status ASC, disputedAt ASC` | **B9** — `alertAgingDisputes` (`scheduled/swaps.ts`, `status == 'disputed'` + `disputedAt <` cutoff 5j) |
| `swaps` | `status ASC, topUpFundsReleaseAt ASC` | `releaseHeldFunds` swap top-up sweep (`scheduled/releaseHeldFunds.ts`, `status == 'completed'` + `topUpFundsReleaseAt <= now` + `orderBy topUpFundsReleaseAt asc` + cursor) |
| `swaps` | `status ASC, disputeOpenedAt ASC` | **B9** — `alertAgingDisputes` (`scheduled/swaps.ts`, `status == 'disputed'` + `disputeOpenedAt <` cutoff 5j) |
| `swaps` | `status ASC, updatedAt ASC` | **F51/F52** — `expireStalePostAcceptanceSwaps` (`scheduled/swaps.ts`, `status == 'accepted'\|'photos_pending'\|'shipping'` + `updatedAt <` cutoff 14j) |
| `transactions` | `labelCreationPending ASC, status ASC, createdAt ASC` | `sweepPendingLabels` (`scheduled/sweepPendingLabels.ts`, `labelCreationPending == true` + `status == 'paid'` + `orderBy createdAt asc`) |
| `transactions` | `sellerId ASC, disputed ASC` | listing des litiges vendeur ouverts (blocage retrait) |
| `withdrawal_requests` | `status ASC, createdAt ASC` | `reconcileFinances` payouts bloqués (`scheduled/reconcile.ts`, `status == 'processing'` + `createdAt <`) |
| `withdrawal_requests` | `userId ASC, createdAt DESC` | Portefeuille : historique récent des retraits du propriétaire (`features/wallet/services/walletService.ts`, `getWithdrawalRequests`) |
| `withdrawal_requests` | `userId ASC, status ASC` | **F89** — gate suppression de compte (`callable/users.ts`, `userId == uid && status == 'processing'` + `limit(1)`) |
| `disputes` | `transactionId ASC, status ASC` | **F27/F88** — `resolveDispute` + `adminRefundTransaction` ferment les litiges liés (`callable/payments.ts`, `transactionId == txId && status == 'open'`) |

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
- **Recours acheteur (B2/B3)** : `requestReturn` / `reportTransactionProblem` /
  `requestRefund` (`callable/recourse.ts`) et `processReturnDelivered`
  (`utils/returnRefund.ts`) ne font que des accès `doc(id)` directs — aucune
  requête `where`/`orderBy`.

  > **MISE À JOUR (vague 4 — rail de résolution)** : l'affirmation historique
  > « `withdrawal_requests userId ==` est mono-champ → index auto-créé » est
  > **obsolète** pour la gate F89 : `deleteUserAccount` interroge désormais
  > `userId == uid && status == 'processing'` (deux égalités) → index composite
  > `userId ASC, status ASC` ajouté ci-dessus. De même, le poller des retours
  > périmés (F26) filtre `status == 'return_requested' && returnRequestedAt <`
  > (inégalité sur un champ différent du `==`) → index composite
  > `status ASC, returnRequestedAt ASC` ajouté (l'ancien `status + createdAt` ne
  > couvre pas une inégalité sur `returnRequestedAt`).

  > **MISE À JOUR (gate suppression de compte)** : l'affirmation historique
  > « la collection `disputes` n'est jamais listée → aucun index requis » est
  > désormais **obsolète**. Le fix de `deleteUserAccount` interroge `disputes`
  > avec deux égalités (`buyerId == uid && status == 'open'` et
  > `sellerId == uid && status == 'open'`), ce qui exige deux index composites.
  > Voir la section « Open-dispute deletion gate (`deleteUserAccount`) » plus
  > haut.

## Boutiques — articles d'une boutique (`getShopArticles`)

> Source de vérité = `firestore.indexes.json`. Déploiement manuel :
> `firebase deploy --only firestore:indexes` (JAMAIS `--force` : la prod a des
> orphelins absents du local, dont des fonctions financières).

`ShopService.getShopArticles` (`services/shopService.ts`) liste les articles
actifs et non vendus d'une boutique :
`where shopId == X && isActive == true && isSold == false` (trois égalités, sans
`orderBy`). Trois égalités sur trois champs distincts exigent un index composite
(Firestore ne fusionne pas les index mono-champ pour des égalités multiples).
`Article.shopId` est renseigné à la création par `createArticle`
(`functions/src/callable/products.ts`, champ posé uniquement si une boutique
approuvée est liée — jamais `undefined`).

```json
{
  "collectionGroup": "articles",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "shopId", "order": "ASCENDING" },
    { "fieldPath": "isActive", "order": "ASCENDING" },
    { "fieldPath": "isSold", "order": "ASCENDING" }
  ]
}
```

### Index volontairement NON ajoutés (audit P1 recherche / messagerie)

Pour éviter des index orphelins, seuls les index réellement consommés par les
voies retenues sont créés :

- **P1-3 recherche par marque** : aucune requête `articles` /
  `search_index` n'utilise `brands array-contains` (voie 100 % filtre mémoire
  retenue, cf. `functions/src/callable/search.ts`). Pas d'index
  `isActive + isSold + brands CONTAINS + createdAt DESC`.
- **P1-4 recherche par boutique côté recherche** : la recherche n'interroge pas
  `articles` par `sellerId` (`search.ts` filtre sur `isActive` / `categoryIds` /
  `priceRange`, le reste client-side). Pas de composites
  `sellerId + isActive + isSold + (categoryIds|condition|price) + createdAt`.
- **Tri messagerie** : `ChatService.listenToUserChats`
  (`services/chatService.ts`) trie par `orderBy('updatedAt', 'desc')`, déjà servi
  par l'index existant `chats { participants CONTAINS, updatedAt DESC }`. Aucune
  requête ne trie `chats` par `lastMessageTimestamp` (ce champ n'est lu que pour
  l'affichage, `app/(tabs)/messages.tsx`). Pas d'index
  `chats { participants CONTAINS, lastMessageTimestamp DESC }`.

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

### Paquet 2 — projection de remboursement actif

Index composite ajouté à la source de vérité `firestore.indexes.json` :
`transactions: sellerId ASC, refundBlocked ASC`. Query exacte sous la transaction
de retrait : `where(sellerId == uid).where(refundBlocked == true).limit(201)`.
La cinquième projection rejoint les quatre gardes bancaires/commerciales du paquet 1.
201 résultats constituent une garde fail-closed ; les nouvelles intentions soldées
passent refundBlocked=false et ne grossissent pas une liste historique active.

Le watcher utilise `where(refund.watch == true).orderBy(__name__).limit(100)`,
puis `startAfter(lastId)` et rotation. Le filtre unique et l’ordre de nom utilisent
l’index simple Firestore (aucun deuxième filtre/orderBy métier). Les listes de
ledger sont scopées au wallet + transactionId ; les litiges sont cherchés par
transactionId. Aucune nouvelle recherche globale d’historique par vendeur.

Aucun index/règle/function n’a été déployé. L’index composite doit être provisionné
avant exposition d’un rail financier ; les flags restent fermés.

### Raccord RN remboursements / historique privé — 2026-10-10

Source vérifiée : `PACKAGE_REFUND_UI_QUERY_CONTRACT.md` et services RN figés par SHA.
Ajout de **5 composites COLLECTION**, sans changer les83 définitions ni les4
fieldOverrides préexistants (snapshot `PACKAGE_REFUND_QUERY_INDEXES_BEFORE.json`).

| Query réelle | Définition ajoutée dans firestore.indexes.json |
|---|---|
| Latest datée acheteur : buyerId==uid,chatId==chat,createdAt DESC,name DESC,limit1 | buyerId ASC,chatId ASC,createdAt DESC,__name__ DESC |
| Latest datée vendeur : sellerId==uid,chatId==chat,createdAt DESC,name DESC,limit1 | sellerId ASC,chatId ASC,createdAt DESC,__name__ DESC |
| Historique acheteur : buyerId==uid,chatId==chat,name DESC,limit50,startAfter(id) | buyerId ASC,chatId ASC,__name__ DESC |
| Historique vendeur : sellerId==uid,chatId==chat,name DESC,limit50,startAfter(id) | sellerId ASC,chatId ASC,__name__ DESC |
| Litiges ouverts : status==open,name DESC,limit50,startAfter(id) | disputes: status ASC,__name__ DESC |

Les anciens buyer/seller+createdAt n'ajoutent pas chatId ; les anciens
buyer/seller+chatId+status introduisent un champ absent des nouvelles queries et
ne couvrent pas leur historique sans filtre de statut. Les requêtes datées ont
deux égalités et un tri créé ; l'ordre final de nom DESC correspond au tri date
DESC et est explicité dans les nouveaux indexes. Pour les définitions d'égalité
ASC de l'historique et de status, le nom DESC diffère du nom ASC implicite : son
sens est déclaré. Cette justification découle du contrat/planification documentée,
**pas du succès d'un émulateur qui n'impose pas les composites**.
[Ordre de nom Firebase](https://firebase.google.com/docs/firestore/query-data/index-overview#default_ordering_and_the__name__field).

Pas de composite supplémentaire pour les shapes suivantes :

- Offre : buyerId/chatId/offerMessageId==valeurs,name ASC,limit2 : fusion
  d'égalités simples avec leur nom ASC par défaut.
- Captures : type==payment_capture_reconciliation,status==pending,name ASC,
  limit50 : même fusion d'égalités, sans tri d'un autre champ métier.
- Refund OR13 : refundBlocked==true OR refundLegacyReconciliationRequired==true
  OR refund.state IN8 OR status IN3, puis name ASC,limit50. Chaque branche DNF
  est une égalité unique avec nom ASC ; les indexes simples des quatre champs
  sont activés dans ce manifeste, sans exemption wildcard ni de map refund.
- Compte : buyerId|sellerId==uid,name ASC,limit201 : index simple ASC.

La fusion et les indexes simples automatiques sont documentés par
[Firebase — index merging](https://firebase.google.com/docs/firestore/query-data/index-overview#use_index_merging).
**Hypothèse de configuration réelle non vérifiée** : pas d'exemption/index simple
désactivé hors manifeste dans la base de production. L'édition réelle, l'existence
et la préparation des indexes production ne sont pas certifiées ; credentials
expirés, pas de login, interrogation nouvelle de production ou déploiement.

**Raccord complet FAIL local conservé** : l'onglet Tous exécute disputes avec
`orderBy(__name__,DESC)` seul. Le vrai SDK Web reçoit FAILED_PRECONDITION,
« Firestore does not support descending key scans », aussi dans une repro minimale
limit1. Aucun faux composite de nom seul n'est créé. Le candidat nom ASC pagine
55 documents (dates présentes/absentes) localement ; seule la prochaine tâche RN
peut changer la source, puis rejouer ce contrat. Ce test rouge ne prouve pas à lui
seul que production échoue, ni qu'il s'agit exclusivement d'un bug émulateur.
Voir `PACKAGE_REFUND_QUERY_BRIDGE.md` et SDK_WEB_FINAL.log.

#### Reprise courante ALL/ASC V2 — 2026-10-10

Le FAIL ci-dessus reste historique pour le shape V1. Le propriétaire RN a changé
seulement le tri de l'onglet Tous en `__name__ ASC`, avec limit50 et cursor dernier
ID ASC ; Ouverts conserve status=open/name DESC. Le vrai SDK Web/règles rejoue
maintenant **50+5 dossiers,55 uniques**, dates absentes/égales, curseur exact et
confidentialité. Les tests du raccord courant sont verts (30 total, dont7 assertions
manifeste,22 acceptances SDK et1 diagnostic historique DESC distinct).

Aucun index ajouté/modifié à cette reprise : les83 anciens +5 du bridge V1 et4
fieldOverrides sont inchangés. Tous/name ASC seul utilise l'ordre de nom simple
par défaut. Le refus DESC nu demeure reproduit en diagnostic ; ce n'est pas un
succès du produit corrigé. La qualification du lot reste **PASS LOCAL borné** aux
shapes actuels testés, avant revue indépendante, sans preuve d'indexes production
READY ni de données historiques homogènes. Rapport PACKAGE_REFUND_QUERY_BRIDGE_V2.md,
gel SOURCE_FREEZE_V2.sha256 et log SDK_WEB_V2.log sous production-readiness.

### Admission 03A — requêtes privées bornées (2026-10-10)

Aucun composite ajouté. Manifeste 83 anciens +5 du bridge,4 overrides conservé.

| Callable | Shape exacte |
|---|---|
| listMyEligibilityReviews | eligibility_requests, ownerId==UID auth, name ASC, limit50, startAfter(ID) optionnel |
| listAdminEligibilityReviews sans status | eligibility_requests, status IN submitted/needs_information, name ASC, limit50, startAfter(ID) optionnel |
| listAdminEligibilityReviews avec status | eligibility_requests, status==valeur autorisée, name ASC, limit50, startAfter(ID) optionnel |

Chaque filtre est une égalité simple (ou ses deux branches IN), avec ordre de nom
ASC implicite du simple ASC. Pas de tri chronologique ni de filtre sur réception,
échéance ou note. Pas de composite requis par ces shapes selon
[Firebase — ordre de nom](https://firebase.google.com/docs/firestore/query-data/index-overview#default_ordering_and_the__name__field).
Hypothèse : indexes simples ownerId/status non désactivés hors manifeste ; état de
la production non interrogé/non certifié. SDK Admin demo-second Standard a exécuté
réellement ces requêtes (55 dossiers owner, dates absentes/égales, pages50+5 ;
admin pages50+6). L'émulateur ne prouve pas les composites production READY.

Les propriétaires ne peuvent pas reproduire ces requêtes avec le SDK client :
documents mixtes privés admin-only ; le serveur filtre et retourne les DTO sûrs.


### Phase 1 — partitions locales initiales (25 novembre 2026)

Deux composites ajoutés au manifeste : swaps(status, localAgreementWitness.protocol, localAgreementWitness.installationId, localAgreementWitness.epoch, createdAt ASC) et messages(phase1Contract, phase1Source.installationId, phase1Source.epoch, type, offer.status, offer.expiresAt ASC). Les égalités lient le job au contrôle et à son epoch ; seules les propositions jamais acceptées peuvent expirer. READY cloud doit être vérifié avant ouverture ; les émulateurs ne prouvent pas cet état.
# Historique de recherche V1 — 25 novembre 2026

`searchHistory.timestamp` conserve `ASCENDING / COLLECTION_GROUP` pour la rétention et ajoute `DESCENDING / COLLECTION` pour `users/{uid}/searchHistory`, son affichage, la déduplication et le nettoyage des entrées anciennes. Le précédent override ne conservait que le groupe et désactivait ce tri local. Ajout Dev ciblé au seul champ, sans suppression d'index ni changement TTL/règles ; aucune lecture de l'historique des membres.

