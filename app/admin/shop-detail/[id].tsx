/**
 * Admin - Shop Detail Validation Page
 * Vue détaillée d'une boutique pour validation/rejet/suspension
 */

import RejectionModal, { RejectionModalRef } from '@/components/admin/RejectionModal';
import { useAuth } from '@/contexts/AuthContext';
import { NotificationService } from '@/services/notificationService';
import { ShopService } from '@/services/shopService';
import { Shop, ShopTypeLabels } from '@/types';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function AdminShopDetailScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [shop, setShop] = useState<Shop | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  const rejectionModalRef = useRef<RejectionModalRef>(null);

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
      Alert.alert('Erreur', 'Impossible de charger les détails de la boutique');
    } finally {
      setIsLoading(false);
    }
  };

  const handleApprove = () => {
    if (!user || !shop) return;

    Alert.alert(
      'Approuver la boutique',
      `Confirmer l'approbation de "${shop.name}" ?`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Approuver',
          style: 'default',
          onPress: async () => {
            try {
              await ShopService.approveShop(shop.id, user.id);
              await NotificationService.notifyShopApproved(shop.id, shop.ownerId);
              Alert.alert('Succès', 'La boutique a été approuvée', [
                { text: 'OK', onPress: () => router.back() },
              ]);
            } catch (error) {
              console.error('Error approving shop:', error);
              Alert.alert('Erreur', 'Impossible d\'approuver la boutique');
            }
          },
        },
      ]
    );
  };

  const handleReject = () => {
    rejectionModalRef.current?.show();
  };

  const handleConfirmReject = async (reason: string) => {
    if (!user || !shop) return;

    try {
      await ShopService.rejectShop(shop.id, reason, user.id);
      await NotificationService.notifyShopRejected(shop.id, shop.ownerId, reason);
      Alert.alert('Succès', 'La boutique a été rejetée', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (error) {
      console.error('Error rejecting shop:', error);
      Alert.alert('Erreur', 'Impossible de rejeter la boutique');
    }
  };

  const renderOpeningHours = () => {
    if (!shop?.openingHours) return null;

    const days = [
      { key: 'monday', label: 'Lun' },
      { key: 'tuesday', label: 'Mar' },
      { key: 'wednesday', label: 'Mer' },
      { key: 'thursday', label: 'Jeu' },
      { key: 'friday', label: 'Ven' },
      { key: 'saturday', label: 'Sam' },
      { key: 'sunday', label: 'Dim' },
    ];

    return (
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Horaires</Text>
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
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="chevron-back" size={24} color="#1C1C1E" />
        </Pressable>
        <Text style={styles.headerTitle}>Validation boutique</Text>
        <View style={styles.placeholder} />
      </View>

      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        {/* Status Badge */}
        <View style={styles.statusContainer}>
          <View style={[styles.statusBadge, { backgroundColor: getStatusColor(shop.status) }]}>
            <Text style={styles.statusText}>{getStatusLabel(shop.status)}</Text>
          </View>
        </View>

        {/* Gallery */}
        {shop.images && shop.images.length > 0 && (
          <View style={styles.galleryContainer}>
            <Image source={{ uri: shop.images[selectedImageIndex] }} style={styles.mainImage} />
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
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

        {/* Info */}
        <View style={styles.infoContainer}>
          <Text style={styles.shopName}>{shop.name}</Text>
          <Text style={styles.shopType}>{ShopTypeLabels[shop.type]}</Text>
          <Text style={styles.description}>{shop.description}</Text>

          {/* Contact */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Contact</Text>
            <View style={styles.contactRow}>
              <Ionicons name="call-outline" size={18} color="#8E8E93" />
              <Text style={styles.contactText}>{shop.phoneNumber}</Text>
            </View>
            <View style={styles.contactRow}>
              <Ionicons name="mail-outline" size={18} color="#8E8E93" />
              <Text style={styles.contactText}>{shop.email}</Text>
            </View>
            {shop.website && (
              <View style={styles.contactRow}>
                <Ionicons name="globe-outline" size={18} color="#8E8E93" />
                <Text style={styles.contactText}>{shop.website}</Text>
              </View>
            )}
          </View>

          {/* Adresse */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Adresse</Text>
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

          {/* Horaires */}
          {renderOpeningHours()}

          {/* Réseaux sociaux */}
          {(shop.socialMedia?.instagram || shop.socialMedia?.facebook) && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Réseaux sociaux</Text>
              {shop.socialMedia.instagram && (
                <View style={styles.contactRow}>
                  <Ionicons name="logo-instagram" size={18} color="#E4405F" />
                  <Text style={styles.contactText}>@{shop.socialMedia.instagram}</Text>
                </View>
              )}
              {shop.socialMedia.facebook && (
                <View style={styles.contactRow}>
                  <Ionicons name="logo-facebook" size={18} color="#1877F2" />
                  <Text style={styles.contactText}>{shop.socialMedia.facebook}</Text>
                </View>
              )}
            </View>
          )}

          {/* Dates */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Informations système</Text>
            <Text style={styles.metaText}>
              Créée le {new Date(shop.createdAt).toLocaleDateString('fr-FR')}
            </Text>
            {shop.verificationDetails?.verifiedAt && (
              <Text style={styles.metaText}>
                Validée le {new Date(shop.verificationDetails.verifiedAt).toLocaleDateString('fr-FR')}
              </Text>
            )}
          </View>
        </View>
      </ScrollView>

      {/* Actions Footer (only for pending shops) */}
      {shop.status === 'pending' && (
        <View style={styles.footer}>
          <Pressable style={styles.rejectButton} onPress={handleReject} activeOpacity={0.7}>
            <Ionicons name="close-circle-outline" size={20} color="#FF3B30" />
            <Text style={styles.rejectButtonText}>Rejeter</Text>
          </Pressable>

          <Pressable style={styles.approveButton} onPress={handleApprove} activeOpacity={0.7}>
            <Ionicons name="checkmark-circle-outline" size={20} color="#FFFFFF" />
            <Text style={styles.approveButtonText}>Approuver</Text>
          </Pressable>
        </View>
      )}

      {/* Rejection Modal */}
      <RejectionModal
        ref={rejectionModalRef}
        shopName={shop.name}
        onConfirm={handleConfirmReject}
      />
    </SafeAreaView>
  );
}

const getStatusColor = (status: string) => {
  switch (status) {
    case 'approved':
      return '#34C759';
    case 'rejected':
      return '#FF3B30';
    case 'pending':
      return '#FF9500';
    case 'suspended':
      return '#8E8E93';
    default:
      return '#8E8E93';
  }
};

const getStatusLabel = (status: string) => {
  switch (status) {
    case 'approved':
      return 'Approuvée';
    case 'rejected':
      return 'Rejetée';
    case 'pending':
      return 'En attente de validation';
    case 'suspended':
      return 'Suspendue';
    default:
      return status;
  }
};

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
  statusContainer: {
    alignItems: 'center',
    paddingVertical: 16,
  },
  statusBadge: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 20,
  },
  statusText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  galleryContainer: {
    marginBottom: 20,
  },
  mainImage: {
    width: '100%',
    height: 300,
    backgroundColor: '#F2F2F7',
  },
  thumbnailsContainer: {
    paddingHorizontal: 16,
    paddingTop: 12,
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
  shopName: {
    fontSize: 24,
    fontWeight: '700',
    color: '#1C1C1E',
    marginBottom: 8,
  },
  shopType: {
    fontSize: 16,
    color: '#F79F24',
    fontWeight: '600',
    marginBottom: 16,
  },
  description: {
    fontSize: 16,
    color: '#1C1C1E',
    lineHeight: 24,
    marginBottom: 24,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1C1C1E',
    marginBottom: 12,
  },
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 8,
  },
  contactText: {
    fontSize: 15,
    color: '#1C1C1E',
  },
  addressText: {
    fontSize: 15,
    color: '#1C1C1E',
    lineHeight: 22,
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
  metaText: {
    fontSize: 14,
    color: '#8E8E93',
    marginBottom: 4,
  },
  footer: {
    flexDirection: 'row',
    gap: 12,
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: '#F2F2F7',
    backgroundColor: '#FFFFFF',
  },
  rejectButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#FFEBEE',
    paddingVertical: 16,
    borderRadius: 12,
  },
  rejectButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FF3B30',
  },
  approveButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#34C759',
    paddingVertical: 16,
    borderRadius: 12,
  },
  approveButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});

