/**
 * AddItemModal Component
 * Bottom sheet modal for depositing the user's own articles into the Swap Zone.
 *
 * Uses a ScrollView (not FlashList): the list is the user's OWN inventory
 * (bounded, small) and the sheet is content-sized (maxHeight), where a FlashList
 * would measure a 0px height and render nothing.
 */

import React, { useMemo } from 'react';
import { View, StyleSheet, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
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
  loading = false,
  onAddItem,
  onClose,
}: AddItemModalProps) {
  const availableArticles = useMemo(
    () => articles.filter(
      (article) => !userItems.some((ui) => ui.articleId === article.id)
    ),
    [articles, userItems],
  );

  const renderRow = (item: Article) => (
    <Pressable
      key={item.id}
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
  );

  if (!visible) return null;

  const hasInventory = articles.length > 0;
  const emptyText = !hasInventory
    ? "Tu n'as aucun article à déposer.\nMets d'abord un article en vente."
    : 'Tous tes articles sont déjà dans la Swap Zone.';

  return (
    <View style={styles.modal}>
      <View style={styles.modalContent}>
        <View style={styles.modalHeader}>
          <Text variant="body" style={styles.modalTitle}>Ajouter à la Swap Zone</Text>
          <Pressable
            style={({ pressed }) => [styles.modalDoneButton, pressed && { opacity: 0.7 }]}
            onPress={onClose}
          >
            <Text style={styles.modalDoneText}>Terminé</Text>
          </Pressable>
        </View>

        <View style={styles.modalSubtextRow}>
          <Text style={styles.modalSubtext}>
            Cet article sera proposé à l&apos;échange dans la Swap Zone.
          </Text>
        </View>

        {userItems.length > 0 && (
          <View style={styles.modalAddedCount}>
            <Ionicons name="checkmark-circle" size={14} color={colors.sage} />
            <Text style={styles.modalAddedCountText}>
              {userItems.length} article{userItems.length > 1 ? 's' : ''} dans la Swap Zone
            </Text>
          </View>
        )}

        {loading ? (
          <View style={styles.stateBox}>
            <ActivityIndicator color={colors.sage} />
            <Caption style={styles.stateText}>Chargement de tes articles…</Caption>
          </View>
        ) : availableArticles.length === 0 ? (
          <View style={styles.stateBox}>
            <Caption style={styles.stateText}>{emptyText}</Caption>
          </View>
        ) : (
          <ScrollView
            style={styles.list}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
          >
            {availableArticles.map(renderRow)}
          </ScrollView>
        )}
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
  modalSubtextRow: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  modalSubtext: {
    fontSize: 12,
    fontFamily: fonts.sans,
    color: colors.muted,
    lineHeight: 17,
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
  // List area: flexShrink lets it scroll WITHIN the content-sized sheet.
  list: {
    flexShrink: 1,
  },
  listContent: {
    paddingBottom: spacing.md,
  },
  stateBox: {
    paddingVertical: spacing['2xl'],
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    gap: spacing.sm,
  },
  stateText: {
    fontSize: 12,
    fontFamily: fonts.sans,
    color: colors.muted,
    textAlign: 'center',
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
});
