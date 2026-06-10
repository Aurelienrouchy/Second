# Checklist de déploiement — rail paiement / livraison (post-campagne)

**Date :** 2026-06-10
**Contexte :** campagne de correction post-audit (7 P0, 29 P1, P2/P3 + features) terminée et vérifiée (3 reviewers adversariaux → zéro régression ; 1199+ tests verts : functions vitest 350, app jest 614, app vitest 78, security 159, tsc 0 partout). **Rien n'a été déployé.** Cette checklist liste les actions MANUELLES du fondateur pour passer en prod et pouvoir tester sans erreur.

> ⚠️ Ordre important. Déployer le code AVANT de tester. Plusieurs nouvelles callables/rules/index n'existent qu'en local → un test manuel contre la prod échouera tant que ce n'est pas déployé.

---

## 1. Déploiement code (Cloud Functions)

```bash
cd functions && npm run build   # ou tsc — déjà vérifié 0 erreur
firebase deploy --only functions
```

- **JAMAIS `--force`** (la prod a des orphelins absents du local, dont `requestWithdrawal`, financière — un deploy --force les supprimerait).
- Nouvelles functions à déployer : `resolveDispute`, `resolveSwapDispute`, `sellerCancelTransaction`, `purchaseShopTier`, `uploadStripeIdentityDocument`, `expireStaleAcceptedOffers`, `expireStalePostAcceptanceSwaps` + modifications de `stripeWebhook`, `shipEngineWebhook`, callables paiement/wallet/swap, jobs scheduled, utils partagés.
- **Gotcha IAM gen2** (mémoire projet) : pour les functions HTTP publiques (`stripeWebhook`, `shipEngineWebhook`), un update gen2 ne réapplique PAS `allUsers` invoker → vérifier après deploy que l'endpoint n'est pas en 403 unauthenticated ; corriger via `gcloud functions add-invoker-policy-binding` / setIamPolicy si besoin.

## 2. Rules + index Firestore + Storage

```bash
firebase deploy --only firestore:rules,firestore:indexes,storage
```

- Nouveaux index composites : `transactions(status, returnRequestedAt)`, `withdrawal_requests(userId, status)`, `disputes(transactionId, status)`, `swaps(status, updatedAt)`. **Déployer les index AVANT que les jobs scheduled / requêtes ne tournent** (sinon erreurs "missing index").
- `storage.rules` : nouvelle règle `swaps/{swapId}/photos/**` (upload preuves swap).
- `firestore.rules` : transactions en allowlist, champs Stripe/forfait/dispute CF-only.

## 3. Stripe — 2e endpoint webhook (famille Connect)

Le code accepte désormais DEUX secrets (`STRIPE_WEBHOOK_SECRET` + `STRIPE_CONNECT_WEBHOOK_SECRET`) car les events de compte connecté (`payout.*`, `account.updated`, disputes connectées) arrivent d'un endpoint distinct.

1. Dans le dashboard Stripe, créer un **2e endpoint webhook** (événements Connect) pointant vers la même URL `https://northamerica-northeast1-seconde-b47a6.cloudfunctions.net/stripeWebhook`.
2. Créer le secret dans Secret Manager : `STRIPE_CONNECT_WEBHOOK_SECRET` (la signing secret de ce 2e endpoint).
3. Vérifier que les DEUX endpoints (platform + Connect) sont actifs.

