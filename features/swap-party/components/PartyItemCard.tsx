/**
 * PartyItemCard Component
 * Product card for items in the swap party grid
 * Design: cream background, 3:4 image aspect ratio, brand/title/price footer
 */

import React from 'react';
import { StyleSheet, Pressable, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';

import { Text } from '@/components/ui';
import { colors, fonts } from '@/constants/theme';
import { formatPrice } from '@/utils/formatPrice';
import type { PartyItemCardProps } from '../types';

export const PartyItemCard = React.memo(function PartyItemCard({
  item,
  isSelected,
  isMultiSelectMode,
  onPress,
  onLongPress,
}: PartyItemCardProps) {
  return (
    <Pressable
      style={({ pressed }) => [styles.productCard, pressed && { opacity: 0.7 }]}
      onPress={onPress}
      onLongPress={onLongPress}
    >
      <View style={styles.productImageWrapper}>
        <Image
          source={{ uri: item.imageUrl }}
          style={styles.productImage}
          contentFit="cover"
        />

        {isMultiSelectMode && (
          <View
            style={[
              styles.selectionCheckbox,
              isSelected && styles.selectionCheckboxSelected,
            ]}
          >
            {isSelected && (
              <Ionicons name="checkmark" size={14} color={colors.white} />
            )}
          </View>
        )}

        <View style={styles.swapBadge}>
          <Ionicons
            name="swap-horizontal"
            size={10}
            color={colors.white}
            style={styles.swapIcon}
          />
          <Text style={styles.swapBadgeText}>Swap</Text>
        </View>
      </View>

      <View style={styles.productInfo}>
        <Text style={styles.productBrand}>
          {item.brand || 'BRAND'}
        </Text>
        <Text style={styles.productTitle} numberOfLines={2}>
          {item.title}
        </Text>
        <View style={styles.productFooter}>
          <Text style={styles.productPrice}>
            {formatPrice(item.price)}
          </Text>
          <Text style={styles.productSize}>
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
  productImageWrapper: {
    position: 'relative',
    aspectRatio: 3 / 4,
    backgroundColor: colors.background,
    overflow: 'hidden',
  },
  productImage: {
    width: '100%',
    height: '100%',
  },
  swapBadge: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    backgroundColor: 'rgba(122, 140, 110, 0.9)',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  swapIcon: {
    marginRight: 2,
  },
  swapBadgeText: {
    fontSize: 9,
    fontFamily: fonts.sansMedium,
    letterSpacing: 0.9,
    textTransform: 'uppercase',
    color: colors.white,
  },
  selectionCheckbox: {
    position: 'absolute',
    top: 8,
    left: 8,
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.white,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.2)',
  },
  selectionCheckboxSelected: {
    backgroundColor: colors.sage,
    borderColor: colors.sage,
  },
  productInfo: {
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 14,
  },
  productBrand: {
    fontSize: 9,
    fontFamily: fonts.sansMedium,
    letterSpacing: 1.35,
    textTransform: 'uppercase',
    color: colors.muted,
    marginBottom: 2,
  },
  productTitle: {
    fontFamily: fonts.display,
    fontSize: 15,
    fontWeight: '400',
    color: colors.charcoal,
    marginBottom: 6,
    lineHeight: 18,
  },
  productFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  productPrice: {
    fontFamily: fonts.display,
    fontSize: 14,
    fontWeight: '500',
    color: colors.sage,
  },
  productSize: {
    fontSize: 10,
    fontFamily: fonts.sans,
    color: colors.muted,
  },
});
