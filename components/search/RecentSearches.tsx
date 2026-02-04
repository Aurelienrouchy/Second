import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React, { useCallback } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { colors, radius, spacing, typography } from '@/constants/theme';
import { SearchHistoryItem, SearchHistoryService } from '@/services/searchHistoryService';

// =============================================================================
// TRENDING SUGGESTIONS
// =============================================================================

const TRENDING_SEARCHES = [
  { label: 'Sac Polène', icon: 'trending-up-outline' as const },
  { label: 'Veste en cuir', icon: 'trending-up-outline' as const },
  { label: 'Jean Levi\'s 501', icon: 'trending-up-outline' as const },
  { label: 'Robe vintage', icon: 'trending-up-outline' as const },
  { label: 'Baskets Nike', icon: 'trending-up-outline' as const },
  { label: 'Pull cachemire', icon: 'trending-up-outline' as const },
  { label: 'Sézane', icon: 'trending-up-outline' as const },
  { label: 'Manteau laine', icon: 'trending-up-outline' as const },
];

// =============================================================================
// TYPES
// =============================================================================

interface RecentSearchesProps {
  searches: SearchHistoryItem[];
  isLoading: boolean;
  onSearchTap: (item: SearchHistoryItem) => void;
  onSearchDelete: (item: SearchHistoryItem) => void;
  onTrendingTap?: (query: string) => void;
}

// =============================================================================
// COMPONENT
// =============================================================================

export default function RecentSearches({
  searches,
  isLoading,
  onSearchTap,
  onSearchDelete,
  onTrendingTap,
}: RecentSearchesProps) {
  const handleTrendingPress = useCallback((query: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onTrendingTap?.(query);
  }, [onTrendingTap]);

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="small" color={colors.primary} />
      </View>
    );
  }

  if (searches.length === 0) {
    return (
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.emptyContentContainer}
        keyboardShouldPersistTaps="handled"
      >
        {/* Trending Section */}
        <View style={styles.trendingSection}>
          <View style={styles.trendingHeader}>
            <Ionicons name="flame-outline" size={18} color={colors.primary} />
            <Text style={styles.sectionTitle}>Tendances</Text>
          </View>

          <View style={styles.trendingPills}>
            {TRENDING_SEARCHES.map((item) => (
              <Pressable
                key={item.label}
                style={styles.trendingPill}
                onPress={() => handleTrendingPress(item.label)}
              >
                <Ionicons name={item.icon} size={14} color={colors.primary} />
                <Text style={styles.trendingPillText}>{item.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Empty State Hint */}
        <View style={styles.emptyHint}>
          <Ionicons name="search-outline" size={32} color={colors.border} />
          <Text style={styles.emptySubtitle}>
            Vos recherches apparaîtront ici
          </Text>
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.contentContainer}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.sectionTitle}>Recherches récentes</Text>

      {searches.map((item) => (
        <TouchableOpacity
          key={item.id}
          style={styles.searchItem}
          onPress={() => onSearchTap(item)}
          activeOpacity={0.7}
        >
          <Ionicons name="time-outline" size={20} color={colors.muted} style={styles.itemIcon} />

          <View style={styles.itemContent}>
            <Text style={styles.itemText} numberOfLines={1}>
              {SearchHistoryService.formatSearchDisplay(item)}
            </Text>
            {item.resultCount !== undefined && item.resultCount > 0 && (
              <Text style={styles.itemSubtext}>
                {item.resultCount} résultat{item.resultCount > 1 ? 's' : ''}
              </Text>
            )}
          </View>

          <TouchableOpacity
            onPress={() => onSearchDelete(item)}
            style={styles.deleteButton}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="close" size={18} color={colors.border} />
          </TouchableOpacity>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

// =============================================================================
// STYLES
// =============================================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  contentContainer: {
    paddingVertical: spacing.md,
  },
  emptyContentContainer: {
    paddingVertical: spacing.md,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Trending
  trendingSection: {
    paddingHorizontal: spacing.md,
    marginBottom: spacing.lg,
  },
  trendingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  trendingPills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  trendingPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    backgroundColor: colors.primaryLight,
    borderWidth: 1,
    borderColor: 'rgba(0, 47, 167, 0.15)',
  },
  trendingPillText: {
    fontFamily: typography.label.fontFamily,
    fontSize: typography.label.fontSize,
    color: colors.primary,
  },

  // Empty Hint
  emptyHint: {
    alignItems: 'center',
    paddingTop: spacing.xl,
    gap: spacing.sm,
  },
  emptySubtitle: {
    fontFamily: typography.bodySmall.fontFamily,
    fontSize: typography.bodySmall.fontSize,
    color: colors.muted,
    textAlign: 'center',
  },

  // Section Title
  sectionTitle: {
    fontFamily: typography.label.fontFamily,
    fontSize: 13,
    fontWeight: '600',
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },

  // Search Items
  searchItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm + 4,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
  },
  itemIcon: {
    marginRight: spacing.sm + 4,
  },
  itemContent: {
    flex: 1,
  },
  itemText: {
    fontFamily: typography.body.fontFamily,
    fontSize: typography.body.fontSize,
    color: colors.foreground,
  },
  itemSubtext: {
    fontFamily: typography.caption.fontFamily,
    fontSize: typography.caption.fontSize,
    color: colors.muted,
    marginTop: 2,
  },
  deleteButton: {
    padding: spacing.sm,
  },
});
