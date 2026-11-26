## 05. Découverte, recherche & navigation

Cette section décrit comment un utilisateur de Second trouve des articles : ce qu'il voit en arrivant (le feed d'accueil), comment il cherche un article précis (recherche texte, filtres, photo), comment il navigue par catégories et marques, et comment il met en place des alertes pour ne rien rater. Tout est documenté tel que l'application le fait réellement aujourd'hui (code vérifié ligne à ligne), y compris les limites et les trous connus.

---

### 5.1 Vue d'ensemble du parcours de découverte

Trois portes d'entrée vers le catalogue coexistent :

1. **L'accueil (le feed)** — l'écran d'arrivée de l'app, organisé en sections (nouveautés, SwapZone, marques tendance, vendeurs vedettes, recommandations personnelles, baisses de prix, grille « Découvrez »). C'est la découverte « passive », façon vitrine éditoriale.
2. **La recherche** — un écran dédié, accessible depuis la barre de recherche de l'accueil, où l'utilisateur tape un mot-clé, applique des filtres, ou navigue dans l'arborescence de catégories. C'est la découverte « active ».
3. **La recherche visuelle (par photo)** — l'utilisateur prend une photo (ou en choisit une dans sa galerie) et l'app retrouve les articles visuellement similaires dans le catalogue.

À cela s'ajoutent deux mécanismes de fidélisation : **l'historique de recherche** (les recherches récentes réapparaissent) et les **recherches sauvegardées avec alertes** (notification push quand un nouvel article correspond).

**Découverte ouverte aux visiteurs.** L'accueil, la recherche texte, les filtres et la recherche visuelle fonctionnent **sans compte** : les données du catalogue et de l'index de recherche sont en lecture publique (`firestore.rules`). Seuls l'historique, les recherches sauvegardées et les favoris exigent une connexion.

---

### 5.2 L'accueil / le feed

L'accueil est l'onglet d'arrivée. Il se compose d'un **en-tête fixe** (barre de recherche + appareil photo + cloche de notifications + raccourcis catégories) et d'un **enchaînement vertical de 7 sections**, dans cet ordre exact (`app/(tabs)/index.tsx`) :

