## 14. Messagerie & modération

La messagerie est le cœur relationnel de Second : c'est l'espace où acheteur et vendeur négocient, conviennent d'un prix et d'une remise en main propre, échangent des photos, et où la plateforme injecte des messages « système » pour tracer chaque étape de la transaction. C'est aussi le point de contact principal pour la sécurité communautaire : signalement et blocage se déclenchent depuis la conversation. Tout est en français, en dollars canadiens (CAD), et conçu pour le contexte local (rencontres en personne dans des quartiers, lieux publics suggérés).

Cette section décrit le comportement réel de l'application, vérifié dans le code (`app/(tabs)/messages.tsx`, `app/chat/[id].tsx`, `features/chat/*`, `services/chatService.ts`, `services/moderationService.ts`, `functions/src/triggers/messages.ts`, ainsi que les règles de sécurité Firestore).

---

### 14.1 Vue d'ensemble

- **Temps réel.** Les conversations et les messages se mettent à jour en direct, sans rafraîchir : dès qu'un message arrive, il apparaît chez le destinataire connecté. Le badge de non-lus se met à jour de la même façon.
- **Deux niveaux.** Une **liste des conversations** (onglet « Messages ») et une **conversation individuelle** (l'écran de chat).
- **Liée à un article.** La très grande majorité des conversations portent sur un article précis : une barre de contexte rappelle l'article (photo, titre, prix) en haut du chat. Une conversation « générale » (depuis un profil, sans article) reste possible.
- **Négociation intégrée.** On peut envoyer une **offre de prix** directement dans le chat, avec proposition de lieu de rencontre, puis l'autre partie peut accepter, refuser, ou faire une **contre-offre** (prix, lieu, ou horaire).
- **Messages système.** L'app insère automatiquement des messages d'information (« Offre acceptée », « Meetup confirmé », « Transaction complétée », etc.) pour que l'historique de la conversation raconte la transaction.
- **Modération en deux temps.** Signaler (rapport envoyé à l'équipe) et bloquer (l'autre ne peut plus écrire). Le blocage est appliqué **côté serveur**, pas seulement dans l'interface.

---

### 14.2 Liste des conversations (onglet « Messages »)

Écran : `app/(tabs)/messages.tsx`.

#### Accès et états

| État | Ce que voit l'utilisateur |
|------|----------------------------|
| Non connecté | Écran « Connexion requise » avec un cadenas et un bouton « Se connecter » qui ouvre la feuille d'authentification. Aucune conversation visible. |
| Chargement | 5 lignes squelette (avatar + texte grisés). |
| Erreur | Icône d'alerte + « Erreur » + message. |
| Aucune conversation (dans l'onglet courant) | Icône bulles + « Aucune conversation » + « Vos conversations avec les acheteurs et vendeurs apparaîtront ici ». |
| Avec conversations | Liste des conversations filtrée par onglet. |

#### Deux onglets : VENTES / ACHATS

La liste est séparée en deux onglets, selon le rôle de l'utilisateur dans chaque conversation :

- **VENTES** : conversations où l'utilisateur est le **vendeur** de l'article (il a reçu un message d'un acheteur intéressé).
- **ACHATS** : conversations où l'utilisateur est l'**acheteur** (il a contacté un vendeur), ainsi que les conversations générales (sans article).

Le classement repose sur le champ `sellerId` de la conversation : si `sellerId` = utilisateur courant → VENTES, sinon → ACHATS.

**Règle d'onglet par défaut** : à l'ouverture, l'app affiche VENTES si l'utilisateur a au moins une conversation de vente ; sinon elle bascule automatiquement sur ACHATS. Ce choix n'est fait qu'une seule fois par session d'écran.

**Compteur par onglet** : chaque onglet affiche une pastille avec le total de messages non lus de ses conversations (somme des non-lus). La pastille n'apparaît que si le total est > 0.

#### Contenu d'une ligne de conversation

Chaque ligne montre :
- L'**avatar** de l'autre participant (photo de profil à jour si disponible, sinon l'instantané stocké dans la conversation, sinon une silhouette par défaut).
- Une **vignette de l'article** superposée en bas à droite de l'avatar (si la conversation est liée à un article).
- Le **nom** de l'autre participant + le **titre de l'article** en étiquette discrète.
- Un **aperçu du dernier message**, adapté au type :
  - message texte → le texte ;
  - photo → « [Photo] » ;
  - offre → « [Offre] », « [Contre-offre] » ou « [Offre meetup] » selon le contenu ;
  - message système → « ℹ️ … » ;
  - aucun message encore → « Aucun message ».
- L'**horodatage** intelligent : l'heure si le message est du jour, « Hier », le jour de la semaine abrégé si moins de 7 jours, sinon la date (jour/mois). Le format suit la locale canadienne.
- Une **pastille de non-lus** (nombre) et un **point** sur l'avatar si la conversation contient des messages non lus.

#### Détails de gestion (liste)

- La liste s'appuie sur **un seul abonnement temps réel global** monté une fois au démarrage de l'app (et non un abonnement par écran), pour la performance et la cohérence du badge.
- Les conversations sont triées par **date de dernière activité décroissante** (la plus récente en haut).
- Le **badge de l'onglet « Messages »** dans la barre de navigation reflète le **total** de messages non lus, toutes conversations confondues.

---

### 14.3 La conversation (écran de chat)

Écran : `app/chat/[id].tsx` (route `/chat/{id}`).

#### Garde d'accès et états

- **Invité (non connecté)** : redirection automatique vers l'onglet Profil. Le chat n'est jamais accessible sans compte.
- **Chargement** : squelette de conversation.
- **Erreur** : écran d'erreur dédié avec le message.
- **Conversation vide** : « Aucun message » + « Commencez la conversation avec [nom] » (ou « ce vendeur » si le nom est inconnu).

#### Structure de l'écran (de haut en bas)

1. **En-tête** : flèche retour, avatar + nom de l'autre participant (cliquable → ouvre son profil public), prix de l'article en sous-titre, et un bouton « … » (plus d'options) qui ouvre les actions de modération.
2. **Barre de contexte article** (voir 14.4), si la conversation est liée à un article.
3. **Bandeau de suivi de transaction** (en tête de la liste de messages) : si une transaction est associée et qu'elle n'est plus au stade « paiement en attente », un composant de suivi (`ShipmentTracking`) s'affiche. Pour une vente en main propre (meetup), ce bandeau se limite au bloc de transparence/contestation exigé par la Loi 25 (ex. annulation automatique d'un meetup) ou ne montre rien ; pour une vente avec livraison il afficherait le suivi complet.
4. **Liste des messages**, triés par horodatage croissant ; défilement automatique vers le bas à l'arrivée d'un nouveau message.
5. **Barre de saisie** (voir 14.5).

#### Marquage « lu »

À l'ouverture d'une conversation, l'app marque comme lus tous les messages reçus non lus et **remet à zéro le compteur de non-lus** de cet utilisateur pour cette conversation. C'est ce qui fait disparaître la pastille.

#### Types de messages affichés

| Type | Rendu |
|------|-------|
| Texte | Bulle de message classique (la sienne à droite, celle de l'autre à gauche, avec avatar). |
| Photo | Bulle image (miniature + image pleine). |
| Offre | **Bulle d'offre** dédiée avec actions (accepter / refuser / contre-offrir / confirmer meetup / compléter / signaler une absence). |
| Système | Bulle d'information neutre générée par l'app. |

#### Différences de plateforme (clavier)

- **iOS** : la zone de saisie remonte avec le clavier (comportement « padding » + décalage vertical) pour rester visible.
- **Android** : la gestion du clavier est laissée au système (pas de décalage manuel). Effet produit identique : la saisie reste accessible.

---

### 14.4 Barre de contexte article

Composant : `features/chat/components/ChatArticleBar.tsx`.

En haut du chat (sous l'en-tête), un rappel visuel de l'article concerné :

- **Photo, titre et prix** de l'article. Bouton « VOIR » pour ouvrir la fiche article.
- **Prix vivant vs prix figé** : le chat conserve un instantané du prix au moment de sa création. Si le prix actuel diffère, la barre affiche l'**ancien prix barré** à côté du prix courant (information de baisse/hausse de prix pour l'acheteur).
- **Article vendu** : un cartouche « VENDU » se superpose à la photo et le bouton « VOIR » est désactivé.
- **Article indisponible / supprimé** : la barre affiche « Article indisponible », est grisée, et le bouton « VOIR » disparaît.

**Propagation automatique des changements d'article.** Le titre, l'image et le prix figés dans les conversations sont mis à jour **côté serveur** (déclencheur `onArticleInfoUpdated`) lorsque le vendeur modifie son article : toutes les conversations liées à cet article reçoivent la nouvelle valeur. Le client ne réécrit jamais ces champs lui-même (les règles de sécurité l'interdisent), ce qui évite les divergences entre vendeur et acheteur.

---

### 14.5 Barre de saisie et envoi

Composant : `features/chat/components/ChatInputBar.tsx`. Logique : `app/chat/[id].tsx` + `services/chatService.ts`.

La barre contient :
- Un bouton **pièce jointe** (envoi de photo).
- Un **champ texte** multiligne, placeholder « Message… », **limité à 1000 caractères**.
- Un bouton **offre** (« $ ») — affiché **uniquement** si la conversation est liée à un article disponible.
- Un bouton **envoyer**, actif seulement quand le texte n'est pas vide.

#### Envoi d'un message texte

- Léger retour haptique à l'envoi.
- Le message est créé puis la conversation est mise à jour (dernier message, type, horodatage, **incrément du compteur de non-lus du destinataire**). L'incrément est atomique côté serveur pour éviter de perdre des messages quasi simultanés.
- En cas d'échec, une alerte « Impossible d'envoyer le message ».

#### Envoi d'une photo

- Demande la **permission d'accès à la galerie** ; si refusée, alerte « Permission requise ».
- L'image est **redimensionnée et compressée** (max 1024 px de large, qualité 70 %) et une **miniature** (200 px) est générée, puis les deux sont téléversées dans le stockage. Les métadonnées EXIF ne sont pas conservées.
- Retours haptiques pendant l'envoi et au succès. Un indicateur de chargement remplace l'icône de pièce jointe pendant l'opération.

#### Garde-fou anti-soi-même et anti-blocage

- Impossible de créer une conversation avec soi-même.
- Avant l'envoi, l'app vérifie qu'aucun des deux participants n'a bloqué l'autre. Si c'est le cas, le message est refusé avec « Impossible d'envoyer un message à cet utilisateur » (voir 14.8 pour l'application serveur).
- L'identité de l'expéditeur est revérifiée (l'utilisateur Firebase connecté doit correspondre à l'expéditeur), sinon « Session invalide ».

---

### 14.6 Offres dans le chat (négociation)

Modale d'offre : `components/MakeOfferModal/`. Bulle d'offre : `components/OfferBubble.tsx`. Logique : `services/chatService.ts`.

#### Deux modes : meetup (remise en main propre) et livraison

L'offre peut être de type **meetup** (rencontre, paiement en main propre, sans frais de service) ou **livraison** (avec estimation des frais de transport). **À l'état actuel du produit, la livraison est désactivée** (drapeau `SHIPPING_ENABLED = false`) : en pratique, les offres se font en mode **meetup**. Le mode par défaut bascule en « livraison » uniquement si la livraison est activée ET que l'article est expédiable et non remis en main propre.

#### Créer une offre

Bouton « $ » dans la barre de saisie. Conditions et garde-fous :

- **Article requis** : impossible d'offrir sans article associé.
- **Article vendu** → alerte « Article vendu », offre bloquée.
- **Article inactif** → alerte « Article indisponible », offre bloquée.
- **Une seule offre en attente à la fois** : si l'utilisateur a déjà une offre « en attente » qu'il a envoyée, il ne peut pas en envoyer une seconde (« Offre en cours »).

La modale d'offre guide l'utilisateur par étapes : **montant** → (en mode meetup) **lieu de rencontre** → **confirmation**. Le lieu peut être un des points suggérés par le vendeur ou un lieu choisi. Le récapitulatif rappelle qu'« aucun frais de service » ne s'applique en meetup (paiement en main propre) et que **l'offre expire après 48 h** sans réponse.

#### Contenu d'une offre (données métier)

Une offre porte : un **montant** (en CAD, borné côté serveur à > 0 $ et ≤ 50 000 $), un **statut**, des **détails de meetup** (lieu, et horaire optionnel à convenir), un **historique de négociation** (chaque action : création, contre-prix, contre-lieu, contre-horaire…), et une **date d'expiration** (48 h après l'envoi).

#### Statuts d'une offre

| Statut | Signification |
|--------|---------------|
| `pending` | En attente de réponse |
| `accepted` | Acceptée (déclenche la suite : transaction / meetup) |
| `rejected` | Refusée définitivement |
| `counter_price` | Le destinataire a fait une contre-offre sur le **prix** |
| `counter_location` | Contre-proposition de **lieu** |
| `counter_time` | Contre-proposition d'**horaire** |
| `completed` | Transaction terminée (meetup complété) |
| `expired` | Expirée (après 48 h sans réponse) |

#### Actions possibles sur une offre reçue

Depuis la bulle d'offre :

- **Accepter** : confirmation, puis l'offre passe à `accepted`, un message système « Offre de X $ acceptée » est inséré, et (si l'offre comporte un meetup et qu'aucune transaction n'existe encore) une **transaction meetup est créée** — c'est ce qui marque l'article comme vendu et crée l'enregistrement de transaction.
- **Refuser** : l'offre passe à `rejected`, message système « Offre de X $ refusée ». Si une transaction meetup avait déjà été créée pour cette conversation (au stade en attente / confirmé), elle est **annulée** afin de **remettre l'article en vente**.
- **Contre-offrir** : sur le **prix**, le **lieu**, ou l'**horaire**. L'offre d'origine prend le statut correspondant (`counter_*`) et une **nouvelle offre** est émise dans l'autre sens, avec sa propre expiration de 48 h et l'historique mis à jour. Un message système résume le changement (ex. « Contre-offre : 40 $ → 35 $ », « Nouveau lieu proposé : … », « Nouvel horaire proposé : … »).

#### Cycle du meetup (après acceptation)

- **Confirmer le meetup** : marque le meetup comme confirmé et fait passer la transaction de « meetup en attente » à « meetup confirmé ». Les règles de sécurité réservent cette transition au **vendeur**. Message système « Meetup confirmé ! » avec lieu et horaire.
- **Signaler une absence (no-show)** : l'un des participants signale que l'autre ne s'est pas présenté. L'information est attachée à l'offre (qui a signalé, quand, raison facultative) et un message système indique « No-show signalé. Notre équipe va examiner la situation. »
- **Compléter le meetup** : marque la transaction comme terminée et déclenche, via une fonction serveur sécurisée (`completeMeetupTransaction`), le **crédit du solde vendeur**. L'offre passe à `completed`, message système « Transaction complétée avec succès ! Merci d'utiliser Second. »

#### Expiration des offres (48 h)

Toute offre expire 48 h après son envoi. L'expiration est **appliquée au moment de l'action** : si quelqu'un tente d'accepter ou de contre-offrir une offre dont la date est dépassée, l'offre est marquée `expired` et l'action est refusée avec « Cette offre a expiré ».

#### Garanties de sécurité sur les offres

- Le **montant ne peut pas être modifié** une fois l'offre créée (les règles Firestore interdisent de changer `offer.amount`).
- Seul le **destinataire** d'une offre peut l'**accepter** ou la **refuser** (un expéditeur ne peut pas auto-accepter son offre).
- Les mutations financières réelles (crédit vendeur) passent toujours par une fonction serveur, jamais par le client.

---

### 14.7 Messages système et notifications

#### Messages système

Insérés automatiquement par l'app pour tracer la transaction : offre acceptée/refusée, contre-offres, meetup confirmé, no-show signalé, transaction complétée, et (le cas échéant) génération d'étiquette d'expédition avec numéro de suivi. Ils apparaissent dans le fil (préfixés « ℹ️ » dans l'aperçu de la liste) mais **ne déclenchent pas de notification push**.

#### Notifications push (déclencheur serveur)

Déclencheur : `functions/src/triggers/messages.ts`.

- **À la création d'un message** (`sendMessageNotification`) : une notification push est envoyée au destinataire selon le type :
  - texte → titre = nom de l'expéditeur ; corps = « À propos de "[article]" » si la conversation est liée à un article, sinon le début du texte ;
  - photo → « Photo - "[article]" » ou « Vous a envoyé une photo » ;
  - offre → « Nouvelle offre de [nom] » + « X $ pour "[article]" » ;
  - système → **pas de notification**.
- **Au changement de statut d'une offre** (`sendOfferStatusNotification`) : l'expéditeur initial (souvent l'acheteur) est notifié quand l'autre accepte, refuse ou contre-offre (« Votre offre a été acceptée ! », « Offre refusée », « Nouvelle contre-offre », « Nouveau lieu proposé », « Nouvel horaire proposé »).

**Spécificités d'envoi (impact produit) :**
- Les notifications sont envoyées à **tous les appareils** enregistrés du destinataire ; les jetons invalides sont automatiquement nettoyés.
- **Spécificité iOS connue** : certains jetons « bruts » APNs (jetons natifs iOS) ne sont pas routables directement et sont écartés à l'envoi (sans être supprimés) — un appareil dans ce cas peut ne pas recevoir la push tant que le bon type de jeton n'est pas enregistré. Sur **Android**, les notifications utilisent un canal dédié « messages » en priorité haute avec son.
- La fonction tourne dans la région canadienne `northamerica-northeast1` (cohérent avec l'hébergement des données au Canada).

---

### 14.8 Modération : signalement et blocage

Service : `services/moderationService.ts`. UI de signalement : `components/ReportBottomSheet.tsx`. Actions depuis le chat : `features/chat/hooks/useChatModeration.ts`.

#### Accès aux actions

Depuis l'en-tête de la conversation, le bouton « … » ouvre un menu d'actions :
- **iOS** : feuille d'action native (ActionSheet) avec « Signaler cet utilisateur », « Bloquer cet utilisateur » (destructif), « Annuler ».
- **Android** : une alerte avec les mêmes choix.

#### Signaler

Le signalement ouvre une feuille en bas d'écran (`ReportBottomSheet`) en deux étapes :
1. **Choisir une raison** parmi une liste adaptée à la cible :
   - pour un **utilisateur / message** : Harcèlement ou abus, Arnaque ou fraude, Spam ou publicité, Contenu inapproprié, Autre raison ;
   - pour un **article** : Article contrefait, Article dangereux ou interdit, Arnaque ou fraude, Contenu inapproprié, Spam, Autre raison.
2. **Détails optionnels** (texte libre), puis « Envoyer le signalement ».

Le signalement crée un enregistrement (`reports`) avec : qui signale, le type de cible (utilisateur / article / message), l'identifiant de la cible, la raison, la description, et un statut initial **« en attente »** (`pending`). Confirmation : « Signalement envoyé… Notre équipe va l'examiner dans les plus brefs délais. » Un avertissement rappelle que les **signalements abusifs** peuvent entraîner la suspension du compte.

**Règles de gestion du signalement :**
- Les rapports ne sont **lisibles que par les administrateurs / modérateurs** (l'utilisateur ne voit pas ceux des autres). Le cycle de vie (en attente → examiné → résolu / rejeté, qui a traité, quand, résolution) est **réservé au staff** ; un utilisateur ne peut pas créer un rapport déjà « résolu » ni se faire passer pour un modérateur (verrouillé par les règles de sécurité).
- Le service sait vérifier si un utilisateur a déjà signalé une cible (utile pour éviter les doublons).

#### Bloquer

Confirmation : « Voulez-vous bloquer [nom] ? Cette personne ne pourra plus vous contacter. » Après blocage : alerte de confirmation et **retour automatique** hors de la conversation.

**Comment le blocage est réellement appliqué (point clé) :**

Le blocage n'est pas qu'une préférence d'affichage — il est **appliqué côté serveur**, en défense en profondeur, à trois niveaux :

1. **Données.** Bloquer un utilisateur écrit l'information dans le profil de la personne qui bloque, sous **deux formes** : une liste lisible pour l'interface (objet `{ userId, userName, blockedAt }`) et une **liste plate d'identifiants** (`blockedUserIds`) qui est la **source de vérité lue par les règles de sécurité**. Débloquer retire l'entrée des deux listes.
2. **Règles de sécurité Firestore.** À la création d'un message ou d'une nouvelle conversation, la règle vérifie que le destinataire **n'a pas** l'expéditeur dans sa liste de bloqués (`isNotBlockedBy`). Si c'est le cas, l'écriture est **refusée** par le serveur : le message ne « passe » jamais.
3. **Déclencheur serveur (filet de sécurité).** Comme les messages sont créés directement (sans fonction d'envoi dédiée), le déclencheur `sendMessageNotification` revérifie le blocage **dans les deux sens** : si l'un a bloqué l'autre, le message est **supprimé** avant toute notification. La victime ne reçoit donc jamais le message du bloqueur, même si un client contournait sa propre vérification.

**Limite à connaître (côté client) :** dans l'app, un utilisateur ne peut lire que **son propre** profil (règles de sécurité). La vérification « est-ce que l'autre m'a bloqué ? » n'est donc pas toujours détectable côté client avant l'envoi ; c'est précisément pourquoi le serveur (règles + déclencheur) est l'autorité finale qui empêche le message d'aboutir.

---

### 14.9 Données clés (en langage métier)

| Donnée | Rôle métier |
|--------|-------------|
| Conversation (`chats`) | Le fil entre deux personnes. Porte l'instantané de l'article (titre, photo, prix), le rôle vendeur, le dernier message, et le **compteur de non-lus par personne**. Identifiant déterministe (même paire + même article → même conversation), ce qui évite les fils en double. |
| Message (`messages`) | Une entrée du fil : texte, photo, offre ou système. Porte qui envoie/reçoit, l'horodatage, l'état « lu » et, pour une offre, tous ses détails. **Aucun message n'est supprimable** (sauf le filet anti-blocage côté serveur). |
| Offre | Sous-objet d'un message d'offre : montant (CAD), statut, lieu/horaire de meetup, historique de négociation, expiration 48 h. |
| Rapport (`reports`) | Un signalement : qui, quelle cible, quelle raison, description, statut. Visible uniquement par le staff. |
| Liste de bloqués (profil) | Qui l'utilisateur a bloqué. La forme « plate » sert d'autorisation serveur ; la forme « objet » sert à afficher la liste dans les réglages. |

---

### 14.10 Spécificités Canada

- **Monnaie** : tous les montants d'offre sont affichés et saisis en **dollars canadiens (CAD)**.
- **Remise en main propre (meetup)** : le modèle par défaut est la rencontre en personne, avec proposition de **lieux** (souvent des points publics / quartiers suggérés par le vendeur). Aucun frais de service en meetup (paiement en main propre).
- **Dates et heures** : formatées selon la locale canadienne (français), y compris dans les messages système de contre-offre (ex. « le 12/06/2026 à 14:30 »).
- **Loi 25 (protection des renseignements personnels, Québec)** : le bandeau de suivi de transaction intègre, pour les meetups, un bloc de **transparence et de contestation** sur les décisions automatisées (par ex. l'annulation automatique d'un meetup), conformément aux exigences locales.
- **Hébergement et traitement** : les déclencheurs de messagerie tournent dans la région **`northamerica-northeast1`** (Montréal), cohérent avec la localisation canadienne des données.

---

### 14.11 Limites connues / points d'attention

- **Livraison désactivée** : le mode « livraison » des offres existe dans le code mais est **désactivé** (`SHIPPING_ENABLED = false`). En production, les offres se font en meetup. Les structures de données « livraison » (estimation, étiquette d'expédition) restent présentes pour les transactions historiques et une réactivation future.
- **Notifications push iOS** : les jetons APNs « bruts » ne sont pas routables via le canal d'envoi et sont ignorés ; un appareil concerné peut ne pas recevoir la push de message tant que le bon jeton n'est pas enregistré.
- **Messages système non notifiés** : les confirmations automatiques (meetup confirmé, transaction complétée…) n'envoient pas de push ; elles apparaissent uniquement dans le fil.
- **Conversations « générales » (sans article)** : possibles depuis un profil ; elles tombent dans l'onglet ACHATS et n'affichent ni barre d'article ni bouton d'offre.
- **Photos** : limitées à 1 image par envoi, recompressées (la qualité d'origine n'est pas conservée), EXIF retiré.
- **Texte** : 1000 caractères maximum par message.
