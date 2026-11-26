## 13. Swap & SwapZone

Le Swap (troc) est la fonctionnalité d'**échange d'articles entre deux membres**, en alternative à l'achat. Plutôt que de payer pour une pièce, un membre propose une ou plusieurs de ses propres pièces en échange de celles d'un autre membre. La fonctionnalité s'articule autour de trois surfaces :

- la **SwapZone**, une zone d'échange permanente et généraliste (catalogue dédié au troc) ;
- l'écran de **proposition d'échange** (sélection des articles de chaque côté, comparaison de valeur, complément en argent éventuel) ;
- le **cycle de vie d'un échange** (proposé → accepté → photos → envoi → terminé, avec expiration automatique, litige et remboursement).

Le modèle économique du troc est volontairement **gratuit côté article** : aucun argent ne change de main pour les pièces troquées. La plateforme n'encaisse de frais que lorsqu'il y a un **complément en argent** (top-up), traité comme un mini-achat avec frais de protection acheteur.

> **À savoir avant de lire la suite.** Le troc pur (article contre article) fonctionne de bout en bout aujourd'hui. Le **complément en argent est en pratique inutilisable** : le paiement du complément exige que le bénéficiaire ait un compte de paiement Stripe actif avec versements autorisés, or l'écran d'onboarding Stripe et le portefeuille sont fermés par le drapeau `PAYMENTS_ENABLED = false` (`config/featureFlags.ts`) et aucun parcours de l'app n'y mène. Un échange proposé avec complément peut donc être accepté, mais le paiement échoue systématiquement et l'échange s'auto-annule au bout de 7 jours (voir 13.4 et 13.8).

---

### 13.1 La SwapZone — une zone d'échange permanente et généraliste

#### Principe

La SwapZone est **une seule zone, permanente, généraliste, toujours ouverte**. Le code l'a explicitement migrée d'un ancien modèle de « swap-parties » thématiques et éphémères (avec dates de début/fin, thème, participants) vers cette zone unique. Concrètement :

