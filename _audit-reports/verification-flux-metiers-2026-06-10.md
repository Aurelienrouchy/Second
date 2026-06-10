# Vérification fonctionnelle neutre des flux métiers — paiement / livraison / swap / boutique

**Date :** 2026-06-10
**Périmètre :** flux métiers paiement, livraison, meetup, portefeuille (wallet), payout vendeur, remboursements, litiges, swaps, forfaits boutique.

## Note méthodologique

Cette vérification est une **lecture statique neutre du code** (sans biais), flux métier par flux métier, contre les invariants attendus de chaque parcours. Chaque verdict s'appuie sur une preuve référencée par `fichier:ligne`. Les bugs confirmés ont été soumis à une **réfutation adversariale** avant inclusion : seuls ceux survivant à cette contre-épreuve sont listés.

**Limites :** cette vérification **ne remplace pas un test runtime / device**. Rien n'est déployé. Les fenêtres temporelles (crash entre deux écritures, désactivation Stripe en cours de checkout) sont raisonnées sur le code, pas reproduites en conditions réelles. Aucun comportement n'a été observé en exécution.

---

## 1. Tableau de bord — verdict par flux

| Flux métier | Verdict | Bugs ouverts |
|-------------|---------|--------------|
| Achat — livraison (carte) | OK avec réserve | B1 (P2) |
| Achat — meetup (main propre) | OK avec réserve | B2 (P3) |
| Paiement — portefeuille (wallet 100% & mixte) | OK avec réserve | B3 (P3) |
| Vendeur — payout (white-label, retrait) | OK avec réserve | B4 (P2), B5 (P3 — réserve seule) |
| Remboursements | OK avec réserve | B6 (P3), B7 (P3) |
| Litiges — résolution | OK avec réserve | B8 (P3) |
| Swaps | OK avec réserve | B9 (P2) |
| Boutique — forfait | OK avec réserve | B10 (P2), B11 (P3) |

**Verdict global :** aucun bug **P0 / P1** détecté. Tous les flux fonctionnent sur leur chemin nominal. Les réserves portent sur des **fenêtres de défaillance étroites** (crash entre deux écritures), des **gates incomplets** et de la **dette de cohérence** (commentaires/branches mortes). Quatre points sont en **P2** (B1, B4, B9, B10) et méritent correction avant un test manuel sérieux ; le reste est en P3.

**Légende sévérité :** P0 = perte d'argent / faille immédiate · P1 = blocage métier large · P2 = défaut réel à fenêtre étroite ou contournable manuellement · P3 = cosmétique / dette / réserve documentaire.

---

## 2. Bugs P0 / P1 détaillés

**Aucun bug P0 ou P1 confirmé.**

Aucun chemin ne produit de perte d'argent non récupérable sur le parcours nominal, ni de double crédit vendeur, ni de double-vente, ni de blocage métier généralisé. Les invariants financiers cœur (débit exact, crédit vendeur unique, frais plateforme conservés, fonds en fenêtre de litige) sont tous respectés sur les chemins vérifiés. Les défauts les plus sérieux sont en P2 (section suivante) et concernent des fenêtres de crash, des gates de retrait incomplets, l'absence de timeout sur litige de swap, et un forfait boutique payable sans contrepartie.

---

## 3. Bugs P2 / P3 — tableau compact

