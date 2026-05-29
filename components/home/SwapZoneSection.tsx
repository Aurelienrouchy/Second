/**
 * SwapZoneSection Component (presentational) — Split éditorial layout
 *
 * The Swap Zone is a permanent generalist zone (no time window, no theme,
 * no countdown). This card sells entry through a "split éditorial" layout:
 * a TEXT block on the left (title + tagline + inline stats + CTA) and a
 * VERTICAL collage of 3 real item thumbnails on the right.
 *
 * Visual (option A): a cream card (colors.surfaceWarm) sitting on the
 * wrapper's charcoal band. Title + tagline in charcoal, the word "Zone"
 * in italic rust. Tiles have rounded corners on the cream surface.
 *
 *   ┌──────────────────────────────┐
 *   │ Swap Zone            ┌─────┐  │
 *   │ Échange tes pièces,  │ ▣   │  │
 *   │ sans frais.          │ ▣   │  │
 *   │                      │ ▣   │  │
 *   │ 234 articles · 12 n… └─────┘  │
 *   │  [ Entrer dans la zone → ]    │
 *   └──────────────────────────────┘
 *
 * States (driven by `zone` presence + `items` + `onPress`):
 * - full    : zone has items → text block + vertical collage + tappable CTA
 * - empty   : zone exists but has no items → inviting teaser, tappable CTA
 * - teaser  : no zone active (onPress absent) → same teaser but NON-interactive,
 *             no dead CTA — shows a "Bientôt disponible" label instead
 * - loading : light skeleton matching the split layout
 *
 * Interactivity is keyed off `onPress`: when the wrapper passes no handler
 * (no active zone) the card never renders a Pressable, so there is never a
 * button that does nothing.
 *
 * This component is purely presentational: data is fetched by the feature
 * wrapper (features/home/swap-zone) and passed down as props.
 */

import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Image } from 'expo-image';
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

// Vertical collage shows exactly 3 thumbnails.
const TILE_COUNT = 3;

// =============================================================================
// HELPERS — inline stats copy (FR, singular/plural, hide zero)
// =============================================================================

/**
 * Builds the inline stats line. Each stat is hidden when 0 (never "0 articles"
 * / "0 nouveautés"). When both are present they are joined by " · ".
 * Returns null when nothing to show.
 */
function buildStatsParts(itemsCount: number, newThisWeek: number): string[] {
  const parts: string[] = [];
  if (itemsCount > 0) {
    parts.push(`${itemsCount} ${itemsCount > 1 ? 'articles' : 'article'}`);
  }
  if (newThisWeek > 0) {
    parts.push(
      `${newThisWeek} ${newThisWeek > 1 ? 'nouveautés' : 'nouveauté'} cette semaine`,
    );
  }
  return parts;
}

// =============================================================================
// CARD SHELL (layout animation + optional press-scale/haptic)
// =============================================================================

interface CardShellProps {
  // When omitted, the shell is rendered non-interactive (no Pressable, no
  // press-scale, no haptic) — used for the "no active zone" teaser so we
  // never present a button that does nothing.
  onPress?: () => void;
  children: React.ReactNode;
}

const CardShell: React.FC<CardShellProps> = ({ onPress, children }) => {
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
    onPress?.();
  };

  // Outer wrapper owns the layout animation (FadeInDown).
  // Inner Animated.View owns the press-scale transform — splitting
  // them avoids 'transform may be overwritten by a layout animation'.
  if (!onPress) {
    return (
      <Animated.View entering={FadeInDown.duration(400).delay(100)}>
        <Animated.View style={styles.cardShadow}>{children}</Animated.View>
      </Animated.View>
    );
  }

  return (
    <Animated.View entering={FadeInDown.duration(400).delay(100)}>
      <Animated.View style={[styles.cardShadow, animatedStyle]}>
        <Pressable onPressIn={handlePressIn} onPressOut={handlePressOut} onPress={handlePress}>
          {children}
        </Pressable>
      </Animated.View>
    </Animated.View>
  );
};

// =============================================================================
// SHARED — Editorial title ("Swap" charcoal + "Zone" italic rust)
// =============================================================================

const ZoneTitle: React.FC = () => (
  <Text style={styles.title}>
    Swap <Text style={styles.titleAccent}>Zone</Text>
  </Text>
);

// =============================================================================
// SHARED — CTA row ("Entrer dans la zone →")
// =============================================================================

const CtaRow: React.FC = () => (
  <View style={styles.ctaRow}>
    <Text style={styles.ctaText}>Entrer dans la zone</Text>
    <Ionicons name="arrow-forward" size={sizing.iconSM} color={colors.cream} />
  </View>
);

