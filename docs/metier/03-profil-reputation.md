## 03. Profil utilisateur & réputation

Cette section décrit tout ce qui touche à l'identité de l'utilisateur sur Second : son profil public (vu par les autres), son profil privé (sa vue personnelle), la réputation construite par les avis et la note moyenne, le système d'abonnement entre utilisateurs (« follow »), et l'ensemble des paramètres du compte (email, téléphone, mot de passe, adresse, préférences, notifications, confidentialité, export et suppression de données).

Second est une marketplace de mode seconde main pensée pour le Canada (devise CAD, numéros et adresses canadiens, conformité Loi 25 / LPRPDE / LCAP). Tous les contenus sont en français. L'application existe en versions iOS et Android, avec quelques différences de comportement signalées plus bas.

Point de vocabulaire important : **tout utilisateur est potentiellement vendeur ET acheteur**. Il n'y a pas de statut « vendeur » distinct ; un même compte vend ses articles et en achète. La réputation se construit donc dans les deux rôles.

> **Contexte bêta (à lire avant tout le reste).** Deux interrupteurs produit (`config/featureFlags.ts`) sont aujourd'hui sur OFF : `PAYMENTS_ENABLED` (paiements Stripe / porte-monnaie) et `SHIPPING_ENABLED` (livraison). Plusieurs entrées décrites historiquement dans ce document — Porte-monnaie, Compte de paiement, Options de livraison — sont donc **absentes de l'interface actuelle**. Elles sont signalées au fil du texte.

---

### 3.1. Les deux faces du profil : public vs privé

L'application distingue clairement deux écrans :

| | Profil privé (le mien) | Profil public (celui d'un autre) |
|---|---|---|
| Écran | onglet « Profil » de la barre de navigation, intitulé « Mon profil » | écran « profil utilisateur » (`app/user/[id].tsx`) |
| Accès | onglet permanent | en touchant le nom/avatar d'un vendeur (fiche article, conversation, résultats de recherche, vendeurs suivis, auteur d'un avis, etc.) |
| Bouton principal | « MODIFIER » (édite mes infos) | « CONTACTER » + « S'ABONNER » |
| Contenu visible | carte d'identité + raccourcis vers commandes, ventes, échanges, articles, favoris, vendeurs aimés, recherches sauvegardées, paramètres, aide | infos publiques, articles, avis reçus |
| Actions sur l'autre | — | Contacter, S'abonner, Partager, Signaler, **Bloquer** |

Détail utile à connaître : quand on ouvre le profil public de **quelqu'un d'autre**, l'application charge tout en un seul appel serveur sécurisé (le profil, les statistiques, les articles et les avis), ce qui permet même à un visiteur **non connecté** de consulter un profil. Quand on ouvre **son propre** profil via cet écran, les données sont lues directement (utilisateur authentifié). Autrement dit, un profil public reste consultable sans compte, mais les actions (contacter, suivre, signaler, bloquer) exigent une connexion.

**Conséquence importante, souvent ignorée :** l'appel serveur du profil public ne renvoie **qu'un sous-ensemble** des informations du compte. Deux blocs visibles sur mon propre profil ne le sont donc **jamais** sur celui d'un autre : la **ville** et les **tags de style**. Voir 3.2.

---

### 3.2. Le profil public d'un vendeur

#### Ce qui est affiché (en-tête)

