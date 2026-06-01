## 10. Avis & réputation après-vente

Le système d'avis permet à chaque partie d'une transaction terminée (acheteur **et** vendeur) de noter l'autre partie. C'est le mécanisme central de **confiance** sur une marketplace entre particuliers : la note moyenne et le nombre d'avis s'affichent sur le profil public et participent à la décision d'achat. Cette section décrit le parcours pas à pas, les règles de gestion appliquées côté serveur, les états, les limites et les spécificités Canada / iOS-Android.

### 10.1 Vue d'ensemble

- **Sur quoi porte l'avis** : l'avis évalue **l'autre personne** de la transaction (réputation utilisateur), pas l'article. Un acheteur note le vendeur ; un vendeur note l'acheteur.
- **Bidirectionnel** : les deux parties peuvent laisser un avis sur la même transaction. Chacune a son propre avis (un par personne et par transaction).
- **Trois natures d'avis** : `achat` (laissé par l'acheteur sur le vendeur), `vente` (laissé par le vendeur sur l'acheteur), et `swap` (laissé après un échange d'articles dans la SwapZone — voir 10.8).
- **Composition d'un avis** : une **note de 1 à 5 étoiles** (obligatoire) + un **commentaire texte** (FR).
- **Données stockées** : collection `avis` dans Firestore. Champs métier : auteur (nom + photo figés au moment de l'avis), personne notée, transaction concernée, type (achat/vente/swap), note 1-5, texte, titre de l'article concerné, date de création.
- **Sécurité** : aucune écriture directe par le client n'est autorisée. La création passe **obligatoirement** par une fonction serveur (`createReview`) qui vérifie l'éligibilité. La lecture des avis est ouverte à tout utilisateur connecté.

### 10.2 Où l'utilisateur dépose un avis (points d'entrée)

L'écran d'avis (`/review/{transactionId}`) est atteignable depuis deux écrans :

| Écran de départ | Qui | Type d'avis produit |
|---|---|---|
| **Mes commandes** (`my-orders`) | l'acheteur | `achat` (note du vendeur) |
| **Mes ventes** (`my-sales`) | le vendeur | `vente` (note de l'acheteur) |

Dans chaque carte de transaction, un bouton **« Laisser un avis »** (icône étoile) apparaît uniquement lorsque la transaction est **éligible** (voir 10.3). Une fois l'avis déposé, le bouton est remplacé par un indicateur **« Avis laissé »** (coche verte). L'application sait si l'avis existe déjà car elle interroge en amont, pour chaque transaction terminée, l'existence de l'avis (vérification par identifiant déterministe, voir 10.5).

### 10.3 Conditions d'éligibilité (qui peut noter, et quand)

Un avis ne peut être déposé que si **toutes** les conditions sont réunies. La validation est faite à deux niveaux : d'abord côté application (affichage du bouton + écran), puis de façon **autoritaire** côté serveur.

**Conditions vérifiées :**

1. **Utilisateur connecté.** Un invité voit un message « Connectez-vous pour laisser un avis » ; le serveur rejette tout appel non authentifié.
2. **Transaction terminée.** Seuls deux statuts ouvrent le droit à l'avis :
   - `delivered` (commande livrée — flux avec expédition ShipEngine) ;
   - `meetup_completed` (remise en main propre confirmée).
   Tout autre statut (paiement en attente, expédié non livré, annulé, remboursé…) bloque l'avis. L'écran affiche alors « Vous pourrez laisser un avis une fois la transaction terminée ».
3. **L'auteur est bien partie à la transaction.** Le serveur vérifie que l'appelant est soit l'acheteur (`buyerId`), soit le vendeur (`sellerId`) de la transaction. Sinon : refus (« You are not a party to this transaction »). Ceci empêche un tiers de noter une transaction qui ne le concerne pas.
4. **La cible est l'autre partie.** La personne notée doit être l'autre membre de la transaction (impossible de désigner un inconnu).
5. **Pas d'auto-évaluation.** On ne peut pas se noter soi-même.
6. **Fenêtre de 60 jours.** L'avis doit être déposé dans les **60 jours** suivant la date de finalisation de la transaction. Passé ce délai, le serveur refuse (« La période pour laisser un avis est expirée (60 jours) »). La date de référence est la première disponible parmi : date de finalisation, date de livraison, ou date de remise en main propre.
7. **Unicité.** Une seule évaluation par auteur et par transaction (voir 10.5).

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

4. **Commentaire** : champ texte libre, jusqu'à **2000 caractères** (compteur visible). Le commentaire est facultatif côté utilisateur, mais voir la règle ci-dessous.
5. **Envoi** : le bouton « ENVOYER MON AVIS » est inactif tant qu'aucune note n'est choisie. À l'envoi :
   - si la note est absente → alerte « Note requise » ;
   - si un commentaire est saisi mais fait moins de 5 caractères → alerte « Commentaire trop court » ;
   - **astuce produit** : si l'utilisateur ne saisit aucun commentaire, l'application envoie automatiquement le texte par défaut **« Bonne transaction. »** (le serveur exige au moins 5 caractères ; ce texte par défaut satisfait la contrainte). En pratique, un avis n'est donc jamais vide de texte.
6. **Confirmation** : retour haptique de succès + alerte « Merci pour votre avis ! Votre évaluation a bien été enregistrée », puis retour à l'écran précédent.
7. **Effets immédiats** : la note moyenne et le compteur d'avis de la personne notée sont recalculés (10.6), et une notification lui est envoyée (10.7).

**Protection anti-double envoi** : l'écran bloque les soumissions multiples (verrou local) le temps de l'envoi, et le serveur garantit l'unicité même en cas de double-clic ou de course (voir 10.5).

### 10.5 Règles serveur : unicité, validation, contenu

La fonction serveur `createReview` est la seule autorité d'écriture. Elle applique, dans l'ordre :

- **Champs requis** : personne notée, transaction et type d'avis présents.
- **Note 1-5** : rejet si absente ou hors bornes.
- **Texte 5 à 2000 caractères** : rejet si trop court (< 5) ou trop long (> 2000).
- **Filtre anti-grossièretés (FR)** : une liste de termes injurieux/haineux en français est vérifiée. Si le commentaire en contient un, l'avis est refusé avec le message « Votre avis contient des termes inappropriés. Veuillez le reformuler. » C'est un filtre basique par mots-clés (pas de modération sémantique avancée).
- **Vérifications d'éligibilité** : existence et statut terminal de la transaction, appartenance de l'auteur et de la cible à la transaction, fenêtre de 60 jours, interdiction de l'auto-évaluation (voir 10.3).

**Unicité garantie par conception** : l'avis est stocké sous un identifiant **déterministe** combinant l'auteur et la transaction (`{auteur}_{transaction}`). La création se fait dans une **transaction atomique** qui vérifie d'abord qu'aucun avis n'existe déjà sous cet identifiant. Conséquence :

- un même utilisateur ne peut laisser qu'**un seul avis par transaction** ;
- deux envois simultanés ne créeront jamais deux avis (un seul réussit, l'autre reçoit « already-exists ») ;
- côté application, le message d'erreur affiché devient « Vous avez déjà laissé un avis pour cette transaction. »

C'est ce même identifiant déterministe qui permet à l'application, en amont, de savoir si l'avis existe déjà (pour afficher « Avis laissé » plutôt que le bouton).

**Note importante sur le contenu figé** : le nom et la photo de l'auteur sont copiés dans l'avis **au moment de sa création**. Si l'auteur change ensuite son nom ou sa photo, l'avis déjà publié conserve l'ancienne valeur (l'avis n'est jamais réécrit). De même, le titre de l'article est figé dans l'avis.

### 10.6 Propagation aux statistiques de réputation

Après l'enregistrement de l'avis, le serveur recalcule l'agrégat de réputation de la **personne notée** :

- **`rating`** : note moyenne de tous ses avis, arrondie à une décimale (ex. 4,7).
- **`reviewCount`** : nombre total d'avis reçus.

Ce recalcul lit **l'ensemble** des avis reçus par la personne et réécrit les deux valeurs sur son profil. Conséquences métier :

- la note moyenne et le compteur sont toujours cohérents avec les avis réellement présents (recalcul complet, pas incrémental) ;
- comme `vente`, `achat` et `swap` alimentent la même collection, la note d'un utilisateur **mélange** sa réputation d'acheteur, de vendeur et d'échangeur en une seule note globale (il n'y a pas de note séparée « vendeur » / « acheteur »).

Ce recalcul est **non bloquant** : si le recalcul échoue, l'avis reste créé (la cohérence sera rétablie au prochain avis). C'est un choix qui privilégie la fiabilité de la création d'avis sur la fraîcheur instantanée de l'agrégat.

### 10.7 Notification à la personne notée

À la création d'un avis, une notification est envoyée à la personne notée :

- **Titre** : « Nouvel avis reçu »
- **Corps** : « {nom de l'auteur} vous a laissé un avis {note}/5 »
- **Type** : `review_received`, canal Android « notifications », lien profond vers l'écran **Notifications** in-app.

Comportements et limites importants :

- La notification **in-app** (centre de notifications dans l'app) est toujours créée, **même si l'utilisateur a désactivé les push**. Seul le push système est supprimé dans ce cas.
- L'envoi du push est **non critique** : s'il échoue, l'avis reste enregistré.
- **Limite iOS connue** : le client iOS enregistre un jeton APNs « brut » qui n'est **pas routable** via FCM. Le serveur **ignore** ces jetons (il ne sait envoyer que via des jetons FCM). En pratique, **le push système d'avis n'arrive pas de façon fiable sur iOS** dans l'état actuel ; la notification in-app, elle, est bien présente. Sur **Android**, le push système fonctionne (priorité haute, son par défaut, canal dédié). C'est une limite produit factuelle, pas une fonctionnalité absente.

### 10.8 Cas particulier : avis d'échange (SwapZone)

Les échanges d'articles (swap) ont leur propre chemin de notation (`rateSwap`), mais ils **alimentent la même réputation** :

- éligible uniquement si l'échange est au statut `completed` et que l'appelant est l'un des deux participants ;
- score 1-5, commentaire facultatif (peut rester vide pour un swap, contrairement à l'avis transactionnel qui force un texte par défaut) ;
- un avis par participant et par échange (identifiant déterministe `{participant}_swap_{échange}`) ;
- l'avis est de type `swap`, écrit dans la même collection `avis`, et déclenche le même recalcul de note moyenne et la même notification « Nouvel avis reçu » que les avis transactionnels.

### 10.9 Affichage sur le profil

La réputation se consulte sur le **profil public** d'un utilisateur (`/user/{id}`) :

- **En-tête de profil** : note moyenne et **nombre d'avis** (`nombreAvis`) affichés à côté de l'identité.
- **Liste d'avis** : les avis récents sont affichés (nom + photo de l'auteur figés, note en étoiles, texte, date). Le profil public charge un **résumé** (10 avis les plus récents) ; la liste paginée peut en charger davantage (par lots de 20, jusqu'à 100 par appel côté serveur).
- **Cohérence des compteurs** : le nombre total d'avis et la note moyenne affichés proviennent des valeurs **pré-calculées** sur le profil (`reviewCount`, `rating`), pas d'un comptage du seul échantillon affiché — l'« 4,7 (128 avis) » reste juste même si seuls 10 avis sont visibles.
- **Confidentialité photo** : si l'utilisateur a explicitement masqué sa photo de profil (préférence de confidentialité), sa photo n'est pas exposée dans le profil public.
- **Lecture** : la lecture des avis nécessite d'être connecté ; un invité passe par la fonction serveur de profil public, qui ne lit jamais directement la collection `avis`.

### 10.10 États & règles — récapitulatif

| Élément | Règle |
|---|---|
| Statut transaction requis | `delivered` ou `meetup_completed` |
| Délai pour noter | 60 jours après finalisation |
| Note | 1 à 5 étoiles, obligatoire |
| Commentaire | 5 à 2000 caractères ; défaut « Bonne transaction. » si vide (transactionnel) |
| Filtre contenu | Liste FR de termes injurieux/haineux (basique) |
| Unicité | 1 avis par auteur et par transaction (identifiant déterministe + transaction atomique) |
| Bidirectionnel | Acheteur ↔ vendeur peuvent chacun noter |
| Auto-évaluation | Interdite |
| Création | Fonction serveur uniquement (écriture client interdite) |
| Lecture | Tout utilisateur connecté |
| Modification / suppression | Impossible (ni client, ni en l'état actuel — un avis publié est définitif et figé) |
| Effet sur réputation | Recalcul complet de la note moyenne + compteur de la cible |
| Notification | « Nouvel avis reçu » in-app (toujours) + push (Android fiable, iOS non fiable) |

### 10.11 Spécificités Canada & plateformes

- **Langue** : interface, libellés de note et filtre de contenu en **français** uniquement (cohérent avec l'app mono-langue FR).
- **Loi 25 (Québec)** : les avis contiennent un nom d'auteur (parfois prénom/pseudo) et une photo figés ; ce sont des renseignements personnels visibles publiquement. Point d'attention de gouvernance : un avis publié est **définitif et non modifiable/supprimable** dans l'état actuel, ce qui doit être pris en compte vis-à-vis des droits d'accès/rectification (la suppression de compte utilisateur ne réécrit pas les avis déjà laissés par la personne sur autrui).
- **iOS vs Android** : le **push système d'avis est fiable sur Android** mais **pas sur iOS** (jetons APNs bruts non routables via FCM, ignorés par le serveur). Sur les deux plateformes, la **notification in-app** reste présente. Aucune autre différence de parcours produit entre iOS et Android pour les avis.
- **Aucune dimension monétaire** : déposer ou recevoir un avis est **gratuit** et n'a **aucun lien avec la monétisation** (forfaits boutiques, frais acheteur, commission). Le système d'avis ne facture rien et ne déclenche aucun mouvement financier ; il sert uniquement la **confiance** et la réputation.
