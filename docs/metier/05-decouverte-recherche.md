## 05. Découverte, recherche & navigation

Cette section décrit comment un utilisateur de Second trouve des articles : ce qu'il voit en arrivant (le feed d'accueil), comment il cherche un article précis (recherche texte, filtres, photo), comment il navigue par catégories et marques, et comment il met en place des alertes pour ne rien rater. Tout est documenté tel que l'application le fait réellement aujourd'hui (code vérifié), y compris les limites connues.

---

### 5.1 Vue d'ensemble du parcours de découverte

Trois portes d'entrée vers le catalogue coexistent :

1. **L'accueil (le feed)** — l'écran d'arrivée de l'app, organisé en sections thématiques (nouveautés, baisses de prix, marques tendance, vendeurs en vedette, recommandations personnelles, SwapZone). C'est la découverte « passive », façon vitrine éditoriale.
2. **La recherche** — un écran dédié, accessible depuis la barre de recherche de l'accueil, où l'utilisateur tape un mot-clé, applique des filtres, ou navigue dans l'arborescence de catégories. C'est la découverte « active ».
3. **La recherche visuelle (par photo)** — l'utilisateur prend une photo (ou utilise une image) et l'app retrouve les articles visuellement similaires dans le catalogue.

À cela s'ajoutent deux mécanismes de fidélisation : **l'historique de recherche** (les recherches récentes réapparaissent) et les **recherches sauvegardées avec alertes** (notification push quand un nouvel article correspond).

---

### 5.2 L'accueil / le feed

L'accueil est l'onglet d'arrivée. Il se compose d'un **en-tête fixe** (barre de recherche + accès appareil photo + cloche de notifications + raccourcis catégories) et d'un **enchaînement vertical de 7 sections** affichées dans cet ordre :

| Ordre | Section | Contenu | Source des données | Fraîcheur (mise en cache) |
|------|---------|---------|--------------------|---------------------------|
| 1 | **Tendances** | Carrousel horizontal de pastilles de marques les plus représentées dans le catalogue, avec nombre d'articles | Serveur (`getTrendingBrands`) | ~1 h (les tendances changent au plus une fois par jour) |
| 2 | **Nouveautés** | Carrousel horizontal des 10 articles les plus récents | Serveur (`getNewArrivals`) | ~10 min |
| 3 | **Pour toi** | Carrousel personnalisé selon le profil de style de l'utilisateur | Recherche filtrée par marques/tailles du profil | À chaque ouverture |
| 4 | **SwapZone** | Bande sombre éditoriale présentant la zone de troc généraliste | Serveur (zone unique) | — |
| 5 | **Baisses de prix** | Carrousel des articles récemment baissés, avec pourcentage de réduction | Serveur (`getPriceDrops`) | ~10 min |
| 6 | **Vendeurs en vedette** | Vendeurs les mieux « likés » | Serveur (`getFeaturedSellers`) | ~30 min |
| 7 | **Explorer** (Discover) | Grille verticale d'articles à défilement infini | Serveur (`getNewArrivals` paginé) | ~10 min |

**Règles de gestion importantes :**

