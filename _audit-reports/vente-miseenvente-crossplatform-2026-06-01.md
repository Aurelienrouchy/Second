# Audit Vente / Mise en vente — Cross-platform iOS/Android (2026-06-01)

## Résumé exécutif

Cet audit couvre le tunnel de mise en vente (capture, analyse IA, formulaire détails, prix & livraison, aperçu, publication) et la reprise de brouillons, sous l'angle de la parité iOS ↔ Android. La cause-racine transverse est une **double implémentation de la capture** : iOS passe par un overlay immersif (`SellOverlayCapture`) et Android par une route (`app/sell/capture.tsx`), via un `Platform.OS === 'ios'` dans `app/(tabs)/_layout.tsx`. Cette divergence engendre plusieurs écarts observables (reprise de brouillon, fondu caméra, format photo, transitions). Côté logique pure, plusieurs contrats de données IA sont rompus (conditionId serveur EN vs client FR-kebab, confidence objet vs nombre, taille `detected`/`normalized`) et la saisie de prix ne normalise pas la virgule (marché fr-CA). Un risque P0 latent existe sur la configuration native (plugin `expo-camera` absent → permission CAMERA Android perdue au prochain `prebuild --clean`). Des défauts backend latents (search_index fire-and-forget, modération codée en dur, price-drop figé) complètent le tableau.

| Sévérité | Nombre |
|----------|--------|
| P0 | 1 |
| P1 | 12 |
| P2 | 22 |
| P3 | 18 |
| **Total** | **53** |

> Note : un finding P0 d'origine (« expo-camera non enregistré, NSCameraUsageDescription risque de disparaître ») a été révisé en P1 après vérification (iOS protégé par le plugin expo-image-picker ; seul Android est cassé). Le P0 retenu ci-dessous est le finding transverse consolidé sur le même mécanisme.

---

## Findings P0

