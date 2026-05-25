import React, { useCallback } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AiBadge } from '../shared/AiBadge';
import { colors, fonts } from '@/constants/theme';

interface ChipItem {
  value: string;
  label: string;
}

interface ChipSelectorProps {
  label: string;
  selectedValues: string[];
  aiSuggestedIds: string[];
  allItems: ChipItem[];
  hasAiConfidence?: boolean;
  onToggle: (id: string) => void;
  onViewAll: () => void;
  resolveLabel?: (id: string) => string;
}

export const ChipSelector = React.memo(function ChipSelector({
  label,
  selectedValues,
  aiSuggestedIds,
  allItems,
  hasAiConfidence,
  onToggle,
  onViewAll,
  resolveLabel,
}: ChipSelectorProps) {
  const getLabel = useCallback(
    (id: string): string => {
      if (resolveLabel) return resolveLabel(id);
      const item = allItems.find((i) => i.value === id);
      return item?.label || id;
    },
    [resolveLabel, allItems],
  );

  return (
    <View style={styles.chipSection}>
      <View style={styles.chipHeader}>
        <Text style={styles.chipLabel}>{label}</Text>
        {hasAiConfidence ? <AiBadge /> : null}
      </View>
      <View style={styles.chipRow}>
        {/* AI-suggested items first */}
        {aiSuggestedIds.map((id) => {
          const isSelected = selectedValues.includes(id);
          return (
            <Pressable
              key={id}
              style={({ pressed }) => [
                styles.chip,
                !isSelected && styles.chipAISuggested,
                isSelected && styles.chipAISuggestedActive,
                pressed && { opacity: 0.7 },
              ]}
              onPress={() => onToggle(id)}
            >
              <Text
                style={[
                  styles.chipText,
                  isSelected && styles.chipTextSelected,
                ]}
              >
                {getLabel(id)}
              </Text>
            </Pressable>
          );
        })}
        {/* User-selected items NOT in AI suggestions */}
        {selectedValues
          .filter((id) => !aiSuggestedIds.includes(id))
          .map((id) => (
            <Pressable
              key={id}
              style={({ pressed }) => [
                styles.chip,
                styles.chipSelected,
                pressed && { opacity: 0.7 },
              ]}
              onPress={() => onToggle(id)}
            >
              <Text style={[styles.chipText, styles.chipTextSelected]}>
                {getLabel(id)}
              </Text>
              <Ionicons name="close" size={10} color={colors.white} />
            </Pressable>
          ))}
        {/* View all button */}
        <Pressable
          style={({ pressed }) => [
            styles.chipViewAll,
            pressed && { opacity: 0.7 },
          ]}
          onPress={onViewAll}
        >
          <Text style={styles.chipViewAllText}>Toutes</Text>
          <Ionicons name="chevron-forward" size={14} color={colors.muted} />
        </Pressable>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  chipSection: {
    marginBottom: 14,
  },
  chipHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  chipLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: 11,
    letterSpacing: 0.88,
    color: colors.muted,
    textTransform: 'uppercase',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 2,
    backgroundColor: colors.white,
  },
  chipSelected: {
    backgroundColor: colors.charcoal,
    borderColor: colors.charcoal,
  },
  chipAISuggested: {
    borderColor: 'rgba(122,140,110,0.4)',
    backgroundColor: 'rgba(122,140,110,0.06)',
  },
  chipAISuggestedActive: {
    backgroundColor: colors.sage,
    borderColor: colors.sage,
  },
  chipText: {
    fontFamily: fonts.sans,
    fontSize: 11,
    color: colors.charcoal,
    letterSpacing: 0.44,
  },
  chipTextSelected: {
    color: colors.white,
  },
  chipViewAll: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  chipViewAllText: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    color: colors.muted,
    letterSpacing: 0.2,
  },
});
