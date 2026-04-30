import React from 'react';
import {
  StyleSheet,
  View,
  ScrollView,
  Text,
  Pressable,
  ViewStyle,
  GestureResponderEvent,
} from 'react-native';
import {
  colors,
  spacing,
  typography,
} from '@/constants/theme';
import { FilterChip } from '@/components/atoms/FilterChip';

export interface FilterConfig {
  label: string;
  active: boolean;
  icon?: React.ReactNode;
}

export interface FilterRowProps {
  filters: FilterConfig[];
  onFilterPress: (index: number, event: GestureResponderEvent) => void;
  resultCount?: number;
  sortLabel?: string;
  onSortPress?: (event: GestureResponderEvent) => void;
  style?: ViewStyle;
}

export const FilterRow: React.FC<FilterRowProps> = ({
  filters,
  onFilterPress,
  resultCount,
  sortLabel,
  onSortPress,
  style,
}) => {
  const styles = getStyles();

  return (
    <View style={[styles.container, style]}>
      {(resultCount !== undefined || sortLabel) && (
        <View style={styles.resultRow}>
          {resultCount !== undefined && (
            <Text style={styles.resultCount}>
              {resultCount.toLocaleString('fr-FR')} articles
            </Text>
          )}
          {sortLabel && onSortPress && (
            <Pressable
              onPress={onSortPress}
              style={({ pressed }) => [
                {
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <Text style={styles.sortLabel}>{sortLabel} ▾</Text>
            </Pressable>
          )}
        </View>
      )}

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={16}
        contentContainerStyle={styles.scrollContent}
      >
        {filters.map((filter, index) => (
          <FilterChip
            key={`${filter.label}-${index}`}
            label={filter.label}
            active={filter.active}
            icon={filter.icon}
            onPress={(e) => onFilterPress(index, e)}
          />
        ))}
      </ScrollView>
    </View>
  );
};

function getStyles() {
  return StyleSheet.create({
    container: {
      backgroundColor: colors.cream,
      paddingVertical: spacing.lg,
    },
    resultRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: spacing.xl,
      marginBottom: spacing.lg,
    },
    resultCount: {
      fontSize: 13,
      fontWeight: '300',
      color: colors.charcoal,
      lineHeight: 21,
    },
    sortLabel: {
      fontSize: 13,
      fontWeight: '300',
      color: colors.charcoal,
      lineHeight: 21,
    },
    scrollContent: {
      paddingHorizontal: spacing.xl,
      gap: spacing.lg,
    },
  });
}
