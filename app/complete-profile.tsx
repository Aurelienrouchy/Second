/**
 * CompleteProfileScreen — mandatory post-signup step (Loi 25 + @pseudo choice).
 *
 * Reached by BOTH flows already authenticated at Firebase level:
 *  - email signup (bare account created, no DOB/consent yet)
 *  - social sign-in (Google/Apple) that `needsConsent`
 * The startup guard (useConsentGuard) routes any `pendingConsent` account here
 * and blocks the rest of the app until consent is recorded.
 *
 * Collects, in this strict vertical order:
 *  1. Title + message
 *  2. @pseudo (live availability check, debounced)
 *  3. ConsentFields (DOB JJ/MM/AAAA + 3 checkboxes) — reused as-is
 *  4. CONTINUER
 *
 * Submit order (audit A6): completeConsent → recordSignupConsent (reserve
 * @pseudo + write DOB atomically) → signIn → mergeGuestToUser. A taken @pseudo
 * is an inline error under the field (NO account rollback — re-submit with
 * another handle). Back navigation is locked (gestureEnabled:false + a
 * BackHandler that consumes the Android back) since this is a mandatory step.
 */

import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { ConsentFields } from '@/components/auth-bottom-sheet/ConsentFields';
import { Input } from '@/components/ui';
import {
  COPY_USERNAME,
  validateChosenUsernameLocal,
  type UsernameRejectionReason,
} from '@/constants/authMessages';
import { colors, fonts, radius, spacing, typography } from '@/constants/theme';
import { track } from '@/lib/analytics';
import { AuthService } from '@/services/authService';
import { useAuthStore } from '@/store/authStore';
import { computeAgeFromIso, MIN_AGE_REGISTER, toIsoDate } from '@/utils/age';

// Derives a coarse age band for analytics — the DOB itself is never sent (PII).
function ageToBand(age: number): '16-17' | '18-24' | '25-34' | '35-44' | '45+' {
  if (age <= 17) return '16-17';
  if (age <= 24) return '18-24';
  if (age <= 34) return '25-34';
  if (age <= 44) return '35-44';
  return '45+';
}

// Debounce before hitting the live availability callable. Only fires once the
// local format is valid (no network call on a malformed handle).
const AVAILABILITY_DEBOUNCE_MS = 350;

// Username field state machine. Drives the right icon (spinner/checkmark/none),
// the inline error, and whether CONTINUER is enabled.
type UsernameStatus =
  | 'idle' // empty / untouched
  | 'invalid' // local format error
  | 'checking' // live check in flight
  | 'available' // confirmed free + well-formed
  | 'taken' // confirmed taken
  | 'network-error'; // live check failed

function reasonToError(reason: UsernameRejectionReason): string {
  switch (reason) {
    case 'too_short':
      return COPY_USERNAME.errTooShort;
    case 'invalid_chars':
      return COPY_USERNAME.errInvalidChars;
    // too_long is impossible via the UI (maxLength=20) but mapped defensively.
    case 'too_long':
      return COPY_USERNAME.errInvalidChars;
  }
}