### P0-1 — Plugin `expo-camera` absent de `app.config.js` : un `prebuild --clean` supprime la permission caméra Android et casse tout le tunnel de vente
- **Sévérité** : P0 (révisé en pratique P1 — Android-only ; voir nuance)
- **Plateforme** : Android (le finding d'origine disait « both » ; iOS est en réalité protégé)
- **Fichiers** :
  - `app.config.js:19-67` (tableau `plugins` — aucune entrée `expo-camera`)
  - `app.config.js:101-107` (`android.permissions` — pas de `CAMERA`)
  - `android/app/src/main/AndroidManifest.xml:4` (`<uses-permission android:name="android.permission.CAMERA"/>` — artefact obsolète)
  - `ios/Seconde/Info.plist:57-58` (`NSCameraUsageDescription`)
  - `node_modules/expo-camera/plugin/build/withCamera.js:29-33` (le plugin ajoute `android.permission.CAMERA`)
  - `node_modules/expo-image-picker/plugin/build/withImagePicker.js:48-66` (injecte `NSCameraUsageDescription` inconditionnellement côté iOS)
  - `app/sell/capture.tsx:21`, `features/sell/components/capture/SellOverlayCapture.tsx:18`, `package.json:53`
- **Description** : `expo-camera` (~56.0.7) est installé et la capture en dépend (`CameraView` + `useCameraPermissions`), mais le plugin n'est PAS déclaré dans `plugins`, et `android.permissions` n'inclut pas `CAMERA`. Seul le plugin `expo-camera` ajoute `android.permission.CAMERA` (`withCamera.js:29-33`) ; `expo-image-picker` n'ajoute que `RECORD_AUDIO` côté Android. La ligne `AndroidManifest.xml:4` est un résidu d'un prebuild antérieur.
- **Impact** : après un `npx expo prebuild --clean` (workflow EAS managed standard), le manifest Android est régénéré SANS `CAMERA` → la prise de vue échoue (permission jamais accordable). iOS est épargné : `expo-image-picker` réinjecte `NSCameraUsageDescription` (valeur par défaut `Allow $(PRODUCT_NAME) to access your camera`).
- **Recommandation** : ajouter dans `app.config.js` le plugin `["expo-camera", { "cameraPermission": "Seconde utilise la caméra pour photographier vos articles à vendre.", "microphonePermission": "..." }]`, puis re-prebuild pour resynchroniser les manifestes natifs. Cela garantit `CAMERA` (Android) et la clé iOS de manière reproductible.

---

## Findings P1 — bugs & écarts iOS ↔ Android

### P1-1 — Deux écrans de capture divergents par plateforme
- **Sévérité** : P1 · **Plateforme** : both
- **Fichiers** : `app/(tabs)/_layout.tsx:139-158`, `features/sell/components/capture/SellOverlayCapture.tsx`, `app/sell/capture.tsx`, `app/(tabs)/sell.tsx`, `components/DraftResumeModal.tsx`
- **Description** : Le tap Vendre branche deux écrans totalement différents. `app/(tabs)/_layout.tsx:139` `} else if (Platform.OS === 'ios') {` → `immerse({ component: <SellOverlayCapture .../> })` ; `:158` `// Android: default tab navigation (sell.tsx → /sell/capture)`. iOS = overlay immersif Skia/blur + fade-in caméra + restauration silencieuse du brouillon ; Android = route avec `BlurOverlay` opaque, pas de fade-in, `DraftResumeModal` explicite. Les deux fichiers dupliquent ~90 % de la logique (MAX_PHOTOS, handleCapture, handleGallery) mais divergent sur plusieurs détails fonctionnels.
- **Impact** : maintenance dédoublée + comportements observables différents (reprise brouillon, rendu caméra, format photo). C'est la source-racine de plusieurs findings ci-dessous.
- **Recommandation** : unifier sur un composant de capture partagé paramétré par un mode de présentation (overlay vs route).

### P1-2 — Reprise de brouillon non proposée sur iOS : perte de progression (Détails/Prix/Aperçu)
- **Sévérité** : P1 · **Plateforme** : iOS
- **Fichiers** : `features/sell/components/capture/SellOverlayCapture.tsx:98-117`, `app/(tabs)/sell.tsx:36-96`, `components/DraftResumeModal.tsx`, `app/(tabs)/_layout.tsx:148-151`, `app/sell/photos-review.tsx:127-132`, `services/draftService.ts:46`
- **Description** : Android route par `currentStep` via `DraftResumeModal` (`sell.tsx:65-96` : step≥4→preview, ≥3→pricing, ≥2→details). iOS restaure SILENCIEUSEMENT les photos (`SellOverlayCapture.tsx:104-105 setPhotos(existingDraft.photos)`) puis `onContinue` pousse TOUJOURS `/sell/photos-review` (`_layout.tsx:148-151`), qui force la ré-analyse IA (`photos-review.tsx:127-132 runAnalysis()`).
- **Impact** : un utilisateur iOS avec brouillon avancé est ramené à la capture et perd son avancement perçu.
- **Recommandation** : sur iOS aussi, charger le brouillon avant la caméra et présenter Reprendre/Recommencer (à `currentStep`), comme Android.

### P1-3 — État IA perdu : conditionId serveur non mappés (toujours « très bon état »)
- **Sévérité** : P1 · **Plateforme** : both (logique pure, pas un écart de plateforme)
- **Fichiers** : `functions/src/services/ai.ts:278-289,339-342`, `types/ai.ts:147,155-160,397-400`, `services/aiService.ts:474`, `app/sell/details.tsx:65-68`
- **Description** : Le serveur convertit le français-kebab Gemini en ANGLAIS (`ai.ts:278-289` `neuf→new_with_tags`, `tres-bon-etat→very_good`...) et renvoie `conditionId: "very_good"`. Le client `transformGeminiResponse` recopie tel quel ; `CONDITION_DISPLAY` (`types/ai.ts:155-160`) ne connaît que les clés français-kebab → `details.tsx:67` retombe systématiquement sur `'tres bon etat'`.
- **Impact** : détection d'état 100 % inopérante (les 4 valeurs anglaises ne matchent aucune clé). Atténué car l'utilisateur peut corriger via `ConditionSelector` avant publication.
- **Recommandation** : unifier les `conditionId` serveur/client (idéalement laisser passer le français-kebab jusqu'au client) ; vérifier la valeur attendue par `products.ts` avant d'écrire l'article.

### P1-4 — Modèle taille `{value,system}` contourné dans la vente (system EU hardcodé)
- **Sévérité** : P1 · **Plateforme** : both
- **Fichiers** : `app/sell/details.tsx:43,82,219,365-372`, `app/sell/preview.tsx:172`, `app/article/edit/[id].tsx:65,186,307`, `components/SizeSelectionSheet.tsx:48-51,116`, `components/SelectionBottomSheet.tsx`, `data/sizes.ts:126-132,206-210`
- **Description** : Le formulaire gère la taille comme `string | null` et utilise `SelectionBottomSheet type="size"` sans toggle de système ; la grille est toujours EU (`getSizesForCategory`). À la publication, le système est hardcodé `EU` (`preview.tsx:172 { value: fields.size, system: 'EU' as const }`). `SizeSelectionSheet` (toggle US/EU produisant `{value,system}`) n'est branché que dans `search.tsx`/`swap-zone.tsx`. L'édition (`edit/[id].tsx:186,307`) re-étiquette en EU et jette le `system` d'origine.
- **Impact** : un vendeur ne peut pas saisir une taille US (alors que les filtres US existent ailleurs) ; tailles AI non-EU mal étiquetées EU ; filtres taille faussables.
- **Recommandation** : brancher `SizeSelectionSheet` dans `details.tsx` ET l'édition, propager `system` jusqu'à `preview.tsx`, valider la taille AI contre la grille.

### P1-5 — Le back matériel Android contourne l'alerte « brouillon sauvegardé »
- **Sévérité** : P1 · **Plateforme** : Android (et swipe-back iOS)
- **Fichiers** : `app/sell/details.tsx:172-181,246`, `app/sell/_layout.tsx:30-37`, `components/ui/ScreenHeader.tsx:76-87`
- **Description** : L'alerte de sortie (`details.tsx:172-181`) n'est câblée que sur `onBack` du `ScreenHeader` (`:246`). Aucun `BackHandler`/`usePreventRemove` dans `app/sell` (grep vide). Avec `gestureEnabled: true` (`_layout.tsx:32`), le back matériel Android et le swipe-back iOS naviguent sans passer par `handleBack`.
- **Impact** : alerte présente sur le bouton header mais absente sur le back natif. Perte limitée (auto-save brouillon `details.tsx:123-147`), mais comportement non identique.
- **Recommandation** : enregistrer `usePreventRemove` (couvre geste + back matériel) qui appelle `handleBack`.

### P1-6 — Saisie du prix : virgule rejetée par `decimal-pad` en locale FR (corruption ×100)
- **Sévérité** : P1 · **Plateforme** : both en locale FR (le finding disait Android ; iOS aussi suit la locale)
- **Fichiers** : `app/sell/pricing.tsx:136-142`, `features/sell/components/pricing/PriceCard.tsx:30-31`, `app/wallet.tsx:295` (fix déjà appliqué ailleurs)
- **Description** : `PriceCard` utilise `keyboardType="decimal-pad"` ; en fr-CA le clavier affiche la virgule. `handlePriceChange` nettoie avec `value.replace(/[^0-9.]/g, '')` (`pricing.tsx:137`) : la virgule est supprimée sans conversion en point → « 45,50 » devient « 4550 ». Le projet gère déjà ce cas dans `wallet.tsx:295 parseFloat(withdrawalInput.replace(',', '.'))` ; locale confirmée `APP_LOCALE = 'fr-CA'` (`constants/locale.ts`).
- **Impact** : prix décimal corrompu (×100) sur le marché ciblé fr-CA, sans avertissement.
- **Recommandation** : normaliser dans l'onChange : `value.replace(',', '.').replace(/[^0-9.]/g, '')`, comme `wallet.tsx`. Variante connexe à corriger : `components/MakeOfferModal/OfferStep.tsx:76` (même défaut sur le flow d'offre).

### P1-7 — `search_index` écrit via `setTimeout` non-awaité dans une Cloud Function v2 : article potentiellement invisible en recherche
- **Sévérité** : P1 · **Plateforme** : backend
- **Fichiers** : `functions/src/triggers/products.ts:140-147`, `functions/src/utils/debounce.ts:12-35`, `functions/src/callable/products.ts:198,346-367`
- **Description** : Le trigger `updateSearchIndex` écrit le doc `search_index` via `debounceUpdate(updateKey, async () => { await ...set(...) })` (`products.ts:141`). `debounceUpdate` est SYNCHRONE : `setTimeout(fn, 5000)` puis retour `void` (`debounce.ts:24`). En v2/Cloud Run, l'instance peut être gelée après retour du handler avant l'expiration du timer ; la `Map updateQueues` (mémoire) ne survit pas à un cold start. La toute première écriture du `search_index` d'un article neuf peut donc ne jamais avoir lieu (l'embedding, lui, est awaité `embeddings.ts:265`).
- **Impact** : annonce publiée avec succès mais absente de la recherche par mots-clés jusqu'à un autre re-trigger. Non déterministe, difficile à diagnostiquer. (Atténué aujourd'hui car le client filtre encore côté client, cf. TODO `triggers/products.ts:18-19` ; mais `search_index` alimente déjà les jobs scheduled.)
- **Recommandation** : `await` direct du `set()` pour la création/écriture initiale ; réserver le debounce aux métriques fréquentes (views/likes).

