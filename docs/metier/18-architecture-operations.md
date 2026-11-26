## 18. Architecture & opérations (annexe technique)

> Annexe technique rédigée pour un lecteur informé mais non-technique (fondateur, associé, incubateur, futur employé). Elle décrit **comment l'application Second fonctionne sous le capot**, en langage métier : de quoi est faite la plateforme, comment le code est rangé, quels « robots » serveur tournent en coulisse, comment l'argent et les données sont protégés, comment on teste et on déploie, et quelles limites connues subsistent. Chaque chiffre de ce document a été recompté dans le dépôt (`package.json`, `firebase.json`, `functions/src/index.ts`, `firestore.rules`, `app.config.js`, `eas.json`, `jest.config.js`, `eslint.config.js`).

---

### 18.1 Vue d'ensemble en une phrase

Second est une **application mobile** (un seul code pour iPhone et Android) qui se connecte à un **back-office hébergé chez Google (Firebase)**, dont tous les programmes serveur tournent dans la **région de Montréal**. Les paiements passent par **Stripe** (en mode « marque blanche » : le vendeur ne voit jamais Stripe) et les livraisons par **ShipEngine**. Toute opération sensible — argent, changement de statut d'une commande, suppression de compte — n'est jamais faite par le téléphone lui-même : elle est exécutée par un programme serveur de confiance.

**À lire avant tout le reste** : deux interrupteurs produit sont aujourd'hui sur **OFF** (`config/featureFlags.ts`) — `SHIPPING_ENABLED = false` et `PAYMENTS_ENABLED = false`. Concrètement, la **remise en main propre est le seul parcours d'achat ouvert**, et une grande partie de la machinerie décrite plus bas (encaissement, étiquettes, séquestre, retraits) est **construite, testée, mais pas ouverte au public**. Ce document décrit l'infrastructure telle qu'elle existe, en signalant à chaque fois ce qui est effectivement actif.

---

### 18.2 La pile technologique, expliquée simplement

| Brique | Ce que c'est | Rôle métier |
|---|---|---|
| **Application mobile (Expo / React Native)** | Un seul programme qui devient à la fois l'app iPhone et l'app Android | Tout ce que l'utilisateur voit et touche : écrans, photos, panier, messagerie |
| **Firebase (Google Cloud)** | L'« usine » serveur louée à Google | Stocke les données, héberge les robots serveur, gère la connexion des comptes |
| **Firestore** | La base de données | Articles, utilisateurs, commandes, messages, avis, échanges, porte-monnaie |
| **Cloud Functions** | Des petits programmes serveur déclenchés à la demande ou automatiquement | Le « cerveau » des opérations sensibles (paiement, expédition, modération, conformité) |
| **Stripe Connect Custom** | Le système de paiement, en marque blanche | Encaisse l'acheteur sur le compte de la plateforme, tient les comptes vendeurs, verse au vendeur au moment du retrait |
| **ShipEngine** | L'agrégateur de transporteurs | Calcule les tarifs, génère les étiquettes, suit les colis (Intelcom/Dragonfly, Postes Canada) |
| **Gemini + Vertex AI (Google)** | L'intelligence artificielle | Analyse des photos d'articles (Gemini), empreintes d'images pour la recherche visuelle (Vertex AI) |
| **PostHog** | La mesure d'usage | Statistiques produit, avec possibilité de refus (opt-out) côté utilisateur |

**Détails techniques confirmés dans le code** : application en TypeScript strict, moteur JavaScript Hermes, identifiant `com.seconde.app` (iOS et Android), nom commercial « Seconde », projet Firebase `seconde-b47a6`. Côté application : Expo SDK 56, React Native 0.85, React 19, Expo Router (navigation par fichiers), Zustand et React Query pour l'état, React Compiler activé. Côté serveur : **Node.js 22** (`firebase.json` → `"runtime": "nodejs22"`), `firebase-admin` v13, `firebase-functions` v7 (fonctions « v2 »), SDK Stripe v22 avec la version d'API figée au `2026-04-22.dahlia`.

---

### 18.3 Comment le code est rangé (refonte récente)

Le dépôt a été **réorganisé en tranches verticales**. C'est un point à connaître : il rend le coût d'ajout d'une fonctionnalité prévisible et permet de confier une fonctionnalité entière à une personne sans qu'elle ait à comprendre le reste.

**Côté application**, quatre couches, avec des règles d'import vérifiées automatiquement (`eslint.config.js`, plugin « boundaries ») :

