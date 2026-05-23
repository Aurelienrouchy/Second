import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import Animated, {
  SharedValue,
  AnimatedStyle,
  useAnimatedStyle,
  FadeIn,
  FadeInDown,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { colors, fonts, spacing, radius } from '@/constants/theme';

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
            <Ionicons name="sync-outline" size={24} color={colors.sage} />
          </Animated.View>

          <Text style={styles.analysisTitle}>Analyse en cours</Text>
          <Text style={styles.analysisSubtitle}>
            Notre IA identifie les détails{'\n'}de ton article
          </Text>

          <View style={styles.progressBarContainer}>
            <Animated.View style={[styles.progressBarFill, progressBarStyle]} />
          </View>
        </>
      )}

      {screenState === 'complete' && (
        <>
          <Animated.View
            entering={FadeIn.duration(300)}
            style={styles.completeIconContainer}
          >
            <Ionicons name="checkmark" size={20} color={colors.white} />
          </Animated.View>

          <Text style={styles.completeTitleInline}>Analyse terminée</Text>
          <Text style={styles.completeSubInline}>
            {prefilledCount} champs pré-remplis
          </Text>
        </>
      )}

      {screenState === 'error' && (
        <>
          <View style={styles.errorIconContainer}>
            <Ionicons
              name="alert-circle-outline"
              size={24}
              color={colors.danger}
            />
          </View>

          <Text style={styles.analysisTitle}>Erreur d'analyse</Text>
          <Text style={styles.analysisSubtitle}>{errorMessage}</Text>
        </>
      )}

      {detectedPills.length > 0 && (
        <View style={styles.pillsRow}>
          {detectedPills.map((pill, index) => (
            <Animated.View
              key={pill}
              entering={FadeInDown.delay(index * 80).duration(200)}
              style={styles.detectionPill}
            >
              <Text style={styles.detectionPillText}>{pill}</Text>
            </Animated.View>
          ))}
        </View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  analysisCard: {
    backgroundColor: colors.charcoal,
    borderRadius: radius.sm,
    padding: spacing.lg,
    alignItems: 'center',
    marginBottom: spacing.md,
    overflow: 'hidden',
  },
  spinnerContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(122, 140, 110, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  completeIconContainer: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.sage,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  errorIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.dangerLight,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  analysisTitle: {
    fontFamily: fonts.displayMedium,
    fontSize: 22,
    color: colors.cream,
    marginBottom: 6,
    textAlign: 'center',
  },
  analysisSubtitle: {
    fontFamily: fonts.sans,
    fontSize: 12,
    color: 'rgba(245, 240, 232, 0.4)',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: spacing.md,
  },
  completeTitleInline: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    color: colors.cream,
    marginBottom: 4,
  },
  completeSubInline: {
    fontFamily: fonts.sans,
    fontSize: 11,
    color: 'rgba(245, 240, 232, 0.4)',
  },
  progressBarContainer: {
    width: '100%',
    height: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: 1,
    overflow: 'hidden',
    marginTop: 14,
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: colors.sage,
    borderRadius: 1,
  },
  pillsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 5,
    marginTop: 12,
  },
  detectionPill: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    backgroundColor: 'rgba(122, 140, 110, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(122, 140, 110, 0.25)',
    borderRadius: 2,
  },
  detectionPillText: {
    fontFamily: fonts.sansMedium,
    fontSize: 10,
    color: colors.sage,
    letterSpacing: 0.6,
  },
});
