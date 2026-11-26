## 08. Livraison & suivi de colis

Cette section décrit ce que le code fait réellement, de l'achat d'un article jusqu'à la libération des fonds au vendeur, lorsque l'acheteur choisit la **livraison par transporteur** (par opposition à la remise en main propre / « meetup »). Le périmètre couvre la génération de l'étiquette d'expédition, le suivi du colis, la confirmation de livraison, la protection de l'acheteur (séquestre des fonds) et les rattrapages automatiques en cas d'échec.

Tout repose sur **ShipEngine**, un agrégateur multi-transporteurs que la plateforme pilote pour comparer les tarifs, acheter les étiquettes, suivre les colis et chercher des points relais. Côté transporteurs, le code est calibré pour le **Canada** : **Intelcom (Dragonfly)**, **Postes Canada** et **UPS Canada** (ces trois codes ont une URL de suivi dédiée ; tout autre transporteur retombe sur une URL générique ShipEngine). Tout est libellé en **dollars canadiens (CAD)** et limité aux adresses canadiennes (code postal canadien obligatoire, pays = CA).

> ### ⚠️ La livraison est DÉSACTIVÉE aujourd'hui
>
> Deux drapeaux la ferment, côté application et côté serveur :
> - `SHIPPING_ENABLED = false` dans `config/featureFlags.ts` → l'app masque le mode livraison partout (mise en vente, fiche article, tunnel d'achat, chat, réglages) et force tous les nouveaux articles en main-à-main. L'écran de tarifs (`app/checkout/shipping.tsx`) redirige immédiatement vers le checkout meetup, même par lien profond.
> - `SHIPPING_ENABLED` (variable d'environnement, non positionnée) côté Cloud Functions → `createTransaction` et `createStripeCheckout` **refusent** toute commande en livraison, même appelée directement en dehors de l'app (`functions/src/config/featureFlags.ts`).
>
> **Le meetup est donc le seul parcours d'achat actif.** Tout ce qui suit décrit du code écrit, testé et déployé, mais **non atteignable par un utilisateur aujourd'hui**. Réactiver = repasser les deux drapeaux à `true` (et enregistrer le webhook ShipEngine, cf. 8.6).

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

**Où l'acheteur et le vendeur voient-ils tout ça ?** Il n'y a pas d'écran de suivi dédié : le bloc de suivi (`features/orders/components/ShipmentTracking.tsx`) est affiché **en haut de la conversation liée à la commande** (`app/chat/[id].tsx`). L'écran « Mes commandes » ne fait que renvoyer vers cette conversation.

---

### 8.2 Avant le paiement : estimation du tarif et adresse

Quand l'acheteur passe par l'écran de paiement en mode livraison (`app/checkout/shipping.tsx`), l'application :

- Demande une **estimation tarifaire** au backend (`getShippingEstimate`, dans `functions/src/callable/payments/shipping.ts`), qui interroge ShipEngine avec le code postal de départ du vendeur, l'adresse de livraison de l'acheteur et les caractéristiques du colis (poids, dimensions, issus de la fiche article ; valeurs par défaut 0,5 kg et 30×25×10 cm si non renseignées).
- Affiche jusqu'à **5 tarifs**, triés du moins cher au plus cher, chacun avec : transporteur, type de service, délai estimé (ex. « 3 jours ouvrables ») et prix en CAD. Le tarif le moins cher est présélectionné.

**Règles de gestion clés :**

| Règle | Comportement |
|---|---|
| Estimation : code postal canadien suffisant | L'estimation exige uniquement un **code postal canadien valide** (format A1A 1A1) de chaque côté. Si la rue et la ville manquent, le serveur les remplace par le code postal pour que ShipEngine puisse coter **par zone**. La validation stricte de l'adresse complète intervient plus tard, à la création de la commande (8.3). |
| Adresse du vendeur souvent approximative à ce stade | L'app n'envoie **que** le code postal du vendeur, déduit du champ « localisation » de l'annonce. Si ce champ n'est pas un code postal, l'app retombe sur un **code postal montréalais par défaut** (`H2S3C4`, `app/checkout/shipping.tsx`), et le serveur applique une **province par défaut « QC »**. Conséquence métier : le prix affiché à l'acheteur peut être calculé depuis une origine qui n'est pas celle du vendeur, et **diverger du tarif re-coté au moment de payer**. |
| Tarif de repli (« fallback ») | Si l'appel d'estimation échoue, l'app affiche deux tarifs locaux de secours codés en dur côté app (Postes Canada Standard 8,50 $ / Express 14,50 $) **purement indicatifs**. Un tarif de repli **ne permet pas** d'acheter une vraie étiquette : le paiement est alors bloqué et l'acheteur est invité à réessayer l'estimation ou à basculer en remise en main propre. |
| Tarif jamais « de confiance » côté client | Le prix de livraison envoyé par l'application n'est **jamais** cru. Au moment de créer la commande, le serveur re-cote le même trajet via ShipEngine et utilise **son** prix comme tarif facturé. Si le tarif a expiré ou ne correspond plus au trajet, l'acheteur doit rafraîchir l'estimation. |

**Points relais (PUDO) — capacité non branchée :** le backend expose une recherche de points de retrait (`findPickupPoints`, par code postal, rayon 10 km) et le modèle de tarif distingue « à domicile » (`home`) de « point relais » (`pickup_point`). En pratique :

- **toutes les estimations sont marquées « domicile »** (le code le force ainsi) et l'écran de paiement ne propose aucun choix de point relais ;
- la recherche de points relais **ne remonte jamais d'erreur** : en cas d'échec de l'appel, elle renvoie une liste vide.

À noter : un écran de **préférences vendeur** (`Réglages › Options de livraison`, `app/settings/shipping-options.tsx`, lui aussi masqué tant que la livraison est fermée) permet au vendeur de cocher les modes qu'il accepte (Postes Canada bureau de poste, UPS Access Point, Penguin Pickup casier métro, remise en main propre). **Cette préférence est enregistrée mais lue par aucune logique de tarification, d'étiquette ou de suivi** : elle n'a aujourd'hui aucun effet sur ce qui est proposé à l'achat.

---

### 8.3 Création de la commande et conditions vendeur

À la création de la commande expédiée (`createTransaction`, `functions/src/callable/payments/checkout.ts`), avant tout débit, le serveur vérifie que **la commande est expédiable et que le vendeur peut être payé** :

- La livraison doit être **ouverte côté serveur** (drapeau ci-dessus) — sinon refus immédiat : « La livraison n'est pas disponible pour le moment. Veuillez utiliser la remise en main propre. »
- L'**adresse de l'acheteur** est validée strictement : pays = CA, rue non vide, ville non vide, **province parmi les 13 codes** canadiens, code postal au format A1A 1A1.
- Le `rateId` ShipEngine doit être présent et **non « fallback »**.
- L'**adresse d'expédition du vendeur** doit être réelle et exploitable (adresse par défaut du profil, sinon première adresse complète, sinon localisation de l'annonce si elle porte code postal + ville + province). **Aucun repli sur Montréal ici** : si rien n'est exploitable, la commande est refusée.
- Le vendeur doit posséder un **compte de paiement Stripe Connect** actif (identifiant présent **et** encaissement autorisé). Sinon la commande est refusée (« Le vendeur n'a pas encore configuré son compte de paiement »). Pas de création de compte à la volée.

Si tout est valide, l'article est marqué vendu, et la commande est créée au statut `pending_payment` avec : montant article, frais de livraison (**re-cotés serveur**, jamais la valeur envoyée par l'app), frais de service plateforme, taxes (0 tant que la TPS/TVQ n'est pas activée), total, et l'adresse de livraison de l'acheteur.

**Qui paie la livraison ?** L'acheteur. Le total facturé = prix article + frais de livraison + frais de service. Le paiement atterrit **intégralement sur le compte de la plateforme** (charge directe, sans commission Stripe automatique ni virement immédiat au vendeur) : c'est la plateforme qui paie l'étiquette à ShipEngine, puis **rapproche** son coût réel du tarif facturé à l'acheteur (voir 8.5). Le vendeur reçoit **100 % du prix de l'article**, via le porte-monnaie interne.

---

### 8.4 Achat de l'étiquette et statut « Étiquette créée »

L'étiquette est achetée **après l'encaissement du paiement**, dans le webhook de paiement Stripe (`payment_intent.succeeded`) ou lors d'un paiement intégral par porte-monnaie. C'est une distinction métier importante : **on ne crée pas l'étiquette avant d'avoir l'argent.**

Lorsque l'étiquette est achetée avec succès, une opération atomique unique (`functions/src/utils/labelFulfillment.ts`) :

- **crédite le vendeur** sur son solde « en attente » (`pendingBalance`) — c'est le modèle de **crédit différé** : le vendeur n'est crédité qu'à l'existence d'une vraie étiquette, jamais avant. Si le vendeur a une dette envers la plateforme (remboursement antérieur non couvert), le crédit **rembourse d'abord la dette**, le reliquat allant en « en attente » ;
- enregistre les informations de suivi : numéro de suivi, URL d'étiquette (PDF), URL de suivi public, code transporteur ;
- fait passer la commande au statut **`label_created`** (« Étiquette créée »), et **non** « Expédié ».

Cette distinction est centrale : une étiquette qui existe ne signifie pas que le colis est parti. Tant que le transporteur n'a pas scanné le colis, la commande reste « Étiquette créée ». Côté interface, le message affiché est « L'étiquette est prête, le colis va être déposé chez le transporteur », avec deux boutons — **Télécharger l'étiquette** (PDF 4×6) et **Suivre en ligne**. À noter : ces deux boutons sont visibles par **les deux parties** dès que les liens existent ; rien n'en réserve l'étiquette au vendeur.

**Non-idempotence de l'achat d'étiquette :** ShipEngine ne supporte pas de clé d'idempotence ici. Un nouvel essai après un délai d'attente pourrait acheter une **deuxième** étiquette payante. Deux garde-fous : l'achat ne fait **aucune tentative automatique**, et la commande est « réservée » (verrou de 5 minutes) avant l'appel payant, pour que deux traitements concurrents ne puissent jamais payer deux étiquettes. Les étiquettes « coincées » sont récupérées par un balayage dédié (voir 8.8).

---

### 8.5 Rapprochement du coût réel de livraison

À chaque étiquette achetée, le serveur compare le **coût réel** facturé par ShipEngine (transport + assurance éventuelle) au **tarif estimé** facturé à l'acheteur, et enregistre l'écart sur la commande (`actualShippingCost`, `shippingCostDelta`).

- Les **petits écarts** sont absorbés par les frais de protection acheteur.
- Un écart **supérieur à 2 $ en valeur absolue** (dans un sens comme dans l'autre) est journalisé comme **anomalie critique** et inscrit dans un registre comptable plateforme (`platform_ledger`, type `shipping_cost_variance`) pour suivi manuel.

Cela protège la marge de la plateforme contre les manipulations de tarif côté client et les divergences réelles entre estimation et facturation transporteur. À noter : rien n'est re-facturé à l'acheteur ni au vendeur — l'écart est **assumé par la plateforme** et seulement tracé.

---

### 8.6 Suivi du colis : machine à états et canaux

Le suivi avance la commande selon une **machine à états unique** (`functions/src/utils/trackingTransition.ts`, partagée par tous les points d'entrée pour garantir un seul comportement) :

```
paid ──(étiquette achetée)──> label_created ──(1er scan transporteur)──> shipped
     └─ shipped ──(scan "livré")──> delivered  (fenêtre de séquestre 7 jours)
     └─ shipped / label_created ──(scan "échec")──> delivery_failed  (fonds gelés)
```

**Correspondance des statuts transporteur** (codes ShipEngine → statut interne → affichage) :

| Code ShipEngine | Statut interne | Affichage acheteur | Effet métier |
|---|---|---|---|
| (achat de l'étiquette) | `LABEL_CREATED` | Étiquette créée | En attente du dépôt chez le transporteur |
| `AC` (accepté), `AT` (tentative de livraison), `NY` (pas encore dans le système) | `TRANSIT` | En transit | 1er « scan » → passe à « Expédié » |
| `IT` (en transit) | `IN_TRANSIT` | En transit | idem |
| `DE` | `DELIVERED` | Livré | Déclenche le séquestre 7 jours |
| `EX` | `FAILURE` | Problème de livraison | Gèle les fonds, ouvre le recours |
| `UN` / inconnu | `UNKNOWN` | En préparation | Aucun effet |

**Deux imprécisions de traduction à connaître :** le code `NY` (« pas encore enregistré par le transporteur ») est traduit en « en transit », donc une commande peut passer à **« Expédié » sans que le colis ait été déposé** — et le rappel « pensez à expédier » (ci-dessous) s'éteint alors. Le code `AT` (tentative de livraison infructueuse) est lui aussi traduit en « en transit », jamais en échec.

L'écran sait afficher des statuts plus riches (« En cours de livraison », « Colis retourné », « En attente de prise en charge », « Problème de livraison ») mais **le backend ne les produit jamais aujourd'hui** : seuls les six statuts du tableau existent réellement en base.

**Canaux de mise à jour du suivi :**

1. **Webhook ShipEngine** (`functions/src/http/shipEngineWebhook.ts`) — conçu comme le canal principal : ShipEngine pousserait une mise à jour à chaque changement de statut. Sécurité : le webhook n'étant pas signé par défaut, il est protégé par un **secret partagé** (en-tête ou paramètre d'URL) comparé de façon sécurisée ; toute requête sans secret valide est rejetée (401), et si le secret n'est pas configuré côté serveur, l'endpoint refuse tout (fermeture sécurisée, 500). Les rejeux sont sans effet (idempotent).
   **⚠️ Ce canal n'est pas actif** : l'enregistrement de l'URL et du secret **chez ShipEngine est une action manuelle du fondateur**, non effectuée à ce jour (c'est écrit noir sur blanc dans `functions/src/index.ts` et `firestore-schema.md`). Tant que ce n'est pas fait, ShipEngine n'appelle personne.

2. **Sondage planifié** (`functions/src/scheduled/trackingCheck.ts`) — pensé comme filet de sécurité, il est **de fait le seul canal réel aujourd'hui**. Il tourne **toutes les 12 heures** et interroge ShipEngine colis par colis. Conséquence métier directe : un colis livré peut mettre **jusqu'à 12 heures** à être vu comme livré (et donc à démarrer la fenêtre de 7 jours), et le bouton « rafraîchir » devient le seul moyen d'aller plus vite. Le job traite jusqu'à **600 colis par exécution**, dont **200 réservés en priorité aux colis de retour** (un retour livré déclenche un remboursement : il ne doit jamais être bloqué par une file de colis aller). Il couvre les commandes en `return_requested`, puis `label_created` et `shipped`, avec un espacement entre appels pour respecter les limites de ShipEngine.

3. **Rafraîchissement manuel** : l'acheteur ou le vendeur peut appuyer sur le bouton **rafraîchir** du bloc de suivi (`checkTrackingStatus`). Sécurité : seuls l'acheteur ou le vendeur de la commande peuvent le déclencher (sinon n'importe qui pourrait forcer un statut « livré » et déclencher un versement). Le bouton est désactivé une fois le colis livré.

**Relance « étiquette dormante » :** si une étiquette est créée mais qu'**aucun scan transporteur** n'arrive pendant **3 jours**, le job de sondage envoie au vendeur un rappel « Pensez à expédier votre colis » (au plus une fois par fenêtre de 3 jours, donc non spammant). C'est le cas du vendeur qui a imprimé l'étiquette mais n'a jamais déposé le colis. **Ce rappel n'a aucune sanction associée** : il n'existe aucune annulation automatique d'une commande restée en « Étiquette créée » (voir 8.9).

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
| `pendingBalance` (en attente) | Vente payée et étiquette créée, colis pas encore livré |
| `heldBalance` (en séquestre) | Colis livré, dans la fenêtre de litige de 7 jours |
| `balance` (disponible) | Fenêtre écoulée sans litige — retirable |

Côté acheteur, le bloc de suivi affiche un encart de **protection** : « Colis livré. Vos fonds sont protégés jusqu'au [date]. » Côté vendeur : « Colis livré. Vos fonds seront disponibles le [date]. »

**Libération automatique** (`functions/src/scheduled/releaseHeldFunds.ts`, job **toutes les heures**) : pour chaque commande `delivered` dont la date de libération est dépassée **et sans litige en cours**, l'argent passe de « en séquestre » à « disponible » (là encore, une dette vendeur éventuelle est régularisée en priorité), la commande passe à **`completed`**, et le vendeur est notifié.

Cette libération est une **décision automatisée** au sens de la **Loi 25 (Québec, art. 12.1)**. Elle est donc :

- **journalisée** dans un registre transparent des décisions automatisées (critères : statut livré, absence de litige, fenêtre de 7 jours) ;
- **expliquée** aux deux parties dans le bloc de suivi via « Pourquoi cette décision ? » (critères lisibles) ;
- **contestable** : un bouton « Contester cette décision » ouvre une demande de **révision humaine**. Important : contester **n'annule rien** automatiquement — cela déclenche un examen humain.

Garde-fous de la libération : elle ne se déclenche **jamais** si la commande est `disputed`, `delivery_failed`, `lost` ou `refunded`, elle est ré-vérifiée atomiquement au moment du versement (un litige ouvert entre-temps bloque le versement) et elle est idempotente (`fundsReleasedAt`).

---

### 8.8 Échecs et relances de l'étiquette (rattrapage automatique)

Si le paiement réussit mais que **l'étiquette ne peut pas être créée** (ShipEngine en panne, erreur transitoire, tarif périmé/de repli, ShipEngine non configuré), la commande est marquée `labelCreationPending = true` et **reste au statut `paid`** : l'acheteur est débité, mais **le vendeur n'est pas crédité** (pas d'étiquette = pas d'expédition). Sans rattrapage, ces commandes seraient gelées indéfiniment.

Le job **`sweepPendingLabels`** (`functions/src/scheduled/sweepPendingLabels.ts`) tourne **toutes les heures** et, pour chaque commande dans cet état (jusqu'à 50 par passage, avec un verrou anti-chevauchement pour ne jamais payer deux étiquettes) :

1. **Re-cote un tarif neuf** auprès de ShipEngine (origine = adresse vendeur, destination = adresse acheteur, colis = métadonnées article) — jamais l'ancien tarif potentiellement périmé. Choix du tarif le moins cher.
2. **Réessaie l'achat d'étiquette.** En cas de succès : crédite le vendeur, rapproche le coût réel, enregistre l'étiquette, passe la commande à `label_created`, et poste le message système avec le numéro de suivi.
3. **Compte les tentatives** (`labelAttempts`) — une par passage horaire. À la **4ᵉ tentative échouée** (donc environ **4 heures** après le paiement) : la commande est **annulée et l'acheteur intégralement remboursé** (remboursement Stripe idempotent + re-crédit de la part payée en porte-monnaie), l'article est **remis en vente**, et l'acheteur est notifié.

Si le remboursement Stripe lui-même échoue, la commande **n'est pas annulée** : elle reste « payée / étiquette en attente », l'échec est mis en file d'attente de reprise, et un journal critique est écrit — on ne veut jamais annuler sans avoir remboursé.

Cette annulation/remboursement est elle aussi une **décision automatisée Loi 25** : journalisée et contestable, avec une notification explicite à l'acheteur (« Commande annulée et remboursée automatiquement … Si vous contestez cette décision, vous pouvez nous le signaler »).

**Filet supplémentaire :** une commande restée `paid` **sans** être marquée « étiquette en attente » est annulée et remboursée automatiquement au bout de **7 jours** (`functions/src/scheduled/transactionExpiration.ts`), avec remise en vente de l'article.

---

### 8.9 Problème de livraison, colis perdu et recours acheteur

Si le transporteur signale un **échec** (code `EX`), la machine à états passe la commande à **`delivery_failed`**, ouvre la fenêtre de litige (ce qui **gèle les fonds**) et notifie **les deux parties**. Les fonds ne sont **jamais** libérés sur un échec.

Sur le bloc de suivi, l'acheteur voit alors :

| État de la commande | Ce que l'acheteur voit | Ce que le serveur accepte réellement |
|---|---|---|
| `delivery_failed` / `lost` | Encart de recours : « Signaler un problème » **et** « Demander un remboursement » | **Seul le remboursement fonctionne** (remboursement automatique réservé aux colis en échec/perdus). Le bouton « Signaler un problème » est refusé par le serveur à ce statut. |
| `shipped` | Bouton « Signaler un problème » | **Refusé** par le serveur : le signalement n'est accepté qu'après livraison. |
| `delivered` | « Signaler un problème » et « Demander un retour » | Les deux fonctionnent, **à condition d'être encore dans la fenêtre de 7 jours** (fonds non encore libérés). Le signalement gèle les fonds et ouvre un dossier examiné par l'équipe. |
| `label_created` | **Aucun bouton de recours** | — |

**⚠️ Incohérence à corriger avant réouverture de la livraison :** le serveur n'accepte un « signalement de problème » que sur une commande **livrée** et **dans la fenêtre de 7 jours** (`functions/src/callable/recourse.ts`). L'interface, elle, affiche le bouton sur `shipped` et le met même en action principale de l'encart `delivery_failed` / `lost`. Dans ces deux cas, l'acheteur reçoit un message d'erreur technique (« Cette commande ne peut pas faire l'objet d'une réclamation (statut …) ») au lieu d'une prise en charge.

Si l'acheteur tente un remboursement automatique sur un colis **livré** (et non perdu), l'app le refuse poliment et le réoriente vers « Signaler un problème » (un colis livré présentant un défaut relève de l'examen humain, pas du remboursement automatique).

**Deux trous produit assumés :**

- Le statut **`lost` (colis perdu) n'est écrit par personne** : aucun automatisme ne déclare un colis perdu. Un colis qui disparaît sans jamais être scanné « échec » reste indéfiniment en `shipped` ou `label_created`.
- **Aucun délai maximal de transit.** Une commande bloquée en `label_created` (vendeur qui n'expédie jamais) ou en `shipped` (colis évaporé) n'a **aucune expiration automatique** : les fonds restent en « en attente » chez le vendeur, l'acheteur n'a pas de bouton de recours à `label_created`, et le seul mécanisme est le rappel au vendeur tous les 3 jours. La sortie passe par l'équipe (remboursement administrateur).

---

### 8.10 Retour d'article et remboursement à réception (anti-fraude)

Sur une commande **livrée** et **encore dans la fenêtre de 7 jours** (fonds non libérés), l'acheteur peut **demander un retour** (motifs : article non conforme, endommagé, mauvais article, changement d'avis). Passé ce délai, la demande est refusée (« La fenêtre de retour de 7 jours est écoulée »). À la validation (`requestReturn`) :

- une **étiquette de retour** est achetée (sens inverse acheteur → vendeur, marquée « retour ») ;
- les fonds sont **gelés** et la commande passe à **`return_requested`** ;
- l'acheteur voit « Étiquette de retour disponible » avec le suivi du retour et le bouton pour ouvrir l'étiquette ;
- le vendeur est notifié.

**Règle anti-fraude (cœur du dispositif) :** le remboursement n'est **jamais** déclenché sur la parole de l'acheteur. Il n'a lieu que lorsque le **transporteur confirme « livré » sur le colis de retour**, c'est-à-dire quand le vendeur a **physiquement récupéré** l'article (détecté par le sondage sur le numéro de suivi du retour, ou par le webhook une fois celui-ci enregistré). À ce moment (`functions/src/utils/returnRefund.ts`) :

- l'acheteur est remboursé du **total moins le coût de l'étiquette de retour** (les **frais de retour sont à la charge de l'acheteur** et déduits du remboursement), réparti entre la carte et le porte-monnaie selon ce qui avait été payé ;
- le vendeur est débité exactement de ce qu'il avait été crédité (le manque éventuel devient une dette régularisée sur ses ventes suivantes) ;
- la commande passe à `refunded` ; les deux parties sont notifiées.

L'opération est idempotente (un signal « livré » rejoué ne rembourse jamais deux fois). L'article retourné n'est **pas** remis en vente automatiquement (le vendeur l'a en main, décision manuelle).

**Deux limites :**
- Le **montant des frais de retour n'est pas affiché** avant la demande : l'écran annonce « frais de retour à votre charge, déduits du remboursement », mais le coût réel n'est connu qu'après l'achat de l'étiquette.
- Si le colis de retour **n'est jamais scanné « livré »**, un job escalade la commande en **dossier administrateur au bout de 21 jours** (les fonds restent gelés, aucun remboursement automatique) : c'est l'équipe qui tranche.

---

### 8.11 Données clés de la commande (vocabulaire métier)

| Champ | Sens |
|---|---|
| `status` | État de la commande : `pending_payment` → `paid` → `label_created` → `shipped` → `delivered` → `completed` ; ou `delivery_failed`, `return_requested`, `disputed`, `refund_in_progress`, `refunded`, `cancelled` (`lost` existe mais n'est jamais écrit) |
| `trackingStatus` | Dernier statut transporteur connu (`LABEL_CREATED`, `TRANSIT`, `IN_TRANSIT`, `DELIVERED`, `FAILURE`, `UNKNOWN`) |
| `trackingNumber` / `trackingUrl` | Numéro de suivi et lien de suivi public (Intelcom, Postes Canada, UPS ; lien générique ShipEngine sinon) |
| `shippingLabelUrl` | Étiquette d'expédition (PDF 4×6) à imprimer |
| `carrierCode` | Transporteur retenu (ex. `intelcom_ca`, `canada_post`, `ups_ca`) ; en l'absence de code, le suivi interroge `intelcom_ca` par défaut |
| `shippingCost` / `actualShippingCost` / `shippingCostDelta` | Tarif facturé à l'acheteur / coût réel ShipEngine / écart |
| `labelCreatedAt`, `shippedAt`, `deliveredAt` | Horodatages des jalons |
| `fundsReleaseAt` / `fundsReleasedAt` | Date prévue / effective de libération des fonds au vendeur |
| `labelCreationPending` / `labelAttempts` | Étiquette en échec à rattraper / nombre de tentatives |
| `sellerCreditedCents` | Montant exactement crédité au vendeur (sert de référence à tout débit ultérieur) |
| `returnTrackingNumber` / `returnLabelUrl` / `returnLabelCost` | Suivi, étiquette et coût du retour |

---

### 8.12 Spécificités Canada et iOS / Android

**Canada :**
- **CAD** partout ; adresses et codes postaux **canadiens uniquement** (validation stricte, pays = CA, 13 provinces/territoires).
- Transporteurs ciblés : **Intelcom (Dragonfly)**, **Postes Canada**, **UPS Canada**. En réalité, ShipEngine renvoie **tous les transporteurs connectés au compte** : la liste réellement proposée dépend de la configuration du compte ShipEngine, pas du code.
- **Loi 25 (Québec)** : les décisions prises automatiquement par le système (libération des fonds après 7 jours, annulation/remboursement après échec d'étiquette, expiration automatique d'une commande) sont **journalisées, expliquées et contestables** (droit à une révision humaine), directement depuis le bloc de suivi dans la conversation. Cela vaut aussi pour les commandes en remise en main propre touchées par une décision automatique (le bloc n'affiche alors **que** la transparence/contestation, sans timeline de colis).

**iOS vs Android (impact produit sur les notifications de livraison) :**
- Les notifications « Colis livré », « Problème de livraison », « Pensez à expédier votre colis », « Fonds libérés », « Commande annulée/remboursée » sont envoyées en **push** via **FCM**.
- **Le push iOS ne fonctionne pas du tout aujourd'hui.** Sur iOS, l'app reçoit du système un jeton **APNs brut**, qui n'est pas un jeton FCM : le client **détecte ce cas et n'enregistre rien** (`features/notifications/hooks/useNotificationSetup.ts`), et le serveur ignorerait de toute façon un tel jeton (`functions/src/utils/notifications.ts`). Conséquence : **aucun appareil iOS ne reçoit ces notifications de livraison**. Corriger demande une étape native (module FCM) hors périmètre du hook actuel.
- Le suivi reste **toujours consultable in-app** (le bloc de suivi et le bouton « rafraîchir » ne dépendent pas du push), et une **notification in-app** est créée à chaque envoi : l'information n'est jamais perdue, seule l'alerte système manque.
- Côté Android, les notifications de commande (`Colis livré`, `Commande annulée`, `Fonds libérés`) partent sur un canal dédié **« orders »** ; en revanche **« Problème de livraison » et « Pensez à expédier votre colis » retombent sur le canal générique** — pas de canal dédié pour ces deux-là.

---

### 8.13 Limites connues (factuelles)

- **La livraison est fermée** (drapeaux app + serveur) : le meetup est le seul parcours d'achat actif. Tout ce chapitre décrit du code non atteignable aujourd'hui.
- **Le webhook ShipEngine n'est pas enregistré chez le fournisseur** : le canal « temps réel » n'existe pas en pratique, et le sondage **toutes les 12 heures** est le vrai chemin de suivi (jusqu'à 12 h de latence sur un « livré », donc sur le départ de la fenêtre de 7 jours).
- **Traductions de statuts approximatives** : « pas encore pris en charge par le transporteur » et « tentative de livraison » sont tous deux traduits en « en transit » — une commande peut donc afficher « Expédié » sans dépôt réel, et une tentative infructueuse n'est jamais vue comme un incident.
- **Recours acheteur incohérent** : le bouton « Signaler un problème » est affiché à `shipped` et sur l'encart d'échec de livraison, alors que le serveur ne l'accepte que sur une commande livrée et dans la fenêtre de 7 jours.
- **Aucun délai maximal de transit, aucun statut « perdu » écrit** : une commande bloquée en « Étiquette créée » ou « Expédié » n'expire jamais toute seule ; sortie par décision de l'équipe uniquement.
- **Estimation de tarif potentiellement fausse** : quand la localisation de l'annonce n'est pas un code postal, l'estimation part d'un **code postal montréalais par défaut** et d'une province « QC ». Le prix affiché peut différer du prix re-coté au paiement.
- **Points relais (PUDO) non exposés à l'achat** : la recherche existe côté backend (et renvoie silencieusement une liste vide en cas d'échec), mais le tunnel d'achat ne propose que la livraison à domicile. La préférence vendeur « Options de livraison » est enregistrée mais **n'est lue nulle part**.
- **Pas de confirmation manuelle de réception** pour les colis : la livraison est pilotée par le scan transporteur, pas par un bouton acheteur (contrairement au mode remise en main propre, qui a sa propre confirmation).
- **Achat d'étiquette non idempotent** côté ShipEngine : aucune relance automatique immédiate ; le rattrapage passe exclusivement par le balayage horaire `sweepPendingLabels` (verrouillé pour éviter tout doublon payant).
- **Push iOS inexistant** : voir 8.12. Le suivi reste consultable in-app.