| ID | Flux | Sév. | Titre | Fichier(s):ligne(s) clés | Impact argent |
|----|------|------|-------|--------------------------|---------------|
| B1 | achat-livraison | P2 | `payWithWallet` (livraison 100% portefeuille) n'utilise PAS `createLabelIdempotent` : label payé orphelin + transaction gelée si crash après `createLabel` | `wallet.ts:818,826-852,897`; `sweepPendingLabels.ts:296-297`; `labelFulfillment.ts:334-458` | Coût d'un label payé non récupérable (fenêtre étroite) + commande gelée |
| B2 | achat-meetup | P3 | `completeMeetup` écrit `'completed'` sur le message AVANT et indépendamment de la callable → divergence UI/backend | `chatService.ts:1259-1263,1269-1277`; `payments.ts:2812-2816`; `OfferBubble.tsx:400-401,610-614` | Aucun (meetup = cash) |
| B3 | paiement-wallet | P3 | Débit wallet temporairement bloqué si le compte Stripe vendeur devient impayable entre création tx et checkout mixte | `payments.ts:1094-1279,1304-1316,1360-1405,3687-3710`; `transactionExpiration.ts:637-659` | Aucun (immobilisation ≤ 1h, restitué) |
| B4 | vendeur-payout | P2 | `walletWithdraw` ne bloque pas sur `disabledReason` / `status='restricted'` (gate sur booléen `payoutsEnabled` seul) | `wallet.ts:334-345`; `stripeAccount.ts:78-79` | Limité (Stripe rejette → revert) — incohérence d'état |
| B5 | vendeur-payout | P3 | Débit wallet sans garde anti-double-retrait concurrent (rate-limit 5/min seul) — **réserve, pas un bug** | `wallet.ts:297-302,402-404` | Aucun (runTransaction empêche solde négatif) |
| B6 | remboursements | P3 | Commentaire trompeur sur le chemin `amount_mismatch` trop-payé : « rembourser la différence » alors que le code rembourse la charge entière | `webhooks.ts:585-586,621-628` | Aucun (acheteur rendu entier) |
| B7 | remboursements | P3 | Statut `'lost'` dans `AUTO_REFUNDABLE_STATUSES` jamais produit par le code (branche défensive morte) | `recourse.ts:54`; `trackingTransition.ts:184` | Aucun (`delivery_failed` couvre le cas) |
| B8 | litiges-resolution | P3 | `balanceAfter` du ledger `refund_debit` faux quand un résiduel gelé est restitué dans la même transaction (LOST) | `webhooks.ts:1866,1883-1897` | Aucun (champ informatif, soldes via `increment`) |
| B9 | swaps | P2 | Un swap en litige (`disputed`) n'a aucun timeout automatique — dépend d'une action admin manuelle | `scheduled/swaps.ts:201`; `callable/swaps.ts:1677,1724,1733-1740`; `releaseHeldFunds.ts:347` | Aucun (gel correct) — articles + complément bloqués sine die |
| B10 | boutique-forfait | P2 | Une boutique non approuvée (`pending`/`rejected`/`suspended`) peut payer un forfait sans recevoir aucune réduction — argent versé sans contrepartie | `shopTier.ts:114-122`; `payments.ts:92-93`; `webhooks.ts:1308-1366` | Réel : forfait encaissé (~jusqu'à ~959$) sans contrepartie, pas de remboursement auto |
| B11 | boutique-forfait | P3 | Re-souscription identique dans la fenêtre d'idempotence Stripe (24h) silencieusement dédupliquée — le propriétaire croit renouveler mais rien ne se passe | `shopTier.ts:133`; `webhooks.ts:1334`; `upgrade.tsx:203-207` | Aucun (pas de double-charge) — extension attendue non effectuée |

### Détail des P2

**B1 — `payWithWallet` n'utilise pas la création de label idempotente (achat livraison 100% portefeuille) — P2**
Fichiers : `functions/src/callable/wallet.ts`, `functions/src/scheduled/sweepPendingLabels.ts`, `functions/src/utils/labelFulfillment.ts`.
Dans `payWithWallet`, le rail livraison appelle directement `shipEngine.createLabel(rateId)` (`wallet.ts:818`) PUIS persiste le label dans une `runTransaction` séparée (`wallet.ts:826-852`) — l'ancien schéma à deux temps que le webhook a justement abandonné au profit de `createLabelIdempotent` (réservation atomique AVANT l'appel payant, F5/F82).
Scénario : un acheteur paie un article expédié 100% avec son porte-monnaie ; `shipEngine.createLabel` RÉUSSIT (ShipEngine facture le label, ~14$ payés par la plateforme) mais l'instance Cloud Function meurt/timeout AVANT la transaction de commit (`l.826`) ET avant le catch qui poserait `labelCreationPending=true` (`l.897`). Résultat : `shipEngineLabelId` n'est jamais persisté, `labelCreationPending` n'est jamais posé, le vendeur n'est jamais crédité (`creditSellerForSale` est dans le commit non exécuté, `l.837`), la transaction reste bloquée en `status:'paid'` avec article verrouillé.
`sweepPendingLabels` ne ramasse QUE `labelCreationPending==true && status=='paid'` (`sweepPendingLabels.ts:296-297`) : la transaction est donc INVISIBLE au job de recovery → aucun rattrapage automatique. Le label payé est orphelin (argent plateforme perdu) et la commande est gelée (vendeur jamais payé, acheteur débité, article bloqué). Une relance client de `payWithWallet` ne ré-appelle pas `createLabel` (le guard de statut bloque puisque `status` n'est plus `pending_payment`), donc PAS de double-vente, mais l'état mort persiste.
Le rail carte (webhook) est immunisé contre ce cas précis ; le rail portefeuille ne l'est pas car non migré vers `createLabelIdempotent`.
Impact métier : fenêtre temporelle étroite mais réelle ; coût d'un label payé non récupérable + commande livraison-portefeuille gelée nécessitant intervention manuelle.
Correctif : remplacer l'appel direct `createLabel`+commit (`wallet.ts:814-906`) par `createLabelIdempotent`, comme le webhook et `sweepPendingLabels`.

**B4 — `walletWithdraw` ne bloque pas sur `disabledReason` / `status='restricted'` — P2**
Fichiers : `functions/src/callable/wallet.ts`, `functions/src/utils/stripeAccount.ts`.
Le gate de retrait (`wallet.ts:334-345`) ne lit QUE `stripeChargesEnabled` et `stripePayoutsEnabled`. Or `deriveStripeAccountState` (`stripeAccount.ts:78-79`) peut classer un compte `restricted` (`disabledReason` présent ou `past_due`) alors que `payouts_enabled` est encore `true` transitoirement chez Stripe (fenêtre avant que Stripe ne bascule `payouts_enabled=false`, ou requirement `currently_due` futur sans coupure immédiate).
Scénario : vendeur sous remédiation KYC (`disabled_reason='requirements.past_due'` avec deadline) mais `payouts_enabled` pas encore retombé à `false` → `walletWithdraw` passe le gate et tente transfer + payout.
Impact limité car Stripe rejettera généralement le payout (→ `revertFailedPayout` re-crédite) et `payouts_enabled` retombe vite à `false` ; mais pendant la fenêtre le code initie un mouvement de fonds sur un compte que l'app affiche elle-même comme `restricted` (`stripe-onboarding.tsx:432`), incohérence d'état.
Recommandation : refuser aussi si `userData.stripeRequirementsDisabledReason != null` ou `stripeAccountStatus=='restricted'`.

**B9 — Un swap en litige (`disputed`) n'a aucun timeout automatique — P2**
Fichiers : `functions/src/scheduled/swaps.ts`, `functions/src/callable/swaps.ts`, `functions/src/scheduled/releaseHeldFunds.ts`.
Scénario : le payeur (ou le bénéficiaire) ouvre un litige via `openSwapDispute` (`swaps.ts:1677`, `status→'disputed'`, fonds gelés en `pendingBalance` ou `heldBalance`). La SEULE sortie est `resolveSwapDispute` (`swaps.ts:1724`), un callable `onCall` RÉSERVÉ ADMIN (double-guard `l.1733-1740`), jamais déclenché par un cron.
Aucun scheduler ne traite `disputed` : `expireStalePostAcceptanceSwaps` ne couvre que `accepted/photos_pending/shipping` (`scheduled/swaps.ts:201`) et son test (`l.177`) vérifie explicitement qu'un `disputed` N'EST PAS touché ; `releaseSwapTopUpHeldFunds` filtre `status=='completed'` (`releaseHeldFunds.ts:347`) donc exclut `disputed`.
Si aucun admin ne traite le litige, le swap reste `disputed` pour toujours, les articles restent engagés (`disputed ∈ ACTIVE_SWAP_STATUSES`) et le complément reste gelé.
Note : l'argent n'est ni perdu ni dupliqué (gel correct), et ce comportement reflète volontairement le flow des achats. Mais l'invariant métier « jamais bloqué indéfiniment dans un statut intermédiaire » n'est PAS garanti par le système — il repose sur un SLA humain non codé. Pas de remontée automatique (queue de litiges en attente / alerte âge) trouvée.
Impact métier : litige oublié = fonds payeur/bénéficiaire et articles bloqués sine die, friction support, risque de plainte / chargeback côté payeur.
Recommandation : ajouter une visibilité / alerting sur l'ancienneté des disputes (sans auto-trancher, car le sens du litige n'est pas devinable).

