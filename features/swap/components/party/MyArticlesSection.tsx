/** Your deposited articles, clearly separated from the discovery catalogue. */
import React, { useMemo, useState } from 'react';
import { View, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  FadeIn,
  FadeOut,
  LinearTransition,
} from 'react-native-reanimated';

import { Text, Button } from '@/components/ui';
import {
  colors,
  spacing,
  radius,
  sizing,
  typography,
  animations,
} from '@/constants/theme';
import { formatPrice } from '@/utils/formatPrice';
import type { MyArticlesSectionProps } from '@/features/swap/types';

export const MyArticlesSection = React.memo(function MyArticlesSection({
  userItems,
  onAddPress,
  onRemoveItem,
  pendingCount = 0,
  removingArticleIds,
  isGuest = false,
  compact = false,
}: MyArticlesSectionProps) {
  const [expanded, setExpanded] = useState(false);
  const showList = userItems.length > 0 || pendingCount > 0;
  const skeletonRows = useMemo(
    () => Array.from({ length: pendingCount }, (_, i) => i),
    [pendingCount],
  );
  return (
    <View style={[styles.section, compact && styles.compactSection]}>
      {!compact && (
        <View style={styles.labelRow}>
          <Text style={styles.label} accessibilityRole="header">
            Vos articles
          </Text>
          {showList && (
            <Text style={styles.count}>{userItems.length + pendingCount}</Text>
          )}
        </View>
      )}
      {isGuest && (
        <Text style={styles.helper}>
          Connectez-vous pour proposer vos articles à l’échange.
        </Text>
      )}
      {!compact && (
        <Button onPress={onAddPress} accessibilityLabel="Ajouter des articles" leftIcon={<Ionicons name="add" size={sizing.iconMD} color={colors.primary}/>}>Ajouter des articles</Button>
      )}
      {userItems.length > 0 && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${expanded ? 'Masquer' : 'Afficher'} ${userItems.length} article${userItems.length > 1 ? 's' : ''}`}
          accessibilityState={{ expanded }}
          style={({ pressed }) => [
            styles.toggleButton,
            pressed && styles.pressed,
          ]}
          onPress={() => setExpanded((value) => !value)}
        >
          <Text style={styles.toggleLabel}>
            {compact
              ? 'Vos articles'
              : `${expanded ? 'Masquer' : 'Afficher'} ${userItems.length} article${userItems.length > 1 ? 's' : ''}`}
          </Text>
          {compact && <Text style={styles.count}>{userItems.length}</Text>}
          <Ionicons
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={sizing.iconSM}
            color={colors.foregroundSecondary}
          />
        </Pressable>
      )}
      {pendingCount > 0 && (
        <Text style={styles.pendingLabel} accessibilityLiveRegion="polite">
          Ajout de {pendingCount} article{pendingCount > 1 ? 's' : ''} en cours…
        </Text>
      )}
      {(pendingCount > 0 || (expanded && userItems.length > 0)) && (
        <View style={styles.list}>
          {skeletonRows.map((i) => (
            <View
              key={`skeleton-${i}`}
              style={styles.row}
              accessibilityLabel="Ajout de votre article en cours"
              accessibilityState={{ busy: true }}
            >
              <View style={styles.skeletonThumb} />
              <View style={styles.rowInfo}>
                <View style={[styles.skeletonLine, styles.skeletonLineTitle]} />
                <View style={[styles.skeletonLine, styles.skeletonLinePrice]} />
              </View>
            </View>
          ))}
          {expanded &&
            userItems.map((item) => (
              <Animated.View
                key={item.id}
                style={styles.row}
                entering={FadeIn.duration(animations.duration.normal)}
                exiting={FadeOut.duration(animations.duration.fast)}
                layout={LinearTransition.duration(animations.duration.normal)}
              >
                <View style={styles.rowImageWrap}>
                  <Image
                    source={{ uri: item.imageUrl }}
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
                <Pressable
                  style={({ pressed }) => [
                    styles.removeRow,
                    pressed && styles.pressed,
                  ]}
                  onPress={() => onRemoveItem(item.articleId)}
                  disabled={removingArticleIds?.has(item.articleId)}
                  accessibilityRole="button"
                  accessibilityLabel={`Retirer ${item.title} du Troc`}
                >
                  {removingArticleIds?.has(item.articleId) ? <ActivityIndicator size="small" color={colors.foreground}/> : <Ionicons
                    name="close"
                    size={sizing.iconSM}
                    color={colors.foreground}
                  />}
                </Pressable>
              </Animated.View>
            ))}
        </View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  section: {
    backgroundColor: colors.background,
    padding: spacing.md,
    marginVertical: spacing.sm,
    borderRadius: radius.none,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  compactSection: {
    padding: 0,
    marginVertical: 0,
    borderWidth: 0,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderStrong,
  },
  pressed: { opacity: 0.7 },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  label: {
    ...typography.trocItemTitle,
    color: colors.foreground,
    flexShrink: 1,
  },
  count: {
    ...typography.caption,
    color: colors.foregroundSecondary,
    backgroundColor: colors.surfaceWarm,
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  helper: { ...typography.bodySmall, color: colors.foregroundSecondary },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: sizing.minTouchTarget,
    backgroundColor: colors.primaryDark,
    borderRadius: radius.none,
    padding: spacing.sm,
  },
  addButtonLabel: { ...typography.label, color: colors.white, flex: 1 },
  toggleButton: {
    minHeight: sizing.minTouchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  toggleLabel: {
    ...typography.bodySmall,
    color: colors.foregroundSecondary,
    flex: 1,
  },
  pendingLabel: { ...typography.caption, color: colors.foregroundSecondary },
  list: { gap: spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  rowImageWrap: {
    width: sizing.buttonHeight,
    aspectRatio: 4 / 5,
    backgroundColor: colors.surfaceWarm,
    overflow: 'hidden',
    borderRadius: radius.sm,
  },
  rowImage: { width: '100%', height: '100%' },
  rowInfo: { flex: 1, gap: spacing.xs },
  rowTitle: { ...typography.body, color: colors.foreground },
  rowMeta: { ...typography.caption, color: colors.foregroundSecondary },
  removeRow: {
    width: sizing.minTouchTarget,
    height: sizing.minTouchTarget,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.surfaceWarm,
    borderRadius: radius.full,
  },
  skeletonThumb: {
    width: sizing.buttonHeight,
    aspectRatio: 4 / 5,
    backgroundColor: colors.surfaceWarm,
    borderRadius: radius.sm,
  },
  skeletonLine: {
    backgroundColor: colors.surfaceWarm,
    borderRadius: radius.xs,
  },
  skeletonLineTitle: { width: '80%', height: typography.body.lineHeight },
  skeletonLinePrice: { width: '55%', height: typography.caption.lineHeight },
});
