# Audit Fondations cross-plateforme & App shell (2026-06-01)

## Résumé exécutif

Cet audit couvre les fondations partagées de l'app : providers & app shell, thème/DS/dark mode, fonts & splash, deep linking & universal/app links, config native & permissions (`app.config.js`), réseau/offline/error boundaries, i18n & locale Canada, et fondations cross-plateforme (New Arch & libs natives). L'objectif prioritaire est la **parité iOS == Android** : toute divergence d'infra ou de comportement entre les deux plateformes est un défaut de fondation.

Deux **P0** dominent et doivent être traités avant toute autre chose : (1) les **push iOS sont structurellement cassés** — un token APNs brut est envoyé au Firebase Admin SDK qui n'accepte que des tokens FCM, donc aucune notification n'arrive jamais sur iPhone ; (2) les **universal/app links sont non fonctionnels sur les DEUX plateformes** — les fichiers `.well-known` contiennent des placeholders (`TEAM_ID`, `YOUR_SHA256_FINGERPRINT_HERE`) jamais substitués, donc tout lien partagé tombe dans le navigateur. Les **P1** concernent surtout des écarts iOS ↔ Android : permissions caméra/micro non maîtrisées dans la source de vérité, RECORD_AUDIO sans usage (risque rejet Play Store), Google Maps sans clé (cartes mortes sur Android), drift `android/`+`ios/` vs `app.config.js`, channels Android orphelins, et couverture de paths deep-link Android inférieure à iOS. Les **P2/P3** sont majoritairement du polish (flash splash sombre→crème), de la dette (code mort dark-mode, helpers de prix dupliqués, locale hardcodée) et de la robustesse (offline non câblé, error boundaries limitées).

| Sévérité | Nombre |
|----------|--------|
| P0 | 2 |
| P1 | 9 |
| P2 | 20 |
| P3 | 15 |
| **Total** | **46** |

> Note méthodologique : les sévérités ci-dessous sont les **sévérités révisées** après vérification ligne-à-ligne dans le code réel. Plusieurs findings initiaux ont été rétrogradés (cosmétique pur, identique iOS/Android donc pas de divergence) ou recadrés (exemples factuellement faux). Un faux positif a été écarté (voir annexe).

---

## Findings P0

### P0-1 — Push iOS cassé : token APNs brut envoyé au Firebase Admin SDK qui exige des tokens FCM
**Sévérité : P0 · Plateforme : iOS**

Fichiers :
- `hooks/useNotificationSetup.ts:200` — `const pushToken = await Notifications.getDevicePushTokenAsync();` puis `:204` `saveFcmToken(...)`
- `functions/src/utils/notifications.ts:193` (`messages.map(token => ({ token, ... }))`), `:216` (`admin.messaging().sendEach(messages)`), `:268`, `:299`
- `functions/src/triggers/messages.ts:99`, `:131` ; `functions/src/triggers/swaps.ts:74`, `:104` ; `functions/src/scheduled/savedSearches.ts:220`, `:253`
- `package.json` (aucun `@react-native-firebase/messaging`) ; `app.config.js:37` (plugin `expo-notifications` seul)

Description : l'app utilise `expo-notifications` en mode bare et enregistre le token via `getDevicePushTokenAsync()`. Sur Android ce token est le token d'enregistrement FCM (résolu via `google-services.json`) → valide. Sur iOS, c'est le **token APNs BRUT** (type `ios`), PAS un token FCM. Aucun pont natif Firebase Messaging n'existe (pas de `@react-native-firebase/messaging`), donc aucun échange APNs→FCM sur l'appareil. Le backend envoie tous les push via `admin.messaging().sendEach()` avec le champ `token`, qui exige un token d'enregistrement FCM → chaque envoi vers iOS échoue avec `messaging/invalid-argument`. Aggravant : le nettoyage des tokens invalides (`notifications.ts:225-235`) ne traite que `messaging/invalid-registration-token` et `messaging/registration-token-not-registered`, jamais `messaging/invalid-argument` → les tokens APNs invalides s'accumulent indéfiniment dans `users.fcmTokens`.

Impact : **aucune notification push n'arrive jamais sur les iPhone** (messages, offres, ventes, livraisons, swaps). Perte d'engagement et de réactivité critique pour une marketplace. Pollution durable de Firestore.

Recommandation : soit intégrer `@react-native-firebase/messaging` et appeler `messaging().getToken()` sur iOS pour obtenir un vrai token FCM, soit basculer sur les tokens Expo (`getExpoPushTokenAsync` + Expo Push API qui relaie vers APNs). Ne jamais envoyer de token APNs brut à `admin.messaging()`. Valider la livraison réelle sur device iOS physique avant prod. (Domaine `firebase-backend` + `rn-expo-dev`.)

### P0-2 — Universal Links / App Links non fonctionnels : AASA et assetlinks.json contiennent des placeholders non remplacés
**Sévérité : P0 · Plateforme : both**

Fichiers :
- `public/.well-known/apple-app-site-association:6` — `"appID": "TEAM_ID.com.seconde.app"` (placeholder littéral)
- `public/.well-known/assetlinks.json:8` — `"sha256_cert_fingerprints": ["YOUR_SHA256_FINGERPRINT_HERE"]` (placeholder littéral)
- `firebase.json:13,20-31` (hosting des fichiers `.well-known`, Content-Type `application/json`), `:33-38` (rewrite catch-all `** → /index.html`)
- `app.config.js:73-76` (iOS `associatedDomains`), `:108-156` (Android intentFilters `autoVerify`)
- `features/article/hooks/useArticleActions.ts:72-74` (`https://seconde.app/article/${id}`) ; `app/user/[id].tsx:265` (`https://seconde.app/user/${id}`)

Description : les deux fichiers d'association de domaine sont bien hébergés via Firebase Hosting, mais contiennent des valeurs placeholder jamais substituées. `TEAM_ID` n'est pas le vrai Apple Team ID ; `YOUR_SHA256_FINGERPRINT_HERE` n'est pas l'empreinte du certificat de signature Android. Conséquence : iOS exige que `appID` == `<AppleTeamID>.<bundleId>` réel — le match échoue ; Android refuse l'`autoVerify` (fingerprint invalide). Aucun mécanisme de substitution build-time n'existe (grep exhaustif : aucun script, `package.json`, ni `eas.json` ne patche ces valeurs). Le bundleId réel est `com.seconde.app` (`app.config.js:93`), donc seul le préfixe Team ID manque côté iOS.

Impact : tout lien partagé par l'app (`https://seconde.app/article/{id}`, `/user/{id}`) s'ouvre dans le **navigateur** (SPA quasi-vide servie par le rewrite `**` → `/index.html`) au lieu de l'app, **sur iOS ET Android**. La fonctionnalité de partage — vecteur d'acquisition viral central pour une marketplace — est cassée sur les deux plateformes. Régression silencieuse (aucune erreur visible). **Ce P0 rend largement théoriques les findings de divergence de paths/hosts ci-dessous tant qu'il n'est pas corrigé.**

Recommandation : remplacer `TEAM_ID` par le vrai Apple Team ID et `YOUR_SHA256_FINGERPRINT_HERE` par l'empreinte SHA-256 du certificat de release Android (via `eas credentials`), puis redéployer Firebase Hosting. Vérifier l'association avec le validateur AASA Apple et `adb shell pm verify-app-links`. (Domaine `firebase-backend` + config native.)

---

## Findings P1 — bugs & écarts iOS ↔ Android

### P1-1 — Parcours Vendre divergent iOS vs Android dès le shell de navigation (overlay+timeout vs nav par défaut)
**Sévérité : P1 · Plateforme : both**

Fichiers :
- `app/(tabs)/_layout.tsx:139` (`} else if (Platform.OS === 'ios') {`), `:140` (`e.preventDefault()`), `:141-156` (`immerse(...)`), `:147-152` (`setTimeout(() => router.push('/sell/photos-review'), 550)`), `:158` (commentaire Android nav par défaut)
- `components/ui/ImmersiveOverlay/index.tsx`, `constants.ts:8,11` (`ENTERING_TIME=750`, `EXITING_TIME=500`)
- `app/(tabs)/sell.tsx:43` (`router.replace('/sell/capture')`)
- `features/sell/components/capture/SellOverlayCapture.tsx:39,210-216` (`onContinue`)

Description : le listener `tabPress` de l'onglet Vendre fork explicitement par plateforme. iOS : `preventDefault()` + overlay Skia plein écran + `setTimeout(..., 550)` hardcodé avant `router.push('/sell/photos-review')`. Android : aucun `preventDefault` → navigation par défaut vers `sell.tsx` → `/sell/capture`. Les deux plateformes entrent dans le flux vendeur par des chemins de code totalement différents et atterrissent sur des **premiers écrans différents** (`/sell/photos-review` iOS vs `/sell/capture` Android). Le délai 550 ms est ancré sur l'animation de SORTIE (`EXITING_TIME=500` + ~50 ms de marge) sans aucune protection : si `EXITING_TIME` change, la synchro de navigation iOS casse silencieusement.

Impact : surface de divergence majeure pour LE parcours de monétisation (capture photo, écran initial, timing diffèrent par OS). Risque de bugs présents sur une seule plateforme et d'expérience vendeur incohérente.

Recommandation : documenter/assumer l'écart comme ADR OU unifier le point d'entrée vers le même premier écran ; remplacer le `setTimeout(550)` par un callback de fin d'animation. Note : `dismiss()` est typé `() => void` et n'expose pas de callback de complétion — le découplage propre nécessite de plomber un callback à travers `dismiss()`/le hook, pas seulement de réutiliser `onContinue`. (Domaine `rn-expo-dev`.)

### P1-2 — Permission CAMERA utilisée au runtime mais non déclarée dans `app.config.js` (source de vérité)
**Sévérité : P1 · Plateforme : both**

