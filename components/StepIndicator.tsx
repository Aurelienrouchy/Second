import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

interface StepIndicatorProps {
  currentStep: 1 | 2 | 3 | 4;
  totalSteps?: number;
}

const STEP_LABELS = ['Capture', 'Détails', 'Prix', 'Aperçu'];

export default function StepIndicator({ currentStep, totalSteps = 4 }: StepIndicatorProps) {
  return (
    <View style={styles.container}>
      <View style={styles.progressContainer}>
        {Array.from({ length: totalSteps }, (_, index) => {
          const stepNumber = index + 1;
          const isCompleted = stepNumber < currentStep;
          const isCurrent = stepNumber === currentStep;

          return (
            <React.Fragment key={stepNumber}>
              {/* Step dot */}
              <View
                style={[
                  styles.dot,
                  isCompleted && styles.dotCompleted,
                  isCurrent && styles.dotCurrent,
                ]}
              >
                {isCompleted ? (
                  <Text style={styles.checkmark}>✓</Text>
                ) : (
                  <Text style={[styles.stepNumber, isCurrent && styles.stepNumberCurrent]}>
                    {stepNumber}
                  </Text>
                )}
              </View>

              {/* Connector line */}
              {stepNumber < totalSteps && (
                <View
                  style={[
                    styles.connector,
                    isCompleted && styles.connectorCompleted,
                  ]}
                />
              )}
            </React.Fragment>
          );
        })}
      </View>

      {/* Step label */}
      <Text style={styles.stepLabel}>
        Étape {currentStep}/{totalSteps} - {STEP_LABELS[currentStep - 1]}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  progressContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  dot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#E5E7EB',
    justifyContent: 'center',
    alignItems: 'center',
  },
  dotCompleted: {
    backgroundColor: '#22C55E',
  },
  dotCurrent: {
    backgroundColor: '#F79F24',
  },
  stepNumber: {
    fontSize: 12,
    fontWeight: '600',
    color: '#9CA3AF',
  },
  stepNumberCurrent: {
    color: '#FFFFFF',
  },
  checkmark: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  connector: {
    width: 40,
    height: 3,
    backgroundColor: '#E5E7EB',
    marginHorizontal: 4,
  },
  connectorCompleted: {
    backgroundColor: '#22C55E',
  },
  stepLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: '#6B7280',
  },
});
