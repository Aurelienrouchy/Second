# Finances — corrections après revue indépendante

Branche locale `audit/seconde-security-ux-20261006`, base auditée `b79d0c8e47a18ec9b405b13e8229a63f5ef02980`. Ce passage répond aux constats R3–R7 du rapport figé `review-offers-finance.md`. Les paiements/livraison/forfaits restent fermés par défaut. Aucun tarif, délai économique, paiement réel, appel externe financier, migration, publication ou déploiement effectué. L'intégrateur réalise les commits locaux.

## Corrections et preuve

| Constat | Origine | Changement final | Preuve ciblée |
| --- | --- | --- | --- |
| R3 — paiement wallet hors shipping, lecture vendeur après écriture acheteur | Défaut conservé du commit audité | La lecture/crédit vendeur arrive après les lectures acheteur/article et avant les écritures restantes ; le cas wallet vendeur absent conserve cet ordre | Deux scénarios rouge avant correction (`READ_AFTER_WRITE_ERROR`), puis verts avec wallet vendeur présent/absent et dette ; callables réelles sous flag test uniquement |
| R4 — livraison plafonnée, libération utilisant encore le montant nominal | Régression du premier passage d'audit | Livraison persiste `sellerHeldCreditCents` réellement déplacé ; libération utilise ce montant et persiste `sellerReleasedCents`. Ancien document : preuve dans son ledger `funds_held`, sinon aucune libération | Scénario nominal 4500, pending 1000, held d'autre vente 2000 : avant correction libère 3000 ; après correction libère 1000 et conserve 2000. Cas champ présent/legacy, pending zéro et preuve legacy manquante |
| R5 — annulation/remboursement/expiration A libère l'article de B | Défaut conservé et intégration de verrou incomplète | Helper partagé `articleReservation.ts`, pré-lecture transactionnelle. Pointeur vers B conservé ; pointeur exact A supprimé à la libération. Sans pointeur, lecture des engagements legacy ; accord distinct non cancelled/refunded bloque la libération | Matrice 27 cas sur 9 handlers réels mockés : pointeur A, pointeur B, legacy avec B accepté. 8 tests helper : idempotence, pointeur inexistant distinct, statuts inconnus/vente terminée protégés |
| R6 — bordereau revenant après remboursement réactive/crédite la vente | Défaut conservé du commit audité | Réservation et commit revérifient état `paid` et propriété de l'accord. Retour tardif terminal ou autre accord : aucun crédit/status réactivé ; identifiant du bordereau dans `admin_alerts` pour rapprochement | Provider mock suspendu pendant remboursement wallet réel mocké, puis nouvelle acceptation optionnelle ; seller pending reste zéro, buyer remboursé une fois, état refunded intact. Changement de propriétaire sans remboursement également testé ; terminal avant provider ne l'appelle pas |
| R7 — ledger d'écart transport hors transaction rejouée | Défaut conservé du commit audité | Pré-lecture puis création de `platform_ledger/shipping_cost_variance_<transactionId>` dans la même transaction de règlement, sans écriture aléatoire hors callback | Rejeu du callback après abandon de toutes écritures stagées : une seule entrée, un crédit, un appel provider, delta positif/négatif. Seuil ±2 : coût réel enregistré sans entrée variance |

Un défaut conservé supplémentaire de `charge.refunded` effectuait lui aussi des lectures après écritures. Les lectures wallets/article/engagements sont regroupées avant les mutations, vérifiées par les trois cas de ce handler dans la matrice stricte.

## Fichiers examinés et modifiés

