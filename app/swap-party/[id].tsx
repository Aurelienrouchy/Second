/**
 * Swap Party Detail Screen
 * Design System: Luxe Français + Street Energy
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Alert,
  Image,
  FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

import { AUTH_MESSAGES } from '@/constants/authMessages';
import { useAuth } from '@/contexts/AuthContext';
import { useAuthRequired } from '@/hooks/useAuthRequired';
import {
  getSwapParty,
  getPartyItems,
  getPartyItemsExtended,
  getPartyParticipants,
  joinSwapParty,
  leaveSwapParty,
  isParticipant,
  addItemToParty,
  removeItemFromParty,
} from '@/services/swapService';
import { SwapParty, SwapPartyItem, SwapPartyItemExtended, SwapPartyParticipant, Article } from '@/types';
import { ArticlesService } from '@/services/articlesService';
import { colors, fonts, spacing, radius } from '@/constants/theme';
import { Text, Caption, Label, Button } from '@/components/ui';
import SwapZoneFilters from '@/components/SwapZoneFilters';
import { useSwapFilters } from '@/hooks/useSwapFilters';

export default function SwapPartyDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const { requireAuth } = useAuthRequired();

  const [party, setParty] = useState<SwapParty | null>(null);
  const [items, setItems] = useState<SwapPartyItemExtended[]>([]);
  const [participants, setParticipants] = useState<SwapPartyParticipant[]>([]);
  const [userItems, setUserItems] = useState<SwapPartyItemExtended[]>([]);
  const [myArticles, setMyArticles] = useState<Article[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isJoined, setIsJoined] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [showMyArticles, setShowMyArticles] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

  // Filters hook
  const {
    filteredItems,
    filters,
    setFilters,
    hasActiveFilters,
    activeFilterCount,
    clearFilters,
  } = useSwapFilters(items);

  const formatDateRange = (startDate?: Date, endDate?: Date) => {
    if (!startDate || !endDate) return '';

    const formatDate = (d: Date) => {
      return d.toLocaleDateString('fr-FR', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      });
    };

    return `Du ${formatDate(startDate)} au ${formatDate(endDate)}`;
  };

  const loadPartyData = useCallback(async () => {
    if (!id) return;

    try {
      const [partyData, itemsData, participantsData] = await Promise.all([
        getSwapParty(id),
        getPartyItemsExtended(id),
        getPartyParticipants(id),
      ]);

      setParty(partyData);
      setItems(itemsData);
      setParticipants(participantsData);

      if (user) {
        const joined = await isParticipant(id, user.id);
        setIsJoined(joined);
        setUserItems(itemsData.filter((item) => item.sellerId === user.id));
      }
    } catch (error) {
      console.error('Error loading party data:', error);
    } finally {
      setIsLoading(false);
      setRefreshing(false);
    }
  }, [id, user]);

  const loadMyArticles = useCallback(async () => {
    if (!user) return;

    try {
      const articles = await ArticlesService.getUserArticles(user.id);
      const availableArticles = articles.filter((a) => a.isActive && !a.isSold);
      setMyArticles(availableArticles);
    } catch (error) {
      console.error('Error loading my articles:', error);
    }
  }, [user]);

  useEffect(() => {
    loadPartyData();
  }, [loadPartyData]);

  useEffect(() => {
    if (showMyArticles) {
      loadMyArticles();
    }
  }, [showMyArticles, loadMyArticles]);

  const handleRefresh = () => {
    setRefreshing(true);
    loadPartyData();
  };

  const handleJoin = async () => {
    if (!party) return;

    if (!user) {
      requireAuth(async () => {}, AUTH_MESSAGES.swapParty);
      return;
    }

    setIsJoining(true);
    try {
      await joinSwapParty(party.id, user.id, user.displayName || 'Utilisateur', user.profileImage);
      setIsJoined(true);
      loadPartyData();
    } catch (error) {
      console.error('Error joining party:', error);
      Alert.alert('Erreur', 'Impossible de rejoindre la party');
    } finally {
      setIsJoining(false);
    }
  };

  const handleLeave = async () => {
    if (!user || !party) return;

    Alert.alert(
      'Quitter la party',
      'Êtes-vous sûr de vouloir quitter cette Swap Party ? Vos articles seront retirés.',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Quitter',
          style: 'destructive',
          onPress: async () => {
            try {
              await leaveSwapParty(party.id, user.id);
              setIsJoined(false);
              setUserItems([]);
              loadPartyData();
            } catch (error) {
              console.error('Error leaving party:', error);
              Alert.alert('Erreur', 'Impossible de quitter la party');
            }
          },
        },
      ]
    );
  };

  const handleAddItem = async (article: Article) => {
    if (!user || !party) return;

    try {
      await addItemToParty(party.id, article, user.id, user.displayName || 'Utilisateur', user.profileImage);
      setShowMyArticles(false);
      loadPartyData();
    } catch (error) {
      console.error('Error adding item:', error);
      Alert.alert('Erreur', "Impossible d'ajouter l'article");
    }
  };

  const handleRemoveItem = async (articleId: string) => {
    if (!user || !party) return;

    Alert.alert(
      "Retirer l'article",
      'Êtes-vous sûr de vouloir retirer cet article de la Swap Party ?',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Retirer',
          style: 'destructive',
          onPress: async () => {
            try {
              await removeItemFromParty(party.id, articleId, user.id);
              loadPartyData();
            } catch (error) {
              console.error('Error removing item:', error);
              Alert.alert('Erreur', "Impossible de retirer l'article");
            }
          },
        },
      ]
    );
  };

  const handleItemPress = (item: SwapPartyItem) => {
    if (!user) {
      requireAuth(() => {}, AUTH_MESSAGES.swapParty);
      return;
    }

    if (item.sellerId !== user.id) {
      router.push({
        pathname: '/propose-swap',
        params: {
          partyId: party?.id,
          targetItemId: item.id,
          targetArticleId: item.articleId,
        },
      });
    } else {
      router.push(`/article/${item.articleId}`);
    }
  };

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (!party) {
    return (
      <SafeAreaView style={styles.container}>
        <Stack.Screen options={{ title: 'Swap Party' }} />
        <View style={styles.errorContainer}>
          <Text variant="body" style={styles.errorText}>Party non trouvée</Text>
        </View>
      </SafeAreaView>
    );
  }

  const otherItems = items.filter((item) => item.sellerId !== user?.id);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
        >
          <Ionicons name="chevron-back" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <Text variant="body" style={styles.headerTitle}>Swap Party</Text>
        {isJoined && (
          <TouchableOpacity style={styles.leaveButton} onPress={handleLeave}>
            <Text variant="bodySmall" style={styles.leaveButtonText}>Quitter</Text>
          </TouchableOpacity>
        )}
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={colors.primary}
          />
        }
      >
        {/* Party Banner */}
        <LinearGradient
          colors={party.status === 'active' ? [colors.primary, '#1a4fd4'] : ['#667eea', '#764ba2']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.banner}
        >
          <Text style={styles.bannerEmoji}>{party.emoji}</Text>
          <Text variant="h2" style={styles.bannerTitle}>{party.name}</Text>
          {party.description && (
            <Text variant="bodySmall" style={styles.bannerDescription}>{party.description}</Text>
          )}

          <View style={styles.countdownContainer}>
            <Ionicons name="calendar-outline" size={18} color={colors.white} />
            <Caption style={styles.countdownText}>
              {formatDateRange(party.startDate, party.endDate)}
            </Caption>
          </View>

          <View style={styles.statsRow}>
            <View style={styles.stat}>
              <Text variant="h3" style={styles.statValue}>{party.participantsCount || 0}</Text>
              <Caption style={styles.statLabel}>participants</Caption>
            </View>
            <View style={styles.stat}>
              <Text variant="h3" style={styles.statValue}>{party.itemsCount || 0}</Text>
              <Caption style={styles.statLabel}>articles</Caption>
            </View>
            <View style={styles.stat}>
              <Text variant="h3" style={styles.statValue}>{party.swapsCount || 0}</Text>
              <Caption style={styles.statLabel}>échanges</Caption>
            </View>
          </View>

          {!isJoined && party.status !== 'ended' && (
            <TouchableOpacity
              style={styles.joinButton}
              onPress={handleJoin}
              disabled={isJoining}
            >
              {isJoining ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <>
                  <Text variant="body" style={styles.joinButtonText}>Rejoindre la Party</Text>
                  <Ionicons name="arrow-forward" size={20} color={colors.primary} />
                </>
              )}
            </TouchableOpacity>
          )}
        </LinearGradient>

        {/* My Items Section (if joined) */}
        {isJoined && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Label style={styles.sectionLabel}>Mes articles</Label>
              <TouchableOpacity
                style={styles.addButton}
                onPress={() => setShowMyArticles(true)}
              >
                <Ionicons name="add" size={20} color={colors.primary} />
                <Text variant="bodySmall" style={styles.addButtonText}>Ajouter</Text>
              </TouchableOpacity>
            </View>

            {userItems.length === 0 ? (
              <View style={styles.emptyCard}>
                <Ionicons name="shirt-outline" size={40} color={colors.muted} />
                <Caption style={styles.emptyText}>
                  Ajoutez vos articles pour commencer à échanger
                </Caption>
              </View>
            ) : (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.horizontalList}
              >
                {userItems.map((item) => (
                  <MyItemCard
                    key={item.id}
                    item={item}
                    onRemove={() => handleRemoveItem(item.articleId)}
                    onPress={() => router.push(`/article/${item.articleId}`)}
                  />
                ))}
              </ScrollView>
            )}
          </View>
        )}

        {/* Browse Items Section */}
        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Label style={styles.sectionLabel}>
              {isJoined ? 'Proposer un échange' : 'Articles disponibles'}
              {hasActiveFilters && (
                <Text variant="caption" style={styles.filterCount}>
                  {' '}({activeFilterCount} filtre{activeFilterCount > 1 ? 's' : ''})
                </Text>
              )}
            </Label>
            <TouchableOpacity
              style={[
                styles.filterButton,
                hasActiveFilters && styles.filterButtonActive,
              ]}
              onPress={() => setShowFilters(true)}
            >
              <Ionicons
                name="options-outline"
                size={20}
                color={hasActiveFilters ? colors.primary : colors.foreground}
              />
              {hasActiveFilters && (
                <View style={styles.filterBadge}>
                  <Text variant="caption" style={styles.filterBadgeText}>
                    {activeFilterCount}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          </View>

          {filteredItems.filter((item) => item.sellerId !== user?.id).length === 0 ? (
            <View style={styles.emptyCard}>
              <Ionicons
                name={hasActiveFilters ? 'funnel-outline' : 'swap-horizontal'}
                size={40}
                color={colors.muted}
              />
              <Caption style={styles.emptyText}>
                {hasActiveFilters
                  ? 'Aucun article ne correspond aux filtres'
                  : 'Aucun article disponible pour le moment'}
              </Caption>
              {hasActiveFilters && (
                <TouchableOpacity onPress={clearFilters} style={styles.clearFiltersButton}>
                  <Text variant="bodySmall" style={styles.clearFiltersText}>
                    Réinitialiser les filtres
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          ) : (
            <View style={styles.itemsGrid}>
              {filteredItems
                .filter((item) => item.sellerId !== user?.id)
                .map((item) => (
                  <SwapItemCard
                    key={item.id}
                    item={item}
                    onPress={() => handleItemPress(item)}
                    canSwap={isJoined && userItems.length > 0}
                  />
                ))}
            </View>
          )}
        </View>
      </ScrollView>

      {/* Add Article Modal */}
      {showMyArticles && (
        <View style={styles.modal}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text variant="body" style={styles.modalTitle}>Ajouter un article</Text>
              <TouchableOpacity onPress={() => setShowMyArticles(false)}>
                <Ionicons name="close" size={24} color={colors.foreground} />
              </TouchableOpacity>
            </View>

            <FlatList
              data={myArticles.filter(
                (article) => !userItems.some((ui) => ui.articleId === article.id)
              )}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.articleItem}
                  onPress={() => handleAddItem(item)}
                >
                  <Image
                    source={{ uri: item.images?.[0]?.url }}
                    style={styles.articleImage}
                  />
                  <View style={styles.articleInfo}>
                    <Text variant="body" style={styles.articleTitle} numberOfLines={1}>
                      {item.title}
                    </Text>
                    <Text variant="body" style={styles.articlePrice}>{item.price}€</Text>
                  </View>
                  <Ionicons name="add-circle" size={24} color={colors.primary} />
                </TouchableOpacity>
              )}
              ListEmptyComponent={
                <View style={styles.emptyModal}>
                  <Caption style={styles.emptyModalText}>
                    Aucun article disponible à ajouter
                  </Caption>
                </View>
              }
            />
          </View>
        </View>
      )}

      {/* Filters Modal */}
      <SwapZoneFilters
        visible={showFilters}
        onClose={() => setShowFilters(false)}
        onApply={setFilters}
        initialFilters={filters}
      />
    </SafeAreaView>
  );
}