| Ordre | Section (titre à l'écran) | Contenu | Source des données | Fraîcheur (mise en cache) |
|------|---------------------------|---------|--------------------|---------------------------|
| 1 | **Nouveautés** | Carrousel horizontal des 10 articles les plus récents | Serveur (`getNewArrivals`, limite 10) | ~10 min |
| 2 | **Swap Zone** | Bande sombre pleine largeur menant à la zone de troc | Serveur (`getActiveSwapPartyInfo`) | ~10 min |
| 3 | **Tendances** | Carrousel de pastilles des marques les plus représentées, avec nombre d'articles | Serveur (`getTrendingBrands`) | ~1 h |
| 4 | **Vendeurs vedettes** | Vendeurs les plus « likés » | Serveur (`getFeaturedSellers`) | ~30 min |
| 5 | **Pour toi** | Carrousel personnalisé selon le profil de style / les préférences | Recherche filtrée côté app (marques + tailles du profil) | ~10 min |
| 6 | **Baisses de prix** | Carrousel des articles récemment baissés, avec pourcentage de réduction | Serveur (`getPriceDrops`) | ~10 min |
| 7 | **Découvrez** | Grille verticale du catalogue, paginée | Serveur (`getNewArrivals` paginé, 20/page) | ~10 min |

**Règles de gestion importantes :**

- **Chargement progressif (économie de ressources).** Chaque section interroge le serveur indépendamment et **seulement quand elle entre dans le champ de vision** lors du défilement. À l'ouverture, seules les premières sections visibles déclenchent un appel serveur.
- **Préchargement au démarrage.** Pendant l'écran de lancement, l'app précharge **les deux sections du haut** (Nouveautés et Tendances) pour éviter un temps d'attente au premier affichage. Un échec de préchargement ne bloque jamais le démarrage : la section retentera à l'affichage.
- **Sections qui disparaissent si vides.** Nouveautés, Tendances, Vendeurs vedettes, Pour toi et Baisses de prix se masquent entièrement si le serveur ne renvoie rien. « Découvrez » ne se masque pas : elle affiche « Aucun article trouvé » ou un état d'erreur avec bouton « Réessayer ».
- **Isolation des erreurs.** Chaque section est encadrée par une barrière d'erreur : si l'une plante, les autres restent affichées (l'accueil ne « tombe » jamais en entier).
- **Tirer pour rafraîchir.** Un geste de tirage vers le bas rafraîchit **toutes** les sections de l'accueil en une passe.
- **Retour en haut.** Re-toucher l'onglet Accueil alors qu'on y est déjà fait remonter la liste en haut.

**Les sections en détail :**

- **Nouveautés.** Les 10 articles les plus récents (actifs, non vendus), triés par date de création décroissante. « Voir tout » ouvre la recherche en **mode « parcourir tout »** : catalogue entier, tri par date, sans mot-clé ni filtre.
- **Swap Zone.** Bande sombre pleine largeur (« Swap Zone », accroche « Échange tes pièces, sans frais. »), affichant le nombre d'articles de la zone et un compteur « X nouveautés cette semaine » (chaque compteur est masqué s'il vaut 0), avec le bouton « Entrer dans la zone ». C'est une **zone généraliste permanente unique** (pas d'événement à durée limitée). Si aucune zone n'est active côté serveur, la bande devient un **visuel non cliquable** affichant « Bientôt disponible ». (Le fonctionnement détaillé du troc est couvert dans la section dédiée à la SwapZone.)
- **Tendances (marques).** Le serveur lit **jusqu'à 500 articles** actifs et non vendus, regroupe par marque **sans tenir compte de la casse** (« SELECTED », « selected » et « Selected » comptent comme une seule marque), ignore les articles sans marque, et renvoie le **top 10** avec un libellé normalisé (table d'exceptions : COS, H&M, Sézane, Levi's, A.P.C. …). Toucher une pastille ouvre la recherche pré-filtrée sur cette marque. « Voir tout » ouvre la recherche **vide** (pas de pré-filtre). ⚠️ **Limite** : les 500 articles sont lus sans ordre de tri — au-delà de 500 articles au catalogue, le classement des tendances est calculé sur un sous-ensemble arbitraire, pas sur tout le stock.
- **Vendeurs vedettes.** Le serveur classe les vendeurs par nombre de « likes vendeur » décroissant (seuls les vendeurs avec au moins 1 like sont éligibles), **top 20**, tous affichés dans le carrousel. On peut « liker » un vendeur (opération sécurisée et transactionnelle qui incrémente son compteur ; impossible de se liker soi-même), ce qui alimente ce classement. « Voir tout » ouvre la recherche vide.
- **Pour toi.** Ne s'affiche que si l'utilisateur a un **profil de style** généré par IA (`styleProfile`, avec un indice de confiance strictement positif) **ou**, à défaut, des **préférences manuelles** (marques favorites, tailles, pointures). L'app construit alors une recherche filtrée sur ces marques et tailles, en **excluant les articles de l'utilisateur lui-même**, limitée à 10 articles. Les tailles du profil n'ayant pas de système, elles sont testées **en US et en EU**. Si l'utilisateur n'a aucun profil exploitable, ou si la recherche ne renvoie rien, la section est entièrement masquée. Pas de « Voir tout » sur cette section.
- **Baisses de prix.** Le serveur lit les **20 baisses les plus récentes** (articles actifs, non vendus, portant une date de dernière baisse), écarte celles où le prix d'origine n'est pas réellement supérieur au prix actuel, calcule le pourcentage `(prix d'origine − prix actuel) / prix d'origine`, puis les **classe par réduction décroissante**. Chaque carte affiche le pourcentage (ex. « -30 % »), le prix barré et un cœur favori. La baisse elle-même est enregistrée côté vendeur : quand un vendeur baisse le prix (fonction sécurisée `recordPriceDrop`), le nouveau prix doit obligatoirement être **inférieur** à l'ancien et le vendeur doit être propriétaire de l'article, sinon l'opération est refusée. « Voir tout » ouvre la recherche vide.
- **Découvrez.** Grille verticale à 2 colonnes qui rejoue la même source que « Nouveautés » mais paginée (20 articles par page). ⚠️ La pagination est **manuelle** : un bouton « **Charger plus** » en bas de grille, **pas** un défilement infini.

**En-tête de l'accueil :**

- **Barre de recherche** (« Rechercher... ») : un simple bouton qui ouvre l'écran de recherche dédié (pas de saisie sur l'accueil).
- **Appareil photo** : ouvre directement la caméra de recherche visuelle (voir 5.5).
- **Cloche de notifications** : ouvre le centre de notifications ; une pastille indique le nombre de non-lus (affiché « 9+ » au-delà de 9).
- **Raccourcis catégories** : une rangée horizontale de tags reprenant les **5 catégories de premier niveau** — Femmes, Hommes, Enfants, Électronique, Maison. Toucher un tag ouvre la recherche pré-filtrée sur cette catégorie.

---

### 5.3 La recherche textuelle

