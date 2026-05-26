/**
 * CounterLocationInput — inline form to propose a new meetup location + optional message.
 */

import React from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';

import { colors } from '@/constants/theme';

import { styles } from './styles';

export interface CounterLocationInputProps {
  locationName: string;
  message: string;
  isSubmitting: boolean;
  onChangeLocationName: (value: string) => void;
  onChangeMessage: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}

function CounterLocationInputComponent({
  locationName,
  message,
  isSubmitting,
  onChangeLocationName,
  onChangeMessage,
  onCancel,
  onSubmit,
}: CounterLocationInputProps) {
  return (
    <View style={styles.counterInputSection}>
      <Text style={styles.counterInputLabel}>PROPOSER UN AUTRE LIEU</Text>
      <TextInput
        style={styles.counterAmountInput}
        placeholder="Nom du lieu (ex: Cafe Olimpico)"
        value={locationName}
        onChangeText={onChangeLocationName}
        placeholderTextColor={colors.muted}
        autoCapitalize="words"
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

export const CounterLocationInput = React.memo(CounterLocationInputComponent);
