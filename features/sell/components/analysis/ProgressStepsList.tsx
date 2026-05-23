import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, {
  useAnimatedStyle,
  SharedValue,
  FadeInDown,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { colors, fonts, spacing } from '@/constants/theme';

interface ProgressStep {
  label: string;
  state: 'done' | 'active' | 'pending';
}

interface ProgressStepsListProps {
  steps: ProgressStep[];
  stepSpinnerRotation: SharedValue<number>;
}

export const ProgressStepsList = React.memo(function ProgressStepsList({
  steps,
  stepSpinnerRotation,
}: ProgressStepsListProps) {
  const stepSpinnerStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${stepSpinnerRotation.value}deg` }],
  }));

  return (
    <View style={styles.stepsChecklist}>
      {steps.map((step, index) => (
        <Animated.View
          key={step.label}
          entering={FadeInDown.delay(index * 100).duration(250)}
          style={styles.stepItem}
        >
          {step.state === 'done' && (
            <View style={styles.stepIconDone}>
              <Ionicons name="checkmark" size={10} color={colors.white} />
            </View>
          )}
          {step.state === 'active' && (
            <View style={styles.stepIconActive}>
              <Animated.View style={stepSpinnerStyle}>
                <View style={styles.stepSpinnerInner} />
              </Animated.View>
            </View>
          )}
          {step.state === 'pending' && <View style={styles.stepIconPending} />}
          <Text
            style={[
              styles.stepText,
              step.state === 'done' && styles.stepTextDone,
              step.state === 'pending' && styles.stepTextPending,
            ]}
          >
            {step.label}
          </Text>
        </Animated.View>
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  stepsChecklist: {
    gap: 12,
    marginBottom: spacing.lg,
  },
  stepItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  stepIconDone: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.sage,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stepIconActive: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stepSpinnerInner: {
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: 'transparent',
    borderTopColor: colors.rust,
  },
  stepIconPending: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  stepText: {
    fontFamily: fonts.sans,
    fontSize: 12,
    color: colors.charcoal,
  },
  stepTextDone: {
    color: colors.charcoal,
  },
  stepTextPending: {
    color: colors.muted,
  },
});
