## 06. Achat & paiement

Cette section décrit, pas à pas, ce qui se passe lorsqu'un acheteur veut acquérir un article sur Second : depuis le bouton « Acheter » sur la fiche article jusqu'au paiement par carte, la confirmation, et le suivi de la commande côté acheteur comme côté vendeur. Tout est décrit tel que le code le fait réellement aujourd'hui, marché canadien et devise CAD comprise.

---

### 6.0 État actuel important : la livraison est désactivée

Avant tout, un fait structurant pour comprendre le parcours réel aujourd'hui :

- **L'expédition postale est temporairement désactivée** par un drapeau de fonctionnalité unique (`SHIPPING_ENABLED = false`). Tant que ce drapeau est à `false` :
  - Le seul mode de transaction proposé est la **remise en main propre (meetup)**, y compris pour des articles plus anciens qui auraient été créés en mode « expédition ».
  - L'écran de checkout force automatiquement le mode « main propre ».
  - L'écran de paiement par expédition (`/checkout/shipping`) redirige immédiatement vers le checkout si on tente d'y accéder (garde-fou contre un lien profond).
- **Conséquence métier directe** : dans la version actuellement en service, **aucun paiement par carte n'est encaissé via le checkout**. La remise en main propre se règle **hors application**, directement entre acheteur et vendeur (cash, virement, etc.). Aucun frais de plateforme n'est prélevé sur un meetup.
- Tout le moteur de paiement par carte (Stripe), d'estimation de livraison (ShipEngine) et de calcul de frais reste **présent et fonctionnel dans le code** ; il se réactive en repassant le drapeau à `true`, sans autre changement. La suite de cette section documente donc **les deux réalités** : ce qui tourne aujourd'hui (meetup) et le parcours d'expédition payée qui se rallumera.

---

### 6.1 Le point de départ : la fiche article et ses boutons d'action

Sur chaque fiche article (`/article/[id]`), une barre d'action fixe en bas de l'écran propose, selon le contexte, les actions suivantes :

