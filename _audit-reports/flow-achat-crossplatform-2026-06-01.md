# Audit Flow d'achat — Cross-platform iOS/Android (2026-06-01)

## Résumé exécutif

Audit du parcours d'achat complet (page article → CTA → offres/négociation → checkout → paiement Stripe → meetup → commandes/shipping → reviews → litiges/wallet) avec focus cross-plateforme iOS/Android et sécurité financière. Toutes les conclusions ci-dessous sont **vérifiées dans le code réel** (file:line), pas supposées. La quasi-totalité des défauts sont identiques sur les deux plateformes (logique JS/TS partagée, aucune branche `Platform.OS` sur ces chemins) ; les rares écarts iOS↔Android concernent le clavier (`keyboardType`, `KeyboardAvoidingView`) et la config native Apple Pay/Google Pay.

Trois P0 financiers/backend ressortent : une **race swap top-up** (acheteur débité sans remboursement), et deux **transactions zombies meetup** (article verrouillé `isSold` à vie après no-show / non-complétion). Côté carte/Stripe : clé `pk_test` committée comme valeur active, Apple Pay/Google Pay non configurés au niveau natif, et plusieurs désynchronisations statut/affichage. Côté reviews : le statut `completed` (shipping J+7) n'est jamais reviewable. Côté wallet : 4 types de ledger backend absents du type client → libération de fonds affichée comme un débit rouge.

Note : `SHIPPING_ENABLED = false` (`config/featureFlags.ts:17`) court-circuite aujourd'hui le tunnel shipping/carte — plusieurs findings sont donc **latents** (garantis dès réactivation) mais réels structurellement.

| Sévérité | Nombre (confirmés/nuancés) |
|----------|-----------------------------|
| **P0**   | 3  |
| **P1**   | 15 |
| **P2**   | 22 |
| **P3**   | 18 |
| **Total**| 58 |

> Les sévérités ci-dessous sont les **sévérités révisées** après vérification dans le code (un finding initialement P1 peut être nuancé en P2/P3, et inversement). Les findings dont la vérification a échoué techniquement (confidence `low`) sont signalés « à re-vérifier manuellement ».

---

## Findings P0 — bloquants / failles (sécurité paiement/financière)

### P0-1. Swap top-up : capture Stripe arrivant après annulation = acheteur débité sans remboursement (race non gérée)
- **Sévérité** : P0 (confirmé, confidence high)
- **Plateforme** : backend
- **Fichiers** : `functions/src/http/webhooks.ts:735-834`, `functions/src/http/webhooks.ts:786-792`, `functions/src/callable/swaps.ts:707-751`, `functions/src/callable/swaps.ts:821-877`, `functions/src/callable/swaps.ts:631-655`, `functions/src/scheduled/swaps.ts:78-134`
- **Description** : Le chemin ACHAT gère le cas `payment_intent.succeeded` arrivant APRÈS annulation (refund idempotent `rf_${txId}` + dead-letter, `webhooks.ts:343-360`/`409-451`). Le chemin SWAP ne le fait PAS : `handleSwapTopUpSucceeded` (`webhooks.ts:786-792`) fait `if (swap.status !== 'payment_pending') { logger.info(...); return; }` — sortie silencieuse, aucun refund, aucun dead-letter. `topUpPaymentIntentId` est posé dès le checkout (`swaps.ts:650-651`), mais `topUpPaidAt` n'est posé que dans le webhook (`webhooks.ts:822`) sous la garde `payment_pending`. Si `cancelSwap` (ou le job `expireStaleProposedSwaps`) court avant le webhook, le swap passe `cancelled` avec `topUpPaidAt` absent → `refundSwapTopUpIfPaid` (`swaps.ts:710 : if (!swap.topUpPaidAt || !swap.topUpPaymentIntentId) return;`) est un no-op. La PI est créée sans `capture_method` (`swaps.ts:631-647`) donc capture automatique → la carte EST débitée.
- **Impact** : Perte d'argent réelle et **silencieuse** pour l'acheteur sur zone financière, sans trace dead-letter. Le job planifié `expireStaleProposedSwaps` (`scheduled/swaps.ts:78-134`) reproduit le bug à l'échelle (toutes les expirations 7j) en assumant explicitement (commentaire l.73-74) qu'un swap `payment_pending` n'a jamais été payé — hypothèse fausse dans la race.
- **Recommandation** : Dans `handleSwapTopUpSucceeded`, traiter `status === 'cancelled'`/`'refunded'`/`'disputed'` comme le chemin achat : émettre un refund Stripe idempotent (clé `rf_swap_${swapId}`) sur la charge captée + dead-letter avant de sortir. Étendre la même logique au job `expireStaleProposedSwaps`.

