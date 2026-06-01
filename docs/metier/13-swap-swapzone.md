## 13. Swap & SwapZone

Le Swap (troc) est la fonctionnalité d'**échange d'articles entre deux membres**, en alternative à l'achat. Plutôt que de payer pour une pièce, un membre propose une ou plusieurs de ses propres pièces en échange de celles d'un autre membre. La fonctionnalité s'articule autour de trois surfaces :

- la **SwapZone**, une zone d'échange permanente et généraliste (catalogue dédié au troc) ;
- l'écran de **proposition d'échange** (sélection des articles de chaque côté, comparaison de valeur, complément en argent éventuel) ;
- le **cycle de vie d'un échange** (proposé → accepté → expédié → terminé, avec gestion de litige et de remboursement).

Le modèle économique du troc est volontairement **gratuit côté article** : aucun argent ne change de main pour les pièces troquées. La plateforme n'encaisse de frais que lorsqu'il y a un **complément en argent** (top-up), traité comme un mini-achat avec frais de protection acheteur.

---

### 13.1 La SwapZone — une zone d'échange permanente et généraliste

#### Principe

La SwapZone est **une seule zone, permanente, généraliste, toujours ouverte**. Le code l'a explicitement migrée d'un ancien modèle de « swap-parties » thématiques et éphémères (avec dates de début/fin, thème, participants) vers cette zone unique. Concrètement :

- **Pas d'inscription / pas de participants** : tout membre connecté peut déposer un article, parcourir la zone et proposer un échange. Il n'y a aucune notion de « rejoindre » ou « quitter ».
- **Pas de thème, pas de fenêtre de temps, pas de compte à rebours** : la zone est toujours active. L'objectif assumé est la **liquidité** (avoir en permanence du stock à troquer) plutôt que l'effet d'urgence (FOMO) des anciennes parties événementielles.
- **Identité visuelle sombre** : la SwapZone est l'unique univers « sombre » de l'app (fond charcoal/deep, texte clair). C'est un contrepoint éditorial volontaire au reste de l'app (blanc cassé chaleureux). Le bloc d'accès depuis l'accueil est lui aussi une bande sombre pleine largeur.
- **Zone unique côté données** : la zone vit dans un document à identifiant fixe (`generalist`). Cet identifiant déterministe garantit qu'une seconde zone ne peut jamais être créée par erreur, et la zone est créée automatiquement si elle n'existe pas encore (auto-réparation au premier accès). Les anciennes routes `/swap-parties` et `/swap-party/[id]` existent toujours mais **redirigent simplement vers `/swap-zone`** (compatibilité avec d'anciens liens / notifications).

#### Accès depuis l'accueil

L'accueil affiche un **bloc SwapZone** (bande sombre) avec :

- le titre « Swap Zone » (« Zone » accentué en rust),
- la tagline **« Échange tes pièces, sans frais. »**,
- deux statistiques : le **nombre d'articles** déposés dans la zone, et le **nombre de nouveautés cette semaine** (articles ajoutés dans les 7 derniers jours, dérivé de la date de dépôt).

Le bloc n'est cliquable que si la zone existe réellement ; sinon il s'affiche en « teaser » non interactif (jamais de bouton mort).

#### Écran SwapZone (`/swap-zone`)

L'écran se compose de :

1. **« Mes pièces »** — une section en haut où le membre voit les articles qu'il a lui-même déposés dans la zone, avec une entrée « + » pour en déposer d'autres. Cette entrée de dépôt est **toujours visible**, même déconnecté : un appui déconnecté déclenche l'invite d'inscription (« Inscrivez-vous pour participer à la Swap Zone »).
2. **Une barre de filtres** identique à celle de la recherche : Trier, Catégorie, Taille, Couleur, Marque, Matière, État. Le filtrage est appliqué **côté client** sur le stock (borné) de la zone.
3. **La grille des articles disponibles** des autres membres (en 2 colonnes), avec un compteur « Articles disponibles · N ».

**Dépôt d'un article dans la zone.** Le membre choisit parmi ses propres articles actifs et non vendus. Règles de gestion vérifiées côté serveur :
- l'article doit **lui appartenir** (le vendeur réel de l'article fait foi, pas l'information envoyée par l'app) ;
- l'article doit être **actif et non vendu** ;
- un même article **ne peut pas être déposé deux fois** dans la zone (garde anti-doublon).
Le compteur d'articles de la zone est tenu à jour de façon atomique à chaque ajout / retrait. Le retrait d'un article est instantané à l'écran (suppression optimiste, avec retour arrière en cas d'échec).

