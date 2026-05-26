/**
 * CounterPriceInput — inline form to propose a counter-price + optional message.
 */

import React from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';

import { colors } from '@/constants/theme';

import { styles } from './styles';

export interface CounterPriceInputProps {
  amount: string;
  message: string;
  isSubmitting: boolean;
  onChangeAmount: (value: string) => void;
  onChangeMessage: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}

function CounterPriceInputComponent({
  amount,
  message,
  isSubmitting,
  onChangeAmount,
  onChangeMessage,
  onCancel,
  onSubmit,
}: CounterPriceInputProps) {
  return (
    <View style={styles.counterInputSection}>
      <Text style={styles.counterInputLabel}>PROPOSER UN AUTRE PRIX</Text>
      <TextInput
        style={styles.counterAmountInput}
        placeholder="Montant en $"
        keyboardType="numeric"
        value={amount}
        onChangeText={onChangeAmount}
        placeholderTextColor={colors.muted}
      />
      <TextInput
        style={[styles.counterMessageInput, styles.counterMessageInputMultiline]}
        placeholder="Message (optionnel)"
        value={message}
        onChangeText={onChangeMessage}
        placeholderTextColor={colors.muted}
        multiline
      />
      <View style={styles.counterButtonsRow}>
        <Pressable style={styles.counterCancelButton} onPress={onCancel}>
          <Text style={styles.counterCancelText}>Annuler</Text>
        </Pressable>
        <Pressable
          style={[styles.counterSubmitButton, isSubmitting && styles.buttonDisabled]}
          onPress={onSubmit}
          disabled={isSubmitting}
        >
          {isSubmitting ? (
            <ActivityIndicator size="small" color={colors.white} />
          ) : (
            <Text style={styles.counterSubmitText}>Envoyer</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

export const CounterPriceInput = React.memo(CounterPriceInputComponent);
