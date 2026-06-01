# Re-vérification des P0 — post-fix & post-deploy (2026-06-01)

> Re-vérification adversariale (lecture seule) des P0 audités, après correctifs et déploiement annoncé sur `seconde-b47a6`. Chaque verdict est ancré sur des preuves `file:line` du tree local. Aucune mutation effectuée. Limite transverse : le déploiement effectif en prod n'a pas pu être confirmé via CLI/gcloud depuis cet environnement lecture seule (et l'émulateur Firebase n'a pas pu tourner — JDK 21 absent, JDK 17 seul) ; les verdicts reposent sur une revue statique rigoureuse du code/rules/index committé, conforme au contexte fourni.

## Verdict global

| Verdict | Compte |
|---|---|
| `closed` (clos) | 13 |
| `partial` (partiellement clos) | 3 |
| `still_open` (encore ouvert) | 0 |
| `deferred` (différé assumé) | 1 |
| **Total re-vérifié (détaillé)** | **17** |

Aucun P0 n'est `still_open`. 3 P0 sont `partial` (correctif serveur en place mais nuance critique non couverte ou wiring client manquant) et 1 est `deferred` (structure prête, en attente de secrets + redeploy). Confiance `high` sur les 17 verdicts.

> Note de portée : le lot P0 d'origine est annoncé à 27 items ; ce rapport détaille les 17 items re-vérifiés fournis dans le jeu de résultats (13 + 3 + 0 + 1). Les items non listés ici ne font pas partie du jeu de re-vérification transmis.

## Détail par P0

### 1. `shop-self-approval` — closed (high)
- **Evidence** : `firestore.rules:72-78` (create verrouillé : `ownerId==auth.uid`, `status` absent ou `'pending'`, `!hasAny(['verificationDetails','plan','forfait','tier','feesTier','buyerFeePercent','isVerified'])`) ; `firestore.rules:87-96` (update owner ne peut pas diff `affectedKeys().hasAny([...status,verificationDetails,plan,forfait...])`) ; `firestore.rules:99` (`delete: if false`) ; `firestore.rules:22-33` (`isAdmin()` sur claim/champ non auto-inscriptible) ; `services/shopService.ts:47` (`status:'pending'` forcé), `services/shopService.ts:293-294` (strip status+verificationDetails), `services/shopService.ts:322-333` (approbation via callable Admin SDK).
- **Notes** : 6+ vecteurs testés (status approved create/update, injection verificationDetails, auto-octroi forfait, hijack ownerId, no-op status) tous bloqués. Champs fee/forfait verrouillés préventivement (défense en profondeur). Déploiement prod non vérifié depuis cet env, mais le code rules ferme la faille.

### 2. `stripe-fields-lock` — closed (high)
- **Evidence** : `firestore.rules:234-244` (`protectedUserFields()` = 7 champs Stripe gate) ; update lock `firestore.rules:208-211` (`diff().affectedKeys()` couvre add/change/remove → impossible de rediriger `stripeAccountId` ni de forcer charges/payouts à true) ; create lock `firestore.rules:198-200` ; lecture du gate dans `functions/src/callable/wallet.ts:293-310` (walletWithdraw) ; écriture EXCLUSIVE par le webhook Admin SDK `functions/src/http/webhooks.ts:1850-1858` ; tests `tests/security/users.rules.test.ts:123-173`.
- **Notes** : Lock deny-by-omission concluant en analyse statique CEL. CAVEAT : suite émulateur non exécutée (JDK 17 seul ; firebase-tools exige JDK 21+). Parité deploy↔prod supposée par l'énoncé ; pas de byte-compare des rules live.