> Sans ça : `payout.failed`/`account.updated` ne sont jamais livrés → le re-crédit de retrait et la mise à jour KYC restent théoriques (le job `reconcile` sert de filet, mais ce n'est pas suffisant en régime nominal).

## 4. ShipEngine — webhook de tracking

`shipEngineWebhook` est **404 en prod** (jamais déployé) → aujourd'hui le tracking ne repose que sur le poller 12 h.

1. Provisionner le secret `SHIPENGINE_WEBHOOK_SECRET` (Secret Manager).
2. Déployer `shipEngineWebhook` (inclus dans le deploy functions, sans `--force`).
3. Enregistrer l'URL + le secret côté dashboard ShipEngine (webhook tracking).

## 5. Flags & config

| Variable | Où | Valeur actuelle | Quand l'activer |
|---|---|---|---|
| `SHIPPING_ENABLED` (serveur) | `functions/.env` | `false` (défaut) | `=true` quand le shipping est officiellement lancé. Le meetup n'est jamais bloqué par ce flag. |
| `SHIPPING_ENABLED` (client) | `config/featureFlags.ts:17` | `false` | passer à `true` en même temps que le serveur. |
| `TAX_ENABLED` | `functions/.env` | `false` (défaut) | `=true` UNIQUEMENT après immatriculation **TPS (fédéral) + TVQ (Revenu Québec)** — décision fiscale. Statuer avec un fiscaliste sur la taxe du shipping refacturé (le scaffold ne taxe que le service fee). |
| `SHOP_TIER_PRO_MONTHLY_CENTS` | `functions/src/callable/shopTier.ts` | `2999` (placeholder) | calibrer le prix réel pro. |
| `SHOP_TIER_PREMIUM_MONTHLY_CENTS` | id. | `7999` (placeholder) | calibrer le prix réel premium. |
| TTL `stripe_events.expiresAt` | Console Firestore | champ posé, policy absente | créer la TTL policy sur `stripe_events.expiresAt` (croissance non bornée sinon). |

## 6. Vérification device (non testable en simulateur)

À confirmer sur iPhone/Android réels (Argent ne pilote pas la Payment Sheet native Stripe) :
- iOS : Payment Sheet s'initialise (fix `merchantIdentifier`/`urlScheme`) → un paiement carte aboutit.
- Retour 3DS iOS (`handleURLCallback`) ne laisse pas d'écran parasite.
- Onboarding vendeur Custom complet → KYC continu : un compte restreint affiche les `requirements` + upload de pièce fonctionne.
- Wallet : statut payouts, retraits en cours, sellerDebt, ledger neutre.
- Achat de forfait boutique (`/shop/upgrade`) → webhook stampe `tier`/`tierPaidUntil`.
- Annulation vendeur (`my-sales`) sur une vente `paid`/`label_created` → acheteur remboursé, article relisté.
- Actions admin disputes (`resolveDispute` / `resolveSwapDispute`).

## 7. Harmonisation optionnelle (mineure, non bloquante)

- Ajouter `checkRateLimit` à `adminRefundTransaction` (payments.ts) pour l'aligner sur `resolveDispute` (aujourd'hui admin-only + idempotent `rf_admin_` → exposition faible, pas une faille).

---

## Récap de ce qui a été corrigé/ajouté (référence)

- **Modèle de charge unifié** : charge plateforme + transfer unique au retrait (fin du double-financement + fuite shipping). Wallet 3 buckets = source de vérité.
- **P0 corrigés** : DELIVERED read-after-write (fonds gelés à vie), fuite frais de port, double-financement retraits, `refundWalletPayment` admin-only, double-crédit `cancelPendingTransaction`, part wallet mixte restituée à l'expiration, litige swap résoluble.
- **Rail de résolution** : `resolveDispute`, `resolveSwapDispute`, `sellerCancelTransaction`, clôture des disputes (débloque suppression de compte).
- **Robustesse** : idempotence label (anti double-étiquette), job locks anti-overlap, webhooks manquants (payout.canceled, refund.failed/updated, transfer.reversed…), requêtes bornées, admin_alerts sur échecs financiers, reconcile paginé + redrive PI.
- **Features** : KYC continu + upload pièce, gestion bancaire (remplacement), annulation vendeur, comptabilité plateforme (marge nette), taxes (scaffold OFF), rail d'encaissement forfaits boutique, sécurité rules durcie (allowlist transactions, champs CF-only) + 56 nouveaux tests sécurité.
- **App** : merchantIdentifier iOS, UX échec paiement + retry, annulation sur /payment, retraits visibles, statuts mappés, ligne taxe conditionnelle, écrans onboarding KYC / compte bancaire / achat forfait / résolution admin.
