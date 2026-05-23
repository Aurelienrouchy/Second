import React, { RefObject } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import { colors, fonts } from '@/constants/theme';

interface PriceCardProps {
  price: string;
  onPriceChange: (value: string) => void;
  inputRef: RefObject<TextInput | null>;
}

export const PriceCard = React.memo(function PriceCard({
  price,
  onPriceChange,
  inputRef,
}: PriceCardProps) {
  return (
    <Pressable
      style={styles.priceCard}
      onPress={() => inputRef.current?.focus()}
    >
      <Text style={styles.priceLabel}>Prix de vente</Text>
      <View style={styles.priceRow}>
        <Text style={styles.priceCurrency}>$</Text>
        <TextInput
          ref={inputRef}
          style={styles.priceInput}
          value={price}
          onChangeText={onPriceChange}
          placeholder="0"
          placeholderTextColor={colors.border}
          keyboardType="decimal-pad"
          cursorColor={colors.rust}
          selectionColor={colors.rust}
          inputAccessoryViewID="pricing-empty"
        />
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  priceCard: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 4,
    marginBottom: 14,
    overflow: 'hidden',
  },
  priceLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: 11,
    letterSpacing: 0.88,
    color: colors.muted,
    textTransform: 'uppercase',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    paddingHorizontal: 16,
    paddingBottom: 14,
  },
  priceInput: {
    fontFamily: fonts.sans,
    fontSize: 38,
    fontWeight: '600',
    color: colors.rust,
    minWidth: 60,
    padding: 0,
  },
  priceCurrency: {
    fontFamily: fonts.sans,
    fontSize: 24,
    fontWeight: '600',
    color: colors.muted,
    marginRight: 4,
  },
});
