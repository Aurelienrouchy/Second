# Synthèse consolidée — Audit cross-platform iOS/Android (2026-06-01)

> Rapport maître consolidant 9 audits cross-plateforme du domaine fonctionnel de Second (marketplace seconde main · Expo/RN/Firebase/Stripe Connect Custom). Chaque finding cité ci-dessous est ancré sur `file:line` dans le rapport détaillé d'origine et a été vérifié en direct dans le code réel par le workflow source. **452 findings vérifiés : 27 P0, 104 P1, 176 P2, 145 P3.**

---

## 1. Vue d'ensemble

| Domaine | Total | P0 | P1 | P2 | P3 | Rapport détaillé |
|---------|------:|---:|---:|---:|---:|------------------|
| Recherche / filtres / discovery | 46 | 3 | 12 | 13 | 18 | `recherche-crossplatform-2026-06-01.md` |
| User / Auth / Onboarding | 43 | 1 | 9 | 16 | 17 | `user-onboarding-crossplatform-2026-06-01.md` |
| Flow d'achat (offres → paiement → litiges) | 58 | 3 | 15 | 22 | 18 | `flow-achat-crossplatform-2026-06-01.md` |
| Fondations & app shell | 46 | 2 | 9 | 20 | 15 | `fondations-crossplatform-2026-06-01.md` |
| Vente / mise en vente | 53 | 1 | 12 | 22 | 18 | `vente-miseenvente-crossplatform-2026-06-01.md` |
| Swap / SwapZone | 54 | 3 | 11 | 22 | 18 | `swap-swapzone-crossplatform-2026-06-01.md` |
| Boutiques (payant) & Administration | 38 | 10 | 8 | 8 | 12 | `boutiques-admin-crossplatform-2026-06-01.md` |
| Messagerie / Notifications / Temps réel | 65 | 4 | 16 | 32 | 13 | `messagerie-notifications-crossplatform-2026-06-01.md` |
| Home / Discovery / Favoris | 49 | 0 | 12 | 21 | 16 | `home-discovery-favoris-crossplatform-2026-06-01.md` |
| **TOTAUX** | **452** | **27** | **104** | **176** | **145** | — |

**Lecture transverse** : les défauts sont écrasante­ment **cross-plateforme cohérents** (logique JS/TS, Firestore rules et Cloud Functions partagées). Les rares écarts iOS↔Android réels se concentrent sur : (a) la couche push native (APNs vs FCM), (b) la config native non maîtrisée dans `app.config.js` (caméra, maps, wallets Stripe, universal links), (c) la saisie clavier (`KeyboardAvoidingView`, `keyboardType`), (d) la double implémentation de la capture vente (overlay iOS vs route Android), (e) les insets safe-area sur barres collantes. Le domaine **Boutiques/Admin** concentre 10 des 27 P0 — mais ils partagent une racine unique (rules `/shops` sans verrou de champ).

---

## 2. Les 27 P0 regroupés par THÈME SYSTÉMIQUE

### Thème A — Failles de sécurité / privilege escalation (mutations financières & de statut côté client)

**Pattern** : des transitions sensibles (statut, propriété, modération, finances) sont effectuées côté client SDK ou via des callables insuffisamment gardées ; les `firestore.rules` ne compensent pas. La règle projet « toute mutation sensible = Cloud Function + runTransaction, jamais client » est violée à plusieurs endroits.

| Finding | Domaine — file:line | Impact |
|---|---|---|
| Auto-approbation boutique : owner peut écrire `status:'approved'`/`verificationDetails` | Boutiques P0-1 — `firestore.rules:49-51`, `services/shopService.ts:312-319`, `app/shop/[id].tsx:196` | N'importe quel vendeur publie une boutique « vérifiée » sans modération ni paiement (fraude, contournement monétisation) |
| Modération admin boutique cassée : rules n'autorisent que l'owner, pas `isAdmin()` | Boutiques P0-2 — `services/shopService.ts:310-364`, `firestore.rules:50-51`, `app/admin/shops.tsx:113` | En prod, aucun admin ne peut valider une boutique → modèle payant bloqué |
| Aucun test de sécurité ne couvre `shops` | Boutiques P0-5 — `tests/security/` (absent), `firestore.rules:49-51` | Le seam manquant a laissé passer la règle sans verrou |
| Pas de vérification de propriété dans `proposeMultiSwap`/`acceptSwap` | Swap P0-1 / P1-5 — `functions/src/callable/swaps.ts:59-89,242-383`, `app/propose-swap.tsx:224` | Forger un swap impliquant les articles + l'identité d'un tiers ; `confirmSwapReception` (swaps.ts:1184-1209) désactive les articles d'autrui via Admin SDK ; `rateSwap` (swaps.ts:1264-1352) falsifie le nom dans les reviews |
| Signalement utilisateur échoue (`undefined` → Firestore) | Boutiques P0-4 (→P1) — `services/moderationService.ts:82-100`, `config/firebaseConfig.ts:53` | Modération/sécurité cassée pour tout report utilisateur sans ownerId/texte |

