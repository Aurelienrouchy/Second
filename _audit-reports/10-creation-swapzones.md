# Audit #10 — Création et configuration des SwapZones

**Date** : 2026-05-26 | **Incohérences** : 16 (3C, 4H, 6M, 3B)

## Résumé

Aucune création de SwapZone par les utilisateurs — tout est via script admin (`create-swap-parties.js`). Critiques : `addItemToPartySecure` ne valide pas `isSold`/`isActive`, pas de protection doublons, `swapsCount` race condition.

## Incohérences

### CRITIQUES

1. **`addItemToPartySecure` ne valide pas isSold/isActive** — `swaps.ts:636-644` vérifie existence et ownership mais pas l'état de l'article.
2. **Pas de protection doublons** — `swaps.ts:588-691` ne vérifie pas si l'article est déjà dans la party.
3. **`swapsCount` race condition** — `swaps.ts:1313-1320` read-then-write hors transaction au lieu de `FieldValue.increment()`.

### HAUTES

4. `confirmSwapShipping` sans guard de statut — `swaps.ts:1164-1215`.
5. Champ `theme` incompatible entre types (objet), schema (string), et script (string).
6. Bouton filtres inaccessible — `showFilters` initialisé à `false`, aucun bouton pour `setShowFilters(true)`.
7. Schema `firestore-schema.md` désynchronisé du code (champs manquants dans swapPartyItems et participants).

### MOYENNES

8. Rules Firestore réfèrent à `creatorId` jamais écrit → rule d'update impossible.
9. N+1 queries dans `swap-parties.tsx` pour vérifier la participation.
10. Format prix inconsistant (`{price}$` vs `${price}`).
11. Badge "Swap + $XX" toujours affiché (tous les articles ont un prix > 0).
12. Bouton cœur sur PartyItemCard ne fait rien.
13. Notifications de fin de party sans accents.

### BASSES

14. Boutons "S'inscrire" et "Aperçu" naviguent vers le même écran.
15. SwapZones terminées jamais affichées dans la liste.
16. Aucune création de SwapZone par les utilisateurs.

## Fichiers clés

- `functions/src/callable/swaps.ts`, `functions/src/scheduled/swaps.ts`
- `functions/create-swap-parties.js`
- `app/swap-party/[id].tsx`, `app/swap-parties.tsx`
- `services/swapService.ts`, `hooks/useSwapZone.ts`
- `features/swap-party/components/` (PartyItemCard, AddItemModal, PartyHeader)
- `firestore.rules`, `firestore-schema.md`, `types/index.ts`
