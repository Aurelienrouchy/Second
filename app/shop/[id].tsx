/**
 * Shop Detail Page
 * Displays complete information about a physical shop
 */

import { ShopService } from '@/services/shopService';
import { queryKeys } from '@/lib/queryKeys';
import { Shop, ShopTypeLabels } from '@/types';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import {
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { ScreenHeader } from '@/components/ui';
import { Skeleton } from '@/components/ui/Skeleton';
import { Image } from 'expo-image';
import { Platform } from 'react-native';
import MapView, { Marker, PROVIDER_DEFAULT, PROVIDER_GOOGLE } from 'react-native-maps';
import { colors } from '@/constants/theme';

// react-native-maps : Android utilise toujours Google Maps nativement (provider ignoré).
// Sur iOS, PROVIDER_GOOGLE exige une clé Maps ; sans clé la carte est cassée.
// On retombe sur Apple Maps (PROVIDER_DEFAULT) quand la clé iOS est absente.
const mapProvider =
  Platform.OS === 'ios' && !process.env.EXPO_PUBLIC_IOS_GOOGLE_MAPS_API_KEY
    ? PROVIDER_DEFAULT
    : PROVIDER_GOOGLE;

export default function ShopDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);

  const { data: shop = null, isLoading } = useQuery<Shop | null>({
    queryKey: queryKeys.shops.detail(id ?? ''),
    queryFn: () => ShopService.getShopById(id!),
    enabled: !!id,
    staleTime: 10 * 60 * 1000,
  });

  const handleCall = () => {
    if (shop?.phoneNumber) {
      Linking.openURL(`tel:${shop.phoneNumber}`);
    }
  };

  const handleEmail = () => {
    if (shop?.email) {
      Linking.openURL(`mailto:${shop.email}`);
    }
  };

  const handleWebsite = () => {
    if (shop?.website) {
      const url = shop.website.startsWith('http') ? shop.website : `https://${shop.website}`;
      Linking.openURL(url);
    }
  };

  const handleSocialMedia = (platform: 'instagram' | 'facebook') => {
    if (!shop?.socialMedia) return;
    
    const username = shop.socialMedia[platform];
    if (!username) return;

    const url = platform === 'instagram'
      ? `https://instagram.com/${username}`
      : `https://facebook.com/${username}`;
    
    Linking.openURL(url);
  };

  const renderOpeningHours = () => {
    if (!shop?.openingHours) return null;

    const days = [
      { key: 'monday', label: 'Lundi' },
      { key: 'tuesday', label: 'Mardi' },
      { key: 'wednesday', label: 'Mercredi' },
      { key: 'thursday', label: 'Jeudi' },
      { key: 'friday', label: 'Vendredi' },
      { key: 'saturday', label: 'Samedi' },
      { key: 'sunday', label: 'Dimanche' },
    ];

    return (
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Ionicons name="time-outline" size={20} color={colors.foreground} />
          <Text style={styles.sectionTitle}>Horaires d'ouverture</Text>
        </View>
        {days.map((day) => {
          const hours = shop.openingHours[day.key];
          return (
            <View key={day.key} style={styles.hoursRow}>
              <Text style={styles.dayLabel}>{day.label}</Text>
              <Text style={[styles.hoursText, !hours && styles.closedText]}>
                {hours ? `${hours.open} - ${hours.close}` : 'Fermé'}
              </Text>
            </View>
          );
        })}
      </View>
    );
  };

  if (isLoading) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Boutique" onBack={() => router.back()} />
        {/* Main image */}
        <Skeleton width="100%" height={300} borderRadius={0} />
        {/* Thumbnails */}
        <View style={{ flexDirection: 'row', paddingHorizontal: 16, marginTop: 12, gap: 8 }}>
          <Skeleton width={80} height={80} borderRadius={4} />
          <Skeleton width={80} height={80} borderRadius={4} />
          <Skeleton width={80} height={80} borderRadius={4} />
        </View>
        {/* Shop info */}
        <View style={styles.infoContainer}>
          {/* Logo + name */}
          <View style={styles.nameContainer}>
            <Skeleton width={60} height={60} borderRadius={30} />
            <View style={{ flex: 1, gap: 6 }}>
              <Skeleton width="65%" height={24} />
              <Skeleton width="40%" height={14} />
            </View>
          </View>
          {/* Type badge */}
          <Skeleton width={120} height={28} borderRadius={20} style={{ marginBottom: 16 }} />
          {/* Description lines */}
          <Skeleton width="100%" height={16} style={{ marginBottom: 6 }} />
          <Skeleton width="100%" height={16} style={{ marginBottom: 6 }} />
          <Skeleton width="60%" height={16} style={{ marginBottom: 24 }} />
          {/* Action buttons */}
          <View style={styles.actionsContainer}>
            <Skeleton width="100%" height={44} borderRadius={0} style={{ flex: 1 }} />
            <Skeleton width="100%" height={44} borderRadius={0} style={{ flex: 1 }} />
            <Skeleton width="100%" height={44} borderRadius={0} style={{ flex: 1 }} />
          </View>
        </View>
      </View>
    );
  }

  if (!shop) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Boutique" onBack={() => router.back()} />
        <View style={styles.errorContainer}>
          <Ionicons name="alert-circle-outline" size={64} color="#FF3B30" />
          <Text style={styles.errorText}>Boutique introuvable</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScreenHeader title={shop.name} onBack={() => router.back()} />

      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        {/* Image Gallery */}
        {shop.images && shop.images.length > 0 && (
          <View style={styles.galleryContainer}>
            <Image source={{ uri: shop.images[selectedImageIndex] }} style={styles.mainImage} />
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.thumbnailScroll}
              contentContainerStyle={styles.thumbnailsContainer}
            >
              {shop.images.map((image, index) => (
                <Pressable
                  key={index}
                  onPress={() => setSelectedImageIndex(index)}
                  style={[
                    styles.thumbnail,
                    selectedImageIndex === index && styles.thumbnailSelected,
                  ]}
                >
                  <Image source={{ uri: image }} style={styles.thumbnailImage} />
                </Pressable>
              ))}
            </ScrollView>
          </View>
        )}

        {/* Shop Info */}
        <View style={styles.infoContainer}>
          {/* Name and Badge */}
          <View style={styles.nameContainer}>
            {shop.logo && (
              <Image source={{ uri: shop.logo }} style={styles.logo} />
            )}
            <View style={styles.nameContent}>
              <Text style={styles.shopName}>{shop.name}</Text>
              {shop.status === 'approved' && (
                <View style={styles.verifiedBadge}>
                  <Ionicons name="checkmark-circle" size={16} color="#34C759" />
                  <Text style={styles.verifiedText}>Boutique vérifiée</Text>
                </View>
              )}
            </View>
          </View>

          {/* Type */}
          <View style={styles.typeBadge}>
            <Text style={styles.typeText}>{ShopTypeLabels[shop.type]}</Text>
          </View>

          {/* Description */}
          {shop.description && (
            <Text style={styles.description}>{shop.description}</Text>
          )}

          {/* Contact Actions */}
          <View style={styles.actionsContainer}>
            <Pressable style={styles.actionButton} onPress={handleCall}>
              <Ionicons name="call-outline" size={20} color={colors.primary} />
              <Text style={styles.actionButtonText}>Appeler</Text>
            </Pressable>
            <Pressable style={styles.actionButton} onPress={handleEmail}>
              <Ionicons name="mail-outline" size={20} color={colors.primary} />
              <Text style={styles.actionButtonText}>Email</Text>
            </Pressable>
            {shop.website && (
              <Pressable style={styles.actionButton} onPress={handleWebsite}>
                <Ionicons name="globe-outline" size={20} color={colors.primary} />
                <Text style={styles.actionButtonText}>Site web</Text>
              </Pressable>
            )}
          </View>

          {/* Address */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Ionicons name="location-outline" size={20} color={colors.foreground} />
              <Text style={styles.sectionTitle}>Adresse</Text>
            </View>
            <Text style={styles.addressText}>
              {shop.address.street}{'\n'}
              {shop.address.postalCode} {shop.address.city}{'\n'}
              {shop.address.country}
            </Text>
          </View>

          {/* Map */}
          {shop.location && (
            <View style={styles.mapContainer}>
              <MapView
                style={styles.map}
                provider={mapProvider}
                initialRegion={{
                  latitude: shop.location.latitude,
                  longitude: shop.location.longitude,
                  latitudeDelta: 0.01,
                  longitudeDelta: 0.01,
                }}
              >
                <Marker
                  coordinate={{
                    latitude: shop.location.latitude,
                    longitude: shop.location.longitude,
                  }}
                />
              </MapView>
            </View>
          )}

          {/* Opening Hours */}
          {renderOpeningHours()}

          {/* Social Media */}
          {(shop.socialMedia?.instagram || shop.socialMedia?.facebook) && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Ionicons name="share-social-outline" size={20} color={colors.foreground} />
                <Text style={styles.sectionTitle}>Réseaux sociaux</Text>
              </View>
              <View style={styles.socialContainer}>
                {shop.socialMedia.instagram && (
                  <Pressable
                    style={styles.socialButton}
                    onPress={() => handleSocialMedia('instagram')}
                  >
                    <Ionicons name="logo-instagram" size={24} color="#E4405F" />
                    <Text style={styles.socialText}>@{shop.socialMedia.instagram}</Text>
                  </Pressable>
                )}
                {shop.socialMedia.facebook && (
                  <Pressable
                    style={styles.socialButton}
                    onPress={() => handleSocialMedia('facebook')}
                  >
                    <Ionicons name="logo-facebook" size={24} color="#1877F2" />
                    <Text style={styles.socialText}>{shop.socialMedia.facebook}</Text>
                  </Pressable>
                )}
              </View>
            </View>
          )}

          {/* Articles en vente */}
          {shop.articlesCount > 0 && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Ionicons name="pricetag-outline" size={20} color={colors.foreground} />
                <Text style={styles.sectionTitle}>
                  Articles en vente ({shop.articlesCount})
                </Text>
              </View>
              <Pressable
                style={styles.viewArticlesButton}
                onPress={() => router.push(`/search?shopId=${shop.id}`)}
              >
                <Text style={styles.viewArticlesButtonText}>Voir tous les articles</Text>
                <Ionicons name="chevron-forward" size={20} color={colors.primary} />
              </Pressable>
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.white,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceWarm,
  },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
    color: colors.foreground,
    textAlign: 'center',
    marginHorizontal: 16,
  },
  placeholder: {
    width: 24,
  },
  scrollView: {
    flex: 1,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  errorText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#FF3B30',
  },
  galleryContainer: {
    marginBottom: 20,
  },
  mainImage: {
    width: '100%',
    height: 300,
    backgroundColor: colors.surfaceWarm,
  },
  thumbnailScroll: {
    marginTop: 12,
  },
  thumbnailsContainer: {
    paddingHorizontal: 16,
    gap: 8,
  },
  thumbnail: {
    width: 80,
    height: 80,
    borderRadius: 4,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  thumbnailSelected: {
    borderColor: colors.primary,
  },
  thumbnailImage: {
    width: '100%',
    height: '100%',
    backgroundColor: colors.surfaceWarm,
  },
  infoContainer: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  nameContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginBottom: 12,
  },
  logo: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.surfaceWarm,
  },
  nameContent: {
    flex: 1,
  },
  shopName: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.foreground,
    marginBottom: 4,
  },
  verifiedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  verifiedText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#34C759',
  },
  typeBadge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.primaryLight,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    marginBottom: 16,
  },
  typeText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.primary,
  },
  description: {
    fontSize: 16,
    color: colors.foreground,
    lineHeight: 24,
    marginBottom: 24,
  },
  actionsContainer: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 24,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.surfaceWarm,
    paddingVertical: 12,
    borderRadius: 0,
  },
  actionButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.primary,
  },
  section: {
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.foreground,
  },
  addressText: {
    fontSize: 16,
    color: colors.foreground,
    lineHeight: 24,
  },
  mapContainer: {
    height: 200,
    borderRadius: 0,
    overflow: 'hidden',
    marginBottom: 24,
  },
  map: {
    width: '100%',
    height: '100%',
  },
  hoursRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceWarm,
  },
  dayLabel: {
    fontSize: 15,
    fontWeight: '500',
    color: colors.foreground,
  },
  hoursText: {
    fontSize: 15,
    color: '#34C759',
    fontWeight: '600',
  },
  closedText: {
    color: colors.muted,
  },
  socialContainer: {
    gap: 12,
  },
  socialButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surfaceWarm,
    padding: 16,
    borderRadius: 0,
  },
  socialText: {
    fontSize: 16,
    fontWeight: '500',
    color: colors.foreground,
  },
  viewArticlesButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surfaceWarm,
    padding: 16,
    borderRadius: 0,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  viewArticlesButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.primary,
  },
});