**Démarrer un échange depuis la zone.** Deux gestes :
- **Appui simple** sur l'article d'un autre membre → ouvre l'écran de proposition d'échange, **pré-rempli** avec cet article du côté « leur article » et ciblé sur ce vendeur.
- **Appui long** → active un **mode multi-sélection verrouillé sur un seul vendeur** : on peut cocher plusieurs articles, mais uniquement ceux du même membre. Une barre en bas (« Proposer ») démarre alors une proposition portant sur tous les articles cochés.

Cette contrainte « un seul vendeur » est structurante : **un échange implique toujours exactement deux personnes**.

---

### 13.2 Proposer un échange (`/propose-swap`)

#### Composition de la proposition

L'écran de proposition montre deux blocs symétriques :

- **« Leur article »** — un ou plusieurs articles du destinataire (pré-rempli depuis la zone, ou sélectionnable parmi les articles du destinataire). Quand c'est possible, le sélecteur est limité aux articles que le destinataire a réellement déposés dans la zone ; sinon il propose tout son inventaire actif.
- **« Mon article proposé »** — un ou plusieurs articles de l'initiateur, choisis parmi ses propres articles actifs et non vendus.

L'échange est donc **multi-articles des deux côtés** : on peut proposer 2 pièces contre 3, etc. Un message libre optionnel peut accompagner la proposition.

#### Comparaison de valeur

Dès qu'au moins un article est sélectionné de chaque côté, une **boîte de comparaison de valeur** s'affiche :

- la valeur totale de « Vos articles » et de « Leurs articles » (somme des prix affichés des pièces) ;
- un indicateur de différence : soit **« Valeurs équivalentes »** (vert) si les totaux sont égaux, soit **« Différence de X $ en leur faveur / en votre faveur »** (rust) sinon.

La comparaison est purement **indicative** : rien n'oblige les valeurs à être égales pour proposer. C'est un repère pour décider d'ajouter ou non un complément.

#### Complément en argent (top-up)

Sous la comparaison, un module permet d'**ajouter un complément en argent** pour rééquilibrer l'échange :