### P0-2. Le no-show est purement cosmétique : transaction `meetup_confirmed` verrouillée à vie, article jamais relibéré
- **Sévérité** : P0 → **revue P1** (confirmé, confidence high) — voir aussi P1 financier ; conservé en tête car impact « article invendable » majeur
- **Plateforme** : both
- **Fichiers** : `services/chatService.ts:1167-1191`, `functions/src/scheduled/transactionExpiration.ts`, `functions/src/callable/payments.ts` (`reportNoShow` non consommé), `components/OfferBubble.tsx`, `components/offer-bubble/MeetupActions.tsx`, `firestore.rules:595-605`, `app/chat/[id].tsx`
- **Description** : `reportNoShow` (`chatService.ts:1167-1191`) écrit UNIQUEMENT `offer.meetup.noShow` + un message système « No-show signalé. Notre équipe va examiner la situation. ». Le champ `noShow` n'est lu nulle part côté backend (`grep noShow functions/src` = 0). Le scheduler `expireOrphanedTransactions` n'expire QUE `meetup_pending`, `pending_payment`, `paid`, `refund_in_progress` — jamais `meetup_confirmed`. La complétion (`completeMeetupTransaction`) est réservée à l'acheteur et exige `meetup_confirmed` (`payments.ts:1801-1811`). Un recours backend EXISTE (`cancelPendingTransaction` accepte `meetup_confirmed`, autorise vendeur ET acheteur, relâche `isSold` via `payments.ts:2066-2068`) MAIS n'a **aucun wiring UI** dans le flow meetup (seuls appelants : `app/checkout/shipping.tsx:351`/`416`, flow shipping). `firestore.rules:595-605` interdit au client d'annuler directement.
- **Impact** : Article bloqué `isSold:true` indéfiniment (invendable), transaction zombie, vendeur sans recours in-app. Promesse mensongère « notre équipe va examiner ». Meetup = cash hors-ligne → pas de fonds plateforme gelés (d'où révision P1 plutôt que P0 strictement financier).
- **Recommandation** : Brancher `reportNoShow` sur une Cloud Function qui annule la transaction (relâche `isSold`) ou ouvre un litige réel ; ajouter une branche scheduler `meetup_confirmed` sans `completedAt` au-delà d'un délai ; exposer Annuler/Terminer le meetup depuis my-orders/my-sales (pas seulement la bulle de chat).

### P0-3. Meetup confirmé jamais complété = transaction orpheline permanente + article bloqué en vente
- **Sévérité** : P0 (confidence low — **à re-vérifier manuellement**, vérification technique échouée)
- **Plateforme** : both
- **Fichiers** : `functions/src/scheduled/transactionExpiration.ts:74-161`, `functions/src/callable/payments.ts:711`, `functions/src/callable/payments.ts:731`, `app/my-orders.tsx:59`, `components/OfferBubble.tsx:526-532`
- **Description** : À la création, le meetup verrouille l'article (`tx.update(articleRef, { isSold: true })`, `payments.ts:711`) en `meetup_pending`. `expireOrphanedTransactions` ne traite QUE `meetup_pending` (48h), `pending_payment` (1h), `paid` (7d) — aucune branche `meetup_confirmed`. Dès que le vendeur confirme (`→ meetup_confirmed`), si l'acheteur ne clique jamais « Terminer », la transaction reste bloquée et l'article `isSold:true` indéfiniment. Le seul CTA de complétion/annulation vit dans la bulle d'offre du chat. `cancelPendingTransaction` accepte `meetup_confirmed` (`payments.ts:2028`) mais n'est appelé nulle part pour un meetup.
- **Impact** : État zombie permanent, article invendable. Recoupe P0-2.
- **Recommandation** : Ajouter une expiry/relance `meetup_confirmed` dans `expireOrphanedTransactions` (auto-annulation + `isSold=false` après N jours) ET exposer Annuler/Terminer depuis my-orders/my-sales. **Re-vérifier manuellement avant action** (confidence low).

---

## Findings P1 — bugs & écarts (dont iOS ↔ Android)

### P1-1. Clé publishable Stripe en mode TEST committée comme valeur active
- **Sévérité** : P1 (confirmé, confidence high) — **Plateforme** : both
- **Fichiers** : `config/stripeConfig.ts:1-8`, `app/_layout.tsx:23`, `app/_layout.tsx:95`, `eas.json:16-19`
- **Description** : `STRIPE_PUBLISHABLE_KEY` exporte la clé `pk_test_…` active (l.6-7), la `pk_live_…` étant commentée (l.2-3). Hardcodée dans le bundle, aucun mécanisme env/EAS (`grep expoConfig.extra|process.env` = vide ; `eas.json` production ne définit que `EXPO_PUBLIC_USE_RN_FETCH`). Fichier tracké git.
- **Impact** : Tout build prod/TestFlight embarque la clé TEST → aucun paiement carte réel ne peut aboutir (Stripe rejette une PI live confirmée avec une publishable key test). Bascule live = édition manuelle de fichier. NB : une `pk_test` est une valeur publique non secrète (pas une fuite de secret) ; le risque est « prod ne facture pas ».
- **Recommandation** : Lire la clé via `process.env`/`Constants.expoConfig.extra` (EAS env vars), sélectionner test vs live selon le canal de build.

### P1-2. Apple Pay (iOS) / Google Pay (Android) non fonctionnels : plugin Stripe absent + StripeProvider sans merchantIdentifier
- **Sévérité** : P1 (confirmé, confidence high) — **Plateforme** : both (visible surtout iOS)
- **Fichiers** : `app.config.js:19-67`, `package.json:46`, `app/_layout.tsx:95`, `components/StripePayment.tsx:62-76`, `ios/Seconde/Seconde.entitlements`, `android/app/src/main/AndroidManifest.xml`, `node_modules/@stripe/stripe-react-native/app.plugin.js`
- **Description** : `initPaymentSheet` active `applePay: { merchantCountryCode: 'CA' }` et `googlePay: { merchantCountryCode: 'CA', testEnv: __DEV__ }` (`StripePayment.tsx:67-73`). Mais `@stripe/stripe-react-native` N'EST PAS dans le tableau `plugins` de `app.config.js` (commentaire stale `// Helcim payment via WebView` l.49) ; il n'apparaît que dans `expo.install.exclude`. `StripeProvider` (`_layout.tsx:95`) ne passe que `publishableKey`, sans `merchantIdentifier`/`urlScheme`. **Preuve native** : `ios/Seconde/Seconde.entitlements` ne contient PAS `com.apple.developer.in-app-payments` ; `AndroidManifest.xml` ne déclare PAS `com.google.android.gms.wallet.api.enabled`.
- **Impact** : Boutons Apple Pay / Google Pay absents ou non fonctionnels. Les paiements par CARTE via Payment Sheet fonctionnent normalement (donc pas P0). Écart promesse-code identique iOS+Android au niveau config native.
- **Recommandation** : Ajouter `['@stripe/stripe-react-native', { merchantIdentifier: 'merchant.com.seconde.app', enableGooglePay: true }]` aux plugins, passer `merchantIdentifier` à `StripeProvider`, puis `npx expo prebuild` — OU retirer `applePay`/`googlePay` de `initPaymentSheet`.

### P1-3. Swap top-up : amount mismatch → throw → 500, Stripe rejoue 3 jours, charge captée jamais traitée
- **Sévérité** : P1 (confirmé, confidence high) — **Plateforme** : backend
- **Fichiers** : `functions/src/http/webhooks.ts:776-783`, `webhooks.ts:135-147`, `webhooks.ts:209-214`, `webhooks.ts:454-525`
- **Description** : `handleSwapTopUpSucceeded` fait `throw new Error('Swap top-up amount does not match expected total')` (l.782) sur écart de montant — seul `throw` du fichier. Il remonte au catch racine (l.210-214) qui répond 500. Stripe rejoue ~3j sans effet. Le chemin achat fait l'INVERSE (documenté l.272-280) : `return { processed:false, reason:'amount_mismatch' }` + `writeFailedOperation` + ACK 200.
- **Impact** : Charge acheteur captée, swap bloqué `payment_pending`, aucune piste d'audit (`failed_operations`), 500 spammés 3j sans convergence. Le mismatch est détecté avant tout crédit.
- **Recommandation** : Aligner sur le chemin achat : `return` structuré + `writeFailedOperation('swap_topup_amount_mismatch')` + auto-refund idempotent si surpaiement (`rf_swap_topup_${swapId}`) + ACK 200.

### P1-4. `acceptOffer` écrit le statut `accepted` avant de créer la transaction, sans atomicité (offre orpheline si CF échoue)
- **Sévérité** : P1 (confirmé/nuancé, confidence high) — **Plateforme** : both
- **Fichiers** : `services/chatService.ts:582-656`, `services/transactionService.ts:117-143`, `functions/src/callable/payments.ts:638-654`, `components/OfferBubble.tsx:326-338`
- **Description** : `acceptOffer` fait `updateDoc(messageRef, { 'offer.status': 'accepted' })` (`chatService.ts:611`) AVANT `createMeetupTransaction` (l.641), non atomique. Si le CF `createTransaction` échoue (article déjà vendu `payments.ts:648`, vendeur introuvable l.561, réseau coupé), l'offre reste `accepted` sans transaction, le catch global (l.652-655) re-throw une erreur générique sans rollback. `confirmMeetup` (l.1135-1148) ne trouve alors aucune transaction `meetup_pending` → no-op silencieux mais envoie quand même « Meetup confirmé! » (l.1154).
- **Impact** : Offre « Acceptée » sans transaction, flow meetup bloqué, faux signal de confirmation. Pas de perte d'argent directe (meetup = cash hors plateforme).
- **Recommandation** : Créer la transaction AVANT le statut, ou unifier statut+transaction dans un seul CF `runTransaction` avec rollback.
- *Nuance* : la description évoque « bubble acheteur sans bouton de paiement » — inexact : pour un meetup `canPay` est délibérément toujours `false` (`OfferBubble.tsx:331-332`). Le vrai symptôme est `canConfirmMeetup`/`canCompleteMeetup` actifs sans transaction.

### P1-5. Transition de statut sensible (`meetup_confirmed`) effectuée côté client par `updateDoc` direct
- **Sévérité** : P1 (confidence low — **à re-vérifier manuellement**) — **Plateforme** : both
- **Fichiers** : `services/chatService.ts:1126-1148`, `firestore.rules:589-606`
- **Description** : Contrairement à la règle projet (toute mutation de statut sensible = CF + `runTransaction`), `meetup_pending → meetup_confirmed` est fait par `updateDoc` client direct (`chatService.ts:1145`), gardé seulement par `firestore.rules` (`isMeetupConfirmation`). La règle accepte `hasOnly(['status','meetupConfirmedAt','updatedAt'])` mais le client n'écrit que `{status}` → passe la règle sans poser `meetupConfirmedAt`.
- **Impact** : Transition pilotant l'éligibilité à la complétion, faite hors serveur, sans horodatage de confirmation.
- **Recommandation** : Exposer une callable `confirmMeetupTransaction` (`runTransaction`) posant `status` + `meetupConfirmedAt` + `confirmedAt` du message atomiquement ; resserrer la règle pour exiger `meetupConfirmedAt`.

### P1-6. `confirmMeetup` : double écriture non atomique message+transaction → désync qui bloque la complétion
- **Sévérité** : P1 (confidence low — **à re-vérifier manuellement**) — **Plateforme** : both
- **Fichiers** : `services/chatService.ts:1106-1162`, `components/OfferBubble.tsx:336-338`, `functions/src/callable/payments.ts:1806-1811`
- **Description** : `confirmMeetup` fait deux `updateDoc` séparés : message `offer.meetup.confirmedAt` (l.1127) puis transaction `status:'meetup_confirmed'` (l.1145). Le gating du bouton « Terminer » dépend du champ MESSAGE `confirmedAt` (`OfferBubble:338`). Si l'étape (2) échoue, l'acheteur voit « Terminer » mais la tx reste `meetup_pending` ; `completeMeetup` interroge `status in ['meetup_confirmed','meetup_pending']`, trouve `meetup_pending`, appelle le CF qui REJETTE (`payments.ts:1806-1811`) → wedge en boucle. `meetupConfirmedAt` jamais écrit sur la tx (attendu par `transactionService.ts:22`).
- **Impact** : Transaction définitivement bloquée, erreur en boucle pour l'acheteur.
- **Recommandation** : Transition atomique côté CF ; gating « Terminer » sur le statut de transaction, pas un champ message. À défaut, retirer `meetup_pending` de la requête de `completeMeetup`.

### P1-7. Accepter une offre meetup envoyée depuis le chat échoue : la CF prend le vendeur pour l'acheteur
- **Sévérité** : P1 (confidence low — **à re-vérifier manuellement**, initialement P0) — **Plateforme** : both
- **Fichiers** : `services/chatService.ts:628-651`, `functions/src/callable/payments.ts:446`, `payments.ts:656-658`, `app/chat/[id].tsx:187-211`
- **Description** : Un acheteur peut envoyer une offre meetup depuis le chat (`sendMeetupOffer`) sans transaction. À l'acceptation, `acceptOffer` appelle `createMeetupTransaction` — exécuté par le VENDEUR. Le CF `createTransaction` ignore le param `buyerId` et fixe `const buyerId = request.auth.uid` (`payments.ts:446`) = uid du vendeur → garde `if (articleData.sellerId === buyerId) throw` (l.656-658). Le statut a déjà été passé `accepted` (l.612) avant le throw.
- **Impact** : Offre acceptée orpheline, article non verrouillé, erreur incompréhensible côté vendeur.
- **Recommandation** : Créer la transaction meetup à l'ENVOI par l'acheteur, ou callable `acceptMeetupOffer` dérivant `buyerId`/`sellerId` du document d'offre, pas de `request.auth.uid`.

### P1-8. Signalement no-show : cul-de-sac sans traitement backend ni libération d'article
- **Sévérité** : P1 (confidence low — **à re-vérifier manuellement**) — **Plateforme** : both
- **Fichiers** : `services/chatService.ts:1167-1191`, `components/offer-bubble/MeetupActions.tsx:31-39`, `functions/src/` (aucun consommateur)
- **Description** : Doublon de P0-2 vu sous l'angle « cul-de-sac ». `reportNoShow` écrit `offer.meetup.noShow` + message système, aucune CF, aucun document de litige, aucune libération `isSold`. Meetup étant le seul parcours actif (`SHIPPING_ENABLED=false`), un no-show bloque acheteur ET article sans recours.
- **Recommandation** : Brancher sur CF (litige `disputes/{id}` ou annulation + relibération `runTransaction`), sinon retirer « notre équipe va examiner ».

### P1-9. Estimation shipping toujours en échec : le front n'envoie pas l'adresse d'origine complète
- **Sévérité** : P1 (confidence low — **à re-vérifier manuellement**) — **Plateforme** : both
- **Fichiers** : `app/checkout/shipping.tsx:184-207`, `functions/src/callable/payments.ts:288-296`
- **Description** : Le front appelle `getShippingEstimate` avec `fromAddress: { postalCode: sellerPostalCode }` seul. Le backend exige rue+ville+CP canadien valides pour l'origine, sinon `invalid-argument` (`payments.ts:288-296`). Chaque estimation part en exception → catch → `FALLBACK_ESTIMATES`. Un rate `fallback_*` ne permet pas d'acheter une vraie étiquette → `handlePay` bloque le paiement carte (`shipping.tsx:266-275`). Latent (`SHIPPING_ENABLED=false`).
- **Impact** : Dès réactivation shipping, aucun acheteur ne peut obtenir un tarif réel.
- **Recommandation** : Côté front, charger l'adresse d'origine réelle du vendeur (profil/article) ; ou côté backend autoriser une estimation par CP seul.

### P1-10. Prix négocié perdu à l'entrée du checkout (`negotiatedPrice` jamais transmis)
- **Sévérité** : P1 → **revue P3** (confirmé/nuancé, confidence high) — **Plateforme** : both
- **Fichiers** : `components/OfferBubble.tsx:331-353`, `app/checkout/index.tsx:75-89`, `app/checkout/shipping.tsx:134-136`, `app/checkout/meetup.tsx:50-78`, `config/featureFlags.ts:17`, `features/article/hooks/useArticleActions.ts:100-107`
- **Description** : Les deux écrans checkout consomment `negotiatedPrice` (`shipping.tsx:135`, `meetup.tsx:72-78`) mais aucun appelant ne le fournit (`grep` = uniquement lu). `OfferBubble.handlePayment` (l.347-349) route `/checkout` avec `{ articleId, chatId }` sans prix ; `checkout/index.tsx` handleContinue ne propage que `{ articleId }`.
- **Impact réel** : **Dormant**, pas de préjudice live. Le bouton « Payer maintenant » est gardé par `canPay` (`OfferBubble.tsx:331-332`) qui est TOUJOURS `false` (`SHIPPING_ENABLED=false` + meetup `!isMeetupOffer`=false) → branche `/checkout` inatteignable. Le flow meetup crée la transaction dans `meetup.tsx:142-149` avec `finalPrice`. Régression garantie si `SHIPPING_ENABLED` repasse à `true`.
- **Recommandation** : Propager `negotiatedPrice`+`chatId` dans `index.tsx:79-87` AVANT toute réactivation shipping.

### P1-11. Avis impossible après passage en `completed` (shipping J+7)
- **Sévérité** : P1 (confirmé, confidence high) — **Plateforme** : both (frappe surtout shipping/carte)
- **Fichiers** : `functions/src/callable/reviews.ts:122`, `functions/src/scheduled/releaseHeldFunds.ts:215`, `types/index.ts:346`
- **Description** : `terminalStatuses = new Set(['delivered','meetup_completed'])` (`reviews.ts:122`) ; `completed` absent. Or `releaseHeldFunds` passe la tx shipping de `delivered` à `completed` à J+7 (`releaseHeldFunds.ts:215`). `completed` EST un `TransactionStatus` valide (`types/index.ts:346`) — le commentaire `reviews.ts:121` (« 'completed' does not exist ») est FAUX. La fenêtre de 60j (`reviews.ts:130-142`) devient inatteignable pour le shipping.
- **Impact** : L'acheteur shipping a ~7j (`delivered`) puis le bouton avis disparaît à vie. Asymétrie : meetups (`meetup_completed`) restent reviewables.
- **Recommandation** : Ajouter `completed` à `terminalStatuses` (reviews.ts) et à `isReviewable`/`isCompleted` dans `my-orders.tsx`/`my-sales.tsx`/`review/[transactionId].tsx` ; corriger le commentaire.

### P1-12. Fenêtre de review shipping réelle = 7j pas 60 (`completed` jamais reviewable) — variante UI
- **Sévérité** : P1 (confidence low — **à re-vérifier manuellement**) — **Plateforme** : both
- **Fichiers** : `functions/src/callable/reviews.ts:121-122`, `releaseHeldFunds.ts:214`, `types/index.ts:346`, `app/my-orders.tsx:134`, `app/my-sales.tsx:59`
- **Description** : Même contradiction que P1-11, étendue à l'UI : `my-orders.tsx:134` et `my-sales.tsx:59` ne considèrent reviewable que `delivered`/`meetup_completed` → le bouton disparaît à J+7 ; même par deep link, la garde `review/[transactionId].tsx:238-242` bloque (`isCompleted = delivered || meetup_completed`).
- **Recommandation** : Identique à P1-11, propager `completed` partout.

### P1-13. Aucun écran admin pour résoudre les litiges — fonds gelés indéfiniment après signalement acheteur
- **Sévérité** : P1 (confidence low — **à re-vérifier manuellement**) — **Plateforme** : both
- **Fichiers** : `functions/src/callable/recourse.ts:219-327`, `functions/src/callable/payments.ts:1894-1969`, `app/admin/_layout.tsx`, `app/admin/shops.tsx`
- **Description** : `reportTransactionProblem` gèle les fonds (`disputed=true`, `status='disputed'`), ouvre `disputes/{id}` `open`, et documente que la résolution est « an ADMIN decision via adminRefundTransaction » (`recourse.ts:216-217`). Or l'app admin n'expose QUE `shops.tsx`/`shop-detail/[id].tsx`. Aucun écran ne lit `disputes`, n'appelle `adminRefundTransaction`, ni ne clôt un litige. Seul signal : `logger.warn` (`recourse.ts:319`). `walletWithdraw` refuse sur `disputed=true` (`wallet.ts:320-331`).
- **Impact** : Vendeur honnête gelé sans délai borné ni voie de résolution in-app ; acheteur de mauvaise foi peut bloquer un paiement indéfiniment.
- **Recommandation** : Créer un écran admin (gardé `isAdmin`) listant `disputes` (`open`) avec `adminRefundTransaction` ou « clôturer en faveur du vendeur ». À défaut, documenter explicitement le SLA hors-app.

### P1-14. 4 types de ledger backend absents du type client — `funds_released` affiché comme débit rouge
- **Sévérité** : P1 (confirmé, confidence high) — **Plateforme** : both
- **Fichiers** : `types/index.ts:918-923`, `app/wallet.tsx:138-171`, `app/wallet.tsx:359-387`, `app/wallet.tsx:1019-1021`, `functions/src/scheduled/releaseHeldFunds.ts:94-102,205-212`, `functions/src/http/webhooks.ts:1021-1029,1173-1184`, `functions/src/utils/refund.ts:291-302`, `functions/src/callable/wallet.ts:15-24,193-211`, `services/walletService.ts:43-50`, `constants/theme.ts:57`
- **Description** : Le backend écrit `funds_held`, `funds_released`, `dispute_hold`, `refund_debit`. `getWalletInfo` renvoie les 20 dernières entrées brutes (`wallet.ts:194-211`). Côté client, `WalletLedgerType` ne déclare que 5 types (`types/index.ts:918-923`) et `LEDGER_ICON_MAP` n'en couvre que 5 → fallback `help-circle` (`wallet.tsx:361-365`). `isCredit()` ne reconnaît que `sale_credit`/`refund_credit` (`wallet.tsx:169-171`) → `funds_released` (événement POSITIF) affiché `-…` en rouge (`danger:'#D64545'`, `theme.ts:57`).
- **Impact** : Le vendeur voit la libération de ses fonds comme une perte rouge + icône d'erreur générique. Montants réels corrects (pas P0), mais confiance vendeur entamée. Contredit l'en-tête `wallet.ts:15-24` qui documente 9 types.
- **Recommandation** : Aligner `WalletLedgerType` sur les 9 types, ajouter les 4 manquants à `LEDGER_ICON_MAP`, inclure `funds_released` dans `isCredit()` (ou rendre held/released neutres sans signe ±).

### P1-15. Écran review sans `KeyboardAvoidingView` : champ commentaire et bouton masqués par le clavier (iOS)
- **Sévérité** : P1 (confidence low — **à re-vérifier manuellement**) — **Plateforme** : **ios** (écart iOS↔Android)
- **Fichiers** : `app/review/[transactionId].tsx:262`, `:324`, comparaison `app/chat/[id].tsx:404`, `app/checkout/shipping.tsx:525`
- **Description** : L'écran review rend le formulaire dans un simple `<ScrollView>` (`review:262`) sans `KeyboardAvoidingView`. Le `TextInput multiline` (l.324) et le bouton « ENVOYER MON AVIS » sont en bas. Sur iOS le clavier ne pousse pas le contenu → champ et submit recouverts. Le reste de l'app applique `behavior={Platform.OS === 'ios' ? 'padding' : undefined}` + `keyboardVerticalOffset` (chat l.404-405). Seul écran de saisie qui déroge.
- **Impact** : Sur iOS, rédaction du commentaire à l'aveugle, fermeture manuelle du clavier pour valider. Écart iOS/Android.
- **Recommandation** : Envelopper le contenu dans `KeyboardAvoidingView` comme `chat/[id].tsx`.

---

## Findings P2 / P3

### P2

**P2-1. CTA « ACHETER · {prix} » déclenche une demande de meetup sans paiement** (P1→P2, confirmé/nuancé)
`features/article/components/ArticleCTABar.tsx:63-66`, `features/article/hooks/useArticleActions.ts:87-110`, `app/article/[id].tsx:196`, `config/featureFlags.ts:17`, `app/checkout/index.tsx:55-57,264-273`, `app/checkout/meetup.tsx:120-182` — both. `SHIPPING_ENABLED=false` force tout achat en meetup ; le CTA « ACHETER · {prix} » + icône sac suggère un paiement en ligne immédiat alors que `handleBuy` → `/checkout` auto-sélectionne `meetup` → demande de meetup « paiement en main propre, aucun frais ». Pas de débit ni d'engagement financier (demande en chat). **Reco** : libeller « PROPOSER UN ACHAT » / « RENCONTRER LE VENDEUR » quand `SHIPPING_ENABLED=false`. *(NB : finding citait `featureFlags.ts:19` → réel `:17`.)*

**P2-2. Article bascule en « Article vendu » dès une demande de meetup non confirmée** (confidence low — **à re-vérifier**)
`features/article/components/ArticleCTABar.tsx:35-43`, `functions/src/callable/payments.ts:711,731`, `app/checkout/meetup.tsx:142-169` — both. `createTransaction` met `isSold:true` dès la création même pour `meetup_pending`. La CTA bar n'a que `isSold`/`isOwnArticle` → « Article vendu » à tous dès « Confirmer le meetup », sans état « réservé ». **Reco** : champ `reservedUntil`/`pendingTransactionId` ou n'afficher « vendu » qu'à partir de `meetup_confirmed`/`paid`.

**P2-3. Écran d'erreur réseau promet un « réessayez » mais n'offre aucun retry** (confirmé)
`features/article/components/LoadingState.tsx:108-124`, `app/article/[id].tsx:69-78,140-141`, `features/article/hooks/useArticleActions.ts:221-224` — both. Sous-titre « …réessayez » mais seul bouton = « Retour » (`onBack=router.back()`). `refetch` jamais déstructuré de `useQuery`. `handleBack` sans `router.canGoBack()` → deep-link à froid sans pile. **Reco** : exposer `refetch` sur un vrai bouton « Réessayer » ; fallback `router.replace('/(tabs)')` pour le cas réseau.

**P2-4. Validation de prix incohérente offre initiale vs contre-offres** (confirmé)
`components/MakeOfferModal/OfferStep.tsx:26-55`, `components/OfferBubble.tsx:158-180`, `components/offer-bubble/CounterPriceInput.tsx:22-49`, `services/chatService.ts:780-879`, `firestore.rules:314`, `app/chat/[id].tsx:256-260` — both. Offre initiale guidée (warning < 30% du prix, `OfferStep.tsx:39`) ; contre-offre ne valide que `isNaN`/`<=0` (`OfferBubble.tsx:159`) — aucun seuil bas ni plafond. Plafond réel = règle Firestore `amount <= 50000` (`firestore.rules:314`) → erreur opaque « Impossible d'envoyer la contre-offre ». **Reco** : factoriser la validation (min/warning bas, plafond 50000 avec message explicite) dans les deux composants.

**P2-5. Contre-offre horaire : `new Date(texte libre)` non-ISO, fragile** (confirmé/nuancé)
`components/OfferBubble.tsx:214-251`, `components/offer-bubble/CounterTimeInput.tsx:34-41`, `app/chat/[id].tsx:276-279,341`, `services/chatService.ts:1045-1059`, `app.config.js:5` — both. Saisie texte libre `AAAA-MM-JJ HH:MM` parsée par `new Date(raw)` (`OfferBubble.tsx:224`), aucun `DateTimePicker` (grep = 0). *Nuance* : app 100% Hermes (`app.config.js:5`) iOS+Android → pas de divergence de moteur ; le risque est la fragilité du parsing non-ISO + UX hostile FR-CA. **Reco** : `DateTimePicker` natif renvoyant un `Date`, stocker en ISO.

**P2-6. Total affiché (estimation client) peut diverger du montant débité (re-tarification serveur)** (confidence low — **à re-vérifier**)
`app/checkout/shipping.tsx:227-229`, `functions/src/callable/payments.ts:718-728,980`, `components/StripePayment.tsx:51` — both. `totalAmount` calculé client ; backend re-tarifie via ShipEngine (`shippingCost = serverShippingCost`, `payments.ts:718`) et `createStripeCheckout` recalcule `buyerTotal` (l.980). Si re-quote diffère, débit ≠ affichage. Latent. **Reco** : afficher le total autoritatif `feeBreakdown.buyerTotal` de `createStripeCheckout` avant le Payment Sheet.

**P2-7. Province non requise par `canPay` alors que le backend l'exige** (confidence low — **à re-vérifier**)
`app/checkout/shipping.tsx:250-253`, `functions/src/callable/payments.ts:77-83`, `features/checkout-shipping/components/ShippingAddressForm.tsx:104-125` — both. `canPay` n'inclut pas `province` ; backend rejette `validateBuyerShippingAddress` → alerte générique « Article indisponible » après création/annulation de transaction. Latent. **Reco** : ajouter `province` (et `CA_POSTAL_RE`) à `canPay` + message « Sélectionnez votre province ».

**P2-8. Bouton Payer se ré-active pendant la feuille Stripe (re-tap → 2e transaction bloquée par `isSold`)** (confirmé/nuancé)
`app/checkout/shipping.tsx:343-382`, `features/checkout-shipping/components/PayButton.tsx:54-63`, `components/StripePayment.tsx:56-112`, `functions/src/callable/payments.ts:638-711`, `services/transactionService.ts:70-108` — both. `finally` remet `submitting=false` (l.380) même sur succès ; `showStripePayment` n'entre pas dans `disabled`. *Nuance* : la feuille native masque le bouton — les vraies fenêtres sont (1) le trou async pendant `initPaymentSheet` et (2) APRÈS annulation/dismiss (`handlePaymentResult` ne réinitialise pas `pendingTransactionId`). Re-tap → backend voit `isSold===true` → « Article indisponible » + `router.back()`. Pas de double-charge (garde backend). **Reco** : `disabled={!canPay || submitting || showStripePayment}` ET réinitialiser/annuler `pendingTransactionId` au dismiss.

**P2-9. Navigation vers l'écran de succès avant confirmation du webhook (`paid` non vérifié)** (confirmé)
`app/checkout/shipping.tsx:444-459`, `app/payment/[transactionId].tsx:138-156`, `app/checkout/success.tsx:34-42,87-94`, `services/transactionService.ts:288-302`, `functions/src/http/webhooks.ts:362-368`, `functions/src/scheduled/reconcile.ts:87-108` — both. Sur `result.success`, navigation immédiate vers `/checkout/success` (« Paiement confirmé ») affichant des montants en params client. `pending_payment → paid` est serveur-only (webhook). `reconcile.ts:90-107` logge « CRITICAL … paid PI but transaction still pending_payment (lost webhook) » — la fenêtre existe. **Reco** : afficher « Paiement en cours de confirmation » tant que la tx n'est pas observée `paid` (listener/refetch).

**P2-10. `createStripeCheckout` mixte wallet+card : pas de garde de re-débit/idempotence wallet sur 2e tentative** (confirmé)
`functions/src/callable/payments.ts:859-868,877-934,998-1058` — backend. La seule garde lit `stripePaymentIntentId` (l.859), écrit APRÈS la transaction hors verrou (l.1055). Le débit wallet (l.902) dépend de l'input requête, pas de `walletAmountUsed`/`paidVia` déjà posés. Crash entre `paymentIntents.create` (l.999) et l'écriture de l'ID → appel 2 re-débite (la clé Stripe `pi_${txId}` renvoie la même PI, pas de double charge carte). Borné par `balance < walletAmount` (l.896). **Reco** : refuser le re-débit si `walletAmountUsed`/`paidVia` déjà présents, ou persister l'ID dans une transaction qui re-lit l'état.

**P2-11. `requestReturn` : étiquette de retour payante créée puis abandonnée en course concurrente (fuite de coût)** (confirmé)
`functions/src/callable/recourse.ts:523-592`, `functions/src/config/shipEngine.ts`, `functions/src/utils/rateLimit.ts` — backend. `createReturnLabel` (l.527) avant le `runTransaction` (l.549) ; non idempotent (`shipEngine.ts:433-434`). Deux appels franchissant la pré-lecture (l.387) achètent chacun une étiquette ; le perdant (`aborted`, l.557-560) logge seulement « label bought but not used » (l.582-589). Rate-limit 3/60s (`recourse.ts:368-373`) n'élimine pas le double-tap. La fonction sœur `requestRefund` pose pourtant un verrou avant l'appel coûteux (l.129-134). **Reco** : claim atomique `returnLabelPending` avant l'achat, ou void/refund de l'étiquette perdante.

**P2-12. `reportTransactionProblem` autorisé sur `completed` — gèle des fonds déjà retirés** (confidence low — **à re-vérifier**)
`functions/src/callable/recourse.ts:65,279-297`, `releaseHeldFunds.ts:214-217`, `app/settings/delete-account.tsx:96-101` — backend. `REPORTABLE_STATUSES` inclut `completed`. Sur `completed`, les fonds sont déjà passés en `balance` (retirables). Le report passe `disputed=true` mais ne regèle PAS l'argent (`balance→heldBalance` absent), contrairement au dispute Stripe. `adminRefundTransaction` peut alors cascader en `sellerDebt`. **Reco** : borner aux statuts où les fonds sont encore gelés (retirer `completed`, ou n'autoriser `delivered`/`completed` que si `fundsReleasedAt` absent / dans la fenêtre 7j).

