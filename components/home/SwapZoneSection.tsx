/**
 * SwapZoneSection Component (presentational) — Split éditorial, univers SOMBRE
 *
 * The Swap Zone is a permanent generalist zone (no time window, no theme,
 * no countdown). It is the app's editorial counterpoint: while the rest of
 * the app is warm white / cream, the Swap Zone lives on dark surfaces.
 *
 * Visual: a DARK card (colors.deep) sitting on the wrapper's charcoal band
 * (colors.dark). The tonal step between the two DS dark tones (band = dark,
 * card = deep) is what visually separates the card from the band — no beige
 * clash, no arbitrary hairline. Title + tagline in cream; the word "Zone" is
 * accented with colors.rust + the display serif (no italic — the loaded
 * Cormorant has no true italic variant, so the accent is carried by COLOR,
 * not fontStyle). Flat, sharp corners per the DS card signature.
 *
 *   ┌──────────────────────────────┐  ← card (colors.deep)
 *   │ Swap Zone            ┌─────┐  │
 *   │ Échange tes pièces,  │ ▣   │  │
 *   │ sans frais.          │ ▣   │  │
 *   │                      │ ▣   │  │
 *   │ 234 articles · 12 n… └─────┘  │
 *   │  ( Entrer dans la zone → )    │
 *   └──────────────────────────────┘
 *
 * States (driven by `zone` presence + `items` + `onPress`):
 * - full    : zone has items → text block + vertical collage + tappable CTA
 * - empty   : zone exists but has no items → inviting teaser, tappable CTA
 * - teaser  : no zone active (onPress absent) → same teaser but NON-interactive,
 *             no dead CTA — shows a "Bientôt disponible" label instead
 * - loading : dark skeleton matching the split layout
 *
 * Interactivity is keyed off `onPress`: when the wrapper passes no handler
 * (no active zone) the card never renders a Pressable, so there is never a
 * button that does nothing.
 *
 * This component is purely presentational: data is fetched by the feature
 * wrapper (features/home/swap-zone) and passed down as props.
 *
 * DS DISCIPLINE: every color / size / radius / spacing comes from
 * constants/theme. No magic numbers. Tile size is derived from tokens
 * (sizing.avatarXL + components.card.imageRatio), never hardcoded.
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

import {
  colors,
  spacing,
  typography,
  radius,
  sizing,
  fonts,
  shadows,
  animations,
  components,
} from '@/constants/theme';
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
// CONSTANTS — count of thumbnails only (semantic, not a dimension)
// =============================================================================

// Vertical collage shows exactly 3 thumbnails.
const TILE_COUNT = 3;

// =============================================================================
// HELPERS — inline stats copy (FR, singular/plural, hide zero)
// =============================================================================

/**
 * Builds the inline stats line. Each stat is hidden when 0 (never "0 articles"
 * / "0 nouveautés"). When both are present they are joined by " · ".
 * Returns [] when nothing to show.
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
    scale.value = withTiming(animations.scale.pressedCard, {
      duration: animations.duration.fast,
      easing: Easing.out(Easing.ease),
    });
  };

  const handlePressOut = () => {
    scale.value = withTiming(1, {
      duration: animations.duration.normal,
      easing: Easing.out(Easing.ease),
    });
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
      <Animated.View
        entering={FadeInDown.duration(animations.duration.slow).delay(animations.duration.instant)}
      >
        <Animated.View style={styles.cardShell}>{children}</Animated.View>
      </Animated.View>
    );
  }

  return (
    <Animated.View
      entering={FadeInDown.duration(animations.duration.slow).delay(animations.duration.instant)}
    >
      <Animated.View style={[styles.cardShell, animatedStyle]}>
        <Pressable onPressIn={handlePressIn} onPressOut={handlePressOut} onPress={handlePress}>
          {children}
        </Pressable>
      </Animated.View>
    </Animated.View>
  );
};

// =============================================================================
// SHARED — Editorial title ("Swap" cream + "Zone" rust accent)
// Accent is carried by COLOR (rust) + the display serif, never by italic
// (the loaded Cormorant has no real italic variant).
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
    <Ionicons name="time-outline" size={sizing.iconSM} color={colors.sage} />
    <Text style={styles.comingSoonText}>Bientôt disponible</Text>
  </View>
);

// =============================================================================
// SHARED — Vertical collage tile (with clean dark fallback, no broken image)
// =============================================================================

const CollageTile: React.FC<{ item?: SwapPartyItem }> = ({ item }) => (
  <View style={styles.tile}>
    {item?.imageUrl ? (
      <Image
        source={item.imageUrl}
        style={styles.tileImage}
        contentFit="cover"
        transition={animations.duration.fast}
        recyclingKey={item.id}
      />
    ) : (
      <View style={[styles.tileImage, styles.tileFallback]}>
        <Ionicons name="shirt-outline" size={sizing.iconMD} color={colors.sand} />
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
// LOADING STATE — dark skeleton matching the split layout
// =============================================================================

const LoadingCard: React.FC = () => (
  <View style={styles.cardShell}>
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
// STYLES — dark universe, 100% DS tokens
//
// Tone separation: wrapper band = colors.dark (#1A1814), card = colors.deep
// (#0F0E0C). The tonal step is the separator (no beige, no arbitrary hairline).
//
// Tile dimensions are DERIVED from tokens, never hardcoded:
//   width  = sizing.avatarXL (80)
//   height = aspectRatio components.card.imageRatio (4/5 portrait)
// =============================================================================

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },

  // Card shell — flat, sharp corners (DS card signature: radius.none).
  // colors.deep so the card reads a notch darker than the charcoal band.
  cardShell: {
    borderRadius: components.card.borderRadius, // radius.none — sharp
    backgroundColor: colors.deep,
    ...shadows.card, // very soft, opacity 0.03
  },
  card: {
    flexDirection: 'row',
    alignItems: 'stretch',
    borderRadius: components.card.borderRadius, // radius.none
    overflow: 'hidden',
    backgroundColor: colors.deep,
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
    fontFamily: fonts.displaySemiBold,
    fontSize: typography.h1.fontSize,
    lineHeight: typography.h1.lineHeight,
    letterSpacing: typography.h1.letterSpacing,
    color: colors.cream,
  },
  // Accent: rust color only (NOT italic — no real italic variant is loaded).
  titleAccent: {
    fontFamily: fonts.displaySemiBold,
    color: colors.rust,
  },
  tagline: {
    fontFamily: typography.body.fontFamily,
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    letterSpacing: typography.body.letterSpacing,
    color: colors.sand,
  },
  statsLine: {
    fontFamily: typography.caption.fontFamily,
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    letterSpacing: typography.caption.letterSpacing,
    color: colors.whiteTranslucent,
    marginTop: spacing.xs,
  },
  emptyHint: {
    fontFamily: typography.caption.fontFamily,
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    letterSpacing: typography.caption.letterSpacing,
    color: colors.whiteTranslucent,
  },

  // --- Right: vertical collage (tiles derived from tokens) ---
  collage: {
    gap: spacing.sm,
    justifyContent: 'center',
  },
  tile: {
    width: sizing.avatarXL, // 80 — derived from a DS sizing token
    aspectRatio: components.card.imageRatio, // 4/5 portrait — DS card ratio
    borderRadius: radius.none, // sharp corners, matches product images app-wide
    overflow: 'hidden',
    backgroundColor: colors.dark, // tile base reads against the deeper card
  },
  tileImage: {
    flex: 1,
    backgroundColor: colors.dark,
  },
  tileFallback: {
    backgroundColor: colors.dark,
    justifyContent: 'center',
    alignItems: 'center',
  },

  // --- CTA (rust pill — pills are explicitly radius.full in the DS) ---
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
    backgroundColor: colors.sageLight,
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
    color: colors.sage,
    textTransform: 'uppercase',
  },

  // --- Loading skeleton (dark) ---
  skeletonCard: {
    backgroundColor: colors.deep,
  },
  skeletonLine: {
    borderRadius: radius.sm,
    backgroundColor: colors.dark,
  },
  skeletonTitle: {
    height: typography.h1.lineHeight,
    width: '55%',
  },
  skeletonTagline: {
    height: typography.body.lineHeight,
    width: '80%',
  },
  skeletonStats: {
    height: typography.caption.lineHeight,
    width: '45%',
    marginTop: spacing.xs,
  },
  skeletonCta: {
    height: sizing.buttonHeightSmall,
    width: sizing.avatarXXL + sizing.avatarMD, // 120 + 40 = 160, derived from tokens
    borderRadius: radius.full,
    backgroundColor: colors.dark,
    marginTop: spacing.xs,
  },
  skeletonTile: {
    backgroundColor: colors.dark,
  },
});

export default SwapZoneSection;
