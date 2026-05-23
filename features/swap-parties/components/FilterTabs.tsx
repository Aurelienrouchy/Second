/**
 * FilterTabs — Horizontal scrollable filter tabs for swap zones list
 */

import React from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  Text as RNText,
} from 'react-native';

import { colors, fonts, spacing } from '@/constants/theme';

export type FilterTab = 'all' | 'active' | 'upcoming' | 'my';

const FILTER_TABS: { label: string; value: FilterTab }[] = [
  { label: 'Toutes', value: 'all' },
  { label: 'En cours', value: 'active' },
  { label: 'À venir', value: 'upcoming' },
  { label: 'Mes zones', value: 'my' },
];

interface FilterTabsProps {
  activeFilter: FilterTab;
  onFilterChange: (filter: FilterTab) => void;
}

export const FilterTabs = React.memo(function FilterTabs({
  activeFilter,
  onFilterChange,
}: FilterTabsProps) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.filterScrollView}
      contentContainerStyle={styles.filterContentContainer}
    >
      {FILTER_TABS.map((tab) => (
        <Pressable
          key={tab.value}
          style={[
            styles.filterTab,
            activeFilter === tab.value && styles.filterTabActive,
          ]}
          onPress={() => onFilterChange(tab.value)}
        >
          <RNText
            style={[
              styles.filterTabText,
              activeFilter === tab.value && styles.filterTabTextActive,
            ]}
          >
            {tab.label}
          </RNText>
        </Pressable>
      ))}
    </ScrollView>
  );
});

const styles = StyleSheet.create({
  filterScrollView: {
    flexGrow: 0,
    flexShrink: 0,
    paddingHorizontal: spacing.lg,
    backgroundColor: '#131510',
  },
  filterContentContainer: {
    gap: 8,
    paddingBottom: spacing.lg,
  },
  filterTab: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 100,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  filterTabActive: {
    backgroundColor: colors.sage,
    borderColor: colors.sage,
  },
  filterTabText: {
    fontFamily: fonts.sans,
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 0.88,
    color: 'rgba(255, 255, 255, 0.5)',
    textTransform: 'uppercase',
  },
  filterTabTextActive: {
    color: '#FFFFFF',
  },
});
