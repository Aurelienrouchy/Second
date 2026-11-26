import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useLayoutEffect, useRef, useState } from 'react';
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

import { Text, Label, Caption, ScreenHeader } from '@/components/ui';
import { useUser, useAuthenticatedUid } from '@/hooks/useAuth';
import { useLabelLifecycleContext } from '@/hooks/useLabelLifecycleContext';
import { getAuthSessionGeneration, useAuthStore } from '@/store/authStore';
import { auth } from '@/config/firebaseConfig';
import { staleTradeOperation } from '@/services/tradeOperation';
import { track } from '@/lib/analytics';
import { UserService } from '@/services/userService';
import { colors, fonts, spacing, radius } from '@/constants/theme';

export default function PhoneSettingsScreen() {
  const router = useRouter();
  const user = useUser();
  const uid = useAuthenticatedUid();
  const scope = JSON.stringify([uid, getAuthSessionGeneration(), user?.id]);
  const context = useLabelLifecycleContext(`phone-settings:${scope}`, uid);

  const [phoneNumber, setPhoneNumber] = useState(() => {
    // Si le numéro commence par +1, retirer le préfixe pour l'affichage
    const stored = user?.id === uid ? user.phoneNumber : null;
    if (!stored) return '';
    return stored.startsWith('+1') ? stored.slice(2).trim() : stored;
  });
  const [isSaving, setIsSaving] = useState(false);
  const [formScope, setFormScope] = useState(scope);
  const lock = useRef<symbol | null>(null);
  const form = useRef({scope, mounted: false});
  useLayoutEffect(() => {
    form.current = {scope, mounted: true}; lock.current = null;
    return () => {if (form.current.scope === scope) form.current.mounted = false;};
  }, [scope]);
  if (formScope !== scope) {
    const stored = user?.id === uid ? user.phoneNumber ?? '' : '';
    setFormScope(scope); setPhoneNumber(stored.startsWith('+1') ? stored.slice(2).trim() : stored);
    setIsSaving(false);
  }
  const ready = !!uid && user?.id === uid && auth.currentUser?.uid === uid && context.focused;

  const formatPhoneDisplay = (text: string) => {
    // Retirer tout sauf les chiffres
    const digits = text.replace(/\D/g, '');
    // Formater au fur et à mesure : (514) 555-1234
    if (digits.length <= 3) return digits;
    if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
  };

  const handlePhoneChange = (text: string) => {
    if (!ready || lock.current) return;
    const digits = text.replace(/\D/g, '');
    if (digits.length <= 10) {
      setPhoneNumber(formatPhoneDisplay(digits));
    }
  };

  const handleSave = async () => {
    if (!ready || !user || lock.current) return;
    const owner = auth.currentUser;
    if (!owner) return;
    let operation: ReturnType<typeof context.capture>;
    try {operation = context.capture();} catch {return;}
    const current = () => {
      context.assertCurrent(operation);
      if (auth.currentUser !== owner || owner.uid !== uid) throw staleTradeOperation();
    };

    // Validation pour un numéro canadien (10 chiffres)
    const cleanPhone = phoneNumber.replace(/\D/g, '');
    if (cleanPhone.length !== 10) {
      track('phone_saved', { success: false, validation_error: 'invalid_ca_number' });
      Alert.alert('Erreur', 'Veuillez entrer un numéro de téléphone canadien valide (10 chiffres)');
      return;
    }

    const ticket = Symbol(); lock.current = ticket; setIsSaving(true);
    try {
      current();
      // Stocker avec le préfixe +1
      await UserService.updateUserProfile(owner.uid, {
        phoneNumber: `+1${cleanPhone}`,
      }, current);
      current();

      // Rafraîchir les données utilisateur depuis Firestore
      await useAuthStore.getState().refreshUser();
      current();

      track('phone_saved', { success: true });

      Alert.alert('Succès', 'Votre numéro de téléphone a été mis à jour', [
        { text: 'OK', onPress: () => {try {current(); router.back();} catch { /* Superseded owner or route. */ }} }
      ]);
    } catch (error) {
      try {current();} catch {return;}
      if (__DEV__) console.error('Error updating phone:', error);
      track('phone_saved', { success: false });
      Alert.alert('Erreur', 'Une erreur est survenue lors de la mise à jour du numéro');
    } finally {
      if (lock.current === ticket) {
        lock.current = null;
        if (form.current.mounted && form.current.scope === scope && auth.currentUser === owner) setIsSaving(false);
      }
    }
  };

  return (
    <View style={styles.container}>
      <ScreenHeader
        title="Numéro de téléphone"
        onBack={() => router.back()}
        rightContent={
          <Pressable onPress={handleSave} disabled={!ready || isSaving}>
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
            <Ionicons name="information-circle-outline" size={24} color={colors.primary} />
            <Text variant="body" style={styles.infoText}>
              Ce numéro est une coordonnée de contact. Il n’est pas vérifié comme méthode de connexion ou de récupération de votre compte.
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
                  editable={ready && !isSaving}
                  onChangeText={handlePhoneChange}
                  placeholder="(514) 555-1234"
                  keyboardType="phone-pad"
                  autoComplete="tel"
                  textContentType="telephoneNumber"
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