**B10 — Une boutique non approuvée peut payer un forfait sans contrepartie — P2**
Fichiers : `functions/src/callable/shopTier.ts`, `functions/src/callable/payments.ts`, `functions/src/http/webhooks.ts`.
`purchaseShopTier` (`shopTier.ts:114-122`) ne vérifie QUE l'existence du shop et la propriété (`ownerId`), JAMAIS le `status`. Un propriétaire dont la boutique est `pending` (jamais approuvée), `rejected` ou `suspended` peut donc acheter et PAYER un forfait `pro`/`premium`. Le webhook `handleShopTierSucceeded` (`webhooks.ts:1308-1366`) stampe `tier` + `tierPaidUntil` sans vérifier le `status` non plus. Mais `reductionForShopDoc` (`payments.ts:92-93`) renvoie 0 dès que `shop.status !== 'approved'`.
Scénario : le propriétaire d'une boutique en attente de validation souscrit « La Maison » 12 mois (79,99$/mois ≈ 959$), le paiement réussit, `tierPaidUntil` est posé, mais ses acheteurs continuent de payer les frais pleins tant que la boutique n'est pas approuvée. Aucun remboursement ni pro-rata n'est prévu. Si la boutique est ensuite rejetée/suspendue, le forfait payé est totalement perdu.
Impact : paiement réel encaissé sans contrepartie pour le client, friction support / litige ; bornage = montant du forfait (récupérable manuellement par admin).
Correctif attendu : refuser l'achat si `status !== 'approved'` (`failed-precondition`) côté callable, ou poser `tierPaidUntil` tout en démarrant la fenêtre seulement à l'approbation.

### Détail des P3

**B2 — `completeMeetup` écrit `'completed'` sur le message avant et indépendamment de la callable — P3**
Fichiers : `services/chatService.ts`, `functions/src/callable/payments.ts`, `components/OfferBubble.tsx`.
`chatService.completeMeetup` (`chatService.ts:1259-1263`) fait `updateDoc(message,{'offer.meetup.completedAt':new Date(),'offer.status':'completed'})` de façon INCONDITIONNELLE, AVANT de résoudre la transaction. Ensuite `findMeetupTransactionId(...,['meetup_confirmed'])` (`1269-1271`) : si aucune tx `meetup_confirmed` n'existe, la callable est SKIPPÉE (`1275-1277`) ; si la callable est appelée mais que la tx a entre-temps été annulée/disputed, `completeMeetupTransaction` lève « Cannot complete meetup from status ... » (`payments.ts:2812-2816`) — mais l'écriture message n'est PAS rollback.
Scénario : un `meetup_confirmed` est auto-annulé par le scheduler 7 jours (`transactionExpiration.ts:204-241`, article libéré, tx=`cancelled`) tandis que le message conserve `confirmedAt` et `completedAt` non posé ; le bouton « Terminer » reste visible (`OfferBubble.tsx:400-401` gating sur `meetup.confirmedAt`). En tapant « Terminer », le message passe à `status='completed'`/`completedAt` et `OfferBubble` affiche le badge « Transaction terminée » (`OfferBubble.tsx:610-614`) alors que la transaction réelle est `cancelled`/`disputed`/`meetup_pending`.
Impact métier : divergence cosmétique d'état (badge « terminée » sur une vente annulée ou en litige) et perte du recours no-show pour cette bulle (boutons masqués car `status≠'accepted'`). AUCUN impact financier (le meetup ne crédite rien). Contredit l'intention d'atomicité revendiquée pour `confirm` (P1-5/P1-6, `payments.ts:2646`) qui n'a pas été appliquée à la complétion côté client.

