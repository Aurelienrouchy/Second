# Audit #15 — UX résultats de recherche et pages de listing

**Date** : 2026-05-26 | **Incohérences** : 20 (4C, 5H, 8M, 3B)

## Résumé

FlashList grille 2 colonnes avec pagination infinie. Critiques : pagination cassée avec filtres client-side, filtres laissent passer les articles sans la propriété, filtre couleur ignore `colors` array, requête Firestore s'exécute sans recherche active.

## Incohérences

### CRITIQUES

1. **Pagination cassée avec filtres client-side** — `articlesService.ts:447-449` : le curseur `lastVisible` pointe vers le dernier doc filtré, pas le dernier doc Firestore. Des dizaines d'articles sont sautés.
2. **Filtres laissent passer les articles sans propriété** — si `article.color` est undefined, le bloc if est skippé et `matches` reste true. L'article sans couleur passe le filtre "rouge".
3. **Filtre couleur ignore `colors` array** — `articlesService.ts:396` vérifie uniquement `article.color` (singulier).
4. **Requête Firestore au mount sans recherche** — `useArticleSearch.ts:168-195` : `useInfiniteQuery` sans `enabled`. Chaque ouverture de l'écran déclenche un fetch inutile.

### HAUTES

5. `hasActiveFilters` toujours true — `sortBy: 'recent'` rend `!!filters.sortBy` toujours true.
6. Aucun indicateur "vendu" sur ProductCard — pas de prop `isSold`, pas d'overlay.
7. Pas de pull-to-refresh sur la recherche — `ProductGrid` supporte `onRefresh` mais pas passé.
8. Double tri articles — service ET hook trient les mêmes articles.
9. Option "Populaire" dans le type mais absente de l'UI.

### MOYENNES

10. Recherche textuelle limitée au titre uniquement.
11. Accents manquants dans les labels filtres.
12. Format $ inconsistant entre chips ("45$") et cartes ("45 $").
13. Aucune validation inputs prix (NaN, négatif, min > max).
14. `useToggleFavorite` provoque re-renders cascade sur toutes les ProductCard.
15. Largeur cartes calculée une fois au module-load (pas responsive rotation/split-view).
16. Aucune accessibilité sur filter chips et barre de recherche.
17. FlashList `visual-search-results` sans `estimatedItemSize`.

### BASSES

18. `SaveSearchButton` existe mais non intégré.
19. `ArticleGridItem` utilise `withSpring` (convention no-spring).
20. Recherches récentes non fonctionnelles pour les guests.

## Fichiers clés

- `app/search.tsx`, `app/visual-search-results.tsx`
- `features/search/hooks/useSearchScreen.ts`, `features/search/constants.ts`
- `features/search/components/` (SearchHeader, FilterChipsRow, PriceRangeInputs)
- `hooks/useArticleSearch.ts`, `services/articlesService.ts`
- `components/ProductGrid.tsx`, `components/ProductCard.tsx`
- `components/ProductCard.constants.ts`
- `hooks/useFavorites.ts`
- `features/user-profile/components/ArticleGridItem.tsx`
