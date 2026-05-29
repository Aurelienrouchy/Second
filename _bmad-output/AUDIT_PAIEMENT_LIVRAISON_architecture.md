I now have a complete, grounded picture of the actual system. Key confirmed gaps: no Stripe `event.id` idempotency store (webhooks rely solely on transaction-status guards), no `dispute.closed` handler, no `idempotencyKey` on any Stripe write (transfers/payouts/refunds/PaymentIntents), `labelCreationPending` is set but never swept by any scheduled job, and `walletWithdraw` doesn't write a `withdrawal_requests` audit doc despite the schema documenting one. I have everything I need to write the target architecture.

---

# Architecture cible paiement + livraison — Second

Document de référence "should be" (production-ready), indépendant des bugs ponctuels. Toutes les références `fichier:ligne` pointent vers le code **actuel** pour situer l'écart entre l'état présent et la cible.

---

## 0. Principes directeurs

1. **Firestore = source de vérité de l'état métier ; Stripe = source de vérité de l'argent réel.** Toute divergence est détectée par réconciliation, jamais supposée absente.
2. **Une seule opération atomique par transition d'état financier.** Les appels réseau externes (Stripe, ShipEngine) sont **hors** `runTransaction` (déjà le cas, `webhooks.ts:333`), mais doivent être **idempotents** et **rejouables**.
3. **Tout ce qui n'est pas atomiquement couplé doit être réconciliable.** Si A (Stripe) et B (Firestore) ne peuvent pas être dans la même transaction, alors il faut un état intermédiaire persistant + un job qui ferme la boucle.
4. **Aucune perte silencieuse.** Tout échec d'étape non-atomique produit un document persistant (dead-letter / flag + timestamp) qu'un job balaie.
5. **Cents partout, un seul système.** Aujourd'hui les transactions stockent en **dollars** (`payments.ts:290,300`) et les wallets en **cents** — source de bugs d'arrondi (R017, R019). Cible : `transactions` stocke tous les montants monétaires en **cents entiers**, une seule conversion à la frontière client.

---

## 1. Flux argent atomique (saga + compensation + idempotence)

### 1.1 Décomposition en étapes et leur garantie

Le flux d'achat shipping comporte 4 effets de bord qui ne peuvent pas tous tenir dans une transaction Firestore unique :

| # | Effet | Système | Atomique avec Firestore ? |
|---|-------|---------|---------------------------|
| E1 | Verrou article (`isSold=true`) + création transaction | Firestore | Oui (`createTransaction`, `payments.ts:213`) |
| E2 | Capture de fonds | Stripe | Non (capture côté carte) |
| E3 | Marquage `paid` + crédit `pendingBalance` vendeur + ledger | Firestore | Oui (`webhooks.ts:205`) |
| E4 | Achat label + écriture tracking | ShipEngine + Firestore | Non |

La cible n'essaie **pas** de rendre E2/E4 atomiques avec Firestore — c'est impossible. Elle les rend **convergents** via une saga avec états intermédiaires explicites et compensation.

### 1.2 Ordre canonique des opérations (forward path)

```
E1  createTransaction        → status=awaiting_payment, article verrouillé
E2  Stripe capture           → (asynchrone, confirmé par webhook)
E3  webhook PI.succeeded     → status=paid, vendeur.pendingBalance += payout, ledger sale_credit
E4a achat label ShipEngine   → status=shipped (succès) | status=paid + label_pending (échec)
E4b job sweep labels         → ferme E4a en échec
```

**Règle d'or :** le verrou article (E1) précède toujours la capture (E2). L'argent ne bouge jamais avant que l'inventaire soit réservé. C'est déjà le cas.

### 1.3 Idempotence — les trois couches manquantes à ajouter

La cible exige **trois** niveaux d'idempotence. Le code actuel n'en a qu'un (le guard de statut).

**Couche 1 — Idempotency keys sur toutes les écritures Stripe (MANQUANT).**
Aucun appel Stripe ne passe `idempotencyKey` aujourd'hui : `paymentIntents.create` (`payments.ts:562,644`), `transfers.create`/`payouts.create` (`wallet.ts:319,329`), `refunds.create` (`transactionExpiration.ts:178`). Cible :
- PaymentIntent : `idempotencyKey = pi_create_${transactionId}`.
- Refund : `idempotencyKey = refund_${transactionId}_${reason}`.
- Transfer/Payout : `idempotencyKey = withdraw_${withdrawalRequestId}`.

