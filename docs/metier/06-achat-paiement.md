## 06. Achat & paiement

Cette section décrit, pas à pas, ce qui se passe lorsqu'un acheteur veut acquérir un article sur Second : depuis le bouton d'achat sur la fiche article jusqu'à la remise en main propre ou, quand le rail sera rouvert, jusqu'au paiement par carte et au suivi de commande. Tout est décrit tel que le code le fait réellement aujourd'hui, marché canadien et devise CAD comprises.

---

### 6.0 État actuel important : la livraison ET les paiements sont désactivés

Avant tout, deux faits structurants pour comprendre le parcours réel aujourd'hui :

- **L'expédition postale est désactivée** côté application par le drapeau `SHIPPING_ENABLED = false` (`config/featureFlags.ts`). Tant qu'il est à `false` :
  - Le seul mode de transaction proposé est la **remise en main propre (meetup)**, y compris pour des articles anciens créés en mode « expédition ».
  - L'écran de checkout force automatiquement le mode « main propre ».
  - L'écran d'expédition (`/checkout/shipping`) redirige immédiatement vers le checkout si on tente d'y accéder (garde-fou anti lien profond).
  - À la mise en vente comme à l'édition d'un article, le mode est forcé sur « main propre » (`app/sell/pricing.tsx`, `app/article/edit/[id].tsx`).
- **Les paiements marketplace sont désactivés** par un second drapeau, `PAYMENTS_ENABLED = false` : l'écran porte-monnaie et l'onboarding vendeur Stripe sont masqués et redirigent vers les réglages.
- **Il existe aussi un verrou côté serveur**, indépendant de l'app : `isShippingEnabled()` (`functions/src/config/featureFlags.ts`) lit la variable d'environnement `SHIPPING_ENABLED` des Cloud Functions, **`false` par défaut**. Il refuse toute création de commande « expédition » et toute session de paiement d'une commande « expédition », même si quelqu'un appelait le serveur directement. Le meetup n'est jamais bloqué par ce verrou.
- **Conséquence métier directe** : dans la version en service, **aucun paiement n'est encaissé par l'application**. La remise en main propre se règle **hors application**, directement entre acheteur et vendeur (cash, virement, etc.). Aucun frais de plateforme n'est prélevé sur un meetup, et le montant n'est **jamais** crédité sur un porte-monnaie Seconde.
- Le moteur de paiement (Stripe), d'estimation de livraison (ShipEngine) et de calcul de frais reste **présent et testé dans le code**. Sa réactivation demande **deux gestes, pas un** : repasser le drapeau applicatif à `true` **et** déployer les Cloud Functions avec `SHIPPING_ENABLED=true` (plus `PAYMENTS_ENABLED = true` pour rouvrir porte-monnaie et onboarding vendeur). La suite documente donc **les deux réalités** : ce qui tourne aujourd'hui (meetup) et le parcours d'expédition payée qui se rallumera.

---

### 6.1 Le point de départ : la fiche article et ses boutons d'action

Sur chaque fiche article (`/article/[id]`), une barre d'action fixe en bas de l'écran propose, selon le contexte (`features/article/components/ArticleCTABar.tsx`) :

