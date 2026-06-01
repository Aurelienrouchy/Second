## 18. Architecture & opérations (annexe技)

> Annexe technique rédigée pour un lecteur informé mais non-technique (fondateur, investisseur, dossier immigration/incubateur). Elle décrit **comment l'application Second fonctionne sous le capot**, en langage métier : de quoi est faite la plateforme, quels « robots » serveur tournent en coulisse, comment l'argent et les données sont protégés, et quelles limites connues subsistent. Source de vérité : le code réel (`functions/src/`, `firestore.rules`, `app.config.js`, `firebase.json`, `eas.json`).

---

### 18.1 Vue d'ensemble en une phrase

Second est une **application mobile** (un seul code pour iPhone et Android) qui se connecte à un **back-office hébergé chez Google (Firebase)** situé physiquement au **Canada** (région de Montréal). Les paiements passent par **Stripe** (en mode « marque blanche », le vendeur ne voit jamais Stripe) et les livraisons par **ShipEngine** (qui regroupe plusieurs transporteurs canadiens). Toute opération sensible — argent, changement de statut d'une commande, suppression de compte — n'est jamais faite par le téléphone lui-même : elle est exécutée par un programme serveur de confiance.

---

### 18.2 La pile technologique, expliquée simplement

| Brique | Ce que c'est | Rôle métier |
|---|---|---|
| **Application mobile (Expo / React Native)** | Un seul programme qui devient à la fois l'app iPhone et l'app Android | Tout ce que l'utilisateur voit et touche : écrans, photos, panier, messagerie |
| **Firebase (Google Cloud)** | L'« usine » serveur louée à Google | Stocke les données, héberge les robots serveur, gère la connexion des comptes |
| **Firestore** | La base de données | Articles, utilisateurs, commandes, messages, avis, échanges, soldes vendeurs |
| **Cloud Functions** | Des petits programmes serveur déclenchés à la demande ou automatiquement | Le « cerveau » des opérations sensibles (paiement, expédition, modération) |
| **Stripe Connect Custom** | Le système de paiement, en marque blanche | Encaisse l'acheteur, reverse au vendeur, gère les comptes bancaires des vendeurs |
| **ShipEngine** | L'agrégateur de transporteurs | Calcule les tarifs, génère les étiquettes, suit les colis (Intelcom/Dragonfly, Postes Canada) |
| **Gemini (Google AI)** | L'intelligence artificielle | Analyse les photos d'articles, recherche visuelle, profils de style |

