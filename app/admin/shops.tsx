/**
 * Admin Panel - Shops Management
 * Liste et gestion des boutiques (validation, rejet, suspension)
 */

import RejectionModal, { RejectionModalRef } from '@/components/admin/RejectionModal';
import ShopValidationCard from '@/components/admin/ShopValidationCard';
import { Skeleton, SkeletonText } from '@/components/ui/Skeleton';
import { useUser } from '@/contexts/AuthContext';
import { NotificationService } from '@/services/notificationService';
import { ShopService } from '@/services/shopService';
import { UserService } from '@/services/userService';
import { Shop } from '@/types';
import { Ionicons } from '@expo/vector-icons';
import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, radius } from '@/constants/theme';

type TabType = 'pending' | 'approved' | 'rejected' | 'suspended' | 'all';

export default function AdminShopsScreen() {
  const router = useRouter();
  const user = useUser();
  const [selectedTab, setSelectedTab] = useState<TabType>('pending');
  const [shops, setShops] = useState<Shop[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [selectedShop, setSelectedShop] = useState<Shop | null>(null);
  const [modalMode, setModalMode] = useState<'reject' | 'suspend'>('reject');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const rejectionModalRef = useRef<RejectionModalRef>(null);

  useEffect(() => {
    checkAdminAccess();
  }, [user]);

  useEffect(() => {
    if (isAdmin) {
      loadShops();
    }
  }, [selectedTab, isAdmin]);

  const checkAdminAccess = async () => {
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

    setIsAdmin(true);
  };

  const loadShops = async () => {
    try {
      setIsLoading(true);
      let fetchedShops: Shop[] = [];

      switch (selectedTab) {
        case 'pending':
          fetchedShops = await ShopService.getPendingShops();
          break;
        case 'approved':
          fetchedShops = await ShopService.getApprovedShops();
          break;
        case 'rejected':
          fetchedShops = await ShopService.getRejectedShops();
          break;
        case 'suspended':
          fetchedShops = await ShopService.getSuspendedShops();
          break;
        case 'all':
          // Get all shops
          const [pending, approved, rejected, suspended] = await Promise.all([
            ShopService.getPendingShops(),
            ShopService.getApprovedShops(),
            ShopService.getRejectedShops(),
            ShopService.getSuspendedShops(),
          ]);
          fetchedShops = [...pending, ...approved, ...rejected, ...suspended];
          break;
      }

      setShops(fetchedShops);
    } catch (error) {
      if (__DEV__) console.error('Error loading shops:', error);
      Alert.alert('Erreur', 'Impossible de charger les boutiques');
    } finally {
      setIsLoading(false);
    }
  };

  const handleApprove = async (shop: Shop) => {
    if (!user) return;

    Alert.alert(
      'Approuver la boutique',
      `Êtes-vous sûr de vouloir approuver "${shop.name}" ?`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Approuver',
          style: 'default',
          onPress: async () => {
            try {
              await ShopService.approveShop(shop.id);
              await NotificationService.notifyShopApproved(shop.id, shop.ownerId);
              Alert.alert('Succès', 'La boutique a été approuvée');
              loadShops();
            } catch (error) {
              if (__DEV__) console.error('Error approving shop:', error);
              Alert.alert('Erreur', 'Impossible d\'approuver la boutique');
            }
          },
        },
      ]
    );
  };

  const handleReject = (shop: Shop) => {
    setSelectedShop(shop);
    setModalMode('reject');
    rejectionModalRef.current?.show();
  };

  const handleSuspend = (shop: Shop) => {
    setSelectedShop(shop);
    setModalMode('suspend');
    rejectionModalRef.current?.show();
  };

  const handleConfirmModal = async (reason: string) => {
    if (!user || !selectedShop) return;

    if (modalMode === 'suspend') {
      try {
        // La callable `suspendShop` notifie le propriétaire côté serveur
        // (notifyShopOwner — Admin SDK), pas de notification client ici.
        await ShopService.suspendShop(selectedShop.id, reason);
        Alert.alert('Succès', 'La boutique a été suspendue');
        loadShops();
      } catch (error) {
        if (__DEV__) console.error('Error suspending shop:', error);
        Alert.alert('Erreur', 'Impossible de suspendre la boutique');
        throw error;
      }
      return;
    }

    try {
      await ShopService.rejectShop(selectedShop.id, reason);
      await NotificationService.notifyShopRejected(selectedShop.id, selectedShop.ownerId, reason);
      Alert.alert('Succès', 'La boutique a été rejetée');
      loadShops();
    } catch (error) {
      if (__DEV__) console.error('Error rejecting shop:', error);
      Alert.alert('Erreur', 'Impossible de rejeter la boutique');
      throw error;
    }
  };

  const handleViewDetails = (shop: Shop) => {
    router.push(`/admin/shop-detail/${shop.id}`);
  };

  const getStatsCount = (status: TabType) => {
    if (status === 'all') return shops.length;
    return shops.filter((s) => s.status === status).length;
  };

  const renderShopItem = ({ item }: { item: Shop }) => (
    <View>
      <ShopValidationCard
        shop={item}
        onApprove={() => handleApprove(item)}
        onReject={() => handleReject(item)}
        onViewDetails={() => handleViewDetails(item)}
      />
      {item.status === 'approved' && (
        <Pressable
          style={styles.suspendButton}
          onPress={() => handleSuspend(item)}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        >
          <Ionicons name="pause-circle-outline" size={18} color={colors.warning} />
          <Text style={styles.suspendButtonText}>Suspendre</Text>
        </Pressable>
      )}
    </View>
  );

  const renderEmpty = () => (
    <View style={styles.emptyContainer}>
      <Ionicons name="storefront-outline" size={64} color={colors.muted} />
      <Text style={styles.emptyTitle}>Aucune boutique</Text>
      <Text style={styles.emptyText}>
        {selectedTab === 'pending'
          ? 'Aucune boutique en attente de validation'
          : 'Aucune boutique dans cette catégorie'}
      </Text>
    </View>
  );

  if (!isAdmin) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.skeletonContainer}>
          {Array.from({ length: 3 }).map((_, i) => (
            <ShopCardSkeleton key={i} />
          ))}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerContent}>
          <Pressable onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="chevron-back" size={24} color={colors.foreground} />
          </Pressable>
          <View style={styles.headerTextContainer}>
            <Text style={styles.headerTitle}>Panel Admin</Text>
            <Text style={styles.headerSubtitle}>Gestion des boutiques</Text>
          </View>
        </View>
        <Pressable onPress={loadShops} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="refresh" size={24} color={colors.primary} />
        </Pressable>
      </View>

      {/* Tabs */}
      <View style={styles.tabs}>
        <Pressable
          style={[styles.tab, selectedTab === 'pending' && styles.tabActive]}
          onPress={() => setSelectedTab('pending')}
        >
          <Text style={[styles.tabText, selectedTab === 'pending' && styles.tabTextActive]}>
            En attente
          </Text>
          {getStatsCount('pending') > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{getStatsCount('pending')}</Text>
            </View>
          )}
        </Pressable>

        <Pressable
          style={[styles.tab, selectedTab === 'approved' && styles.tabActive]}
          onPress={() => setSelectedTab('approved')}
        >
          <Text style={[styles.tabText, selectedTab === 'approved' && styles.tabTextActive]}>
            Approuvées
          </Text>
        </Pressable>

        <Pressable
          style={[styles.tab, selectedTab === 'rejected' && styles.tabActive]}
          onPress={() => setSelectedTab('rejected')}
        >
          <Text style={[styles.tabText, selectedTab === 'rejected' && styles.tabTextActive]}>
            Rejetées
          </Text>
        </Pressable>

        <Pressable
          style={[styles.tab, selectedTab === 'suspended' && styles.tabActive]}
          onPress={() => setSelectedTab('suspended')}
        >
          <Text style={[styles.tabText, selectedTab === 'suspended' && styles.tabTextActive]}>
            Suspendues
          </Text>
        </Pressable>

        <Pressable
          style={[styles.tab, selectedTab === 'all' && styles.tabActive]}
          onPress={() => setSelectedTab('all')}
        >
          <Text style={[styles.tabText, selectedTab === 'all' && styles.tabTextActive]}>
            Toutes
          </Text>
        </Pressable>
      </View>

      {/* Liste des boutiques */}
      {isLoading ? (
        <View style={styles.skeletonContainer}>
          {Array.from({ length: 4 }).map((_, i) => (
            <ShopCardSkeleton key={i} />
          ))}
        </View>
      ) : (
        <FlashList
          data={shops}
          renderItem={renderShopItem}
          keyExtractor={(item) => item.id}
          ListEmptyComponent={renderEmpty}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* Modal de rejet / suspension */}
      <RejectionModal
        ref={rejectionModalRef}
        shopName={selectedShop?.name || ''}
        onConfirm={handleConfirmModal}
      />
    </SafeAreaView>
  );
}