### 3. `shop-moderation-cf` — closed (high)
- **Evidence** : `functions/src/callable/shopModeration.ts:148-217` (approve/reject/suspendShop : onCall v2, region northamerica-northeast1, 512MiB, guard `request.auth` + `assertAdmin`) ; `functions/src/callable/shopModeration.ts:46-58` (`assertAdmin` claim OU `users/{uid}.isAdmin`) ; `functions/src/callable/shopModeration.ts:72-101` (`runTransaction`, idempotent, adminUid dérivé de `request.auth`) ; `functions/src/index.ts:150-155` ; client `services/shopService.ts:328-379` (httpsCallable, aucun updateDoc status) ; `app/admin/shops.tsx:113,136` + `app/admin/shop-detail/[id].tsx:70,93` ; tests `tests/security/shops.rules.test.ts`.
- **Notes** : 3 couches closes (callable admin-guard+runTransaction, rules field-lock, client httpsCallable). LIMITE : tests non exécutés (émulateur JDK 21 absent). Gap UI non sécuritaire : callable `suspendShop` existe mais aucun écran admin n'expose l'action suspend (seulement approve/reject) — n'affecte pas le verdict P0.

### 4. `reports-pipeline` — closed (high)
- **Evidence** : `functions/src/callable/shopModeration.ts:222` (getPendingReports) + `:276` (triageReport), gate `:228/:282` `assertAdmin` ; `functions/src/index.ts:149-155` ; client `app/admin/reports.tsx:70-78,127,172` ; index `firestore.indexes.json:4-15` (reports status ASC + createdAt DESC, matche la query) ; rules cycle de vie `firestore.rules:573-578` (create : status pending only, pas de reviewedBy/reviewedAt/resolution, reporterId==auth.uid) et `firestore.rules:554-561` (read/update réservés à `admin==true || moderator==true`) ; triageReport sous `runTransaction` `:322-340`.
- **Notes** : 3 tentatives adverses bloquées (rapport auto-résolu, lecture queue non-admin, écriture directe reviewedBy/resolution). GAP défense en profondeur (non-P0, non reproductible par non privilégié) : la règle `allow update` reports `:559-561` n'a AUCUNE validation de champ → un porteur de claim `moderator` pourrait écrire status/reviewedBy/resolution en Web SDK brut, contournant les invariants de la callable (qui n'honore que `admin`, pas `moderator`). À durcir, ne rouvre pas le P0.

