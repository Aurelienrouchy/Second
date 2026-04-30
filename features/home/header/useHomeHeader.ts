/**
 * useHomeHeader Hook
 * Encapsulates all header interactions: search, camera, visual search, category press
 */

import { useCallback, useState } from 'react';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';

export function useHomeHeader() {
  const [showVisualSearch, setShowVisualSearch] = useState(false);

  const handleSearchBarPress = useCallback(() => {
    router.push('/search');
  }, []);

  const handleCameraPress = useCallback(() => {
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
      params: { category: categoryId },
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
