## 14. Messagerie & modération

La messagerie est le cœur relationnel de Second : c'est l'espace où acheteur et vendeur négocient, conviennent d'un prix et d'une remise en main propre, échangent des photos, et où la plateforme injecte des messages « système » pour tracer chaque étape de la transaction. C'est aussi le point de contact principal pour la sécurité communautaire : signalement et blocage se déclenchent depuis la conversation. Tout est en français, en dollars canadiens (CAD), et conçu pour le contexte local (rencontres en personne dans des quartiers, lieux publics suggérés).

Cette section décrit le comportement réel de l'application, vérifié dans le code (`app/(tabs)/messages.tsx`, `app/chat/[id].tsx`, `features/chat/`, `features/offers/`, `services/chat/` — 7 modules derrière la façade `services/chatService.ts` —, `services/moderationService.ts`, `functions/src/triggers/messages.ts`, `functions/src/callable/payments/meetup.ts`, ainsi que les règles de sécurité Firestore).

> **Cadre produit actuel.** La livraison (`SHIPPING_ENABLED`) et les paiements marketplace (`PAYMENTS_ENABLED`) sont **désactivés** (`config/featureFlags.ts`). Le seul parcours d'achat actif est la **remise en main propre**, payée en espèces/de la main à la main entre les deux personnes : **aucun argent ne transite par la plateforme** dans le cycle décrit ici.

---

### 14.1 Vue d'ensemble

