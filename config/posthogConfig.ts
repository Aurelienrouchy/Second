// PostHog project API key.
//
// This is a PUBLIC client key (safe to ship in the app bundle), read from the
// build environment. Unlike the Stripe key there is NO fallback: an absent key
// simply disables analytics silently (initAnalytics becomes a no-op) rather
// than shipping events to a hardcoded/wrong project. Set it per build channel
// via EXPO_PUBLIC_POSTHOG_API_KEY.
export const POSTHOG_API_KEY = process.env.EXPO_PUBLIC_POSTHOG_API_KEY || '';

// PostHog ingestion host. Defaults to PostHog Cloud US; override for EU / a
// self-hosted / reverse-proxied instance via EXPO_PUBLIC_POSTHOG_HOST.
export const POSTHOG_HOST =
  process.env.EXPO_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com';
