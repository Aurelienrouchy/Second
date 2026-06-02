/**
 * Email Settings
 */

import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { useUser } from '@/contexts/AuthContext';
import { AuthService } from '@/services/authService';
import { colors, fonts, spacing, radius } from '@/constants/theme';
import { Text, Label, Caption, ScreenHeader } from '@/components/ui';
import { Button } from '@/components/ui';

export default function EmailSettingsScreen() {
  const router = useRouter();
  const user = useUser();

  const [newEmail, setNewEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmNewEmail, setConfirmNewEmail] = useState('');

  const [isSaving, setIsSaving] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [reauthDone, setReauthDone] = useState(false);
  const [reauthLoading, setReauthLoading] = useState(false);

  const provider = AuthService.getAuthProvider();
  const isPasswordUser = provider === 'password';
  const isUnknownProvider = provider === 'unknown';
  const isAppleOnAndroid = provider === 'apple.com' && Platform.OS !== 'ios';
  const hasPasswordProvider = AuthService.hasPasswordProvider();

  const handleReauthSocial = async () => {
    setReauthLoading(true);
    try {
      if (provider === 'google.com') {
        await AuthService.reauthenticateWithGoogle();
      } else {
        await AuthService.reauthenticateWithApple();
      }
      setReauthDone(true);
    } catch (error: unknown) {
      const code = error != null && typeof error === 'object' && 'code' in error
        ? (error as { code: string }).code
        : undefined;
      if (code !== 'ERR_REQUEST_CANCELED' && code !== 'SIGN_IN_CANCELLED') {
        Alert.alert('Erreur', 'La vérification a échoué. Veuillez réessayer.');
      }
    } finally {
      setReauthLoading(false);
    }
  };

  const handleSave = async () => {
    if (!newEmail.trim() || !confirmNewEmail.trim()) {
      Alert.alert('Erreur', 'Veuillez remplir tous les champs');
      return;
    }

    if (isPasswordUser && !password) {
      Alert.alert('Erreur', 'Veuillez saisir votre mot de passe.');
      return;
    }

    if (isUnknownProvider) {
      Alert.alert('Erreur', 'Impossible de déterminer votre méthode de connexion. Veuillez vous déconnecter et vous reconnecter.');
      return;
    }

    if (isAppleOnAndroid && !hasPasswordProvider) {
      Alert.alert('Erreur', 'Veuillez d\'abord ajouter un mot de passe à votre compte.');
      return;
    }

    if (isAppleOnAndroid && hasPasswordProvider && !password) {
      Alert.alert('Erreur', 'Veuillez saisir votre mot de passe.');
      return;
    }

    if (!isPasswordUser && !isAppleOnAndroid && !reauthDone) {
      Alert.alert('Erreur', 'Veuillez d\'abord vérifier votre identité');
      return;
    }

    if (newEmail !== confirmNewEmail) {
      Alert.alert('Erreur', 'Les adresses email ne correspondent pas');
      return;
    }

    if (!user) return;

    setIsSaving(true);
    try {
      // 1. Re-authentifier (social providers already re-authed via button)
      if (isPasswordUser || (isAppleOnAndroid && hasPasswordProvider)) {
        await AuthService.reauthenticate(password);
      }

      // 2. Envoyer un email de vérification pour le changement
      await AuthService.updateEmail(newEmail.trim());

      Alert.alert(
        'Vérification envoyée',
        `Un email de vérification a été envoyé à ${newEmail.trim()}. Cliquez sur le lien dans cet email pour confirmer le changement.`,
        [
          {
            text: 'OK',
            onPress: () => {
              router.back();
            }
          }
        ]
      );
    } catch (error: unknown) {
      if (__DEV__) console.error('Error updating email:', error);
      const message = error instanceof Error ? error.message : 'Une erreur est survenue lors de la mise à jour de l\'email';
      Alert.alert('Erreur', message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <View style={styles.container}>
      <ScreenHeader
        title="Adresse e-mail"
        onBack={() => router.back()}
        rightContent={
          <Pressable onPress={handleSave} disabled={isSaving}>
            {isSaving ? (
              <ActivityIndicator color={colors.primary} />
            ) : (
              <Text variant="body" style={styles.saveButton}>Enregistrer</Text>
            )}
          </Pressable>
        }
      />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          {/* Current Email Info */}
          <View style={styles.infoBox}>
            <View style={styles.infoRow}>
              <Ionicons name="mail-outline" size={20} color={colors.primary} />
              <View style={styles.infoTextContainer}>
                <Caption>Adresse email actuelle</Caption>
                <Text variant="body" style={styles.currentEmail}>{user?.email}</Text>
              </View>
            </View>
          </View>

          {/* Form */}
          <View style={styles.formSection}>
            <View style={styles.inputContainer}>
              <Label style={styles.label}>Nouvelle adresse email</Label>
              <TextInput
                style={styles.input}
                value={newEmail}
                onChangeText={setNewEmail}
                placeholder="Ex: jean.dupont@email.com"
                placeholderTextColor={colors.muted}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                textContentType="emailAddress"
                autoComplete="email"
              />
            </View>

            <View style={styles.inputContainer}>
              <Label style={styles.label}>Confirmer la nouvelle adresse</Label>
              <TextInput
                style={styles.input}
                value={confirmNewEmail}
                onChangeText={setConfirmNewEmail}
                placeholder="Ex: jean.dupont@email.com"
                placeholderTextColor={colors.muted}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                textContentType="emailAddress"
                autoComplete="email"
              />
            </View>

            {/* Re-authentication section */}
            {isUnknownProvider ? (
              <View style={styles.inputContainer}>
                <Label style={styles.label}>Vérification d'identité</Label>
                <View style={styles.unknownProviderBox}>
                  <Ionicons name="alert-circle" size={20} color={colors.warning} />
                  <Caption style={styles.unknownProviderText}>
                    Impossible de déterminer votre méthode de connexion. Veuillez vous déconnecter et vous reconnecter, puis réessayez.
                  </Caption>
                </View>
              </View>
            ) : isPasswordUser ? (
              <View style={styles.inputContainer}>
                <Label style={styles.label}>Mot de passe actuel</Label>
                <View style={styles.passwordContainer}>
                  <TextInput
                    style={styles.passwordInput}
                    value={password}
                    onChangeText={setPassword}
                    placeholder="Votre mot de passe"
                    placeholderTextColor={colors.muted}
                    secureTextEntry={!showPassword}
                    autoCapitalize="none"
                    textContentType="password"
                    autoComplete="current-password"
                  />
                  <Pressable
                    onPress={() => setShowPassword(!showPassword)}
                    style={({ pressed }) => [styles.eyeButton, pressed && { opacity: 0.7 }]}
                  >
                    <Ionicons
                      name={showPassword ? "eye-off-outline" : "eye-outline"}
                      size={24}
                      color={colors.muted}
                    />
                  </Pressable>
                </View>
                <Caption style={styles.helperText}>
                  Pour votre sécurité, confirmez votre mot de passe pour valider le changement.
                </Caption>
              </View>
            ) : isAppleOnAndroid && hasPasswordProvider ? (
              <View style={styles.inputContainer}>
                <Label style={styles.label}>Mot de passe actuel</Label>
                <View style={styles.passwordContainer}>
                  <TextInput
                    style={styles.passwordInput}
                    value={password}
                    onChangeText={setPassword}
                    placeholder="Votre mot de passe"
                    placeholderTextColor={colors.muted}
                    secureTextEntry={!showPassword}
                    autoCapitalize="none"
                    textContentType="password"
                    autoComplete="current-password"
                  />
                  <Pressable
                    onPress={() => setShowPassword(!showPassword)}
                    style={({ pressed }) => [styles.eyeButton, pressed && { opacity: 0.7 }]}
                  >
                    <Ionicons
                      name={showPassword ? "eye-off-outline" : "eye-outline"}
                      size={24}
                      color={colors.muted}
                    />
                  </Pressable>
                </View>
                <Caption style={styles.helperText}>
                  Pour votre sécurité, confirmez votre mot de passe pour valider le changement.
                </Caption>
              </View>
            ) : isAppleOnAndroid ? (
              <View style={styles.inputContainer}>
                <Label style={styles.label}>Vérification d'identité</Label>
                <View style={styles.unknownProviderBox}>
                  <Ionicons name="alert-circle" size={20} color={colors.warning} />
                  <Caption style={styles.unknownProviderText}>
                    La ré-authentification Apple n'est pas disponible sur Android. Ajoutez d'abord un mot de passe à votre compte, puis revenez modifier votre email.
                  </Caption>
                </View>
                <Button
                  variant="secondary"
                  fullWidth
                  onPress={() => router.push('/settings/add-password')}
                  leftIcon={
                    <Ionicons name="key-outline" size={18} color={colors.foreground} />
                  }
                >
                  Ajouter un mot de passe
                </Button>
              </View>
            ) : (
              <View style={styles.inputContainer}>
                <Label style={styles.label}>Vérification d'identité</Label>
                {reauthDone ? (
                  <View style={styles.reauthSuccess}>
                    <Ionicons name="checkmark-circle" size={20} color={colors.success} />
                    <Caption style={styles.reauthSuccessText}>Identité vérifiée</Caption>
                  </View>
                ) : (
                  <Button
                    variant="secondary"
                    fullWidth
                    loading={reauthLoading}
                    onPress={handleReauthSocial}
                    leftIcon={
                      <Ionicons
                        name={provider === 'google.com' ? 'logo-google' : 'logo-apple'}
                        size={18}
                        color={colors.foreground}
                      />
                    }
                  >
                    {provider === 'google.com'
                      ? 'Se reconnecter avec Google'
                      : 'Se reconnecter avec Apple'}
                  </Button>
                )}
                <Caption style={styles.helperText}>
                  Pour votre sécurité, vérifiez votre identité pour valider le changement.
                </Caption>
              </View>
            )}
          </View>

          {/* Security Notice */}
          <View style={styles.securityBox}>
            <Ionicons name="shield-checkmark-outline" size={20} color={colors.success} />
            <Text variant="bodySmall" style={styles.securityText}>
              Un lien de vérification sera envoyé à votre nouvelle adresse. Le changement ne sera effectif qu'après avoir cliqué sur ce lien.
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
  saveButton: {
    color: colors.primary,
    fontSize: 16,
    fontFamily: fonts.sansMedium,
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
    backgroundColor: colors.primaryLight,
    padding: spacing.md,
    borderRadius: radius.sm,
    marginBottom: spacing.lg,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  infoTextContainer: {
    flex: 1,
  },
  currentEmail: {
    fontFamily: fonts.sansMedium,
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
  reauthSuccess: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.successLight,
    borderRadius: radius.sm,
    padding: spacing.md,
  },
  reauthSuccessText: {
    color: colors.success,
    flex: 1,
  },
  unknownProviderBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: colors.warningLight,
    borderRadius: radius.sm,
    padding: spacing.md,
  },
  unknownProviderText: {
    flex: 1,
    color: colors.foreground,
  },
  securityBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: colors.successLight,
    padding: spacing.md,
    borderRadius: radius.sm,
  },
  securityText: {
    flex: 1,
    color: colors.foreground,
  },
});
