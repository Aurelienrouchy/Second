/**
 * Admin - Shop Detail Validation Page
 * Vue détaillée d'une boutique pour validation/rejet/suspension
 */

import RejectionModal, { RejectionModalRef } from '@/components/admin/RejectionModal';
import { Skeleton, SkeletonText } from '@/components/ui/Skeleton';
import { useUser } from '@/contexts/AuthContext';
import { NotificationService } from '@/services/notificationService';
import { ShopService } from '@/services/shopService';
import { UserService } from '@/services/userService';
import { Shop, ShopTypeLabels } from '@/types';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import MapView, { Marker, PROVIDER_DEFAULT } from 'react-native-maps';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { APP_LOCALE } from '@/constants/locale';
import { colors, radius } from '@/constants/theme';

export default function AdminShopDetailScreen() {
  const router = useRouter();
  const user = useUser();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [shop, setShop] = useState<Shop | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  const rejectionModalRef = useRef<RejectionModalRef>(null);

  useEffect(() => {
    if (id) {
      loadShopDetails();
    }
  }, [id, user]);

  const loadShopDetails = async () => {
    try {
      setIsLoading(true);

      // Défense en profondeur : on vérifie le statut admin avant d'exposer les
      // détails de modération (la vraie barrière reste les rules + callables).
      if (!user) {
        router.replace('/(tabs)');
        return;
      }
      const adminStatus = await UserService.isUserAdmin(user.id);
      if (!adminStatus) {
        Alert.alert('Accès refusé', 'Vous n\'avez pas les droits d\'administrateur', [
          { text: 'OK', onPress: () => router.replace('/(tabs)') },
        ]);
        return;
      }

      const shopData = await ShopService.getShopById(id!);
      setShop(shopData);
    } catch (error) {
      if (__DEV__) console.error('Error loading shop details:', error);
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
            if (isSubmitting) return;
            try {
              setIsSubmitting(true);
              await ShopService.approveShop(shop.id);
              await NotificationService.notifyShopApproved(shop.id, shop.ownerId);
              Alert.alert('Succès', 'La boutique a été approuvée', [
                { text: 'OK', onPress: () => router.back() },
              ]);
            } catch (error) {
              if (__DEV__) console.error('Error approving shop:', error);
              Alert.alert('Erreur', 'Impossible d\'approuver la boutique');
            } finally {
              setIsSubmitting(false);
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
    if (!user || !shop || isSubmitting) return;

    try {
      setIsSubmitting(true);
      await ShopService.rejectShop(shop.id, reason);
      await NotificationService.notifyShopRejected(shop.id, shop.ownerId, reason);
      Alert.alert('Succès', 'La boutique a été rejetée', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (error) {
      if (__DEV__) console.error('Error rejecting shop:', error);
      Alert.alert('Erreur', 'Impossible de rejeter la boutique');
    } finally {
      setIsSubmitting(false);
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
      <SafeAreaView testID="admin-shop-detail-screen" style={styles.container} edges={['top']}>
        {/* Header */}
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="chevron-back" size={24} color={colors.foreground} />
          </Pressable>
          <Text style={styles.headerTitle}>Validation boutique</Text>
          <View style={styles.placeholder} />
        </View>
        <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
          {/* Status badge skeleton */}
          <View style={styles.statusContainer}>
            <Skeleton width={160} height={34} borderRadius={20} />
          </View>
          {/* Main image skeleton */}
          <Skeleton width="100%" height={300} borderRadius={0} />
          {/* Thumbnail strip skeleton */}
          <View style={styles.skeletonThumbnails}>
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} width={80} height={80} borderRadius={radius.md} />
            ))}
          </View>
          {/* Info skeleton */}
          <View style={styles.skeletonInfo}>
            <Skeleton width={200} height={24} borderRadius={radius.sm} />
            <Skeleton width={120} height={16} borderRadius={radius.sm} style={{ marginTop: 8 }} />
            <SkeletonText lines={3} style={{ marginTop: 16 }} />
            {/* Contact section skeleton */}
            <Skeleton width={100} height={18} borderRadius={radius.sm} style={{ marginTop: 24 }} />
            <Skeleton width="80%" height={14} borderRadius={radius.sm} style={{ marginTop: 12 }} />
            <Skeleton width="70%" height={14} borderRadius={radius.sm} style={{ marginTop: 8 }} />
            {/* Address section skeleton */}
            <Skeleton width={100} height={18} borderRadius={radius.sm} style={{ marginTop: 24 }} />
            <SkeletonText lines={3} style={{ marginTop: 12 }} />
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (!shop) {
    return (
      <SafeAreaView testID="admin-shop-detail-screen" style={styles.container} edges={['top']}>
        <View style={styles.errorContainer}>
          <Ionicons name="alert-circle-outline" size={64} color={colors.danger} />
          <Text style={styles.errorText}>Boutique introuvable</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView testID="admin-shop-detail-screen" style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="chevron-back" size={24} color={colors.foreground} />
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
              <Ionicons name="call-outline" size={18} color={colors.muted} />
              <Text style={styles.contactText}>{shop.phoneNumber}</Text>
            </View>
            <View style={styles.contactRow}>
              <Ionicons name="mail-outline" size={18} color={colors.muted} />
              <Text style={styles.contactText}>{shop.email}</Text>
            </View>
            {shop.website && (
              <View style={styles.contactRow}>
                <Ionicons name="globe-outline" size={18} color={colors.muted} />
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
              {getCountryLabel(shop.address.country)}
            </Text>
          </View>

          {/* Map */}
          {shop.location && (
            <View style={styles.mapContainer}>
              <MapView
                style={styles.map}
                provider={PROVIDER_DEFAULT}
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
              Créée le {new Date(shop.createdAt).toLocaleDateString(APP_LOCALE)}
            </Text>
            {shop.verificationDetails?.verifiedAt && (
              <Text style={styles.metaText}>
                Validée le {new Date(shop.verificationDetails.verifiedAt).toLocaleDateString(APP_LOCALE)}
              </Text>
            )}
          </View>
        </View>
      </ScrollView>

      {/* Actions Footer (only for pending shops) */}
      {shop.status === 'pending' && (
        <View style={[styles.footer, { paddingBottom: Math.max(20, insets.bottom) }]}>
          <Pressable
            style={[styles.rejectButton, isSubmitting && styles.buttonDisabled]}
            onPress={handleReject}
            disabled={isSubmitting}
          >
            <Ionicons name="close-circle-outline" size={20} color={colors.danger} />
            <Text style={styles.rejectButtonText}>Rejeter</Text>
          </Pressable>

          <Pressable
            style={[styles.approveButton, isSubmitting && styles.buttonDisabled]}
            onPress={handleApprove}
            disabled={isSubmitting}
          >
            <Ionicons name="checkmark-circle-outline" size={20} color={colors.white} />
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

// Le pays est stocké sous forme de code ISO ('CA') à la création de la boutique.
// On l'affiche normalisé ; fallback sur la valeur brute pour les données historiques.
const COUNTRY_LABELS: Record<string, string> = { CA: 'Canada' };
const getCountryLabel = (country: string) => COUNTRY_LABELS[country] ?? country;

const getStatusColor = (status: string) => {
  switch (status) {
    case 'approved':
      return colors.success;
    case 'rejected':
      return colors.danger;
    case 'pending':
      return colors.warning;
    case 'suspended':
      return colors.muted;
    default:
      return colors.muted;
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
  skeletonThumbnails: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  skeletonInfo: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 40,
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
    color: colors.danger,
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
    color: colors.white,
  },
  galleryContainer: {
    marginBottom: 20,
  },
  mainImage: {
    width: '100%',
    height: 300,
    backgroundColor: colors.surfaceWarm,
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
  shopName: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.foreground,
    marginBottom: 8,
  },
  shopType: {
    fontSize: 16,
    color: colors.primary,
    fontWeight: '600',
    marginBottom: 16,
  },
  description: {
    fontSize: 16,
    color: colors.foreground,
    lineHeight: 24,
    marginBottom: 24,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.foreground,
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
    color: colors.foreground,
  },
  addressText: {
    fontSize: 15,
    color: colors.foreground,
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
    borderBottomColor: colors.surfaceWarm,
  },
  dayLabel: {
    fontSize: 15,
    fontWeight: '500',
    color: colors.foreground,
  },
  hoursText: {
    fontSize: 15,
    color: colors.success,
    fontWeight: '600',
  },
  closedText: {
    color: colors.muted,
  },
  metaText: {
    fontSize: 14,
    color: colors.muted,
    marginBottom: 4,
  },
  footer: {
    flexDirection: 'row',
    gap: 12,
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: colors.surfaceWarm,
    backgroundColor: colors.white,
  },
  rejectButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.dangerLight,
    paddingVertical: 16,
    borderRadius: 12,
  },
  rejectButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.danger,
  },
  approveButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.success,
    paddingVertical: 16,
    borderRadius: 12,
  },
  approveButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.white,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
});

