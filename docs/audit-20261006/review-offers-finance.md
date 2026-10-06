# Revue indépendante — offres et finances

Date : 2026-10-06. Cible figée de cette revue : branche `audit/seconde-security-ux-20261006`, commit `7551244971b19efb0269df15a35e48763c273bc3`, comparé à `b79d0c8e47a18ec9b405b13e8229a63f5ef02980`. Les références de lignes ci-dessous désignent cette cible ; les corrections ultérieures du parent ne sont pas implicitement validées ici.

Revue réalisée par l'agent médias/règles sur les domaines offres/finances confiés à d'autres agents. Lecture des sources, des différences et des tests ; aucun correctif de source, commit, publication, déploiement ou appel Firebase/Stripe de production. Seul ce rapport est ajouté. Ce rapport décrit une couverture ciblée, pas un audit exhaustif du dépôt ou une preuve de conformité.

## Constats confirmés

### R1 — Prix inférieur à 1 $ : le nouvel achat direct ne peut pas aboutir

**Sévérité : moyenne ; régression du parcours local gratuit.** `functions/src/callable/offers.ts:107` et `functions/src/callable/payments.ts:2535` imposent un montant minimum de 1 $, alors que `functions/src/callable/products.ts:257` accepte les annonces à partir de 0,01 $. Le checkout local passe maintenant par `ChatService.sendMeetupOffer` (`app/checkout/meetup.tsx:178`). Une annonce à 0,50 $ ne peut donc recevoir aucune proposition valide au prix affiché : 0,50 est trop faible et 1 dépasse son prix.

**Test recommandé :** annonce à 0,50 $, proposition puis acceptation à 0,50 ; conserver le refus d'une remise à 0,49 et le plancher de négociation déjà prévu pour une annonce ordinaire. Vérifier les validations UI et serveur ensemble. Le parent a confirmé ce constat et annoncé un correctif cohérent, hors de la cible figée.

### R2 — Déduplication entre deux conversations : succès sans proposition visible

**Sévérité : moyenne ; nouvelle régression.** La clé de thread est acheteur/article et couvre les conversations dupliquées. `functions/src/callable/offers.ts:113–120` réutilise néanmoins une proposition identique sans vérifier que son `chatId` est celui de la nouvelle demande. Le service client ne reçoit que `messageId` (`services/chatService.ts:493–499`) et le checkout poursuit dans la conversation demandée. Deux chats historiques pour le même acheteur/article suffisent : une proposition existe dans A, l'envoi des mêmes termes dans B retourne un succès et l'identifiant du message de A ; B reste vide. La déduplication ne compare pas non plus l'heure, mais les envois initiaux actuels n'en fournissent pas.

**Test recommandé :** deux chats du même couple acheteur/vendeur pour le même article ; envoi identique dans A puis B ; exactement une proposition en attente doit exister dans le chat affiché après le succès. Le parent a annoncé une réutilisation limitée au même chat et un remplacement atomique pour les autres chats, hors de cette cible.

### R3 — Paiement wallet hors livraison : lecture après écriture

**Sévérité : élevée pour ce rail financier ; défaut conservé du commit audité.** `functions/src/callable/wallet.ts:690` écrit le débit acheteur, puis `wallet.ts:703` appelle `creditSellerForSale`. Ce dernier appelle `getOrCreateSellerWallet` (`functions/src/utils/labelFulfillment.ts:77`), qui effectue `tx.get` (`wallet.ts:75`). Une transaction Firestore interdit cette lecture après une écriture ; un `pending_payment` hors livraison avec vendeur à créditer échoue donc atomiquement. Il n'y a pas de débit partiellement commis. Le même ordre existe déjà à la base, autour de `wallet.ts:765–778` ; ce n'est pas une régression introduite par le lot. Le drapeau de phase ferme actuellement les nouveaux paiements et le parcours livraison diffère le crédit, ce qui limite l'exposition actuelle.

**Test recommandé :** appeler ce parcours avec un double transactionnel qui refuse toute lecture après la première écriture, pour un wallet vendeur existant puis absent. Le double partagé à la cible ne détecte pas cette erreur : `functions/src/utils/testHelpers/firestoreMock.ts:379–406` stocke les écritures, autorise toutes les lectures et sérialise simplement les callbacks. Le parent a confié ce correctif et ces tests à l'agent finances.

### R4 — Livraison sous-financée : libération des fonds d'une autre vente