Cela élimine R004 (double PaymentIntent → double crédit) et R005/R011 (double refund) à la racine : même si le job ou le webhook se relance, Stripe dédoublonne côté serveur 24 h.

**Couche 2 — Table d'événements Stripe traités (MANQUANT).**
Aujourd'hui l'idempotence webhook repose **uniquement** sur le statut de la transaction (`webhooks.ts:247`). C'est fragile : un `charge.refunded` rejoué après que la transaction soit repassée `paid` (cas dispute perdue/gagnée) peut re-déclencher des écritures. Cible : collection `stripe_events/{event.id}` écrite **dans la même `runTransaction`** que l'effet métier :
```
stripe_events/{evt_id}: { type, transactionId?, processedAt, result }
```
Le handler lit `stripe_events/{evt.id}` en début de transaction ; s'il existe → no-op. C'est la seule idempotence correcte pour des événements multiples par entité (R002, R016).

**Couche 3 — Garde de statut (EXISTANT, à conserver).**
Le `Set` de statuts (`webhooks.ts:247-258`) reste comme défense en profondeur. À durcir : centraliser l'enum des statuts (R024) et la matrice de transitions valides dans un module unique partagé (`functions/src/domain/transactionState.ts`).

### 1.4 Compensation (les sagas inverses)

Chaque étape forward a une compensation définie et **idempotente** :

| Échec | Compensation | État cible |
|-------|--------------|-----------|
| E2 échoue (carte refusée) | webhook `payment_intent.payment_failed` → libère article, rembourse portion wallet | `cancelled` (`webhooks.ts:599`) |
| E1 wallet débité, E2 PI échoue à la création | revert wallet dans transaction séparée | retour `awaiting_payment` (`payments.ts:574`) — **R001 : à rendre rejouable** via ledger `pending_revert` balayé par job |
| E3 OK mais E4 label échoue | flag `label_pending` + job sweep | reste `paid`, jamais bloqué (cible §4.3) |
| Vendeur n'expédie pas (E4 jamais finalisé par le vendeur) | refund Stripe + débit pending vendeur | `cancelled` (`transactionExpiration.ts`) — **R005 : rendre transactionnel** (§1.5) |

### 1.5 Le point dur : refund Stripe + écriture Firestore non couplés (R005)

`expireOrphanedTransactions` appelle `stripe.refunds.create()` **hors** transaction (`transactionExpiration.ts:178`) puis fait le refund wallet **dans** la transaction (`:204`). Si crash entre les deux : carte remboursée, wallet non remboursé → cauchemar SAV.

**Pattern cible — refund en deux phases (intent → execute → confirm) :**
1. **Phase intent (atomique Firestore) :** écrire `transactions/{id}.refundState = 'requested'` + `refundReason`. Ne touche pas Stripe.
2. **Phase execute (Stripe, idempotent) :** `refunds.create({ payment_intent, ... }, { idempotencyKey: 'refund_'+txId })`. Rejouable sans risque grâce à la clé.
3. **Phase confirm :** le webhook `charge.refunded` (déjà présent, `webhooks.ts:765`) est **l'unique** endroit qui applique les mouvements wallet et passe `status=refunded`. Le job d'expiration **ne touche plus jamais les wallets** — il ne fait que marquer l'intent et appeler Stripe.

Conséquence : un seul chemin de mutation wallet pour les refunds (le webhook), idempotent via `stripe_events`. Le job devient un simple émetteur d'intentions rejouables. Cela résout R005 et R011 par construction.

---

## 2. Machine à états canonique de la commande

### 2.1 États (un seul enum partagé — résout R024)

```
SHIPPING:  awaiting_payment → paid → shipped → in_transit → delivered → completed
MEETUP:    meetup_pending → meetup_confirmed → meetup_completed → completed
TERMINAUX: cancelled | refunded | disputed → (dispute_won → completed | dispute_lost → refunded)
```

