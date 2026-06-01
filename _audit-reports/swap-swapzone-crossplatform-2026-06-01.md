# Audit Swap & SwapZone — Cross-platform iOS/Android (2026-06-01)

## Résumé exécutif

Audit du périmètre Swap / SwapZone (proposition, cycle de vie, Mes échanges, navigation généraliste, backend, identité visuelle sombre, parité iOS/Android). Sur 54 findings vérifiés en direct dans le code réel, **3 P0** (sécurité backend + recours litige), **11 P1**, **22 P2**, **18 P3** sont confirmés ou nuancés ; **1 faux positif** écarté.

Le risque dominant est **backend** : `proposeMultiSwap`/`acceptSwap` ne vérifient jamais la propriété des articles (privilege escalation + corruption de données tierces), le flow de litige `openSwapDispute` est codé/déployé mais **inatteignable côté client**, et le complément cash saute le bucket `heldBalance` (fonds immédiatement retirables, sans fenêtre de 7 jours). Côté UX cross-plateforme, les défauts récurrents sont : barres collantes à `paddingBottom` magique sans safe-area (écart Android), absence totale de `BackHandler` (le retour matériel Android quitte l'écran au lieu d'annuler le multi-select), un CTA « Contacter » qui ouvre toujours un écran d'erreur (P0 UX), le complément affiché ×100 (cents bruts), et le format de devise US (`$45`) au lieu du canadien-FR (`45 $`).

| Sévérité | Nombre |
|----------|--------|
| P0 | 3 |
| P1 | 11 |
| P2 | 22 |
| P3 | 18 |
| **Total confirmés/nuancés** | **54** |
| Faux positifs écartés | 1 |

> Note : plusieurs findings ont été **révisés à la baisse** après vérification adversariale (impact surévalué). Les sévérités ci-dessous sont les **révisées** (verdict de re-vérification), pas celles d'origine. Tous les `file:line` ont été confirmés dans le code réel.

---

## Findings P0

### P0-1 — Aucune vérification de propriété des articles dans proposeMultiSwap / acceptSwap (privilege escalation + corruption de données tierces)
- **Sévérité** : P0 — **Plateforme** : backend
- **Fichiers** : `functions/src/callable/swaps.ts:59-89`, `:242-383`, `:415-459`, `:1184-1209`, `:1264-1352` ; `app/propose-swap.tsx:224-242` ; `firestore.rules:413-442`
- **Description** : `validateArticlesAvailable` (swaps.ts:59-89) lit `const data = articleSnap.data()` (L75) donc `data.sellerId` est disponible, mais ne contrôle QUE `isActive`/`isSold` (L76, L82) — jamais le propriétaire, et la fonction ne reçoit même pas d'argument `ownerExpected`. `proposeMultiSwap` (`invoker:'public'`, L243) n'a comme seul garde d'identité que `initiatorId === request.auth.uid` (L264) ; `receiverId`/`receiverItems`/`receiverName`/`receiverImage` viennent du payload client (propose-swap.tsx:229-232) et sont dénormalisés tels quels dans le doc swap (L336-353). `swaps.create` est `if false` (firestore.rules:421) : la CF est donc le point d'entrée unique et aucune règle ne compense.
- **Impact** : (a) un utilisateur authentifié peut forger un swap impliquant les articles + l'identité d'un tiers ; (b) à la complétion, `confirmSwapReception` (L1184-1209) passe `isSold:true`/`isActive:false` sur TOUS les `articleId` via Admin SDK (bypass des rules), désactivant les articles d'autrui ; (c) `rateSwap` (L1264-1352) écrit `reviewerName`/`reviewerImage` dans `avis` à partir des noms dénormalisés fournis par l'attaquant → falsification du nom affiché dans les reviews.
- **Recommandation** : ajouter `expectedSellerId` à `validateArticlesAvailable` et comparer `data.sellerId` (le read existe déjà), appeler avec `initiatorId` pour `initiatorItems` et `receiverId` pour `receiverItems` dans `proposeMultiSwap` ET `acceptSwap` ; dériver `receiverName`/`receiverImage` de `users/{receiverId}` côté serveur. Pattern correct déjà présent : `depositSwapItem` swaps.ts:1504 `if (articleData.sellerId !== userId) throw permission-denied`. **Router vers `firebase-backend`.**

