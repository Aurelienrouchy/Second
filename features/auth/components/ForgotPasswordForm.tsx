/**
 * ForgotPasswordForm — request a password reset email + success state.
 */

import { Ionicons } from '@expo/vector-icons';
import { BottomSheetTextInput } from '@gorhom/bottom-sheet';
import React from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { colors } from '@/constants/theme';

import { styles } from './styles';

export interface ForgotPasswordFormProps {
  email: string;
  isLoading: boolean;
  resetEmailSent: boolean;
  onChangeEmail: (value: string) => void;
  onSubmit: () => void;
  onBackToSignIn: () => void;
  onContactSupport: () => void;
}

function ForgotPasswordFormComponent({
  email,
  isLoading,
  resetEmailSent,
  onChangeEmail,
  onSubmit,
  onBackToSignIn,
  onContactSupport,
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
            <Text style={styles.successTitle}>Demande prise en compte</Text>
            <Text style={styles.successText}>
              Si cette adresse permet une réinitialisation, vous recevrez les instructions par courriel.
            </Text>
            <Text style={styles.emailHighlight}>{email}</Text>
            <Text style={styles.successHint}>
              Consultez votre boîte de réception et les courriels indésirables. Cette réponse ne confirme pas l’existence d’un compte.
            </Text>
          </View>
          <Pressable style={styles.primaryButton} onPress={onBackToSignIn} accessibilityLabel="Retour à la connexion" accessibilityRole="button">
            <Text style={styles.primaryButtonText}>RETOUR À LA CONNEXION</Text>
          </Pressable>
        </>
      ) : (
        <>
          <Text style={styles.message}>
            Indiquez le courriel déjà associé à votre connexion par mot de passe et auquel vous avez accès. Si une réinitialisation est possible, vous recevrez les instructions par courriel.
          </Text>
          <BottomSheetTextInput
            style={styles.input}
            placeholder="Email"
            placeholderTextColor={colors.muted}
            value={email}
            editable={!isLoading}
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
      <Text style={styles.message}>Pour Google ou Apple, revenez à la connexion et utilisez le même compte fournisseur déjà lié. Une autre identité peut créer un compte distinct. Le numéro de téléphone du profil ne permet pas de vous connecter.</Text>
      <Text style={styles.message}>Si tous vos moyens liés sont perdus, Seconde ne réattribue pas le compte par intervention manuelle. L’assistance reste accessible pour déclarer la difficulté, sans remise d’accès.</Text>
      <Pressable style={styles.linkButton} onPress={onContactSupport} accessibilityLabel="Aide sur les moyens de connexion perdus" accessibilityRole="link">
        <Text style={styles.linkButtonText}>Mes moyens de connexion sont perdus</Text>
      </Pressable>
    </>
  );
}

export const ForgotPasswordForm = React.memo(ForgotPasswordFormComponent);