// =============================================================================
// SHARED — "coming soon" label (non-interactive, replaces the CTA when there
// is no active zone so the card never shows a dead button)
// =============================================================================

const ComingSoonLabel: React.FC = () => (
  <View style={styles.comingSoonRow}>
    <Ionicons name="time-outline" size={sizing.iconSM} color={colors.secondary} />
    <Text style={styles.comingSoonText}>Bientôt disponible</Text>
  </View>
);

// =============================================================================
// SHARED — Vertical collage tile (with clean image fallback)
// =============================================================================

const CollageTile: React.FC<{ item?: SwapPartyItem }> = ({ item }) => (
  <View style={styles.tile}>
    {item?.imageUrl ? (
      <Image
        source={item.imageUrl}
        style={styles.tileImage}
        contentFit="cover"
        transition={200}
        recyclingKey={item.id}
      />
    ) : (
      <View style={[styles.tileImage, styles.tileFallback]}>
        <Ionicons name="shirt-outline" size={sizing.iconMD} color={colors.muted} />
      </View>
    )}
  </View>
);

// =============================================================================
// FULL STATE — split editorial (text left, vertical collage right)
// =============================================================================

interface FullCardProps {
  items: SwapPartyItem[];
  itemsCount: number;
  newThisWeek: number;
  onPress: () => void;
}

const FullCard: React.FC<FullCardProps> = ({ items, itemsCount, newThisWeek, onPress }) => {
  const tiles = items.slice(0, TILE_COUNT);
  const statsParts = buildStatsParts(itemsCount, newThisWeek);

  return (
    <CardShell onPress={onPress}>
      <View style={styles.card}>
        {/* Left — editorial text block */}
        <View style={styles.textBlock}>
          <ZoneTitle />
          <Text style={styles.tagline}>Échange tes pièces, sans frais.</Text>

          {statsParts.length > 0 ? (
            <Text style={styles.statsLine} numberOfLines={1}>
              {statsParts.join('  ·  ')}
            </Text>
          ) : null}

          <CtaRow />
        </View>

        {/* Right — vertical collage of 3 real thumbnails */}
        <View style={styles.collage}>
          {Array.from({ length: TILE_COUNT }).map((_, i) => (
            <CollageTile key={tiles[i]?.id ?? `tile-${i}`} item={tiles[i]} />
          ))}
        </View>
      </View>
    </CardShell>
  );
};

// =============================================================================
// EMPTY / TEASER STATE — inviting teaser, same split frame
//
// Two sub-cases, distinguished by `onPress`:
// - onPress present  : a zone exists but has no items yet → tappable, enters
//                      the (empty) zone, shows the normal CTA.
// - onPress absent   : no active zone at all → non-interactive teaser, shows a
//                      "Bientôt disponible" label instead of a dead CTA.
// =============================================================================

const EmptyCard: React.FC<{ onPress?: () => void }> = ({ onPress }) => (
  <CardShell onPress={onPress}>
    <View style={styles.card}>
      {/* Left — editorial text block */}
      <View style={styles.textBlock}>
        <ZoneTitle />
        <Text style={styles.tagline}>Échange tes pièces, sans frais.</Text>
        <Text style={styles.emptyHint}>
          Dépose un article et trouve la pièce parfaite à troquer.
        </Text>
        {onPress ? <CtaRow /> : <ComingSoonLabel />}
      </View>

      {/* Right — empty collage placeholder (no real stock yet) */}
      <View style={styles.collage}>
        {Array.from({ length: TILE_COUNT }).map((_, i) => (
          <CollageTile key={`empty-tile-${i}`} />
        ))}
      </View>
    </View>
  </CardShell>
);

// =============================================================================
// LOADING STATE — skeleton matching the split layout
// =============================================================================

const LoadingCard: React.FC = () => (
  <View style={[styles.card, styles.skeletonCard]}>
    {/* Left — text skeleton */}
    <View style={styles.textBlock}>
      <View style={[styles.skeletonLine, styles.skeletonTitle]} />
      <View style={[styles.skeletonLine, styles.skeletonTagline]} />
      <View style={[styles.skeletonLine, styles.skeletonStats]} />
      <View style={styles.skeletonCta} />
    </View>

    {/* Right — collage skeleton */}
    <View style={styles.collage}>
      {Array.from({ length: TILE_COUNT }).map((_, i) => (
        <View key={`skeleton-tile-${i}`} style={[styles.tile, styles.skeletonTile]} />
      ))}
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
  onPress,
  testID,
}) => {
  const hasZone = !!zone;
  const hasItems = items.length > 0;

  // A zone exists but has no items yet → still tappable (enter the empty zone).
  // No zone at all → strip the handler so the teaser stays non-interactive.
  const emptyOnPress = hasZone ? onPress : undefined;

  return (
    <View style={styles.container} testID={testID}>
      {isLoading && !zone ? (
        <LoadingCard />
      ) : hasItems ? (
        <FullCard
          items={items}
          itemsCount={itemsCount}
          newThisWeek={newThisWeek}
          onPress={onPress ?? (() => {})}
        />
      ) : (
        // (b) zone without items → inviting teaser, tappable.
        // (c) no active zone   → same teaser, non-interactive (no dead CTA).
        <EmptyCard onPress={emptyOnPress} />
      )}
    </View>
  );
};

