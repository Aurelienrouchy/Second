/**
 * Shop Detail Page
 * Displays complete information about a physical shop
 */

import { ShopService } from '@/services/shopService';
import { Shop, ShopTypeLabels } from '@/types';
import { Ionicons } from '@expo/vector-icons';
import { FlashList } from '@shopify/flash-list';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function ShopDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [shop, setShop] = useState<Shop | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);

  useEffect(() => {
    if (id) {
      loadShopDetails();
    }
  }, [id]);

  const loadShopDetails = async () => {
    try {
      setIsLoading(true);
      const shopData = await ShopService.getShopById(id!);
      setShop(shopData);
    } catch (error) {
      console.error('Error loading shop details:', error);
    } finally {
      setIsLoading(false);
    }
  };

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
          <Ionicons name="time-outline" size={20} color="#1C1C1E" />
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
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#F79F24" />
          <Text style={styles.loadingText}>Chargement...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!shop) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.errorContainer}>
          <Ionicons name="alert-circle-outline" size={64} color="#FF3B30" />
          <Text style={styles.errorText}>Boutique introuvable</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="chevron-back" size={24} color="#1C1C1E" />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {shop.name}
        </Text>
        <View style={styles.placeholder} />
      </View>

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
              <Ionicons name="call-outline" size={20} color="#F79F24" />
              <Text style={styles.actionButtonText}>Appeler</Text>
            </Pressable>
            <Pressable style={styles.actionButton} onPress={handleEmail}>
              <Ionicons name="mail-outline" size={20} color="#F79F24" />
              <Text style={styles.actionButtonText}>Email</Text>
            </Pressable>
            {shop.website && (
              <Pressable style={styles.actionButton} onPress={handleWebsite}>
                <Ionicons name="globe-outline" size={20} color="#F79F24" />
                <Text style={styles.actionButtonText}>Site web</Text>
              </Pressable>
            )}
          </View>

          {/* Address */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Ionicons name="location-outline" size={20} color="#1C1C1E" />
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
                provider={PROVIDER_GOOGLE}
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
                <Ionicons name="share-social-outline" size={20} color="#1C1C1E" />
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
                <Ionicons name="pricetag-outline" size={20} color="#1C1C1E" />
                <Text style={styles.sectionTitle}>
                  Articles en vente ({shop.articlesCount})
                </Text>
              </View>
              <Pressable
                style={styles.viewArticlesButton}
                onPress={() => router.push(`/search-results?shopId=${shop.id}`)}
              >
                <Text style={styles.viewArticlesButtonText}>Voir tous les articles</Text>
                <Ionicons name="chevron-forward" size={20} color="#F79F24" />
              </Pressable>
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F2F2F7',
  },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
    color: '#1C1C1E',
    textAlign: 'center',
    marginHorizontal: 16,
  },
  placeholder: {
    width: 24,
  },
  scrollView: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  loadingText: {
    fontSize: 16,
    color: '#8E8E93',
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
    backgroundColor: '#F2F2F7',
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
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  thumbnailSelected: {
    borderColor: '#F79F24',
  },
  thumbnailImage: {
    width: '100%',
    height: '100%',
    backgroundColor: '#F2F2F7',
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
    backgroundColor: '#F2F2F7',
  },
  nameContent: {
    flex: 1,
  },
  shopName: {
    fontSize: 24,
    fontWeight: '700',
    color: '#1C1C1E',
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
    backgroundColor: '#FFE8C8',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    marginBottom: 16,
  },
  typeText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#F79F24',
  },
  description: {
    fontSize: 16,
    color: '#1C1C1E',
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
    backgroundColor: '#F2F2F7',
    paddingVertical: 12,
    borderRadius: 12,
  },
  actionButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#F79F24',
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
    color: '#1C1C1E',
  },
  addressText: {
    fontSize: 16,
    color: '#1C1C1E',
    lineHeight: 24,
  },
  mapContainer: {
    height: 200,
    borderRadius: 12,
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
    borderBottomColor: '#F2F2F7',
  },
  dayLabel: {
    fontSize: 15,
    fontWeight: '500',
    color: '#1C1C1E',
  },
  hoursText: {
    fontSize: 15,
    color: '#34C759',
    fontWeight: '600',
  },
  closedText: {
    color: '#8E8E93',
  },
  socialContainer: {
    gap: 12,
  },
  socialButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#F2F2F7',
    padding: 16,
    borderRadius: 12,
  },
  socialText: {
    fontSize: 16,
    fontWeight: '500',
    color: '#1C1C1E',
  },
  viewArticlesButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFF9F0',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#F79F24',
  },
  viewArticlesButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#F79F24',
  },
});

