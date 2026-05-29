# Document de conception — Forfaits Boutique « Second »

> Conception produit + design + intégration app + implications backend.
> Décisions propriétaire intégrées : **(B)** monétisation par réduction des frais acheteur · **particuliers + pros** · **légal conditionnel au palier**.
> Prix et features fermes — ajustables. Section « Arbitrages à valider » en fin de document.
> Produit le 2026-05-28 par l'agent product-designer.

---

## 1. Positionnement & cible

### Le pivot du modèle

Second est aujourd'hui **0 % commission vendeur** — le vendeur touche 100 % du prix. La plateforme se rémunère via les **frais de protection acheteur** (`5 % + 1,50 $`, min 2,00 $), calculés serveur dans `functions/src/utils/fees.ts` et prélevés en `application_fee_amount` sur la destination charge Stripe.

Les forfaits Boutique **ne touchent pas** au 0 % vendeur. Le levier est inversé : **plus le forfait est élevé, moins l'acheteur paie de frais sur les articles de cette boutique**. C'est un argument de **conversion** (l'article paraît moins cher au checkout) que la boutique paie sous forme d'abonnement mensuel. Le palier supérieur affiche **0 % de frais acheteur** — argument vitrine : « Chez cette boutique, zéro frais d'achat. »

Économiquement : Second échange une marge variable par transaction (les frais acheteur) contre un **revenu d'abonnement récurrent et prévisible** (MRR). La boutique « rachète » les frais de ses acheteurs pour vendre plus.

### Cible double

| Segment | Profil | Forfait d'entrée naturel |
|---|---|---|
| **Particulier sérieux / power-seller** | Vend régulièrement (dressing volumineux, revente mode, side-business non déclaré), veut une vitrine crédible et de la visibilité, mais sans structure légale lourde. | **Atelier** (entrée de gamme) — sans NEQ obligatoire. |
| **Commerce établi** | Friperie, dépôt-vente, ressourcerie, créateur/designer, concept-store. A pignon sur rue ou stock conséquent, facture la TPS/TVQ, cherche du volume et un argument prix fort. | **Maison** (haut de gamme) — légal requis, 0 % frais acheteur. |

Le forfait intermédiaire (**Comptoir**) est le pont : le particulier qui décolle ou le petit commerce qui teste la plateforme.

### Promesse par audience

- **Vendeur particulier** : « Transforme ton dressing en boutique. Tes acheteurs paient moins, tu vends plus. »
- **Commerce** : « Ta friperie, en vitrine nationale. Zéro frais pour tes clients, zéro commission pour toi. »
- **Acheteur** (bénéficiaire passif) : voit un badge et un prix de frais réduit/nul — gain de confiance et de conversion.

---

## 2. Les 3 forfaits — noms Editorial Luxe, grille CAD, comparatif

Naming aligné sur le DS Editorial Luxe (registre artisanal/maison, pas « Pro/Premium/Gold »). Progression sémantique **Atelier → Comptoir → Maison**.

### Grille de prix (CAD)

| Forfait | Mensuel | Annuel (2 mois offerts) | Cible |
|---|---|---|---|
| **L'Atelier** | **9 $/mois** | **90 $/an** (≈ 7,50 $/mois) | Particulier sérieux, power-seller |
| **Le Comptoir** | **29 $/mois** | **290 $/an** (≈ 24,17 $/mois) | Petit commerce, vendeur en croissance |
| **La Maison** | **79 $/mois** | **790 $/an** (≈ 65,83 $/mois) | Friperie/dépôt-vente/créateur établi |

> Logique annuel : 12 mois payés 10 (≈ -17 %), incitation au prépaiement = MRR sécurisé + churn réduit.

### Le levier central : frais de protection acheteur par palier

| Forfait | Frais acheteur sur les articles de la boutique | Argument |
|---|---|---|
| **L'Atelier** | **Standard** : `5 % + 1,50 $` (min 2,00 $) — inchangé | Vitrine + visibilité, mais frais normaux |
| **Le Comptoir** | **Réduit** : `2,5 % + 0,75 $` (min 1,00 $) | « Frais réduits chez cette boutique » |
| **La Maison** | **0 %** : aucun frais acheteur | « Chez cette boutique, zéro frais d'achat » |

> Le vendeur touche **toujours 100 %** quel que soit le forfait. Seuls les frais *acheteur* bougent. À 0 %, Second renonce à toute marge transactionnelle sur cette boutique et se rémunère **uniquement** sur l'abonnement (79 $/mois) — d'où le prix du palier haut.

### Tableau comparatif des features (fermes)

| Feature | Aucun forfait (vendeur lambda) | L'Atelier (9 $) | Le Comptoir (29 $) | La Maison (79 $) |
|---|:---:|:---:|:---:|:---:|
| **Frais acheteur sur tes articles** | 5 % + 1,50 $ | 5 % + 1,50 $ | 2,5 % + 0,75 $ | **0 %** |
| Commission vendeur | 0 % | 0 % | 0 % | 0 % |
| Page boutique dédiée (`/shop/[id]`) | — | ✓ | ✓ | ✓ |
| Badge boutique sur les articles & profil | — | Badge « Atelier » | Badge « Comptoir » | Badge « Maison » + ruban « 0 frais » |
| Vitrine sur la carte (`ShopMap`) | — | ✓ | ✓ | ✓ (épingle premium) |
| Logo + bannière + galerie photos | — | Logo | Logo + bannière | Logo + bannière + galerie (10 img) |
| Articles actifs simultanés | 20 (cap actuel) | 100 | 500 | **Illimité** |
| Visibilité feed (boost) | — | Léger | Section « Boutiques en vedette » | **Prioritaire** (top de section + Home) |
| Apparition `FeaturedSellersSection` (Home) | — | — | Rotation | **Priorité** |
| Mise en avant recherche (`shopId` filter) | — | Standard | Remontée | Remontée + filtre « 0 frais » |
| Statistiques boutique (dashboard) | — | Basique (vues, ventes) | + Conversion, top articles | + Démographie, exports CSV |
| Horaires + lien Insta/FB + site web | — | ✓ | ✓ | ✓ |
| Réponses sauvegardées / templates chat | — | — | 5 | Illimité |
| Promotions programmées (price drops batch) | Manuel 1/1 | Manuel | Batch 10 articles | Batch illimité + planif |
| Support | Standard | Standard | Prioritaire (48 h) | Dédié (24 h) |
| Vérification « Boutique vérifiée » | — | ✓ (auto) | ✓ | ✓ + badge « Commerce vérifié » |

> Les caps d'articles, batch promos et templates chat sont des **leviers de différenciation non-financiers** qui justifient l'écart de prix sans creuser la marge transactionnelle.

---

## 3. Éligibilité & conditions

### Pré-requis communs à tout forfait

1. **Compte vérifié** (email + téléphone) — réutilise `settings/verify-email` + `settings/phone`.
2. **Stripe Connect actif** (`stripeAccountId` + `stripeChargesEnabled === true`) — réutilise `createStripeConnectAccount`. Sans payout actif, pas de boutique (cohérent avec le gate déjà présent dans `createTransaction`, payments.ts L259-280).
3. **Acceptation des CGU Boutique** (addendum aux CGU vendeur).

### Conditions légales conditionnelles au palier

| Champ légal (`ShopLegalInfo`) | L'Atelier | Le Comptoir | La Maison |
|---|:---:|:---:|:---:|
| Identité + adresse | Requis | Requis | Requis |
| **NEQ / Business Number** (`businessNumber`) | Optionnel | **Requis** | **Requis** |
| **TPS** (`gstNumber`) | — | Optionnel | **Requis** |
| **TVQ** (`qstNumber`) | — | Optionnel | **Requis** |
| Coordonnées bancaires (`bankTransit`/`bankInstitution`/`bankAccount`) | Via Stripe | Via Stripe | Via Stripe |

> Justification : un particulier (Atelier) n'a pas d'entreprise enregistrée → on ne bloque pas. Dès qu'il y a *commerce* (Comptoir/Maison), le NEQ devient obligatoire ; au palier Maison (volume élevé, 0 frais, image « commerce établi »), TPS/TVQ requis pour conformité fiscale québécoise. Champs déjà présents dans `ShopLegalInfo` (types/index.ts L367-374) — aucune extension de type nécessaire pour le légal.

### Règles d'éligibilité & garde-fous

- **Un compte = une boutique** (1 `Shop` par `ownerId`) au lancement. Multi-boutiques = arbitrage futur.
- **Changement de forfait** : upgrade immédiat (proratisé Stripe), downgrade en fin de période. Si downgrade fait passer le nb d'articles actifs au-dessus du cap du nouveau palier → articles excédentaires passés `isActive: false` (les plus anciens d'abord), notification au propriétaire.
- **Suspension / non-paiement** : si l'abonnement Stripe passe `past_due` puis `canceled`, la boutique repasse au régime « aucun forfait » : frais acheteur reviennent à `5 % + 1,50 $`, badge retiré, boost coupé. Articles **non** supprimés.
- **Rétrocompatibilité** : les boutiques existantes (status `approved` sans forfait) sont traitées comme **« aucun forfait »** → frais standard. Migration douce, pas de régression.