**B3 — Débit wallet temporairement bloqué si le compte Stripe vendeur devient impayable en cours de checkout mixte — P3**
Fichier : `functions/src/callable/payments.ts`.
Dans `createStripeCheckout` (branche mixte), le `runTransaction` (`payments.ts:1094-1279`) débite le wallet et commit `walletAmountUsed`/`paidVia` AVANT la vérification du compte Stripe vendeur (`payments.ts:1304-1316`). Si le vendeur n'a pas/plus de `stripeAccountId`, la fonction throw `HttpsError('failed-precondition')` à la ligne `1311` SANS revert immédiat (le bloc try/revert F05 lignes `1360-1405` n'enveloppe QUE l'appel `stripe.paymentIntents.create`, pas le lookup vendeur). La part wallet reste débitée tant que la tx est en `pending_payment`.
Scénario : acheteur sélectionne « utiliser mon solde », le vendeur a été désactivé Stripe après la création de la commande → wallet débité, paiement impossible.
Atténuation forte : `createTransaction` (`payments.ts:922-942`) exige déjà `stripeAccountId` ET `stripeChargesEnabled===true` pour toute transaction shipping AVANT de verrouiller l'article, donc atteindre `1311` avec un wallet débité suppose une désactivation du vendeur entre création et checkout (fenêtre étroite).
Impact métier : pas de perte d'argent — la part wallet est restituée par `cancelPendingTransaction` (`payments.ts:3687-3710`) ou au plus tard par l'expiration 1h (`transactionExpiration.ts:637-659`). Le défaut est une immobilisation temporaire du solde (jusqu'à 1h) et une UX confuse, pas une perte.
Correctif suggéré : déplacer le lookup du compte vendeur AVANT le débit wallet (dans le `runTransaction`), ou ajouter un revert wallet sur ce throw.

**B5 — Débit wallet sans garde anti-double-retrait concurrent (réserve, pas un bug) — P3**
Fichier : `functions/src/callable/wallet.ts`.
Deux appels `walletWithdraw` quasi-simultanés du même vendeur lisent chacun le solde dans son propre `runTransaction`. La cohérence balance est assurée par le `runTransaction` Firestore (`402-404` re-vérifie `balance<amount` sur snapshot transactionnel, donc pas de solde négatif). Les `idempotencyKeys` transfer/payout sont liées à des `ledgerEntryRef` DISTINCTS par appel, donc deux retraits légitimes distincts (pas un retry) produisent deux transfer+payout — comportement correct tant que le solde couvre les deux. Aucun double-paiement du MÊME retrait (clés déterministes par ledger).
Pas de bug de perte d'argent ; signalé seulement comme réserve : la seule borne contre l'abus de débit rapide est le rate-limit 5/min (`wallet.ts:297-302`). Aucune action requise si comportement voulu.

**B6 — Commentaire trompeur sur le chemin `amount_mismatch` trop-payé — P3**
Fichier : `functions/src/http/webhooks.ts`.
`webhooks.ts:585-586` commente « we additionally auto-refund the difference idempotently », mais l'appel à `issueTransactionRefund` (`:621-628`) ne passe AUCUN `cardRefundAmountCents` → refund de la TOTALITÉ de la charge capturée, pas seulement l'excédent.
Scénario : acheteur paie 110$ au lieu de 100$ attendus ; le code lui rembourse 110$ et la vente est annulée (tx jamais `paid`), au lieu de rembourser 10$ et finaliser à 100$. Comportement réel = annulation complète favorable à l'acheteur et déterministe (aucune perte : la charge entière retourne à l'acheteur, aucun crédit vendeur n'a eu lieu). Le défaut est purement documentaire (le commentaire ne décrit pas ce que fait le code), pas un mouvement d'argent faux.
Impact : aucun impact financier (acheteur rendu entier, vendeur pas faussement débité). Risque de maintenance : un futur dev se fiant au commentaire pourrait croire qu'un remboursement partiel est implémenté.

**B7 — Statut `'lost'` jamais produit (branche défensive morte) — P3**
Fichiers : `functions/src/callable/recourse.ts`, `functions/src/utils/trackingTransition.ts`.
`recourse.ts:54` autorise `requestRefund` pour status `'delivery_failed'` OU `'lost'`, mais aucun chemin n'écrit jamais `status='lost'` sur une transaction (recherche exhaustive : seul `'delivery_failed'` est posé, `trackingTransition.ts:184`). Le cas reste fonctionnel via `'delivery_failed'`. La branche `'lost'` est donc inerte — ni bug d'argent ni blocage, juste du code défensif non atteignable. À surveiller si un mapping transporteur `'lost'` était ajouté plus tard sans tests.
Impact : nul aujourd'hui ; tout colis perdu/échec passe par `'delivery_failed'` qui est couvert. Aucune commande bloquée. Simple dette de cohérence.

**B8 — `balanceAfter` du ledger `refund_debit` faux quand un résiduel gelé est restitué dans la même transaction (LOST) — P3**
Fichier : `functions/src/http/webhooks.ts`.
Scénario : litige PERDU (chargeback) sur une vente dont une partie était gelée (`disputeFreezeCents`) et où le débit consomme moins du `heldBalance` que le montant gelé (ex. tx partiellement créditée). `webhooks.ts:1866` écrit le ledger `refund_debit` avec `balanceAfter=(balanceNow - fromBalance)`, PUIS lignes `1883-1897` un second update libère `releaseResidual` vers `balance` et écrit un ledger `dispute_hold_released` avec `balanceAfter=(balanceNow - fromBalance) + releaseResidual`. Le `balanceAfter` du premier ledger (`refund_debit`) ne reflète donc pas le solde final réel après la libération du résiduel intervenue dans la même `runTransaction`.
Impact métier : purement cosmétique / audit — le champ `balanceAfter` est informatif et n'est pas relu pour calculer le solde (les soldes utilisent `FieldValue.increment`, source de vérité = doc wallet). Aucun argent perdu/dupliqué, aucun blocage. À corriger uniquement pour la cohérence de l'historique affiché au vendeur.

**B11 — Re-souscription identique dans la fenêtre d'idempotence Stripe (24h) silencieusement dédupliquée — P3**
Fichier : `functions/src/callable/shopTier.ts`.
La clé d'idempotence est déterministe par `(shopId, tier, periodMonths)` (`shopTier.ts:133`). Stripe conserve ces clés ~24h.
Scénario : un propriétaire achète « pro 3 mois », paie ; quelques heures plus tard il rachète exactement « pro 3 mois » pour étendre. Stripe renvoie le MÊME `PaymentIntent` déjà `succeeded` ; le client reçoit un `clientSecret` d'un PI déjà payé, la confirmation ne génère ni nouvelle charge ni nouvel event `payment_intent.succeeded`, et même s'il en générait un le webhook no-op (`tierPaymentIntentId` identique, `webhooks.ts:1334`). Résultat : pas de double-charge (bon), MAIS l'extension attendue n'a pas lieu et l'UI affiche « Forfait activé » (`upgrade.tsx:203-207`) alors que `tierPaidUntil` n'a pas bougé.
Impact : pas de perte d'argent, incohérence UX / attente client sur un renouvellement court terme. Au-delà de 24h la clé expire et le renouvellement fonctionne normalement.
Correctif possible : rendre la clé unique par tentative (ex. suffixe horodaté/compteur) pour les renouvellements, ou bloquer un renouvellement tant que le PI précédent n'est pas terminé.

---

## 4. Détail par flux — étapes vérifiées et preuves

### 4.1 Achat — livraison (carte) · OK avec réserve (B1)

| Étape | Verdict | Preuve |
|-------|---------|--------|
| (1) L'acheteur paie le bon total = prix + livraison + frais service + taxe (si activée) | OK | `functions/src/utils/fees.ts:192-233` `calculateFees` → `buyerTotal = articlePrice + shippingCost + serviceFee + tax.taxTotal` (`l.211-213`). `createTransaction` calcule le même total (`payments.ts:955-966`). `createStripeCheckout` RE-calcule autoritairement côté serveur (`payments.ts:1153-1157`), écrit `totalAmount=buyerTotal` (`l.1257`) puis charge `totalChargeCents=round(buyerTotal*100)` (`l.1319,1449`). Livraison JAMAIS issue du client : re-tarifée via ShipEngine (`payments.ts:769-858`, `serverShippingCost=matchedRate`). Frais réduits via `buyerFeeReduction` boutique côté serveur uniquement. Taxe=0 si `TAX_ENABLED=false` (`fees.ts:100`). |
| (2) L'article se verrouille (pas de double-vente) | OK | `createTransaction` (`payments.ts:862-1016`) `runTransaction` : `tx.get(articleRef)` puis garde `isSold===true` → `HttpsError` « déjà vendu » (`l.871-873`), `isActive===false` rejeté (`l.875`), `sellerId===buyerId` rejeté (`l.879`), puis `tx.update(articleRef,{isSold:true})` (`l.946`) atomiquement avant `set transaction`. Le webhook re-marque `isSold:true`+`soldAt` à paiement (`webhooks.ts:508-514`). `payWithWallet` idem (`wallet.ts:765-770`). |
| (3) Au paiement réussi, le vendeur n'est PAS payé tout de suite mais après création de l'étiquette | OK | `handlePaymentIntentSucceeded` (`webhooks.ts:494-497`) : `creditSellerForSale` n'est appelé QUE si `deliveryType !== 'shipping'`. Pour shipping, crédit différé, uniquement dans `createLabelIdempotent` phase COMMIT (`labelFulfillment.ts:419`) après création réussie du label. Modèle deferred-credit documenté (`webhooks.ts:483-489`). |
| (4) L'étiquette est créée UNE seule fois et la plateforme la paie | OK | Rail carte : `createLabelIdempotent` (`labelFulfillment.ts:334-458`) en 3 phases — RESERVE atomique avec TTL 5min (`l.353-380`), CREATE externe exactement une fois car réservation détenue (`l.390`), COMMIT atomique re-vérifie (`l.410-417`). Sur erreur commit après création, persiste `shipEngineLabelId` best-effort SANS libérer la réservation (`l.442-453`). `sweepPendingLabels` (`sweepPendingLabels.ts:327`) et le webhook partagent ce helper. Plateforme paie : charge single-rail sur compte plateforme, pas de `transfer_data`/`application_fee` (`payments.ts:1438-1464`). |
| (5) Le tracking avance label_created → expédié → livré | OK | `applyTrackingOutcome` (`trackingTransition.ts:79-243`). `label_created`/`paid` + scan `IN_TRANSIT`/`TRANSIT` → `status:'shipped'`+`shippedAt` (`l.208-223`). `DELIVERED` + status `∈ DELIVERABLE_STATUSES` → `status:'delivered'`+`deliveredAt` (`l.87-126`). `FAILURE`/`EXCEPTION` → `delivery_failed`+`disputed:true`, fonds NON libérés (`l.166-204`). Idempotent et status-gardé, partagé poller/callable/webhook. |
| (6) À la livraison, fonds en fenêtre de litige 7j puis retirables | OK | À `DELIVERED`, `applyDeliveredHeldFunds` (`releaseHeldFunds.ts:77-109`) déplace `pendingBalance→heldBalance` du montant EXACT crédité (`creditedCents`, `trackingTransition.ts:110-139`) et stampe `fundsReleaseAt = deliveredAt + DISPUTE_WINDOW_MS` (7j, `l.43,105`). `releaseHeldFunds` scheduled (`l.111-318`) query `status=='delivered' & fundsReleaseAt<=now`, re-vérifie `disputed`/status/`fundsReleasedAt` dans la transaction (`l.179-181`), déplace `heldBalance→balance` plafonné à `heldNow` (`l.195-196`) puis `status:'completed'`. `disputed`/`delivery_failed`/`lost`/`refunded` bloquent (`l.53-58,152`). |
| (7) La plateforme conserve son frais de service | OK | `sellerPayout = articlePrice` (`fees.ts:216`, `sellerCreditedCents=round(sellerPayout*100)` `labelFulfillment.ts:59-61`). Le vendeur ne reçoit JAMAIS le `serviceFee` ni le `shippingCost`. La charge plateforme encaisse `buyerTotal` entier (`payments.ts:1438-1449`) ; `serviceFee`/`taxTotal`/`shippingCost` restent à la plateforme et journalisés dans `platform_ledger` via `recordTransactionRevenue` (`labelFulfillment.ts:223-305`). |
| (8) Aucun argent créé ni perdu, vendeur payé une seule fois | OK | `creditSellerForSale` idempotent via `sellerCreditedCents` (`labelFulfillment.ts:54-56`). Crédit pending = held = release : pas de drift. Variance label réel vs estimé absorbée par la marge plateforme et journalisée (`reconcileShippingCost` `labelFulfillment.ts:145-197`), pas un transfert vendeur/acheteur. Seul écart : le rail 100%-portefeuille (voir B1) n'utilise pas la création de label idempotente. |

### 4.2 Achat — meetup (main propre) · OK avec réserve (B2)

| Étape | Verdict | Preuve |
|-------|---------|--------|
| (1) Pas de frais de livraison en main propre | OK | `app/checkout/meetup.tsx:155-162` n'appelle JAMAIS `createTransaction` — envoie seulement une offre via `sendMeetupOffer` (aucun `shippingCost`, aucune adresse). À l'acceptation, `payments.ts:2588-2591` fixe `shippingCost:0, serviceFee:0, totalAmount:amount, sellerPayout:amount`. Branche `createTransaction` meetup (`payments.ts:955-966,981`) : `fee=0, shipping=0, tax=0, buyerFeeReduction=0`. Aucune ligne de frais dans le résumé meetup (`meetup.tsx:340-417`). |
| (2) L'article se verrouille à la création de la transaction | OK | `acceptMeetupOffer` verrouille `tx.update(articleRef,{isSold:true})` à `payments.ts:2580`, au moment exact de la création de la transaction (`tx.set newTxRef` `payments.ts:2611-2612`). Choix assumé : l'offre seule ne verrouille PAS (`meetup.tsx:146-149,166-167` commentaire F8) — pré-verrouiller créait un cul-de-sac « déjà vendu ». Le verrou est à la création de la TRANSACTION, pas à l'envoi de l'offre. |
| (3) Offre meetup acceptable par l'autre partie (pas de cul-de-sac) | OK | `acceptMeetupOffer` `payments.ts:2509-2519` : le caller doit être différent de `message.senderId` et faire partie de `{buyerId,sellerId}` — acheteur OU vendeur (contre-offre) peut accepter. F8 (`payments.ts:2540-2567`) : si une transaction meetup non annulée existe déjà (flux pré-créé legacy), l'offre est acceptée et la tx réutilisée (`reused:true`). `chatService.sendMeetupOffer:755` pose `offer.status='pending'`, `expiresAt` 48h (`chatService.ts:728`). |
| (4) Transaction créée à l'acceptation, buyer/seller dérivés correctement | OK | `payments.ts:2497-2507` : `sellerId = articleData.sellerId` (dérivé de l'ARTICLE, pas de l'émetteur de l'offre — protège contre une contre-offre vendeur qui mésétiquetterait les rôles, F9 `2494-2496`), `buyerId` = autre participant du chat, rejet si `buyerId===sellerId`. Transaction posée avec ces rôles `payments.ts:2583-2596`. |
| (5) Confirmation par les parties → vendeur crédité | OK | Divergence ASSUMÉE et correcte : `completeMeetupTransaction` `payments.ts:2821-2832` NE crédite JAMAIS le wallet vendeur (ni `balance` ni `pendingBalance`, aucun ledger) car meetup = cash en main propre, aucun argent ne transite par la plateforme. Créditer ici serait un crédit fantôme/double. Le flux : `confirmMeetupTransaction` (vendeur, `payments.ts:2691-2725`) `meetup_pending→meetup_confirmed` ; puis `completeMeetupTransaction` (acheteur OU vendeur, `payments.ts:2807-2832`) `meetup_confirmed→meetup_completed`. Le « crédit vendeur » attendu par l'énoncé n'a pas lieu — conforme au modèle cash, d'où la réserve sur le wording, pas un bug. |
| (6) Aucun état zombie (article `isSold` bloqué pour toujours) | OK | Double filet : `scheduled/transactionExpiration.ts:101-145` annule `meetup_pending > 48h` (`status='cancelled'`, `cancelReason='meetup_expired_48h'`, `isSold=false` re-check atomique `123,136-137`) ; lignes `204-244` annulent `meetup_confirmed > 7 jours` (`cancelReason='meetup_confirmed_expired_7d'`, `isSold=false` `239-241`). `reportMeetupNoShow` `payments.ts:2999-3002` débloque aussi l'article. Une offre jamais acceptée ne verrouille jamais l'article (pas de tx). |
| (7) Un no-show a une issue | OK | `reportMeetupNoShow` `payments.ts:2985-3021` : tx→`'disputed'` (gelée, terminal-meetup), `isSold=false` (article re-listable), ouverture d'un doc `disputes` pour revue humaine (`reportedBy`/`reportedAgainst`). Réservé aux statuts `meetup_pending`/`meetup_confirmed` (`MEETUP_REPORTABLE_STATUSES 2887`, check `2966`), idempotent. Bouton exposé aux deux parties (`OfferBubble.tsx:594-607`). Aucun argent à rembourser (cash). Pour une offre jamais acceptée, pas de no-show nécessaire : article jamais verrouillé, offre expire (48h). |

