/**
 * TrendingBrandsSection — Feature Component
 * Self-contained: fetches its own data via useTrendingBrands()
 * Wrapped in React.memo for render isolation
 */

import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import React, { useCallback } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, {
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { SectionHeader } from '@/components/home/SectionHeader';
import { animations, colors, radius, spacing, typography } from '@/constants/theme';
import { TrendingBrand, useTrendingBrands } from './useTrendingBrands';

// =============================================================================
// CONSTANTS
// =============================================================================

const CIRCLE_SIZE = 72;
const CIRCLE_MARGIN = spacing.md;

const GRADIENT_PAIRS: [string, string][] = [
  ['#C4603A', '#8B3A1A'],
  ['#7A8C6E', '#4A5C40'],
  ['#D4C4A0', '#A89870'],
  ['#B8847C', '#8B6860'],
  ['#3D9970', '#1A7A4A'],
  ['#E09F3E', '#C07A20'],
  ['#2A3550', '#0A1530'],
  ['#6A7050', '#3A4030'],
  ['#A09888', '#706858'],
  ['#D8CDB8', '#B0A088'],
];

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}

function getGradientForBrand(brandName: string): [string, string] {
  const hash = hashString(brandName);
  return GRADIENT_PAIRS[hash % GRADIENT_PAIRS.length];
}

// =============================================================================
// BRAND CIRCLE
// =============================================================================

interface BrandCircleProps {
  brand: TrendingBrand;
  index: number;
}

// Memoised — only re-renders if brand data or index changes.
// Navigation handled internally so parent passes no callbacks (no ref churn).
const BrandCircle = React.memo<BrandCircleProps>(({ brand, index }) => {
  const scale = useSharedValue(1);
  const gradient = getGradientForBrand(brand.name);
  const initial = brand.name.charAt(0).toUpperCase();

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = () => {
    scale.value = withSpring(0.92, animations.spring.snappy);
  };
  const handlePressOut = () => {
    scale.value = withSpring(1, animations.spring.bouncy);
  };
  const handlePress = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push({ pathname: '/search', params: { brand: brand.name } });
  }, [brand.name]);

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

        <Text style={styles.brandName} numberOfLines={1} ellipsizeMode="tail">
          {brand.name}
        </Text>

        <Text style={styles.brandArticleCount}>
          {brand.articleCount} {brand.articleCount === 1 ? 'article' : 'articles'}
        </Text>
      </Pressable>
    </Animated.View>
  );
});

// =============================================================================
// SKELETON
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

const TrendingBrandsSectionComponent: React.FC = () => {
  const { data: brands, isLoading } = useTrendingBrands();

  if (!isLoading && (!brands || brands.length === 0)) {
    return null;
  }

  const displayBrands = isLoading ? Array(5).fill(null) : brands!;

  return (
    <View>
      <SectionHeader
        title="Tendances"
        action="Voir tout"
        onActionPress={() => router.push('/search')}
      />
      <View style={styles.container}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          scrollEventThrottle={16}
          contentContainerStyle={styles.scrollContent}
        >
          {displayBrands.map((brand: TrendingBrand | null, index: number) => {
            if (isLoading || !brand) {
              return <BrandCircleSkeleton key={`skeleton-${index}`} index={index} />;
            }
            return (
              <BrandCircle
                key={brand.name}
                brand={brand}
                index={index}
              />
            );
          })}
        </ScrollView>
      </View>
    </View>
  );
};

export const TrendingBrandsSection = React.memo(TrendingBrandsSectionComponent);

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
