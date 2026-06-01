# Second — Document métier (que fait l'application)
_Version 2026-06-01 — marketplace mode seconde main, Canada (FR), iOS + Android._

## Résumé exécutif

**Second** est une marketplace mobile de **mode et d'objets de seconde main** (iOS + Android, application Expo / React Native), pensée d'abord pour le marché **canadien francophone**. On y **achète, vend et échange (troc)** des articles entre particuliers et boutiques professionnelles. Tout est en **français**, en **dollars canadiens (CAD)**, et calibré pour le Canada (adresses, provinces, format bancaire, conformité Loi 25 du Québec).

**Pour qui.** Principalement la **Gen Z et les millennials** sensibles à la durabilité et au pouvoir d'achat. Tout compte est à la fois acheteur **et** vendeur potentiel : il n'existe pas de statut « vendeur » distinct. Une couche **boutiques professionnelles** (friperies, dépôts-vente, vintage, luxe, sneakers, etc.) est prévue par-dessus le modèle C2C.

**Ce qu'on peut y faire.** Naviguer sans compte (feed personnalisé, recherche texte + filtres, **recherche visuelle par photo**) ; créer un compte (email, Google, Apple) ; **mettre en vente un article en quelques minutes** grâce à une **analyse IA** des photos (titre, marque, catégorie, couleurs, matières, taille, état, prix suggérés) ; **acheter** (paiement Stripe natif) ou **convenir d'une remise en main propre** ; **faire une offre** et négocier dans la messagerie ; **proposer un échange** d'articles avec complément en argent ; suivre ses **commandes/ventes**, son **porte-monnaie**, ses **avis** et sa réputation. La plateforme gère la livraison de bout en bout (étiquette + suivi ShipEngine), la **protection acheteur** (fonds retenus 7 jours), les recours (remboursement, signalement, retour), et la conformité Loi 25 (consentements, décisions automatisées contestables, export et suppression de données).

**Comment ça gagne de l'argent.** Modèle « façon Vinted » : **0 % de commission vendeur** (le vendeur touche 100 % du prix) ; la plateforme se rémunère via des **frais de protection facturés à l'acheteur** = `max(2,00 $ ; 5 % du prix + 1,50 $)`, prélevés comme `application_fee_amount` sur un paiement Stripe Connect **Custom** (white-label : le vendeur ne voit jamais Stripe). **Aucun frais sur les ventes en main propre.** Levier de monétisation complémentaire **décidé mais non encore implémenté** : des **forfaits boutique payants** (3 paliers) qui réduisent les frais acheteur au lieu de réintroduire une commission vendeur.

**État de livraison / limites connues** (transparence) : **push iOS non opérationnel** (jeton APNs brut non routable via FCM) ; **universal/app links** non finalisés (liens partagés ouvrent le navigateur) ; **migration de l'index de recherche** à exécuter avant la mise en production de la recherche ; **expédition désactivée par drapeau** dans la version en service (meetup seul actif), et **forfaits boutiques** à construire. Ces points sont des chantiers cadrés, pas des inconnues.

---

## Table des matières

1. Vue d'ensemble & proposition de valeur
2. Compte, inscription & onboarding
3. Profil utilisateur & réputation
4. Mise en vente d'un article
5. Découverte, recherche & navigation
6. Achat & paiement
7. Offres & négociation
8. Livraison & suivi de colis
9. Remise en main propre (meetup)
10. Avis & réputation après-vente
11. Recours, litiges, remboursements & annulations
12. Porte-monnaie & paiements vendeur
13. Swap & SwapZone
14. Messagerie & modération
15. Notifications & temps réel
16. Boutiques payantes & administration
17. Conformité & légal (Loi 25 / Canada)
18. Architecture & opérations (annexe technique)

---

## 01. Vue d'ensemble & proposition de valeur

> Document métier destiné à un lecteur informé non-technique (fondateur, investisseur, dossier immigration/incubateur, nouvel arrivant produit). Il décrit ce que l'application **fait réellement** d'après le code, pas une feuille de route. Quand une fonctionnalité a une limite connue, elle est indiquée factuellement.

### 1.1 En une phrase

**Second** est une marketplace mobile de **mode et d'objets de seconde main**, pensée d'abord pour le marché **canadien francophone**, où l'on **achète, vend et échange (troc)** des articles entre particuliers et boutiques professionnelles. L'application est disponible sur **iOS et Android** (application Expo / React Native), avec paiement sécurisé, livraison avec étiquette générée dans l'app, remise en main propre (meetup) et protection de l'acheteur.

Le positionnement repose sur une promesse simple et lisible : **le vendeur garde 100 % du prix de son article (0 % de commission vendeur)**. La plateforme se rémunère exclusivement via des **frais de protection payés par l'acheteur**, à la manière de Vinted, et non via une commission prélevée au vendeur comme Poshmark.

### 1.2 Mission et marché visé

**Mission.** Rendre la revente de vêtements et d'objets de seconde main aussi simple, rapide et fiable qu'un achat neuf, en levant les trois frictions classiques de la seconde main :
1. **La mise en vente est longue** → Second propose une **mise en vente assistée par IA** (photo → titre, marque, catégorie, couleur, matière, taille, état et suggestion de prix pré-remplis).
2. **La confiance manque** → Second sécurise l'argent (paiement Stripe, fonds retenus pendant une fenêtre de litige), gère la livraison de bout en bout (étiquette + suivi) et offre des recours à l'acheteur (remboursement, signalement, retour).
3. **Le prix freine** → Second supprime la commission vendeur (le vendeur touche tout) et permet le **troc** (échange d'articles, avec éventuel complément en argent).

**Marché visé.** Le marché de la mode circulaire au **Canada**, principalement la **Gen Z et les millennials** sensibles à la durabilité et au pouvoir d'achat. Le produit est **mono-langue français** (cible Québec / francophonie canadienne en priorité). Toute l'ergonomie « locale » est calibrée Canada :

| Spécificité Canada | Implémentation réelle |
|---|---|
| Devise | **CAD** partout. Affichage catalogue à la française canadienne (`45 $`, virgule décimale), et `45,00 $ CA` dans les contextes sensibles (paiement, solde vendeur, retrait). |
| Destination de livraison | **Canada uniquement** : la création d'étiquette ShipEngine exige une adresse canadienne valide ; une adresse hors-Canada est rejetée. |
| Identité fiscale boutique | Le profil légal d'une boutique prévoit **NEQ** (Québec) ou BN fédéral, **n° de TPS** et **n° de TVQ**. |
| Coordonnées bancaires | Champs **transit (5 chiffres)**, **institution (3 chiffres)**, **compte (7–12 chiffres)** — format bancaire canadien. |
| Vie privée | Conformité **Loi 25** (Québec) intégrée au produit : consentements horodatés, décisions automatisées explicables et contestables, registre d'incidents, purge de rétention, export et suppression de compte. |
| Âge légal | **Inscription réservée aux 16 ans et plus** : l'âge est vérifié **avant** la création du compte, sans créer de compte orphelin si le critère n'est pas rempli. |

### 1.3 Proposition de valeur

**Pour le vendeur (particulier ou boutique)**
- **0 % de commission** : il reçoit l'intégralité du prix affiché (`sellerPayout = articlePrice`).
- **Mise en vente en quelques minutes** grâce à l'IA qui pré-remplit la fiche à partir des photos.
- **Encaissement automatisé et white-label** : payé via un compte **Stripe Connect Custom** créé et géré entièrement dans l'app — il **ne va jamais sur Stripe**.
- **Logistique gérée** : étiquette d'expédition achetée dans l'app, suivi automatique, ou remise en main propre (meetup) sans frais.

**Pour l'acheteur**
- **Protection incluse** dans les frais de service : paiement sécurisé, fonds retenus jusqu'à la fin de la fenêtre de litige, recours en cas de problème.
- **Découverte riche** : feed personnalisé, recherche texte + filtres, **recherche visuelle par photo**, recommandations.
- **Négociation et troc** : faire une offre, proposer un échange d'articles.

**Pour la plateforme**
- Un modèle de revenu **transparent et défendable** côté acheteur, aligné sur le standard du marché (Vinted), tout en restant le plus attractif pour les vendeurs.

### 1.4 Modèle de revenu

#### a) Frais de protection acheteur (revenu principal, en place)

> **Frais = max( 2,00 $ ; 5 % du prix de l'article + 1,50 $ )**

| Prix article | Frais de protection acheteur | L'acheteur paie (hors livraison) | Le vendeur reçoit |
|---|---|---|---|
| 5 $ | 2,00 $ (plancher) | 7,00 $ | 5,00 $ |
| 15 $ | 2,25 $ | 17,25 $ | 15,00 $ |
| 30 $ | 3,00 $ | 33,00 $ | 30,00 $ |
| 50 $ | 4,00 $ | 54,00 $ | 50,00 $ |
| 100 $ | 6,50 $ | 106,50 $ | 100,00 $ |

Techniquement, ces frais correspondent à l'`application_fee_amount` prélevé lors du paiement Stripe (destination charge vers le compte du vendeur). **Ce que les frais couvrent** : protection acheteur (litige/remboursement), traitement du paiement, support client, infrastructure (hébergement, API de livraison).

**Règle importante :** sur une vente **en main propre (meetup)**, **aucun frais de service n'est appliqué** (`fee = 0`). Les frais ne s'appliquent qu'aux ventes avec livraison.

#### b) Boutiques payantes (modèle stratégique, non encore câblé dans le moteur de frais)

La **vision de monétisation des boutiques** est une **décision produit assumée** : forfaits payants pour vendeurs professionnels, monétisés non pas en réintroduisant une commission vendeur, mais en **réduisant les frais de protection côté acheteur** sur les articles de la boutique (commission vendeur maintenue à 0 %).

**État réel dans le code :** cette mécanique de **réduction de frais par forfait n'est pas encore implémentée** dans le moteur de calcul. Le type `Shop` ne porte aujourd'hui **aucun champ de forfait/tier/abonnement**, et `calculateFees`/`calculateServiceFee` appliquent un barème **unique et global**. La brique « boutiques » est en place (création, modération admin, statuts, profil légal, géolocalisation), mais la **différenciation tarifaire payante reste à brancher**.

#### c) Porte-monnaie (wallet)

Un **porte-monnaie interne** existe (activation, solde, historique, retrait, paiement). Il sert de moyen de paiement alternatif et de réceptacle de remboursements ; ce n'est pas en soi une source de revenu, mais il fluidifie la rétention de la valeur dans l'écosystème.

### 1.5 Différenciateurs

| Différenciateur | Détail concret | Vs concurrence |
|---|---|---|
| **0 % commission vendeur** | Le vendeur encaisse 100 % du prix. | Poshmark prélève ~20 % au vendeur. |
| **Frais 100 % acheteur, transparents** | 5 % + 1,50 $, plancher 2 $. | Aligné sur Vinted. |
| **Paiement white-label (Stripe Connect Custom)** | Le vendeur ne voit jamais Stripe ; onboarding, identité et compte bancaire saisis dans l'app. | Expérience plus intégrée que les marketplaces redirigeant vers un dashboard tiers. |
| **Troc / échange (swap)** | Échange d'articles, avec **complément en argent** via Stripe ; preuve photo, suivi, litige. | Fonctionnalité rare chez les généralistes. |
| **Recherche visuelle** | Photographier un article pour trouver les annonces similaires (embeddings). | Différenciateur d'usage fort sur mobile. |
| **Mise en vente assistée par IA** | Photo → fiche pré-remplie + prix suggéré. | Réduit drastiquement le temps de mise en ligne. |
| **SwapZone** | Une **zone de troc généraliste permanente** (univers visuel sombre, distinct). | Espace dédié à la culture de l'échange. |
| **Local + national** | Meetup sans frais **et** livraison nationale avec étiquette + suivi. | Couvre l'achat local et à distance. |
| **Conformité Loi 25 native** | Décisions automatisées explicables/contestables, consentements, incidents, rétention. | Avance réglementaire sur le marché québécois. |

### 1.6 Positionnement vs Vinted / Poshmark

- **Vinted** : modèle de frais très proche (frais acheteur en pourcentage + part fixe). Second reprend ce modèle « vendeur gratuit » mais ajoute le **troc structuré**, la **recherche visuelle**, la **mise en vente IA**, le **meetup local sans frais** et une **conformité Loi 25** taillée pour le Canada/Québec.
- **Poshmark** : prélève une commission vendeur importante. Second se différencie frontalement par le **0 % vendeur**.
- **Boutiques professionnelles** : Second prévoit une couche **B2B2C** (friperies, dépôts-vente, vintage, luxe, sneakers, etc.) avec **modération admin** et profil légal canadien.

### 1.7 Synthèse des grands modules de l'application

L'application est structurée autour de **5 onglets** (Accueil, Favoris, Vendre, Messages, Profil) et de parcours dédiés.

| Module | Ce qu'il fait (métier) | Écrans / parcours clés |
|---|---|---|
| **Découverte & feed** | Page d'accueil personnalisée : discover, nouveautés, baisses de prix, marques tendance, vendeurs en vedette, SwapZone. | `(tabs)/index`, `features/home/*` |
| **Recherche** | Texte + **filtres**, **recherche visuelle** par photo, **recherches sauvegardées** avec alertes, historique. | `search`, `visual-search-results`, `saved-searches` |
| **Annonce / article** | Fiche détaillée, favoris, partage, vendeur, similaires, actions (acheter, offre, échange). | `article/[id]`, `article/edit/[id]` |
| **Mise en vente (IA)** | Capture multi-photos (max 5), **analyse IA**, détails, prix, prévisualisation, publication. Brouillons reprenables. | `sell/capture` → `photos-review` → `details` → `pricing` → `preview` |
| **Offres & négociation** | Offre, contre-offre, accepter/refuser, expiration auto. | `MakeOfferModal`, `OfferBubble` |
| **Troc (swap)** | Échange d'articles avec **complément en argent**, preuves photo, suivi, litige. **SwapZone** permanente. | `propose-swap`, `swap/[id]`, `swap-zone`, `my-swaps` |
| **Messagerie** | Conversations temps réel acheteur ↔ vendeur, bulles offre/swap. | `(tabs)/messages`, `chat/[id]` |
| **Paiement & checkout** | Livraison vs meetup, **Stripe (Payment Sheet natif)**, frais de protection, succès. | `checkout/*`, `payment/[txId]`, `StripePayment` |
| **Livraison & suivi** | Achat d'étiquette ShipEngine, **suivi auto**, transitions d'état, échecs/pertes/retours. | `ShipmentTracking`, webhooks + pollers backend |
| **Protection & litiges** | Fonds retenus **7 jours**, recours : **remboursement**, **signalement**, **retour**. | recours, callables `recourse.ts` |
| **Commandes & ventes** | Suivi acheteur et vendeur, mes articles, échanges. | `my-orders`, `my-sales`, `my-articles`, `my-swaps` |
| **Portefeuille vendeur** | Solde (disponible/en attente/retenu), historique, **retrait**, paiement par wallet. | `wallet`, callables `wallet.ts` |
| **Onboarding Stripe (vendeur)** | Création **Stripe Connect Custom** in-app : identité, compte bancaire, statut. | `settings/stripe-onboarding`, `payments.ts` |
| **Profils & social** | Profil public vendeur, suivre des vendeurs, avis post-transaction. | `user/[id]`, `liked-sellers`, `review/[txId]` |
| **Boutiques (pro)** | Boutiques géolocalisées, typées, avec **modération admin** et profil légal canadien. | `shop/[id]`, `admin/shops`, `admin/shop-detail/[id]` |
| **Compte & réglages** | Profil, adresse, email, mot de passe, téléphone, paiements, livraison, notifications, confidentialité, blocages, **export**, **suppression de compte**, mentions légales. | `settings/*` |
| **Onboarding préférences** | Sexe, tailles haut/bas, pointure → personnalisation du feed (skippable). | `onboarding` |
| **Conformité Loi 25** | Consentements, **décisions automatisées** contestables, incidents, rétention, suppression conforme. | `consent.ts`, `automatedDecisions.ts`, `privacyIncidents.ts`, `users.ts` |

### 1.8 Authentification et entrée dans l'app

- **Méthodes** : email/mot de passe, **Google** et **Apple**. Sur Android, Google requiert Google Play Services.
- **Visiteur (guest)** : suivi visiteur non authentifié + fusion guest → compte à la connexion (préférences conservées).
- **Porte d'accès (auth gate)** : les actions sensibles déclenchent une **feuille de connexion** (`AuthBottomSheet`) plutôt qu'un blocage sec.
- **Âge ≥ 16 ans** vérifié **avant** création de compte, avec acceptation des CGU et de la politique de confidentialité (consentements horodatés, version enregistrée).

### 1.9 Cycle de vie d'une transaction (états)

`pending_payment` → (`paid`) → `label_created` → `shipped` → `delivered` → **(fenêtre de litige 7 j)** → `completed`.

Branches alternatives : remise en main propre (`meetup_pending` → `meetup_confirmed` → `meetup_completed`), `return_requested`, `delivery_failed`, `lost`, `cancelled`, `disputed`, `refund_in_progress`, `refunded`. La libération des fonds n'intervient **qu'après** la fenêtre de litige (held → disponible).

Le **troc** a sa propre machine à états : `proposed` → `payment_pending` (si complément) → `accepted` → `photos_pending` → `shipping` → `completed`, avec `declined`/`cancelled`/`disputed`.

### 1.10 Spécificités iOS vs Android (impact produit)

| Sujet | iOS | Android |
|---|---|---|
| **Notifications push** | **Limite connue** : token APNs brut **non exploitable** pour FCM ; non enregistré → **push iOS non opérationnel**. | **Opérationnel** : token FCM enregistré ; **canaux** dédiés avec niveaux d'importance. |
| **Connexion Google** | Via client iOS dédié. | Requiert **Google Play Services**. |
| **Connexion Apple** | Native (`expo-apple-authentication`). | Via flux web Apple. |
| **Bottom sheets / overlays** | Comportement standard. | Montage à l'ouverture pour éviter un voile transparent bloquant. |

Conséquence : tant que le push iOS n'est pas finalisé, les utilisateurs iOS reçoivent les notifications **in-app** mais **pas** les push système hors-app.

### 1.11 Données clés (en langage métier)

- **Article** : photos, titre, marque, catégorie, couleurs, matières, taille normalisée, état (`neuf`, `très bon état`, `bon état`, `satisfaisant`), prix, taille de colis, état de vente, éventuel rattachement à une **boutique**.
- **Utilisateur** : profil public (nom, @pseudo persistant immuable, bio, avatar, tags de style, note, ventes, abonnés), préférences, adresse, consentements Loi 25.
- **Boutique** : propriétaire, type (catégories), adresse + **géolocalisation**, coordonnées, horaires, statut de modération, profil légal canadien.
- **Transaction** : montant, frais de service, coût de livraison, mode, statut, références Stripe et étiquette/suivi.
- **Swap** : articles échangés, complément éventuel, statut, preuves photo.
- **Wallet** : solde disponible / en attente / retenu, mouvements, retraits.

### 1.12 À retenir

1. Marketplace mobile **iOS + Android** de seconde main, **mono-FR**, calibrée **Canada (CAD, Loi 25)**.
2. **0 % commission vendeur** ; revenu via **frais de protection acheteur** — **aucun frais sur le meetup**.
3. Paiement **white-label Stripe Connect Custom**.
4. Différenciateurs : **troc structuré**, **recherche visuelle**, **mise en vente IA**, **SwapZone**, **protection acheteur**.
5. Couche **boutiques pro** opérationnelle, mais **réduction de frais payante par forfait non encore implémentée**.
6. Limite connue : **push iOS non opérationnel**.

---

## 02. Compte, inscription & onboarding

Cette section décrit comment un nouvel utilisateur découvre Second, exprime ses préférences, crée un compte et obtient une identité dans l'application : les trois moyens de s'identifier (email/mot de passe, Google, Apple), le consentement légal exigé par la Loi 25, le contrôle d'âge, l'onboarding des préférences de mode, l'attribution d'un @username, la distinction invité / membre, et la fusion des données d'invité.

Principe directeur : **on peut tout regarder sans compte, mais agir exige un compte, et un compte exige toujours un consentement valide et un âge minimum.**

### 2.1 Vue d'ensemble du parcours d'entrée

Au premier lancement, l'app ouvre directement un **onboarding de préférences** (« Bienvenue sur Seconde »), puis dépose l'utilisateur en tant qu'**invité**. La création de compte n'intervient qu'au moment où l'invité tente une action réservée (favori, achat, vente, contact).

À l'ouverture : (1) l'app lit `ONBOARDING_COMPLETED_KEY` ; (2) si jamais complété → écran d'onboarding des préférences ; (3) sinon → entrée directe dans l'app. Le compte se crée via une **fenêtre coulissante (bottom sheet) d'authentification** qui peut surgir de n'importe où.

### 2.2 Onboarding des préférences (avant le compte)

Un seul écran, en deux temps. **Temps 1 — Accueil** : « Continuer » (formulaire) ou « Passer » (entre dans l'app sans collecte). **Temps 2 — Formulaire** :

| Champ | Métier | Valeurs |
|---|---|---|
| Je cherche pour | Cible de navigation | Femme, Homme, Les deux, Enfant |
| Système de taille | Référentiel | US (défaut) ou EU |
| Taille du haut | Multi-sélection | Adulte XXS → 3XL · Enfant 2T → 16 |
| Taille du bas | Multi-sélection | Adulte US 24 → 40 · EU 32 → 52 · Enfant idem haut |
| Pointure | Multi-sélection | Adulte US 5 → 13 · EU 35 → 46 · Enfant US 5C → 7Y / EU 20 → 35 |

**Règles :** multi-sélection partout ; choisir « Enfant » bascule vers les grilles enfant et **vide** les sélections ; changer de système (US ↔ EU) réinitialise les tailles (avec confirmation si des tailles étaient choisies) ; **VALIDER** désactivé tant qu'aucune info ; **Passer** toujours dispo ; grilles calibrées **Canada (Montréal)**.

**Ce que produisent ces préférences :** elles alimentent le flux « Pour Toi », enregistrées (1) **en local** (immédiat) et (2) **côté serveur** (sur la fiche utilisateur si connecté, dans une collection **préférences invité** sinon). Le serveur **nettoie et borne** (ignore les vides, max 20 tailles/catégorie, 4 valeurs de sexe autorisées). Enregistrement serveur **non bloquant**.

> Cet onboarding ne demande **ni âge, ni consentement, ni identité** — c'est de la pure personnalisation. L'âge et le consentement sont exigés à la création de compte.

### 2.3 Invité vs membre connecté

**Invité** : navigue, recherche, consulte, reçoit un flux personnalisé ; possède une **session invité** anonyme (suivi comportemental + déduction de tailles) ; **ne peut pas** acheter, vendre, mettre en favori persistant, discuter.

**Membre** : fiche utilisateur, @username, peut acheter, et — s'il a 18 ans ou plus — vendre.

**Le « mur » d'authentification** (`requireAuth`) : exécute l'action si déjà connecté ; sinon **ouvre la fenêtre d'authentification** avec message contextuel et **rejoue automatiquement l'action** après connexion. Fenêtre unique, montée une fois à la racine, pilotée par un store dédié.

### 2.4 La fenêtre d'authentification (bottom sheet)

Quatre modes : (1) **Se connecter** (défaut) ; (2) **S'inscrire** ; (3) **Mot de passe oublié** ; (4) **Consentement social** (étape obligatoire post-Google/Apple). Options sociales en haut, séparateur « ou », puis formulaire email.

**Spécificité iOS vs Android — Apple :** le bouton **« Continuer avec Apple » n'apparaît que sur iOS**. Sur Android : Google et email seulement.

### 2.5 Inscription par email + mot de passe

**Validations :** nom d'utilisateur ≥ 3 caractères ; email contient « @ » et « . » ; mot de passe ≥ 6 caractères ; date de naissance JJ/MM/AAAA ; consentements (2.8). **« S'INSCRIRE » désactivé** tant que tout n'est pas réuni : champs non vides, **âge ≥ 16 ans**, et les deux cases obligatoires cochées.

**À la validation :** (1) **contrôle d'âge AVANT toute création** (refus si invalide / < 16, **aucun compte créé**) ; (2) création du compte auth ; (3) création de la fiche utilisateur (`authProvider: 'email'`, date de naissance, statut actif) ; (4) **attribution d'un @username** (2.6) ; (5) **enregistrement serveur du consentement** (date de naissance + preuves + version de politique).

**Garantie anti-état-illégal (rollback).** Si une étape post-création échoue, l'app **annule tout** (supprime fiche puis compte auth) : un compte ne doit **jamais** subsister sans preuve de consentement (Loi 25). Erreurs auth **traduites en français**.

### 2.6 L'identifiant public @username (unique et immuable)

- **Dérivé du nom d'affichage** à la création (translittération accents, minuscules, espaces → points). Ex. « Marie Dupont » → `marie.dupont`.
- **Unique** : suffixe numérique (`.2`, `.3`…) si pris ; registre central garantit l'unicité même en inscriptions simultanées.
- **Longueur** 3 à 30 ; repli déterministe (`user.xxxxxx`) si le nom ne produit pas de handle valide.
- **Immuable** : ne change jamais, même si le nom d'affichage change. Opération serveur **idempotente**.
- **Tous providers** (email, Google, Apple). **Non bloquant** : si l'attribution échoue à l'inscription, un **filet de sécurité** la rattrape à la connexion suivante (idempotente).

### 2.7 Connexion sociale (Google / Apple)

**Google** (iOS + Android), **Apple** (iOS uniquement). Déroulé : auth fournisseur → session Firebase ; si nouveau compte → création fiche + @username (nom du fournisseur repris ou repli) ; **étape de consentement obligatoire**.

Particularité **Apple** : le nom complet n'est transmis qu'**à la première autorisation** ; le code le capte alors pour dériver le @username.

**L'étape de consentement social s'affiche** si : compte fraîchement créé **ou** compte existant sans date de naissance enregistrée. L'écran « Avant de continuer » réutilise le **même bloc** que l'inscription email. Tant qu'il n'est pas validé, **l'utilisateur n'entre pas dans l'app**.

**Gestion de l'abandon (Loi 25 + sécurité) — rollback différencié :** compte tout neuf → suppression destructive (fiche + auth) ; compte existant qui refuse → **jamais de suppression** (solde/commandes possibles), simple **déconnexion**. Même si l'écouteur global voit une session valide, il **refuse de déverrouiller** tant que la date de naissance n'est pas enregistrée.

### 2.8 Consentement Loi 25 & contrôle d'âge

**Bloc de consentement :** date de naissance ; case obligatoire CGU ; case obligatoire Politique de confidentialité ; case facultative opt-in marketing.

| Seuil | Capacité | Où |
|---|---|---|
| **16 ans** | S'inscrire, naviguer, **acheter** | Bloque inscription + consentement social |
| **18 ans** | **Vendre** (compte Stripe) | Vérifié à l'activation vendeur |

**Calcul d'âge :** date stockée en **`AAAA-MM-JJ`** (sans heure/fuseau) ; **serveur revalide systématiquement** (refuse les dates impossibles) ; « jour courant » calculé en fuseau **America/Toronto**.

**Preuve de consentement (serveur, source de vérité) :** documents de consentement horodatés (« Conditions » et « Confidentialité » toujours, « Marketing » si opté), avec **version de politique** (ex. `2026-05-31`) et canal (`app`). **Append-only**, **écrits exclusivement côté serveur** (client ne peut ni créer ni modifier).

**Retrait du consentement marketing (art. 14 / LCAP) :** opération serveur dédiée qui **journalise** une preuve (sans altérer les anciennes) et **applique l'effet** (désactive les préférences marketing).

### 2.9 Connexion, mot de passe oublié, et fusion de comptes

**Connexion** : email + mot de passe (+ options sociales). **Mot de passe oublié** : lien de réinitialisation Firebase.

**Fusion guest → membre (`mergeGuestToUser`).** À **chaque** connexion/inscription réussie, fusion de la session invité dans la fiche membre, puis **effacement** de la session invité (même si la fusion échoue techniquement).

**Lien mot de passe → compte social (`linkPasswordCredential`).** Un membre Google/Apple peut **ajouter un email + mot de passe**. Le provider d'origine reste source de vérité ; « email » s'ajoute à la liste des providers liés.

> Conséquence iOS/Android : un membre Apple (créé sur iOS) qui veut se reconnecter **sur Android** doit avoir lié un mot de passe au préalable. La ré-authentification Apple n'est possible que sur iOS.

### 2.10 Données clés produites

| Donnée | Quand | Rôle |
|---|---|---|
| Préférences d'onboarding | 1er lancement | Flux « Pour Toi » |
| Session invité | 1er lancement | Suivi anonyme + déduction tailles ; fusionnée à l'inscription |
| Fiche utilisateur | Création de compte | Identité du membre |
| Date de naissance (`AAAA-MM-JJ`) | Inscription / consentement social | Contrôle d'âge (16/18) + preuve « consenti » |
| @username (unique, immuable) | Création de compte | Identité publique stable |
| Documents de consentement | Inscription / retrait | Preuve légale append-only, versionnée |

### 2.11 Spécificités Canada & plateforme

- **Loi 25** : consentement explicite obligatoire, preuve horodatée/versionnée serveur, jamais de compte sans consentement, retrait marketing journalisé et effectif.
- **Âge** : 16 (inscription/achat), 18 (vente) ; calcul en **America/Toronto**.
- **Tailles** : grilles **US par défaut** (jeans en pouces, pointures US) ; alternative EU.
- **iOS uniquement** : bouton et ré-auth **Apple**. **Android** : Google ou email.
- **Google** : sur les deux plateformes.

---

## 03. Profil utilisateur & réputation

Profil public (vu par les autres), profil privé (vue personnelle), réputation (avis + note moyenne), abonnement entre utilisateurs (« follow »), et paramètres du compte (email, téléphone, mot de passe, adresse, préférences, notifications, confidentialité, export et suppression).

Point de vocabulaire : **tout utilisateur est potentiellement vendeur ET acheteur**. Il n'y a pas de statut « vendeur » distinct ; la réputation se construit dans les deux rôles.

### 3.1 Les deux faces du profil : public vs privé

| | Profil privé (le mien) | Profil public (autre) |
|---|---|---|
| Écran | onglet « Mon profil » | « profil utilisateur » |
| Accès | onglet permanent | nom/avatar d'un vendeur |
| Bouton principal | « MODIFIER » | « CONTACTER » + « S'ABONNER » |
| Contenu | mes infos + raccourcis | infos publiques, articles, avis |
| Actions sur l'autre | — | Contacter, S'abonner, Partager, Signaler |

Le profil public d'autrui se charge en **un seul appel serveur sécurisé** (profil, stats, articles, avis), consultable même **non connecté**. Son propre profil se lit directement. Les actions (contacter, suivre, signaler) exigent une connexion.

### 3.2 Le profil public d'un vendeur

**En-tête :** avatar (ou initiale) ; nom d'affichage ; **@pseudo** (immuable, repli si non encore attribué) ; « Membre depuis [mois année] » ; **Ville** seule (jamais rue ni code postal) ; bio ; **tags de style** (jusqu'à 5, issus du profil de style IA sous consentement — sans consentement, aucun tag).

**Stats (publiques et privées) :** Articles (en vente actifs), Ventes (vendus), Note (moyenne /5 ou « — »), Abonnés.

**Onglets :** Articles (grille 3 colonnes, actifs limités à 30 sur le profil public) ; Avis (avec compteur).

**Actions sur autrui :** CONTACTER (crée/rouvre la conversation) ; S'ABONNER / ABONNÉ ; Partager (`https://seconde.app/user/[id]`) ; Signaler. On **ne peut pas** s'abonner ni se contacter soi-même.

**Profil introuvable** (compte inexistant/supprimé) : « Utilisateur introuvable ».

### 3.3 Vendeurs suivis (« follow »)

Bouton « S'ABONNER » → « ABONNÉ » (vert + coche). **Réversible**. Met à jour la liste des suivis + le compteur « Abonnés ». Réaction **instantanée** (optimiste, retour arrière en cas d'échec). Connexion requise. Liste consultable dans l'écran dédié aux vendeurs aimés. Le compteur d'abonnés = popularité sociale, distinct de la note (satisfaction transactionnelle).

### 3.4 Réputation : avis et note moyenne

Avis textuels **notés 1 à 5 étoiles**, laissés après une transaction terminée. **Onglet « Avis »** : résumé (grande note + 5 étoiles + « N évaluations ») et liste (avatar, nom, étoiles, date, texte). États vides différenciés.

**Conditions vérifiées côté serveur** : auteur connecté ; transaction existante et **terminée** (`delivered` / `meetup_completed`) ; auteur **partie** à la transaction ; cible = l'**autre** partie ; pas d'auto-évaluation ; **une seule évaluation par transaction** (identifiant déterministe) ; **fenêtre de 60 jours** ; note 1-5 obligatoire ; texte 5–2000 caractères ; **filtre d'insultes** (FR).

Chaque avis est typé : **achat**, **vente** ou **swap**. **Calcul et propagation** : note moyenne + nombre d'avis recalculés et stockés sur le compte (arrondis à une décimale). Notification « Nouvel avis reçu » à la personne évaluée.

### 3.5 Le profil privé (« Mon profil ») et ses raccourcis

Même carte d'identité, mais **plaque tournante** vers les espaces personnels. **Non connecté** : « Pas encore connecté » + bouton « SE CONNECTER ».

**Menu :** Mes commandes · Mes ventes · **Porte-monnaie** (solde CAD ou « Non activé ») · Mes articles · Mes favoris · Recherches sauvegardées · Paramètres · Aide. En bas : « SE DÉCONNECTER » (avec confirmation) + numéro de version.

**Édition du profil :** photo (photothèque, recadrée 1:1, compressée, EXIF retiré) ; nom d'affichage (obligatoire, 50 car. max, lettres/espaces/traits d'union/apostrophes seulement — **ne change pas le @pseudo**) ; bio (200 car. max, compteur).

