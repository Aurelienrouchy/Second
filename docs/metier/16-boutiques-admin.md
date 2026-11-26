## 16. Boutiques payantes & administration

Cette section décrit deux briques liées de Second : (1) le système de **boutiques** — fiches d'enseignes avec vitrine publique et **forfaits payants** qui réduisent les frais payés par l'acheteur ; (2) l'**espace d'administration** interne qui valide les boutiques, traite les signalements et résout les litiges.

**Ce qui est réellement livré dans le code aujourd'hui** : le modèle de données d'une boutique, sa vitrine publique `/shop/[id]`, la chaîne de modération admin (approuver / rejeter / suspendre via Cloud Functions), la file de signalements, la file de litiges, **et toute la chaîne d'encaissement du forfait payant** — écran de souscription, paiement Stripe, application du forfait côté serveur, réduction des frais acheteur au moment du paiement.

**Trois trous majeurs, vérifiés dans le code, qui rendent la brique inexploitable en l'état :**

1. **Aucun écran ne permet de créer une boutique.** La fonction `createShop` existe (`features/shop/services/shopService.ts`) mais n'est appelée par aucun écran. Il n'existe aujourd'hui de boutique dans la base que si elle y a été insérée à la main.
2. **Le forfait payant ne sert à rien aujourd'hui.** Le bénéfice vendu est la réduction des frais de protection acheteur. Or ces frais ne sont facturés que sur le rail **livraison**, désactivé (`SHIPPING_ENABLED = false`), et le rail **rencontre en main propre** — le seul actif — applique explicitement **0 $ de frais** (`functions/src/callable/payments/checkout.ts`). Un commerçant peut donc payer 29,99 $ ou 79,99 $ par mois pour une réduction sur des frais que personne ne paie. Rien dans le code n'empêche cet achat.
3. **Le bouton « Voir tous les articles » d'une boutique ne renvoie rien.** Il passe l'identifiant de la boutique à la recherche, qui l'interprète comme un identifiant de vendeur (voir 16.4).

Cette section distingue systématiquement le **livré**, le **livré mais inerte**, et le **manquant**.

---

### 16.1 Qu'est-ce qu'une « boutique » dans Second

Une boutique (collection de données `shops`) représente une **enseigne** de seconde main : friperie, dépôt-vente, boutique vintage, concept store, etc. Elle se distingue d'un simple vendeur particulier par une fiche riche, géolocalisée, avec vitrine publique et badge de vérification.

Les **types de boutique** disponibles (20 catégories, définis dans `types/shop.ts`) :

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
- Localisation : adresse postale complète (rue, ville, code postal, pays stocké en code ISO — « CA » affiché « Canada ») + coordonnées GPS et un **geohash** calculé automatiquement à la création, prévu pour retrouver les boutiques « à proximité ».
- Horaires d'ouverture (jour par jour ; un jour sans horaire = affiché « Fermé »).
- **Forfait** : le palier payant (`basic` / `pro` / `premium`) et sa **date d'expiration**. Ces deux champs sont posés **exclusivement par le serveur** après paiement — jamais par le commerçant (voir 16.5 et 16.7).
- Indicateurs : note moyenne, nombre d'avis, nombre d'articles en vente.
- Cycle de vie : statut de validation, détails de vérification (quel admin a tranché, quand, motif éventuel), dates de création et de mise à jour.
- Informations légales : le modèle prévoit des champs **NEQ / numéro d'entreprise, TPS, TVQ, coordonnées bancaires (transit / institution / compte)**. **Trou constaté** : ces champs ne sont **collectés par aucun écran, affichés nulle part et vérifiés par aucune règle**. La seule fonction qui sait les écrire (`updateLegalInfo`) n'est appelée nulle part. Concrètement, la conformité fiscale d'une boutique n'est aujourd'hui **ni demandée ni contrôlée**, y compris au palier le plus cher.

---

### 16.2 Statuts d'une boutique (cycle de vie)

Une boutique passe par quatre états, qui pilotent sa visibilité et son traitement :