Fichiers :
- `app.config.js:19-67` (liste plugins — pas d'`expo-camera`)
- `app/sell/capture.tsx:21,51` ; `components/VisualSearchCamera.tsx:22` ; `features/sell/components/capture/SellOverlayCapture.tsx:18` (`useCameraPermissions`)
- `ios/Seconde/Info.plist:57-58` (`NSCameraUsageDescription` = `Allow $(PRODUCT_NAME) to access your camera`, anglais générique)
- `android/app/src/main/AndroidManifest.xml:4` (`CAMERA`)

Description : `expo-camera` (`CameraView` + `useCameraPermissions`) est utilisé dans 3 écrans atteignables en prod (home, recherche, onglet Vendre), mais le plugin `expo-camera` est **absent** de `app.config.js` et aucune chaîne `cameraPermission` FR n'y est définie. Les déclarations natives n'existent que par autolink d'un prebuild passé. CLAUDE.md pose `app.config.js` comme source de vérité unique et bloque les edits natifs : un `npx expo prebuild --clean` régénérerait `NSCameraUsageDescription` depuis le défaut autolink (`withCamera.js:5` = chaîne anglaise générique) et ajouterait `RECORD_AUDIO` (défaut `recordAudioAndroid: true`).

Impact : ce n'est pas une casse runtime aujourd'hui, mais une dérive de configuration / intégrité de la source de vérité. Un prebuild régénère une purpose string anglaise sur une app mono-FR-CA et re-dérive `RECORD_AUDIO`.

Recommandation : ajouter explicitement le plugin `expo-camera` dans `app.config.js` avec `cameraPermission` FR et `recordAudioAndroid: false`. (Voir P1-3 pour RECORD_AUDIO.)

### P1-3 — RECORD_AUDIO (Android) et NSMicrophoneUsageDescription (iOS) déclarés mais aucune fonctionnalité micro/audio/vidéo
**Sévérité : P1 · Plateforme : both**

Fichiers :
- `app.config.js:104` (`"android.permission.RECORD_AUDIO"`)
- `android/app/src/main/AndroidManifest.xml:8` ; `ios/Seconde/Info.plist:67-68` (anglais)
- `app/sell/capture.tsx:144`, `features/sell/components/capture/SellOverlayCapture.tsx:171`, `components/VisualSearchCamera.tsx:85` (`mediaTypes: ['images']`)

Description : `RECORD_AUDIO` est déclaré explicitement dans `app.config.js:104` (+ manifest), et `NSMicrophoneUsageDescription` côté iOS (en anglais, défaut autolink). Or aucun enregistrement audio/vidéo n'existe : les 3 composants caméra n'utilisent que des photos (`mediaTypes: ['images']`, aucun `recordAsync`, aucun `mode='video'`, aucune dépendance `expo-av`/`expo-audio` — grep négatif). `RECORD_AUDIO` est une permission « dangereuse » visible sur la fiche Play Store, déclenche la Data Safety review Google, et la demander sans usage est un motif d'avertissement/rejet.

Impact : risque store (avertissement/rejet Play Store), atteinte à la confiance utilisateur, et purpose string iOS en anglais sur app mono-FR.

Recommandation : retirer `RECORD_AUDIO` d'`app.config.js:104` ET ajouter un bloc plugin `expo-camera` avec `recordAudioAndroid: false` pour empêcher la réintroduction au prochain prebuild (sans le (b), le prebuild réinjecte `RECORD_AUDIO` + `NSMicrophoneUsageDescription`).

### P1-4 — react-native-maps avec PROVIDER_GOOGLE sans clé Google Maps → cartes cassées sur Android
**Sévérité : P1 · Plateforme : android** (corrigé : Android-only, pas `both`)

Fichiers :
- `app/shop/[id].tsx:24,249-265` (`provider={PROVIDER_GOOGLE}`, rendu si `shop.location` `:247`)
- `app/admin/shop-detail/[id].tsx:24,270-286`
- `app.config.js:51` (`expo-maps` enregistré, PAS le config plugin de `react-native-maps`)
- `android/app/src/main/AndroidManifest.xml` (aucun `com.google.android.geo.API_KEY`), `ios/Podfile.lock` (pod `GoogleMaps` absent)
- `package.json:82` (`react-native-maps 1.27.2`)

Description : deux écrans importent `MapView` de `react-native-maps` et forcent `provider={PROVIDER_GOOGLE}`. Aucune clé Google Maps n'est déclarée (ni manifest, ni `app.config.js`, ni `GMSApiKey`). Le config plugin de `react-native-maps` n'est PAS enregistré (seul `expo-maps` l'est, lib différente) → aucune clé injectée. **Android** : `react-native-maps` rend toujours Google Maps (seul provider) et exige la clé geo → sans clé, tuiles grises / carte morte sur la fiche boutique publique. **iOS** : le pod `GoogleMaps` n'étant pas lié, `provider={PROVIDER_GOOGLE}` retombe silencieusement sur Apple Maps → iOS N'EST PAS cassé.

Impact : sur Android, la fiche boutique grand public (`shop/[id]`) affiche une carte morte dès que `shop.location` existe.

Recommandation : enregistrer le config plugin `react-native-maps` dans `app.config.js` avec `androidGoogleMapsApiKey` (+ `iosGoogleMapsApiKey` seulement si on veut Google Maps sur iOS, sinon garder le fallback Apple Maps), puis prebuild. **Retirer `PROVIDER_GOOGLE` ne résout PAS Android** (Google Maps reste le seul provider, clé toujours requise).

### P1-5 — `android/` et `ios/` committés mais désynchronisés avec `app.config.js` (drift de permissions)
**Sévérité : P1 · Plateforme : both**

Fichiers :
- `android/app/src/main/AndroidManifest.xml` (lignes 4 `CAMERA`, 5 `INTERNET`, 7 `READ_EXTERNAL_STORAGE`, 9 `SYSTEM_ALERT_WINDOW`, 11 `WRITE_EXTERNAL_STORAGE`) + `debug/` et `debugOptimized/` aussi tracked
- `ios/Seconde/Info.plist:57-72` (purpose strings anglaises)
- `app.config.js:101-107` (permissions = ACCESS_*_LOCATION, RECORD_AUDIO, POST_NOTIFICATIONS, VIBRATE seulement) ; `:49` (commentaire mort Helcim)
- `.gitignore` (aucune ligne `android/`/`ios/`)

Description : les manifests natifs sont versionnés (`git check-ignore android ios` → non ignoré). Les permissions réellement embarquées (CAMERA, SYSTEM_ALERT_WINDOW, READ/WRITE_EXTERNAL_STORAGE, INTERNET) ne figurent PAS dans `app.config.js`, censé être la source de vérité unique. Les purpose strings iOS sont en anglais (autolink). Un `npx expo prebuild --clean` régénérerait les manifests depuis `app.config.js` + autolink avec un résultat **non identique** à l'état committé (strings repassées en anglais, set de permissions recalculé). Preuve de drift accumulé : le commentaire mort `// Helcim payment via WebView` (`app.config.js:49`) montre que les natifs ont été générés sous une config antérieure jamais re-synchronisée.

Impact : divergence latente d'infra des fondations partagées (parité iOS == Android), matérialisée au prochain `prebuild --clean`. Incohérent avec le hook `block-native-edits.sh` (natifs committés ET éditables-bloqués sans modèle documenté).

Recommandation : choisir un modèle unique — soit gitignore `android/ios` et tout déclarer dans `app.config.js` (plugins + permissions + descriptions), soit assumer les natifs committés — et **documenter la décision**.

### P1-6 — Channels Android `orders` et `saved_searches` jamais enregistrés côté app
**Sévérité : P1 · Plateforme : android**

Fichiers :
- `hooks/useNotificationSetup.ts:25-54` (`setupAndroidChannels` enregistre seulement `messages`, `offers`, `notifications`, `swaps`)
- `functions/src/utils/notifications.ts:132-137` (`return 'orders'` pour new_sale/order_*), `:190` (`channelId`)
- `functions/src/scheduled/savedSearches.ts:238` (`channelId: 'saved_searches'`)
- `app.config.js:61` (`targetSdkVersion: 34`)

Description : l'app enregistre exactement 4 channels Android. Le backend cible en plus deux channels jamais créés : `orders` (pour new_sale/order_shipped/delivered/cancelled/refunded) et `saved_searches`. Ce sont les **deux seuls** `channelId` backend orphelins (tous les autres pointent vers des channels enregistrés). Sur Android O+, un message FCM vers un channelId non créé n'est pas systématiquement droppé, mais **perd sa config d'importance/son/vibration** et est classé dans un channel générique non réglable par l'utilisateur (comportement variable selon OEM ; drop total = cas-limite).

Impact : sur Android, les notifications de vente/commande (vendeur informé d'une vente, acheteur d'une expédition/livraison) et les alertes de recherches sauvegardées sont dégradées/mal classées. iOS non affecté (pas de channels).

Recommandation : ajouter les channels `orders` et `saved_searches` dans `setupAndroidChannels()`, OU faire pointer `getAndroidChannel('orders')`/savedSearches vers `notifications`. Idéalement centraliser la liste des channels dans une constante partagée front/back.

### P1-7 — Couverture des paths Android (8) inférieure à iOS/AASA (14)
**Sévérité : P1 · Plateforme : android**

Fichiers :
- `public/.well-known/apple-app-site-association:7-22` (14 paths)
- `app.config.js:108-156` (8 pathPrefix : /article, /chat, /user, /shop, /swap-party, /swap, /notifications, /search)
- `hooks/useDeepLinking.ts:34-64` (handlers /favorites, /messages, /profile, /home)

Description : l'AASA iOS couvre 14 paths ; les intentFilters Android n'en couvrent que 8. **Correction** : `/search-results` N'EST PAS manquant sur Android — `pathPrefix: "/search"` matche par préfixe et intercepte `/search-results`. Les vrais paths manquants sur Android sont **5** : `/favorites`, `/messages`, `/profile`, `/sell`, `/settings`. Nuance : `/sell` et `/settings` ne sont que DOCUMENTÉS dans le JSDoc de `useDeepLinking.ts` (reposent sur le routing fichier auto d'Expo Router), pas gérés par un handler explicite. Note de cohérence : `/swap-party` est redondant avec `/swap` côté Android (préfixe).

Impact : 5 écrans/raccourcis ouvrent l'app via universal link sur iOS mais tombent dans le navigateur sur Android. Divergence cross-plateforme directe (sous réserve du P0-2 corrigé d'abord).

