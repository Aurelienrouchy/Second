/** The real catalogue stock and photos, presented in Le Troc's graphic identity. */
import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import {
  colors,
  spacing,
  typography,
  sizing,
  components,
} from '@/constants/theme';
import type { SwapPartyItem } from '@/types';
import { TrocImageMosaic } from './TrocImageMosaic';

interface SwapZoneSectionProps {
  zone?: { id: string; name: string; itemsCount?: number };
  items?: SwapPartyItem[];
  itemsCount?: number;
  /** Compatibility only: preview freshness must never stand in for stock. */
  newThisWeek?: number;
  isLoading?: boolean;
  isError?: boolean;
  previewsError?: boolean;
  motionEnabled?: boolean;
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
  motionEnabled = false,
  onPress,
  onRetry,
  testID,
}) => {
  const count = zone?.itemsCount ?? itemsCount;
  const interactive = !!zone && !!onPress;
  const handlePress = () => {
    if (!interactive) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress?.();
  };
  if (isLoading && !zone)
    return (
      <View
        testID={testID}
        style={styles.shell}
        accessibilityLabel="Chargement du Troc"
        accessibilityState={{ busy: true }}
      >
        <View style={[styles.skeleton, styles.skeletonTitle]} />
        <View style={[styles.skeleton, styles.skeletonPhotos]} />
        <View style={[styles.skeleton, styles.skeletonCta]} />
      </View>
    );
  return (
    <View
      testID={testID}
      style={styles.shell}
    >
      <View style={styles.textBlock}>
        <Text
          style={styles.title}
          accessibilityRole="header"
        >
          Le Troc
        </Text>
        <Text style={styles.description}>
          Échangez vos vêtements entre membres.
        </Text>
      </View>
      {zone ? (
        <>
          {count > 0 && (
            <TrocImageMosaic items={items} motionEnabled={motionEnabled} />
          )}
          {count === 0 && (
            <Text style={styles.hint}>
              Aucun article à échanger pour le moment. Vous pouvez déjà ajouter
              les vôtres.
            </Text>
          )}
          {previewsError && (
            <Text style={styles.hint}>
              Les aperçus ne sont pas disponibles. Vous pouvez ouvrir le
              catalogue.
            </Text>
          )}
          {isError && (
            <Text style={styles.hint}>
              Le catalogue n’a pas pu être actualisé. Ouvrez-le pour réessayer.
            </Text>
          )}
          {interactive && (
            <Pressable
              onPress={handlePress}
              accessibilityRole="button"
              accessibilityLabel={`Le Troc, ${count} ${count > 1 ? 'articles' : 'article'} à échanger. Voir les pièces à échanger`}
              style={({ pressed }) => [
                styles.ctaRow,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.ctaText}>Voir les pièces à échanger</Text>
              <Ionicons
                name="arrow-forward"
                size={sizing.iconMD}
                color={colors.primaryDark}
              />
            </Pressable>
          )}
        </>
      ) : (
        <View style={styles.stateBox}>
          <Text style={styles.stateTitle}>
            {isError
              ? 'Le catalogue n’a pas pu être chargé'
              : 'Aucun espace disponible pour le moment'}
          </Text>
          <Text style={styles.hint}>
            {isError
              ? 'Vérifiez votre connexion, puis réessayez.'
              : 'Revenez plus tard pour découvrir les articles à échanger.'}
          </Text>
          {isError && onRetry && (
            <Pressable
              accessibilityRole="button"
              onPress={onRetry}
              style={({ pressed }) => [
                styles.retryButton,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.retryText}>Réessayer</Text>
              <Ionicons
                name="refresh-outline"
                size={sizing.iconSM}
                color={colors.foreground}
              />
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
};
const styles = StyleSheet.create({
  shell: {
    paddingHorizontal: components.troc.pagePadding,
    paddingVertical: spacing.lg,
    gap: spacing.md,
  },
  pressed: { opacity: components.troc.pressedOpacity },
  textBlock: { gap: spacing.sm },
  title: { ...typography.trocHomeTitle, color: colors.foreground },
  description: { ...typography.bodySmall, color: colors.foreground },
  hint: { ...typography.bodySmall, color: colors.foregroundSecondary },
  ctaRow: {
    ...components.button.container,
    ...components.button.primary,
    minHeight: sizing.buttonHeight,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.md,
  },
  ctaText: {
    ...typography.label,
    color: colors.foreground,
    flexShrink: 1,
    textAlign: 'center',
  },
  stateBox: {
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.surfaceWarm,
  },
  stateTitle: { ...typography.label, color: colors.foreground },
  retryButton: {
    minHeight: sizing.minTouchTarget,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderWidth: components.troc.borderWidth,
    borderColor: colors.borderStrong,
  },
  retryText: { ...typography.label, color: colors.foreground },
  skeleton: { backgroundColor: colors.surfaceWarm },
  skeletonTitle: { height: typography.trocHomeTitle.lineHeight, width: '45%' },
  skeletonPhotos: {
    height: components.troc.mosaicTileHeight * components.troc.mosaicRows + spacing.sm * (components.troc.mosaicRows - 1),
    width: '100%',
  },
  skeletonCta: { height: sizing.buttonHeight, width: '100%' },
});
export default SwapZoneSection;
