import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { ArticlesService } from '@/services/articlesService';
import { Article, ArticleSize, SizeSystem, User } from '@/types';

/** Size systems a bare personalization value (unknown system) may belong to. */
const PERSONALIZATION_SIZE_SYSTEMS: SizeSystem[] = ['US', 'EU'];

/** Personalized feed shares the home staleTime budget (10 min, low volatility). */
const POUR_TOI_STALE_TIME = 10 * 60 * 1000;

/**
 * Query key kept under the 'home' root (mirrors homeKeys.all = ['home']) so a
 * home-wide invalidation (pull-to-refresh on the Home screen) cascades to this
 * feed. The root is inlined as a literal rather than imported from
 * features/home/query-keys to respect the core → features layer boundary
 * (this hook lives in the core layer).
 */
const POUR_TOI_KEY_ROOT = ['home', 'pour-toi'] as const;

/**
 * Personalization sizes (styleProfile.suggestedSizes, preferences.sizes) are
 * bare strings with no system. The articles filter expects ArticleSize
 * ({ value, system }); expand each value across known systems so it matches an
 * article regardless of how its size system is stored (legacy bare-string
 * articles still match on value only, server-side).
 */
function toArticleSizeFilters(values: string[]): ArticleSize[] {
  return values.flatMap((value) =>
    PERSONALIZATION_SIZE_SYSTEMS.map((system) => ({ value, system })),
  );
}

interface PersonalizationData {
  brands: string[];
  sizes: string[];
  styleTags: string[];
  source: 'styleProfile' | 'preferences';
}

/**
 * Extract personalization inputs from styleProfile (AI-generated) or manual
 * preferences. Priority: styleProfile > preferences. Returns null when the
 * user has nothing usable (no profile).
 */
function getPersonalizationData(user: User | null): PersonalizationData | null {
  if (!user) return null;

  // Priority 1: AI-generated style profile
  if (user.styleProfile && user.styleProfile.confidence > 0) {
    const { recommendedBrands, suggestedSizes, styleTags } = user.styleProfile;
    const brands = recommendedBrands?.length > 0 ? recommendedBrands : [];
    const sizes: string[] = [];

    if (suggestedSizes?.top) sizes.push(suggestedSizes.top);
    if (suggestedSizes?.bottom && suggestedSizes.bottom !== suggestedSizes.top) {
      sizes.push(suggestedSizes.bottom);
    }

    if (brands.length > 0 || sizes.length > 0) {
      return { brands, sizes, styleTags: styleTags || [], source: 'styleProfile' };
    }
  }

  // Priority 2: Manual user preferences
  if (user.preferences) {
    const { favoriteBrands, sizes } = user.preferences;
    // Shoe sizes are persisted separately (preferences.shoesSizes) by the
    // onboarding callable; fold them into the size filters so footwear is
    // personalized too. Not yet in the UserPreferences type — read safely.
    const shoesSizes = (user.preferences as { shoesSizes?: string[] }).shoesSizes ?? [];
    const allSizes = [...(sizes ?? []), ...shoesSizes];
    if ((favoriteBrands && favoriteBrands.length > 0) || allSizes.length > 0) {
      return {
        brands: favoriteBrands || [],
        sizes: allSizes,
        styleTags: [],
        source: 'preferences',
      };
    }
  }

  return null;
}

async function fetchPersonalizedFeed(
  data: PersonalizationData,
  userId: string,
  limit: number,
): Promise<Article[]> {
  const { brands, sizes } = data;

  // Typed against the service signature (no `any`).
  const filters: Parameters<typeof ArticlesService.searchArticles>[1] = {
    excludeUserId: userId, // Don't show the user's own articles.
  };

  if (brands.length > 0) {
    filters.brands = brands;
  }
  if (sizes.length > 0) {
    filters.sizes = toArticleSizeFilters(sizes);
  }

  const { articles } = await ArticlesService.searchArticles(undefined, filters, limit);
  return articles;
}

interface UsePersonalizedFeedOptions {
  user: User | null;
  limit?: number;
}

interface UsePersonalizedFeedReturn {
  articles: Article[];
  isLoading: boolean;
  error: string | null;
  styleTags: string[];
  hasProfile: boolean;
  refresh: () => Promise<unknown>;
}

/**
 * Hook for fetching personalized "Pour Toi" articles based on user preferences.
 * Uses AI-generated styleProfile (from Gemini) or manual preferences.
 * Priority: styleProfile > preferences
 *
 * Backed by React Query under homeKeys ('home' > 'pour-toi') so it participates
 * in the home-wide invalidation (pull-to-refresh invalidates homeKeys.all).
 *
 * @example
 * ```tsx
 * const { articles, isLoading, styleTags, hasProfile } = usePersonalizedFeed({ user });
 * ```
 */
export function usePersonalizedFeed({
  user,
  limit = 10,
}: UsePersonalizedFeedOptions): UsePersonalizedFeedReturn {
  const personalizationData = useMemo(() => getPersonalizationData(user), [user]);
  const hasProfile = personalizationData !== null;
  const styleTags = personalizationData?.styleTags ?? [];

  // A profile with neither brands nor sizes yields no query (empty feed).
  const canQuery =
    !!personalizationData &&
    !!user &&
    (personalizationData.brands.length > 0 || personalizationData.sizes.length > 0);

  const query = useQuery({
    queryKey: [...POUR_TOI_KEY_ROOT, user?.id ?? null, limit] as const,
    queryFn: () => fetchPersonalizedFeed(personalizationData!, user!.id, limit),
    enabled: canQuery,
    staleTime: POUR_TOI_STALE_TIME,
  });

  return {
    articles: query.data ?? [],
    isLoading: query.isLoading && canQuery,
    error: query.error instanceof Error ? query.error.message : null,
    styleTags,
    hasProfile,
    refresh: () => query.refetch(),
  };
}

export default usePersonalizedFeed;