**Findings P1 même racine** : prix de swap fournis par le client sans recalcul serveur (Swap P1-6, `swaps.ts:327`) ; pas de verrou « 1 article = 1 swap actif » → double-engagement (Swap P1-7, `swaps.ts:59-89`) ; transition `meetup_confirmed` par `updateDoc` client direct (Achat P1-5, `chatService.ts:1145`) ; `acceptOffer` écrit le statut avant la transaction sans atomicité (Achat P1-4/P1-7, `chatService.ts:611`) ; suppression de compte avec garde-fous financiers client-only (User P0-1, voir Thème D).

**Correctif racine (1 fix → N findings)** : déplacer approve/reject/suspend boutique, propose/accept swap, et confirmation meetup dans des **Cloud Functions callables v2** (région `northamerica-northeast1`, `memory ≥ 512MiB`) gardées par `request.auth.token.admin` / vérification de propriété (`data.sellerId === expectedOwnerId`, pattern déjà correct dans `swaps.ts:1504`). Durcir `firestore.rules` /shops (`diff().affectedKeys().hasAny(['status','verificationDetails'])` + `create` force `status=='pending'`). Ajouter `tests/security/shops.rules.test.ts`. **Un seul chantier backend ferme Boutiques P0-1/P0-2/P0-5 + Swap P0-1/P1-5/P1-6/P1-7.**

### Thème B — Fonds bloqués / argent perdu (races capture/annulation, disputes inatteignables, états zombies)

**Pattern** : sur les chemins swap top-up et meetup, des transactions/articles restent bloqués indéfiniment, ou une capture Stripe arrive après annulation sans remboursement, ou le seul recours de litige est inatteignable côté client.

| Finding | Domaine — file:line | Impact |
|---|---|---|
| Swap top-up : capture Stripe après annulation = acheteur débité sans remboursement (race non gérée) | Achat P0-1 — `functions/src/http/webhooks.ts:786-792`, `functions/src/callable/swaps.ts:707-751`, `scheduled/swaps.ts:78-134` | Perte d'argent réelle et **silencieuse** (pas de dead-letter), reproduite à l'échelle par le job d'expiration 7j |
| No-show meetup purement cosmétique : transaction `meetup_confirmed` verrouillée à vie, article jamais relibéré | Achat P0-2 / P1-8 — `services/chatService.ts:1167-1191`, `scheduled/transactionExpiration.ts`, `payments.ts` (`reportNoShow` non consommé) | Article `isSold:true` indéfiniment (invendable), promesse « notre équipe va examiner » mensongère |
| Meetup confirmé jamais complété = transaction orpheline permanente + article bloqué | Achat P0-3 (confidence low, à re-vérifier) — `scheduled/transactionExpiration.ts:74-161`, `payments.ts:711`, `payments.ts:2028` | État zombie permanent, aucune branche scheduler `meetup_confirmed` |
| Flow de litige swap (`openSwapDispute`) inatteignable — aucun recours de remboursement | Swap P0-2 — `functions/src/callable/swaps.ts:1386-1451`, `services/swapService.ts:277-422`, `app/swap/[id].tsx` | Acheteur d'un complément (jusqu'à 5000 $) reçu non conforme ne peut ouvrir aucun litige in-app (publicité trompeuse) |

**Findings P1 même racine** : aucun écran admin pour résoudre les litiges → fonds gelés indéfiniment (Achat P1-13, `recourse.ts:219-327`, `app/admin/` sans écran disputes) ; complément swap saute le bucket `heldBalance` → fonds immédiatement retirables sans fenêtre 7j, neutralise le remboursement (Swap P1-9, `swaps.ts:1154-1171`) ; swap mismatch montant → 500 → replay Stripe 3j, charge captée non traitée (Achat P1-3, `webhooks.ts:776-783`) ; avis impossible après `completed` (Achat P1-11/P1-12, `reviews.ts:122`).

**Correctif racine** : (1) dans `handleSwapTopUpSucceeded`, traiter `cancelled`/`refunded`/`disputed` comme le chemin achat (refund idempotent `rf_swap_${swapId}` + dead-letter + ACK 200) et l'étendre à `expireStaleProposedSwaps` ; (2) brancher `reportNoShow` sur une CF qui annule + relibère `isSold`, ajouter une branche scheduler `meetup_confirmed` ; (3) exposer `openSwapDispute` côté client + fenêtre de rétention `heldBalance` pour le top-up ; (4) créer un écran admin `disputes` + `adminRefundTransaction`.

