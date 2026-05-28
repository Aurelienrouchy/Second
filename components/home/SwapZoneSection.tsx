/**
 * SwapZoneSection Component (presentational)
 * Single, always-active "Swap Zone" hero card — image-driven.
 *
 * The Swap Zone is a permanent generalist zone (no time window, no theme,
 * no countdown). Instead of a temporal hook, this card sells entry through
 * a preview of the zone's REAL stock (a collage of recent item thumbnails),
 * a prominent available-items counter, an optional freshness signal, and a
 * clear CTA.
 *
 * States:
 * - full   : collage of up to 6 item images + counter + CTA
 * - empty  : inviting teaser (icon + hook + CTA) — never a sad flat rectangle
 * - loading: light skeleton (collage tiles + text lines)
 *
 * This component is purely presentational: data is fetched by the feature
 * wrapper (features/home/swap-zone) and passed down as props.
 */

import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Animated, {
  FadeInDown,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { colors, spacing, typography, radius, sizing, fonts, shadows } from '@/constants/theme';
import { SwapPartyItem } from '@/types';

// =============================================================================
// TYPES
// =============================================================================

interface SwapZoneInfo {
  id: string;
  name: string;
  itemsCount?: number;
}

interface SwapZoneSectionProps {
  zone?: SwapZoneInfo;
  items?: SwapPartyItem[];
  itemsCount?: number;
  newThisWeek?: number;
  isLoading?: boolean;
  onPress?: () => void;
  testID?: string;
}

// =============================================================================
// CONSTANTS
// =============================================================================

// Bottom scrim so overlaid copy stays legible over the image collage.
const SCRIM_GRADIENT = ['transparent', 'rgba(26, 24, 20, 0.85)'] as const;

const MAX_TILES = 6;

// =============================================================================
// PRESS WRAPPER (shared press-scale + haptic)
// =============================================================================

interface PressCardProps {
  onPress: () => void;
  children: React.ReactNode;
}

const PressCard: React.FC<PressCardProps> = ({ onPress, children }) => {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = () => {
    scale.value = withTiming(0.98, { duration: 150, easing: Easing.out(Easing.ease) });
  };

  const handlePressOut = () => {
    scale.value = withTiming(1, { duration: 200, easing: Easing.out(Easing.ease) });
  };

  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress();
  };

  return (
    // Outer wrapper owns the layout animation (FadeInDown).
    // Inner Animated.View owns the press-scale transform — splitting
    // them avoids 'transform may be overwritten by a layout animation'.
    <Animated.View entering={FadeInDown.duration(400).delay(100)}>
      <Animated.View style={[styles.cardShadow, animatedStyle]}>
        <Pressable
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
          onPress={handlePress}
        >
          {children}
        </Pressable>
      </Animated.View>
    </Animated.View>
  );
};

// =============================================================================
// SHARED — CTA row
// =============================================================================

interface CtaRowProps {
  light?: boolean;
}

const CtaRow: React.FC<CtaRowProps> = ({ light = false }) => (
  <View style={styles.ctaRow}>
    <Text style={[styles.ctaText, light && styles.ctaTextLight]}>
      Entrer dans la Swap Zone
    </Text>
    <View style={[styles.ctaChevron, light && styles.ctaChevronLight]}>
      <Ionicons
        name="arrow-forward"
        size={sizing.iconSM}
        color={light ? colors.cream : colors.charcoal}
      />
    </View>
  </View>
);

// =============================================================================
// FULL STATE — image-driven hero
// =============================================================================

interface FullCardProps {
  items: SwapPartyItem[];
  itemsCount: number;
  newThisWeek: number;
  onPress: () => void;
}

const FullCard: React.FC<FullCardProps> = ({ items, itemsCount, newThisWeek, onPress }) => {
  const tiles = items.slice(0, MAX_TILES);

  return (
    <PressCard onPress={onPress}>
      <View style={styles.card}>
        {/* Image collage — the real stock preview */}
        <View style={styles.collage}>
          {tiles.map((item) => (
            <View key={item.id} style={styles.tile}>
              {item.imageUrl ? (
                <Image
                  source={item.imageUrl}
                  style={styles.tileImage}
                  contentFit="cover"
                  transition={200}
                  recyclingKey={item.id}
                />
              ) : (
                <View style={[styles.tileImage, styles.tileFallback]} />
              )}
            </View>
          ))}
        </View>

        {/* Scrim for legibility */}
        <LinearGradient
          colors={SCRIM_GRADIENT}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />

        {/* Overlaid editorial content */}
        <View style={styles.fullContent}>
          <View style={styles.eyebrowRow}>
            <View style={styles.statusDot} />
            <Text style={styles.eyebrow}>Échange ouvert</Text>
          </View>

          <View style={styles.fullBottom}>
            <View style={styles.countBlock}>
              <View style={styles.countPill}>
                <Ionicons
                  name="swap-horizontal"
                  size={sizing.iconSM}
                  color={colors.cream}
                />
                <Text style={styles.countPillText}>
                  +{itemsCount} articles à échanger
                </Text>
              </View>
              {newThisWeek > 0 ? (
                <Text style={styles.freshText}>
                  {newThisWeek} nouveau{newThisWeek > 1 ? 'x' : ''} cette semaine
                </Text>
              ) : null}
            </View>

            <CtaRow light />
          </View>
        </View>
      </View>
    </PressCard>
  );
};

// =============================================================================
// EMPTY STATE — inviting teaser
// =============================================================================

