# Audit #07 — Gestion des produits existants

**Date** : 2026-05-26 | **Incohérences** : 15 (1C, 5H, 6M, 3B)

## Résumé

Machine à états article : le toggle vendu depuis "Mes articles" est cassé (bloqué par Firestore rules), l'édition se fait sans validation serveur, les baisses de prix ne mettent pas à jour les champs price-drop, le soft-delete ne nettoie pas les offres.

## Incohérences

### CRITIQUE

1. **Toggle isSold depuis my-articles bloqué par rules** — `my-articles.tsx:79` fait `updateDoc({isSold})` mais `firestore.rules:123` bloque. Le cache optimiste met à jour l'UI mais Firestore rejette. Comparé à `useArticleActions.ts:232` qui utilise correctement le callable `toggleArticleSold`.

### HAUTES

2. Édition non bloquée pour articles vendus.
3. Édition 100% client-side sans validation serveur (contourne la sanitisation de `createArticle`).
4. Changement de prix ne met pas à jour les champs price-drop (`originalPrice`, `priceDropPercent`, `lastPriceDropAt`).
5. Soft-delete ne nettoie pas les offres pending (contrairement à `onArticleSold` qui les expire).
6. Photos non éditables après publication.

### MOYENNES

7. FlashList `my-articles` sans `estimatedItemSize`.
8. Articles vendus dans les favoris sans badge "Vendu".
9. `checkout/meetup.tsx` lit l'article directement Firestore, bypass `ArticlesService`.
10. Rules Firestore pour collection `products` — code mort.
11. `ArticlesService.markAsSold` — méthode morte qui échouerait si appelée.
12. Suppression compte supprime `seller_balance` sans vérifier le solde.

### BASSES

13. Pas de filtre ni tri dans "Mes articles".
14. Pas de protection double-tap sur "Enregistrer" dans l'édition.
15. Écran édition utilise `useUser` du shim legacy.

## Machine à états — résumé

| Transition | Implémentation | Status |
|------------|---------------|--------|
| publié → vendu (detail) | callable `toggleArticleSold` | OK |
| publié → vendu (mes articles) | `updateDoc` client | **CASSÉ** |
| publié → supprimé | `updateDoc {isActive: false}` | OK mais offres non expirées |
| vendu → édité | aucun blocage | Devrait être bloqué |
| publié → édité (prix baisse) | `updateDoc` client | price-drop non mis à jour |

## Fichiers clés

- `app/my-articles.tsx`, `app/article/edit/[id].tsx`
- `services/articlesService.ts`, `features/article/hooks/useArticleActions.ts`
- `functions/src/callable/products.ts`, `functions/src/triggers/articles.ts`
- `firestore.rules`, `components/ProductCard.tsx`
