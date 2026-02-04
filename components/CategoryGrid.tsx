/**
 * CategoryGrid Component
 * Design System: Luxe Français + Street
 *
 * Photo grid with text overlay for categories
 * Inspired by Depop's lifestyle category grid
 */

import React, { useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Dimensions,
} from 'react-native';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import Animated, {
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';

import { colors, spacing, typography, radius, shadows, animations } from '@/constants/theme';

// =============================================================================
// TYPES
// =============================================================================

interface Category {
  id: string;
  label: string;
  image: string;
  blurhash?: string;
}

interface CategoryGridProps {
  categories: Category[];
  onCategoryPress: (categoryId: string) => void;
  testID?: string;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const GRID_GAP = spacing.sm;
const CARD_WIDTH = (SCREEN_WIDTH - spacing.md * 2 - GRID_GAP) / 2;
const CARD_HEIGHT = CARD_WIDTH * 1.2;

// =============================================================================
// ANIMATED PRESSABLE
// =============================================================================

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// =============================================================================
// CATEGORY CARD COMPONENT
// =============================================================================

interface CategoryCardProps {
  category: Category;
  onPress: () => void;
  index: number;
  testID?: string;
}

const CategoryCard: React.FC<CategoryCardProps> = ({
  category,
  onPress,
  index,
  testID,
}) => {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = useCallback(() => {
    scale.value = withSpring(0.96, animations.spring.snappy);
  }, [scale]);

  const handlePressOut = useCallback(() => {
    scale.value = withSpring(1, animations.spring.bouncy);
  }, [scale]);

  const handlePress = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress();
  }, [onPress]);

  return (
    <Animated.View
      entering={FadeInDown.duration(400).delay(100 + index * 50)}
      style={styles.cardWrapper}
    >
      <AnimatedPressable
        style={[styles.card, animatedStyle]}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        onPress={handlePress}
        testID={testID}
      >
        <Image
          source={{ uri: category.image }}
          style={styles.cardImage}
          contentFit="cover"
          placeholder={category.blurhash}
          transition={200}
        />

        {/* Gradient Overlay */}
        <LinearGradient
          colors={['transparent', 'rgba(0, 0, 0, 0.6)']}
          style={styles.cardGradient}
        />

        {/* Label */}
        <View style={styles.cardLabelContainer}>
          <Text style={styles.cardLabel}>{category.label}</Text>
        </View>
      </AnimatedPressable>
    </Animated.View>
  );
};

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export const CategoryGrid: React.FC<CategoryGridProps> = ({
  categories,
  onCategoryPress,
  testID,
}) => {
  return (
    <View style={styles.container} testID={testID}>
      <View style={styles.grid}>
        {categories.map((category, index) => (
          <CategoryCard
            key={category.id}
            category={category}
            onPress={() => onCategoryPress(category.id)}
            index={index}
            testID={`category-card-${category.id}`}
          />
        ))}
      </View>
    </View>
  );
};

// =============================================================================
// SKELETON
// =============================================================================

export const CategoryGridSkeleton: React.FC = () => (
  <View style={styles.container}>
    <View style={styles.grid}>
      {[1, 2, 3, 4].map((i) => (
        <View key={i} style={styles.cardWrapper}>
          <View style={[styles.card, styles.skeletonCard]} />
        </View>
      ))}
    </View>
  </View>
);

// =============================================================================
// STYLES
// =============================================================================

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GRID_GAP,
  },
  cardWrapper: {
    width: CARD_WIDTH,
  },
  card: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: colors.borderLight,
    ...shadows.card,
  },
  cardImage: {
    width: '100%',
    height: '100%',
  },
  cardGradient: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '50%',
  },
  cardLabelContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: spacing.md,
  },
  cardLabel: {
    fontFamily: typography.h3.fontFamily,
    fontSize: 16,
    fontWeight: '700',
    color: colors.white,
    textShadowColor: 'rgba(0, 0, 0, 0.3)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  skeletonCard: {
    backgroundColor: colors.borderLight,
  },
});

export default CategoryGrid;
