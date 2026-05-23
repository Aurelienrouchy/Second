import React from 'react';
import { StyleSheet, ScrollView } from 'react-native';
import { Image } from 'expo-image';

interface PhotoStripPreviewProps {
  photos: string[];
}

export const PhotoStripPreview = React.memo(function PhotoStripPreview({
  photos,
}: PhotoStripPreviewProps) {
  if (photos.length === 0) return null;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.photoStrip}
      style={styles.photoStripContainer}
    >
      {photos.map((uri, index) => (
        <Image
          key={`photo-${index}`}
          source={{ uri }}
          style={styles.photoThumb}
          contentFit="cover"
        />
      ))}
    </ScrollView>
  );
});

const styles = StyleSheet.create({
  photoStripContainer: {
    marginBottom: 20,
    marginHorizontal: -20,
  },
  photoStrip: {
    paddingHorizontal: 20,
    paddingTop: 0,
    paddingBottom: 0,
    gap: 8,
  },
  photoThumb: {
    width: 90,
    height: 120,
    borderRadius: 4,
  },
});
