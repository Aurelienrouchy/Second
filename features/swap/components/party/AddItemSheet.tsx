/** Select existing articles to add to the exchange catalogue. The parent mounts
 * this modal only while open, so its portal never covers the catalogue at rest. */
import {
  BottomSheetModal,
  BottomSheetBackdrop,
  BottomSheetScrollView,
  BottomSheetFooter,
  TouchableOpacity,
  type BottomSheetBackdropProps,
  type BottomSheetFooterProps,
} from '@gorhom/bottom-sheet';
import { Ionicons } from '@expo/vector-icons';
import React, {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  View,
  StyleSheet,
  useWindowDimensions,
} from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text, Button } from '@/components/ui';
import {
  colors,
  spacing,
  typography,
  sizing,
  radius,
  components,
} from '@/constants/theme';
import { track } from '@/lib/analytics';
import { formatPrice } from '@/utils/formatPrice';
import type { Article, SwapPartyItemExtended } from '@/types';

export interface AddItemSheetProps {
  articles: Article[];
  userItems: SwapPartyItemExtended[];
  loading?: boolean;
  error?: boolean;
  adding?: boolean;
  onAddItems: (articles: Article[]) => void;
  onRetry?: () => void;
  onPublish?: () => void;
  onClose?: () => void;
}
export interface AddItemSheetRef {
  show: () => void;
  hide: () => void;
}

