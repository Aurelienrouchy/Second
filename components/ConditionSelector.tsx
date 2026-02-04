import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import ConfidenceIndicator from './ConfidenceIndicator';
import { ConfidenceLevel } from '@/types/ai';

type ConditionValue = 'neuf' | 'très bon état' | 'bon état' | 'satisfaisant';

interface ConditionOption {
  value: ConditionValue;
  label: string;
  description: string;
  icon: string;
}

const CONDITIONS: ConditionOption[] = [
  {
    value: 'neuf',
    label: 'Neuf avec étiquettes',
    description: 'Article jamais porté, étiquettes d\'origine',
    icon: '✨',
  },
  {
    value: 'très bon état',
    label: 'Très bon état',
    description: 'Porté quelques fois, aucun défaut visible',
    icon: '👌',
  },
  {
    value: 'bon état',
    label: 'Bon état',
    description: 'Porté, quelques défauts mineurs',
    icon: '👍',
  },
  {
    value: 'satisfaisant',
    label: 'Satisfaisant',
    description: 'Signes d\'usure visibles',
    icon: '🤷',
  },
];

interface ConditionSelectorProps {
  value: ConditionValue;
  onChange: (value: ConditionValue) => void;
  confidenceLevel?: ConfidenceLevel;
}

export default function ConditionSelector({
  value,
  onChange,
  confidenceLevel,
}: ConditionSelectorProps) {
  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.labelContainer}>
          <Text style={styles.label}>
            État
            <Text style={styles.required}> *</Text>
          </Text>
          {confidenceLevel && (
            <ConfidenceIndicator level={confidenceLevel} />
          )}
        </View>
      </View>

      {/* Options */}
      <View style={styles.optionsContainer}>
        {CONDITIONS.map((condition) => {
          const isSelected = value === condition.value;
          return (
            <TouchableOpacity
              key={condition.value}
              style={[
                styles.option,
                isSelected && styles.optionSelected,
              ]}
              onPress={() => onChange(condition.value)}
              activeOpacity={0.7}
            >
              <View style={styles.optionContent}>
                <View style={styles.optionHeader}>
                  <Text style={styles.optionIcon}>{condition.icon}</Text>
                  <Text
                    style={[
                      styles.optionLabel,
                      isSelected && styles.optionLabelSelected,
                    ]}
                  >
                    {condition.label}
                  </Text>
                </View>
                <Text
                  style={[
                    styles.optionDescription,
                    isSelected && styles.optionDescriptionSelected,
                  ]}
                  numberOfLines={1}
                >
                  {condition.description}
                </Text>
              </View>

              {/* Radio indicator */}
              <View
                style={[
                  styles.radio,
                  isSelected && styles.radioSelected,
                ]}
              >
                {isSelected && <View style={styles.radioInner} />}
              </View>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 20,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  labelContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  required: {
    color: '#EF4444',
  },
  optionsContainer: {
    gap: 8,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    padding: 14,
    borderWidth: 2,
    borderColor: '#E5E7EB',
  },
  optionSelected: {
    backgroundColor: '#F5F3FF',
    borderColor: '#8B5CF6',
  },
  optionContent: {
    flex: 1,
  },
  optionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 2,
  },
  optionIcon: {
    fontSize: 16,
  },
  optionLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#374151',
  },
  optionLabelSelected: {
    color: '#5B21B6',
  },
  optionDescription: {
    fontSize: 13,
    color: '#6B7280',
    marginLeft: 24,
  },
  optionDescriptionSelected: {
    color: '#7C3AED',
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: '#D1D5DB',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 12,
  },
  radioSelected: {
    borderColor: '#8B5CF6',
  },
  radioInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#8B5CF6',
  },
});