| Situation | Ce que voit l'utilisateur |
|-----------|---------------------------|
| Article disponible, vu par un autre que le vendeur | Deux boutons : **OFFRE** et le bouton d'achat |
| Article déjà vendu | Bandeau « Article vendu » (aucune action d'achat) |
| Article de l'utilisateur lui-même | Bandeau « C'est votre article » |
| Contexte SwapZone (échange) | Bouton « PROPOSER UN ÉCHANGE » |

**Libellé du bouton d'achat** : il dépend du drapeau livraison. Aujourd'hui (livraison désactivée) il affiche **« PROPOSER UN ACHAT »** — formulation honnête, puisque le parcours aboutit à une *demande* de rencontre, pas à un achat immédiat. Quand la livraison sera rouverte, il affichera **« ACHETER · {prix} »**.

**Règles de gestion sur le bouton d'achat** :

- Si l'article est déjà vendu, une alerte « Article vendu » s'affiche.
- Si l'utilisateur est le vendeur, une alerte bloque l'achat (« Vous ne pouvez pas acheter votre propre article. »).
- Si l'utilisateur n'est **pas connecté**, une feuille d'authentification s'ouvre (message contextuel « connexion requise pour acheter »). L'achat ne reprend qu'une fois connecté.
- Sinon, un retour haptique se déclenche et l'utilisateur est dirigé vers l'écran de checkout avec l'identifiant de l'article.

Le bouton **OFFRE** ouvre une fenêtre de négociation : l'acheteur propose un montant, qui part dans la messagerie (détail en section 07). Un prix négocié n'est utilisable au paiement **que** s'il correspond à une offre explicitement acceptée (voir 6.7).

> **Trou constaté** : la barre d'action sait afficher un état « Réservé temporairement » (article engagé dans une rencontre non finalisée), mais **cet état n'est jamais alimenté** — l'écran article ne transmet pas l'information. Concrètement, dès qu'une demande de rencontre est acceptée l'article est marqué vendu et la fiche affiche « Article vendu », sans distinguer une vente confirmée d'une rencontre encore à honorer.

---

### 6.2 Le checkout : choix du mode de livraison

L'écran `/checkout` (titre « Commander ») affiche un récapitulatif de l'article (image, marque, titre, prix, état) puis les **modes de livraison** disponibles.

Deux modes possibles selon les caractéristiques de l'article :

- **Remise en main propre** — Gratuit. « Rencontrez le vendeur dans un lieu public à Montréal ». Encart : « Paiement en main propre — Le paiement se fait directement lors du meetup. Aucun frais de plateforme. »
- **Expédition postale** (uniquement si la livraison est réactivée **et** que l'article l'autorise) — « À partir de 8,50 $ », « Livraison à votre adresse en 3-5 jours ouvrables ». Encart : « Paiement sécurisé — Votre paiement est protégé. Le vendeur est payé après la livraison confirmée. »

**Règles d'affichage et de sélection automatique** :

- Si la livraison est désactivée, le mode est forcé à **main propre** pour tous les articles.
- Si un seul mode est compatible avec l'article, il est **présélectionné** automatiquement.
- Gardes-fous de l'écran : erreur réseau (« Erreur de connexion » + « Réessayer »), article introuvable, article déjà vendu (« Cet article n'est plus disponible — Il a déjà été vendu. »), ou utilisateur = vendeur (« Vous ne pouvez pas acheter votre propre article ») affichent un écran d'arrêt avec bouton « Retour ».

Le bouton **CONTINUER** route vers `/checkout/meetup` (main propre) ou `/checkout/shipping` (expédition).

