import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ViewStyle,
} from 'react-native';
import { colors, fonts, radius, spacing, typography } from '@/constants/theme';

interface PriceOption {
  label: string;
  value: string;
  selected?: boolean;
}

export interface PriceSuggestionProps {
  options: PriceOption[];
  onSelect?: (index: number) => void;
  headerLabel?: string;
  style?: ViewStyle;
}

export const PriceSuggestion: React.FC<PriceSuggestionProps> = ({
  options,
  onSelect,
  headerLabel = "Prix suggéré par l'IA",
  style,
}) => {
  return (
    <View style={[styles.container, style]}>
      <View style={styles.header}>
        <Text style={styles.headerLabel}>{headerLabel}</Text>
        <View style={styles.aiBadge}>
          <Text style={styles.aiBadgeText}>Marché MTL</Text>
        </View>
      </View>

      <View style={styles.optionsRow}>
        {options.map((option, index) => (
          <Pressable
            key={index}
            style={[
              styles.option,
              option.selected && styles.optionSelected,
            ]}
            onPress={() => onSelect?.(index)}
          >
            <Text
              style={[
                styles.optionLabel,
                option.selected && styles.optionLabelSelected,
              ]}
            >
              {option.label}
            </Text>
            <Text
              style={[
                styles.optionValue,
                option.selected && styles.optionValueSelected,
              ]}
            >
              {option.value}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    backgroundColor: colors.cream,
    padding: spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  headerLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.charcoal,
  },
  aiBadge: {
    backgroundColor: colors.sage,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 3,
  },
  aiBadgeText: {
    fontSize: 9,
    fontWeight: '700',
    color: colors.cream,
    textTransform: 'uppercase',
    letterSpacing: 0.05,
  },
  optionsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  option: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: 'rgba(0,0,0,0.15)',
    borderRadius: radius.sm,
    paddingVertical: 10,
    paddingHorizontal: 10,
    alignItems: 'center',
  },
  optionSelected: {
    borderColor: colors.rust,
    backgroundColor: 'rgba(204,102,76,0.08)',
  },
  optionLabel: {
    fontSize: 9,
    fontWeight: '600',
    color: 'rgba(245,240,232,0.5)',
    textTransform: 'uppercase',
    letterSpacing: 0.05,
    marginBottom: 4,
  },
  optionLabelSelected: {
    color: colors.rust,
  },
  optionValue: {
    fontFamily: fonts.serif,
    fontSize: 20,
    fontWeight: '300',
    color: colors.charcoal,
  },
  optionValueSelected: {
    color: colors.rust,
  },
});
