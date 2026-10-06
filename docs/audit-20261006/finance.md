# Lot finances — audit du 6 octobre 2026

Base de travail : `main` au commit `b79d0c8e47a18ec9b405b13e8229a63f5ef02980`, branche locale `audit/seconde-security-ux-20261006`. Aucun paiement, appel Stripe/Firebase réel, déploiement, publication, modification de compte, secret ou historique distant effectué par ce lot.

## Résultat

Les opérations financières nouvelles sont fermées par défaut côté serveur (`PAYMENTS_ENABLED` absent ou différent de `true`), en plus des protections de livraison. La remise locale gratuite n'utilise pas cette garde. Le constructeur historique `createTransaction(meetup)` est fermé : seule l'acceptation serveur d'une proposition peut désormais réserver l'article, afin qu'un acheteur ne puisse pas le bloquer sans l'accord du vendeur. Les remboursements, la régularisation d'une dette et la résolution d'engagements déjà financés continuent de fonctionner. Aucun tarif, montant de forfait, taux de frais ou délai économique n'a été modifié.

La compensation d'un paiement mixte vérifie atomiquement le statut et l'identifiant de la réservation. Deux erreurs concurrentes restituent une seule fois le montant ; une réponse ancienne ne peut pas restituer la réservation d'une nouvelle tentative. Chaque réservation possède sa propre clé Stripe, conservée sur ses retries. Un timeout/5xx n'autorise aucune restitution : `creating`/`unknown` bloque annulation/expiration sans identifiant Stripe et signale le dossier à la réconciliation.

Le retrait conserve désormais les fonds réservés si le résultat externe ou sa persistance est inconnu. Le transfert est enregistré avant la soumission du payout. Le rapprochement d'un payout non enregistré est **en lecture seule**, sur le compte connecté exact et avec vérification du montant, de la devise, de l'utilisateur et de l'identifiant de demande. Absence de résultat, résultats multiples, erreur de lecture ou scan incomplet restent inconnus. Le retry vérifie le résultat courant ; seuls `failed`/`canceled` permettent la compensation. Une notification périmée ne peut plus inverser le transfert d'un retrait déjà terminé.

Le crédit vendeur distingue exposition brute au remboursement (`sellerCreditedCents`) et crédit effectif en escrow (`sellerPendingCreditCents`, avec `sellerDebtRepaidCents`). Livraison et libération déplacent uniquement le net ; le deuxième passage enregistre aussi le mouvement held réellement plafonné par transaction (voir `finance-second-pass.md`) ; les remboursements conservent l'exposition brute et rétablissent la dette lorsque nécessaire. Les anciennes transactions peuvent déduire le remboursement de dette depuis leur ledger serveur, avant toute écriture ; aucune migration externe exécutée.

La marge par transaction ajoute la recette transport avant de déduire le transport payé au transporteur et les frais du processeur. La taxe reste distincte de cette marge. `carrierCost` et `carrierCostEstimated` distinguent coût réel/estimé ; le coût réel met à jour la marge atomiquement à la création du bordereau, quel que soit l'ordre entre événement de paiement et bordereau. La marge concerne ces coûts par transaction, sans prétendre couvrir les dépenses d'exploitation générales.

## Inventaire de lecture ciblée

