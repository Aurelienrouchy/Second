/**
 * PriceRangeInputs — collapsible price min/max input row with apply/clear actions.
 */

import React from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { colors } from '@/constants/theme';

import { searchStyles as styles } from '../styles';

export interface PriceRangeInputsProps {
  minPriceText: string;
  maxPriceText: string;
  isPriceActive: boolean;
  onMinChange: (value: string) => void;
  onMaxChange: (value: string) => void;
  onClear: () => void;
  onApply: () => void;
}

function PriceRangeInputsComponent({
  minPriceText,
  maxPriceText,
  isPriceActive,
  onMinChange,
  onMaxChange,
  onClear,
  onApply,
}: PriceRangeInputsProps) {
  return (
    <Animated.View entering={FadeInDown.duration(200)} style={styles.priceSection}>
      <View style={styles.priceInputsRow}>
        <View style={styles.priceInputWrapper}>
          <Text style={styles.priceInputLabel}>Min</Text>
          <TextInput
            style={styles.priceInput}
            placeholder="0"
            placeholderTextColor={colors.muted}
            value={minPriceText}
            onChangeText={onMinChange}
            keyboardType="numeric"
            returnKeyType="done"
          />
          <Text style={styles.priceCurrency}>$</Text>
        </View>
        <View style={styles.priceSeparator} />
        <View style={styles.priceInputWrapper}>
          <Text style={styles.priceInputLabel}>Max</Text>
          <TextInput
            style={styles.priceInput}
            placeholder="1000"
            placeholderTextColor={colors.muted}
            value={maxPriceText}
            onChangeText={onMaxChange}
            keyboardType="numeric"
            returnKeyType="done"
          />
          <Text style={styles.priceCurrency}>$</Text>
        </View>
      </View>
      <View style={styles.priceActions}>
        {isPriceActive && (
          <Pressable onPress={onClear} style={styles.priceClearButton}>
            <Text style={styles.priceClearText}>Effacer</Text>
          </Pressable>
        )}
        <Pressable onPress={onApply} style={styles.priceApplyButton}>
          <Text style={styles.priceApplyText}>Appliquer</Text>
        </Pressable>
      </View>
    </Animated.View>
  );
}

export const PriceRangeInputs = React.memo(PriceRangeInputsComponent);