L'écran de recherche est l'outil central de découverte active. Il combine, sur un seul écran : la barre de recherche, une rangée de filtres, et la zone de résultats (ou l'écran « recherches récentes » quand rien n'est encore lancé).

**Parcours pas à pas :**

1. L'utilisateur ouvre la recherche (depuis l'accueil, un raccourci catégorie, une pastille de marque, une recherche sauvegardée, ou une notification d'alerte).
2. Si l'écran s'ouvre **sans contexte** (pas de mot-clé, de catégorie, de marque ni de filtre pré-rempli), le clavier prend automatiquement le focus et l'écran « recherches récentes / tendances » s'affiche.
3. L'utilisateur tape un terme et valide (touche de recherche du clavier ou bouton « OK », qui apparaît dès qu'un terme est saisi ou un filtre actif). La recherche se lance, le clavier se replie, et la grille de résultats s'affiche.
4. Une **barre d'info résultats** indique le nombre d'articles trouvés (ex. « 24 articles trouvés », ou « 20+ articles trouvés » s'il reste des pages à charger).
5. Le défilement en bas de grille charge automatiquement la page suivante (pagination par lots de 20). Ici, contrairement à l'accueil, le défilement est bien **infini**.

**Règles de gestion :**

- **Anti-rebond (debounce) de 350 ms** : la recherche n'est pas relancée à chaque frappe, mais après une courte pause de saisie. Une validation explicite (OK / touche entrée, tag tendance, recherche récente) **court-circuite** cette attente.
- **Auto-masquage des résultats** : si l'utilisateur efface le terme et retire tous les filtres, l'écran revient automatiquement à l'état « recherches récentes ». Exception : le mode « parcourir tout » venu du « Voir tout » des Nouveautés, qui garde la grille affichée sans terme ni filtre.
- **Une recherche peut être déclenchée par un terme, par un filtre, ou par une catégorie** — les trois sont des entrées valides (on peut chercher sans mot-clé, uniquement avec des filtres).
- **Bouton « Effacer tout »** : visible dès qu'un filtre est actif ; réinitialise terme, filtres, catégorie, tri et fourchette de prix d'un coup.
- **Gestion d'erreur** : en cas d'échec réseau, un écran « Une erreur est survenue / Vérifiez votre connexion et réessayez » avec bouton « Réessayer » s'affiche. Un résultat vide affiche « Aucun résultat pour "…" » (avec terme) ou « Aucun article trouvé avec ces filtres ».
- **Pas de titre d'écran.** L'écran de recherche n'affiche **aucun titre contextuel** : seulement la barre de recherche. Un libellé de page (« Résultats par marque », « Articles de la boutique »…) est calculé dans le code mais **n'est branché sur aucun élément affiché** — c'est du code mort. À corriger si l'on veut un repère visuel de contexte.

**Comment fonctionne la recherche par mot-clé (logique métier) :**

- Le moteur est **maison, basé sur Firestore** (pas de moteur de recherche tiers type Algolia/Elastic). Chaque article publié est recopié dans une collection dédiée (`search_index`) qui contient notamment une liste de **mots-clés** et un **score de popularité**. L'index est alimenté automatiquement à la création et à la mise à jour d'un article, et l'entrée est supprimée quand l'article est supprimé.
- Les mots-clés sont construits à partir du **titre + description + marque(s) + catégorie**, normalisés : passage en minuscules, **suppression des accents** et de la ponctuation. « Été » et « ete » trouvent donc les mêmes résultats — indispensable en français.
- L'index contient aussi des **préfixes** (à partir de 3 lettres) et des **paires de mots consécutifs**. Conséquence produit utile : taper « vest » remonte « veste », et taper « nik » remonte « Nike ». On a donc de fait une recherche « qui complète » sans autocomplétion visible.
- Le **premier mot** normalisé sert de filtre serveur principal ; les **mots suivants** doivent **tous** figurer dans les mots-clés de l'article (logique « ET »). Chercher « veste cuir noir » exige que l'article contienne les trois.
- ⚠️ **Trou connu — les mots de 1 ou 2 lettres cassent la recherche.** Les mots de 2 lettres ou moins ne sont **jamais indexés**. Une requête qui en contient un ne peut donc rien trouver : « sac à main » ne renvoie **aucun résultat** (le « à » est cherché mais n'existe pas dans l'index), alors que « sac main » fonctionne. C'est un défaut réel et fréquent en français, à corriger.
- Un terme qui ne donne aucun mot exploitable (uniquement de la ponctuation ou des accents) renvoie une page **vide** plutôt que tout le catalogue — pas de résultat parasite.
- En mode mot-clé, l'ordre des résultats est l'ordre de **pertinence/popularité** (score combinant vues, favoris et fraîcheur). C'est pour cela que les tris par prix/date sont désactivés tant qu'un mot-clé est présent (voir 5.4, « Tri »).
- ⚠️ **Le compteur de résultats est approximatif.** En mode mot-clé, le serveur ne sait pas filtrer « actif / non vendu » ni les attributs (couleur, taille, matière, marque, prix) : l'app sur-lit des lots de documents (5× la taille de page, au maximum 5 lots par page) et filtre le reste sur l'appareil. Le « 20+ articles trouvés » signifie donc « au moins ceux-là », jamais un total exact.

**Spécificité Canada (devise) :** toutes les fourchettes de prix, étiquettes et résumés affichent les montants en **dollars canadiens**, à la convention québécoise (espace avant le « $ », virgule décimale : « 45 $ », « 45,50 $ »).

---

### 5.4 Les filtres et le tri

Sous la barre de recherche, une rangée de **chips de filtre** (étiquettes cliquables) permet d'affiner. Chaque chip s'affiche en gris avec un chevron quand il est inactif, et en surbrillance avec son libellé une fois renseigné. Un petit « x » remplace alors le chevron et retire ce filtre précisément.

**Filtres disponibles** (dans l'ordre d'affichage) :

| Filtre | Type de sélection | Détails métier |
|--------|-------------------|----------------|
| **Tri** | Choix unique | Plus récents (défaut) · Populaires · Prix croissant · Prix décroissant |
| **Catégorie** | Arborescence | Navigation hiérarchique multi-niveaux (voir 5.6) |
| **Couleur** | Multi-choix | 28 couleurs prédéfinies |
| **Taille** | Multi-choix | Système **US / EU** + bascule Adulte / Enfant |
| **Matière** | Multi-choix | 35 matières prédéfinies |
| **Marque** | Multi-choix | Sélecteur dédié, recherche dans le référentiel de marques + ajout d'une marque libre |
| **État** | Choix unique | Neuf avec étiquette · Neuf sans étiquette · Très bon état · Bon état · Satisfaisant |
| **Prix** | Fourchette | Min et/ou Max en $ |

**Règles de gestion des filtres :**

- **Le libellé du chip s'adapte au nombre de valeurs.** Ex. couleur : « Couleur » (vide) → « Rouge » (1) → « 3 couleurs » (plusieurs). Idem pour tailles, matières, marques.
- **Le prix est inversé automatiquement si min > max.** Si l'utilisateur saisit un minimum supérieur au maximum, l'app permute les deux valeurs au moment d'appliquer (et met à jour les champs à l'écran). Les valeurs négatives sont ignorées, et la **virgule décimale** des claviers français est acceptée.
- **Les tailles ne se confondent jamais entre systèmes.** Une taille est stockée comme un couple `{valeur, système}` (ex. `{42, EU}`). Retirer « 42 EU » ne retire pas « 42 US ». Le sélecteur garde en mémoire la sélection des **deux** systèmes : basculer de l'onglet US à l'onglet EU n'efface pas ce qui était coché.
- **Les valeurs sont comparées à l'identique, jamais par fragment.** « bleu » ne matche plus « bleu-marine », « cuir » ne matche plus « cuir synthétique », « Gap » ne matche plus « Gap Kids ». Un article auquel l'attribut filtré manque est exclu.
- **Une recherche peut s'effectuer uniquement avec des filtres**, sans mot-clé (ex. « tous les articles en cuir, taille 40 EU, moins de 50 $ »).

