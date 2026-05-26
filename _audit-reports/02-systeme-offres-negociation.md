# Audit #02 — Système d'offres et négociation

**Date** : 2026-05-26 | **Incohérences** : 16 (2C, 5H, 7M, 2B)

## Résumé

Flow meetup-first via chat. Architecture solide (runTransaction, expiration au moment de l'acceptation). Problèmes : aucune expiration automatique des offres, double transaction possible via deux chemins d'achat, contre-offres lieu/horaire implémentées mais inaccessibles dans l'UI.

## Incohérences

### CRITIQUES

1. **Aucune expiration automatique des offres** — `expiresAt` calculé client (`chatService.ts:704`) mais aucun scheduled job ne passe les offres expirées en `expired`. Le statut reste `pending` indéfiniment.
2. **Double transaction via checkout + offre chat** — deux chemins créent une transaction pour le même article : `checkout/meetup.tsx:142` et `chatService.ts:607-628`. La CF bloque le 2e mais l'UX est confuse.

### HAUTES

3. **Firestore rules : tout participant peut modifier le statut offre** — `firestore.rules:331-333` empêche l'auto-acceptation mais pas l'acceptation par un tiers-participant.
4. **Contre-offres lieu/horaire non exposées dans l'UI** — `chatService.counterOfferLocation/Time` implémentés, mais `chat/[id].tsx:268-283` ne passe que `onCounterPrice`.
5. **Schema Firestore désynchronisé** — `firestore-schema.md` manque `counter_price`, `counter_location`, `counter_time`, `completed`, tout le sous-objet `meetup`. Mentionne encore Helcim.
6. **Pas de check "article vendu" à l'envoi d'offre depuis le chat** — `chat/[id].tsx:161-166` vérifie seulement `hasPendingOffer`, pas `article.isSold`.
7. **Frais de service calculés mais non affichés pour les meetups** — `ConfirmStep.tsx:103-105` affiche le montant brut, mais `payments.ts:232` calcule un `serviceFee` pour les meetups.

### MOYENNES

8. Offres multiples possibles depuis la fiche article (pas de check `hasPendingOffer` dans `useArticleActions`).
9. Pas de validation max pour le montant de contre-offre.
10. Notifications de contre-offre aller-retour génériques.
11. Chat sans `sellerId` bloque la confirmation meetup.
12. "0% de réduction" affiché pour offre au prix fort.
13. Bouton "Payer maintenant" non fonctionnel pour offres shipping.
14. MakeOfferModal force le mode meetup sans alternative shipping.

### BASSES

15. MeetupActions non protégé contre le double-tap.
16. Symbole "$" ambigu (CAD vs USD).

## Fichiers clés

- `components/MakeOfferModal/` (index, OfferStep, ConfirmStep, types)
- `components/OfferBubble.tsx`, `components/offer-bubble/`
- `services/chatService.ts`
- `app/chat/[id].tsx`, `app/checkout/meetup.tsx`
- `functions/src/callable/payments.ts`, `functions/src/triggers/messages.ts`
- `firestore.rules`, `types/index.ts`
