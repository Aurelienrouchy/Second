## 11. Recours, litiges, remboursements & annulations

Cette section décrit tout ce que l'application Second met à disposition de l'acheteur, du vendeur et de l'équipe support lorsqu'une transaction se passe mal : colis perdu, article non conforme, problème après livraison, vendeur qui ne peut plus livrer, rencontre manquée, paiement abandonné, contestation bancaire. Elle couvre la protection acheteur, les remboursements Stripe, la fenêtre de protection de 7 jours, l'annulation des transactions en attente, les décisions automatisées (Loi 25) et les mécanismes invisibles (re-jeux, réconciliation) qui garantissent qu'aucun mouvement d'argent ne « disparaît ».

> **⚠️ État réel du produit au moment de la rédaction.** Les deux rails financiers sont **coupés par un drapeau** : `SHIPPING_ENABLED = false` et `PAYMENTS_ENABLED = false` (`config/featureFlags.ts` côté app, `functions/src/config/featureFlags.ts` côté serveur). Aucune commande expédiée ni payée en ligne ne peut donc naître aujourd'hui : **le seul parcours d'achat actif est la remise en main propre (meetup), sans argent plateforme**. Par conséquent, **le seul recours réellement utilisable aujourd'hui est le signalement de rencontre manquée (§11.6)** — les trois recours acheteur décrits en §11.1 ne peuvent s'appliquer qu'à des commandes expédiées, qui n'existent pas encore. Tout le reste de ce chapitre est du code **écrit, testé et déployé mais dormant**, qui s'activera le jour où le fondateur remettra les drapeaux à `true`. Le drapeau serveur ne bloque d'ailleurs que la **création** de commandes expédiées (`functions/src/callable/payments/checkout.ts`) : les fonctions de recours elles-mêmes ne sont pas gardées par le drapeau, elles sont simplement sans objet tant qu'aucune commande expédiée n'existe.

### 11.0 Principe directeur : anti-fraude, jamais sur parole

La règle non négociable de toute la protection acheteur est : **Second ne rembourse jamais sur la seule parole de l'acheteur.** Un remboursement automatique n'est déclenché que par un **signal objectif du transporteur** :

- soit le transporteur confirme que la livraison a **échoué** ;
- soit, pour un retour, le transporteur confirme que le colis retourné a bien été **réceptionné par le vendeur**.

