/**
 * ValueComparisonBox — Shows value totals, difference indicator, and optional cash top-up controls.
 */

import React from 'react';
import { View, Pressable, TextInput, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Text } from '@/components/ui';
import { colors, fonts } from '@/constants/theme';
import { formatPrice } from '@/utils/formatPrice';

type ValueComparisonBoxProps = {
  initiatorTotal: number;
  receiverTotal: number;
  complementAmount: string;
  complementPayer: 'initiator' | 'receiver';
  receiverName: string | undefined;
  onComplementAmountChange: (value: string) => void;
  onComplementPayerChange: (payer: 'initiator' | 'receiver') => void;
};

export const ValueComparisonBox = React.memo(function ValueComparisonBox({
  initiatorTotal,
  receiverTotal,
  complementAmount,
  complementPayer,
  receiverName,
  onComplementAmountChange,
  onComplementPayerChange,
}: ValueComparisonBoxProps) {
  const valueDifference = Math.abs(receiverTotal - initiatorTotal);
  const receiverHasMore = receiverTotal > initiatorTotal;

  return (
    <View style={styles.container}>
      <View style={styles.box}>
        {/* Price summary row */}
        <View style={styles.priceSummaryRow}>
          <View style={styles.priceSummaryItem}>
            <Text style={styles.priceSummaryLabel}>Vos articles</Text>
            <Text style={styles.priceSummaryValue}>{formatPrice(initiatorTotal)}</Text>
          </View>
          <View style={styles.priceSummaryDivider} />
          <View style={styles.priceSummaryItem}>
            <Text style={styles.priceSummaryLabel}>Leurs articles</Text>
            <Text style={styles.priceSummaryValue}>{formatPrice(receiverTotal)}</Text>
          </View>
        </View>

        {/* Difference indicator */}
        {valueDifference > 0 ? (
          <View style={styles.diffIndicator}>
            <Ionicons name="information-circle-outline" size={14} color={colors.rust} />
            <Text style={styles.diffIndicatorText}>
              {receiverHasMore
                ? `Différence de ${formatPrice(valueDifference)} en leur faveur`
                : `Différence de ${formatPrice(valueDifference)} en votre faveur`}
            </Text>
          </View>
        ) : (
          <View style={[styles.diffIndicator, styles.diffIndicatorEven]}>
            <Ionicons name="checkmark-circle-outline" size={14} color={colors.sage} />
            <Text style={[styles.diffIndicatorText, styles.diffIndicatorTextEven]}>
              Valeurs equivalentes
            </Text>
          </View>
        )}

        {/* Cash top-up section */}
        <View style={styles.cashTopUpSection}>
          <Text style={styles.cashTopUpTitle}>Ajouter un complement en argent</Text>

          {/* Payer toggle */}
          <View style={styles.payerToggleRow}>
            <Pressable
              style={({ pressed }) => [
                styles.payerToggleButton,
                complementPayer === 'initiator' && styles.payerToggleButtonActive,
                pressed && styles.pressed,
              ]}
              onPress={() => onComplementPayerChange('initiator')}
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
            <Text style={styles.cashAmountDollar}>$</Text>
            <TextInput
              style={styles.cashAmountInput}
              placeholder="0"
              placeholderTextColor={colors.muted}
              value={complementAmount}
              onChangeText={(text) => onComplementAmountChange(text.replace(/[^0-9]/g, ''))}
              keyboardType="number-pad"
              maxLength={6}
            />
            {valueDifference > 0 && (
              <Pressable
                style={({ pressed }) => [styles.suggestAmountButton, pressed && styles.pressed]}
                onPress={() => onComplementAmountChange(String(valueDifference))}
              >
                <Text style={styles.suggestAmountText}>
                  Suggéré: {formatPrice(valueDifference)}
                </Text>
              </Pressable>
            )}
          </View>
        </View>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    marginBottom: 20,
  },
  box: {
    backgroundColor: 'rgba(196, 96, 58, 0.07)',
    borderWidth: 1,
    borderColor: 'rgba(196, 96, 58, 0.2)',
    borderRadius: 4,
    padding: 16,
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
    fontSize: 10,
    fontWeight: '400',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: colors.muted,
    marginBottom: 4,
  },
  priceSummaryValue: {
    fontFamily: fonts.display,
    fontSize: 20,
    fontWeight: '300',
    lineHeight: 24,
    color: colors.charcoal,
  },
  priceSummaryDivider: {
    width: 1,
    height: 32,
    backgroundColor: 'rgba(196, 96, 58, 0.25)',
  },
  diffIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 10,
    backgroundColor: 'rgba(196, 96, 58, 0.08)',
    borderRadius: 6,
    marginBottom: 14,
  },
  diffIndicatorEven: {
    backgroundColor: 'rgba(94, 118, 89, 0.08)',
  },
  diffIndicatorText: {
    fontFamily: fonts.sans,
    fontSize: 12,
    fontWeight: '400',
    color: colors.rust,
  },
  diffIndicatorTextEven: {
    color: colors.sage,
  },
  cashTopUpSection: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(196, 96, 58, 0.15)',
    paddingTop: 14,
  },
  cashTopUpTitle: {
    fontFamily: fonts.sansMedium,
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 0.88,
    textTransform: 'uppercase',
    color: colors.charcoal,
    marginBottom: 10,
  },
  payerToggleRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  payerToggleButton: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 8,
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
    gap: 8,
  },
  cashAmountDollar: {
    fontFamily: fonts.display,
    fontSize: 18,
    fontWeight: '300',
    color: colors.charcoal,
  },
  cashAmountInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontFamily: fonts.sans,
    fontSize: 16,
    fontWeight: '400',
    color: colors.charcoal,
    backgroundColor: colors.surface,
  },
  suggestAmountButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(196, 96, 58, 0.12)',
    borderRadius: 6,
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
