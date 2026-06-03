import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ConfidenceLevel } from '@/types/ai';
import { colors, fonts } from '@/constants/theme';
import { CONDITIONS } from '@/data/conditions';

type ConditionValue = 'neuf' | 'très bon état' | 'bon état' | 'satisfaisant';

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
  const currentLabel = CONDITIONS.find((c) => c.value === value)?.label || value;
  const currentIndex = CONDITIONS.findIndex((c) => c.value === value);

  const handleCycle = () => {
    const nextIndex = (currentIndex + 1) % CONDITIONS.length;
    onChange(CONDITIONS[nextIndex].value as ConditionValue);
  };

  return (
    <TouchableOpacity
      style={styles.container}
      onPress={handleCycle}
      activeOpacity={0.7}
    >
      <Text style={styles.label}>ETAT</Text>
      <View style={styles.valueContainer}>
        <Text style={styles.value}>{currentLabel}</Text>
        {confidenceLevel && (
          <View style={styles.aiBadge}>
            <Text style={styles.aiBadgeText}>IA</Text>
          </View>
        )}
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.muted} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  label: {
    fontFamily: fonts.sansMedium,
    fontSize: 11,
    letterSpacing: 0.88,
    color: colors.muted,
    width: 80,
    textTransform: 'uppercase',
  },
  valueContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  value: {
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.charcoal,
  },
  aiBadge: {
    backgroundColor: colors.sageLight,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 100,
    marginLeft: 8,
  },
  aiBadgeText: {
    fontFamily: fonts.sansMedium,
    fontSize: 9,
    color: colors.sage,
    letterSpacing: 0.72,
  },
});
