/**
 * Avatar Component
 * Design System: Luxe Français + Street
 *
 * Sizes: xs, sm, md, lg, xl, xxl
 */

import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ViewStyle,
} from 'react-native';

import { colors, radius, sizing, shadows, typography } from '@/constants/theme';

// =============================================================================
// TYPES
// =============================================================================

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'xxl';

interface AvatarProps {
  source?: string | null;
  name?: string;
  size?: AvatarSize;
  showOnline?: boolean;
  isOnline?: boolean;
  style?: ViewStyle;
  testID?: string;
}

// =============================================================================
// SIZE CONFIG
// =============================================================================

const sizeConfig: Record<AvatarSize, { dimension: number; fontSize: number; iconSize: number; onlineSize: number }> = {
  xs: { dimension: sizing.avatarXS, fontSize: 10, iconSize: 12, onlineSize: 8 },
  sm: { dimension: sizing.avatarSM, fontSize: 12, iconSize: 14, onlineSize: 10 },
  md: { dimension: sizing.avatarMD, fontSize: 14, iconSize: 18, onlineSize: 12 },
  lg: { dimension: sizing.avatarLG, fontSize: 18, iconSize: 24, onlineSize: 14 },
  xl: { dimension: sizing.avatarXL, fontSize: 24, iconSize: 32, onlineSize: 16 },
  xxl: { dimension: sizing.avatarXXL, fontSize: 36, iconSize: 48, onlineSize: 20 },
};

// =============================================================================
// COMPONENT
// =============================================================================

export const Avatar: React.FC<AvatarProps> = ({
  source,
  name,
  size = 'md',
  showOnline = false,
  isOnline = false,
  style,
  testID,
}) => {
  const config = sizeConfig[size];

  // Get initials from name
  const getInitials = (name?: string): string => {
    if (!name) return '';
    const parts = name.trim().split(' ');
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    }
    return parts[0].substring(0, 2).toUpperCase();
  };

  const initials = getInitials(name);
  const hasImage = source && source.length > 0;

  return (
    <View
      style={[
        styles.container,
        {
          width: config.dimension,
          height: config.dimension,
          borderRadius: config.dimension / 2,
        },
        style,
      ]}
      testID={testID}
    >
      {hasImage ? (
        <Image
          source={{ uri: source }}
          style={[
            styles.image,
            {
              width: config.dimension,
              height: config.dimension,
              borderRadius: config.dimension / 2,
            },
          ]}
          contentFit="cover"
          transition={200}
          cachePolicy="memory-disk"
        />
      ) : initials ? (
        <View
          style={[
            styles.placeholder,
            {
              width: config.dimension,
              height: config.dimension,
              borderRadius: config.dimension / 2,
            },
          ]}
        >
          <Text style={[styles.initials, { fontSize: config.fontSize }]}>
            {initials}
          </Text>
        </View>
      ) : (
        <View
          style={[
            styles.placeholder,
            {
              width: config.dimension,
              height: config.dimension,
              borderRadius: config.dimension / 2,
            },
          ]}
        >
          <Ionicons name="person" size={config.iconSize} color={colors.white} />
        </View>
      )}

      {/* Online Indicator */}
      {showOnline && isOnline && (
        <View
          style={[
            styles.onlineIndicator,
            {
              width: config.onlineSize,
              height: config.onlineSize,
              borderRadius: config.onlineSize / 2,
              borderWidth: config.onlineSize > 10 ? 2 : 1.5,
            },
          ]}
        />
      )}
    </View>
  );
};

// =============================================================================
// STYLES
// =============================================================================

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    borderWidth: 2,
    borderColor: colors.white,
    ...shadows.card,
  },
  image: {
    backgroundColor: colors.border,
  },
  placeholder: {
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  initials: {
    fontFamily: typography.label.fontFamily,
    color: colors.white,
    fontWeight: '600',
  },
  onlineIndicator: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    backgroundColor: colors.success,
    borderColor: colors.white,
  },
});

export default Avatar;