- **Pas d'inscription / pas de participants** : tout membre connecté peut déposer un article, parcourir la zone et proposer un échange. Il n'y a aucune notion de « rejoindre » ou « quitter ».
- **Pas de thème, pas de fenêtre de temps, pas de compte à rebours** : la zone est toujours active. L'objectif assumé est la **liquidité** (avoir en permanence du stock à troquer) plutôt que l'effet d'urgence (FOMO) des anciennes parties événementielles. Les anciens rappels programmés (« Swap Zone dans 3 jours ») ont disparu du côté serveur ; il subsiste une fonction de notification inutilisée dans le code de l'app.
- **Identité visuelle sombre** : la SwapZone est l'unique univers « sombre » de l'app (fond charcoal/deep, texte clair). C'est un contrepoint éditorial volontaire au reste de l'app (blanc cassé chaleureux). Le bloc d'accès depuis l'accueil est lui aussi une bande sombre pleine largeur.
- **Zone unique côté données** : la zone vit dans un document à identifiant fixe (`generalist`). Cet identifiant déterministe garantit qu'une seconde zone ne peut jamais être créée par erreur, et la zone est créée automatiquement si elle n'existe pas encore (auto-réparation au premier accès). Les anciennes routes `/swap-parties` et `/swap-party/[id]` existent toujours mais **redirigent simplement vers `/swap-zone`** (compatibilité avec d'anciens liens / notifications).

#### Accès depuis l'accueil

L'accueil affiche un **bloc SwapZone** (bande sombre) avec :

- le titre « Swap Zone » (« Zone » accentué en rust),
- la tagline **« Échange tes pièces, sans frais. »**,
- deux statistiques : le **nombre d'articles** déposés dans la zone, et le **nombre de nouveautés cette semaine**.

Quand la zone est encore vide, la statistique laisse place à l'invitation « Dépose un article et trouve la pièce parfaite à troquer. »

Deux réserves de lecture, vérifiées dans le code :

- Le compteur « nouveautés cette semaine » n'est pas un vrai compteur : il est dérivé des **6 articles les plus récents seulement** (`features/home/swap-zone/useSwapZoneItems.ts`). Il ne peut donc jamais dépasser 6, même si 40 pièces ont été déposées dans la semaine.
- Le compteur « N articles » est le compteur stocké sur la zone. Il est incrémenté à chaque dépôt et décrémenté à chaque retrait volontaire ou à la suppression d'un compte, mais **il n'est jamais décrémenté quand une pièce est effectivement troquée ni quand elle est vendue en dehors de la zone**. Il dérive donc à la hausse avec le temps et surestime le stock réel. La grille de la zone, elle, est juste (elle filtre les pièces troquées et les articles vendus/inactifs à la lecture).

Le bloc n'est cliquable que si la zone existe réellement ; sinon il s'affiche en « teaser » non interactif (jamais de bouton mort). En pratique le serveur recrée la zone à la volée si elle manque, donc l'état teaser n'apparaît que si l'appel échoue.

#### Écran SwapZone (`/swap-zone`)

L'écran se compose de :

1. **« Mes pièces »** — une section en haut où le membre voit les articles qu'il a lui-même déposés dans la zone, avec un bouton **« Déposer un article »**. Cette entrée de dépôt est **toujours visible**, même déconnecté : un appui déconnecté déclenche l'invite d'inscription (« Inscrivez-vous pour participer à la Swap Zone »). Quand le membre n'a encore rien déposé, la section devient une zone d'accueil « Échangez vos pièces, sans frais. »
2. **Une barre de filtres** identique à celle de la recherche : Trier, Catégorie, Taille, Couleur, Marque, Matière, État. Le filtrage et le tri (récent, prix croissant, prix décroissant) sont appliqués **côté client**.
3. **La grille des articles disponibles** des autres membres (en 2 colonnes), avec un compteur « Articles disponibles · N ».

**Dépôt d'un article dans la zone.** Le membre choisit, dans une feuille à sélection multiple, parmi ses propres articles actifs et non vendus (les articles déjà déposés sont retirés de la liste). Règles de gestion vérifiées côté serveur (`functions/src/callable/swaps.ts`) :
- l'article doit **lui appartenir** (le vendeur réel de l'article fait foi, pas l'information envoyée par l'app) ;
- l'article doit être **actif et non vendu** ;
- un même article **ne peut pas être déposé deux fois** dans la zone (garde anti-doublon).

