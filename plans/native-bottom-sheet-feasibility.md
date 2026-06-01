<!-- Généré par workflow `native-bottomsheet-feasibility` (10 agents) le 2026-05-29, vérifié par l'orchestrateur. -->

# Faisabilité — bottom-sheet 100 % natif (0 JS) parité gorhom · Second

## Note de l'orchestrateur (lire avant le plan)

**Orientation fondateur (bakée dans la reco) :** objectif = **feel/perf 100 % natif** (gestes/snap/scroll/clavier pilotés par l'OS) ; en cas de gap, préférence affichée pour un **module maison** (contrôle total) plutôt qu'une lib tierce.

**Fait vérifié dans le code réel (corrige une prémisse fausse de la doc projet) :**
`@expo/ui ~56.0.15` **community/bottom-sheet n'est PAS un shim gorhom** — c'est une **vraie sheet native** :
- iOS → `node_modules/@expo/ui/src/community/bottom-sheet/BottomSheet.ios.tsx:8` importe `swift-ui/BottomSheet` + modifiers `presentationDetents/presentationDragIndicator/interactiveDismissDisabled/presentationBackground`. C'est une SwiftUI `.sheet`.
- Android → `BottomSheet.android.tsx:8` importe `jetpack-compose/ModalBottomSheet`. C'est un Material3 `ModalBottomSheet`.
- **Zéro import `@gorhom`** dans l'implémentation ; les mentions « gorhom » sont des **commentaires JSDoc de compat** (ex. `BottomSheet.ios.tsx:240`).

**Conséquence sur l'orientation :** le « feel 100 % natif » est donc **déjà atteint** par `@expo/ui` pour ~80 % des cas, **sans écrire de natif**. Le module maison (`expo-native-sheet`, UIKit + View, ~35 j) reste **entièrement documenté en §4** conformément à la préférence fondateur, mais il n'achète que : footer-épinglé-clavier, snap % fidèles sur Android, tap/swipe séparés, `invalidateDetents()` runtime. Le workflow recommande de **prouver d'abord** ces gaps via un POC (§7 Phase 0) avant d'engager 35 j de natif maison.

**Bloqueurs vérifiés dans `types.ts`** (props acceptées mais no-op) : `footerComponent` (l.301), `keyboardBehavior`/`keyboardBlurBehavior` (l.257/265), `backdropComponent` (l.284), `handleIndicatorStyle` (l.337) ; Android 2 états seulement (l.136-138) ; `enableDynamicSizing` ⊕ `snapPoints` exclusifs (l.198-203).

---

# Plan : bottom sheets « 0 JS » natives pour Second — parité gorhom

> Cible : RN 0.85.3 · Expo SDK 56 · New Architecture (Fabric) ON · iOS 16.4+ · Android compileSdk 36 (targetSdk 34) edge-to-edge.
> Définition « 0 JS » retenue : **aucune logique JS de geste / snap-physics / detent / scrim / clavier / scroll-coordonné**. Le contenu reste des vues RN (children Fabric) hébergées dans une sheet native. L'API TS est une fine déclaration de props/events Expo Modules, pas de la logique.

---

## 1. TL;DR — Verdict

**HYBRID-RECOMMENDED.** Le 0 JS à parité gorhom est **faisable**, mais **ne se code pas from-scratch** : `@expo/ui ~56.0.15` (déjà en dépendance) est une **vraie sheet native** (SwiftUI `.presentationDetents` iOS + Material3 `ModalBottomSheet` Android), **pas** un shim gorhom. Vérifié dans `node_modules` : `BottomSheet.ios.tsx` importe `../../swift-ui/BottomSheet`, `BottomSheet.android.tsx` importe `../../jetpack-compose/ModalBottomSheet`, **zéro import `@gorhom`** dans l'implémentation (les 19 occurrences « gorhom » sont des JSDoc de compat). Il couvre **~80 % de la surface gratuitement** et **règle par construction** les 2 bugs cibles (voile Android, dépendance `initialWindowMetrics`).

**Score de parité : 4/11 features en PARITÉ FULL 0-JS · 6/11 PARTIAL · 1/11 BLOQUEUR.** Le seul vrai bloqueur dur = **`BottomSheetFooter` épinglé qui suit le clavier** (no-op confirmé dans `@expo/ui`, README + `types.ts`), utilisé par **4 fichiers vérifiés** (`SelectionBottomSheet`, `SizeSelectionSheet`, `search/BrandSelectionSheet`, `swap-party/AddItemSheet`).

**Fourchette d'effort :**
- **Voie recommandée (hybride @expo/ui + comblement footer)** : **8-12 jours-dev**.
- **Voie module maison complet** (UIKit `UISheetPresentationController` iOS + View `BottomSheetBehavior` Android) : **33-35 jours-dev** (17 iOS + 18 Android, partiellement parallélisables). Réservée si on veut séparer tap/swipe, `invalidateDetents()` runtime, et % de snap fidèles sur Android.

---

## 2. La question tranchée : « peut-on faire 0 JS avec parité gorhom ? »

**Oui à ~80 %, partiellement sur ~15 %, non sur ~5 % — sans jamais écrire un moteur de sheet.**

### 100 % natif, déjà livré dans `@expo/ui` (rien à écrire)
- **Detents multi-snap** en `%`/px → `.presentationDetents([.fraction/.height])` iOS. **iOS honore les % arbitraires** (85 %, 75 %, 60 %…).
- **Scroll coordonné drag-vs-scroll** → `ScrollView`/`FlatList`/`SectionList` RN bruts re-exportés ; UIKit/SwiftUI coordonnent nativement le drag de la feuille vs le scroll de tout `UIScrollView` enfant. **Zéro `gesture-handler` JS.** C'est le plus beau gain.
- **Backdrop/scrim natif** + tap-to-close + pan-down-to-close → monté/démonté **avec** la sheet ⇒ supprime structurellement le bug « voile Android monté en permanence » et rend le workaround `mount-on-open` inutile.
- **`enableDynamicSizing`** (hauteur = contenu) → pont Yoga↔natif (`onGeometryChange` iOS / `shadowNodeProxy.setViewSize` Android). Non utilisé par Second aujourd'hui.
- **Modal stacking** (`BottomSheetModalProvider` devient no-op), **contrôle programmatique** `present/dismiss/snapToIndex/expand/collapse`.
- **Hôtage des children Fabric** : `RNHostView.swift` / `RNHostView.kt` existent dans `node_modules` (vérifié) — le mécanisme central est résolu et réutilisable.

### Partiel (dégradation acceptable ou point dur)
- **`snapPoints` % sur Android** : Material3 `ModalBottomSheet` impose `partialExpand()` ≈ 50 %. Les detents 85 % / 75 % / 60 % **tombent à ~50 %** côté Android. Fidélité possible uniquement via la voie View `BottomSheetBehavior.halfExpandedRatio` (absente de `@expo/ui`).
- **`BottomSheetTextInput` + clavier (`keyboardBehavior`/`keyboardBlurBehavior`)** : `no-op` dans `@expo/ui`. La sheet native ne « pousse » pas un `TextInput` RN profond comme un `UITextField` natif. **Risque #1 du chantier** — à prototyper en premier.
- **`BottomSheetBackdrop` custom** (opacité 0.5 de `ReportBottomSheet`) : perdu, scrim natif non finement customisable. Cosmétique.
- **tap-backdrop vs swipe** indissociables en SwiftUI `.sheet` (Second couple déjà les deux → non bloquant en pratique).
- **`handleIndicatorStyle`** custom (grabber DS, ~8 sheets) : grabber système imposé. Perte cosmétique à valider avec `product-designer`.

### Impossible 0-JS sans changer de socle natif (SwiftUI → UIKit)
- Séparer tap-backdrop-close de pan-down-close.
- Custom detents nommés + redimensionnement runtime via `invalidateDetents()` (utile pour `RecourseReasonSheet` qui change ses snaps selon `showDetailsField`).
- N > 3 snap points (Second n'en a pas → sans objet).
- « Peek permanent » non-modal (Second n'en a pas).

**Bloqueur dur unique : `BottomSheetFooter` épinglé suivant le clavier** (4 fichiers vérifiés). `footerComponent` est un no-op confirmé sur iOS **et** Android. Faisable 0-JS en théorie (`safeAreaInset(edge:.bottom)` iOS / `Box` `imePadding()` Compose) **mais le code natif est absent** des deux libs → soit le développer, soit adopter `@lodev09/react-native-true-sheet` (footer natif existant, mais « flottant », sémantique différente).

---

## 3. Matrice de parité complète

| Feature | Utilisée Second | iOS | Android | Verdict | Gap principal |
|---|---|---|---|---|---|
| `snapPoints` (multi-snap % fixe) | Oui | **full** (`.presentationDetents([.fraction])` honore %) | **partial** (Material3 impose ~50 %, milieu ignoré si N>2) | **partial** | Android : 85/75/60 % → ~50 %. Fidélité only via View `BottomSheetBehavior.halfExpandedRatio` |
| `enableDynamicSizing` | Non | **full** (GeometryReader/PreferenceKey → `.height`) | **full** (Yoga↔Compose `setViewSize`) | **parity** | Exclusif avec snapPoints. Risque flicker New Arch (true-sheet #2051), non exposé chez Second |
| `enablePanDownToClose` | Oui | **full** (`interactiveDismissDisabled(!v)`) | **full** (`sheetGesturesEnabled` + back press) | **parity** | — |
| **`BottomSheetFooter` (footer épinglé + clavier)** | Oui (4 fichiers) | **none** (`footerComponent` no-op) | **none** (no-op) | **BLOQUEUR** | À écrire : `safeAreaInset` iOS / `Box imePadding` Compose, OU true-sheet |
| `BottomSheetScrollView/FlatList/SectionList` (scroll coordonné) | Oui | **full** (UIKit coordonne, 0 JS) | **partial** (ReactScrollView ne participe pas bien au `NestedScrolling`, true-sheet #497) | **partial** | Android fragile : 1 seul scrollable/sheet. POC obligatoire |
| `BottomSheetTextInput` + `keyboardBehavior`/`Blur`/`android_keyboardInputMode` | Oui | **partial** (sheet ne pousse pas un TextInput RN profond ; keyboardBehavior no-op) | **partial** (`WindowInsets.ime`+`imePadding`, mais shrink contenu = point ouvert) | **partial** | **RISQUE #1** — à prototyper. Peut exiger un pont natif `keyboardWillShow→inset` |
| `BottomSheetBackdrop` (voile/scrim + opacité custom) | Oui | **partial** (scrim natif, no-op backdrop, opacité non custom) | **partial** (`scrimColor` natif, pas d'alpha animé JS) | **partial** | Résout le bug voile. Perte opacité custom (`ReportBottomSheet` 0.5). Cosmétique |
| Modal stacking (`BottomSheetModalProvider`) | Oui (root only) | **full** (présentation modale native, Provider no-op) | **full** (no-op) | **parity** | Second n'empile pas réellement |
| Programmatique `snapToIndex/expand/collapse/present/dismiss` | Oui | **full** (`useImperativeHandle`) | **full** (`AsyncFunction` coroutines) | **parity** | `onChange` Android limité à {0, last} |
| tap-backdrop-to-close | Oui | **partial** (couplé au swipe en SwiftUI `.sheet`) | **full** (`shouldDismissOnClickOutside` séparable du back) | **partial** | iOS couple tap+swipe (Second couple déjà → OK) |
| grabber / handle custom (`handleIndicatorStyle`) | Oui (~8 sheets) | **partial** (grabber système, width/couleur DS perdus) | **partial** (DragHandle Material standard) | **partial** | Perte cosmétique DS — valider `product-designer` |

**Synthèse : 4 PARITY · 6 PARTIAL · 1 BLOQUEUR.** Les deux bugs ciblés (voile Android, `initialWindowMetrics` null) **disparaissent par construction** dès qu'on passe au natif.

---

## 4. Architecture cible — module `expo-native-sheet`

> À n'écrire **que** pour combler le footer+clavier des 5 sheets complexes (palier B). Les sheets simples passent par `@expo/ui` (palier A, zéro natif).

### 4.1 Arborescence

```
modules/expo-native-sheet/
├─ expo-module.config.json          # { "platforms":["apple","android"],
│                                    #   "apple":{"modules":["ExpoNativeSheetModule"]},
│                                    #   "android":{"modules":["expo.modules.nativesheet.ExpoNativeSheetModule"]} }
├─ index.ts                          # barrel: NativeSheet, useNativeSheet, types
├─ app.plugin.js                     # config plugin: iOS deploymentTarget>=16.4, Android windowSoftInputMode=adjustResize
├─ src/
│  ├─ NativeSheetView.tsx            # requireNativeView('ExpoNativeSheet','NativeSheetView') + slots content/footer
│  ├─ NativeSheetView.types.ts       # NativeSheetProps, NativeSheetRef, events
│  ├─ useNativeSheet.ts              # hook ref impératif present/dismiss/snapToIndex
│  └─ scrollables.ts                 # re-export ScrollView/FlatList/SectionList/TextInput RN
├─ ios/
│  ├─ ExpoNativeSheet.podspec        # dep ExpoModulesCore + React-RCTFabric
│  ├─ ExpoNativeSheetModule.swift    # DSL: View + AsyncFunctions
│  ├─ ExpoNativeSheetView.swift      # ExpoView ancre Fabric + lifecycle
│  ├─ SheetHostController.swift      # UIViewController présenté (UISheetPresentationController)
│  ├─ SheetDetentResolver.swift      # SnapPoint → [Detent] + invalidateDetents()
│  ├─ SheetKeyboardFooterManager.swift  # footer pinné via keyboardLayoutGuide
│  ├─ FabricHosting.swift            # uiView du child + RCTSurfaceTouchHandler
│  └─ ExpoNativeSheet-Bridging.h     # #import <React/RCTSurfaceTouchHandler.h>
└─ android/
   ├─ build.gradle                   # com.google.android.material:material, coordinatorlayout
   └─ src/main/java/expo/modules/nativesheet/
      ├─ ExpoNativeSheetModule.kt
      ├─ ExpoNativeSheetView.kt       # ExpoView racine, trie children par slot
      ├─ SheetDialog.kt               # Dialog edge-to-edge + CoordinatorLayout + BottomSheetBehavior + scrim + footer
      ├─ SheetBehaviorController.kt   # snapPoints → peekHeight/halfExpandedRatio/expandedOffset
      ├─ TouchDispatchingRootViewGroup.kt  # COPIE verbatim @expo/ui (touches RN Fabric)
      ├─ KeyboardInsetsAnimator.kt    # footer suit le clavier (WindowInsetsAnimationCompat)
      └─ EdgeToEdgeHelper.kt          # WindowCompat.setDecorFitsSystemWindows(false)
```

### 4.2 API TS publique (drop-in, partagée iOS/Android)

```ts
// modules/expo-native-sheet/src/NativeSheetView.types.ts
export interface NativeSheetRef {
  present: () => void;            // = gorhom Modal.present
  dismiss: () => void;            // = gorhom Modal.dismiss
  snapToIndex: (i: number) => void;
  expand: () => void;
  collapse: () => void;
}

export interface NativeSheetProps {
  ref?: Ref<NativeSheetRef>;
  detents: (string | number)[];  // '85%' | 320 | 'fitToContents'
  dismissible?: boolean;         // enablePanDownToClose
  dismissOnBackdropTap?: boolean;// SÉPARÉ du swipe (gain UIKit) ; couplé en @expo/ui
  backgroundColor?: string;
  scrimColor?: string | null;
  backdropOpacity?: number;      // récupère ReportBottomSheet 0.5 (voie UIKit/View only)
  grabber?: boolean;             // handleComponent===null → false
  topInset?: number;
  onDetentChange?: (e: NativeSyntheticEvent<{ index: number }>) => void;
  onDismiss?: (e: NativeSyntheticEvent<object>) => void;
  children: ReactNode;           // → slot "content" (RCTSurface)
  footer?: ReactNode;            // → slot "footer" (safeAreaInset iOS / imePadding Compose)
}
```

```ts
// modules/expo-native-sheet/src/NativeSheetView.tsx — le pont, 0 logique
import { requireNativeView } from 'expo';
const NativeView = requireNativeView<NativeSheetProps>('ExpoNativeSheet', 'NativeSheetView');

export const NativeSheet = forwardRef<NativeSheetRef, NativeSheetProps>((props, ref) => {
  const nativeRef = useRef<any>(null);
  useImperativeHandle(ref, () => ({
    present:     () => nativeRef.current?.present(),
    dismiss:     () => nativeRef.current?.dismiss(),
    snapToIndex: (i) => nativeRef.current?.snapToIndex(i),
    expand:      () => nativeRef.current?.expand(),
    collapse:    () => nativeRef.current?.collapse(),
  }), []);
  const { footer, children, ...rest } = props;
  return (
    <NativeView ref={nativeRef} {...rest}>
      {footer ? <FooterSlot nativeID="native-sheet-footer">{footer}</FooterSlot> : null}
      {children}
    </NativeView>
  );
});
```

### 4.3 Squelette iOS — UIKit `UISheetPresentationController` (voie complète)

> Choix UIKit (pas SwiftUI `.sheet`) parce qu'il débloque les 3 cas durs : `invalidateDetents()` runtime (RecourseReasonSheet), tap/swipe séparés, footer clavier via `keyboardLayoutGuide`. On réutilise le mécanisme Fabric prouvé de `@expo/ui` (`RNHostView.swift` + `RCTSurfaceTouchHandler`).

```swift
// ExpoNativeSheetModule.swift — le contrat natif↔JS
public class ExpoNativeSheetModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ExpoNativeSheet")
    View(ExpoNativeSheetView.self) {
      Prop("detents")  { (v, p: [SnapPoint]) in v.setSnapPoints(p) }
      Prop("dismissible") { (v, on: Bool) in v.dismissible = on }
      Prop("dismissOnBackdropTap") { (v, on: Bool) in v.dismissOnBackdropTap = on } // gain UIKit
      Prop("grabber")  { (v, on: Bool) in v.grabberVisible = on }
      Prop("topInset") { (v, t: Double) in v.topInset = CGFloat(t) }
      Events("onPresent", "onDismiss", "onDetentChange")
    }
    AsyncFunction("present")     { (tag: Int) in try await self.view(tag).present() }
    AsyncFunction("dismiss")     { (tag: Int) in try await self.view(tag).dismiss() }
    AsyncFunction("snapToIndex") { (tag: Int, i: Int) in try await self.view(tag).snap(to: i) }
  }
}

// SheetDetentResolver.swift — SnapPoint → custom detents iOS16
enum SnapPoint { case fraction(Double); case points(Double); case dynamic }
enum SheetDetentResolver {
  static func detents(from points: [SnapPoint], sizing: SheetContentSizing?)
    -> (detents: [UISheetPresentationController.Detent], ids: [UISheetPresentationController.Detent.Identifier]) {
    var ds: [UISheetPresentationController.Detent] = []; var ids: [Identifier] = []
    for (i, p) in points.enumerated() {
      let id = Identifier("snap_\(i)")
      let d = UISheetPresentationController.Detent.custom(identifier: id) { ctx in
        switch p {
        case .fraction(let f): return ctx.maximumDetentValue * CGFloat(f)  // % honoré
        case .points(let px):  return min(CGFloat(px), ctx.maximumDetentValue)
        case .dynamic:         return sizing?.measure(ctx.maximumDetentValue) ?? ctx.maximumDetentValue
        }
      }
      ds.append(d); ids.append(id)
    }
    return (ds, ids)
  }
}

// SheetHostController.swift — invalidateDetents au runtime (ce que SwiftUI ne fait pas proprement)
func applyDetents(from points: [SnapPoint], sizing: SheetContentSizing?, animated: Bool) {
  guard let sheet = sheetPresentationController else { return }
  let r = SheetDetentResolver.detents(from: points, sizing: sizing)
  self.detents = r.detents; self.detentIDs = r.ids
  sheet.animateChanges { sheet.detents = r.detents }
  sheet.invalidateDetents()   // recalc custom resolver → RecourseReasonSheet runtime resize
}
```

**Hôtage Fabric (mécanisme exact, vérifié dans `node_modules/@expo/ui/ios/RNHostView.swift`)** : on récupère la `UIView` réelle du sous-arbre RN (`slotView.subviews.first`), on la **déplace** dans la hiérarchie UIKit du `SheetHostController` via `addSubview` + AutoLayout, **sans toucher au shadow tree Fabric** (Fabric continue de la layouter). On attache `RCTSurfaceTouchHandler` (header `<React/RCTSurfaceTouchHandler.h>`) sinon les `Pressable` sont inertes. **Contrat strict : ne pas démonter l'ancre JS tant que `onDismiss` n'est pas émis** (sinon Fabric détruit la `UIView` hébergée → blank/crash).

**Footer + clavier (0 JS)** : footer = 2e slot Fabric, contraint `bottomAnchor == view.keyboardLayoutGuide.topAnchor` (iOS 15+). UIKit fait remonter le footer au-dessus du clavier nativement.

### 4.4 Squelette Android — View `BottomSheetBehavior` (voie complète)

> Choix View (pas Compose `ModalBottomSheet`) parce que c'est le **seul** chemin qui honore les % de snap arbitraires (`halfExpandedRatio` + `expandedOffset`) et permet un scrim à opacité animée (récupère `ReportBottomSheet` 0.5). On réutilise verbatim `TouchDispatchingRootViewGroup` de `@expo/ui` (`RNHostView.kt` existe, vérifié).

```kotlin
// SheetBehaviorController.kt — mappe % arbitraires sur BottomSheetBehavior (bat Compose qui fait ~50%)
class SheetBehaviorController {
  fun bind(b: BottomSheetBehavior<FrameLayout>, sheet: View, cb: Callbacks, scrim: View, cfg: SheetConfig) {
    val parentH = (sheet.parent as View).height
    when (snaps.size) {
      1 -> when (val s = snaps[0]) {
        is SnapPoint.Fraction -> { b.skipCollapsed = true; b.state = STATE_EXPANDED
                                    b.expandedOffset = (parentH * (1 - s.value)).toInt() }  // ex 85% honoré
        is SnapPoint.Px       -> { b.expandedOffset = (parentH - s.value).coerceAtLeast(0); b.state = STATE_EXPANDED }
        is SnapPoint.Auto     -> { b.isFitToContents = true }
      }
      2 -> { b.isFitToContents = false
             b.halfExpandedRatio = (snaps[0] as SnapPoint.Fraction).value           // ex 0.85
             b.expandedOffset = (parentH * (1 - (snaps[1] as SnapPoint.Fraction).value)).toInt() } // ex 95%→5%
      // N>3 impossible nativement (View ET Compose) — Second n'en a pas
    }
    b.addBottomSheetCallback(object : BottomSheetBehavior.BottomSheetCallback() {
      override fun onStateChanged(v: View, s: Int) { if (s == STATE_HIDDEN) cb.onIndex(-1) else cb.onIndex(indexForState(s)) }
      override fun onSlide(v: View, off: Float) { scrim.alpha = off.coerceIn(0f,1f) * cfg.scrimOpacity } // voile suit la sheet
    })
  }
}

// KeyboardInsetsAnimator.kt — footer suit le clavier, frame-synchrone, 0 JS
object KeyboardInsetsAnimator {
  fun attach(footer: View, root: View) {
    ViewCompat.setWindowInsetsAnimationCallback(root,
      object : WindowInsetsAnimationCompat.Callback(DISPATCH_MODE_STOP) {
        override fun onProgress(insets: WindowInsetsCompat, running: List<WindowInsetsAnimationCompat>): WindowInsetsCompat {
          val ime = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom
          val nav = insets.getInsets(WindowInsetsCompat.Type.navigationBars()).bottom
          footer.translationY = -maxOf(0, ime - nav).toFloat()  // collé au-dessus du clavier, padde la navbar au repos
          return insets
        }
      })
  }
}
```

**Hôtage Fabric (verbatim `@expo/ui`)** : `addView()` intercepte le child Fabric, l'enveloppe dans `TouchDispatchingRootViewGroup` (RootView + `JSTouchDispatcher`/`JSPointerDispatcher`, `eventDispatcher = UIManagerHelper.getEventDispatcherForReactTag`). `onMeasure` → `setMeasuredDimension(EXACT)`, `onLayout` **NO-OP** (Yoga appelle `child.layout()` lui-même). Dynamic sizing → mesure `MeasureSpec.UNSPECIFIED` puis `shadowNodeProxy.setViewSize` + `flushPendingStateUpdates()` (event synchrone `topExpoUISyncFlush`).

**`initialWindowMetrics` null contourné** : la sheet ne lit **jamais** `react-native-safe-area-context`. Les insets viennent de `WindowInsetsCompat` (`ime/systemBars/navigationBars/displayCutout`).

### 4.5 Config plugin (`app.plugin.js`)

- iOS : `deploymentTarget >= 16.4` (déjà le cas), pas d'autre patch (autolinking suffit).
- Android : `windowSoftInputMode=adjustResize` (footer/clavier), thème Dialog hérité de `Theme.Material3.*` (sinon `BottomSheetBehavior` crashe au gonflage du DragHandle), `resolutionStrategy` pour aligner `com.google.android.material:material`.
- **Aucune édition de `android/` ou `ios/` directe** (bloquée par hook) → tout passe par le config plugin + `npx expo prebuild`.

---

## 5. Bloqueurs & contournements

| Bloqueur | Cause | Contournement 0-JS | Reste de risque |
|---|---|---|---|
| **Footer épinglé suivant le clavier** | `footerComponent` no-op dans `@expo/ui` (les 2 plateformes) | iOS `safeAreaInset(edge:.bottom)` + 2e `RNHostView` ; Android `Box`/`FrameLayout` `imePadding()`+`navigationBarsPadding()` + `WindowInsetsAnimationCompat`. **OU** `@lodev09/react-native-true-sheet` (footer natif existant) | Mesure hauteur footer RN + sync clavier non prouvée sur device. Bug « 1er tap avalé clavier ouvert » (true-sheet #641) |
| **Dynamic sizing précis** | Mesure Yoga↔natif peut osciller sous New Arch (true-sheet #2051) | Debounce via `lastDispatchedContentSize` (déjà dans `HostView.kt`), `invalidateDetents()` uniquement à idle | Non utilisé par Second → piège seulement si activé plus tard |
| **Snap % arbitraire pendant drag (Android)** | Material3 `ModalBottomSheet` impose ~50 % | Voie View `BottomSheetBehavior` (`halfExpandedRatio`/`expandedOffset`) | N>3 impossible nativement. `halfExpandedRatio` doit être strictement entre 0 et `expanded` |
| **TextInput RN profond + clavier** | Sheet native ne « pousse » pas une vue RN re-routée par `RCTSurfaceTouchHandler` | `ScrollView` RN natif + `prefersScrollingExpandsWhenScrolledToEdge` iOS / `imePadding` Android | **RISQUE #1.** Peut exiger un pont natif `keyboardWillShow→inset` (reste 0-JS côté app). 7 sheets concernées |
| **Edge-to-edge Android 15** | `compileSdk 36`, `targetSdk 34` (enforcement pas encore actif) | `WindowCompat.setDecorFitsSystemWindows(false)` + insets manuels (déjà fait dans le module) | Le Dialog n'hérite pas auto du edge-to-edge de l'Activity → tester contre les thèmes app |
| **Fabric re-parenting** | On déplace une `UIView`/`View` hors de l'arbre Fabric | Garder l'ancre montée jusqu'à `onDismiss` ; `removeView` AVANT de détruire le Dialog/VC | Comportement non standard, validé par `@expo/ui` mais à reconfirmer sur device en UIKit pur |
| **Backdrop opacité custom (iOS)** | `UISheetPresentationController` n'expose pas l'alpha de la dimming view | Tapoter la dimming view privée | **Risque review App Store** si API privée. Préférer accepter le scrim système |

---

## 6. Build custom VS true-sheet VS RN-screens VS rester hybride gorhom

| Option | Pour | Contre | Verdict Second |
|---|---|---|---|
| **`@expo/ui` (déjà installé)** | Natif vérifié (SwiftUI + Material3), 0 dépendance ajoutée, hôtage Fabric prouvé, résout bug voile + `initialWindowMetrics`, drop-in API gorhom | Footer/backdrop/keyboard no-op ; Android 2 états (~50 %) ; pas de handle custom | **SOCLE des ~9 sheets simples** |
| **`@lodev09/react-native-true-sheet 3.10.1`** | 0-JS prouvé & mature (1.9k★, 4 issues ouvertes), footer/header/scroll/clavier **natifs Fabric**, detents (max 3), voile réglable, stacking, maintenu (release hebdo), installable via prebuild | API ≠ gorhom (detents vs snapPoints, footer prop vs `BottomSheetFooter`) ; footer « flottant » (sémantique ≠) ; v3.11 beta peerDep reanimated≥4 + worklets (vérifier compat 4.3.1) | **CANDIDAT pour les 5 sheets complexes** (footer/clavier) |
| **Module maison `expo-native-sheet` (UIKit + View)** | Débloque tout (tap/swipe séparés, `invalidateDetents`, % Android fidèles, footer inline) | **33-35 j**, dette de maintenance permanente vs UIKit/Compose, re-parenting UIKit pur à reconfirmer | **Seulement si** true-sheet patine sur le footer/clavier (POC > 3 j) |
| **`react-native-screens`/Expo Router `formSheet` (déjà installé)** | Sheet native par navigation, déjà là | Footer = `unstable_sheetFooter` (expérimental, Android-only) ; bug #3181 (pas de resize clavier `fitToContents` Android) ; pas de backdrop custom | **NON pour les sheets à formulaire.** Éventuellement modales plein-écran route-level |
| **Rester hybride gorhom** | Zéro chantier, parité 100 % aujourd'hui | Bug voile Android persiste (workaround `mount-on-open`), poids `reanimated`+`gesture-handler`, dépendance `initialWindowMetrics` | **Statu quo de repli** si le POC échoue |

**Recommandation argumentée pour Second :** **ne pas builder un module from-scratch d'emblée.** Stratégie 2 paliers qui calque le split hybride actuel mais remplace gorhom par du natif :

1. **Palier A — `@expo/ui`** (déjà installé) pour les **9 sheets simples** sans footer-clavier : `CategoryBottomSheet`, `SelectionBottomSheet`*, `SizeSelectionSheet`*, `NeighborhoodBottomSheet`, `RecourseReasonSheet`, `ReportBottomSheet`, `AuthBottomSheet`, `admin/RejectionModal`, + `ThemedBottomSheet` (déjà sur `@expo/ui`). Coût quasi nul.
2. **Palier B — `true-sheet` (priorité) ou `expo-native-sheet`** pour les **5 sheets complexes** à footer/clavier/recherche-live : `SelectionBottomSheet`, `SizeSelectionSheet`, `search/BrandSelectionSheet`, `swap-party/AddItemSheet`, `MakeOfferModal`.
3. **Garder gorhom** tant qu'au moins une sheet n'est pas migrée, retirer au dernier lot (allège le bundle).

> `*` Selection/Size apparaissent dans les deux paliers : leur footer impose le palier B si on veut le footer-clavier natif ; sinon palier A avec footer inline non-épinglé (dégradé acceptable seulement sans clavier).

---

## 7. Roadmap phasée

| Phase | Contenu | Critère de validation (GO pour la suite) | Jours-dev |
|---|---|---|---|
| **Phase 0 — POC de-risk (1 sheet)** | Migrer `BrandSelectionSheet` (le pire cas : recherche live + clavier + `FlatList` paginée + footer) sur `true-sheet`. Build EAS device iOS 16/17/18 + Android. Mesurer : (a) scroll coordonné Android (`NestedScrolling` #497), (b) TextInput profond remonte au clavier, (c) footer reste au-dessus du clavier, (d) 1er tap footer clavier-ouvert (#641) | Les 4 points OK sur device sans pont JS de geste/clavier. Sinon : pont natif `keyboardWillShow→inset` chiffré, ou repli gorhom sur cette sheet | **3-4** |
| **Phase 1 — Shim de compat** | `components/ui/native-sheet/` : `BottomSheet`/`BottomSheetModal` (→ `@expo/ui`), `BottomSheetBackdrop` (no-op typé), `scrollables` (re-export RN), `mapProps` (gorhom→natif), `useSheetRef` (`show/hide`↔`present/dismiss`). Barrel named-exports (ESLint boundaries : `components/ui/` = layer core) | `npx tsc --noEmit` OK. 1 sheet simple (`RejectionModal`) bascule en changeant 1 import | **2** |
| **Phase 2 — Lot sheets simples** | Migrer les 9 sheets palier A vers le shim `@expo/ui`. Supprimer `mount-on-open` (scrim natif) | Voile Android résolu (scroll/clics OK fermé). `RecourseReasonSheet` change ses snaps OK (sinon → palier B). Tests device | **2-3** |
| **Phase 3 — Lot sheets complexes** | Migrer les 5 sheets footer/clavier sur `true-sheet` (`BottomSheetFooter`→prop `footer`, `BottomSheetScrollView`→`ScrollView`+`scrollable`). Si true-sheet patine : `expo-native-sheet` palier B | Footer suit le clavier, scroll coordonné OK device iOS+Android. `MakeOfferModal` snap acceptable (ou garder gorhom) | **3-5** (true-sheet) / **+20** (module maison) |
| **Phase 4 — Retrait gorhom** | Retirer `BottomSheetModalProvider` du root (`app/_layout.tsx`), désinstaller `@gorhom/bottom-sheet`, nettoyer le shim | `npm run lint:boundaries` + `npx tsc --noEmit` OK, build EAS vert, bundle allégé | **1** |

**Total voie hybride recommandée : 11-15 j** (Phase 0→4 avec true-sheet). **Total voie module maison full : ~35 j** si Phase 3 bascule sur `expo-native-sheet`.

---

## 8. Plan de migration des 14 sheets

**Principe : shim `@/components/ui/native-sheet` qui ré-exporte les noms gorhom.** Migration = changer **une ligne d'import** + supprimer le `renderBackdrop` (no-op) par fichier. Le risque de régression est concentré dans le shim (point unique, feature-flaggable par alias), pas dispersé dans 14 fichiers.

| # | Fichier | Palier | Risque | Note migration |
|---|---|---|---|---|
| 1 | `app/_layout.tsx` (Provider) | — | Faible | Garder `BottomSheetModalProvider` jusqu'au lot final, puis retirer |
| 2 | `components/CategoryBottomSheet.tsx` | A | Moyen | 85 % → ~50 % Android (acceptable). POC scroll Android |
| 3 | `components/SelectionBottomSheet.tsx` | **B** | Moyen | Footer VALIDER → prop `footer` |
| 4 | `components/SizeSelectionSheet.tsx` | **B** | Moyen | Footer VALIDER(n) + toggles |
| 5 | `components/search/BrandSelectionSheet.tsx` | **B** | **Élevé** | **POC Phase 0** : recherche live + clavier + `FlatList` paginée + footer simultanés |
| 6 | `features/swap-party/components/AddItemSheet.tsx` | **B** | Élevé | `BottomSheetModal` + footer Ajouter(n) ; garde-fou lifecycle ancre |
| 7 | `components/MakeOfferModal/index.tsx` | **B** | Élevé | 85/95 % + `keyboardBehavior='fillParent'`. Acter dégradation Android ou garder gorhom |
| 8 | `components/AuthBottomSheet.tsx` | A | Moyen | TextInput email/password/username + clavier interactive |
| 9 | `components/NeighborhoodBottomSheet.tsx` | A | Moyen | `SectionList` sticky + 75/90 % (Android ~50 %) |
| 10 | `components/RecourseReasonSheet.tsx` | A | Moyen | Snaps dynamiques (`showDetailsField`) → si KO en `@expo/ui`, passer B (UIKit `invalidateDetents`) |
| 11 | `components/ReportBottomSheet.tsx` | A | Faible | Perd opacité backdrop 0.5 (cosmétique) |
| 12 | `components/admin/RejectionModal.tsx` | A | Faible | **1re bascule** (Phase 1 validation shim) |
| 13 | `components/ui/ThemedBottomSheet.tsx` | A | Faible | Déjà sur `@expo/ui` — aligner sur le shim |
| 14 | `components/ui/native-sheet/*` (shim, nouveau) | — | **Point unique** | Bug ici = 14 sheets. Feature-flag par alias d'import, bascule lot par lot |

**Ordre :** 12 (valide shim) → lot A (2,8,9,10,11,13) → Phase 0 déjà faite sur 5 → lot B restant (3,4,6,7) → retrait Provider (1).

---

## 9. Risques & maintenance

- **iOS 16+ only** : `UISheetPresentationController.Detent.custom` et `.presentationDetents` sont iOS 16. Second cible **16.4** → OK. Bug communauté « `presentationDetents` se comporte mal iOS 16-18 (corrigé iOS 26) » sur multi-snap/selection → **tester sur device réel iOS 16/17/18** via build EAS.
- **Divergences iOS/Android assumées** : iOS honore les % de snap, Android non (`@expo/ui` ~50 %, ou voie View pour fidélité). Documenter le comportement attendu par sheet ; ne pas promettre une parité pixel cross-plateforme.
- **Dette d'un module natif maison** (si palier B = `expo-native-sheet`) : maintenir Swift + Kotlin contre les évolutions UIKit/Material3 et les bumps RN/Fabric. **true-sheet est maintenu (1.9k★, release hebdo)** → préférer la lib tant qu'elle couvre le besoin ; bascule module maison seulement si elle bloque.
- **Suivi des updates** : surveiller `@expo/ui` (footer natif un jour ? rendrait le palier B caduc), true-sheet (compat reanimated 4.3.1 / RN 0.85.3 — la 3.11 beta ajoute peerDep reanimated≥4), et le bump `targetSdk 35` (rendra la gestion manuelle des insets IME obligatoire ailleurs — le module est déjà prêt).
- **Perte DS cosmétique** : grabber système (width/couleur custom perdus, ~8 sheets) + opacité backdrop (`ReportBottomSheet` 0.5). À arbitrer avec `product-designer` (Editorial Luxe / SwapZone sombre) **avant** la Phase 2.
- **Édition native bloquée par hook** : tout le Swift/Kotlin passe par `modules/expo-native-sheet` + config plugin + `npx expo prebuild`. Déléguer le natif à `rn-expo-dev`.
- **Garde-fou lifecycle Fabric** : ne jamais démonter l'ancre JS pendant la présentation (sinon blank/crash). À documenter + garde-fou natif (retenir la vue jusqu'au `onDismiss`).

---

## 10. Recommandation finale & première action concrète

**Verdict : HYBRID-RECOMMENDED.** Le 0 JS à parité gorhom est atteignable pour Second **sans écrire un moteur de sheet**, en s'appuyant sur le fait vérifié que `@expo/ui ~56.0.15` est déjà une vraie sheet native. On ne paie du natif **que** pour le footer+clavier (le seul vrai bloqueur), idéalement via `true-sheet` (prouvé, maintenu) plutôt qu'un module maison de 35 jours.

**Décision build-vs-buy : BUY d'abord** (`@expo/ui` + `true-sheet`), **BUILD seulement si** le POC footer/clavier de `true-sheet` dérape (> 3 j) — alors `expo-native-sheet` (UIKit iOS + View Android) lève les réserves restantes.

**Première chose à coder — Phase 0, le POC qui tranche tout :**
> Migrer **`components/search/BrandSelectionSheet.tsx`** (le pire cas concentré : recherche live `BottomSheetTextInput` + clavier + `BottomSheetFlatList` paginée + `BottomSheetFooter`) vers **`@lodev09/react-native-true-sheet`**, builder en **EAS dev-client sur device iOS (16/17/18) et Android**, et valider les 4 points de de-risk : (1) scroll coordonné Android sans que le drag remonte la sheet (#497), (2) le `TextInput` remonte au clavier via scroll natif seul, (3) le footer reste collé au-dessus du clavier, (4) pas de 1er-tap-avalé clavier ouvert (#641). **Ce POC valide ou invalide tout le reste du plan en 3-4 jours.**

Déléguer : POC + migration app → `rn-expo-dev` ; natif du module (si Phase 3 = maison) → `rn-expo-dev` via config plugin/prebuild ; arbitrage grabber/scrim DS → `product-designer`.
