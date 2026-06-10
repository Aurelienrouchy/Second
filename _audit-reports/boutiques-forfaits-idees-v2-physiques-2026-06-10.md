# Boutiques — Menu d'idées v2, recadré COMMERCES PHYSIQUES de seconde main

**Date :** 2026-06-10
**Pour :** Fondateur (tri à faire ensemble)
**Statut :** PROPOSITION — rien n'est arrêté. MENU à trier, pas une roadmap.
**Suite de :** `_audit-reports/boutiques-forfaits-idees-2026-06-10.md` (v1, 40 idées orientées particuliers / power-sellers).

---

## 0. Le recadrage (lire en premier)

La **v1** traitait la « boutique » comme un **vendeur particulier ou power-seller amélioré** : branding, boost, badges, analytics, trésorerie. Toutes ces idées restent valables — mais elles supposent un acteur qui **saisit ses articles un par un dans l'app, travaille seul, et n'a pas de local**.

La **v2** part d'une réalité différente : une « boutique » sur Second peut aussi (et surtout, pour le modèle payant) être un **vrai commerce physique de seconde main** :

- **friperie** de quartier avec pignon sur rue,
- **dépôt-vente / consignation** qui vend les pièces de tiers (déposants),
- **boutique vintage** avec stock massif et personnel.

Ces acteurs sont des **entreprises immatriculées** (NEQ, TPS/TVQ), avec un **local**, une **équipe**, des **centaines/milliers de pièces uniques**, et des **obligations comptables/fiscales**. Leurs besoins ne sont pas « mieux se présenter » mais « **opérer leur commerce** » : saisir vite, synchroniser le stock magasin↔en ligne, gérer du personnel, gérer des déposants, expédier en masse, sortir leur compta.

> **Rappel du modèle (inchangé, ne pas casser) :** 3 forfaits — **Basic** (gratuit, 0% réduction frais acheteur), **Pro** (29,99 $/mois, 50%), **Premium** (79,99 $/mois, 100%). **0% de commission vendeur** sur tous les paliers. La monétisation passe par l'abonnement + la **réduction des frais ACHETEUR**, jamais par une commission vendeur. Premium doit rester **clairement supérieur**.
> **Rail déjà fait :** `purchaseShopTier` (PaymentIntent charge plateforme directe) → webhook `handleShopTierSucceeded` stampe `tier` + `tierPaidUntil` (server-only) → `resolveBuyerFeeReduction` honore la réduction si `tierPaidUntil > now`. `Shop` porte déjà `tier`, `tierPaidUntil`, `legalInfo {businessNumber, gstNumber, qstNumber}`, `articlesCount`, `location/geohash`, `images[]`, `logo`, `openingHours`, `verificationDetails`.

---

## 1. Pourquoi la v1 ne suffit pas pour un commerce physique

Constats tirés de l'analyse codebase + besoins terrain. La v1 ne couvre **structurellement** pas ces points :

1. **Le modèle est B2C particulier, pas B2B entreprise.** Le `Shop` existe mais la `legalInfo` (NEQ, TPS/TVQ) est **optionnelle et jamais vérifiée** : aucune distinction « entité commerciale immatriculée » vs « identité perso », aucune piste d'audit du statut business. Un vrai commerce ne peut pas prouver qu'il en est un.

