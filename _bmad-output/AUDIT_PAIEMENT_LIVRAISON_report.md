All key references confirmed against real code. The swap top-up uses `transfer_data.destination` (line 611) AND credits the wallet `pendingBalance` (webhook 557), the shipping cost is taken directly from client input (`shippingCost || 0`, line 289) with no server re-pricing, and Connect uses `type: 'custom'` (line 848). The findings are accurate. I have everything needed to write the report.

---

# Rapport de production-readiness — Paiement + Livraison (Second)

> Système : marketplace C2C canadienne, Firebase `seconde-b47a6`, Cloud Functions v2 `northamerica-northeast1`, Stripe Connect Standard (destination charges + `application_fee_amount`), ShipEngine multi-carrier, wallet interne (`seller_balances` + ledger). Toutes les références `fichier:ligne` ont été vérifiées dans le code réel.

---

## 1. Verdict global

**NON — le système n'est PAS production-ready.** Il existe au moins quatre failles de **création/perte d'argent directe et exploitable** (meetup qui crédite un solde retirable sans encaissement, coût de livraison piloté par le client, double-paiement vendeur sur swap top-up, refund sans `reverse_transfer`), aucune protection contre les pertes asynchrones (pas de réconciliation, pas de dead-letter, pas de retry des labels), et zéro test d'intégration sur les chemins financiers les plus sensibles. Mettre ce système en production tel quel expose la trésorerie de la plateforme à une fuite illimitée et l'acheteur à des commandes payées jamais livrées sans recours.