**Réserve (B2) :** la complétion côté client (`chatService.completeMeetup`) écrit le statut `'completed'` sur le message indépendamment de la résolution backend → divergence cosmétique d'état possible. Aucun impact financier.

### 4.3 Paiement — portefeuille (wallet 100% & mixte) · OK avec réserve (B3)

| Étape | Verdict | Preuve |
|-------|---------|--------|
| (1a) Acheteur paie 100% avec le solde wallet | OK | `app/payment/[transactionId].tsx:141,164-181` — `walletCoversAll = useWalletBalance && walletBalanceCents >= totalAmountCents` route vers `WalletService.payWithWallet(transaction.id)`. Serveur `wallet.ts:716-762` calcule `totalAmountCents=round(totalAmount*100)`, vérifie balance suffisante (`722`), débite (`740-743`), crédite le vendeur (`753` non-shipping), passe la tx en `'paid'` avec `paidVia='wallet'` et `walletAmountUsed` (`757-762`). |
| (1b) Acheteur paie en mixte wallet + carte | OK | `app/payment/[transactionId].tsx:145-147,184-191` — `walletAmountCents = min(balance,total)` envoyé comme `walletAmount` à `createStripeCheckout`. `payments.ts:1188-1244` valide `walletAmount < totalCharge` (`1189`), refuse un reste carte < 50c CAD (`1203`, F24), vérifie le solde (`1221`), débite (`1227-1230`) et stampe `walletAmountUsed`/`paidVia='wallet_and_card'` (`1264-1267`) DANS le `runTransaction` ; puis crée un PaymentIntent pour `stripeChargeCents = total - walletAmount` (`1333,1344-1359`). |
| (2) Débit wallet EXACT et jamais deux fois (même en retry) | OK | 100% wallet : garde de statut `wallet.ts:696` (`status !== 'pending_payment'` → throw) : une fois `'paid'`, un retry est rejeté, pas de second débit. Mixte : `payments.ts:1171-1187` traite un `walletAmountUsed` déjà enregistré comme preuve du débit (`alreadyDebitedAmount>0` → `walletDebited=true` sans re-débit, exige le même montant `1181`) ; PaymentIntent créé avec `idempotencyKey 'pi_'+transactionId` (`1358`) → Stripe renvoie le PI d'origine. Débit en cents entiers (`Math.round`). Test `createStripeCheckout.mixed.test.ts:164` confirme balance `100000→99100` pour un débit de 900. |
| (3) Échec création paiement carte → restitution de la part wallet | OK | `payments.ts:1360-1405` (F05/F23) — sur échec `stripe.paymentIntents.create`, un `runTransaction` unique re-crédite la balance (`FieldValue.increment(+effectiveWalletAmount)` `1388-1391`), écrit un ledger `refund_credit` (`1393-1401`) ET purge `walletAmountUsed`/`paidVia` (`1380-1383`) atomiquement. Test `createStripeCheckout.mixed.test.ts:170-186` vérifie balance restaurée à 100000 et `walletAmountUsed undefined`. |
| (4) Abandon de l'acheteur → restitution de la part wallet | OK | (a) Annulation explicite : `payments.ts:3524` `cancelPendingTransaction` annule d'abord le PI (`3578-3621`), puis re-crédite la balance + ledger `refund_credit` et purge les marqueurs wallet (`3655-3710`, F03/F73), atomique. (b) Expiration 1h : `transactionExpiration.ts:523` `expirePendingPayment` annule le PI (`563-581`) puis restitue `walletAmountUsed` (`637-659`) et purge les marqueurs (`627-630`), idempotent via garde `status==='pending_payment'` (`590`). La part wallet n'est jamais perdue. |
| (5) Le vendeur est crédité correctement (et une seule fois) | OK | `labelFulfillment.ts:47-128` `creditSellerForSale` crédite l'INTÉGRALITÉ de `sellerPayout` (=montant article, 100%) en `pendingBalance`, indépendamment du split wallet/carte ; idempotent via `sellerCreditedCents` (`54-56`). Appelé : 100% wallet non-shipping `wallet.ts:753`, shipping au label `wallet.ts:837` ; carte/mixte via webhook `webhooks.ts:495-497`. Le surplus (frais+taxe) reste à la plateforme (single-rail). Aucun double crédit. |

