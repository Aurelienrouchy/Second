# Audit #12 — Cycle de vie complet d'une SwapZone

**Date** : 2026-05-26 | **Incohérences** : 15 (3C, 5H, 5M, 2B)

## Résumé

Critiques : photos jamais uploadées vers Storage, articles échangés jamais marqués vendus/inactifs dans la collection `articles`, cash top-up proposé dans l'UI mais jamais collecté.

## Incohérences

### CRITIQUES

1. **Photos swap = URIs locales** — `swap/[id].tsx:193-194` : `asset.uri` (file:///...) passé directement à `uploadSwapPhotos` CF.
2. **Articles jamais marqués échangés** — `confirmSwapReception` (`swaps.ts:1283-1321`) ne met jamais à jour `articles/{id}`. Un article échangé reste visible et achetable.
3. **Cash top-up non collecté** — UI pour saisir un complément monétaire, stocké dans Firestore, mais aucun PaymentIntent Stripe.

### HAUTES

4. Statut `disputed` inaccessible — défini dans les types mais aucune transition n'y mène.
5. `creatorId` absent des SwapParties — rule d'update bloquée.
6. `confirmSwapShipping` sans validation statut.
7. Aucune déduplication d'article.
8. Suppression compte ne décrémente pas les compteurs de SwapParty.

### MOYENNES

9. `swapsCount` non-atomique (read-then-write).
10. Propagation nom/image utilisateur absente pour les entités swap.
11. Format dollar américain (`$X`) dans les composants swap.
12. Header SwapParty n'affiche pas `ended`.
13. Aucun historique des SwapParties terminées.

### BASSES

14. Pas de protection double-tap sur les boutons d'action.
15. Initiateur d'un swap `proposed` voit une page vide.

## Fichiers clés

- `functions/src/callable/swaps.ts`, `functions/src/scheduled/swaps.ts`
- `functions/src/triggers/swaps.ts`, `functions/src/triggers/users.ts`
- `app/swap/[id].tsx`, `app/swap-party/[id].tsx`, `app/propose-swap.tsx`
- `features/swap/components/SwapActions.tsx`
- `features/propose-swap/components/ValueComparisonBox.tsx`
- `components/swap/ValueDifferenceBox.tsx`
- `types/index.ts`
