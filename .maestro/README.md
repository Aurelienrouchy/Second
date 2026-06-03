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

The launch flow currently matches on visible FR copy because the cold-start
surfaces lack stable test handles. To harden E2E (and decouple from copy),
add these `testID`s:

- **Onboarding welcome root** (`app/onboarding.tsx`, `showWelcome` branch
  `SafeAreaView`): `testID="onboarding-welcome"`.
- **Onboarding welcome CTA** (`CONTINUER` `Button`): `testID="onboarding-continue"`
  (the `Button` component already accepts a `testID` prop).
- **Onboarding form root** (`app/onboarding.tsx`, form `SafeAreaView`):
  `testID="onboarding-form"`.
- **Home screen root** (`app/(tabs)/index.tsx`, outer `SafeAreaView`):
  `testID="home-screen"` — needed for flows that target returning users who
  skip onboarding and land directly on the Accueil tab.

The bottom tab bar already exposes `tabBarAccessibilityLabel` values
(`Accueil`, `Messages`, `Vendre`, `Favoris`, `Profil`), which are usable
selectors for tab navigation flows today.

## CI / device note

Flow **syntax** is validated locally without a device. Actual **execution**
requires a booted simulator/emulator with a dev-client build installed, which
is out of scope for static setup and typically runs in CI on a macOS
(iOS) / Linux-with-emulator (Android) runner, or via Maestro Cloud.
