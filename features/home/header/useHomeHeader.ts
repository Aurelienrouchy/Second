/**
 * useHomeHeader Hook
 * Encapsulates all header interactions: search, camera, visual search, category press
 */

import { useCallback, useState } from 'react';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';

import { track } from '@/lib/analytics';

export function useHomeHeader() {
  const [showVisualSearch, setShowVisualSearch] = useState(false);

  const handleSearchBarPress = useCallback(() => {
    router.push({ pathname: '/search', params: { source: 'home_header' } });
  }, []);

  const handleCameraPress = useCallback(() => {
    track('visual_search_opened', { source: 'home' });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setShowVisualSearch(true);
  }, []);

  const handleVisualSearchCapture = useCallback((imageUri: string) => {
    setShowVisualSearch(false);
    router.push({
      pathname: '/visual-search-results',
      params: { imageUri },
    });
  }, []);

  const handleCategoryPress = useCallback((categoryId: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push({
      pathname: '/search',
      params: { category: categoryId, source: 'home_quick_category' },
    });
  }, []);

  return {
    showVisualSearch,
    setShowVisualSearch,
    handleSearchBarPress,
    handleCameraPress,
    handleVisualSearchCapture,
    handleCategoryPress,
  };
}
