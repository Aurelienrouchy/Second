## 16. Boutiques payantes & administration

Cette section décrit deux briques liées de Second : (1) le système de **boutiques** — fiches d'enseignes physiques avec vitrine publique, modèle de monétisation par abonnement payant à 3 forfaits ; (2) l'**espace d'administration** interne qui valide les boutiques et traite les signalements (modération).

Point d'attention important, vérifié dans le code : le **modèle « boutique payante » est une direction produit décidée mais pas encore implémentée**. Ce qui existe et fonctionne réellement aujourd'hui, c'est : le modèle de données d'une boutique, sa vitrine publique `/shop/[id]`, et toute la chaîne de modération admin (validation / rejet / suspension via Cloud Functions). En revanche, le parcours de **création d'une boutique par un commerçant n'est branché à aucun écran** (la fonction `createShop` existe dans le code mais n'est appelée nulle part dans l'app), et **aucun champ de forfait/abonnement n'existe encore** dans les données. Cette section distingue clairement le « livré » de la « cible produit ».

---

### 16.1 Qu'est-ce qu'une « boutique » dans Second

Une boutique (collection de données `shops`) représente une **enseigne physique** de seconde main : friperie, dépôt-vente, boutique vintage, concept store, etc. Elle se distingue d'un simple vendeur particulier par une fiche riche, géolocalisée, avec vitrine publique.

Les **types de boutique** disponibles (20 catégories) couvrent l'écosystème seconde main :

| Catégorie (valeur) | Libellé affiché |
|---|---|
| friperie | Friperie |
| depot-vente | Dépôt-vente |
| vintage | Vintage |
| luxe-seconde-main | Luxe & Seconde main |
| streetwear | Streetwear |
| concept-store | Concept store |
| createurs-designer | Créateurs & Designer |
| workwear-militaire | Workwear & Militaire |
| boutique-enfant | Boutique enfant |
| chaussures-sneakers | Chaussures & Sneakers |
| accessoires-maroquinerie | Accessoires & Maroquinerie |
| librairie-occasion | Librairie d'occasion |
| jouets-puericulture | Jouets & Puériculture |
| hightech-electronique | High-tech & Électronique |
| maison-deco | Maison & Déco |
| sport-outdoor | Sport & Outdoor |
| vinyles-musique | Vinyles & Musique |
| beaute-cosmetiques | Beauté & Cosmétiques |
| ressourcerie | Ressourcerie |
| autre | Autre |

**Informations portées par une fiche boutique :**

- Identité : nom, description, type, logo, galerie de photos.
- Contact : téléphone, e-mail, site web (optionnel), réseaux sociaux (Instagram, Facebook — optionnels).
- Localisation : adresse postale complète (rue, ville, code postal, pays) + coordonnées GPS (latitude/longitude) et un **geohash** calculé automatiquement, qui permet de retrouver les boutiques « à proximité » d'un point donné.
- Horaires d'ouverture (jour par jour ; un jour sans horaire = affiché « Fermé »).
- Informations légales (optionnelles selon le palier — voir 16.5) : numéro d'entreprise (**NEQ** au Québec, ou BN/NE fédéral), numéro de **TPS**, numéro de **TVQ** (Québec), et coordonnées bancaires (transit, institution, compte).
- Indicateurs : note moyenne, nombre d'avis, nombre d'articles en vente.
- Cycle de vie : statut de validation, détails de vérification (qui a validé, quand, motif éventuel), dates de création et de mise à jour.

**Spécificité Canada** : les champs légaux sont calqués sur le contexte canadien/québécois (NEQ, TPS, TVQ, format bancaire transit/institution/compte). Le pays figure dans l'adresse et les dates sont affichées au format canadien-français.

---

### 16.2 Statuts d'une boutique (cycle de vie)

Une boutique passe par quatre états, qui pilotent sa visibilité et son traitement :