- un **sélecteur de payeur** : « Je paie » (l'initiateur) ou « {Nom} paie » (le destinataire) ;
- un **montant** en dollars (champ numérique) ;
- si une différence de valeur existe, un bouton **« Suggéré : X $ »** pré-remplit le montant avec l'écart calculé.

Règles de gestion (validées côté serveur) :

| Règle | Détail |
|-------|--------|
| Montant | Entier strictement positif, **plafonné à 5 000 $** (cohérent avec le plafond des offres dans la messagerie). |
| Devise | **CAD** (dollar canadien). Le montant est saisi en dollars dans l'app et converti en cents pour le backend. |
| Payeur | Doit être **soit l'initiateur, soit le destinataire** de l'échange. |
| Moment du paiement | **Rien n'est débité à la proposition.** Le complément n'est encaissé qu'après acceptation (voir 13.4). |

#### Garde-fous à l'envoi

Avant la création de la proposition, l'app et le serveur vérifient :
- qu'il y a **au moins un article de chaque côté** ;
- qu'on ne propose **pas un échange avec soi-même** ;
- qu'**aucun des deux membres n'a bloqué l'autre** (le blocage empêche la proposition) ;
- que **tous les articles existent, sont actifs, ne sont pas vendus**, et appartiennent bien au participant attendu (l'initiateur ne peut engager que ses propres articles ; les articles demandés doivent réellement appartenir au destinataire). Cette vérification d'appartenance est un invariant fort : sans elle, un membre malveillant pourrait engager les articles d'un tiers.

À l'envoi réussi, une confirmation « Proposition envoyée ! » s'affiche et le membre est redirigé vers **« Mes échanges »** (`/my-swaps`).

---

### 13.3 États / statuts d'un échange

Un échange (`swap`) passe par les statuts suivants :

| Statut | Signification | Déclenché par |
|--------|---------------|---------------|
| `proposed` | Proposition envoyée, en attente de réponse | Initiateur |
| `payment_pending` | Acceptée **avec** complément — en attente du paiement du complément | Destinataire (acceptation) |
| `accepted` | Acceptée (sans complément), **ou** complément payé | Destinataire / webhook Stripe |
| `declined` | Refusée par le destinataire | Destinataire (ou initiateur, tant que `proposed`) |
| `cancelled` | Annulée par l'initiateur | Initiateur |
| `photos_pending` | Mode d'échange choisi, en attente des photos des deux côtés | Participant (choix du mode) |
| `shipping` | Les deux ont uploadé leurs photos → en cours d'envoi / réception | Système (2e upload) |
| `completed` | Échange terminé (les deux ont confirmé la réception) | Système (2e réception) |
| `disputed` | Litige ouvert | Participant |

Le détail d'un échange (`/swap/[id]`) est **temps réel** : l'écran s'abonne au document et reflète immédiatement tout changement de statut (utile quand l'autre partie agit en parallèle, ou quand le webhook Stripe avance le statut après paiement).

**Toutes les transitions de statut sensibles passent par le serveur** (Cloud Functions). L'app cliente ne peut pas écrire librement ces champs : c'est une garantie d'intégrité (et de sécurité financière pour les compléments).

---

### 13.4 Cycle de vie pas à pas

#### Étape 1 — Réponse à la proposition

Côté **destinataire**, l'écran affiche une vue détaillée : profil de l'expéditeur, message éventuel, « Elle propose » (leurs articles), badge de complément le cas échéant, « Contre mon article » (vos articles), et un résumé. Deux actions collantes en bas : **Accepter** / **Refuser**.

- **Accepter** : seul le destinataire peut accepter, et seulement si le statut est `proposed`. Le serveur **revérifie** que tous les articles des deux côtés sont toujours disponibles et toujours détenus par les bonnes personnes (fermeture de la fenêtre où un article aurait changé de main entre la proposition et l'acceptation).
  - S'il n'y a **pas de complément** → l'échange passe directement à `accepted`.
  - S'il y a un **complément** → l'échange passe à `payment_pending` (le paiement doit être réglé avant de continuer).
- **Refuser** : passe à `declined`. Possible tant que le statut est `proposed`, par l'un OU l'autre participant.
- **Annuler** (côté initiateur) : passe à `cancelled`. Possible tant que le statut est `proposed` ou `payment_pending`. Une fois le complément payé (statut `accepted`), l'initiateur ne peut plus annuler — il doit passer par le litige.

#### Étape 2 — Paiement du complément (si applicable)

Quand l'échange est en `payment_pending`, **seul le payeur** voit un bouton **« Régler le complément »** ; l'autre partie voit « En attente du paiement de {Nom} ».

Le paiement reprend exactement la mécanique d'un achat normal :
- frais de **protection acheteur** identiques à un achat : **5 % + 1,50 $, minimum 2,00 $** (le complément joue le rôle du « prix article », sans livraison) ;
- **0 % de commission vendeur** (le bénéficiaire reçoit l'intégralité du complément) ;
- paiement via la **PaymentSheet Stripe** intégrée à l'app (le membre saisit sa carte dans l'app, jamais sur un site Stripe — modèle white-label).

Mécanique financière (transparente pour l'utilisateur, mais structurante) :
- le complément est crédité au bénéficiaire via le **portefeuille interne** (ledger), pas par un virement Stripe direct, afin d'éviter un double paiement ;
- à la réussite du paiement, le **webhook Stripe** fait avancer automatiquement l'échange de `payment_pending` à `accepted` et crédite le **solde en attente** (pendingBalance) du bénéficiaire ;
- les fonds restent **bloqués (en attente)** jusqu'à la confirmation de réception (escrow), puis sont libérés vers le solde disponible.

Garde-fou important : le serveur **refuse d'initier le paiement** si le bénéficiaire n'a pas un compte de paiement **actif ET capable de recevoir des versements** (payouts activés). Sans ce garde-fou, le bénéficiaire accumulerait des fonds qu'il ne pourrait jamais retirer.

Le paiement est **idempotent** : si une PaymentIntent existe déjà pour cet échange, c'est elle qui est réutilisée (jamais de double complément).

#### Étape 3 — Choix du mode d'échange

Une fois `accepted`, l'un des deux participants choisit **comment échanger** :
- **En main propre** (« Retrouvez-vous pour échanger ») ;
- **Envoi postal** (« Envoyez-vous les articles par la poste »).

Le choix fait passer l'échange à `photos_pending`.

#### Étape 4 — Photos de preuve

Chaque participant doit envoyer **2 à 4 photos** de son article avant de l'expédier (sélection multiple depuis la galerie, photos compressées puis stockées). Tant qu'un seul côté a envoyé ses photos, l'autre voit « En attente des photos de l'autre participant ». **Quand les deux côtés ont uploadé**, l'échange passe à `shipping`.

#### Étape 5 — Envoi puis réception

En `shipping`, chaque participant :
1. confirme **« J'ai envoyé mon article »** ;
2. puis confirme **« J'ai reçu l'article »**.

**Quand les deux ont confirmé la réception**, l'échange passe à `completed`. À ce moment, le serveur :
- marque **tous les articles** des deux côtés comme **vendus + inactifs** (ils sortent du catalogue) ;
- si l'échange venait de la zone, marque les articles correspondants comme « troqués » et incrémente le compteur d'échanges de la zone ;
- **libère le complément** éventuel : les fonds du bénéficiaire passent de « en attente » à « disponible » (avec une écriture au ledger « Complément d'échange — fonds disponibles »).

#### Étape 6 — Évaluation

Une fois `completed`, chaque participant peut **noter l'échange de 1 à 5 étoiles** (avec commentaire optionnel). La note crée un **avis** sur l'autre membre (type « swap »), recalcule sa note moyenne, et lui envoie une notification « Nouvel avis reçu ». Chaque membre ne peut laisser qu'un seul avis par échange.

#### Litige et remboursement

Un **litige** peut être ouvert par l'un des participants pendant l'envoi (`shipping`) ou après complétion (`completed`). L'utilisateur choisit un motif prédéfini :
- « Je n'ai pas reçu l'article »,
- « L'article ne correspond pas à la proposition »,
- « L'article est endommagé »,
- « Autre problème ».

L'échange passe à `disputed`. **Si un complément avait été payé et n'a pas encore été libéré**, il est **automatiquement remboursé au payeur** via Stripe (la réconciliation du portefeuille du bénéficiaire se fait via le webhook de remboursement). Le message à l'utilisateur précise : « Notre équipe va examiner l'échange. Le complément éventuel est remboursé. » Une modération humaine peut suivre.

Une **porte de sortie** est prévue : pendant `shipping` (étape où un échange peut se bloquer si l'autre n'agit pas), le bouton « Ouvrir un litige » est toujours accessible.

Cas de remboursement liés à l'annulation : si l'initiateur annule alors qu'un complément aurait déjà été payé (cas limite resté en `payment_pending`), le complément est remboursé.

---

### 13.5 « Mes échanges » (`/my-swaps`)

Le membre retrouve tous ses échanges (initiés ou reçus) dans un écran à **onglets de filtre** :

| Onglet | Contenu | Pastille |
|--------|---------|----------|
| Tous | Tous les échanges | — |
| En attente | Statut `proposed` | Compteur des propositions en attente |
| En cours | `payment_pending`, `accepted`, `photos_pending`, `shipping` | Compteur des échanges actifs |
| Historique | `completed`, `declined`, `cancelled` | — |

Chaque carte montre l'autre membre, un **résumé visuel** des pièces de chaque côté (images empilées + badge « +N » au-delà de 3 pièces pour le multi-articles), les valeurs (« X $ ↔ Y $ »), la date relative (« Aujourd'hui », « Hier », « Il y a N jours »), et une **pastille de statut** colorée. L'état vide invite à « Découvrir la Swap Zone ».

---

### 13.6 Données clés (langage métier)

- **Zone** (`swapParties/generalist`) : nom, indicateur « généraliste », compteur d'articles, compteur d'échanges réalisés.
- **Article déposé** (`swapPartyItems`) : référence à l'article, son vendeur, titre, prix/valeur estimée, image, marque/taille/couleur/etc. (pour le filtrage), et deux drapeaux : « en attente » (engagé dans une proposition en cours) et « troqué » (échange complété).
- **Échange** (`swaps`) : les deux participants (nom, photo), les listes d'articles de chaque côté + valeurs totales, le complément éventuel (montant en cents + payeur), le statut, le message, le mode d'échange, les preuves photo, les horodatages d'envoi / réception de chaque côté, les évaluations, et le suivi du complément Stripe (PaymentIntent, frais, paiement, libération, remboursement).
- **Avis** (`avis`) : créé à l'évaluation d'un échange terminé (type « swap »).

---

### 13.7 Spécificités Canada & contraintes plateforme

- **Devise** : tous les montants (compléments, valeurs) sont en **dollars canadiens (CAD)**. La PaymentIntent du complément est explicitement en `cad`.
- **Frais** : aligné sur le reste de l'app — **5 % + 1,50 $, minimum 2,00 $** côté acheteur (ici, côté payeur du complément), **0 % de commission** côté bénéficiaire. La SwapZone est mise en avant comme « sans frais » : c'est vrai pour le troc pur ; des frais ne s'appliquent **que** sur l'argent ajouté en complément.
- **Loi 25 (Québec)** : l'échange manipule des données personnelles (nom, photo de profil, photos d'articles, localisation implicite). À noter, la fiche de proposition affiche une ligne de localisation et de réputation **codée en dur** (« Villeray · 2.8 km · 4.9 · 22 swaps », « il y a 2h ») : ce sont des **valeurs de maquette non encore branchées sur des données réelles** — à corriger avant production pour ne pas afficher d'information trompeuse.
- **Photos** : la sélection multiple de photos (2 à 4) et la PaymentSheet Stripe fonctionnent de la même façon sur **iOS et Android**. Aucune divergence produit majeure entre les deux plateformes sur le parcours d'échange.
- **Voile tactile Android** : la SwapZone utilise des bottom sheets (filtres, dépôt d'articles). Pour éviter un bug Android connu (overlay invisible bloquant le scroll/les clics), ces feuilles sont **montées uniquement à l'ouverture** et démontées à la fermeture. C'est une contrainte technique sans impact visible pour l'utilisateur si elle est respectée.

---

### 13.8 Limites connues / points de vigilance

- **Affichage du montant du complément** : dans certaines vues de détail (badge « Elle ajoute un complément de $X » et résumé d'échange), le montant est affiché en **cents bruts** (`$cashTopUp.amount`) sans conversion en dollars, alors qu'il est stocké en cents. Ex. un complément de 10,00 $ peut s'afficher « $1000 ». Le calcul financier réel (paiement Stripe) est correct ; c'est un **défaut d'affichage** à corriger.
- **Données de profil en dur** dans la fiche de proposition (localisation, distance, note, nombre de swaps, ancienneté) — voir 13.7.
- **Litige** : la résolution finale d'un litige (au-delà du remboursement automatique du complément) repose sur une **modération humaine** non automatisée dans le code ; le statut `disputed` n'a pas de transition de sortie automatique vers `completed` ou `cancelled`.
- **Réception en main propre** : même en mode « en main propre », le parcours impose toujours l'étape photos + confirmation d'envoi/réception (le mode change l'intention, pas le déroulé technique des confirmations).