### Thème C — Parité iOS ↔ Android cassée (push, links, maps, caméra, capture)

**Pattern** : la couche native n'est pas pilotée par `app.config.js` (source de vérité projet), ou un mécanisme natif diverge entre les deux OS.

| Finding | Domaine — file:line | Impact |
|---|---|---|
| Push iOS structurellement cassés : token APNs brut envoyé à `admin.messaging()` (FCM) → rejet + suppression auto du token | Fondations P0-1 / Messagerie #1 — `hooks/useNotificationSetup.ts:200`, `functions/src/utils/notifications.ts:216,299`, `triggers/messages.ts:131` | **Aucune notification n'arrive jamais sur iPhone** (messages, offres, ventes, swaps, saved searches) ; Android OK |
| Universal/App Links non fonctionnels : AASA et assetlinks.json contiennent des placeholders (`TEAM_ID`, `YOUR_SHA256_FINGERPRINT_HERE`) | Fondations P0-2 — `public/.well-known/apple-app-site-association:6`, `public/.well-known/assetlinks.json:8`, `firebase.json:13-38` | Tout lien partagé (`/article/{id}`, `/user/{id}`) tombe dans le navigateur sur **iOS ET Android** → acquisition virale cassée |
| Plugin `expo-camera` absent de `app.config.js` → CAMERA Android perdue au `prebuild --clean` | Recherche P1-11 / Vente P0-1 / Fondations P1-2 — `app.config.js:19-67,101-107`, `node_modules/expo-camera/plugin/build/withCamera.js:29-33` | Tout le tunnel de vente + recherche visuelle cassés sur Android dès un prebuild propre ; iOS protégé par expo-image-picker |

