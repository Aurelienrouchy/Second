/**
 * SwapZoneSection Component (presentational) — CONTENT only (no card)
 *
 * The Swap Zone home block is no longer a floating card inside a band: the
 * content is laid out DIRECTLY on the section surface. The dark surface (and
 * its full width) is provided by the feature wrapper (features/home/swap-zone)
 * — this component renders only the content (eyebrow, title, tagline, stats,
 * CTA) and owns the tap interaction.
 *
 * Copy:
 *   - Title    "Swap Zone"  ("Zone" accented in rust — color, not italic)
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
 * DS DISCIPLINE: every color / size / radius / spacing comes from
 * constants/theme. No magic numbers, no hardcoded colors.
 */

import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Animated, { FadeInDown } from 'react-native-reanimated';

import {
  colors,
  spacing,
  typography,
  radius,
  sizing,
  fonts,
  animations,
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
  // Kept for API compatibility with the feature wrapper; the section no longer
  // renders thumbnails, so the list itself is unused here.
  items?: SwapPartyItem[];
  itemsCount?: number;
  newThisWeek?: number;
  isLoading?: boolean;
  onPress?: () => void;
  testID?: string;
}

// =============================================================================
// SHELL — entrance animation + optional press/haptic (no card framing)
// =============================================================================

interface ShellProps {
  onPress?: () => void;
  children: React.ReactNode;
}

const Shell: React.FC<ShellProps> = ({ onPress, children }) => {
  if (!onPress) {
    return (
      <Animated.View
        entering={FadeInDown.duration(animations.duration.slow).delay(animations.duration.instant)}
        style={styles.shell}
      >
        {children}
      </Animated.View>
    );
  }

  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress();
  };

  return (
    <Animated.View
      entering={FadeInDown.duration(animations.duration.slow).delay(animations.duration.instant)}
    >
      <Pressable
        onPress={handlePress}
        style={({ pressed }) => [styles.shell, pressed && styles.shellPressed]}
      >
        {children}
      </Pressable>
    </Animated.View>
  );
};

// =============================================================================
// SHARED — pieces
// =============================================================================

const ZoneTitle: React.FC = () => (
  <Text style={styles.title}>
    Swap <Text style={styles.titleAccent}>Zone</Text>
  </Text>
);

const CtaRow: React.FC = () => (
  <View style={styles.ctaRow}>
    <Text style={styles.ctaText}>Entrer dans la zone</Text>
    <View style={styles.ctaChevron}>
      <Ionicons name="arrow-forward" size={sizing.iconSM} color={colors.charcoal} />
    </View>
  </View>
);

const ComingSoonLabel: React.FC = () => (
  <View style={styles.comingSoonRow}>
    <Ionicons name="time-outline" size={sizing.iconSM} color={colors.sand} />
    <Text style={styles.comingSoonText}>Bientôt disponible</Text>
  </View>
);

// =============================================================================
// CONTENT
// =============================================================================

interface ContentProps {
  itemsCount: number;
  newThisWeek: number;
  interactive: boolean;
}

const Content: React.FC<ContentProps> = ({ itemsCount, newThisWeek, interactive }) => {
  const hasStock = itemsCount > 0;
  const hasFresh = newThisWeek > 0;

  return (
    <>
      {/* Title + tagline */}
      <View style={styles.textBlock}>
        <ZoneTitle />
        <Text style={styles.tagline}>Échange tes pièces, sans frais.</Text>
      </View>

      {/* Stats + CTA */}
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
    </>
  );
};

// =============================================================================
// LOADING — dark skeleton
// =============================================================================

const LoadingContent: React.FC = () => (
  <View style={styles.shell}>
    <View style={styles.textBlock}>
      <View style={[styles.skeletonLine, styles.skeletonTitle]} />
      <View style={[styles.skeletonLine, styles.skeletonTagline]} />
    </View>
    <View style={styles.bottomBlock}>
      <View style={[styles.skeletonLine, styles.skeletonStats]} />
      <View style={styles.skeletonCta} />
    </View>
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
  const heroOnPress = hasZone ? onPress : undefined;

  if (isLoading && !zone) {
    return (
      <View testID={testID}>
        <LoadingContent />
      </View>
    );
  }

  return (
    <View testID={testID}>
      <Shell onPress={heroOnPress}>
        <Content
          itemsCount={zone?.itemsCount ?? itemsCount}
          newThisWeek={newThisWeek}
          interactive={!!heroOnPress}
        />
      </Shell>
    </View>
  );
};

// =============================================================================
// STYLES — content laid directly on the section surface (no card)
// The dark surface + full width are owned by the feature wrapper.
// =============================================================================

const styles = StyleSheet.create({
  // Content shell: paddings define the inset; no background, no radius, no
  // shadow — the surface comes from the wrapper's section.
  shell: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    gap: spacing.md,
  },
  shellPressed: {
    opacity: 0.9,
  },

  // --- Eyebrow ---
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

  // --- Title + tagline ---
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

  // --- Stats + CTA ---
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
    maxWidth: sizing.avatarXXL * 2, // 240 — token-derived
  },

  // --- CTA (cream pill, full width) ---
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

  // --- Coming-soon (non-interactive teaser) ---
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

  // --- Loading skeleton ---
  skeletonLine: {
    borderRadius: radius.sm,
    backgroundColor: colors.dark,
  },
  skeletonEyebrow: {
    height: typography.labelUppercase.lineHeight,
    width: sizing.avatarXXL,
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
