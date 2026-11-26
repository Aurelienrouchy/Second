## 04. Mise en vente d'un article

Cette section décrit, de bout en bout, le parcours par lequel un membre de Second met un article en vente : conditions d'accès, prise de photos, analyse par intelligence artificielle, saisie des détails, fixation du prix et du mode de remise, aperçu, publication, puis gestion de l'article une fois publié. Tout ce qui suit reflète le comportement réel de l'application (code sous `app/sell/`, `features/sell/`, `app/article/edit/[id].tsx`, `app/my-articles.tsx` et `functions/src/callable/products.ts`).

### 4.1 Vue d'ensemble du tunnel

La mise en vente est un tunnel en 5 écrans, dans cet ordre :

| # | Écran | Rôle métier |
|---|-------|-------------|
| 1 | Capture photo | Prendre / importer 1 à 5 photos de l'article |
| 2 | Tes photos | Réorganiser les photos pendant que l'analyse automatique pré-remplit la fiche |
| 3 | Détails | Vérifier / compléter titre, description, catégorie, état, marque, taille, couleurs, matières |
| 4 | Prix & livraison | Fixer le prix et choisir les quartiers de remise en main propre |
| 5 | Aperçu | Voir la fiche telle qu'elle apparaîtra, puis publier |

**Trois barrières avant même d'entrer dans le tunnel** (appliquées au moment où l'on touche l'onglet « Vendre », `app/(tabs)/_layout.tsx`) :