| Statut | Signification | Visible publiquement ? |
|---|---|---|
| `pending` (En attente) | Vient d'être créée, en file de validation admin. | Non listée dans les recherches « à proximité ». |
| `approved` (Approuvée) | Validée par un admin → boutique « vérifiée ». | Oui, apparaît dans les boutiques à proximité ; badge « Boutique vérifiée ». |
| `rejected` (Rejetée) | Refusée par un admin, avec un motif. | Non. |
| `suspended` (Suspendue) | Mise hors-ligne par un admin après coup, avec un motif. | Non. |

**Règles de gestion clés :**

- Une boutique **naît toujours en `pending`** — elle ne peut pas se créer déjà « approuvée ». C'est une règle de sécurité (voir 16.7).
- Seules les boutiques **`approved`** remontent dans la recherche géolocalisée (« boutiques près de moi ») et affichent le badge de confiance « Boutique vérifiée » sur leur vitrine.
- Les transitions de statut (approuver, rejeter, suspendre) sont **réservées aux administrateurs** et passent obligatoirement par le serveur (Cloud Functions). Le propriétaire d'une boutique ne peut jamais changer lui-même son statut.
- Les changements de statut sont **idempotents** : redemander un statut déjà en place ne fait rien (utile si deux admins agissent en parallèle).
- Il **n'existe pas de suppression** d'une boutique côté utilisateur ni admin via l'interface : on suspend (le « hard delete » est techniquement possible mais hors interface, réservé à un script serveur).

---

### 16.3 La vitrine publique d'une boutique — écran `/shop/[id]`

C'est la page que voit n'importe quel utilisateur (même non connecté — la lecture des boutiques est publique) lorsqu'il ouvre une boutique.

**Contenu et parcours, de haut en bas :**

1. **Galerie photos** : une grande image principale + une bande de vignettes cliquables pour changer la photo affichée.
2. **En-tête** : logo + nom de la boutique. Si la boutique est `approved`, un badge vert **« Boutique vérifiée »** s'affiche (signal de confiance).
3. **Badge de type** (ex. « Friperie », « Dépôt-vente »).
4. **Description** libre.
5. **Actions de contact** (boutons) :
   - **Appeler** → ouvre l'application téléphone avec le numéro.
   - **Email** → ouvre le client mail.
   - **Site web** (affiché seulement si renseigné) → ouvre le navigateur (préfixe `https://` ajouté au besoin).
6. **Adresse** complète (rue, code postal, ville, pays).
7. **Carte** : une mini-carte Google Maps avec un repère à l'emplacement exact de la boutique.
8. **Horaires d'ouverture** : tableau Lundi → Dimanche, « Fermé » pour les jours non renseignés.
9. **Réseaux sociaux** (si renseignés) : liens Instagram / Facebook qui ouvrent le profil correspondant.
10. **Articles en vente** : si la boutique a au moins un article actif, un bouton « Voir tous les articles » renvoie vers la recherche filtrée sur cette boutique (`/search?shopId=…`).

Pendant le chargement, un squelette d'interface (placeholders gris) est affiché. Si l'identifiant ne correspond à aucune boutique, un message **« Boutique introuvable »** s'affiche.

**Spécificité plateforme (iOS / Android)** : la carte utilise explicitement le fournisseur **Google Maps** (`PROVIDER_GOOGLE`) sur les deux plateformes. Sur iOS cela nécessite une clé d'API Google Maps correctement configurée dans le build ; sans elle, la carte peut apparaître vide alors qu'Android affiche Google Maps nativement. Les boutons « Appeler »/« Email » dépendent de la présence d'une app téléphone/mail sur l'appareil.

---

### 16.4 Articles rattachés à une boutique

Une boutique peut exposer un catalogue d'articles. La fiche affiche un compteur d'articles et un lien vers la liste. Côté données, la récupération des articles d'une boutique filtre sur trois conditions : appartenance à la boutique, article **actif** et **non vendu** — de sorte que seuls les articles réellement disponibles sont présentés.

**Limite connue, vérifiée dans le code** : le lien entre un article et une boutique repose sur un identifiant de boutique porté par l'article. Or le modèle de données « Article » ne possède pas encore formellement ce champ de rattachement. Concrètement, le compteur et la liste d'articles d'une boutique ne sont pleinement opérationnels qu'une fois ce rattachement renseigné — ce qui est précisément l'un des prérequis techniques du modèle payant (voir 16.5). Aujourd'hui, en l'absence de parcours de création de boutique branché, ce catalogue reste théorique.