**Règles de gestion du tri (subtilité importante) :**

- **Sans mot-clé** : les 4 tris sont disponibles (récents, populaires, prix croissant, prix décroissant).
- **Avec un mot-clé** : le tri est **verrouillé**. L'app bascule d'office sur la pertinence/popularité, le chip affiche « **Tri automatique** », ne s'ouvre plus et n'offre pas de croix de retrait.
- **Pourquoi ?** En mode mot-clé, le serveur ne peut ordonner que par score de popularité. Trier par prix ne réordonnerait que la page courante (classement globalement faux et documents sautés). L'app interdit donc proprement ce cas plutôt que de produire un classement trompeur. C'est une limite assumée du moteur Firestore maison.

**Tri par proximité géographique — état réel :** **il n'existe aucune fonction « articles à proximité »**, ni dans l'écran de recherche ni ailleurs dans la découverte. Le tri par distance ne fait pas partie des options du moteur, aucune position de l'acheteur n'est collectée pour la recherche, et aucune carte de résultat n'affiche de distance. La seule plomberie existante est **côté indexation** : un géohash et les coordonnées de l'article sont calculés et stockés à la publication. C'est une réserve technique, rien de plus. À documenter comme **non disponible** côté produit — d'autant que le meetup est aujourd'hui le seul parcours d'achat actif et qu'un filtre « proche de moi » y aurait une valeur directe.

