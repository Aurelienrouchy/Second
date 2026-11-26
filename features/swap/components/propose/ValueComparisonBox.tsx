/**
 * ValueComparisonBox — Shows value totals, difference indicator, and optional cash top-up controls.
 */

import React from 'react';
import { View, Pressable, TextInput, StyleSheet } from 'react-native';

import { Text } from '@/components/ui';
import { colors, fonts, spacing, radius, sizing } from '@/constants/theme';
import { PAYMENTS_ENABLED } from '@/config/featureFlags';
import { SwapValueTotals } from '../shared/SwapValueTotals';
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

  return (
    <View style={styles.container}>
      <View>
        <SwapValueTotals
          receivedTotal={receiverTotal}
          proposedTotal={initiatorTotal}
        />
        {/* Cash top-up section */}
        {PAYMENTS_ENABLED && (
          <View style={styles.cashTopUpSection}>
            <Text style={styles.cashTopUpTitle}>
              Ajouter un complément en argent
            </Text>

            {/* Payer toggle */}
            <View style={styles.payerToggleRow}>
              <Pressable
                style={({ pressed }) => [
                  styles.payerToggleButton,
                  complementPayer === 'initiator' &&
                    styles.payerToggleButtonActive,
                  pressed && styles.pressed,
                ]}
                onPress={() => onComplementPayerChange('initiator')}
                disabled={disabled}
                accessibilityRole="button"
                accessibilityState={{
                  selected: complementPayer === 'initiator',
                  disabled,
                }}
              >
                <Text
                  style={[
                    styles.payerToggleText,
                    complementPayer === 'initiator' &&
                      styles.payerToggleTextActive,
                  ]}
                >
                  Je paie
                </Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.payerToggleButton,
                  complementPayer === 'receiver' &&
                    styles.payerToggleButtonActive,
                  pressed && styles.pressed,
                ]}
                onPress={() => onComplementPayerChange('receiver')}
                disabled={disabled}
                accessibilityRole="button"
                accessibilityState={{
                  selected: complementPayer === 'receiver',
                  disabled,
                }}
              >
                <Text
                  style={[
                    styles.payerToggleText,
                    complementPayer === 'receiver' &&
                      styles.payerToggleTextActive,
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
                onChangeText={onComplementAmountChange}
                keyboardType="decimal-pad"
                maxLength={7}
                accessibilityLabel="Montant du complément en dollars"
                editable={!disabled}
              />
              <Text style={styles.cashAmountDollar}>$</Text>
              {valueDifference > 0 && (
                <Pressable
                  style={({ pressed }) => [
                    styles.suggestAmountButton,
                    pressed && styles.pressed,
                  ]}
                  onPress={() =>
                    onComplementAmountChange((Math.round(valueDifference * 100) / 100).toFixed(2))
                  }
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
          </View>
        )}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    marginBottom: spacing.lg,
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
    borderRadius: radius.none,
    alignItems: 'center',
    justifyContent: 'center',
  },
  payerToggleButtonActive: {
    backgroundColor: colors.primaryDark,
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
    fontFamily: fonts.sansBold,
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
    borderRadius: radius.none,
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
    backgroundColor: colors.background,
    borderRadius: radius.none,
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
