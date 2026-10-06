# Audit offres et rencontre — 2026-10-06

Base examinée : `main` `b79d0c8e47a18ec9b405b13e8229a63f5ef02980`. Modifications locales sur `audit/seconde-security-ux-20261006`. Aucun déploiement, publication ou paiement. Ce document couvre le lot offres/rencontre ; il ne constitue pas un audit exhaustif du dépôt.

## Règle retenue et changements

Une seule proposition de rencontre en attente par acheteur/article, commune aux entrées article, conversation et commande directe. Une nouvelle proposition remplace atomiquement l'ancienne. Le récapitulatif annonce ce remplacement avant envoi. Les anciennes cartes portent « Remplacée ». Les acheteurs différents gardent des négociations indépendantes jusqu'à l'acceptation, qui réserve l'article pour un seul accord.

`sendMeetupProposal` et `rejectMeetupProposal` sont les nouvelles callables. Les participants, rôles, disponibilité, blocages, montant, lieu et réponses périmées sont vérifiés côté serveur. Les contre-propositions remplacent l'originale dans la même transaction. Un document privé de contention par acheteur/article couvre aussi les conversations historiques dupliquées. Une requête avec le même identifiant rejoue son résultat ; des requêtes simultanées aux mêmes termes retournent la même carte, et les requêtes aux termes différents convergent vers une seule proposition en attente. Une adoption des anciennes propositions est effectuée à la première écriture ; les écritures suivantes lisent seulement la proposition courante plutôt que tout l'historique.

L'acceptation crée atomiquement l'accord, le verrou de l'article et les liens `offer.transactionId`, `transaction.offerMessageId`, `article.activeTransactionId`. Plusieurs propositions historiques ambiguës doivent être remplacées explicitement avant acceptation. Un ancien accord non lié n'est adopté que s'il est encore `meetup_pending` et correspond exactement aux acheteur, vendeur, article, conversation, montant et lieu. Un accord accepté n'est jamais réécrit par une autre proposition. Le refus d'une ancienne proposition ne modifie aucune transaction. Les confirmations et complétions vérifient les liens exacts ; la complétion de la carte est écrite côté serveur avec l'accord, et non plus par le client. Les appels répétés aux transitions réussies sont idempotents.

Les montants sont analysés de façon identique aux étapes montant/récapitulatif, y compris la virgule des claviers français, sans troncature de texte. Le choix d'un lieu suggéré ne navigue plus automatiquement. Lieu suggéré, lieu personnalisé et « À convenir par messagerie » conduisent à Continuer, puis au récapitulatif, puis à un envoi distinct. Le lieu différé est explicitement modélisé et évite le doublon type/quartier dans la carte. La commande directe suit également ces étapes et annonce une proposition en attente. Une miniature/titre compacte est fournie dans l'étape lieu de la modale ; le prix quitte l'en-tête de personne de la conversation. Les mentions de lieu résident dans la carte structurée et les résumés utiles ; les messages système clients redondants ont été retirés.

Les expirations planifiées et les triggers de vente/retrait relisent le statut dans une transaction avant écriture. Un snapshot ancien ne peut plus transformer une proposition acceptée en expirée. Les triggers relisent aussi l'état courant de l'article : réactivation et remise en vente sont préservées. Les suppressions d'index/retraits de favoris vérifient cet état courant. Une notification système d'expiration est créée une seule fois par événement/conversation.

## Fichiers examinés

- Instructions : `CLAUDE.md`, `.claude/agents/firebase-backend.md`, `.claude/agents/rn-expo-dev.md`, `.agents/skills/firebase-firestore/SKILL.md`, `.agents/skills/tdd/SKILL.md`, `CODEBASE_INDEX.md`. Les consignes de déploiement et d'accès à des bases externes ont été remplacées par l'autorisation limitée aux modifications/tests locaux.
- Serveur : sections rencontre de `functions/src/callable/payments.ts`, `functions/src/scheduled/offerExpiration.ts`, `functions/src/triggers/articles.ts`, `functions/src/triggers/messages.ts`, `functions/src/config/firebase.ts`, `functions/src/index.ts`, `functions/src/utils/testHelpers/firestoreMock.ts`, tests d'acceptation/expiration existants et nouveaux tests du lot. Nouvelle logique : `functions/src/callable/offers.ts`, `functions/src/utils/meetupOffers.ts`.
- Client : `services/chatService.ts`, `services/transactionService.ts`, `services/moderationService.ts`, `app/chat/[id].tsx`, `app/article/[id].tsx`, `app/checkout/meetup.tsx`, `features/article/hooks/useArticleActions.ts`, `features/chat/components/ChatHeader.tsx`, `features/chat/components/ChatArticleBar.tsx`, `features/chat/types.ts`, tous les fichiers de `components/MakeOfferModal/`, `components/OfferBubble.tsx`, `components/offer-bubble/useOfferTransaction.ts`, `types/index.ts`, `tests/jest/chatService.send.test.ts`.
- Parcours automatisés : `.maestro/flows/offers-make-offer.yaml`, `.maestro/flows/buy-checkout-meetup.yaml`. Leurs attentes ont été alignées sur le récapitulatif et la proposition en attente ; ils n'ont pas été exécutés sur un appareil.
- Configurations de tests : `package.json`, `functions/package.json`, `functions/tsconfig.json`, `functions/vitest.config.ts`, `tests/security/helpers.ts`, `tests/security/vitest.config.ts` ; protection des champs/collections coordonnée avec le lot règles.