**Autres filtres absents (à connaître) :** pas de filtre « mode de remise » (meetup / livraison), pas de filtre « boutique professionnelle », pas d'option pour afficher les articles vendus. Un article vendu ou désactivé disparaît de tous les flux de découverte.

---

### 5.5 La recherche visuelle (par photo)

L'utilisateur peut chercher un article à partir d'une **photo** plutôt que de mots. C'est une fonctionnalité différenciante, alimentée par l'IA.

**Parcours pas à pas :**

1. Depuis l'accueil (icône appareil photo) ou depuis l'écran de recherche (icône caméra), l'utilisateur ouvre la **caméra de recherche visuelle** (« Recherche visuelle », guide « Cadrez le produit à rechercher »). Si l'autorisation caméra est refusée, un écran de repli propose d'ouvrir les réglages **ou** de sélectionner une photo depuis la galerie.
2. Il prend une photo (ou en sélectionne une), la revoit en aperçu, puis touche « Rechercher » (ou « Reprendre »).
3. L'app **prépare l'image** : si le fichier dépasse ~1 Mo, il est redimensionné à 1024 px de large et recompressé en JPEG ; s'il dépasse encore 4 Mo, une seconde passe le ramène à 768 px. ⚠️ **Une photo déjà légère (< 1 Mo) est envoyée telle quelle, sans conversion.** La conversion des formats HEIC/HEIF d'iPhone est donc assurée en amont par le sélecteur de photos (mode compatible) et par l'appareil photo de l'app, pas systématiquement par cette étape.
4. L'app envoie l'image au serveur, qui génère une **empreinte visuelle (embedding)** via l'IA de Google (Vertex AI, modèle multimodal) et la compare aux empreintes des articles actifs du catalogue (recherche de plus proches voisins).
5. L'écran « Résultats visuels » affiche le nombre de résultats, un aperçu de la photo source et une grille des articles similaires, chacun avec un **pourcentage de similarité** en pastille (ex. « 78 % »).

**Règles de gestion :**

- **Seuil de similarité.** Seuls les articles dépassant ~**45 %** de ressemblance sont retournés. En dessous, l'article est écarté pour éviter les résultats hors-sujet.
- **Jusqu'à 20 résultats** par recherche.
- **Articles vendus exclus.** L'index d'empreintes ne suit que le statut « actif » : les articles vendus sont écartés après coup, en relisant la fiche article.
- **Fonctionne aussi sans compte.** La recherche visuelle est accessible même non connecté, avec une **limite de débit plus stricte** : 5 recherches/minute pour un visiteur anonyme contre 20/minute pour un utilisateur connecté. Au-delà : « Vous avez atteint la limite de recherches. Réessayez dans quelques instants. »
- **États clairs.** Pendant l'analyse : aperçu flou de la photo source + « Analyse de l'image... / Recherche de produits similaires » et une grille de squelettes. Sans résultat : « Aucun produit similaire trouvé — Essayez avec une photo plus nette ou un angle différent », avec deux issues (« Nouvelle recherche », « Recherche texte »). En cas d'erreur : messages explicites et distincts (image illisible, session expirée, quota atteint, connexion indisponible, échec d'analyse) et un bouton « Réessayer ».
- **Dépendance aux empreintes.** La recherche visuelle ne trouve que des articles dont l'empreinte a déjà été calculée. Le calcul est automatique à la publication (et rejoué si la photo principale change) ; les articles inactifs ou rejetés en modération ne sont jamais indexés. Une fonction d'administration permet de rattraper les articles anciens sans empreinte (200 articles maximum par exécution, réservée aux comptes admin). Concrètement : un catalogue dont tous les articles ne sont pas encore « indexés visuellement » donnera des résultats partiels.

**Fonction voisine — « Produits similaires ».** Le même moteur sert à proposer, sur une fiche article, des articles visuellement proches (seuil plus permissif, ~40 %, 10 résultats). ⚠️ Deux replis à connaître : si l'article n'a pas d'empreinte **ou si le visiteur n'est pas connecté**, l'app bascule silencieusement sur une suggestion « même catégorie, plus récents ». Un visiteur non connecté ne voit donc jamais les recommandations visuelles sur une fiche. Le détail est couvert dans la section consacrée aux fiches article.

---

### 5.6 Navigation par catégories et par marques

**Par catégories :**

