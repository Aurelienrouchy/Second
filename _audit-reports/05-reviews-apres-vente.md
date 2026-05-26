# Audit #05 — Reviews, feedback et après-vente

**Date** : 2026-05-26 | **Incohérences** : 16 (3C, 4H, 5M, 3B)

## Résumé

Le backend reviews est complet (createReview CF, validation transaction, protection anti-doublon). Problème bloquant : aucune UI ne permet de laisser un avis. Les swap ratings sont silotées. Aucun système de litiges/remboursements.

## Incohérences

### CRITIQUES

1. **Aucune UI pour laisser un avis** — `reviewService.createReview()` et CF `createReview` existent. Zéro bouton dans l'app. La collection `avis` restera vide.
2. **Swap ratings silotées** — `rateSwap` stocke dans `swaps/{id}` mais ne propage jamais vers `avis/` ni `users/{uid}.rating`.
3. **Absence totale de litiges/remboursements** — aucun flow de contestation, médiation, ou remboursement.

### HAUTES

4. **Calcul moyenne faux dans `getUserPublicProfile`** — query limitée à 10 reviews (`reviews.ts:290`). Moyenne biaisée pour vendeurs avec 10+ reviews.
5. **Reviews orphelines après suppression compte** — reviews reçues (`vendeurId == uid`) pas nettoyées.
6. **Date review en ISO brut** — `ReviewItem.tsx:65` affiche "2026-05-20T14:30:00.000Z".
7. **Pas de notification de review reçue** — zéro appel à `sendNotification` après création.

### MOYENNES

8. Statut `completed` fantôme dans `terminalStatuses`.
9. `getUserStats()` échoue pour les guests (rules auth required).
10. Collection `ventes` fantôme dans `userStatsService`.
11. Pas de fenêtre temporelle pour laisser un avis.
12. Pas de modération des avis (contenu offensant).

### BASSES

13. Reviews unidirectionnelles — prompt vendeur→acheteur absent.
14. Champ `vendeurId` mal nommé (devrait être `targetUserId`).
15. Deux types `Review` dupliqués et divergents.
16. État vide reviews sans CTA actionnable.

## Fichiers clés

- `services/reviewService.ts`, `functions/src/callable/reviews.ts`
- `functions/src/callable/swaps.ts` (rateSwap)
- `functions/src/callable/users.ts` (deleteUserAccount)
- `app/user/[id].tsx`, `features/user-profile/components/ReviewItem.tsx`
- `app/my-orders.tsx`, `components/ShipmentTracking.tsx`
