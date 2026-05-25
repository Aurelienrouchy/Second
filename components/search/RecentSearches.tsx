/**
 * RecentSearches — Seconde (Editorial Design)
 *
 * Shows trending searches as flat sharp-corner tags
 * and recent search history as clean list items.
 *
 * Design system: Cormorant Garamond (serif) + Satoshi (sans)
 * Sharp corners on tags. No emojis.
 */

import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React, { useCallback } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { colors, fonts, spacing, typography } from '@/constants/theme';
import { SearchHistoryItem, SearchHistoryService } from '@/services/searchHistoryService';

// =============================================================================
// TRENDING SUGGESTIONS
// =============================================================================

const TRENDING_SEARCHES = [
  'Sac Polene',
  'Veste en cuir',
  'Jean Levi\'s 501',
  'Robe vintage',
  'Baskets Nike',
  'Pull cachemire',
  'Sezane',
  'Manteau laine',
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
        <ActivityIndicator size="small" color={colors.rust} />
      </View>
    );
  }

  if (searches.length === 0) {
    return (
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.contentContainer}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* ── Trending Section ── */}
        <Animated.View entering={FadeInDown.duration(300).delay(50)}>
          <Text style={styles.sectionLabel}>TENDANCES</Text>
          <View style={styles.trendingGrid}>
            {TRENDING_SEARCHES.map((item) => (
              <Pressable
                key={item}
                style={styles.trendingTag}
                onPress={() => handleTrendingPress(item)}
              >
                <Text style={styles.trendingTagText}>{item}</Text>
              </Pressable>
            ))}
          </View>
        </Animated.View>

        {/* ── Empty hint ── */}
        <Animated.View entering={FadeInDown.duration(300).delay(150)} style={styles.emptyHint}>
          <Ionicons name="search-outline" size={28} color={colors.borderStrong} />
          <Text style={styles.emptyText}>Vos recherches apparaîtront ici</Text>
        </Animated.View>
      </ScrollView>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.contentContainer}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {/* ── Trending Section ── */}
      <Animated.View entering={FadeInDown.duration(300).delay(50)}>
        <Text style={styles.sectionLabel}>TENDANCES</Text>
        <View style={styles.trendingGrid}>
          {TRENDING_SEARCHES.map((item) => (
            <Pressable
              key={item}
              style={styles.trendingTag}
              onPress={() => handleTrendingPress(item)}
            >
              <Text style={styles.trendingTagText}>{item}</Text>
            </Pressable>
          ))}
        </View>
      </Animated.View>

      {/* ── Recent searches ── */}
      <Animated.View entering={FadeInDown.duration(300).delay(100)}>
        <Text style={[styles.sectionLabel, { marginTop: spacing.lg }]}>RECHERCHES RÉCENTES</Text>

        {searches.map((item) => (
          <Pressable
            key={item.id}
            style={styles.searchItem}
            onPress={() => onSearchTap(item)}
          >
            <Ionicons name="time-outline" size={18} color={colors.muted} style={styles.itemIcon} />

            <View style={styles.itemContent}>
              <Text style={styles.itemText} numberOfLines={1}>
                {SearchHistoryService.formatSearchDisplay(item)}
              </Text>
              {item.resultCount !== undefined && item.resultCount > 0 && (
                <Text style={styles.itemSubtext}>
                  {item.resultCount} article{item.resultCount > 1 ? 's' : ''}
                </Text>
              )}
            </View>

            <Pressable
              onPress={() => onSearchDelete(item)}
              style={styles.deleteButton}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="close" size={16} color={colors.borderStrong} />
            </Pressable>
          </Pressable>
        ))}
      </Animated.View>
    </ScrollView>
  );
}

// =============================================================================
// STYLES — Editorial Design
// =============================================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  contentContainer: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },

  // ── Section label ──
  sectionLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: 10,
    letterSpacing: 1.8,
    textTransform: 'uppercase',
    color: colors.muted,
    marginBottom: 12,
  },

  // ── Trending tags — sharp corners ──
  trendingGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  trendingTag: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 0, // Sharp corners — editorial
    backgroundColor: 'transparent',
  },
  trendingTagText: {
    fontFamily: fonts.sans,
    fontSize: 12,
    letterSpacing: 0.3,
    color: colors.charcoal,
  },

  // ── Search items ──
  searchItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  itemIcon: {
    marginRight: 12,
  },
  itemContent: {
    flex: 1,
  },
  itemText: {
    fontFamily: fonts.sans,
    fontSize: 14,
    letterSpacing: 0.1,
    color: colors.charcoal,
  },
  itemSubtext: {
    fontFamily: fonts.sans,
    fontSize: 11,
    letterSpacing: 0.2,
    color: colors.muted,
    marginTop: 2,
  },
  deleteButton: {
    padding: spacing.sm,
  },

  // ── Empty hint ──
  emptyHint: {
    alignItems: 'center',
    paddingTop: 48,
    gap: 10,
  },
  emptyText: {
    fontFamily: fonts.sans,
    fontSize: 13,
    letterSpacing: 0.1,
    color: colors.muted,
    textAlign: 'center',
  },
});
