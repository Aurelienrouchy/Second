/**
 * Swap Zone Screen — single, always-active generalist zone (DARK identity).
 *
 * Open to everyone (no join/leave). Authenticated users can deposit their own
 * articles (MyArticlesSection + AddItemSheet) and browse / filter everyone
 * else's items. Tapping an item of another seller starts a swap proposal
 * scoped to THAT seller; multi-select is constrained to a single vendor so the
 * proposed swap always involves exactly two users.
 *
 * Filtering uses the canonical SearchFilters stack (same bottom sheets as
 * app/search.tsx) applied client-side over the bounded zone stock.
 *
 * DS: dark canvas (colors.deep), charcoal gutters (colors.dark), light StatusBar.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  Pressable,
  RefreshControl,
  Alert,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { getColorItems } from '@/data/colors';
import { getMaterialItems } from '@/data/materials';

import { AUTH_MESSAGES } from '@/constants/authMessages';
import { useUser } from '@/contexts/AuthContext';
import { useAuthRequired } from '@/hooks/useAuthRequired';
import { queryKeys } from '@/lib/queryKeys';
import {
  getSwapParty,
  getPartyItemsExtended,
  addItemToParty,
  removeItemFromParty,
  GENERALIST_ZONE_ID,
} from '@/services/swapService';
import { ArticlesService } from '@/services/articlesService';
import { SwapPartyItemExtended, Article, SwapItemInfo } from '@/types';
import { colors, fonts, spacing, typography } from '@/constants/theme';
import { Text } from '@/components/ui';

import CategoryBottomSheet, { CategoryBottomSheetRef } from '@/components/CategoryBottomSheet';
import SelectionBottomSheet, { SelectionBottomSheetRef } from '@/components/SelectionBottomSheet';
import SizeSelectionSheet, { SizeSelectionSheetRef } from '@/components/SizeSelectionSheet';
import BrandSelectionSheet, { BrandSelectionSheetRef } from '@/components/search/BrandSelectionSheet';

import {
  FilterChipsRow,
  CONDITION_ITEMS,
  SORT_ITEMS,
  type FilterChip,
} from '@/features/search';
import {
  PartyHeader,
  MyArticlesSection,
  PartyItemCard,
  AddItemSheet,
  type AddItemSheetRef,
  MultiSelectBar,
  PartyEmptyGrid,
  SwapPartyDetailSkeleton,
  useSwapZoneFilters,
} from '@/features/swap-party';

// =============================================================================
// HELPERS
// =============================================================================

function toSwapItemInfo(item: SwapPartyItemExtended): SwapItemInfo {
  const info: SwapItemInfo = {
    articleId: item.articleId,
    title: item.title,
    price: item.price,
  };
  if (item.imageUrl) info.imageUrl = item.imageUrl;
  if (item.brand) info.brand = item.brand;
  if (item.size) info.size = item.size;
  return info;
}

// =============================================================================
// SCREEN
// =============================================================================

export default function SwapZoneScreen() {
  const partyId = GENERALIST_ZONE_ID;
  const user = useUser();
  const { requireAuth } = useAuthRequired();
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();

  // ── Bottom sheet refs (canonical filter stack) ──
  const categorySheetRef = useRef<CategoryBottomSheetRef>(null);
  const sizeSheetRef = useRef<SizeSelectionSheetRef>(null);
  const colorSheetRef = useRef<SelectionBottomSheetRef>(null);
  const brandSheetRef = useRef<BrandSelectionSheetRef>(null);
  const materialSheetRef = useRef<SelectionBottomSheetRef>(null);
  const conditionSheetRef = useRef<SelectionBottomSheetRef>(null);
  const sortSheetRef = useRef<SelectionBottomSheetRef>(null);
  const addItemSheetRef = useRef<AddItemSheetRef>(null);

  // ── React Query: party data + items ──
  const {
    data: partyData,
    isLoading: isPartyLoading,
    isError,
    refetch: refetchParty,
    isRefetching,
  } = useQuery({
    queryKey: queryKeys.swapParties.detail(partyId),
    queryFn: async () => {
      const [party, items] = await Promise.all([
        getSwapParty(partyId),
        getPartyItemsExtended(partyId),
      ]);
      return { party, items };
    },
    staleTime: 10 * 60 * 1000,
  });

  const party = partyData?.party ?? null;
  const items = useMemo(() => partyData?.items ?? [], [partyData?.items]);
  const userItems = useMemo(
    () => items.filter((item) => item.sellerId === user?.id),
    [items, user?.id]
  );

  // ── UI state ──
  const [depositOpened, setDepositOpened] = useState(false);
  const [isAddingItem, setIsAddingItem] = useState(false);

  // ── Multi-select state (scoped to one seller) ──
  const [isMultiSelectMode, setIsMultiSelectMode] = useState(false);
  const [selectedSellerId, setSelectedSellerId] = useState<string | null>(null);
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());

  // ── Filter sheet conditional-mount (Android touch-veil fix #701) ──
  // The 7 filter sheets are @gorhom BottomSheets. We mount AT MOST ONE filter
  // sheet at a time and ONLY while it should be open: the effect below shows it
  // right after mount, and the nonce makes re-tapping the SAME chip re-open the
  // sheet (dep changes each tap). At rest (openSheet === null) no filter sheet
  // is in the tree — this removes the gorhom portal container so no full-screen
  // overlay lingers to capture touches on the FlashList (the Android #701 veil).
  const [openSheet, setOpenSheet] = useState<{ name: string; nonce: number } | null>(null);
  const openFilterSheet = useCallback(
    (name: string) => setOpenSheet((p) => ({ name, nonce: (p?.nonce ?? 0) + 1 })),
    []
  );
  const closeFilterSheet = useCallback(() => setOpenSheet(null), []);

  // ── React Query: user's available articles (for the deposit modal) ──
  const { data: myArticles = [], isLoading: isLoadingMyArticles } = useQuery({
    queryKey: queryKeys.articles.userList(user?.id || ''),
    queryFn: async () => {
      if (!user) return [];
      const articles = await ArticlesService.getUserArticles(user.id);
      return articles.filter((a) => a.isActive !== false && !a.isSold);
    },
    enabled: !!user && depositOpened,
    staleTime: 10 * 60 * 1000,
  });

  // ── Canonical filters (client-side over bounded stock) ──
  const f = useSwapZoneFilters(items);

  // Items of other sellers, after filtering.
  const otherItems = useMemo(
    () => f.filteredItems.filter((item) => item.sellerId !== user?.id),
    [f.filteredItems, user?.id]
  );

  // ── Mutators ──
  const invalidatePartyData = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: queryKeys.swapParties.detail(partyId) });
  }, [queryClient, partyId]);

  const handleRefresh = useCallback(() => {
    refetchParty();
  }, [refetchParty]);

  const handleAddItems = useCallback(
    async (articles: Article[]) => {
      if (!user || !party || isAddingItem || articles.length === 0) return;
      setIsAddingItem(true);
      try {
        await Promise.all(
          articles.map((article) =>
            addItemToParty(
              party.id,
              article,
              user.id,
              user.displayName || 'Utilisateur',
              user.profileImage
            )
          )
        );
        invalidatePartyData();
        queryClient.invalidateQueries({ queryKey: queryKeys.articles.userList(user.id) });
      } catch (error) {
        if (__DEV__) console.error('Error adding items:', error);
        Alert.alert('Erreur', "Impossible d'ajouter les articles");
      } finally {
        setIsAddingItem(false);
      }
    },
    [user, party, isAddingItem, invalidatePartyData, queryClient]
  );

  const handleRemoveItem = useCallback(
    (articleId: string) => {
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
    },
    [user, party, invalidatePartyData]
  );

  // ── Multi-select (single-vendor) ──
  const toggleItemSelection = useCallback((item: SwapPartyItemExtended) => {
    setSelectedItemIds((prev) => {
      const next = new Set(prev);
      if (next.has(item.id)) {
        next.delete(item.id);
      } else {
        next.add(item.id);
      }
      if (next.size === 0) {
        setIsMultiSelectMode(false);
        setSelectedSellerId(null);
      }
      return next;
    });
  }, []);

  const handleItemPress = useCallback(
    (item: SwapPartyItemExtended) => {
      if (!user) {
        requireAuth(() => {}, AUTH_MESSAGES.swapParty);
        return;
      }

      // In multi-select, only items of the chosen seller can be toggled.
      if (isMultiSelectMode) {
        if (selectedSellerId && item.sellerId !== selectedSellerId) return;
        toggleItemSelection(item);
        return;
      }

      // Single tap on someone else's item → start a scoped swap proposal.
      router.push({
        pathname: '/propose-swap',
        params: {
          partyId,
          receiverId: item.sellerId,
          receiverName: item.sellerName || '',
          receiverImage: item.sellerImage || '',
          receiverItems: JSON.stringify([toSwapItemInfo(item)]),
        },
      });
    },
    [user, isMultiSelectMode, selectedSellerId, toggleItemSelection, requireAuth, partyId]
  );

  const handleItemLongPress = useCallback(
    (item: SwapPartyItemExtended) => {
      if (!user) {
        requireAuth(() => {}, AUTH_MESSAGES.swapParty);
        return;
      }
      // Long-press locks the multi-select to this seller.
      setIsMultiSelectMode(true);
      setSelectedSellerId(item.sellerId);
      setSelectedItemIds(new Set([item.id]));
    },
    [user, requireAuth]
  );

  const handleProposeMultipleSwaps = useCallback(() => {
    if (selectedItemIds.size === 0 || !selectedSellerId) return;

    const picked = otherItems.filter((item) => selectedItemIds.has(item.id));
    if (picked.length === 0) return;

    const receiver = picked[0];
    router.push({
      pathname: '/propose-swap',
      params: {
        partyId,
        receiverId: selectedSellerId,
        receiverName: receiver.sellerName || '',
        receiverImage: receiver.sellerImage || '',
        receiverItems: JSON.stringify(picked.map(toSwapItemInfo)),
      },
    });
  }, [selectedItemIds, selectedSellerId, otherItems, partyId]);

  const handleCancelMultiSelect = useCallback(() => {
    setIsMultiSelectMode(false);
    setSelectedSellerId(null);
    setSelectedItemIds(new Set());
  }, []);

  const handleBack = useCallback(() => {
    handleCancelMultiSelect();
    router.back();
  }, [handleCancelMultiSelect]);

  // Open the deposit sheet by mounting it (depositOpened). The actual present()
  // happens in the effect below once the modal is mounted — this guarantees the
  // BottomSheetModal (and its full-screen portal hosting container) only exists
  // in the tree while open, so it never lingers as a touch-capturing veil on
  // Android.
  const handleShowMyArticles = useCallback(() => {
    // The deposit entry is always visible (even logged-out) so the "add your
    // articles" affordance can never disappear. A logged-out tap routes through
    // the canonical auth gate, mirroring handleItemPress.
    if (!user) {
      requireAuth(() => setDepositOpened(true), AUTH_MESSAGES.swapParty);
      return;
    }
    setDepositOpened(true);
  }, [user, requireAuth]);

  // Present the modal right after it mounts (when depositOpened flips to true).
  useEffect(() => {
    if (depositOpened) {
      addItemSheetRef.current?.show();
    }
  }, [depositOpened]);

  // Unmount the sheet once it is fully dismissed → removes the portal host.
  const handleDepositClose = useCallback(() => {
    setDepositOpened(false);
  }, []);

  // Show the freshly-mounted filter sheet. Runs on every openSheet change
  // (the nonce guarantees re-fire when the same chip is tapped again).
  useEffect(() => {
    if (!openSheet) return;
    switch (openSheet.name) {
      case 'sort':
        sortSheetRef.current?.show();
        break;
      case 'category':
        categorySheetRef.current?.show();
        break;
      case 'sizes':
        sizeSheetRef.current?.show();
        break;
      case 'colors':
        colorSheetRef.current?.show();
        break;
      case 'brands':
        brandSheetRef.current?.show();
        break;
      case 'materials':
        materialSheetRef.current?.show();
        break;
      case 'condition':
        conditionSheetRef.current?.show();
        break;
    }
  }, [openSheet]);

  // ── Filter chips (order: Trier, Catégorie, Taille, Couleur, Marque, Matière, État) ──
  const filterChips: FilterChip[] = [
    { key: 'sort', label: f.getSortLabel(), active: f.isSortActive, onPress: () => openFilterSheet('sort') },
    { key: 'category', label: f.getCategoryLabel(), active: f.isCategoryActive, onPress: () => openFilterSheet('category') },
    { key: 'sizes', label: f.getSizeLabel(), active: f.isSizeActive, onPress: () => openFilterSheet('sizes') },
    { key: 'colors', label: f.getColorLabel(), active: f.isColorActive, onPress: () => openFilterSheet('colors') },
    { key: 'brands', label: f.getBrandLabel(), active: f.isBrandActive, onPress: () => openFilterSheet('brands') },
    { key: 'materials', label: f.getMaterialLabel(), active: f.isMaterialActive, onPress: () => openFilterSheet('materials') },
    { key: 'condition', label: f.getConditionLabelText(), active: f.isConditionActive, onPress: () => openFilterSheet('condition') },
  ];

  // ── FlashList helpers ──
  const renderItem = useCallback(
    ({ item }: { item: SwapPartyItemExtended }) => (
      <PartyItemCard
        item={item}
        tone="dark"
        isSelected={selectedItemIds.has(item.id)}
        isMultiSelectMode={isMultiSelectMode}
        disabled={isMultiSelectMode && !!selectedSellerId && item.sellerId !== selectedSellerId}
        onPress={() => handleItemPress(item)}
        onLongPress={() => handleItemLongPress(item)}
      />
    ),
    [selectedItemIds, isMultiSelectMode, selectedSellerId, handleItemPress, handleItemLongPress]
  );

  const keyExtractor = useCallback((item: SwapPartyItemExtended) => item.id, []);

  // ── List header (everything above the grid lives here so the FlashList stays
  //    the single scrollable container — no nesting in a ScrollView). Memoized
  //    element (not an inline-identity function) to avoid header re-creation. ──
  const listHeader = useMemo(
    () => (
      <View>
        <Text style={styles.subtitle}>Échangez vos pièces, sans frais.</Text>

        {/* Always rendered (even logged-out) so the deposit affordance can never
            disappear; onAddPress routes through requireAuth when no user. */}
        <MyArticlesSection
          userItems={userItems}
          onAddPress={handleShowMyArticles}
          onRemoveItem={handleRemoveItem}
        />

        {/* Filter chips (dark tone) */}
        <FilterChipsRow chips={filterChips} tone="dark" />

        {/* Grid label */}
        <View style={styles.gridLabelSection}>
          <Text style={styles.gridLabel}>Articles disponibles · {otherItems.length}</Text>
        </View>
      </View>
    ),
    [userItems, handleShowMyArticles, handleRemoveItem, filterChips, otherItems.length]
  );

  const listEmpty = useMemo(
    () => <PartyEmptyGrid hasActiveFilters={f.hasActiveFilters} onClearFilters={f.clearFilters} />,
    [f.hasActiveFilters, f.clearFilters]
  );

  // ── Loading ──
  if (isPartyLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <Stack.Screen options={{ headerShown: false }} />
        <StatusBar style="light" />
        <SwapPartyDetailSkeleton />
      </SafeAreaView>
    );
  }

  // ── Error / not found ──
  if (isError || !party) {
    return (
      <SafeAreaView style={styles.container}>
        <Stack.Screen options={{ headerShown: false }} />
        <StatusBar style="light" />
        <View style={styles.errorContainer}>
          <Text style={styles.errorTitle}>Swap Zone indisponible</Text>
          <Text style={styles.errorSubtitle}>Vérifiez votre connexion et réessayez.</Text>
          <Pressable
            style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
            onPress={() => refetchParty()}
          >
            <Text style={styles.retryButtonText}>Réessayer</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <StatusBar style="light" />

      <PartyHeader party={party} onBack={handleBack} />

      {/* FlashList is the single scrollable container of the screen (canonical
          pattern). All non-grid content lives in ListHeaderComponent; the
          empty state in ListEmptyComponent; MultiSelectBar is an absolute
          overlay (sibling of the list) so it never participates in scroll.
          Wrapped in a flex:1 View so the list always has a bounded height
          (defensive, matches app/visual-search-results.tsx). */}
      <View style={styles.listWrapper}>
        <FlashList
          data={otherItems}
          keyExtractor={keyExtractor}
          numColumns={2}
          renderItem={renderItem}
          ListHeaderComponent={listHeader}
          ListEmptyComponent={listEmpty}
          contentContainerStyle={styles.gridContainer}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={handleRefresh}
              tintColor={colors.sand}
            />
          }
        />
      </View>

      {isMultiSelectMode && (
        <View
          style={[styles.multiSelectOverlay, { paddingBottom: insets.bottom }]}
          pointerEvents="box-none"
        >
          <MultiSelectBar
            selectedCount={selectedItemIds.size}
            canPropose={selectedItemIds.size > 0}
            onCancel={handleCancelMultiSelect}
            onPropose={handleProposeMultipleSwaps}
          />
        </View>
      )}

      {/* Deposit sheet is a BottomSheetModal: mount it ONLY while open so its
          portal hosting container (StyleSheet.absoluteFill) is removed when
          closed and never captures touches over the FlashList on Android. */}
      {depositOpened && (
        <AddItemSheet
          ref={addItemSheetRef}
          articles={myArticles}
          userItems={userItems}
          loading={isLoadingMyArticles}
          onAddItems={handleAddItems}
          onClose={handleDepositClose}
        />
      )}

      {/* ── Canonical filter bottom sheets (standard light overlays) ──
          Conditional-mount: AT MOST ONE is in the tree, and only while it
          should be open (mounted by a chip tap, shown via the effect above,
          unmounted on selection via closeFilterSheet). At rest none exist →
          no permanent backdrop veil on Android. Pan-down / backdrop dismiss
          leaves the sheet mounted-but-closed (backdrop already at "none",
          inoffensive); it is unmounted on the next chip tap. */}
      {openSheet?.name === 'sort' && (
        <SelectionBottomSheet
          ref={sortSheetRef}
          title="Trier par"
          items={SORT_ITEMS}
          selectedValue={f.selectedSort}
          onSelect={(v) => {
            f.handleSortSelect(v);
            closeFilterSheet();
          }}
        />
      )}

      {openSheet?.name === 'category' && (
        <CategoryBottomSheet
          ref={categorySheetRef}
          onSelect={(ids) => {
            f.handleCategorySelect(ids);
            closeFilterSheet();
          }}
          selectedCategoryIds={f.selectedCategoryPath}
        />
      )}

      {openSheet?.name === 'sizes' && (
        <SizeSelectionSheet
          ref={sizeSheetRef}
          selectedSizes={f.filters.sizes || []}
          onConfirm={(s) => {
            f.handleSizesConfirm(s);
            closeFilterSheet();
          }}
          categoryPath={f.selectedCategoryPath}
        />
      )}

      {openSheet?.name === 'colors' && (
        <SelectionBottomSheet
          ref={colorSheetRef}
          title="Couleur"
          items={getColorItems()}
          selectedValue={f.filters.colors?.[0]}
          selectedValues={f.filters.colors || []}
          onSelect={f.handleColorSelect}
          onSelectMultiple={(v) => {
            f.handleColorsConfirm(v);
            closeFilterSheet();
          }}
          type="color"
          multiSelect
        />
      )}

      {openSheet?.name === 'brands' && (
        <BrandSelectionSheet
          ref={brandSheetRef}
          selectedBrands={f.filters.brands || []}
          onConfirm={(b) => {
            f.handleBrandsConfirm(b);
            closeFilterSheet();
          }}
        />
      )}

      {openSheet?.name === 'materials' && (
        <SelectionBottomSheet
          ref={materialSheetRef}
          title="Matière"
          items={getMaterialItems()}
          selectedValue={f.filters.materials?.[0]}
          selectedValues={f.filters.materials || []}
          onSelect={f.handleMaterialSelect}
          onSelectMultiple={(v) => {
            f.handleMaterialsConfirm(v);
            closeFilterSheet();
          }}
          multiSelect
        />
      )}

      {openSheet?.name === 'condition' && (
        <SelectionBottomSheet
          ref={conditionSheetRef}
          title="État"
          items={CONDITION_ITEMS}
          selectedValue={f.filters.condition}
          onSelect={(v) => {
            f.handleConditionSelect(v);
            closeFilterSheet();
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.deep,
  },
  listWrapper: {
    flex: 1,
  },
  pressed: {
    opacity: 0.7,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
  },
  errorTitle: {
    fontFamily: typography.h2.fontFamily,
    fontSize: typography.h2.fontSize,
    lineHeight: typography.h2.lineHeight,
    letterSpacing: typography.h2.letterSpacing,
    color: colors.cream,
    textAlign: 'center',
  },
  errorSubtitle: {
    fontFamily: typography.bodySmall.fontFamily,
    fontSize: typography.bodySmall.fontSize,
    lineHeight: typography.bodySmall.lineHeight,
    letterSpacing: typography.bodySmall.letterSpacing,
    color: colors.whiteTranslucent,
    textAlign: 'center',
  },
  retryButton: {
    marginTop: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderWidth: 1,
    borderColor: colors.rust,
  },
  retryButtonText: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: colors.rust,
  },
  multiSelectOverlay: {
    // Positions the bar at the bottom only. No background here: the visible
    // surface comes from MultiSelectBar itself (which returns null when nothing
    // is selected), and the container stays pointerEvents="box-none" so it never
    // captures touches outside the bar.
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
  subtitle: {
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.whiteTranslucent,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.sm,
  },
  gridLabelSection: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.darkSurface1,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.darkBorder,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    marginBottom: spacing.sm + 4,
  },
  gridLabel: {
    fontSize: 10,
    fontFamily: fonts.sansMedium,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: colors.sand,
  },
  gridContainer: {
    paddingHorizontal: 0,
    paddingTop: 0,
    paddingBottom: spacing['4xl'] + spacing['2xl'],
    backgroundColor: colors.deep,
  },
});
