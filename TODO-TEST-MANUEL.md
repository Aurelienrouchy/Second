# Second — TODO de test manuel (toutes les pages & flows)
_Version 2026-06-03 · iOS + Android · à cocher au fur et à mesure._

> ⚠️ **PÉRIMÈTRE DE TEST ACTUEL** — Hors scope (réversible) : livraison/expédition & suivi (config/featureFlags.ts → SHIPPING_ENABLED=false), paiement en ligne / Stripe (checkout, Connect, compte bancaire, payouts/retraits), porte-monnaie alimenté en ligne, recours remboursement/retour/litige paiement, **boutiques** (création/forfaits/modération), swap *cash top-up*. Tout est en **main-à-main (meetup) + paiement cash hors app**. Les blocs concernés sont conservés et marqués ⏭️ pour réactivation.

## Légende & préparation

**États de compte à préparer**
- [ ] **Invité** (non authentifié, session AsyncStorage + guestSession Firestore)
- [ ] **Membre connecté** (email+password, email vérifié ET non vérifié)
- [ ] **Membre social** (Google et Apple — Apple uniquement iOS)
- [ ] **Admin** (claim/role admin pour accéder à `/admin/*`)

> ⏭️ Les états « Vendeur avec Stripe Connect actif » et « Vendeur sans Stripe » sont retirés des prérequis : le paiement en ligne / l'onboarding Stripe est hors scope (`SHIPPING_ENABLED=false`). À réactiver avec le shipping.

**Données de test à préparer**
- [ ] Article actif non vendu (avec photos Storage, IA, prix, quartiers meetup)
- [ ] Article vendu (`isSold=true`) et article soft-deleted (`isActive=false`)
- [ ] Conversation acheteur↔vendeur (avec et sans article)
- [ ] Commande/transaction (`meetup_pending`, `meetup_confirmed`, `meetup_completed`)
- [ ] Offre (`pending`, `accepted`, `rejected`, `expired`)
- [ ] Swap (`proposed`, `accepted`, `completed`) — item-contre-item, sans complément argent
- [ ] Recherche sauvegardée + favoris (articles + vendeurs)
- [ ] Notifications in-app de chaque type
- [ ] Litige / signalement ouvert (pour panels admin)

> ⏭️ Prérequis retirés du périmètre actuel : « Solde porte-monnaie alimenté » (aucun crédit de vente sans paiement en ligne) et « Boutique (pending/approved/…) » (feature boutiques hors scope). Conservés pour réactivation.

**Appareils**
- [ ] iPhone (iOS réel pour push + Apple Sign-In)
- [ ] Android (push FCM + back hardware + Play Services)

**Rappels transverses (à garder en tête sur TOUS les flows)**
- ⚠️ **Expédition désactivée** (`SHIPPING_ENABLED=false`) : seul le **meetup** est actif, règlement cash/virement hors app, zéro frais plateforme, aucun appel Stripe pour meetup. Les écrans/options shipping doivent être masqués (y compris articles legacy `isShipping=true`).
- ⚠️ **Push iOS non opérationnel** : jeton APNs brut rejeté par FCM → aucun push système iOS hors-app. Les notifications **in-app** restent la seule surface fiable iOS. Android push OK.
- ⚠️ **Bottom sheets** : hybride gorhom (complexes) + @expo/ui (simples) ; montage à l'ouverture pour éviter le voile transparent Android.

---

## 🔥 Points chauds à tester en priorité (liste agrégée, page concernée)

> **Périmètre actuel** : `SHIPPING_ENABLED = false` (`config/featureFlags.ts:17`).
> Tout article est forcé en **main-à-main (meetup)**, le paiement se fait **cash hors application**.
> Aucun paiement en ligne (Stripe Checkout / PaymentIntent), aucune expédition / suivi / point-relais,
> aucun payout / retrait alimenté. Le flux **meetup de bout en bout** devient le parcours critique n°1.
> Les points liés au shipping / paiement en ligne / boutiques restent dans le doc mais sont marqués
> **⏭️ HORS SCOPE ACTUEL (réactivable)** — repasser le drapeau à `true` les réactive sans autre changement.

### P0 — Bloquant / sécurité / données (périmètre actuel)
- [ ] **Parcours meetup de bout en bout (PARCOURS CRITIQUE N°1)** — `Proposer un achat` → acceptation vendeur → arrangement lieu/horaire → confirmation des deux parties → article passe `isSold` → avis croisés, **paiement cash hors app** (jamais de Stripe). Vérifier qu'aucune étape ne tente d'ouvrir un checkout en ligne ni ne réclame un compte bancaire (`/article/[id]`, `/checkout/index`, `/checkout/meetup`, `/chat/[id]`, `/my-orders`, `/my-sales`, `/review/[transactionId]`).
- [ ] **No-show meetup (P0-2 meetup)** — après no-show, l'article reste `isSold=true` indéfiniment, transaction `meetup_confirmed` zombie, bouton no-show purement cosmétique → article **invendable à jamais** (`/chat/[id]`, `/my-orders`, `/my-sales`).
- [ ] **Meetup confirmé jamais complété (P0-3 meetup)** — aucun timeout auto, si la rencontre n'a pas lieu l'article reste verrouillé `isSold=true`, aucune sortie d'état (`/chat/[id]`).
- [ ] **Aucune fuite shipping / paiement en ligne / boutique dans l'UI (VÉRIFICATION TRANSVERSE)** — avec `SHIPPING_ENABLED=false`, s'assurer qu'AUCUN bouton, écran, option ou lien shipping / Stripe en ligne / boutique ne FUIT au testeur. Points à vérifier explicitement :
  - [ ] Article CTA : bouton affiche **« PROPOSER UN ACHAT »** (jamais « ACHETER · prix »), bouton **« PROPOSER UN ÉCHANGE »** pour le swap, bouton **« OFFRE »** présent (`features/article/ArticleCTABar`, vérifié lignes 86-93).
  - [ ] Détail article : aucune mention « Livraison » / « Expédition » / délai d'envoi / point-relais, uniquement « Remise en main propre » (`/article/[id]`).
  - [ ] `sell/pricing` : `ShippingCard` masquée, seul le bloc main-à-main + quartiers s'affiche (`/sell/pricing`, vérifié `SHIPPING_ENABLED &&` ligne 242).
  - [ ] Checkout : aucun choix de mode de livraison ni saisie d'adresse, redirection auto vers `/checkout/meetup` (`/checkout/index`, vérifié `if (!SHIPPING_ENABLED) return 'meetup'` ligne 62) ; `/checkout/shipping` jamais atteignable par navigation normale.
  - [ ] **PIÈGE settings** : l'entrée « Compte de paiement — Configurer Stripe Connect » ET « Mon porte-monnaie » restent **visibles et cliquables** sans condition sur le flag (`/settings/index`, vérifié lignes 173-183). Vérifier qu'aucun parcours n'amène à croire qu'un payout en ligne va arriver. À signaler si non intentionnel (masquage ou empty-state explicatif recommandé).
  - [ ] Profil / onglet vente : aucun encart « activer la livraison » ou « recevez vos paiements ».
  - [ ] Swap : pas d'option « complément en argent » active (Stripe) — voir P2 dédié.
- [ ] **Vente bloquée sur `email_verified` (rejet en fin de tunnel)** — aucun email envoyé à l'inscription, le gate est découvert seulement à la publication, après 5 écrans + upload photos → frustration majeure (`/sell/*`, `/settings/verify-email`).
- [ ] **Images locales en édition (P-IMG / C3)** — les nouvelles photos restent en `file://` au lieu d'être uploadées sur Storage → images cassées pour les autres utilisateurs (`/article/edit/[id]`, `/my-orders`).
- [ ] **Pas de verrou transactionnel sur le prix (P-LOCK)** — prix de l'article modifiable pendant qu'une offre / transaction meetup est en cours → incohérence montant convenu vs montant affiché (`/article/[id]`, `/sell/pricing`, `/checkout/*`).
- [ ] **Push iOS hors-app jamais reçu** — notification distante (offre acceptée, message, no-show, meetup confirmé) jamais délivrée quand l'app est en arrière-plan / tuée sur iOS → testeur rate les transitions critiques du flux meetup (`hooks/useNotificationSetup`, APNs, `/notifications`).
- [ ] **Routing notif `saved_search` + reset compteur (RÉGRESSION À VÉRIFIER)** — le code émet désormais la clé `savedSearchId` côté backend (`functions/src/scheduled/savedSearches.ts:307`) ET la lit côté client (`hooks/useNotificationSetup.ts:211-218`). Vérifier de bout en bout : le tap navigue bien vers `/search` avec query+filtres ET le compteur « nouveaux articles » est bien réinitialisé (`resetNewItemsCount`). Confirmer qu'il ne subsiste aucune émission de l'ancienne clé `searchId` (`/notifications`, `/saved-searches`).

### P1 — UX / impasse / intégrité (périmètre actuel)
- [ ] **Collision email social non gérée** — `account-exists-with-different-credential` non catché → impasse à l'inscription (`SignInForm`, `SignUpForm`, `SocialConsentForm`).
- [ ] **User fantôme foreground** — token révoqué / compte supprimé à distance non détecté, `signOut` non déclenché au retour en foreground (auth listener).
- [ ] **Orphelin `usernames/`** — @username jamais libéré à la suppression de compte (`/settings/delete-account`).
- [ ] **Like articles double système** — `toggleFavorite` SDK direct vs `toggleProductLike` jamais appelée → compteurs figés à 0 + ranking recherche faussé (`ProductCard`, `/article/[id]`).
- [ ] **Personnalisation « Pour toi » cassée** — tailles `string[]` au lieu de `{value,system}` → matching échoue, section invisible (`features/home/pour-toi`, `/settings/preferences`).
- [ ] **« Vendeurs aimés » orphelin** — route existe, aucun point d'entrée dans l'app (`/liked-sellers`).
- [ ] **Expiration auto offres inexistante** — `expiresAt` client, aucune CF scheduled, bascule `expired` jamais visible (`/chat/[id]`, OfferBubble).
- [ ] **Contre-offres lieu/horaire meetup non exposées** — `onCounterLocation`/`onCounterTime` jamais passés alors que c'est le cœur de l'arrangement meetup (`/chat/[id]`, OfferBubble).
- [ ] **Parsing montant FR-CA** — `45,50` → `4550` (x100 en cents) si la normalisation de la virgule est absente, fausse l'offre meetup (`/sell/pricing`, MakeOfferModal).
- [ ] **Calcul moyenne avis faux** — vendeur 15+ avis : moyenne != moyenne des 10 premiers (`/user/[id]`).
- [ ] **Review meetup impossible si statut figé** — la review doit être accessible après confirmation meetup ; vérifier que le code ne croit pas un statut inexistant (`/review/[transactionId]`, `/my-orders`).

### P2/P3 — UX dégradée / cosmétique (périmètre actuel)
- [ ] **Validation client non reliée au submit** — erreur visible mais bouton actif (`SignInForm`, `SignUpForm`).
- [ ] **Merge guest replay** — `mergeGuestToUser` appelé à chaque connexion social, écrase les prefs user (flux guest→member).
- [ ] **Compte Apple-only injoignable sur Android** — bouton Apple masqué sans fallback (`/settings/email`, `/settings/delete-account`).
- [ ] **Email input arbitraire add-password** — `linkWithCredential` ne change pas l'email primaire, revert Firestore (`/settings/add-password`).
- [ ] **Aucun cooldown UI renvoyer email** — spammable jusqu'à `too-many-requests` (`ForgotPasswordForm`, `/settings/verify-email`).
- [ ] **Articles vendus visibles & swappables dans SwapZone** — doivent disparaître de la grille (`/swap-zone`).
- [ ] **Soft-delete : favoris fantômes** — articles supprimés par autrui restent cliquables (`/favorites`).
- [ ] **Feed « Pour toi » jamais rafraîchi** — useState/useEffect sans React Query, figé jusqu'au remount (`features/home/pour-toi`).
- [ ] **Pull-to-refresh absent** — Home Accueil + Favoris (ProductGrid `onRefresh` non passé).
- [ ] **Blocage messagerie unilatéral** — victime continue de recevoir les messages du bloqueur (à vérifier enforcement serveur).
- [ ] **Notif blocage / décisions automatisées Loi 25** — contestation accessible (`/chat/[id]`).

---

#### ⏭️ HORS SCOPE ACTUEL (réactivable — `SHIPPING_ENABLED = true`)
> Conservés pour réversibilité. Ces points concernent le paiement en ligne, l'expédition/suivi, les payouts,
> les boutiques et le swap avec complément argent — tous inatteignables tant que `SHIPPING_ENABLED = false`.
> Ils restent à tester dès la réactivation. Voir aussi les sections détaillées correspondantes du doc,
> elles-mêmes marquées hors scope.

- [ ] **Stripe : champs non verrouillés en Firestore rules** — un vendeur peut rediriger son payout vers un compte tiers (`/settings/stripe-onboarding`, `/wallet`). *(Hors scope : pas de paiement en ligne ni de payout en meetup-only.)*
- [ ] **Boutique auto-approuvée (P0-1)** — vendeur peut écrire `status='approved'` sans modération (rules `/shops`) → vitrine vérifiée frauduleuse (`/shop/[id]`). *(Hors scope : aucune UI utilisateur de création de boutique ; gestion admin-only.)*
- [ ] **Modération admin boutique cassée (P0-2)** — `approveShop`/`rejectShop` via updateDoc client rejetés (permission-denied), aucune CF admin → bouton Approuver erreur systématique (`/admin/shop-detail/[id]`, `/admin/shops`). *(Hors scope : feature boutiques non exposée au parcours utilisateur.)*
- [ ] **Pas de verrou paiement en ligne** — prix modifiable durant le paiement Stripe (`/checkout/shipping`). *(Hors scope : checkout Stripe inaccessible ; le verrou prix meetup reste couvert en P0/P1 ci-dessus.)*
- [ ] **Carte Google Maps cassée** — pas de clé/config → gris/blanc iOS + Android (`/shop/[id]`, `/admin/shop-detail/[id]`). *(Hors scope : écrans boutique non exposés.)*
- [ ] **Aucun écran admin litiges actionnable** — `disputes` lecture seule, résolution via callable admin hors app (`/admin/disputes`, `/wallet`). *(Hors scope : aucun remboursement / escrow Stripe en meetup cash ; règlement local non financier seulement.)*
- [ ] **Review impossible après `completed` (shipping J+7)** — code croit le statut inexistant (`/review/[transactionId]`). *(Hors scope : statut `completed` shipping inatteignable ; review meetup couverte en P1.)*
- [ ] **Dette vendeur (`sellerDebt>0`) bloque retraits** — garde-fou serveur (`/wallet`). *(Hors scope : aucun retrait possible sans solde alimenté en ligne.)*
- [ ] **Wallet alimenté en ligne** — solde / pending / held, protection 7j, ledger. *(Hors scope : meetup cash = aucun crédit de vente n'alimente le wallet ; l'écran reste accessible mais vide → empty-state explicatif recommandé.)*
- [ ] **Complément argent swap (Stripe) interactif mais rejette toujours** — doit être masqué/grisé (`/propose-swap`, `/swap/[id]`). *(Hors scope : `createSwapTopUpCheckout` = PaymentIntent Stripe ; le swap item-contre-item SANS complément reste IN SCOPE et testable.)*
- [ ] **Articles boutique jamais affichés (P1-2)** — `articlesCount=0`, lien `/search?shopId` mort (`/shop/[id]`). *(Hors scope : feature boutiques.)*
- [ ] **Onglet « Toutes » omet boutiques suspendues (P2-3)** + bouton Suspendre code mort (P2-2) (`/admin/shops`). *(Hors scope : modération admin boutiques.)*
- [ ] **Safe-area footer admin boutique (P1-6)** — boutons Approuver/Rejeter chevauchent home indicator / barre gestes (`/admin/shop-detail/[id]`). *(Hors scope : écrans boutique.)*

> **Note signalements (utilisateurs/articles)** : la partie **signalement users/articles** N'EST PAS hors scope shipping. Le backend (`ModerationService.createReport`, rules `reports`) et le panneau `/admin/reports` existent ; vérifier toutefois qu'une **UI client de signalement** existe (bouton « Signaler » sur article / user / message). Si absente, le signalement reste admin-only — à documenter ou ajouter (cf. section 12 Messagerie & Modération).

---
## Table des matières