> **Trous constatés sur cet écran** (`app/checkout/index.tsx`) :
> 1. **Le prix négocié se perd.** Quand on arrive depuis une offre acceptée dans la messagerie, le montant négocié et l'identifiant de conversation sont transmis à `/checkout` mais **ne sont pas retransmis** à `/checkout/meetup` ni à `/checkout/shipping`. Le prix affiché à l'étape suivante redevient le prix de l'annonce. (Aujourd'hui l'effet est limité : le bouton « payer » d'une offre acceptée n'apparaît pas pour les offres de rencontre, et les offres d'expédition sont désactivées.)
> 2. **Article ancien réservé à l'expédition** : si un article créé avant la fermeture du rail interdit explicitement la main propre, la section « MODE DE LIVRAISON » s'affiche **vide** (aucune carte), le bouton CONTINUER reste actif et mène quand même au parcours meetup. Le cas se résorbe dès que le vendeur édite son annonce (l'édition force la main propre), mais il n'est pas géré à l'affichage.

---

### 6.3 Parcours « remise en main propre » (le seul parcours actif aujourd'hui)

Écran `/checkout/meetup` (« Lieu de rencontre ») :

1. **Choix du lieu** : l'acheteur sélectionne soit l'un des **lieux suggérés par le vendeur** (nom, catégorie, quartier), soit l'option **« À convenir par messagerie »** (toujours visible). Le premier lieu suggéré est présélectionné ; à défaut, l'option messagerie l'est.
2. **Prix** : le prix affiché est celui de l'article. Un prix négocié transmis en paramètre s'afficherait avec un badge « PRIX NÉGOCIÉ » et le prix d'origine barré — mais, du fait du trou décrit en 6.2, ce paramètre n'arrive en pratique jamais jusqu'à cet écran.
3. **Confirmation** : à l'appui sur « CONFIRMER LE MEETUP » :
   - Vérification que les deux utilisateurs ne se sont pas mutuellement bloqués (sinon « Action impossible »).
   - Création (ou récupération) de la **conversation** entre acheteur et vendeur pour cet article.
   - Envoi d'une **offre de rencontre structurée** dans la messagerie (bulle interactive avec montant et lieu) : « Demande de meetup pour "…" ».
   - Redirection vers la page de succès.

**Point clé — aucune commande n'est créée à cette étape.** Contrairement à ce qu'on pourrait croire, l'écran n'enregistre **pas** de transaction et **ne bloque pas** l'article. Il envoie seulement une demande dans la messagerie. La commande (statut `meetup_pending`) naît **côté serveur au moment où l'autre partie accepte l'offre** dans la conversation. C'est un choix délibéré : verrouiller l'article dès l'envoi rendait l'offre inacceptable (« Cet article a déjà été vendu ») et créait une impasse systématique.

**Cycle de vie complet d'une rencontre** (`functions/src/callable/payments/meetup.ts`) :

| Étape | Qui agit | Effet |
|-------|----------|-------|
| Demande envoyée | Acheteur (ou vendeur en contre-offre) | Message d'offre dans la conversation. Article **toujours disponible**. |
| Acceptation | L'autre partie (celle qui n'a pas émis l'offre) | Dans une seule opération atomique : l'offre passe « acceptée », **l'article est marqué vendu**, la commande `meetup_pending` est créée. |
| Confirmation du rendez-vous | **Le vendeur uniquement** | Statut `meetup_confirmed`. |
| Clôture | **Acheteur OU vendeur** | Statut `meetup_completed`, ce qui débloque le droit de laisser un avis. |

**Règles de gestion meetup** :

- Un meetup n'a **aucun frais de plateforme** et **aucun frais de livraison** : le serveur force ces deux montants à zéro. Le « total » de la commande = le montant de l'offre acceptée.
- Le montant de l'offre ne peut **jamais dépasser** le prix affiché de l'article.
- Le règlement se fait **hors application** ; le montant **n'est crédité sur aucun porte-monnaie**, ni côté acheteur ni côté vendeur, à aucun moment.
- La date et l'heure se conviennent ensuite par messagerie.
- **Nettoyage automatique** (tâche horaire, `functions/src/scheduled/transactionExpiration.ts`) : une rencontre jamais confirmée est annulée au bout de **48 h**, une rencontre confirmée mais jamais clôturée au bout de **7 jours**. Dans les deux cas l'article est remis en vente. Aucun remboursement n'est nécessaire puisque aucun argent n'a circulé.
- Un **signalement de « personne ne s'est présenté »** est possible tant que la commande est `meetup_pending` ou `meetup_confirmed`. Une fois la commande gelée en `disputed`, la personne **visée** par ce signalement dispose d'un bouton « Donner ma version » dans la bulle d'offre : sa **contre-déclaration**, acceptée **une seule fois**, est écrite sur la commande (`counterReport`, dans la transaction) puis reportée au mieux sur le dossier de litige ouvert (`counterReportedBy`, `counterDetails`), notifie le premier signaleur (« Signalement contesté ») et ne change ni le statut, ni l'article, ni l'ouverture du dossier. **La console d'administration n'affiche pas encore cette seconde version** : elle n'y rend que le premier récit.

---

### 6.4 Parcours « expédition postale » (désactivé, réactivable) — saisie d'adresse

Écran `/checkout/shipping` (« Paiement »). C'est l'écran le plus riche en règles de gestion. Il enchaîne : adresse → estimation de livraison → récapitulatif des frais → paiement. **Aujourd'hui il est inatteignable** : à l'ouverture, il redirige immédiatement vers `/checkout` et ne rend rien.

**Saisie et validation de l'adresse (spécifique Canada)** :

- Le formulaire est **pré-rempli** avec le nom et l'adresse du profil de l'acheteur, s'ils existent (nom, rue, ville, province, code postal).
- Champs : nom complet, adresse (rue), appartement (optionnel), ville, province, code postal.
- Le **code postal canadien** est validé au format `A1A 1A1` (avec ou sans espace). L'estimation de livraison n'est déclenchée qu'à partir de 6 caractères saisis.
- Au moment de créer la commande, l'adresse est **revalidée strictement côté serveur** (`functions/src/callable/payments/address.ts`) : pays forcé à **CA** (toute autre destination est refusée — « Seules les adresses de livraison canadiennes sont prises en charge »), rue non vide, ville non vide, **province dans les 13 codes officiels** (AB, BC, MB, NB, NL, NS, NT, NU, ON, PE, QC, SK, YT), code postal au bon format. Cette validation a lieu **avant** tout encaissement, pour éviter de facturer une commande qui ne pourrait jamais être expédiée.

---

### 6.5 Estimation des frais de livraison (ShipEngine)

Dès qu'un code postal valide est saisi, l'application interroge le service serveur `getShippingEstimate`, qui consulte **ShipEngine** (comparateur multi-transporteurs, principalement Postes Canada / Intelcom au Canada).

**Comment l'estimation est calculée** :

- **Origine** = code postal du vendeur. Côté client, il est déduit du champ `location` de l'article **uniquement si ce champ ressemble à un code postal** ; sinon un code postal montréalais par défaut est utilisé pour l'estimation indicative.
- **Destination** = adresse de l'acheteur (ville, province, code postal).
- **Colis** = poids et dimensions de l'article (par défaut 0,5 kg et 30×25×10 cm si non renseignés).
- Le serveur renvoie jusqu'à **5 tarifs**, triés du moins cher au plus cher, avec : transporteur, nom du service, **délai estimé en jours ouvrables**, montant et devise.

L'acheteur sélectionne un tarif ; le premier (le moins cher) est présélectionné.

**Cas de repli (« fallback ») quand ShipEngine est injoignable** :

- Le serveur, lui, renvoie une erreur. C'est **l'application** qui affiche alors deux tarifs de secours : **Postes Canada Standard à 8,50 $ (3-5 jours ouvrables)** et **Express à 14,50 $ (1-2 jours ouvrables)**. Ces tarifs portent un identifiant préfixé `fallback_`.
- **Un tarif de repli ne permet pas d'acheter une vraie étiquette.** Le paiement est donc **bloqué** : une alerte « Livraison momentanément indisponible » propose de **réessayer** ou de **proposer une remise en main propre**. Le serveur refuse également, de son côté, toute commande portant un identifiant `fallback_`.

> **Trou constaté** : l'estimation affichée à l'acheteur et le tarif retenu par le serveur ne partent pas toujours de la même origine. Le client se rabat sur un code postal montréalais par défaut dès que la localisation de l'article n'est pas un code postal, tandis que le serveur exige l'**adresse réelle et complète du vendeur** (rue + ville + province + code postal dans son profil) et **refuse la commande** s'il n'en trouve pas. Deux conséquences : un vendeur hors Montréal peut voir un tarif affiché différent du tarif facturé, et un vendeur au profil incomplet voit ses acheteurs bloqués au moment de commander (« Le vendeur n'a pas renseigné d'adresse d'expédition valide »). Le repli documenté sur la localisation de l'article ne fonctionne pas non plus en pratique : le serveur y attend une adresse structurée alors que le champ stocké est une simple chaîne de caractères.