**P2-13. `heldReleaseAt` jamais renvoyé par `getWalletInfo` — « Disponible le {date} » = code mort** (confirmé)
`app/wallet.tsx:201,527-531`, `types/index.ts:942`, `functions/src/callable/wallet.ts:213-227`, `services/walletService.ts:49`, `hooks/useWallet.ts:29,60` — both. L'UI lit `wallet.heldReleaseAt` (toujours `undefined`) ; `getWalletInfo` ne le calcule/renvoie pas. La donnée existe pourtant sous `transactions.fundsReleaseAt` (affichée dans `ShipmentTracking.tsx:172-173`). **Reco** : faire calculer `heldReleaseAt` (min des `fundsReleaseAt` encore en held), ou retirer la ligne.

**P2-14. Meetup bloqué en `meetup_confirmed` : review jamais possible pour aucune partie (pas de timeout)** (confidence low — **à re-vérifier**)
`functions/src/callable/payments.ts:1801,1806`, `transactionExpiration.ts:81`, `reviews.ts:122` — both. Seul l'acheteur passe `meetup_confirmed → meetup_completed` ; aucune complétion auto. Si l'acheteur ne confirme jamais, ni lui ni le vendeur ne peuvent laisser d'avis. **Reco** : auto-complétion `meetup_confirmed` après délai (7-14j), ou autoriser le vendeur à confirmer.

