/**
 * PartyItemCard Component
 * Product card for items in the Swap Zone grid.
 *
 * Supports two tones:
 * - 'light' (default): cream card, used wherever the app is light.
 * - 'dark': Swap Zone identity — card on colors.dark, cream/sand text, sage
 *   "Swap" badge. 100% DS tokens, no magic numbers.
 *
 * When `disabled` (another seller already chosen in multi-select), the card is
 * dimmed and non-interactive so a swap stays scoped to a single vendor.
 */

import React from 'react';
import { StyleSheet, Pressable, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';

import { Text } from '@/components/ui';
import { colors, fonts, spacing, radius, sizing } from '@/constants/theme';
import { formatPrice } from '@/utils/formatPrice';
import type { PartyItemCardProps } from '../types';

export const PartyItemCard = React.memo(function PartyItemCard({
  item,
  isSelected,
  isMultiSelectMode,
  disabled = false,
  tone = 'light',
  onPress,
  onLongPress,
}: PartyItemCardProps) {
  const isDark = tone === 'dark';

  return (
    <Pressable
      style={({ pressed }) => [
        styles.productCard,
        isDark && styles.productCardDark,
        (pressed && !disabled) && styles.pressed,
        disabled && styles.disabled,
      ]}
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={disabled}
    >
      <View style={[styles.productImageWrapper, isDark && styles.productImageWrapperDark]}>
        <Image
          source={{ uri: item.imageUrl }}
          style={styles.productImage}
          contentFit="cover"
          recyclingKey={item.id}
        />

        {isMultiSelectMode && (
          <View
            style={[
              styles.selectionCheckbox,
              isDark && styles.selectionCheckboxDark,
              isSelected && styles.selectionCheckboxSelected,
            ]}
          >
            {isSelected && <Ionicons name="checkmark" size={14} color={colors.cream} />}
          </View>
        )}

        <View style={[styles.swapBadge, isDark && styles.swapBadgeDark]}>
          <Ionicons
            name="swap-horizontal"
            size={10}
            color={colors.cream}
            style={styles.swapIcon}
          />
          <Text style={styles.swapBadgeText}>Swap</Text>
        </View>
      </View>

      <View style={styles.productInfo}>
        <Text style={[styles.productBrand, isDark && styles.productBrandDark]}>
          {item.brand || 'BRAND'}
        </Text>
        <Text style={[styles.productTitle, isDark && styles.productTitleDark]} numberOfLines={2}>
          {item.title}
        </Text>
        <View style={styles.productFooter}>
          <Text style={[styles.productPrice, isDark && styles.productPriceDark]}>
            {formatPrice(item.price)}
          </Text>
          <Text style={[styles.productSize, isDark && styles.productSizeDark]}>
            {item.size || 'U'}
          </Text>
        </View>
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  productCard: {
    flex: 1,
    backgroundColor: colors.cream,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
  productCardDark: {
    backgroundColor: colors.dark,
    borderColor: colors.deep,
  },
  pressed: {
    opacity: 0.7,
  },
  disabled: {
    opacity: 0.35,
  },
  productImageWrapper: {
    position: 'relative',
    aspectRatio: 3 / 4,
    backgroundColor: colors.background,
    overflow: 'hidden',
  },
  productImageWrapperDark: {
    backgroundColor: colors.deep,
  },
  productImage: {
    width: '100%',
    height: '100%',
  },
  swapBadge: {
    position: 'absolute',
    bottom: spacing.sm,
    left: spacing.sm,
    backgroundColor: colors.sage,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.xs,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs / 2,
  },
  swapBadgeDark: {
    backgroundColor: colors.sage,
  },
  swapIcon: {
    marginRight: spacing.xs / 2,
  },
  swapBadgeText: {
    fontSize: 9,
    fontFamily: fonts.sansMedium,
    letterSpacing: 0.9,
    textTransform: 'uppercase',
    color: colors.cream,
  },
  selectionCheckbox: {
    position: 'absolute',
    top: spacing.sm,
    left: spacing.sm,
    width: sizing.iconMD,
    height: sizing.iconMD,
    borderRadius: radius.full,
    borderWidth: 2,
    borderColor: colors.white,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.overlayLight,
  },
  selectionCheckboxDark: {
    borderColor: colors.cream,
    backgroundColor: colors.overlay,
  },
  selectionCheckboxSelected: {
    backgroundColor: colors.sage,
    borderColor: colors.sage,
  },
  productInfo: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm + 2,
    paddingBottom: spacing.md - 2,
  },
  productBrand: {
    fontSize: 9,
    fontFamily: fonts.sansMedium,
    letterSpacing: 1.35,
    textTransform: 'uppercase',
    color: colors.muted,
    marginBottom: 2,
  },
  productBrandDark: {
    color: colors.sand,
  },
  productTitle: {
    fontFamily: fonts.display,
    fontSize: 15,
    color: colors.charcoal,
    marginBottom: spacing.xs + 2,
    lineHeight: 18,
  },
  productTitleDark: {
    color: colors.cream,
  },
  productFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  productPrice: {
    fontFamily: fonts.displayMedium,
    fontSize: 14,
    color: colors.sage,
  },
  productPriceDark: {
    color: colors.sand,
  },
  productSize: {
    fontSize: 10,
    fontFamily: fonts.sans,
    color: colors.muted,
  },
  productSizeDark: {
    color: colors.whiteTranslucent,
  },
});