Recommandation : ajouter pathPrefix `/favorites`, `/messages`, `/profile`, `/sell`, `/settings` (PAS `/search-results`, déjà couvert). Idéalement source unique de vérité pour les deux plateformes.

### P1-8 — Divergence iOS/Android sur les hosts : `www.seconde.app` couvert sur iOS, absent des intentFilters Android
**Sévérité : P1 · Plateforme : android**

Fichiers :
- `app.config.js:73-76` (iOS `associatedDomains: ["applinks:seconde.app", "applinks:www.seconde.app"]`)
- `app.config.js:115,120,125,130,135,140,145,150` (8 blocs data, tous `"host": "seconde.app"`)
- `android/app/src/main/AndroidManifest.xml:36-48` (manifest prebuild réel : que `seconde.app`)
- `functions/src/utils/notifications.ts:13` (`DEEP_LINK_HOST = 'seconde.app'`, sans www)

Description : iOS déclare deux hosts (`seconde.app` ET `www.seconde.app`). Android n'en déclare qu'un (`seconde.app`) — confirmé dans la config ET le manifest prebuild généré. La seule occurrence de `www.seconde.app` dans tout le repo est `app.config.js:75` (iOS). Conséquence : `https://www.seconde.app/article/123` matchera l'app sur iOS mais tombera dans le navigateur sur Android.

Impact : même URL, comportement OS-dépendant (lien partagé depuis email/post web/recherche Google). Difficile à diagnostiquer côté support.

Recommandation : ajouter pour chaque pathPrefix Android une entrée `data` avec `"host": "www.seconde.app"` (ou un second intentFilter). À trancher avec le fondateur : quel host est canonique en prod (`DEEP_LINK_HOST` émet sans www) — couvrir les deux des deux côtés OU n'en garder qu'un partout.

### P1-9 — `isInternetReachable` diverge iOS/Android, et erreurs réseau confondues avec ressource introuvable
**Sévérité : P1 · Plateforme : both**

Fichiers :
- `components/ui/OfflineBanner.tsx:27` (`isOffline = !isConnected || !isInternetReachable`)
- `hooks/useNotificationSetup.ts` n/a — `hooks/useNetworkStatus.ts:8-9` (JSDoc trompeur cross-plateforme)
- `app/checkout/index.tsx:47,127-139` (pas d'`isError` → « Article introuvable » sans retry)
- `app/payment/[transactionId].tsx:61,224` (pas d'`isError` ; `if (!transaction) return null` → **écran blanc** sur l'écran de paiement)
- `app/article/[id].tsx:69-73,140-141` + `features/article/components/LoadingState.tsx:103-127` (**contre-exemple** : `isError` géré, copy réseau distinct)

Description : sur iOS, `expo-network` retourne toujours `isInternetReachable === isConnected` (NetworkModule.swift). Sur Android, `isInternetReachable` exige `NET_CAPABILITY_VALIDATED` (NetworkUtils.kt) → un portail captif déclenche le bandeau hors-connexion sur Android seulement. Le JSDoc de `useNetworkStatus.ts` est vrai uniquement sur Android. Côté écrans : `checkout` et `payment` ne destructurent pas `isError` → une erreur réseau transitoire est indistinguable d'une ressource supprimée (et `payment` rend un **écran blanc** sur l'écran de paiement Stripe). **Correction** : `article/[id].tsx` est en réalité le contre-exemple correct (gère `isError`, affiche un état réseau distinct) — seule lacune résiduelle : le bouton appelle `onBack` (navigation), pas `refetch()` in-place. La description initiale du finding était fausse sur ce fichier.

Impact : écran blanc sur l'écran de paiement en cas d'échec query, ambiguïté checkout, et bandeau offline incohérent iOS/Android sur captive portal.

Recommandation : aligner la sémantique `OfflineBanner` sur `isConnected` seul (ou expliciter le comportement captive-portal Android) + corriger le JSDoc ; destructurer `isError` et afficher un état « erreur réseau + Réessayer/refetch » sur checkout et payment ; ajouter un bouton `refetch()` à `article`.

---

## Findings P2 / P3

### P2-1 — Couleur du splash natif (sombre) ≠ première frame de l'app (crème) → flash au démarrage
**Sévérité : P2 (rétrogradé de P1) · Plateforme : both**

Fichiers : `app.config.js:11-15` (`backgroundColor: "#151718"`) ; `constants/theme.ts:28` (`background: '#FAF8F4'`) ; `app/_layout.tsx:93,185,188` (`backgroundColor: colors.background`) ; `hooks/useSplashScreen.ts:29-35` (`hideAsync` sur `onLayout`) ; `features/onboarding/styles.ts:10-12` ; `app/index.tsx:34-38`.

Description : le splash natif est sombre (`#151718`) mais la première frame rendue est crème (`#FAF8F4`). Au moment où `hideAsync()` s'exécute (déclenché par `onLayout` de la root view crème), l'écran bascule de sombre à crème → flash de couleur visible à chaque cold start, identique iOS/Android. L'icône du splash est elle-même posée sur fond sombre, incohérent avec l'identité Editorial Luxe crème. Rétrogradé P2 : cosmétique pur, pas de divergence iOS/Android (les deux plateformes sont identiquement affectées). L'architecture de démarrage est par ailleurs soignée (gate `appReady`, hide on first committed frame).

Impact : transition splash sombre → app crème perceptible à chaque ouverture, dégrade la perception de qualité au moment le plus visible.

Recommandation : aligner `app.config.js` `splash.backgroundColor` sur `#FAF8F4` (fix minimal) ; idéalement reposer l'icône du splash sur fond clair. `StatusBar` est déjà `style="dark"` (cohérent avec un fond clair). (Doublon : ce finding et un second finding « Fond de splash SOMBRE vs onboarding crème » décrivent le même défaut — traiter une seule fois.)

### P2-2 — Écrans canvas sombre sans StatusBar light
**Sévérité : P2 (rétrogradé de P1) · Plateforme : both**

Fichiers : `app/_layout.tsx:231` (`<StatusBar style="dark" />` global) ; `app/sell/capture.tsx:307-308` (fond `#0F0E0C`, aucun StatusBar) ; `components/VisualSearchCamera.tsx:262-264` (`#000000`) ; `components/ImageGallery.tsx:237-239` (Modal `#000000`). Contre-exemple : `app/swap-zone.tsx:508,519,537` (`style="light"`).

Description : un seul `StatusBar style="dark"` global. Sur les écrans à canvas sombre (capture photo, caméra recherche visuelle, viewer image plein écran), les icônes système sombres deviennent peu lisibles sur fond noir. `swap-zone.tsx` montre le pattern attendu (`style="light"`) qui manque ailleurs. Aucun écran ne fixe `StatusBar backgroundColor` (prop Android) → comportement de fond de barre pouvant diverger iOS/Android. Rétrogradé P2 : lisibilité/esthétique des contrôles système, pas un état cassé ; correctif trivial.

Impact : contrôles système peu lisibles sur le flow Vendre et les viewers.

Recommandation : ajouter `<StatusBar style="light" />` dans `capture.tsx`, `VisualSearchCamera.tsx` et le Modal d'`ImageGallery`, en répliquant `swap-zone.tsx:537`.

### P2-3 — Infra dark-mode morte + Colors.dark = Colors.light
**Sévérité : P2 · Plateforme : both**

Fichiers : `hooks/useThemeColor.ts:9,13` ; `constants/Colors.ts:18-19,36-51,55` ; `hooks/useColorScheme.ts` ; `hooks/useColorScheme.web.ts` ; `app/_layout.tsx:41` (`dark: false`).

Description : `useThemeColor` / `Colors.ts` / `useColorScheme(.web)` forment une chaîne de **code mort** (grep : aucun consommateur hors la chaîne elle-même). Le bloc `dark` de `Colors.ts` est byte-identique au bloc `light`. Le fallback `?? 'light'` est inerte (dark === light) et le hook n'est jamais appelé → zéro impact runtime, mais piège de maintenance trompeur. **Ne pas confondre** avec `constants/theme.ts` (système vivant, source des `colors` utilisés partout dont `_layout.tsx:41`).

Impact : code mort trompeur ; un dev pourrait croire le dark mode supporté.

Recommandation : supprimer les 4 fichiers morts en chaîne (`useThemeColor.ts`, `useColorScheme.ts`, `useColorScheme.web.ts`, `constants/Colors.ts`). NE PAS toucher `constants/theme.ts`.

### P2-4 — Couleurs hors palette DS (violet, gris Tailwind, iOS)
**Sévérité : P2 · Plateforme : both**

Fichiers : `components/ConfidenceIndicator.tsx:105` (`#6D28D9` x4) ; `app/shop/[id].tsx:149,198,363,429,513` (`#FF3B30`/`#34C759`) ; `components/CategoryDisplay.tsx:125` (`#1F2937` — **pas** ligne 95 qui est `#374151`) ; `components/DraftResumeModal.tsx:186,223` (`#1F2937`) ; `app/admin/shop-detail/[id].tsx:355-359` (FF3B30/34C759/FF9500) ; tokens DS : `constants/theme.ts:57-62` (`danger #D64545`, `success #3D9970`, `warning #E09F3E`).