/**
 * My Item Card Component
 */
function MyItemCard({
  item,
  onRemove,
  onPress,
}: {
  item: SwapPartyItem;
  onRemove: () => void;
  onPress: () => void;
}) {
  return (
    <View style={styles.myItemCard}>
      <TouchableOpacity onPress={onPress}>
        <Image source={{ uri: item.imageUrl }} style={styles.myItemImage} />
        <Text variant="caption" style={styles.myItemTitle} numberOfLines={1}>
          {item.title}
        </Text>
        <Text variant="body" style={styles.myItemPrice}>{item.price}€</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.removeButton} onPress={onRemove}>
        <Ionicons name="close-circle" size={20} color={colors.danger} />
      </TouchableOpacity>
    </View>
  );
}

/**
 * Swap Item Card Component
 */
function SwapItemCard({
  item,
  onPress,
  canSwap,
}: {
  item: SwapPartyItem;
  onPress: () => void;
  canSwap: boolean;
}) {
  return (
    <TouchableOpacity style={styles.swapItemCard} onPress={onPress}>
      <Image source={{ uri: item.imageUrl }} style={styles.swapItemImage} />
      <View style={styles.swapItemInfo}>
        <Text variant="bodySmall" style={styles.swapItemTitle} numberOfLines={1}>
          {item.title}
        </Text>
        <Text variant="body" style={styles.swapItemPrice}>{item.price}€</Text>
        <View style={styles.sellerRow}>
          {item.sellerImage ? (
            <Image source={{ uri: item.sellerImage }} style={styles.sellerAvatar} />
          ) : (
            <View style={styles.sellerAvatarPlaceholder}>
              <Ionicons name="person" size={12} color={colors.muted} />
            </View>
          )}
          <Caption style={styles.sellerName} numberOfLines={1}>
            {item.sellerName}
          </Caption>
        </View>
      </View>
      {canSwap && (
        <View style={styles.swapBadge}>
          <Ionicons name="swap-horizontal" size={14} color={colors.white} />
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorText: {
    color: colors.foregroundSecondary,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  backButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontFamily: fonts.sansMedium,
    color: colors.foreground,
  },
  leaveButton: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  leaveButtonText: {
    color: colors.danger,
    fontFamily: fonts.sansMedium,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: spacing['2xl'],
  },
  banner: {
    padding: spacing.lg,
    alignItems: 'center',
  },
  bannerEmoji: {
    fontSize: 50,
    marginBottom: spacing.sm,
  },
  bannerTitle: {
    color: colors.white,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  bannerDescription: {
    color: 'rgba(255, 255, 255, 0.9)',
    textAlign: 'center',
    marginBottom: spacing.md,
    lineHeight: 20,
    paddingHorizontal: spacing.md,
  },
  countdownContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  countdownText: {
    color: colors.white,
    fontFamily: fonts.sansMedium,
  },
  statsRow: {
    flexDirection: 'row',
    gap: spacing['2xl'],
    marginBottom: spacing.lg,
  },
  stat: {
    alignItems: 'center',
  },
  statValue: {
    color: colors.white,
  },
  statLabel: {
    color: 'rgba(255, 255, 255, 0.8)',
    marginTop: 2,
  },
  joinButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.full,
    gap: spacing.sm,
  },
  joinButtonText: {
    fontFamily: fonts.sansMedium,
    color: colors.primary,
  },
  section: {
    marginTop: spacing.lg,
    paddingHorizontal: spacing.md,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  sectionLabel: {
    color: colors.foregroundSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  addButtonText: {
    fontFamily: fonts.sansMedium,
    color: colors.primary,
  },
  emptyCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing['2xl'],
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  emptyText: {
    color: colors.foregroundSecondary,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  horizontalList: {
    paddingRight: spacing.md,
  },
  myItemCard: {
    width: 120,
    marginRight: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    overflow: 'hidden',
    position: 'relative',
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  myItemImage: {
    width: 120,
    height: 120,
    backgroundColor: colors.backgroundSecondary,
  },
  myItemTitle: {
    color: colors.foreground,
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.sm,
  },
  myItemPrice: {
    fontFamily: fonts.sansMedium,
    color: colors.foreground,
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.sm,
  },
  removeButton: {
    position: 'absolute',
    top: 4,
    right: 4,
    backgroundColor: colors.white,
    borderRadius: 10,
  },
  itemsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -4,
  },
  swapItemCard: {
    width: '48%',
    marginHorizontal: '1%',
    marginBottom: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  swapItemImage: {
    width: '100%',
    aspectRatio: 1,
    backgroundColor: colors.backgroundSecondary,
  },
  swapItemInfo: {
    padding: spacing.sm,
  },
  swapItemTitle: {
    color: colors.foreground,
    marginBottom: 4,
  },
  swapItemPrice: {
    fontFamily: fonts.sansMedium,
    color: colors.foreground,
    marginBottom: spacing.sm,
  },
  sellerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  sellerAvatar: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.backgroundSecondary,
  },
  sellerAvatarPlaceholder: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.backgroundSecondary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sellerName: {
    color: colors.foregroundSecondary,
    flex: 1,
  },
  swapBadge: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    backgroundColor: colors.primary,
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modal: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    maxHeight: '70%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  modalTitle: {
    fontFamily: fonts.sansMedium,
    color: colors.foreground,
  },
  articleItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  articleImage: {
    width: 60,
    height: 60,
    borderRadius: radius.sm,
    backgroundColor: colors.backgroundSecondary,
    marginRight: spacing.sm,
  },
  articleInfo: {
    flex: 1,
  },
  articleTitle: {
    color: colors.foreground,
    marginBottom: 4,
  },
  articlePrice: {
    fontFamily: fonts.sansMedium,
    color: colors.foreground,
  },
  emptyModal: {
    padding: spacing['2xl'],
    alignItems: 'center',
  },
  emptyModalText: {
    color: colors.foregroundSecondary,
    textAlign: 'center',
  },
  // Filter styles
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  filterButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    position: 'relative',
  },
  filterButtonActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryLight,
  },
  filterBadge: {
    position: 'absolute',
    top: -6,
    right: -6,
    backgroundColor: colors.primary,
    borderRadius: 10,
    width: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  filterBadgeText: {
    color: colors.white,
    fontSize: 10,
    fontFamily: fonts.sansBold,
  },
  filterCount: {
    color: colors.primary,
    fontFamily: fonts.sansMedium,
  },
  clearFiltersButton: {
    marginTop: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  clearFiltersText: {
    color: colors.primary,
    fontFamily: fonts.sansMedium,
  },
});
