import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '@/components/ui';
import { SwapItemInfo } from '@/types';
import { colors, fonts, spacing, radius } from '@/constants/theme';
import { formatPriceWithCurrency } from '@/utils/formatPrice';

export interface SwapSummaryBoxProps {
  youReceive: string;
  youGive: string;
  receivedItems?: SwapItemInfo[];
  givenItems?: SwapItemInfo[];
  /** Legacy cash supplement, in dollars. */
  cashSupplement?: number;
  cashSupplementPayer?: 'you' | 'other' | 'unknown';
  cashSupplementPayerName?: string;
}

const SwapSummaryBox = React.memo(function SwapSummaryBox({
  youReceive, youGive, receivedItems, givenItems, cashSupplement,
  cashSupplementPayer = 'unknown', cashSupplementPayerName,
}: SwapSummaryBoxProps) {
  const receivedDisplay = receivedItems?.length ? receivedItems.map(item => item.title).join(', ') : youReceive;
  const givenDisplay = givenItems?.length ? givenItems.map(item => item.title).join(', ') : youGive;
  const payer = cashSupplementPayer === 'you' ? 'Vous' : cashSupplementPayer === 'other' ? cashSupplementPayerName || 'L’autre membre' : 'Payeur à confirmer';
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Récapitulatif de l’échange</Text>
      <View style={styles.row}>
        <Text style={styles.labelText}>Vous donnez</Text>
        <Text style={styles.valueText}>{givenDisplay}</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.labelText}>Vous recevez</Text>
        <Text style={styles.valueText}>{receivedDisplay}</Text>
      </View>
      {!!cashSupplement && (
        <Text style={styles.legacyText}>
          Complément historique : {formatPriceWithCurrency(cashSupplement).replace(/ /g, '\u00A0')} · Payeur prévu : {payer.replace(/\.+$/, '')}.
        </Text>
      )}
    </View>
  );
});
const styles = StyleSheet.create({
  container: { backgroundColor: colors.surfaceWarm, borderRadius: radius.xl, padding: spacing.md, borderWidth: 1, borderColor: colors.border, gap: spacing.md },
  title: { fontFamily: fonts.displayMedium, fontSize: 23, lineHeight: 28, color: colors.foreground },
  row: { gap: spacing.xs },
  labelText: { fontFamily: fonts.sansMedium, fontSize: 12, lineHeight: 17, color: colors.foregroundSecondary },
  valueText: { fontFamily: fonts.sans, fontSize: 14, lineHeight: 22, color: colors.foreground },
  legacyText: { fontFamily: fonts.sans, fontSize: 13, lineHeight: 20, color: colors.foregroundSecondary, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.md },
});
export default SwapSummaryBox;
