import * as Location from 'expo-location';
import { useCallback, useEffect, useState } from 'react';

import { ArticlesService } from '@/services/articlesService';
import { Article, ArticleWithLocation } from '@/types';

interface GeolocationCenter {
  lat: number;
  lon: number;
}

interface UseNearbyArticlesOptions {
  excludeUserId?: string;
  maxDistance?: number; // in km
  limit?: number;
}

interface UseNearbyArticlesReturn {
  articles: ArticleWithLocation[];
  isLoading: boolean;
  error: string | null;
  location: GeolocationCenter | null;
  locationError: string | null;
  refresh: () => Promise<void>;
  requestLocation: () => Promise<void>;
}

// Haversine formula to calculate distance between two coordinates
const calculateDistance = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number => {
  const R = 6371; // Earth's radius in km
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

/**
 * Hook for fetching nearby articles based on user's location.
 * Handles location permissions and calculates distances.
 *
 * @example
 * ```tsx
 * const { articles, isLoading, location } = useNearbyArticles({
 *   excludeUserId: user?.id,
 *   maxDistance: 10,
 * });
 * ```
 */
export function useNearbyArticles({
  excludeUserId,
  maxDistance = 25, // Default 25km radius
  limit = 10,
}: UseNearbyArticlesOptions = {}): UseNearbyArticlesReturn {
  const [articles, setArticles] = useState<ArticleWithLocation[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [location, setLocation] = useState<GeolocationCenter | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [hasRequestedLocation, setHasRequestedLocation] = useState(false);

  // Request location permission and get current location
  const requestLocation = useCallback(async () => {
    try {
      setLocationError(null);

      const { status } = await Location.requestForegroundPermissionsAsync();

      if (status !== 'granted') {
        setLocationError('Permission de localisation refusée');
        return;
      }

      const currentLocation = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      setLocation({
        lat: currentLocation.coords.latitude,
        lon: currentLocation.coords.longitude,
      });

      setHasRequestedLocation(true);
    } catch (err) {
      setLocationError("Impossible d'obtenir la localisation");
      console.error('Location error:', err);
    }
  }, []);

  // Fetch nearby articles
  const fetchNearbyArticles = useCallback(async () => {
    if (!location) {
      setArticles([]);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // For now, we fetch all articles and filter by distance client-side
      // TODO: Implement server-side geolocation query with Firestore GeoHash
      const { articles: results } = await ArticlesService.searchArticles(
        undefined,
        {
          excludeUserId,
          sortBy: 'recent',
        },
        100 // Fetch more to filter by distance
      );

      // Transform and filter articles by distance
      const nearbyArticles: ArticleWithLocation[] = [];

      for (const article of results) {
        // Check if article has location data
        const articleLoc = article.location as any;
        if (articleLoc && typeof articleLoc === 'object' && articleLoc.lat && articleLoc.lon) {
          const distance = calculateDistance(
            location.lat,
            location.lon,
            articleLoc.lat,
            articleLoc.lon
          );

          // Only include articles within maxDistance
          if (distance <= maxDistance) {
            const { location: _, ...rest } = article;
            nearbyArticles.push({
              ...rest,
              location: {
                lat: articleLoc.lat,
                lon: articleLoc.lon,
                distance,
                address: articleLoc.address,
              },
            });
          }
        }
      }

      // Sort by distance (closest first)
      nearbyArticles.sort((a, b) => {
        const distA = a.location?.distance ?? Infinity;
        const distB = b.location?.distance ?? Infinity;
        return distA - distB;
      });

      // Limit results
      setArticles(nearbyArticles.slice(0, limit));
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Erreur de chargement';
      setError(errorMessage);
      console.error('Error fetching nearby articles:', err);
    } finally {
      setIsLoading(false);
    }
  }, [location, excludeUserId, maxDistance, limit]);

  // Request location on mount (if not already done)
  useEffect(() => {
    if (!hasRequestedLocation) {
      requestLocation();
    }
  }, [hasRequestedLocation, requestLocation]);

  // Fetch articles when location is available
  useEffect(() => {
    if (location) {
      fetchNearbyArticles();
    }
  }, [location, fetchNearbyArticles]);

  return {
    articles,
    isLoading,
    error,
    location,
    locationError,
    refresh: fetchNearbyArticles,
    requestLocation,
  };
}

export default useNearbyArticles;