Tout ce qui ne tombe pas dans ces cas (« je l'ai reçu mais il y a un problème ») ne donne **aucun mouvement d'argent automatique** : cela ouvre une **réclamation** qui gèle les fonds et passe en revue humaine (équipe support / admin). C'est ce qui distingue les trois recours acheteur ci-dessous.

**Précision sur les statuts d'échec** : le code prévoit deux statuts d'échec transporteur, `delivery_failed` (échec de livraison) et `lost` (colis perdu). **Seul `delivery_failed` est réellement écrit** par le suivi transporteur (`functions/src/utils/trackingTransition.ts`) ; `lost` est un statut **réservé**, sans aucun écrivain dans le code d'aujourd'hui. Concrètement, un colis perdu arrive dans le parcours sous l'étiquette « échec de livraison ». Les écrans et les règles acceptent les deux, ce qui rendra `lost` opérationnel sans retoucher au code le jour où on branchera une correspondance transporteur dédiée.

L'argent en jeu est exclusivement en **dollars canadiens (CAD)** ; tous les remboursements carte transitent par Stripe, la part éventuellement payée avec le porte-monnaie interne (wallet) est re-créditée dans le wallet.

---

### 11.1 Les trois recours de l'acheteur (rail expédition)

L'acheteur déclenche ses recours depuis le bloc de suivi d'expédition affiché **dans la conversation liée à la commande** (`features/orders/components/ShipmentTracking.tsx`, rendu par `app/chat/[id].tsx` ; l'écran « Mes commandes » y renvoie). Selon l'état de la commande, des boutons différents apparaissent. Trois actions distinctes sont possibles, chacune adossée à une fonction serveur dédiée (`functions/src/callable/recourse.ts`).

| Recours | Condition serveur réelle | Ce qui se passe | Argent ? |
|---|---|---|---|
| **Remboursement automatique** | Commande en échec de livraison (`delivery_failed`, ou `lost` réservé) | Remboursement immédiat, article non remis en vente | Oui, automatique |
| **Signaler un problème** | Commande **livrée uniquement**, et **dans les 7 jours** | Gèle les fonds, ouvre une réclamation pour revue humaine | Non (décision admin ensuite) |
| **Demander un retour** | Commande **livrée**, **mode expédition**, **dans les 7 jours** | Achète une étiquette de retour, gèle les fonds | Remboursement plus tard, à réception du retour |

#### A. Remboursement automatique (livraison échouée / colis perdu)

- **Condition d'accès** : la commande doit être au statut `delivery_failed` (ou `lost`) — c'est-à-dire que le transporteur lui-même a signalé l'échec. Si l'acheteur tente ce recours sur une commande simplement livrée avec un souci, la demande est **refusée** avec un message qui le réoriente vers « Signaler un problème » (l'écran propose alors directement le bouton de bascule).
- **Réservé à l'acheteur** de la commande. Limité à 5 tentatives par minute.
- **Effet** : la commande passe en `refund_in_progress` puis `refunded`. La part carte est remboursée via Stripe, la part wallet est re-créditée à l'acheteur, le vendeur est débité de ce qui lui avait été crédité (voir §11.5).
- **Important** : l'article **n'est PAS remis en vente** — le colis étant perdu, l'objet a disparu physiquement.
- **Notifications** : acheteur et vendeur sont prévenus (« Remboursement effectué » / « Commande remboursée »).
- **Sécurité** : l'opération est **idempotente** (si déjà remboursée ou déjà en cours, elle ne fait rien) ; si le remboursement Stripe échoue, le statut est remis dans son état initial pour que l'acheteur puisse réessayer, et l'opération est mise en file de re-jeu (voir §11.8).

#### B. Signaler un problème (livré mais litige)

- **Condition d'accès réelle : uniquement le statut `delivered`, et uniquement tant que la fenêtre de 7 jours n'est pas écoulée** (les fonds ne doivent pas encore avoir été libérés au vendeur). Passé ce délai, la demande est refusée avec le message « La fenêtre de réclamation de 7 jours est écoulée pour cette commande. Contactez le support. » La raison est financière : une réclamation gèle des fonds qui, une fois libérés, ont pu être retirés — les regeler demanderait une reprise sur le solde retirable, qui n'est pas implémentée.
- **⚠️ Incohérence connue entre l'écran et le serveur** : le bouton « Signaler un problème » est affiché **aussi** pour une commande `shipped` (en transit) et dans l'encart d'échec de livraison. Or le serveur n'accepte que `delivered` : un acheteur qui appuie sur ce bouton depuis un de ces états reçoit un refus (« Cette commande ne peut pas faire l'objet d'une réclamation (statut …) »). À corriger avant l'ouverture du rail expédition — soit en masquant le bouton, soit en élargissant les statuts acceptés côté serveur.
- **Réservé à l'acheteur**. Limité à 5 tentatives par minute.
- **Motifs proposés** (l'acheteur choisit dans une liste) : colis non reçu malgré le scan « livré » ; article non conforme à l'annonce ; article endommagé ; autre. Un champ texte libre optionnel (« Décrivez le problème », 1 000 caractères max) complète le motif.
- **Effet** : **aucun mouvement d'argent.** La commande passe en `disputed`, les fonds sont **gelés**, l'état précédent est mémorisé, le rapport de l'acheteur est enregistré, et une **fiche de litige** (collection `disputes`) est ouverte pour revue par l'équipe.
- **Une seule réclamation à la fois** : signaler à nouveau une commande déjà en litige est refusé. Une commande déjà remboursée ou en cours de remboursement ne peut pas être signalée.
- **Résolution** : la suite est une **décision humaine** prise par un admin, dans un sens ou dans l'autre (voir §11.4) — cette fonction ne tranche jamais elle-même.
- **Trou produit** : **le vendeur n'est pas notifié** qu'une réclamation a été ouverte contre lui (seul un journal serveur `ADMIN_REVIEW` est écrit). Il découvre le gel de ses fonds sans explication. Le no-show meetup, lui, notifie bien la partie mise en cause (§11.6).

#### C. Demander un retour (article non conforme, je le renvoie)

- **Conditions d'accès cumulatives** :
  - statut `delivered` (livraison confirmée par le transporteur) ;
  - **mode expédition** uniquement — un retour par étiquette n'a pas de sens pour une remise en main propre ;
  - **dans la fenêtre de 7 jours** : les fonds ne doivent pas encore avoir été libérés au vendeur, et l'échéance de libération doit être dans le futur.
- **Motifs proposés à l'écran** : article non conforme à l'annonce, article endommagé, mauvais article reçu, **changement d'avis**. (Le quatrième motif est enregistré côté serveur sous le code générique « autre ».)
- **Effet immédiat** : l'application **achète une étiquette de retour** (via ShipEngine) — origine = adresse de livraison de l'acheteur, destination = adresse d'expédition du vendeur. La commande passe en `return_requested`, les fonds sont **gelés**. **Aucun remboursement à ce stade.** Le vendeur est notifié (« Retour demandé… le remboursement sera traité à sa réception »).
- **Frais de retour à la charge de l'acheteur** : c'est explicitement annoncé dans l'écran (encart d'avertissement). Le remboursement final sera **le total payé moins le coût de l'étiquette de retour**.
- **Déclenchement du remboursement** : il n'arrive **que lorsque le transporteur confirme que le colis retourné est livré au vendeur** (signal capté à la fois par le webhook ShipEngine et par le sondage horaire du suivi). À ce moment :
  - l'acheteur est remboursé de `total − coût étiquette retour` (imputé d'abord sur la carte, le reste sur le wallet) ;
  - le vendeur est débité de ce qui lui avait été crédité ;
  - l'article **n'est pas remis en vente automatiquement** (le vendeur a récupéré l'objet, il décide manuellement de le re-proposer) ;
  - acheteur et vendeur sont notifiés.
- **Garde-fous techniques** : la demande est **réservée** de façon atomique avant l'achat de l'étiquette (une étiquette est payante et non idempotente chez ShipEngine), donc deux demandes simultanées n'en achètent jamais deux ; si l'étiquette est achetée mais que l'enregistrement échoue, elle est journalisée pour nettoyage manuel ; limité à 3 demandes par minute.
- **Côté acheteur** : tant que le retour est en cours, l'écran affiche le numéro de suivi du retour et un bouton « Voir l'étiquette de retour » (ouverture du lien transporteur).
- **Retour qui ne repart jamais** : si le colis de retour n'est jamais scanné « livré » **au bout de 21 jours**, un job ouvre automatiquement une fiche de litige « retour non livré » pour revue humaine. Aucun remboursement ni libération automatique n'est fait — l'acheteur a pu ne jamais poster le colis, ou le scan a pu manquer ; seul un humain tranche. Sans ce filet, les fonds resteraient gelés indéfiniment.

---

### 11.2 La sélection du motif (panneau commun de réclamation)

Trois flux partagent un même **panneau de sélection de motif** (bottom sheet, `features/orders/components/RecourseReasonSheet.tsx`) : « Signaler un problème », « Demander un retour » et « Contester cette décision » (Loi 25, §11.3). Le panneau propose :
- un titre et une introduction fournis par le contexte ;
- une liste de motifs en français (boutons radio) ;
- un champ texte libre « Décrivez le problème » pour le signalement et pour la contestation ;
- pour « Demander un retour », un encart d'avertissement rappelant que **les frais de retour sont à la charge de l'acheteur** ;
- un bouton de validation, désactivé tant qu'aucun motif n'est choisi, qui affiche un indicateur de chargement pendant l'envoi.

Spécificité technique multi-plateforme : ce panneau monte son contenu **uniquement à l'ouverture** (et non en permanence). C'est une contrainte produit connue sous Android : un panneau monté en permanence pose un « voile » transparent qui bloque le défilement et les clics. Le comportement est donc identique et fiable sur iOS et Android.

---

### 11.3 La fenêtre de protection de 7 jours (séquestre / fonds gelés)

Le cœur de la protection acheteur repose sur un modèle de **séquestre à trois poches** sur le porte-monnaie du vendeur :

| Poche | Signification |
|---|---|
| `pendingBalance` | Vente payée, **pas encore livrée** (en transit) |
| `heldBalance` | **Livré**, dans la fenêtre de litige de 7 jours |
| `balance` | **Disponible au retrait** (fenêtre écoulée, aucun litige) |

Cycle de vie des fonds d'un achat :
1. **Paiement confirmé** → le gain du vendeur entre en `pendingBalance` (en attente).
2. **Livraison confirmée** (scan transporteur) → les fonds passent de `pendingBalance` à `heldBalance`, et la commande reçoit une **échéance de libération = date de livraison + 7 jours**.
3. **7 jours plus tard, sans litige** → un job automatique (toutes les heures, `functions/src/scheduled/releaseHeldFunds.ts`) déplace les fonds de `heldBalance` vers `balance` (retirables), et la commande passe en `completed`.

**Blocage en cas de litige** : le job ne regarde que les commandes au statut `delivered` et refuse de libérer toute commande marquée `disputed = true` ou dont le statut est `disputed`, `delivery_failed`, `lost` ou `refunded`. Un retour en cours (`return_requested`) est bloqué doublement : le statut n'est plus `delivered` et le drapeau de gel est posé. C'est ce gel qui rend les recours B et C « sans risque » : ils posent simplement le drapeau et l'argent cesse d'avancer vers le vendeur.

**Effet collatéral sur les retraits** : tant qu'un litige **financier** est ouvert sur une de ses ventes, le vendeur ne peut plus retirer **aucun** argent, même les sommes sans rapport avec le litige. Les litiges de **meetup** sont explicitement exclus de ce blocage (aucun argent n'ayant transité, un no-show ne doit pas pouvoir servir à geler un vendeur par malveillance). De même, un litige **financier** ouvert **bloque la suppression du compte** des deux parties tant qu'il n'est pas résolu — mais **un signalement de rencontre manquée n'y fait plus obstacle**, pas plus que la rencontre gelée qui l'accompagne : pour la même raison qui l'exclut déjà du blocage des retraits, ouvrir un tel litige coûtait un clic et suspendait indéfiniment le droit à l'effacement de sa cible.

**Conformité Loi 25 (Québec) — décisions automatisées** : la plateforme prend **trois** décisions sans intervention humaine (`functions/src/callable/automatedDecisions.ts`) :
- **libération des fonds** à J+7 ;
- **annulation automatique** d'une commande orpheline (meetup non confirmé, paiement jamais finalisé, etc.) ;
- **remboursement automatique** d'une commande payée dont l'étiquette d'expédition n'a jamais pu être créée (après 4 tentatives).

Chacune est **journalisée** (avec les critères qui l'ont déclenchée) dans un registre consultable par les deux parties, et la notification envoyée indique **explicitement** que la décision est automatique et **qu'elle peut être contestée**. Message type pour la libération : « Vos fonds ont été libérés automatiquement… Si vous contestez cette décision, vous pouvez nous le signaler. »

**Contestation d'une décision automatisée (Loi 25, art. 12.1)** : dans la conversation liée à la commande, un encart affiche la décision, un dépliant « Pourquoi cette décision ? » détaille les critères, et un bouton « Contester cette décision » ouvre une demande de **révision humaine**. L'utilisateur choisit un motif (« je ne suis pas d'accord », « les informations utilisées sont incorrectes », « circonstances particulières », « autre ») et ajoute un texte libre ; un accusé confirme : « Votre contestation a été transmise. Notre équipe procédera à une révision humaine de cette décision et reviendra vers vous. » La contestation **ne renverse rien automatiquement** : elle crée un dossier et alerte l'équipe ; un humain décide hors ligne. Ce chemin est volontairement rendu accessible **aussi pour les transactions en main propre (meetup)** — dans ce cas, l'encart de contestation est la **seule** chose affichée (pas de suivi colis, qui n'aurait aucun sens).

---

### 11.4 Résolution d'un litige par l'admin (les deux issues)

Un litige n'a **aucune sortie automatique** : seul un administrateur le tranche, depuis l'écran `app/admin/disputes.tsx`, dans un sens ou dans l'autre. Les deux fonctions sont réservées aux administrateurs (jeton `admin` **ou** champ `isAdmin` sur le profil) et aucune écriture cliente n'est autorisée sur les fiches de litige.

| Issue | Fonction | Effet |
|---|---|---|
| **En faveur de l'acheteur** | Remboursement admin | Remboursement complet (carte + wallet) via le moteur partagé, débit du vendeur, **remise en vente de l'article** par défaut, et **clôture automatique des fiches de litige liées**. Sur un litige de **rencontre manquée**, l'écran d'admin ne promet plus ce que le serveur ne fait pas : le bouton s'intitule « Clôturer (acheteur) » et la confirmation précise qu'**aucun argent n'a transité**, donc qu'il n'y a rien à rembourser. La fonction appelée est la même, mais elle ne déplace rien : le dossier est simplement tranché, l'article étant déjà remis en vente depuis le signalement |
| **En faveur du vendeur** | Résolution sans remboursement | Aucun argent ne bouge ; le statut d'avant-litige est restauré (le cycle de libération reprend), le drapeau de gel est levé, un éventuel gel lié à une contestation bancaire est rendu au solde retirable, la fiche est clôturée « rejetée », le vendeur est notifié. Sur une **rencontre**, le marqueur `offer.meetup.noShow` posé par le signalement est effacé dans la même transaction : la bulle de rendez-vous se rallume et la rencontre redevient finalisable |

- **Statuts remboursables par l'admin** : `paid`, `label_created`, `shipped`, `delivered`, `delivery_failed`, `lost`, `disputed`, `return_requested`. Toute autre valeur est refusée.
- **Idempotence** : une commande déjà remboursée renvoie « déjà remboursé » sans rien refaire.
- **Résolution en faveur du vendeur** : possible uniquement depuis `disputed` ou `return_requested`.
- **Cas 100 % porte-monnaie** : une commande payée intégralement avec le wallet n'a pas de paiement Stripe, donc pas de webhook de remboursement possible. Elle se rembourse par une fonction admin dédiée (`refundWalletPayment`), **réservée aux administrateurs** — un acheteur ne doit jamais pouvoir se rembourser lui-même après livraison tout en gardant l'article.
- **Filet de visibilité** : un job passe **toutes les 6 heures** et lève une alerte d'exploitation pour **toute réclamation ouverte depuis plus de 5 jours** (transactions comme swaps), une seule fois par dossier. C'est le garde-fou contre le litige oublié qui gèlerait des fonds indéfiniment.
- **⚠️ Trou produit** : l'écran d'admin est la **seule** vue sur les litiges. Aucun écran ne permet à l'acheteur ni au vendeur de **suivre** leur réclamation dans l'app (statut, décision, motif). Techniquement les deux parties ont le droit de lire leur fiche, mais aucune interface ne l'expose. De plus, le texte affiché à l'acheteur au moment du signalement promet un examen « sous 48 h » alors qu'**aucun délai de traitement n'est implémenté** : le seul mécanisme réel est l'alerte à 5 jours ci-dessus. À aligner (soit tenir le 48 h en interne, soit changer le texte).

---

### 11.5 Mécanique du remboursement (carte + wallet + dette vendeur)

Tous les remboursements de l'app passent par un **moteur unique** (`functions/src/utils/refund.ts`), garant de la cohérence, quel que soit le déclencheur (échec de livraison, retour réceptionné, étiquette impossible, annulation vendeur, décision admin). Sa logique métier :

1. **Part carte** remboursée via Stripe, en **dehors** de toute transaction base de données, avec une **clé d'idempotence déterministe** propre à chaque remboursement logique pour qu'un re-jeu ne rembourse jamais deux fois.
   - **Modèle « rail unique »** : tous les encaissements sont des **charges plateforme directes**. Il n'y a donc **ni transfert à inverser, ni commission plateforme à récupérer** — c'est un remboursement Stripe simple. Le vendeur, lui, n'a jamais été crédité sur un compte Stripe : il l'a été dans son porte-monnaie interne, et c'est là qu'on le reprend (étape 2). *(Correction : les versions précédentes de ce document décrivaient des « charges destination » avec inversion de transfert et restitution de commission — ce mécanisme n'existe plus dans le code.)*
   - **Sécurité ajoutée** : si un remboursement carte est dû mais que la connexion Stripe est indisponible, **rien n'est modifié** — l'opération est mise en file de re-jeu et une erreur est remontée. On ne marque jamais une commande « remboursée » sans que l'argent soit réellement parti.
2. **Réconciliation comptable atomique** :
   - re-crédit de la part **wallet** à l'acheteur (avec écriture au registre) — si le porte-monnaie de l'acheteur a disparu entre-temps, il est **recréé** avec le montant dû plutôt que de perdre le crédit ;
   - **débit du vendeur exactement de ce qui lui avait été crédité**, prélevé dans l'ordre `pendingBalance` → `heldBalance` → `balance` ;
   - si le vendeur n'a plus assez de fonds (déjà retirés), le manque est enregistré comme **dette vendeur** (`sellerDebt`) à récupérer plus tard — une dette bloque ses retraits et la suppression de son compte ;
   - remise en vente de l'article **seulement si demandé** (oui pour l'admin et l'annulation vendeur, non pour l'échec de livraison et le retour).

**Remboursements partiels** : pour un retour, le moteur rembourse un montant carte précis (`total − coût du retour`), plafonné à la part carte réellement débitée, le reste venant du wallet. Si le coût du retour dépasse la part carte, aucun appel Stripe n'est fait et tout se règle sur le wallet.

**Qui paie quoi** : le vendeur est débité **du prix de l'article** (sa part), l'acheteur récupère **la totalité de ce qu'il a payé** — prix + frais de service inclus. Sur un remboursement plein, **la plateforme perd donc ses frais de service** ; sur un retour, l'acheteur les récupère aussi mais paie l'étiquette de retour, et la plateforme reste à l'équilibre.

**⚠️ Écart entre l'intention et le code** : le moteur sait débiter le vendeur d'un **supplément** (typiquement le coût de l'étiquette de retour quand le litige est tranché contre lui), et les commentaires du code décrivent une option « frais de retour à la charge du vendeur ». **Aucune fonction ne l'utilise aujourd'hui** : le coût du retour est **toujours** supporté par l'acheteur, même lorsque l'admin donne raison à l'acheteur. Si l'objectif métier est de faire payer un vendeur fautif, il reste à câbler.

**Spécificités Canada** : montants en CAD ; la commission vendeur est de **0 %** (les frais sont acheteur : `max(2,00 $ ; prix × 5 % + 1,50 $)`, monétisation via les forfaits boutique), donc un remboursement restitue le prix de l'article + les frais acheteur.

---

### 11.6 Recours du vendeur, meetup et contestation bancaire

Le document ne couvrait que l'acheteur. Trois autres chemins existent dans le code.

#### Le vendeur annule une commande payée avant expédition

Un vendeur qui ne peut plus livrer (article cassé, perdu, déjà vendu ailleurs) peut **annuler et rembourser immédiatement**, au lieu de laisser l'acheteur attendre l'expiration à 7 jours.
- **Réservé au vendeur** de la commande, limité à 10 appels par minute.
- **Statuts autorisés : `paid` et `label_created` uniquement** — c'est-à-dire avant le premier scan transporteur. Une fois le colis en transit, l'annulation est refusée (« Une commande déjà expédiée relève d'un retour »).
- **Effet** : remboursement intégral de l'acheteur (carte + wallet), débit du vendeur, **article remis en vente**, acheteur notifié « Le vendeur a annulé… Vous avez été intégralement remboursé(e). »

#### Rencontre manquée (meetup) — le seul recours actif aujourd'hui

Un meetup est un échange **en argent comptant** : aucun argent ne transite par la plateforme, il n'y a donc rien à rembourser. Le recours consiste à **débloquer la situation et ouvrir un dossier**.
- **Qui** : l'acheteur **ou** le vendeur, depuis la bulle de rendez-vous dans la conversation (bouton « Signaler une absence »). Limité à 5 signalements par minute.
- **Quand** : seulement tant que la rencontre est ouverte (`meetup_pending` ou `meetup_confirmed`), et uniquement pour une transaction en main propre.
- **Effet** : la transaction passe en `disputed` (elle ne peut plus être complétée et ne bloque plus l'article), **l'article est immédiatement remis en vente**, une fiche de litige « rencontre manquée » est ouverte, et **la personne mise en cause est notifiée** avec la mention qu'elle peut contester. Un message système est aussi posté dans la conversation.
- **Aucun mouvement d'argent**, et — point important — ce type de litige **ne gèle pas** les retraits du vendeur (voir §11.3) : ni le dossier, ni la transaction gelée qui l'accompagne, **ne bloquent la suppression de compte** de l'une ou l'autre partie.
- **Contre-déclaration** : la partie **visée** par le signalement peut répondre, **une seule fois**, via un bouton « Donner ma version » qui n'apparaît que pour elle dans la bulle de rendez-vous. Elle ne change ni le statut, ni le verrou de l'article, ni l'état du dossier : elle est enregistrée sur la transaction (`counterReport`), reportée sur le dossier ouvert (`counterReportedBy`, `counterReason`, `counterDetails`), et le premier signaleur reçoit une notification « Signalement contesté ». **L'utilisateur ne rédige rien** : l'app envoie un texte figé (« Je conteste ce signalement : je me suis présenté au rendez-vous. ») sous le même motif générique. Le bouton reste par ailleurs affiché après coup — un second appui renvoie le refus serveur « Vous avez déjà donné votre version pour ce signalement. »
- **Résolution** : uniquement par un admin (§11.4), qui dispose alors des deux récits.
- **Limite d'écran** : l'utilisateur ne choisit pas de motif — l'app envoie systématiquement « l'autre partie ne s'est pas présentée ». Le serveur accepte pourtant quatre motifs (dont « annulation de dernière minute » et « situation non sécuritaire »), non exposés dans l'interface.

#### Contestation bancaire (chargeback Stripe)

Quand un acheteur conteste le paiement auprès de **sa banque** plutôt que via l'app, Stripe nous prévient et le code réagit seul (`functions/src/http/stripe/disputes.ts`) :
- **À l'ouverture** : la commande passe en `disputed`, les fonds sont gelés. Si le gain du vendeur était déjà **retirable**, il est **ramené** du solde disponible vers le solde gelé (jamais en négatif), et le montant exact ainsi gelé est mémorisé.
- **Contestation gagnée** : le montant gelé est rendu au solde retirable, le statut d'avant-litige est restauré, le cycle normal reprend.
- **Contestation perdue** : Stripe a déjà repris l'argent à la plateforme. Le vendeur est débité (cascade `pendingBalance` → `heldBalance` → `balance`, le manque devenant une **dette vendeur**), tout excédent gelé lui est rendu, et — point essentiel — **la part payée avec le porte-monnaie est re-créditée à l'acheteur par la plateforme** (la banque ne rembourse que la carte). La commande est marquée `refunded`.
- **Autre issue** (avertissement clos sans suite) : traité comme une contestation gagnée.
- **Ce recours n'a aucune interface** : il est entièrement piloté par les webhooks. Ni l'acheteur ni le vendeur ne voient dans l'app qu'une contestation bancaire est en cours — ils constatent seulement le statut « en litige ».

---

### 11.7 Annulation d'une transaction en attente

Deux chemins d'annulation existent, selon que la commande a été payée ou non.

#### Annulation par l'utilisateur (commande non avancée)

- **Qui** : l'acheteur **ou** le vendeur de la commande. Limité à 20 appels par minute.
- **Statuts annulables** : `pending_payment`, `meetup_pending`, `meetup_confirmed` (ainsi qu'un ancien statut `pending` conservé pour compatibilité). Au-delà (payée, expédiée, livrée), l'annulation directe est refusée — il faut passer par les recours, l'annulation vendeur (§11.6) ou un remboursement.
- **Garde-fou « paiement en vol »** : si un paiement carte est rattaché à la commande, le système interroge Stripe **avant** d'annuler. Si le paiement est en cours ou déjà encaissé, l'annulation est **refusée** (« Le paiement est en cours de traitement et ne peut plus être annulé ») ; sinon le paiement est explicitement annulé chez Stripe **avant** toute écriture, pour qu'un encaissement tardif ne puisse pas re-créditer le wallet une seconde fois.
- **Effet** : la commande passe en `cancelled`, l'**article est remis en vente**, et si une part wallet avait été engagée, elle est **re-créditée** à l'acheteur (écriture au registre « transaction annulée »).

#### Expiration automatique (transactions « orphelines »)

Un job horaire (`functions/src/scheduled/transactionExpiration.ts`) nettoie les transactions jamais finalisées :

| Cas | Délai | Effet |
|---|---|---|
| Meetup en attente (vendeur n'a jamais confirmé) | 48 h | Annulée, article remis en vente, acheteur notifié. **Aucun argent** (meetup = comptant) |
| Meetup confirmé jamais finalisé (zombie) | 7 jours | Annulée, article remis en vente. Aucun argent |
| Paiement en attente (acheteur n'a jamais payé) | 1 h | Annulée, article remis en vente (voir garde-fou ci-dessous) |
| Payée mais jamais expédiée (vendeur ne livre pas) | 7 jours | **Remboursement** de l'acheteur (carte + wallet) + acheteur notifié |
| Retour demandé jamais livré au vendeur | 21 jours | **Ni remboursement ni libération** : ouverture d'une fiche de litige pour revue humaine |

Les annulations et le remboursement « payée non expédiée » sont des **décisions automatisées** au sens de la Loi 25 : elles sont journalisées avec leurs critères et la notification envoyée précise qu'elles peuvent être contestées (§11.3).

**Garde-fou « paiement en vol »** : avant d'expirer une commande en attente de paiement, le système vérifie l'état réel du paiement chez Stripe. Si un paiement est en cours, capturé ou déjà réussi, la commande **n'est pas annulée** — sinon on risquerait d'annuler une commande dont la carte vient d'être débitée. On laisse le webhook (ou la réconciliation) finir le travail. Sinon, le paiement est annulé chez Stripe avant l'expiration.

**Reprise des remboursements interrompus** : le même job rattrape les commandes coincées en `refund_in_progress` (remboursement qui aurait planté en cours de route) et les finalise sans double-remboursement, en réutilisant la même clé d'idempotence.

#### Annulation côté swap (échange)

Pour les **swaps** (échanges entre articles), des jobs horaires dédiés annulent les propositions restées trop longtemps en attente :
- **7 jours** pour un swap simplement `proposed` (jamais répondu) ou en `payment_pending` (la part monétaire d'appoint n'a jamais été payée) : passage en `cancelled`, articles débloqués. **Aucun remboursement n'est nécessaire car rien n'a jamais été encaissé.**
- Pour un swap **déjà accepté et payé** qui n'avance plus, l'appoint payé est **remboursé** (clé d'idempotence par swap) et les articles sont débloqués.
- Un swap en litige (`disputed`) suit le même principe que les transactions : **aucune sortie automatique**, résolution par une fonction admin dédiée, et la même alerte d'exploitation à 5 jours.

---

### 11.8 Filet de sécurité financier : re-jeu (dead-letter) et réconciliation

Comme tout repose sur Stripe et sur des webhooks, l'app intègre deux mécanismes invisibles pour qu'**aucune opération d'argent ne se perde silencieusement**.

#### Re-jeu des opérations échouées (dead-letter)

Chaque fois qu'une opération financière échoue, elle est **enregistrée dans une file** (`failed_operations`) plutôt que perdue. Un job tourne **toutes les 30 minutes** et re-tente ces opérations :
- Chaque re-jeu réutilise **la même clé d'idempotence** que l'appel d'origine : re-jouer une opération qui avait en fait réussi est sans danger (Stripe renvoie le résultat d'origine, sans double effet).
- **Backoff exponentiel** : première nouvelle tentative immédiate, puis 30 min → 1 h → 2 h → 4 h → 8 h.
- Après **6 tentatives** infructueuses, l'opération est marquée « épuisée » et **escaladée à un humain** (alerte critique). On ne tente jamais d'action destructrice à l'aveugle : un type d'opération inconnu ou un écart non auto-réparable est laissé visible pour traitement manuel.
- **Types couverts** : remboursement Stripe échoué (le cas de loin le plus fréquent, avec deux anciens alias conservés pour les dossiers historiques), inversion de transfert, annulation de virement vendeur, et **écart de montant** — ce dernier couvrant notamment le re-jeu d'une **confirmation de paiement perdue** (le webhook n'est jamais arrivé alors que l'acheteur a bien payé) et, le cas échéant, un remboursement automatique pour « rendre l'acheteur entier ».

#### Réconciliation périodique (détection d'écarts)

Un job tourne **toutes les 6 heures**, en **détection seule** (il ne modifie jamais l'argent de sa propre initiative — auto-« réparer » un écart mal compris risquerait d'aggraver la perte). Trois passes :
1. **Paiements** : repère une commande restée en attente de paiement alors que le paiement Stripe a en réalité réussi (webhook perdu) → alerte critique + mise en file pour re-jeu automatique.
2. **Retraits vendeur** : repère un retrait coincé « en traitement » alors que le virement Stripe est en réalité payé (→ marqué complété), échoué ou annulé (→ mis en file pour re-créditer le vendeur).
3. **Soldes (porte-monnaies)** : parcourt **tous** les porte-monnaies et vérifie des invariants — aucune poche ne doit être négative (`balance`, `pendingBalance`, `heldBalance`, `sellerDebt`). Toute violation est un bug structurel signalé en critique.

Une garantie supplémentaire côté Stripe : un remboursement **partiel** reçu de l'extérieur (geste commercial fait depuis le tableau de bord Stripe, ou remboursement de retour déjà réconcilié en interne) ne défait **jamais** toute la vente ; il est mis de côté pour revue humaine. Et si un remboursement Stripe **échoue après coup** (carte d'origine devenue incréditable), une **alerte critique** est levée : notre état interne dit « remboursé » alors que l'acheteur n'a rien reçu — il faut un canal de remboursement alternatif, décidé par un humain.

Les webhooks restent le chemin principal (cas nominal) ; ces deux jobs sont le filet en cas de webhook perdu ou d'incident réseau.

---

### 11.9 États (statuts) d'une transaction liés aux recours

Récapitulatif des statuts qui interviennent dans cette section (liste complète dans `types/transaction.ts`) :

| Statut | Signification métier |
|---|---|
| `pending_payment` | En attente de paiement (annulable par acheteur/vendeur ; expire à 1 h) |
| `meetup_pending` / `meetup_confirmed` | Remise en main propre, en attente / confirmée (annulable ; expire à 48 h / 7 j ; no-show signalable) |
| `meetup_completed` | Rencontre finalisée (terminal) |
| `paid` / `label_created` | Payée, avant premier scan transporteur (annulable par le **vendeur** ; expire à 7 j → remboursement) |
| `shipped` | En transit |
| `delivered` | Livrée — **seul statut où « Signaler un problème » et « Demander un retour » sont acceptés**, pendant 7 jours |
| `completed` | Clôturée après la fenêtre de 7 jours (terminal) |
| `delivery_failed` / `lost` | Échec de livraison / colis perdu — remboursement automatique possible (`lost` sans écrivain aujourd'hui) |
| `disputed` | Réclamation ouverte, fonds gelés, revue humaine obligatoire |
| `return_requested` | Retour en cours (étiquette achetée, fonds gelés ; escalade à 21 j si jamais livré) |
| `refund_in_progress` | Remboursement en cours (repris automatiquement si interrompu) |
| `refunded` | Remboursée (terminal) |
| `cancelled` | Annulée (terminal) |

Champs clés associés : `disputed` (drapeau de gel), `statusBeforeDispute` (état avant litige, pour restauration), `fundsReleaseAt` / `fundsReleasedAt` (échéance / horodatage de libération à J+7), `buyerReport` (motif + détail de la réclamation), `noShowReport` (signalement de rencontre manquée), `returnLabelId` / `returnTrackingNumber` / `returnLabelCost` / `returnReason` / `returnEscalatedAt` (retour), `disputeFreezeCents` (montant gelé lors d'une contestation bancaire), `sellerDebt` (dette vendeur après remboursement non couvert), `sellerCreditedCents` (montant exact à reprendre au vendeur).

---

### 11.10 Trous connus et points à trancher

Résumé des écarts entre ce que le métier voudrait et ce que le code fait aujourd'hui — tous constatés dans le code, aucun supposé.

| Sujet | Situation réelle |
|---|---|
| **Rails coupés** | Expédition et paiements sont désactivés par drapeau : tout le chapitre, sauf le no-show meetup et la contestation Loi 25, est dormant |
| **Bouton « Signaler un problème »** | Affiché sur `shipped` et sur les échecs de livraison, mais refusé par le serveur (seul `delivered` est accepté) |
| **Vendeur non prévenu d'une réclamation** | Aucune notification n'est envoyée au vendeur quand l'acheteur ouvre une réclamation ; il subit un gel sans explication |
| **Suivi du litige côté utilisateur** | Aucun écran ne montre à l'acheteur ni au vendeur l'état de leur réclamation ; seule l'admin voit la liste |
| **Promesse « sous 48 h »** | Affichée à l'acheteur, mais aucun délai n'est implémenté ; le seul mécanisme est une alerte d'exploitation à **5 jours** |
| **Frais de retour à la charge du vendeur** | Prévu dans le moteur de remboursement, jamais câblé : l'acheteur paie toujours l'étiquette de retour, même quand l'admin lui donne raison |
| **Statut `lost`** | Accepté partout, écrit nulle part |
| **Motifs de no-show** | Quatre motifs côté serveur, un seul envoyé par l'app |
| **Contestation bancaire** | Entièrement automatisée mais totalement invisible dans l'app pour les deux parties |
| **Réclamation hors fenêtre** | Passé 7 jours, l'acheteur est renvoyé vers « le support » — aucun canal de support n'est proposé dans l'écran |

---

#### Décision en attente — sanctionner ou non les signalements d'absence abusifs

**Ce qui existe déjà.** Trois garde-fous ont été posés le 2026-09-06 : la partie visée peut **donner
sa version** (contre-déclaration jointe au dossier, §11.6), une **annulation à l'amiable** permet de
se désister sans accuser personne (§09.4), et un signalement d'absence **ne bloque plus la
suppression de compte** de la personne visée. Le signalement abusif ne fait donc plus de dégât
irréparable.

**Ce qui manque encore.** Rien ne **mesure** la récidive. Il n'existe aucun compteur de signalements
par utilisateur, aucun plafond, et la console d'administration liste les dossiers par date sans
agrégat par personne : un même compte peut signaler dix vendeurs différents sans qu'aucun écran ne
le montre.

**Trois questions à trancher avant d'écrire quoi que ce soit** — c'est de la détection, pas de la
correction, et une mesure mal calibrée punirait des victimes réelles :
1. **Quel seuil ?** Un signalement d'absence est un événement légitime et courant sur une place de
   marché entre particuliers. Combien, sur quelle fenêtre glissante, avant que ce soit anormal ?
2. **Quelle conséquence ?** Simple visibilité pour l'administrateur, blocage de la possibilité de
   signaler, ou sanction sur le compte ? Une mesure automatique sur un signal aussi bruité est
   risquée ; une simple remontée à l'humain est probablement le bon premier pas.
3. **Quelle visibilité ?** Le compteur doit-il apparaître sur le dossier de litige, sur la fiche de
   l'utilisateur dans la console, ou dans une file de revue distincte ?

**Impact si rien n'est fait** : le signalement abusif reste possible et invisible. Il ne coûte plus
grand-chose à la personne visée, mais il fait perdre sa vente au vendeur honnête et mobilise
l'administration. Priorité **basse tant que le volume est faible**, à rouvrir dès que la place de
marché passe l'échelle.

---

### 11.11 Spécificités iOS / Android et limites techniques

- **Panneaux de motif (bottom sheets)** : montés uniquement à l'ouverture pour éviter, sous **Android**, un voile transparent qui bloquerait défilement et clics. Comportement identique et fiable sur les deux plateformes.
- **Notifications push** : les notifications de remboursement, de retour demandé/reçu, de no-show et de libération de fonds sont envoyées en « meilleur effort » (un échec d'envoi ne bloque jamais le mouvement d'argent, qui fait foi). La **source de vérité reste l'état de la commande** affiché dans l'app : même sans push, l'écran de suivi reflète le bon statut au prochain rafraîchissement.
- **Téléchargement de l'étiquette de retour** : ouverture du lien transporteur via le navigateur/visionneuse système ; comportement standard iOS/Android.
- **Aucun passage par un site externe** : conformément au modèle white-label Stripe Connect Custom, l'acheteur comme le vendeur vivent tout le parcours recours/remboursement **dans l'app** — jamais sur un tableau de bord Stripe.