**Sévérité : élevée pour le rail livraison ; incohérence créée par le nouveau plafonnement.** `functions/src/utils/trackingTransition.ts:142` conserve le crédit net théorique dans `sellerPendingCreditCents`. `functions/src/scheduled/releaseHeldFunds.ts:88` plafonne ensuite le mouvement réel au `pendingBalance` disponible, sans enregistrer ce montant réellement mis en attente pour la transaction. La libération à `releaseHeldFunds.ts:200–203` utilise de nouveau le crédit net théorique et le solde held global.

**Scénario chiffré :** A possède un crédit net de 4 500 cents ; son wallet contient seulement 1 000 cents pending et 2 000 cents held provenant de B, dont la fenêtre de litige n'est pas écoulée. La livraison de A déplace 1 000 cents et porte held à 3 000. À l'échéance de A, le scheduler libère `min(4500, 3000) = 3000`, dont les 2 000 cents de B. La somme globale reste conservée, mais la date de disponibilité et l'attribution par transaction sont fausses. La vente A est aussi déclarée terminée malgré le manque.

**Test recommandé :** pending insuffisant + held d'une autre vente, puis livraison/libération de A ; seule la somme effectivement placée en held pour A doit être libérée. Ajouter le cas pending nul et la migration historique depuis le ledger exact `funds_held`. Les tests nouveaux `financeTransitions.test.ts:49–88` vérifient les dettes et des fonds held indépendants lorsque pending est complet ; ils ne couvrent pas le sous-financement. Le parent a confié ce constat à l'agent finances.

### R5 — Ancienne transaction : annulation/délai/remboursement déverrouille un accord distinct

**Sévérité : élevée sur données historiques incohérentes ; défaut conservé, intégration incomplète du nouveau lien.** L'acceptation écrit maintenant `articles.activeTransactionId` (`functions/src/callable/payments.ts:2583`). Plusieurs transitions terminales déverrouillent pourtant l'article sans vérifier ce lien : `payments.ts:3777` dans `cancelPendingTransaction`, `functions/src/scheduled/transactionExpiration.ts:251` pour un meetup confirmé expiré, et `functions/src/utils/refund.ts:247` lors d'un remboursement avec remise en vente.

**Scénario :** deux anciennes transactions non terminales A et B partagent un article ; B représente l'accord actif et `activeTransactionId` pointe B. L'annulation autorisée de A met `isSold=false` alors que B reste accepté. Les nouvelles créations évitent normalement ce doublon ; cela ne corrige pas les doublons historiques explicitement visés par l'audit. Le garde d'édition de `products.ts` continue à refuser une modification en présence de B, mais le listing devient affichable comme disponible.

**Test recommandé :** ancienne transaction A + accord B lié à l'article ; annuler/expirer/rembourser A conserve `isSold=true` et le lien B. Seule une transition du propriétaire réel du verrou peut le libérer ; pour les articles sans lien, rechercher les autres engagements vivants dans la même transaction. Constats transmis au parent.

### R6 — Création tardive de bordereau après remboursement

**Sévérité : élevée sur le rail livraison ; défaut conservé du commit audité.** Le commit final de `createLabelIdempotent` (`functions/src/utils/labelFulfillment.ts:424–448`) ne refuse que les états déjà munis d'un bordereau, `label_created`, `shipped` et `delivered`. Il ne refuse pas `cancelled` ou `refunded`. Si un remboursement termine pendant l'appel ShipEngine, la réponse tardive peut recréditer le vendeur puis écrire `status='label_created'` (`labelFulfillment.ts:457–474`) sur la transaction remboursée.

**Test recommandé :** suspendre la réponse du faux ShipEngine après réservation, terminer un remboursement, reprendre cette réponse ; l'état terminal doit rester terminal et aucun crédit vendeur ne doit apparaître. La réponse externe existante doit être conservée pour réconciliation sans réactiver la vente. Le verrou de phase empêche actuellement les nouvelles opérations de livraison ; les opérations historiques de régularisation restent concernées.

### R7 — Écart transport : ledger non idempotent dans un callback rejoué

**Sévérité : moyenne, exactitude comptable ; défaut conservé.** `reconcileShippingCost` ajoute un document à identifiant aléatoire hors de la transaction (`functions/src/utils/labelFulfillment.ts:181–190`), bien que son appel se trouve dans le callback Firestore (`labelFulfillment.ts:462`). Un retry de ce callback peut donc créer plusieurs entrées `shipping_cost_variance` pour un seul bordereau. Les soldes wallets ne sont pas modifiés par ces entrées, mais un agrégat comptable peut compter plusieurs fois l'écart.

**Test recommandé :** rejouer le callback de commit avec un écart dépassant le seuil et vérifier une seule entrée par transaction/bordereau. Une clé déterministe ou une écriture dans la transaction évite la duplication.

