import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing, typography } from '@/constants/theme';
import { formatPriceWithCurrency } from '@/utils/formatPrice';
import type { ShippingPurchaseRate } from '../types';
import type { ServiceFeeTaxSnapshot } from '@/types/shippingPurchase';

export function PriceBreakdown({ rate, taxSnapshot }: { rate: ShippingPurchaseRate; taxSnapshot: ServiceFeeTaxSnapshot }) {
  return <View style={styles.card}>
    <View style={styles.row}><Text style={styles.body}>Article</Text><Text style={styles.body}>{formatPriceWithCurrency(rate.amount)}</Text></View>
    <View style={styles.row}><Text style={styles.body}>Livraison</Text><Text style={styles.body}>{formatPriceWithCurrency(rate.shippingCost)}</Text></View>
    <View style={styles.row}><Text style={styles.body}>Frais de service</Text><Text style={styles.body}>{formatPriceWithCurrency(rate.serviceFee)}</Text></View>
    {taxSnapshot.gst > 0 ? <View style={styles.row}><Text style={styles.body}>TPS sur le service</Text><Text style={styles.body}>{formatPriceWithCurrency(taxSnapshot.gst)}</Text></View> : null}
    {taxSnapshot.qst > 0 ? <View style={styles.row}><Text style={styles.body}>TVQ sur le service</Text><Text style={styles.body}>{formatPriceWithCurrency(taxSnapshot.qst)}</Text></View> : null}
    <View style={styles.totalRow}><Text style={styles.title}>Total</Text><Text style={styles.total}>{formatPriceWithCurrency(rate.totalAmount)}</Text></View>
  </View>;
}
const styles = StyleSheet.create({
  card: { padding: spacing.md, gap: spacing.sm, borderRadius: radius.sm, backgroundColor: colors.surfaceWarm, marginVertical: spacing.md },
  title: { ...typography.h3, color: colors.charcoal }, body: { ...typography.body, color: colors.charcoal },
  total: { ...typography.price, color: colors.charcoal }, row: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md},
  totalRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, paddingTop: spacing.md, marginTop: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border},
});