const EmptyCard: React.FC<{ onPress: () => void }> = ({ onPress }) => (
  <PressCard onPress={onPress}>
    <LinearGradient
      colors={[colors.cream, colors.sandLight]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[styles.card, styles.emptyCard]}
    >
      <View style={styles.emptyIconCircle}>
        <Ionicons
          name="swap-horizontal"
          size={sizing.iconLG}
          color={colors.secondary}
        />
      </View>
      <Text style={styles.emptyTitle}>Échange tes pièces, sans frais</Text>
      <Text style={styles.emptySubtitle}>
        Dépose un article et trouve la pièce parfaite à troquer.
      </Text>
      <CtaRow />
    </LinearGradient>
  </PressCard>
);

// =============================================================================
// LOADING STATE — light skeleton
// =============================================================================

const LoadingCard: React.FC = () => (
  <View style={[styles.card, styles.skeletonCard]}>
    <View style={styles.skeletonCollage}>
      {Array.from({ length: 3 }).map((_, i) => (
        <View key={i} style={styles.skeletonTile} />
      ))}
    </View>
    <View style={styles.skeletonLines}>
      <View style={[styles.skeletonLine, styles.skeletonLineWide]} />
      <View style={[styles.skeletonLine, styles.skeletonLineNarrow]} />
    </View>
  </View>
);

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export const SwapZoneSection: React.FC<SwapZoneSectionProps> = ({
  zone,
  items = [],
  itemsCount = 0,
  newThisWeek = 0,
  isLoading = false,
  onPress = () => {},
  testID,
}) => {
  const hasItems = items.length > 0;

  return (
    <View style={styles.container} testID={testID}>
      {isLoading && !zone ? (
        <LoadingCard />
      ) : hasItems ? (
        <FullCard
          items={items}
          itemsCount={itemsCount}
          newThisWeek={newThisWeek}
          onPress={onPress}
        />
      ) : (
        // No items (or error fallback): inviting teaser, never a sad rectangle.
        <EmptyCard onPress={onPress} />
      )}
    </View>
  );
};

// =============================================================================
// STYLES
// =============================================================================

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  cardShadow: {
    borderRadius: radius.lg,
    backgroundColor: colors.dark,
    ...shadows.elevated,
  },
  card: {
    borderRadius: radius.lg,
    overflow: 'hidden',
    minHeight: 220,
    backgroundColor: colors.dark,
  },

  // --- Full state: collage ---
  collage: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  tile: {
    width: '33.333%',
    height: '50%',
  },
  tileImage: {
    flex: 1,
    backgroundColor: colors.surfaceWarm,
  },
  tileFallback: {
    backgroundColor: colors.secondaryLight,
  },

  // --- Full state: overlaid content ---
  fullContent: {
    flex: 1,
    padding: spacing.lg,
    justifyContent: 'space-between',
  },
  eyebrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.xs,
    backgroundColor: colors.overlay,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: radius.full,
    backgroundColor: colors.success,
  },
  eyebrow: {
    fontFamily: typography.labelUppercase.fontFamily,
    fontSize: typography.labelUppercase.fontSize,
    lineHeight: typography.labelUppercase.lineHeight,
    letterSpacing: typography.labelUppercase.letterSpacing,
    color: colors.cream,
    textTransform: 'uppercase',
  },
  fullBottom: {
    gap: spacing.md,
  },
  countBlock: {
    gap: spacing.xs,
  },
  countPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.xs,
    backgroundColor: colors.rust,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
  },
  countPillText: {
    fontFamily: typography.label.fontFamily,
    fontSize: typography.label.fontSize,
    lineHeight: typography.label.lineHeight,
    color: colors.cream,
  },
  freshText: {
    fontFamily: typography.caption.fontFamily,
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    letterSpacing: typography.caption.letterSpacing,
    color: colors.cream,
    paddingLeft: spacing.xs,
  },

  // --- Shared CTA ---
  ctaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.cream,
    paddingLeft: spacing.lg,
    paddingRight: spacing.sm,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
  },
  ctaText: {
    fontFamily: typography.button.fontFamily,
    fontSize: typography.button.fontSize,
    lineHeight: typography.button.lineHeight,
    letterSpacing: typography.button.letterSpacing,
    color: colors.charcoal,
    textTransform: 'uppercase',
  },
  ctaTextLight: {
    color: colors.charcoal,
  },
  ctaChevron: {
    width: 32,
    height: 32,
    borderRadius: radius.full,
    backgroundColor: colors.sand,
    justifyContent: 'center',
    alignItems: 'center',
  },
  ctaChevronLight: {
    backgroundColor: colors.rust,
  },

  // --- Empty state ---
  emptyCard: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
  },
  emptyIconCircle: {
    width: sizing.avatarLG,
    height: sizing.avatarLG,
    borderRadius: radius.full,
    backgroundColor: colors.secondaryLight,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  emptyTitle: {
    fontFamily: fonts.displayMedium,
    fontSize: typography.h2.fontSize,
    lineHeight: typography.h2.lineHeight,
    letterSpacing: typography.h2.letterSpacing,
    color: colors.charcoal,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontFamily: typography.body.fontFamily,
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: colors.foregroundSecondary,
    textAlign: 'center',
    marginBottom: spacing.sm,
    maxWidth: 280,
  },

  // --- Loading skeleton ---
  skeletonCard: {
    backgroundColor: colors.surfaceWarm,
    padding: spacing.lg,
    justifyContent: 'space-between',
  },
  skeletonCollage: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  skeletonTile: {
    flex: 1,
    height: 90,
    borderRadius: radius.md,
    backgroundColor: colors.borderLight,
  },
  skeletonLines: {
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  skeletonLine: {
    height: 16,
    borderRadius: radius.sm,
    backgroundColor: colors.borderLight,
  },
  skeletonLineWide: {
    width: '60%',
  },
  skeletonLineNarrow: {
    width: '35%',
  },
});

export default SwapZoneSection;
