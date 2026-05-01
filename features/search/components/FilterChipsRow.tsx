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
}

export interface FilterChipsRowProps {
  chips: FilterChip[];
}

function FilterChipsRowComponent({ chips }: FilterChipsRowProps) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.filterChipsContainer}
      contentContainerStyle={styles.filterChipsContent}
    >
      {chips.map(({ key, label, active, onPress }) => (
        <Pressable
          key={key}
          style={[styles.filterChip, active && styles.filterChipActive]}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            onPress();
          }}
        >
          <Text
            style={[styles.filterChipText, active && styles.filterChipTextActive]}
            numberOfLines={1}
          >
            {label}
          </Text>
          <Ionicons name="chevron-down" size={14} color={active ? colors.white : colors.muted} />
        </Pressable>
      ))}
    </ScrollView>
  );
}

export const FilterChipsRow = React.memo(FilterChipsRowComponent);