### 3.6 Paramètres du compte : vue d'ensemble

Sections : **Compte** (profil, email, vérifier email, téléphone, mot de passe ou ajouter un mot de passe) ; **Envoi & Livraison** (adresse, options de livraison si activée) ; **Personnalisation** (préférences) ; **Paiements** (compte Stripe Connect, porte-monnaie) ; **Notifications & Confidentialité** ; **Assistance** ; **Administration** (admins uniquement) ; **Zone de danger** (supprimer mon compte). Le menu **s'adapte au mode de connexion** (« Vérifier mon email » si mot de passe + email non vérifié ; « Ajouter un mot de passe » pour les comptes Google/Apple).

### 3.7 Identité et sécurité du compte

**Email** : changement par **lien de vérification** envoyé à la nouvelle adresse ; saisie + confirmation ; **ré-authentification** selon le mode de connexion.

| Mode | Vérification |
|---|---|
| Email + mot de passe | mot de passe actuel |
| Google | « Se reconnecter avec Google » |
| Apple (iOS) | « Se reconnecter avec Apple » |
| **Apple sur Android** | **indisponible** : ajouter d'abord un mot de passe |
| Indéterminé | déconnexion / reconnexion |

> **Spécificité iOS/Android :** la ré-authentification Apple **ne fonctionne pas sur Android**. Un utilisateur Apple sur Android doit **d'abord créer un mot de passe**.

**Téléphone — Canada :** préfixe **« CA +1 »** fixe ; format **10 chiffres**, masque `(514) 555-1234` ; validation stricte ; stockage normalisé `+1`.

**Mot de passe :** modifier (actuel + nouveau + confirmation, min. 6, ré-auth) ; ajouter (comptes Google/Apple — la connexion sociale reste active).

### 3.8 Adresse et préférences

**Adresse — Canada :** autocomplétion Google restreinte au **Canada** (`country:ca`, FR) ; composantes extraites (rue, ville, province courte, code postal, pays) ; confirmation explicite ; seule la **ville** est publique.

**Préférences :** tailles vêtements (XS → XXL) ; pointures (35 à 46) ; marques préférées ; localisation (géoloc « articles près de chez vous ») ; lien vers Notifications.

### 3.9 Notifications

Interrupteurs synchronisés (optimiste). Push, email, nouveaux messages, nouvelles ventes (tous **activés** par défaut), baisses de prix et articles favoris (**désactivés** par défaut), propositions d'achat et réponses aux offres (**activés**).

**Règle « privacy par défaut » (Loi 25 / LCAP) :** les notifications marketing/secondaires sont **OFF par défaut** ; les transactionnelles essentielles **ON**. Le rappel SwapZone (zones limitées) est **désactivé serveur** et son interrupteur **masqué** (clé conservée).

> **iOS :** l'envoi push dépend aussi de l'autorisation système iOS.

### 3.10 Confidentialité, données personnelles et conformité (Loi 25 / LPRPDE / LCAP)

**3 interrupteurs (tous OFF par défaut) :** (1) Afficher ma photo de profil (sinon masquée serveur) ; (2) Recommandations personnalisées par IA (consentement explicite ; conditionne le profil de style et les tags) ; (3) Communications marketing (le désactiver = **retrait de consentement** journalisé append-only + coupure serveur).

**Vos droits :** **Exporter mes données** (JSON structuré, partage natif) ; **Supprimer mon compte** ; Politique de confidentialité ; **Utilisateurs bloqués** (liste + débloquer ; le blocage se déclenche ailleurs). Encart : « Vos données ne sont jamais vendues à des tiers. »

