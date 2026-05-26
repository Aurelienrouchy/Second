import React from 'react';
import {
  StyleSheet,
  View,
  Text,
  ViewStyle,
} from 'react-native';
import {
  colors,
  spacing,
  typography,
  fonts,
} from '@/constants/theme';
import { APP_LOCALE } from '@/constants/locale';
import { Tag } from '@/components/atoms/Tag';

export interface DetailHeaderProps {
  brand: string;
  name: string;
  price: number;
  originalPrice?: number;
  discountPercent?: number;
  tags: string[];
  description?: string;
  style?: ViewStyle;
}

export const DetailHeader: React.FC<DetailHeaderProps> = ({
  brand,
  name,
  price,
  originalPrice,
  discountPercent,
  tags,
  description,
  style,
}) => {
  const styles = getStyles();

  const formatPrice = (p: number): string => {
    return p.toLocaleString(APP_LOCALE, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
  };

  return (
    <View style={[styles.container, style]}>
      {/* Brand */}
      <Text style={styles.brand}>{brand}</Text>

      {/* Product Name */}
      <Text style={styles.name}>{name}</Text>

      {/* Price Row */}
      <View style={styles.priceRow}>
        <Text style={styles.price}>${formatPrice(price)}</Text>

        {originalPrice && (
          <Text style={styles.originalPrice}>
            ${formatPrice(originalPrice)}
          </Text>
        )}

        {discountPercent !== undefined && (
          <View style={styles.discountBadge}>
            <Text style={styles.discountText}>–{discountPercent}%</Text>
          </View>
        )}
      </View>

      {/* Tags */}
      {tags.length > 0 && (
        <View style={styles.tagsContainer}>
          {tags.map((tag, index) => (
            <Tag
              key={`${tag}-${index}`}
              variant="detail"
              label={tag}
            />
          ))}
        </View>
      )}

      {/* Description */}
      {description && (
        <Text style={styles.description}>{description}</Text>
      )}
    </View>
  );
};

function getStyles() {
  return StyleSheet.create({
    container: {
      paddingHorizontal: spacing.xl,
      paddingVertical: spacing.xl,
      gap: spacing.lg,
    },
    brand: {
      fontSize: 11,
      fontWeight: '400',
      letterSpacing: 1.5,
      textTransform: 'uppercase',
      color: colors.muted,
      fontFamily: fonts.sans,
    },
    name: {
      fontSize: 28,
      fontWeight: '300',
      lineHeight: 28 * 1.15,
      fontFamily: fonts.serif,
      color: colors.charcoal,
    },
    priceRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.lg,
      marginTop: spacing.md,
    },
    price: {
      fontSize: 32,
      fontWeight: '300',
      lineHeight: 36,
      fontFamily: fonts.serif,
      color: colors.rust,
    },
    originalPrice: {
      fontSize: 14,
      fontWeight: '300',
      color: colors.muted,
      textDecorationLine: 'line-through',
      lineHeight: 21,
    },
    discountBadge: {
      backgroundColor: colors.rust,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
      borderRadius: 4,
    },
    discountText: {
      fontSize: 10,
      fontWeight: '600',
      color: colors.white,
      lineHeight: 14,
    },
    tagsContainer: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.md,
      marginTop: spacing.sm,
    },
    description: {
      fontSize: 13,
      fontWeight: '300',
      lineHeight: 13 * 1.7,
      color: '#4A4840',
      fontFamily: fonts.sans,
      marginTop: spacing.md,
    },
  });
}