- **Temps réel.** Les conversations et les messages se mettent à jour en direct, sans rafraîchir : dès qu'un message arrive, il apparaît chez le destinataire connecté. Le badge de non-lus se met à jour de la même façon.
- **Deux niveaux.** Une **liste des conversations** (onglet « Messages ») et une **conversation individuelle** (l'écran de chat).
- **Liée à un article.** La très grande majorité des conversations portent sur un article précis : une barre de contexte rappelle l'article (photo, titre, prix) en haut du chat. Une conversation « générale » (depuis un profil public, ou depuis une fiche de swap) reste possible.
- **Négociation intégrée.** On peut envoyer une **offre de prix** directement dans le chat, avec proposition de lieu de rencontre, puis l'autre partie peut accepter, refuser, ou faire une **contre-offre** (prix, lieu, ou horaire).
- **Messages système.** L'app et le serveur insèrent automatiquement des messages d'information (« Offre acceptée », « Meetup confirmé », « Cet article a été vendu… ») pour que l'historique de la conversation raconte la transaction.
- **Modération en deux temps.** Signaler (rapport envoyé à l'équipe) et bloquer (l'autre ne peut plus écrire). Le blocage est appliqué **côté serveur**, pas seulement dans l'interface.

---

### 14.2 Liste des conversations (onglet « Messages »)

Écran : `app/(tabs)/messages.tsx`.

#### Accès et états

| État | Ce que voit l'utilisateur |
|------|----------------------------|
| Non connecté | Écran « Connexion requise » avec un cadenas, « Connectez-vous pour accéder à vos messages » et un bouton « Se connecter » qui ouvre la feuille d'authentification. Aucune conversation visible. |
| Chargement | 5 lignes squelette (avatar + texte grisés). |
| Erreur | Icône d'alerte + « Erreur » + message. |
| Aucune conversation du tout | Icône bulles + « Aucune conversation » + « Vos conversations avec les acheteurs et vendeurs apparaîtront ici ». |
| Onglet courant vide (mais d'autres conversations existent) | « Rien dans cet onglet » + « Aucune conversation dans « ventes / achats / autres » pour le moment ». |
| Avec conversations | Liste des conversations filtrée par onglet. |

#### Trois onglets : VENTES / ACHATS / AUTRES

La liste est séparée en **trois** onglets, selon le rôle de l'utilisateur dans chaque conversation :

- **VENTES** : conversations où l'utilisateur est le **vendeur** de l'article (il a reçu un message d'un acheteur intéressé).
- **ACHATS** : conversations où l'utilisateur est l'**acheteur** (il a contacté un vendeur au sujet d'un article).
- **AUTRES** : conversations **sans article** — celles ouvertes depuis un profil public ou depuis une fiche de swap. Elles n'ont pas de vendeur identifié, donc ni ventes ni achats.

Le classement repose sur le champ `sellerId` de la conversation : absent → AUTRES ; égal à l'utilisateur courant → VENTES ; sinon → ACHATS.

**Règle d'onglet par défaut** : tant que l'utilisateur n'a pas tapé sur un onglet, l'app affiche le **premier onglet non vide** dans l'ordre VENTES → ACHATS → AUTRES. Ce calcul reste vivant **pendant le chargement** (pas de « flash » d'onglet vide), puis se **fige** dès que la liste est chargée : une conversation qui arrive ensuite en temps réel dans un onglet plus prioritaire ne fait plus basculer l'écran sous le doigt de l'utilisateur. Dès que celui-ci choisit un onglet, son choix l'emporte définitivement pour la durée de l'écran.

**Compteur par onglet** : chaque onglet affiche une pastille avec le total de messages non lus de ses conversations. Les conversations dont l'interlocuteur est **bloqué sont exclues du compte** (une personne bloquée ne peut plus écrire, son historique ne doit pas gonfler la pastille). Au-delà de 99, la pastille affiche « 99+ ».

#### Contenu d'une ligne de conversation

Chaque ligne montre :
- L'**avatar** de l'autre participant (photo de profil à jour si disponible, sinon l'instantané stocké dans la conversation, sinon une silhouette par défaut).
- Une **vignette de l'article** superposée en bas à droite de l'avatar (si la conversation est liée à un article).
- Le **nom** de l'autre participant, suivi soit d'un badge rouge « **Bloqué** » si la personne est bloquée, soit du **titre de l'article** en étiquette discrète.
- Un **aperçu du dernier message**, adapté au type :
  - message texte → le texte ;
  - photo → « [Photo] » ;
  - offre → « [Offre] », « [Contre-offre] » ou « [Offre meetup] » selon le contenu ;
  - aucun message encore → « Aucun message ».
- L'**horodatage** intelligent : l'heure si le message est du jour, « Hier », le jour de la semaine abrégé si moins de 7 jours, sinon la date (jour/mois). Le format suit la locale canadienne (`fr-CA`).
- Une **pastille de non-lus** (nombre, plafonné à « 99+ ») et un **point** sur l'avatar si la conversation contient des messages non lus.

#### Détails de gestion (liste)

- La liste s'appuie sur **un seul abonnement temps réel global** monté une fois au démarrage de l'app (`app/_layout.tsx`), et non un abonnement par écran, pour la performance et la cohérence du badge.
- Les conversations sont triées par **date de dernière activité décroissante** (la plus récente en haut).
- Le **badge de l'onglet « Messages »** dans la barre de navigation reflète le **total** de messages non lus, toutes conversations confondues — **sans** exclure les conversations bloquées, contrairement aux pastilles d'onglets (voir 14.11).
- **Un message système ne fait pas remonter la conversation** dans la liste et n'apparaît pas dans l'aperçu : ces messages n'écrivent ni le « dernier message » ni la date d'activité de la conversation (voir 14.11).

---

### 14.3 La conversation (écran de chat)

Écran : `app/chat/[id].tsx` (route `/chat/{id}`).

#### Garde d'accès et états

- **Invité (non connecté)** : redirection automatique vers l'onglet Profil. Le chat n'est jamais accessible sans compte.
- **Chargement** : squelette de conversation.
- **Erreur** : écran d'erreur dédié avec le message et un bouton « Réessayer » qui relance l'abonnement temps réel.
- **Conversation vide** : « Aucun message » + « Commencez la conversation avec [nom] » (ou « ce vendeur » si le nom est inconnu).

#### Structure de l'écran (de haut en bas)

1. **En-tête** : flèche retour, avatar + nom de l'autre participant (cliquable → ouvre son profil public), prix de l'article en sous-titre, et un bouton « … » (plus d'options) qui ouvre les actions de modération.
2. **Barre de contexte article** (voir 14.4), si la conversation est liée à un article.
3. **Bandeau de suivi de transaction** : si une transaction est associée et qu'elle n'est plus au stade « paiement en attente ». Pour une vente en main propre (meetup), ce bandeau se limite au bloc de **transparence et de contestation** exigé par la Loi 25 lorsqu'une décision automatisée est intervenue (typiquement l'annulation automatique d'un meetup abandonné) ; sinon il n'affiche rien. Pour une vente avec livraison il afficherait le suivi complet — parcours aujourd'hui désactivé.
4. **Liste des messages**, triés par horodatage croissant ; défilement automatique vers le bas dès que le contenu grandit.
5. **Barre de saisie** (voir 14.5) — **remplacée par un bandeau** « Vous avez bloqué cet utilisateur. Débloquez-le pour reprendre la conversation. » si l'interlocuteur est bloqué.

#### Fenêtre de messages chargée

L'écran charge les **50 messages les plus récents** de la conversation, puis suit les nouveaux en direct. Il n'existe **pas encore de « charger plus »** : au-delà de 50 messages, l'historique ancien n'est pas consultable dans l'app.

#### Marquage « lu »

À l'**ouverture** d'une conversation, l'app marque comme lus les messages reçus non lus et **décrémente le compteur de non-lus** du nombre de messages effectivement marqués (décrément relatif, jamais négatif : un message arrivé entre-temps n'est pas perdu). C'est ce qui fait disparaître la pastille.

**Limite** : ce marquage n'a lieu **qu'à l'ouverture**. Un message reçu pendant que la conversation est déjà affichée à l'écran reste compté comme non lu jusqu'à ce que l'utilisateur quitte et rouvre la conversation (voir 14.11).

#### Types de messages affichés

| Type | Rendu |
|------|-------|
| Texte | Bulle de message classique (la sienne à droite, celle de l'autre à gauche, avec avatar), horodatage et accusé de réception. |
| Photo | Bulle image (miniature) ; un appui ouvre l'image en plein écran. |
| Offre | **Bulle d'offre** dédiée avec actions (accepter / refuser / contre-offrir / confirmer le rendez-vous / rencontre effectuée / signaler une absence / annuler la rencontre / donner ma version après un signalement). Les boutons « Confirmer » et « Signaler une absence » sont **indépendants** : le recours est offert aux deux parties dès l'acceptation, y compris avant que le vendeur ait confirmé. |
| Système | Bandeau d'information neutre centré, sans avatar ni accusé. |

**Accusés de réception** (sur ses propres messages) : horloge pendant l'envoi, un ✓ quand le message est parti, un double ✓✓ quand il est distribué, coloré quand il a été lu.

**Envoi optimiste** : le texte saisi apparaît **immédiatement** dans le fil avec le statut « en cours d'envoi », puis est remplacé par le message réel dès confirmation du serveur. En cas d'échec, la bulle est marquée en erreur et une alerte s'affiche.

#### Clavier

La zone de saisie remonte avec le clavier de manière **identique sur iOS et Android** (animation suivant la course du clavier). Il n'y a plus de traitement spécifique par plateforme.

---

### 14.4 Barre de contexte article

Composant : `features/chat/components/ChatArticleBar.tsx`.

En haut du chat (sous l'en-tête), un rappel visuel de l'article concerné :

- **Photo, titre et prix** de l'article. Bouton « VOIR » pour ouvrir la fiche article.
- **Prix vivant vs prix figé** : le chat conserve un instantané du prix. Si le prix actuel de l'article diffère de cet instantané, la barre affiche l'**ancien prix barré** à côté du prix courant.
- **Article vendu** : un cartouche « VENDU » se superpose à la photo et le bouton « VOIR » est désactivé.
- **Article indisponible / supprimé** : la barre affiche « Article indisponible », est grisée, et le bouton « VOIR » disparaît.

**Propagation automatique des changements d'article.** Le titre, l'image et le prix figés dans les conversations sont mis à jour **côté serveur** (déclencheur `onArticleInfoUpdated`) lorsque le vendeur modifie son article : toutes les conversations liées à cet article reçoivent la nouvelle valeur. Le client ne réécrit jamais ces champs lui-même (les règles de sécurité l'interdisent), ce qui évite les divergences entre vendeur et acheteur.

**Conséquence à connaître** : puisque le serveur resynchronise l'instantané, l'affichage « ancien prix barré » n'est visible que dans le court intervalle entre la modification du prix et sa propagation. Ce n'est donc **pas** un historique fiable de baisse de prix pour l'acheteur.

---

### 14.5 Barre de saisie et envoi

Composant : `features/chat/components/ChatInputBar.tsx`. Logique : `app/chat/[id].tsx` + `services/chat/messages.ts`.

La barre contient :
- Un bouton **pièce jointe** (envoi de photo).
- Un **champ texte** multiligne, placeholder « Message... », **limité à 1000 caractères**.
- Un bouton **offre** (« $ ») — affiché **uniquement** si la conversation est liée à un article **et** que la fiche article a pu être chargée (article supprimé → pas de bouton).
- Un bouton **envoyer**, actif seulement quand le texte n'est pas vide et qu'aucun envoi n'est déjà en cours (protection contre le double envoi).

#### Envoi d'un message texte

- Léger retour haptique à l'envoi ; le champ se vide immédiatement (la bulle optimiste prend le relais).
- Le message est créé puis la conversation est mise à jour (dernier message, type, horodatage, **incrément du compteur de non-lus du destinataire**). L'incrément est atomique côté serveur pour éviter de perdre des messages quasi simultanés.
- En cas d'échec, une alerte « Impossible d'envoyer le message ».

#### Envoi d'une photo

- Demande la **permission d'accès à la galerie** ; si refusée, alerte « Permission requise ».
- Une seule image par envoi, recadrable (4:3) au moment de la sélection, **sans métadonnées EXIF**.
- L'image est **redimensionnée et compressée** (max 1024 px de large, qualité 70 %) et une **miniature** (200 px) est générée ; les deux sont téléversées dans le stockage.
- Retours haptiques pendant l'envoi et au succès. Un indicateur de chargement remplace l'icône de pièce jointe pendant l'opération.

#### Garde-fous

- **Anti-soi-même** : impossible de créer une conversation avec soi-même.
- **Anti-blocage (côté app)** : si l'utilisateur a bloqué son interlocuteur, la barre de saisie disparaît (bandeau explicatif) ; toute tentative d'envoi, de photo ou d'offre déclenche une alerte « Utilisateur bloqué — Débloquez cet utilisateur pour… ». La vérification côté client ne peut lire **que la liste de bloqués de l'utilisateur courant** : le cas « l'autre m'a bloqué » est traité par le serveur (voir 14.8).
- **Identité** : l'expéditeur est revérifié à chaque envoi (l'utilisateur Firebase connecté doit correspondre), sinon « Session invalide ».

---

### 14.6 Offres dans le chat (négociation)

Modale d'offre : `features/offers/components/MakeOfferModal/`. Bulle d'offre : `features/offers/components/OfferBubble.tsx`. Logique : `services/chat/offers.ts` et `services/chat/meetup.ts`.

#### Un seul mode actif : le meetup

L'offre peut techniquement être de type **meetup** (rencontre, paiement en main propre, sans frais de service) ou **livraison**. **À l'état actuel du produit, la livraison est désactivée** (`SHIPPING_ENABLED = false`) : toutes les offres partent en mode **meetup**. Le mode « livraison » ne redeviendrait le mode par défaut que si le drapeau était réactivé **et** que l'article est expédiable et non remis en main propre.

#### Où l'on crée une offre

- Depuis le **chat**, bouton « $ » de la barre de saisie.
- Depuis la **fiche article** (« Faire une offre ») : l'app crée ou retrouve la conversation liée à l'article, y poste l'offre, puis ouvre le chat.
- Depuis le **parcours d'achat en main propre** (`app/checkout/meetup.tsx`) : l'app poste une offre meetup structurée dans le chat (« Demande de meetup pour "…" »), avec le lieu choisi ou, à défaut, « À convenir ». **Aucune transaction n'est créée à ce moment-là** — elle l'est seulement à l'acceptation.

Conditions et garde-fous à la création :

- **Article requis** : impossible d'offrir sans article associé ni prix connu.
- **Article vendu** → alerte « Article vendu », offre bloquée.
- **Article inactif** → alerte « Article indisponible », offre bloquée.
- **Une seule offre en attente à la fois** : si l'utilisateur a déjà une offre « en attente » qu'il a envoyée dans ce fil, il ne peut pas en envoyer une seconde (« Offre en cours »).
- **Interlocuteur bloqué** → offre bloquée.

La modale guide l'utilisateur par étapes : **montant** → **lieu de rencontre** → **confirmation**. Le lieu se choisit en deux temps : d'abord le **quartier** (celui du vendeur est marqué « RECOMMANDÉ »), puis le **point de rencontre** dans ce quartier (les points préférés du vendeur apparaissent en tête, marqués « SUGGÉRÉ »). Le récapitulatif indique « Aucun frais de service — paiement en main propre lors du meetup » et rappelle que **l'offre expire après 48 h** sans réponse.

#### Contenu d'une offre (données métier)

Une offre porte : un **montant** (en CAD, borné côté serveur à > 0 $ et ≤ 50 000 $), un **statut**, des **détails de meetup** (lieu, et horaire optionnel « à convenir »), un **historique de négociation** (chaque action : création, contre-prix, contre-lieu, contre-horaire, avec l'ancienne et la nouvelle valeur), et une **date d'expiration** (48 h après l'envoi).

#### Statuts d'une offre

| Statut | Signification |
|--------|---------------|
| `pending` | En attente de réponse |
| `accepted` | Acceptée (déclenche la suite : transaction meetup) |
| `rejected` | Refusée définitivement |
| `counter_price` | Le destinataire a fait une contre-offre sur le **prix** |
| `counter_location` | Contre-proposition de **lieu** |
| `counter_time` | Contre-proposition d'**horaire** |
| `completed` | Transaction terminée (meetup complété) |
| `expired` | Expirée (48 h sans réponse, ou article vendu/retiré, ou acceptation restée sans suite, ou compte de l'expéditeur supprimé) |

#### Actions possibles sur une offre reçue

Depuis la bulle d'offre (seul le destinataire voit ces boutons, et seulement tant que l'offre est « en attente ») :

- **Accepter** : boîte de confirmation, puis tout se joue **côté serveur** en une seule opération atomique (`acceptMeetupOffer`) : l'offre passe à `accepted`, l'**article est marqué vendu**, et la **transaction meetup est créée**. Le serveur détermine lui-même qui est vendeur (le propriétaire de l'article) et qui est acheteur (l'autre participant) — de sorte que **chacun peut accepter l'offre de l'autre**, y compris l'acheteur acceptant une contre-offre du vendeur. Un message système « Offre de X $ acceptée » est inséré. Le serveur refuse si : l'offre a expiré, l'article a disparu ou est inactif, l'article est déjà vendu, le montant dépasse le prix affiché, l'appelant tente d'accepter sa propre offre, ou le compte de l'acheteur — le participant qui n'est pas propriétaire de l'article — a été supprimé (« Cette personne a supprimé son compte : son offre ne peut plus être acceptée. »).
- **Refuser** : réservé à une offre encore « en attente » (sinon « Cette offre n'est plus en attente. »). L'offre passe à `rejected`, message système « Offre de X $ refusée ». Si une transaction meetup **née de cette offre** existait (en attente ou confirmée), elle est **annulée** afin de **remettre l'article en vente** ; une rencontre convenue à partir d'une autre offre du même fil n'est plus touchée.
- **Contre-offrir** : sur le **prix**, le **lieu**, ou l'**horaire** (un menu propose les trois pour une offre meetup). L'offre d'origine prend le statut correspondant (`counter_*`) et une **nouvelle offre** est émise dans l'autre sens, avec sa propre expiration de 48 h et l'historique mis à jour. Un message système résume le changement (« Contre-offre : 40 $ → 35 $ », « Nouveau lieu proposé : … », « Nouvel horaire proposé : … »).

#### Cycle du meetup (après acceptation)

- **Confirmer le rendez-vous** (bouton « Confirmer le rendez-vous ») : réservé au **vendeur**. Passe la transaction de « meetup en attente » à « meetup confirmé » et horodate la confirmation sur le message, en une seule opération serveur (`confirmMeetupTransaction`). Message système « Meetup confirmé ! » avec lieu et horaire.
- **Signaler une absence (no-show)** : proposé aux deux parties. Ce n'est **pas** un simple drapeau : le serveur (`reportMeetupNoShow`) gèle la transaction en **litige**, **déverrouille l'article** pour que le vendeur puisse le remettre en vente, et ouvre un **dossier de litige** pour révision humaine (chemin de recours Loi 25 pour les deux camps). Message système « Absence signalée. Notre équipe va examiner la situation. » Un second signalement par la **même** personne est refusé ; la partie **visée**, elle, peut donner sa version une fois — bouton « Donner ma version » sur la bulle d'offre — et le serveur l'enregistre comme **contre-déclaration** sur la transaction et sur le dossier, sans changer de statut ni retoucher l'article, puis notifie « Signalement contesté » au premier signaleur.
- **Compléter** : proposé à **l'acheteur comme au vendeur** une fois le meetup confirmé. Le serveur (`completeMeetupTransaction`) passe la transaction à « meetup complété », ce qui **ouvre le droit de laisser un avis**. **Aucun crédit de solde vendeur, aucune écriture au registre** : le paiement a eu lieu en main propre, hors plateforme. **Un seul** message système en résulte, écrit par le serveur dans la même transaction que la clôture : « Rencontre confirmée ! La transaction est terminée. Le paiement a été réglé en main propre entre l'acheteur et le vendeur. »
- **Filets automatiques** : une transaction « meetup en attente » jamais confirmée est **annulée automatiquement après 48 h** ; une transaction « meetup confirmé » que personne ne clôture est **annulée automatiquement après 7 jours**. Dans les deux cas l'article redevient vendable, et l'annulation est signalée dans le bandeau Loi 25 du chat.

#### Expiration des offres (48 h)

Toute offre expire 48 h après son envoi. L'expiration est appliquée **à trois endroits** :

1. **Au moment de l'action** : accepter ou contre-offrir une offre périmée la marque `expired` et refuse l'action (« Cette offre a expiré »).
2. **Par un travail serveur horaire** : toutes les offres encore « en attente » dont la date est passée basculent en `expired`, pour que l'état soit juste pour tout le monde même si personne n'a rouvert le chat.
3. **Par un second travail serveur horaire** : une offre **acceptée mais jamais consommée** par une transaction est expirée après 48 h de grâce, pour qu'un prix négocié ne reste pas verrouillé indéfiniment.

**En plus** : quand un article est **vendu** ou **retiré de la vente**, le serveur expire toutes les offres encore en attente le concernant et poste un message système dans chaque conversation (« Cet article a été vendu. Les offres en attente ont été annulées. » / « … a été retiré de la vente… »).

#### Garanties de sécurité sur les offres

- Le **montant ne peut pas être modifié** une fois l'offre créée (les règles Firestore interdisent de changer `offer.amount`).
- Seul le **destinataire** d'une offre peut l'**accepter** ou la **refuser** (un expéditeur ne peut pas auto-accepter son offre) ; l'expéditeur peut en revanche la faire passer à « terminée » dans le cycle meetup.
- Les transitions engageantes (acceptation, confirmation, clôture, no-show) passent **toujours** par une fonction serveur atomique, jamais par une écriture cliente isolée.

---

### 14.7 Messages système et notifications

#### Messages système

Insérés automatiquement pour tracer la transaction. **Le texte est désormais rendu par le serveur** (callable `postChatSystemMessage`) à partir d'un catalogue fermé de types : l'app ne transmet qu'un type et ses paramètres (montant, nom du lieu, horaire), jamais le contenu, et le serveur vérifie qu'elle participe bien à la conversation. Les libellés affichés sont inchangés. Ceux réellement produits aujourd'hui :

| Déclencheur | Message |
|---------|---------|
| Action dans l'app (acceptation) | « Offre de X $ acceptée » |
| Action dans l'app (refus) | « Offre de X $ refusée » |
| Action dans l'app (contre-offres) | « Contre-offre : 40 $ → 35 $ » / « Nouveau lieu proposé : … » / « Nouvel horaire proposé : … » |
| Action dans l'app (confirmation) | « Meetup confirmé ! » + lieu + horaire |
| Action dans l'app (no-show) | « Absence signalée. Notre équipe va examiner la situation. » |
| Action dans l'app (annulation à l'amiable) | « Rencontre annulée d'un commun accord. L'article est de nouveau en vente. » |
| Serveur (clôture) | « Rencontre confirmée ! La transaction est terminée. Le paiement a été réglé en main propre… » |
| Serveur (article vendu / retiré) | « Cet article a été vendu / retiré de la vente. Les offres en attente ont été annulées. » |

Ces messages apparaissent dans le fil mais **ne déclenchent aucune notification push** — et ils ne mettent à jour ni l'aperçu ni la date d'activité de la conversation dans la liste (voir 14.11).

#### Notifications push (déclencheur serveur)

Déclencheur : `functions/src/triggers/messages.ts`.

- **À la création d'un message** (`sendMessageNotification`), le destinataire est notifié selon le type :
  - texte → titre = nom de l'expéditeur ; corps = « À propos de "[article]" » si la conversation est liée à un article, sinon le début du texte ;
  - photo → « Photo - "[article]" » ou « Vous a envoyé une photo » ;
  - offre → « Nouvelle offre de [nom] » + « X $ pour "[article]" » ;
  - système → **pas de notification**.
- **Au changement de statut d'une offre** (`sendOfferStatusNotification`) : l'expéditeur initial de l'offre est notifié quand l'autre accepte, refuse ou contre-offre (« Votre offre a été acceptée ! », « Offre refusée », « Nouvelle contre-offre », « Nouveau lieu proposé », « Nouvel horaire proposé »).

**Spécificités d'envoi (impact produit) :**
- Chaque notification crée **aussi une notification in-app** (cloche + compteur), même quand la push est désactivée.
- Les **préférences de notification** de l'utilisateur sont respectées par catégorie (nouveaux messages, offre reçue, réponse à une offre) : une catégorie désactivée supprime la push **et** la notification in-app. Le coupe-circuit global « push » supprime la push mais conserve la notification in-app.
- Les notifications partent vers **tous les appareils** enregistrés ; les jetons invalides sont automatiquement nettoyés.
- **Spécificité iOS connue** : certains jetons « bruts » APNs (jetons natifs iOS) ne sont pas routables et sont écartés à l'envoi (sans être supprimés) — un appareil dans ce cas peut ne pas recevoir la push tant que le bon type de jeton n'est pas enregistré. Sur **Android**, les messages utilisent le canal « messages » et les offres le canal « offers », en priorité haute.
- Les déclencheurs tournent dans la région canadienne `northamerica-northeast1`.

---

### 14.8 Modération : signalement et blocage

Service : `services/moderationService.ts`. UI de signalement : `components/ReportBottomSheet.tsx`. Actions depuis le chat : `features/chat/hooks/useChatModeration.ts`.

#### Accès aux actions

Depuis l'en-tête de la conversation, le bouton « … » ouvre un menu d'actions :
- **iOS** : feuille d'action native (ActionSheet) avec « Signaler cet utilisateur », « Bloquer cet utilisateur » (destructif), « Annuler ».
- **Android** : une alerte « Options » avec les mêmes choix.

#### Signaler

Le signalement ouvre une feuille en bas d'écran (`ReportBottomSheet`) en deux étapes :
1. **Choisir une raison** parmi une liste adaptée à la cible :
   - pour un **utilisateur** : Harcèlement ou abus, Arnaque ou fraude, Spam ou publicité, Contenu inapproprié, Autre raison ;
   - pour un **article** : Article contrefait, Article dangereux ou interdit, Arnaque ou fraude, Contenu inapproprié, Spam ou publicité, Autre raison.
2. **Détails optionnels** (texte libre), puis « Envoyer le signalement ».

Le signalement crée un enregistrement (`reports`) avec : qui signale, le type de cible, l'identifiant de la cible, le propriétaire de la cible le cas échéant, la raison, la description, et un statut initial **« en attente »** (`pending`). Confirmation : « Signalement envoyé… Notre équipe va l'examiner dans les plus brefs délais. » Un avertissement rappelle que les **signalements abusifs** peuvent entraîner la suspension du compte.

**Règles de gestion du signalement :**
- Les rapports ne sont **lisibles et modifiables que par les administrateurs / modérateurs**, qui disposent d'un écran de back-office dédié (`app/admin/reports.tsx`). Le cycle de vie (en attente → examiné → résolu / rejeté, qui a traité, quand, résolution) est **réservé au staff** : un utilisateur ne peut pas créer un rapport déjà « résolu » ni stamper un faux modérateur (verrouillé par les règles de sécurité).
- Le service sait vérifier si un utilisateur a déjà signalé une cible (utile pour éviter les doublons) — cette vérification n'est pas encore branchée dans l'interface.
- Le type de cible « **message** » est prévu par le service et par les règles, mais **aucun écran ne permet aujourd'hui de signaler un message précis** : depuis le chat on ne signale que l'utilisateur (voir 14.11).

#### Bloquer

Confirmation : « Voulez-vous bloquer [nom] ? Cette personne ne pourra plus vous contacter. » Après blocage : alerte de confirmation et **retour automatique** hors de la conversation. Le déblocage se fait depuis Réglages → Confidentialité → **Utilisateurs bloqués**.

**Comment le blocage est réellement appliqué (point clé) :**

Le blocage n'est pas qu'une préférence d'affichage — il est **appliqué côté serveur**, en défense en profondeur, à trois niveaux :

1. **Données.** Bloquer un utilisateur écrit l'information dans le profil de la personne qui bloque, sous **deux formes** : une liste lisible pour l'interface (objet `{ userId, userName, blockedAt }`) et une **liste plate d'identifiants** (`blockedUserIds`) qui est la **source de vérité lue par les règles de sécurité**. Débloquer retire l'entrée des deux listes.
2. **Règles de sécurité Firestore.** À la création d'un message ou d'une nouvelle conversation, la règle vérifie **dans les deux sens** qu'aucun des deux ne bloque l'autre, et le fait à partir du **vrai** interlocuteur lu dans la conversation côté serveur (jamais du destinataire déclaré par le client, qui pourrait être falsifié). Si un blocage existe, l'écriture est **refusée** : le message ne « passe » jamais.
3. **Règles de mise à jour.** Le blocage vaut aussi sur les **transitions d'offre** et sur l'**aperçu** de la conversation — deux canaux qui restaient ouverts, l'aperçu permettant à une personne bloquée d'afficher son texte et une pastille de non-lu dans la liste de sa victime sans qu'aucun message n'existe. Cette garde est **directionnelle** : la personne QUI bloque garde toutes ses sorties (refuser une offre, annuler la rencontre, signaler une absence), sans quoi l'article resterait verrouillé jusqu'au balayage automatique.
4. **Callable des messages système.** `postChatSystemMessage` écrit en Admin SDK, donc hors des règles : elle applique le blocage elle-même, symétriquement.
5. **Notifications.** Le changement de statut d'une offre ne notifie plus une personne qui a bloqué l'autre — cette voie, déclenchée par une mise à jour et non par une création, échappait entièrement au filet.
6. **Déclencheur serveur (filet de sécurité).** Comme les messages sont créés directement par le client (sans fonction d'envoi dédiée), le déclencheur `sendMessageNotification` revérifie le blocage **dans les deux sens** et **supprime le message** avant toute notification. Il supprime aussi tout message dont l'expéditeur **n'est pas réellement participant** de la conversation visée. La victime ne reçoit donc jamais le message, même si un client contournait sa propre vérification.

**Limite à connaître (côté client) :** dans l'app, un utilisateur ne peut lire que **son propre** profil (règles de sécurité). La vérification « est-ce que l'autre m'a bloqué ? » n'est donc pas détectable côté client avant l'envoi ; c'est précisément pourquoi le serveur (règles + déclencheur) est l'autorité finale. Concrètement, une personne bloquée voit son message partir puis disparaître, sans message d'erreur explicite.

---

### 14.9 Données clés (en langage métier)

| Donnée | Rôle métier |
|--------|-------------|
| Conversation (`chats`) | Le fil entre deux personnes. Porte l'instantané de l'article (titre, photo, prix), le vendeur, le dernier message, et le **compteur de non-lus par personne**. Identifiant déterministe (même paire + même article → même conversation), ce qui évite les fils en double ; une fonction d'administration existe pour fusionner les doublons hérités. |
| Message (`messages`) | Une entrée du fil : texte, photo, offre ou système. Porte qui envoie/reçoit, l'horodatage, l'état « lu » et, pour une offre, tous ses détails. **Aucun message n'est supprimable par un utilisateur** (seul le filet anti-blocage serveur en supprime). |
| Offre | Sous-objet d'un message d'offre : montant (CAD), statut, lieu/horaire de meetup, historique de négociation, expiration 48 h. |
| Rapport (`reports`) | Un signalement : qui, quelle cible, quelle raison, description, statut. Visible uniquement par le staff. |
| Liste de bloqués (profil) | Qui l'utilisateur a bloqué. La forme « plate » sert d'autorisation serveur ; la forme « objet » sert à afficher la liste dans les réglages. |

**Conservation.** Les conversations et les messages **ne sont jamais purgés automatiquement** (aucune règle de rétention ne les vise, contrairement aux notifications, brouillons ou historiques de recherche). Lors de la **suppression d'un compte**, les fils sont **anonymisés** et non effacés : le nom du partant devient « Utilisateur supprime » et son avatar est retiré, l'autre partie conserve l'historique.

---

### 14.10 Spécificités Canada

- **Monnaie** : tous les montants d'offre sont affichés et saisis en **dollars canadiens (CAD)**.
- **Remise en main propre (meetup)** : seul modèle actif, avec proposition de **lieux** (points publics / quartiers suggérés par le vendeur, ou « À convenir »). Aucun frais de service : le paiement se fait en main propre, hors plateforme.
- **Dates et heures** : formatées selon la locale canadienne `fr-CA`, y compris dans les messages système de contre-offre. Le rendu réel de cette locale est **« le 2026-06-12 à 14 h 30 »** — date ISO et heure séparée par « h », convention canadienne-française.
- **Loi 25 (protection des renseignements personnels, Québec)** : le bandeau de suivi intègre, pour les meetups, un bloc de **transparence et de contestation** sur les décisions automatisées (annulation automatique d'un meetup, libération automatique de fonds) avec révision humaine à la demande. Le signalement d'absence ouvre lui aussi un dossier de révision humaine.
- **Hébergement et traitement** : les déclencheurs et fonctions de messagerie tournent dans la région **`northamerica-northeast1`** (Montréal), cohérent avec la localisation canadienne des données.

---

### 14.11 Limites connues / points d'attention

- **Livraison désactivée** : le mode « livraison » des offres existe dans le code mais est **désactivé** (`SHIPPING_ENABLED = false`). Les structures de données « livraison » restent présentes pour l'historique et une réactivation future. Corollaire : une ancienne offre de livraison acceptée n'affiche **plus** de bouton « Payer maintenant » tant que le drapeau est à faux.
- **Contre-offre sur une offre sans meetup** : le code de contre-offre de prix suppose la présence de détails de meetup. Sur une ancienne offre « livraison », la contre-offre **échoue** avec « Impossible d'envoyer la contre-offre ». Sans impact tant que la livraison est désactivée.
- **Messages système invisibles dans la liste** : ils n'écrivent ni « dernier message », ni type, ni date d'activité sur la conversation. Résultat : l'aperçu « ℹ️ … » prévu dans la liste **n'apparaît jamais**, et une conversation dont la dernière activité est un message système (offre acceptée, meetup confirmé) **ne remonte pas** en haut de la liste.
- **Non-lus pendant que le chat est ouvert** : le marquage « lu » ne se fait qu'à l'ouverture. Un message reçu alors que la conversation est affichée reste compté comme non lu (pastille persistante) jusqu'à ce que l'écran soit rouvert.
- **Badge de la barre de navigation vs pastilles d'onglets** : le badge « Messages » compte **toutes** les conversations, y compris celles avec une personne bloquée ; les pastilles VENTES/ACHATS/AUTRES les excluent. Les deux chiffres peuvent donc diverger.
- **Historique limité à 50 messages** : pas de pagination « charger plus ». Les fils longs ne sont pas consultables au-delà des 50 derniers messages. **Exception** : les offres encore actives (`en attente`, `acceptée`) sont **épinglées** par un second abonnement et restent visibles quelle que soit leur ancienneté — sans quoi une rencontre convenue puis noyée sous cinquante messages perdait tous ses boutons, et avec eux toute action possible sur une transaction vivante.
- **Signalement d'un message précis impossible** : le modèle de données et les règles l'acceptent, mais aucun écran ne l'expose. On ne peut signaler que l'utilisateur (depuis le chat ou son profil) ou l'article.
- **Personne bloquée sans retour explicite** : côté expéditeur bloqué, le message part puis est supprimé par le serveur, sans alerte. C'est volontaire (on n'annonce pas un blocage), mais cela peut ressembler à un bug.
- **Étiquette d'expédition dans le fil** : la fonction qui poste un message « Étiquette d'expédition générée + numéro de suivi » existe dans le code mais **n'est appelée nulle part**. Aucun message de ce type n'est produit aujourd'hui.
- **Notifications push iOS** : les jetons APNs « bruts » ne sont pas routables via le canal d'envoi et sont ignorés ; un appareil concerné peut ne pas recevoir la push tant que le bon jeton n'est pas enregistré.
- **Photos** : 1 image par envoi, recompressée (la qualité d'origine n'est pas conservée), EXIF retiré.
- **Texte** : 1000 caractères maximum par message.
