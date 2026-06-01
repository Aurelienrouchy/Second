## 01. Vue d'ensemble & proposition de valeur

> Document métier destiné à un lecteur informé non-technique (fondateur, investisseur, dossier immigration/incubateur, nouvel arrivant produit). Il décrit ce que l'application **fait réellement** d'après le code, pas une feuille de route. Quand une fonctionnalité a une limite connue, elle est indiquée factuellement.

---

### 1.1 En une phrase

**Second** est une marketplace mobile de **mode et d'objets de seconde main**, pensée d'abord pour le marché **canadien francophone**, où l'on **achète, vend et échange (troc)** des articles entre particuliers et boutiques professionnelles. L'application est disponible sur **iOS et Android** (application Expo / React Native), avec paiement sécurisé, livraison avec étiquette générée dans l'app, remise en main propre (meetup) et protection de l'acheteur.

Le positionnement repose sur une promesse simple et lisible : **le vendeur garde 100 % du prix de son article (0 % de commission vendeur)**. La plateforme se rémunère exclusivement via des **frais de protection payés par l'acheteur**, à la manière de Vinted, et non via une commission prélevée au vendeur comme Poshmark.

---

### 1.2 Mission et marché visé

**Mission.** Rendre la revente de vêtements et d'objets de seconde main aussi simple, rapide et fiable qu'un achat neuf, en levant les trois frictions classiques de la seconde main :
1. **La mise en vente est longue** → Second propose une **mise en vente assistée par IA** (photo → titre, marque, catégorie, couleur, matière, taille, état et suggestion de prix pré-remplis).
2. **La confiance manque** → Second sécurise l'argent (paiement Stripe, fonds retenus pendant une fenêtre de litige), gère la livraison de bout en bout (étiquette + suivi) et offre des recours à l'acheteur (remboursement, signalement, retour).
3. **Le prix freine** → Second supprime la commission vendeur (le vendeur touche tout) et permet le **troc** (échange d'articles, avec éventuel complément en argent).

**Marché visé.** Le marché de la mode circulaire au **Canada**, principalement la **Gen Z et les millennials** sensibles à la durabilité et au pouvoir d'achat. Le produit est **mono-langue français** (cible Québec / francophonie canadienne en priorité). Toute l'ergonomie « locale » est calibrée Canada :

| Spécificité Canada | Implémentation réelle |
|---|---|
| Devise | **CAD** partout. Affichage catalogue à la française canadienne (`45 $`, virgule décimale), et `45,00 $ CA` dans les contextes sensibles (paiement, solde vendeur, retrait) — cf. `utils/formatPrice.ts`. |
| Destination de livraison | **Canada uniquement** : la création d'étiquette ShipEngine exige une adresse canadienne valide (code postal/province) ; une adresse hors-Canada est rejetée. |
| Identité fiscale boutique | Le profil légal d'une boutique prévoit **NEQ** (Québec) ou BN fédéral, **n° de TPS** et **n° de TVQ** (cf. type `ShopLegalInfo`). |
| Coordonnées bancaires | Champs **transit (5 chiffres)**, **institution (3 chiffres)**, **compte (7–12 chiffres)** — format bancaire canadien. |
| Vie privée | Conformité **Loi 25** (Québec) intégrée au produit : consentements horodatés, décisions automatisées explicables et contestables, registre d'incidents, purge de rétention, export et suppression de compte. |
| Âge légal | **Inscription réservée aux 16 ans et plus** : l'âge est vérifié **avant** la création du compte (cf. `MIN_AGE_REGISTER`), sans créer de compte orphelin si le critère n'est pas rempli. |

---

### 1.3 Proposition de valeur

**Pour le vendeur (particulier ou boutique)**
- **0 % de commission** : il reçoit l'intégralité du prix affiché. Le calcul de frais (`functions/src/utils/fees.ts`) fixe explicitement `sellerPayout = articlePrice`.
- **Mise en vente en quelques minutes** grâce à l'IA qui pré-remplit la fiche à partir des photos.
- **Encaissement automatisé et white-label** : il est payé via un compte **Stripe Connect Custom** créé et géré entièrement dans l'app — il **ne va jamais sur Stripe** (onboarding, ajout de compte bancaire, vérification d'identité : tout se passe in-app).
- **Logistique gérée** : étiquette d'expédition achetée dans l'app, suivi automatique, ou remise en main propre (meetup) sans frais.