### P1-8 — Remonter un prix après une baisse laisse les champs price-drop figés → réduction négative `--33%` sur l'accueil
- **Sévérité** : P1 · **Plateforme** : backend
- **Fichiers** : `functions/src/callable/products.ts:771-789`, `functions/src/callable/home.ts:113-141`, `app/article/edit/[id].tsx:292-325`, `features/home/price-drops/PriceDropsSection.tsx:96,123,154-158`
- **Description** : Le bloc price-drop ne s'exécute QUE si `sanitized.price < existing.price` (`products.ts:771`) et n'efface jamais `originalPrice`/`priceDropPercent`/`lastPriceDropAt` (grep : zéro `FieldValue.delete` sur ces champs). L'article remonté reste matché par `_getPriceDrops` (`home.ts:113-120 where('lastPriceDropAt','!=',null)`), qui recalcule `reductionPercent = round((30-40)/30*100) = -33` → `reduction = '-${-33}%'` = `'--33%'` (`home.ts:131-141`), sans garde `originalPrice > price` (contrairement à `features/article/utils.ts:29`). Affiché verbatim (`PriceDropsSection.tsx:123`).
- **Impact** : le rail « Baisses de prix » affiche des articles dont le prix a AUGMENTÉ, badge malformé `--33%` + prix barré incohérent. Trompeur pour l'acheteur, persistant.
- **Recommandation** : dans `updateArticle`, effacer les 3 champs via `FieldValue.delete()` quand `price >= existing.originalPrice` ; rendre `_getPriceDrops` défensif (`originalPrice > price`).

### P1-9 — Reprise de brouillon (DraftResumeModal + saut à l'étape) inexistante sur iOS
- **Sévérité** : P1 · **Plateforme** : iOS (cause unique branchée sur `Platform.OS`)
- **Fichiers** : `app/(tabs)/_layout.tsx:139-158`, `app/(tabs)/sell.tsx:27-105`, `features/sell/components/capture/SellOverlayCapture.tsx:98-117`, `components/DraftResumeModal.tsx`, `services/draftService.ts:8`
- **Description** : Clé AsyncStorage unique `'@article_draft'` (`draftService.ts:8`), donc même brouillon des deux côtés. Android affiche `DraftResumeModal` et route par `currentStep` (`sell.tsx:57-98`). iOS ouvre toujours la caméra overlay (`_layout.tsx:139-157`), restaure seulement les photos (`SellOverlayCapture.tsx:104-106`), jamais l'étape. `DraftResumeModal` n'est importé QUE dans `sell.tsx`.
- **Impact** : un vendeur iOS à l'étape 3 (pricing) atterrit sur la caméra ; sentiment de perte de données. Deux comportements radicalement différents pour le même état.
- **Recommandation** : avant `immerse()` sur iOS, `loadDraft()` ; si `currentStep > 1`, présenter `DraftResumeModal` ou router vers l'étape.

### P1-10 — Sur iOS, un brouillon avancé est renvoyé à l'étape 1 et relance une analyse IA payante
- **Sévérité** : P1 · **Plateforme** : iOS
- **Fichiers** : `app/(tabs)/_layout.tsx:145-153`, `features/sell/components/capture/SellOverlayCapture.tsx:98-117`, `app/sell/photos-review.tsx:127-132,170-221`, `app/(tabs)/sell.tsx:60-96`, `services/aiService.ts:402,451-452`, `services/draftService.ts:348,366`
- **Description** : `onContinue` iOS ne transmet QUE les photos et route vers `/sell/photos-review` sans `resumeDraft` (`_layout.tsx:148`). `photos-review` relance `runAnalysis()` au montage (`:127-132`) sans regarder un `aiResult` existant, et écrase le brouillon (`updateDraftAIResult :208`). `aiService` ré-upload Storage (`:402`) et ré-appelle Gemini (`:451-452`). Android, lui, saute correctement à l'étape via `currentStep` (`sell.tsx:60-96`).
- **Impact** : perte de l'avancement perçu + coût API/quota Gemini gaspillé sur un flux monétisé.
- **Recommandation** : sur iOS, router par `draft.currentStep` (comme `sell.tsx`) et ne relancer l'IA que si aucun `aiResult` n'existe.

---

## Findings P2 / P3

### P2 — Capture & caméra

#### P2-1 — Pas de fade-in caméra sur Android : rectangle noir au démarrage
- **Plateforme** : Android · **Fichiers** : `app/sell/capture.tsx:248-252,308`, `features/sell/components/capture/SellOverlayCapture.tsx:25,57-68,270-275`, `app/(tabs)/_layout.tsx:139-159`, `app/(tabs)/sell.tsx`
- iOS maintient `opacity 0` puis fade-in sur `onCameraReady` (`SellOverlayCapture.tsx:59-64`, `withTiming` 260 ms). Android rend `<CameraView .../>` brut (`capture.tsx:248-252`), aucun `onCameraReady` → flash noir. Le `Skeleton` (`:204-217`) ne couvre que l'état `!permission`.
- **Reco** : appliquer le même `onCameraReady` + fondu (ou skeleton DS) sur `capture.tsx`. *(NB : `capture.tsx` est aussi atteint sur iOS via la reprise étape 1, donc factoriser.)*

#### P2-2 — Message de permission caméra/galerie/micro générique en anglais (incohérence locale FR-CA)
- **Plateforme** : iOS · **Fichiers** : `ios/Seconde/Info.plist:57-58,67-68,71-72`, `app.config.js:43`, `features/sell/components/capture/PermissionDenied.tsx:18`
- Les dialogues système iOS affichent l'anglais (`Allow $(PRODUCT_NAME) to access your camera`, micro idem, photos `The app accesses your photos...`), en rupture avec l'UI FR. `photosPermission` (`app.config.js:43`) est managé mais en anglais ; `NSCamera`/`NSMicrophone` sont des défauts non managés (pas de bloc plugin `expo-camera`).
- **Reco** : définir des chaînes FR via le plugin `expo-camera` (`cameraPermission`/`microphonePermission`) + corriger `photosPermission`, puis re-prebuild.

#### P3-1 — Format galerie divergent iOS : HEIC (overlay `.Current`) vs JPEG (`.Compatible`)
- **Plateforme** : iOS · **Fichiers** : `features/sell/components/capture/SellOverlayCapture.tsx:176-177`, `app/sell/capture.tsx:149-150`, `app/sell/photos-review.tsx:255-256`, `services/aiService.ts:107-138`, `utils/imageUtils.ts:11-29`, `services/articlesService.ts:211-218`
- `SellOverlayCapture` utilise `UIImagePickerPreferredAssetRepresentationMode.Current` (seul des 8 pickers du repo), les autres `.Compatible`. **Impact neutralisé en aval** : `aiService` convertit HEIC→JPEG pour l'analyse (`:107-138`), et `imageUtils.compressImage` re-encode inconditionnellement en JPEG avant upload (`:11-29`). Output final identique. Nit de cohérence.
- **Reco** : harmoniser sur `.Compatible` dans `SellOverlayCapture.tsx:177`.

