/**
 * Stripe Connect Onboarding Screen
 *
 * Allows sellers to set up their Stripe Connect account for receiving payouts.
 * Collects personal info (name, DOB), address, and bank details in a single
 * form, then calls createStripeConnectAccount + addBankAccount.
 *
 * Pre-fills name and address from the user's profile when available.
 */

import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { httpsCallable } from 'firebase/functions';
import { Stack, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import React, { useState, useEffect, useCallback } from 'react';
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
import { functions } from '@/config/firebaseConfig';
import { COPY_SELL_GATE } from '@/constants/authMessages';
import { colors, spacing, radius, typography } from '@/constants/theme';
import { useAuthRequired } from '@/hooks/useAuthRequired';
import { canSell } from '@/utils/age';

// ---------------------------------------------------------------------------
// CF callable typings
// ---------------------------------------------------------------------------

interface StripeAccountStatus {
  hasAccount: boolean;
  accountId?: string;
  chargesEnabled?: boolean;
  payoutsEnabled?: boolean;
  detailsSubmitted?: boolean;
  requirements?: string[];
  status?: 'pending' | 'active' | 'restricted';
}

interface CreateAccountResponse {
  success: boolean;
  stripeAccountId: string;
}

interface AddBankAccountResponse {
  success: boolean;
  bankAccountLast4: string;
}

// ---------------------------------------------------------------------------
// Canadian provinces
// ---------------------------------------------------------------------------

const PROVINCES = [
  { code: 'AB', label: 'Alberta' },
  { code: 'BC', label: 'Colombie-Britannique' },
  { code: 'MB', label: 'Manitoba' },
  { code: 'NB', label: 'Nouveau-Brunswick' },
  { code: 'NL', label: 'Terre-Neuve-et-Labrador' },
  { code: 'NS', label: 'Nouvelle-Ecosse' },
  { code: 'NT', label: 'Territoires du Nord-Ouest' },
  { code: 'NU', label: 'Nunavut' },
  { code: 'ON', label: 'Ontario' },
  { code: 'PE', label: 'Ile-du-Prince-Edouard' },
  { code: 'QC', label: 'Quebec' },
  { code: 'SK', label: 'Saskatchewan' },
  { code: 'YT', label: 'Yukon' },
] as const;

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

const POSTAL_CODE_REGEX = /^[A-Za-z]\d[A-Za-z]\s?\d[A-Za-z]\d$/;

function formatPostalCode(raw: string): string {
  const clean = raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  if (clean.length > 3) {
    return `${clean.slice(0, 3)} ${clean.slice(3)}`;
  }
  return clean;
}

function isAtLeast18(day: number, month: number, year: number): boolean {
  const today = new Date();
  const dob = new Date(year, month - 1, day);
  const age = today.getFullYear() - dob.getFullYear();
  const monthDiff = today.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
    return age - 1 >= 18;
  }
  return age >= 18;
}