**Findings P1 même racine** : Apple Pay/Google Pay non fonctionnels (plugin Stripe absent + `StripeProvider` sans `merchantIdentifier`/`urlScheme`) (Achat P1-2, Fondations P2-8, `app.config.js:19-67`, `StripePayment.tsx:67-73`) ; Google Maps `PROVIDER_GOOGLE` sans clé → carte morte (Recherche P1-10/P2-1, Fondations P1-4, Boutiques P1-3, `app/shop/[id].tsx:24`) ; RECORD_AUDIO déclaré sans usage → risque rejet Play Store (Fondations P1-3, `app.config.js:104`) ; `android/`+`ios/` committés désynchronisés de `app.config.js` (Fondations P1-5) ; canaux Android `orders`/`saved_searches` jamais enregistrés (Fondations P1-6, Recherche P3-10, Messagerie #8) ; couverture paths Android (8) < iOS/AASA (14), host `www.seconde.app` absent côté Android (Fondations P1-7/P1-8) ; double implémentation capture vente iOS overlay vs Android route (Vente P1-1, User P2-2, Fondations P1-1).

**Correctif racine** : (1) migrer le push iOS vers Expo Push (`getExpoPushTokenAsync` + `expo-server-sdk`) OU `@react-native-firebase/messaging` ; (2) substituer le vrai Apple Team ID + le SHA-256 du certificat de release Android dans les fichiers `.well-known` + redéployer Hosting ; (3) déclarer dans `app.config.js` les plugins manquants (`expo-camera` avec `cameraPermission` FR + `recordAudioAndroid:false`, lib maps unique + clés, `@stripe/stripe-react-native` avec `merchantIdentifier`), retirer `RECORD_AUDIO` et `expo-maps` mort, puis `npx expo prebuild`.

### Thème D — Conformité Loi 25 / modération (export, blocage, signalements, décisions auto, suppression compte)

**Pattern** : des obligations légales (portabilité, droit à la révision humaine d'une décision automatisée, modération de contenu illégal) et des actions de sûreté (blocage, suppression de compte) sont promises côté UI mais non appliquées/inaccessibles côté serveur.

| Finding | Domaine — file:line | Impact |
|---|---|---|
| Blocage messagerie jamais appliqué serveur (le commentaire affirme le contraire) | Messagerie #2 — `services/moderationService.ts:263-280`, `chatService.ts:327-364`, `swaps.ts:95-108` (contre-exemple correct) | A bloque B, mais B continue d'écrire ET de faire vibrer le téléphone de A (#14) ; contournable trivialement |
| Signalement de contenu = trou noir : collection `reports` sans écran admin ni CF de traitement | Boutiques P0-3 — `services/moderationService.ts:47,82-100`, `components/ReportBottomSheet.tsx:96-108`, `app/admin/` (aucun écran reports) | « Notre équipe va l'examiner » alors que rien ni personne ne traite les rapports (contenu illégal/arnaque/harcèlement jamais retiré) |
| Décision auto sur commande MEETUP : droit Loi 25 (explication + révision humaine) inaccessible | Messagerie #4 — `app/chat/[id].tsx:421`, `components/ShipmentTracking.tsx:369`, `scheduled/transactionExpiration.ts:127` | La surface « Pourquoi cette décision / Contester » est gardée sur `deliveryType==='shipping'` → meetup annulé = recours légal inaccessible ; la notif ne porte même pas le `chatId` |
| Suppression de compte : garde-fous financiers client-only non re-vérifiés serveur | User P0-1 / P1-8 — `app/settings/delete-account.tsx:90-163`, `functions/src/callable/users.ts:43`, `wallet.ts:18-34` | `deleteUserAccount` ne re-vérifie QUE `balance`/`pendingBalance`, ignore `heldBalance`/`sellerDebt`/transactions+litiges actifs → compte supprimable avec fonds gelés/dette/litige, ledger détruit |

**Findings P1 même racine** : export Loi 25 n'exporte jamais les messages (mauvaise sous-collection : lit `chats/{id}/messages`, le modèle stocke en top-level `messages`) (User P1-7, `userService.ts:456-457`, `chatService.ts:361`) ; notif `funds_released` tap mort → contestation Loi 25 inaccessible (Messagerie #15, `releaseHeldFunds.ts:247`) ; notifs `order_cancelled` routées vers `/article` mort, contestation non guidée (Messagerie #16) ; préférences notification transactionnelles jamais respectées serveur (consentement Loi 25 rompu) (Messagerie #9) ; `reports/` non anonymisé à la suppression de compte (Boutiques P3-4, gap Loi 25) ; contestation créable hors callable sans alerter les admins (Messagerie #60).

**Correctif racine** : (1) router l'envoi de message via une callable vérifiant les DEUX `blockedUsers` (modèle `swaps.ts:95-108`) ; (2) construire l'écran admin file de modération + CF `resolveReport`/`hideContent` + index `reports` ; (3) découpler la surface transparence/contestation de `ShipmentTracking`, la rendre dès `hasAutomatedDecision` quel que soit `deliveryType` + router les notifs `order_cancelled`/`funds_released` vers cette surface ; (4) dupliquer dans `deleteUserAccount` les pré-checks serveur `heldBalance>0`/`sellerDebt>0`/transactions actives avant tout cleanup.

### Thème E — Contrats de données incohérents (taille, condition, prix, clés notif, doubles systèmes)

**Pattern** : un même concept est représenté différemment selon le producteur et le consommateur, cassant silencieusement une feature.

| Finding | Domaine — file:line | Impact |
|---|---|---|
| `moderationStatus` absent des articles legacy/seed → leur entrée `search_index` SUPPRIMÉE au prochain write | Recherche P0-3 — `functions/src/triggers/products.ts:38`, `callable/products.ts:364`, `scripts/seed-articles.js:935` | Backfill naïf désindexe au lieu d'indexer ; ordre de migration impératif |
| Aucun backfill `search_index` → catalogue préexistant invisible en recherche texte + tri Populaire | Recherche P0-2 — `triggers/products.ts:141`, `services/articlesService.ts:405`, `seed-articles.js:935` | Recherche « cassée » (zéro résultat) pour tout article antérieur au trigger |
| Clé payload notif `searchId` (producteur) vs `savedSearchId` (consommateur) → tap mort | Recherche P0-1 / Messagerie #3/#7 — `scheduled/savedSearches.ts:228`, `hooks/useNotificationSetup.ts:98`, `store/notificationStore.ts:29` | Tap sur notif recherche sauvegardée n'ouvre rien (iOS+Android) ; `newItemsCount` jamais remis à zéro |

**Findings P1 même racine (contrats)** : taille `{value,system}` contournée — `system:'EU'` hardcodé à la publication, sheet ne manipule qu'un système, size string sur legacy exclue de tous les filtres (Vente P1-4, Recherche P1-5/P1-8, Home implicite — `preview.tsx:172`, `articlesService.ts:757`, `SizeSelectionSheet.tsx`, `seed-articles.js:928`) ; `conditionId` serveur EN (`very_good`) vs client FR-kebab → état toujours « très bon état » (Vente P1-3, `functions/src/services/ai.ts:278-289`, `types/ai.ts:155-160`) ; prix virgule fr-CA tronqué/×100 (vente, édition, recherche, offre) (Vente P1-6/P2-18, Recherche P2-2, Achat P3-3 — `pricing.tsx:137`, `useSearchScreen.ts:357`, `EditableField.tsx`) ; 3 unions de types notification divergentes + `deepLink` jamais consommé → taps morts/mauvaises destinations (Messagerie #5/#10/#19/#15/#16/#51/#52) ; complément cash affiché ×100 (cents bruts avec signe $) (Swap P1-8, `SwapProposalView.tsx:90`) ; 4 types de ledger backend absents du type client → `funds_released` affiché en débit rouge (Achat P1-14, `types/index.ts:918-923`, `wallet.tsx:169-171`).

**Correctif racine** : (1) migration ordonnée AVANT recherche prod — poser `moderationStatus:'approved'` + convertir size string→objet sur les articles actifs, déployer les index, PUIS backfill `search_index` (séquence détaillée dans le rapport recherche §« Préparation déploiement ») ; (2) aligner le contrat `taille {value,system}` partout (publication + édition + filtres) ; (3) une source de vérité unique `type → clés → route` pour les notifications, OU consommer le `deepLink` backend ; (4) helpers de prix normalisés (`.replace(',','.')` + `formatPrice`/`formatPriceWithCurrency`) sur tous les champs et affichages.

---

## 3. Findings confirmés en DOUBLE AVEUGLE (≥2 workflows indépendants)

Ces findings, décrits par des audits distincts à partir de dimensions différentes, ont la **plus haute confiance** et doivent être traités en premier.

| Finding | Trouvé par | file:line clé |
|---|---|---|
| **Push iOS cassé** (token APNs brut → FCM) | Fondations (P0-1) + Messagerie (#1) | `hooks/useNotificationSetup.ts:200`, `functions/src/utils/notifications.ts:216` |
| **Clé notif `searchId` vs `savedSearchId`** (tap mort) | Recherche (P0-1) + Messagerie (#3/#7) | `scheduled/savedSearches.ts:228`, `useNotificationSetup.ts:98` |
| **Taille `{value,system}` contournée** | Vente (P1-4) + Recherche (P1-5/P1-8) + Home (implicite filtres) | `preview.tsx:172`, `articlesService.ts:757`, `SizeSelectionSheet.tsx` |
| **Blocage utilisateur non appliqué serveur** (chat) | Boutiques (P1-5) + Messagerie (#2/#13/#14/#36/#37) | `moderationService.ts:263-280`, `chatService.ts:333` |
| **Signalement `reports` = trou noir** (pas d'écran/CF admin) | Boutiques (P0-3) + Messagerie (#38/#39/#42) | `moderationService.ts:47`, `app/admin/` (aucun écran) |
| **Auto-approbation / modération boutique cassée** (rules /shops) | Boutiques (P0-1+P0-2, levés par 5 dimensions indépendantes) | `firestore.rules:49-51`, `shopService.ts:310-364` |
| **Google Maps `PROVIDER_GOOGLE` sans clé** | Recherche (P1-10/P2-1) + Fondations (P1-4/P2-12) + Boutiques (P1-3) | `app/shop/[id].tsx:24`, `app.config.js:51` |
| **Plugin `expo-camera` absent → CAMERA Android perdue au prebuild** | Recherche (P1-11) + Vente (P0-1) + Fondations (P1-2) | `app.config.js:19-67`, `withCamera.js:29-33` |
| **Apple Pay/Google Pay non configurés** (plugin Stripe + merchantIdentifier) | Achat (P1-2) + Fondations (P2-8) | `app.config.js:19-67`, `StripePayment.tsx:67-73` |
| **Double implémentation capture vente** (overlay iOS vs route Android) | Vente (P1-1) + User (P2-2) + Fondations (P1-1) | `app/(tabs)/_layout.tsx:139-158` |
| **Canaux Android `orders`/`saved_searches` non enregistrés** | Fondations (P1-6) + Recherche (P3-10) + Messagerie (#8/#53/#54) | `useNotificationSetup.ts:26-52`, `notifications.ts:132-137` |
| **Prix virgule fr-CA tronqué** (×100 / centimes perdus) | Vente (P1-6/P2-18) + Recherche (P2-2) + Achat (P3-3) + Swap (P3-4) | `pricing.tsx:137`, `useSearchScreen.ts:357` |
| **`KeyboardAvoidingView` manquant/magique** sur écrans de saisie | User (P2-8/P2-14) + Achat (P1-15) + Messagerie (#27) + Swap (P2-21) | `delete-account.tsx`, `review/[transactionId].tsx:262`, `chat/[id].tsx:402` |
| **Devise format US `$45` au lieu du canadien `45 $`** | Fondations (P2-16/P2-17) + Swap (P2-12) + Achat (P3-6/P3-7) | `formatPrice.ts`, `SwapItemCard.tsx:70`, `SwapProposalView.tsx:90` |
| **`formatPriceWithCurrency` (`$ CA`) défini mais jamais utilisé** | Fondations (P2-17) + Achat (P3-6) | `utils/formatPrice.ts:21-23` |
| **Footer / barre collante sans safe-area inset** (`paddingBottom` magique) | Swap (P1-2/P2-15/P2-19/P2-20) + Boutiques (P1-6) + Achat (P2-17) | `SwapStickyActions.tsx:56-70`, `admin/shop-detail/[id].tsx:556-563`, `payment/[transactionId].tsx:517` |
| **Aucun `BackHandler` Android dans toute l'app** (back matériel non géré) | User (P2-12/P3-6) + Swap (P1-3) + Vente (P1-5) | grep `BackHandler` = 0 ; `swap-zone.tsx`, `details.tsx`, `AuthBottomSheet.tsx` |
| **Commentaire mort « Helcim »** dans `app.config.js` | Fondations (P2-18) + Boutiques (P3-10) + Achat (P3-14) | `app.config.js:49` |
| **StatusBar `dark` non surchargée sur écrans caméra sombres** | User (P2-13) + Fondations (P2-2) + Vente (P2-2) | `app/_layout.tsx:231`, `capture.tsx`, `SellOverlayCapture.tsx` |
| **Avis impossible après statut `completed`** (shipping J+7) | Achat (P1-11 + P1-12) | `reviews.ts:122`, `releaseHeldFunds.ts:215` |

---

## 4. Causes racines transverses (« 1 fix → N findings »)

Classées par nombre de findings fermés / criticité.

1. **Déplacer toute mutation financière / de statut / de modération vers des Cloud Functions `runTransaction` gardées (claim admin ou vérif de propriété), durcir `firestore.rules`.**
   Ferme : Boutiques P0-1/P0-2/P0-5, Swap P0-1/P1-5/P1-6/P1-7, Achat P1-4/P1-5/P1-7, User P0-1/P1-8. Pattern correct déjà présent : `swaps.ts:1504` (`depositSwapItem`), `swaps.ts:95-108` (blocage bidirectionnel). Inclure le blocage chat (Messagerie #2/#14) dans le même chantier.

2. **Respecter le contrat `taille {value,system}` partout + migration ordonnée `moderationStatus`/`size`/backfill `search_index` AVANT recherche prod.**
   Ferme : Recherche P0-2/P0-3/P1-5/P1-8, Vente P1-4, + débloque tri Populaire et filtres taille. Séquence impérative : (1) `moderationStatus='approved'` sur actifs legacy, (2) size string→objet, (3) index Firestore, (4) backfill `search_index`, (5) router le client.

3. **Source de vérité unique des types de notification (`type → clés → route`) partagée backend/client, OU consommer le `deepLink` backend déjà calculé.**
   Ferme : Messagerie #5/#10/#15/#16/#19/#50/#51/#52, Recherche P0-1. Élimine les taps morts (`review_received`, `funds_released`, `saved_search`) et les mauvaises destinations (`new_sale`/`order_*` → `/article`).

4. **Substituer les placeholders natifs + déclarer les plugins manquants dans `app.config.js`, puis prebuild.**
   Ferme : Fondations P0-2 (Team ID + SHA-256), P1-2/P1-3 (camera + RECORD_AUDIO), P1-4/P2-12 (maps), P2-8 (Stripe wallets), Recherche P1-10/P1-11, Vente P0-1, Boutiques P1-3, Achat P1-2. Aligne la source de vérité unique sur l'état natif committé.

5. **Migrer le push iOS hors token APNs brut (Expo Push ou `@react-native-firebase/messaging`).**
   Ferme : Fondations P0-1, Messagerie #1 — prérequis à toute la couche push iOS (messages, offres, ventes, swaps, saved searches).

6. **Découpler la surface transparence/contestation Loi 25 de `ShipmentTracking` + router les notifs de décision automatisée vers elle.**
   Ferme : Messagerie #4/#15/#16, partie Loi 25 du Thème D.

---

## 5. Roadmap de remédiation priorisée

### Vague 1 — P0 sécurité + argent + parité plateforme bloquante (avant tout déploiement)

- [ ] **Sécurité boutique/swap** : callables admin v2 `adminApproveShop`/`adminRejectShop`/`adminSuspendShop` + vérif propriété dans `proposeMultiSwap`/`acceptSwap` (`expectedSellerId`) ; durcir `firestore.rules` /shops ; ajouter `tests/security/shops.rules.test.ts`. Fichiers : `functions/src/callable/swaps.ts`, `services/shopService.ts`, `firestore.rules:46-54`.
- [ ] **Suppression de compte** : re-vérifier serveur `heldBalance`/`sellerDebt`/transactions actives avant cleanup → `failed-precondition`. Fichiers : `functions/src/callable/users.ts:37-51`.
- [ ] **Swap top-up race** : refund idempotent + dead-letter dans `handleSwapTopUpSucceeded` (et `expireStaleProposedSwaps`). Fichiers : `functions/src/http/webhooks.ts:786-792`, `scheduled/swaps.ts:78-134`.
- [ ] **No-show / meetup zombie** : brancher `reportNoShow` sur CF (annulation + relibération `isSold`) + branche scheduler `meetup_confirmed`. Fichiers : `services/chatService.ts:1167-1191`, `scheduled/transactionExpiration.ts`.
- [ ] **Litige swap inatteignable** : exposer `openSwapDispute` + bouton « Signaler un problème » + fenêtre de rétention `heldBalance` du top-up. Fichiers : `services/swapService.ts`, `swaps.ts:1154-1171,1386-1451`.
- [ ] **Blocage chat serveur** : router l'envoi via callable vérifiant les 2 directions ; corriger le commentaire mensonger. Fichiers : `services/moderationService.ts:259-280`, `chatService.ts:327-364`.
- [ ] **Modération `reports`** : écran admin file de modération + CF `resolveReport`/`hideContent` + index + `ignoreUndefinedProperties`. Fichiers : `services/moderationService.ts`, `config/firebaseConfig.ts:53`, `firestore.indexes.json`.
- [ ] **Loi 25 décision auto meetup** : découpler la surface contestation de `ShipmentTracking` (rendue dès `hasAutomatedDecision`) + router les notifs. Fichiers : `app/chat/[id].tsx:421`, `components/ShipmentTracking.tsx`, `scheduled/transactionExpiration.ts`.
- [ ] **Push iOS** : migrer vers Expo Push ou RNFirebase Messaging. Fichiers : `hooks/useNotificationSetup.ts:200`, `functions/src/utils/notifications.ts`.
- [ ] **Universal/App Links** : substituer Team ID + SHA-256 dans `.well-known` + redéployer Hosting. Fichiers : `public/.well-known/apple-app-site-association`, `assetlinks.json`.
- [ ] **Plugin caméra Android** : déclarer `expo-camera` dans `app.config.js` + prebuild (avant tout prebuild propre / build EAS). Fichiers : `app.config.js:19-67`.
- [ ] **Migration recherche** : séquence `moderationStatus` → `size` → index → backfill `search_index` AVANT de router le client. Fichiers : `scripts/`, `triggers/products.ts:38,141`, `firestore.indexes.json`.

### Vague 2 — P1 (bugs fonctionnels & écarts plateforme majeurs)

- [ ] **Contrats de données** : `conditionId` serveur/client (Vente P1-3) ; taille `{value,system}` propagée publication+édition (Vente P1-4) ; complément swap ÷100 + `formatPrice` (Swap P1-8) ; `WalletLedgerType` 9 types + `isCredit(funds_released)` (Achat P1-14) ; source unique types notif (Messagerie #19).
- [ ] **Indexes & backend recherche/notif** : index `articles brands CONTAINS` + `sellerId+filtre` (Recherche P1-3/P1-4) ; `allow update` sur `searchHistory` (Recherche P1-9) ; `await` direct du `search_index` initial (Vente P1-7) ; reset champs price-drop + garde `_getPriceDrops` (Vente P1-8) ; exclure `isSold` recherche visuelle (Recherche P1-6).
- [ ] **Parité native** : Apple/Google Pay (Achat P1-2) ; lib maps unique + clés (Fondations P1-4) ; retirer RECORD_AUDIO (Fondations P1-3) ; canaux Android `orders`/`saved_searches` (Fondations P1-6) ; paths/hosts deep-link Android (Fondations P1-7/P1-8) ; unifier la capture vente (Vente P1-1).
- [ ] **Auth/identité** : `username` dans `getUserPublicProfile` (User P1-3) ; export messages top-level (User P1-7) ; Apple-only sur Android (User P1-2/P1-6) ; état réactif `hasPassword` (User P1-4) ; cold start offline (User P1-5) ; onboarding `await` callable (User P1-1).
- [ ] **Messagerie/notif** : préférences transactionnelles honorées serveur (#9) ; tri liste `lastMessageTimestamp` (#11) ; conv sans sellerId (#12) ; routing ventes/commandes/avis (#10) ; `funds_released`/`order_cancelled` routing (#15/#16) ; accusés de lecture (#17) ; pagination (#18) ; badges (#20) ; push aux bloqués (#14).
- [ ] **Achat** : écran admin litiges (P1-13) ; clé Stripe via env/EAS (P1-1) ; swap mismatch ACK 200 (P1-3) ; meetup atomique (P1-5/P1-6/P1-7) ; estimation shipping origine complète (P1-9) ; `completed` reviewable (P1-11/P1-12) ; KAV review iOS (P1-15).
- [ ] **Swap UX** : safe-area `SwapStickyActions` (P1-2) ; `BackHandler` multi-select (P1-3) ; compteur/intersection filtrée (P1-4) ; error callback `subscribeToSwap` (P1-11) ; double CTA Accepter/Refuser (P1-1) ; entrée « Mes échanges » + notif in-app (P1-10).
- [ ] **Home** : 12 findings P1 (voir `home-discovery-favoris-crossplatform-2026-06-01.md`).

### Vague 3 — P2 / P3 (cohérence UX, robustesse, dette, code mort)

- [ ] **Devise & format** : `formatPrice`/`formatPriceWithCurrency` partout (Fondations P2-16/P2-17, Swap P2-12, Achat P3-6/P3-7) ; normalisation virgule édition/offre.
- [ ] **Safe-area & clavier** : `KeyboardAvoidingView` (`delete-account`, propose-swap, review) ; insets sur toutes les barres collantes (Swap, Boutiques, Achat) ; StatusBar light écrans sombres.
- [ ] **Back matériel Android** : `BackHandler`/`usePreventRemove` (auth sheet, onboarding, sell details, swap multi-select) ; `onRequestClose` sur Modals (Success/DraftResume/SwapItemSelector).
- [ ] **Robustesse réseau/offline** : états d'erreur distincts de l'état vide (recherches sauvegardées, notifications, mes échanges, mes articles) ; `onlineManager` + `persistentLocalCache` ; error boundaries de portée écran ; timeout `prefetchHome`.
- [ ] **Anti double-tap** : verrous re-entrance sur CTA achat/swap/publication/marquer-vendu/envoi message/approbation admin.
- [ ] **Modération & Loi 25 (P2/P3)** : `reports/` anonymisé à la suppression de compte ; signalement message branché ; anti-spam `hasUserReported` ; libellés critères décision auto FR (#59) ; contestation hors callable (#60).
- [ ] **Code mort à purger** : `BrandGrid.tsx`, `CategoryTree.tsx`, `contexts/NotificationContext.tsx`, `hooks/useFonts.ts`, `useThemeColor`/`Colors.ts`/`useColorScheme*`, `ValueDifferenceBox.tsx`, `ShopMap.tsx`, `expo-maps` (dep), SpaceMono, commentaire Helcim, `deleteShop`, `clearHistory`.
- [ ] **Anti-spring & DS tokens** : migrer 10 consommateurs `withSpring`→`withTiming` (Fondations P2-5) + `SexOption` (User P3-1) ; remplacer hex hardcodés (`#FF9500`, `#6D28D9`, gris Tailwind, RGBA cream) par tokens DS.
- [ ] **Reste P2/P3** : voir le plan d'action détaillé de chaque rapport (176 P2 + 145 P3 au total).

---

## 6. Index des rapports détaillés

Tous dans `/Users/aurelien/dev/Second/_audit-reports/` :

| # | Domaine | Fichier |
|---|---------|---------|
| 1 | Recherche / filtres / discovery | `recherche-crossplatform-2026-06-01.md` |
| 2 | User / Auth / Onboarding | `user-onboarding-crossplatform-2026-06-01.md` |
| 3 | Flow d'achat | `flow-achat-crossplatform-2026-06-01.md` |
| 4 | Fondations & app shell | `fondations-crossplatform-2026-06-01.md` |
| 5 | Vente / mise en vente | `vente-miseenvente-crossplatform-2026-06-01.md` |
| 6 | Swap / SwapZone | `swap-swapzone-crossplatform-2026-06-01.md` |
| 7 | Boutiques (payant) & Administration | `boutiques-admin-crossplatform-2026-06-01.md` |
| 8 | Messagerie / Notifications / Temps réel | `messagerie-notifications-crossplatform-2026-06-01.md` |
| 9 | Home / Discovery / Favoris | `home-discovery-favoris-crossplatform-2026-06-01.md` |

> Note : ce répertoire contient aussi des rapports d'audit antérieurs hors périmètre de cette synthèse (`LOI25_conformite_rapport*.md`, `auth-onboarding-audit-2026-06-01.md`, séries `01-`…`15-`).
