import { runtimeEnvironment } from '@/config/firebaseEnvironment';
import { PHASE1_QA_ENABLED } from '@/config/featureFlags';

// PostHog project API key.
//
// This is a PUBLIC client key (safe to ship in the app bundle), read from the
// build environment. Unlike the Stripe key there is NO fallback: an absent key
// simply disables analytics silently (initAnalytics becomes a no-op) rather
// than shipping events to a hardcoded/wrong project. Set it per build channel
// via EXPO_PUBLIC_POSTHOG_API_KEY in a future qualified release.
// A developer's .env may still contain the production key. Development has a
// separate opt-in key and never falls back to that production destination.
// Phase 1 does not collect new production analytics, even if an old build
// environment still supplies a capture key. Historical erasure is independent.
export const POSTHOG_API_KEY = runtimeEnvironment.name === 'production' || PHASE1_QA_ENABLED
  ? ''
  : process.env.EXPO_PUBLIC_DEV_POSTHOG_API_KEY || '';

// PostHog ingestion host. Defaults to PostHog Cloud US; override for EU / a
// self-hosted / reverse-proxied instance via EXPO_PUBLIC_POSTHOG_HOST.
export const POSTHOG_HOST = runtimeEnvironment.name === 'production'
  ? process.env.EXPO_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com'
  : process.env.EXPO_PUBLIC_DEV_POSTHOG_HOST || 'https://us.i.posthog.com';