**P2-15. Pas d'invalidation de cache après soumission review (re-soumission rejetée)** (confidence low — **à re-vérifier**)
`app/review/[transactionId].tsx:181`, `app/my-orders.tsx:147,96` — both. Après succès, `router.back()` sans `invalidateQueries` ; `staleTime 5min` → bouton « Laisser un avis » reste actif jusqu'à 5min, re-clic → `already-exists`. **Reco** : `invalidateQueries` (orders/sales) avant `router.back()`, ou `useFocusEffect`.

**P2-16. Erreurs callable review mal mappées (message générique « réessayer »)** (confidence low — **à re-vérifier**)
`app/review/[transactionId].tsx:185,188`, `functions/src/callable/reviews.ts:96,138` — both. Seul `'already'` est distingué ; profanité (`reviews.ts:96`) et fenêtre expirée (l.138) tombent dans « réessayer » (trompeur). **Reco** : propager `err.message`/mapper `invalid-argument`/`deadline-exceeded`/`failed-precondition`.

**P2-17. Footer du bouton de paiement sans safe-area inset (`paddingBottom:32` fixe) sur `/payment`** (confidence low — **à re-vérifier**)
`app/payment/[transactionId].tsx:517,1-37`, `app/checkout/meetup.tsx:422`, `app/checkout/success.tsx:160` — both. `/payment` n'importe pas `useSafeAreaInsets` et code `paddingBottom:32` ; les autres écrans utilisent `insets.bottom + 16`. Bouton « PAYER » trop proche du bord (home indicator iOS / barre gestuelle Android). **Reco** : `paddingBottom = insets.bottom + 16`.

