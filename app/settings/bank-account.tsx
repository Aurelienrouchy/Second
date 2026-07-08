/**
 * Bank Account Screen (Compte bancaire) — F60
 *
 * Gestion post-onboarding du compte bancaire de retrait du vendeur (Stripe
 * Connect Custom, white-label). Affiche le compte actuel (•••• 1234 + statut de
 * vérification) et un formulaire de REMPLACEMENT (transit 5 / institution 3 /
 * compte 7-12) appelant addBankAccount via StripeAccountService.
 *
 * Accessible depuis stripe-onboarding (quand hasAccount=true) et depuis le
 * wallet (utile après un payout échoué : le compte fermé doit être remplacé).
 */

import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Stack, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { Button, ScreenHeader, Skeleton, Text } from '@/components/ui';
import { colors, radius, spacing, typography } from '@/constants/theme';
import { track } from '@/lib/analytics';
import { useStripeAccount } from '@/hooks/useStripeAccount';
import { useAuthRequired } from '@/hooks/useAuthRequired';
import { translateBankStatus } from '@/utils/stripeRequirements';

export default function BankAccountScreen() {
  const router = useRouter();
  const { user, isLoggedIn } = useAuthRequired();

  const {
    status,
    isLoading,
    refetch,
    isRefetching,
    replaceBankAccount,
    isReplacingBank,
  } = useStripeAccount(user?.id);

  const [showForm, setShowForm] = useState(false);
  const [transitNumber, setTransitNumber] = useState('');
  const [institutionNumber, setInstitutionNumber] = useState('');
  const [accountNumber, setAccountNumber] = useState('');

  const validate = useCallback(():
    | { message: string; result: 'transit_invalid' | 'institution_invalid' | 'account_invalid' }
    | null => {
    if (transitNumber.length !== 5) {
      return { message: 'Le numero de transit doit contenir 5 chiffres', result: 'transit_invalid' };
    }
    if (institutionNumber.length !== 3) {
      return { message: "Le numero d'institution doit contenir 3 chiffres", result: 'institution_invalid' };
    }
    if (accountNumber.length < 7) {
      return { message: 'Le numero de compte doit contenir au moins 7 chiffres', result: 'account_invalid' };
    }
    return null;
  }, [transitNumber, institutionNumber, accountNumber]);

  const handleSubmit = useCallback(async () => {
    const isReplacement = !!status?.bankAccountLast4;
    const validationError = validate();
    if (validationError) {
      track('bank_account_saved', {
        is_replacement: isReplacement,
        validation_result: validationError.result,
        success: false,
      });
      Alert.alert('Erreur', validationError.message);
      return;
    }

    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const result = await replaceBankAccount({
        transitNumber,
        institutionNumber,
        accountNumber,
      });
      track('bank_account_saved', {
        is_replacement: isReplacement,
        validation_result: 'ok',
        success: true,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setShowForm(false);
      setTransitNumber('');
      setInstitutionNumber('');
      setAccountNumber('');
      Alert.alert(
        'Compte bancaire mis a jour',
        `Vos prochains retraits seront envoyes vers le compte se terminant par ${result.bankAccountLast4}.`,
      );
    } catch (error: unknown) {
      if (__DEV__) console.error('Replace bank account error:', error);
      track('bank_account_saved', {
        is_replacement: isReplacement,
        validation_result: 'ok',
        success: false,
        error_code:
          error && typeof error === 'object' && 'code' in error
            ? String((error as { code?: unknown }).code)
            : undefined,
      });
      const msg =
        error instanceof Error
          ? error.message
          : 'Impossible de mettre a jour le compte bancaire.';
      Alert.alert('Erreur', msg);
    }
  }, [validate, replaceBankAccount, transitNumber, institutionNumber, accountNumber, status]);

  // ── Auth guard ──
  if (!isLoggedIn) {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ headerShown: false }} />
        <ScreenHeader title="Compte bancaire" onBack={() => router.back()} />
        <View style={styles.centerState}>
          <Ionicons name="lock-closed-outline" size={48} color={colors.muted} />
          <Text style={styles.centerStateText}>
            Connectez-vous pour gerer votre compte bancaire
          </Text>
        </View>
      </View>
    );
  }

  if (isLoading) {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ headerShown: false }} />
        <ScreenHeader title="Compte bancaire" onBack={() => router.back()} />
        <View style={styles.content}>
          <Skeleton width="100%" height={120} borderRadius={radius.xl} />
        </View>
      </View>
    );
  }

  // No Stripe account yet → route the seller to onboarding.
  if (!status?.hasAccount) {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ headerShown: false }} />
        <ScreenHeader title="Compte bancaire" onBack={() => router.back()} />
        <View style={styles.centerState}>
          <Ionicons name="card-outline" size={48} color={colors.muted} />
          <Text style={styles.centerStateText}>
            {"Configurez d'abord votre compte de paiement pour ajouter un compte bancaire."}
          </Text>
          <Button
            variant="primary"
            onPress={() => router.replace('/settings/stripe-onboarding')}
            style={styles.centerStateButton}
          >
            Configurer
          </Button>
        </View>
      </View>
    );
  }

  const last4 = status.bankAccountLast4;
  const bankStatusLabel = translateBankStatus(
    user?.stripeBankAccountStatus ?? null,
  );

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScreenHeader title="Compte bancaire" onBack={() => router.back()} />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.flex}
      >
        <ScrollView
          style={styles.content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Current bank account */}
          <View style={styles.bankCard}>
            <View style={styles.bankIconRow}>
              <Ionicons
                name="business-outline"
                size={28}
                color={colors.primary}
              />
            </View>
            {last4 ? (
              <>
                <Text style={styles.bankNumber}>{`•••• ${last4}`}</Text>
                {bankStatusLabel ? (
                  <Text style={styles.bankStatus}>{bankStatusLabel}</Text>
                ) : null}
                <Text style={styles.bankHint}>
                  Vos retraits sont envoyes vers ce compte.
                </Text>
              </>
            ) : (
              <>
                <Text style={styles.bankNumber}>Aucun compte bancaire</Text>
                <Text style={styles.bankHint}>
                  Ajoutez un compte bancaire pour recevoir vos retraits.
                </Text>
              </>
            )}

            <Button
              variant="primary"
              fullWidth
              onPress={() => refetch()}
              loading={isRefetching}
              style={styles.refreshButton}
            >
              Actualiser
            </Button>
          </View>

          {/* Replace toggle */}
          {!showForm && (
            <Button
              variant="muted"
              fullWidth
              onPress={() => setShowForm(true)}
              style={styles.replaceToggle}
              leftIcon={
                <Ionicons
                  name="swap-horizontal-outline"
                  size={20}
                  color={colors.charcoal}
                />
              }
            >
              {last4 ? 'Remplacer le compte bancaire' : 'Ajouter un compte bancaire'}
            </Button>
          )}

          {/* Replacement form */}
          {showForm && (
            <View style={styles.formSection}>
              <Text style={styles.formTitle}>
                {last4 ? 'Nouveau compte bancaire' : 'Compte bancaire'}
              </Text>
              <Text style={styles.formDescription}>
                {"Ces informations seront transmises de facon securisee a Stripe pour configurer vos virements. Le nouveau compte remplace l'ancien."}
              </Text>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Numero de transit</Text>
                <TextInput
                  style={styles.input}
                  placeholder="12345"
                  placeholderTextColor={colors.muted}
                  value={transitNumber}
                  onChangeText={(t) =>
                    setTransitNumber(t.replace(/\D/g, '').slice(0, 5))
                  }
                  keyboardType="number-pad"
                  maxLength={5}
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>{"Numero d'institution"}</Text>
                <TextInput
                  style={styles.input}
                  placeholder="001"
                  placeholderTextColor={colors.muted}
                  value={institutionNumber}
                  onChangeText={(t) =>
                    setInstitutionNumber(t.replace(/\D/g, '').slice(0, 3))
                  }
                  keyboardType="number-pad"
                  maxLength={3}
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Numero de compte</Text>
                <TextInput
                  style={styles.input}
                  placeholder="1234567"
                  placeholderTextColor={colors.muted}
                  value={accountNumber}
                  onChangeText={(t) =>
                    setAccountNumber(t.replace(/\D/g, '').slice(0, 12))
                  }
                  keyboardType="number-pad"
                  maxLength={12}
                />
              </View>

              <View style={styles.formActions}>
                <Button
                  variant="muted"
                  style={styles.formActionButton}
                  onPress={() => {
                    setShowForm(false);
                    setTransitNumber('');
                    setInstitutionNumber('');
                    setAccountNumber('');
                  }}
                  disabled={isReplacingBank}
                >
                  Annuler
                </Button>
                <Button
                  variant="primary"
                  style={styles.formActionButton}
                  loading={isReplacingBank}
                  disabled={isReplacingBank}
                  onPress={handleSubmit}
                >
                  Enregistrer
                </Button>
              </View>
            </View>
          )}

          <View style={styles.infoBox}>
            <Ionicons
              name="information-circle-outline"
              size={20}
              color={colors.primary}
            />
            <Text style={styles.infoText}>
              Vos informations bancaires sont securisees par Stripe et ne sont
              jamais stockees sur nos serveurs.
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
  flex: {
    flex: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
  centerState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
  },
  centerStateText: {
    ...typography.body,
    color: colors.muted,
    textAlign: 'center',
    marginTop: spacing.md,
    marginBottom: spacing.lg,
  },
  centerStateButton: {
    minWidth: 160,
  },
  bankCard: {
    backgroundColor: colors.surfaceWarm,
    borderRadius: radius.xl,
    padding: spacing.lg,
    alignItems: 'center',
  },
  bankIconRow: {
    marginBottom: spacing.md,
  },
  bankNumber: {
    ...typography.h3,
    color: colors.foreground,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  bankStatus: {
    ...typography.label,
    color: colors.muted,
    marginBottom: spacing.xs,
  },
  bankHint: {
    ...typography.caption,
    color: colors.muted,
    textAlign: 'center',
  },
  refreshButton: {
    marginTop: spacing.lg,
  },
  replaceToggle: {
    marginTop: spacing.lg,
  },
  formSection: {
    marginTop: spacing.lg,
    backgroundColor: colors.surfaceWarm,
    borderRadius: radius.xl,
    padding: spacing.lg,
  },
  formTitle: {
    ...typography.h3,
    color: colors.foreground,
    marginBottom: spacing.sm,
  },
  formDescription: {
    ...typography.body,
    color: colors.muted,
    marginBottom: spacing.lg,
  },
  inputGroup: {
    marginBottom: spacing.md,
  },
  inputLabel: {
    ...typography.label,
    color: colors.foreground,
    marginBottom: spacing.sm,
  },
  input: {
    ...typography.body,
    color: colors.foreground,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  formActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  formActionButton: {
    flex: 1,
  },
  infoBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: colors.primaryLight,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginTop: spacing.lg,
    marginBottom: spacing.xl,
  },
  infoText: {
    ...typography.caption,
    color: colors.foreground,
    flex: 1,
  },
});
