import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Pressable,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';

interface PhotoStripProps {
  photos: string[];
  maxPhotos: number;
  onRemove: (index: number) => void;
  onMakePrimary: (index: number) => void;
  onAddPress?: () => void;
}

export default function PhotoStrip({
  photos,
  maxPhotos,
  onRemove,
  onMakePrimary,
  onAddPress,
}: PhotoStripProps) {
  const canAddMore = photos.length < maxPhotos;

  // Show label tip when user has 1-3 photos (to encourage adding label photo)
  const showLabelTip = photos.length >= 1 && photos.length < maxPhotos;

  return (
    <View style={styles.container}>
      {/* Photo count */}
      <View style={styles.header}>
        <Text style={styles.countText}>
          Photos: <Text style={styles.countNumber}>{photos.length}/{maxPhotos}</Text>
        </Text>
        {photos.length > 0 && (
          <Text style={styles.hintText}>Appuyez pour définir comme principale</Text>
        )}
      </View>

      {/* Label tip */}
      {showLabelTip && (
        <View style={styles.labelTip}>
          <Ionicons name="pricetag-outline" size={14} color="#8B5CF6" />
          <Text style={styles.labelTipText}>
            Ajoutez une photo de l'étiquette pour la marque et taille exactes
          </Text>
        </View>
      )}

      {/* Photo thumbnails */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {photos.map((uri, index) => (
          <View key={`${uri}-${index}`} style={styles.photoWrapper}>
            {/* Primary badge */}
            {index === 0 && (
              <View style={styles.primaryBadge}>
                <Text style={styles.primaryBadgeText}>1ère</Text>
              </View>
            )}

            {/* Photo thumbnail */}
            <Pressable
              style={({ pressed }) => [
                styles.photoThumbnail,
                index === 0 && styles.primaryThumbnail,
                pressed && styles.photoThumbnailPressed,
              ]}
              onPress={() => onMakePrimary(index)}
            >
              <Image
                source={{ uri }}
                style={styles.photo}
                contentFit="cover"
              />
            </Pressable>

            {/* Remove button */}
            <TouchableOpacity
              style={styles.removeButton}
              onPress={() => onRemove(index)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="close" size={14} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
        ))}

        {/* Add button (if can add more) */}
        {canAddMore && onAddPress && (
          <TouchableOpacity style={styles.addButton} onPress={onAddPress}>
            <Ionicons name="add" size={32} color="#9CA3AF" />
          </TouchableOpacity>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    backgroundColor: '#FFFFFF',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  countText: {
    fontSize: 14,
    color: '#6B7280',
  },
  countNumber: {
    fontWeight: '600',
    color: '#1F2937',
  },
  hintText: {
    fontSize: 12,
    color: '#9CA3AF',
  },
  labelTip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginBottom: 8,
    backgroundColor: '#F3F0FF',
    marginHorizontal: 16,
    borderRadius: 8,
  },
  labelTipText: {
    fontSize: 12,
    color: '#6D28D9',
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    gap: 12,
  },
  photoWrapper: {
    position: 'relative',
  },
  photoThumbnail: {
    width: 80,
    height: 80,
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  primaryThumbnail: {
    borderColor: '#F79F24',
  },
  photoThumbnailPressed: {
    opacity: 0.8,
  },
  photo: {
    width: '100%',
    height: '100%',
  },
  primaryBadge: {
    position: 'absolute',
    top: -6,
    left: 4,
    zIndex: 10,
    backgroundColor: '#F79F24',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  primaryBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  removeButton: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#EF4444',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  addButton: {
    width: 80,
    height: 80,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#E5E7EB',
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
  },
});