| Couche | Contenu | Règle |
|---|---|---|
| `app/` | Uniquement les écrans/routes (69 écrans + 7 gabarits de navigation) | Peut tout appeler |
| `features/` | **20 fonctionnalités autonomes** (≈ 208 fichiers) : `account`, `admin`, `article`, `auth`, `chat`, `checkout-shipping`, `favorites`, `home`, `legal`, `notifications`, `offers`, `onboarding`, `orders`, `profile`, `reviews`, `search`, `sell`, `shop`, `swap`, `wallet`. Chacune contient ses propres composants, ses hooks, ses services et sa porte d'entrée unique (`index.ts`) | **Une fonctionnalité ne peut pas en appeler une autre.** Ce qui doit être partagé remonte d'un cran |
| `services/`, `store/`, `hooks/`, `components/` | Le socle commun réellement transverse, dont le design system (`components/ui/`) | Ne connaît ni les fonctionnalités ni les écrans |
| `lib/`, `utils/`, `constants/`, `types/`, `config/` | Briques de base (thème, clés, types métier éclatés par domaine) | Ne dépend de rien d'autre |

Cette discipline n'est pas déclarative : elle est **vérifiée par une commande** (`npm run lint:boundaries`) et échoue si quelqu'un tente un raccourci.

**Côté serveur**, trois anciens fichiers-monstres ont été éclatés, avec une **façade** qui préserve les points d'entrée (rien n'a cassé au passage) :

- le module de paiement (3 881 lignes) → `functions/src/callable/payments/` en 7 morceaux : réduction de frais, adresses, livraison, encaissement, compte vendeur Stripe, remise en main propre, litiges ;
- le point d'entrée des notifications Stripe → `functions/src/http/stripe/` en 8 morceaux : paiement, complément d'échange, forfait boutique, litiges, virements, remboursements, compte vendeur, rattrapage ;
- la messagerie côté app (1 554 lignes) → `services/chat/` en 8 morceaux : conversation, messages, offres, remise en main propre, expédition, abonnements temps réel.

Au total le back-office compte **89 fichiers de code** (hors tests) dans `functions/src/`, rangés en `callable/`, `triggers/`, `scheduled/`, `http/`, `services/`, `utils/`, `config/`.

---

### 18.4 Où vivent les données : le Canada, avec des nuances à assumer

**Ce qui est vérifié** : les **123 fonctions serveur sans exception** sont déployées dans **`northamerica-northeast1` (Montréal)**. C'est contrôlable fonction par fonction dans le code. Chaque fonction réserve aussi **au minimum 512 Mo de mémoire** (et non les 256 Mo par défaut) — décision opérationnelle pour éviter les plantages, toutes les fonctions partageant un même paquet de code volumineux ; deux fonctions lourdes montent à 1 Go (`consolidateChatDuplicates`, `backfillEmbeddings`).

**Conséquences métier** : les traitements serveur ont lieu au Canada (discours de conformité Loi 25 simplifié), les utilisateurs canadiens parlent à un serveur proche d'eux, et tout le modèle financier est libellé en **CAD** (chaque encaissement est créé en `currency: 'cad'`).

**Les nuances qu'il faut dire, parce qu'elles existent dans le code** :

- **Recherche visuelle** : les empreintes d'images sont calculées par Vertex AI en **`us-central1` (États-Unis)** — c'est écrit en dur dans `functions/src/triggers/embeddings.ts` et `functions/src/callable/search.ts`. Une photo d'article part donc aux États-Unis pour être indexée.
- **Analyse de photo par IA** : Gemini est appelé via une clé d'API (`GEMINI_API_KEY`) rattachée à un **projet Google distinct de `seconde-b47a6`**, sans région épinglée.
- **Mesure d'usage** : PostHog pointe par défaut sur le **cloud américain** (`https://us.i.posthog.com`) ; l'hôte est réglable par variable d'environnement, mais la valeur par défaut du code est celle-là.
- **Stripe** est un prestataire américain — inévitable pour ce type de plateforme, mais à déclarer.
- **La localisation de la base Firestore et du stockage de fichiers n'est écrite nulle part dans le dépôt** : c'est un réglage fait à la création du projet Google Cloud. Il faut le confirmer dans la console avant de l'affirmer dans un dossier de conformité.

Le message honnête est donc : *« nos traitements applicatifs tournent au Canada ; certains services tiers spécialisés (IA d'indexation, analytics, paiement) sont hors Canada et sont documentés comme tels »*, et non *« tout est au Canada »*.

---

### 18.5 Le catalogue des « robots » serveur (Cloud Functions)

Le back-office compte **123 fonctions serveur** réparties en quatre familles : **88 « à la demande »**, **16 « réflexes »**, **17 « horloge »**, **2 points d'entrée externes**.

#### A. Fonctions « à la demande » (callables) — déclenchées par une action de l'utilisateur

**Vente & catalogue**
- `analyzeProductImage` — analyse une photo d'article par IA (catégorie, marque, matière, couleur, état suggérés) au moment de la mise en vente.
- `createArticle` / `updateArticle` — créent et modifient les fiches articles côté serveur (cohérence des données de recherche).
- `incrementProductView`, `toggleProductLike`, `toggleArticleSold`, `markSavedSearchViewed` — compteur de vues, likes, bascule « vendu », accusé de lecture d'une alerte de recherche.
- `visualSearch`, `getSimilarProducts`, `backfillEmbeddings` — recherche par l'image et suggestions d'articles similaires.

**Accueil, découverte & profils**
- `getTrendingBrands`, `getPriceDrops`, `getFeaturedSellers`, `getNewArrivals`, `getHomeFeed` — les rails de la page d'accueil.
- `toggleSellerLike`, `getLikedSellers`, `recordPriceDrop` — suivi de vendeurs et baisses de prix.
- `getActiveMoments`, `getMomentProducts` — sélections éditoriales.
- `generateStyleProfile`, `saveOnboardingPreferences` — profil de style et préférences d'accueil.
- `createReview`, `getUserReviews`, `getUserPublicProfile` — avis et fiche publique d'un membre (les fiches utilisateurs brutes n'étant pas lisibles directement).

