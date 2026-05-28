import React, { useCallback, useState } from 'react';
import { LayoutChangeEvent, StyleSheet } from 'react-native';
import Animated, {
  useAnimatedStyle,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import { colors, fonts, spacing, animations } from '@/constants/theme';

/**
 * OfflineBanner — slides down from the top when the device loses connectivity.
 *
 * Position: absolute, overlays content. Accounts for the safe-area inset so the
 * text sits below the notch / status bar. Does not push layout content down.
 *
 * Animates in/out via react-native-reanimated translateY.
 */
function OfflineBannerInner() {
  const { isConnected, isInternetReachable } = useNetworkStatus();
  const insets = useSafeAreaInsets();
  const [bannerHeight, setBannerHeight] = useState(0);

  const isOffline = !isConnected || !isInternetReachable;

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    setBannerHeight(e.nativeEvent.layout.height);
  }, []);

  const animatedStyle = useAnimatedStyle(() => {
    const hideOffset = bannerHeight > 0 ? -bannerHeight : -100;
    return {
      transform: [
        {
          translateY: withTiming(isOffline ? 0 : hideOffset, {
            duration: animations.duration.normal,
            easing: Easing.inOut(Easing.ease),
          }),
        },
      ],
    };
  }, [isOffline, bannerHeight]);

  return (
    <Animated.View
      onLayout={onLayout}
      style={[
        styles.container,
        { paddingTop: insets.top + spacing.xs },
        animatedStyle,
      ]}
      pointerEvents="none"
      accessibilityRole="alert"
      accessibilityLiveRegion="assertive"
      accessibilityLabel="Vous êtes hors connexion"
    >
      <Ionicons
        name="cloud-offline-outline"
        size={16}
        color={colors.white}
        style={styles.icon}
      />
      <Animated.Text style={styles.text}>
        Vous êtes hors connexion
      </Animated.Text>
    </Animated.View>
  );
}

export const OfflineBanner = React.memo(OfflineBannerInner);

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 9999,
    backgroundColor: colors.dark,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: spacing.sm,
  },
  icon: {
    marginRight: spacing.xs,
  },
  text: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: 0.2,
    color: colors.white,
  },
});
