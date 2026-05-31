/**
 * HomeHeader Component
 * Dark header with search bar, camera, notifications, and category tags.
 * Consumes useNotifications() directly — independent from parent.
 */

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';

import { colors, spacing, fonts, radius, sizing } from '@/constants/theme';
import { useNotificationStore, selectUnreadCount } from '@/store/notificationStore';
import { CATEGORIES } from '@/data/categories-v2';

const QUICK_CATEGORIES = CATEGORIES.map((cat: any) => ({
  id: cat.id,
  label: cat.label,
}));

interface HomeHeaderProps {
  onSearchPress: () => void;
  onCameraPress: () => void;
  onCategoryPress: (categoryId: string) => void;
}

const HomeHeaderComponent: React.FC<HomeHeaderProps> = ({
  onSearchPress,
  onCameraPress,
  onCategoryPress,
}) => {
  const notificationCount = useNotificationStore(selectUnreadCount);

  return (
    <View style={styles.darkHeader}>
      {/* Search bar row */}
      <View style={styles.searchRow}>
        <Pressable style={styles.searchInput} onPress={onSearchPress}>
          <Ionicons name="search-outline" size={16} color={colors.muted} />
          <Text style={styles.searchPlaceholder}>Rechercher...</Text>
        </Pressable>

        <Pressable style={styles.headerButton} onPress={onCameraPress}>
          <Ionicons name="camera-outline" size={22} color={colors.charcoal} />
        </Pressable>

        <Pressable
          style={styles.headerButton}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            router.push('/notifications' as any);
          }}
        >
          <Ionicons name="notifications-outline" size={22} color={colors.charcoal} />
          {notificationCount > 0 && (
            <View style={styles.notifBadge}>
              <Text style={styles.notifBadgeText}>
                {notificationCount > 9 ? '9+' : notificationCount}
              </Text>
            </View>
          )}
        </Pressable>
      </View>

      {/* Category tags row */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.categoriesContent}
      >
        {QUICK_CATEGORIES.map((category) => (
          <Pressable
            key={category.id}
            style={styles.categoryTag}
            onPress={() => onCategoryPress(category.id)}
          >
            <Text style={styles.categoryTagText}>{category.label}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
};

export const HomeHeader = React.memo(HomeHeaderComponent);

// =============================================================================
// STYLES
// =============================================================================

const styles = StyleSheet.create({
  darkHeader: {
    backgroundColor: colors.cream,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  searchInput: {
    flex: 1,
    height: sizing.buttonHeightSmall,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.white,
    borderRadius: 0,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  searchPlaceholder: {
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.muted,
  },
  headerButton: {
    width: sizing.buttonHeightSmall,
    height: sizing.buttonHeightSmall,
    borderRadius: 0,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    justifyContent: 'center',
    alignItems: 'center',
  },
  notifBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    minWidth: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.primary,
  },
  notifBadgeText: {
    fontFamily: fonts.sansBold,
    fontSize: 7,
    color: colors.white,
    textAlign: 'center',
  },
  categoriesContent: {
    gap: spacing.sm,
    paddingBottom: 2,
  },
  categoryTag: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  categoryTagText: {
    fontFamily: fonts.sans,
    fontSize: 11,
    color: colors.foregroundSecondary,
    letterSpacing: 0.8,
  },
});

export default HomeHeader;