export default function CompleteProfileScreen() {
  const insets = useSafeAreaInsets();

  // ── @pseudo ──
  const [username, setUsername] = useState('');
  const [usernameStatus, setUsernameStatus] = useState<UsernameStatus>('idle');
  const [usernameError, setUsernameError] = useState<string | undefined>(undefined);
  // Monotonic request id so a stale availability response is ignored (the last
  // keystroke wins). Bumped on every change + debounce kickoff.
  const requestIdRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Monotonic count of username_checked emissions this session (attempt_index).
  const usernameCheckCountRef = useRef(0);

  // ── Consent (DOB + checkboxes) ──
  const [dobDay, setDobDay] = useState('');
  const [dobMonth, setDobMonth] = useState('');
  const [dobYear, setDobYear] = useState('');
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [acceptedPrivacy, setAcceptedPrivacy] = useState(false);
  const [marketingOptIn, setMarketingOptIn] = useState(false);
  const [dobTouched, setDobTouched] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | undefined>(undefined);

  // ── Username live availability ──
  const runAvailabilityCheck = useCallback((value: string, reqId: number) => {
    AuthService.checkUsernameAvailability(value)
      .then((res) => {
        // Ignore if a newer keystroke superseded this request.
        if (reqId !== requestIdRef.current) return;
        usernameCheckCountRef.current += 1;
        if (res.available) {
          setUsernameStatus('available');
          setUsernameError(undefined);
          track('username_checked', {
            result: 'available',
            username_length: value.length,
            attempt_index: usernameCheckCountRef.current,
          });
        } else if (res.reason === 'taken') {
          setUsernameStatus('taken');
          setUsernameError(COPY_USERNAME.errTaken);
          track('username_checked', {
            result: 'taken',
            username_length: value.length,
            attempt_index: usernameCheckCountRef.current,
          });
        } else if (res.reason) {
          setUsernameStatus('invalid');
          setUsernameError(reasonToError(res.reason));
          track('username_checked', {
            result: 'invalid',
            invalid_reason: res.reason,
            username_length: value.length,
            attempt_index: usernameCheckCountRef.current,
          });
        } else {
          setUsernameStatus('available');
          setUsernameError(undefined);
          track('username_checked', {
            result: 'available',
            username_length: value.length,
            attempt_index: usernameCheckCountRef.current,
          });
        }
      })
      .catch((error) => {
        if (reqId !== requestIdRef.current) return;
        if (__DEV__) console.log('[complete-profile] availability check failed:', error);
        setUsernameStatus('network-error');
        setUsernameError(COPY_USERNAME.errNetwork);
        usernameCheckCountRef.current += 1;
        track('username_checked', {
          result: 'network_error',
          username_length: value.length,
          attempt_index: usernameCheckCountRef.current,
        });
      });
  }, []);

  const handleChangeUsername = useCallback(
    (raw: string) => {
      // Normalise to lowercase for display + the call, but DO NOT silently strip
      // illegal chars — show what the user typed + the error if invalid.
      const next = raw.toLowerCase();
      setUsername(next);

      // Any change invalidates an in-flight check.
      requestIdRef.current += 1;
      const reqId = requestIdRef.current;
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }

      if (next.length === 0) {
        setUsernameStatus('idle');
        setUsernameError(undefined);
        return;
      }

      const local = validateChosenUsernameLocal(next);
      if (!local.valid) {
        // Local format KO → inline error, NO network call.
        setUsernameStatus('invalid');
        setUsernameError(reasonToError(local.reason));
        usernameCheckCountRef.current += 1;
        track('username_checked', {
          result: 'invalid_local',
          invalid_reason: local.reason,
          username_length: next.length,
          attempt_index: usernameCheckCountRef.current,
        });
        return;
      }

      // Format OK → debounce a live availability check.
      setUsernameStatus('checking');
      setUsernameError(undefined);
      debounceRef.current = setTimeout(() => {
        runAvailabilityCheck(local.username, reqId);
      }, AVAILABILITY_DEBOUNCE_MS);
    },
    [runAvailabilityCheck],
  );

  // Cleanup the pending debounce on unmount.
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // ── DOB / age validation (same ISO contract as the rest of the auth flow) ──
  const dobComplete = dobDay !== '' && dobMonth !== '' && dobYear.length === 4;
  const isoDob = useMemo(() => {
    if (!dobComplete) return null;
    return toIsoDate(
      parseInt(dobYear, 10),
      parseInt(dobMonth, 10),
      parseInt(dobDay, 10),
    );
  }, [dobComplete, dobDay, dobMonth, dobYear]);
  const age = isoDob ? computeAgeFromIso(isoDob) : null;
  const ageValid = age !== null && age >= MIN_AGE_REGISTER;
  const showAgeError = dobTouched && dobComplete && (isoDob === null || !ageValid);

  // signup_age_checked: fire once the DOB is complete, and again when its
  // outcome changes. Never sends the DOB — only the result + a coarse age band.
  const lastAgeResultRef = useRef<'valid' | 'invalid_date' | 'underage' | null>(null);
  useEffect(() => {
    if (!dobComplete) {
      lastAgeResultRef.current = null;
      return;
    }
    const result: 'valid' | 'invalid_date' | 'underage' =
      isoDob === null ? 'invalid_date' : !ageValid ? 'underage' : 'valid';
    if (lastAgeResultRef.current === result) return;
    lastAgeResultRef.current = result;
    track('signup_age_checked', {
      result,
      ...(result === 'valid' && age !== null ? { age_band: ageToBand(age) } : {}),
    });
  }, [dobComplete, isoDob, ageValid, age]);

  // ── Submit gate ──
  // CONTINUER enabled only when: @pseudo confirmed free+well-formed, DOB valid
  // (age >= 16), both required boxes checked, not already submitting.
  // marketingOptIn never counts.
  const submitDisabled =
    usernameStatus !== 'available' ||
    !ageValid ||
    !acceptedTerms ||
    !acceptedPrivacy ||
    isSubmitting;

  const handleToggleTerms = useCallback(() => {
    const next = !acceptedTerms;
    track('consent_toggled', { consent_type: 'terms', checked: next });
    setAcceptedTerms(next);
  }, [acceptedTerms]);
  const handleTogglePrivacy = useCallback(() => {
    const next = !acceptedPrivacy;
    track('consent_toggled', { consent_type: 'privacy', checked: next });
    setAcceptedPrivacy(next);
  }, [acceptedPrivacy]);
  const handleToggleMarketing = useCallback(() => {
    const next = !marketingOptIn;
    track('consent_toggled', { consent_type: 'marketing', checked: next });
    setMarketingOptIn(next);
  }, [marketingOptIn]);
  const handleBlurDob = useCallback(() => setDobTouched(true), []);

  const handleSubmit = useCallback(async () => {
    if (submitDisabled || !isoDob) return;
    const signupMethod =
      useAuthStore.getState().pendingConsentUser?.authProvider ?? 'email';
    const usernameLength = username.trim().length;
    track('signup_profile_submitted', {
      signup_method: signupMethod,
      marketing_opt_in: marketingOptIn,
      username_length: usernameLength,
    });
    setIsSubmitting(true);
    setSubmitError(undefined);
    try {
      await useAuthStore.getState().completeConsent({
        dateOfBirth: isoDob,
        acceptedTerms,
        acceptedPrivacy,
        marketingOptIn,
        desiredUsername: username.trim().toLowerCase(),
      });
      // On success the store flips authenticated + clears pendingConsent; the
      // guard stops re-routing. Navigation to the app resumes via the normal
      // flow (index → tabs / preferences onboarding).
    } catch (error) {
      // Map the structured callable error (FirebaseError-like) to inline UX.
      const code = (error as { code?: string } | null)?.code;
      const details = (error as { details?: { field?: string; reason?: string } } | null)?.details;
      const isUsernameField = details?.field === 'username';

      let errorCode: 'username_taken' | 'username_invalid' | 'age_invalid' | 'consent_required' | 'network';
      if (code === 'functions/already-exists' && isUsernameField) {
        // Pseudo taken by someone else (race vs the live check). Inline error
        // under the field; NO account rollback — user re-submits another handle.
        setUsernameStatus('taken');
        setUsernameError(COPY_USERNAME.errTaken);
        errorCode = 'username_taken';
      } else if (code === 'functions/invalid-argument' && isUsernameField && details?.reason) {
        setUsernameStatus('invalid');
        setUsernameError(reasonToError(details.reason as UsernameRejectionReason));
        errorCode = 'username_invalid';
      } else if (code === 'functions/invalid-argument') {
        // DOB invalid / age < 16 (no field). Surface near the consent block.
        setSubmitError(COPY_CONSENT_AGE_ERROR);
        errorCode = 'age_invalid';
      } else if (code === 'functions/failed-precondition') {
        setSubmitError(COPY_CONSENT_REQUIRED_ERROR);
        errorCode = 'consent_required';
      } else {
        if (__DEV__) console.log('[complete-profile] completeConsent failed:', error);
        setSubmitError(COPY_USERNAME.errNetwork);
        errorCode = 'network';
      }
      track('signup_profile_failed', {
        error_code: errorCode,
        username_length: username.trim().length,
      });
    } finally {
      setIsSubmitting(false);
    }
  }, [
    submitDisabled,
    isoDob,
    acceptedTerms,
    acceptedPrivacy,
    marketingOptIn,
    username,
  ]);

  // Progress proxy for signup_back_blocked, mirrored to a ref so the one-shot
  // BackHandler effect reads the latest value without re-subscribing.
  const fieldsFilledCount = [
    username.trim() !== '',
    dobDay !== '',
    dobMonth !== '',
    dobYear !== '',
    acceptedTerms,
    acceptedPrivacy,
  ].filter(Boolean).length;
  const fieldsFilledRef = useRef(fieldsFilledCount);
  useEffect(() => {
    fieldsFilledRef.current = fieldsFilledCount;
  }, [fieldsFilledCount]);

  // ── Mandatory step: lock the Android hardware back (no-op, consume it). The
  // iOS back-swipe is already blocked via gestureEnabled:false in the Stack. ──
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      track('signup_back_blocked', { fields_filled_count: fieldsFilledRef.current });
      return true;
    });
    return () => subscription.remove();
  }, []);

  // Right icon: spinner while checking, green check when available, else none.
  const usernameRightIcon =
    usernameStatus === 'checking' ? (
      <ActivityIndicator size="small" color={colors.muted} />
    ) : usernameStatus === 'available' ? (
      <Ionicons name="checkmark-circle" size={20} color={colors.success} />
    ) : undefined;

  return (
    <SafeAreaView style={styles.safeArea} testID="complete-profile">
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          style={styles.flex}
          contentContainerStyle={[
            styles.content,
            { paddingBottom: insets.bottom + spacing.xl },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* 1. Title + message */}
          <Text style={styles.title}>{COPY_USERNAME.title}</Text>
          <Text style={styles.message}>{COPY_USERNAME.message}</Text>

          {/* 2. @pseudo */}
          <Input
            testID="complete-profile-username"
            label={COPY_USERNAME.label}
            placeholder={COPY_USERNAME.placeholder}
            value={username}
            onChangeText={handleChangeUsername}
            hint={COPY_USERNAME.helper}
            error={usernameError}
            leftIcon={<Text style={styles.atGlyph}>@</Text>}
            rightIcon={usernameRightIcon}
            showClearButton={false}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={20}
            containerStyle={styles.usernameField}
          />
          {/* Immutability caption — dedicated line so it stays visible even when
              `error` replaces the hint. */}
          <Text style={styles.immutability}>{COPY_USERNAME.immutability}</Text>

          {/* 3. DOB + consent checkboxes (reused as-is) */}
          <ConsentFields
            dobDay={dobDay}
            dobMonth={dobMonth}
            dobYear={dobYear}
            acceptedTerms={acceptedTerms}
            acceptedPrivacy={acceptedPrivacy}
            marketingOptIn={marketingOptIn}
            showAgeError={showAgeError}
            onChangeDobDay={setDobDay}
            onChangeDobMonth={setDobMonth}
            onChangeDobYear={setDobYear}
            onBlurDob={handleBlurDob}
            onToggleTerms={handleToggleTerms}
            onTogglePrivacy={handleTogglePrivacy}
            onToggleMarketing={handleToggleMarketing}
          />

          {submitError ? (
            <Text style={styles.submitError}>{submitError}</Text>
          ) : null}

          {/* 4. CONTINUER */}
          <Pressable
            testID="complete-profile-submit"
            style={[styles.cta, submitDisabled && styles.ctaDisabled]}
            onPress={handleSubmit}
            disabled={submitDisabled}
            accessibilityLabel={COPY_USERNAME.cta}
            accessibilityRole="button"
          >
            {isSubmitting ? (
              <ActivityIndicator color={colors.white} />
            ) : (
              <Text style={styles.ctaText}>{COPY_USERNAME.cta}</Text>
            )}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// Server-side error fallbacks (no `field`) reuse the existing legal age-gate /
// consent copy semantics without re-deriving them locally.
const COPY_CONSENT_AGE_ERROR =
  'Vous devez avoir au moins 16 ans pour utiliser Second.';
const COPY_CONSENT_REQUIRED_ERROR =
  "Vous devez accepter les Conditions d'utilisation et la Politique de confidentialité.";

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  flex: {
    flex: 1,
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
  },
  title: {
    fontFamily: fonts.display,
    fontSize: 32,
    fontWeight: '300',
    lineHeight: 36,
    letterSpacing: -0.5,
    color: colors.foreground,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  message: {
    fontFamily: fonts.sans,
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: colors.muted,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  usernameField: {
    marginBottom: spacing.xs,
  },
  atGlyph: {
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.muted,
  },
  immutability: {
    fontFamily: typography.caption.fontFamily,
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: colors.muted,
    marginTop: spacing.xs,
    marginBottom: spacing.lg,
  },
  submitError: {
    fontFamily: fonts.sans,
    fontSize: 12,
    color: colors.danger,
    marginTop: spacing.md,
  },
  cta: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.md - 1,
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  ctaDisabled: {
    backgroundColor: colors.muted,
    opacity: 0.5,
  },
  ctaText: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    color: colors.white,
    letterSpacing: 1.2,
  },
});
