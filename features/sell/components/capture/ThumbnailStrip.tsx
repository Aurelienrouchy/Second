import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInRight, FadeOut, LinearTransition } from 'react-native-reanimated';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { colors, fonts } from '@/constants/theme';

interface ThumbnailStripProps {
  photos: string[];
  onRemovePhoto: (index: number) => void;
  onGalleryPress: () => void;
  canAddMore: boolean;
}

const THUMB_ENTERING = FadeInRight.duration(300);
const THUMB_EXITING = FadeOut.duration(200);
const THUMB_LAYOUT = LinearTransition.duration(250);

export const ThumbnailStrip = React.memo(function ThumbnailStrip({
  photos,
  onRemovePhoto,
  onGalleryPress,
  canAddMore,
}: ThumbnailStripProps) {
  return (
    <Animated.ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.thumbnailStrip}
    >
      {canAddMore && (
        <View style={styles.thumbWrapper}>
          <Pressable style={styles.addButton} onPress={onGalleryPress} testID="sell-gallery-button">
            <Ionicons name="add" size={28} color={colors.cream} />
          </Pressable>
        </View>
      )}
      {photos.map((uri, index) => (
        <Animated.View
          key={uri}
          style={styles.thumbWrapper}
          entering={THUMB_ENTERING}
          exiting={THUMB_EXITING}
          layout={THUMB_LAYOUT}
        >
          <Image
            source={{ uri }}
            style={[
              styles.thumbnail,
              index === 0 && styles.thumbnailPrimary,
            ]}
            contentFit="cover"
          />
          <Animated.View style={styles.indexBadge}>
            <Text style={styles.indexText}>{index + 1}</Text>
          </Animated.View>
          <Pressable
            style={styles.thumbRemove}
            onPress={() => onRemovePhoto(index)}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            testID={`sell-thumbnail-remove-${index}`}
          >
            <Ionicons name="close" size={10} color={colors.white} />
          </Pressable>
        </Animated.View>
      ))}
    </Animated.ScrollView>
  );
});

const styles = StyleSheet.create({
  thumbnailStrip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 10,
  },
  thumbWrapper: {
    position: 'relative',
  },
  thumbnail: {
    width: 56,
    height: 72,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  thumbnailPrimary: {
    borderColor: 'rgba(255,255,255,0.9)',
  },
  indexBadge: {
    position: 'absolute',
    bottom: 4,
    left: 4,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: 'rgba(255,255,255,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  indexText: {
    fontFamily: fonts.sansMedium,
    fontSize: 10,
    color: colors.charcoal,
  },
  thumbRemove: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  addButton: {
    width: 56,
    height: 72,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.25)',
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
});
