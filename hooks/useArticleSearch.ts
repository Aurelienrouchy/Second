import { useInfiniteQuery } from '@tanstack/react-query';
import { QueryDocumentSnapshot } from 'firebase/firestore';
import { useCallback, useMemo, useState } from 'react';

import { useDebounce } from '@/hooks/useDebounce';
import { queryKeys } from '@/lib/queryKeys';
import { ArticlesService } from '@/services/articlesService';
import { Article, ArticleWithLocation, SearchFilters, SortBy } from '@/types';

const SEARCH_DEBOUNCE_MS = 350;
const PAGE_SIZE = 20;
const SEARCH_STALE_TIME = 5 * 60 * 1000;

interface GeolocationCenter {
  lat: number;
  lon: number;
}

interface UseArticleSearchArgs {
  initialFilters?: Partial<SearchFilters>;
  initialQuery?: string;
  initialCategoryPath?: string[];
  center?: GeolocationCenter;
  excludeUserId?: string;
}

interface SearchPage {
  articles: Article[];
  lastVisible: QueryDocumentSnapshot | null;
}

const calculateDistance = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number => {
  const R = 6371;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

function transformArticlesWithLocation(
  articles: Article[],
  center?: GeolocationCenter
): ArticleWithLocation[] {
  return articles.map((article) => {
    const { location: articleLocation, ...restArticle } = article;
    const articleWithLocation: ArticleWithLocation = restArticle;

    if (center && articleLocation && typeof articleLocation === 'object') {
      const location = articleLocation as { lat?: number; lon?: number; address?: string };
      if (location.lat && location.lon) {
        const distance = calculateDistance(
          center.lat,
          center.lon,
          location.lat,
          location.lon
        );
        articleWithLocation.location = {
          lat: location.lat,
          lon: location.lon,
          distance,
          address: location.address,
        };
      }
    }

    return articleWithLocation;
  });
}

function sortArticles(
  articles: ArticleWithLocation[],
  sortBy: SortBy | undefined,
  center?: GeolocationCenter
): ArticleWithLocation[] {
  return [...articles].sort((a, b) => {
    if (center && a.location?.distance !== undefined && b.location?.distance !== undefined) {
      const distanceDiff = a.location.distance - b.location.distance;
      if (Math.abs(distanceDiff) > 0.1) {
        return distanceDiff;
      }
    }

    if (sortBy === 'price_asc' && a.price !== undefined && b.price !== undefined) {
      return a.price - b.price;
    }
    if (sortBy === 'price_desc' && a.price !== undefined && b.price !== undefined) {
      return b.price - a.price;
    }
    if (sortBy === 'popular') {
      return (b.likes || 0) - (a.likes || 0);
    }

    return b.createdAt.getTime() - a.createdAt.getTime();
  });
}

const DEFAULT_FILTERS: SearchFilters = {
  colors: [],
  sizes: [],
  materials: [],
  condition: undefined,
  minPrice: undefined,
  maxPrice: undefined,
  brands: [],
  patterns: [],
  sortBy: 'recent',
};

export function useArticleSearch({
  initialFilters,
  initialQuery,
  initialCategoryPath,
  center,
  excludeUserId,
}: UseArticleSearchArgs = {}) {
  const [searchQuery, setSearchQuery] = useState<string>(initialQuery || '');
  const debouncedSearchQuery = useDebounce(searchQuery, SEARCH_DEBOUNCE_MS);

  const [selectedCategoryPath, setSelectedCategoryPath] = useState<string[]>(
    initialCategoryPath || []
  );
  const [filters, setFilters] = useState<SearchFilters>({
    ...DEFAULT_FILTERS,
    ...(initialFilters || {}),
  } as SearchFilters);

  const searchFilters = useMemo(
    () => ({
      category: undefined,
      categoryIds:
        selectedCategoryPath.length > 0 ? selectedCategoryPath : undefined,
      colors: filters.colors ?? [],
      sizes: filters.sizes ?? [],
      materials: filters.materials ?? [],
      condition: filters.condition,
      minPrice: filters.minPrice,
      maxPrice: filters.maxPrice,
      brands: filters.brands ?? [],
      patterns: filters.patterns ?? [],
      sortBy: filters.sortBy as SortBy | undefined,
      excludeUserId,
    }),
    [filters, selectedCategoryPath, excludeUserId]
  );

  const queryKey = useMemo(
    () =>
      queryKeys.articles.search({
        query: debouncedSearchQuery.trim(),
        categoryPath: selectedCategoryPath,
        filters: searchFilters as unknown as Record<string, unknown>,
        excludeUserId,
      }),
    [debouncedSearchQuery, selectedCategoryPath, searchFilters, excludeUserId]
  );

  const {
    data,
    isLoading,
    isFetchingNextPage,
    fetchNextPage,
    hasNextPage,
    error: queryError,
  } = useInfiniteQuery<SearchPage, Error>({
    queryKey,
    queryFn: async ({ pageParam }) => {
      const cursor = pageParam as QueryDocumentSnapshot | undefined;
      const result = await ArticlesService.searchArticles(
        debouncedSearchQuery.trim() || undefined,
        searchFilters,
        PAGE_SIZE,
        cursor
      );
      return {
        articles: result.articles,
        lastVisible: result.lastVisible,
      };
    },
    initialPageParam: undefined as QueryDocumentSnapshot | undefined,
    getNextPageParam: (lastPage) =>
      lastPage.lastVisible ? lastPage.lastVisible : undefined,
    staleTime: SEARCH_STALE_TIME,
    retry: 3,
  });

  const articles = useMemo(() => {
    if (!data?.pages) return [];
    const flat = data.pages.flatMap((page) => page.articles);
    const transformed = transformArticlesWithLocation(flat, center);
    return sortArticles(transformed, filters.sortBy, center);
  }, [data, center, filters.sortBy]);

  const loadMore = useCallback(() => {
    if (!isFetchingNextPage && hasNextPage) {
      fetchNextPage();
    }
  }, [isFetchingNextPage, hasNextPage, fetchNextPage]);

  const hasActiveFilters = useMemo(
    () =>
      (filters.colors?.length ?? 0) > 0 ||
      (filters.sizes?.length ?? 0) > 0 ||
      (filters.materials?.length ?? 0) > 0 ||
      (filters.brands?.length ?? 0) > 0 ||
      (filters.patterns?.length ?? 0) > 0 ||
      !!filters.condition ||
      filters.minPrice !== undefined ||
      filters.maxPrice !== undefined ||
      !!filters.sortBy ||
      selectedCategoryPath.length > 0,
    [filters, selectedCategoryPath]
  );

  const setFiltersSafe = useCallback((partial: Partial<SearchFilters>) => {
    setFilters({
      colors: partial.colors ?? [],
      sizes: partial.sizes ?? [],
      materials: partial.materials ?? [],
      condition: partial.condition,
      minPrice: partial.minPrice,
      maxPrice: partial.maxPrice,
      brands: partial.brands ?? [],
      patterns: partial.patterns ?? [],
      sortBy: partial.sortBy ?? 'recent',
    });
  }, []);

  const clearAllFilters = useCallback(() => {
    setFilters({ ...DEFAULT_FILTERS });
  }, []);

  const handleFilterRemove = useCallback(
    (filterType: keyof SearchFilters, value?: string) => {
      if (filterType === 'colors' && value) {
        setFilters((prev) => ({
          ...prev,
          colors: (prev.colors ?? []).filter((c) => c !== value),
        }));
      } else if (filterType === 'sizes' && value) {
        setFilters((prev) => ({
          ...prev,
          sizes: (prev.sizes ?? []).filter((s) => s !== value),
        }));
      } else if (filterType === 'materials' && value) {
        setFilters((prev) => ({
          ...prev,
          materials: (prev.materials ?? []).filter((m) => m !== value),
        }));
      } else if (filterType === 'brands' && value) {
        setFilters((prev) => ({
          ...prev,
          brands: (prev.brands ?? []).filter((b) => b !== value),
        }));
      } else if (filterType === 'patterns' && value) {
        setFilters((prev) => ({
          ...prev,
          patterns: (prev.patterns ?? []).filter((p) => p !== value),
        }));
      } else if (filterType === 'condition') {
        setFilters((prev) => ({ ...prev, condition: undefined }));
      } else if (filterType === 'minPrice') {
        setFilters((prev) => ({ ...prev, minPrice: undefined }));
      } else if (filterType === 'maxPrice') {
        setFilters((prev) => ({ ...prev, maxPrice: undefined }));
      }
    },
    []
  );

  return {
    articles,
    filters,
    searchQuery,
    selectedCategoryPath,
    isLoading,
    isPaginating: isFetchingNextPage,
    hasActiveFilters,
    error: queryError ? queryError.message : null,
    setFilters: setFiltersSafe,
    setSearchQuery,
    setSelectedCategoryPath,
    loadMore,
    clearAllFilters,
    handleFilterRemove,
  };
}

export type UseArticleSearchReturn = ReturnType<typeof useArticleSearch>;

export const useUserLocation = () => {
  const [location, setLocation] = useState<GeolocationCenter | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);

  return { location, locationError };
};
