import { useCallback, useEffect, useState } from 'react';
import { AccessibilityInfo, AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';

/** A decorative marquee must stop when the home is hidden or motion is reduced. */
export function useTrocMosaicMotion() {
  const [isFocused, setIsFocused] = useState(false);
  const [isActive, setIsActive] = useState(AppState.currentState === 'active');
  // Keep the first frame still until the accessibility preference is known.
  const [reduceMotion, setReduceMotion] = useState(true);

  useFocusEffect(
    useCallback(() => {
      setIsFocused(true);
      return () => setIsFocused(false);
    }, []),
  );

  useEffect(() => {
    let mounted = true;
    let preferenceChanged = false;
    const motionSubscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      (enabled) => {
        preferenceChanged = true;
        setReduceMotion(enabled);
      },
    );
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (mounted && !preferenceChanged) setReduceMotion(enabled);
      })
      .catch(() => {
        // An unavailable setting keeps this purely decorative animation still.
      });
    const appStateSubscription = AppState.addEventListener('change', (state) => {
      setIsActive(state === 'active');
    });

    return () => {
      mounted = false;
      motionSubscription.remove();
      appStateSubscription.remove();
    };
  }, []);

  return isFocused && isActive && !reduceMotion;
}