| Situation | Ce que voit l'utilisateur |
|-----------|---------------------------|
| Article disponible, vu par un autre que le vendeur | Deux boutons : **OFFRE** (négocier un prix) et **ACHETER · {prix}** |
| Article déjà vendu | Bandeau « Article vendu » (aucune action d'achat) |
| Article de l'utilisateur lui-même | Bandeau « C'est votre article » |
| Contexte SwapZone (échange) | Bouton « PROPOSER UN ÉCHANGE » |

**Règles de gestion sur le bouton Acheter** :

- Si l'article est déjà vendu, une alerte « Article vendu » s'affiche.
- Si l'utilisateur est le vendeur, une alerte bloque l'achat (« Vous ne pouvez pas acheter votre propre article »).
- Si l'utilisateur n'est **pas connecté**, une feuille d'authentification s'ouvre (message contextuel « connexion requise pour acheter »). L'achat ne reprend qu'une fois connecté.
- Sinon, un retour haptique se déclenche et l'utilisateur est dirigé vers l'écran de checkout avec l'identifiant de l'article.

Le bouton **OFFRE** ouvre une fenêtre de négociation : l'acheteur propose un montant, qui part dans la messagerie. Un prix négocié n'est utilisable au paiement **que** s'il correspond à une offre que le vendeur a explicitement acceptée (voir 6.6).

---

### 6.2 Le checkout : choix du mode de livraison

L'écran `/checkout` (titre « Commander ») affiche un récapitulatif de l'article (image, marque, titre, prix, état) puis les **modes de livraison** disponibles.

Deux modes possibles selon les caractéristiques de l'article :

- **Remise en main propre** — Gratuit. « Rencontrez le vendeur dans un lieu public à Montréal ». Encart : « Paiement en main propre — Le paiement se fait directement lors du meetup. Aucun frais de plateforme. »
- **Expédition postale** (uniquement si la livraison est réactivée et que l'article l'autorise) — « À partir de 8,50 $ », livraison « en 3-5 jours ouvrables ». Encart : « Paiement sécurisé — Votre paiement est protégé. Le vendeur est payé après la livraison confirmée. »

**Règles d'affichage et de sélection automatique** :

- Si la livraison est désactivée, le mode est forcé à **main propre** pour tous les articles.
- Si un seul mode est compatible avec l'article, il est **présélectionné** automatiquement.
- Les gardes-fous de cet écran : article introuvable, article déjà vendu, ou utilisateur = vendeur affichent un écran d'arrêt avec bouton « Retour ».

Le bouton **CONTINUER** route vers `/checkout/meetup` (main propre) ou `/checkout/shipping` (expédition).

---

### 6.3 Parcours « remise en main propre » (le parcours actif aujourd'hui)

Écran `/checkout/meetup` (« Lieu de rencontre ») :

1. **Choix du lieu** : l'acheteur sélectionne soit l'un des **lieux suggérés par le vendeur** (lieux publics avec quartier), soit l'option **« À convenir par messagerie »** (toujours disponible). Le premier lieu suggéré est présélectionné ; à défaut, l'option messagerie l'est.
2. **Prix** : le prix affiché est le prix de l'article, ou un **prix négocié** s'il a été transmis (badge « PRIX NÉGOCIÉ », prix barré à côté).
3. **Confirmation** : à l'appui sur « CONFIRMER LE MEETUP » :
   - Vérification que les deux utilisateurs ne se sont pas mutuellement bloqués (sinon « Action impossible »).
   - Création (ou récupération) de la **conversation** entre acheteur et vendeur pour cet article.
   - Création d'une **transaction de type meetup** côté serveur, en statut `meetup_pending`.
   - Envoi d'une **offre de meetup structurée** dans la messagerie (bulle interactive avec montant et lieu) : « Demande de meetup pour "…" ».
   - Redirection vers la page de succès.

**Règles de gestion meetup** :

- Un meetup n'a **aucun frais de plateforme** et **aucun frais de livraison** : le serveur force ces deux montants à zéro. Le « total » de la transaction = prix de l'article.
- Le règlement se fait **hors application** ; le montant **n'est pas crédité** sur le porte-monnaie Second de l'acheteur ni du vendeur.
- La date et l'heure se conviennent ensuite par messagerie.

---

### 6.4 Parcours « expédition postale » (réactivable) — saisie d'adresse

Écran `/checkout/shipping` (« Paiement »). C'est l'écran le plus riche en règles de gestion. Il enchaîne : adresse → estimation de livraison → récapitulatif des frais → paiement.

**Saisie et validation de l'adresse (spécifique Canada)** :

- Le formulaire est **pré-rempli** avec le nom et l'adresse du profil de l'acheteur, s'ils existent (nom, rue, ville, province, code postal).
- Champs : nom complet, adresse (rue), appartement (optionnel), ville, province, code postal.
- Le **code postal canadien** est validé au format `A1A 1A1` (avec ou sans espace). L'estimation de livraison n'est déclenchée qu'à partir de 6 caractères.
- Au moment de payer, l'adresse est **revalidée strictement côté serveur** : pays forcé à **CA** (toute autre destination est refusée — « Seules les adresses de livraison canadiennes sont prises en charge »), rue non vide, ville non vide, **province dans les 13 codes officiels** (AB, BC, MB, NB, NL, NS, NT, NU, ON, PE, QC, SK, YT), code postal au bon format. Cette validation a lieu **avant** tout encaissement, pour éviter de facturer une commande qui ne pourrait jamais être expédiée.

---

### 6.5 Estimation des frais de livraison (ShipEngine)

Dès qu'un code postal valide est saisi, l'application interroge le service serveur `getShippingEstimate`, qui consulte **ShipEngine** (comparateur multi-transporteurs, principalement Postes Canada / Intelcom au Canada).

**Comment l'estimation est calculée** :

- **Origine** = code postal du vendeur (déduit de la localisation de l'article ; à défaut un code postal montréalais par défaut côté client pour l'estimation indicative).
- **Destination** = adresse de l'acheteur (ville, province, code postal).
- **Colis** = poids et dimensions de l'article (par défaut 0,5 kg et 30×25×10 cm si non renseignés).
- Le serveur renvoie jusqu'à **5 tarifs**, triés du moins cher au plus cher, avec : transporteur, nom du service, **délai estimé en jours ouvrables**, montant et devise.

L'acheteur sélectionne un tarif ; le premier (le moins cher) est présélectionné.

**Cas de repli (« fallback ») quand ShipEngine est injoignable** :

- L'application affiche deux tarifs de secours : **Postes Canada Standard à 8,50 $ (3-5 jours)** et **Express à 14,50 $ (1-2 jours)**. Ces tarifs portent un identifiant préfixé `fallback_`.
- **Un tarif de repli ne permet pas d'acheter une vraie étiquette.** Le paiement par carte est donc **bloqué** : une alerte « Livraison momentanément indisponible » propose de réessayer ou de basculer sur une remise en main propre.

---

### 6.6 Calcul des frais de service (frais de protection acheteur)

Le modèle de monétisation à l'achat est de type **Vinted** : **0 % de commission vendeur, frais 100 % à la charge de l'acheteur**. Le vendeur reçoit **100 % du prix** de son article.

**Formule des frais de protection (« frais de service ») :**

> Frais = max( 2,00 $ ; 5 % du prix de l'article + 1,50 $ )

| Prix article | Frais de protection | Total acheteur (hors livraison) |
|--------------|---------------------|----------------------------------|
| 5 $   | 2,00 $ (minimum) | 7,00 $ |
| 15 $  | 2,25 $ | 17,25 $ |
| 30 $  | 3,00 $ | 33,00 $ |
| 50 $  | 4,00 $ | 54,00 $ |
| 100 $ | 6,50 $ | 106,50 $ |

Ce que couvrent ces frais (selon le code) : protection acheteur (litige, remboursement), paiement sécurisé (traitement Stripe), support client, infrastructure (hébergement, API de livraison).

**Règles de gestion sur les frais** :

- Le montant est affiché côté client en temps réel via le service `getServiceFee` ; en cas d'indisponibilité, l'app recalcule la même formule localement (cohérence garantie).
- **Le calcul final fait foi côté serveur** : au moment de créer la session de paiement, le serveur recalcule systématiquement les frais (`calculateFees`) pour empêcher toute manipulation côté client.
- Les paramètres (5 %, 1,50 $, minimum 2 $) sont configurables par variables d'environnement / Remote Config.

**Total payé par l'acheteur** = prix de l'article + frais de livraison (tarif ShipEngine sélectionné) + frais de protection.

---

### 6.7 Création de la commande : verrouillage de l'article et anti-fraude

Avant tout paiement, l'application crée la transaction côté serveur (`createTransaction`). C'est une opération **atomique** critique qui protège la marketplace :

- **Verrou anti double-vente** : la vérification « article toujours disponible » et le marquage `isSold = true` se font dans une **transaction Firestore unique**. Si deux acheteurs visent le même article en même temps, **un seul gagne** ; l'autre reçoit « Cet article a déjà été vendu ».
- **Contrôles** : article existant, non vendu, actif, et acheteur ≠ vendeur.
- **Prix négocié borné à une offre acceptée** : si l'acheteur paie un montant **différent du prix affiché**, le serveur exige l'existence d'une **offre acceptée** par le vendeur, dans la conversation de cet article, émise par cet acheteur, pour exactement ce montant. Sinon la commande est refusée. Un montant **supérieur** au prix affiché est toujours rejeté (protection contre la surfacturation).
- **Frais de livraison recalculés côté serveur (jamais le client)** : le serveur re-interroge ShipEngine avec la vraie origine vendeur et la vraie destination, retrouve le tarif correspondant à l'identifiant choisi et **utilise SON montant** comme coût de livraison faisant foi. Si l'identifiant de tarif a expiré ou ne correspond plus, la commande est refusée et l'acheteur est invité à **rafraîchir l'estimation** (« Tarif de livraison expiré »).
- **Compte de paiement vendeur obligatoire (expédition)** : pour une expédition, le serveur vérifie que le vendeur a un **compte Stripe Connect actif** (`stripeChargesEnabled = true`) avant de verrouiller l'article. Sinon : « Le vendeur n'a pas encore configuré son compte de paiement. » Cela évite de bloquer un article pour un vendeur incapable d'être payé.
- **Adresse d'origine vendeur réelle exigée** : aucune adresse « Montréal par défaut » fabriquée côté serveur. Si le vendeur n'a pas d'adresse d'expédition valide, la commande ne peut pas être créée.

La transaction est créée en statut `pending_payment` (expédition) ou `meetup_pending` (meetup).

**Limite de débit (anti-abus)** : `createTransaction` est plafonné à 20 appels/minute par utilisateur authentifié ; la création de session de paiement à 10/minute. Les utilisateurs non authentifiés sont rejetés.

---

### 6.8 Le paiement par carte (Stripe Connect Custom + destination charge)

Une fois la transaction `pending_payment` créée, l'application demande au serveur (`createStripeCheckout`) de préparer le paiement, puis présente la **feuille de paiement native Stripe**.

**Architecture du paiement (modèle white-label assumé)** :

- Le paiement est un **« destination charge »** Stripe : l'acheteur paie le **total** ; Stripe verse automatiquement la part vendeur sur son **compte Connect Custom**, et la plateforme prélève sa commission via `application_fee_amount` (= les frais de protection).
- Devise : **CAD** (toujours).
- Le vendeur ne voit **jamais** Stripe : tout (inscription, ajout de compte bancaire, statut) se passe dans l'app. La plateforme porte la conformité, le KYC et les litiges.
- **Idempotence** : la clé de paiement est déterministe (`pi_{transactionId}`). Si l'acheteur réessaie, **aucun second prélèvement** n'est créé — Stripe renvoie le paiement d'origine. Si une session existe déjà, on récupère simplement son `clientSecret` (jamais stocké en base, c'est une donnée sensible).

**La feuille de paiement (composant `StripePayment`)** :

- C'est la feuille **native** du SDK Stripe (pas de WebView). Nom marchand affiché : « Seconde ».
- **Apple Pay** et **Google Pay** sont activés automatiquement si l'appareil les a configurés (`merchantCountryCode: 'CA'`). C'est la principale différence iOS/Android visible à l'achat : Apple Pay sur iPhone, Google Pay sur Android — sinon, paiement par carte classique dans les deux cas.
- Résultats possibles : **succès**, **échec** (message d'erreur + proposition de réessayer ou d'annuler), **annulation** par l'utilisateur (la feuille se ferme, rien ne se passe).

**Gestion des échecs et orphelins** :

- Si la transaction a été créée mais que la préparation du paiement échoue, l'app **annule la transaction** pour ne pas laisser l'article bloqué en `pending_payment`.
- En cas d'échec de la feuille de paiement, l'acheteur peut **réessayer** (nouvelle session) ou **annuler** (la transaction passe `cancelled`, l'article est relibéré).
- Si le tarif de livraison a expiré côté serveur au moment de payer, message dédié + bouton « Actualiser l'estimation ».

**Paiement par porte-monnaie (wallet) — option complémentaire** :

- Si l'acheteur a un solde de porte-monnaie Second, un interrupteur « Utiliser mon porte-monnaie » apparaît (solde affiché en CAD).
- **Couverture totale** : si le solde couvre tout le total, le paiement se fait **100 % par porte-monnaie** (sans carte), via `payWithWallet`.
- **Paiement mixte** : si le solde ne couvre qu'une partie, le porte-monnaie est **débité atomiquement** de sa part, et la carte ne paie que le **reste** (« Reste à payer par carte : … $ »). Dans ce cas, la plateforme encaisse la part carte et créditera le vendeur après livraison. Si la création du paiement Stripe échoue, le **débit du porte-monnaie est automatiquement remboursé** (écriture inverse au registre).

---

### 6.9 Confirmation côté serveur : le webhook Stripe

Le paiement n'est **jamais** confirmé par le client. C'est le **webhook Stripe** (`payment_intent.succeeded`) qui fait foi côté serveur :

1. Vérifie la signature et le **montant reçu** (contrôle anti-divergence ; un trop-perçu acheteur déclenche un remboursement automatique).
2. Passe la transaction en statut **`paid`** (`paidAt` horodaté) et marque l'article **vendu** (`isSold`, `soldAt`).
3. **Pour une expédition** : achète l'**étiquette d'expédition réelle** auprès de ShipEngine, récupère le **numéro de suivi**, et passe la transaction en **`label_created`**. Le crédit au vendeur n'a lieu **qu'après** création réussie de l'étiquette (sinon le vendeur serait payé pour un colis qui ne part jamais ; un mécanisme de rattrapage `sweepPendingLabels` gère les échecs).
4. **Notifie le vendeur** (notification push) avec le numéro de suivi.
5. **Idempotence** : si la transaction est déjà `paid`/`label_created`/`shipped`/`delivered`, le webhook ne fait rien (protection contre les rejeux). Si le paiement arrive sur une commande déjà **annulée/expirée**, il déclenche un **remboursement automatique** (l'article a pu être remis en vente entre-temps).

> Note iOS/Android sur les notifications : les notifications push dépendent des permissions accordées sur l'appareil et de la configuration des jetons. Sur iOS notamment, la livraison push peut être limitée tant que les permissions ne sont pas accordées ; le statut de la commande reste de toute façon consultable dans l'app, qui est la source de vérité.

---

### 6.10 La page de succès

Après un meetup confirmé **ou** un paiement réussi, l'acheteur arrive sur `/checkout/success` :

- **Titre** : « Meetup confirmé » ou « Paiement confirmé ».
- **Message** : pour le meetup, « Le vendeur a été notifié. Convenez d'un créneau par messagerie » ; pour l'expédition, « Le vendeur préparera l'expédition. Vous recevrez un numéro de suivi. »
- **Carte récapitulative** : article, prix ; pour l'expédition, détail des **frais de service**, de la **livraison** et du **total payé** ; badge MEETUP ou EXPÉDITION.
- **Boutons** :
  - Meetup → « CONTACTER LE VENDEUR » (ouvre la conversation).
  - Expédition → « VOIR MA COMMANDE » (ouvre « Mes commandes »).
  - Lien secondaire « Retour à l'accueil ».

---

### 6.11 Reprendre un paiement en attente

Si une commande reste en `pending_payment` (paiement non finalisé), l'acheteur peut la **reprendre** via `/payment/[transactionId]`. Cet écran :

- Recharge la transaction et vérifie que l'utilisateur **est bien l'acheteur** et que le statut est encore `pending_payment` (sinon retour avec message).
- Affiche le récapitulatif (article, livraison, **frais de protection Seconde**, total), l'**adresse de livraison**, l'option porte-monnaie, et un encart de réassurance : « Paiement sécurisé par Stripe. Vos données bancaires ne transitent jamais par Seconde. »
- Relance la même feuille de paiement Stripe. Mention légale : « En confirmant, vous acceptez les conditions générales de vente de Seconde. »

C'est aussi le chemin emprunté depuis « Mes commandes » lorsqu'on touche une commande encore en attente de paiement.

---

### 6.12 Suivi des commandes (acheteur et vendeur)

**Statuts d'une transaction** (vocabulaire métier, mêmes statuts techniques mais formulés différemment selon le rôle) :

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

**Côté acheteur** — écran « Mes commandes » (`/my-orders`) :

- Liste de tous ses achats (image, titre, **total payé**, statut, date).
- Toucher une commande : si elle est en `pending_payment`, on va à l'écran de paiement ; sinon on ouvre la **conversation** liée (suivi du colis, recours, etc.), à défaut la fiche article.
- Possibilité de **laisser un avis** lorsqu'une commande est `delivered` ou `meetup_completed` et qu'aucun avis n'a encore été déposé (badge « Avis laissé » sinon).

**Côté vendeur** — écran « Mes ventes » (`/my-sales`) :

- Même présentation, filtrée sur les ventes (`sellerId` = utilisateur), avec les libellés **côté vendeur** (« À expédier », « Étiquette créée — déposez le colis », etc.).
- Le vendeur y suit l'avancement, accède à la conversation et peut aussi laisser un avis sur l'acheteur après finalisation.

**Protection des fonds (expédition)** : après livraison confirmée, les fonds vendeur restent **gelés pendant 7 jours** (fenêtre de litige). Pendant ce délai, l'acheteur peut signaler un problème ; ce n'est qu'au terme du délai que la vente se **finalise** et que le montant devient disponible dans le porte-monnaie du vendeur. Tant qu'une commande est active (en cours, livrée mais fonds gelés, litige, retour, remboursement en cours), elle **bloque la suppression du compte**.

---

### 6.13 Spécificités Canada & contraintes plateforme — synthèse

- **Devise** : exclusivement **CAD**, partout (affichage, Stripe, comptes bancaires Connect).
- **Adresses** : seules les adresses **canadiennes** sont acceptées à la livraison ; province parmi les **13 codes** officiels ; code postal au format **A1A 1A1** (validé côté serveur).
- **Transporteurs** : Postes Canada / Intelcom via **ShipEngine**, délais exprimés en **jours ouvrables**.
- **Comptes vendeurs** : **Stripe Connect Custom** (white-label, banque canadienne via numéro de transit 5 chiffres + institution 3 chiffres + numéro de compte). Le vendeur doit être **18 ans minimum** et son compte **actif** pour vendre en expédition.
- **iOS vs Android** :
  - **Apple Pay** (iOS) / **Google Pay** (Android) sont proposés automatiquement dans la feuille de paiement Stripe si configurés sur l'appareil ; sinon paiement carte standard identique sur les deux plateformes.
  - Les **notifications push** (ex. « vendeur notifié », « colis en route ») dépendent des permissions de l'appareil ; iOS exige un consentement explicite. Le suivi reste toujours disponible dans l'app, qui fait foi.
- **Conformité Loi 25 (Québec/Canada)** : les données bancaires de l'acheteur **ne transitent jamais** par Second (traitées par Stripe), et le `clientSecret` du paiement n'est jamais stocké en base — choix qui limite l'exposition de données sensibles.
- **Sécurité financière** : aucun statut sensible (`paid`, `shipped`, `delivered`) ni mutation financière n'est écrit par le client ; tout passe par des fonctions serveur avec transactions atomiques et webhooks signés.
