import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, fonts, spacing } from '@/constants/theme';

interface StepProgressBarProps {
  currentStep: 1 | 2 | 3 | 4;
  totalSteps?: number;
}

const STEP_LABELS = ['Photos', 'Détails', 'Prix', 'Publier'];

export default function StepProgressBar({
  currentStep,
  totalSteps = 4,
}: StepProgressBarProps) {
  return (
    <View style={styles.container}>
      <View style={styles.barRow}>
        {Array.from({ length: totalSteps }, (_, index) => {
          const stepNumber = index + 1;
          const isDone = stepNumber < currentStep;
          const isActive = stepNumber === currentStep;

          return (
            <View key={stepNumber} style={styles.segmentWrapper}>
              <View
                style={[
                  styles.segment,
                  isDone && styles.segmentDone,
                  isActive && styles.segmentActive,
                ]}
              />
            </View>
          );
        })}
      </View>
      <View style={styles.labelsRow}>
        {STEP_LABELS.slice(0, totalSteps).map((label, index) => {
          const stepNumber = index + 1;
          const isDone = stepNumber < currentStep;
          const isActive = stepNumber === currentStep;

          return (
            <Text
              key={label}
              style={[
                styles.label,
                isDone && styles.labelDone,
                isActive && styles.labelActive,
              ]}
            >
              {label.toUpperCase()}
            </Text>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.md,
    paddingTop: 8,
    paddingBottom: spacing.sm,
    backgroundColor: colors.charcoal,
  },
  barRow: {
    flexDirection: 'row',
    gap: 4,
  },
  segmentWrapper: {
    flex: 1,
  },
  segment: {
    height: 2,
    backgroundColor: 'rgba(245, 240, 232, 0.1)',
    borderRadius: 1,
  },
  segmentDone: {
    backgroundColor: colors.sage,
  },
  segmentActive: {
    backgroundColor: colors.rust,
  },
  labelsRow: {
    flexDirection: 'row',
    marginTop: 8,
    paddingBottom: 4,
  },
  label: {
    flex: 1,
    textAlign: 'center',
    fontFamily: fonts.sansMedium,
    fontSize: 9,
    letterSpacing: 1.5,
    color: 'rgba(245, 240, 232, 0.25)',
  },
  labelDone: {
    color: colors.sage,
  },
  labelActive: {
    color: 'rgba(245, 240, 232, 0.7)',
  },
});
