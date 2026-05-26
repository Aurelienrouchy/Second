/**
 * Stripe Connect Onboarding Screen
 *
 * Allows sellers to set up their Stripe Connect account for receiving payouts.
 * Calls getStripeAccountStatus to check current status and
 * createStripeConnectAccount to initiate onboarding.
 */

import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { httpsCallable } from 'firebase/functions';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as Linking from 'expo-linking';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { Button, ScreenHeader, Skeleton, Text } from '@/components/ui';
import { functions } from '@/config/firebaseConfig';
import { colors, fonts, spacing, radius, typography } from '@/constants/theme';
import { useAuthRequired } from '@/hooks/useAuthRequired';

// ---------------------------------------------------------------------------
// CF callable typings
// ---------------------------------------------------------------------------

interface StripeAccountStatus {
  hasAccount: boolean;
  accountId?: string;
  chargesEnabled?: boolean;
  payoutsEnabled?: boolean;
  detailsSubmitted?: boolean;
  status?: 'pending' | 'active' | 'restricted';
}

interface CreateAccountResponse {
  accountId: string;
  accountLinkUrl?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function StripeOnboardingScreen() {
  const router = useRouter();
  const { user, isLoggedIn } = useAuthRequired();
  const queryClient = useQueryClient();

  const [transitNumber, setTransitNumber] = useState('');
  const [institutionNumber, setInstitutionNumber] = useState('');
  const [accountNumber, setAccountNumber] = useState('');

  // ---- Stripe account status query ----
  const {
    data: accountStatus,
    isLoading,
    refetch,
    isRefetching,
  } = useQuery<StripeAccountStatus>({
    queryKey: ['stripe', 'accountStatus', user?.id],
    queryFn: async () => {
      const fn = httpsCallable<Record<string, never>, StripeAccountStatus>(
        functions,
        'getStripeAccountStatus',
      );
      const result = await fn({});
      return result.data;
    },
    enabled: !!user,
    staleTime: 60 * 1000,
  });

  // ---- Create Stripe account mutation ----
  const createAccountMutation = useMutation<CreateAccountResponse, Error>({
    mutationFn: async () => {
      const bankInfo =
        transitNumber && institutionNumber && accountNumber
          ? {
              transit: transitNumber,
              institution: institutionNumber,
              account: accountNumber,
            }
          : undefined;

      const fn = httpsCallable<
        { bankInfo?: { transit: string; institution: string; account: string } },
        CreateAccountResponse
      >(functions, 'createStripeConnectAccount');

      const result = await fn({ bankInfo });
      return result.data;
    },
    onSuccess: async (data) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await queryClient.invalidateQueries({
        queryKey: ['stripe', 'accountStatus', user?.id],
      });

      if (data.accountLinkUrl) {
        Alert.alert(
          'Compte en cours de configuration',
          'Vous allez etre redirige vers Stripe pour completer votre inscription.',
          [
            {
              text: 'Continuer',
              onPress: () => Linking.openURL(data.accountLinkUrl!),
            },
          ],
        );
      } else {
        Alert.alert('Succes', 'Votre compte de paiement a ete cree.');
      }
    },
    onError: (error) => {
      if (__DEV__) console.error('Error creating Stripe account:', error);
      Alert.alert(
        'Erreur',
        error.message || 'Impossible de configurer le compte de paiement.',
      );
    },
  });

