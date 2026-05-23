/**
 * ForgotPasswordForm — request a password reset email + success state.
 */

import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';

import { colors } from '@/constants/theme';

import { styles } from './styles';

export interface ForgotPasswordFormProps {
  email: string;
  isLoading: boolean;
  resetEmailSent: boolean;
  onChangeEmail: (value: string) => void;
  onSubmit: () => void;
  onBackToSignIn: () => void;
}

function ForgotPasswordFormComponent({
  email,
  isLoading,
  resetEmailSent,
  onChangeEmail,
  onSubmit,
  onBackToSignIn,
}: ForgotPasswordFormProps) {
  return (
    <>
      <Text style={styles.title}>Réinitialiser</Text>
      <Text style={styles.subtitle}>le mot de passe</Text>

      {resetEmailSent ? (
        <>
          <View style={styles.successBox}>
            <View style={styles.successIconCircle}>
              <Ionicons name="mail-outline" size={28} color={colors.primary} />
            </View>
            <Text style={styles.successTitle}>Email envoyé</Text>
            <Text style={styles.successText}>
              Un email de réinitialisation a été envoyé à
            </Text>
            <Text style={styles.emailHighlight}>{email}</Text>
            <Text style={styles.successHint}>
              Vérifiez votre boîte de réception et suivez les instructions.
            </Text>
          </View>
          <Pressable style={styles.primaryButton} onPress={onBackToSignIn} accessibilityLabel="Retour à la connexion" accessibilityRole="button">
            <Text style={styles.primaryButtonText}>RETOUR À LA CONNEXION</Text>
          </Pressable>
        </>
      ) : (
        <>
          <Text style={styles.message}>
            Entrez votre adresse email et nous vous enverrons un lien pour créer un nouveau mot de passe.
          </Text>
          <TextInput
            style={styles.input}
            placeholder="Email"
            placeholderTextColor={colors.muted}
            value={email}
            onChangeText={onChangeEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            accessibilityLabel="Adresse email"
          />
          <Pressable
            style={[styles.primaryButton, !email.trim() && styles.disabledButton]}
            onPress={onSubmit}
            disabled={!email.trim() || isLoading}
            accessibilityLabel="Envoyer le lien de réinitialisation"
            accessibilityRole="button"
          >
            {isLoading ? (
              <ActivityIndicator color={colors.white} />
            ) : (
              <Text style={styles.primaryButtonText}>ENVOYER LE LIEN</Text>
            )}
          </Pressable>
          <Pressable style={styles.linkButton} onPress={onBackToSignIn} accessibilityLabel="Retour à la connexion" accessibilityRole="link">
            <Text style={styles.linkButtonText}>Retour à la connexion</Text>
          </Pressable>
        </>
      )}
    </>
  );
}

export const ForgotPasswordForm = React.memo(ForgotPasswordFormComponent);
