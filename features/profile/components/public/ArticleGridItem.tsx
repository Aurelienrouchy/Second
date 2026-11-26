/**
 * ArticleGridItem — Single article thumbnail in the profile grid.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { Image } from 'expo-image';

import { colors, fonts, radius, spacing } from '@/constants/theme';
import { Article } from '@/types';
import { formatPrice } from '@/utils/formatPrice';
import { normalizeArticleImages } from '@/utils/articleImages';

const GRID_GAP = 2;
const NUM_COLUMNS = 3;

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface ArticleGridItemProps {
  article: Article;
  onPress: (articleId: string) => void;
}

export const ArticleGridItem = React.memo(function ArticleGridItem({
  article,
  onPress,
}: ArticleGridItemProps) {
  const { width } = useWindowDimensions();
  const itemSize = (width - GRID_GAP * (NUM_COLUMNS - 1)) / NUM_COLUMNS;
  const image = normalizeArticleImages(article.images)[0];
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [image?.url]);
  const handlePress = useCallback(() => {
    onPress(article.id);
  }, [onPress, article.id]);
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = useCallback(() => {
    scale.value = withTiming(0.97, { duration: 150, easing: Easing.out(Easing.ease) });
  }, [scale]);

  const handlePressOut = useCallback(() => {
    scale.value = withTiming(1, { duration: 200, easing: Easing.out(Easing.ease) });
  }, [scale]);

  return (
    <AnimatedPressable
      style={[styles.gridItem, { width: itemSize, height: itemSize * 1.3 }, animatedStyle]}
      accessibilityRole="button"
      accessibilityLabel={article.title}
      testID={`profile-article-${article.id}`}
      onPress={handlePress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
    >
      {image && !failed ? (
        <Image source={{ uri: image.url }} style={styles.gridImage} contentFit="cover" transition={200}
          cachePolicy="memory-disk" placeholder={image.blurhash ? { blurhash: image.blurhash } : undefined}
          onError={() => setFailed(true)} testID={`profile-article-image-${article.id}`} />
      ) : (
        <View style={[styles.gridImage, styles.placeholder]} accessibilityLabel="Photo indisponible">
          <Ionicons name="image-outline" size={24} color={colors.muted} />
        </View>
      )}
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
    position: 'relative',
  },
  gridImage: {
    width: '100%',
    height: '100%',
    backgroundColor: colors.borderLight,
  },
  placeholder: { justifyContent: 'center', alignItems: 'center' },
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
