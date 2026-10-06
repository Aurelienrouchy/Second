import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import React, { useCallback, useMemo } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { SwapItemInfo } from '@/types';
import { colors, fonts, spacing, radius, sizing } from '@/constants/theme';
import { Skeleton } from '@/components/ui/Skeleton';
import { formatPrice } from '@/utils/formatPrice';

export interface SwapItemSelectorProps {
  visible: boolean;
  onClose: () => void;
  items: SwapItemInfo[];
  selectedItems: SwapItemInfo[];
  onSelectionChange: (items: SwapItemInfo[]) => void;
  title?: string;
  isLoading?: boolean;
  errorMessage?: string;
  onRetry?: () => void;
  emptyMessage?: string;
  onEmptyAction?: () => void;
  emptyActionLabel?: string;
}

const itemKey = (item: SwapItemInfo) => item.articleId;

const SwapItemSelector: React.FC<SwapItemSelectorProps> = ({
  visible,
  onClose,
  items,
  selectedItems,
  onSelectionChange,
  title = 'Choisissez vos articles',
  isLoading = false,
  errorMessage,
  onRetry,
  emptyMessage = 'Aucun article disponible pour cet échange.',
  onEmptyAction,
  emptyActionLabel,
}) => {
  const insets = useSafeAreaInsets();
  const { width, fontScale } = useWindowDimensions();
  const numColumns = width < 360 || fontScale > 1.3 ? 1 : 2;
  const selectedIds = useMemo(() => new Set(selectedItems.map(item => item.articleId)), [selectedItems]);
  const totalValue = useMemo(() => selectedItems.reduce((sum, item) => sum + item.price, 0), [selectedItems]);

  const toggleSelection = useCallback((item: SwapItemInfo) => {
    onSelectionChange(selectedIds.has(item.articleId)
      ? selectedItems.filter(i => i.articleId !== item.articleId)
      : [...selectedItems, item]);
  }, [onSelectionChange, selectedIds, selectedItems]);

  const renderItem = useCallback(({ item }: { item: SwapItemInfo }) => {
    const isSelected = selectedIds.has(item.articleId);
    return (
      <View style={styles.itemCell}>
        <Pressable
          style={[styles.itemCard, isSelected && styles.itemCardSelected]}
          onPress={() => toggleSelection(item)}
          accessibilityRole="checkbox"
          accessibilityLabel={`${item.title}, ${formatPrice(item.price)}`}
          accessibilityState={{ checked: isSelected }}
          accessibilityHint="Choisir ou retirer cet article de votre sélection"
          testID={`swap-select-${item.articleId}`}
        >
          <Image
            source={item.imageUrl ? { uri: item.imageUrl } : undefined}
            style={styles.itemImage}
            contentFit="cover"
            placeholder={{ blurhash: 'LGFk[5xG00xa7wG2RjWB00xa7wG2' }}
            accessibilityIgnoresInvertColors
          />
          <View style={styles.checkboxOverlay}>
            <View style={[styles.checkbox, isSelected && styles.checkboxSelected]}>
              {isSelected && <Ionicons name="checkmark" size={16} color={colors.white} />}
            </View>
          </View>
          <View style={styles.itemContent}>
            {item.brand && <Text style={styles.itemBrand}>{item.brand}</Text>}
            <Text style={styles.itemTitle}>{item.title}</Text>
            <Text style={styles.itemPrice}>{formatPrice(item.price)}</Text>
            <Text style={[styles.selectionLabel, isSelected && styles.selectedLabel]}>
              {isSelected ? 'Sélectionné' : 'Choisir cet article'}
            </Text>
          </View>
        </Pressable>
      </View>
    );
  }, [selectedIds, toggleSelection]);

  return (
    <Modal visible={visible} transparent statusBarTranslucent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel="Fermer le choix des articles" />
        <View style={styles.container} accessibilityViewIsModal>
          <View style={styles.handle} />
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <Text style={styles.headerTitle} accessibilityRole="header">{title}</Text>
              <Text style={styles.headerHint}>Touchez un article pour le choisir ou le retirer.</Text>
            </View>
            <Pressable style={styles.closeButton} onPress={onClose} accessibilityRole="button" accessibilityLabel="Fermer et conserver la sélection">
              <Ionicons name="close" size={22} color={colors.charcoal} />
            </Pressable>
          </View>

          {isLoading ? (
            <View style={styles.stateContainer} accessibilityLabel="Chargement des articles" accessibilityState={{ busy: true }}>
              <Skeleton height={96} borderRadius={radius.xl} />
              <Skeleton height={96} borderRadius={radius.xl} />
            </View>
          ) : errorMessage ? (
            <View style={styles.stateContainer}>
              <Ionicons name="cloud-offline-outline" size={36} color={colors.primary} />
              <Text style={styles.stateTitle}>Articles indisponibles</Text>
              <Text style={styles.stateCopy}>{errorMessage} Votre sélection est conservée.</Text>
              {onRetry && <Pressable style={styles.stateButton} onPress={onRetry} accessibilityRole="button"><Text style={styles.stateButtonText}>Réessayer</Text></Pressable>}
            </View>
          ) : (
            <FlashList
              testID="swap-selector-grid"
              key={numColumns}
              data={items}
              renderItem={renderItem}
              keyExtractor={itemKey}
              numColumns={numColumns}
              extraData={selectedItems}
              contentContainerStyle={styles.listContent}
              ListEmptyComponent={
                <View style={styles.emptyContainer}>
                  <Ionicons name="shirt-outline" size={36} color={colors.primary} />
                  <Text style={styles.stateTitle}>Aucun article disponible</Text>
                  <Text style={styles.stateCopy}>{emptyMessage}</Text>
                  {onEmptyAction && emptyActionLabel && <Pressable style={styles.stateButton} onPress={onEmptyAction} accessibilityRole="button"><Text style={styles.stateButtonText}>{emptyActionLabel}</Text></Pressable>}
                </View>
              }
            />
          )}

          <View style={[styles.bottomBar, { paddingBottom: spacing.md + insets.bottom }]}>
            <View style={styles.bottomBarInfo}>
              <Text style={styles.bottomBarLabel}>{selectedItems.length} article{selectedItems.length !== 1 ? 's' : ''} sélectionné{selectedItems.length !== 1 ? 's' : ''}</Text>
              <Text style={styles.bottomBarTotal}>{formatPrice(totalValue)}</Text>
            </View>
            <Pressable
              style={[styles.confirmButton, selectedItems.length === 0 && styles.confirmButtonDisabled]}
              onPress={onClose}
              disabled={selectedItems.length === 0}
              accessibilityRole="button"
              accessibilityState={{ disabled: selectedItems.length === 0 }}
            >
              <Text style={styles.confirmButtonText}>Utiliser cette sélection</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  backdrop: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  container: {
    height: '90%',
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    overflow: 'hidden',
  },
  handle: { alignSelf: 'center', width: 36, height: 4, borderRadius: radius.full, backgroundColor: colors.borderStrong, marginTop: spacing.sm },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  headerCopy: { flex: 1, gap: spacing.sm },
  headerTitle: { fontFamily: fonts.displayMedium, fontSize: 25, lineHeight: 30, color: colors.charcoal },
  headerHint: { fontFamily: fonts.sans, fontSize: 13, lineHeight: 19, color: colors.foregroundSecondary },
  closeButton: { width: sizing.minTouchTarget, height: sizing.minTouchTarget, borderRadius: radius.full, backgroundColor: colors.surfaceWarm, justifyContent: 'center', alignItems: 'center' },
  listContent: { paddingHorizontal: spacing.sm, paddingVertical: spacing.sm },
  stateContainer: { flex: 1, justifyContent: 'center', padding: spacing.lg, gap: spacing.md },
  emptyContainer: { alignItems: 'center', paddingVertical: spacing.xl, paddingHorizontal: spacing.md, gap: spacing.md },
  stateTitle: { fontFamily: fonts.displayMedium, fontSize: 24, lineHeight: 30, color: colors.charcoal, textAlign: 'center' },
  stateCopy: { fontFamily: fonts.sans, fontSize: 14, lineHeight: 21, color: colors.foregroundSecondary, textAlign: 'center' },
  stateButton: { minHeight: sizing.minTouchTarget, padding: spacing.md, borderRadius: radius.xl, backgroundColor: colors.charcoal, justifyContent: 'center', alignItems: 'center' },
  stateButtonText: { fontFamily: fonts.sansMedium, fontSize: 14, lineHeight: 20, color: colors.cream, textAlign: 'center' },
  itemCell: { flex: 1, padding: spacing.sm },
  itemCard: { minHeight: sizing.minTouchTarget, borderRadius: radius.xl, backgroundColor: colors.surfaceWarm, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  itemCardSelected: { borderColor: colors.primary, borderWidth: 1 },
  itemImage: { width: '100%', aspectRatio: 1.2, backgroundColor: colors.surfaceWarm },
  checkboxOverlay: { position: 'absolute', top: spacing.sm, right: spacing.sm },
  checkbox: { width: 26, height: 26, borderRadius: radius.full, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface, justifyContent: 'center', alignItems: 'center' },
  checkboxSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  itemContent: { padding: spacing.md, gap: spacing.xs },
  itemBrand: { fontFamily: fonts.sansMedium, fontSize: 11, lineHeight: 16, color: colors.foregroundSecondary },
  itemTitle: { fontFamily: fonts.sansMedium, fontSize: 14, lineHeight: 20, color: colors.charcoal },
  itemPrice: { fontFamily: fonts.displayMedium, fontSize: 24, lineHeight: 29, color: colors.charcoal },
  selectionLabel: { fontFamily: fonts.sans, fontSize: 12, lineHeight: 18, color: colors.foregroundSecondary, marginTop: spacing.xs },
  selectedLabel: { color: colors.primary, fontFamily: fonts.sansMedium },
  bottomBar: { paddingHorizontal: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.background, gap: spacing.sm },
  bottomBarInfo: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
  bottomBarLabel: { flexShrink: 1, fontFamily: fonts.sans, fontSize: 13, lineHeight: 19, color: colors.foregroundSecondary },
  bottomBarTotal: { fontFamily: fonts.displayMedium, fontSize: 24, lineHeight: 29, color: colors.charcoal },
  confirmButton: { minHeight: sizing.buttonHeight, paddingHorizontal: spacing.md, paddingVertical: spacing.md, backgroundColor: colors.charcoal, borderRadius: radius.xl, justifyContent: 'center', alignItems: 'center' },
  confirmButtonDisabled: { opacity: 0.45 },
  confirmButtonText: { fontFamily: fonts.sansMedium, fontSize: 14, lineHeight: 20, color: colors.cream, textAlign: 'center' },
});

export default React.memo(SwapItemSelector);
