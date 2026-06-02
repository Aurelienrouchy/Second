/**
 * PayButton
 * Sticky footer CTA for checkout payment.
 */

import React from 'react';
import { View, Text, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { colors, fonts, radius } from '@/constants/theme';
import { formatPriceWithCurrency } from '@/utils/formatPrice';

// =============================================================================
// TYPES
// =============================================================================

interface PayButtonProps {
  totalAmount: number;
  canPay: boolean;
  submitting: boolean;
  onPress: () => void;
  bottomInset: number;
  /** True when the wallet covers the full amount (no Stripe needed). */
  walletCoversAll?: boolean;
  /** True when wallet balance is being applied (partial or full). */
  useWallet?: boolean;
  /**
   * Extra disable condition (e.g. the Stripe sheet is already presented).
   * Combined with the internal `!canPay || submitting` guard.
   */
  disabled?: boolean;
}

// =============================================================================
// COMPONENT
// =============================================================================

export const PayButton = React.memo(function PayButton({
  totalAmount,
  canPay,
  submitting,
  onPress,
  bottomInset,
  walletCoversAll = false,
  useWallet = false,
  disabled = false,
}: PayButtonProps) {
  const isDisabled = !canPay || submitting || disabled;
  let label: string;
  let iconName: keyof typeof Ionicons.glyphMap = 'lock-closed-outline';

  if (walletCoversAll) {
    label = 'PAYER AVEC LE PORTE-MONNAIE';
    iconName = 'wallet-outline';
  } else if (useWallet) {
    label = `PAYER ${formatPrice(totalAmount)} PAR CARTE`;
  } else {
    label = `PAYER ${formatPrice(totalAmount)}`;
  }

  return (
    <View style={[styles.footer, { paddingBottom: bottomInset + 16 }]}>
      <Pressable
        style={[
          styles.ctaButton,
          isDisabled && styles.ctaButtonDisabled,
        ]}
        onPress={onPress}
        disabled={isDisabled}
      >
        {submitting ? (
          <ActivityIndicator size="small" color={colors.cream} />
        ) : (
          <>
            <Ionicons name={iconName} size={16} color={colors.cream} />
            <Text style={styles.ctaButtonText}>{label}</Text>
          </>
        )}
      </Pressable>
    </View>
  );
});

// =============================================================================
// STYLES
// =============================================================================

const styles = StyleSheet.create({
  footer: {
    backgroundColor: colors.cream,
    paddingTop: 16,
    paddingHorizontal: 20,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  ctaButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.rust,
    paddingVertical: 14,
    borderRadius: radius.md,
    gap: 8,
  },
  ctaButtonDisabled: {
    opacity: 0.6,
  },
  ctaButtonText: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    letterSpacing: 2.16,
    color: colors.cream,
    textTransform: 'uppercase',
  },
});
