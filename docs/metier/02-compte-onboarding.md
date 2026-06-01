## 02. Compte, inscription & onboarding

Cette section décrit comment un nouvel utilisateur découvre Second, exprime ses préférences, crée un compte et obtient une identité dans l'application. Elle couvre les trois moyens de s'identifier (email/mot de passe, Google, Apple), le consentement légal exigé par la Loi 25 (Québec), le contrôle d'âge, l'onboarding des préférences de mode, l'attribution d'un identifiant public (@username), la distinction entre invité et membre connecté, et la fusion des données d'invité au moment de l'inscription.

Le principe directeur, visible partout dans le code : **on peut tout regarder sans compte, mais agir exige un compte, et un compte exige toujours un consentement valide et un âge minimum.**

---

### 2.1 Vue d'ensemble du parcours d'entrée

Au tout premier lancement, l'application n'affiche pas un mur de connexion. Elle ouvre directement un **onboarding de préférences** (écran « Bienvenue sur Seconde »), puis dépose l'utilisateur dans l'app en tant qu'**invité**. La création de compte n'intervient que plus tard, au moment où l'invité tente une action réservée aux membres (mettre en favori, acheter, vendre, contacter un vendeur, etc.).

Concrètement, à l'ouverture :
1. L'app lit un indicateur local « onboarding déjà fait » (`ONBOARDING_COMPLETED_KEY`).
2. Si l'onboarding n'a jamais été complété, l'utilisateur est redirigé vers l'écran d'onboarding des préférences.
3. Sinon, il entre directement dans l'app (les onglets principaux).

Il n'y a donc qu'un seul « gros » écran d'onboarding (les préférences), affiché une fois pour toutes. Le compte, lui, se crée via une **fenêtre coulissante (bottom sheet) d'authentification** qui peut surgir à n'importe quel moment, depuis n'importe quel écran.

---

### 2.2 Onboarding des préférences (avant le compte)

**Écran** : un seul écran, en deux temps.

**Temps 1 — Accueil.** Titre « Bienvenue sur Seconde », phrase « Dis-nous en un peu plus sur toi pour personnaliser ton expérience. », et deux choix :
- **Continuer** → passe au formulaire.
- **Passer** → marque l'onboarding comme terminé et entre dans l'app sans rien collecter.

**Temps 2 — Formulaire de préférences.** L'utilisateur peut renseigner :

| Champ | Métier | Valeurs |
|---|---|---|
| Je cherche pour | Cible de navigation | Femme, Homme, Les deux, Enfant |
| Système de taille | Référentiel d'affichage des tailles | US (par défaut) ou EU |
| Taille du haut | Multi-sélection | Adulte : XXS → 3XL · Enfant : 2T, 3T, 4T, 5, 6, 6X, 7, 8, 10, 12, 14, 16 (US) ou « 2 ans → 16 ans » (EU) |
| Taille du bas | Multi-sélection | Adulte US : 24 → 40 (jeans) · Adulte EU : 32 → 52 · Enfant : mêmes grilles que le haut |
| Pointure | Multi-sélection | Adulte US : 5 → 13 (demi-pointures) · Adulte EU : 35 → 46 · Enfant US : 5C → 7Y · Enfant EU : 20 → 35 |

**Règles de gestion notables :**
- **Multi-sélection partout** sur les tailles : un utilisateur peut posséder plusieurs tailles (ex. S et M).
- **Choisir « Enfant »** bascule automatiquement vers des grilles de tailles enfant et **vide les sélections** précédentes (les grilles adulte et enfant ne sont pas compatibles).
- **Changer de système (US ↔ EU)** réinitialise les tailles déjà choisies, avec une **demande de confirmation** si des tailles avaient été sélectionnées (« Vos sélections de tailles seront réinitialisées. Continuer ? »).
- Le bouton **VALIDER** reste désactivé tant qu'aucune information n'a été saisie ; **Passer** est toujours disponible.
- Les grilles de tailles sont volontairement calibrées pour le **marché canadien (Montréal)** : système US par défaut, jeans en pouces, pointures US.