**Décompte après vérification (sévérités corrigées par l'audit)** : **5 P0** · **31 P1** · **9 P2** · **1 P3**.
Note : les findings initiaux comptaient davantage de P0 ; plusieurs ont été rétrogradés en P1 par la vérification code (race conditions difficiles à déclencher, mitigations partielles existantes). Les 5 P0 retenus sont des pertes d'argent **certaines et exploitables**, pas des races.

---

## 2. Top P0 — Bloquants absolus (perte d'argent certaine et exploitable)

### P0-1 — Le meetup crédite un solde retirable sans aucun encaissement (création d'argent)
- **Fichier** : `functions/src/callable/payments.ts:1437-1443` (`completeMeetupTransaction`) + `payments.ts:288-302` (`createTransaction`)
- **Impact** : Une transaction meetup est créée avec `status='meetup_pending'`, `serviceFee=0`, **sans PaymentIntent ni débit acheteur**. À la complétion, `completeMeetupTransaction` fait `tx.update(sellerWalletRef, { balance: FieldValue.increment(sellerPayoutCents) })` avec ledger `sale_available` (immédiatement retirable). Le vendeur peut ensuite `walletWithdraw` → vrai virement Stripe depuis la trésorerie plateforme vers sa banque. Le meetup étant un paiement cash hors-plateforme, la plateforme finance un payout pour de l'argent qu'elle n'a **jamais** encaissé. Exploitable à volonté avec 2 comptes complices (`createTransaction` ne bloque que `sellerId==buyerId` du même uid). **Perte illimitée.**
- **Fix** : Ne JAMAIS créditer de wallet retirable pour un meetup cash. `completeMeetupTransaction` doit seulement passer le statut à `meetup_completed` (débloquer l'avis) sans toucher `balance`/`pendingBalance`. Si un meetup payé en ligne est voulu, exiger un encaissement réel (PaymentIntent/escrow) avant. **Décision fondateur requise** : meetup = purement cash hors-ligne (recommandé) OU meetup payé en ligne.

### P0-2 — Le coût de livraison facturé est piloté par le client et jamais re-vérifié serveur
- **Fichier** : `functions/src/callable/payments.ts:289` (`shippingCost || 0` venant du client) + `webhooks.ts:362` (`createLabel` débite le coût réel du compte plateforme)
- **Impact** : `createTransaction` stocke `shippingCost` et `shipEngineRateId` tels qu'envoyés par le client, **sans appel à `shipEngine.getRates` pour re-tarifer**. Au webhook, `createLabel(rateId)` achète le label réel (8,50 $–14,50 $) sur le compte ShipEngine plateforme. Un acheteur (ou un bug client) passe `shippingCost=0.01` avec un vrai `rateId` → paie 1 cent, la plateforme absorbe ~14,49 $ par commande, répétable, sans trace ni alerte.
- **Fix** : Dans `createTransaction` (shipping), re-tarifer côté serveur via `shipEngine.getRates(sellerAddress, shippingAddress, parcel)`, retrouver le rate correspondant au `rateId`, stocker `shippingCost = rate.shippingAmount` (valeur serveur), rejeter si `rateId` introuvable/expiré.

### P0-3 — Double-paiement du vendeur sur swap top-up (destination charge + crédit wallet)
- **Fichier** : `functions/src/callable/swaps.ts:611` (`transfer_data: { destination: payeeData.stripeAccountId }`) + `webhooks.ts:557` (`pendingBalance: FieldValue.increment(baseAmountCents)`)
- **Impact** : `createSwapTopUpCheckout` crée un PaymentIntent avec **destination charge** → Stripe transfère automatiquement (montant − fee) sur le compte Connect réel du payee. PUIS `handleSwapTopUpSucceeded` crédite **encore** le wallet interne (`pendingBalance`), retirable via `walletWithdraw` (2e transfert Stripe). Pour chaque top-up de X $, le payee est payé **deux fois** ; la plateforme perd X $. Contraste : l'achat mixed (`payments.ts:560-572`) n'utilise justement PAS `transfer_data` pour éviter ce double crédit.
- **Fix** : Choisir UN seul rail. Recommandé : retirer `transfer_data.destination` du PaymentIntent swap top-up (charge directe plateforme, comme le mixed) et garder le crédit wallet ; les fonds sortent via `walletWithdraw`. Ne jamais faire les deux.

### P0-4 — Aucun rate limiting sur les callables financières
- **Fichier** : `payments.ts:368` (`createStripeCheckout`), `payments.ts:167` (`createTransaction`), `payments.ts:713` (`createStripeConnectAccount`), `wallet.ts:228` (`walletWithdraw`), `wallet.ts:428` (`payWithWallet`)
- **Impact** : `checkRateLimit`/`resolveCallerKey` (`utils/rateLimit.ts`) existent mais ne sont importés que dans `search.ts` et `ai.ts` (vérifié : 0 occurrence dans payments/wallet/webhooks). Un utilisateur authentifié peut spammer `createStripeConnectAccount` (chaque appel touche l'API Stripe `accounts.create`), `createStripeCheckout` (création massive de PaymentIntents = card-testing/fraude), brute-forcer `payWithWallet`/`walletWithdraw`, ou saturer `createTransaction` pour verrouiller le catalogue (`isSold=true`) en masse.
- **Fix** : Appliquer `checkRateLimit` en tête de chaque callable financière. Budgets serrés : `createStripeConnectAccount` 3/min, `createStripeCheckout` 10/min, `walletWithdraw` 5/min, `createTransaction` 20/min.

### P0-5 — Stripe Connect Custom au lieu de Standard
- **Fichier** : `functions/src/callable/payments.ts:848` (`type: 'custom'`)
- **Impact** : `accounts.create({ type: 'custom' })` contredit la décision documentée (CLAUDE.md : « 100 % Stripe Connect Standard », migration Sprint 6). Les comptes Custom font porter à la plateforme la responsabilité des litiges, du KYC et de la conformité — complexité et risque légal accrus pour un C2C. Techniquement fonctionnel (destination charges acceptent les deux), mais c'est une dette architecturale et de conformité.
- **Fix** : Migrer vers `type: 'standard'`. **Décision fondateur requise** : impact sur le flow d'onboarding (Standard = onboarding hébergé par Stripe, le vendeur gère son propre dashboard).

---

## 3. P1 — À corriger avant prod (groupés par thème)

### 3.A — Paiement (correctness & sécurité)

| # | Titre | Fichier:ligne | Impact | Fix |
|---|-------|---------------|--------|-----|
| P1-1 | Refund sans `reverse_transfer` | `transactionExpiration.ts:178` | En destination charge, sans `reverse_transfer`+`refund_application_fee`, l'argent reste chez le vendeur ; le wallet Firestore est débité → déséquilibre, plateforme absorbe la perte. `swaps.ts:694-699` montre le bon pattern. | Passer `{ reverse_transfer: true, refund_application_fee: true }`. |
| P1-2 | Pas d'idempotency key Stripe | `payments.ts:562,644` ; `wallet.ts:319,329` ; `transactionExpiration.ts:178` | Double-tap/retry → 2 PaymentIntents ou 2 transfers/payouts (double sortie d'argent). Le `runTransaction` écrit le PI **après** l'appel Stripe (`payments.ts:613/659`). | `idempotencyKey` déterministe : `pi_${txId}`, `tr_${ledgerId}`, `po_${ledgerId}`, `rf_${txId}`. |
| P1-3 | Pas de dédup webhook par `event.id` | `webhooks.ts:98-155, 205-258` | Idempotence reposant uniquement sur le statut transaction. `account.updated` (1020-1085) n'a aucune garde → rejouable à l'infini ; trous sur transitions complexes. Aucune collection `stripe_events` (grep vide). | Create idempotent `stripe_events/{event.id}` dans le `runTransaction` ; si existe → no-op. |
| P1-4 | Refund mixte : portion carte non re-créditée + vendeur débité du payout complet | `webhooks.ts:835-865, 867-907` | En mixte, le crédit vendeur = prix complet alors que la charge ne couvre que (total − wallet). Au refund, l'acheteur ne récupère que sa portion wallet et le vendeur est débité du payout complet (capé par `min()`) → perte plateforme si déjà retiré. | Tracer la portion wallet vs carte ; débiter le vendeur exactement de ce qui a été crédité. *(Note : actuellement non atteignable — pas de top-up acheteur, cf. P2.)* |
| P1-5 | Dispute : fonds non gelés + pas de handler `dispute.closed` | `webhooks.ts:701-759, 127-129` | Pendant une dispute le vendeur peut retirer (`walletWithdraw` ne vérifie pas le statut). Dispute gagnée → transaction `disputed` à vie ; perdue → fonds déjà retirés, plateforme absorbe le chargeback. | Geler les fonds (`heldBalance`) sur `dispute.created` ; ajouter handler `charge.dispute.closed` (won → restaurer/débloquer, lost → débit définitif). |
| P1-6 | `walletWithdraw` sans garde de statut transactionnel | `wallet.ts:286-314` | Ne vérifie que `wallet.status==='active'` et `balance>=amount`. Aucun gel litige, aucun délai post-livraison → cash-out de fonds litigieux avant résolution. | Champ `heldBalance`/`disputedBalance` distinct ; ne retirer que le solde réellement libre. |
| P1-7 | Pas de handler `payout.failed`/`payout.paid` | `webhooks.ts:98-155` ; `wallet.ts:329-339` | Payout créé en synchrone et considéré réussi. Si échec async (RIB invalide) le wallet est déjà débité → vendeur perd l'argent sans réconciliation. | Handlers `payout.failed` (re-créditer + `withdrawal_failed`) / `payout.paid` ; créer `withdrawal_requests='processing'` dans la transaction de débit. |
| P1-8 | Refund expiration hors `runTransaction` | `transactionExpiration.ts:176-204` | `refunds.create` (178) avant le `runTransaction` (204). Crash entre les deux → acheteur remboursé carte, wallet non re-crédité, statut reste `paid`, re-tentative au run suivant. | `idempotencyKey rf_${txId}` + flag `stripeRefundIssuedAt` persisté avant l'appel. |
| P1-9 | Reversal de transfer non sûre | `wallet.ts:365-388` | Si transfer réussit mais payout échoue, reversal tenté sans vérifier son succès ; le wallet est re-crédité inconditionnellement → argent à la fois sur Connect et dans le wallet. | Vérifier le statut de la reversal via l'API avant de re-créditer. |
| P1-10 | Montant négocié non lié à une offre acceptée | `payments.ts:234-250` | `createTransaction` accepte tout `amount` ∈ ]0, prix affiché] sans lire aucune offre `accepted`. Un acheteur peut créer une transaction à 0,01 $ sur un article à 200 $, verrouillant `isSold=true`. | Si `amount !== prix`, exiger et vérifier serveur l'existence d'une offre `accepted` (buyer/article/montant), lier par id. |
| P1-11 | Mismatch montant webhook : throw sans dead-letter | `webhooks.ts:222-240` | Throw → 500 → retries Stripe en boucle ~3 j puis abandon silencieux. Mismatch légitime (bug fee/arrondi) → paiement capturé jamais marqué `paid`, vendeur jamais crédité, article bloqué. | Persister `payment_anomalies` AVANT throw ; distinguer erreur transitoire (5xx retry) vs déterministe (200 + dead-letter). |

