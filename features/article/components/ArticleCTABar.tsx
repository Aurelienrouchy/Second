/**
 * ArticleCTABar — sticky bottom bar with buy / make-offer / propose-swap / "your article" states.
 */

import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, Text, View } from 'react-native';

import { colors } from '@/constants/theme';
import { formatPrice } from '@/utils/formatPrice';

import { articleStyles as styles } from '../styles';

export interface ArticleCTABarProps {
  isOwnArticle: boolean;
  isSold: boolean;
  /**
   * Article temporairement réservé : une transaction est en cours (meetup_pending)
   * mais la vente n'est pas encore confirmée. Distinct de `isSold` (confirmed/paid).
   */
  isReserved?: boolean;
  isSwapContext: boolean;
  /** Reflète `SHIPPING_ENABLED` : sans expédition, l'achat est une proposition meetup. */
  shippingEnabled: boolean;
  price: number;
  bottomInset: number;
  onBuy: () => void;
  onMakeOffer: () => void;
  onProposeSwap: () => void;
}

function ArticleCTABarComponent({
  isOwnArticle,
  isSold,
  isReserved = false,
  isSwapContext,
  shippingEnabled,
  price,
  bottomInset,
  onBuy,
  onMakeOffer,
  onProposeSwap,
}: ArticleCTABarProps) {
  if (isSold || isReserved) {
    return (
      <View style={[styles.bottomBar, { paddingBottom: Math.max(bottomInset, 16) }]}>
        <View style={styles.ownArticleBar}>
          <Ionicons
            name={isSold ? 'checkmark-circle' : 'time-outline'}
            size={18}
            color={colors.muted}
          />
          <Text style={styles.ownArticleText}>
            {isSold ? 'Article vendu' : 'Réservé temporairement'}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.bottomBar, { paddingBottom: Math.max(bottomInset, 16) }]}>
      {isOwnArticle ? (
        <View style={styles.ownArticleBar}>
          <Ionicons name="checkmark-circle" size={18} color={colors.muted} />
          <Text style={styles.ownArticleText}>C'est votre article</Text>
        </View>
      ) : isSwapContext ? (
        <Pressable style={styles.swapButton} onPress={onProposeSwap}>
          <Ionicons name="swap-horizontal" size={18} color={colors.white} />
          <Text style={styles.swapButtonText}>PROPOSER UN ÉCHANGE</Text>
        </Pressable>
      ) : (
        <View style={styles.ctaRow}>
          <Pressable style={styles.offerOutlineButton} onPress={onMakeOffer}>
            <Text style={styles.offerOutlineText}>OFFRE</Text>
          </Pressable>
          <Pressable style={styles.buyButton} onPress={onBuy}>
            <Ionicons name="bag-handle-outline" size={16} color={colors.cream} />
            <Text style={styles.buyButtonText}>
              {shippingEnabled
                ? `ACHETER · ${formatPrice(price)}`
                : 'PROPOSER UN ACHAT'}
            </Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

export const ArticleCTABar = React.memo(ArticleCTABarComponent);
