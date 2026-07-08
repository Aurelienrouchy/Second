/**
 * Stripe Connect Onboarding Screen
 *
 * Two responsibilities:
 *  A) No account yet → collect personal info / address / bank details and call
 *     createStripeConnectAccount.
 *  B) Account exists → surface the REAL account state (F62/F117) derived from
 *     chargesEnabled + payoutsEnabled + status, list the outstanding Stripe
 *     requirements translated to readable FR + disabledReason, offer an
 *     unconditional manual refresh, give access to bank-account management
 *     (F60), and — when a document is due — drive in-app KYC remediation
 *     (F59): pick recto (+ verso optional), compress, base64, upload via
 *     uploadStripeIdentityDocument.
 *
 * Pre-fills name and address from the user's profile when available.
 */

import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { httpsCallable } from 'firebase/functions';
import { Stack, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import React, { useState, useEffect, useCallback, useRef } from 'react';
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

import { Button, ScreenHeader, Skeleton, Text } from '@/components/ui';
import { functions } from '@/config/firebaseConfig';
import { COPY_SELL_GATE } from '@/constants/authMessages';
import { colors, spacing, radius, typography } from '@/constants/theme';
import { queryKeys } from '@/lib/queryKeys';
import { track } from '@/lib/analytics';
import { useStripeAccount } from '@/hooks/useStripeAccount';
import { useAuthRequired } from '@/hooks/useAuthRequired';
import { canSell } from '@/utils/age';
import {
  needsIdentityDocument,
  translateDisabledReason,
  translateRequirement,
} from '@/utils/stripeRequirements';

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

  const {
    status,
    isLoading,
    refetch,
    isRefetching,
    uploadDocument,
    isUploadingDocument,
  } = useStripeAccount(user?.id);

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

  // -- KYC document upload --
  const [frontUri, setFrontUri] = useState<string | null>(null);
  const [backUri, setBackUri] = useState<string | null>(null);

  // -- Pre-fill from user profile --
  useEffect(() => {
    if (!user) return;

    if (user.displayName) {
      const parts = user.displayName.trim().split(/\s+/);
      if (parts.length >= 2) {
        setFirstName(parts[0]);
        setLastName(parts.slice(1).join(' '));
      } else if (parts.length === 1) {
        setFirstName(parts[0]);
      }
    }

    if (user.address) {
      if (user.address.street) setStreet(user.address.street);
      if (user.address.city) setCity(user.address.city);
      if (user.address.province) setProvince(user.address.province);
      if (user.address.postalCode) setPostalCode(user.address.postalCode);
    }
  }, [user]);

  // ---- Validation ----
  // Returns null when valid, else { message, field } — `field` is a stable key
  // (never the value) surfaced to analytics as `failed_field`.
  const validate = useCallback((): { message: string; field: string } | null => {
    if (!firstName.trim()) return { message: 'Le prenom est requis', field: 'first_name' };
    if (!lastName.trim()) return { message: 'Le nom de famille est requis', field: 'last_name' };

    const day = parseInt(dobDay, 10);
    const month = parseInt(dobMonth, 10);
    const year = parseInt(dobYear, 10);

    if (!dobDay || !dobMonth || !dobYear || isNaN(day) || isNaN(month) || isNaN(year)) {
      return { message: 'La date de naissance est requise', field: 'dob' };
    }
    if (!isValidDate(day, month, year)) {
      return { message: 'La date de naissance est invalide', field: 'dob' };
    }
    if (!isAtLeast18(day, month, year)) {
      return { message: 'Vous devez avoir au moins 18 ans', field: 'dob' };
    }

    if (!street.trim()) return { message: "L'adresse est requise", field: 'street' };
    if (!city.trim()) return { message: 'La ville est requise', field: 'city' };
    if (!province.trim()) return { message: 'La province est requise', field: 'province' };
    if (!postalCode.trim()) return { message: 'Le code postal est requis', field: 'postal_code' };
    if (!POSTAL_CODE_REGEX.test(postalCode.trim())) {
      return { message: 'Le code postal doit etre au format A1A 1A1', field: 'postal_code' };
    }

    if (transitNumber.length !== 5) {
      return { message: 'Le numero de transit doit contenir 5 chiffres', field: 'transit_number' };
    }
    if (institutionNumber.length !== 3) {
      return { message: "Le numero d'institution doit contenir 3 chiffres", field: 'institution_number' };
    }
    if (accountNumber.length < 7) {
      return { message: 'Le numero de compte doit contenir au moins 7 chiffres', field: 'account_number' };
    }

    return null;
  }, [
    firstName, lastName, dobDay, dobMonth, dobYear,
    street, city, province, postalCode,
    transitNumber, institutionNumber, accountNumber,
  ]);

  // ---- Create Stripe account mutation ----
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
      track('seller_account_submitted', {
        validation_result: 'ok',
        success: true,
        charges_enabled_after: data.chargesEnabled,
        requirements_count_after: data.requirements?.length ?? 0,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await queryClient.invalidateQueries({ queryKey: queryKeys.stripe.all });

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
      track('seller_account_submitted', {
        validation_result: 'ok',
        success: false,
        error_code:
          error && typeof error === 'object' && 'code' in error
            ? String((error as { code?: unknown }).code)
            : undefined,
      });
      Alert.alert(
        'Erreur',
        error.message || 'Impossible de configurer le compte de paiement.',
      );
    },
  });

  const handleSubmit = useCallback(() => {
    const validationError = validate();
    if (validationError) {
      track('seller_account_submitted', {
        validation_result: 'field_error',
        failed_field: validationError.field,
        success: false,
      });
      Alert.alert('Erreur', validationError.message);
      return;
    }
    createAccountMutation.mutate();
  }, [validate, createAccountMutation]);

  // ---- KYC document picking + upload ----
  const pickDocument = useCallback(
    async (side: 'front' | 'back') => {
      try {
        const { status: perm } =
          await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (perm !== 'granted') {
          Alert.alert(
            'Permission requise',
            "Nous avons besoin d'acceder a vos photos pour envoyer votre document.",
          );
          return;
        }

        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'] as const,
          allowsEditing: false,
          quality: 0.9,
          exif: false,
          preferredAssetRepresentationMode:
            ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
        });

        if (!result.canceled && result.assets[0]) {
          if (side === 'front') setFrontUri(result.assets[0].uri);
          else setBackUri(result.assets[0].uri);
        }
      } catch (error) {
        if (__DEV__) console.error('Error picking document:', error);
        Alert.alert('Erreur', "Impossible de selectionner l'image.");
      }
    },
    [],
  );

  const handleUploadDocument = useCallback(async () => {
    if (!frontUri) {
      Alert.alert('Erreur', "Ajoutez au moins le recto de votre piece d'identite.");
      return;
    }
    try {
      const res = await uploadDocument({
        frontUri,
        backUri: backUri ?? undefined,
      });
      track('kyc_document_uploaded', {
        has_back_side: !!backUri,
        success: true,
        requirements_remaining_count: res.requirementsCurrentlyDue.length,
        payouts_enabled_after: res.payoutsEnabled,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setFrontUri(null);
      setBackUri(null);
      Alert.alert(
        'Document envoye',
        res.requirementsCurrentlyDue.length === 0 && res.payoutsEnabled
          ? 'Votre document a ete recu et votre compte est a jour.'
          : 'Votre document a ete recu. Stripe procede a sa verification, cela peut prendre quelques minutes a quelques jours.',
      );
    } catch (error: unknown) {
      if (__DEV__) console.error('Error uploading identity document:', error);
      track('kyc_document_uploaded', {
        has_back_side: !!backUri,
        success: false,
        error_code:
          error && typeof error === 'object' && 'code' in error
            ? String((error as { code?: unknown }).code)
            : undefined,
      });
      const msg =
        error instanceof Error
          ? error.message
          : "Impossible d'envoyer le document.";
      Alert.alert('Erreur', msg);
    }
  }, [frontUri, backUri, uploadDocument]);

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

  // ---- Age gate: selling requires 18+ ----
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
            style={styles.skeletonBlock}
          />
        </View>
      </View>
    );
  }

  // ── Derived real state (F62/F117) ──────────────────────────────────────────
  const hasAccount = status?.hasAccount === true;
  const chargesEnabled = status?.chargesEnabled === true;
  const payoutsEnabled = status?.payoutsEnabled === true;
  const accountStatus = status?.status ?? 'none';
  const requirementsCurrentlyDue = status?.requirementsCurrentlyDue ?? [];
  const requirementsPastDue = status?.requirementsPastDue ?? [];
  const disabledReasonText = translateDisabledReason(status?.disabledReason ?? null);

  // Fully operational only when BOTH charges and payouts are enabled.
  const fullyActive = hasAccount && chargesEnabled && payoutsEnabled;
  const isRestricted = accountStatus === 'restricted';
  // Payouts blocked while charges work → must distinguish from "active".
  const payoutsBlocked = hasAccount && chargesEnabled && !payoutsEnabled;

  // Outstanding requirements: past_due first (more urgent), de-duplicated.
  const outstanding = Array.from(
    new Set([...requirementsPastDue, ...requirementsCurrentlyDue]),
  );

  const showKycUpload =
    hasAccount &&
    needsIdentityDocument({
      requirementsCurrentlyDue,
      requirementsPastDue,
      disabledReason: status?.disabledReason ?? null,
    });

  // Status card visuals.
  const statusIcon = fullyActive
    ? 'checkmark-circle'
    : isRestricted || requirementsPastDue.length > 0
      ? 'alert-circle'
      : 'time';
  const statusColor = fullyActive
    ? colors.success
    : isRestricted || requirementsPastDue.length > 0
      ? colors.danger
      : colors.primary;
  const statusTitle = !hasAccount
    ? 'Aucun compte configure'
    : fullyActive
      ? 'Votre compte est actif'
      : payoutsBlocked
        ? 'Retraits indisponibles : action requise'
        : isRestricted
          ? 'Compte restreint : action requise'
          : 'Configuration en cours';
  const statusDescription = !hasAccount
    ? 'Configurez votre compte de paiement pour recevoir les gains de vos ventes.'
    : fullyActive
      ? 'Vous pouvez recevoir des paiements et demander des retraits.'
      : payoutsBlocked
        ? 'Vous pouvez recevoir des paiements, mais vos retraits sont bloques tant que les informations ci-dessous ne sont pas fournies.'
        : isRestricted
          ? 'Stripe a temporairement restreint votre compte. Fournissez les informations ci-dessous pour le reactiver.'
          : 'Votre compte Stripe est en cours de verification. Vous recevrez une notification lorsque celui-ci sera actif.';

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
              fullyActive && styles.statusCardActive,
              (payoutsBlocked || isRestricted || requirementsPastDue.length > 0) &&
                styles.statusCardAlert,
              hasAccount &&
                !fullyActive &&
                !payoutsBlocked &&
                !isRestricted &&
                requirementsPastDue.length === 0 &&
                styles.statusCardPending,
            ]}
          >
            <View style={styles.statusIconRow}>
              <Ionicons name={statusIcon} size={32} color={statusColor} />
            </View>
            <Text style={styles.statusTitle}>{statusTitle}</Text>
            <Text style={styles.statusDescription}>{statusDescription}</Text>

            {disabledReasonText && hasAccount && !fullyActive ? (
              <Text style={styles.disabledReason}>{disabledReasonText}</Text>
            ) : null}

            {/* Outstanding requirements list */}
            {outstanding.length > 0 ? (
              <View style={styles.requirementsBlock}>
                <Text style={styles.requirementsTitle}>
                  Informations a fournir
                </Text>
                {outstanding.map((key) => (
                  <View key={key} style={styles.requirementRow}>
                    <Ionicons
                      name="ellipse"
                      size={6}
                      color={colors.danger}
                      style={styles.requirementDot}
                    />
                    <Text style={styles.requirementText}>
                      {translateRequirement(key)}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}

            {/* Unconditional manual refresh once an account exists (F62/F117) */}
            {hasAccount ? (
              <Button
                variant={fullyActive ? 'muted' : 'primary'}
                fullWidth
                onPress={() => refetch()}
                loading={isRefetching}
                style={styles.statusAction}
              >
                Actualiser le statut
              </Button>
            ) : null}
          </View>

          {/* ── KYC document remediation (F59) ── */}
          {showKycUpload ? (
            <View style={styles.formSection}>
              <Text style={styles.formTitle}>{"Verification d'identite"}</Text>
              <Text style={styles.formDescription}>
                {"Stripe demande une piece d'identite pour reactiver votre compte. Ajoutez une photo nette du recto (et du verso si demande)."}
              </Text>

              <View style={styles.docRow}>
                <View style={styles.docSlot}>
                  <Text style={styles.docLabel}>Recto</Text>
                  <Pressable
                    style={styles.docPicker}
                    onPress={() => pickDocument('front')}
                    disabled={isUploadingDocument}
                  >
                    {frontUri ? (
                      <Image
                        source={{ uri: frontUri }}
                        style={styles.docPreview}
                        contentFit="cover"
                      />
                    ) : (
                      <View style={styles.docPlaceholder}>
                        <Ionicons
                          name="add"
                          size={28}
                          color={colors.muted}
                        />
                      </View>
                    )}
                  </Pressable>
                </View>

                <View style={styles.docSlot}>
                  <Text style={styles.docLabel}>Verso (optionnel)</Text>
                  <Pressable
                    style={styles.docPicker}
                    onPress={() => pickDocument('back')}
                    disabled={isUploadingDocument}
                  >
                    {backUri ? (
                      <Image
                        source={{ uri: backUri }}
                        style={styles.docPreview}
                        contentFit="cover"
                      />
                    ) : (
                      <View style={styles.docPlaceholder}>
                        <Ionicons
                          name="add"
                          size={28}
                          color={colors.muted}
                        />
                      </View>
                    )}
                  </Pressable>
                </View>
              </View>

              <Button
                variant="primary"
                fullWidth
                loading={isUploadingDocument}
                disabled={isUploadingDocument || !frontUri}
                onPress={handleUploadDocument}
                style={styles.submitButton}
                leftIcon={
                  <Ionicons
                    name="cloud-upload-outline"
                    size={20}
                    color={colors.white}
                  />
                }
              >
                Envoyer le document
              </Button>
            </View>
          ) : null}

          {/* ── Bank account management (F60) ── */}
          {hasAccount ? (
            <Pressable
              style={styles.linkRow}
              onPress={() => router.push('/settings/bank-account')}
            >
              <View style={styles.linkIcon}>
                <Ionicons
                  name="business-outline"
                  size={20}
                  color={colors.primary}
                />
              </View>
              <View style={styles.linkTextBlock}>
                <Text style={styles.linkTitle}>Compte bancaire</Text>
                <Text style={styles.linkSubtitle}>
                  {status?.bankAccountLast4
                    ? `•••• ${status.bankAccountLast4} — gerer ou remplacer`
                    : 'Ajouter un compte bancaire de retrait'}
                </Text>
              </View>
              <Ionicons
                name="chevron-forward"
                size={20}
                color={colors.muted}
              />
            </Pressable>
          ) : null}

          {/* Setup Form (only if no account yet) */}
          {!hasAccount && (
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
  ageGateText: {
    ...typography.body,
    color: colors.foreground,
    textAlign: 'center',
    marginTop: spacing.md,
    marginBottom: spacing.lg,
  },
  skeletonBlock: {
    marginTop: spacing.lg,
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
  statusCardAlert: {
    backgroundColor: colors.dangerLight,
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
  disabledReason: {
    ...typography.caption,
    color: colors.danger,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  requirementsBlock: {
    width: '100%',
    marginTop: spacing.lg,
  },
  requirementsTitle: {
    ...typography.label,
    color: colors.foreground,
    marginBottom: spacing.sm,
  },
  requirementRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  requirementDot: {
    marginRight: spacing.sm,
  },
  requirementText: {
    ...typography.body,
    color: colors.foreground,
    flex: 1,
  },
  statusAction: {
    marginTop: spacing.lg,
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceWarm,
    borderRadius: radius.xl,
    padding: spacing.lg,
    marginTop: spacing.lg,
    gap: spacing.md,
  },
  linkIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    backgroundColor: colors.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  linkTextBlock: {
    flex: 1,
  },
  linkTitle: {
    ...typography.label,
    color: colors.foreground,
  },
  linkSubtitle: {
    ...typography.caption,
    color: colors.muted,
    marginTop: spacing.xs,
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
  docRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  docSlot: {
    flex: 1,
  },
  docLabel: {
    ...typography.label,
    color: colors.foreground,
    marginBottom: spacing.sm,
  },
  docPicker: {
    aspectRatio: 1.4,
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  docPreview: {
    width: '100%',
    height: '100%',
  },
  docPlaceholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
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
