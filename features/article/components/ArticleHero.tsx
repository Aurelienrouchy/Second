/**
 * ArticleHero — image gallery + discount badge (lives inside the scroll view).
 *
 * The sticky header is exported as a separate `ArticleFloatingHeader` so it can be
 * rendered as a sibling of the ScrollView (absolute positioning relative to the screen).
 */

import React from 'react';
import { Text, View } from 'react-native';
import Animated, {
  interpolate,
  useAnimatedStyle,
  type SharedValue,
} from 'react-native-reanimated';

import ImageGallery from '@/components/ImageGallery';
import { colors } from '@/constants/theme';

import type { ArticleImage } from '@/types';

import { HERO_HEIGHT, articleStyles as styles } from '../styles';

import { HeaderButton } from './HeaderButton';

export interface ArticleHeroProps {
  images: ArticleImage[];
  discount: number | null;
  onImageIndexChange?: (index: number) => void;
}

function ArticleHeroComponent({
  images,
  discount,
  onImageIndexChange,
}: ArticleHeroProps) {
  return (
    <>
      <ImageGallery
        images={images}
        onImageIndexChange={onImageIndexChange}
      />

      {discount !== null && (
        <View style={styles.discountBadge}>
          <Text style={styles.discountText}>–{discount}%</Text>
        </View>
      )}
    </>
  );
}

export const ArticleHero = React.memo(ArticleHeroComponent);

// ---------------------------------------------------------------------------
// Floating header — rendered as a sibling of the scroll view (absolute pos).
// ---------------------------------------------------------------------------

export interface ArticleFloatingHeaderProps {
  isFavorite: boolean;
  isSold?: boolean;
  scrollY: SharedValue<number>;
  insetsTop: number;
  onBack: () => void;
  onToggleFavorite: () => void;
  onShare: () => void;
  onMoreOptions: () => void;
}

function ArticleFloatingHeaderComponent({
  isFavorite,
  isSold = false,
  scrollY,
  insetsTop,
  onBack,
  onToggleFavorite,
  onShare,
  onMoreOptions,
}: ArticleFloatingHeaderProps) {
  // Header background: transparent over hero, cream when scrolled past
  const headerAnimatedStyle = useAnimatedStyle(() => {
    const opacity = interpolate(scrollY.value, [0, HERO_HEIGHT - 100], [0, 1], 'clamp');
    return { backgroundColor: `rgba(245, 240, 232, ${opacity})` };
  });

  return (
    <Animated.View style={[styles.floatingHeader, headerAnimatedStyle, { paddingTop: insetsTop }]}>
      <HeaderButton icon="chevron-back" onPress={onBack} />
      <View style={styles.headerActions}>
        <HeaderButton
          icon={isFavorite ? 'heart' : 'heart-outline'}
          onPress={onToggleFavorite}
          isActive={isFavorite}
          activeColor={colors.white}
          disabled={isSold}
        />
        <HeaderButton icon="share-outline" onPress={onShare} />
        <HeaderButton icon="ellipsis-horizontal" onPress={onMoreOptions} size={18} />
      </View>
    </Animated.View>
  );
}

export const ArticleFloatingHeader = React.memo(ArticleFloatingHeaderComponent);
