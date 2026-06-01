/**
 * AddItemSheet — bottom sheet to deposit the user's own articles into the Swap Zone.
 *
 * Multi-select: tap rows to toggle (selected rows change background + show a
 * check), then a fixed footer button deposits all selected articles at once.
 *
 * Ref-based (show/hide), same @gorhom/bottom-sheet pattern as the app's other
 * sheets. Light editorial surface (sheets stay light even though the Swap Zone
 * screen is dark). Borders, type tokens and spacing rhythm are aligned on the
 * Swap Zone screen (square corners, h3 title, hairlines, spacing.lg gutter) —
 * colours stay on the sheet's existing light palette.
 */

import {
  BottomSheetModal,
  BottomSheetBackdrop,
  BottomSheetScrollView,
  BottomSheetFooter,
  TouchableOpacity,
} from '@gorhom/bottom-sheet';
import { Ionicons } from '@expo/vector-icons';
import React, {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useMemo,
  useState,
} from 'react';
import { View, StyleSheet, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import Animated, { FadeIn, LinearTransition } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text, Caption } from '@/components/ui';
import { colors, fonts, spacing, typography, sizing, radius } from '@/constants/theme';
import { formatPrice } from '@/utils/formatPrice';
import type { Article, SwapPartyItemExtended } from '@/types';

export interface AddItemSheetProps {
  articles: Article[];
  userItems: SwapPartyItemExtended[];
  /** True while the user's articles are being fetched. */
  loading?: boolean;
  /** Deposit the selected articles in one batch. */
  onAddItems: (articles: Article[]) => void;
  /**
   * Called when the modal is fully dismissed. Lets the parent unmount this
   * sheet so the @gorhom portal hosting container (StyleSheet.absoluteFill) is
   * removed and never lingers as a full-screen touch-capturing layer (Android).
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
    const snapPoints = useMemo(() => ['75%'], []);
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

    const renderBackdrop = useCallback(
      (props: any) => <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} />,
      [],
    );

    const hasList = !loading && availableArticles.length > 0;

    const renderFooter = useCallback(
      (props: any) => {
        if (!hasList) return null;
        const count = selected.size;
        return (
          <BottomSheetFooter {...props}>
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
          </BottomSheetFooter>
        );
      },
      [hasList, selected.size, insets.bottom, handleConfirm],
    );

    const hasInventory = articles.length > 0;
    const emptyText = !hasInventory
      ? "Tu n'as aucun article à déposer.\nMets d'abord un article en vente."
      : 'Tous tes articles sont déjà dans la Swap Zone.';

    // Leave room for the fixed footer above the scroll content.
    const scrollPaddingBottom = (hasList ? spacing['4xl'] : spacing.lg) + insets.bottom;

    return (
      <BottomSheetModal
        ref={bottomSheetRef}
        snapPoints={snapPoints}
        backdropComponent={renderBackdrop}
        footerComponent={renderFooter}
        enablePanDownToClose
        topInset={insets.top}
        handleIndicatorStyle={styles.handleIndicator}
        backgroundStyle={styles.sheetBackground}
        enableDynamicSizing={false}
        onDismiss={onClose}
      >
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
            <Ionicons name="close" size={sizing.iconMD} color={colors.charcoal} />
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
                    size={sizing.iconMD}
                    color={isSelected ? colors.sage : colors.borderStrong}
                    style={styles.checkIcon}
                  />
                </TouchableOpacity>
                </Animated.View>
              );
            })}
          </BottomSheetScrollView>
        )}
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
  handleIndicator: {
    backgroundColor: colors.borderStrong,
    width: 40,
    height: 4,
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
