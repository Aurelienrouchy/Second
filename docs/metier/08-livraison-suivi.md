## 08. Livraison & suivi de colis

Cette section décrit ce que l'application fait réellement, de l'achat d'un article jusqu'à la libération des fonds au vendeur, lorsque l'acheteur choisit la **livraison par transporteur** (par opposition à la remise en main propre / « meetup »). Le périmètre couvre la génération de l'étiquette d'expédition, le suivi du colis, la confirmation de livraison, la protection de l'acheteur (séquestre des fonds) et les rattrapages automatiques en cas d'échec.

Tout repose sur **ShipEngine**, un agrégateur multi-transporteurs que la plateforme pilote pour comparer les tarifs, acheter les étiquettes, suivre les colis et chercher des points relais. Côté transporteurs, le code est calibré pour le **Canada** : **Intelcom (Dragonfly)**, **Postes Canada** et **UPS Canada**. Tout est libellé en **dollars canadiens (CAD)** et limité aux adresses canadiennes (code postal canadien obligatoire, pays = CA).

---

### 8.1 Vue d'ensemble du parcours

Le cycle de vie d'une commande expédiée suit cette chaîne :

```
Achat (acheteur)
  └─ Estimation tarif livraison (ShipEngine)
  └─ Paiement (carte / porte-monnaie)
        └─ Achat de l'étiquette d'expédition (ShipEngine)
              └─ "Étiquette créée" (le vendeur doit déposer le colis)
                    └─ 1er scan transporteur → "Expédié"
                          └─ Scan "Livré" → fonds passés en séquestre (fenêtre 7 jours)
                                └─ 7 jours sans litige → fonds libérés au vendeur
```

Deux principes structurent toute la livraison :

