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
        keyboardType="decimal-pad"
        value={amount}
        editable={!isSubmitting}
        onChangeText={onChangeAmount}
        placeholderTextColor={colors.muted}
      />
      <TextInput
        style={[styles.counterMessageInput, styles.counterMessageInputMultiline]}
        placeholder="Message (optionnel)"
        value={message}
        editable={!isSubmitting}
        onChangeText={onChangeMessage}
        placeholderTextColor={colors.muted}
        multiline
        // Même plafond que le message de l'offre initiale (`OfferStep`). Ces
        // trois champs n'en avaient aucun : un texte collé partait tel quel dans
        // le contenu du message ET dans l'aperçu de la conversation.
        maxLength={500}
      />
      <View style={styles.counterButtonsRow}>
        <Pressable style={styles.counterCancelButton} onPress={() => onCancel()} disabled={isSubmitting}>
          <Text style={styles.counterCancelText}>Annuler</Text>
        </Pressable>
        <Pressable
          style={[styles.counterSubmitButton, isSubmitting && styles.buttonDisabled]}
          onPress={() => onSubmit()}
          disabled={isSubmitting}
        >
          {isSubmitting ? (
            <ActivityIndicator size="small" color={colors.foreground} />
          ) : (
            <Text style={styles.counterSubmitText}>Envoyer</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

export const CounterPriceInput = React.memo(CounterPriceInputComponent);
