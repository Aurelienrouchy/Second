/**
 * TrendingBrandsSection Component
 * Horizontal scrollable brand circles with article counts
 * Gradient backgrounds are deterministically generated from brand names
 */

import React, { useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Dimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import Animated, {
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { colors, spacing, typography, radius, animations, sizing } from '@/constants/theme';

// =============================================================================
// TYPES
// =============================================================================

interface TrendingBrand {
  name: string;
  articleCount: number;
}

interface TrendingBrandsSectionProps {
  brands: TrendingBrand[];
  isLoading?: boolean;
  onBrandPress?: (brandName: string) => void;
  testID?: string;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const CIRCLE_SIZE = 72;
const CIRCLE_MARGIN = spacing.md;
const { width: SCREEN_WIDTH } = Dimensions.get('window');

// Gradient pairs for deterministic selection
const GRADIENT_PAIRS = [
  ['#C4603A', '#8B3A1A'], // Rust
  ['#7A8C6E', '#4A5C40'], // Sage
  ['#D4C4A0', '#A89870'], // Sand
  ['#B8847C', '#8B6860'], // Clay
  ['#3D9970', '#1A7A4A'], // Success Green
  ['#E09F3E', '#C07A20'], // Warning
  ['#2A3550', '#0A1530'], // Navy
  ['#6A7050', '#3A4030'], // Olive
  ['#A09888', '#706858'], // Stone
  ['#D8CDB8', '#B0A088'], // Ecru
];

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Hash a string to a deterministic number
 */
function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash);
}

/**
 * Get a gradient pair based on brand name hash
 */
function getGradientForBrand(brandName: string): [string, string] {
  const hash = hashString(brandName);
  const index = hash % GRADIENT_PAIRS.length;
  return GRADIENT_PAIRS[index];
}

/**
 * Get the initial letter for a brand
 */
function getBrandInitial(brandName: string): string {
  return brandName.charAt(0).toUpperCase();
}

// =============================================================================
// BRAND CIRCLE COMPONENT
// =============================================================================

interface BrandCircleProps {
  brand: TrendingBrand;
  onPress: () => void;
  index: number;
}

const BrandCircle: React.FC<BrandCircleProps> = ({ brand, onPress, index }) => {
  const scale = useSharedValue(1);
  const gradient = getGradientForBrand(brand.name);
  const initial = getBrandInitial(brand.name);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = () => {
    scale.value = withSpring(0.92, animations.spring.snappy);
  };

  const handlePressOut = () => {
    scale.value = withSpring(1, animations.spring.bouncy);
  };

  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress();
  };

  return (
    <Animated.View
      entering={FadeInDown.duration(400).delay(100 + index * 50)}
      style={styles.brandWrapper}
    >
      <Pressable
        style={[styles.brandContainer, animatedStyle]}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        onPress={handlePress}
      >
        <LinearGradient
          colors={gradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.brandCircle}
        >
          <Text style={styles.brandInitial}>{initial}</Text>
        </LinearGradient>

        <Text
          style={styles.brandName}
          numberOfLines={1}
          ellipsizeMode="tail"
        >
          {brand.name}
        </Text>

        <Text style={styles.brandArticleCount}>
          {brand.articleCount} {brand.articleCount === 1 ? 'article' : 'articles'}
        </Text>
      </Pressable>
    </Animated.View>
  );
};

// =============================================================================
// SKELETON COMPONENT
// =============================================================================

const BrandCircleSkeleton: React.FC<{ index: number }> = ({ index }) => (
  <Animated.View
    entering={FadeInDown.duration(400).delay(100 + index * 50)}
    style={styles.brandWrapper}
  >
    <View style={styles.brandContainer}>
      <View style={[styles.brandCircle, styles.skeletonCircle]} />
      <View style={[styles.skeletonBar, { height: 12 }]} />
      <View style={[styles.skeletonBar, { height: 10, width: '80%' }]} />
    </View>
  </Animated.View>
);

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export const TrendingBrandsSection: React.FC<TrendingBrandsSectionProps> = ({
  brands,
  isLoading = false,
  onBrandPress,
  testID,
}) => {
  const displayBrands = isLoading ? Array(5).fill(null) : brands;

  return (
    <View style={styles.container} testID={testID}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={16}
        contentContainerStyle={styles.scrollContent}
      >
        {displayBrands.map((brand, index) => {
          if (isLoading || !brand) {
            return <BrandCircleSkeleton key={`skeleton-${index}`} index={index} />;
          }

          return (
            <BrandCircle
              key={brand.name}
              brand={brand}
              onPress={() => onBrandPress?.(brand.name)}
              index={index}
            />
          );
        })}
      </ScrollView>
    </View>
  );
};

// =============================================================================
// STYLES
// =============================================================================

const styles = StyleSheet.create({
  container: {
    paddingVertical: spacing.md,
  },
  scrollContent: {
    paddingHorizontal: spacing.md,
    gap: CIRCLE_MARGIN,
  },
  brandWrapper: {
    width: CIRCLE_SIZE + CIRCLE_MARGIN,
    alignItems: 'center',
  },
  brandContainer: {
    width: CIRCLE_SIZE,
    alignItems: 'center',
  },
  brandCircle: {
    width: CIRCLE_SIZE,
    height: CIRCLE_SIZE,
    borderRadius: CIRCLE_SIZE / 2,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  brandInitial: {
    fontFamily: typography.h3.fontFamily,
    fontSize: 28,
    fontWeight: '600',
    color: colors.white,
  },
  brandName: {
    fontFamily: typography.label.fontFamily,
    fontSize: typography.label.fontSize,
    lineHeight: typography.label.lineHeight,
    color: colors.foreground,
    textAlign: 'center',
    marginBottom: spacing.xs,
    maxWidth: CIRCLE_SIZE,
  },
  brandArticleCount: {
    fontFamily: typography.caption.fontFamily,
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: colors.muted,
    textAlign: 'center',
  },
  // Skeleton styles
  skeletonCircle: {
    backgroundColor: colors.borderLight,
  },
  skeletonBar: {
    backgroundColor: colors.borderLight,
    borderRadius: radius.sm,
    marginBottom: spacing.xs,
    width: CIRCLE_SIZE,
  },
});

export default TrendingBrandsSection;
