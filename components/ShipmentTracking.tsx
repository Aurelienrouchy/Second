import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { httpsCallable } from '@react-native-firebase/functions';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { functions } from '@/config/firebaseConfig';
import { Transaction } from '@/types';

interface ShipmentTrackingProps {
  transaction: Transaction;
  onStatusUpdate?: () => void;
}

const ShipmentTracking: React.FC<ShipmentTrackingProps> = ({
  transaction,
  onStatusUpdate,
}) => {
  const [isRefreshing, setIsRefreshing] = useState(false);

  const getStatusInfo = (status: string) => {
    switch (status) {
      case 'TRANSIT':
      case 'IN_TRANSIT':
        return {
          icon: 'airplane' as const,
          color: '#F79F24',
          label: 'En transit',
          description: 'Votre colis est en cours d\'acheminement',
        };
      case 'OUT_FOR_DELIVERY':
        return {
          icon: 'car' as const,
          color: '#FF9500',
          label: 'En cours de livraison',
          description: 'Votre colis est en cours de livraison aujourd\'hui',
        };
      case 'DELIVERED':
        return {
          icon: 'checkmark-circle' as const,
          color: '#34C759',
          label: 'Livré',
          description: 'Votre colis a été livré avec succès',
        };
      case 'FAILURE':
      case 'RETURNED':
        return {
          icon: 'alert-circle' as const,
          color: '#FF3B30',
          label: 'Problème de livraison',
          description: 'Un problème est survenu avec la livraison',
        };
      default:
        return {
          icon: 'cube' as const,
          color: '#8E8E93',
          label: 'En préparation',
          description: 'Le vendeur prépare votre colis',
        };
    }
  };

  const handleRefresh = async () => {
    try {
      setIsRefreshing(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      const checkTracking = httpsCallable(functions, 'checkTrackingStatus');
      const result = await checkTracking({ transactionId: transaction.id });

      const data = result.data as any;
      if (data.success) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        if (onStatusUpdate) {
          onStatusUpdate();
        }
      }
    } catch (error: any) {
      console.error('Error refreshing tracking:', error);
      Alert.alert('Erreur', 'Impossible de mettre à jour le suivi');
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleOpenTracking = () => {
    if (transaction.trackingUrl) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      Linking.openURL(transaction.trackingUrl);
    }
  };

  const handleDownloadLabel = () => {
    if (transaction.shippingLabelUrl) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      Linking.openURL(transaction.shippingLabelUrl);
    }
  };

  const statusInfo = getStatusInfo(transaction.trackingStatus || '');
  const isDelivered = transaction.status === 'delivered';

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Ionicons name="cube-outline" size={24} color="#1C1C1E" />
          <Text style={styles.headerTitle}>Suivi de livraison</Text>
        </View>
        <Pressable
          onPress={handleRefresh}
          disabled={isRefreshing || isDelivered}
          style={styles.refreshButton}
        >
          {isRefreshing ? (
            <ActivityIndicator size="small" color="#F79F24" />
          ) : (
            <Ionicons
              name="refresh"
              size={20}
              color={isDelivered ? '#8E8E93' : '#F79F24'}
            />
          )}
        </Pressable>
      </View>

      {/* Status Card */}
      <View style={[styles.statusCard, { borderLeftColor: statusInfo.color }]}>
        <View style={styles.statusIconContainer}>
          <View style={[styles.statusIconBg, { backgroundColor: statusInfo.color + '20' }]}>
            <Ionicons name={statusInfo.icon} size={28} color={statusInfo.color} />
          </View>
        </View>

        <View style={styles.statusContent}>
          <Text style={[styles.statusLabel, { color: statusInfo.color }]}>
            {statusInfo.label}
          </Text>
          <Text style={styles.statusDescription}>{statusInfo.description}</Text>

          {transaction.trackingNumber && (
            <View style={styles.trackingNumberContainer}>
              <Text style={styles.trackingNumberLabel}>Numéro de suivi:</Text>
              <Text style={styles.trackingNumber}>{transaction.trackingNumber}</Text>
            </View>
          )}
        </View>
      </View>

      {/* Timeline */}
      <View style={styles.timeline}>
        <View style={styles.timelineItem}>
          <View style={[styles.timelineDot, styles.timelineDotCompleted]} />
          <View style={styles.timelineContent}>
            <Text style={styles.timelineTitle}>Paiement confirmé</Text>
            <Text style={styles.timelineDate}>
              {transaction.paidAt?.toLocaleDateString('fr-FR')}
            </Text>
          </View>
        </View>

        {transaction.shippedAt && (
          <View style={styles.timelineItem}>
            <View style={[styles.timelineDot, styles.timelineDotCompleted]} />
            <View style={styles.timelineContent}>
              <Text style={styles.timelineTitle}>Colis expédié</Text>
              <Text style={styles.timelineDate}>
                {transaction.shippedAt.toLocaleDateString('fr-FR')}
              </Text>
            </View>
          </View>
        )}

        <View style={styles.timelineItem}>
          <View
            style={[
              styles.timelineDot,
              transaction.trackingStatus === 'IN_TRANSIT' ||
              transaction.trackingStatus === 'TRANSIT'
                ? styles.timelineDotActive
                : transaction.deliveredAt
                ? styles.timelineDotCompleted
                : styles.timelineDotPending,
            ]}
          />
          <View style={styles.timelineContent}>
            <Text style={styles.timelineTitle}>En transit</Text>
            {transaction.trackingStatus === 'IN_TRANSIT' && (
              <Text style={styles.timelineActive}>En cours</Text>
            )}
          </View>
        </View>

        <View style={styles.timelineItem}>
          <View
            style={[
              styles.timelineDot,
              transaction.deliveredAt
                ? styles.timelineDotCompleted
                : transaction.trackingStatus === 'OUT_FOR_DELIVERY'
                ? styles.timelineDotActive
                : styles.timelineDotPending,
            ]}
          />
          <View style={styles.timelineContent}>
            <Text style={styles.timelineTitle}>Livré</Text>
            {transaction.deliveredAt && (
              <Text style={styles.timelineDate}>
                {transaction.deliveredAt.toLocaleDateString('fr-FR')}
              </Text>
            )}
          </View>
        </View>
      </View>

      {/* Action Buttons */}
      <View style={styles.actions}>
        {transaction.trackingUrl && (
          <Pressable style={styles.actionButton} onPress={handleOpenTracking}>
            <Ionicons name="open-outline" size={18} color="#F79F24" />
            <Text style={styles.actionButtonText}>Suivre en ligne</Text>
          </Pressable>
        )}

        {transaction.shippingLabelUrl && (
          <Pressable style={styles.actionButton} onPress={handleDownloadLabel}>
            <Ionicons name="download-outline" size={18} color="#F79F24" />
            <Text style={styles.actionButtonText}>Télécharger l'étiquette</Text>
          </Pressable>
        )}
      </View>

      {isDelivered && (
        <View style={styles.deliveryNote}>
          <Ionicons name="checkmark-circle" size={20} color="#34C759" />
          <Text style={styles.deliveryNoteText}>
            Transaction terminée. Les fonds ont été transférés au vendeur.
          </Text>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#F2F2F7',
    borderRadius: 16,
    padding: 16,
    marginVertical: 12,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1C1C1E',
  },
  refreshButton: {
    padding: 4,
  },
  statusCard: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
    borderLeftWidth: 4,
  },
  statusIconContainer: {
    marginRight: 12,
  },
  statusIconBg: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
  },
  statusContent: {
    flex: 1,
  },
  statusLabel: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 4,
  },
  statusDescription: {
    fontSize: 14,
    color: '#666',
    marginBottom: 12,
  },
  trackingNumberContainer: {
    backgroundColor: '#F2F2F7',
    borderRadius: 8,
    padding: 10,
  },
  trackingNumberLabel: {
    fontSize: 12,
    color: '#8E8E93',
    marginBottom: 4,
  },
  trackingNumber: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1C1C1E',
    fontFamily: 'monospace',
  },
  timeline: {
    marginBottom: 16,
  },
  timelineItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  timelineDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginTop: 4,
    marginRight: 12,
  },
  timelineDotCompleted: {
    backgroundColor: '#34C759',
  },
  timelineDotActive: {
    backgroundColor: '#F79F24',
  },
  timelineDotPending: {
    backgroundColor: '#E5E5EA',
  },
  timelineContent: {
    flex: 1,
  },
  timelineTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1C1C1E',
    marginBottom: 2,
  },
  timelineDate: {
    fontSize: 12,
    color: '#8E8E93',
  },
  timelineActive: {
    fontSize: 12,
    color: '#F79F24',
    fontWeight: '600',
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    paddingVertical: 12,
    gap: 6,
    borderWidth: 1,
    borderColor: '#F79F24',
  },
  actionButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#F79F24',
  },
  deliveryNote: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F0FFF4',
    borderRadius: 10,
    padding: 12,
    gap: 8,
  },
  deliveryNoteText: {
    flex: 1,
    fontSize: 13,
    color: '#34C759',
    fontWeight: '500',
  },
});

export default ShipmentTracking;