**Ce que produisent ces préférences (métier) :** elles alimentent le **flux personnalisé « Pour Toi »**. Elles sont enregistrées à deux endroits :
1. **En local sur l'appareil** (immédiat, pour personnaliser dès la première session, même sans compte).
2. **Côté serveur** via une fonction dédiée :
   - si l'utilisateur **est connecté**, sur sa fiche utilisateur (préférences de sexe, tailles agrégées haut+bas, pointures) avec un drapeau `onboardingCompleted`;
   - si l'utilisateur **est invité**, dans une collection de **préférences invité** anonyme.
   - Le serveur **nettoie et borne** les données reçues (ignore les valeurs vides, limite à 20 tailles par catégorie) et n'accepte que les 4 valeurs de sexe autorisées (`femme`, `homme`, `les-deux`, `enfant`).
- L'enregistrement serveur est **non bloquant** : même si l'envoi échoue, l'utilisateur entre dans l'app (les préférences locales suffisent à démarrer).

> Remarque produit : cet onboarding ne demande **ni âge, ni consentement légal, ni identité**. C'est purement de la personnalisation. L'âge et le consentement sont exigés plus tard, au moment de créer le compte.

---

### 2.3 Invité vs membre connecté

Second distingue clairement deux états :

**Invité (non connecté).**
- Peut naviguer, rechercher, consulter les articles, recevoir un flux personnalisé.
- Possède une **session invité** anonyme (créée au premier lancement) qui sert à suivre son comportement (articles vus, recherches, likes) et à **déduire ses tailles probables** pour la personnalisation.
- **Ne peut pas** réaliser les actions qui exigent une identité (acheter, vendre, mettre en favori de façon persistante, discuter avec un vendeur…).

**Membre connecté.**
- Dispose d'une fiche utilisateur, d'un identifiant public (@username), peut acheter, et — s'il a 18 ans ou plus — vendre.

**Le « mur » d'authentification.** Lorsqu'un invité déclenche une action réservée, l'app appelle un mécanisme central (`requireAuth`) qui :
- exécute l'action immédiatement s'il est déjà connecté ;
- sinon, **ouvre la fenêtre d'authentification** avec un message contextuel et **rejoue automatiquement l'action** une fois la connexion réussie.

Cette fenêtre est unique et globale : elle est montée une seule fois à la racine de l'app et pilotée par un store dédié, ce qui permet de la déclencher de n'importe où.

---

### 2.4 La fenêtre d'authentification (bottom sheet)

C'est l'unique surface de création/connexion de compte. Elle a **quatre modes** :

1. **Se connecter** (par défaut) — email + mot de passe, plus boutons sociaux.
2. **S'inscrire** — nom d'utilisateur + email + mot de passe + bloc consentement, plus boutons sociaux.
3. **Mot de passe oublié** — saisie de l'email, envoi d'un lien de réinitialisation.
4. **Consentement social** — étape obligatoire affichée après une première connexion Google/Apple (voir 2.7).

Tous les modes proposent, en haut, les options sociales puis un séparateur « ou », puis le formulaire email. Sur la connexion comme l'inscription, deux onglets permettent de basculer entre « Se connecter » et « S'inscrire ».

**Spécificité iOS vs Android — Apple :** le bouton **« Continuer avec Apple » n'apparaît que sur iOS**. Sur Android, seules les options Google et email sont proposées (Apple Sign-In n'est pas disponible). Google et email sont proposés sur les deux plateformes.

---

### 2.5 Inscription par email + mot de passe

**Champs et validations à la saisie :**
- **Nom d'utilisateur** : minimum 3 caractères (message « 3 caractères minimum » sinon).
- **Email** : doit contenir « @ » et « . » (message « Adresse email invalide » sinon).
- **Mot de passe** : minimum 6 caractères (message « 6 caractères minimum » sinon).
- **Date de naissance** : trois champs JJ / MM / AAAA (saisie numérique, séparés par « / »).
- **Consentements** (cases à cocher) : voir 2.8.

