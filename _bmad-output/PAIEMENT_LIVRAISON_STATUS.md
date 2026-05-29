# Statut production-readiness — Paiement + Livraison

_Maj 2026-05-29. Voir aussi `AUDIT_PAIEMENT_LIVRAISON_report.md` (audit) et `_architecture.md` (cible)._

## ✅ Backend — FAIT et vérifié

- `cd functions && npx tsc --noEmit` → **clean**
- `npx vitest run` (functions) → **146/146**
- `npm run test:security` → **34/34** (requiert `JAVA_HOME=/opt/homebrew/opt/openjdk@21`)

### Décisions fondateur appliquées
- **Meetup** = cash hors-ligne, **aucun crédit wallet** (fuite supprimée).
- **Connect** = **Custom** assumé (white-label, doc CLAUDE.md corrigée).
- **Fenêtre de litige** = **7 jours** (`heldBalance` → `balance` via `releaseHeldFunds`).
- **Retour** = acheteur par défaut, vendeur si litige tranché contre lui.

### Corrections P0 (fuites d'argent)
1. Meetup sans crédit wallet · 2. Shipping re-tarifé serveur · 3. Swap top-up rail unique · 4. Refunds `reverse_transfer`+`refund_application_fee` (sauf charges directes) · 5. Rate-limiting sur callables financières.

### Corrections P1
Idempotency keys Stripe · dédup `stripe_events/{event.id}` · cycle dispute (`charge.dispute.closed`) + `payout.failed/paid` + 7j hold + garde retrait · cohérence refund mixte + `sellerDebt` · atomicité label (crédit vendeur différé) + `sweepPendingLabels` + réconciliation coût (`actualShippingCost`) · retry/timeout ShipEngine + validation adresse · pagination tracking + découplage `label_created`/`shipped` + flux `delivery_failed`/`lost` + label retour + `shipEngineWebhook` · race expiration↔paiement + refund transactionnel paginé · montant lié à l'offre acceptée + payee swap onboardé + blocage suppression compte en litige · dead-letter `failed_operations` + `retryFailedOperations` + `reconcileFinances` · indexes + durcissement rules.

## ⚠️ Prérequis déploiement / config (NON code)
- **Secret manquant** : `SHIPENGINE_WEBHOOK_SECRET` (pour `shipEngineWebhook`) à créer dans Secret Manager.
- **Déploiement** : nouvelles fonctions (`releaseHeldFunds`, `sweepPendingLabels`, `retryFailedOperations`, `reconcileFinances`, `shipEngineWebhook`, `adminRefundTransaction`) + indexes Firestore. ⚠️ **JAMAIS `deploy functions --force`** (orphelins prod, dont `requestWithdrawal`) — déployer par fonction nommée.
- **Webhook ShipEngine** : configurer l'URL de tracking côté tableau de bord ShipEngine vers `shipEngineWebhook`.
- **CI** : exporter `JAVA_HOME=openjdk@21` pour `test:security`.

## ✅ App — FAIT (workflow 3) et vérifié
- `npx tsc --noEmit` (racine) : seules 2 erreurs **préexistantes** (orphelins `components/AuthTester.tsx`, `components/ExternalLink.tsx`) — le câblage paiement/livraison ajoute **0 erreur**.
- `npm run lint:boundaries` : **0 violation**.
- types/index.ts : 5 nouveaux statuts + champs + `heldBalance`/`sellerDebt`/`withdrawal_requests`.
- `lib/transactionStatusMeta.ts` : module unique (labels acheteur/vendeur + Tag variant + ton), consommé par my-orders/my-sales/ShipmentTracking.
- `app/wallet.tsx` : 3 buckets (Disponible/En attente/Bientôt dispo `heldBalance`) + blocage retrait litige/`sellerDebt` + note protection 7j. `getWalletInfo` expose désormais `heldBalance`/`sellerDebt` (fix appliqué).
- `app/checkout/shipping.tsx` + features/checkout-shipping : rateId obligatoire, gestion « tarif expiré → actualiser », blocage fallback → meetup, note protection 7j, copy meetup sans promesse de crédit.
- `app/settings/delete-account.tsx` : message clair de blocage en litige.
- Spec copy FR : `_bmad-output/UX_PAIEMENT_LIVRAISON_spec.md`.

## ⏳ DERNIER trou fonctionnel — recours acheteur (décision produit requise)
UI posée (signaler/rembourser/retour) mais **aucune callable backend acheteur** : `adminRefundTransaction` est admin-only. Sur `delivery_failed`/`lost`, le backend gèle déjà les fonds (`disputed=true`) → l'acheteur est protégé, mais ne peut pas encore **déclencher** la résolution lui-même. À trancher : recours manuel (signalement → admin rembourse) vs automatisé (auto-refund carrier-confirmé + flux retour avec label).

## ⏳ (Référence) Contrat backend branché côté APP
Nouveaux **statuts** transaction : `label_created`, `delivery_failed`, `lost`, `completed` (+ `refund_in_progress` transitoire).
Nouveaux **champs** :
- wallet : `heldBalance`, `sellerDebt` (afficher « fonds dispo dans X j », bloquer retrait si dette/litige).
- transaction : `fundsReleaseAt`/`fundsReleasedAt`, `disputed`, `actualShippingCost`, `labelCreatedAt`, `deliveryFailedAt`, `meetupCompletedAt`, `labelAttempts`…
- `withdrawal_requests` (suivi retrait : processing/completed/failed).

Écrans/flows impactés : `checkout/shipping` (rateId obligatoire + gestion « rafraîchir l'estimation » + blocage fallback), `my-orders`/`payment/[id]` (nouveaux statuts, action vendeur « Marquer expédié », recours acheteur `delivery_failed`/`lost`, demande de retour), wallet (held vs dispo), `settings/delete-account` (message blocage litige), copy FR meetup (réglé en main propre, plus de promesse de crédit).

## ⏳ Reste à câbler (mineur, backend)
- `createReturnLabel` ↔ déclenchement retour depuis `adminRefundTransaction`/flux litige (méthode prête, wiring du trigger à finaliser).
