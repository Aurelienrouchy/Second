# Audit paiement (Stripe Connect Custom) + livraison (ShipEngine) — cross-platform — 2026-06-09

> Audit exhaustif du rail financier et logistique de Second : Cloud Functions (callables, webhooks, scheduled, utils financiers), code app (checkout, paiement, wallet, onboarding vendeur), security rules + tests, et écarts code↔prod. Chaque finding a été **vérifié ligne par ligne dans le code réel** puis soumis à une **vérification adversariale** (un second agent a tenté de le réfuter) — 2 findings réfutés sont en annexe. Périmètre et axes : `PROMPT-audit-paiement-livraison-2026-06-09.md`. Croisement avec l'existant (`00-SYNTHESE-CONSOLIDEE-crossplatform-2026-06-01.md`, réverifications P0/P1 06-01/06-02, audits paiement/shipping 05-2026) : chaque finding est marqué **NEW / KNOWN(ref) / REGRESSION**.
>
> **124 findings confirmés après fusion des doublons (136 ids bruts) : 7 P0, 29 P1, 48 P2, 40 P3.**
>
> Convention flag : l'audit traite le code comme si `SHIPPING_ENABLED` était ON ; les findings masqués par le flag sont tagués **[latent si flag OFF]**. Attention : le flag est **client-only** (zéro occurrence dans `functions/src`, cf. F137) — tout le rail shipping backend reste invocable par appel direct des callables dès aujourd'hui.

---

## 1. Résumé exécutif

L'architecture financière a un vrai squelette (idempotence `stripe_events`, crédit vendeur différé jusqu'au label, modèle wallet 3 buckets, dead-letters + jobs filets), mais l'audit révèle **7 P0 dont 4 vivants dès aujourd'hui** : `refundWalletPayment` déployée en prod permet à un acheteur de s'auto-rembourser intégralement **après livraison** d'un achat wallet (vol direct, F21/F132) ; `cancelPendingTransaction` n'annule pas le PaymentIntent → double-crédit wallet exploitable (F73) ; la part wallet d'un paiement mixte abandonné est **perdue à l'expiration 1 h** (F22) ; et un litige swap est un statut terminal sans aucune voie de résolution (F48). Les 3 autres P0 cassent le flux shipping dès le flip du flag : la transition DELIVERED throw systématiquement (read-after-write Admin SDK → fonds vendeur gelés à vie, F1), et le modèle **destination charges contredit le modèle wallet** — frais de port versés au vendeur pendant que la plateforme paie l'étiquette (F2), puis **second** transfer plateforme→connecté à chaque retrait (double financement, F34/F86). En toile de fond : un pattern systémique de **culs-de-sac sans résolution** (disputes jamais clôturées → suppression de compte bloquée à vie ; sellerDebt sans recouvrement malgré une copy qui promet l'inverse ; KYC continu inexistant ; retour jamais livré = fonds gelés), une idempotence webhook qui **perd définitivement tout event dont le handler échoue** (F3/F98), et côté iOS un PaymentSheet très probablement 100 % KO (`merchantIdentifier` absent — régression sur un finding marqué closed, F116). Taxes TPS/TVQ absentes du rail (déjà live sur le top-up swap) et forfaits boutiques sans rail d'encaissement complètent le tableau.

---

## 2. Tableau récapitulatif

| Sévérité | Findings (après fusion) | NEW | KNOWN | REGRESSION | Dont [latent si flag OFF] |
|----------|------------------------:|----:|------:|-----------:|--------------------------:|
| **P0** | 7 (9 ids) | 6 | 1 | 0 | 3 |
| **P1** | 29 (33 ids P1 + 4 P2 absorbés) | 17 | 11 | 1 | 3 |
| **P2** | 48 | 33 | 14 | 1 | ~13 |
| **P3** | 40 | 29 | 11 | 0 | ~7 |
| **Total** | **124** | **85** | **37** | **2** | — |

Fusions opérées (même fichier + même cause) : **F21/F132** (refundWalletPayment), **F34/F86** (double financement retraits), **F3/F98** +F65 (marqueur stripe_events), **F27/F88** +F56→F90 (disputes jamais clôturées / swaps hard-supprimés), **F35**+F103 (stripePayoutId), **F39/F118** (sellerDebt), **F62/F117** (boucle onboarding), **F101**+F28 (charge.refunded partiel), **F90**+F56, **F5/F82** (createLabel non idempotent), **F13/F83** (batch meetup_pending TOCTOU). 2 findings réfutés en annexe (F4, F49).

---

## 3. Findings P0 détaillés

### P0-1 · F21/F132 — `refundWalletPayment` : l'acheteur peut s'auto-rembourser APRÈS livraison (garde l'article + récupère l'argent)

- **Sévérité** : P0 · **Confiance** : high · **Plateforme** : backend (identique iOS/Android) · **LIVE** (déployée en prod, re-vérifié via `firebase functions:list`)
- **Fichiers** : `functions/src/callable/wallet.ts:882-935, 911, 929, 964-1074` · `functions/src/index.ts:111` · `functions/src/callable/payments.ts:2603-2641`
- **Description** : la callable `refundWalletPayment` est exportée et déployée. Autorisation = **acheteur OU admin** (wallet.ts:911) ; statuts remboursables incluent `'shipped'`, `'delivered'` et `'meetup_completed'` (wallet.ts:929). Aucune exigence de litige, d'accord vendeur ni de revue admin ; aucun `checkRateLimit` (présent sur walletWithdraw l.297 et payWithWallet l.583) ; aucun App Check. Zéro call site client — mais une callable Firebase est un endpoint HTTPS vivant invocable par tout utilisateur authentifié via SDK. Le chemin carte équivalent (`adminRefundTransaction`) est admin-only à double garde (payments.ts:2634-2641) — asymétrie assumée nulle part.
- **Impact** : un acheteur ayant payé 100 % wallet se rembourse intégralement après réception : acheteur recrédité du total (wallet.ts:968-971), vendeur débité en cascade pendingBalance→heldBalance→balance→sellerDebt (wallet.ts:996-1062), transaction marquée `'refunded'`, article relâché `isSold=false` (l.1072-1074) alors qu'il est physiquement livré. **Vol direct = marchandise + argent du vendeur**, sans intervention humaine. Fenêtre : jusqu'au release 7 j (`'completed'` non remboursable). Même en crédit différé (vendeur jamais crédité), le crédit acheteur part quand même = perte plateforme.
- **Repro** : B achète en payWithWallet (100 % wallet) → colis livré (`'delivered'`) → B appelle `httpsCallable('refundWalletPayment',{transactionId})` avec son propre token → refund complet, article gardé, vendeur débité.
- **Recommandation** : restreindre à admin-only (aligné sur adminRefundTransaction) ou ne l'exposer que via les chemins server-internes (recourse/automatedDecisions) ; au minimum retirer `'delivered'`/`'meetup_completed'`/`'shipped'` des statuts buyer-callables ; ajouter checkRateLimit.
- **Croisement** : KNOWN — PROMPT axe E7 (callable orpheline, surface d'abus) ; l'exploit post-livraison est précisé par cet audit.

### P0-2 · F73 — Double-crédit wallet : `cancelPendingTransaction` n'annule pas le PaymentIntent et ne purge pas `walletAmountUsed`

- **Sévérité** : P0 · **Confiance** : high · **Plateforme** : backend · **LIVE**
- **Fichiers** : `functions/src/callable/payments.ts:2715-2826` · `functions/src/http/webhooks.ts:343-451` · `functions/src/utils/refund.ts:190-263`
- **Description** : pour un paiement mixte wallet+carte en `'pending_payment'`, cancelPendingTransaction recrédite la part wallet (payments.ts:2803-2818) mais (a) n'annule JAMAIS le PI Stripe (aucun `paymentIntents.cancel` dans le range) et (b) ne supprime pas `walletAmountUsed`/`paidVia` (le tx.update l.2789-2793 n'écrit que status/cancelledAt/cancelledBy). Le clientSecret du PI — détenu par l'acheteur — reste confirmable. Si le PI est capturé ensuite, handlePaymentSucceeded voit `'cancelled'` → `'cancelled_needs_refund'` (webhooks.ts:343-360) → issueTransactionRefund voit `paidVia='wallet_and_card'` + `walletAmountUsed>0` et **recrédite la part wallet une 2e fois** (refund.ts:194-262). La carte est remboursée correctement ; le wallet est crédité 2×.
- **Impact** : perte plateforme = part wallet, déclenchable par l'acheteur lui-même (il contrôle le clientSecret) ou par simple race cancel/confirm. La voie automatique (`expirePendingPayment`) annule, elle, le PI avant d'expirer (transactionExpiration.ts:480-498) — la voie manuelle est plus dangereuse que la voie automatique.
- **Repro** : achat mixte → cancelPendingTransaction (wallet remboursé, carte non chargée) → confirmer le PI avec sa carte → carte remboursée + wallet crédité 2× = gain net acheteur.
- **Recommandation** : dans cancelPendingTransaction, annuler le PaymentIntent (comme expirePendingPayment) ET/OU effacer `walletAmountUsed`+`paidVia` après remboursement (pattern déjà présent dans le revert F05, payments.ts:2231-2234 avec FieldValue.delete).
- **Croisement** : NEW.

### P0-3 · F22 — Mode mixte : part wallet débitée jamais restituée à l'expiration 1 h d'une `pending_payment` abandonnée

- **Sévérité** : P0 · **Confiance** : high · **Plateforme** : backend · **LIVE**
- **Fichiers** : `functions/src/callable/payments.ts:1071-1089, 1106-1108, 2802-2825` · `functions/src/scheduled/transactionExpiration.ts:440-570 (503-528)`
- **Description** : createStripeCheckout débite le wallet acheteur et committe (payments.ts:1072-1075) avant de retourner le clientSecret ; `walletAmountUsed`/`paidVia='wallet_and_card'` persistés (l.1106-1108). Si l'acheteur abandonne le Payment Sheet (chemin par défaut : l'app ne fait RIEN à la fermeture — `if (result.error === 'cancelled') return;`, app/checkout/shipping.tsx:482-484), la tx reste `pending_payment`. À 1 h, `expirePendingPayment` annule le PI et la tx, libère l'article, mais **ne restitue jamais la part wallet** (transactionExpiration.ts:503-528 : aucun read/credit wallet) — contrairement à cancelPendingTransaction qui le fait (payments.ts:2802-2825). Aucun filet : `payment_intent.canceled` non géré, `handlePaymentIntentFailed` ne fire que sur tentative échouée, la tx post-expiry est hors `cancellableStatuses`, reconcile ne voit rien.
- **Impact** : **perte d'argent acheteur** — wallet débité, pas de marchandise, pas de remboursement automatique. Touche tout acheteur qui ferme l'app pendant un paiement mixte. Récupération manuelle admin seulement.
- **Repro** : toggle « utiliser porte-monnaie » avec solde < total → createStripeCheckout (wallet débité) → fermer le Payment Sheet → attendre 1 h → tx cancelled, wallet jamais recrédité.
- **Recommandation** : dans expirePendingPayment, ajouter la même réconciliation wallet que cancelPendingTransaction (recréditer `walletAmountUsed` + ledger `refund_credit`) quand `walletAmountUsed>0`.
- **Croisement** : NEW.

