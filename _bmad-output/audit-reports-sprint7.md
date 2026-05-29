# Rapports d'audit consolidés — Sprint 7

> Générés le 2026-05-27 par 7 agents `ux-logic-auditor` en parallèle.
> Chaque section est un domaine audité. Les findings sont priorisés P0/P1/P2.

---

## Vue d'ensemble des P0 (bloquants)

| # | Domaine | Finding | Impact |
|---|---------|---------|--------|
| W1/W2 | Wallet | Annulation/expiration de transaction ne rembourse pas le wallet | Perte de fonds acheteur |
| W3 | Wallet | Suppression de compte ne nettoie pas `wallets/{uid}` | Violation RGPD/Loi 25 |
| W4 | Wallet | Type `withdrawal_failed` absent du TS et du mapping UI | Crash runtime |
| W8 | Wallet | `payWithWallet` ne crée pas de shipping label ni notification vendeur | Commandes 100% wallet bloquées |
| F1/F2 | Livraison | Transition directe paid→shipped sans action vendeur, pas d'écran vendeur | Vendeur ne sait pas comment expédier |
| F3 | Livraison | Pas de remboursement quand transaction expire (7j) | Perte financière acheteur |
| P-IMG | Produit | Images locales (`file://`) envoyées à Firestore en édition | Liens cassés pour tous |
| P-LOCK | Produit | Pas de verrou transactionnel sur édition d'article | Prix modifiable pendant paiement |
| H-DBL | Headers | Double header sur stripe-onboarding | UX cassée |
| H-MISS | Headers | my-swaps sans aucun header | Pas de bouton retour |
| C1 | Chat/Produit | Article supprimé → ChatArticleBar disparaît mais offre reste possible | Offre sur article inexistant |

---

## 1. Modification produit + réordonnement images

### P0
- **P-IMG** : `app/article/edit/[id].tsx:336` — nouvelles images ajoutées avec URI locale au lieu d'upload Storage
- **P-LOCK** : `functions/src/callable/products.ts:467-715` — `updateArticle` ne vérifie pas les transactions actives (contrairement à `toggleArticleSold:414-428`)

### P1
- **P-REORDER** : Aucun réordonnement d'images en édition (`edit/[id].tsx:443-488`) vs création (`photos-review.tsx:270-278` a `handleMakePrimary`)
- **P-VALID** : Validation formulaire incohérente (prix max, livraison min, titre min) entre création et édition
- **P-CACHE** : Pas d'invalidation React Query après édition (`edit/[id].tsx:271-275` — juste Alert + router.back)
- **P-CLEAR** : Couleurs/matériaux/marque vides non propagés (`edit/[id].tsx:242-250` — envoyés seulement si non-vides)
- **P-DELETE** : `ArticlesService.deleteArticle` fait `updateDoc` direct sans Cloud Function (`articlesService.ts:530-535`)

### P2
- Double-tap non protégé sur boutons sauvegarde/publication
- Écran d'édition monolithique (978 lignes) dupliqué du flow création
- Pas d'avertissement modifications non sauvegardées
- Édition d'articles désactivés non bloquée côté serveur
- Permission galerie non gérée en édition
- Champ brand non effaçable

---

## 2. Architecture chat (par produit vs par personne)

### Architecture actuelle
- Chat ID déterministe par paire : `chatService.ts:92-94` — `[uid1, uid2].sort().join('__')`
- Article context optionnel, set une seule fois à la création
- Si même paire contacte pour article B → retourne chat existant avec contexte article A figé

### Recommandation
Passer au modèle **par article** : chat ID `${uid1}__${uid2}__${articleId}`. Le bouton contact depuis profil crée un chat "général" sans articleId.

### Impacts migration
- Chats existants à migrer
- Split Achats/Ventes (`messages.tsx:78`) fonctionne mieux car chaque chat a un sellerId clair
- `MakeOfferModal` correctement lié à un seul article

---

## 3. Livraison

### P0
- **F3** : `transactionExpiration.ts:160-210` — annule transaction expirée mais AUCUN remboursement Stripe
- **F1/F2** : `webhooks.ts:417-426` — crée étiquette ET marque `shipped` automatiquement au paiement, vendeur jamais informé

### P1
- **F4** : Adresse vendeur = fallback Montréal (`checkout/shipping.tsx:107-112`)
- **F7** : Dimensions/poids identiques pour tous les articles (fallback 0.5kg, 30x25x10)
- **F6** : Status `disputed`/`refunded` absents du type TS (`types/index.ts:243-251`)
- **F5** : Fallback rates (`fallback_standard`) bloquent la transaction sans remboursement
- **F8** : Préférences transporteur vendeur (`settings/shipping-options.tsx`) ignorées par l'API