  // ---- Auth guard ----
  if (!isLoggedIn) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Compte de paiement" onBack={() => router.back()} />
        <View style={styles.centerState}>
          <Ionicons name="lock-closed-outline" size={48} color={colors.muted} />
          <Text style={styles.centerStateText}>
            Connectez-vous pour configurer votre compte de paiement
          </Text>
          <Button
            variant="primary"
            onPress={() => router.replace('/(tabs)/profile')}
            style={styles.centerStateButton}
          >
            Se connecter
          </Button>
        </View>
      </View>
    );
  }

  // ---- Loading skeleton ----
  if (isLoading) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Compte de paiement" onBack={() => router.back()} />
        <View style={styles.content}>
          <Skeleton width="100%" height={120} borderRadius={radius.xl} />
          <Skeleton
            width="100%"
            height={200}
            borderRadius={radius.xl}
            style={{ marginTop: spacing.lg }}
          />
        </View>
      </View>
    );
  }

  const isActive = accountStatus?.chargesEnabled === true;
  const isPending =
    accountStatus?.hasAccount && !accountStatus.chargesEnabled;

  return (
    <View style={styles.container}>
      <ScreenHeader title="Compte de paiement" onBack={() => router.back()} />

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* Status Card */}
        <View
          style={[
            styles.statusCard,
            isActive && styles.statusCardActive,
            isPending && styles.statusCardPending,
          ]}
        >
          <View style={styles.statusIconRow}>
            <Ionicons
              name={
                isActive
                  ? 'checkmark-circle'
                  : isPending
                    ? 'time'
                    : 'card-outline'
              }
              size={32}
              color={
                isActive
                  ? colors.success
                  : isPending
                    ? colors.primary
                    : colors.muted
              }
            />
          </View>
          <Text style={styles.statusTitle}>
            {isActive
              ? 'Votre compte est actif'
              : isPending
                ? 'Configuration en cours'
                : 'Aucun compte configure'}
          </Text>
          <Text style={styles.statusDescription}>
            {isActive
              ? 'Vous pouvez recevoir des paiements et demander des retraits.'
              : isPending
                ? 'Votre compte Stripe est en cours de verification. Vous recevrez une notification lorsque celui-ci sera actif.'
                : 'Configurez votre compte de paiement pour recevoir les gains de vos ventes.'}
          </Text>

          {isPending && accountStatus?.detailsSubmitted === false && (
            <Button
              variant="primary"
              fullWidth
              onPress={() => refetch()}
              loading={isRefetching}
              style={styles.statusAction}
            >
              Actualiser le statut
            </Button>
          )}
        </View>

        {/* Setup Form (only if no account yet) */}
        {!accountStatus?.hasAccount && (
          <View style={styles.formSection}>
            <Text style={styles.formTitle}>Informations bancaires</Text>
            <Text style={styles.formDescription}>
              Ces informations seront transmises de facon securisee a Stripe pour
              configurer vos virements.
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

            <Button
              variant="primary"
              fullWidth
              loading={createAccountMutation.isPending}
              disabled={createAccountMutation.isPending}
              onPress={() => {
                if (transitNumber.length !== 5) {
                  Alert.alert(
                    'Erreur',
                    'Le numero de transit doit contenir 5 chiffres',
                  );
                  return;
                }
                if (institutionNumber.length !== 3) {
                  Alert.alert(
                    'Erreur',
                    "Le numero d'institution doit contenir 3 chiffres",
                  );
                  return;
                }
                if (accountNumber.length < 7) {
                  Alert.alert(
                    'Erreur',
                    'Le numero de compte doit contenir au moins 7 chiffres',
                  );
                  return;
                }
                createAccountMutation.mutate();
              }}
              leftIcon={
                <Ionicons
                  name="shield-checkmark-outline"
                  size={20}
                  color={colors.white}
                />
              }
              style={styles.submitButton}
            >
              Configurer mon compte de paiement
            </Button>
          </View>
        )}

        {/* Info box */}
        <View style={styles.infoBox}>
          <Ionicons
            name="information-circle-outline"
            size={20}
            color={colors.primary}
          />
          <Text style={styles.infoText}>
            Les paiements sont securises par Stripe. Vos informations bancaires
            ne sont jamais stockees sur nos serveurs.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
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
  statusCard: {
    backgroundColor: colors.surfaceWarm,
    borderRadius: radius.xl,
    padding: spacing.lg,
    alignItems: 'center',
  },
  statusCardActive: {
    backgroundColor: colors.successLight,
  },
  statusCardPending: {
    backgroundColor: colors.primaryLight,
  },
  statusIconRow: {
    marginBottom: spacing.md,
  },
  statusTitle: {
    ...typography.h3,
    color: colors.foreground,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  statusDescription: {
    ...typography.body,
    color: colors.muted,
    textAlign: 'center',
  },
  statusAction: {
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
  submitButton: {
    marginTop: spacing.md,
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