**Paiement, livraison & commandes**
- `getShippingEstimate`, `getServiceFee` — coût de livraison et frais de protection avant l'achat.
- `createTransaction` — crée une commande (réserve l'article, calcule le total).
- `createStripeCheckout` — déclenche l'encaissement de l'acheteur.
- `createStripeConnectAccount`, `addBankAccount`, `uploadStripeIdentityDocument`, `getStripeAccountStatus` — l'onboarding vendeur **100 % dans l'app** : création du compte Stripe en coulisse, ajout du compte bancaire, envoi des pièces d'identité, suivi du statut de vérification. Le vendeur ne va **jamais** sur le site de Stripe.
- `findPickupPoints`, `checkTrackingStatus` — points relais et avancement d'un colis.
- `cancelPendingTransaction`, `sellerCancelTransaction` — annulation par l'acheteur (avant paiement) ou par le vendeur.
- `acceptMeetupOffer`, `confirmMeetupTransaction`, `completeMeetupTransaction`, `reportMeetupNoShow` — tout le cycle de la remise en main propre, **le seul parcours d'achat ouvert aujourd'hui**.
- `adminRefundTransaction`, `resolveDispute` — remboursement et arbitrage de litige déclenchés par un administrateur.

**Recours acheteur (anti-fraude)**
- `requestRefund` — remboursement automatique si le colis est officiellement perdu/non livré par le transporteur.
- `reportTransactionProblem` — « livré mais problème » : gèle les fonds et ouvre un litige pour revue humaine, sans déplacer d'argent.
- `requestReturn` — demande de retour « non conforme » : génère une étiquette de retour et gèle les fonds.

**Échanges (SwapZone)**
- `ensureGeneralistZone`, `getActiveSwapPartyInfo`, `getSwapPartyLeaderboard`, `addItemToPartySecure`, `removeItemFromPartySecure` — la zone d'échange généraliste permanente.
- `proposeMultiSwap`, `acceptSwap`, `declineSwap`, `cancelSwap`, `setSwapExchangeMode`, `uploadSwapPhotos`, `confirmSwapShipping`, `confirmSwapReception`, `rateSwap`, `openSwapDispute`, `resolveSwapDispute` — le cycle de vie d'un troc, y compris le **complément en argent** payé par Stripe (`createSwapTopUpCheckout`).

**Porte-monnaie virtuel**
- `activateWallet`, `getWalletInfo`, `walletWithdraw`, `payWithWallet`, `refundWalletPayment` — solde interne (retraits, paiement par solde, remboursements crédités). C'est la collection `wallets` qui fait office de registre ; l'ancienne collection `seller_balances` est **morte** (plus aucune écriture, plus aucune règle) et n'est nettoyée que lors d'une suppression de compte.

**Compte, consentement & conformité**
- `deleteUserAccount` — suppression de compte (droit à l'effacement, Loi 25 / RGPD).
- `recordSignupConsent`, `setMarketingConsent` — journal de preuve du consentement, appliqué aussi côté serveur (coupe réellement les notifications marketing).
- `checkUsernameAvailability` + `assignUsername` — vérification puis attribution atomique du `@pseudo` unique et immuable.
- `reportPrivacyIncident`, `getPrivacyIncidentsLog`, `escalatePrivacyIncidentToCAI`, `notifyAffectedUsers` — registre des incidents de confidentialité (réservé admin ; notification à la CAI sous Loi 25).
- `contestAutomatedDecision`, `getAutomatedDecisionLog` — transparence et contestation des décisions automatisées (Loi 25, art. 12.1) : un utilisateur peut demander une revue humaine.

**Modération & boutiques (admin)**
- `approveShop`, `rejectShop`, `suspendShop` — validation et suspension des boutiques.
- `submitReport`, `getPendingReports`, `triageReport` — dépôt et traitement des signalements (anti-spam serveur : un signalement par auteur/cible/motif).
- `purchaseShopTier` — encaissement d'un forfait boutique payant.
- `consolidateChatDuplicates` — outil d'administration de la messagerie.

**Messagerie**
- `postChatSystemMessage` — écrit les messages « système » d'une conversation (offre acceptée ou refusée, contre-offre de prix / lieu / horaire, rencontre confirmée, absence signalée, rencontre terminée, rencontre annulée) à partir d'un **catalogue fermé de neuf types** rendu côté serveur : l'application ne choisit plus le texte, seulement le type, et un rendu impossible (montant absurde, date illisible) est **refusé** plutôt qu'écrit dégradé. Ce n'est pas un outil d'administration : tout participant de la conversation peut l'appeler. Les huit libellés repris de l'ancienne version cliente sont **inchangés au caractère près** ; le neuvième (« rencontre annulée ») accompagne une fonctionnalité livrée le même jour. Le verrou correspondant dans les règles de base de données — fermer la création d'un message « système » par le client — est **écrit mais pas encore déployé**.

#### B. Fonctions « réflexes » (triggers) — déclenchées automatiquement par un changement de données

- `updateSearchIndex` — met à jour l'index de recherche dès qu'un article change (et l'en retire s'il est vendu, désactivé ou bloqué en modération).
- `updateUserStats`, `updateShopArticlesCount`, `updateSellerArticlesCount` — recalculent les compteurs d'un membre, d'une boutique, d'un vendeur.
- `generateEmbeddingOnCreate` / `OnUpdate` — génèrent l'« empreinte IA » d'un article (recherche visuelle).
- `sendMessageNotification`, `sendOfferStatusNotification` — notifications de messages et d'offres.
- `onSwapCreated`, `onSwapStatusUpdated` — notifications liées aux échanges.
- `onArticleFavorited`, `onArticlePriceDropped` — réagissent aux mises en favori et aux baisses de prix.
- `onUserProfileUpdated` — propage un changement de nom/photo vers les conversations, articles, etc.
- `onArticleSoftDeleted`, `onArticleSold`, `onArticleInfoUpdated` — propagent les changements d'article vers les conversations.

#### C. Fonctions « horloge » (scheduled) — tournent toutes seules à intervalle régulier

| Robot | Fréquence | Rôle métier |
|---|---|---|
| `updateGlobalStats` | 1 h | Agrège les statistiques globales |
| `updatePopularityScores` | 6 h | Recalcule la popularité des articles (tri « Populaire ») |
| `cleanupSearchIndex` | 24 h | Nettoie l'index de recherche |
| `cleanupExpiredDrafts` | 24 h (fuseau Toronto) | Supprime les photos de brouillons abandonnés (14 j) |
| `checkSavedSearchNotifications` | 15 min | Alerte les utilisateurs des nouveaux articles correspondant à leurs recherches sauvegardées |
| `expireStaleOffers` | 1 h | Expire les offres de négociation restées en attente |
| `expireStaleAcceptedOffers` | 1 h | Referme les offres acceptées jamais transformées en commande (48 h de grâce) |
| `expireStaleProposedSwaps` | 1 h | Libère les articles bloqués par un troc jamais accepté (7 j) |
| `expireStalePostAcceptanceSwaps` | 1 h | Débloque les trocs acceptés mais figés depuis 14 j : rembourse le complément en argent, libère les articles |
| `expireOrphanedTransactions` | 1 h | Annule les commandes coincées : rendez-vous non confirmé (48 h), rendez-vous confirmé jamais conclu (7 j), paiement non finalisé (1 h), payé mais non expédié (7 j) |
| `alertAgingDisputes` | 6 h | Alerte l'exploitation sur les litiges en attente d'arbitrage humain depuis plus de 5 j (n'arbitre jamais tout seul) |
| `checkShippedTracking` | 12 h | Filet de sécurité du suivi de colis (interroge ShipEngine) |
| `releaseHeldFunds` | 1 h | **Libère les fonds gelés vers le solde disponible du vendeur après la fenêtre de litige de 7 jours** |
| `sweepPendingLabels` | 1 h | Réessaie de générer une étiquette d'expédition bloquée ; rembourse l'acheteur après 4 échecs |
| `retryFailedOperations` | 30 min | Rejoue les opérations financières échouées (remboursements, reversements) avec délais croissants |
| `reconcileFinances` | 6 h | **Réconciliation comptable** : détecte les paiements/virements « perdus » et vérifie que les soldes ne deviennent jamais négatifs (alerte uniquement, ne touche pas l'argent) |
| `retentionPurge` | 24 h (fuseau Toronto) | **Purge de rétention** : efface les données personnelles trop anciennes (articles inactifs > 3 ans, préférences invités > 90 j, notifications > 180 j, brouillons > 90 j, historique de recherche > 12 mois). Ne touche **jamais** aux transactions, conservées 7 ans (obligation légale) |

**À dire honnêtement** : livraison et paiement étant fermés, une bonne moitié de ces robots (étiquettes, suivi de colis, séquestre, réconciliation) tourne aujourd'hui **à vide**. Ils sont là, testés, prêts à reprendre du service le jour où les interrupteurs passent à ON — mais ils ne prouvent rien sur du volume réel.

#### D. Points d'entrée externes (webhooks) — appelés par des partenaires

- **`stripeWebhook`** — Stripe prévient l'app quand un paiement réussit ou échoue, quand un litige bancaire est ouvert ou clos, quand un virement vendeur part, réussit, échoue ou est annulé, quand un remboursement est traité, quand le statut d'un compte vendeur change. **Deux points d'entrée Stripe** (plateforme et Connect) visent la même adresse, chacun avec sa propre clé de signature : la signature est vérifiée cryptographiquement contre les deux, et la requête est **rejetée (401)** si aucune ne correspond, ou **refusée (500)** si aucune clé n'est configurée. Chaque événement est **dédupliqué** par son identifiant, avec un marqueur écrit **seulement après succès** (un traitement qui plante est donc rejoué par Stripe au lieu d'être perdu), purgé au bout de 90 jours. Gère aussi les compléments en argent des échanges et les forfaits boutique, en vérifiant que le montant encaissé correspond au montant attendu.
- **`shipEngineWebhook`** — ShipEngine prévient l'app à chaque scan de colis. Protégé par un **secret partagé comparé en temps constant** (rejet 401 sinon, refus 500 si le secret n'est pas configuré). C'est le chemin **prévu** comme principal, mais il n'est utile qu'une fois l'adresse enregistrée chez ShipEngine ; **tant que ce n'est pas fait, le robot `checkShippedTracking` (12 h) est le chemin réel** et reste de toute façon le filet de sécurité.

---

### 18.6 Sécurité : qui a le droit de faire quoi

La sécurité repose sur deux couches complémentaires.

**1. Les règles de base de données (`firestore.rules`, 1 014 lignes ; `storage.rules`, 92 lignes).** Elles décident, pour chaque collection, qui peut lire ou écrire. Principes vérifiés dans le code :

- **Les champs sensibles sont verrouillés côté client.** Un utilisateur ne peut **pas** se transformer en administrateur en modifiant son propre profil : `isAdmin`, `role`, `customClaims` et `username` sont dans une liste de champs protégés qui ne peuvent être posés que par le serveur (escalade de privilèges corrigée).
- **Les fiches utilisateurs ne sont lisibles que par leur propriétaire ou un admin** — le profil public passe par une fonction serveur dédiée qui ne renvoie que ce qui doit être visible.
- **Les soldes, paiements, statuts de commande, statuts et forfaits de boutique** ne sont jamais modifiables par le téléphone : seules les Cloud Functions (qui contournent les règles via un accès « administrateur technique ») peuvent les changer. Les notifications, l'index de recherche, les empreintes IA, les statistiques, les registres de consentement, d'incidents, de décisions automatisées, le grand livre plateforme et la file de rattrapage sont **en lecture seule, voire invisibles, côté client**.
- **Les messages et conversations** : lisibles/écrivables uniquement par les participants, avec gestion du blocage entre utilisateurs.
- **Le stockage de fichiers** : chaque membre écrit uniquement dans son propre dossier, images seulement, 10 Mo maximum par fichier.

**2. La gestion des administrateurs.** Le statut admin est reconnu de deux façons : en priorité une **« étiquette » de sécurité posée côté serveur** et non modifiable par l'utilisateur ; à défaut, un champ `isAdmin` dans le profil — lui-même verrouillé par la règle d'écriture, donc non auto-attribuable. Les actions d'admin passent toutes par des Cloud Functions qui revérifient ce statut.

**Principe d'or financier** : toute mutation d'argent ou de statut sensible passe par une Cloud Function utilisant une **transaction atomique** (`runTransaction`) — jamais par le client. Trois garde-fous complètent le dispositif :

- **Idempotence** : les opérations sensibles portent une clé stable (`pi_<commande>` pour un encaissement, `rf_buyer_<commande>` / `rf_admin_<commande>` pour un remboursement), donc un rejeu ne produit jamais de double effet.
- **File de rattrapage** : tout échec après le point de non-retour (remboursement, reversement, étiquette, écart de montant) est persisté dans une collection `failed_operations` et rejoué automatiquement toutes les 30 minutes avec délais croissants, au lieu d'être seulement écrit dans les journaux.
- **Verrous de jobs** : les robots qui déclenchent des opérations **payantes** (achat d'étiquette) prennent un verrou avec expiration, pour qu'un déclenchement en doublon ne paie jamais deux fois.

**Limitation de débit** : les appels sensibles sont plafonnés par utilisateur sur une fenêtre glissante (collection `rate_limits`), avec un plafond à zéro pour les appels non authentifiés sur les points d'entrée financiers.

**Les secrets** ne sont jamais dans le code : ils sont injectés via le **Secret Manager** de Firebase — `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_CONNECT_WEBHOOK_SECRET`, `SHIPENGINE_API_KEY`, `SHIPENGINE_WEBHOOK_SECRET`, `GEMINI_API_KEY`. Les réglages non secrets (taux de frais, activation de la livraison, activation de la taxe, prix des forfaits) passent par de simples variables d'environnement, modifiables sans toucher au code.

---

### 18.7 Le modèle de revenus, côté technique

Le calcul des frais est centralisé dans un seul module serveur (`functions/src/utils/fees.ts`), ce qui garantit qu'acheteur et vendeur voient le même montant.

- **Commission vendeur : 0 %.** Le vendeur reçoit **100 % du prix** de son article. Argument fort vis-à-vis de Poshmark (20 % vendeur).
- **Frais de protection acheteur : 5 % du prix + 1,50 $, avec un minimum de 2,00 $** — réglables sans redéploiement (`BUYER_FEE_PERCENT`, `BUYER_FEE_FIXED`, `BUYER_FEE_MIN`). Alignés sur Vinted.
- **Le circuit de l'argent est une charge plateforme directe, pas un partage automatique.** Contrairement à ce qui était écrit auparavant, Stripe **n'applique aucun `application_fee_amount` et aucun reversement automatique au vendeur au moment du paiement**. La plateforme encaisse la totalité ; le vendeur est crédité dans le registre interne (`wallets`) ; un **unique virement plateforme → compte vendeur** part au moment du retrait (`walletWithdraw`). C'est le seul endroit du dépôt où de l'argent quitte la plateforme vers un vendeur. Ce choix simplifie les remboursements et les litiges, mais il fait porter la trésorerie à la plateforme entre l'encaissement et le retrait — c'est une décision à assumer devant un investisseur.
- **Séquestre** : les fonds d'une commande livrée restent gelés **7 jours** après le scan « livré » avant de devenir retirables.
- **Boutiques payantes** : trois niveaux, monétisés en **réduisant les frais acheteur** (la commission vendeur reste à 0 %) — *L'Atelier* (gratuit, frais standard), *Le Comptoir* / `pro` à **29,99 $/mois** (−50 % de frais acheteur), *La Maison* / `premium` à **79,99 $/mois** (−100 % : plus aucun frais acheteur, Second se rémunère uniquement sur l'abonnement). La réduction n'est accordée que tant que le forfait est **payé et non expiré**, et le forfait est posé sur la boutique par le serveur après paiement confirmé.
- **Taxes TPS/TVQ : construites mais désactivées.** L'infrastructure existe derrière un interrupteur `TAX_ENABLED`, **à `false` par défaut**, et ne taxerait que les frais de service (jamais la livraison refacturée, sujet non tranché). L'activer est une **décision fiscale** (immatriculation TPS/TVQ, seuil de petit fournisseur), pas un chantier technique.
- Tout est en **CAD**.

**Réserve majeure** : `PAYMENTS_ENABLED = false`. Aujourd'hui **aucun de ces revenus n'est encaissé en production** — le seul parcours ouvert (main propre) ne fait transiter aucun argent par la plateforme. Le modèle est codé et testé, pas encore éprouvé commercialement.

---

### 18.8 iOS vs Android : ce qui change pour le produit

L'application est à **95 % identique** sur les deux plateformes (même code JavaScript, mêmes règles, mêmes fonctions serveur). Les rares différences viennent des couches « natives » du téléphone.

| Sujet | iOS | Android | Impact produit |
|---|---|---|---|
| **Notifications push** | Système Apple (APNs) | Système Google (FCM) | Voir limite connue ci-dessous |
| **Liens partagés** (article, profil, boutique…) | « Universal Links » (`applinks:seconde.ca` et `applinks:www.seconde.ca`) | « App Links » (vérification automatique sur `seconde.ca` et `www.seconde.ca`) | Doivent ouvrir l'app plutôt que le navigateur |
| **Connexion Apple** | Activée (obligatoire par la politique App Store) | Non concernée | Connexion Google disponible sur les deux |
| **Permissions** | Photos, caméra, localisation, notifications | Localisation (précise et approximative), notifications, vibration | Textes de permission rédigés en français, portés par la config |
| **Socle système** | Cible minimale iOS 16.4, tablette non supportée | Cible Android SDK 36, clavier en mode « redimensionne » | Détail UX |

Le code prévoit les **liens profonds** vers : `/article`, `/chat`, `/user`, `/shop`, `/swap-party`, `/swap`, `/notifications`, `/search`, `/favorites`, `/messages`, `/profile`, `/sell`, `/settings`, `/my-orders`. **Attention à une asymétrie réelle** : `/my-orders` est déclaré côté Android mais absent du fichier de validation iOS, et `/search-results` l'inverse — un lien vers ces pages n'ouvrira pas l'app sur la plateforme où il manque.

---

### 18.9 Environnements, déploiement & exploitation

**Un seul environnement Firebase.** Le dépôt ne connaît qu'un projet : `seconde-b47a6` (`.firebaserc`). Il n'y a **pas d'environnement de préproduction séparé** : ce qui tient lieu de bac à sable est le jeu d'**émulateurs locaux** (authentification, base de données, fonctions, hébergement, stockage, plus une interface de contrôle), qui permet de tout tester sur son poste sans toucher la production. C'est une dette assumée à ce stade, à corriger avant d'avoir des utilisateurs payants en volume.

Deux chaînes de livraison distinctes :

- **L'application mobile → EAS (Expo Application Services).** Trois profils de build (`development`, `preview`, `production`). Le numéro de version de production s'auto-incrémente et est géré côté serveur EAS. La soumission App Store est pré-câblée (identifiant Apple, Team ID `2VZTF24GKY`, identifiant App Store Connect). Identifiant de projet EAS présent dans la config.
- **Le back-office → `firebase deploy`.** Sont déployés : les règles de base de données et de stockage, **72 index de recherche** (plus 2 réglages de champ), les 123 Cloud Functions, et l'hébergement web — qui sert quatre pages publiques (accueil, conditions, confidentialité, suppression de compte) **et les deux fichiers de validation des liens profonds**.

**Garde-fous opérationnels (règles maison, appliquées) :**
- **Jamais de déploiement de fonctions « en force »** : la production contient des fonctions financières historiques qui ne doivent pas être effacées par mégarde.
- **Aucune modification native à la main** : tout passe par `app.config.js` puis régénération des projets iOS/Android — un contrôle automatique bloque les éditions directes des dossiers `ios/` et `android/`.
- **Les clés Stripe/ShipEngine/Gemini restent dans le Secret Manager**, jamais dans le dépôt. La clé publique Stripe embarquée dans l'app est une clé **de test** par défaut : un build qui oublierait de fournir la clé de production **échoue vers le mode test** (aucun débit réel) plutôt que d'exposer une clé live.
- Les migrations de données lourdes (marquage des articles anciens, reconstruction de l'index de recherche) sont des **scripts manuels volontairement non déployés** comme fonctions, à lancer une fois, dans un ordre imposé, par un opérateur.

---

### 18.10 Tests & qualité : ce qui protège des régressions

La plateforme est couverte par **environ 1 225 cas de test** répartis sur quatre moteurs, plus un cinquième pour le parcours utilisateur complet. Chaque moteur a un territoire strictement délimité pour éviter les collisions.

| Moteur | Périmètre | Volume constaté |
|---|---|---|
| **Jest** | Composants, écrans et hooks de l'app mobile (rendu réel) | ≈ 614 cas |
| **Vitest (app)** | Logique pure, magasins d'état, services de données | ≈ 78 cas |
| **Vitest (serveur)** | Les Cloud Functions : frais, remboursements, litiges, retraits, expirations, webhooks | ≈ 374 cas |
| **Tests de règles** | Les règles de base de données et de stockage, exécutés contre les émulateurs Firebase | ≈ 159 cas |
| **Maestro** | 14 parcours de bout en bout (inscription, vente avec photos, recherche, offre, achat en main propre, échange, boutique, portefeuille…) | 14 scénarios |

**Intégration continue** (`.github/workflows/test.yml`) : à chaque envoi de code et à chaque proposition de modification, trois travaux **bloquants** s'exécutent automatiquement — tests d'interface + vérification de types de l'app, tests serveur + vérification de types serveur, et tests de règles sur émulateurs. Un quatrième travail (parcours de bout en bout Maestro) est **écrit mais désactivé** : il exige un téléphone ou un simulateur, ce qu'un serveur d'intégration standard n'a pas. Les parcours Maestro se lancent donc à la main aujourd'hui.

S'y ajoutent deux contrôles structurels : la **vérification des frontières** entre couches (une fonctionnalité qui en appellerait une autre fait échouer la commande) et un détecteur de **code mort** configuré sur le dépôt.

---

### 18.11 Limites et dette technique connues (transparence)

Ces points sont constatés directement dans le code. Ils n'empêchent pas l'app de fonctionner, mais sont à connaître pour un dossier sérieux.

1. **Livraison et paiement fermés — c'est la limite structurante.** `SHIPPING_ENABLED = false` et `PAYMENTS_ENABLED = false`. La remise en main propre est le seul parcours d'achat ouvert, et il ne fait transiter **aucun argent** par la plateforme. Tout le rail financier (encaissement, séquestre, retrait, litige, étiquette) existe et est testé, mais n'est pas éprouvé sur du volume réel.

2. **Les deux interrupteurs ne se valent pas.** L'interrupteur livraison est **doublé côté serveur** : une fonction serveur refuse une commande ou un encaissement en livraison, même si quelqu'un contournait l'application. L'interrupteur paiement, lui, **n'existe que côté application** : il masque des écrans, il ne ferme pas les portes serveur. Les fonctions d'encaissement de forfait boutique, de complément d'échange, de paiement par solde et de retrait restent techniquement appelables. À corriger avant toute ouverture publique large.

3. **Notifications push iOS structurellement défaillantes.** Le téléphone fournit un jeton Apple « brut » que le service Google (FCM) ne sait pas exploiter. Le code le détecte des deux côtés et **refuse de l'enregistrer plutôt que d'envoyer dans le vide** — la conséquence reste la même : **aucune notification n'arrive sur iPhone** (messages, offres, ventes, échanges, alertes de recherche). Android fonctionne. Le correctif exige une étape native (passer par Expo Push ou la messagerie Firebase native), hors de portée d'une simple modification de code applicatif.

4. **Liens partagés : moitié réglée.** Côté iOS, le fichier de validation contient désormais le **vrai identifiant d'équipe Apple** — il ne reste qu'à publier l'hébergement sur `seconde.ca`. Côté Android, le fichier contient encore une valeur de remplacement à la place de l'empreinte du certificat de signature : **un lien partagé ouvre donc toujours le navigateur au lieu de l'app sur Android**, ce qui casse l'acquisition virale sur cette plateforme.

5. **Reconstruction de l'index de recherche à faire.** Le risque le plus grave a été corrigé dans le code : un article ancien sans marqueur de modération est désormais traité comme approuvé, donc un traitement de rattrapage ne le désindexera pas. Reste la partie non automatisable : les articles qui n'ont jamais été réécrits depuis la mise en place de l'indexation **n'ont pas d'entrée dans l'index** et sont invisibles en recherche texte et en tri « Populaire ». Le script de rattrapage existe (`functions/src/scripts/backfillSearchIndex.ts`), avec un ordre d'exécution imposé, mais il doit être lancé manuellement — **le dépôt ne permet pas de savoir s'il l'a été**.

6. **Suivi de colis : le chemin rapide n'est pas branché.** Le point d'entrée ShipEngine est écrit et sécurisé, mais il n'agit que si l'adresse est enregistrée côté ShipEngine. Tant que ce n'est pas fait, le suivi repose sur une **interrogation toutes les 12 heures** : un colis peut donc apparaître « livré » avec plusieurs heures de retard, ce qui décale d'autant le démarrage de la fenêtre de séquestre.

7. **Résidence des données à nuancer** (cf. 18.4) : indexation d'images aux États-Unis, IA de photo sur un projet Google distinct, analytics par défaut sur le cloud américain, localisation de la base non vérifiable depuis le dépôt.

8. **Pas d'environnement de préproduction** : un seul projet Firebase, les émulateurs locaux comme seul bac à sable.

9. **Parité native — état réel corrigé** : Apple Pay a été **retiré volontairement** (rejet App Store d'un build qui déclarait le portefeuille sans paiement vérifiable) ; Google Pay est déclaré dans la configuration mais inopérant tant que le paiement est fermé ; la permission micro a été **supprimée** (plus de risque de friction Play Store) ; les clés de carte Google Maps sont désormais fournies par variables d'environnement — **elles ne figurent pas dans le fichier d'exemple**, donc leur présence réelle dans le build est à vérifier hors dépôt.

10. **Fichier d'exemple de configuration serveur périmé** : `functions/.env.example` mentionne encore Helcim, remplacé par Stripe depuis longtemps. Sans conséquence en production, mais trompeur pour un nouvel arrivant.

Ces limites sont des **chantiers identifiés**, avec correctifs cadrés — pas des inconnues.

---

### 18.12 Spécificités Canada — synthèse

- **Devise unique : CAD.** Frais, livraisons, soldes, retraits, forfaits boutique.
- **Traitements applicatifs au Canada** : les 123 fonctions serveur en région Montréal, sans exception, cohérent avec la **Loi 25** (Québec) — avec les réserves de résidence documentées en 18.4, qui doivent être déclarées telles quelles dans un dossier de conformité.
- **Conformité Loi 25 outillée dans le produit** : journal de consentement marketing appliqué serveur, registre d'incidents de confidentialité avec escalade vers la **CAI**, transparence et contestation des décisions automatisées, droit à l'effacement (`deleteUserAccount`), purge de rétention automatique quotidienne, conservation légale de 7 ans des transactions, refus d'analytics possible côté utilisateur.
- **Fiscalité** : TPS/TVQ codées mais **désactivées** — activation conditionnée à une immatriculation fiscale, pas à un développement.
- **Transporteurs canadiens** via ShipEngine : Intelcom (Dragonfly) et Postes Canada, points relais inclus — **rail fermé aujourd'hui**.
- **Langue** : interface mono-langue **français**, y compris les textes de permission système.
