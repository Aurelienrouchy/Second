# Menu décisionnel des forfaits boutique — à trancher ensemble

**Date :** 2026-06-10
**Statut :** document de travail. **Rien n'est arrêté.** Ce document existe pour qu'on parcoure ensemble, ligne par ligne, l'inventaire complet des features possibles des forfaits boutique de Second, et qu'on décide à deux quoi mettre dans quel palier (ou écarter). La colonne **DÉCISION** de chaque tableau est volontairement vide — on la remplit pendant la session.

---

## 1. Objectif

Second a aujourd'hui le rail d'encaissement des abonnements boutique déjà construit (achat de forfait, date de validité, écran d'achat). Ce qui manque, c'est **le contenu de l'offre** : qu'est-ce qu'un commerce obtient concrètement en payant Pro ou Premium ?

Ce menu regroupe **48 features candidates** issues de deux campagnes d'idéation (v1 = orientation marketplace/particulier, v2 = orientation commerce physique/friperie), fusionnées et dédoublonnées. Chaque feature est qualifiée : pour qui, quel palier suggéré, quelle complexité, ce qu'elle réutilise de l'existant, et son principal risque.

Le but de la session : **arbitrer le périmètre du MVP boutique** et la frontière Basic / Pro / Premium.

---

## 2. Le modèle (rappel)

Trois forfaits. **0 % de commission vendeur sur les trois paliers** — c'est un choix assumé. La monétisation repose sur **l'abonnement** + la **réduction des frais ACHETEUR** (un acheteur paie moins de frais de service quand le vendeur est abonné, ce qui rend la boutique plus attractive et booste sa conversion).

| Forfait | Prix (placeholder) | Réduction frais acheteur | Commission vendeur |
|---|---|---|---|
| **Basic** | Gratuit | 0 % | 0 % |
| **Pro** | 29,99 $/mois | 50 % | 0 % |
| **Premium** | 79,99 $/mois | 100 % (frais acheteur offerts) | 0 % |

- **Rail d'encaissement déjà en place** : `purchaseShopTier` + `tierPaidUntil` + écran d'achat. On câble l'offre dessus, on ne reconstruit pas la plomberie de paiement.
- **Les prix sont des placeholders** — à valider ensemble (voir Questions ouvertes).
- **Premium doit rester clairement supérieur** à Pro, pas juste « Pro + un peu plus ». Les exclusivités premium sont marquées dans ce document.

---

## 3. Décisions déjà prises (à valider avec l'associé)

Ces orientations ont été prises en amont. Elles structurent tout le reste — d'où l'importance de les confirmer (ou les retoquer) en premier.

1. **Cible = commerces physiques d'abord.** On vise prioritairement les friperies, dépôts-vente et boutiques vintage, pas le particulier power-seller. La majorité des features « commerce physique » du menu en découlent.
2. **La consignation (dépôt-vente) est le pilier premium.** C'est l'angle mort des marketplaces généralistes (Vinted, Poshmark n'ont rien) et le quotidien d'une grande partie des friperies québécoises. Voir la section spéciale §8.
3. **Le Click & Collect (retrait en magasin) est validé** comme feature à ajouter — c'est le pont naturel entre la boutique physique et l'app.

> Si l'une de ces trois prémisses ne tient pas (ex. on veut autant servir le particulier que le commerce), tout le reste du menu change de pondération. **À trancher avant le reste.**

---

## 4. Repères concurrents — pourquoi un commerce accepterait de payer

| Concurrent | Modèle pertinent | Ce qu'on en retient |
|---|---|---|
| **eBay Stores** | Abonnement mensuel avec **quota de listings** + **réduction des frais de vente** bundlés par palier | Modèle de référence du « plus tu paies, plus tu peux lister / moins tu paies de frais ». Valide notre logique abonnement + quotas + réduction. |
| **Vinted Pro** | Compte **entité vérifiée** (badge pro, statut entreprise, conformité) | Le badge « entreprise vérifiée » est un produit en soi. Justifie notre badge KYC + NEQ. |
| **SimpleConsign / ConsignCloud** | Logiciels **dédiés consignation** (registre déposants, parts, relevés) | La consignation est un marché logiciel à part entière — et **personne dans les marketplaces grand public ne le fait**. C'est notre différenciateur premium. |
| **Shopify POS / Square** | **Synchro stock unique** anti-survente + **Click & Collect** natif | Standards attendus par tout commerce physique. On ne sera pas un POS complet, mais on doit offrir le minimum crédible (anti-survente sur pièce unique, retrait magasin). |

**Insights pour la décision :**

- **On vend deux choses différentes** : aux particuliers, de la *visibilité* (boost, vitrine, audience) ; aux commerces, de l'*outillage opérationnel* (stock, consignation, équipe, fulfillment). Le menu doit assumer cette dualité.
- **Notre fossé défendable, c'est la consignation** — les généralistes ne l'ont pas, les logiciels dédiés n'ont pas de marketplace. Croiser les deux est unique.
- **Le badge « vérifié » n'a de valeur que s'il est vrai** (KYC + NEQ réels). Un badge accordé sur simple paiement détruit la confiance et nous expose juridiquement.
- **Le risque numéro un de tout le menu, c'est le spam** (notifications abonnés, démarques de masse, boost qui pollue le feed). Chaque feature de mise en avant doit avoir un plafond serveur.

---

## 5. LE MENU COMPLET

> Légende complexité : **faible** (jours), **moyenne** (1-2 semaines), **élevée** (chantier).
> Colonne **☐ DÉCISION** : à cocher ensemble — `☐ Basic ☐ Pro ☐ Premium ☐ Écarter`.

### Catégorie A — Découverte locale & vitrine physique

| # | Feature | Description | Pour qui | Tier suggéré | Complexité | Réutilise l'existant | Risque / contrainte | ☐ DÉCISION |
|---|---|---|---|---|---|---|---|---|
| 1 | Rail « Friperies à proximité » (Home géolocalisée) | Carrousel Home géolocalisé : boutiques physiques approuvées dans un rayon (5/10/25 km), distance, type, ouvert/fermé en direct. Pro = rotation curatée ; premium = emplacements priorisés/garantis + priorité search locale. | Commerce physique | Pro + Premium | Moyenne | `ShopService.getShopsNearLocation` (geohash, codé jamais consommé), index geohash, `OpeningHours`, sections home server-curated + `SectionHeader`. Manque : `expo-location` + `getFeaturedShops`. | Permission localisation (refus → ville saisie) ; tri par tier côté serveur (anti-manipulation) ; densité faible en région ; équité de rotation. | ☐ Basic ☐ Pro ☐ Premium ☐ Écarter |
| 2 | Bouton Itinéraire + statut Ouvert/Fermé live | CTA « Itinéraire » (Plans/Google Maps natif) + badge dynamique « Ouvert · ferme à 18h » / « Fermé · ouvre demain 10h » calculé depuis les horaires. | Commerce physique | Pro + Premium | Faible | `shop.location`, `MapView`/`Marker` déjà rendus, `Linking`, `renderOpeningHours` présent. Aucune nouvelle donnée. | Très faible ; gérer fuseau Québec et horaires null (déjà supportés). | ☐ Basic ☐ Pro ☐ Premium ☐ Écarter |
| 3 | Filtre & carte « Boutiques physiques » dans la recherche | Filtre « Vendu par un commerce physique » + vue carte des friperies dans recherche/exploration. | Commerce physique | Pro + Premium | Moyenne | Recherche Firestore maison (`features/search`, `useArticleSearch`), `shopId` indexé, `getShopsNearLocation` + geohash, `MapView`, `FilterChipsRow`. Manque : flag `isPhysicalShop`. | Cohérence géo (lat/lng valides) ; perf carte (clustering) ; tri par tier serveur. | ☐ Basic ☐ Pro ☐ Premium ☐ Écarter |
| 4 | Galerie magasin enrichie & vitrine « à la une dans votre ville » | Galerie du local + équipe, mini-bio « Notre histoire », mise en avant éditoriale (tête du rail local + carte « Boutique à la une dans votre ville »). | Commerce physique | Premium | Faible | `shop.images[]`, `shop.logo`, upload Storage + `prepareImageForUpload`, rail local pour le placement. Surtout DS/UI sur donnée existante. | Mise en avant = ressource limitée → règles d'équité/rotation ; modération photos. | ☐ Basic ☐ Pro ☐ Premium ☐ Écarter |

### Catégorie B — Omnicanal & livraison

| # | Feature | Description | Pour qui | Tier suggéré | Complexité | Réutilise l'existant | Risque / contrainte | ☐ DÉCISION |
|---|---|---|---|---|---|---|---|---|
| 5 | Retrait en boutique (Click & Collect) | Nouveau type de livraison `retrait_magasin` : l'acheteur réserve et paie en ligne, vient chercher au comptoir. Zéro port, zéro étiquette ; code de retrait présenté en caisse. | Commerce physique | Pro + Premium | Moyenne | `Shop.address/location/openingHours`, `TransactionDeliveryType` à étendre, `createTransaction` gère déjà la branche meetup sans port (le retrait la calque), statuts type meetup, Payment Sheet inchangé. | Acheteur déjà payé → fenêtre d'expiration + remboursement si non-retiré ; fraude « marqué retiré » → double confirmation (code scanné). **Sans expédition : sur quoi porte le frais de service ?** | ☐ Basic ☐ Pro ☐ Premium ☐ Écarter |
| 6 | Synchro stock unique : vendu en boutique = retiré en ligne | Bouton « Vendu en boutique » sur la liste multi-sélection (scan/recherche), distinct du `isSold` acheteur en ligne, qui délise immédiatement en ligne. Anti-survente sur pièce unique + journal employé. Une seule source de vérité. | Commerce physique | Pro + Premium | Moyenne | `toggleArticleSold` (→ batch + raison `sold_in_store`), trigger `onArticleSold` (count + favoris/feed), index `shopId+isActive+isSold`. Pas de POS tiers. | Pas un POS → synchro semi-manuelle, cadrer la promesse (zéro survente SI scan) ; race condition achat/marquage → `runTransaction` (premier gagne) ; dépend de la discipline du commerçant. Import inverse depuis vrai POS hors scope. | ☐ Basic ☐ Pro ☐ Premium ☐ Écarter |

### Catégorie C — Stock en masse & catalogue

| # | Feature | Description | Pour qui | Tier suggéré | Complexité | Réutilise l'existant | Risque / contrainte | ☐ DÉCISION |
|---|---|---|---|---|---|---|---|---|
| 7 | Mise en ligne par lot photo + IA (saisie en rafale) | L'employé photographie une pile en rafale ; chaque cliché lance `analyzeProductImage` (titre, marque, catégorie, taille, état, prix) et alimente une file de brouillons à valider/corriger en masse puis publier. | Commerce physique | Pro + Premium | Moyenne | `analyzeProductImage` (Gemini multi-images), `createArticle`, `useDraft`/`draftService`, `prepareImageForUpload`, sell flow. | Coût Gemini à volume (centaines/jour) à plafonner par quota tier ; IA inégale sur vintage sans étiquette → validation humaine obligatoire. | ☐ Basic ☐ Pro ☐ Premium ☐ Écarter |
| 8 | Import / export catalogue CSV (bulk) + édition groupée | Téléversement CSV validé ligne à ligne (rapport d'erreurs) puis création groupée ; export inverse ; édition groupée (baisse -X%, activer/désactiver, changer catégorie/statut). Même pipeline de validation que la création unitaire. | Les deux | Pro + Premium | Élevée | Validation `createArticle` (à extraire en helper par-ligne), `articlesService`, trigger `articlesCount`, Storage, `getShopArticles` (export), `draftService` (staging), champs price drop. | Création de masse = explosion d'écritures + triggers (embeddings, search index) → file async batchée ; mapping CSV hétérogène → assistant de mapping ; images manquantes → mode brouillon ; plafonner volume par lot. | ☐ Basic ☐ Pro ☐ Premium ☐ Écarter |
| 9 | SKU + code-barres internes avec étiquettes imprimables | Chaque article reçoit un SKU/code-barres ; planche d'étiquettes PDF (code-barres + prix + nom) à imprimer/coller. Scan caméra → ouvre la fiche ou marque vendu au comptoir. | Commerce physique | Pro + Premium | Moyenne | Nouveau champ `sku`/`barcode` (+ index `shopId+sku`), génération PDF déjà pratiquée (bordereaux), caméra du sell flow (scan), `toggleArticleSold` (marquage scan). | Unicité SKU par boutique à garantir (collisions à l'import) ; impression dépend du matériel → gabarit A4 standard par défaut. | ☐ Basic ☐ Pro ☐ Premium ☐ Écarter |
| 10 | Soldes & démarque en masse (repricing programmé + dormants) | Campagnes -X% sur catégorie/sélection limitées dans le temps avec retour auto au prix initial, baisses auto sur stock ancien, repricing en lot. Sélection multiple par filtre. | Commerce physique | Premium | Moyenne | `updateArticle` (→ batch), champs price drop existants, section home price-drops + notif `price_drop` (favoris), dashboard « articles dormants », trigger `articles.ts`. | Démarque de masse → centaines de notifs `price_drop` d'un coup à throttler/agréger ; retour auto = job scheduled + stockage prix pré-solde ; interaction avec offres en cours et consignation (split sur ancien ou nouveau prix ?). | ☐ Basic ☐ Pro ☐ Premium ☐ Écarter |

### Catégorie D — Consignation (dépôt-vente)

| # | Feature | Description | Pour qui | Tier suggéré | Complexité | Réutilise l'existant | Risque / contrainte | ☐ DÉCISION |
|---|---|---|---|---|---|---|---|---|
| 11 | Registre déposants & contrats de dépôt numériques | Sous-collection `consigners` par boutique (déposant = personne physique, **pas un UID Second**) : coordonnées, barème de partage paramétrable (50/50, dégressif), contrat e-signé horodaté. Chaque article porte `consignerId` + `consignerShare`. | Commerce physique | Pro + Premium | Moyenne | `Shop` + sous-collections Firestore (pattern `users/{uid}/consents`), `shopId` denorm sur Article → ajouter `consignerId`/`consignerShare`, rules CF-only sur champs financiers. | Le déposant n'est PAS un user Second (pas de wallet Stripe) → la boutique encaisse, le déposant est bénéficiaire suivi en **ledger interne** ; sinon rail de paiement à un tiers non KYC = risque conformité/AML. | ☐ Basic ☐ Pro ☐ Premium ☐ Écarter |
| 12 | Solde déposant & relevés (ledger interne) | À chaque vente consignée, calcul auto de la part déposant + écriture dans un ledger interne par déposant (dû boutique vs dû déposant) ; relevé PDF mensuel + marquage des reversements (chèque/virement/crédit magasin). | Commerce physique | Pro + Premium | Élevée | Pattern wallet ledger (`creditSellerForSale` dans `labelFulfillment.ts` : sous-collection ledger, cents, idempotence) dupliqué dans un consigner ledger alimenté par le même hook. Wallet boutique reste l'encaisseur (0 % conservé). | Le reversement effectif se fait **hors rail Stripe** (la boutique paie son déposant) → Second suit le DÛ, n'exécute pas le paiement (sinon money-transmitter vers tiers non onboardé) ; réconciliation manuelle. Mention « suivi indicatif, hors flux Stripe ». | ☐ Basic ☐ Pro ☐ Premium ☐ Écarter |
| 13 | Portail déposant (accès lecture sans compte vendeur) | Lien/écran sécurisé où un déposant consulte SES articles (en vente / vendu / à rendre / invendu), son solde et l'historique de ses reversements — sans être vendeur Second ni voir le reste du stock. Accès via lien magique ou code, lecture seule. | Commerce physique | Premium | Élevée | Registre déposants + ledger ; vues read-only filtrées par `consignerId` (mêmes patterns que `getShopArticles` filtré) ; auth allégée type lien magique. | Loi 25 : exposer ventes/solde à un tiers non-user → cadrer base légale (mandat boutique), durée/révocation du lien, aucune donnée d'autres déposants ni d'acheteurs. Fuite si lien partagé → expiration + révocation. | ☐ Basic ☐ Pro ☐ Premium ☐ Écarter |
| 14 | Statut « à rendre / invendu » & fin de contrat déposant | Article déposé avec date de fin de contrat ; passé le délai sans vente → bascule « à rendre » (déstocké en ligne auto), liste de retrait par déposant, option « don/ressourcerie » ou « prolongation ». Notifie la boutique des lots à restituer. | Commerce physique | Pro + Premium | Moyenne | Job scheduled (pattern `transactionExpiration.ts`/`offerExpiration.ts`), `isActive`/`isSold` pour le délistage, `NotificationType` (nouveau type). | Faible côté financier ; le délistage auto ne doit pas casser une transaction en cours → guard « pas de commande pending avant bascule ». | ☐ Basic ☐ Pro ☐ Premium ☐ Écarter |

### Catégorie E — Équipe & multi-boutiques

| # | Feature | Description | Pour qui | Tier suggéré | Complexité | Réutilise l'existant | Risque / contrainte | ☐ DÉCISION |
|---|---|---|---|---|---|---|---|---|
| 15 | Comptes équipe & rôles boutique (personnel) | La boutique invite plusieurs employés (gérant, inventaire, expéditions, SAV) sous le compte boutique, chacun avec son login et un niveau de permission. Plus de mot de passe partagé. Pro = 3 membres, premium = illimité. | Commerce physique | Pro + Premium | Élevée | `Shop.ownerId` → sous-collection `shops/{id}/members {uid, role}`, `firestore.rules` en layers, `authStore`/`useAuth`, `createArticle` résout déjà `shopId` via `ownerId` (à muter), `accountType 'user'|'shop'` déjà dans User. | Modèle Shop aujourd'hui 1:1 avec un UID → impacts profonds sur rules (qui écrit au nom de la boutique), ledger (un seul Stripe Custom par boutique), KYC reste au propriétaire ; privilege escalation si rôles non verrouillés CF. | ☐ Basic ☐ Pro ☐ Premium ☐ Écarter |
| 16 | Journal d'activité boutique (qui a fait quoi) | Registre horodaté des actions sensibles des membres : création/édition/suppression d'article, mise en vendu, baisse de prix, étiquette, reversement déposant. Le propriétaire voit qui a fait quoi et quand, filtrable par employé. | Commerce physique | Premium | Moyenne | Callables mutantes en place → écrire un événement dans `shops/{id}/activity` à chaque mutation ; logger structuré. **Dépend des comptes équipe.** | Volume d'écriture par action (coût Firestore) à borner avec rétention ; sans attribution par membre le journal est vide de sens ; over-engineering si périmètre non restreint aux actions sensibles. | ☐ Basic ☐ Pro ☐ Premium ☐ Écarter |
| 17 | Multi-boutiques & vue corporative (chaîne) | Une entité (chaîne de friperies) gère plusieurs succursales sous un compte parent : dashboard corporatif consolidé (CA par succursale, inventaire partagé, stats croisées), facturation entreprise unique. | Commerce physique | Premium | Élevée | `Shop` comme « succursale » (+ `parentOrgId`/`organizations/{id}`), comptes équipe & rôles réutilisés, `purchaseShopTier`/`tierPaidUntil` (facturation à agréger), `admin/shops` (vue multi), analytics shop-level à consolider. | Repose sur comptes équipe + analytics shop-level (à ne pas lancer avant) ; `Shop.ownerId` 1:1 et Stripe Custom (un compte de paiement par boutique) compliquent trésorerie/KYC corporatifs ; segment très étroit au Québec → valider commercialement avant de coder. | ☐ Basic ☐ Pro ☐ Premium ☐ Écarter |

### Catégorie F — Vitrine / Branding

| # | Feature | Description | Pour qui | Tier suggéré | Complexité | Réutilise l'existant | Risque / contrainte | ☐ DÉCISION |
|---|---|---|---|---|---|---|---|---|
| 18 | Vitrine de marque personnalisable (couverture, accent, articles épinglés, handle) | Bannière grand format, logo agrandi, bio enrichie, 3-6 articles épinglés, couleur d'accent (palette DS validée), handle/URL perso (`/b/friperie-mile-end`). Premium = carrousel multi-bannières, thème de marque, sélection « Coup de cœur », réservation couleur + handle. | Particulier | Pro + Premium | Moyenne | `app/shop/[id].tsx`, `shopService.updateShop`, upload Storage RN, `shop.images[]`/`logo`, `getShopArticles` ; nouveau `pinnedArticleIds` + `bannerImages`/`coverImage`/`accentColor`/`handle` + index unicité handle. | Couleur libre casse le DS Editorial Luxe → palette validée uniquement ; handle = squatting → réservation CF + blocage marques tierces ; modération bannières → `submitReport` + statut suspended. | ☐ Basic ☐ Pro ☐ Premium ☐ Écarter |
| 19 | Collections curatées & épinglage d'articles en tête de vitrine | Articles regroupés en collections nommées (rails sur la vitrine) + épinglage de N vedettes. Pro = collections + épinglage avec quota ; premium = quota levé + réordonnancement manuel complet. | Particulier | Pro + Premium | Moyenne | `getShopArticles`, cards mémoïsés + rails Home, `search?shopId` ; nouveau sous-collection `shops/{id}/collections` + `pinnedArticleIds` + ordre. | Borner quota articles/collections (perf) ; un épinglé vendu doit se déclasser auto (respect `isSold`/`isActive`). | ☐ Basic ☐ Pro ☐ Premium ☐ Écarter |
| 20 | Vidéos produit & présentation vidéo de la boutique | Vidéo de présentation en tête de vitrine + vidéos sur fiches (état réel, tissu en mouvement). Pro = vidéo boutique ; premium = vidéos par article (quota élevé). Fort pour luxe/vintage. | Particulier | Pro + Premium | Élevée | Upload Storage RN (`fetch().blob()`+`uploadBytes`), `expo-image` (poster), `storage.rules` ; nouveau pipeline vidéo (compression, durée max, poster) + lecteur. | Coût stockage/bande passante + perf RN 0.83 (OOM upload lourd) → plafonner durée/poids ; modération vidéo plus lourde. | ☐ Basic ☐ Pro ☐ Premium ☐ Écarter |
| 21 | Vitrine « À propos » enrichie & histoire de marque | Section structurée : histoire, valeurs (mode durable, fait au Québec), engagements, chiffres de confiance (membre depuis, articles vendus, délai d'expédition). Premium = badges d'engagement (ex. « Expédié 48h ») sur chaque fiche. | Particulier | Pro + Premium | Faible | Champ `description`, section vitrine, `userStatsService` (vendus / membre depuis), copy FR DS ; nouveau champ `about` + badges. | Les badges d'engagement sont des promesses → réserver les badges forts à des engagements mesurables/vérifiés (sinon publicité trompeuse). | ☐ Basic ☐ Pro ☐ Premium ☐ Écarter |

### Catégorie G — Mise en avant / Boost & placement

| # | Feature | Description | Pour qui | Tier suggéré | Complexité | Réutilise l'existant | Risque / contrainte | ☐ DÉCISION |
|---|---|---|---|---|---|---|---|---|
| 22 | Boost d'article (remontée search + home) avec crédits inclus et remise à l'acte | Articles remontés en tête des résultats pertinents et des rails home, libellé discret « Boutique ». Quota mensuel inclus dans le forfait (pro 5/mois, premium 30/illimité) + remise sur les boosts au-delà du quota. Rend l'abonnement « auto-amorti ». | Particulier | Pro + Premium | Élevée | `isPromoted` + `popularityScore` (search_index), `popularity.ts` + `calculatePopularityScore`, triggers `products.ts`/`search.ts`, `home.ts` featuredSellers, `Shop.tier`/`tierPaidUntil` (allocation), `platform_ledger` + charge plateforme directe ; nouveau `boostedUntil` + bonus de score honoré si tier actif (modèle `resolveBuyerFeeReduction`). | Nécessite un vrai système boost/ranking (n'existe pas) — gros chantier search + équité feed ; pollution des résultats si quota large → plafonner la part d'items boostés par page/rail, exiger `tierPaidUntil > now` serveur, ne pas noyer les gratuits, logguer le ROI. | ☐ Basic ☐ Pro ☐ Premium ☐ Écarter |
| 23 | Boutiques à la une (rail home dédié + priorité recherche locale) | Rail « Boutiques à proximité » priorisé par géolocalisation. Pro = rotation curatée ; premium = emplacements garantis/épinglés + priorité search locale. | Particulier | Pro + Premium | Moyenne | Sections home server-curated (`home.ts`, `getFeaturedSellers`), `getShopsNearLocation`/geohash ; nouveau `getFeaturedShops` (tier actif + proximité). | Équité de rotation entre pros (éviter winner-takes-all) ; plafonner les emplacements premium pour ne pas saturer la home. | ☐ Basic ☐ Pro ☐ Premium ☐ Écarter |
| 24 | Mise en avant saisonnière & collections thématiques (incl. SwapZone) | La boutique soumet une « collection » éligible aux campagnes saisonnières éditorialisées (Rentrée, Friperie d'hiver, Sneakers), y compris une vitrine en SwapZone. Premium = inclusion garantie ≥1 campagne/saison + slot SwapZone ; pro = éligible sur sélection. | Particulier | Premium | Moyenne | Rails home curatés (`home.ts`), SwapZone (`app/swap-zone.tsx`), tags de campagne, curation admin (`app/admin/shops.tsx`). | Charge de curation manuelle admin → slots saisonniers limités + file de soumission modérée. | ☐ Basic ☐ Pro ☐ Premium ☐ Écarter |
| 25 | Planification de publication & boost programmé | Programmer la mise en ligne (brouillon → actif à une date) et planifier des fenêtres de mise en avant aux heures de forte audience. Premium = republication auto récurrente des invendus. | Particulier | Pro + Premium | Moyenne | `scheduled/*` (`onSchedule`), `draftService` + `cleanupDrafts`, `calculatePopularityScore` (fraîcheur), `popularity.ts`. | Abus de fraîcheur / spam du fil si republication trop fréquente → limiter cadence par article et par forfait. | ☐ Basic ☐ Pro ☐ Premium ☐ Écarter |
| 26 | Événements boutique : arrivages & vide-dressings | Les commerces publient des événements datés (gros arrivage, braderie, vide-dressing, soldes -50 %) visibles sur leur fiche et dans un rail « Événements près de chez vous » ; les abonnés reçoivent une notif. | Commerce physique | Premium | Moyenne | Follow boutique/vendeur (`useSellerLikes`), push (`sendPushNotification`, types extensibles), géoloc du rail « à proximité », `shop.location`/horaires. Nouveau : sous-collection `shops/{id}/events`. | Spam notifications si non plafonné (fatigue → désinscriptions) ; modération (événements trompeurs) ; faible valeur sans base d'abonnés suffisante au lancement. | ☐ Basic ☐ Pro ☐ Premium ☐ Écarter |

### Catégorie H — Confiance / Badge & réputation

| # | Feature | Description | Pour qui | Tier suggéré | Complexité | Réutilise l'existant | Risque / contrainte | ☐ DÉCISION |
|---|---|---|---|---|---|---|---|---|
| 27 | Badge « Commerce / Boutique vérifié(e) » (KYC + NEQ/TPS/TVQ) + bonus de classement | Badge de confiance fort sur fiche, cartes et résultats, conditionné à une VRAIE vérification (KYC Stripe Connect Custom + NEQ validé), distinct du badge status-only actuel à durcir. Bloc « Profil entreprise » + léger bonus de classement. Premium = niveau supérieur (« Or »/« Maison »). | Les deux | Pro + Premium | Moyenne | `shop.verificationDetails` (CF-only), `ShopLegalInfo.businessNumber` (NEQ), statut KYC `getStripeAccountStatus`, callable `approveShop` déployée, `app/admin/shops.tsx`, `Shop.tier`/`tierPaidUntil`, search_index + `calculatePopularityScore`, `ProductCard` (micro-badge). | « Vérifié » doit refléter une vraie vérif (KYC + NEQ) sinon engagement trompeur ; badge actuel trompeur à renommer ; vérif NEQ manuelle/admin (charge ops, pas d'API auto) ; Loi 25 (stockage identité/numéros) ; distinguer « identité perso » vs « entreprise » ; bonus de classement modéré. | ☐ Basic ☐ Pro ☐ Premium ☐ Écarter |
| 28 | Mise en avant « Livraison offerte » dans le feed | Signal d'achat priorisé en search/home : bandeau « Livraison offerte » (si actif) couplé au badge confiance, sans nouvel achat à l'acte. | Particulier | Pro + Premium | Faible | `shop.tier` (doc), search_index (flag `shopTier`/`freeShipping` via trigger `products.ts`), cards + `shop/[id].tsx`, `verificationDetails`. | Le bandeau engage la responsabilité plateforme → cohérent avec la vraie prise en charge du port (cf. feature livraison offerte) ; n'accorder qu'après vérif réelle. | ☐ Basic ☐ Pro ☐ Premium ☐ Écarter |
| 29 | Réponse publique aux avis (droit de réponse vendeur) | Le vendeur répond publiquement sous chaque avis. Pro = réponse texte ; premium = modèles réutilisables + contestation d'avis abusif via file de modération. | Particulier | Pro + Premium | Moyenne | `reviewService` + `createReview`/`updateUserRating`, `submitReport`/`triageReport`, notifications ; nouveau `reply{text,createdAt}` sur Review (callable owner-only). | Modération obligatoire (harcèlement/diffamation, sensible Loi 25) ; la contestation ne doit pas supprimer un avis légitime. | ☐ Basic ☐ Pro ☐ Premium ☐ Écarter |
| 30 | Avis mis en avant & note détaillée sur la vitrine | Bloc réputation riche : avis vedettes épinglés, répartition des notes (5→1★), nombre de transactions, avis avec photos. Pro = bloc détaillé + 1 avis épinglé ; premium = plusieurs avis + carrousel média. | Particulier | Pro + Premium | Faible | `reviewService.getUserReviews`, `rating`/`reviewCount` dénormalisés, cards/rails ; nouveau `featuredReviewIds` + agrégat répartition. | Épinglage = cherry-picking trompeur → garder la répartition complète visible ; photos = stockage/modération. | ☐ Basic ☐ Pro ☐ Premium ☐ Écarter |

### Catégorie I — Audience & fidélisation

| # | Feature | Description | Pour qui | Tier suggéré | Complexité | Réutilise l'existant | Risque / contrainte | ☐ DÉCISION |
|---|---|---|---|---|---|---|---|---|
| 31 | Abonnés de boutique + alertes nouveautés et ventes flash | Les acheteurs s'abonnent (compteur sur la vitrine) ; le vendeur pousse des notifs (arrivage, baisse, vente flash). Pro = notif auto de nouvel article ; premium = push manuel « annonce à mes abonnés » + segmentation par catégorie, fréquence plafonnée. | Particulier | Pro + Premium | Élevée | `favoritesService` (pattern subcollection + count), `sendPushNotification` (respect `preferences.notifications.*`), `notifications.ts`, trigger article create (fan-out), `savedSearches` (modèle job) ; nouveau `shop_followers` + callable d'envoi rate-limitée. | Spam / fatigue notif → réputation ; plafonner fréquence serveur (1-2/sem), opt-out par boutique, kill-switch admin, anti-stomp ; fan-out gros = batcher CF. | ☐ Basic ☐ Pro ☐ Premium ☐ Écarter |
| 32 | Codes promo & ventes flash de boutique (réduction financée vendeur) | Réductions financées par le vendeur : code promo (% ou montant), vente flash limitée. Prix barré + badge « Promo »/« Vente flash » sur vitrine/cards/search. Premium = planification auto + ventes flash récurrentes. | Particulier | Pro + Premium | Élevée | Logique prix/fees checkout (`calculateFees`, `payments.ts`) étendue pour une réduction VENDEUR distincte de la réduction frais acheteur ; `lastPriceDropAt` + rail price-drops home. | La réduction est financée par le VENDEUR (0 % commission intact) → séparer du calcul frais acheteur pour ne pas rogner le revenu plateforme ; bloquer < min Stripe (50¢). | ☐ Basic ☐ Pro ☐ Premium ☐ Écarter |
| 33 | Programme de fidélité acheteur financé par la boutique | Points/cashback pour les acheteurs récurrents (ex. au 5e achat = crédit sur les frais de service du prochain achat dans cette boutique). Financé par la boutique, pas la plateforme. | Particulier | Premium | Élevée | `resolveBuyerFeeReduction` (crédit sur `serviceFee`), `transactionService` (compte achats), notifications, `platform_ledger` (financement). | Compta/conformité (crédit = avantage à tracer TPS/TVQ, jamais monnaie échangeable) ; abus multi-comptes → lier à l'identité vérifiée + plafonner. | ☐ Basic ☐ Pro ☐ Premium ☐ Écarter |

### Catégorie J — Analytics & compta

| # | Feature | Description | Pour qui | Tier suggéré | Complexité | Réutilise l'existant | Risque / contrainte | ☐ DÉCISION |
|---|---|---|---|---|---|---|---|---|
| 34 | Tableau de bord boutique (ventes, vues, conversion, rotation, dormants) | Dashboard agrégé niveau Shop : CA par période (7/30/90j), panier moyen, vues/favoris par article, conversion vue→favori→vente, top catégories, rotation/turnover, articles dormants à rebaisser, alertes (quota proche, stock dormant). Premium = export CSV + comparaison période/période. | Les deux | Pro + Premium | Élevée | `userStatsService` (→ `shopStatsService` agrégé), `scheduled/stats.ts` (pré-agrégation), `Article.views/likes`, transactions par `sellerId`/`shopId`, search_index + `calculatePopularityScore`, `articlesCount`/tier (alertes). | Agrégation niveau shop = jobs scheduled coûteux à volume → doc d'agrégat par boutique pré-calculé, pas de lecture lourde client ; ne pas exposer les données d'autres vendeurs. | ☐ Basic ☐ Pro ☐ Premium ☐ Écarter |
| 35 | Partage social enrichi (visuels IG/TikTok/FB + attribution) | Visuels de partage prêts IG/TikTok/FB (article ou vitrine + lien profond) + stats de campagne (vues, abonnés gagnés, clics sur boosts, ventes). Pro = stats essentielles + partage ; premium = attribution par code promo + historique long. | Particulier | Pro + Premium | Moyenne | `useDeepLinking`, agrégation stats (`scheduled/stats.ts`, `userStatsService`) étendue au scope boutique, images compressées. | Coût de calcul des agrégats → précalcul scheduled ; liens profonds doivent gérer boutique suspendue/supprimée. | ☐ Basic ☐ Pro ☐ Premium ☐ Écarter |
| 36 | Analytics d'audience et de demande | Analyse haut de gamme : provenance des vues, termes de recherche menant aux annonces, favoris non achetés (intention non convertie), démographie agrégée/anonymisée (région QC/CA, tranche d'âge). | Particulier | Premium | Élevée | `utils/search.ts` (search_index), `scheduled/savedSearches.ts` (signaux demande), `triggers/favorites.ts`, embeddings. | Conformité Loi 25 : agrégats anonymisés uniquement (k-anonymat), jamais d'identité acheteur ; valider avec l'audit Loi 25. | ☐ Basic ☐ Pro ☐ Premium ☐ Écarter |
| 37 | Export comptable & relevé fiscal Canada/Québec (NEQ/TPS/TVQ) | Export CSV/PDF des ventes, frais et revenus avec ventilation TPS/TVQ (exploite `legalInfo`/NEQ), lié au statut entreprise vérifié. Premium = récap annuel prêt déclaration + suivi des seuils d'inscription aux taxes. | Les deux | Premium | Moyenne | `fees.ts` (`getTaxConfig`, `GST_RATE`/`QST_RATE`, `computeTaxOnServiceFee`, `TaxBreakdown`), Transaction stocke `serviceFee`/`shipping`/`tax`, `Shop.legalInfo`, `platform_ledger`/transactions, `seller_balances`, `sellerBalanceService`, `recordTransactionRevenue`. | Décision fiscale fondateur non tranchée (`TAX_ENABLED=false`) ; la taxe ne porte aujourd'hui que sur le service fee plateforme, PAS sur le prix article → un export « prêt déclaration » pourrait induire en erreur. Présenter comme aide à la déclaration (pas conseil fiscal) ; statut entreprise vérifié requis ; ne jamais inventer de numéros. | ☐ Basic ☐ Pro ☐ Premium ☐ Écarter |
| 38 | Gestion automatisée des offres (auto-accept / décline / contre-offre) | Règles configurées une fois : seuil d'auto-acceptation (≥90 % du prix), seuil d'auto-refus, contre-offre auto entre les deux. S'exécute serveur sur les offres entrantes. | Particulier | Pro + Premium | Moyenne | `callable/automatedDecisions.ts`, `OfferStatus`, `scheduled/offerExpiration.ts`, `OfferHistoryEntry` (traçabilité). | Vente non désirée si seuils mal réglés → confirmation des seuils, trace OfferHistory, borner par article ; ne pas auto-accepter les contre-propositions de lieu/horaire (meetup). | ☐ Basic ☐ Pro ☐ Premium ☐ Écarter |
| 39 | Réponses rapides & modèles de description IA | Réponses pré-enregistrées dans le chat (dispo, état, retour, meetup) insérables en un tap + modèles de description générés/affinés par l'IA existante (ton, mots-clés mode, matière/état). Gabarits réutilisables. | Particulier | Pro + Premium | Faible | `callable/ai.ts` + `aiService` (image→description), `chatService`, `triggers/messages.ts`, `draftService`. | Coût d'inférence IA descriptions → plafonner par fenêtre (modèle `analyzeProduct` existe) ; modèles texte quasi gratuits. | ☐ Basic ☐ Pro ☐ Premium ☐ Écarter |

> Note : les features 38 et 39 ont été classées « Analytics & compta » dans la liste maître bien que fonctionnellement plus proches de l'outillage vendeur — on peut les reclasser en session si on préfère.

### Catégorie K — Fulfillment & logistique avancée

| # | Feature | Description | Pour qui | Tier suggéré | Complexité | Réutilise l'existant | Risque / contrainte | ☐ DÉCISION |
|---|---|---|---|---|---|---|---|---|
| 40 | Étiquettes & bordereaux d'expédition par lot | Sélection de N commandes payées « à expédier » → un PDF multi-étiquettes ShipEngine + bordereaux d'emballage, avec relais PUDO favoris pré-configurés. Workflow d'impression groupé pour la journée. | Les deux | Pro + Premium | Moyenne | `labelFulfillment.ts` + `createLabel` ShipEngine (batch), `config/shipEngine.ts`, `sweepPendingLabels.ts` (retry), `findPickupPoints`, statut `label_created`/`shipped`, réconciliation coût réel. | Appels ShipEngine multiples = quotas/coûts + échecs partiels (file de retry, ne pas tout bloquer) ; PDF multi-pages côté CF (mémoire ≥512MiB) ; label non idempotent → clé d'idempotence par transaction sinon double-achat. | ☐ Basic ☐ Pro ☐ Premium ☐ Écarter |
| 41 | Multi-points relais favoris pré-configurés par boutique | Pré-enregistrer plusieurs PUDO ShipEngine favoris au niveau boutique + choisir en un tap le relais de dépôt par commande. Premium = plages d'enlèvement + envoi par lot depuis un relais unique. Couplé au batch. | Les deux | Pro + Premium | Moyenne | `findPickupPoints` (callable PUDO), `ShipEngineAddress`/`deliveryType pickup_point`, geohash boutique. | API PUDO payante par appel → cacher les relais favoris côté doc boutique ; revalider la dispo avant achat label. | ☐ Basic ☐ Pro ☐ Premium ☐ Écarter |
| 42 | Livraison offerte par la boutique (port pris en charge) + crédits d'envoi inclus | La boutique absorbe tout/partie des frais ShipEngine de SES acheteurs (pro = 50 % sur le port, premium = 100 % offert) et/ou reçoit un crédit d'expédition mensuel (pro ~10 $, premium ~30 $) déduit auto du coût d'étiquette. Badge « Livraison offerte ». Rend l'abonnement « auto-amorti » pour le vendeur volume. | Particulier | Pro + Premium | Moyenne | ShipEngine (label checkout `payments.ts`), `labelFulfillment.ts` (réconciliation coût label, ledger), `resolveBuyerFeeReduction` (résolution via `shopId`), pattern `serviceFeeConfig` pour `shippingSubsidyPercent` server-owned, wallet/ledger vendeur (CENTS), webhook shop_tier (crédit mensuel), badge UI. | Coût plateforme réel → borner/plafonner par mois + cap par commande côté config serveur (sinon marge négative sur petit prix + gros colis) ; reset mensuel idempotent, pas de report du solde, tracer dans le ledger. | ☐ Basic ☐ Pro ☐ Premium ☐ Écarter |
| 43 | Retours simplifiés & protection vendeur renforcée | Étiquette retour en un tap + suivi du colis retour + fenêtre de litige raccourcie. Premium = protection renforcée (avance plateforme sur litige acheteur abusif documenté, plafonnée). | Particulier | Pro + Premium | Élevée | `recourse.ts:requestReturn` + `returnRefund.ts`, `trackingCheck.ts`, `resolveDispute`, `sellerDebt`/wallet ledger, `sendPushNotification`. | Conformité Loi 25 / équité acheteur ; l'avance plateforme = plafonds stricts + revue admin pour éviter l'abus vendeur. | ☐ Basic ☐ Pro ☐ Premium ☐ Écarter |

### Catégorie L — Quotas & limites

| # | Feature | Description | Pour qui | Tier suggéré | Complexité | Réutilise l'existant | Risque / contrainte | ☐ DÉCISION |
|---|---|---|---|---|---|---|---|---|
| 44 | Quotas d'annonces actives par forfait (réellement appliqués) | Plafonds d'articles actifs ENFORCÉS à la création/import : basic ~30, pro ~300-1000, premium illimité/très élevé. Garde côté Cloud Function au `createArticle` + compteur visible « X/Y » + invitation à monter au plafond. | Les deux | Pro + Premium | Faible | `Shop.tier` + `tierPaidUntil` + `articlesCount` déjà présents (denorm, jamais appliqués en garde), `createArticle` peut lire le tier et refuser au-delà, trigger `products.ts`, `resolveBuyerFeeReduction` (même pattern d'expiration), `firestore.rules`. | À l'expiration : ne JAMAIS supprimer les excédentaires (perte de données) → geler/désactiver, réactiver au renouvellement (grandfathering) ; `articlesCount` doit être fiable (transaction) sinon faux blocages ; application serveur, jamais client ; calibrage business fondateur requis. | ☐ Basic ☐ Pro ☐ Premium ☐ Écarter |

### Catégorie M — Monétaire vendeur / trésorerie

| # | Feature | Description | Pour qui | Tier suggéré | Complexité | Réutilise l'existant | Risque / contrainte | ☐ DÉCISION |
|---|---|---|---|---|---|---|---|---|
| 45 | Paliers de réduction de frais acheteur basés sur le volume | La réduction frais acheteur augmente par paliers selon le volume de ventes mensuel (pro 40 % puis 50 % au-delà de 30 ventes/mois ; premium 100 % maintenu). Récompense les boutiques actives. | Particulier | Pro + Premium | Moyenne | `feeReductionForShopTier` + `resolveBuyerFeeReduction` (constante → fonction de palier), agrégation volume via `stats.ts` + `articlesCount`/`reviewCount`, lecture server-only (`tierPaidUntil`). | Complexité de compréhension → afficher palier courant + prochain seuil ; gaming via ventes fictives → s'appuyer sur transactions livrées non litigieuses. | ☐ Basic ☐ Pro ☐ Premium ☐ Écarter |
| 46 | Retrait accéléré (fenêtre de litige raccourcie par tier) | Fenêtre de litige 7j raccourcie pour les abonnés : pro = 3j, premium = 24h (ou release immédiat après confirmation acheteur). Les fonds passent en balance retirable plus vite. | Particulier | Pro + Premium | Moyenne | `DISPUTE_WINDOW_MS` + `applyDeliveredHeldFunds` + `releaseHeldFunds` (fenêtre paramétrable par tier : `fundsReleaseAt = deliveredAt + windowForTier`), modèle 3 buckets inchangé. | Risque fraude/litige accru → borner premium ≥24-48h, exclure boutiques récentes/non vérifiées (`legalInfo` + `verificationDetails`), garder blocage si disputed. | ☐ Basic ☐ Pro ☐ Premium ☐ Écarter |
| 47 | Seuil de retrait abaissé + retraits plus fréquents | Seuil de retrait min plus bas + cadence plus élevée (basic 25 $/1 gratuit par mois ; pro 10 $/hebdo ; premium 1 $/à la demande). Réduit l'argent dormant dans le wallet. | Particulier | Pro + Premium | Faible | `wallet.ts` (`requestWithdrawal` / guards) — seuil min et fréquence déjà des garde-fous, paramétrés par tier comme `feeReduction` ; balance bucket inchangé. | Coût des transferts Stripe par retrait si premium illimité à 1 $ → absorber dans la marge ou garder une cadence raisonnable (quotidien max). | ☐ Basic ☐ Pro ☐ Premium ☐ Écarter |

### Catégorie N — Exclusivités premium B2B

| # | Feature | Description | Pour qui | Tier suggéré | Complexité | Réutilise l'existant | Risque / contrainte | ☐ DÉCISION |
|---|---|---|---|---|---|---|---|---|
| 48 | SwapZone Pro & mise en relation B2B | Espace SwapZone réservé aux boutiques : échange/déstockage de lots entre commerçants, mise en relation B2B (achat de lots, sourcing), accès anticipé aux nouvelles features. | Commerce physique | Premium | Élevée | `swapService.ts` + zone d'échange généraliste permanente (`app/swap-zone.tsx`), `Shop.tier` (gating), notifications (mise en relation), geohash boutique (matching local). | B2B = volume critique nécessaire (sinon espace vide) ; cadrer facturation/taxes/conformité QC avant ouverture ; risque de contournement des frais acheteur si mal délimité. | ☐ Basic ☐ Pro ☐ Premium ☐ Écarter |

---

## 6. Matrice de tiers proposée (PROPOSITION — à arbitrer)

> Ceci n'est **qu'une proposition de départ** dérivée des tiers suggérés du menu. La frontière exacte est l'objet de la session. Les **exclusivités premium** sont en **gras**.

| Axe | Basic (gratuit) | Pro (29,99 $) | Premium (79,99 $) |
|---|---|---|---|
| **Réduction frais acheteur** | 0 % | 50 % (paliers selon volume) | 100 % offert |
| **Quota d'annonces actives** | ~30 | ~300-1000 | Illimité / très élevé |
| **Vitrine / branding** | Standard | Personnalisable (couverture, accent, handle, épinglés) | + carrousel multi-bannières, thème, **vidéos par article** |
| **Découverte locale** | — | Rail local (rotation curatée), itinéraire + ouvert/fermé | + **emplacements garantis** + priorité search locale + **« à la une dans votre ville »** |
| **Click & Collect** | — | Oui | Oui |
| **Synchro stock unique (anti-survente)** | — | Oui | Oui |
| **Stock en masse** | — | Lot photo+IA, CSV, SKU/étiquettes | + **soldes/démarque en masse programmées** |
| **Boost** | — | Quota inclus (ex. 5/mois) + remise au-delà | Quota élevé (30/illimité) + **saisonnier garanti + slot SwapZone** |
| **Confiance** | — | Badge vérifié (KYC+NEQ), avis détaillés, droit de réponse | + **niveau « Or »/« Maison »**, modèles de réponse |
| **Audience** | — | Abonnés + notif auto nouvel article | + **push manuel « annonce à mes abonnés »**, segmentation, **programme de fidélité** |
| **Analytics** | — | Dashboard boutique | + export CSV, comparaison période, **analytics d'audience/demande** |
| **Fulfillment** | Standard | Étiquettes par lot, relais favoris, livraison 50 % | + livraison 100 % offerte, crédits d'envoi, **protection vendeur renforcée** |
| **Trésorerie** | Retrait standard | Retrait accéléré (3j), seuil abaissé/hebdo | **Retrait 24h, à la demande** |
| **CONSIGNATION** | — | Registre déposants, ledger, statut « à rendre » | + **portail déposant** (lecture sans compte) |
| **Équipe** | — | **3 membres** + comptes équipe | **Membres illimités** + **journal d'activité** |
| **B2B / corporatif** | — | — | **SwapZone Pro B2B** + **multi-boutiques/vue corporative** |
| **Compta fiscale** | — | — | **Export TPS/TVQ + relevé fiscal annuel** |

**Exclusivités premium nettes (le « pourquoi payer plus ») :** portail déposant, multi-boutiques/corporatif, journal d'activité, export comptable TPS/TVQ, événements boutique, analytics d'audience, programme de fidélité, niveau de badge supérieur, livraison 100 % offerte, protection vendeur renforcée, démarque de masse.

---

## 7. Quick wins — à livrer en premier

Features à **complexité faible** reposant sur l'infrastructure existante. Elles produisent de la valeur perçue rapidement et valident l'appétit avant d'engager les gros chantiers.

| # | Feature | Catégorie | Pourquoi c'est un quick win |
|---|---|---|---|
| 2 | Bouton Itinéraire + statut Ouvert/Fermé live | Découverte locale | `MapView`, `Linking`, `renderOpeningHours` déjà là ; aucune nouvelle donnée. |
| 4 | Galerie magasin enrichie & vitrine « à la une » | Découverte locale | Surtout DS/UI sur `shop.images[]` existant. |
| 21 | Vitrine « À propos » enrichie | Vitrine / Branding | Champ `description` + `userStatsService` ; nouveau champ `about`. |
| 28 | Mise en avant « Livraison offerte » dans le feed | Confiance | Flag dans search_index via trigger existant. |
| 30 | Avis mis en avant & note détaillée | Confiance | `reviewService` + agrégats dénormalisés déjà présents. |
| 39 | Réponses rapides & modèles de description IA | Outillage vendeur | `aiService` + `chatService` en place ; modèles texte quasi gratuits. |
| 44 | Quotas d'annonces actives appliqués | Quotas | `tier`/`articlesCount` déjà dénormalisés, jamais appliqués — une garde CF. |
| 47 | Seuil de retrait abaissé + retraits fréquents | Trésorerie | `wallet.ts` paramètre déjà seuil/fréquence ; on les rend fonction du tier. |

> Note : la garde de quotas (#44) et le seuil de retrait (#47) sont des « activations » de paramètres déjà présents dans le code mais non appliqués — leur valeur ressentie est haute pour un effort très faible.

---

## 8. Section spéciale — CONSIGNATION (le différenciateur premium)

La consignation (dépôt-vente) est **l'argument premium structurant** de Second. Les marketplaces grand public (Vinted, Poshmark, Depop) ne l'adressent **pas du tout** ; les logiciels dédiés (SimpleConsign, ConsignCloud) la couvrent mais **sans marketplace**. Croiser les deux est notre fossé défendable, et c'est le quotidien d'une large part des friperies et dépôts-vente québécois.

**Cadrage financier acté (à confirmer ensemble, mais c'est la ligne de conduite) :**

- **La boutique encaisse**, point. Le paiement de l'acheteur va à la boutique via son compte Stripe Connect Custom — comme aujourd'hui.
- **Le déposant n'est PAS un utilisateur Second** et n'a pas de wallet Stripe. Sa part est suivie dans un **ledger interne** (dû boutique vs dû déposant), purement indicatif.
- **Second n'exécute jamais le paiement au déposant.** La boutique paie son déposant hors app (chèque, virement, crédit magasin) et coche « reversé » dans le ledger. Si Second versait directement à un tiers non onboardé/non KYC, on deviendrait un transmetteur de fonds vers un tiers non identifié — risque conformité/AML inacceptable.
- Conséquence Loi 25 sur le **portail déposant** (#13) : exposition de données financières à un tiers non-user → base légale = mandat de la boutique, lien à durée limitée et révocable, jamais de données d'autres déposants ni d'acheteurs.

Mention produit recommandée partout : **« suivi indicatif, hors flux Stripe »**.

---

## 9. Questions ouvertes pour la décision à deux

À trancher en session — ce sont les arbitrages structurants :

1. **Prix des paliers.** 29,99 $ / 79,99 $ sont des placeholders. Sont-ils crédibles pour une friperie québécoise ? Faut-il un palier annuel remisé ? Le ROI « auto-amorti » (boost + livraison offerte + crédits) tient-il à ces prix ?
2. **Ratio commerces physiques vs particuliers.** On a posé « commerces d'abord ». Confirme-t-on, ou veut-on un MVP qui sert aussi le power-seller particulier dès le départ ? Cela rééquilibre tout le menu (catégories F/G/I vs A/B/D/E).
3. **POS externe ou synchro semi-manuelle ?** On a décidé « pas de POS complet ». Accepte-t-on d'assumer que l'anti-survente (#6) repose sur la discipline du commerçant (scan/marquage manuel), ou faut-il viser à terme une intégration Square/Lightspeed (hors scope actuel) ?
4. **Modèle de frais du Click & Collect (#5).** Sans expédition ni étiquette, **sur quoi porte le frais de service** ? Frais fixe acheteur ? Pourcentage maintenu ? Gratuit pour pousser l'omnicanal ? C'est un trou à boucher avant de livrer.
5. **Vérification NEQ : manuelle ou API ?** Le badge « vérifié » (#27) exige NEQ + KYC réels. La vérif NEQ n'a pas d'API automatique facile → charge ops admin. Quel volume peut-on absorber manuellement au lancement ?
6. **Plafonds de quotas (#44).** Basic ~30, Pro ~300-1000, Premium illimité : calibrage business à figer. Quel comportement exact à l'expiration (gel/désactivation des excédents, grandfathering) ?
7. **Activation des taxes (TPS/TVQ).** Aujourd'hui `TAX_ENABLED=false` et la taxe ne porte que sur le service fee plateforme, pas sur le prix article. L'export comptable (#37) et le badge TPS/TVQ supposent une position fiscale tranchée et probablement l'immatriculation TPS/TVQ. **Décision fiscale fondateur requise avant de promettre quoi que ce soit de « prêt déclaration ».**

---

*Document de travail — 48 features inventoriées, aucune arrêtée. À parcourir et arbitrer ensemble. Les tiers, prix et plafonds indiqués sont des propositions de départ, pas des engagements.*
