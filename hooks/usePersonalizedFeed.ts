import { useCallback, useEffect, useState } from 'react';

import { ArticlesService } from '@/services/articlesService';
import { Article, User } from '@/types';

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
  refresh: () => Promise<void>;
}

/**
 * Hook for fetching personalized "Pour Toi" articles based on user preferences.
 * Uses AI-generated styleProfile (from Gemini) or manual preferences.
 * Priority: styleProfile > preferences
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
  const [articles, setArticles] = useState<Article[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Extract personalization data from styleProfile or preferences
  const getPersonalizationData = useCallback(() => {
    if (!user) return null;

    // Priority 1: AI-generated style profile
    if (user.styleProfile && user.styleProfile.confidence > 0) {
      const { recommendedBrands, suggestedSizes, styleTags } = user.styleProfile;
      const brands = recommendedBrands?.length > 0 ? recommendedBrands : [];
      const sizes: string[] = [];

      // Add sizes from suggestedSizes
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
      if ((favoriteBrands && favoriteBrands.length > 0) || (sizes && sizes.length > 0)) {
        return {
          brands: favoriteBrands || [],
          sizes: sizes || [],
          styleTags: [],
          source: 'preferences',
        };
      }
    }

    return null;
  }, [user]);

  const personalizationData = getPersonalizationData();
  const hasProfile = personalizationData !== null;
  const styleTags = personalizationData?.styleTags || [];

  const fetchPersonalizedFeed = useCallback(async () => {
    const data = getPersonalizationData();

    // No personalization data available
    if (!data || !user) {
      setArticles([]);
      return;
    }

    const { brands, sizes } = data;

    // If no brands or sizes, return empty
    if (brands.length === 0 && sizes.length === 0) {
      setArticles([]);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Build filters from personalization data
      const filters: any = {
        excludeUserId: user.id, // Don't show user's own articles
      };

      if (brands.length > 0) {
        filters.brands = brands;
      }

      if (sizes.length > 0) {
        filters.sizes = sizes;
      }

      const { articles: results } = await ArticlesService.searchArticles(
        undefined, // No text query
        filters,
        limit
      );

      setArticles(results);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Erreur de chargement';
      setError(errorMessage);
      console.error('Error fetching personalized feed:', err);
    } finally {
      setIsLoading(false);
    }
  }, [user, limit, getPersonalizationData]);

  useEffect(() => {
    fetchPersonalizedFeed();
  }, [fetchPersonalizedFeed]);

  return {
    articles,
    isLoading,
    error,
    styleTags,
    hasProfile,
    refresh: fetchPersonalizedFeed,
  };
}

export default usePersonalizedFeed;
