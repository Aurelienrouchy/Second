# Audit User / Auth / Onboarding — Cross-platform iOS/Android (2026-06-01)

## Résumé exécutif

Audit logique et UX du parcours utilisateur (onboarding, auth/social, état de session, profil, settings, vie privée/légal, cohérence des données et parité iOS/Android). 43 findings confirmés ou nuancés, vérifiés ligne à ligne dans le code réel. Le point le plus grave (**P0**) : la Cloud Function `deleteUserAccount` ne re-vérifie côté serveur **que** le solde wallet (`balance`/`pendingBalance`), ignorant `heldBalance`, `sellerDebt` et les litiges/transactions actives — tous les autres garde-fous financiers sont client-only et contournables. Trois axes structurels reviennent : (1) **comptes Apple-only verrouillés sur Android** (aucune connexion ni récupération), (2) **export RGPD/Loi 25 qui n'exporte jamais les messages** (mauvaise sous-collection Firestore), (3) **divergence de schéma/identité** (username persistant absent du profil public, états non réactifs dans Settings). Plusieurs écrans Settings et le flux Vendre présentent des écarts iOS↔Android (KeyboardAvoidingView, StatusBar, BackHandler, double implémentation caméra).

| Sévérité | Nombre confirmé |
|----------|-----------------|
| P0       | 1               |
| P1       | 9               |
| P2       | 16              |
| P3       | 17              |
| **Total**| **43**          |

> Note : certaines sévérités d'origine ont été révisées après vérification (ex. plusieurs P0 candidats requalifiés P1, des P1 requalifiés P2). Le tableau ci-dessus reflète les sévérités **révisées**.

---

## Findings P0 — bloquants / failles

### P0-1 — Suppression de compte : garde-fous financiers client-only, non re-vérifiés serveur
- **Sévérité** : P0
- **Plateforme** : both
- **Fichiers** : `app/settings/delete-account.tsx:90-163`, `functions/src/callable/users.ts:37-51`, `functions/src/callable/users.ts:237-246`, `functions/src/callable/wallet.ts:18-34`, `functions/src/callable/wallet.ts:217-221`, `services/authService.ts:813-823`, `services/transactionService.ts:360-371`
- **Description** : `delete-account.tsx` bloque la suppression dans 4 cas (transactions actives `:90-119`, litige, dette vendeur `sellerDebt>0` `:126-134`, fonds en attente `heldBalance+pendingBalance>0` `:153-163`). Mais la callable `deleteUserAccount` — seule autorité réelle (le client `AuthService.deleteAccount()` `authService.ts:813-823` appelle la callable **sans argument**) — ne re-vérifie QUE `if (walletBalance > 0 || walletPending > 0)` (`users.ts:43`). Elle ne contrôle ni `heldBalance`, ni `sellerDebt`, ni les transactions/litiges actifs. `wallet.ts:18-34` documente que `heldBalance` = fonds d'une vente livrée dans la fenêtre de protection 7 j et qu'un litige déplace les fonds vers `heldBalance` (server-only). La fonction supprime ensuite le wallet + tout le ledger (`users.ts:237-246`) et anonymise les transactions (`buyerName/sellerName → 'Utilisateur supprime'`, `users.ts:216-230`).
- **Impact** : Un appel callable forgé (build modifié) ou une race condition entre le check client et l'appel permet de supprimer un compte avec `heldBalance` gelé, `sellerDebt` impayé ou litige en cours. Le wallet et son ledger étant détruits, on perd la trace comptable pendant qu'un acheteur attend un remboursement ou que la plateforme attend un recouvrement. La plateforme étant l'autorité KYC/litiges (Stripe Connect Custom), c'est un trou de défense-en-profondeur sur une opération financière irréversible.
- **Recommandation** : Dupliquer dans `deleteUserAccount`, AVANT tout cleanup, les pré-checks serveur : `heldBalance > 0`, `sellerDebt > 0`, et une requête `transactions` où `buyerId==uid OR sellerId==uid` avec `status in [activeStatuses]` (même liste que `getActiveTransactionsForUser`, `transactionService.ts:361-373`). Rejeter via `failed-precondition`. Le client ne doit jamais être le seul rempart.

---

## Findings P1 — bugs & écarts iOS ↔ Android

