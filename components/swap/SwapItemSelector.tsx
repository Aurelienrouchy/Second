import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import React, { useMemo } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';

import { SwapItemInfo } from '@/types';
import { colors, fonts, spacing, radius } from '@/constants/theme';
import { formatPrice } from '@/utils/formatPrice';

export interface SwapItemSelectorProps {
  visible: boolean;
  onClose: () => void;
  items: SwapItemInfo[];
  selectedItems: SwapItemInfo[];
  onSelectionChange: (items: SwapItemInfo[]) => void;
  title?: string;
}

const SwapItemSelector: React.FC<SwapItemSelectorProps> = ({
  visible,
  onClose,
  items,
  selectedItems,
  onSelectionChange,
  title = 'Sélectionner mes articles',
}) => {
  const selectedIds = useMemo(() => {
    return selectedItems.map(item => item.articleId);
  }, [selectedItems]);

  const totalValue = useMemo(() => {
    return selectedItems.reduce((sum, item) => sum + item.price, 0);
  }, [selectedItems]);

  const toggleSelection = (item: SwapItemInfo) => {
    if (selectedIds.includes(item.articleId)) {
      onSelectionChange(selectedItems.filter(i => i.articleId !== item.articleId));
    } else {
      onSelectionChange([...selectedItems, item]);
    }
  };

  const renderItem = ({ item }: { item: SwapItemInfo }) => {
    const isSelected = selectedIds.includes(item.articleId);

    return (
      <Pressable
        style={[
          styles.itemCard,
          isSelected && styles.itemCardSelected,
        ]}
        onPress={() => toggleSelection(item)}
      >
        {/* Image */}
        <Image
          source={{ uri: item.imageUrl || '' }}
          style={styles.itemImage}
          contentFit="cover"
          placeholder={{ blurhash: 'LGFk[5xG00xa7wG2RjWB00xa7wG2' }}
        />

        {/* Checkbox overlay */}
        <View style={styles.checkboxOverlay}>
          <View style={[
            styles.checkbox,
            isSelected && styles.checkboxSelected,
          ]}>
            {isSelected && (
              <Ionicons
                name="checkmark"
                size={14}
                color={colors.surface}
              />
            )}
          </View>
        </View>

        {/* Content below image */}
        <View style={styles.itemContent}>
          {item.brand && (
            <Text style={styles.itemBrand} numberOfLines={1}>
              {item.brand.toUpperCase()}
            </Text>
          )}
          <Text style={styles.itemTitle} numberOfLines={2}>
            {item.title}
          </Text>
          <Text style={styles.itemPrice}>{formatPrice(item.price)}</Text>
        </View>
      </Pressable>
    );
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={styles.container}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.headerTitle}>{title}</Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <Ionicons
                name="close"
                size={24}
                color={colors.charcoal}
              />
            </Pressable>
          </View>

          {/* Grid of items */}
          <FlashList
            data={items}
            renderItem={renderItem}
            keyExtractor={item => item.articleId}
            numColumns={2}
            // @ts-expect-error estimatedItemSize valid at runtime
            estimatedItemSize={180}
            contentContainerStyle={styles.listContent}
          />

          {/* Bottom sticky bar */}
          <View style={styles.bottomBar}>
            <View style={styles.bottomBarInfo}>
              <Text style={styles.bottomBarLabel}>
                {selectedItems.length} article{selectedItems.length !== 1 ? 's' : ''} sélectionnés
              </Text>
              <Text style={styles.bottomBarTotal}>
                Total: {formatPrice(totalValue)}
              </Text>
            </View>

            <Pressable
              style={[
                styles.confirmButton,
                selectedItems.length === 0 && styles.confirmButtonDisabled,
              ]}
              onPress={onClose}
              disabled={selectedItems.length === 0}
            >
              <Text style={styles.confirmButtonText}>Confirmer</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  container: {
    height: '85%',
    backgroundColor: colors.cream,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: {
    fontFamily: fonts.display,
    fontSize: 20,
    fontWeight: '400',
    lineHeight: 24,
    color: colors.charcoal,
  },
  listContent: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  itemCard: {
    flex: 1,
    borderRadius: 0,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  itemCardSelected: {
    borderWidth: 1.5,
    borderColor: colors.sage,
    backgroundColor: colors.sageLight,
  },
  itemImage: {
    width: '100%',
    height: 120,
    backgroundColor: colors.surfaceWarm,
  },
  checkboxOverlay: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxSelected: {
    backgroundColor: colors.sage,
    borderColor: colors.sage,
  },
  itemContent: {
    padding: spacing.sm,
  },
  itemBrand: {
    fontFamily: fonts.sans,
    fontSize: 9,
    lineHeight: 11,
    letterSpacing: 0.88,
    textTransform: 'uppercase',
    color: colors.muted,
    marginBottom: spacing.xs,
  },
  itemTitle: {
    fontFamily: fonts.display,
    fontSize: 12,
    fontWeight: '400',
    lineHeight: 14,
    color: colors.charcoal,
    marginBottom: spacing.xs,
  },
  itemPrice: {
    fontFamily: fonts.display,
    fontSize: 14,
    fontWeight: '400',
    lineHeight: 16,
    color: colors.charcoal,
  },
  bottomBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  bottomBarInfo: {
    flex: 1,
  },
  bottomBarLabel: {
    fontFamily: fonts.sans,
    fontSize: 12,
    lineHeight: 16,
    color: colors.charcoal,
    marginBottom: spacing.xs,
  },
  bottomBarTotal: {
    fontFamily: fonts.display,
    fontSize: 16,
    fontWeight: '400',
    lineHeight: 20,
    color: colors.charcoal,
  },
  confirmButton: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.charcoal,
    borderRadius: radius.sm,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: spacing.md,
  },
  confirmButtonDisabled: {
    opacity: 0.5,
  },
  confirmButtonText: {
    fontFamily: fonts.sansMedium,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 0.88,
    textTransform: 'uppercase',
    color: colors.cream,
    fontWeight: '500',
  },
});

export default SwapItemSelector;
