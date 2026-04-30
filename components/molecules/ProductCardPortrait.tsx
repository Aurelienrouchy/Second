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

export interface ProductCardPortraitProps {
  brand: string;
  name: string;
  price: string;
  size?: string;
  imageGradient?: {
    colors: string[];
    start?: { x: number; y: number };
    end?: { x: number; y: number };
  };
  saved?: boolean;
  onPress?: () => void;
  onSave?: () => void;
  style?: ViewStyle;
}

export const ProductCardPortrait: React.FC<ProductCardPortraitProps> = ({
  brand,
  name,
  price,
  size,
  imageGradient,
  saved = false,
  onPress,
  onSave,
  style,
}) => {
  return (
    <Pressable style={[styles.container, style]} onPress={onPress}>
      <View style={styles.imageContainer}>
        <ImageBackground
          style={styles.image}
          source={{ uri: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="152" height="200"%3E%3Crect fill="%23f5f0e8" width="152" height="200"/%3E%3C/svg%3E' }}
        />
        <Pressable style={styles.saveButton} onPress={onSave}>
          <Text style={styles.saveIcon}>{saved ? '❤️' : '🤍'}</Text>
        </Pressable>
      </View>

      <View style={styles.content}>
        <Text style={styles.brand}>{brand}</Text>
        <Text style={styles.name} numberOfLines={2}>
          {name}
        </Text>
        <Text style={styles.price}>{price}</Text>

        {size && (
          <View style={styles.sizePill}>
            <Text style={styles.sizeText}>{size}</Text>
          </View>
        )}
      </View>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  container: {
    width: 152,
  },
  imageContainer: {
    position: 'relative',
    marginBottom: spacing.xs,
  },
  image: {
    width: 152,
    height: 200,
    backgroundColor: 'rgba(245,240,232,0.4)',
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
    fontSize: 10,
    fontWeight: '600',
    color: 'rgba(245,240,232,0.5)',
    textTransform: 'uppercase',
    letterSpacing: 0.05,
    marginBottom: 4,
  },
  name: {
    fontFamily: fonts.serif,
    fontSize: 16,
    fontWeight: '300',
    color: colors.charcoal,
    marginBottom: 4,
  },
  price: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.rust,
    marginBottom: 8,
  },
  sizePill: {
    backgroundColor: 'rgba(245,240,232,0.15)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.full,
    alignSelf: 'flex-start',
  },
  sizeText: {
    fontSize: 10,
    color: 'rgba(245,240,232,0.5)',
    fontWeight: '600',
    textTransform: 'uppercase',
  },
});