### 3.B — Livraison (correctness)

| # | Titre | Fichier:ligne | Impact | Fix |
|---|-------|---------------|--------|-----|
| P1-12 | Achat label non atomique, aucun retry, aucun refund | `webhooks.ts:342-404` ; `wallet.ts:587-679` | Vendeur déjà crédité (`pendingBalance`) ; si `createLabel` échoue → `labelCreationPending=true`, statut reste `paid`, **aucun job ne reprend**. Commande figée 0-7 j avant l'expiry. | Job `sweepPendingLabels` (retry createLabel + compteur) ; après N échecs : refund + débit pending + release article. |
| P1-13 | `labelCreationPending` jamais balayé | `webhooks.ts:354,393` ; `wallet.ts:597,661,675` | Flag posé à 5 endroits, lu nulle part. Aucun scheduled ne le traite (vérifié). Acheteur payé, aucun label, aucune notif. | Voir P1-12 (même job). |
| P1-14 | Fallback `rateId` accepté → payé sans label | `webhooks.ts:348-357` ; `wallet.ts:591-599` | Quand ShipEngine est down au devis, le client génère un `fallback_*` rateId (montants hardcodés 8,50 $/14,50 $) ; le paiement passe, label jamais créé. Scénario utilisateur normal (panne ShipEngine). | Bloquer le checkout si `rateId.startsWith('fallback_')` AVANT capture ; ou intégrer au job de retry/refund. |
| P1-15 | Job tracking sans pagination (limit 200, pas d'`orderBy`) | `trackingCheck.ts:42-46` | `where('status','==','shipped').limit(200)` sans `orderBy`/curseur → toujours le même sous-ensemble. Au-delà de 200 colis `shipped`, livraisons jamais détectées → fonds vendeur jamais libérés. S'aggrave avec le volume. | `orderBy('shippedAt','asc')` + `startAfter` persisté entre runs (l'index `status+createdAt` existe déjà). |
| P1-16 | Aucun flux retour / colis perdu / FAILURE | `shipEngine.ts:336-337` ; `trackingCheck.ts:72-173` ; `payments.ts:1264-1360` | `mapStatus` mappe `EX→FAILURE` mais les pollers ne traitent QUE `DELIVERED` ; un FAILURE reste `shipped` à vie sans remboursement ni notif. Aucun label retour. Recours acheteur = chargeback externe uniquement. | Traiter `FAILURE` (notif + fenêtre litige, ne pas libérer les fonds) ; statut `lost`/`disputed_delivery` + callable admin de refund ; flux label retour. |
| P1-17 | Pas de retry/backoff/timeout ShipEngine | `shipEngine.ts:101-125` | `fetch` unique sans `AbortController`/timeout/retry. Une erreur 429/5xx au `createLabel` post-paiement fige la transaction ; lenteur ShipEngine bloque la réponse webhook → retry Stripe. | `AbortController` (~10-15 s) + retry backoff sur 429/5xx (jamais sur createLabel sans clé idempotence) ; respecter `Retry-After`. |
| P1-18 | Adresse acheteur non validée serveur | `payments.ts:203-205` vs `payments.ts:770` | Seul `typeof === 'object'` est vérifié. Le regex CP canadien strict n'existe que pour l'onboarding vendeur. Adresse invalide → `createLabel` échoue/colis non livrable après capture. | Valider serveur : CP canadien (regex), province ∈ 13 codes, ville/rue non vides, `country='CA'`. Optionnel : `addresses/validate` ShipEngine. |
| P1-19 | Pas de réconciliation coût estimé vs réel du label | `webhooks.ts:358-384` ; `wallet.ts:600-621` ; `shipEngine.ts:200-222` | `createLabel` ne mappe pas le coût réel (`shipment_cost`) ; aucun champ `actualShippingCost`, aucune comparaison. Fuite silencieuse + pas de piste comptable (audit fiscal Canada). | Mapper/stocker `actualShippingCost`, comparer à `shippingCost`, écrire un ledger/log d'écart, alerter si > tolérance. |
| P1-20 | `shipped` posé à la création du label, pas à l'envoi réel | `webhooks.ts:368-378` ; `wallet.ts:606-615` | Statut `shipped`+`shippedAt` dès le label. L'expiry 7 j ne s'applique qu'à `paid` → un vendeur qui imprime le label mais n'envoie jamais laisse la transaction `shipped` à vie sans recours acheteur. Aucune action « Marquer comme expédié ». | Distinguer `label_created`/`awaiting_shipment` de `shipped` (1er scan transporteur) ; expirer les `shipped` sans scan depuis N jours. |

### 3.C — State machine & UX logic

| # | Titre | Fichier:ligne | Impact | Fix |
|---|-------|---------------|--------|-----|
| P1-21 | `checkTrackingStatus` crédite sur DELIVERED sans garde de statut | `payments.ts:1264-1307` | Seule garde : `if status==='delivered' return`. Une transaction `refunded` (pendingBalance déjà débité) recevant un DELIVERED → `pendingBalance` négatif + `balance` créditée indûment. | Exiger `status ∈ ['paid','shipped']` avant le passage DELIVERED ; vérifier `pendingBalance >= payout`. |
| P1-22 | Refund post-livraison après retrait : `min()` laisse une dette non tracée | `webhooks.ts:872-907` ; `wallet.ts:820-854` | `deduction = min(payout, balance)` ; si vendeur déjà retiré (balance=0), deduction=0 → acheteur remboursé, vendeur garde l'argent, plateforme absorbe ; ledger `refund_debit amount:0`. | Enregistrer la différence comme `owedCents` + bloquer retraits ; OU ne libérer vers `balance` qu'après fenêtre de litige. |
| P1-23 | Suppression de compte autorisée pendant un litige | `services/transactionService.ts:317-324` ; `app/settings/delete-account.tsx:90-100` | `getActiveTransactionsForUser` n'inclut pas `disputed` ni `delivered` → suppression possible avec chargeback ouvert (preuve perdue, recouvrement impossible). | Ajouter `disputed` (et `delivered` tant que la fenêtre litige n'est pas close) au garde-fou. |
| P1-24 | Swap top-up crédite un payee non onboardé | `webhooks.ts:553-565` | Crédite `pendingBalance` sans vérifier `payoutsEnabled` (seul `chargesEnabled` est checké en amont). Solde inaccessible → friction support (même défaut systémique dans l'achat normal). | Vérifier `payoutsEnabled` avant le crédit, ou parcours d'onboarding avant déblocage. |

### 3.D — Ops & robustesse

| # | Titre | Fichier:ligne | Impact | Fix |
|---|-------|---------------|--------|-----|
| P1-25 | Aucune collection dead-letter / file d'échecs rejouables | `webhooks.ts:385-401` ; `wallet.ts:354-401` ; `transactionExpiration.ts:185-194` | Échecs label/payout-reversal/refund seulement loggés (`CRITICAL: manual reconciliation needed`), jamais persistés ni rejoués. Incidents financiers invisibles jusqu'à plainte. | Collection `failed_operations` + job `retryFailedOperations` (backoff) + alerte log-based sur `CRITICAL`. |
| P1-26 | Aucun job de réconciliation transactions bloquées | `transactionExpiration.ts:35` ; `webhooks.ts:745-750` | Ni `labelCreationPending` ni `disputed` non clôturé ne sont balayés → états terminaux de fait, divergence ledger/Stripe. | Passe sur `labelCreationPending==true` + handler `dispute.closed` ; index `(labelCreationPending ASC, createdAt ASC)`. |
| P1-27 | Aucun retry/backoff/timeout sur Stripe ET ShipEngine | `stripe.ts:39` ; `shipEngine.ts:101-125` | `new Stripe(secretKey)` sans `maxNetworkRetries`/`timeout` ; ShipEngine sans timeout. Lenteur ShipEngine dans le webhook → retry Stripe = charge supplémentaire. | `new Stripe(key, { maxNetworkRetries: 2, timeout: 20000 })` ; AbortController + retry ShipEngine. |
| P1-28 | Refund expiration non transactionnel (incohérence Stripe/wallet) | `transactionExpiration.ts:176-304` | Doublon de P1-8 sous l'angle ops : double-refund possible au run suivant (idempotence par statut `paid`), ou portion wallet non restituée. | Idempotency key + état `refund_in_progress` avant l'appel Stripe. |
| P1-29 | `expireOrphanedTransactions` : requête `paid` sans `limit` | `transactionExpiration.ts:161-170` | `where('status','==','paid')...get()` sans `.limit()` + un `refunds.create` réseau par doc → timeout function sur pic, échec partiel, re-traitement, explosion coûts Stripe. | `.limit(MAX_PER_RUN)` + pagination multi-runs + `Promise.allSettled` par lots. |
| P1-30 | Aucun test d'intégration sur webhook / expiration / checkout | `webhooks.ts`, `payments.ts`, `transactionExpiration.ts` (aucun `.test.ts`) | Seul `wallet.test.ts` existe. Les chemins financiers les plus sensibles n'ont aucun filet ; le double-paiement swap (P0-3) serait passé en prod. | Tests d'intégration (mock Stripe + emulator) : idempotence webhook, amount mismatch, swap top-up (1 seul mouvement), refund (bon bucket), expiry idempotent. |
| P1-31 | Pas de correlation id (`event.id`) traversant le flow | `webhooks.ts:168-475` | Logs par `transactionId` isolés ; `event.id` jamais loggé. RCA prod lente (corrélation manuelle), replays Stripe non tracés. | Logger `event.id` en tête + propager en `correlationId` ; persister `stripe_events`. |

---

## 4. P2 / P3 — Robustesse (condensé)

- **P2 — Paiement** : (a) Calcul des frais en float, montants `transactions` en **dollars** / wallets en **cents** — risque d'arrondi structurel (`fees.ts:82-90`, `wallet.ts:486`, `webhooks.ts:280`). (b) Paiement mixte : `application_fee_amount` jamais prélevé — **logic bomb non atteignable aujourd'hui** (aucune fonction de recharge wallet acheteur), deviendrait critique si on ajoute un top-up acheteur (`payments.ts:546-572`). (c) Rule `meetup_pending→meetup_confirmed` sans validation `meetupSpot` (`firestore.rules:526-530`). (d) Mismatch montant sans `payment_anomalies` ni circuit de sortie (`webhooks.ts:218-241`). (e) `updateTransactionStatus` client expose des statuts impossibles (bloqués par les rules mais API trompeuse — `transactionService.ts:216-259`).
- **P2 — Livraison** : (f) Fallback systématique CP Montréal pour l'expéditeur → estimate faux hors-Montréal (`shipping.tsx:43-118`, `payments.ts:42-76`). (g) PUDO/points relais exposés mais jamais câblés à l'achat (`getRates` force `deliveryType:'home'` — `shipEngine.ts:192`). (h) `meetup_pending` verrouille `isSold` 48 h sans paiement → blocage d'inventaire (`payments.ts:282-302`).
- **P2 — Ops** : (i) Pas d'index explicite sur `transactions.stripePaymentIntentId`, `swaps.topUpPaymentIntentId`, `users.stripeAccountId` (fonctionnent via auto-index mais fragiles si exemption future — `webhooks.ts:713,776,1029`).
- **P3** : URL tracking ShipEngine construite sans `encodeURIComponent` (robustesse, pas sécurité — `shipEngine.ts:243`).

---

## 5. Décision livraison — Rester sur ShipEngine

**Recommandation : RESTER sur ShipEngine. Ne pas migrer.** Effort de migration jugé « low » techniquement (abstraction propre via `getShipEngine()` singleton, consommée dans 4 fichiers seulement), mais le gain net serait **négatif**.

**Justification (facteurs décisifs, non techniques)** :
1. **Carrier** — ShipEngine est le **seul** provider comparé à supporter **Intelcom/Dragonfly** (last-mile ~94 % des adresses canadiennes, moins cher que Canada Post), sur lequel tout le code et l'identité produit reposent (`shipEngine.ts:3`, mapping `intelcom_ca` ligne 314). Shippo et EasyPost ne listent pas Intelcom → migrer = **régression de couverture/coût**.
2. **Devise** — ShipEngine facture nativement en **CAD** ; EasyPost facture ses Wallet Carriers en **USD** → risque de change pour une marketplace 100 % CAD.
3. **ToS** — EasyPost **interdit** explicitement l'usage « in connection with the provision of services to third parties » + accord UPS séparé pour tout intermédiaire plateforme → risque réel pour un modèle C2C. ShipEngine a une offre « for Platforms » conçue pour acheter des labels au nom des merchants.
4. **Coût** — ShipEngine a un plan **gratuit** (rates + labels + tracking webhooks).

**Chantiers livraison indépendants du provider** (à faire quel que soit le choix, déjà couverts dans les P1) :
- Le tracking est **pollé toutes les 6 h** (`trackingCheck.ts:32`) au lieu d'utiliser les **webhooks de tracking** que ShipEngine offre gratuitement → optimisation recommandée.
- **Aucun label de retour** n'est câblé (`webhooks.ts` ne crée qu'un label aller) — chantier neuf (P1-16).

**Décision fondateur** : aucune décision provider requise (rester ShipEngine est clair). Reste à valider la couverture PUDO Canada carrier-par-carrier si l'on veut activer les points relais (P2-g).

---

## 6. Plan d'implémentation priorisé

Séquençage en vagues. Chaque chantier indique l'agent recommandé et les fichiers touchés. **Gel produit recommandé jusqu'à fin Vague 1** (les P0 sont des fuites d'argent actives).

### Vague 0 — Décisions fondateur (à trancher AVANT de coder)
1. **Meetup** : cash hors-ligne pur (aucun crédit wallet) OU paiement en ligne escrow ? → conditionne P0-1.
2. **Connect** : migration Custom → Standard (impact onboarding vendeur) ? → P0-5.
3. **Fenêtre de litige** : durée en jours entre `delivered` et libération des fonds (recommandé 3 j) ? → P1-22 / architecture cible §2.3.
4. **Coût retour** : à la charge de l'acheteur ou de la plateforme ? → P1-16.

### Vague 1 — P0 bloquants (firebase-backend, en priorité absolue)
| Chantier | Agent | Fichiers |
|----------|-------|----------|
| Supprimer le crédit wallet meetup (selon décision V0-1) | `firebase-backend` | `functions/src/callable/payments.ts` (1437-1454, 282-302) |
| Re-tarification serveur du shipping (`getRates` + validation `rateId`) | `firebase-backend` | `payments.ts` (289-314), `config/shipEngine.ts` |
| Corriger le double-paiement swap top-up (un seul rail) | `firebase-backend` | `swaps.ts:607-622`, `webhooks.ts:553-565` |
| Rate limiting sur les 6 callables financières | `firebase-backend` | `payments.ts` (167,368,713,1387), `wallet.ts` (228,428), `utils/rateLimit.ts` |
| Migrer Connect Custom → Standard (selon décision V0-2) | `firebase-backend` | `payments.ts:824-851` ; côté app : `rn-expo-dev` pour le flow d'onboarding |
| `reverse_transfer`+`refund_application_fee` sur les refunds | `firebase-backend` | `transactionExpiration.ts:178`, `webhooks.ts` (refund) |

### Vague 2 — P1 paiement (firebase-backend)
| Chantier | Fichiers |
|----------|----------|
| Idempotency keys sur tous les writes Stripe + écrire le PI dans le runTransaction | `payments.ts:562,644`, `wallet.ts:319,329`, `transactionExpiration.ts:178` |
| Collection `stripe_events/{event.id}` (dédup universelle dans la transaction) | `webhooks.ts` (dispatch + handlers) |
| Handler `charge.dispute.closed` + gel des fonds (`heldBalance`) | `webhooks.ts:701-759`, `wallet.ts:286-314`, `firestore.rules` (wallet) |
| `walletWithdraw` : garde litige + créer `withdrawal_requests='processing'` | `wallet.ts:228-339` |
| Handlers `payout.failed`/`payout.paid` + reversal sûre | `webhooks.ts` (dispatch), `wallet.ts:354-401` |
| Refund mixte cohérent + débit vendeur exact (P1-4) | `webhooks.ts:835-907` |
| `checkTrackingStatus` : garde de statut `['paid','shipped']` (P1-21) | `payments.ts:1264-1307` |
| Lier montant négocié à une offre `accepted` (P1-10) | `payments.ts:234-250` |
| Refund expiration transactionnel + idempotent (P1-8/P1-28) | `transactionExpiration.ts:176-304` |

### Vague 3 — P1 livraison (firebase-backend + product-designer pour les flux retour/recours)
| Chantier | Agent | Fichiers |
|----------|-------|----------|
| Job `sweepPendingLabels` (retry + refund après N échecs) | `firebase-backend` | nouveau `scheduled/`, `webhooks.ts:354,393`, `wallet.ts:597,661` |
| Bloquer checkout sur `rateId` fallback avant capture | `firebase-backend` + `rn-expo-dev` | `payments.ts:310-315`, `app/checkout/shipping.tsx` |
| Pagination du job tracking (`orderBy`+curseur) | `firebase-backend` | `trackingCheck.ts:42-46` |
| Flux FAILURE / colis perdu / label retour + statut `lost` | `firebase-backend` (logique) + `product-designer` (UX recours/copy FR) | `trackingCheck.ts`, `payments.ts:1264-1360`, `shipEngine.ts`, app checkout |
| Retry/backoff/timeout ShipEngine + Stripe config | `firebase-backend` | `shipEngine.ts:101-125`, `stripe.ts:39` |
| Validation serveur adresse acheteur | `firebase-backend` | `payments.ts:203-205` |
| Réconciliation coût label réel vs estimé (`actualShippingCost`) | `firebase-backend` | `webhooks.ts:358-384`, `shipEngine.ts:200-222`, `types/index.ts` |
| Découpler `shipped` (1er scan) de `label_created` + action vendeur « Expédié » | `firebase-backend` + `rn-expo-dev` | `webhooks.ts:368-378`, `wallet.ts:606-615`, `app/my-orders.tsx` |

### Vague 4 — P1 ops & state-machine (firebase-backend)
| Chantier | Fichiers |
|----------|----------|
| Collection `failed_operations` + job `retryFailedOperations` + alertes log-based | nouveau `scheduled/`, `webhooks.ts:385-401`, `wallet.ts:354-401`, `transactionExpiration.ts:185-194`, `firestore.indexes.json` |
| Job `reconcilePayments` (webhooks perdus) + `reconcileWithdrawals` + `reconcileBalances` | nouveaux `scheduled/`, `firestore.indexes.json` |
| `.limit()` + pagination sur `expireOrphanedTransactions` | `transactionExpiration.ts:161-170` |
| Tests d'intégration webhook/expiration/checkout (priorité `handlePaymentIntentSucceeded`, `handleChargeRefunded`) | nouveaux `*.test.ts` |
| `getActiveTransactionsForUser` inclut `disputed`/`delivered` | `services/transactionService.ts:317-324` (→ `rn-expo-dev`) |
| Correlation id `event.id` dans les logs | `webhooks.ts` |
| Fenêtre de litige : `delivered → completed` à J+N (selon V0-3) | `trackingCheck.ts`, `payments.ts`, nouveau `releaseHeldFunds` |

### Vague 5 — P2/P3 (robustesse, post-prod tolérable)
- Migrer tous les montants `transactions` en **cents entiers** (`firebase-backend` + `rn-expo-dev` côté affichage) — `payments.ts:290,300`, `wallet.ts:486`, `webhooks.ts:280`.
- Adresse d'origine vendeur réelle (supprimer fallback Montréal) — `firebase-backend` + `rn-expo-dev`.
- Câbler PUDO à l'achat OU le retirer de l'UI — `firebase-backend` + `product-designer`.
- Indexes explicites `stripePaymentIntentId`/`topUpPaymentIntentId`/`stripeAccountId` + doc `firestore-indexes.md` — `firebase-backend`.
- Rule `meetupSpot` immuable, `encodeURIComponent` URLs ShipEngine, restreindre `updateTransactionStatus` client.

---

**Points nécessitant explicitement une décision du fondateur** : (1) nature du meetup (cash vs en ligne) ; (2) migration Connect Custom→Standard ; (3) durée de la fenêtre de litige (jours) ; (4) qui paie le retour. Tous les autres chantiers sont des corrections techniques sans arbitrage produit.

Fichiers de référence cités (chemins absolus) : `/Users/aurelien/dev/Second/functions/src/callable/payments.ts`, `/Users/aurelien/dev/Second/functions/src/callable/wallet.ts`, `/Users/aurelien/dev/Second/functions/src/callable/swaps.ts`, `/Users/aurelien/dev/Second/functions/src/http/webhooks.ts`, `/Users/aurelien/dev/Second/functions/src/scheduled/transactionExpiration.ts`, `/Users/aurelien/dev/Second/functions/src/scheduled/trackingCheck.ts`, `/Users/aurelien/dev/Second/functions/src/config/shipEngine.ts`, `/Users/aurelien/dev/Second/functions/src/config/stripe.ts`, `/Users/aurelien/dev/Second/functions/src/utils/fees.ts`, `/Users/aurelien/dev/Second/services/transactionService.ts`, `/Users/aurelien/dev/Second/app/settings/delete-account.tsx`, `/Users/aurelien/dev/Second/app/checkout/shipping.tsx`, `/Users/aurelien/dev/Second/firestore.rules`, `/Users/aurelien/dev/Second/firestore.indexes.json`.