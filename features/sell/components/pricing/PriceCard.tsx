import React, { RefObject } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import { colors, fonts, radius, sizing, spacing, typography } from '@/constants/theme';

/** Barre d'accessoire iOS du champ prix : le pavé décimal n'a pas de touche retour. */
export const PRICE_INPUT_ACCESSORY_ID = 'sell-price-accessory';

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
      accessible={false}
      style={styles.priceCard}
      onPress={() => inputRef.current?.focus()}
      testID="sell-price-card"
    >
      <Text style={styles.priceLabel}>Prix de vente</Text>
      <View style={styles.priceRow}>
        <TextInput
          ref={inputRef}
          testID="sell-price-input"
          style={styles.priceInput}
          value={price}
          onChangeText={onPriceChange}
          placeholder="0"
          placeholderTextColor={colors.border}
          accessibilityLabel="Prix de vente en dollars canadiens"
          keyboardType="decimal-pad"
          cursorColor={colors.rust}
          selectionColor={colors.rust}
          inputAccessoryViewID={PRICE_INPUT_ACCESSORY_ID}
        />
        <Text style={styles.priceCurrency}>$</Text>
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  priceCard: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    marginBottom: spacing.md,
    overflow: 'hidden',
  },
  priceLabel: {
    ...typography.labelUppercase,
    color: colors.muted,
    textTransform: 'uppercase',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm + spacing.xs,
    paddingBottom: spacing.xs,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
  },
  priceInput: {
    ...typography.hero,
    fontFamily: fonts.sansMedium,
    color: colors.rust,
    minWidth: sizing.inputHeight + spacing.md,
    minHeight: sizing.inputHeight,
    textAlignVertical: 'center',
    includeFontPadding: false,
    padding: 0,
  },
  priceCurrency: {
    ...typography.h2,
    fontFamily: fonts.sansMedium,
    includeFontPadding: false,
    color: colors.muted,
    marginLeft: spacing.xs,
  },
});
