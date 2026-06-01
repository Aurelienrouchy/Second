/**
 * MyArticlesSection Component — Swap Zone (DARK identity)
 * Shows the user's deposited articles with add/remove actions. Always available
 * to an authenticated user (the zone is open to all — no join gate).
 *
 * EMPTY state: a full-width tappable drop zone (the only CTA).
 * POPULATED state: a vertical list of full-width rows (deterministic thumbnail
 * on the left, info block on the right) so the user recognizes their garments
 * instantly, led by a full-width "+" deposit row. Rendered inside a scrollable
 * parent (the Swap Zone): no nested scroll view — a plain column View only.
 */

import React from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';

import { Text } from '@/components/ui';
import { colors, fonts, spacing, radius, sizing } from '@/constants/theme';
import { formatPrice } from '@/utils/formatPrice';
import type { MyArticlesSectionProps } from '../types';

// Portrait 4/5 thumbnail footprint (64 / 80 = 0.8), echoing the previous tile
// ratio in a compact list-row form. Fixed named consts rather than aspectRatio
// because the thumbnail is not flex-driven and needs a deterministic footprint.
const THUMB_W = 64;
const THUMB_H = 80;

export const MyArticlesSection = React.memo(function MyArticlesSection({
  userItems,
  onAddPress,
  onRemoveItem,
}: MyArticlesSectionProps) {
  const hasItems = userItems.length > 0;

  return (
    <View style={styles.section}>
      <View style={styles.labelRow}>
        <Text style={styles.label}>
          {hasItems ? `Mes pièces · ${userItems.length}` : 'Mes pièces'}
        </Text>
      </View>

      {hasItems ? (
        <View style={styles.list}>
          {/* Deposit row leads the list so the deposit action is always the
              first thing in view. */}
          <Pressable
            style={({ pressed }) => [styles.addRow, pressed && styles.pressed]}
            onPress={onAddPress}
          >
            <View style={styles.addRowIcon}>
              <Ionicons name="add" size={sizing.iconMD} color={colors.sand} />
            </View>
            <Text style={styles.addRowLabel}>Déposer un article</Text>
          </Pressable>

          {userItems.map((item) => (
            <Animated.View
              key={item.id}
              style={styles.row}
              entering={FadeIn.duration(200)}
              exiting={FadeOut.duration(160)}
              layout={LinearTransition.duration(220)}
            >
              <View style={styles.rowImageWrap}>
                <Image
                  source={{ uri: item.imageUrl }}
                  style={styles.rowImage}
                  recyclingKey={item.id}
                  contentFit="cover"
                />
              </View>

              <View style={styles.rowInfo}>
                <Text style={styles.rowBrand} numberOfLines={1}>
                  {item.brand || 'MARQUE'}
                </Text>
                <Text style={styles.rowTitle} numberOfLines={1}>
                  {item.title}
                </Text>
                <View style={styles.rowFooter}>
                  <Text style={styles.rowPrice}>{formatPrice(item.price)}</Text>
                  {item.size?.value ? (
                    <Text style={styles.rowSize}>{item.size.value}</Text>
                  ) : null}
                </View>
              </View>

              <Pressable
                style={({ pressed }) => [styles.removeRow, pressed && styles.pressed]}
                onPress={() => onRemoveItem(item.articleId)}
                hitSlop={8}
              >
                <Ionicons name="close" size={sizing.iconSM} color={colors.cream} />
              </Pressable>
            </Animated.View>
          ))}
        </View>
      ) : (
        <Pressable
          style={({ pressed }) => [styles.dropZone, pressed && styles.pressed]}
          onPress={onAddPress}
        >
          <View style={styles.dropZonePlus}>
            <Ionicons name="add" size={sizing.iconMD} color={colors.sand} />
          </View>
          <Text style={styles.dropZoneLabel}>Déposer un article</Text>
          <Text style={styles.dropZoneHint}>Ajoutez vos pièces à échanger</Text>
        </Pressable>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  section: {
    backgroundColor: colors.darkSurface1,
    borderBottomWidth: 1,
    borderBottomColor: colors.darkBorderStrong,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  pressed: {
    opacity: 0.7,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  label: {
    fontSize: 10,
    fontFamily: fonts.sansMedium,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: colors.sand,
  },
  // ── EMPTY drop zone ──
  dropZone: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.darkSurface2,
    borderWidth: 1,
    borderColor: colors.darkBorderStrong,
    borderRadius: radius.none,
  },
  dropZonePlus: {
    width: sizing.avatarMD,
    height: sizing.avatarMD,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.darkSurface1,
    borderWidth: 1,
    borderColor: colors.darkBorder,
    borderRadius: radius.none,
  },
  dropZoneLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    letterSpacing: 1.0,
    textTransform: 'uppercase',
    color: colors.cream,
  },
  dropZoneHint: {
    fontFamily: fonts.sans,
    fontSize: 11,
    color: colors.whiteTranslucent,
  },
  // ── POPULATED list (vertical, full-width rows) ──
  list: {
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  // Full-width deposit row leading the list (deep panel, hairline frame).
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    backgroundColor: colors.darkSurface2,
    borderWidth: 1,
    borderColor: colors.darkBorderStrong,
    borderRadius: radius.none,
  },
  addRowIcon: {
    width: THUMB_W,
    height: THUMB_H,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.darkSurface1,
    borderWidth: 1,
    borderColor: colors.darkBorder,
    borderRadius: radius.none,
  },
  addRowLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    letterSpacing: 1.0,
    textTransform: 'uppercase',
    color: colors.sand,
  },
  // Full-width article row: surface + hairline frame, echoing productCardDark.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    backgroundColor: colors.darkSurface1,
    borderWidth: 1,
    borderColor: colors.darkBorder,
    borderRadius: radius.none,
  },
  rowImageWrap: {
    width: THUMB_W,
    height: THUMB_H,
    backgroundColor: colors.darkSurface2,
    overflow: 'hidden',
  },
  rowImage: {
    width: '100%',
    height: '100%',
  },
  // Left-aligned info block, mirroring PartyItemCard productInfo (compacted).
  rowInfo: {
    flex: 1,
  },
  rowBrand: {
    fontFamily: fonts.sansMedium,
    fontSize: 9,
    letterSpacing: 1.35,
    textTransform: 'uppercase',
    color: colors.sand,
    marginBottom: 2,
  },
  rowTitle: {
    fontFamily: fonts.display,
    fontSize: 14,
    lineHeight: 17,
    color: colors.cream,
    marginBottom: spacing.xs,
  },
  rowFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  rowPrice: {
    fontFamily: fonts.displayMedium,
    fontSize: 14,
    color: colors.sand,
  },
  rowSize: {
    fontFamily: fonts.sans,
    fontSize: 10,
    color: colors.whiteTranslucent,
  },
  removeRow: {
    width: sizing.iconMD,
    height: sizing.iconMD,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.overlay,
    borderRadius: radius.full,
  },
});