**Réserve (B3) :** le débit wallet (mixte) précède le lookup du compte Stripe vendeur ; une désactivation vendeur en cours de checkout peut immobiliser la part wallet jusqu'à 1h (restituée, jamais perdue).

### 4.4 Vendeur — payout (white-label, retrait) · OK avec réserve (B4, B5)

> Les données fournies pour ce flux étape-par-étape sont tronquées à l'étape (1) (« Le vendeur configure identité + banque sans aller sur Stripe (white-label) » — verdict OK, preuve coupée à `functions/src/callable/`). Le verdict global du flux est **OK avec réserve** (B4 P2, B5 P3 réserve seule). Les détails complets des étapes (2)+ ne sont pas disponibles dans les données de cette vérification et ne sont donc pas reconstitués ici pour ne rien inventer.

| Étape | Verdict | Preuve |
|-------|---------|--------|
| (1) Le vendeur configure identité + banque sans aller sur Stripe (white-label) | OK | `functions/src/callable/…` (preuve tronquée dans les données source). Modèle Stripe Connect Custom confirmé : onboarding/ajout de banque/statut 100% in-app, le vendeur ne va jamais sur le dashboard Stripe. |

**Réserves :**
- **B4 (P2)** — `walletWithdraw` ne bloque pas sur `disabledReason`/`status='restricted'` : le gate ne lit que les booléens `stripeChargesEnabled`/`stripePayoutsEnabled` et peut laisser passer un retrait sur un compte affiché `restricted` (fenêtre transitoire avant que Stripe ne coupe `payouts_enabled`). Stripe rejette généralement → revert ; incohérence d'état.
- **B5 (P3, réserve seule)** — pas de garde anti-double-retrait concurrent au-delà du rate-limit 5/min ; le `runTransaction` empêche tout solde négatif et les clés d'idempotence sont déterministes par ledger → pas de double-paiement du même retrait. Aucune action requise si comportement voulu.

