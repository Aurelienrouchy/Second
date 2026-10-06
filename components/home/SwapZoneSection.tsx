/** Home entry for the exchange catalogue. Stock comes from the zone total;
 * photos are only a small preview and never imply a global freshness count. */
import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { colors, spacing, typography, radius, sizing, animations } from '@/constants/theme';
import type { SwapPartyItem } from '@/types';

interface SwapZoneInfo {
  id: string;
  name: string;
  itemsCount?: number;
}

interface SwapZoneSectionProps {
  zone?: SwapZoneInfo;
  items?: SwapPartyItem[];
  itemsCount?: number;
  /** Kept for compatibility; this only counts the six previews, not all stock. */
  newThisWeek?: number;
  isLoading?: boolean;
  isError?: boolean;
  previewsError?: boolean;
  onPress?: () => void;
  onRetry?: () => void;
  testID?: string;
}

export const SwapZoneSection: React.FC<SwapZoneSectionProps> = ({
  zone,
  items = [],
  itemsCount = 0,
  isLoading = false,
  isError = false,
  previewsError = false,
  onPress,
  onRetry,
  testID,
}) => {
  const count = zone?.itemsCount ?? itemsCount;
  const previewItems = items.filter((item) => !!item.imageUrl).slice(0, 3);
  const interactive = !!zone && !!onPress;
  const handlePress = () => {
    if (!interactive) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress?.();
  };

  if (isLoading && !zone) {
    return (
      <View testID={testID} style={styles.shell} accessibilityLabel="Chargement de l’Espace échanges" accessibilityState={{ busy: true }}>
        <View style={[styles.skeleton, styles.skeletonTitle]} />
        <View style={[styles.skeleton, styles.skeletonBody]} />
        <View style={[styles.skeleton, styles.skeletonCta]} />
      </View>
    );
  }

  const content = (
    <>
      <View style={styles.textBlock}>
        <Text style={styles.eyebrow}>Une nouvelle vie pour vos articles</Text>
        <Text style={styles.title}>Espace échanges</Text>
        <Text style={styles.tagline}>
          Choisissez un article qui vous plaît, puis proposez les vôtres en échange.
        </Text>
      </View>

      {zone ? (
        <>
          {count > 0 ? (
            <View style={styles.stockRow}>
              <Ionicons name="swap-horizontal" size={sizing.iconSM} color={colors.sand} />
              <Text style={styles.stockText}>{count} {count > 1 ? 'articles' : 'article'} à échanger</Text>
            </View>
          ) : (
            <Text style={styles.hint}>Aucun article à échanger pour le moment. Vous pouvez déjà ajouter les vôtres.</Text>
          )}
          {previewItems.length > 0 && (
            <View style={styles.previewRow} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              {previewItems.map((item) => (
                <View key={item.id} style={styles.previewFrame}>
                  <Image source={{ uri: item.imageUrl }} contentFit="cover" recyclingKey={item.id} style={styles.previewImage} />
                </View>
              ))}
            </View>
          )}
          {previewsError && <Text style={styles.hint}>Les aperçus ne sont pas disponibles. Vous pouvez ouvrir le catalogue.</Text>}
          {isError && <Text style={styles.hint}>Le catalogue n’a pas pu être actualisé. Ouvrez-le pour réessayer.</Text>}
          {interactive && (
            <View style={styles.ctaRow}>
              <Text style={styles.ctaText}>Découvrir les articles</Text>
              <Ionicons name="arrow-forward" size={sizing.iconMD} color={colors.cream} />
            </View>
          )}
        </>
      ) : (
        <View style={styles.stateBox}>
          <Text style={styles.stateTitle}>{isError ? 'Le catalogue n’a pas pu être chargé' : 'Aucun espace disponible pour le moment'}</Text>
          <Text style={styles.hint}>{isError ? 'Vérifiez votre connexion, puis réessayez.' : 'Revenez plus tard pour découvrir les articles à échanger.'}</Text>
          {isError && onRetry && (
            <Pressable accessibilityRole="button" onPress={onRetry} style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}>
              <Text style={styles.retryText}>Réessayer</Text>
              <Ionicons name="refresh-outline" size={sizing.iconSM} color={colors.cream} />
            </Pressable>
          )}
        </View>
      )}
    </>
  );

  return (
    <Animated.View testID={testID} entering={FadeInDown.duration(animations.duration.slow).delay(animations.duration.instant)}>
      {interactive ? (
        <Pressable onPress={handlePress} accessibilityRole="button" accessibilityLabel={`Espace échanges, ${count} ${count > 1 ? 'articles' : 'article'} à échanger. Découvrir les articles`} style={({ pressed }) => [styles.shell, pressed && styles.pressed]}>
          {content}
        </Pressable>
      ) : <View style={styles.shell}>{content}</View>}
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  shell: { padding: spacing.lg, gap: spacing.md },
  pressed: { opacity: 0.8 },
  textBlock: { gap: spacing.sm },
  eyebrow: { ...typography.caption, color: colors.sand },
  title: { ...typography.h1, color: colors.cream },
  tagline: { ...typography.body, color: colors.creamTranslucent60 },
  stockRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  stockText: { ...typography.label, color: colors.sand, flexShrink: 1 },
  hint: { ...typography.bodySmall, color: colors.creamTranslucent60 },
  previewRow: { flexDirection: 'row', gap: spacing.sm },
  previewFrame: { flex: 1, aspectRatio: 4 / 5, overflow: 'hidden', backgroundColor: colors.darkSurface2, borderRadius: radius.sm },
  previewImage: { width: '100%', height: '100%' },
  ctaRow: { minHeight: sizing.minTouchTarget, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, padding: spacing.md, backgroundColor: colors.primaryDark, borderRadius: radius.md },
  ctaText: { ...typography.label, color: colors.cream, flex: 1 },
  stateBox: { gap: spacing.sm, padding: spacing.md, backgroundColor: colors.darkSurface1, borderRadius: radius.md },
  stateTitle: { ...typography.label, color: colors.cream },
  retryButton: { minHeight: sizing.minTouchTarget, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.darkBorderStrong, borderRadius: radius.md },
  retryText: { ...typography.label, color: colors.cream },
  skeleton: { backgroundColor: colors.darkSurface2, borderRadius: radius.sm },
  skeletonTitle: { height: typography.h1.lineHeight, width: '70%' },
  skeletonBody: { height: typography.body.lineHeight * 2, width: '100%' },
  skeletonCta: { height: sizing.buttonHeight, width: '100%' },
});

export default SwapZoneSection;
