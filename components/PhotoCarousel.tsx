import React, { useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
} from 'react-native';
import { FlashList, FlashListRef } from '@shopify/flash-list';
import { Image } from 'expo-image';
import { colors } from '@/constants/theme';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const VIEWABILITY_CONFIG = {
  itemVisiblePercentThreshold: 50,
};

interface PhotoCarouselProps {
  photos: string[];
  height?: number;
}

export default function PhotoCarousel({
  photos,
  height = 400,
}: PhotoCarouselProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const flashListRef = useRef<FlashListRef<string>>(null);

  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: Array<{ index: number | null; isViewable: boolean }> }) => {
      if (viewableItems.length > 0 && viewableItems[0].index !== null) {
        setActiveIndex(viewableItems[0].index);
      }
    },
    [],
  );

  const renderPhoto = useCallback(
    ({ item }: { item: string }) => (
      <Image
        source={{ uri: item }}
        style={[styles.photo, { height }]}
        contentFit="cover"
      />
    ),
    [height],
  );

  return (
    <View style={styles.container}>
      <FlashList
        ref={flashListRef}
        data={photos}
        renderItem={renderPhoto}
        keyExtractor={(_, index) => index.toString()}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={VIEWABILITY_CONFIG}
        bounces={false}
      />

      {/* Dot indicators */}
      {photos.length > 1 && (
        <View style={styles.dotsContainer}>
          {photos.map((_, index) => (
            <View
              key={index}
              style={[
                styles.dot,
                index === activeIndex && styles.dotActive,
              ]}
            />
          ))}
        </View>
      )}

      {/* Photo counter */}
      {photos.length > 1 && (
        <View style={styles.counterContainer}>
          <Text style={styles.counterText}>
            {activeIndex + 1}/{photos.length}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: SCREEN_WIDTH,
    position: 'relative',
  },
  photo: {
    width: SCREEN_WIDTH,
    backgroundColor: colors.surfaceWarm,
  },
  dotsContainer: {
    position: 'absolute',
    bottom: 16,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.5)',
  },
  dotActive: {
    backgroundColor: '#FFFFFF',
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  counterContainer: {
    position: 'absolute',
    top: 16,
    right: 16,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  counterText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
});
