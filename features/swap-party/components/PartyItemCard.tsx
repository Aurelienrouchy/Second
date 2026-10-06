/** Photo-first article card. Multiple selection stays scoped to one seller. */
import React from 'react';
import { StyleSheet, Pressable, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeIn, LinearTransition } from 'react-native-reanimated';

import { Text } from '@/components/ui';
import { colors, spacing, radius, sizing, typography, animations } from '@/constants/theme';
import { formatPrice } from '@/utils/formatPrice';
import type { PartyItemCardProps } from '../types';

export const PartyItemCard = React.memo(function PartyItemCard({ item, isSelected, isMultiSelectMode, disabled = false, tone = 'light', onPress, onLongPress }: PartyItemCardProps) {
  const isDark = tone === 'dark';
  return (
    <Animated.View style={styles.cardWrapper} entering={FadeIn.duration(animations.duration.normal)} layout={LinearTransition.duration(animations.duration.normal)}>
      <Pressable
        accessibilityRole={isMultiSelectMode ? 'checkbox' : 'button'}
        accessibilityLabel={`${item.title}${item.brand ? `, ${item.brand}` : ''}${item.size?.value ? `, taille ${item.size.value}` : ''}, valeur ${formatPrice(item.price)}`}
        accessibilityHint={disabled ? 'Choisissez des articles de la même personne.' : isMultiSelectMode ? 'Ajouter ou retirer cet article de votre sélection.' : 'Proposer vos articles en échange. Appuyez longuement pour en choisir plusieurs.'}
        accessibilityState={{ disabled, ...(isMultiSelectMode ? { checked: isSelected } : {}) }}
        style={({ pressed }) => [styles.productCard, isDark && styles.productCardDark, isSelected && styles.productCardSelected, pressed && !disabled && styles.pressed, disabled && styles.disabled]}
        onPress={onPress} onLongPress={onLongPress} disabled={disabled}
      >
        <View style={[styles.productImageWrapper, isDark && styles.productImageWrapperDark]}>
          {item.imageUrl ? <Image source={{ uri: item.imageUrl }} style={styles.productImage} contentFit="cover" recyclingKey={item.id} /> : <Ionicons name="shirt-outline" size={sizing.iconLG} color={colors.sandDeep} />}
          {isMultiSelectMode && (
            <View style={[styles.selectionCheckbox, isSelected && styles.selectionCheckboxSelected]}>
              {isSelected && <Ionicons name="checkmark" size={sizing.iconSM} color={colors.cream} />}
            </View>
          )}
          <View style={styles.swapBadge}><Text style={styles.swapBadgeText}>À échanger</Text></View>
        </View>
        <View style={styles.productInfo}>
          {!!item.brand?.trim() && <Text style={[styles.productBrand, isDark && styles.productBrandDark]}>{item.brand}</Text>}
          <Text style={[styles.productTitle, isDark && styles.productTitleDark]}>{item.title}</Text>
          <View style={styles.productFooter}>
            <Text style={[styles.productValue, isDark && styles.productValueDark]}>Valeur {formatPrice(item.price)}</Text>
            {!!item.size?.value && <Text style={[styles.productSize, isDark && styles.productSizeDark]}>{item.size.value}</Text>}
          </View>
        </View>
      </Pressable>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  cardWrapper: { flex: 1, marginHorizontal: spacing.xs, marginBottom: spacing.md },
  productCard: { flex: 1, backgroundColor: colors.cream, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, overflow: 'hidden' },
  productCardDark: { backgroundColor: colors.darkSurface1, borderColor: colors.darkBorder },
  productCardSelected: { borderColor: colors.sand, backgroundColor: colors.darkSurface2 },
  pressed: { opacity: 0.8 },
  disabled: { opacity: 0.35 },
  productImageWrapper: { position: 'relative', aspectRatio: 4 / 5, backgroundColor: colors.background, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  productImageWrapperDark: { backgroundColor: colors.darkSurface2 },
  productImage: { width: '100%', height: '100%' },
  swapBadge: { position: 'absolute', bottom: spacing.sm, left: spacing.sm, right: spacing.sm, alignSelf: 'flex-start', backgroundColor: colors.deep, paddingVertical: spacing.xs, paddingHorizontal: spacing.sm, borderRadius: radius.sm },
  swapBadgeText: { ...typography.caption, color: colors.cream },
  selectionCheckbox: { position: 'absolute', top: spacing.sm, left: spacing.sm, width: sizing.avatarSM, height: sizing.avatarSM, borderRadius: radius.full, borderWidth: 2, borderColor: colors.cream, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.overlay },
  selectionCheckboxSelected: { backgroundColor: colors.primaryDark, borderColor: colors.sand },
  productInfo: { padding: spacing.sm, gap: spacing.xs },
  productBrand: { ...typography.caption, color: colors.foregroundSecondary },
  productBrandDark: { color: colors.sand },
  productTitle: { ...typography.h3, color: colors.charcoal },
  productTitleDark: { color: colors.cream },
  productFooter: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignItems: 'center', justifyContent: 'space-between' },
  productValue: { ...typography.caption, color: colors.foregroundSecondary, flexShrink: 1 },
  productValueDark: { color: colors.creamTranslucent60 },
  productSize: { ...typography.caption, color: colors.foregroundSecondary },
  productSizeDark: { color: colors.sand },
});
