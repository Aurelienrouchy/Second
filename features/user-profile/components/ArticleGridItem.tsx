/**
 * ArticleGridItem — Single article thumbnail in the profile grid.
 */

import React, { useCallback } from 'react';
import { Dimensions, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { Image } from 'expo-image';

import { colors, fonts, radius, spacing, animations } from '@/constants/theme';
import { Article } from '@/types';
import { formatPrice } from '@/utils/formatPrice';

const SCREEN_WIDTH = Dimensions.get('window').width;
const GRID_GAP = 2;
const NUM_COLUMNS = 3;
export const ITEM_SIZE = (SCREEN_WIDTH - GRID_GAP * (NUM_COLUMNS - 1)) / NUM_COLUMNS;

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface ArticleGridItemProps {
  article: Article;
  onPress: (articleId: string) => void;
}

export const ArticleGridItem = React.memo(function ArticleGridItem({
  article,
  onPress,
}: ArticleGridItemProps) {
  const handlePress = useCallback(() => {
    onPress(article.id);
  }, [onPress, article.id]);
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = useCallback(() => {
    scale.value = withSpring(0.97, animations.spring.snappy);
  }, [scale]);

  const handlePressOut = useCallback(() => {
    scale.value = withSpring(1, animations.spring.bouncy);
  }, [scale]);

  return (
    <AnimatedPressable
      style={[styles.gridItem, animatedStyle]}
      onPress={handlePress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
    >
      <Image
        source={{ uri: article.images?.[0]?.url }}
        style={styles.gridImage}
        contentFit="cover"
        transition={200}
        cachePolicy="memory-disk"
      />
      {article.isSold ? (
        <View style={styles.gridSoldBadge}>
          <Text style={styles.gridSoldText}>VENDU</Text>
        </View>
      ) : (
        <View style={styles.gridPriceBadge}>
          <Text style={styles.gridPriceText}>{formatPrice(article.price)}</Text>
        </View>
      )}
    </AnimatedPressable>
  );
});

const styles = StyleSheet.create({
  gridItem: {
    width: ITEM_SIZE,
    height: ITEM_SIZE * 1.3,
    position: 'relative',
  },
  gridImage: {
    width: '100%',
    height: '100%',
    backgroundColor: colors.borderLight,
  },
  gridPriceBadge: {
    position: 'absolute',
    bottom: spacing.sm,
    left: spacing.sm,
    backgroundColor: colors.white,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.xs,
  },
  gridPriceText: {
    fontFamily: fonts.displaySemiBold,
    fontSize: 14,
    lineHeight: 18,
    color: colors.charcoal,
  },
  gridSoldBadge: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(26, 24, 20, 0.45)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  gridSoldText: {
    fontFamily: fonts.sansMedium,
    fontSize: 9,
    lineHeight: 12,
    letterSpacing: 1.8,
    color: colors.white,
    textTransform: 'uppercase',
  },
});