---

### 16.5 Modèle de monétisation : boutiques payantes à 3 forfaits (cible produit)

> **Statut : décidé, non implémenté.** Cette sous-section décrit l'intention produit actée. Aucun champ d'abonnement/forfait n'existe encore dans les données, aucun paiement d'abonnement n'est branché, et la création de boutique n'est pas accessible dans l'app.

**Principe de monétisation — le point différenciant.** Aujourd'hui, le vendeur touche **100 % du prix de vente (0 % de commission vendeur)**, à la manière de Vinted. C'est l'**acheteur** qui paie des **frais de protection**, calculés côté serveur : **5 % du prix de l'article + 1,50 $ fixe, avec un minimum de 2,00 $** (en CAD). Exemple : un article à 30 $ → frais acheteur de 3,00 $ ; un article à 100 $ → 6,50 $.

Le levier des boutiques payantes est donc **inhabituel** : on ne prélève pas de commission au vendeur, on **réduit les frais payés par l'acheteur** sur les articles de la boutique, par palier. Plus le forfait est élevé, moins l'acheteur paie de frais — ce qui rend les articles de la boutique plus attractifs (prix « tout compris » plus bas). Au palier le plus haut, les frais acheteur tombent à 0 % : Second ne se rémunère alors **que** sur l'abonnement mensuel.

**Forfaits envisagés** (prix CAD/mois à calibrer, non figés) :

| Forfait | Prix indicatif | Frais acheteur sur la boutique | Exigences légales (Canada) |
|---|---|---|---|
| **L'Atelier** | ~9 $/mois | Frais acheteur standard (5 % + 1,50 $) | NEQ optionnel |
| **Le Comptoir** | ~29 $/mois | Frais réduits (~2,5 % + 0,75 $) | NEQ requis |
| **La Maison** | ~79 $/mois | **0 % de frais acheteur** | NEQ + TPS + TVQ requis |

**Cibles** : particuliers gros vendeurs (« power-sellers ») **et** professionnels (friperies, dépôts-vente, créateurs).

**Logique « plus de légal aux paliers élevés »** : la collecte d'informations légales (NEQ, TPS, TVQ) devient obligatoire à mesure que le forfait monte, ce qui est cohérent avec le fait qu'une boutique au palier supérieur opère comme un vrai commerce fiscalisé au Canada/Québec.

**Pourquoi ce modèle** : créer un revenu récurrent prévisible (abonnements) tout en **préservant l'argument « 0 % commission vendeur »**, qui positionne Second comme plus avantageux que des concurrents type Poshmark.