---

### 6.6 Calcul des frais de service (frais de protection acheteur)

Le modèle de monétisation à l'achat est de type **Vinted** : **0 % de commission vendeur, frais 100 % à la charge de l'acheteur**. Le vendeur reçoit **100 % du prix** de son article.

**Formule des frais de protection (« frais de service »)**, dans `functions/src/utils/fees.ts` :

> Frais = max( 2,00 $ ; 5 % du prix de l'article + 1,50 $ )

| Prix article | Frais de protection | Total acheteur (hors livraison) |
|--------------|---------------------|----------------------------------|
| 5 $   | 2,00 $ (minimum) | 7,00 $ |
| 15 $  | 2,25 $ | 17,25 $ |
| 30 $  | 3,00 $ | 33,00 $ |
| 50 $  | 4,00 $ | 54,00 $ |
| 100 $ | 6,50 $ | 106,50 $ |

Ce que ces frais sont censés couvrir, tel que documenté dans le code : protection acheteur (litige, remboursement), traitement du paiement, support client, infrastructure (hébergement, API de livraison).

**Règles de gestion sur les frais** :

- **Ces frais ne s'appliquent qu'à l'expédition.** Une rencontre en main propre a un frais de service de **0 $**, imposé par le serveur — donc, aujourd'hui, aucun acheteur ne paie de frais.
- **Réduction boutique** : si le vendeur a une boutique **approuvée** dont le forfait payant est **encore actif**, les frais **acheteur** sont réduits — forfait *pro* : **−50 %**, forfait *premium* : **−100 %** (frais nuls). La réduction est lue **côté serveur** à partir du forfait du vendeur, jamais fournie par le client, et ne change rien à ce que touche le vendeur (toujours 100 % du prix). Un forfait expiré revient au plein tarif.
- Le montant est affiché côté client en temps réel via le service `getServiceFee`, qui applique déjà la réduction boutique quand l'identifiant d'article lui est transmis ; en cas d'indisponibilité du service, l'app recalcule la formule de base localement (plein tarif).
- **Le calcul final fait foi côté serveur** : à la création de la commande puis à la création de la session de paiement, le serveur recalcule systématiquement les frais pour empêcher toute manipulation côté client.
- Les paramètres (5 %, 1,50 $, minimum 2 $) sont pilotables par variables d'environnement des Cloud Functions.

**Taxes TPS/TVQ** : l'infrastructure existe (TPS 5 %, TVQ 9,975 %) mais elle est **désactivée par défaut** (`TAX_ENABLED=false`). Tant qu'elle l'est, la taxe vaut 0 $, la ligne « TPS + TVQ » est masquée dans le récapitulatif et le total est strictement inchangé. Quand elle sera activée, la taxe portera **uniquement sur les frais de service** (la part de revenu de la plateforme) — le montant de livraison refacturé n'est volontairement pas taxé tant qu'un fiscaliste n'a pas tranché. **Activer ce drapeau est une décision fiscale** (immatriculation TPS et TVQ obligatoire au préalable), pas un réglage technique.

**Total payé par l'acheteur** = prix de l'article + frais de livraison (tarif ShipEngine retenu par le serveur) + frais de protection (+ taxe si un jour activée).

---

### 6.7 Création de la commande : verrouillage de l'article et anti-fraude

Avant tout paiement, l'application crée la commande côté serveur (`createTransaction`, dans `functions/src/callable/payments/checkout.ts`). C'est une opération **atomique** critique qui protège la marketplace :

- **Verrou livraison** : en mode expédition, le serveur commence par vérifier son propre drapeau `SHIPPING_ENABLED`. Aujourd'hui il refuse (« La livraison n'est pas disponible pour le moment. Veuillez utiliser la remise en main propre. »).
- **Verrou anti double-vente** : la vérification « article toujours disponible » et le marquage « vendu » se font dans une **transaction Firestore unique**. Si deux acheteurs visent le même article en même temps, **un seul gagne** ; l'autre reçoit « Cet article a déjà été vendu ».
- **Contrôles** : article existant, non vendu, actif, et acheteur ≠ vendeur.
- **Prix négocié borné à une offre acceptée** : si l'acheteur paie un montant **différent du prix affiché**, le serveur exige l'existence d'une offre **émise par cet acheteur**, dans une conversation portant sur **cet article**, **acceptée**, et pour **exactement ce montant**. Sinon la commande est refusée. Un montant **supérieur** au prix affiché est toujours rejeté.
- **Protection contre un changement de prix en cours de route** : si le vendeur modifie son prix entre l'ouverture du checkout et la validation, l'écart est détecté et la commande refusée (« Le prix de l'article a changé. Veuillez rafraîchir la page et réessayer. ») plutôt que traité comme une négociation.
- **Frais de livraison recalculés côté serveur (jamais le client)** : le serveur re-interroge ShipEngine avec la vraie origine vendeur et la vraie destination, retrouve le tarif correspondant à l'identifiant choisi et **utilise SON montant** comme coût de livraison faisant foi. Si l'identifiant de tarif a expiré ou ne correspond plus, la commande est refusée et l'acheteur est invité à **rafraîchir l'estimation** (« Tarif de livraison expiré »).
- **Compte de paiement vendeur obligatoire (expédition)** : le serveur vérifie que le vendeur a un **compte Stripe Connect existant et actif** avant de verrouiller l'article. Sinon : « Le vendeur n'a pas encore configuré son compte de paiement » ou « Le compte de paiement du vendeur n'est pas encore actif ». Cela évite de bloquer un article pour un vendeur incapable d'être payé.
- **Adresse d'origine vendeur réelle exigée** : aucune adresse « Montréal par défaut » fabriquée côté serveur. Si le vendeur n'a pas d'adresse d'expédition valide, la commande ne peut pas être créée.

La commande est créée en statut `pending_payment` (expédition) ou `meetup_pending` (rencontre). **Ce second cas n'est plus emprunté par l'application** : le parcours rencontre passe désormais exclusivement par l'acceptation d'offre décrite en 6.3.

**Limites de débit (anti-abus)**, par utilisateur authentifié et par minute : création de commande **20**, création de session de paiement **10**, acceptation d'offre de rencontre **20**, estimation de livraison **30**, calcul de frais **60**. Les utilisateurs non authentifiés sont systématiquement rejetés.

---

### 6.8 Le paiement par carte (charge plateforme Stripe)

Une fois la commande `pending_payment` créée, l'application demande au serveur (`createStripeCheckout`) de préparer le paiement, puis présente la **feuille de paiement native Stripe**.

**Architecture du paiement — modèle « rail unique »** :

- Le paiement est une **charge plateforme directe** : la totalité du montant payé par l'acheteur atterrit sur le **compte Stripe de Seconde**. Il n'y a **ni `application_fee_amount`, ni `transfer_data`** — ce n'est donc **pas** un *destination charge*, et Stripe ne verse rien automatiquement au vendeur.
- La plateforme conserve les fonds, qui incluent le coût de l'étiquette d'expédition (qu'elle paie à ShipEngine) et les frais de service.
- **Le vendeur est crédité uniquement dans son porte-monnaie Seconde** (registre interne : montant en attente → montant gelé → solde disponible). Le seul virement de la plateforme vers le compte Stripe du vendeur a lieu **au moment du retrait** demandé par le vendeur (détail en section 12).
- Devise : **CAD**, toujours.
- Le vendeur ne voit **jamais** Stripe : inscription, ajout de compte bancaire et statut se passent dans l'app (comptes Connect **Custom**, white-label assumé). La plateforme porte la conformité, le KYC et les litiges.
- **Idempotence** : la clé de paiement est déterministe (`pi_{identifiant de commande}`). Si l'acheteur réessaie, **aucun second prélèvement** n'est créé — Stripe renvoie le paiement d'origine. Si une session existe déjà, on récupère simplement son secret client auprès de Stripe (jamais stocké en base, c'est une donnée sensible).

**La feuille de paiement** (`components/StripePayment.tsx`) :

- C'est la feuille **native** du SDK Stripe (pas de WebView). Nom marchand affiché : « Seconde ».
- **Google Pay** est activé automatiquement si l'appareil Android l'a configuré. **Apple Pay n'est PAS activé** : il a été retiré du code après un refus App Store (règle 2.1) et sera réintroduit avec la réouverture du paiement in-app. Sur iPhone, l'acheteur paie donc par carte.
- Résultats possibles : **succès**, **échec**, **annulation** par l'utilisateur.

**Gestion des échecs, des annulations et des orphelins** :

- Si la commande a été créée mais que la préparation du paiement échoue, l'app **annule la commande** pour ne pas laisser l'article bloqué.
- **Annulation volontaire** (l'acheteur ferme la feuille) : la commande reste **réservée environ 1 heure**. L'app propose « Reprendre » ou « Annuler la commande » (qui libère l'article immédiatement). Une tâche horaire annule automatiquement les commandes impayées au-delà d'**1 heure** — sauf si Stripe indique que l'argent est déjà en vol, auquel cas elle ne touche à rien.
- **Échec réel** (carte refusée, authentification 3-D Secure abandonnée, réseau) : le message est adapté au motif et l'acheteur peut **réessayer sur la même commande** (pas de nouvelle commande) ou annuler.
- Si le tarif de livraison a expiré côté serveur, message dédié + bouton « Actualiser l'estimation ».
- **Attente de confirmation** : après un paiement réussi, l'app n'affiche pas immédiatement « Paiement confirmé ». Elle interroge la commande pendant **jusqu'à 12 secondes** (« Confirmation du paiement… — Ne fermez pas l'application ») en attendant que le serveur ait enregistré le paiement. Passé ce délai elle affiche quand même la confirmation, le paiement ayant bien abouti côté Stripe.

**Paiement par porte-monnaie (wallet) — option complémentaire** :

- Si l'acheteur a un solde de porte-monnaie Seconde, un interrupteur « Utiliser mon porte-monnaie » apparaît (solde affiché en CAD).
- **Couverture totale** : si le solde couvre tout le total, le paiement se fait **100 % par porte-monnaie** (sans carte) et la commande passe payée immédiatement, sans attendre Stripe.
- **Paiement mixte** : si le solde ne couvre qu'une partie, le porte-monnaie est **débité atomiquement** de sa part, et la carte ne paie que le **reste** (« Reste à payer par carte : … $ »). Deux garde-fous : le reste à payer par carte ne peut pas descendre sous **0,50 $** (minimum Stripe en CAD) — il faut alors payer la totalité au porte-monnaie —, et si la création du paiement Stripe échoue, le **débit du porte-monnaie est automatiquement remboursé** dans la même opération atomique.

---

### 6.9 Confirmation côté serveur : le webhook Stripe

Le paiement n'est **jamais** confirmé par le client. C'est le **webhook Stripe** (`payment_intent.succeeded`, traité dans `functions/src/http/stripe/payment.ts`) qui fait foi :

1. **Contrôle du montant reçu** (en tenant compte de la part porte-monnaie sur un paiement mixte). En cas d'écart : la commande n'est **pas** marquée payée, un incident est journalisé pour rapprochement manuel, et **dans les deux sens** un remboursement automatique est déclenché — trop-perçu comme sous-paiement ; dans le cas du sous-paiement l'article est en plus **remis en vente**.
2. Passe la commande en statut **`paid`** (horodaté) et marque l'article **vendu**.
3. **Crédit vendeur différé pour l'expédition** : le vendeur n'est crédité qu'**après création réussie de l'étiquette** (sinon il serait payé pour un colis qui ne part jamais). Pour tout ce qui n'est pas une expédition, le crédit est immédiat.
4. **Pour une expédition** : achète l'**étiquette réelle** auprès de ShipEngine, récupère le **numéro de suivi**, passe la commande en **`label_created`**. Si l'achat d'étiquette échoue ou si le tarif était un tarif de repli, la commande reste `paid`, est marquée « étiquette à refaire » et confiée à une tâche de rattrapage (`sweepPendingLabels`) — le paiement reste valide, le vendeur n'est pas crédité entre-temps.
5. **Message système dans la conversation** (« Paiement confirmé ! » + numéro de suivi si disponible) et **notification push au vendeur** (« Nouvelle vente ! »).
6. **Enregistrement du revenu plateforme** dans un registre interne (frais de service, taxe éventuelle, coût de livraison encaissé, frais Stripe) pour permettre de calculer la marge nette par commande.
7. **Idempotence** : si la commande est déjà `paid`/`label_created`/`shipped`/`delivered`, le webhook ne fait rien (protection contre les rejeux). Si le paiement arrive sur une commande déjà **annulée**, il déclenche un **remboursement automatique** (l'article a pu être remis en vente entre-temps).

Un échec de paiement (`payment_intent.payment_failed`) n'annule **pas** la commande à la première tentative : Stripe émet cet événement à chaque essai raté alors que l'acheteur peut réessayer dans la même feuille. Seul un paiement **définitivement annulé côté Stripe** provoque l'annulation ; sinon c'est l'expiration à 1 h qui tranche.

> Note iOS/Android sur les notifications : la remise des notifications push dépend des permissions accordées sur l'appareil. Sur iOS notamment, elle est bloquée tant que l'utilisateur n'a pas consenti ; le statut de la commande reste de toute façon consultable dans l'app, qui est la source de vérité.

---

### 6.10 La page de succès

Après une demande de rencontre envoyée **ou** un paiement réussi, l'acheteur arrive sur `/checkout/success` :

- **Titre** : « **Demande envoyée** » (rencontre) ou « **Paiement confirmé** » (expédition). Le titre côté rencontre est volontairement prudent : à ce stade **rien n'est encore confirmé**, le vendeur doit accepter.
- **Message** :
  - Rencontre : « Votre demande de rencontre a été envoyée au vendeur. Vous serez notifié·e dès qu'il l'aura acceptée — convenez ensuite d'un créneau par messagerie. »
  - Expédition : « Le vendeur a été notifié et préparera l'expédition de votre article. Vous recevrez un numéro de suivi. »
- **Carte récapitulative** : article, prix, lieu (rencontre) ; pour l'expédition, détail des **frais de service**, de la **livraison** et du **total payé** ; badge MEETUP ou EXPÉDITION.
- **Boutons** :
  - Rencontre → « CONTACTER LE VENDEUR » (ouvre la conversation).
  - Expédition → « VOIR MA COMMANDE » (ouvre « Mes commandes »).
  - Lien secondaire « Retour à l'accueil ».

---

### 6.11 Reprendre un paiement en attente

Si une commande reste en `pending_payment` (paiement non finalisé), l'acheteur peut la **reprendre** via `/payment/[transactionId]`. Cet écran :

- Recharge la commande et vérifie que l'utilisateur **est bien l'acheteur** et que le statut est encore `pending_payment`. Si la commande a été payée entre-temps, l'écran revient en arrière sans afficher d'erreur trompeuse ; si l'utilisateur n'est pas l'acheteur ou la commande introuvable, une alerte le renvoie.
- Affiche le récapitulatif (article, livraison, **frais de protection Seconde**, éventuellement TPS + TVQ, total à payer), l'**adresse de livraison**, l'option porte-monnaie, et un encart « Protection Seconde » : « Paiement sécurisé par Stripe. Vos données bancaires ne transitent jamais par Seconde. Remboursement si l'article ne correspond pas. »
- Relance la même feuille de paiement Stripe, avec la même attente de confirmation serveur (jusqu'à 12 s).
- Propose un lien **« Annuler la commande »** qui libère l'article immédiatement, sans attendre l'expiration à 1 h.
- Mention légale : « En confirmant, vous acceptez les conditions générales de vente de Seconde ».

C'est aussi le chemin emprunté depuis « Mes commandes » lorsqu'on touche une commande encore en attente de paiement.

---

### 6.12 Suivi des commandes (acheteur et vendeur)

**Les 16 statuts d'une commande** (vocabulaire métier ; mêmes statuts techniques, formulés différemment selon le rôle — source : `features/orders/lib/transactionStatusMeta.ts`) :

| Statut | Côté acheteur | Côté vendeur |
|--------|---------------|--------------|
| `pending_payment` | Paiement en attente | Paiement en attente |
| `meetup_pending` | Rencontre à confirmer | Rencontre à confirmer |
| `meetup_confirmed` | Rencontre confirmée | Rencontre confirmée |
| `meetup_completed` | Réglée en main propre | Réglée en main propre |
| `paid` | Payée — en préparation | **À expédier** |
| `label_created` | Étiquette prête — bientôt en route | Étiquette créée — déposez le colis |
| `shipped` | En cours d'acheminement | Colis expédié |
| `delivered` | Livrée (fonds protégés jusqu'au …) | Livrée (fonds disponibles le …) |
| `completed` | Vente finalisée | Vente finalisée (montant dans le porte-monnaie) |
| `return_requested` | Retour demandé | Retour en cours |
| `delivery_failed` | Problème de livraison (paiement gelé, protégé) | Problème de livraison (litige, fonds gelés) |
| `lost` | Colis égaré (paiement gelé) | Colis égaré (fonds gelés) |
| `disputed` | Litige en cours | Litige en cours |
| `refund_in_progress` | Remboursement en cours | Remboursement en cours |
| `refunded` | Remboursée | Remboursée |
| `cancelled` | Annulée | Annulée |

Un statut inconnu de l'application (ajouté côté serveur avant une mise à jour de l'app) s'affiche « Statut en cours » plutôt que de faire planter les listes.

**Côté acheteur** — écran « Mes commandes » (`app/my-orders.tsx`) :

- Liste de tous ses achats (image, titre, **total payé**, statut, date).
- Toucher une commande : si elle est en `pending_payment`, on va à l'écran de paiement ; sinon on ouvre la **conversation** liée (suivi du colis, recours, etc.), à défaut la fiche article.
- Possibilité de **laisser un avis** lorsque la commande est `delivered`, `completed` ou `meetup_completed`, qu'aucun avis n'a encore été déposé (badge « Avis laissé » sinon) et que **la contrepartie n'a pas supprimé son compte** — le serveur refuse alors l'avis (« Cette personne a supprimé son compte : aucun avis ne peut lui être laissé. »), qui ne serait de toute façon agrégé sur aucun profil.

**Côté vendeur** — écran « Mes ventes » (`app/my-sales.tsx`) :

- Même présentation, filtrée sur les ventes, avec les libellés **côté vendeur** (« À expédier », « Étiquette créée — déposez le colis », etc.).
- Le vendeur y suit l'avancement, accède à la conversation et peut aussi laisser un avis sur l'acheteur après finalisation.

**Protection des fonds (expédition uniquement)** : après livraison confirmée par le transporteur, les fonds vendeur restent **gelés 7 jours** (fenêtre de litige). Pendant ce délai, l'acheteur peut signaler un problème ; ce n'est qu'au terme du délai que la vente se **finalise** et que le montant devient disponible dans le porte-monnaie du vendeur. Une commande payée mais **jamais expédiée sous 7 jours** est annulée et remboursée automatiquement. Tant qu'une commande est active (en cours, livrée mais fonds gelés, litige, retour, remboursement en cours), elle **bloque la suppression du compte** — à une exception près : une **rencontre gelée par un signalement d'absence**, et le litige de non-présentation qui l'accompagne, ne bloquent plus rien. Aucun argent n'ayant transité, il n'y avait rien à protéger, alors qu'un signalement à un clic suffisait à séquestrer indéfiniment le droit à l'effacement de la personne visée.

**Rappel** : rien de tout ce bloc « protection des fonds » ne s'applique aujourd'hui, puisque le seul parcours actif (rencontre) ne fait transiter aucun argent par la plateforme.

---

### 6.13 Spécificités Canada & contraintes plateforme — synthèse

- **Devise** : exclusivement **CAD**, partout (affichage, Stripe, comptes bancaires Connect).
- **Adresses** : seules les adresses **canadiennes** sont acceptées à la livraison ; province parmi les **13 codes** officiels ; code postal au format **A1A 1A1** (validé côté serveur avant tout encaissement).
- **Transporteurs** : Postes Canada / Intelcom via **ShipEngine**, délais exprimés en **jours ouvrables**.
- **Comptes vendeurs** : **Stripe Connect Custom** (white-label ; banque canadienne via numéro de transit à 5 chiffres + institution à 3 chiffres + numéro de compte). Le vendeur doit avoir **18 ans révolus** — l'âge est recalculé au jour près côté serveur — et son compte doit être **actif** pour vendre en expédition.
- **Taxes** : TPS/TVQ prêtes mais **désactivées** ; leur activation suppose une immatriculation TPS et TVQ préalable (voir 6.6).
- **iOS vs Android** :
  - **Google Pay** (Android) est proposé automatiquement dans la feuille de paiement Stripe s'il est configuré sur l'appareil. **Apple Pay n'est pas actif** (retiré après un refus App Store) : sur iPhone, paiement par carte.
  - Les **notifications push** (« vendeur notifié », « colis en route ») dépendent des permissions de l'appareil ; iOS exige un consentement explicite. Le suivi reste toujours disponible dans l'app, qui fait foi.
- **Conformité Loi 25 (Québec/Canada)** : les données bancaires de l'acheteur **ne transitent jamais** par Second (traitées par Stripe), et le secret client du paiement n'est jamais stocké en base — choix qui limite l'exposition de données sensibles.
- **Sécurité financière** : aucun statut sensible (`paid`, `label_created`, `delivered`) ni mutation financière n'est écrit par le client ; tout passe par des fonctions serveur avec transactions atomiques, webhooks signés, limites de débit et clés d'idempotence déterministes.
