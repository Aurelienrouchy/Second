# Audit #03 — Checkout et paiement Stripe Connect

**Date** : 2026-05-26 | **Incohérences** : 17 (3C, 5H, 6M, 2B)

## Résumé

Backend solide (runTransaction, idempotence webhook, calcul serveur des frais, vérification montant webhook). Problèmes critiques : champ `deliveryDays` vs `estimatedDays`, webhook ne gère pas les échecs de paiement, total client potentiellement désynchronisé du montant Stripe.

## Incohérences

### CRITIQUES

1. **Mismatch `deliveryDays` vs `estimatedDays`** — CF retourne `estimatedDays` (`payments.ts:82`), type client attend `deliveryDays` (`checkout-shipping/types.ts:11`). Cast `as` masque l'erreur. Délai de livraison invisible.
2. **Webhook ne gère pas `payment_intent.payment_failed`** — l'article est marqué `isSold: true` par `createTransaction` avant le paiement. Si le paiement échoue et l'app crash, l'article est bloqué. Le client fait `cancelPendingTransaction` mais si le réseau tombe entre l'échec et l'annulation, la transaction reste orpheline.
3. **Total client désynchronisé du montant Stripe** — fallback client `price * 0.05` vs serveur `max(2.00, price * 0.05 + 1.50)`. Pour un article à 15$ : client affiche 0.75$ de frais, serveur charge 2.25$.

### HAUTES

4. **Vestiges Helcim** — types, schema, commentaires, composant `HelcimPayment.tsx`, fichier `helcim.ts`.
5. **Checkout ne vérifie pas isSold** — les 3 écrans checkout ne vérifient jamais avant d'afficher le formulaire.
6. **OfferBubble redirige vers `/payment/[txId]`** pour offres non-meetup mais la transaction n'est pas créée à l'acceptation de l'offre shipping.
7. **`clientSecret` stocké en clair dans Firestore** — `payments.ts:438-439`.
8. **Absence de gestion litiges/refunds** — webhook ne gère que `payment_intent.succeeded` et `account.updated`.

### MOYENNES

9. Meetup flow marque `isSold: true` immédiatement sans paiement (blocage possible).
10. Pas de vérification Stripe Connect du vendeur avant le checkout.
11. Service fee fallback client manque minimum 2.00$ et fixe 1.50$.
12. Commentaire "HELCIM PAYMENT" dans `payment/[transactionId].tsx:84`.
13. Transaction créée puis `createStripeCheckout` — si étape 2 échoue, article bloqué.
14. `application_fee_amount` vs `sellerPayout` — incohérence comptable.

### BASSES

15. Expiration transactions `pending_payment` orphelines inexistante.
16. Prix expédition "À partir de 8,50 $" hardcodé.
17. Schema Firestore dit "Helcim payments".

## Points positifs

- Race condition prévenue via `runTransaction` atomique
- Idempotence webhook + `createStripeCheckout`
- Calcul serveur des frais (client ne peut pas manipuler)
- Protection double-clic (submitting state, `isPresentingRef`)
- Vérification montant webhook avec tolérance 0.01$
- Seller balance atomic dans le même `runTransaction`

## Fichiers clés

- `functions/src/http/webhooks.ts`, `functions/src/callable/payments.ts`
- `app/checkout/shipping.tsx`, `meetup.tsx`, `index.tsx`
- `features/checkout-shipping/types.ts`
- `components/StripePayment.tsx`, `components/HelcimPayment.tsx`
- `functions/src/utils/fees.ts`, `functions/src/config/shipEngine.ts`