### P2
- Dead code Intelcom/Shippo (`functions/src/config/intelcom.ts`, `shippo.ts`)
- Pas de validation d'adresse avant paiement
- Pas d'écran détail commande (`/order/[id]` — TODO dans code)
- Type TS `location` = string vs Firestore = objet
- Prix livraison hardcodé "À partir de 8,50$"
- Pas de gestion colis perdu/endommagé
- Polling tracking 6h sans webhook ShipEngine

---

## 4. Wallet / Porte-monnaie

### P0
- **W1/W2** : `cancelPendingTransaction` (`payments.ts:1830-1882`) et `transactionExpiration.ts:156-221` ne remboursent pas le wallet
- **W3** : `deleteUserAccount` (`users.ts`) ne nettoie pas `wallets/{uid}` + `ledger`
- **W4** : `withdrawal_failed` écrit par backend (`wallet.ts:315`) mais absent de `WalletLedgerType` (`types/index.ts:803-807`) et `LEDGER_ICON_MAP` (`wallet.tsx:65-89`)
- **W8** : `payWithWallet` (`wallet.ts:348-536`) ne crée pas de shipping label ni notification vendeur

### P1
- **W5** : Deux écrans wallet coexistent (`/wallet` vs `/seller-balance`) avec systèmes différents
- **W7** : `walletWithdraw` vérifie `stripeChargesEnabled` au lieu de `stripePayoutsEnabled` (`wallet.ts:213-218`)
- **W13** : Fallback seller_balances dans `payWithWallet` hors transaction Firestore (non atomique)
- **FM3** : Pas de webhook `payout.paid`/`payout.failed`

### P2
- Unités dollars/cents mélangées dans le code
- Pas de "Non activé" dans le subtitle profil
- Formulaire bancaire inutile dans seller-balance
- FlashList dans ScrollView (virtualisation désactivée)
- Pas de réconciliation wallet/Stripe
- Pas de freeze/disable wallet

---

## 5. Filtres UI + BottomSheet insets

### P1
- **3 systèmes visuels concurrents** : recherche (sharp/charcoal), SwapZone (pilule/rust), sell (quasi-sharp/charcoal-sage)
- **Filtre "État"** : 3 patterns UX (single select, multi select, cycling touch)
- **CategoryBottomSheet** : design différent (fond crème, handle arrondi, font display)
- **Données couleurs** hardcodées à 3 endroits avec IDs incompatibles (`noir` vs `black`)
- **`withSpring`** dans `SizeChip.tsx` et `CategoryChip.tsx` (violation règle projet)

### BottomSheet footer
- Footer fonctionne "par accident" (même background blanc)
- `paddingBottom: 80` hardcodé ne s'adapte pas à `insets.bottom`
- **Fix** : ajouter `paddingBottom: insets.bottom` au container footer + padding scroll dynamique

### Code mort
- `app/filters.tsx` (DEPRECATED mais route accessible)
- `FilterRow` organism + `FilterChip` atom (jamais importés)

---

## 6. Visualisation produit dans le chat

### P0
- **C1** : Article supprimé → ChatArticleBar disparaît mais bouton offre reste (basé sur snapshot `chat.articleId`)

### P1
- **C2** : Un seul chat par paire → impossible de discuter de plusieurs articles (cf. audit #2)
- **C3** : Contact depuis profil crée chat sans article, jamais rattaché ensuite
- **C5** : Pas de propagation des modifications d'article vers les documents chat
- **C6** : Pas de badge "VENDU" dans ChatArticleBar

### P2
- Prix en dur `$XX.XX` au lieu de `formatPrice()` dans ChatArticleBar/ChatHeader
- Pas de `fixStorageUrl` sur images chat dans liste conversations
- Offres sans mention du nom de l'article

---

## 7. Headers profil/params

### P0
- **H-DBL** : `settings/stripe-onboarding.tsx:379` — double header (natif + ScreenHeader empilés)
- **H-MISS** : `my-swaps.tsx:137` — Stack.Screen options ignorées, aucun header visible

### P1 — 21 pages settings à migrer
Toutes les pages `settings/` utilisent le header natif React Navigation (chevron simple, pas de bordure) au lieu de `ScreenHeader` (cercle 36px, bordure, style DS).

Pages settings à migrer : index, profile-details, email, verify-email, phone, password, add-password, address, preferences, shipping-options, payments, stripe-onboarding, notifications, privacy, blocked-users, export-data, delete-account, help, about, terms, privacy-policy, legal-notice.

### P1 — 3 headers inline ad-hoc
- `liked-sellers.tsx:208-220` — icône `arrow-back` (pas `chevron-back`), font display 22px light
- `shop/[id].tsx:163-171` — chevron 24px sans cercle
- `swap-parties.tsx:152-157` — fond noir, style différent

### P2
- `PersonalizedHeader.tsx` — code mort (238 lignes, jamais importé)
- Texte bouton sauvegarde incohérent ("Enregistrer" vs "Valider")
- Styles `headerButton` non uniformes (fontSize manquant sur certaines pages)
- `ScreenHeader` manque une prop `titleColor` pour le thème dark (swap-parties)