// =============================================================================
// SKELETON
// =============================================================================

const ShopCardSkeleton = React.memo(function ShopCardSkeleton() {
  return (
    <View style={styles.skeletonCard}>
      <View style={styles.skeletonCardHeader}>
        <Skeleton width={80} height={80} borderRadius={radius.lg} />
        <View style={styles.skeletonCardInfo}>
          <Skeleton width={140} height={18} borderRadius={radius.sm} />
          <Skeleton width={90} height={14} borderRadius={radius.sm} style={{ marginTop: 6 }} />
          <Skeleton width={110} height={14} borderRadius={radius.sm} style={{ marginTop: 6 }} />
        </View>
        <Skeleton width={72} height={28} borderRadius={radius.lg} />
      </View>
      <SkeletonText lines={2} style={{ marginTop: 12 }} />
    </View>
  );
});

// =============================================================================
// STYLES
// =============================================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9F9F9',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 16,
    backgroundColor: colors.white,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceWarm,
  },
  headerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  headerTextContainer: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.foreground,
  },
  headerSubtitle: {
    fontSize: 14,
    color: colors.muted,
  },
  tabs: {
    flexDirection: 'row',
    backgroundColor: colors.white,
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceWarm,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: colors.surfaceWarm,
  },
  tabActive: {
    backgroundColor: colors.primary,
  },
  tabText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.muted,
  },
  tabTextActive: {
    color: colors.white,
  },
  badge: {
    backgroundColor: '#FF3B30',
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
    minWidth: 20,
    alignItems: 'center',
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.white,
  },
  listContent: {
    padding: 16,
  },
  suspendButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    marginTop: -4,
    marginBottom: 12,
    borderRadius: 12,
    backgroundColor: colors.warningLight,
  },
  suspendButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.warning,
  },
  skeletonContainer: {
    flex: 1,
    padding: 16,
  },
  skeletonCard: {
    backgroundColor: colors.white,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.surfaceWarm,
  },
  skeletonCardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  skeletonCardInfo: {
    flex: 1,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 80,
    gap: 16,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.foreground,
  },
  emptyText: {
    fontSize: 16,
    color: colors.muted,
    textAlign: 'center',
    paddingHorizontal: 40,
  },
});

