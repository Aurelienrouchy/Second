# Audit #13 — Recherche textuelle et filtres

**Date** : 2026-05-26 | **Incohérences** : 11 (0C, 2H, 6M, 3B)

## Résumé

Recherche Firestore direct avec filtrage client-side par `String.includes()` sur le titre uniquement. Le `search_index` Firestore (keywords, bigrams, prefixes) est maintenu par trigger CF mais jamais utilisé par le client. Filtres couleur/matière/marque ignorent les champs arrays.

## Incohérences

### HAUTES

1. **"Effacer tout" ne reset pas le filtre catégorie** — `useSearchScreen.ts:203-212` appelle `clearAllFilters()` et `categoryNav.goToRoot()` mais pas `setSelectedCategoryPath([])`.
2. **Recherche textuelle limitée au titre** — `articlesService.ts:390-393` ne cherche que dans `article.title`. Le `search_index` (titre+description+marque+catégorie) n'est jamais utilisé par le client.

### MOYENNES

3. Filtres couleur/matière/marque : faux négatifs sur les champs arrays (`article.color` vs `article.colors`).
4. Option de tri "Populaire" dans le type mais absente de l'UI.
5. `hasActiveFilters` toujours true à cause de `sortBy: 'recent'`.
6. CF `savedSearches` utilise `categoryId` au lieu de `categoryIds` — notifications de recherches sauvegardées cassées.
7. `search_index` maintenu mais jamais utilisé — coût Firebase inutile.
8. `SaveSearchButton` créé mais jamais affiché dans l'écran de recherche.

### MOYENNES (suite)

9. Pagination corrompue avec filtres client-side — `lastVisible` pointe vers le dernier doc filtré, pas le dernier doc Firestore.

### BASSES

10. Labels filtres sans accents ("Categorie", "Matiere", "Etat").
11. FlashList sans `estimatedItemSize` dans visual-search-results.

## Fichiers clés

- `app/search.tsx`, `features/search/hooks/useSearchScreen.ts`
- `hooks/useArticleSearch.ts`, `services/articlesService.ts`
- `functions/src/triggers/products.ts` (search_index trigger)
- `functions/src/scheduled/savedSearches.ts`
- `components/SaveSearchButton.tsx`, `components/search/RecentSearches.tsx`
- `features/search/constants.ts`