**Le bouton « S'INSCRIRE » reste désactivé** tant que tout n'est pas réuni : email, mot de passe et nom d'utilisateur non vides, **âge ≥ 16 ans** calculé à partir d'une date valide, **et** les deux cases obligatoires (Conditions + Confidentialité) cochées.

**Ce qui se passe à la validation (règles de gestion) :**
1. **Contrôle d'âge AVANT toute création** : si la date est invalide ou l'âge < 16, l'inscription est refusée et **aucun compte n'est créé** (on ne laisse jamais traîner de compte « orphelin »).
2. Création du compte d'authentification (email + mot de passe) et enregistrement du nom d'affichage.
3. Création de la fiche utilisateur (email, nom, date de création, `authProvider: 'email'`, date de naissance, statut actif).
4. **Attribution d'un @username** persistant et immuable (voir 2.6).
5. **Enregistrement serveur du consentement** : la date de naissance et les preuves de consentement (Conditions, Confidentialité, et Marketing si opté) sont écrites côté serveur, avec la version de politique en vigueur.

**Garantie anti-état-illégal (rollback).** Si l'une des étapes après la création du compte échoue (création de la fiche ou enregistrement du consentement), l'app **annule tout** : elle supprime la fiche utilisateur puis le compte d'authentification. Justification métier : un compte ne doit **jamais** subsister sans preuve de consentement (exigence Loi 25). Le message renvoyé est « La création du compte a échoué. Veuillez réessayer. »

Les erreurs d'authentification (email déjà utilisé, mot de passe trop faible, réseau, etc.) sont **traduites en français** lisible.

---

### 2.6 L'identifiant public @username (unique et immuable)

Chaque membre reçoit un **@username** (handle public). Ses propriétés métier :
- **Dérivé automatiquement du nom d'affichage** au moment de la création du compte (translittération des accents, minuscules, espaces → points, suppression des caractères non autorisés). Exemple : « Marie Dupont » → `marie.dupont`.
- **Unique** : si le handle souhaité est déjà pris, le serveur ajoute un suffixe numérique (`.2`, `.3`, …) jusqu'à trouver un libre. Un registre central des usernames garantit l'unicité même en cas d'inscriptions simultanées.
- **Longueur** : entre 3 et 30 caractères. Si le nom ne permet pas de produire un handle valide (trop court, vide, exotique), un repli déterministe est généré à partir de l'identifiant technique (`user.xxxxxx`).
- **Immuable** : une fois attribué, il **ne change jamais**, même si l'utilisateur modifie ensuite son nom d'affichage. L'opération serveur est **idempotente** : la rappeler sur un compte qui a déjà un username ne fait rien.
- **Attribué pour tous les modes** : email, Google et Apple.
- **Non bloquant** : si l'attribution échoue à l'inscription, cela **n'empêche pas** la création du compte. Un **filet de sécurité** rattrape le cas à la connexion suivante : si la fiche n'a pas encore de username, l'app relance discrètement l'attribution (idempotente) et rafraîchit l'affichage pour faire apparaître le @pseudo sans redémarrage.

> Métier : le @username est l'identité publique stable (apparaît sur la boutique, les avis, les conversations). Le nom d'affichage, lui, peut évoluer ; le @username, non.

---

### 2.7 Connexion sociale (Google / Apple)

**Google** (iOS + Android) et **Apple** (iOS uniquement). Le déroulé :
1. L'utilisateur s'authentifie auprès du fournisseur, puis l'app crée la session Firebase correspondante.
2. **Si le compte est nouveau** : création de la fiche utilisateur (`authProvider: 'google'` ou `'apple'`) et attribution du @username. Le nom récupéré du fournisseur est repris ; s'il est générique ou vide, un nom de repli est généré.
   - Particularité **Apple** : Apple ne transmet le nom complet **qu'à la première autorisation**. Le code le capte à ce moment-là et le réutilise pour dériver le @username.
