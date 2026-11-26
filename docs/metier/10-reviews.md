## 10. Avis & réputation après-vente

Le système d'avis permet à chaque partie d'une transaction terminée (acheteur **et** vendeur) de noter l'autre partie. C'est le mécanisme central de **confiance** sur une marketplace entre particuliers : la note moyenne et le nombre d'avis s'affichent sur le profil public et participent à la décision d'achat. Cette section décrit le parcours pas à pas, les règles de gestion appliquées côté serveur, les états, les limites et les spécificités Canada / iOS-Android.

### 10.1 Vue d'ensemble

- **Sur quoi porte l'avis** : l'avis évalue **l'autre personne** de la transaction (réputation utilisateur), pas l'article. Un acheteur note le vendeur ; un vendeur note l'acheteur.
- **Bidirectionnel** : les deux parties peuvent laisser un avis sur la même transaction. Chacune a son propre avis (un par personne et par transaction).
- **Trois natures d'avis** : `achat` (laissé par l'acheteur sur le vendeur), `vente` (laissé par le vendeur sur l'acheteur), et `swap` (laissé après un échange d'articles dans la SwapZone — voir 10.8).
- **Composition d'un avis** : une **note de 1 à 5 étoiles** (obligatoire) + un **commentaire texte** (FR). Sur un avis de transaction, le commentaire est **obligatoire** (5 à 2000 caractères) — voir 10.4. Sur un avis d'échange (swap), l'application ne propose **aucun champ commentaire** : seule la note est envoyée.
- **Données stockées** : collection `avis` dans Firestore. Champs métier : auteur (nom + photo), personne notée (champ historiquement nommé `vendeurId`), transaction concernée, type (achat/vente/swap), note 1-5, texte, identifiant et titre de l'article concerné, date de création.
- **Sécurité** : aucune écriture directe par le client n'est autorisée — les règles Firestore refusent création, modification et suppression sur `avis` (`firestore.rules`). La création passe **obligatoirement** par une fonction serveur : `createReview` pour une transaction, `rateSwap` pour un échange. La lecture directe de la collection est ouverte à tout utilisateur connecté.

### 10.2 Où l'utilisateur dépose un avis (points d'entrée)

L'écran d'avis (`/review/{transactionId}`) est atteignable depuis deux écrans ; l'avis d'échange, lui, se dépose directement dans l'écran de l'échange :

