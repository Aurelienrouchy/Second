/**
 * AddItemSheet — bottom sheet to deposit the user's own articles into the Swap Zone.
 *
 * Multi-select: tap rows to toggle (selected rows change background + show a
 * check), then a fixed footer button deposits all selected articles at once.
 *
 * Ref-based (show/hide), native @expo/ui BottomSheetModal — the scrim, drag
 * handle and back-button handling are provided by the platform. Light
 * editorial surface (sheets stay light even though the Swap Zone screen is
 * dark).
 */

import {
  BottomSheetModal,
  BottomSheetScrollView,
  BottomSheetView,
} from '@expo/ui/community/bottom-sheet';
import { Ionicons } from '@expo/vector-icons';
import React, {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useMemo,
  useState,
} from 'react';
import { View, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import { Image } from 'expo-image';
import Animated, { FadeIn, LinearTransition } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text, Caption, SheetFooter, SHEET_FOOTER_HEIGHT } from '@/components/ui';
import { useSheetHeight } from '@/hooks/useSheetHeight';
import { colors, fonts, spacing, typography, sizing } from '@/constants/theme';
import { formatPrice } from '@/utils/formatPrice';
import type { Article, SwapPartyItemExtended } from '@/types';

const SNAP = '75%';

export interface AddItemSheetProps {
  articles: Article[];
  userItems: SwapPartyItemExtended[];
  /** True while the user's articles are being fetched. */
  loading?: boolean;
  /** Deposit the selected articles in one batch. */
  onAddItems: (articles: Article[]) => void;
  /**
   * Called when the modal is fully dismissed. The native sheet manages its own
   * presentation container, but the parent may still unmount this sheet on
   * dismiss for cleanliness.
   */
  onClose?: () => void;
}

export interface AddItemSheetRef {
  show: () => void;
  hide: () => void;
}

const AddItemSheet = forwardRef<AddItemSheetRef, AddItemSheetProps>(
  ({ articles, userItems, loading = false, onAddItems, onClose }, ref) => {
    const insets = useSafeAreaInsets();
    const snapPoints = useMemo(() => [SNAP], []);
    const sheetHeight = useSheetHeight(SNAP);
    const bottomSheetRef = React.useRef<BottomSheetModal>(null);
    const [selected, setSelected] = useState<Set<string>>(new Set());

    useImperativeHandle(ref, () => ({
      show: () => {
        setSelected(new Set());
        bottomSheetRef.current?.present();
      },
      hide: () => bottomSheetRef.current?.dismiss(),
    }));

    const availableArticles = useMemo(
      () => articles.filter((a) => !userItems.some((ui) => ui.articleId === a.id)),
      [articles, userItems],
    );

    const toggle = useCallback((id: string) => {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    }, []);

    const handleConfirm = useCallback(() => {
      const picked = availableArticles.filter((a) => selected.has(a.id));
      if (picked.length === 0) return;
      onAddItems(picked);
      setSelected(new Set());
      bottomSheetRef.current?.dismiss();
    }, [availableArticles, selected, onAddItems]);

    const hasList = !loading && availableArticles.length > 0;

    const count = selected.size;

    const hasInventory = articles.length > 0;
    const emptyText = !hasInventory
      ? "Tu n'as aucun article à déposer.\nMets d'abord un article en vente."
      : 'Tous tes articles sont déjà dans la Swap Zone.';

    const scrollPaddingBottom = spacing.lg + insets.bottom;

    return (
      <BottomSheetModal
        ref={bottomSheetRef}
        snapPoints={snapPoints}
        enablePanDownToClose
        backgroundStyle={styles.sheetBackground}
        enableDynamicSizing={false}
        onDismiss={onClose}
      >
        <BottomSheetView style={styles.flex}>
        {/* ── Header ── */}
        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text style={styles.title}>Ajouter à la Swap Zone</Text>
            <Caption style={styles.subtitle}>
              Sélectionne les articles à proposer à l’échange
            </Caption>
          </View>
          <TouchableOpacity
            onPress={() => bottomSheetRef.current?.dismiss()}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            style={styles.closeButton}
          >
            <Ionicons name="close" size={22} color={colors.charcoal} />
          </TouchableOpacity>
        </View>

        <View style={styles.divider} />

        {/* ── Content ── */}
        {loading ? (
          <View style={styles.stateBox}>
            <ActivityIndicator color={colors.sage} />
            <Caption style={styles.stateText}>Chargement de tes articles…</Caption>
          </View>
        ) : availableArticles.length === 0 ? (
          <View style={styles.stateBox}>
            <Ionicons name="shirt-outline" size={sizing.iconLG} color={colors.muted} />
            <Caption style={styles.stateText}>{emptyText}</Caption>
          </View>
        ) : (
          <BottomSheetScrollView
            style={styles.flex}
            contentContainerStyle={[styles.listContent, { paddingBottom: scrollPaddingBottom }]}
            showsVerticalScrollIndicator={false}
          >
            {availableArticles.map((item) => {
              const isSelected = selected.has(item.id);
              return (
                <Animated.View
                  key={item.id}
                  entering={FadeIn.duration(180)}
                  layout={LinearTransition.duration(200)}
                >
                <TouchableOpacity
                  style={[styles.row, isSelected && styles.rowSelected]}
                  onPress={() => toggle(item.id)}
                >
                  <Image source={{ uri: item.images?.[0]?.url }} style={styles.rowImage} />
                  <View style={styles.rowInfo}>
                    <Text variant="label" style={styles.rowTitle} numberOfLines={1}>
                      {item.title}
                    </Text>
                    <Text variant="caption" color="muted">
                      {item.brand}
                    </Text>
                  </View>
                  <Text variant="price" style={styles.rowPrice}>
                    {formatPrice(item.price)}
                  </Text>
                  <Ionicons
                    name={isSelected ? 'checkmark-circle' : 'ellipse-outline'}
                    size={24}
                    color={isSelected ? colors.sage : colors.borderStrong}
                    style={styles.checkIcon}
                  />
                </TouchableOpacity>
                </Animated.View>
              );
            })}
          </BottomSheetScrollView>
        )}

        {/* ── Footer (deposit) ── */}
        {hasList && (
          <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
            <TouchableOpacity
              style={[styles.addButton, count === 0 && styles.addButtonDisabled]}
              onPress={handleConfirm}
              disabled={count === 0}
            >
              <Text style={styles.addButtonText}>
                {count > 0 ? `Ajouter (${count})` : 'Ajouter'}
              </Text>
            </TouchableOpacity>
          </View>
        )}
        </BottomSheetView>
      </BottomSheetModal>
    );
  },
);