### P0-4 · F48 — `openSwapDispute` sans aucune voie de résolution : statut terminal, refund inconditionnel exploitable, articles bloqués

- **Sévérité** : P0 · **Confiance** : high · **Plateforme** : backend · **LIVE** (swaps non gatés par SHIPPING_ENABLED)
- **Fichiers** : `functions/src/callable/swaps.ts:1525-1590 (1558, 1566, 1577-1578)` · `functions/src/triggers/swaps.ts:233-249` · `functions/src/scheduled/releaseHeldFunds.ts:323` · `features/swap/components/SwapActions.tsx:192-194`
- **Description** : `'disputed'` est terminal côté code — recensement exhaustif des writers de statut sur `collection('swaps')` : seul openSwapDispute écrit `'disputed'`, **rien ne le résout** (aucune callable admin, aucun scheduled, rules clients limitées à proposed→declined, le webhook le traite comme terminal). openSwapDispute ne crée même pas de doc `disputes`, et n'a **aucune limite temporelle** (guard `['shipping','completed']` seul, swaps.ts:1558) malgré le doc-comment « 7-day window » — litige ouvrable des mois après complétion. Dans la fenêtre 7 j (topUpReleasedAt unset), le refund du top-up est **automatique et inconditionnel** (swaps.ts:1577-1578) ; après release, aucun refund et « manual moderation handles that case » — modération qui n'existe pas. Les articles restent dans `ACTIVE_SWAP_STATUSES` (inéligibles à tout nouveau swap) et `releasePartyItems` n'est jamais appelé.
- **Impact** : **vecteur de perte d'argent direct** — un payer malveillant confirme la réception (ou dispute depuis `'shipping'` sans expédier son propre article), ouvre le litige, récupère 100 % du top-up ET garde l'article reçu ; le payee n'a aucun recours. Post-release : fonds sans arbitrage, swap zombie, notification « Notre équipe va l'examiner » mensongère. `refundSwapTopUpIfPaid` avale en plus les erreurs Stripe sans dead-letter (swaps.ts:850-856). Nuance vérifiée : la gate de retrait wallet ne requête que `transactions` — les retraits du payee ne sont PAS gelés par un swap disputed.
- **Repro** : payer paye le top-up → échange « livré » → ouvre un litige via DisputeButton → swap `'disputed'`, refund auto du top-up (si <7 j), aucun chemin de sortie pour le payee.
- **Recommandation** : callable admin `resolveSwapDispute` (rembourse payer OU libère payee + release articles + transition terminale) ; conditionner le refund auto à un arbitrage ; borner la fenêtre de litige ; appeler releasePartyItems.
- **Croisement** : NEW (le P0-2 swap du 2026-06-01 portait sur l'inatteignabilité du litige, désormais câblé — c'est l'absence de résolution qui est nouvelle).

### P0-5 · F1 — Transition DELIVERED : read-after-write interdit → la livraison throw toujours, fonds vendeur gelés **[latent si flag OFF]**

- **Sévérité** : P0 · **Confiance** : high · **Plateforme** : backend
- **Fichiers** : `functions/src/utils/trackingTransition.ts:113-131` · `functions/src/callable/wallet.ts:70-71` · entrées : `shipEngineWebhook.ts:114`, `scheduled/trackingCheck.ts:162`, `callable/payments.ts:1934`
- **Description** : dans `applyTrackingOutcome` (DELIVERED), `tx.update(txRef,{status:'delivered',…})` est bufferisé ligne 113-117, PUIS `getOrCreateSellerWallet(tx, sellerId)` fait `await tx.get(walletRef)` (wallet.ts:71). L'Admin SDK installé (`@google-cloud/firestore` 7.11.6) lève `READ_AFTER_WRITE_ERROR` (« all reads … before all writes », transaction.js:95-97) dès qu'un get suit un write bufferisé — erreur non-retryable, la runTransaction rollback sans rien committer. Sous le modèle deferred-credit, `sellerCreditedCents>0` à tout scan DELIVERED (posé à la création du label, labelFulfillment.ts:98) → la branche lecture est **toujours** prise → throw déterministe à 100 % des livraisons. Aucun test ne couvre trackingTransition (mocké en no-op dans les 2 suites).
- **Impact** : chaque livraison réelle échoue — status jamais `'delivered'`, pendingBalance→heldBalance jamais fait, `fundsReleaseAt` jamais posé, releaseHeldFunds (qui ne requête que `status=='delivered'`) ne libère rien. **Fonds vendeur gelés indéfiniment**, acheteur jamais « livré ». Touche les 3 entrées (poller 12 h, checkTrackingStatus, shipEngineWebhook). Toute transaction prod préexistante en shipped/label_created avec trackingNumber est frappée par le poller dès maintenant.
- **Repro** : activer SHIPPING_ENABLED → achat shipping payé → label créé → simuler un scan DELIVERED via checkTrackingStatus → READ_AFTER_WRITE_ERROR, tx reste `'shipped'`.
- **Recommandation** : déplacer la lecture du wallet AVANT tout tx.update (lire txRef + getOrCreateSellerWallet d'abord, n'émettre les writes qu'ensuite). Corriger le même pattern dans l'instance non-shipping de handlePaymentIntentSucceeded (webhooks.ts:363-389). Ajouter un test direct de applyTrackingOutcome.
- **Croisement** : NEW.

### P0-6 · F2 — Destination charge : les frais de port sont versés au vendeur, la plateforme paie l'étiquette → fuite à chaque vente **[latent si flag OFF]**

- **Sévérité** : P0 · **Confiance** : high · **Plateforme** : backend
- **Fichiers** : `functions/src/callable/payments.ts:1158-1159, 1271-1288` · `functions/src/utils/fees.ts:131-134` · `functions/src/http/webhooks.ts:569` · `functions/src/utils/labelFulfillment.ts:53-55, 119-171`
- **Description** : pour le paiement carte pure, `application_fee_amount = round(serviceFee*100)` **seulement** (payments.ts:1159), avec `transfer_data.destination` = compte vendeur (l.1276) et aucun `transfer_data.amount`. Le compte connecté reçoit donc `buyerTotal − serviceFee = articlePrice + shippingCost` (fees.ts:131/134). Or la plateforme achète elle-même l'étiquette via ShipEngine sur SA clé (webhooks.ts:569 ; « Cost is billed to the platform account »). Aucune récupération : `reconcileShippingCost` est detection-only ; aucun `transfers.createReversal` sur vente réussie (grep exhaustif). Le mirror wallet ne crédite que articlePrice (labelFulfillment.ts:53-55) → le ledger interne diverge en plus de la perte réelle. Tier premium : serviceFee=0 → application_fee=0, la plateforme encaisse 0 et paie l'étiquette.
- **Impact** : **perte sèche du coût de port à chaque vente shipping carte** : marge = serviceFee − actualShipping, souvent négative. Ex. : vente 50 $ + port 14 $ + fee 4 $ → buyerTotal 68 $ ; vendeur reçoit 64 $ ; plateforme garde 4 $ mais paie ~14 $ d'étiquette = **−10 $/vente** (hors frais processeur Stripe, portés aussi par la plateforme).
- **Repro** : cf. exemple ci-dessus, chemin complet createTransaction → createStripeCheckout → webhook → createLabel atteignable dès aujourd'hui par appel direct, et chemin par défaut au flip du flag.
- **Recommandation** : inclure le shippingCost dans application_fee_amount (= serviceFee + shippingCost) pour que la plateforme conserve les fonds servant à payer l'étiquette ; le vendeur ne touche que articlePrice (cohérent avec sellerPayout/sellerCreditedCents). À traiter conjointement avec P0-7.
- **Croisement** : NEW.

### P0-7 · F34/F86 — Double financement des ventes carte : destination charge au paiement + 2e transfer plateforme→connecté au retrait **[latent si flag OFF]***

- **Sévérité** : P0 · **Confiance** : high · **Plateforme** : backend
- **Fichiers** : `functions/src/callable/payments.ts:1271-1288, 1527-1534, 1693-1703` · `functions/src/callable/wallet.ts:429-462, 479-548` · `functions/src/utils/labelFulfillment.ts:41-102`
- **Description** : les achats carte sont des destination charges — le produit de la vente (article+livraison) arrive sur le compte connecté **dès le paiement**, avec payout schedule `'manual'` (jamais drainé). Le wallet n'est qu'un **miroir Firestore** (creditSellerForSale ne déplace aucun argent Stripe). Or `walletWithdraw` crée un **NOUVEAU** `transfers.create` plateforme→connecté du montant intégral (wallet.ts:429-443) puis un payout du même montant (l.445-462). Grep exhaustif : transfers/payouts.create n'existent que dans wallet.ts ; aucun reversal happy-path, aucun sweep des soldes connectés. Preuve d'intention : le chemin mixte ET le swap top-up sont des charges plateforme **sans** transfer_data, avec un commentaire documentant explicitement ce hazard (« the payee would be paid twice. The wallet ledger is the single rail », swaps.ts:727-736) — le chemin carte pure viole l'architecture platform-rail.
- **Impact** : chaque vente carte est financée 2× : les fonds destination restent **échoués à vie** sur le compte connecté pendant que la plateforme (qui ne perçoit que serviceFee) finance le retrait sur ses fonds propres + paie le label. Mécaniquement, `transfers.create` finit en `balance_insufficient` → le catch revert le débit → **TOUS les retraits cassés** alors que les comptes connectés regorgent de fonds inaccessibles (white-label).
- **Repro** : vente carte 100 $ → destination charge crédite ~100 $ au connecté → livraison + release 7 j → walletWithdraw(10000) : transfer 100 $ depuis la plateforme + payout 100 $. Solde connecté final : 100 $ échoués ; solde plateforme : −100 $ + fees.
- **Recommandation** : trancher le modèle — soit payout direct sur le solde connecté existant SANS transfer pour les ventes destination-charge, soit (préférable, aligné sur mixte/swap) basculer le checkout carte en charge plateforme + transfer au release (« separate charges & transfers ») pour que le wallet soit l'unique rail. Réconcilier les soldes connectés existants. *Latent pour l'UI, mais atteignable dès aujourd'hui par appel direct des callables (flag client-only).
- **Croisement** : NEW.

---

## 4. Findings P1 détaillés

### Webhooks & idempotence

#### F3/F98 (+F65) — Marqueur `stripe_events` commité AVANT le handler, jamais annulé sur échec → event Stripe définitivement perdu au retry

- **P1 · high · backend · LIVE** — `functions/src/http/webhooks.ts:113-133, 210-214` · `functions/src/scheduled/reconcile.ts:90-118`
- Le marqueur `stripe_events/{id}` est créé dans sa **propre** runTransaction qui committe immédiatement (l.113-124), PUIS les handlers s'exécutent. Si un handler throw (contention/UNAVAILABLE Firestore, le read-after-write F1, etc.), le catch renvoie 500 **sans supprimer le marqueur** ; le retry Stripe voit `markerSnap.exists` → ACK 200 sans retraitement. Le mécanisme de retry 3 jours de Stripe est structurellement neutralisé. Filets vérifiés : PI.succeeded → reconcile detection-only ; charge.refunded → branche neutralisée par un littéral `&& false` (reconcile.ts:118) ; **dispute.created/closed et account.updated → AUCUN filet**.
- **Impact** : un `charge.dispute.closed` 'lost' perdu = Stripe a retiré l'argent mais le vendeur n'est jamais débité (perte plateforme) ; un `dispute.created` perdu = aucun gel, le vendeur peut retirer ; un `account.updated` perdu = statut vendeur désynchronisé (live, flag OFF inclus). Perte en cascade : dispute.closed skippe ensuite car status ≠ 'disputed'.
- **Reco** : créer le marqueur DANS la même transaction que la mutation métier, ou ne le persister qu'après succès du handler (les guards de statut internes rendent les replays déjà sûrs) ; a minima `tx.delete` du marqueur dans le catch avant le 500.
- **Croisement** : NEW (absorbe F65, instance account.updated).

#### F100 — Un seul `STRIPE_WEBHOOK_SECRET` pour deux familles d'events nécessitant deux endpoints Stripe (platform vs Connect)

- **P1 · high · backend · LIVE** — `functions/src/http/webhooks.ts:53, 73-90, 177-183, 197-199` · `functions/src/callable/wallet.ts:445-462`
- Le endpoint gère des events PLATEFORME (payment_intent.*, charge.*) ET CONNECT (payout.paid/failed créés sur le compte connecté via `{stripeAccount}`, wallet.ts:461 ; account.updated). Stripe exige deux enregistrements d'endpoint distincts, chacun avec son secret. Le code ne supporte qu'UN secret et un seul essai constructEvent : au mieux une famille passe, l'autre est 401 ou jamais livrée. La prod encaissant des paiements, la famille morte est nécessairement Connect.
- **Impact** : payout.failed jamais traité → wallet débité, banque jamais payée, fonds jamais restitués ; withdrawal_requests coincés `'processing'` à vie (l'auto-réconciliation est inopérante, cf. F35) ; account.updated → statuts vendeur figés.
- **Reco** : supporter deux secrets (STRIPE_WEBHOOK_SECRET + STRIPE_CONNECT_WEBHOOK_SECRET), tenter constructEvent avec chacun ; vérifier dans le dashboard que les DEUX endpoints pointent vers l'URL et sont actifs.
- **Croisement** : NEW.

#### F101 (+F28) — `handleChargeRefunded` traite tout `charge.refunded` comme un remboursement TOTAL (`amount_refunded` jamais lu)

- **P1 · high · backend · LIVE** — `functions/src/http/webhooks.ts:1606-1830` · `functions/src/utils/refund.ts:124-147, 184-190`
- `charge.refunded` est émis aussi pour les refunds PARTIELS, mais le handler ne compare jamais `charge.amount_refunded` à `charge.amount` (0 occurrence dans webhooks.ts) : il marque `'refunded'`, re-crédite la portion wallet **entière**, débite la **totalité** de sellerCreditedCents et relist l'article — même livré. Course supplémentaire : pour un retour B2 partiel, si le webhook gagne la course contre la réconciliation de issueTransactionRefund (fenêtre refund.ts:135→184), la répartition partielle est écrasée par la réconciliation pleine.
- **Impact** : un geste commercial de 5 $ depuis le dashboard Stripe **détricote la vente entière** : vendeur débité en totalité, article relisté alors qu'il est livré, statut `'refunded'` faux. Divergence financière réelle.
- **Reco** : ignorer (ou dead-letter pour revue) les events où amount_refunded < amount ; ne dérouler la réconciliation pleine que pour un refund total.
- **Croisement** : NEW (absorbe F28).

#### F102 — `payment_intent.payment_failed` traité comme terminal alors qu'il est émis PAR TENTATIVE

- **P1 · high · both · LIVE** — `functions/src/http/webhooks.ts:1086-1160, 343-360, 409-451` · `components/StripePayment.tsx:88-99, 112-121`
- Stripe émet payment_failed à CHAQUE tentative échouée. Le handler annule la transaction et relist l'article dès le **premier** refus de carte (webhooks.ts:1106-1118), pendant que l'acheteur corrige sa carte dans la même Payment Sheet (même PI). Si la 2e tentative réussit : PI.succeeded sur tx `'cancelled'` → auto-refund. Même le retry app est cassé (createStripeCheckout rejette une tx annulée).
- **Impact** : premier refus + retry réussi = acheteur débité puis remboursé, **vente perdue**, article achetable par un tiers pendant le retry. Pas de perte d'argent (refund idempotent) mais flux d'achat cassé sur un cas courant.
- **Reco** : ne pas annuler sur payment_failed — laisser l'expiry 1 h (qui vérifie déjà le statut PI in-flight) faire foi, ou n'annuler que si pi.status est terminal après re-lecture.
- **Croisement** : KNOWN — 04-commandes-shipping-tracking.md #19 ; le mécanisme côté webhook est nouveau.

#### F105 — `shipEngineWebhook` 404 en prod (re-vérifié) : tracking et remboursements retour décalés jusqu'à 12 h **[latent si flag OFF]**

- **P1 · high · backend** — `functions/src/index.ts:225-226, 256` · `functions/src/scheduled/trackingCheck.ts:60, 109-141` · `functions/src/http/shipEngineWebhook.ts:50-81, 150-160`
- Export présent, code complet (jambes forward + retour), mais **404 re-vérifié en live** (POST sur l'URL prod → HTTP 404). Le tracking repose sur le seul poller `'every 12 hours'` (le commentaire index.ts:225 dit « 6h », stale), qui couvre les deux jambes → rien n'est perdu mais TOUT est retardé jusqu'à 12 h : détection DELIVERED (départ de la fenêtre 7 j), remboursement retour B2, label_created→shipped. Aggravant : `SHIPENGINE_WEBHOOK_SECRET` requis fail-closed n'apparaît dans aucune doc/liste de secrets du repo.
- **Reco** : provisionner le secret, déployer shipEngineWebhook (**sans --force**, cf. mémoire orphelins), enregistrer l'URL+secret côté ShipEngine, corriger le commentaire.
- **Croisement** : KNOWN — audit functions 2026-06-01, re-vérifié.

### Flux meetup (100 % du funnel d'achat tant que le flag est OFF)

#### F8 — Achat meetup direct (checkout) : l'offre générée est inacceptable par le vendeur — cul-de-sac systématique de 48 h

- **P1 · high · both · LIVE** — `app/checkout/meetup.tsx:142-164` · `functions/src/callable/payments.ts:832, 863, 1973-1975, 2096-2098` · `components/OfferBubble.tsx:384, 393, 558-570` · `services/chatService.ts:607-620`
- checkout/meetup appelle createTransaction (lock `isSold=true`, statut meetup_pending) PUIS sendMeetupOffer (offre `'pending'`). Le seul chemin vendeur est « Accepter » dans OfferBubble → acceptMeetupOffer → throw « Cet article a déjà été vendu » (payments.ts:2096-2098) car l'article est déjà verrouillé par la tx du checkout. L'idempotence promise par la docstring (« returns that transaction id », l.1973-1975) n'est PAS implémentée. canConfirmMeetup exige `offer.status==='accepted'`, jamais atteignable → confirmMeetupTransaction inaccessible (aucun CTA meetup dans my-sales/my-orders).
- **Impact** : avec SHIPPING_ENABLED=false (checkout/index.tsx:62 route TOUT vers meetup), **100 % du funnel « Acheter »** aboutit à une transaction qu'aucune action vendeur ne peut faire avancer : annulation automatique à 48 h avec push « Commande annulée automatiquement » à un acheteur qui a vu un écran de succès. L'alerte vendeur masque la raison serveur (OfferBubble:171).
- **Reco** : implémenter l'idempotence promise dans acceptMeetupOffer (tx meetup_pending existante pour ce chat+buyer+article → accepter et retourner cette tx) ; ou ne plus pré-créer la tx dans checkout/meetup (la tx naît à l'acceptation, comme dans le flux chat).
- **Croisement** : NEW.

#### F9 — Contre-offre meetup émise par le vendeur jamais acceptable : acceptMeetupOffer suppose buyer = senderId

- **P1 · high · both · LIVE** — `functions/src/callable/payments.ts:2050-2064, 2078-2080` · `services/chatService.ts:842-868` · `components/OfferBubble.tsx:384, 558-570`
- counterOfferPrice crée un NOUVEAU message d'offre dont senderId = le contre-offrant (le vendeur). Quand l'acheteur accepte, acceptMeetupOffer dérive buyerId = message.senderId = le **VENDEUR** (payments.ts:2052) et sellerId = l'autre participant = l'**acheteur** réel → `articleData.sellerId !== sellerId dérivé` → throw permission-denied « Vous n'êtes pas le vendeur de cet article ». Déterministe ; idem contre-offres lieu/horaire.
- **Impact** : toute négociation où le vendeur contre-offre est un cul-de-sac — l'acheteur ne peut jamais accepter, l'offre expire à 48 h. Seul « acheteur propose → vendeur accepte directement » fonctionne.
- **Reco** : dériver buyer/seller depuis l'article (article.sellerId = vendeur, l'autre participant = acheteur) ; autoriser l'acceptation par la partie non-émettrice du message courant.
- **Croisement** : NEW.

#### F10 — `reportMeetupNoShow` : litige permanent sans résolution qui gèle tous les retraits du vendeur — vecteur d'abus gratuit

- **P1 · high · both · LIVE** — `functions/src/callable/payments.ts:2417, 2453, 2496-2531, 2663-2678` · `functions/src/callable/wallet.ts:355-366` · `services/transactionService.ts:361-373` · `functions/src/utils/refund.ts:220-227`
- Appelable dès `meetup_pending`, **sans aucun gate temporel** (rien n'exige un RDV confirmé ni passé) ; pose `disputed:true`. Or walletWithdraw refuse TOUT retrait dès qu'une tx du vendeur a `disputed==true`, et `'disputed'` bloque la suppression de compte. Aucune callable resolveDispute/closeDispute n'existe ; aucun job n'expire les tx `'disputed'`. Seule sortie : adminRefundTransaction, qui marque `'refunded'` une tx 100 % cash.
- **Impact** : n'importe quel utilisateur authentifié crée gratuitement une tx meetup sur un article du vendeur ciblé, appelle reportMeetupNoShow immédiatement → **gel indéfini des retraits du vendeur** + blocage de suppression de compte des deux parties, jusqu'à intervention admin manuelle. La notification promet une contestation sans flux de contestation.
- **Reco** : callable admin « dismiss » (restaure statusBeforeDispute + disputed:false) ; scoper le gel des retraits aux litiges à enjeu financier (exclure meetup) ; conditionner le no-show à meetup_confirmed + délai.
- **Croisement** : KNOWN — flow-achat P1-13 (still_open au 06-02).

### Refunds, retours & disputes

#### F26 — Leg retour sans expiration : fonds vendeur gelés indéfiniment si le retour n'est jamais livré **[latent si flag OFF]**

- **P1 · high · backend** — `functions/src/callable/recourse.ts:646-660` · `functions/src/scheduled/trackingCheck.ts:109-141` · `functions/src/scheduled/transactionExpiration.ts:77-417`
- requestReturn pose `status='return_requested'` + `disputed=true` (fonds en heldBalance). Le seul déclencheur de résolution est un scan carrier DELIVERED sur returnTrackingNumber. Aucun job n'expire `return_requested` ; releaseHeldFunds est bloqué (status ≠ delivered + disputed). Aucun chemin « admin rejette le retour / libère au vendeur » : la seule sortie est adminRefundTransaction = refund **intégral acheteur** + débit vendeur, même si l'acheteur n'a jamais posté le colis.
- **Impact** : acheteur frauduleux = retour demandé jamais renvoyé → payout vendeur bloqué à vie, tx zombie, et l'unique outil admin favorise l'acheteur.
- **Reco** : job scheduled après N jours sans scan (route vers admin ou libère au vendeur) + callable admin de clôture en faveur du vendeur.
- **Croisement** : NEW.

#### F27/F88 — Aucune callable ne clôt les docs `disputes` : blocage permanent de suppression de compte

- **P1 · high · backend · LIVE** — `functions/src/callable/recourse.ts:330-344` · `functions/src/callable/payments.ts:2536-2551, 2626-2701` · `functions/src/callable/users.ts:78-88` · `firestore.rules:848-854` · `app/admin/disputes.tsx:48`
- Les disputes sont créés `status:'open'` (reportTransactionProblem, reportMeetupNoShow). Grep exhaustif : **aucune fonction du backend ne met à jour un doc disputes** ; les rules interdisent toute écriture client admin inclus (« allow create, update, delete: if false », avec un commentaire qui promet une résolution « CF-owned » non tenue) ; adminRefundTransaction rembourse la tx sans toucher la collection ; les statuts 'resolved'/'dismissed' n'existent que comme types UI morts (écran admin read-only).
- **Impact** : tout dispute reste `'open'` à vie même après remboursement → la gate deleteUserAccount (users.ts:78-87) **bloque définitivement la suppression de compte des deux parties** (cul-de-sac Loi 25). Touche le flux meetup live. Le registre des litiges est inutilisable pour le suivi.
- **Reco** : callable admin resolveDispute (ou résolution dans adminRefundTransaction) passant le doc à 'resolved'.
- **Croisement** : KNOWN — flow-achat P1-13 still_open ; l'angle blocage suppression de compte est nouveau (absorbe F88).

### Retraits, chargebacks & wallet vendeur

#### F35 (+F103) — `stripePayoutId`/`transferId` jamais persistés par walletWithdraw : la branche de récupération Stripe de reconcileWithdrawals est du code mort

- **P1 · high · backend · LIVE** — `functions/src/callable/wallet.ts:414-423, 426-478` · `functions/src/scheduled/reconcile.ts:153-237` · `functions/src/http/webhooks.ts:1536, 1592`
- Après `payouts.create`, walletWithdraw retourne sans jamais écrire payout.id/transfer.id sur withdrawal_requests (l.464-478 : log + return). stripePayoutId n'est posé que PAR les webhooks payout.paid/failed. Donc toute request `'processing'` inspectée par reconcileOneWithdrawal n'a pas de payoutId → branche dead-letter `processing_no_payout_id` systématique ; le chemin `payouts.retrieve` d'auto-réconciliation (reconcile.ts:179-237) est **inatteignable**. Le dead-letter tombe en plus dans un handler de replay qui exige payload.payoutId → retry → exhausted.
- **Impact** : webhook payout perdu = retrait coincé `'processing'` pour toujours, et dans le cas payout.failed perdu, le re-crédit wallet n'arrive jamais. Le filet censé réconcilier depuis Stripe ne peut jamais fonctionner. Circulaire avec F100.
- **Reco** : après payouts.create, `update` withdrawalRequestRef avec `{stripePayoutId, stripeTransferId}` avant le return.
- **Croisement** : NEW (absorbe F103).

#### F36 — Webhook payout.failed perdu : aucun chemin automatisé ne re-crédite le wallet — le replay dead-letter fait payouts.cancel, jamais le re-crédit

- **P1 · high · backend · LIVE** — `functions/src/scheduled/retryFailedOperations.ts:199-234` · `functions/src/scheduled/reconcile.ts:160-234` · `functions/src/http/webhooks.ts:1470-1545`
- Le re-crédit du wallet vit uniquement dans handlePayoutFailed (webhooks.ts:1512-1524). Si ce webhook est perdu, reconcileWithdrawals dead-letter en `payout_reversal_failed` ; or replayOp pour ce type fait `stripe.payouts.cancel` : (a) sans payoutId → retry → exhausted ; (b) cancel d'un payout déjà failed échoue → exhausted ; (c) même un cancel réussi ne re-crédite JAMAIS le wallet. Le commentaire reconcile.ts:218-219 admet « a human / replay re-credits » — le replay n'en est pas capable.
- **Impact** : argent débité du wallet, payout échoué à la banque, restitution **uniquement manuelle** (console Firestore + replay manuel). Cul-de-sac financier utilisateur.
- **Reco** : handler dédié qui, sur payout failed/canceled confirmé via Stripe, exécute le même runTransaction de re-crédit que handlePayoutFailed (idempotent via status 'processing').
- **Croisement** : NEW.

#### F37 — `dispute_hold` jamais libéré après un litige GAGNÉ (ou warning_closed, ou perdu sans crédit) : fonds gelés à vie dans heldBalance

- **P1 · high · backend · LIVE** — `functions/src/http/webhooks.ts:1227-1254, 1352-1367, 1441-1448` · `functions/src/scheduled/releaseHeldFunds.ts:129-226`
- handleDisputeCreated gèle min(sellerPayoutCents, balance) de balance→heldBalance (ledger `dispute_hold`). Sur WON, handleDisputeClosed restaure seulement le statut — **aucun mouvement wallet** ; idem warning_closed. Le seul mécanisme held→balance (releaseHeldFunds) ne libère que par tx `'delivered'` non encore libérée — jamais le dispute_hold (une tx restaurée 'completed' avec fundsReleasedAt déjà stampé ne matche jamais). Asymétrie aggravante : gel basé sur sellerPayout, débit LOST basé sur sellerCreditedCents → tx jamais créditée : gel > 0, débit = 0, gel orphelin même sur LOST.
- **Impact** : après tout litige gagné (et chaque inquiry warning_closed, cumulables), le montant gelé reste en heldBalance **pour toujours** ; invariant 3 buckets faussé silencieusement (reconcileBalances ne détecte que les négatifs).
- **Reco** : sur dispute.closed won/warning_closed (et lost avec débit < gel), reverser exactement le montant du ledger dispute_hold de heldBalance→balance dans le même runTransaction (persister freezeCents au moment du gel).
- **Croisement** : NEW.

#### F38 — Cascade de débit du litige PERDU omet pendingBalance — débit d'autres fonds / fausse dette pendant que le crédit litigieux reste échoué en pending

- **P1 · high · backend · LIVE** — `functions/src/http/webhooks.ts:1370-1408`
- handleDisputeClosed LOST débite heldBalance → balance → shortfall→sellerDebt **sans jamais toucher pendingBalance**, contrairement aux trois chemins frères (handleChargeRefunded, refundWalletPayment, issueTransactionRefund) qui cascadent pending→held→balance. Un chargeback sur une tx encore paid/label_created/shipped (crédit vendeur en pendingBalance) débite donc les fonds d'AUTRES ventes ou crée une dette, pendant que le crédit de la vente litigieuse reste en pendingBalance ; la tx passant 'refunded', le drainage pending→held ne viendra jamais.
- **Impact** : vendeur avec fausse sellerDebt (retraits bloqués, cf. F39) + pendingBalance fantôme gonflé à vie ; comptabilité wallet fausse, indétectable par reconcileBalances. Repro : vente unique 60 $ expédiée, chargeback pré-livraison, lost → sellerDebt 60 $ pendant que pendingBalance garde 60 $ pour toujours.
- **Reco** : aligner la cascade LOST sur handleChargeRefunded : pendingBalance → heldBalance → balance → sellerDebt.
- **Croisement** : NEW.

#### F39/F118 — `sellerDebt` sans aucun chemin de recouvrement : retraits bloqués à vie, et la copy wallet promet une régularisation automatique inexistante

- **P1 · high · both · LIVE** — `functions/src/callable/wallet.ts:387-392, 1009, 1045` · `app/wallet.tsx:70-76, 566-584` · `functions/src/utils/refund.ts:286, 308` · `functions/src/http/webhooks.ts:1392, 1419, 1757, 1796, 1899` · `functions/src/utils/labelFulfillment.ts:41-103`
- walletWithdraw refuse tout retrait si sellerDebt > 0. Grep exhaustif : sellerDebt n'est **QUE incrémenté** (9 sites) — aucun décrément, aucune compensation par les ventes futures (creditSellerForSale et releaseHeldFunds ne le lisent jamais), aucune callable admin de règlement, et les rules empêchent toute écriture client (seule une édition console peut solder). La copy du wallet promet pourtant « Vos prochaines ventes seront affectées à cette régularisation en priorité » et « les retraits reprendront automatiquement ».
- **Impact** : un vendeur endetté (litige perdu après retrait) est bloqué **définitivement** quelles que soient ses ventes ; promesse UI fausse ; aucune vue de progression.
- **Reco** : implémenter la compensation promise (au release, affecter le montant libéré à sellerDebt en priorité + ledger dédié), afficher la progression, ou corriger la copy en attendant.
- **Croisement** : NEW (fusion F39 backend + F118 UI).

#### F99 — `handlePayoutFailed` ne reverse pas le transfer : fonds orphelins sur le compte Custom + double dépense plateforme au retry

- **P1 · high · backend · LIVE** — `functions/src/http/webhooks.ts:1470-1545` · `functions/src/callable/wallet.ts:414-423, 429-462, 490-518`
- Sur payout.failed asynchrone, le handler re-crédite le balance interne et marque la request `'failed'`, mais ne reverse JAMAIS le transfer plateforme→connecté : l'argent réel reste sur le compte Custom (payout manual → pas de fuite banque, mais accumulation invisible). Le transferId n'est persisté nulle part et aucun dead-letter n'est posé. Au retrait suivant : NOUVEAU transfer (clés d'idempotence fraîches). Le chemin d'échec **synchrone**, lui, reverse bien (wallet.ts:490-518). Aucun filet : la request 'failed' n'est plus inspectée par reconcile ; reconcileBalances ne regarde jamais les soldes Connect.
- **Impact** : chaque payout.failed asynchrone strande X cents sur le connecté et fait payer la plateforme 2X au retry — sans ledger, sans trace.
- **Reco** : persister transfer.id à la création (cf. F35), puis `transfers.createReversal` idempotent (`rev_${transferId}`) + dead-letter en cas d'échec, même contrat que le chemin synchrone.
- **Croisement** : NEW.

### Swaps

#### F51 — Annulation impossible après paiement du top-up : payer coincé en 'accepted'/'photos_pending', sans litige ni expiration

- **P1 · high · backend · LIVE** — `functions/src/callable/swaps.ts:954-959, 1019-1024, 1104-1107, 1558` · `functions/src/scheduled/swaps.ts:88-99`
- cancelSwap n'autorise que 'proposed'/'payment_pending' ; une fois le top-up payé (webhook → 'accepted'), ni cancel ni decline ne fonctionnent. openSwapDispute refuse 'accepted'/'photos_pending' (guard 'shipping'/'completed' seulement). expireStaleProposedSwaps ignore ces statuts. Le mur : la transition vers 'shipping' (où le litige se débloque) exige les photos **des deux côtés** — une contrepartie silencieuse = blocage indéfini, top-up du payer coincé en pendingBalance du payee (non retirable avant confirmReception).
- **Impact** : payer débité sans AUCUN recours in-app (ni cancel, ni litige, ni expiration) tant que l'autre partie n'agit pas ; seul un refund manuel dashboard Stripe + fix Firestore débloque.
- **Reco** : étendre openSwapDispute (ou cancelSwap) à 'accepted'/'photos_pending' avec remboursement du top-up, ou expiration scheduled de ces statuts intermédiaires.
- **Croisement** : KNOWN — swap-swapzone P0-2 (reachability du litige fixée, mais toujours sans résolution ni couverture des statuts intermédiaires).

#### F52 — Swaps bloqués indéfiniment en 'accepted'/'photos_pending'/'shipping' : aucune expiration ni release des articles

- **P1 · high · backend · LIVE** — `functions/src/scheduled/swaps.ts:88-99` · `functions/src/callable/swaps.ts:129-136`
- expireStaleProposedSwaps (l'unique cron swap) ne traite que 'proposed'/'payment_pending'. Les statuts intermédiaires sont dans ACTIVE_SWAP_STATUSES → verrouillent les articles via assertArticlesNotEngaged, mais aucun job ne les expire et aucun exit n'existe (cancel/decline/dispute hors guard). Si un participant abandonne après acceptation : swap actif éternellement.
- **Impact** : articles des deux participants inéligibles à tout nouveau swap à vie, top-up éventuel coincé (cf. F51). Données orphelines permanentes.
- **Reco** : étendre l'expiration scheduled aux statuts post-acceptation avec remboursement du top-up et release des articles.
- **Croisement** : NEW.

#### F109 — Upload des preuves photo de swap bloqué par storage.rules (aucune règle pour `swaps/`, catch-all deny)

- **P1 · high · both · LIVE** — `storage.rules:16-77` · `app/swap/[id].tsx:260-269`
- L'app uploade les preuves vers `swaps/${id}/photos/${uid}_…jpg` (uploadBytes client) puis appelle uploadSwapPhotos (qui n'accepte que des URLs déjà uploadées, ne touche jamais Storage). storage.rules ne déclare que users/, products/, articles/, drafts/, avatars/, chat_images/ → `swaps/` tombe dans le catch-all `allow read, write: if false`. Or setSwapExchangeMode transitionne TOUS les modes vers 'photos_pending', et la seule sortie photos_pending→shipping exige les photos des deux côtés.
- **Impact** : **tout swap accepté est bloqué définitivement** au stade photos (erreur avalée en Alert générique) — non masqué par SHIPPING_ENABLED.
- **Reco** : ajouter `match /swaps/{swapId}/photos/{allPaths=**}` avec auth + isValidImageUpload() (scopé par uid via préfixe), aligné sur chat_images/. Ajouter le test storage correspondant.
- **Croisement** : NEW.

#### F90 (+F56) — Swaps hard-supprimés sans gate à la suppression de compte : top-up payé non libéré perd son chemin de remboursement

- **P1 · high · backend · LIVE** — `functions/src/callable/users.ts:249-257, 45-108` · `functions/src/callable/swaps.ts:814-816, 1525-1571`
- deleteUserAccount supprime tous les swaps du user **quel que soit le statut** ; les préconditions n'ont AUCUNE gate swap (la gate disputes est aveugle — un swap 'disputed' ne crée pas de doc disputes ; la gate transactions aussi — le top-up n'écrit aucun doc transactions). Tous les chemins de récupération exigent le doc swap (refundSwapTopUpIfPaid, openSwapDispute, confirmSwapReception, releaseHeldFunds qui query la collection). Précision adversariale : le PAYEE ne peut pas supprimer son compte (gate wallet bloque sur pendingBalance/heldBalance>0) ; le scénario réel est le **PAYER** (wallet vide) qui supprime → swap détruit → son refund impossible ET les fonds escrow du payee **gelés à jamais** (le payee ne pourra plus jamais supprimer SON compte, gate wallet).
- **Reco** : bloquer la suppression si un swap non terminal (ou topUpPaidAt sans topUpReleasedAt/refund) implique le user ; gérer le remboursement avant suppression.
- **Croisement** : NEW (absorbe F56).

### Onboarding vendeur & KYC (Custom white-label)

#### F59 — KYC continu inexistant : vendeur restreint par Stripe = payouts gelés sans aucune voie de sortie in-app (E2 confirmé)

- **P1 · high · backend · LIVE** — `functions/src/http/webhooks.ts:1944-2008` · `functions/src/callable/payments.ts:1777-1812` · `functions/src/callable/wallet.ts:334-345`
- handleAccountUpdated ne lit JAMAIS `requirements.currently_due/past_due/disabled_reason` (statut dérivé de charges/payouts/details seulement) et n'envoie aucune notification ; getStripeAccountStatus ne retourne ni requirements ni disabled_reason ; zéro `stripe.files.create`/Persons API/Account Links dans functions/src (currently_due lu uniquement à la création). En Custom white-label, la plateforme DOIT fournir l'UI de remédiation.
- **Impact** : Stripe demande un document (seuils de volume, vérification d'identité) → payouts gelés (walletWithdraw refuse) + articles inachetables en shipping, **définitivement**, sans aucun écran pour répondre ni cause affichée.
- **Reco** : persister requirements/disabled_reason depuis handleAccountUpdated + getStripeAccountStatus ; callable d'upload de document (stripe.files.create + accounts.update) + UI dans stripe-onboarding ; notifier quand currently_due devient non vide.
- **Croisement** : KNOWN — PROMPT axe E2, confirmé.

#### F60 — Gestion bancaire post-onboarding morte : `addBankAccount` orpheline, aucun écran — compte bancaire fermé = fonds irrécupérables in-app (E3 confirmé)

- **P1 · high · both · LIVE** — `functions/src/callable/payments.ts:1623-1729` · `app/settings/stripe-onboarding.tsx:6, 472` · `app/settings/payments.tsx:1-2` · `functions/src/index.ts:67`
- addBankAccount est exportée mais a ZÉRO call site client (le commentaire stripe-onboarding.tsx:6 qui prétend l'appeler est faux) ; le formulaire d'onboarding n'apparaît que si `!hasAccount` ; app/settings/payments.tsx est un stub TODO non référencé. Boucle d'impact : compte bancaire fermé → walletWithdraw → payout.failed → re-crédit → le payout repartira vers le même compte fermé, indéfiniment.
- **Reco** : écran « Compte bancaire » (last4 + remplacement) câblé sur addBankAccount, accessible quand hasAccount=true et depuis le wallet après payout.failed. Corriger en même temps F61 (default_for_currency, P2).
- **Croisement** : KNOWN — PROMPT axe E3 + audit functions 2026-06-01.

#### F62/F117 — Boucle morte wallet ↔ stripe-onboarding : vendeur payouts-disabled voit « Votre compte est actif » ; les 4 statuts backend et les requirements jamais affichés

- **P1 · high · both · LIVE** — `app/wallet.tsx:257-271` · `app/settings/stripe-onboarding.tsx:41-45, 398-400, 443-468` · `functions/src/callable/payments.ts:1770-1800` · `functions/src/callable/wallet.ts:334-345`
- wallet : si `!stripePayoutsEnabled` → alerte « Configurez votre compte » → push onboarding. Or l'écran calcule `isActive = chargesEnabled` **seul** : un compte charges ON / payouts OFF affiche « Votre compte est actif… demander des retraits » pendant que walletWithdraw refuse. Le champ status (4 valeurs backend, 5 avec 'partially_active' du webhook) et requirements ne sont lus nulle part ; le type UI déclare 'restricted' jamais émis ; le bouton « Actualiser » est quasi inatteignable (detailsSubmitted=false impossible en flow Custom one-shot).
- **Impact** : le vendeur gelé tourne en boucle entre deux écrans contradictoires sans information ni action — face visible de F59, identique iOS/Android.
- **Reco** : dériver l'affichage de chargesEnabled ET payoutsEnabled + status ; exposer requirements/disabled_reason ; refresh manuel inconditionnel quand hasAccount=true.
- **Croisement** : KNOWN — PROMPT axe F (fusion F62+F117).

### Suppression de compte & cycle de vie

#### F87 — `deleteUserAccount` : 'meetup_completed' absent des statuts terminaux → suppression de compte bloquée à vie

- **P1 · high · backend · LIVE** — `functions/src/callable/users.ts:94-108` · `functions/src/callable/payments.ts:2357-2362` · `functions/src/callable/reviews.ts:125`
- TERMINAL_TX_STATUSES = ['completed','cancelled','refunded']. Or completeMeetupTransaction termine en `'meetup_completed'` — statut terminal par design (reviews.ts le traite comme tel) qu'**aucun code ne fait jamais évoluer**. La gate 0c le voit donc comme transaction active.
- **Impact** : tout utilisateur ayant complété UNE seule rencontre (acheteur ou vendeur) ne peut plus jamais supprimer son compte — violation du droit à l'effacement (Loi 25 / RGPD art. 17).
- **Reco** : ajouter 'meetup_completed' à TERMINAL_TX_STATUSES (1 ligne).
- **Croisement** : NEW.

#### F89 — Suppression de compte pendant un retrait 'processing' : le re-crédit payout.failed devient impossible

- **P1 · high · backend · LIVE** — `functions/src/callable/users.ts:45-108, 305-318, 354-385` · `functions/src/http/webhooks.ts:1484-1491, 1525-1530`
- Les gates ne vérifient PAS withdrawal_requests 'processing' (au moment du retrait le wallet est déjà débité → la gate buckets passe ; la vente source est 'completed' → la gate tx passe). La suppression détruit ensuite inconditionnellement withdrawal_requests + wallet + ledger. Si le payout (1-3 j ouvrés) échoue ensuite : handlePayoutFailed ne trouve plus la request (warn + return, **aucun dead-letter**), et plus de wallet à re-créditer.
- **Impact** : fonds d'un payout rejeté par la banque rebondissent sur un compte Connect orphelin (accounts.del best-effort aura probablement échoué avec un payout en transit) sans plus aucun enregistrement plateforme : argent perdu, irréconciliable.
- **Reco** : gate supplémentaire — refuser la suppression si une withdrawal_requests est 'processing' (attendre payout.paid/failed).
- **Croisement** : NEW.

### Annulations & monétisation

#### F74 — Aucune annulation vendeur post-paiement (E5 confirmé) — acheteur bloqué 7 j

- **P1 · high · backend · [latent si flag OFF]** — `functions/src/callable/payments.ts:2756-2767`
- cancellableStatuses = {pending, pending_payment, meetup_pending, meetup_confirmed} : aucun statut post-paiement ('paid'/'label_created'/'shipped') n'est annulable, ni par l'acheteur ni par le vendeur ; aucune autre callable ne l'offre (vérification exhaustive : adminRefundTransaction admin-only, requestRefund/reportTransactionProblem/requestReturn buyer-only à statuts spécifiques, refundWalletPayment wallet-only).
- **Impact** : vendeur qui ne peut plus expédier (article cassé/perdu) → aucun moyen d'annuler+rembourser ; l'acheteur reste débité et attend l'expiration 7 j (PAID_NOT_SHIPPED). Cul-de-sac financier de 7 jours.
- **Reco** : callable d'annulation vendeur post-paiement ('paid'/'label_created' avant 1er scan) → issueTransactionRefund (clé rf_*) + relist, sans attendre l'expiry.
- **Croisement** : KNOWN — PROMPT axe E5, confirmé.

#### F133 — Taxes TPS/TVQ/TVH totalement absentes du rail de paiement (E1 confirmé)

- **P1 · high · backend · LIVE sur le top-up swap, plein effet au flip** — `functions/src/utils/fees.ts:116-147` · `functions/src/callable/payments.ts:841-846, 1271-1288` · `features/checkout-shipping/components/PriceBreakdown.tsx:40-65` · `functions/src/callable/swaps.ts:596-599, 678-679, 723` · `types/index.ts:542-549` · `services/shopService.ts:436-450`
- Grep exhaustif (tax|tps|tvq|gst|qst|hst) : zéro logique de taxe ; seuls vestiges = un commentaire et les champs morts ShopLegalInfo.gstNumber/qstNumber (updateLegalInfo sans call site). Total = article + livraison + frais ; PI sans automatic_tax ; PriceBreakdown sans ligne taxe. **Déjà live flag OFF** : le top-up swap facture le buyer fee plein sans taxe.
- **Impact** : en facilitateur de marketplace, le service fee est une fourniture taxable — TPS 5 % + TVQ 9,975 % non perçues (~15 % du revenu de frais), exposition rétroactive sur fonds propres + pénalités dès dépassement du seuil de petit fournisseur (30 K$/4 trim.). Shipping refacturé probablement taxable aussi.
- **Reco** : avant le flip shipping ON — immatriculation TPS/TVQ, taxe sur le service fee dans fees.ts, ligne taxe PriceBreakdown, inclusion dans application_fee_amount, registre de remise ; statuer avec un fiscaliste sur le shipping refacturé.
- **Croisement** : KNOWN — PROMPT axe E1, confirmé.

#### F134 — Forfaits boutiques : réduction de frais implémentée, AUCUN rail d'encaissement (E4 confirmé) **[latent si flag OFF]**

- **P1 · high · backend** — `functions/src/callable/payments.ts:43-53, 66-99, 859` · `functions/src/callable/shopModeration.ts:118-122` · `firestore.rules:89-95, 106-114` · `functions/src/callable/swaps.ts:678-679, 723`
- feeReductionForShopTier (pro→50 %, premium→100 %) est câblée et effective dans createTransaction/createStripeCheckout, sans aucune échéance (`paidUntil`) → tier posé = réduction perpétuelle. Côté revenu : zéro Stripe Billing, zéro callable d'achat de tier, zéro UI forfait ; shopModeration n'écrit jamais tier ; rules tier admin-only (seul chemin = écriture admin manuelle). Incohérence secondaire : le top-up swap n'applique PAS la réduction (calculateFees sans 3e argument).
- **Impact** : tout tier pro/premium attribué = renoncement à 50-100 % de l'unique revenu par vente, à perpétuité, sans jamais facturer le forfait. Le « paid shop model » n'a que sa moitié dépensière.
- **Reco** : avant toute attribution — callable d'achat/renouvellement (Stripe Billing ou PI récurrent) + paidUntil vérifié dans resolveBuyerFeeReduction + écriture tier réservée à ce rail ; aligner le top-up swap (ou documenter l'exclusion).
- **Croisement** : KNOWN — PROMPT axe E4 + boutiques-admin P1-1 (partial au 06-02).

### iOS

#### F116 — PaymentSheet iOS : `applePay` configuré sans `merchantIdentifier` sur StripeProvider → init échoue, tous les paiements carte iOS KO

- **P1 · high · iOS · LIVE** (affecte le top-up swap, pas seulement le shipping latent) — `app/_layout.tsx:103` · `components/StripePayment.tsx:65-85` · `app.config.js:62-66` · SDK : `@stripe/stripe-react-native` `ApplePayUtils.swift:360-372`, `StripeSdkImpl+PaymentSheet.swift:27-39`
- StripeProvider ne passe que publishableKey (le plugin app.config.js ne règle que l'entitlement build-time, pas le runtime — vérifié dans le SDK : merchantIdentifier vient uniquement de la prop, aucun fallback Info.plist). initPaymentSheet inclut **inconditionnellement** un bloc `applePay:{merchantCountryCode:'CA'}` ; côté natif, buildPaymentSheetApplePayConfig throw `missingMerchantId` quand merchantIdentifier est nil → **toute** l'init échoue (pas seulement Apple Pay) → onResult({success:false}) avant l'affichage de la sheet. Call sites : checkout/shipping, /payment/[id], swap/[id] (top-up). Seuls les paiements 100 % wallet survivent.
- **Impact** : sur iOS, CHAQUE présentation de PaymentSheet échoue avec « Paiement échoué ». Aucun paiement carte/Apple Pay possible sur iOS.
- **Repro** : iOS → swap avec complément → payer le top-up → initPaymentSheet retourne missingMerchantId → Alert sans que la sheet ne s'ouvre.
- **Reco** : passer `merchantIdentifier="merchant.com.seconde.app"` (et `urlScheme="seconde"`) à StripeProvider dans app/_layout.tsx, puis vérifier sur device iOS (note mémoire : Argent ne voit pas certaines sheets — vérif manuelle fondateur).
- **Croisement** : **REGRESSION** — flow-achat P1-2 marqué closed au 06-02 sur la seule preuve app.config.js ; app/_layout.tsx:103 ne passe toujours pas la prop.

---

## 5. Findings P2/P3 (tableau compact)

> F28, F56, F65, F103 ont été fusionnés dans leurs P1 parents (F101, F90, F3/F98, F35) et n'apparaissent plus ci-dessous. F5/F82 et F13/F83 sont fusionnés en une ligne chacun.

### P2 (48)

| ID | Titre court | Fichier clé | Latent | Statut |
|----|-------------|-------------|:------:|--------|
| F5/F82 | createLabel non idempotent (timeout webhook + overlap des runs sweep) → double étiquette payante | `webhooks.ts:565-644`, `sweepPendingLabels.ts:300-345` | ✦ | KNOWN |
| F6 | platform_ledger ne trace que la variance shipping (>2 $) — comptabilité aveugle | `labelFulfillment.ts:141-168` | ✦ | KNOWN |
| F11 | completeMeetup non atomique client : message marqué « terminé » avant la CF, sans retry | `chatService.ts:1244-1278`, `OfferBubble.tsx:397-398` | | NEW |
| F12 | Double confirmation meetup ambiguë : la 1re étape dit « transaction terminée » alors qu'elle confirme le RDV | `OfferBubble.tsx:304-326`, `payments.ts:2251-2255` | | NEW |
| F13/F83 | Expiration meetup_pending en batch non gardée : article hard-supprimé rejette le batch entier + TOCTOU écrase une confirmation | `transactionExpiration.ts:100-133`, `firestore.rules:152-156` | | NEW |
| F14 | Fenêtres d'expiration meetup (48 h/7 j depuis createdAt) décorrélées de la date réelle du RDV (jamais stockée) | `transactionExpiration.ts:46-56, 189-195` | | NEW |
| F15 | Le vendeur peut dérouler confirm+complete unilatéralement → meetup_completed sans action acheteur, recours no-show supprimé | `payments.ts:2222-2224, 2333-2347` | | NEW |
| F16 | checkout/meetup : échec de sendMeetupOffer après création tx = article verrouillé 48 h sans offre dans le chat | `app/checkout/meetup.tsx:142-196` | | NEW |
| F20 | Verrouillage gratuit et répétable d'un article via tx meetup (griefing) ; blocklist non vérifiée serveur | `payments.ts:535-540, 832` | | KNOWN |
| F23 | Revert F05 non atomique : re-crédit wallet puis effacement séparé de walletAmountUsed | `payments.ts:1209-1234` | | NEW |
| F24 | Mode mixte : part carte < minimum Stripe 50¢ non gardée → paiement bloqué, wallet débité | `payments.ts:1173-1199` | | NEW |
| F29 | Idempotence inter-chemins refund sur pre-read périmé + refund Stripe hors lock (clés distinctes) | `refund.ts:98-181`, `payments.ts:2651-2688` | ✦ | NEW |
| F30 | amount_mismatch sous-payé : article verrouillé à vie + charge capturée sans remboursement auto | `webhooks.ts:281-316, 460-525` | ✦ | NEW |
| F40 | Litige perdu sur paiement mixte : la portion wallet acheteur n'est jamais re-créditée | `webhooks.ts:1370-1439` | | NEW |
| F41 | Échec ambigu de payouts.create traité comme « non créé » : reversal + re-crédit alors que le payout peut exister → double versement | `wallet.ts:479-548` | | NEW |
| F42 | Livraison des events payout.* non garantie (config Connect invisible) + payout.canceled non géré | `webhooks.ts:177-207` | | NEW |
| F43 | handlePayoutFailed : wallet absent → re-crédit abandonné en silence, requête fermée sans dead-letter | `webhooks.ts:1507-1539` | | NEW |
| F50 | Photos preuve swap jamais validées : isValidated mort, transition shipping sans contrôle | `swaps.ts:1086-1107` | | NEW |
| F53 | Collection swaps sans aucun test de sécurité (cashTopUp immutable, create CF-only non testés) | `firestore.rules:577-589`, `tests/security/` | | NEW |
| F54 | Race confirmSwapReception : double pending→held théorique sur confirmations concurrentes (protégé, à tester) | `swaps.ts:1243-1304` | | NEW |
| F55 | Échange physique swap sans label ni tracking : déclaratif pur, fee identique à un achat | `swaps.ts:1126-1304` | ✦ | KNOWN |
| F61 | addBankAccount sans default_for_currency : le nouveau compte ne devient pas destination de payout | `payments.ts:1680-1703` | | NEW |
| F63 | Promesse « notification quand votre compte sera actif » jamais tenue (handleAccountUpdated n'envoie rien) | `stripe-onboarding.tsx:305-315`, `webhooks.ts:1987-2008` | | NEW |
| F64 | Vérification 18+ serveur à l'année près : un mineur de 17 ans passe (check client exact mais contournable) | `payments.ts:1391-1393` | | KNOWN |
| F66 | business_type 'individual' hardcodé : aucune voie d'onboarding pour vendeurs entreprises (boutiques) | `payments.ts:1488-1538` | | NEW |
| F75 | reconcileBalances limité aux 200 premiers wallets, sans curseur — filet aveugle à l'échelle | `reconcile.ts:352-357` | | NEW |
| F76 | reconcilePayments Case B (refund Stripe vs 'paid' en base) doublement mort (`&& false` + query pending_payment) | `reconcile.ts:110-127, 299-307` | | NEW |
| F77 | Webhook PI.succeeded perdu : dead-letter 'amount_mismatch' non rejouable → récupération manuelle | `reconcile.ts:90-108`, `retryFailedOperations.ts:241-289` | | NEW |
| F78 | expireStaleProposedSwaps : batch non gardé peut écraser un swap top-up payé (fonds piégés) | `scheduled/swaps.ts:113-134`, `webhooks.ts:845-888` | ✦ | **REGRESSION** (P0-1 flow-achat marqué closed ; le TOCTOU batch reste) |
| F79 | trackingCheck : cap partagé 600 en ordre fixe → polling des retours affamé à l'échelle | `trackingCheck.ts:37-53, 83-107` | ✦ | NEW |
| F80 | offerExpiration : .get() non borné (OOM/timeout à l'échelle) | `offerExpiration.ts:36-46` | | NEW |
| F81 | expireStaleProposedSwaps : requêtes .get() non bornées | `scheduled/swaps.ts:88-101` | | NEW |
| F91 | E6 confirmé : platform_ledger mono-writer conditionnel fire-and-forget, fees jamais enregistrés, balance_transaction jamais lu | `labelFulfillment.ts:129-167`, `reconcile.ts:248-275` | | KNOWN |
| F92 | E8 : purge Loi 25 (ledger+withdrawals+compte Stripe) vs conservation comptable 6 ans | `users.ts:284-318, 354-365` | | KNOWN |
| F93 | issueTransactionRefund : part wallet du refund silencieusement perdue si le doc wallet n'existe plus | `refund.ts:234-263` | ✦ | NEW |
| F104 | Events financiers non gérés : refund.failed/updated (interne dit 'refunded', acheteur non remboursé) + payout.canceled | `webhooks.ts:139-207`, `reconcile.ts:110-127` | | KNOWN |
| F110 | transactions : shippingAddress absent du denylist CF-only → réécrivable par une partie (lu par le sweep label) | `firestore.rules:717-746`, `sweepPendingLabels.ts:103-118` | ✦ | NEW |
| F111 | Guard transactions en DENYLIST : meetup*/noShowReport/timestamps oubliés, ajout de champs arbitraires possible | `firestore.rules:695-777` | | NEW |
| F112 | swapPartyItems : create client sous-validé (court-circuite la CF, flags non gardés au create) | `firestore.rules:537-554` | | NEW |
| F114 | Aucun test de sécurité pour swaps/disputes/withdrawal_requests/swapParties/swapPartyItems/automatic_decisions_log/ledger | `tests/security/` | | KNOWN |
| F119 | Blocage all-or-nothing des retraits par UN litige : invisible en amont, surfacé par matching de chaîne FR fragile | `wallet.ts:350-366`, `app/wallet.tsx:286-315` | | KNOWN |
| F120 | Faux « Paiement confirmé » après 12 s de polling + cache my-orders jamais invalidé → propose de repayer | `payment/[transactionId].tsx:206-224`, `my-orders.tsx:163-172` | ✦ | KNOWN |
| F121 | Alert parasite « déjà été traitée » + double back après paiement wallet (effets de bord dans le queryFn) | `payment/[transactionId].tsx:92-139`, `useWallet.ts:49-58` | ✦ | NEW |
| F122 | Aucune option d'annulation sur /payment/[id] → article verrouillé (isSold) jusqu'à 1 h | `payment/[transactionId].tsx`, `payments.ts:832` | ✦ | KNOWN |
| F123 | returnURL seconde://checkout/success sans handleURLCallback : retour 3DS iOS ouvre un faux « Paiement confirmé » à 0,00 $ | `StripePayment.tsx:78`, `checkout/success.tsx:87-107` | | NEW |
| F124 | Récap checkout non serveur-authoritatif : serviceFee fallback client passé au backend, serverBuyerTotal jamais affiché | `checkout/shipping.tsx:234-248`, `StripePayment.tsx:49-55` | ✦ | KNOWN |
| F135 | E10 — offre acceptée = prix verrouillé à perpétuité, jamais expirée ni consommée, survit aux hausses de prix | `offerExpiration.ts:36-41`, `payments.ts:282-340, 639-641` | ✦ | KNOWN |
| F137 | SHIPPING_ENABLED client-only : le rail financier shipping reste entièrement invocable serveur | `config/featureFlags.ts:17`, `payments.ts:560-602` | | NEW |

### P3 (40)

| ID | Titre court | Fichier clé | Statut |
|----|-------------|-------------|--------|
| F7 | DELIVERED sur statut 'paid' (label jamais créé) marque livré sans créditer le vendeur | `trackingTransition.ts:45-46, 110-139` | NEW |
| F17 | Écran de succès « Meetup confirmé » alors que le statut réel est meetup_pending | `checkout/success.tsx:87-94` | NEW |
| F18 | Seule issue admin d'un no-show meetup : marquer 'refunded' une tx cash jamais payée | `payments.ts:2663-2693`, `refund.ts:220-231` | NEW |
| F19 | createTransaction meetupSpot : undefined non normalisés (vs acceptMeetupOffer) → erreur de sérialisation Admin SDK | `payments.ts:878-888` | NEW |
| F25 | Échec de paiement réduit à un Alert générique sans action de récupération | `payment/[transactionId].tsx:165-185` | KNOWN |
| F31 | Commentaire trompeur : 're-uses persisted stripeRefundId' — jamais persisté (la reprise repose sur la clé rf_) | `transactionExpiration.ts:376-379` | NEW |
| F32 | Capacité morte : chargeReturnToSeller / extraSellerDebitCents documentés, jamais câblés | `payments.ts:2620-2688`, `refund.ts:46-50` | NEW |
| F33 | Reprise d'un rf_buyer_ bloqué via paid-not-shipped : article perdu re-listé + raison erronée | `recourse.ts:141-209`, `transactionExpiration.ts:600-665` | NEW |
| F44 | Gate litige de walletWithdraw hors transaction (TOCTOU, fenêtre de quelques secondes) | `wallet.ts:350-366` | NEW |
| F45 | handleDisputeCreated ne skippe pas 'refund_in_progress' : won peut restaurer un statut sans pilote | `webhooks.ts:1200-1208, 1352-1367` | NEW |
| F46 | reconcileBalances ne fait pas la « processing-withdrawal sanity » annoncée ; aveugle aux divergences positives | `reconcile.ts:17-19, 248-275` | NEW |
| F47 | Historique wallet affiché du plus ancien au plus récent (.reverse() d'une liste déjà DESC) | `app/wallet.tsx:379-382` | NEW |
| F57 | Compte du payer jamais vérifié pour payouts (RAS — garde-fou correct, signalé pour complétude) | `swaps.ts:705-720` | NEW |
| F58 | getSwapPartyLeaderboard : requête non paginée sur tous les swaps completed d'une zone | `swaps.ts:1772-1806` | NEW |
| F67 | Statuts Stripe incohérents selon le writer ('partially_active' webhook vs callables) + type client erroné | `webhooks.ts:1970-1980`, `payments.ts:1546-1553` | NEW |
| F68 | getStripeAccountStatus/addBankAccount sans rate limit ; routingNumber complet loggé en clair | `payments.ts:1623-1636, 1711-1752` | NEW |
| F69 | Race double création : deux comptes Custom Stripe, l'un orphelin avec KYC+banque attachés | `payments.ts:1449, 1488, 1556-1565` | NEW |
| F70 | IP de tos_acceptance spoofable (fallback data.ip puis '0.0.0.0') | `payments.ts:1430-1433, 1510-1513` | NEW |
| F71 | stripeAccountCreatedAt absent de protectedUserFields (seul champ stripe* client-mutable) | `firestore.rules:266-295` | NEW |
| F72 | Code mort/doc rot : payments.tsx stub deep-linkable, commentaires faux (addBankAccount, requestWithdrawal) | `app/settings/payments.tsx:1-41` | KNOWN |
| F84 | offerExpiration : batch écrase offer.status sans re-check (offre acceptée → 'expired') | `offerExpiration.ts:53-63` | NEW |
| F85 | Échecs financiers (dead-letters exhausted, divergences reconcile) silencieux hors logs CRITICAL | `retryFailedOperations.ts:271-289`, `reconcile.ts:91-96` | NEW |
| F94 | Axe B tranché : écart 1¢ RÉFUTÉ pour 2 décimales ; fragilité sub-cent réelle (aucune validation de précision) | `fees.ts:90-95`, `products.ts:228-238` | KNOWN |
| F95 | Aucune couverture de test d'arrondi (prix entiers seulement, feeReduction jamais testée) | `fees.test.ts:4-93` | KNOWN |
| F96 | getServiceFee + fallback client ignorent la réduction boutique : affichage plein tarif, débit réduit | `payments.ts:479-505`, `checkout/shipping.tsx:238-241` | KNOWN |
| F97 | deleteUserAccount : fenêtre de course gates (lectures) ↔ teardown bulkWriter non transactionnel | `users.ts:40-43, 110-178` | NEW |
| F106 | Events informatifs non gérés (transfer.reversed, dispute.funds_*, radar.early_fraud_warning, PI.canceled) | `webhooks.ts:205-207` | KNOWN |
| F107 | Collection stripe_events sans purge ni TTL — croissance non bornée | `webhooks.ts:113-124` | NEW |
| F108 | shipEngineWebhook : secret accepté en query string — fuite dans les logs d'accès | `shipEngineWebhook.ts:71-81` | NEW |
| F113 | automatic_decisions_log : règle read via get() sur transactions (coût/latence en liste) | `firestore.rules:862-870` | KNOWN |
| F115 | swaps decline : declinedBy non contraint à request.auth.uid | `firestore.rules:577-589` | NEW |
| F125 | Carte transporteur : trackingStatus UNKNOWN/LABEL_CREATED non gérés, branches mortes OUT_FOR_DELIVERY/RETURNED | `ShipmentTracking.tsx:64-117` | NEW |
| F126 | Pas de fallback dans transactionStatusMeta : statut hors union crasherait my-orders/my-sales/chat | `transactionStatusMeta.ts:156-176` | NEW |
| F127 | Historique wallet : une vente = 3 lignes dont un « −X » rouge (funds_held) qui ressemble à une perte | `app/wallet.tsx:133-196, 384-417` | KNOWN |
| F128 | Retraits en cours invisibles : withdrawal_requests jamais lu côté client | `app/wallet.tsx:77-80` | NEW |
| F129 | Rate limits/erreurs callable opaques : message brut, « Article indisponible » trompeur + éjection du checkout | `rateLimit.ts:60-63`, `checkout/shipping.tsx:401-407` | KNOWN |
| F130 | my-orders/my-sales : requêtes non bornées + N+1 (article + review par tx), pas de pagination | `transactionService.ts:427-462` | NEW |
| F131 | Polish copy/code mort : accents manquants, props mortes StripePayment, doublons PAID_STATUSES | `my-orders.tsx:112`, `StripePayment.tsx:49-55` | NEW |
| F136 | E10 — re-validation in-tx incomplète : hausse de prix mid-checkout passe sans offre (TOCTOU) | `payments.ts:606-642, 781-799` | KNOWN |
| F138 | Inventaire flip SHIPPING_ENABLED + frictions legacy (strip silencieux isShipping à l'édition, offres shipping en cul-de-sac) | `article/edit/[id].tsx:195-196`, 12 sites UI | KNOWN |

✦ = [latent si flag OFF]

---

## 6. Tableau « Sécurité paiement & financière » par flux

| Flux | Socle vérifié solide | Failles majeures (ids) | Verdict |
|------|----------------------|------------------------|---------|
| 1. Achat shipping | Re-pricing serveur du rateId, idempotence pi_/rf_, verrou isSold atomique, crédit vendeur différé jusqu'au label, garde sellerCreditedCents | **F1** (DELIVERED throw → fonds gelés), **F2** (fuite shipping), F3/F98 (events perdus), F105 (404 webhook), F30, F7 | 🔴 Cassé au flip — 2 P0 structurels à corriger avant toute activation |
| 2. Achat meetup (100 % du funnel actuel) | Callables atomiques, scheduler 48 h/7 j sain isolément ; **aucun argent ne transite** (cash in hand, pas de « crédit vendeur immédiat ») | **F8** (funnel checkout→offre inacceptable = cul-de-sac systématique), **F9** (contre-offres vendeur mortes), **F10** (no-show = gel des retraits sans résolution), F11-F16, F20 | 🔴 Le wiring app↔backend du chemin d'achat principal est cassé |
| 3. Wallet 100 % + mixte | Débit acheteur atomique, garde anti double-débit walletAmountUsed, idempotence creditSellerForSale | **F21/F132** (auto-remboursement post-livraison), **F22** (part wallet perdue à l'expiry), **F73** (double-crédit via cancel), F23, F24 | 🔴 3 P0 vivants — trous d'argent réels |
| 4. Les 5 chemins de refund | Cœur issueTransactionRefund correct : débit vendeur exact (sellerCreditedCents), cascade pending→held→balance→debt, clés rf_* déterministes, idempotence stage-2 sous lock | F26 (retour sans expiration), F27/F88 (disputes jamais clos), F101/F28 (partiel traité total), F29, F40, F93 | 🟠 Mécanique cœur saine, frontières en cul-de-sac |
| 5. Chargeback Stripe | Gel à dispute.created avec statusBeforeDispute, débit lost sur sellerCreditedCents, idempotence par statut | **F37** (dispute_hold jamais restitué sur WON), **F38** (cascade lost omet pending), F3/F98 (dispute.closed perdu = vendeur jamais débité, sans filet), F45 | 🟠 Squelette correct, 3 culs-de-sac financiers |
| 6. Retrait | Min 10 $, gates dispute/debt, débit atomique + revert synchrone avec reversal | **F34/F86** (double financement, P0), F35/F103 (réconciliation inatteignable), F36 (re-crédit jamais rejoué), F99 (transfer jamais reversé), F100 (famille Connect 401), F39/F118 (debt sans sortie), F41, F128 | 🔴 Architecture de financement cassée + résilience aux webhooks perdus illusoire |
| 7. Swaps + top-up | Plomberie Stripe du top-up solide : charge plateforme sans transfer_data, pi_swap_/rf_swap_, races capture/annulation gérées, mismatch dead-lettered | **F48** (litige terminal + refund inconditionnel exploitable, P0), F51/F52 (statuts intermédiaires sans exit), **F109** (photos bloquées par storage.rules), F50, F53, F55, F78, F90/F56 | 🔴 Rail financier OK, cycle de vie métier gravement incomplet |
| 8. Onboarding vendeur Custom | Création saine : KYC complet one-shot, tos_acceptance, pas de KYC en clair dans Firestore, champs stripe* verrouillés (le P0 « redirection payout » du 06-01 est FIXED-confirmé), gate vendeur actif à l'achat | F59 (KYC continu inexistant), F60 (banque morte), F62/F117 (UI contradictoire), F61, F63, F64, F66-F70 | 🟠 Naissance OK, cycle de vie = cul-de-sac complet |
| 9. Annulations | Idempotence rf_*, gardes re-check de statut dans la plupart des jobs, dead-letter + replay backoff ; tous les index composites requis présents | **F73** (P0, cancel sans PI.cancel), F74 (aucune annulation vendeur post-paiement), F122 (aucune annulation depuis /payment) | 🟠 |
| 10. Jobs scheduled | Sections 1b/2/3 de transactionExpiration correctement transactionnelles ; indexes complets | F75/F76/F77 (filets aveugles ou morts), F78-F82 (batchs non gardés, requêtes non bornées), F13/F83, F84, F85 (alerting silencieux) | 🟠 Filets de sécurité largement décoratifs |
| Transverse — conformité & monétisation | — | F133 (taxes absentes, live), F134 (forfaits sans encaissement), F92 (purge vs rétention 6 ans), F87/F89/F90 (gates suppression de compte), F137 (flag client-only) | 🔴 À traiter avant le flip |

---

## 7. Matrice cross-plateforme iOS / Android

L'écrasante majorité des findings est **backend / logique partagée** → comportement identique sur les deux OS. Les écarts réels :

| Surface | iOS | Android | Référence |
|---------|-----|---------|-----------|
| PaymentSheet (carte / Apple Pay / Google Pay) | 🔴 Init échoue systématiquement (`missingMerchantId`) → **aucun paiement carte** (checkout, /payment, top-up swap) | 🟢 Non affecté par ce défaut (pas de merchantIdentifier requis) | **F116** (REGRESSION) |
| Retour de redirection 3DS | 🔴 Pas de handleURLCallback : retour app bancaire → faux écran « Paiement confirmé » à 0,00 $ | 🟠 Même route deep-linkable, mécanique de retour différente | F123 |
| Paiement 100 % wallet | 🟢 Fonctionne (ne passe pas par PaymentSheet) | 🟢 Fonctionne | — |
| Flux meetup (checkout → offre → confirm/complete) | 🔴 Cul-de-sac identique | 🔴 Cul-de-sac identique | F8, F9, F10 (« both ») |
| Wallet / retraits / sellerDebt (UI + backend) | 🔴 Identique | 🔴 Identique | F39/F118, F62/F117, F119, F127, F128 |
| Onboarding vendeur / écran bancaire | 🔴 Identique | 🔴 Identique | F59, F60, F62/F117 |
| Preuves photo swap (storage.rules) | 🔴 Upload refusé | 🔴 Upload refusé | F109 |
| Copy / Alerts / statuts affichés | 🟠 Identique | 🟠 Identique | F120-F131 |

---

## 8. Top 5 des actions par ratio impact/effort

1. **Verrouiller `refundWalletPayment` en admin-only** (`functions/src/callable/wallet.ts:911, 929`) — supprime la branche buyer + retirer 'shipped'/'delivered'/'meetup_completed' des statuts. Quelques lignes ; ferme le P0 de vol direct **vivant en prod** (F21/F132).
2. **Passer `merchantIdentifier` (+ `urlScheme`) à StripeProvider** (`app/_layout.tsx:103`) — une prop ; restaure 100 % des paiements carte iOS, y compris le top-up swap live (F116). Vérification manuelle device requise.
3. **Réordonner lectures/écritures dans `applyTrackingOutcome`** (`trackingTransition.ts:113-131` + même pattern `webhooks.ts:363-389`) — lire wallet AVANT tout tx.update. Refactor local ; ferme F1 et débloque toute la chaîne livraison→release (pré-requis absolu au flip shipping).
4. **Symétriser annulation/expiration des paiements mixtes** : recréditer la part wallet dans `expirePendingPayment` (F22) ET annuler le PI + purger walletAmountUsed/paidVia dans `cancelPendingTransaction` (F73) — deux P0 vivants, même zone de code, patterns déjà existants à copier (cancelPendingTransaction pour le re-crédit, expirePendingPayment pour le PI.cancel, payments.ts:2231-2234 pour le FieldValue.delete).
5. **Commiter le marqueur `stripe_events` APRÈS succès du handler** (ou tx.delete dans le catch, `webhooks.ts:113-133, 210-214`) — les guards de statut internes rendent les replays déjà sûrs ; ferme F3/F98/F65 et redonne son sens au retry Stripe 3 jours pour TOUS les events (disputes, payouts, account.updated).

**Chantier structurel obligatoire avant le flip `SHIPPING_ENABLED`** (hors top 5 car effort moyen/élevé) : trancher le modèle destination charges vs platform-rail (F2 + F34/F86 — recommandation : charge plateforme + transfer au release, aligné sur mixte/swap), brancher les taxes TPS/TVQ (F133), déployer shipEngineWebhook (F105), et dupliquer le flag côté serveur (F137). En parallèle, créer le **rail de résolution des litiges** (callable admin resolveDispute + resolveSwapDispute + dismiss no-show) qui ferme d'un coup F27/F88, F10, F48, F26 et débloque la suppression de compte (avec F87, 1 ligne).

---

## 9. Annexe — Findings réfutés en vérification adversariale

| ID | Titre | Motif de réfutation |
|----|-------|---------------------|
| F4 | Modèle escrow (held-funds) incompatible avec les destination charges → fenêtre 7 j fictive et double-débit au remboursement | Les lignes citées existent (refund.ts:144 reverse_transfer ; refund.ts:266-314 et webhooks.ts:1737-1813 débit miroir sellerCreditedCents ; labelFulfillment.ts:41-102 crédit pendingBalance ; payments.ts:1270-1296 destination charge) mais la thèse « fenêtre 7 j fictive / vendeur payé à la capture » est réfutée : le payout schedule `manual` et le rail wallet font que le vendeur n'a accès à rien avant le release — les vrais défauts du modèle sont couverts par F2 et F34/F86. |
| F49 | Confirmation de réception unilatérale : un seul participant peut compléter le swap et libérer le top-up | RÉFUTÉ — le claim central (« rien ne vérifie que initiatorReceivedAt ET receiverReceivedAt proviennent de uid différents ») est faux : la garde est structurelle. Le champ écrit est dérivé du uid authentifié (`isInitiator = swap.initiatorId === uid`, swaps.ts:1235, 1263-1267) ; aucun paramètre ne permet d'écrire le champ de l'autre partie. |

---

*Rapport généré le 2026-06-09. Sources : 13 passes d'audit par flux/axe + vérification adversariale de chaque P0/P1 (notes de vérification ligne-par-ligne conservées dans les données de campagne). Rapports liés : `PROMPT-audit-paiement-livraison-2026-06-09.md` (périmètre), `00-SYNTHESE-CONSOLIDEE-crossplatform-2026-06-01.md` (référentiel KNOWN/REGRESSION), `01/02-REVERIFICATION-P0/P1-2026-06-01/02.md`.*