### 5. `swap-ownership` — closed (high)
- **Evidence** : `functions/src/callable/swaps.ts:69-109` (`validateArticlesAvailable` lit `sellerId` autoritatif via tx, pas le payload client ; `:90` rejette si `data.sellerId !== expectedOwnerId`) ; proposeMultiSwap `:345-347` (validation des DEUX côtés sous runTransaction) + `:284` (initiator lié à `request.auth.uid`) ; acceptSwap `:479-480` (re-validation à l'acceptation, receiver-only `:461`) ; rules `firestore.rules:503` (`create: if false`), `:507-519` (update verrouillé à la transition proposed→declined, ids immuables), `:523` (delete false) ; unique créateur Admin SDK `swaps.ts:377`.
- **Notes** : invariant `expectedOwnerId == article.sellerId` appliqué des deux côtés à la proposition ET à l'acceptation. Aucun chemin de création client/serveur alternatif. Fermeture indépendante de toute action manuelle restante. `tsc --noEmit` exit 0.

### 6. `swap-topup-race-refund` — closed (high)
- **Evidence** : `functions/src/http/webhooks.ts:768` (`CANCELLED_LIKE`) + `:798` (branche cancelled→refund) ; refund `:897-903` avec `idempotencyKey: 'rf_swap_${swapId}'` ; même clé côté callable `functions/src/callable/swaps.ts:761` ; dead-letter sur Stripe non configuré `:878` et sur throw `:915` (writeFailedOperation + retryFailedOperations) ; garde anti-tamper montant `webhooks.ts:780-788`.
- **Notes** : interleavings (A) webhook après cancel/declined/disputed → refund + `topUpRefundReconciledAt` pré-posé (`:811`) court-circuite `handleSwapTopUpRefund` (`:1734`) — pas de débit erroné ; (B) callable avant `topUpPaidAt` → early return puis webhook rattrape ; (C) double-fire → même idempotencyKey, dedup Stripe. `tsc --noEmit` exit 0. MINEUR : le cron d'expiration écrit `'cancelled'` (`scheduled/swaps.ts:119`) donc l'entrée `'expired'` de CANCELLED_LIKE est défensive/morte (inoffensif). TEST-DEBT : `functions/src/http/webhooks.test.ts` ne couvre pas la branche refund cancelled-race — régression à ajouter (logique runtime saine).

### 7. `open-swap-dispute` — **partial** (high)
- **Evidence** : REACHABILITY close — `services/swapService.ts:425-431` (`openSwapDispute` → httpsCallable) ; `features/swap/components/SwapActions.tsx:189` (DisputeButton sur `status==='shipping'`), `:226` (appel) ; backend `functions/src/callable/swaps.ts:1414` (auth), `:1440` (participant only), `:1444` (status shipping|completed). MAIS NUANCE NON CORRIGÉE — refund conditionné `if (!swapData.topUpReleasedAt)` (`swaps.ts:1463`), or confirmSwapReception pose `topUpReleasedAt` immédiatement à la double confirmation (`swaps.ts:1171-1177`) et crédite `pendingBalance→balance` (`:1182-1189`). Aucun bucket `heldBalance` / fenêtre DISPUTE_WINDOW pour le top-up swap. Bouton uniquement sur `'shipping'` (`SwapActions.tsx:189`), aucun sur `'completed'` alors que la callable l'accepte.
- **Notes** : voir section dédiée ci-dessous.

### 8. `swap-contact-chatid` — closed (high)
- **Evidence** : `features/swap/components/SwapContactButton.tsx:40-41` (`createOrGetChat(...)` puis `router.push('/chat/${chat.id}')` — plus de UID brut) ; `services/chatService.ts:102-166` (retourne `Chat.id` doc déterministe `uid1__uid2[__articleId]`, `:97-100`) ; consommation `app/chat/[id].tsx:63,77` (param traité comme chatId).
- **Notes** : aucune push UID brute résiduelle dans `features/swap/` ; createOrGetChat garde self-chat (`:109`) et bloqués (`:115`). Note non bloquante : pas d'articleId passé → chat swap général (par design).

### 9. `meetup-completion` — **partial** (high)
- **Evidence** : SERVEUR OK — `functions/src/callable/payments.ts:1811` (completeMeetupTransaction buyer OU seller), `:1831-1836` (status meetup_completed) ; reportMeetupNoShow `payments.ts:1917`, `:1990` (status→disputed), `:2005` (isSold:false), `:2010-2025` (dispute open), idempotent `:1891,1970` ; backstop expiry `scheduled/transactionExpiration.ts:188-279` (7j, status→cancelled, isSold:false) + index présent ; export `index.ts:72,73,212`. GAP WIRING CLIENT — `services/chatService.ts:1167-1191` (`reportNoShow` cosmétique : écrit `offer.meetup.noShow` + sendSystemMessage, n'appelle JAMAIS la callable) ; UI `app/chat/[id].tsx:299` appelle cette méthode obsolète ; `reportMeetupNoShow` a ZÉRO appelant hors functions. completeMeetup buyer-only en pratique : `chatService.ts:1212-1217` query `where('buyerId','==',userId)` → le vendeur obtient un snapshot vide (`:1225`).
- **Notes** : voir section dédiée ci-dessous.

### 10. `delete-account-gate` — closed (high)
- **Evidence** : `functions/src/callable/users.ts:45-108` (gate pré-mutation AVANT bulkWriter `:110`) : `sellerDebt>0` (`:57-63`), balance/pendingBalance/heldBalance>0 (`:65-72`), litiges open (`:78-87` `status=='open'`), tx non terminales (`:94-108`) ; release username avec garde propriété `:158-164` (delete seulement si `usernameSnap.uid===uid`, shape `username.ts:185`) ; client `app/settings/delete-account.tsx:95-96,117-119` (affiche message serveur). Vecteurs : pas de bypass (trigger onDelete v1 retiré `users.ts:6` ; les 2 `firebaseUser.delete()` sont rollback signup `authService.ts:249` et gated isNewUser `:594`) ; index disputes `firestore.indexes.json:1147-1169`.
- **Notes** : `tsc --noEmit` passe, git clean. Gate fail-closed (index manquant/erreur read → suppression refusée), sûr. Résolution dispute hors 'open' = admin-side (non bloquant permanent).

### 11. `push-apns-fcm` — closed (high)
- **Evidence** : partition serveur à TOUS les sites d'envoi FCM + prune index aligné — `functions/src/utils/notifications.ts:40-54` (`partitionTokens`), `:236-248` (envoi fcmTokens only), `:294` (`arrayRemove(fcmTokens[index])`), `:329-337` ; `functions/src/triggers/messages.ts:110-120,229-231` ; `functions/src/triggers/swaps.ts:57-67,134-136` ; `functions/src/scheduled/savedSearches.ts:97-99,279-281` ; client persiste FCM only via `isFcmRegistrationToken` `hooks/useNotificationSetup.ts:95-100,255-263,343-350` ; channels Android `saved_searches` (`:58`) + `orders` (`:65`). `tsc --noEmit` exit 0.
- **Notes** : 4 sites d'envoi exhaustifs, aucun bypass `sendToDevice/sendAll`. Path iOS push intentionnellement NON fonctionnel (TODO push-ios `useNotificationSetup.ts:252-254`, APNs brut droppé) — hors-scope assumé. Le P0 scopé (stop envoi/purge APNs brut via FCM, persist FCM only, channels Android) est clos.

### 12. `notif-payload-key` — closed (high)
- **Evidence** : producteur `functions/src/scheduled/savedSearches.ts:235` (`savedSearchId: searchId`, commentaire fix `:233-234`) ; consommateur `hooks/useNotificationSetup.ts:143-150` (lit `data.savedSearchId` → getSavedSearchById → resetNewItemsCount) ; type `store/notificationStore.ts:29` ; deeplink serveur `functions/src/utils/notifications.ts:97-98` ; reset effectif `services/savedSearchService.ts:214-219` (`newItemsCount:0`).
- **Notes** : aucun producteur survivant n'émet l'ancienne clé `searchId` (occurrences = noms de variables locales). Mismatch de channel aussi corrigé (`useNotificationSetup.ts:58` matche `savedSearches.ts:245`). Caveat plateforme iOS séparé (TODO push-ios), pas une régression de clé.

### 13. `search-index-trigger` — closed (high)
- **Evidence** : `functions/src/triggers/products.ts:43-49` (garde de-index absence-safe : `moderationStatus` absent → `isModerationBlocked=false` → article legacy indexé, jamais wipé) ; `functions/src/scripts/backfillSearchIndex.ts` existe (324 lignes, 2 phases) mais NON exporté comme CF (`index.ts:162` n'exporte que updateSearchIndex/updateUserStats ; aucun import de `scripts/`) ; pas de régression sibling (`triggers/articles.ts:36` de-index uniquement sur transition isActive true→false ; `callable/products.ts:364` stamp `moderationStatus:'approved'` à la création).
- **Notes** : fix code clos et non contournable. CAVEAT (action data différée, pas un gap code) : récupération des articles legacy déjà orphelins (jamais ré-écrits depuis le déploiement du trigger) requiert qu'un OPÉRATEUR lance le backfill one-shot (Phase 1 puis Phase 2) contre `seconde-b47a6` (Admin SDK). Migration manuelle hors deploy functions/rules/indexes ; aucune preuve d'exécution dans le repo. Le trigger ne wipe plus les legacy à l'avenir (P0 scopé clos).

### 14. `block-enforcement` — **partial** (high)
- **Evidence** : happy-path bloqué sur 3 couches mais TOUTES font confiance au `receiverId` fourni par le client, tandis que la visibilité du message est pilotée par le tableau `participants` indépendamment contrôlé client → spoof exploitable sur message-create dans un chat PRÉEXISTANT. (1) `firestore.rules:394` (`isNotBlockedBy(data.receiverId, data.senderId)` paramétré par `receiverId`) ; `:380-396` ne contraint JAMAIS `receiverId ∈ participants` ; (2) `services/chatService.ts:1313-1317` (rendu par `participants array-contains userId`, indépendant de receiverId) ; (3) `functions/src/triggers/messages.ts:75` (`areUsersBlocked(senderId, receiverId)` — même angle mort). EXPLOIT reproductible (fixture CHAT_AB, Alice a bloqué Bob) : Bob écrit `{senderId:BOB, receiverId:CAROL, chatId:CHAT_AB, participants:[ALICE,BOB]}` → toutes les conditions passent, `isNotBlockedBy(CAROL,BOB)=true`, trigger `areUsersBlocked(BOB,CAROL)=false` → message rendu chez Alice. Chat-CREATE correctement clos (`firestore.rules:834-835` vérifie `participants[0]` et `[1]` symétriquement). Tests `tests/security/blocking.rules.test.ts:57` ne couvrent que `receiverId==ALICE`.
- **Notes** : voir section dédiée ci-dessous.

### 15. `meetup-contestation` — closed (high)
- **Evidence** : (1) gate chat non conditionné deliveryType `app/chat/[id].tsx:424` (tx meetup cancelled passe), query non filtrée `:88-92` ; (2) branche meetup `components/ShipmentTracking.tsx:459-462` (encart transparence + bouton "Contester" `:523-536` + RecourseReasonSheet `:539-548`) ; (3) hook activé meetup `ShipmentTracking.tsx:369-374,381` ; (4) producteur backend cohérent `scheduled/transactionExpiration.ts:110,219` (→cancelled) + logAutomatedDecision `:142,244` ; (5) callables sans gate shipping `functions/src/callable/automatedDecisions.ts:134-150,164-232,242-285` ; (6) wiring `index.ts:140-141`, index `firestore.indexes.json:1133-1144`, rules `firestore.rules:780,797`, meta `lib/automatedDecisionMeta.ts:49,71`.
- **Notes** : aucune action manuelle bloquante. Tentatives de contournement infructueuses. Limite : vérif statique ; runtime dépend de l'index composite bâti en prod (déclaré déployé).

### 16. `expo-camera-plugin` — closed (high)
- **Evidence** : `app.config.js:46-51` (entrée `["expo-camera", {cameraPermission:"..."}]`) ; éval node → `HAS_CAMERA:true`, une seule clé `"plugins"` (grep -c = 1) ; dépendance `package.json:53` `"expo-camera": "~56.0.7"`.
- **Notes** : config évalué sans erreur de syntaxe ; usage runtime confirmé (`app/sell/capture.tsx`, `features/sell/components/capture/SellOverlayCapture.tsx`, `components/VisualSearchCamera.tsx`) ; permission Android CAMERA injectée par le config-plugin natif. Tient face à `prebuild --clean`. P0 réellement clos.

### 17. `universal-links` — **deferred** (high)
- **Evidence** : `public/.well-known/apple-app-site-association` et `assetlinks.json` existent (dir servi par `firebase.json` hosting.public="public"), JSON valides. Placeholders explicites : `apple-app-site-association:6` (`"appID":"REPLACE_WITH_APPLE_TEAM_ID.com.seconde.app"`) et `assetlinks.json:8` (`"REPLACE_WITH_ANDROID_RELEASE_SHA256_FINGERPRINT"`). Bundle/package corrects vs `app.config.js` (`:99`, `:163` `com.seconde.app` ; associatedDomains `:80-81`) ; headers Content-Type application/json `firebase.json:21-28`.
- **Notes** : voir section différés ci-dessous.

## P0 NON entièrement clos (partial / still_open) — action requise

Aucun `still_open`. Trois `partial` exigent une action :

### A. `open-swap-dispute` (partial)
Le flow litige est désormais atteignable en `'shipping'` (litige + remboursement OK car top-up non encore libéré). Mais la reco P0 (couplée P1-9) — fenêtre de rétention `heldBalance` du top-up + recours après réception — n'est PAS implémentée : le refund est neutralisé après completion (`swaps.ts:1463` conditionne sur `!topUpReleasedAt`, posé immédiatement par confirmSwapReception `:1171-1177`), et aucun bouton n'expose openSwapDispute sur `status==='completed'` alors que la callable l'accepte (`:1444`). Scénario même du P0 (acheteur ayant reçu un article non conforme) reste inatteignable côté client.
- **Action** : (1) appliquer une rétention `heldBalance`/7j au top-up swap au lieu du release immédiat dans confirmSwapReception (`swaps.ts:1171-1196`) ; (2) exposer DisputeButton aussi sur `'completed'` (`SwapActions.tsx:191+`) ; (3) gérer le refund post-release dans openSwapDispute quand `topUpReleasedAt` est posé (le webhook `handleSwapTopUpRefund` gère déjà `fundsReleased=true` via balance `webhooks.ts:1756-1762`, mais openSwapDispute ne déclenche jamais ce refund).

### B. `meetup-completion` (partial)
Le zombie "isSold à vie" est clos par le backstop scheduler 7j (branche 1b). Mais : le recours no-show n'est PAS câblé (l'UI appelle le `chatService.reportNoShow` cosmétique `:1167-1191` qui n'invoque jamais la callable `reportMeetupNoShow` — zéro appelant hors functions), et la complétion vendeur est inatteignable (`completeMeetup` filtré `where('buyerId','==',userId)` `chatService.ts:1212-1217` → snapshot vide pour le vendeur). Le symptôme P0 d'origine (signaler un no-show ne libère pas l'article ni n'ouvre de dispute) reste reproductible via l'UI.
- **Action** : (1) réécrire `chatService.reportNoShow` en `httpsCallable('reportMeetupNoShow')` ; (2) retirer le filtre `buyerId==userId` dans completeMeetup (ou ajouter un chemin vendeur) pour rendre le "either party" serveur réellement atteignable.

### C. `block-enforcement` (partial) — sévérité P0 maintenue
La victime reçoit toujours les messages du bloqueur via un spoof message-create dans un chat préexistant. Cause racine : l'enforcement du blocage est paramétré par `receiverId` (contrôlé client) alors que la livraison/visibilité est paramétrée par le tableau `participants` (contrôlé client indépendamment) ; les deux ne sont jamais réconciliés. Le cas commun (blocage APRÈS début de conversation, fixture CHAT_AB) est exploitable de bout en bout, et les tests ne couvrent que le cas bien formé `receiverId==ALICE`.
- **Action** : fix sur l'une des couches — (a) `isValidMessageCreate` doit exiger `data.receiverId in data.participants` ET vérifier `isNotBlockedBy` sur le contrepartie réel du chat (le participant ≠ senderId), ou imposer `participants == chat.participants triés` ; (b) le trigger doit dériver le contrepartie depuis le doc chat / `participants` plutôt que de faire confiance à `message.receiverId`. Ajouter une régression : Bob bloqué avec `receiverId` tiers + `participants=[ALICE,BOB]` dans CHAT_AB existant doit `assertFails`.

## Différés assumés (deferred) — secrets / migration / build app

### `universal-links` (deferred)
Structure et JSON prêts et valides, MAIS le fix n'est pas fonctionnellement clos tant que deux secrets ne sont pas remplis puis re-déployés : Apple Team ID (`apple-app-site-association:6`) et empreinte SHA256 du certificat de release Android (`assetlinks.json:8`). Tant qu'ils ne sont pas remplis, Universal Links / App Links ne résoudront pas en prod.
- **Action post-deploy** : remplir les deux placeholders, redéployer hosting, puis `curl https://seconde.app/.well-known/apple-app-site-association` doit retourner le JSON en `application/json`. Note non bloquante : le rewrite catch-all `**`→/index.html ne masque pas les fichiers well-known (Firebase priorise les statiques de `public/` + headers explicites ciblent ces chemins).

### Actions data/migration différées hors deploy (non `deferred` mais à noter)
- `search-index-trigger` : exécuter le backfill one-shot `functions/src/scripts/backfillSearchIndex.ts` (Phase 1 puis Phase 2, ordre impératif `scripts/backfillSearchIndex.ts:29-36`) contre `seconde-b47a6` pour récupérer les articles legacy orphelins déjà invisibles. Le trigger ne wipe plus les legacy à l'avenir.

### Dette de test (non bloquante)
- `swap-topup-race-refund` : ajouter un test exerçant la branche refund cancelled-race dans `functions/src/http/webhooks.test.ts` (logique runtime saine, mais non couverte).
- `block-enforcement` : régression manquante sur le spoof receiverId/participants (voir action C).
