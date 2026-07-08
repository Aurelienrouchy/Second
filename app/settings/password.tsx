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

import { useUser } from '@/hooks/useAuth';
import { track } from '@/lib/analytics';
import { AuthService } from '@/services/authService';
import { colors, fonts, spacing, radius } from '@/constants/theme';
import { Text, Label, Caption, ScreenHeader } from '@/components/ui';

export default function PasswordSettingsScreen() {
  const router = useRouter();
  const user = useUser();
  
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    if (!currentPassword || !newPassword || !confirmPassword) {
      track('password_changed', { success: false, validation_error: 'empty' });
      Alert.alert('Erreur', 'Veuillez remplir tous les champs.');
      return;
    }

    if (newPassword.length < 6) {
      track('password_changed', { success: false, validation_error: 'too_short' });
      Alert.alert('Erreur', 'Le nouveau mot de passe doit contenir au moins 6 caractères.');
      return;
    }

    if (newPassword !== confirmPassword) {
      track('password_changed', { success: false, validation_error: 'mismatch' });
      Alert.alert('Erreur', 'Les nouveaux mots de passe ne correspondent pas.');
      return;
    }

    if (!user) return;

    setIsSaving(true);
    try {
      // 1. Re-authentifier
      await AuthService.reauthenticate(currentPassword);

      // 2. Mettre à jour le mot de passe
      await AuthService.updatePassword(newPassword);

      track('password_changed', { success: true });

      Alert.alert(
        'Succès',
        'Votre mot de passe a été mis à jour.',
        [
          { text: 'OK', onPress: () => router.back() }
        ]
      );
    } catch (error: unknown) {
      if (__DEV__) console.error('Error updating password:', error);
      const code = error != null && typeof error === 'object' && 'code' in error
        ? (error as { code: string }).code
        : undefined;
      track('password_changed', { success: false, error_code: code });
      const message = error instanceof Error ? error.message : 'Une erreur est survenue lors de la mise à jour du mot de passe';
      Alert.alert('Erreur', message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <View style={styles.container}>
      <ScreenHeader
        title="Mot de passe"
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
        <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
          <View style={styles.infoBox}>
            <Ionicons name="lock-closed-outline" size={24} color={colors.primary} />
            <Text variant="bodySmall" style={styles.infoText}>
              Choisissez un mot de passe fort avec au moins 6 caractères.
            </Text>
          </View>

          <View style={styles.formSection}>
            <View style={styles.inputContainer}>
              <Label style={styles.label}>Mot de passe actuel</Label>
              <View style={styles.passwordContainer}>
                <TextInput
                  style={styles.passwordInput}
                  value={currentPassword}
                  onChangeText={setCurrentPassword}
                  placeholder="Votre mot de passe actuel"
                  placeholderTextColor={colors.muted}
                  secureTextEntry={!showCurrentPassword}
                  autoCapitalize="none"
                  textContentType="password"
                  autoComplete="current-password"
                />
                <Pressable onPress={() => setShowCurrentPassword(!showCurrentPassword)} style={styles.eyeButton}>
                  <Ionicons name={showCurrentPassword ? "eye-off-outline" : "eye-outline"} size={24} color={colors.muted} />
                </Pressable>
              </View>
            </View>

            <View style={styles.inputContainer}>
              <Label style={styles.label}>Nouveau mot de passe</Label>
              <View style={styles.passwordContainer}>
                <TextInput
                  style={styles.passwordInput}
                  value={newPassword}
                  onChangeText={setNewPassword}
                  placeholder="Nouveau mot de passe"
                  placeholderTextColor={colors.muted}
                  secureTextEntry={!showNewPassword}
                  autoCapitalize="none"
                  textContentType="newPassword"
                  autoComplete="new-password"
                />
                <Pressable onPress={() => setShowNewPassword(!showNewPassword)} style={styles.eyeButton}>
                  <Ionicons name={showNewPassword ? "eye-off-outline" : "eye-outline"} size={24} color={colors.muted} />
                </Pressable>
              </View>
            </View>

            <View style={styles.inputContainer}>
              <Label style={styles.label}>Confirmez le nouveau mot de passe</Label>
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
                <Pressable onPress={() => setShowConfirmPassword(!showConfirmPassword)} style={styles.eyeButton}>
                  <Ionicons name={showConfirmPassword ? "eye-off-outline" : "eye-outline"} size={24} color={colors.muted} />
                </Pressable>
              </View>
            </View>
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
    padding: spacing.lg,
  },
  infoBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surfaceWarm,
    padding: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.lg,
  },
  infoText: {
    flex: 1,
    fontSize: 14,
    fontFamily: fonts.sans,
    color: colors.foreground,
  },
  formSection: {
    gap: spacing.lg,
  },
  inputContainer: {
    gap: spacing.sm,
  },
  label: {
    fontSize: 14,
    fontFamily: fonts.sansMedium,
    color: colors.muted,
    textTransform: 'uppercase',
  },
  passwordContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
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
});
