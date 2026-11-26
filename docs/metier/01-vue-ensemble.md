## 01. Vue d'ensemble & proposition de valeur

> Document métier destiné à un lecteur informé non-technique (fondateur, associé, investisseur, dossier immigration/incubateur, nouvel arrivant produit). Il décrit ce que l'application **fait réellement** d'après le code, pas une feuille de route. Chaque affirmation ci-dessous a été vérifiée dans le dépôt. Quand une fonctionnalité est **codée mais éteinte**, ou quand un cas n'est **pas géré**, c'est écrit noir sur blanc.

---

### 1.1 En une phrase

**Second** est une marketplace mobile de **mode et d'objets de seconde main**, pensée pour le marché **canadien francophone**, où l'on **achète, vend et échange (troc)** des articles entre particuliers et boutiques professionnelles. L'application est disponible sur **iOS et Android** (application Expo / React Native), mono-langue français.

Le positionnement repose sur une promesse simple et lisible : **le vendeur garde 100 % du prix de son article (0 % de commission vendeur)**. La plateforme se rémunère exclusivement via des **frais de protection payés par l'acheteur**, à la manière de Vinted, et non via une commission prélevée au vendeur comme Poshmark.

**Nuance essentielle, à lire avant tout le reste :** l'infrastructure complète (paiement en ligne, étiquette d'expédition, suivi, séquestre des fonds, recours acheteur) est **écrite et testée**, mais elle est **éteinte par un drapeau produit**. Aujourd'hui, le **seul parcours d'achat réellement disponible est la remise en main propre (meetup)**, dans laquelle **aucun argent ne transite par la plateforme**. Voir 1.2.

---

### 1.2 État réel du produit aujourd'hui

Deux interrupteurs pilotent tout le volet financier : un côté application (`config/featureFlags.ts`) qui masque les écrans, et un côté serveur (`functions/src/config/featureFlags.ts`) qui refuse les opérations. Les deux sont **fermés**.