### 4.5 Remboursements · OK avec réserve (B6, B7)

Le chemin nominal de remboursement fonctionne : sur trop-payé (`amount_mismatch`), la charge entière retourne à l'acheteur via `issueTransactionRefund` (`webhooks.ts:621-628`), aucun crédit vendeur n'a eu lieu, la vente est annulée — acheteur rendu entier, déterministe. Les colis perdus/échec passent par `delivery_failed` couvert par `requestRefund` (`recourse.ts:54`).

**Réserves :**
- **B6 (P3)** — commentaire trompeur (« rembourser la différence ») alors que le code rembourse la charge entière. Dette documentaire, pas de mouvement d'argent faux.
- **B7 (P3)** — statut `'lost'` autorisé dans `AUTO_REFUNDABLE_STATUSES` mais jamais produit par le code (branche défensive morte). Aucun impact ; à surveiller si un mapping transporteur `'lost'` est ajouté plus tard.

### 4.6 Litiges — résolution · OK avec réserve (B8)

Le gel des fonds en litige est correct (pas de perte ni duplication, soldes via `FieldValue.increment`, source de vérité = doc wallet).

**Réserve :**
- **B8 (P3)** — sur litige PERDU avec résiduel gelé restitué dans la même transaction (LOST), le `balanceAfter` du ledger `refund_debit` ne reflète pas le solde final réel (`webhooks.ts:1866` vs `1883-1897`). Champ purement informatif, non relu pour le calcul des soldes. Cosmétique / audit.

