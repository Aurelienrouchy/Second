import { useAuth } from '@/contexts/AuthContext';
import { guestPreferencesService, ArticleMeta } from '@/services/guestPreferencesService';
import { useCallback, useRef } from 'react';

interface UseGuestTrackingReturn {
  trackView: (article: ArticleMeta) => void;
  trackSearch: (query: string) => void;
  trackLike: (article: ArticleMeta) => void;
  removeLike: (articleId: string) => void;
}

/**
 * Hook for tracking guest user behavior
 * Tracks article views (after 3 seconds), searches, and likes
 */
export function useGuestTracking(): UseGuestTrackingReturn {
  const { isGuest } = useAuth();
  const viewTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  /**
   * Track article view after 3 seconds of viewing
   */
  const trackView = useCallback((article: ArticleMeta) => {
    if (!isGuest) return;

    const articleId = article.id;

    // Clear any existing timer for this article
    const existingTimer = viewTimersRef.current.get(articleId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Set a new timer for 3 seconds
    const timer = setTimeout(async () => {
      try {
        await guestPreferencesService.trackView(article);
        viewTimersRef.current.delete(articleId);
      } catch (error) {
        console.error('Error tracking view:', error);
      }
    }, 3000);

    viewTimersRef.current.set(articleId, timer);
  }, [isGuest]);

  /**
   * Track search query
   */
  const trackSearch = useCallback(async (query: string) => {
    if (!isGuest) return;

    try {
      await guestPreferencesService.trackSearch(query);
    } catch (error) {
      console.error('Error tracking search:', error);
    }
  }, [isGuest]);

  /**
   * Track article like
   */
  const trackLike = useCallback(async (article: ArticleMeta) => {
    if (!isGuest) return;

    try {
      await guestPreferencesService.trackLike(article);
    } catch (error) {
      console.error('Error tracking like:', error);
    }
  }, [isGuest]);

  /**
   * Remove article like
   */
  const removeLike = useCallback(async (articleId: string) => {
    if (!isGuest) return;

    try {
      await guestPreferencesService.removeLike(articleId);
    } catch (error) {
      console.error('Error removing like:', error);
    }
  }, [isGuest]);

  return {
    trackView,
    trackSearch,
    trackLike,
    removeLike,
  };
}