Description : couleurs iOS système, violet et gris Tailwind hardcodés au lieu des tokens DS `danger`/`success`/`warning`. ~189 littéraux hex 6-digits mesurés (l'estimation « ~174 » est de bon ordre de grandeur). Aucune divergence iOS/Android (rendu identique).

Impact : rupture visuelle hors palette de marque.

Recommandation : remplacer par les tokens DS. (Correction de la citation : `CategoryDisplay.tsx` `#1F2937` est ligne 125, pas 95.)

### P2-5 — Tokens spring dans le DS ET consommés activement (violation anti-spring répandue)
**Sévérité : P2 (relevé de P3) · Plateforme : both**

Fichiers : `constants/theme.ts:346-363` (`spring`), `:375` (`scale.bounce: 1.2` — **pas** 376) ; consommateurs `withSpring` : `app/liked-sellers.tsx:80,84` ; `features/home/price-drops/PriceDropsSection.tsx:76,79,86` ; `features/home/featured-sellers/FeaturedSellersSection.tsx:87,90,97` ; `features/home/trending-brands/TrendingBrandsSection.tsx:85,88` ; `features/profile/components/ProfileMenu.tsx:49,53` ; `features/onboarding/components/SexOption.tsx:32,36` ; `components/ui/Tag.tsx:57,61` ; `components/ui/Button.tsx:149,153` ; `components/ui/TabBar.tsx:88,92`.

Description : le token `animations.spring` n'est PAS un risque latent — il est **activement consommé par `withSpring()` dans 10 fichiers**, violation directe et en production de la règle « no spring animations ». Relevé P3→P2 car la dérive a déjà eu lieu. Le sous-token `scale.bounce` (`:375`) est en revanche du code mort (grep = 0 hit hors définition).

Impact : violation active et répandue de la règle anti-spring (withTiming + ease-out attendu).

Recommandation : migrer les 10 consommateurs de `withSpring` vers `withTiming` + ease-out D'ABORD, puis retirer le token `spring`. `scale.bounce` peut être supprimé immédiatement (dead code). **Ne pas** « supprimer `animations.spring` » tel quel (casserait 10 fichiers).

### P2-6 — Gate splash sans timeout sur `prefetchHome` → démarrage retardé jusqu'à ~70s sur réseau bloqué
**Sévérité : P2 · Plateforme : both**

Fichiers : `app/_layout.tsx:172` (`appReady = fontsReady && authHydrated && homePrefetched`), `:162-166` ; `features/home/prefetchHome.ts:33-49` (Promise.allSettled, retry:false) ; `features/home/trending-brands/useTrendingBrands.ts:16-19`, `features/home/new-arrivals/useNewArrivals.ts:28-35` (`httpsCallable` sans timeout) ; `store/authStore.ts:174-177`.

Description : `homePrefetched` ne bascule qu'à la résolution de `prefetchHome`, dont les `queryFn` sont des `httpsCallable` Firebase sans timeout applicatif. Sur un réseau qui accepte la connexion mais ne répond pas (captive portal, DNS lent), l'appel reste pending jusqu'au timeout SDK callable (~70s) → splash bloqué. L'auth ne sauve pas le cas (le gate exige AUSSI `homePrefetched`). Identique iOS/Android.

Impact : cold start sur réseau dégradé → splash bloqué plusieurs dizaines de secondes sans feedback, perçu comme freeze/crash.

Recommandation : encadrer `prefetchHome` d'un `Promise.race` avec un timeout court (3-4 s) qui force `homePrefetched=true` ; le prefetch finit en arrière-plan, les sections refetchent via leur propre `useQuery` (retry:2).

### P2-7 — SafeAreaProvider monté sans `initialMetrics` sous New Arch → insets nuls à la première frame
**Sévérité : P2 · Plateforme : both**

Fichiers : `app/_layout.tsx:27,92` (`<SafeAreaProvider>` sans `initialMetrics`) ; `components/ui/OfflineBanner.tsx:24,52,77-78` ; `components/AuthBottomSheet.tsx:59,396` ; `app/+not-found.tsx:4,12`.

Description : sous New Arch (Expo SDK 56, `initialWindowMetrics` typé `Metrics | null`), `useSafeAreaInsets()` peut renvoyer 0 sur la première frame avant la mesure native asynchrone. La bannière offline (absolue, doit passer sous l'encoche), le `topInset` du bottom sheet et `+not-found` (route navigable sans gate splash) sont concernés. Le gate splash atténue le risque pour les consommateurs montés en branche `appReady`, mais ne le garantit pas formellement. Cosmétique, transitoire, identique iOS/Android.

Impact : saut visuel possible (texte sous la barre de statut une fraction de seconde) sur iPhone à encoche et Android à punch-hole.

Recommandation : `import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context'` puis `<SafeAreaProvider initialMetrics={initialWindowMetrics}>`.

### P2-8 — StripeProvider sans `urlScheme` alors qu'un `returnURL seconde://` est utilisé ; clé Stripe pk_test hardcodée
**Sévérité : P2 · Plateforme : both**

Fichiers : `app/_layout.tsx:95` (`<StripeProvider publishableKey={...}>` sans `urlScheme`) ; `components/StripePayment.tsx:75` (`returnURL: 'seconde://checkout/success'`), `:67-73` (Apple/Google Pay activés) ; `config/stripeConfig.ts:6-7` (`pk_test_...` hardcodé) ; `app.config.js:9,84-85` (scheme `seconde`) ; `config/firebaseConfig.ts` (pattern `EXPO_PUBLIC_*`).

Description : `StripeProvider` n'a pas de prop `urlScheme` (ni `merchantIdentifier`), alors qu'un `returnURL: 'seconde://checkout/success'` est utilisé pour la reprise après redirection (3DS/banque). Le SDK recommande `urlScheme` sur le provider pour fiabiliser cette reprise. La clé `STRIPE_PUBLISHABLE_KEY` est en `pk_test` hardcodée sans override env, contrairement à `firebaseConfig` (`EXPO_PUBLIC_*`) → risque d'expédier la clé test en prod. (Lié : `merchantIdentifier` absent casse Apple Pay côté iOS — voir P3-9.)

Impact : reprise post-redirection moins fiable sur les deux plateformes ; risque de build prod avec clé Stripe de test.

Recommandation : ajouter `urlScheme="seconde"` (+ `merchantIdentifier` si Apple Pay) au `StripeProvider` ; externaliser via `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` avec fallback.

### P2-9 — Image de splash = icône 1024×1024 sans alpha → masquage cercle Android 12+
**Sévérité : P2 · Plateforme : both**

Fichiers : `app.config.js:11-14` (`image: ./assets/images/icon.png`, `resizeMode: contain`, `backgroundColor: #151718`) ; `assets/images/icon.png` (1024×1024, `hasAlpha: no`) ; `package.json:72` (`expo-splash-screen ~56.0.10`) ; `app/_layout.tsx:3,32,174`.

Description : le splash réutilise l'icône d'app (carrée, pleinement opaque, aucune zone de respiration). Sur Android 12+, le système recadre l'image dans un cercle/zone système → rendu potentiellement différent d'iOS (icône centrée plein cadre). Aucun asset de splash dédié. **Précision** : `expo-splash-screen` est déjà une dépendance et utilisé par programmation, mais le plugin n'est PAS enregistré dans `plugins[]` (la config visuelle passe par la clé legacy `splash`) — c'est le bon levier de correction.

Impact : rendu du splash potentiellement divergent iOS vs Android 12+, et visuel « icône brute » peu soigné.

Recommandation : fournir un asset de splash dédié (mark centré avec marge, PNG transparent) + `imageWidth`, configuré via le plugin `expo-splash-screen` ; valider Android 12+ (cercle) et iOS.

### P2-10 — `hooks/useFonts.ts` est du code mort + diverge de la liste de polices réellement chargée
**Sévérité : P2 · Plateforme : both**

Fichiers : `hooks/useFonts.ts:20,27-38,62,95,98` ; `app/_layout.tsx:1` (`import { useFonts } from 'expo-font'`), `:71-85`.

Description : `hooks/useFonts.ts` exporte un hook custom jamais importé (le `useFonts` de `_layout.tsx` vient d'`expo-font`). Le chargement réel charge 8 polices dont `SpaceMono` ; le hook custom n'en charge que 7 (sans SpaceMono). Self-doc trompeuse (`:95` recommande d'utiliser ce hook dans `_layout.tsx`, ce qui n'est pas le cas). Code mort + piège de maintenance, zéro impact runtime.

Impact : modifier `hooks/useFonts.ts` n'a aucun effet ; risque de divergence silencieuse de la liste de polices.

Recommandation : supprimer `hooks/useFonts.ts` (et le helper `getFontFamily` inutilisé), ou faire de `_layout.tsx` un consommateur de ce hook unique.

### P2-11 — Échec de chargement des polices avalé silencieusement (pas de retry ni télémétrie)
**Sévérité : P2 · Plateforme : both**

Fichiers : `app/_layout.tsx:71-87` (`fontsReady = fontsLoaded || !!fontError`) ; `hooks/useFonts.ts:40-45` (chemin mort) ; `components/AppErrorBoundary.tsx:23-37`.

Description : dès qu'une erreur de chargement police survient, `fontsReady` passe `true` et l'app s'affiche en polices système, sans log, retry ni remontée. **Corrections** : (1) le hook mort `useFonts.ts:41` log pourtant via `console.error` — le « aucun log » s'applique uniquement au chemin vivant (`_layout.tsx`) ; (2) il n'existe AUCUNE infra de crash reporting dans le projet (pas de Sentry/Crashlytics — seul un commentaire dans `AppErrorBoundary.tsx:23`), donc la reco « logger vers Sentry/Crashlytics » nécessite de câbler d'abord un reporter.

Impact : si les polices ne chargent pas, l'identité typographique Editorial Luxe disparaît sans aucune alerte (bug invisible en monitoring).

Recommandation : logger `fontError` (une fois un reporter câblé), le distinguer du succès, envisager un retry unique avant fallback.

### P2-12 — Plugin `expo-maps` listé dans `app.config.js` mais jamais importé (plugin mort)
**Sévérité : P2 · Plateforme : both**

Fichiers : `app.config.js:51` (`"expo-maps"`) ; `app/shop/[id].tsx:24`, `app/admin/shop-detail/[id].tsx:24` (`react-native-maps`) ; `package.json:67` (`expo-maps`), `:82` (`react-native-maps`).

Description : `expo-maps` est un config plugin ACTIF (injecte du code natif Apple/Google Maps au prebuild) mais jamais importé (grep = 0). La cartographie réelle passe par `react-native-maps`. Gonfle le binaire iOS et Android et brouille la maintenance.

Impact : code natif inutile embarqué, confusion de maintenance. Pas de bug runtime.

Recommandation : retirer `"expo-maps"` de `app.config.js:51` ET la dépendance `expo-maps` de `package.json:67`, puis relancer `npx expo prebuild`. Profiter du passage pour nettoyer le commentaire Helcim `:49`.

### P2-13 — Toutes les purpose strings iOS (NS*UsageDescription) en anglais alors que l'app est mono-FR-CA
**Sévérité : P2 · Plateforme : ios**

Fichiers : `ios/Seconde/Info.plist:57-72` (Camera/Location/Microphone/PhotoLibrary), `:61-64` (LocationAlways), `:69-70` (Motion) ; `app.config.js:43` (`photosPermission` en anglais) ; `constants/locale.ts:7` (`APP_LOCALE = 'fr-CA'`).

Description : l'app cible le Canada francophone, mais TOUTES les descriptions d'usage iOS sont en anglais (« Allow Seconde to access your X »), y compris Location, Motion non listées par le finding initial. Seul `photosPermission` est customisé dans `app.config.js` (et en anglais). Apple peut rejeter (Guideline 5.1.1) pour purpose string générique/non localisée ; un utilisateur FR voit des pop-ups système en anglais. Un prebuild régénère ces strings depuis les défauts plugin anglais.

Impact : risque de rejet App Store + pop-ups en anglais sur app mono-FR.

Recommandation : définir toutes les purpose strings en FR dans `app.config.js` (`ios.infoPlist` NS*UsageDescription + `cameraPermission`/`locationWhenInUsePermission`/photos des plugins).

### P2-14 — Offline non câblé : `networkMode online` sans `onlineManager` et Firestore sans persistance
**Sévérité : P2 (rétrogradé de P1) · Plateforme : both**

Fichiers : `lib/queryClient.ts:14-22` (pas de `networkMode`/`onlineManager`) ; `config/firebaseConfig.ts:53` (`getFirestore(app)` brut) ; `app/chat/[id].tsx:114-125` ; `hooks/useFavorites.ts:196-235` ; `hooks/useNetworkStatus.ts` ; `hooks/useChat.ts`.

Description : `queryClient` n'a pas de `networkMode` ni d'`onlineManager` (en RN, sans `onlineManager.setEventListener`, RQ retombe sur `navigator.onLine` = `undefined` → RQ se croit toujours online, pas de refetch au retour réseau). Firestore Web SDK est en cache mémoire (offline, une écriture **pend** sans résoudre ni rejeter). **Corrections** : (1) `chat/[id].tsx:120-124` a bien un `Alert` dans le catch (mais il ne se déclenche jamais offline car l'écriture pend) ; le vrai vecteur de doublons est l'absence de garde « isSending » sur `handleSendMessage` ; (2) `useFavorites.ts:220-228` implémente correctement le rollback `onError` — il fonctionne pour les vraies erreurs serveur, seul l'offline pur (écriture pendante) ne le déclenche pas. Rétrogradé P2 : OfflineBanner prévient déjà l'utilisateur, pas de corruption de données.

Impact : offline pur → champ chat non vidé + doublons potentiels (retap Envoyer), pas de refetch auto au retour réseau. Identique iOS/Android.

Recommandation : câbler `onlineManager.setEventListener` sur `expo-network`, activer `persistentLocalCache` (ou `networkMode` borné), et ajouter une garde « isSending » sur `handleSendMessage`.

### P2-15 — Error boundaries limitées à Home, retry en boucle, aucun `onError` global React Query
**Sévérité : P2 · Plateforme : both**

Fichiers : `features/home/SectionErrorBoundary.tsx` (seul consumer : `app/(tabs)/index.tsx:98`) ; `components/AppErrorBoundary.tsx:33-41` (retry = `setState` seul, log DEV only) ; `lib/queryClient.ts:14-22` (pas de `QueryCache`/`MutationCache` onError) ; `features/home/prefetchHome.ts:33-49` ; `app/_layout.tsx:90`.

Description : `SectionErrorBoundary` n'est monté que dans Home ; toutes les autres routes (article, chat, checkout, payment, wallet) ne sont protégées que par le boundary global → un crash de rendu démonte tout l'arbre. Le retry global ne fait que `setState` (boucle si erreur déterministe, pas de reset des queries). Aucun `onError` global RQ. `componentDidCatch` ne log qu'en DEV (pas de Sentry/Crashlytics). `prefetchHome` avale les échecs (intentionnel et documenté — les sections refetchent au mount).

Impact : résilience + observabilité limitées ; zéro observabilité des render-crashes en prod. Identique iOS/Android.

Recommandation : ajouter des error boundaries de portée écran (export `ErrorBoundary` de segment Expo Router) sur les routes critiques ; faire que le retry global reset les queries ; configurer `QueryCache`/`MutationCache` onError loggant en prod (une fois un reporter câblé).

### P2-16 — Devise affichée en convention US `$X` au lieu du canadien `X $` dans les écrans de swap
**Sévérité : P2 · Plateforme : both**

Fichiers : `components/swap/SwapItemCard.tsx:70` (`${item.price}`) ; `features/swap/components/SwapProposalView.tsx:90` (`${cashTopUp.amount}`) ; **+ `components/swap/SwapSummaryBox.tsx:29`** (` + $${cashSupplement}` — omis par le finding) ; référence `utils/formatPrice.ts:8` (`${amount} $`).

Description : trois composants de la feature swap affichent le `$` en préfixe (convention US) au lieu du suffixe espace-dollar canadien imposé par `formatPrice`. Sur l'écran de proposition, le même montant de complément cash s'affiche DEUX fois en format US (`SwapProposalView:90` + `SwapSummaryBox:29` rendu juste en dessous). `formatPrice` est utilisé 114× ailleurs (dont `app/my-swaps.tsx:385-386`). Cosmétique, identique iOS/Android.

Impact : « $45 » / « $20 en argent » détonnent avec « 45 $ » partout ailleurs sur un écran de négociation de valeur (crédibilité locale Québec).

Recommandation : importer `formatPrice` et remplacer les **3** sites (`SwapItemCard:70`, `SwapProposalView:90`, `SwapSummaryBox:29` en conservant le ` + ` hors helper).

### P2-17 — `formatPriceWithCurrency` (seul format non-ambigu `$ CA`) défini, documenté, jamais utilisé
**Sévérité : P2 · Plateforme : both**

Fichiers : `utils/formatPrice.ts:21-23` (+ doc `:13-20`, tests `formatPrice.test.ts:34-49`) ; `app/wallet.tsx:88` ; `app/checkout/shipping.tsx:560` ; `app/payment/[transactionId].tsx:289` ; `app/checkout/success.tsx:107`.

Description : `formatPriceWithCurrency` produit « 45,00 $ CA » et son commentaire impose son usage dans checkout/seller balance/withdrawal/payout. Or aucun appel runtime/UI (grep : seulement définition + tests). Tous les contextes financiers utilisent `formatPrice` (« 45 $ ») ou du formatage inline (« 45,00 $ »), jamais « $ CA ». L'intention de désambiguïsation CAD est capturée dans le code mais appliquée nulle part. (Nuance : la fonction a une couverture de tests — « jamais utilisé » vaut pour le runtime, pas pour « aucune référence ».)

Impact : dans paiement/solde/retrait, montants en « $ » ambigu (CAD vs USD) alors qu'un format CAD non-équivoque était prévu ; helper mort trompeur.

Recommandation : trancher — utiliser `formatPriceWithCurrency` dans checkout/wallet/payout/withdrawal, OU supprimer la fonction morte + commentaire + test.

### P2-18 — Commentaire de config obsolète (Helcim) dans `app.config.js`
**Sévérité : P3 · Plateforme : both**

Fichiers : `app.config.js:49` (`// Helcim payment via WebView — no native plugin needed`).

Description : commentaire mort référençant Helcim (migration Stripe terminée Sprint 6). Aucun effet runtime. Doublon : trois findings distincts pointent ce même commentaire — à traiter une seule fois. (Sous-claim distinct hors périmètre : `functions/lib/config/helcim.js` contient encore un `HelcimClient` compilé — dimension functions.)

Impact : confusion documentaire sur la stack paiement au niveau config native.

Recommandation : supprimer le commentaire (ou le remplacer par une note Stripe).

### P3-1 — `useImmersiveOverlay` repose sur un singleton module mutable (no-op silencieux possible)
**Sévérité : P3 · Plateforme : ios**

Fichiers : `components/ui/ImmersiveOverlay/index.tsx:69-70,72-81,197-204` ; `app/(tabs)/_layout.tsx:64,71` ; `store/immersiveOverlayStore.ts:44-53`.

Description : `useImmersiveOverlay()` ne lit aucun Context — il appelle des globales de module mutables (`_immerse`/`_dismiss`) assignées par le `useEffect` du composant. Le hook est appelé hors de `<ImmersiveOverlay>` (`_layout.tsx:64` avant `:71`) — ça ne crashe que parce que c'est un singleton, pas un Context. `immerse()` est `_immerse?.(opts)` (optional chaining) → si appelé avant le commit de l'effet, no-op silencieux. Risque faible (mono-instance, appel sur tap utilisateur ; chemin iOS-only).

Impact : un appel précoce ou un futur double montage rendrait le bouton Vendre inopérant sans trace.

Recommandation : migrer `immerse`/`dismiss` vers une action du store Zustand existant (`immersiveOverlayStore`) co-localisée avec le provider.

### P3-2 — SpaceMono chargé au démarrage mais inutilisé (poids bundle + gate splash inutiles)
**Sévérité : P3 · Plateforme : both**

Fichiers : `app/_layout.tsx:72-73` (`SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf')`) ; `constants/theme.ts:93-119` (aucune référence) ; `assets/fonts/SpaceMono-Regular.ttf` (~91 KB).

Description : la police « Legacy » SpaceMono est chargée dans le gate de démarrage et conditionne `fontsReady` → masquage du splash, alors qu'elle n'est référencée nulle part dans le DS (grep global = unique hit au `require`).

Impact : police morte chargée au cold start (~91 KB), surcoût marginal.

Recommandation : retirer le `require` ET le fichier asset.

### P3-3 — `signInWithApple()` sans garde de plateforme (crash si appelé hors iOS)
**Sévérité : P2 · Plateforme : android**

Fichiers : `services/authService.ts:396,408` (pas de `Platform.OS` avant `AppleAuthentication.signInAsync`) vs `:716` (reauth gardé) ; `components/auth-bottom-sheet/SignInForm.tsx:60`, `SignUpForm.tsx:122` (bouton gaté iOS) ; `store/authStore.ts:259-266` (pas de garde non plus) ; `AuthBottomSheet.tsx:147`.

Description : `signInWithApple()` appelle `AppleAuthentication.signInAsync()` sans vérification `Platform.OS`, contrairement à `reauthenticateWithApple()`. Le seul garde-fou est l'UI (bouton gaté iOS). Asymétrie défensive : la ré-auth est gardée, pas le sign-in. `Platform` est déjà importé (`:34`) → fix trivial. Risque actuel quasi-nul (UI gatée) mais fragile pour tout futur chemin non-UI (deep link, test).

Impact : crash natif peu lisible si le flux Apple est déclenché hors iOS par un chemin non-UI.

Recommandation : ajouter `if (Platform.OS !== 'ios') throw new Error('Apple Sign-In disponible uniquement sur iOS.')` en tête de `signInWithApple()`.

### P3-4 — Ré-authentification Apple impossible hors iOS (cas edge `requires-recent-login`)
**Sévérité : P3 (rétrogradé de P2) · Plateforme : android**

Fichiers : `services/authService.ts:716,862,868,906-907` ; `app/settings/add-password.tsx:30,61,68-73` ; `app/settings/delete-account.tsx:38,337` ; `app/settings/email.tsx:42,272-278` ; `app/wallet.tsx:67-74,323`.

Description : `reauthenticateWithApple()` lève sur non-iOS. **Corrections majeures** : (1) une voie de récupération cross-plateforme EXISTE — `add-password.tsx` → `linkPasswordCredential` (`linkWithCredential`, sans garde iOS, fonctionne sur Android) ; les écrans email/delete-account routent l'utilisateur Apple-sur-Android vers cette page ; l'email relais Apple n'est pas bloquant (champ éditable). (2) Les payouts/retraits ne nécessitent AUCUNE ré-auth (`wallet.tsx:323` `withdraw(cents)`) — la dimension payout du finding est fausse. Risque résiduel réel et étroit : `add-password` ne gère pas `auth/requires-recent-login` (message générique) → sur session ancienne, le link peut échouer, bloquant la suppression de compte (angle Loi 25 limité à ce sous-cas).

Impact : cas edge `requires-recent-login` sur session Apple ancienne sur Android → impossible de lier un mot de passe, donc de supprimer le compte.

Recommandation : gérer explicitement `auth/requires-recent-login` dans `add-password.tsx` (message dédié + chemin de récupération). Pas de chantier majeur.

### P3-5 — Le délai fixe de 500 ms au cold start peut router avant que le navigator soit prêt
**Sévérité : P3 (rétrogradé de P2) · Plateforme : both**

Fichiers : `hooks/useDeepLinking.ts:104-107` (`setTimeout(() => handleDeepLink(initialUrl), 500)`), `:34-64` (5 patterns custom : /search, /favorites, /messages, /profile, /home), `:80-83` (autres = Expo Router auto) ; `app/_layout.tsx:135,172,178-180`.

Description : l'URL initiale est traitée via `setTimeout(..., 500)` arbitraire, monté pendant le splash. Si `authHydrated + homePrefetched` dépasse 500 ms (réseau lent), `router.push/replace` est appelé avant le montage du Stack → navigation perdue. **Correction** : le handler custom n'émet que pour 5 patterns hardcodés ; `article/{id}`, `chat/{id}`, `shop/{id}` (exemples phares du finding) sont résolus nativement par Expo Router (getInitialState), **immunisés** contre cette course. Le seul cas vraiment gênant est `seconde://search?query=...`. Warm start non affecté.

Impact : sur device lent, un deep link vers une des 5 routes secondaires (surtout search) arrive à l'accueil au lieu de la cible.

Recommandation : remplacer le `setTimeout` fixe par un déclenchement basé sur la readiness (`appReady` du store, ou `rootNavigationState` d'expo-router). Nettoyage de robustesse, pas bug majeur.

### P3-6 — Le push `swap_proposed` n'a pas de case dédié dans le routing (fallback fragile par ordre de champs)
**Sévérité : P3 (rétrogradé de P2) · Plateforme : both**

Fichiers : `functions/src/triggers/swaps.ts:80-85` (`data: { type: 'swap_proposed', swapId, ... }`) ; `hooks/useNotificationSetup.ts:65-139` (switch sans `case 'swap_proposed'`, fallback `default:128-139` teste chatId→articleId→partyId→swapId) ; `functions/src/utils/notifications.ts:23-78,275` ; `store/notificationStore.ts:6-21`.

Description : `swap_proposed` n'a pas de case dans `routeFromNotificationData` → le tap retombe dans `default` qui route correctement vers `/swap/{swapId}` **uniquement par effet de l'ordre des branches** (seul `swapId` est présent). Couplage implicite : ajouter un `chatId`/`articleId` au payload casserait le routing. Le routing FONCTIONNE aujourd'hui (risque latent, pas bug courant) → rétrogradé P3. **Renforcement** : `swap_proposed` est aussi absent du type union `PushNotificationType` et du switch `buildDeepLink`. (Correction sourcing : `swap_update` est émis par `notifications.ts:275`, pas `swaps.ts`.)

Impact : régression future si le payload `swap_proposed` évoluait.

Recommandation : ajouter `case 'swap_proposed': if (data.swapId) router.push('/swap/'+data.swapId); return;` ; compléter par l'ajout du type à `PushNotificationType` et un case `buildDeepLink`.

### P3-7 — Deep links universels Android sans intent filter pour `/my-orders`
**Sévérité : P3 (rétrogradé de P2) · Plateforme : android**

Fichiers : `functions/src/utils/notifications.ts:13,56-63` (`https://seconde.app/my-orders` pour order_*) ; `app.config.js:108-156` (pas de `/my-orders`) ; `hooks/useNotificationSetup.ts:59-140`.

Description : le backend génère `https://seconde.app/my-orders` pour les notifications de commande ; l'intentFilter Android ne le couvre pas → lien universel /my-orders à froid (email/SMS) ouvre le navigateur sur Android, l'app sur iOS. **Corrections majeures** : (1) `/payment` et `/review` ne sont JAMAIS émis comme liens universels (grep exhaustif des `${DEEP_LINK_HOST}/`) — à RETIRER du finding (`review_received` émet `/notifications`, déjà couvert) ; (2) `routeFromNotificationData` ne gère PAS les types order_*/new_sale (tombent dans `default` sans clé reconnue) → le tap in-app pour une commande ne navigue probablement nulle part non plus (bug distinct). Rétrogradé P3 : le scénario d'un lien universel /my-orders froid hors-app est marginal (notifications envoyées via FCM push, pas email/SMS web).

Impact : marginal — cliquer un lien universel /my-orders hors-app ouvre le navigateur sur Android.

Recommandation : ajouter le pathPrefix `/my-orders` (PAS `/payment` ni `/review`) à l'intentFilter Android, puis prebuild.

### P3-8 — Aucun plugin `expo-splash-screen` — pas de variante par mode/plateforme
**Sévérité : P3 (rétrogradé de P2) · Plateforme : both**

Fichiers : `app.config.js:10` (`userInterfaceStyle: automatic`), `:11-15` (clé legacy `splash`), `:19-67` (pas de plugin) ; `app/_layout.tsx:41` (`dark: false`) ; `package.json:72`.

Description : le splash n'utilise que la clé legacy `splash` (non différenciée par mode/plateforme), le plugin n'étant pas dans `plugins[]`. **Corrections** : (1) le `backgroundColor` est `#151718` (SOMBRE, proche `colors.deep`), PAS crème — la prémisse « variante dark manquante » du finding est inversée ; (2) comme le navigationTheme est figé clair (`dark: false`) ET le splash figé sombre quel que soit le mode système, l'incohérence n'est PAS dark-mode-spécifique : `userInterfaceStyle: automatic` est largement inerte (le thème ne suit jamais le dark mode). Rétrogradé P3 : hygiène de config, pas de divergence iOS/Android.

Impact : splash non configurable par mode/plateforme, dépendant du défaut Expo plutôt que d'une config explicite versionnée.

Recommandation : adopter le plugin `expo-splash-screen` (image, backgroundColor aligné DS), idéalement avec asset dédié. (Recoupe P2-1 et P2-9.)

### P3-9 — Polices .otf embarquées au build ET rechargées au runtime — redondance perçue
**Sévérité : P3 · Plateforme : android**

Fichiers : `app.config.js:23-31` (plugin expo-font, 7 polices dont Satoshi .otf) ; `app/_layout.tsx:71-85` (useFonts runtime) ; `node_modules/expo-font/plugin/build/withFontsAndroid.js`, `withFontsIos.js`.

Description : le finding suppose une redondance « useFonts superflu ». **Prémisse FAUSSE pour Android** : avec la config en tableau de strings, le plugin sur Android se contente de COPIER les fonts dans les assets (`withFontsAndroid.js:17-23`) ; l'enregistrement par famille (`ReactFontManager.addCustomFont`) n'est branché QUE sur la forme objet `{fontFamily, fontDefinitions}`. Donc `useFonts` runtime est ce qui rend réellement les polices disponibles sur Android — les deux déclarations sont **complémentaires, pas redondantes**. Côté iOS, les strings vont dans `UIAppFonts` (pré-enregistré au boot) → la (légère) redondance est plutôt iOS. La crainte « OTF fragile sur Android » est spéculative (`.ttf`/`.otf` copiés à l'identique).

Impact : nul à négatif — la reco principale du finding (supprimer `useFonts`) casserait la résolution de police sur Android.

Recommandation : NE PAS retirer `useFonts`. Au mieux, documenter la complémentarité, ou migrer vers la forme objet `{fontFamily, fontDefinitions}` du plugin pour un vrai enregistrement build-time cross-plateforme.

### P3-10 — Badge APNs iOS forcé à 1 sur chaque push (désync avec le compteur réel)
**Sévérité : P3 · Plateforme : ios**

Fichiers : `functions/src/utils/notifications.ts:209`, `:292` (2e occurrence non citée par le finding) ; `functions/src/triggers/messages.ts:124` ; `functions/src/triggers/swaps.ts:98` ; `functions/src/scheduled/savedSearches.ts:246` (seule vraie valeur) ; `hooks/useNotificationSetup.ts:179,312,316` ; `store/notificationStore.ts:82`.

Description : toutes les notifications fixent `aps: { badge: 1 }` en dur (4 occurrences ; seul savedSearches utilise `matchingArticles.length`). **Correction** : l'affirmation « l'app maintient un compteur réel via setBadgeCountAsync et se corrige à l'ouverture » est FAUSSE — `refreshBadgeCount`/`refreshNotificationBadge` ne mettent à jour que le compteur Zustand in-app, jamais `setBadgeCountAsync`. Le seul appel `setBadgeCountAsync` est `setBadgeCountAsync(0)` dans `clearAllNotifications` (chemin peu emprunté). Donc le badge natif iOS reste à 1 et **n'est jamais réconcilié** au vrai nombre de non-lus (légèrement pire que décrit, mais cosmétique). Android ignore `aps.badge`.

Impact : badge d'icône iOS trompeur (toujours 1 après un push). Cosmétique, incohérent iOS/Android.

Recommandation : calculer le vrai unread côté backend avant envoi et le passer dans `aps.badge` (comme savedSearches), OU omettre `aps.badge` et piloter réellement le badge côté app (ajouter `setBadgeCountAsync(count)` dans refreshBadgeCount).

### P3-11 — Constante `APP_LOCALE` contournée par des `'fr-CA'` hardcodés
**Sévérité : P3 · Plateforme : both**

Fichiers : `constants/locale.ts:7` ; `features/user-profile/components/ReviewItem.tsx:66` ; `services/chatService.ts:839,840,947,1051,1056,1061,1064,1151,1152,1156`.

Description : 6 sites passent `'fr-CA'` littéral à `toLocaleDateString`/`toLocaleTimeString` au lieu d'`APP_LOCALE` (documenté comme single source of truth). **Renforcement** : les messages système meetup de `chatService.ts` sont SYSTÉMATIQUEMENT dé-accentués, pas seulement le « a » de « à » : « propose » (`:1061`), « confirme » (`:1156`), « a une date a convenir » (`:840,1152`). Corriger seulement « a »→« à » laisserait les autres incohérences. Aucun bug fonctionnel (`'fr-CA'` === `APP_LOCALE` tant qu'elle vaut `'fr-CA'`).

Impact : maintenabilité (6 sites à éditer si la locale change) + cohérence FR du copy (messages système visibles dans le chat par acheteur et vendeur).

Recommandation : remplacer chaque `'fr-CA'` littéral par `APP_LOCALE` ; ré-accentuer l'ENSEMBLE des messages système meetup (à, proposé, confirmé), pas seulement le « a ».

### P3-12 — Formatage de prix décimal réimplémenté inline dans 6 écrans
**Sévérité : P3 · Plateforme : both**

Fichiers : `app/wallet.tsx:88` (helper local `formatCents`) ; `app/(tabs)/profile.tsx:123` ; `app/checkout/shipping.tsx:560,573` ; `app/payment/[transactionId].tsx:289,302` ; `utils/formatPrice.ts:6,21`.

Description : `toFixed(2).replace('.', ',') + ' $'` dupliqué inline dans 6 emplacements (soldes/restes à payer) au lieu d'un helper partagé. **Renforcement** : divergence DÉJÀ présente — dans `payment/[transactionId].tsx`, la même variable `cardAmountDollars` est formatée via `formatPrice` (`:341`) ET inline (`:302`). **Correction de la reco** : `formatPrice` omet les décimales pour un entier (« 45 $ ») et `formatPriceWithCurrency` ajoute « $ CA » — aucune des deux ne reproduit le format wallet (« 45,00 $ », 2 décimales sans CA). Le fix correct est d'extraire une 3e fonction partagée (`formatCents`/`formatBalance`), pas un simple remplacement par `formatPrice`.

Impact : risque de divergence de format entre écrans financiers (montants en argent réel).

Recommandation : extraire un helper unique `formatCents(cents)` (toujours 2 décimales, sans CA) dans `utils/formatPrice.ts` et l'importer dans les 4 fichiers.

### P3-13 — Risque Hermes/Intl sur Android — aucun polyfill, formatage de dates dépendant de l'ICU
**Sévérité : P3 (rétrogradé de P1) · Plateforme : android**

Fichiers : `app.config.js:5` (`jsEngine: hermes`) ; `android/gradle.properties:42` (`hermesEnabled=true`) ; `constants/locale.ts:7` ; `app/wallet.tsx:100` ; `features/profile/components/ProfileHeader.tsx:56` ; `features/user-profile/components/ReviewItem.tsx:66` ; `lib/automatedDecisionMeta.ts:133` ; `app/(tabs)/messages.tsx:362-365`.

Description : Hermes unique, aucun polyfill Intl, ~33 sites `toLocale*` sur 20 fichiers (`month:'long'` répandu). **Correction du mécanisme (raison du downgrade P1→P3)** : sous RN 0.85.3, le Hermes bundlé embarque l'ICU/Intl COMPLET par défaut sur les DEUX plateformes (variante « with intl » depuis RN 0.71) — il ne délègue PAS à `android.icu` et ne dépend pas de la version d'OS Android. `toLocaleDateString('fr-CA',{month:'long'})` rend « mai » identiquement iOS/Android. Le scénario « vieux Android → May » était réel sous RN < 0.71, plus le mode de défaillance ici. Pas une divergence iOS≠Android. Risque résiduel légitime : aucune dép Intl explicite → la parité repose 100% sur le maintien de l'option ICU Hermes lors d'un upgrade ; aucun test de garde.

Impact : résiduel — un futur upgrade/optim désactivant l'ICU Hermes casserait les ~33 sites simultanément sans garde-fou.

Recommandation : NE PAS ajouter `@formatjs` (inutile sur RN 0.85). Centraliser le formatage de dates dans un helper unique testé ; ajouter un test de garde vérifiant que `toLocaleDateString('fr-CA',{month:'long'})` contient un mois FR ; remplacer les `'fr-CA'` hardcodés par `APP_LOCALE`.

### P3-14 — Cible web fantôme : config web + hooks .web/template non câblés, libs natives incompatibles web
**Sévérité : P3 · Plateforme : both**

Fichiers : `app.config.js:159` (bloc `web`) ; `hooks/useColorScheme.web.ts:7`, `useColorScheme.ts:1`, `useThemeColor.ts:13` (morts) ; `components/ui/IconSymbol.tsx`, `IconSymbol.ios.tsx`, `index.ts:72` (référence unique = barrel, jamais consommé) ; `package.json:43,46,50,67,82,88` (Stripe natif, maps, Apple/Google auth, react-native-web).

Description : résidus de template Expo (`useColorScheme`/`.web`, `useThemeColor`, `IconSymbol`, bloc web, `react-native-web`) suggèrent une cible web qui n'existe pas. Le runtime dépend de libs natives sans support web réel (`@stripe/stripe-react-native`, `expo-maps` + `react-native-maps`, `expo-apple-authentication`, `@react-native-google-signin`). Le « support web » est illusoire et non câblé. Pas de divergence iOS/Android (hygiène).

Impact : confusion sur la cible supportée ; risque qu'un contributeur croie le web viable.

Recommandation : décision explicite mobile-only → supprimer le bloc web `app.config.js:159` + les résidus de template (`useColorScheme`/.web, `useThemeColor`, `IconSymbol` non utilisés).

---

## Permissions & deep links — couverture iOS / Android

### Permissions

| Permission | Déclarée `app.config.js` ? | Embarquée native ? | Utilisée au runtime ? | Verdict |
|------------|---------------------------|--------------------|-----------------------|---------|
| CAMERA | ❌ (absente) | ✅ Android:4 / iOS:57-58 (autolink) | ✅ 3 écrans (`useCameraPermissions`) | **P1-2** : non maîtrisée, string iOS anglaise, régénérée au prebuild |
| RECORD_AUDIO | ✅ `:104` | ✅ Android:8 / iOS:67-68 | ❌ aucun audio/vidéo | **P1-3** : à retirer (risque Play Store) |
| NSMicrophoneUsageDescription | ❌ | ✅ iOS:67-68 (anglais) | ❌ | **P1-3** + **P2-13** |
| INTERNET | ❌ | ✅ Android:5 | ✅ (implicite) | **P1-5** : drift |
| READ/WRITE_EXTERNAL_STORAGE | ❌ | ✅ Android:7,11 (maxSdk 32) | ⚠️ image-picker | **P1-5** : drift |
| SYSTEM_ALERT_WINDOW | ❌ | ✅ Android:9 | ⚠️ overlay ? | **P1-5** : drift, usage à confirmer |
| ACCESS_*_LOCATION | ✅ `:101-107` | ✅ | ⚠️ maps | OK déclaré (strings iOS anglaises — P2-13) |
| POST_NOTIFICATIONS / VIBRATE | ✅ `:101-107` | ✅ | ✅ notifications | OK |
| NSCameraUsageDescription | ❌ (sauf défaut) | ✅ iOS:57-58 (anglais) | ✅ | **P2-13** : à localiser FR |
| photosPermission | ✅ `:43` (anglais) | ✅ iOS:71-72 | ✅ | **P2-13** : à localiser FR |
| Google Maps API key | ❌ | ❌ Android (manifest) | ✅ `PROVIDER_GOOGLE` | **P1-4** : cartes mortes Android |

### Deep links / Universal Links

| Path | iOS (AASA, 14) | Android (intentFilter, 8 prefix) | Émis backend ? | Écart |
|------|----------------|----------------------------------|----------------|-------|
| /article, /chat, /user, /shop, /swap-party, /swap, /notifications, /search | ✅ | ✅ | ✅ | OK (mais cassé par P0-2) |
| /search-results | ✅ | ✅ (préfixe `/search`) | — | OK (finding P1-7 corrigé) |
| /favorites, /messages, /profile | ✅ | ❌ | — (handlers app) | **P1-7** : Android manquant |
| /sell, /settings | ✅ | ❌ | — | **P1-7** : Android manquant |
| /my-orders | ✅ (domaine AASA) | ❌ | ✅ order_* | **P3-7** : Android manquant |
| host `www.seconde.app` | ✅ | ❌ | (sans www) | **P1-8** : Android manquant |
| `TEAM_ID` / SHA256 fingerprint | ❌ placeholder | ❌ placeholder | — | **P0-2** : tout cassé sur les 2 OS |
| /payment, /review | ❌ AASA | ❌ | ❌ jamais émis | Non concerné (finding initial erroné) |

---

## Matrice cross-plateforme (Zone | iOS | Android | Écart)

| Zone | iOS | Android | Écart |
|------|-----|---------|-------|
| Push notifications | ❌ cassé (token APNs brut → FCM) | ✅ token FCM valide | **P0-1** divergence majeure |
| Channels notif | n/a (pas de channels) | ⚠️ 2 channels orphelins (orders, saved_searches) | **P1-6** Android dégradé |
| Badge APNs | ⚠️ figé à 1 | ignore aps.badge | **P3-10** iOS trompeur |
| Universal/App Links | ❌ placeholder Team ID | ❌ placeholder SHA256 | **P0-2** les 2 cassés ; **P1-7/P1-8** divergence paths/host |
| Parcours Vendre | overlay Skia + timeout 550 → /sell/photos-review | nav par défaut → /sell/capture | **P1-1** écrans/chemins/timing différents |
| Cartes (shop) | ✅ fallback Apple Maps | ❌ tuiles grises (pas de clé) | **P1-4** Android cassé |
| Permissions caméra/micro | strings anglaises autolink | drift CAMERA/RECORD_AUDIO | **P1-2/P1-3/P1-5** |
| Splash | sombre → frame crème (flash) | sombre → frame crème (flash) + crop cercle 12+ | **P2-1/P2-9** identique (flash) + crop Android |
| StatusBar canvas sombre | dark global illisible | dark + pas de backgroundColor | **P2-2** |
| Réseau `isInternetReachable` | == isConnected (jamais false si connecté) | exige VALIDATED (captive portal → false) | **P1-9** bandeau incohérent |
| Apple Sign-In | gardé (UI) | crash potentiel si chemin non-UI | **P3-3** asymétrie défensive |
| Ré-auth Apple sur Android | n/a | recover via add-password (sauf requires-recent-login) | **P3-4** cas edge étroit |
| Intl/dates | ICU Hermes complet | ICU Hermes complet (RN 0.85) | **P3-13** pas de divergence réelle, risque latent upgrade |
| Offline (RQ/Firestore) | non câblé | non câblé | **P2-14** identique, dégradation UX |
| Devise swap | `$X` US | `$X` US | **P2-16** identique (3 sites) |
| Cible web | non câblée (libs natives) | non câblée | **P3-14** illusoire, identique |

---

## Plan d'action priorisé (P0 → P3)

### P0 — bloquant, avant tout déploiement
1. **P0-1** Réparer le push iOS : intégrer `@react-native-firebase/messaging` (ou Expo Push tokens) ; tester sur iPhone physique. Étendre le cleanup de tokens à `messaging/invalid-argument`. *(firebase-backend + rn-expo-dev)*
2. **P0-2** Substituer `TEAM_ID` (Apple Team ID réel) et `YOUR_SHA256_FINGERPRINT_HERE` (`eas credentials`) dans les fichiers `.well-known`, redéployer hosting, valider AASA + `adb shell pm verify-app-links`. **Prérequis aux P1-7/P1-8/P3-7.** *(firebase-backend)*

### P1 — écarts iOS↔Android, avant prochaine release
3. **P1-4** Déclarer la clé Google Maps (config plugin `react-native-maps`) + prebuild (cartes Android mortes).
4. **P1-2/P1-3** Ajouter le plugin `expo-camera` (cameraPermission FR, `recordAudioAndroid: false`) ; retirer `RECORD_AUDIO` d'`app.config.js:104`.
5. **P1-5** Trancher le modèle natif (gitignore android/ios + tout dans `app.config.js`, OU natifs assumés) ; documenter.
6. **P1-6** Enregistrer/rediriger les channels `orders` + `saved_searches`.
7. **P1-7/P1-8** Aligner les intentFilters Android (paths `/favorites,/messages,/profile,/sell,/settings` + host `www.seconde.app`) sur iOS *(après P0-2)*.
8. **P1-1** Décider ADR vs unification du point d'entrée Vendre ; remplacer `setTimeout(550)` par callback de fin d'animation.
9. **P1-9** Aligner `OfflineBanner` sur `isConnected` + corriger JSDoc ; `isError` + état réseau + Réessayer sur `checkout` et `payment` (écran blanc) ; bouton refetch sur `article`.

### P2 — qualité/dette, sprint suivant
10. **P2-5** Migrer les 10 consommateurs `withSpring` → `withTiming` + ease-out, puis retirer le token `spring` (+ `scale.bounce` dead code immédiat).
11. **P2-6** `Promise.race` timeout 3-4 s autour de `prefetchHome`.
12. **P2-8** `urlScheme="seconde"` au StripeProvider + externaliser la clé Stripe en `EXPO_PUBLIC_*`.
13. **P2-13** Localiser FR toutes les purpose strings iOS dans `app.config.js`.
14. **P2-1/P2-9** Aligner `splash.backgroundColor` sur `#FAF8F4` + asset splash dédié (plugin `expo-splash-screen`).
15. **P2-7** `initialMetrics={initialWindowMetrics}` au SafeAreaProvider.
16. **P2-2** `<StatusBar style="light" />` sur les écrans canvas sombre.
17. **P2-14/P2-15** Câbler `onlineManager` + garde `isSending` chat ; error boundaries de segment + QueryCache onError (après reporter).
18. **P2-3/P2-10/P2-12/P2-16/P2-17/P2-18** Nettoyages : code mort dark-mode, `useFonts.ts`, `expo-maps`, `formatPrice` swap (3 sites), trancher `formatPriceWithCurrency`, supprimer commentaire Helcim.
19. **P2-4** Remplacer les couleurs hors palette par les tokens DS.

### P3 — robustesse/cohérence, opportuniste
20. **P3-3** Garde `Platform.OS` sur `signInWithApple()`.
21. **P3-4** Gérer `auth/requires-recent-login` dans `add-password.tsx`.
22. **P3-5/P3-6/P3-7** Readiness-based deep-link trigger ; case `swap_proposed` (+ type/buildDeepLink) ; pathPrefix `/my-orders` Android.
23. **P3-10** Badge APNs = vrai unread (ou piloté app).
24. **P3-11/P3-12** Remplacer `'fr-CA'` hardcodés par `APP_LOCALE` + ré-accentuer messages meetup ; helper `formatCents` partagé.
25. **P3-13** Helper dates centralisé + test de garde ICU (PAS `@formatjs`).
26. **P3-2/P3-14** Retirer SpaceMono ; décision mobile-only + suppression résidus web.
27. **P3-1/P3-9** Migrer `useImmersiveOverlay` vers store ; NE PAS toucher la complémentarité plugin/`useFonts` (documenter seulement).

---

## Annexe — faux positifs écartés

### FP-1 — « Le handler de deep link custom utilise `new URL()` sans polyfill → crash sous Hermes »
**Verdict : FAUX POSITIF.**

La prémisse technique centrale (« `new URL()` crashe / `searchParams` non fiable sous Hermes sans polyfill ») est fausse pour React Native. Bien que `useDeepLinking.ts:75` appelle `new URL(...)` et lise `url.searchParams?.get(...)` (`:39-40`), que `app.config.js:5` confirme Hermes, et que `package.json` ne contienne aucun `react-native-url-polyfill`, React Native enregistre **son propre polyfill JS** comme global : `setUpXHR.js:35-36` → `polyfillGlobal('URL', () => require('../Blob/URL').URL)`, chargé par `InitializeCore` via `expo-router/entry` (`package.json:3`) AVANT tout code app. L'`URL` natif de Hermes n'est jamais consulté. L'implémentation RN 0.85.3 gère le cas exact (`URL.js:172-199` regex robuste, `searchParams` jamais null), et le code se protège déjà avec `|| ''` / `|| '{}'`. L'impact décrit n'est pas reproductible ; le polyfill est du JS pur identique sur les deux plateformes. La reco d'utiliser `Linking.parse(url).queryParams` reste une amélioration cosmétique (P3 au plus), pas un correctif de bug.