1. [Onboarding & Authentification](#1-onboarding--authentification)
2. [Profil & Réglages](#2-profil--réglages)
3. [Vente / Mise en vente](#3-vente--mise-en-vente)
4. [Accueil, Découverte & Favoris](#4-accueil-découverte--favoris)
5. [Recherche & Filtres](#5-recherche--filtres)
6. [Article, Achat & Checkout](#6-article-achat--checkout)
7. [Offres & Négociation](#7-offres--négociation)
8. ⏭️ [Meetup & Livraison/Suivi](#8-meetup--livraisonsuivi) — meetup IN SCOPE, livraison/suivi HORS SCOPE
9. [Avis & Ventes](#9-avis--ventes)
10. ⏭️ [Porte-monnaie, Paiements vendeur & Recours](#10-porte-monnaie-paiements-vendeur--recours) — UI wallet + admin litiges IN SCOPE, payouts/Stripe/recours HORS SCOPE
11. [Swap & SwapZone](#11-swap--swapzone)
12. [Messagerie & Modération](#12-messagerie--modération)
13. [Notifications](#13-notifications)
14. ⏭️ [Boutiques & Administration](#14-boutiques--administration) — boutiques HORS SCOPE, modération signalements/litiges admin IN SCOPE
15. [Légal & Conformité Loi 25](#15-légal--conformité-loi-25)

---

## 1. Onboarding & Authentification

> ✅ **DANS LE PÉRIMÈTRE ACTUEL** — l'onboarding et l'authentification sont entièrement testables. `SHIPPING_ENABLED=false` n'impacte PAS ce flow. Seuls deux points périphériques touchent des zones désormais hors scope (destinations de gates invité `/wallet` et `/checkout`) : voir les notes ⏭️ ciblées en 1.14.

_Routes : `app/onboarding.tsx`, `components/auth-bottom-sheet/{SignInForm,SignUpForm,SocialConsentForm,ConsentFields,ForgotPasswordForm}.tsx`, `app/settings/{verify-email,add-password,password,email,delete-account}.tsx`._

### 1.1 Écran de bienvenue & onboarding préférences (`app/onboarding.tsx`)

#### Welcome Screen — Step 1 (showWelcome = true)
**À quoi ça sert :** Présenter l'app et proposer de commencer l'onboarding ou de passer à l'accueil.

**Préconditions :** Invité OU nouvel utilisateur authentifié sans `onboardingCompleted` en AsyncStorage. Aucune donnée requise (écran statique).

**Étapes :** Lancer l'app depuis 0 → observer « BIENVENUE SUR Seconde » → vérifier le texte « Dis-nous en un peu plus sur toi… » → tester « CONTINUER » → tester « Passer ».

**Résultat attendu :** Écran centré, animations FadeInDown ; « CONTINUER » → step 2 ; « Passer » → enregistre `ONBOARDING_COMPLETED_KEY` + navigue `/(tabs)`.

- [v] Écran vide / pas de crash au lancement
- [v] Animations fluides iOS + Android (FadeIn, FadeInDown, FadeInUp)
- [v] Texte FR correct, polices Cormorant Garamond + Satoshi
- [v] Boutons cliquables, hitSlop correct
- [v] Navigation vers form screen OK
- [v] Navigation vers home OK (guest ou user)

#### Onboarding Form — Sélection sexe & tailles — Step 2
**À quoi ça sert :** Collecter sexe (homme/femme/enfant), système de taille (EU/US), tailles haut/bas/chaussures pour personnaliser le feed.

**Préconditions :** User invité ou authentifié sans `onboardingCompleted`, welcome complété.

**Résultat attendu :** Sexe radio mono-sélection ; système de taille toggle EU/US (grilles SIZES_KIDS/SIZES_ADULT) ; tailles multi-select ; changement EU/US avec sélections → alerte réinitialisation ; « VALIDER » désactivé sans sexe OU sans taille ; sauvegarde AsyncStorage + Firebase ; redirection `/(tabs)` + `ONBOARDING_COMPLETED_KEY='true'`.

- [v] Écran chargé sans crash
- [v] Radio sexe (3 options distinctes)
- [v] Grilles de tailles adaptées adult/kids
- [v] Multi-select tailles (tap = toggle, résumé mis à jour)
- [v] Système de taille bascule + alerte OK
- [v] « VALIDER » désactivé en état initial
- [v] « VALIDER » s'active après sexe + ≥1 taille
- [v] Loading state : spinner visible, bouton désactivé
- [v] Sauvegarde AsyncStorage + Firebase sans erreur perceptible
- [v] Redirection home après succès
- [v] « Passer » → même redirection, pas de sauvegarde
- [v] Back chevron → retour welcome, sélections conservées

**Points chauds :**
- [x] Sauvegarde Firebase fire-and-forget invité : prefs non perdue en cas de coupure réseau
- [v] AsyncStorage vs Firestore : après login, prefs guest fusionnent avec prefs user

**iOS vs Android :** Hardware back Android doit retourner à welcome, pas quitter l'onboarding.

#### Back Navigation & Skip Actions
- [v] Chevron back existe (iOS style) + cliquable
- [v] « Passer » fonctionne aux deux étapes
- [v] Sélections tailles conservées après back depuis form
- [v] Hardware back Android différencié (welcome = quitter, form = retour welcome)

### 1.2 Sign In par Email/Password (`SignInForm.tsx`)
**Préconditions :** Invité, compte existant Firebase Auth, AuthBottomSheet ouvert.

**Résultat attendu :** Onglet « Se connecter » actif par défaut ; erreur email (@ + .) ; erreur password (min 6) ; bouton désactivé si invalide ; loading spinner ; succès `signInWithEmail` + sheet fermée ; erreur credential message explicite ; lien « Mot de passe oublié ? » → ForgotPasswordForm.

- [ ] Formulaire chargé (email, password visibles)
- [ ] Validation client OK (erreurs après blur)
- [ ] Bouton désactivé en état initial
- [ ] Bouton activé après remplissage valide
- [ ] Loading state OK pendant submit
- [ ] Cas succès : user authentifié, sheet fermée
- [ ] Cas erreur : message visible, bouton reste actif (retry)
- [ ] Tab switch vers signup fonctionne
- [ ] Forgot password link fonctionne

**Points chauds :**
- [ ] **Validation client non reliée à submit (P2)** : erreur visible mais bouton peut être actif → envoi email invalide au serveur possible ?
- [ ] **Apple Sign-In iOS uniquement** : sur Android → message « Compte créé avec Apple ? Connectez-vous depuis un iPhone »

### 1.3 Sign In / Sign Up Social (Google & Apple) + Consentement Loi 25 (`SocialConsentForm.tsx`)
**Préconditions :** Invité, appareil iOS (Apple) ou Android/iOS (Google), pas de compte Second existant avec cet email.

**Résultat attendu :** Nouvel utilisateur → consentement obligatoire (DOB ≥16 + Terms + Privacy) ; user existant consenti → entrée directe ; dismiss durant consentement → rollback destructif (nouveau user) OU sign-out seul (user existant sans DOB) ; hardware back Android consommé.

- [ ] Google Sign-In visible + cliquable
- [ ] Apple Sign-In visible iOS / message Android
- [ ] Nouveau user → SocialConsentForm affiché
- [ ] Erreur age < 16 : « Vous devez avoir au moins 16 ans »
- [ ] Consentements Terms + Privacy requis pour submit
- [ ] Consentement Marketing optionnel
- [ ] « CONTINUER » désactivé si DOB invalide ou consentements manquants
- [ ] Succès : user.dateOfBirth + signupConsent_* en Firestore
- [ ] Dismiss sheet durant consentement → compte supprimé (rollback)
- [ ] Hardware back Android consentement → consommé, pas de navigation
- [ ] Collision email → message d'erreur (P1 : non géré actuellement)

**Points chauds :**
- [ ] **Collision email social (P1)** : compte email+password existant + Google même email → `account-exists-with-different-credential` non catché. Tester : créer `test@example.com` puis Google même email → vérifier message réel.
- [ ] **Loi 25 consentement verrouillé** : impossible de passer par-dessus (backdrop disable, back consommé).
- [ ] **Rollback destructif vs sign-out** : nouveau user → suppression compte ; user existant sans DOB → sign-out seul.

### 1.4 Sign Up par Email/Password (`SignUpForm.tsx`)
**Préconditions :** Invité, pas de compte existant avec cet email, AuthBottomSheet ouvert.

**Résultat attendu :** Validation client (nom ≥3, email valide, password ≥6, DOB ≥16) ; Terms + Privacy obligatoires, Marketing optionnel ; succès `signUpWithEmail` → users/{uid} + usernames/{username} ; @username dérivé du displayName (immuable).

- [ ] Formulaire chargé (5 inputs + 3 checkboxes)
- [ ] Validation client : tous champs après blur
- [ ] Erreurs affichées sous champs
- [ ] Bouton désactivé si validation incomplète
- [ ] Bouton activé une fois tous valides
- [ ] Loading state : spinner, bouton désactivé
- [ ] Succès : Firebase Auth + Firestore (user doc + username doc)
- [ ] Email déjà utilisé : « Cet email existe déjà »
- [ ] Lien « Conditions » → `/legal/terms`
- [ ] Lien « Politique de confidentialité » → `/legal/privacy-policy`
- [ ] Switch vers SignIn fonctionne

**Points chauds :**
- [ ] **Dérivation @username** : label « Nom d'affichage », `autoCapitalize='words'` → vérifier normalisation `@MarieD...`, pas de caractères spéciaux.
- [ ] **Email non vérifié à la création (P1)** : aucun mail de vérification envoyé → user créé sans `email_verified`.
- [ ] **Validation submit non reliée aux erreurs client (P2)** : erreur visible mais bouton actif ?

#### Sign Up Social — flux création
- [ ] Flux création OK (isNewUser=true)
- [ ] Loi 25 consentement appliqué
- [ ] Rollback destructif pour nouveau user
- [ ] Email verification = non vérifié (pas d'email envoyé)

### 1.5 Forgot Password (`ForgotPasswordForm.tsx`)
**Préconditions :** Invité, AuthBottomSheet ouvert, compte email+password existant, accès boîte mail.

**Résultat attendu :** Email validé client ; « ENVOYER LE LIEN » désactivé si invalide ; `sendPasswordResetEmail` ; écran success (icône mail + email + « RETOUR À LA CONNEXION » + « Renvoyer l'email »).

- [ ] Écran chargé, titre/message OK
- [ ] Email input visible + validé
- [ ] Bouton désactivé si vide/invalide
- [ ] Bouton activé email valide
- [ ] Loading state spinner durant submit
- [ ] Succès : écran success affiché
- [ ] Email display OK
- [ ] « RETOUR À LA CONNEXION » → SignInForm
- [ ] « Renvoyer l'email » clickable (pas de cooldown)
- [ ] Naviguer away (back) → resetForm appliqué

**Points chauds :**
- [ ] **Pas de cooldown UI renvoyer email (P3)** : frapper rapidement → comportement serveur (rate-limit) ?

### 1.6 Change Email (`app/settings/email.tsx`)
**Préconditions :** Authentifié, accès Settings → Email, accès new email inbox.

- [ ] Écran chargé, email actuel affiché
- [ ] Validation nouvel email client
- [ ] Bouton désactivé email vide/invalide
- [ ] Re-auth triggered (password ou social)
- [ ] Succès : email changé Firestore
- [ ] Notification affichée
- [ ] **Apple sur Android (P2)** : si pas de password → « Ajoutez d'abord un mot de passe » + lien `/settings/add-password`
- [ ] **Provider inconnu** : « Impossible de déterminer votre méthode de connexion »

**Points chauds :**
- [ ] **Email verification stale (P3)** : après changement, `emailVerified` reste stale, nouvel email non vérifié initialement.
- [ ] **Ré-authentification sociale persistante** : succès, ne relance pas l'auth sheet.

### 1.7 Verify Email (`app/settings/verify-email.tsx`)
**Préconditions :** Authentifié, email non vérifié, accès inbox.

- [ ] Statut initial : email non vérifié → warning icon
- [ ] « Envoyer l'email » visible, cliquable, loading state
- [ ] Success message « Email envoyé » + box confirmation
- [ ] Cliquer le lien dans le mail → verification OK
- [ ] « J'ai vérifié mon email » → `reloadUser()` refresh OK
- [ ] Écran success « Email vérifié »
- [ ] Lien « Renvoyer l'email » clickable

**Points chauds :**
- [ ] **Email non vérifié bloque la vente (P1)** : `createArticle` refuse si `email_verified=false`. Tester : compte non vérifié → parcourir vente → erreur en fin de flow (pas de check à l'entrée).
- [ ] **Pas de cooldown UI renvoyer email (P3)**.
- [ ] **Statut emailVerified stale** après changement email.

### 1.8 Add Password (compte social) (`app/settings/add-password.tsx`)
**Préconditions :** Authentifié via Apple/Google (pas de password provider).

- [ ] Écran chargé
- [ ] Email input (pré-rempli, éditable)
- [ ] Password input validé (≥6), confirmation identique
- [ ] Bouton désactivé si validation incomplète
- [ ] Re-auth popup OK ; `requires-recent-login` → bouton « Se reconnecter »
- [ ] Succès : password provider lié (Firebase Auth) + message confirmation

**Points chauds :**
- [ ] **Email input modifiable mais non fonctionnel (P2)** : `linkWithCredential` utilise l'email du credential social (immuable) ; après submit `hydrateFromFirebase` revert Firestore. Tester : écrire un email différent → observer revert.

### 1.9 Change Password (`app/settings/password.tsx`)
**Préconditions :** Authentifié via email+password.

- [ ] Écran chargé, 3 inputs visibles (ancien, nouveau, confirmation) + eye toggles
- [ ] Validation : nouveau = confirmation, ≥6 char
- [ ] Bouton désactivé si validation incomplète
- [ ] Re-auth popup OK ; mot de passe actuel incorrect → erreur
- [ ] Succès : password changé Firebase + message confirmation

### 1.10 Delete Account (`app/settings/delete-account.tsx`)
**Préconditions :** Authentifié, accès Settings → Supprimer le compte.

- [ ] Écran chargé, avertissement visible
- [ ] Conditions affichées (ventes, solde, etc.), validation correcte
- [ ] Bouton désactivé si conditions non remplies
- [ ] Texte de confirmation « SUPPRIMER » requis
- [ ] Re-auth popup OK (password ou social)
- [ ] Succès : `deleteUserAccount` callable → users/{uid} + Auth supprimés, resetAllStores, redirection `/`
- [ ] **Audit P1** : vérifier que `usernames/{username}` est **NON** supprimé (bug attendu — handle réservé à vie)

**Points chauds :**
- [ ] **Gardes financiers serveur** : solde retirable > 0, dispute ouverte, transaction active, dette vendeur → blocage avec message FR explicite + bouton disabled. _Note périmètre : ces gardes restent appliquées côté callable `deleteUserAccount` même si, en l'absence de paiement en ligne (meetup cash hors-app), le solde porte-monnaie reste à 0 en pratique — le code du gate est inchangé._
- [ ] **Orphelin `usernames/` (P1)** : après suppression, `usernames/{username}` existe toujours avec ref vers uid supprimé.
- [ ] **Apple sur Android sans password** : fallback « Ajouter un mot de passe ».

### 1.11 Flux Guest → Member

#### Guest Session Initialization
- [ ] GuestSession ID généré (UUID)
- [ ] AsyncStorage guestSession persistant
- [ ] Firestore guest session doc créé (fire-and-forget)
- [ ] Favoris / prefs stockés localement
- [ ] Pas d'erreur réseau ne bloque la session

#### Guest → Member Merge
- [ ] Sign-up/Sign-in réussi
- [ ] Merge déclenché (logs __DEV__)
- [ ] Firestore user : liked_articles inclut articles guest
- [ ] Firestore user : onboarding prefs mis à jour
- [ ] Favoris visibles app après merge
- [ ] Settings prefs visibles après merge

**Points chauds :**
- [ ] **Merge replay (P2)** : `mergeGuestToUser` appelé à CHAQUE connexion social, écrase les prefs user. Tester : guest « M, L » → sign-up + onboarding « S, XL » → connexion Google → vérifier que prefs restent « S, XL » (pas revert « M, L »).

### 1.12 États globaux Loading & Erreurs
- [ ] Splash masque UI durant hydration (`useAuthListener isLoading`)
- [ ] Pas de flash écran login après contenu
- [ ] Loading indicators durant : sign-in/up, forgot password, email verification, suppression, changement email/password
- [ ] Boutons désactivés durant loading
- [ ] Escape loading : timeout/erreur réseau → loading=false
- [ ] Erreur réseau : message FR explicite
- [ ] Erreur credential / email déjà utilisé / serveur 500 : messages explicites
- [ ] Bouton retry disponible après erreur
- [ ] **P1 User fantôme foreground** : token révoqué / compte supprimé à distance → signOut déclenché ?

### 1.13 Loi 25 & Sécurité (transverse auth)
- [ ] Age gate : DOB < 16 bloque submit (signup ET social) ; ≥16 permet ; 16e anniversaire exact OK
- [ ] Consentement : Terms + Privacy obligatoires, Marketing optionnel, enregistrés Firestore
- [ ] Liens Terms → `/legal/terms` / Privacy → `/legal/privacy-policy`
- [ ] Rollback social : nouveau user dismiss → users/{uid} supprimé + Auth delete ; user existant sans DOB → sign-out seul (compte conservé)

### 1.14 Cross-Platform & Guest Gates
- [ ] iOS : Apple + Google ; Android : Google seul (Apple message)
- [ ] Simulator iOS sans compte Apple : button disabled (fallback gracieux)
- [ ] Hardware back : welcome=quitter, form=retour, signIn/signUp=fermer sheet, socialConsent=consommé
- [ ] Post-login : reprise action (fav depuis favoris ; checkout = uniquement meetup, pas de paiement Stripe — cf. section 6)
- [ ] **Guest gates (P2)** : `/propose-swap` → onSuccess vide ; `/my-orders` et `/my-sales` gated correct

> ⏭️ **HORS SCOPE ACTUEL (réactivable)** — gates invité vers zones désormais restreintes
> Raison : ces destinations restent atteignables par le routeur mais leur cœur métier est hors périmètre — `/checkout` route TOUJOURS vers le meetup (jamais Stripe/PaymentIntent, `app/checkout/index.tsx`), et `/wallet` reste vide faute de revenu en ligne (meetup = cash hors-app). Le test du gate d'authentification lui-même est conservé pour réactivation. Conservé pour réactivation (`config/featureFlags.ts` : `SHIPPING_ENABLED`).

- [ ] **Guest gate `/wallet`** → alert connexion (non gated actuellement) — ⏭️ écran accessible mais reste vide en pratique (aucun crédit de vente en ligne ; cf. section 10)
- [ ] **Guest gate `/checkout`** → reroute (non gated) — ⏭️ checkout pré-sélectionne le meetup automatiquement, aucun choix livraison/adresse ni appel Stripe (cf. section 6)

---

## 2. Profil & Réglages

_Routes : `app/(tabs)/profile.tsx`, `app/user/[id].tsx`, `app/settings/*`._

> ⏭️ **Périmètre actuel** — Cette section reste largement IN SCOPE. Seuls les réglages liés au **paiement en ligne / expédition** passent hors scope (réversibles via `config/featureFlags.ts` → `SHIPPING_ENABLED` et l'activation Stripe Connect) : Options de livraison, Onboarding Stripe Connect, Paiements (cartes). Le **Porte-monnaie** reste accessible mais s'affiche **vide** (aucun revenu en ligne : règlement meetup cash/virement hors app).

### Mon Profil (`app/(tabs)/profile.tsx`)

**Préconditions :** Invité OU connecté. Données : stats (articles, ventes, note, abonnés), profil (photo, nom, bio).

#### Consultation profil personnel (Invité)
- [ ] Section « Guest State » + CTA « Se connecter »
- [ ] Appui « Se connecter » ouvre l'auth sheet
- [ ] Menu items montrent des CTA, pas de routes accessibles
- [ ] Pas de bouton « MODIFIER »
- [ ] Pas de bouton « SE DÉCONNECTER »

#### Consultation profil personnel (Connecté)
- [ ] Header cream + nom d'affichage
- [ ] Avatar + nom + handle + « Membre depuis [date] »
- [ ] Bio affichée (pas de troncature si ≤ 200 car)
- [ ] Stats : Articles, Ventes, Note (moyenne ou « — »), Abonnés
- [ ] Bouton « MODIFIER »
- [ ] Menu : Mes commandes, Mes ventes, Mes échanges, Porte-monnaie, Mes articles, Mes favoris, Vendeurs aimés, Recherches sauvegardées, Paramètres, Aide
- [ ] Chaque item : couleur icône + fond distinct
- [ ] Bouton « SE DÉCONNECTER » style danger
- [ ] Version affichée (« Version 1.0.0 »)
- [ ] Scroll fluide, icônes animées en cascade
- [ ] **Périmètre actuel** : l'item « Porte-monnaie » reste présent mais l'écran restera vide (voir bloc hors scope ci-dessous)

#### Édition & Sign Out
- [ ] Tap « MODIFIER » → `/settings/profile-details`
- [ ] « SE DÉCONNECTER » → confirmation alert
- [ ] Annuler → reste sur profil ; Confirmer → haptic warning, déconnexion, retour auth
- [ ] **Hotspot** : déconnexion réinitialise bien tous les stores

#### États à vérifier
- [ ] Chargement stats (skeleton)
- [ ] Erreur réseau (stats manquantes → « — »)
- [ ] Photo profil manquante (avatar par défaut)
- [ ] Bio vide (n'affiche rien)
- [ ] Articles/ventes 0 (affiche « 0 »)
- [ ] Pas noté (affiche « — »)

### Profil Public (`app/user/[id].tsx`)

**Préconditions :** Invité OU connecté ; profil public (articles, avis, stats).

#### Consultation profil public (invité)
- [ ] Chargement : skeleton
- [ ] Utilisateur inexistant → « Utilisateur introuvable »
- [ ] Header + Avatar + Bio + Stats (Articles, Ventes, Note moyenne, Avis)
- [ ] Tabs sticky (Articles, Avis)
- [ ] Articles en grille (max 4/ligne)
- [ ] Avis listés (photo reviewer, note, date, texte)
- [ ] Share + More (share/report/block) ; Contact + Follow (locked → login)

#### Propre profil public (connecté)
- [ ] Même layout MAIS bouton « MODIFIER » au lieu de Contact/Follow
- [ ] Pas de Share/More
- [ ] Onglets affichent vraies données ; stats directes Firestore

#### Profil autre vendeur (connecté)
- [ ] Header + Stats + Share + More + Contact + Follow
- [ ] Contact → crée/ouvre chat → `/chat/{chatId}`
- [ ] Follow → toggle optimiste (useSellerLikes) puis persist
- [ ] Share → OS share dialog
- [ ] More → Partager / Signaler (ReportBottomSheet) / Bloquer (confirmation → ModerationService.blockUser)
- [ ] **Hotspot** : Follow toggle optimiste ET reflète état réel après refresh

#### Signaler / Bloquer
- [ ] ReportBottomSheet (catégories arnaque, contenu offensant, spam…)
- [ ] Soumettre → ferme sheet + toast
- [ ] **Hotspot P0-4** : signalement utilisateur envoyé sans erreur (undefined → Firestore)
- [ ] Bloquer → confirmation → blockUser() → success → retour profil
- [ ] Utilisateur bloqué disparaît de liked-sellers
- [ ] **Hotspot** : utilisateur bloqué ne voit plus mes articles (backend)

#### États à vérifier
- [ ] Profil inexistant (404), skeleton, stats manquantes (N/A), empty states
- [ ] Réseau offline → erreur réseau
- [ ] iOS vs Android : Share dialog natif

### Paramètres — Menu (`app/settings/index.tsx`)
**Préconditions :** Connecté (invité redirigé vers profile). Données : hasPassword, isEmailVerified, isAdmin.

- [ ] Sections : Compte (Détails, Email, Vérifier email si password+non-vérifié, Téléphone, Mot de passe OU Ajouter mot de passe)
- [ ] Envoi & Livraison : Mon adresse (Options livraison **masquée** car `SHIPPING_ENABLED=false`)
- [ ] Personnalisation : Mes préférences
- [ ] **Périmètre actuel** — la section « Paiements » (Compte de paiement Stripe + Mon porte-monnaie) reste **affichée** dans le menu (aucune condition sur `SHIPPING_ENABLED`). Vérifier sa présence visuelle, mais les écrans cibles sont hors scope / vides (voir bloc hors scope ci-dessous). **Piège connu** : le menu laisse croire que le paiement en ligne et les payouts sont actifs alors que tout passe en meetup cash.
- [ ] Notifications & Confidentialité
- [ ] Assistance : Aide, À propos
- [ ] Administration (si admin) → `/admin/shops`
- [ ] Zone de danger : Supprimer mon compte
- [ ] Version affichée
- [ ] Tap chaque item → route correcte (sauf items hors scope, à vérifier dans leur bloc dédié)
- [ ] useFocusEffect met à jour hasPassword + isEmailVerified au focus
- [ ] hasPassword=true → « Mot de passe » ; false → « Ajouter mot de passe »
- [ ] isEmailVerified+hasPassword → cache « Vérifier email »
- [ ] isAdmin → « Administration » ; **`SHIPPING_ENABLED=false` → « Options de livraison » masquée (confirmé `index.tsx:152`)**

### Édition Détails Profil (`app/settings/profile-details.tsx`)
**Préconditions :** Connecté. Données : displayName, bio, profileImage.

- [ ] Tap image/« Changer la photo » → ImagePicker (permission, ratio 1:1, quality 0.8)
- [ ] Nouvelle image affichée immédiatement (local preview)
- [ ] Nom : max 50 car, lettres/espaces/tirets/apostrophes, trim, empty → error
- [ ] Bio : max 200 car, compteur, multiline, optionnel
- [ ] Save : upload image (si file:// ≠ user.profileImage) → updateUserProfile → Auth displayName → refreshUser → invalidate caches → success alert → back
- [ ] Erreur : permission-denied / not-found / autres → messages appropriés
- [ ] États : photo manquante, nom vide, caractères invalides, bio vide, loading spinner, erreur réseau
- [ ] **Hotspot upload photos** : image locale (file://) bien uploadée Storage ET URL en Firestore (pas seulement local), persiste après reload, pas de 404

### Email (`app/settings/email.tsx`)
_Voir aussi section 1.6._
- [ ] Password user : email actuel + 2 inputs email + password + eye toggle, validation (emails remplis+identiques, password fourni)
- [ ] Save → reauthenticate(password) → updateEmail → email vérification → alert → back
- [ ] Social provider : « Se reconnecter avec [provider] » → success checkmark → Enregistrer activé
- [ ] Apple sur Android : si pas password → « Ajoutez un mot de passe » ; si password → demande password
- [ ] Provider inconnu → « Déconnectez-vous et reconnectez-vous »
- [ ] États : emails vides/non-correspondants → error, reauth échouée/réussie, loading, offline

### Vérification Email (`app/settings/verify-email.tsx`)
_Voir aussi section 1.7._
- [ ] Email non vérifié → warning icon + email + description + « Envoyer l'email »
- [ ] Envoi → sendEmailVerification → alert → state « Email envoyé » + « J'ai vérifié mon email » + « Renvoyer »
- [ ] Cliquer lien mail → revenir → « J'ai vérifié » → reloadUser → isEmailVerified
- [ ] Si vrai → « Email vérifié ! » → back ; si faux → « Pas encore vérifié »
- [ ] États : initial loading, emailSent, resend loading, success, warning, offline

### Mot de Passe (`app/settings/password.tsx`)
_Voir aussi section 1.9._
- [ ] 3 inputs (actuel/nouveau/confirmer) + eye toggles
- [ ] Validation : 3 remplis, nouveau ≥6, nouveau=confirm
- [ ] Save → reauthenticate(current) → updatePassword → alert → back
- [ ] États : champs vides, trop court, non-identiques, actuel incorrect (reauth error), offline

### Ajouter un mot de passe (`app/settings/add-password.tsx`)
_Voir aussi section 1.8._
- [ ] 3 inputs (email pré-rempli éditable, password ≥6, confirmer) + eye toggles
- [ ] Tap → linkPasswordCredential → success alert → back
- [ ] requires-recent-login → « Reconnexion récente requise » + « Se reconnecter » → reauthWithGoogle/Apple → relance link
- [ ] États : champs vides, mdp <6, non-identiques, requires-recent-login, offline

### Téléphone (`app/settings/phone.tsx`)
**Préconditions :** Connecté. Données : phoneNumber (sans +1).
- [ ] Info box sécurité + input prefix « CA +1 » badge + placeholder « (514) 555-1234 » + keyboardType phone-pad
- [ ] Formatage (XXX) XXX-XXXX ; validation 10 chiffres canadiens
- [ ] Save → updateUserProfile(phoneNumber: « +1 »+digits) → refreshUser → alert → back
- [ ] Erreur : « Veuillez entrer un numéro valide (10 chiffres) »
- [ ] États : vide (<10), format → stocké +15145551234, affichage reload (514) 555-1234, offline

### Adresse (`app/settings/address.tsx`)
**Préconditions :** Connecté. Données : address (street, city, province, postalCode, country).
- [ ] Mode Google Places : adresse actuelle en card + input recherche + autocomplete (fr, address, country:ca)
- [ ] Tap suggestion → PlaceDetails → parse (street, city, province short, postalCode) → confirmation alert → persistAddress → refreshUser → alert → back
- [ ] Mode Manual : « Saisir manuellement » → inputs (Adresse, Ville, Province 2 lettres uppercase défaut QC, Code postal uppercase) → validation tous remplis → persistAddress → alert → back
- [ ] États : pas d'adresse (info box), adresse existante (card), Google Places timeout, manual validation, offline
- [ ] **Hotspot Google Places API** : clé valide, requêtes réussissent dev/prod
- [ ] **Périmètre actuel** : l'adresse n'est plus utilisée pour l'expédition (meetup seul) — elle reste collectée pour le profil, vérifier qu'aucun écran ne la présente comme adresse de livraison

### Préférences (`app/settings/preferences.tsx`)
**Préconditions :** Connecté. Données : preferences.sizes, shoesSizes, favoriteBrands.
- [ ] Tailles vêtements [XS-XXL] toggles (multi)
- [ ] Tailles chaussures [35-46] toggles (multi)
- [ ] Save → updateUserPreferences
- [ ] Marques : « Ajouter des marques » → BrandSelectionSheet → multi-select → confirme → marques affichées → save
- [ ] États : aucune sélection OK, chargement skeleton, save success alert
- [ ] **Hotspot P1 « Pour toi »** : vérifier que tailles écrites en `{value,system}` (pas `string[]`) pour matching correct

### Notifications (`app/settings/notifications.tsx`)
_Voir aussi section 13._
- [ ] Toggles : push, email, nouveaux messages, nouvelles ventes, baisses de prix, articles favoris, propositions d'achat, réponses aux offres
- [ ] swapZoneReminder en base mais PAS affiché (hidden on purpose)
- [ ] Toggle optimiste immédiat + sauvegarde Firestore
- [ ] Permissions iOS/Android (API 33+) ; si refusée → message paramètres téléphone
- [ ] États : chargement skeleton, toggles synchronisés DB, permission denied (UI accessible), push disabled warning, offline (changements locaux)
- [ ] **Hotspot push iOS** : in-app OK, push hors-app NON reçu iOS (known issue, pas un bug QA)
- [ ] **Périmètre actuel** : aucune notif d'expédition/suivi ni de payout ne doit être déclenchée (flows associés hors scope)

### Confidentialité (`app/settings/privacy.tsx`)
_Voir aussi section 15.1._
- [ ] Toggles privacy-by-default OFF : Afficher profil publiquement, Recommandations IA (Gemini/Vertex), Communications marketing (LCAP art. 14)
- [ ] Marketing ON → setMarketingConsentFn(true) (logs consents append-only) ; OFF → logs retrait
- [ ] États : tous OFF par défaut, toggle local immédiat, cloud function, offline sync

### Utilisateurs Bloqués (`app/settings/blocked-users.tsx`)
_Voir aussi section 15.4._
- [ ] Chargement skeleton ; liste (avatar, nom live fallback snapshot, « Bloqué le [date] », « Débloquer »)
- [ ] Empty state « Aucun utilisateur bloqué » + info box
- [ ] Débloquer → confirmation → unblockUser → suppression optimiste ; erreur → rollback + alert

### Exporter Données (`app/settings/export-data.tsx`)
_Voir aussi section 15.2._
- [ ] Info RGPD (Loi 25 + LPRPDE) + liste (Profil, Articles, Favoris, Notifications, Messages) + format JSON
- [ ] « Exporter » → exportUserData → writeAsStringAsync → shareAsync → success « Export réussi » → « Exporter à nouveau »
- [ ] Sharing unavailable → « Export indisponible sur cet appareil »
- [ ] États : chargement spinner, success, sharing unavailable, offline

### Supprimer Compte (`app/settings/delete-account.tsx`)
_Voir aussi section 1.10 et 15.3._
- [ ] Étape 1 Info : warning, « Ce qui sera supprimé », « Ce qui sera conservé » (conversations anonymisées), info RGPD, Continuer/Annuler
- [ ] Étape 2 Confirmation : réauthentification par provider, input « SUPPRIMER », bouton gated (reauthDone + input='SUPPRIMER')
- [ ] Tap → deleteUserAccountFn (callable, pas AuthService.deleteAccount) → success resetAllStores + router.replace('/')
- [ ] failed-precondition (solde pending, dispute, seller debt, transaction active) → message serveur exact FR
- [ ] **Hotspot gardes financiers** : solde gelé/dispute/transaction/dette → refus avec message précis. _Note périmètre actuel : sans paiement en ligne, le solde wallet et la dette vendeur restent normalement à 0 ; vérifier surtout les gardes « transaction active » (meetup en cours) et « dispute »._

### À Propos / Aide / Légal
- [ ] **About** (`/settings/about`) : logo + tagline + version + liens (terms, privacy-policy, legal-notice) + « © 2026 Seconde »
- [ ] **Help** (`/settings/help`) : info box + FAQ expandables (vendre, frais port, paiement, swap, sécurité) + « Contactez-nous » mailto. _Périmètre actuel : vérifier que les FAQ « frais de port » / « paiement » ne promettent pas un flux d'expédition ou de paiement en ligne actif (sinon copy à corriger)._
- [ ] **Terms / Privacy-Policy / Legal-Notice** : contenu statique, scroll fluide, back fonctionnel

### Points Chauds Transversaux Profil/Réglages
- [ ] **Hotspot 1 Upload photos** : image locale uploadée Storage + URL Firestore, persiste après reload, pas de 404
- [ ] **Hotspot 2 Push iOS** : in-app OK, push hors-app NON iOS ; Android push ?
- [ ] **Hotspot 3 SHIPPING_ENABLED=false** : shipping-options inaccessible, meetup seul, frais 0
- [ ] **Hotspot 4 No-show meetup** : états cancellation (affecte transaction/article ; pas de refund financier en meetup cash)
- [ ] **Hotspot 5 Blocage messagerie** : bloqué ne peut plus envoyer ni voir mes articles ; déblocage OK (vérifier serveur)
- [ ] **Hotspot 6 Suppression + gardes financiers** : transaction active / dispute → refus message exact (solde/dette normalement 0 en meetup)
- [ ] **Hotspot 7 Recherche migration index** : « Mes articles » charge correctement (staging si applicable)
- [ ] **Hotspot 8 Boutiques self-service** : flow non câblé (pas de régression profil)
- [ ] **Hotspot 9 Ré-auth sociale persistante** : identité reste vérifiée durant le flow (reauth → step2 → back → step2 → re-auth requise ?)
- [ ] **Hotspot 10 Privacy-by-default Loi 25** : showProfilePhoto / aiProfilingConsent / marketingConsent tous OFF par défaut

#### ⏭️ HORS SCOPE ACTUEL (réactivable)

> Réglages liés au **paiement en ligne / expédition / payouts**, inaccessibles ou inertes tant que `SHIPPING_ENABLED=false` (config/featureFlags.ts) et que les ventes se règlent en meetup cash/virement hors app. Code conservé pour réactivation — cases gardées, à ne pas tester pour l'instant.

##### Paiements — Compte de paiement Stripe + Porte-monnaie (menu `app/settings/index.tsx:171-184`)
> ⏭️ HORS SCOPE — Le bloc « Paiements » reste visible dans le menu, mais ses cibles relèvent du paiement en ligne / payouts (sans ventes en ligne, aucun solde ni payout ne s'active). **Piège** : envisager de masquer ou d'expliquer ce bloc tant que le meetup cash est le seul mode.
- [ ] Tap « Compte de paiement » → `/settings/stripe-onboarding` (voir bloc Onboarding Stripe ci-dessous)
- [ ] Tap « Mon porte-monnaie » → `/wallet` (écran accessible mais **vide** : aucun crédit de vente en meetup cash)

##### Porte-monnaie alimenté en ligne (`/wallet`)
> ⏭️ HORS SCOPE — L'écran s'ouvre mais ne reçoit jamais de fonds en meetup cash. **Piège UX** : recommander un empty-state expliquant « meetup = règlement direct, pas de solde en app ». Tests payouts/retraits couverts en section 10.
- [ ] Écran wallet accessible, n'affiche aucun crédit de vente (solde 0)
- [ ] CTA d'activation Stripe affiché si stripeAccountId / stripePayoutsEnabled absent (mais inutile en meetup cash)

##### Options Livraison (`app/settings/shipping-options.tsx`)
> ⏭️ HORS SCOPE — `SHIPPING_ENABLED=false` : page jamais atteignable depuis le menu (item masqué `index.tsx:152`), expédition désactivée au profit du meetup.
**Condition :** SHIPPING_ENABLED=true (sinon section jamais visible).
- [ ] Toggles transporteurs (Postes Canada, UPS, Penguin, Remise main propre) optimistes → updateUserPreferences(shippingCarriers)
- [ ] **Hotspot SHIPPING_ENABLED=false** : page inaccessible, seul meetup (cash hors-app), frais port=0, options non affichées à la création

##### Onboarding Stripe (`app/settings/stripe-onboarding.tsx`)
> ⏭️ HORS SCOPE — Onboarding Stripe Connect + ajout de compte bancaire. Écran encore accessible depuis le menu Paiements et fonctionnel, MAIS inutile : sans ventes en ligne, les payouts ne s'activent jamais (règlement meetup cash). Détails et payouts en section 10.
_Voir aussi section 10._
- [ ] Garde-fou ≥18 ans (canSell) ; query getStripeAccountStatus (hasAccount, chargesEnabled, detailsSubmitted, requirements)
- [ ] Form : infos perso (nom, DOB jour/mois/année), adresse (rue, ville, province dropdown, CP A1A 1A1), bancaire (routing, account) optionnel
- [ ] Validation : ≥18, CP regex ; createStripeConnectAccount + addBankAccount → success/error
- [ ] États : chargement skeleton, <18 refus, validation complète, CP invalide, offline

##### Paiements (placeholder) (`app/settings/payments.tsx`)
> ⏭️ HORS SCOPE — Écran de cartes enregistrées (paiement en ligne). Sans checkout Stripe, aucune carte n'est utilisée.
- [ ] Info box sécurité + « Cartes enregistrées » + empty « Aucune carte » + hint « bientôt disponible »
- [ ] Aucun bouton d'action, placeholder correct

---

## 3. Vente / Mise en vente

_Routes : `app/sell/{capture,photos-review,details,pricing,preview}`, `app/(tabs)/sell`, `app/my-articles`, `app/article/edit/[id]`._

Tunnel 5 écrans linéaires : Capture → Photos-Review (+IA) → Détails → Pricing → Preview. Accès réservé aux membres connectés (gate `_layout.tsx`). 1 seul brouillon local (14j). Publication : serveur re-valide TOUT (incl. email vérifié).

> ℹ️ **Périmètre actuel (SHIPPING_ENABLED=false)** : la vente reste IN SCOPE en **main-à-main uniquement**. Le bloc expédition est masqué dans `pricing.tsx` (ligne 242) et tout brouillon legacy « expédition » est ramené au main-à-main (`pricing.tsx` lignes 77-80). Les cases ci-dessous qui mentionnent « expédition masquée / désactivée » sont des **tests de vérification du masquage** (in scope), pas des tests d'expédition. La config est réversible via `config/featureFlags.ts:17`.

### Écran 1 — Capture photos (`app/sell/capture.tsx`)
**Préconditions :** Connecté, caméra OU galerie, permission caméra demandée au montage.
- [ ] Vide : compteur « 0/5 », bouton Continuer désactivé
- [ ] Chargement : spinner après capture/import
- [ ] Erreur permission caméra : écran fallback « Accès refusé » + bouton Galerie
- [ ] Erreur galerie : toast
- [ ] Succès 1 photo : vignette, « 1/5 », Continuer activé, brouillon persiste
- [ ] Succès 5 photos : badge « Maximum atteint », capture désactivée, galerie dispo
- [ ] Réorganisation drag-drop : 1ère vignette → 3e, ordre persiste après recharge
- [ ] Suppression : croix, compte↓, si dernière → Continuer désactivé
- [ ] Quitter avec photos → modale « Brouillon sauvegardé »
- [ ] iOS : HEIC/HEIF → JPEG auto ; Android : redimensionnement système
- [ ] **Point chaud upload+IA** : statut « En cours d'analyse » dès photos-review, storageUrls se remplit

### Écran 2 — Photos & Analyse IA (`app/sell/photos-review.tsx`)
**Préconditions :** ≥1 photo, quota IA 10/h, délai max ~90s, auto-déclenché 1 fois.
- [ ] Idle : grille photos, aucune étape, Continuer désactivé (ou Réanalyser si déjà analysée)
- [ ] Chargement : spinner + étapes animées, photos non supprimables, Continuer désactivé
- [ ] Erreur upload Storage : toast « Erreur téléversement », relance auto
- [ ] Erreur IA (timeout >90s) : « Erreur lors de l'analyse » + Réessayer
- [ ] Quota dépassé (11e) : toast « Quota 10 analyses/h » + « Remplir manuellement »
- [ ] Succès : toutes étapes done, badge « IA » sur chaque champ, photo principale
- [ ] Ajout/suppression photos avant analyse : libre ; pendant analyse : bloqué (UI grisée)
- [ ] **Point chaud IA** : 1) lancer analyse, 2) spinner actif, 3) fin (~30-90s), 4) badge IA + titre/catégorie pré-remplis
- [ ] Reprise brouillon analyse complète → pas de re-analyse auto

### Écran 3 — Détails (`app/sell/details.tsx`)
**Préconditions :** Analyse complète (ou remplir manuellement). Validations : titre ≥1, description ≥1, ≥1 catégorie.
- [ ] Vide : tout vide sauf défauts IA, Continuer désactivé
- [ ] Pas de spinner (données locales)
- [ ] Catégorie vide / Titre vide / Description vide → Continuer désactivé
- [ ] Titre + description + catégorie remplis → Continuer activé
- [ ] Auto-sauvegarde : changements persistent après recharge (debounce ~500ms)
- [ ] Couleurs multi (chips, suppression « × ») ; Taille système (EU/US) cohérente catégorie
- [ ] **Point chaud email non vérifié** : gate `_layout.tsx` ne vérifie PAS `email_verified` → tester compte email+password non vérifié → parcourir 5 écrans → Error 403 à la publication (Google/Apple OK car auto-vérifié)
- [ ] **Race condition auto-save** : saisie rapide → perte occasionnelle (stale closure)

### Écran 4 — Prix & Livraison (`app/sell/pricing.tsx`)
**Préconditions :** Détails saisis. ⚠️ SHIPPING_ENABLED=false : bloc expédition masqué, main-à-main forcée, brouillons legacy « expédition » → meetup.
- [ ] Vide : prix vide, aucun quartier, Continuer désactivé
- [ ] Prix invalide (<0,01 ou >10 000$) → inline error, Continuer désactivé ; prix=0 rejeté
- [ ] Main-à-main : ≥1 quartier sélectionné, chips visibles
- [ ] Aucun quartier → Continuer désactivé
- [ ] Expédition masquée (SHIPPING_ENABLED=false) : bloc absent
- [ ] Valide : prix + quartier(s) → Continuer activé
- [ ] **Point chaud expédition désactivée** : bloc invisible, main-à-main forcée, brouillon legacy converti, aucune option ShipEngine ; tester brouillon pré-désactivation (shipping) → reprendre → main-à-main seul
- [ ] **Point chaud parsing prix FR-CA (P1-6)** : saisir `45,50` → confirmer parsé en 45.50 (pas 4550)
- [ ] **Discordance prix front/back (H3)** : 0,005$ accepté front → error « ≥ 0,01 » au publish

### Écran 5 — Aperçu & Publication (`app/sell/preview.tsx`)
**Préconditions :** Écrans complétés, email vérifié (serveur seulement).
- [ ] Chargement : spinner createArticle, Publier grisé
- [ ] Erreur email non vérifié : toast « Email non vérifié, vérifiez votre boîte mail »
- [ ] Erreur serveur 500 : toast « Erreur lors de la publication »
- [ ] Succès : modale « Votre article est publié ! » + « Voir l'article » / « Accueil »
- [ ] Carrousel photos swipeable, photo principale, badges OK
- [ ] Modifier → retour `details`, champs persistent
- [ ] Double-clic Publier : bloqué (publishingRef)
- [ ] **Point chaud email non vérifié CRITIQUE** : gate ne vérifie pas → 5 écrans puis rejet ; brouillon persiste pour retry ; Google/Apple OK

### Mes articles (`app/my-articles.tsx`)
**Préconditions :** Connecté.
- [ ] Vide : « Aucun article en vente » + bouton « Vendre un article »
- [ ] Chargement : skeleton ; erreur réseau : banner + Réessayer
- [ ] Filtres Tous / En vente / Vendus (persistent après reload)
- [ ] 1 article en vente → filtre En vente, absent de Vendus
- [ ] Swipe droit (iOS) / actions (Android) : Modifier / Supprimer
- [ ] Modifier → écran edit ; Marquer vendu → disparaît En vente, apparaît Vendus
- [ ] Supprimer → modal confirm → article disparu (soft-delete isActive=false)
- [ ] Remettre en vente → revient En vente
- [ ] Refresh-control : swipe down rafraîchit
- [ ] **Point chaud** : modif article vendu/transaction en cours → rejet serveur ; supprimer = soft-delete (pas destruction DB)

### Édition d'article (`app/article/edit/[id].tsx`)
**Préconditions :** Propriétaire, article non vendu, pas de transaction active, email vérifié.
- [ ] Chargement skeleton
- [ ] Article vendu : « Impossible de modifier article vendu » + Retour
- [ ] Champs éditables : titre, description, prix, catégorie, couleurs, matières, taille
- [ ] Ajout photos galerie multi → vignettes ; suppression croix
- [ ] Baisse de prix (50$→40$) : enregistre original + % ; affichage public « Prix réduit »
- [ ] Enregistrer : spinner, bouton grisé ; succès toast vert + refresh
- [ ] Erreur propriété : « Vous ne pouvez pas modifier cet article »
- [ ] Erreur transaction en cours : « Impossible de modifier (transaction en cours) »
- [ ] **Point chaud Photos locales cassées (C3/P-IMG)** : ajout photo galerie → enregistrer → vérifier article public + autre user voient images (ou cassées/placeholder). Fix : upload Storage AVANT callable
- [ ] **Discordance limit photos (5 front vs 10 back — H1)** ; **prix (0,005$ — H3)**

### Brouillon & Reprise (DraftResumeModal)
**Préconditions :** Brouillon ≤14j en AsyncStorage.
- [ ] Aucun brouillon : modale non affichée, accès `capture`
- [ ] Brouillon valide (<14j) : modale (titre/étape/jours)
- [ ] Brouillon expiré (≥14j) : auto-suppression, modale ignorée
- [ ] Vignette présente (Storage ou fallback local) / absente (placeholder)
- [ ] Reprendre étape 2/3/4/5 → rouvre écran correspondant avec données
- [ ] Abandonner → brouillon supprimé local + Storage, modale fermée
- [ ] **Point chaud Cleanup Storage incomplet (M2)** : brouillon expiré + offline (uid=null) → images Storage non supprimées (cleanup backend après 24h, acceptable)

### Flows transversaux Vente
- [ ] **Brouillon multi-étape** : quitter mid-tunnel → persiste → reprendre étape exacte + données → publier OK
- [ ] **Upload photos + IA** : 1 photo (~5s) / 5 photos (parallèle ~10-15s, tous storageUrls peuplés) ; timeout retry ; quota 11e
- [ ] **Email non vérifié → publication échouée** : email+password non vérifié → 5 écrans → publish error « Email non vérifié », brouillon persiste ; Google/Apple OK
- [ ] **Édition + photos cassées (C3)** : ajout photos → enregistrer → vérifier Storage + autre user
- [ ] **Meetup vs expédition (SHIPPING_ENABLED)** : false → bloc expédition invisible, main-à-main forcée, brouillon legacy converti, pas d'option checkout

### Récap hotspots prioritaires Vente
- [ ] 🔴 Upload photos + Analyse IA (Storage + timeout + race navigation)
- [ ] 🔴 Email non vérifié → rejet publication (frustration 5 écrans)
- [ ] 🔴 Photos locales cassées en édition (C3)
- [ ] 🔴 Brouillon mono-device (H6 : non synchro multi-device)
- [ ] 🟡 Expédition désactivée (SHIPPING_ENABLED=false)
- [ ] 🟡 Prix validation front/back (H3 : 0,005$)
- [ ] 🟡 Photos limit 5 front vs 10 back (H1)
- [ ] 🟡 Description maxLength 500 front vs 5000 back (H2)
- [ ] 🟢 Race condition auto-save (M1)
- [ ] 🟢 Photos orphelines brouillon expiré + offline (M2)

---

## 4. Accueil, Découverte & Favoris

> ✅ **PÉRIMÈTRE ACTUEL — IN SCOPE intégral.** Accueil/découverte/favoris/recherche visuelle/cœur favori/teaser SwapZone/cartes vendeurs sont tous accessibles et testables avec `SHIPPING_ENABLED=false`. Aucune case déplacée hors scope : cette section ne contient aucun flux shipping/checkout Stripe/payout/wallet alimenté/boutique. La mention « expédition désactivée » (test Force majeure) reflète déjà l'état actuel (cf. `config/featureFlags.ts` → `SHIPPING_ENABLED = false`) et reste pertinente. Le teaser SwapZone (navigation `/swap-zone`, sans cash top-up) est in-scope.

_Routes : `app/(tabs)/index.tsx`, `app/(tabs)/favorites.tsx`, `app/liked-sellers.tsx`, `features/home/*`, `components/{ProductCard,ProductGrid}.tsx`._

### Accueil (Home) (`app/(tabs)/index.tsx`)
7 sections virtualisées : Tendances, Nouveautés, Pour toi, SwapZone, Baisses de prix, Vendeurs en vedette, Découvrez.

#### État vide / chargement
- [ ] 7 sections chargées progressivement (FlashList, CF froide limitée)
- [ ] Section invisible en viewport = 0 CF appelée
- [ ] En-tête (recherche + caméra + cloche + raccourcis catégories) toujours visible
- [ ] Chargement : SkeletonCard par section (grille 2 colonnes, 6 cartes)
- [ ] Scroll → sections entrantes lancent leur CF

#### État succès
- [ ] Tendances : top 10 marques (fraîcheur ~1h) + compteur articles
- [ ] Nouveautés : 10 plus récents (createdAt desc, ~10 min)
- [ ] Pour toi : visible SEULEMENT si connecté OU invité avec préférences
- [ ] SwapZone : bande sombre + « N échanges cette semaine » cliquable
- [ ] Baisses de prix : triés % décroissant
- [ ] Vendeurs en vedette : top 20 (sellerLikesCount desc)
- [ ] Découvrez : grille infinie 20/page, scroll → page suivante

#### Pull-to-refresh
- [ ] **HOTSPOT P2-19** : ABSENT sur Home (contrairement aux autres onglets)
- [ ] queryKeys homeKeys.all invalidés ; sections rechargées (staleTime ~10min-1h)

#### Erreur / recherche visuelle / tap / scroll-to-top
- [ ] Section CF échoue → SectionErrorBoundary silent (rien, pas de Réessayer)
- [ ] Scroll vers autres sections OK (isolation)
- [ ] Caméra → Modal VisualSearchCamera → capture → upload+Gemini → résultats
- [ ] Tap ProductCard → `/article/{id}`
- [ ] Cœur invité → auth sheet ; connecté → optimistic + écrit `favorites/{userId}.articleIds`
- [ ] Re-tap Home tab → scroll offset 0

#### iOS vs Android Home
- [ ] iOS : tab bar absolute, paddingBottom 144px, haptique tab
- [ ] Android : tab bar non-absolute, paddingBottom 144px, pas de haptique

### Section Tendances (`TrendingBrandsSection.tsx`)
- [ ] Chargement : compact skeleton (180px, ratio 4/3)
- [ ] 10 cartes marques (majuscules « NIKE ») + vignette, scroll horizontal
- [ ] Tap → `/article/{id}` exemple marque ; pas de cœur (design épuré) ; fraîcheur ~1h
- [ ] <10 marques → nombre trouvé ; 0 marques → section invisible ; erreur → silent

### Section Nouveautés (`NewArrivalsSection.tsx`)
- [ ] 10 cartes 4/3 scroll horizontal ; marque + prix + taille/condition
- [ ] Cœur favori (auth gate invité) ; fraîcheur ~10 min
- [ ] **HOTSPOT P2-1** : même requête que Découvrez (createdAt desc) → redite visuelle en scroll

### Section Pour toi (`PourToiSection.tsx`)
- [ ] User connecté sans profil → section invisible
- [ ] Invité avec onboarding → section INVISIBLE (guest_preferences jamais relue — HOTSPOT P2-3)
- [ ] User sans consentement IA → seule marque alimente le feed (styleProfile jamais généré — HOTSPOT P2-5)
- [ ] Cartes compactes (160px) scroll horizontal ; marque + prix + taille/condition ; cœur
- [ ] **HOTSPOT P1-11** : wrapper 160px < carte 180px → chevauchement 12px inter-cartes
- [ ] **HOTSPOT P1-1** : tailles string[] au lieu de {value,system} → matching échoue → section invisible
- [ ] Recherche 0 → masquée ; erreur → silent
- [ ] **HOTSPOT feed jamais rafraîchi** : useState/useEffect sans React Query, figé jusqu'au remount

### Section SwapZone (`SwapZoneSection.tsx`)
- [ ] Bande sombre + texte blanc + « N échanges cette semaine » → `/swap-zone`
- [ ] Teaser non-cliquable si zone vide ; 0 échanges → « 0 » ou masqué
- [ ] **HOTSPOT P3-2** : compteur plafonne à 6 client vs badge vrais itemsCount

### Section Baisses de prix (`PriceDropsSection.tsx`)
- [ ] Cartes compactes scroll horizontal + pastille « −XX % » (rouge)
- [ ] Ancien prix barré gris, nouveau rose ; fraîcheur ~10 min
- [ ] 0 articles → invisible ; erreur → silent

### Section Vendeurs en vedette (`FeaturedSellersSection.tsx`)
- [ ] Cartes compactes (avatar + nom + « N articles ») scroll horizontal
- [ ] Cœur suivi (useSellerLike) : invité → requireAuth (HOTSPOT P2-12 message « Coups de cœur » devrait être « suivi »)
- [ ] Connecté : optimistic + CF toggleSellerLike
- [ ] **HOTSPOT P1-7** : pas de garde anti-auto-suivi côté CF → vendeur peut s'incrémenter
- [ ] Tap → `/user/{sellerId}` ; fraîcheur ~30 min
- [ ] 0 vendeurs → invisible ; erreur → silent

### Section Découvrez (`DiscoverGrid.tsx`)
- [ ] Chargement : skeleton grid 2 colonnes (6-12)
- [ ] Grille 2 colonnes articles actifs/non vendus ; scroll → page suivante (intersection dernier article)
- [ ] Pagination spinner en bas ; marque + prix + taille/condition + cœur
- [ ] **HOTSPOT P2-2** : erreur réseau → « Aucun article trouvé » (faux vide, pas de Réessayer)
- [ ] Zéro articles → vide légitime
- [ ] **HOTSPOT P2-16** : grille NON virtualisée (FlashList enfant de FlashList, .map non recyclé) → perte perf

### Mes favoris (`app/(tabs)/favorites.tsx`)
**Préconditions :** Connecté (invité → empty + SE CONNECTER).
- [ ] Non connecté : « Connectez-vous pour retrouver vos favoris » + « SE CONNECTER » → AuthBottomSheet
- [ ] Connecté vide : cœur vide 64px + « Aucun favori » + « Les articles que vous aimez… » + « Parcourir »
- [ ] Connecté succès : grille 2 colonnes + en-tête « Mes favoris » + compteur
- [ ] **HOTSPOT P3-7** : compteur diverge de la grille (total articleIds.length vs pages chargées)
- [ ] **HOTSPOT P3-6** : pull-to-refresh ABSENT (ProductGrid ne passe pas onRefresh)
- [ ] Long-press article → retire favori (optimistic + feedback)
- [ ] **HOTSPOT P2-8** : >500 favoris → ajout échoue silencieusement (cap rules Firestore)
- [ ] Scroll → page suivante ; pagination spinner
- [ ] **HOTSPOT P2-6** : article soft-deleted → favori fantôme cliquable (pas de filtre isActive)
- [ ] Article sold → favori lisible, détail « Vendu »
- [ ] Cœur grille plein rose ; long-press → toggleFavorite ; animation scale + fade

### Vendeurs aimés (`app/liked-sellers.tsx`)
**Préconditions :** Connecté. **HOTSPOT P1-6 : aucun point d'entrée dans l'app** (route existe, 0 lien).
- [ ] Empty : cœur vide 48px + « Aucun vendeur suivi » + « Explorez les vendeurs… »
- [ ] Succès : liste verticale cards (avatar + nom + stats) + en-tête « Vendeurs suivis » + badge
- [ ] Card cliquable → `/user/{sellerId}` ; cœur toggle suivi (optimistic + CF toggleSellerLike, animation scale)
- [ ] Scroll FlashList + séparateurs gris
- [ ] **HOTSPOT P2-13** : 2 query-keys (likedIds vs liked list) → desync transitoire
- [ ] Erreur load → aucune gestion (grille vide sans Réessayer)

### ProductCard & ProductGrid
- [ ] **ProductCard normal** : image 4:3 (no border, radius 0), marque minuscule gris, titre 1 ligne, footer (prix rust + taille pill + condition pill), cœur haut-droite, badge « VENDU » si isSold
- [ ] **Compact variant** : rails Home, width 180px (HOTSPOT P1-11 wrapper PourToi 160px → chevauchement)
- [ ] **Cœur favori** : outline gris / plein rose ; tap → toggleFavorite (useFavorites)
- [ ] **HOTSPOT P1-3** : toggleFavorite écrit favorites/{userId}.articleIds mais CF toggleProductLike jamais appelée → compteur likes figé 0
- [ ] **HOTSPOT P1-4** : ArticleDetails article.likes toujours 0
- [ ] Invité + tap cœur → requireAuth (message « Coups de cœur »)
- [ ] **HOTSPOT P2-9** : champ likes passé mais JAMAIS affiché JSX ; distance « N km » idem (données mortes)
- [ ] **ProductGrid chargement** : 6-12 SkeletonCard (2 colonnes)
- [ ] **ProductGrid succès** : 2 colonnes gap 1px, width=(screenWidth-gap)/2
- [ ] **HOTSPOT P3-12** : Dimensions.get('window') figé au chargement (risque split-screen/foldable Android)
- [ ] Padding bas variable (144/100/32/8 px = magic numbers)
- [ ] **Pull-to-refresh** : Home ABSENT (P2-19), Favoris ProductGrid invoqué mais onRefresh non passé (P3-6)
- [ ] **Pagination** : scroll → intersection N-1 (onLoadMore) → CF page N+1 → spinner bas → cumul (pas reset)
- [ ] **Empty state** : icône + message custom centré

### Cas transverses & points chauds Accueil
- [ ] Invité : toutes sections Home visibles ; tap cœur → « Connectez-vous pour aimer » + requireAuth
- [ ] Invité + tap profil vendeur → routable ; Favoris → empty + SE CONNECTER
- [ ] CF Home échoue → SectionErrorBoundary silent, autres sections continuent
- [ ] Offline : aucune indication, CF cached (staleTime), pas de distinction visuelle
- [ ] FlashList v2 virtualisée (drawDistance 500) ; SkeletonCard optimiste
- [ ] **HOTSPOT P2-16** : DiscoverGrid .map non virtualisé (cumul pages = mémoire croissante)
- [ ] Cœur tap → haptique léger ; **HOTSPOT P3-9** : animation scale joue AVANT auth (invité reçoit animation même si bloqué)
- [ ] Recherche visuelle : caméra → Modal → capture → résultats → fermeture (scroll position perdu)
- [ ] **Force majeure** : push iOS cassé, expédition désactivée (état actuel `SHIPPING_ENABLED=false`), clé Google Maps manquante (cartes mortes), plugin caméra absent app.config.js (Android perd caméra prebuild clean)
- [ ] **Loi 25** : recherche visuelle + GPS collecte sans finalité (P2-14) ; pas d'export messages (champ sous-collection mal mappé)

---

## 5. Recherche & Filtres

_Routes : `/search`, `/visual-search-results`, `/saved-searches`._

> ℹ️ **Périmètre actuel** — La recherche et les filtres sont **dans le scope** : tous les flux (texte, catégories, dimensions, prix, tri, recherche visuelle, recherches sauvegardées) fonctionnent en mode `SHIPPING_ENABLED = false`. Les résultats ne contiennent que des articles en main-à-main (meetup). Aucune case n'est supprimée.

### Écran Recherche (`app/search.tsx`)
**Préconditions :** Invité (texte/catégories/filtres, pas d'historique) OU connecté (historique + recherches sauvegardées + alertes 15min). Données : articles avec `search_index`. Peut recevoir params URL.

#### Affichage initial
- [ ] Clavier focalisé auto sur le champ
- [ ] Historique 10 dernières recherches (connecté)
- [ ] « Recherches tendances » (8 termes hardcodés)
- [ ] Historique vide → message ; timeout → fallback gracieux (tendances seules)

#### Saisie texte
- [ ] Accents (é, è, à, ù…) acceptés
- [ ] Debounce 350ms
- [ ] Bouton OK visible si query>0 OU filtre actif
- [ ] OK / Enter → historique mis à jour, clavier fermé, résultats
- [ ] Annuler ferme clavier ; X vide le champ
- [ ] **Cas limite accents** « été » → match keyword « été » (asymétrie indexeur↔client avant 2026-06-01)
- [ ] **Cas limite ponctuation** « c'est » vs « cest » → match après normalisation
- [ ] Chargement : spinner sous le champ

#### Filtre Catégorie (bottom sheet)
- [ ] Chip Catégorie → arborescence niveau par niveau
- [ ] Sélection → path complet mis à jour ; feuille → ferme + recherche
- [ ] Chip affiche libellé (ex. « Manteaux ») ; croix supprime filtre
- [ ] **Cas texte + catégorie** → filtré par texte ET catégorie (C1 cassé avant 2026-06-01)
- [ ] **Tri Populaire + catégorie** → idem ; restauration saved search OK

#### Filtres Couleur / Taille / Matière / Marque / État
- [ ] Couleur : mono/multi-select, chip « Bleu » ou « N couleurs », croix efface, filtrage client
- [ ] Taille : sheet selon catégorie, `{value, system}`, multi « N tailles », changement catégorie reflète, filtrage client exact
- [ ] Matière : multi-select, chip, filtrage client (vocabulaire partagé création/recherche)
- [ ] Marque : multi-select + champ recherche, chip « N marques », filtrage client normalisé
- [ ] État : sélection unique, chip libellé, filtrage serveur (`where condition ==`)
- [ ] **Cas état + tri prix desc** : index manquant avant 2026-06-01 → crash ; après → OK

#### Filtre Prix (min/max)
- [ ] Inputs min/max, clavier numérique, virgule/point
- [ ] Appliquer valide + applique ; Effacer vide + supprime
- [ ] Chip « Min X$ » / « Max Y$ » / « X$ - Y$ » ; croix supprime
- [ ] Validation min ≤ max (inversion auto si min > max) ; virgule FR → point
- [ ] **Cas prix + tri récent** : avant 2026-06-01 crash ; après orderBy(price) premier, createdAt secondaire
- [ ] Restauration saved search → min/max dans inputs
- [ ] iOS/Android : clavier numérique natif

#### Filtre Tri
- [ ] Options Récent / Populaire / Prix croissant / Prix décroissant
- [ ] Mode texte → seul « Récent » (relevance serveur) ; sans terme → tous
- [ ] Sélection → chip + ferme + re-exécute
- [ ] Chip mode texte « Tri automatique » (non cliquable, pas de X)
- [ ] **Cas tri Populaire + condition** : index manquant avant 2026-06-01 → crash ; après → OK

#### Affichage résultats
- [ ] « Aucun résultat pour "terme" » / « Aucun article trouvé avec ces filtres »
- [ ] Compteur « N articles trouvés » / « N+ »
- [ ] Grille ProductGrid (2 colonnes) ; pull-to-refresh invalide cache
- [ ] Scroll fin → page suivante (pagination infinie)
- [ ] Chargement skeleton ; erreur réseau (icône nuage + « Une erreur est survenue » + Réessayer)
- [ ] Pagination en cours : spinner bas
- [ ] **Mode meetup seul** : tous les résultats sont en main-à-main (`SHIPPING_ENABLED = false`) ; aucun badge/filtre « livraison » ne doit apparaître dans la grille
- [ ] « Enregistrer cette recherche » si résultats non vides (SaveSearchButton)

#### Effacer tout / Restauration
- [ ] « Effacer tout » visible si ≥1 filtre ; click → toutes dimensions effacées (historique conservé)
- [ ] Restauration depuis params (query, filters JSON) → chips + inputs prix + tri + catégorie restaurés → recherche auto
- [ ] **Cas limite catégorie supprimée** → fallback gracieux

### Écran Recherche Visuelle (`app/visual-search-results.tsx`)
**Préconditions :** Invité ou connecté, image URI valide, CF visualSearch, embeddings Vertex AI.

#### Recherche visuelle (caméra)
- [ ] Caméra dans SearchHeader → modal fullscreen
- [ ] Permissions caméra (iOS NSCameraUsageDescription / Android CAMERA)
- [ ] Caméra arrière par défaut + guide frame + bouton capture + bascule + fermer + galerie
- [ ] Permission refusée → message + lien Paramètres ; capture en cours → spinner

#### Aperçu / Chargement / Résultats
- [ ] Preview : Confirmer → `/visual-search-results` ; Recommencer → caméra ; Annuler → `/search`
- [ ] Chargement : image floue + overlay + spinner « Analyse de l'image… » + « Recherche de produits similaires » + skeleton 2 colonnes
- [ ] Timeout 15s → fallback ; image invalide → erreur au démarrage
- [ ] Résultats : grille 2 colonnes + badge similarité (« 78 % ») haut-gauche + compteur + image source 64x64
- [ ] Tri par similarité décroissante (findNearest) ; tap → `/article/{articleId}` ; pull-to-refresh relance
- [ ] Vide : « Aucun produit similaire » + « Nouvelle recherche » + « Recherche texte »
- [ ] Erreurs : unauthenticated (« reconnecter »), resource-exhausted (« limite »), invalid-argument (« Image non traitée »), internal (« Analyse échouée »), unavailable (« Connexion impossible ») + Réessayer
- [ ] Badge % correct (45/78/92%)
- [ ] Back → `/search` ; « Nouvelle recherche » / « Recherche texte »

#### Points chauds recherche visuelle
- [ ] Embeddings Vertex AI 1408 dims, seuil ~45%, distance cosinus
- [ ] distanceResultField = '__distance__'
- [ ] Migration index : articles indexés ont `embeddings` ; anciens sans embeddings ne remontent pas
- [ ] Quota 10/h par user (si implémenté)

### Écran Recherches Sauvegardées (`app/saved-searches.tsx`)
**Préconditions :** Connecté obligatoire (gate useAuthRequired). Données : SavedSearchService. Alertes 15 min.

- [ ] Invité → sheet connexion
- [ ] Connecté → recherches chargées (skeletons pendant chargement)
- [ ] Timeout/erreur → état erreur + Réessayer
- [ ] Header « Recherches sauvegardées » + badge compteur ; scroll vertical
- [ ] Carte : titre, tags filtres (texte, catégorie, marques, couleurs, tailles, condition, prix), tag « +N », icône notifications (toggle), icône trash (supprime), badge « N nouveaux articles », animation FadeInDown
- [ ] Tap carte → `/search` avec params restaurés + resetNewItemsCount
- [ ] Vide : icône bookmark + « Aucune recherche sauvegardée » + sous-titre
- [ ] Erreur : icône cloud offline + « Une erreur est survenue » + Réessayer
- [ ] Toggle notifications → toggleNotifications, outline↔plein, haptic léger, erreur revient état précédent, debounce clics rapides
- [ ] Supprimer → alert « Supprimer cette recherche ? » → deleteSavedSearch, haptic warning, optimistic, erreur restaure
- [ ] Restauration : query + filters JSON + categoryIds → `/search` → chips/inputs reflètent → recherche auto ; catégorie supprimée → fallback
- [ ] Skeletons : 4 cartes
- [ ] Alertes 15 min : newItemsCount mis à jour par CF checkSavedSearchNotifications, badge au retour
- [ ] Notifications poussées : notifyNewItems → in-app/push (limites push iOS)
- [ ] Garde-fou : suppression ne supprime pas articles/commandes ; recherches incluses dans export RGPD

### Flux transversaux Recherche
- [ ] `/search` → caméra → `/visual-search-results` (modal, back → `/search`)
- [ ] `/search` → enregistrer → local state ou sheet ; `/saved-searches` → tap → `/search` params restaurés
- [ ] Erreur réseau : écran erreur + Réessayer (persiste en pagination, pas de crash)
- [ ] Index manquant avant 2026-06-01 → FAILED_PRECONDITION ; après → ne doit plus se reproduire
- [ ] Rate limit (Vertex AI, quota IA) → message + Réessayer

### Points chauds prioritaires Recherche
- [ ] **P1 Recherche visuelle IA** : embeddings 1408 dims, findNearest tri décroissant, badges %, articles anciens sans embeddings ne remontent pas
- [ ] **P2 Migration index Firestore** : tous index déployés (texte, populaire+condition, prix DESC), articles anciens moderationStatus + tailles {value,system} peuplés, categoryIds reconstruit
- [ ] **P3 Accents** : « été » / « décontracté » / « c'est » → normalisation NFD symétrique indexeur↔client
- [ ] **P4 Tri + prix** : orderBy(price) PREMIER quand inégalité prix, pas de crash
- [ ] **P5 Catégorie + texte (C1)** : search_index.categoryIds écrit à création/update + appliqué
- [ ] **P6 Push iOS** : in-app OK, push hors-app NON
- [ ] **P7 Expédition désactivée** : `SHIPPING_ENABLED = false` → seuls des articles en main-à-main (meetup) remontent dans les résultats ; aucune mention/filtre livraison ; le complément cash d'un swap reste hors app (Stripe)

#### ⏭️ HORS SCOPE ACTUEL (réactivable)

> Les boutiques (shops) ne sont pas dans le périmètre actuel : aucune UI utilisateur de création/gestion de boutique n'est câblée (modération admin seule). Aucun paramètre « boutique » n'existe dans la recherche ni dans les recherches sauvegardées. Conservé pour réactivation.

- [ ] **P8 Boutiques** : recherches sauvegardées sans param boutique, création self-service non câblée

---

## 6. Article, Achat & Checkout

_Routes : `app/article/[id].tsx`, `app/article/edit/[id].tsx`, `app/checkout/{index,meetup,success,_layout}.tsx`, `app/my-orders.tsx`._

⚠️ **Périmètre actuel** : expédition désactivée (`SHIPPING_ENABLED=false`) → seul le **meetup** est actif, aucun paiement Stripe en prod, règlement cash/virement hors app, zéro frais plateforme. La fiche article expose « OFFRE » + **« PROPOSER UN ACHAT »** (pas « ACHETER · prix » — confirmé `ArticleCTABar.tsx:88-92`). Le checkout route TOUJOURS vers le meetup (auto-sélection, `checkout/index.tsx:60-69`). Images locales édition (P-IMG), verrou transactionnel manquant (P-LOCK) restent à tester sur le flow meetup.
Les sous-parties **Checkout Shipping** et **Payment Reprise (Stripe)** sont déplacées en fin de section sous « HORS SCOPE ACTUEL ».

### Fiche Article (`app/article/[id].tsx`)
**Préconditions :** Non connecté (requireAuth sur achat/offre/favori), connecté acheteur, ou vendeur (banneau « C'est votre article »).
- [ ] Fiche complète (titre, prix, photos, vendeur, options selon état)
- [ ] Favoris persistent à rechargement ; partage OS share sheet
- [ ] CTA cohérente : disponible (OFFRE + **PROPOSER UN ACHAT**, shipping off), vendu (banneau seul), votre article (banneau seul)
- [ ] **CTA achat libellée « PROPOSER UN ACHAT »** (et NON « ACHETER · prix ») tant que `SHIPPING_ENABLED=false`
- [ ] Chargement skeleton ; erreur réseau « Erreur de connexion » + Réessayer ; inexistant « Article indisponible » ; vendu (banneau, CTA disparue)
- [ ] Non connecté : favori/achat/offre → login sheet, reprise après connexion
- [ ] Images carrousel + pinch/zoom (si supporté)
- [ ] iOS/Android : partage natif ; HEIC iOS ; haptiques iOS
- [ ] **Point chaud P-LOCK** : prix affiché = vraie DB (édition pendant consultation → pas de verrou)
- [ ] Badge « Baisse de prix » + % si applicable
- [ ] Push iOS : notifications in-app seules

### Édition article (`app/article/edit/[id].tsx`)
_Voir aussi section 3 (Édition d'article)._
- [ ] Formulaire pré-rempli sans erreur ; modif 1 champ (prix) → save → confirmation → recharge → modif appliquée
- [ ] Baisse de prix enregistre original + % + date ; 1ère photo propage aux conversations
- [ ] Chargement skeleton ; erreur validation (prix invalide/titre vide) → bloqué ; double-clic guard ; article vendu pendant édition → refus « Cet article a été vendu »
- [ ] iOS/Android : clavier ; permission galerie 1ère édition
- [ ] **CRITIQUE P-IMG** : nouvelles images en édition envoyées URI locale (file://) au lieu d'upload Storage → liens cassent après heures. Vérifier images supprimées+rajoutées uploadées gs://
- [ ] **CRITIQUE P-LOCK** : pas de verrou → édition durant achat ; commande prend prix du moment de la confirmation meetup
- [ ] Édition refuse article avec transaction meetup_pending active

### Checkout — Sélection mode (`app/checkout/index.tsx`)
**Préconditions :** Connecté acheteur, article actif non vendu, « PROPOSER UN ACHAT » cliqué.
- [ ] Titre « Commander » + résumé article (image, titre, prix)
- [ ] **SHIPPING_ENABLED=false** : Meetup forcé/auto-sélectionné, aucune carte Shipping affichée (même article legacy `isShipping=true`) — confirmé `checkout/index.tsx:60-69`
- [ ] Pas de choix de mode visible à l'utilisateur (mode unique pré-sélectionné, CONTINUER activé d'emblée)
- [ ] CONTINUER → `/checkout/meetup` (jamais `/checkout/shipping`)
- [ ] Chargement skeleton ; introuvable « Cet article n'existe pas » ; vendu « Cet article a été vendu » ; non connecté auth gate (reprise) ; erreur réseau + Réessayer

### Checkout Meetup (`app/checkout/meetup.tsx`)
**Préconditions :** Connecté acheteur ≠ vendeur, article actif main propre, depuis `/checkout`. Optionnel : negotiatedPrice + chatId.
- [ ] Article + vendeur + lieux préférés vendeur (si existe)
- [ ] Lieux proposés (preferredMeetupSpots) : noms + catégories ; « À convenir par messagerie »
- [ ] Prix par défaut ; si negotiatedPrice → prix négocié + badge « PRIX NÉGOCIÉ »
- [ ] Montant à régler CAD (100% acheteur, cash/virement hors app)
- [ ] « CONFIRMER LE MEETUP » : aucun Stripe (zéro frais cash), conversation créée/réutilisée, transaction meetup_pending, article isSold=true
- [ ] Navigation `/checkout/success` (deliveryType, articleTitle, spotName, chatId, transactionId)
- [ ] Chargement skeleton ; pas de lieux → auto « À convenir » ; blocage mutuel « Vous ne pouvez pas échanger… » ; article vendu « Cet article a été vendu » ; erreur transaction/chat + Réessayer
- [ ] **Point chaud** : serviceFee=0 ; double-clic CONFIRMER = 1 seule transaction ; lieu vide « À convenir » OK ; offre acceptée → prix négocié utilisé

### Checkout Success (`app/checkout/success.tsx`)
**Préconditions :** Depuis `/checkout/meetup`.
- [ ] Titre « Meetup confirmé ! »
- [ ] Message contexte (lieu meetup) ; récap montant = prix article, zéro frais
- [ ] Boutons : « CONTACTER LE VENDEUR » (chat) / « VOIR MA COMMANDE » (my-orders) + « Retour à l'accueil »
- [ ] Paramètres manquants → fallback gracieux ; chat introuvable → accueil
- [ ] **Point chaud** : total meetup = prix article (zéro frais plateforme)

### Mes Commandes (`app/my-orders.tsx`)
**Préconditions :** Connecté acheteur.
- [ ] Liste (récentes en haut) : image (blurhash), titre, montant CAD, badge statut, date FR-CA
- [ ] meetup_completed non évalué : « LAISSER UN AVIS »
- [ ] Swipe refresh recharge ; vide « Vous n'avez pas encore d'achats » + lien recherche
- [ ] Chargement skeleton ; erreur + Réessayer ; non connecté « Pas encore connecté » + lien
- [ ] iOS/Android : FlashList
- [ ] **Point chaud** : images locales cassées (file:// expiration) → seules images Storage s'affichent ; avis seulement meetup_completed ; permissions (voit que ses commandes)

### Flows transversaux Achat
- [ ] **Flow 1 Achat Meetup (non connecté → cash)** : invité → PROPOSER UN ACHAT → auth → reprise achat → checkout (Meetup forcé, Shipping masqué) → meetup → CONFIRMER (pas Stripe, meetup_pending) → success → chat → meetup → meetup_completed → avis
- [ ] **Flow 2 Offre acceptée + meetup négocié** : OFFRE 85$ → vendeur accepte → « Acheter au prix négocié » → checkout prix négocié + badge → CONFIRMER (prix négocié) → success ; une seule offre active ; expiration 48h
- [ ] **Flow 3 Shipping désactivé** : création article option expédition masquée ; legacy isShipping=true masqué ; checkout Meetup only auto ; `/checkout/shipping` inaccessible ; pas de Stripe meetup ; serviceFee=0
- [ ] **Flow 4 Images locales (P-IMG)** : édition → supprimer/ajouter photo → save → fiche affiche → revenir après 6h → toujours affichée → chat référencé OK
- [ ] **Flow 5 Verrou (P-LOCK)** : acheteur sur checkout meetup + vendeur édite prix 100$→50$ → vérifier prix réel transaction (attendu 100$, réalité bug 50$) → article marqué isSold atomiquement
- [ ] **Flow 6 Meetup zéro frais** : article 50$ → meetup → frais 0 → total 50$ → serviceFee=0, shippingCost=0 → vendeur 100% (cash/virement hors app) → pas d'appel Stripe → wallet non crédité auto

### Cas limites & erreurs Achat
- [ ] Article supprimé pendant consultation : fiche « Article indisponible », checkout refuse, ChatArticleBar disparaît (offre peut rester C1)
- [ ] Blocage mutuel : checkout/offer refuse message clair
- [ ] Double-clic PROPOSER UN ACHAT/CONFIRMER : 1 transaction, pas de double charge, button disabled
- [ ] Réseau offline : « Erreur de connexion » + Réessayer
- [ ] Images manquantes/blurhash : placeholder gris (jamais crash)
- [ ] Push iOS : in-app OK, statuts consultables app ; Android push FCM OK

### Récap hotspots prioritaires Achat
- [ ] Shipping désactivé (masque complètement Shipping ; CTA « PROPOSER UN ACHAT »)
- [ ] Images locales édition (P-IMG : upload Storage gs://)
- [ ] Pas de verrou transactionnel (P-LOCK)
- [ ] Meetup zéro frais (serviceFee=0, total=prix article)
- [ ] Push iOS non opérationnel (in-app OK)
- [ ] Offre expiration 48h
- [ ] Blocage mutuel (refus message)
- [ ] Aucune transaction sans Stripe (meetup cash/virement hors app)
- [ ] Wallet non crédité meetup (règlement off-app)

#### ⏭️ HORS SCOPE ACTUEL (réactivable)

> ⏭️ **HORS SCOPE ACTUEL** — `SHIPPING_ENABLED=false` rend l'expédition et le paiement en ligne Stripe inaccessibles : `/checkout/shipping` n'est jamais atteint (le checkout force `meetup`, `checkout/index.tsx:60-69`) et `/payment/[transactionId]` (reprise paiement Stripe) ne reçoit aucune transaction `pending_payment` en meetup-only. Conservé pour réactivation via `config/featureFlags.ts`.

##### Checkout Shipping (`app/checkout/shipping.tsx`) [LATENT — SHIPPING_ENABLED=false, inaccessible]
**Préconditions :** Connecté acheteur, article isShipping=true, shipping réactivé, vendeur Stripe actif + adresse réelle.
- [ ] Saisie adresse (pré-remplie) ; validation serveur (pays=CA, rue/ville, province ∈ liste, CP A1A 1A1)
- [ ] Estimation ShipEngine dès 6 car CP : jusqu'à 5 tarifs (transporteur, service, délai, montant)
- [ ] Prix : article + livraison + frais protection (5% + 1,50$, min 2$) + total CAD
- [ ] Wallet (si solde) : interrupteur ; PAYER → feuille Stripe (Apple/Google Pay si configurés)
- [ ] Succès = webhook → paid → label_created → page succès
- [ ] Chargement (adresse pré-remplie/focus) ; adresse invalide (ville vide / CP invalide) ; ShipEngine injoignable → fallback + « Tarif expiré » + Actualiser ; pas d'adresse vendeur → refus ; erreur Stripe ; double-clic = 1 tentative
- [ ] iOS/Android : Apple Pay / Google Pay (merchantCountryCode='CA') ; clavier
- [ ] **Point chaud** : DÉSACTIVÉ prod (inaccessible) ; tarifs fallback refusent paiement ; adresse vendeur manquante (fallback Montréal H2S3C4 ne doit pas permettre achat) ; frais livraison > réalité (delta >2$ journalisé, acheteur ne surpaie pas)

##### Payment Reprise (`app/payment/[transactionId].tsx`) [LATENT — paiement Stripe désactivé]
**Préconditions :** Connecté acheteur propriétaire, transaction pending_payment (n'existe pas en meetup-only).
- [ ] Récap article + adresse + frais détaillés (article, livraison, protection, total)
- [ ] Wallet interrupteur ; PAYER → feuille Stripe → succès `/checkout/success`
- [ ] Chargement skeleton ; introuvable « Transaction non trouvée » ; non propriétaire « Vous n'êtes pas autorisé » ; statut ≠ pending_payment « Ce paiement n'est plus disponible » ; erreur Stripe retry/annuler
- [ ] **Point chaud** : idempotence Stripe (clé pi_{transactionId}) ; tarif expiré → réestimation (`/checkout/shipping`)

##### Checkout Success — variante Shipping (latente)
**Préconditions :** Depuis webhook Stripe (shipping réactivé uniquement).
- [ ] Titre « Paiement confirmé ! » ; message « Étiquette créée » ; récap frais/total shipping (≥2$ service)
- [ ] Total shipping = prix + livraison + service (≥2$)
- [ ] Webhook delayed : succès affiché avant `paid` confirmé (race, transactionnel correct backend)

##### Mes Commandes — items Shipping/Stripe (latents)
- [ ] pending_payment : tap → `/payment/[transactionId]` + bouton « Reprendre paiement »
- [ ] delivered (shipping J+7) non évalué : « LAISSER UN AVIS »

##### Cas limites Shipping/Stripe (latents)
- [ ] Vendeur Stripe non actif : shipping refuse, meetup autorisé
- [ ] Paiement timeout 12s
- [ ] Tarif shipping expiré : fallback (8,50$/14,50$) → « Tarif expiré » + Actualiser

---

## 7. Offres & Négociation

> ℹ️ **PÉRIMÈTRE ACTUEL** — Section IN SCOPE (offres, négociation, meetup cash main-à-main). Avec `SHIPPING_ENABLED=false` (`config/featureFlags.ts:17`), tout le flux est meetup : le bouton d'achat affiche « PROPOSER UN ACHAT » (non « ACHETER »), le checkout pré-sélectionne meetup, et il n'y a aucun paiement en ligne ni crédit wallet. Les rappels de paiement en ligne hérités (« PAYER MAINTENANT ») sont consolidés en bas sous HORS SCOPE.

_Routes : `app/article/[id].tsx` (bouton OFFRE), `app/chat/[id].tsx` (modal + bulles), `app/checkout/meetup.tsx`, `components/MakeOfferModal/*`, `components/OfferBubble.tsx`._

### Article Detail — Bouton OFFRE (`app/article/[id].tsx`)
**Préconditions :** Connecté, article actif non vendu, pas vendeur, pas blocage mutuel, pas d'offre pending du même acheteur, ≥1 lieu (ou « À convenir »).
- [ ] OFFRE apparaît (pas vendu, pas votre article)
- [ ] OFFRE → MakeOfferModal (bottom sheet 85%, « Faire une offre » + ÉTAPE 1/3, barre 33%)
- [ ] Article vendu : OFFRE masqué + banneau ; supprimé → ErrorState ; non connecté → auth puis reprise ; votre article → banneau ; blocage « Vous avez bloqué cet utilisateur » ; offre pending → « Vous avez déjà une offre en attente »
- [ ] Bouton d'achat principal affiche « PROPOSER UN ACHAT » (SHIPPING_ENABLED=false), pas « ACHETER · prix » (`features/article/components/ArticleCTABar.tsx:88-92`)
- [ ] **HOTSPOT P1-26** : aucune vérif `article.isSold` avant `makeOfferModalRef.present()`

### Modal Étape 1 — Montant + Message (`OfferStep.tsx`)
- [ ] Rappel titre | prix ; montant CAD (0,01$ à 50 000$) ; % réduction (orange si >50%) ; message ≤500 car + compteur
- [ ] Champ vide → CONTINUER grisé ; <30% prix → alerte non bloquante + « Continuer quand même » ; >50 000$ rejeté ; valide → étape 2
- [ ] Montant = prix → 0% pas d'alerte ; >prix → 0% pas d'alerte ; message 501 car → erreur/troncature ; message vide accepté
- [ ] iOS/Android clavier CAD : `45,50` (FR-CA) → `45.50` (JSON, pas 4550)
- [ ] **HOTSPOT P1-6 parsing FR-CA** : `replace(/[^0-9.]/g)` sans normaliser virgule → tester `45,50`
- [ ] **HOTSPOT** : pas de max server-side (client refuse >50 000$, backend non)
- [ ] Alerte <30% présente et non bloquante

### Modal Étape 2 — Lieu Meetup (`LocationStep.tsx`)
**Préconditions :** Étape 1 validée, mode meetup, vendeur a ≥1 quartier.
- [ ] Titre « Lieu de rencontre » + ÉTAPE 2/3 + quartier vendeur badge RECOMMANDÉ
- [ ] Choisir quartier (Plateau, Marais…) + lieu précis (par catégorie) ; lieux vendeur badge SUGGÉRÉ ; « Lieu personnalisé »
- [ ] Lieu obligatoire → CONTINUER → étape 3
- [ ] Aucun lieu → grisé ; quartier vide → liste grise ; personnalisé texte vide rejeté ; recommandé présélectionné si seul
- [ ] Bottom sheet montée à l'ouverture (Android)
- [ ] Lieux précis filtrés par quartier ; contre-offres lieu implémentées serveur mais pas en UI

### Modal Étape 3 — Confirmation (`ConfirmStep.tsx`)
- [ ] Récap : montant, titre, message, lieu, « Montant à payer »
- [ ] « Aucun frais de service — paiement en main propre » + « Comment ça marche ? » + expiration 48h
- [ ] ENVOYER L'OFFRE → serveur → message offre chat → ferme modal ; RETOUR pour modifier
- [ ] Montant=prix → brut, pas de réduction ; <prix → réduction ; pas de lieu → « À convenir » ; pas de message → vide ; soumission → spinner ; erreur réseau « Impossible d'envoyer l'offre » + retour
- [ ] **HOTSPOT Audit #02-7** : frais service calculés (payments.ts:232) mais non affichés (devrait être 0 meetup)
- [ ] Expiration 48h mentionnée

### Chat — Bulle Offre Reçue (`OfferBubble.tsx`)
**Préconditions :** Connecté, chat ouvert, offre reçue d'autrui, status pending, sender non bloqué.
- [ ] Bulle grise « OFFRE REÇUE » + montant (« 35,00 $ CA ») + carte lieu (📍 nom/catégorie/quartier) + message + badge statut (« EN ATTENTE », « Expire dans 10 h »)
- [ ] Boutons ACCEPTER (vert) + REFUSER (rouge) ; ACCEPTER/REFUSER → alerte confirmation
- [ ] Offre expirée → « EXPIRÉE » boutons grisés ; acceptée → « ACCEPTÉE » ; refusée → « REFUSÉE » ; counter_price → nouvelle bulle pending
- [ ] Pas d'avatar → espace gris ; haptique iOS riche
- [ ] Statut badge + compte à rebours correct ; bulle alignement reçue (droite)
- [ ] **HOTSPOT Audit #02-4** : `onCounterLocation`/`onCounterTime` non passés depuis chat[id]:268-283 (seul onCounterPrice)

### Chat — Bulle Offre Envoyée (`OfferBubble.tsx`)
- [ ] Bulle beige « VOTRE OFFRE » + montant + lieu + message + badge statut + compte à rebours (si pending)
- [ ] Aucun bouton d'action (vendeur décide) ; timestamp ; expirée → « EXPIRÉE »
- [ ] En attente compte à rebours ; acceptée → « ACCEPTÉE » ; refusée → « REFUSÉE » ; contre-offre → nouvelle bulle, votre offre counter_price
- [ ] Bulle alignement envoyée (gauche)

### Chat — Acceptation Offre (Vendeur)
- [ ] Bulle reçue → ACCEPTER → alerte « accepter cette offre de 35,00 $ CA avec meetup ? » → Accepter
- [ ] Badge → ACCEPTÉE ; ACCEPTER/REFUSER disparaissent ; CONFIRMER LE MEETUP apparaît (vendeur) ; message système « Offre acceptée » ; acheteur notifié
- [ ] Offre expirée avant clic → « L'offre a expiré » ; erreur réseau « Impossible d'accepter » ; transaction déjà existe (atomicité) ; double-tap = pas de double appel
- [ ] Alerte confirmation obligatoire ; statut bascule rapide ; ⚠️ pas de double-tap guard explicite sur onAcceptOffer

### Chat — Refus Offre (Vendeur)
- [ ] REFUSER → alerte « refuser cette offre de 35,00 $ CA ? » → Refuser
- [ ] Badge → REFUSÉE ; boutons disparaissent ; article reste en vente ; acheteur notifié ; message système
- [ ] Offre expirée / erreur réseau → alerte ; article vendu entre-temps → refus accepté ; refus libère l'article

### Chat — Contre-Offre Prix (Vendeur)
- [ ] CONTRE-OFFRE → panneau inline (prix + message) → ENVOYER LA CONTRE-OFFRE
- [ ] Ancienne offre → counter_price ; nouvelle bulle pending 48h ; message système « Contre-offre de prix »
- [ ] Montant identique → aucune alerte ; >prix → accepté ; <30% → alerte non bloquante ; erreur → panneau reste ouvert
- [ ] **HOTSPOT Audit #02-4** : OfferBubble:268 ne passe qu'onCounterPrice, jamais lieu/horaire

### Chat — Confirmation Meetup (Vendeur)
**Préconditions :** Offre accepted, meetup.confirmedAt absent, completedAt absent.
- [ ] CONFIRMER LE MEETUP → alerte « meetup a bien eu lieu / transaction terminée ? » → Confirmer
- [ ] meetup.confirmedAt = timestamp serveur ; bouton disparaît ; acheteur voit TERMINER LA TRANSACTION ; statut reste accepted
- [ ] Offre non acceptée / déjà confirmé → bouton grisé ; erreur réseau « Impossible de confirmer » ; expiration 48h → grisé
- [ ] **HOTSPOT Audit #02-11** : chat sans sellerId bloque confirmation (tester chat créé sans sellerId)

### Chat — Signalement No-Show
**Préconditions :** Offre accepted+confirmée (meetup_confirmed), pas complétée.
- [ ] SIGNALER UNE ABSENCE → alerte → Signaler
- [ ] Backend devrait : gèle transaction (disputed=true), libère article (isSold=false), crée disputes/{id} (meetup_no_show)
- [ ] **LIMITATION** : bouton cosmétique (ChatService.reportNoShow:1494 n'appelle pas la CF) ; litige via expiration auto seulement
- [ ] **HOTSPOT Audit #02-6** : pas de check article vendu à l'envoi d'offre depuis chat
- [ ] **HOTSPOT Audit #9.6** : reportMeetupNoShow backend gère tout mais chat ne l'appelle jamais

### Chat — Finalisation Meetup
**Préconditions :** Offre accepted, meetup.confirmedAt existe, completedAt vide.
- [ ] TERMINER LA TRANSACTION → alerte « remise en main propre a bien eu lieu ? » → Terminer
- [ ] meetup.completedAt + meetupCompletedBy ; statut → meetup_completed ; message « Transaction terminée » ; badge TERMINÉE ; avis débloqué bidirectionnel
- [ ] Meetup non confirmé / déjà complété → bouton caché ; erreur réseau « Impossible de terminer » ; aucun crédit (meetup cash)

### Expiration Automatique (Backend)
- [ ] **Offres (hourly)** : pending + expiresAt < now → expired + message système + acheteur notifié
- [ ] **HOTSPOT Audit #02-1** : AUCUNE CF ne passe les offres en expired ; status reste pending indéfiniment ; serveur refuse accept/refus anciennes mais UI jamais mise à jour
- [ ] **Meetup non-confirmé (48h)** : meetup_pending >48h → cancelled, article relibéré, acheteur notifié, pas de remboursement
- [ ] **Meetup confirmé (7j)** : meetup_confirmed >7j → cancelled, article relibéré, 2 parties notifiées, pas de remboursement

### Checkout Meetup (parallèle chat)
_Voir aussi section 6 (Article — proposition meetup)._
- [ ] PROPOSER UN ACHAT (ex-« ACHETER », SHIPPING_ENABLED=false) → `/checkout` → Meetup (unique option) → `/checkout/meetup` → lieu/« À convenir » → CONFIRMER
- [ ] Aucun choix livraison/adresse : meetup pré-sélectionné automatiquement (`app/checkout/index.tsx:60-69`)
- [ ] Article réservé (isSold=true) ; transaction meetup_pending ; chat créé/récupéré + message offre meetup ; `/checkout/success`
- [ ] Aucun lieu → grisé ; vendu entre-temps « non disponible » ; blocage mutuel → erreur ; chat existe → réutilisé ; lieu personnalisé OK
- [ ] **HOTSPOT Audit #02-10** : double transaction checkout/meetup.tsx:142 + chatService.ts:607 (atomicité bloque doublon Firestore) ; tester double-clic CONFIRMER
- [ ] Atomicité : un seul gagnant
- [ ] Aucun appel Stripe / PaymentIntent dans ce flux (meetup = cash main-à-main)

### Checkout Success Meetup
- [ ] Titre « Meetup confirmé » + détails (lieu, article) + « CONTACTER LE VENDEUR » / « Retour à l'accueil »
- [ ] Lieu + montant (ou négocié) corrects ; badge MEETUP ; aucun frais affiché

### Scénarios clés Offres
- [ ] A : Offre simple acceptée → completion (pas de crédit balance)
- [ ] B : Offre refusée → article reste en vente
- [ ] C : Expiration 48h → badge EXPIRÉE, boutons grisés, article reste en vente
- [ ] D : No-show (limitation : bouton cosmétique, déblocage via 7j)
- [ ] E : Contre-offre prix (lieu/horaire non en UI)
- [ ] F : Blocage mutuel → « Vous avez bloqué cet utilisateur »
- [ ] G : Article vendu entre-temps → « Article non disponible » / annulation atomique
- [ ] H : Montant <30% → alerte + « Continuer quand même »
- [ ] I : Montant virgule FR-CA `45,50` → backend reçoit 45.50
- [ ] J : iOS push vs in-app (push dépend jeton FCM, in-app toujours présent)

### Points chauds prioritaires Offres
- [ ] ❌ Expiration 48h offres (expiresAt client, pas de CF, bulle pending indéfiniment)
- [ ] ❌ Contre-offres lieu/horaire non exposées UI
- [ ] ❌ Parsing montant FR-CA (`45,50` → `4550`)
- [ ] ❌ Double transaction checkout + offre chat (tester double-clic)
- [ ] ⚠️ No-show cosmétique (déblocage via expiration 7j)
- [ ] ⚠️ Aucune vérif article vendu avant offre (#02-6)
- [ ] ⚠️ Frais service calculés mais non affichés meetup (#02-7)

#### ⏭️ HORS SCOPE ACTUEL (réactivable)

> Raison : paiement en ligne désactivé (`SHIPPING_ENABLED=false`, `config/featureFlags.ts:17`). Les offres/transactions en mode shipping legacy proposaient « PAYER MAINTENANT » (Stripe) après acceptation ; ce bouton est masqué et aucun PaymentIntent n'est déclenché. Conservé pour réactivation quand le shipping/checkout en ligne reviendra.

- [ ] Bulle Offre Reçue : offre liée transaction → « PAYER MAINTENANT » si accepted (shipping legacy, masqué SHIPPING_ENABLED=false)
- [ ] Bulle Offre Reçue : « PAYER MAINTENANT » masqué (SHIPPING_ENABLED=false)
- [ ] Bulle Offre Envoyée : acceptée → « ACCEPTÉE » + PAYER MAINTENANT (shipping masqué SHIPPING_ENABLED=false)

---

## 8. Meetup & Livraison/Suivi

> ⏭️ **PÉRIMÈTRE ACTUEL** — `SHIPPING_ENABLED=false` (`config/featureFlags.ts:17`) : seul le **meetup** (main-à-main, règlement cash/virement hors app, zéro frais plateforme, aucun appel Stripe) est testable. Tout le **shipping/suivi de colis**, le **paiement Stripe en ligne** et le **dépannage de paiement** sont conservés mais hors scope (réactivables en repassant le drapeau à `true`). Le **porte-monnaie** reste accessible mais demeure vide en pratique (aucun crédit de vente sans paiement en ligne).

_Routes : `app/checkout/{index,meetup,shipping,success}.tsx`, `app/my-orders.tsx`, `app/my-sales.tsx`, `app/chat/[id].tsx`, `app/payment/[transactionId].tsx`, `app/review/[transactionId].tsx`._

### 1. Sélection mode livraison (`/checkout`)
_Voir aussi section 6._
- [ ] Meetup seul visible (prod) : image + titre + prix + 1 option → CONTINUER → `/checkout/meetup`
- [ ] Auto-sélection meetup forcée (`SHIPPING_ENABLED=false` → `effectiveDelivery='meetup'`, `checkout/index.tsx:60-69`), y compris pour les articles legacy `isShipping=true`
- [ ] Chargement skeleton ; introuvable + Retour ; vendu « plus disponible » ; vendeur « Vous ne pouvez pas acheter votre propre article » ; erreur réseau + Réessayer (CHECK refetch réel)
- [ ] Continue désactivé si rien (en pratique meetup toujours pré-sélectionné)
- [ ] **CTA confirmé** : sur l'article le bouton affiche **« PROPOSER UN ACHAT »** (et non « ACHETER · {prix} ») quand `SHIPPING_ENABLED=false` (`ArticleCTABar.tsx:88-92`) → vérifier qu'aucun libellé « ACHETER » ne fuit dans le tunnel meetup

### 2. Sélection lieu Meetup (`/checkout/meetup`)
_Voir aussi sections 6 & 7._
- [ ] Article + badge MEETUP + badge PRIX NÉGOCIÉ (si applicable)
- [ ] LIEUX SUGGÉRÉS (📍 nom/type/quartier) + « À convenir par messagerie »
- [ ] CONFIRMER LE MEETUP → spinner → transaction meetup_pending + chat + bulle offre → `/checkout/success` (via `TransactionService`, **aucun appel Stripe**)
- [ ] Chargement skeleton ; introuvable + Retour ; vendu ; vendeur ; pas de lieu → auto « À convenir » ; blocage « Action impossible » ; CONFIRMER désactivé sans lieu ; double-clic = pas de double tx ; race vendu
- [ ] iOS Haptics (Medium + Success/Error) ; Android haptics si support
- [ ] **Points chauds** : prix négocié (finalPrice = negotiatedPrice ?? article.price) confirmé écran + success ; auto-sélection premier lieu ; bulle offre dans chat après succès

### 4. Écran Succès — variante Meetup (`/checkout/success`)
_Voir aussi section 6._
- [ ] Meetup : ✓ vert + « Meetup confirmé » + « Convenez d'un créneau par messagerie » + carte (article, prix, lieu, badge MEETUP) + CONTACTER LE VENDEUR / Retour
- [ ] Paramètres manquants → gracieux ; pas de chatId → `/(tabs)` ; badge MEETUP correct ; prix match ; navigation correcte
- [ ] **Point chaud** : prix négocié affiché (TODO brancher)

### 5. Confirmation Vendeur — Bulle Offre Chat (`/chat/[id]` + OfferBubble)
_Voir aussi section 7._
- [ ] Vendeur : « Demande de meetup pour "{titre}" » + détails + Confirmer/Refuser
- [ ] Confirmer → confirmMeetup (updateDoc message + tx meetup_confirmed) → message système « Meetup confirmé! »
- [ ] Refuser → alerte → offre refused, tx reste meetup_pending → message système
- [ ] Acheteur après confirm : « Terminer le meetup » → completeMeetupTransaction (CF completeMeetup) → meetup_completed + « Meetup terminé! »
- [ ] Bulle initial : prix/lieu corrects, lieu « À convenir » sans géo, badge MEETUP, boutons selon rôle
- [ ] Rôle vendeur : Confirmer + Refuser (pas Terminer) ; après Confirmer → statut meetup_confirmed
- [ ] Rôle acheteur : Terminer (pas Confirmer/Refuser) ; post-complétion bouton disparaît + review
- [ ] **No-show [HOTSPOT]** : après confirm → « Signaler une absence » → alerte → message système ; tx reste meetup_confirmed, article reste isSold (bug P0-2)
- [ ] **P1-6 échec réseau** : vendeur confirme + erreur → bulle reste « Confirmer » client, backend a écrit meetup_confirmed → acheteur rafraîchit → « Terminer »
- [ ] Acheteur Terminer immédiat après Confirme → succès OU « déjà complétée »
- [ ] Double-clic Confirmer/Terminer → disabled pendant spinner
- [ ] **Points chauds** : bulle sendMeetupOffer (client) vs acceptOffer (backend) cohérence ; meetup confirmé jamais complété (P0-3, après 7j article libéré ou bloqué ?) ; offre meetup acceptée depuis chat → CF acceptOffer cherche buyerId=auth.uid (vendeur) → guard fail (P1-7), offre accepted orpheline

### 7. Mes Commandes (acheteur) (`my-orders.tsx`)
_Voir aussi section 6._
- [ ] Liste tri date décroissante (image blurhash, titre, prix payé, badge statut, date)
- [ ] Review button si meetup_completed + not reviewed ; tap → chat (meetup)
- [ ] Chargement skeleton ; vide « Vous n'avez pas encore d'achats » ; refresh control ; deep link commande directe
- [ ] **Points chauds** : no-show meetup bloqué (article isSold + aucune autre transaction)

### 8. Mes Ventes (vendeur) (`my-sales.tsx`)
- [ ] Liste tri décroissant (image, titre, prix vendeur, statut, date)
- [ ] Statuts meetup (À confirmer/Confirmé/Complété) affichés correctement
- [ ] Tap → chat (meetup) ; review button (selon statut meetup_completed)
- [ ] Chargement skeleton ; vide « Vous n'avez pas encore de ventes » ; vendeur refuse offre/confirme meetup depuis chat
- [ ] **Point chaud no-show vendeur** : meetup_confirmed, vendeur attendait, ne vient pas → « Signaler absence » ? article relibéré ? → NON (bug P0-2)

### 10. Avis/Review (`/review/[transactionId]`)
_Voir aussi section 9._
- [ ] Image + titre ; sélecteur étoiles (1-5, défaut 0) ; TextInput commentaire (min 5 backend) ; ENVOYER MON AVIS
- [ ] Commentaire vide → injecte « Bonne transaction. » (dead-end) ; submitReview → reviewed ; succès « Avis soumis » + back
- [ ] Chargement skeleton ; statut ineligible « non reviewable » ; étoiles clickables ; commentaire optionnel ; submission désactivée note=0 ; succès review disparu (cache stale 5min) ; re-visite 5min re-soumettre (bug) ; profanités → erreur
- [ ] **iOS HOTSPOT** : pas de KeyboardAvoidingView → commentaire masqué par clavier, bouton non visible
- [ ] **Points chauds** : injection commentaire défaut (note 5 sans texte → « Bonne transaction. » public) ; aucune validation price-proposal

### 11. Chat — Actions Meetup & Transitions (`/chat/[id]`)
_Voir aussi sections 7 & 12._
- [ ] Workflow complet : PROPOSER UN ACHAT → meetup → CONFIRMER LE MEETUP → bulle offre pending → vendeur Confirmer → meetup_confirmed → acheteur Terminer → meetup_completed → review
- [ ] Étapes 1-2 bulle créée ; étape 4 vendeur Confirmer (atom, update acheteur) ; étape 5 acheteur Terminer ; étape 6 meetup_completed + message
- [ ] No-show : « Signaler absence » → message système, tx reste meetup_confirmed (bug) ; erreur réseau + retry ; double-clic disabled
- [ ] iOS/Android : modal/bottom sheet ; DateTimePicker/LocationPicker (contre-prop) natif
- [ ] **Points chauds** : no-show signalé pas traité (article isSold P0-2/P1-8) ; meeting confirmé jamais complété (tx zombie P0-3) ; accepter offre meetup chat → CF vendeur croit = acheteur → guard fail (P1-7)

### 13. Cas limites & erreurs Meetup
- [ ] Blocage mutuel → confirmation meetup échoue « Vous ne pouvez pas acheter cet article »
- [ ] Article supprimé pendant checkout → « Article indisponible »
- [ ] Transaction orpheline (crash/offline) → meetup_pending affiché next open
- [ ] Prix change après offre → offre prix ancien, tx prix négocié OK
- [ ] **Push iOS [HOTSPOT]** : vendeur confirme → acheteur in-app OK, push hors-app rien iOS ; Android FCM présent

### Cas critiques à prioriser Meetup
- [ ] NO-SHOW meetup → article reste isSold à jamais (P0-2)
- [ ] Meetup confirmé non-complété → transaction orpheline 7+ jours (P0-3)
- [ ] Push iOS → aucune notification hors-app
- [ ] Acceptation offre non-atomique (P1-4) : status accepted écrit avant tx → offre orpheline si CF échoue
- [ ] Confirmation meetup côté client (P1-5) : updateDoc client pas CF atomique
- [ ] Double écriture confirmMeetup (P1-6) : 2 updateDoc séparés → wedge si 2e échoue
- [ ] Prix négocié perdu (P1-10 dormant) : negotiatedPrice jamais transmis params

#### ⏭️ HORS SCOPE ACTUEL (réactivable)

> Bloqué par `SHIPPING_ENABLED=false`. Conservé pour réactivation (repasser le drapeau à `true` dans `config/featureFlags.ts`). Couvre : expédition/suivi de colis, paiement Stripe en ligne, dépannage de paiement, crédits/retraits du porte-monnaie alimentés par les ventes en ligne, et les variantes shipping des écrans meetup.

##### 1bis. Sélection mode livraison — variante Shipping (`/checkout`) [LATENT]
_Réactivé seulement si `SHIPPING_ENABLED=true`._
- [ ] Shipping réactivé : 2 options → Meetup ou Shipping
- [ ] CTA « ACHETER · {prix} » réapparaît sur l'article quand `SHIPPING_ENABLED=true`
- [ ] Auto-sélection si option unique ; Continue désactivé si rien

##### 3. Paiement Shipping (`/checkout/shipping`) [LATENT — paiement Stripe en ligne]
_Voir aussi section 6._
- [ ] Formulaire adresse (pré-rempli, CP canadien) → fetchShippingEstimates
- [ ] Estimation (getShippingEstimate CP acheteur+vendeur défaut H2S3C4) ; rates ; fallback → paiement bloqué + alerte
- [ ] Récap : article + frais service (5%+1,50$, min 2$) + livraison = total ; wallet toggle si solde>0
- [ ] PAYER : full wallet → payWithWallet (pas Stripe) ; partial/card → createStripeCheckout → Payment Sheet → succès `/checkout/success`
- [ ] Chargement skeleton ; introuvable ; vendu ; CP invalide (red border) ; estimation échoue → FALLBACK + bloqué + alerte ; réussie → rates ; wallet 0 caché ; wallet>0<total montant restant ; wallet couvre → 0$ ; province manquante (À vérifier) ; rateId expiré 1h → re-fetch
- [ ] iOS/Android Payment Sheet natif ; KeyboardAvoidingView
- [ ] **Points chauds** : fallback rate → blocage paiement + retry/meetup ; re-tarification server (buyerTotal) ; CP vendeur absent → fallback invisible

##### 4bis. Écran Succès — variante Shipping (`/checkout/success`) [LATENT]
_Voir aussi section 6._
- [ ] Shipping : ✓ + « Paiement confirmé » + carte (article, prix, frais, livraison, total, badge EXPÉDITION) + VOIR MA COMMANDE / Retour
- [ ] Badge EXPÉDITION correct ; prix match ; navigation correcte
- [ ] **Points chauds** : webhook delayed (succès optimiste avant `paid`)

##### 6. Suivi de Colis (Shipping) — ShipmentTracking [LATENT]
- [ ] Numéro suivi clickable + statut (En transit/Livré/Échec) + carrousel événements + signature
- [ ] Transitions : paid → label_created → shipped → delivered (+signature) / delivery_failed / lost (latent)
- [ ] Chargement skeleton ; label créé numéro ; statut correct ; timeline ; signature « Signé par occupant » ; shipping sans tracking « En attente… » ; erreur livraison + CTA
- [ ] **Points chauds [LATENT]** : aucun webhook ShipEngine (statut reste paid) ; fallback rate bloque label ; notification push manquante (iOS cassé)

##### 7bis. Mes Commandes — entrées Shipping [LATENT]
- [ ] Review button si delivered/completed (shipping) + not reviewed ; tap → détails (shipping)
- [ ] **Point chaud** : statut completed jamais reviewable (review disparaît J+7 shipping, P1-11)

##### 8bis. Mes Ventes — statuts Shipping & crédit wallet [LATENT]
- [ ] Statuts shipping (Paiement confirmé/Étiquette/Expédié/Livré/Complété)
- [ ] Tap → détails (shipping) ; review button (sauf completed inreviewable)
- [ ] Paiement reçu (wallet.balance augmente) — nécessite paiement Stripe en ligne

##### 9. Paiement/Dépannage Stripe (`/payment/[transactionId]`) [LATENT — Stripe]
_Voir aussi section 6._
- [ ] Récap transaction + REESSAYER PAIEMENT + ANNULER
- [ ] Réessayer → relance Payment Sheet ; Annuler → cancelPendingTransaction (isSold=false) → back
- [ ] Paramètre manquant → error ; montant = attendu (pas divergence) ; boutons actifs ; succès → success ; annulation → isSold false
- [ ] iOS/Android : footer safe-area (P2-17 paddingBottom:32 sans inset)

##### 10bis. Avis/Review — éligibilité Shipping [LATENT]
- [ ] Statut ineligible shipping (pending_payment/paid/shipped) « non reviewable »
- [ ] **Point chaud** : completed jamais reviewable shipping J+7 (P1-11)

##### 12. Porte-Monnaie & Paiement Ventes (`/wallet`) [accessible mais vide sans paiement en ligne]
_Voir aussi section 10. L'écran s'ouvre, mais sans vente en ligne (meetup = cash hors app) le solde reste à 0 et les crédits/retraits ci-dessous ne sont pas déclenchables._
- [ ] Solde disponible + en attente + retenu (disputed) ; ledger 20 dernières (sale_credit, refund_credit, funds_held, funds_released [BUG rouge], dispute_hold)
- [ ] Retirer → formulaire (montant, compte) → walletWithdraw → débite balance → virement
- [ ] Chargement skeleton ; solde 0 (état attendu en meetup-only) ; credit reçu (+vert) ; refund (+vert) ; funds_held (neutre/-) ; funds_released (BUG -rouge, devrait neutre/+) ; retrait >solde « insuffisant » ; retrait encours bloqué ; compte bancaire validé
- [ ] **Points chauds** : funds_released rouge (P1-14 confiance) ; dispute hold indéfini sans SLA (P1-13) ; ledger types manquants 4/9 (funds_held, dispute_hold) → icône generic
- [ ] **PIÈGE UX** : en meetup-only le wallet reste vide en permanence → vérifier qu'un empty state n'induit pas l'utilisateur en erreur (recommandation audit : masquer ou expliquer « meetup = règlement hors app »)

##### 13bis. Cas limites Shipping [LATENT]
- [ ] Shipping réactivé → estimation fallback bloque paiement (P1-9)

##### Cas critiques Shipping/Stripe à reprendre à la réactivation [LATENT]
- [ ] Shipping réactivé → estimation fallback bloque paiement (P1-9)
- [ ] Review après completed (shipping) → jamais reviewable J+7 (P1-11)
- [ ] Aucun écran admin litiges (P1-13) : vendeur gelé sans SLA

---

## 9. Avis & Ventes

_Routes : `/review/[transactionId]`, `/my-sales`, `/my-orders`, `/user/[id]`._

> ℹ️ **Périmètre actuel (`SHIPPING_ENABLED = false`)** — Aucune vente en ligne (Stripe) : la transaction qui rend un avis possible passe **uniquement par le main-à-main (meetup)**. Le flow de récolte d'avis testable est donc « meetup → meetup_completed → avis » (sous-bloc 6). Le flow « achat Stripe → delivered → avis » (sous-bloc 5) est conservé hors scope. Réactivable via `config/featureFlags.ts`.

### 1. Mes ventes (`app/my-sales.tsx`)
**Préconditions :** Vendeur connecté avec ≥1 vente (sellerId === userId).
- [ ] Liste ventes (image, titre, prix, statut, date)
- [ ] « Laisser un avis » visible si meetup_completed ET pas d'avis (delivered/completed = états livraison, hors scope actuel)
- [ ] Badge « Avis laissé » (checkmark vert) si avis déposé
- [ ] Tap carte → chat/article ; pull-to-refresh
- [ ] Vide « Aucune vente » + icône portefeuille ; chargement skeletons ; statuts variés ; non connecté « Connexion requise » + SE CONNECTER
- [ ] **Hotspot** : bouton avis actif uniquement statuts éligibles (meetup_completed en scope) ; après dépôt → « Avis laissé » (hasUserReviewedTransaction) ; liste rafraîchit les statuts

### 2. Mes commandes (`app/my-orders.tsx`)
**Préconditions :** Acheteur connecté avec ≥1 achat (buyerId === userId).
- [ ] Liste commandes (image, titre, prix, statut, date)
- [ ] « Laisser un avis » si meetup_completed ET pas d'avis → `/review/[transactionId]`
- [ ] Badge « Avis laissé » ; tap → chat (onglet Avis Loi 25) ; pull-to-refresh
- [ ] Vide « Aucune commande » + icône paquet ; skeletons ; statuts variés ; non connecté + SE CONNECTER
- [ ] **Hotspot** : avis seulement meetup_completed (en scope) ; changement statut temps réel (meetup_pending → meetup_completed)

#### ⏭️ HORS SCOPE ACTUEL (réactivable)
_Suivi livraison et deep-links liés au paiement en ligne (funds_released) / aux statuts d'expédition (shipped → delivered) : inaccessibles tant que SHIPPING_ENABLED=false (meetup seul, pas de Stripe en ligne)._
- [ ] « Laisser un avis » si delivered ET pas d'avis → `/review/[transactionId]`
- [ ] Tap → chat (suivi livraison) ; deep-link push (transactionId) → chat
- [ ] avis pour statut delivered ; deep-link funds_released → `/my-orders?transactionId=xxx` → chat ; changement statut temps réel (shipped → delivered)

### 3. Laisser un avis (`app/review/[transactionId]`)
**Préconditions :** Connecté, statut meetup_completed (delivered hors scope actuel), acheteur OU vendeur, pas déjà évalué, <60 jours.
- [ ] Aperçu article (image + titre) + autre partie (« Vendu par {nom} » / « Acheté par {nom} »)
- [ ] Étoiles 1-5 (haptic + libellé Mauvais/Décevant/Correct/Bien/Excellent)
- [ ] Commentaire (max 2000, compteur, vide → « Bonne transaction. »)
- [ ] ENVOYER actif si note ≥1 ET (vide OU ≥5 car) → « Envoi en cours… » → succès alerte → back
- [ ] Au retour : bouton → « Avis laissé »
- [ ] Non connecté « Connectez-vous… » ; chargement « Chargement… » ; introuvable « Transaction introuvable. » ; non éligible « Vous pourrez laisser un avis une fois terminée. » ; déjà laissé « Vous avez déjà laissé un avis. » ; 60j dépassée « La période… est expirée » ; pas autorisé « Vous n'êtes pas autorisé… » ; contenu invalide « informations invalides »
- [ ] Validation client : note requise « Note requise » ; commentaire 1-4 car « trop court » ; vide accepté → défaut
- [ ] iOS KeyboardAvoidingView (padding) ; Android (undefined) ; haptics tap étoile
- [ ] **Hotspots** : images aperçu se chargent (blurhash + URL) ; anti-double envoi (bouton disabled + « Envoi en cours… ») ; après succès badge « Avis laissé » (invalidate orders.all) ; notification au noté (in-app garantie ; push Android OK, iOS non)

### 4. Profil public — Onglet Avis (`app/user/[id]`)
_Voir aussi section 2._
- [ ] En-tête : note moyenne (« 4.7 ») + nombre avis (« 128 évaluations »)
- [ ] Liste 10 récents : avatar/initial, nom, étoiles, texte, date FR
- [ ] Tap avatar → profil auteur
- [ ] Vide « Les avis de vos acheteurs… » (propre) / « Aucun avis » (tiers) ; chargement spinner
- [ ] **Hotspots** : moyenne correcte 15+ avis (PAS limité aux 10 premiers — audit #05) ; date FR « 20 mai 2026 » (pas ISO brut) ; notification « Nouvel avis reçu » ; confidentialité photo (si masquée → pas affichée)

### 5. Flow complet achat + avis

> ⏭️ **HORS SCOPE ACTUEL** — Flow d'achat en ligne via Stripe (PROPOSER UN ACHAT route uniquement vers meetup, jamais vers le checkout Stripe ; cf. `config/featureFlags.ts`, `app/checkout/index.tsx:60-69`). Le flow de récolte d'avis en scope est le sous-bloc 6 (meetup). Conservé pour réactivation.

#### ⏭️ HORS SCOPE ACTUEL (réactivable)
- [ ] Achat → paiement Stripe → pending_payment → delivered → « Laisser un avis » visible
- [ ] Note + commentaire → ENVOYER → succès → retour « Avis laissé »
- [ ] Vendeur profil → onglet Avis → nouvel avis ; moyenne recalculée ; notification (in-app OK, push selon plateforme)
- [ ] Tous statuts valides ; avis unique (pas de doublon double tap) ; notification vendeur ; moyenne+compteur mis à jour
- [ ] iOS/Android : Payment Sheet, haptics, push Android OK iOS in-app
- [ ] **Hotspots** : push iOS in-app OK push système absent ; avis avec article supprimé (titre « Article indisponible » ou vide)

### 6. Flow meetup + avis _(flow de récolte d'avis principal en scope)_
- [ ] Achat « Remise en main propre » (CTA « PROPOSER UN ACHAT » → checkout meetup auto-sélectionné, sans choix livraison) → fonds retenus (0 application_fee, frais=0) → vendeur confirme → meetup_completed → « Laisser un avis »
- [ ] Avis bidirectionnel (achat + vente) ; coexistent sur transaction ; zéro frais (fee=0)
- [ ] **Hotspot SHIPPING_ENABLED=false** : meetup seul, avis accessible après meetup_completed
- [ ] Avis avec article supprimé (titre « Article indisponible » ou vide)

### 7. Gestion erreurs & cas limites
- [ ] Cas 1 : avis déjà existant → already-exists → « déjà laissé un avis »
- [ ] Cas 2 : 60j dépassée → failed-precondition → « période expirée »
- [ ] Cas 3 : pas éligible (meetup_pending ; pending_payment/shipped hors scope) → « une fois terminée »
- [ ] Cas 4 : pas autorisé (tiers) → permission-denied → « pas autorisé »
- [ ] Cas 5 : contenu invalide (grossièretés) → invalid-argument → « informations invalides »
- [ ] Cas 6 : commentaire 1-4 car « trop court » ; vide → défaut
- [ ] Cas 7 : réseau coupé → « Une erreur est survenue » + état préservé (note+commentaire)
- [ ] Cas 8 : transaction inexistante → « Transaction introuvable »
- [ ] Messages erreur en FR ; back sans perte ; pas d'avis partiel
- [ ] Validation client vs serveur cohérente ; double soumission (disabled + « Envoi en cours… »)

### 8. Échange (swap) + avis
_Swap item-contre-item sans complément cash (le cash top-up Stripe est hors scope — cf. section 11)._
- [ ] Swap completed → « Laisser un avis » → avis type swap → profil destinataire : moyenne mélange achat+vente+swap (une seule note globale)
- [ ] Swap éligible si completed ; avis swap stocké ; moyenne recalculée ; notification
- [ ] **Hotspot swap ratings silotées (#05)** : avis échange propage vers moyenne globale (pas isolé swaps/{id})

### Points chauds prioritaires Avis
- [ ] Push iOS in-app OK push hors-app non
- [ ] Images articles aperçu se chargent (blurhash + URL)
- [ ] Moyenne correcte 15+ avis
- [ ] Expédition désactivée (avis après meetup_completed)
- [ ] Anti-doublon avis (identifiant déterministe + transaction atomique)
- [ ] Swap ratings propagent vers moyenne globale
- [ ] Confidentialité photo (Loi 25 — masquée non affichée)

#### ⏭️ HORS SCOPE ACTUEL (réactivable)
_Deep-link depuis notification de paiement/livraison en ligne (funds_released) : inaccessible sans paiement Stripe en ligne._
- [ ] Deep-link depuis notification

---

## 10. Porte-monnaie, Paiements vendeur & Recours

> ⏭️ **PÉRIMÈTRE ACTUEL** — `SHIPPING_ENABLED = false` (`config/featureFlags.ts:17`) force tout en main-à-main (meetup). Sans vente en ligne, **aucun crédit ne remplit le porte-monnaie**, donc payouts/retraits, paiement Stripe (Payment Sheet), suivi d'expédition et recours/remboursement (litige financier) sont **inaccessibles en pratique** et marqués hors scope. Restent testables : l'**UI du porte-monnaie** (navigation + états, restera vide) et l'**admin Litiges en lecture seule** (qui couvre aussi les litiges « Rencontre manquée » du flow meetup). Tout est conservé pour réactivation (repasser le drapeau à `true`).

_Routes : `app/wallet.tsx`, `app/settings/payments.tsx`, `app/settings/stripe-onboarding.tsx`, `app/payment/[transactionId].tsx`, `app/admin/disputes.tsx`, `components/{ShipmentTracking,RecourseReasonSheet}.tsx`._

### Porte-monnaie — UI accessible (`app/wallet.tsx`)

> ⚠️ **PIÈGE UX à signaler** : l'entrée « Mon porte-monnaie » (`app/settings/index.tsx:179-183`) est **inconditionnelle** (aucun gate `SHIPPING_ENABLED`). Le testeur peut donc atteindre l'écran, mais sans vente en ligne il restera **vide** (aucun crédit `sale_credit`). Tester surtout l'**état non activé** et l'**activation** (qui n'apporte aucun revenu en meetup). Toute case impliquant un **solde > 0**, une **poche en attente/gelée**, un **retrait** ou un **ledger crédité** est de facto hors scope tant que SHIPPING_ENABLED=false (cf. sous-bloc hors scope).

#### État 1 : Non activé
- [ ] Écran activation (icône wallet, « Activez votre porte-monnaie » + description)
- [ ] « Activer » → loader → transition État 2
- [ ] Erreur réseau → alerte FR

#### État 2 : Actif — poche vide attendue (meetup = aucun revenu en ligne)
- [ ] **Solde disponible** : affiche 0,00 $ (aucun `sale_credit` possible en meetup) + libellé + fond charcoal/blanc
- [ ] Aucune poche « En attente » ni « Bientôt disponible » alimentée (pas de vente en ligne)
- [ ] **Ledger** vide → empty state « Aucune transaction »

### Admin Litiges — lecture seule (`app/admin/disputes.tsx`)
_Voir aussi section 14. Couvre les litiges « Rencontre manquée » (meetup no-show) + « Problème de transaction » ; pas de résolution financière dans l'app._
- [ ] Garde-fou non-admin → « Accès refusé » + redirect
- [ ] Onglets Ouverts (open) / Tous (open+resolved+dismissed) → refetch
- [ ] Chargement skeleton 3-4 cartes ; refresh spinner
- [ ] Vide : open « Aucun litige en attente… » / all « Aucun litige enregistré » + bouclier
- [ ] **LECTURE SEULE** : pas d'édition/suppression
- [ ] Carte : badge type (« Rencontre manquée »/« Problème de transaction ») + badge statut (Ouvert/Résolu/Rejeté) + titre article + raison lisible + détails (4 lignes) + métadonnées (transactionId, buyerId, sellerId, reportedBy, date FR)
- [ ] Bouton Actualiser header + loader

#### ⏭️ HORS SCOPE ACTUEL (réactivable)

> ⏭️ **Porte-monnaie alimenté & retraits** — Sans vente en ligne (meetup = cash main-à-main), le wallet n'est jamais crédité ; les poches en attente/gelées, la dette vendeur, le bouton/formulaire Retirer et le ledger crédité sont inatteignables. Le bouton « Retirer » exige aussi `stripeAccountId` + `stripePayoutsEnabled` (`app/wallet.tsx:257-271`) qui ne s'activent jamais en meetup. Réactiver avec SHIPPING_ENABLED=true.

##### Porte-monnaie — État 2 (trois poches) [HORS SCOPE]
- [ ] **Solde disponible** : montant (45,00 $) + « Retirable à tout moment » + fond charcoal/blanc
- [ ] **En attente** (si >0) : « {montant} en attente » + icône horloge + « Vente en cours… » + fond warm + retrait bloqué
- [ ] **Bientôt disponible** (séquestre 7j, si >0) : « {montant} bientôt disponible » + cadenas + « Disponible le {date} » (J+7) + fond warning-light
- [ ] **Banner dette vendeur** (si sellerDebt>0) : fond danger-light + « Régularisation nécessaire » + Retirer grisé + lecture seule

##### Porte-monnaie — Bouton Retirer + formulaire [HORS SCOPE]
- [ ] Visible/actif si solde>0 ET aucune poche en attente/gelée ; grisé si dette
- [ ] Clic → vérifie Stripe Connect ; sinon alerte + lien setup ; pré-remplit solde
- [ ] Formulaire : montant + « $ » + « min 10,00 $ » + Annuler/Confirmer
- [ ] Confirmer : valide ≥10 + ≤solde → alerte confirmation → loader → succès « Retrait envoyé… 2-3 jours ouvrés »
- [ ] Erreur failed-precondition + « litige » → « Retrait momentanément indisponible. Un litige… » ; « dû/régularis/debt » → « Vous avez un montant à régulariser… »

##### Porte-monnaie — Protection 7j + Ledger crédité [HORS SCOPE]
- [ ] Note « Protection Seconde » (bouclier vert) + 7 jours + clic → alerte texte complet
- [ ] Ledger trié date décroissante : icône type + description + date relative + montant signé
- [ ] Credit (sale_credit, refund_credit, funds_released, withdrawal_failed) → +vert
- [ ] Debit (purchase_debit, withdrawal) → −rouge
- [ ] Vide « Aucune transaction »

##### Porte-monnaie — Pull-to-refresh / Erreurs (données alimentées) [HORS SCOPE]
- [ ] Geste refresh + spinner + données rechargées ; erreur réseau → alerte
- [ ] Loading skeleton (solde + ledger) ; erreur non-bloquante + Réessayer ; auth requise → connexion

> ⏭️ **Paiements (placeholder)** — Page conservée sans action ; sans paiement en ligne elle reste décorative. Réactiver avec le paiement en ligne.

##### Paiements (placeholder) (`app/settings/payments.tsx`) [HORS SCOPE]
- [ ] Header + info box sécurité + « Cartes enregistrées » + empty « Aucune carte » + hint « bientôt » ; aucun bouton ; page conservée

> ⏭️ **Onboarding Stripe Connect** — L'écran est techniquement atteignable depuis les réglages (`app/settings/index.tsx:173-178`, sans gate), mais **sans vente en ligne (meetup) les payouts ne s'activent jamais** : l'inscription ne sert à rien côté revenu meetup. PIÈGE UX à signaler : masquer le lien ou ajouter un message d'explication tant que SHIPPING_ENABLED=false. Bloc conservé pour réactivation.

##### Onboarding Stripe Connect (`app/settings/stripe-onboarding.tsx`) [HORS SCOPE]
_Voir aussi section 2._
- [ ] Garde-fou auth (non connecté → alerte + Configurer → login)
- [ ] Garde-fou ≥18 ans (<18 → « Accès refusé » + COPY_SELL_GATE + Continuer)
- [ ] Chargement skeleton ; compte actif (chargesEnabled) → card verte « actif », form masqué ; en vérification → card bleue « Configuration en cours » + Actualiser si detailsSubmitted=false ; aucun compte → card neutre + form complet
- [ ] Form perso : Prénom/Nom (max 50, pré-rempli displayName) + DOB JJ/MM/AAAA (1-31/1-12/1900-courant, date valide, **≥18**)
- [ ] Form adresse : Adresse (100) + Ville (50, pré-rempli) + Province 2 lettres (pré-rempli QC, liste AB-YT) + CP (A1A 1A1 formatage auto + regex)
- [ ] Form bancaire : Transit (5 digits) + Institution (3) + Compte (7-12) + description sécurité
- [ ] Bouton « Configurer mon compte » (shield) désactivé tant que champs incomplets/invalides
- [ ] Clic → valider → loader → createStripeConnectAccount → « prêt ! » / « en vérification » / erreur
- [ ] Info box sécurité Stripe (fond bleu)
- [ ] États : chargement skeleton, <18 refus, validation complète, succès/error, CP invalide, offline
- [ ] **HOTSPOT P0 Stripe** : champs non verrouillés Firestore rules → vendeur peut rediriger payout vers compte tiers

> ⏭️ **Paiement Stripe Payment Sheet** — Le checkout route **toujours** vers meetup (`app/checkout/index.tsx:60-69`) et le bouton article affiche « PROPOSER UN ACHAT » (`features/article/components/ArticleCTABar.tsx:88-92`) ; `createStripeCheckout` / `payWithWallet` ne sont jamais atteints. Réactiver avec SHIPPING_ENABLED=true.

##### Paiement Stripe Payment Sheet (`app/payment/[transactionId].tsx`) [HORS SCOPE]
_Voir aussi sections 6 & 8._
- [ ] Préconditions : connecté acheteur, pending_payment, montant>0
- [ ] Chargement skeleton (récap + adresse + wallet)
- [ ] Erreur : introuvable / non buyer / déjà traitée / réseau « Erreur de connexion… »
- [ ] Récap : Article + Livraison (0$ meetup) + Frais protection (max(2 ; 5%+1,50$)) + Total rust « 59,25 $ CA »
- [ ] Adresse livraison (nom, rue, CP+ville) si shippingAddress
- [ ] Wallet (si actif solde>0) : toggle + solde ; reste à payer carte (bleu) ; couvre total → « PAYER AVEC LE PORTE-MONNAIE »
- [ ] Logique : wallet couvre → payWithWallet (pas Stripe) → « Paiement confirmé… étiquette générée » ; partiel/stripe → createStripeCheckout → clientSecret → Payment Sheet → succès polling 12s → confirmer ; annulation → pas d'alerte, reste
- [ ] Footer : PAYER (cadenas/wallet) désactivé pendant checkout/showStripe + disclaimer CGV
- [ ] iOS/Android Payment Sheet natif, texte identique

> ⏭️ **Suivi expédition & Recours** — Tout repose sur le shipping (étiquette, transporteur, livraison, retour). Avec SHIPPING_ENABLED=false les transactions sont meetup (pas d'étiquette) et les boutons « Signaler »/« Retour » sont masqués. Recours/remboursement = mécanisme Stripe/escrow inexistant en meetup (cash). Réactiver avec SHIPPING_ENABLED=true.

##### Suivi expédition & Recours (`components/ShipmentTracking.tsx`) [HORS SCOPE]
- [ ] label_created : pricetag primary « Étiquette créée »
- [ ] shipped/in_transit : avion primary « En transit » (+ transporteur), aucun recours
- [ ] out_for_delivery : voiture warning « En cours de livraison »
- [ ] delivered : checkmark success « Livré », acheteur peut demander retour
- [ ] delivery_failed/lost : alerte danger « Problème de livraison », recours auto (refund direct)
- [ ] return_requested : indicateur flux retour
- [ ] Fenêtre litige (delivered) : « dans {N} jours… libéré le {date} » (fundsReleaseAt), mis à jour au refresh
- [ ] **Boutons acheteur** : delivery_failed/lost → « Demander un remboursement » → confirmation → requestRefund → « Demande envoyée » ou refund_failed « indisponible » + « Signaler un problème »
- [ ] delivered → « Demander un retour » (returnSheetRef) ; shipped/delivered → « Signaler un problème » (reportSheetRef)
- [ ] **Sheet Signaler** : raisons (not_received_despite_delivered, not_as_described, damaged, other) + champ libre + Soumettre → reportProblem → ferme → « Signalement envoyé… 48h » + onStatusUpdate (statut disputed)
- [ ] **Décision automatisée** : dépliant « Pourquoi cette décision ? » (critères lisibles) + « Contester cette décision »
- [ ] **Sheet Retour** : raisons (not_as_described, damaged, wrong_item, other) + footer « frais retour prélevé » + Soumettre → requestReturn → « étiquette de retour achetée » + onStatusUpdate (return_requested)
- [ ] Actualiser suivi → checkTrackingStatus + loader + haptic ; erreur « Impossible de mettre à jour »
- [ ] Lien suivi transporteur (Linking.openURL + haptic) ; télécharger étiquette (≤label_created, vendeur)

> ⏭️ **Sélecteur raisons recours** — Composant exclusivement consommé par le flux de recours shipping ci-dessus ; inatteignable sans shipping. Réactiver avec SHIPPING_ENABLED=true.

##### Sélecteur raisons recours (`components/RecourseReasonSheet.tsx`) [HORS SCOPE]
- [ ] Bottom sheet réactif (55-85%) + backdrop + drag handle + clavier (Android adjustResize)
- [ ] Titre/intro parent ; raisons checkbox-style (sélectionnée fond primary + checkmark) ; champ libre (si showDetailsField, max 1000, placeholder) ; footer note (fond warning-light)
- [ ] Annuler → ferme + reset ; Soumettre (label parent) désactivé si aucune raison → onSubmit(code, details) + loader + disabled
- [ ] présent()/dismiss() imperative

> ⏭️ **Points chauds Porte-monnaie / Recours** — Dépendent du paiement en ligne / shipping / wallet alimenté. Réactiver avec le paiement en ligne et SHIPPING_ENABLED=true.

##### Points chauds Porte-monnaie / Recours [HORS SCOPE]
- [ ] 🔴 **Push iOS** : in-app OK (remboursement, retour accepté, litige résolu), push hors-app non ; Android OK
- [ ] 🟡 **Expédition désactivée** : transactions meetup (pas d'étiquette) ; recours shipping (delivery_failed, lost) à réactivation ; boutons « Signaler »/« Retour » masqués si SHIPPING_ENABLED=false
- [ ] 🟡 **Fenêtre litige 7 jours** : heldBalance après livraison ; libération auto J+7 (Loi 25 art. 12.1) ; litige interrompt (disputed=true → gelé jusqu'à résolution admin)
- [ ] 🟡 **Bug upload photos + IA** : brouillon sauvegardé si échec, reprise possible
- [ ] 🟡 **Dette vendeur** : remboursement acheteur après retrait vendeur → sellerDebt créé ; Retirer grisé + alerte ; régularisation front office manuel
- [ ] 🟡 **Litiges lecture seule** : admin consulte mais NE résout PAS dans l'app (callable serveur adminRefundTransaction) ; signaler si litige non résolu >48h
- [ ] 🟡 **Remboursement partiel** : « Demander un retour » → étiquette retour → remboursement = total − coût étiquette ; footer note ; après acceptation montant net

> ⏭️ **Intégrations métier transverses** — Toutes reposent sur paiement en ligne / wallet alimenté / recours shipping. Réactiver avec le paiement en ligne et SHIPPING_ENABLED=true.

##### Intégrations métier transverses [HORS SCOPE]
- [ ] Achat : wallet + carte (partiel), 100% wallet (si suffisant), wallet vide → carte, toggle ajuste montant
- [ ] Retrait : solde≤0 inactif, solde>0 && debt=0 actif, min 10$, refus si insuffisant
- [ ] Remboursement : livraison échouée → crédite (refund_credit), retour accepté → crédite (montant − frais)
- [ ] Recours : delivered + J<7 boutons dispo ; J+7 sans litige → fonds libérés (decision auto + notif) ; litige → disputed=true gelé
- [ ] Décisions automatisées Loi 25 : journalisées (automatic_decisions_log), affichées, contestables (automated_decision_contestations)

> ⏭️ **iOS vs Android Porte-monnaie/Recours** — Concernent Payment Sheet, retrait et recours shipping, tous hors scope. Le différentiel admin disputes (read-only) reste couvert plus haut. Réactiver avec le paiement en ligne et SHIPPING_ENABLED=true.

##### iOS vs Android Porte-monnaie/Recours [HORS SCOPE]
- [ ] Porte-monnaie : push non-op iOS / OK Android → notif in-app iOS
- [ ] Paiement : Payment Sheet natif identique ; Retrait : bottom sheet (Android adjustResize)
- [ ] Recours : haptics+sound iOS / haptics only Android
- [ ] Admin disputes : read-only identique

---

## 11. Swap & SwapZone

_Routes : `app/swap-zone.tsx`, `app/my-swaps.tsx`, `app/propose-swap.tsx`, `app/swap/[id].tsx`, `app/swap-parties.tsx` (redirect), `app/swap-party/[id].tsx` (redirect)._

> ℹ️ **Périmètre actuel** — Le swap **article-contre-article** (sans complément en argent) est PLEINEMENT dans le scope. Seul le **complément en argent (cash top-up)** est HORS SCOPE : il passe par Stripe (`createSwapTopUpCheckout` → PaymentIntent), désactivé tant que le paiement en ligne n'est pas réactivé (cf. `config/featureFlags.ts`, `SHIPPING_ENABLED = false`). Les sections « complément argent » et « paiement complément » sont déplacées en bas de chaque sous-bloc concerné, conservées pour réactivation.

### Points chauds prioritaires SwapZone
- [ ] **Critique 2 Articles vendus visibles** : article acheté (isSold=true) reste swappable dans la zone → échoue à la soumission → devrait disparaître de la grille
- [ ] **Critique 3 Race TOCTOU** : quitter la zone pendant qu'un autre propose un swap sur ces articles → incohérence (correction backend)
- [ ] **Haute 1 Push iOS** : notif swap_proposed ne route pas au tap iOS ; push hors-app n'arrive pas (Android OK)
- [ ] **Moyenne 1 Notification declined** : initiateur décline → notif dit « ReceiverName a refusé » (faux nom)

#### ⏭️ HORS SCOPE ACTUEL (réactivable)
> Raison : complément en argent = paiement en ligne (Stripe `createSwapTopUpCheckout`), désactivé tant que `SHIPPING_ENABLED = false`. Conservé pour réactivation.
- [ ] **Critique 1 Cash top-up** : section « Ajouter un complément en argent » interactive mais rejette systématiquement « pas encore disponible » → devrait être désactivée/grisée OU masquée

### Swap Zone (`app/swap-zone.tsx`)
**Préconditions :** Connecté, zone existe (self-healing ensureGeneralistZone), articles d'autres vendeurs actifs non vendus, pas d'articles propres dans la grille, articles en swap pending/accepted exclus (isPending).

#### Flux 1 : Affichage initial
- [ ] Chargement : SwapPartyDetailSkeleton
- [ ] Succès : « Mes articles » + filtres (Trier, Catégorie, Taille, Couleur, Marque, Matière, État) + grille autres
- [ ] Compteur « Articles disponibles · N » mis à jour aux filtres
- [ ] Vide « Aucun article correspondant » + « Effacer les filtres » ; erreur + Réessayer ; pull-to-refresh (Android + iOS)
- [ ] iOS pull-to-refresh tintColor ; Android identique

#### Flux 2 : Déposer mes articles
- [ ] « + Ajouter » → auth gate si invité → AddItemSheet (liste articles disponibles, miniature 48×60 + titre + prix)
- [ ] Multi-sélection (highlight + checkmark) ; « Déposer » → spinner + skeleton rows pending → vrais articles + ferme + toast « Articles ajoutés »
- [ ] Articles dans « Mes articles » + grille générale
- [ ] Chargement spinner ; aucun article « Aucun article à ajouter » ; dépôt skeletons ; erreur « Impossible d'ajouter » ; multi-sélection 3 articles

#### Flux 3 : Retirer un article
- [ ] Tap article « Mes articles » → confirmation « retirer cet article ? » → « Retirer » (rouge)
- [ ] Optimiste : disparaît immédiatement (pas de spinner) de « Mes articles » + grille ; erreur réseau → réapparaît + alerte
- [ ] Re-dépôt possible

#### Flux 4 : Filtrer
- [ ] Chaque puce → bottom sheet options ; multi-select (Couleur/Marque/Matière) ; Confirmer → grille filtrée + puce active + compteur
- [ ] Intersection multi-filtres (Couleur=Noir ET Marque=Nike) ; 0 résultats → vide + « Effacer les filtres »
- [ ] iOS/Android bottom sheets Gorhom

#### Flux 5 : Multi-select (proposer plusieurs articles)
- [ ] Long-press article vendeur X → haptic Medium → multi-select mode + MultiSelectBar compteur
- [ ] Verrouillé au vendeur X (autre vendeur ne réagit pas/désélectionne)
- [ ] Tap ajoute/retire ; sélection vide → mode désactivé ; « Proposer » → `/propose-swap` (articles + vendeur pré-remplis)
- [ ] Barre « N article(s) sélectionné(s) · Proposer » ; sélection distincte (couleur/checkmark)
- [ ] Long-press haptic ; sélection 1/3 ; articles filtrés cachés (intersect otherItems) ; vendor-lock ; annulation reset ; back Android annule

### Proposer un échange (`app/propose-swap.tsx`)
**Préconditions :** Connecté, vendeur cible avec articles actifs, pas blocage mutuel (ModerationService).

#### Flux 1 : Single-tap
- [ ] `/propose-swap?...&receiverItems=JSON[1]` → récepteur + article pré-remplis
- [ ] « Leur article » (miniature + titre + prix) ; « Mon article proposé » vide + « + Ajouter » ; message ; « Proposer » grisé tant que « Mon article » vide

#### Flux 2 : Multi-select
- [ ] « Proposer » barre → `/propose-swap?...&receiverItems=JSON[3]` → 3 articles stackés

#### Flux 3-5 : Sélectionner / Retirer / Message
- [ ] « + Ajouter » → SwapItemSelector (articles actifs non-vendus pas en zone) ; multi-select + Confirmer ; aucun → « Aucun article disponible »
- [ ] Mes articles affichés → « Proposer » actif (articles des 2 côtés)
- [ ] Retirer (× ou swipe) → immédiat ; côté vide → bouton inactif
- [ ] Message optionnel (max 500)

#### Flux 7 : Soumettre
- [ ] « Proposer l'échange » → spinner → vérif backend (articles existent/non vendus/non swap pending, pas bloqués)
- [ ] Succès → « Proposition envoyée ! » → `/my-swaps` ; récepteur notifié
- [ ] Bloqués → « Tu ne peux pas proposer d'échange avec cet utilisateur » ; indisponibles → « Impossible d'envoyer »
- [ ] Erreur réseau + retry ; double-tap désactivé ; vendus entre-temps rejet

#### ⏭️ HORS SCOPE ACTUEL (réactivable)
> Raison : le complément en argent passe par Stripe (paiement en ligne), désactivé tant que `SHIPPING_ENABLED = false`. La section UI « complément » reste affichée mais rejette à la soumission. Conservé pour réactivation.

##### Flux 6 : Complément argent (rejette toujours)
- [ ] Section « Ajouter un complément » : input $ + toggle payeur + « Suggestions »
- [ ] « Proposer » → REJECTION « Le complément monétaire n'est pas encore disponible »
- [ ] **ATTENDU** : section grisée/disabled OU masquée + « Bientôt disponible »

### Détail d'un échange (`app/swap/[id].tsx`)
**Préconditions :** Swap existe, user = initiateur OU récepteur. États : proposed, payment_pending, accepted, photos_pending, shipping, completed, declined, cancelled, disputed.

#### Flux 1 : Recevoir proposition (récepteur, proposed)
- [ ] Badge « NOUVEAU » + SwapProposalView (avatar + nom + message + ses articles StackedImages + flèche + mes articles + prix)
- [ ] « Accepter » (sage) + « Refuser » (gris) ; Accepter → spinner → accepted → temps réel (subscribeToSwap) → boutons étapes suivantes
- [ ] Chargement SwapDetailSkeleton ; vue proposée layout/images ; acceptation spinner/transition ; erreur « Impossible d'accepter »

#### Flux 2-3 : Refuser / Annuler
- [ ] Refuser (récepteur) → confirmation → declined + notif initiateur (HOTSPOT mauvais nom si initiateur décline) → router.back()
- [ ] Annuler (initiateur, proposed) → confirmation → cancelled → back

#### Flux 5 : Upload photos (accepted)
- [ ] « Envoyer les photos » → picker (max 4) → Confirmer → compression + upload Storage → spinner (5-30s) → « Photos envoyées » (statut reste accepted)
- [ ] Autre partie voit photos ; aucune photo (optionnel) ; 1/4 photos ; erreur « Impossible d'envoyer »

#### Flux 6-8 : Mode / Envoi / Réception
- [ ] Mode (Livraison vs Main propre) → setExchangeMode → statut avance
- [ ] Confirmer l'envoi (shipping) → confirmation → shipping + notif
- [ ] Confirmer la réception → confirmation → completed → boutons évaluer

#### Flux 9-10 : Évaluer / Litige
- [ ] Évaluer (completed, hasRated=false) → 5 étoiles + commentaire → « Merci ! » → note publique profil
- [ ] Litige (pas completed/declined/cancelled) → motif + description → disputed + notifs modérateurs + autre partie

#### ⏭️ HORS SCOPE ACTUEL (réactivable)
> Raison : l'état `payment_pending` et le règlement du complément passent par Stripe (`createSwapTopUpCheckout` → feuille Stripe), désactivé tant que `SHIPPING_ENABLED = false`. Conservé pour réactivation.

##### Flux 4 : Paiement complément (payment_pending, rejette toujours)
- [ ] Alerte « Complément de X $ » + « Régler le paiement » → feuille Stripe → succès accepted ; erreur « Paiement échoué » ; annulation → reste payment_pending
- [ ] **ÉTAT RÉEL** : complément rejette backend (test dépend correction)

### Mes échanges (`app/my-swaps.tsx`)
**Préconditions :** Connecté, ≥1 swap.
- [ ] Chargement skeleton 3 cartes ; succès liste + filtres (Tous/En attente/En cours/Historique) ; vide « Aucun échange » + « Découvrir la Swap Zone » ; erreur + Réessayer
- [ ] Carte : avatar + nom + statut badge coloré + StackedImages + flèche + valeurs (« 2 articles · 45 $ ↔ 1 article · 40 $ ») + date relative
- [ ] Filtres : En attente=proposed ; En cours=payment_pending/accepted/photos_pending/shipping/disputed ; Historique=completed/declined/cancelled ; badges compteurs
- [ ] Filtre vide « Aucun échange dans cette catégorie » ; tap carte → `/swap/{swapId}` ; pull-to-refresh

### Flux cross-domain Swap
- [ ] Blocage : A bloque B → propose-swap à B → « Tu ne peux pas proposer… » (ModerationService propose-swap:212)
- [ ] Articles vendus : A dépose → B découvre → C achète (isSold=true) → B voit toujours → soumission échoue (CRÍTICO devrait être invisible/grisé)
- [ ] Notifications swap_proposed : iOS in-app OK / push hors-app NON ; Android in-app + push OK (ouvre swap)

### Cas limites Swap
- [ ] Aucun article zone → « Aucun article correspondant » + « Effacer les filtres »
- [ ] User sans articles disponibles → modal « Aucun article disponible »
- [ ] Swap 0 articles (edge technique) → backend valide / StackedImages 0 items gracieux (pas de crash)

#### ⏭️ HORS SCOPE ACTUEL (réactivable)
> Raison : cas limite portant sur le complément en argent + feuille Stripe (paiement en ligne), désactivé tant que `SHIPPING_ENABLED = false`. Conservé pour réactivation.
- [ ] Multi-article valeurs très différentes (10$ vs 100$, complément 90$) : ValueComparisonBox + Stripe (une fois implémenté)

### Récap hotspots SwapZone
- [ ] Articles vendus visibles (CRÍTICO supprimer de la zone)
- [ ] Push iOS (HAUTE documenter)
- [ ] Notification declined mauvais nom (MOYENNE)
- [ ] Multi-select vendor-lock
- [ ] Filtrage optimiste + squelettes
- [ ] Articles filtrés non comptés multi-select (intersection otherItems)
- [ ] Haptic Medium long-press
- [ ] Real-time updates (subscribeToSwap)
- [ ] Retrait optimiste + rollback
- [ ] **Perf backend** : N+1 reads getPartyItemsExtended (HAUTE) ; isPending non filtré getPartyItems (HAUTE) ; FlashList sans estimatedItemSize (HAUTE) ; race TOCTOU leaveSwapPartySecure (CRITICAL)

#### ⏭️ HORS SCOPE ACTUEL (réactivable)
> Raison : hotspot lié au complément en argent (paiement en ligne Stripe), désactivé tant que `SHIPPING_ENABLED = false`. Conservé pour réactivation.
- [ ] Complément argent (CRÍTICO masquer/griser)

---

## 12. Messagerie & Modération

_Routes : `app/(tabs)/messages.tsx`, `app/chat/[id].tsx`, `app/admin/reports.tsx`._

> ℹ️ **Périmètre actuel** : `SHIPPING_ENABLED=false` → toutes les transactions issues du chat sont des **meetup** (main-à-main, cash/virement hors app, zéro frais, aucun appel Stripe). Les offres et le contexte article reflètent ce mode (« PROPOSER UN ACHAT », pas « ACHETER »). Le suivi d'expédition, les messages système « étiquette/expédiée » et le complément argent (swap) sont déplacés en bas de section (réactivables).

### 1. Liste conversations (`app/(tabs)/messages.tsx`)
**Préconditions :** Connecté (sinon « Connexion requise »), ≥1 conversation.
- [ ] Deux onglets VENTES / ACHATS ; tri dernière activité
- [ ] Ligne : avatar + nom + vignette article + titre + aperçu (texte/[Photo]/[Offre]/système) + horodatage + pastille non-lus
- [ ] Badge onglet Messages = total non-lus ; marquées lues à l'ouverture chat
- [ ] Non connecté → « Connexion requise » ; chargement squelettes ; erreur + Réessayer ; vide « Aucune conversation » ; bloqué (drapeauage lisible) ; générale (sans article) → ACHATS
- [ ] iOS/Android identique
- [ ] **Push iOS** : notif in-app OK (badge + centre), push hors-app non

### 2. Écran chat (`app/chat/[id].tsx`)
**Préconditions :** Connecté (sinon redirection Profil), conversation existe + partie, autre non bloqué (serveur).
- [ ] En-tête : avatar + nom (cliquable profil) + prix + « … » modération
- [ ] Barre contexte article (photo, titre, prix CAD, « VOIR ») ; vendu → « VENDU » ; indisponible → grisé
- [ ] Transaction meetup (statut ≠ pending_payment) → bloc transparence Loi 25 (ShipmentTracking se réduit au meetup : confirmation/annulation auto, jamais de tracker d'expédition tant que `SHIPPING_ENABLED=false`)
- [ ] Messages tri croissant + auto-scroll ; types texte/photo/offre/système
- [ ] Saisie : texte ≤1000 + bouton photo + bouton offre « $ » + envoyer
- [ ] Envoyer texte → haptique + immédiat + compteur non-lus
- [ ] Photo → compression (1024px, q70%) + EXIF retiré + aperçu
- [ ] Offre → modale montant + lieu meetup + confirmation → 48h (meetup uniquement, aucune option livraison/adresse)
- [ ] Recevoir offre → bulle + Accepter/Refuser/Contre-offrir
- [ ] Signaler/Bloquer via « … »
- [ ] Chargement squelette ; erreur + Réessayer ; vide « Aucun message » ; article supprimé (barre disparaît, offre reste ⚠️) ; bloqué (envoi impossible) ; générale (barre absente, offre désactivée)
- [ ] iOS clavier remonte (padding) ; Android natif ; bottom sheet montée à l'ouverture (Android)
- [ ] **Points chauds** : article supprimé → ChatArticleBar disparaît mais offre cliquable (C1) ; push iOS in-app+badge OK push système non ; conversation générale offre désactivée ; meetup forcé → `defaultMode='meetup'` même pour articles legacy `isShipping=true`

### 3. Offres & négociation chat (MakeOfferModal)
_Voir aussi section 7._
- [ ] Créer offre : « $ » → modale → montant (>0, ≤50 000$) + lieu meetup + « Aucun frais » → Envoyer → message système + pending 48h
- [ ] Recevoir : bulle (montant, lieu, expiration) + Accepter/Refuser/Contre-offrir
- [ ] Accepter → accepted + message système + article vendu + transaction meetup (`meetup_pending`)
- [ ] Refuser → rejected + message ; Contre-offrir → nouvelle offre 48h counter_*
- [ ] Cycle meetup : « Confirmer la rencontre » (vendeur) → completed ; « Signaler une absence » ; « Compléter la rencontre »
- [ ] Création (montant requis, lieu requis) ; expirée → « Offre expirée » ; une seule pending (autres refusées) ; acceptation → vendu (autres conversations indisponibles) ; aucun frais visible ; meetup confirmé/no-show
- [ ] **Points chauds** : livraison désactivée (offres meetup seul, sélection masquée) ; règlement cash/virement hors app, aucun PaymentIntent Stripe déclenché par l'acceptation ; expiration 48h non poussée (in-app existe, push iOS limité) ; 1 chat/paire (pas de discussion multi-articles)

### 4. Messages système & notifications
_Voir aussi section 13._
- [ ] Système : offre créée/acceptée/refusée/contre-offre/meetup confirmé (date/lieu/heure)/no-show/complété
- [ ] Notifications : texte (« Nouveau message de [Name] »), photo, offre reçue (offer_received), acceptée, refusée ; no-show pas de notif (in-app seulement)
- [ ] Messages système FR italique/distinct + datés ; notifs in-app (centre /notifications)
- [ ] Push Android : canal « messages » (haute) / « offers » (haute) ; iOS push absent
- [ ] **Points chauds** : push iOS jetons APNs ignorés (in-app compense) ; notif swap_proposed routage au tap (deep link)

### 5. Modération : Signalement (ReportBottomSheet)
_Voir aussi section 14 (admin)._
- [ ] « … » → Signaler/Bloquer → « Signaler » → bottom sheet
- [ ] Étape 1 raison (utilisateur : Harcèlement/Offensant/Arnaque/Autre ; article : Offensant/Contrefaçon/Autre ; message : Harcèlement/Menace/Autre)
- [ ] Étape 2 détails (optionnel, max 500) → « Envoyer » → toast « Signalement envoyé »
- [ ] Admin : Réglages › Administration › Signalements → `/admin/reports` (pending) → cartes + Valider/Examiné/Rejeter (triageReport)
- [ ] Bottom sheet slide-up + backdrop ; raison requise détails optionnels ; ≤500 car ; création reports pending ; admin liste + triage (pending → reviewed/dismissed) + confirmation ; pas de notif reporter (anonyme)
- [ ] iOS ActionSheet / Android AlertDialog ; bottom sheet identique
- [ ] **Points chauds** : signalements admin-only (verrouillés Firestore, pas d'escalade auto) ; reporter anonyme

### 6. Modération : Blocage
_Voir aussi section 2._
- [ ] « … » → Bloquer → confirmation → enregistre {userId, blockedUserId, blockedAt} → ferme chat → retour liste → conversation flaggée
- [ ] Liste bloqués (Réglages › Confidentialité) → Débloquer (suppression doc)
- [ ] Blocage optimiste ; conversation flaggée (lisible pas cachée) ; serveur verrouille (isNotBlockedBy) ; envoi impossible si bloqué/bloqueur ; notification supprimée avant livraison (trigger sendMessageNotification) ; déblocage réversible
- [ ] Tentative message bloqué → « Cette personne vous a bloqué ou inversement » ; serveur refuse écriture ; notification NOT créée
- [ ] **Points chauds** : blocage bidirectionnel (2 sens) ; client ne vérifie pas toujours (autorité serveur) ; messages non supprimables (supprimé avant notification)

### 7. Conversations bloquées (`messages.tsx`)
- [ ] Conversation utilisateur bloqué visible + flaggée (icône/couleur/badge)
- [ ] Ouverture possible (historique lisible) ; offre désactivée ; saisie envoyer grisé ; tentative → « Conversation bloquée »
- [ ] Déblocage via Réglages › Confidentialité

### 8. Centre notifications (`/notifications`)
_Voir aussi section 13._
- [ ] Cloche en-tête → liste chronologique (icône couleur + titre + message + horodatage relatif FR + point bleu non-lu)
- [ ] Tap → marquer lue + deep link ; glisser → supprimer ; « Tout lire » ; pull-to-refresh
- [ ] Types : message, offre, vente, litige, avis, incident Loi 25, swap (le type « expédiée » est hors scope tant que `SHIPPING_ENABLED=false`)
- [ ] Chargement squelette ; erreur + Réessayer ; vide « Aucune notification » ; ordre chrono ; tap redirection ; badge = non-lus
- [ ] **Points chauds** : pas d'emojis de tête ; deep links cassés (vérifier routing) ; iOS push absent (in-app compense)

### 9. Conversations générales (sans article)
- [ ] Profil vendeur → « CONTACTER » → chat sans article (chatId = [uid1__uid2] sans articleId)
- [ ] Barre article absente ; offre « $ » désactivée ; texte/photo OK ; apparaît ACHATS
- [ ] **Point chaud** : 1 chat/paire (contact sans article + avec article A = même chat, lisibilité C2/C3, pas de migration)

### 10. Bulles d'offre & détails (OfferBubble)
_Voir aussi section 7._
- [ ] Bulle distincte : montant CAD (« 45,00 $ ») + lieu meetup + statut (pending/accepted/rejected/counter_*/completed/expired) + historique négociation
- [ ] Boutons contextuels : reçue pending (Accepter/Refuser/Contre-offrir) ; acceptée (Confirmer/Compléter vendeur) ; refusée (archive) ; appui long (copier)
- [ ] Montant formaté ; statut temps réel ; expirée « Expirée » ; acceptation → « Acceptée »

### Tableau synthèse Messagerie
- [ ] Messages liste : non connecté / chargement / erreur / vide / nominal / bloqué / iOS / Android
- [ ] Chat : non connecté (redir) / chargement / erreur / vide / nominal / bloqué / iOS (clavier) / Android (clavier)
- [ ] Modération signal : 2 étapes / iOS ActionSheet / Android AlertDialog
- [ ] Blocage : flaggé / déblocable / serveur centralisé
- [ ] Notifications : non connecté / chargement / erreur / vide / nominal / redirection

#### ⏭️ HORS SCOPE ACTUEL (réactivable)

> Périmètre actuel = meetup seul (`SHIPPING_ENABLED=false`), règlement hors app, et complément argent swap routé via Stripe (hors scope). Les cases ci-dessous restent à cocher dès réactivation (cf. `config/featureFlags.ts`).

**Suivi d'expédition dans le chat (section 12.2)** — _Hors scope : le tracker d'expédition complet n'est jamais rendu, ShipmentTracking se limite au meetup._
- [ ] ShipmentTracking en mode « shipping » (tracker complet) si transaction d'expédition (non pending_payment)

**Messages système & notifications d'expédition (section 12.4)** — _Hors scope : aucune étiquette ni expédition générée en meetup._
- [ ] Message système « étiquette créée »
- [ ] Notification « expédiée » (type expédiée dans le centre /notifications)

**Complément argent swap — OfferBubble (section 12.10)** — _Hors scope : le complément en argent du swap passe par `createSwapTopUpCheckout` (Stripe PaymentIntent), inaccessible en meetup. La bulle d'offre standard (meetup) reste en scope ci-dessus._
- [ ] **Point chaud** : affichage complément en cents bruts (« $1000 » au lieu « 10,00 $ ») → vérifier CAD formaté

---

## 13. Notifications

_Routes : `app/notifications.tsx`, `app/settings/notifications.tsx` + deep links vers `app/(tabs)/{index,messages}.tsx`, `app/my-orders.tsx`, `app/chat/[id].tsx`, `app/article/[id].tsx`, `app/swap/[id].tsx`, `app/swap-party/[id].tsx`, `app/search.tsx`, `app/saved-searches.tsx`, `app/wallet.tsx`, `app/review/[transactionId].tsx`._

**État** : V1 métier complète. **POINT CHAUD CRITIQUE** : push iOS structurellement cassé (token APNs brut → FCM reject → token auto-supprimé). Android OK. In-app 100% opérationnel.

> ⏭️ **PÉRIMÈTRE ACTUEL** — `SHIPPING_ENABLED=false` (`config/featureFlags.ts:17`) : transactions = main-à-main (meetup) uniquement, jamais de paiement en ligne (Stripe). Conséquence sur les notifications : les types `new_sale`, `order_shipped`, `order_delivered` et `funds_released` ne sont **jamais émis** dans le périmètre actuel — ils proviennent exclusivement du webhook Stripe (`functions/src/http/webhooks.ts:701`) ou du webhook shipping ShipEngine. Les cas de test qui en dépendent sont déplacés sous **⏭️ HORS SCOPE ACTUEL (réactivable)** en bas de section. Toutes les autres notifications (offres, messages, favoris, baisses de prix, recherches sauvegardées, swap, no-show meetup `order_cancelled`, avis) restent IN SCOPE et émises (meetup, chat, callables).

### 1. Centre de Notifications In-App (`app/notifications.tsx`)
**Préconditions :** Connecté (guest → AuthBottomSheet), ≥1 notification (type, title, message, isRead, createdAt, data).
- [ ] Écran vide : icône notifications-off + « Aucune notification » + sous-titre (favoris/baisses/offres) + pas de « Tout lire »
- [ ] Chargement : 6 skeletons (icône + titre + message + timestamp) shimmer
- [ ] Erreur réseau : cloud-offline + « Impossible de charger » + Réessayer
- [ ] Liste : tri décroissant createdAt + icône/couleur par type + titre sans emoji (stripLeadingEmoji) + message 2 lignes + timestamp relatif + point bleu non-lu (fond primaryLight)
- [ ] **Marquer lu (tap)** : isRead=true + point bleu disparaît + fond surface + notif reste + navigation cible
- [ ] **Tout lire** : visible si non-lu>0 → tous perdent point bleu instantanément + bouton disparaît + Firestore isRead=true + badge OS=0
- [ ] **Supprimer (swipe droite)** : poubelle rouge → supprimée optimiste + doc supprimé + badge décrémenté + si dernière → écran vide
- [ ] **Routing par type** : new_message/offer_received → `/chat/{id}` ; article_favorited/price_drop → `/article/{id}` ; swap_zone_reminder → `/swap-party/{id}` ; swap_update → `/swap/{id}` ; saved_search → `/search?query=...&filters=...` _(⏭️ fragments new_sale → `/my-orders?transactionId={id}` et order_shipped → `/my-orders?transactionId={id}` HORS SCOPE — ces types ne sont jamais émis sans paiement en ligne / shipping ; routing conservé pour réactivation)_
- [ ] **POINT CHAUD** : deepLink (data.deepLink) source de vérité, fallback chatId/articleId OK
- [ ] Refresh pull-down : spinner + nouvelle notif en haut
- [ ] Badge OS/Tab : iOS badge rouge « 3 » / Android dot ; marquer lu → 2 ; Tout lire → 0

### 2. Paramètres Notifications (`app/settings/notifications.tsx`)
_Voir aussi section 2._
**Préconditions :** Connecté, permissions OS Android, prefs Firestore (notificationPreferences).
- [ ] Chargement skeleton (info box + 5 toggles)
- [ ] Toggles : push, email, nouveaux messages, nouvelles ventes, baisses de prix, articles favoris, propositions d'achat, réponses aux offres + icônes/couleurs + info box
- [ ] **Toggle push (master)** : ON → permission OK → push:true + FCM token enregistré (useNotificationSetup) ; créer notif → push (SAUF iOS) ; OFF → push:false → pas de push système (in-app OK si actif)
- [ ] Gating permission : toggle ON demande permission si OFF ; aéroplane → Alert « Notifications désactivées » + « Ouvrir les réglages » ; Annuler → revient OFF
- [ ] Toggles secondaires : optimiste + Firestore background (priceDrops false → pas de notif price_drop)
- [ ] Erreur write (offline) : toggle OFF immédiat + Alert « Impossible d'enregistrer » + online revert
- [ ] iOS : push OFF n'affecte pas réception in-app ; Android : push OFF → aucune notif (in-app + canaux + badges)
- [ ] Cross-device : device A désactive → device B lit OFF

### 3. Intégration Centre (Badge + Button)
- [ ] Badge tab Messages (iOS) « 3 » → marquer 1 lu → « 2 » → Tout lire → disparaît
- [ ] Badge OS rapide : créer +1 / supprimer −1
- [ ] Navigation push (app tué) : offer_received + chatId → kill → tap → relance + `/chat/{chatId}` + reste lue
- [ ] Navigation push (background) : price_drop + articleId → home → tap bannière → `/article/{articleId}`
- [ ] Notification dismissée centre système : tap → lance app + écran cible + disparaît du centre

### 4. POINT CHAUD CRITIQUE — Push iOS
_Tester avec une notif IN SCOPE (offre reçue, nouveau message) — pas besoin de vente en ligne pour reproduire le bug FCM iOS._
- [ ] iOS : créer notif → AUCUN push hors-app (pas bannière/son/badge)
- [ ] Android : MÊME notif → push immédiat
- [ ] Firebase Logs : erreur `registration-token-not-registered` (token APNs rejeté)
- [ ] fcmTokens : token iOS auto-supprimé après tentative
- [ ] In-app OK (seule surface fiable iOS) — vendeurs alertés offres tard
- [ ] Non-test (structurel) : relancer tous les tests après fix FCM iOS natif

### 5. Deep Link + Routing
- [ ] 3 couches : switch type → fallback deepLink (Linking.parse) → fallback ID brut (chatId/articleId/partyId)
- [ ] Offer : offer_received/accepted/counter/rejected → `/chat/{chatId}` (deepLink ou fallback)
- [ ] Message : new_message/message/chat → `/chat/{chatId}`
- [ ] Article : article_favorited/price_drop → `/article/{articleId}`
- [ ] Swap : swap_update/swap_proposed → `/swap/{swapId}` ; swap_zone_reminder → `/swap-party/{partyId}`
- [ ] No-show meetup : order_cancelled (signalement no-show, `reportMeetupNoShow`) + transactionId → `/my-orders?transactionId={id}` ou fallback article
- [ ] **POINT CHAUD saved_search** : payload `searchId` vs `savedSearchId` (fix appliqué) → `/search?query&filters` + resetNewItemsCount + canal Android saved_searches

### 6. Broadcast + Foreground In-App
- [ ] Suppression bannière en chat actif : setActiveChatId → bannière non affichée (badge monte + liste maj) ; quitter → bannière réapparaît
- [ ] Son + vibration Android (canal, motif [0,250,250,250] messages)
- [ ] Badge incrément optimiste : 5 → recevoir → 6 immédiat → réconciliation serveur

### 7. App State / Badge Reconciliation
- [ ] Device A 3 non-lus (badge 3) → background → device B lit les 3 → device A reprend (AppState active) → refreshBadgeCount → badge 0

### 8. Hors-ligne & limitations
- [ ] Aéroplane : déjà chargé → liste visible sans refresh ; première visite → error screen ; toggle → échoue + revert
- [ ] **POINT CHAUD types non-navigables** : review_received (aucune clé) ; privacy_incident (pas de deep link, centre seul) → vérifier icône neutre + message FR _(⏭️ fragments new_sale/order_*/funds_released HORS SCOPE — types non émis sans paiement en ligne ; icône/fallback conservés pour réactivation)_

### 9. Canaux Android
- [ ] new_message → messages (HIGH son) ; offer_received → offers (HIGH son) ; price_drop → notifications (DEFAULT) ; saved_search → saved_searches (DEFAULT) ; swap_zone_reminder → swaps (DEFAULT) _(⏭️ fragment new_sale → orders (HIGH son) HORS SCOPE — type non émis sans vente en ligne ; canal conservé pour réactivation)_
- [ ] Settings → Apps → Second → Notifications : 6 canaux francisés

### 10. Permissions & Auth Gate
- [ ] 1ère install : popup système ; refuser → toggle push grisé + Alert Settings ; réactiver après permission
- [ ] Guest → `/notifications` → AuthBottomSheet → connexion → notifs ; aucune notif guest préservée

### 11. Cas limites & robustesse
- [ ] Notif malformée : sans title (« ») ; sans type (icône fallback bell + fallback routing) ; sans createdAt (NOW)
- [ ] Message long (200+) → tronqué « ... » 2 lignes
- [ ] Timestamps : 1 min / 59 min / 60 min (1h) / 23h59 / 24h (1j) / 8 jours (date courte)
- [ ] Suppression masse : 50 notifs → Tout lire → batch atomique
- [ ] Swipe dernière ligne → empty state

### 12. Scénario métier (IN SCOPE)
- [ ] **Vendeur (offre reçue)** : B propose 40$ → notif offer_received → A push (Android ✓ iOS ✗) + in-app → tap → `/chat/{chatId}` bulle visible → refuser → B notif offer_rejected

### Résumé hotspots Notifications
- [ ] **P0** : push iOS non-op (token APNs rejeté, auto-supprimé) ; routing saved_search (searchId vs savedSearchId) ; compteur nouveaux articles non réinitialisé
- [ ] **P1** : avis non-navigables (review_received, aucune clé) ; préférences notifs transactionnelles ignorées backend (toggles morts) _(⏭️ fragment ventes/commandes non-navigables + canaux orders manquants HORS SCOPE — types liés au paiement en ligne / shipping, non émis ; conservé pour réactivation)_
- [ ] **P2** : blocage messagerie unilatéral non-enforced ; in-app sans type → icône générique

#### ⏭️ HORS SCOPE ACTUEL (réactivable)

> `SHIPPING_ENABLED=false` + pas de paiement en ligne (meetup uniquement). Les notifications `new_sale` / `order_shipped` / `order_delivered` / `funds_released` ne sont jamais émises (origine : webhook Stripe `functions/src/http/webhooks.ts:701` et webhook shipping ShipEngine). Cases conservées pour réactivation quand le shipping / paiement en ligne reviendra (`config/featureFlags.ts:17`).

- [ ] **[HORS SCOPE — routing vente/livraison]** Sale : new_sale/order_shipped/order_delivered → `/my-orders?transactionId={id}` (onglet sélectionné + surligné) _(notif jamais émise sans vente Stripe ni shipping)_
- [ ] **[HORS SCOPE — acheteur suivi colis]** checkout shipping → webhook ShipEngine shipped → notif order_shipped + transactionId → tap → `/my-orders?transactionId={id}` surligné + ShipmentTracking _(checkout en ligne + shipping inaccessibles : CTA article = « PROPOSER UN ACHAT », checkout auto-routé meetup, `ArticleCTABar.tsx:88-92`, `app/checkout/index.tsx:60-69`)_

---

## 14. Boutiques & Administration

_Routes : `app/shop/[id].tsx`, `app/admin/_layout.tsx`, `app/admin/shops.tsx`, `app/admin/shop-detail/[id].tsx`, `app/admin/reports.tsx`, `app/admin/disputes.tsx`._

> ⏭️ **PARTIELLEMENT HORS SCOPE** — Les **Boutiques** (vitrine publique, validation admin, liste de modération des boutiques) sont **hors scope actuel** : aucune UI utilisateur de création de boutique n'existe (`ShopService.createShop` n'est appelé par aucun écran client ; gestion 100 % admin), et le modèle payant n'est pas câblé. Conservé pour réactivation. Restent **EN SCOPE** : le guard du panel admin, la **modération des signalements** (articles/utilisateurs/messages) et la **consultation des litiges** (lecture seule).

### 4. Panel admin guard (`app/admin/_layout.tsx`)
- [ ] Non-connecté → `/admin/shops` → redirect `/(tabs)`
- [ ] Connecté non-admin → isUserAdmin false → redirect `/(tabs)`
- [ ] Connecté admin → isUserAdmin true → accès
- [ ] Vérification en cours → skeleton (<1s) → affichage ou redirect

### 5. File modération rapports (`app/admin/reports.tsx`)
_Voir aussi section 12._
**Préconditions :** Admin connecté, signalements pending (ReportBottomSheet — l'UI de signalement client est câblée sur article/utilisateur/message, cf. section 12).
- [ ] Guard admin (non-admin → redirect + alerte)
- [ ] Chargement ~4 skeletons → vraies données
- [ ] En-tête « Panel Admin » + « Signalements en attente » + retour + refresh ; onglets Ouverts/Tous (filtre client)
- [ ] Cartes : badge cible (Utilisateur/Article/Message) bleu + date FR + raison + description (4 lignes ellipsis) + « Signalé par [name] » + « Cible : [ID] »
- [ ] Actions : Rejeter (gris) / Examiné (orange) / Valider (vert) → alerte confirmation → **POINT CHAUD P0-3** : « Impossible de traiter » (aucune CF) ou success après fix ; optimistic removal (carte disparaît avant réponse)
- [ ] Vide « Aucun signalement » + « Aucun signalement en attente »
- [ ] iOS/Android identique

### 6. Litiges (`app/admin/disputes.tsx`)
_Voir aussi section 10 — note : le **recours financier / remboursement Stripe** de la section 10 est hors scope actuel (meetup = cash, pas de paiement en ligne) ; seule la **consultation en lecture seule** des litiges ci-dessous reste applicable._
**Préconditions :** Admin connecté, litiges open (reportNoShow/reportTransactionProblem).
- [ ] Guard admin ; chargement skeletons
- [ ] Onglets Ouverts (open) / Tous (lecture seule, pas d'actions résolution)
- [ ] Cartes : badge type (Rencontre manquée/Problème de transaction) bleu + badge status (Ouvert orange/Résolu-Rejeté gris) + titre article + raison + détails (4 lignes) + métadonnées (transactionId, buyerId, sellerId, reportedBy, date)
- [ ] **LECTURE SEULE** : aucun bouton (P1-13 adminRefundTransaction non implémenté, observation seule)
- [ ] Vide « Aucun litige » (open « en attente de résolution » / all « enregistré »)
- [ ] iOS/Android identique

### Points chauds Modération (signalements & litiges — en scope)
- [ ] **P0-3 Signalement trou noir** : reports sans écran ni CF de traitement (promesse « Notre équipe examinera » mensongère)
- [ ] **P0-4 Undefined signalement utilisateur** : échoue silencieusement (undefined → Firestore)
- [ ] **P1-5 Blocage utilisateur asymétrique** : unidirectionnel (bloqué peut contacter, chat non-gardé)

### Checklist transverse Admin (signalements & litiges)
- [ ] Authentification & gating (admin ?)
- [ ] États vide / chargement / erreur réseau / succès
- [ ] Affichage complet (champs, formatage)
- [ ] Actions (buttons, modals, alerts, navs)
- [ ] Flux d'erreur (point chaud P0/P1 = erreur attendue ?)
- [ ] Safe-area, icônes, texte FR
- [ ] iOS vs Android (cartes, safe-area, système)
- [ ] Récapituler bugs connus en notes

---

#### ⏭️ HORS SCOPE ACTUEL (réactivable)

> Les **Boutiques** sont désactivées du périmètre de test : pas d'UI de création côté utilisateur (gestion admin only, modèle payant non câblé). Code conservé — réactiver quand la feature Boutiques sera exposée aux vendeurs. Les cases ci-dessous sont préservées telles quelles pour réactivation.

##### 1. Vitrine boutique publique (`app/shop/[id].tsx`) — HORS SCOPE
**Préconditions :** Boutique `approved` (logo, images, adresse, téléphone, email, horaires, réseaux, articles), invité OU connecté.
- [ ] Chargement squelettes → disparaissent
- [ ] Galerie : image principale + miniatures horizontales (tap → zoom)
- [ ] Nom + badge « Boutique vérifiée » (checkmark vert si approved) + type + description
- [ ] Contact : Appeler (tel:), Email (mailto:), Site web (https:// ajouté), Website (si présent)
- [ ] Adresse : street / postal+city / Country normalisé (« Canada » pour CA)
- [ ] **Carte** : position lat/long + marqueur → **POINT CHAUD P1-3** : gris/vide ou erreur (Google Maps sans clé)
- [ ] Horaires : 7 jours FR (ouvert vert / fermé gris)
- [ ] Réseaux sociaux (Instagram/Facebook) si présents → ouvre profil
- [ ] Articles : « Articles en vente (N) » + « Voir tous » → `/search?shopId=<id>` → **POINT CHAUD P1-2** : section jamais affichée (articlesCount toujours 0, lien sellerId au lieu shopId)
- [ ] Boutique non-approuvée (pending/rejected/suspended) → « Boutique indisponible » + pas de contact
- [ ] Boutique inexistante → « Boutique introuvable » + retour
- [ ] iOS/Android : carte cassée identique ; deep links partagés cassés (P0-2 universal links, hors scope)

##### 2. Validation boutique admin (`app/admin/shop-detail/[id].tsx`) — HORS SCOPE
**Préconditions :** Connecté admin (sinon redirect `/(tabs)` + alert « Accès refusé »).
- [ ] Chargement skeleton (vérif admin ~500ms)
- [ ] Non-admin → « Accès refusé » → OK → redirect `/(tabs)` (aucun contenu)
- [ ] Pending : header + badge « En attente » (orange) + galerie + infos + adresse/carte/horaires/réseaux + footer fixe (Rejeter gris + Approuver vert)
- [ ] **Approuver** → alerte « Confirmer l'approbation de "[Nom]" ? » → **POINT CHAUD P0-2** : « Impossible d'approuver » (permission-denied) ; après fix → approved + notif propriétaire → retour liste
- [ ] **Rejeter** → modal « Raison du rejet » (min 3 char) → alerte → **P0-2** erreur ou success
- [ ] Approuvée/Rejetée/Suspendue : badge correspondant + AUCUN bouton Approuver/Rejeter (sauf pending) + back
- [ ] **POINT CHAUD P1-6 safe-area footer** : boutons chevauchent home indicator iPhone / barre gestes Android (footer ne prend pas insets.bottom)
- [ ] Carte cassée (P1-3) iOS + Android

##### 3. Liste modération boutiques (`app/admin/shops.tsx`) — HORS SCOPE
**Préconditions :** Admin connecté, plusieurs boutiques statuts variés.
- [ ] Admin non-connecté → redirect `/(tabs)` ; connecté → skeletons + onglets (En attente/Approuvées/Rejetées/Suspendues/Toutes)
- [ ] Onglet En attente : pending + badge rouge compteur ; cartes (logo, nom, type, état)
- [ ] Onglet Approuvées : approved + bouton « Suspendre » (orange) → **POINT CHAUD P2-2** : code mort, ne fait rien
- [ ] Onglet Rejetées : rejected (lecture seule)
- [ ] Onglet Suspendues : suspended (lecture seule) → **POINT CHAUD P2-3** : onglet « Toutes » ne les liste pas (case 'all' agrège pending+approved+rejected seulement)
- [ ] Onglet Toutes : agrège (vérifier suspendues incluses ou non)
- [ ] Cartes : logo 80px + nom/type/email/tel/description + badge statut
- [ ] Actions : Approuver (vert, P0-2 erreur) + Voir détails → `/admin/shop-detail/[id]` ; Pending → Rejeter (modal raison) ; Approved → Suspendre (P2-2 mort)
- [ ] Pull-to-refresh header
- [ ] Vide « Aucune boutique » + sous-titre + icône storefront grisée
- [ ] iOS/Android : Ionicons + texte FR identiques

##### Points chauds Boutiques — HORS SCOPE
- [ ] **P0-1 Auto-approbation boutique** : vendeur peut écrire status='approved' sans modération (rules /shops faillies)
- [ ] **P0-2 Modération admin cassée** : Approuver/Rejeter updateDoc client → permission-denied (aucune CF)
- [ ] **P1-1 Modèle payant absent** : pas de tier/forfait Shop, frais identiques (monétisation code mort)
- [ ] **P1-2 Articles boutique jamais affichés** : section jamais rendue, lien /search?shopId mort
- [ ] **P1-3 Carte Google Maps cassée** : pas de clé/config → gris/blanc iOS + Android
- [ ] **P1-4 Notifications approbation perdues** : addDoc client refusé (propriétaire jamais notifié)
- [ ] **P1-6 Safe-area footer** : boutons Approuver/Rejeter chevauchent home indicator/gestes
- [ ] **P2-1 Boutique suspendue visible & contactable** ; **P2-2 Suspension code mort** ; **P2-3 onglet Toutes omet suspendues**
- [ ] **P3-1 Double-soumission** (pas de garde isSubmitting) ; **P3-2 deleteShop code mort** (rules delete:false)

---

## 15. Légal & Conformité Loi 25

> ℹ️ **Périmètre actuel (meetup-only, `SHIPPING_ENABLED = false`)** — La conformité Loi 25 (confidentialité, export, suppression, bloqués, politique/CGU, mentions légales) reste **intégralement dans le scope**. Seuls les cas de **décisions automatisées liés au paiement en ligne / shipping** (libération auto des fonds escrow `funds_released`, remboursement étiquette ShipEngine `label_refund`) sont hors scope tant que le shipping est désactivé. La **contestation d'annulation automatique de meetup** (`transaction_expired`) reste pleinement testable (cf. `functions/src/scheduled/transactionExpiration.ts`).

_Routes : `app/settings/{privacy,export-data,delete-account,blocked-users,privacy-policy,terms,legal-notice}.tsx`, `app/legal/{privacy-policy,terms}.tsx` + contestation décisions automatisées (ShipmentTracking dans `chat/[id].tsx`)._

### 1. Paramètres de confidentialité (`app/settings/privacy.tsx`)
_Voir aussi section 2._
**Préconditions :** Authentifié.
- [ ] Chargement skeletons
- [ ] **Toggle « Afficher ma photo »** : défaut OFF (art. 9.1) ; ON → photo visible ; OFF → masquée ; erreur réseau rollback + alerte ; nouvel user → OFF ; iOS/Android identique
- [ ] **Toggle « Recommandations IA »** : texte (Gemini/Vertex, USA, opt-in) ; défaut OFF ; ON/OFF enregistrement ; erreur rollback
- [ ] **Toggle « Communications marketing »** : texte (offres, LCAP art. 14) ; défaut OFF ; ON → setMarketingConsent(true) (journalise append-only) ; OFF → retrait LCAP ; disabled pendant enregistrement ; erreur callable rollback ; serveur consents/{uid}/ append-only
- [ ] **Section « Vos droits »** : 4 boutons (Exporter, Supprimer, Politique, Bloqués) + navigation + info box « jamais vendues »
- [ ] États : chargement / succès / erreur réseau / nouvel user OFF / suppression autre appareil / performance optimiste

### 2. Export des données (`app/settings/export-data.tsx`)
_Voir aussi section 2._
- [ ] Boîte RGPD (Loi 25 + LPRPDE) + liste (Profil, Articles, Favoris, Notifications, Messages) + JSON + « Exporter mes données »
- [ ] Clic → loading + exportUserData → fichier `seconde_data_{uid}_{ts}.json` → shareAsync
- [ ] iOS : feuille partage (Mail, AirDrop, Fichiers) → fichier supprimé après → « Export réussi » → « Exporter à nouveau »
- [ ] Android : feuille (Gmail, Drive, Fichiers) → fichier nettoyé → succès
- [ ] Sharing indisponible → « Partage indisponible » ; erreur export → alerte ; aucune donnée (JSON vide valide) ; données volumineuses (loading, pas de freeze)
- [ ] États : vide / chargement / erreur réseau / succès / iOS+Android

### 3. Suppression de compte (`app/settings/delete-account.tsx`)
_Voir aussi sections 1.10 & 2._
**Préconditions :** Authentifié, aucun solde retirable / litige / transaction active / dette.
- [ ] Étape 1 Info : avertissement + « Ce qui sera supprimé » (5 items) + « Ce qui sera conservé » (anonymisées) + boîte légale (Loi 25) + Continuer/Annuler
- [ ] Étape 2 Confirmation : en-tête + réauthentification par provider
- [ ] Password : champ secureTextEntry + bouton désactivé tant que vide
- [ ] Google : « Se reconnecter avec Google » → OAuth → « Identité vérifiée » ; ERR_REQUEST_CANCELED → alerte
- [ ] Apple iOS : native flow → « Identité vérifiée »
- [ ] Apple Android : « non disponible sur Android » + « Ajouter un mot de passe » (champ si existe / lien `/settings/add-password`)
- [ ] Provider inconnu : « Impossible de déterminer… déconnectez/reconnectez » + bouton disabled
- [ ] Champ « SUPPRIMER » (autoCapitalize characters) ; bouton enabled si (password rempli OU reauth) ET texte='SUPPRIMER'
- [ ] Serveur deleteUserAccount : garde-fous (solde, litige, transaction, dette) → failed-precondition + message FR exact
  - _Note scope : en meetup-only, le solde wallet reste à 0 (aucune vente en ligne) — le garde-fou « solde » est donc difficilement déclenchable, mais le code et le message FR restent à vérifier. Les garde-fous transaction active (meetup en cours) et litige restent pleinement testables._
- [ ] Succès → resetAllStores + redirection `/` (login)
- [ ] failed-precondition → « Suppression impossible » + message serveur + reste écran ; erreur générique → reste écran
- [ ] États : vide / chargement / erreur réseau / erreur réauth / erreur serveur (blocages FR) / succès / iOS Apple native / Android Apple+password
- [ ] **Points chauds** : garde-fous serveur (compte avec solde/litige → bloqué) ; messages FR précis ; réauth tous providers ; provider inconnu

### 4. Utilisateurs bloqués (`app/settings/blocked-users.tsx`)
_Voir aussi sections 2 & 12._
- [ ] Liste vide : icône people-outline + « Aucun utilisateur bloqué » + info box (bloquer depuis profil/conversation)
- [ ] Liste : chargement 4 skeletons ; avatar + nom live (fallback snapshot) + « Bloqué le [date] » + « Débloquer »
- [ ] Débloquer → confirmation « Voulez-vous débloquer [nom] ? » → unblockUser → suppression optimiste ; si dernier → vide ; erreur → reste + alerte
- [ ] Info box (si ≥1) : « ne peuvent plus vous contacter ni voir vos articles »
- [ ] États : vide / chargement / succès / erreur / performance / iOS+Android

### 5. Politique confidentialité publique (`app/legal/privacy-policy.tsx`)
**Préconditions :** Non authentifié (inscription/consentement) OU authentifié (`/settings/privacy-policy`).
- [ ] Route `/legal/privacy-policy` accessible sans login ; ScreenHeader + back
- [ ] Contenu partagé (PrivacyPolicyContent identique auth/public) + dernière mise à jour + intro
- [ ] Sections : 1 Responsable (privacy@) / 2 Renseignements / 3 Utilisation / 4 Droits / 5 Décisions automatisées (art. 12.1) / 6 Cookies / 7 Conservation / 8 Partenaires (Stripe, ShipEngine, Google Cloud) / 9 Transferts internationaux (USA IA) / 10 Modification / 11 Contact
- [ ] Mention Loi 25 + LPRPDE + décisions contestables
- [ ] Scroll fluide ; accès public + authentifié ; contenu complet ; iOS/Android identique

### 6. Conditions d'utilisation publique (`app/legal/terms.tsx`)
- [ ] Route `/legal/terms` accessible sans login ; ScreenHeader
- [ ] Contenu partagé (TermsContent) + dernière mise à jour
- [ ] Sections : 1 Définitions / 2 Acceptation / 3 Inscription / 4 Obligations / 5 Contenu utilisateur / 6 Responsabilité Seconde / 7 Limitation / 8 Droit applicable (Québec) / 9 Différends / 10 Modification / 11 Suspension
- [ ] Mention Canada/Québec + jurisdiction Montréal ; scroll fluide ; accès public + authentifié

### 7. Mentions légales (`app/settings/legal-notice.tsx`)
- [ ] ScreenHeader « Mentions légales » + back
- [ ] Sections : Éditeur (NEQ, Montréal) / Directeur (Aurélien Rouchy) / Hébergement (GCP Toronto) / Propriété intellectuelle / Données personnelles (CAI + CPVP) / Stockage local / Limitation / Droit applicable (Québec) / Différends (OPC) / Signalement illicites (abuse@) / Crédits (Ionicons MIT) / © 2026
- [ ] Contacts : contact@, support@, privacy@, legal@, abuse@
- [ ] Autorités : CAI Québec, CPVP Canada, OPC Québec
- [ ] Chargement instantané ; scroll fluide ; contacts accessibles

### 8. Contestation décisions automatisées (Loi 25 art. 12.1) — ShipmentTracking dans `chat/[id].tsx`
**Préconditions :** Authentifié acheteur, commande dont le statut a changé par décision auto, décision loggée (automated_decisions/{txId}).
- [ ] **Cas 2 transaction_expired** (IN SCOPE — meetup) : meetup non confirmé (meetup_pending > 48h) ou meetup abandonné (meetup_confirmed > 7j) → job transactionExpiration / expireOrphanedTransactions → bloc « Annulation automatique » + critères (Status, Délai, Motif `meetup_expired_48h`) + Contester. _Aucun remboursement / wallet touché (meetup = cash main-à-main, cf. `transactionExpiration.ts:18`)._
- [ ] Contester → modal raison (TextInput) → « Envoyer » ({transactionId, transaction_expired, reason}) → succès « contestation transmise… révision humaine » → ferme + bouton disabled/masqué ; erreur → modal reste
- [ ] **Cas 4 aucune décision** (IN SCOPE) : bloc « Décisions automatisées » absent, suivi normal ; transaction meetup classique sans décision auto → ShipmentTracking ne rend rien (deliveryType !== 'shipping' + pas de décision)
- [ ] getAutomatedDecisionLog (backend JSON) ; formatage critères (bool → Oui/Non, dates ISO → FR « 15 juin 2026 », fallback « Critère ») ; contestation idempotente ; rotation UI post-contestation
- [ ] **Points chauds** : meetup expiré (48h / 7j) → bloc transparence s'affiche dans chat ; contestation callable + confirmation ; fallback robuste (clé inconnue, pas de crash) ; iOS/Android modal+TextInput identique

#### ⏭️ HORS SCOPE ACTUEL (réactivable)
_`SHIPPING_ENABLED = false` (cf. `config/featureFlags.ts:17`) : pas de paiement en ligne → pas de fonds escrow ni d'étiquette ShipEngine. `funds_released` n'opère que sur des fonds passés `pending → held` (vente payée en ligne / swap cash top-up, cf. `functions/src/scheduled/releaseHeldFunds.ts`) et `label_refund` est spécifique aux échecs d'étiquette ShipEngine (`sweepPendingLabels`). Ni l'un ni l'autre n'est atteignable en meetup-only. Repasser le flag à `true` pour réactiver._
- [ ] **Cas 1 funds_released** : transaction → paid → confirmer livraison (ou 7j) → job releaseHeldFunds → bloc « Libération automatique des fonds » + explication (livraison confirmée + délai 7j écoulé) + « Contester » + critères tableau (Status, Dispute, Date libération, Délai)
- [ ] Contester (funds_released) → modal raison (TextInput) → « Envoyer » ({transactionId, funds_released, reason}) → succès « contestation transmise… révision humaine » → ferme + bouton disabled/masqué ; erreur → modal reste
- [ ] **Cas 3 label_refund** : échecs création étiquette ShipEngine → job sweepPendingLabels → bloc « Remboursement automatique » + critères (Status, Étiquette en attente, Tentatives, Motif) + Contester
- [ ] **Point chaud (release 7j)** : création transaction payée en ligne → auto-release 7j s'affiche dans chat ; contestation callable + confirmation

### Points chauds Légal & Conformité
- [ ] **Hotspot 1 Push iOS** : notifs in-app testables (privacy/marketing fonctionnent sans push) ; push hors-app non ; consentement marketing (LCAP) lié toggles settings pas au push
- [ ] **Hotspot 2 Suppression + gardes financiers** : blocages serveur (transaction meetup active, litige, dette) ; messages FR précis ; réauth tous providers ; provider=unknown → instruction ; tester création → meetup en cours → suppression bloquée. _Note : garde-fou « solde » non déclenchable en meetup-only (wallet à 0)._
- [ ] **Hotspot 3 Décisions automatisées contestables (meetup)** : end-to-end pour `transaction_expired` (meetup_pending 48h / meetup_confirmed 7j → log → contester → confirmation) ; critères FR (pas de clé technique) ; fallback robuste ; statut post-contestation. _`funds_released` / `label_refund` : voir HORS SCOPE ci-dessus._
- [ ] **Hotspot 4 Bloc messagerie comptes bloqués** : bloquer → ne peut plus envoyer ; déblocage réactive ; appliqué Firestore rules (tests security)
- [ ] **Hotspot 5 Contenu partagé privacy/terms** : route publique + auth = même contenu (composant factorisé) ; lien signup → route publique pas login ; accessible avant consentement (art. 12)

### Accès & permissions
- [ ] Public (non auth) : `/legal/privacy-policy`, `/legal/terms` OK ; `/settings/*` → redirect login
- [ ] Authentifié : tous `/settings/*` + `/legal/*` OK

### Résumé états Légal
- [ ] Vide : privacy nouveaux défauts OFF ; bloqués vide ; export profil minimal
- [ ] Chargement : skeletons / spinner
- [ ] Succès : toggle sauvegarde ; déblocage ; export partagé ; suppression garde-fous + redirection ; contestation confirmation (meetup `transaction_expired`)
- [ ] Erreur : réseau (rollback) / serveur (FR) / réauth (provider-spécifique)
- [ ] iOS vs Android : switches identiques ; share natif ; Apple auth (iOS native / Android fallback)

---

## Suivi global (couverture par domaine — périmètre actuel)

> Recompte automatique des cases à cocher (`- [ ]`) du document.
> **Total : 1390 cases.** Dont **1050 IN SCOPE** (Légende incluse, périmètre meetup cash) et **340 ⏭️ HORS SCOPE** (sous un bloc « ⏭️ HORS SCOPE ACTUEL (réactivable) », réactivables avec `SHIPPING_ENABLED=true`).
> Détail : Légende = 15 (préparation, comptées in-scope ; 4 prérequis Stripe/wallet/boutique retirés du périmètre) · Points chauds = 38 in / 13 hors · Sections 1-15 = 997 in / 327 hors.

| # | Domaine | Cases IN SCOPE | Cases ⏭️ HORS SCOPE | Statut |
|---|---|---:|---:|---|
| 1 | Onboarding & Authentification | 150 | 2 | ☐ |
| 2 | Profil & Réglages | 144 | 12 | ☐ |
| 3 | Vente / Mise en vente | 87 | 0 | ☐ |
| 4 | Accueil, Découverte & Favoris | 96 | 0 | ☐ |
| 5 | Recherche & Filtres | 90 | 1 | ☐ |
| 6 | Article, Achat & Checkout | 63 | 20 | ☐ |
| 7 | Offres & Négociation | 87 | 3 | ☐ |
| 8 | ⏭️ Meetup & Livraison/Suivi | 57 | 37 | ☐ |
| 9 | Avis & Ventes | 11 | 48 | ☐ |
| 10 | ⏭️ Porte-monnaie, Paiements vendeur & Recours | 13 | 71 | ☐ |
| 11 | Swap & SwapZone | 4 | 71 | ☐ |
| 12 | Messagerie & Modération | 62 | 4 | ☐ |
| 13 | Notifications | 56 | 2 | ☐ |
| 14 | ⏭️ Boutiques & Administration | 28 | 40 | ☐ |
| 15 | Légal & Conformité Loi 25 | 49 | 16 | ☐ |
| — | **Sous-total sections 1-15** | **997** | **327** | |
| — | Points chauds (liste agrégée) | 38 | 13 | ☐ |
| — | Légende & préparation | 15 | 0 | ☐ |
| — | **TOTAL** | **1050** | **340** | |

**Domaines marqués ⏭️ HORS SCOPE en tête de section (intégralement ou en majorité hors périmètre)** : 8 (Livraison/Suivi de colis), 10 (Payouts/retraits/Stripe/recours financier), 14 (Boutiques). Les sections 6, 9, 11, 13 sont mixtes : leur parcours principal (meetup, avis meetup, swap item-contre-item, notifications meetup/offres) reste IN SCOPE ; seules leurs sous-parties paiement en ligne / shipping sont déplacées sous ⏭️.

**Hors scope = réversible** : repasser `config/featureFlags.ts → SHIPPING_ENABLED = true` réactive checkout Stripe, expédition/suivi, payouts/wallet alimenté, recours financier, et les boutiques redeviennent pertinentes. Aucune case n'a été supprimée — tout est conservé sous un bloc ⏭️.

**Progression** : ___ / 15 domaines validés iOS · ___ / 15 domaines validés Android.

_Cocher chaque case au fur et à mesure. Les sections croisées (« Voir aussi ») évitent les doublons : tester une fois l'écran, vérifier les angles spécifiques signalés dans chaque domaine. Ignorer les blocs ⏭️ tant que `SHIPPING_ENABLED=false`._
