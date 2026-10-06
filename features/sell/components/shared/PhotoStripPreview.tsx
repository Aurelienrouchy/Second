import React from 'react';
import { StyleSheet, ScrollView } from 'react-native';
import { PrivateStorageImage } from '@/components/PrivateStorageImage';

interface PhotoStripPreviewProps {
  photos: string[];
  ownerUid: string | undefined;
}

export const PhotoStripPreview = React.memo(function PhotoStripPreview({
  photos,
  ownerUid,
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
        <PrivateStorageImage
          key={`photo-${index}`}
          uri={uri}
          allowLocalSource
            localSourceOwnerUid={ownerUid}
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