| Écran de départ | Qui | Type d'avis produit |
|---|---|---|
| **Mes commandes** (`app/my-orders.tsx`) | l'acheteur | `achat` (note du vendeur) |
| **Mes ventes** (`app/my-sales.tsx`) | le vendeur | `vente` (note de l'acheteur) |
| **Détail d'un échange** (`app/swap/[id].tsx`) | l'un des deux échangeurs | `swap` (voir 10.8) |

Dans chaque carte de transaction, un bouton **« Laisser un avis »** (icône étoile) apparaît uniquement lorsque la transaction est **éligible** (voir 10.3). Une fois l'avis déposé, le bouton est remplacé par un indicateur **« Avis laissé »** (coche verte). L'application sait si l'avis existe déjà car elle interroge en amont, pour chaque transaction terminée, l'existence de l'avis (vérification par identifiant déterministe, voir 10.5). Si cette vérification échoue (réseau, permissions), l'application affiche le bouton par défaut : l'utilisateur peut alors ouvrir l'écran d'avis mais le serveur refusera l'envoi avec « Vous avez déjà laissé un avis pour cette transaction ».

**État réel du parcours aujourd'hui** : la livraison et les paiements sont désactivés par drapeau (`SHIPPING_ENABLED = false`, `PAYMENTS_ENABLED = false` dans `config/featureFlags.ts`). Les statuts d'expédition qui ouvrent l'avis (`delivered`, `completed`) ne sont donc **pas atteignables en pratique** : le seul chemin vivant vers un avis est aujourd'hui la **remise en main propre** finalisée (`meetup_completed`), plus l'échange SwapZone. Les règles décrites ci-dessous restent codées et fonctionneront telles quelles à la réouverture de la livraison.

### 10.3 Conditions d'éligibilité (qui peut noter, et quand)

Un avis ne peut être déposé que si **toutes** les conditions sont réunies. La validation est faite à deux niveaux : d'abord côté application (affichage du bouton + écran), puis de façon **autoritaire** côté serveur (`functions/src/callable/reviews.ts`).

**Conditions vérifiées :**

1. **Utilisateur connecté.** Un invité voit « Connectez-vous pour laisser un avis » ; le serveur rejette tout appel non authentifié.
2. **Transaction terminée.** Trois statuts ouvrent le droit à l'avis :
   - `delivered` (commande livrée, pendant la fenêtre de séquestre de 7 jours) ;
   - `completed` (commande finalisée après la fenêtre de séquestre) ;
   - `meetup_completed` (remise en main propre confirmée par l'une des deux parties).
   Tout autre statut (paiement en attente, expédié non livré, annulé, remboursé, litige…) bloque l'avis. L'écran affiche alors « Vous pourrez laisser un avis une fois la transaction terminée ». Une commande livrée **reste donc notable** après son passage automatique de `delivered` à `completed` : le droit à l'avis ne se perd pas au moment de la libération des fonds.
3. **L'auteur est bien partie à la transaction.** Le serveur vérifie que l'appelant est soit l'acheteur, soit le vendeur. Sinon : refus. Ceci empêche un tiers de noter une transaction qui ne le concerne pas.
4. **La cible est l'autre partie.** La personne notée doit être l'autre membre de la transaction (impossible de désigner un inconnu).
5. **Pas d'auto-évaluation.** On ne peut pas se noter soi-même (vérifié deux fois : sur les données envoyées, puis sur les identifiants réels de la transaction).
6. **Fenêtre de 60 jours.** L'avis doit être déposé dans les **60 jours** suivant la date de finalisation de la transaction. Passé ce délai, le serveur refuse (« La période pour laisser un avis est expirée (60 jours) »). La date de référence est la première disponible parmi : date de finalisation, date de livraison, ou date de remise en main propre. **Limite** : si aucune de ces trois dates n'est présente sur la transaction, la fenêtre n'est **pas** appliquée — l'avis reste possible indéfiniment. En pratique un meetup finalisé pose toujours ces deux dates, donc le cas reste théorique.
7. **Unicité.** Une seule évaluation par auteur et par transaction (voir 10.5).
8. **Le compte noté existe encore.** Le serveur relit le profil de la personne visée (`users/{targetUserId}`) avant d'écrire : s'il a été supprimé, l'avis est refusé avec « Cette personne a supprimé son compte : aucun avis ne peut lui être laissé. » — message que l'écran d'avis affiche tel quel. Ce contrôle est **serveur uniquement** : l'application ouvre quand même l'écran (le profil manquant devient simplement `null`), et le refus n'arrive qu'à l'envoi. Sans lui, l'avis était créé et réinscrivait l'uid effacé dans la collection `avis`, à rebours de la suppression demandée ; la note moyenne, elle, n'était jamais posée — la mise à jour du profil échoue en silence sur un document inexistant.

**Ordre des contrôles — limite connue** : le serveur vérifie l'existence de la transaction, son statut et la fenêtre de 60 jours **avant** de vérifier que l'appelant en est bien partie. Un utilisateur connecté qui devinerait un identifiant de transaction pourrait donc distinguer « transaction inexistante », « transaction non terminée » et « délai expiré » avant d'être refusé. Aucune donnée de la transaction n'est renvoyée, mais l'information de statut fuit. Par ailleurs, `createReview` n'a **aucune limite de fréquence** (pas de garde anti-rafale), contrairement à d'autres fonctions sensibles.

### 10.4 Parcours pas à pas (déposer un avis)

1. Depuis **Mes commandes** ou **Mes ventes**, l'utilisateur appuie sur **« Laisser un avis »** sur une transaction terminée non encore évaluée.
2. L'écran d'avis charge le contexte : aperçu de l'article (image + titre) et nom de l'autre partie, présenté comme « Vendu par {nom} » (côté acheteur) ou « Acheté par {nom} » (côté vendeur).
3. **Note (obligatoire)** : l'utilisateur tape sur les étoiles (1 à 5). Un retour haptique léger accompagne chaque tap. Un libellé apparaît selon la note :

   | Note | Libellé affiché |
   |---|---|
   | 1 | Mauvais |
   | 2 | Décevant |
   | 3 | Correct |
   | 4 | Bien |
   | 5 | Excellent |

4. **Commentaire (obligatoire)** : champ texte libre, **5 caractères minimum**, **2000 maximum** (compteur visible, saisie coupée à 2000). Il n'existe **aucun texte par défaut** : un avis sans commentaire ne peut pas être envoyé.
5. **Envoi** : le bouton « ENVOYER MON AVIS » reste inactif tant que la note vaut 0 **ou** que le commentaire fait moins de 5 caractères. Si l'utilisateur force l'envoi malgré tout :
   - note absente → alerte « Note requise » ;
   - commentaire trop court → alerte « Commentaire requis ».
6. **Confirmation** : retour haptique de succès + alerte « Merci pour votre avis ! Votre évaluation a bien été enregistrée », puis retour à l'écran précédent. Les listes Mes commandes / Mes ventes sont rafraîchies pour que le bouton bascule sur « Avis laissé ».
7. **Effets immédiats** : la note moyenne et le compteur d'avis de la personne notée sont recalculés (10.6), et une notification lui est envoyée (10.7).

**Messages d'erreur serveur traduits à l'écran** : « Vous avez déjà laissé un avis pour cette transaction. » (doublon) · « Vous n'êtes pas autorisé à évaluer cette transaction. » (tiers) · « Votre avis contient des informations invalides. Veuillez le reformuler. » (validation ou filtre de contenu) · « Transaction introuvable. » Pour les trois refus qui partagent le même code — transaction pas encore terminée, fenêtre de 60 jours écoulée, compte noté supprimé — l'écran affiche **le message exact du serveur** (« La période pour laisser un avis est expirée (60 jours). », « Cette personne a supprimé son compte : aucun avis ne peut lui être laissé. ») plutôt qu'un générique qui désignait la mauvaise cause, et ne retombe sur « La période pour laisser un avis est expirée ou la transaction n'est pas encore terminée. » que si le serveur n'a rien renvoyé. **Limite connue** : de ces trois refus, celui de la transaction non terminée est le seul dont le message serveur soit resté en anglais (« Transaction must be completed before reviewing ») ; il ne peut toutefois surgir que si le statut change après l'ouverture de l'écran, celui-ci bloquant sinon le formulaire en amont (voir 10.3). À corriger.

**Protection anti-double envoi** : l'écran bloque les soumissions multiples (verrou local) le temps de l'envoi, et le serveur garantit l'unicité même en cas de double-clic ou de course (voir 10.5).

### 10.5 Règles serveur : unicité, validation, contenu

La fonction serveur `createReview` est la seule autorité d'écriture pour les avis de transaction. Elle applique, dans l'ordre :

- **Champs requis** : personne notée, transaction et type d'avis présents.
- **Note 1-5** : rejet si absente ou hors bornes.
- **Texte 5 à 2000 caractères** : rejet si trop court (< 5) ou trop long (> 2000).
- **Filtre anti-grossièretés (FR)** : une liste fermée d'une vingtaine de termes injurieux/haineux en français est vérifiée. Si le commentaire en contient un, l'avis est refusé avec « Votre avis contient des termes inappropriés. Veuillez le reformuler. » C'est un filtre basique par mots-clés (pas de modération sémantique). **Limite connue** : la recherche se fait par simple sous-chaîne, sans frontière de mot — un avis contenant « Dominique » est bloqué parce qu'il contient « nique ». Symétriquement, une insulte non listée ou volontairement déformée passe sans obstacle.
- **Vérifications d'éligibilité** : existence et statut terminal de la transaction, appartenance de l'auteur et de la cible à la transaction, fenêtre de 60 jours, interdiction de l'auto-évaluation, et **existence du compte noté** — un compte supprimé ne peut plus être évalué (voir 10.3).

**Unicité garantie par conception** : l'avis est stocké sous un identifiant **déterministe** combinant l'auteur et la transaction (`{auteur}_{transaction}`). La création se fait dans une **transaction atomique** qui vérifie d'abord qu'aucun avis n'existe déjà sous cet identifiant. Conséquence :

- un même utilisateur ne peut laisser qu'**un seul avis par transaction** ;
- deux envois simultanés ne créeront jamais deux avis (un seul réussit, l'autre est refusé) ;
- côté application, le message d'erreur affiché devient « Vous avez déjà laissé un avis pour cette transaction. »

C'est ce même identifiant déterministe qui permet à l'application, en amont, de savoir si l'avis existe déjà (pour afficher « Avis laissé » plutôt que le bouton).

**Ce qui est figé et ce qui ne l'est pas** : le **titre de l'article** est copié dans l'avis au moment de sa création et n'est **jamais** remis à jour — un article renommé ou supprimé laisse l'ancien titre dans l'avis. En revanche, le **nom et la photo de l'auteur ne sont pas figés** : un déclencheur serveur (`functions/src/triggers/users.ts`) propage tout changement de nom ou de photo de profil sur **tous les avis déjà écrits par cette personne**, en plus de ses articles, de ses conversations et de ses articles SwapZone. Un avis publié affiche donc toujours l'identité **actuelle** de son auteur.

### 10.6 Propagation aux statistiques de réputation

Après l'enregistrement de l'avis, le serveur recalcule l'agrégat de réputation de la **personne notée** :

- **`rating`** : note moyenne de tous ses avis, arrondie à une décimale (ex. 4,7).
- **`reviewCount`** : nombre total d'avis reçus.

Ce recalcul lit **l'ensemble** des avis reçus par la personne et réécrit les deux valeurs sur son profil. Conséquences métier :

- la note moyenne et le compteur sont toujours cohérents avec les avis réellement présents (recalcul complet, pas incrémental) ;
- comme `vente`, `achat` et `swap` alimentent la même collection, la note d'un utilisateur **mélange** sa réputation d'acheteur, de vendeur et d'échangeur en une seule note globale (il n'y a pas de note séparée « vendeur » / « acheteur ») ;
- un utilisateur sans aucun avis n'a pas de note : le profil affiche « — » à la place du chiffre.

Ce recalcul est **non bloquant** : ses erreurs sont journalisées mais jamais remontées, donc si le recalcul échoue, l'avis reste créé (la cohérence sera rétablie au prochain avis reçu par la même personne). C'est un choix qui privilégie la fiabilité de la création d'avis sur la fraîcheur instantanée de l'agrégat. **Effet de bord à connaître** : sur son **propre** profil, l'utilisateur voit une moyenne et un compteur **recalculés en direct** depuis la collection d'avis (`features/profile/services/userStatsService.ts`), alors que les **visiteurs** de son profil lisent les valeurs **pré-calculées**. Si un recalcul a échoué, les deux affichages divergent jusqu'au prochain avis.

### 10.7 Notification à la personne notée

À la création d'un avis, une notification est envoyée à la personne notée :

- **Titre** : « Nouvel avis reçu »
- **Corps** : « {nom de l'auteur} vous a laissé un avis {note}/5 »
- **Type** : `review_received`, canal Android « notifications », lien profond vers l'écran **Notifications** in-app.

Comportements et limites importants :

- La notification **in-app** (centre de notifications dans l'app) est toujours créée, **même si l'utilisateur a désactivé les push**. Seul le push système est supprimé dans ce cas.
- Il n'existe **pas de réglage par catégorie** pour les avis : contrairement aux messages ou aux commandes, l'utilisateur ne peut pas désactiver spécifiquement les notifications d'avis. Seul l'interrupteur global des push s'applique.
- L'envoi du push est **non critique** : s'il échoue, l'avis reste enregistré.
- **Limite iOS connue** : le client iOS enregistre un jeton APNs « brut » qui n'est **pas routable** via FCM. Le serveur **ignore** ces jetons (il ne sait envoyer que via des jetons FCM). En pratique, **le push système d'avis n'arrive pas de façon fiable sur iOS** dans l'état actuel ; la notification in-app, elle, est bien présente. Sur **Android**, le push système fonctionne (priorité haute, son par défaut, canal dédié). C'est une limite produit factuelle, pas une fonctionnalité absente.

### 10.8 Cas particulier : avis d'échange (SwapZone)

Les échanges d'articles (swap) ont leur propre chemin de notation (`rateSwap`, dans `functions/src/callable/swaps.ts`), mais ils **alimentent la même réputation** :

- éligible uniquement si l'échange est au statut `completed` et que l'appelant est l'un des deux participants ; le bloc de notation (« Comment s'est passé l'échange ? ») n'apparaît dans l'écran d'échange **que** dans ce cas, et disparaît une fois la note posée ;
- score 1-5 ; **aucune fenêtre de temps**, **aucune longueur minimale**, **aucun filtre anti-grossièretés** ne s'appliquent ici (le chemin swap ne partage pas les validations de `createReview`) ;
- un avis par participant et par échange (identifiant déterministe `{participant}_swap_{échange}`) ;
- l'avis est de type `swap`, écrit dans la même collection `avis`, et déclenche le même recalcul de note moyenne et la même notification « Nouvel avis reçu » que les avis transactionnels.

**Trou produit à connaître** : le serveur accepte un commentaire facultatif, mais **l'écran d'échange n'en propose aucun** — il n'envoie que la note. Tous les avis de type `swap` sont donc enregistrés avec un **texte vide** et s'affichent sur le profil comme une carte d'avis sans contenu (nom, étoiles, date, puis rien). Second cas : si un second appel de notation était déclenché pour le même échange, le serveur **n'émet pas d'erreur** — il ne réécrit pas l'avis mais renvoie quand même une notification « Nouvel avis reçu » à l'autre partie. L'interface masquant le bloc après notation, le cas reste marginal.

### 10.9 Affichage sur le profil

La réputation se consulte sur le **profil public** d'un utilisateur (`/user/{id}`) :

- **En-tête de profil** : une ligne de quatre statistiques — Articles, Ventes, **Note** (moyenne à une décimale, ou « — »), Abonnés. Le **nombre** d'avis n'est pas dans cette ligne : il apparaît dans l'onglet **« Avis (N) »** et dans le bandeau de résumé au-dessus de la liste (grosse note + étoiles + « N évaluations »).
- **Liste d'avis** : chaque avis affiche photo et nom de l'auteur, la note en étoiles, la date en français et le texte. Deux chemins de chargement :
  - **son propre profil** : jusqu'à **20 avis** les plus récents, via la fonction serveur de lecture d'avis ;
  - **le profil d'un autre** : les **10 avis** les plus récents, renvoyés par la fonction serveur de profil public.
  Il n'y a **aucune pagination dans l'interface** — pas de bouton « voir plus », pas de défilement infini sur les avis. Les avis plus anciens que ces 10 (ou 20) ne sont donc **pas consultables** dans l'app, même si la fonction serveur sait techniquement paginer (jusqu'à 100 par appel).
- **Cohérence des compteurs** : sur le profil d'un autre utilisateur, le total d'avis et la note moyenne proviennent des valeurs **pré-calculées** (`reviewCount`, `rating`), pas d'un comptage de l'échantillon affiché — « 4,7 (128 avis) » reste juste même si seuls 10 avis sont visibles. Sur son propre profil, ces deux chiffres sont recalculés en direct (voir 10.6).
- **Confidentialité photo** : si l'utilisateur a explicitement masqué sa photo de profil (préférence de confidentialité), sa photo n'est pas exposée dans le profil public. Cette règle porte sur **sa** photo de profil ; les photos des **auteurs** d'avis, elles, sont toujours affichées.
- **Lecture** : la lecture directe de la collection `avis` exige d'être connecté (règle Firestore). La fonction serveur de profil public, elle, **n'exige pas de connexion** : un invité qui ouvre un profil voit donc la note, le compteur et les 10 derniers avis.
- **Limite d'interface** : sur le profil d'un autre utilisateur, la photo de l'auteur d'un avis n'est **pas cliquable** — la fonction serveur de profil public ne renvoie pas l'identifiant de l'auteur. Sur son propre profil, où les avis passent par l'autre fonction, le renvoi vers le profil de l'auteur fonctionne.

### 10.10 États & règles — récapitulatif

| Élément | Règle |
|---|---|
| Statut transaction requis | `delivered`, `completed` ou `meetup_completed` |
| Statut réellement atteignable aujourd'hui | `meetup_completed` uniquement (livraison et paiements désactivés) |
| Délai pour noter | 60 jours après finalisation (non appliqué si aucune date de finalisation) |
| Note | 1 à 5 étoiles, obligatoire |
| Commentaire (transaction) | **Obligatoire**, 5 à 2000 caractères, pas de texte par défaut |
| Commentaire (swap) | Non demandé par l'app → avis de swap toujours sans texte |
| Filtre contenu | Liste FR fermée de termes injurieux/haineux, recherche par sous-chaîne (avis de transaction uniquement) |
| Unicité | 1 avis par auteur et par transaction (identifiant déterministe + transaction atomique) |
| Compte noté | Doit exister — un compte supprimé ne peut plus recevoir d'avis (refus serveur explicite) |
| Bidirectionnel | Acheteur ↔ vendeur peuvent chacun noter |
| Auto-évaluation | Interdite |
| Création | Fonction serveur uniquement (écriture client interdite par les règles Firestore) |
| Lecture | Collection : utilisateur connecté. Profil public (10 derniers avis) : accessible aux invités |
| Modification / suppression | Impossible — ni par l'auteur, ni par la personne notée, ni par un administrateur dans l'app |
| Signalement d'un avis abusif | **Non disponible** dans l'app (seuls un utilisateur, un article ou un message sont signalables) |
| Identité de l'auteur | Suit les changements de nom / photo (propagation automatique) |
| Titre de l'article | Figé à la création, jamais mis à jour |
| Effet sur réputation | Recalcul complet de la note moyenne + compteur de la cible, une seule note globale tous types confondus |
| Notification | « Nouvel avis reçu » in-app (toujours) + push (Android fiable, iOS non fiable) |

### 10.11 Spécificités Canada & plateformes

- **Langue** : interface, libellés de note et filtre de contenu en **français** uniquement (cohérent avec l'app mono-langue FR). Les dates d'avis sont formatées selon la locale canadienne-française.
- **Loi 25 (Québec)** : les avis contiennent un nom d'auteur (prénom ou pseudo) et une photo, visibles publiquement. Deux mécanismes existent déjà :
  - **droit d'accès** : les avis écrits par la personne sont inclus dans son export de données ;
  - **suppression de compte** : les avis **écrits par** la personne sont anonymisés (auteur remplacé par « Utilisateur supprime », photo retirée) et les avis **reçus par** elle sont détachés de son profil ; le contenu des avis n'est pas effacé.
  **Point d'attention de gouvernance** : il n'existe **aucun droit de rectification ni de retrait unitaire** d'un avis — ni l'auteur, ni la personne notée, ni un administrateur ne peuvent modifier ou supprimer un avis depuis l'application. Une correction ou un retrait ponctuel exige aujourd'hui une intervention manuelle en base.
- **iOS vs Android** : le **push système d'avis est fiable sur Android** mais **pas sur iOS** (jetons APNs bruts non routables via FCM, ignorés par le serveur). Sur les deux plateformes, la **notification in-app** reste présente. Aucune autre différence de parcours produit entre iOS et Android pour les avis.
- **Aucune dimension monétaire** : déposer ou recevoir un avis est **gratuit** et n'a **aucun lien avec la monétisation** (forfaits boutiques, frais acheteur, commission). Le système d'avis ne facture rien et ne déclenche aucun mouvement financier ; il sert uniquement la **confiance** et la réputation.

### 10.12 Trous connus (à arbitrer)

1. **Aucune modération d'avis.** Pas de signalement d'un avis dans l'app, pas d'écran d'administration des avis, pas de suppression. Un avis diffamatoire ou erroné reste en ligne définitivement. C'est le trou le plus exposé juridiquement.
2. **Avis de swap vides.** Tous les avis d'échange partent sans texte parce que l'écran ne propose pas de champ commentaire — ils polluent la liste d'avis du profil avec des cartes sans contenu.
3. **Filtre de contenu naïf.** Blocage par sous-chaîne : faux positifs sur des mots légitimes, et contournement trivial par déformation.
4. **Historique d'avis tronqué.** Au-delà des 10 (profil d'autrui) ou 20 (son profil) derniers avis, rien n'est consultable : pas de pagination dans l'interface.
5. **Note globale indifférenciée.** Achat, vente et échange sont fondus dans une seule note ; un acheteur ne peut pas distinguer la fiabilité d'un vendeur de son comportement d'acheteur.
6. **Fenêtre de 60 jours contournable** si la transaction n'a aucune date de finalisation, et **ordre des contrôles** qui laisse fuir le statut d'une transaction à un tiers connecté.
7. **Pas de garde anti-rafale** sur la création d'avis.