- **Chargement progressif (économie de ressources).** Chaque section interroge le serveur indépendamment, et **seulement quand elle entre dans le champ de vision** lors du défilement. C'est un choix d'architecture : à l'ouverture, seules les premières sections visibles déclenchent un appel serveur ; les autres se chargent au fur et à mesure du scroll. Cela réduit la charge et le temps d'affichage initial.
- **Sections qui disparaissent si vides.** Une section ne s'affiche pas si elle n'a aucun contenu : « Nouveautés », « Baisses de prix » et « Tendances » se masquent automatiquement si le serveur ne renvoie rien.
- **Isolation des erreurs.** Chaque section est encadrée par une barrière d'erreur : si l'une plante, les autres restent affichées (l'accueil ne « tombe » jamais en entier).
- **Retour en haut.** Re-toucher l'onglet Accueil alors qu'on y est déjà fait remonter la liste en haut.

**Les sections en détail :**

- **Tendances (marques).** Le serveur examine jusqu'à 500 articles actifs et non vendus, regroupe par marque **sans tenir compte de la casse** (« SELECTED », « selected » et « Selected » comptent comme une seule marque), ignore les articles sans marque, et renvoie le **top 10**. Toucher une pastille ouvre la recherche pré-filtrée sur cette marque. Le « Voir tout » de la section renvoie vers la recherche.
- **Nouveautés.** Les 10 articles les plus récents (actifs, non vendus), triés par date de création décroissante. « Voir tout » renvoie vers la recherche.
- **Pour toi.** Ne s'affiche que si l'utilisateur a un **profil de style** (généré par IA, champ `styleProfile`) **ou** des **préférences manuelles** (marques favorites, tailles). L'app construit alors une recherche filtrée sur ces marques/tailles, en **excluant les articles de l'utilisateur lui-même**. Si l'utilisateur n'a aucun profil, ou si la recherche ne renvoie rien, la section est entièrement masquée. C'est la brique de recommandation personnalisée de l'app.
- **Baisses de prix.** Le serveur lit les articles ayant connu une baisse de prix récente (champ `lastPriceDropAt`), calcule le pourcentage de réduction (`(prix d'origine − prix actuel) / prix d'origine`) et les classe par réduction décroissante. Chaque carte affiche le pourcentage (ex. « -30 % »). La baisse de prix elle-même est enregistrée côté vendeur : quand un vendeur baisse le prix d'un article (fonction sécurisée `recordPriceDrop`), le nouveau prix doit obligatoirement être **inférieur** à l'ancien, sinon l'opération est refusée.
- **Vendeurs en vedette.** Le serveur classe les vendeurs par nombre de « likes vendeur » décroissant (seuls les vendeurs avec au moins 1 like sont éligibles), top 20. On peut « liker » un vendeur (opération sécurisée et transactionnelle qui incrémente son compteur), ce qui alimente ce classement.
- **SwapZone.** Présentée ici comme une bande sombre cliquable qui mène à la zone de troc. C'est une **zone généraliste permanente unique** (pas d'événement à durée limitée). Elle affiche un compteur de « nouveautés cette semaine ». Si aucune zone n'est active côté serveur, la bande devient un simple visuel non cliquable. (Le fonctionnement détaillé du troc est couvert dans la section dédiée à la SwapZone.)
- **Explorer (Discover).** Grille verticale à défilement infini qui rejoue la même source que « Nouveautés » mais paginée (20 articles par page). C'est le « fond de catalogue » que l'on déroule en bas de l'accueil.

**En-tête de l'accueil :**

- **Barre de recherche** (« Rechercher… ») : un simple bouton qui ouvre l'écran de recherche dédié (pas de saisie inline).
- **Appareil photo** : ouvre directement la caméra de recherche visuelle (voir 5.5).
- **Cloche de notifications** : ouvre le centre de notifications ; une pastille indique le nombre de non-lus (affiché « 9+ » au-delà de 9).
- **Raccourcis catégories** : une rangée horizontale de tags reprenant les **grandes catégories de premier niveau** (Femmes, Hommes, etc.). Toucher un tag ouvre la recherche pré-filtrée sur cette catégorie.

---

### 5.3 La recherche textuelle

L'écran de recherche est l'outil central de découverte active. Il combine, sur un seul écran : la barre de recherche, une rangée de filtres, et la zone de résultats (ou l'écran « recherches récentes » quand rien n'est encore lancé).

**Parcours pas à pas :**

