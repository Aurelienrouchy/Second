/**
 * MyArticlesSection Component — Swap Zone (DARK identity)
 * Shows the user's deposited articles with add/remove actions. Always available
 * to an authenticated user (the zone is open to all — no join gate).
 */

import React from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeInDown, FadeOut, LinearTransition } from 'react-native-reanimated';

import { Text } from '@/components/ui';
import { colors, fonts, spacing, radius, sizing } from '@/constants/theme';
import { formatPrice } from '@/utils/formatPrice';
import type { MyArticlesSectionProps } from '../types';

export const MyArticlesSection = React.memo(function MyArticlesSection({
  userItems,
  onAddPress,
  onRemoveItem,
}: MyArticlesSectionProps) {
  return (
    <View style={styles.section}>
      <View style={styles.labelRow}>
        <Text style={styles.label}>
          {"Mes articles à l'échange · "}{userItems.length}
        </Text>
        <Pressable
          style={({ pressed }) => [styles.addButton, pressed && styles.pressed]}
          onPress={onAddPress}
        >
          <Ionicons name="add" size={sizing.iconSM} color={colors.cream} />
          <Text style={styles.addButtonText}>Déposer un article</Text>
        </Pressable>
      </View>

      {userItems.length > 0 ? (
        <View style={styles.list}>
          {userItems.map((item) => (
            <Animated.View
              key={item.id}
              style={styles.row}
              entering={FadeInDown.duration(220)}
              exiting={FadeOut.duration(160)}
              layout={LinearTransition.duration(220)}
            >
              <Image source={{ uri: item.imageUrl }} style={styles.rowImage} recyclingKey={item.id} />
              <View style={styles.rowContent}>
                <Text style={styles.rowBrand}>{item.brand || 'BRAND'}</Text>
                <Text style={styles.rowTitle} numberOfLines={1}>{item.title}</Text>
                <Text style={styles.rowStatus}>Disponible au swap</Text>
              </View>
              <View style={styles.rowValue}>
                <Text style={styles.rowValueLabel}>Valeur</Text>
                <Text style={styles.rowPrice}>{formatPrice(item.price)}</Text>
              </View>
              <Pressable
                style={({ pressed }) => [styles.removeButton, pressed && styles.pressed]}
                onPress={() => onRemoveItem(item.articleId)}
              >
                <Ionicons name="close-circle" size={20} color={colors.sand} />
              </Pressable>
            </Animated.View>
          ))}
        </View>
      ) : (
        <View style={styles.empty}>
          <Ionicons name="shirt-outline" size={sizing.iconMD} color={colors.sage} />
          <Text style={styles.emptyText}>Aucun article déposé pour l&apos;instant</Text>
        </View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  section: {
    backgroundColor: colors.darkSurface1,
    borderBottomWidth: 1,
    borderBottomColor: colors.darkBorder,
    borderLeftWidth: 3,
    borderLeftColor: colors.rust,
    paddingHorizontal: spacing.md + 4,
    paddingVertical: spacing.md - 2,
  },
  pressed: {
    opacity: 0.7,
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  label: {
    fontSize: 10,
    fontFamily: fonts.sansMedium,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: colors.sand,
    flexShrink: 1,
    marginRight: spacing.sm,
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xs + 2,
    paddingHorizontal: spacing.sm + 2,
    backgroundColor: colors.rust,
    borderRadius: radius.none,
  },
  addButtonText: {
    fontSize: 10,
    fontFamily: fonts.sansMedium,
    letterSpacing: 1.0,
    textTransform: 'uppercase',
    color: colors.cream,
  },
  list: {
    gap: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 2,
  },
  rowImage: {
    width: 48,
    height: 60,
    backgroundColor: colors.deep,
    borderRadius: radius.none,
  },
  rowContent: {
    flex: 1,
  },
  rowBrand: {
    fontSize: 10,
    fontFamily: fonts.sansMedium,
    letterSpacing: 1.0,
    textTransform: 'uppercase',
    color: colors.whiteTranslucent,
    marginBottom: 2,
  },
  rowTitle: {
    fontFamily: fonts.display,
    fontSize: 15,
    color: colors.cream,
    marginBottom: spacing.xs + 2,
  },
  rowStatus: {
    fontSize: 11,
    fontFamily: fonts.sans,
    color: colors.sage,
  },
  rowValue: {
    alignItems: 'flex-end',
  },
  rowValueLabel: {
    fontSize: 11,
    fontFamily: fonts.sans,
    color: colors.whiteTranslucent,
  },
  rowPrice: {
    fontFamily: fonts.display,
    fontSize: 18,
    color: colors.cream,
  },
  removeButton: {
    padding: spacing.xs,
    marginLeft: spacing.xs,
  },
  empty: {
    paddingVertical: spacing.lg,
    alignItems: 'center',
    gap: spacing.sm,
  },
  emptyText: {
    fontSize: 11,
    fontFamily: fonts.sans,
    color: colors.sand,
  },
});