| Fichiers | Étendue examinée | Modification |
| --- | --- | --- |
| `CLAUDE.md`, `.claude/agents/firebase-backend.md`, `.agents/skills/firebase-firestore/SKILL.md`, `CODEBASE_INDEX.md`, `firestore-schema.md` | Instructions backend ; index et règles transactionnelles | Index et champs financiers documentés ; instructions de découverte réelle/déploiement remplacées par la restriction utilisateur |
| `functions/src/config/featureFlags.ts` | Politique serveur complète | Garde commune paiements, fermée par défaut |
| `functions/src/callable/payments.ts` | Création shipping, checkout mixte, compensation, annulation pending ; sections meetup confiées à l'autre lot | Garde, réservation par tentative, compensation atomique, incertitude et annulation ; fermeture du constructeur direct meetup sans acceptation |
| `functions/src/callable/wallet.ts` | Retrait complet et paiement wallet ; maintien des remboursements existants | Garde, résultat inconnu, persistance transfert, garde shipping wallet-only |
| `functions/src/callable/shopTier.ts` | Acquisition de forfait | Garde avant Stripe, tarifs conservés |
| `functions/src/callable/swaps.ts` | Proposition/acceptation avec supplément, checkout ; lecture des branches refund/dispute | Supplément bloqué dans les trois points d'entrée ; régularisation conservée |
| `functions/src/utils/labelFulfillment.ts` | Crédit, coûts et revenu, réservation/commit du bordereau | Crédit net/brut ; recette transport et coût réel distincts |
| `functions/src/utils/trackingTransition.ts`, `functions/src/scheduled/releaseHeldFunds.ts` | Livraison et libération ventes | Déplacement net, bornage des fonds réellement présents |
| `functions/src/utils/sellerEscrow.ts` | Nouveau helper | Résolution net/brut et ledger ancien |
| `functions/src/utils/payoutRecovery.ts`, `functions/src/utils/payoutOutcome.ts` | Compensation et certification de résultat | Payout connu requis pour retries ; pas de reversal de completed ni d'autre payout |
| `functions/src/scheduled/reconcile.ts`, `retryFailedOperations.ts`, `transactionExpiration.ts` | Branches financières concernées | Certification avant restitution, alerte checkout inconnu, aucune expiration aveugle |
| `functions/src/http/webhooks.ts`, `functions/src/utils/refund.ts` | Sections appels revenu/payout et cascade remboursement | Premier passage : contrats ; deuxième passage : gardes de réservation et ordre des lectures du remboursement webhook corrigés |
| `functions/src/utils/testHelpers/firestoreMock.ts` | Contrat double Firestore/Stripe | Ajout lecture payouts.list ; transaction sérialisée partagée fournie par le lot offres |

Cet inventaire constitue une lecture ciblée des transitions concernées, pas une preuve d'examen de chaque ligne du dépôt ni de chaque statut historique en production.

## Matrice des parcours

| Parcours | Examiné/corrigé | Vérification réalisée | Non vérifiable ici |
| --- | --- | --- | --- |
| Nouvelle transaction shipping / checkout carte et mixte | Garde serveur commune ; shipping reste fermé | Callables réelles, Firebase/Stripe simulés ; flags OFF/ON | Paramètres déployés et Payment Sheet sur appareil |
| Achat 100 % wallet | Garde commune et shipping | Soldes inchangés quand fermé ; suites label/wallet | Solde réel et bordereau réel |
| Proposition, acceptation, checkout d'un supplément de troc | Les trois points d'entrée protégés | Blocage proposition/checkout ; branches refund/dispute existantes et suite globale | Checkout réel ; acceptance top-up fait l'objet d'une garde de code après validation d'articles |
| Achat de forfait boutique | Garde avant tout appel financier | Forfait fermé ; owner/prix/charge existants sous flag test | Forfait actif, renouvellement réel et état Stripe |
| Deux erreurs Stripe concurrentes / nouvelle tentative avec réponse ancienne | Identifiant de réservation + lecture atomique | Une compensation ; nouvelle réservation intacte ; mêmes clés sur retries, nouvelle clé après compensation | Contention distribuée Firestore réelle |
| Timeout checkout mixte / processus interrompu | Réservation `creating`/`unknown` protégée | Aucun remboursement ni retry aveugle ; expiration laisse fonds réservés | Recherche/certification d'un PI sans webhook ; alerte opérateur requise |
| Retrait : rejet confirmé / timeout / payout créé puis écriture Firestore en panne | Résultats distingués ; helper unique compensation | Réserves conservées en inconnu, rejet certifié compensé, persistance échouée sans restitution | Banques réelles, credentials Connect, panne distribuée réelle |
| Payout sans id persisted / webhook perdu | Listing borné exact et lecture-only ; état actuel certifié avant retry | Missing/mismatch/duplicate/limite scan ; pending/paid/failed/canceled ; stale completed ; course webhook/recovery | Ancien transfert sans id et aucun payout identifiable : rapprochement opérateur |
| Dette vendeur → pending → held → disponible → remboursement | Net escrow et exposition brute distingués | Dettes 0/1500/4500/6000 cents, remboursements aux trois stades, held indépendant, ledger legacy | Exhaustivité/intégrité de tous les ledgers historiques |
| Recettes/coûts transport → marge | Recette et coût distincts, taxe exclue | Coût égal/supérieur/inférieur à la recette ; actualité du coût à partir du bordereau | Factures réelles et frais d'exploitation non modélisés |