- L'app dispose d'une **arborescence de catégories riche et profonde** (jusqu'à 4-5 niveaux), en français, de type Vinted. Exemple de chemin : Femmes → Vêtements → Manteaux et vestes → Manteaux → Trenchs.
- Les **5 catégories de premier niveau** sont **Femmes, Hommes, Enfants, Électronique et Maison**, accessibles en raccourcis dans l'en-tête de l'accueil. À noter côté positionnement : la taxonomie déborde de la mode (électronique, maison), même si le produit se raconte comme une marketplace mode.
- Dans la recherche, le chip « Catégorie » ouvre un **sélecteur en arborescence** (bottom sheet) où l'on descend niveau par niveau, avec un fil d'Ariane (« Femmes > Vêtements > … ») et un bouton « Choisir » pour valider le niveau courant. La sélection est un **chemin de catégories** ; le filtre s'applique sur la catégorie **la plus précise** du chemin.
- Le libellé du chip catégorie reflète la catégorie sélectionnée (ex. « Trenchs »).

**Par marques :**

- Les pastilles de la section « Tendances » de l'accueil mènent directement à une recherche filtrée par marque.
- Dans la recherche, le chip « Marque » ouvre un sélecteur dédié : recherche dans un référentiel de marques stocké côté serveur (résultats plafonnés à 50), sélection multiple, et possibilité d'**ajouter une marque libre** absente du référentiel.
- ⚠️ **Défaut connu sur les marques « embellies ».** L'accueil affiche la marque sous sa forme canonique (« Sézane », « Levi's », « A.P.C. »), mais le filtre compare le texte brut enregistré sur l'article. Si le vendeur a saisi « Sezane » sans accent, la pastille « Sézane » de l'accueil ouvre une recherche qui ne remonte **aucun de ses articles**. À traiter par une normalisation des marques à la saisie.

**Filtrage par boutique vendeur :** l'écran de recherche **sait** se restreindre aux articles d'un vendeur (paramètre technique `shopId`), mais ⚠️ **aucun écran de l'app n'utilise ce chemin aujourd'hui**. Le catalogue d'une boutique ou d'un vendeur est listé par ses propres écrans (page boutique, page profil vendeur), pas par la recherche. La capacité existe donc sans porte d'entrée.

---

### 5.7 Historique de recherche (recherches récentes)

**À quoi ça sert :** retrouver et relancer ses recherches passées en un toucher.

**Règles de gestion :**

