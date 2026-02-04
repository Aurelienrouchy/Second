import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import ConfidenceIndicator from './ConfidenceIndicator';
import { ConfidenceLevel } from '@/types/ai';

interface SmartSelectorOption {
  value: string;
  label: string;
  color?: string; // For color options
  isAISuggested?: boolean;
}

interface AllItemsOption {
  value: string;
  label: string;
  color?: string;
}

interface SmartSelectorProps {
  label: string;
  options: SmartSelectorOption[];
  selectedValue?: string | null;
  selectedValues?: string[];
  onSelect?: (value: string) => void;
  onSelectMultiple?: (values: string[]) => void;
  onViewAll: () => void;
  confidenceLevel?: ConfidenceLevel;
  viewAllLabel?: string;
  required?: boolean;
  emptyMessage?: string;
  multiSelect?: boolean;
  allItems?: AllItemsOption[]; // All available items for lookup
}

export default function SmartSelector({
  label,
  options,
  selectedValue,
  selectedValues = [],
  onSelect,
  onSelectMultiple,
  onViewAll,
  confidenceLevel,
  viewAllLabel = 'Voir tout',
  required = false,
  emptyMessage = 'Aucune suggestion',
  multiSelect = false,
  allItems = [],
}: SmartSelectorProps) {
  // Separate AI suggested options from others
  const aiSuggestions = options.filter((opt) => opt.isAISuggested);
  const hasAISuggestions = aiSuggestions.length > 0;

  // Check if selected value is in AI suggestions
  const selectedInAISuggestions = selectedValue && aiSuggestions.some(opt => opt.value === selectedValue);

  // If selected value is not in AI suggestions, we need to display it
  const selectedNotInSuggestions = selectedValue && !selectedInAISuggestions;

  // Look up selected value info from allItems
  const selectedItemInfo = selectedNotInSuggestions
    ? allItems.find(item => item.value === selectedValue)
    : null;
  const selectedLabel = selectedItemInfo?.label || selectedValue;
  const selectedColor = selectedItemInfo?.color;

  // Handle chip selection
  const handleChipPress = (value: string) => {
    if (multiSelect && onSelectMultiple) {
      const isCurrentlySelected = selectedValues.includes(value);
      if (isCurrentlySelected) {
        onSelectMultiple(selectedValues.filter(v => v !== value));
      } else {
        onSelectMultiple([...selectedValues, value]);
      }
    } else if (onSelect) {
      onSelect(value);
    }
  };

  // Check if a value is selected
  const isValueSelected = (value: string) => {
    if (multiSelect) {
      return selectedValues.includes(value);
    }
    return selectedValue === value;
  };

  // Get selection count for display
  const selectionCount = multiSelect ? selectedValues.length : (selectedValue ? 1 : 0);

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.labelContainer}>
          <Text style={styles.label}>
            {label}
            {required && <Text style={styles.required}> *</Text>}
          </Text>
          {selectionCount > 0 && multiSelect && (
            <View style={styles.countBadge}>
              <Text style={styles.countText}>{selectionCount}</Text>
            </View>
          )}
          {confidenceLevel && hasAISuggestions && (
            <ConfidenceIndicator level={confidenceLevel} />
          )}
        </View>
      </View>

      {/* Selected value (when not in AI suggestions) */}
      {selectedNotInSuggestions && (
        <View style={styles.selectedValueContainer}>
          <TouchableOpacity
            style={styles.selectedValueChip}
            onPress={onViewAll}
            activeOpacity={0.7}
          >
            {selectedColor && (
              <View
                style={[
                  styles.colorDot,
                  { backgroundColor: selectedColor },
                  selectedColor === '#FFFFFF' && styles.colorDotBorder,
                ]}
              />
            )}
            <Text style={styles.selectedValueText}>{selectedLabel}</Text>
            <Ionicons name="pencil" size={14} color="#10B981" style={{ marginLeft: 4 }} />
          </TouchableOpacity>
        </View>
      )}

      {/* AI Suggestion Chips - only show if no manual selection */}
      {hasAISuggestions && !selectedNotInSuggestions ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipsContainer}
        >
          {aiSuggestions.map((option) => {
            const isSelected = isValueSelected(option.value);
            return (
              <TouchableOpacity
                key={option.value}
                style={[
                  styles.chip,
                  isSelected && styles.chipSelected,
                ]}
                onPress={() => handleChipPress(option.value)}
                activeOpacity={0.7}
              >
                {/* Color dot for color options */}
                {option.color && (
                  <View
                    style={[
                      styles.colorDot,
                      { backgroundColor: option.color },
                      option.color === '#FFFFFF' && styles.colorDotBorder,
                    ]}
                  />
                )}
                <Text
                  style={[
                    styles.chipText,
                    isSelected && styles.chipTextSelected,
                  ]}
                >
                  {option.label}
                </Text>
                {isSelected && (
                  <Ionicons name="checkmark" size={16} color="#FFFFFF" />
                )}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      ) : !selectedNotInSuggestions && !hasAISuggestions ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>{emptyMessage}</Text>
        </View>
      ) : null}

      {/* View all link */}
      <TouchableOpacity style={styles.viewAllButton} onPress={onViewAll}>
        <Ionicons name="list-outline" size={18} color="#8B5CF6" />
        <Text style={styles.viewAllText}>{viewAllLabel}</Text>
        <Ionicons name="chevron-forward" size={16} color="#8B5CF6" />
      </TouchableOpacity>
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
  countBadge: {
    backgroundColor: '#8B5CF6',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginLeft: 4,
  },
  countText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  chipsContainer: {
    paddingRight: 16,
    gap: 8,
    flexDirection: 'row',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  chipSelected: {
    backgroundColor: '#8B5CF6',
    borderColor: '#8B5CF6',
  },
  chipText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#374151',
  },
  chipTextSelected: {
    color: '#FFFFFF',
  },
  colorDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
  },
  colorDotBorder: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
  },
  selectedValueContainer: {
    marginBottom: 8,
  },
  selectedValueChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: '#10B981',
    alignSelf: 'flex-start',
  },
  selectedValueText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#065F46',
  },
  emptyContainer: {
    backgroundColor: '#F9FAFB',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 14,
    color: '#9CA3AF',
  },
  viewAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 12,
    paddingVertical: 8,
  },
  viewAllText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#8B5CF6',
    flex: 1,
  },
});
