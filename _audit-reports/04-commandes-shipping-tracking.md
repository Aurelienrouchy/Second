# Audit #04 — Commandes, shipping et tracking

**Date** : 2026-05-26 | **Incohérences** : 19 (5C, 4H, 6M, 4B)

## Résumé

Le flux commandes/shipping révèle 5 critiques : aucune notification push dans tout le cycle, mismatch deliveryDays, fallback rateId fictif qui casse la création de label, aucun remboursement Stripe, et le statut `shipped` jamais atteint.

## Incohérences

### CRITIQUES

1. **Aucune notification push** — `handlePaymentIntentSucceeded` ne notifie ni vendeur ni acheteur. `checkTrackingStatus` ne notifie pas quand le statut change. Seul un message système dans le chat.
2. **Mismatch `estimatedDays` vs `deliveryDays`** — CF retourne `estimatedDays`, type attend `deliveryDays`.
3. **Fallback rateId fictif** — `'fallback_standard'` passé à `shipEngine.createLabel()` qui échoue. Acheteur a payé, pas de label.
4. **Aucun remboursement Stripe** — aucun `stripe.refunds.create` dans le code. L'UI promet "Remboursement si l'article ne correspond pas".
5. **Statut `shipped` jamais atteint** — le webhook met `paid`, puis `checkTrackingStatus` met `delivered`. Le statut `shipped` n'est jamais écrit.

### HAUTES

6. **ShipmentTracking affiché pour les meetups** — `chat/[id].tsx:358` ne filtre pas les statuts meetup.
7. **Aucun timeout vendeur qui ne shippe pas** — pas de scheduled function pour les transactions `paid` bloquées.
8. **Pas de gestion événements Stripe négatifs** — `charge.dispute.created`, `charge.refunded` non gérés.
9. **Tracking 100% manuel** — `checkTrackingStatus` est une callable, pas de webhook ShipEngine ni scheduled job.

### MOYENNES

10. Texte hardcodé "via Intelcom" dans ShipmentTracking.
11. Références Helcim partout (types, schema, commentaires, fichiers).
12. Pas d'écran vendeur "Mes ventes".
13. Adresse vendeur fallback `H2S3C4` pour le label.
14. `totalEarnings` inclut les meetups (argent hors-plateforme).
15. Adresse pré-remplie "Montreal"/"QC" biaisée.

### BASSES

16. Checkout ne pré-remplit pas l'adresse sauvegardée.
17. Placeholder "Jean Dupont".
18. "VOIR MA COMMANDE" redirige vers le chat.
19. Échec paiement annule la transaction (pas de retry possible).

## Fichiers clés

- `functions/src/http/webhooks.ts`, `functions/src/callable/payments.ts`
- `functions/src/config/shipEngine.ts`
- `app/checkout/shipping.tsx`, `app/my-orders.tsx`
- `components/ShipmentTracking.tsx`
- `features/checkout-shipping/types.ts`
