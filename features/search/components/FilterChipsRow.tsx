/**
 * FilterChipsRow — horizontal scrolling row of filter chips.
 */

import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React from 'react';
import { Pressable, ScrollView, Text } from 'react-native';

import { colors } from '@/constants/theme';

import { searchStyles as styles } from '../styles';

export interface FilterChip {
  key: string;
  label: string;
  active: boolean;
  onPress: () => void;
  /**
   * When provided and the chip is active, a small X is rendered that clears
   * this filter dimension (L3). Tapping the X never opens the sheet.
   */
  onRemove?: () => void;
}

export interface FilterChipsRowProps {
  chips: FilterChip[];
  /**
   * Visual tone. 'light' (default) = standard cream/charcoal search row.
   * 'dark' = Swap Zone identity (chips on a deep surface). Dark variants are
   * additive and never touch the shared light styles.
   */
  tone?: 'light' | 'dark';
}

function FilterChipsRowComponent({ chips, tone = 'light' }: FilterChipsRowProps) {
  const isDark = tone === 'dark';
  // Chevron color follows the chip text color per tone.
  const inactiveChevron = isDark ? colors.sand : colors.muted;
  const activeChevron = isDark ? colors.cream : colors.white;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={[styles.filterChipsContainer, isDark && styles.filterChipsContainerDark]}
      contentContainerStyle={styles.filterChipsContent}
    >
      {chips.map(({ key, label, active, onPress }) => (
        <Pressable
          key={key}
          style={[
            styles.filterChip,
            active && styles.filterChipActive,
            isDark && styles.filterChipDark,
            isDark && active && styles.filterChipActiveDark,
          ]}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            onPress();
          }}
        >
          <Text
            style={[
              styles.filterChipText,
              active && styles.filterChipTextActive,
              isDark && styles.filterChipTextDark,
              isDark && active && styles.filterChipTextActiveDark,
            ]}
            numberOfLines={1}
          >
            {label}
          </Text>
          <Ionicons
            name="chevron-down"
            size={14}
            color={active ? activeChevron : inactiveChevron}
          />
        </Pressable>
      ))}
    </ScrollView>
  );
}

export const FilterChipsRow = React.memo(FilterChipsRowComponent);
