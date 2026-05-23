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
  isSwapContext: boolean;
  price: number;
  bottomInset: number;
  onBuy: () => void;
  onMakeOffer: () => void;
  onProposeSwap: () => void;
}

function ArticleCTABarComponent({
  isOwnArticle,
  isSwapContext,
  price,
  bottomInset,
  onBuy,
  onMakeOffer,
  onProposeSwap,
}: ArticleCTABarProps) {
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
          <Text style={styles.swapButtonText}>PROPOSER UN SWAP</Text>
        </Pressable>
      ) : (
        <View style={styles.ctaRow}>
          <Pressable style={styles.offerOutlineButton} onPress={onMakeOffer}>
            <Text style={styles.offerOutlineText}>OFFRE</Text>
          </Pressable>
          <Pressable style={styles.buyButton} onPress={onBuy}>
            <Ionicons name="bag-handle-outline" size={16} color={colors.cream} />
            <Text style={styles.buyButtonText}>ACHETER · {formatPrice(price)}</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

export const ArticleCTABar = React.memo(ArticleCTABarComponent);