const AddItemSheet = forwardRef<AddItemSheetRef, AddItemSheetProps>(
  (
    {
      articles,
      userItems,
      loading = false,
      error = false,
      adding = false,
      onAddItems,
      onRetry,
      onPublish,
      onClose,
    },
    ref,
  ) => {
    const insets = useSafeAreaInsets();
    const { height: windowHeight, fontScale } = useWindowDimensions();
    const [headerHeight, setHeaderHeight] = useState<number>(
      components.troc.sheetHeaderEstimate,
    );
    const [contentHeight, setContentHeight] = useState(0);
    const bottomSheetRef = useRef<BottomSheetModal>(null);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [footerHeight, setFooterHeight] = useState(
      spacing['4xl'] + spacing['2xl'],
    );
    const confirmedRef = useRef(false);
    const submittingRef = useRef(false);
    useImperativeHandle(ref, () => ({
      show: () => {
        setSelected(new Set());
        confirmedRef.current = false;
        submittingRef.current = false;
        bottomSheetRef.current?.present();
      },
      hide: () => bottomSheetRef.current?.dismiss(),
    }));
    const availableArticles = useMemo(
      () =>
        articles.filter((a) => !userItems.some((ui) => ui.articleId === a.id)),
      [articles, userItems],
    );
    const snapPoints = useMemo(() => {
      const estimatedRowHeight =
        components.troc.depositThumbWidth / components.troc.photoRatio +
        spacing.md * 2;
      const estimatedContentHeight =
        Math.max(1, availableArticles.length) * estimatedRowHeight * fontScale +
        footerHeight;
      return [
        Math.min(
          windowHeight * components.troc.sheetMaxHeightRatio,
          Math.max(
            components.troc.sheetMinHeight,
            headerHeight +
              components.troc.sheetHandleHeight +
              (contentHeight || estimatedContentHeight),
          ),
        ),
      ];
    }, [
      availableArticles.length,
      fontScale,
      footerHeight,
      windowHeight,
      headerHeight,
      contentHeight,
    ]);
    const picked = useMemo(
      () => availableArticles.filter((a) => selected.has(a.id)),
      [availableArticles, selected],
    );
    const toggle = useCallback(
      (id: string) => {
        if (adding || submittingRef.current) return;
        setSelected((prev) => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        });
      },
      [adding],
    );
    const handleConfirm = useCallback(() => {
      if (adding || submittingRef.current || picked.length === 0) return;
      submittingRef.current = true;
      confirmedRef.current = true;
      onAddItems(picked);
      setSelected(new Set());
      bottomSheetRef.current?.dismiss();
    }, [adding, picked, onAddItems]);
    const handleDismiss = useCallback(() => {
      if (!confirmedRef.current)
        track('swap_deposit_abandoned', {
          selected_count_at_dismiss: selected.size,
          had_inventory: articles.length > 0,
        });
      onClose?.();
    }, [selected.size, articles.length, onClose]);
    const renderBackdrop = useCallback(
      (props: BottomSheetBackdropProps) => (
        <BottomSheetBackdrop
          {...props}
          disappearsOnIndex={-1}
          appearsOnIndex={0}
        />
      ),
      [],
    );
    const hasList = !loading && !error && availableArticles.length > 0;
    const renderFooter = useCallback(
      (props: BottomSheetFooterProps) => {
        if (!hasList) return null;
        const isDisabled = adding || picked.length === 0;
        return (
          <BottomSheetFooter {...props}>
            <View
              style={[
                styles.footer,
                { paddingBottom: Math.max(insets.bottom, spacing.md) },
              ]}
              onLayout={(event) =>
                setFooterHeight(event.nativeEvent.layout.height)
              }
            >
              <Button onPress={handleConfirm} disabled={isDisabled} loading={adding}>{picked.length ? `Ajouter ${picked.length} pièce${picked.length > 1 ? 's' : ''}` : 'Ajouter au Troc'}</Button>
            </View>
          </BottomSheetFooter>
        );
      },
      [hasList, picked.length, adding, insets.bottom, handleConfirm],
    );
    return (
      <BottomSheetModal
        accessible={false}
        ref={bottomSheetRef}
        snapPoints={snapPoints}
        backdropComponent={renderBackdrop}
        footerComponent={renderFooter}
        enablePanDownToClose
        topInset={insets.top}
        handleIndicatorStyle={styles.handleIndicator}
        backgroundStyle={styles.sheetBackground}
        enableDynamicSizing={false}
        onDismiss={handleDismiss}
      >
        <View
          style={styles.header}
          onLayout={(event) => setHeaderHeight(event.nativeEvent.layout.height)}
        >
          <View style={styles.headerText}>
            <Text style={styles.title}>Ajouter des pièces</Text>
          </View>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Fermer l’ajout d’articles"
            onPress={() => bottomSheetRef.current?.dismiss()}
            style={styles.closeButton}
          >
            <Ionicons
              name="close"
              size={sizing.iconMD}
              color={colors.charcoal}
            />
          </TouchableOpacity>
        </View>
        <BottomSheetScrollView
          onContentSizeChange={(_width, contentSize) =>
            setContentHeight(contentSize)
          }
          contentContainerStyle={[
            styles.listContent,
            {
              paddingBottom:
                (hasList ? footerHeight : spacing.lg + insets.bottom) +
                spacing.md,
            },
          ]}
          showsVerticalScrollIndicator={false}
        >
          {loading ? (
            <View
              style={styles.stateBox}
              accessibilityLabel="Chargement de vos articles"
              accessibilityState={{ busy: true }}
            >
              {[0, 1, 2].map((index) => (
                <View key={index} style={styles.skeletonRow}>
                  <View style={styles.skeletonThumb} />
                  <View style={styles.skeletonText} />
                </View>
              ))}
              <Text style={styles.stateText}>Chargement de vos articles…</Text>
            </View>
          ) : error ? (
            <View style={styles.stateBox}>
              <Ionicons
                name="cloud-offline-outline"
                size={sizing.iconLG}
                color={colors.primaryDark}
              />
              <Text style={styles.stateTitle}>
                Vos articles n’ont pas pu être chargés
              </Text>
              <Text style={styles.stateText}>
                Vérifiez votre connexion, puis réessayez.
              </Text>
              {onRetry && (
                <TouchableOpacity
                  accessibilityRole="button"
                  onPress={onRetry}
                  style={styles.addButton}
                >
                  <Text style={styles.addButtonText}>Réessayer</Text>
                </TouchableOpacity>
              )}
            </View>
          ) : availableArticles.length === 0 ? (
            <View style={styles.stateBox}>
              <Text style={styles.stateTitle}>
                {articles.length > 0
                  ? 'Vos articles sont déjà dans l’espace'
                  : 'Votre garde-robe est encore vide'}
              </Text>
              <Text style={styles.stateText}>
                {articles.length > 0
                  ? 'Vous pouvez découvrir les articles proposés par les autres membres.'
                  : 'Publiez un article, puis ajoutez-le ici pour commencer à échanger.'}
              </Text>
              {articles.length === 0 && onPublish && (
                <TouchableOpacity
                  accessibilityRole="button"
                  onPress={() => {
                    bottomSheetRef.current?.dismiss();
                    onPublish();
                  }}
                  style={styles.addButton}
                >
                  <Text style={styles.addButtonText}>Publier un article</Text>
                </TouchableOpacity>
              )}
            </View>
          ) : (
            availableArticles.map((item) => {
              const isSelected = selected.has(item.id);
              return (
                <TouchableOpacity
                  key={item.id}
                  accessibilityRole="checkbox"
                  accessibilityLabel={item.title}
                  accessibilityState={{ checked: isSelected, disabled: adding }}
                  disabled={adding}
                  style={[styles.row, isSelected && styles.rowSelected]}
                  onPress={() => toggle(item.id)}
                >
                  <View style={styles.rowImageWrap}>
                    <Image
                      source={{ uri: item.images?.[0]?.url }}
                      style={styles.rowImage}
                      recyclingKey={item.id}
                      contentFit="cover"
                    />
                  </View>
                  <View style={styles.rowInfo}>
                    <Text style={styles.rowTitle}>{item.title}</Text>
                    {!!item.brand?.trim() && (
                      <Text style={styles.rowMeta}>{item.brand}</Text>
                    )}
                    <Text style={styles.rowMeta}>
                      Valeur {formatPrice(item.price)}
                      {item.size?.value ? ` · ${item.size.value}` : ''}
                    </Text>
                  </View>
                  <Ionicons
                    name={isSelected ? 'checkmark-circle' : 'ellipse-outline'}
                    size={sizing.iconMD}
                    color={isSelected ? colors.primaryDark : colors.muted}
                  />
                </TouchableOpacity>
              );
            })
          )}
        </BottomSheetScrollView>
      </BottomSheetModal>
    );
  },
);
AddItemSheet.displayName = 'AddItemSheet';
export default AddItemSheet;

