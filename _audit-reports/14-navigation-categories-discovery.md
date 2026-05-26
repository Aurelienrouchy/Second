# Audit #14 — Navigation par catégories et discovery

**Date** : 2026-05-26 | **Incohérences** : 15 (2C, 3H, 6M, 4B)

## Résumé

Arbre de catégories ambitieux (2870 lignes, ~5 niveaux). Critiques : catégories Hommes dramatiquement tronquées vs Femmes, filtrage couleur ignore les articles multi-couleurs. La section "Pour toi" n'est pas intégrée malgré un hook `usePersonalizedFeed` opérationnel.

## Incohérences

### CRITIQUES

1. **Catégories Hommes tronquées** — `men_shoes`, `men_accessories`, `men_grooming` sont des feuilles sans sous-catégories. Comparé à `women_shoes` qui a 15+ sous-catégories.
2. **Filtrage couleur ignore `colors` (array)** — `articlesService.ts:396` ne vérifie que `article.color` (string legacy), pas `article.colors` (array).

### HAUTES

3. **Catégories "Divertissement" et "Animaux" fantômes** — définies dans `TOP_LEVEL_CATEGORIES` mais absentes de `CATEGORIES` (l'arbre navigable). L'IA y catégorise des articles introuvables par navigation.
4. **Tailles non liées à la catégorie** — `SizeSelectionSheet` affiche toutes les tailles sans tenir compte de la catégorie sélectionnée (pas de `getSizesForCategory()`).
5. **"Pour toi" absent du feed** — `usePersonalizedFeed.ts` fonctionnel mais jamais intégré dans `app/(tabs)/index.tsx`.

### MOYENNES

6. Accents manquants dans les labels UI ("Categorie", "Matiere", "Etat", "Suggere").
7. `withSpring` dans CategoryGrid et TrendingBrandsSection (convention no-spring violée).
8. Icône manquante pour Électronique dans CategoryTree (`hardware-chip` absent du iconMap).
9. "Voir tout" des sections home ne transmet aucun contexte de filtre.
10. Guest peut liker via hook mais bloqué par `requireAuth` sur les cartes (incohérence architecturale).
11. `CategoryGrid` composant complet mais jamais utilisé (code mort ~234 lignes).

### BASSES

12. FlashList home sans `estimatedItemSize`.
13. Filtrage matière ignore `materials` (array) comme pour les couleurs.
14. Recherches récentes inaccessibles aux guests.
15. Pas de deep link vers les catégories.

## Fichiers clés

- `shared/categories.ts` (2870 lignes)
- `hooks/useCategoryNavigation.ts`, `hooks/usePersonalizedFeed.ts`
- `components/CategoryBottomSheet.tsx`, `components/search/CategoryTree.tsx`
- `components/CategoryGrid.tsx`, `components/SizeSelectionSheet.tsx`
- `features/home/header/HomeHeader.tsx`
- `services/articlesService.ts`, `data/sizes.ts`
- `hooks/useFavorites.ts`, `components/ProductCard.tsx`