**Prérequis techniques identifiés (non encore réalisés)** : rattacher chaque article à sa boutique et à son palier pour pouvoir moduler les frais au moment du paiement ; ajouter un barème de frais paramétré par palier ; brancher des **abonnements récurrents** (distincts des paiements à l'achat) avec leur suivi serveur ; et verrouiller le champ « forfait » pour qu'une boutique ne puisse pas s'auto-attribuer un palier payant (ce qui reviendrait à se rémunérer indûment).

**Anticipation côté sécurité (déjà en place) :** même si le modèle payant n'est pas implémenté, les règles de données interdisent **dès aujourd'hui** à un client de se créer ou de se modifier un forfait/palier de frais. Les champs réservés (`plan`, `forfait`, `tier`, `feesTier`, `buyerFeePercent`, `isVerified`, `verificationDetails`) ne peuvent être ni posés à la création ni modifiés par le propriétaire : ils sont « admin/serveur uniquement ». C'est une protection contre l'escalade de revenu (s'octroyer 0 % de frais sans payer l'abonnement).

---

### 16.6 L'espace d'administration

Second embarque un **panneau d'administration intégré à l'app** (pas de back-office web séparé), réservé aux comptes admin. Il sert à valider les boutiques et à traiter les signalements de modération.

#### Accès et garde-fous

- **Point d'entrée** : depuis l'écran **Réglages**, une section « Administration » n'apparaît **que pour les comptes admin** ; elle ouvre la gestion des boutiques.
- **Qui est admin** : un compte est administrateur s'il porte la marque d'admin sur son jeton d'authentification (custom claim `admin`, posée côté serveur, non modifiable par l'utilisateur), avec une compatibilité de repli sur un champ `isAdmin` du profil — lui-même protégé en écriture pour empêcher l'auto-promotion.
- **Triple verrouillage (défense en profondeur)** :
  1. La **section admin entière** (`/admin/*`) est protégée par une garde de route : elle vérifie le statut admin, affiche un écran d'attente pendant la vérification, et **redirige vers l'accueil** tout non-admin.
  2. **Chaque écran** admin re-vérifie le statut admin par lui-même (et refuse l'accès avec une alerte « Accès refusé »).
  3. Les **règles de données** côté serveur exigent indépendamment la marque d'admin pour toute action sensible.

Conséquence : un utilisateur non autorisé ne peut pas accéder au panneau, même en tentant d'ouvrir l'URL directement.

#### Écran « Gestion des boutiques » (`/admin/shops`)

- **Onglets** : *En attente*, *Approuvées*, *Rejetées*, *Toutes*. L'onglet « En attente » affiche un **badge rouge avec le nombre** de boutiques à traiter (file d'attente). L'app ouvre par défaut sur « En attente ».
- **Liste** : chaque boutique apparaît sous forme de carte (photo, nom, type, statut) avec actions rapides **Approuver** / **Rejeter** et un accès au détail.
- **Approuver** : confirmation (« Êtes-vous sûr… ? ») → la boutique passe `approved`, puis une notification d'approbation est envoyée au propriétaire.
- **Rejeter** : ouvre une fenêtre de **saisie du motif** (obligatoire) → la boutique passe `rejected`, puis une notification de refus (avec le motif) est envoyée au propriétaire.
- **Rafraîchir** : bouton de rechargement manuel de la liste.

#### Écran « Détail / validation d'une boutique » (`/admin/shop-detail/[id]`)

Vue complète d'une boutique en vue de la décision : badge de statut coloré (En attente / Approuvée / Rejetée / Suspendue), galerie photos, description, contact, adresse, carte Google Maps, horaires, réseaux sociaux, et un bloc **« Informations système »** (date de création, date de validation). Pour une boutique **en attente uniquement**, un pied de page affiche les deux boutons d'action **Rejeter** (avec motif) / **Approuver**. Une fois la décision prise, l'écran revient à la liste.

#### Écran « Signalements » (`/admin/reports`)

File des **signalements en attente** (contenus/comptes signalés par les utilisateurs), du plus récent au plus ancien. Chaque carte indique : le **type de cible** (Utilisateur, Article, Message), la **raison** du signalement, une description, qui a signalé, et l'identifiant de la cible. Trois actions par signalement :

| Action (bouton) | Effet métier |
|---|---|
| **Valider** (resolved) | Le signalement est traité/avéré et clos. |
| **Examiné** (reviewed) | Le signalement a été regardé (état intermédiaire). |
| **Rejeter** (dismissed) | Le signalement est écarté (non fondé). |

Chaque action demande une confirmation, puis retire le signalement de la file (mise à jour optimiste). L'écran affiche un état vide « Aucun signalement en attente » quand la file est vide. Les dates sont formatées en français canadien (`fr-CA`).

> Note de périmètre, vérifiée dans le code : le triage agit sur le **statut du signalement** (le marquer traité/examiné/écarté) ; il ne déclenche pas, à ce stade, d'action automatique sur la cible (bannir l'utilisateur, masquer l'article…). La sanction reste un geste manuel séparé.

---

### 16.7 Sécurité : pourquoi tout passe par le serveur

C'est un point central, vérifié dans le code, qui a une vraie portée métier (intégrité de la confiance et des revenus).

