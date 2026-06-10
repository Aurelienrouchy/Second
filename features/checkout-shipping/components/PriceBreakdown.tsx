/**
 * PriceBreakdown
 * Shows article price, shipping, service fee, and total.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { colors, fonts, radius, spacing } from '@/constants/theme';
import { formatPrice, formatPriceWithCurrency } from '@/utils/formatPrice';
import type { ShippingEstimate } from '../types';
import { CHECKOUT_COPY } from '../types';

// =============================================================================
// TYPES
// =============================================================================

interface PriceBreakdownProps {
  articlePrice: number;
  selectedEstimate: ShippingEstimate | null;
  serviceFee: number;
  totalAmount: number;
  /**
   * Sales tax (TPS/TVQ) charged on the service fee. 0 when TAX_ENABLED=false
   * (backend default) — the line is then hidden, leaving the recap visually
   * unchanged. Already included in `totalAmount` when > 0 (audit F133).
   */
  taxTotal?: number;
}

// =============================================================================
// COMPONENT
// =============================================================================

export const PriceBreakdown = React.memo(function PriceBreakdown({
  articlePrice,
  selectedEstimate,
  serviceFee,
  totalAmount,
}: PriceBreakdownProps) {
  return (
    <>
      <Text style={styles.sectionTitle}>RÉCAPITULATIF</Text>
      <View style={styles.priceBreakdown}>
        <View style={styles.priceRow}>
          <Text style={styles.priceLabel}>Article</Text>
          <Text style={styles.priceValue}>{formatPrice(articlePrice)}</Text>
        </View>
        {selectedEstimate && (
          <View style={styles.priceRow}>
            <Text style={styles.priceLabel}>
              Livraison ({selectedEstimate.carrier}{' '}
              {selectedEstimate.serviceName})
            </Text>
            <Text style={styles.priceValue}>
              {formatPrice(selectedEstimate.amount)}
            </Text>
          </View>
        )}
        <View style={styles.priceRow}>
          <Text style={styles.priceLabel}>Frais de protection Seconde</Text>
          <Text style={styles.priceValue}>{formatPrice(serviceFee)}</Text>
        </View>
        <View style={styles.priceDivider} />
        <View style={styles.priceRowTotal}>
          <Text style={styles.priceTotalLabel}>Total</Text>
          <Text style={styles.priceTotalValue}>
            {formatPriceWithCurrency(totalAmount)}
          </Text>
        </View>
      </View>

      <View style={styles.securityNotice}>
        <Ionicons name="shield-checkmark" size={16} color={colors.success} />
        <Text style={styles.securityNoticeText}>
          Paiement sécurisé par Stripe — Vos données bancaires ne sont jamais
          stockées par Seconde
        </Text>
      </View>

      <View style={styles.protectionBox}>
        <Ionicons
          name="lock-closed-outline"
          size={18}
          color={colors.success}
        />
        <View style={styles.protectionTextWrap}>
          <Text style={styles.protectionTitle}>
            {CHECKOUT_COPY.buyerProtectionTitle}
          </Text>
          <Text style={styles.protectionBody}>
            {CHECKOUT_COPY.buyerProtectionBody}
          </Text>
        </View>
      </View>
    </>
  );
});

// =============================================================================
// STYLES
// =============================================================================

const styles = StyleSheet.create({
  sectionTitle: {
    fontFamily: fonts.sansMedium,
    fontSize: 9,
    letterSpacing: 1.8,
    color: colors.muted,
    marginBottom: 12,
    marginTop: 20,
    textTransform: 'uppercase',
  },
  priceBreakdown: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    padding: 16,
    marginTop: 4,
  },
  priceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  priceLabel: {
    fontFamily: fonts.sans,
    fontSize: 13,
    color: colors.muted,
  },
  priceValue: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    color: colors.charcoal,
  },
  priceDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: 8,
  },
  priceRowTotal: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  priceTotalLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: 14,
    color: colors.charcoal,
  },
  priceTotalValue: {
    fontFamily: fonts.displaySemiBold,
    fontSize: 22,
    color: colors.rust,
  },
  securityNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
    paddingHorizontal: 4,
  },
  securityNoticeText: {
    flex: 1,
    fontFamily: fonts.sans,
    fontSize: 11,
    color: colors.muted,
    lineHeight: 15,
  },
  protectionBox: {
    flexDirection: 'row',
    gap: spacing.sm,
    backgroundColor: colors.successLight,
    borderRadius: radius.sm,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  protectionTextWrap: {
    flex: 1,
  },
  protectionTitle: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    color: colors.charcoal,
    marginBottom: 4,
  },
  protectionBody: {
    fontFamily: fonts.sans,
    fontSize: 11,
    color: colors.foregroundSecondary,
    lineHeight: 16,
  },
});
