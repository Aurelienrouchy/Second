import React from 'react';
import { View, Pressable, ScrollView, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/constants/theme';

interface ThumbnailStripProps {
  photos: string[];
  onRemovePhoto: (index: number) => void;
}

export const ThumbnailStrip = React.memo(function ThumbnailStrip({
  photos,
  onRemovePhoto,
}: ThumbnailStripProps) {
  if (photos.length === 0) return null;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.thumbnailStrip}
      style={styles.thumbnailScrollView}
    >
      {photos.map((uri, index) => (
        <View key={`${uri}-${index}`} style={styles.thumbWrapper}>
          <Image
            source={{ uri }}
            style={[
              styles.thumbnail,
              index === 0 && styles.thumbnailPrimary,
            ]}
            contentFit="cover"
          />
          {index === 0 && <View style={styles.primaryDot} />}
          <Pressable
            style={styles.thumbRemove}
            onPress={() => onRemovePhoto(index)}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          >
            <Ionicons name="close" size={10} color={colors.white} />
          </Pressable>
        </View>
      ))}
    </ScrollView>
  );
});

const styles = StyleSheet.create({
  thumbnailScrollView: {
    marginBottom: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(245, 240, 232, 0.06)',
  },
  thumbnailStrip: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    gap: 8,
  },
  thumbWrapper: {
    position: 'relative',
  },
  thumbnail: {
    width: 52,
    height: 68,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  thumbnailPrimary: {
    borderColor: colors.rust,
  },
  primaryDot: {
    position: 'absolute',
    bottom: -8,
    alignSelf: 'center',
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.rust,
  },
  thumbRemove: {
    position: 'absolute',
    top: -8,
    right: -8,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.charcoal,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
