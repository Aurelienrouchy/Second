# Audit #08 — Dashboard vendeur, seller balance et onboarding Stripe

**Date** : 2026-05-26 | **Incohérences** : 18 (4C, 5H, 6M, 3B)

## Résumé

Le frontend vendeur est fondamentalement incomplet : aucun écran d'onboarding Stripe Connect, aucune vérification du statut Stripe dans le flow de vente, système de retrait déconnecté de Stripe (vestige Helcim). Le backend (CF, rules, webhook) est solide.

## Incohérences

### CRITIQUES

1. **Aucun écran d'onboarding Stripe Connect** — les CF `createStripeConnectAccount`, `getStripeAccountLink`, `getStripeAccountStatus` existent mais ne sont appelées depuis aucun écran. Le vendeur publie sans compte Stripe → checkout acheteur échoue.
2. **Type User frontend sans champs Stripe** — `types/index.ts:40-68` ne contient pas `stripeAccountId`, `stripeAccountStatus`, etc. Les données existent dans Firestore mais sont ignorées.
3. **URLs retour Stripe pointent vers `second.app`** — `payments.ts:535-536` utilise `https://second.app/` mais le domaine est `seconde.app` (`app.config.js:73`).
4. **Système retrait déconnecté de Stripe** — formulaire bancaire manuel (transit/institution/compte) crée un doc `withdrawal_requests` mais aucun processus ne traite jamais ces retraits. Avec Stripe Connect Standard, les payouts sont gérés PAR Stripe.

### HAUTES

5. Type Transaction contient champs Helcim obsolètes mais pas Stripe.
6. Aucune vérification Stripe Connect avant l'achat — `createTransaction` ne vérifie pas `stripeChargesEnabled`.
7. `totalEarnings: 0` pour la première vente — confus pour le vendeur entre paiement et livraison.
8. Fichiers `helcim.ts` et `HelcimPayment.tsx` dead code.
9. Formulaire retrait sans protection double-tap optimale.

### MOYENNES

10. `seller-balance` utilise `formatPrice` au lieu de `formatPriceWithCurrency`.
11. Symbole "$" nu dans le formulaire de retrait.
12. Pas de vérification Stripe avant meetup.
13. `@ts-expect-error` sur FlashList dans seller-balance.
14. `seller-balance` retourne `null` si pas de balance (écran vide).
15. Schema Firestore mentionne Helcim.

### BASSES

16. Commentaire "HELCIM PAYMENT" dans payment screen.
17. "Aucun frais de plateforme" pour meetup alors que `serviceFee` est calculé.
18. `useUser()` sans guard guest dans seller-balance.

## Fichiers clés

- `app/seller-balance.tsx`, `app/settings/payments.tsx`, `app/settings/index.tsx`
- `services/sellerBalanceService.ts`, `services/transactionService.ts`
- `functions/src/callable/payments.ts`, `functions/src/http/webhooks.ts`
- `functions/src/config/helcim.ts`, `components/HelcimPayment.tsx`
- `types/index.ts`, `app.config.js`
