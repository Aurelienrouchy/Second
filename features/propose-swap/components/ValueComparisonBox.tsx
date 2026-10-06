/**
 * ValueComparisonBox — Shows value totals, difference indicator, and optional cash top-up controls.
 */

import React from 'react';
import { View, Pressable, TextInput, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Text } from '@/components/ui';
import { colors, fonts, spacing, radius, sizing } from '@/constants/theme';
import { PAYMENTS_ENABLED } from '@/config/featureFlags';
import { formatPrice } from '@/utils/formatPrice';

type ValueComparisonBoxProps = {
  initiatorTotal: number;
  receiverTotal: number;
  complementAmount: string;
  complementPayer: 'initiator' | 'receiver';
  receiverName: string | undefined;
  onComplementAmountChange: (value: string) => void;
  onComplementPayerChange: (payer: 'initiator' | 'receiver') => void;
  disabled?: boolean;
};

export const ValueComparisonBox = React.memo(function ValueComparisonBox({
  initiatorTotal,
  receiverTotal,
  complementAmount,
  complementPayer,
  receiverName,
  onComplementAmountChange,
  onComplementPayerChange,
  disabled = false,
}: ValueComparisonBoxProps) {
  const valueDifference = Math.abs(receiverTotal - initiatorTotal);
  const receiverHasMore = receiverTotal > initiatorTotal;

  return (
    <View style={styles.container}>
      <View style={styles.box}>
        <Text style={styles.contextLabel}>Valeur affichée · à titre indicatif</Text>
        {/* Price summary row */}
        <View style={styles.priceSummaryRow}>
          <View style={styles.priceSummaryItem}>
            <Text style={styles.priceSummaryLabel}>Vos articles</Text>
            <Text style={styles.priceSummaryValue}>{formatPrice(initiatorTotal)}</Text>
          </View>
          <View style={styles.priceSummaryDivider} />
          <View style={styles.priceSummaryItem}>
            <Text style={styles.priceSummaryLabel}>{receiverName ? `Articles de ${receiverName}` : 'Articles à recevoir'}</Text>
            <Text style={styles.priceSummaryValue}>{formatPrice(receiverTotal)}</Text>
          </View>
        </View>

        {/* Difference indicator */}
        {valueDifference > 0 ? (
          <View style={styles.diffIndicator}>
            <Ionicons name="information-circle-outline" size={14} color={colors.rust} />
            <Text style={styles.diffIndicatorText}>
              {receiverHasMore
                ? `Différence de ${formatPrice(valueDifference)} en sa faveur`
                : `Différence de ${formatPrice(valueDifference)} en votre faveur`}
            </Text>
          </View>
        ) : (
          <View style={[styles.diffIndicator, styles.diffIndicatorEven]}>
            <Ionicons name="checkmark-circle-outline" size={14} color={colors.sage} />
            <Text style={[styles.diffIndicatorText, styles.diffIndicatorTextEven]}>
              Valeurs équivalentes
            </Text>
          </View>
        )}
        <Text style={styles.indicativeNote}>Un écart de valeur n’empêche pas l’échange.</Text>

        {/* Cash top-up section */}
        {PAYMENTS_ENABLED && <View style={styles.cashTopUpSection}>
          <Text style={styles.cashTopUpTitle}>Ajouter un complément en argent</Text>

          {/* Payer toggle */}
          <View style={styles.payerToggleRow}>
            <Pressable
              style={({ pressed }) => [
                styles.payerToggleButton,
                complementPayer === 'initiator' && styles.payerToggleButtonActive,
                pressed && styles.pressed,
              ]}
              onPress={() => onComplementPayerChange('initiator')}
              disabled={disabled}
              accessibilityRole="button"
              accessibilityState={{ selected: complementPayer === 'initiator', disabled }}
            >
              <Text
                style={[
                  styles.payerToggleText,
                  complementPayer === 'initiator' && styles.payerToggleTextActive,
                ]}
              >
                Je paie
              </Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.payerToggleButton,
                complementPayer === 'receiver' && styles.payerToggleButtonActive,
                pressed && styles.pressed,
              ]}
              onPress={() => onComplementPayerChange('receiver')}
              disabled={disabled}
              accessibilityRole="button"
              accessibilityState={{ selected: complementPayer === 'receiver', disabled }}
            >
              <Text
                style={[
                  styles.payerToggleText,
                  complementPayer === 'receiver' && styles.payerToggleTextActive,
                ]}
              >
                {receiverName ? `${receiverName} paie` : "L'autre paie"}
              </Text>
            </Pressable>
          </View>

          {/* Amount input */}
          <View style={styles.cashAmountRow}>
            <TextInput
              style={styles.cashAmountInput}
              placeholder="0"
              placeholderTextColor={colors.muted}
              value={complementAmount}
              onChangeText={(text) => onComplementAmountChange(text.replace(/[^0-9]/g, ''))}
              keyboardType="number-pad"
              maxLength={4}
              accessibilityLabel="Montant du complément en dollars"
              editable={!disabled}
            />
            <Text style={styles.cashAmountDollar}>$</Text>
            {valueDifference > 0 && (
              <Pressable
                style={({ pressed }) => [styles.suggestAmountButton, pressed && styles.pressed]}
                onPress={() => onComplementAmountChange(String(valueDifference))}
                disabled={disabled}
                accessibilityRole="button"
                accessibilityState={{ disabled }}
              >
                <Text style={styles.suggestAmountText}>
                  Suggéré : {formatPrice(valueDifference)}
                </Text>
              </Pressable>
            )}
          </View>
        </View>}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    marginBottom: spacing.lg,
  },
  box: {
    backgroundColor: colors.surfaceWarm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.xl,
    padding: spacing.md,
  },
  contextLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    lineHeight: 18,
    color: colors.foregroundSecondary,
    marginBottom: spacing.md,
  },
  indicativeNote: {
    fontFamily: fonts.sans,
    fontSize: 13,
    lineHeight: 20,
    color: colors.foregroundSecondary,
  },
  priceSummaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  priceSummaryItem: {
    flex: 1,
    alignItems: 'center',
  },
  priceSummaryLabel: {
    fontFamily: fonts.sans,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
    color: colors.foregroundSecondary,
    marginBottom: 4,
  },
  priceSummaryValue: {
    fontFamily: fonts.displayMedium,
    fontSize: 26,
    lineHeight: 30,
    color: colors.charcoal,
  },
  priceSummaryDivider: {
    width: 1,
    height: 32,
    backgroundColor: colors.borderStrong,
  },
  diffIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 10,
    backgroundColor: colors.primaryLight,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
  },
  diffIndicatorEven: {
    backgroundColor: colors.sageLight,
  },
  diffIndicatorText: {
    fontFamily: fonts.sans,
    fontSize: 12,
    lineHeight: 18,
    flex: 1,
    color: colors.rust,
  },
  diffIndicatorTextEven: {
    color: colors.sage,
  },
  cashTopUpSection: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 14,
    marginTop: spacing.md,
  },
  cashTopUpTitle: {
    fontFamily: fonts.sansMedium,
    fontSize: 14,
    lineHeight: 20,
    color: colors.charcoal,
    marginBottom: 10,
  },
  payerToggleRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  payerToggleButton: {
    minHeight: sizing.minTouchTarget,
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  payerToggleButtonActive: {
    backgroundColor: colors.charcoal,
    borderColor: colors.charcoal,
  },
  payerToggleText: {
    fontFamily: fonts.sans,
    fontSize: 12,
    fontWeight: '400',
    color: colors.muted,
  },
  payerToggleTextActive: {
    color: colors.cream,
    fontFamily: fonts.sansMedium,
    fontWeight: '500',
  },
  cashAmountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  cashAmountDollar: {
    fontFamily: fonts.display,
    fontSize: 18,
    fontWeight: '300',
    color: colors.charcoal,
  },
  cashAmountInput: {
    flexGrow: 1,
    minWidth: 80,
    minHeight: sizing.minTouchTarget,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontFamily: fonts.sans,
    fontSize: 16,
    fontWeight: '400',
    color: colors.charcoal,
    backgroundColor: colors.surface,
  },
  suggestAmountButton: {
    minHeight: sizing.minTouchTarget,
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: colors.primaryLight,
    borderRadius: radius.md,
  },
  suggestAmountText: {
    fontFamily: fonts.sansMedium,
    fontSize: 11,
    fontWeight: '500',
    color: colors.rust,
  },
  pressed: {
    opacity: 0.7,
  },
});