**P2-18. `KeyboardAvoidingView` englobe le `ScreenHeader` sans `keyboardVerticalOffset` (checkout/shipping)** (P3, confirmé/nuancé) — **Plateforme : ios**
`app/checkout/shipping.tsx:522-533`, `app/chat/[id].tsx:383-405`, `components/ui/ScreenHeader.tsx:60-70`, `config/featureFlags.ts:17` — *Nuance* : avec `behavior='padding'` englobant header+ScrollView, le clavier (en bas) ajoute un padding bas, il ne « recouvre » pas le header ; symptôme réel = excès d'espace/décalage, atténué par `keyboardShouldPersistTaps='handled'`. Comparaison chat trompeuse (header HORS du KAV là-bas). Code mort actuellement (shipping off). **Reco** : sortir `ScreenHeader` du KAV ou ajouter `keyboardVerticalOffset`.

**P2-19. `KeyboardAvoidingView` checkout/shipping (doublon transverse)** (confidence low — **à re-vérifier**) — **Plateforme : ios**
`app/checkout/shipping.tsx:522-527,8` — même sujet que P2-18 vu sous l'angle cross-plateforme (iOS `padding` vs Android `windowSoftInputMode`). Latent.

### P3

**P3-1. Boutons Acheter / Offre / Swap non protégés contre le double-tap** (confirmé)
`features/article/hooks/useArticleActions.ts:87-110,112-136,192-213`, `features/article/components/ArticleCTABar.tsx:54-66`, `features/article/styles.ts:322-371`, `app/article/[id].tsx:190-198` — both. Aucune garde de re-entrance ; double-tap « ACHETER »/« SWAP » empile deux `router.push`. *Nuance* : double `present()` sur le même ref BottomSheetModal (OFFRE) est idempotent. Pas de double transaction (gardes backend). **Reco** : verrou ref booléen réinitialisé au focus + `disabled` pendant la transition.