## Invariants correctement renforcés à la lecture

| Domaine | Preuve examinée | Conclusion limitée |
| --- | --- | --- |
| Remplacement des propositions | `offers.ts:53–136` | Les lectures précèdent les écritures ; les remplacements et le thread sont écrits atomiquement. Un ancien `requestId` retourne son résultat sans ressusciter l'ancienne proposition. |
| Réponses périmées | `offers.ts:98–102,155–160`, `payments.ts:2555–2556` | Contre-proposition/refus/acceptation exigent la proposition pending actuelle et non expirée. Le refus ne touche plus une transaction de meetup sans rapport. |
| Acceptation unique | `payments.ts:2507–2589` | Lecture et écriture de l'article dans la transaction sérialisent deux acheteurs. Les engagements vivants sont recherchés, et la réutilisation moderne exige le même message, montant, lieu et transaction. Toutes les lectures de cette acceptation précèdent ses écritures. |
| Répétition confirmation/complétion | `payments.ts:2654–2712,2776–2833` | Les messages liés et leurs termes sont contrôlés avant les écritures ; les répétitions terminales retournent sans recréer des mouvements financiers. Le meetup terminé reste sans crédit wallet. |
| Expiration d'offre | `offerExpiration.ts:107–113,197–223` | Les snapshots sont relus transactionnellement et les accords liés consommés sont préservés ; aucune expiration pending ne remplace une acceptation concurrente. |
| Double compensation wallet | `payments.ts:1448–1484` | Le statut, l'absence de PI, le montant réservé et l'identifiant de tentative sont relus avant le remboursement et l'effacement atomique des marqueurs. Une deuxième erreur identique ne recrédite plus la réservation déjà effacée. |
| Résultat payout inconnu | `wallet.ts:485–556`, `payoutOutcome.ts:17–48` | Persistance du transfert avant le payout ; timeout/5xx ou échec de persistance après payout ne recréditent pas. La recherche de payout est bornée et vérifie compte, requête, utilisateur, montant et devise lorsqu'aucun ID connu n'existe. Aucun payout supplémentaire n'est créé pour deviner le résultat. |
| Compensation payout | `payoutRecovery.ts:65–135`, `retryFailedOperations.ts:204–259` | Seul processing peut produire un nouveau crédit ; une répétition failed peut retenter la réversion de transfert sans deuxième crédit. Résultat manquant/ambigu reste inconnu. |
| Dette vendeur | `labelFulfillment.ts:80–130`, `sellerEscrow.ts`, `financeTransitions.test.ts` | Le brut crédité reste distinct du net escrow et de la dette régularisée. Les tests vérifient la conservation sur plusieurs montants/stades, mais R4 reste hors de leur couverture. |
| Marge transport | `labelFulfillment.ts:265–292,446–471` | `netMargin = serviceFee + shippingCostCollected - processorFees - carrierCost` ; taxes séparées, coûts réels utilisés quand connus. L'absence de frais processeur conserve une marge inconnue plutôt qu'une valeur inventée. R7 concerne le ledger d'écart séparé. |
| Phase gratuite | Diff des gardes de `featureFlags.ts`, `payments.ts`, `wallet.ts`, `swaps.ts` et achats de forfait | Les nouveaux paiements restent bloqués ; aucune correction examinée ne nécessite d'activer le rail payant. Les fonctions de remboursement/réconciliation ne sont pas soumises au garde global de nouvelle opération. |

Ces conclusions sont des vérifications de code et de contrats de test, pas une preuve runtime des races Stripe ou de tous les retries Firestore.

## Résultats inconnus : limites opérationnelles conservatrices

1. **Checkout mixte sans PI persisté :** `reconcile.ts:74–78` génère une alerte et ne recherche pas automatiquement un PaymentIntent par la tentative. Timeout ou panne après création et avant `payments.ts:1489` peut donc immobiliser la réservation jusqu'à une réconciliation humaine. Le refus d'annulation d'une tentative `unknown/creating` empêche une compensation injustifiée. Ajouter un test « PI créé, persistance échoue » et un outil de réconciliation en lecture si ce rail doit être rouvert ; ne pas réessayer un débit pour découvrir le résultat.
2. **Transfert sans payout :** si la persistance de `stripeTransferId` échoue avant l'appel payout (`wallet.ts:487`), ou si le transfert a un résultat inconnu, le récupérateur ne cherche que des payouts et ne peut pas prouver automatiquement le sort du transfert. La requête reste processing et ne perd pas ses fonds par un faux recrédit. Ajouter des tests de panne entre chaque étape et prévoir une réconciliation du transfert séparée. C'est une limite de reprise, pas une autorisation de considérer l'absence de payout comme un échec bancaire.

