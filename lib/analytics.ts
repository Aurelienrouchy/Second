/**
 * PostHog analytics singleton (shared layer — imports only config/ + types/).
 *
 * Single entry point for the app's tracking. Every call is fire-and-forget and
 * wrapped in try/catch: analytics must NEVER throw into the UI. When no API key
 * is configured the client is never created and all functions are silent no-ops.
 *
 * Opt-out product model: enabled by default after consent hydration, the user can turn it off from
 * Settings → Privacy. The choice is persisted to AsyncStorage so it survives a
 * restart and is applied together with the account preference before SDK construction.
 *
 * Event names/props are typed against `AnalyticsEvents` (source of truth:
 * analytics-events.md). Business events are instrumented in a later phase; this
 * file only lays the foundations.
 */
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { PostHogEventProperties } from '@posthog/core';
import PostHog from 'posthog-react-native';

import { SHIPPING_ENABLED } from '@/config/featureFlags';
import { POSTHOG_API_KEY, POSTHOG_HOST } from '@/config/posthogConfig';
import type { AnalyticsEvents, UserTraits } from '@/types/analytics';

// Persisted opt-out flag. Stores 'true' when the user disabled analytics; any
// other value (incl. absent) means enabled (opt-out default).
const OPT_OUT_STORAGE_KEY = 'analytics_opt_out';

let client: PostHog | null = null;

// Boot-time super properties present on every event (see §3 of the catalogue).
// `is_guest` starts true and flips to false on identifyUser; reset() clears
// super properties so we re-register after each reset.
function registerBaseSuperProperties(isGuest: boolean): void {
  try {
    void Promise.resolve(client?.register({
      is_guest: isGuest,
      shipping_enabled: SHIPPING_ENABLED,
    })).catch(() => {});
  } catch (error) {
    if (__DEV__) console.warn('[analytics] register failed:', error);
  }
}

// Both local preference and the authenticated account preference must be known
// before constructing the SDK. Lifecycle capture uses our synchronous gate.
let localEnabled = false;
let localHydrated = false;
let accountEnabled: boolean | undefined;
let consentResolved = false;
let preferenceRevision = 0;
let hydration: Promise<void> | null = null;
let lifecycleStarted = false;
let pendingIdentity: { uid: string; traits: UserTraits } | null = null;

function canCapture(): boolean {
  return localHydrated && consentResolved && (accountEnabled ?? localEnabled);
}

function applyConsent(): void {
  if (!hydration || !canCapture()) {
    void Promise.resolve(client?.optOut()).catch(() => {});
    return;
  }
  if (!client && POSTHOG_API_KEY) {
    client = new PostHog(POSTHOG_API_KEY, {
      host: POSTHOG_HOST,
      // SDK autocapture bypasses our synchronous gate during async optOut.
      captureAppLifecycleEvents: false,
      // Always explicitly apply our persisted preference, including SDK state.
      defaultOptIn: false,
    });
  }
  void Promise.resolve(client?.optIn()).catch(() => {});
  registerBaseSuperProperties(!pendingIdentity);
  if (pendingIdentity) {
    client?.identify(
      pendingIdentity.uid,
      pendingIdentity.traits as unknown as PostHogEventProperties,
    );
  }
  if (client && !lifecycleStarted) {
    lifecycleStarted = true;
    client.capture('Application Opened');
  }

}

/** Hydrates the local preference. SDK construction waits for auth hydration. */
export function initAnalytics(): Promise<void> {
  if (hydration) return hydration;
  const revision = preferenceRevision;
  hydration = Promise.resolve()
    .then(() => AsyncStorage.getItem(OPT_OUT_STORAGE_KEY))
    .then((value) => {
      if (revision === preferenceRevision) localEnabled = value !== 'true';
      localHydrated = true;
      AppState.addEventListener('change', (state) => {
        if (!client || !canCapture()) return;
        try {
          if (state === 'active') client.capture('Application Opened');
          else if (state === 'background') client.capture('Application Backgrounded');
        } catch {}
      });
      applyConsent();
    })
    .catch((error) => {
      // A failed preference read must never enable tracking.
      if (__DEV__) console.warn('[analytics] consent hydration failed:', error);
    });
  return hydration;
}

/** Pause capture while an account's fresh preference is being fetched. */
export function suspendAnalytics(): void {
  consentResolved = false;
  pendingIdentity = null;
  try {
    void Promise.resolve(client?.optOut()).catch(() => {});
    client?.reset();
  } catch {}
}

/** Account preference is authoritative; guests use the local persisted choice. */
export async function setAnalyticsUserConsent(enabled?: boolean): Promise<void> {
  accountEnabled = enabled;
  consentResolved = true;
  await initAnalytics();
  try { applyConsent(); } catch (error) {
    if (__DEV__) console.warn('[analytics] apply consent failed:', error);
  }
}

/** Captures a typed event. No-op if the client is absent or opted out. */
export function track<K extends keyof AnalyticsEvents>(
  event: K,
  props: AnalyticsEvents[K],
): void {
  if (!client || !canCapture()) return;
  try {
    // Event props are constrained by AnalyticsEvents at the call site; the
    // optional-key unions just aren't assignable to the SDK's JsonType record.
    client.capture(event as string, props as unknown as PostHogEventProperties);
  } catch (error) {
    if (__DEV__) console.warn('[analytics] track failed:', error);
  }
}

/** Records a screen view. `routePattern` is the Expo Router pattern, not a real id. */
export function trackScreen(
  routePattern: string,
  params?: Record<string, string>,
): void {
  if (!client || !canCapture()) return;
  try {
    void client.screen(routePattern, params).catch(() => {});
  } catch (error) {
    if (__DEV__) console.warn('[analytics] trackScreen failed:', error);
  }
}

/** Binds the current user (distinct_id = Firebase uid) with pseudonymous product traits. */
export function identifyUser(uid: string, traits: UserTraits): void {
  pendingIdentity = { uid, traits };
  if (!client || !canCapture()) return;
  try {
    client.identify(uid, traits as unknown as PostHogEventProperties);
    registerBaseSuperProperties(false);
  } catch (error) {
    if (__DEV__) console.warn('[analytics] identify failed:', error);
  }
}

/** Clears the identity on sign-out and re-registers guest super properties. */
export function resetAnalytics(): void {
  pendingIdentity = null;
  accountEnabled = undefined;
  if (!client) return;
  try {
    client.reset();
    registerBaseSuperProperties(true);
  } catch (error) {
    if (__DEV__) console.warn('[analytics] reset failed:', error);
  }
}

/**
 * Opt-in / opt-out. Persists the choice to AsyncStorage (survives restart) and
 * applies it to the client. Safe to call before initAnalytics — persistence
 * still happens and initAnalytics re-reads it.
 */
export async function setAnalyticsEnabled(enabled: boolean): Promise<void> {
  preferenceRevision++;
  localEnabled = enabled;
  localHydrated = true;
  accountEnabled = enabled;
  consentResolved = true;
  // Apply refusal synchronously, even when persistence is slow or fails.
  try { applyConsent(); } catch {}
  try {
    await AsyncStorage.setItem(OPT_OUT_STORAGE_KEY, enabled ? 'false' : 'true');
  } catch (error) {
    if (__DEV__) console.warn('[analytics] persist opt-out failed:', error);
  }
  await initAnalytics();
  try { applyConsent(); } catch (error) {
    if (__DEV__) console.warn('[analytics] setAnalyticsEnabled failed:', error);
  }
}