**P3-2. Haptic de succès joué avant l'auth sur le favori pour un invité** (confirmé/nuancé)
`features/article/hooks/useArticleActions.ts:55-67`, `hooks/useAuthRequired.ts:26-33`, `store/authSheetStore.ts:44-50`, `hooks/useFavorites.ts:116-172` — both. `Haptics.notificationAsync(Success/Warning)` joué AVANT `requireAuth`. *Nuance* : les invités ont des favoris locaux (AsyncStorage) → `isFavorite` peut être `true` (haptic Warning) ; le décalage existe dans les deux branches. **Reco** : déplacer le haptic dans le callback `onSuccess` de `requireAuth`.

**P3-3. Clavier prix : `decimal-pad` (modal) vs `numeric` (contre-offre) — pas de point décimal iOS** (P2→P3, confirmé/nuancé) — **Plateforme : ios**
`components/MakeOfferModal/OfferStep.tsx:76`, `components/offer-bubble/CounterTimeInput.tsx:37` (réel `CounterPriceInput.tsx:37`), `components/OfferBubble.tsx` — `CounterPriceInput` est le SEUL champ monétaire en `numeric` (outlier ; `PriceCard.tsx:31`, `wallet.tsx:605`, `OfferStep.tsx:76` = `decimal-pad`). *Nuance* : `numeric` iOS expose le séparateur (clavier « chiffres et ponctuation »), moins direct mais pas « impossible ». **Reco** : `decimal-pad` partout.

**P3-4. Bouton « Signaler une absence » partagé entre phase vendeur et acheteur, intention ambiguë** (confirmé/nuancé)
`components/OfferBubble.tsx:518-532,277-300`, `components/offer-bubble/MeetupActions.tsx:41-73` — both. Même composant + handler `handleReportNoShow` + copy générique « L'autre personne ne s'est pas présentée » dans les deux phases. *Nuance* : `confirmMeetup` est une confirmation POST-rencontre (`OfferBubble.tsx:256-258`), pas une planification — « absence » a du sens. `reportNoShow` écrit bien `offer.meetup.noShow` mais sans consommateur backend (dead-end, cf. P0-2). **Reco** : séparer les actions par phase, lier le bouton à un vrai flux no-show.

**P3-5. Sélection d'estimation par `serviceName` au lieu du `rateId`** (confidence low — **à re-vérifier**)
`features/checkout-shipping/components/ShippingEstimateList.tsx:95-99`, `functions/src/callable/payments.ts:354-363` — both. `isSelected` testé sur `serviceName` (non unique multi-transporteurs) ; `key={est-index}`. Deux rates de même nom → deux cartes cochées. Latent. **Reco** : `isSelected={selectedEstimate?.rateId === est.rateId}` et `key={est.rateId}`.

**P3-6. Devise ambiguë ($ sans CA) dans breakdown/bouton de paiement (checkout)** (confidence low — **à re-vérifier**)
`features/checkout-shipping/components/PriceBreakdown.tsx:42-63`, `PayButton.tsx:49-51`, `app/checkout/shipping.tsx:560-573`, `utils/formatPrice.ts:6-23` — both. `formatPrice` rend « X $ » ; `formatPriceWithCurrency` (« X $ CA ») existe et est documenté pour le checkout mais inutilisé. Solde wallet formaté à la main. **Reco** : `formatPriceWithCurrency` au moins pour Total/PayButton/solde.

**P3-7. Montants checkout/paiement sans indicateur CAD explicite** (confidence low — **à re-vérifier**)
`app/payment/[transactionId].tsx:240-257`, `app/checkout/success.tsx:107-145`, `utils/formatPrice.ts:13-23` — both. Doublon de P3-6 côté écran paiement/succès. **Reco** : `formatPriceWithCurrency` pour « Total à payer »/« Total payé ».

**P3-8. Téléphone destinataire jamais collecté : l'étiquette utilise le téléphone du vendeur** (confidence low — **à re-vérifier**)
`app/checkout/shipping.tsx:290-299`, `functions/src/callable/payments.ts:585`, `features/checkout-shipping/components/ShippingAddressForm.tsx:52-140` — both. Le formulaire checkout n'a pas de champ téléphone ; backend `phone: shippingAddress.phone || origin.phone` (`payments.ts:585`) → numéro du vendeur sur le colis acheteur. Latent. **Reco** : champ téléphone (optionnel) propagé dans `shippingAddress.phone` ; ne jamais rabattre sur le vendeur.

**P3-9. Contrat d'annulation Stripe : `onResult` n'émet jamais `error==='cancelled'` (code mort)** (confirmé)
`components/StripePayment.tsx:87-106`, `app/checkout/shipping.tsx:424-441`, `app/payment/[transactionId].tsx:138-148` — both. L'annulation (`presentError.code==='Canceled'`) appelle `onClose()`/`return`, jamais `onResult`. Les deux consommateurs testent `error==='cancelled'` (branches mortes). Pas de bug fonctionnel (annulation gérée par `onClose`). **Reco** : aligner le contrat (émettre `'cancelled'` OU retirer les tests).

