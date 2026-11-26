import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeOut } from 'react-native-reanimated';
import { PrivateStorageImage } from '@/components/PrivateStorageImage';
import { Ionicons } from '@expo/vector-icons';
import { colors, fonts } from '@/constants/theme';

interface ThumbnailStripProps {
  photos: string[];
  ownerUid: string | undefined;
  onRemovePhoto: (index: number) => void;
  onGalleryPress: () => void;
  canAddMore: boolean;
}

const THUMB_EXITING = FadeOut.duration(200);

export const ThumbnailStrip = React.memo(function ThumbnailStrip({
  photos,
  ownerUid,
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
          <Pressable
            style={styles.addButton}
            onPress={onGalleryPress}
            testID="sell-gallery-button"
            accessibilityRole="button"
            accessibilityLabel="Ajouter depuis la galerie"
          >
            <Ionicons name="add" size={28} color={colors.cream} />
          </Pressable>
        </View>
      )}
      {photos.map((uri, index) => (
        <Animated.View
          key={uri}
          style={styles.thumbWrapper}
          exiting={THUMB_EXITING}
        >
          <PrivateStorageImage
            uri={uri}
            allowLocalSource
            localSourceOwnerUid={ownerUid}
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
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            testID={`sell-thumbnail-remove-${index}`}
            accessibilityRole="button"
            accessibilityLabel={`Retirer la photo ${index + 1}`}
          >
            <Ionicons name="close" size={12} color={colors.white} />
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
  // La croix déborde de la vignette : sur Android, la part de hitSlop qui sort
  // du parent est perdue, donc seul le cadre propre du bouton répond.
  thumbRemove: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 28,
    height: 28,
    borderRadius: 14,
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
