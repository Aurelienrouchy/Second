import { useEffect } from 'react';
import * as Linking from 'expo-linking';
import { router } from 'expo-router';

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
 * Universal links (https://seconde.app/...) follow the same path patterns.
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

function handleDeepLink(url: string): void {
  try {
    const parsed = Linking.parse(url);
    const path = parsed.path || '';

    // Try custom routes first
    for (const route of DEEP_LINK_ROUTES) {
      const match = `/${path}`.match(route.pattern);
      if (match) {
        route.handler(match, new URL(url.replace('seconde://', 'https://seconde.app/')));
        return;
      }
    }

    // For all other paths, Expo Router handles them automatically
    // via the scheme config in app.config.js.
    // e.g. seconde://article/abc123 → app/article/[id].tsx
    // No manual intervention needed.
  } catch (error) {
    console.error('Error handling deep link:', error);
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
  useEffect(() => {
    // Handle deep link that opened the app (cold start)
    const handleInitialURL = async () => {
      const initialUrl = await Linking.getInitialURL();
      if (initialUrl) {
        // Small delay to let navigator mount
        setTimeout(() => handleDeepLink(initialUrl), 500);
      }
    };

    handleInitialURL();

    // Handle deep links while app is running (warm start)
    const subscription = Linking.addEventListener('url', (event) => {
      handleDeepLink(event.url);
    });

    return () => {
      subscription.remove();
    };
  }, []);
}