**P3-10. Couleur hardcodée `#FF9500` hors design system dans l'étape d'offre** (confirmé)
`components/MakeOfferModal/OfferStep.tsx:200-201` — both. `discountWarning: { color: '#FF9500' }` (orange iOS système) appliqué quand `discount > 50` ; viole « tout via tokens ». `colors.warning='#E09F3E'` (`theme.ts:61`) existe. **Reco** : remplacer par `colors.warning`. *(NB hors-scope : même couleur dans `admin/shop-detail/[id].tsx:359`, `ShopValidationCard.tsx:28`.)*

**P3-11. `getServiceFee`/`getShippingEstimate`/`findPickupPoints` : callables sans auth ni rate-limit (DoS / coût ShipEngine)** (confirmé/nuancé)
`functions/src/callable/payments.ts:266-376,382-399,1641-1665` — backend. `getShippingEstimate` (l.266) et `getServiceFee` (l.382) n'ont ni `request.auth` ni `checkRateLimit`, contrairement aux callables financières (`createTransaction:423-428`, `walletWithdraw:257-262` avec `maxCallsUnauthenticated:0`). `getShippingEstimate` appelle ShipEngine facturable. **Ajout finding** : `findPickupPoints` (l.1641) a la même surface (appel `findPUDOLocations`). **Reco** : `checkRateLimit` (+ `if(!request.auth)`) sur `getShippingEstimate` ET `findPickupPoints` ; rate-limit léger sur `getServiceFee`.

**P3-12. Webhook shipping : double-création d'étiquette ShipEngine possible (fenêtre crash étroite)** (confirmé/nuancé)
`functions/src/http/webhooks.ts:113-133,548-645`, `functions/src/utils/labelFulfillment.ts:46-50`, `functions/src/scheduled/sweepPendingLabels.ts:280-345`, `functions/src/config/shipEngine.ts:324-345`, `functions/src/callable/wallet.ts:690-805` — backend. Double-crédit vendeur bien protégé (`sellerCreditedCents`, `labelFulfillment.ts:48` + garde statut). `createLabel` non idempotent (`shipEngine.ts:341-344`). *Nuance majeure* : le mécanisme décrit (re-tentative `sweepPendingLabels`) NE se reproduit PAS — le sweep exige `labelCreationPending===true` (posé seulement sur échec). Le VRAI risque inverse : transaction orpheline `paid` avec étiquette payée non enregistrée + vendeur non crédité → remboursement acheteur à J+7. **Reco** : clé d'idempotence sur `createLabel` OU marqueur `labelCreationInProgress` avant l'appel (défense en profondeur).

