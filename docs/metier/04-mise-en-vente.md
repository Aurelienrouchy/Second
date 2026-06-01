## 04. Mise en vente d'un article

Cette section décrit, de bout en bout, le parcours par lequel un membre de Second met un article en vente : prise de photos, analyse par intelligence artificielle, saisie des détails, fixation du prix et de la livraison, aperçu, publication, puis gestion de l'article une fois publié. Tout ce qui suit reflète le comportement réel de l'application (code sous `app/sell/`, `features/sell/`, `services/aiService.ts`, `services/draftService.ts` et `functions/src/callable/products.ts`).

### 4.1 Vue d'ensemble du tunnel

La mise en vente est un tunnel en 5 écrans, dans cet ordre :

| # | Écran | Rôle métier |
|---|-------|-------------|
| 1 | Capture photo | Prendre / importer 1 à 5 photos de l'article |
| 2 | Photos & analyse IA | Réorganiser les photos et lancer l'analyse automatique qui pré-remplit la fiche |
| 3 | Détails | Vérifier / compléter titre, description, catégorie, état, marque, taille, couleur, matière |
| 4 | Prix & livraison | Fixer le prix et choisir le mode de remise (main propre et/ou expédition) |
| 5 | Aperçu | Voir la fiche telle qu'elle apparaîtra, puis publier |

**Accès réservé aux membres connectés.** L'ensemble du tunnel est verrouillé derrière l'authentification : si un visiteur non connecté tente d'y entrer, une feuille « Connectez-vous pour vendre un article » s'affiche et il est renvoyé à l'accueil. Il n'y a donc pas de mise en vente anonyme.

**Un seul brouillon à la fois.** L'application conserve un unique brouillon d'article en cours sur l'appareil. Recommencer une mise en vente alors qu'un brouillon existe propose d'abord de reprendre ou d'abandonner ce brouillon (voir 4.7).

### 4.2 Étape 1 — Capture des photos

L'écran s'ouvre directement sur la **caméra plein écran** (vue arrière par défaut, bouton pour basculer vers la caméra avant). Des repères visuels (cadre d'angles + texte contextuel) guident le cadrage et changent selon le nombre de photos déjà prises :

- 0 photo : « Cadrez votre article » / « Photo principale face avant »
- 1 photo : « Ajoute un détail » / « Étiquette, défaut, texture… »
- 2 à 4 photos : « Continue ! » / « Dos, côté, étiquette de taille… »

**Règles de gestion :**

- **Maximum 5 photos.** Au-delà, un badge rouge « Maximum atteint » s'affiche et le déclencheur est désactivé.
- **Au moins 1 photo** est requise pour continuer ; sinon une alerte « Aucune photo » bloque la suite.
- Deux sources : prise directe à la caméra, ou import depuis la **galerie** (sélection multiple, dans la limite des emplacements restants).
- Les photos prises sont **compressées** (qualité ~0,7 caméra, ~0,8 galerie) pour alléger l'envoi.
- Une bande de miniatures permet de **supprimer** une photo (croix sur la miniature).
- Quitter avec au moins une photo déclenche une confirmation : « Votre brouillon sera sauvegardé. Vous pourrez le reprendre plus tard. » Quitter sans photo supprime le brouillon vide.

**Permissions (impact iOS / Android) :** l'écran demande l'autorisation d'accès à la caméra au montage. Si l'utilisateur refuse, un écran dédié « permission refusée » s'affiche avec une porte de sortie : importer directement depuis la galerie. Le comportement est identique sur les deux plateformes ; seule la formulation système du dialogue de permission diffère (gérée par l'OS).

