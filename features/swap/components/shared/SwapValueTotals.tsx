import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '@/components/ui';
import { colors, components, spacing, typography } from '@/constants/theme';
import { formatPrice } from '@/utils/formatPrice';

/** Totals follow the same receive / propose order as the comparison columns. */
export function SwapValueTotals({
  receivedTotal,
  proposedTotal,
}: {
  receivedTotal: number;
  proposedTotal: number;
}) {
  return (
    <View style={styles.container}>
      <Text style={styles.label}>Valeurs indicatives</Text>
      <View style={styles.row}>
        <Text
          style={styles.value}
          accessibilityLabel={`Vous recevez, ${formatPrice(receivedTotal)}`}
        >
          {formatPrice(receivedTotal)}
        </Text>
        <View style={styles.divider} />
        <Text
          style={styles.value}
          accessibilityLabel={`Vous proposez, ${formatPrice(proposedTotal)}`}
        >
          {formatPrice(proposedTotal)}
        </Text>
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  container: {
    gap: spacing.sm,
    borderTopWidth: components.troc.borderWidth,
    borderBottomWidth: components.troc.borderWidth,
    borderColor: colors.borderStrong,
    paddingVertical: spacing.md,
  },
  label: { ...typography.labelUppercase, color: colors.foreground },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: components.troc.gridGap,
  },
  value: {
    ...typography.trocValue,
    color: colors.foreground,
    flex: 1,
    textAlign: 'center',
  },
  divider: {
    width: components.troc.borderWidth,
    height: typography.trocValue.lineHeight,
    backgroundColor: colors.borderStrong,
  },
});
