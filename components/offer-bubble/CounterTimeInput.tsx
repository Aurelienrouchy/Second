/**
 * CounterTimeInput — inline form to propose a new meetup date/time + optional message.
 */

import React from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';

import { colors } from '@/constants/theme';

import { styles } from './styles';

export interface CounterTimeInputProps {
  dateTime: string;
  message: string;
  isSubmitting: boolean;
  onChangeDateTime: (value: string) => void;
  onChangeMessage: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}

function CounterTimeInputComponent({
  dateTime,
  message,
  isSubmitting,
  onChangeDateTime,
  onChangeMessage,
  onCancel,
  onSubmit,
}: CounterTimeInputProps) {
  return (
    <View style={styles.counterInputSection}>
      <Text style={styles.counterInputLabel}>PROPOSER UN AUTRE HORAIRE</Text>
      <TextInput
        style={styles.counterAmountInput}
        placeholder="AAAA-MM-JJ HH:MM (ex: 2026-06-01 14:30)"
        value={dateTime}
        onChangeText={onChangeDateTime}
        placeholderTextColor={colors.muted}
        keyboardType="default"
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

export const CounterTimeInput = React.memo(CounterTimeInputComponent);
