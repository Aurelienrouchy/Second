import React, { useState } from 'react';
import {
  Modal,
  Pressable,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ConfidenceLevel } from '@/types/ai';
import { colors, fonts } from '@/constants/theme';
import { CONDITIONS } from '@/data/conditions';

export type ConditionValue =
  | 'neuf'
  | 'neuf sans étiquette'
  | 'très bon état'
  | 'bon état'
  | 'satisfaisant';

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
  const [isOpen, setIsOpen] = useState(false);
  const currentLabel = CONDITIONS.find((condition) => condition.value === value)?.label || value;

  return (
    <>
      <TouchableOpacity
        testID="condition-selector"
        accessibilityRole="button"
        accessibilityLabel={`État, ${currentLabel}`}
        style={styles.container}
        onPress={() => setIsOpen(true)}
        activeOpacity={0.7}
      >
        <Text style={styles.label}>ÉTAT</Text>
        <View style={styles.valueContainer}>
          <Text style={styles.value}>{currentLabel}</Text>
          {confidenceLevel && (
            <View style={styles.aiBadge}>
              <Text style={styles.aiBadgeText}>IA</Text>
            </View>
          )}
        </View>
        <Ionicons name="chevron-down" size={18} color={colors.muted} />
      </TouchableOpacity>

      <Modal
        visible={isOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setIsOpen(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => setIsOpen(false)}>
          <View style={styles.menu} accessibilityRole="menu">
            <Text style={styles.menuTitle}>{"État de l'article"}</Text>
            {CONDITIONS.map((condition) => {
              const selected = condition.value === value;
              return (
                <Pressable
                  key={condition.value}
                  accessibilityRole="menuitem"
                  accessibilityState={{ selected }}
                  style={[styles.option, selected && styles.optionSelected]}
                  onPress={() => {
                    onChange(condition.value as ConditionValue);
                    setIsOpen(false);
                  }}
                >
                  <Text style={[styles.optionText, selected && styles.optionTextSelected]}>
                    {condition.label}
                  </Text>
                  {selected && <Ionicons name="checkmark" size={20} color={colors.primary} />}
                </Pressable>
              );
            })}
          </View>
        </Pressable>
      </Modal>
    </>
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
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
  },
  menu: {
    backgroundColor: colors.white,
    borderRadius: 16,
    padding: 16,
  },
  menuTitle: {
    fontFamily: fonts.sansMedium,
    fontSize: 16,
    color: colors.charcoal,
    marginBottom: 8,
  },
  option: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  optionSelected: {
    backgroundColor: colors.primaryLight,
  },
  optionText: {
    fontFamily: fonts.sans,
    fontSize: 15,
    color: colors.charcoal,
  },
  optionTextSelected: {
    fontFamily: fonts.sansMedium,
    color: colors.primary,
  },
});