**Persistance :** dès la première photo, un brouillon est créé localement et les photos y sont enregistrées (avec une copie locale en cache de l'appareil), de façon débouncée. L'utilisateur peut donc fermer l'app et retrouver ses photos.

### 4.3 Étape 2 — Photos & analyse par IA

Cet écran fusionne la **revue des photos** et l'**analyse automatique**. Au chargement, si au moins une photo est présente, l'analyse IA **démarre automatiquement** (une seule fois). Il reste possible de la relancer manuellement (« Analyser avec l'IA ») ou de choisir « ou remplir manuellement ».

**Gestion des photos sur cet écran :**

- Grille avec une photo **PRINCIPALE** (la première) et des photos secondaires. Toucher une photo secondaire la promeut en principale ; cette première photo sert de vignette partout dans l'app (cartes, recherche, conversations).
- Ajout de photos supplémentaires (toujours dans la limite de 5) et suppression possibles **tant que l'analyse n'est pas en cours** (les actions sont grisées pendant l'analyse).
- Un bloc « Conseils pour de meilleures photos » rappelle : bonne luminosité et fond neutre, montrer les détails et défauts, photos nettes sans reflets.

**Ce que fait l'analyse IA (étapes affichées à l'utilisateur) :**

1. Catégorie détectée
2. Couleur et matière identifiées
3. Lecture de l'étiquette (marque)
4. Génération du titre et de la description

Techniquement, les photos sont d'abord **traitées** sur l'appareil (conversion HEIC/HEIF → JPEG pour les photos iPhone, compression si > 2 Mo, rejet si > 5 Mo), **téléversées** dans le stockage cloud sécurisé, puis envoyées à un modèle d'IA (Gemini, via une fonction serveur) qui renvoie une fiche structurée. La barre de progression et les pastilles (« Catégorie », « Couleur », « Matière », « Marque ») s'animent au fil des phases.

**Données pré-remplies par l'IA :** titre, description, **catégorie** (avec son chemin hiérarchique), **état** parmi `neuf / très bon état / bon état / satisfaisant`, **couleurs**, **matières**, **marque** (avec rapprochement vers une marque connue du catalogue interne), **taille** détectée, et une **suggestion de taille de colis** (petit / moyen / grand). Chaque champ est accompagné d'un **niveau de confiance** servant à afficher un badge « IA » sur les champs proposés.

**Limites et garde-fous :**

- **Quota : 10 analyses par heure et par utilisateur** (limite serveur anti-abus). Au-delà : message « Limite atteinte… réessayez plus tard ».
- **Délai max ~90 secondes** côté application ; au-delà, l'analyse est considérée en échec (« Analyse trop longue »).
- En cas d'erreur (réseau, format, serveur, délai), l'écran propose des recours adaptés : **réessayer**, **changer les photos**, ou **remplir manuellement**. Les images déjà téléversées sont nettoyées en cas d'erreur réelle, mais conservées si l'utilisateur a simplement annulé (pour relancer sans re-téléverser).
- **« Remplir manuellement »** part d'une fiche vide (état par défaut « bon état ») : l'IA n'est jamais une étape obligatoire.

À la fin de l'analyse réussie, un récapitulatif du nombre de champs pré-remplis s'affiche, et l'utilisateur passe à l'étape suivante en touchant **Continuer** (la navigation n'est pas automatique : l'utilisateur garde la main).

### 4.4 Étape 3 — Détails de l'article

Formulaire de vérification / complétion, pré-rempli par l'IA. Les champs proposés par l'IA portent un repère de confiance. Champs :

- **Titre** (obligatoire, max 80 caractères côté saisie).
- **Description** (max 500 caractères côté saisie).
- **Catégorie** (obligatoire) — sélection via une feuille de catégories hiérarchiques ; la suggestion IA est mise en avant.
- **État** — sélecteur parmi les 4 valeurs (`neuf`, `très bon état`, `bon état`, `satisfaisant`).
- **Marque** — recherche/sélection dans une liste de marques, pré-renseignée par la détection IA.
- **Taille** — liste adaptée à la catégorie choisie.
- **Couleur(s)** et **Matière(s)** — sélection **multiple** par pastilles, avec « voir tout » pour la liste complète. Les suggestions IA sont affichées en premier.

**Règles de gestion :**

- Le bouton **Continuer** exige au minimum un **titre non vide**, une **description non vide** et **au moins une catégorie**.
- La saisie est **auto-sauvegardée** dans le brouillon (débounce ~0,5 s) ; quitter propose « Tes modifications seront sauvegardées dans le brouillon ».
- À l'arrivée sur cet écran, le brouillon passe à l'**étape 2**.

### 4.5 Étape 4 — Prix & livraison

**Prix :**

- Saisie numérique nettoyée (chiffres et 2 décimales max).
- **Bornes : prix valide entre 0,01 $ et 10 000 $.** En dessous → « Entrez un prix valide » ; au-dessus → « Le prix maximum est de 10 000 $ ».
- Devise : **dollar canadien (CAD)**, cohérent avec le positionnement Canada de l'app (affichage `$` partout).

**Options de livraison :**

- **Remise en main propre** (meetup) : l'utilisateur choisit un ou plusieurs **quartiers** de rencontre. Si la main propre est activée, **au moins un quartier** est requis.
- **Expédition** : choix d'une **taille de colis** (petit / moyen / grand), la suggestion IA étant pré-sélectionnée. Si l'expédition est activée, une taille de colis est requise.
- Règle commune : **au moins une** option de livraison doit être active.

**Spécificité produit importante — l'expédition est actuellement DÉSACTIVÉE.** Un drapeau de fonctionnalité (`SHIPPING_ENABLED = false`) masque tout le bloc expédition dans l'interface et **force chaque nouvel article en main propre**. Concrètement, tant que ce drapeau reste à `false` :

- Seule la remise en main propre est proposée à la vente.
- Un ancien brouillon configuré en expédition est ramené automatiquement à la main propre lors de sa reprise.
- Le code d'expédition (taille de colis, partenaire logistique) reste en place et réactivable d'un seul interrupteur, sans autre changement.

Cette décision est réversible et n'affecte que l'expérience de mise en vente ; le moteur de paiement et le partenaire d'expédition (ShipEngine) demeurent intégrés en arrière-plan.

**Persistance :** prix et livraison sont auto-sauvegardés dans le brouillon ; l'arrivée sur cet écran fait passer le brouillon à l'**étape 3**.

### 4.6 Étape 5 — Aperçu et publication

L'aperçu affiche la fiche **telle que la verra un acheteur** : carrousel de photos avec badge « APERÇU », marque, titre, prix (en CAD), pastilles (état, taille, couleurs, matières), description, tableau de caractéristiques et badges de livraison (quartiers de main propre ; « Expédition » uniquement si le drapeau est actif).

Deux actions : **Publier l'annonce** ou **Modifier** (revenir en arrière).

**Au moment de publier, l'application effectue une dernière validation locale :**

- Titre ≥ 3 caractères.
- Prix > 0 et ≤ 10 000 $.
- Au moins une photo.
- Au moins une catégorie.

Si une de ces conditions manque, une alerte « Informations manquantes » liste les erreurs et bloque la publication. Un garde anti-double-clic empêche les publications en double.

**La publication passe obligatoirement par le serveur** (fonction `createArticle`). Le serveur re-valide tout, indépendamment du client, et applique des règles métier renforcées :

- **E-mail vérifié obligatoire.** Un compte dont l'e-mail n'est pas vérifié ne peut pas publier (« Veuillez vérifier votre adresse e-mail avant de publier. »). Les connexions Google / Apple sont considérées vérifiées d'office.
- Re-validation : titre ≥ 3 caractères, prix entre 0,01 $ et 10 000 $, 1 à 10 images (limite de sécurité serveur ; la limite produit reste 5 côté app), état valide, au moins une catégorie.
- **Nettoyage du texte** : suppression des balises HTML, titre tronqué à 200 caractères, description à 5 000 caractères.
- **Normalisation de la marque** : rapprochement vers une marque connue du catalogue (nom canonique) ou mise en forme propre (Title Case) sinon.
- La **taille** est stockée sous forme structurée `{ valeur, système }` (système de taille « EU » par défaut côté vendeur).
- Couleurs / matières / quartiers sont stockés en **listes** (multi-sélection) avec conservation d'une valeur unique pour compatibilité.

**Pas d'onboarding Stripe imposé à la publication.** Créer un article n'oblige plus le vendeur à ouvrir un compte de paiement. L'onboarding paiement (Stripe Connect Custom, white-label) n'est exigé qu'au moment où un article en **expédition** est acheté ; la main propre n'en dépend pas.

**État initial de l'article publié :**

- `isActive = true` (en ligne), `isSold = false` (disponible).
- **Modération : `moderationStatus = approved`** dès la création. La mise en vente est donc **immédiate**, sans validation manuelle préalable. La notion de modération existe dans le système (un statut `pending`/`rejected` retirerait l'article de la recherche), mais le flux de publication standard publie directement en « approuvé ».
- Compteurs à zéro : vues, mentions « j'aime », favoris.

**Indexation pour la recherche.** Dès que l'article est créé, un automatisme serveur alimente un **index de recherche** dédié : génération de mots-clés (à partir du titre, de la description, de la marque et de la catégorie), copie des champs filtrables (catégorie, marque, couleurs, matières, taille, état, prix), vignette, données vendeur et un **score de popularité**. Seuls les articles actifs et non bloqués en modération y figurent. En parallèle, les statistiques du vendeur sont recalculées (nombre d'articles listés / actifs / vendus, vues, mentions « j'aime »).

**Après publication réussie :**

- Le **brouillon est supprimé** (les photos déjà téléversées sont conservées pour l'article).
- Une **fenêtre de succès** s'affiche, proposant de **voir l'article** publié ou de **revenir à l'accueil**.

### 4.7 Brouillons & reprise

L'application gère un **brouillon unique** persistant sur l'appareil (stockage local), incluant : photos (cache local + URLs cloud après analyse), résultat IA, champs de détails, prix/livraison, et l'**étape atteinte** (1 à 4).

- **Reprise :** en revenant dans l'onglet « Vendre », si un brouillon avec photos existe, une **fenêtre « reprendre le brouillon »** s'affiche. Reprendre renvoie l'utilisateur **exactement à l'étape où il s'était arrêté** (capture, détails, prix ou aperçu). Abandonner supprime le brouillon et repart de la caméra.
- **Expiration : 14 jours.** Un brouillon plus ancien est automatiquement supprimé au chargement (avec nettoyage des images locales et cloud associées). Un indicateur de jours restants est disponible.
- Un nettoyage au démarrage supprime les images locales orphelines (n'appartenant à aucun brouillon courant).

### 4.8 Gestion des articles existants

Depuis l'écran « Mes articles », le vendeur gère son catalogue. Les articles sont filtrables entre **En vente** et **Vendus**.

**Actions par article (menu contextuel) :**

| Action | Disponibilité | Effet |
|--------|---------------|-------|
| Modifier | Article **non vendu** uniquement | Ouvre l'écran d'édition |
| Marquer comme vendu / Remettre en vente | Toujours | Bascule l'état vendu/disponible |
| Supprimer | Toujours | Retrait de la vente (désactivation) |

**Marquer comme vendu** passe par le serveur (`toggleArticleSold`) et **refuse la bascule si une transaction est en cours** sur l'article (offre acceptée, rendez-vous main propre en attente/confirmé, ou expédition en cours). Quand un article devient « vendu », un automatisme **expire les offres en attente** dans les conversations liées et **informe** les acheteurs concernés par un message système ; l'article disparaît de la recherche.

**Supprimer** est en réalité une **désactivation** (`isActive = false`) : l'article n'est pas effacé mais retiré de la vente et de l'index de recherche. Là aussi, les offres en attente associées sont expirées et les participants notifiés.

**Édition d'un article (`updateArticle`, côté serveur) :**

- **Interdite sur un article vendu** (« Impossible de modifier un article vendu ») ou désactivé.
- **Interdite si une transaction est en cours** sur l'article (verrou de cohérence).
- Champs modifiables : titre, description, prix, état, catégorie, photos, marque, taille, couleurs, matières, options de livraison, taille de colis, quartiers, et activation/désactivation.
- **Baisse de prix :** si le nouveau prix est **inférieur** à l'ancien, le système enregistre automatiquement le **prix d'origine**, le **pourcentage de baisse** et la **date de la baisse**. Ces informations alimentent l'affichage « prix réduit » côté acheteurs.
- Toute modification du **titre, du prix ou de la première photo** est **propagée automatiquement** aux conversations qui référencent l'article (titre, vignette et prix affichés dans le chat restent à jour).

### 4.9 Spécificités Canada et iOS / Android

- **Devise :** prix saisis et affichés en **dollars canadiens (CAD)**, plafonnés à 10 000 $.
- **Lieux de remise :** la main propre repose sur des **quartiers** (logique locale Canada), seule option active tant que l'expédition est désactivée.
- **Loi 25 (Québec) / vie privée :** la mise en vente n'expose aucune donnée sensible nouvelle ; les photos transitent par un stockage cloud sécurisé, et les images d'un brouillon abandonné/expiré sont supprimées (local + cloud).
- **iOS :** les photos iPhone au format **HEIC/HEIF** sont converties en JPEG avant analyse et publication ; les écrans de saisie ajustent le clavier (comportement « padding ») pour ne pas masquer les champs.
- **Android :** comportement équivalent ; pas de gestion de clavier spécifique sur ces écrans (le système gère le redimensionnement). Les dialogues de permission caméra/galerie diffèrent visuellement selon l'OS mais offrent le même repli (import galerie si la caméra est refusée).
- **Plateformes identiques sur le fond :** le tunnel, les règles de validation, l'IA, les quotas et la publication serveur sont strictement les mêmes sur iOS et Android — il n'y a pas de fonctionnalité de mise en vente réservée à une seule plateforme.

### 4.10 Monétisation (ce que la mise en vente coûte au vendeur)

- **Publier un article est gratuit** et **sans commission vendeur** : le vendeur conserve l'intégralité de son prix de vente. Il n'y a ni frais de mise en ligne, ni prélèvement sur le montant affiché.
- Le modèle économique repose sur les **frais côté acheteur** (et, séparément, sur l'offre payante « Boutiques » qui réduit ces frais acheteur) ; la mise en vente elle-même n'engendre aucun coût direct pour le vendeur.
- L'analyse IA est offerte au vendeur, dans la limite anti-abus de **10 analyses par heure**.
