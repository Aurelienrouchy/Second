import { useEffect, useRef } from 'react';
import * as Linking from 'expo-linking';
import { router, useRootNavigationState } from 'expo-router';
import { handleURLCallback } from '@stripe/stripe-react-native';

/**
 * Maps deep link URLs to app routes.
 *
 * Supported URL patterns:
 *   seconde://article/{id}         → /article/[id]
 *   seconde://chat/{id}            → /chat/[id]
 *   seconde://user/{id}            → /user/[id]
 *   seconde://shop/{id}            → /shop/[id]
 *   seconde://swap-party/{id}      → /swap-party/[id]
 *   seconde://swap/{id}            → /swap/[id]
 *   seconde://notifications        → /notifications
 *   seconde://search?query=...     → /search?query=...
 *   seconde://favorites            → /(tabs)/favorites
 *   seconde://messages             → /(tabs)/messages
 *   seconde://profile              → /(tabs)/profile
 *   seconde://sell                 → /sell
 *   seconde://settings             → /settings
 *
 * Universal links (https://seconde.ca/...) follow the same path patterns.
 *
 * NOTE: Expo Router handles most deep linking automatically via file-based routing.
 * This hook handles edge cases and custom URL patterns that don't map 1:1 to routes.
 */

interface DeepLinkRoute {
  pattern: RegExp;
  handler: (match: RegExpMatchArray, url: URL) => void;
}

const DEEP_LINK_ROUTES: DeepLinkRoute[] = [
  // Search with query params → needs special handling
  {
    pattern: /^\/search$/,
    handler: (_match, url) => {
      const query = url.searchParams?.get('query') || '';
      const filters = url.searchParams?.get('filters') || '{}';
      router.push({
        pathname: '/search',
        params: { query, filters },
      });
    },
  },
  // Tab shortcuts
  {
    pattern: /^\/favorites$/,
    handler: () => router.replace('/(tabs)/favorites'),
  },
  {
    pattern: /^\/messages$/,
    handler: () => router.replace('/(tabs)/messages'),
  },
  {
    pattern: /^\/profile$/,
    handler: () => router.replace('/(tabs)/profile'),
  },
  {
    pattern: /^\/home$/,
    handler: () => router.replace('/(tabs)'),
  },
];

/**
 * Give the Stripe SDK a chance to consume a 3DS / redirect-payment return URL
 * BEFORE our own routing. On iOS, a 3DS challenge returns to the app via the
 * `seconde://checkout/success` returnURL; Stripe must capture it to resume the
 * PaymentIntent. Without this, Expo Router would route to app/checkout/success
 * and flash a parasitic "Paiement confirmé" at $0.00 (F123).
 *
 * Returns true when Stripe handled the URL (callers must NOT route further).
 * No-op on Android (handleURLCallback returns false there).
 */
async function tryStripeURLCallback(url: string): Promise<boolean> {
  try {
    return await handleURLCallback(url);
  } catch (error) {
    if (__DEV__) console.error('Stripe handleURLCallback error:', error);
    return false;
  }
}

function handleDeepLink(url: string): void {
  try {
    const parsed = Linking.parse(url);
    const path = parsed.path || '';

    // Try custom routes first
    for (const route of DEEP_LINK_ROUTES) {
      const match = `/${path}`.match(route.pattern);
      if (match) {
        route.handler(match, new URL(url.replace('seconde://', 'https://seconde.ca/')));
        return;
      }
    }

    // For all other paths, Expo Router handles them automatically
    // via the scheme config in app.config.js.
    // e.g. seconde://article/abc123 → app/article/[id].tsx
    // No manual intervention needed.
  } catch (error) {
    if (__DEV__) console.error('Error handling deep link:', error);
  }
}

/**
 * Hook pour gérer les deep links entrants.
 *
 * Expo Router gère automatiquement la majorité des deep links grâce au
 * routing basé sur les fichiers. Ce hook ajoute le support pour :
 * - Les URL patterns custom (search avec query params, raccourcis tabs)
 * - Le logging/analytics des deep links
 *
 * Doit être appelé UNE SEULE FOIS dans le root layout.
 */
export function useDeepLinking(): void {
  // `useRootNavigationState()` is undefined until the root navigator has
  // mounted; `router.push/replace` are no-ops before that. We gate the cold
  // start URL on it instead of an arbitrary 500ms timeout (which could fire
  // before mount on slow devices, or waste time on fast ones).
  const navigationState = useRootNavigationState();
  const navigatorReady = navigationState?.key != null;

  // Defer the cold-start URL until the navigator is ready, then consume once.
  const navigatorReadyRef = useRef(navigatorReady);
  navigatorReadyRef.current = navigatorReady;
  const pendingInitialUrlRef = useRef<string | null>(null);
  const initialUrlHandledRef = useRef(false);

  const consumeInitialUrl = () => {
    if (initialUrlHandledRef.current) return;
    const url = pendingInitialUrlRef.current;
    if (!navigatorReadyRef.current || !url) return;
    initialUrlHandledRef.current = true;
    // Let Stripe consume a 3DS return URL first; only route ourselves if it
    // didn't (F123).
    void tryStripeURLCallback(url).then((stripeHandled) => {
      if (!stripeHandled) handleDeepLink(url);
    });
  };

  useEffect(() => {
    let isActive = true;

    Linking.getInitialURL().then((initialUrl) => {
      if (!isActive || !initialUrl) return;
      pendingInitialUrlRef.current = initialUrl;
      // The navigator may already be ready by the time this resolves.
      consumeInitialUrl();
    });

    // Handle deep links while app is running (warm start). The navigator is
    // already mounted by then, so route immediately — unless the URL is a
    // Stripe 3DS return, which Stripe must consume first (F123).
    const subscription = Linking.addEventListener('url', (event) => {
      void tryStripeURLCallback(event.url).then((stripeHandled) => {
        if (!stripeHandled) handleDeepLink(event.url);
      });
    });

    return () => {
      isActive = false;
      subscription.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Or the URL was captured before the navigator finished mounting.
  useEffect(() => {
    consumeInitialUrl();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigatorReady]);
}