function isValidDate(day: number, month: number, year: number): boolean {
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  if (year < 1900 || year > new Date().getFullYear()) return false;
  const d = new Date(year, month - 1, day);
  return (
    d.getFullYear() === year &&
    d.getMonth() === month - 1 &&
    d.getDate() === day
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function StripeOnboardingScreen() {
  const router = useRouter();
  const { user, isLoggedIn } = useAuthRequired();
  const queryClient = useQueryClient();

  // -- Personal info --
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [dobDay, setDobDay] = useState('');
  const [dobMonth, setDobMonth] = useState('');
  const [dobYear, setDobYear] = useState('');

  // -- Address --
  const [street, setStreet] = useState('');
  const [city, setCity] = useState('');
  const [province, setProvince] = useState('QC');
  const [postalCode, setPostalCode] = useState('');

  // -- Bank info --
  const [transitNumber, setTransitNumber] = useState('');
  const [institutionNumber, setInstitutionNumber] = useState('');
  const [accountNumber, setAccountNumber] = useState('');

  // -- Pre-fill from user profile --
  useEffect(() => {
    if (!user) return;

    // Attempt to split displayName into first/last
    if (user.displayName) {
      const parts = user.displayName.trim().split(/\s+/);
      if (parts.length >= 2) {
        setFirstName(parts[0]);
        setLastName(parts.slice(1).join(' '));
      } else if (parts.length === 1) {
        setFirstName(parts[0]);
      }
    }

    // Pre-fill address
    if (user.address) {
      if (user.address.street) setStreet(user.address.street);
      if (user.address.city) setCity(user.address.city);
      if (user.address.province) setProvince(user.address.province);
      if (user.address.postalCode) setPostalCode(user.address.postalCode);
    }
  }, [user]);

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

  // ---- Validation ----
  const validate = useCallback((): string | null => {
    // Personal info
    if (!firstName.trim()) return 'Le prenom est requis';
    if (!lastName.trim()) return 'Le nom de famille est requis';

    const day = parseInt(dobDay, 10);
    const month = parseInt(dobMonth, 10);
    const year = parseInt(dobYear, 10);

    if (!dobDay || !dobMonth || !dobYear || isNaN(day) || isNaN(month) || isNaN(year)) {
      return 'La date de naissance est requise';
    }
    if (!isValidDate(day, month, year)) {
      return 'La date de naissance est invalide';
    }
    if (!isAtLeast18(day, month, year)) {
      return 'Vous devez avoir au moins 18 ans';
    }

    // Address
    if (!street.trim()) return "L'adresse est requise";
    if (!city.trim()) return 'La ville est requise';
    if (!province.trim()) return 'La province est requise';
    if (!postalCode.trim()) return 'Le code postal est requis';
    if (!POSTAL_CODE_REGEX.test(postalCode.trim())) {
      return 'Le code postal doit etre au format A1A 1A1';
    }

    // Bank info
    if (transitNumber.length !== 5) {
      return 'Le numero de transit doit contenir 5 chiffres';
    }
    if (institutionNumber.length !== 3) {
      return "Le numero d'institution doit contenir 3 chiffres";
    }
    if (accountNumber.length < 7) {
      return 'Le numero de compte doit contenir au moins 7 chiffres';
    }

    return null;
  }, [
    firstName, lastName, dobDay, dobMonth, dobYear,
    street, city, province, postalCode,
    transitNumber, institutionNumber, accountNumber,
  ]);

  // ---- Create Stripe account + add bank account mutation ----
  const createAccountMutation = useMutation<
    { chargesEnabled: boolean; requirements?: string[] },
    Error
  >({
    mutationFn: async () => {
      const day = parseInt(dobDay, 10);
      const month = parseInt(dobMonth, 10);
      const year = parseInt(dobYear, 10);

      const createFn = httpsCallable<
        {
          firstName: string;
          lastName: string;
          dob: { day: number; month: number; year: number };
          address: {
            line1: string;
            city: string;
            province: string;
            postalCode: string;
          };
          transitNumber: string;
          institutionNumber: string;
          accountNumber: string;
        },
        {
          success: boolean;
          stripeAccountId: string;
          chargesEnabled: boolean;
          payoutsEnabled: boolean;
          detailsSubmitted: boolean;
          requirements: string[];
          status: string;
        }
      >(functions, 'createStripeConnectAccount');

      const result = await createFn({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        dob: { day, month, year },
        address: {
          line1: street.trim(),
          city: city.trim(),
          province: province.trim(),
          postalCode: postalCode.trim().toUpperCase(),
        },
        transitNumber,
        institutionNumber,
        accountNumber,
      });

      if (!result.data.stripeAccountId) {
        throw new Error('Impossible de creer le compte Stripe');
      }

      return {
        chargesEnabled: result.data.chargesEnabled,
        requirements: result.data.requirements,
      };
    },
    onSuccess: async (data) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await queryClient.invalidateQueries({
        queryKey: ['stripe', 'accountStatus', user?.id],
      });

      if (data.chargesEnabled) {
        Alert.alert(
          'Votre compte est pret !',
          'Vous pouvez maintenant recevoir des paiements et demander des retraits.',
          [{ text: 'OK', onPress: () => router.back() }],
        );
      } else if (data.requirements && data.requirements.length > 0) {
        Alert.alert(
          'Compte en cours de verification',
          'Votre compte a ete cree avec succes. Certaines informations sont en cours de verification par Stripe. Vous recevrez une notification lorsque votre compte sera actif.',
        );
      } else {
        Alert.alert(
          'Compte cree',
          'Votre compte de paiement a ete configure. Il sera actif apres verification par Stripe.',
        );
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

  const handleSubmit = useCallback(() => {
    const validationError = validate();
    if (validationError) {
      Alert.alert('Erreur', validationError);
      return;
    }
    createAccountMutation.mutate();
  }, [validate, createAccountMutation]);

  // ---- Auth guard ----
  if (!isLoggedIn) {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ headerShown: false }} />
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

  // ---- Age gate: selling requires 18+ (Stripe payout account) ----
  if (!canSell(user?.dateOfBirth)) {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ headerShown: false }} />
        <ScreenHeader title="Compte de paiement" onBack={() => router.back()} />
        <View style={styles.centerState}>
          <Ionicons name="lock-closed-outline" size={48} color={colors.muted} />
          <Text style={styles.ageGateText}>{COPY_SELL_GATE}</Text>
          <Button
            variant="primary"
            onPress={() => router.back()}
            style={styles.centerStateButton}
          >
            Continuer
          </Button>
        </View>
      </View>
    );
  }

  // ---- Loading skeleton ----
  if (isLoading) {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ headerShown: false }} />
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
      <Stack.Screen options={{ headerShown: false }} />
      <ScreenHeader title="Compte de paiement" onBack={() => router.back()} />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.flex}
      >
        <ScrollView
          style={styles.content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
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
            <>
              {/* ── Personal Info Section ── */}
              <View style={styles.formSection}>
                <Text style={styles.formTitle}>Informations personnelles</Text>
                <Text style={styles.formDescription}>
                  Ces informations sont requises par Stripe pour verifier votre
                  identite.
                </Text>

                <View style={styles.row}>
                  <View style={[styles.inputGroup, styles.flex]}>
                    <Text style={styles.inputLabel}>Prenom</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="Jean"
                      placeholderTextColor={colors.muted}
                      value={firstName}
                      onChangeText={setFirstName}
                      autoCapitalize="words"
                      autoCorrect={false}
                      maxLength={50}
                    />
                  </View>

                  <View style={[styles.inputGroup, styles.flex]}>
                    <Text style={styles.inputLabel}>Nom</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="Dupont"
                      placeholderTextColor={colors.muted}
                      value={lastName}
                      onChangeText={setLastName}
                      autoCapitalize="words"
                      autoCorrect={false}
                      maxLength={50}
                    />
                  </View>
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Date de naissance</Text>
                  <View style={styles.dobRow}>
                    <View style={styles.dobField}>
                      <TextInput
                        style={styles.input}
                        placeholder="JJ"
                        placeholderTextColor={colors.muted}
                        value={dobDay}
                        onChangeText={(t) =>
                          setDobDay(t.replace(/\D/g, '').slice(0, 2))
                        }
                        keyboardType="number-pad"
                        maxLength={2}
                      />
                    </View>
                    <Text style={styles.dobSeparator}>/</Text>
                    <View style={styles.dobField}>
                      <TextInput
                        style={styles.input}
                        placeholder="MM"
                        placeholderTextColor={colors.muted}
                        value={dobMonth}
                        onChangeText={(t) =>
                          setDobMonth(t.replace(/\D/g, '').slice(0, 2))
                        }
                        keyboardType="number-pad"
                        maxLength={2}
                      />
                    </View>
                    <Text style={styles.dobSeparator}>/</Text>
                    <View style={styles.dobFieldYear}>
                      <TextInput
                        style={styles.input}
                        placeholder="AAAA"
                        placeholderTextColor={colors.muted}
                        value={dobYear}
                        onChangeText={(t) =>
                          setDobYear(t.replace(/\D/g, '').slice(0, 4))
                        }
                        keyboardType="number-pad"
                        maxLength={4}
                      />
                    </View>
                  </View>
                </View>
              </View>

              {/* ── Address Section ── */}
              <View style={styles.formSection}>
                <Text style={styles.formTitle}>Adresse</Text>
                <Text style={styles.formDescription}>
                  Votre adresse legale au Canada.
                </Text>

                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Adresse</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="123 rue Principale"
                    placeholderTextColor={colors.muted}
                    value={street}
                    onChangeText={setStreet}
                    autoCapitalize="words"
                    maxLength={100}
                  />
                </View>

                <View style={styles.row}>
                  <View style={[styles.inputGroup, styles.flex]}>
                    <Text style={styles.inputLabel}>Ville</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="Montreal"
                      placeholderTextColor={colors.muted}
                      value={city}
                      onChangeText={setCity}
                      autoCapitalize="words"
                      maxLength={50}
                    />
                  </View>

                  <View style={[styles.inputGroup, styles.provinceField]}>
                    <Text style={styles.inputLabel}>Province</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="QC"
                      placeholderTextColor={colors.muted}
                      value={province}
                      onChangeText={(t) =>
                        setProvince(t.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2))
                      }
                      autoCapitalize="characters"
                      maxLength={2}
                    />
                  </View>
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Code postal</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="H2X 1Y4"
                    placeholderTextColor={colors.muted}
                    value={postalCode}
                    onChangeText={(t) => setPostalCode(formatPostalCode(t))}
                    autoCapitalize="characters"
                    maxLength={7}
                  />
                </View>
              </View>

              {/* ── Bank Info Section ── */}
              <View style={styles.formSection}>
                <Text style={styles.formTitle}>Informations bancaires</Text>
                <Text style={styles.formDescription}>
                  Ces informations seront transmises de facon securisee a Stripe
                  pour configurer vos virements.
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
                  <Text style={styles.inputLabel}>
                    {"Numero d'institution"}
                  </Text>
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
                  onPress={handleSubmit}
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
            </>
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
      </KeyboardAvoidingView>
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
  row: {
    flexDirection: 'row',
    gap: spacing.md,
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
  dobRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  dobField: {
    flex: 1,
  },
  dobFieldYear: {
    flex: 1.5,
  },
  dobSeparator: {
    ...typography.body,
    color: colors.muted,
  },
  provinceField: {
    width: 80,
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
