/** Real catalogue article, with a larger first placement and one-seller selection. */
import React from 'react';
import { StyleSheet, Pressable, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeIn, LinearTransition } from 'react-native-reanimated';
import { Text } from '@/components/ui';
import {
  colors,
  spacing,
  radius,
  sizing,
  typography,
  animations,
  components,
} from '@/constants/theme';
import { getConditionLabel } from '@/data/conditions';
import { formatPrice } from '@/utils/formatPrice';
import { formatDisplayName } from '@/utils/formatName';
import type { PartyItemCardProps } from '../../types';

export const PartyItemCard = React.memo(function PartyItemCard({
  item,
  isSelected,
  isMultiSelectMode,
  disabled = false,
  featured = false,
  onPress,
  onLongPress,
}: PartyItemCardProps) {
  return (
    <Animated.View
      style={styles.cardWrapper}
      entering={FadeIn.duration(animations.duration.normal)}
      layout={LinearTransition.duration(animations.duration.normal)}
    >
      <Pressable
        testID={`troc-item-${item.articleId}`}
        accessibilityRole={isMultiSelectMode ? 'checkbox' : 'button'}
        accessibilityLabel={`${item.title}${item.brand ? `, ${item.brand}` : ''}${item.size?.value ? `, taille ${item.size.value}` : ''}, valeur ${formatPrice(item.price)}`}
        accessibilityHint={
          disabled
            ? 'Choisissez des articles de la même personne.'
            : isMultiSelectMode
              ? 'Ajouter ou retirer cet article de votre sélection.'
              : 'Proposer vos articles en échange. Appuyez longuement pour en choisir plusieurs.'
        }
        accessibilityState={{
          disabled,
          ...(isMultiSelectMode ? { checked: isSelected } : {}),
        }}
        style={({ pressed }) => [
          styles.productCard,
          featured && styles.featuredCard,
          isSelected && styles.selected,
          pressed && !disabled && styles.pressed,
          disabled && styles.disabled,
        ]}
        onPress={onPress}
        onLongPress={onLongPress}
        disabled={disabled}
      >
        <View style={[styles.imageFrame, featured && styles.featuredImage]}>
          {item.imageUrl ? (
            <Image
              source={{ uri: item.imageUrl }}
              style={styles.image}
              contentFit={featured ? 'contain' : 'cover'}
              recyclingKey={item.id}
              accessibilityLabel={item.title}
            />
          ) : (
            <Ionicons
              name="image-outline"
              size={sizing.iconMD}
              color={colors.muted}
            />
          )}
          {isMultiSelectMode && (
            <View
              style={[styles.checkbox, isSelected && styles.checkboxSelected]}
            >
              {isSelected && (
                <Ionicons
                  name="checkmark"
                  size={sizing.iconSM}
                  color={colors.white}
                />
              )}
            </View>
          )}
        </View>
        <View style={[styles.info, featured && styles.featuredInfo]}>
          {featured && !!item.sellerName && (
            <View style={styles.seller}>
              {item.sellerImage ? (
                <Image
                  source={{ uri: item.sellerImage }}
                  contentFit="cover"
                  style={styles.avatar}
                />
              ) : (
                <View style={styles.avatar}>
                  <Ionicons
                    name="person-outline"
                    size={sizing.iconSM}
                    color={colors.foregroundSecondary}
                  />
                </View>
              )}
              <Text style={styles.sellerLabel}>
                CHEZ {formatDisplayName(item.sellerName).toUpperCase()}
              </Text>
            </View>
          )}
          <Text style={[styles.title, featured && styles.featuredTitle]}>
            {item.title}
          </Text>
          <Text style={styles.meta}>
            {[
              item.size?.value,
              item.condition ? getConditionLabel(item.condition) : undefined,
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>
          {!featured && !!item.sellerName && (
            <Text style={styles.meta}>
              Par {formatDisplayName(item.sellerName)}
            </Text>
          )}
          {featured && (
            <View style={styles.propose}>
              <Text style={styles.proposeText}>
                {isMultiSelectMode
                  ? isSelected
                    ? 'Article sélectionné'
                    : 'Sélectionner cet article'
                  : 'Proposer un échange'}
              </Text>
              <Ionicons
                name="arrow-forward"
                size={sizing.iconSM}
                color={colors.primaryDark}
              />
            </View>
          )}
        </View>
      </Pressable>
    </Animated.View>
  );
});
const styles = StyleSheet.create({
  cardWrapper: {
    flex: 1,
    marginHorizontal: spacing.xs,
    marginBottom: spacing.md,
  },
  productCard: {
    flex: 1,
    backgroundColor: colors.background,
    borderWidth: components.troc.borderWidth,
    borderColor: colors.transparent,
    overflow: 'hidden',
  },
  featuredCard: { borderColor: colors.borderStrong },
  selected: {
    borderColor: colors.primaryDark,
    backgroundColor: colors.primaryLight,
  },
  pressed: { opacity: components.troc.pressedOpacity },
  disabled: { opacity: components.troc.disabledOpacity },
  imageFrame: {
    aspectRatio: components.troc.photoRatio,
    backgroundColor: colors.surfaceWarm,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  featuredImage: { aspectRatio: components.troc.featuredPhotoRatio },
  image: { width: '100%', height: '100%' },
  checkbox: {
    position: 'absolute',
    top: spacing.sm,
    left: spacing.sm,
    width: sizing.avatarSM,
    height: sizing.avatarSM,
    borderRadius: radius.full,
    borderWidth: components.troc.borderWidth,
    borderColor: colors.foreground,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
  },
  checkboxSelected: {
    backgroundColor: colors.primaryDark,
    borderColor: colors.primaryDark,
  },
  info: { paddingVertical: spacing.sm, gap: spacing.xs },
  featuredInfo: { paddingHorizontal: spacing.sm },
  title: { ...typography.label, color: colors.foreground },
  featuredTitle: { ...typography.trocItemTitle },
  meta: { ...typography.caption, color: colors.foregroundSecondary },
  seller: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  avatar: {
    width: components.troc.avatarSize,
    height: components.troc.avatarSize,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceWarm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sellerLabel: {
    ...typography.labelUppercase,
    flex: 1,
    color: colors.foreground,
  },
  propose: {
    borderTopWidth: components.troc.borderWidth,
    borderColor: colors.borderStrong,
    marginTop: spacing.xs,
    paddingVertical: spacing.sm,
    minHeight: sizing.minTouchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  proposeText: {
    ...typography.label,
    color: colors.primaryDark,
    flexShrink: 1,
  },
});
