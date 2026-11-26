import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing, typography } from '@/constants/theme';
import { formatPriceWithCurrency } from '@/utils/formatPrice';
import type { ShippingPurchaseRate } from '../types';

interface Props { rates: ShippingPurchaseRate[]; selectedRateId: string | null; onSelect: (rate: ShippingPurchaseRate) => void; loading: boolean; disabled?: boolean }
export function ShippingEstimateList({ rates, selectedRateId, onSelect, loading, disabled = false }: Props) {
  return <View style={styles.section}>
    <Text style={styles.title}>Tarifs de livraison</Text>
    {loading ? <ActivityIndicator color={colors.charcoal} /> : rates.map(rate => <Pressable key={rate.rateId}
      accessibilityRole="radio" accessibilityState={{ checked: selectedRateId === rate.rateId, disabled }}
      accessibilityLabel={`${rate.carrierFriendlyName}, ${rate.serviceType}, ${formatPriceWithCurrency(rate.shippingCost)}`}
      disabled={disabled} onPress={() => onSelect(rate)} style={[styles.card, selectedRateId === rate.rateId && styles.selected]}>
      <Text style={styles.body}>{rate.carrierFriendlyName} · {rate.serviceType}</Text>
      <Text style={styles.caption}>{rate.estimatedDeliveryDays === null ? 'Délai à confirmer' : `Environ ${rate.estimatedDeliveryDays} jours`}</Text>
      <Text style={styles.body}>{formatPriceWithCurrency(rate.shippingCost)}</Text>
    </Pressable>)}
    {!loading && rates.length === 0 ? <Text style={styles.caption}>Aucun service disponible pour cette adresse pour le moment.</Text> : null}
  </View>;
}
const styles = StyleSheet.create({
  section: { gap: spacing.sm, marginVertical: spacing.md }, title: { ...typography.h3, color: colors.charcoal },
  body: { ...typography.body, color: colors.charcoal }, caption: { ...typography.caption, color: colors.muted },
  card: { padding: spacing.md, gap: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, backgroundColor: colors.white },
  selected: { borderColor: colors.charcoal, backgroundColor: colors.surfaceWarm },
});