AddItemSheet.displayName = 'AddItemSheet';

export default AddItemSheet;

const styles = StyleSheet.create({
  sheetBackground: {
    backgroundColor: colors.surface,
  },
  flex: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  headerText: {
    flex: 1,
    gap: spacing.xs,
  },
  title: {
    fontFamily: fonts.displaySemiBold,
    fontSize: typography.h2.fontSize,
    lineHeight: typography.h2.lineHeight,
    letterSpacing: typography.h2.letterSpacing,
    color: colors.charcoal,
  },
  subtitle: {
    color: colors.muted,
  },
  closeButton: {
    width: sizing.avatarSM,
    height: sizing.avatarSM,
    justifyContent: 'center',
    alignItems: 'center',
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginHorizontal: spacing.lg,
  },
  stateBox: {
    paddingVertical: spacing['2xl'],
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    gap: spacing.sm,
  },
  stateText: {
    color: colors.muted,
    textAlign: 'center',
  },
  listContent: {
    paddingTop: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.md,
  },
  rowSelected: {
    backgroundColor: colors.surfaceWarm,
  },
  rowImage: {
    width: 48,
    height: 60,
    backgroundColor: colors.background,
  },
  rowInfo: {
    flex: 1,
  },
  rowTitle: {
    color: colors.charcoal,
    marginBottom: 2,
  },
  rowPrice: {
    color: colors.rust,
  },
  checkIcon: {
    marginLeft: spacing.xs,
  },
  // ── Footer ──
  footer: {
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  addButton: {
    backgroundColor: colors.rust,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  addButtonDisabled: {
    backgroundColor: colors.borderStrong,
  },
  addButtonText: {
    fontFamily: fonts.sansMedium,
    fontSize: typography.button.fontSize,
    letterSpacing: typography.button.letterSpacing,
    textTransform: 'uppercase',
    color: colors.cream,
  },
});