1. **Être connecté.** Un visiteur non connecté déclenche la feuille « Connectez-vous pour vendre un article ». Le tunnel lui-même est re-verrouillé (`app/sell/_layout.tsx`) : entrer par une URL directe renvoie à l'accueil. Pas de mise en vente anonyme.
2. **Avoir 18 ans ou plus.** Un compte de 16-17 ans peut acheter et naviguer, mais la vente est bloquée par une alerte « Vente non disponible » : *« La vente d'articles est réservée aux personnes de 18 ans et plus, car notre partenaire de paiement Stripe exige cet âge pour ouvrir un compte de versement. »* La date de naissance est collectée à l'inscription et vérifiée côté serveur (16 ans minimum pour s'inscrire). Le contrôle des 18 ans est fait **à l'entrée du tunnel** (le layout couvre toutes les entrées : onglet, « Mes articles », lien profond, reprise de brouillon) **et par la fonction serveur de publication**, qui refuse un compte de moins de 18 ans ou sans date de naissance.
3. **Avoir un e-mail vérifié** (comptes créés par e-mail / mot de passe uniquement ; les connexions Google et Apple sont vérifiées d'office). Sinon l'utilisateur est redirigé vers l'écran de vérification **avant** de photographier quoi que ce soit. C'est un pré-contrôle de confort : la vraie barrière est côté serveur, au moment de publier (voir 4.6).

**Un seul brouillon à la fois, propre au compte.** L'application conserve un unique brouillon d'article en cours par compte connecté sur l'appareil : un autre compte connecté sur le même téléphone ne le voit pas. Revenir dans « Vendre » alors qu'un brouillon existe propose d'abord de le reprendre ou de l'abandonner (voir 4.7).

**Une différence de présentation entre les plateformes.** Sur **iOS**, l'étape 1 s'affiche comme une surcouche immersive qui glisse par-dessus l'application (`features/sell/components/capture/SellOverlayCapture.tsx`) ; sur **Android**, c'est un écran plein écran classique (`app/sell/capture.tsx`). Les règles (5 photos, permissions, brouillon, qualité de compression) sont identiques ; seule l'enveloppe visuelle diffère. À partir de l'étape 2, les deux plateformes suivent exactement les mêmes écrans.

### 4.2 Étape 1 — Capture des photos

L'écran s'ouvre directement sur la **caméra plein écran** (vue arrière par défaut ; boutons pour basculer vers la caméra avant et pour allumer la torche). Des repères visuels (cadre d'angles + texte contextuel) guident le cadrage et changent selon le nombre de photos déjà prises :

- 0 photo : « Cadrez votre article » / « Photo principale face avant »
- 1 photo : « Ajoute un détail » / « Étiquette, défaut, texture… »
- 2 à 4 photos : « Continue ! » / « Dos, côté, étiquette de taille… »

**Règles de gestion :**

- **Maximum 5 photos.** Au-delà, un badge rouge « Maximum atteint » s'affiche et le déclencheur est désactivé.
- **Au moins 1 photo** est requise pour continuer ; sinon une alerte « Aucune photo » bloque la suite.
- Deux sources : prise directe à la caméra, ou import depuis la **galerie** (sélection multiple, plafonnée aux emplacements restants). Une prise de vue ou un import qui échoue est signalé.
- Les photos sont capturées en qualité réduite (~0,7 caméra, ~0,8 galerie) ; elles seront de toute façon redimensionnées avant envoi (voir 4.3).
- Une bande de miniatures permet de **supprimer** une photo (croix sur la miniature).
- Quitter alors que le brouillon contient un travail réel — photos, images déjà téléversées **ou** un résultat d'analyse IA — déclenche une confirmation : « Votre brouillon sera sauvegardé. Vous pourrez le reprendre plus tard. » Quitter un brouillon totalement vide le supprime.

**Permissions (impact iOS / Android) :** l'écran demande l'autorisation d'accès à la caméra au montage. Si l'utilisateur refuse, un écran dédié « permission refusée » s'affiche avec une porte de sortie : importer directement depuis la galerie. Le comportement est identique sur les deux plateformes ; seule la formulation système du dialogue de permission diffère (gérée par l'OS).

**Persistance :** un brouillon est créé localement dès l'ouverture de la caméra, puis les photos y sont enregistrées de façon débouncée (~0,3 s) avec une copie en cache de l'appareil. L'utilisateur peut donc fermer l'app et retrouver ses photos.

### 4.3 Étape 2 — Photos & analyse par IA

Cet écran (« Tes photos », compteur `n / 5`) fusionne la **revue des photos** et l'**analyse automatique**. Au chargement, si au moins une photo est présente, l'analyse IA **démarre seule, une seule fois**. Un bouton « Analyser avec l'IA » existe dans le code mais n'est affiché que si l'écran est atteint sans aucune photo — situation que le parcours normal ne produit pas. Concrètement, l'utilisateur n'a jamais à lancer l'analyse lui-même.

**Gestion des photos sur cet écran :**

- Grille avec une photo **PRINCIPALE** (la première) et des photos secondaires. Toucher une photo secondaire la promeut en principale ; cette première photo sert de vignette partout dans l'app (cartes, recherche, conversations).
- Ajout de photos supplémentaires (toujours dans la limite de 5) et suppression possibles **tant que l'analyse n'est pas en cours** (les actions sont grisées pendant l'analyse).
- **Ajouter une photo après l'analyse ne relance pas l'IA** : la fiche pré-remplie est conservée telle quelle, et les images seront toutes re-téléversées au moment de la publication.
- Un bloc « Conseils pour de meilleures photos » rappelle : bonne luminosité et fond neutre, montrer tous les détails et défauts, photos claires sans reflets.

**Ce que voit l'utilisateur pendant l'analyse** (barre de progression + liste d'étapes) : deux étapes, les seules que l'application observe réellement — le serveur fait toute l'analyse en un seul appel au modèle :

1. Envoi des photos
2. Analyse par l'IA

À la fin, des pastilles affichent les valeurs réellement détectées (catégorie, marque, matières, couleur, taille, état). Aucune pastille ne s'allume avant qu'une donnée existe.

**Ce qui se passe réellement :** chaque photo est **redimensionnée sur l'appareil** (plus grand côté borné à 1600 px, une photo plus petite n'est jamais agrandie) et **ré-encodée en JPEG** (qualité 0,8) — ce qui règle au passage le cas des photos iPhone en HEIC/HEIF. Si la compression échoue, la photo n'est pas téléversée : l'original brut, avec sa géolocalisation, ne part jamais. Une image qui dépasserait encore **5 Mo** après ce traitement est refusée. Les images traitées sont ensuite **téléversées** dans le stockage cloud (dossier de brouillon rattaché au compte du vendeur), puis envoyées à un modèle d'IA (Gemini, via une fonction serveur, tenu de répondre en JSON) qui renvoie une fiche structurée. La marque détectée revient sous son nom **canonique** du catalogue quand un rapprochement est trouvé. Références : `config/aiConfig.ts`, `features/sell/services/aiService.ts`, `functions/src/callable/ai.ts`.

**Données pré-remplies par l'IA :** titre, description, **catégorie** (avec son chemin hiérarchique), **état**, **couleur principale**, **matières** (jusqu'à 4, lues sur l'étiquette), **marque** (avec rapprochement vers une marque connue du catalogue interne), **taille** détectée, et une **suggestion de taille de colis** (petit / moyen / grand). Chaque champ porte un **niveau de confiance** qui déclenche l'affichage d'un badge « IA » sur le champ concerné à l'étape suivante.

> La suggestion de taille de colis est produite mais **inutilisée aujourd'hui** : l'écran d'expédition est masqué (voir 4.5).

**Limites et garde-fous :**

- **Quota : 10 analyses réussies par heure et par utilisateur** (limite serveur anti-abus, `functions/src/callable/ai.ts`). Seule une analyse **réussie** est décomptée : une panne du modèle, une photo refusée ou une réponse illisible ne coûtent rien. Au-delà : « Limite atteinte : maximum 10 analyses par heure. Réessayez plus tard. » — et l'écran ne propose alors plus RÉESSAYER, seulement la saisie manuelle.
- **Bornes serveur** : 1 à 5 photos par analyse, en JPEG, PNG, WebP, HEIC ou HEIF, sous un plafond de poids — vérifiées avant tout décompte et tout appel au modèle.
- **Délai** : l'application attend jusqu'à 130 s, au-delà des 120 s de la fonction serveur. Au-delà, l'analyse est déclarée en échec (« Analyse trop longue »).
- **Photo refusée par le filtre de sécurité du modèle** : le message le dit (« Cette photo a été refusée par la modération automatique »), au lieu d'une erreur opaque. Les messages d'erreur sont en français.
- En cas d'échec, l'écran propose **RÉESSAYER** ou **« ou remplir manuellement »**. Pendant l'analyse, un lien **« Passer et remplir manuellement »** permet d'abandonner l'attente. Une fois l'analyse réussie, le bouton est **CONTINUER** : la navigation n'est jamais automatique, l'utilisateur garde la main.
- En cas d'erreur réelle, **seules les images de l'essai en échec** sont supprimées (celles d'une analyse précédente réussie, que le brouillon référence, sont gardées) ; elles sont **conservées** si l'utilisateur a simplement annulé. Quitter l'écran pendant l'analyse demande confirmation, et l'appel au modèle n'est pas lancé si l'écran a été quitté pendant le téléversement.
- **« Remplir manuellement »** part d'une fiche vide (état par défaut « bon état ») : l'IA n'est jamais une étape obligatoire. Conséquence pratique : dans ce cas les photos ne sont pas téléversées pendant le tunnel, elles le sont **au moment de publier** — la publication est donc un peu plus longue.
- Une réponse du modèle sous forme de liste est lue (le premier objet est retenu) ; elle faisait auparavant échouer l'analyse en « Erreur serveur ».

À la fin d'une analyse réussie, un récapitulatif affiche le **nombre de champs pré-remplis**.

**Reprise sans re-consommer le quota :** si l'on revient sur un brouillon qui contient déjà un résultat d'analyse pour **les mêmes photos, dans le même ordre**, avec leurs images téléversées, la fiche est réhydratée telle quelle — l'IA n'est pas rappelée. Des photos différentes, même en même nombre, relancent l'analyse. Ajouter, retirer ou réordonner une photo sur cet écran est enregistré dans le brouillon.

### 4.4 Étape 3 — Détails de l'article

Formulaire de vérification / complétion, pré-rempli par l'IA. Seuls les champs que l'IA a **réellement remplis** portent un badge « IA » (aucun après « Remplir manuellement »). Champs :

- **Titre** (obligatoire, max 80 caractères côté saisie).
- **Description** (obligatoire pour continuer, max 500 caractères côté saisie).
- **Catégorie** (obligatoire) — sélection via une feuille de catégories hiérarchiques ; la suggestion IA est mise en avant. Changer de catégorie **remet la taille à zéro** (la grille de tailles dépend de la catégorie).
- **État** — sélecteur parmi **5** valeurs : `Neuf avec étiquette`, `Neuf sans étiquette`, `Très bon état`, `Bon état`, `Satisfaisant` (`data/conditions.ts`).
- **Marque** — recherche dans le catalogue de marques, pré-renseignée par la détection IA. Si la marque cherchée n'existe pas, le vendeur peut **l'ajouter lui-même** : elle est immédiatement écrite dans le catalogue partagé, sans modération (`components/BrandSelectionSheet.tsx`).
- **Taille** — liste adaptée à la catégorie (vêtements adulte, chaussures, enfant, accessoires « Unique / S / M / L / XL »). **Seule la grille EU est proposée à la vente** (`data/sizes.ts`).
- **Couleur(s)** et **Matière(s)** — sélection **multiple** par pastilles, avec « voir tout » pour la liste complète. Les suggestions IA sont affichées en premier.

**Règles de gestion :**

- Le bouton **CONTINUER** exige un **titre d'au moins 3 caractères** (comme l'aperçu et le serveur), une **description non vide** et **au moins une catégorie**. Tant qu'il manque quelque chose, le bouton reste grisé mais un tap dit ce qui manque.
- La saisie est **auto-sauvegardée** dans le brouillon (débounce ~0,5 s) ; quitter — y compris par le geste de retour iOS ou le bouton Android — affiche « Quitter ? Tes modifications seront sauvegardées dans le brouillon ». Revenir sur l'écran les restitue, reprise ou simple aller-retour.
- À l'arrivée sur cet écran, le brouillon passe à l'**étape 2**.

### 4.5 Étape 4 — Prix & livraison

**Prix :**

- Saisie numérique nettoyée (chiffres, virgule ou point, 2 décimales max). Tant que le formulaire est incomplet, le bouton APERÇU reste grisé, et un tap affiche ce qui manque.
- Revenir à l'écran Détails enregistre immédiatement le prix et la livraison, sans alerte.
- **Bornes : prix valide entre 0,01 $ et 10 000 $.** En dessous → « Entrez un prix valide » ; au-dessus → « Le prix maximum est de 10 000 $ ».
- Devise : **dollar canadien**, affiché à la canadienne (`45,50 $`).

**Options de livraison :**

- **Remise en main propre** (meetup) : le vendeur choisit un ou plusieurs **quartiers de Montréal**. Quatre raccourcis (Plateau, Mile End, Rosemont, Villeray) et une feuille listant les **45 quartiers** classés par arrondissement (`data/neighborhoods.ts`). Si la main propre est active, **au moins un quartier** est requis — le serveur le revérifie ; **10 au maximum**, à la saisie comme au serveur, qui refuse au-delà au lieu de tronquer.
- **Expédition** : choix d'une **taille de colis** (petit / moyen / grand), la suggestion IA étant pré-sélectionnée.
- Règle commune : **au moins une** option de livraison doit être active.

**Spécificité produit importante — l'expédition est DÉSACTIVÉE.** Un drapeau de fonctionnalité (`SHIPPING_ENABLED = false` dans `config/featureFlags.ts`) masque tout le bloc expédition et **force chaque nouvel article en main propre**. Tant que ce drapeau reste à `false` :

- Seule la remise en main propre est proposée à la vente, et **uniquement dans Montréal** : un vendeur hors de la zone n'a aujourd'hui aucun mode de remise adapté.
- Un ancien brouillon configuré en expédition est ramené automatiquement à la main propre lors de sa reprise.
- Le code d'expédition (taille de colis, partenaire logistique ShipEngine) reste en place et réactivable d'un seul interrupteur.

> **Angle mort de l'interface :** la carte « Remise en main propre » reste un interrupteur. Le vendeur peut la **désactiver** — et se retrouve alors bloqué sur « Sélectionnez au moins une option de livraison » sans aucune alternative proposée, puisque le bloc expédition est masqué. Le seul recours est de la réactiver.

**Persistance :** prix et livraison sont auto-sauvegardés dans le brouillon et restitués à chaque retour sur l'écran ; l'arrivée sur cet écran fait passer le brouillon à l'**étape 3**.

### 4.6 Étape 5 — Aperçu et publication

L'aperçu affiche la fiche **telle que la verra un acheteur** : carrousel de photos avec badge « APERÇU », marque, titre, prix, pastilles (état, taille, couleurs, matières), description, tableau de caractéristiques et badges de livraison (un badge par quartier de main propre ; « Expédition » uniquement si le drapeau est actif).

Deux actions : **PUBLIER L'ANNONCE** ou **Modifier** (revenir en arrière).

**Au moment de publier, l'application effectue une dernière validation locale :**

- Titre ≥ 3 caractères.
- Prix > 0 et ≤ 10 000 $.
- Au moins une photo.
- Au moins une catégorie.

Si une de ces conditions manque, une alerte « Informations manquantes » liste les erreurs et bloque la publication. Un garde anti-double-clic empêche les publications en double, et l'écran refuse de se fermer pendant l'envoi — bouton, geste de retour iOS et bouton Android compris. Les images téléversées pendant l'analyse ne sont utilisées que si elles correspondent une à une aux photos affichées ; sinon les photos sont téléversées à la publication.

**Publication rejouable sans doublon.** Chaque publication porte l'identifiant du brouillon : si la réponse du serveur se perd (l'article est créé mais l'application affiche une erreur), un nouvel essai rend l'article déjà créé au lieu d'en publier une copie.

**La publication passe par le serveur** (fonction `createArticle`, `functions/src/callable/products.ts`). Le serveur re-valide tout, indépendamment du client, et applique des règles métier renforcées :

- **E-mail vérifié obligatoire.** Un compte dont l'e-mail n'est pas vérifié est refusé (« Veuillez vérifier votre adresse e-mail avant de publier. »). L'app propose alors un raccourci « Vérifier mon email » — utile car le jeton d'authentification peut mettre jusqu'à une heure à refléter une vérification toute fraîche.
- **Vente réservée aux 18 ans et plus**, vérifiée sur la fiche profil.
- Re-validation : titre ≥ 3 caractères **après nettoyage**, prix entre 0,01 $ et 10 000 $, 1 à 10 images (limite de sécurité serveur ; la limite produit reste 5 côté app) **hébergées dans le stockage de Seconde** (une URL extérieure est refusée), état parmi les 5 valeurs autorisées, 1 à 6 identifiants de catégorie, au moins un mode de livraison, au moins un quartier pour la main propre, 10 quartiers au plus, quartiers bien formés (sinon « Quartier invalide »).
- **Nettoyage du texte** : suppression des balises HTML — des vraies balises seulement : « Tour de taille <70 cm » est conservé —, titre tronqué à 200 caractères, description à 5 000, libellé de catégorie à 100.
- **Normalisation de la marque** : rapprochement vers une marque connue du catalogue (nom canonique) ou mise en forme propre (Title Case, avec exceptions type « COS », « A.P.C. ») sinon.
- **Identité du vendeur non négociable** : le nom et la photo affichés sur l'annonce sont relus depuis la fiche profil côté serveur, jamais repris du téléphone. Si le vendeur a désactivé « afficher ma photo de profil », aucune photo n'est recopiée sur l'article.
- **Rattachement automatique à la boutique** : si le vendeur possède une boutique approuvée, l'article y est rattaché sans action de sa part.
- La **taille** est stockée sous forme structurée `{ valeur, système }` (système « EU » côté vendeur).
- Couleurs / matières / quartiers sont stockés en **listes** (multi-sélection) avec conservation d'une valeur unique pour compatibilité.

> **Point de vigilance :** les règles de la base autorisent encore l'écriture directe d'un article sans passer par cette fonction (`firestore.rules`), parce que les builds antérieurs au 2026-05-25 écrivent eux-mêmes. Elles refusent désormais ce qu'aucun client légitime n'écrit : un article qui naît vendu, une date de création qui n'est pas une date ou qui est dans le futur, une boutique, une baisse de prix, la réécriture du nom ou de la photo du vendeur, l'édition d'un article vendu, la suppression dure. La fermeture complète est prête derrière la bascule `strictArticleClientWrites()`, à activer quand plus aucun ancien build ne circule. D'ici là, e-mail vérifié, marque normalisée et rattachement boutique reposent sur le passage par le serveur.

**Pas d'onboarding Stripe imposé à la publication.** Créer un article n'oblige pas le vendeur à ouvrir un compte de paiement. L'onboarding paiement (Stripe Connect Custom, white-label) n'est exigé qu'au moment où un article en **expédition** est acheté (`functions/src/callable/payments/checkout.ts`) ; la main propre n'en dépend pas — et l'expédition étant coupée, ce contrôle n'est aujourd'hui jamais atteint.

**État initial de l'article publié :**

- `isActive = true` (en ligne), `isSold = false` (disponible).
- **Modération : `approved`** dès la création. La mise en vente est donc **immédiate**, sans validation manuelle préalable. La notion de modération existe dans le système (un statut `pending`/`rejected` retirerait l'article de la recherche), mais rien dans le parcours ne produit ces statuts.
- Compteurs à zéro : vues, mentions « j'aime », favoris.
- **Aucun contrôle de doublon de contenu** : rien n'empêche de publier deux fois le même vêtement par deux brouillons différents. Seul le rejeu d'une même publication est dédoublonné.

**Indexation pour la recherche.** Dès que l'article est créé, des automatismes serveur alimentent un **index de recherche** dédié : mots-clés (titre, description, marque, catégorie), champs filtrables (catégorie, marque, couleurs, matières, taille, état, prix), vignette, données vendeur et un **score de popularité**. Seuls les articles actifs, non vendus et non bloqués en modération y figurent. En parallèle, un **vecteur d'image** est calculé pour la recherche visuelle et les suggestions d'articles similaires, et les statistiques du vendeur sont recalculées (articles listés / actifs / vendus, vues, mentions « j'aime »).

**Après publication réussie :**

- Le **brouillon est supprimé**, mais les photos déjà téléversées sont **conservées** pour l'article. Elles restent dans le dossier de brouillon du vendeur : le nettoyage quotidien les épargne tant qu'un article les utilise.
- Une **fenêtre de succès** s'affiche, proposant de **voir l'article** publié ou de **revenir à l'accueil**.

### 4.7 Brouillons & reprise

L'application gère un **brouillon unique** persistant sur l'appareil (stockage local), incluant : photos (cache local + adresses cloud après analyse), résultat IA, champs de détails, prix/livraison, et l'**étape atteinte** (1 à 4).

- **Reprise :** en revenant dans l'onglet « Vendre », si un brouillon en cours est détecté, une **fenêtre « Brouillon trouvé »** s'affiche avec l'aperçu de la première photo, la date de dernière modification, l'étape atteinte (Photos / Détails / Prix / Aperçu) et le nombre de **jours restants**. Reprendre renvoie l'utilisateur **exactement à l'étape où il s'était arrêté** (une analyse terminée compte comme l'étape Détails). « Recommencer » demande confirmation, puis supprime le brouillon et repart de la caméra. Le bouton retour d'Android ferme la fenêtre sans choisir.
- **Même règle sur iOS et Android :** la reprise est proposée dès que le brouillon contient des photos **ou** des images déjà téléversées **ou** un résultat d'analyse. Un brouillon repris à l'étape « Prix » ou « Aperçu » retrouve ses photos et ses champs. Quitter l'appareil photo sans aucun travail supprime le brouillon vide, sur les deux plateformes.
- **Expiration : 14 jours.** Un brouillon plus ancien est automatiquement supprimé au chargement, avec nettoyage des images locales et cloud associées — sauf celles qu'un article du vendeur utilise ; si cela ne peut pas être vérifié (hors ligne), les images cloud sont laissées au robot serveur.
- Un nettoyage, lancé **une fois le compte connu**, supprime les images locales orphelines (n'appartenant à aucun brouillon courant), et un **robot serveur quotidien** (`functions/src/scheduled/cleanupDrafts.ts`, fuseau Toronto) supprime du stockage cloud les images de brouillon de plus de 14 jours **qu'aucun article ne référence**. Les photos d'un article publié vivent dans ce dossier : le robot les effaçait auparavant quatorze jours après la prise de vue.
- Changer les photos d'un brouillon (en ajouter, en retirer, les réordonner) invalide les images déjà téléversées, qui décrivaient d'autres photos.

### 4.8 Gestion des articles existants

Depuis l'écran « Mes articles » (`app/my-articles.tsx`), le vendeur gère son catalogue. Trois filtres : **Tous**, **En vente**, **Vendus**. Chaque ligne affiche la vignette, le titre, le prix, la taille, les vues, les « j'aime » et l'état (En vente / Vendu). **Seuls les articles actifs sont listés** : un article désactivé disparaît de cet écran.

**Actions par article (menu « … » ou balayage vers la gauche) :**

| Action | Disponibilité | Effet |
|--------|---------------|-------|
| Modifier | Article **non vendu** uniquement | Ouvre l'écran d'édition |
| Marquer comme vendu / Remettre en vente | Toujours | Bascule l'état vendu / disponible |
| Retirer de la vente (menu ou balayage) | Toujours, article vendu compris | Désactivation de l'article (voir plus bas) |

**Marquer comme vendu** demande confirmation (les favoris et les offres en attente seront perdus, et la remise en vente ne les rétablit pas), passe par le serveur (`toggleArticleSold`) et **refuse la bascule si une transaction est en cours** sur l'article. La liste des statuts bloquants suit désormais les statuts réellement existants — paiement en attente, rendez-vous main propre en attente ou confirmé, commande payée, étiquette créée, colis expédié, colis livré, retour demandé, échec de livraison, colis égaré, litige, remboursement en cours — et le contrôle est fait **dans la même transaction de base de données** que la bascule, ce qui ferme la course avec une offre de rencontre acceptée au même instant (auparavant, un vendeur pouvait remettre en vente un article sous un rendez-vous en train d'être conclu). Quand un article devient « vendu », des automatismes le **retirent de l'index de recherche** et de l'index visuel, **expirent les offres en attente** dans les conversations liées et **informent** les acheteurs par un message système. Deux cas sont distingués : une **réservation** (une offre de rencontre acceptée pose le verrou « vendu » pour une rencontre qui peut encore échouer) garde l'article dans les favoris et le message dit « Cet article est réservé » ; une **vente** sans transaction en cours le retire des favoris de tous et le message dit « Cet article a été vendu ». La remise en vente le ramène **immédiatement** dans la recherche.

**Retirer de la vente** est une **désactivation** (`isActive = false`) : l'article n'est pas effacé mais retiré de la vente, de l'index de recherche et de « Mes articles ». Là aussi, les offres en attente associées sont expirées et les participants notifiés (« Cet article a été retiré de la vente… »). Le message de confirmation le dit : « ne sera plus visible par les acheteurs. Vous ne pourrez pas le remettre en ligne » — **aucun écran ne permet de réactiver** un article désactivé. L'action fonctionne aussi sur un article vendu, et une seconde demande sur un article déjà retiré ne produit pas d'erreur.

**Édition d'un article (`app/article/edit/[id].tsx` → `updateArticle`) :**

- **Interdite sur un article vendu** — l'écran le refuse à l'ouverture (« Cet article est vendu et ne peut plus être modifié ») et le serveur le refuse aussi.
- **Interdite sur un article désactivé** et **interdite si une transaction est en cours** sur l'article (verrou de cohérence).
- Champs modifiables : titre, description, prix, état, catégorie, photos (5 maximum, **au moins une**, ajout depuis la galerie uniquement), marque (effaçable), taille, couleurs, matières, quartiers de main propre (10 au plus).
- Les photos ajoutées localement sont téléversées au moment d'enregistrer, et supprimées si l'enregistrement est refusé. Une photo retirée de l'article est effacée du stockage (dans les dossiers du vendeur et de l'article seulement).
- Un texte tapé dans un champ mais pas encore « Confirmé » est pris en compte à l'enregistrement, et compte comme une modification non enregistrée : quitter — bouton, geste de retour iOS ou bouton Android — demande confirmation. Un refus du serveur affiche sa raison (article vendu entre-temps, transaction en cours, champ invalide).
- **Tant que l'expédition est désactivée, l'édition ne touche jamais la configuration d'expédition d'un article existant** : un ancien article configuré en expédition conserve ses réglages intacts, pour ne pas les perdre silencieusement le jour où le drapeau sera rallumé.
- **Baisse de prix :** une baisse d'**au moins 5 %** du prix courant enregistre le **prix d'origine**, le **pourcentage de baisse** et la **date de la baisse** — c'est ce qui alimente l'affichage « prix réduit », le carrousel « Baisses de prix » et la notification aux personnes ayant mis l'article en favori. Une baisse plus petite ajuste le pourcentage affiché sans remettre l'article en tête du carrousel. **Toute hausse** efface ces informations (plus de fausse promotion affichée). Reste possible : publier bas, monter puis redescendre fabrique un prix d'origine gonflé — le fermer est une décision produit (référence de prix sur une période).
- Toute modification du **titre, du prix ou de la première photo** est **propagée automatiquement** aux conversations qui référencent l'article (titre, vignette et prix affichés dans le chat restent à jour).

### 4.9 Spécificités Canada et iOS / Android

- **Devise :** prix saisis et affichés en **dollars canadiens**, format canadien-français (`45,50 $`), plafonnés à 10 000 $.
- **Lieux de remise :** la main propre repose sur un catalogue de **45 quartiers de Montréal**, seule option active tant que l'expédition est désactivée. C'est aujourd'hui la limite géographique de fait de la mise en vente.
- **Âge :** vente réservée aux **18 ans et plus** (exigence du partenaire de paiement) ; l'inscription et l'achat restent ouverts dès 16 ans.
- **Loi 25 (Québec) / vie privée :** la mise en vente n'expose aucune donnée sensible nouvelle ; les photos transitent par un stockage cloud rattaché au compte du vendeur (les images de brouillon y sont toutefois **lisibles publiquement** par quiconque connaît l'adresse), et les images d'un brouillon abandonné ou expiré sont supprimées (local + cloud, sous 14 jours). Seul le vendeur peut écrire, remplacer ou supprimer les photos de ses articles. La suppression du compte efface aussi son dossier de brouillon. Le réglage « afficher ma photo de profil » s'applique à tous ses articles, publiés avant comme après.
- **iOS :** l'étape 1 est une surcouche immersive ; les photos iPhone en **HEIC/HEIF** sont converties en JPEG avant analyse et publication ; l'écran Prix remonte le clavier (comportement « padding »).
- **Android :** l'étape 1 est un écran classique ; le système gère seul le redimensionnement au clavier sur l'écran Prix. Les dialogues de permission caméra/galerie diffèrent visuellement selon l'OS mais offrent le même repli (import galerie si la caméra est refusée).
- **L'écran Détails**, lui, gère le clavier de la même façon sur les deux plateformes (le pied de page suit le clavier).
- **Sur le fond, les plateformes sont alignées :** mêmes règles de validation, même IA, mêmes quotas, même publication serveur, même condition de reprise d'un brouillon. Le seul écart est la présentation de l'étape 1.

### 4.10 Monétisation (ce que la mise en vente coûte au vendeur)

- **Publier un article est gratuit** et **sans commission vendeur** : le vendeur conserve l'intégralité de son prix de vente. Ni frais de mise en ligne, ni prélèvement sur le montant affiché.
- **Aujourd'hui, une vente ne coûte rien à personne.** Le seul parcours d'achat actif est la remise en main propre, et une transaction en main propre est explicitement **sans frais de plateforme** — ni côté vendeur, ni côté acheteur. Les frais acheteur (et leur réduction par l'offre payante « Boutiques ») ne s'appliquent qu'aux transactions expédiées, donc à rien tant que l'expédition est coupée.
- L'analyse IA est offerte au vendeur, dans la limite anti-abus de **10 analyses par heure**.
