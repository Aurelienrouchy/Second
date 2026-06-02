import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import React from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { SwapItemInfo } from '@/types';
import { colors, fonts, spacing, radius } from '@/constants/theme';
import { formatPrice } from '@/utils/formatPrice';

export interface SwapItemCardProps {
  item: SwapItemInfo;
  variant?: 'their' | 'mine' | 'receiver' | 'initiator' | 'default' | 'selected';
  showValue?: boolean;
  onRemove?: () => void;
}

const SwapItemCard: React.FC<SwapItemCardProps> = ({
  item,
  variant = 'their',
  showValue = true,
  onRemove,
}) => {
  const isMine = variant === 'mine' || variant === 'initiator' || variant === 'selected';

  return (
    <View
      style={[
        styles.container,
        isMine ? styles.mineContainer : styles.theirContainer,
      ]}
    >
      {/* Image */}
      <View style={styles.imageWrapper}>
        <Image
          source={{ uri: item.imageUrl || '' }}
          style={styles.image}
          contentFit="cover"
          placeholder={{ blurhash: 'LGFk[5xG00xa7wG2RjWB00xa7wG2' }}
        />
      </View>

      {/* Content */}
      <View style={styles.content}>
        {/* Brand - uppercase, muted, small */}
        {item.brand && (
          <Text style={styles.brand}>{item.brand.toUpperCase()}</Text>
        )}

        {/* Title - Cormorant Garamond 17px */}
        <Text style={styles.title} numberOfLines={2}>
          {item.title}
        </Text>

        {/* Size and condition - muted small */}
        {item.size?.value && (
          <Text style={styles.metadata}>
            Taille {item.size.value} · Bon état
          </Text>
        )}
      </View>

      {/* Value section - right aligned */}
      {showValue && (
        <View style={styles.valueSection}>
          <Text style={styles.valueLabel}>Valeur</Text>
          <Text style={styles.valueAmount}>{formatPrice(item.price)}</Text>
        </View>
      )}

      {/* Remove button - only for mine variant */}
      {onRemove && isMine && (
        <Pressable
          style={styles.removeButton}
          onPress={onRemove}
          hitSlop={8}
        >
          <Ionicons
            name="close"
            size={16}
            color={colors.muted}
          />
        </Pressable>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: 14,
    borderRadius: radius.sm,
    marginBottom: 20,
  },
  theirContainer: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  mineContainer: {
    backgroundColor: colors.sageLight,
    borderWidth: 1.5,
    borderColor: colors.sage,
  },
  imageWrapper: {
    width: 56,
    height: 72,
    borderRadius: 0,
    overflow: 'hidden',
    flexShrink: 0,
    backgroundColor: colors.surfaceWarm,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  content: {
    flex: 1,
  },
  brand: {
    fontFamily: fonts.sans,
    fontSize: 10,
    lineHeight: 12,
    letterSpacing: 1.0,
    textTransform: 'uppercase',
    color: colors.muted,
    marginBottom: 2,
  },
  title: {
    fontFamily: fonts.display,
    fontSize: 17,
    fontWeight: '400',
    lineHeight: 20,
    color: colors.charcoal,
    marginBottom: 3,
  },
  metadata: {
    fontFamily: fonts.sans,
    fontSize: 11,
    lineHeight: 14,
    color: colors.muted,
  },
  valueSection: {
    alignItems: 'flex-end',
  },
  valueLabel: {
    fontFamily: fonts.sans,
    fontSize: 10,
    lineHeight: 12,
    color: colors.muted,
  },
  valueAmount: {
    fontFamily: fonts.display,
    fontSize: 22,
    fontWeight: '300',
    lineHeight: 26,
    color: colors.charcoal,
  },
  removeButton: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    width: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

export default SwapItemCard;
