import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ViewStyle,
  ImageBackground,
} from 'react-native';
import { colors, fonts, radius, spacing } from '@/constants/theme';

interface BadgeConfig {
  variant: 'new' | 'sale' | 'featured';
  label: string;
}

export interface ProductCardGridProps {
  brand: string;
  name: string;
  price: string;
  originalPrice?: string;
  imageGradient?: {
    colors: string[];
    start?: { x: number; y: number };
    end?: { x: number; y: number };
  };
  badge?: BadgeConfig;
  saved?: boolean;
  onPress?: () => void;
  onSave?: () => void;
  style?: ViewStyle;
}

export const ProductCardGrid: React.FC<ProductCardGridProps> = ({
  brand,
  name,
  price,
  originalPrice,
  imageGradient,
  badge,
  saved = false,
  onPress,
  onSave,
  style,
}) => {
  const getBadgeColor = (variant: string): string => {
    switch (variant) {
      case 'new':
        return colors.sage;
      case 'sale':
        return colors.rust;
      case 'featured':
        return colors.rust;
      default:
        return colors.rust;
    }
  };

  return (
    <Pressable style={[styles.container, style]} onPress={onPress}>
      <View style={styles.imageContainer}>
        <ImageBackground
          style={styles.image}
          source={{ uri: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="100%25" height="100%25"%3E%3Crect fill="%23f5f0e8" width="100%25" height="100%25"/%3E%3C/svg%3E' }}
        />

        {badge && (
          <View
            style={[
              styles.badge,
              { backgroundColor: getBadgeColor(badge.variant) },
            ]}
          >
            <Text style={styles.badgeText}>{badge.label}</Text>
          </View>
        )}

        <Pressable style={styles.saveButton} onPress={onSave}>
          <Text style={styles.saveIcon}>{saved ? '❤️' : '🤍'}</Text>
        </Pressable>
      </View>

      <View style={styles.content}>
        <Text style={styles.brand}>{brand}</Text>
        <Text style={styles.name} numberOfLines={2}>
          {name}
        </Text>
        <View style={styles.priceRow}>
          <Text style={styles.price}>{price}</Text>
          {originalPrice && (
            <Text style={styles.originalPrice}>{originalPrice}</Text>
          )}
        </View>
      </View>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  imageContainer: {
    position: 'relative',
    aspectRatio: 3 / 4,
    marginBottom: spacing.sm,
    backgroundColor: 'rgba(245,240,232,0.4)',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  badge: {
    position: 'absolute',
    top: spacing.sm,
    left: spacing.sm,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.sm,
  },
  badgeText: {
    fontSize: 9,
    fontWeight: '700',
    color: colors.cream,
    textTransform: 'uppercase',
    letterSpacing: 0.05,
  },
  saveButton: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(245,240,232,0.9)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  saveIcon: {
    fontSize: 16,
  },
  content: {
    paddingHorizontal: 0,
  },
  brand: {
    fontSize: 9,
    fontWeight: '600',
    color: 'rgba(245,240,232,0.5)',
    textTransform: 'uppercase',
    letterSpacing: 0.05,
    marginBottom: 3,
  },
  name: {
    fontFamily: fonts.serif,
    fontSize: 15,
    fontWeight: '300',
    color: colors.charcoal,
    marginBottom: 4,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  price: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.rust,
  },
  originalPrice: {
    fontSize: 11,
    fontWeight: '300',
    color: 'rgba(245,240,232,0.5)',
    textDecorationLine: 'line-through',
  },
});
