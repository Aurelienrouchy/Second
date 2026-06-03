import { Shop, ShopTypeLabels } from '@/types';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { APP_LOCALE } from '@/constants/locale';
import { colors } from '@/constants/theme';

interface ShopValidationCardProps {
  shop: Shop;
  onApprove: () => void;
  onReject: () => void;
  onViewDetails: () => void;
  disabled?: boolean;
}

export default function ShopValidationCard({
  shop,
  onApprove,
  onReject,
  onViewDetails,
  disabled = false,
}: ShopValidationCardProps) {
  const getStatusColor = () => {
    switch (shop.status) {
      case 'approved':
        return '#34C759';
      case 'rejected':
        return '#FF3B30';
      case 'pending':
        return '#FF9500';
      case 'suspended':
        return colors.muted;
      default:
        return colors.muted;
    }
  };

  const getStatusLabel = () => {
    switch (shop.status) {
      case 'approved':
        return 'Approuvée';
      case 'rejected':
        return 'Rejetée';
      case 'pending':
        return 'En attente';
      case 'suspended':
        return 'Suspendue';
      default:
        return shop.status;
    }
  };

  return (
    <TouchableOpacity style={styles.card} onPress={onViewDetails} activeOpacity={0.7}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.imageContainer}>
          {shop.images && shop.images.length > 0 ? (
            <Image
              source={{ uri: shop.images[0] }}
              style={styles.image}
              recyclingKey={shop.id}
              cachePolicy="memory-disk"
            />
          ) : (
            <View style={styles.imagePlaceholder}>
              <Ionicons name="storefront-outline" size={32} color={colors.muted} />
            </View>
          )}
        </View>

        <View style={styles.info}>
          <Text style={styles.name} numberOfLines={1}>
            {shop.name}
          </Text>
          <Text style={styles.type}>{ShopTypeLabels[shop.type]}</Text>
          <View style={styles.locationRow}>
            <Ionicons name="location-outline" size={14} color={colors.muted} />
            <Text style={styles.location} numberOfLines={1}>
              {shop.address.city}
            </Text>
          </View>
        </View>

        <View style={[styles.statusBadge, { backgroundColor: `${getStatusColor()}20` }]}>
          <Text style={[styles.statusText, { color: getStatusColor() }]}>
            {getStatusLabel()}
          </Text>
        </View>
      </View>

      {/* Info rapide */}
      <View style={styles.quickInfo}>
        <View style={styles.infoItem}>
          <Ionicons name="call-outline" size={16} color={colors.muted} />
          <Text style={styles.infoText}>{shop.phoneNumber}</Text>
        </View>
        <View style={styles.infoItem}>
          <Ionicons name="mail-outline" size={16} color={colors.muted} />
          <Text style={styles.infoText} numberOfLines={1}>
            {shop.email}
          </Text>
        </View>
      </View>

      {/* Date de création */}
      <Text style={styles.date}>
        Créée le {new Date(shop.createdAt).toLocaleDateString(APP_LOCALE)}
      </Text>

      {/* Actions pour les boutiques en attente */}
      {shop.status === 'pending' && (
        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.actionButton, styles.rejectButton]}
            onPress={(e) => {
              e.stopPropagation();
              onReject();
            }}
            activeOpacity={0.7}
          >
            <Ionicons name="close-circle-outline" size={20} color="#FF3B30" />
            <Text style={styles.rejectButtonText}>Rejeter</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionButton, styles.approveButton]}
            onPress={(e) => {
              e.stopPropagation();
              onApprove();
            }}
            activeOpacity={0.7}
          >
            <Ionicons name="checkmark-circle-outline" size={20} color="#FFFFFF" />
            <Text style={styles.approveButtonText}>Approuver</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Raison du rejet si rejetée */}
      {shop.status === 'rejected' && shop.verificationDetails?.reason && (
        <View style={styles.rejectionReason}>
          <Ionicons name="information-circle-outline" size={16} color="#FF3B30" />
          <Text style={styles.rejectionReasonText}>{shop.verificationDetails.reason}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.surfaceWarm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
    gap: 12,
  },
  imageContainer: {
    width: 80,
    height: 80,
    borderRadius: 12,
    overflow: 'hidden',
  },
  image: {
    width: '100%',
    height: '100%',
    backgroundColor: colors.surfaceWarm,
  },
  imagePlaceholder: {
    width: '100%',
    height: '100%',
    backgroundColor: colors.surfaceWarm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  info: {
    flex: 1,
  },
  name: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.foreground,
    marginBottom: 4,
  },
  type: {
    fontSize: 14,
    color: colors.primary,
    fontWeight: '500',
    marginBottom: 6,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  location: {
    fontSize: 14,
    color: colors.muted,
    flex: 1,
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    alignSelf: 'flex-start',
  },
  statusText: {
    fontSize: 12,
    fontWeight: '700',
  },
  quickInfo: {
    gap: 8,
    marginBottom: 12,
  },
  infoItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  infoText: {
    fontSize: 14,
    color: colors.foreground,
    flex: 1,
  },
  date: {
    fontSize: 12,
    color: colors.muted,
    marginBottom: 12,
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 12,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 12,
  },
  rejectButton: {
    backgroundColor: '#FFEBEE',
  },
  rejectButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FF3B30',
  },
  approveButton: {
    backgroundColor: '#34C759',
  },
  approveButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  rejectionReason: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: '#FFEBEE',
    padding: 12,
    borderRadius: 12,
    marginTop: 12,
  },
  rejectionReasonText: {
    flex: 1,
    fontSize: 13,
    color: '#FF3B30',
    lineHeight: 18,
  },
});