**Suppression de compte (2 étapes) :** Étape 1 — information (ce qui est supprimé ; conversations **anonymisées** ; rappel droit à l'effacement). Étape 2 — **ré-authentification** + taper exactement **« SUPPRIMER »**. **Garde-fous serveur non contournables** : refus s'il existe transactions actives, litiges ouverts, solde/fonds en attente ou gelés, ou dette vendeur. À la réussite : état local effacé, compte « introuvable » pour les autres, compteurs d'abonnements décrémentés.

### 3.11 Données clés du profil

Identité (nom éditable, @pseudo immuable, email, photo, bio, date d'inscription, date de naissance) ; coordonnées (téléphone +1, adresse Canada) ; réputation (note, nombre d'avis, ventes, articles, abonnés, suivis) ; personnalisation (tailles, pointures, marques, localisation, profil de style IA sous consentement) ; type de compte (« utilisateur » / « boutique ») ; consentements & confidentialité ; mode de connexion ; rattachement Stripe Connect.

### 3.12 Synthèse des spécificités

**Canada :** CAD, dates FR-CA, téléphone +1/10 chiffres, adresse restreinte au Canada, Loi 25 (vie privée par défaut, marketing journalisé/retirable, export, suppression avec anonymisation des conversations d'autrui).

**iOS vs Android :** ré-auth Apple indisponible sur Android (ajouter un mot de passe d'abord) ; push iOS dépend de l'autorisation système.

---

## 04. Mise en vente d'un article

Parcours de bout en bout : prise de photos, analyse IA, saisie des détails, prix/livraison, aperçu, publication, gestion de l'article publié.

### 4.1 Vue d'ensemble du tunnel

Tunnel en 5 écrans : (1) Capture photo (1 à 5 photos) ; (2) Photos & analyse IA (réorganiser + analyse auto) ; (3) Détails ; (4) Prix & livraison ; (5) Aperçu + publication.

**Accès réservé aux membres connectés** (feuille « Connectez-vous pour vendre un article »). **Un seul brouillon à la fois** sur l'appareil.

### 4.2 Étape 1 — Capture des photos

Caméra plein écran (arrière par défaut). Repères de cadrage selon le nombre de photos. **Règles :** **max 5 photos** (badge « Maximum atteint ») ; **au moins 1** requise ; deux sources (caméra / galerie multi-sélection) ; photos **compressées** ; suppression par croix ; quitter avec photo → confirmation (brouillon sauvegardé), sans photo → suppression du brouillon vide.

**Permissions :** demande caméra au montage ; si refus, écran dédié avec repli **import galerie**. Comportement identique iOS/Android. **Persistance :** brouillon local dès la 1re photo (copie locale + débounce).

### 4.3 Étape 2 — Photos & analyse par IA

Fusionne revue + analyse. Analyse **automatique** au chargement (une fois), relançable, ou « remplir manuellement ». Photo **PRINCIPALE** = première (vignette partout). Ajout/suppression possibles **tant que l'analyse n'est pas en cours**.

**Étapes affichées :** catégorie → couleur/matière → lecture étiquette (marque) → titre/description. **Techniquement :** traitement on-device (HEIC/HEIF → JPEG, compression > 2 Mo, rejet > 5 Mo), téléversement cloud, modèle Gemini via fonction serveur → fiche structurée.

**Données pré-remplies :** titre, description, **catégorie** (chemin hiérarchique), **état** (neuf / très bon / bon / satisfaisant), couleurs, matières, marque (rapprochée d'une marque connue), taille, **suggestion de taille de colis** (petit/moyen/grand). Chaque champ porte un **niveau de confiance** (badge « IA »).

**Garde-fous :** **quota 10 analyses/heure/utilisateur** ; **délai max ~90 s** ; en cas d'erreur, recours adaptés (réessayer / changer photos / manuel) ; « Remplir manuellement » part d'une fiche vide (état défaut « bon état »). Navigation **non automatique** : l'utilisateur touche **Continuer**.

### 4.4 Étape 3 — Détails de l'article

Formulaire pré-rempli (champs IA avec repère de confiance) : titre (obligatoire, 80 car. saisie) ; description (500 car.) ; catégorie (obligatoire, feuille hiérarchique) ; état (4 valeurs) ; marque ; taille (adaptée à la catégorie) ; couleurs/matières (multi-sélection).

**Règles :** Continuer exige **titre non vide, description non vide, ≥ 1 catégorie**. Auto-sauvegarde (débounce ~0,5 s). À l'arrivée, le brouillon passe à l'**étape 2**.

### 4.5 Étape 4 — Prix & livraison

**Prix :** saisie nettoyée (2 décimales max) ; **bornes 0,01 $ à 10 000 $** ; **CAD**.

**Livraison :** remise en main propre (choix d'un ou plusieurs **quartiers** ; au moins un requis si activée) ; expédition (taille de colis ; suggestion IA pré-sélectionnée) ; **au moins une option active**.

**Spécificité importante — l'expédition est actuellement DÉSACTIVÉE.** Un drapeau `SHIPPING_ENABLED = false` masque le bloc expédition et **force chaque nouvel article en main propre**. Un ancien brouillon « expédition » est ramené à la main propre. Le code expédition (taille de colis, partenaire logistique) reste réactivable d'un interrupteur ; le moteur de paiement et ShipEngine demeurent intégrés en arrière-plan.

**Persistance :** auto-sauvegarde ; à l'arrivée, brouillon → **étape 3**.

### 4.6 Étape 5 — Aperçu et publication

Aperçu fidèle (carrousel + badge « APERÇU », marque, titre, prix CAD, pastilles, description, caractéristiques, badges de livraison). Actions : **Publier** ou **Modifier**.

**Validation locale à la publication :** titre ≥ 3 car., prix > 0 et ≤ 10 000 $, ≥ 1 photo, ≥ 1 catégorie. Garde anti-double-clic.

**La publication passe obligatoirement par le serveur** (`createArticle`), qui re-valide tout : **e-mail vérifié obligatoire** (Google/Apple vérifiés d'office) ; titre ≥ 3 car., prix 0,01–10 000 $, 1 à 10 images (limite serveur), état valide, ≥ 1 catégorie ; **nettoyage du texte** (HTML retiré, titre tronqué 200, description 5 000) ; **normalisation de la marque** ; taille structurée `{valeur, système}` (« EU » par défaut côté vendeur) ; couleurs/matières/quartiers en listes.

**Pas d'onboarding Stripe imposé à la publication** : exigé seulement quand un article en **expédition** est acheté.

**État initial :** `isActive = true`, `isSold = false`, **`moderationStatus = approved`** (publication immédiate), compteurs à zéro. **Indexation recherche** automatique (mots-clés, champs filtrables, vignette, données vendeur, score de popularité ; seuls les articles actifs/non bloqués y figurent). Stats vendeur recalculées.

**Après publication :** brouillon supprimé (photos conservées) ; fenêtre de succès (voir l'article / accueil).

### 4.7 Brouillons & reprise

Brouillon **unique** persistant (photos, résultat IA, détails, prix/livraison, étape atteinte). **Reprise** : fenêtre « reprendre le brouillon » qui renvoie **exactement à l'étape** quittée. **Expiration : 14 jours** (suppression auto + nettoyage images local/cloud). Nettoyage des images locales orphelines au démarrage.

### 4.8 Gestion des articles existants

Écran « Mes articles » (filtre En vente / Vendus).

| Action | Disponibilité | Effet |
|---|---|---|
| Modifier | Article **non vendu** | Écran d'édition |
| Marquer vendu / Remettre en vente | Toujours | Bascule l'état |
| Supprimer | Toujours | Désactivation |

**Marquer vendu** (`toggleArticleSold`, serveur) **refuse si une transaction est en cours** ; quand l'article devient vendu, les **offres en attente expirent** (message système aux acheteurs) et l'article disparaît de la recherche. **Supprimer** = **désactivation** (`isActive = false`).

**Édition (`updateArticle`, serveur)** : interdite sur article vendu/désactivé ou avec transaction en cours. **Baisse de prix :** si le nouveau prix < ancien, enregistrement du prix d'origine, % de baisse et date (alimente l'affichage « prix réduit »). Toute modif du **titre/prix/première photo** est **propagée** aux conversations qui référencent l'article.

### 4.9 Spécificités Canada et iOS / Android

CAD plafonné à 10 000 $ ; main propre par **quartiers** (seule option active tant que l'expédition est désactivée) ; photos transitent par un stockage cloud sécurisé (brouillons abandonnés/expirés supprimés local + cloud). **iOS :** HEIC/HEIF → JPEG ; gestion clavier (padding). **Android :** équivalent (système gère le redimensionnement). Tunnel, validations, IA, quotas et publication serveur **identiques** sur les deux plateformes.

### 4.10 Monétisation (côté vendeur)

**Publier est gratuit et sans commission vendeur** (100 % du prix conservé, ni frais de mise en ligne ni prélèvement). Modèle économique côté **acheteur** (et offre payante « Boutiques » qui réduit ces frais). Analyse IA offerte (limite 10/heure).

---

## 05. Découverte, recherche & navigation

Comment l'utilisateur trouve des articles : feed d'accueil, recherche texte + filtres + photo, navigation catégories/marques, alertes.

### 5.1 Vue d'ensemble du parcours de découverte

Trois portes d'entrée : (1) **l'accueil (feed)** — découverte passive ; (2) **la recherche** — découverte active ; (3) **la recherche visuelle (photo)**. Plus deux mécanismes de fidélisation : **historique de recherche** et **recherches sauvegardées avec alertes push**.

### 5.2 L'accueil / le feed

En-tête fixe (barre de recherche + appareil photo + cloche + raccourcis catégories) et **7 sections** :

| Ordre | Section | Source | Fraîcheur |
|---|---|---|---|
| 1 | **Tendances** (marques) | `getTrendingBrands` | ~1 h |
| 2 | **Nouveautés** | `getNewArrivals` | ~10 min |
| 3 | **Pour toi** | recherche filtrée par profil | à chaque ouverture |
| 4 | **SwapZone** | zone unique | — |
| 5 | **Baisses de prix** | `getPriceDrops` | ~10 min |
| 6 | **Vendeurs en vedette** | `getFeaturedSellers` | ~30 min |
| 7 | **Explorer** | `getNewArrivals` paginé | ~10 min |

**Règles :** chargement progressif (chaque section interroge le serveur **seulement quand elle entre dans le champ de vision**) ; sections vides masquées ; **isolation des erreurs** (barrière par section) ; re-toucher l'onglet Accueil remonte en haut.

**Détails :** Tendances examine jusqu'à 500 articles actifs/non vendus, regroupe par marque **sans casse**, top 10 ; Nouveautés = 10 plus récents ; **Pour toi** affichée seulement si profil de style IA **ou** préférences manuelles (exclut les articles de l'utilisateur) ; Baisses de prix triées par % décroissant (baisse enregistrée via `recordPriceDrop`, nouveau prix obligatoirement **inférieur**) ; Vendeurs en vedette classés par « likes vendeur » (≥ 1 like), top 20 ; SwapZone = bande sombre cliquable vers la zone permanente (compteur « nouveautés cette semaine », teaser non cliquable si pas de zone) ; Explorer = grille infinie (20/page).

**En-tête :** barre de recherche (bouton → écran dédié) ; appareil photo (recherche visuelle) ; cloche (centre de notifications, pastille « 9+ ») ; raccourcis catégories (1er niveau).

### 5.3 La recherche textuelle

Barre + chips de filtres + résultats (ou « recherches récentes »). **Parcours :** ouverture sans contexte → clavier focus + écran récentes/tendances ; saisie + validation → grille de résultats ; **barre d'info** (« 24 articles trouvés » / « 20+ »); défilement → page suivante (lots de 20).

**Règles :** **debounce 350 ms** ; auto-masquage des résultats si terme + filtres vidés ; déclenchement par terme **ou** filtre **ou** catégorie ; bouton **« Effacer tout »** ; gestion d'erreur réseau (Réessayer).

**Logique du mot-clé :** moteur **maison Firestore** (pas Algolia/Elastic), collection `search_index` (mots-clés titre + description + marque normalisés) ; terme **normalisé** (minuscules, accents/ponctuation retirés — « Été » = « ete ») ; **premier mot** = filtre serveur principal, mots suivants tous présents (logique « ET ») ; terme non exploitable → page **vide** ; ordre = **pertinence/popularité**. **Canada :** fourchettes et résumés en CAD (« $ »).

### 5.4 Les filtres et le tri

| Filtre | Type | Détails |
|---|---|---|
| **Tri** | Unique | Plus récents (défaut) · Populaires · Prix ↑ · Prix ↓ |
| **Catégorie** | Arborescence | Multi-niveaux |
| **Couleur** | Multi | Palette prédéfinie |
| **Taille** | Multi | US / EU + Adulte / Enfant |
| **Matière** | Multi | Liste prédéfinie |
| **Marque** | Multi | Sélecteur dédié |
| **État** | Unique | Neuf / Très bon / Bon / Satisfaisant |
| **Prix** | Fourchette | Min/Max CAD |

**Règles :** libellé du chip adapté au nombre de valeurs (« Couleur » → « Rouge » → « 3 couleurs ») ; **prix inversé** si min > max (négatifs ignorés) ; **tailles jamais confondues entre systèmes** (couple `{valeur, système}`) ; recherche possible **avec filtres seuls**.

**Tri (subtilité) :** sans mot-clé → 4 tris ; **avec mot-clé → seul « Populaires »** (les tris prix/date masqués ; bascule auto sur « Populaires » si incompatible), car le serveur ne peut ordonner que par score de popularité en mode texte (limite assumée du moteur Firestore maison).

**Tri par proximité — état réel :** le moteur **prévoit** un tri par distance mais **non activé** (aucune position transmise, hook géoloc vide). **Pas de fonction « articles à proximité » aujourd'hui** côté découverte.

### 5.5 La recherche visuelle (par photo)

**Parcours :** caméra de recherche visuelle (accueil ou écran de recherche) → photo → **préparation image** (JPEG, HEIC/HEIF convertis, compression/redimensionnement ~1 Mo, plafond 4 Mo, largeur 1024 puis 768 px) → envoi serveur → **empreinte visuelle (embedding)** via Vertex AI (multimodal) comparée aux empreintes des articles actifs (plus proches voisins) → écran « Résultats visuels » avec **% de similarité**.

**Règles :** **seuil ~45 %** minimum ; **jusqu'à 20 résultats** ; **fonctionne sans compte** (débit **5/min anonyme** vs **20/min connecté**) ; états clairs (analyse, aucun résultat, erreurs) ; **dépendance aux empreintes** (calcul auto à la publication ; outil admin de rattrapage). Fonction voisine « Produits similaires » sur la fiche article. **HEIC/HEIF** géré côté client ; pas de divergence iOS/Android.

### 5.6 Navigation par catégories et par marques

**Catégories :** arborescence riche (4-5 niveaux), type Vinted ; 1er niveau en raccourcis d'accueil ; chip « Catégorie » = sélecteur en arborescence (filtre sur la catégorie la plus précise). **Marques :** pastilles « Tendances » → recherche filtrée ; chip « Marque » multi-marques ; lien direct (paramètre `brands`) → « Résultats par marque ». **Par boutique :** paramètre `shopId` → « Articles de la boutique ».

### 5.7 Historique de recherche (récentes)

**Réservé aux connectés** (sinon « Connectez-vous pour sauvegarder votre historique »). Enregistrée à la validation si terme **ou** filtre actif ; **dédoublonnage** ; **plafond 20** (10 affichées) ; toucher = **rejoue intégralement** ; suppression individuelle. **Recherches tendances** quand vide = **liste fixe codée en dur** (« Sac Polène », « Veste en cuir », « Jean Levi's 501 »…), **pas un classement temps réel**.

### 5.8 Recherches sauvegardées et alertes nouveautés

**Créer :** après une recherche avec résultats, bouton « Sauvegarder » (connexion requise) ; nommer (défaut proposé), résumé des critères, interrupteur **« Alertes nouveautés »**. **Gérer** (profil → « Recherches sauvegardées ») : nom + résumé, **badge nouveautés**, cloche on/off, corbeille. Toucher **rouvre** + remet à zéro le compteur.

**Logique serveur :** traitement **toutes les 15 minutes**, **seulement les recherches dont les alertes sont activées** ; cherche articles actifs/non vendus créés après la dernière notification ; **notification push** + maj date + compteur.

**Limite iOS vs Android :** les push de nouveautés ne partent qu'aux appareils à **jeton FCM routable** ; un iOS à jeton APNs brut **ne reçoit pas** l'alerte. La recherche reste consultable (compteur visible) ; le **rappel push** peut manquer sur iOS. Android : canal dédié « saved_searches », priorité haute + son.

### 5.9 Données clés

**Profil de style** (`styleProfile`, IA) → « Pour toi » (sinon préférences manuelles) ; **index de recherche** (`search_index`) ; **empreintes visuelles** (`embeddings`) ; **historique** (20 max, dédoublonné) ; **recherches sauvegardées** (drapeau alertes + compteur). Un article est « découvrable » s'il est **actif et non vendu**.

### 5.10 Synthèse des limites connues

| Sujet | État réel |
|---|---|
| Articles à proximité (géoloc) | **Non disponible** (position non transmise) |
| Tri prix/date avec mot-clé | **Désactivé** (seul « Populaires ») |
| Recherches « tendances » de l'écran de recherche | **Liste fixe codée en dur** |
| Recherche visuelle | Limitée aux articles indexés ; débit bridé |
| Alertes push iOS | Risque de non-réception (APNs brut) |
| Historique / recherches sauvegardées | Réservés aux connectés |

---

## 06. Achat & paiement

Du bouton « Acheter » jusqu'au paiement, la confirmation et le suivi de la commande (acheteur et vendeur).

### 6.0 État actuel important : la livraison est désactivée

- **L'expédition postale est temporairement désactivée** (`SHIPPING_ENABLED = false`). Tant que c'est le cas : seul mode = **remise en main propre (meetup)** (y compris articles anciens créés en « expédition ») ; le checkout force « main propre » ; `/checkout/shipping` redirige vers le checkout.
- **Conséquence :** dans la version en service, **aucun paiement carte n'est encaissé via le checkout**. Le meetup se règle **hors application** (cash, virement) ; **aucun frais de plateforme** sur un meetup.
- Tout le moteur Stripe / ShipEngine / calcul de frais reste **présent et fonctionnel**, réactivable d'un drapeau. La suite documente **les deux réalités** : meetup (actif) et expédition payée (réactivable).

### 6.1 Le point de départ : fiche article et boutons d'action

| Situation | Actions |
|---|---|
| Article disponible (autre que le vendeur) | **OFFRE** + **ACHETER · {prix}** |
| Article vendu | Bandeau « Article vendu » |
| Article de l'utilisateur | Bandeau « C'est votre article » |
| Contexte SwapZone | « PROPOSER UN ÉCHANGE » |

**Bouton Acheter :** refus si vendu / si l'utilisateur est le vendeur ; feuille d'auth si non connecté (reprise après connexion) ; sinon haptique + checkout. **OFFRE** ouvre la négociation (montant via messagerie) ; un prix négocié n'est payable **que** s'il correspond à une offre **acceptée** (6.7).

### 6.2 Le checkout : choix du mode de livraison

Écran `/checkout` : récap article + modes. **Remise en main propre** (gratuit, « lieu public à Montréal », aucun frais de plateforme) ou **Expédition postale** (si réactivée et autorisée, « À partir de 8,50 $ », 3-5 jours ouvrables, « payé après livraison confirmée »). Si livraison désactivée → forcé « main propre » ; mode unique présélectionné. Gardes-fous (article introuvable/vendu, utilisateur = vendeur). CONTINUER → `/checkout/meetup` ou `/checkout/shipping`.

### 6.3 Parcours « remise en main propre » (actif)

Écran `/checkout/meetup` : (1) choix du lieu (lieux suggérés par le vendeur ou **« À convenir par messagerie »**) ; (2) prix (ou négocié, badge « PRIX NÉGOCIÉ ») ; (3) « CONFIRMER LE MEETUP » → vérif blocage mutuel, création/récupération de la conversation, **transaction meetup** en `meetup_pending`, **offre de meetup structurée** envoyée en messagerie, page de succès.

**Règles :** **aucun frais** (serviceFee = 0, shippingCost = 0) ; total = prix article ; règlement **hors application** (rien crédité au porte-monnaie) ; date/heure convenues par messagerie.

### 6.4 Parcours « expédition postale » (réactivable) — saisie d'adresse

Écran `/checkout/shipping` : adresse → estimation → frais → paiement. Formulaire pré-rempli. **Code postal canadien** `A1A 1A1` (estimation dès 6 caractères). À payer, **revalidation serveur stricte** : pays forcé **CA**, rue/ville non vides, **province parmi les 13 codes** (AB, BC, MB, NB, NL, NS, NT, NU, ON, PE, QC, SK, YT), code postal valide. Validation **avant** tout encaissement.

### 6.5 Estimation des frais de livraison (ShipEngine)

`getShippingEstimate` consulte **ShipEngine** (Postes Canada / Intelcom). **Origine** = code postal vendeur ; **destination** = adresse acheteur ; **colis** = poids/dimensions (défaut 0,5 kg, 30×25×10 cm). Jusqu'à **5 tarifs** triés du moins cher au plus cher (transporteur, service, délai ouvrable, montant, devise) ; premier présélectionné.

**Repli ShipEngine injoignable :** deux tarifs de secours (Standard 8,50 $ / Express 14,50 $, préfixe `fallback_`). **Un tarif de repli ne permet pas d'acheter une vraie étiquette** : paiement carte **bloqué** (réessayer ou meetup).

### 6.6 Calcul des frais de service (protection acheteur)

Modèle **Vinted** : **0 % commission vendeur, frais 100 % acheteur**, vendeur reçoit **100 %**.

> Frais = max( 2,00 $ ; 5 % du prix + 1,50 $ )

| Prix | Frais | Total acheteur (hors livraison) |
|---|---|---|
| 5 $ | 2,00 $ | 7,00 $ |
| 15 $ | 2,25 $ | 17,25 $ |
| 30 $ | 3,00 $ | 33,00 $ |
| 50 $ | 4,00 $ | 54,00 $ |
| 100 $ | 6,50 $ | 106,50 $ |

Affiché en temps réel (`getServiceFee`), recalculé localement si indispo. **Le calcul final fait foi côté serveur** (`calculateFees`). Paramètres configurables (env / Remote Config). **Total acheteur** = prix + livraison + frais de protection.

### 6.7 Création de la commande : verrouillage et anti-fraude

`createTransaction`, opération **atomique** : **verrou anti double-vente** (vérif disponibilité + `isSold = true` dans une transaction Firestore unique — un seul gagnant) ; contrôles (article existant, non vendu, actif, acheteur ≠ vendeur) ; **prix négocié borné à une offre acceptée** (montant supérieur au prix affiché toujours rejeté) ; **frais de livraison recalculés serveur** (re-cotation ShipEngine ; tarif expiré → refus « Tarif de livraison expiré ») ; **compte Stripe vendeur actif obligatoire** (expédition) ; **adresse d'origine vendeur réelle exigée**. Transaction en `pending_payment` (expédition) ou `meetup_pending`. Limites : `createTransaction` 20/min, session de paiement 10/min ; non authentifiés rejetés.

### 6.8 Le paiement par carte (Stripe Connect Custom + destination charge)

`createStripeCheckout` puis **feuille de paiement native Stripe**. **Destination charge** : l'acheteur paie le total, Stripe verse la part vendeur sur son **compte Connect Custom**, plateforme prélève via `application_fee_amount`. Devise **CAD**. Le vendeur ne voit **jamais** Stripe. **Idempotence** : clé déterministe (`pi_{transactionId}`), aucun second prélèvement ; `clientSecret` jamais stocké.

**Feuille (`StripePayment`)** : native (pas de WebView), marchand « Seconde » ; **Apple Pay** (iOS) / **Google Pay** (Android) auto si configurés (`merchantCountryCode: 'CA'`), sinon carte standard. Résultats : succès / échec (réessayer/annuler) / annulation.

**Échecs et orphelins :** si la préparation échoue, la transaction est **annulée** ; échec de la feuille → réessayer (nouvelle session) ou annuler (`cancelled`, article relibéré) ; tarif expiré → « Actualiser l'estimation ».

**Paiement par porte-monnaie (option) :** interrupteur si solde ; **couverture totale** (100 % wallet via `payWithWallet`) ou **paiement mixte** (wallet débité atomiquement de sa part, carte pour le reste ; si Stripe échoue, le débit wallet est **remboursé automatiquement**).

### 6.9 Confirmation côté serveur : le webhook Stripe

Le paiement n'est **jamais** confirmé par le client. **Webhook `payment_intent.succeeded`** : vérifie signature + montant (trop-perçu → remboursement auto) ; transaction → **`paid`** + article **vendu** ; **expédition** → achat de l'**étiquette réelle** ShipEngine + numéro de suivi → **`label_created`** (crédit vendeur **seulement après** l'étiquette ; rattrapage `sweepPendingLabels`) ; **notifie le vendeur** ; **idempotence** (rejeux sans effet ; paiement sur commande annulée → **remboursement auto**).

> Notifications push selon permissions/jetons ; sur iOS la livraison push peut être limitée ; le statut reste consultable dans l'app (source de vérité).

### 6.10 La page de succès

`/checkout/success` : titre « Meetup confirmé » / « Paiement confirmé » ; message adapté ; carte récapitulative (frais de service, livraison, total pour l'expédition ; badge MEETUP/EXPÉDITION) ; boutons « CONTACTER LE VENDEUR » (meetup) ou « VOIR MA COMMANDE » (expédition) + « Retour à l'accueil ».

### 6.11 Reprendre un paiement en attente

`/payment/[transactionId]` : recharge, vérifie acheteur + statut `pending_payment` ; récap + adresse + option wallet + réassurance (« Paiement sécurisé par Stripe »); relance la feuille Stripe ; mention CGV. Aussi emprunté depuis « Mes commandes ».

### 6.12 Suivi des commandes (acheteur et vendeur)

| Statut | Côté acheteur | Côté vendeur |
|---|---|---|
| `pending_payment` | Paiement en attente | Paiement en attente |
| `meetup_pending` | Rencontre à confirmer | Rencontre à confirmer |
| `meetup_confirmed` | Rencontre confirmée | Rencontre confirmée |
| `meetup_completed` | Réglée en main propre | Réglée en main propre |
| `paid` | Payée — en préparation | **À expédier** |
| `label_created` | Étiquette prête | Étiquette créée — déposez le colis |
| `shipped` | En acheminement | Colis expédié |
| `delivered` | Livrée (fonds protégés) | Livrée (fonds disponibles le …) |
| `completed` | Vente finalisée | Vente finalisée (montant au porte-monnaie) |
| `return_requested` | Retour demandé | Retour en cours |
| `delivery_failed` | Problème de livraison (gelé) | Problème de livraison (gelé) |
| `lost` | Colis égaré (gelé) | Colis égaré (gelé) |
| `disputed` | Litige en cours | Litige en cours |
| `refund_in_progress` | Remboursement en cours | Remboursement en cours |
| `refunded` | Remboursée | Remboursée |
| `cancelled` | Annulée | Annulée |

**Acheteur (`/my-orders`) :** liste (image, titre, total, statut, date) ; toucher → paiement si `pending_payment`, sinon conversation/fiche ; **laisser un avis** si `delivered`/`meetup_completed` non encore évalué. **Vendeur (`/my-sales`) :** libellés vendeur, suivi, conversation, avis sur l'acheteur après finalisation.

**Protection des fonds (expédition) :** après livraison, fonds vendeur **gelés 7 jours** (fenêtre de litige) ; finalisation au terme du délai. Une commande active **bloque la suppression du compte**.

### 6.13 Spécificités Canada & plateforme

CAD partout ; adresses **canadiennes** uniquement (13 provinces, `A1A 1A1`, validés serveur) ; transporteurs Postes Canada / Intelcom via ShipEngine (jours ouvrables) ; **Stripe Connect Custom** (transit 5 + institution 3 + compte) ; vendeur **18 ans min** et compte **actif** pour vendre en expédition. **iOS/Android :** Apple Pay / Google Pay auto si configurés ; push selon permissions (suivi toujours dans l'app). **Loi 25 :** données bancaires acheteur ne transitent jamais par Second ; `clientSecret` jamais stocké. **Sécurité financière :** aucun statut sensible ni mutation financière écrit par le client.

---

## 07. Offres & négociation

L'acheteur peut **proposer son prix** plutôt que payer le prix affiché, puis **négocier** dans la messagerie.

> Aujourd'hui : **meetup uniquement**. La livraison (« shipping ») existe mais est **désactivée** (`SHIPPING_ENABLED = false`). Le paiement d'une offre se fait **en main propre**.

### 7.1 À quoi sert une offre

Action **« Faire une offre »** sur la fiche. Offre = **montant** (CAD) + **message optionnel** + (meetup) **lieu**. Apparaît comme une **bulle spéciale** dans la conversation. Le vendeur peut **accepter**, **refuser** ou **contre-proposer**. Tant qu'elle n'est pas acceptée, rien n'est réservé ni payé.

### 7.2 Où se déclenche une offre

Deux points d'entrée (fiche article ou barre du chat) → même formulaire (bottom sheet multi-étapes). **Garde-fous :** article vendu/désactivé → bloqué ; **une offre déjà en attente** de cet acheteur → bloqué ; pas d'offre sur son propre article.

### 7.3 Le formulaire d'offre

Meetup = **3 étapes** ; livraison (inactif) = **2** (lieu sauté).

**Étape 1 — Montant + message :** rappel titre/prix ; saisie « Votre offre » ; **% de réduction** affiché (orange si > 50 %) ; message ≤ 500 car. **Validations :** vide/nul/négatif → erreur ; **< 30 % du prix** → alerte « Offre trop basse » mais **« Continuer quand même »** (non bloquant).

**Étape 2 (meetup) — Lieu :** (1) choisir un **quartier** (Montréal ; « Zone du vendeur » badge **RECOMMANDÉ**) ; (2) **lieu précis** (lieux publics par catégorie ; lieux préférés du vendeur badge **SUGGÉRÉ**) ; (3) **lieu personnalisé** possible. Pas de date/heure à ce stade (convenue ensuite). Privilégie les **lieux publics fréquentés**.

**Étape 3 — Récapitulatif :** montant, titre, message, lieu, « Montant à payer », mention **« Aucun frais de service — paiement en main propre »**, encart « Comment ça marche ? » + **expiration 48 h**. « Envoyer l'offre ».

### 7.4 La bulle d'offre dans la conversation

En-tête « VOTRE OFFRE » / « OFFRE REÇUE » ; badge « Meetup » + carte lieu ; montant ; message ; **badge de statut** + **compte à rebours** ; boutons selon statut/rôle. Chaque offre/contre-offre = nouvelle bulle ; **message système** inséré à chaque étape.

### 7.5 Statuts d'une offre

| Statut | Sens |
|---|---|
| `pending` | En attente + compte à rebours |
| `accepted` | Acceptée (vert) |
| `rejected` | Refusée (rouge) |
| `counter_price` | Contre-offre de prix |
| `counter_location` | Autre lieu proposé |
| `counter_time` | Autre horaire proposé |
| `expired` | Expirée (48 h) |
| `completed` | Terminée (meetup complété) |

**Contre-offre :** l'offre d'origine est « consommée » (`counter_*`) et une **nouvelle bulle `pending`** est créée → toujours **au plus une offre active**.

### 7.6 Répondre à une offre

Boutons seulement pour la **partie non-auteur** et tant que `pending`. **Accepter** : confirmation ; vérif expiration ; → `accepted` + message système ; en meetup, transaction créée si absente (article réservé). **Refuser** : → `rejected` ; **nettoyage** (transaction meetup annulée → article remis en vente). **Contre-proposer** : prix (sans meetup) ou menu prix/lieu/horaire (meetup) ; chaque contre-offre hérite des autres caractéristiques, conserve l'**historique**, relance **48 h**. Aller-retours **illimités**.

### 7.7 Expiration des offres (48 h)

Date limite 48 h. **Affichage** : compte à rebours puis « Expirée ». **Serveur (source de vérité)** : tâche **toutes les heures** bascule en `expired`. **Garde-fou à l'action** : impossible d'accepter/contrer une offre expirée. Pour relancer : refaire une offre.

### 7.8 De l'offre acceptée au règlement

**Meetup (actif) :** offre `accepted` → transaction en place, article réservé ; rendez-vous convenu ; **vendeur confirme** (peut signaler une absence) ; **acheteur clôt** → « Terminée ». **Aucun frais** (paiement main propre). Double confirmation = garde-fou anti-litige.

**Livraison (inactif) :** bouton « Payer maintenant » → écran de paiement ou tunnel checkout. Non proposé tant que `SHIPPING_ENABLED = false`.

### 7.9 Données clés d'une offre

Montant (et total avec livraison pour les offres historiques), statut, message, détails meetup (lieu, qui a proposé, date de confirmation, date de complétion, signalement d'absence), date d'expiration, **historique de négociation**, identifiants de chaînage. Un **score de fiabilité meetup** par utilisateur (réalisés, complétés, no-shows, annulations) est maintenu en arrière-plan.

### 7.10 Spécificités Canada

CAD (suffixe « $ », FR-CA) ; lieux de meetup centrés sur les **quartiers de Montréal** ; contre-offres d'horaire au format **« AAAA-MM-JJ HH:MM »** ; **Loi 25** : annulations/expirations automatiques encadrées par un bloc de transparence + droit de contestation.

### 7.11 Différences iOS / Android

Fonctionnellement **identiques**. Différences d'ergonomie : gestion clavier (Android redimensionne) ; retours haptiques (plus riches sur iOS) ; alertes natives (présentation différente). **Limite :** pas de notification push dédiée à une nouvelle offre dans ce périmètre — le destinataire découvre l'offre **en ouvrant la conversation** (d'où l'importance des 48 h).

### 7.12 Résumé des règles

Offre = montant + message (+ lieu meetup), pas un achat tant que non acceptée ; pas d'offre sur article vendu/retiré ni sur son propre article ; **une seule offre en attente** par acheteur/article ; garde « offre trop basse » < 30 % (non bloquant) ; accepter/refuser/contre-proposer (aller-retours illimités) ; **expiration 48 h** (serveur horaire) ; meetup = règlement main propre, zéro frais, double confirmation, refus = remise en vente ; livraison **prévue mais désactivée**.

---

## 08. Livraison & suivi de colis

De l'achat jusqu'à la libération des fonds, lorsque l'acheteur choisit la **livraison par transporteur**. Tout repose sur **ShipEngine** (Intelcom/Dragonfly, Postes Canada, UPS Canada). CAD, adresses canadiennes uniquement.

### 8.1 Vue d'ensemble du parcours

```
Achat → Estimation tarif (ShipEngine) → Paiement
  → Achat de l'étiquette → "Étiquette créée" (déposer le colis)
  → 1er scan → "Expédié" → scan "Livré" → séquestre 7 jours
  → 7 jours sans litige → fonds libérés au vendeur
```

Deux principes : (1) **l'argent ne se débloque jamais sur parole** (vendeur crédité seulement à l'étiquette réelle ; retirable après livraison + **7 jours**) ; (2) **« le scan livré fait foi »** — pas de bouton « confirmer réception » pour les commandes expédiées.

### 8.2 Avant le paiement : estimation et adresse

`getShippingEstimate` (jusqu'à **5 tarifs** triés, moins cher présélectionné).

| Règle | Comportement |
|---|---|
| Adresses canadiennes valides | Estimation **refusée** si adresse vendeur/acheteur incomplète ; pas de repli fictif |
| Tarif de repli (fallback) | Si ShipEngine injoignable, 2 tarifs **indicatifs** ; **n'achète pas de vraie étiquette** → paiement bloqué |
| Tarif jamais « de confiance » côté client | Le serveur re-cote au moment de la commande et utilise **son** prix |

**Points relais (PUDO) :** `findPickupPoints` existe (rayon 10 km) et le modèle distingue `home`/`pickup_point`, mais **toutes les estimations à l'achat sont « domicile »** — la capacité PUDO existe mais n'est pas exposée. Un écran préférences vendeur (Options de livraison) liste les modes acceptés (préférence de profil, distincte des tarifs réels).

### 8.3 Création de la commande et conditions vendeur

`createTransaction` vérifie, avant tout débit : compte **Stripe Connect actif** (`stripeChargesEnabled = true`, pas de création à la volée) ; adresse vendeur **réelle** ; `rateId` présent et non fallback. Si valide : article vendu, commande `pending_payment` (montant article, frais de livraison re-cotés, frais de service, total, adresse acheteur). **L'acheteur paie la livraison** ; la plateforme achète l'étiquette puis **rapproche** le coût réel.

### 8.4 Achat de l'étiquette et statut « Étiquette créée »

L'étiquette est achetée **après l'encaissement** (webhook Stripe ou paiement wallet) — **on ne crée pas l'étiquette avant d'avoir l'argent**. `createLabel`, opération atomique : **crédite le vendeur** (`pendingBalance`, crédit différé) ; enregistre suivi (numéro, PDF, URL publique, transporteur) ; passe à **`label_created`** (et non « Expédié »). L'acheteur voit « l'étiquette est prête, le colis va être déposé » ; le vendeur télécharge l'étiquette (PDF 4×6).

**Non-idempotence :** ShipEngine ne supporte pas de clé d'idempotence ici → **aucune tentative automatique** (`allowRetry = false`) ; rattrapage par balayage dédié (8.8).

### 8.5 Rapprochement du coût réel de livraison

Comparaison **coût réel** ShipEngine vs **tarif estimé** facturé (`actualShippingCost`, `shippingCostDelta`). Petits écarts absorbés par les frais ; écart **> 2 $** journalisé comme **anomalie critique** (`platform_ledger`, `shipping_cost_variance`).

### 8.6 Suivi du colis : machine à états et deux canaux

Machine à états unique (`applyTrackingOutcome`) :

```
paid → label_created → (1er scan) → shipped → (scan "livré") → delivered (séquestre 7 j)
       shipped/label_created → (échec/exception) → delivery_failed (gelé)
```

| Statut interne | Affichage | Effet |
|---|---|---|
| `LABEL_CREATED` | Étiquette créée | Attente du dépôt |
| `TRANSIT` / `IN_TRANSIT` | En transit | 1er scan → « Expédié » |
| `OUT_FOR_DELIVERY` | En cours de livraison | Affichage |
| `DELIVERED` | Livré | Séquestre 7 jours |
| `FAILURE` / `EXCEPTION` | Problème de livraison | Gèle les fonds, ouvre le recours |

**Deux canaux :** (1) **webhook ShipEngine** (temps réel ; protégé par **secret partagé** comparé en temps constant ; 401 si invalide, fermé si non configuré ; idempotent) ; (2) **sondage planifié** (`checkShippedTracking`, **toutes les 12 h**, lots jusqu'à 600) ; (3) **rafraîchissement manuel** (`checkTrackingStatus`, réservé acheteur/vendeur, désactivé après livraison). **Relance « étiquette dormante »** : aucun scan pendant **3 jours** → rappel au vendeur (non spammant).

### 8.7 Livraison confirmée et libération des fonds (séquestre 7 jours)

Scan **« Livré »** (atomique, idempotent) : → **`delivered`** + `deliveredAt` ; fonds `pendingBalance` → **`heldBalance`** ; **date de libération = livraison + 7 jours** (`fundsReleaseAt`) ; notif acheteur + message système.

| Poche | Signification |
|---|---|
| `pendingBalance` | Payée, pas encore livrée |
| `heldBalance` | Livrée, fenêtre 7 jours |
| `balance` | Disponible (retirable) |

**Libération auto** (`releaseHeldFunds`, **toutes les heures**) : commandes `delivered` échues **sans litige** → `heldBalance` → `balance`, → `completed`, notif vendeur. **Décision automatisée Loi 25 (art. 12.1)** : journalisée, **expliquée** (« Pourquoi cette décision ? »), **contestable** (révision humaine, sans rien annuler). Jamais déclenchée si `disputed`/`delivery_failed`/`lost`/`refunded` ; ré-vérifiée atomiquement ; idempotente.

### 8.8 Échecs et relances de l'étiquette

Paiement réussi mais étiquette impossible → `labelCreationPending = true`, statut reste `paid` (acheteur débité, **vendeur non crédité**). `sweepPendingLabels` (**toutes les heures**, jusqu'à 50) : (1) **re-cote un tarif neuf** ; (2) réessaie l'achat (succès → crédite, rapproche, enregistre, `label_created`, message système) ; (3) compte les tentatives — après **4 échecs**, commande **annulée + acheteur intégralement remboursé** (remboursement Stripe idempotent + re-crédit wallet), article **remis en vente**, acheteur notifié. **Décision automatisée Loi 25** journalisée et contestable.

### 8.9 Problème de livraison, colis perdu et recours acheteur

Échec/exception → **`delivery_failed`**, fenêtre de litige (`disputed = true`, **fonds gelés**), notif des deux parties. Fonds **jamais** libérés sur échec.

| État | Options acheteur |
|---|---|
| `delivery_failed` / `lost` | « Signaler un problème » **ou** « Demander un remboursement » (auto réservé aux colis perdus/échoués) |
| `shipped` / `delivered` | « Signaler un problème » (examen équipe ≤ 48 h, fonds protégés) |
| `delivered` | « Demander un retour » (8.10) |

Remboursement auto sur un colis **livré** refusé → réorientation vers « Signaler un problème ».

### 8.10 Retour d'article et remboursement à réception (anti-fraude)

Sur commande **livrée** : « demander un retour » (`requestReturn`) → **étiquette de retour** achetée (acheteur → vendeur), fonds **gelés**, `return_requested`, vendeur notifié. **Règle anti-fraude :** remboursement **jamais** sur parole — seulement quand le **transporteur confirme « livré » sur le colis de retour** (vendeur a récupéré l'article). À ce moment : acheteur remboursé du **total moins le coût de l'étiquette de retour** (**frais de retour à sa charge**), vendeur débité, → `refunded`, notifications. Idempotent. Article **pas remis en vente automatiquement**.

### 8.11 Données clés de la commande

`status`, `trackingStatus`, `trackingNumber`/`trackingUrl`, `shippingLabelUrl` (PDF 4×6), `carrierCode` (`intelcom_ca`, `canada_post`, `ups_ca`), `shippingCost`/`actualShippingCost`/`shippingCostDelta`, `labelCreatedAt`/`shippedAt`/`deliveredAt`, `fundsReleaseAt`/`fundsReleasedAt`, `labelCreationPending`/`labelAttempts`, `returnTrackingNumber`/`returnLabelUrl`/`returnLabelCost`.

### 8.12 Spécificités Canada et iOS / Android

**Canada :** CAD ; adresses/codes postaux **canadiens uniquement** (13 provinces) ; Intelcom (Dragonfly), Postes Canada, UPS Canada (défaut `intelcom_ca`) ; **Loi 25** : décisions automatiques (libération 7 j, annulation/remboursement après échec) journalisées, expliquées, contestables (y compris meetups touchés par une décision auto).

**iOS vs Android :** notifications de livraison en **push via FCM** ; **limite iOS** : jetons **APNs bruts détectés et ignorés** → certains iOS peuvent **ne pas recevoir** ces push ; suivi **toujours consultable in-app** (l'écran et le « rafraîchir » ne dépendent pas du push). Canaux Android dédiés.

### 8.13 Limites connues

PUDO non exposés à l'achat (tout en « domicile ») ; pas de confirmation manuelle de réception (scan transporteur) ; achat d'étiquette non idempotent (rattrapage horaire seul) ; push iOS (dépend d'un vrai jeton FCM).

---

## 09. Remise en main propre (meetup)

Mode où acheteur et vendeur se rencontrent et **règlent en argent comptant, directement entre eux**. **Aucun argent ne transite par la plateforme** : ni Stripe, ni séquestre, ni remboursement automatique, ni écriture au portefeuille. Conséquence : **le meetup est gratuit pour les deux parties** (aucuns frais, aucune commission).

### 9.1 Vue d'ensemble du parcours

| Étape | Statut | Qui | Quoi |
|---|---|---|---|
| 1. Demande | `meetup_pending` | Acheteur | Choisit un lieu ; article réservé (vendu) |
| 2. Confirmation | `meetup_confirmed` | Vendeur | Confirme le rendez-vous |
| 3. Finalisation | `meetup_completed` | Acheteur **ou** vendeur | Confirme l'échange. État terminal positif |
| 3 bis. Incident | `disputed` / `cancelled` | Système / partie | No-show → litige ; expiration → annulation |

Coordination (où/quand) **par messagerie**. La transaction = squelette d'état ; le chat = la conversation.

### 9.2 Point de départ : choisir un lieu

**A. Écran « Lieu de rencontre » (`/checkout/meetup.tsx`)** : récap article (prix négocié + badge « PRIX NÉGOCIÉ » le cas échéant, badge « MEETUP ») ; lieux suggérés par le vendeur ; option **« À convenir par messagerie »** (toujours sélectionnable) ; présélection 1er lieu ou « à convenir ». **B. Offre de meetup depuis le chat** (montant + lieu) → bulle interactive (`OfferBubble`).

**Garde-fous à l'entrée :** non connecté → accueil ; article introuvable/vendu → blocage ; pas d'achat de son propre article ; blocage mutuel → blocage.

### 9.3 Confirmation acheteur → création de la transaction

(1) vérif blocage ; (2) création/récupération du chat ; (3) `createTransaction` (`deliveryType = 'meetup'`) ; (4) offre de meetup structurée (lieu « À convenir » si choisi) ; (5) rafraîchissement accueil ; (6) écran de succès.

**Serveur (`createTransaction`)** atomique (`runTransaction`) — **un seul acheteur** réserve un article : article existe/non vendu/actif ; acheteur ≠ vendeur ; **contrôle du montant** (prix affiché ou négocié adossé à une offre acceptée ; montant supérieur rejeté) ; **n'exige PAS** de compte Stripe vendeur (aucun argent ne passe). À la création : article **vendu** ; statut `meetup_pending` ; **`serviceFee = 0`, `shippingCost = 0`, `totalAmount = montant convenu`** (`sellerPayout` sans portée financière) ; lieu enregistré (champs vides nettoyés) ; lien au chat.

### 9.4 Confirmation vendeur (`meetup_pending` → `meetup_confirmed`)

Depuis la bulle d'offre. Pose `confirmedAt` ; transaction → `meetup_confirmed` ; message système (lieu + date/heure FR-CA, ex. « le 12/06/2026 à 14:30 », ou « à une date à convenir »). **Règle de sécurité Firestore : transition réservée au vendeur** (`sellerId`). Si le vendeur **refuse** → annulation (`cancelled`) + article relibéré.

### 9.5 Finalisation (`meetup_confirmed` → `meetup_completed`)

État terminal positif qui **débloque l'avis**. **`completeMeetupTransaction`** autorise **acheteur OU vendeur** (pour éviter une « transaction zombie » si l'un disparaît) : vérifie que l'appelant est partie ; statut `meetup_confirmed` ; → `meetup_completed` (+ `completedAt`, `meetupCompletedAt`, `meetupCompletedBy`) ; **aucun crédit, aucun ledger** ; message système (« paiement réglé en main propre »). Boutons contextuels (vendeur confirme ; acheteur « Terminer la transaction »).

### 9.6 No-show

**`reportMeetupNoShow`** (avec effet) : appelant = partie ; transaction meetup encore ouverte (`meetup_pending`/`meetup_confirmed`) ; motifs (`other_party_no_show`, `cancelled_last_minute`, `unsafe_situation`, `other`) + détails (1000 car.). Effets atomiques : **gel** (`disputed`, mémorise `statusBeforeDispute`) ; **libération de l'article** (`isSold = false`) ; **dossier de litige** (`meetup_no_show`, qui signale qui) ; **notification** à la personne visée (contestable) ; signal au tableau de modération.

**Limite produit :** le chat câble aujourd'hui le **signalement « cosmétique »** (`ChatService.reportNoShow`) qui **ne déclenche PAS** la Cloud Function : il alerte verbalement mais ne gèle pas, ne libère pas l'article, n'ouvre pas de litige. La logique serveur existe et est déployable mais n'est pas branchée. Le déblocage repose alors sur l'**expiration automatique** (9.7) ou un traitement manuel.

### 9.7 Expiration automatique (anti-blocage)

`scheduled/transactionExpiration.ts` (**toutes les heures**). **Aucun remboursement, aucun impact portefeuille** (cash).

| Cas | Condition | Délai | Action |
|---|---|---|---|
| Jamais confirmé | `meetup_pending` | **48 h** | `cancelled` (`meetup_expired_48h`) + article libéré ; **acheteur** notifié |
| Confirmé jamais finalisé | `meetup_confirmed` | **7 jours** | `cancelled` (`meetup_confirmed_expired_7d`) + article libéré ; **deux parties** notifiées |

Branche `meetup_confirmed` re-vérifiée sous verrou (idempotente). Chaque expiration **journalisée comme décision automatisée Loi 25** + notification (automatique et contestable).

### 9.8 Spécificités Canada

CAD (paiement cash CAD, hors plateforme) ; points de rencontre par quartier/arrondissement (lieux publics fréquentés) ; **Loi 25** : annulations automatiques journalisées + notifiées + contestables ; litige no-show avec droit de réponse de la partie visée.

### 9.9 Spécificités iOS / Android

Parcours **identique**. Notifications push selon autorisations (iOS exige consentement ; **best-effort**, n'empêchent jamais l'action métier). Bottom sheets montés à l'ouverture (anti-voile Android).

### 9.10 Récapitulatif des règles

Meetup = paiement comptant, **0 $ de frais**, aucun argent via la plateforme, aucun remboursement ; article réservé dès la demande, relibéré en cas de refus/no-show traité/expiration ; réservation **atomique** (un seul gagnant) ; **n'exige pas** de compte Stripe ; `meetup_pending → meetup_confirmed` **vendeur uniquement** ; `meetup_confirmed → meetup_completed` **acheteur ou vendeur** ; finalisation **débloque l'avis** ; **limite** : bouton no-show du chat cosmétique (déblocage via expiration) ; **Loi 25** : décisions auto journalisées/notifiées/contestables.

---

## 10. Avis & réputation après-vente

Chaque partie d'une transaction terminée (acheteur **et** vendeur) note l'autre. Mécanisme central de **confiance**.

### 10.1 Vue d'ensemble

L'avis évalue **l'autre personne** (pas l'article), **bidirectionnel** (un avis par personne et par transaction), **trois natures** : `achat`, `vente`, `swap`. Composition : **note 1-5** (obligatoire) + **commentaire** (FR). Stocké dans `avis` (auteur figé, personne notée, transaction, type, note, texte, titre article, date). **Sécurité :** création **obligatoirement** via `createReview` (aucune écriture client) ; lecture ouverte à tout connecté.

### 10.2 Points d'entrée

| Écran | Qui | Type |
|---|---|---|
| **Mes commandes** | acheteur | `achat` |
| **Mes ventes** | vendeur | `vente` |

Bouton « Laisser un avis » si **éligible**, remplacé par « Avis laissé » sinon (vérification par identifiant déterministe).

### 10.3 Conditions d'éligibilité

Toutes requises (vérif côté app puis **autoritaire serveur**) : (1) connecté ; (2) transaction **terminée** (`delivered` ou `meetup_completed`) ; (3) auteur **partie** ; (4) cible = l'autre partie ; (5) pas d'auto-évaluation ; (6) **fenêtre 60 jours** ; (7) **unicité**.

### 10.4 Parcours pas à pas

Depuis Mes commandes/ventes → écran d'avis (aperçu article + nom de l'autre). **Note (obligatoire)** : 1 = Mauvais, 2 = Décevant, 3 = Correct, 4 = Bien, 5 = Excellent. **Commentaire** ≤ 2000 car. Envoi : note absente → « Note requise » ; commentaire < 5 car. → « trop court » ; **si vide → texte par défaut « Bonne transaction. »** (un avis n'est jamais vide). Confirmation + recalcul réputation + notification. Anti-double-envoi (verrou local + unicité serveur).

### 10.5 Règles serveur

`createReview` : champs requis ; note 1-5 ; **texte 5–2000** ; **filtre anti-grossièretés FR** (mots-clés basique) ; éligibilité. **Unicité** : identifiant **déterministe** `{auteur}_{transaction}` + transaction atomique (deux envois → un seul réussit ; « already-exists » sinon). **Contenu figé** : nom/photo de l'auteur et titre de l'article copiés à la création (jamais réécrits).

### 10.6 Propagation aux statistiques

Recalcul de la cible : **`rating`** (moyenne arrondie à une décimale) et **`reviewCount`**. Recalcul **complet** (pas incrémental) ; `vente`/`achat`/`swap` **mélangés** en une seule note globale. **Non bloquant** (cohérence rétablie au prochain avis).

### 10.7 Notification à la personne notée

« Nouvel avis reçu » / « {nom} vous a laissé un avis {note}/5 » (type `review_received`). **In-app toujours créée** (même push coupé) ; push **non critique**. **Limite iOS** : jetons APNs bruts ignorés → **push non fiable sur iOS** ; in-app présente ; **Android fiable** (canal dédié).

### 10.8 Cas particulier : avis d'échange (SwapZone)

`rateSwap` : éligible si swap `completed` et appelant participant ; score 1-5, commentaire **facultatif** (peut rester vide) ; un avis par participant/échange (`{participant}_swap_{échange}`) ; type `swap`, même collection, même recalcul + notification.

### 10.9 Affichage sur le profil

Profil public (`/user/{id}`) : note moyenne + nombre d'avis ; liste (auteur figé, étoiles, texte, date ; résumé 10 récents, pagination par 20 jusqu'à 100/appel) ; **compteurs pré-calculés** (`reviewCount`, `rating`) ; photo masquée si préférence ; lecture nécessite connexion (via fonction serveur de profil public, jamais lecture directe de `avis`).

### 10.10 États & règles — récapitulatif

| Élément | Règle |
|---|---|
| Statut requis | `delivered` ou `meetup_completed` |
| Délai | 60 jours |
| Note | 1-5 obligatoire |
| Commentaire | 5-2000 ; défaut « Bonne transaction. » (transactionnel) |
| Filtre | Liste FR basique |
| Unicité | 1 par auteur/transaction |
| Bidirectionnel | Oui |
| Auto-évaluation | Interdite |
| Création / lecture | Serveur uniquement / tout connecté |
| Modification / suppression | **Impossible** (avis définitif et figé) |
| Effet | Recalcul complet note + compteur |
| Notification | In-app toujours + push (Android fiable, iOS non) |

### 10.11 Spécificités Canada & plateformes

FR uniquement ; **Loi 25** : avis contiennent nom + photo figés (renseignements personnels publics) ; un avis publié est **définitif et non modifiable/supprimable** (point de gouvernance ; la suppression de compte ne réécrit pas les avis laissés sur autrui). Push fiable Android / non iOS ; in-app sur les deux. **Aucune dimension monétaire** : gratuit, aucun mouvement financier.

---

## 11. Recours, litiges, remboursements & annulations

Tout ce que Second met à disposition quand une transaction se passe mal.

### 11.0 Principe directeur : anti-fraude, jamais sur parole

**Second ne rembourse jamais sur la seule parole de l'acheteur.** Remboursement automatique seulement sur **signal objectif du transporteur** : colis **perdu**/**en échec**, ou retour **réceptionné par le vendeur**. Tout le reste (« reçu mais problème ») = **réclamation** qui gèle les fonds et passe en **revue humaine**. CAD ; remboursements carte via Stripe, part wallet re-créditée au wallet.

### 11.1 Les trois recours de l'acheteur

| Recours | Quand | Effet | Argent ? |
|---|---|---|---|
| **Remboursement auto** | `lost`, `delivery_failed` | Remboursement immédiat, article non remis en vente | Oui, auto |
| **Signaler un problème** | Expédiée/livrée/complétée | Gèle les fonds, ouvre une réclamation (revue humaine) | Non |
| **Demander un retour** | Livrée, expédition, ≤ 7 jours | Étiquette de retour, fonds gelés | Plus tard, à réception |

**A. Remboursement auto** : statut `delivery_failed`/`lost` ; réservé acheteur, 5/min ; → `refund_in_progress` puis `refunded` (carte via Stripe avec `reverse_transfer`, wallet re-crédité, vendeur débité) ; **article PAS remis en vente** ; notifications ; **idempotent** (échec Stripe → état restauré + file de re-jeu).

**B. Signaler un problème** : `shipped`/`delivered`/`completed` ; motifs (jamais reçu malgré scan, non conforme, endommagé, autre) + texte (1000 car.) ; **aucun mouvement d'argent**, `disputed`, fonds **gelés**, fiche `disputes` ouverte ; une seule réclamation à la fois ; **résolution = décision humaine admin** (11.4).

**C. Demander un retour** : `delivered` + **expédition** + **fenêtre 7 jours** (fonds non encore libérés) ; motifs ; **étiquette de retour achetée** (acheteur → vendeur), `return_requested`, fonds gelés, **aucun remboursement à ce stade** ; **frais de retour à la charge de l'acheteur** (déduits du remboursement) ; remboursement **seulement quand le transporteur confirme « livré » au vendeur** (`total − coût étiquette retour`, vendeur débité, article pas remis en vente auto, notifications) ; idempotent, 3/min.

### 11.2 La sélection du motif (écran commun)

Panneau (bottom sheet) : titre/intro contextuels, motifs FR (radio), champ libre (« Signaler un problème »), encart frais de retour (« Demander un retour »), validation désactivée tant qu'aucun motif. Contenu monté **à l'ouverture** (anti-voile Android), identique iOS/Android.

### 11.3 La fenêtre de protection de 7 jours (escrow)

Trois poches : `pendingBalance` (payée, pas livrée), `heldBalance` (livrée, 7 j), `balance` (disponible). Cycle : paiement → pending ; livraison → held (+ échéance livraison + 7 j) ; 7 j sans litige → balance + `completed`. **Blocage en litige** : `releaseHeldFunds` ne libère **jamais** `disputed`/`delivery_failed`/`lost`/`refunded` ni `disputed = true`. **Loi 25 :** libération = décision automatisée journalisée + notif (automatique, contestable). **Contestation (art. 12.1)** : encart « Contester cette décision » → **révision humaine** (accessible aussi pour les meetups).

### 11.4 Remboursement décidé par l'admin

Fonction admin (claim `admin` / `isAdmin`). Statuts remboursables : `paid`, `label_created`, `shipped`, `delivered`, `delivery_failed`, `lost`, `disputed`, `return_requested`. Effet : remboursement complet (moteur partagé), débit vendeur, et — **par défaut remise en vente** (contrairement à perdu/retour). Idempotente.

### 11.5 Mécanique du remboursement (carte + wallet + dette vendeur)

**Moteur unique** partagé : (1) **part carte** via Stripe **hors** transaction Firestore, **clé d'idempotence déterministe** ; pour les paiements destination → `reverse_transfer` + `refund_application_fee` ; (2) **réconciliation atomique** : re-crédit wallet acheteur (ledger) ; **débit vendeur exact** dans l'ordre `pendingBalance` → `heldBalance` → `balance` ; manque → **dette vendeur** (`sellerDebt`) ; remise en vente **seulement si demandé**. **Remboursements partiels** (retour) : montant carte précis plafonné, reste sur wallet. **Canada :** CAD ; commission vendeur de fait nulle.

### 11.6 Annulation d'une transaction en attente

**Par l'utilisateur** : acheteur **ou** vendeur ; statuts `pending`, `pending_payment`, `meetup_pending`, `meetup_confirmed` ; → `cancelled`, article remis en vente, part wallet re-créditée ; 20/min.

**Expiration automatique** (job horaire) :

| Cas | Délai | Effet |
|---|---|---|
| Meetup non confirmé | 48 h | Annulée, article libéré. Aucun argent |
| Meetup confirmé jamais finalisé | 7 jours | Annulée, article libéré. Aucun argent |
| Paiement non payé | 1 h | Annulée, article libéré (garde-fou ci-dessous) |
| Payée jamais expédiée | 7 jours | **Remboursement** acheteur + notif |

**Garde-fou « paiement en vol »** : avant d'expirer un `pending_payment`, vérification de l'état Stripe (`requires_capture`/`processing`/`succeeded` → **non annulée**). **Reprise des remboursements interrompus** (`refund_in_progress`) sans double-remboursement.

**Swap** : un swap en `payment_pending` (complément jamais payé) → `cancelled` **sans remboursement** ; un swap payé bascule dans les recours standards.

### 11.7 Filet de sécurité financier : re-jeu et réconciliation

**Re-jeu (dead-letter)** : opération financière échouée → file `failed_operations` ; job **toutes les 30 min** réessaie avec **même clé d'idempotence** ; **backoff exponentiel** (30 min → 8 h) ; après **6 tentatives** → `exhausted` + escalade humaine (« CRITICAL »). Types : remboursements, inversion de transfert, annulation de virement, écart de montant.

**Réconciliation** (job **toutes les 6 h**, **détection seule**) : paiements (commande `pending_payment` mais paiement réussi → log + file) ; retraits (coincé `processing` → marqué/re-crédité) ; soldes (invariants : aucune poche négative). Les webhooks restent le chemin principal.

### 11.8 États liés aux recours

`pending`/`pending_payment` ; `meetup_pending`/`meetup_confirmed` ; `paid` (expire 7 j → remboursement) ; `shipped`/`delivered`/`completed` ; `delivery_failed`/`lost` ; `disputed` ; `return_requested` ; `refund_in_progress` ; `refunded` ; `cancelled`. Champs : `disputed`, `statusBeforeDispute`, `fundsReleaseAt`/`fundsReleasedAt`, `buyerReport`, `returnLabelId`/`returnTrackingNumber`/`returnLabelCost`/`returnReason`, `sellerDebt`, `sellerCreditedCents`.

### 11.9 Spécificités iOS / Android et limites

Bottom sheets montés à l'ouverture (anti-voile Android) ; notifications **best-effort** (la **source de vérité reste l'état de la commande**) ; étiquette de retour ouverte via navigateur/visionneuse ; **aucun passage par un site externe** (white-label).

---

## 12. Porte-monnaie & paiements vendeur

Le vendeur reçoit l'argent de ses ventes, le suit et le transfère vers sa banque — **sans jamais quitter Second ni voir Stripe** (white-label).

### 12.1 Deux briques distinctes

| Brique | Rôle | Écran |
|---|---|---|
| **Compte de paiement** (Stripe Connect Custom) | Identité + compte bancaire ; canal de sortie vers la banque | `settings/stripe-onboarding` |
| **Porte-monnaie** (wallet, registre interne) | Suit gains, en cours, bientôt disponible, retirable — la **source de vérité** des gains | `wallet` |

### 12.2 Accès

Porte-monnaie : onglet Profil + Réglages. Compte de paiement : réglages de paiement (redirection auto si retrait sans compte).

### 12.3 Le compte de paiement vendeur (Stripe Connect Custom, in-app)

**Onboarding (un seul formulaire) :** (1) infos perso (prénom, nom, date de naissance) ; (2) **adresse légale Canada** (rue, ville, province parmi 13, code postal `A1A 1A1`) ; (3) **coordonnées bancaires** (transit **5 chiffres**, institution **3 chiffres**, compte **7-12 chiffres**). Aucun écran Stripe, aucune redirection. Pré-remplissage depuis le profil.

**Règles :** **âge ≥ 18 ans** ; code postal strict ; champs bancaires stricts (transit + institution = routing 8 chiffres) ; pays figé **CA**, devise **CAD**, profil « individu » ; acceptation horodatée + IP enregistrée ; **idempotent**.

**Statuts :** **Actif** (encaisse + retire), **Configuration en cours** (vérification d'identité ; « Actualiser le statut »), **Aucun compte configuré**. Le compte bancaire est **remplaçable** ; versements toujours **manuels** (déclenchés par le retrait du vendeur).

**Impact produit :** vente **avec livraison** impossible si le compte n'est pas **actif** (vérif avant verrouillage de l'article). Vente **meetup** : aucun compte requis.

### 12.4 Le porte-monnaie : modèle à poches

Montants en **cents** (système), affichés « 45,00 $ ».

| Poche | Libellé | Sens | Retirable ? |
|---|---|---|---|
| `balance` | Solde disponible | Libéré, prêt | Oui |
| `pendingBalance` | … en attente | Payée, pas livrée | Non |
| `heldBalance` | … bientôt disponible | Livrée, fenêtre 7 j (date affichée) | Non |
| `sellerDebt` | « Régularisation nécessaire » | Dette après litige perdu / remboursement post-retrait | Bloque tout retrait |

**Cycle de l'argent (livraison) :** paiement → `pendingBalance` ; livraison → `heldBalance` (+ livraison + 7 j) ; 7 j sans litige → `balance` + « complétée ». **Libération auto toutes les heures** (jamais en litige/échec/perdu/remboursé) ; notif (automatique, contestable, Loi 25). **Encart « Protection Seconde »** côté vendeur. **Meetup :** jamais crédité (cash).

### 12.5 Création et activation du porte-monnaie

(1) **Activation explicite** (« Activer mon porte-monnaie », un bouton, soldes à zéro, CAD, idempotent) ; (2) **création auto à la première vente**. Le même porte-monnaie sert aussi **côté acheteur** (paiement total ou complément).

### 12.6 Le retrait (payout) vers la banque

**Garde-fous avant le formulaire :** (1) dette ? → « Retrait indisponible » ; (2) compte de paiement prêt ? → sinon redirection onboarding ; (3) sinon formulaire pré-rempli avec le solde disponible. Confirmation (montant + destination) → « Retrait envoyé » sous **2 à 3 jours ouvrés**.

**Règles :** **minimum 10,00 $** ; entier positif en cents ; **uniquement le `balance`** ; refus si solde insuffisant / wallet inactif ; **litige actif → tous retraits suspendus** ; **dette → suspendus** (ventes futures régularisent en priorité) ; max **5 retraits/min**.

**Coulisses :** (1) porte-monnaie **débité immédiatement** + écriture « Retrait vers compte bancaire ****1234 » + document de suivi « en traitement » ; (2) transfert vers le compte de paiement puis versement banque. **Sécurité financière :** échec bancaire → débit **annulé** (fonds restitués, écriture « Retrait échoué — fonds restitués ») ; cas transfert réussi/versement échoué géré (inversion) ; inversion impossible → file de réessai + vendeur recrédité.

**Statuts :** en traitement / complété (notification de versement payé) / échoué (fonds restitués). Idempotent.

### 12.7 Litiges, remboursements et « dette vendeur »

Litige ouvert → argent **gelé** (remonté en held si déjà disponible) ; **aucun retrait** possible. Litige gagné → cycle normal reprend. Litige perdu (ou remboursement vente 100 % wallet) → vendeur débité **exactement** (`pendingBalance` → `heldBalance` → `balance`) ; manque → **`sellerDebt`** (bloque retraits). Bandeau rouge « Régularisation nécessaire ». La dette est **toujours** enregistrée (jamais masquée).

### 12.8 L'historique des transactions (ledger)

20 dernières écritures (date relative, type, montant signé, description). Types : `sale_credit`, `funds_held`, `funds_released`, `withdrawal`, `withdrawal_failed`, `dispute_hold`, `refund_debit`, `refund_credit` (acheteur), `purchase_debit` (acheteur). Vide : « Aucune transaction pour le moment ».

### 12.9 Monétisation et règle « 0 % vendeur »

Vendeur reçoit **100 %** (aucune commission) ; frais « protection Seconde » **à l'acheteur** : **5 % + 1,50 $, min 2,00 $** ; meetup **aucun frais** (rien ne transite). Plateforme se rémunère côté acheteur. Modèle « boutiques payantes » (3 forfaits) monétise via **réduction des frais acheteur** (0 % vendeur conservé) — voir section 16.

### 12.10 Spécificités Canada

CAD format québécois (« 45,00 $ ») ; compte bancaire canadien (transit 5 + institution 3 + compte 7-12) ; provinces 13 codes, `A1A 1A1` ; **Loi 25** : libération auto = décision automatisée journalisée + notif contestable ; **confidentialité bancaire** : infos jamais stockées sur Second (4 derniers chiffres seuls, « ****1234 »).

### 12.11 Spécificités iOS vs Android

Identique. Différence : **notifications push** best-effort ; **limite iOS** (jetons APNs bruts ignorés → libération de fonds peut ne pas arriver en push). L'info reste **fiable dans l'app** (solde + historique = source de vérité, « tirer pour rafraîchir »). Retrait possible dès fonds disponibles.

### 12.12 Récapitulatif des limites et garde-fous

| Règle | Valeur |
|---|---|
| Retrait minimum | 10,00 $ |
| Source d'un retrait | « Solde disponible » seul |
| Fenêtre de protection | 7 jours |
| Libération auto | Toutes les heures |
| Arrivée en banque | 2 à 3 jours ouvrés |
| Limite de retrait | 5 / min / vendeur |
| Âge compte de paiement | 18 ans |
| Compte requis (livraison / meetup) | Oui (actif) / Non |
| Retrait bloqué si litige / dette | Oui / Oui |
| Commission vendeur | 0 % |
| Frais (acheteur) | 5 % + 1,50 $, min 2,00 $ |

---

## 13. Swap & SwapZone

Le **Swap (troc)** = échange d'articles entre deux membres, alternative à l'achat. Trois surfaces : la **SwapZone** (zone d'échange permanente généraliste), l'écran de **proposition d'échange**, et le **cycle de vie d'un échange**. Modèle **gratuit côté article** ; frais seulement sur un **complément en argent (top-up)**, traité comme un mini-achat.

### 13.1 La SwapZone — zone permanente et généraliste

**Une seule zone, permanente, généraliste, toujours ouverte** (migrée des anciennes « swap-parties » thématiques/éphémères). Pas d'inscription/participants, pas de thème/fenêtre de temps. Objectif : **liquidité** plutôt que FOMO. **Identité visuelle sombre** (unique univers « sombre » de l'app). Zone à identifiant fixe (`generalist`), auto-réparée au 1er accès ; anciennes routes `/swap-parties` redirigent vers `/swap-zone`.

**Accès depuis l'accueil :** bloc sombre « Swap Zone », tagline **« Échange tes pièces, sans frais. »**, deux stats (nombre d'articles, nouveautés cette semaine). Cliquable seulement si la zone existe.

**Écran (`/swap-zone`) :** (1) « Mes pièces » (dépôt « + » toujours visible, invite si déconnecté) ; (2) barre de filtres (Trier, Catégorie, Taille, Couleur, Marque, Matière, État, **côté client**) ; (3) grille des articles des autres (« Articles disponibles · N »).

**Dépôt :** parmi ses articles actifs/non vendus ; vérif serveur (appartenance réelle, actif/non vendu, **anti-doublon**) ; compteur atomique ; retrait optimiste. **Démarrer un échange :** appui simple → proposition pré-remplie ; appui long → **multi-sélection verrouillée sur un seul vendeur**. Contrainte structurante : **un échange = exactement deux personnes**.

### 13.2 Proposer un échange (`/propose-swap`)

Deux blocs : **« Leur article »** (du destinataire) et **« Mon article proposé »**. **Multi-articles des deux côtés**. **Comparaison de valeur** : totaux + indicateur (« Valeurs équivalentes » / « Différence de X $ ») — **indicatif** seulement.

**Complément (top-up) :** sélecteur de payeur (« Je paie » / « {Nom} paie »), montant, bouton « Suggéré : X $ ».

| Règle | Détail |
|---|---|
| Montant | Entier > 0, **plafonné à 5 000 $** |
| Devise | **CAD** (saisi en dollars, converti en cents) |
| Payeur | Initiateur ou destinataire |
| Moment du paiement | **Rien débité à la proposition** (après acceptation) |

**Garde-fous à l'envoi :** ≥ 1 article de chaque côté ; pas d'échange avec soi-même ; pas de blocage mutuel ; tous les articles existent/actifs/non vendus et **appartiennent au bon participant** (invariant fort). Succès → « Proposition envoyée ! » → « Mes échanges ».

### 13.3 États / statuts d'un échange

| Statut | Signification | Par |
|---|---|---|
| `proposed` | En attente de réponse | Initiateur |
| `payment_pending` | Acceptée **avec** complément, en attente paiement | Destinataire |
| `accepted` | Acceptée (sans complément) **ou** complément payé | Destinataire / webhook |
| `declined` | Refusée | Destinataire (ou initiateur tant que `proposed`) |
| `cancelled` | Annulée | Initiateur |
| `photos_pending` | Mode choisi, attente des photos | Participant |
| `shipping` | Photos des deux → en envoi/réception | Système |
| `completed` | Terminé (réception confirmée des deux) | Système |
| `disputed` | Litige | Participant |

Détail (`/swap/[id]`) **temps réel**. **Toutes les transitions sensibles passent par le serveur** (intégrité + sécurité financière).

### 13.4 Cycle de vie pas à pas

**Étape 1 — Réponse :** **Accepter** (destinataire seul, `proposed`) → revérif disponibilité ; sans complément → `accepted` ; avec complément → `payment_pending`. **Refuser** → `declined` (l'un ou l'autre tant que `proposed`). **Annuler** (initiateur) → `cancelled` (tant que `proposed`/`payment_pending`).

**Étape 2 — Paiement du complément :** **payeur seul** voit « Régler le complément ». Mécanique d'achat : frais **5 % + 1,50 $, min 2,00 $**, **0 % vendeur**, PaymentSheet Stripe (white-label). Crédité au bénéficiaire via **ledger** (pas virement direct) ; webhook fait avancer `payment_pending` → `accepted` + crédite `pendingBalance` ; fonds **bloqués** jusqu'à réception. Garde-fou : refus d'initier si le bénéficiaire n'a pas un compte **payouts activés**. **Idempotent**.

**Étape 3 — Mode :** en main propre ou envoi postal → `photos_pending`. **Étape 4 — Photos** : 2 à 4 par participant ; les deux → `shipping`. **Étape 5 — Envoi/réception** : « J'ai envoyé » puis « J'ai reçu » ; les deux → `completed`. Serveur : articles marqués **vendus + inactifs** ; si issu de la zone, marqués « troqués » + compteur ; **complément libéré** (`pendingBalance` → disponible). **Étape 6 — Évaluation** : note 1-5 (commentaire optionnel) → avis type « swap ».

**Litige :** ouvrable pendant `shipping` ou après `completed` (motifs prédéfinis) → `disputed` ; complément non encore libéré **remboursé au payeur** via Stripe ; modération humaine. Porte de sortie « Ouvrir un litige » toujours accessible en `shipping`.

### 13.5 « Mes échanges » (`/my-swaps`)

Onglets : Tous · En attente (`proposed`) · En cours (`payment_pending`/`accepted`/`photos_pending`/`shipping`) · Historique (`completed`/`declined`/`cancelled`). Carte : autre membre, résumé visuel (« +N »), valeurs (« X $ ↔ Y $ »), date relative, pastille de statut. Vide → « Découvrir la Swap Zone ».

### 13.6 Données clés

**Zone** (`swapParties/generalist`) ; **article déposé** (`swapPartyItems` : référence, vendeur, valeur, image, filtres, drapeaux « en attente »/« troqué ») ; **échange** (`swaps` : participants, listes + valeurs, complément cents + payeur, statut, message, mode, photos, horodatages, évaluations, suivi Stripe) ; **avis** (`avis`, type swap).

### 13.7 Spécificités Canada & plateforme

CAD (PaymentIntent en `cad`) ; frais alignés (5 % + 1,50 $, min 2 $ payeur ; 0 % bénéficiaire) ; **Loi 25** : la fiche de proposition affiche une ligne localisation/réputation **codée en dur** (maquette, à corriger avant prod) ; photos 2-4 et PaymentSheet identiques iOS/Android ; bottom sheets montés à l'ouverture (anti-voile Android).

### 13.8 Limites connues / vigilance

- **Affichage du complément en cents bruts** dans certaines vues (ex. « $1000 » au lieu de « 10,00 $ ») — défaut d'**affichage** seul (calcul Stripe correct).
- **Données de profil en dur** dans la fiche de proposition (localisation, distance, note, swaps).
- **Litige** : résolution finale = modération humaine non automatisée (pas de transition de sortie auto de `disputed`).
- **Réception en main propre** : même en main propre, le parcours impose photos + confirmations d'envoi/réception.

---

## 14. Messagerie & modération

Cœur relationnel : négociation, prix, meetup, photos, messages système, sécurité communautaire (signalement/blocage depuis la conversation). FR, CAD, contexte local.

### 14.1 Vue d'ensemble

**Temps réel** (conversations, messages, badge). **Deux niveaux** : liste (onglet Messages) + conversation. **Liée à un article** (barre de contexte ; conversation « générale » possible). **Négociation intégrée** (offre + lieu + contre-offre prix/lieu/horaire). **Messages système** (« Offre acceptée », etc.). **Modération en deux temps** (signaler/bloquer, appliqué **côté serveur**).

### 14.2 Liste des conversations (onglet « Messages »)

États : non connecté (« Connexion requise ») ; chargement (squelettes) ; erreur ; vide ; avec conversations. **Deux onglets** : **VENTES** (utilisateur = `sellerId`) / **ACHATS** (acheteur + conversations générales). Onglet par défaut : VENTES si au moins une vente, sinon ACHATS. **Compteur par onglet** (non-lus). Ligne : avatar + vignette article, nom + titre, aperçu adapté (texte / [Photo] / [Offre] / « ℹ️ … »), horodatage intelligent, pastille non-lus.

**Gestion :** **un seul abonnement temps réel global** (monté une fois) ; tri par dernière activité décroissante ; badge de l'onglet « Messages » = **total** non-lus.

### 14.3 La conversation (écran de chat)

Garde d'accès : invité → redirigé vers Profil. Structure : en-tête (avatar + nom cliquable → profil, prix article, bouton « … » modération) ; **barre de contexte article** ; **bandeau de suivi de transaction** (`ShipmentTracking` si transaction non `pending_payment` ; pour meetup, limité au bloc transparence/contestation Loi 25) ; liste des messages (tri croissant, auto-scroll) ; barre de saisie. **Marquage « lu »** à l'ouverture (remet à zéro le compteur).

Types : texte, photo, **offre** (bulle dédiée), système. **Clavier** : iOS remonte la saisie (padding) ; Android laissé au système.

### 14.4 Barre de contexte article

Photo, titre, prix + bouton « VOIR ». **Prix vivant vs prix figé** (ancien prix barré si différent). « VENDU » superposé / « Article indisponible » grisé. **Propagation automatique** des changements d'article (titre/image/prix) vers les conversations via le déclencheur serveur `onArticleInfoUpdated` (client ne réécrit jamais).

### 14.5 Barre de saisie et envoi

Pièce jointe (photo), champ texte **≤ 1000 caractères**, bouton offre (« $ », si article disponible), bouton envoyer. **Texte** : haptique, création + maj conversation (**incrément atomique** du compteur non-lus). **Photo** : permission galerie, redimensionnée/compressée (1024 px, qualité 70 %) + miniature 200 px, EXIF retiré. **Gardes-fous** : pas de conversation avec soi-même ; vérif blocage avant envoi ; identité expéditeur revérifiée.

### 14.6 Offres dans le chat (négociation)

**Deux modes :** meetup (sans frais) ou livraison (**désactivée** ; offres en meetup en pratique). **Créer :** bouton « $ » ; gardes-fous (article requis/non vendu/actif, **une seule offre en attente**). Modale : montant → (meetup) lieu → confirmation ; rappel « aucun frais » + **expiration 48 h**.

**Contenu :** montant (CAD, borné serveur > 0 et ≤ 50 000 $), statut, détails meetup, historique de négociation, expiration 48 h.

**Statuts :** `pending`, `accepted`, `rejected`, `counter_price`, `counter_location`, `counter_time`, `completed`, `expired`.

**Actions sur une offre reçue :** **Accepter** → `accepted` + message système (+ création transaction meetup si absente, article vendu) ; **Refuser** → `rejected` (annule la transaction meetup → remise en vente) ; **Contre-offrir** (prix/lieu/horaire) → `counter_*` + nouvelle offre (48 h) + message système.

**Cycle meetup :** **Confirmer** (transition réservée au **vendeur**) ; **Signaler une absence** (attaché à l'offre + message système) ; **Compléter** (`completeMeetupTransaction`, crédit vendeur le cas échéant) → `completed`.

**Expiration 48 h :** appliquée à l'action (accepter/contrer une offre dépassée → `expired` + refus).

**Sécurité :** `offer.amount` immuable (règles Firestore) ; seul le **destinataire** accepte/refuse ; mutations financières via fonction serveur.

### 14.7 Messages système et notifications

**Messages système** (offre acceptée/refusée, contre-offres, meetup confirmé, no-show, transaction complétée, étiquette) → fil seulement, **pas de push**.

**Notifications push** (`functions/src/triggers/messages.ts`) : à la création d'un message (`sendMessageNotification` : texte/photo/offre selon type ; système → aucune) ; au changement de statut d'offre (`sendOfferStatusNotification`). Envoyées à **tous les appareils** ; jetons invalides nettoyés. **iOS** : jetons APNs bruts écartés (sans suppression). **Android** : canal « messages » priorité haute + son. Région `northamerica-northeast1`.

### 14.8 Modération : signalement et blocage

**Accès** via « … » (iOS ActionSheet / Android alerte). **Signaler** (`ReportBottomSheet`, 2 étapes) : raison adaptée (utilisateur/message vs article) + détails ; crée un `reports` (statut **`pending`**) ; **lisible seulement par les admins** ; verrouillé (un utilisateur ne peut se faire passer pour modérateur).

**Bloquer** (confirmation + retour hors conversation) — **appliqué côté serveur** en défense en profondeur : (1) **données** (`{userId, userName, blockedAt}` + liste plate `blockedUserIds` = source de vérité des règles) ; (2) **règles Firestore** (`isNotBlockedBy` à la création de message/conversation → écriture refusée) ; (3) **déclencheur serveur** (`sendMessageNotification` revérifie **dans les deux sens** et **supprime** le message avant notification). **Limite client** : un utilisateur ne lit que son propre profil → la vérif « l'autre m'a bloqué ? » n'est pas toujours détectable côté client (d'où l'autorité serveur).

### 14.9 Données clés

**Conversation** (`chats` : instantané article, rôle vendeur, dernier message, compteur non-lus par personne, identifiant déterministe anti-doublon) ; **message** (`messages` : texte/photo/offre/système, **non supprimable** sauf filet anti-blocage) ; **offre** ; **rapport** (`reports`, staff seul) ; **liste de bloqués** (plate = autorisation serveur, objet = affichage).

### 14.10 Spécificités Canada

CAD ; meetup par défaut (lieux/quartiers suggérés) ; dates FR-CA (« le 12/06/2026 à 14:30 ») ; **Loi 25** (bloc transparence/contestation pour meetups) ; hébergement `northamerica-northeast1`.

### 14.11 Limites connues

Livraison désactivée (offres en meetup) ; push iOS (APNs bruts ignorés) ; messages système non notifiés ; conversations générales (onglet ACHATS, sans barre article/offre) ; photos 1/envoi, recompressées, EXIF retiré ; texte 1000 car. max.

---

## 15. Notifications & temps réel

Centre de notifications in-app, push, et redirection (deep links). FR, CAD. Différences Android/iOS à impact produit.

### 15.1 Deux canaux complémentaires

(1) **Notification in-app** (centre persistant) ; (2) **Notification push** (alerte temps réel). Règle centrale : **la notification in-app est créée quoi qu'il arrive** ; le push peut ne pas partir (préférence OFF, pas d'appareil, ou limite iOS). Le badge in-app vient des non-lus. Le centre s'ouvre via la **cloche de l'en-tête d'accueil** (`/notifications`) — distinct du badge « Messages » (chat).

### 15.2 Le centre de notifications (`/notifications`)

Liste chronologique : icône colorée par type, titre + message, horodatage relatif FR, point bleu si non lu. **Actions :** lire (tap → lue + redirection) ; « Tout lire » ; supprimer (glisser) ; pull-to-refresh. État vide explicatif. **Détail :** emoji de tête retiré à l'affichage (charte sans emoji). **Mise à jour optimiste**.

### 15.3 Les types de notifications

Messagerie & offres (nouveau message, offre reçue, réponse à une offre) ; vente & commande (nouvelle vente — webhook Stripe ; expédiée/livrée/annulée/remboursée) ; intérêt article (favori, baisse de prix — pas pour le propre vendeur) ; recherche sauvegardée ; swap (tout le cycle) ; boutiques (in-app, en attente/approuvée/refusée) ; avis (« Avis reçu ») ; **confidentialité (Loi 25)** : « Incident de confidentialité » in-app aux **utilisateurs affectés** seulement.

### 15.4 Push : Android vs iOS

**Android — pleinement fonctionnel** (jeton FCM enregistré, push temps réel + redirection au tap). **iOS — push non opérationnel à ce jour** : le jeton système n'est pas un jeton FCM ; le serveur le **détecte et ignore** (sans le supprimer). **Conséquence : pas de push iOS** ; **toutes les notifications in-app sont créées** (historique + badge complets). Étape native FCM identifiée (« TODO push-ios »).

| | Android | iOS |
|---|---|---|
| In-app | Oui | Oui |
| Badge | Oui | Oui |
| Push hors-app | Oui | Non (limite connue) |

**Préférences :** interrupteur global push (+ email à vocation future) + par type. **Opt-in par défaut** : marketing/secondaires OFF, transactionnelles ON. Push global coupé → in-app continue. Rappel Swap Zone masqué (zone permanente).

### 15.5 Redirection (deep links)

| Type | Écran |
|---|---|
| Message, offre, réponse | `/chat/{id}` |
| Favori, baisse de prix | `/article/{id}` |
| Rappel Swap Zone | `/swap-party/{id}` |
| Mise à jour swap | `/swap/{id}` |
| Recherche sauvegardée | recherche pré-remplie + **remise à zéro du compteur** |
| Vente / commande | `/my-orders` |
| Boutique, avis, incident | centre de notifications |

**App fermée (« killed ») :** détection de la notification d'origine au démarrage + redirection (concerne Android). **Liens universels** : `https://seconde.app/…` + schéma `seconde://` (association iOS/Android au domaine).

### 15.6 Channels Android

Android 8+ exige des **channels** : `messages`, `offers`, `orders` (haute) ; `swaps`, `saved_searches`, `notifications` (normale). **Sans channel, Android jette silencieusement la notification** — `saved_searches` requis pour les alertes de recherche.

### 15.7 Comment les notifications sont déclenchées (serveur)

**Temps réel :** message créé (notif destinataire ; supprimé si blocage) ; statut d'offre (notif acheteur) ; favori (notif vendeur sauf préférence OFF) ; baisse de prix (lot, par préférence) ; swap ; paiement confirmé (notif vendeur). **Programmés :** recherches sauvegardées **toutes les 15 min** (articles depuis le dernier envoi). **Nettoyage** des jetons invalides ; **jetons iOS bruts préservés** (non envoyés, non supprimés).

### 15.8 Données clés

**fcmTokens** (appareils ; jeton retiré + compteur à zéro à la déconnexion) ; **notifications** (collection in-app) ; **preferences.notifications** ; **compteur de non-lus** (badge in-app).

### 15.9 Spécificités Canada

CAD dans les notifications ; **Loi 25** : « Incident de confidentialité » = canal de conformité (information des personnes touchées) ; opt-in par défaut ; fonctions en `northamerica-northeast1`.

### 15.10 Limites connues

Push iOS non actif (in-app + badge complets, étape native planifiée) ; badge « Messages » = chat (distinct du centre) ; recherches sauvegardées par lots/15 min (léger délai ; filtrage fin appliqué après une 1re sélection serveur).

---

## 16. Boutiques payantes & administration

(1) Système de **boutiques** (fiches d'enseignes, vitrine publique, modèle de monétisation à 3 forfaits) ; (2) **espace d'administration** (validation des boutiques + traitement des signalements).

> **Point d'attention :** le modèle « boutique payante » est une **direction produit décidée mais pas encore implémentée**. Livré et fonctionnel : modèle de données, vitrine `/shop/[id]`, chaîne de modération admin. **Non branché :** création de boutique par un commerçant (`createShop` jamais appelé) ; **aucun champ de forfait/abonnement** n'existe encore.

### 16.1 Qu'est-ce qu'une « boutique »

Collection `shops` = **enseigne physique** de seconde main (friperie, dépôt-vente, vintage, concept store…). **20 catégories de type** (friperie, depot-vente, vintage, luxe-seconde-main, streetwear, concept-store, createurs-designer, workwear-militaire, boutique-enfant, chaussures-sneakers, accessoires-maroquinerie, librairie-occasion, jouets-puericulture, hightech-electronique, maison-deco, sport-outdoor, vinyles-musique, beaute-cosmetiques, ressourcerie, autre).

**Fiche :** identité (nom, description, type, logo, galerie) ; contact (téléphone, email, site, réseaux) ; localisation (adresse + GPS + **geohash** pour « à proximité ») ; horaires ; **légal Canada** (NEQ/BN, TPS, TVQ, bancaire) ; indicateurs (note, avis, articles) ; cycle de vie (statut, vérification, dates).

### 16.2 Statuts d'une boutique

`pending` (file de validation, non listée) ; `approved` (vérifiée, listée + badge « Boutique vérifiée ») ; `rejected` (motif, non visible) ; `suspended` (motif, hors-ligne). **Règles :** naît toujours en `pending` ; seules les `approved` remontent en recherche géolocalisée ; transitions **admin uniquement** (serveur) ; idempotentes ; pas de suppression via interface (suspension seule).

### 16.3 La vitrine publique (`/shop/[id]`)

Lecture **publique** (même non connecté) : galerie ; en-tête (logo + nom + badge « Boutique vérifiée » si approuvée) ; badge de type ; description ; contact (Appeler / Email / Site) ; adresse ; **carte Google Maps** ; horaires (« Fermé » si non renseigné) ; réseaux sociaux ; articles (« Voir tous les articles » → `/search?shopId=…`). « Boutique introuvable » si l'id n'existe pas. **iOS/Android :** carte via `PROVIDER_GOOGLE` (iOS exige une clé API Google Maps sinon carte vide).

### 16.4 Articles rattachés à une boutique

Récupération filtrée (appartenance + actif + non vendu). **Limite :** le rattachement repose sur un identifiant de boutique porté par l'article, mais le modèle « Article » ne possède pas encore formellement ce champ → catalogue boutique pleinement opérationnel seulement une fois ce rattachement renseigné (prérequis du modèle payant).

### 16.5 Modèle de monétisation : 3 forfaits (cible produit)

> **Décidé, non implémenté.** Aucun champ d'abonnement, aucun paiement d'abonnement, création de boutique non accessible.

Aujourd'hui : vendeur **100 %** (0 % commission), acheteur paie **5 % + 1,50 $, min 2,00 $**. Le levier boutiques est **inhabituel** : ne pas prélever le vendeur, mais **réduire les frais acheteur** par palier (articles plus attractifs ; au palier max, 0 % de frais acheteur, Second se rémunère **uniquement** sur l'abonnement).

| Forfait | Prix indicatif | Frais acheteur | Légal (Canada) |
|---|---|---|---|
| **L'Atelier** | ~9 $/mois | Standard (5 % + 1,50 $) | NEQ optionnel |
| **Le Comptoir** | ~29 $/mois | Réduit (~2,5 % + 0,75 $) | NEQ requis |
| **La Maison** | ~79 $/mois | **0 %** | NEQ + TPS + TVQ requis |

**Cibles :** power-sellers + professionnels. **Logique « plus de légal aux paliers élevés ».** **Prérequis techniques (non réalisés) :** rattacher article ↔ boutique ↔ palier ; barème par palier ; abonnements récurrents ; verrouiller le champ « forfait ». **Sécurité déjà en place :** les champs réservés (`plan`, `forfait`, `tier`, `feesTier`, `buyerFeePercent`, `isVerified`, `verificationDetails`) sont admin/serveur uniquement (anti-escalade de revenu).

### 16.6 L'espace d'administration

Panneau **intégré à l'app** (pas de back-office web), réservé aux admins. **Accès :** section « Administration » dans Réglages (admins seulement). **Qui est admin :** custom claim `admin` (serveur, non modifiable) + repli `isAdmin` (protégé en écriture). **Triple verrouillage :** garde de route `/admin/*` ; re-vérification par écran ; règles de données serveur.

**Gestion des boutiques (`/admin/shops`) :** onglets En attente (badge file) / Approuvées / Rejetées / Toutes ; cartes + Approuver / Rejeter ; **Approuver** → `approved` + notif ; **Rejeter** → motif obligatoire → `rejected` + notif. **Détail (`/admin/shop-detail/[id]`)** : vue complète + boutons (pending uniquement). **Signalements (`/admin/reports`)** : file pending ; **Valider** (resolved) / **Examiné** (reviewed) / **Rejeter** (dismissed) — agit sur le **statut du signalement**, pas d'action automatique sur la cible (sanction manuelle séparée).

### 16.7 Sécurité : tout passe par le serveur

Champs sensibles (statut de validation, détails de vérification d'une boutique ; statut/réviseur/date/résolution d'un signalement) **verrouillés** côté règles — modifiables uniquement par Cloud Functions qui : vérifient l'admin, dérivent son identité de la session (aucun id transmis), opèrent en transaction atomique. Fonctions : `approveShop`, `rejectShop`, `suspendShop`, `getPendingReports`, `triageReport` (région `northamerica-northeast1`). **Création :** seulement par un utilisateur authentifié, pour lui-même, **obligatoirement `pending`**, sans s'attribuer vérification ni forfait (ni auto-validation, ni auto-octroi de frais réduits).

### 16.8 Notifications au propriétaire — limite connue

Approbation/rejet tentent d'écrire une **notification in-app** depuis le **client**, mais les règles **interdisent au client de créer une notification** → écriture **rejetée** (erreur silencieusement avalée). Le changement de statut réussit, **mais le propriétaire risque de ne pas recevoir la notification** tant que l'envoi n'est pas déporté côté serveur. Pas de notification à la création (`shop_created` non émis), ni à la suspension.

### 16.9 Récapitulatif : livré vs cible

| Élément | État |
|---|---|
| Modèle de données boutique | **Livré** |
| Vitrine `/shop/[id]` | **Livré** |
| Recherche « à proximité » (approuvées) | **Livré** (service) |
| Modération admin (valider/rejeter/suspendre) | **Livré** |
| File de signalements + triage | **Livré** |
| Garde d'accès admin (triple) | **Livré** |
| **Création de boutique par un commerçant** | **Non branché** |
| **Forfaits payants** | **Non implémenté** |
| **Réduction des frais par palier** | **Non implémenté** |
| Notification au propriétaire | **Partielle / non fiable** |

La **chaîne de confiance** (vitrine vérifiée + modération sécurisée) est opérationnelle ; le **moteur économique** (création self-service, abonnements, frais modulés) reste à construire sur des fondations de sécurité déjà posées.

---

## 17. Conformité & légal (Loi 25 / Canada)

> Ce que Second fait concrètement en protection des renseignements personnels (**Loi 25** du Québec, **LPRPDE/PIPEDA** fédérale). Traitements sensibles **côté serveur** (Cloud Functions, `northamerica-northeast1`).

Second se positionne comme entreprise québécoise (« Seconde Inc. », Montréal). La conformité est tissée dans l'inscription, les réglages, les décisions automatisées et l'admin.

### 17.1 Vue d'ensemble des droits couverts

| Droit / obligation | Implémentation | Où |
|---|---|---|
| Consentement éclairé (art. 12) | Cases CGU + Politique + opt-in marketing, journalisés serveur | Inscription |
| Barrière d'âge | ≥ 16 inscription/achat, ≥ 18 vente | Inscription |
| Retrait marketing (art. 14 / LCAP) | Interrupteur, retrait append-only + coupure serveur | Réglages › Confidentialité |
| Confidentialité par défaut (art. 9.1) | Photo, IA, marketing tous **OFF** | Réglages › Confidentialité |
| Portabilité (art. 27) | Export JSON | Confidentialité › Exporter |
| Effacement | Suppression + garde-fous financiers serveur | Confidentialité › Supprimer |
| Décisions automatisées (art. 12.1) | Information, critères, contestation (révision humaine) | Suivi de commande |
| Registre incidents (art. 3.5–3.8) | Collection serveur, escalade CAI, notification | Admin (callables) |
| Rétention/destruction (art. 23) | Purge quotidienne | Automatique |
| Pages légales avant consentement | CGU + Politique lisibles **sans connexion** | Inscription + Réglages |

### 17.2 Consentement à l'inscription

Bloc partagé (`ConsentFields`) : date de naissance ; cases obligatoires CGU + Politique (liens cliquables) ; case facultative marketing. Bouton désactivé tant que ≥ 16 ans + deux cases. **Social ne contourne jamais** la barrière (rollback si abandon).

**Âge (serveur, `recordSignupConsent`)** : format ISO, dates impossibles rejetées, fuseau **America/Toronto** ; **16 ans** (`MIN_AGE_REGISTER`), **18 ans** vente (`MIN_AGE_SELL`). **Preuve :** date de naissance sur la fiche + documents `consents` (`terms`, `privacy_policy` toujours ; `marketing` si opté) avec `version` (`POLICY_VERSION = '2026-05-31'`), `acceptedAt`, `channel: 'app'`. **Append-only**, écrits **exclusivement côté serveur** (lecture seule pour le propriétaire).

### 17.3 Consentement marketing : retrait append-only + coupure serveur

Interrupteur « Communications marketing » → `setMarketingConsent` : (1) **journalisation append-only** (nouveau document, jamais de modification) ; (2) **application serveur** (préférences `marketingConsent`, `priceDrops`, `articleFavorited`, `swapZoneReminder` à false → **aucun** envoi marketing après retrait). Réversible.

### 17.4 Confidentialité par défaut

`PRIVACY_DEFAULTS` : `showProfilePhoto` OFF (photo masquée), `aiProfilingConsent` OFF (pas de reco IA), `marketingConsent` OFF. Le profilage IA s'appuie sur Google (Gemini, Vertex AI), traitement **aux États-Unis**, activable/désactivable sans incidence. Photo et IA en préférence client ; marketing via callable serveur.

### 17.5 Portabilité : export des données

**Exporter mes données** → fichier **JSON** local (`seconde_data_{uid}_{timestamp}.json`) + feuille de partage native. Contenu : profil, articles, favoris, notifications, conversations (**messages envoyés** par l'utilisateur), avis, achats, ventes, brouillons, recherches sauvegardées, historique, **historique des consentements**. Dates ISO-8601. **Limites :** calculé **côté client** (`UserService.exportUserData`, risque de timeout pour 500+ articles ; migration future vers Cloud Function) ; **swaps et wallet** pas encore inclus (TODO) ; couvre les messages **envoyés** seulement.

### 17.6 Suppression de compte : effacement + garde-fous financiers

`deleteUserAccount` (serveur). **Parcours (2 étapes)** : information (supprimé vs anonymisé) ; confirmation (**ré-authentification** + taper « SUPPRIMER »).

**Ré-auth par fournisseur :** email/mot de passe (mot de passe) ; Google ; Apple iOS ; **Apple sur Android → indisponible** (ajouter un mot de passe d'abord) ; indéterminé → déconnexion/reconnexion. **Différence iOS/Android réelle.**

**Garde-fous financiers serveur (avant toute destruction)** — suppression **refusée** (`failed-precondition`) si : **dette** (`sellerDebt > 0`) ; **porte-monnaie non vide** (dont `heldBalance`) ; **litige ouvert** ; **transaction active** (statut non terminal).

**Supprimé vs anonymisé :** **supprimé** (fiche + sous-collections, favoris, notifications, swaps, articles SwapZone, wallet + ledger, retraits, brouillons, `search_index`, fichiers Storage ; réservation `@pseudo` libérée) ; **anonymisé/conservé** (articles inactifs « Utilisateur supprimé » ; conversations/messages anonymisés ; avis anonymisés ; **transactions jamais supprimées** — rétention 7 ans). **Compte Stripe Connect** supprimé (`accounts.del`, best-effort ; échec → incident `deletion_failed` gravité high). Compte Firebase Auth supprimé en dernier (best-effort).

### 17.7 Décisions automatisées : transparence & contestation (art. 12.1)

| Type | Quand | Tâche |
|---|---|---|
| `funds_released` | Fenêtre 7 jours écoulée | `releaseHeldFunds` |
| `transaction_expired` | Commande orpheline | `transactionExpiration` |
| `label_refund` | Étiquette impossible | `sweepPendingLabels` |

**Journalisation** (`logAutomatedDecision`, **après** le mouvement d'argent, additif) dans `automatic_decisions_log` (transaction, utilisateur, type, **critères lisibles**, résultat). **Côté utilisateur** (`ShipmentTracking`, y compris meetups) : titre, texte daté, dépliant « Pourquoi cette décision ? », bouton « Contester ». **Contestation** (`contestAutomatedDecision`) → demande de **révision humaine** (`automated_decision_contestations`, statut `open`) ; **aucun mouvement inversé automatiquement** ; seules les parties peuvent consulter/contester.

### 17.8 Rétention et destruction (art. 23)

`retentionPurge` **chaque jour** (America/Toronto), par cible indépendante, plafond 2000 docs/cible.

| Donnée | Seuil |
|---|---|
| Articles inactifs | > **3 ans** |
| `guest_preferences` | > **90 jours** |
| Notifications | > **180 jours** |
| Historique de recherche | > **12 mois** |
| Brouillons abandonnés | > **90 jours** |

**Exclusion :** `transactions` **jamais** purgée (rétention légale **7 ans**). Délai de réponse aux demandes : **30 jours max**.

### 17.9 Registre des incidents (art. 3.5–3.8)

`privacy_incidents` (serveur, admins seuls). Callables : `reportPrivacyIncident`, `getPrivacyIncidentsLog`, `escalatePrivacyIncidentToCAI` (notification **CAI**), `notifyAffectedUsers` (avis in-app). **Seuils :** `critical`/`high` → notification CAI **obligatoire** ; `medium` → discrétion ; `low` → registre seulement. **Délai cible 72 h** (horodatages auditables). États : `open` → `investigating` → `contained` → `resolved`. **Note :** outillage exposé via callables admin ; **pas d'écran admin dédié** dans l'app mobile.

### 17.10 Pages légales

**Politique de confidentialité** (datée « 31 mai 2026 », 10 sections : responsable privacy@seconde.app, renseignements, finalités, **destinataires hors Québec** — Stripe, ShipEngine/Auctane, Google Vertex AI/Gemini, Firebase, principalement aux É.-U. ; Cloud Functions à **Montréal** ; profilage, conservation, droits, consentement/retrait, incidents, plainte + adresse CAI ; « Nous ne vendons jamais vos données »). **CGU.** **Accessibilité (art. 12) :** pages publiques `app/legal/*` lisibles **sans connexion** ; même corps de texte réutilisé par la route authentifiée (pas de divergence).

### 17.11 Spécificités Canada & points à retenir

Entreprise québécoise (Montréal), FR, âge en America/Toronto, CAD, hébergement Montréal, **CAI** comme autorité ; transferts hors Québec listés (Stripe, ShipEngine, Google) ; double référence **Loi 25 + LPRPDE/PIPEDA** + LCAP ; différence iOS/Android la plus impactante = suppression Apple sur Android (ajouter mot de passe d'abord) ; tous traitements sensibles **autorité serveur**, preuves de consentement **append-only** et infalsifiables.

---

## 18. Architecture & opérations (annexe technique)

> Comment l'app fonctionne sous le capot, en langage métier. Source : code réel (`functions/src/`, `firestore.rules`, `app.config.js`, `firebase.json`, `eas.json`).

### 18.1 Vue d'ensemble en une phrase

Application mobile unique (iPhone + Android) connectée à un **back-office Firebase (Google)** au **Canada** (Montréal). Paiements via **Stripe** (marque blanche), livraisons via **ShipEngine** (transporteurs canadiens). Toute opération sensible passe par un programme serveur de confiance, jamais par le téléphone.

### 18.2 La pile technologique

| Brique | Rôle |
|---|---|
| **Application (Expo / React Native)** | Écrans, photos, messagerie |
| **Firebase (Google Cloud)** | Données, robots serveur, comptes |
| **Firestore** | Articles, utilisateurs, commandes, messages, avis, échanges, soldes |
| **Cloud Functions** | Cerveau des opérations sensibles |
| **Stripe Connect Custom** | Encaissement, reversement, comptes bancaires vendeurs |
| **ShipEngine** | Tarifs, étiquettes, suivi (Intelcom/Dragonfly, Postes Canada) |
| **Gemini (Google AI)** | Analyse photos, recherche visuelle, profils de style |

TypeScript strict, Hermes, `com.seconde.app`, nom « Seconde ». Serveur : Node.js 20, `firebase-admin` v13, `firebase-functions` v7, SDK Stripe v22 (API `2026-04-22.dahlia`). Projet `seconde-b47a6`.

### 18.3 Où vivent les données : le Canada par défaut

Toutes les Cloud Functions en **`northamerica-northeast1` (Montréal)** — sans exception. Conséquences : **Loi 25 / résidence des données** ; latence faible pour les Canadiens ; **CAD** partout. Chaque fonction réserve **≥ 512 Mo** (et non 256 par défaut) pour éviter les OOM (bundle volumineux partagé).

### 18.4 Le catalogue des « robots » serveur (~75 fonctions)

**A. Callables** (action utilisateur) — vente/catalogue (`analyzeProductImage`, `createArticle`/`updateArticle`, `incrementProductView`, `toggleProductLike`, `toggleArticleSold`, `visualSearch`, `getSimilarProducts`, `backfillEmbeddings`) ; paiement/livraison/commandes (`getShippingEstimate`, `getServiceFee`, `createTransaction`, `createStripeCheckout`, `createStripeConnectAccount`, `addBankAccount`, `getStripeAccountStatus`, `findPickupPoints`, `checkTrackingStatus`, `cancelPendingTransaction`, `completeMeetupTransaction`, `reportMeetupNoShow`, `adminRefundTransaction`) ; recours (`requestRefund`, `reportTransactionProblem`, `requestReturn`) ; échanges (`proposeMultiSwap`, `acceptSwap`, `declineSwap`, `cancelSwap`, `confirmSwapShipping`, `confirmSwapReception`, `rateSwap`, `openSwapDispute`, `createSwapTopUpCheckout`) ; wallet (`activateWallet`, `getWalletInfo`, `walletWithdraw`, `payWithWallet`, `refundWalletPayment`) ; compte/conformité (`deleteUserAccount`, `recordSignupConsent`, `setMarketingConsent`, `assignUsername`, `recordPrivacyIncident`, `getPrivacyIncidentsLog`, `escalatePrivacyIncidentToCAI`, `notifyAffectedUsers`, `contestAutomatedDecision`, `getAutomatedDecisionLog`) ; modération (`approveShop`, `rejectShop`, `suspendShop`, `getPendingReports`, `triageReport`).

**B. Triggers** (réflexes) — `updateSearchIndex`, `updateUserStats`, `generateEmbeddingOnCreate/OnUpdate`, `sendMessageNotification`, `sendOfferStatusNotification`, `onSwapCreated`, `onSwapStatusUpdated`, `onArticleFavorited`, `onArticlePriceDropped`, `onUserProfileUpdated`, `onArticleSoftDeleted`, `onArticleSold`, `onArticleInfoUpdated`.

**C. Scheduled** (horloge) :

| Robot | Fréquence | Rôle |
|---|---|---|
| `updateGlobalStats` | 1 h | Stats globales |
| `updatePopularityScores` | 6 h | Popularité (tri « Populaire ») |
| `cleanupSearchIndex` | 24 h | Nettoie l'index |
| `cleanupExpiredDrafts` | 24 h (Toronto) | Brouillons abandonnés (14 j) |
| `checkSavedSearchNotifications` | 15 min | Alertes recherches sauvegardées |
| `expireStaleOffers` | 1 h | Offres en attente |
| `expireStaleProposedSwaps` | — | Swaps jamais acceptés (7 j) |
| `expireOrphanedTransactions` | — | Meetup 48 h / paiement 1 h / payé non expédié 7 j |
| `checkShippedTracking` | ~12 h | Filet suivi colis |
| `releaseHeldFunds` | 1 h | **Libère les fonds après 7 jours** |
| `sweepPendingLabels` | 1 h | Réessaie l'étiquette ; rembourse après 4 échecs |
| `retryFailedOperations` | 30 min | Re-jeu financier (backoff) |
| `reconcileFinances` | 6 h | **Réconciliation** (détection seule) |
| `retentionPurge` | 24 h | **Purge de rétention** (transactions jamais touchées, 7 ans) |

**D. Webhooks** — `stripeWebhook` (signature vérifiée cryptographiquement, 401 sinon ; gère aussi `swap_topup`) ; `shipEngineWebhook` (chemin principal du suivi ; secret partagé comparé en temps constant).

### 18.5 Sécurité : qui a le droit de faire quoi

**1. Règles Firestore (~860 lignes) :** champs sensibles **verrouillés** (`isAdmin`, `role`, `customClaims`, `username` serveur seul — anti-escalade) ; fiches utilisateurs lisibles par propriétaire/admin ; soldes/paiements/statuts/boutiques jamais modifiables par le client ; notifications, index, embeddings, stats, registres consentement/incidents en **lecture seule client** ; messages/conversations limités aux participants (gestion du blocage).

**2. Administrateurs :** custom claim `admin` (serveur, non modifiable) + repli `isAdmin` ; actions admin via Cloud Functions qui revérifient.

**Principe d'or financier :** toute mutation d'argent/statut sensible via Cloud Function + **transaction atomique** (`runTransaction`), **idempotente** (clés stables, ex. `rf_buyer_<commande>`), échecs en file de re-jeu. Secrets (Stripe, ShipEngine) dans le **Secret Manager**.

### 18.6 Le modèle de revenus, côté technique

`utils/fees.ts` centralise le calcul. **Commission vendeur 0 %** (100 % au vendeur). **Frais acheteur 5 % + 1,50 $, min 2,00 $** (réglables sans redéploiement). Stripe encaisse, reverse (destination charge), retient `application_fee_amount`. **Boutiques payantes** (3 forfaits) monétisées en réduisant les frais acheteur (0 % vendeur conservé). Tout en **CAD**.

### 18.7 iOS vs Android

App **~95 % identique** ; différences sur les couches natives.

| Sujet | iOS | Android |
|---|---|---|
| Push | APNs | FCM |
| Liens partagés | Universal Links (`applinks:seconde.app`) | App Links |
| Connexion Apple | Obligatoire (App Store) | Optionnelle |
| Permissions | Photos, caméra, notifications | + localisation, `POST_NOTIFICATIONS`, vibration |

Liens profonds prévus : `/article`, `/chat`, `/user`, `/shop`, `/swap-party`, `/swap`, `/notifications`, `/search`.

### 18.8 Déploiement & exploitation

**App → EAS** (profils `development`/`preview`/`production` ; version prod auto-incrémentée ; soumission App Store pré-câblée, Team ID `2VZTF24GKY`). **Back-office → `firebase deploy`** (règles, **130+ index Firestore**, Cloud Functions, hébergement web ; émulateurs locaux complets). **Garde-fous :** pas de deploy fonctions « en force » (orphelins financiers comme les retraits) ; modif native via config (`app.config.js` + `expo prebuild`), jamais à la main dans `ios/`/`android/` ; clés dans Secret Manager.

### 18.9 Limites et dette technique connues

1. **Push iOS structurellement défaillant** : jeton Apple « brut » envoyé à FCM, rejeté → **aucune notification sur iPhone** (Android OK). Correctif : Expo Push ou messagerie Firebase native.
2. **Liens partagés (universal/app links) non fonctionnels** : fichiers de validation (`apple-app-site-association`, `assetlinks.json`) avec valeurs de remplacement → un lien partagé **ouvre le navigateur** (casse l'acquisition virale). Correctif : vraies empreintes + redéploiement.
3. **Migration de l'index de recherche à faire avant la mise en production** : articles anciens sans `moderationStatus` ni taille structurée, index non reconstruit → **invisibles en recherche texte / tri Populaire** ; un backfill naïf les désindexerait. Séquence ordonnée documentée (marquer « approuvé », convertir tailles, déployer index, reconstruire l'index).
4. **Parité native incomplète** : Apple Pay / Google Pay pas encore opérationnels (plugin Stripe natif à déclarer) ; plugin caméra à fixer pour Android ; carte Google Maps sans clé ; permission micro (`RECORD_AUDIO`) déclarée sans usage (friction Play Store).

Chantiers **identifiés** avec correctifs cadrés.

### 18.10 Spécificités Canada — synthèse

CAD unique ; données au Canada (Montréal, Loi 25) ; conformité outillée (consentement, incidents + escalade CAI, décisions automatisées contestables, `deleteUserAccount`, purge avec conservation 7 ans des transactions) ; transporteurs canadiens via ShipEngine (Intelcom, Postes Canada, points relais) ; interface mono-langue **français** (y compris textes de permission).

---

## Glossaire métier

- **Swap (troc)** — Échange d'articles entre deux membres, alternative à l'achat. Gratuit côté article ; frais seulement sur un **complément en argent**. Cycle : `proposed` → `payment_pending` → `accepted` → `photos_pending` → `shipping` → `completed`.
- **SwapZone** — Zone de troc **permanente et généraliste** (identifiant fixe `generalist`), univers visuel sombre, toujours ouverte (privilégie la liquidité au FOMO). A remplacé les anciennes « swap-parties » thématiques.
- **Top-up (complément en argent)** — Somme ajoutée pour rééquilibrer un échange de valeurs inégales. Plafonnée à 5 000 $, payée via Stripe après acceptation, soumise aux frais de protection acheteur ; jamais débitée à la proposition.
- **balance / pendingBalance / heldBalance** — Les trois poches du porte-monnaie vendeur : **disponible** (retirable), **en attente** (vente payée pas livrée), **en séquestre / bientôt disponible** (livrée, dans la fenêtre de 7 jours).
- **heldBalance** — Spécifiquement, les fonds **gelés** durant la fenêtre de litige de 7 jours après livraison ; deviennent `balance` automatiquement si aucun litige.
- **sellerDebt (dette vendeur)** — Montant dû à la plateforme après un litige perdu ou un remboursement alors que le vendeur avait déjà retiré les fonds. Bloque tout retrait jusqu'à régularisation.
- **sellerPayout** — Part revenant au vendeur = **100 % du prix** de l'article (0 % de commission vendeur).
- **application_fee_amount** — Mécanisme Stripe par lequel la plateforme prélève ses **frais de protection acheteur** sur un destination charge.
- **Destination charge** — Paiement Stripe où l'acheteur paie le total, Stripe verse la part vendeur sur son compte Connect, et la plateforme retient sa commission.
- **Stripe Connect Custom** — Type de compte connecté en **marque blanche** : le vendeur ne voit jamais Stripe (onboarding, identité, compte bancaire, statut, retraits 100 % in-app). La plateforme porte KYC, conformité et litiges. Choix assumé, à ne pas migrer en Standard.
- **White-label** — Principe selon lequel l'expérience est 100 % dans l'app Second (paiement, recours, retrait) sans jamais rediriger vers un tableau de bord tiers.
- **ShipEngine** — Agrégateur multi-transporteurs pilotant tarifs, étiquettes et suivi (Intelcom/Dragonfly, Postes Canada, UPS Canada).
- **Fenêtre de litige / séquestre (escrow) 7 jours** — Délai post-livraison pendant lequel les fonds restent gelés, le temps que l'acheteur puisse signaler un problème.
- **Frais de protection acheteur (« frais de service »)** — `max(2,00 $ ; 5 % du prix + 1,50 $)`, à la charge de l'acheteur ; nuls sur un meetup.
- **Meetup (remise en main propre)** — Mode où acheteur et vendeur se rencontrent et règlent **en cash, hors plateforme** ; **0 frais**, aucun argent ne transite par Second.
- **@username (@pseudo)** — Identifiant public **unique et immuable**, dérivé du nom à la création, jamais re-dérivé du displayName.
- **moderationStatus** — Statut de modération d'un article (`approved` par défaut à la création) ; `pending`/`rejected` le retire de la recherche.
- **search_index** — Collection Firestore allégée (mots-clés + champs filtrables + score de popularité) qui alimente le moteur de recherche maison (pas de moteur tiers).
- **Embedding (empreinte visuelle)** — Vecteur IA d'un article (Vertex AI) servant à la recherche par photo et aux « produits similaires ».
- **Forfait boutique** — Offre payante (3 paliers : L'Atelier, Le Comptoir, La Maison) qui **réduit les frais acheteur** sur la boutique au lieu de prélever le vendeur. **Décidé, non encore implémenté.**
- **NEQ / TPS / TVQ** — Identifiants fiscaux canadiens/québécois (numéro d'entreprise du Québec, taxe fédérale, taxe du Québec) collectés sur le profil légal d'une boutique selon le palier.
- **Loi 25** — Loi québécoise de protection des renseignements personnels. Impose consentement éclairé, vie privée par défaut, décisions automatisées explicables/contestables, registre d'incidents (notification CAI), rétention/destruction, portabilité et effacement.
- **CAI** — Commission d'accès à l'information du Québec : autorité à notifier en cas d'incident à risque de préjudice sérieux.
- **Décision automatisée** — Décision prise par le système sans intervention humaine (libération des fonds à J+7, annulation/remboursement automatique) ; journalisée, expliquée et **contestable** (révision humaine) au titre de l'art. 12.1.
- **Dead-letter (file de re-jeu)** — File `failed_operations` où atterrissent les opérations financières échouées, rejouées avec backoff exponentiel et clé d'idempotence stable.
- **Idempotence** — Propriété garantissant qu'une opération rejouée (webhook, re-jeu) ne produit jamais de double effet (double prélèvement, double remboursement).
- **SHIPPING_ENABLED** — Drapeau de fonctionnalité ; à `false`, l'expédition est masquée et tout passe en **meetup** (le moteur Stripe/ShipEngine reste intégré, réactivable).
- **northamerica-northeast1** — Région Google Cloud de **Montréal** où toutes les Cloud Functions sont déployées (résidence des données au Canada).

---

## Limites & chantiers connus

Synthèse honnête de l'écart entre la capacité du code et ce qui est pleinement opérationnel en production. Ces points sont **cadrés**, pas des inconnues.

### Plateforme & livraison

- **Push iOS non opérationnel** (chantier majeur). Le client iOS enregistre un **jeton APNs brut** que le serveur ne sait pas router via FCM ; il le détecte et l'ignore. Conséquence : **aucune notification push hors-app sur iPhone** (messages, offres, ventes, livraisons, avis, alertes de recherche). Les notifications **in-app et le badge restent complets** sur iOS. Android fonctionne. Correctif identifié : Expo Push ou messagerie Firebase native.
- **Universal / App Links non finalisés**. Les fichiers `apple-app-site-association` et `assetlinks.json` contiennent encore des valeurs de remplacement (Team ID, empreinte certificat). Conséquence : un **lien partagé ouvre le navigateur** au lieu de l'app (casse l'acquisition virale). Correctif : insérer les vraies empreintes et redéployer l'hébergement.
- **Apple Pay / Google Pay** pas encore opérationnels (plugin Stripe natif à déclarer) ; **carte Google Maps** sans clé sur iOS (vitrine boutique) ; **plugin caméra** Android à fixer ; permission micro (`RECORD_AUDIO`) déclarée sans usage (friction validation Play Store).

### Recherche

- **Migration de l'index de recherche à exécuter avant la mise en production** (ordre impératif : marquer « approuvé », convertir les tailles en `{valeur, système}`, déployer les index, **puis** reconstruire `search_index`). Sans cela, les **articles préexistants sont invisibles** en recherche texte / tri Populaire, et un backfill naïf les désindexerait.
- **Pas de tri/recherche par proximité géographique** côté découverte (la plomberie existe mais aucune position n'est transmise au moteur).
- **Tri prix/date désactivé en mode mot-clé** (seul « Populaires » — limite assumée du moteur Firestore maison).
- **Recherches « tendances » de l'écran de recherche** = liste fixe codée en dur (pas un classement temps réel).

### Expédition & paiement

- **Expédition désactivée par drapeau** (`SHIPPING_ENABLED = false`) dans la version en service : seul le **meetup** est actif (réglé en cash hors application, aucun frais de plateforme). Tout le moteur Stripe / ShipEngine / frais reste intégré et réactivable d'un interrupteur.
- **Points relais (PUDO)** présents dans le backend et le modèle de données mais **non exposés** dans le tunnel d'achat (toutes les estimations en « domicile »).

### Boutiques & monétisation

- **Build de l'offre boutiques à livrer** : la **création de boutique** par un commerçant n'est branchée à aucun écran (`createShop` jamais appelé) ; **aucun champ de forfait/abonnement** n'existe ; la **réduction des frais acheteur par palier** n'est pas implémentée. Les fondations de sécurité (champs `plan`/`tier`/`buyerFeePercent` verrouillés admin/serveur) sont déjà posées.
- **Rattachement article ↔ boutique** non formalisé dans le modèle « Article » (prérequis du modèle payant).
- **Notification au propriétaire** après décision admin **non fiable** : l'écriture est tentée côté client mais rejetée par les règles (à déporter côté serveur).

### Conformité (Loi 25)

- **Export de données calculé côté client** (risque de timeout pour les très gros comptes ; migration future vers Cloud Function) ; **swaps et porte-monnaie** pas encore inclus dans l'export.
- **Registre d'incidents** piloté par callables admin sans **écran d'administration dédié** dans l'app mobile.

### Swap

- **Affichage du complément en cents bruts** dans certaines vues de détail (ex. « $1000 » au lieu de « 10,00 $ ») — défaut d'affichage seul (le calcul Stripe est correct).
- **Données de profil en dur** dans la fiche de proposition (localisation, distance, note, nombre de swaps) — maquette à brancher avant production.
- **Résolution de litige swap** = modération humaine non automatisée (pas de transition de sortie automatique de `disputed`).

### Meetup

- **Bouton no-show du chat « cosmétique »** : il alerte verbalement mais ne déclenche pas la Cloud Function « avec effet » (`reportMeetupNoShow`) ; le déblocage de l'article repose sur l'expiration automatique programmée.
