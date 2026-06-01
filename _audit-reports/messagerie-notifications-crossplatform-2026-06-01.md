# Audit Messagerie, Notifications & Temps réel — Cross-platform iOS/Android (2026-06-01)

## Résumé exécutif

L'audit couvre la messagerie (conversation, liste, modération), le centre de notifications in-app, le push (FCM/APNs, canaux Android, permissions), les deep links depuis notification, les décisions automatisées (Loi 25) et la cohérence iOS ↔ Android. Quatre P0 dominent : le push iOS est structurellement cassé (token APNs brut envoyé à FCM → aucune notif iOS + token auto-supprimé), le blocage de messagerie n'est jamais appliqué côté serveur (la victime continue de recevoir les messages du harceleur), la notification de recherche sauvegardée a un tap mort (clé de payload `searchId` vs `savedSearchId`), et le droit Loi 25 à la révision humaine d'une annulation MEETUP automatique est techniquement inaccessible. Les P1 concentrent les écarts cross-plateforme et le routing de notifications (canaux Android manquants, types non alignés front/back, taps qui n'ouvrent rien ou ouvrent la mauvaise destination, préférences transactionnelles ignorées, badges non fiables). La couche notification souffre d'une cause racine transverse : trois sources de types divergentes (backend `string` libre, `PushNotificationType`, `NotificationType`) sans contrat partagé, et un champ `deepLink` produit par le backend mais jamais consommé côté client. La messagerie souffre d'absence d'optimistic send, de pagination et de gestion hors-ligne. Aucun faux positif retenu : tous les findings ont été vérifiés ligne à ligne dans le code réel.

| Sévérité | Nombre |
|----------|--------|
| P0 | 4 |
| P1 | 16 |
| P2 | 32 |
| P3 | 13 |
| **Total** | **65** |