**Les champs « sensibles » d'une boutique et d'un signalement sont verrouillés** côté règles de données : le **statut de validation** et les **détails de vérification** d'une boutique, ainsi que le **statut/le réviseur/la date/la résolution** d'un signalement, sont « propriété de l'admin ». Un client — y compris un admin agissant depuis l'app — ne peut **pas** écrire directement ces champs. Ils ne peuvent être modifiés que par des **Cloud Functions** (code serveur de confiance), qui :

- vérifient elles-mêmes que l'appelant est bien admin (et refusent sinon) ;
- dérivent l'identité de l'admin depuis la session authentifiée — **aucun identifiant d'admin n'est transmis par le client** (impossible d'usurper « validé par X ») ;
- opèrent en **transaction atomique** : on lit l'état courant, on vérifie, puis on écrit — ce qui évite que deux admins se marchent dessus ou qu'on re-tamponne une décision déjà prise.

Fonctions serveur concernées : `approveShop`, `rejectShop`, `suspendShop` (modération des boutiques), `getPendingReports` et `triageReport` (signalements). Toutes sont déployées en **région canadienne** (`northamerica-northeast1`) — cohérent avec l'ancrage Canada et la **Loi 25** (résidence/traitement des données au Québec/Canada).

**Côté création** : une boutique ne peut être créée que par un utilisateur authentifié, **pour lui-même** (il doit être le propriétaire déclaré), **obligatoirement en `pending`**, et **sans** s'attribuer de champ de vérification ni de forfait payant. Autrement dit, on ne peut **ni s'auto-valider, ni s'auto-octroyer un palier à frais réduits**. C'est ce qui empêche un commerçant de contourner à la fois la modération et la facturation.

---

### 16.8 Notifications au propriétaire — limite connue

Quand un admin approuve ou rejette une boutique, l'app tente d'envoyer une **notification in-app** au propriétaire :

- Approbation → « Boutique approuvée ! Votre boutique a été validée. Vous pouvez maintenant publier vos articles. »
- Rejet → « Boutique refusée. Votre boutique n'a pas été approuvée. Raison : … » (le motif saisi par l'admin est repris).

**Limite factuelle, vérifiée dans le code** : ces notifications sont écrites **depuis l'app (client)** au moment de la décision admin. Or les règles de données interdisent au client de créer une notification (la création de notifications est réservée aux Cloud Functions). En conséquence, **cette écriture est rejetée par le serveur** ; l'erreur est silencieusement avalée (journalisée, sans bloquer l'admin). Concrètement : le changement de statut de la boutique réussit bien, **mais le propriétaire risque de ne pas recevoir la notification** d'approbation/refus tant que l'envoi n'est pas déporté côté serveur. Il n'y a par ailleurs **pas** de notification automatique lors de la **création** d'une boutique (le type `shop_created` existe dans le modèle mais n'est pas émis), et aucune notification de **suspension**.

---

### 16.9 Récapitulatif : livré vs cible

| Élément | État réel |
|---|---|
| Modèle de données « boutique » (riche, géolocalisé, légal Canada) | **Livré** |
| Vitrine publique `/shop/[id]` (galerie, contact, carte, horaires, articles) | **Livré** |
| Recherche « boutiques à proximité » (approuvées uniquement) | **Livré** (côté service) |
| Modération admin : valider / rejeter / suspendre (serveur, sécurisé) | **Livré** |
| File de signalements + triage (valider / examiné / rejeter) | **Livré** |
| Garde d'accès admin (triple verrouillage) | **Livré** |
| **Création de boutique par un commerçant** (écran, formulaire) | **Non branché** (`createShop` jamais appelé) |
| **Forfaits payants** (abonnement, paliers, champs de plan) | **Non implémenté** (décidé) |
| **Réduction des frais acheteur par palier** au paiement | **Non implémenté** (décidé) |
| Notification au propriétaire après décision admin | **Partielle / non fiable** (écriture client bloquée par les règles) |

En résumé : la **chaîne de confiance** (vitrine vérifiée + modération admin sécurisée) est en place et opérationnelle ; le **moteur économique** des boutiques (création self-service, abonnements, frais modulés) reste à construire, sur des fondations de sécurité déjà posées pour l'accueillir.