3. **Étape de consentement obligatoire** : une connexion sociale **ne contourne jamais** le contrôle d'âge ni le consentement légal. Tant que la preuve de consentement (date de naissance enregistrée côté serveur) n'existe pas, le compte est considéré **« pas encore consenti »**.

**Quand l'étape de consentement social s'affiche-t-elle ?** Dans deux cas :
- compte **fraîchement créé** par la connexion sociale ; **ou**
- compte **déjà existant mais sans date de naissance enregistrée** (donc sans preuve de consentement).

L'écran « Avant de continuer » réutilise le **même bloc** date de naissance + cases à cocher que l'inscription email. Tant qu'il n'est pas validé, **l'utilisateur n'entre pas dans l'app**.

**Gestion de l'abandon (très important côté Loi 25 et sécurité) :** si l'utilisateur ferme la fenêtre, la balaie vers le bas, ou échoue le contrôle (âge < 16, cases manquantes, erreur serveur), l'app effectue un **rollback différencié** :
- **Compte tout neuf** (créé à l'instant) : suppression destructive de la fiche puis du compte d'authentification → aucun compte sans consentement ne subsiste.
- **Compte existant** (qui refuse de re-consentir) : **jamais de suppression** (il pourrait porter un solde vendeur, des commandes, un historique). On se contente de le **déconnecter** ; il reste non authentifié côté app tant qu'il n'a pas consenti.

Cette distinction est garantie en bout de chaîne : même si l'écouteur d'authentification global voit une session valide, il **refuse de déverrouiller les capacités** tant que la date de naissance n'est pas enregistrée (la session invité est alors conservée).

---

### 2.8 Consentement Loi 25 & contrôle d'âge

**Le bloc de consentement** (commun à l'inscription email et à l'étape sociale) comporte :
- la **date de naissance** (contrôle d'âge) ;
- **case obligatoire** : « J'ai lu et j'accepte les Conditions d'utilisation. » (lien vers les CGU) ;
- **case obligatoire** : « J'ai lu et j'accepte la Politique de confidentialité. » (lien vers la politique) ;
- **case facultative** : opt-in marketing (« J'accepte de recevoir des offres, baisses de prix et nouveautés… »).

**Règles d'âge (rappel transverse) :**

| Seuil | Capacité | Où c'est appliqué |
|---|---|---|
| **16 ans** | S'inscrire, naviguer, **acheter** | Bloque l'inscription et l'étape de consentement social |
| **18 ans** | **Vendre** (ouvrir un compte de versement Stripe) | Vérifié plus tard, à l'activation vendeur (hors de cette section) |

Pour les 16-17 ans, un message dédié explique que la vente est réservée aux 18 ans et plus (exigence du partenaire de paiement), tout en confirmant qu'ils peuvent acheter et naviguer.

**Calcul d'âge — détails métier importants :**
- La date de naissance est stockée comme **chaîne calendaire `AAAA-MM-JJ`** (sans heure ni fuseau) pour éviter toute dérive de fuseau horaire.
- Le client valide d'abord (UX), mais **le serveur revalide systématiquement** l'âge et refuse les dates impossibles (ex. 30 février). C'est le serveur qui fait foi.
- Spécificité **Canada** : le serveur calcule le « jour courant » dans le fuseau **America/Toronto**, pour s'aligner sur l'heure locale des utilisateurs canadiens plutôt qu'en UTC.

**Preuve de consentement (côté serveur, source de vérité) :**
- À l'enregistrement, le serveur écrit la date de naissance sur la fiche utilisateur **et** crée des **documents de consentement** horodatés : toujours « Conditions » et « Confidentialité », plus « Marketing » uniquement si l'utilisateur a opté.
- Chaque preuve porte la **version de politique** acceptée (ex. `2026-05-31`) et le canal (`app`).
- Ces documents sont **append-only** et écrits **exclusivement côté serveur** : le client ne peut ni les créer ni les modifier (garantie d'intégrité de la preuve).

**Retrait du consentement marketing (Loi 25 art. 14 / LCAP) :** il existe une opération serveur dédiée qui, lorsqu'on coupe le marketing, (a) **journalise** un nouveau document de preuve (sans jamais altérer les anciens) et (b) **applique l'effet** en désactivant les préférences de notifications marketing (baisses de prix, mises en favori, rappels) — garantissant qu'aucun envoi marketing ne part après le retrait. Cette gestion vit ailleurs dans l'app (paramètres), mais s'appuie sur le même registre de consentements créé ici.

---

### 2.9 Connexion, mot de passe oublié, et fusion de comptes

**Connexion (membre existant).** Email + mot de passe ; à la réussite, l'app récupère la fiche utilisateur. Les options sociales sont aussi disponibles depuis l'écran de connexion.

**Mot de passe oublié.** Saisie de l'email → envoi d'un **lien de réinitialisation** par Firebase. Un message confirme l'envoi.

**Fusion des données d'invité → membre (`mergeGuestToUser`).** À **chaque** connexion ou inscription réussie (email, Google, Apple), l'app fusionne la **session invité** (comportement accumulé avant le compte) dans la fiche du membre, puis **efface la session invité**. Justification métier : sans cela, les événements futurs continueraient à être attribués à l'entité « invité » et fausseraient l'attribution. Même si la fusion échoue techniquement, la session invité est **toujours** abandonnée après coup.

**Lien d'un mot de passe à un compte social (`linkPasswordCredential`).** Un membre arrivé par Google/Apple peut **ajouter un email + mot de passe** à son compte. Après l'opération, il peut se connecter **au choix** par le social **ou** par email/mot de passe. Côté données, le provider d'origine reste la « source de vérité » ; on ajoute simplement « email » à la liste des providers liés et on marque le compte comme disposant d'un mot de passe.

> Conséquence concrète sur iOS/Android : un membre Apple (donc créé sur iOS) qui veut se reconnecter **sur Android** doit avoir, au préalable, lié un mot de passe à son compte — sinon il ne dispose d'aucun moyen de connexion disponible sur Android. La ré-authentification Apple (pour les actions sensibles) **n'est possible que sur iOS** ; un message invite, le cas échéant, à ajouter un mot de passe depuis un appareil iOS.

---

### 2.10 Données clés produites (résumé métier)

| Donnée | Quand | Rôle |
|---|---|---|
| Préférences d'onboarding (sexe, tailles {valeur, système}, pointures) | Au 1er lancement (invité ou membre) | Personnalisation du flux « Pour Toi » |
| Session invité | Au 1er lancement | Suivi anonyme + déduction de tailles ; fusionnée à l'inscription |
| Fiche utilisateur (email, nom, provider, date de création, statut) | À la création de compte | Identité du membre |
| Date de naissance (`AAAA-MM-JJ`) | À l'inscription / consentement social | Contrôle d'âge (16 / 18) ; aussi preuve « consenti » |
| @username (unique, immuable) | À la création de compte (tous providers) | Identité publique stable |
| Documents de consentement (terms, privacy, marketing) | À l'inscription / consentement / retrait | Preuve légale append-only, versionnée |

---

### 2.11 Spécificités Canada & contraintes plateforme (récapitulatif)

- **Loi 25 (Québec)** : consentement explicite obligatoire (Conditions + Confidentialité), preuve horodatée et versionnée côté serveur, jamais de compte sans consentement (rollback systématique), retrait marketing journalisé et effectif.
- **Âge** : 16 ans pour s'inscrire/acheter, 18 ans pour vendre ; calcul aligné sur le fuseau **America/Toronto**.
- **Tailles** : grilles calibrées marché canadien (système **US par défaut**, jeans en pouces, pointures US ; alternative EU disponible).
- **iOS uniquement** : bouton et ré-authentification **Apple**. Sur **Android**, l'authentification passe par Google ou email/mot de passe.
- **Google** : disponible sur les deux plateformes (configuration distincte iOS / Android côté Firebase).