> Note : plusieurs findings ont été révisés à la baisse par la vérification (ex. canaux Android manquants P1→P2 car FCM `notification` retombe sur un canal par défaut sans drop ; notification approbation boutique P1→P2 car l'erreur est avalée par le wrapper). Les sévérités du tableau reflètent les `revised_severity`.

---

## Findings P0

### 1. Push iOS structurellement cassés : token APNs brut envoyé à FCM (Android OK, iOS KO)
- **Sévérité** : P0 · **Plateforme** : ios
- **Fichiers** : `hooks/useNotificationSetup.ts:200`, `services/userService.ts:265`, `functions/src/utils/notifications.ts:216` et `:299`, `functions/src/triggers/messages.ts:131`, `functions/src/scheduled/savedSearches.ts:253`, `functions/src/triggers/swaps.ts:104`, `app.config.js:70`
- **Description** : Le client appelle `Notifications.getDevicePushTokenAsync()` (`useNotificationSetup.ts:200`) et stocke `pushToken.data` dans le tableau `fcmTokens` (`userService.ts:265-270`). Sur iOS en expo-notifications nu (pas de `@react-native-firebase/messaging`, pas d'`expo-server-sdk`, pas de `getExpoPushTokenAsync`), ce token est le **token APNs hexadécimal brut** (preuve native : `expo-notifications/ios/.../NotificationsAppDelegateSubscriber.swift` convertit le `deviceToken` en hex). Or tout le backend envoie via `admin.messaging().sendEach([{ token, ... }])`, qui exige un token d'enregistrement FCM. FCM rejette le token APNs avec `registration-token-not-registered`, ce qui déclenche la branche de suppression auto (`notifications.ts:225-234`, `messages.ts:147-159`).
- **Impact** : Tous les utilisateurs iOS ne reçoivent AUCUNE notification push (messages, offres, baisses de prix, swaps, saved searches), et leur token est supprimé au premier envoi. Écart de plateforme total : Android reçoit (vrai registration token FCM), iOS non. Le `GoogleService-Info.plist` (`app.config.js:70`) est un faux ami : consommé uniquement par Google Sign-In, il ne câble pas FCM sur iOS.
- **Recommandation** : Passer par Expo Push (`getExpoPushTokenAsync` côté client + Expo Push API/`expo-server-sdk` côté functions) OU intégrer `@react-native-firebase/messaging` (`getToken()` après `registerDeviceForRemoteMessages`). Ne jamais envoyer un token APNs brut à `admin.messaging()`.

### 2. Blocage de la messagerie unilatéral et contournable — aucune enforcement serveur (le commentaire affirme le contraire)
- **Sévérité** : P0 · **Plateforme** : both
- **Fichiers** : `services/moderationService.ts:263-280`, `services/chatService.ts:327-364`, `functions/src/callable/chats.ts:37-171`, `firestore.rules:244-325` et `:729-761`, `functions/src/triggers/messages.ts:17-170`, `functions/src/callable/swaps.ts:95-108`, `features/chat/hooks/useChatModeration.ts:49`
- **Description** : `areUsersBlocked` (`moderationService.ts:272-275`) ne vérifie QUE si l'utilisateur courant a bloqué l'autre (`isUserBlocked(currentUserId, otherUserId)` lit seulement le doc de l'appelant). Le commentaire `moderationService.ts:259-261` affirme que la direction inverse est « enforced server-side by Cloud Functions » — c'est FAUX : le seul check à l'envoi est ce même appel client (`chatService.ts:333`), le message est écrit en direct via `addDoc` (`chatService.ts:364`), les règles `messages`/`chats` ne référencent jamais `blockedUsers`, `chats.ts` ne contient que `consolidateChatDuplicates`, et le trigger `sendMessageNotification` ne filtre pas. Contre-exemple correct : `swaps.ts:95-108` vérifie bien les DEUX `blockedUsers` côté serveur.
- **Impact** : Si A bloque B, B (qui n'a rien dans son `blockedUsers`) voit son check passer → le message PASSE. La victime A continue de recevoir les messages de B. Promesse explicite à l'utilisateur (`useChatModeration.ts:49` « Cette personne ne pourra plus vous contacter ») non tenue. Contournable trivialement par un client modifié (aucune barrière serveur).
- **Recommandation** : Router l'envoi via une Cloud Function callable (comme swaps) vérifiant les DEUX directions de `blockedUsers` côté Admin SDK ; corriger/supprimer le commentaire mensonger `moderationService.ts:259-261`.

### 3. Notification « recherche sauvegardée » : clé de payload `searchId` vs `savedSearchId` — le tap ne navigue jamais
- **Sévérité** : P0 · **Plateforme** : both
- **Fichiers** : `functions/src/scheduled/savedSearches.ts:226`, `hooks/useNotificationSetup.ts:97`, `functions/src/utils/notifications.ts:51`, `store/notificationStore.ts:29`
- **Description** : Le producteur planifié (toutes les 15 min) émet `data.searchId` (`savedSearches.ts:228`, valeur = `searchDoc.id`). Le consommateur lit `data.savedSearchId` (`useNotificationSetup.ts:98 if (data.savedSearchId && userId)`). Comme `data.savedSearchId` est `undefined`, tout le bloc de navigation est court-circuité ; le `return` ligne 119 est atteint sans `router.push`. Le fallback `/search` (ligne 116) n'est atteint que si `getSavedSearchById` throw, pas quand la clé manque. Le type `PushNotificationData` (`notificationStore.ts:29`) ne déclare que `savedSearchId`. `savedSearches.ts` contourne `sendPushNotification`/`buildDeepLink` (qui utilisent pourtant la bonne clé), construisant son propre payload FCM inline.
- **Impact** : Sur iOS comme Android, taper une notif de recherche sauvegardée n'ouvre rien (driver de réengagement cassé). De plus `resetNewItemsCount` n'est jamais appelé → le compteur de nouveaux articles ne se remet pas à zéro.
- **Recommandation** : Renommer la clé en `savedSearchId` dans `savedSearches.ts:228` (`savedSearchId: searchId`), idéalement passer par `sendPushNotification(...,'saved_search')` ; ajouter un test d'égalité de clés producteur/consommateur par type. Créer aussi le canal Android `saved_searches` manquant.

### 4. Décision automatisée sur commande MEETUP : droit Loi 25 (explication + révision humaine) jamais exposé à l'utilisateur
- **Sévérité** : P0 · **Plateforme** : both
- **Fichiers** : `app/chat/[id].tsx:421`, `components/ShipmentTracking.tsx:369`, `functions/src/scheduled/transactionExpiration.ts:127`, `types/index.ts:335`, `hooks/useNotificationSetup.ts`, `lib/automatedDecisionMeta.ts`
- **Description** : `expireOrphanedTransactions` annule automatiquement une commande meetup non confirmée sous 48h, journalise `transaction_expired` (`transactionExpiration.ts:127-137`, criteria `status='meetup_pending'`) et envoie une notif invitant à contester (`:140-145`). Mais la SEULE surface UI exposant l'explication « Pourquoi cette décision ? » et le bouton « Contester » est `ShipmentTracking`, monté uniquement si `transaction.deliveryType === 'shipping'` (`app/chat/[id].tsx:421`). Pour une transaction meetup, `deliveryType === 'meetup'` → `ShipmentTracking` jamais rendu → ni explication ni mécanisme de révision humaine accessible. Aggravant : la notif meetup ne transporte aucun `chatId` (`transactionExpiration.ts:144`), donc le tap route vers `/article/{id}` (fallback `useNotificationSetup.ts:132-133`), pas même vers le chat.
- **Impact** : Non-conformité Loi 25 art. 12.1 pour toute commande en main propre annulée automatiquement (cas nominal du flow meetup) : promesse « vous pouvez contester » + droit légal effectif inaccessibles. Double inaccessibilité (mauvaise destination + composant gardé sur 'shipping').
- **Recommandation** : Découpler la surface de transparence/contestation de `ShipmentTracking` et la rendre dès que `useAutomatedDecision.hasAutomatedDecision` est vrai, quel que soit le `deliveryType` ; ajouter le routage notification (inclure `chatId` ou un écran de détail commande, et un case explicite `order_cancelled`).

---

## Findings P1 — bugs & écarts iOS ↔ Android

### 5. Notifications in-app écrites avec des types absents de l'union UI → icône générique + tap routing cassé
- **Sévérité** : P1 · **Plateforme** : both
- **Fichiers** : `functions/src/utils/notifications.ts`, `functions/src/triggers/messages.ts`, `app/notifications.tsx`, `types/index.ts`, plus les producteurs `trackingTransition.ts`, `webhooks.ts`, `releaseHeldFunds.ts`, `swaps.ts`, `transactionExpiration.ts`, `returnRefund.ts`, `reviews.ts`, `privacyIncidents.ts`
- **Description** : `createInAppNotification` (`notifications.ts:97`) écrit la string brute (`'message'`, `'offer'`, `'swap_update'`, `'new_sale'`, `'order_*'`, `'review_received'`, `'funds_released'`, `'privacy_incident'`). Aucune n'existe dans l'union `NotificationType` UI (`types/index.ts:580-608`, qui a `'new_message'`/`'offer_received'`) ni dans `notificationIcons` (`app/notifications.tsx:26-55`). Résultat : fallback bell générique (`:86`). Le tap (`:160-168`) ne route que sur `chatId`/`articleId`/`partyId` et ignore `swapId`/`transactionId`/`deepLink`.
- **Impact** : Toute la moitié métier du centre (ventes, livraisons, remboursements, avis, swaps) s'affiche avec une icône neutre et le tap n'amène pas à l'écran attendu.
- **Recommandation** : Aligner les `type` serveur sur l'union UI (ou étendre l'union + map + routing) et faire consommer `data.deepLink` (déjà calculé correctement côté serveur) plutôt que de re-dériver depuis `articleId`.

### 6. firestore.rules bloque la création client de notifications → notif d'approbation/refus de boutique perdue (échec silencieux)
- **Sévérité** : P1 (révisé P2 par vérification) · **Plateforme** : both
- **Fichiers** : `firestore.rules:72`, `services/notificationService.ts`, `app/admin/shop-detail/[id].tsx`, `app/admin/shops.tsx`, `services/shopService.ts`, `functions/src/utils/notifications.ts`
- **Description** : `firestore.rules:72 allow create: if false`, mais `NotificationService.createNotification` crée via SDK client (`notificationService.ts:40`). L'`addDoc` lève permission-denied. CORRECTION de la vérification : l'erreur N'atteint PAS le catch du caller — les wrappers `notifyShopApproved`/`notifyShopRejected`/`notifyAdminNewShop` l'avalent (`notificationService.ts:83-95`, etc.). Donc pas de faux message d'erreur. Le défaut réel est un échec SILENCIEUX : le propriétaire ne reçoit jamais sa notification, et aucune Cloud Function ne crée ces notifs côté serveur.
- **Impact** : Notification fonctionnelle silencieusement perdue (approbation/refus boutique, alerte admin nouvelle boutique). Sévérité révisée P2.
- **Recommandation** : Déplacer la création côté serveur via `createInAppNotification` (callable/trigger sur changement de statut shop) ; retirer les appels client `NotificationService.notify*`. NB : les autres `notify*` client sont aussi bloqués par la même règle.

### 7. Notif push `saved_search` : clé `searchId` vs `savedSearchId` → tap sans navigation (centre notifications)
- **Sévérité** : P1 · **Plateforme** : both
- **Fichiers** : `functions/src/scheduled/savedSearches.ts`, `hooks/useNotificationSetup.ts`, `functions/src/utils/notifications.ts`, `store/notificationStore.ts`
- **Description** : Doublon dimensionnel du finding P0 #3 (même cause racine, dimension « centre in-app »). Le canal Android `saved_searches` (`savedSearches.ts:238`) n'est pas non plus déclaré dans `setupAndroidChannels` (`useNotificationSetup.ts:25-54`).
- **Impact** : Tap mort + canal Android mal catégorisé.
- **Recommandation** : Identique au #3.

### 8. Channels Android `saved_searches` et `orders` utilisés côté serveur mais jamais déclarés côté client
- **Sévérité** : P1 (révisé P2 par vérification) · **Plateforme** : android
- **Fichiers** : `hooks/useNotificationSetup.ts`, `functions/src/scheduled/savedSearches.ts`, `functions/src/utils/notifications.ts`, `app.config.js`
- **Description** : `setupAndroidChannels` ne crée que `messages`/`offers`/`notifications`/`swaps` (`useNotificationSetup.ts:26,35,42,48`). Le backend cible `saved_searches` (`savedSearches.ts:238`) et `orders` (`notifications.ts:132-137`, pour `new_sale`/`order_*`). CORRECTION : pour des messages FCM de type `notification`, un channelId inexistant ne droppe PAS la notif — Android retombe sur un canal « Miscellaneous » par défaut. Pas d'écart « iOS affichées / Android silencieuses ».
- **Impact** : Perte de contrôle de catégorisation/son/importance et préférences utilisateur ; pas une perte d'événements. Sévérité révisée P2.
- **Recommandation** : Déclarer `orders` et `saved_searches` dans `setupAndroidChannels` (importance HIGH adaptée) ou remapper le backend vers des canaux existants ; dériver la liste d'une source partagée.

### 9. Préférences notification transactionnelles jamais respectées côté backend (toggles morts)
- **Sévérité** : P1 · **Plateforme** : backend
- **Fichiers** : `app/settings/notifications.tsx`, `functions/src/utils/notifications.ts`, `functions/src/triggers/favorites.ts`, `functions/src/triggers/messages.ts`, `functions/src/http/webhooks.ts`
- **Description** : Settings expose `newMessages`/`newOrders`/`offerReceived`/`offerResponse` (par défaut ON). Côté functions, seuls `push` (master), `articleFavorited` et `priceDrops` sont vérifiés. `sendPushNotification` (`notifications.ts:153-244`) ne lit que `prefs?.push` (`:172-173`), jamais une clé par type. CORRECTION aggravante : le push message ne passe même pas par `sendPushNotification` — `sendMessageNotification` (`messages.ts:17-159`) envoie via `sendEach` inline sans AUCUNE lecture de préférence (donc bypass même du master `push`).
- **Impact** : Couper « Nouvelles ventes » ou « Propositions d'achat » ne change rien ; attente de consentement (Loi 25) rompue.
- **Recommandation** : Map `notificationType` → clé de préférence honorée centralement ET router `sendMessageNotification` par le même helper de gating.

### 10. Notifications ventes/commandes/avis non navigables au tap (push et in-app)
- **Sévérité** : P1 · **Plateforme** : both
- **Fichiers** : `hooks/useNotificationSetup.ts`, `store/notificationStore.ts`, `app/notifications.tsx`, `types/index.ts`, `functions/src/utils/notifications.ts`
- **Description** : `new_sale`/`order_*`/`review_received` absents de `PushNotificationType` et de `routeFromNotificationData`. Le `default` route sur `articleId` → `new_sale`/`order_*` (qui portent `transactionId, articleId`) ouvrent `/article` (mauvaise destination, souvent article vendu), `review_received` (qui ne porte que `reviewId, reviewerId`) → rien. In-app `handleNotificationPress` (`notifications.tsx:160-168`) idem. Le `deepLink` backend (vers `/my-orders`, `/notifications`) n'est jamais consommé client.
- **Impact** : Navigation cassée ou incorrecte sur vente, commande, avis, swap, saved_search ; iOS et Android.
- **Recommandation** : Étendre le routing (`transactionId → /my-orders`) ou, mieux, consommer `data.deepLink` dans les deux consommateurs.

### 11. La liste se réordonne sans nouveau message (tri par `updatedAt`, affichage de `lastMessageTimestamp`)
- **Sévérité** : P1 · **Plateforme** : both
- **Fichiers** : `services/chatService.ts:1383`, `app/(tabs)/messages.tsx:267`, `functions/src/triggers/users.ts:99`/`:111`, `functions/src/triggers/articles.ts:225`, `store/chatStore.ts`, `hooks/useChatListener.ts`
- **Description** : La query liste trie par `orderBy('updatedAt','desc')` (`chatService.ts:1383`) mais l'item affiche `formatTimestampStatic(chat.lastMessageTimestamp)` (`messages.tsx:267`). Les triggers de pure propagation (changement de nom/avatar `users.ts`, mise à jour article `articles.ts`) bumpent `updatedAt` sans toucher `lastMessageTimestamp`. Aucun re-tri client n'annule l'ordre serveur.
- **Impact** : Une vieille conversation remonte en tête sans nouveau message, avec un horodatage périmé (« Lun. ») qui contredit la position. Confusion sur « qui m'a écrit récemment ».
- **Recommandation** : Trier sur `lastMessageTimestamp` (index dédié) OU isoler la propagation dans un champ `infoUpdatedAt`. (firebase-backend pour triggers/index + rn-expo-dev pour la query.)

### 12. Les conversations initiées depuis un profil utilisateur tombent dans « Achats » pour les deux participants
- **Sévérité** : P1 · **Plateforme** : both
- **Fichiers** : `app/user/[id].tsx:217`, `services/chatService.ts:102`/`:130`/`:257`/`:269`, `app/(tabs)/messages.tsx:26`/`:74`, `types/index.ts:315`
- **Description** : `createOrGetChat(currentUser.id, id)` sans `articleId` (`user/[id].tsx:217`) → `sellerId` non défini (`chatService.ts:269 if (articleSellerId)`). `getConversationType` : `if (chat.sellerId === user.id) return 'ventes'; return 'achats'` (`messages.tsx:74-83`) → avec `sellerId` undefined, faux pour TOUT le monde → « Achats » pour les deux. Pas de bucket neutre (`ConversationType = 'achats' | 'ventes'`). Onglet par défaut `'ventes'` → le destinataire peut ne jamais voir la conversation.
- **Impact** : Conversation de contact direct rangée dans « Achats » des deux côtés ; risque qu'elle ne soit jamais vue.
- **Recommandation** : Ajouter un segment « Autres » pour les chats sans `sellerId`, ou catégoriser par rôle réel (`sellerId` OU `buyerId`) sans forcer le fallback « achats ».

### 13. Conversation bloquée toujours visible dans les listes des deux utilisateurs
- **Sévérité** : P1 · **Plateforme** : both
- **Fichiers** : `app/(tabs)/messages.tsx:85-99`, `store/chatStore.ts`, `hooks/useChat.ts:178-184`, `hooks/useChatListener.ts`, `services/chatService.ts`, `services/moderationService.ts`, `app/chat/[id].tsx`, `features/chat/hooks/useChatModeration.ts`, `firestore.rules`
- **Description** : `filteredChats` filtre uniquement par type (`messages.tsx:85-87`), aucun filtre blocage (ni store, ni listener, ni hook). Le doc chat n'est jamais supprimé (`firestore.rules allow delete: if false`). `getChatById` (`chatService.ts:1274`) n'a aucune garde blocage. L'écran thread ne désactive rien. Blocage unidirectionnel : côté bloqueur, conv visible + erreur seulement au send ; côté bloqué, son check passe → il peut toujours écrire au bloqueur.
- **Impact** : Le blocage paraît ne pas fonctionner ; conversation pleinement vivante des deux côtés.
- **Recommandation** : Filtrer/marquer « Bloqué » les conversations dont l'autre est dans `blockedUsers` (faisable client sans lecture supplémentaire) + garde d'affichage côté thread + vérification serveur bidirectionnelle (lien avec P0 #2).

### 14. Notifications push toujours envoyées par/aux utilisateurs bloqués
- **Sévérité** : P1 · **Plateforme** : both
- **Fichiers** : `functions/src/triggers/messages.ts:17-170`, `services/moderationService.ts:165-280`, `services/chatService.ts:307-403`
- **Description** : `sendMessageNotification` envoie un push FCM au receiver sans vérifier le blocage (`grep blocked` = 0 dans le fichier). Combiné au P0 #2 (les messages des bloqués passent), la victime reçoit message ET push (blocs android `:112-119` + apns `:120-127`).
- **Impact** : Une personne bloquée peut continuer à faire vibrer le téléphone de la victime (harcèlement) — précisément ce que le blocage devait empêcher.
- **Recommandation** : Dans `sendMessageNotification`, court-circuiter si `(receiverData.blockedUsers || []).some(u => u.userId === senderId)` ; idéalement résolu en amont par l'enforcement bidirectionnelle (P0 #2).

### 15. Notification `funds_released` : le tap ne navigue nulle part (aucun routing ni deep link)
- **Sévérité** : P1 · **Plateforme** : both
- **Fichiers** : `functions/src/scheduled/releaseHeldFunds.ts:247`, `functions/src/utils/notifications.ts:76`, `hooks/useNotificationSetup.ts:128`, `store/notificationStore.ts:23`
- **Description** : `releaseHeldFunds.ts:251-252` envoie type `funds_released` avec payload `{ transactionId }` et message « vous pouvez nous le signaler ». `buildDeepLink` n'a pas de case `funds_released` → `default` `''` (`notifications.ts:76-77`). `routeFromNotificationData` n'a pas de case `funds_released` → `default` (`useNotificationSetup.ts:128-139`) ne teste que `chatId`/`articleId`/`partyId`/`swapId`, tous absents. `PushNotificationData` n'a même pas de champ `transactionId`.
- **Impact** : Le vendeur visé par une libération de fonds automatique ne peut atteindre le mécanisme de contestation depuis la notif (dead tap). Droit Loi 25 à la révision humaine inaccessible.
- **Recommandation** : Ajouter un case routing `funds_released` (et un `buildDeepLink`) ouvrant la transaction via `transactionId` vers l'écran exposant explication + bouton Contester ; étendre `PushNotificationData`/`PushNotificationType`.

### 16. Notifications de décision automatisée routées vers `/my-orders` sans guider vers la contestation
- **Sévérité** : P1 · **Plateforme** : both
- **Fichiers** : `functions/src/utils/notifications.ts:59`, `hooks/useNotificationSetup.ts:128`, `app/my-orders.tsx:150`, `app/chat/[id].tsx`, `components/ShipmentTracking.tsx`, `app/notifications.tsx`, `transactionExpiration.ts`, `sweepPendingLabels.ts`
- **Description** : Les notifs `order_cancelled` (`sweepPendingLabels.ts:251-256`, `transactionExpiration.ts:140`/`424`/`579`) ont un `deepLink` `/my-orders` MORT (aucun handler ne lit `data.deepLink`) ; le tap réel route vers `/article/{id}` via le `default`. Pour le cas meetup, même en atteignant le chat, `ShipmentTracking` (seule surface contestation) est gardé sur `'shipping'` → contestation inexistante.
- **Impact** : Parcours de contestation Loi 25 fragmenté et non guidé ; incohérence triple deepLink/tap-push/in-app.
- **Recommandation** : Case explicite `order_cancelled` cohérent dans `routeFromNotificationData` ET `app/notifications.tsx` ; router vers une surface décision + bouton Contester indépendante de `deliveryType`.

### 17. Accusés de lecture morts : le statut de message ne progresse jamais au-delà de `sent`
- **Sévérité** : P1 (dimension temps réel) / P2 (dimension affichage) · **Plateforme** : both
- **Fichiers** : `services/chatService.ts:346-357`/`:563`/`:1260`/`:1412-1434`, `components/ChatBubble.tsx:38-55`, `types/index.ts:234`, `hooks/useChat.ts:86-98`
- **Description** : `ChatBubble.renderStatusIcon` (`:38-55`) expose 4 états ; seul `'read'` colore le double-check en bleu (`colors.primary`, ligne 41). Tout message est créé `status: 'sent'` (`chatService.ts:354`/`563`/`1260`) ; `markMessagesAsRead` (`:1412-1434`) ne touche que `isRead: true`, jamais `status`. `'sending'`/`'delivered'`/`'read'` sont inatteignables (pas d'optimistic send : `useChat.ts:86-98` await direct).
- **Impact** : L'expéditeur reste figé sur un simple check « envoyé » à vie même après lecture ; UI qui promet un accusé de lecture jamais mis à jour. (Deux findings cross-référencés ; la dimension temps réel a été notée P1, la dimension affichage P2.)
- **Recommandation** : Faire écrire `status: 'read'` par `markMessagesAsRead` (en respectant la règle no-undefined-in-Firestore), OU retirer les cas `delivered`/`read`/`sending` du switch tant qu'aucun producteur ne les émet.

### 18. Aucune pagination de l'historique : 100% des messages chargés et rendus d'un coup
- **Sévérité** : P1 · **Plateforme** : both
- **Fichiers** : `services/chatService.ts:1301-1340`, `hooks/useChat.ts:39-53`, `app/chat/[id].tsx:410-428`
- **Description** : `listenToMessages` construit une query SANS `limit()` ni `startAfter()` (`chatService.ts:1313-1318`) ; `limit`/`startAfter` ne sont même pas importés. `onSnapshot` renvoie tous les messages à chaque mise à jour ; `setMessages(updatedMessages)` prend tout ; la `FlashList` (`app/chat/[id].tsx:410`) reçoit `data={messages}` complet, sans `onEndReached`/`onStartReached`.
- **Impact** : Sur conversation longue, chaque snapshot relit/désérialise tout (jank au montage, coût mémoire/CPU sur Android bas de gamme, lectures Firestore non bornées). Risque croissant linéairement.
- **Recommandation** : `limit(N)` + `orderBy desc` avec inversion + chargement de pages anciennes (`onStartReached`/scroll vers le haut).

### 19. Dérive des types de notification entre 3 sources, pas de garantie de compilation
- **Sévérité** : P1 (dimension push) / P2 (dimension deep links) · **Plateforme** : both
- **Fichiers** : `store/notificationStore.ts:6-21`/`:23-46`, `types/index.ts:580-608`/`:610-621`, `functions/src/utils/notifications.ts`, `functions/src/triggers/swaps.ts:81`, `hooks/useNotificationSetup.ts`
- **Description** : Trois unions divergentes sans contrat partagé : `PushNotificationType` (routing client), `NotificationType` (modèle in-app), et côté backend `notificationType: string` libre + `data: Record<string,string>`. Cast brut `as PushNotificationData` (`useNotificationSetup.ts:148`/`269`), switch sans `never`-check exhaustif. `swap_proposed` orphelin (`triggers/swaps.ts:81`). `NotificationData` n'a ni `swapId`/`savedSearchId`/`transactionId`/`reviewId`.
- **Impact** : Cause racine des findings de routing (#5, #7, #10, #15, #16) : aucun TS n'attrape un type émis non géré ou une clé manquante.
- **Recommandation** : Source de vérité unique `type → clés → route` partagée backend/client + switch exhaustif (never check), OU lecture directe du `deepLink` déjà produit par le backend.

### 20. Badge iOS figé et compteur non lu jamais incrémenté (messages absents du compteur cloche)
- **Sévérité** : P1 · **Plateforme** : both
- **Fichiers** : `functions/src/utils/notifications.ts:209`, `functions/src/triggers/messages.ts:124`, `functions/src/scheduled/savedSearches.ts:246`, `functions/src/triggers/swaps.ts:98`, `hooks/useNotificationSetup.ts:263`, `store/notificationStore.ts:83`, `services/notificationService.ts:205`
- **Description** : (a) `aps.badge` est une constante (`badge: 1` partout sauf `savedSearches.ts:246` = nb articles d'UNE recherche) → jamais un cumul réel ; `setBadgeCountAsync` n'est appelé qu'avec `0`. (b) `incrementUnreadCount` (`notificationStore.ts:83`) est mort (importé `useNotificationSetup.ts:168`, jamais appelé). (c) `sendMessageNotification` n'écrit aucune notif in-app (`sendEach` direct) → `countUnreadNotifications` (lit la collection `notifications`) n'inclut jamais les messages → la cloche sous-compte.
- **Impact** : iOS : badge applicatif bloqué. Both : cloche ignore les messages. Désync entre badge OS iOS, cloche et onglet Messages (lui correct via chatStore). Écart cross-plateforme (l'`aps.badge` figé est spécifique iOS).
- **Recommandation** : Calculer un badge réel serveur (count non-lus du destinataire) + `incrementUnreadCount` + `setBadgeCountAsync` côté app ; faire écrire une notif in-app par le trigger message OU exclure/documenter explicitement les messages du compteur cloche.

---

## Findings P2 / P3

> Format condensé : titre — sévérité · plateforme · fichiers — impact synthétique → recommandation.

### Messagerie — Conversation & saisie

- **21. Empty state masque le ListHeader (suivi de livraison)** — P2 · both · `app/chat/[id].tsx:407-428`, `services/transactionService.ts:174-232`, `chatService.ts:1301-1340`. Ternaire strict `messages.length === 0` → `ShipmentTracking` (attaché au `ListHeaderComponent`) jamais rendu si 0 message visible mais transaction shipping active (cas messages legacy filtrés par `participants array-contains`). → Sortir `ShipmentTracking` du `ListHeaderComponent` ou afficher la liste dès qu'une transaction existe.
- **22. Aucun envoi optimiste** — P2 · both · `hooks/useChat.ts:86-98`, `app/chat/[id].tsx:114-125`, `chatService.ts:307`, `features/chat/components/ChatInputBar.tsx`. La bulle n'apparaît qu'à l'écho du listener ; barre vidée après l'await, rien pendant 1-3 s sur réseau lent → l'utilisateur peut croire à un échec et re-envoyer. → Message optimiste (status `sending`, id temporaire) réconcilié par le snapshot, rollback en erreur.
- **23. Bouton d'envoi non protégé contre le double-tap → messages dupliqués** — P2 · both · `features/chat/components/ChatInputBar.tsx:24`/`:56-60`, `app/chat/[id].tsx:114-125`, `chatService.ts:362-382`. Bouton gardé seulement par `canSend`, champ vidé après l'await → deux taps = deux `addDoc` + double increment du compteur. Asymétrie avec le bouton image (`isSendingImage`). → Ajouter `isSending`, `disabled={!canSend || isSending}`.
- **24. Race `markMessagesAsRead` : reset à 0 hors transaction écrasant un increment** — P2 · both · `chatService.ts:1437-1440`, `hooks/useChat.ts:64-67`. Reset aveugle à 0 hors transaction (deux await avant le write) peut écraser un `increment(1)` d'un message arrivé entre lecture et reset → badge fantôme manquant (message non perdu). → Reset dans `runTransaction` (increment négatif du nombre réellement lu).
- **25. Aucune gestion hors-ligne dans l'écran de conversation** — P2 · both · `hooks/useChat.ts:86-98`, `app/chat/[id].tsx:114-125`/`:375-381`, `features/chat/components/ChatErrorState.tsx:19`, `features/chat/types.ts:45-47`. Pas de détection réseau (NetInfo absent), Alert générique en échec, `ChatErrorState` n'offre que « Retour », pas de file d'attente/retry. → Bannière hors-ligne + bouton « Réessayer » + file d'envoi optimiste.
- **26. Double mécanisme de scroll-to-end (setTimeout animé + onContentSizeChange non animé)** — P2 · both · `app/chat/[id].tsx:96-102`/`:417-419`. Double-scroll redondant séquencé (~100 ms d'écart) avec flags `animated` contradictoires → saccade ; force le scroll même si l'utilisateur lit l'historique (écrase l'anchoring MVCP de FlashList v2, actif par défaut). → Un seul mécanisme conditionné « proche du bas » via `maintainVisibleContentPosition={{ autoscrollToBottomThreshold: 0.2 }}`.
- **27. KeyboardAvoidingView : offset magique 90 iOS + dépendance adjustResize Android non explicitée** — P2 · both · `app/chat/[id].tsx:402-405`, `app.config.js`. `90` codé en dur (ne dérive ni de SafeArea ni du header), `SafeAreaView` sans `edges` restreints (risque double inset) ; Android `behavior=undefined` repose sur le resize natif non verrouillé via config (SDK 56 / RN 0.85, edge-to-edge imposé). → Mesure dérivée `headerHeight + insets.top` ; expliciter le mode clavier Android. (NB : un autre finding constate que le manifest généré a déjà `adjustResize` → bug fonctionnel neutralisé, P3.)
- **28. KeyboardAvoidingView non géré sous Android (durcissement config)** — P3 · android · `app/chat/[id].tsx`, `android/app/src/main/AndroidManifest.xml`, `app.config.js`. `behavior=undefined` + manifest `adjustResize:24` = pattern RN correct → pas de bug fonctionnel ; seul point : `adjustResize` non piloté depuis `app.config.js` (risque faible de régression au prebuild). → Verrouiller via config ; NE PAS forcer `behavior='height'/'padding'` (double ajustement).
- **29. Avatar de l'interlocuteur non rendu sur les bulles offre** — P3 · both · `app/chat/[id].tsx:323-356`, `components/ChatBubble.tsx:141-147`, `components/OfferBubble.tsx`. `OfferBubble` n'a pas de slot avatar (28×28), contrairement à `ChatBubble` entrante → alignement irrégulier du fil. → Harmoniser (`otherAvatar` déjà dans le scope).
- **30. Timestamp affiché pendant l'état transitoire serverTimestamp null** — P3 · both · `chatService.ts:353`/`:1329`, `components/ChatBubble.tsx:31-36`. Fallback `new Date()` (horloge device) affiché brièvement avant l'heure serveur (latency compensation) ; flash d'horodatage potentiellement faux si horloge décalée. Prop `showTimestamp` morte. → Masquer l'horodatage tant que `data.timestamp` est null, ou statut `sending` assumé.
- **31. Double scrollToEnd concurrent (dimension temps réel)** — P3 · both · `app/chat/[id].tsx:96-102`/`:417-419`. Doublon de #26. → Garder uniquement `onContentSizeChange`.
- **32. Défilement sur `messages.length` seulement : mutations in-place ne scrollent pas** — P3 · both · `app/chat/[id].tsx:96-102`, `hooks/useChat.ts:39-46`, `components/OfferBubble.tsx`. Transition d'offre à longueur constante ne re-fire pas l'effet ; mais `onContentSizeChange` couvre déjà les transitions visibles (le bloc OfferActions disparaît → hauteur change). Cas résiduel : badge de statut côté émetteur. → Signature plus complète (dernier id + length) ou s'appuyer sur `onContentSizeChange`.
- **33. État d'erreur du chat sans réessai (cul-de-sac)** — P3 · both · `features/chat/components/ChatErrorState.tsx:19-21`, `hooks/useChat.ts:47-52`/`:68-73`, `app/chat/[id].tsx:375-381`, `features/chat/types.ts:45-47`. `error` jamais réinitialisé hors re-run de `setupListeners` ; bouton unique « Retour » ; le listener `onSnapshot` ne se re-souscrit pas seul. → Exposer un `retry` depuis `useChat` + bouton « Réessayer » + prop `onRetry`.

### Messagerie — Liste & modération

- **34. État vide identique « aucune conversation » vs « onglet vide / autre onglet plein », sans CTA** — P2 · both · `app/(tabs)/messages.tsx:177`/`:184-187`. Empty state calculé sur `filteredChats.length === 0` sans distinguer global vs onglet ; aucun CTA. → Différencier `chats.length===0` (CTA « Parcourir les articles ») vs onglet vide (renvoi vers l'autre onglet).
- **35. Nom depuis le snapshot, avatar depuis le profil live → désync nom/avatar** — P2 · both · `app/(tabs)/messages.tsx:259`/`:303`, `hooks/useUserProfile.ts:39`, `services/userService.ts:88`, `types/index.ts:65`. Avatar via `liveProfile` prioritaire, nom via `otherParticipant?.userName` (snapshot), `staleTime: 30 min` → incohérence transitoire dans les deux sens. → Lire le nom depuis `liveProfile?.displayName || otherParticipant?.userName`.
- **36. Les conversations avec un utilisateur bloqué restent dans la liste** — P2 · both · `services/chatService.ts:1374`/`:115`, `app/(tabs)/messages.tsx:85`, `features/chat/hooks/useChatModeration.ts`, `services/moderationService.ts`. `listenToUserChats` ne filtre que `participants array-contains` ; blocage appliqué seulement au send. Doublon dimensionnel de #13 (dimension liste). → Filtrer/marquer « Bloqué » (faisable sans lecture supplémentaire, `blockedUsers` déjà dans le doc du bloqueur).
- **37. Input de chat jamais désactivé en cas de blocage — erreur seulement après envoi** — P2 · both · `app/chat/[id].tsx:114-125`/`:431-439`, `hooks/useChat.ts:86-98`, `features/chat/components/ChatInputBar.tsx`, `features/chat/types.ts:31-39`, `chatService.ts:327-338`. `ChatInputBar` sans prop blocage ; check dans `sendMessageWithType` → Alert seulement après échec ; `useChat` ne charge aucun état de blocage. → Charger l'état à l'ouverture, désactiver l'input + bandeau explicite.
- **38. Signalement de message : UI complète mais aucun point d'entrée (fonctionnalité morte)** — P2 · both · `components/ReportBottomSheet.tsx:116-127`, `services/moderationService.ts:17`, `features/chat/hooks/useChatModeration.ts:62-72`, `app/chat/[id].tsx`, `components/ChatBubble.tsx`. `ReportType` inclut `'message'` et `ReportBottomSheet` le gère, mais aucun `.open('message',...)` n'existe ; le menu chat ne propose que « Signaler l'utilisateur ». → Brancher un long-press sur `ChatBubble` → `reportSheetRef.open('message', messageId, senderId)`, ou retirer le cas.
- **39. Aucune protection anti-spam de signalement (`hasUserReported` jamais appelé)** — P2 · both · `services/moderationService.ts:138-156`, `components/ReportBottomSheet.tsx:81-114`, `firestore.rules:465-490`, `features/chat/hooks/useChatModeration.ts:62`. `hasUserReported` défini mais jamais appelé ; règles autorisent la création sans limite ; warning UI non adossé à un mécanisme. → Appeler `hasUserReported` avant `createReport` et/ou Cloud Function limitant 1 report par (reporter, cible, type).
- **40. Badges par onglet non plafonnés (pas de « 99+ ») alors que la tab-bar l'est** — P3 · both · `app/(tabs)/messages.tsx:151-156`/`:417-432`, `app/(tabs)/_layout.tsx:34`, `store/chatStore.ts:84-87`. Tab-bar plafonne à « 99+ », badges d'onglet affichent le brut (incohérence ; pas de débordement car pill flex sans largeur fixe). → Factoriser `formatBadgeCount` appliqué aux deux.
- **41. Onglet par défaut « Ventes » → flash d'état vide pour acheteurs purs** — P3 · both · `app/(tabs)/messages.tsx:37`/`:42-50`. Correction vers « achats » via `useEffect` post-paint → une frame peinte sur le mauvais onglet (skeleton pendant le chargement, flash après l'arrivée des données). → `useLayoutEffect` / dérivation synchrone / mémoriser le dernier onglet.
- **42. `getUserReports` inutilisable par un utilisateur (règle admin-only) — incohérence service/règles** — P3 · both · `services/moderationService.ts:112-133`, `firestore.rules:471-474`. Query `reporterId == userId` mais lecture restreinte admin/modo → permission-denied avalé en `[]` ; méthode non utilisée. `hasUserReported` a le même défaut latent. → Supprimer tant que non exposée, ou ajouter règle read self.
- **43. ReportBottomSheet : couleurs hardcodées (violation DS) + nuance `reporterName`** — P3 · both · `components/ReportBottomSheet.tsx:251-375`/`:88`. PARTIE 1 confirmée : aucun token `constants/theme`, hex magiques partout (`#ff4757`, `#09B1BA`, etc.) + couleurs inline. PARTIE 2 INFIRMÉE : `formatDisplayName` est une fonction de rédaction vie-privée (affichage), pas de normalisation ; `reporterName` stocké en clair est COHÉRENT avec le reste de l'app (reviews/products). → Remédier UNIQUEMENT les couleurs DS ; abandonner la partie `reporterName`.

### Notifications & push

- **44. Badge OS jamais décrémenté à la lecture : `clearAllNotifications` (seul à appeler `setBadgeCountAsync(0)`) est du code mort** — P2 · both · `hooks/useNotificationSetup.ts:309-313`, `app/notifications.tsx`. `clearAllNotifications` jamais appelé ; les handlers d'écran ne touchent que le store Zustand. → Appeler `setBadgeCountAsync(count)` dans `refreshNotificationBadge`/handlers ; câbler ou supprimer `clearAllNotifications`.
- **45. Badge in-app (cloche) jamais rafraîchi au retour de background : pas d'AppState listener** — P2 · both · `hooks/useNotificationSetup.ts`, `store/notificationStore.ts`, `features/home/header/HomeHeader.tsx`, `app/notifications.tsx`, `services/notificationService.ts`. `refreshBadgeCount` appelé au cold-start, en foreground et sur actions d'écran seulement ; aucun listener AppState ; `incrementUnreadCount` mort ; pas d'`onSnapshot` notifs. → AppState listener `active` → `refreshBadgeCount`.
- **46. Erreur de chargement des notifications indiscernable de l'état vide (`return []` silencieux)** — P2 · both · `services/notificationService.ts:142-145`/`:209-213`, `app/notifications.tsx:247-254`. `getUserNotifications`/`countUnreadNotifications` avalent toute erreur (index manquant, offline) → « Aucune notification » trompeur ; `useQuery` ne voit jamais `isError` ; RefreshControl ne signale pas l'échec. → `throw` dans `getUserNotifications` + état d'erreur avec « Réessayer » distinct.
- **47. Son : canaux Android muets (`sound: null`) vs FCM `sound: 'default'`** — P2 · android · `hooks/useNotificationSetup.ts:26-52`, `functions/src/utils/notifications.ts:200`, `messages.ts:114-116`, `swaps.ts:89-90`, `savedSearches.ts:237-238`. Sur Android 8+ le réglage du canal prime → canaux créés `sound: null` = silencieux malgré le payload. → Aligner `sound: 'default'` sur les canaux importants (créer un NOUVEL id si canal déjà déployé) OU retirer `sound` du payload.
- **48. Badge iOS figé à 1 et jamais incrémenté localement (dimension push)** — P2 · both · `functions/src/utils/notifications.ts:209`, `messages.ts:124`, `swaps.ts:98`, `savedSearches.ts:246`, `hooks/useNotificationSetup.ts:263-265`, `notificationStore.ts:83`, `services/notificationService.ts`. `badge: 1` absolu (non-monotone, `saved_search` met `length` puis tout push redescend à 1) ; `refreshBadgeCount` re-query Firestore complet à chaque notif foreground. → Calculer le badge serveur (count) + `incrementUnreadCount` + `setBadgeCountAsync` ; remplacer le fetch complet par `getCountFromServer`.
- **49. Permission Android 13+ demandée implicitement à l'hydratation de session, sans gestion du refus** — P2 · android · `hooks/useNotificationSetup.ts:194-198`/`:227-260`, `app.config.js:105`, `app/settings/notifications.tsx:226-232`, `app/_layout.tsx:131-132`. `requestPermissionsAsync` au sign-in, refus = `console.log`, pas de `canAskAgain`/`openSettings` ; le toggle push ne pilote pas la permission OS (préférence Firestore seule). Pattern correct existe pour la caméra. → Pré-prompt, gérer `denied` avec CTA `openSettings`, relier le toggle à la permission OS.
- **50. Centre in-app ignore `deepLink` et `swapId`/`transactionId`/`savedSearchId`** — P1 (regroupé, voir #10) · both · `app/notifications.tsx`, `functions/src/utils/notifications.ts`, `hooks/useNotificationSetup.ts`, `types/index.ts`. NUANCE : le tap push OS n'est PAS cassé pour swap/saved_search (`routeFromNotificationData` les gère) ; le bug est spécifique au centre in-app. → Lire `swapId`/`transactionId`/`savedSearchId`/`reviewId` (pas parser un `deepLink` côté client inexistant) en factorisant le routing.
- **51. `new_sale`/`order_*` : type absent du switch, route vers `/article` au lieu de `/my-orders`** — P2 · both · `hooks/useNotificationSetup.ts:128-138`, `functions/src/utils/notifications.ts:56-63`, `webhooks.ts:696-702`, `trackingTransition.ts:273-279`, `store/notificationStore.ts`, `app/notifications.tsx`. Payload `{transactionId, articleId}` → `default` route `/article/{id}` (article souvent vendu/relisté/supprimé) ; bug sur push ET in-app. → Cases `new_sale`/`order_*` → `/my-orders` (idéalement via `data.deepLink` dans les deux consommateurs).
- **52. `review_received` : type absent du switch, tap mort** — P2 · both · `functions/src/callable/reviews.ts:205-211`, `swaps.ts:1358-1364`, `functions/src/utils/notifications.ts:65-66`, `hooks/useNotificationSetup.ts:128-138`, `app/notifications.tsx`, `store/notificationStore.ts`. NUANCE : payload porte aussi `type`+`deepLink` (vers `/notifications`) jamais consommés ; in-app quasi no-op (déjà sur l'écran cible). → Ajouter case `review_received → /notifications` + l'inclure dans `PushNotificationType`.
- **53. Canaux Android `saved_searches`/`orders` jamais créés (dimension deep links)** — P2 · android · `hooks/useNotificationSetup.ts`, `savedSearches.ts:238`, `functions/src/utils/notifications.ts:137`. Doublon dimensionnel de #8. → Déclarer les canaux ou remapper ; harmoniser `getAndroidChannel` pour `saved_search`.
- **54. Channel Android `orders` pour les notifs de décision automatisée jamais créé** — P2 · android · `functions/src/utils/notifications.ts:135`/`:190`/`:201`, `hooks/useNotificationSetup.ts:22`, `sweepPendingLabels.ts:256`, `transactionExpiration.ts:145`/`:429`/`:584`. `order_cancelled`/`order_refunded` (décisions Loi 25) ciblent `orders`, non créé → catégorisation/affichage dégradés selon OEM. → Déclarer le canal `orders` (importance HIGH).
- **55. `markAllAsRead` : pattern N+1 coûteux et partiellement échouable** — P3 · both · `services/notificationService.ts:165-175`/`:192-200`/`:205-213`, `app/notifications.tsx`. Recharge tout puis un `updateDoc` par notif (Promise.all, pas de `writeBatch`) ; catch avale l'erreur → incohérence UI/DB possible (cache passe tout à `isRead:true` malgré échec partiel). NUANCE : la maj cache est post-await, pas optimiste. → `writeBatch` (max 500, chunker) + `getCountFromServer` + faire remonter l'échec.
- **56. Bannière de notification affichée même quand l'utilisateur est déjà dans la conversation** — P2 · both · `hooks/useNotificationSetup.ts:12-19`. `shouldShowBanner: true` inconditionnel (handler module-level), aucune conscience de la route/chatId ouvert ; le backend pousse quand même (pas de présence). Canal `messages` HIGH → heads-up Android aussi. → Lire la route active (navigation ref/store exposant le chatId) et renvoyer `shouldShowBanner:false`/`shouldPlaySound:false` si `data.chatId` === chat affiché.
- **57. Plugin expo-notifications sans icône ni couleur → icône Android générique (carré blanc)** — P2 · android · `app.config.js:37-39`. Plugin déclaré sans `icon`/`color` ; aucun asset notif dédié (`assets/*notif*` absent) ; le canal ne peut pas fixer l'icône small. → `["expo-notifications", { "icon": "./assets/notification-icon.png", "color": "#..." }]` avec une icône monochrome transparente (à créer).
- **58. Deep link cold-start sur `setTimeout` fixe 500 ms (race)** — P2/P3 · both · `hooks/useDeepLinking.ts:106`, `hooks/useNotificationSetup.ts:150`. `handleInitialURL` planifie `setTimeout(...,500)` pour « laisser le navigateur monter » ; sur cold start lent (gate `appReady` derrière le splash) le `router.push` peut partir avant le navigateur. Scope : routes custom `/search` + raccourcis tabs uniquement (les routes 1:1 sont gérées nativement par Expo Router). NUANCE : `InteractionManager.runAfterInteractions` (utilisé dans `useNotificationSetup`) n'est PAS un fix sûr — il faut gater sur `rootNavigationState?.key` (Expo Router). → Attendre la disponibilité réelle du navigateur, unifier les deux hooks.

### Décisions automatisées (Loi 25)

- **59. Mismatch de clés de critères : backend `expiryWindowHours`/`expiryWindowDays` vs front `expiredAfterHours`/`expiredAfterDays`** — P2 · both · `functions/src/scheduled/transactionExpiration.ts:133`/`:415`/`:568`, `lib/automatedDecisionMeta.ts:103-104`/`:111-112`, `functions/src/callable/automatedDecisions.ts`, `components/ShipmentTracking.tsx:399-403`/`:684-687`, `hooks/useAutomatedDecision.ts`. `getCriteriaKeyLabel` fallback `?? key` → affiche la clé technique anglaise brute au lieu d'un libellé FR dans « Pourquoi cette décision ? ». Touche les 3 sous-cas d'expiration (48h/1h/7j). → Aligner les clés (renommer backend ou ajouter au mapping), idéalement contrat partagé.
- **60. Contestation créable directement par le client sans alerter les admins (`recordPrivacyIncident` contourné)** — P3 · backend · `firestore.rules:708-719`, `functions/src/callable/automatedDecisions.ts:199-228`. Le CREATE client direct sur `automated_decision_contestations` est autorisé (`firestore.rules:712-718`) mais ne déclenche pas `recordPrivacyIncident` ni le warn `ADMIN_REVIEW` (uniquement dans le callable). NUANCE aggravante : aucun consommateur serveur ne lit la collection — le canal de découverte admin est EXCLUSIVEMENT `privacy_incidents`. Une contestation écrite hors callable reste orpheline (Loi 25 art. 12.1). Atténué : exige un bypass volontaire, victime = l'auteur lui-même. → `allow create: if false` OU trigger `onDocumentCreated` appelant `recordPrivacyIncident`.

---

## Push & temps réel — focus cross-plateforme (APNs vs FCM/canaux, permissions, deep links, listeners)

**APNs vs FCM (cause racine P0 #1).** L'app envoie tout via `admin.messaging().sendEach([{ token }])`, qui exige un registration token FCM. Sur Android, `getDevicePushTokenAsync()` renvoie ce token FCM → OK. Sur iOS en expo-notifications nu, il renvoie un token APNs hexadécimal brut → FCM le rejette (`registration-token-not-registered`) → la branche de nettoyage supprime le token. Aucune conversion APNs→FCM n'existe (`setAPNSToken`/`getToken()` absents). Le `GoogleService-Info.plist` (`app.config.js:70`) ne câble PAS FCM iOS (Google Sign-In uniquement). C'est le défaut le plus structurant : iOS ne reçoit aucun push et perd son token au premier envoi.

**Canaux Android.** `setupAndroidChannels` (`useNotificationSetup.ts:26-52`) crée 4 canaux (`messages`, `offers`, `notifications`, `swaps`), tous `sound: null`. Le backend cible deux canaux jamais déclarés (`saved_searches`, `orders`) et envoie `sound: 'default'`. Conséquences : (a) son ignoré sur Android (le canal prime, #47) ; (b) `saved_searches`/`orders` retombent sur un canal par défaut sans catégorisation/préférences (#8, #53, #54). L'icône de notification Android est un carré blanc faute de config `icon`/`color` (#57).

**Permissions.** Demande implicite au sign-in (`useNotificationSetup.ts:194`), refus simplement loggé, aucun `canAskAgain`/`openSettings` ; le toggle push (`app/settings/notifications.tsx`) ne pilote pas la permission OS — sur Android 13+ un refus est définitif et silencieux (#49). Préférences transactionnelles (`newMessages`/`newOrders`/`offerReceived`/`offerResponse`) jamais honorées côté backend, et le push message bypasse même le master `push` (#9).

**Deep links & routing.** Cause racine transverse : trois unions de types divergentes sans contrat partagé (#19) et un champ `deepLink` produit par le backend (`notifications.ts:93`/`100`/`189`/`196`) mais JAMAIS consommé côté client. Le routing client re-dérive depuis `data.type` + clés dédiées avec un switch non exhaustif → taps morts (`review_received`, `funds_released`, `saved_search`, `swap_update` in-app) ou mauvaises destinations (`new_sale`/`order_*` → `/article` au lieu de `/my-orders`). Le cold start deep link dépend d'un `setTimeout(500)` non fiable (#58).

**Listeners temps réel.** `listenToMessages` (`onSnapshot` non borné) alimente `useChat` ; aucune pagination (#18), pas d'optimistic send (#22), double-tap non protégé (#23), race sur le reset `unreadCount` (#24), badge in-app non rafraîchi au retour de background (#45). Le badge OS iOS est figé via `aps.badge: 1` absolu (#20, #48). La bannière s'affiche même dans la conversation ouverte (#56).

---

## Matrice cross-plateforme

| Zone | iOS | Android | Écart |
|------|-----|---------|-------|
| Réception push (token) | KO — token APNs brut rejeté par FCM, token supprimé | OK — registration token FCM valide | **Total** : iOS ne reçoit aucun push (#1, P0) |
| Son des notifications | Joué (`aps.sound: 'default'`) | Muet (canal `sound: null` prime) | Messages sonores iOS / silencieux Android (#47) |
| Canaux `orders`/`saved_searches` | N/A (pas de canaux) | Canal par défaut « Misc », catégorisation/préférences perdues | Affichées des deux côtés mais dégradées Android (#8, #53, #54) |
| Icône de notification | Gabarit app correct | Carré blanc (pas de `icon`/`color`) | Perception marque dégradée Android (#57) |
| Permission notifications | Pas de pré-prompt, refus non géré | Idem + refus Android 13+ définitif/silencieux | Récupération impossible, irréversibilité Android (#49) |
| Badge OS | Figé via `aps.badge: 1` absolu, jamais décrémenté | Pas de badge applicatif piloté ici | Badge iOS non fiable (#20, #48, #44) |
| KeyboardAvoidingView (chat) | `padding` + offset 90 codé en dur | `behavior=undefined` + manifest `adjustResize` | Offset magique iOS ; Android couvert par le manifest (#27, #28) |
| Bannière notif (conv ouverte) | Overlay haut système | Heads-up (canal HIGH) | Bruit/redondance les deux ; ressenti légèrement différent (#56) |
| Routing tap notification | Identique (JS partagé) | Identique | Symétrique : taps morts/incorrects sur les deux (#10, #19, #51, #52) |
| Messagerie (conv, liste, modération) | Identique (logique JS/Firestore) | Identique | Symétrique : pas d'écart de plateforme |

---

## Plan d'action priorisé (P0 → P3)

**P0 — bloquant, à traiter en premier (firebase-backend + rn-expo-dev)**
1. **#1 Push iOS** : migrer vers Expo Push (`getExpoPushTokenAsync` + `expo-server-sdk`) OU `@react-native-firebase/messaging`. Sans ce fix, toute la couche push iOS est inopérante — prérequis aux autres findings push.
2. **#2 Blocage serveur** : router l'envoi de message via une callable vérifiant les DEUX `blockedUsers` (modèle `swaps.ts`) ; corriger le commentaire mensonger. Débloque #13, #14, #36, #37.
3. **#3/#7 Saved search key mismatch** : renommer `searchId → savedSearchId` dans `savedSearches.ts:228` + créer le canal `saved_searches` + test d'égalité de clés.
4. **#4 Loi 25 meetup** : découpler la surface contestation de `ShipmentTracking` (rendue dès `hasAutomatedDecision`, tout `deliveryType`) + routage notification (chatId/écran dédié).

**P1 — écarts cross-plateforme & routing (firebase-backend pour les producteurs/canaux/préférences, rn-expo-dev pour le routing client)**
5. **#19 Source de vérité unique des types** : contrat `type → clés → route` partagé, OU consommer `data.deepLink` côté client. Corrige #5, #10, #15, #16, #50, #51, #52 d'un coup.
6. **#9 Préférences transactionnelles** : map `notificationType → clé pref` honorée centralement + gating de `sendMessageNotification`.
7. **#8 Canaux Android** (`orders`, `saved_searches`), **#11 tri liste** (`lastMessageTimestamp`/`infoUpdatedAt`), **#12 conv sans sellerId** (segment « Autres »), **#14 push bloqués**, **#20 badges**, **#17 accusés de lecture**, **#18 pagination**.

**P2 — finition UX & robustesse**
8. Messagerie : optimistic send (#22), double-tap (#23), race unreadCount (#24), hors-ligne (#25), double-scroll (#26), empty state + ShipmentTracking (#21), désync nom/avatar (#35), blocage UI (#37), signalement message (#38), anti-spam reports (#39), KAV (#27).
9. Notifications : badge OS (#44), AppState (#45), état d'erreur distinct (#46), son canaux (#47), badge push (#48), permission Android (#49), bannière conv ouverte (#56), icône Android (#57), cold start (#58), notif boutique côté serveur (#6).
10. Loi 25 : libellés critères (#59), canal `orders` décisions (#54), routing order_cancelled (#16).

**P3 — dette & code mort**
11. Avatar offre (#29), timestamp transitoire (#30), scroll length (#32), erreur chat retry (#33), badges plafonnés (#40), flash onglet (#41), getUserReports (#42), couleurs DS ReportBottomSheet (#43), N+1 markAllAsRead (#55), contestation bypass (#60), KAV config Android (#28).

---

## Annexe — faux positifs écartés

Aucun faux positif. Les 65 findings ont été vérifiés ligne à ligne dans le code réel (worktrees/node_modules exclus). Les seules corrections apportées par la vérification sont des révisions de sévérité ou de portée, jamais des invalidations :

- **#6** (notif boutique) : P1 → P2 — l'erreur est avalée par les wrappers `notify*`, donc pas de faux message d'erreur ni d'état anxiogène ; défaut réel = échec silencieux.
- **#8 / #53 / #54** (canaux Android) : P1 → P2 — un FCM `notification` retombe sur un canal par défaut sans drop ; pas d'écart « iOS affichées / Android silencieuses ».
- **#43** (ReportBottomSheet) : partie `reporterName`/`formatDisplayName` INFIRMÉE (`formatDisplayName` = rédaction vie-privée, `reporterName` en clair cohérent avec reviews/products) ; seule la partie couleurs DS hardcodées tient.
- **#26 / #5** : corrections de mécanisme (MVCP de FlashList v2 actif par défaut ; `data.deepLink` calculé côté serveur mais jamais lu côté client) sans changer le verdict.
- **#1** : le `GoogleService-Info.plist` (`app.config.js:70`) identifié comme faux ami (Google Sign-In uniquement, ne câble pas FCM iOS).