## Matrice de parcours

| Parcours / cas | Examiné | Corrigé | Vérification | Limite |
| --- | --- | --- | --- | --- |
| Proposition depuis article, chat et commande directe | Oui | Contrat serveur commun, politique annoncée | Tests service/callables ; lecture des trois entrées | Pas de parcours appareil |
| Lieu suggéré / personnalisé / différé | Oui | Continuer explicite puis récapitulatif/envoi | 4 tests de composant contrôlé | Rendu bottom-sheet et gestes non vérifiés sur appareil |
| Miniature à l'étape lieu, prix en header personne | Oui | Propagation URL, rappel compact ; prix supprimé | Typecheck/lint et lecture du rendu | Pas de capture ni assertion visuelle |
| Réordre de choix et retour vers le lieu | Oui | Sélection conservée au retour ; quartier modifié réinitialise le lieu | Logique composant relue | Pas de test appareil |
| Double clic / rejouabilité d'une requête | Oui | Mutex client + identifiant stable + déduplication serveur | Tests client et backend avec état persistant | Contention réelle émulateur non exécutée |
| Contre-proposition invalide ou réponse périmée | Oui | Transaction atomique, contrôles d'état | Tests sans modification de l'originale | Aucune mutation production |
| Plusieurs acheteurs / conversations dupliquées | Oui | Verrou acheteur/article et unicité à acceptation | Tests concurrents avec harness sérialisé | Harness ne simule pas les retries Firestore réels |
| Ancien refus après accord accepté | Oui | Aucune annulation de transaction dans le refus | Tests serveur/client | Données historiques réelles non examinées |
| Adoption d'un ancien accord de commande | Oui | Uniquement mêmes termes, encore non accepté/non lié | Tests montant/lieu/statut/lien différents | Anciens accords sans données suffisantes refusés plutôt que modifiés |
| Confirmation / complétion d'accord | Oui | Liens exacts et écritures serveur atomiques | Tests replay et message ancien du même chat | Aucun paiement en ligne |
| Expiration puis acceptation / retrait/réactivation | Oui | Relire article et proposition dans la transaction | Tests de snapshots périmés et replay trigger | Notifications push non testées sur appareil |
| Création directe d'accord via `createTransaction(meetup)` | Oui | Bypass signalé au lot finance pour fermeture | Vérification intégrée par le responsable finance/root | Hors ownership de la modification dans ce lot |
| Offres shipping historiques | Oui | Nouvelles offres shipping client désactivées ; refus sûr serveur | Tests de blocage avant écriture | Lancement livraison non autorisé ; aucune activation |

## Vérifications réalisées

- 44 tests backend ciblés passent : `offers.test.ts`, `acceptMeetupOffer.test.ts`, `offerExpiration.acceptedUnconsumed.test.ts`, `articles.offers.test.ts`.
- 37 tests Jest ciblés passent : `LocationStep.test.tsx`, `ConfirmStep.test.tsx`, `OfferStep.test.tsx`, `chatService.send.test.ts`.
- ESLint ciblé des composants/écrans/services modifiés : aucune erreur.
- Typecheck application et Functions : aucune erreur à la dernière vérification du lot. Typecheck des tests : ancien mock de réponse callable corrigé ; résultat global à reprendre dans le rapport d'intégration.
- Snapshot intermédiaire de la suite complète Functions : 502 réussis, 2 ignorés, avant les derniers tests de races du trigger ; la validation finale appartient à l'intégration unique.
- `offers.emulator.test.ts` ajoute deux tests de contention réelle du SDK Admin avec projet explicite `demo-second` et hôte émulateur loopback obligatoires. Ils sont ignorés sans émulateur. Le téléchargement des binaires officiels d'émulateur a été bloqué dans l'environnement (HTTP 403 signalé par root) ; aucune tentative vers production.
- Les attentes Maestro ont été corrigées, mais ni E2E mobile, ni gestes, ni captures visuelles n'ont été exécutés dans ce lot.

## Risques et travaux restant

Les changements ne sont pas déployés. Les nouveaux clients et les règles interdisant les écritures d'offres doivent être livrés avec les nouvelles callables dans un déploiement ultérieur autorisé et contrôlé. Les anciens clients qui écrivent encore directement des offres ne fonctionneront pas avec ces nouvelles règles : c'est une incompatibilité volontaire de la migration vers l'autorité serveur.

Les accords historiques incomplets ou contradictoires ne sont pas modifiés automatiquement. Un accord accepté sans lien, montant ou lieu exploitable doit être réconcilié par son propriétaire avant de créer un nouvel engagement. Les tests de contention réelle et les parcours sur appareil restent nécessaires avant une livraison ; la sérialisation du harness ne prouve pas à elle seule les retries du service Firestore. Les contrôles globaux de disponibilité dans `products.ts`, la fermeture de la création directe de meetup et les règles serveur sont intégrés par les autres responsables du chantier.
