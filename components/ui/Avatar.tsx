/**
 * Avatar Component — Seconde UI Kit
 * Design: Editorial Luxe — Warm sand gradient for placeholders,
 * Cormorant Garamond serif initials, minimal chrome.
 *
 * Sizes: xs, sm, md, lg, xl, xxl
 */

import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ViewStyle,
} from 'react-native';

import { colors, sizing, fonts } from '@/constants/theme';

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

const sizeConfig: Record<AvatarSize, {
  dimension: number;
  fontSize: number;
  iconSize: number;
  onlineSize: number;
  borderWidth: number;
}> = {
  xs: { dimension: sizing.avatarXS, fontSize: 10, iconSize: 12, onlineSize: 8, borderWidth: 1 },
  sm: { dimension: sizing.avatarSM, fontSize: 12, iconSize: 14, onlineSize: 10, borderWidth: 1.5 },
  md: { dimension: sizing.avatarMD, fontSize: 16, iconSize: 18, onlineSize: 12, borderWidth: 1.5 },
  lg: { dimension: sizing.avatarLG, fontSize: 20, iconSize: 24, onlineSize: 14, borderWidth: 2 },
  xl: { dimension: sizing.avatarXL, fontSize: 28, iconSize: 32, onlineSize: 16, borderWidth: 2 },
  xxl: { dimension: sizing.avatarXXL, fontSize: 38, iconSize: 48, onlineSize: 20, borderWidth: 2 },
};

// Warm sand → taupe gradient for editorial placeholder
const GRADIENT_COLORS = [colors.sand, colors.sandDeep] as const;

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

  // Get initial(s) from name
  const getInitials = (name?: string): string => {
    if (!name) return '';
    const parts = name.trim().split(' ');
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    }
    return parts[0][0].toUpperCase();
  };

  const initials = getInitials(name);
  const hasImage = source && source.length > 0;
  const dim = config.dimension;

  return (
    <View
      style={[
        styles.container,
        {
          width: dim,
          height: dim,
          borderRadius: dim / 2,
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
              width: dim,
              height: dim,
              borderRadius: dim / 2,
            },
          ]}
          contentFit="cover"
          transition={200}
          cachePolicy="memory-disk"
        />
      ) : initials ? (
        <LinearGradient
          colors={[GRADIENT_COLORS[0], GRADIENT_COLORS[1]]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[
            styles.placeholder,
            {
              width: dim,
              height: dim,
              borderRadius: dim / 2,
            },
          ]}
        >
          <Text style={[styles.initials, { fontSize: config.fontSize }]}>
            {initials}
          </Text>
        </LinearGradient>
      ) : (
        <LinearGradient
          colors={[GRADIENT_COLORS[0], GRADIENT_COLORS[1]]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[
            styles.placeholder,
            {
              width: dim,
              height: dim,
              borderRadius: dim / 2,
            },
          ]}
        >
          <Ionicons name="person" size={config.iconSize} color={colors.white} />
        </LinearGradient>
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
              borderWidth: config.borderWidth,
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
    overflow: 'hidden',
  },
  image: {
    backgroundColor: colors.borderLight,
  },
  placeholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  initials: {
    fontFamily: fonts.display,
    color: colors.white,
    letterSpacing: -0.3,
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
