/**
 * SwapZoneSection Component (presentational) — DARK editorial HERO (no photos)
 *
 * Restores the previous hero composition (eyebrow at top, editorial content,
 * stats + CTA at the bottom) that lived on dark surfaces — but WITHOUT the
 * photo collage. The depth the photos used to provide is now carried by a
 * subtle dark gradient background (imageGradients.dark, a DS token), so the
 * card keeps its premium "hero" feel as a solid dark block.
 *
 * The Swap Zone is the app's editorial counterpoint: while the rest of the app
 * is warm white / cream, the Swap Zone lives on dark surfaces — a distinct
 * universe. The wrapper band is charcoal (colors.dark); this card sits a notch
 * deeper via the dark gradient + soft shadow.
 *
 * Copy (kept from the latest iteration):
 *   - Title    "Swap Zone"  ("Zone" accented in rust — color, not italic,
 *               since the loaded Cormorant has no real italic variant)
 *   - Tagline  "Échange tes pièces, sans frais."
 *   - Stats    "{itemsCount} articles" (rust pill) + "{newThisWeek} nouveautés
 *               cette semaine" (each hidden when 0)
 *   - CTA      "Entrer dans la zone →"
 *
 * States (driven by `zone` presence + `itemsCount` + `onPress`):
 * - full    : zone with stock → eyebrow + title + stats + tappable CTA
 * - empty   : zone exists but no stock yet → inviting hint, tappable CTA
 * - teaser  : no active zone (onPress absent) → NON-interactive, no eyebrow,
 *             "Bientôt disponible" label instead of a dead CTA
 * - loading : dark skeleton
 *
 * Interactivity is keyed off `onPress`: when the wrapper passes no handler the
 * card never renders a Pressable, so there is never a button that does nothing.
 *
 * DS DISCIPLINE: every color / size / radius / spacing / gradient comes from
 * constants/theme. No magic numbers, no hardcoded colors. The only fixed
 * heights are token sums (e.g. sizing.avatarXXL + sizing.avatarXL).
 */

import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
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

