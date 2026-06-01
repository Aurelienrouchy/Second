## 03. Profil utilisateur & réputation

Cette section décrit tout ce qui touche à l'identité de l'utilisateur sur Second : son profil public (vu par les autres), son profil privé (sa vue personnelle), la réputation construite par les avis et la note moyenne, le système d'abonnement entre utilisateurs (« follow »), et l'ensemble des paramètres du compte (email, téléphone, mot de passe, adresse, préférences, notifications, confidentialité, export et suppression de données).

Second est une marketplace de mode seconde main pensée pour le Canada (devise CAD, numéros et adresses canadiens, conformité Loi 25 / LPRPDE / LCAP). Tous les contenus sont en français. L'application existe en versions iOS et Android, avec quelques différences de comportement signalées plus bas.

Point de vocabulaire important : **tout utilisateur est potentiellement vendeur ET acheteur**. Il n'y a pas de statut « vendeur » distinct ; un même compte vend ses articles et en achète. La réputation se construit donc dans les deux rôles.

---

### 3.1. Les deux faces du profil : public vs privé

L'application distingue clairement deux écrans :

| | Profil privé (le mien) | Profil public (celui d'un autre) |
|---|---|---|
| Écran | onglet « Mon profil » | écran « profil utilisateur » |
| Accès | onglet permanent dans la barre de navigation | en touchant le nom/avatar d'un vendeur (fiche article, conversation, résultats de recherche, liste des vendeurs suivis, etc.) |
| Bouton principal | « MODIFIER » (édite mes infos) | « CONTACTER » + « S'ABONNER » |
| Contenu visible | mes infos + raccourcis vers commandes, ventes, porte-monnaie, favoris, paramètres | infos publiques, articles, avis reçus |
| Actions sur l'autre | — | Contacter, S'abonner, Partager, Signaler |

Détail technique utile à connaître : quand on ouvre le profil public de **quelqu'un d'autre**, l'application charge tout en un seul appel serveur sécurisé (le profil, les statistiques, les articles et les avis), ce qui permet même à un visiteur **non connecté** de consulter un profil. Quand on ouvre **son propre** profil via cet écran, les données sont lues directement (utilisateur authentifié). Autrement dit, un profil public reste consultable sans compte, mais les actions (contacter, suivre, signaler) exigent une connexion.

---

### 3.2. Le profil public d'un vendeur

#### Ce qui est affiché (en-tête)

- **Avatar** (photo de profil ou, à défaut, initiale sur fond).
- **Nom d'affichage** (« displayName »), mis en forme proprement.
- **@pseudo** (le « username ») : identifiant unique, permanent et **immuable**, dérivé une seule fois du nom à la création du compte et attribué côté serveur. Il ne change jamais, même si l'utilisateur modifie ensuite son nom d'affichage. Si le pseudo n'a pas encore été attribué (état transitoire très bref après l'inscription), un repli affiche un pseudo dérivé du nom pour ne jamais montrer un « @ » vide.
- **« Membre depuis [mois année] »** (date d'inscription, formatée en français canadien).
- **Ville** (si une adresse est renseignée) — seule la ville est exposée publiquement, jamais la rue ni le code postal.
- **Bio** (texte libre, optionnel).
- **Tags de style** (jusqu'à 5 affichés) : étiquettes comme « Streetwear », « Vintage », « Casual ». Ces tags proviennent du **profil de style généré par IA**, lui-même conditionné au consentement explicite de l'utilisateur (voir 3.8). Sans consentement / sans profil de style, aucun tag ne s'affiche.

#### La rangée de statistiques

Quatre indicateurs, identiques sur le profil public et le profil privé :

| Statistique | Signification métier |
|---|---|
| **Articles** | nombre d'articles actuellement en vente (actifs et non vendus) |
| **Ventes** | nombre d'articles vendus |
| **Note** | note moyenne sur 5 (ex. « 4,8 »), ou « — » si aucun avis |
| **Abonnés** | nombre de personnes qui suivent ce vendeur |

#### Les deux onglets

1. **Articles** : grille des articles en vente du vendeur (3 colonnes). Si aucun article : « Aucun article en vente ». Sur le profil public, seuls les articles **actifs** sont remontés (limités à 30), avec leur première image. Toucher un article ouvre sa fiche.
2. **Avis** (avec compteur, ex. « Avis (12) ») : voir 3.4.

#### Actions disponibles sur le profil d'autrui

- **CONTACTER** : crée (ou rouvre) une conversation avec le vendeur et redirige vers le chat. Exige d'être connecté (sinon, invite à se connecter).
- **S'ABONNER / ABONNÉ** : voir 3.3 (système de follow). Exige d'être connecté.
- **Partager** : ouvre la feuille de partage native du téléphone, avec un message du type « Découvre le profil de [nom] sur Seconde ! » et un lien `https://seconde.app/user/[id]`.
- **Signaler** : ouvre une feuille de signalement (cible « utilisateur »). Exige d'être connecté.

Note produit : on **ne peut pas s'abonner à soi-même ni se contacter soi-même** — sur son propre profil consulté depuis cet écran, seuls « MODIFIER » s'affiche (pas de boutons Contacter/Abonner).

#### Cas « profil introuvable »

Si l'identifiant ne correspond à aucun compte (ou compte supprimé), l'écran affiche « Utilisateur introuvable » avec le message « Ce profil n'existe pas ou a été supprimé ». C'est notamment ce qui apparaît lorsqu'un compte a été supprimé (voir 3.10).

---

### 3.3. Vendeurs suivis (système d'abonnement / « follow »)

Second propose un mécanisme d'abonnement entre utilisateurs, présenté comme « S'abonner » à un vendeur.

**Règles de gestion :**
- Action déclenchée par le bouton « S'ABONNER » sur un profil public. Une fois abonné, le bouton bascule en « ABONNÉ » (état vert avec coche).
- L'action est **réversible** : re-toucher le bouton désabonne.
- L'abonnement met à jour deux choses : la liste des vendeurs suivis par l'abonné, et le compteur **« Abonnés »** affiché sur le profil du vendeur suivi.
- L'interface réagit **instantanément** (mise à jour optimiste) : le bouton change d'état immédiatement, puis se synchronise avec le serveur ; en cas d'échec, l'état revient en arrière.
- L'abonnement exige une connexion (un visiteur non connecté est invité à se connecter).
- La liste « Vendeurs suivis » est consultable ailleurs dans l'app (écran dédié aux vendeurs aimés), alimentée par cette même donnée.

À noter : le compteur d'abonnés sert d'indicateur de popularité / réputation sociale, distinct de la note moyenne (qui mesure la satisfaction transactionnelle).

---

### 3.4. Réputation : avis et note moyenne

La réputation repose sur des **avis textuels notés de 1 à 5 étoiles**, laissés après une transaction réellement terminée.

#### Affichage des avis (onglet « Avis »)

- **Résumé de note** en haut : grande note moyenne (ex. « 4,8 »), rangée de 5 étoiles (remplies selon la moyenne arrondie), et nombre d'avis (« 12 évaluations » / « 1 évaluation »).
- **Liste des avis** : pour chaque avis, l'avatar et le nom de l'auteur, ses étoiles, la date (format « 3 juin 2026 ») et le texte. Toucher l'auteur d'un avis ouvre **son** profil.
- État vide :
  - sur le profil d'autrui : « Aucun avis pour le moment » ;
  - sur son propre profil : « Les avis de vos acheteurs apparaîtront ici. »

#### Comment un avis est créé (règles de gestion)

Un avis ne se laisse **pas** depuis le profil ; il se laisse depuis l'écran d'évaluation accessible après une transaction (depuis « Mes commandes » ou « Mes ventes », pour une transaction livrée ou remise en main propre). Conditions vérifiées **côté serveur** au moment de la soumission :

- L'auteur doit être **connecté**.
- La **transaction doit exister et être terminée** (statut « livré » ou « remise en main propre effectuée »). Tant que la transaction n'est pas dans un état terminal, l'avis est refusé.
- L'auteur doit être **réellement partie à la transaction** (acheteur ou vendeur), et la cible doit être l'**autre** partie.
- On **ne peut pas s'auto-évaluer**.
- **Une seule évaluation par transaction** : un identifiant déterministe empêche les doublons (deux soumissions simultanées : une seule réussit).
- **Fenêtre de 60 jours** : passé 60 jours après la fin de la transaction, il n'est plus possible de laisser un avis (« La période pour laisser un avis est expirée (60 jours). »).
- **Note obligatoire entre 1 et 5.**
- **Texte obligatoire** : minimum 5 caractères, maximum 2000.
- **Filtre d'insultes** (français) : un avis contenant des termes injurieux est refusé avec invitation à reformuler.

Chaque avis est typé selon le contexte : **achat**, **vente** ou **swap** (échange). Les évaluations issues d'un échange (« swap ») alimentent la même note moyenne.

#### Calcul et propagation de la note

- À chaque nouvel avis, la **note moyenne** et le **nombre d'avis** de la personne évaluée sont recalculés et stockés sur son compte (arrondis à une décimale).
- Cette note moyenne pré-calculée est ce qui s'affiche dans la statistique « Note » du profil, mais aussi partout où le vendeur apparaît.
- La personne évaluée reçoit une **notification** « Nouvel avis reçu — [nom] vous a laissé un avis 4/5 » (sous réserve des limites de notifications décrites en 3.9).

---

### 3.5. Le profil privé (« Mon profil ») et ses raccourcis

L'onglet « Mon profil » montre la même carte d'identité (avatar, nom, @pseudo, ancienneté, ville, bio, tags de style, statistiques) que le profil public, mais sert surtout de **plaque tournante** vers les espaces personnels.

**Si l'utilisateur n'est pas connecté**, l'onglet affiche un état invité : « Pas encore connecté », « Connectez-vous pour accéder à toutes les fonctionnalités », et un bouton « SE CONNECTER ». Chaque entrée de menu, si touchée sans connexion, déclenche l'invite de connexion.

**Menu de raccourcis (utilisateur connecté) :**

| Entrée | Destination / utilité |
|---|---|
| Mes commandes | suivi des achats |
| Mes ventes | suivi des ventes |
| **Porte-monnaie** | solde en CAD. Le sous-titre affiche le solde formaté (ex. « 12,50 $ »), ou « Non activé » si le porte-monnaie n'est pas encore actif |
| Mes articles | gestion de mes annonces |
| Mes favoris | articles mis en favori |
| Recherches sauvegardées | alertes / recherches enregistrées |
| Paramètres | écran réglages complet (voir 3.6) |
| Aide | centre d'aide |

En bas : bouton « SE DÉCONNECTER » (avec confirmation « Êtes-vous sûr de vouloir vous déconnecter ? ») et le **numéro de version** de l'application.

#### Édition du profil (« Détails du profil »)

Accessible via « MODIFIER » (profil) ou Paramètres → « Détails du profil ». L'utilisateur peut modifier :

- **Photo de profil** : choisie dans la photothèque (demande de permission d'accès aux photos), recadrée en carré (1:1), compressée, puis téléversée. Les métadonnées EXIF sont retirées.
- **Nom d'affichage** : obligatoire (ne peut être vide), **50 caractères max**, et **seulement lettres, espaces, traits d'union et apostrophes** (les chiffres, emojis et symboles sont refusés). Important : modifier le nom d'affichage **ne change pas** le @pseudo, qui reste immuable.
- **Bio** : texte libre, **200 caractères max**, avec compteur en direct.

Un encart conseille : « Un profil complet avec une photo et une bio attire plus d'acheteurs potentiels. » L'enregistrement met aussi à jour le nom au niveau de l'authentification et rafraîchit les statistiques.

---

### 3.6. Paramètres du compte : vue d'ensemble

L'écran « Paramètres » regroupe tout, par sections :

- **Compte** : Détails du profil · Email · (Vérifier mon email, si applicable) · Numéro de téléphone · Mot de passe **ou** Ajouter un mot de passe.
- **Envoi & Livraison** : Mon adresse · (Options de livraison, si la livraison est activée).
- **Personnalisation** : Mes préférences (tailles, marques, localisation).
- **Paiements** : Compte de paiement (configuration Stripe Connect) · Mon porte-monnaie.
- **Notifications & Confidentialité** : Notifications · Confidentialité.
- **Assistance** : Centre d'aide · À propos.
- **Administration** : visible **uniquement** pour les comptes administrateurs (gestion des boutiques et utilisateurs).
- **Zone de danger** : Supprimer mon compte.

Les entrées du menu **s'adaptent au mode de connexion** :
- « Vérifier mon email » n'apparaît que si le compte a un mot de passe **et** que l'email n'est pas encore vérifié.
- « Mot de passe » apparaît si le compte a déjà un mot de passe ; sinon c'est « Ajouter un mot de passe » (cas des comptes créés via Google/Apple).

---

### 3.7. Identité et sécurité du compte (email, téléphone, mot de passe)

#### Email

Changer son email envoie un **lien de vérification à la nouvelle adresse** ; le changement n'est effectif qu'**après avoir cliqué sur ce lien**. L'écran exige de saisir et **confirmer** la nouvelle adresse, et impose une **ré-authentification** adaptée au mode de connexion :

| Mode de connexion | Vérification d'identité demandée |
|---|---|
| Email + mot de passe | saisir le mot de passe actuel |
| Google | bouton « Se reconnecter avec Google » |
| Apple (sur iOS) | bouton « Se reconnecter avec Apple » |
| **Apple sur Android** | la ré-authentification Apple **n'est pas disponible** : il faut d'abord **ajouter un mot de passe** au compte, puis l'utiliser pour valider |
| Mode indéterminé | invitation à se déconnecter / reconnecter |

> **Spécificité iOS / Android (important).** La connexion « Sign in with Apple » est une technologie Apple : sa **ré-authentification ne fonctionne pas sur Android**. Un utilisateur Apple qui veut, sur un appareil Android, changer son email ou supprimer son compte doit donc **d'abord se créer un mot de passe** (écran « Ajouter un mot de passe »). C'est une contrainte produit assumée, gérée explicitement dans l'app.

#### Vérification de l'email

Écran dédié : envoyer l'email de vérification, puis « J'ai vérifié mon email » pour rafraîchir le statut. États clairs : « Email vérifié » (succès) ou « Email non vérifié » (avec possibilité de renvoyer le lien).

#### Numéro de téléphone — **spécificité Canada**

- Préfixe **fixé à « CA +1 »** (non modifiable).
- Saisie **format canadien à 10 chiffres**, masque automatique `(514) 555-1234`.
- Validation stricte : exactement 10 chiffres, sinon « Veuillez entrer un numéro de téléphone canadien valide (10 chiffres) ».
- Stockage normalisé avec le préfixe `+1`.
- Présenté comme une mesure qui « aide à sécuriser votre compte et facilite les transactions ».

#### Mot de passe

- **Modifier** (comptes avec mot de passe) : saisir le mot de passe actuel + nouveau + confirmation. Minimum **6 caractères**, les deux nouveaux champs doivent correspondre. Ré-authentification requise avant changement.
- **Ajouter** (comptes Google/Apple) : associer un email + mot de passe (min. 6 caractères) au compte social. La connexion sociale **reste active** : ensuite, les deux méthodes fonctionnent. C'est notamment le prérequis pour les utilisateurs Apple sur Android (voir ci-dessus).

---

### 3.8. Adresse et préférences

#### Adresse — **spécificité Canada**

- Saisie via **autocomplétion d'adresses Google**, restreinte au **Canada** (`country:ca`) et en français.
- Composantes extraites automatiquement : numéro et rue, **ville**, **province** (code court, ex. « QC »), **code postal**, **pays**.
- Confirmation explicite avant enregistrement (« Mettre à jour l'adresse ? » avec l'adresse complète).
- Affichage de l'adresse actuelle si déjà renseignée, sinon invitation à en ajouter une « pour faciliter vos ventes et achats ».
- Rappel : seule la **ville** est exposée publiquement sur le profil ; le reste sert à la livraison.

#### Préférences (« Mes préférences »)

Sert à personnaliser les recommandations et la pertinence des résultats :

- **Tailles de vêtements** : XS, S, M, L, XL, XXL (multi-sélection).
- **Pointures de chaussures** : 35 à 46 (multi-sélection, stockées distinctement des tailles vêtements).
- **Marques préférées** : sélection via une feuille dédiée, avec aperçu des marques choisies (5 affichées + compteur « +N »).
- **Localisation** : activation de la géolocalisation (demande de permission) pour « voir les articles près de chez vous » ; la ville détectée est affichée et peut être retirée.
- Lien direct vers les **Notifications**.
- Bouton « Enregistrer » en pied d'écran.

---

### 3.9. Notifications

Écran de préférences avec interrupteurs (on/off), synchronisés instantanément (mise à jour optimiste, retour arrière en cas d'échec).

| Préférence | Déclencheur | Défaut |
|---|---|---|
| Notifications push | toutes les alertes sur le téléphone | **Activé** |
| Notifications par email | actualités importantes par email | **Activé** |
| Nouveaux messages | quand on reçoit un message | **Activé** |
| Nouvelles ventes | quand on vend un article | **Activé** |
| Baisses de prix | quand un favori baisse de prix | **Désactivé** |
| Articles favoris | quand quelqu'un met mon article en favori | **Désactivé** |
| Propositions d'achat | quand on reçoit une offre | **Activé** |
| Réponses aux offres | quand le vendeur répond à mon offre | **Activé** |

**Règle « privacy par défaut » (Loi 25 / LCAP) :** les notifications de nature marketing / secondaire (baisses de prix, article mis en favori) sont **désactivées par défaut** ; l'utilisateur doit les activer explicitement. Les notifications **transactionnelles essentielles** (messages, ventes, offres) restent activées par défaut.

À noter : un rappel « SwapZone » existait pour les zones d'échange limitées dans le temps ; la SwapZone étant devenue une zone permanente, ce rappel est **désactivé côté serveur** et son interrupteur est **masqué** dans l'écran (la clé de préférence est conservée pour stabilité des données).

> **Spécificité iOS.** Sur iOS, l'envoi effectif de notifications push dépend de l'autorisation système accordée au niveau du téléphone ; activer l'interrupteur dans l'app ne suffit pas si l'utilisateur a refusé les notifications au niveau iOS.

---

### 3.10. Confidentialité, données personnelles et conformité (Loi 25 / LPRPDE / LCAP)

C'est une dimension produit forte, dictée par la réglementation canadienne (Québec).

#### Réglages de confidentialité (3 interrupteurs)

1. **Afficher ma photo de profil** — par défaut **désactivé**. Tant qu'il n'est pas activé, la photo **n'est pas visible** publiquement (le serveur la masque dans le profil public). C'est l'application directe du principe « vie privée par défaut » (Loi 25, art. 9.1).
2. **Recommandations personnalisées par IA** — par défaut **désactivé** (consentement explicite requis). Activé, autorise Second à analyser les articles consultés/aimés via une IA Google (Gemini / Vertex AI), avec traitement aux États-Unis. C'est ce consentement qui conditionne la génération du **profil de style** et donc des **tags de style** affichés sur le profil. Activable/désactivable à tout moment, sans impact sur le reste de l'app.
3. **Communications marketing** — par défaut **désactivé**. Le désactiver matérialise un **retrait de consentement** (art. 14 / Loi canadienne anti-pourriel, LCAP). Ce réglage passe par un traitement serveur dédié qui **journalise** le consentement/retrait (registre append-only) et **coupe** les émissions marketing côté serveur. Réactivable à tout moment.

> Distinction importante : les deux premiers réglages sont enregistrés directement, mais le **consentement marketing** est traité à part (journalisation horodatée + effet serveur), parce que la loi exige une **preuve traçable** du consentement et de son retrait.

#### Vos droits (section dédiée)

- **Exporter mes données** (droit à la portabilité, Loi 25 / LPRPDE) : génère un fichier **JSON** structuré contenant profil (nom, email, bio, photo, préférences), articles publiés, favoris, historique de notifications et messages envoyés, puis le propose au **partage / téléchargement** via le système du téléphone.
- **Supprimer mon compte** (droit à l'effacement) : voir ci-dessous.
- **Politique de confidentialité**.
- **Utilisateurs bloqués** : liste des comptes bloqués, avec date de blocage et bouton « Débloquer » (confirmation requise). Rappel affiché : « Les utilisateurs bloqués ne peuvent plus vous contacter ni voir vos articles » et « Vous pouvez bloquer un utilisateur depuis son profil ou depuis une conversation. » Le blocage est donc déclenché ailleurs (profil / conversation) et seulement **géré** ici.

Encart rassurant : « Vos données personnelles ne sont jamais vendues à des tiers. »

#### Suppression de compte (parcours en 2 étapes)

C'est l'un des parcours les plus encadrés de l'app.

**Étape 1 — Information.** Avertissement « action irréversible », avec :
- **Ce qui sera supprimé** : profil et infos personnelles, articles en vente, favoris et recherches sauvegardées, notifications, historique de swaps.
- **Ce qui sera conservé** : les conversations sont **anonymisées** (l'autre participant les garde) — on ne peut pas effacer la part de conversation d'autrui.
- Rappel du droit à l'effacement (Loi 25 / LPRPDE).

**Étape 2 — Confirmation finale.**
- **Ré-authentification** selon le mode de connexion (mot de passe / Google / Apple ; sur **Android avec Apple**, ajout préalable d'un mot de passe — même contrainte qu'en 3.7).
- L'utilisateur doit **taper exactement « SUPPRIMER »** pour activer le bouton.

**Garde-fous métier (vérifiés côté serveur, non contournables) :** la suppression est **refusée** s'il existe des transactions actives, des litiges ouverts, un solde / des fonds en attente ou gelés sur le porte-monnaie, ou une dette vendeur. Dans ce cas, un message précis explique le blocage (« Suppression impossible » + raison renvoyée par le serveur). Cette logique est volontairement portée par le serveur (et non par l'app) parce que les vérifications côté client étaient contournables — un point de conformité et de sécurité financière.

À la suppression réussie, l'app efface l'état local et renvoie vers l'accueil. Le compte supprimé devient « introuvable » pour les autres (cf. 3.2), et son compteur d'abonnements aux vendeurs qu'il suivait est décrémenté.

---

### 3.11. Données clés du profil (langage métier)

Résumé des informations attachées à un compte, pertinentes pour cette section :

- **Identité** : nom d'affichage (éditable), @pseudo (immuable), email, photo, bio, date d'inscription, date de naissance (saisie à l'inscription, format date).
- **Coordonnées** : téléphone (format canadien +1), adresse (rue, ville, province, code postal, pays — Canada).
- **Réputation** : note moyenne, nombre d'avis, nombre de ventes, nombre d'articles, nombre d'abonnés reçus, liste des vendeurs suivis.
- **Personnalisation** : tailles, pointures, marques préférées, localisation, profil de style IA (tags) sous consentement.
- **Type de compte** : « utilisateur » ou « boutique » (les boutiques sont une offre payante distincte ; le profil affiche le type).
- **Consentements & confidentialité** : visibilité de la photo, consentement IA, consentement marketing (avec registre serveur horodaté).
- **Mode de connexion & sécurité** : email/mot de passe, Google ou Apple ; statut de vérification de l'email.
- **Paiement** : rattachement au compte de paiement Stripe Connect (configuré ailleurs, mais accessible depuis Paramètres).

---

### 3.12. Synthèse des spécificités plateforme et locales

**Canada / conformité :**
- Devise affichée en **CAD** (ex. solde porte-monnaie « 12,50 $ »), dates en français canadien.
- Téléphone **+1 / 10 chiffres** ; adresse **restreinte au Canada** via autocomplétion.
- **Loi 25 / LPRPDE / LCAP** : vie privée par défaut (photo, IA, marketing tous OFF par défaut), consentement marketing journalisé et retirable, export de données (portabilité), suppression de compte (effacement) avec anonymisation des conversations d'autrui.

**iOS vs Android :**
- **Apple sur Android** : ré-authentification Apple indisponible → l'utilisateur doit ajouter un mot de passe avant de changer son email ou supprimer son compte.
- **iOS** : les notifications push dépendent en plus de l'autorisation système iOS, indépendamment de l'interrupteur in-app.
