/**
 * PayButton
 * Sticky footer CTA for checkout payment.
 */

import React from 'react';
import { View, Text, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { colors, fonts, radius } from '@/constants/theme';
import { formatPrice } from '@/utils/formatPrice';

// =============================================================================
// TYPES
// =============================================================================

interface PayButtonProps {
  totalAmount: number;
  canPay: boolean;
  submitting: boolean;
  onPress: () => void;
  bottomInset: number;
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
}: PayButtonProps) {
  return (
    <View style={[styles.footer, { paddingBottom: bottomInset + 16 }]}>
      <Pressable
        style={[
          styles.ctaButton,
          (!canPay || submitting) && styles.ctaButtonDisabled,
        ]}
        onPress={onPress}
        disabled={!canPay || submitting}
      >
        {submitting ? (
          <ActivityIndicator size="small" color={colors.cream} />
        ) : (
          <>
            <Ionicons name="lock-closed-outline" size={16} color={colors.cream} />
            <Text style={styles.ctaButtonText}>
              PAYER {formatPrice(totalAmount)}
            </Text>
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
