/**
 * PostHog analytics singleton (shared layer — imports only config/ + types/).
 *
 * Single entry point for the app's tracking. Every call is fire-and-forget and
 * wrapped in try/catch: analytics must NEVER throw into the UI. When no API key
 * is configured the client is never created and all functions are silent no-ops.
 *
 * Opt-out model (Loi 25): enabled by default, the user can turn it off from
 * Settings → Privacy. The choice is persisted to AsyncStorage so it survives a
 * restart and is re-applied at init before any auth hydration.
 *
 * Event names/props are typed against `AnalyticsEvents` (source of truth:
 * analytics-events.md). Business events are instrumented in a later phase; this
 * file only lays the foundations.
 */
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
    client?.register({
      is_guest: isGuest,
      shipping_enabled: SHIPPING_ENABLED,
    });
  } catch (error) {
    if (__DEV__) console.warn('[analytics] register failed:', error);
  }
}

/** Creates the PostHog client once. No-op when the API key is absent. */
export function initAnalytics(): void {
  if (client) return;
  if (!POSTHOG_API_KEY) {
    if (__DEV__) console.log('[analytics] no API key — analytics disabled');
    return;
  }
  try {
    client = new PostHog(POSTHOG_API_KEY, {
      host: POSTHOG_HOST,
      captureAppLifecycleEvents: true,
    });
    registerBaseSuperProperties(true);
    // Re-apply a previously persisted opt-out before any hydration.
    void AsyncStorage.getItem(OPT_OUT_STORAGE_KEY)
      .then((value) => {
        if (value === 'true') {
          try {
            client?.optOut();
          } catch {}
        }
      })
      .catch(() => {});
  } catch (error) {
    if (__DEV__) console.warn('[analytics] init failed:', error);
    client = null;
  }
}

/** Captures a typed event. No-op if the client is absent or opted out. */
export function track<K extends keyof AnalyticsEvents>(
  event: K,
  props: AnalyticsEvents[K],
): void {
  if (!client) return;
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
  if (!client) return;
  try {
    client.screen(routePattern, params);
  } catch (error) {
    if (__DEV__) console.warn('[analytics] trackScreen failed:', error);
  }
}

/** Binds the current user (distinct_id = Firebase uid) with non-PII traits. */
export function identifyUser(uid: string, traits: UserTraits): void {
  if (!client) return;
  try {
    client.identify(uid, traits as unknown as PostHogEventProperties);
    registerBaseSuperProperties(false);
  } catch (error) {
    if (__DEV__) console.warn('[analytics] identify failed:', error);
  }
}

/** Clears the identity on sign-out and re-registers guest super properties. */
export function resetAnalytics(): void {
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
  try {
    await AsyncStorage.setItem(OPT_OUT_STORAGE_KEY, enabled ? 'false' : 'true');
  } catch (error) {
    if (__DEV__) console.warn('[analytics] persist opt-out failed:', error);
  }
  if (!client) return;
  try {
    if (enabled) client.optIn();
    else client.optOut();
  } catch (error) {
    if (__DEV__) console.warn('[analytics] setAnalyticsEnabled failed:', error);
  }
}
