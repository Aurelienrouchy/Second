import { Shop, ShopTypeLabels } from '@/types';
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

interface ShopCardProps {
  shop: Shop;
  distance?: number; // Distance en km
  onPress: () => void;
}

export default function ShopCard({ shop, distance, onPress }: ShopCardProps) {
  const renderStars = (rating?: number) => {
    if (!rating) return null;
    const stars = [];
    const fullStars = Math.floor(rating);
    const hasHalfStar = rating % 1 >= 0.5;

    for (let i = 0; i < fullStars; i++) {
      stars.push(<Ionicons key={`full-${i}`} name="star" size={14} color="#FFB800" />);
    }
    if (hasHalfStar) {
      stars.push(<Ionicons key="half" name="star-half" size={14} color="#FFB800" />);
    }
    const emptyStars = 5 - stars.length;
    for (let i = 0; i < emptyStars; i++) {
      stars.push(<Ionicons key={`empty-${i}`} name="star-outline" size={14} color="#FFB800" />);
    }

    return <View style={styles.starsContainer}>{stars}</View>;
  };

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.7}>
      {/* Image */}
      <View style={styles.imageContainer}>
        {shop.images && shop.images.length > 0 ? (
          <Image source={{ uri: shop.images[0] }} style={styles.image} />
        ) : (
          <View style={styles.imagePlaceholder}>
            <Ionicons name="storefront-outline" size={32} color="#8E8E93" />
          </View>
        )}
        {shop.status === 'approved' && (
          <View style={styles.badge}>
            <Ionicons name="checkmark-circle" size={16} color="#34C759" />
          </View>
        )}
      </View>

      {/* Content */}
      <View style={styles.content}>
        <View style={styles.header}>
          <Text style={styles.name} numberOfLines={1}>
            {shop.name}
          </Text>
          {distance !== undefined && (
            <View style={styles.distanceContainer}>
              <Ionicons name="location-outline" size={12} color="#8E8E93" />
              <Text style={styles.distance}>{distance.toFixed(1)} km</Text>
            </View>
          )}
        </View>

        <Text style={styles.type}>{ShopTypeLabels[shop.type]}</Text>

        {shop.rating && (
          <View style={styles.ratingContainer}>
            {renderStars(shop.rating)}
            <Text style={styles.ratingText}>
              {shop.rating.toFixed(1)} ({shop.reviewCount})
            </Text>
          </View>
        )}

        <View style={styles.info}>
          <Ionicons name="location-outline" size={14} color="#8E8E93" />
          <Text style={styles.address} numberOfLines={1}>
            {shop.address.city}
          </Text>
        </View>

        {shop.articlesCount > 0 && (
          <Text style={styles.articlesCount}>
            {shop.articlesCount} article{shop.articlesCount > 1 ? 's' : ''} en vente
          </Text>
        )}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    width: 200,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#F2F2F7',
    marginRight: 12,
  },
  imageContainer: {
    position: 'relative',
    width: '100%',
    height: 120,
  },
  image: {
    width: '100%',
    height: '100%',
    backgroundColor: '#F2F2F7',
  },
  imagePlaceholder: {
    width: '100%',
    height: '100%',
    backgroundColor: '#F2F2F7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 4,
  },
  content: {
    padding: 12,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 4,
    gap: 8,
  },
  name: {
    flex: 1,
    fontSize: 16,
    fontWeight: '700',
    color: '#1C1C1E',
  },
  distanceContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: '#F2F2F7',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
  },
  distance: {
    fontSize: 11,
    fontWeight: '600',
    color: '#8E8E93',
  },
  type: {
    fontSize: 13,
    color: '#F79F24',
    fontWeight: '500',
    marginBottom: 8,
  },
  ratingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  starsContainer: {
    flexDirection: 'row',
    gap: 2,
  },
  ratingText: {
    fontSize: 12,
    color: '#8E8E93',
    fontWeight: '500',
  },
  info: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 6,
  },
  address: {
    flex: 1,
    fontSize: 13,
    color: '#8E8E93',
  },
  articlesCount: {
    fontSize: 12,
    color: '#34C759',
    fontWeight: '600',
  },
});

