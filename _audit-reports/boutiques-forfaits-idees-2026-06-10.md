# Boutiques — Menu d'idées de features pour les forfaits payants (pro / premium)

**Date :** 2026-06-10
**Pour :** Fondateur (tri à faire ensemble)
**Statut :** PROPOSITION — rien n'est arrêté. Ce document est un MENU à trier, pas une roadmap.

---

## 1. Rappel du modèle actuel

Trois niveaux de boutique :

- **Basic (gratuit)** — réduction de frais acheteur **0%**.
- **Pro (29,99 $/mois)** — réduction de frais acheteur **50%**.
- **Premium (79,99 $/mois)** — réduction de frais acheteur **100%**.

Principes structurants à NE PAS casser :

- **0% de commission vendeur** conservé sur tous les paliers. La monétisation des boutiques passe par l'abonnement et par la réduction des frais **acheteur**, jamais par une commission vendeur.
- Le bénéfice payant actuel = **réduction des frais acheteur** (levier de conversion côté vendeur, pas une feature technique).
- Premium doit **rester clairement supérieur** à pro sur toute nouvelle répartition.

> Décision fondateur déjà actée : les boutiques sont une offre payante à 3 forfaits, monétisée via la **réduction des frais ACHETEUR** (0% commission vendeur conservé).

---

## 2. Ce qui existe déjà (point de départ)

- **Achat / renouvellement de forfait** : `purchaseShopTier` (callable owner-only, rate-limit 5/min) crée un **PaymentIntent en charge plateforme directe** (pas de transfer). Écran `app/shop/upgrade.tsx` (1 à 12 mois, Payment Sheet Stripe).
- **Application du tier côté serveur uniquement** : le webhook `handleShopTierSucceeded` stampe `tier` + `tierPaidUntil` sur le doc boutique (verrouillé par `firestore.rules`, jamais le client). Entrée `platform_ledger` (`shop_tier_revenue`) idempotente sur l'ID du PaymentIntent.
- **Réduction de frais résolue serveur** : `feeReductionForShopTier` (pro 50% / premium 100%) + `resolveBuyerFeeReduction` (résout le tier depuis `article.shopId` ou la boutique approuvée du vendeur). **Honorée seulement si `tierPaidUntil > now`** ; un tier expiré retombe en basic (0%).
- **Modèle boutique** : `Shop` porte déjà `tier?`, `tierPaidUntil?`, `verificationDetails?`, `legalInfo? {businessNumber, gstNumber, qstNumber}`, `rating`, `reviewCount`, `articlesCount`, `location {lat/lon, geohash}`, `images[]`, `logo`, `openingHours`, etc.
- **Modération boutique** : création en `pending`, callables admin `approveShop` / `rejectShop` / `suspendShop` (atomiques, anti-stomp), panneau `app/admin/shops.tsx`, notifications post-modération via `sendPushNotification`.

**Conséquence pratique :** beaucoup d'idées ci-dessous se branchent sur des points déjà construits (résolution de tier serveur, ledger, KYC Stripe, geohash, search_index, scheduled stats). Le coût d'implémentation est souvent un **delta**, pas un chantier nouveau.

---

## 3. Synthèse benchmark concurrents