---

## 4. Parcours d'onboarding (étape par étape + états d'échec)

Nouveau flow `app/shop/onboarding/` (il n'existe **aucune UI de création de boutique** côté app aujourd'hui — seulement admin + `createShop` dans le service). Entrée depuis `/sell` ou `/profile` (« Ouvrir ma boutique »).

### Étapes

**Étape 0 — Intro / choix de forfait**
- Écran de présentation des 3 forfaits (réutilise le tableau comparatif § 2).
- Sélection d'un forfait → détermine les champs requis aux étapes suivantes (collecte conditionnelle).
- *Échec* : aucun (peut quitter, état sauvegardé en brouillon `shops/{draft}` status `draft`).

**Étape 1 — Identité boutique**
- Nom, type (`ShopType` existant, 20 valeurs), description, logo.
- *Échec* : nom déjà pris (autre boutique approuvée même nom + ville) → message, suggestion. Champs vides → validation inline.

**Étape 2 — Localisation & contact**
- Adresse (`ShopAddress`), géocodage → `location` + `geohash` (déjà géré par `createShop`), téléphone, email, site, réseaux, horaires.
- *Échec* : adresse non géocodable → fallback saisie manuelle lat/lng ou « boutique en ligne uniquement » (pas d'épingle carte).

**Étape 3 — Légal (conditionnel au forfait)**
- **Atelier** : étape réduite (NEQ optionnel, skip possible).
- **Comptoir** : NEQ requis (validation format), TPS/TVQ optionnels.
- **Maison** : NEQ + TPS + TVQ requis, validation format des trois.
- *Échec* : format NEQ invalide (10 chiffres QC), TPS/TVQ mal formés → erreur inline bloquante selon palier. Sur Maison, impossible de continuer sans les 3.

**Étape 4 — Paiement vendeur (Stripe Connect)**
- Si `stripeAccountId` absent ou `stripeChargesEnabled !== true` → CTA vers `createStripeConnectAccount` (réutilise `settings/stripe-onboarding`).
- *Échec* : onboarding Stripe abandonné/incomplet → boutique reste `draft`, ne peut pas être soumise. Message : « Finalise ton compte de paiement pour ouvrir ta boutique. »

**Étape 5 — Abonnement (Stripe Subscription)**
- Récap forfait choisi + prix + ce que l'acheteur paiera (preview frais). Paiement via Stripe Subscription (PaymentSheet/Checkout).
- *Échec* : carte refusée → reste `draft`, abonnement non créé, retry. **Pas de mise en avant tant que l'abonnement n'est pas `active`.**

**Étape 6 — Soumission & validation**
- Boutique passe `pending` → file admin existante (`/admin/shops`, `ShopValidationCard`).
- *Échec* : rejet admin (`rejectShop` + `reason`) → status `rejected`, propriétaire notifié (`shop_rejected` existe déjà), peut corriger et resoumettre. **Important** : si rejet, **suspendre/rembourser l'abonnement Stripe** (ne pas facturer une boutique non approuvée).

**État final — Approuvée & active**
- `approved` + `subscription.status === 'active'` → boutique live, frais acheteur appliqués selon palier, mise en avant activée.

### Diagramme d'états

```
draft → (soumission) → pending → (approveShop) → approved+active ✓
                          │                          │
                          └→ (rejectShop) → rejected │
                                                      └→ subscription past_due → approved+downgraded(no plan)
                                                      └→ subscription canceled → approved (régime standard)
admin: suspendShop → suspended (frais standard, hors vitrine)
```

---

## 5. Mise en avant & incorporation dans l'app

Réutilise **intégralement** les composants existants. Ajouts = un champ `tier` sur `Shop` + branchements visuels.

### Composants existants à étendre

- **`ShopCard`** (components/search/ShopCard.tsx) : ajouter un **badge de palier** (ruban en haut de carte). Maison → ruban « 0 frais » couleur `rust`. Comptoir → puce « Frais réduits » `sage`. Atelier → puce discrète. Réutilise le pattern badge déjà présent (L45-49). Tri : les paliers hauts remontent dans les listes horizontales.
- **`ShopMap`** (components/search/ShopMap.tsx) : épingle différenciée par palier (Maison = marqueur premium plus gros / couleur `rust`). Au tap, le bottom-sheet affiche le badge frais.
- **Vitrine `/shop/[id]`** (app/shop/[id].tsx) : sous le `verifiedBadge` (L196-201), insérer un **bandeau frais** :
  - Maison : bandeau plein `rust` « Aucun frais d'achat dans cette boutique ».
  - Comptoir : bandeau `sage` « Frais réduits : 2,5 % au lieu de 5 % ».
  - Atelier : pas de bandeau frais (juste badge boutique).
- **`FeaturedSellersSection`** (features/home) : la curation serveur (`getFeaturedSellers`) doit **prioriser les boutiques par palier** (Maison > Comptoir > Atelier > vendeur lambda) dans l'ordre de rotation.
- **Article detail / `ArticleHero` + `ArticleCTABar`** : si l'article appartient à une boutique avec frais réduits/nuls, afficher le **prix frais barrés** ou « 0 frais » au CTA achat — c'est là que la conversion se joue. (Implique de connaître le `tier` au niveau article, voir § 8.)
- **Recherche (`features/search`)** : nouveau filtre **« Boutiques 0 frais »** (filtre les articles dont le `shopTier === 'maison'`), + remontée des résultats boutiques selon palier.

### Influence du forfait sur la visibilité (règle de tri)

Score de mise en avant = `tierWeight × freshness × rating`, où `tierWeight` : Maison ×3, Comptoir ×2, Atelier ×1.5, lambda ×1. Appliqué dans : Home (`FeaturedSellers`, discover), résultats recherche, `ShopMap` (ordre du listing latéral), section « Boutiques en vedette ».

---

## 6. Dashboard propriétaire

Nouvelle route `app/shop/dashboard.tsx` (accessible si `ownerId === currentUser` et boutique existe). Accès depuis `/profile`.

### Sections (selon palier)

1. **En-tête** : nom, logo, statut (active/pending/suspended), badge palier, MRR du forfait, date de renouvellement.
2. **Bandeau frais** : « Tes acheteurs paient X de frais » (0/réduit/standard) — rappel du bénéfice payé.
3. **Stats** (gating par palier) :
   - *Atelier* : vues boutique, articles actifs (X/100), ventes 30 j.
   - *Comptoir* : + taux de conversion, top 5 articles, vues→ventes.
   - *Maison* : + démographie acheteurs (ville), saisonnalité, **export CSV** des ventes.
4. **Gestion articles** : compteur cap (ex. 87/100), CTA « Ajouter » bloqué au cap avec invite à upgrader.
5. **Forfait** : palier actuel, comparatif, CTA upgrade/downgrade (→ Stripe), historique de facturation (réutilise pattern `wallet` ledger), lien gérer abonnement (Stripe billing portal).
6. **Légal & conformité** : récap NEQ/TPS/TVQ, alerte si palier requiert des champs manquants (ex. downgrade→upgrade).
7. **Promotions** : programmer des price drops par batch (gating par palier).

---

## 7. Copy FR clé (registre Editorial Luxe — chaleureux, sobre, pas de superlatifs criards)

**Noms & accroches forfaits :**
- L'Atelier — « Ta boutique commence ici. »
- Le Comptoir — « Pour les vendeurs qui montent. »
- La Maison — « La vitrine de référence. Zéro frais pour tes acheteurs. »

**Bandeau vitrine (Maison) :** « Chez cette boutique, aucun frais d'achat. »
**Bandeau vitrine (Comptoir) :** « Frais réduits ici : 2,5 % au lieu de 5 %. »

**CTA ouverture :** « Ouvrir ma boutique »
**Sous-titre intro :** « Garde 100 % de tes ventes. Offre à tes acheteurs des frais réduits — ou zéro. »

**Onboarding légal (Atelier, skip) :** « Tu n'as pas d'entreprise enregistrée ? Aucun souci, tu peux passer cette étape. »
**Onboarding légal (Maison, requis) :** « Ton commerce vend à grande échelle. La loi québécoise nous demande ton NEQ et tes numéros de taxes. »

**Abonnement récap :** « Tu paies 79 $/mois. Tes acheteurs ne paient aucun frais. C'est ton argument de vente. »

**États d'échec :**
- Stripe incomplet : « Finalise ton compte de paiement pour ouvrir ta boutique. »
- Carte refusée : « Le paiement de ton abonnement n'a pas abouti. Réessaie pour activer ta boutique. »
- Rejet admin : « Ta boutique n'a pas pu être validée. Voici pourquoi : [raison]. Corrige et resoumets — tu ne seras pas facturé tant qu'elle n'est pas approuvée. »
- Cap atteint : « Tu as atteint la limite de ton forfait (100 articles). Passe au Comptoir pour en publier 500. »
- Downgrade : « En repassant à L'Atelier, X articles seront mis en pause. Les plus récents restent en ligne. »

**Badge acheteur (article d'une boutique Maison) :** « 0 frais d'achat »

---

## 8. Liens avec l'existant & implications backend

> J'**identifie** les implications backend (fee-par-shop + abonnement Stripe), je ne les **conçois pas** — c'est le périmètre de `firebase-backend`.

### Modèle de données

- **Étendre `Shop`** (types/index.ts L401) avec un sous-objet `subscription` :
  ```
  subscription?: {
    tier: 'atelier' | 'comptoir' | 'maison';
    status: 'active' | 'past_due' | 'canceled' | 'trialing';
    stripeSubscriptionId: string;
    stripeCustomerId: string;
    currentPeriodEnd: Date;
    interval: 'month' | 'year';
  }
  ```
- **`ShopTier`** type + table de mapping tier → barème de frais (`{ percent, fixed, min }`), source de vérité unique côté functions.

### ⚠️ Gap critique repéré : `shopId` sur les articles

`ShopService.getShopArticles` (shopService.ts L373) requête `where('shopId', '==', shopId)`, **mais l'interface `Article` (types/index.ts L88-127) ne contient pas `shopId`** — seulement `sellerId`. Pour keyer les frais par boutique au checkout, il faut un lien fiable article→boutique. Deux options (arbitrage backend) :
1. **Dénormaliser `shopId` (+ `shopTier`) sur chaque article** à la publication/mise à jour. Plus rapide à lire (pas de lookup au checkout), mais doit être resynchronisé sur changement de palier.
2. **Résoudre via `sellerId → shop` au checkout** (un read Firestore supplémentaire dans `createTransaction`/`createStripeCheckout`). Pas de dénormalisation, mais un read de plus par transaction.

→ À trancher par `firebase-backend`. La dénormalisation est probablement préférable pour la perf de feed/recherche (le filtre « 0 frais » et le badge article en dépendent aussi).

### Implication 1 — Fee calc keyé sur le shop (cœur de la décision monétisation)

Le barème de frais doit devenir fonction du **palier de la boutique de l'article**, là où il est calculé serveur :
- `functions/src/utils/fees.ts` : `calculateFees` / `calculateServiceFee` / `getServiceFeeConfig` doivent accepter un **paramètre de barème** (ou un `tier`) au lieu des constantes globales `BUYER_FEE_PERCENT/FIXED/MIN`.
- `functions/src/callable/payments.ts` : les 4 points d'appel (L288 `createTransaction`, L423 + L434 `createStripeCheckout`, L136 `getServiceFee` pour l'affichage client) doivent résoudre le palier (via `shopId`/`shopTier`) et passer le bon barème. `application_fee_amount` (L544) suit automatiquement (devient 0 pour Maison → destination charge sans application fee, le vendeur touche tout, Second touche 0 sur la transaction).
- **`getServiceFee`** (callable d'affichage) doit prendre `articleId`/`shopId` pour que l'app affiche les frais corrects **avant** achat (article detail, checkout preview).
- Garde-fou : si une boutique Maison voit son abonnement `canceled`, le barème **doit** retomber sur le standard immédiatement (lecture du `subscription.status` au moment du calcul, jamais une valeur cachée).

### Implication 2 — Abonnement Stripe (récurrent, distinct des destination charges)

- Nouveau périmètre Stripe **Billing/Subscriptions** (à ne pas confondre avec Connect destination charges utilisées pour les ventes) :
  - Créer un **Stripe Customer** pour le propriétaire de boutique.
  - **Products + Prices** Stripe pour les 6 SKU (3 paliers × {mensuel, annuel}).
  - Callables : `createShopSubscription`, `updateShopSubscription` (upgrade/downgrade proratisé), `cancelShopSubscription`, `getShopSubscriptionStatus`.
  - **Webhook** : étendre `functions/src/http/webhooks.ts` (`stripeWebhook`) pour gérer `customer.subscription.created/updated/deleted`, `invoice.paid`, `invoice.payment_failed` → synchroniser `shops/{id}.subscription.status`. Signature à vérifier (`STRIPE_WEBHOOK_SECRET` déjà en Secret Manager).
  - Région `northamerica-northeast1`, Functions v2.
- **Billing portal** Stripe pour la gestion self-service depuis le dashboard.

### Implication 3 — Sécurité & rules

- `firestore.rules` : le champ `shops/{id}.subscription` n'est **modifiable que par Cloud Function** (jamais client) — sinon une boutique pourrait s'auto-attribuer le palier Maison et annuler les frais acheteur (privilege escalation directe sur le revenu). À auditer par `firebase-backend`.
- `shopId`/`shopTier` sur articles : écriture serveur uniquement (sinon contournement du barème).

### Implication 4 — Visibilité (curation serveur)

- `getFeaturedSellers` et la logique de tri discover/recherche doivent intégrer le `tierWeight`. Indexes Firestore probables : `shops` sur `(status, subscription.tier)` ; `articles` sur `(shopId, isActive, isSold)` (déjà requêté) et éventuellement `(shopTier, isActive, isSold, createdAt)` pour le filtre « 0 frais ». À déclarer dans `firestore.indexes.json`.

### Réutilisation directe (aucun nouveau composant lourd)

`createStripeConnectAccount`, `getStripeAccountStatus`, `settings/stripe-onboarding` (paiement vendeur) · `ShopService.createShop/updateShop/approveShop/rejectShop` (CRUD + validation) · `/admin/shops` + `ShopValidationCard` (file de validation) · `ShopCard`/`ShopMap`/`/shop/[id]` (vitrine) · notifications `shop_approved`/`shop_rejected` (existantes) · pattern ledger `wallet` (historique facturation).

---

## Arbitrages à valider

1. **Prix exacts** : 9 / 29 / 79 $/mois — proposés fermes. Le palier Maison à 79 $ suppose qu'une boutique « 0 frais » fait assez de volume pour que Second y gagne vs. les frais transactionnels perdus. À calibrer sur le panier moyen réel (combien de ventes/mois rentabilisent 79 $ de frais offerts ?).
2. **Barème intermédiaire** : `2,5 % + 0,75 $` au Comptoir — moitié du standard. À valider (alternative : `3 % + 1,00 $`).
3. **`shopId` sur articles** : dénormaliser (perf) **vs** résoudre via `sellerId` au checkout (simplicité). Décision data-model à confirmer avec `firebase-backend` — bloquant pour le fee-par-shop.
4. **Un compte = une boutique** au lancement, ou multi-boutiques d'emblée ? (impacte le modèle `Shop`/`subscription`).
5. **Essai gratuit** : proposer un trial (ex. 14 j ou 1er mois) sur le Comptoir/Maison pour amorcer la conversion ? Non inclus dans la grille actuelle.
6. **Frais acheteur réduits = baisse de revenu** : au lancement, à volume faible, l'abonnement peut ne pas compenser les frais perdus sur les grosses boutiques. Politique de transition / seuil minimal de ventes à définir.
7. **Légal Atelier** : NEQ vraiment optionnel pour un particulier qui vend beaucoup ? Risque fiscal/IRCC à faire confirmer. Seuil de ventes au-delà duquel on **force** l'upgrade vers un palier avec NEQ ?
8. **Sort des articles au downgrade/cancel** : mise en pause des plus anciens (proposé) vs. blocage de nouvelles publications uniquement. À trancher pour l'UX.
9. **`application_fee` à 0 (Maison)** : confirmer que Stripe destination charge sans `application_fee_amount` est le comportement voulu (Second ne prélève rien sur la transaction, se paie seulement sur l'abonnement).
