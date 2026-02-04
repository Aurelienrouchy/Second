/**
 * Email Settings
 * Design System: Luxe Français + Street Energy
 */

import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/contexts/AuthContext';
import { AuthService } from '@/services/authService';
import { colors, fonts, spacing, radius } from '@/constants/theme';
import { Text, Label, Caption } from '@/components/ui';

export default function EmailSettingsScreen() {
  const router = useRouter();
  const { user, signOut } = useAuth();

  const [newEmail, setNewEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmNewEmail, setConfirmNewEmail] = useState('');

  const [isSaving, setIsSaving] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleSave = async () => {
    if (!newEmail.trim() || !password || !confirmNewEmail.trim()) {
      Alert.alert('Erreur', 'Veuillez remplir tous les champs');
      return;
    }

    if (newEmail !== confirmNewEmail) {
      Alert.alert('Erreur', 'Les adresses email ne correspondent pas');
      return;
    }

    if (!user) return;

    setIsSaving(true);
    try {
      // 1. Re-authentifier
      await AuthService.reauthenticate(password);

      // 2. Mettre à jour l'email
      await AuthService.updateEmail(newEmail.trim());

      Alert.alert(
        'Succès',
        'Votre adresse email a été mise à jour. Veuillez vous reconnecter avec votre nouvel email.',
        [
          {
            text: 'OK',
            onPress: async () => {
              await signOut();
              router.replace('/(tabs)');
            }
          }
        ]
      );
    } catch (error: any) {
      console.error('Error updating email:', error);
      Alert.alert('Erreur', error.message || 'Une erreur est survenue lors de la mise à jour de l\'email');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <Stack.Screen options={{
        headerBackTitle: ' ',
        headerRight: () => (
          <TouchableOpacity onPress={handleSave} disabled={isSaving}>
            {isSaving ? (
              <ActivityIndicator color={colors.primary} />
            ) : (
              <Text variant="body" style={styles.headerButton}>Valider</Text>
            )}
          </TouchableOpacity>
        ),
      }} />

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
              />
            </View>

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
                />
                <TouchableOpacity
                  onPress={() => setShowPassword(!showPassword)}
                  style={styles.eyeButton}
                  activeOpacity={0.7}
                >
                  <Ionicons
                    name={showPassword ? "eye-off-outline" : "eye-outline"}
                    size={24}
                    color={colors.muted}
                  />
                </TouchableOpacity>
              </View>
              <Caption style={styles.helperText}>
                Pour votre sécurité, confirmez votre mot de passe pour valider le changement.
              </Caption>
            </View>
          </View>

          {/* Security Notice */}
          <View style={styles.securityBox}>
            <Ionicons name="shield-checkmark-outline" size={20} color={colors.success} />
            <Text variant="bodySmall" style={styles.securityText}>
              Un email de confirmation sera envoyé à votre nouvelle adresse. Vous devrez vous reconnecter après le changement.
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  headerButton: {
    color: colors.primary,
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