| Concurrent | Offre payante | Prix | Leviers payants clés |
|---|---|---|---|
| **eBay Stores** | Abonnement boutique 5 paliers (Starter→Enterprise) | 4,95 $ → ~2 995 $/an (USD) | Quota de listings croissant + frais d'insertion réduits ; **réduction des frais de vente (~0,9%)** ; vitrine personnalisable ; promoted listings + coupons ; analytics (Terapeak, Seller Hub) ; support dédié paliers hauts ; **badge boutique pro** |
| **Etsy** | Etsy Plus (abonnement unique) | 10 $/mois (USD) | Crédits de mise en ligne + crédits Ads mensuels ; vitrine avancée (carrousel) ; **alertes de réassort aux acheteurs** ; remises domaine/packaging ; **ne change PAS le SEO** |
| **Vinted** | Vinted Pro (statut pro) | Pas d'abo ni commission (gratuit, EU) | **Badge Pro** (confiance) ; listings illimités ; stats ; outils pro (facturation, modèles de messages) ; API gros volumes ; bumps additionnels ; cadre conforme commerçant |
| **Vestiaire Collective** | Professional Seller (luxe) | Pas d'abo ; **commission réduite** | Commission réduite (2 barèmes) ; **authentification incluse** ; bulk listing ; expédition facilitée (étiquettes, pickup) ; Seller Rewards (paliers) |
| **Poshmark** | Posh Ambassador (gratuit, mérité) | Pas d'abo ; commission 2,95 $ / 20% | Statut communautaire **gratuit** basé performance ; parrainage ; **monétise via commission, pas abonnement** |
| **Depop** | Boosted Listings (à la performance) | Pas d'abo ; boost = 12% du prix de vente | **Boost à la performance** (placement search + suggestions) ; Boost Shop (toute la boutique) ; **on ne paie le boost que si l'article se vend** |
| **Mercari** | Promote (à l'acte) | Pas d'abo ; commission 10% + 3,6% | Promote (exige baisse de prix ≥5%) ; offres aux likers ; ajustement de prix en masse |
| **Grailed** | Aucun levier payant | Pas d'abo ; ~12-13% de frais | **Bump gratuit** après 7 j ; aucune offre payante |

**Insights pour Second :**

1. **Deux écoles** : abonnement à paliers (eBay, Etsy) vs monétisation par commission/boost à l'acte (Poshmark, Depop, Mercari, Grailed). Second a choisi l'abonnement + 0% commission vendeur → l'enjeu est de rendre l'abonnement **auto-amorti** (crédits boost/envoi inclus) plutôt que de vendre le boost à l'acte.
2. **Le badge de confiance est le levier le moins cher et le plus rentable** (Vinted Pro, Vestiaire authentification). À condition qu'il soit honnête (vérification réelle).
3. **La réduction de frais** est déjà notre cœur de proposition (eBay ~0,9%, Vestiaire commission réduite) — on est aligné, on peut l'enrichir (paliers volume).
4. **Outils de scale** (analytics, bulk, gestion offres) = systématiquement réservés aux pros → outil de **rétention** des vendeurs volume.
5. **Attention SEO/feed** : Etsy assume que Plus ne change pas le classement. Si on fait du boost de classement, il faut **borner la part d'items boostés** pour ne pas dégrader la pertinence acheteur.

---

## 4. LE MENU D'IDÉES

> Tier suggéré : **les deux** = inclus dès pro avec une version enrichie en premium · **premium** = exclusivité haut de gamme.
> Complexité : faible / moyenne / élevée (estimation d'effort, pas de risque).

### A. Vitrine / Branding

| # | Feature | Description courte | Tier suggéré | Complexité | Réutilise existant | Risque |
|---|---|---|---|---|---|---|
| 1 | **Vitrine boutique personnalisée (bannière + articles épinglés)** | Bannière de couverture, logo agrandi, bio, 3-6 articles épinglés en tête. Premium = carrousel multi-bannières + thème de marque + sélection « Coup de cœur ». | les deux | moyenne | `app/shop/[id].tsx`, `shop.images[]/logo`, `getShopArticles` ; nouveau `pinnedArticleIds` + `bannerImages` (rules owner non-sensible) | Modération des bannières (marques tierces, nudité) → réutiliser `submitReport` + statut suspended |
| 2 | **Vitrine de marque personnalisable (couverture, accent, handle @boutique)** | Couverture grand format, couleur d'accent (palette DS validée), bio enrichie, **handle/URL perso** (`/b/friperie-mile-end`) partageable. Premium = couleur d'accent + handle réservé. | les deux | moyenne | `app/shop/[id].tsx`, `shopService.updateShop`, upload Storage RN ; nouveau `coverImage/accentColor/handle` + index unicité | Couleur libre casse le DS Editorial Luxe → palette validée, jamais de hex libre. Handle = squatting → réservation CF + blocage marques tierces |
| 3 | **Collections curatées & épinglage d'articles en tête de vitrine** | Articles regroupés en collections nommées (rails sur la vitrine) + épinglage de N vedettes. Pro = collections + épinglage avec quota ; premium = quota levé + réordonnancement manuel complet. | les deux | moyenne | `getShopArticles`, cards mémoïsés + rails Home, `search?shopId` ; nouveau sous-collection `shops/{id}/collections` + `pinnedArticleIds` + ordre | Borner quota articles/collections (perf) ; un épinglé vendu doit se déclasser auto (respect isSold/isActive) |
| 4 | **Vidéos produit & présentation vidéo de la boutique** | Vidéo de présentation en tête de vitrine + vidéos sur fiches articles (état réel, tissu en mouvement). Pro = vidéo boutique ; premium = vidéos par article (quota élevé). Fort pour luxe/vintage. | les deux | élevée | upload Storage RN (`fetch().blob()+uploadBytes`), expo-image (poster), `storage.rules` ; nouveau pipeline vidéo (compression, durée max, poster) + lecteur | Coût stockage/bande passante + perf RN 0.83 (OOM upload lourd) → plafonner durée/poids ; modération vidéo plus lourde |
| 5 | **Vitrine « À propos » enrichie & histoire de marque** | Section structurée : histoire, valeurs (mode durable, fait au Québec), engagements, chiffres de confiance (membre depuis, articles vendus, délai d'expédition). Premium = badges d'engagement (ex. « Expédié 48h ») sur chaque fiche. | les deux | faible | champ `description`, section vitrine, `userStatsService` (articles vendus / membre depuis), copy FR DS ; nouveau champ `about` + badges | Les badges d'engagement sont des promesses → réserver les badges forts à des engagements mesurables/vérifiés (sinon publicité trompeuse) |

### B. Mise en avant / Boost & placement

| # | Feature | Description courte | Tier suggéré | Complexité | Réutilise existant | Risque |
|---|---|---|---|---|---|---|
| 6 | **Boost d'article (remontée en search + home)** | Articles remontés en tête des résultats pertinents et des rails home, libellé discret « Boutique ». **Quota mensuel inclus** dans le forfait (ex. pro 5/mois, premium 30/illimité) plutôt qu'à l'acte. | les deux | moyenne | `isPromoted` + `popularityScore` (search_index), trigger `products.ts` ; nouveau `boostedUntil` + bonus de score honoré si tier actif (modèle `resolveBuyerFeeReduction`) | Pollution des résultats si quota large → plafonner la part d'items boostés par page, exiger `tierPaidUntil > now` serveur |
| 7 | **Crédits de boost inclus dans le forfait** | Quota mensuel de boosts consommable à discrétion. Rend l'abonnement « auto-amorti » : boost « offert » en plus de la réduction de frais. Premium = plus de crédits + emplacements premium. | les deux | moyenne | `popularity.ts` + `calculatePopularityScore`, `Shop.tier/tierPaidUntil` (allocation), `platform_ledger` (consommation) | Équité du classement : ne pas masquer la pertinence → borner la part d'emplacements boostés par rail, logguer le ROI |
| 8 | **Crédits boost mensuels inclus + remise sur boosts à l'acte** | Quota mensuel inclus (pro X / premium supérieur) **+ remise sur les boosts achetés au-delà** du quota. Combine abonnement et à-l'acte. | les deux | élevée | `search.ts` + `calculatePopularityScore`, `home.ts featuredSellers`, `platform_ledger` + charge plateforme directe (`shopTier.ts`/`webhooks.ts`), notifications | Nécessite un vrai système boost/ranking (n'existe pas) — gros chantier search + équité feed (ne pas noyer les vendeurs gratuits) |
| 9 | **Boutiques à la une (rail home dédié + priorité recherche locale)** | Rail « Boutiques à proximité » priorisé par géolocalisation de l'acheteur. Pro = rotation curatée ; premium = emplacements garantis/épinglés + priorité search locale. | les deux | moyenne | sections home server-curated (`home.ts`, `getFeaturedSellers`), `getShopsNearLocation`/geohash ; nouveau `getFeaturedShops` (tier actif + proximité) | Équité de rotation entre pros (éviter winner-takes-all) ; plafonner les emplacements premium pour ne pas saturer la home |
| 10 | **Mise en avant saisonnière & collections thématiques (incl. SwapZone)** | La boutique soumet une « collection » éligible aux campagnes saisonnières éditorialisées (Rentrée, Friperie d'hiver, Sneakers), y compris une vitrine en SwapZone. Premium = inclusion garantie ≥1 campagne/saison + slot SwapZone ; pro = éligible sur sélection. | premium | moyenne | rails home curatés (`home.ts`), SwapZone (`app/swap-zone.tsx`), tags de campagne, curation admin (`app/admin/shops.tsx`) | Charge de curation manuelle admin → slots saisonniers limités + file de soumission modérée |
| 11 | **Planification de publication & boost programmé** | Programmer la mise en ligne (brouillon → actif à une date) et planifier des fenêtres de mise en avant aux heures de forte audience. Premium = republication auto récurrente des invendus. | les deux | moyenne | `scheduled/*` (`onSchedule`), `draftService` + `cleanupDrafts`, `calculatePopularityScore` (fraîcheur), `popularity.ts` | Abus de fraîcheur / spam du fil si republication trop fréquente → limiter cadence par article et par forfait |

### C. Confiance / Badge & réputation

| # | Feature | Description courte | Tier suggéré | Complexité | Réutilise existant | Risque |
|---|---|---|---|---|---|---|
| 12 | **Badge Boutique vérifiée (KYC + immatriculation QC)** | Badge de confiance sur page boutique, cartes article et résultats : « Boutique vérifiée » (pro), sceau renforcé (premium). S'appuie sur le KYC Stripe Connect Custom + NEQ/GST/QST. | les deux | faible | `shop.verificationDetails` (CF-only), `legalInfo`, statut KYC `getStripeAccountStatus` ; rendu sur cartes (composant mémoïsé) | « Vérifiée » doit refléter une vraie vérification (KYC validé) sinon engagement trompeur → lier strictement KYC actif + tier actif |
| 13 | **Badge Marchand vérifié (KYC entreprise QC) distinct de l'actuel** | Vérification réelle de l'entité (NEQ, TPS/TVQ) → badge « Marchand vérifié » fort, **distinct du « Boutique vérifiée » actuel qui ne prouve que la modération du dossier**. Premium = niveau supérieur (« Or », vérif renforcée + mise en avant search). | les deux | élevée | `legalInfo`, `verificationDetails`, `app/admin/shops.tsx` (file modération), KYC Stripe Connect Custom | Conformité Loi 25 (stockage identité/numéros) ; **le badge actuel est trompeur et doit être renommé** ; validation manuelle = coût admin |
| 14 | **Badge boutique vérifiée & priorité de classement** | Badge « Boutique pro vérifiée » sur fiche, page et résultats + léger bonus de classement search/home pour les payantes. Premium = badge distinct « Maison » + bonus supérieur. | les deux | faible | `Shop.tier/tierPaidUntil` (CF-only), `verificationDetails`, `search_index` + `calculatePopularityScore` (facteur tier), `home.ts featuredSellers` | Bonus de classement trop fort → dégrade la pertinence et frustre les gratuits ; poids modéré, jamais un hors-sujet devant un pertinent |
| 15 | **Mise en avant « Livraison offerte » + badge vérifiée dans le feed** | Combinaison branding + signal d'achat : badge confiance (dès pro) + bandeau « Livraison offerte » (si actif) priorisé en search/home. Pas de nouvel achat à l'acte. | les deux | faible | `shop.tier` (doc), `search_index` (flag `shopTier`/`freeShipping` via trigger `products.ts`), cards mémoïsées + `shop/[id].tsx`, `verificationDetails` | Le badge engage la responsabilité plateforme → n'accorder qu'après vérif réelle (`legalInfo` + `verificationDetails`), pas sur simple paiement |
| 16 | **Réponse publique aux avis (droit de réponse vendeur)** | Le vendeur répond publiquement sous chaque avis (remerciement, mise au point). Pro = réponse texte ; premium = modèles réutilisables + contestation d'avis abusif via file de modération. | les deux | moyenne | `reviewService` + `createReview`/`updateUserRating`, `submitReport`/`triageReport`, notifications ; nouveau `reply{text,createdAt}` sur Review (callable owner-only) | Modération obligatoire (harcèlement/diffamation, sensible Loi 25) ; la contestation ne doit pas supprimer un avis légitime |
| 17 | **Avis mis en avant & note détaillée sur la vitrine** | Bloc réputation riche : avis vedettes épinglés, répartition des notes (5→1★), nombre de transactions, avis avec photos. Pro = bloc détaillé + 1 avis épinglé ; premium = plusieurs avis + carrousel média. | les deux | faible | `reviewService.getUserReviews`, `rating`/`reviewCount` dénormalisés, cards/rails ; nouveau `featuredReviewIds` + agrégat répartition | Épinglage = cherry-picking trompeur → garder la répartition complète visible. Photos = stockage/modération |

### D. Audience & fidélisation

| # | Feature | Description courte | Tier suggéré | Complexité | Réutilise existant | Risque |
|---|---|---|---|---|---|---|
| 18 | **Abonnés de boutique + alertes nouveautés et ventes flash** | Les acheteurs s'abonnent ; le vendeur pousse des notifs (arrivage, baisse de prix, vente flash). Quota encadré (pro 1 push/sem, premium 3/sem + segmentation par catégorie). | les deux | élevée | `sendPushNotification` (respect `preferences.notifications.*`), pattern saved searches ; nouveau `shop_followers` + callable d'envoi rate-limitée | Spam / fatigue notif → réputation. Plafonner fréquence serveur, opt-out par boutique, kill-switch admin, anti-stomp |
| 19 | **Abonnement à la boutique (follow) avec notifications de nouveautés** | Suivi de boutique + notif ciblée à chaque nouvel article, compteur d'abonnés sur la vitrine. Pro = notif auto de nouvel article ; premium = « annonce à mes abonnés » (push manuel, fréquence plafonnée). | les deux | moyenne | `favoritesService` (pattern subcollection + count), `notifications.ts`, trigger article create (fan-out), savedSearches (modèle job) | Push manuel premium peut spammer → plafonner 1-2/sem, respect prefs, mute par boutique. Fan-out gros = batcher CF |
| 20 | **Programme de fidélité acheteur financé par la boutique** | Points/cashback pour les acheteurs récurrents (ex. au 5e achat = crédit sur les frais de service du prochain achat dans cette boutique). **Financé par la boutique**, pas la plateforme. | premium | élevée | `resolveBuyerFeeReduction` (application crédit sur serviceFee), `transactionService` (compte achats), notifications, `platform_ledger` (financement) | Compta/conformité (crédit = avantage à tracer TPS/TVQ, jamais monnaie échangeable). Abus multi-comptes → lier à l'identité vérifiée + plafonner |
| 21 | **Codes promo et ventes flash de boutique** | Réductions financées par le vendeur : code promo (% ou montant), vente flash limitée. Prix barré + badge « Promo »/« Vente flash » sur vitrine/cards/search. Premium = planification auto + ventes flash récurrentes. | les deux | élevée | logique prix/fees checkout (`calculateFees`, `payments.ts`) étendue pour une **réduction VENDEUR distincte** de la réduction frais acheteur ; `lastPriceDropAt` + rail price-drops home | La réduction est financée par le VENDEUR (0% commission vendeur intact) → bien séparer du calcul frais acheteur pour ne pas rogner le revenu plateforme. Bloquer < min Stripe (50¢) |

### E. Analytics & outils de scale

| # | Feature | Description courte | Tier suggéré | Complexité | Réutilise existant | Risque |
|---|---|---|---|---|---|---|
| 22 | **Tableau de bord boutique (ventes, vues, conversion)** | Dashboard in-app : CA, ventes, vues cumulées, conversion vues→favoris→ventes, panier moyen, par période (7/30/90 j). | les deux | moyenne | `Article.views/likes`, `scheduled/stats.ts` (agrégation), `platform_ledger`/transactions (CA), `userStatsService` | Coût d'agrégation → job planifié pré-calculé par boutique, pas en lecture lourde client |
| 23 | **Tableau de bord vendeur (analytics boutique)** | Dashboard pro : ventes/revenu 30-90j, vues/favoris par article, conversion vue→vente, top catégories, articles dormants à rebaisser. Premium = export CSV + comparaison période/période. | les deux | élevée | `scheduled/stats.ts` (categoryStats/revenue), `search_index` + `calculatePopularityScore` (signaux vues/favoris), `userStatsService` | Coût Firestore si agrégé à la volée → doc d'agrégat par boutique via scheduled ; ne pas exposer les données d'autres vendeurs |
| 24 | **Partage social enrichi + tableau de bord de performance** | Visuels de partage prêts IG/TikTok/FB (article ou vitrine + lien profond) + dashboard : vues, abonnés gagnés, conversion, clics sur boosts, ventes par campagne. Pro = stats essentielles + partage ; premium = export + attribution par code promo + historique long. | les deux | moyenne | `useDeepLinking`, agrégation stats (`scheduled/stats.ts`, `userStatsService`) étendue au scope boutique, images compressées | Coût de calcul des agrégats → précalcul scheduled. Liens profonds doivent gérer boutique suspendue/supprimée |
| 25 | **Analytics d'audience et de demande** | Analyse haut de gamme : provenance des vues, termes de recherche menant aux annonces, favoris non achetés (intention non convertie), démographie agrégée/anonymisée (région QC/CA, tranche d'âge). | premium | élevée | `utils/search.ts` (search_index), `scheduled/savedSearches.ts` (signaux demande), `triggers/favorites.ts`, embeddings | Conformité Loi 25 : agrégats anonymisés uniquement (k-anonymat), jamais d'identité acheteur ; valider avec l'audit Loi 25 |
| 26 | **Import et édition en masse du stock (CSV / bulk)** | Import CSV pour créer/MAJ des annonces en masse + édition groupée (baisse -X%, activer/désactiver, changer catégorie/statut promo). Chaque ligne passe par le même pipeline de validation que la création unitaire. | les deux | élevée | `articlesService.ts`, `callable/products.ts`, `promotionActive`/`originalPrice`/`priceDropPercent`, `draftService` (staging) | Abus/qualité des données → valider chaque ligne, plafonner volume par lot/fenêtre, anti-spam search_index ; images manquantes en CSV → mode brouillon |
| 27 | **Gestion automatisée des offres (auto-accept / décline / contre-offre)** | Règles configurées une fois : seuil d'auto-acceptation (≥90% du prix), seuil d'auto-refus, contre-offre auto entre les deux. S'exécute serveur sur les offres entrantes. | les deux | moyenne | `callable/automatedDecisions.ts`, `OfferStatus`, `scheduled/offerExpiration.ts`, `OfferHistoryEntry` (traçabilité) | Vente non désirée si seuils mal réglés → confirmation des seuils, trace OfferHistory, borner par article ; ne pas auto-accepter les contre-propositions de lieu/horaire (meetup) |
| 28 | **Réponses rapides & modèles de description IA** | Réponses pré-enregistrées dans le chat (dispo, état, retour, meetup) insérables en un tap + modèles de description générés/affinés par l'IA existante (ton, mots-clés mode, matière/état). Gabarits réutilisables. | les deux | faible | `callable/ai.ts` + `aiService` (image→description), `chatService`, `triggers/messages.ts`, `draftService` | Coût d'inférence IA descriptions → plafonner par fenêtre (modèle `analyzeProduct` existe) ; modèles texte quasi gratuits |
| 29 | **Export comptable et fiscal Canada/Québec** | Export CSV/PDF des ventes, frais et revenus avec ventilation TPS/TVQ (exploite `legalInfo`). Premium = récap annuel prêt pour la déclaration + suivi des seuils d'inscription aux taxes. | premium | moyenne | `Shop.legalInfo`, `platform_ledger`/transactions, `seller_balances`, `sellerBalanceService` | Exactitude fiscale → présenter comme aide à la déclaration, pas conseil fiscal ; s'aligner sur le statut taxes ; ne jamais inventer de numéros TPS/TVQ |

### F. Quotas & limites

| # | Feature | Description courte | Tier suggéré | Complexité | Réutilise existant | Risque |
|---|---|---|---|---|---|---|
| 30 | **Quota d'annonces actives par forfait** | Plafond d'annonces actives par tier (basic limité, pro étendu, premium illimité), compteur visible + invitation à monter au dépassement. Axe de tiering auto-segmentant par volume. | les deux | faible | `getShopArticles` (compte actifs), `Shop.articlesCount`, `feeReductionForShopTier` (même résolution tier), `firestore.rules` | Frustration si limite basic trop basse → calibrer pour ne pas brider la liquidité. Application **serveur** (callable/rules), jamais client |
| 31 | **Quotas d'annonces actives par palier (chiffré)** | Variante chiffrée : basic ~30, pro ~300, premium illimité. Dépassement bloqué client-side + verrou serveur via callable de check au create article. | les deux | moyenne | `Shop.articlesCount`, trigger `products.ts` (create/update), `resolveBuyerFeeReduction` (même résolution tier pour le check quota) | `articlesCount` doit être fiable (transaction sur create/delete/sold) sinon faux blocages ; afficher « X/Y » pour lisibilité |

### G. Monétaire vendeur / trésorerie

| # | Feature | Description courte | Tier suggéré | Complexité | Réutilise existant | Risque |
|---|---|---|---|---|---|---|
| 32 | **Paliers de réduction de frais acheteur basés sur le volume** | La réduction frais acheteur augmente par paliers selon le volume de ventes mensuel (ex. pro 40% puis 50% au-delà de 30 ventes/mois ; premium 100% maintenu). Récompense les boutiques actives. | les deux | moyenne | `feeReductionForShopTier` + `resolveBuyerFeeReduction` (constante → fonction de palier), agrégation volume via `stats.ts` + `articlesCount`/`reviewCount`, lecture server-only (`tierPaidUntil`) | Complexité de compréhension → afficher palier courant + prochain seuil. Gaming via ventes fictives → s'appuyer sur transactions **livrées non litigieuses** |
| 33 | **Retrait accéléré (fenêtre de litige raccourcie)** | Fenêtre de litige 7j raccourcie pour les abonnés : pro = 3j, premium = 24h (ou release immédiat après confirmation acheteur). Les fonds passent en balance retirable plus vite. | les deux | moyenne | `DISPUTE_WINDOW_MS` + `applyDeliveredHeldFunds` + `releaseHeldFunds` (fenêtre paramétrable par tier au DELIVERED : `fundsReleaseAt = deliveredAt + windowForTier`), modèle 3 buckets inchangé | Risque fraude/litige accru → borner premium ≥24-48h, exclure boutiques récentes/non vérifiées (`legalInfo` + `verificationDetails`), garder blocage si `disputed` |
| 34 | **Seuil de retrait abaissé + retraits plus fréquents** | Seuil de retrait min plus bas + cadence plus élevée (ex. basic 25 $/1 gratuit par mois ; pro 10 $/hebdo ; premium 1 $/à la demande). Réduit l'argent dormant dans le wallet. | les deux | faible | `wallet.ts` (`requestWithdrawal` / guards) — seuil min et fréquence déjà des garde-fous, paramétrés par tier comme feeReduction ; balance bucket inchangé | Coût des transferts Stripe par retrait si premium illimité à 1 $ → absorber dans la marge ou garder une cadence raisonnable (quotidien max) |

### H. Logistique & protection

| # | Feature | Description courte | Tier suggéré | Complexité | Réutilise existant | Risque |
|---|---|---|---|---|---|---|
| 35 | **Livraison offerte par la boutique (port pris en charge)** | La boutique absorbe tout/partie des frais ShipEngine de SES acheteurs (pro = 50% sur le port, premium = 100% offert), financé via abonnement et/ou refacturé. Badge « Livraison offerte » sur liste et détail. | les deux | moyenne | ShipEngine (label checkout `payments.ts`), `resolveBuyerFeeReduction` (même résolution via shopId), pattern `serviceFeeConfig` pour `shippingSubsidyPercent` server-owned, badge UI | Coût plateforme réel → borner/plafonner par mois + cap par commande côté config serveur (sinon marge négative sur petit prix + gros colis) |
| 36 | **Crédits d'envoi inclus dans le forfait** | Crédit d'expédition mensuel (pro ~10 $, premium ~30 $) déduit auto du coût d'étiquette ShipEngine. Rend l'abonnement « auto-amorti » pour le vendeur volume. | les deux | moyenne | `labelFulfillment.ts` (réconciliation coût label, écriture ledger), wallet/ledger vendeur (CENTS), webhook shop_tier (point d'attache crédit mensuel) | Coût plateforme réel → plafonner strictement, reset mensuel idempotent, pas de report du solde, tracer dans le ledger |
| 37 | **Étiquettes d'expédition en lot** | Génération groupée d'étiquettes ShipEngine pour plusieurs commandes, depuis un écran « À expédier » : sélection multiple, un tap, un PDF/QR par colis. | les deux | moyenne | `labelFulfillment.ts` (label atomique + crédit wallet une fois), `config/shipEngine.ts`, `sweepPendingLabels.ts` (retry), transactions en statut shipping | Échec partiel d'un lot (1 KO sur 10) → file de retry existante ; idempotence par transaction pour ne pas double-créditer |
| 38 | **Multi-points relais favoris & expédition depuis relais** | Pré-enregistrer plusieurs PUDO ShipEngine favoris + choisir en un tap le relais de dépôt par commande. Premium = plages d'enlèvement + envoi par lot depuis un relais unique. | les deux | moyenne | `findPickupPoints` (callable PUDO), `ShipEngineAddress`/`deliveryType pickup_point`, geohash boutique | API PUDO payante par appel → cacher les relais favoris côté doc boutique ; revalider la dispo avant achat label |
| 39 | **Retours simplifiés & protection vendeur renforcée** | Génération d'étiquette retour en un tap + suivi du colis retour + fenêtre de litige raccourcie. Premium = protection renforcée (avance plateforme sur litige acheteur abusif documenté, plafonnée). | les deux | élevée | `recourse.ts:requestReturn` + `returnRefund.ts`, `trackingCheck.ts`, `resolveDispute`, `sellerDebt`/wallet ledger, `sendPushNotification` | Conformité Loi 25 / équité acheteur ; l'avance plateforme = plafonds stricts + revue admin pour éviter l'abus vendeur |

### I. Exclusivités premium

| # | Feature | Description courte | Tier suggéré | Complexité | Réutilise existant | Risque |
|---|---|---|---|---|---|---|
| 40 | **SwapZone Pro & mise en relation B2B** | Espace SwapZone réservé aux boutiques : échange/déstockage de lots entre commerçants, mise en relation B2B (achat de lots, sourcing), accès anticipé aux nouvelles features. | premium | élevée | `swapService.ts` + zone d'échange généraliste permanente (`app/swap-zone.tsx`), `Shop.tier` (gating), notifications (mise en relation), geohash boutique (matching local) | B2B = volume critique nécessaire (sinon espace vide) ; cadrer facturation/taxes/conformité QC avant ouverture ; risque de contournement des frais acheteur si mal délimité |

---

## 5. Proposition de matrice de tiers (À TRIER ENSEMBLE)

> Ceci est une **proposition de départ**, pas une décision. Principe : pro = utile dès le palier d'entrée, premium = clairement supérieur (exclusivités + versions enrichies). Plusieurs idées se recoupent (badges, dashboards, boost, quotas) — il faudra **dédupliquer** au tri.

| Feature (n°) | Basic | Pro | Premium |
|---|:---:|:---:|:---:|
| Réduction frais acheteur (actuel) | 0% | 50% | 100% |
| 1/2/3 Vitrine perso + collections + handle | ☐ standard | ☑ perso + quota | ☑ enrichie (carrousel, accent, handle réservé, réordre) |
| 4 Vidéos produit/boutique | ☐ | ☑ vidéo boutique | ☑ + vidéos par article |
| 5 « À propos » enrichie | ☐ | ☑ éditorial | ☑ + badges d'engagement |
| 6/7/8 Boost + crédits boost | ☐ | ☑ quota inclus | ☑ quota supérieur + emplacements premium + remise à l'acte |
| 9 Boutiques à la une | ☐ | ☑ rotation curatée | ☑ emplacements garantis + priorité search locale |
| 10 Saisonnier / SwapZone éditorial | ☐ | éligible sur sélection | ☑ inclusion garantie + slot SwapZone |
| 11 Planification publication | ☐ | ☑ programmation | ☑ + republication auto invendus |
| 12/13/14/15 Badges confiance + classement | ☐ | ☑ « Boutique/Marchand vérifié » + léger bonus | ☑ badge « Or/Maison » + bonus supérieur |
| 16 Réponse publique aux avis | ☐ | ☑ texte | ☑ + modèles + contestation |
| 17 Avis mis en avant | ☐ | ☑ 1 épinglé | ☑ plusieurs + carrousel média |
| 18/19 Abonnés boutique + push | ☐ | ☑ notif auto nouveautés (quota bas) | ☑ push manuel + segmentation |
| 20 Fidélité acheteur | ☐ | ☐ | ☑ exclusif premium |
| 21 Codes promo / ventes flash | ☐ | ☑ ponctuel | ☑ + planification + récurrent |
| 22/23/24 Dashboard analytics | ☐ | ☑ stats essentielles | ☑ + export CSV + comparaison + attribution |
| 25 Analytics d'audience/demande | ☐ | ☐ | ☑ exclusif premium |
| 26 Import/édition en masse CSV | ☐ | ☑ | ☑ |
| 27 Gestion auto des offres | ☐ | ☑ | ☑ |
| 28 Réponses rapides + modèles IA | ☐ | ☑ | ☑ |
| 29 Export comptable/fiscal QC | ☐ | ☐ | ☑ + récap annuel |
| 30/31 Quota annonces actives | ~30 | ~300 | illimité |
| 32 Paliers réduction frais par volume | ☐ | ☑ 40→50% | ☑ 100% maintenu |
| 33 Retrait accéléré (fenêtre litige) | 7j | 3j | 24h |
| 34 Seuil de retrait abaissé | 25 $/mois | 10 $/hebdo | 1 $/à la demande |
| 35 Livraison offerte | ☐ | 50% port | 100% port offert |
| 36 Crédits d'envoi inclus | ☐ | ~10 $/mois | ~30 $/mois |
| 37 Étiquettes en lot | ☐ | ☑ | ☑ |
| 38 Relais favoris | ☐ | ☑ | ☑ + plages + envoi par lot |
| 39 Retours + protection vendeur | ☐ | ☑ retours simplifiés | ☑ + protection renforcée |
| 40 SwapZone Pro / B2B | ☐ | ☐ | ☑ exclusif premium |

**Exclusivités premium proposées (ce qui fait sauter le palier)** : fidélité acheteur (20), analytics d'audience (25), export comptable annuel (29), SwapZone Pro/B2B (40), inclusion saisonnière garantie (10), retrait 24h + seuil 1 $ (33/34).

---

## 6. Quick wins (faible complexité, réutilise l'infra existante — à livrer en premier)

Ces features se branchent sur du code déjà en place, avec un delta d'effort faible et une valeur perçue forte :

1. **#12 Badge Boutique vérifiée (KYC + immatriculation QC)** — `verificationDetails` + KYC Stripe déjà là. Levier confiance le plus rentable. *(faible)*
2. **#15 « Livraison offerte » + badge vérifiée dans le feed** — flag sur `search_index` via trigger `products.ts`, cards déjà prêtes. *(faible)*
3. **#14 Badge vérifiée + léger bonus de classement** — `Shop.tier` + `calculatePopularityScore`, facteur tier au score. *(faible)*
4. **#17 Avis mis en avant & note détaillée** — `reviewService` + `rating`/`reviewCount` déjà dénormalisés. *(faible)*
5. **#5 Vitrine « À propos » enrichie** — champ `description` + `userStatsService`, fort effet de marque pour peu de code. *(faible)*
6. **#28 Réponses rapides + modèles de description IA** — `aiService` (image→description) + `chatService` déjà en place. *(faible)*
7. **#34 Seuil de retrait abaissé + retraits plus fréquents** — `wallet.ts` : seuil et fréquence déjà des garde-fous, à paramétrer par tier. *(faible)*
8. **#30 Quota d'annonces actives par forfait** — `articlesCount` + même résolution de tier que feeReduction, verrou rules. *(faible)*

> Note : 4 de ces 8 sont des variantes du **badge de confiance** (#12, #14, #15 + le bloc avis #17). À fusionner en **un seul chantier « confiance & badge »** au tri — c'est le quick win à plus fort ROI et le levier le moins cher du benchmark.

---

## 7. Questions ouvertes pour le fondateur

1. **Prix des paliers** : on garde pro 29,99 $ / premium 79,99 $, ou on réévalue maintenant que le contenu des forfaits s'enrichit ? (L'écart 30→80 $ doit rester justifié par des exclusivités premium tangibles.)
2. **Net auto-amorti** : on veut packager des crédits (boost #7, envoi #36) pour que le forfait apparaisse « gratuit en net » ? Si oui, fixer le **plafond mensuel** acceptable de subvention plateforme (boost + envoi + livraison offerte #35) pour ne pas creuser la marge.
3. **Badge actuel trompeur** : on renomme l'actuel « Boutique vérifiée » (qui ne prouve que la modération du dossier) avant d'introduire un vrai « Marchand vérifié » (#13) ? Décision conformité à prendre tôt.
4. **Boost / ranking** : on construit un vrai système de boost (gros chantier search, #6/7/8) ou on reste sur badge + placement curaté (#9, plus léger) pour la v1 ?
5. **Réduction de frais par volume (#32)** : on enrichit le levier existant (50%/100% fixes → paliers) ou on le laisse fixe et on met l'énergie ailleurs ?
6. **Trésorerie vendeur (#33/#34)** : jusqu'où raccourcir la fenêtre de litige en premium sans s'exposer à la fraude ? (Recommandation : plancher 24-48h, exclure boutiques récentes/non vérifiées.)
7. **Features à exclure d'emblée** : y a-t-il des idées qu'on retire du menu maintenant (ex. vidéo #4 si coût stockage trop lourd, B2B #40 si pas de volume critique, fidélité #20 si conformité trop complexe) ?
8. **Priorité** : on attaque le **bloc confiance/badge** (quick wins, ROI max) en premier, ou on vise un différenciateur fort (livraison offerte #35) pour le marketing du forfait ?
9. **Conformité Loi 25** : les idées data (#25 analytics audience, #20 fidélité, #16 réponses publiques, #13 KYC) touchent des données sensibles — on les fait passer par l'audit Loi 25 en cours avant spec ?

---

*Document de travail — aucune idée hors des données fournies, aucune décision arrêtée. À trier ensemble.*
