/**
 * ShippingEstimateList
 * Displays carrier/rate options with radio selection.
 */

import React, { useCallback } from 'react';
import {
  View,
  Text,
  Pressable,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';

import { colors, fonts, radius } from '@/constants/theme';
import { formatPrice } from '@/utils/formatPrice';
import type { ShippingEstimate } from '../types';

// =============================================================================
// TYPES
// =============================================================================

interface ShippingEstimateListProps {
  estimates: ShippingEstimate[];
  selectedEstimate: ShippingEstimate | null;
  onSelect: (estimate: ShippingEstimate) => void;
  loading: boolean;
  postalCodeLength: number;
}

// =============================================================================
// SUB-COMPONENT
// =============================================================================

const EstimateCard = React.memo(function EstimateCard({
  estimate,
  isSelected,
  onPress,
}: {
  estimate: ShippingEstimate;
  isSelected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={[styles.estimateCard, isSelected && styles.estimateCardSelected]}
      onPress={onPress}
    >
      <View style={[styles.radio, isSelected && styles.radioSelected]}>
        {isSelected && <View style={styles.radioInner} />}
      </View>
      <View style={styles.estimateInfo}>
        <Text style={styles.estimateName}>
          {estimate.carrier} {estimate.serviceName}
        </Text>
        <Text style={styles.estimateDelay}>{estimate.deliveryDays}</Text>
      </View>
      <Text style={styles.estimatePrice}>{formatPrice(estimate.amount)}</Text>
    </Pressable>
  );
});

// =============================================================================
// COMPONENT
// =============================================================================

export const ShippingEstimateList = React.memo(function ShippingEstimateList({
  estimates,
  selectedEstimate,
  onSelect,
  loading,
  postalCodeLength,
}: ShippingEstimateListProps) {
  const handlePress = useCallback(
    (est: ShippingEstimate) => {
      onSelect(est);
    },
    [onSelect],
  );

  return (
    <>
      <Text style={styles.sectionTitle}>LIVRAISON</Text>

      {loading && (
        <View style={styles.estimateLoading}>
          <ActivityIndicator size="small" color={colors.charcoal} />
          <Text style={styles.estimateLoadingText}>Calcul des frais...</Text>
        </View>
      )}

      {!loading &&
        estimates.map((est) => (
          <EstimateCard
            key={est.rateId}
            estimate={est}
            isSelected={selectedEstimate?.rateId === est.rateId}
            onPress={() => handlePress(est)}
          />
        ))}

      {!loading && estimates.length === 0 && postalCodeLength >= 6 && (
        <Text style={styles.noEstimates}>
          Entrez votre code postal pour voir les options de livraison
        </Text>
      )}
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
    textTransform: 'uppercase',
  },
  estimateLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 16,
    justifyContent: 'center',
  },
  estimateLoadingText: {
    fontFamily: fonts.sans,
    fontSize: 12,
    color: colors.muted,
  },
  estimateCard: {
    flexDirection: 'row',
    gap: 12,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    padding: 14,
    marginBottom: 8,
    alignItems: 'center',
  },
  estimateCardSelected: {
    borderColor: colors.charcoal,
    borderWidth: 2,
    padding: 13,
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    justifyContent: 'center',
    alignItems: 'center',
  },
  radioSelected: {
    borderColor: colors.charcoal,
  },
  radioInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.charcoal,
  },
  estimateInfo: { flex: 1 },
  estimateName: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    color: colors.charcoal,
    marginBottom: 2,
  },
  estimateDelay: {
    fontFamily: fonts.sans,
    fontSize: 11,
    color: colors.muted,
  },
  estimatePrice: {
    fontFamily: fonts.displaySemiBold,
    fontSize: 16,
    color: colors.charcoal,
  },
  noEstimates: {
    fontFamily: fonts.sans,
    fontSize: 12,
    color: colors.muted,
    textAlign: 'center',
    paddingVertical: 16,
  },
});
