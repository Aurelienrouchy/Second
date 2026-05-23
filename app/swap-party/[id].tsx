/**
 * Swap Party Detail Screen
 * Design: HTML UI Kit — Swap Zone active · Parcourir
 * Exact design: Phone 3 — sticky header, "Mon article disponible" section, 2-col product grid
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
} from 'react-native';
import { Image } from 'expo-image';
import { FlashList } from '@shopify/flash-list';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { AUTH_MESSAGES } from '@/constants/authMessages';
import { useAuth } from '@/contexts/AuthContext';
import { useAuthRequired } from '@/hooks/useAuthRequired';
import {
  getSwapParty,
  getPartyItemsExtended,
  joinSwapParty,
  leaveSwapParty,
  isParticipant,
  addItemToParty,
  removeItemFromParty,
} from '@/services/swapService';
import { SwapParty, SwapPartyItemExtended, Article } from '@/types';
import { ArticlesService } from '@/services/articlesService';
import { colors, fonts, spacing, radius } from '@/constants/theme';
import { Text, Caption } from '@/components/ui';
import SwapZoneFilters from '@/components/SwapZoneFilters';
import { useSwapFilters } from '@/hooks/useSwapFilters';

export default function SwapPartyDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const { requireAuth } = useAuthRequired();

  // Party & items state
  const [party, setParty] = useState<SwapParty | null>(null);
  const [items, setItems] = useState<SwapPartyItemExtended[]>([]);
  const [userItems, setUserItems] = useState<SwapPartyItemExtended[]>([]);
  const [myArticles, setMyArticles] = useState<Article[]>([]);

  // UI state
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isJoined, setIsJoined] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [showMyArticles, setShowMyArticles] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

  // Multi-select state
  const [isMultiSelectMode, setIsMultiSelectMode] = useState(false);
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [longPressItem, setLongPressItem] = useState<string | null>(null);

  // Filters hook
  const {
    filteredItems,
    filters,
    setFilters,
    hasActiveFilters,
    activeFilterCount,
    clearFilters,
  } = useSwapFilters(items);

  // Calculate countdown days
  const getCountdownDays = useCallback((endDate?: Date) => {
    if (!endDate) return null;
    const now = new Date();
    const diffMs = endDate.getTime() - now.getTime();
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    return Math.max(0, diffDays);
  }, []);

  // Toggle item selection
  const toggleItemSelection = useCallback((itemId: string) => {
    setSelectedItemIds((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(itemId)) {
        newSet.delete(itemId);
      } else {
        newSet.add(itemId);
      }
      if (newSet.size === 0) {
        setIsMultiSelectMode(false);
      }
      return newSet;
    });
  }, []);

  const loadPartyData = useCallback(async () => {
    if (!id) return;

    try {
      const [partyData, itemsData] = await Promise.all([
        getSwapParty(id),
        getPartyItemsExtended(id),
      ]);

      setParty(partyData);
      setItems(itemsData);

      if (user) {
        const joined = await isParticipant(id, user.id);
        setIsJoined(joined);
        setUserItems(itemsData.filter((item) => item.sellerId === user.id));
      }
    } catch (error) {
      if (__DEV__) console.error('Error loading party data:', error);
    } finally {
      setIsLoading(false);
      setRefreshing(false);
    }
  }, [id, user]);

  const loadMyArticles = useCallback(async () => {
    if (!user) return;

    try {
      const articles = await ArticlesService.getUserArticles(user.id);
      // getUserArticles already filters out isActive === false
      // Only filter out sold articles here; treat missing isActive as active
      const availableArticles = articles.filter((a) => a.isActive !== false && !a.isSold);
      setMyArticles(availableArticles);
    } catch (error) {
      if (__DEV__) console.error('Error loading my articles:', error);
    }
  }, [user]);

  useEffect(() => {
    loadPartyData();
  }, [loadPartyData]);

  // Preload user articles when joined (so modal opens instantly)
  useEffect(() => {
    if (isJoined || showMyArticles) {
      loadMyArticles();
    }
  }, [isJoined, showMyArticles, loadMyArticles]);

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
      if (__DEV__) console.error('Error joining party:', error);
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
              if (__DEV__) console.error('Error leaving party:', error);
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
      // Reload data without closing the modal so user can add more articles
      loadPartyData();
      // Re-fetch articles to update the "already added" filter
      loadMyArticles();
    } catch (error) {
      if (__DEV__) console.error('Error adding item:', error);
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
              if (__DEV__) console.error('Error removing item:', error);
              Alert.alert('Erreur', "Impossible de retirer l'article");
            }
          },
        },
      ]
    );
  };

  // Handle item press with multi-select awareness
  const handleItemPress = (item: SwapPartyItemExtended) => {
    if (!user) {
      requireAuth(() => {}, AUTH_MESSAGES.swapParty);
      return;
    }

    // In multi-select mode, toggle selection
    if (isMultiSelectMode) {
      toggleItemSelection(item.id);
      return;
    }

    // Navigate to article detail — pass swap context if it's another person's item
    if (item.sellerId === user.id) {
      router.push(`/article/${item.articleId}` as any);
    } else {
      router.push({
        pathname: `/article/${item.articleId}` as any,
        params: {
          partyId: party?.id,
          swapItemId: item.id,
        },
      });
    }
  };

  // Handle long press to enter multi-select mode
  const handleItemLongPress = (itemId: string) => {
    if (!isJoined) return;
    setIsMultiSelectMode(true);
    toggleItemSelection(itemId);
  };

  // Handle propose swap with selected items
  const handleProposeMultipleSwaps = () => {
    if (selectedItemIds.size === 0 || !party) return;

    const selectedItems = filteredItems.filter((item) => selectedItemIds.has(item.id));

    router.push({
      pathname: '/propose-swap',
      params: {
        partyId: party.id,
        selectedItemIds: Array.from(selectedItemIds).join(','),
      },
    });
  };

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.sage} />
        </View>
      </SafeAreaView>
    );
  }

  if (!party) {
    return (
      <SafeAreaView style={styles.container}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.errorContainer}>
          <Text variant="body" color="foregroundSecondary">Swap Zone non trouvée</Text>
        </View>
      </SafeAreaView>
    );
  }

  const countdownDays = getCountdownDays(party.endDate);
  const otherItems = filteredItems.filter((item) => item.sellerId !== user?.id);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Sticky Header — Cream bg with border, 14px padding vertical */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => {
            setIsMultiSelectMode(false);
            setSelectedItemIds(new Set());
            router.back();
          }}
        >
          <Ionicons name="chevron-back" size={20} color={colors.charcoal} />
        </TouchableOpacity>

        <View style={styles.headerTitleSection}>
          {/* Label: "Swap Zone · En cours" */}
          <Text style={styles.headerLabel}>
            Swap Zone · {party.status === 'active' ? 'En cours' : 'À venir'}
          </Text>
          {/* Title: Cormorant 18px, weight 300 */}
          <Text style={styles.headerTitle}>{party.name}</Text>
        </View>

        {/* Badge: "J-8" */}
        {countdownDays !== null && (
          <View style={styles.countdownBadge}>
            <Text style={styles.badgeText}>J-{countdownDays}</Text>
          </View>
        )}
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={colors.sage}
          />
        }
      >
        {/* "Mes articles" Section — Only if joined */}
        {isJoined && (
          <View style={styles.myArticleSection}>
            {/* Label with count */}
            <View style={styles.myArticleLabelRow}>
              <Text style={styles.myArticleLabel}>
                Mes articles à l'échange · {userItems.length}
              </Text>
              {party.status !== 'ended' && (
                <TouchableOpacity
                  style={styles.addArticleButton}
                  onPress={() => setShowMyArticles(true)}
                >
                  <Ionicons name="add" size={16} color={colors.sage} />
                  <Text style={styles.addArticleButtonText}>Ajouter</Text>
                </TouchableOpacity>
              )}
            </View>

            {userItems.length > 0 ? (
              <View style={styles.myArticlesList}>
                {userItems.map((item) => (
                  <View key={item.id} style={styles.myArticleRow}>
                    <Image
                      source={{ uri: item.imageUrl }}
                      style={styles.myArticleImage}
                    />
                    <View style={styles.myArticleContent}>
                      <Text style={styles.myArticleBrand}>
                        {item.brand || 'BRAND'}
                      </Text>
                      <Text style={styles.myArticleTitle}>
                        {item.title}
                      </Text>
                      <Text style={styles.myArticleStatus}>
                        Disponible au swap
                      </Text>
                    </View>
                    <View style={styles.myArticleValue}>
                      <Text style={styles.myArticleValueLabel}>Valeur</Text>
                      <Text style={styles.myArticlePrice}>
                        {item.price}$
                      </Text>
                    </View>
                    {party.status !== 'ended' && (
                      <TouchableOpacity
                        style={styles.removeItemButton}
                        onPress={() => handleRemoveItem(item.articleId)}
                      >
                        <Ionicons name="close-circle" size={20} color={colors.muted} />
                      </TouchableOpacity>
                    )}
                  </View>
                ))}
              </View>
            ) : (
              <TouchableOpacity
                style={styles.myArticleEmpty}
                onPress={() => setShowMyArticles(true)}
              >
                <Ionicons name="add-circle-outline" size={24} color={colors.sage} />
                <Text style={styles.myArticleEmptyText}>
                  Ajouter des articles à échanger
                </Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Join/Leave Actions */}
        {!isJoined && party.status !== 'ended' && (
          <View style={styles.actionSection}>
            <TouchableOpacity
              style={styles.joinButton}
              onPress={handleJoin}
              disabled={isJoining}
            >
              {isJoining ? (
                <ActivityIndicator size="small" color={colors.white} />
              ) : (
                <Text style={styles.joinButtonText}>Rejoindre la Swap Zone</Text>
              )}
            </TouchableOpacity>
          </View>
        )}

        {isJoined && (
          <TouchableOpacity
            style={styles.leaveButton}
            onPress={handleLeave}
          >
            <Text style={styles.leaveButtonText}>Quitter la party</Text>
          </TouchableOpacity>
        )}

        {/* "Articles disponibles" label with count */}
        <View style={styles.gridLabelSection}>
          <Text style={styles.gridLabel}>
            Articles disponibles · {otherItems.length}
          </Text>
        </View>

        {/* Product Grid — 2 columns with 1px divider background */}
        {otherItems.length === 0 ? (
          <View style={styles.emptyGrid}>
            <Ionicons
              name={hasActiveFilters ? 'funnel-outline' : 'swap-horizontal'}
              size={48}
              color={colors.sage}
            />
            <Text style={styles.emptyGridTitle}>
              {hasActiveFilters
                ? 'Aucun article ne correspond aux filtres'
                : 'Aucun article disponible'}
            </Text>
            <Caption style={styles.emptyGridText}>
              {hasActiveFilters
                ? 'Essayez de modifier vos critères de recherche'
                : 'Revenez plus tard'}
            </Caption>
            {hasActiveFilters && (
              <TouchableOpacity onPress={clearFilters} style={styles.clearFiltersButton}>
                <Text style={styles.clearFiltersText}>Réinitialiser</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : (
          <>
            <FlashList
              data={otherItems}
              keyExtractor={(item) => item.id}
              numColumns={2}
              scrollEnabled={false}
              contentContainerStyle={styles.gridContainer}
              renderItem={({ item }) => (
                <ProductCard
                  item={item}
                  isSelected={selectedItemIds.has(item.id)}
                  isMultiSelectMode={isMultiSelectMode}
                  onPress={() => handleItemPress(item)}
                  onLongPress={() => handleItemLongPress(item.id)}
                />
              )}
            />

            {/* Multi-select action bar */}
            {isMultiSelectMode && selectedItemIds.size > 0 && (
              <View style={styles.multiSelectBar}>
                <TouchableOpacity
                  style={styles.cancelSelectButton}
                  onPress={() => {
                    setIsMultiSelectMode(false);
                    setSelectedItemIds(new Set());
                  }}
                >
                  <Text style={styles.cancelButtonText}>Annuler</Text>
                </TouchableOpacity>

                <Text style={styles.selectedCountText}>
                  {selectedItemIds.size} sélectionné{selectedItemIds.size > 1 ? 's' : ''}
                </Text>

                {isJoined && userItems.length > 0 && (
                  <TouchableOpacity
                    style={styles.proposeButton}
                    onPress={handleProposeMultipleSwaps}
                  >
                    <Text style={styles.proposeButtonText}>Proposer</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
          </>
        )}
      </ScrollView>

      {/* Add Articles Modal */}
      {showMyArticles && (
        <View style={styles.modal}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text variant="body" style={styles.modalTitle}>Ajouter des articles</Text>
              <TouchableOpacity
                style={styles.modalDoneButton}
                onPress={() => setShowMyArticles(false)}
              >
                <Text style={styles.modalDoneText}>Terminé</Text>
              </TouchableOpacity>
            </View>

            {userItems.length > 0 && (
              <View style={styles.modalAddedCount}>
                <Ionicons name="checkmark-circle" size={14} color={colors.sage} />
                <Text style={styles.modalAddedCountText}>
                  {userItems.length} article{userItems.length > 1 ? 's' : ''} dans la party
                </Text>
              </View>
            )}

            <FlashList
              data={myArticles.filter(
                (article) => !userItems.some((ui) => ui.articleId === article.id)
              )}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.articleListItem}
                  onPress={() => handleAddItem(item)}
                >
                  <Image
                    source={{ uri: item.images?.[0]?.url }}
                    style={styles.articleListImage}
                  />
                  <View style={styles.articleListInfo}>
                    <Text variant="label" style={styles.articleListTitle} numberOfLines={1}>
                      {item.title}
                    </Text>
                    <Text variant="caption" color="muted">
                      {item.brand}
                    </Text>
                  </View>
                  <Text variant="price" style={styles.articleListPrice}>
                    {item.price}$
                  </Text>
                  <View style={styles.addItemIcon}>
                    <Ionicons name="add-circle" size={24} color={colors.sage} />
                  </View>
                </TouchableOpacity>
              )}
              ListEmptyComponent={
                <View style={styles.emptyModal}>
                  <Caption style={styles.emptyModalText}>
                    Tous vos articles sont déjà dans la party
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
 * Product Card Component — HTML UI Kit design
 * cream background, image 3:4 aspect ratio, brand/title/price footer
 */
interface ProductCardProps {
  item: SwapPartyItemExtended;
  isSelected: boolean;
  isMultiSelectMode: boolean;
  onPress: () => void;
  onLongPress: () => void;
}

function ProductCard({
  item,
  isSelected,
  isMultiSelectMode,
  onPress,
  onLongPress,
}: ProductCardProps) {
  // Determine if there's a price supplement
  const hasValueDifference = item.price != null && item.price > 0;

  return (
    <TouchableOpacity
      style={styles.productCard}
      onPress={onPress}
      onLongPress={onLongPress}
      activeOpacity={0.7}
    >
      {/* Image wrapper with 3:4 aspect ratio */}
      <View style={styles.productImageWrapper}>
        <Image
          source={{ uri: item.imageUrl }}
          style={styles.productImage}
          resizeMode="cover"
        />

        {/* Selection checkbox (only visible in multi-select mode) */}
        {isMultiSelectMode && (
          <View
            style={[
              styles.selectionCheckbox,
              isSelected && styles.selectionCheckboxSelected,
            ]}
          >
            {isSelected && (
              <Ionicons name="checkmark" size={14} color={colors.white} />
            )}
          </View>
        )}

        {/* Save button: position absolute top 8px right 8px, 28x28px */}
        <TouchableOpacity style={styles.saveButton}>
          <Ionicons name="heart-outline" size={16} color={colors.charcoal} />
        </TouchableOpacity>

        {/* Swap badge: bottom 8px left 8px */}
        <View
          style={[
            styles.swapBadge,
            hasValueDifference && styles.swapBadgeWithPrice,
          ]}
        >
          <Ionicons
            name="swap-horizontal"
            size={10}
            color={colors.white}
            style={styles.swapIcon}
          />
          <Text style={styles.swapBadgeText}>
            {hasValueDifference ? `Swap + $${item.price}` : 'Swap'}
          </Text>
        </View>
      </View>

      {/* Product info: padding 10px 12px 14px */}
      <View style={styles.productInfo}>
        {/* Brand: 9px, uppercase, muted */}
        <Text style={styles.productBrand}>
          {item.brand || 'BRAND'}
        </Text>
        {/* Title: Cormorant 15px, weight 400 */}
        <Text style={styles.productTitle} numberOfLines={2}>
          {item.title}
        </Text>
        {/* Footer: flex space-between, price left, size right */}
        <View style={styles.productFooter}>
          <Text style={[
            styles.productPrice,
            hasValueDifference && styles.productPriceRust,
          ]}>
            ${item.price}
          </Text>
          <Text style={styles.productSize}>
            {item.size || 'U'}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  // ===== CONTAINER & LAYOUT =====
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
    paddingHorizontal: spacing.lg,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: spacing['2xl'],
  },

  // ===== STICKY HEADER (cream bg, 14px padding) =====
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 14,
    backgroundColor: `rgba(245, 240, 232, 0.95)`,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: 12,
  },
  backButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  headerTitleSection: {
    flex: 1,
  },
  headerLabel: {
    fontSize: 9,
    fontFamily: fonts.sansMedium,
    letterSpacing: 1.35,
    textTransform: 'uppercase',
    color: colors.sage,
    marginBottom: 1,
  },
  headerTitle: {
    fontFamily: fonts.display,
    fontSize: 18,
    fontWeight: '300',
    color: colors.charcoal,
  },
  countdownBadge: {
    backgroundColor: 'rgba(122, 140, 110, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(122, 140, 110, 0.2)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  badgeText: {
    fontSize: 9,
    fontFamily: fonts.sansMedium,
    letterSpacing: 0.9,
    textTransform: 'uppercase',
    color: colors.sage,
  },

  // ===== MY ARTICLES SECTION =====
  myArticleSection: {
    backgroundColor: 'rgba(122, 140, 110, 0.06)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(122, 140, 110, 0.12)',
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  myArticleLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  myArticleLabel: {
    fontSize: 10,
    fontFamily: fonts.sansMedium,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: colors.sage,
  },
  addArticleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: 'rgba(122, 140, 110, 0.3)',
    borderRadius: 2,
  },
  addArticleButtonText: {
    fontSize: 10,
    fontFamily: fonts.sansMedium,
    letterSpacing: 1.0,
    textTransform: 'uppercase',
    color: colors.sage,
  },
  myArticlesList: {
    gap: 8,
  },
  myArticleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  myArticleImage: {
    width: 48,
    height: 60,
    backgroundColor: colors.background,
    borderRadius: 0,
  },
  myArticleContent: {
    flex: 1,
  },
  myArticleBrand: {
    fontSize: 10,
    fontFamily: fonts.sansMedium,
    letterSpacing: 1.0,
    textTransform: 'uppercase',
    color: colors.muted,
    marginBottom: 2,
  },
  myArticleTitle: {
    fontFamily: fonts.display,
    fontSize: 15,
    fontWeight: '400',
    color: colors.charcoal,
    marginBottom: 6,
  },
  myArticleStatus: {
    fontSize: 11,
    fontFamily: fonts.sans,
    color: colors.sage,
  },
  myArticleValue: {
    alignItems: 'flex-end',
  },
  myArticleValueLabel: {
    fontSize: 11,
    fontFamily: fonts.sans,
    color: colors.muted,
  },
  myArticlePrice: {
    fontFamily: fonts.display,
    fontSize: 18,
    fontWeight: '400',
    color: colors.charcoal,
  },
  myArticleEmpty: {
    paddingVertical: 20,
    alignItems: 'center',
    gap: 8,
  },
  myArticleEmptyText: {
    fontSize: 11,
    fontFamily: fonts.sans,
    color: colors.muted,
  },
  removeItemButton: {
    padding: 4,
    marginLeft: 4,
  },

  // ===== ACTION SECTION =====
  actionSection: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
  },
  joinButton: {
    backgroundColor: colors.sage,
    paddingVertical: 14,
    paddingHorizontal: spacing.lg,
    borderRadius: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  joinButtonText: {
    fontSize: 12,
    fontFamily: fonts.sansMedium,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: colors.white,
  },
  leaveButton: {
    marginHorizontal: spacing.lg,
    marginVertical: spacing.lg,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  leaveButtonText: {
    fontSize: 12,
    fontFamily: fonts.sansMedium,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: colors.danger,
  },

  // ===== GRID LABEL SECTION =====
  gridLabelSection: {
    paddingHorizontal: 16,
    paddingTop: 14,
    marginBottom: 12,
  },
  gridLabel: {
    fontSize: 10,
    fontFamily: fonts.sansMedium,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: colors.muted,
  },

  // ===== PRODUCT GRID — 2 COLUMNS with 1px dividers =====
  gridContainer: {
    paddingHorizontal: 0,
    paddingVertical: 0,
    backgroundColor: colors.border,
  },
  productCard: {
    flex: 1,
    backgroundColor: colors.cream,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
  productImageWrapper: {
    position: 'relative',
    aspectRatio: 3 / 4,
    backgroundColor: colors.background,
    overflow: 'hidden',
  },
  productImage: {
    width: '100%',
    height: '100%',
  },
  saveButton: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: `rgba(245, 240, 232, 0.88)`,
    justifyContent: 'center',
    alignItems: 'center',
  },
  swapBadge: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    backgroundColor: `rgba(122, 140, 110, 0.9)`,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  swapBadgeWithPrice: {
    backgroundColor: `rgba(196, 96, 58, 0.9)`,
  },
  swapIcon: {
    marginRight: 2,
  },
  swapBadgeText: {
    fontSize: 9,
    fontFamily: fonts.sansMedium,
    letterSpacing: 0.9,
    textTransform: 'uppercase',
    color: colors.white,
  },
  selectionCheckbox: {
    position: 'absolute',
    top: 8,
    left: 8,
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.white,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.2)',
  },
  selectionCheckboxSelected: {
    backgroundColor: colors.sage,
    borderColor: colors.sage,
  },

  // ===== PRODUCT INFO =====
  productInfo: {
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 14,
  },
  productBrand: {
    fontSize: 9,
    fontFamily: fonts.sansMedium,
    letterSpacing: 1.35,
    textTransform: 'uppercase',
    color: colors.muted,
    marginBottom: 2,
  },
  productTitle: {
    fontFamily: fonts.display,
    fontSize: 15,
    fontWeight: '400',
    color: colors.charcoal,
    marginBottom: 6,
    lineHeight: 18,
  },
  productFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  productPrice: {
    fontFamily: fonts.display,
    fontSize: 14,
    fontWeight: '500',
    color: colors.sage,
  },
  productPriceRust: {
    color: colors.rust,
  },
  productSize: {
    fontSize: 10,
    fontFamily: fonts.sans,
    color: colors.muted,
  },

  // ===== EMPTY STATE =====
  emptyGrid: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing['2xl'],
    alignItems: 'center',
  },
  emptyGridTitle: {
    marginTop: spacing.lg,
    fontSize: 14,
    fontFamily: fonts.sans,
    color: colors.charcoal,
    textAlign: 'center',
  },
  emptyGridText: {
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  clearFiltersButton: {
    marginTop: spacing.lg,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: 0,
    borderWidth: 1,
    borderColor: colors.sage,
  },
  clearFiltersText: {
    fontSize: 12,
    fontFamily: fonts.sansMedium,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: colors.sage,
  },

  // ===== MULTI-SELECT BAR =====
  multiSelectBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: spacing.md,
  },
  cancelSelectButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 0,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  cancelButtonText: {
    fontSize: 12,
    fontFamily: fonts.sansMedium,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: colors.muted,
  },
  selectedCountText: {
    fontSize: 12,
    fontFamily: fonts.sansMedium,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: colors.muted,
  },
  proposeButton: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.sage,
    borderRadius: 0,
  },
  proposeButtonText: {
    fontSize: 12,
    fontFamily: fonts.sansMedium,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: colors.white,
  },

  // ===== MODAL (not used in this exact design but kept for compatibility) =====
  modal: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
    zIndex: 100,
  },
  modalContent: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '500',
    color: colors.charcoal,
  },
  modalDoneButton: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    backgroundColor: colors.sage,
    borderRadius: 2,
  },
  modalDoneText: {
    fontSize: 11,
    fontFamily: fonts.sansMedium,
    letterSpacing: 1.0,
    textTransform: 'uppercase',
    color: colors.white,
  },
  modalAddedCount: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.lg,
    paddingVertical: 8,
    backgroundColor: 'rgba(122, 140, 110, 0.08)',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  modalAddedCountText: {
    fontSize: 12,
    fontFamily: fonts.sans,
    color: colors.sage,
  },
  addItemIcon: {
    marginLeft: 4,
  },
  articleListItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.md,
  },
  articleListImage: {
    width: 48,
    height: 60,
    backgroundColor: colors.background,
    borderRadius: 0,
  },
  articleListInfo: {
    flex: 1,
  },
  articleListTitle: {
    fontSize: 13,
    fontFamily: fonts.sans,
    color: colors.charcoal,
    marginBottom: 2,
  },
  articleListPrice: {
    fontSize: 14,
    fontFamily: fonts.display,
    color: colors.rust,
    fontWeight: '500',
  },
  emptyModal: {
    paddingVertical: spacing['2xl'],
    alignItems: 'center',
  },
  emptyModalText: {
    fontSize: 11,
    fontFamily: fonts.sans,
    color: colors.muted,
    textAlign: 'center',
  },
});