### P1-1 — Persistance Firestore des préférences d'onboarding en fire-and-forget (commentaire trompeur "blocking for logged-in user")
- **Sévérité** : P1
- **Plateforme** : both
- **Fichiers** : `app/onboarding.tsx:139-173` (bloc `:155-165`), `functions/src/callable/onboarding.ts:65-98`, `hooks/usePersonalizedFeed.ts:59-94`, `services/authMergeService.ts:28-45`, `store/authStore.ts:234-273`, `app/index.tsx:13-31`
- **Description** : Le commentaire `onboarding.tsx:155` annonce "non-blocking for guest, blocking for logged-in user". En réalité `savePrefs({...}).catch(...)` n'est jamais `await`-é (erreur seulement loguée en `__DEV__`), et `router.replace('/(tabs)')` (`:165`) s'exécute inconditionnellement, pour **tous** les cas. Un user connecté atteint bien l'onboarding (le gate `index.tsx:13-31` ne dépend que du flag local AsyncStorage). Si la callable échoue (cold start fonction v2, réseau coupé au VALIDER, quota), `users/{uid}.preferences.sizes` et `onboardingCompleted:true` ne sont jamais écrits serveur. Or `usePersonalizedFeed` (`:60-69`) lit exactement `user.preferences.sizes`/`favoriteBrands` (l'onboarding ne collecte PAS `favoriteBrands` → le feed repose entièrement sur `sizes`).
- **Impact** : Feed "Pour Toi" vide en permanence sans aucun message ni retry, contredisant la promesse welcome ("personnaliser ton expérience"). Le `@onboarding_preferences` AsyncStorage n'est rejoué vers Firestore qu'au prochain `mergeGuestDataIntoUser` (transitions d'auth uniquement, `authStore.ts:237-273`), jamais pour un user déjà connecté.
- **Recommandation** : `await` la callable quand `user!=null` + toast/retry sur échec, ou rejeu différé au prochain foreground. Aligner le commentaire `:155` sur le comportement réel.

### P1-2 — Compte Apple-only inaccessible et irrécupérable sur Android
- **Sévérité** : P1
- **Plateforme** : android
- **Fichiers** : `components/auth-bottom-sheet/SignInForm.tsx:60-71`, `components/auth-bottom-sheet/SignUpForm.tsx:122-133`, `services/authService.ts:396-485` (`:449`, `:715-718`, `:862-864`), `app/settings/add-password.tsx:20-28`, `app/settings/email.tsx:278`, `app/settings/delete-account.tsx:343`, `app.config.js:36`
- **Description** : Le bouton Apple n'est rendu que sur iOS (`Platform.OS === 'ios'`, `SignInForm.tsx:60` + `SignUpForm.tsx:122`). `signInWithApple` repose sur expo-apple-authentication, iOS-only. Un user qui crée son compte avec Apple sur iPhone puis passe sur Android n'a aucun moyen de se reconnecter : pas de bouton Apple, pas de mot de passe défini (provider fédéré), et `reauthenticateWithApple` lève explicitement une erreur hors iOS (`authService.ts:716-718`). Le contournement "ajouter un mot de passe" (`add-password.tsx`) exige d'être DÉJÀ connecté (`linkPasswordCredential` requiert `auth.currentUser`, `authService.ts:862-864`) — inaccessible depuis Android. Si l'email était masqué à l'inscription, c'est un alias `@privaterelay.appleid.com` qui est stocké (`authService.ts:449`).
- **Impact** : Verrouillage de compte sur Android (potentiellement solde vendeur, commandes, historique), sans message explicatif. Contraire à l'objectif "comportement identique iOS/Android". Population concernée : users multi-appareils ou ayant migré d'iPhone vers Android.
- **Recommandation** : Afficher sur Android un message explicite pour les comptes Apple-only ("Connectez-vous depuis un iPhone ou ajoutez un mot de passe depuis iOS") ; inciter fortement à lier un email/mot de passe dès la création d'un compte Apple ; envisager un flux de récupération par email.

### P1-3 — Le @handle (username immuable) jamais affiché sur le profil public d'autrui — fallback re-dérivé du displayName
- **Sévérité** : P1
- **Plateforme** : both
- **Fichiers** : `functions/src/callable/reviews.ts:354`, `services/reviewService.ts:37`, `features/user-profile/components/ProfileHeader.tsx:44`, `app/user/[id].tsx:145`, `services/userService.ts:52`
- **Description** : `ProfileHeader` lit `user.username` avec fallback legacy `@displayName.toLowerCase().replace(/\s+/g,'.')` (`:44-48`). Pour tout profil d'autrui, `profileUser` vient du callable `getUserPublicProfile`, dont le payload `profile` (`reviews.ts:354-363`) NE contient PAS `username` (ni le type `UserPublicProfile.profile`, `reviewService.ts:37`, ni le mapping `app/user/[id].tsx:148-159`). Le chemin profil-propre, lui, charge le doc complet via `getUserById` (`userService.ts:52`, spread complet → username présent). Résultat : sur le profil d'autrui, le handle est TOUJOURS la dérivation legacy.
- **Impact** : Deux personnes voyant le même vendeur peuvent lire un @handle différent de celui que le vendeur voit. Si le vendeur change son displayName, son handle public re-dérivé change alors que son vrai username reste figé. Contredit l'invariant projet (`types/index.ts:66-73` : username immuable, découplé du displayName).
- **Recommandation** : Ajouter `username: userData.username || null` au payload `getUserPublicProfile` (`reviews.ts:354`), au type `UserPublicProfile.profile` (`reviewService.ts:37`) et au mapping (`app/user/[id].tsx:148`). Garder `null` pour les vieux comptes (règle "no undefined in Firestore") et préserver le fallback gracieux.

### P1-4 — Menu Paramètres : état provider/hasPassword périmé (non réactif) après ajout de mot de passe
- **Sévérité** : P1
- **Plateforme** : both
- **Fichiers** : `app/settings/index.tsx:70-73`, `app/settings/add-password.tsx:60-67`, `services/authService.ts:674-688`, `services/authService.ts:862-881`, `contexts/AuthContext.tsx:30`, `store/authStore.ts:220-232`
- **Description** : `index.tsx:71-73` calcule `authProvider`/`hasPassword`/`isEmailVerified` au rendu via des appels synchrones non réactifs (`AuthService.getAuthProvider()`, `hasPasswordProvider()` lisent `auth.currentUser.providerData`). La seule souscription réactive de l'écran est `useUser()` (`:70`), qui observe le doc Firestore, pas la liste des providers. `add-password.tsx:60-67` fait `router.back()` après succès sans `refreshUser` ni écriture authStore. Comme l'écran Paramètres est conservé dans la stack (pas de remount), `hasPassword` reste à sa valeur précédente.
- **Impact** : Après ajout du mot de passe, le menu affiche toujours "Ajouter un mot de passe" : l'utilisateur croit que l'opération a échoué. Même racine pour `isEmailVerified` (bloc "Vérifier mon email"). Transitoire (se recalcule à la fermeture/réouverture), donc P1 et non P0.
- **Recommandation** : Dériver `hasPassword`/`provider` d'un state observable, OU appeler `authStore.refreshUser()` après `linkPasswordCredential` + `useFocusEffect` au retour pour recalculer.

### P1-5 — Cold start hors-ligne : un utilisateur authentifié apparaît comme invité
- **Sévérité** : P1
- **Plateforme** : both
- **Fichiers** : `store/authStore.ts:117-178` (`:168`), `services/authService.ts:632-643`, `services/authService.ts:655-672`, `config/firebaseConfig.ts:53`, `hooks/useAuthListener.ts:35-48`
- **Description** : `hydrateFromFirebase` (seul writer de l'état authentifié) refait systématiquement un `getDoc` Firestore (`getCurrentUser → getUserData`) même quand Firebase Auth a déjà restauré une session valide depuis AsyncStorage (`auth` persiste via `getReactNativePersistence`, `firebaseConfig.ts:47-50`). Mais Firestore est initialisé sans persistance (`getFirestore(app)`, `:53`, aucun `persistentLocalCache`). Au cold start hors-ligne le `getDoc` rejette, `getUserData` catch → `null` (`authService.ts:669`), et `hydrateFromFirebase` tombe sur `set({ user: null, isLoading: false })` (`authStore.ts:168`). De plus `USER_DATA_KEY` est persisté à chaque hydratation (`:151`) mais jamais relu, donc ne sert pas de fallback.
- **Impact** : Un user rouvrant l'app sans réseau (métro, avion, zone blanche) voit l'écran profil en mode invité, perd l'accès apparent à favoris/commandes/wallet, et se voit proposer de "Se connecter" alors qu'il l'est. Auto-réparant à la reconnexion (listener re-fire + reload foreground `useAuthListener.ts:42-48`).
- **Recommandation** : Activer le cache Firestore persistant (`initializeFirestore` + `persistentLocalCache`) et/ou relire `USER_DATA_KEY` comme fallback optimiste quand `getCurrentUser` échoue alors que `firebaseUser` est non-null. **Attention** : le fallback ne doit PAS court-circuiter le consent gate Loi 25 (`authStore.ts:134-141`, `if (!fresh.dateOfBirth) → user:null`) → exiger `dateOfBirth` présent dans le User mis en cache.

### P1-6 — Compte Apple-only inaccessible sur Android : aucune voie de connexion ni de récupération (variante transverse)
- **Sévérité** : P1
- **Plateforme** : android
- **Fichiers** : `components/auth-bottom-sheet/SignInForm.tsx:60-71`, `components/auth-bottom-sheet/SignUpForm.tsx:122-133`, `services/authService.ts:715-718`, `app/settings/email.tsx:266-285`, `app/settings/delete-account.tsx:332-351`, `components/AuthBottomSheet.tsx:140-147`
- **Description** : Même cause que P1-2, cadré sous l'angle cross-plateforme transverse. Le provider Apple est bien stocké (`authProvider:'apple'`, `authService.ts:462`) mais ne débloque rien côté connexion Android. Les protections `isAppleOnAndroid` dans `email.tsx:42` et `delete-account.tsx:38` ne s'activent QUE pour un user DÉJÀ connecté (`getAuthProvider` lit `auth.currentUser`, retourne 'unknown' sinon, `authService.ts:676`). Le lien "Mot de passe oublié" (`SignInForm.tsx:147`) → `sendPasswordResetEmail` (`authService.ts:800`) n'établit aucun accès utilisable pour un compte sans provider 'password'.
- **Impact** : Verrouillage définitif sur Android, aucun message sur l'écran de connexion (le bouton est simplement absent), pas de flux de récupération alternatif.
- **Recommandation** : Idem P1-2 — message guidant l'Apple-only sur Android + flux de récupération par email.

### P1-7 — Export Loi 25 : les messages ne sont jamais exportés (mauvaise sous-collection)
- **Sévérité** : P1
- **Plateforme** : both
- **Fichiers** : `services/userService.ts:454-476` (`:456`), `app/settings/export-data.tsx:134-138`, `services/chatService.ts:346-364` (`:361`), `services/chatService.ts:1312-1318`, `functions/src/callable/users.ts:149`
- **Description** : L'écran promet "Messages — Vos messages envoyés" (`export-data.tsx:134-138`). Mais `exportUserData` lit dans la sous-collection `chats/{chatId}/messages` (`userService.ts:456-457`, `where('senderId','==',userId)`). Or le modèle réel stocke les messages dans une collection **top-level** `messages` avec champ `chatId` (`chatService.ts:361` `addDoc(collection(firestore,'messages'), {chatId, senderId, ...})` ; lecture `subscribeToMessages :1312-1318`). La sous-collection n'est jamais écrite (grep : 20+ refs top-level, 1 seule occurrence sous-collection = la query d'export). La suppression, elle, vise bien `messages` top-level (`users.ts:149`).
- **Impact** : `chats[].myMessages` est systématiquement `[]` pour tous les utilisateurs. Non-conformité partielle au droit à la portabilité (Loi 25 art. 27 / PIPEDA art. 20) : le contenu des messages, qui existe bien, n'est jamais inclus. Le reste de l'export (profil, articles, favoris, transactions, liste des chats) fonctionne → P1 et non P0.
- **Recommandation** : Remplacer par `collection(firestore,'messages')` filtré `where('chatId','==',chatDoc.id)` + `where('senderId','==',userId)`, à l'image de la suppression. Inclure la contrainte `participants array-contains uid` pour respecter les rules Firestore (`chatService.ts:1307-1316`).

### P1-8 — Suppression de compte : garde-fou transactions actives/litiges client-only (variante data)
- **Sévérité** : P1
- **Plateforme** : both
- **Fichiers** : `app/settings/delete-account.tsx:91`, `app/settings/delete-account.tsx:96`, `functions/src/callable/users.ts:38`, `functions/src/callable/users.ts:216`, `services/authService.ts:813`, `services/transactionService.ts:360`
- **Description** : Angle "cohérence des données" du P0-1. `delete-account.tsx:91-119` bloque sur transaction active/litige côté client uniquement. `AuthService.deleteAccount()` appelle la callable sans argument. Le seul pré-check serveur reste le wallet (`users.ts:38-51`), qui ne lit que `balance`/`pendingBalance` — pas `heldBalance`, pas de requête transactions. À l'étape 12 (`:216-230`) les transactions sont anonymisées directement.
- **Impact** : Un litige (`disputed`/`lost`/`delivery_failed`) ou une vente avec fonds en `heldBalance` peut être abandonné par suppression de compte ; la transaction anonymisée rend la résolution et la régularisation impossibles. Requalifié P1 (vs P0) car l'exploit nécessite un appel direct de la callable ou une race condition étroite, et les fonds restent dans le ledger (c'est la traçabilité de la contrepartie qui est compromise).
- **Recommandation** : Identique au P0-1 — requête transactions actives serveur + check `heldBalance`/`sellerDebt` avant cleanup, `failed-precondition` si non vide.

### P1-9 — Flux Vendre radicalement différent iOS (overlay immersif) vs Android (navigation tab) — note : voir P2-2 (requalifié)
> Ce finding initialement P1 a été **requalifié P2** après vérification (dette de duplication réelle mais impact runtime mineur). Voir **P2-2** dans la section suivante.

---

## Findings P2 / P3

### P2-1 — Tap backdrop / pan-down supprime silencieusement le compte social pendant l'étape de consentement
- **Sévérité** : P2 (révisée de P1)
- **Plateforme** : both
- **Fichiers** : `components/AuthBottomSheet.tsx:105-115`, `components/AuthBottomSheet.tsx:132-138`, `components/AuthBottomSheet.tsx:387-402`, `services/authService.ts:568-608`, `store/authStore.ts:277-284`, `services/authService.ts:295-302`
- **Description** : Après une connexion sociale brand-new (`isNewUser=true`), le compte Firebase + doc `users/{uid}` existent déjà et l'app affiche l'étape `socialConsent`. Le `BottomSheetBackdrop` (`:135`) n'a pas de `pressBehavior` → défaut `'close'` (vérifié gorhom v5.2.14) : un tap hors feuille ferme. `enablePanDownToClose` (`:393`) est aussi actif. Les deux déclenchent `handleClose` (`:105`) → `rollbackSocialSignIn(true)` → `rollbackUnconsentedAccount` qui `deleteDoc` + `firebaseUser.delete()` (`authService.ts:584-594`), sans aucune Alert.
- **Impact** : Un geste involontaire (surtout pan-down sur Android) pendant la saisie de la date de naissance supprime le compte tout juste créé. La suppression est un choix délibéré de conformité Loi 25 (ne jamais laisser un compte sans preuve de consentement), donc ce n'est pas un bug logique mais un défaut UX. Pour un compte brand-new il n'y a rien de valeur à perdre (friction = relancer l'auth) → P2.
- **Recommandation** : Pendant `authType === 'socialConsent'`, désactiver `enablePanDownToClose` et passer le backdrop en `pressBehavior='none'`, OU intercepter avec une Alert "Abandonner l'inscription ?".

### P2-2 — Flux Vendre : overlay immersif iOS vs navigation tab Android — deux implémentations caméra
- **Sévérité** : P2 (révisée de P1)
- **Plateforme** : both
- **Fichiers** : `app/(tabs)/_layout.tsx:135-159`, `features/sell/components/capture/SellOverlayCapture.tsx` (390 l.), `app/sell/capture.tsx` (355 l.), `components/ui/ImmersiveOverlay/index.tsx:231`, `app/(tabs)/sell.tsx:38-44`
- **Description** : `tabPress` 'Vendre' branche sur `Platform.OS === 'ios'` : iOS lance `immerse(<SellOverlayCapture/>)`, Android navigue vers `app/sell/capture.tsx`. Deux écrans caméra distincts dupliquent state, draft, galerie, `handleCapture`, `MAX_PHOTOS=5`, guides. Divergences déjà présentes : `preferredAssetRepresentationMode` `.Current` (iOS) vs `.Compatible` (Android) ; flux draft-resume asymétrique (Android montre `DraftResumeModal` via `sell.tsx`, iOS recharge silencieusement) ; wording "Quitter ?" différent ; `setTimeout(550)` iOS avant navigation absent sur Android.
- **Impact** : Dette de maintenance permanente (tout fix doit être appliqué deux fois) + micro-dérives déjà constatées. Les deux chemins aboutissent au même `/sell/photos-review` → pas de blocage fonctionnel, d'où P2.
- **Recommandation** : Factoriser un composant caméra d'orchestration unique partagé, ou documenter/tester explicitement la parité à chaque modification.

### P2-3 — L'écran "Utilisateurs bloqués" promet un blocage depuis le profil qui n'existe pas
- **Sévérité** : P2
- **Plateforme** : both
- **Fichiers** : `app/settings/blocked-users.tsx:161`, `app/settings/blocked-users.tsx:146`, `app/user/[id].tsx:282`, `features/user-profile/components/UserActions.tsx`, `features/chat/hooks/useChatModeration.ts:34`
- **Description** : `blocked-users.tsx:160-162` affiche "Vous pouvez bloquer un utilisateur depuis son profil ou depuis une conversation." Or le menu `handleMore` du profil public (`user/[id].tsx:282-293`) ne propose que "Partager le profil" et "Signaler". `UserActions` ne propose que Contacter/S'abonner. Le seul appel à `ModerationService.blockUser()` est dans `useChatModeration.ts:34` (depuis une conversation).
- **Impact** : Un user voulant bloquer un vendeur abusif sans chat suit l'instruction, ouvre le menu "..." du profil, et ne trouve que Signaler. Promesse non tenue sur une action de sûreté.
- **Recommandation** : Ajouter une action "Bloquer" dans `handleMore` de `app/user/[id].tsx`, OU corriger le texte de `blocked-users.tsx` pour ne mentionner que la conversation.

### P2-4 — Photo de profil masquée aux autres par défaut sans indication, mais toggle largement contourné
- **Sévérité** : P2
- **Plateforme** : both
- **Fichiers** : `services/userService.ts:152`, `functions/src/callable/reviews.ts:353`, `app/settings/profile-details.tsx:171`, `app/settings/privacy.tsx:100`, `functions/src/callable/products.ts:318`, `functions/src/triggers/users.ts:55`, `features/article/components/ArticleDetails.tsx:159`, `app/chat/[id].tsx:110`, `app/(tabs)/messages.tsx:260`
- **Description** : Défaut `showProfilePhoto: false` (`userService.ts:152-156`). `getUserPublicProfile` masque via `profileImage: showPhoto === false ? null : ...` (`reviews.ts:353`) — mais seulement si la valeur est **explicitement** `false` (un nouveau user dont les prefs ne sont jamais persistées a `undefined` → non masqué). `profile-details.tsx:171-185` laisse uploader sans mention de visibilité (pire, un encart `:218-224` affirme qu'une photo "attire plus d'acheteurs"). En sens inverse, le toggle est contourné sur les surfaces clés : `sellerImage` dénormalisé sur les annonces (`products.ts:318`, trigger `users.ts:55`) sans consulter `showProfilePhoto`, et le chat retombe sur le snapshot dénormalisé (`chat/[id].tsx:110`, `messages.tsx:260`).
- **Impact** : Le toggle "Afficher ma photo de profil" est partiellement non fonctionnel/trompeur dans les deux sens : photo non garantie masquée (annonces + chat la montrent), et user induit en erreur sur la visibilité.
- **Recommandation** : Indiquer l'état de visibilité dans `profile-details.tsx` ; surtout, aligner `sellerImage` (`products.ts`, trigger) et le fallback chat sur `showProfilePhoto`, sinon le toggle est cosmétique.

### P2-5 — `authStore.signOut` ne réinitialise pas `immersiveOverlayStore` (divergence + doc trompeuse)
- **Sévérité** : P2
- **Plateforme** : both
- **Fichiers** : `store/authStore.ts:190-209`, `store/resetAllStores.ts:13-29`, `store/immersiveOverlayStore.ts:44-53`, `app/(tabs)/profile.tsx:47,72`, `contexts/AuthContext.tsx:42-58`, `app/settings/delete-account.tsx:9,180`
- **Description** : Le logout depuis le profil appelle `authStore.signOut`, qui réinitialise inline `notificationStore`, `chatStore`, `queryClient` (`:200-202`) mais PAS `immersiveOverlayStore` — alors que `resetAllStores` (utilisé par `delete-account.tsx:180`) le réinitialise (`:27`). La doc `resetAllStores.ts:15-16` affirme "authStore.signOut already calls this via dynamic import" : FAUX (reset inline, jamais d'import de `resetAllStores`).
- **Impact** : Si l'overlay immersif (sell flow) est actif au logout, son `isActive`/`contentComponent` survit. Fenêtre temporelle étroite (overlay normalement fermé avant logout) → P2. La doc mensongère induira en erreur la prochaine évolution du logout.
- **Recommandation** : Ajouter `useImmersiveOverlayStore.getState().reset()` dans `signOut` ; corriger le commentaire de `resetAllStores.ts`.

### P2-6 — Adresse Settings : pas de saisie manuelle si Google Places échoue (non bloquant pour la livraison)
- **Sévérité** : P2 (révisée de P1)
- **Plateforme** : both
- **Fichiers** : `app/settings/address.tsx:18`, `app/settings/address.tsx:72-73`, `app/settings/address.tsx:158-173`, `components/ShippingAddressForm.tsx:139-269`, `app/checkout/shipping.tsx:117-128`
- **Description** : `address.tsx` n'expose que `GooglePlacesAutocomplete` (clé `EXPO_PUBLIC_...` avec fallback `''`, `:18`). Si échec, `handleUpdateAddress` return en silence (`:72-73`), aucun champ manuel. MAIS cet écran est l'éditeur d'adresse de **profil**, pas le chemin de livraison : le checkout (`shipping.tsx` + `ShippingAddressForm.tsx:139-269`) expose des `TextInput` manuels éditables. La livraison n'est donc pas bloquée → P2.
- **Recommandation** : Ajouter une saisie manuelle de secours + message d'erreur sur `address.tsx` (réutiliser `ShippingAddressForm`).

### P2-7 — Champs sensibles sans `textContentType` : autofill iOS désactivé
- **Sévérité** : P2
- **Plateforme** : ios
- **Fichiers** : `app/settings/phone.tsx:123-131`, `app/settings/add-password.tsx:104-167`, `app/settings/email.tsx:175-198`, `app/settings/password.tsx:109-155`
- **Description** : Aucun `textContentType` dans les 4 fichiers. `autoComplete` n'apparaît QUE sur le téléphone (`phone.tsx:129` `autoComplete="tel"`, sans `textContentType="telephoneNumber"`). Email : `keyboardType="email-address"` mais ni `textContentType="emailAddress"` ni `autoComplete="email"`. Mots de passe : seulement `secureTextEntry`, jamais `textContentType` (password/newPassword) ni `autoComplete`.
- **Impact** : Sur iOS, pas d'autofill Trousseau ni de génération de mot de passe fort. Android partiellement câblé (téléphone seul).
- **Recommandation** : Ajouter `textContentType` + `autoComplete` cohérents et identiques sur les deux plateformes.

### P2-8 — `delete-account.tsx` sans `KeyboardAvoidingView`
- **Sévérité** : P2
- **Plateforme** : both (cadrage principal Android)
- **Fichiers** : `app/settings/delete-account.tsx:17-24`, `:285-293`, `:309-317`, `:388-395`, `:421-427`
- **Description** : Imports `react-native` sans `KeyboardAvoidingView` (`:17-24`). Contenu dans un simple `ScrollView` (`:421-427`). 3 `TextInput` (mot de passe `:285-293`, mot de passe Apple-on-Android `:309-317`, champ "SUPPRIMER" `:388-395`) + bouton final en bas. Les 7 autres écrans Settings avec saisie utilisent `KeyboardAvoidingView` (ex. `password.tsx:93-94`, `email.tsx:151-152`).
- **Impact** : Le clavier peut recouvrir le champ "SUPPRIMER" et le bouton de validation sur une action sensible. Friction, scroll manuel requis (pas de blocage dur) → P2. Incohérence avec les autres écrans.
- **Recommandation** : Envelopper le `ScrollView` dans `<KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>` (`Platform` déjà importé).

### P2-9 — Toggle push désynchronisé de la permission OS et du token FCM
- **Sévérité** : P2
- **Plateforme** : both
- **Fichiers** : `app/settings/notifications.tsx:131-159`, `hooks/useNotificationSetup.ts:190-212`, `:243`, `app/_layout.tsx:132`, `services/userService.ts:314-327`, `functions/src/utils/notifications.ts:171-178`
- **Description** : `toggleSetting` (`notifications.tsx:131-159`) n'écrit qu'un booléen Firestore (`updateNotificationPreferences`), sans permission OS ni token. `registerPushToken` (`useNotificationSetup.ts:194-204`) demande la permission + enregistre le token au démarrage, inconditionnellement, sans lire la pref push. `unregisterPushToken` existe mais n'est jamais appelé.
- **Impact** : Activer push après refus OS donne un toggle ON sans réception ni re-prompt (réel). En revanche "désactiver continue de recevoir" est FAUX : le backend gate `if (prefs?.push === false) return sentCount:0` (`notifications.ts:172-178`) → la livraison push est stoppée serveur ; le token orphelin n'est qu'un détail d'hygiène.
- **Recommandation** : Réconcilier le toggle ON avec `getPermissionsAsync` et re-prompt/registerPushToken à l'activation. (`hooks/useFcmToken.ts`, qui utilise déjà la bonne API, est du code mort à réutiliser.)

### P2-10 — Incohérence de marque « Second » vs « Seconde » dans le corpus légal
- **Sévérité** : P2
- **Plateforme** : both
- **Fichiers** : `components/legal/TermsContent.tsx`, `components/legal/PrivacyPolicyContent.tsx`, `app/settings/privacy.tsx`, `app/settings/legal-notice.tsx`, `app/settings/about.tsx`, `components/auth-bottom-sheet/SocialConsentForm.tsx`
- **Description** : « Second » (sans e) coexiste avec « Seconde » : `TermsContent.tsx:53`, `PrivacyPolicyContent.tsx:57` et `:161`, `privacy.tsx:79`, `SocialConsentForm.tsx:66` (écran de consentement). En face, « Seconde » domine (`about.tsx`, `legal-notice.tsx:35` « Seconde Inc. »). **Nuance** : la raison sociale reste identifiable (« Seconde SAS » dans Terms, « Seconde Inc. » ailleurs) — l'ambiguïté porte sur le nom de marque, pas le responsable de traitement. **Incohérence plus grave non corrigée** : `TermsContent.tsx:172-177` soumet les CGU au « droit français / tribunaux français » avec une « Seconde SAS », alors que la marketplace est canadienne (Montréal, Loi 25, tribunaux de Montréal dans `legal-notice`/`PrivacyPolicy`).
- **Impact** : Flou de marque dans des documents engageant le consentement ; surtout, divergence d'entité juridique ET de droit applicable entre Terms (France/SAS) et le reste (Québec/Inc.).
- **Recommandation** : Harmoniser sur « Seconde Inc. » / « Seconde » dans tout le corpus, et aligner le droit applicable des CGU sur le Québec.

### P2-11 — Formulaire d'inscription dans un `BottomSheetView` non scrollable à hauteur fixe (82%)
- **Sévérité** : P2
- **Plateforme** : both
- **Fichiers** : `components/AuthBottomSheet.tsx:61`, `:388-408`, `components/auth-bottom-sheet/SignUpForm.tsx:115-241`, `components/auth-bottom-sheet/ConsentFields.tsx:58-142`, `components/auth-bottom-sheet/styles.ts:16-20`
- **Description** : `snapPoints = ['82%']` (`:61`), `enableDynamicSizing={false}`, contenu dans `BottomSheetView` (non scrollable, `:403`). `SignUpForm` est le plus haut : titre + Apple (iOS) + Google + divider + toggle + 3 inputs + `ConsentFields` (DOB 3 champs + 3 checkbox) + bouton. Clavier ouvert (`keyboardBehavior="interactive"` iOS / `android_keyboardInputMode="adjustResize"`), la hauteur visible se réduit fortement. Le bouton est `disabled` tant que Terms+Privacy non cochés (`SignUpForm.tsx:106-113`) → il FAUT atteindre les checkboxes en bas ET le bouton.
- **Impact** : Sur petits écrans (ex. iPhone SE), les checkboxes obligatoires et/ou le bouton peuvent être coupés par le clavier, sans scroll de rattrapage → inscription potentiellement bloquante.
- **Recommandation** : Remplacer `BottomSheetView` par `BottomSheetScrollView` (gorhom v5.2.14 l'expose) pour garantir l'accès clavier ouvert, identiquement iOS/Android.

### P2-12 — Bouton retour matériel Android non géré pour le `AuthBottomSheet`
- **Sévérité** : P2
- **Plateforme** : android
- **Fichiers** : `components/AuthBottomSheet.tsx:13`, `:78-84`, `:105-115`, `:387-408`, `app/_layout.tsx:233`
- **Description** : `AuthBottomSheet` utilise le `BottomSheet` simple (pas `BottomSheetModal`), piloté par store (`isVisible`, `:78-84`), monté globalement (`_layout.tsx:233`). Aucun `BackHandler` dans tout le code (grep = 0). Vérifié : gorhom v5.2.14 `BottomSheet` n'intercepte pas le back Android. Le rollback Loi 25 est attaché à `onClose`/`handleClose` (`:105-115`), qui ne se déclenche pas sur back matériel.
- **Impact** : Sur Android, presser le retour matériel avec le sheet d'auth ouvert peut naviguer en arrière sans fermer le sheet (état incohérent) et, en mode `socialConsent`, contourner le rollback du compte social non consenti.
- **Recommandation** : Ajouter un `BackHandler` (Android) dans `AuthBottomSheet` qui, quand `isVisible`, appelle `handleClose()` et consomme l'événement.

### P2-13 — StatusBar globale `style='dark'` jamais surchargée sur les écrans caméra sombres
- **Sévérité** : P2
- **Plateforme** : android
- **Fichiers** : `app/_layout.tsx:231`, `app/sell/capture.tsx:246-303,305-309`, `features/sell/components/capture/SellOverlayCapture.tsx:343-347`, `app/(tabs)/_layout.tsx:139-158`, `app/(tabs)/sell.tsx:43`, `app/swap-zone.tsx:508,519,537`
- **Description** : StatusBar figée `style="dark"` au niveau racine (`_layout.tsx:231`). L'écran caméra Android (`capture.tsx`, fond `#0F0E0C`) ne rend aucune `StatusBar` locale (grep = 0). Sur Android, `style='dark'` = icônes/heure système en noir → invisibles sur fond noir. Le chemin iOS (`SellOverlayCapture`, fond `colors.deep`) est aussi sombre sans StatusBar locale. Contre-exemple : `swap-zone.tsx:508,519,537` pose bien `<StatusBar style="light" />`.
- **Impact** : Sur Android, heure/batterie/réseau illisibles sur l'écran caméra du parcours vendeur. Cosmétique (atténué iOS par BlurView).
- **Recommandation** : Ajouter `<StatusBar style="light" />` dans `app/sell/capture.tsx` ET `SellOverlayCapture.tsx`, comme `swap-zone.tsx`.

### P2-14 — `delete-account.tsx` sans `KeyboardAvoidingView` (variante cross-plateforme Android)
- **Sévérité** : P2
- **Plateforme** : android
- **Fichiers** : `app/settings/delete-account.tsx:17-24`, `:282-396`, `app/settings/email.tsx:151`
- **Description** : Doublon thématique de P2-8 vu sous l'angle parité cross-plateforme : `delete-account.tsx` est le seul écran Settings avec `TextInput` sans `KeyboardAvoidingView` (`behavior 'height'` attendu sur Android). Sur Android, le clavier peut masquer le champ "SUPPRIMER" et le bouton.
- **Recommandation** : Idem P2-8.

### P3 — Findings de moindre sévérité (cosmétique, dette, latent)

| ID | Titre | Plateforme | Fichiers (file:line) | Reco |
|----|-------|------------|----------------------|------|
| P3-1 | `SexOption` utilise `withSpring` (rebond) — viole la règle anti-spring | both | `features/onboarding/components/SexOption.tsx:8-12,31-37` ; `SizeChip.tsx:32-38` ; `constants/theme.ts:351-358` | Remplacer par `withTiming` + `Easing.out(Easing.cubic)`, sur le modèle de `SizeChip` |
| P3-2 | Doc `guest_preferences` orphelin (jamais relié au compte, commentaire "keyed by guestId" faux, champ `userId` mort) | backend | `functions/src/callable/onboarding.ts:29,36,85-90` ; `services/authMergeService.ts:31-41` ; `retentionPurge.ts:107-117` | Écrire avec ID = guestId OU supprimer la création du doc ; retirer `userId` du payload |
| P3-3 | Sexe enregistré à `'femme'` par défaut quand seules des tailles sont choisies | both | `app/onboarding.tsx:90,144-149,359` ; `functions/src/callable/onboarding.ts:14,39-44` | Rendre `sex` optionnel côté callable (envoyer `null`) OU obligatoire pour activer VALIDER |
| P3-4 | Clé AsyncStorage `'@onboarding_preferences'` codée en dur au lieu de la constante | both | `app/onboarding.tsx:152` ; `constants/storageKeys.ts:7` ; `services/authMergeService.ts:5,31` | Importer/utiliser `ONBOARDING_PREFERENCES_KEY` |
| P3-5 | Écart de couleur safe-area (`background`) vs contenu welcome (`cream`) | both | `features/onboarding/styles.ts:10-13,16-21,62-64` ; `constants/theme.ts:28,76` | Appliquer `colors.cream` au safeArea du welcome OU uniformiser tout sur `background` |
| P3-6 | Bouton retour matériel Android non géré sur le formulaire d'onboarding (état local `showWelcome`) | android | `app/onboarding.tsx:70,229-235` ; `app/_layout.tsx:199-202` ; `app/index.tsx:28` | `useFocusEffect` + `BackHandler` quand `showWelcome===false` pour repasser à `true` et consommer l'événement |
| P3-7 | Modèle de tailles incohérent onboarding (`sizes`=top+bottom, `shoesSizes` séparé) vs préférences (préfixe `shoe_` dans la liste plate) | both | `functions/src/callable/onboarding.ts:67,72-75` ; `app/settings/preferences.tsx:59,66-72,193-215` ; `services/userService.ts:107-128` ; `usePersonalizedFeed.ts:60-69` | Unifier le contrat `preferences.sizes`/`shoesSizes` entre callable et écran préférences ; `shoesSizes` est hors-type et jamais lu |
| P3-8 | Bouton Apple masqué sur Android sans aucun message | android | `components/auth-bottom-sheet/SignInForm.tsx:60-71` ; `SignUpForm.tsx:122-133` | Note discrète sous les boutons sociaux sur Android (révisé P3 : Google reste dispo, standard du marché) |
| P3-9 | Apple Sign-In appelé sans garde `AppleAuthentication.isAvailableAsync()` | ios | `services/authService.ts:396-414,479-484,715-738` ; `SignInForm.tsx:60-71` ; `SignUpForm.tsx:122` | Conditionner l'affichage du bouton à un état alimenté par `isAvailableAsync()` (3 call sites concernés) |
| P3-10 | Deux implémentations divergentes de `useAuthRequired` coexistent et sont consommées | both | `hooks/useAuthRequired.ts:13-42` ; `contexts/AuthRequiredContext.tsx:25-35` ; `components/SaveSearchButton.tsx:17` | Faire du shim un re-export du hook, OU migrer `SaveSearchButton` vers `@/hooks/useAuthRequired` |
| P3-11 | `USER_DATA_KEY` persisté à chaque hydratation mais jamais relu (état mort) | both | `store/authStore.ts:20,151,182,227,136,169,204` | Exploiter comme fallback offline (résout P1-5) OU supprimer ces écritures |
| P3-12 | City et styleTags visibles sur son propre profil mais absents du profil public d'autrui | both | `features/user-profile/components/ProfileHeader.tsx:50,92` ; `functions/src/callable/reviews.ts:354` ; `app/user/[id].tsx:145` | Publier `address.city`/`styleProfile` dans `getUserPublicProfile`, OU retirer ces branches du ProfileHeader public |
| P3-13 | Compteur d'abonnés périmé sur le profil propre (lu depuis authStore figé, non rafraîchi au follow/unfollow) | both | `app/(tabs)/profile.tsx:208` ; `services/userStatsService.ts:13-21` ; `useSellerLikes.ts:102-111` ; `functions/src/callable/home.ts:354-368` ; `store/authStore.ts:220-232` | Lire `followersCount` via une query React Query dédiée (étendre `getUserStats`) ; obsolescence cross-utilisateur/appareil auto-réparée à `refreshUser` |
| P3-14 | Solde wallet affiché sans devise explicite dans `delete-account` (contexte destructif) | both | `app/settings/delete-account.tsx:140,158` ; `utils/formatPrice.ts:6-23` ; `app/wallet.tsx:85-89` | Choix de cohérence GLOBALE : `formatPriceWithCurrency` est du code mort, et `wallet.tsx` omet "$ CA" — aligner tous les écrans financiers ; traiter les 2 occurrences (:140 ET :158) |
| P3-15 | Export : aucune protection anti-double-tap (déjà gérée) ni nettoyage du fichier exporté | both | `app/settings/export-data.tsx:46-91,54-65` ; `components/ui/Button.tsx:164,193` | Le bouton est déjà `disabled` pendant `loading` (claim anti-double-tap faux). Vrai problème : `deleteAsync` dans un `finally` après partage (fichier en clair accumulé dans `documentDirectory`) |
| P3-16 | Fallback d'export sans partage : Alert "Export réussi" affichant un chemin sandbox inutilisable | both | `app/settings/export-data.tsx:68-81` | En l'absence de partage, proposer une vraie alternative (presse-papier, ré-essai) au lieu d'un chemin `file:///.../Documents/...` ; edge case rarissime |
| P3-17 | Incohérence de schéma `userImage` (branche array) vs `profileImage` (branche map) dans trigger + anonymisation | backend | `functions/src/triggers/users.ts:95,107` ; `functions/src/callable/users.ts:137,142` ; `types/index.ts:303` ; `services/chatService.ts:236,259` ; `messages.tsx:261` ; `chat/[id].tsx:110` | Uniformiser sur `userImage` dans les deux branches ; supprimer la branche map morte (format array uniquement, fallback UI neutralise l'impact) |
| P3-18 | Liste "Utilisateurs bloqués" : nom figé jamais re-propagé si le bloqué change de displayName | both | `services/moderationService.ts:172` ; `app/settings/blocked-users.tsx:90` ; `functions/src/triggers/users.ts:28` | Résoudre le nom live via `getUserPublicProfile` à l'affichage (le blocage reste lié au `userId`, immuable) |

> Articles fantômes (favoris d'autrui) — finding "Cohérence des données" classé P2 :

### P2-15 — Articles soft-deleted d'un compte supprimé restent dans les favoris des autres
- **Sévérité** : P2
- **Plateforme** : both
- **Fichiers** : `functions/src/callable/users.ts:95` ; `services/favoritesService.ts:124,141` ; `services/articlesService.ts:315` ; `app/(tabs)/favorites.tsx:134` ; `app/article/[id].tsx:75`
- **Description** : À la suppression de compte, les articles sont soft-deleted (`isActive:false`, `sellerName:'Utilisateur supprime'`, `sellerId:'deleted_...'`, `users.ts:95-106`) — le doc EXISTE toujours. Seule la collection `favorites/{uid}` du compte supprimé est nettoyée (`users.ts:122-125`), pas celles des autres. `getUserFavoriteArticlesPaginated` inclut tout doc dès que `d.exists()` (`favoritesService.ts:127-138`), sans filtrer `isActive`. La détection d'orphelins ne retire QUE les docs inexistants (`:142-143`) → un soft-deleted n'est jamais nettoyé. `favorites.tsx` ne re-filtre pas. Asymétrie : `getArticleById` filtre bien `!isActive→null` (`articlesService.ts:324`).
- **Impact** : Article fantôme (vendeur "Utilisateur supprime") visible comme actif dans les favoris d'autrui ; au tap → "article introuvable". Jamais auto-nettoyé.
- **Recommandation** : Filtrer `isActive===true` dans `getUserFavoriteArticlesPaginated` ET compter les inactifs comme orphelins à retirer de `articleIds` (OU hard-delete les articles à la suppression de compte).

---

## Matrice cross-plateforme

| Zone | iOS | Android | Écart constaté |
|------|-----|---------|----------------|
| Connexion Apple | Bouton visible, flux complet | Bouton absent, aucun message, re-auth impossible (`authService.ts:716-718`) | **P1** — compte Apple-only verrouillé sur Android, aucune récupération |
| Onboarding (retour) | `gestureEnabled:false`, racine de pile → pas de geste retour | Back matériel non géré → ferme l'app depuis le formulaire | **P3** — divergence retour, perte de sélections (Android) |
| AuthBottomSheet (retour) | Pas de bouton matériel | Back matériel non intercepté → contourne `handleClose`/rollback Loi 25 | **P2** — état incohérent + rollback social contournable (Android) |
| Flux Vendre (capture) | Overlay immersif `SellOverlayCapture` (warp/gradient), `.Current`, recharge draft silencieuse | Navigation tab `sell/capture.tsx`, `.Compatible`, `DraftResumeModal` | **P2** — 2 implémentations, micro-dérives (format photo, copy, draft) |
| StatusBar écran caméra | `style='dark'` atténué par BlurView | `style='dark'` → icônes système noires sur fond `#0F0E0C` illisibles | **P2** — lisibilité (Android) |
| Autofill champs sensibles | Pas de `textContentType` → ni autofill ni mdp fort Trousseau | `autoComplete="tel"` (téléphone seul), email/mdp non câblés | **P2** — autofill iOS désactivé, Android partiel |
| `delete-account` clavier | Pas de `KeyboardAvoidingView` (pas de 'padding') | Pas de `KeyboardAvoidingView` ('height' attendu) → champ/bouton masqués | **P2** — clavier recouvre (les 2, cadré Android) |
| Bottom sheet clavier (inscription) | `keyboardBehavior="interactive"`, hauteur fixe, pas de scroll | `adjustResize`, hauteur fixe, pas de scroll | **P2** — checkboxes/bouton coupés sur petits écrans (les 2) |
| Cold start hors-ligne | Auth restaurée, Firestore sans cache → invité | Identique | **P1** — déconnexion fantôme (les 2) |
| Suppression de compte (garde-fous) | UI bloque, serveur ne vérifie que wallet | Identique | **P0/P1** — bypass callable (les 2) |
| Export Loi 25 (messages) | `myMessages: []` | Identique | **P1** — non-conformité portabilité (les 2) |

---

## Plan d'action priorisé

### P0 — à traiter immédiatement
- [ ] **P0-1** `deleteUserAccount` (`functions/src/callable/users.ts`) : avant tout cleanup, re-vérifier serveur `heldBalance>0`, `sellerDebt>0`, et requête `transactions` actives (`buyerId==uid OR sellerId==uid`, `status in [activeStatuses]`) → `failed-precondition`.

### P1 — bugs & écarts critiques
- [ ] **P1-3** Ajouter `username` au payload `getUserPublicProfile` + type + mapping `app/user/[id].tsx` (identité publique).
- [ ] **P1-7** Corriger la query d'export messages → collection top-level `messages` (`chatId` + `senderId` + `participants array-contains uid`).
- [ ] **P1-2 / P1-6** Apple-only sur Android : message guidant + lier email/mdp à la création Apple + flux de récupération.
- [ ] **P1-4** Settings : état réactif `hasPassword`/`provider` OU `refreshUser` + `useFocusEffect` après `add-password`.
- [ ] **P1-1** Onboarding : `await` la callable si user connecté + toast/retry (et corriger le commentaire).
- [ ] **P1-5** Activer `persistentLocalCache` Firestore + fallback `USER_DATA_KEY` (exiger `dateOfBirth`).
- [ ] **P1-8** (= P0-1 angle data) couvert par le fix serveur de P0-1.

### P2 — UX, sûreté, cohérence
- [ ] **P2-1** `socialConsent` : désactiver `enablePanDownToClose` + `pressBehavior='none'` (ou Alert de confirmation).
- [ ] **P2-3** Action "Bloquer" dans `handleMore` du profil, OU corriger le texte `blocked-users.tsx`.
- [ ] **P2-4** Aligner `sellerImage` (annonces) + fallback chat sur `showProfilePhoto` ; indiquer la visibilité dans `profile-details`.
- [ ] **P2-15** Filtrer `isActive` + retirer les inactifs de `articleIds` dans les favoris.
- [ ] **P2-5** `signOut` : reset `immersiveOverlayStore` + corriger la doc `resetAllStores`.
- [ ] **P2-8 / P2-14** Envelopper `delete-account` dans `KeyboardAvoidingView`.
- [ ] **P2-11** `BottomSheetScrollView` pour le formulaire d'inscription.
- [ ] **P2-12** `BackHandler` Android dans `AuthBottomSheet` → `handleClose`.
- [ ] **P2-13** `<StatusBar style="light" />` sur les écrans caméra.
- [ ] **P2-7** `textContentType` + `autoComplete` cohérents sur tous les champs sensibles.
- [ ] **P2-9** Réconcilier le toggle push ON avec `getPermissionsAsync` + re-prompt.
- [ ] **P2-6** Saisie manuelle de secours + message d'erreur sur `address.tsx`.
- [ ] **P2-2** Factoriser le composant caméra unique (dette de duplication).
- [ ] **P2-10** Harmoniser « Seconde » + aligner le droit applicable des CGU sur le Québec.

### P3 — cosmétique, dette, latent
- [ ] **P3-1** `SexOption` → `withTiming` (anti-spring).
- [ ] **P3-3** `sex` optionnel ou obligatoire (supprimer le défaut implicite 'femme').
- [ ] **P3-6** `BackHandler` sur le formulaire d'onboarding.
- [ ] **P3-7** Unifier le contrat tailles/pointures onboarding↔préférences (fix réel du feed perso).
- [ ] **P3-12** Décider public/privé pour city/styleTags du profil.
- [ ] **P3-15 / P3-16** `deleteAsync` du fichier d'export + alternative au chemin sandbox.
- [ ] **P3-2, P3-4, P3-8, P3-9, P3-10, P3-11, P3-13, P3-14, P3-17, P3-18** Hygiène/dette : doc orphelin, constante de clé, garde `isAvailableAsync`, dédup `useAuthRequired`, état mort `USER_DATA_KEY`, compteur abonnés, devise wallet, schéma `userImage`/`profileImage`, nom figé bloqués.
- [ ] **P3-5** Uniformiser la couleur safe-area de l'onboarding.

---

## Annexe — faux positifs écartés

### FP-1 — « Permission caméra non déclarée (plugin expo-camera absent) — caméra cassée Android + rejet App Store iOS »
**Écarté** : prémisse fausse (workflow managed supposé). Le projet est en workflow **bare/prebuilt** : `ios/` et `android/` sont commités et compilés tels quels par EAS (pas de prebuild au build). Les permissions sont déjà présentes : `ios/Seconde/Info.plist:57-58` (`NSCameraUsageDescription`) et `android/app/src/main/AndroidManifest.xml:4` (`android.permission.CAMERA`). Les affirmations sur `app.config.js` (plugin/permissions absents) sont littéralement vraies mais non pertinentes puisque cette config ne pilote pas les manifests buildés. Reste un vrai risque mineur (P3 hygiène) : désync `app.config.js` ↔ natif committé si `expo prebuild --clean` est relancé. La sévérité P0 et l'impact "caméra cassée / rejet App Store" sont incorrects.

### FP-2 — « `preferredAssetRepresentationMode` divergent iOS (.Current) vs Android (.Compatible) — format de photo incohérent »
**Écarté** : les 3 citations sont exactes (`SellOverlayCapture.tsx:176-177` `.Current`, `capture.tsx:149-150` et `profile-details.tsx:64-65` `.Compatible`), mais l'impact est faux. Aucune photo n'est persistée dans son format brut : toutes les voies d'upload ré-encodent en JPEG inconditionnellement avant Storage (`utils/imageUtils.ts:19-23` `ImageManipulator … format: JPEG` ; voie AI `aiService.ts:133-146` HEIC→JPEG). Que l'utilisateur soit iOS ou Android, la photo finit toujours JPEG en Storage → aucune incohérence observable côté backend/acheteurs. La différence `.Current`/`.Compatible` n'entraîne au pire qu'un transcodage redondant côté client iOS. Reco "uniformiser sur `.Compatible`" reste un nettoyage P3, mais la sévérité P1 et l'impact décrit sont inexacts.
