/**
 * AuthToggle — segmented control (« Se connecter » / « S'inscrire ») with a
 * sliding white pill.
 *
 * Stable across the signIn↔signUp switch: it stays mounted and only the pill
 * (and the text colours) animate, so toggling the mode never remounts the
 * chrome. The white pill GLIDES between the two tabs via a single animated
 * translateX driven by the `active` prop.
 *
 * Animation: withTiming + Easing.out only (project rule — no spring/bounce).
 * The pill width is measured at runtime from the inner track (onLayout), so no
 * magic width is hardcoded; the visual (surface fill + soft shadow) reuses the
 * exact tokens of the former `toggleTabActive` style.
 */

import React, { useEffect } from 'react';
import { LayoutChangeEvent, Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { colors, fonts, radius, spacing } from '@/constants/theme';

const TOGGLE_DURATION = 220;
// Inner padding of the track (matches `track.padding` below) — the pill insets
// by this on every side so it never overlaps the track border.
const TRACK_PADDING = 3;

export interface AuthToggleProps {
  active: 'signIn' | 'signUp';
  onSelect: (mode: 'signIn' | 'signUp') => void;
}

function AuthToggleComponent({ active, onSelect }: AuthToggleProps) {
  // Half of the inner (padded) track width — measured once via onLayout.
  const pillWidth = useSharedValue(0);
  // 0 → signIn (left), 1 → signUp (right). Drives both translateX and colours.
  const progress = useSharedValue(active === 'signUp' ? 1 : 0);

  useEffect(() => {
    progress.value = withTiming(active === 'signUp' ? 1 : 0, {
      duration: TOGGLE_DURATION,
      easing: Easing.out(Easing.cubic),
    });
  }, [active, progress]);

  // Plain JS event handler (not memoized): writing the shared value from a
  // layout callback is the canonical Reanimated pattern. Kept out of any hook
  // dependency array so it never trips the hooks immutability rule.
  const handleTrackLayout = (e: LayoutChangeEvent) => {
    const inner = e.nativeEvent.layout.width - TRACK_PADDING * 2;
    pillWidth.value = inner > 0 ? inner / 2 : 0;
  };

  const pillStyle = useAnimatedStyle(() => ({
    width: pillWidth.value,
    transform: [{ translateX: progress.value * pillWidth.value }],
  }));

  const signInTextStyle = useAnimatedStyle(() => ({
    color: interpolateColor(
      progress.value,
      [0, 1],
      [colors.foreground, colors.muted],
    ),
  }));

  const signUpTextStyle = useAnimatedStyle(() => ({
    color: interpolateColor(
      progress.value,
      [0, 1],
      [colors.muted, colors.foreground],
    ),
  }));

  return (
    <View style={styles.track} onLayout={handleTrackLayout}>
      <Animated.View style={[styles.pill, pillStyle]} pointerEvents="none" />
      <Pressable
        testID="auth-tab-signin"
        style={styles.tab}
        onPress={() => onSelect('signIn')}
        accessibilityRole="tab"
        accessibilityState={{ selected: active === 'signIn' }}
        accessibilityLabel="Se connecter"
      >
        <Animated.Text style={[styles.tabText, signInTextStyle]}>
          Se connecter
        </Animated.Text>
      </Pressable>
      <Pressable
        testID="auth-tab-signup"
        style={styles.tab}
        onPress={() => onSelect('signUp')}
        accessibilityRole="tab"
        accessibilityState={{ selected: active === 'signUp' }}
        accessibilityLabel="S'inscrire"
      >
        <Animated.Text style={[styles.tabText, signUpTextStyle]}>
          S&apos;inscrire
        </Animated.Text>
      </Pressable>
    </View>
  );
}

export const AuthToggle = React.memo(AuthToggleComponent);

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceWarm,
    borderRadius: radius.sm,
    padding: TRACK_PADDING,
    marginBottom: spacing.md,
  },
  // The sliding white pill — reuses the former `toggleTabActive` visual.
  pill: {
    position: 'absolute',
    top: TRACK_PADDING,
    left: TRACK_PADDING,
    bottom: TRACK_PADDING,
    backgroundColor: colors.surface,
    borderRadius: radius.xs,
    shadowColor: colors.charcoal,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 1,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: radius.xs,
  },
  tabText: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    letterSpacing: 0.3,
  },
});