- **Réservé aux utilisateurs connectés.** L'historique est stocké par utilisateur côté serveur (`users/{id}/searchHistory`). Un **visiteur non connecté** ne voit pas d'historique : il voit « Vos recherches apparaîtront ici » et l'invitation « Connectez-vous pour sauvegarder votre historique de recherche ».
- **Ce qui est enregistré :** une recherche est ajoutée au moment où l'utilisateur valide (terme + filtres + catégorie + tri), seulement s'il y a un terme, un filtre **ou** une catégorie (les recherches « vides » ne sont pas enregistrées).
- **Dédoublonnage :** relancer une recherche identique (même terme + mêmes filtres) ne crée pas de doublon ; l'app rafraîchit sa date pour la remonter en tête de liste.
- **Plafond de 20 entrées :** au-delà, les plus anciennes sont automatiquement supprimées. L'écran affiche les **10 plus récentes**, décrites par un résumé lisible (`"robe" • Trenchs • Zara • taille 38 EU • 20-50 $`).
- **Actions utilisateur :** toucher une recherche récente la **rejoue intégralement** (terme, filtres, catégorie, tri et fourchette de prix tous restaurés à l'identique). On peut aussi **supprimer** une entrée individuellement (croix sur la ligne).
- **Tolérance aux pannes :** si la lecture de l'historique échoue (hors ligne, index manquant), l'écran se comporte comme si l'historique était vide — jamais de message d'erreur.
- **Recherches « TENDANCES » (statiques).** Un bloc de tags « TENDANCES » est affiché **en permanence** au-dessus de l'historique (et pas seulement quand celui-ci est vide). Important : ces suggestions sont une **liste fixe codée en dur** — « Sac Polene », « Veste en cuir », « Jean Levi's 501 », « Robe vintage », « Baskets Nike », « Pull cachemire », « Sezane », « Manteau laine » — **ce ne sont pas des tendances calculées**. Deux d'entre elles sont écrites sans accent (« Polene », « Sezane ») ; comme le moteur ignore les accents, cela ne change rien aux résultats, mais c'est visible à l'écran.

---

### 5.8 Recherches sauvegardées et alertes nouveautés

C'est le mécanisme de fidélisation le plus fort de la découverte : l'utilisateur « épingle » une recherche et peut être **notifié automatiquement** quand de nouveaux articles correspondent.

**Créer une recherche sauvegardée :**

1. Après avoir lancé une recherche **qui a des résultats**, un bouton « **Sauvegarder** » apparaît au-dessus de la grille (il n'apparaît ni pendant le chargement, ni sur un résultat vide, ni en cas d'erreur).
2. **Connexion requise** : un visiteur non connecté qui touche « Sauvegarder » est invité à se connecter d'abord.
3. Une fenêtre s'ouvre : l'utilisateur peut **nommer** la recherche (50 caractères max ; un nom par défaut est proposé, composé du terme, du libellé de catégorie et de la première marque, dans la limite de deux éléments — « robe - Trenchs » ; « Ma recherche » s'il n'y a rien à assembler), voit un **résumé** des critères (terme, catégorie, marques, fourchette de prix), et active ou non l'**interrupteur « Alertes nouveautés »** (désactivé par défaut).
4. Le bouton d'enregistrement est inactif tant que le nom est vide. À l'enregistrement, un message confirme : avec alertes, « Vous serez notifié(e) lorsque de nouveaux articles correspondront à cette recherche » ; sans alertes, « Retrouvez cette recherche dans votre profil ».

**Gérer ses recherches sauvegardées :** accessible depuis le **profil → « Recherches sauvegardées »** (l'écran demande la connexion si besoin). Il liste chaque recherche, de la plus récente à la plus ancienne, avec :

- son nom et son résumé de filtres sous forme de tags ;
- un **badge « nouveautés »** indiquant le nombre de nouveaux articles depuis la dernière notification, plus une ligne « 3 nouveaux articles » ;
- un bouton cloche pour **activer/couper les alertes** au cas par cas (réactiver remet le point de départ à maintenant : les articles parus pendant la coupure ne seront pas notifiés) ;
- un bouton corbeille pour **supprimer** (avec confirmation).

Toucher une carte **rouvre la recherche** avec tous ses critères restaurés, et **remet à zéro** le compteur de nouveautés. Toucher la notification push produit le même effet.

**Comment fonctionnent les alertes (logique serveur) :**

- Un traitement automatique tourne **toutes les 15 minutes**.
- Il ne traite **que les recherches dont les alertes sont activées** (optimisation : il n'inspecte pas tous les utilisateurs) et **uniquement les utilisateurs disposant d'un jeton push exploitable**.
- Pour chaque recherche active, il cherche les articles **actifs, non vendus, créés après la dernière notification**. Seule la **catégorie** est poussée comme filtre serveur ; ⚠️ la marque **ne l'est pas** (les articles portent une marque unique en texte, pas une liste — un filtre serveur sur ce champ ne remonterait rien). Texte, prix, taille, couleur, matière, état et marque sont donc filtrés **après coup**, en mémoire.
- ⚠️ **Plafond de 50 articles par passage et par recherche.** Si plus de 50 articles ont été publiés depuis la dernière notification, seuls les 50 premiers sont examinés — une recherche large sur un catalogue actif peut donc rater des correspondances.
- Le filtrage texte cherche le terme **en sous-chaîne** dans le titre et la description, **ou** en correspondance exacte sur la marque. Il n'utilise pas l'index de recherche : une alerte et la recherche à l'écran peuvent donc ne pas donner exactement le même résultat.
- S'il trouve des correspondances, il envoie une **notification push** (titre « 3 nouvels articles », corps « Nouvelle correspondance pour "…" »), met à jour la date de dernière notification et le compteur de nouveautés affiché sur la carte. ⚠️ Le titre contient une **faute de français** (« 3 nouvels articles » au lieu de « 3 nouveaux articles ») — visible par tous les utilisateurs, à corriger.
- Le compteur de nouveautés est **remplacé** (pas cumulé) à chaque envoi : il reflète le dernier lot notifié, pas le total accumulé depuis la dernière consultation.

**Limite connue iOS vs Android (impact produit réel) :**

- Les notifications de nouveautés ne partent qu'aux appareils dont l'app a un **jeton push routable** (FCM). Le code écarte explicitement les jetons APNs bruts iOS non routables : un utilisateur **iOS dont seul un jeton APNs brut est enregistré ne reçoit pas l'alerte** — et sa recherche est même sautée entièrement lors du passage. La recherche sauvegardée reste consultable dans le profil dans tous les cas, mais **son compteur de nouveautés ne s'incrémente pas non plus** puisque le traitement s'arrête avant. En pratique, la couverture des alertes est plus fiable sur **Android**.
- Côté Android, les notifications passent par un canal dédié « saved_searches » avec priorité haute et son. Côté iOS, la pastille de l'app affiche le vrai total de non-lus (notifications + messages), pas le nombre d'articles trouvés.
- Les jetons devenus invalides sont retirés automatiquement du compte lors d'un échec d'envoi.

---

### 5.9 Données clés (en langage métier)

- **Profil de style** (`styleProfile`) : empreinte de goût générée par IA (marques recommandées, tailles suggérées, tags de style, indice de confiance) qui alimente la section « Pour toi ». À défaut, les **préférences manuelles** (marques favorites, tailles, pointures) prennent le relais.
- **Index de recherche** (`search_index`) : copie allégée du catalogue avec mots-clés, attributs filtrables et score de popularité ; sert au moteur de recherche texte et au tri « Populaires ». Alimenté et purgé automatiquement par le serveur, jamais écrit par l'app.
- **Empreintes visuelles** (`embeddings`) : vecteurs IA par article, qui servent à la recherche par photo et aux « produits similaires ».
- **Historique de recherche** : par utilisateur, 20 entrées max, dédoublonné, 10 affichées.
- **Recherches sauvegardées** : par utilisateur, avec drapeau « alertes », date de dernière notification et compteur de nouveautés.
- **Articles** : un article est « découvrable » s'il est **actif et non vendu**. Tous les flux de découverte filtrent sur ces deux états (un article vendu disparaît des sections, des résultats, de la recherche visuelle et des alertes).

---

### 5.10 Synthèse des limites connues (à connaître côté produit)

| Sujet | État réel |
|-------|-----------|
| Articles à proximité (géoloc) | **Inexistant** : ni tri, ni filtre, ni distance affichée. Seul le géohash est calculé à l'indexation (réserve technique). Manque criant alors que le meetup est le seul parcours d'achat actif. |
| Mots de 1-2 lettres dans une requête | **Cassent la recherche** : « sac à main » ne renvoie rien, « sac main » fonctionne. Défaut à corriger. |
| Tri par prix/date avec mot-clé | **Verrouillé** : le chip affiche « Tri automatique » et n'est plus ouvrable (contrainte du moteur Firestore maison). |
| Nombre de résultats affiché | **Approximatif** (« 20+ ») : le filtrage attributaire se fait sur l'appareil, sans total serveur. |
| Recherches « tendances » de l'écran de recherche | **Liste fixe codée en dur**, affichée en permanence, pas un classement temps réel. (À ne pas confondre avec la section « Tendances » de l'accueil, calculée sur le catalogue.) |
| Section « Tendances » de l'accueil | Calculée sur **500 articles lus sans tri** : au-delà de 500 articles au catalogue, le classement porte sur un sous-ensemble arbitraire. |
| Marques « embellies » (Sézane, Levi's, A.P.C.) | Une pastille marque de l'accueil peut ouvrir une recherche **sans résultat** si le vendeur a saisi la marque sans accent / sous une autre forme. |
| Grille « Découvrez » (accueil) | Pagination **manuelle** (bouton « Charger plus »), pas de défilement infini — contrairement à la grille de résultats de recherche. |
| Titre de l'écran de recherche | **Aucun** : le libellé contextuel (« Résultats par marque », « Articles de la boutique ») est calculé mais jamais affiché (code mort). |
| Recherche restreinte à une boutique | Capacité présente dans l'écran de recherche, **aucune porte d'entrée** dans l'app ; les boutiques listent leur catalogue par un autre chemin. |
| Recherche visuelle | Limitée aux articles déjà « indexés » visuellement ; débit bridé (5/min anonyme, 20/min connecté) ; les photos < 1 Mo sont envoyées sans conversion. |
| « Produits similaires » (fiche article) | **Indisponible pour un visiteur non connecté** : repli silencieux sur « même catégorie, plus récents ». |
| Alertes recherches sauvegardées | Plafond de **50 articles examinés** par recherche et par passage ; marque filtrée en mémoire ; texte cherché en sous-chaîne, sans l'index de recherche. |
| Alertes push iOS | Non reçues si seul un jeton APNs brut est enregistré — et dans ce cas le **compteur de nouveautés ne progresse pas non plus**. |
| Copie des notifications d'alerte | Faute visible : « 3 **nouvels** articles ». |
| Historique de recherche | Réservé aux utilisateurs connectés. |
| Recherches sauvegardées | Création et consultation réservées aux utilisateurs connectés. |
| Filtres absents | Pas de filtre mode de remise (meetup / livraison), pas de filtre boutique pro, pas d'affichage des articles vendus. |