Le compteur d'articles de la zone est mis à jour de façon atomique à l'ajout et au retrait. Le retrait d'un article est instantané à l'écran (suppression optimiste, avec retour arrière en cas d'échec).

**Démarrer un échange depuis la zone.** Deux gestes :
- **Appui simple** sur l'article d'un autre membre → ouvre l'écran de proposition d'échange, **pré-rempli** avec cet article du côté « leur article » et ciblé sur ce vendeur.
- **Appui long** → active un **mode multi-sélection verrouillé sur un seul vendeur** : on peut cocher plusieurs articles, mais uniquement ceux du même membre. Une barre en bas (« Proposer ») démarre alors une proposition portant sur tous les articles cochés.

Cette contrainte « un seul vendeur » est structurante : **un échange implique toujours exactement deux personnes**.

**Point de vigilance produit.** Un article déjà engagé dans un échange en cours reste affiché normalement dans la grille : le serveur pose bien un verrou (un article ne peut pas être engagé dans deux échanges vivants à la fois), mais l'app n'exploite pas le drapeau correspondant. Le membre ne découvre le blocage qu'au moment d'envoyer sa proposition — et, comme l'app remplace le message du serveur par un message générique, il ne sait même pas que c'est la raison du refus (voir 13.8).

---

### 13.2 Proposer un échange (`/propose-swap`)

#### Points d'entrée

Le seul point d'entrée réellement accessible aujourd'hui est **la SwapZone** (appui simple ou multi-sélection). L'écran d'un article possède bien un bouton « Proposer un échange », mais il ne s'affiche que si l'article est ouvert **dans un contexte de zone** (paramètre de zone dans le lien) — et aucun écran de l'app n'ouvre un article avec ce paramètre. Depuis une fiche article classique, on voit donc « Offre » et « Acheter / Proposer un achat », jamais le troc.

#### Composition de la proposition

L'écran de proposition montre deux blocs symétriques :

- **« Leur article »** — un ou plusieurs articles du destinataire, pré-remplis depuis la zone. Le sélecteur est **strictement limité aux articles que le destinataire a déposés dans la zone** : il n'y a plus de repli sur l'ensemble de son inventaire. Si le destinataire n'a rien déposé, ce sélecteur est vide.
- **« Mon article proposé »** — un ou plusieurs articles de l'initiateur, choisis parmi ses propres articles actifs et non vendus.

L'échange est donc **multi-articles des deux côtés** : on peut proposer 2 pièces contre 3, etc. Un message libre optionnel peut accompagner la proposition.

#### Comparaison de valeur

Dès qu'au moins un article est sélectionné de chaque côté, une **boîte de comparaison de valeur** s'affiche :

- la valeur totale de « Tes articles » et de « Ses articles » (somme des prix affichés des pièces) ;
- un indicateur de différence : soit **« Valeurs équivalentes »** (vert) si les totaux sont égaux, soit **« Différence de X $ en sa faveur / en ta faveur »** (rust) sinon.

La comparaison est purement **indicative** : rien n'oblige les valeurs à être égales pour proposer. C'est un repère pour décider d'ajouter ou non un complément. À l'enregistrement, les valeurs totales retenues sont **recalculées par le serveur à partir des prix réels des articles**, jamais à partir des montants envoyés par l'app.

#### Complément en argent (top-up)

Sous la comparaison, un module permet d'**ajouter un complément en argent** pour rééquilibrer l'échange :

- un **sélecteur de payeur** : « Je paie » (l'initiateur) ou « {Nom} paie » (le destinataire) ;
- un **montant** en dollars entiers (le champ n'accepte que des chiffres) ;
- si une différence de valeur existe, un bouton **« Suggéré : X $ »** pré-remplit le montant avec l'écart calculé.

Règles de gestion (validées côté serveur) :

| Règle | Détail |
|-------|--------|
| Montant | Entier de cents strictement positif, **plafonné à 5 000 $** (cohérent avec le plafond des offres dans la messagerie). Le champ de saisie accepte jusqu'à 4 chiffres (9 999 $) : au-delà de 5 000 $, le serveur refuse et l'app n'affiche qu'un message générique. |
| Devise | **CAD** (dollar canadien). Le montant est saisi en dollars dans l'app et converti en cents pour le backend. |
| Payeur | Doit être **soit l'initiateur, soit le destinataire** de l'échange. |
| Moment du paiement | **Rien n'est débité à la proposition.** Le complément n'est encaissé qu'après acceptation (voir 13.4). |

#### Garde-fous à l'envoi

Avant la création de la proposition, l'app et le serveur vérifient :
- qu'il y a **au moins un article de chaque côté** ;
- qu'on ne propose **pas un échange avec soi-même** ;
- qu'**aucun des deux membres n'a bloqué l'autre** (le blocage empêche la proposition) ;
- que **tous les articles existent, sont actifs, ne sont pas vendus**, et appartiennent bien au participant attendu (l'initiateur ne peut engager que ses propres articles ; les articles demandés doivent réellement appartenir au destinataire). Cette vérification d'appartenance est un invariant fort : sans elle, un membre malveillant pourrait engager les articles d'un tiers ;
- qu'**aucun des articles n'est déjà engagé dans un autre échange vivant** (un article = un échange actif à la fois). Les états `proposed`, `payment_pending`, `accepted`, `photos_pending`, `shipping` et `disputed` verrouillent les pièces ; les états terminaux les libèrent.

À l'envoi réussi, une confirmation « Proposition envoyée ! » s'affiche et le membre est redirigé vers **« Mes échanges »** (`/my-swaps`). Une notification push part vers le destinataire.

---

### 13.3 États / statuts d'un échange

Un échange (`swap`) passe par les statuts suivants :

| Statut | Signification | Déclenché par |
|--------|---------------|---------------|
| `proposed` | Proposition envoyée, en attente de réponse | Initiateur |
| `payment_pending` | Acceptée **avec** complément — en attente du paiement du complément | Destinataire (acceptation) |
| `accepted` | Acceptée (sans complément), **ou** complément payé | Destinataire / webhook Stripe |
| `declined` | Refusée | Destinataire ou initiateur, tant que `proposed` |
| `cancelled` | Annulée par l'initiateur, expirée sans réponse, ou litige tranché en faveur du payeur | Initiateur / tâche planifiée / admin |
| `photos_pending` | Mode d'échange choisi, en attente des photos des deux côtés | Participant (choix du mode) |
| `shipping` | Les deux ont uploadé leurs photos → en cours d'envoi / réception | Système (2e upload) |
| `completed` | Échange terminé (les deux ont confirmé la réception), ou litige tranché en faveur du bénéficiaire | Système (2e réception) / admin |
| `disputed` | Litige ouvert — l'échange est **gelé** | Participant |
| `expired` | Échange abandonné après acceptation (14 jours sans progression) | Tâche planifiée |

Le détail d'un échange (`/swap/[id]`) est **temps réel** : l'écran s'abonne au document et reflète immédiatement tout changement de statut (utile quand l'autre partie agit en parallèle, ou quand le webhook Stripe avance le statut après paiement).

**Toutes les transitions de statut sensibles passent par le serveur** (Cloud Functions). Les règles de sécurité Firestore n'autorisent qu'**une seule** écriture directe depuis l'app : un participant qui refuse une proposition encore au statut `proposed`. Tout le reste — paiement, photos, envoi, réception, litige, annulation — est réservé au serveur, ce qui garantit l'intégrité financière.

Chaque changement de statut déclenche une notification push : proposition reçue, paiement requis (au payeur), échange accepté, refusé, annulé, photos requises, prêt à expédier, échange terminé, litige ouvert, litige résolu, échange expiré.

---

### 13.4 Cycle de vie pas à pas

#### Étape 1 — Réponse à la proposition

Côté **destinataire**, l'écran affiche une vue détaillée : profil de l'expéditeur, message éventuel, « {Nom} propose » (leurs articles), badge de complément le cas échéant, « Contre mon article » (vos articles), et un résumé. Deux actions collantes en bas : **Accepter le swap** / **Refuser**.

- **Accepter** : seul le destinataire peut accepter, et seulement si le statut est `proposed`. Le serveur **revérifie** que tous les articles des deux côtés sont toujours disponibles et toujours détenus par les bonnes personnes (fermeture de la fenêtre où un article aurait changé de main entre la proposition et l'acceptation).
  - S'il n'y a **pas de complément** → l'échange passe directement à `accepted`.
  - S'il y a un **complément** → l'échange passe à `payment_pending` (le paiement doit être réglé avant de continuer).
- **Refuser** : passe à `declined`. Possible tant que le statut est `proposed`, par l'un OU l'autre participant.
- **Annuler** (côté initiateur) : passe à `cancelled`. Le serveur l'autorise tant que le statut est `proposed` ou `payment_pending`. **L'app n'expose toutefois le bouton « Annuler la proposition » qu'au statut `proposed`** : en `payment_pending`, l'initiateur qui n'est pas le payeur ne voit qu'un encart d'attente, sans issue. Une fois le complément payé (statut `accepted`), l'annulation n'est plus possible — il faut passer par le litige.

**Expiration automatique.** Une tâche horaire annule les propositions restées **7 jours** sans réponse (`proposed`) et les échanges acceptés dont le complément n'a jamais été payé (`payment_pending`). L'échange passe à `cancelled`, les articles sont libérés et l'initiateur reçoit « Ta proposition d'échange est restée sans suite et a été annulée. »

#### Étape 2 — Paiement du complément (si applicable)

Quand l'échange est en `payment_pending`, **seul le payeur** voit un bouton **« Régler le complément »** ; l'autre partie voit « En attente du paiement de {Nom} ».

Le paiement reprend exactement la mécanique d'un achat normal :
- frais de **protection acheteur** identiques à un achat : **5 % + 1,50 $, minimum 2,00 $** (le complément joue le rôle du « prix article », sans livraison) ;
- **0 % de commission vendeur** (le bénéficiaire reçoit l'intégralité du complément) ;
- **aucune réduction de forfait boutique ne s'applique** : la réduction achetée par une boutique porte sur les ventes d'articles de cette boutique, pas sur un rééquilibrage de troc entre particuliers ;
- paiement via la **PaymentSheet Stripe** intégrée à l'app (le membre saisit sa carte dans l'app, jamais sur un site Stripe — modèle white-label).

Mécanique financière (transparente pour l'utilisateur, mais structurante) :
- la carte est débitée par **la plateforme directement** (pas de virement automatique vers le compte du bénéficiaire) ; le bénéficiaire est crédité via le **portefeuille interne** (ledger), ce qui évite tout double paiement ;
- à la réussite du paiement, le **webhook Stripe** fait avancer automatiquement l'échange de `payment_pending` à `accepted` et crédite le **solde en attente** du bénéficiaire, avec l'écriture « Complément d'échange — fonds en attente » ;
- la plateforme conserve les frais de protection ; seul le montant du complément entre dans le portefeuille.

Garde-fous serveur :
- le paiement est **refusé** si le bénéficiaire n'a pas un compte de paiement **actif ET capable de recevoir des versements**. Sans ce garde-fou, il accumulerait des fonds qu'il ne pourrait jamais retirer. **C'est ce garde-fou qui bloque aujourd'hui tout le parcours** : l'onboarding Stripe est fermé pendant la bêta, donc personne ne remplit la condition ;
- le paiement est **idempotent** : si une demande de paiement existe déjà pour cet échange, c'est elle qui est réutilisée (jamais de double complément) ;
- si un paiement arrive **après** l'annulation ou l'expiration de l'échange, ou si le montant encaissé ne correspond pas au montant attendu, le serveur **rembourse automatiquement** le payeur et journalise l'incident pour revue.

Limite d'affichage : l'app n'affiche **aucun détail « complément + frais »** avant d'ouvrir la feuille de paiement. Le payeur ne découvre le montant total qu'à l'écran Stripe.

#### Étape 3 — Choix du mode d'échange

Une fois `accepted`, l'un des deux participants choisit **comment échanger** :
- **En main propre** (« Retrouve-toi avec l'autre pour échanger ») ;
- **Envoi postal** (« Envoie ton article par la poste »).

Le choix fait passer l'échange à `photos_pending`. Il n'y a **aucune étiquette d'expédition ni suivi colis** dans le parcours d'échange, même en mode postal : le rail livraison de l'app n'est pas branché sur le swap.

#### Étape 4 — Photos de preuve

Chaque participant doit envoyer des photos de son article avant de l'expédier (sélection multiple depuis la galerie, **4 photos maximum**, compressées puis stockées). L'écran demande « Prends 2-4 photos de l'article avant de l'envoyer », mais le **minimum de 2 n'est pas contrôlé** : une seule photo est acceptée par le serveur. Tant qu'un seul côté a envoyé ses photos, l'autre voit « En attente des photos de l'autre participant ». **Quand les deux côtés ont uploadé**, l'échange passe à `shipping`.

#### Étape 5 — Envoi puis réception

En `shipping`, chaque participant :
1. confirme **« J'ai envoyé mon article »** ;
2. puis confirme **« J'ai reçu l'article »** (l'app n'affiche ce second bouton qu'après le premier).

**Quand les deux ont confirmé la réception**, l'échange passe à `completed`. À ce moment, le serveur :
- marque **tous les articles** des deux côtés comme **vendus + inactifs** (ils sortent du catalogue) ;
- marque les pièces correspondantes de la zone comme « troquées » et incrémente le compteur d'échanges réalisés de la zone ;
- **place le complément éventuel en séquestre** : les fonds du bénéficiaire passent de « en attente » à « bloqués », avec une échéance de libération à **7 jours** et l'écriture « Complément d'échange — fonds en attente (fenêtre de litige 7 jours) ». Ils ne deviennent **pas** immédiatement retirables.

**Libération des fonds.** Une tâche planifiée libère le complément vers le solde disponible du bénéficiaire une fois les 7 jours écoulés, avec l'écriture « Complément d'échange — fenêtre de litige écoulée, fonds disponibles ». Cette fenêtre est ce qui rend le recours après réception possible.

**Abandon après acceptation.** Si un échange reste bloqué en `accepted`, `photos_pending` ou `shipping` **14 jours** sans progression, une tâche horaire le passe à `expired` : tout complément payé est remboursé au payeur, les articles sont libérés, et les deux parties reçoivent « Un échange est resté sans progression et a été annulé. Tout complément payé a été remboursé. »

#### Étape 6 — Évaluation

Une fois `completed`, chaque participant peut **noter l'échange de 1 à 5 étoiles**. La note crée un **avis** sur l'autre membre (type « swap »), recalcule sa note moyenne, et lui envoie une notification « Nouvel avis reçu ». Chaque membre ne peut laisser qu'un seul avis par échange.

Le serveur accepte un commentaire libre avec la note, mais **l'écran ne propose pas de champ de commentaire** : tous les avis de swap partent aujourd'hui sans texte.

#### Litige

Un **litige** peut être ouvert par l'un des participants aux statuts `accepted`, `photos_pending`, `shipping` et `completed`. Pour un échange terminé, il n'est recevable que **dans la fenêtre de 7 jours** suivant la réception, c'est-à-dire tant que le complément n'a pas été libéré ; au-delà, l'app renvoie vers le support. Ouvrir le litige depuis `accepted` / `photos_pending` est la porte de sortie du payeur dont la contrepartie ne répond plus.

L'utilisateur choisit un motif prédéfini :
- « Je n'ai pas reçu l'article »,
- « L'article ne correspond pas à la proposition »,
- « L'article est endommagé »,
- « Autre problème ».

L'échange passe à `disputed` et **gèle** : les articles restent engagés, le complément reste bloqué là où il se trouve, et la libération automatique des fonds ne peut plus se déclencher. **Aucun remboursement automatique n'a lieu** — c'est un changement important par rapport à l'ancien fonctionnement, qui remboursait le payeur dès l'ouverture du litige (un payeur pouvait alors confirmer la réception, ouvrir un litige, récupérer 100 % du complément **et** garder l'article reçu). Le message affiché est désormais : « L'échange est gelé. Notre équipe va l'examiner et tranchera (remboursement du complément ou libération au bénéficiaire). »

**La seule sortie de `disputed` est une décision d'administrateur**, prise dans le panel admin (onglet « Swaps »), avec deux issues :

| Issue | Effet argent | Effet articles | Statut final |
|-------|--------------|----------------|--------------|
| Rembourser le payeur | Remboursement Stripe du complément payé, reprise du montant sur le portefeuille du bénéficiaire | Articles libérés des deux côtés, **jamais marqués vendus** | `cancelled` |
| Maintenir l'échange | Le complément passe au solde disponible du bénéficiaire | Articles marqués vendus + troqués, compteur d'échanges de la zone incrémenté | `completed` |

Les deux parties sont notifiées de la décision.

**Surveillance.** Un litige d'échange ne crée pas de fiche dans la liste des litiges d'achat : l'administrateur doit saisir manuellement l'identifiant de l'échange (issu du ticket support ou des journaux). Pour éviter qu'un litige soit oublié — articles et argent gelés indéfiniment — une tâche toutes les 6 heures lève une **alerte admin** pour tout litige d'échange ouvert depuis plus de **5 jours**.

---

### 13.5 « Mes échanges » (`/my-swaps`)

Le membre retrouve tous ses échanges (initiés ou reçus) dans un écran à **onglets de filtre** :

| Onglet | Contenu | Pastille |
|--------|---------|----------|
| Tous | Tous les échanges | — |
| En attente | `proposed` | Compteur des propositions en attente |
| En cours | `payment_pending`, `accepted`, `photos_pending`, `shipping`, `disputed` | Compteur des échanges actifs |
| Historique | `completed`, `declined`, `cancelled`, `expired` | — |

Chaque carte montre l'autre membre, un **résumé visuel** des pièces de chaque côté (images empilées + badge « +N » au-delà de 3 pièces pour le multi-articles), les valeurs (« X $ CA ↔ Y $ CA », le complément étant ajouté au total du côté qui le paie), la date relative (« Aujourd'hui », « Hier », « Il y a N jours », puis la date), et une **pastille de statut** colorée. L'état vide invite à « Découvrir la Swap Zone ».

Depuis le détail d'un échange, un bouton **« Contacter »** ouvre (ou crée) la conversation avec l'autre participant — sauf sur un échange refusé ou annulé.

---

### 13.6 Données clés (langage métier)

- **Zone** (`swapParties/generalist`) : nom, indicateur « généraliste », compteur d'articles, compteur d'échanges réalisés. Le compteur d'échanges n'est affiché nulle part dans l'app.
- **Article déposé** (`swapPartyItems`) : référence à l'article, son vendeur, titre, prix/valeur estimée, image, marque/taille/couleur/etc. (pour le filtrage), et deux drapeaux gérés uniquement par le serveur : « en attente » (engagé dans une proposition en cours) et « troqué » (échange complété).
- **Échange** (`swaps`) : les deux participants (nom, photo), les listes d'articles de chaque côté + valeurs totales recalculées serveur, la liste à plat des articles engagés (qui sert au verrou « un article = un échange »), le complément éventuel (montant en cents + payeur), le statut, le message, le mode d'échange, les preuves photo, les horodatages d'envoi / réception de chaque côté, les évaluations, le motif et l'issue de litige, et le suivi du complément Stripe (paiement, frais, mise en séquestre, libération, remboursement).
- **Avis** (`avis`) : créé à l'évaluation d'un échange terminé (type « swap »), avec un identifiant déterministe qui garantit l'unicité par membre et par échange.

---

### 13.7 Spécificités Canada & contraintes plateforme

- **Devise** : tous les montants (compléments, valeurs) sont en **dollars canadiens (CAD)**. Le paiement du complément est explicitement en `cad`.
- **Frais** : aligné sur le reste de l'app — **5 % + 1,50 $, minimum 2,00 $** côté acheteur (ici, côté payeur du complément), **0 % de commission** côté bénéficiaire. La SwapZone est mise en avant comme « sans frais » : c'est vrai pour le troc pur ; des frais ne s'appliquent **que** sur l'argent ajouté en complément.
- **Taxes** : la TPS/TVQ sur les frais de service est derrière un drapeau désactivé par défaut ; aucune taxe n'est perçue aujourd'hui sur un complément.
- **Loi 25 (Québec)** : l'échange manipule des données personnelles (nom, photo de profil, photos d'articles). Deux points à traiter avant une montée en charge :
  - la fiche de suivi d'un échange (tous statuts sauf « proposition reçue ») affiche une ligne de localisation **codée en dur** — « Villeray · 2.8 km » — sous le nom de l'autre membre : c'est une **valeur de maquette**, non branchée sur des données réelles, à retirer ou à brancher avant production (`features/swap/components/detail/SwapStatusView.tsx`) ;
  - les **photos de preuve** sont stockées sous `swaps/{id}/photos/` et, faute de pouvoir vérifier la participation à un échange dans les règles de stockage, elles sont **lisibles par n'importe quel membre connecté** qui en connaît l'URL (même posture que les images de messagerie). Ce sont des photos d'articles, pas d'identité, mais c'est une exposition à assumer ou à corriger.
- **Photos** : la sélection multiple de photos et la PaymentSheet Stripe fonctionnent de la même façon sur **iOS et Android**. Aucune divergence produit majeure entre les deux plateformes sur le parcours d'échange.
- **Voile tactile Android** : la SwapZone utilise des bottom sheets (filtres, dépôt d'articles). Pour éviter un bug Android connu (overlay invisible bloquant le scroll/les clics), ces feuilles sont **montées uniquement à l'ouverture** et démontées à la fermeture. C'est une contrainte technique sans impact visible pour l'utilisateur si elle est respectée.

---

### 13.8 Limites connues / points de vigilance

**Bloquants produit**

- **Le complément en argent est inutilisable en l'état.** Le paiement exige un compte de paiement bénéficiaire actif avec versements autorisés, alors que l'onboarding Stripe et le portefeuille sont fermés par le drapeau `PAYMENTS_ENABLED = false`. Résultat concret : un échange avec complément se bloque en `payment_pending`, le payeur voit « Impossible d'initier le paiement du complément », et l'échange est annulé automatiquement au bout de 7 jours. Tout le reste de la mécanique (séquestre, remboursement, litige) existe et est testé, mais n'est pas atteignable.
- **Le troc depuis une fiche article est inatteignable.** Le bouton « Proposer un échange » de la page article ne s'affiche qu'en contexte de zone, et aucun écran ne fournit ce contexte. Le seul chemin vers un échange est la SwapZone.
- **Un membre ne peut proposer un échange que sur les pièces réellement déposées dans la zone** : si le destinataire n'y a rien déposé, la proposition est impossible (sélecteur vide). C'est un choix cohérent, mais il concentre toute la liquidité du troc sur le dépôt en zone.

**Défauts d'affichage**

- **Montant du complément en cents.** Sur la fiche de suivi d'un échange (tous les statuts sauf « proposition reçue »), le résumé affiche le complément **en cents bruts** : un complément de 10,00 $ apparaît « 1000 $ ». La vue « proposition reçue » a été corrigée et affiche le bon montant. Le calcul financier réel est correct dans les deux cas ; c'est un défaut d'affichage.
- **Le payeur du complément n'est pas identifié dans le badge.** Le bandeau « {Nom} ajoute un complément de X $ » nomme toujours l'autre participant, quel que soit le payeur réel. Si c'est vous qui payez, le badge affirme le contraire.
- **Étiquettes inversées côté initiateur.** Quand l'initiateur consulte sa propre proposition en attente, ses articles sont affichés sous « {Nom du destinataire} propose » et les articles du destinataire sous « Contre mon article ». La vue a été conçue pour le destinataire et réutilisée telle quelle pour l'initiateur.
- **Localisation codée en dur** sur la fiche de suivi (voir 13.7).

**Trous de parcours**

- **Messages d'erreur génériques.** Toutes les erreurs métier du serveur (« l'article est déjà engagé dans un autre échange », « le complément dépasse le plafond », « l'article n'est plus actif ») sont remplacées à l'écran par « Impossible d'envoyer la proposition ». Le membre ne sait pas quoi corriger.
- **Pas de signal visuel sur un article déjà engagé** : la grille de la zone ne distingue pas une pièce libre d'une pièce bloquée dans un échange en cours.
- **Annulation impossible en attente de paiement côté app** : le serveur l'autorise, l'écran ne l'expose pas.
- **Minimum de 2 photos non contrôlé** : l'écran l'annonce, le serveur ne l'impose pas.
- **Pas de commentaire d'avis** dans l'écran de notation d'un échange, alors que le serveur l'accepte.
- **Pas d'étiquette ni de suivi colis** en mode « envoi postal » : les deux parties s'auto-déclarent l'envoi et la réception. Le mode « en main propre » suit exactement le même déroulé (photos + confirmations) ; le mode change l'intention, pas le parcours.

**Dette et exploitation**

- **Compteur d'articles de la zone qui dérive** : jamais décrémenté quand une pièce est troquée ou vendue ailleurs, il surestime le stock affiché sur l'accueil (la grille, elle, reste juste). Un nettoyage serveur est la correction durable.
- **Compteur « nouveautés cette semaine » plafonné à 6** par construction.
- **Chargement du stock non paginé** : l'écran de zone charge la totalité des pièces disponibles et lit ensuite chaque article un par un pour les filtres. Le coût et le temps de chargement croissent linéairement avec le stock — à revoir avant que la zone ne dépasse quelques centaines de pièces.
- **Litige sans file de traitement dédiée** : un litige d'échange n'apparaît pas dans la liste des litiges du panel admin ; il faut saisir l'identifiant à la main. Le filet de sécurité est l'alerte automatique après 5 jours.
- **Classement des meilleurs troqueurs** : la fonction serveur existe et est bornée, mais aucun écran ne l'appelle — fonctionnalité morte à activer ou à retirer.
