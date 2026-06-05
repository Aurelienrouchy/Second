/**
 * Delete Account Settings
 */

import { useUser } from '@/hooks/useAuth';
import { AuthService } from '@/services/authService';
import { functions } from '@/config/firebaseConfig';
import { useAuthStore } from '@/store/authStore';
import { colors, fonts, spacing, radius } from '@/constants/theme';
import { Text, Label, Caption, ScreenHeader } from '@/components/ui';
import { Button } from '@/components/ui';
import { Ionicons } from '@expo/vector-icons';
import { httpsCallable } from 'firebase/functions';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

export default function DeleteAccountScreen() {
  const router = useRouter();
  const user = useUser();
  const [password, setPassword] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [loading, setLoading] = useState(false);
  const [reauthDone, setReauthDone] = useState(false);
  const [step, setStep] = useState<'info' | 'confirm'>('info');

  const provider = AuthService.getAuthProvider();
  const isPasswordUser = provider === 'password';
  const isUnknownProvider = provider === 'unknown';
  const isAppleOnAndroid = provider === 'apple.com' && Platform.OS !== 'ios';
  const hasPasswordProvider = AuthService.hasPasswordProvider();

  const handleReauthSocial = async () => {
    if (isUnknownProvider || isAppleOnAndroid) return;
    setLoading(true);
    try {
      if (provider === 'google.com') {
        await AuthService.reauthenticateWithGoogle();
      } else {
        await AuthService.reauthenticateWithApple();
      }
      setReauthDone(true);
    } catch (error: unknown) {
      const code = (error as { code?: string }).code;
      if (code !== 'ERR_REQUEST_CANCELED' && code !== 'SIGN_IN_CANCELLED') {
        Alert.alert('Erreur', 'La vérification a échoué. Veuillez réessayer.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleReauthApplePassword = async () => {
    if (!password) return;
    setLoading(true);
    try {
      await AuthService.reauthenticate(password);
      setReauthDone(true);
    } catch (error: unknown) {
      const message = (error as { message?: string }).message;
      Alert.alert('Erreur', message || 'Mot de passe incorrect. Veuillez réessayer.');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (!user) return;

    if (confirmText !== 'SUPPRIMER') {
      Alert.alert('Erreur', 'Veuillez saisir SUPPRIMER pour confirmer');
      return;
    }

    setLoading(true);
    try {
      if (isPasswordUser) {
        await AuthService.reauthenticate(password);
      }
      // Apple on Android with password: already re-authed via handleReauthApplePassword

      // The deletion gate (active transactions, open disputes, wallet balance /
      // pending / held funds, seller debt) is enforced server-side inside the
      // deleteUserAccount callable — client guards were bypassable. We call the
      // callable directly (instead of AuthService.deleteAccount, which collapses
      // the server message onto a generic auth error) so we can surface the
      // precise blocker the backend returns via `functions/failed-precondition`.
      const deleteUserAccountFn = httpsCallable(functions, 'deleteUserAccount');
      await deleteUserAccountFn();

      // signOut (not resetAllStores): full logout required, else the ghost session resurrects the user at cold start.
      await useAuthStore.getState().signOut();
      router.replace('/');
    } catch (error: unknown) {
      if (__DEV__) console.error('Error deleting account:', error);

      // Firebase callable wraps server HttpsError into a FirebaseError with
      // code = "functions/<code>". A `failed-precondition` means the backend
      // refused the deletion (frozen/pending funds, seller debt, open dispute
      // or active transaction) — its `message` is already a user-facing FR
      // string, so we surface it verbatim instead of a generic error.
      const code =
        error && typeof error === 'object' && 'code' in error
          ? (error as { code?: unknown }).code
          : undefined;
      const serverMessage =
        error instanceof Error && error.message ? error.message : undefined;

      if (code === 'functions/failed-precondition' && serverMessage) {
        Alert.alert('Suppression impossible', serverMessage, [{ text: 'Compris' }]);
        return;
      }

      Alert.alert(
        'Erreur',
        serverMessage || 'Une erreur est survenue lors de la suppression du compte'
      );
    } finally {
      setLoading(false);
    }
  };

  const renderInfoStep = () => (
    <View style={styles.stepContent}>
      {/* Warning Box */}
      <View style={styles.warningBox}>
        <View style={styles.warningIconContainer}>
          <Ionicons name="warning" size={48} color={colors.danger} />
        </View>
        <Text variant="h2" style={styles.warningTitle}>Supprimer votre compte</Text>
        <Caption style={styles.warningText}>
          Cette action est irréversible. Toutes vos données seront supprimées définitivement.
        </Caption>
      </View>

      {/* What will be deleted */}
      <Label style={styles.sectionHeader}>Ce qui sera supprimé</Label>
      <View style={styles.infoList}>
        {[
          'Votre profil et vos informations personnelles',
          'Tous vos articles en vente',
          'Vos favoris et recherches sauvegardées',
          'Vos notifications',
          'Votre historique de swaps',
        ].map((item, index) => (
          <View key={index} style={styles.infoItem}>
            <Ionicons name="close-circle" size={20} color={colors.danger} />
            <Text variant="bodySmall" style={styles.infoItemText}>{item}</Text>
          </View>
        ))}
      </View>

      {/* What will be kept */}
      <Label style={styles.sectionHeader}>Ce qui sera conservé</Label>
      <View style={styles.infoList}>
        <View style={styles.infoItem}>
          <Ionicons name="information-circle" size={20} color={colors.foregroundSecondary} />
          <Text variant="bodySmall" style={styles.infoItemText}>
            Les conversations seront anonymisées (l'autre participant les conserve)
          </Text>
        </View>
      </View>

      {/* Privacy law note */}
      <View style={styles.rgpdBox}>
        <Ionicons name="shield-checkmark" size={20} color={colors.success} />
        <Text variant="bodySmall" style={styles.rgpdText}>
          Conformément à la Loi 25 du Québec et à la LPRPDE (PIPEDA), vous avez le droit à l'effacement de vos données personnelles.
        </Text>
      </View>

      {/* Actions */}
      <View style={styles.actions}>
        <Button variant="danger" fullWidth onPress={() => setStep('confirm')}>
          Continuer
        </Button>
        <Button variant="muted" fullWidth onPress={() => router.back()}>
          Annuler
        </Button>
      </View>
    </View>
  );

  const canDelete = isUnknownProvider
    ? false
    : (isAppleOnAndroid && !hasPasswordProvider)
      ? false
      : isPasswordUser
        ? !!password && confirmText === 'SUPPRIMER'
        : reauthDone && confirmText === 'SUPPRIMER';

  const renderConfirmStep = () => (
    <View style={styles.stepContent}>
      {/* Confirm Header */}
      <View style={styles.confirmHeader}>
        <View style={styles.confirmIconContainer}>
          <Ionicons name="alert-circle" size={64} color={colors.danger} />
        </View>
        <Text variant="h2" style={styles.confirmTitle}>Confirmation finale</Text>
        <Caption style={styles.confirmSubtitle}>Cette action ne peut pas être annulée</Caption>
      </View>

      {/* Re-authentication */}
      {isUnknownProvider ? (
        <View style={styles.inputSection}>
          <Label style={styles.inputLabel}>Vérification d'identité</Label>
          <View style={styles.unknownProviderBox}>
            <Ionicons name="alert-circle" size={20} color={colors.warning} />
            <Caption style={styles.unknownProviderText}>
              Impossible de déterminer votre méthode de connexion. Veuillez vous déconnecter et vous reconnecter avant de supprimer votre compte.
            </Caption>
          </View>
        </View>
      ) : isPasswordUser ? (
        <View style={styles.inputSection}>
          <Label style={styles.inputLabel}>Mot de passe actuel</Label>
          <TextInput
            style={styles.input}
            placeholder="Saisissez votre mot de passe"
            placeholderTextColor={colors.muted}
            secureTextEntry
            value={password}
            onChangeText={setPassword}
            autoCapitalize="none"
          />
        </View>
      ) : isAppleOnAndroid ? (
        <View style={styles.inputSection}>
          <Label style={styles.inputLabel}>Vérification d'identité</Label>
          {hasPasswordProvider ? (
            reauthDone ? (
              <View style={styles.reauthSuccess}>
                <Ionicons name="checkmark-circle" size={20} color={colors.success} />
                <Caption style={styles.reauthSuccessText}>Identité vérifiée</Caption>
              </View>
            ) : (
              <View style={styles.applePasswordSection}>
                <Caption style={styles.applePasswordHint}>
                  La ré-authentification Apple n'est pas disponible sur Android. Utilisez votre mot de passe pour vérifier votre identité.
                </Caption>
                <TextInput
                  style={styles.input}
                  placeholder="Saisissez votre mot de passe"
                  placeholderTextColor={colors.muted}
                  secureTextEntry
                  value={password}
                  onChangeText={setPassword}
                  autoCapitalize="none"
                />
                <Button
                  variant="secondary"
                  fullWidth
                  loading={loading}
                  disabled={!password}
                  onPress={handleReauthApplePassword}
                  leftIcon={
                    <Ionicons name="key-outline" size={18} color={colors.foreground} />
                  }
                >
                  Vérifier mon identité
                </Button>
              </View>
            )
          ) : (
            <View style={styles.appleNoPasswordSection}>
              <View style={styles.unknownProviderBox}>
                <Ionicons name="alert-circle" size={20} color={colors.warning} />
                <Caption style={styles.unknownProviderText}>
                  La ré-authentification Apple n'est pas disponible sur Android. Ajoutez d'abord un mot de passe à votre compte.
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
          )}
        </View>
      ) : (
        <View style={styles.inputSection}>
          <Label style={styles.inputLabel}>Vérification d'identité</Label>
          {reauthDone ? (
            <View style={styles.reauthSuccess}>
              <Ionicons name="checkmark-circle" size={20} color={colors.success} />
              <Caption style={styles.reauthSuccessText}>Identité vérifiée</Caption>
            </View>
          ) : (
            <Button
              variant="secondary"
              fullWidth
              loading={loading}
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
        </View>
      )}

      {/* Confirm Text Input */}
      <View style={styles.inputSection}>
        <Label style={styles.inputLabel}>
          Veuillez saisir <Text variant="body" style={styles.bold}>SUPPRIMER</Text> pour confirmer
        </Label>
        <TextInput
          style={styles.input}
          placeholder="SUPPRIMER"
          placeholderTextColor={colors.muted}
          value={confirmText}
          onChangeText={setConfirmText}
          autoCapitalize="characters"
        />
      </View>

      {/* Actions */}
      <View style={styles.actions}>
        <Button
          variant="danger"
          fullWidth
          loading={loading}
          disabled={!canDelete}
          onPress={handleDeleteAccount}
          leftIcon={<Ionicons name="trash" size={18} color={colors.white} />}
        >
          Supprimer définitivement
        </Button>
        <Button variant="muted" fullWidth onPress={() => setStep('info')} disabled={loading}>
          Retour
        </Button>
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      <ScreenHeader title="Supprimer mon compte" onBack={() => router.back()} />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {step === 'info' ? renderInfoStep() : renderConfirmStep()}
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
  stepContent: {
    flex: 1,
  },
  warningBox: {
    backgroundColor: colors.dangerLight,
    borderRadius: radius.md,
    padding: spacing.lg,
    alignItems: 'center',
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: colors.danger,
  },
  warningIconContainer: {
    marginBottom: spacing.md,
  },
  warningTitle: {
    color: colors.danger,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  warningText: {
    textAlign: 'center',
    color: colors.foregroundSecondary,
  },
  sectionHeader: {
    color: colors.foregroundSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
    marginTop: spacing.sm,
  },
  infoList: {
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.borderLight,
    padding: spacing.md,
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  infoItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  infoItemText: {
    flex: 1,
    color: colors.foreground,
  },
  rgpdBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: colors.successLight,
    borderRadius: radius.sm,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  rgpdText: {
    flex: 1,
    color: colors.foreground,
  },
  actions: {
    gap: spacing.sm,
  },
  confirmHeader: {
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  confirmIconContainer: {
    marginBottom: spacing.md,
  },
  confirmTitle: {
    color: colors.foreground,
    marginBottom: spacing.xs,
  },
  confirmSubtitle: {
    color: colors.foregroundSecondary,
  },
  inputSection: {
    marginBottom: spacing.lg,
  },
  inputLabel: {
    color: colors.foregroundSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
  },
  bold: {
    fontFamily: fonts.sansBold,
    color: colors.danger,
  },
  input: {
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    padding: spacing.md,
    fontSize: 16,
    fontFamily: fonts.sans,
    color: colors.foreground,
    borderWidth: 1.5,
    borderColor: colors.border,
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
  applePasswordSection: {
    gap: spacing.sm,
  },
  applePasswordHint: {
    color: colors.foregroundSecondary,
  },
  appleNoPasswordSection: {
    gap: spacing.sm,
  },
});
