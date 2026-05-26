/**
 * AddItemModal Component
 * Bottom sheet modal for adding user's articles to the swap party
 */

import React, { useCallback, useMemo } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Image } from 'expo-image';
import { FlashList } from '@shopify/flash-list';
import { Ionicons } from '@expo/vector-icons';

import { Text, Caption } from '@/components/ui';
import { colors, fonts, spacing, radius } from '@/constants/theme';
import { formatPrice } from '@/utils/formatPrice';
import type { Article } from '@/types';
import type { AddItemModalProps } from '../types';

export const AddItemModal = React.memo(function AddItemModal({
  visible,
  articles,
  userItems,
  onAddItem,
  onClose,
}: AddItemModalProps) {
  const availableArticles = useMemo(
    () => articles.filter(
      (article) => !userItems.some((ui) => ui.articleId === article.id)
    ),
    [articles, userItems],
  );

  const renderItem = useCallback(({ item }: { item: Article }) => (
    <Pressable
      style={({ pressed }) => [styles.articleListItem, pressed && { opacity: 0.7 }]}
      onPress={() => onAddItem(item)}
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
        {formatPrice(item.price)}
      </Text>
      <View style={styles.addItemIcon}>
        <Ionicons name="add-circle" size={24} color={colors.sage} />
      </View>
    </Pressable>
  ), [onAddItem]);

  const keyExtractor = useCallback((item: Article) => item.id, []);

  if (!visible) return null;

  return (
    <View style={styles.modal}>
      <View style={styles.modalContent}>
        <View style={styles.modalHeader}>
          <Text variant="body" style={styles.modalTitle}>Ajouter des articles</Text>
          <Pressable
            style={({ pressed }) => [styles.modalDoneButton, pressed && { opacity: 0.7 }]}
            onPress={onClose}
          >
            <Text style={styles.modalDoneText}>Terminé</Text>
          </Pressable>
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
          data={availableArticles}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
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
  );
});

const styles = StyleSheet.create({
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