## Test de contention : saut et isolement exacts

`functions/src/callable/offers.emulator.test.ts` contient **deux** tests, tous deux sous `describe.skipIf(!emulatorHost)` à la ligne 45. Le saut dépend uniquement de l'absence de `FIRESTORE_EMULATOR_HOST`, pas du drapeau paiements ni d'une suppression de test.

Vérification locale effectuée pendant cette revue :

```text
env -u FIRESTORE_EMULATOR_HOST ./node_modules/.bin/vitest run src/callable/offers.emulator.test.ts
Test Files 1 skipped (1)
Tests      2 skipped (2)
```

Cet essai ne constitue pas une validation de contention. Le parent avait rencontré un blocage de téléchargement officiel de l'émulateur et travaille à une alternative officielle vérifiée ; un éventuel résultat runtime ultérieur doit être consigné séparément.

**Isolement :** le test refuse tout hôte autre que `127.0.0.1:port` ou `localhost:port` (lignes 4–6). Il initialise un app Admin nommé avec `projectId='demo-second'` (ligne 11), génère les IDs article/chat/message/requête avec un UUID (ligne 47), et supprime seulement ses chemins ou les résultats filtrés par ses IDs (lignes 52–58). Stripe, ShipEngine, notifications et analytics sont remplacés par des doubles ; il ne faut pas fournir de configuration production pour l'exécuter. Aucun accès Firestore n'est déclenché par les hooks quand la suite est sautée. La suite utilise l'Admin SDK : elle contourne les règles et ne remplace pas les tests d'accès client.

**Limites :** les trois UID de fixture sont constants (lignes 37–39), leurs documents utilisateur ne sont ni initialisés ni nettoyés. Un état local antérieur contenant des blocages peut contaminer les tests. Préférer des UID dérivés de l'UUID et des utilisateurs de fixture explicites. Les tests couvrent deux envois concurrents, une réponse ancienne, deux acheteurs à l'acceptation et une répétition d'acceptation. Ils ne couvrent pas les chats dupliqués, l'envoi contre une acceptation, les prix bas, les pannes Stripe ou l'escrow sous-financé.

## Matrice de couverture de cette revue

| Fichiers/parcours | Lu / examiné | Vérifié ici | Reste à valider |
| --- | --- | --- | --- |
| `callable/offers.ts`, `utils/meetupOffers.ts`, tests offres/mock et émulateur | Diff et sources | Ordre lectures/écritures, remplacement, replay, obsolescence, isolement ; saut reproduit | Races runtime et corrections R1/R2 sur code final |
| `callable/payments.ts` : checkout, acceptation, confirmation, complétion, annulation ; constructeur direct | Diff et fonctions concernées | Gardes et compensation inspectés ; R1/R5 | Stripe réel volontairement non exécuté ; retries/contension émulateur finaux |
| `callable/wallet.ts`, `utils/payoutOutcome.ts`, `utils/payoutRecovery.ts`, tests payout | Diff et fonctions concernées | Résultats inconnus, garde de compensation ; R3 | Injection de panne à toutes les frontières externes |
| `utils/labelFulfillment.ts`, `utils/sellerEscrow.ts`, `utils/trackingTransition.ts`, `scheduled/releaseHeldFunds.ts`, `utils/financeTransitions.test.ts` | Diff et sources/tests | Net/brut/dette, marge, ordre des lectures ; R4/R6/R7 | Pannes, retries et sous-financement sur code corrigé |
| `utils/refund.ts`, `scheduled/reconcile.ts`, `scheduled/retryFailedOperations.ts`, `scheduled/transactionExpiration.ts`, `scheduled/offerExpiration.ts` et tests associés | Transitions concernées et différences | Terminalité, résultats inconnus ; R5 | Données historiques incohérentes et concurrence de remboursement/bordereau |
| `callable/products.ts`, `config/featureFlags.ts`, changements financiers `callable/swaps.ts`/achats forfait | Gardes et différences ciblés | Verrou d'édition, fermeture des nouvelles opérations payantes | Machines d'états complètes troc/forfait hors de cette revue |
| `services/chatService.ts`, `services/transactionService.ts`, `app/checkout/meetup.tsx`, formulaires offres | Entrées/contrats concernés | Migration serveur, R1/R2 | UI native et gestes non examinés ici |

Pas de nouveaux tests financiers écrits ni exécutés dans ce lot de revue seule. Les recommandations ci-dessus doivent rejoindre les tests du code final ; les validations globales du parent restent la source de vérité pour le résultat final.