| Statut | Signification | Vitrine publique | Réduction de frais |
|---|---|---|---|
| `pending` (En attente) | Vient d'être créée, en file de validation admin. | « Boutique indisponible » | Non |
| `approved` (Approuvée) | Validée par un admin → boutique « vérifiée ». | Fiche complète + badge « Boutique vérifiée » | Oui, si forfait payé et non expiré |
| `rejected` (Rejetée) | Refusée par un admin, avec un motif obligatoire. | « Boutique indisponible » | Non |
| `suspended` (Suspendue) | Mise hors-ligne par un admin après coup, motif obligatoire. | « Boutique indisponible » | Non |

**Règles de gestion clés :**

- Une boutique **naît toujours en `pending`** — les règles de données refusent une création qui se déclarerait déjà « approuvée ».
- **Seules les boutiques `approved` sont consultables** : sur une boutique dans un autre statut, la vitrine affiche « Boutique indisponible » et n'expose ni contact, ni adresse, ni carte.
- Le statut `approved` est aussi la condition d'accès à toute réduction de frais : une boutique suspendue perd son bénéfice immédiatement, **même si son forfait est payé et non expiré** — et **aucun remboursement automatique n'est prévu**.
- Les transitions de statut sont **réservées aux administrateurs** et passent obligatoirement par le serveur. Le propriétaire ne peut jamais changer lui-même son statut.
- Les changements de statut sont **idempotents** : redemander un statut déjà en place ne fait rien et **ne renotifie pas** le propriétaire (utile si deux admins agissent en parallèle).
- Il **n'existe aucune suppression** de boutique : ni pour le propriétaire, ni pour l'admin, ni via l'interface. Les règles interdisent le `delete` sans exception ; on suspend.

---

### 16.3 La vitrine publique d'une boutique — écran `/shop/[id]`

Page consultable par n'importe qui, connecté ou non (la lecture des boutiques est publique).

**Contenu et parcours, de haut en bas** (boutique approuvée) :

