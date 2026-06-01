## 11. Recours, litiges, remboursements & annulations

Cette section décrit tout ce que l'application Second met à disposition de l'acheteur (et, dans une moindre mesure, du vendeur et de l'équipe support) lorsqu'une transaction se passe mal : colis perdu, article non conforme, problème après livraison, vendeur qui ne livre pas, paiement abandonné, etc. Elle couvre la protection acheteur, les remboursements Stripe, la fenêtre de protection de 7 jours, l'annulation des transactions en attente, et les mécanismes invisibles (re-jeux automatiques, réconciliation) qui garantissent qu'aucun mouvement d'argent ne « disparaît ».

### 11.0 Principe directeur : anti-fraude, jamais sur parole

La règle non négociable de toute la protection acheteur est : **Second ne rembourse jamais sur la seule parole de l'acheteur.** Un remboursement automatique n'est déclenché que par un **signal objectif du transporteur** :

- soit le transporteur confirme que le colis est **perdu** (`lost`) ou **en échec de livraison** (`delivery_failed`) ;
- soit, pour un retour, le transporteur confirme que le colis retourné a bien été **réceptionné par le vendeur**.

Tout ce qui ne tombe pas dans ces cas (« je l'ai reçu mais il y a un problème ») ne donne **aucun mouvement d'argent automatique** : cela ouvre une **réclamation** qui gèle les fonds et passe en revue humaine (équipe support / admin). C'est ce qui distingue les trois recours acheteur ci-dessous.

L'argent en jeu est exclusivement en **dollars canadiens (CAD)** ; tous les remboursements carte transitent par Stripe, la part éventuellement payée avec le porte-monnaie interne (wallet) est re-créditée dans le wallet.

---

### 11.1 Les trois recours de l'acheteur

L'acheteur déclenche ses recours depuis le suivi de commande (composant de suivi d'expédition, intégré à la conversation/au détail de commande). Selon l'état de la commande, des boutons différents apparaissent. Trois actions distinctes sont possibles, chacune adossée à une fonction serveur dédiée.

| Recours | Quand le bouton apparaît | Ce qui se passe | Argent ? |
|---|---|---|---|
| **Remboursement automatique** | Colis confirmé perdu/non livré par le transporteur (`lost`, `delivery_failed`) | Remboursement immédiat, colis non remis en vente | Oui, automatique |
| **Signaler un problème** | Commande expédiée, livrée ou complétée | Gèle les fonds, ouvre une réclamation pour revue humaine | Non (décision admin ensuite) |
| **Demander un retour** | Commande livrée, expédition, dans les 7 jours | Achète une étiquette de retour, gèle les fonds | Remboursement plus tard, à réception du retour |

#### A. Remboursement automatique (colis perdu / non livré)

- **Condition d'accès** : la commande doit être au statut `delivery_failed` ou `lost` — c'est-à-dire que le transporteur lui-même a signalé l'échec. Si l'acheteur tente ce recours sur une commande simplement livrée avec un souci, la demande est **refusée** avec un message qui le réoriente vers « Signaler un problème ».
- **Réservé à l'acheteur** de la commande. Limité à 5 tentatives par minute.
- **Effet** : la commande passe en `refund_in_progress` puis `refunded`. La part carte est remboursée via Stripe (avec récupération de l'argent versé au vendeur — voir 11.5), la part wallet est re-créditée à l'acheteur, le vendeur est débité de ce qu'il avait reçu.
- **Important** : l'article **n'est PAS remis en vente** — le colis étant perdu, l'objet a disparu physiquement.
- **Notifications** : acheteur et vendeur sont prévenus (« Remboursement effectué » / « Commande remboursée »).
- **Sécurité** : l'opération est **idempotente** (si déjà remboursée, elle ne fait rien) ; si le remboursement Stripe échoue, le statut est remis dans son état initial pour que l'acheteur puisse réessayer, et l'opération est mise en file de re-jeu (voir 11.7).

#### B. Signaler un problème (livré mais litige)

- **Condition d'accès** : commande au statut `shipped`, `delivered` ou `completed`. C'est le recours « le scan "livré" fait foi, mais j'ai un souci ».
- **Motifs proposés** (l'acheteur choisit dans une liste) :
  - colis jamais reçu malgré le scan « livré » ;
  - article non conforme à la description ;
  - article endommagé ;
  - autre.
  - Un champ texte libre optionnel (« Décrivez le problème », 1000 caractères max) complète le motif.
- **Effet** : **aucun mouvement d'argent.** La commande passe en `disputed`, les fonds sont **gelés** (`disputed = true`), l'état précédent est mémorisé, le rapport de l'acheteur est enregistré, et une **fiche de litige** (`disputes`) est ouverte pour revue par l'équipe.
- **Une seule réclamation à la fois** : signaler à nouveau une commande déjà en litige est refusé. Une commande déjà remboursée ne peut pas être signalée.
- **Résolution** : la suite (rembourser ou non) est une **décision humaine** prise par un admin via l'outil de remboursement admin (voir 11.4) — cette fonction ne tranche jamais elle-même.

#### C. Demander un retour (article non conforme, je le renvoie)

- **Conditions d'accès cumulatives** :
  - statut `delivered` (livraison confirmée par le transporteur) ;
  - **mode expédition** uniquement (`shipping`) — un retour par étiquette n'a pas de sens pour une remise en main propre / meetup ;
  - **dans la fenêtre de 7 jours** : les fonds ne doivent pas encore avoir été libérés au vendeur, et l'échéance de libération doit être dans le futur.
- **Motifs proposés** : non conforme à la description, endommagé, mauvais article, autre.
- **Effet immédiat** : l'application **achète une étiquette de retour** (via ShipEngine) — origine = adresse de livraison de l'acheteur, destination = adresse du vendeur. La commande passe en `return_requested`, les fonds sont **gelés**. **Aucun remboursement à ce stade.** Le vendeur est notifié (« Retour demandé… le remboursement sera traité à sa réception »).
- **Frais de retour à la charge de l'acheteur** : c'est explicitement annoncé dans l'écran (encart d'avertissement). Le remboursement final sera **le total payé moins le coût de l'étiquette de retour**.
- **Déclenchement du remboursement** : il n'arrive **que lorsque le transporteur confirme que le colis retourné est livré au vendeur**. À ce moment :
  - l'acheteur est remboursé de `total − coût étiquette retour` (réparti entre carte et wallet) ;
  - le vendeur est débité de son gain ;
  - l'article **n'est pas remis en vente automatiquement** (le vendeur a récupéré l'objet, il décide manuellement de le re-proposer) ;
  - acheteur et vendeur sont notifiés.
- **Garde-fous techniques** : opération idempotente (si un retour est déjà en cours, ne refait rien) ; si l'étiquette est achetée mais qu'une demande concurrente gagne la course, l'étiquette est journalisée pour nettoyage manuel ; limité à 3 demandes par minute.
- **Côté acheteur** : tant que le retour est en cours, l'écran affiche le numéro de suivi du retour et un bouton « Voir l'étiquette de retour » (téléchargement/ouverture du lien transporteur).

---

### 11.2 La sélection du motif (écran commun de réclamation)

Les recours B et C partagent un même **panneau de sélection de motif** (bottom sheet) :
- un titre et une introduction fournis par le contexte ;
- une liste de motifs en français (boutons radio) ;
- pour « Signaler un problème », un champ texte libre s'affiche pour décrire le souci ;
- pour « Demander un retour », un encart d'avertissement rappelle que **les frais de retour sont à la charge de l'acheteur** ;
- un bouton de validation, désactivé tant qu'aucun motif n'est choisi, qui affiche un indicateur de chargement pendant l'envoi.

Spécificité technique multi-plateforme : ce panneau monte son contenu **uniquement à l'ouverture** (et non en permanence). C'est une contrainte produit connue sous Android : un panneau monté en permanence pose un « voile » transparent qui bloque le défilement et les clics. Le comportement est donc identique et fiable sur iOS et Android.

---

### 11.3 La fenêtre de protection de 7 jours (escrow / fonds gelés)

Le cœur de la protection acheteur repose sur un modèle d'**entiercement (escrow) à trois poches** sur le porte-monnaie du vendeur :

| Poche | Signification |
|---|---|
| `pendingBalance` | Vente payée, **pas encore livrée** (en transit) |
| `heldBalance` | **Livré**, dans la fenêtre de litige de 7 jours |
| `balance` | **Disponible au retrait** (fenêtre écoulée, aucun litige) |

Cycle de vie des fonds d'un achat :
1. **Paiement confirmé** → le gain du vendeur entre en `pendingBalance` (en attente).
2. **Livraison confirmée** (scan transporteur) → les fonds passent de `pendingBalance` à `heldBalance`, et la commande reçoit une **échéance de libération = date de livraison + 7 jours**.
3. **7 jours plus tard, sans litige** → un job automatique (toutes les heures) déplace les fonds de `heldBalance` vers `balance` (retirables), et la commande passe en `completed`.

**Blocage en cas de litige** : le job de libération ne libère **jamais** une commande marquée `disputed`, `delivery_failed`, `lost` ou `refunded`, ni une commande avec `disputed = true`. Tant qu'un litige est ouvert, les fonds restent gelés en `heldBalance`. C'est ce gel qui rend les recours B et C « sans risque » : ils posent simplement `disputed = true` et l'argent cesse d'avancer vers le vendeur.

**Conformité Loi 25 (Québec) — décision automatisée** : la libération des fonds à J+7 est une **décision automatisée**. À ce titre :
- elle est **journalisée** (critères : statut livré, absence de litige, échéance, fenêtre de 7 jours) ;
- le vendeur reçoit une notification qui indique **explicitement** que la décision est automatique et **qu'elle peut être contestée** (droit à une révision humaine). Le message type : « Vos fonds ont été libérés automatiquement… Si vous contestez cette décision, vous pouvez nous le signaler. »

**Contestation d'une décision automatisée (Loi 25, art. 12.1)** : depuis l'écran de suivi, un encart « Contester cette décision » permet d'ouvrir une demande de **révision humaine** (libération de fonds, expiration/annulation automatique, etc.). L'utilisateur choisit un motif, ajoute un texte libre ; un accusé confirme : « Votre contestation a été transmise. Notre équipe procédera à une révision humaine de cette décision. » Ce chemin de contestation est volontairement rendu accessible **aussi pour les transactions en main propre (meetup)**, même s'il n'y a pas de suivi colis, car une décision automatisée (ex. annulation auto d'un meetup) peut quand même les concerner.

---

### 11.4 Remboursement décidé par l'admin (résolution d'un litige)

Quand une réclamation « Signaler un problème » est arbitrée en faveur de l'acheteur, l'équipe utilise une fonction d'admin de remboursement :
- **Réservée aux administrateurs** (claim `admin` ou champ `isAdmin` sur le profil).
- **Statuts remboursables** : `paid`, `label_created`, `shipped`, `delivered`, `delivery_failed`, `lost`, `disputed`, `return_requested`.
- **Effet** : remboursement complet via le même moteur partagé (carte + wallet), débit du vendeur, et — par défaut — **remise en vente de l'article** (contrairement aux remboursements pour colis perdu ou retour, où l'objet n'est pas remis en vente).
- Idempotente : une commande déjà remboursée renvoie « déjà remboursé » sans rien refaire.

---

### 11.5 Mécanique du remboursement (carte + wallet + dette vendeur)

Tous les remboursements de l'app passent par un **moteur unique** (cœur de remboursement partagé), garant de la cohérence, quel que soit le déclencheur (colis perdu, retour réceptionné, expiration, décision admin). Sa logique métier :

1. **Part carte** remboursée via Stripe, en **dehors** de toute transaction Firestore, avec une **clé d'idempotence déterministe** (propre à chaque remboursement logique) pour qu'un re-jeu ne rembourse jamais deux fois.
   - Pour les paiements « destination » (l'argent était parti vers le compte connecté du vendeur), Stripe rapatrie l'argent du vendeur (`reverse_transfer`) et restitue aussi la commission plateforme (`refund_application_fee`).
   - Pour les paiements mixtes (wallet + carte) encaissés directement par la plateforme, il n'y a pas de transfert à inverser.
2. **Réconciliation comptable atomique** :
   - re-crédit de la part **wallet** à l'acheteur (avec écriture au registre/ledger) ;
   - **débit du vendeur exactement de ce qui lui avait été crédité**, prélevé dans l'ordre `pendingBalance` → `heldBalance` → `balance` ;
   - si le vendeur n'a plus assez de fonds (déjà retirés), le manque est enregistré comme **dette vendeur** (`sellerDebt`) à récupérer plus tard ;
   - remise en vente de l'article **seulement si demandé** (oui pour admin, non pour colis perdu et retour).

**Remboursements partiels** : pour un retour, le moteur sait rembourser un montant carte précis (`total − coût retour`), plafonné à la part carte réellement débitée, le reste venant du wallet.

**Spécificités Canada** : montants en CAD ; la commission plateforme est de fait nulle côté vendeur (modèle « 0 % commission vendeur », monétisation via les boutiques payantes), donc un remboursement restitue essentiellement le prix article + frais le cas échéant.

---

### 11.6 Annulation d'une transaction en attente

Deux chemins d'annulation existent, selon que la commande a été payée ou non.

#### Annulation par l'utilisateur (commande non avancée)

- **Qui** : l'acheteur **ou** le vendeur de la commande.
- **Statuts annulables** : `pending`, `pending_payment`, `meetup_pending`, `meetup_confirmed`. Au-delà (payée, expédiée, livrée), l'annulation directe est refusée — il faut passer par les recours/remboursements.
- **Effet** : la commande passe en `cancelled`, l'**article est remis en vente** (`isSold = false`), et si une part wallet avait été engagée, elle est **re-créditée** à l'acheteur (avec écriture au ledger « transaction annulée »).
- Limité à 20 appels par minute.

#### Expiration automatique (transactions « orphelines »)

Un job horaire annule les transactions jamais finalisées :

| Cas | Délai | Effet |
|---|---|---|
| Meetup en attente (vendeur n'a jamais confirmé) | 48 h | Annulée, article remis en vente. **Aucun argent** (meetup = cash en main) |
| Meetup confirmé jamais finalisé (zombie) | 7 jours | Annulée, article remis en vente. Aucun argent |
| Paiement en attente (acheteur n'a jamais payé) | 1 h | Annulée, article remis en vente (voir garde-fou ci-dessous) |
| Payée mais jamais expédiée (vendeur ne livre pas) | 7 jours | **Remboursement** de l'acheteur (carte + wallet) + acheteur notifié |

**Garde-fou « paiement en vol »** : avant d'expirer une commande en `pending_payment`, le système vérifie l'état réel du paiement chez Stripe. Si un paiement est en cours / capturé / déjà réussi (`requires_capture`, `processing`, `succeeded`), la commande **n'est pas annulée** — sinon on risquerait d'annuler une commande dont la carte vient d'être débitée. On laisse le webhook (ou la réconciliation) finir le travail.

**Reprise des remboursements interrompus** : le même job rattrape les commandes coincées en `refund_in_progress` (remboursement qui aurait planté en cours de route) et les finalise sans double-remboursement, en réutilisant l'identifiant de remboursement Stripe déjà enregistré.

#### Annulation côté swap (échange)

Pour les **swaps** (échanges entre articles), un job dédié annule les propositions restées trop longtemps en attente. Cas important : un swap encore en `payment_pending` (la part monétaire d'appoint n'a jamais été payée) est simplement passé en `cancelled` — **aucun remboursement n'est nécessaire car rien n'a jamais été encaissé**. Un swap déjà payé bascule au besoin dans les recours/litiges standards décrits plus haut.

---

### 11.7 Filet de sécurité financier : re-jeu (dead-letter) et réconciliation

Comme tout repose sur Stripe et sur des webhooks, l'app intègre deux mécanismes invisibles pour qu'**aucune opération d'argent ne se perde silencieusement**.

#### Re-jeu des opérations échouées (dead-letter)

Chaque fois qu'une opération financière échoue (un remboursement Stripe qui plante, une inversion de transfert, l'annulation d'un virement…), elle est **enregistrée dans une file** (`failed_operations`) plutôt que perdue. Un job tourne **toutes les 30 minutes** et re-tente ces opérations :
- Chaque re-jeu réutilise **la même clé d'idempotence** que l'appel d'origine : re-jouer une opération qui avait en fait réussi est sans danger (Stripe renvoie le résultat d'origine, sans double effet).
- **Backoff exponentiel** : les délais entre tentatives s'allongent (30 min → 1 h → 2 h → 4 h → 8 h).
- Après **6 tentatives** infructueuses, l'opération est marquée `exhausted` et **escaladée à un humain** (ligne de log « CRITICAL » qui déclenche une alerte). On ne tente jamais d'action destructrice à l'aveugle : un type d'opération inconnu ou un écart de montant non auto-réparable est laissé visible pour traitement manuel.
- Types couverts : remboursements Stripe (carte / destination), inversion de transfert, annulation de virement (payout), écart de montant (avec, le cas échéant, un remboursement automatique pour « rendre l'acheteur entier »).

#### Réconciliation périodique (détection d'écarts)

Un job tourne **toutes les 6 heures**, en **détection seule** (il ne modifie jamais l'argent de sa propre initiative — auto-« réparer » un écart mal compris risquerait d'aggraver la perte). Trois passes :
1. **Paiements** : repère une commande restée en `pending_payment` alors que le paiement Stripe a en réalité réussi (webhook perdu) → log critique + mise en file pour revue.
2. **Retraits (withdrawals)** : repère un retrait vendeur coincé en `processing` alors que le virement Stripe est en réalité payé (→ marqué complété), échoué ou annulé (→ mis en file pour re-créditer le vendeur).
3. **Soldes (wallets)** : vérifie des invariants — aucune poche ne doit être négative (`balance`, `pendingBalance`, `heldBalance`, `sellerDebt`). Toute violation est un bug structurel signalé en critique.

Les webhooks restent le chemin principal (cas nominal) ; ces deux jobs sont le filet en cas de webhook perdu ou d'incident réseau.

---

### 11.8 États (statuts) d'une transaction liés aux recours

Récapitulatif des statuts qui interviennent dans cette section :

| Statut | Signification métier |
|---|---|
| `pending` / `pending_payment` | En attente (annulable par acheteur/vendeur ; expire) |
| `meetup_pending` / `meetup_confirmed` | Remise en main propre, en attente / confirmée (annulable ; expire) |
| `paid` | Payée, en attente d'expédition (expire à 7 j → remboursement) |
| `shipped` / `delivered` / `completed` | Expédiée / livrée / clôturée (« Signaler un problème » possible) |
| `delivery_failed` / `lost` | Échec livraison / perdu (remboursement auto possible) |
| `disputed` | Réclamation ouverte, fonds gelés, revue humaine |
| `return_requested` | Retour en cours (étiquette achetée, fonds gelés) |
| `refund_in_progress` | Remboursement en cours (repris automatiquement si interrompu) |
| `refunded` | Remboursée (terminal) |
| `cancelled` | Annulée (terminal) |

Champs clés associés : `disputed` (booléen de gel), `statusBeforeDispute` (état avant litige), `fundsReleaseAt` / `fundsReleasedAt` (échéance / horodatage de libération à J+7), `buyerReport` (motif + détail de la réclamation), `returnLabelId` / `returnTrackingNumber` / `returnLabelCost` / `returnReason` (retour), `sellerDebt` (dette vendeur après remboursement non couvert), `sellerCreditedCents` (montant à reprendre au vendeur).

---

### 11.9 Spécificités iOS / Android et limites connues

- **Panneaux de motif (bottom sheets)** : montés uniquement à l'ouverture pour éviter, sous **Android**, un voile transparent qui bloquerait défilement et clics. Comportement identique et fiable sur les deux plateformes.
- **Notifications push** : les notifications de remboursement, de retour demandé/reçu et de libération de fonds sont envoyées en « best-effort » (un échec d'envoi ne bloque jamais le mouvement d'argent, qui fait foi). La **source de vérité reste l'état de la commande** affiché dans l'app : même sans push, l'écran de suivi reflète le bon statut au prochain rafraîchissement.
- **Téléchargement de l'étiquette de retour** : ouverture du lien transporteur via le navigateur/visionneuse système ; comportement standard iOS/Android.
- **Aucun passage par un site externe** : conformément au modèle white-label Stripe Connect Custom, l'acheteur comme le vendeur vivent tout le parcours recours/remboursement **dans l'app** — jamais sur un tableau de bord Stripe.
