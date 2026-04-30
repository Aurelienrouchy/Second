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

export interface SellerCardProps {
  name: string;
  location: string;
  distance: string;
  rating: string;
  avatarGradient?: {
    colors: string[];
    start?: { x: number; y: number };
    end?: { x: number; y: number };
  };
  onPress?: () => void;
  style?: ViewStyle;
}

export const SellerCard: React.FC<SellerCardProps> = ({
  name,
  location,
  distance,
  rating,
  avatarGradient,
  onPress,
  style,
}) => {
  return (
    <Pressable
      style={[styles.container, style]}
      onPress={onPress}
      disabled={!onPress}
    >
      <ImageBackground
        style={styles.avatar}
        source={{ uri: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="40" height="40"%3E%3Ccircle cx="20" cy="20" r="20" fill="%23f5f0e8"/%3E%3C/svg%3E' }}
      />

      <View style={styles.info}>
        <Text style={styles.name}>{name}</Text>
        <Text style={styles.meta}>
          {location} · {distance}
        </Text>
      </View>

      <View style={styles.rating}>
        <Text style={styles.ratingStar}>⭐</Text>
        <Text style={styles.ratingValue}>{rating}</Text>
      </View>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    padding: spacing.md,
    gap: spacing.sm,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(245,240,232,0.3)',
  },
  info: {
    flex: 1,
  },
  name: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.charcoal,
    marginBottom: 2,
  },
  meta: {
    fontSize: 11,
    color: 'rgba(245,240,232,0.5)',
    fontWeight: '300',
  },
  rating: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  ratingStar: {
    fontSize: 14,
  },
  ratingValue: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.charcoal,
  },
});
