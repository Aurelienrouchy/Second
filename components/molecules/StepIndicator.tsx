import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ViewStyle,
} from 'react-native';
import { colors, spacing } from '@/constants/theme';

type StepStatus = 'done' | 'active' | 'pending';

interface Step {
  label: string;
  status: StepStatus;
}

export interface StepIndicatorProps {
  steps: Step[];
  style?: ViewStyle;
}

export const StepIndicator: React.FC<StepIndicatorProps> = ({
  steps,
  style,
}) => {
  const getStepCircleStyle = (status: StepStatus) => {
    switch (status) {
      case 'done':
        return [styles.stepCircle, styles.stepCircleDone];
      case 'active':
        return [styles.stepCircle, styles.stepCircleActive];
      case 'pending':
        return [styles.stepCircle, styles.stepCirclePending];
    }
  };

  const getStepLabelStyle = (status: StepStatus) => {
    switch (status) {
      case 'done':
      case 'active':
        return styles.stepLabelBright;
      case 'pending':
        return styles.stepLabelDim;
    }
  };

  const getStepIcon = (status: StepStatus, index: number) => {
    switch (status) {
      case 'done':
        return '✓';
      case 'active':
        return `${index + 1}`;
      case 'pending':
        return '';
    }
  };

  return (
    <View style={[styles.container, style]}>
      <View style={styles.stepsWrapper}>
        {steps.map((step, index) => (
          <View key={index} style={styles.stepWithLine}>
            <View style={styles.stepContent}>
              <View style={getStepCircleStyle(step.status)}>
                <Text style={styles.stepIcon}>
                  {getStepIcon(step.status, index)}
                </Text>
              </View>
              <Text
                style={[
                  styles.stepLabel,
                  getStepLabelStyle(step.status),
                ]}
              >
                {step.label}
              </Text>
            </View>

            {index < steps.length - 1 && (
              <View
                style={[
                  styles.line,
                  step.status === 'done' && styles.lineDone,
                ]}
              />
            )}
          </View>
        ))}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
  },
  stepsWrapper: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  stepWithLine: {
    flex: 1,
    flexDirection: 'column',
    alignItems: 'center',
  },
  stepContent: {
    alignItems: 'center',
    marginBottom: 8,
  },
  stepCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
    borderWidth: 1.5,
  },
  stepCircleDone: {
    backgroundColor: colors.sage,
    borderColor: colors.sage,
  },
  stepCircleActive: {
    backgroundColor: colors.rust,
    borderColor: colors.rust,
  },
  stepCirclePending: {
    backgroundColor: 'transparent',
    borderColor: 'rgba(0,0,0,0.2)',
  },
  stepIcon: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.cream,
  },
  stepLabel: {
    fontSize: 9,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.05,
    textAlign: 'center',
  },
  stepLabelBright: {
    color: colors.charcoal,
  },
  stepLabelDim: {
    color: 'rgba(0,0,0,0.4)',
  },
  line: {
    position: 'absolute',
    width: '100%',
    height: 1,
    backgroundColor: 'rgba(0,0,0,0.1)',
    top: 14,
    left: -8,
  },
  lineDone: {
    backgroundColor: colors.sage,
  },
});