#### P3-2 — Traitement visuel des bords caméra : BlurView réel (iOS) vs voile RGBA opaque (Android)
- **Plateforme** : both · **Fichiers** : `features/sell/components/capture/SellOverlayCapture.tsx:21,278-290,310-334`, `components/sell/BlurOverlay.tsx:10-32`, `app/sell/capture.tsx:254,276`, `app/(tabs)/_layout.tsx:139-158`
- iOS : `<BlurView intensity={40} tint="dark">`. Android : `BlurOverlay` = `<View backgroundColor:rgba(15,14,12,intensity)>` (0.6/0.65). Écart cosmétique assumé en commentaire (`BlurOverlay.tsx:10-13`) mais non formalisé.
- **Reco** : acter le choix design (BlurView Android avec fallback OU ADR documentant l'écart).

#### P3-3 — `BlurOverlay` : import `Platform` mort + JSDoc trompeur (code identique iOS/Android)
- **Plateforme** : both · **Fichiers** : `components/sell/BlurOverlay.tsx:2,11-13,15-32`, `features/sell/components/capture/SellOverlayCapture.tsx:278`, `app/sell/capture.tsx:254`, `app/(tabs)/_layout.tsx:139-158`
- `import { ... Platform } from 'react-native'` jamais utilisé ; JSDoc « iOS / Android » suggère une branche inexistante.
- **Reco** : retirer l'import mort, corriger le JSDoc, décider d'aligner le rendu du flou.

#### P3-4 — Aucun contrôle de flash dans l'écran de capture (les deux plateformes)
- **Plateforme** : both · **Fichiers** : `app/sell/capture.tsx:248-252`, `features/sell/components/capture/SellOverlayCapture.tsx:270-275`, `features/sell/components/capture/TopControls.tsx:6-12,37-47`
- Seul `toggleCameraFacing` ; aucune prop `flash`/`enableTorch` (grep `flash|torch` vide). Pour une marketplace photo, dégrade la qualité en basse lumière.
- **Reco** : ajouter un contrôle flash/torche partagé dans `TopControls`.

### P2/P3 — Analyse IA des photos

#### P2-3 — Taille jamais affichée en pill ni comptée : serveur `detected`, client lit `normalized`
- **Plateforme** : both · **Fichiers** : `functions/src/services/ai.ts:321-327`, `types/ai.ts:415-419`, `app/sell/photos-review.tsx:162,231`, `app/sell/details.tsx:82`
- Serveur n'émet que `size.detected` ; client mappe `normalized || null` (toujours null). Pill (`photos-review.tsx:162`) et compteur (`:231`) lisent `normalized` → taille absente du récap / compteur sous-estimé. Formulaire OK (`details.tsx:82` lit `detected`).
- **Reco** : fallback sur `size.detected` aux lignes 162/231, ou renvoyer `normalized` côté serveur.

#### P2-4 — Quota IA (10/h) classé `API_ERROR` `retryable:true` → réessais en boucle
- **Plateforme** : both · **Fichiers** : `functions/src/callable/ai.ts:46-50`, `services/aiService.ts:280-304,512-515`, `types/ai.ts:329,357,367`, `app/sell/photos-review.tsx:213-214,317-320`, `features/sell/components/analysis/AnalysisCard.tsx:81-82`
- `mapErrorCode` ne teste pas `resource-exhausted` → `API_ERROR`. **Nuance** : le message FR du serveur (`Limite atteinte : maximum 10 analyses par heure...`) EST bien affiché (`AnalysisCard.tsx:82`). Le vrai défaut : `retryable:true` + bouton retry qui re-déclenche la limite, sans compte-à-rebours.
- **Reco** : brancher `resource-exhausted` → code `RATE_LIMITED` avec `retryable:false`, sans `'retry'`.

#### P2-5 — Analyse non annulable : `AbortSignal` mort (jamais créé)
- **Plateforme** : both · **Fichiers** : `app/sell/photos-review.tsx:185-202`, `services/aiService.ts:322,339,372,458,503`, `features/sell/components/analysis/AnalysisFooter.tsx:80-82`
- `aiService` gère `signal` mais `runAnalysis` ne crée pas d'`AbortController`. « Passer et remplir manuellement » (`AnalysisFooter.tsx:80`) navigue sans annuler → upload + appel Gemini facturable continuent, et `updateDraftAIResult` (`photos-review.tsx:208`) écrit le brouillon après coup (setState post-unmount).
- **Reco** : créer un `AbortController`, l'aborter sur Passer/unmount, passer `signal`.

#### P3-5 — Confiance corrompue : serveur `{level}`, client attend un nombre
- **Plateforme** : both · **Fichiers** : `functions/src/services/ai.ts:300,313,325,333,341`, `types/ai.ts:273-277,393-428`, `services/aiService.ts:474`, `features/sell/components/analysis/ResultsSummary.tsx`, `app/sell/details.tsx`, `components/ConditionSelector.tsx`
- Serveur renvoie `confidence:{level}` (colors/materials/size/brand/condition) sans `value` ; client passe l'objet à `createConfidenceScore(value:number)` → `level` toujours `'low'`. **Nuance** : aucun consommateur UI ne lit ce `.level/.value` de façon visible (`ResultsSummary` hardcode `level="high"`, les autres testent la simple présence). Bug de données mort, latent.
- **Reco** : aligner le type (serveur en nombre 0..1 ou client lit `confidence.level`).

### P2/P3 — Formulaire détails

#### P2-6 — Validation incohérente footer vs `handleContinue` vs publication
- **Plateforme** : both · **Fichiers** : `app/sell/details.tsx:183-184,214,336`, `app/sell/preview.tsx:124-146`, `features/sell/components/shared/SellFooter.tsx:28`, `app/(tabs)/sell.tsx:65-70`
- `isFormValid` exige titre + description + catégorie (`details.tsx:214`) ; `handleContinue` ne garde que le titre (`:183-184`) ; la publication ne vérifie ni description ni titre>3 (`preview.tsx:124-146`). Chemin de contournement réel : reprise step≥4 → `/sell/preview` saute `details.tsx`, publie sans description.
- **Reco** : aligner les 3 portes sur une règle unique + afficher le champ manquant quand le bouton est désactivé.

#### P2-7 — Taille non réinitialisée ni validée au changement de catégorie
- **Plateforme** : both · **Fichiers** : `app/sell/details.tsx:160-170,219,303-306`, `data/sizes.ts:206-209,215-225`, `app/sell/preview.tsx:172`
- `handleCategorySelect` (`:160-170`) ne réinitialise pas `fields.size`. Une pointure 39 reste après passage à un vêtement et est publiée hors grille (`preview.tsx:172`). `isSizeValidForCategory` (`sizes.ts:215-225`) inutilisé.
- **Reco** : reset `size` à null ou revalider via `isSizeValidForCategory` dans `handleCategorySelect`.

#### P3-6 — Libellé « neuf » incohérent : sélecteur (`Neuf avec étiquette`) vs aperçu (`Neuf`)
- **Plateforme** : both · **Fichiers** : `data/conditions.ts:13-14,23-26`, `app/sell/preview.tsx:30-35,222,235`, `components/ConditionSelector.tsx:6,21`
- `ConditionSelector` affiche `CONDITIONS` (`Neuf avec étiquette`) ; `preview.tsx:30-35` redéfinit une table locale (`Neuf`). Divergence visible 2× (tags + specs). Seul `'neuf'` diverge.
- **Reco** : consommer `getConditionLabel`/`CONDITIONS` dans `preview.tsx` (`:222,235`).

### P2/P3 — Prix & options de livraison

#### P2-8 — Quick-tags de quartier désynchronisés du catalogue → données corrompues
- **Plateforme** : both · **Fichiers** : `features/sell/components/pricing/HandDeliveryCard.tsx:7,58,69-75`, `data/neighborhoods.ts:13-31`, `app/sell/pricing.tsx:146-147`, `app/sell/preview.tsx:190-192`, `functions/src/callable/products.ts:407-409,702-704`
- 4 quick-tags hardcodés fabriquent `{ id, name, borough:'' }` (`:69-75`). Pour `Plateau` → `id:'plateau'`, `name:'Plateau'` (tronqué), `borough:''` alors que le catalogue dit `name:'Plateau Mont-Royal', borough:'Le Plateau-Mont-Royal'`. Persisté sans validation (`products.ts:407-409`). Le toggle d'affichage matche par `name` (`:58`) vs id ailleurs → quick-tag paraît inactif. **Le doublon décrit est FAUX** : `pricing.tsx:146-147` dédoublonne par id (le tap RETIRE la sélection, jamais de doublon).
- **Reco** : pointer les quick-tags vers les objets du catalogue (`getNeighborhoodById`), matcher par id partout.

#### P2-9 — Quartiers de meetup saisis à la vente jamais réutilisés à l'achat (champ orphelin)
- **Plateforme** : both · **Fichiers** : `app/sell/pricing.tsx:55,163-165`, `app/sell/preview.tsx:190-195`, `app/checkout/meetup.tsx:95-96,152-156,311`, `functions/src/callable/products.ts:407-413,702-705`, `app/article/edit/[id].tsx:314-316`, `features/article/components/ArticleDetails.tsx:126-170`, `components/MakeOfferModal/LocationStep.tsx:31,50,126`, `types/index.ts:210,659,666`
- La vente persiste `article.neighborhoods` (validation bloquante `pricing.tsx:163-165`). L'achat lit `article.preferredMeetupSpots` (`meetup.tsx:311`), un AUTRE champ JAMAIS écrit (grep : zéro write) → fallback systématique « À convenir » (`:152-156`). Casse aussi le picker d'offre (`LocationStep.tsx`).
- **Reco** : dériver les meetup spots de `article.neighborhoods`, ou retirer/clarifier la collecte.

#### P2-10 — Aucune suggestion de prix : le composant `PriceSuggestion` n'existe pas
- **Plateforme** : both · **Fichiers** : `app/sell/pricing.tsx:43-45,223-227`, `features/sell/components/pricing/PriceCard.tsx:5-9,16-38`, `types/ai.ts:197-233`, `CODEBASE_INDEX.md:272`
- `components/molecules/PriceSuggestion.tsx` n'existe pas (dossier `molecules/` absent, section fantôme de `CODEBASE_INDEX.md`). Aucune logique `suggestedPrice` (grep vide). `PriceCard` = TextInput libre, ne consomme jamais `aiResult`. `AIAnalysisResult` n'a aucun champ `price`.
- **Reco** : implémenter une suggestion (IA/comparables) ou retirer la mention de la spec.

#### P3-7 — Backend n'exige pas ≥1 option de livraison à la création
- **Plateforme** : backend · **Fichiers** : `functions/src/callable/products.ts:216-297,358-359,683-689`, `app/checkout/index.tsx:55-64`, `app/sell/pricing.tsx:160-161`, `config/featureFlags.ts:17`
- Le front impose ≥1 option (`pricing.tsx:160-161`) ; `createArticle`/`updateArticle` n'imposent pas `(isHandDelivery || isShipping)`. Masqué aujourd'hui par `SHIPPING_ENABLED=false` (`featureFlags.ts:17` → checkout force `meetup`). Risque latent à la réactivation du shipping.
- **Reco** : rejeter si `isHandDelivery !== true && isShipping !== true` dans create ET update.

### P2/P3 — Preview & publication

#### P2-11 — `SuccessModal` de publication sans `onRequestClose` — back matériel Android inopérant
- **Plateforme** : Android · **Fichiers** : `components/sell/SuccessModal.tsx:65,83-98`, `app/sell/preview.tsx:205,364-384`, `components/DraftResumeModal.tsx`
- `<Modal visible transparent animationType="none" statusBarTranslucent>` sans `onRequestClose` → back Android ignoré, sorties uniquement via les 2 boutons. **Nuance** : pas un blocage (boutons fonctionnent, aucune perte de données ; article créé `:200`, draft supprimé `:201`). `DraftResumeModal` partage la même omission.
- **Reco** : ajouter `onRequestClose={onReturnHome}`.

#### P2-12 — `DraftResumeModal` sans `onRequestClose` — back Android ne ferme pas la reprise
- **Plateforme** : Android · **Fichiers** : `components/DraftResumeModal.tsx:53-58,132-145`
- Même omission que `SuccessModal`. **Nuance** : mapper `onRequestClose` sur `onResume` (non destructif), PAS `onDiscard` (supprime le brouillon).
- **Reco** : `onRequestClose={onResume}`.

#### P2-13 — Aucune modération réelle : `moderationStatus` codé en dur à `'approved'`
- **Plateforme** : backend · **Fichiers** : `functions/src/callable/products.ts:364`, `functions/src/triggers/products.ts:38`
- `moderationStatus: 'approved'` figé à la création (`products.ts:364`) ; le trigger ne fait que LIRE cette valeur. Aucune file de modération, aucun état `pending`. Mismatch avec la documentation (« modération initiale »).
- **Reco** : corriger la doc OU implémenter une vraie pipeline (`pending`→`approved`/`rejected`).

#### P2-14 — Aperçu affiche les photos locales, publication envoie les URLs Storage → divergence possible
- **Plateforme** : both · **Fichiers** : `app/sell/preview.tsx:135,160,251`, `components/PhotoCarousel.tsx:40-46`, `app/sell/photos-review.tsx:206,271-284,290-301`, `services/aiService.ts:371-377,402`
- Carousel rend `photos` (URIs locales) ; publication envoie `imageUrls = storageUrls || photos` (`preview.tsx:135`). **Cause-racine réelle** : après analyse, `handleMakePrimary`/`handleRemovePhoto` (`photos-review.tsx:271-284`, gardés seulement par `isAnalyzing`) mutent `photos` SANS re-synchroniser `storageUrls`. La SUPPRESSION post-analyse est le pire cas (image supprimée toujours publiée).
- **Reco** : re-synchroniser `storageUrls` lors de `handleMakePrimary`/`handleRemovePhoto`, ou republier depuis `photos` re-uploadées.

#### P2-15 — Le bouton « Modifier » reste actif pendant la publication — navigation concurrente
- **Plateforme** : both · **Fichiers** : `app/sell/preview.tsx:113-114,148,200-205,254-260,346,358`, `app/sell/_layout.tsx`
- Publier est `disabled={isPublishing}` (`:346`) mais « Modifier » (`:358 onPress={handleBack}`) et le back overlay héro (`:254-260`) ne le sont pas, et `gestureEnabled:true` autorise le swipe-back. Au retour de la callable, `deleteDraft` (`:201`) + setState (`:203-205`) s'exécutent sur écran démonté → modal jamais affiché, brouillon supprimé, article créé.
- **Reco** : verrouiller la navigation pendant `isPublishing` (Modifier + back overlay + `gestureEnabled={!isPublishing}`) + ref `isMounted`.

#### P3-8 — Embeddings générés sans vérifier `isActive`/`moderationStatus`
- **Plateforme** : backend · **Fichiers** : `functions/src/triggers/embeddings.ts:259-265`, `functions/src/triggers/products.ts:38`
- Le trigger embeddings ne filtre que sur la présence d'image, contrairement au search_index. Impact nul aujourd'hui (`moderationStatus` toujours `approved`), latent si une modération a priori est ajoutée.
- **Reco** : aligner sur `isActive && moderationStatus==='approved'`.

### P2/P3 — Brouillons & reprise

#### P3-9 — La reprise est conditionnée aux photos locales (et non à l'existence du brouillon/storageUrls)
- **Plateforme** : both · **Fichiers** : `app/(tabs)/sell.tsx:38,43`, `features/sell/components/capture/SellOverlayCapture.tsx:104`, `services/draftService.ts:47,49,181,215`, `app/(tabs)/_layout.tsx:139-158`
- Le gate est `existingDraft.photos.length > 0` (`sell.tsx:38`) ; un brouillon riche sans cache photo n'est jamais proposé. **Nuance décisive** : le déclencheur « purge OS vide `draft.photos` » est FAUX (les URI sont des strings persistées en AsyncStorage, indépendantes des fichiers). État non démontrablement atteignable → robustesse, pas bug reproductible.
- **Reco** : gater sur l'existence du brouillon + reconstruire l'aperçu depuis `storageUrls`.

#### P3-10 — La vignette de `DraftResumeModal` pointe vers une URI locale potentiellement disparue
- **Plateforme** : both · **Fichiers** : `components/DraftResumeModal.tsx:38-39,77,81-85`, `services/draftService.ts:9,99-108`, `app/(tabs)/sell.tsx:93,113-118`
- La vignette utilise `draft.photos[0]` (jamais `storageUrls`). **Nuances** : `DRAFT_IMAGES_DIR` est en `documentDirectory` (non purgé par l'OS), le seul vrai chemin de disparition est le fallback `cacheImage:107` ; placeholder Ionicons déjà présent ; « Reprendre » fonctionne quand même. Cosmétique.
- **Reco** : fallback ordonné `draft.storageUrls?.[0] ?? draft.photos?.[0] ?? null`.

#### P2-16 — `cleanupExpiredDrafts()` jamais appelé malgré « Call this on app startup »
- **Plateforme** : both · **Fichiers** : `services/draftService.ts:436-440,452-461`, `app/_layout.tsx:162-170`, `functions/src/scheduled/cleanupDrafts.ts`
- Méthode documentée « startup » mais jamais invoquée (grep vide hors définition). Seul chemin client purgeant les images orphelines cross-id. La Cloud Function homonyme ne nettoie QUE Firebase Storage (`prefix:'drafts/'`), pas le `documentDirectory` device → fuite de stockage local lente, iOS et Android.
- **Reco** : appeler une fois au démarrage (useEffect post-hydratation auth), ou retirer la méthode.

#### P2-17 — Fermer la capture avec zéro photo supprime le brouillon entier (y compris images Storage déjà uploadées)
- **Plateforme** : both · **Fichiers** : `app/sell/capture.tsx:168-182`, `services/draftService.ts:248,260-263`, `app/(tabs)/sell.tsx:65-96`, `app/sell/photos-review.tsx:208`
- `handleClose` appelle `deleteDraft()` sans confirmation ni `keepStorageImages` si `photos.length===0` (`capture.tsx:178-181`), alors que le chemin `>0` rassure « brouillon sauvegardé ». **Nuance** : le cas réel n'est pas un brouillon avec fields/pricing (impossible à l'étape 1), mais un brouillon **déjà analysé par l'IA** (`storageUrls` uploadées via `updateDraftAIResult` sans bump de `currentStep`) → reprise étape 1 → retrait des photos → close = destruction des images Firebase.
- **Reco** : ne pas `deleteDraft` (ou confirmer) si `storageUrls`/`aiResult` non vides, même `photos` vide.

#### P3-11 — Échec de `loadDraft` dans `photos-review` : analyse bloquée sans recréation
- **Plateforme** : both · **Fichiers** : `app/sell/photos-review.tsx:178-183,305-315,317-320,542-550`, `services/draftService.ts:222-227,231-234`, `features/sell/components/capture/SellOverlayCapture.tsx:98-117`, `app/sell/capture.tsx:83-95`
- Si `loadDraft()` renvoie null, état `error` « Brouillon introuvable » ; retry recharge null (boucle morte). **Nuance** : le déclencheur « expiration >14j » est irréaliste (brouillon créé quelques ms avant) ; vrai cas = AsyncStorage vidé/parse échoué. Sortie « remplir manuellement » disponible (`handleManualEntry`).
- **Reco** : si `loadDraft()` null dans `runAnalysis`, recréer un brouillon (`createEmptyDraft` + `updateDraftPhotos` avec les photos des params).

### P2/P3 — Édition & gestion des articles

#### P2-18 — Parsing du prix `parseFloat` ne gère pas la virgule (édition d'article)
- **Plateforme** : both (édition uniquement) · **Fichiers** : `app/article/edit/[id].tsx:243,295,325,644,646`, `components/EditableField.tsx:82,120,136`
- **Nuance majeure** : le flux de VENTE est sain (`pricing.tsx:136-142` strip la virgule). Seule l'ÉDITION est affectée : `EditableField` ne sanitise pas, `onSave` fait `parseFloat('12,50')=12` (`edit/[id].tsx:644`), `keyboardType="numeric"` (`:646`). Perte VISIBLE (pas silencieuse) car le prix affiché redevient 12.
- **Reco** : normaliser virgule→point avant `parseFloat` dans `EditableField`/`edit`, harmoniser `keyboardType='decimal-pad'`.

#### P2-19 — Suppression d'article = soft-delete définitif sans chemin de réactivation côté app
- **Plateforme** : both · **Fichiers** : `app/my-articles.tsx:52-56,64-65,108`, `services/articlesService.ts:793,833`, `functions/src/callable/products.ts:707-710,763-769`, `features/article/hooks/useArticleActions.ts:226-251,285`, `functions/src/triggers/articles.ts:36-44`, `functions/src/scheduled/retentionPurge.ts:9,88-100`
- `deleteArticle` → `{isActive:false}` ; `getUserArticles` filtre `isActive==true` → disparaît de « Mes articles ». Aucun chemin client ne remet `isActive:true` ; le blocage réel est le guard transaction `products.ts:763-769`. **Nuance** : « jamais purgée » est FAUX — `retentionPurge.ts` hard-delete après ~3 ans (Loi 25). Wording « Supprimer » sans avertissement d'irréversibilité.
- **Reco** : assumer le hard-delete OU ajouter onglet « Masqués » + réactivation, clarifier le wording.

#### P2-20 — Onglets « En vente »/« Vendus » : aucun état vide quand le filtre ne renvoie rien
- **Plateforme** : both · **Fichiers** : `app/my-articles.tsx:52-56,342,386-396`
- État vide gardé par `articles.length===0` (`:342`) uniquement ; `filteredArticles` (`:52-56`) peut être vide avec `articles.length>0` → FlashList vide sans `ListEmptyComponent`.
- **Reco** : état vide contextuel par onglet basé sur `filteredArticles.length===0`.

#### P3-12 — « Marquer comme vendu » non protégé contre le double-tap
- **Plateforme** : both · **Fichiers** : `app/my-articles.tsx:89-101`, `features/article/hooks/useArticleActions.ts:260-276,299`, `functions/src/callable/products.ts:493-497`, `app/article/edit/[id].tsx:803`
- Aucun verrou `isToggling` ; MAJ optimiste double-inverse. **Nuance** : serveur protégé par guard transaction (`products.ts:462-480`) et déclencheur modal (ActionSheet/Alert) limite l'accidentel. Effet net souvent neutre.
- **Reco** : ref/state `toggling` par article, comme `isSaving` (`edit/[id].tsx:803`).

#### P3-13 — `updateArticle` n'exige pas `categoryIds` non vide quand la clé est absente
- **Plateforme** : backend · **Fichiers** : `functions/src/callable/products.ts:287-297,587-598`, `app/article/edit/[id].tsx:292,472`, `functions/src/triggers/products.ts:98`
- Asymétrie create (exige) vs update (valide seulement si clé présente). **Nuance** : non exploitable pour casser l'invariant (omettre la clé garde la valeur existante ; `[]` est rejeté). Risque purement théorique.
- **Reco** : documenter/forcer la non-vacuité en lisant l'existant dans la transaction.

#### P3-14 — Article vendu (`isSold`) reste indexé dans `search_index` ; masquage 100 % côté client
- **Plateforme** : backend · **Fichiers** : `functions/src/triggers/products.ts:38-41,126`, `services/articlesService.ts:505-507,615-617`
- Le trigger ne supprime l'entrée que sur `!isActive`/non-approved ; un vendu reste indexé avec `isSold:true`. Masquage dépend du filtre client (`articlesService.ts:507`, conditionnel à `hasTerm`). Aucune exposition aujourd'hui (4 call sites filtrent), invariant non garanti par l'index.
- **Reco** (optionnel) : supprimer l'entrée `search_index` quand `isSold` devient true.

#### P3-15 — `updateArticle` : `neighborhoods` jamais effacé à null comme `colors`/`materials`
- **Plateforme** : backend · **Fichiers** : `app/article/edit/[id].tsx:190,258,299-304,314-317`, `functions/src/callable/products.ts:659-661,668,678,702-705`, `config/featureFlags.ts`
- Désélectionner tous les quartiers n'envoie pas la clé → ancienne valeur conservée (asymétrie vs colors/materials). **Nuances** : scénario IMPOSSIBLE aujourd'hui (`SHIPPING_ENABLED=false` force `isHandDelivery:true`) ; mention `pattern` du titre = red herring ; « et dans search_index » non vérifié (`updateArticle` n'écrit que `articles/{id}`).
- **Reco** : envoyer `neighborhoods` systématiquement (`[]` → `neighborhood:null`).

### P3 — UX cross-plateforme transverse

#### P3-16 — Transition post-publication iOS dépend d'un `setTimeout(550ms)` magique, fragile au backgrounding
- **Plateforme** : iOS · **Fichiers** : `app/(tabs)/_layout.tsx:139-159`, `components/ui/ImmersiveOverlay/index.tsx:171-194`, `components/ui/ImmersiveOverlay/constants.ts:11`
- `onContinue` iOS fait `dismiss()` puis `setTimeout(550)` avant `router.push` (`_layout.tsx:146-153`), découplé du callback `finished` de l'animation `dismiss` (qui existe pourtant, `index.tsx:175`). `EXITING_TIME=500`. Android pousse directement.
- **Reco** : déclencher `router.push` depuis le callback `finished` (ou exposer `onDismissed`).

#### P3-17 — Le bouton « Quitter » de la capture iOS ne nettoie pas le brouillon vide + wording divergent
- **Plateforme** : both · **Fichiers** : `features/sell/components/capture/SellOverlayCapture.tsx:98-117,195-208`, `app/sell/capture.tsx:168-182`, `app/(tabs)/_layout.tsx:139-158`, `app/(tabs)/sell.tsx:38`, `services/draftService.ts:440-471`
- iOS : si zéro photo, `handleClose` appelle `onClose()` SANS `deleteDraft()` → brouillon vide persisté (créé au montage `:108-110`). Android supprime (`capture.tsx:178-181`). Wording divergent : iOS `'Vos photos sont sauvegardees...'` (accent manquant) vs Android `'Votre brouillon sera sauvegardé...'`. **Nuance** : pas de synchro cross-device (AsyncStorage local) ; impact = pollution stockage local + wording.
- **Reco** : ajouter `deleteDraft()` dans la branche else iOS et harmoniser le texte (accents).

#### P3-18 — Libellés de permission en anglais (transverse, doublon ciblé de P2-2)
- **Plateforme** : both (impact UX surtout iOS) · **Fichiers** : `ios/Seconde/Info.plist:57-58,67-68,71-72`, `app.config.js:43`, `constants/locale.ts:4,7`, `app/sell/capture.tsx:21`
- Voir P2-2. Android n'affiche pas ces chaînes (dialogue OS standard) ; impact concret = review App Store iOS. Aucun `CFBundleLocalizations`/`locales` ne localise ces invites.
- **Reco** : chaînes FR via plugins `expo-camera`/`expo-image-picker` + re-prebuild.

---

## Matrice cross-plateforme

| Zone | iOS | Android | Écart |
|------|-----|---------|-------|
| Écran de capture | `SellOverlayCapture` (overlay immersif) | `app/sell/capture.tsx` (route) | **Oui** — 2 implémentations (`_layout.tsx:139-158`) |
| Reprise de brouillon | Restaure photos seulement, jamais l'étape | `DraftResumeModal` + saut à `currentStep` | **Oui (P1)** — affordance absente sur iOS |
| Brouillon avancé → entrée Vendre | Renvoyé à l'étape 1, ré-analyse IA payante | Saut à pricing/preview | **Oui (P1)** |
| Fade-in caméra | `onCameraReady` + fondu 260 ms | Rectangle noir brut | **Oui (P2)** |
| Bords caméra (flou) | `BlurView` réel (expo-blur) | Voile RGBA opaque | **Oui (P3)** cosmétique |
| Format photo galerie | `.Current` (HEIC) | `.Compatible` (JPEG) | **Oui (P3)** neutralisé en aval |
| Permissions système | Texte EN (Info.plist) | Dialogue OS standard | **Oui (P2/P3)** wording iOS |
| Permission CAMERA (prebuild) | Protégée par expo-image-picker | Perdue au `prebuild --clean` | **Oui (P0/P1)** Android cassé |
| Back matériel / quitter capture | Pas de back matériel ; close ne purge pas draft vide | Back matériel ; close purge draft vide | **Oui (P1/P3)** |
| Back matériel sur modals (Success/DraftResume) | N/A (pas de back matériel) | Ignoré (pas de `onRequestClose`) | **Oui (P2)** |
| Saisie prix virgule (fr-CA) | Concerné en locale FR | Concerné en locale FR | Non (both, pas un écart de plateforme) |
| Contrats données IA (condition/confidence/taille) | Identique | Identique | Non (logique pure) |
| Validation / publication / price-drop / modération | Identique | Identique | Non (backend) |

---

## Plan d'action priorisé (P0 → P3)

**P0 — bloquant build/release (à faire avant tout prebuild propre ou build EAS)**
1. Enregistrer le plugin `["expo-camera", { cameraPermission, microphonePermission }]` dans `app.config.js` + re-prebuild (P0-1). Sécurise la permission CAMERA Android et fige les chaînes iOS.

**P1 — bugs métier & écarts iOS/Android majeurs**
2. Unifier la capture sur un composant partagé paramétré (P1-1) — débloque P1-2, P1-9, P1-10, P2-1.
3. Faire passer iOS par la logique de reprise par `currentStep` + ne ré-analyser que si pas d'`aiResult` (P1-2, P1-9, P1-10).
4. Corriger les contrats IA : `conditionId` serveur/client (P1-3) ; brancher `SizeSelectionSheet` + propager `system` (P1-4).
5. Normaliser virgule→point sur tous les champs prix `decimal-pad` (P1-6, + offre).
6. Backend : `await` direct du `search_index` initial (P1-7) ; reset des champs price-drop + garde `_getPriceDrops` (P1-8).
7. `usePreventRemove` sur l'écran Détails (P1-5).

**P2 — cohérence UX & robustesse**
8. `onRequestClose` sur `SuccessModal`/`DraftResumeModal` (P2-11/12) ; verrouiller navigation pendant publication (P2-15).
9. Aligner les 3 portes de validation (P2-6) ; reset taille au changement de catégorie (P2-7) ; état vide par onglet (P2-20).
10. Dériver/relier meetup spots (P2-9) ; corriger quick-tags quartiers (P2-8) ; `AbortController` sur l'analyse (P2-5).
11. Backend : invariant ≥1 livraison (P3-7 → activer avant shipping), modération doc/pipeline (P2-13), appel `cleanupExpiredDrafts` au démarrage (P2-16), garde `deleteDraft` sur `storageUrls` (P2-17).
12. Re-synchroniser `storageUrls` après mutation photos post-analyse (P2-14) ; quota IA `retryable:false` (P2-4) ; taille `detected` fallback (P2-3) ; soft-delete réactivable + wording (P2-19) ; normalisation prix édition (P2-18) ; permissions FR (P2-2).

**P3 — polish, cohérence visuelle, dette latente**
13. Fade-in/blur caméra Android, ADR sur l'écart de flou, libellé « neuf », vignette `DraftResumeModal`, `setTimeout` post-publication, imports morts `BlurOverlay`, flash caméra, alignements backend latents (embeddings, search_index isSold, neighborhoods clear, categoryIds, double-tap), recréation brouillon dans `photos-review`.

---

## Annexe — faux positifs écartés

1. **Permission Android 13+ `READ_MEDIA_IMAGES` absente** — FAUX POSITIF. Sur API 33/34, `launchImageLibraryAsync` ne demande AUCUNE permission runtime (`ImagePickerModule.kt:258-266` retourne `emptyArray` ≥ TIRAMISU) et utilise le Photo Picker système (`PickVisualMedia`, `ImageLibraryContract.kt:35-80`), conçu sans permission. Le plugin n'injecte de toute façon jamais `READ_MEDIA_IMAGES`. Comportement cross-plateforme préservé.

2. **`KeyboardAvoidingView` Détails sans `keyboardVerticalOffset`** — FAUX POSITIF. Dans `details.tsx:239-247` le KAV est la RACINE et le `ScreenHeader` est À L'INTÉRIEUR → offset attendu = 0 (défaut, correct). Le `chat/[id].tsx:405` a besoin de l'offset 90 parce que son header est HORS du KAV (topologie inverse). Ajouter un offset à Détails introduirait un sur-décalage (bug).

3. **`updateDraftPhotos` n'écrit pas `currentStep`** — FAUX POSITIF. Le spread `{ ...draft, photos, ... }` (`draftService.ts:327-332`) PRÉSERVE `currentStep` ; re-photographier ne doit pas changer l'étape. Le scénario « brouillon avancé renvoyé en capture » est impossible (`handleResume` route step≥2 ailleurs ; « Recommencer » fait un `deleteDraft` complet). De plus la plateforme était inversée (`SellOverlayCapture` est iOS-only, pas Android). Aucun état incohérent créé.
