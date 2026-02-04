/**
 * Admin Panel - Shops Management
 * Liste et gestion des boutiques (validation, rejet, suspension)
 */

import RejectionModal, { RejectionModalRef } from '@/components/admin/RejectionModal';
import ShopValidationCard from '@/components/admin/ShopValidationCard';
import { useAuth } from '@/contexts/AuthContext';
import { NotificationService } from '@/services/notificationService';
import { ShopService } from '@/services/shopService';
import { UserService } from '@/services/userService';
import { Shop } from '@/types';
import { Ionicons } from '@expo/vector-icons';
import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

type TabType = 'pending' | 'approved' | 'rejected' | 'all';

export default function AdminShopsScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [selectedTab, setSelectedTab] = useState<TabType>('pending');
  const [shops, setShops] = useState<Shop[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [selectedShop, setSelectedShop] = useState<Shop | null>(null);
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
        case 'all':
          // Get all shops
          const pending = await ShopService.getPendingShops();
          const approved = await ShopService.getApprovedShops();
          const rejected = await ShopService.getRejectedShops();
          fetchedShops = [...pending, ...approved, ...rejected];
          break;
      }

      setShops(fetchedShops);
    } catch (error) {
      console.error('Error loading shops:', error);
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
              await ShopService.approveShop(shop.id, user.id);
              await NotificationService.notifyShopApproved(shop.id, shop.ownerId);
              Alert.alert('Succès', 'La boutique a été approuvée');
              loadShops();
            } catch (error) {
              console.error('Error approving shop:', error);
              Alert.alert('Erreur', 'Impossible d\'approuver la boutique');
            }
          },
        },
      ]
    );
  };

  const handleReject = (shop: Shop) => {
    setSelectedShop(shop);
    rejectionModalRef.current?.show();
  };

  const handleConfirmReject = async (reason: string) => {
    if (!user || !selectedShop) return;

    try {
      await ShopService.rejectShop(selectedShop.id, reason, user.id);
      await NotificationService.notifyShopRejected(selectedShop.id, selectedShop.ownerId, reason);
      Alert.alert('Succès', 'La boutique a été rejetée');
      loadShops();
    } catch (error) {
      console.error('Error rejecting shop:', error);
      Alert.alert('Erreur', 'Impossible de rejeter la boutique');
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
    <ShopValidationCard
      shop={item}
      onApprove={() => handleApprove(item)}
      onReject={() => handleReject(item)}
      onViewDetails={() => handleViewDetails(item)}
    />
  );

  const renderEmpty = () => (
    <View style={styles.emptyContainer}>
      <Ionicons name="storefront-outline" size={64} color="#8E8E93" />
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
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#F79F24" />
          <Text style={styles.loadingText}>Vérification des accès...</Text>
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
            <Ionicons name="chevron-back" size={24} color="#1C1C1E" />
          </Pressable>
          <View style={styles.headerTextContainer}>
            <Text style={styles.headerTitle}>Panel Admin</Text>
            <Text style={styles.headerSubtitle}>Gestion des boutiques</Text>
          </View>
        </View>
        <Pressable onPress={loadShops} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="refresh" size={24} color="#F79F24" />
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
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#F79F24" />
          <Text style={styles.loadingText}>Chargement...</Text>
        </View>
      ) : (
        <FlashList
          data={shops}
          renderItem={renderShopItem}
          keyExtractor={(item) => item.id}
          estimatedItemSize={200}
          ListEmptyComponent={renderEmpty}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* Modal de rejet */}
      <RejectionModal
        ref={rejectionModalRef}
        shopName={selectedShop?.name || ''}
        onConfirm={handleConfirmReject}
      />
    </SafeAreaView>
  );
}

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
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#F2F2F7',
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
    color: '#1C1C1E',
  },
  headerSubtitle: {
    fontSize: 14,
    color: '#8E8E93',
  },
  tabs: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F2F2F7',
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#F2F2F7',
  },
  tabActive: {
    backgroundColor: '#F79F24',
  },
  tabText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#8E8E93',
  },
  tabTextActive: {
    color: '#FFFFFF',
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
    color: '#FFFFFF',
  },
  listContent: {
    padding: 16,
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
    color: '#1C1C1E',
  },
  emptyText: {
    fontSize: 16,
    color: '#8E8E93',
    textAlign: 'center',
    paddingHorizontal: 40,
  },
});

