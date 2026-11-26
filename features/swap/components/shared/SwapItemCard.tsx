import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SwapItemInfo } from '@/types';
import {
  colors,
  spacing,
  sizing,
  typography,
  components,
} from '@/constants/theme';
import { formatPriceWithCurrency } from '@/utils/formatPrice';
import { usePrivateArticleImage } from '@/hooks/usePrivateArticleImage';
import { useSwapProposalImage } from '../../hooks/useSwapProposalImage';

export interface SwapItemCardProps {
  item: SwapItemInfo;
  variant?:
    'their' | 'mine' | 'receiver' | 'initiator' | 'default' | 'selected';
  showValue?: boolean;
  compact?: boolean;
  onRemove?: () => void;
  swapId?: string;
  publicSellerId?: string;
  acceptedAgreement?: boolean;
  privacyWithdrawalRecorded?: boolean;
}
const SwapItemCard = React.memo(function SwapItemCard({
  item,
  showValue = true,
  compact = false,
  onRemove,
  swapId,
  publicSellerId,
  acceptedAgreement = false,
  privacyWithdrawalRecorded = false,
}: SwapItemCardProps) {
  const image = usePrivateArticleImage(swapId && acceptedAgreement ? { articleId: item.articleId, swapId } : null,
    item.imageUrl ?? null, privacyWithdrawalRecorded);
  // A proposed native swap never authorizes private evidence. Catalogue and
  // pre-proposal cards continue to use their current public projection.
  const proposalImage = useSwapProposalImage(item.articleId, item.imageUrl ?? null, publicSellerId, !!swapId && !acceptedAgreement && !privacyWithdrawalRecorded);
  const imageSource = swapId ? acceptedAgreement ? image.image : proposalImage : privacyWithdrawalRecorded ? null : item.imageUrl;
  return (
    <View style={styles.container}>
      <View style={[styles.imageWrapper, compact && styles.compactImage]}>
        {imageSource ? (
          <Image
            source={{ uri: imageSource }}
            style={styles.image}
            contentFit="contain"
            accessibilityLabel={item.title}
            cachePolicy={swapId || imageSource.startsWith('data:') ? 'none' : 'memory-disk'}
          />
        ) : (
          <Ionicons
            name="image-outline"
            size={sizing.iconMD}
            color={colors.muted}
          />
        )}
        {onRemove && (
          <Pressable
            style={styles.removeButton}
            onPress={onRemove}
            accessibilityRole="button"
            accessibilityLabel={`Retirer ${item.title}`}
          >
            <Ionicons
              name="close"
              size={sizing.iconSM}
              color={colors.foreground}
            />
          </Pressable>
        )}
      </View>
      <View style={styles.content}>
        <Text style={styles.title}>{item.title}</Text>

        {(item.brand || item.size?.value) && (
          <Text style={styles.metadata}>
            {[
              item.brand,
              item.size?.value ? `Taille ${item.size.value}` : undefined,
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        )}
        {showValue && (
          <Text style={styles.value}>
            Valeur indiquée ·{' '}
            {formatPriceWithCurrency(item.price).replace(/ /g, '\u00A0')}
          </Text>
        )}
      </View>
    </View>
  );
});
const styles = StyleSheet.create({
  container: { gap: spacing.sm, marginBottom: spacing.md },
  imageWrapper: {
    width: '100%',
    aspectRatio: components.troc.photoRatio,
    overflow: 'hidden',
    backgroundColor: colors.surfaceWarm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  compactImage: { aspectRatio: components.troc.comparisonMultiPhotoRatio },
  image: { width: '100%', height: '100%' },
  content: { gap: spacing.xs },
  title: { ...typography.trocComparisonTitle, color: colors.foreground },
  metadata: { ...typography.caption, color: colors.foregroundSecondary },
  value: { ...typography.caption, color: colors.foregroundSecondary },
  removeButton: {
    position: 'absolute',
    right: spacing.xs,
    top: spacing.xs,
    width: sizing.minTouchTarget,
    minHeight: sizing.minTouchTarget,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
  },
});
export default SwapItemCard;