**Détails techniques confirmés dans le code** : application en TypeScript strict, moteur JavaScript Hermes, identifiants `com.seconde.app` (iOS et Android), nom commercial « Seconde ». Côté serveur, les fonctions tournent sur **Node.js 20**, avec les bibliothèques `firebase-admin` v13 et `firebase-functions` v7, le SDK Stripe v22 (version d'API figée au `2026-04-22.dahlia`). Le projet Firebase est `seconde-b47a6`.

---

### 18.3 Où vivent les données : le Canada par défaut

Toutes les Cloud Functions sont déployées dans **une seule région : `northamerica-northeast1` (Montréal)**. C'est vérifié sur chaque fonction du catalogue — pas d'exception. Conséquences métier :

- **Conformité Loi 25 (Québec) / résidence des données** : les traitements serveur ont lieu au Canada, ce qui simplifie le discours de conformité vis-à-vis des renseignements personnels.
- **Latence** : les utilisateurs canadiens parlent à un serveur proche d'eux, donc des temps de réponse courts.
- **Devise** : tout le modèle financier est libellé en **CAD** (dollars canadiens). Les frais de protection, les tarifs de livraison, les soldes vendeurs sont en CAD.

Chaque fonction réserve aussi **au minimum 512 Mo de mémoire** (et non les 256 Mo par défaut) : c'est une décision opérationnelle pour éviter les plantages, car toutes les fonctions partagent un même paquet de code volumineux.

---

### 18.4 Le catalogue des « robots » serveur (Cloud Functions)

Le back-office compte environ **75 fonctions serveur** réparties en quatre familles. Voici leur rôle métier.

#### A. Fonctions « à la demande » (callables) — déclenchées par une action de l'utilisateur

Ce sont les fonctions que l'app appelle directement quand l'utilisateur fait quelque chose. Les principales :

**Vente & catalogue**
- `analyzeProductImage` — analyse une photo d'article par IA (catégorie, marque, état suggérés) au moment de la mise en vente.
- `createArticle` / `updateArticle` — créent et modifient les fiches articles côté serveur (pour garantir la cohérence des données de recherche).
- `incrementProductView`, `toggleProductLike`, `toggleArticleSold` — compteur de vues, likes, et bascule « vendu ».
- `visualSearch`, `getSimilarProducts`, `backfillEmbeddings` — recherche par l'image et suggestions d'articles similaires (basées sur l'IA).

**Paiement, livraison & commandes**
- `getShippingEstimate`, `getServiceFee` — calculent le coût de livraison et les frais de protection avant l'achat.
- `createTransaction` — crée une commande (réserve l'article, calcule le total).
- `createStripeCheckout` — déclenche le paiement (encaissement de l'acheteur).
- `createStripeConnectAccount`, `addBankAccount`, `getStripeAccountStatus` — l'onboarding vendeur **100 % dans l'app** : création du compte Stripe en coulisse, ajout du compte bancaire, suivi du statut de vérification. Le vendeur ne va **jamais** sur le site de Stripe.
- `findPickupPoints` — trouve les points relais à proximité.
- `checkTrackingStatus` — vérifie l'avancement d'un colis.
- `cancelPendingTransaction` — annule une commande non encore payée.
- `completeMeetupTransaction`, `reportMeetupNoShow` — gèrent les remises en main propre (confirmation, ou signalement d'un « lapin »).
- `adminRefundTransaction` — remboursement déclenché par un administrateur (réservé aux admins).

**Recours acheteur (anti-fraude)**
- `requestRefund` — remboursement automatique si le colis est officiellement perdu/non livré par le transporteur.
- `reportTransactionProblem` — « livré mais problème » : gèle les fonds et ouvre un litige pour revue humaine, sans déplacer d'argent.
- `requestReturn` — demande de retour « non conforme » dans une fenêtre de 7 jours après livraison : génère une étiquette de retour et gèle les fonds.

**Échanges (SwapZone)**
- Famille `proposeMultiSwap`, `acceptSwap`, `declineSwap`, `cancelSwap`, `confirmSwapShipping`, `confirmSwapReception`, `rateSwap`, `openSwapDispute`, etc. — tout le cycle de vie d'un troc dans la zone d'échange généraliste permanente, y compris le **complément en argent** payé par Stripe (`createSwapTopUpCheckout`).

**Porte-monnaie virtuel**
- `activateWallet`, `getWalletInfo`, `walletWithdraw`, `payWithWallet`, `refundWalletPayment` — solde interne de l'utilisateur (retraits, paiement par solde, remboursements crédités).

**Compte, consentement & conformité**
- `deleteUserAccount` — suppression de compte (droit à l'effacement, Loi 25 / RGPD).
- `recordSignupConsent`, `setMarketingConsent` — journal de preuve du consentement marketing (exigence Loi 25 / LCAP).
- `assignUsername` — attribue un identifiant public unique et **immuable** (le `@pseudo`), de façon atomique.
- `recordPrivacyIncident`, `getPrivacyIncidentsLog`, `escalatePrivacyIncidentToCAI`, `notifyAffectedUsers` — registre des incidents de confidentialité (réservé admin ; obligation de notification à la CAI sous Loi 25).
- `contestAutomatedDecision`, `getAutomatedDecisionLog` — transparence et contestation des décisions automatisées (Loi 25, art. 12.1) : un utilisateur peut demander une revue humaine.

**Modération (admin)**
- `approveShop`, `rejectShop`, `suspendShop` — validation et suspension des boutiques payantes.
- `getPendingReports`, `triageReport` — traitement des signalements.

#### B. Fonctions « réflexes » (triggers) — déclenchées automatiquement par un changement de données

- `updateSearchIndex` — met à jour l'index de recherche dès qu'un article change.
- `updateUserStats` — recalcule les statistiques d'un utilisateur.
- `generateEmbeddingOnCreate/OnUpdate` — génère l'« empreinte IA » d'un article (pour la recherche visuelle).
- `sendMessageNotification`, `sendOfferStatusNotification` — envoient les notifications de messages et d'offres.
- `onSwapCreated`, `onSwapStatusUpdated` — notifications liées aux échanges.
- `onArticleFavorited`, `onArticlePriceDropped` — réagissent aux mises en favori et aux baisses de prix.
- `onUserProfileUpdated` — propage un changement de nom/photo de profil vers les conversations, articles, etc.
- `onArticleSoftDeleted`, `onArticleSold`, `onArticleInfoUpdated` — propagent les changements d'article (retiré, vendu, modifié) vers les conversations.

#### C. Fonctions « horloge » (scheduled) — tournent toutes seules à intervalle régulier

Ce sont les robots de fond qui maintiennent la plateforme saine. Beaucoup touchent l'argent et les délais.

| Robot | Fréquence | Rôle métier |
|---|---|---|
| `updateGlobalStats` | 1 h | Agrège les statistiques globales |
| `updatePopularityScores` | 6 h | Recalcule la popularité des articles (tri « Populaire ») |
| `cleanupSearchIndex` | 24 h | Nettoie l'index de recherche |
| `cleanupExpiredDrafts` | 24 h (fuseau Toronto) | Supprime les photos de brouillons abandonnés (14 j) |
| `checkSavedSearchNotifications` | 15 min | Alerte les utilisateurs des nouveaux articles correspondant à leurs recherches sauvegardées |
| `expireStaleOffers` | 1 h | Expire les offres de négociation en attente |
| `expireStaleProposedSwaps` | — | Libère les articles bloqués par un troc jamais accepté (expiration 7 j) |
| `expireOrphanedTransactions` | — | Annule les commandes coincées : remise en main propre non confirmée (48 h), paiement non finalisé (1 h), payé mais non expédié (7 j) |
| `checkShippedTracking` | ~12 h | Filet de sécurité du suivi de colis (interroge ShipEngine) |
| `releaseHeldFunds` | 1 h | **Libère les fonds gelés vers le solde disponible du vendeur après la fenêtre de litige de 7 jours** |
| `sweepPendingLabels` | 1 h | Réessaie de générer une étiquette d'expédition bloquée ; rembourse l'acheteur après 4 échecs |
| `retryFailedOperations` | 30 min | Rejoue les opérations financières échouées (remboursements, reversements) avec délais croissants |
| `reconcileFinances` | 6 h | **Réconciliation comptable** : détecte les paiements/retraits « perdus » et vérifie que les soldes ne deviennent jamais négatifs (alerte uniquement, ne touche pas l'argent) |
| `retentionPurge` | 24 h | **Purge de rétention des données** : efface les données personnelles trop anciennes (articles inactifs > 3 ans, préférences invités > 90 j, notifications > 180 j, historique de recherche > 12 mois). Ne touche **jamais** aux transactions, conservées 7 ans (obligation légale) |

Plusieurs de ces robots ont des fuseaux et schedules confirmés dans le code (ex. `cleanupExpiredDrafts` sur `America/Toronto`).

#### D. Points d'entrée externes (webhooks) — appelés par des partenaires

- **`stripeWebhook`** — Stripe prévient l'app quand un paiement réussit/échoue, quand un litige bancaire est ouvert, quand un virement vendeur part, etc. La signature de chaque message est **vérifiée cryptographiquement** (rejet 401 si elle est invalide ou absente). Gère aussi les compléments en argent des échanges (`swap_topup`), avec vérification que le montant encaissé correspond bien au montant attendu.
- **`shipEngineWebhook`** — ShipEngine prévient l'app à chaque scan de colis (expédié, livré, échec). C'est le **chemin principal** du suivi de livraison ; le robot `checkShippedTracking` reste le filet de sécurité. Protégé par un **secret partagé** comparé en temps constant (rejet 401 sinon).

---

### 18.5 Sécurité : qui a le droit de faire quoi

La sécurité repose sur deux couches complémentaires.

**1. Les règles de base de données (`firestore.rules`, ~860 lignes).** Elles décident, pour chaque collection, qui peut lire ou écrire. Principes vérifiés dans le code :

- **Les champs sensibles sont verrouillés côté client.** Un utilisateur ne peut **pas** se transformer en administrateur en modifiant son propre profil : les champs `isAdmin`, `role`, `customClaims`, `username` sont protégés et ne peuvent être posés que par le serveur. C'était un risque corrigé (escalade de privilèges).
- **Les fiches utilisateurs ne sont lisibles que par leur propriétaire ou un admin** — pas par n'importe qui.
- **Les soldes, paiements, statuts de commande, statuts de boutique** ne sont jamais modifiables par le téléphone : seules les Cloud Functions (qui contournent les règles via un accès « administrateur technique ») peuvent les changer. Les notifications, l'index de recherche, les empreintes IA, les statistiques, les moments, les registres de consentement et d'incidents sont tous en **lecture seule pour le client** (création/écriture interdites côté app).
- **Les boutiques** : tout le monde peut les voir, mais leur statut de validation (approuvée/rejetée/suspendue) et leur forfait payant sont des champs « propriété de l'admin », verrouillés — d'où l'existence des fonctions de modération dédiées. Une boutique ne peut pas être supprimée par le client.
- **Les messages et conversations** : lisibles/écrivables uniquement par les participants, avec gestion du blocage entre utilisateurs.

**2. La gestion des administrateurs.** Le statut admin est reconnu de deux façons (vérifié dans `isAdmin()`) : en priorité une **« étiquette » de sécurité (custom claim) posée côté serveur** et non modifiable par l'utilisateur ; à défaut, un champ `isAdmin` dans le profil (pour compatibilité). Les actions d'admin (remboursements, modération de boutiques, registre d'incidents, escalade vers la CAI) passent toutes par des Cloud Functions qui revérifient ce statut.

**Principe d'or financier** : toute mutation d'argent ou de statut sensible passe par une Cloud Function utilisant une **transaction atomique** (`runTransaction`) — jamais par le client. Les opérations sont **idempotentes** (rejouables sans double effet) grâce à des clés stables (ex. `rf_buyer_<commande>`), et les échecs partent dans une file de rattrapage (« dead-letter ») rejouée automatiquement. Les clés secrètes (Stripe, ShipEngine) ne sont jamais dans le code : elles sont injectées via le **Secret Manager** de Firebase.

---

### 18.6 Le modèle de revenus, côté technique

Le calcul des frais est centralisé dans un seul module serveur (`utils/fees.ts`), ce qui garantit qu'acheteur et vendeur voient le même montant.

- **Commission vendeur : 0 %.** Le vendeur reçoit **100 % du prix** de son article. Argument fort vis-à-vis de Poshmark (20 % vendeur).
- **Frais de protection acheteur : 5 % du prix + 1,50 $, avec un minimum de 2,00 $** (réglables sans redéploiement via variables d'environnement / Remote Config). Alignés sur Vinted.
- Techniquement, Stripe encaisse l'acheteur, reverse au vendeur via un « destination charge » et retient automatiquement la commission de la plateforme (`application_fee_amount`).
- **Boutiques payantes** : trois forfaits monétisés en **réduisant les frais acheteur** sur la boutique (la commission vendeur reste à 0 %).
- Tout est en **CAD**.

---

### 18.7 iOS vs Android : ce qui change pour le produit

L'application est à **95 % identique** sur les deux plateformes (même code JavaScript, mêmes règles, mêmes fonctions serveur). Les rares différences viennent des couches « natives » du téléphone.

| Sujet | iOS | Android | Impact produit |
|---|---|---|---|
| **Notifications push** | Système Apple (APNs) | Système Google (FCM) | Voir limite connue ci-dessous |
| **Liens partagés** (article, profil, boutique…) | « Universal Links » (`applinks:seconde.app`) | « App Links » (vérification automatique) | Doivent ouvrir l'app plutôt que le navigateur |
| **Connexion Apple** | Obligatoire (politique App Store) | Optionnelle | Apple Sign-In activé sur iOS |
| **Permissions** | Photos, caméra, notifications | + localisation, notifications (`POST_NOTIFICATIONS`), vibration | Textes de permission en français |
| **Saisie / clavier** | Comportement de clavier iOS | Bouton « retour » matériel à gérer | Détail UX |

Le code prévoit les **liens profonds** pour : `/article`, `/chat`, `/user`, `/shop`, `/swap-party`, `/swap`, `/notifications`, `/search`.

---

### 18.8 Déploiement & exploitation

Deux chaînes de livraison distinctes, comme dans toute app de ce type :

- **L'application mobile → EAS (Expo Application Services).** Trois profils de build sont configurés (`development`, `preview`, `production`). La version de production s'auto-incrémente, et la soumission App Store est pré-câblée (identifiant Apple, Team ID `2VZTF24GKY`, App ID App Store Connect). Identifiant de projet EAS présent dans la config.
- **Le back-office → `firebase deploy`.** Les règles de base, l'index de recherche (130+ index Firestore configurés), les Cloud Functions et l'hébergement web (qui sert notamment les fichiers de validation des liens profonds) sont déployés via Firebase. Un environnement d'**émulateurs locaux** complet (auth, base de données, fonctions, hébergement, stockage) permet de tout tester sans toucher la production.

**Garde-fous opérationnels (règles maison documentées)** : pas de déploiement de fonctions « en force » (la production contient des fonctions financières comme les retraits qui ne doivent jamais être effacées par mégarde) ; toute modification native passe par la config (`app.config.js` + `expo prebuild`), jamais à la main dans les dossiers `ios/`/`android/` ; les clés Stripe/ShipEngine restent dans le Secret Manager.

---

### 18.9 Limites et dette technique connues (transparence)

Ces points sont documentés factuellement dans les audits cross-plateforme du dépôt. Ils n'empêchent pas l'app de fonctionner, mais sont à connaître pour un dossier sérieux.

1. **Notifications push iOS structurellement défaillantes.** Le mécanisme actuel envoie un jeton Apple « brut » à un service Google (FCM), qui le rejette. **Conséquence : aucune notification n'arrive sur iPhone** (messages, offres, ventes, échanges, alertes de recherche). Android fonctionne. Correctif identifié : passer par Expo Push ou la messagerie Firebase native.

2. **Liens partagés (universal/app links) non fonctionnels.** Les fichiers de validation (`apple-app-site-association`, `assetlinks.json`) contiennent encore des valeurs de remplacement (Team ID, empreinte du certificat Android). **Conséquence : un lien partagé ouvre le navigateur au lieu de l'app**, ce qui casse l'acquisition virale. Correctif : insérer les vraies empreintes et redéployer l'hébergement.

3. **Migration de l'index de recherche à faire avant la mise en production de la recherche.** Les articles anciens n'ont pas le marqueur `moderationStatus` ni le format de taille structuré, et l'index de recherche n'a pas été reconstruit. **Conséquence : les articles préexistants sont invisibles en recherche texte / tri Populaire**, et un backfill naïf les désindexerait. Une séquence de migration ordonnée est documentée (marquer « approuvé », convertir les tailles, déployer les index, puis reconstruire l'index de recherche).

4. **Parité native incomplète** (impact moindre) : Apple Pay / Google Pay pas encore opérationnels (plugin Stripe natif à déclarer), plugin caméra à fixer dans la config pour Android, carte Google Maps sans clé, et la permission micro (`RECORD_AUDIO`) déclarée sans usage (risque de friction à la validation Play Store).

Ces limites sont des **chantiers identifiés**, avec correctifs déjà cadrés — pas des inconnues.

---

### 18.10 Spécificités Canada — synthèse

- **Devise unique : CAD.** Frais, livraisons, soldes, retraits.
- **Données au Canada** : serveurs en région Montréal, cohérent avec la **Loi 25** (Québec).
- **Conformité Loi 25 outillée dans le produit** : journal de consentement marketing, registre d'incidents de confidentialité avec escalade vers la **CAI**, transparence/contestation des décisions automatisées, droit à l'effacement (`deleteUserAccount`), et purge de rétention automatique (avec conservation légale de 7 ans des transactions).
- **Transporteurs canadiens** via ShipEngine : Intelcom (Dragonfly) et Postes Canada, points relais inclus.
- **Langue** : interface mono-langue **français**, y compris les textes de permission système.
