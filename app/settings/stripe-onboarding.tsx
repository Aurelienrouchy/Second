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
import { Link, Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Alert,
  AppState,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { Button, Checkbox, ScreenHeader, Skeleton, Text } from '@/components/ui';
import { auth, functions } from '@/config/firebaseConfig';
import { AuthService } from '@/services/authService';
import {withNativeReauthentication} from '@/services/nativeReauthentication';
import { useAuthenticatedUid, useUser } from '@/hooks/useAuth';
import { getAuthSessionGeneration, useAuthStore } from '@/store/authStore';
import {
  CONNECT_CONSENT_PRESENTATION_VERSION, CONNECT_CONSENT_STATEMENT,
  CONNECT_CONSENT_AGREEMENT_URLS, CONNECT_CONSENT_TRANSLATIONS_URL,
  type PaymentAccountConsentInput,
} from '@/functions/src/shared/connectConsent';
import { BANK_OWNERSHIP_STATEMENT, BANK_OWNERSHIP_STATEMENT_VERSION } from '@/functions/src/shared/bankConsent';
import { COPY_SELL_GATE } from '@/constants/authMessages';
import { APP_LOCALE } from '@/constants/locale';
import { colors, spacing, radius, typography } from '@/constants/theme';
import { queryKeys } from '@/lib/queryKeys';
import { track } from '@/lib/analytics';
import { useStripeAccount } from '@/features/wallet/hooks/useStripeAccount';
import { PaymentBankAccounts } from '@/features/wallet';
import { canSell } from '@/utils/age';
import { DEV_COMMERCE_TESTING_ENABLED, PAYMENTS_ENABLED } from '@/config/featureFlags';
import {
  needsIdentityDocument,
  getActionableRequirements,
  identityDocumentNeedsBack,
  translateRequirement,
  translateVerificationError,
  type StripeAccountStatus,
} from '@/features/wallet/utils/stripeRequirements';

interface ConnectSetupInput {
  firstName: string; lastName: string;
  dob: { day: number; month: number; year: number };
  address: { line1: string; city: string; province: string; postalCode: string };
  transitNumber: string; institutionNumber: string; accountNumber: string;
  accountHolderName: string;
  bankOwnershipAccepted: true;
  bankOwnershipStatementVersion: string;
  paymentAccountConsent: PaymentAccountConsentInput;
  /** Explicit fixture choice. The backend accepts it only in isolated Stripe test mode. */
  useTestIdentity?: true;
}
interface ConnectSetupAttempt { uid: string; consentKey: string; consentEpoch: number; bankEpoch: number; focusEpoch: number; payload: ConnectSetupInput; dispatched?: boolean }

function currentConsentKey(): string {
  return JSON.stringify([useAuthStore.getState().authenticatedUid, getAuthSessionGeneration(),
    CONNECT_CONSENT_PRESENTATION_VERSION, CONNECT_CONSENT_STATEMENT,
    CONNECT_CONSENT_AGREEMENT_URLS, CONNECT_CONSENT_TRANSLATIONS_URL,
    BANK_OWNERSHIP_STATEMENT_VERSION, BANK_OWNERSHIP_STATEMENT]);
}

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

function formatVerificationDeadline(seconds: number | null | undefined): string | null {
  if (typeof seconds !== 'number' || !Number.isSafeInteger(seconds) || seconds <= 0) return null;
  const date = new Date(seconds * 1000);
  if (!Number.isFinite(date.getTime())) return null;
  try {
    return date.toLocaleString(APP_LOCALE, { timeZone: 'America/Toronto', day: 'numeric', month: 'long', year: 'numeric',
      hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
  } catch { return null; }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function paymentConfigurationConfirmed(status: StripeAccountStatus | null | undefined): boolean {
  return status?.success === true && status.hasAccount && status.status === 'active' &&
    status.chargesEnabled && status.payoutsEnabled && status.payoutEligible === true &&
    !status.disabledReason && !status.bankDeclarationRequired && !status.connectActionRequired && !status.connectOperationState &&
    status.requirementsCurrentlyDue.length === 0 && status.requirementsPastDue.length === 0 &&
    status.verificationErrors.length === 0 && status.requirementsPendingVerification.length === 0;
}

function paymentVerificationPending(status: StripeAccountStatus | null | undefined): boolean {
  return status?.success === true && status.hasAccount === true && !status.bankDeclarationRequired &&
    !status.connectActionRequired && !status.connectOperationState && (!status.bankOperation || status.bankOperation.state === 'completed') &&
    (!status.disabledReason || status.disabledReason === 'requirements.pending_verification') &&
    (status.status === 'pending_verification' || status.disabledReason === 'requirements.pending_verification' ||
      status.requirementsPendingVerification.length > 0) &&
    status.verificationErrors.length === 0 && getActionableRequirements(status).length === 0;
}

const VERIFICATION_REFRESH_INTERVAL_MS = 10_000;
const VERIFICATION_OBSERVATION_WINDOW_MS = 5 * 60_000;

export default function StripeOnboardingScreen() {
  const uid = useAuthenticatedUid();
  const params = useLocalSearchParams<{from?: string; articleId?: string; intent?: string}>();
  const shippingArticleId = params.from === 'shipping-preparation' && typeof params.articleId === 'string' &&
    /^[A-Za-z0-9_-]{1,128}$/.test(params.articleId) ? params.articleId : null;
  const setupIntent = params.intent === 'setup';
  return <StripeOnboardingContent key={`${uid ?? 'signed-out'}:${getAuthSessionGeneration()}:${shippingArticleId ?? ''}:${setupIntent}`} shippingArticleId={shippingArticleId} setupIntent={setupIntent} />;
}

function StripeOnboardingContent({shippingArticleId, setupIntent}: {shippingArticleId: string | null; setupIntent: boolean}) {
  const router = useRouter();
  const user = useUser();
  const uid = useAuthenticatedUid();
  const isLoggedIn = !!uid;
  const consentKey = currentConsentKey();
  const screenContext = useRef({ mounted: false, active: false, focusEpoch: 0 });
  const createPending = useRef<ConnectSetupAttempt | null>(null);
  const preparationCompletionEngaged = useRef(false);
  const [conditionsVisible, setConditionsVisible] = useState(false);
  const pickerPending = useRef(false);
  const documentPending = useRef(false);
  useEffect(() => {
    const current = screenContext.current;
    current.mounted = true;
    return () => { current.mounted = false; };
  }, []);
  useFocusEffect(useCallback(() => {
    screenContext.current.active = true; screenContext.current.focusEpoch++;
    return () => { screenContext.current.active = false; screenContext.current.focusEpoch++; };
  }, []));
  const isScreenCurrent = useCallback((focusEpoch: number) => screenContext.current.mounted && screenContext.current.active &&
    screenContext.current.focusEpoch === focusEpoch && !!uid && auth.currentUser?.uid === uid && currentConsentKey() === consentKey,
  [uid, consentKey]);
  const [acceptedConsentKey, setAcceptedConsentKey] = useState<string | null>(null);
  const consentEpoch = useRef(0);
  const consentAcceptance = useRef<{ key: string; epoch: number } | null>(null);
  const consentAccepted = acceptedConsentKey === consentKey;
  const [bankOwnershipAccepted, setBankOwnershipAccepted] = useState(false);
  const bankEpoch = useRef(0);
  const bankAcceptance = useRef<{ key: string; epoch: number } | null>(null);
  const clearBankAcceptance = () => { bankEpoch.current++; bankAcceptance.current = null; setBankOwnershipAccepted(false); };
  const isConsentContextCurrent = (attempt: ConnectSetupAttempt) =>
    isScreenCurrent(attempt.focusEpoch) && auth.currentUser?.uid === attempt.uid && currentConsentKey() === attempt.consentKey;
  const isAttemptCurrent = (attempt: ConnectSetupAttempt) => isConsentContextCurrent(attempt) &&
    consentAcceptance.current?.key === attempt.consentKey && consentAcceptance.current.epoch === attempt.consentEpoch &&
    bankAcceptance.current?.key === attempt.consentKey && bankAcceptance.current.epoch === attempt.bankEpoch;
  const clearConsent = () => { consentEpoch.current++; consentAcceptance.current = null; setAcceptedConsentKey(null); };
  const toggleConsent = () => {
    if (!uid || auth.currentUser?.uid !== uid || currentConsentKey() !== consentKey) return;
    const accepted = consentAcceptance.current?.key !== consentKey;
    consentEpoch.current++;
    consentAcceptance.current = accepted ? { key: consentKey, epoch: consentEpoch.current } : null;
    setAcceptedConsentKey(accepted ? consentKey : null);
  };
  const queryClient = useQueryClient();

  const {
    status,
    isLoading,
    refetch,
    isRefetching,
    isFetching,
    isError,
    uploadDocument,
    isUploadingDocument,
  } = useStripeAccount(uid ?? undefined);

  const preparationReturn = useRef<{focusEpoch: number} | null>(null);
  const returnToPreparationIfConfirmed = useCallback(async () => {
    const focusEpoch = screenContext.current.focusEpoch;
    if (!shippingArticleId || !setupIntent || !preparationCompletionEngaged.current || !isScreenCurrent(focusEpoch) || AppState.currentState !== 'active' || preparationReturn.current) return;
    const attempt = {focusEpoch};
    preparationReturn.current = attempt;
    let returned = false;
    try {
      const result = await refetch();
      if (!isScreenCurrent(focusEpoch) || AppState.currentState !== 'active' || result.isError || result.fetchStatus !== 'idle' || !paymentConfigurationConfirmed(result.data)) return;
      returned = true;
      router.back();
    } finally {
      if (!returned && preparationReturn.current === attempt) preparationReturn.current = null;
    }
  }, [shippingArticleId, setupIntent, isScreenCurrent, refetch, router]);
  useFocusEffect(useCallback(() => {
    preparationReturn.current = null;
    void returnToPreparationIfConfirmed();
  }, [returnToPreparationIfConfirmed]));
  useEffect(() => {
    if (isFetching || isError || !paymentConfigurationConfirmed(status)) return;
    void returnToPreparationIfConfirmed();
  }, [status, isFetching, isError, returnToPreparationIfConfirmed]);

  const observePendingVerification = !isError && paymentVerificationPending(status);
  useFocusEffect(useCallback(() => {
    if (!observePendingVerification) return;
    const focusEpoch = screenContext.current.focusEpoch;
    const expiresAt = Date.now() + VERIFICATION_OBSERVATION_WINDOW_MS;
    let cancelled = false;
    let inFlight = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const current = () => !cancelled && isScreenCurrent(focusEpoch) && AppState.currentState === 'active' && Date.now() < expiresAt;
    const clearTimer = () => {if (timer) clearTimeout(timer); timer = null;};
    const schedule = () => {
      if (!current() || inFlight || timer) return;
      timer = setTimeout(() => {timer = null; void observe();}, VERIFICATION_REFRESH_INTERVAL_MS);
    };
    const observe = async () => {
      if (!current() || inFlight) return;
      inFlight = true;
      try {
        const result = await refetch({cancelRefetch: false});
        if (!current() || result.isError || result.fetchStatus !== 'idle' || !paymentVerificationPending(result.data)) return;
      } catch {
        // React Query exposes the read error; another automatic request is not scheduled.
        return;
      } finally {inFlight = false;}
      schedule();
    };
    const subscription = AppState.addEventListener('change', state => {
      clearTimer();
      if (state === 'active') schedule();
    });
    schedule();
    return () => {cancelled = true; clearTimer(); subscription.remove();};
  }, [observePendingVerification, isScreenCurrent, refetch]));

  // Existing/unknown Connect operations remain on the status/recovery path.
  const [connectCreationUnknown, setConnectCreationUnknown] = useState(false);
  const creationToVerify = status?.connectActionRequired === true || !!status?.connectOperationState || connectCreationUnknown;
  const canCreateAccount = PAYMENTS_ENABLED && !!user && status?.success === true && status.hasAccount === false && !creationToVerify;
  const showSetupForm = canCreateAccount || connectCreationUnknown && !!user && status?.hasAccount !== true;

  // -- Personal info (pre-filled from the user profile at mount) --
  const [firstName, setFirstName] = useState(() => {
    const parts = user?.displayName?.trim().split(/\s+/) ?? [];
    return parts[0] || '';
  });
  const [lastName, setLastName] = useState(() => {
    const parts = user?.displayName?.trim().split(/\s+/) ?? [];
    return parts.length >= 2 ? parts.slice(1).join(' ') : '';
  });
  const [dobDay, setDobDay] = useState(() => user?.dateOfBirth?.split('-')[2] ?? '');
  const [dobMonth, setDobMonth] = useState(() => user?.dateOfBirth?.split('-')[1] ?? '');
  const [dobYear, setDobYear] = useState(() => user?.dateOfBirth?.split('-')[0] ?? '');

  // -- Address (pre-filled from the user profile at mount) --
  const [street, setStreet] = useState(user?.address?.street || '');
  const [city, setCity] = useState(user?.address?.city || '');
  const [province, setProvince] = useState(user?.address?.province || 'QC');
  const [postalCode, setPostalCode] = useState(user?.address?.postalCode || '');

  // -- Bank info --
  const [transitNumber, setTransitNumber] = useState('');
  const [institutionNumber, setInstitutionNumber] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [accountHolderName, setAccountHolderName] = useState('');
  const [useTestIdentity, setUseTestIdentity] = useState(false);
  const fillTestInformation = () => {
    if (!DEV_COMMERCE_TESTING_ENABLED || !canCreateAccount || !isScreenCurrent(screenContext.current.focusEpoch)) return;
    clearConsent(); clearBankAcceptance();
    setUseTestIdentity(true);
    setFirstName('Jean'); setLastName('Test');
    const birth = user?.dateOfBirth?.split('-');
    setDobDay(birth?.[2] ?? ''); setDobMonth(birth?.[1] ?? ''); setDobYear(birth?.[0] ?? '');
    setStreet('address_full_match'); setCity('Montréal'); setProvince('QC'); setPostalCode('H2X 1Y4');
    setTransitNumber('11000'); setInstitutionNumber('000'); setAccountNumber('000123456789'); setAccountHolderName('Jean Test');
    setBankPassword('');
  };
  const [bankPassword, setBankPassword] = useState('');
  const provider = AuthService.getAuthProvider();
  const passwordProvider = provider === 'password' || (provider === 'apple.com' && Platform.OS !== 'ios' && AuthService.hasPasswordProvider());
  const canReauth = provider === 'password' || provider === 'google.com' ||
    (provider === 'apple.com' && (Platform.OS === 'ios' || AuthService.hasPasswordProvider()));

  // -- KYC document upload --
  const [frontUri, setFrontUri] = useState<string | null>(null);
  const [backUri, setBackUri] = useState<string | null>(null);

  // -- seller_onboarding_viewed (once the account status resolves) --
  const ageGateShown = isLoggedIn && canCreateAccount && !canSell(user?.dateOfBirth);
  const onboardingViewedRef = useRef(false);
  useEffect(() => {
    if (!isLoggedIn || isLoading || onboardingViewedRef.current) return;
    onboardingViewedRef.current = true;
    const acctExists = status?.hasAccount === true;
    const charges = status?.chargesEnabled === true;
    const payouts = status?.payoutsEnabled === true;
    const currentlyDue = status?.requirementsCurrentlyDue ?? [];
    const pastDue = status?.requirementsPastDue ?? [];
    const restricted = status?.status === 'restricted';
    const accountStatusEnum: 'none' | 'pending' | 'active' | 'restricted' = !acctExists
      ? 'none'
      : charges && payouts
        ? 'active'
        : restricted
          ? 'restricted'
          : 'pending';
    const kyc =
      acctExists &&
      needsIdentityDocument({
        requirementsCurrentlyDue: currentlyDue,
        requirementsPastDue: pastDue,
        disabledReason: status?.disabledReason ?? null,
        verificationErrors: status?.verificationErrors ?? [],
        requirementsPendingVerification: status?.requirementsPendingVerification ?? [],
      });
    track('seller_onboarding_viewed', {
      has_account: acctExists,
      account_status: accountStatusEnum,
      charges_enabled: charges,
      payouts_enabled: payouts,
      requirements_currently_due_count: currentlyDue.length,
      requirements_past_due_count: pastDue.length,
      shows_kyc_upload: !!kyc,
      age_gate_shown: ageGateShown,
    });
  }, [isLoggedIn, isLoading, status, ageGateShown]);

  // ---- Validation ----
  // Returns null when valid, else { message, field } — `field` is a stable key
  // (never the value) surfaced to analytics as `failed_field`.
  const validate = useCallback((checkDeclarations = true): { message: string; field: string } | null => {
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
    if (!accountHolderName.trim() || accountHolderName.trim().length > 200) {
      return { message: 'Indiquez le nom du titulaire ou cotitulaire figurant sur le compte bancaire.', field: 'bank_holder' };
    }
    if (checkDeclarations && !bankOwnershipAccepted) {
      return { message: 'Confirmez la déclaration de titulaire du compte bancaire.', field: 'bank_ownership' };
    }
    if (!canReauth || (passwordProvider && !bankPassword)) {
      return { message: canReauth ? 'Saisissez votre mot de passe pour confirmer votre identité.' : 'Contactez notre équipe pour vérifier votre identité.', field: 'bank_reauthentication' };
    }

    return null;
  }, [
    firstName, lastName, dobDay, dobMonth, dobYear,
    street, city, province, postalCode,
    transitNumber, institutionNumber, accountNumber, accountHolderName, bankOwnershipAccepted, bankPassword, canReauth, passwordProvider,
  ]);

  // ---- Create Stripe account mutation ----
  const createAccountMutation = useMutation<
    { chargesEnabled: boolean; payoutsEnabled: boolean; status: string; requirements?: string[] },
    Error,
    ConnectSetupAttempt
  >({
    gcTime: 0,
    mutationFn: async (attempt) => {
      if (!PAYMENTS_ENABLED || !canCreateAccount || !isAttemptCurrent(attempt)) {
        throw new Error('Le contexte a changé. Consultez les accords puis confirmez votre choix actuel.');
      }
      const assertCurrent = () => {
        if (!isAttemptCurrent(attempt)) throw new Error('Le contexte a changé. Reprenez depuis votre compte actuel.');
      };
      if (passwordProvider) await AuthService.reauthenticate(bankPassword, assertCurrent);
      else if (provider === 'google.com') await withNativeReauthentication(attempt.uid, assertCurrent,
        native => AuthService.reauthenticateWithGoogle(native.assertCurrent, native.waitForActive));
      else if (provider === 'apple.com' && Platform.OS === 'ios') await withNativeReauthentication(attempt.uid, assertCurrent,
        native => AuthService.reauthenticateWithApple(native.assertCurrent, native.waitForActive));
      else throw new Error('Contactez notre équipe pour vérifier votre identité.');
      assertCurrent();
      const currentUser = auth.currentUser;
      if (!currentUser || currentUser.uid !== attempt.uid) throw new Error('La session a changé.');
      await currentUser.getIdToken(true);
      assertCurrent();
      if (AppState.currentState !== 'active') throw new Error('Revenez à votre compte de paiement pour terminer la configuration.');
      setBankPassword('');

      const createFn = httpsCallable<
        ConnectSetupInput & { expectedUid: string },
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

      attempt.dispatched = true;
      let result;
      try {result = await createFn({ ...attempt.payload, expectedUid: attempt.uid });}
      catch (error) {
        const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
        if (['functions/internal', 'internal', 'functions/unavailable', 'unavailable', 'functions/deadline-exceeded', 'deadline-exceeded'].includes(code)) {
          throw Object.assign(new Error('La configuration n’a pas pu être confirmée. Votre saisie est conservée. Actualisez le statut avant de réessayer.'), {
            code, ...('details' in (error as object) ? {details: (error as {details?: unknown}).details} : {}),
          });
        }
        throw error;
      }
      if (!isAttemptCurrent(attempt)) throw new Error('Le contexte a changé. Actualisez le statut depuis votre compte actuel.');

      if (!result.data.stripeAccountId) {
        throw new Error('Impossible de créer le compte de paiement');
      }

      return {
        chargesEnabled: result.data.chargesEnabled,
        payoutsEnabled: result.data.payoutsEnabled,
        status: result.data.status,
        requirements: result.data.requirements,
      };
    },
    onSuccess: async (data, attempt) => {
      if (!isAttemptCurrent(attempt)) return;
      track('seller_account_submitted', {
        validation_result: 'ok',
        success: true,
        charges_enabled_after: data.chargesEnabled,
        requirements_count_after: data.requirements?.length ?? 0,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      preparationCompletionEngaged.current = true;
      setTransitNumber(''); setInstitutionNumber(''); setAccountNumber(''); setAccountHolderName('');
      setBankPassword('');
      await queryClient.invalidateQueries({ queryKey: queryKeys.stripe.all });
      if (!isAttemptCurrent(attempt)) return;

      if (!shippingArticleId) Alert.alert('Configuration enregistrée', 'Consultez le statut ci-dessous pour connaître les informations à fournir et l’état des paiements et des retraits.');
    },
    onError: (error, attempt) => {
      if (!isConsentContextCurrent(attempt)) return;
      track('seller_account_submitted', {
        validation_result: 'ok',
        success: false,
        error_code:
          error && typeof error === 'object' && 'code' in error
            ? String((error as { code?: unknown }).code)
            : undefined,
      });
      const details = 'details' in error && error.details && typeof error.details === 'object'
        ? error.details as { field?: unknown; reason?: unknown; recoveryReference?: unknown } : null;
      const code = 'code' in error ? String(error.code) : '';
      const refusedBeforeCreation = ['functions/invalid-argument', 'invalid-argument'].includes(code) ||
        details?.field === 'paymentAccountConsent' && ['payment_account_consent_required', 'payment_account_consent_version_required'].includes(String(details.reason));
      const outcomeUnknown = attempt.dispatched === true && !refusedBeforeCreation;
      if (outcomeUnknown) setConnectCreationUnknown(true);
      if (details?.field === 'paymentAccountConsent' &&
          ['payment_account_consent_required', 'payment_account_consent_version_required'].includes(String(details.reason))) {
        clearConsent();
        Alert.alert(
          details.reason === 'payment_account_consent_version_required' ? 'Accords à actualiser' : 'Acceptation requise',
          details.reason === 'payment_account_consent_version_required'
            ? 'La présentation des accords a changé. Actualisez ou rechargez la page, puis consultez-les avant de les accepter à nouveau. Votre saisie est conservée ici.'
            : 'Consultez les accords Stripe, puis cochez la case pour les accepter. Votre saisie est conservée.',
          [{ text: 'Fermer', style: 'cancel' }, { text: 'Actualiser le statut', onPress: () => { if (isConsentContextCurrent(attempt)) void refetch(); } }],
        );
        return;
      }
      Alert.alert(outcomeUnknown ? 'Configuration à vérifier' : 'Configuration non enregistrée', outcomeUnknown
        ? 'Impossible de confirmer la configuration pour le moment. Votre saisie est conservée. Actualisez le statut avant de poursuivre ; aucune nouvelle configuration ne sera envoyée entre-temps.'
        : error.message || 'Vérifiez les renseignements puis réessayez. Votre saisie est conservée.');
    },
    onSettled: (data, _error, attempt) => {
      if (createPending.current === attempt) createPending.current = null;
      if (!isConsentContextCurrent(attempt)) return;
      setBankPassword('');
      if (data) {clearConsent(); clearBankAcceptance();}
      createAccountMutation.reset();
    },
  });

  const resetCreateAccountMutation = createAccountMutation.reset;
  const setupReadOnly = createAccountMutation.isPending || connectCreationUnknown;
  useFocusEffect(useCallback(() => () => {
    setTransitNumber(''); setInstitutionNumber(''); setAccountNumber(''); setAccountHolderName('');
    setBankPassword('');
    bankEpoch.current++; bankAcceptance.current = null; setBankOwnershipAccepted(false);
    resetCreateAccountMutation();
  }, [resetCreateAccountMutation]));

  const handleSubmit = useCallback(() => {
    if (createPending.current || !PAYMENTS_ENABLED || !canCreateAccount || !isScreenCurrent(screenContext.current.focusEpoch)) return;
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
    const acceptance = consentAcceptance.current;
    const bankAccepted = bankAcceptance.current;
    if (!uid || !canCreateAccount || !consentAccepted || acceptance?.key !== consentKey || currentConsentKey() !== consentKey || auth.currentUser?.uid !== uid) {
      Alert.alert('Acceptation requise', 'Consultez les accords Stripe, puis cochez la case pour confirmer votre choix actuel.');
      return;
    }
    if (!bankOwnershipAccepted || bankAccepted?.key !== consentKey) {
      Alert.alert('Déclaration requise', 'Confirmez la déclaration de titulaire du compte bancaire.'); return;
    }
    const attempt: ConnectSetupAttempt = { uid, consentKey, consentEpoch: acceptance.epoch, bankEpoch: bankAccepted.epoch, focusEpoch: screenContext.current.focusEpoch, payload: {
      firstName: firstName.trim(), lastName: lastName.trim(),
      dob: { day: parseInt(dobDay, 10), month: parseInt(dobMonth, 10), year: parseInt(dobYear, 10) },
      address: { line1: street.trim(), city: city.trim(), province: province.trim(), postalCode: postalCode.trim().toUpperCase() },
      transitNumber, institutionNumber, accountNumber,
      accountHolderName: accountHolderName.trim(), bankOwnershipAccepted: true,
      bankOwnershipStatementVersion: BANK_OWNERSHIP_STATEMENT_VERSION,
      paymentAccountConsent: { accepted: true, presentationVersion: CONNECT_CONSENT_PRESENTATION_VERSION },
      ...(DEV_COMMERCE_TESTING_ENABLED && useTestIdentity ? { useTestIdentity: true as const } : {}),
    } };
    createPending.current = attempt;
    setConditionsVisible(false);
    createAccountMutation.mutate(attempt);
  }, [validate, createAccountMutation, uid, canCreateAccount, consentAccepted, consentKey, isScreenCurrent, firstName, lastName, dobDay, dobMonth, dobYear, street, city, province, postalCode, transitNumber, institutionNumber, accountNumber, accountHolderName, bankOwnershipAccepted, useTestIdentity]);

  const openConditions = () => {
    if (setupReadOnly || !canCreateAccount || !isScreenCurrent(screenContext.current.focusEpoch)) return;
    const error = validate(false);
    if (error) {Alert.alert('Renseignements à compléter', error.message); return;}
    setConditionsVisible(true);
  };

  // ---- KYC document picking + upload ----
  const pickDocument = useCallback(
    async (side: 'front' | 'back') => {
      const focusEpoch = screenContext.current.focusEpoch;
      if (pickerPending.current || documentPending.current || !isScreenCurrent(focusEpoch)) return;
      pickerPending.current = true;
      try {
        const { status: perm, canAskAgain } =
          await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!isScreenCurrent(focusEpoch)) return;
        if (perm !== 'granted') {
          track('permission_denied', {
            permission: 'photos',
            context: 'kyc',
            can_ask_again: canAskAgain,
            action_taken: 'cancel',
          });
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
        if (!isScreenCurrent(focusEpoch)) return;

        if (!result.canceled && result.assets[0]) {
          if (side === 'front') setFrontUri(result.assets[0].uri);
          else setBackUri(result.assets[0].uri);
        }
      } catch (error) {
        if (!isScreenCurrent(focusEpoch)) return;
        if (__DEV__) console.error('Error picking document:', error);
        Alert.alert('Erreur', "Impossible de selectionner l'image.");
      } finally {pickerPending.current = false;}
    },
    [isScreenCurrent],
  );

  const handleUploadDocument = useCallback(async () => {
    const focusEpoch = screenContext.current.focusEpoch;
    if (documentPending.current || pickerPending.current || !isScreenCurrent(focusEpoch) || !status?.hasAccount || !needsIdentityDocument(status)) return;
    if (!frontUri) {
      Alert.alert('Erreur', "Ajoutez au moins le recto de votre piece d'identite.");
      return;
    }
    if (identityDocumentNeedsBack(status) && !backUri) {
      Alert.alert('Verso requis', 'Ajoutez une photo lisible du verso. Le recto et le verso doivent être envoyés ensemble.');
      return;
    }
    const assertCurrent = () => { if (!isScreenCurrent(focusEpoch)) throw new Error('Le compte ou la page a changé. Reprenez depuis le compte actuel.'); };
    documentPending.current = true;
    try {
      const res = await uploadDocument({
        frontUri,
        backUri: backUri ?? undefined,
        assertContext: assertCurrent,
      });
      assertCurrent();
      preparationCompletionEngaged.current = true;
      void returnToPreparationIfConfirmed();
      track('kyc_document_uploaded', {
        has_back_side: !!backUri,
        success: true,
        requirements_remaining_count: res.requirementsCurrentlyDue.length,
        payouts_enabled_after: res.payoutsEnabled,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setFrontUri(null);
      setBackUri(null);
      if (!shippingArticleId) Alert.alert(
        'Document envoye',
        'Votre document a été reçu pour vérification. Cet envoi ne confirme pas que votre identité est vérifiée. Actualisez le statut pour connaître la suite.',
      );
    } catch (error: unknown) {
      if (!isScreenCurrent(focusEpoch)) return;
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
    } finally {documentPending.current = false;}
  }, [frontUri, backUri, uploadDocument, status, isScreenCurrent, shippingArticleId, returnToPreparationIfConfirmed]);

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
  if (canCreateAccount && !canSell(user?.dateOfBirth)) {
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
  const verificationErrors = status?.verificationErrors ?? [];
  const requirementsPendingVerification = status?.requirementsPendingVerification ?? [];
  const deadlineText = formatVerificationDeadline(status?.currentDeadline);

  // Fully operational only when BOTH charges and payouts are enabled.
  const fullyActive = paymentConfigurationConfirmed(status);
  const isRestricted = accountStatus === 'restricted';
  // Payouts blocked while charges work → must distinguish from "active".
  const payoutsBlocked = hasAccount && chargesEnabled && !payoutsEnabled;

  // Outstanding requirements: past_due first (more urgent), de-duplicated.
  const outstanding = getActionableRequirements({ requirementsPastDue, requirementsCurrentlyDue, verificationErrors, requirementsPendingVerification });
  const awaitingVerification = hasAccount && (requirementsPendingVerification.length > 0 ||
    status?.disabledReason === 'requirements.pending_verification' || accountStatus === 'pending_verification');
  const awaitingOnly = awaitingVerification && outstanding.length === 0 && verificationErrors.length === 0;

  const showKycUpload =
    hasAccount &&
    needsIdentityDocument({
      requirementsCurrentlyDue,
      requirementsPastDue,
      disabledReason: status?.disabledReason ?? null,
      verificationErrors,
      requirementsPendingVerification,
    });
  const needsBack = identityDocumentNeedsBack({ requirementsCurrentlyDue, requirementsPastDue, verificationErrors, requirementsPendingVerification });

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
    ? creationToVerify ? 'Configuration précédente à vérifier' : status?.success !== true ? 'Statut à vérifier'
      : canCreateAccount ? 'Aucun compte configuré' : 'Nouvelle configuration indisponible'
    : fullyActive
      ? 'Votre compte est actif'
      : status?.bankDeclarationRequired
        ? 'Compte bancaire à compléter'
      : awaitingOnly
        ? 'Vérification en cours'
        : awaitingVerification
          ? 'Corrections demandées et vérification en cours'
          : isRestricted
            ? 'Compte restreint : action requise'
            : payoutsBlocked
              ? 'Retraits indisponibles : statut à vérifier'
              : 'Configuration en cours';
  const statusDescription = !hasAccount
    ? creationToVerify ? 'Une configuration précédente reste à vérifier. Actualisez son statut ou contactez notre équipe avant toute nouvelle configuration.'
      : status?.success !== true ? 'Impossible de confirmer le statut du compte. Actualisez-le avant de poursuivre.'
      : canCreateAccount ? 'Configurez votre compte de paiement pour recevoir les gains de vos ventes.' : 'La création de nouveaux comptes de paiement est désactivée pour le moment. Vous pouvez consulter un compte existant et accéder à l’assistance.'
    : fullyActive
      ? 'Vous pouvez recevoir les paiements de vos ventes et retirer vos gains.'
      : status?.bankDeclarationRequired
        ? 'Complétez votre compte bancaire pour recevoir vos gains.'
      : awaitingOnly
        ? 'Votre compte est en cours de validation. Le statut se met à jour automatiquement.'
        : awaitingVerification
          ? 'Certaines informations sont en cours de vérification. Les corrections demandées ci-dessous restent à traiter.'
          : isRestricted
            ? 'Le compte est restreint. Consultez les informations demandées et contactez notre équipe si vous ne pouvez pas les corriger ici.'
            : payoutsBlocked
              ? 'Les paiements entrants sont activés sur le compte ; les retraits sont désactivés. Consultez les vérifications ci-dessous.'
              : 'La configuration du compte reste à vérifier. Actualisez le statut pour connaître les informations demandées.';

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
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {DEV_COMMERCE_TESTING_ENABLED ? <View style={styles.requirementsBlock}>
            <Text style={styles.requirementsTitle}>Seconde Dev · Paiements de test</Text>
            <Text style={styles.requirementText}>Utilisez les renseignements de test Stripe. Aucun virement bancaire réel n’est effectué.</Text>
            {useTestIdentity && canCreateAccount ? <Text style={styles.requirementText}>Une identité fictive sera utilisée pour la vérification Stripe. La naissance enregistrée dans votre compte Seconde est conservée.</Text> : null}
            {canCreateAccount ? <Button variant="secondary" onPress={fillTestInformation}>Utiliser des renseignements de test</Button> : null}
          </View> : null}
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
            {!PAYMENTS_ENABLED && hasAccount ? <Text style={styles.statusDescription}>
              Les nouveaux paiements sont désactivés dans Second. Le suivi et la correction de ce compte restent accessibles.
            </Text> : null}

            {hasAccount && !fullyActive && deadlineText && outstanding.length > 0 ? <View style={styles.requirementsBlock}>
              <Text style={styles.requirementText}>À compléter avant le {deadlineText}.</Text>
            </View> : null}

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

            {verificationErrors.length > 0 ? <View style={styles.requirementsBlock}>
              <Text style={styles.requirementsTitle}>Corrections demandées</Text>
              {verificationErrors.map((error, index) => <Text key={`${error.code}:${error.requirement}:${index}`} style={styles.requirementText}>
                {translateVerificationError(error)}
              </Text>)}
            </View> : null}

            {/* Unconditional manual refresh once an account exists (F62/F117) */}
            {hasAccount || !canCreateAccount ? (
              <Button
                variant={fullyActive ? 'muted' : 'primary'}
                fullWidth
                onPress={async () => {
                  const focusEpoch = screenContext.current.focusEpoch;
                  if (!isScreenCurrent(focusEpoch) || AppState.currentState !== 'active') return;
                  const before = status?.status ?? 'none';
                  const res = await refetch();
                  if (!isScreenCurrent(focusEpoch) || AppState.currentState !== 'active') return;
                  // Absence alone can be an unresolved/legacy attempt. Only the
                  // server's fresh creation qualification unlocks another explicit click.
                  if (res.isError === false && res.status === 'success' && res.fetchStatus === 'idle' &&
                      res.data?.success === true && res.data.hasAccount === false && res.data.connectCreationReady === true &&
                      res.data.connectActionRequired === false && !res.data.connectOperationState && !res.data.recoveryReference) {
                    setConnectCreationUnknown(false);
                  }
                  track('seller_status_refreshed', {
                    screen: 'stripe_onboarding',
                    account_status_before: before,
                    account_status_after: res.data?.status ?? 'none',
                    payouts_enabled_after: res.data?.payoutsEnabled,
                  });
                }}
                loading={isRefetching}
                style={styles.statusAction}
              >
                Actualiser le statut
              </Button>
            ) : null}
            <Button variant="ghost" fullWidth onPress={() => router.push('/settings/help')} style={styles.statusAction}>
              Contacter notre équipe
            </Button>
          </View>

          {/* ── KYC document remediation (F59) ── */}
          {showKycUpload ? (
            <View style={styles.formSection}>
              <Text style={styles.formTitle}>{"Verification d'identite"}</Text>
              <Text style={styles.formDescription}>
                Photographiez une pièce valide et non expirée, avec les quatre bords et les informations lisibles.
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
                  <Text style={styles.docLabel}>{needsBack ? 'Verso requis' : 'Verso si demandé'}</Text>
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
                disabled={isUploadingDocument || !frontUri || (needsBack && !backUri)}
                onPress={handleUploadDocument}
                style={styles.submitButton}
                leftIcon={
                  <Ionicons
                    name="cloud-upload-outline"
                    size={20}
                    color={colors.foreground}
                  />
                }
              >
                Envoyer le document
              </Button>
            </View>
          ) : null}

          {/* ── Bank account management (F60) ── */}
          {hasAccount ? <PaymentBankAccounts contextKey={JSON.stringify([shippingArticleId, setupIntent])}
            onCompleted={() => {
              const focusEpoch = screenContext.current.focusEpoch;
              if (!isScreenCurrent(focusEpoch)) return;
              preparationCompletionEngaged.current = true;
              void returnToPreparationIfConfirmed();
            }} /> : null}

          {/* Setup Form (only if no account yet) */}
          {showSetupForm && (
            <>
              {/* ── Personal Info Section ── */}
              <View style={styles.formSection}>
                <Text style={styles.formTitle}>Informations personnelles</Text>
                <Text style={styles.formDescription}>
                  Ces renseignements servent à vérifier votre identité.
                </Text>

                <View style={styles.row}>
                  <View style={[styles.inputGroup, styles.flex]}>
                    <Text style={styles.inputLabel}>Prenom</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="Jean"
                      placeholderTextColor={colors.muted}
                      value={firstName}
                      editable={!setupReadOnly}
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
                      editable={!setupReadOnly}
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
                        editable={!setupReadOnly}
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
                        editable={!setupReadOnly}
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
                        editable={!setupReadOnly}
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
                    editable={!setupReadOnly}
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
                      editable={!setupReadOnly}
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
                      editable={!setupReadOnly}
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
                    editable={!setupReadOnly}
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
                  Indiquez le nom figurant sur le compte bancaire. Votre pseudonyme public peut être différent.
                </Text>

                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Titulaire ou cotitulaire</Text>
                  <TextInput style={styles.input} value={accountHolderName}
                    onChangeText={value => { setAccountHolderName(value); clearBankAcceptance(); }}
                    maxLength={200} autoCapitalize="words" editable={!setupReadOnly}
                    placeholder="Nom figurant sur le compte" placeholderTextColor={colors.muted} />
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Numero de transit</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="12345"
                    placeholderTextColor={colors.muted}
                    value={transitNumber}
                    onChangeText={(t) => { setTransitNumber(t.replace(/\D/g, '').slice(0, 5)); clearBankAcceptance(); }}
                    editable={!setupReadOnly}
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
                    onChangeText={(t) => { setInstitutionNumber(t.replace(/\D/g, '').slice(0, 3)); clearBankAcceptance(); }}
                    editable={!setupReadOnly}
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
                    onChangeText={(t) => { setAccountNumber(t.replace(/\D/g, '').slice(0, 12)); clearBankAcceptance(); }}
                    editable={!setupReadOnly}
                    keyboardType="number-pad"
                    maxLength={12}
                  />
                </View>

                <View style={styles.consentSection}>
                  {passwordProvider ? <TextInput style={styles.input} value={bankPassword} onChangeText={setBankPassword}
                    secureTextEntry autoCapitalize="none" editable={!setupReadOnly}
                    placeholder="Mot de passe pour confirmer votre identité" placeholderTextColor={colors.muted} />
                    : <Text style={styles.consentNote}>{canReauth
                      ? `Votre identité sera confirmée avec ${provider === 'google.com' ? 'Google' : 'Apple'} avant l’envoi.`
                      : 'Contactez notre équipe pour confirmer votre identité.'}</Text>}
                </View>

                <Button
                  variant="primary"
                  fullWidth
                  loading={createAccountMutation.isPending}
                  disabled={!canCreateAccount || createAccountMutation.isPending || !canReauth || (passwordProvider && !bankPassword)}
                  onPress={openConditions}
                  leftIcon={
                    <Ionicons
                      name="shield-checkmark-outline"
                      size={20}
                      color={colors.foreground}
                    />
                  }
                  style={styles.submitButton}
                >
                  Configurer mon compte de paiement
                </Button>
              </View>
            </>
          )}

        </ScrollView>
      </KeyboardAvoidingView>
      <Modal visible={conditionsVisible} presentationStyle="pageSheet" animationType="slide"
        onRequestClose={() => setConditionsVisible(false)}>
        <View style={styles.container}>
          <ScreenHeader title="Conditions du compte" onBack={() => setConditionsVisible(false)} />
          <ScrollView contentContainerStyle={styles.conditionsContent} keyboardShouldPersistTaps="handled">
            <Text style={styles.formTitle}>Compte de paiement</Text>
            <Checkbox checked={bankOwnershipAccepted}
              onToggle={() => {
                if (!isScreenCurrent(screenContext.current.focusEpoch)) return;
                bankEpoch.current++;
                const next = bankAcceptance.current?.key !== consentKey;
                bankAcceptance.current = next ? {key: consentKey, epoch: bankEpoch.current} : null;
                setBankOwnershipAccepted(next);
              }} disabled={setupReadOnly} accessibilityLabel={BANK_OWNERSHIP_STATEMENT}>
              <Text style={styles.consentStatement}>{BANK_OWNERSHIP_STATEMENT}</Text>
            </Checkbox>
            <Checkbox checked={consentAccepted} onToggle={toggleConsent} disabled={setupReadOnly}
              accessibilityLabel={CONNECT_CONSENT_STATEMENT}>
              <Text style={styles.consentStatement}>{CONNECT_CONSENT_STATEMENT}</Text>
            </Checkbox>
            <Link href={CONNECT_CONSENT_AGREEMENT_URLS.connectAccount} style={styles.consentLink}>
              Accord sur les comptes connectés Stripe
            </Link>
            <Link href={CONNECT_CONSENT_AGREEMENT_URLS.servicesAgreement} style={styles.consentLink}>
              Accord de services Stripe
            </Link>
            <Link href={CONNECT_CONSENT_TRANSLATIONS_URL} style={styles.consentLink}>
              Traductions françaises fournies par Stripe
            </Link>
            <Text style={styles.consentNote}>
              Les accords principaux sont présentés en anglais. Les traductions françaises sont proposées par Stripe à titre informatif.
            </Text>
            <Button fullWidth disabled={setupReadOnly || !consentAccepted || !bankOwnershipAccepted}
              onPress={handleSubmit}>Confirmer et configurer</Button>
          </ScrollView>
        </View>
      </Modal>
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
  scrollContent: {
    paddingBottom: spacing.xl,
  },
  conditionsContent: {
    padding: spacing.lg,
    paddingBottom: spacing['3xl'],
    gap: spacing.lg,
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
  consentSection: { marginTop: spacing.md, gap: spacing.sm },
  consentStatement: { ...typography.body, color: colors.foreground },
  consentLink: { ...typography.caption, color: colors.primary, textDecorationLine: 'underline' },
  consentNote: { ...typography.caption, color: colors.muted },
  submitButton: {
    marginTop: spacing.md,
  },
});