- **Avatar** (photo de profil ou, à défaut, initiale sur fond).
- **Nom d'affichage**, affiché avec le **nom de famille réduit à son initiale** : « Jean Dupont » s'affiche « Jean D. ». Un prénom seul reste entier. C'est une mesure de discrétion appliquée partout dans l'app (`utils/formatName.ts`).
- **@pseudo** : identifiant unique, permanent et **immuable**. Il est **choisi par l'utilisateur à l'inscription** (écran « compléter mon profil »), avec vérification de disponibilité en direct : 3 à 20 caractères, uniquement minuscules, chiffres et les séparateurs `.` `_` `-` (jamais en début, en fin, ni doublés). La réservation est faite côté serveur, de façon atomique, dans un registre dédié. Un mécanisme de repli existe pour les comptes qui n'ont pas de pseudo choisi : dérivation automatique à partir du nom, avec suffixe numérique en cas de collision. Modifier son nom d'affichage **ne change jamais** le @pseudo. Tant qu'aucun pseudo n'est encore attribué (état transitoire très bref), l'écran affiche un pseudo dérivé du nom pour ne jamais montrer un « @ » vide.
- **« Membre depuis [mois année] »** (date d'inscription, formatée en français canadien `fr-CA`).
- **Ville** — **uniquement sur mon propre profil**. L'adresse ne fait pas partie des données renvoyées par le profil public : sur le profil d'un autre vendeur, aucune ville n'est affichée. (Effet de bord positif côté vie privée, mais ce n'est pas une décision explicite : c'est une conséquence du périmètre de l'appel serveur.)
- **Bio** (texte libre, optionnel).
- **Tags de style** (jusqu'à 5 affichés) : étiquettes comme « Streetwear », « Vintage », « Casual », issues du **profil de style généré par IA**, lui-même conditionné au consentement explicite de l'utilisateur (voir 3.10). **Là aussi : visibles uniquement sur mon propre profil**, jamais sur celui d'un autre.
- Le **type de compte** (« utilisateur » ou « boutique ») est chargé mais **n'est affiché nulle part** sur cet écran. Les boutiques disposent d'un écran séparé (`app/shop/[id].tsx`), non relié depuis le profil utilisateur.

#### La rangée de statistiques

Quatre indicateurs, présentés à l'identique sur le profil public et le profil privé :

| Statistique | Signification métier | Source réelle |
|---|---|---|
| **Articles** | articles actuellement en vente (actifs et non vendus) | recomptés à chaud sur l'ensemble des articles du vendeur |
| **Ventes** | articles marqués vendus | recomptés à chaud |
| **Note** | note moyenne sur 5 (ex. « 4,8 »), ou « — » si aucun avis | **profil d'autrui** : note pré-calculée stockée sur le compte · **mon profil** : recalculée à la volée depuis les avis |
| **Abonnés** | nombre de personnes qui suivent ce vendeur | compteur stocké sur le compte |

> **Écart connu.** La note affichée sur mon propre profil est recalculée côté application à partir des avis, alors que celle vue par les autres est la valeur figée sur le compte (mise à jour par le serveur après chaque avis). Les deux convergent normalement, mais peuvent diverger si une mise à jour serveur a échoué — elle est explicitement traitée comme « non critique » et n'interrompt pas la création de l'avis.

#### Les deux onglets

1. **Articles** : grille 3 colonnes.
   - Sur le **profil d'un autre** : les 30 articles **actifs** les plus récents. Un article vendu reste « actif » dans les données ; il apparaît donc dans la grille avec un badge **« VENDU »** au lieu du prix. Il n'y a **pas de pagination** au-delà de 30.
   - Sur **mon propre** profil (ouvert via cet écran) : uniquement mes articles **en vente** (actifs et non vendus).
   - État vide : « Aucun article en vente ».
2. **Avis** (avec compteur, ex. « Avis (12) ») : voir 3.4. Le compteur vient du nombre d'avis stocké sur le compte.

#### Actions disponibles sur le profil d'autrui

- **CONTACTER** : crée (ou rouvre) une conversation avec le vendeur et redirige vers le chat. Exige d'être connecté (sinon, invite à se connecter).
- **S'ABONNER / ABONNÉ** : voir 3.3. Exige d'être connecté.
- **Partager** (icône dans l'en-tête, et dans le menu « … ») : ouvre la feuille de partage native du téléphone, avec un message du type « Découvre le profil de [nom] sur Seconde ! » et un lien `https://seconde.ca/user/[id]`.
- Menu « … » : **Partager le profil**, **Signaler** (feuille de signalement, cible « utilisateur »), **Bloquer**.
- **Bloquer** : confirmation « Voulez-vous bloquer [nom] ? Cette personne ne pourra plus vous contacter ni voir vos articles. » Le blocage est réellement appliqué côté serveur (règles Firestore + filtrage des messages), pas seulement affiché. Après blocage, l'app revient à l'écran précédent. Le déblocage se fait depuis Paramètres → Confidentialité → Utilisateurs bloqués (voir 3.10).

Note produit : on **ne peut pas s'abonner à soi-même ni se contacter soi-même** — sur son propre profil consulté depuis cet écran, seul « MODIFIER » s'affiche (ni Contacter, ni Abonner, ni Partager, ni « … »).

#### Cas « profil introuvable »

Si l'identifiant ne correspond à aucun compte (ou compte supprimé), l'écran affiche « Utilisateur introuvable » avec le message « Ce profil n'existe pas ou a été supprimé ». C'est notamment ce qui apparaît lorsqu'un compte a été supprimé (voir 3.10).

---

### 3.3. Vendeurs suivis (système d'abonnement / « follow »)

Second propose un mécanisme d'abonnement entre utilisateurs, présenté comme « S'abonner » à un vendeur.

**Règles de gestion :**
- Action déclenchée par le bouton « S'ABONNER » sur un profil public. Une fois abonné, le bouton bascule en « ABONNÉ » (état vert avec coche).
- L'action est **réversible** : re-toucher le bouton désabonne.
- L'abonnement met à jour deux choses : la liste des vendeurs suivis par l'abonné, et le compteur **« Abonnés »** affiché sur le profil du vendeur suivi (les deux via une fonction serveur dédiée).
- L'interface réagit **instantanément** (mise à jour optimiste) : le bouton change d'état immédiatement, puis se synchronise avec le serveur ; en cas d'échec, l'état revient en arrière. L'état « abonné ? » est délibérément déduit de **ma** liste locale de vendeurs suivis, et non de la valeur renvoyée par le serveur, pour éviter qu'un affichage périmé contredise le geste de l'utilisateur.
- L'abonnement exige une connexion (un visiteur non connecté est invité à se connecter).
- La liste est consultable depuis le profil privé. **Attention à un flottement de vocabulaire** : l'entrée de menu s'appelle « Vendeurs aimés » alors que l'écran d'arrivée s'intitule « Vendeurs suivis » (état vide : « Aucun vendeur suivi »).

À noter : le compteur d'abonnés sert d'indicateur de popularité / réputation sociale, distinct de la note moyenne (qui mesure la satisfaction transactionnelle).

---

### 3.4. Réputation : avis et note moyenne

La réputation repose sur des **avis notés de 1 à 5 étoiles**, laissés après une transaction réellement terminée. Les avis ne sont **jamais** écrits directement par l'application : seule une fonction serveur peut en créer, et personne ne peut les modifier ni les supprimer.

#### Affichage des avis (onglet « Avis »)

- **Résumé de note** en haut : grande note moyenne (ex. « 4,8 »), rangée de 5 étoiles (remplies selon la moyenne arrondie), et nombre d'avis (« 12 évaluations » / « 1 évaluation »).
- **Liste des avis** : pour chaque avis, l'avatar et le nom de l'auteur, ses étoiles, la date (format « 3 juin 2026 ») et le texte.
- **Volume affiché** : 10 avis maximum sur le profil d'un autre, 20 sur le mien. Pas de « voir plus » dans l'écran de profil.
- **Toucher l'auteur d'un avis** ouvre son profil — **mais seulement sur mon propre profil**. Sur le profil d'un autre vendeur, l'appel serveur ne renvoie pas l'identifiant de l'auteur : l'avatar n'est alors pas cliquable. C'est un trou fonctionnel, pas une décision produit.
- État vide :
  - sur le profil d'autrui : « Aucun avis pour le moment » ;
  - sur son propre profil : « Les avis de vos acheteurs apparaîtront ici. »

#### Comment un avis est créé (règles de gestion)

Un avis ne se laisse **pas** depuis le profil ; il se laisse depuis l'écran « Laisser un avis », accessible uniquement depuis **« Mes commandes »** ou **« Mes ventes »**. Conditions vérifiées **côté serveur** au moment de la soumission (`functions/src/callable/reviews.ts`) :

- L'auteur doit être **connecté**.
- La **transaction doit exister et être dans un état terminal** : livrée (`delivered`), finalisée après la fenêtre de litige (`completed`), ou **remise en main propre effectuée** (`meetup_completed`). Sinon l'avis est refusé.
- L'auteur doit être **réellement partie à la transaction** (acheteur ou vendeur), et la cible doit être l'**autre** partie.
- On **ne peut pas s'auto-évaluer**.
- **Une seule évaluation par transaction** : un identifiant déterministe empêche les doublons (deux soumissions simultanées : une seule réussit, l'autre reçoit « Vous avez déjà laissé un avis pour cette transaction »).
- **Fenêtre de 60 jours** après la fin de la transaction. **Réserve importante** : cette fenêtre n'est appliquée que si la transaction porte une date de fin exploitable (date de finalisation, de livraison ou de rencontre). Si aucune de ces dates n'est renseignée, **aucune limite de temps ne s'applique**.
- **Note obligatoire entre 1 et 5.**
- **Texte obligatoire** : minimum 5 caractères, maximum 2000.
- **Filtre d'insultes** (liste de termes français) : un avis contenant un de ces termes est refusé avec invitation à reformuler. C'est un filtre par mots-clés simple, sans modération humaine ni analyse de contexte.
- **Le compte noté doit exister** : évaluer quelqu'un qui a supprimé son compte est refusé (« Cette personne a supprimé son compte : aucun avis ne peut lui être laissé. »). L'avis était auparavant créé quand même, orphelin sur un profil disparu — invisible partout, et le recalcul de la note moyenne échouait en silence sur un compte qui n'existait plus.

Chaque avis est typé selon le contexte : **achat**, **vente** ou **swap** (échange).

> **Deux régimes différents pour la même note.** Un avis d'échange n'est pas créé par le même chemin : il passe par la notation de swap, déclenchée depuis un échange au statut « terminé ». Ce chemin **n'applique ni le minimum de 5 caractères, ni le filtre d'insultes, ni la fenêtre de 60 jours**, et le commentaire y est **facultatif** — un avis de swap peut donc exister avec une note seule et un texte vide. Il alimente pourtant la **même** note moyenne et apparaît dans la même liste. À aligner si la cohérence de la réputation devient un enjeu.

#### Calcul et propagation de la note

- À chaque nouvel avis (achat/vente **ou** swap), la **note moyenne** et le **nombre d'avis** de la personne évaluée sont recalculés sur l'ensemble de ses avis et stockés sur son compte (arrondis à une décimale).
- Cette note pré-calculée est ce qui s'affiche partout où le vendeur apparaît pour les autres.
- La personne évaluée reçoit une **notification** « Nouvel avis reçu — [nom] vous a laissé un avis 4/5 ». Cette notification n'a **pas d'interrupteur dédié** : elle est considérée comme transactionnelle et n'est jamais filtrée par les préférences de catégorie. Seul l'interrupteur global « Notifications push » la prive de la notification téléphone — la notification reste alors visible dans l'app.

---

### 3.5. Le profil privé (« Mon profil ») et ses raccourcis

L'onglet « Profil » (en-tête « Mon profil ») montre la même carte d'identité (avatar, nom, @pseudo, ancienneté, ville, bio, tags de style, statistiques) que le profil public, mais sert surtout de **plaque tournante** vers les espaces personnels.

**Si l'utilisateur n'est pas connecté**, l'onglet affiche un état invité : « Pas encore connecté », « Connectez-vous pour accéder à toutes les fonctionnalités », et un bouton « SE CONNECTER ». Chaque entrée de menu, si touchée sans connexion, déclenche l'invite de connexion.

**Menu de raccourcis (section « MON COMPTE », utilisateur connecté) :**

| Entrée | Destination / utilité |
|---|---|
| Mes commandes | suivi des achats |
| Mes ventes | suivi des ventes |
| Mes échanges | suivi des swaps |
| **Porte-monnaie** | **masqué aujourd'hui** (`PAYMENTS_ENABLED = false`). Quand il est activé, le sous-titre affiche le solde formaté en CAD (ex. « 12,50 $ ») ou « Non activé » |
| Mes articles | gestion de mes annonces |
| Mes favoris | articles mis en favori |
| Vendeurs aimés | liste des vendeurs suivis (écran « Vendeurs suivis ») |
| Recherches sauvegardées | alertes / recherches enregistrées |
| Paramètres | écran réglages complet (voir 3.6) |
| Aide | centre d'aide |

Les statistiques sont rafraîchies **à chaque retour sur l'onglet** (le compteur de ventes bouge après une rencontre confirmée ou une offre acceptée ailleurs dans l'app).

En bas : bouton « SE DÉCONNECTER » (avec confirmation « Êtes-vous sûr de vouloir vous déconnecter ? ») et le **numéro de version** de l'application.

#### Édition du profil (« Détails du profil »)

Accessible via « MODIFIER » (profil) ou Paramètres → « Détails du profil ». Enregistrement par le bouton « Enregistrer » en haut à droite. L'utilisateur peut modifier :

- **Photo de profil** : choisie dans la photothèque (demande de permission d'accès aux photos ; un refus est journalisé), recadrée en carré (1:1), **métadonnées EXIF retirées** à la prise, puis **redimensionnée (800 px max) et compressée** avant l'envoi. Le fichier écrase toujours la même destination (une photo par compte).
- **Nom d'affichage** : obligatoire (ne peut être vide), **50 caractères max**, et **seulement lettres, espaces, traits d'union et apostrophes** (les chiffres, emojis et symboles sont refusés : « Le nom ne peut contenir que des lettres, espaces, tirets et apostrophes »). Modifier le nom d'affichage **ne change pas** le @pseudo.
- **Bio** : texte libre, **200 caractères max**, avec compteur en direct.

Un encart conseille : « Un profil complet avec une photo et une bio attire plus d'acheteurs potentiels. » L'enregistrement met aussi à jour le nom au niveau de l'authentification et rafraîchit les statistiques.

> **Incohérence de discours à corriger.** Cet écran affiche « Votre photo de profil est visible publiquement sur votre profil. », alors que Paramètres → Confidentialité présente « Afficher ma photo de profil » comme **désactivé par défaut**. Les deux messages ne peuvent pas être vrais en même temps ; voir l'encadré de 3.10 sur le comportement réel.

---

### 3.6. Paramètres du compte : vue d'ensemble

L'écran « Paramètres » regroupe tout, par sections :

- **Compte** : Détails du profil · Email · (Vérifier mon email, si applicable) · Numéro de téléphone · Mot de passe **ou** Ajouter un mot de passe.
- **Envoi & Livraison** : Mon adresse · (Options de livraison — **masqué aujourd'hui**, `SHIPPING_ENABLED = false`).
- **Personnalisation** : Mes préférences (tailles, marques).
- **Paiements** (Compte de paiement Stripe Connect · Mon porte-monnaie) : **section entièrement masquée aujourd'hui** (`PAYMENTS_ENABLED = false`).
- **Notifications & Confidentialité** : Notifications · Confidentialité.
- **Assistance** : Centre d'aide · À propos.
- **Administration** : visible **uniquement** pour les comptes administrateurs (gestion des boutiques et utilisateurs).
- **Zone de danger** : Supprimer mon compte.
- En pied d'écran : numéro de version.

Les entrées du menu **s'adaptent au mode de connexion**, recalculé à chaque affichage de l'écran (pour refléter l'état après un ajout de mot de passe ou une vérification d'email) :
- « Vérifier mon email » n'apparaît que si le compte a un mot de passe **et** que l'email n'est pas encore vérifié.
- « Mot de passe » apparaît si le compte a déjà un mot de passe ; sinon c'est « Ajouter un mot de passe » (cas des comptes créés via Google/Apple).

Le statut administrateur est lu en priorité dans le jeton d'authentification (non modifiable par l'utilisateur), avec repli sur un champ du compte lui-même protégé en écriture.

---

### 3.7. Identité et sécurité du compte (email, téléphone, mot de passe)

#### Email

Changer son email envoie un **lien de vérification à la nouvelle adresse** ; le changement n'est effectif qu'**après avoir cliqué sur ce lien** (rien n'est écrit tant que la vérification n'est pas faite). L'écran exige de saisir et **confirmer** la nouvelle adresse, et impose une **ré-authentification** adaptée au mode de connexion :

| Mode de connexion | Vérification d'identité demandée |
|---|---|
| Email + mot de passe | saisir le mot de passe actuel |
| Google | bouton « Se reconnecter avec Google » |
| Apple (sur iOS) | bouton « Se reconnecter avec Apple » |
| **Apple sur Android** | la ré-authentification Apple **n'est pas disponible** : il faut d'abord **ajouter un mot de passe** au compte, puis l'utiliser pour valider |
| Mode indéterminé | invitation à se déconnecter / reconnecter |

> **Spécificité iOS / Android (important).** La connexion « Sign in with Apple » est une technologie Apple : sa **ré-authentification ne fonctionne pas sur Android**. Un utilisateur Apple qui veut, sur un appareil Android, changer son email ou supprimer son compte doit donc **d'abord se créer un mot de passe** (écran « Ajouter un mot de passe »). C'est une contrainte produit assumée, gérée explicitement dans l'app, avec un bouton de raccourci vers l'écran d'ajout de mot de passe.

#### Vérification de l'email

Écran dédié « Vérifier l'e-mail » : envoyer l'email de vérification, puis « J'ai vérifié mon email » pour rafraîchir le statut. États clairs : email vérifié (succès) ou non vérifié (avec possibilité de renvoyer le lien).

#### Numéro de téléphone — **spécificité Canada**

- Préfixe **fixé à « CA +1 »** (non modifiable).
- Saisie **format canadien à 10 chiffres**, masque automatique `(514) 555-1234`.
- Validation stricte : exactement 10 chiffres, sinon « Veuillez entrer un numéro de téléphone canadien valide (10 chiffres) ».
- Stockage normalisé avec le préfixe `+1`.
- Présenté comme une mesure qui « aide à sécuriser votre compte et facilite les transactions ». **Aucune vérification par SMS n'existe** : le numéro est déclaratif.

#### Mot de passe

- **Modifier** (comptes avec mot de passe) : saisir le mot de passe actuel + nouveau + confirmation. Minimum **6 caractères**, les deux nouveaux champs doivent correspondre. Ré-authentification requise avant changement.
- **Ajouter** (comptes Google/Apple) : associer un email + mot de passe (min. 6 caractères) au compte social. La connexion sociale **reste active** : ensuite, les deux méthodes fonctionnent. C'est notamment le prérequis pour les utilisateurs Apple sur Android (voir ci-dessus).

---

### 3.8. Adresse et préférences

#### Adresse — **spécificité Canada**

Écran « Adresse ». Trois chemins de saisie, dans cet ordre de préférence :

1. **Autocomplétion d'adresses Google**, restreinte au **Canada** (`country:ca`) et en français, à partir de 3 caractères.
2. **Recherche de repli** si la clé Google n'est pas configurée sur le build : une liste de suggestions maison.
3. **Saisie manuelle** (« Saisir l'adresse manuellement ») : adresse, ville, province, code postal — les quatre sont obligatoires, le pays est forcé à « Canada ».

- Composantes extraites automatiquement par l'autocomplétion : numéro et rue, **ville**, **province** (code court, ex. « QC »), **code postal**, **pays**.
- Confirmation explicite avant enregistrement pour les chemins 1 et 2 (« Mettre à jour l'adresse ? » avec l'adresse complète). **La saisie manuelle enregistre sans confirmation.**
- Affichage de l'adresse actuelle si déjà renseignée, sinon : « Aucune adresse enregistrée. Ajoutez-en une pour faciliter vos ventes et achats. »
- Rappel : la ville n'est de toute façon **jamais** exposée sur le profil d'un autre utilisateur (voir 3.2) ; l'adresse sert à la livraison et aux rencontres.

#### Préférences (« Préférences »)

Sert à personnaliser les recommandations et la pertinence des résultats :

- **Système de tailles** : choix **EU** ou **US** en tête d'écran. Changer de système **réinitialise les pointures sélectionnées** (les correspondances ne sont pas converties).
- **Tailles de vêtements** (haut) : XXS, XS, S, M, L, XL, XXL, 3XL, 4XL, 5XL — multi-sélection.
- **Pointures de chaussures** : liste dépendant du système (EU : 35 à 46 avec demi-pointures ; US : 5 à 13 avec demi-pointures) — multi-sélection, stockées distinctement des tailles vêtements.
- **Marques préférées** : sélection via une feuille dédiée, avec aperçu des marques choisies (5 affichées + compteur « +N »).
- Lien direct vers les **Notifications**.
- Bouton « Enregistrer » en pied d'écran ; confirmation « Vos préférences ont été enregistrées ».

> **Fonctionnalité retirée.** La section « Localisation » (activer la géolocalisation pour « voir les articles près de chez vous », avec la ville détectée) **n'existe plus dans cet écran**. Le champ de localisation reste présent dans le modèle de données, mais aucun réglage ne l'alimente ici.

---

### 3.9. Notifications

Écran de préférences avec interrupteurs (on/off), synchronisés instantanément (mise à jour optimiste, retour arrière en cas d'échec).

| Préférence | Déclencheur | Défaut |
|---|---|---|
| Notifications push | toutes les alertes sur le téléphone | **Activé** |
| Notifications par email | actualités importantes par email | **Activé** |
| Nouveaux messages | quand on reçoit un message | **Activé** |
| Nouvelles ventes | ventes, expéditions, livraisons, annulations, remboursements, libérations de fonds | **Activé** |
| Baisses de prix | quand un favori baisse de prix | **Désactivé** |
| Articles favoris | quand quelqu'un met mon article en favori | **Désactivé** |
| Propositions d'achat | quand on reçoit une offre | **Activé** |
| Réponses aux offres | quand le vendeur répond à mon offre | **Activé** |

**Règle « privacy par défaut » (Loi 25 / LCAP) :** les notifications de nature marketing / secondaire (baisses de prix, article mis en favori) sont **désactivées par défaut** ; l'utilisateur doit les activer explicitement. Les notifications **transactionnelles essentielles** (messages, ventes, offres) restent activées par défaut.

**Comportement de l'interrupteur « Notifications push ».** L'activer déclenche une demande de permission système. Si la permission est refusée au niveau du téléphone, l'app affiche « Notifications désactivées » avec un bouton **« Ouvrir les réglages »** et **n'active pas** l'interrupteur — l'utilisateur ne peut donc pas se retrouver avec un interrupteur « on » qui ne produit rien. Le désactiver ne demande rien. Côté serveur, un push global désactivé **ne supprime pas** la notification dans l'app : seule l'alerte téléphone est supprimée.

> **Trou fonctionnel assumé à documenter : les emails.** L'interrupteur « Notifications par email » est bien enregistré, mais **aucun envoi d'email applicatif n'existe dans le produit** (aucune intégration d'envoi d'emails côté serveur). Les seuls emails réellement envoyés sont ceux de l'authentification (vérification d'adresse, réinitialisation de mot de passe), qui ne dépendent pas de cet interrupteur. Le réglage est donc, à ce jour, sans effet.

**Interaction avec le consentement marketing.** Basculer « Communications marketing » dans Confidentialité (3.10) **écrase** les interrupteurs « Baisses de prix », « Articles favoris » et le rappel SwapZone : les retirer coupe les trois, les réactiver les rallume. C'est volontaire (preuve de retrait de consentement), mais cela peut surprendre un utilisateur qui avait réglé ces interrupteurs finement.

À noter : un rappel « SwapZone » existait pour les zones d'échange limitées dans le temps ; la SwapZone étant devenue une zone permanente, ce rappel est **désactivé côté serveur** et son interrupteur est **masqué** dans l'écran (la clé de préférence est conservée pour stabilité des données).

---

### 3.10. Confidentialité, données personnelles et conformité (Loi 25 / LPRPDE / LCAP)

C'est une dimension produit forte, dictée par la réglementation canadienne (Québec).

#### Réglages de confidentialité (4 interrupteurs)

1. **Afficher ma photo de profil** — présenté comme **désactivé** tant que l'utilisateur ne l'a pas activé. Une fois activé, la photo est visible ; explicitement désactivé, le serveur la masque dans le profil public **et** cesse de la recopier sur les fiches article.
2. **Recommandations personnalisées par IA** — par défaut **désactivé** (consentement explicite requis). Activé, autorise Second à analyser les articles consultés/aimés via une IA Google (Gemini / Vertex AI), avec traitement aux États-Unis. Ce consentement est **revérifié côté serveur** avant toute génération : sans lui, la génération du **profil de style** (et donc des **tags de style**) est refusée. Activable/désactivable à tout moment, sans impact sur le reste de l'app.
3. **Données d'utilisation** (statistiques d'usage anonymisées) — **modèle opt-out : activé par défaut**. Le désactiver coupe immédiatement la collecte analytique. Aucune donnée personnelle n'est collectée par ce canal.
4. **Communications marketing** — par défaut **désactivé**. Le basculer passe par un traitement serveur dédié qui **journalise** le consentement/retrait (registre append-only horodaté, avec la version de la politique) **et** applique l'effet : mise à jour du consentement et extinction/rallumage des notifications marketing. Réactivable à tout moment (art. 14 / LCAP).

> **Écart réel à corriger — visibilité de la photo.** Le serveur ne masque la photo que si la préférence vaut **explicitement « non »**. Or **aucune valeur de confidentialité n'est écrite à la création du compte** : pour un compte qui n'a jamais ouvert cet écran, la préférence est absente, donc la photo **est bel et bien visible publiquement**, alors que l'interrupteur s'affiche « désactivé ». Autrement dit, l'affichage promet une vie privée par défaut que le comportement serveur n'applique pas tant que l'utilisateur n'a pas touché le réglage. C'est le point de conformité le plus sensible de cette section (Loi 25, art. 9.1), et il est cohérent avec le message contradictoire de l'écran « Détails du profil » (voir 3.5).

> Distinction importante : les trois premiers réglages sont enregistrés directement depuis l'app, mais le **consentement marketing** est traité à part (journalisation horodatée + effet serveur), parce que la loi exige une **preuve traçable** du consentement et de son retrait.

#### Vos droits (section dédiée)

- **Exporter mes données** (droit à la portabilité, Loi 25 / LPRPDE) : génère un fichier **JSON** horodaté, proposé au **partage / téléchargement** via le système du téléphone. L'écran annonce 5 catégories (profil, articles, favoris, notifications, messages) ; le fichier réellement produit en contient **douze** : profil, articles, favoris, notifications, conversations (avec mes seuls messages), avis que j'ai écrits, achats, ventes, brouillons, recherches sauvegardées, historique de recherche, consentements. L'export est donc **plus complet que ce que la page annonce** — l'écart est à corriger dans le sens de la promesse, pas de l'inverse.
- **Supprimer mon compte** (droit à l'effacement) : voir ci-dessous.
- **Politique de confidentialité**.
- **Utilisateurs bloqués** : liste des comptes bloqués, avec date de blocage et bouton « Débloquer » (confirmation requise). Rappels affichés : « Les utilisateurs bloqués ne peuvent plus vous contacter ni voir vos articles » et « Vous pouvez bloquer un utilisateur depuis son profil ou depuis une conversation. » Le blocage est déclenché ailleurs (profil / conversation) et seulement **géré** ici.

Encart rassurant : « Nous prenons votre vie privée au sérieux. Vos données personnelles ne sont jamais vendues à des tiers. »

#### Suppression de compte (parcours en 2 étapes)

C'est l'un des parcours les plus encadrés de l'app.

**Étape 1 — Information.** Avertissement « Cette action est irréversible », avec :
- **Ce qui sera supprimé** : profil et informations personnelles, articles en vente, favoris et recherches sauvegardées, notifications, historique de swaps.
- **Ce qui sera conservé** : les conversations sont **anonymisées** (l'autre participant les garde) — on ne peut pas effacer la part de conversation d'autrui.
- Rappel du droit à l'effacement (Loi 25 / LPRPDE).

**Étape 2 — Confirmation finale.**
- **Ré-authentification** selon le mode de connexion (mot de passe / Google / Apple ; sur **Android avec Apple**, ajout préalable d'un mot de passe — même contrainte qu'en 3.7 ; mode de connexion indéterminé : suppression impossible tant que l'utilisateur ne s'est pas reconnecté).
- L'utilisateur doit **taper exactement « SUPPRIMER »** pour activer le bouton.

**Garde-fous métier (vérifiés côté serveur, non contournables).** La suppression est refusée, avec un message précis (« Suppression impossible » + raison renvoyée par le serveur), dans les cas suivants :

| Blocage | Message métier |
|---|---|
| Dette envers la plateforme | « Vous avez une dette de X $ envers la plateforme… » |
| Porte-monnaie non vide (solde, fonds en transit ou fonds gelés en fenêtre de litige) | « Votre porte-monnaie contient X $ (dont des fonds en attente de libération)… » |
| Litige **à exposition financière** ouvert (côté acheteur ou vendeur) — retour, colis perdu, contestation de paiement. Un litige de **rencontre manquée** ne bloque plus : aucun argent n'a transité, et l'ouvrir coûtait un clic à qui voulait suspendre l'effacement d'autrui | « Un litige est en cours sur votre compte… » |
| Transaction non terminée (tout statut hors terminé / annulé / remboursé / rencontre effectuée), **sauf** une rencontre gelée en litige par un signalement d'absence | « Vous avez une transaction en cours… » |
| Retrait bancaire en cours de traitement | « Un retrait est en cours de traitement (1 à 3 jours ouvrés)… » |
| Échange non finalisé, ou complément d'échange payé mais non réglé | « Vous avez un échange en cours ou un complément non réglé… » |

Cette logique est volontairement portée par le serveur (et non par l'app) parce que les vérifications côté client étaient contournables — un point de conformité et de sécurité financière.

**Ce que fait réellement la suppression** (utile pour répondre à une demande d'un régulateur ou d'un utilisateur) :
- **Effacé** : le compte et ses sous-collections (recherches sauvegardées, historique de recherche, registre de consentements), les favoris, les notifications, les échanges, les objets déposés en SwapZone, le porte-monnaie et son grand livre, les demandes de retrait, les brouillons, les fichiers stockés (photo de profil, images d'articles), le compte d'authentification, la réservation du @pseudo (qui redevient attribuable).
- **Anonymisé, pas effacé** : les articles (désactivés, vendeur remplacé par « Utilisateur supprimé »), les conversations et les messages envoyés, les avis écrits **et** reçus (le contenu des avis reçus reste, rattaché à un identifiant anonymisé), et les **dossiers de litige** (l'identité de la personne qui part est pseudonymisée en `deleted_xxxxxxxx` dans chacun de ses rôles — acheteur, vendeur, signalant, mis en cause — celle de l'autre partie restant inchangée ; le texte libre `details` est supprimé ; le squelette d'audit — type, statut, résolution, horodatages, transaction liée — est conservé).
- **Conservé tel quel** : les **transactions**. `buyerId` et `sellerId` ne sont **pas** pseudonymisés — une transaction est une pièce comptable soumise à sept ans de rétention, et la partie survivante doit continuer de voir sa commande dans « Mes achats » / « Mes ventes », écrans dont les règles de lecture s'appuient sur ces deux champs. Seul le texte libre d'un signalement d'absence (`noShowReport.details`) est effacé. L'ancienne étape écrivait `buyerName`, `buyerEmail` et `sellerName`, trois champs que rien ne lit ni n'écrit ailleurs : elle les **créait** au lieu d'anonymiser quoi que ce soit.
- **Éteint** : les offres encore vivantes émises par la personne (en attente ou contre-proposition) passent en « expirée » (motif `sender_account_deleted`) — une offre ne réservant pas l'article, elle survivait à la fermeture du compte et le vendeur pouvait l'accepter le lendemain, verrouillant son article 48 h au profit d'un acheteur qui n'existe plus.
- **Effet de bord** : le compteur d'abonnés est décrémenté chez chaque vendeur suivi **encore existant** ; un vendeur qui a lui-même supprimé son compte est ignoré, et l'échec de ce décrément n'interrompt jamais l'effacement — auparavant il le faisait échouer en bloc, privant l'abonné de son droit à l'effacement du fait de l'action d'un tiers. Le compteur peut alors rester légèrement surévalué, et il n'est pas décoratif : c'est lui qui sélectionne et ordonne les « Vendeurs en vedette » de l'accueil. L'écart est assumé, jamais au prix du droit à l'effacement.

À la suppression réussie, l'app efface l'état local, déconnecte réellement la session et renvoie vers l'accueil. Le compte supprimé devient « introuvable » pour les autres (cf. 3.2).

---

### 3.11. Données clés du profil (langage métier)

Résumé des informations attachées à un compte, pertinentes pour cette section :

- **Identité** : nom d'affichage (éditable, affiché avec l'initiale du nom de famille), @pseudo (choisi à l'inscription, immuable), email, photo, bio, date d'inscription, date de naissance (saisie à l'inscription, stockée en texte `AAAA-MM-JJ` et écrite côté serveur).
- **Coordonnées** : téléphone (format canadien +1, déclaratif), adresse (rue, ville, province, code postal, pays — Canada).
- **Réputation** : note moyenne, nombre d'avis, nombre de ventes, nombre d'articles, nombre d'abonnés reçus, liste des vendeurs suivis.
- **Personnalisation** : système de tailles (EU/US), tailles vêtements, pointures, rayon choisi à l'onboarding, marques préférées, profil de style IA (tags) sous consentement.
- **Type de compte** : « utilisateur » ou « boutique ». **Le profil n'affiche pas ce type** ; les boutiques ont leur propre écran.
- **Consentements & confidentialité** : visibilité de la photo, consentement IA, consentement statistiques d'usage (opt-out), consentement marketing (avec registre serveur horodaté).
- **Mode de connexion & sécurité** : email/mot de passe, Google ou Apple ; statut de vérification de l'email ; statut administrateur (jeton serveur).
- **Modération** : liste des utilisateurs bloqués (avec date) et liste plate d'identifiants bloqués, celle-ci lue directement par les règles de sécurité.
- **Paiement** : rattachement au compte de paiement Stripe Connect — champs présents dans le modèle, mais **écrans masqués** pendant la bêta.

---

### 3.12. Synthèse des spécificités plateforme, locales et bêta

**Canada / conformité :**
- Devise **CAD** et dates en français canadien (`fr-CA`) partout.
- Téléphone **+1 / 10 chiffres** ; adresse **restreinte au Canada** (autocomplétion, ou saisie manuelle avec pays forcé à « Canada »).
- **Loi 25 / LPRPDE / LCAP** : consentement IA et marketing en opt-in, statistiques d'usage en opt-out, consentement marketing journalisé et retirable, export de données (portabilité), suppression de compte (effacement) avec anonymisation des conversations, messages, avis et dossiers de litige d'autrui — les **transactions**, elles, conservent leurs identifiants d'acheteur et de vendeur (pièce comptable, sept ans de rétention), seul leur texte libre étant effacé.
- **Réserve de conformité ouverte** : la visibilité de la photo de profil n'est pas réellement « privée par défaut » pour les comptes qui n'ont jamais ouvert l'écran Confidentialité (voir 3.10).

**iOS vs Android :**
- **Apple sur Android** : ré-authentification Apple indisponible → l'utilisateur doit ajouter un mot de passe avant de changer son email ou supprimer son compte.
- **Notifications push (les deux plateformes)** : l'activation in-app demande la permission système et échoue proprement si elle est refusée, avec un raccourci vers les réglages du téléphone.

**Bêta (état actuel des interrupteurs produit) :**
- `PAYMENTS_ENABLED = false` → Porte-monnaie (menu profil) et section Paiements (réglages) masqués.
- `SHIPPING_ENABLED = false` → « Options de livraison » masqué dans les réglages.
- Les garde-fous de suppression de compte liés au porte-monnaie, aux retraits et aux litiges restent actifs côté serveur, même si les écrans correspondants sont masqués.