**Pour l'acheteur**
- **Protection incluse** dans les frais de service : paiement sécurisé, fonds retenus jusqu'à la fin de la fenêtre de litige, et recours en cas de problème (colis non reçu, article non conforme, retour).
- **Découverte riche** : feed personnalisé, recherche texte + filtres, **recherche visuelle par photo**, recommandations.
- **Négociation et troc** : faire une offre, proposer un échange d'articles.

**Pour la plateforme**
- Un modèle de revenu **transparent et défendable** côté acheteur, aligné sur le standard du marché (Vinted), tout en restant le plus attractif pour les vendeurs.

---

### 1.4 Modèle de revenu

#### a) Frais de protection acheteur (revenu principal, en place)

Le revenu cœur provient des **frais de protection facturés à l'acheteur** sur les ventes (modèle « façon Vinted »). Formule (paramétrable par variables d'environnement / Remote Config) :

> **Frais = max( 2,00 $ ; 5 % du prix de l'article + 1,50 $ )**

| Prix article | Frais de protection acheteur | L'acheteur paie (hors livraison) | Le vendeur reçoit |
|---|---|---|---|
| 5 $ | 2,00 $ (plancher) | 7,00 $ | 5,00 $ |
| 15 $ | 2,25 $ | 17,25 $ | 15,00 $ |
| 30 $ | 3,00 $ | 33,00 $ | 30,00 $ |
| 50 $ | 4,00 $ | 54,00 $ | 50,00 $ |
| 100 $ | 6,50 $ | 106,50 $ | 100,00 $ |

Techniquement, ces frais correspondent à l'`application_fee_amount` que la plateforme prélève lors du paiement Stripe (destination charge vers le compte du vendeur). **Ce que les frais couvrent** (documenté dans le code) : protection acheteur (litige/remboursement), traitement du paiement, support client, infrastructure (hébergement, API de livraison).

**Règle importante (vérifiée dans le code) :** sur une vente **en main propre (meetup)**, **aucun frais de service n'est appliqué** (`fee = 0`). Les frais ne s'appliquent qu'aux ventes avec livraison. C'est un choix produit qui réduit le revenu sur le local mais favorise l'adoption en remise directe.

#### b) Boutiques payantes (modèle stratégique, non encore câblé dans le moteur de frais)

La **vision de monétisation des boutiques** (forfaits payants pour vendeurs professionnels) est une **décision produit assumée** : les boutiques constitueraient une offre payante en plusieurs forfaits, monétisée non pas en réintroduisant une commission vendeur, mais en **réduisant les frais de protection côté acheteur** sur les articles de la boutique (avantage compétitif pour la boutique, commission vendeur maintenue à 0 %).

**État réel dans le code (à dire factuellement) :** cette mécanique de **réduction de frais par forfait n'est pas encore implémentée dans le moteur de calcul**. Le type `Shop` ne porte aujourd'hui **aucun champ de forfait/tier/abonnement**, et `calculateFees`/`calculateServiceFee` appliquent un barème **unique et global** sans tenir compte de la boutique. La brique « boutiques » est en place (création, modération admin, statuts, profil légal, géolocalisation), mais la **différenciation tarifaire payante reste à brancher**.

#### c) Porte-monnaie (wallet)

Un **porte-monnaie interne** existe (activation, solde, historique, retrait, paiement). Il sert de moyen de paiement alternatif et de réceptacle de remboursements ; il n'est pas, en soi, une source de revenu, mais il fluidifie la rétention de la valeur dans l'écosystème.

---

### 1.5 Différenciateurs

| Différenciateur | Détail concret | Vs concurrence |
|---|---|---|
| **0 % commission vendeur** | Le vendeur encaisse 100 % du prix. | Poshmark prélève ~20 % au vendeur ; Second est nettement plus attractif côté offre. |
| **Frais 100 % acheteur, transparents** | 5 % + 1,50 $, plancher 2 $. | Aligné sur Vinted (5 % + frais fixe). |
| **Paiement white-label (Stripe Connect Custom)** | Le vendeur ne voit jamais Stripe ; onboarding, identité et compte bancaire saisis dans l'app. La plateforme porte KYC, conformité et litiges. | Expérience plus intégrée que les marketplaces redirigeant vers un dashboard tiers. |
| **Troc / échange (swap)** | Échange d'articles d'un même vendeur, avec **complément en argent** payé via Stripe si besoin ; preuve photo, suivi, litige. | Fonctionnalité rare chez les généralistes. |
| **Recherche visuelle** | Photographier un article pour trouver les annonces similaires (embeddings produits). | Différenciateur d'usage fort sur mobile. |
| **Mise en vente assistée par IA** | Photo → titre, marque, catégorie, couleurs, matières, taille (lecture d'étiquette), état, taille de colis et **prix suggéré** pré-remplis. | Réduit drastiquement le temps de mise en ligne. |
| **SwapZone** | Une **zone de troc généraliste permanente** (univers visuel sombre, distinct) favorisant la liquidité plutôt que des événements éphémères. | Espace dédié à la culture de l'échange. |
| **Local + national** | Meetup sans frais (Montréal et quartiers) **et** livraison nationale avec étiquette + suivi. | Couvre l'achat local et à distance. |
| **Conformité Loi 25 native** | Décisions automatisées explicables/contestables, consentements, incidents, rétention. | Avance réglementaire sur le marché québécois. |

---

### 1.6 Positionnement vs Vinted / Poshmark

- **Vinted** : modèle de frais très proche (frais acheteur en pourcentage + part fixe). Second reprend ce modèle « vendeur gratuit » mais ajoute le **troc structuré**, la **recherche visuelle**, la **mise en vente IA**, le **meetup local sans frais** et une **conformité Loi 25** taillée pour le Canada/Québec.
- **Poshmark** : prélève une commission vendeur importante. Second se différencie frontalement par le **0 % vendeur**, argument d'acquisition d'offre (plus de vendeurs → plus de catalogue → plus d'acheteurs).
- **Boutiques professionnelles** : Second prévoit une couche **B2B2C** (friperies, dépôts-vente, vintage, luxe, sneakers, etc. — 19 types de boutiques typés) avec **modération admin** (approbation/rejet/suspension) et profil légal canadien, là où les pure-players C2C n'ont pas de parcours pro dédié.

---

### 1.7 Synthèse des grands modules de l'application

L'application est structurée autour de **5 onglets** (Accueil, Favoris, Vendre, Messages, Profil) et de parcours dédiés.

| Module | Ce qu'il fait (métier) | Écrans / parcours clés |
|---|---|---|
| **Découverte & feed** | Page d'accueil personnalisée : sections *discover*, nouveautés, baisses de prix, marques tendance, vendeurs en vedette, SwapZone. | `(tabs)/index`, sections `features/home/*` |
| **Recherche** | Recherche texte + **filtres** (catégorie, marque, taille, état, prix, tri), **recherche visuelle** par photo, **recherches sauvegardées** avec notifications de nouvelles correspondances, historique. | `search`, `visual-search-results`, `saved-searches` |
| **Annonce / article** | Fiche détaillée d'un article, favoris, partage, vendeur, produits similaires, actions (acheter, faire une offre, proposer un échange). | `article/[id]`, `article/edit/[id]` |
| **Mise en vente (IA)** | Capture multi-photos (max 5), **analyse IA** (titre/marque/catégorie/couleur/matière/taille/état/colis/prix), saisie des détails, prix, prévisualisation, publication. Brouillons sauvegardés et reprenables. | `sell/capture` → `photos-review` → `details` → `pricing` → `preview` |
| **Offres & négociation** | Faire une offre, contre-offre, accepter/refuser, expiration automatique des offres. | `MakeOfferModal`, `OfferBubble` (dans le chat) |
| **Troc (swap)** | Proposer un échange d'articles d'un vendeur, avec **complément en argent** (payé via Stripe), preuves photo, suivi, litige. **SwapZone** généraliste permanente. | `propose-swap`, `swap/[id]`, `swap-zone`, `my-swaps` |
| **Messagerie** | Conversations temps réel acheteur ↔ vendeur, bulles spéciales offre/swap. | `(tabs)/messages`, `chat/[id]` |
| **Paiement & checkout** | Choix livraison vs meetup, paiement **Stripe (Payment Sheet natif)**, frais de protection, succès. | `checkout/*`, `payment/[txId]`, `StripePayment` |
| **Livraison & suivi** | Achat d'étiquette ShipEngine, **suivi automatique** du colis, transitions d'état (étiquette → expédié → livré), gestion des échecs/pertes/retours. | `ShipmentTracking`, webhooks + pollers backend |
| **Protection & litiges** | Fonds retenus pendant une **fenêtre de litige de 7 jours**, recours acheteur : **remboursement**, **signalement de problème**, **retour** (étiquette retour, fenêtre 7 j). | `review`/recours, callables `recourse.ts` |
| **Commandes & ventes** | Suivi côté acheteur (mes commandes) et côté vendeur (mes ventes), mes articles, échanges. | `my-orders`, `my-sales`, `my-articles`, `my-swaps` |
| **Portefeuille vendeur** | Solde (disponible/en attente/retenu), historique, **retrait** vers compte bancaire, paiement par wallet. | `wallet`, `walletService`, callables `wallet.ts` |
| **Onboarding Stripe (vendeur)** | Création **Stripe Connect Custom** in-app : identité, compte bancaire, statut de vérification — sans jamais quitter l'app. | `settings/stripe-onboarding`, callables `payments.ts` |
| **Profils & social** | Profil public vendeur (articles, avis, note, abonnés), suivre des vendeurs, avis post-transaction. | `user/[id]`, `liked-sellers`, `review/[txId]` |
| **Boutiques (pro)** | Boutiques professionnelles géolocalisées, typées (19 catégories), avec **modération admin** et profil légal canadien. | `shop/[id]`, `admin/shops`, `admin/shop-detail/[id]` |
| **Compte & réglages** | Profil, adresse, email, mot de passe, téléphone, paiements, options de livraison, notifications, préférences, confidentialité, utilisateurs bloqués, **export de données**, **suppression de compte**, mentions légales. | `settings/*` |
| **Onboarding préférences** | Écran unique : sexe, tailles haut/bas, pointure → personnalisation du feed (étape *skippable*). | `onboarding` |
| **Conformité Loi 25** | Consentements horodatés, **décisions automatisées** explicables et contestables, registre d'incidents, purge de rétention, suppression conforme. | callables `consent.ts`, `automatedDecisions.ts`, `privacyIncidents.ts`, `users.ts` |

---

### 1.8 Authentification et entrée dans l'app

- **Méthodes de connexion** : email/mot de passe, **Google** et **Apple** (connexion sociale). Sur Android, la connexion Google requiert Google Play Services.
- **Visiteur (guest)** : le code gère un suivi visiteur non authentifié et la fusion guest → compte à la connexion (préférences conservées).
- **Porte d'accès (auth gate)** : les actions sensibles (acheter, vendre, messager, favoris) déclenchent une **feuille de connexion** (`AuthBottomSheet`) plutôt qu'un blocage sec.
- **Âge ≥ 16 ans** vérifié **avant** création de compte, avec acceptation des CGU et de la politique de confidentialité (consentements horodatés, version de politique enregistrée).

---

### 1.9 Cycle de vie d'une transaction (états)

Le statut d'une commande suit une machine à états riche, pensée pour la protection de l'acheteur (copies FR côté acheteur/vendeur dans `lib/transactionStatusMeta.ts`) :

`pending_payment` → (`paid`) → `label_created` → `shipped` → `delivered` → **(fenêtre de litige 7 j)** → `completed`.

Branches alternatives gérées : remise en main propre (`meetup_pending` → `meetup_confirmed` → `meetup_completed`), `return_requested` (retour), `delivery_failed`, `lost`, `cancelled`, `disputed`, `refund_in_progress`, `refunded`. La libération des fonds au vendeur n'intervient **qu'après** la fenêtre de litige (fonds « retenus »/held puis « disponibles »).

Le **troc** a sa propre machine à états : `proposed` → `payment_pending` (si complément en argent) → `accepted` → `photos_pending` → `shipping` → `completed`, avec `declined`/`cancelled`/`disputed`.

---

### 1.10 Spécificités iOS vs Android (impact produit)

| Sujet | iOS | Android |
|---|---|---|
| **Notifications push** | **Limite connue, factuelle** : l'app récupère un **token APNs brut** qui n'est **pas exploitable tel quel** pour l'envoi via FCM. Le code détecte ce cas et **n'enregistre pas** ce token, donc **le push iOS n'est pas opérationnel en l'état** (un vrai *FCM registration token* nécessite une étape native FCM, marquée TODO). | **Opérationnel** : token FCM enregistré ; **canaux de notification** dédiés (messages, offres, commandes, recherches sauvegardées, etc.) avec niveaux d'importance. |
| **Connexion Google** | Via client iOS dédié. | Requiert **Google Play Services**. |
| **Connexion Apple** | Native (`expo-apple-authentication`). | Disponible via flux web Apple. |
| **Bottom sheets / overlays** | Comportement standard. | Précautions spécifiques (montage à l'ouverture pour éviter un voile transparent bloquant scroll/clics). |

Conséquence métier : tant que le push iOS n'est pas finalisé, les utilisateurs iOS reçoivent les notifications **in-app** (badge, centre de notifications) mais **pas** les notifications système hors-app de la même manière qu'Android. À signaler dans tout dossier produit comme un point d'achèvement technique connu.

---

### 1.11 Données clés (en langage métier)

- **Article** : photos, titre, marque, catégorie, couleurs, matières, taille (système de taille normalisé), état (`neuf`, `très bon état`, `bon état`, `satisfaisant`), prix, taille de colis, état de vente (actif/vendu), éventuel rattachement à une **boutique**.
- **Utilisateur** : profil public (nom, @pseudo persistant immuable, bio, avatar, tags de style, note, ventes, abonnés), préférences (sexe, tailles), adresse, consentements Loi 25.
- **Boutique** : propriétaire, type (19 catégories), adresse + **géolocalisation** (recherche par rayon), coordonnées, horaires, statut de modération (`pending`/`approved`/`rejected`/`suspended`), profil légal canadien (NEQ/BN, TPS, TVQ, coordonnées bancaires).
- **Transaction** : montant, frais de service, coût de livraison, mode (livraison/meetup), statut, références Stripe et étiquette/suivi.
- **Swap** : articles échangés, complément en argent éventuel, statut, preuves photo.
- **Wallet** : solde disponible / en attente / retenu, mouvements, retraits.

---

### 1.12 À retenir (résumé exécutif)

1. Marketplace mobile **iOS + Android** de seconde main, **mono-FR**, calibrée **Canada (CAD, Loi 25)**.
2. **0 % commission vendeur** ; revenu via **frais de protection acheteur** (5 % + 1,50 $, plancher 2 $) — **aucun frais sur le meetup**.
3. Paiement **white-label Stripe Connect Custom** : le vendeur ne quitte jamais l'app.
4. Différenciateurs forts : **troc structuré**, **recherche visuelle**, **mise en vente assistée par IA**, **SwapZone** permanente, **protection acheteur** avec fenêtre de litige et retours.
5. Couche **boutiques pro** opérationnelle (modération admin, profil légal canadien), mais la **réduction de frais payante par forfait** (le levier de monétisation des boutiques) **n'est pas encore implémentée** dans le moteur de frais.
6. Limite technique connue : **push iOS non opérationnel** en l'état (token APNs non exploitable via FCM).
