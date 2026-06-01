<!-- Genere par workflow audit-auth-onboarding (wf_d18ba862-cda) le 2026-06-01 — 53 agents, 9 dimensions, 43 findings bruts -> 34 confirmes -->

# Audit Auth + Onboarding — Second

> Synthese finale. Findings deja verifies dans le code reel par des verificateurs adversariaux. Dedup applique sur les findings cross-dimension (notamment l'orphelin `usernames/` a la suppression de compte, present en `backend-auth` et `cross-cutting-logic`).

## Verdict global : `significant-issues`

Le flow Auth + onboarding est **bien architecture et fonctionne sur le chemin nominal**, mais il comporte **un trou de securite critique (P0) sur les gates financiers** et **plusieurs trous fonctionnels reels (P1)** atteignables en usage normal.

Ce qui tient solidement :
- Source de verite unique (Zustand hydrate une seule fois dans `app/_layout.tsx` via `useAuthListener`).
- Gate de consentement Loi 25 robuste (`hydrateFromFirebase` refuse tout user sans `dateOfBirth`).
- Pas de blocage permanent en loading (toutes les branches de `hydrateFromFirebase` resolvent `isLoading=false`).
- `@username` persistant/immuable correct (derive a la creation, unicite par `runTransaction`).
- Anti-priv-escalation `isAdmin/role/customClaims` correctement bloque (create + update).

Ce qui casse le verdict :
- **P0** : la rule `update users/` ne verrouille **aucun** champ Stripe -> un vendeur peut rediriger son payout reel vers le compte Stripe d'un tiers.
- **P1** : self-attribution de champs sensibles a la creation, impasse sur collision email social, vente bloquee sur un email jamais envoye, user fantome conserve au foreground, `usernames/` jamais libere a la suppression.

Le coeur de l'auth (login email, social+consentement, hydration, signOut) n'est pas casse, mais le P0 financier et les P1 d'impasse utilisateur doivent etre corriges **avant toute confiance en prod**.

---

## Flows qui FONCTIONNENT correctement

- **Hydration auth** : `GlobalListeners` monte `useAuthListener()` exactement une fois (`useEffect` deps `[]`), pas de double-subscribe, cleanup correct (`unsubscribe` + `appStateSub.remove`). Aucun second consumer de `onAuthStateChanged` (verifie par grep).
- **Gate splash/loading** : `hydrateFromFirebase` resout TOUJOURS `isLoading=false` (branches truthy avec/sans `dateOfBirth`, `null`, catch global). `getCurrentUser()`/`getUserData()` ont leur propre try/catch retournant `null`.
- **Source de verite** : persistance Firebase (token) + re-fetch Firestore via `getCurrentUser()` a chaque hydrate. `AsyncStorage` ne decide jamais l'auth ; un guest/stale n'est jamais affiche comme authentifie.
- **Gate Loi 25** : `store/authStore.ts:134-141` -> `!fresh.dateOfBirth` => `user=null` + session invite conservee.
- **Auth social avec consentement** : `computeConsentState` calcule `needsConsent` AVANT toute entree dans l'app ; `SocialConsentForm` obligatoire ; `rollbackSocialSignIn` supprime le brand-new ou `signOut` l'existant sur back-out.
- **signOut** : nettoyage complet (pushToken/FCM, stores notification/chat, `queryClient.clear()`, `AuthService.signOut()`, `removeItem`) puis reset a `initialState` avec `isLoading=false`.
- **`@username` persistant** : derive a la creation, immuable (rules interdisent create+update), unicite par `runTransaction` sur `usernames/{candidate}`.
- **Propagation displayName/profileImage** : trigger `onUserProfileUpdated` vers articles/chats/avis/swapPartyItems ; `username` NON re-derive.
- **Anti-priv-escalation** : rules + `userService.updateUserProfile` strippent `isAdmin/role/customClaims` ; `getUserPublicProfile` n'expose que des champs publics.
- **Locale Canada** : `phone.tsx` valide 10 chiffres + `+1` ; `address.tsx` restreint Google Places a `country:ca`.
- **Re-auth operations sensibles** : `email/delete-account/password` routent par provider via `getAuthProvider()`.
- **Reprise d'action post-login** : `requireAuth/authSheetStore.show(message, onSuccess)` reprend l'action pour liker/acheter/offre/swap/signaler/sauvegarder-recherche.
- **Conformite Cloud Functions** : callables auditees v2, `northamerica-northeast1`, memory 512MiB.

---

## P0 — Bloquant / securite

### 1. La rule `update users/` ne verrouille AUCUN champ Stripe — bypass des gates financiers + redirection de payout
**`firestore.rules:163-166`**

La liste protegee (`hasAny`) n'inclut PAS `stripeAccountId` / `stripeChargesEnabled` / `stripePayoutsEnabled` / `stripeAccountStatus` / `stripeBankAccountAdded`. Un client authentifie peut donc :
```js
updateDoc(users/{monUid}, { stripeChargesEnabled:true, stripePayoutsEnabled:true, stripeAccountId:'acct_AUTRE' })
```
et la rule l'accepte. Or ces champs sont les **seuls** gates financiers, lus **directement** depuis le doc client-writable par `walletWithdraw` (`functions/src/callable/wallet.ts:293-310`), `createTransaction` (`payments.ts:695-707`) et `swaps.ts:599-609`, **sans revalidation Stripe au moment du retrait**. `walletWithdraw` envoie ensuite un transfer + payout REELS vers `destination=stripeAccountId` (`wallet.ts:398` et `426`, `{ stripeAccount: stripeAccountId }`).

**Vecteur P0** : un vendeur avec un solde retirable legitime peut **rediriger son payout vers le compte Stripe d'un tiers** en reecrivant `stripeAccountId`, et bypasser la verif d'activation en forcant les booleens. Atteignable trivialement via SDK Firestore. Effet de bord aggravant : ecraser son `stripeAccountId` casse le matching webhook `account.updated` (`webhooks.ts:1708`).

**Fix** : ajouter `stripeAccountId, stripeChargesEnabled, stripePayoutsEnabled, stripeAccountStatus, stripeDetailsSubmitted, stripeBankAccountAdded, stripeBankAccountLast4` a la liste `hasAny()` de la rule update (`firestore.rules:166`). En defense-en-profondeur, revalider cote `walletWithdraw` que `stripeAccountId` appartient bien au vendeur avant transfer/payout. Deleguer a `firebase-backend`, puis `npm run test:security`.

---

## P1 — Bugs fonctionnels / etats impossibles atteignables

### 1. La rule `create users/` autorise l'auto-attribution de `stripe*`/`accountType`/`isVerified`/`rating` des la creation
**`firestore.rules:153-175`** — securite

`isValidUserData` ne valide QUE `email`+`displayName`, et le `hasAny` du create n'interdit que `isAdmin/role/customClaims/username`. Un client peut creer son doc avec `stripeChargesEnabled:true`, `stripeAccountId:'acct_...'`, `accountType:'seller'`, `isVerified:true`, `rating:5`, `reviewCount:999`, `sellerLikesCount:999`. Impact : forgerie de signaux de confiance (servis par `getUserPublicProfile`, affiches `app/user/[id].tsx:156`, FeaturedSellers, SellerCard) + bypass du seller-active gate (`payments.ts:702`) pour vendre sans KYC Stripe. Le vol direct de fonds n'est pas proprement atteignable (Stripe = autorite finale, solde credite uniquement par des ventes serveur) -> **P1**, pas P0.

**Fix** : appliquer a la rule create le meme set de cles protegees que l'update, ou whitelister les cles autorisees a la creation. Aligner avec le P0.

### 2. Collision d'email social (`account-exists-with-different-credential`) non geree — impasse utilisateur
**`services/authService.ts:376-389`** — missing-handling

`signInWithCredential` leve `auth/account-exists-with-different-credential` quand le meme email existe deja avec un autre provider (sous le mode « one account per email » par defaut de Firebase). Aucun catch (Google `l.376`, Apple `l.479`) ni aucun code du repo (grep `account-exists-with-different-credential` / `fetchSignInMethodsForEmail` = 0) ne le detecte. L'utilisateur recoit `Erreur lors de la connexion Google/Apple. Veuillez reessayer.` et reste en impasse.

**Fix** : detecter ce code dans les catch, appeler `fetchSignInMethodsForEmail(email)`, afficher un message FR explicite (« Ce compte existe deja avec un mot de passe — connectez-vous par email ») voire proposer `linkWithCredential` apres reconnexion. Deleguer a `rn-expo-dev`.

### 3. Vente gatee sur `email_verified` cote serveur, mais aucun email n'est jamais envoye ni demande en amont — vendeur bloque sans recours decouvrable
**`functions/src/callable/products.ts:205-212`** — logic

`createArticle` est le SEUL gate `email_verified`. Or l'inscription email (`AuthBottomSheet.tsx:251` -> `signUpWithEmail`) **n'envoie jamais** d'email de verification, et le seul moyen d'en declencher un est le bouton manuel de `verify-email.tsx`, accessible uniquement via un `SettingItem` cache derriere `hasPassword && !isEmailVerified` (`settings/index.tsx:103`). Un nouveau vendeur remplit tout le formulaire de vente (capture, IA, upload images Storage) et se prend un refus generique a la fin (`preview.tsx:206-214`). Nuance : le gate lit le claim JWT `email_verified` qui ne se rafraichit qu'au prochain refresh (~1h) -> un vendeur fraichement verifie peut encore etre refuse.

**Fix** : (1) `sendEmailVerification` a l'inscription dans `signUpWithEmail` ; (2) pre-check `AuthService.isEmailVerified()` a l'entree du flow vente (`app/(tabs)/sell.tsx`) avec redirection vers `/settings/verify-email` ; (3) `getIdToken(true)` apres verification ; (4) bouton « Verifier mon email » dans l'Alert d'echec de `preview.tsx`. Deleguer a `rn-expo-dev` (+ `firebase-backend` pour le gate).

### 4. `currentUser.reload()` au foreground avale l'erreur token revoque / compte supprime / disabled — user fantome conserve
**`hooks/useAuthListener.ts:44-52`** — missing-handling

Avec le Web SDK, `onAuthStateChanged` ne se redeclenche PAS sur revocation/suppression/desactivation serveur ; `reload()` est le seul detecteur foreground, et il **throw** alors (`auth/user-token-expired`, `auth/user-disabled`, `auth/user-not-found`). Le catch ne fait que logger en `__DEV__` : aucun `signOut`, aucun nettoyage. `authStore.user` reste peuple => user fantome (acces aux ecrans authentifies, ecritures qui echoueront en `permission-denied`) jusqu'au prochain refresh de token. Pas une faille (serveur autoritaire), mais bug fonctionnel/UX reel et atteignable (suppression depuis un autre appareil).

**Fix** : dans le catch, detecter `error.code in ['auth/user-token-expired','auth/user-disabled','auth/user-not-found']` et declencher un `signOut` propre (`useAuthStore.getState().signOut()` ou `hydrateFromFirebase(null)`). Deleguer a `rn-expo-dev`.

### 5. La suppression de compte ne libere jamais `usernames/{username}` — handle reserve a vie *(dedup: backend-auth + cross-cutting-logic)*
**`functions/src/callable/users.ts:87-92`** — data-integrity

`assignUsername` reserve `usernames/{username} = { uid }` de maniere permanente et immuable (`username.ts:181-190`). `deleteUserAccount` supprime `users/{uid}` et 15+ collections liees mais **jamais** `usernames/{username}` (verifie en direct lignes 55-154 : zero reference a `usernames`). Apres suppression : reference orpheline vers un uid inexistant ; handle non re-attribuable (`assignUsername` voit `.exists` et bascule sur `.2`). Fuite progressive de l'espace de noms + impossibilite de reprendre son `@pseudo`. La suppression elle-meme reussit -> **P1** (pas P0).

**Fix** : dans `deleteUserAccount`, apres avoir charge `userData` (deja dispo `l.73`), si `userData.username` existe : `bulkWriter.delete(db.collection('usernames').doc(userData.username))` en verifiant `.exists && .uid === uid`. Attention au cas `userDoc.exists=false` (early return `l.59-71`). Deleguer a `firebase-backend`. *(Meme correctif a etendre au rollback de `signUpWithEmail`, cf. P2.)*

---

## P2+ — Edge cases / incoherences UX / dette

### P2
- **Bouton submit actif malgre erreur de validation client** — `components/auth-bottom-sheet/SignInForm.tsx:47-51` (+ `SignUpForm.tsx:106-113`). `submitDisabled` ignore `emailInvalid/passwordInvalid`. Fix trivial : les ajouter.
- **`show()` sur sheet deja ouverte ne reset pas le formulaire/mode** — `components/AuthBottomSheet.tsx:78-84`. `resetForm()` seulement a la fermeture ; le nouveau `onSuccess` s'attache au mauvais ecran. Edge case.
- **Gating onboarding device-scoped (AsyncStorage) ignore `onboardingCompleted` Firestore** — `app/index.tsx:13-31`. Reinstall/clear-data/switch de compte re-soumettent l'onboarding. Pas de perte de donnees (feed perso lit `user.preferences` serveur).
- **Prefs d'onboarding guest ne personnalisent jamais le feed** — `hooks/usePersonalizedFeed.ts:39-73`. `null` si `!user` ; prefs guest inertes jusqu'au merge post-login.
- **`onboardingCompleted` client peut diverger du serveur (fire-and-forget)** — `app/onboarding.tsx:139-165`. Le commentaire dit « blocking for logged-in user » mais le code n'attend jamais. Fix : `await` pour user authentifie.
- **Compte Apple-only injoignable sur Android** — `SignInForm.tsx:60-71` (+ `SignUpForm.tsx:122`). Bouton Apple `Platform.OS==='ios'`, pas de fallback ni message. Sous-ensemble etroit.
- **`add-password` accepte un email arbitraire ecrit puis reverti** — `services/authService.ts:867-877`. `linkWithCredential` ne change pas l'email primaire Auth ; `hydrateFromFirebase` (`authStore.ts:144-149`) reverte ensuite Firestore vers l'email social. Fix : champ email read-only.
- **`mergeGuestToUser` rejoue les prefs invite a CHAQUE connexion sociale** — `store/authStore.ts:248-266`. Ecrase les prefs existantes (taille/sexe) + reset `onboardingCompleted`. Fix : ne rejouer qu'a `result.isNewUser`.
- **`wallet.tsx` sans guard guest** — `app/wallet.tsx:177-466`. Deep-link `/wallet` en guest -> `activateWallet` leve `unauthenticated` en Alert brute. Fix : branche `if(!user)` alignee sur `my-orders.tsx:175`.
- **`checkout/index.tsx` ne re-gate pas le guest** — `app/checkout/index.tsx:39-89`. Deep-link direct affiche l'ecran de selection livraison (non sensible) avant le blocage en aval. Fix : `if(!user) router.replace('/(tabs)')`.
- **`swap-zone`: `requireAuth(() => {})` ne reprend pas l'action** — `app/swap-zone.tsx:265-306`. `onSuccess` vide -> proposition de swap non reprise apres login. Fix : passer la vraie action.
- **Champ « Nom d'utilisateur » du signup = en realite le displayName** — `components/AuthBottomSheet.tsx:251-256`. Source de derivation du `@username` ; `autoCapitalize='none'` empeche « Marie Dupont ». Incoherent avec `profile-details.tsx` (« Nom d'affichage »). Fix : relabeliser + retirer `autoCapitalize`.
- **Rollback de `signUpWithEmail` ne libere pas `usernames/`** — `services/authService.ts:205-256`. Meme orphelin que le P1 deleteUserAccount, sur le chemin d'inscription. Fix : callable de teardown.
- **`signInWithGoogle/Apple` sans rollback si le `setDoc` echoue** — `services/authService.ts:328-389`. Compte Auth orphelin sans doc users (auto-cicatrisant). Fix : `firebaseUser.delete()` en cas d'echec.
- **Echec verification email detecte seulement au dernier `createArticle`, apres upload Storage** — `app/sell/preview.tsx:200-214`. Effort gaspille + images orphelines potentielles. Lie au P1 vente/email.
- **Race `hydrateFromFirebase(null)` vs `hydrateFromFirebase(user)` en vol** — `store/authStore.ts:117-168`. Repro « au demarrage » NON atteignable (splash masque l'UI) ; variante etroite via foreground (fenetre de quelques ms). Fix : verifier `auth.currentUser?.uid` avant le `set` `l.150`.

### P3
- **Deux `useAuthRequired` (hooks/ vs contexts/)** — `contexts/AuthRequiredContext.tsx:25-35`. Dette/confusion d'import. Reco : consolider sur `@/hooks/useAuthRequired`, supprimer le shim.
- **`USER_DATA_KEY` ecrit mais jamais relu (cache mort + PII sur disque)** — `store/authStore.ts:151`. Pertinent Loi 25. Reco : supprimer les `setItem`/`removeItem` ou cabler une vraie hydration offline.
- **`userService.updateUserProfile` ne strippe pas `username`** — `services/userService.ts:219-229`. Non exploitable (rules bloquent), mais incoherence defense-en-profondeur. **Signal du verificateur (hors finding) :** `dateOfBirth` n'est protege NI par les rules NI par `updateUserProfile`, alors qu'il est server-only (consent-gate + age-gate) -> un client peut self-set `dateOfBirth`. A router vers `firebase-backend` comme finding distinct de severite superieure.
- **Sexe defaulte silencieusement a 'femme'** — `app/onboarding.tsx:139-149`. Donnee fausse mais inerte (aucune lecture de `sex`). Fix : exiger un choix ou ne pas defaulter.
- **`SexOption` utilise `withSpring` (regle no-spring)** — `features/onboarding/components/SexOption.tsx:8-37`. Pattern dominant du codebase (8+ fichiers) ; a traiter par migration globale.
- **Aucun `BackHandler` Android sur onboarding** — `app/onboarding.tsx:228-239`. Asymetrie iOS/Android, pas d'etat casse. Fix : `BackHandler` -> `setShowWelcome(true)`.
- **« Renvoyer l'email » sans cooldown UI** — `app/settings/verify-email.tsx:155-167`. Spammable jusqu'a `too-many-requests` (traduit FR). Fix : cooldown visuel.
- **`emailVerified` non propage dans le store au foreground** — `store/authStore.ts:142-151`. `auth.currentUser` non reactif ; verify-email pilote par CTA explicite. Nit.
- **Commentaire « verified » trompeur sur la sync email** — `store/authStore.ts:142-149`. Le code ne lit pas `emailVerified` ; aucune denorm Firestore. Inoffensif.
- **`favorites`: `onSuccess` vide + libelle « Parcourir » trompeur** — `app/(tabs)/favorites.tsx:191-202`. Cosmetique.
- **`saved-searches`: fermer le sheet laisse un EmptyState trompeur** — `app/saved-searches.tsx:238-281`. Incoherent avec my-orders/my-sales. Cosmetique guest-only.

---

## Recommandations (ordonnees)

1. **URGENT (P0)** : verrouiller les champs Stripe dans `firestore.rules:166` (update) + revalider l'ownership de `stripeAccountId` cote `walletWithdraw`. `firebase-backend` -> `npm run test:security`.
2. **P1 securite** : appliquer le set de cles protegees a la rule **create** `users/` (`firestore.rules:153-175`). Meme deploy que le P0.
3. **P1 vente/email** : `sendEmailVerification` a l'inscription + pre-check `isEmailVerified()` a l'entree du flow vente (`app/(tabs)/sell.tsx`) avec redirection vers `/settings/verify-email` + `getIdToken(true)` apres verification. `rn-expo-dev`.
4. **P1 session** : signOut propre dans le catch foreground de `useAuthListener.ts`. `rn-expo-dev`.
5. **P1 social** : gerer `account-exists-with-different-credential` (message FR / liaison). `rn-expo-dev`.
6. **P1 data-integrity** : liberer `usernames/{username}` dans `deleteUserAccount` (+ callable de teardown reutilisee par le rollback signup). `firebase-backend`.
7. **P2 onboarding & comptes** : relire `onboardingCompleted` Firestore au demarrage, `await` `saveOnboardingPreferences` pour user logge, ne rejouer `mergeGuestToUser` qu'a `isNewUser`. `rn-expo-dev`.
8. **P2 polish guards/UX** : guards guest (`wallet`, `checkout/index`), vraies actions `onSuccess` (swap-zone, favorites), `submitDisabled` gate sur validation, relabel « Nom d'affichage ». `rn-expo-dev` / `product-designer`.

---

## Annexe — par dimension

| Dimension | Verdict | Findings notables |
|---|---|---|
| session-lifecycle | Saine sauf 1 P1 | P1 user fantome foreground (`useAuthListener.ts:44`) ; P2 race hydrate ; P3 `USER_DATA_KEY` mort |
| auth-ui-sheet | Largement saine | P2 submit non gate sur validation ; P2 `show()` sur sheet ouverte |
| onboarding-flow | Saine (callable conforme) | P2 gating device-scoped ; P2 prefs guest inertes ; P3 default sexe / spring / BackHandler |
| social-auth-merge | Saine sauf 1 P1 | P1 collision email ; P2 Apple-only Android ; P2 add-password email ; P2 merge rejoue |
| email-verification | **Incoherence majeure** | P1 vente gatee sans email envoye ; P2 echec en fin de flow ; P3 reactivite / cooldown |
| auth-gating | Coherente (1 doublon) | P2 wallet/checkout sans guard ; P2 swap-zone onSuccess vide ; P3 doublon `useAuthRequired` |
| backend-auth | Solide (username) | P1 `usernames/` non libere ; P2 rollbacks orphelins ; P3 strip `username`/`dateOfBirth` |
| security-rules | **Faille P0** | **P0 champs Stripe non verrouilles (update)** ; P1 auto-attribution a la creation |
| cross-cutting-logic | Bonne | P1 `usernames/` (dedup) ; P2 champ « Nom d'utilisateur » ; P2 `onboardingCompleted` divergent |

*Dedup applique : l'orphelin `usernames/` a la suppression (backend-auth + cross-cutting-logic) est consolide en un seul P1 (#5).*