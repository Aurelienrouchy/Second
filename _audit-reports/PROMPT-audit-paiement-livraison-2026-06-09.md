# PROMPT — Audit complet paiement / livraison (à coller dans une nouvelle session)

> Prompt généré le 2026-06-09 à partir d'un inventaire multi-agents du codebase réel.
> Usage : coller tel quel dans une nouvelle session Claude Code à la racine du repo, idéalement avec ultracode/workflows activé.

---

Tu es auditeur senior spécialisé en intégrité financière et logistique de marketplaces. Audite de manière EXHAUSTIVE tout le périmètre **paiement (Stripe Connect Custom) + livraison (ShipEngine)** de Second : Cloud Functions, code app, security rules, et écarts code↔prod. Tu ne modifies AUCUN code — tu produis un rapport.

## Règle d'or

Chaque finding doit être **vérifié dans le code réel** avec `fichier:ligne` exact avant d'être rapporté. Aucune supposition, aucun finding « probable ». Si tu ne peux pas pointer la ligne, le finding n'existe pas. Indique un niveau de confiance (high/low) par finding.

## Contexte non négociable (décisions fondateur — ne pas remettre en cause)

- **Stripe Connect CUSTOM white-label, assumé** : le vendeur ne voit jamais Stripe. Ne recommande JAMAIS de migrer vers Standard/Express. La plateforme porte KYC/conformité/litiges — audite si elle le fait vraiment.
- **0 % commission vendeur** : monétisation = frais de service ACHETEUR (`application_fee_amount`, destination charges). Les boutiques payantes (3 forfaits) réduisent les frais acheteur (basic 0 % / pro 50 % / premium 100 %).
- **`SHIPPING_ENABLED` flag** (`config/featureFlags.ts`) : audite le code comme si le flag était ON ; tague `[latent si flag OFF]` les findings masqués par le flag.
- **Écarts prod connus** (audit functions 2026-06-01, à re-vérifier) : `shipEngineWebhook` exporté (`functions/src/index.ts`) mais **404 en prod** → le tracking réel repose sur le seul poller 12 h ; `addBankAccount` et `findPickupPoints` jamais appelés côté client ; 8 functions mortes en prod.
- Région `northamerica-northeast1`, montants Stripe/wallets en **cents**, `transactions` en **dollars** (legacy). Secrets : `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `SHIPENGINE_API_KEY`.
- Modèle wallet 3 buckets : `pendingBalance` (escrow) → `heldBalance` (fenêtre litige 7 j post-livraison) → `balance` (retirable) + `sellerDebt` (bloque tout retrait).

## Périmètre exact

**Cloud Functions — callables** : `functions/src/callable/payments.ts` (createStripeConnectAccount, addBankAccount, getStripeAccountStatus, createTransaction, createStripeCheckout, getShippingEstimate, getServiceFee, findPickupPoints, checkTrackingStatus, cancelPendingTransaction, acceptMeetupOffer, confirmMeetupTransaction, completeMeetupTransaction, reportMeetupNoShow, adminRefundTransaction) · `wallet.ts` (activateWallet, getWalletInfo, walletWithdraw, payWithWallet, refundWalletPayment) · `recourse.ts` (requestRefund, reportTransactionProblem, requestReturn) · `swaps.ts` (createSwapTopUpCheckout, confirmSwapReception, openSwapDispute) · `automatedDecisions.ts`.

**Webhooks** : `functions/src/http/webhooks.ts` (payment_intent.succeeded/payment_failed, charge.dispute.created/closed, charge.refunded, payout.paid/failed, account.updated, idempotence `stripe_events`) · `functions/src/http/shipEngineWebhook.ts` (HMAC, forward vs return leg).

**Scheduled** : `releaseHeldFunds.ts` (release 7 j, horaire) · `sweepPendingLabels.ts` (retry label, 4 tentatives puis refund) · `transactionExpiration.ts` (meetup 48 h / pending_payment 1 h / paid-not-shipped 7 j) · `trackingCheck.ts` (poller 12 h) · `retryFailedOperations.ts` (dead-letter replay 30 min) · `reconcile.ts` (filet 6 h, detection-only) · `scheduled/swaps.ts` (expireStaleProposedSwaps) · `offerExpiration.ts`.

**Utils financiers** : `utils/refund.ts` (issueTransactionRefund — cœur des 5 chemins de refund) · `trackingTransition.ts` (state machine tracking) · `returnRefund.ts` (processReturnDelivered) · `labelFulfillment.ts` (creditSellerForSale, reconcileShippingCost) · `fees.ts` (calculateFees, conversion dollars↔cents, réduction tier) · `failedOperations.ts` · `config/stripe.ts` · `config/shipEngine.ts`.

**Côté app** : `app/checkout/{index,shipping,meetup,success}.tsx` · `app/payment/[transactionId].tsx` · `app/wallet.tsx` · `app/my-orders.tsx` · `app/my-sales.tsx` · `app/settings/{stripe-onboarding,payments,shipping-options}.tsx` · `components/StripePayment.tsx` · `components/ShipmentTracking.tsx` · `features/checkout-shipping/**` · `services/transactionService.ts` · `services/walletService.ts` · `hooks/useWallet.ts` · `hooks/useTransactionRecourse.ts` · `lib/transactionStatusMeta.ts`.

**Data layer** : `firestore.rules` (transactions ~l.718, swaps ~l.583, wallets, withdrawal_requests, automatic_decisions_log ~l.866) · `firestore-schema.md` · `firestore.indexes.json` · `tests/security/{transactions,wallets,server_only}.rules.test.ts`. Collections : transactions, wallets(+ledger), withdrawal_requests, disputes, stripe_events, failed_operations, platform_ledger, swaps, automatic_decisions_log, automated_decision_contestations.

## Flux à tracer end-to-end (chacun = une section du rapport, étape par étape, avec les invariants vérifiés à chaque transition)

1. **Achat shipping** : createTransaction (lock article, re-pricing serveur du rateId) → createStripeCheckout (destination charge, idempotence `pi_${txId}`) → webhook succeeded (crédit vendeur DIFFÉRÉ jusqu'au label) → création label / `labelCreationPending` → sweep → premier scan (shipped) → DELIVERED (pendingBalance→heldBalance, +7 j) → releaseHeldFunds → completed.
2. **Achat meetup** : pas de frais, crédit vendeur immédiat, confirmMeetup/completeMeetup/reportMeetupNoShow — cherche les transactions zombies (article `isSold` permanent, statuts bloqués).
3. **Paiement wallet 100 % et mixte wallet+carte** : payWithWallet, débit atomique, garde `walletAmountUsed` anti double-débit, revert si échec PI.
4. **Les 5 chemins de remboursement** (tous via issueTransactionRefund, clés `rf_*`) : carrier failed/lost (requestRefund), buyer report → admin (reportTransactionProblem + adminRefundTransaction), retour B2 (requestReturn → processReturnDelivered, refund = total − returnLabelCost), amount_mismatch, capture après annulation (cancelled_needs_refund). Vérifie l'idempotence et le débit vendeur exact (`sellerCreditedCents`).
5. **Chargeback Stripe** : dispute.created (gel) / closed won (restauration `statusBeforeDispute`) / closed lost (débit cascade → sellerDebt).
6. **Retrait** : walletWithdraw (min 10 $, gates dispute/debt) → withdrawal_requests `processing` → transfer+payout → payout.paid/failed → re-crédit. Cherche les retraits coincés en `processing` si webhook perdu.
7. **Swap top-up + logistique swap** : PI direct charge (pas de transfer_data), handler `swap_topup`, confirmSwapReception, openSwapDispute, expiration 7 j — et le fait que l'échange physique des articles n'a NI label NI tracking (preuve photo + confirmation manuelle uniquement).
8. **Onboarding vendeur Custom** : createStripeConnectAccount (KYC complet in-app) → account.updated → 4 statuts. Vérifie le KYC CONTINU (voir axe E2).
9. **Annulations** : cancelPendingTransaction (statuts pré-paiement seulement) + expirations scheduled — et l'absence de chemin d'annulation vendeur POST-paiement.
10. **Jobs scheduled** : pour chacun, vérifie requêtes/indexes, pagination, idempotence en cas de double exécution, et ce qui se passe si le job rate (dead-letter ? silence ?).

## Axes d'audit obligatoires

**A. Intégrité financière** : atomicité runTransaction sur chaque mouvement d'argent ; impossibilité de double-crédit/double-débit (retry webhook, retry sweep, poller+webhook simultanés) ; cohérence `sellerCreditedCents` crédité = débité au refund ; cascade de débit pendingBalance→heldBalance→balance→debt ; invariants des 3 buckets vs ce que `reconcileBalances` vérifie réellement.

**B. Arrondis et double représentation** : transactions en dollars flottants vs wallets/Stripe en cents — chaque frontière de conversion (fees.ts, createStripeCheckout, creditSellerForSale, issueTransactionRefund) refait la sienne. Cherche les écarts d'1 cent possibles (prix non entier + fee % + réduction tier) et l'absence de tests d'arrondi.

**C. Webhooks** : vérification de signature (Stripe constructEvent, ShipEngine HMAC timing-safe) ; idempotence `stripe_events` créée DANS la transaction ; events Stripe émis mais non gérés (refund.updated, payout.canceled, transfer.reversed, radar… — liste-les) ; ordering/retards (PI.succeeded après expiration, dispute sur tx déjà refundée) ; conséquences réelles du `shipEngineWebhook` 404 en prod (fenêtres 7 j décalées de jusqu'à 12 h, retours retardés).

**D. Sécurité rules + tests** : champs CF-only des transactions (diff().affectedKeys()) — liste exhaustive et cherche un champ sensible oublié ; collections financières SANS tests de sécurité : `swaps` (cashTopUp immutable ?), `disputes`, `swapParties`/`swapPartyItems`, `withdrawal_requests` ; règle read de `automatic_decisions_log` (get() dans le hot path).

**E. Trous fonctionnels à confirmer/infirmer un par un** (pré-vérifiés par un inventaire — confirme avec lignes exactes et évalue l'impact) :
1. **Taxes TPS/TVQ/TVH totalement absentes** (zéro occurrence dans fees.ts, checkout, PriceBreakdown) — obligations de facilitateur de marketplace au Canada/Québec sur les frais de service au minimum.
2. **KYC continu inexistant** : `handleAccountUpdated` ne lit jamais `requirements.currently_due/past_due/disabled_reason` ; aucun flow d'upload de document (`stripe.files.create` absent) ; vendeur restreint = payouts gelés sans voie de sortie in-app (critique en Custom white-label).
3. **Gestion bancaire post-onboarding morte** : `addBankAccount` orphelin, `app/settings/payments.tsx` = stub TODO non accessible ; compte bancaire fermé = fonds irrécupérables in-app.
4. **Forfaits boutiques sans rail d'encaissement** : `feeReductionForShopTier` applique la réduction mais aucun mécanisme de paiement des forfaits (pas de Stripe Billing, pas de callable d'achat de tier) — la plateforme donne la réduction sans percevoir le revenu.
5. **Annulation vendeur post-paiement impossible** : `cancelPendingTransaction` limité aux statuts pré-paiement ; l'acheteur attend l'expiration 7 j pour être remboursé si le vendeur ne peut plus expédier.
6. **Comptabilité plateforme aveugle** : `platform_ledger` ne trace QUE la variance shipping ; aucun enregistrement du service fee encaissé ni des frais processeur Stripe (balance_transaction jamais lu) — marge nette invérifiable.
7. **`refundWalletPayment` orpheline** : callable financière exportée, zéro call site client — surface d'abus potentielle, à neutraliser ou câbler.
8. **Suppression de compte × rétention comptable** : `deleteUserAccount` purge wallets+ledger (Loi 25) vs obligation de conservation des registres financiers 6-7 ans au Canada — tension à documenter.
9. **Échec de paiement client réduit à un Alert générique** (`app/payment/[transactionId].tsx`) ; article verrouillé 1 h par un acheteur qui abandonne ; polling 12 s vs webhook tardif.
10. **Intersection offres négociées ↔ paiement** : offre acceptée puis expirée avant checkout, prix modifié entre acceptation et paiement, course offre vs achat plein tarif (`offerExpiration.ts`, `triggers/articles.ts`, validation dans createTransaction).

**F. UX & cross-platform** : statuts affichés (`transactionStatusMeta`, my-orders/my-sales, wallet, ShipmentTracking) vs statuts réels backend — états non mappés ? ; visibilité du statut Stripe vendeur (4 états jamais affichés dans stripe-onboarding) ; blocage de TOUS les retraits par UN litige (all-or-nothing) ; ledger UI vs types d'entrées réels ; rate limits opaques côté UI ; divergences iOS/Android (Payment Sheet, deep links de retour).

**G. Croisement avec l'existant** : compare avec `_audit-reports/` (audit paiement Stripe 05-2026 — 17 incohérences, audit shipping 05-2026 — 19, flow-achat crossplatform 2026-06-01, réverification P1 2026-06-02) et marque chaque finding **NEW / KNOWN(ref) / REGRESSION / FIXED-confirmé**.

## Méthode

- Utilise des workflows multi-agents si disponibles (un agent par flux + vérification adversariale de chaque P0/P1 par un second agent qui tente de le RÉFUTER en relisant le code) ; sinon traite les flux séquentiellement. Max 2-3 workflows en parallèle.
- Lis `CODEBASE_INDEX.md` et `firestore-schema.md` avant de chercher dans le filesystem.
- Ne re-signale PAS : les fichiers `data/*` (gardés volontairement), la migration Helcim (terminée), le choix Custom white-label (assumé).
- Lecture seule : aucun edit, aucun deploy, aucun `firebase deploy`.

## Livrable

Rapport `_audit-reports/paiement-livraison-crossplatform-<date>.md` au format standard du repo :
1. Titre + date ; 2. Résumé exécutif (5-10 lignes) ; 3. Tableau récapitulatif P0/P1/P2/P3 avec comptages ; 4. Findings P0 détaillés (sévérité, plateforme, `fichier:ligne`, description, impact, scénario de repro, recommandation, confiance) ; 5. P1 détaillés idem ; 6. P2/P3 combinés ; 7. Tableau « Sécurité paiement & financière » ; 8. Matrice cross-plateforme iOS/Android ; 9. Top 5 des actions recommandées par ratio impact/effort.

Critères de sévérité : **P0** = perte d'argent possible / privilege escalation / crash prod ; **P1** = fonctionnalité cassée ou trou fonctionnel majeur (cul-de-sac financier) ; **P2** = écart promesse↔code ou fragilité latente (incl. `[latent si flag OFF]`) ; **P3** = polish, code mort, UX mineure.