| Brique | État aujourd'hui | Où c'est décidé |
|---|---|---|
| **Livraison** (achat d'étiquette, suivi colis, adresse de livraison) | **ÉTEINTE.** Les blocs d'UI livraison sont masqués, tout nouvel article est forcé en « main à main », et le serveur refuse toute transaction/paiement de type expédition. | `config/featureFlags.ts` → `SHIPPING_ENABLED = false` ; `functions/src/config/featureFlags.ts` (variable d'environnement `SHIPPING_ENABLED`) |
| **Paiement en ligne d'un achat** | **INACCESSIBLE.** Le paiement n'existe que sur le rail expédition, lui-même éteint. Le bouton d'achat d'une fiche article affiche « PROPOSER UN ACHAT » et non « ACHETER · prix ». | conséquence de `SHIPPING_ENABLED` |
| **Écrans Paiements** (porte-monnaie, onboarding Stripe vendeur) | **MASQUÉS.** La section « Paiements » des réglages n'apparaît pas ; les écrans `wallet` et `settings/stripe-onboarding` redirigent vers les réglages si on y accède directement. | `config/featureFlags.ts` → `PAYMENTS_ENABLED = false` |
| **Achat en main propre (meetup)** | **ACTIF — c'est le seul parcours d'achat vivant.** Proposition via le chat, confirmation vendeur, puis confirmation de l'échange par l'une des deux parties. Zéro argent plateforme, zéro frais. | non concerné par les drapeaux |
| **Troc (swap) sans argent** | **ACTIF.** Proposition, acceptation, preuves photo, suivi, litige. | — |
| **Troc avec complément en argent** | **Codé et non masqué**, mais **bloqué en pratique** : le bénéficiaire du complément doit avoir un compte de paiement Stripe actif (encaissement **et** versement), or l'écran qui permet de le créer est masqué par `PAYMENTS_ENABLED`. | `functions/src/callable/swaps.ts` |
| **Forfaits boutique payants** | **Codés et facturables** (voir 1.5b). Non masqués par un drapeau. | `functions/src/callable/shopTier.ts`, `app/shop/upgrade.tsx` |
| **Notifications push iOS** | **NON OPÉRATIONNELLES** (voir 1.11). | `features/notifications/hooks/useNotificationSetup.ts` |

**Conséquence métier à assumer dans tout dossier externe :** en l'état, Second est un produit **catalogue + découverte + messagerie + rencontre locale + troc**. Le moteur de revenu est écrit, testé et prêt, mais **il n'encaisse rien tant que la livraison n'est pas rallumée** — à l'exception des forfaits boutique, qui sont le seul canal de revenu techniquement encaissable aujourd'hui.

Deux trous produit constatés dans le code, à traiter avant toute ouverture commerciale :
- **Aucun écran de création de boutique.** La fonction de création existe côté service et les règles de sécurité l'autorisent, mais **aucun écran de l'application ne l'appelle** : une boutique ne peut aujourd'hui naître que par une intervention manuelle en base. Or l'achat d'un forfait exige une boutique **déjà approuvée**.
- **Fonds potentiellement inaccessibles.** Un complément de troc encaissé crédite le porte-monnaie interne du bénéficiaire, mais l'écran du porte-monnaie est masqué : l'argent est bien inscrit au registre, il n'est simplement pas consultable ni retirable depuis l'app tant que `PAYMENTS_ENABLED` reste fermé.

---

### 1.3 Mission et marché visé

**Mission.** Rendre la revente de vêtements et d'objets de seconde main aussi simple, rapide et fiable qu'un achat neuf, en levant trois frictions classiques :
1. **La mise en vente est longue** → Second propose une **mise en vente assistée par IA** (photos → genre, catégorie, titre, description, état, couleur, matières, taille lue sur l'étiquette, marque, taille de colis pré-remplis). **Le prix n'est pas suggéré par l'IA** : le vendeur le saisit lui-même.
2. **La confiance manque** → Second sécurise l'argent, gère la livraison et offre des recours à l'acheteur… **sur le rail expédition uniquement, aujourd'hui éteint**. Sur le rail meetup actuellement actif, la protection se limite au signalement de non-présentation (« no-show ») qui ouvre un litige arbitré par un humain, au blocage/signalement d'un utilisateur, et aux avis publics.
3. **Le prix freine** → Second supprime la commission vendeur (le vendeur touche tout) et permet le **troc** (échange d'articles, avec éventuel complément en argent).

**Marché visé.** Le marché de la mode circulaire au **Canada**, principalement la **Gen Z et les millennials** sensibles à la durabilité et au pouvoir d'achat. Le produit est **mono-langue français** (cible Québec / francophonie canadienne en priorité). Toute l'ergonomie « locale » est calibrée Canada :

| Spécificité Canada | Implémentation réelle |
|---|---|
| Devise | **CAD** partout. Affichage catalogue à la canadienne-française (`45 $`, virgule décimale), et `45,00 $ CA` dans les contextes sensibles (paiement, solde, retrait) — `utils/formatPrice.ts`. |
| Destination de livraison | **Canada uniquement** : le serveur force le pays à `CA`, rejette toute autre valeur, et exige un code postal au format canadien (`A1A1A1`) plus l'un des 13 codes de province/territoire — `functions/src/callable/payments/address.ts`. (Rail actuellement éteint.) |
| Rencontres locales | Les lieux de rendez-vous proposés reposent sur une liste de **quartiers de Montréal par arrondissement** (`data/neighborhoods.ts`). Hors Montréal, il reste l'option « à convenir par messagerie ». |
| Identité fiscale boutique | Le profil légal d'une boutique prévoit **NEQ** (Québec) ou BN fédéral, **n° de TPS** et **n° de TVQ** (`types/shop.ts`). |
| Coordonnées bancaires boutique | Champs **transit (5 chiffres)**, **institution (3 chiffres)**, **compte (7–12 chiffres)** — format bancaire canadien. |
| Taxes | Infrastructure TPS (5 %) / TVQ (9,975 %) présente mais **désactivée par défaut** (`TAX_ENABLED=false`), et calculée **uniquement sur les frais de service**, pas sur le prix de l'article ni sur la livraison. L'activation est une **décision fiscale** (immatriculation TPS/TVQ requise), pas technique. |
| Vie privée | Conformité **Loi 25** (Québec) intégrée : consentements horodatés avec version de politique, décisions automatisées explicables et contestables, registre d'incidents avec escalade CAI, purge de rétention planifiée, export et suppression de compte. |
| Âge légal | **16 ans et plus pour s'inscrire, naviguer et acheter** ; **18 ans et plus pour vendre** (exigence du compte de versement Stripe). L'âge est vérifié **avant** la création du compte. Un compte de 16-17 ans peut tout faire sauf ouvrir l'onglet Vendre (`utils/age.ts`). |

---

### 1.4 Proposition de valeur

**Pour le vendeur (particulier ou boutique)**
- **0 % de commission** : il reçoit l'intégralité du prix affiché. Le moteur de frais fixe explicitement le versement vendeur au prix de l'article (`functions/src/utils/fees.ts`).
- **Mise en vente en quelques minutes** grâce à l'IA qui pré-remplit la fiche à partir des photos (jusqu'à 5 photos), avec brouillon sauvegardé et reprenable. Le prix reste à sa main.
- **Encaissement automatisé et white-label** : compte **Stripe Connect Custom** créé et géré entièrement dans l'app — le vendeur **ne va jamais sur Stripe**. *Non disponible aujourd'hui : écran masqué par `PAYMENTS_ENABLED`.*
- **Logistique gérée** : étiquette d'expédition achetée dans l'app et suivi automatique. *Non disponible aujourd'hui : `SHIPPING_ENABLED` fermé.* Reste la remise en main propre, sans frais.

**Pour l'acheteur**
- **Protection incluse** dans les frais de service : paiement sécurisé, fonds retenus jusqu'à la fin de la fenêtre de litige de 7 jours, remboursement automatique si le transporteur déclare le colis perdu ou en échec de livraison, réclamation sur colis livré, retour avec étiquette. **Tous ces recours sont conditionnés à une commande expédiée** — donc indisponibles tant que la livraison est éteinte.
- **Sur le rail meetup actif** : pas de séquestre, pas de remboursement plateforme (l'argent est échangé de la main à la main). Le recours réel est le **signalement de non-présentation**, qui débloque l'article, gèle la transaction et **ouvre un litige examiné par un humain**.
- **Découverte riche** : accueil personnalisé, recherche texte + filtres, **recherche visuelle par photo**, produits similaires, recherches sauvegardées avec alerte.
- **Négociation et troc** : faire une offre, proposer un échange d'articles.

**Pour la plateforme**
- Un modèle de revenu **transparent et défendable** côté acheteur, aligné sur le standard du marché (Vinted), tout en restant le plus attractif pour les vendeurs.

---

### 1.5 Modèle de revenu

#### a) Frais de protection acheteur (revenu cœur — moteur en place, non encaissé aujourd'hui)

Formule, paramétrable par variables d'environnement (`functions/src/utils/fees.ts`) :

> **Frais = max( 2,00 $ ; 5 % du prix de l'article + 1,50 $ )**

| Prix article | Frais de protection acheteur | L'acheteur paie (hors livraison) | Le vendeur reçoit |
|---|---|---|---|
| 5 $ | 2,00 $ (plancher) | 7,00 $ | 5,00 $ |
| 15 $ | 2,25 $ | 17,25 $ | 15,00 $ |
| 30 $ | 3,00 $ | 33,00 $ | 30,00 $ |
| 50 $ | 4,00 $ | 54,00 $ | 50,00 $ |
| 100 $ | 6,50 $ | 106,50 $ | 100,00 $ |

**Comment l'argent circule réellement (correction importante).** Le paiement n'est **pas** une « charge destinée au compte du vendeur avec commission prélevée ». C'est une **charge directe sur le compte de la plateforme** : l'intégralité de ce que paie l'acheteur atterrit chez Second. Le vendeur n'est **jamais** payé par Stripe automatiquement ; il est crédité dans le **porte-monnaie interne** de l'application (registre unique), puis se fait verser son solde par un virement déclenché au moment du retrait. Ce choix « rail unique » évite tout double paiement et garde la maîtrise du séquestre.

**Ce que couvrent les frais** (formalisé dans le code) : protection acheteur (litige, remboursement), traitement du paiement, support client, infrastructure (hébergement, API de livraison).

**Règles vérifiées :**
- **Vente en main propre (meetup) : aucun frais de service** — la transaction est enregistrée avec des frais à zéro et aucun mouvement d'argent. Choix produit qui sacrifie le revenu sur le local pour maximiser l'adoption.
- **Complément de troc : frais pleins.** Un complément en argent dans un échange est facturé au tarif plein, **sans jamais bénéficier de la réduction d'un forfait boutique** (un troc entre particuliers n'est pas une vente de boutique).
- **Taxes : à zéro par défaut.** Tant que `TAX_ENABLED` reste fermé, le total payé par l'acheteur est strictement celui du tableau ci-dessus.

#### b) Forfaits boutique payants (implémenté depuis la dernière version de ce document)

La monétisation des boutiques ne réintroduit **jamais** une commission vendeur : elle se vend comme une **réduction des frais payés par les acheteurs de la boutique**, donc comme un avantage compétitif sur le prix final affiché.

| Forfait | Nom commercial | Prix | Bénéfice vendu |
|---|---|---|---|
| **basic** | Standard | gratuit | Frais acheteur standard |
| **pro** | Le Comptoir | **29,99 $/mois** | **-50 %** sur les frais de protection payés par ses acheteurs |
| **premium** | La Maison | **79,99 $/mois** | **-100 %** : aucun frais de protection pour ses acheteurs |

Règles de gestion vérifiées (`functions/src/callable/shopTier.ts`, `functions/src/callable/payments/feeReduction.ts`) :
- La boutique doit être **approuvée** par l'administration pour pouvoir souscrire ; une boutique en attente, rejetée ou suspendue est refusée (on n'encaisse pas un forfait qui ne donnerait aucun bénéfice, aucun remboursement automatique n'existant).
- Le forfait s'achète **d'avance, de 1 à 12 mois**, par une charge directe sur le compte de la plateforme.
- Le forfait n'est **jamais accordé avant que l'argent soit encaissé** : c'est le serveur, à réception de la confirmation de paiement, qui inscrit le forfait et sa date d'expiration. Le client ne peut pas s'auto-attribuer un forfait (verrouillé dans les règles de sécurité).
- La réduction ne s'applique **que tant que le forfait est actif** : à l'expiration, la boutique repasse automatiquement au tarif standard.
- La réduction est **toujours recalculée côté serveur** à partir de la boutique du vendeur, jamais transmise par l'application. En cas d'échec de lecture, on applique le tarif plein (jamais de cadeau par accident).
- La commission vendeur reste **0 %** dans tous les forfaits.

**Limite connue :** faute d'écran de création de boutique dans l'application (voir 1.2), ce revenu n'est pas activable en autonomie par un professionnel aujourd'hui.

#### c) Porte-monnaie (wallet)

Registre interne à trois compartiments : **disponible**, **en attente** (vente payée, colis pas encore livré) et **retenu** (livré, fenêtre de litige en cours). Il sert de rail unique de versement au vendeur, de réceptacle des remboursements, et de moyen de paiement d'appoint (paiement mixte porte-monnaie + carte). Le retrait vers le compte bancaire du vendeur passe par un virement Stripe. **Écran masqué aujourd'hui** (`PAYMENTS_ENABLED`).

---

### 1.6 Différenciateurs

| Différenciateur | Détail concret | Vs concurrence |
|---|---|---|
| **0 % commission vendeur** | Le vendeur encaisse 100 % du prix. | Poshmark prélève ~20 % au vendeur ; Second est nettement plus attractif côté offre. |
| **Frais 100 % acheteur, transparents** | 5 % + 1,50 $, plancher 2 $. | Aligné sur Vinted (5 % + part fixe). |
| **Forfait boutique = frais acheteur réduits** | Une boutique paie un abonnement pour que **ses acheteurs** paient moins (-50 % ou -100 %), sans jamais rétablir de commission vendeur. | Monétisation B2B qui n'abîme pas la promesse C2C. |
| **Paiement white-label (Stripe Connect Custom)** | Le vendeur ne voit jamais Stripe ; identité et compte bancaire saisis dans l'app. La plateforme porte KYC, conformité et litiges. *(éteint aujourd'hui)* | Expérience plus intégrée que les marketplaces redirigeant vers un tableau de bord tiers. |
| **Troc / échange (swap)** | Échange d'articles avec **un seul et même vendeur** par échange, complément en argent possible, preuves photo, suivi, litige. | Fonctionnalité rare chez les généralistes. |
| **Recherche visuelle** | Photographier un article pour trouver les annonces similaires (empreintes visuelles multimodales). | Différenciateur d'usage fort sur mobile. |
| **Mise en vente assistée par IA** | Photos → genre, catégorie, titre, description, état, couleur, matières, taille (lecture d'étiquette), marque et taille de colis pré-remplis. **Le prix reste saisi par le vendeur.** | Réduit fortement le temps de mise en ligne. |
| **SwapZone** | Une **zone de troc généraliste permanente**, ouverte à tous, à l'identité visuelle sombre distincte, favorisant la liquidité plutôt que des événements éphémères. | Espace dédié à la culture de l'échange. |
| **Local** | Meetup sans frais, lieux de rendez-vous par quartier de Montréal, confirmation à deux, signalement de non-présentation avec litige arbitré. | Couvre l'achat local — la couverture nationale attend la réouverture de la livraison. |
| **Conformité Loi 25 native** | Consentements horodatés, décisions automatisées explicables et contestables, registre d'incidents avec escalade CAI, purge de rétention. | Avance réglementaire sur le marché québécois. |

---

### 1.7 Positionnement vs Vinted / Poshmark

- **Vinted** : modèle de frais très proche (frais acheteur en pourcentage + part fixe). Second reprend ce modèle « vendeur gratuit » mais ajoute le **troc structuré**, la **recherche visuelle**, la **mise en vente assistée par IA**, le **meetup local sans frais** et une **conformité Loi 25** taillée pour le Québec.
- **Poshmark** : prélève une commission vendeur importante. Second se différencie frontalement par le **0 % vendeur**, argument d'acquisition d'offre (plus de vendeurs → plus de catalogue → plus d'acheteurs).
- **Boutiques professionnelles** : Second prévoit une couche **B2B2C** (friperies, dépôts-vente, vintage, luxe, sneakers, etc. — **20 types de boutiques** typés) avec **modération administrateur** (approbation / rejet / suspension), profil légal canadien et forfaits payants, là où les pure-players C2C n'ont pas de parcours pro dédié. Réserve : le parcours d'inscription d'une boutique n'existe pas encore dans l'app.

---

### 1.8 Synthèse des grands modules de l'application

L'application est structurée autour de **5 onglets**, dans cet ordre : **Accueil, Messages, Vendre, Favoris, Profil**.

| Module | Ce qu'il fait (métier) | Écrans / parcours clés |
|---|---|---|
| **Découverte & accueil** | Accueil en sections successives : nouveautés, SwapZone, marques tendance, vendeurs en vedette, « Pour toi » (personnalisé), baisses de prix, grille de découverte. | `app/(tabs)/index.tsx`, `features/home/` |
| **Recherche** | Recherche texte + **filtres** (catégorie, marque, taille, état, prix, tri), **recherche visuelle** par photo, **recherches sauvegardées** avec alerte de nouvelles correspondances (tâche planifiée), historique de recherche (utilisateur connecté). | `app/search.tsx`, `app/visual-search-results.tsx`, `app/saved-searches.tsx` |
| **Annonce / article** | Fiche détaillée, favoris, partage, vendeur, produits similaires, actions : offre, achat (libellé « PROPOSER UN ACHAT » tant que la livraison est éteinte), proposition d'échange. | `app/article/[id].tsx`, `app/article/edit/[id].tsx` |
| **Mise en vente (IA)** | Capture multi-photos (**5 max**), **analyse IA**, saisie des détails, prix, prévisualisation, publication. Brouillons sauvegardés et reprenables. Accès réservé aux **18 ans et plus**, et aux comptes email **dont l'adresse est vérifiée**. | `app/sell/capture` → `photos-review` → `details` → `pricing` → `preview` |
| **Offres & négociation** | Faire une offre, contre-offre, accepter/refuser, expiration automatique des offres (tâches planifiées). | `features/offers/` (bulles d'offre dans le chat) |
| **Troc (swap)** | Proposer un échange avec un seul vendeur, complément en argent possible, preuves photo, suivi, litige, expiration automatique des échanges abandonnés. **SwapZone** généraliste permanente. | `app/propose-swap.tsx`, `app/swap/[id].tsx`, `app/swap-zone.tsx`, `app/my-swaps.tsx` |
| **Messagerie** | Conversations temps réel acheteur ↔ vendeur, bulles spéciales offre / meetup / échange. | `app/(tabs)/messages.tsx`, `app/chat/[id].tsx` |
| **Achat en main propre (actif)** | Choix d'un lieu de rendez-vous (quartiers de Montréal) ou « à convenir par messagerie », offre envoyée dans le chat, acceptation par l'autre partie, confirmation du rendez-vous, puis confirmation de l'échange **par l'acheteur ou le vendeur**. Signalement de non-présentation possible tant que le rendez-vous est ouvert. | `app/checkout/index.tsx`, `app/checkout/meetup.tsx`, `app/checkout/success.tsx` |
| **Paiement & checkout expédition** | Adresse, tarif de livraison, paiement Stripe (feuille de paiement native), paiement mixte porte-monnaie + carte. **Éteint.** | `app/checkout/shipping.tsx`, `app/payment/[transactionId].tsx` |
| **Livraison & suivi** | Achat d'étiquette ShipEngine, suivi automatique du colis, transitions d'état, gestion des échecs / pertes / retours. **Éteint.** | webhooks + tâches planifiées serveur |
| **Protection & litiges** | Fonds retenus pendant **7 jours à compter de la livraison confirmée par le transporteur**, puis libérés. Recours acheteur : remboursement automatique (colis perdu ou échec de livraison), réclamation sur colis livré, demande de retour. **Tous conditionnés au rail expédition.** Côté meetup : signalement de non-présentation → litige humain. | `functions/src/callable/recourse.ts`, `app/admin/disputes.tsx` |
| **Commandes & ventes** | Suivi côté acheteur et côté vendeur, mes articles, mes échanges. | `app/my-orders.tsx`, `app/my-sales.tsx`, `app/my-articles.tsx`, `app/my-swaps.tsx` |
| **Portefeuille vendeur** | Solde (disponible / en attente / retenu), historique, retrait vers compte bancaire. **Masqué.** | `app/wallet.tsx` |
| **Onboarding Stripe (vendeur)** | Création du compte de paiement in-app : identité, compte bancaire, statut de vérification, sans jamais quitter l'app. **Masqué.** | `app/settings/stripe-onboarding.tsx`, `app/settings/bank-account.tsx` |
| **Profils & social** | Profil public vendeur (articles, avis, note, abonnés), suivre des vendeurs, avis post-transaction. | `app/user/[id].tsx`, `app/liked-sellers.tsx`, `app/review/[transactionId].tsx` |
| **Boutiques (pro)** | Fiche boutique géolocalisée et typée (20 catégories), **modération administrateur**, profil légal canadien, **achat de forfait par le propriétaire**. Pas d'écran de création. | `app/shop/[id].tsx`, `app/shop/upgrade.tsx`, `app/admin/shops.tsx`, `app/admin/shop-detail/[id].tsx` |
| **Administration** | Modération des boutiques, traitement des signalements, arbitrage des litiges. Accès verrouillé par un droit administrateur vérifié à l'entrée et redoublé par les règles de sécurité. | `app/admin/` |
| **Compte & réglages** | Profil, adresse, email, mot de passe, téléphone, préférences, notifications, confidentialité, utilisateurs bloqués, **export de données**, **suppression de compte**, mentions légales. | `app/settings/` |
| **Onboarding préférences** | Écran d'accueil de personnalisation du feed, **passable à tout moment**. | `app/onboarding.tsx` |
| **Conformité Loi 25** | Consentements horodatés, décisions automatisées explicables et contestables, registre d'incidents avec escalade CAI et notification des personnes concernées, purge de rétention planifiée, suppression conforme. | `functions/src/callable/consent.ts`, `automatedDecisions.ts`, `privacyIncidents.ts`, `users.ts` |

---

### 1.9 Authentification et entrée dans l'app

- **Méthodes de connexion** : email/mot de passe, **Google** et **Apple**.
- **Apple : iOS uniquement.** Le bouton n'est proposé que sur iPhone, et seulement après vérification que le service est disponible sur l'appareil. Il n'existe **aucun** repli web sur Android — un compte créé via Apple n'est donc pas reconnectable depuis un Android.
- **Google** : requiert Google Play Services (message d'erreur explicite si absent).
- **Visiteur (guest)** : une session visiteur est créée dès le premier lancement pour conserver les préférences et le suivi ; elle est **fusionnée** dans le compte à la connexion.
- **Porte d'accès (auth gate)** : les actions sensibles (favori, message, achat, vente, suivre un vendeur) ouvrent une **feuille de connexion** contextualisée plutôt qu'un blocage sec.
- **Âge** : **16 ans minimum** vérifié **avant** création du compte (pas de compte orphelin), avec acceptation des CGU et de la politique de confidentialité, horodatée avec la version de politique. **18 ans minimum pour vendre** : un compte de 16-17 ans voit l'onglet Vendre refusé avec un message d'explication.
- **Vente et email** : un compte créé par email doit avoir **vérifié son adresse** avant de pouvoir publier ; le blocage est appliqué côté serveur, et anticipé côté app pour ne pas faire remplir tout le formulaire pour rien.

---

### 1.10 Cycle de vie d'une transaction (états)

Le statut d'une commande suit une machine à états de **16 statuts** (`types/transaction.ts`), avec des libellés français distincts côté acheteur et côté vendeur (`features/orders/lib/transactionStatusMeta.ts`).

**Rail expédition (éteint aujourd'hui)** : `pending_payment` → `paid` → `label_created` → `shipped` → `delivered` → **fenêtre de litige de 7 jours à compter de la livraison** → `completed`. Branches : `return_requested`, `delivery_failed`, `lost`, `disputed`, `refund_in_progress`, `refunded`, `cancelled`. La libération des fonds au vendeur n'intervient **qu'après** la fenêtre de litige (passage de « retenu » à « disponible »).

**Rail meetup (le seul actif)** : `meetup_pending` → `meetup_confirmed` → `meetup_completed`. **Aucun argent ne transite par la plateforme** : la confirmation finale ne crédite aucun porte-monnaie et n'écrit aucune écriture comptable ; elle sert à clore la transaction, libérer l'article et débloquer l'avis. Les deux parties peuvent la déclencher (protection contre la transaction fantôme), et une tâche planifiée annule automatiquement les rendez-vous abandonnés pour que l'article ne reste jamais bloqué. En cas de non-présentation, la transaction bascule en `disputed`, l'article est remis en vente et un litige est ouvert pour examen humain ; la personne **visée** par le signalement peut y joindre sa version **une seule fois** (bouton « Donner ma version » dans la bulle d'offre), ce qui ne rouvre rien et ne dégèle rien, mais verse sa contre-déclaration au dossier et prévient le premier signaleur que sa version est contestée.

**Le troc** a sa propre machine à états : `proposed` → `payment_pending` (si complément en argent) → `accepted` → `photos_pending` → `shipping` → `completed`, avec `declined`, `cancelled`, `disputed` et `expired`.

---

### 1.11 Spécificités iOS vs Android (impact produit)

| Sujet | iOS | Android |
|---|---|---|
| **Notifications push** | **Limite connue.** L'app récupère un **jeton APNs brut**, inexploitable tel quel pour un envoi via FCM. Le code détecte ce cas et **n'enregistre pas** le jeton : le **push iOS n'est donc pas opérationnel**. Un vrai jeton FCM exige une étape native, identifiée et non faite. | **Opérationnel** : jeton FCM enregistré, canaux de notification dédiés (messages, offres, commandes, recherches sauvegardées…) avec niveaux d'importance. |
| **Connexion Google** | Disponible. | Disponible, requiert Google Play Services. |
| **Connexion Apple** | Native. | **Indisponible** — aucun repli web. |
| **Feuilles/superpositions** | Comportement standard. | Précaution spécifique (montage à l'ouverture) pour éviter un voile transparent bloquant le défilement et les clics. |

Conséquence métier : tant que le push iOS n'est pas finalisé, les utilisateurs iOS voient les notifications **dans l'app** (badge, centre de notifications) mais **ne reçoivent rien hors application**. À signaler comme point d'achèvement technique connu dans tout dossier produit.

---

### 1.12 Données clés (en langage métier)

- **Article** : photos (5 max), titre, description, marque, catégorie, couleurs, matières, taille (système normalisé), **état parmi 5 valeurs** (neuf avec étiquette, neuf sans étiquette, très bon état, bon état, satisfaisant), prix, taille de colis, modes de remise (main à main / expédition), état de vente, éventuel rattachement à une **boutique**.
- **Utilisateur** : profil public (nom, @pseudo, bio, avatar, note, ventes, abonnés), date de naissance (portes d'âge 16/18), préférences de personnalisation, adresse, consentements Loi 25.
- **Boutique** : propriétaire, type (20 catégories), adresse + **géolocalisation** (recherche par rayon), coordonnées, horaires, statut de modération (`pending`/`approved`/`rejected`/`suspended`), profil légal canadien (NEQ/BN, TPS, TVQ, coordonnées bancaires), **forfait payant et sa date d'expiration** (écrits par le serveur uniquement).
- **Transaction** : montant, frais de service, réduction de forfait appliquée, taxes, coût de livraison, mode (expédition / main propre), statut, références de paiement et d'étiquette/suivi, lieu de rendez-vous.
- **Échange (swap)** : articles échangés, complément en argent éventuel et son payeur, statut, preuves photo.
- **Porte-monnaie** : soldes disponible / en attente / retenu, mouvements, retraits.

---

### 1.13 À retenir (résumé exécutif)

1. Marketplace mobile **iOS + Android** de seconde main, **mono-FR**, calibrée **Canada (CAD, Loi 25, 16 ans pour acheter / 18 pour vendre)**.
2. **État réel : seul le parcours « main propre » est ouvert.** Livraison et paiement en ligne sont écrits, testés, et **éteints par deux drapeaux** (application + serveur). Aucun argent d'achat ne transite par la plateforme aujourd'hui.
3. **0 % commission vendeur** ; revenu prévu via **frais de protection acheteur** (5 % + 1,50 $, plancher 2 $), **aucun frais sur le meetup**. Le paiement est une **charge directe plateforme** : le vendeur est crédité dans un porte-monnaie interne, puis versé au retrait — pas de commission prélevée sur un versement automatique.
4. **Forfaits boutique désormais implémentés** : Le Comptoir 29,99 $/mois (-50 % de frais acheteur), La Maison 79,99 $/mois (0 % de frais acheteur), payés d'avance de 1 à 12 mois, accordés seulement après encaissement et seulement à une boutique approuvée, expirant automatiquement.
5. Différenciateurs forts : **troc structuré + SwapZone permanente**, **recherche visuelle**, **mise en vente assistée par IA** (sans suggestion de prix), **meetup local sans frais**, **protection acheteur** complète… cette dernière étant suspendue avec la livraison.
6. Trous produit assumés à traiter : **pas d'écran de création de boutique** (donc forfait non souscriptible en autonomie), **push iOS non opérationnel**, **connexion Apple absente sur Android**, et **fonds de complément de troc non consultables** tant que les écrans Paiements restent masqués.