2. **Aucune saisie de masse.** Les articles se créent **un par un** via `createArticle` (callable unitaire). Une friperie qui trie des **centaines de pièces uniques par jour**, ou qui veut **migrer 500+ articles** d'un ancien système, ne peut pas. Pas de CSV, pas de batch, pas d'IA en rafale. **C'est LE frein n°1 à l'adoption B2B** (confirmé par le benchmark : sans saisie de masse, aucun commerce ne s'abonne).

3. **Aucun compte d'équipe.** Chaque boutique = **un seul UID**. Une friperie à 3 employés doit **partager un login** (risque sécu, zéro traçabilité) ou tout relayer à la main. Pas de rôles, pas de permissions, pas de journal « qui a fait quoi ».

4. **Aucune synchro de stock magasin↔en ligne.** `toggleArticleSold` est **manuel et unitaire**. Zéro automatisation « vendu au comptoir → délisté en ligne ». Résultat sur des **pièces uniques** : du **stock fantôme**, donc des ventes en ligne d'articles déjà partis en magasin → litige + remboursement. C'est exactement là où Shopify/Square gagnent les commerces physiques.

5. **Les quotas par forfait ne sont jamais appliqués.** Les tiers basic/pro/premium existent et `articlesCount` est dénormalisé — mais **uniquement pour compter**, jamais comme garde à la création (ni dans `firestore.rules`, ni dans la callable). Le levier de conversion le plus simple (« votre stock dépasse le forfait gratuit ») n'est pas câblé.

6. **Aucune logique de consignation / dépôt-vente.** Les articles appartiennent au `sellerId` ; il n'existe **pas** de notion de déposant (`consignerId`), de barème de partage, de solde dû, ni de reversement. Un dépôt-vente — modèle central de la seconde main québécoise — **ne peut tout simplement pas opérer** sur Second.

7. **Pas de Click & Collect.** `deliveryType` vaut `'shipping'` ou `'meetup'` seulement. Le **retrait en magasin** — avantage unique d'un commerce qui a un local — n'existe pas : pas de fenêtre de retrait, pas de flux de cueillette, pas de code anti-fraude.

8. **Pas d'omnicanal ni d'analytics niveau commerce.** Pas de tableau de bord boutique (CA, rotation, articles dormants), pas d'export comptable CAD/TPS/TVQ, pas de découverte de proximité réellement consommée par l'app (`getShopsNearLocation` existe mais **n'est jamais appelée**).

---

## 2. Benchmark — outils des commerces physiques de seconde main

Deux familles : **généralistes POS/e-commerce** (puissants mais **angle mort consignation**) et **verticaux consignation/friperie** (couvrent le déposant mais payants et hors marketplace).

| Outil | Type | Pricing indicatif | Forces clés | Angle mort / lecture pour Second |
|---|---|---|---|---|
| **Shopify + Shopify POS** | E-commerce + POS unifié | Startup ~99 $/mois, Plus 299 $/mois | Stock UNIQUE partagé en ligne↔magasin (anti-survente sur pièces uniques), étiquettes code-barres gratuites, **Click & Collect natif**, multi-boutiques | **Aucune consignation/déposant ni reversement** → fait à la main sur Excel ou via add-on payant (Circle-Hand ~99 $, Rose ~75 $) |
| **Square for Retail / POS** | POS retail entrée de gamme | Gratuit (0 $) ; Plus 49 $/mois ; Premium 149 $/mois (par emplacement) | SKU/remises gratuit, inventaire avancé + code-barres + ajustements en masse (payant), transferts/alertes multi-emplacements | **Même angle mort** : pas de comptes déposants → bricolés en « fournisseurs » ou add-on (Rose, Circle-Hand) |
| **SimpleConsign** (a absorbé ConsignPro) | Vertical consignation/friperie | Base ~159 $/mois, Pro ~259 $/mois ; lancement 99 $/mois | Workflow consignation complet (splits auto 50/50, dégressif), **portail déposant mobile** (le déposant voit ses ventes/solde seul), stock pièces uniques sans code-barres, rôles employés, intégrations Shopify/QuickBooks, saisie déposant à distance | Le cœur métier que les généralistes ratent ; **payant et hors marketplace** (pas de canal de vente intégré) |
| **Ricochet** | POS tout-en-un consignation/revente | 199-278 $/mois + 2,6-2,9% + 0,10 $/transaction | POS all-in-one, **app mobile déposant** (Ricochet Go), e-commerce en add-on +79 $/mois | **Facture des frais de transaction** — contraire au 0% commission vendeur de Second |
| **ConsignCloud / Bravo / BCSS** | Logiciels consignation | SaaS récurrent ; **BCSS = achat unique** (anti-abonnement) | Split paramétrable par article/catégorie/déposant, relevés déposants en un clic, reversements multi-modes (chèque/ACH/cash/crédit boutique, parfois bonus si crédit magasin) | BCSS montre qu'une partie du marché **refuse le SaaS récurrent** → argument prix |
| **eBay Stores** | Marketplace avec abonnement boutique | ~5 $ → ~3000 $/mois (5 paliers) | Chaque palier bundle **quota de listings + réduction de commission + branding/analytics** = exactement « payer un forfait pour réduire les frais ». ROI explicite (Basic ~22 $/mois auto-financé dès ~2500 $ de ventes), conseil « pas de boutique sous ~300 annonces actives » | **Le modèle de référence pour Second** (quotas + réduction de frais + paliers) |
| **Vinted Pro** | Marketplace C2C + volet pro gratuit | Gratuit (badge Pro) | Annonces illimitées, badge « Pro » de confiance, **inscription Pro obligatoire si activité commerciale** (exige numéro d'entreprise) | Aligne la **vérification d'entité** sur l'immatriculation (équivalent NEQ/TPS/TVQ) — base légale du badge « Commerce vérifié » |

**Insights pour Second :**

1. **La saisie de masse est le ticket d'entrée**, pas un bonus. Shopify/Square/SimpleConsign en font tous un prérequis. Sans CSV + IA + code-barres, une vraie boutique ne migre pas.
2. **La synchro stock unique (anti-survente)** est LA feature structurante des généralistes pour les commerces physiques. Sur pièces uniques c'est vital, pas confort.
3. **La consignation est l'angle mort des généralistes** (Shopify, Square) et la **chasse gardée des verticaux payants**. C'est la **différenciation premium maximale** de Second : aucun marketplace grand public ne la gère, et Second a déjà le rail financier (wallet ledger) pour la modéliser.
4. **eBay Stores valide notre mécanique** : quota de listings + réduction de frais bundlés au forfait, avec un ROI chiffrable. Le quota appliqué est le levier de conversion le plus direct et le plus honnête.
5. **Le badge d'entité vérifiée** (Vinted Pro) est le levier de confiance le moins cher — à condition qu'il prouve une **vraie immatriculation**, pas seulement la modération du dossier.
6. **Ne pas refacturer le vendeur** : Ricochet facture 2,6-2,9% — Second garde 0% commission vendeur, c'est un argument commercial face aux verticaux.

---

## 3. LE MENU v2 — idées recadrées commerce physique

> Regroupé par catégorie. **Commerce physique ?** = bénéfice principalement pour un vrai commerce avec local/équipe/stock (vs utile à tout vendeur volume).
> **Tier suggéré** : `pro+premium` = inclus dès pro, enrichi en premium · `premium` = exclusivité haut de gamme.
> **Complexité** : faible / moyenne / élevée (effort, pas risque).
> NB : plusieurs idées sont des **variantes proches** (CSV, synchro stock, quotas, dashboard, Click & Collect, consignation) issues d'angles d'analyse différents — à **dédupliquer au tri**. Numérotation continue pour référence.

### A. Gestion de stock à l'échelle (saisie & édition de masse)

| # | Feature | Description | Catégorie | Commerce physique ? | Tier | Complexité | Réutilise existant | Risque |
|---|---|---|---|:--:|---|---|---|---|
| 1 | **Mise en ligne par lot photo + IA (saisie en rafale)** | L'employé photographie une pile d'articles en rafale ; chaque cliché lance `analyzeProductImage` (titre, marque, catégorie, taille, état, prix) et alimente une file de brouillons à valider/corriger en masse puis publier en un tap. Cible le vrai goulot : des centaines de pièces uniques sans code-barres. | Stock en masse | Oui | pro+premium | moyenne | `analyzeProductImage` (Gemini multi-images), `createArticle` (validation/shopId/`articlesCount`), `useDraft`/`draftService`, `prepareImageForUpload`, sell flow | Coût Gemini à volume (centaines/jour) à **plafonner par quota tier** ; IA inégale sur vintage sans étiquette → validation humaine **obligatoire**, ne pas promettre du 100% auto |
| 2 | **Import / export catalogue CSV** | Téléversement CSV (titre, prix, marque, taille, état, catégorie, SKU, URL photos) validé **ligne à ligne** avec rapport d'erreurs, puis création groupée ; export inverse du catalogue (actif/vendu) pour sauvegarde/migration. Permet à une friperie 500+ pièces de migrer d'un coup. | Stock en masse | Oui | pro+premium | élevée | Validation de `createArticle` (extraire en helper par-ligne), `shopId`/trigger `articlesCount`, Storage (fichier), `shopService.getShopArticles` (export) | Création de masse = explosion d'écritures + triggers (embeddings, search index) → **batcher/throttler en file async** ; mapping CSV hétérogène → assistant de mapping de colonnes |
| 3 | **SKU + code-barres internes avec étiquettes imprimables** | Chaque article reçoit un SKU/code-barres (généré ou repris du CSV) ; planche d'étiquettes PDF (code-barres + prix + nom) à imprimer/coller en magasin. Scan caméra → ouvre la fiche pour édition ou marquage vendu au comptoir. | Stock en masse | Oui | pro+premium | moyenne | Nouveau champ `sku/barcode` sur Article (+ index `shopId`+`sku`), génération PDF déjà pratiquée (bordereaux/labels), caméra du sell flow (scan), `toggleArticleSold` (marquage scan) | Unicité SKU par boutique à garantir (collisions à l'import) ; impression dépend du matériel → gabarit A4 standard par défaut |
| 4 | **Édition groupée + soldes en masse (repricing)** | Sélection multiple (filtre catégorie/marque/ancienneté/déposant) → baisse de prix %, changement catégorie/état, activation, ou campagne de soldes limitée (-20% sur catégorie X jours) avec retour auto au prix initial. Duplication d'un article pour pièces quasi identiques. | Stock en masse | Oui | pro+premium | moyenne | `updateArticle` (→ version batch), champs price drop existants (`originalPrice`, `lastPriceDropAt`, `priceDropPercent`, `promotionActive`), feature/section home `price-drops` | Écritures de masse + notif baisse de prix aux favoris → **spam** à débouncer ; retour auto post-soldes = job scheduled + stockage prix pré-solde |

### B. Synchronisation stock magasin ↔ en ligne (anti-survente)

| # | Feature | Description | Catégorie | Commerce physique ? | Tier | Complexité | Réutilise existant | Risque |
|---|---|---|---|:--:|---|---|---|---|
| 5 | **Synchro stock unique : vendu en boutique = retiré en ligne** | Marquage rapide « vendue en magasin » (scan code-barres ou recherche) qui délise immédiatement en ligne ; inversement une vente en ligne marque indisponible en inventaire. Une seule source de vérité du stock. Décrément batch (sélection multiple). | Synchro stock | Oui | pro+premium | moyenne | `toggleArticleSold` (→ batch + raison `sold_in_store`), trigger `onArticleSold` (`articlesCount` + nettoyage favoris/feed), index `shopId`+`isActive`+`isSold` | Second n'est pas un POS → synchro **semi-manuelle** ; cadrer la promesse (zéro survente SI le commerçant scanne). Import inverse depuis vrai POS (Square/Lightspeed) hors scope v1 |
| 6 | **Marquer « vendu en magasin » (mini-caisse) + anti-survente + journal employé** | Bouton « Vendu en boutique » sur la vue liste multi-sélection, distinct du `isSold` acheteur en ligne. Évite la survente d'une pièce unique déjà partie au comptoir et **journalise quel employé a marqué quoi**. | Synchro / Omnicanal | Oui | pro+premium | moyenne | `toggleArticleSold` (généraliser en masse + raison `in_store`), trigger `articles.ts`/`articlesCount`, `Article.isSold/isActive`. Pas de POS tiers requis | Fraîcheur dépend de la discipline du commerçant ; **race condition** achat en ligne vs marquage magasin simultanés → `runTransaction` côté CF (premier gagne, l'autre reçoit une erreur claire) |

### C. Expédition en masse (fulfillment de volume)

| # | Feature | Description | Catégorie | Commerce physique ? | Tier | Complexité | Réutilise existant | Risque |
|---|---|---|---|:--:|---|---|---|---|
| 7 | **Bordereaux et étiquettes d'expédition par lot** | Sélection de N commandes payées « à expédier » → un PDF multi-étiquettes ShipEngine + bordereaux d'emballage, avec relais PUDO favoris pré-configurés par boutique. Workflow d'impression groupé pour la journée. | Fulfillment | Non (utile à tout volume) | pro+premium | moyenne | `labelFulfillment.ts` + `createLabel` ShipEngine (boucle/batch), `findPickupPoints`/`findPUDOLocations` (relais favoris), statut `label_created`/`shipped`, reconciliation coût réel | Appels ShipEngine multiples = quotas/coûts + **échecs partiels** (1/20 échoue → ne pas tout bloquer, file de retry type `sweepPendingLabels`) ; PDF multi-pages côté CF (mémoire ≥512MiB). **Label non idempotent** : clé d'idempotence par transaction sinon double-achat |
| 8 | **Multi-points relais favoris pré-configurés par boutique** | Pré-enregistrer plusieurs PUDO ShipEngine favoris au niveau boutique + choisir en un tap le relais de dépôt par commande, sans re-saisir à chaque envoi. Couplé au batch (#7). | Fulfillment | Non | pro+premium | moyenne | `findPickupPoints` (callable PUDO), `ShipEngineAddress`/`deliveryType pickup_point`, geohash boutique | API PUDO payante par appel → **cacher** les relais favoris côté doc boutique ; revalider la dispo avant achat label |

### D. Omnicanal / Livraison (retrait en magasin)

| # | Feature | Description | Catégorie | Commerce physique ? | Tier | Complexité | Réutilise existant | Risque |
|---|---|---|---|:--:|---|---|---|---|
| 9 | **Retrait en boutique (Click & Collect)** | Nouveau type de livraison `retrait_magasin` à côté de meetup/shipping : l'acheteur réserve et paie en ligne, vient chercher au comptoir pendant les horaires. Zéro frais de port, zéro étiquette ; adresse + horaires (déjà stockés) servent de point de retrait, code de retrait à présenter en caisse. | Omnicanal / Livraison | Oui | pro+premium | moyenne | `Shop.address`/`location`/`openingHours` présents, `TransactionDeliveryType` à étendre, `createTransaction` gère déjà la branche meetup sans port (le retrait la calque), statuts type `meetup_pending→meetup_completed`, Payment Sheet inchangé | Acheteur déjà payé via Stripe → **fenêtre d'expiration + remboursement si non-retiré** (réutiliser `transactionExpiration`/`releaseHeldFunds`) ; fraude « jamais retiré mais marqué retiré » → **double confirmation** (code acheteur scanné/saisi par la boutique) avant release. **Impact modèle de frais** : sans expédition, sur quoi porte le frais de service ? (décision business) |

### E. Consignation / dépôt-vente (le différenciateur)

| # | Feature | Description | Catégorie | Commerce physique ? | Tier | Complexité | Réutilise existant | Risque |
|---|---|---|---|:--:|---|---|---|---|
| 10 | **Registre déposants & contrats de dépôt numériques** | Sous-collection `consigners` par boutique (déposant = personne physique, **pas un UID Second**) : coordonnées, barème de partage paramétrable (50/50, dégressif après baisse), contrat e-signé horodaté. Chaque article porte `consignerId` + `consignerShare`. | Consignation | Oui | pro+premium | moyenne | `Shop` + sous-collections Firestore (pattern `users/{uid}/consents`), `shopId` déjà denormalisé sur Article → ajouter `consignerId/consignerShare` en miroir, rules CF-only sur champs financiers (comme `tier`/`tierPaidUntil`) | Le déposant n'est PAS un user Second (pas de wallet Stripe) → décider **la boutique encaisse, le déposant est bénéficiaire suivi en ledger interne** ; sinon rail de paiement à un tiers non KYC = risque conformité/AML |
| 11 | **Solde déposant & relevés en un clic (ledger interne)** | À chaque vente d'un article consigné, calcul auto de la part déposant (`consignerShare`) et écriture dans un **ledger interne par déposant** (dû boutique vs dû déposant) ; relevé PDF mensuel par déposant + marquage des reversements effectués (chèque/virement/crédit magasin). | Consignation | Oui | pro+premium | élevée | **Exactement** le pattern wallet ledger (`creditSellerForSale` dans `labelFulfillment.ts` : sous-collection ledger, cents, `balanceAfter`, idempotence via `sellerCreditedCents`) dupliqué dans un consigner ledger alimenté par le même hook de crédit de vente. Wallet boutique reste l'encaisseur (0% commission conservé) | Le reversement effectif se fait **hors rail Stripe** (la boutique paie son déposant) → Second **suit le DÛ, n'exécute pas le paiement** (sinon money-transmitter vers tiers non onboardé) ; réconciliation manuelle si la boutique reverse hors-app sans cocher. Mention « suivi indicatif, hors flux Stripe » |
| 12 | **Portail déposant (accès lecture sans compte vendeur)** | Lien/écran sécurisé où un déposant consulte SES articles (en vente / vendu / à rendre / invendu), son solde courant et l'historique de ses reversements — **sans être vendeur Second** ni voir le reste du stock. Accès via lien magique ou code, lecture seule. | Consignation | Oui | premium | élevée | Registre déposants + ledger (#10/#11) ; vues read-only filtrées par `consignerId` (mêmes patterns que `getShopArticles` filtré `shopId`) ; auth allégée type lien magique | **Loi 25** : exposer ventes/solde à un tiers non-user → cadrer base légale (mandat boutique), durée/révocation du lien, **aucune donnée d'autres déposants ni d'acheteurs**. Fuite si lien partagé → expiration + révocation |
| 13 | **Statut « à rendre / invendu » & fin de contrat déposant** | Cycle de vie consignation : article déposé avec date de fin de contrat ; passé le délai sans vente → bascule « à rendre » (déstocké en ligne auto), liste de retrait par déposant, option « don/ressourcerie » ou « prolongation ». Notifie la boutique des lots à restituer. | Consignation | Oui | pro+premium | moyenne | Job scheduled (pattern `transactionExpiration.ts`/`offerExpiration.ts`), `isActive`/`isSold` pour le délistage, `NotificationType` (ajouter un type) | Faible côté financier ; risque UX : le délistage auto ne doit pas **casser une transaction en cours** → vérifier l'absence de commande pending avant bascule (réutiliser le guard « pas de transaction active ») |

### F. Équipe & permissions (personnel)

| # | Feature | Description | Catégorie | Commerce physique ? | Tier | Complexité | Réutilise existant | Risque |
|---|---|---|---|:--:|---|---|---|---|
| 14 | **Comptes équipe & rôles boutique (personnel)** | La boutique invite plusieurs employés (gérant, préposé inventaire, expéditions, SAV) sous le compte boutique, chacun avec son login et un niveau de permission. Plus de mot de passe partagé ni de relais manuel. | Équipe | Oui | pro+premium | élevée | `Shop.ownerId` → sous-collection `shops/{id}/members {uid, role}`, `firestore.rules` en layers, `authStore`/`useAuth`, `createArticle` résout déjà `shopId` via `ownerId` (à muter pour accepter un membre autorisé), `accountType 'user'|'shop'` déjà dans User | Modèle `Shop` aujourd'hui **1:1 avec un UID** → impacts profonds sur rules (qui écrit au nom de la boutique), ledger (un seul Stripe Custom par boutique, pas par employé), KYC reste au propriétaire ; **privilege escalation** si rôles non verrouillés côté CF. Pro = 3 membres, premium = illimité |
| 15 | **Journal d'activité boutique (qui a fait quoi)** | Registre horodaté des actions sensibles des membres : création/édition/suppression d'article, mise en vendu, baisse de prix, génération d'étiquette, reversement déposant. Le propriétaire voit qui a fait quoi et quand, filtrable par employé. | Équipe | Oui | premium | moyenne | Callables mutantes déjà en place (`createArticle`, `updateArticle`, `toggleArticleSold`, `createLabelIdempotent`) → écrire un événement dans `shops/{id}/activity` à chaque mutation ; logger structuré standardisé. **Dépend des comptes équipe (#14)** | Volume d'écriture par action (coût Firestore) à **borner avec rétention** ; sans attribution par membre le journal est vide de sens ; over-engineering si le périmètre des événements n'est pas restreint aux actions vraiment sensibles |

### G. Quotas & monétisation par volume

| # | Feature | Description | Catégorie | Commerce physique ? | Tier | Complexité | Réutilise existant | Risque |
|---|---|---|---|:--:|---|---|---|---|
| 16 | **Quotas d'articles par forfait (réellement appliqués)** | Plafonds d'articles actifs ENFORCÉS à la création : basic ~30, pro ~300-1000, premium illimité/très élevé. Garde côté Cloud Function au `createArticle`/import + message d'incitation à monter de forfait au plafond. | Monétisation / Quotas | Oui (raison d'être = gros stock) | pro+premium | faible | `Shop.tier` + `tierPaidUntil` + `articlesCount` déjà présents (denorm, jamais appliqués en garde), `createArticle` peut lire le tier et refuser au-delà, `resolveBuyerFeeReduction` connaît déjà le pattern d'expiration | **À l'expiration du forfait : ne JAMAIS supprimer** les articles excédentaires (perte de données + colère) → geler/désactiver au-delà du plafond, réactiver au renouvellement (grandfathering) ; `articlesCount` doit être fiable (dépend du trigger) sinon garde fausse. **Calibrage business fondateur requis** |

### H. Vitrine locale & découverte de proximité

| # | Feature | Description | Catégorie | Commerce physique ? | Tier | Complexité | Réutilise existant | Risque |
|---|---|---|---|:--:|---|---|---|---|
| 17 | **Rail « Friperies à proximité »** | Carrousel Home qui géolocalise l'acheteur et affiche les boutiques physiques approuvées dans un rayon (5/10/25 km) : distance, type (friperie/vintage/dépôt-vente), statut ouvert/fermé en direct. Pousse la découverte des commerces réels plutôt que des vendeurs anonymes. | Découverte locale | Oui | pro+premium | moyenne | `ShopService.getShopsNearLocation` (codé avec geohash/geofire-common, **jamais consommé par l'app**), index geohash, `OpeningHours`, pattern section Home + `SectionHeader`. Manque : intégrer **expo-location** (absent) + boost de tri par tier | Permission de localisation (refus = rail vide → fallback ville saisie) ; tri par tier **côté serveur** (anti-manipulation) ; densité faible en région au lancement |
| 18 | **Bouton Itinéraire + statut Ouvert/Fermé live** | Sur la page boutique : CTA « Itinéraire » qui ouvre Plans/Google Maps natif, et badge dynamique « Ouvert · ferme à 18h » / « Fermé · ouvre demain 10h » calculé depuis les horaires. Transforme la fiche en vitrine locale exploitable. | Découverte locale | Oui | pro+premium | faible | `shop.location` (lat/lng), MapView/Marker déjà rendu sur `app/shop/[id].tsx`, `Linking` déjà utilisé (`handleCall`/`handleEmail`), `renderOpeningHours` déjà présent (dériver le statut courant). **Aucune nouvelle donnée** | Très faible ; gérer fuseau Québec pour ouvert/fermé et horaires `null` (déjà supportés) |
| 19 | **Galerie magasin enrichie + vitrine « à la une »** | Vitrine premium : galerie du local et de l'équipe, bannière/cover, mini-bio « Notre histoire », mise en avant éditoriale (tête du rail local + carte « Boutique à la une dans votre ville »). Présence digitale soignée pour le commerce physique. | Découverte locale | Oui | premium | faible | `shop.images[]` (galerie déjà rendue), `shop.logo`, upload Storage + `prepareImageForUpload`, rail local (#17) pour le placement « à la une ». Surtout DS/UI sur donnée existante | Mise en avant = ressource limitée → règles d'équité/rotation (un commerce ne monopolise pas la une d'une ville) ; modération photos |
| 20 | **Filtre & carte « Boutiques physiques » dans la recherche** | Filtre « Vendu par un commerce physique » + vue carte des friperies dans recherche/exploration, pour trouver des pièces dispo en boutique près de soi et repérer les commerces vérifiés d'un coup d'œil. | Découverte locale | Oui | pro+premium | moyenne | Architecture recherche Firestore maison (`features/search`, `useArticleSearch`), `shopId` indexé sur articles, `getShopsNearLocation` + geohash (carte), MapView, `FilterChipsRow`. Manque : flag dérivé `isPhysicalShop` exposé au filtre | Cohérence géo requise (toutes boutiques approuvées avec lat/lng valides) ; perf carte (clustering si beaucoup de marqueurs) ; tri par tier **côté serveur** |

### I. Confiance & vérification d'entité

| # | Feature | Description | Catégorie | Commerce physique ? | Tier | Complexité | Réutilise existant | Risque |
|---|---|---|---|:--:|---|---|---|---|
| 21 | **Badge « Commerce vérifié (NEQ) » + profil entreprise** | Distingue les vrais commerces immatriculés des particuliers : badge « Entreprise vérifiée » sur la fiche boutique ET les cartes article, conditionné à un **NEQ/numéro d'entreprise validé** (pas seulement au statut admin). Bloc « Profil entreprise » (raison sociale, NEQ, années d'activité). | Confiance & vérification | Oui | pro+premium | moyenne | `ShopLegalInfo.businessNumber` (NEQ) déjà typé, `ShopVerificationDetails` (`verifiedAt`/`verifiedBy`) présent, callable `approveShop` déployée, `ProductCard` pour le micro-badge. Le badge actuel « Boutique vérifiée » est **seulement status-based** (à durcir) | Vérif NEQ manuelle/admin au départ (charge ops, pas d'API auto) ; distinguer clairement « identité perso vérifiée » vs « entreprise vérifiée » pour ne pas induire l'acheteur en erreur (Loi 25) |

### J. Analytics business & comptabilité

| # | Feature | Description | Catégorie | Commerce physique ? | Tier | Complexité | Réutilise existant | Risque |
|---|---|---|---|:--:|---|---|---|---|
| 22 | **Tableau de bord boutique : stock, rotation & articles dormants** | Dashboard agrégé **niveau Shop** (pas article) : CA par période, panier moyen, taux de rotation/turnover, top catégories, **articles dormants** (non vendus depuis X jours), alertes (forfait proche du quota, stock dormant à solder). Export CSV ventes/frais par période pour la compta CAD (résumé TPS/TVQ). | Analytics & compta | Non (utile aussi aux power-sellers pro) | pro+premium | élevée | `userStatsService` (patron → créer `shopStatsService` agrégé), `scheduled/stats.ts` (pré-agréger), transactions par `sellerId`/`shopId`, `ShopLegalInfo` (NEQ/TPS/TVQ) pour l'en-tête fiscal, `articlesCount`/`tier` pour les alertes | Agrégation niveau shop = jobs scheduled coûteux à volume → **précalculer** ; l'export fiscal n'est **PAS une déclaration officielle** → formuler comme aide, ne pas porter de responsabilité comptable réglementée |
| 23 | **Tableau de bord business + relevé fiscal NEQ/TPS/TVQ + vérif d'entité** | Variante orientée conformité : dashboard niveau boutique (CA, prix moyen, rotation, dormants, conversion) **+ export comptable CAD par période + récap taxes TPS/TVQ** prêt déclaration, lié au **NEQ vérifié** ; débloque le badge « Commerce vérifié ». Connecté au scaffold taxes existant. | Analytics & conformité | Oui | premium | moyenne | `fees.ts` (`getTaxConfig`, `GST_RATE`/`QST_RATE`, `computeTaxOnServiceFee`, `TaxBreakdown`), Transaction stocke `serviceFee`/`shipping`/`tax`, `Shop.legalInfo` (NEQ/`gstNumber`/`qstNumber`), `recordTransactionRevenue`, `admin/shops` (statut vérif), scheduled type `stats.ts` | **Décision fiscale fondateur non tranchée** : `TAX_ENABLED=false` ; la taxe ne porte aujourd'hui **que sur le service fee plateforme, PAS sur le prix article** → un export « prêt déclaration » pourrait induire en erreur. Cadrer juridiquement (fiscaliste) avant de promettre un sommaire fiscal ; statut « entreprise vérifiée » requis avant d'émettre un relevé sur des numéros non validés |

### K. Animation & multi-boutiques (premium)

| # | Feature | Description | Catégorie | Commerce physique ? | Tier | Complexité | Réutilise existant | Risque |
|---|---|---|---|:--:|---|---|---|---|
| 24 | **Événements boutique : arrivages & vide-dressings** | Les commerces publient des événements datés (gros arrivage, braderie, vide-dressing, soldes -50%) visibles sur leur fiche et dans un rail « Événements près de chez vous » ; les abonnés à la boutique reçoivent une notif. Crée du trafic récurrent en magasin et en ligne. | Animation locale | Oui | premium | moyenne | Follow boutique/vendeur (`useSellerLikes`) pour cibler, push (`sendPushNotification`, types extensibles), géoloc du rail « à proximité », `shop.location`/horaires. Aucun concept d'événement aujourd'hui (sous-collection `shops/{id}/events` à créer) | **Spam** notifications si non plafonné (fatigue → désinscriptions) ; modération (événements trompeurs) ; faible valeur sans base d'abonnés suffisante au lancement |
| 25 | **Soldes & ré-étiquetage de prix en masse (déstockage programmé)** | Campagnes de démarque à l'échelle : -X% sur catégorie/sélection, limitées dans le temps ; baisses auto sur le stock ancien (articles dormants) ; workflow de repricing en lot. | Pricing en lot | Oui | premium | moyenne | `price-drops` (section home + notif `price_drop` déjà câblée aux favoris), trigger `articles.ts` propage, le dashboard « articles dormants » (#22) fournit la cible de la démarque auto | Démarque en lot → **centaines de notifs `price_drop` d'un coup** (spam push + pic de charge) à throttler/agréger ; interaction avec offres en cours et consignation (split déposant calculé sur l'ancien prix ?) à border sinon reversements faussés |
| 26 | **Multi-boutiques & vue corporative (chaîne)** | Une entité (chaîne de friperies, même propriétaire/société) gère plusieurs succursales sous un compte parent : dashboard corporatif consolidé (CA par succursale, inventaire partagé visible, stats croisées), facturation entreprise unique. | Multi-boutiques | Oui | premium | élevée | `Shop` comme « succursale » (+ `parentOrgId`/`organizations/{id}`), comptes équipe & rôles (#14) réutilisés pour la portée corporative, `purchaseShopTier`/`tierPaidUntil` (facturation à agréger), `admin/shops` (vue multi), analytics shop-level (#22) à consolider | **Repose sur #14 + #22** (à ne pas lancer avant) ; `Shop.ownerId` 1:1 et Stripe Custom (un compte de paiement par boutique) compliquent trésorerie/KYC corporatifs ; **segment très étroit au Québec** → valider commercialement avant de coder |

> **Total : 26 features distinctes** (les 43 propositions des données ont été dédupliquées — CSV/import apparaissait 6×, synchro stock 4×, quotas 5×, dashboard 5×, Click & Collect 4×, consignation regroupée en 4 briques). La numérotation reflète des chantiers, pas des doublons.

---

## 4. Section spéciale — CONSIGNATION (structurant, à décider tôt)

**Le sujet.** Un **dépôt-vente** (consignment) ne possède pas son stock : il vend les pièces de **déposants** (consigners — des particuliers qui confient leurs vêtements). À chaque vente, le commerce **reverse une part** au déposant selon un barème (souvent 50/50, parfois dégressif quand le prix a baissé), garde le reste, et **restitue les invendus** en fin de contrat (souvent 60-90 jours). C'est un modèle **central de la seconde main québécoise** et l'**angle mort total** des marketplaces grand public (Shopify, Square, Vinted) — la chasse gardée des verticaux payants (SimpleConsign, ConsignCloud). **C'est la différenciation premium la plus forte de Second.**

**Pourquoi c'est faisable ici (et structurant).** Second a déjà le **rail financier exact** : le wallet ledger (`creditSellerForSale` dans `labelFulfillment.ts`) écrit en cents dans une sous-collection, avec `balanceAfter` et idempotence. La consignation **duplique ce pattern** dans un **ledger interne par déposant**, alimenté par le **même hook de crédit de vente** (en ligne ET « vendu en magasin » #5/#6).

**La décision financière à prendre AVANT de coder :** le déposant **n'est PAS un utilisateur Second** et **n'a pas de wallet Stripe**. Il ne faut donc **pas** créer un rail de paiement automatique vers lui (= money-transmitter vers un tiers non KYC, risque conformité/AML). Le cadrage recommandé, cohérent avec le 0% commission vendeur :

- **La BOUTIQUE encaisse** (via son wallet/Stripe Custom, comme aujourd'hui).
- **Le déposant est un bénéficiaire suivi en LEDGER INTERNE** : Second calcule et trace le **DÛ**, génère les relevés, mais **n'exécute pas le reversement** (la boutique paie son déposant elle-même : chèque, virement, ou crédit magasin) et coche « reversé » dans l'app.
- Mention systématique « **suivi indicatif, hors flux Stripe** » + réconciliation manuelle possible.

**Briques (par ordre de dépendance) :** #10 registre déposants & contrats → #11 ledger & relevés → #13 statut « à rendre »/fin de contrat → #12 portail déposant (premium, dépend de #10/#11) → s'articule avec #5/#6 (une vente comptoir d'un article consigné crée un dû déposant **sans** encaissement Stripe — le ledger doit le savoir pour ne pas attendre un flux inexistant) et avec #25 (un split calculé après démarque ne doit pas fausser le reversement).

---

## 5. Matrice de tiers proposée (À TRIER ENSEMBLE — intègre v1 + v2)

> Proposition de départ, **pas une décision**. Principe : pro = utilisable par un commerce qui démarre, premium = clairement supérieur (exclusivités gros commerces). Les renvois `v1#n` pointent vers le menu v1.

| Capacité | Basic | Pro | Premium |
|---|:--:|:--:|:--:|
| Réduction frais acheteur (actuel) | 0% | 50% | 100% |
| **Quota d'articles actifs** (#16, v1#30/31) | ~30 | ~300-1000 | illimité / très élevé |
| **Saisie de masse** : photo+IA en rafale (#1), CSV (#2) | ☐ | ☑ volume standard + IA | ☑ volume supérieur + IA prioritaire |
| **SKU / code-barres + étiquettes** (#3) | ☐ | ☑ | ☑ |
| **Édition groupée / soldes en masse** (#4, #25) | ☐ | ☑ repricing | ☑ + déstockage programmé / auto-markdown |
| **Synchro stock magasin↔en ligne** (#5, #6) | ☐ | ☑ anti-survente | ☑ + journal employé |
| **Étiquettes en lot + relais favoris** (#7, #8, v1#37/38) | ☐ | ☑ | ☑ + plages d'enlèvement |
| **Retrait en magasin / Click & Collect** (#9) | ☐ | ☑ | ☑ + points de retrait multiples |
| **Consignation** : registre + ledger + relevés (#10/#11/#13) | ☐ | ☑ déposants + relevés | ☑ + dégressif avancé |
| **Portail déposant** (#12) | ☐ | ☐ | ☑ exclusif premium |
| **Comptes équipe & rôles** (#14) | ☐ | ☑ ~3 membres | ☑ illimité |
| **Journal d'activité boutique** (#15) | ☐ | ☐ | ☑ exclusif premium |
| **Vitrine locale** : itinéraire + ouvert/fermé (#18) | ☐ | ☑ | ☑ |
| **Rail « Friperies à proximité » + carte** (#17, #20) | ☐ | ☑ inclus, tri standard | ☑ priorité de placement |
| **Galerie/vitrine « à la une »** (#19) | ☐ | ☐ | ☑ exclusif premium |
| **Badge « Commerce vérifié (NEQ) »** (#21) | ☐ | ☑ après vérif NEQ | ☑ niveau renforcé |
| **Dashboard boutique** (rotation, dormants) (#22) | ☐ | ☑ stats essentielles | ☑ + comparaison période |
| **Export comptable CAD + récap TPS/TVQ** (#23) | ☐ | ☐ | ☑ exclusif premium |
| **Événements boutique (arrivages)** (#24) | ☐ | ☐ | ☑ exclusif premium |
| **Multi-boutiques / vue corporative** (#26) | ☐ | ☐ | ☑ exclusif premium (chaînes) |
| *(rappel v1)* Badges confiance, boost, abonnés, codes promo, livraison offerte, crédits envoi, trésorerie accélérée | ☐ | ☑ versions standard | ☑ versions enrichies |

**Exclusivités premium proposées (ce qui fait sauter le palier) :** portail déposant (#12), journal d'activité (#15), galerie « à la une » (#19), export comptable/fiscal (#23), événements boutique (#24), multi-boutiques corporatif (#26), + dégressif consignation avancé. Ce sont des fonctions de **gros commerce / gouvernance / conformité** sans valeur pour un particulier — premium reste clairement supérieur.

---

## 6. Quick wins (faible complexité, réutilise l'infra déjà là)

À livrer en premier : delta d'effort faible, valeur perçue forte, infra existante (géoloc/legalInfo/multi-images déjà présentes).

1. **#16 Quotas d'articles par forfait** *(faible)* — `tier` + `tierPaidUntil` + `articlesCount` déjà là, il manque la **garde** au `createArticle`/rules. **Levier de conversion le plus direct** (modèle eBay Stores). Attention au comportement à l'expiration (geler, jamais supprimer).
2. **#18 Itinéraire + statut Ouvert/Fermé live** *(faible)* — `shop.location`, MapView, `Linking`, `renderOpeningHours` **tous déjà présents**. Aucune nouvelle donnée. Transforme la fiche en vraie vitrine locale (drive-to-store).
3. **#19 Galerie/vitrine enrichie** *(faible)* — `shop.images[]`, `shop.logo`, upload Storage + compression déjà en place. Surtout du DS/UI sur de la donnée existante.
4. **#21 Badge « Commerce vérifié (NEQ) »** *(moyenne, mais haut ROI)* — `ShopLegalInfo.businessNumber` + `ShopVerificationDetails` + `approveShop` déjà là ; durcir le badge actuel (status-based) en vérif NEQ réelle.

> Le **rail « Friperies à proximité » (#17)** est presque un quick win : `getShopsNearLocation` est **déjà codé** (geohash/geofire-common) mais **jamais consommé** — il manque uniquement `expo-location` (absent du projet) et un boost de tri par tier. Fort effet « commerce local » pour un effort moyen.

---

## 7. Questions ouvertes pour le fondateur

1. **Cible réelle :** combien de **friperies/dépôts-vente physiques** vise-t-on vs **particuliers/power-sellers** ? Le ratio détermine si on investit dans l'outillage commerce (CSV, équipe, consignation, Click & Collect) ou si on reste sur l'enrichissement v1.
2. **Prix des paliers :** on garde pro 29,99 $ / premium 79,99 $ maintenant que les forfaits portent de l'outillage opérationnel lourd ? (eBay Basic à ~22 $/mois s'auto-finance dès ~2500 $ de ventes — quel ROI affiche-t-on à une friperie ?)
3. **Consignation : prioritaire ou non ?** C'est le différenciateur premium maximal (angle mort des généralistes) MAIS un chantier financier + conformité réel. On en fait un pilier premium dès la v2, ou on l'écarte d'abord ? Et on **acte le cadrage** « boutique encaisse, déposant = ledger interne hors Stripe » ?
4. **POS / intégration externe :** Second reste-t-il **standalone** (synchro semi-manuelle par marquage/scan, #5/#6) ou vise-t-on à terme une intégration vrai POS (Square/Lightspeed) pour la synchro auto ? Cela change la promesse « zéro survente ».
5. **Click & Collect (#9) :** s'il n'y a pas d'expédition, **sur quoi porte le frais de service** (= revenu plateforme) ? Décision business à trancher avant de coder le type `retrait_magasin`.
6. **Comptes équipe (#14) :** acceptable que le modèle `Shop` passe de 1:1 (un UID) à 1:N (membres), avec les impacts sur rules + KYC (KYC reste au propriétaire, un seul Stripe Custom par boutique) ? C'est un prérequis pour #15 et #26.
7. **Fiscalité (#23) :** on attend le feu vert d'un fiscaliste + l'activation de `TAX_ENABLED` avant de promettre tout « relevé fiscal », sachant que la taxe ne porte aujourd'hui **que sur le service fee, pas sur le prix article** ?
8. **Vérification d'entité (#21) :** vérif NEQ **manuelle/admin** au départ (charge ops) acceptable, ou on attend une API du Registraire des entreprises QC ? Et on **renomme** l'actuel « Boutique vérifiée » (status-based, trompeur) avant d'introduire « Commerce vérifié (NEQ) » ?
9. **Coût IA à volume (#1/#2) :** la saisie en rafale appelle `analyzeProductImage` (Gemini) des centaines de fois/jour — rappel : cette fonction a déjà été le principal driver de coût GCP (minInstances chaud). On plafonne par quota tier ET on traite en file async batchée ?

---

*Document de travail v2 — recadré commerces physiques. Aucune idée hors des données fournies, aucune décision arrêtée. À trier ensemble, et à dédupliquer avec la v1 (badges, boost, dashboards, trésorerie, livraison se recoupent).*