1. **L'argent ne se débloque jamais sur la seule parole de quelqu'un.** Le vendeur n'est crédité qu'une fois l'étiquette réellement achetée ; les fonds ne deviennent retirables qu'après la livraison confirmée par le transporteur **et** l'écoulement d'une fenêtre de réclamation de **7 jours**.
2. **« Le scan livré fait foi. »** C'est l'événement transporteur (et non un bouton « j'ai bien reçu ») qui fait avancer la commande. Il n'existe **pas** de bouton « confirmer la réception » pour les commandes expédiées — c'est le suivi de colis qui pilote la machine à états.

---

### 8.2 Avant le paiement : estimation du tarif et adresse

Quand l'acheteur passe par l'écran de paiement en mode livraison (`app/checkout/shipping.tsx`), l'application :

- Demande une **estimation tarifaire** au backend (`getShippingEstimate`), qui interroge ShipEngine avec l'adresse de départ du vendeur, l'adresse de livraison de l'acheteur et les caractéristiques du colis (poids, dimensions, issus de la fiche article ; valeurs par défaut 0,5 kg et 30×25×10 cm si non renseignées).
- Affiche jusqu'à **5 tarifs**, triés du moins cher au plus cher, chacun avec : transporteur, type de service, délai estimé (ex. « 3 jours ouvrables ») et prix en CAD. Le tarif le moins cher est présélectionné.

**Règles de gestion clés :**

| Règle | Comportement |
|---|---|
| Adresses canadiennes valides obligatoires | L'estimation est **refusée** si l'adresse vendeur (rue + ville + code postal canadien) ou acheteur (ville + code postal canadien) est incomplète/invalide. Pas de repli silencieux sur une adresse fictive de Montréal. |
| Tarif de repli (« fallback ») | Si ShipEngine est injoignable, l'app affiche deux tarifs locaux de secours (Postes Canada Standard 8,50 $ / Express 14,50 $) **purement indicatifs**. Un tarif de repli **ne permet pas** d'acheter une vraie étiquette : le paiement par carte est alors bloqué et l'acheteur est invité à réessayer ou à proposer une remise en main propre. |
| Tarif jamais « de confiance » côté client | Le prix de livraison envoyé par l'application n'est **jamais** cru. Au moment de créer la commande, le serveur re-cote le même trajet via ShipEngine et utilise **son** prix comme tarif facturé. Si le tarif a expiré, l'acheteur doit rafraîchir l'estimation. |

**Points relais (PUDO) :** le backend expose une fonction de recherche de points de retrait (`findPickupPoints`, basée sur le code postal, rayon 10 km), et le modèle de tarif distingue livraison « à domicile » (`home`) vs « point relais » (`pickup_point`). En pratique, dans le parcours d'achat actuel, **toutes les estimations renvoyées sont marquées « domicile »** et l'écran de paiement ne propose pas de choix de point relais à l'acheteur : la capacité PUDO existe dans l'infrastructure mais n'est pas exposée dans le tunnel d'achat. À noter : un écran de **préférences vendeur** (`Réglages › Options de livraison`) permet au vendeur de cocher les modes qu'il accepte (Postes Canada bureau de poste, UPS Access Point, Penguin Pickup casier métro, remise en main propre) ; c'est une préférence de profil, distincte des tarifs réellement proposés à l'achat.

---

### 8.3 Création de la commande et conditions vendeur

À la création de la commande expédiée (`createTransaction`), avant tout débit, le serveur vérifie que **le vendeur peut être payé** :

- Le vendeur doit posséder un **compte de paiement Stripe Connect** actif (`stripeAccountId` présent **et** `stripeChargesEnabled = true`). Sinon la commande est refusée (« Le vendeur n'a pas encore configuré son compte de paiement »). Pas de création de compte à la volée.
- L'adresse d'expédition du vendeur doit être **réelle et exploitable** (résolue depuis son profil) — sinon refus, car aucune étiquette ne pourrait être achetée.
- Le `rateId` ShipEngine doit être présent et non « fallback ».

Si tout est valide, l'article est marqué vendu, et la commande est créée au statut `pending_payment` avec : montant article, frais de livraison (re-cotés serveur), frais de service plateforme, total, et l'adresse de livraison de l'acheteur.

**Qui paie la livraison ?** L'acheteur. Le total facturé = prix article + frais de livraison + frais de service. La plateforme achète l'étiquette pour le compte du vendeur, puis **rapproche** le coût réel de l'étiquette (facturé par ShipEngine) avec le tarif estimé facturé à l'acheteur (voir 8.5).

---

### 8.4 Achat de l'étiquette et statut « Étiquette créée »

L'étiquette est achetée **après l'encaissement du paiement**, dans le webhook de paiement Stripe (`payment_intent.succeeded`) ou lors d'un paiement par porte-monnaie. C'est une distinction métier importante : **on ne crée pas l'étiquette avant d'avoir l'argent.**

Lorsque l'étiquette est achetée avec succès (`createLabel`), une opération atomique unique :

- **crédite le vendeur** sur son solde « en attente » (`pendingBalance`) — c'est le modèle de **crédit différé** : le vendeur n'est crédité qu'à l'existence d'une vraie étiquette, jamais avant ;
- enregistre les informations de suivi : numéro de suivi, URL d'étiquette (PDF), URL de suivi public, code transporteur ;
- fait passer la commande au statut **`label_created`** (« Étiquette créée »), et **non** « Expédié ».

Cette distinction est centrale : une étiquette qui existe ne signifie pas que le colis est parti. Tant que le transporteur n'a pas scanné le colis, la commande reste « Étiquette créée ». Côté interface (`ShipmentTracking.tsx`), l'acheteur voit « L'étiquette est prête, le colis va être déposé chez le transporteur » et le vendeur peut **télécharger l'étiquette** (PDF 4×6) et **suivre en ligne**.

**Non-idempotence de l'achat d'étiquette :** ShipEngine ne supporte pas de clé d'idempotence ici. Un nouvel essai après un timeout pourrait acheter une **deuxième** étiquette payante. Par sécurité, l'achat d'étiquette ne fait donc **aucune tentative automatique** (`allowRetry = false`) ; les étiquettes « coincées » sont récupérées par un balayage dédié (voir 8.8).

---

### 8.5 Rapprochement du coût réel de livraison

À chaque étiquette achetée, le serveur compare le **coût réel** facturé par ShipEngine (transport + assurance éventuelle) au **tarif estimé** facturé à l'acheteur, et enregistre l'écart sur la commande (`actualShippingCost`, `shippingCostDelta`).

- Les **petits écarts** sont absorbés par les frais de protection acheteur.
- Un écart **supérieur à 2 $** est journalisé comme **anomalie critique** et inscrit dans un registre comptable plateforme (`platform_ledger`, type `shipping_cost_variance`) pour suivi manuel.

Cela protège la marge de la plateforme contre les manipulations de tarif côté client et les divergences réelles entre estimation et facturation transporteur.

---

### 8.6 Suivi du colis : machine à états et deux canaux

Le suivi avance la commande selon une **machine à états unique** (`applyTrackingOutcome`, partagée par tous les points d'entrée pour garantir un seul comportement) :

```
paid ──(étiquette achetée)──> label_created ──(1er scan transporteur)──> shipped
     └─ shipped ──(scan "livré")──> delivered  (fenêtre de séquestre 7 jours)
     └─ shipped / label_created ──(scan "échec/exception")──> delivery_failed  (fonds gelés)
```

**Correspondance des statuts transporteur** (codes ShipEngine → statut interne → affichage) :

| Statut interne | Affichage acheteur | Effet métier |
|---|---|---|
| `LABEL_CREATED` | Étiquette créée | En attente du dépôt chez le transporteur |
| `TRANSIT` / `IN_TRANSIT` | En transit | 1er scan → passe à « Expédié » |
| `OUT_FOR_DELIVERY` | En cours de livraison | Affichage seulement |
| `DELIVERED` | Livré | Déclenche le séquestre 7 jours |
| `FAILURE` / `EXCEPTION` | Problème de livraison | Gèle les fonds, ouvre le recours |

**Deux canaux de mise à jour du suivi :**

1. **Canal principal — webhook ShipEngine** (`shipEngineWebhook.ts`) : ShipEngine pousse une mise à jour à chaque changement de statut du colis. C'est la voie temps réel. Sécurité : le webhook n'étant pas signé par défaut, il est protégé par un **secret partagé** (en-tête ou paramètre d'URL) comparé de façon sécurisée ; toute requête sans secret valide est rejetée (401), et si le secret n'est pas configuré côté serveur, l'endpoint refuse tout (fermeture sécurisée, 500). Les rejeux sont sans effet (idempotent).

2. **Filet de sécurité — sondage planifié** (`trackingCheck.ts`, `checkShippedTracking`) : un job tourne **toutes les 12 heures** et réconcilie les colis dont le webhook aurait été manqué, en interrogeant directement ShipEngine. Il traite par lots (jusqu'à 600 colis par exécution, avec throttling pour respecter les limites de ShipEngine) les commandes en `label_created`, `shipped` et `return_requested`.

3. **Rafraîchissement manuel** : l'acheteur ou le vendeur peut appuyer sur le bouton **rafraîchir** de l'écran de suivi (`checkTrackingStatus`). Sécurité : seuls l'acheteur ou le vendeur de la commande peuvent le déclencher (sinon n'importe qui pourrait forcer un statut « livré » et déclencher un versement). Le bouton est désactivé une fois le colis livré.

**Relance « étiquette dormante » :** si une étiquette est créée mais qu'**aucun scan transporteur** n'arrive pendant **3 jours**, le job de sondage envoie au vendeur un rappel « Pensez à expédier votre colis » (au plus une fois par fenêtre, donc non spammant). C'est le cas du vendeur qui a imprimé l'étiquette mais n'a jamais déposé le colis.

---

### 8.7 Livraison confirmée et libération des fonds (séquestre 7 jours)

Quand le transporteur scanne **« Livré »**, la machine à états (de manière atomique et idempotente) :

- passe la commande au statut **`delivered`** et horodate `deliveredAt` ;
- déplace les fonds du vendeur de « en attente » (`pendingBalance`) vers **« en séquestre » (`heldBalance`)** ;
- fixe la **date de libération** à **livraison + 7 jours** (`fundsReleaseAt`) ;
- notifie l'acheteur (« Colis livré ! ») et poste un message système dans la conversation.

Le **modèle à trois poches** du porte-monnaie vendeur clarifie l'état de l'argent :

| Poche | Signification |
|---|---|
| `pendingBalance` (en attente) | Vente payée, colis pas encore livré (en transit) |
| `heldBalance` (en séquestre) | Colis livré, dans la fenêtre de litige de 7 jours |
| `balance` (disponible) | Fenêtre écoulée sans litige — retirable |

Côté acheteur, l'écran affiche un encart de **protection** : « Colis livré. Vos fonds sont protégés jusqu'au [date]. » Côté vendeur : « Colis livré. Vos fonds seront disponibles le [date]. »

**Libération automatique** (`releaseHeldFunds`, job **toutes les heures**) : pour chaque commande `delivered` dont la date de libération est dépassée **et sans litige en cours**, l'argent passe de « en séquestre » à « disponible », la commande passe à **`completed`**, et le vendeur est notifié.

Cette libération est une **décision automatisée** au sens de la **Loi 25 (Québec, art. 12.1)**. Elle est donc :

- **journalisée** dans un registre transparent des décisions automatisées (avec critères : statut, absence de litige, fenêtre de 7 jours) ;
- **expliquée** à l'utilisateur dans l'écran de suivi via un bloc « Pourquoi cette décision ? » (critères lisibles) ;
- **contestable** : un bouton « Contester cette décision » ouvre une demande de **révision humaine**. Important : contester **n'annule rien** automatiquement — cela déclenche un examen humain.

Garde-fous de la libération : elle ne se déclenche **jamais** si la commande est `disputed`, `delivery_failed`, `lost` ou `refunded`, et elle est ré-vérifiée atomiquement au moment du versement (un litige ouvert entre-temps bloque le versement). Elle est idempotente (`fundsReleasedAt`).

---

### 8.8 Échecs et relances de l'étiquette (rattrapage automatique)

Si le paiement réussit mais que **l'étiquette ne peut pas être créée** (ShipEngine en panne, erreur transitoire, tarif périmé/de repli), la commande est marquée `labelCreationPending = true` et **reste au statut `paid`** : l'acheteur est débité, mais **le vendeur n'est pas crédité** (pas d'étiquette = pas d'expédition). Sans rattrapage, ces commandes seraient gelées indéfiniment.

Le job **`sweepPendingLabels`** tourne **toutes les heures** et, pour chaque commande dans cet état (jusqu'à 50 par passage) :

1. **Re-cote un tarif neuf** auprès de ShipEngine (origine = adresse vendeur, destination = adresse acheteur, colis = métadonnées article) — jamais l'ancien tarif potentiellement périmé. Choix du tarif domicile le moins cher.
2. **Réessaie l'achat d'étiquette.** En cas de succès : crédite le vendeur, rapproche le coût réel, enregistre l'étiquette, passe la commande à `label_created`, et poste le message système avec le numéro de suivi.
3. **Compte les tentatives** (`labelAttempts`). Après **4 tentatives échouées** : la commande est **annulée et l'acheteur intégralement remboursé** (remboursement Stripe idempotent + re-crédit éventuel du porte-monnaie), l'article est **remis en vente**, et l'acheteur est notifié.

Cette annulation/remboursement après 4 échecs est elle aussi une **décision automatisée Loi 25** : journalisée et contestable, avec une notification explicite à l'acheteur (« Commande annulée et remboursée automatiquement … Si vous contestez cette décision, vous pouvez nous le signaler »).

---

### 8.9 Problème de livraison, colis perdu et recours acheteur

Si le transporteur signale un **échec/exception** (`FAILURE`/`EXCEPTION`), la machine à états passe la commande à **`delivery_failed`**, ouvre la fenêtre de litige (`disputed = true`, ce qui **gèle les fonds**) et notifie **les deux parties**. Les fonds ne sont **jamais** libérés sur un échec ; la résolution (remboursement) passe par le recours.

Sur l'écran de suivi, l'acheteur dispose alors d'un encart de recours selon l'état :

| État | Options offertes à l'acheteur |
|---|---|
| `delivery_failed` / `lost` | « Signaler un problème » (motif + détails) **ou** « Demander un remboursement » (remboursement automatique réservé aux colis perdus / en échec) |
| `shipped` / `delivered` | « Signaler un problème » (le scan livré fait foi → examen équipe sous 48 h, fonds protégés) |
| `delivered` | « Demander un retour » (voir 8.10) |

Si l'acheteur tente un remboursement automatique sur un colis **livré** (et non perdu), l'app le refuse poliment et le réoriente vers « Signaler un problème » (un colis livré présentant un défaut relève de l'examen humain, pas du remboursement automatique).

---

### 8.10 Retour d'article et remboursement à réception (anti-fraude)

Sur une commande **livrée**, l'acheteur peut **demander un retour** (motifs : article non conforme, endommagé, mauvais article, changement d'avis). À la validation (`requestReturn`) :

- une **étiquette de retour** est achetée (sens inverse acheteur → vendeur, marquée « retour ») ;
- les fonds sont **gelés** et la commande passe à **`return_requested`** ;
- l'acheteur voit l'écran « Étiquette de retour disponible » avec le suivi du retour et le bouton pour ouvrir l'étiquette ;
- le vendeur est notifié.

**Règle anti-fraude (cœur du dispositif) :** le remboursement n'est **jamais** déclenché sur la parole de l'acheteur. Il n'a lieu que lorsque le **transporteur confirme « livré » sur le colis de retour**, c'est-à-dire quand le vendeur a **physiquement récupéré** l'article (détecté par le webhook ou le sondage sur le numéro de suivi du retour). À ce moment :

- l'acheteur est remboursé du **total moins le coût de l'étiquette de retour** (les **frais de retour sont à la charge de l'acheteur** et déduits du remboursement) ;
- le vendeur est débité de son crédit ;
- la commande passe à `refunded` ; les deux parties sont notifiées.

L'opération est idempotente (un signal « livré » rejoué ne rembourse jamais deux fois). Note : l'article retourné n'est **pas** remis en vente automatiquement (le vendeur l'a en main, décision manuelle).

---

### 8.11 Données clés de la commande (vocabulaire métier)

| Champ | Sens |
|---|---|
| `status` | État de la commande : `pending_payment` → `paid` → `label_created` → `shipped` → `delivered` → `completed` ; ou `delivery_failed`, `lost`, `return_requested`, `refunded`, `cancelled` |
| `trackingStatus` | Dernier statut transporteur connu (LABEL_CREATED, IN_TRANSIT, DELIVERED, FAILURE…) |
| `trackingNumber` / `trackingUrl` | Numéro de suivi et lien de suivi public (Intelcom, Postes Canada, UPS) |
| `shippingLabelUrl` | Étiquette d'expédition (PDF 4×6) à imprimer par le vendeur |
| `carrierCode` | Transporteur retenu (ex. `intelcom_ca`, `canada_post`, `ups_ca`) |
| `shippingCost` / `actualShippingCost` / `shippingCostDelta` | Tarif facturé à l'acheteur / coût réel ShipEngine / écart |
| `labelCreatedAt`, `shippedAt`, `deliveredAt` | Horodatages des jalons |
| `fundsReleaseAt` / `fundsReleasedAt` | Date prévue / effective de libération des fonds au vendeur |
| `labelCreationPending` / `labelAttempts` | Étiquette en échec à rattraper / nombre de tentatives |
| `returnTrackingNumber` / `returnLabelUrl` / `returnLabelCost` | Suivi, étiquette et coût du retour |

---

### 8.12 Spécificités Canada et iOS / Android

**Canada :**
- **CAD** partout ; adresses et codes postaux **canadiens uniquement** (validation stricte, pays = CA, 13 provinces/territoires).
- Transporteurs ciblés : **Intelcom (Dragonfly)**, **Postes Canada**, **UPS Canada** ; le transporteur par défaut en l'absence de code est `intelcom_ca`.
- **Loi 25 (Québec)** : les décisions prises automatiquement par le système (libération des fonds après 7 jours, annulation/remboursement après échec d'étiquette) sont **journalisées, expliquées et contestables** (droit à une révision humaine), directement depuis l'écran de suivi. Cela vaut aussi pour les commandes en remise en main propre touchées par une décision automatique (l'écran de suivi n'affiche alors **que** le bloc de transparence/contestation, sans timeline de colis).

**iOS vs Android (impact produit sur les notifications de livraison) :**
- Les notifications « Colis livré », « Problème de livraison », « Pensez à expédier votre colis », « Fonds libérés », « Commande annulée/remboursée » sont envoyées en **push** et passent par **FCM**.
- **Limitation iOS connue et factuelle :** côté serveur, les jetons **APNs bruts** (format iOS) sont **détectés et ignorés** car ils ne sont pas des jetons FCM valides (les envoyer échouerait et risquerait de supprimer un jeton valide). Conséquence : tant que le client n'enregistre pas un vrai jeton FCM sur iOS, certains appareils iOS peuvent **ne pas recevoir** ces push de livraison. Le suivi reste **toujours consultable in-app** (l'écran de suivi et le bouton « rafraîchir » ne dépendent pas du push), donc l'information n'est jamais perdue — seul le push d'alerte peut manquer sur iOS.
- Les notifications de livraison sont routées vers des **canaux Android** dédiés (catégorisation des notifications par type), sans équivalent strict côté iOS.

---

### 8.13 Limites connues (factuelles)

- **Points relais (PUDO) non exposés à l'achat** : la recherche de points relais et la distinction domicile/relais existent dans le backend et le modèle de données, mais le tunnel d'achat ne propose que la livraison à domicile (toutes les estimations sont marquées « domicile »).
- **Pas de confirmation manuelle de réception** pour les colis : la livraison est pilotée par le scan transporteur, pas par un bouton acheteur (contrairement au mode remise en main propre, qui a sa propre confirmation).
- **Achat d'étiquette non idempotent** côté ShipEngine : aucune relance automatique immédiate ; le rattrapage passe exclusivement par le balayage horaire `sweepPendingLabels`.
- **Push iOS** : voir 8.12 — dépendance à l'enregistrement d'un vrai jeton FCM côté client.