const styles = StyleSheet.create({
  sheetBackground: { backgroundColor: colors.background },
  handleIndicator: { backgroundColor: colors.borderStrong },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerText: { flex: 1, gap: spacing.xs },
  title: { ...typography.trocScreenTitle, color: colors.charcoal },
  closeButton: {
    width: sizing.minTouchTarget,
    height: sizing.minTouchTarget,
    justifyContent: 'center',
    alignItems: 'center',
  },
  listContent: { paddingTop: spacing.sm },
  stateBox: { padding: spacing.lg, alignItems: 'stretch', gap: spacing.md },
  stateTitle: { ...typography.trocItemTitle, color: colors.charcoal },
  stateText: { ...typography.bodySmall, color: colors.foregroundSecondary },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.sm,
  },
  rowSelected: { backgroundColor: colors.surfaceWarm },
  rowImageWrap: {
    width: components.troc.depositThumbWidth,
    aspectRatio: components.troc.photoRatio,
    backgroundColor: colors.surfaceWarm,
    borderRadius: radius.sm,
    overflow: 'hidden',
  },
  rowImage: { width: '100%', height: '100%' },
  rowInfo: { flex: 1, gap: spacing.xs },
  rowTitle: { ...typography.trocComparisonTitle, color: colors.charcoal },
  rowMeta: { ...typography.caption, color: colors.foregroundSecondary },
  footer: {
    backgroundColor: colors.background,
    padding: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: spacing.sm,
  },
  addButton: {
    ...components.button.primary,
    padding: spacing.md,
    minHeight: sizing.minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.none,
  },
  addButtonDisabled: { backgroundColor: colors.surfaceWarm },
  addButtonText: {
    ...typography.label,
    color: colors.primary,
    textAlign: 'center',
  },
  skeletonRow: { flexDirection: 'row', gap: spacing.md, alignItems: 'center' },
  skeletonThumb: {
    width: components.troc.depositThumbWidth,
    aspectRatio: components.troc.photoRatio,
    backgroundColor: colors.surfaceWarm,
    borderRadius: radius.sm,
  },
  skeletonText: {
    flex: 1,
    height: typography.body.lineHeight * 2,
    backgroundColor: colors.surfaceWarm,
    borderRadius: radius.sm,
  },
});
