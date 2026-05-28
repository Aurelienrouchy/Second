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
  Pressable,
  RefreshControl,
  Alert,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';

import { AUTH_MESSAGES } from '@/constants/authMessages';
import { useUser } from '@/contexts/AuthContext';
import { useAuthRequired } from '@/hooks/useAuthRequired';
import { queryKeys } from '@/lib/queryKeys';
import {
  getSwapParty,
  getPartyItemsExtended,
  joinSwapParty,
  leaveSwapParty,
  isParticipant,
  addItemToParty,
  removeItemFromParty,
} from '@/services/swapService';
import { SwapPartyItemExtended, Article } from '@/types';
import { ArticlesService } from '@/services/articlesService';
import { colors, fonts, spacing } from '@/constants/theme';
import { Text } from '@/components/ui';
import SwapZoneFilters from '@/components/SwapZoneFilters';
import { useSwapFilters } from '@/hooks/useSwapFilters';

import {
  PartyHeader,
  MyArticlesSection,
  PartyActions,
  PartyItemCard,
  AddItemModal,
  MultiSelectBar,
  PartyEmptyGrid,
  SwapPartyDetailSkeleton,
} from '@/features/swap-party';

export default function SwapPartyDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const user = useUser();
  const { requireAuth } = useAuthRequired();
  const queryClient = useQueryClient();

  // React Query: party data + items
  const {
    data: partyData,
    isLoading: isPartyLoading,
    refetch: refetchParty,
  } = useQuery({
    queryKey: queryKeys.swapParties.detail(id || ''),
    queryFn: async () => {
      if (!id) return null;
      const [party, items] = await Promise.all([
        getSwapParty(id),
        getPartyItemsExtended(id),
      ]);
      let joined = false;
      if (user) {
        joined = await isParticipant(id, user.id);
      }
      return { party, items, joined };
    },
    enabled: !!id,
    staleTime: 10 * 60 * 1000,
  });

  const party = partyData?.party ?? null;
  const items = partyData?.items ?? [];
  const userItems = items.filter((item) => item.sellerId === user?.id);
  const isLoading = isPartyLoading;

  // Track join state locally for optimistic UI (overridden by query)
  const [isJoinedLocal, setIsJoinedLocal] = useState<boolean | null>(null);
  const isJoined = isJoinedLocal ?? partyData?.joined ?? false;

  // UI state
  const [showMyArticles, setShowMyArticles] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [isAddingItem, setIsAddingItem] = useState(false);

  // Multi-select state
  const [isMultiSelectMode, setIsMultiSelectMode] = useState(false);
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());

  // React Query: user's available articles
  const { data: myArticles = [] } = useQuery({
    queryKey: queryKeys.articles.userList(user?.id || ''),
    queryFn: async () => {
      if (!user) return [];
      const articles = await ArticlesService.getUserArticles(user.id);
      return articles.filter((a) => a.isActive !== false && !a.isSold);
    },
    enabled: !!user && (isJoined || showMyArticles),
    staleTime: 10 * 60 * 1000,
  });

  // Filters hook
  const {
    filteredItems,
    filters,
    setFilters,
    hasActiveFilters,
    clearFilters,
  } = useSwapFilters(items);

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

  // Invalidate party data to refresh
  const invalidatePartyData = useCallback(() => {
    if (id) {
      queryClient.invalidateQueries({ queryKey: queryKeys.swapParties.detail(id) });
    }
  }, [id, queryClient]);

  const handleRefresh = useCallback(() => {
    refetchParty();
  }, [refetchParty]);

  // Keep local join state in sync when query data changes
  useEffect(() => {
    if (partyData?.joined !== undefined) {
      setIsJoinedLocal(null);
    }
  }, [partyData?.joined]);

  const handleJoin = useCallback(async () => {
    if (!party) return;

    if (!user) {
      requireAuth(async () => {}, AUTH_MESSAGES.swapParty);
      return;
    }

    setIsJoining(true);
    try {
      await joinSwapParty(party.id, user.id, user.displayName || 'Utilisateur', user.profileImage);
      setIsJoinedLocal(true);
      invalidatePartyData();
    } catch (error) {
      if (__DEV__) console.error('Error joining party:', error);
      Alert.alert('Erreur', 'Impossible de rejoindre la party');
    } finally {
      setIsJoining(false);
    }
  }, [party, user, requireAuth, invalidatePartyData]);

  const handleLeave = useCallback(async () => {
    if (!user || !party) return;

    Alert.alert(
      'Quitter la party',
      'Es-tu sûr de vouloir quitter cette Swap Zone ? Tes articles seront retirés.',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Quitter',
          style: 'destructive',
          onPress: async () => {
            try {
              await leaveSwapParty(party.id, user.id);
              setIsJoinedLocal(false);
              invalidatePartyData();
            } catch (error) {
              if (__DEV__) console.error('Error leaving party:', error);
              Alert.alert('Erreur', 'Impossible de quitter la party');
            }
          },
        },
      ]
    );
  }, [user, party, invalidatePartyData]);

  const handleAddItem = useCallback(async (article: Article) => {
    if (!user || !party || isAddingItem) return;

    setIsAddingItem(true);
    try {
      await addItemToParty(party.id, article, user.id, user.displayName || 'Utilisateur', user.profileImage);
      invalidatePartyData();
      queryClient.invalidateQueries({ queryKey: queryKeys.articles.userList(user.id) });
    } catch (error) {
      if (__DEV__) console.error('Error adding item:', error);
      Alert.alert('Erreur', "Impossible d'ajouter l'article");
    } finally {
      setIsAddingItem(false);
    }
  }, [user, party, isAddingItem, invalidatePartyData, queryClient]);

  const handleRemoveItem = useCallback(async (articleId: string) => {
    if (!user || !party) return;

    Alert.alert(
      "Retirer l'article",
      'Es-tu sûr de vouloir retirer cet article de la Swap Zone ?',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Retirer',
          style: 'destructive',
          onPress: async () => {
            try {
              await removeItemFromParty(party.id, articleId, user.id);
              invalidatePartyData();
            } catch (error) {
              if (__DEV__) console.error('Error removing item:', error);
              Alert.alert('Erreur', "Impossible de retirer l'article");
            }
          },
        },
      ]
    );
  }, [user, party, invalidatePartyData]);

  // Handle item press with multi-select awareness
  const handleItemPress = useCallback((item: SwapPartyItemExtended) => {
    if (!user) {
      requireAuth(() => {}, AUTH_MESSAGES.swapParty);
      return;
    }

    if (isMultiSelectMode) {
      toggleItemSelection(item.id);
      return;
    }

    if (item.sellerId === user.id) {
      router.push(`/article/${item.articleId}` as never);
    } else {
      router.push({
        pathname: `/article/${item.articleId}` as never,
        params: {
          partyId: party?.id,
          swapItemId: item.id,
        },
      });
    }
  }, [user, isMultiSelectMode, toggleItemSelection, requireAuth, party?.id]);

  // Handle long press to enter multi-select mode
  const handleItemLongPress = useCallback((itemId: string) => {
    if (!isJoined) return;
    setIsMultiSelectMode(true);
    toggleItemSelection(itemId);
  }, [isJoined, toggleItemSelection]);

  // Handle propose swap with selected items
  const handleProposeMultipleSwaps = useCallback(() => {
    if (selectedItemIds.size === 0 || !party) return;

    router.push({
      pathname: '/propose-swap',
      params: {
        partyId: party.id,
        selectedItemIds: Array.from(selectedItemIds).join(','),
      },
    });
  }, [selectedItemIds, party]);

  const handleCancelMultiSelect = useCallback(() => {
    setIsMultiSelectMode(false);
    setSelectedItemIds(new Set());
  }, []);

  const handleBack = useCallback(() => {
    setIsMultiSelectMode(false);
    setSelectedItemIds(new Set());
    router.back();
  }, []);

  const handleShowMyArticles = useCallback(() => {
    setShowMyArticles(true);
  }, []);

  const handleCloseMyArticles = useCallback(() => {
    setShowMyArticles(false);
  }, []);

  // Render item for FlashList
  const renderItem = useCallback(({ item }: { item: SwapPartyItemExtended }) => (
    <PartyItemCard
      item={item}
      isSelected={selectedItemIds.has(item.id)}
      isMultiSelectMode={isMultiSelectMode}
      onPress={() => handleItemPress(item)}
      onLongPress={() => handleItemLongPress(item.id)}
    />
  ), [selectedItemIds, isMultiSelectMode, handleItemPress, handleItemLongPress]);

  const keyExtractor = useCallback((item: SwapPartyItemExtended) => item.id, []);

  // -- Loading state --
  if (isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <Stack.Screen options={{ headerShown: false }} />
        <SwapPartyDetailSkeleton />
      </SafeAreaView>
    );
  }

  // -- Error state --
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

  const otherItems = filteredItems.filter((item) => item.sellerId !== user?.id);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />

      <PartyHeader
        party={party}
        countdownDays={countdownDays}
        onBack={handleBack}
      />

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={isPartyLoading}
            onRefresh={handleRefresh}
            tintColor={colors.sage}
          />
        }
      >
        {isJoined && (
          <MyArticlesSection
            userItems={userItems}
            partyStatus={party.status}
            onAddPress={handleShowMyArticles}
            onRemoveItem={handleRemoveItem}
          />
        )}

        <PartyActions
          isJoined={isJoined}
          partyStatus={party.status}
          isJoining={isJoining}
          onJoin={handleJoin}
          onLeave={handleLeave}
        />

        {/* "Articles disponibles" label with count + filter button */}
        <View style={styles.gridLabelSection}>
          <Text style={styles.gridLabel}>
            Articles disponibles · {otherItems.length}
          </Text>
          <Pressable
            style={({ pressed }) => [styles.filterButton, pressed && { opacity: 0.7 }]}
            onPress={() => setShowFilters(true)}
          >
            <Ionicons name="options-outline" size={16} color={hasActiveFilters ? colors.sage : colors.muted} />
            {hasActiveFilters && <View style={styles.filterActiveDot} />}
          </Pressable>
        </View>

        {otherItems.length === 0 ? (
          <PartyEmptyGrid
            hasActiveFilters={hasActiveFilters}
            onClearFilters={clearFilters}
          />
        ) : (
          <>
            <FlashList
              data={otherItems}
              keyExtractor={keyExtractor}
              numColumns={2}
              scrollEnabled={false}
              contentContainerStyle={styles.gridContainer}
              renderItem={renderItem}
            />

            {isMultiSelectMode && (
              <MultiSelectBar
                selectedCount={selectedItemIds.size}
                canPropose={isJoined && userItems.length > 0}
                onCancel={handleCancelMultiSelect}
                onPropose={handleProposeMultipleSwaps}
              />
            )}
          </>
        )}
      </ScrollView>

      <AddItemModal
        visible={showMyArticles}
        articles={myArticles}
        userItems={userItems}
        onAddItem={handleAddItem}
        onClose={handleCloseMyArticles}
      />

      <SwapZoneFilters
        visible={showFilters}
        onClose={() => setShowFilters(false)}
        onApply={setFilters}
        initialFilters={filters}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
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
  gridLabelSection: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 14,
    marginBottom: 12,
  },
  filterButton: {
    width: 32,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
  filterActiveDot: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.sage,
  },
  gridLabel: {
    fontSize: 10,
    fontFamily: fonts.sansMedium,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: colors.muted,
  },
  gridContainer: {
    paddingHorizontal: 0,
    paddingVertical: 0,
    backgroundColor: colors.border,
  },
});
