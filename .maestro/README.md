# Maestro E2E — Second

End-to-end UI tests for the Second app, driven by
[Maestro](https://maestro.mobile.dev). These flows exercise the **real built
app** on a simulator/emulator (or device) — they are the outer layer of the
test pyramid, above Jest (RN components/screens/hooks) and Vitest
(`functions/`, `tests/security/`, pure utils).

- **appId:** `com.seconde.app` (matches `app.config.js` →
  `android.package` / `ios.bundleIdentifier`).
- **CLI:** Maestro `2.6.0`.

## Layout

```
.maestro/
├── config.yaml            # workspace config (flow discovery + ordering)
├── README.md              # this file
└── flows/
    └── 00-launch.yaml      # cold-start smoke test (clears state → onboarding)
```

Flows are numbered (`00-`, `01-`, …) so they run in a deterministic order;
the launch smoke test always runs first.

## Prerequisites

1. **Maestro CLI** on PATH:

   ```bash
   curl -Ls "https://get.maestro.mobile.dev" | bash
   export PATH="$PATH:$HOME/.maestro/bin"      # add to your shell profile
   maestro --version                            # → 2.6.0
   ```

2. **A running simulator/emulator with the app installed.** Maestro drives an
   already-installed build; it does not build the app. Because this project
   uses a **dev client** (not Expo Go), produce a build first, e.g.:

   ```bash
   # iOS simulator
   npx expo run:ios
   # Android emulator
   npx expo run:android
   ```

   Maestro auto-detects the booted device. To target a specific one:
   `maestro --device <udid|emulator-name> test .maestro/flows`.

## Running

```bash
npm run test:e2e                  # runs every flow under .maestro/flows
maestro test .maestro/flows/00-launch.yaml   # a single flow
```

`maestro studio` opens an interactive inspector against the running app —
useful for discovering element selectors and authoring new flows.

## Writing flows

- One YAML file per user journey, prefixed with a 2-digit order number.
- Start each flow with an `appId:` header and a `launchApp` command.
- Prefer **stable `testID`s** over visible copy for selectors — copy is FR and
  may change, and brittle text matching makes flows flaky. Where a screen has
  no usable `testID` yet, see **Missing testIDs** below.
- Onboarding intros use reanimated `FadeIn*` (staggered ≤ ~400ms). Give the
  first assertion on any freshly-mounted screen a generous `timeout` (the
  launch flow uses 15s) so animations do not cause flakiness. The app uses
  `withTiming` (no springs), so timings are predictable.

## Missing testIDs (deferred — add to components)

Stable `testID`s are now posted across the surfaces the flows touch
(onboarding, home header, tab bar, sell tunnel, checkout, search, wallet,
notifications, profile/reviews, admin shops, offers, swap CTAs). The flows
select via `id:` everywhere a handle exists. The selectors still matched on
visible FR copy or coordinates (because no usable handle exists yet) are:

- **Auth bottom sheet titles** (`SignInForm` / `SignUpForm`): the welcome
  headers ("…te revoir", "Bienvenue sur …") have no root `testID` — matched by
  copy. Add `testID="auth-signin-root"` / `auth-signup-root`.
- **Sell success modal** (`components/sell/SuccessModal.tsx`): matched on
  "Annonce publiée". Add `testID="sell-success-modal"`.
- **Native pickers / RN Alerts**: the system photo gallery ("Add" / "Ajouter")
  and the capture exit `Alert.alert` ("Quitter") are OS-level surfaces — not
  testable by `testID`; copy match is the only option.
- **Admin filter chips** (`app/admin/shops.tsx`): the "En attente" / "Toutes"
  segmented tabs and the "Administration" `SettingItem`
  (`app/settings/index.tsx`) have no `testID` — matched by copy.
- **Swap Zone grid + selector**: `PartyItemCard`
  (`features/swap-party/components/PartyItemCard.tsx`), the `MultiSelectBar`
  "Proposer" button, and the `SwapItemSelector` items + "Confirmer" button
  (`components/swap/SwapItemSelector.tsx`) lack `testID`s — tapped by
  coordinates. Add `swap-zone-item-<id>`, `swap-multiselect-propose`,
  `swap-item-selector-item-<id>`, `swap-item-selector-confirm`. Also the
  `propose-swap` screen root + its "Leur article" / "Mon article proposé"
  section labels and the "Proposition envoyée !" Alert (RN Alert).
- **Various ScreenHeader titles** ("Porte-monnaie", "Mes échanges") and empty
  states ("Aucune notification", "Aucun avis pour le moment") are matched by
  copy as secondary assertions — the screen *root* `testID` is the primary
  selector in each flow, so these copy checks only lock the UX contract.

The bottom tab bar exposes both `tabBarAccessibilityLabel` AND
`tabBarButtonTestID` (`Accueil`, `Messages`, `Vendre`, `Favoris`, `Profil`),
matched via `id:` for tab navigation. The `tabBarButtonTestID` props were added
so the `id:` selectors resolve on iOS (where Maestro maps `id:` to
`accessibilityIdentifier`, not the accessibility label).

## Running against the iOS dev-client (important)

These flows are wired to run against a **dev-client** build connected to Metro
(`http://192.168.2.78:8081` in dev). They do NOT `launchApp` directly — they go
through one of three shared subflows under `subflows/` (excluded from flow
discovery; `config.yaml` only globs `flows/*.yaml`):

- `open-app-fresh.yaml` — `launchApp clearState: true`, then taps the Metro
  server card on the dev-client launcher (`Seconde, http://…:8081`) to load the
  JS bundle, then dismisses the RN developer-menu intro (`Close`) that pops on
  first connect. Used by every flow that needs a deterministic onboarding entry.
- `open-app.yaml` — plain `launchApp` (session preserved), with the same
  launcher/dev-menu guards as defensive no-ops. Used by session-preserving flows.
- `pass-onboarding.yaml` — taps `onboarding-skip` / `onboarding-skip-form`
  (« Passer ») to route straight to the guest home.

### Known Maestro + iOS limitations encountered

- **gorhom bottom-sheet content is invisible to Maestro on iOS.** The
  `@gorhom/bottom-sheet` content (auth sheet `AuthBottomSheet`, `MakeOfferModal`,
  `SelectionBottomSheet`, `SwapItemSelector`) renders in a portal subtree that
  XCUITest's accessibility snapshot does not traverse — neither the `testID`s
  nor the visible FR text are queryable, even though everything renders on
  screen. The `search` flow works around the État sheet by tapping the item by
  coordinates; auth/offer/swap-selector sheets cannot be driven by `id:`.
- **`setAirplaneMode` does not parse in Maestro 2.6.0** (only
  `toggleAirplaneMode`), and toggling airplane mode on the **iOS simulator**
  does not propagate the connectivity loss to `expo-network`, so the offline
  banner never appears. The `offline-banner` testID/selector is correct; this
  flow is reliable on an Android emulator or a physical iOS device only.
- **Full-bleed Pressables that extend past the fold** (home Swap Zone entry)
  don't fire `onPress` for Maestro's synthetic center-tap until the element is
  scrolled fully on-screen (`scrollUntilVisible … centerElement: true`).
- **Auth-dependent flows.** The app under test is in a **guest** state, and most
  deep flows route through `requireAuth` (every profile-menu item, the Vendre
  tab, Acheter/OFFRE/propose-swap CTAs, Messages). These flows reach their last
  pre-auth surface then open the (invisible) auth sheet — they require a seeded
  authenticated session (and `boutiques-admin` an admin custom claim) to go
  further.

## CI / device note

Flow **syntax** is validated locally without a device. Actual **execution**
requires a booted simulator/emulator with a dev-client build installed, which
is out of scope for static setup and typically runs in CI on a macOS
(iOS) / Linux-with-emulator (Android) runner, or via Maestro Cloud.