import {
  colors,
  spacing,
  typography,
  radius,
  sizing,
  fonts,
  shadows,
  animations,
  imageGradients,
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
  // Kept for API compatibility with the feature wrapper; the card no longer
  // renders thumbnails, so the list itself is unused here.
  items?: SwapPartyItem[];
  itemsCount?: number;
  newThisWeek?: number;
  isLoading?: boolean;
  onPress?: () => void;
  testID?: string;
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
// SHARED — Eyebrow ("· ÉCHANGE OUVERT" with a live dot) — only when the zone
// is actually open (interactive).
// =============================================================================

const OpenEyebrow: React.FC = () => (
  <View style={styles.eyebrowRow}>
    <View style={styles.statusDot} />
    <Text style={styles.eyebrow}>Échange ouvert</Text>
  </View>
);

// =============================================================================
// SHARED — Editorial title ("Swap" cream + "Zone" rust accent)
// Accent is carried by COLOR (rust) + the display serif, never by italic.
// =============================================================================

const ZoneTitle: React.FC = () => (
  <Text style={styles.title}>
    Swap <Text style={styles.titleAccent}>Zone</Text>
  </Text>
);

// =============================================================================
// SHARED — CTA row ("Entrer dans la zone →") — cream pill on the dark hero
// =============================================================================

const CtaRow: React.FC = () => (
  <View style={styles.ctaRow}>
    <Text style={styles.ctaText}>Entrer dans la zone</Text>
    <View style={styles.ctaChevron}>
      <Ionicons name="arrow-forward" size={sizing.iconSM} color={colors.charcoal} />
    </View>
  </View>
);

// =============================================================================
// SHARED — "coming soon" label (non-interactive, replaces the CTA when there
// is no active zone so the card never shows a dead button)
// =============================================================================

const ComingSoonLabel: React.FC = () => (
  <View style={styles.comingSoonRow}>
    <Ionicons name="time-outline" size={sizing.iconSM} color={colors.sand} />
    <Text style={styles.comingSoonText}>Bientôt disponible</Text>
  </View>
);

// =============================================================================
// HERO — dark gradient block (no photos)
// =============================================================================

interface HeroProps {
  itemsCount: number;
  newThisWeek: number;
  // interactive => a real, open zone. non-interactive => teaser.
  onPress?: () => void;
}

const Hero: React.FC<HeroProps> = ({ itemsCount, newThisWeek, onPress }) => {
  const interactive = !!onPress;
  const hasStock = itemsCount > 0;
  const hasFresh = newThisWeek > 0;

  return (
    <CardShell onPress={onPress}>
      <LinearGradient
        colors={imageGradients.dark}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={styles.card}
      >
        {/* Top — open eyebrow (only when the zone is really open) */}
        {interactive ? <OpenEyebrow /> : <View />}

        {/* Middle — editorial title + tagline */}
        <View style={styles.textBlock}>
          <ZoneTitle />
          <Text style={styles.tagline}>Échange tes pièces, sans frais.</Text>
        </View>

        {/* Bottom — stats + CTA (or hint / coming-soon) */}
        <View style={styles.bottomBlock}>
          {hasStock ? (
            <View style={styles.countPill}>
              <Ionicons name="swap-horizontal" size={sizing.iconSM} color={colors.cream} />
              <Text style={styles.countPillText}>
                {itemsCount} {itemsCount > 1 ? 'articles' : 'article'}
              </Text>
            </View>
          ) : interactive ? (
            <Text style={styles.hint}>
              Dépose un article et trouve la pièce parfaite à troquer.
            </Text>
          ) : null}

          {hasStock && hasFresh ? (
            <Text style={styles.freshText}>
              {newThisWeek} {newThisWeek > 1 ? 'nouveautés' : 'nouveauté'} cette semaine
            </Text>
          ) : null}

          {interactive ? <CtaRow /> : <ComingSoonLabel />}
        </View>
      </LinearGradient>
    </CardShell>
  );
};

// =============================================================================
// LOADING STATE — dark skeleton
// =============================================================================

const LoadingCard: React.FC = () => (
  <View style={styles.cardShell}>
    <LinearGradient
      colors={imageGradients.dark}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
      style={styles.card}
    >
      <View style={[styles.skeletonLine, styles.skeletonEyebrow]} />
      <View style={styles.textBlock}>
        <View style={[styles.skeletonLine, styles.skeletonTitle]} />
        <View style={[styles.skeletonLine, styles.skeletonTagline]} />
      </View>
      <View style={styles.bottomBlock}>
        <View style={[styles.skeletonLine, styles.skeletonStats]} />
        <View style={styles.skeletonCta} />
      </View>
    </LinearGradient>
  </View>
);

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export const SwapZoneSection: React.FC<SwapZoneSectionProps> = ({
  zone,
  itemsCount = 0,
  newThisWeek = 0,
  isLoading = false,
  onPress,
  testID,
}) => {
  const hasZone = !!zone;

  // Only build an interactive hero when a zone actually exists. No zone → strip
  // the handler so the teaser stays non-interactive (no dead CTA).
  const heroOnPress = hasZone ? onPress : undefined;

  return (
    <View style={styles.container} testID={testID}>
      {isLoading && !zone ? (
        <LoadingCard />
      ) : (
        <Hero
          itemsCount={zone?.itemsCount ?? itemsCount}
          newThisWeek={newThisWeek}
          onPress={heroOnPress}
        />
      )}
    </View>
  );
};

// =============================================================================
// STYLES — dark hero, 100% DS tokens
//
// Card sits on the wrapper's charcoal band (colors.dark). Its dark gradient
// (imageGradients.dark) + soft shadow lift it a notch and give the depth the
// photo collage used to provide. Rounded corners (radius.lg) match the
// previous hero card. Min height is a sum of sizing tokens (no magic number).
// =============================================================================

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },

  cardShell: {
    borderRadius: radius.lg,
    backgroundColor: colors.deep,
    ...shadows.elevated,
  },
  card: {
    minHeight: sizing.avatarXXL + sizing.avatarXL, // 120 + 80 = 200, token-derived
    borderRadius: radius.lg,
    overflow: 'hidden',
    padding: spacing.lg,
    justifyContent: 'space-between',
    gap: spacing.md,
  },

  // --- Top: open eyebrow ---
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
    width: spacing.sm,
    height: spacing.sm,
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

  // --- Middle: editorial text ---
  textBlock: {
    gap: spacing.xs,
  },
  title: {
    fontFamily: fonts.displaySemiBold,
    fontSize: typography.hero.fontSize,
    lineHeight: typography.hero.lineHeight,
    letterSpacing: typography.hero.letterSpacing,
    color: colors.cream,
  },
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

  // --- Bottom: stats + CTA ---
  bottomBlock: {
    gap: spacing.sm,
    alignItems: 'flex-start',
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
    letterSpacing: typography.label.letterSpacing,
    color: colors.cream,
  },
  freshText: {
    fontFamily: typography.caption.fontFamily,
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    letterSpacing: typography.caption.letterSpacing,
    color: colors.sand,
    paddingLeft: spacing.xs,
  },
  hint: {
    fontFamily: typography.caption.fontFamily,
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    letterSpacing: typography.caption.letterSpacing,
    color: colors.whiteTranslucent,
    maxWidth: sizing.avatarXXL * 2, // 240, token-derived
  },

  // --- CTA (cream pill, full width, charcoal text) ---
  ctaRow: {
    alignSelf: 'stretch',
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
  ctaChevron: {
    width: sizing.avatarSM,
    height: sizing.avatarSM,
    borderRadius: radius.full,
    backgroundColor: colors.sand,
    justifyContent: 'center',
    alignItems: 'center',
  },

  // --- Coming-soon label (non-interactive teaser) ---
  comingSoonRow: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.overlay,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
  },
  comingSoonText: {
    fontFamily: typography.label.fontFamily,
    fontSize: typography.label.fontSize,
    lineHeight: typography.label.lineHeight,
    letterSpacing: typography.label.letterSpacing,
    color: colors.sand,
    textTransform: 'uppercase',
  },

  // --- Loading skeleton (dark) ---
  skeletonLine: {
    borderRadius: radius.sm,
    backgroundColor: colors.dark,
  },
  skeletonEyebrow: {
    height: typography.labelUppercase.lineHeight,
    width: sizing.avatarXXL, // 120
  },
  skeletonTitle: {
    height: typography.hero.lineHeight,
    width: '60%',
  },
  skeletonTagline: {
    height: typography.body.lineHeight,
    width: '80%',
    marginTop: spacing.xs,
  },
  skeletonStats: {
    height: typography.label.lineHeight,
    width: '40%',
  },
  skeletonCta: {
    alignSelf: 'stretch',
    height: sizing.buttonHeight,
    borderRadius: radius.full,
    backgroundColor: colors.dark,
  },
});

export default SwapZoneSection;