### P0-2 — Le flow de litige (openSwapDispute) est inatteignable — aucun recours de remboursement pour l'acheteur du complément
- **Sévérité** : P0 — **Plateforme** : backend (impact UX both)
- **Fichiers** : `functions/src/callable/swaps.ts:1386-1451`, `:843-866`, `:1110-1161` ; `functions/src/index.ts:54` ; `services/swapService.ts:277-422` ; `app/swap/[id].tsx:19-31`, `:339-358` ; `features/swap/components/SwapStatusView.tsx:18-44`
- **Description** : `openSwapDispute` est implémenté et exporté/déployé (index.ts:54). C'est le SEUL recours de remboursement après acceptation : `cancelSwap` refuse tout statut au-delà de `payment_pending` (swaps.ts:848-853). Mais aucun wrapper client (`services/swapService.ts` ne l'exporte pas) et aucun call site (`app/swap/[id].tsx` n'importe pas de dispute). `disputed` n'est qu'un label d'affichage (SwapStatusView.tsx:27 `disputed: 'Litige'`), sans action. Toute la machinerie « Signaler un problème » (`RecourseReasonSheet`, `useTransactionRecourse`) est câblée pour les TRANSACTIONS, jamais les swaps.
- **Impact** : un acheteur ayant payé un complément (jusqu'à 5000 $ CAD) et reçu un article non conforme ne peut ouvrir aucun litige in-app. Protection acheteur annoncée mais inaccessible (risque de publicité trompeuse).
- **Recommandation** : exposer `openSwapDispute(swapId, reason)` dans `swapService.ts`, ajouter un bouton « Signaler un problème » sur les statuts `shipping`/`completed`. **Nuance critique** : `openSwapDispute` ne rembourse que `if (!swapData.topUpReleasedAt)` (L1438), or `confirmSwapReception` pose `topUpReleasedAt` dès la double confirmation (L1146-1151) — la reco doit donc AUSSI prévoir une fenêtre de rétention du top-up (cf. P1-9), sinon le bouton serait inopérant après réception. **Router vers `firebase-backend` + `rn-expo-dev`.**

### P0-3 — Bouton « Contacter » du swap ouvre un écran d'erreur (mauvais identifiant de route)
- **Sévérité** : P0 — **Plateforme** : both (identique iOS/Android)
- **Fichiers** : `features/swap/components/SwapContactButton.tsx:24` ; `app/swap/[id].tsx:395`, `:458-463` ; `app/chat/[id].tsx:63`, `:77`, `:375-380` ; `hooks/useChat.ts:34`, `:68-72` ; `services/chatService.ts:1276-1281`
- **Description** : `SwapContactButton` fait `router.push(\`/chat/${otherUserId}\`)` (L24) où `otherUserId` est un **UID utilisateur** (swap/[id].tsx:395). Or `/chat/[id]` interprète `[id]` comme un **chatId** : `useChat(chatId)` → `getChatById(chatId)` → `doc(firestore,'chats',chatId)` qui `throw 'Chat not found'` (chatService.ts:1279-1281) puisqu'un UID n'est jamais un id de doc `chats`. `useChat` passe en erreur (useChat.ts:68-72) → `ChatErrorState` (chat/[id].tsx:375-380). Le bouton est rendu sur tous les statuts sauf `declined`/`cancelled` (swap/[id].tsx:458). Pattern correct ailleurs : `app/user/[id].tsx:217-218` `createOrGetChat(...)` puis `push(\`/chat/${chat.id}\`)`.
- **Impact** : sur CHAQUE swap actif, « Contacter <nom> » mène toujours à un écran d'erreur, jamais à la conversation — coordination de remise en main propre (`hand_delivery`) cassée.
- **Recommandation** : résoudre/créer le chat avant navigation : `const chat = await ChatService.createOrGetChat(user.id, otherUserId); router.push(\`/chat/${chat.id}\`)`, comme `app/user/[id].tsx:217-218`. **Router vers `rn-expo-dev`.**

---

## Findings P1 — bugs & écarts iOS ↔ Android

### P1-1 — Le receiver voit les boutons Accepter/Refuser en double (inline + sticky)
- **Sévérité** : P1 — **Plateforme** : both
- **Fichiers** : `app/swap/[id].tsx:449`, `:467-473` ; `features/swap/components/SwapActions.tsx:75-105` ; `features/swap/components/SwapStickyActions.tsx:25-52`
- **Description** : au statut `proposed` côté receiver, `SwapActions` (monté inconditionnellement L449) rend le bloc `status === 'proposed' && isReceiver` (SwapActions.tsx:75) avec Accepter+Refuser inline, ET `SwapStickyActions` (L467, condition `!participant.isInitiator`) rend une barre collante Accepter+Refuser. Pour le receiver légitime `isReceiver === !isInitiator === true` → les deux conditions sont vraies. Mêmes handlers `handleAccept`/`handleDecline` (protégés par `isProcessing`).
- **Impact** : double CTA contradictoire, écran perçu comme bugué ; sur petit écran l'inline est masqué par la sticky.
- **Recommandation** : garder UNE seule surface (idéalement la sticky bar), retirer le bloc `proposed`/`isReceiver` de `SwapActions`. **Router vers `rn-expo-dev`.**

### P1-2 — SwapStickyActions : paddingBottom fixe (32) au lieu de safe-area inset
- **Sévérité** : P1 — **Plateforme** : android
- **Fichiers** : `features/swap/components/SwapStickyActions.tsx:56-70` (`paddingBottom: 32`, aucun `useSafeAreaInsets`) ; `app/swap/[id].tsx:398` (`SafeAreaView edges={['bottom']}`), `:467-473`
- **Description** : barre `position:'absolute', bottom:0` avec `paddingBottom: 32` magique. Enfant absolu d'un `SafeAreaView edges={['bottom']}` : l'inset du parent ne s'applique pas à un descendant absolu. iOS : home-indicator (~34) + 32 = sur-espacement. Android : inset réel (0/24/48 dp) ≠ 32 → chevauchement de la barre système ou bande morte. Convention canonique violée : `app/checkout/index.tsx:287` `paddingBottom: insets.bottom + 16`.
- **Impact** : boutons Accepter/Refuser sous la nav gestuelle Android ou flottants avec espace mort. Le `32` viole aussi « DS tokens, zéro magie » (`spacing.md = 16`, theme.ts:216).
- **Recommandation** : `const insets = useSafeAreaInsets()` + `paddingBottom: insets.bottom + spacing.md`. **Router vers `rn-expo-dev`.**

### P1-3 — Pas de BackHandler : le retour matériel Android quitte l'écran au lieu d'annuler le multi-select
- **Sévérité** : P1 — **Plateforme** : android
- **Fichiers** : `app/swap-zone.tsx:154-156` (état multi-select), `:374-378` (`handleCancelMultiSelect`), `:380-383` (`handleBack`), `:539` (`PartyHeader onBack`)
- **Description** : `handleBack` (chevron visuel) annule proprement le multi-select avant `router.back()`. Mais aucun `BackHandler`/`useFocusEffect`/`hardwareBackPress` nulle part (grep = 0 sur tout `app/`, `features/`, `components/`, `hooks/`). Sur Android, le retour matériel pop l'écran et perd la sélection. iOS n'a pas de bouton matériel → divergence.
- **Impact** : Android : l'utilisateur en pleine sélection multi-vendeur perd sa sélection et quitte la zone d'un seul appui retour.
- **Recommandation** : `useFocusEffect` + `BackHandler.addEventListener('hardwareBackPress')` retournant `true` si `isMultiSelectMode` (sinon défaut). Veiller à ne pas consommer le back des bottom sheets gorhom ouverts. **Router vers `rn-expo-dev`.**

### P1-4 — Multi-select : désynchronisation entre le compteur affiché et les articles réellement proposés après filtrage
- **Sévérité** : P1 — **Plateforme** : both
- **Fichiers** : `app/swap-zone.tsx:355-372`, `:572-578` ; `features/swap-party/hooks/useSwapZoneFilters.ts:60-103` ; `features/swap-party/components/MultiSelectBar.tsx:18-42`
- **Description** : `selectedItemIds` n'est jamais réconcilié quand un filtre change. La barre affiche `selectedCount={selectedItemIds.size}` (L573) et `canPropose={selectedItemIds.size > 0}` (L574), mais `handleProposeMultipleSwaps` ne propose que `otherItems.filter(item => selectedItemIds.has(item.id))` (L358) = intersection avec la vue POST-filtre. Si le filtre cache tout : `picked.length === 0` → `return` silencieux (L359) avec `canPropose` toujours `true` → bouton « Proposer » inerte. Aucun `useEffect` ne purge les ids absents.
- **Impact** : l'utilisateur croit proposer 3 articles, en propose 2 (ou 0) sans le savoir ; bouton « Proposer » mort sans feedback.
- **Recommandation** : dériver `selectedCount`/`canPropose` de l'intersection `otherItems.filter(i => selectedItemIds.has(i.id)).length` (préférable au `useEffect` qui viderait la sélection au masquage temporaire). **Router vers `rn-expo-dev`.**

### P1-5 — Backend : pas de vérification de propriété (proposition de swap)
- **Sévérité** : P1 — **Plateforme** : backend
- **Fichiers** : `functions/src/callable/swaps.ts:59`, `:75`, `:76`, `:82`, `:324`, `:325` ; `services/swapService.ts:257` ; `app/propose-swap.tsx:224`
- **Description** : doublon dimensionnel de P0-1 (vu sous l'angle « Proposer un swap »). `validateArticlesAvailable` ne compare jamais `data.sellerId` à l'owner attendu ; `proposeMultiSwap` appelle la validation sans passer le propriétaire (L324-325). `services/swapService.ts:257-266` est un pass-through sans validation.
- **Impact** : proposer des articles non possédés ou réclamer des articles attribués au mauvais vendeur ; avec `cashTopUp`, déclenche un flux Stripe vers le mauvais payee → litige financier.
- **Recommandation** : voir P0-1 (même correctif). **Router vers `firebase-backend`.**

### P1-6 — Les prix des articles du swap proviennent du client et sont persistés sans recalcul serveur
- **Sévérité** : P1 — **Plateforme** : backend
- **Fichiers** : `functions/src/callable/swaps.ts:327`, `:331`, `:340`, `:59` ; `components/swap/SwapItemCard.tsx:70` ; `features/swap/components/SwapProposalView.tsx:74` ; `app/swap-zone.tsx:88` ; `app/propose-swap.tsx:105`
- **Description** : `proposeMultiSwap` calcule `initiatorTotalValue`/`receiverTotalValue` depuis `item.price` du payload (L327-334) et persiste `initiatorItems.map(stripUndefined)` verbatim (L340/345). `validateArticlesAvailable` lit le doc article mais ignore `data.price`. **Nuance** : les totaux persistés n'ont aucun consommateur (code mort) ; le vrai vecteur exploitable est le `price` par item affiché AU DESTINATAIRE au moment d'accepter (SwapItemCard.tsx:70 `${item.price}`) — un proposant peut gonfler/minorer la valeur affichée pour faire passer un échange déséquilibré pour équitable. L'argent réel (`cashTopUp.amount`) est validé indépendamment, donc pas de vol direct (P1, pas P0).
- **Recommandation** : relire `data.price` depuis chaque doc article dans la transaction, réécrire `item.price` serveur, recalculer les totaux. **Router vers `firebase-backend`.**

### P1-7 — Aucun verrou « un article = un seul swap actif » : double-engagement concurrent
- **Sévérité** : P1 — **Plateforme** : backend
- **Fichiers** : `functions/src/callable/swaps.ts:59-89`, `:322-365`, `:385-404`, `:451-455` ; `functions/src/scheduled/swaps.ts:30-51` ; `firestore.rules:385-432`
- **Description** : la seule garde d'unicité est `isPending` sur les docs `swapPartyItems`, posé HORS transaction (`markPartyItemsPending` L362-364, après le `runTransaction` qui retourne à L359) et jamais relu comme barrière (grep `where('isPending'`/`.isPending` = 0). `validateArticlesAvailable` n'interroge jamais la collection `swaps`. `isSold` n'est posé qu'à la complétion (`confirmSwapReception` L1196-1200). Donc le même article peut être proposé/accepté dans N swaps concurrents avançant jusqu'à `shipping`.
- **Impact** : article promis à deux échanges ; à la complétion du second il est déjà vendu → swap bloqué, top-up potentiellement déjà payé sur le swap perdant → litige financier.
- **Recommandation** : dans `validateArticlesAvailable` (propose ET accept, transactionnels), requêter `swaps` pour les statuts actifs contenant chaque `articleId` et rejeter ; OU poser un `activeSwapId` sur l'article dans la transaction. Requête collection-group avant toute écriture. **Router vers `firebase-backend`.**

### P1-8 — Complément monétaire affiché en cents avec un signe $ (montant ×100)
- **Sévérité** : P1 — **Plateforme** : both
- **Fichiers** : `features/swap/components/SwapProposalView.tsx:90`, `:116` ; `components/swap/SwapSummaryBox.tsx:29` ; `features/swap/components/SwapStatusView.tsx:128` ; `app/swap/[id].tsx:444`, `:165` ; `app/propose-swap.tsx:221` ; `types/index.ts:869`
- **Description** : `cashTopUp.amount` est stocké EN CENTS (propose-swap.tsx:221 `Math.round(complementDollars * 100)`, types/index.ts:869 `// amount is IN CENTS`, validé swaps.ts:295). Mais l'affichage ne reconvertit jamais : SwapProposalView.tsx:90 `${cashTopUp.amount}` (cents bruts) et SwapSummaryBox.tsx:29 `+ $${cashSupplement}`. Le checkout, lui, divise correctement (swap/[id].tsx:165 `feeBreakdown.buyerTotal / 100`) — incohérence interne avérée.
- **Impact** : un complément de 500 $ s'affiche « complément de $50000 » et « + $50000 ». Confusion majeure, refus de swaps légitimes ou acceptation sur montant erroné.
- **Recommandation** : diviser par 100 et formater via `utils/formatPrice` avant affichage dans SwapProposalView (badge + summary) et SwapStatusView. **Router vers `rn-expo-dev`.**

### P1-9 — Le complément (top-up) saute le bucket heldBalance : fonds immédiatement retirables, sans fenêtre de litige de 7 jours
- **Sévérité** : P1 — **Plateforme** : backend
- **Fichiers** : `functions/src/callable/swaps.ts:1154-1171`, `:1419-1440` ; `functions/src/http/webhooks.ts:794-817` ; `functions/src/callable/wallet.ts:16-34` ; `functions/src/scheduled/releaseHeldFunds.ts:43-107`
- **Description** : pour une vente normale, le modèle 3 buckets fait transiter `pendingBalance → heldBalance` (fenêtre 7 jours, `DISPUTE_WINDOW_MS`) `→ balance` via le scheduler. Pour un swap, `confirmSwapReception` crédite directement `balance` (`FieldValue.increment(+payoutCents)` sur `balance`, `-payoutCents` sur `pendingBalance`, L1157-1161) en sautant `heldBalance`, et écrit `type:'sale_available'` (L1164). Aucun scheduler ne traite les swaps. `topUpReleasedAt` posé immédiatement (L1150) neutralise le remboursement d'`openSwapDispute` (conditionné `if (!topUpReleasedAt)` L1438).
- **Impact** : disparité de protection achat/échange ; le payeur d'un complément perd la fenêtre de 7 jours et toute récupération une fois la réception confirmée.
- **Recommandation** : créditer `heldBalance` à `confirmSwapReception` + libérer via `releaseHeldFunds` après la fenêtre, ou ADR si le saut est volontaire. **Router vers `firebase-backend`.**

### P1-10 — La route my-swaps n'a aucun point d'entrée UI permanent (downgrade P1→P2 en re-vérif)
- **Sévérité** : **P2** (révisé depuis P1) — **Plateforme** : both
- **Fichiers** : `app/my-swaps.tsx` ; `app/propose-swap.tsx:247` ; `app/(tabs)/profile.tsx:101-174` ; `app/swap-zone.tsx` ; `app/notifications.tsx:160-168` ; `functions/src/triggers/swaps.ts:25,80-85` ; `hooks/useNotificationSetup.ts:128-138`
- **Description** : `/my-swaps` n'est poussé QUE par l'alerte de succès post-proposition (propose-swap.tsx:247), côté initiateur. Le menu profil (orders/selling/wallet/articles/favorites/saved-searches) n'a aucune entrée. **Nuance** : le receiver atteint le DÉTAIL via le push `swap_proposed` (triggers/swaps.ts:80 → useNotificationSetup.ts default → `/swap/${data.swapId}`), donc la feature n'est pas globalement inaccessible (d'où P2). MAIS `onSwapCreated` ne crée AUCUNE notification in-app → un receiver sans push/token n'a strictement aucun chemin.
- **Recommandation** : entrée « Mes échanges » dans le menu profil + raccourci Swap Zone ; créer une notification in-app `swap_proposed`. **Router vers `rn-expo-dev` (+ `firebase-backend` pour la notif in-app).**

### P1-11 — Deep-link vers swap d'un tiers ou en session expirée → skeleton infini
- **Sévérité** : P1 — **Plateforme** : both
- **Fichiers** : `app/swap/[id].tsx:66-69`, `:365-372`, `:377-389` ; `services/swapService.ts:570` ; `firestore.rules:415-417` ; `features/swap/components/SwapDetailSkeleton.tsx` ; `features/swap/components/SwapTopBar.tsx:23-29` ; `hooks/useDeepLinking.ts:14` ; `hooks/useNotificationSetup.ts:81,137`
- **Description** : `subscribeToSwap` (swapService.ts:570) appelle `onSnapshot` sans 3e argument error. `isLoading` ne passe `false` que dans le callback de succès (swap/[id].tsx:66-69). Les rules (firestore.rules:415-417) refusent le non-participant → l'erreur `permission-denied` est silencieusement abandonnée, `isLoading` reste `true` indéfiniment. Le skeleton (SwapDetailSkeleton, aucun Pressable) et l'écran d'erreur (L377-389) n'ont pas de bouton retour, header natif désactivé. Le vrai bouton retour vit dans `SwapTopBar`, rendu uniquement au succès.
- **Impact** : lien push ouvert en session expirée, après changement de compte, ou par un tiers → utilisateur bloqué sur le skeleton, sans retour. (Reformuler : « non-participant », pas « invité » — pas de rôle invité dans les rules.)
- **Recommandation** : ajouter le 3e argument error à `onSnapshot` (→ `setIsLoading(false)`, idéalement état « accès refusé »), PUIS bouton retour à l'écran d'erreur ET au skeleton. Le bouton retour seul est insuffisant (sans error callback on n'atteint jamais l'écran d'erreur). **Router vers `rn-expo-dev`.**

---

## Findings P2 / P3

### P2 — Cycle de vie / proposition / mes échanges

#### P2-1 — Toutes les erreurs backend de proposition masquées par une alerte générique
- **P2 · both** — `app/propose-swap.tsx:249,251` ; `services/swapService.ts:261` ; `functions/src/callable/swaps.ts:300,277,82`
- Le `catch` fait `Alert.alert('Erreur', "Impossible d'envoyer la proposition")` sans inspecter `error.message`. Les `HttpsError` backend (cap dépassé, article vendu/inactif) ne sont jamais surfacés (le wrapper swapService.ts:261-266 ne remappe pas). **Reco** : extraire `error.message` avec fallback générique. *(Blocage mutuel et self-swap sont pré-vérifiés client, mais cap/article vendu passent bien par ce catch.)*

#### P2-2 — Le sélecteur d'articles du destinataire retombe sur tout son inventaire actif hors Swap Zone
- **P2 · both** — `app/propose-swap.tsx:118,122,347` ; `functions/src/callable/swaps.ts:59` ; `features/article/hooks/useArticleActions.ts:192`
- `const source = inZone.length > 0 ? inZone : active` (L122) : si le destinataire n'a rien déposé, fallback sur tout son inventaire actif. Entrée depuis une fiche article (useArticleActions.ts:192, `partyId ?? GENERALIST_ZONE_ID`) déclenche le cas où le vendeur n'a rien déposé. Backend ne rattrape pas (validation ne vérifie pas l'appartenance à `swapPartyItems`). **Reco** : ne lister que `inZone` côté destinataire + état vide explicite.

#### P2-3 — Double affichage Accepter/Refuser (dimension « cycle de vie », doublon de P1-1)
- **P2 · both** — `app/swap/[id].tsx:449,467` ; `features/swap/components/SwapActions.tsx:75` ; `features/swap/components/SwapStickyActions.tsx:24`
- Même cause que P1-1 (re-vérifié à P1 sur la dimension transverse). **Reco** : une seule surface.

#### P2-4 — Données de profil factices hardcodées dans la fiche swap
- **P2 · both** — `features/swap/components/SwapProposalView.tsx:56-58,60` ; `features/swap/components/SwapStatusView.tsx:88`
- `Villeray · 2.8 km · ★ 4.9 · 22 swaps` et `il y a 2h` sont des littéraux statiques (aucune prop distance/note/nombre/timestamp). Tous les swaps montrent les mêmes valeurs. La couleur `#FFD700` (L57) viole aussi le DS. **Reco** : alimenter avec les vraies données ou retirer.

#### P2-5 — cashTopUp jamais affiché dans Mes échanges + isError confondu avec état vide
- **P2 · both** — `app/my-swaps.tsx:57-59,67-77,383-387` ; `types/index.ts:869-873` ; `app/my-orders.tsx:114-118` ; `app/my-sales.tsx:114-118`
- `getTotalValue` ne somme que `item.price` ; `cashTopUp` jamais lu → swap réglé par complément affiché « somme nulle ». `isError` non géré → faux état vide « Aucun échange » hors ligne (pattern partagé my-orders/my-sales). **Reco** : afficher `cashTopUp/100` via `formatPriceWithCurrency` + état d'erreur distinct avec « Réessayer ».

#### P2-6 — Liste Mes échanges périmée 10 min après action (zéro invalidation + staleTime 10 min)
- **P2 · both** — `app/my-swaps.tsx:73,76,177` ; `app/swap/[id].tsx:186` ; `lib/queryClient.ts:17` ; `services/swapService.ts:564-587`
- `staleTime: 10 min` ; aucun `invalidateQueries` sur `queryKeys.swaps.userList`. Le détail observe via `subscribeToSwap` qui n'écrit jamais dans le cache RQ. Badges `pendingCount`/`activeCount` faux. **Reco** : invalider après chaque mutation, ou alimenter le cache via `setQueryData`.

#### P2-7 — Statut disputed invisible dans tous les onglets filtrés de Mes échanges
- **P2 · both** — `app/my-swaps.tsx:41,53,79-90` ; `functions/src/callable/swaps.ts:1419,1426` ; `functions/src/triggers/swaps.ts:199` ; `types/index.ts:819`
- `disputed` a un label/couleur mais n'est dans aucune liste de filtre (`pending`/`active`/`completed`) → visible seulement sous « Tous ». **Reco** : inclure dans « En cours ».

#### P2-8 — Barre d'actions collante : padding bas hardcodé sans safe-area (doublon dimensionnel de P1-2)
- **P2 · both** — `features/swap/components/SwapStickyActions.tsx:57,66` ; `app/swap/[id].tsx:398`
- Voir P1-2 (révisé P1 sur la dimension transverse). **Reco** : `insets.bottom + spacing.md`.

#### P2-9 — Notification 'accepted' jamais envoyée au receiver pour les swaps avec complément (downgrade P2→P3)
- **P3** (révisé) **· backend** — `functions/src/triggers/swaps.ts:178-183` ; `functions/src/http/webhooks.ts:819-826` ; `functions/src/callable/swaps.ts:457-466,909`
- Le case `accepted` cible toujours `after.initiatorId` ; le receiver (qui a accepté/payé) n'est jamais re-notifié du démarrage. **Nuance** : le flow ne stagne pas (`setSwapExchangeMode` appelable par les deux, swaps.ts:909 ; l'initiateur est notifié) → trou de notification, pas blocage. **Reco** : si `before.status === 'payment_pending'`, notifier les DEUX parties.

#### P2-10 — cashTopUp non corrélé à la direction/au montant du déséquilibre de valeur
- **P2 · backend** — `functions/src/callable/swaps.ts:288-309,327-334`
- La validation cashTopUp ne contrôle que `amount` entier >0, ≤500000, `payerId ∈ {initiator,receiver}` ; jamais comparé à `|receiverTotalValue - initiatorTotalValue|`. Impact borné par le consentement Stripe explicite (P2, pas P0). **Reco** : vérifier serveur que le payeur est la partie au panier le plus faible et que `amount ≈ |delta|`.

#### P2-11 — Champ complément : maxLength autorise 999 999 $ alors que le plafond serveur est 5 000 $
- **P3** (révisé) **· both** — `features/propose-swap/components/ValueComparisonBox.tsx:120,122` ; `app/propose-swap.tsx:222,251` ; `functions/src/callable/swaps.ts:299` ; `services/swapService.ts:244`
- `maxLength={6}` (L122) → jusqu'à 999999 $ ; rejet serveur à 500000 cents seulement après soumission, erreur masquée (cf. P2-1). Serveur enforce correctement → P3. **Reco** : cap onChange explicite à 5000 (pas seulement `maxLength=4` qui plafonne à 9999 $).

### P2 — SwapZone / navigation généraliste

#### P2-12 — Format de devise non canadien dans tout le module swap
- **P2 · both** — `components/swap/SwapItemCard.tsx:70` ; `components/swap/SwapSummaryBox.tsx:29` ; `features/swap/components/SwapProposalView.tsx:90` ; `features/swap/components/SwapStatusView.tsx:128` ; `utils/formatPrice.ts:6` ; `app/my-swaps.tsx:385`
- Format US (`$45`, signe avant) vs convention CA-FR (`45 $` via `formatPrice`). Incohérence visible côte à côte. **Reco** : `formatPrice(item.price)` ; `formatPrice(cashSupplement/100)` pour le complément (cents). Inclure SwapProposalView.tsx:90 (3e occurrence oubliée).

#### P2-13 — Désynchronisation multi-select / filtres (dimension SwapZone, doublon de P1-4)
- **P2 · both** — `app/swap-zone.tsx:188-191,358,573`
- Même cause que P1-4 (révisé P1 sur la dimension « Swap-parties »). **Reco** : dériver le compteur de l'intersection.

#### P2-14 — Invité (guest) qui tape une carte swap : callback de succès vide → dead-end après connexion
- **P2 · both** — `app/swap-zone.tsx:312-318,341-353,394-397` ; `hooks/useAuthRequired.ts:26-32` ; `store/authSheetStore.ts:44-50` ; `components/AuthBottomSheet.tsx:127-130`
- `requireAuth(() => {}, ...)` : callback vide ; après login, rien ne se passe (vrai push L327-336 inatteignable). Contraste avec `handleShowMyArticles` (L394 `() => setDepositOpened(true)`). `handleItemLongPress` (L344) a le même défaut. **Reco** : passer le vrai handler `router.push('/propose-swap', ...)` en callback.

#### P2-15 — SwapItemSelector : barre 'Confirmer' sans safe-area inset
- **P2 · android** — `components/swap/SwapItemSelector.tsx:102-107,257-266,162-168`
- `<Modal transparent>` ancré en bas (`justifyContent:'flex-end'`, `height:'85%'`), `bottomBar` avec `paddingVertical: spacing.lg` sans `useSafeAreaInsets`. Bouton « Confirmer » sous la nav gestuelle Android. Convention : `AddItemSheet.tsx:113` `insets.bottom + spacing.md`. **Reco** : injecter `useSafeAreaInsets` + `statusBarTranslucent` au Modal (cf. P2-19).

#### P2-16 — Le tri 'Populaires' retombe silencieusement sur 'récent'
- **P2 · both** — `features/swap-party/hooks/useSwapZoneFilters.ts:36-52,124-135` ; `app/swap-zone.tsx:606,444` ; `features/search/constants.ts:9-14`
- `items={SORT_ITEMS}` complet (L606) ; `'popular'` tombe dans le `else` = `addedAt desc` (= `recent`). Le chip affiche « Populaires » actif mais l'ordre ne change pas. Le search screen filtre déjà SORT_ITEMS. **Reco** : retirer 'Populaires' du tri SwapZone.

#### P2-17 — Items orphelins : article supprimé/désactivé reste affiché avec métadonnées partielles
- **P2 · both** — `services/swapService.ts:151-166,197-230` (L207-209 `if (!articleSnap.exists()) return item`) ; `functions/src/triggers/articles.ts` ; `functions/src/http/webhooks.ts:374` ; `functions/src/callable/payments.ts:711` ; `services/articlesService.ts:833`
- `getPartyItemsExtended` conserve l'item de zone si l'article n'existe plus (au lieu de l'exclure) ; `getPartyItems` ne filtre que `isSwapped==false`. Aucun trigger ne nettoie `swapPartyItems` sur vente/soft-delete hors swap → carte fantôme tappable, exclue de tout filtre (`categoryIds undefined`). La CF rejette tardivement. **Reco** : exclure dans `getPartyItemsExtended` les articles inexistants/`isSold`/`!isActive` + trigger de nettoyage. **Router vers `firebase-backend`.**

#### P2-18 — RefreshControl SwapZone stylé iOS-only (spinner/fond clair sur canvas sombre Android)
- **P2 · android** — `app/swap-zone.tsx:557-563,699-701`
- Seul `tintColor={colors.sand}` (iOS) ; aucune prop `colors`/`progressBackgroundColor` (Android) → disque blanc par défaut sur `colors.deep` (#0F0E0C), violant l'identité sombre. **Reco** : `colors={[colors.sand]}` + `progressBackgroundColor={colors.darkSurface2}`. *(Systémique : 9 fichiers RefreshControl sans `progressBackgroundColor`, mais SwapZone le plus visible.)*

### P2 — Cross-plateforme transverse

#### P2-19 — SwapItemSelector (Modal RN) : barre sans safe-area + Modal sans statusBarTranslucent
- **P2 · both** — `components/swap/SwapItemSelector.tsx:102,257`
- Voir P2-15. Modal sans `statusBarTranslucent` → rendu haut divergent iOS/Android. Convention : `SuccessModal.tsx:65`, `DraftResumeModal.tsx:57`. **Reco** : `useSafeAreaInsets` + `statusBarTranslucent`.

#### P2-20 — SubmitFooter : paddingBottom fixe (32) dans SafeAreaView edges=['bottom'] (downgrade P2→P3)
- **P3** (révisé) **· both** — `features/propose-swap/components/SubmitFooter.tsx:53-60` ; `app/propose-swap.tsx:281,330`
- Cumul `insets.bottom` (SafeAreaView) + `paddingBottom: 32` (footer) → trop d'espace iOS-encoche, non calibré Android. `32` magique (`spacing.xl` existe). **Reco** : retirer 'bottom' de `edges` + `paddingBottom: Math.max(insets.bottom, spacing.md)`.

#### P2-21 — KeyboardAvoidingView inactif sur Android dans propose-swap (downgrade P1→P2)
- **P2** (révisé) **· android** — `app/propose-swap.tsx:284-287,328-330` ; `features/propose-swap/components/ValueComparisonBox.tsx:115` ; `features/propose-swap/components/SwapMessageInput.tsx:23` ; `app.config.js`
- `behavior={Platform.OS === 'ios' ? 'padding' : undefined}` (no-op Android), footer hors ScrollView. **Nuance** : `adjustResize` (défaut Expo, AndroidManifest) rétrécit la fenêtre → contenu reste atteignable ; pattern dominant du codebase (sell/chat/checkout). **Reco** : harmoniser (idéalement `react-native-keyboard-controller` ou `behavior='height'`), tester sur petit écran Android.

#### P2-22 — ScrollView de swap/[id] avec paddingBottom 120 non inset-aware (downgrade P2→P3)
- **P3** (révisé) **· android** — `app/swap/[id].tsx:506-508` ; `features/swap/components/SwapStickyActions.tsx:57-67`
- `paddingBottom: 120` magique vs barre ~93px. **Nuance** : `SafeAreaView edges={['bottom']}` absorbe l'inset (la barre absolue flotte au-dessus), donc le risque « masquage Android dû à inset » est techniquement faux ; reste ~27px de marge. Fragilité réelle au scaling de police + nombre magique. **Reco** : dériver `paddingBottom` de la hauteur réelle de la barre (cf. `ArticleCTABar`).

### P3 — Copy / DS / code mort

#### P3-1 — Incohérence tutoiement/vouvoiement entre ValueComparisonBox et le reste de l'écran
- **P3 · both** — `features/propose-swap/components/ValueComparisonBox.tsx:41,46,57,58` ; `app/propose-swap.tsx:207,216,246` ; `components/swap/ValueDifferenceBox.tsx:33`
- « Vos articles »/« en votre faveur » (vous) vs alertes en « tu » (L207/216/246). `Je paie` (L90) est neutre, déjà OK. `ValueDifferenceBox.tsx:33` est dead-code. **Reco** : uniformiser ValueComparisonBox sur le tutoiement.

#### P3-2 — Mélange tutoiement/vouvoiement et formulation genrée dans le parcours swap
- **P3 · both** — `features/swap/components/SwapActions.tsx:223,238` ; `features/swap/components/SwapProposalView.tsx:72,89` ; `components/swap/ValueDifferenceBox.tsx:33` ; `app/swap/[id].tsx:280` ; `components/swap/SwapSummaryBox.tsx:43,51`
- `ExchangeModeSelector` (« Retrouvez-vous »/« Envoyez-vous ») vouvoie dans un module qui tutoie partout ailleurs. « Elle propose »/« Elle ajoute » (SwapProposalView.tsx:72,89) = genre présumé hardcodé. **Reco** : tutoiement + formulation neutre (`${senderName} propose`).

#### P3-3 — Registre incohérent transverse (tu vs vous) dans le flow swap
- **P3 · both** — `features/swap/components/SwapActions.tsx:210,223,238` ; `features/propose-swap/components/ValueComparisonBox.tsx:41,47,58` ; `features/swap-party/components/MyArticlesSection.tsx:137,142` ; `app/my-swaps.tsx:187` ; `features/swap-party/components/AddItemSheet.tsx:132,156` ; `app/swap/[id].tsx:280,422`
- Mix tu/vous, dont DANS le même composant (SwapActions.tsx:210 « tu » vs :223 « vous »). *(SwapItemSelector.tsx neutre → hors périmètre.)* **Reco** : harmoniser sur le tutoiement (dominant).

#### P3-4 — Symbole dollar en préfixe au lieu du suffixe canadien-FR
- **P3 · both** — `features/propose-swap/components/ValueComparisonBox.tsx:114` ; `utils/formatPrice.ts:8,22` ; `features/sell/components/pricing/PriceCard.tsx:23` ; `features/search/components/PriceRangeInputs.tsx:46,60` ; `components/MakeOfferModal/OfferStep.tsx:80`
- `$` préfixe (style US) devant le TextInput vs totaux suffixés. **Nuance** : placement du `$` incohérent à l'échelle du projet (préfixe dans PriceCard, suffixe dans PriceRangeInputs/OfferStep) — pas un fichier isolé. **Reco** : standardiser via un atom de saisie monétaire partagé.

#### P3-5 — KeyboardAvoidingView désactivé sur Android (behavior=undefined) — fragile
- **P3 · android** — `app/propose-swap.tsx:286` ; `features/propose-swap/components/SwapMessageInput.tsx:23`
- Compensé par `adjustResize` (AndroidManifest:24), mais dépend d'un défaut implicite. **Reco** : retirer la condition Platform OU `behavior='height'` + documenter.

#### P3-6 — confirmSwapShipping autorisé en statut photos_pending
- **P3 · backend** — `functions/src/callable/swaps.ts:1020-1074,1048-1050`
- Accepte `['shipping', 'photos_pending']` (L1048) ; timestamps purement informatifs (réception exige `'shipping'` L1110). **Nuance** : l'UI gate « J'ai envoyé » sur `'shipping'` (SwapActions.tsx:147) → pas atteignable via flow normal. **Reco** : restreindre à `'shipping'`.

#### P3-7 — ValueDifferenceBox : composant swap mort, exporté sans consommateur
- **P3 · na/both** — `components/swap/ValueDifferenceBox.tsx:18` ; `components/swap/index.ts:3,8` ; `features/propose-swap/components/ValueComparisonBox.tsx:23` ; `app/propose-swap.tsx:316`
- Aucun consommateur (grep = self + barrel). Le flow utilise `ValueComparisonBox` (API distincte). Couleurs `rgba(196,96,58,x)` (L68,70) = `colors.rust` hardcodé (violation DS). **Reco** : supprimer le fichier + les 2 exports du barrel. *(Trois findings le décrivent — un seul correctif.)*

#### P3-8 — Cream/beige HARDCODÉ en RGBA magiques sur fond charcoal (SwapSummaryBox)
- **P3 · both** — `components/swap/SwapSummaryBox.tsx:62,73,86,5`
- `backgroundColor: colors.charcoal` + `rgba(245,240,232,0.4/0.6)` (dérivés à la main de `colors.cream`) + `Text` importé de 'react-native'. **Nuance** : hors-zone SwapZone (carte hero sombre sur écran clair, choix assumé) — ne PAS remplacer charcoal par deep. **Reco** : token `creamTranslucent` + `Text` depuis `@/components/ui`.

#### P3-9 — Canvas sombre incohérent : teaser home (gradient #3D352E→#1C1712) vs écran SwapZone (deep #0F0E0C)
- **P3 · both** — `constants/theme.ts:462` ; `features/home/swap-zone/SwapZoneSection.tsx:49` ; `app/swap-zone.tsx:701` ; `features/swap-party/components/SwapPartyDetailSkeleton.tsx:123` ; `features/swap-party/components/PartyItemCard.tsx:118`
- Borne haute du gradient teaser plus claire que `colors.deep` → assombrissement au passage home→zone. Skeleton tuiles `darkSurface2` vs cartes `darkSurface1` → flash de luminance. **Nuance** : sauts partiellement intentionnels. **Reco** : rapprocher le gradient de deep ; aligner skeleton sur `darkSurface1`.

#### P3-10 — Rupture immersion sombre→clair non signalée (sheets filtre, AddItemSheet, propose-swap)
- **P3 · both** — `app/swap-zone.tsx:595` ; `features/swap-party/components/AddItemSheet.tsx:8-9,246` ; `app/propose-swap.tsx:362`
- Depuis le canvas sombre, sheets de filtre/dépôt et propose-swap restent clairs (choix documenté). Dilue l'identité « univers distinct » aux moments d'action. **Reco** : décision design (variantes dark via `tone='dark'` déjà existant, ou statu quo documenté).

#### P3-11 — MultiSelectBar : risque théorique de recouvrir la dernière rangée (downgrade confirmé P3)
- **P3 · android** — `app/swap-zone.tsx:777-782` ; `features/swap-party/components/MultiSelectBar.tsx:46-57`
- `paddingBottom` fixe 128px ignorant `isMultiSelectMode`. **Nuance** : occlusion nécessite `insets.bottom > ~61px`, jamais atteint sur matériel courant (24-48px) → edge théorique, impact pratique quasi nul. **Reco** : `paddingBottom` dynamique (robustesse, facultatif).

#### P3-12 — Aucun retour haptique au long-press qui déclenche le multi-select
- **P2 · both** — `app/swap-zone.tsx:341-353` ; `features/swap-party/components/PartyItemCard.tsx:42-53` ; `features/search/components/FilterChipsRow.tsx:61,79` ; `features/swap-party/hooks/useSwapZoneFilters.ts:179,184`
- `handleItemLongPress` (bascule d'état majeure, gesture invisible) sans `Haptics`, alors que les filtres en ont. **Correction** : `FilterChipsRow` est dans `features/search/`, pas `swap-party`. **Reco** : `Haptics.impactAsync(Medium)` + `import * as Haptics from 'expo-haptics'`.

#### P3-13 — Bouton 'Ajouter' AddItemSheet non protégé contre le double-tap (downgrade P2→P3)
- **P3 · both** — `features/swap-party/components/AddItemSheet.tsx:92-98,114-118` ; `app/swap-zone.tsx:216-218,584-593` ; `features/swap-party/components/MyArticlesSection.tsx:37`
- `disabled={count === 0}` seulement, `isAddingItem` non propagé. **Nuance** : `dismiss()` synchrone immédiat (réseau non awaité) + `setSelected(new Set())` + garde `isAddingItem` → double-dépôt impossible, feedback skeleton sur l'écran de destination. Résidu = pas d'état pressed dans la fraction de seconde avant dismiss. **Reco** : passer `isAddingItem` (polish).

#### P3-14 — Swap Zone : état vide initial austère dans PartyEmptyGrid (downgrade P2→P3)
- **P3 · both** — `features/swap-party/components/PartyEmptyGrid.tsx:19-47` ; `app/swap-zone.tsx:498-501,474-496` ; `features/swap-party/components/MyArticlesSection.tsx`
- Branche sans-filtre = texte seul (pas d'icône ni CTA). **Nuance** : prémisse « écran nu » FAUSSE — le `ListHeaderComponent` rend toujours `MyArticlesSection` (drop-zone tappable « Déposer un article ») au-dessus. L'incitation au dépôt est déjà présente. **Reco** : icône + CTA secondaire dans la branche sans-filtre (cosmétique facultatif).

---

## Matrice cross-plateforme

| Zone | iOS | Android | Écart |
|------|-----|---------|-------|
| SwapStickyActions (Accepter/Refuser) | `paddingBottom:32` ≈ home-indicator | inset réel 0/24/48 ≠ 32 → sous nav bar / espace mort | **Oui (P1-2)** — pas de `useSafeAreaInsets` |
| SwapItemSelector « Confirmer » | home-indicator masque peu | nav gestuelle masque le bouton ; Modal sans `statusBarTranslucent` | **Oui (P2-15/19)** |
| Multi-select : retour | edge-swipe (même défaut latent) | bouton matériel quitte l'écran, perd la sélection | **Oui (P1-3)** — aucun `BackHandler` dans l'app |
| RefreshControl SwapZone | spinner `sand` sur `deep` (OK) | disque blanc par défaut sur canvas sombre | **Oui (P2-18)** — `colors`/`progressBackgroundColor` absents |
| KeyboardAvoidingView propose-swap | `behavior='padding'` lisse | `undefined`, compensé par `adjustResize` | **Oui (P2-21)** — atténué |
| SubmitFooter / scrollContent | inset + 32 → trop d'espace | inset variable, 120/32 magiques | **Oui (P2-20/22)** — nombres magiques |
| Nav bar système (fond) | home-indicator | **transparente** (edge-to-edge SDK 56), canvas deep visible | **Non — faux positif** |
| Logique backend (proposeMultiSwap, dispute, buckets, prix, cents) | identique | identique | Non (bug universel, pas un écart) |
| Copy tu/vous, format devise `$45` | identique | identique | Non (cosmétique universel) |

---

## Plan d'action priorisé (P0 → P3)

**P0 — sécurité & recours (avant tout déploiement swap) — `firebase-backend` + `rn-expo-dev`**
1. P0-1/P1-5 : ajouter `expectedSellerId` à `validateArticlesAvailable`, comparer `data.sellerId` dans `proposeMultiSwap` ET `acceptSwap` ; dériver `receiverName/Image` côté serveur. *(backend)*
2. P0-2 + P1-9 : exposer `openSwapDispute` dans `swapService` + bouton « Signaler un problème » (shipping/completed) + fenêtre de rétention `heldBalance` (sinon le bouton est inopérant après réception). *(backend + app)*
3. P0-3 : `createOrGetChat` avant `router.push('/chat/...')` dans `SwapContactButton`. *(app)*

**P1 — bugs fonctionnels & écarts iOS/Android — `rn-expo-dev` (+ `firebase-backend`)**
4. P1-8 : diviser le complément par 100 + `formatPrice` (affichage faux ×100). *(app)*
5. P1-2 : `useSafeAreaInsets` sur SwapStickyActions. *(app)*
6. P1-3 : `BackHandler` via `useFocusEffect` pour le multi-select Android. *(app)*
7. P1-4 : dériver `selectedCount`/`canPropose` de l'intersection filtrée. *(app)*
8. P1-11 : error callback sur `subscribeToSwap` + boutons retour skeleton/erreur. *(app)*
9. P1-1 : supprimer le double CTA Accepter/Refuser. *(app)*
10. P1-6 / P1-7 : recalcul serveur des prix + verrou « un article = un swap actif ». *(backend)*
11. P1-10 : entrée « Mes échanges » (profil + SwapZone) + notification in-app `swap_proposed`. *(app + backend)*

**P2 — UX / cohérence / finition (~22)** — alertes d'erreur explicites (P2-1), profil factice (P2-4), cashTopUp + isError dans Mes échanges (P2-5), invalidation RQ (P2-6), filtre `disputed` (P2-7), format devise (P2-12), guest callback (P2-14), tri 'Populaires' fantôme (P2-16), items orphelins + trigger nettoyage (P2-17, backend), RefreshControl sombre (P2-18), safe-area SwapItemSelector (P2-15/19).

**P3 — copy / DS / dette (~18)** — uniformiser tutoiement (P3-1/2/3), supprimer `ValueDifferenceBox` (P3-7), tokens DS pour RGBA cream (P3-8), token de saisie monétaire (P3-4), haptique long-press (P3-12), restreindre `confirmSwapShipping` (P3-6), décision design immersion sombre (P3-10).

---

## Annexe — faux positifs écartés

### FP-1 — Barre de navigation système Android non teintée : liseré clair sous le canvas sombre de la SwapZone
- **Verdict** : faux positif. Citations exactes mais **prémisse fausse**, contredite par l'artefact natif.
- `android/app/src/main/res/values/styles.xml:5-6` déclare `android:navigationBarColor` = **transparent** (pas « clair par défaut »). Le projet tourne sous Expo SDK 56 / RN 0.85.3 (et non « RN 0.83 » du CLAUDE.md — divergence à signaler) → **edge-to-edge imposé** : la nav bar est transparente et le canvas `colors.deep` se dessine derrière elle, comme iOS sous le home-indicator. L'écart clair/sombre décrit n'existe pas.
- La recommandation d'origine (ajouter `androidNavigationBar` dans `app.config.js`) est **inopérante** : clé legacy ignorée sous edge-to-edge SDK 54+, et le système fait déjà ce que le finding réclame.
- Réserve mineure (n'élève pas la sévérité) : la teinte des ICÔNES de la nav bar n'est pas pilotée par `expo-status-bar` ; contraste potentiellement faible sur fond deep — mais ce n'est PAS le finding décrit.
