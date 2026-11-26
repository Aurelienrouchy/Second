import { useSwapZoneFilters } from '@/features/swap/hooks/useSwapZoneFilters';
import { useSwapDepositArticles } from '@/features/swap/hooks/useSwapDepositArticles';
/**
 * Le Troc — single, always-active exchange catalogue.
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
 * DS: cream canvas, graphic sans typography, terracotta actions.
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  View,
  StyleSheet,
  Pressable,
  RefreshControl,
  Alert,
  BackHandler,
  useWindowDimensions,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import {
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import {
  Stack,
  router,
  useLocalSearchParams,
  useFocusEffect,
} from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { Button , Text } from '@/components/ui';
import { track } from '@/lib/analytics';

import { getColorItems } from '@/data/colors';
import { getMaterialItems } from '@/data/materials';

import { AUTH_MESSAGES } from '@/constants/authMessages';
import { useUser, useAuthenticatedUid } from '@/hooks/useAuth';
import { useLabelLifecycleContext } from '@/hooks/useLabelLifecycleContext';
import { EligibilityService } from '@/services/eligibilityService';
import { useAuthSheetStore } from '@/store/authSheetStore';
import { useRequireAuth } from '@/hooks/useAuthRequired';
import { queryKeys } from '@/lib/queryKeys';
import {
  getSwapParty,
  getPartyItemsExtended,
  addItemToParty,
  removeItemFromParty,
  GENERALIST_ZONE_ID,
} from '@/services/swapService';
import { SwapPartyItemExtended, Article } from '@/types';
import {
  colors,
  spacing,
  typography,
  sizing,
  radius,
  components,
} from '@/constants/theme';

import CategoryBottomSheet, {
  CategoryBottomSheetRef,
} from '@/components/CategoryBottomSheet';
import SelectionBottomSheet, {
  SelectionBottomSheetRef,
} from '@/components/SelectionBottomSheet';
import SizeSelectionSheet, {
  SizeSelectionSheetRef,
} from '@/components/SizeSelectionSheet';
import BrandSelectionSheet, {
  BrandSelectionSheetRef,
} from '@/components/BrandSelectionSheet';

import {
  CONDITION_ITEMS,
  SORT_ITEMS,
  type FilterChip,
} from '@/features/search';
import {
  PartyHeader,
  SwapLaunchAdmissionSheet,
  TrocFilterRow,
  MyArticlesSection,
  PartyItemCard,
  AddItemSheet,
  type AddItemSheetRef,
  MultiSelectBar,
  PartyEmptyGrid,
  SwapPartyDetailSkeleton,
} from '@/features/swap';

// =============================================================================
// TYPES
// =============================================================================

// Shape of the React Query cache entry for queryKeys.swapParties.detail(partyId)
// — mirrors the queryFn return below. Typed explicitly so getQueryData /
// setQueryData (optimistic removal + rollback) are type-safe, no `any`.
type PartyDetailData = {
  party: Awaited<ReturnType<typeof getSwapParty>>;
  items: SwapPartyItemExtended[];
};

// =============================================================================
// HELPERS
// =============================================================================

// =============================================================================
// SCREEN
// =============================================================================

const SWAP_ZONE_SOURCES = [
  'home',
  'profile',
  'my_swaps_empty',
  'deep_link',
] as const;
type SwapZoneSource = (typeof SWAP_ZONE_SOURCES)[number];

export default function SwapZoneScreen() {
  const { width, fontScale } = useWindowDimensions();
  const columns =
    width < components.troc.compactWidth ||
    fontScale > components.troc.largeFontScale
      ? 1
      : 2;
  const partyId = GENERALIST_ZONE_ID;
  const { source: sourceParam } = useLocalSearchParams<{ source?: string }>();
  const viewSource: SwapZoneSource = SWAP_ZONE_SOURCES.includes(
    sourceParam as SwapZoneSource,
  )
    ? (sourceParam as SwapZoneSource)
    : 'deep_link';
  const user = useUser();
  const uid = useAuthenticatedUid();
  const [admissionOpen, setAdmissionOpen] = useState(false);
  const depositContext = useLabelLifecycleContext(`troc-deposit:${partyId}`, uid);
  const { requireAuth } = useRequireAuth();
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
    [items, user?.id],
  );

  // Fire swap_zone_viewed once, when the initial load resolves (loaded or error).
  const viewedRef = useRef(false);
  useEffect(() => {
    if (isPartyLoading || viewedRef.current) return;
    viewedRef.current = true;
    if (isError || !party) {
      track('swap_zone_viewed', { outcome: 'error', source: viewSource });
      return;
    }
    track('swap_zone_viewed', {
      outcome: 'loaded',
      source: viewSource,
      total_items_count: items.length,
      my_items_count: userItems.length,
      other_items_count: items.length - userItems.length,
    });
  }, [isPartyLoading, isError, party, items, userItems.length, viewSource]);

  // ── UI state ──
  const [depositOpened, setDepositOpened] = useState(false);
  const [isAddingItem, setIsAddingItem] = useState(false);
  const addingRef = useRef(false);
  const removalRef = useRef<Set<string>>(new Set());
  const [removing, setRemoving] = useState<{frame: symbol; ids: Set<string>} | null>(null);
  const depositRef = useRef(false);
  const navigatingRef = useRef(false);
  const currentUserRef = useRef(user);
  useEffect(() => {
    currentUserRef.current = user;
  }, [user]);
  const [multiSelectHeight, setMultiSelectHeight] = useState(0);
  useFocusEffect(
    useCallback(() => {
      navigatingRef.current = false;
    }, []),
  );
  // Count of articles currently being deposited — drives the skeleton rows in
  // MyArticlesSection until invalidatePartyData refetch surfaces the real items.
  const [pendingAddCount, setPendingAddCount] = useState(0);

  // ── Multi-select state (scoped to one seller) ──
  const [isMultiSelectMode, setIsMultiSelectMode] = useState(false);
  const [selectedSellerId, setSelectedSellerId] = useState<string | null>(null);
  const selectedSellerRef = useRef<string | null>(null);
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(
    new Set(),
  );

  // ── Filter sheet conditional-mount (Android touch-veil fix #701) ──
  // The 7 filter sheets are @gorhom BottomSheets. We mount AT MOST ONE filter
  // sheet at a time and ONLY while it should be open: the effect below shows it
  // right after mount, and the nonce makes re-tapping the SAME chip re-open the
  // sheet (dep changes each tap). At rest (openSheet === null) no filter sheet
  // is in the tree — this removes the gorhom portal container so no full-screen
  // overlay lingers to capture touches on the FlashList (the Android #701 veil).
  const [openSheet, setOpenSheet] = useState<{
    name: string;
    nonce: number;
  } | null>(null);
  const openFilterSheet = useCallback(
    (name: string) =>
      setOpenSheet((p) => ({ name, nonce: (p?.nonce ?? 0) + 1 })),
    [],
  );
  const closeFilterSheet = useCallback(() => setOpenSheet(null), []);

  // Refresh inventory on every deposit opening, including after publication.
  // Keep filtering outside the query so its cached result remains complete.
  const {
    data: myArticlesAll = [],
    isLoading: isLoadingMyArticles,
    isFetching: isRefreshingMyArticles,
    isError: myArticlesError,
    refetch: refetchMyArticles,
  } = useSwapDepositArticles(uid, depositOpened);
  const myArticles = myArticlesAll.filter(
    (a) => a.isActive !== false && !a.isSold,
  );

  // ── Canonical filters (client-side over bounded stock) ──
  const f = useSwapZoneFilters(items);

  // Items of other sellers, after filtering.
  const otherItems = useMemo(
    () => f.filteredItems.filter((item) => item.sellerId !== user?.id),
    [f.filteredItems, user?.id],
  );

  // Effective multi-select count: only items STILL present in the proposable
  // stock (otherItems) count. Deriving the bar's count from the raw
  // selectedItemIds.size would stay inflated when a selected item leaves the
  // filter, letting an empty proposal slip through (the proposal itself already
  // intersects with otherItems in handleProposeMultipleSwaps). Mirror that
  // intersection here so the displayed count and the propose-enabled state can
  // never disagree with what would actually be sent.
  const selectedCount = useMemo(
    () =>
      otherItems.reduce(
        (acc, item) => (selectedItemIds.has(item.id) ? acc + 1 : acc),
        0,
      ),
    [otherItems, selectedItemIds],
  );

  // ── Mutators ──
  const invalidatePartyData = useCallback(() => {
    // Returns the promise so callers can await the refetch (keeps the add
    // skeleton visible until the real item lands — no empty-gap flash).
    return queryClient.invalidateQueries({
      queryKey: queryKeys.swapParties.detail(partyId),
    });
  }, [queryClient, partyId]);

  // Dedicated pull-to-refresh state. The RefreshControl is bound to THIS, not to
  // React Query's generic `isRefetching`, so programmatic refetches (after an
  // add / delete / filter) don't pop the refresh spinner and jolt the scroll —
  // only an explicit user pull shows it.
  const [isManualRefreshing, setIsManualRefreshing] = useState(false);
  const handleRefresh = useCallback(async () => {
    setIsManualRefreshing(true);
    track('list_refreshed', { screen: 'swap_zone', items_count: items.length });
    try {
      await refetchParty();
    } finally {
      setIsManualRefreshing(false);
    }
  }, [refetchParty, items.length]);

  const handleAddItems = useCallback(
    async (articles: Article[]) => {
      if (!user || !party || addingRef.current || articles.length === 0) return;
      let operation: ReturnType<typeof depositContext.capture>;
      try {operation = depositContext.capture();} catch {return;}
      addingRef.current = true;
      setIsAddingItem(true);
      setPendingAddCount(articles.length);
      const articleIds = articles.map((a) => a.id);
      const totalValueCents = Math.round(
        articles.reduce((sum, a) => sum + (a.price || 0), 0) * 100,
      );
      try {
        const assertCurrent = () => depositContext.assertCurrent(operation);
        const eligibility = await EligibilityService.getMine(operation.base.session.uid);
        assertCurrent();
        if (eligibility.swapLaunch?.allowed !== true) {
          setDepositOpened(false); setAdmissionOpen(true); return;
        }
        await Promise.all(
          articles.map((article) =>
            addItemToParty(
              party.id,
              article,
              user.id,
              user.displayName || 'Utilisateur',
              user.profileImage,
              assertCurrent,
            ),
          ),
        );
        assertCurrent();
        // Await the party refetch so the skeleton rows stay until the real
        // items are loaded — the skeleton swaps straight to the article with
        // no intermediate empty gap.
        await invalidatePartyData();
        assertCurrent();
        queryClient.invalidateQueries({
          queryKey: queryKeys.articles.userList(user.id),
        });
        track('swap_items_deposited', {
          articles_count: articles.length,
          article_ids: articleIds,
          total_value_cents: totalValueCents,
          outcome: 'success',
        });
      } catch (error) {
        if (!depositContext.isCurrent(operation)) return;
        // A batch may have committed some deposits before another reply failed.
        void invalidatePartyData();
        if (__DEV__) console.error('Error adding items:', error);
        track('swap_items_deposited', {
          articles_count: articles.length,
          article_ids: articleIds,
          total_value_cents: totalValueCents,
          outcome: 'error',
        });
        Alert.alert(
          'Ajout non confirmé',
          'Actualisez Le Troc pour voir les articles ajoutés avant de réessayer.',
        );
      } finally {
        addingRef.current = false;
        setIsAddingItem(false);
        setPendingAddCount(0);
      }
    },
    [user, party, invalidatePartyData, queryClient, depositContext],
  );

  const handleRemoveItem = useCallback((articleId: string) => {
    if (!user || !party || removalRef.current.has(articleId)) return;
    let operation: ReturnType<typeof depositContext.capture>;
    try {operation = depositContext.capture();} catch {return;}
    removalRef.current.add(articleId);
    let dispatched = false;
    const cancel = () => {if (!dispatched) removalRef.current.delete(articleId);};
    Alert.alert("Retirer l'article", 'Voulez-vous retirer cet article du Troc ? Il restera dans votre garde-robe.', [
      {text: 'Annuler', style: 'cancel', onPress: cancel},
      {text: 'Retirer', style: 'destructive', onPress: async () => {
        if (dispatched) return;
        try {depositContext.assertCurrent(operation);} catch {cancel(); return;}
        dispatched = true;
        setRemoving(previous => ({frame: depositContext.frame, ids: new Set([...(previous?.frame === depositContext.frame ? previous.ids : []), articleId])}));
        try {
          await removeItemFromParty(party.id, articleId, operation.base.session.uid, () => depositContext.assertCurrent(operation));
          depositContext.assertCurrent(operation);
          queryClient.setQueryData<PartyDetailData>(queryKeys.swapParties.detail(partyId), old => old ? {
            ...old, items: old.items.filter(item => !(item.articleId === articleId && item.sellerId === operation.base.session.uid)),
          } : old);
          track('swap_item_removed', {article_id: articleId, outcome: 'success'});
        } catch {
          if (depositContext.isCurrent(operation)) {
            track('swap_item_removed', {article_id: articleId, outcome: 'error'});
            Alert.alert('Retrait non confirmé', 'Actualisez Le Troc pour connaître le résultat avant de réessayer.');
            void invalidatePartyData();
          }
        } finally {
          removalRef.current.delete(articleId);
          setRemoving(previous => {
            if (previous?.frame !== operation.base.frame) return previous;
            const ids = new Set(previous.ids); ids.delete(articleId); return {...previous, ids};
          });
        }
      }},
    ], {cancelable: true, onDismiss: cancel});
  }, [user, party, partyId, queryClient, depositContext, invalidatePartyData]);

  // ── Multi-select (single-vendor) ──
  const toggleItemSelection = useCallback((item: SwapPartyItemExtended) => {
    setSelectedItemIds((prev) => {
      const next = new Set(prev);
      if (next.has(item.id)) {
        next.delete(item.id);
      } else {
        if (next.size >= 20) return prev;
        next.add(item.id);
      }
      if (next.size === 0) {
        setIsMultiSelectMode(false);
        setSelectedSellerId(null);
        selectedSellerRef.current = null;
      }
      return next;
    });
  }, []);

  const handleItemPress = useCallback(
    (item: SwapPartyItemExtended) => {
      // Single tap on someone else's item → start a scoped swap proposal.
      const proposeSwap = () => {
        if (
          navigatingRef.current ||
          item.sellerId === currentUserRef.current?.id
        )
          return;
        navigatingRef.current = true;
        router.push({
          pathname: '/propose-swap',
          params: {
            partyId,
            receiverId: item.sellerId,
            receiverName: item.sellerName || '',
            receiverArticleIds: JSON.stringify([item.articleId]),
          },
        });
      };

      if (!user) {
        // Logged-out tap routes through the auth gate, then completes the swap
        // proposal once authenticated (no second tap required).
        requireAuth(proposeSwap, AUTH_MESSAGES.swapParty);
        return;
      }

      // In multi-select, only items of the chosen seller can be toggled.
      if (isMultiSelectMode) {
        if (
          selectedSellerRef.current &&
          item.sellerId !== selectedSellerRef.current
        )
          return;
        if (!selectedSellerRef.current) {
          setSelectedSellerId(item.sellerId);
          selectedSellerRef.current = item.sellerId;
          track('swap_multi_select_started', {
            seller_id: item.sellerId,
            item_id: item.id,
          });
        }
        toggleItemSelection(item);
        return;
      }

      proposeSwap();
    },
    [
      user,
      isMultiSelectMode,
      toggleItemSelection,
      requireAuth,
      partyId,
    ],
  );

  const handleItemLongPress = useCallback(
    (item: SwapPartyItemExtended) => {
      const beginSelection = () => {
        if (item.sellerId === currentUserRef.current?.id) return;
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        track('swap_multi_select_started', {
          seller_id: item.sellerId,
          item_id: item.id,
        });
        setIsMultiSelectMode(true);
        setSelectedSellerId(item.sellerId);
        selectedSellerRef.current = item.sellerId;
        setSelectedItemIds(new Set([item.id]));
      };
      if (!user) {
        requireAuth(beginSelection, AUTH_MESSAGES.swapParty);
        return;
      }
      // Long-press locks the multi-select to this seller. Medium impact marks
      // the deliberate mode switch (harmonized with FilterChipsRow's haptics).
      beginSelection();
    },
    [user, requireAuth],
  );

  const handleBeginSelection = useCallback(() => {
    const beginSelection = () => {
      setSelectedSellerId(null);
      selectedSellerRef.current = null;
      setSelectedItemIds(new Set());
      setIsMultiSelectMode(true);
    };
    if (!user) requireAuth(beginSelection, AUTH_MESSAGES.swapParty);
    else beginSelection();
  }, [user, requireAuth]);

  const handleProposeMultipleSwaps = useCallback(() => {
    if (
      navigatingRef.current ||
      selectedItemIds.size === 0 || selectedItemIds.size > 20 ||
      !selectedSellerId
    )
      return;

    const picked = otherItems.filter(
      (item) =>
        selectedItemIds.has(item.id) && item.sellerId === selectedSellerId,
    );
    if (picked.length === 0) return;

    const receiver = picked[0];
    navigatingRef.current = true;
    router.push({
      pathname: '/propose-swap',
      params: {
        partyId,
        receiverId: selectedSellerId,
        receiverName: receiver.sellerName || '',
        receiverArticleIds: JSON.stringify(picked.map(item => item.articleId)),
      },
    });
  }, [selectedItemIds, selectedSellerId, otherItems, partyId]);

  const handleCancelMultiSelect = useCallback(() => {
    setIsMultiSelectMode(false);
    setSelectedSellerId(null);
    selectedSellerRef.current = null;
    setSelectedItemIds(new Set());
  }, []);

  // Android hardware back: while multi-select is active, the back button cancels
  // the selection instead of leaving the screen (mirrors the in-bar Annuler /
  // PartyHeader back). Returning true consumes the event; when not in
  // multi-select we return false so navigation handles back as usual. Listener
  // is re-subscribed when isMultiSelectMode flips and torn down on unmount.
  useEffect(() => {
    if (!isMultiSelectMode) return;
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        handleCancelMultiSelect();
        return true;
      },
    );
    return () => subscription.remove();
  }, [isMultiSelectMode, handleCancelMultiSelect]);

  const handleBack = useCallback(() => {
    if (isMultiSelectMode) {
      handleCancelMultiSelect();
      return;
    }
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)');
  }, [isMultiSelectMode, handleCancelMultiSelect]);

  const handleMySwaps = useCallback(() => {
    const openMySwaps = () => {
      if (navigatingRef.current) return;
      navigatingRef.current = true;
      router.push('/my-swaps');
    };
    if (!user) requireAuth(openMySwaps, AUTH_MESSAGES.swapParty);
    else openMySwaps();
  }, [user, requireAuth]);

  // Open the deposit sheet by mounting it (depositOpened). The actual present()
  // happens in the effect below once the modal is mounted — this guarantees the
  // BottomSheetModal (and its full-screen portal hosting container) only exists
  // in the tree while open, so it never lingers as a touch-capturing veil on
  // Android.
  const handleShowMyArticles = useCallback(() => {
    // The deposit entry is always visible (even logged-out) so the "add your
    // articles" affordance can never disappear. A logged-out tap routes through
    // the canonical auth gate, mirroring handleItemPress.
    const openDeposit = async () => {
      if (depositRef.current) return;
      depositRef.current = true;
      try {
        const operation = depositContext.capture();
        const eligibility = await EligibilityService.getMine(operation.base.session.uid);
        depositContext.assertCurrent(operation);
        if (eligibility.swapLaunch?.allowed !== true) { depositRef.current = false; setDepositOpened(false); setAdmissionOpen(true); return; }
      // Empty inventory renders as the drop zone; otherwise it's the add button.
      track('swap_deposit_opened', {
        entry_variant: userItems.length === 0 ? 'drop_zone' : 'add_button',
        my_items_count: userItems.length,
      });
      setDepositOpened(true);
      } catch { depositRef.current = false; Alert.alert('Lecture impossible', 'Vos critères pour un nouveau dépôt au Troc ne peuvent pas être relus. Réessayez depuis cet espace.'); }
    };
    if (!user) {
      useAuthSheetStore.getState().show(AUTH_MESSAGES.swapParty);
      return;
    }
    void openDeposit();
  }, [user, userItems.length, depositContext]);

  // Present the modal right after it mounts (when depositOpened flips to true).
  useEffect(() => {
    if (depositOpened) {
      addItemSheetRef.current?.show();
    }
  }, [depositOpened]);

  // Unmount the sheet once it is fully dismissed → removes the portal host.
  const handleDepositClose = useCallback(() => {
    depositRef.current = false;
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
  const filterChips = useMemo<FilterChip[]>(
    () => [
      {
        key: 'sort',
        label: f.getSortLabel(),
        active: f.isSortActive,
        onPress: () => openFilterSheet('sort'),
      },
      {
        key: 'category',
        label: f.getCategoryLabel(),
        active: f.isCategoryActive,
        onPress: () => openFilterSheet('category'),
      },
      {
        key: 'sizes',
        label: f.getSizeLabel(),
        active: f.isSizeActive,
        onPress: () => openFilterSheet('sizes'),
      },
      {
        key: 'colors',
        label: f.getColorLabel(),
        active: f.isColorActive,
        onPress: () => openFilterSheet('colors'),
      },
      {
        key: 'brands',
        label: f.getBrandLabel(),
        active: f.isBrandActive,
        onPress: () => openFilterSheet('brands'),
      },
      {
        key: 'materials',
        label: f.getMaterialLabel(),
        active: f.isMaterialActive,
        onPress: () => openFilterSheet('materials'),
      },
      {
        key: 'condition',
        label: f.getConditionLabelText(),
        active: f.isConditionActive,
        onPress: () => openFilterSheet('condition'),
      },
    ],
    [f, openFilterSheet],
  );

  // ── FlashList helpers ──
  const renderItem = useCallback(
    ({ item }: { item: SwapPartyItemExtended }) => (
      <PartyItemCard
        item={item}

        isSelected={selectedItemIds.has(item.id)}
        isMultiSelectMode={isMultiSelectMode}
        disabled={
          isMultiSelectMode &&
          !!selectedSellerId &&
          item.sellerId !== selectedSellerId
        }
        onPress={() => handleItemPress(item)}
        onLongPress={() => handleItemLongPress(item)}
      />
    ),
    [
      selectedItemIds,
      isMultiSelectMode,
      selectedSellerId,
      handleItemPress,
      handleItemLongPress,
    ],
  );

  const keyExtractor = useCallback(
    (item: SwapPartyItemExtended) => item.id,
    [],
  );

  // ── List header (everything above the grid lives here so the FlashList stays
  //    the single scrollable container — no nesting in a ScrollView). Memoized
  //    element (not an inline-identity function) to avoid header re-creation. ──
  const listHeader = (
      <View>
        <View style={styles.introduction}>
          <Text style={styles.catalogueTitle} accessibilityRole="header">
            LE TROC<Text style={styles.accent}>.</Text>
          </Text>
          {otherItems.length > 1 && !isMultiSelectMode && (
            <Button size="small" variant="secondary" onPress={handleBeginSelection}>Sélectionner</Button>
          )}
        </View>
        {(userItems.length > 0 || pendingAddCount > 0 || !user) && (
          <MyArticlesSection
            compact
            userItems={userItems}
            onAddPress={handleShowMyArticles}
            onRemoveItem={handleRemoveItem}
            pendingCount={pendingAddCount}
            removingArticleIds={removing && removing.frame === depositContext.frame ? removing.ids : undefined}
            isGuest={!user}
          />
        )}
        {f.hasActiveFilters && (
          <Text style={styles.gridCount}>
            {otherItems.length} résultat{otherItems.length > 1 ? 's' : ''}
          </Text>
        )}
        <TrocFilterRow chips={filterChips} />
        {otherItems[0] && (
          <PartyItemCard
            item={otherItems[0]}
            featured
            isSelected={selectedItemIds.has(otherItems[0].id)}
            isMultiSelectMode={isMultiSelectMode}
            disabled={
              isMultiSelectMode &&
              !!selectedSellerId &&
              otherItems[0].sellerId !== selectedSellerId
            }
            onPress={() => handleItemPress(otherItems[0])}
            onLongPress={() => handleItemLongPress(otherItems[0])}
          />
        )}
      </View>
  );

  const listEmpty = useMemo(
    () => (
      <PartyEmptyGrid
        hasActiveFilters={f.hasActiveFilters}
        onClearFilters={f.clearFilters}
      />
    ),
    [f.hasActiveFilters, f.clearFilters],
  );

  // ── Loading ──
  if (isPartyLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <Stack.Screen options={{ headerShown: false }} />
        <StatusBar style="dark" />
        <PartyHeader onBack={handleBack} />
        <SwapPartyDetailSkeleton />
      </SafeAreaView>
    );
  }

  // ── Error / not found ──
  if (isError || !party) {
    return (
      <SafeAreaView style={styles.container}>
        <Stack.Screen options={{ headerShown: false }} />
        <StatusBar style="dark" />
        <PartyHeader onBack={handleBack} />
        <View style={styles.errorContainer}>
          <Ionicons
            name={isError ? 'cloud-offline-outline' : 'swap-horizontal'}
            size={sizing.iconLG}
            color={colors.foregroundSecondary}
          />
          <Text style={styles.errorTitle}>
            {isError
              ? 'Le catalogue n’a pas pu être chargé'
              : 'Aucun espace disponible pour le moment'}
          </Text>
          <Text style={styles.errorSubtitle}>
            {isError
              ? 'Vérifiez votre connexion, puis réessayez.'
              : 'Revenez plus tard pour découvrir les articles à échanger.'}
          </Text>
          <Pressable
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.retryButton,
              pressed && styles.pressed,
            ]}
            onPress={() => {
              track('error_retry_tapped', {
                screen: 'swap_zone',
                error_context: 'swap_zone_load',
              });
              refetchParty();
            }}
          >
            <Text style={styles.retryButtonText}>
              {isError ? 'Réessayer' : 'Actualiser'}
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      style={styles.container}
      edges={['top']}
      testID="swap-zone-screen"
    >
      <Stack.Screen options={{ headerShown: false }} />
      <StatusBar style="dark" />

      <PartyHeader
        party={party}
        onBack={handleBack}
        onMySwaps={handleMySwaps}
      />

      {/* FlashList is the single scrollable container of the screen (canonical
          pattern). All non-grid content lives in ListHeaderComponent; the
          empty state in ListEmptyComponent; MultiSelectBar is an absolute
          overlay (sibling of the list) so it never participates in scroll.
          Wrapped in a flex:1 View so the list always has a bounded height
          (defensive, matches app/visual-search-results.tsx). */}
      <View style={styles.listWrapper}>
        <FlashList
          key={columns}
          data={otherItems.slice(1)}
          keyExtractor={keyExtractor}
          numColumns={columns}
          renderItem={renderItem}
          ListHeaderComponent={listHeader}
          ListEmptyComponent={otherItems.length === 0 ? listEmpty : null}
          // Extra bottom clearance only while the MultiSelectBar overlays the
          // list, so its absolute bar never covers the last grid row (and no
          // dead space is reserved when the bar is absent).
          contentContainerStyle={[
            styles.gridContainer,
            {
              paddingBottom:
                spacing.lg +
                insets.bottom +
                (isMultiSelectMode
                  ? multiSelectHeight || spacing['4xl'] + spacing['2xl']
                  : 0),
            },
          ]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={isManualRefreshing}
              onRefresh={handleRefresh}
              tintColor={colors.foregroundSecondary}
              colors={[colors.foregroundSecondary]}
              progressBackgroundColor={colors.surfaceWarm}
            />
          }
        />
      </View>

      {!isMultiSelectMode && (
        <View
          style={[
            styles.depositFooter,
            { paddingBottom: Math.max(insets.bottom, spacing.md) },
          ]}
        >
          <Button testID="troc-add-piece" onPress={handleShowMyArticles} rightIcon={<Ionicons name="add" size={sizing.iconMD} color={colors.primary}/>}>Ajouter une pièce</Button>
        </View>
      )}

      {isMultiSelectMode && (
        <View
          style={[styles.multiSelectOverlay, { paddingBottom: insets.bottom }]}
          onLayout={(event) =>
            setMultiSelectHeight(event.nativeEvent.layout.height)
          }
          pointerEvents="box-none"
        >
          <MultiSelectBar
            selectedCount={selectedCount}
            canPropose={selectedCount > 0}
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
          loading={isLoadingMyArticles || (isRefreshingMyArticles && myArticles.length === 0)}
          error={myArticlesError}
          onRetry={() => {
            void refetchMyArticles();
          }}
          onPublish={() => {
            handleDepositClose();
            router.push('/sell/capture');
          }}
          adding={isAddingItem}
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
          appearance="troc"
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
          appearance="troc"
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
          appearance="troc"
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
          appearance="troc"
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
          appearance="troc"
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
          appearance="troc"
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
          appearance="troc"
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
      <SwapLaunchAdmissionSheet visible={admissionOpen} onClose={() => setAdmissionOpen(false)} onAllowed={() => {setAdmissionOpen(false); depositRef.current = true; setDepositOpened(true);}}/>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
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
    fontFamily: typography.trocScreenTitle.fontFamily,
    fontSize: typography.trocScreenTitle.fontSize,
    lineHeight: typography.trocScreenTitle.lineHeight,
    letterSpacing: typography.trocScreenTitle.letterSpacing,
    color: colors.foreground,
    textAlign: 'center',
  },
  errorSubtitle: {
    fontFamily: typography.bodySmall.fontFamily,
    fontSize: typography.bodySmall.fontSize,
    lineHeight: typography.bodySmall.lineHeight,
    letterSpacing: typography.bodySmall.letterSpacing,
    color: colors.foregroundSecondary,
    textAlign: 'center',
  },
  retryButton: {
    marginTop: spacing.md,
    minHeight: sizing.minTouchTarget,
    borderRadius: radius.none,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderWidth: 1,
    borderColor: colors.rust,
  },
  retryButtonText: {
    fontFamily: typography.button.fontFamily,
    fontSize: typography.button.fontSize,
    lineHeight: typography.button.lineHeight,
    letterSpacing: typography.button.letterSpacing,
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
    backgroundColor: colors.surfaceWarm,
  },
  depositFooter: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    backgroundColor: colors.background,
    borderTopWidth: components.troc.borderWidth,
    borderTopColor: colors.borderStrong,
  },
  depositButton: {
    minHeight: sizing.buttonHeight,
    padding: spacing.md,
    gap: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primaryDark,
  },
  depositLabel: { ...typography.label, color: colors.white, flexShrink: 1 },
  selectionButton: {
    marginLeft: 'auto',
    minHeight: sizing.minTouchTarget,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  selectionButtonText: { ...typography.label, color: colors.foreground },
  catalogueTitle: { ...typography.trocTitle, color: colors.foreground },
  accent: { color: colors.primaryDark },
  introduction: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  gridCount: { ...typography.caption, color: colors.foregroundSecondary },
  gridContainer: {
    paddingHorizontal: spacing.md - spacing.xs,
    paddingTop: spacing.sm,
    backgroundColor: colors.background,
  },
});
