import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  useWindowDimensions,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { PrivateStorageImage } from '@/components/PrivateStorageImage';
import { colors, fonts, radius, spacing, typography } from '@/constants/theme';

const VIEWABILITY_CONFIG = {
  itemVisiblePercentThreshold: 50,
};

const photoKey = (_photo: string, index: number) => index.toString();

interface PhotoCarouselProps {
  photos: string[];
  ownerUid: string | undefined;
  height?: number;
}

export default function PhotoCarousel({
  photos,
  ownerUid,
  height = 400,
}: PhotoCarouselProps) {
  const { width } = useWindowDimensions();
  const [activeIndex, setActiveIndex] = useState(0);
  const frameStyles = createFrameStyles(width, height);

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
      <PrivateStorageImage
        uri={item}
        allowLocalSource
        localSourceOwnerUid={ownerUid}
        style={[styles.photo, frameStyles.frame]}
        contentFit="contain"
      />
    ),
    [frameStyles.frame, ownerUid],
  );

  return (
    <View style={[styles.container, frameStyles.frame]}>
      <FlashList
        data={photos}
        renderItem={renderPhoto}
        keyExtractor={photoKey}
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
    position: 'relative',
    backgroundColor: colors.surfaceWarm,
  },
  photo: {
    backgroundColor: colors.surfaceWarm,
  },
  dotsContainer: {
    position: 'absolute',
    bottom: spacing.md,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.sm - spacing.xs / 2,
  },
  dot: {
    width: spacing.sm,
    height: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.whiteTranslucent,
  },
  dotActive: {
    backgroundColor: colors.white,
    width: spacing.sm + spacing.xs / 2,
    height: spacing.sm + spacing.xs / 2,
    borderRadius: radius.full,
  },
  counterContainer: {
    position: 'absolute',
    top: spacing.md,
    right: spacing.md,
    backgroundColor: colors.overlay,
    paddingHorizontal: spacing.sm + spacing.xs / 2,
    paddingVertical: spacing.xs,
    borderRadius: radius.lg,
  },
  counterText: {
    ...typography.caption,
    color: colors.white,
    fontFamily: fonts.sansMedium,
  },
});

function createFrameStyles(width: number, height: number) {
  return StyleSheet.create({
    frame: { width, height },
  });
}
