/**
 * CategoryTree — Seconde (Editorial Design)
 *
 * Hierarchical category navigation with breadcrumb header.
 * Sharp corners, icon containers, editorial typography.
 *
 * Design system: Cormorant Garamond (serif) + Satoshi (sans)
 */

import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';

import { CategoryNode } from '@/data/categories-v2';
import { colors, fonts, spacing, typography } from '@/constants/theme';

interface CategoryTreeProps {
  navigationPath: CategoryNode[];
  currentList: CategoryNode[];
  currentTitle: string;
  isAtRoot: boolean;
  onCategorySelect: (category: CategoryNode) => string[] | null;
  onBack: () => void;
  onSelectCurrent: () => string[];
}

export default function CategoryTree({
  navigationPath,
  currentList,
  currentTitle,
  isAtRoot,
  onCategorySelect,
  onBack,
  onSelectCurrent,
}: CategoryTreeProps) {
  return (
    <View style={styles.container}>
      {/* ── Breadcrumb Header ── */}
      {!isAtRoot && (
        <Animated.View entering={FadeIn.duration(200)} style={styles.breadcrumbHeader}>
          <Pressable onPress={onBack} style={styles.backButton} hitSlop={8}>
            <Ionicons name="chevron-back" size={22} color={colors.charcoal} />
          </Pressable>

          <Text style={styles.breadcrumbTitle} numberOfLines={1}>
            {currentTitle}
          </Text>

          <Pressable onPress={onSelectCurrent} style={styles.selectButton} hitSlop={4}>
            <Text style={styles.selectButtonText}>CHOISIR</Text>
          </Pressable>
        </Animated.View>
      )}

      {/* ── Category List ── */}
      <ScrollView
        style={styles.list}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {currentList.map((category, index) => (
          <Animated.View
            key={category.id}
            entering={FadeInDown.duration(250).delay(index * 30)}
          >
            <Pressable
              style={styles.categoryItem}
              onPress={() => onCategorySelect(category)}
            >
              {category.icon && (
                <View style={styles.iconContainer}>
                  <Ionicons
                    name={getCategoryIconName(category.icon)}
                    size={20}
                    color={colors.rust}
                  />
                </View>
              )}

              <Text style={styles.categoryLabel}>{category.label}</Text>

              {category.children && category.children.length > 0 ? (
                <Ionicons name="chevron-forward" size={18} color={colors.muted} />
              ) : (
                <View style={styles.leafDot} />
              )}
            </Pressable>
          </Animated.View>
        ))}
      </ScrollView>
    </View>
  );
}

// Helper to map category icon strings to Ionicons names
function getCategoryIconName(icon: string): keyof typeof Ionicons.glyphMap {
  const iconMap: Record<string, keyof typeof Ionicons.glyphMap> = {
    woman: 'woman-outline',
    man: 'man-outline',
    happy: 'happy-outline',
    home: 'home-outline',
    'game-controller': 'game-controller-outline',
    paw: 'paw-outline',
  };

  return iconMap[icon] || 'folder-outline';
}

// =============================================================================
// STYLES — Editorial Design
// =============================================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },

  // ── Breadcrumb Header ──
  breadcrumbHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surfaceWarm,
  },
  backButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  breadcrumbTitle: {
    flex: 1,
    fontFamily: fonts.displayMedium,
    fontSize: 18,
    letterSpacing: -0.2,
    color: colors.charcoal,
    textAlign: 'center',
    marginHorizontal: 8,
  },
  selectButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  selectButtonText: {
    fontFamily: fonts.sansMedium,
    fontSize: 11,
    letterSpacing: 1.5,
    color: colors.rust,
  },

  // ── Category List ──
  list: {
    flex: 1,
  },
  listContent: {
    paddingBottom: 24,
  },
  categoryItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: 14,
  },
  iconContainer: {
    width: 40,
    height: 40,
    backgroundColor: colors.surfaceWarm,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 0, // Sharp corners — editorial
  },
  categoryLabel: {
    flex: 1,
    fontFamily: fonts.sans,
    fontSize: 15,
    letterSpacing: 0.1,
    color: colors.charcoal,
  },
  leafDot: {
    width: 6,
    height: 6,
    backgroundColor: colors.borderStrong,
    borderRadius: 0, // Sharp — tiny square
  },
});
