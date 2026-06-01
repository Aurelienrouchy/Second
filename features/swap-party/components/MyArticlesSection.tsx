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
import { colors, fonts, spacing, radius, sizing, typography } from '@/constants/theme';
import { formatPrice } from '@/utils/formatPrice';
import type { MyArticlesSectionProps } from '../types';

// Portrait 4/5 thumbnail footprint (48 / 60 = 0.8), echoing the previous tile
// ratio in a compact list-row form. Fixed named consts rather than aspectRatio
// because the thumbnail is not flex-driven and needs a deterministic footprint.
const THUMB_W = 48;
const THUMB_H = 60;

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
          {/* Deposit BUTTON leads the list so the deposit action is always the
              first thing in view. Real compact button (content-width) sharing
              the home Swap Zone CtaRow language: square darkSurface2 + hairline,
              rust square "+" tile inside, cream uppercase button label. */}
          <Pressable
            style={({ pressed }) => [styles.addButton, pressed && styles.pressed]}
            onPress={onAddPress}
            accessibilityRole="button"
            accessibilityLabel="Déposer un article"
          >
            <View style={styles.addButtonIcon}>
              <Ionicons name="add" size={sizing.iconSM} color={colors.cream} />
            </View>
            <Text style={styles.addButtonLabel}>Déposer un article</Text>
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
                {/* Line 1: brand with the price right beside it (left-aligned,
                    not pushed to the far edge). */}
                <Text style={styles.rowPriceBrand} numberOfLines={1}>
                  {formatPrice(item.price)} - {item.brand || 'MARQUE'}
                </Text>
                {/* Line 2: product title + size. */}
                <View style={styles.rowTitleLine}>
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {item.title}
                  </Text>
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
    fontFamily: typography.labelUppercase.fontFamily,
    fontSize: typography.labelUppercase.fontSize,
    lineHeight: typography.labelUppercase.lineHeight,
    letterSpacing: typography.labelUppercase.letterSpacing,
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
    fontFamily: typography.button.fontFamily,
    fontSize: typography.button.fontSize,
    lineHeight: typography.button.lineHeight,
    letterSpacing: typography.button.letterSpacing,
    textTransform: 'uppercase',
    color: colors.cream,
  },
  dropZoneHint: {
    fontFamily: typography.caption.fontFamily,
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    letterSpacing: typography.caption.letterSpacing,
    color: colors.whiteTranslucent,
  },
  // ── POPULATED list (editorial, hairline-separated rows) ──
  // No gap: rows touch and are split by a single top hairline each (the addRow
  // leads with no border, so there is no leading/trailing line).
  list: {
    paddingVertical: spacing.xs,
  },
  // Compact deposit BUTTON leading the list — content-width, square, hairline.
  // Shares the home Swap Zone CtaRow language (darkSurface2 fill + darkBorderStrong
  // hairline + rust square icon tile) so the deposit action reads as the zone's
  // signature action, not a list row.
  addButton: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.darkSurface2,
    borderWidth: 1,
    borderColor: colors.darkBorderStrong,
    borderRadius: radius.none,
    paddingLeft: spacing.sm,
    paddingRight: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.sm,
  },
  addButtonIcon: {
    width: sizing.avatarSM,
    height: sizing.avatarSM,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.rust,
    borderRadius: radius.none,
  },
  addButtonLabel: {
    fontFamily: typography.button.fontFamily,
    fontSize: typography.button.fontSize,
    lineHeight: typography.button.lineHeight,
    letterSpacing: typography.button.letterSpacing,
    textTransform: 'uppercase',
    color: colors.cream,
  },
  // Full-width article row — frameless, fine, split from the row above by a
  // single top hairline (uniform style, no index magic needed).
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.darkBorder,
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
  // Left-aligned info block, mirroring PartyItemCard productInfo (compacted to
  // two lines: brand+price, then title+size).
  rowInfo: {
    flex: 1,
  },
  // Price + brand on one line — the prominent editorial price line.
  rowPriceBrand: {
    fontFamily: typography.price.fontFamily,
    fontSize: typography.price.fontSize,
    lineHeight: typography.price.lineHeight,
    letterSpacing: typography.price.letterSpacing,
    color: colors.sand,
    marginBottom: spacing.md,
  },
  // Title line — title truncates, size trails right beside it.
  rowTitleLine: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.sm,
  },
  rowTitle: {
    flexShrink: 1,
    fontFamily: fonts.display,
    fontSize: 14,
    lineHeight: 17,
    color: colors.cream,
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