| Chemins | Sections examinées/corrigées |
| --- | --- |
| `functions/src/callable/wallet.ts` | Ordre transactionnel `payWithWallet` non shipping ; libération article de `refundWalletPayment` |
| `functions/src/utils/sellerEscrow.ts`, `functions/src/scheduled/releaseHeldFunds.ts`, `functions/src/utils/trackingTransition.ts` | Contrat pending→held→balance, preuve de montant réel, dette ; tracking lu comme contrat du helper de livraison |
| `functions/src/utils/articleReservation.ts` | Nouveau helper propriétaire/fallback legacy et suppression du seul pointeur correspondant |
| `functions/src/callable/payments.ts` | Uniquement intégration no-show et cancel pending de ce passage ; acceptation/prix appartiennent au lot offres/intégrateur |
| `functions/src/utils/refund.ts` | Libération article conditionnelle du coeur de remboursement partagé |
| `functions/src/scheduled/transactionExpiration.ts` | Expiration meetup pending, meetup confirmed, pending payment |
| `functions/src/http/webhooks.ts` | PI terminal payment_failed et full charge.refunded ; ordre des lectures du second |
| `functions/src/utils/labelFulfillment.ts` | Réservation/commit label, garde état/propriété, alerte bordereau orphelin ; coût réel et ledger variance atomique |
| `functions/src/utils/testHelpers/firestoreMock.ts` | Option d'imposer toutes lectures avant écritures, sans changement des autres suites par défaut |
| `functions/src/callable/wallet.test.ts` | Double local : contrat doc.id/query get/delete corrigé ; métadonnées retrait liées au vrai document persisté, avec assertions complètes préservées |
| `functions/src/callable/payWithWallet.label.test.ts`, `functions/src/utils/financeTransitions.test.ts`, `functions/src/utils/labelFulfillment.test.ts` | Tests stricts d'ordre, conservation, provider tardif et rejeu callback |
| `functions/src/utils/articleReservation.test.ts`, `functions/src/utils/articleReservationFlows.test.ts` | Tests helper et intégration des 9 transitions |
| `firestore-schema.md`, `CODEBASE_INDEX.md`, `docs/audit-20261006/finance.md` | Champs réellement tenus en séquestre et index/documentation mis à jour |

Les neuf transitions intégrées : cancel pending, no-show, wallet refund admin, coeur refund, expiration meetup pending, expiration meetup confirmed, expiration paiement, PI échec terminal et full charge.refunded. Les remboursements/annulations serveur qui réutilisent le coeur refund bénéficient de sa garde. L'inventaire ne prétend pas examiner chaque ligne du backend, chaque machine historique ni les données déployées.

## Vérifications finales du lot

- Ensemble ciblé élargi : **285/285 tests passés dans 18 fichiers**. `/tmp/finance-second-final-targets.log`. Inclut nouveaux scénarios et suites existantes wallet, checkout mixte, withdrawal, payout recovery/outcome, reconcile/retry, expiration, shipping constructor, phase, labels, refunds webhook et tracking.
- `./node_modules/.bin/tsc --noEmit` dans `functions` : **passé**, sortie vide. `/tmp/finance-second-final-tsc.log`.
- `git diff --check` : **passé**.
- Preuve avant correction R3/R4 : quatre échecs reproductibles, puis correction ; logs `/tmp/finance-review-red.log`, `/tmp/finance-review-green.log`.
- Anciennes suites conservées. Les premiers reruns ont signalé les lacunes du double wallet (query/get/id/delete) et deux assertions de test null/undefined ; corrigées sans retirer de test ni assouplir les invariants monétaires.
- Validation globale Functions/règles/lint/app/E2E : à intégrer au rapport du parent ; aucun Firebase/Stripe/ShipEngine réel ni appareil utilisé par ce lot.

Le double sérialise les transactions ; la vérification des retries abandonne volontairement les écritures stagées et rejoue le callback. Cela vérifie l'atomicité logique et l'absence d'écriture comptable hors callback, sans prétendre reproduire la contention, les backoffs ou le réseau réel de l'Admin SDK.

## Limites opérationnelles

- Un ledger legacy sans preuve de mouvement held bloque la libération et émet une erreur de rapprochement ; il exige une décision propriétaire sur les données historiques. Aucune réparation de données externes effectuée.
- Un bordereau déjà acheté puis rendu orphelin n'est pas annulé automatiquement : l'alerte conserve son identifiant pour rapprochement, sans nouveau crédit vendeur ni réactivation. Les erreurs de persistance de l'alerte restent journalisées par le helper best-effort.
- Les soldes wallet sont des buckets agrégés. Cette correction conserve le montant attribué au mouvement de livraison d'une vente ; elle ne certifie pas l'exhaustivité de tous les ledgers historiques ni ne remplace une réconciliation financière complète.
- Le fallback article legacy lit tous les engagements de l'article avant écriture. Coût supplémentaire limité aux documents sans pointeur ; les données historiques et leur volumétrie n'ont pas été consultées.
- Les résultats Stripe inconnus restent réservés selon la politique du premier passage. Aucun paiement/livraison/forfait activé pour vérifier ces transitions et aucune règle économique modifiée.