1. L'utilisateur ouvre la recherche (depuis l'accueil, un raccourci catégorie, une pastille de marque, ou une recherche sauvegardée).
2. Si l'écran s'ouvre **sans contexte** (pas de mot-clé ni filtre pré-rempli), le clavier prend automatiquement le focus et l'écran « recherches récentes / tendances » s'affiche.
3. L'utilisateur tape un terme et valide. La recherche se lance, le clavier se replie, et la grille de résultats s'affiche.
4. Une **barre d'info résultats** indique le nombre d'articles trouvés (ex. « 24 articles trouvés », ou « 20+ articles trouvés » s'il reste des pages à charger).
5. Le défilement en bas de grille charge automatiquement la page suivante (pagination par lots de 20).

**Règles de gestion :**

- **Anti-rebond (debounce) de 350 ms** : la recherche n'est pas relancée à chaque frappe, mais après une courte pause de saisie, pour éviter les appels serveur inutiles.
- **Auto-masquage des résultats** : si l'utilisateur efface le terme et retire tous les filtres, l'écran revient automatiquement à l'état « recherches récentes ».
- **Une recherche peut être déclenchée par un terme, par un filtre, ou par une catégorie** — les trois sont des entrées valides (on peut chercher sans mot-clé, uniquement avec des filtres).
- **Bouton « Effacer tout »** : visible dès qu'un filtre est actif ; réinitialise terme, filtres, catégorie, tri et fourchette de prix d'un coup.
- **Gestion d'erreur** : en cas d'échec réseau, un écran « Une erreur est survenue / Vérifiez votre connexion » avec bouton « Réessayer » s'affiche.

**Comment fonctionne la recherche par mot-clé (logique métier) :**

- Le moteur est **maison, basé sur Firestore** (pas de moteur de recherche tiers type Algolia/Elastic). Les articles sont indexés dans une collection dédiée (`search_index`) qui contient une liste de **mots-clés** par article (titre + description + marque, normalisés).
- Le terme tapé est **normalisé** comme à l'indexation : passage en minuscules, **suppression des accents** et de la ponctuation. « Été » et « ete » trouvent donc les mêmes résultats — utile pour le français.
- Le **premier mot** normalisé sert de filtre serveur principal ; les **mots suivants** doivent **tous** être présents dans les mots-clés de l'article (logique « ET »). Chercher « veste cuir noir » exige que l'article contienne les trois.
- Un terme qui ne donne aucun mot exploitable (uniquement de la ponctuation ou des accents) renvoie une page **vide** plutôt que tout le catalogue — pas de résultat parasite.
- En mode mot-clé, l'ordre des résultats est l'ordre de **pertinence/popularité** (score de popularité). C'est pour cela que les tris par prix/date sont désactivés tant qu'un mot-clé est présent (voir 5.4, « Tri »).

**Spécificité Canada (devise) :** toutes les fourchettes de prix, étiquettes et résumés affichent les montants en **dollars canadiens (CAD)**, avec le symbole « $ ».

---

### 5.4 Les filtres et le tri

Sous la barre de recherche, une rangée de **chips de filtre** (étiquettes cliquables) permet d'affiner. Chaque chip s'affiche en gris quand inactif, et en surbrillance avec son libellé une fois renseigné. Un petit « x » sur le chip retire ce filtre précisément.

**Filtres disponibles :**

| Filtre | Type de sélection | Détails métier |
|--------|-------------------|----------------|
| **Tri** | Choix unique | Plus récents (défaut) · Populaires · Prix croissant · Prix décroissant |
| **Catégorie** | Arborescence | Navigation hiérarchique multi-niveaux (voir 5.6) |
| **Couleur** | Multi-choix | Palette de couleurs prédéfinies |
| **Taille** | Multi-choix | Système **US / EU** + bascule Adulte / Enfant |
| **Matière** | Multi-choix | Liste de matières prédéfinies |
| **Marque** | Multi-choix | Sélecteur de marques dédié |
| **État** | Choix unique | Neuf avec étiquette · Très bon état · Bon état · Satisfaisant |
| **Prix** | Fourchette | Min et/ou Max en CAD |

**Règles de gestion des filtres :**

- **Le libellé du chip s'adapte au nombre de valeurs.** Ex. couleur : « Couleur » (vide) → « Rouge » (1) → « 3 couleurs » (plusieurs). Idem pour tailles, matières, marques.
- **Le prix est inversé automatiquement si min > max.** Si l'utilisateur saisit un minimum supérieur au maximum, l'app permute les deux valeurs au moment d'appliquer. Les valeurs négatives sont ignorées.
- **Les tailles ne se confondent jamais entre systèmes.** Une taille est stockée comme un couple `{valeur, système}` (ex. `{42, EU}`). Retirer « 42 EU » ne retire pas « 42 US » : le filtrage compare valeur **et** système. C'est important pour un marché nord-américain où US et EU coexistent.
- **Une recherche peut s'effectuer uniquement avec des filtres**, sans mot-clé (ex. « tous les articles en cuir, taille 40 EU, moins de 50 $ »).

**Règles de gestion du tri (subtilité importante) :**

- **Sans mot-clé** : les 4 tris sont disponibles (récents, populaires, prix croissant, prix décroissant).
- **Avec un mot-clé** : seul le tri « **Populaires** » reste proposé. Les tris prix/date sont **masqués**, et si un tri incompatible était sélectionné, l'app **bascule automatiquement** sur « Populaires » pour que l'étiquette du chip ne mente jamais.
- **Pourquoi ?** En mode mot-clé, le serveur ne peut ordonner que par score de popularité. Trier par prix ne réordonnerait que la page courante (résultat globalement faux et documents sautés). L'app interdit donc proprement ce cas plutôt que de produire un classement trompeur. C'est une limite assumée du moteur Firestore maison.

**Tri par proximité géographique — état réel :** le moteur de recherche **prévoit** un tri par distance (calcul de distance entre l'acheteur et la localisation de l'article), mais **il n'est pas activé** dans l'écran de recherche actuel : aucune position géographique n'est transmise au moteur, et le hook de géolocalisation renvoie toujours une position vide. En pratique, **il n'y a donc pas, aujourd'hui, de fonction « articles à proximité »** côté découverte, même si la plomberie technique existe en réserve. À documenter comme **non disponible** côté produit.

---

### 5.5 La recherche visuelle (par photo)

L'utilisateur peut chercher un article à partir d'une **photo** plutôt que de mots. C'est une fonctionnalité différenciante, alimentée par l'IA.

**Parcours pas à pas :**

1. Depuis l'accueil (icône appareil photo) ou depuis l'écran de recherche (icône caméra), l'utilisateur ouvre la **caméra de recherche visuelle**.
2. Il prend une photo (ou en sélectionne une).
3. L'app **prépare l'image** : conversion en JPEG (les formats HEIC/HEIF d'iPhone sont convertis), **compression et redimensionnement** (cible ~1 Mo, plafond 4 Mo, largeur réduite à 1024 px puis 768 px si besoin). Cela limite la bande passante et accélère le traitement, notamment sur les photos lourdes des iPhone récents.
4. L'app envoie l'image au serveur, qui génère une **empreinte visuelle (embedding)** via l'IA de Google (Vertex AI, modèle multimodal) et la compare aux empreintes de tous les articles actifs du catalogue (recherche de plus proches voisins).
5. L'écran « Résultats visuels » affiche une grille des articles similaires, chacun avec un **pourcentage de similarité** affiché en pastille (ex. « 78 % »).

**Règles de gestion :**

- **Seuil de similarité.** Seuls les articles dépassant un certain niveau de ressemblance sont retournés (~45 % minimum). En dessous, l'article est écarté pour éviter les résultats hors-sujet.
- **Jusqu'à 20 résultats** par recherche par défaut.
- **Fonctionne aussi sans compte.** La recherche visuelle est accessible même non connecté, mais avec une **limite de débit plus stricte** : 5 recherches/minute pour un visiteur anonyme contre 20/minute pour un utilisateur connecté. Au-delà, un message « Vous avez atteint la limite de recherches » s'affiche.
- **États clairs.** Pendant l'analyse : aperçu flou de la photo source + « Analyse de l'image… ». En cas d'absence de résultats : « Aucun produit similaire trouvé » avec proposition de reprendre une photo ou de basculer en recherche texte. En cas d'erreur : messages explicites (image illisible, session expirée, problème réseau, etc.).
- **Dépendance aux empreintes.** La recherche visuelle ne trouve que des articles dont l'empreinte a déjà été calculée. Le calcul est automatique à la publication d'un article, et un outil d'administration permet de rattraper les articles plus anciens sans empreinte. Concrètement : un catalogue dont tous les articles ne sont pas encore « indexés visuellement » donnera des résultats partiels.

**Fonction voisine — « Produits similaires ».** Le même moteur sert à proposer, sur une fiche article, des articles visuellement proches (« vous aimerez aussi »). Cette fonction est décrite plus en détail dans la section consacrée aux fiches article.

**Spécificité iOS/Android :** la préparation d'image gère explicitement le format **HEIC/HEIF** d'Apple (conversion en JPEG côté client) ; aucune différence fonctionnelle de découverte entre iOS et Android sur cette fonction.

---

### 5.6 Navigation par catégories et par marques

**Par catégories :**

- L'app dispose d'une **arborescence de catégories riche et profonde** (jusqu'à 4-5 niveaux), en français, de type Vinted. Exemple de chemin : Femmes → Vêtements → Manteaux et vestes → Vestes → Vestes en jean.
- Les **catégories de premier niveau** (Femmes, Hommes, etc.) sont accessibles directement en raccourcis dans l'en-tête de l'accueil.
- Dans la recherche, le chip « Catégorie » ouvre un **sélecteur en arborescence** (bottom sheet) où l'on descend niveau par niveau. La sélection finale est un **chemin de catégories** (du parent jusqu'à la feuille). Le filtre s'applique sur la catégorie **la plus précise** choisie.
- Le libellé du chip catégorie reflète la catégorie sélectionnée (ex. « Vestes en jean »).

**Par marques :**

- Les pastilles de la section « Tendances » de l'accueil mènent directement à une recherche filtrée par marque.
- Dans la recherche, le chip « Marque » ouvre un sélecteur multi-marques dédié.
- Une recherche par marque peut aussi être atteinte par lien direct (paramètre `brands`), ce qui produit un écran de résultats intitulé « Résultats par marque ».

**Filtrage par boutique vendeur :** la recherche peut être restreinte aux articles d'un vendeur donné (paramètre `shopId`), produisant un écran « Articles de la boutique ». C'est le mécanisme utilisé pour parcourir le catalogue d'un vendeur précis.

---

### 5.7 Historique de recherche (recherches récentes)

**À quoi ça sert :** retrouver et relancer ses recherches passées en un toucher.

**Règles de gestion :**

- **Réservé aux utilisateurs connectés.** L'historique est stocké par utilisateur côté serveur. Un **visiteur non connecté** ne voit pas d'historique : il voit à la place un message « Vos recherches apparaîtront ici » et une invitation « Connectez-vous pour sauvegarder votre historique de recherche ».
- **Ce qui est enregistré :** une recherche est ajoutée à l'historique au moment où l'utilisateur valide (terme + filtres + catégorie), seulement s'il y a un terme **ou** un filtre actif (les recherches « vides » ne sont pas enregistrées).
- **Dédoublonnage :** relancer une recherche identique (même terme + mêmes filtres) ne crée pas de doublon ; l'app rafraîchit simplement sa date pour la remonter en tête de liste.
- **Plafond de 20 entrées :** au-delà, les plus anciennes sont automatiquement supprimées. L'écran affiche les 10 plus récentes.
- **Actions utilisateur :** toucher une recherche récente la **rejoue intégralement** (terme, filtres, tri, fourchette de prix tous restaurés à l'identique). On peut aussi **supprimer** une entrée individuellement.
- **Recherches tendances (statiques).** Quand l'historique est vide, l'app propose une grille de **suggestions de tendances** sous forme de tags. Important : ces suggestions sont une **liste fixe codée en dur** (« Sac Polène », « Veste en cuir », « Jean Levi's 501 », « Robe vintage », « Baskets Nike », « Pull cachemire », « Sézane », « Manteau laine ») — **ce ne sont pas des tendances calculées en temps réel**. Toucher un tag lance la recherche correspondante.

---

### 5.8 Recherches sauvegardées et alertes nouveautés

C'est le mécanisme de fidélisation le plus fort de la découverte : l'utilisateur « épingle » une recherche et peut être **notifié automatiquement** quand de nouveaux articles correspondent.

**Créer une recherche sauvegardée :**

1. Après avoir lancé une recherche avec des résultats, un bouton « **Sauvegarder** » apparaît au-dessus de la grille.
2. **Connexion requise** : un visiteur non connecté qui touche « Sauvegarder » est invité à se connecter d'abord.
3. Une fenêtre s'ouvre : l'utilisateur peut **nommer** la recherche (un nom par défaut est proposé, ex. « Nike Air Max - taille 42 »), voit un **résumé** des critères (terme, catégorie, marques, prix), et active ou non l'**interrupteur « Alertes nouveautés »**.
4. À l'enregistrement, un message confirme : avec alertes, « Vous serez notifié(e) lorsque de nouveaux articles correspondront » ; sans alertes, « Retrouvez cette recherche dans votre profil ».

**Gérer ses recherches sauvegardées :** accessible depuis le **profil → « Recherches sauvegardées »**. Cet écran liste chaque recherche avec :

- son nom et son résumé de filtres (tags) ;
- un **badge « nouveautés »** indiquant le nombre de nouveaux articles depuis la dernière notification ;
- un bouton cloche pour **activer/couper les alertes** au cas par cas ;
- un bouton corbeille pour **supprimer** (avec confirmation).

Toucher une carte **rouvre la recherche** avec tous ses critères restaurés, et **remet à zéro** le compteur de nouveautés.

**Comment fonctionnent les alertes (logique serveur) :**

- Un traitement automatique tourne **toutes les 15 minutes** côté serveur.
- Il ne traite **que les recherches dont les alertes sont activées** (optimisation : il ne scanne pas tous les utilisateurs).
- Pour chaque recherche active, il cherche les articles **actifs, non vendus, créés après la dernière notification** correspondant aux critères. La catégorie ou la marque sert de premier filtre serveur ; le reste (texte, prix, taille, couleur, matière, état) est filtré ensuite. Le filtrage texte cherche dans le titre, la description et la marque.
- S'il trouve des correspondances, il envoie une **notification push** (« 3 nouveaux articles / Nouvelle correspondance pour "…" »), met à jour la date de dernière notification et le compteur de nouveautés affiché sur la carte.

**Limite connue iOS vs Android (impact produit réel) :**

- Les notifications push de nouveautés ne partent qu'aux appareils dont l'app a un **jeton push routable** (FCM). Le code exclut explicitement les jetons APNs bruts iOS non routables : un utilisateur **iOS dont seul un jeton APNs brut est enregistré ne recevra pas la notification d'alerte**. En pratique, la couverture des alertes push est plus fiable sur **Android** que sur iOS selon la configuration du jeton. La recherche sauvegardée reste consultable dans le profil dans tous les cas (le compteur de nouveautés y est visible), mais le **rappel push** peut manquer sur iOS.
- Côté Android, les notifications passent par un canal dédié « saved_searches » avec priorité haute et son.

---

### 5.9 Données clés (en langage métier)

- **Profil de style** (`styleProfile`) : empreinte de goût générée par IA (marques recommandées, tailles suggérées, tags de style) qui alimente la section « Pour toi ». À défaut, les **préférences manuelles** (marques favorites, tailles) prennent le relais.
- **Index de recherche** (`search_index`) : copie allégée du catalogue avec mots-clés et score de popularité, qui sert au moteur de recherche texte.
- **Empreintes visuelles** (`embeddings`) : vecteurs IA par article, qui servent à la recherche par photo et aux « produits similaires ».
- **Historique de recherche** : par utilisateur, 20 entrées max, dédoublonné.
- **Recherches sauvegardées** : par utilisateur, avec drapeau « alertes » et compteur de nouveautés.
- **Articles** : un article est « découvrable » s'il est **actif et non vendu**. Tous les flux de découverte filtrent sur ces deux états (un article vendu disparaît des sections, des résultats et des alertes).

---

### 5.10 Synthèse des limites connues (à connaître côté produit)

| Sujet | État réel |
|-------|-----------|
| Articles à proximité (géoloc) | **Non disponible** dans la recherche : la position n'est pas transmise au moteur ; la fonction existe en réserve technique seulement. |
| Tri par prix/date avec mot-clé | **Désactivé** : seul « Populaires » est possible en mode texte (contrainte du moteur Firestore maison). |
| Recherches « tendances » de l'écran de recherche | **Liste fixe codée en dur**, pas un classement temps réel. (À ne pas confondre avec la section « Tendances » de l'accueil, qui, elle, est calculée sur le catalogue réel.) |
| Recherche visuelle | Limitée aux articles déjà « indexés » visuellement ; débit bridé (5/min anonyme, 20/min connecté). |
| Alertes push iOS | Risque de non-réception si seul un jeton APNs brut est enregistré ; les recherches restent consultables dans le profil. |
| Historique de recherche | Réservé aux utilisateurs connectés. |
| Recherches sauvegardées | Création réservée aux utilisateurs connectés. |
