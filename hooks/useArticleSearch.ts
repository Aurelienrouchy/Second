import { ArticlesService } from '@/services/articlesService';
import { Article, ArticleWithLocation, SearchFilters, SortBy } from '@/types';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

interface GeolocationCenter {
  lat: number;
  lon: number;
}

interface UseArticleSearchArgs {
  initialFilters?: Partial<SearchFilters>;
  initialQuery?: string;
  initialCategoryPath?: string[];
  center?: GeolocationCenter;
  enableRetry?: boolean;
  maxRetries?: number;
  excludeUserId?: string;
}

// Utility function to calculate distance between two points (Haversine formula)
const calculateDistance = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number => {
  const R = 6371; // Earth's radius in kilometers
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

// Retry utility with exponential backoff
const retryWithBackoff = async <T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> => {
  let lastError: Error;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      
      if (attempt === maxRetries) {
        throw lastError;
      }
      
      // Exponential backoff with jitter
      const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 1000;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError!;
};

export function useArticleSearch({ 
  initialFilters, 
  initialQuery, 
  initialCategoryPath,
  center,
  enableRetry = true,
  maxRetries = 3,
  excludeUserId
}: UseArticleSearchArgs = {}) {
  const [searchQuery, setSearchQuery] = useState<string>(initialQuery || '');
  const [selectedCategoryPath, setSelectedCategoryPath] = useState<string[]>(initialCategoryPath || []);
  const [filters, setFilters] = useState<SearchFilters>({
    colors: [],
    sizes: [],
    materials: [],
    condition: undefined,
    minPrice: undefined,
    maxPrice: undefined,
    brands: [],
    patterns: [],
    sortBy: 'recent',
    ...(initialFilters || {}),
  } as SearchFilters);

  const [articles, setArticles] = useState<ArticleWithLocation[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isPaginating, setIsPaginating] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const lastVisibleRef = useRef<any | null>(null);

  const hasActiveFilters = useMemo(() => (
    filters.colors.length > 0 ||
    filters.sizes.length > 0 ||
    filters.materials.length > 0 ||
    (filters.brands && filters.brands.length > 0) ||
    (filters.patterns && filters.patterns.length > 0) ||
    !!filters.condition ||
    filters.minPrice !== undefined ||
    filters.maxPrice !== undefined ||
    !!filters.sortBy ||
    selectedCategoryPath.length > 0
  ), [filters, selectedCategoryPath]);

  const buildSearchFilters = useCallback(() => ({
    category: undefined, // Legacy: we don't use string path anymore
    categoryIds: selectedCategoryPath.length > 0 ? selectedCategoryPath : undefined, // Use array of IDs
    colors: filters.colors,
    sizes: filters.sizes,
    materials: filters.materials,
    condition: filters.condition,
    minPrice: filters.minPrice,
    maxPrice: filters.maxPrice,
    brands: filters.brands,
    patterns: filters.patterns,
    sortBy: filters.sortBy as SortBy | undefined,
    excludeUserId: excludeUserId,
  }), [filters, selectedCategoryPath, excludeUserId]);

  // Transform articles with geolocation data
  const transformArticlesWithLocation = useCallback((articles: Article[]): ArticleWithLocation[] => {
    return articles.map(article => {
      const { location: articleLocation, ...restArticle } = article;
      const articleWithLocation: ArticleWithLocation = restArticle;
      
      // Calculate distance if center is provided and article has location
      if (center && articleLocation && typeof articleLocation === 'object') {
        const location = articleLocation as any;
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
  }, [center]);

  // Sort articles based on criteria
  const sortArticles = useCallback((articles: ArticleWithLocation[]): ArticleWithLocation[] => {
    return [...articles].sort((a, b) => {
      // If we have geolocation, sort by distance first
      if (center && a.location?.distance !== undefined && b.location?.distance !== undefined) {
        const distanceDiff = a.location.distance - b.location.distance;
        if (Math.abs(distanceDiff) > 0.1) { // 100m threshold
          return distanceDiff;
        }
      }

      // Fallback to creation date (newest first) or sortBy preference
      if (filters.sortBy === 'price_asc' && a.price !== undefined && b.price !== undefined) {
        return a.price - b.price;
      }
      if (filters.sortBy === 'price_desc' && a.price !== undefined && b.price !== undefined) {
        return b.price - a.price;
      }
      if (filters.sortBy === 'popular') {
        return (b.likes || 0) - (a.likes || 0);
      }
      
      // Default: recent
      return b.createdAt.getTime() - a.createdAt.getTime();
    });
  }, [center, filters.sortBy]);

  const search = useCallback(async (reset: boolean = true) => {
    if (reset) {
      lastVisibleRef.current = null;
      setArticles([]);
    }
    setIsLoading(true);
    setError(null);
    
    try {
      const fetchFn = async () => {
        return await ArticlesService.searchArticles(
          searchQuery.trim() || undefined,
          buildSearchFilters(),
          20,
          reset ? undefined : lastVisibleRef.current || undefined
        );
      };

      // Apply retry logic if enabled
      const { articles: results, lastVisible } = enableRetry
        ? await retryWithBackoff(fetchFn, maxRetries)
        : await fetchFn();

      // Transform articles with geolocation
      const transformedArticles = transformArticlesWithLocation(results);
      
      // Sort articles (including by distance if center is provided)
      const sortedArticles = sortArticles(transformedArticles);

      setArticles(prev => reset ? sortedArticles : [...prev, ...sortedArticles]);
      lastVisibleRef.current = lastVisible;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Une erreur est survenue';
      setError(errorMessage);
      console.error('Error searching articles:', error);
    } finally {
      setIsLoading(false);
    }
  }, [searchQuery, buildSearchFilters, enableRetry, maxRetries, transformArticlesWithLocation, sortArticles]);

  const loadMore = useCallback(async () => {
    if (isPaginating || isLoading || !lastVisibleRef.current) return;
    setIsPaginating(true);
    setError(null);
    
    try {
      const fetchFn = async () => {
        return await ArticlesService.searchArticles(
          searchQuery.trim() || undefined,
          buildSearchFilters(),
          20,
          lastVisibleRef.current
        );
      };

      // Apply retry logic if enabled
      const { articles: results, lastVisible } = enableRetry
        ? await retryWithBackoff(fetchFn, maxRetries)
        : await fetchFn();

      if (results.length > 0) {
        // Transform articles with geolocation
        const transformedArticles = transformArticlesWithLocation(results);
        
        // Sort articles (including by distance if center is provided)
        const sortedArticles = sortArticles(transformedArticles);
        
        setArticles(prev => [...prev, ...sortedArticles]);
        lastVisibleRef.current = lastVisible;
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Une erreur est survenue';
      setError(errorMessage);
      console.error('Error loading more articles:', error);
    } finally {
      setIsPaginating(false);
    }
  }, [isLoading, isPaginating, searchQuery, buildSearchFilters, enableRetry, maxRetries, transformArticlesWithLocation, sortArticles]);

  // Single effect to handle both initial load and filter changes
  useEffect(() => {
    console.log('🔄 useArticleSearch: Déclenchement de la recherche');
    search(true);
  }, [filters, selectedCategoryPath, searchQuery]);

  const clearAllFilters = useCallback(() => {
    setFilters({
      colors: [],
      sizes: [],
      materials: [],
      condition: undefined,
      minPrice: undefined,
      maxPrice: undefined,
      brands: [],
      patterns: [],
      sortBy: 'recent',
    });
  }, []);

  const handleFilterRemove = useCallback((filterType: keyof SearchFilters, value?: string) => {
    if (filterType === 'colors' && value) {
      setFilters(prev => ({ ...prev, colors: prev.colors.filter(c => c !== value) }));
    } else if (filterType === 'sizes' && value) {
      setFilters(prev => ({ ...prev, sizes: prev.sizes.filter(s => s !== value) }));
    } else if (filterType === 'materials' && value) {
      setFilters(prev => ({ ...prev, materials: prev.materials.filter(m => m !== value) }));
    } else if (filterType === 'brands' && value) {
      setFilters(prev => ({ ...prev, brands: (prev.brands || []).filter(b => b !== value) }));
    } else if (filterType === 'patterns' && value) {
      setFilters(prev => ({ ...prev, patterns: (prev.patterns || []).filter(p => p !== value) }));
    } else if (filterType === 'condition') {
      setFilters(prev => ({ ...prev, condition: undefined }));
    } else if (filterType === 'minPrice') {
      setFilters(prev => ({ ...prev, minPrice: undefined }));
    } else if (filterType === 'maxPrice') {
      setFilters(prev => ({ ...prev, maxPrice: undefined }));
    }
  }, []);

  return {
    // state
    articles,
    filters,
    searchQuery,
    selectedCategoryPath,
    isLoading,
    isPaginating,
    hasActiveFilters,
    error,
    // setters
    setFilters,
    setSearchQuery,
    setSelectedCategoryPath,
    // actions
    search,
    loadMore,
    clearAllFilters,
    handleFilterRemove,
  };
}

export type UseArticleSearchReturn = ReturnType<typeof useArticleSearch>;

// Hook for getting user's current location
// Note: Install expo-location and uncomment implementation when needed
export const useUserLocation = () => {
  const [location, setLocation] = useState<GeolocationCenter | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);

  useEffect(() => {
    // TODO: Implement with expo-location
    // const getCurrentLocation = async () => {
    //   try {
    //     const { status } = await Location.requestForegroundPermissionsAsync();
    //     if (status !== 'granted') {
    //       setLocationError('Permission de localisation refusée');
    //       return;
    //     }
    //
    //     const currentLocation = await Location.getCurrentPositionAsync({
    //       accuracy: Location.Accuracy.Balanced,
    //     });
    //
    //     setLocation({
    //       lat: currentLocation.coords.latitude,
    //       lon: currentLocation.coords.longitude,
    //     });
    //   } catch (error) {
    //     setLocationError('Impossible d\'obtenir la localisation');
    //     console.error('Location error:', error);
    //   }
    // };
    //
    // getCurrentLocation();

    // For now, return null location (no geolocation sorting)
    setLocation(null);
  }, []);

  return { location, locationError };
};



