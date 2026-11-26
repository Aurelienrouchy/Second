import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import Animated, {
  SharedValue,
  AnimatedStyle,
  useAnimatedStyle,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { colors, components, radius, sizing, spacing, typography } from '@/constants/theme';

type ScreenState = 'loading' | 'complete' | 'error';

interface AnalysisCardProps {
  screenState: ScreenState;
  errorMessage: string;
  prefilledCount: number;
  detectedPills: string[];
  spinnerStyle: AnimatedStyle<ViewStyle>;
  progressWidth: SharedValue<number>;
}

export const AnalysisCard = React.memo(function AnalysisCard({
  screenState,
  errorMessage,
  prefilledCount,
  detectedPills,
  spinnerStyle,
  progressWidth,
}: AnalysisCardProps) {
  const progressBarStyle = useAnimatedStyle(() => ({
    width: `${progressWidth.value}%`,
  }));

  return (
    <View style={styles.analysisCard}>
      {screenState === 'loading' && (
        <>
          <Animated.View style={[styles.spinnerContainer, spinnerStyle]}>
            <Ionicons name="sync-outline" size={sizing.iconMD} color={colors.charcoal} />
          </Animated.View>

          <Text style={styles.analysisTitle}>Préparation des détails</Text>

          <View style={styles.progressBarContainer}>
            <Animated.View style={[styles.progressBarFill, progressBarStyle]} />
          </View>
        </>
      )}

      {screenState === 'complete' && (
        <>
          <View style={styles.completeIconContainer}>
            <Ionicons name="checkmark" size={sizing.iconSM} color={colors.white} />
          </View>

          <Text style={styles.completeTitleInline}>Détails préparés</Text>
          <Text style={styles.completeSubInline}>
            {prefilledCount} champ{prefilledCount > 1 ? 's' : ''} pré-rempli
            {prefilledCount > 1 ? 's' : ''}
          </Text>
        </>
      )}

      {screenState === 'error' && (
        <>
          <View style={styles.errorIconContainer}>
            <Ionicons
              name="alert-circle-outline"
              size={sizing.iconMD}
              color={colors.danger}
            />
          </View>

          <Text style={styles.analysisTitle}>Préparation interrompue</Text>
          <Text style={styles.analysisError}>{errorMessage}</Text>
        </>
      )}

      {detectedPills.length > 0 && (
        <View style={styles.pillsRow}>
          {detectedPills.map(pill => (
            <View key={pill} style={styles.detectionPill}>
              <Text style={styles.detectionPillText}>{pill}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  analysisCard: {
    backgroundColor: colors.white,
    borderWidth: components.input.borderWidth,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    padding: spacing.md,
    overflow: 'hidden',
  },
  spinnerContainer: {
    width: sizing.controlCircle,
    height: sizing.controlCircle,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceWarm,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  completeIconContainer: {
    width: sizing.iconLG,
    height: sizing.iconLG,
    borderRadius: radius.full,
    backgroundColor: colors.sage,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  errorIconContainer: {
    width: sizing.controlCircle,
    height: sizing.controlCircle,
    borderRadius: radius.full,
    backgroundColor: colors.dangerLight,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  analysisTitle: {
    ...typography.label,
    color: colors.charcoal,
    marginBottom: spacing.xs,
  },
  analysisError: {
    ...typography.bodySmall,
    color: colors.danger,
    marginTop: spacing.sm,
  },
  completeTitleInline: {
    ...typography.label,
    color: colors.charcoal,
    marginBottom: spacing.xs,
  },
  completeSubInline: {
    ...typography.caption,
    color: colors.muted,
  },
  progressBarContainer: {
    width: '100%',
    height: spacing.xs / 2,
    backgroundColor: colors.border,
    borderRadius: radius.full,
    overflow: 'hidden',
    marginTop: spacing.sm,
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: colors.sage,
    borderRadius: radius.full,
  },
  pillsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.md,
  },
  detectionPill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    backgroundColor: colors.surfaceWarm,
    borderWidth: components.input.borderWidth,
    borderColor: colors.border,
    borderRadius: radius.sm,
  },
  detectionPillText: {
    ...typography.caption,
    color: colors.charcoal,
  },
});
