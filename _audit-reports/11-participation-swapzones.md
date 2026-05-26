# Audit #11 — Participation et interactions dans les SwapZones

**Date** : 2026-05-26 | **Incohérences** : 16 (3C, 5H, 5M, 3B)

## Résumé

Architecture CF propre avec transactions atomiques pour les compteurs. Critiques : photos de swap envoyées comme URIs locaux, articles vendus ajoutables à une party, articles marqués `isSwapped` prématurément à l'acceptation.

## Incohérences

### CRITIQUES

1. **Photos de swap = URIs locaux** — `swap/[id].tsx:193` envoie `asset.uri` (file:///...) au CF qui les stocke dans Firestore. L'autre participant ne peut jamais voir ces photos.
2. **Articles vendus ajoutables** — `swaps.ts:636-645` ne vérifie pas `isSold`/`isActive`. Protection UI uniquement côté client.
3. **`isSwapped` prématuré** — `swaps.ts:296-325` marque les items `isSwapped: true` à l'acceptation, pas à la completion. Si le swap est annulé, les articles disparaissent de la party.

### HAUTES

4. Aucune vérification doublons articles dans une party.
5. `maxParticipants` défini mais jamais vérifié — `joinSwapPartySecure` ne compare pas.
6. Bouton Filtres de la SwapParty jamais accessible.
7. `confirmSwapShipping` sans guard de statut.
8. `confirmSwapReception` sans guard de statut.

### MOYENNES

9. `SwapNotificationType` déclaré mais jamais intégré dans `NotificationType`.
10. `propose-swap` : sélecteur côté receiver charge les articles du user courant.
11. Quitter une party ne vérifie pas les swaps actifs.
12. `swapsCount` incrémenté sans transaction atomique.
13. N+1 queries dans `getPartyItemsExtended`.

### BASSES

14. Vouvoiement/tutoiement incohérent.
15. Accents manquants dans les notifications scheduled.
16. Format prix incohérent entre composants swap.

## Fichiers clés

- `functions/src/callable/swaps.ts`, `functions/src/triggers/swaps.ts`
- `app/swap/[id].tsx`, `app/swap-party/[id].tsx`, `app/propose-swap.tsx`, `app/my-swaps.tsx`
- `services/swapService.ts`
- `features/swap/components/SwapActions.tsx`
- `features/swap-party/components/` (AddItemModal, PartyItemCard)
- `components/swap/SwapItemSelector.tsx`
- `types/index.ts`
