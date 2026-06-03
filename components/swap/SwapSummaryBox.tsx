import React from 'react';
import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui';
import { SwapItemInfo } from '@/types';
import { colors, fonts, spacing, radius } from '@/constants/theme';
import { formatPrice } from '@/utils/formatPrice';

export interface SwapSummaryBoxProps {
  youReceive: string;
  youGive: string;
  receivedItems?: SwapItemInfo[];
  givenItems?: SwapItemInfo[];
  cashSupplement?: number;
}

const SwapSummaryBox: React.FC<SwapSummaryBoxProps> = ({
  youReceive,
  youGive,
  receivedItems,
  givenItems,
  cashSupplement,
}) => {
  // If items are provided, build the display strings
  const receivedDisplay = receivedItems && receivedItems.length > 0
    ? receivedItems.map(item => item.title).join(', ') +
      (cashSupplement ? ` + ${formatPrice(cashSupplement)}` : '')
    : youReceive;

  const givenDisplay = givenItems && givenItems.length > 0
    ? givenItems.map(item => item.title).join(', ')
    : youGive;

  return (
    <View style={styles.container}>
      {/* Title */}
      <Text style={styles.title}>Récapitulatif de l'échange</Text>

      {/* Received Row */}
      <View style={styles.row}>
        <Text style={styles.labelText}>Tu reçois</Text>
        <Text style={styles.valueText} numberOfLines={2}>
          {receivedDisplay}
        </Text>
      </View>

      {/* Given Row */}
      <View style={styles.row}>
        <Text style={styles.labelText}>Tu cèdes</Text>
        <Text style={styles.valueText} numberOfLines={2}>
          {givenDisplay}
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.charcoal,
    borderRadius: radius.sm,
    padding: spacing.md,
    marginBottom: 20,
  },
  title: {
    fontFamily: fonts.sans,
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: colors.creamTranslucent40,
    marginBottom: spacing.md,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  labelText: {
    fontFamily: fonts.sans,
    fontSize: 12,
    lineHeight: 16,
    color: colors.creamTranslucent60,
  },
  valueText: {
    fontFamily: fonts.display,
    fontSize: 13,
    fontWeight: '400',
    lineHeight: 16,
    color: colors.cream,
    textAlign: 'right',
    flex: 1,
    marginLeft: spacing.md,
  },
});

export default SwapSummaryBox;