Les tests de concurrence utilisent un double Firestore qui sérialise les transactions concurrentes et applique les sentinelles. Ils valident les transitions et invariants ; ils ne prétendent pas reproduire les pannes réseau ou la contention de l'Admin SDK en production. Le deuxième passage rejoue explicitement le callback du commit label après abandon des écritures stagées pour vérifier l'atomicité du ledger ; cela reste une simulation locale.

## Vérifications

- `cd functions && ./node_modules/.bin/tsc --noEmit` : **passé**, aucune erreur (run du lot après corrections).
- Ensemble ciblé final finances : **189/189 passés**, dans 15 fichiers, y compris incertitude checkout/expiration et fermeture du constructeur historique meetup. Log local `/tmp/finance-final-targets.log`.
- `cd functions && ./node_modules/.bin/vitest run --reporter=dot` : **475 tests passés, 2 ignorés** ; deux suites ont échoué à l'import pendant le changement de garde Firebase effectué par l'intégrateur (`ai.materials.test.ts`, `notifications.test.ts` : Firebase non mocké). Résultat communiqué au parent pour correction ; aucune défaillance finances. Log local `/tmp/finance-global-tests.log`.
- `git diff --check` sur les sources du lot : passé.
- Lint, typecheck app, règles et E2E : validation globale à la charge de l'intégrateur, hors preuve de ce lot.

Nouveaux tests : `paymentPhase.test.ts`, `financeTransitions.test.ts`, `payoutOutcome.test.ts`. Régressions ajoutées dans checkout mixte, walletWithdraw guards, payoutRecovery, reconcile, retryFailedOperations et transactionExpiration. Les anciens mocks qui assimilaient une erreur réseau à un rejet définitif ont été corrigés vers une erreur Stripe 4xx explicite quand le test vise une compensation autorisée ; aucun test supprimé.

## Limites et suites nécessaires

- Production reste au code/configuration précédemment déployés ; ce lot n'a rien déployé.
- Une création de PaymentIntent interrompue sans identifiant/webhook laisse sa réservation et une alerte opérateur. C'est volontaire : absence de preuve externe ne signifie pas échec. La recherche/certification opérationnelle de ces cas doit être résolue avant activation financière.
- Les scans payouts sont bornés à dix pages de cent résultats. Un scan incomplet ou plusieurs payouts correspondants demande un rapprochement humain et ne crédite jamais le wallet.
- Un transfert dont ni l'identifiant ni un payout n'ont pu être persistés demande un rapprochement humain ; aucun nouveau payout n'est créé pour "tester" son existence.
- Aucune vérification de Stripe/Connect/banque/bordereau réel ni analyse de données financières historiques. Toute incohérence historique déjà matérialisée (fonds bruts libérés, ledger manquant) exige analyse et décision propriétaire avant réparation externe.
- Ce lot n'établit pas une conformité juridique, fiscale ou comptable générale et ne change aucune règle économique.

## Deuxième passage après revue indépendante

Voir `finance-second-pass.md` pour R3–R7, les gardes de propriété article dans 9 transitions, le séquestre réellement déplacé, les bordereaux tardifs, le ledger transport atomique et les **285/285 tests ciblés** finaux. Ce complément remplace les limites de couverture du premier passage concernant ces sections ; il ne prétend pas vérifier des paiements ou des données réels.