// =============================================================================
// STYLES
// =============================================================================

const TILE_WIDTH = 88;
const TILE_HEIGHT = 56;

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  cardShadow: {
    borderRadius: radius.xl, // 16 — within DS 14-20px rule
    backgroundColor: colors.surfaceWarm,
    ...shadows.card, // very soft, opacity 0.03
  },
  card: {
    flexDirection: 'row',
    alignItems: 'stretch',
    borderRadius: radius.xl,
    overflow: 'hidden',
    backgroundColor: colors.surfaceWarm,
    padding: spacing.lg,
    gap: spacing.md,
  },

  // --- Left: editorial text block ---
  textBlock: {
    flex: 1,
    justifyContent: 'flex-start',
    gap: spacing.sm,
  },
  title: {
    fontFamily: fonts.display,
    fontSize: typography.h1.fontSize,
    lineHeight: typography.h1.lineHeight,
    letterSpacing: typography.h1.letterSpacing,
    color: colors.charcoal,
  },
  titleAccent: {
    fontStyle: 'italic',
    color: colors.rust,
  },
  tagline: {
    fontFamily: typography.body.fontFamily,
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    letterSpacing: typography.body.letterSpacing,
    color: colors.foreground,
  },
  statsLine: {
    fontFamily: typography.caption.fontFamily,
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    letterSpacing: typography.caption.letterSpacing,
    color: colors.foregroundSecondary,
    marginTop: spacing.xs,
  },
  emptyHint: {
    fontFamily: typography.caption.fontFamily,
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    letterSpacing: typography.caption.letterSpacing,
    color: colors.foregroundSecondary,
  },

  // --- Right: vertical collage ---
  collage: {
    gap: spacing.sm,
    justifyContent: 'center',
  },
  tile: {
    width: TILE_WIDTH,
    height: TILE_HEIGHT,
    borderRadius: radius.lg, // 12 — within DS 14-20px rule
    overflow: 'hidden',
    backgroundColor: colors.cream,
  },
  tileImage: {
    flex: 1,
    backgroundColor: colors.borderLight,
  },
  tileFallback: {
    backgroundColor: colors.secondaryLight,
    justifyContent: 'center',
    alignItems: 'center',
  },

  // --- CTA ---
  ctaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.sm,
    backgroundColor: colors.rust,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    marginTop: spacing.xs,
  },
  ctaText: {
    fontFamily: typography.button.fontFamily,
    fontSize: typography.button.fontSize,
    lineHeight: typography.button.lineHeight,
    letterSpacing: typography.button.letterSpacing,
    color: colors.cream,
    textTransform: 'uppercase',
  },

  // --- "Coming soon" label (non-interactive teaser) ---
  comingSoonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.xs,
    backgroundColor: colors.secondaryLight,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    marginTop: spacing.xs,
  },
  comingSoonText: {
    fontFamily: typography.label.fontFamily,
    fontSize: typography.label.fontSize,
    lineHeight: typography.label.lineHeight,
    letterSpacing: typography.label.letterSpacing,
    color: colors.secondary,
    textTransform: 'uppercase',
  },

  // --- Loading skeleton ---
  skeletonCard: {
    backgroundColor: colors.surfaceWarm,
  },
  skeletonLine: {
    borderRadius: radius.sm,
    backgroundColor: colors.borderLight,
  },
  skeletonTitle: {
    height: 24,
    width: '55%',
  },
  skeletonTagline: {
    height: 16,
    width: '80%',
  },
  skeletonStats: {
    height: 12,
    width: '45%',
    marginTop: spacing.xs,
  },
  skeletonCta: {
    height: 36,
    width: 160,
    borderRadius: radius.full,
    backgroundColor: colors.borderLight,
    marginTop: spacing.xs,
  },
  skeletonTile: {
    backgroundColor: colors.borderLight,
  },
});

export default SwapZoneSection;