1. **Galerie photos** : une grande image principale + une bande de vignettes cliquables.
2. **En-tête** : logo + nom, avec le badge vert **« Boutique vérifiée »**.
3. **Badge de type** (ex. « Friperie », « Dépôt-vente »).
4. **Description** libre.
5. **Actions de contact** : **Appeler** (ouvre l'app téléphone), **Email** (ouvre le client mail), **Site web** (affiché seulement si renseigné ; préfixe `https://` ajouté au besoin).
6. **Adresse** complète (rue, code postal, ville, pays).
7. **Carte** avec un repère à l'emplacement exact.
8. **Horaires d'ouverture** : tableau Lundi → Dimanche, « Fermé » pour les jours non renseignés.
9. **Réseaux sociaux** (si renseignés) : liens Instagram / Facebook.
10. **Articles en vente** : affiché uniquement si le compteur d'articles est supérieur à zéro ; un bouton « Voir tous les articles » renvoie vers la recherche filtrée (**cassé — voir 16.4**).
11. **« Gérer mon forfait »** : bouton visible **uniquement par le propriétaire** de la boutique, qui ouvre l'écran de souscription (voir 16.5).

Pendant le chargement, un squelette d'interface est affiché. Identifiant inconnu → **« Boutique introuvable »**. Boutique non approuvée → **« Boutique indisponible »**.

**Spécificité plateforme (iOS / Android)** : la carte utilise le **fournisseur natif par défaut** — Apple Plans sur iOS, Google Maps sur Android. Ce choix est délibéré et documenté dans le code : forcer Google Maps sur iOS exigerait une clé d'API Maps dédiée, sans laquelle la carte serait vide. Les boutons « Appeler » / « Email » dépendent de la présence d'une app téléphone / mail sur l'appareil.

Une visite de vitrine et chaque contact (téléphone, mail, site, réseaux) sont mesurés en analytics.

---

### 16.4 Articles rattachés à une boutique

Le rattachement d'un article à une boutique est **automatique et entièrement côté serveur**. À la publication d'un article, le serveur regarde si le vendeur possède une boutique **approuvée** ; si oui, il estampille l'identifiant de cette boutique sur l'article. Le vendeur ne choisit rien et ne peut pas se rattacher à la boutique d'un tiers. Si la recherche de boutique échoue, l'article est publié sans rattachement (jamais bloqué).

Le **compteur d'articles** de la boutique est tenu à jour automatiquement par un déclencheur serveur, qui compte les articles rattachés, **actifs et non vendus** — et applique la différence à chaque création, suppression, vente, désactivation ou changement de rattachement.

**Trou constaté** : le bouton **« Voir tous les articles »** de la vitrine ouvre la recherche en lui passant l'identifiant de la **boutique**, mais l'écran de recherche l'utilise comme un identifiant de **vendeur** (`features/search/hooks/useSearchScreen.ts`). Comme un identifiant de boutique n'est jamais un identifiant d'utilisateur, la recherche filtre sur une valeur qui ne correspond à aucun article : **la liste revient systématiquement vide**. Le compteur d'articles, lui, est juste — d'où un écart visible pour l'utilisateur (« Articles en vente (12) » puis une liste vide).

**Trou constaté** : la recherche **« boutiques à proximité »** existe dans le code (calcul geohash + filtre par rayon) mais **aucun écran ne l'appelle** — il n'y a pas de carte ni de liste de boutiques dans l'app. De plus, l'index de base de données que cette recherche exigerait n'est pas déclaré (`firestore.indexes.json` ne contient aucune entrée pour les boutiques) : si un écran l'appelait demain, la requête échouerait tant que l'index n'est pas ajouté.

---

### 16.5 Forfaits payants : le modèle de monétisation

> **Statut : implémenté de bout en bout, mais sans effet économique aujourd'hui** — voir l'alerte en tête de section et la fin de cette sous-section.

**Principe.** Le vendeur touche **100 % du prix de vente (0 % de commission vendeur)**, à la manière de Vinted. C'est l'**acheteur** qui paie des **frais de protection**, calculés côté serveur : **5 % du prix de l'article + 1,50 $, avec un minimum de 2,00 $** (CAD). Exemple : article à 30 $ → 3,00 $ de frais ; article à 100 $ → 6,50 $.

Le levier des boutiques payantes est donc **inhabituel** : on ne prélève pas de commission au vendeur, on **réduit les frais payés par l'acheteur** sur les articles de la boutique. Plus le forfait est élevé, moins l'acheteur paie — ce qui rend les articles de la boutique plus attractifs (prix « tout compris » plus bas). Au palier haut, les frais acheteur tombent à zéro : Second ne se rémunère alors **que** sur le forfait.

**Les trois paliers, tels que codés :**

| Palier | Nom affiché | Prix serveur | Réduction des frais acheteur |
|---|---|---|---|
| `basic` | Standard | Gratuit | Aucune (frais pleins) |
| `pro` | Le Comptoir | **29,99 $ / mois** | **−50 %** |
| `premium` | La Maison | **79,99 $ / mois** | **−100 % (frais acheteur nuls)** |

Les prix sont des **valeurs serveur**, réglables sans changer le code, et l'app ne fait que les afficher : le montant réellement débité est toujours celui calculé par le serveur.

**Le parcours de souscription** (écran `app/shop/upgrade.tsx`, accessible depuis « Gérer mon forfait » sur sa propre vitrine) :

1. Le propriétaire voit son forfait courant et sa date d'expiration (ou « expiré »), les trois paliers avec leurs bénéfices, et choisit une **durée : 1, 3, 6 ou 12 mois**.
2. Il valide → le serveur vérifie qu'il est bien **propriétaire** de la boutique et que celle-ci est **approuvée**, puis prépare le paiement. Une boutique en attente, rejetée ou suspendue **ne peut pas souscrire** : le message est explicite (« Votre boutique doit être approuvée avant de souscrire à un forfait »), précisément parce qu'aucun remboursement automatique n'existerait.
3. Il paie par la feuille de paiement Stripe native. C'est un **paiement unique prépayé pour la période choisie** — ce n'est **pas un abonnement récurrent** : rien ne se renouvelle tout seul, rien n'est prélevé automatiquement le mois suivant.
4. **Le forfait n'est accordé qu'après encaissement** : c'est le serveur, à réception de la confirmation Stripe, qui pose le palier et sa date d'expiration sur la boutique. Le commerçant voit un message « Votre forfait sera actif dans quelques instants ».

**Règles de gestion du forfait :**

- **Renouvellement cumulatif** : renouveler avant l'échéance **ajoute** la nouvelle durée au temps restant, sans le perdre.
- **Anti-double-facturation** : un même achat rejoué (double clic, reprise réseau) n'est encaissé qu'une fois ; un vrai renouvellement, lui, passe bien.
- **Contrôle du montant** : si le montant encaissé ne correspond pas au tarif serveur, le forfait **n'est pas accordé** et l'anomalie part en file d'incidents.
- **Boutique désapprouvée entre l'achat et l'encaissement** : le forfait n'est pas accordé et une **alerte critique demandant un remboursement manuel** est créée. Il n'existe **pas** de remboursement automatique.
- **Expiration silencieuse** : passée la date d'expiration, la boutique revient au comportement `basic` (frais pleins). **Aucune notification, aucun rappel avant échéance, aucune relance** n'existe dans le code.
- **Comptabilité** : chaque forfait encaissé est inscrit au registre de revenus de la plateforme, et un événement analytics est émis avec le palier et la durée.
- **Le revenu du forfait reste à la plateforme** (charge directe), il ne transite pas par le compte du vendeur.

**Comment la réduction s'applique à l'achat.** Au moment où un acheteur paie, le serveur retrouve seul la boutique du vendeur (par le rattachement de l'article, sinon par recherche de la boutique du vendeur), vérifie qu'elle est **approuvée** *et* que le forfait est **encore valide**, et n'applique la réduction qu'à ces conditions. La réduction n'est **jamais** transmise par l'app : elle est recalculée côté serveur à chaque fois. En cas d'échec de lecture, on retombe sur les frais pleins — une boutique introuvable ne bloque jamais une commande.

> **Trou majeur, vérifié dans le code.** La réduction ne s'applique qu'aux commandes du rail **livraison**. Ce rail est fermé (`SHIPPING_ENABLED = false`, côté app et côté serveur), et le rail **rencontre en main propre** — le seul ouvert aujourd'hui — est explicitement facturé **0 $ de frais acheteur**, réduction enregistrée à zéro. Conséquence directe : **acheter un forfait aujourd'hui n'apporte strictement aucun bénéfice mesurable**, alors que l'écran de souscription est accessible et le paiement fonctionnel. Rien dans le code (ni drapeau, ni message) n'avertit le commerçant. C'est le point à trancher avant toute commercialisation : soit fermer l'écran de souscription jusqu'à l'ouverture des paiements, soit ouvrir le rail payant.

> **Trou secondaire.** Même sur le rail livraison, la réduction obtenue n'est **affichée nulle part** dans l'app : le serveur renvoie bien le taux de réduction appliqué au moment d'afficher les frais, mais aucun écran ne l'exploite pour dire à l'acheteur « frais réduits grâce à la boutique ». L'argument de vente du forfait est donc invisible pour l'acheteur.

**Pourquoi ce modèle** : créer un revenu récurrent prévisible tout en **préservant l'argument « 0 % commission vendeur »**, qui positionne Second comme nettement plus avantageux que des concurrents type Poshmark (20 % côté vendeur).

---

### 16.6 L'espace d'administration

Second embarque un **panneau d'administration intégré à l'app** (pas de back-office web séparé), réservé aux comptes admin. Il couvre la validation des boutiques, les signalements et les litiges.

#### Accès et garde-fous

- **Point d'entrée** : depuis **Réglages**, une section « Administration » n'apparaît **que pour les comptes admin** et ouvre la gestion des boutiques.
- **Qui est admin** : un compte porte la marque d'admin sur son jeton d'authentification (posée côté serveur, non modifiable par l'utilisateur), avec un repli sur un champ du profil — lui-même protégé en écriture pour empêcher l'auto-promotion.
- **Triple verrouillage (défense en profondeur)** :
  1. La **section admin entière** est protégée par une garde de route : elle vérifie le statut admin, affiche un écran d'attente pendant la vérification, et **redirige vers l'accueil** tout non-admin.
  2. **Chaque écran** admin re-vérifie le statut admin par lui-même (alerte « Accès refusé » puis retour à l'accueil).
  3. Les **règles de données** et les **fonctions serveur** exigent indépendamment la marque d'admin pour toute action sensible.

Conséquence : un utilisateur non autorisé ne peut pas accéder au panneau, même en ouvrant l'adresse directement.

**Trou constaté** : seule la **gestion des boutiques** est atteignable depuis l'app. Les écrans **Signalements** et **Litiges** existent, sont complets et sécurisés, mais **aucun lien ne mène à eux** — ni depuis les réglages, ni depuis le panneau boutiques. Ils ne sont ouvrables qu'en tapant l'adresse à la main. C'est un problème opérationnel réel : la modération et la résolution de litiges sont livrées mais, en pratique, inaccessibles.

#### Écran « Gestion des boutiques » (`app/admin/shops.tsx`)

- **Cinq onglets** : *En attente*, *Approuvées*, *Rejetées*, *Suspendues*, *Toutes*. L'onglet « En attente » porte un **badge avec le nombre** de boutiques à traiter ; l'écran ouvre par défaut dessus.
- **Liste** : chaque boutique apparaît sous forme de carte (photo, nom, type, statut) avec **Approuver** / **Rejeter** et un accès au détail. Une boutique déjà approuvée affiche en plus un bouton **Suspendre**.
- **Approuver** : confirmation (« Êtes-vous sûr… ? ») → la boutique passe approuvée et son propriétaire est notifié par le serveur.
- **Rejeter** / **Suspendre** : ouvre une fenêtre de **saisie du motif** (obligatoire), avec cinq motifs prédéfinis proposés en un clic (photos insuffisantes, informations incomplètes, adresse non valide, type de boutique non approprié, suspicion de fraude) ou un texte libre → le propriétaire est notifié avec le motif.
- **Rafraîchir** : rechargement manuel de la liste.

**Détail mineur** : la fenêtre de saisie du motif affiche toujours le titre « Rejeter la boutique », y compris quand l'admin est en train de **suspendre**. Le comportement est correct, seul le libellé est trompeur.

#### Écran « Détail / validation d'une boutique » (`app/admin/shop-detail/[id].tsx`)

Vue complète en vue de la décision : badge de statut coloré, galerie photos, description, contact, adresse, carte, horaires, réseaux sociaux, et un bloc **« Informations système »** (date de création, date de validation). Pour une boutique **en attente uniquement**, un pied de page affiche **Rejeter** (avec motif) / **Approuver**. Une fois la décision prise, l'écran revient à la liste.

#### Écran « Signalements » (`app/admin/reports.tsx`) — *sans lien d'accès*

File des **signalements en attente**, du plus récent au plus ancien, chargée par une fonction serveur admin. Chaque carte indique le **type de cible** (Utilisateur, Article, Message), la **raison**, une description, qui a signalé, et l'identifiant de la cible. Trois actions :

| Action (bouton) | Effet métier |
|---|---|
| **Valider** (resolved) | Le signalement est traité/avéré et clos. |
| **Examiné** (reviewed) | Le signalement a été regardé (état intermédiaire). |
| **Rejeter** (dismissed) | Le signalement est écarté (non fondé). |

Chaque action demande une confirmation, puis retire le signalement de la file. État vide : « Aucun signalement ». Dates en français canadien.

Côté utilisateur, un signalement est créé par une fonction serveur qui applique une règle d'anti-spam stricte : **un seul signalement par personne, par cible et par type** — un second essai est refusé avec « Vous avez déjà signalé cet élément ».

> **Note de périmètre** : le triage agit sur le **statut du signalement** ; il ne déclenche **aucune action automatique sur la cible** (bannir l'utilisateur, masquer l'article…). La sanction reste un geste manuel séparé. À noter aussi que le serveur accepte un quatrième type de cible (« avis ») que l'app ne sait ni produire ni afficher — un tel signalement s'afficherait « Cible inconnue ».

#### Écran « Litiges » (`app/admin/disputes.tsx`) — *sans lien d'accès*

Liste les litiges ouverts par les acheteurs/vendeurs (problème de transaction, rencontre manquée). Un litige **gèle la transaction concernée** et bloque la suppression de compte des deux parties tant qu'il n'est pas tranché — **sauf** un litige de rencontre manquée : la rencontre reste bien gelée jusqu'à l'arbitrage, mais ni ce litige ni cette transaction ne bloquent plus l'effacement du compte, puisque aucun argent n'a transité. Trois issues, toutes passées par des fonctions serveur admin : **rembourser l'acheteur et clore** — sur un litige de rencontre, le bouton s'intitule **« Clôturer (acheteur) »** et l'écran précise qu'aucun argent n'a transité par la plateforme, donc qu'il n'y a rien à rembourser —, **clore en faveur du vendeur** (qui, sur un litige de rencontre, restaure celle-ci et rallume les actions de la bulle d'offre), ou traiter un **litige de troc** (saisie manuelle de l'identifiant du troc, issu du ticket support). Cet écran est donc opérationnellement critique — et c'est celui qui n'a aucun point d'entrée dans l'app.

---

### 16.7 Sécurité : pourquoi tout passe par le serveur

Point central, avec une vraie portée métier : intégrité de la confiance **et** des revenus.

**Les champs sensibles d'une boutique sont verrouillés** côté règles de données. Ni le propriétaire, ni un admin agissant depuis l'app ne peuvent écrire directement : le **statut de validation**, les **détails de vérification**, et **tous les champs de forfait** (palier, date d'expiration, références du paiement, taux de frais, marqueur « vérifié »). Ces champs sont refusés **à la création comme à la modification**. Le propriétaire garde la main sur le reste de sa fiche (nom, description, photos, horaires, contact).

Ces mutations ne peuvent venir que de **fonctions serveur de confiance**, qui :

- vérifient elles-mêmes que l'appelant est bien admin (ou, pour le forfait, bien propriétaire) et refusent sinon ;
- dérivent l'identité depuis la session authentifiée — **aucun identifiant d'admin n'est transmis par l'app** (impossible d'usurper « validé par X ») ;
- opèrent en **transaction atomique** : lire l'état courant, vérifier, puis écrire — ce qui évite que deux admins se marchent dessus ou qu'on re-tamponne une décision déjà prise.

Même verrouillage sur un **signalement** : statut, réviseur, date de revue et résolution sont propriété du serveur.

Fonctions serveur concernées : approbation / rejet / suspension d'une boutique, lecture et triage des signalements, dépôt d'un signalement, achat de forfait, et confirmation de paiement du forfait. Toutes déployées en **région canadienne** (`northamerica-northeast1`) — cohérent avec l'ancrage Canada et la **Loi 25**.

**Ce que cela empêche concrètement** : un commerçant ne peut ni **s'auto-valider** (contourner la modération), ni **s'auto-octroyer un palier payant** (obtenir 0 % de frais sans payer), ni **prolonger son forfait** sans encaissement. Le palier n'est posé qu'à réception de l'argent, et retiré de fait dès l'expiration.

---

### 16.8 Notifications au propriétaire

Les notifications de modération sont créées **entièrement côté serveur** (notification dans l'app + notification poussée sur le téléphone), au moment où la décision est prise :

- Approbation → « Boutique approuvée — *nom* a été approuvée et est maintenant en ligne. »
- Rejet → « Boutique refusée — *nom* a été refusée : *motif*. »
- Suspension → « Boutique suspendue — *nom* a été suspendue : *motif*. »

Une action **idempotente** (redemander un statut déjà en place) **ne renotifie pas**. Un échec d'envoi n'annule jamais le changement de statut : il est journalisé sans bloquer l'admin.

> **Correction d'une limite désormais levée** : les notifications étaient autrefois écrites depuis l'app et donc rejetées par les règles de données. Ce n'est plus le cas — l'envoi est serveur, et les anciennes fonctions côté app ont été neutralisées.

**Trous restants** :

- **Aucune notification à la création** d'une boutique (le type existe dans le modèle et l'app saurait l'afficher, mais rien ne l'émet).
- **Aucune notification liée au forfait** : ni confirmation d'activation, ni rappel avant expiration, ni avis d'expiration. Le forfait s'éteint en silence et le commerçant ne l'apprend qu'en rouvrant l'écran « Gérer mon forfait ».
- **Aucune notification** en cas de forfait payé pour une boutique devenue non approuvée : l'incident part en alerte admin pour remboursement manuel, mais le commerçant n'est prévenu de rien.

---

### 16.9 Récapitulatif : livré, inerte, manquant

| Élément | État réel |
|---|---|
| Modèle de données « boutique » (riche, géolocalisé, forfait, légal Canada) | **Livré** |
| Vitrine publique `/shop/[id]` (galerie, contact, carte, horaires) | **Livré** |
| Restriction de la vitrine aux boutiques approuvées | **Livré** |
| Rattachement automatique article ↔ boutique + compteur d'articles | **Livré** (serveur) |
| Modération admin : valider / rejeter / suspendre | **Livré**, sécurisé serveur |
| Notifications de modération au propriétaire (dont suspension) | **Livré**, 100 % serveur |
| File de signalements + triage + anti-spam au dépôt | **Livré** mais **aucun lien d'accès dans l'app** |
| File de litiges + résolution (remboursement / vendeur / troc) | **Livré** mais **aucun lien d'accès dans l'app** |
| Garde d'accès admin (triple verrouillage) | **Livré** |
| Forfaits payants : écran, paiement, activation serveur, cumul, registre de revenus | **Livré** |
| Verrouillage anti-auto-attribution du forfait | **Livré** |
| **Effet économique du forfait** (réduction des frais acheteur) | **Inerte** — le seul rail d'achat ouvert facture 0 $ de frais |
| Affichage de la réduction à l'acheteur | **Absent** — le taux est calculé mais jamais montré |
| Bouton « Voir tous les articles » d'une boutique | **Cassé** — filtre sur le mauvais identifiant, liste toujours vide |
| **Création de boutique par un commerçant** (écran, formulaire) | **Absente** — la fonction existe, aucun écran ne l'appelle |
| Collecte / contrôle des informations légales (NEQ, TPS, TVQ) | **Absents** — champs prévus, jamais demandés ni vérifiés |
| Recherche « boutiques à proximité » | **Inerte** — code présent, aucun écran, index de base manquant |
| Rappel / relance avant expiration du forfait | **Absent** |
| Remboursement automatique d'un forfait devenu sans objet | **Absent** — alerte admin, geste manuel |

En résumé : la **chaîne de confiance** (vitrine vérifiée, modération sécurisée, verrouillage serveur des champs de revenu) et le **rail d'encaissement du forfait** sont tous deux construits et solides. Ce qui manque n'est pas la plomberie mais les **deux extrémités du parcours commerçant** : personne ne peut créer sa boutique dans l'app, et celui qui en aurait une paierait aujourd'hui un forfait dont l'avantage ne s'applique à aucune vente. Ouvrir cette brique suppose, dans cet ordre : un écran de création de boutique, l'ouverture du rail de paiement, la correction du lien vers les articles, et l'accès aux écrans de modération et de litiges.