Notes vs existant :
- Renommer `pending_payment` → `awaiting_payment` (clarté ; cosmétique).
- Introduire `in_transit` distinct de `shipped` : `shipped` = label acheté, `in_transit` = premier scan transporteur. Permet de détecter le vendeur qui imprime un label mais n'envoie jamais le colis.
- Introduire un état terminal explicite `completed` séparé de `delivered`, pour matérialiser la **fin de fenêtre de litige** (cf. §2.4). Aujourd'hui `delivered` est à la fois "livré" et "fonds disponibles" — il faut les découpler.
- Ajouter les transitions de **résolution de dispute** (`dispute_won`/`dispute_lost`) — totalement absentes aujourd'hui (R012).

### 2.2 Tableau des transitions : qui déclenche, quand

| Transition | Déclencheur | Mécanisme | Effet financier |
|-----------|-------------|-----------|-----------------|
| → `awaiting_payment` | Acheteur | `createTransaction` | Verrou article |
| `awaiting_payment` → `paid` | Stripe | webhook `PI.succeeded` | `pendingBalance += payout` |
| `awaiting_payment` → `cancelled` | Stripe / job 1 h | `PI.payment_failed` / expiry | libère article, revert wallet |
| `paid` → `shipped` | Système | achat label post-webhook | aucun |
| `shipped` → `in_transit` | ShipEngine | poll tracking (premier scan) | aucun |
| `in_transit` → `delivered` | ShipEngine | poll tracking `DELIVERED` | **aucun** (changement vs aujourd'hui) |
| `delivered` → `completed` | **Job/timer** | fin fenêtre litige (J+N) | `pendingBalance → balance` |
| `paid` → `cancelled` | Job 7 j | vendeur n'a pas expédié | refund + débit pending |
| `meetup_pending` → `meetup_confirmed` | Vendeur | rule Firestore | aucun |
| `meetup_confirmed` → `meetup_completed` | Acheteur | `completeMeetupTransaction` | crédit (cf. §2.5) |
| `paid`/`shipped`/`delivered` → `disputed` | Stripe | `charge.dispute.created` | **gel des fonds** (nouveau) |
| `disputed` → `dispute_won` | Stripe | `charge.dispute.closed` (won) | dégel |
| `disputed` → `dispute_lost` | Stripe | `charge.dispute.closed` (lost) | refund définitif |

### 2.3 Timing de libération des fonds (changement structurel)

**Aujourd'hui :** `delivered` libère immédiatement `pendingBalance → balance` (`payments.ts:checkTrackingStatus`, `trackingCheck.ts`). Aucune fenêtre de réclamation acheteur → l'acheteur n'a aucun recours après livraison physique.

**Cible :** introduire une **fenêtre de litige de N jours** (recommandé : 3 jours pour la mode seconde main au Canada) entre `delivered` et `completed`. Tant que `delivered`, les fonds restent en `pendingBalance` (réversibles sans solde négatif). À J+N sans réclamation ni dispute Stripe, un job `releaseHeldFunds` passe `delivered → completed` et exécute `pendingBalance → balance`. C'est ce qui rend le modèle "buyer protection" réel et cohérent avec la commission acheteur facturée.

### 2.4 Gel des fonds sur dispute (résout R012)

Sur `disputed`, la cible **gèle** explicitement les fonds : si déjà en `balance`, les déplacer vers un compartiment `heldBalance` (nouveau champ wallet) pour empêcher tout `walletWithdraw` pendant le litige. Aujourd'hui `handleDisputeCreated` ne marque que le statut (`webhooks.ts:701`) — le vendeur peut retirer pendant la dispute. Ajouter le handler `charge.dispute.closed` (totalement manquant) :
- gagnée → `heldBalance → balance`, statut `completed` ;
- perdue → débit `heldBalance`, statut `refunded` (Stripe a déjà repris l'argent côté plateforme).

### 2.5 Meetup : crédit et recours (résout R011 + incohérence cartographie)

Le meetup crédite `balance` **immédiatement** sur confirmation acheteur, sans aucune preuve ni recours (`payments.ts:1387`). Cible :
- Le meetup ne devrait créditer du **vrai** argent que s'il a transité par la plateforme. Or le meetup est aujourd'hui "cash hors plateforme" → **aucun argent réel ne devrait jamais arriver dans le wallet** sur un meetup cash. Décision d'architecture à trancher : soit (a) meetup = purement hors-ligne, le wallet n'est jamais crédité (cohérent avec "Aucun frais de plateforme"), soit (b) meetup payé en ligne, et alors fenêtre de confirmation bilatérale (acheteur + vendeur) requise avant crédit. **L'état actuel — crédit wallet sur simple clic acheteur d'un échange cash — est incohérent et doit être supprimé.**

---

## 3. Webhooks & réconciliation

### 3.1 Set d'événements Stripe cible

| Event | Présent ? | Rôle cible |
|-------|-----------|-----------|
| `payment_intent.succeeded` | Oui | confirmer paiement, créditer pending |
| `payment_intent.payment_failed` | Oui | annuler, libérer |
| `charge.refunded` | Oui | **unique** chemin d'application des refunds |
| `charge.dispute.created` | Oui | geler fonds (à enrichir) |
| **`charge.dispute.closed`** | **MANQUANT** | dégeler ou rembourser définitivement |
| `account.updated` | Oui | sync statut Connect |
| **`payout.paid` / `payout.failed`** | **MANQUANT** | clôturer `withdrawal_requests` |
| **`transfer.created` / `transfer.reversed`** | **MANQUANT** | réconcilier retraits asymétriques (R022) |
| **`charge.dispute.funds_withdrawn` / `funds_reinstated`** | optionnel | tracer le cash-flow réel des litiges |

### 3.2 Contrat webhook robuste (ordre interne)

Chaque handler suit le même squelette cible :
1. Vérifier signature (déjà fait, `webhooks.ts:74`) — **conserver le rejet 401/500 strict**.
2. `runTransaction` : lire `stripe_events/{evt.id}` → si présent, `return {already:true}`.
3. Dans la même transaction : vérifier montant attendu. **En cas de mismatch : NE PAS continuer.** Aujourd'hui le mismatch est loggé puis l'exception remonte (`webhooks.ts:230,239`) — c'est correct *si* le throw renvoie bien 500 à Stripe pour retry. À garantir explicitement (R003) : un mismatch → 400/500, jamais marquage `paid`.
4. Appliquer l'effet métier + écrire `stripe_events/{evt.id}` atomiquement.
5. Hors transaction : effets best-effort (label, message système, push) avec dead-letter (§3.4).
6. Répondre `200` seulement si la transaction a commit ; sinon `5xx` pour déclencher le retry Stripe.

### 3.3 Jobs de réconciliation (nouveaux)

Trois jobs scheduled à ajouter (région `northamerica-northeast1`, v2) :

1. **`reconcilePayments` (toutes les 15 min)** : pour chaque transaction `awaiting_payment` avec `stripePaymentIntentId` non nul et `createdAt > 10 min`, interroger `paymentIntents.retrieve`. Si `succeeded` côté Stripe mais Firestore encore `awaiting_payment` → rejouer `handlePaymentIntentSucceeded` (webhook perdu). Capture les webhooks droppés — sans ça, un webhook perdu = vendeur jamais crédité.

2. **`reconcileWithdrawals` (toutes les 30 min)** : pour chaque `withdrawal_requests.status='processing'` > 1 h, interroger Stripe payout/transfer. Met à jour `completed`/`failed`. Résout le "processing forever" (R008) et l'asymétrie transfer/payout (R015, R022). **Pré-requis : créer le doc `withdrawal_requests` qui n'existe pas aujourd'hui** — `walletWithdraw` (`wallet.ts:228`) ne l'écrit jamais alors que le schéma le documente.

3. **`reconcileBalances` (quotidien)** : recalcule `balance + pendingBalance` attendus à partir du ledger append-only et alerte si écart avec le doc wallet (détecte R003/R010/divergences silencieuses). Le ledger devient le grand livre d'audit, le doc wallet un cache.

### 3.4 Dead-letter pour rejouer les échecs

Collection `webhook_failures/{id}` (et `side_effect_failures/{id}`) :
```
{ source: 'stripe_webhook'|'label'|'notification', eventId?, transactionId?,
  payload, error, attempts, nextRetryAt, status: 'pending'|'resolved'|'manual' }
```
- Tout effet best-effort hors transaction qui échoue (label, message, push) écrit ici au lieu de juste logger (`.catch()` → log, partout aujourd'hui : `webhooks.ts:395,466`).
- Un job `replayDeadLetters` (toutes les 10 min) rejoue avec backoff exponentiel, `attempts++`, passe en `manual` après N tentatives → dashboard support.
- Pour les webhooks 5xx, Stripe retry déjà ~3 jours ; le dead-letter couvre l'au-delà et les effets non-webhook.

---

## 4. Livraison

### 4.1 Quand acheter le label

**Cible : conserver l'achat post-paiement** (`webhooks.ts:342`) — c'est correct, on n'achète jamais un label avant que l'argent soit capturé. Mais déplacer l'achat **hors du chemin webhook synchrone** vers un job/queue dédié :
- Le webhook `PI.succeeded` se contente de passer `paid` + flag `label_requested=true`.
- Un consommateur (`processLabelQueue`, scheduled court ou Cloud Tasks) achète le label. Bénéfices : le webhook répond vite (< latence Stripe), l'achat label devient naturellement rejouable, et un échec ShipEngine ne pollue plus le handler critique.

### 4.2 Comment financer le label

Le coût du label est avancé par la **plateforme** (compte Stripe plateforme paie ShipEngine), facturé à l'**acheteur** dans `shippingCost`. La cible **fige le `rateId` côté serveur** (déjà fait, stocké dans la transaction `payments.ts:312`) et n'accepte **jamais** un `rateId` client au moment de l'achat. Les `fallback_*` rateIds (R008, R006) ne doivent **jamais** mener à un état `paid` sans label réel : si ShipEngine était injoignable au devis, la transaction doit rester non-payable (bloquer `createStripeCheckout` si `rateId` commence par `fallback_`), pas créer une commande payée sans label.

### 4.3 Réconciliation coût estimé vs réel

Aujourd'hui : aucun ajustement, la plateforme absorbe l'écart (cartographie "COST RECONCILIATION"). Cible :
- Au moment de l'achat label, comparer `label.shipmentCost` (réel ShipEngine) vs `transaction.shippingCost` (estimé facturé). Écrire `shippingCostActual` + `shippingCostDelta` sur la transaction.
- Le delta alimente le P&L plateforme (la marge/frais de protection absorbe les petits écarts ; les gros écarts (> seuil) génèrent une alerte). Pas de re-débit acheteur (mauvaise UX), mais **traçabilité comptable** obligatoire pour la prod.
- Sweep `label_pending` (MANQUANT aujourd'hui — R007) : job `sweepPendingLabels` (toutes les 30 min) qui retente l'achat pour toute transaction `paid` + `labelCreationPending=true`. Sans ce job, le flag est posé partout (`webhooks.ts:354,393` ; `wallet.ts:597,661,675`) mais **rien ne le balaie** → colis jamais expédiés, argent capturé.

### 4.4 Retours

Totalement absent du code. Modèle cible minimal :
- État `return_requested` (acheteur, dans fenêtre litige) → `return_in_transit` → `returned` → `refunded`.
- Génération d'un label retour ShipEngine (`createLabel` avec from/to inversés), coût retour selon politique (acheteur ou plateforme).
- Le refund suit **exactement** le pattern §1.5 (intent → Stripe idempotent → webhook applique). Fonds vendeur débités depuis `pendingBalance` (pas encore `completed` car la fenêtre litige n'est pas close).

### 4.5 Colis perdu

Aujourd'hui : un colis `shipped` sans scan `DELIVERED` reste `shipped` indéfiniment (`trackingCheck.ts` ne fait que poller). Cible :
- Si `shipped`/`in_transit` sans transition `DELIVERED` après **délai SLA transporteur + marge** (ex. 14 j), passer en `delivery_stalled` et créer un dead-letter "investigate".
- Résolution : ouvrir réclamation transporteur (manuelle/API), rembourser l'acheteur via §1.5, débiter `pendingBalance` vendeur. Le vendeur n'est jamais payé pour un colis non livré (les fonds étaient en `pendingBalance`, jamais `balance`) — l'architecture pending/available protège déjà ce cas, il manque juste la **détection** du blocage.

---

## 5. Observabilité & alerting minimal pour la prod

### 5.1 Invariants à surveiller (alertes critiques)

1. **Wallet jamais négatif :** alerte si un `balance`/`pendingBalance` < 0 après toute écriture. Le code protège déjà par `Math.min` (R015) mais l'invariant doit être *monitoré*, pas supposé.
2. **`ledger ≡ wallet` :** `reconcileBalances` (§3.3) ; alerte sur tout écart > 0.
3. **Stripe ↔ Firestore :** alerte si une PI `succeeded` côté Stripe n'a pas de transaction `paid` Firestore après 30 min (webhook perdu).
4. **`label_pending` âge :** alerte si une transaction `paid` reste `labelCreationPending` > 1 h (résout l'angle mort R007).
5. **`withdrawal_requests` bloqués :** alerte sur `processing` > 2 h.
6. **Disputes :** alerte immédiate (Slack/email) sur tout `charge.dispute.created`.
7. **Webhook error rate :** alerte si taux de 5xx du `stripeWebhook` > seuil (signale signature/clé/bug).

### 5.2 Métriques (dashboards)

- Funnel : `awaiting_payment → paid → shipped → delivered → completed` avec taux de conversion et temps moyen par transition (détecte vendeurs lents, colis bloqués).
- Volume GMV, frais plateforme collectés, `shippingCostDelta` cumulé (P&L livraison).
- Taille des collections `webhook_failures`/`side_effect_failures` (santé du dead-letter).
- Latence du `stripeWebhook` (doit rester basse une fois le label sorti du chemin synchrone, §4.1).

### 5.3 Traçabilité

- **Corréler par `transactionId`** dans tous les logs (déjà largement fait — bon).
- **Journaliser chaque `event.id` Stripe** via `stripe_events` (devient aussi l'audit trail webhook).
- **Ledger append-only** comme journal financier immuable (déjà le cas) — c'est l'artefact d'audit de référence ; ne jamais y écrire hors `runTransaction` du mouvement correspondant.

### 5.4 Outils

Au vu de l'environnement (Sentry, PostHog, Stripe MCP disponibles) : Sentry pour les exceptions Functions + alertes invariants, PostHog pour le funnel produit, Stripe Dashboard + webhook Radar pour fraude/disputes. Les alertes invariants (§5.1) doivent provenir des **jobs de réconciliation** (§3.3), pas seulement des logs — c'est la différence entre "savoir après coup" et "détecter".

---

## Synthèse des écarts prioritaires (présent → cible)

| Priorité | Écart | Référence code actuel | Section cible |
|----------|-------|----------------------|---------------|
| P0 | Pas de table `stripe_events` (idempotence par statut seul) | `webhooks.ts:247` | §1.3 |
| P0 | Pas d'`idempotencyKey` sur aucune écriture Stripe | `payments.ts:562,644` ; `wallet.ts:319,329` ; `transactionExpiration.ts:178` | §1.3 |
| P0 | Refund Stripe non couplé au refund wallet (perte possible) | `transactionExpiration.ts:178` vs `:204` | §1.5 |
| P0 | `labelCreationPending` posé mais jamais balayé | `webhooks.ts:354,393` ; `wallet.ts:597,661` | §4.3 |
| P1 | Pas de `dispute.closed` ni gel des fonds | `webhooks.ts:701` | §2.4 |
| P1 | `delivered` libère les fonds sans fenêtre litige | `trackingCheck.ts` ; `payments.ts:checkTrackingStatus` | §2.3 |
| P1 | `withdrawal_requests` jamais écrit ; pas de réconciliation payout | `wallet.ts:228` | §3.3 |
| P1 | Pas de job de réconciliation paiements (webhooks perdus) | absent | §3.3 |
| P2 | Montants `transactions` en dollars, wallets en cents | `payments.ts:290,300` | §0 |
| P2 | Meetup crédite le wallet sur clic acheteur, sans recours | `payments.ts:1387` | §2.5 |
| P2 | Colis perdu non détecté | `trackingCheck.ts` | §4.5 |
| P3 | Enum statuts non centralisé | partout (`Set.has`) | §2.1 |