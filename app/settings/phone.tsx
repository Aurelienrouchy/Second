import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
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
import { SafeAreaView } from 'react-native-safe-area-context';

import { Text, Label, Caption, ScreenHeader } from '@/components/ui';
import { useUser, useAuthActions } from '@/contexts/AuthContext';
import { UserService } from '@/services/userService';
import { colors, fonts, spacing, radius } from '@/constants/theme';

export default function PhoneSettingsScreen() {
  const router = useRouter();
  const user = useUser();
  const { refreshUser } = useAuthActions();

  const [phoneNumber, setPhoneNumber] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (user && user.phoneNumber) {
      // Si le numéro commence par +1, retirer le préfixe pour l'affichage
      const stored = user.phoneNumber;
      if (stored.startsWith('+1')) {
        setPhoneNumber(stored.slice(2).trim());
      } else {
        setPhoneNumber(stored);
      }
    }
  }, [user]);

  const formatPhoneDisplay = (text: string) => {
    // Retirer tout sauf les chiffres
    const digits = text.replace(/\D/g, '');
    // Formater au fur et à mesure : (514) 555-1234
    if (digits.length <= 3) return digits;
    if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
  };

  const handlePhoneChange = (text: string) => {
    const digits = text.replace(/\D/g, '');
    if (digits.length <= 10) {
      setPhoneNumber(formatPhoneDisplay(digits));
    }
  };

  const handleSave = async () => {
    if (!user) return;

    // Validation pour un numéro canadien (10 chiffres)
    const cleanPhone = phoneNumber.replace(/\D/g, '');
    if (cleanPhone.length !== 10) {
      Alert.alert('Erreur', 'Veuillez entrer un numéro de téléphone canadien valide (10 chiffres)');
      return;
    }

    setIsSaving(true);
    try {
      // Stocker avec le préfixe +1
      await UserService.updateUserProfile(user.id, {
        phoneNumber: `+1${cleanPhone}`,
      });

      // Rafraîchir les données utilisateur depuis Firestore
      await refreshUser();

      Alert.alert('Succès', 'Votre numéro de téléphone a été mis à jour', [
        { text: 'OK', onPress: () => router.back() }
      ]);
    } catch (error) {
      if (__DEV__) console.error('Error updating phone:', error);
      Alert.alert('Erreur', 'Une erreur est survenue lors de la mise à jour du numéro');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <Stack.Screen options={{
        headerRight: () => (
          <Pressable onPress={handleSave} disabled={isSaving}>
            {isSaving ? (
              <ActivityIndicator color={colors.primary} />
            ) : (
              <Text variant="body" style={styles.headerButton}>Enregistrer</Text>
            )}
          </Pressable>
        ),
      }} />

      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
          <View style={styles.infoBox}>
            <Ionicons name="information-circle-outline" size={24} color={colors.primary} />
            <Text variant="body" style={styles.infoText}>
              Ajouter un numéro de téléphone aide à sécuriser votre compte et facilite les transactions.
            </Text>
          </View>

          <View style={styles.formSection}>
            <View style={styles.inputContainer}>
              <Label style={styles.label}>Numéro de téléphone</Label>
              <View style={styles.phoneRow}>
                <View style={styles.countryCode}>
                  <Text variant="body" style={styles.countryCodeText}>CA +1</Text>
                </View>
                <TextInput
                  style={[styles.input, styles.phoneInput]}
                  value={phoneNumber}
                  onChangeText={handlePhoneChange}
                  placeholder="(514) 555-1234"
                  keyboardType="phone-pad"
                  autoComplete="tel"
                  maxLength={14}
                />
              </View>
              <Caption>
                Numéro de téléphone canadien à 10 chiffres.
              </Caption>
            </View>
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
  },
  infoBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: colors.primaryLight,
    padding: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.lg,
  },
  infoText: {
    flex: 1,
  },
  formSection: {
    gap: spacing.lg,
  },
  inputContainer: {
    gap: spacing.sm,
  },
  label: {
    color: colors.foregroundSecondary,
    textTransform: 'uppercase',
  },
  phoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  countryCode: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  countryCodeText: {
    fontSize: 16,
    fontFamily: fonts.sansMedium,
    color: colors.foreground,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    fontSize: 16,
    fontFamily: fonts.sans,
    color: colors.foreground,
    backgroundColor: colors.background,
  },
  phoneInput: {
    flex: 1,
  },
});
