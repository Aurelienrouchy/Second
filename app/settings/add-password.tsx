/**
 * Add Password Settings
 * Allows social-auth users (Google/Apple) to link an email+password credential.
 */

import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { useUser } from '@/hooks/useAuth';
import { useAuthStore } from '@/store/authStore';
import { track } from '@/lib/analytics';
import { AuthService } from '@/services/authService';
import { colors, fonts, spacing, radius } from '@/constants/theme';
import { Text, Label, Caption, ScreenHeader } from '@/components/ui';
import { Button } from '@/components/ui';

export default function AddPasswordScreen() {
  const router = useRouter();
  const user = useUser();

  const [email, setEmail] = useState(user?.email ?? '');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const linkAuthProvider: 'google' | 'apple' =
    AuthService.getAuthProvider() === 'apple.com' ? 'apple' : 'google';

  // Réexécute la liaison du mot de passe après une ré-authentification réussie.
  const performLink = async () => {
    await AuthService.linkPasswordCredential(email.trim(), password);
    // Resynchroniser l'observable user (hasPassword/email mis à jour en Firestore)
    // avant de revenir pour que l'écran précédent reflète l'état à jour.
    await useAuthStore.getState().refreshUser();

    Alert.alert(
      'Mot de passe ajouté',
      'Votre mot de passe a été associé avec succès. Vous pouvez désormais vous connecter avec votre email et mot de passe.',
      [{ text: 'OK', onPress: () => router.back() }]
    );
  };

  // Déclenche la ré-authentification par provider puis relance la liaison.
  // Débloque l'ajout de mot de passe sur les vieilles sessions (notamment Apple
  // sur Android où reauthenticateWithApple lèvera proprement).
  const handleReauthAndRetry = async () => {
    setIsSaving(true);
    const provider = AuthService.getAuthProvider();
    const reauthProviderName: 'google' | 'apple' | 'password' =
      provider === 'google.com' ? 'google' : provider === 'apple.com' ? 'apple' : 'password';
    let reauthSucceeded = false;
    try {
      if (provider === 'google.com') {
        await AuthService.reauthenticateWithGoogle();
      } else if (provider === 'apple.com') {
        await AuthService.reauthenticateWithApple();
      } else {
        await AuthService.reauthenticate(password);
      }
      reauthSucceeded = true;
      track('reauth_performed', { context: 'add_password', provider: reauthProviderName, result: 'success' });
      await performLink();
      track('password_link_submitted', { auth_provider: linkAuthProvider, result: 'success', after_reauth: true });
    } catch (error: unknown) {
      const code = (error as { code?: string }).code;
      const cancelled = code === 'ERR_REQUEST_CANCELED' || code === 'SIGN_IN_CANCELLED';
      if (!reauthSucceeded) {
        track('reauth_performed', { context: 'add_password', provider: reauthProviderName, result: cancelled ? 'cancelled' : 'error' });
        track('password_link_submitted', {
          auth_provider: linkAuthProvider,
          result: cancelled ? 'reauth_cancelled' : 'error',
          after_reauth: true,
          error_code: code,
        });
      } else {
        track('password_link_submitted', {
          auth_provider: linkAuthProvider,
          result: 'error',
          after_reauth: true,
          error_code: code,
        });
      }
      if (cancelled) {
        return;
      }
      if (__DEV__) console.error('Error re-authenticating before link:', error);
      const message = error instanceof Error
        ? error.message
        : 'La reconnexion a échoué. Veuillez réessayer.';
      Alert.alert('Erreur', message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleLink = async () => {
    if (!email.trim()) {
      track('password_link_submitted', { auth_provider: linkAuthProvider, result: 'validation_error', validation_error: 'empty_email', after_reauth: false });
      Alert.alert('Erreur', 'Veuillez saisir une adresse email.');
      return;
    }

    if (!password || !confirmPassword) {
      track('password_link_submitted', { auth_provider: linkAuthProvider, result: 'validation_error', validation_error: 'empty_fields', after_reauth: false });
      Alert.alert('Erreur', 'Veuillez remplir tous les champs.');
      return;
    }

    if (password.length < 6) {
      track('password_link_submitted', { auth_provider: linkAuthProvider, result: 'validation_error', validation_error: 'too_short', after_reauth: false });
      Alert.alert('Erreur', 'Le mot de passe doit contenir au moins 6 caractères.');
      return;
    }

    if (password !== confirmPassword) {
      track('password_link_submitted', { auth_provider: linkAuthProvider, result: 'validation_error', validation_error: 'mismatch', after_reauth: false });
      Alert.alert('Erreur', 'Les mots de passe ne correspondent pas.');
      return;
    }

    setIsSaving(true);
    try {
      await performLink();
      track('password_link_submitted', { auth_provider: linkAuthProvider, result: 'success', after_reauth: false });
    } catch (error: unknown) {
      if (__DEV__) console.error('Error linking password credential:', error);
      const code = (error as { code?: string }).code;
      const message = error instanceof Error
        ? error.message
        : 'Une erreur est survenue lors de l\'ajout du mot de passe.';

      // Cas spécifique « connexion récente requise » : AuthService.linkPasswordCredential
      // remappe auth/requires-recent-login via getAuthErrorMessage (le code brut est
      // perdu), on détecte donc le message remappé pour proposer une reconnexion.
      if (message.includes('connexion récente')) {
        track('password_link_submitted', { auth_provider: linkAuthProvider, result: 'reauth_required', after_reauth: false });
        Alert.alert(
          'Reconnexion récente requise',
          'Reconnexion récente requise pour lier un mot de passe.',
          [
            { text: 'Annuler', style: 'cancel' },
            { text: 'Se reconnecter', onPress: handleReauthAndRetry },
          ]
        );
        return;
      }

      track('password_link_submitted', { auth_provider: linkAuthProvider, result: 'error', after_reauth: false, error_code: code });
      Alert.alert('Erreur', message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <View style={styles.container}>
      <ScreenHeader title="Ajouter un mot de passe" onBack={() => router.back()} />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          {/* Info */}
          <View style={styles.infoBox}>
            <Ionicons name="key-outline" size={24} color={colors.primary} />
            <Text variant="bodySmall" style={styles.infoText}>
              Ajoutez un mot de passe pour pouvoir vous connecter avec votre email en plus de votre compte social.
            </Text>
          </View>

          {/* Form */}
          <View style={styles.formSection}>
            <View style={styles.inputContainer}>
              <Label style={styles.label}>Adresse email</Label>
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                placeholder="votre@email.com"
                placeholderTextColor={colors.muted}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                textContentType="emailAddress"
                autoComplete="email"
              />
              <Caption style={styles.helperText}>
                Cette adresse sera utilisée pour la connexion par mot de passe.
              </Caption>
            </View>

            <View style={styles.inputContainer}>
              <Label style={styles.label}>Mot de passe</Label>
              <View style={styles.passwordContainer}>
                <TextInput
                  style={styles.passwordInput}
                  value={password}
                  onChangeText={setPassword}
                  placeholder="Minimum 6 caractères"
                  placeholderTextColor={colors.muted}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  textContentType="newPassword"
                  autoComplete="new-password"
                />
                <Pressable
                  onPress={() => setShowPassword(!showPassword)}
                  style={({ pressed }) => [styles.eyeButton, pressed && { opacity: 0.7 }]}
                >
                  <Ionicons
                    name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                    size={24}
                    color={colors.muted}
                  />
                </Pressable>
              </View>
            </View>

            <View style={styles.inputContainer}>
              <Label style={styles.label}>Confirmer le mot de passe</Label>
              <View style={styles.passwordContainer}>
                <TextInput
                  style={styles.passwordInput}
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  placeholder="Confirmez votre mot de passe"
                  placeholderTextColor={colors.muted}
                  secureTextEntry={!showConfirmPassword}
                  autoCapitalize="none"
                  textContentType="newPassword"
                  autoComplete="new-password"
                />
                <Pressable
                  onPress={() => setShowConfirmPassword(!showConfirmPassword)}
                  style={({ pressed }) => [styles.eyeButton, pressed && { opacity: 0.7 }]}
                >
                  <Ionicons
                    name={showConfirmPassword ? 'eye-off-outline' : 'eye-outline'}
                    size={24}
                    color={colors.muted}
                  />
                </Pressable>
              </View>
            </View>
          </View>

          {/* Submit */}
          <Button
            variant="primary"
            fullWidth
            loading={isSaving}
            onPress={handleLink}
          >
            Ajouter le mot de passe
          </Button>

          {/* Security Notice */}
          <View style={styles.securityBox}>
            <Ionicons name="shield-checkmark-outline" size={20} color={colors.success} />
            <Text variant="bodySmall" style={styles.securityText}>
              Votre connexion sociale restera active. Vous pourrez utiliser les deux méthodes pour vous connecter.
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  keyboardView: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: spacing.md,
    paddingBottom: spacing.xl,
  },
  infoBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    backgroundColor: colors.primaryLight,
    padding: spacing.md,
    borderRadius: radius.sm,
    marginBottom: spacing.lg,
  },
  infoText: {
    flex: 1,
    color: colors.foreground,
  },
  formSection: {
    gap: spacing.lg,
    marginBottom: spacing.lg,
  },
  inputContainer: {
    gap: spacing.sm,
  },
  label: {
    color: colors.foregroundSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  input: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.sm,
    padding: spacing.md,
    fontSize: 16,
    fontFamily: fonts.sans,
    color: colors.foreground,
    backgroundColor: colors.surface,
  },
  passwordContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
  },
  passwordInput: {
    flex: 1,
    padding: spacing.md,
    fontSize: 16,
    fontFamily: fonts.sans,
    color: colors.foreground,
  },
  eyeButton: {
    padding: spacing.md,
  },
  helperText: {
    color: colors.muted,
    marginTop: spacing.xs,
  },
  securityBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: colors.successLight,
    padding: spacing.md,
    borderRadius: radius.sm,
    marginTop: spacing.lg,
  },
  securityText: {
    flex: 1,
    color: colors.foreground,
  },
});
