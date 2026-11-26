import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button } from '@/components/ui';
import { colors, spacing, typography } from '@/constants/theme';
import { formatPriceWithCurrency } from '@/utils/formatPrice';

interface Props { totalAmount: number; accepted: boolean; submitting: boolean; disabled?: boolean; onPress: () => void }
/** Reservation only. Card/wallet payment is a subsequent, separately authorized operation. */
export function PayButton({ totalAmount, accepted, submitting, disabled = false, onPress }: Props) {
  return <View style={styles.footer}><View style={styles.total}><Text style={styles.body}>Total</Text><Text style={styles.amount}>{formatPriceWithCurrency(totalAmount)}</Text></View><Button fullWidth loading={submitting}
    disabled={disabled || !accepted || submitting} onPress={onPress}>
    Continuer vers le paiement
  </Button></View>;
}
const styles = StyleSheet.create({ footer: {padding: spacing.md, gap: spacing.sm, backgroundColor: colors.cream, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border},
  total: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md}, body: {...typography.bodySmall, color: colors.foregroundSecondary}, amount: {...typography.h3, color: colors.foreground}});