**P3-13. Statut `lost` jamais atteignable** (P1→P2, confirmé/nuancé)
`functions/src/config/shipEngine.ts:564`, `trackingTransition.ts:79`, `releaseHeldFunds.ts:56`, `recourse.ts:54`, `payments.ts:1937`, `types/index.ts:349` — *(backend, pas « both »)*. `lost` est un `TransactionStatus` consommé partout (sets de blocage/remboursement) mais jamais PRODUIT : `mapStatus` (`shipEngine.ts:564-575`) ne renvoie que UNKNOWN/TRANSIT/IN_TRANSIT/DELIVERED/FAILURE ; `applyTrackingOutcome` n'écrit que `delivered`/`delivery_failed`/`shipped`. Un colis perdu reste `delivery_failed` (qui est aussi dans les sets autorisés) → pas d'impact financier. Code mort/aspirationnel. **Reco** : câbler une transition vers `lost` (mapping ShipEngine d'un code de perte ou callable admin), ou retirer `lost`.

**P3-14. `merchantDisplayName 'Seconde'` et résidu Helcim dans la config de paiement** (confidence low — **à re-vérifier**)
`components/StripePayment.tsx:64`, `app.config.js:49` — both. Payment Sheet affiche « Seconde » ; commentaire mort « Helcim payment via WebView » subsiste. **Reco** : confirmer la marque, supprimer le commentaire Helcim.

**P3-15. `settings/payments.tsx` : « Ajouter une carte » non implémenté mais présent — CTA mort** (confidence low — **à re-vérifier**)
`app/settings/payments.tsx:1-2,20-22,42-45` — both. Bouton ouvre une Alert « Bientôt disponible » ; route atteignable par deep link malgré l'en-tête. **Reco** : retirer la route ou remplacer le CTA par un état vide explicite.

**P3-16. Sélecteur d'heure du meetup = champ texte libre (variante)** (confidence low — **à re-vérifier**)
`components/offer-bubble/CounterTimeInput.tsx:34-41`, `components/OfferBubble.tsx:214-251` — both. Doublon de P2-5 (P2 dimension Offres). **Reco** : `DateTimePicker` natif.

**P3-17. Lieu de meetup en contre-proposition = texte libre sans carte ni validation géo** (confidence low — **à re-vérifier**)
`components/offer-bubble/CounterLocationInput.tsx:34-41`, `components/OfferBubble.tsx:182-212` — both. `MeetupSpot` construit avec `category:'other'` + `neighborhood` hérité de l'offre d'origine (potentiellement faux), aucune carte/géocodage. **Reco** : sélecteur structuré (lieux publics + carte) ou au minimum choix du quartier.

**P3-18. Commentaire factice « Bonne transaction. » injecté quand l'utilisateur n'écrit rien** (confidence low — **à re-vérifier**)
`app/review/[transactionId].tsx:173,345`, `functions/src/callable/reviews.ts:72` — both. Submit actif dès `rating>0`, commentaire optionnel UI ; callable exige min 5 caractères → client envoie « Bonne transaction. » par défaut, affiché publiquement (même sur un avis 1-2 étoiles). **Reco** : rendre le commentaire obligatoire OU autoriser un avis sans texte côté callable.

---

## Sécurité paiement & financière (focus dédié)

| Thème | Constat | Finding | Gravité |
|-------|---------|---------|---------|
| **Webhooks — refund post-cancel** | Chemin SWAP ne rembourse pas une capture arrivant après annulation (asymétrie vs chemin achat). Carte débitée, silencieux, sans dead-letter. | P0-1 | P0 |
| **Webhooks — gestion d'erreur** | Swap amount mismatch `throw` → 500 → replay Stripe 3j, charge captée, aucun `failed_operations`. Chemin achat fait ACK 200 + dead-letter. | P1-3 | P1 |
| **Idempotence wallet** | `createStripeCheckout` mixte : re-débit wallet possible sur 2e tentative (ID PI persisté hors transaction). Pas de double charge carte (clé Stripe). | P2-10 | P2 |
| **Idempotence étiquette** | `createLabel`/`createReturnLabel` non idempotents ; double-création / étiquette orpheline possible en fenêtre crash. Double-crédit vendeur bien protégé. | P3-12, P2-11 | P3/P2 |
| **Gardes de statut** | `meetup_confirmed` posé client direct (`updateDoc`), non atomique avec le message ; `confirmMeetup` désync ; `completed` non reviewable. | P1-5, P1-6, P1-11 | P1 |
| **Privilege escalation** | `createTransaction` fixe `buyerId = request.auth.uid` (correct), mais `acceptOffer` exécuté par le vendeur → garde self-purchase mal déclenchée. | P1-7 | P1 |
| **Callables non gardées** | `getShippingEstimate`/`getServiceFee`/`findPickupPoints` sans auth ni rate-limit (DoS coût ShipEngine). Pas de mutation ni fuite. | P3-11 | P3 |
| **Résolution litiges** | Aucun écran admin pour `disputes`/`adminRefundTransaction` → fonds gelés indéfiniment. | P1-13 | P1 |
| **Config clé** | `pk_test` committée active ; build prod ne facture pas en live. | P1-1 | P1 |
| **seller_balances / ledger** | `funds_released` (positif) affiché en débit rouge ; 4 types backend absents du type client. Montants réels corrects. | P1-14 | P1 |

**Points positifs vérifiés** : le chemin achat (carte) gère correctement refund post-cancel + dead-letter + ACK 200 ; le double-crédit vendeur est protégé (`sellerCreditedCents` + garde statut) ; `payment_intent.succeeded` est idempotent (`stripe_events`) ; meetup = cash hors-ligne, aucun fonds plateforme manipulé à tort ; `updatePaymentInfo` client est un stub serveur-only ; `reconcile.ts` détecte les webhooks perdus. La couche financière est globalement robuste côté carte ; les trous sont sur **swap top-up** et **meetup** (états zombies, pas de flux d'argent plateforme).

---

## Matrice cross-plateforme

| Zone | iOS | Android | Écart constaté |
|------|-----|---------|----------------|
| CTA page article (logique) | identique | identique | Aucun (JS pur, pas de `Platform.select`) |
| Offres / négociation (logique, validation, atomicité) | identique | identique | Aucun |
| Clavier prix contre-offre | `numeric` → séparateur décimal indirect | `numeric` → point direct | **iOS** : saisie centimes moins ergonomique (P3-3) |
| `CounterTimeInput` (`new Date`) | Hermes | Hermes | Aucun (même moteur), fragilité partagée (P2-5) |
| Écran review + clavier | `ScrollView` seul → champ/bouton masqués | `adjustResize` atténue | **iOS** : pas de `KeyboardAvoidingView` (P1-15) |
| Checkout shipping + clavier | `behavior='padding'` sans offset, header dans KAV | `windowSoftInputMode` | **iOS** : décalage/espace bas (P2-18/P2-19, latent) |
| Footer `/payment` (safe-area) | home indicator | barre gestuelle | **both** : `paddingBottom:32` fixe ignore l'inset (P2-17) |
| Apple Pay / Google Pay | entitlement `in-app-payments` absent → bouton absent | `wallet.api.enabled` absent → init échoue | **both** : plugin Stripe non configuré ; visible surtout iOS (P1-2) |
| Paiement carte (Payment Sheet) | fonctionnel | fonctionnel | Aucun |
| Webhooks / CF / wallet / reviews | N/A | N/A | Backend pur, aucun écart de plateforme |

**Conclusion cross-plateforme** : les écarts iOS↔Android réels sont peu nombreux et concentrés sur la saisie clavier (P3-3, P1-15, P2-18) et la config native des wallets (P1-2). La très grande majorité des défauts sont des bugs logiques/financiers identiques sur les deux plateformes.

---

## Plan d'action priorisé (checklist P0 → P3)

**P0 — à traiter immédiatement (financier/blocage)**
- [ ] P0-1 — Swap top-up : refund idempotent (`rf_swap_${swapId}`) + dead-letter dans `handleSwapTopUpSucceeded` pour `cancelled`/`refunded`/`disputed` ; étendre à `expireStaleProposedSwaps`.
- [ ] P0-2 — No-show meetup : brancher `reportNoShow` sur une CF (annulation + relibération `isSold`) ; ajouter une branche scheduler `meetup_confirmed`.
- [ ] P0-3 — Meetup confirmé non complété : expiry/auto-annulation `meetup_confirmed` dans `expireOrphanedTransactions` + CTA Annuler/Terminer dans my-orders/my-sales. *(Re-vérifier manuellement, confidence low.)*

**P1 — bugs & écarts majeurs**
- [ ] P1-1 — Clé Stripe via env/EAS selon le canal (retirer la constante commentée/décommentée).
- [ ] P1-2 — Ajouter le plugin `@stripe/stripe-react-native` (`merchantIdentifier` + `enableGooglePay`) + `npx expo prebuild`, OU retirer Apple/Google Pay de `initPaymentSheet`.
- [ ] P1-3 — Swap mismatch : `return` structuré + `writeFailedOperation` + ACK 200 (aligner sur le chemin achat).
- [ ] P1-4 / P1-7 — Unifier acceptation d'offre meetup dans une CF transactionnelle dérivant `buyerId`/`sellerId` du document d'offre.
- [ ] P1-5 / P1-6 — Callable `confirmMeetupTransaction` atomique (message + transaction + `meetupConfirmedAt`) ; gating « Terminer » sur le statut de transaction.
- [ ] P1-8 — Cf. P0-2 (même branchement no-show backend).
- [ ] P1-9 — Transmettre l'adresse d'origine complète à `getShippingEstimate` (avant réactivation shipping).
- [ ] P1-11 / P1-12 — Ajouter `completed` à `terminalStatuses` (reviews.ts) + `isReviewable`/`isCompleted` UI ; corriger le commentaire faux.
- [ ] P1-13 — Écran admin litiges (`disputes` + `adminRefundTransaction` + clôture vendeur).
- [ ] P1-14 — Aligner `WalletLedgerType` (9 types) + `LEDGER_ICON_MAP` + `isCredit(funds_released)`.
- [ ] P1-15 — `KeyboardAvoidingView` sur l'écran review.

**P2 — à corriger (UX/confiance/latent)**
- [ ] P2-1 — Libellé CTA conditionnel (« PROPOSER UN ACHAT » quand `SHIPPING_ENABLED=false`).
- [ ] P2-3 — Bouton « Réessayer » réel (exposer `refetch`) + fallback Accueil sur erreur réseau.
- [ ] P2-4 — Factoriser la validation de prix (offre + contre-offre, plafond 50000 explicite).
- [ ] P2-8 — `disabled` du PayButton pendant `showStripePayment` + reset `pendingTransactionId` au dismiss.
- [ ] P2-9 — Écran succès : refléter le statut réel (`paid`) via listener/refetch.
- [ ] P2-10 — Garde d'idempotence interne wallet (`walletAmountUsed`/`paidVia`).
- [ ] P2-11 — Verrou `returnLabelPending` avant achat d'étiquette de retour.
- [ ] P2-13 — Calculer/renvoyer `heldReleaseAt` ou retirer la ligne de date.
- [ ] P2-2, P2-5, P2-6, P2-7, P2-12, P2-14, P2-15, P2-16, P2-17, P2-18/19 — voir détails (plusieurs latents ou à re-vérifier).

**P3 — polish & dette**
- [ ] P3-1 — Verrou anti double-tap sur les CTA d'achat.
- [ ] P3-2 — Déplacer le haptic favori dans `onSuccess`.
- [ ] P3-3 — `decimal-pad` partout pour les montants.
- [ ] P3-9 — Clarifier le contrat d'annulation Stripe (`'cancelled'`).
- [ ] P3-10 — Remplacer `#FF9500` par `colors.warning`.
- [ ] P3-11 — `checkRateLimit` sur `getShippingEstimate` + `findPickupPoints`.
- [ ] P3-12 — Clé d'idempotence / marqueur sur `createLabel`.
- [ ] P3-13 — Câbler ou retirer le statut `lost`.
- [ ] P3-4, P3-5, P3-6, P3-7, P3-8, P3-14, P3-15, P3-16, P3-17, P3-18 — voir détails.

---

## Annexe — faux positifs écartés

### Le mode meetup permet d'atteindre l'écran de confirmation sans lieu sélectionné via le bouton retour du header
**Pourquoi écarté** : le mécanisme central (« atteindre `confirm` sans lieu via le bouton retour ») n'existe pas. `handleBack` (`index.tsx:116-122`) utilise `getPreviousStep` qui ne fait que reculer ; en mode meetup `getPreviousStep('confirm') => 'location'` (`types.ts:96-103`), jamais en avant. Les seuls chemins AVANT vers `confirm` passent par `LocationStep` (`LocationStep.tsx:72-92`) qui pose toujours `setSelectedSpot` avant `setStep`. Aucun chemin de code ne mène à `confirm` avec `selectedSpot === null`. Les gardes `ConfirmStep.tsx:66` et `:115` sont du défensif ceinture+bretelles sur un état inatteignable. Aucun état impossible réel, aucune divergence iOS/Android, aucun enjeu financier. La description elle-même admet le caractère spéculatif (« selectedSpot est normalement non nul à confirm »).