### 4.7 Swaps · OK avec réserve (B9)

Le cycle de vie nominal d'un swap (gel du complément, libération `completed`, expiration des swaps post-acceptation non finalisés) est couvert par les schedulers. L'argent est correctement gelé en litige.

**Réserve :**
- **B9 (P2)** — un swap `disputed` n'a aucun timeout automatique : la seule sortie est `resolveSwapDispute` réservé admin (`swaps.ts:1724,1733-1740`), aucun cron ne traite `disputed`. L'invariant « jamais bloqué indéfiniment » repose sur un SLA humain non codé. Articles engagés + complément gelés sine die si litige oublié. Recommandation : alerting sur l'ancienneté des disputes (sans auto-trancher).

### 4.8 Boutique — forfait · OK avec réserve (B10, B11)

L'achat de forfait nominal fonctionne (PaymentIntent, webhook `handleShopTierSucceeded` stampe `tier`+`tierPaidUntil`, réduction des frais acheteur active dès `status==='approved'` via `reductionForShopDoc`). Pas de double-charge grâce à l'idempotence Stripe.

**Réserves :**
- **B10 (P2)** — une boutique non approuvée (`pending`/`rejected`/`suspended`) peut payer un forfait (jusqu'à ~959$ pour 12 mois « La Maison ») sans jamais recevoir de réduction (`reductionForShopDoc` renvoie 0 tant que `status !== 'approved'`), sans remboursement ni pro-rata. Argent encaissé sans contrepartie. Correctif : refuser l'achat si `status !== 'approved'`, ou démarrer la fenêtre seulement à l'approbation.
- **B11 (P3)** — re-souscription identique dans la fenêtre d'idempotence Stripe (24h) silencieusement dédupliquée : pas de double-charge, mais l'extension attendue n'a pas lieu alors que l'UI affiche « Forfait activé ». Incohérence UX sur renouvellement court terme.

---

## 5. Annexe — faux positifs réfutés

**Aucun.** Aucun bug n'a été écarté comme faux positif au terme de la réfutation adversariale : la liste des candidats fournie ne contenait pas de cas réfuté. Les 11 points retenus (B1–B11) ont tous survécu à la contre-épreuve, dont B5 conservé explicitement comme **réserve** (et non comme bug actif).

---

## 6. Conclusion

**Chaque besoin métier est-il correctement implémenté ?**
Oui, sur le **chemin nominal** de chacun des 8 flux. Les invariants financiers cœur sont respectés :
- débit acheteur exact et autoritaire côté serveur (livraison re-tarifée, jamais issue du client) ;
- verrou article atomique anti-double-vente ;
- crédit vendeur unique et idempotent, différé après création d'étiquette pour la livraison ;
- frais de service et taxe conservés par la plateforme (modèle single-rail) ;
- fonds placés en fenêtre de litige 7j puis libérés ;
- aucun argent créé ni perdu, aucune duplication de paiement vendeur ;
- meetup = cash, aucun crédit fantôme (conforme, malgré le wording attendu) ;
- portefeuille (100% et mixte) : débit exact, restitution garantie en cas d'échec/abandon.

**Quels bugs restent à corriger avant test manuel ?**
Aucun P0/P1. Les corrections prioritaires (P2) avant un test manuel sérieux :
1. **B1** — migrer `payWithWallet` (livraison portefeuille) vers `createLabelIdempotent` pour fermer la fenêtre « label payé orphelin + commande gelée invisible au recovery ».
2. **B4** — durcir le gate `walletWithdraw` sur `disabledReason`/`status='restricted'` (ne pas se fier au seul booléen `payoutsEnabled`).
3. **B9** — ajouter une visibilité/alerting sur l'ancienneté des swaps `disputed` (timeout/queue), pour ne pas dépendre d'un SLA humain non codé.
4. **B10** — refuser l'achat de forfait sur une boutique non approuvée (ou ne démarrer la fenêtre qu'à l'approbation), pour éviter d'encaisser un forfait sans contrepartie.

Les P3 (B2, B3, B5, B6, B7, B8, B11) sont de la dette de cohérence, des fenêtres très étroites sans perte d'argent, ou des réserves documentaires : à traiter, mais non bloquants pour un test manuel.

**Rappel :** cette vérification est statique. Les fenêtres de crash (B1, B3) et les transitions Stripe (B4) devraient être confirmées en conditions runtime/device avant déploiement — rien n'est déployé à ce stade.
