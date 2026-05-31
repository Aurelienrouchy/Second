/**
 * SignUpForm — username/email/password sign-up with age gate (16+) and the
 * mandatory consent checkboxes (Terms + Privacy) plus an optional marketing
 * opt-in. Also exposes social auth + tab toggle.
 *
 * The create-account button stays disabled until the date of birth is a real
 * calendar date corresponding to age >= 16 AND both required boxes are checked.
 */

import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, Text, TextInput, View } from 'react-native';

import { colors } from '@/constants/theme';
import { computeAgeFromIso, MIN_AGE_REGISTER, toIsoDate } from '@/utils/age';

import { ConsentFields } from './ConsentFields';
import { styles } from './styles';

export interface SignUpFormProps {
  email: string;
  password: string;
  username: string;
  dobDay: string;
  dobMonth: string;
  dobYear: string;
  acceptedTerms: boolean;
  acceptedPrivacy: boolean;
  marketingOptIn: boolean;
  isLoading: boolean;
  message?: string;
  onChangeEmail: (value: string) => void;
  onChangePassword: (value: string) => void;
  onChangeUsername: (value: string) => void;
  onChangeDobDay: (value: string) => void;
  onChangeDobMonth: (value: string) => void;
  onChangeDobYear: (value: string) => void;
  onToggleTerms: () => void;
  onTogglePrivacy: () => void;
  onToggleMarketing: () => void;
  onSubmit: () => void;
  onSwitchToSignIn: () => void;
  onSocialAuth: (provider: 'Google' | 'Apple') => void;
}

function SignUpFormComponent({
  email,
  password,
  username,
  dobDay,
  dobMonth,
  dobYear,
  acceptedTerms,
  acceptedPrivacy,
  marketingOptIn,
  isLoading,
  message,
  onChangeEmail,
  onChangePassword,
  onChangeUsername,
  onChangeDobDay,
  onChangeDobMonth,
  onChangeDobYear,
  onToggleTerms,
  onTogglePrivacy,
  onToggleMarketing,
  onSubmit,
  onSwitchToSignIn,
  onSocialAuth,
}: SignUpFormProps) {
  const [touched, setTouched] = useState({
    username: false,
    email: false,
    password: false,
    dob: false,
  });

  const handleBlur = useCallback(
    (field: 'username' | 'email' | 'password' | 'dob') => {
      setTouched((prev) => ({ ...prev, [field]: true }));
    },
    [],
  );

  const usernameInvalid = touched.username && username.trim().length < 3;
  const emailInvalid =
    touched.email && (!email.includes('@') || !email.includes('.'));
  const passwordInvalid = touched.password && password.length < 6;

  // Compute age from the three DOB fields via the shared ISO contract.
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
  const showAgeError =
    touched.dob && dobComplete && (isoDob === null || !ageValid);

  const submitDisabled =
    !email.trim() ||
    !password.trim() ||
    !username.trim() ||
    !ageValid ||
    !acceptedTerms ||
    !acceptedPrivacy ||
    isLoading;

  return (
    <>
      <Text style={styles.title}>Bienvenue sur</Text>
      <Text style={styles.subtitle}>Seconde</Text>
      {message ? <Text style={styles.message}>{message}</Text> : null}

      {/* Social auth */}
      {Platform.OS === 'ios' && (
        <Pressable
          style={styles.appleButton}
          onPress={() => onSocialAuth('Apple')}
          disabled={isLoading}
          accessibilityLabel="S'inscrire avec Apple"
          accessibilityRole="button"
        >
          <Ionicons name="logo-apple" size={20} color={colors.white} />
          <Text style={styles.appleButtonText}>Continuer avec Apple</Text>
        </Pressable>
      )}

      <Pressable
        style={styles.socialButton}
        onPress={() => onSocialAuth('Google')}
        disabled={isLoading}
        accessibilityLabel="S'inscrire avec Google"
        accessibilityRole="button"
      >
        <Ionicons name="logo-google" size={18} color={colors.foreground} />
        <Text style={styles.socialButtonText}>Continuer avec Google</Text>
      </Pressable>

      {/* Divider */}
      <View style={styles.divider}>
        <View style={styles.dividerLine} />
        <Text style={styles.dividerText}>ou</Text>
        <View style={styles.dividerLine} />
      </View>

      {/* Toggle tabs */}
      <View style={styles.authToggle}>
        <Pressable style={styles.toggleTab} onPress={onSwitchToSignIn}>
          <Text style={styles.toggleTabText}>Se connecter</Text>
        </Pressable>
        <Pressable style={[styles.toggleTab, styles.toggleTabActive]}>
          <Text style={[styles.toggleTabText, styles.toggleTabTextActive]}>
            S'inscrire
          </Text>
        </Pressable>
      </View>

      {/* Form fields */}
      <TextInput
        style={styles.input}
        placeholder="Nom d'utilisateur"
        placeholderTextColor={colors.muted}
        value={username}
        onChangeText={onChangeUsername}
        onBlur={() => handleBlur('username')}
        autoCapitalize="none"
        accessibilityLabel="Nom d'utilisateur"
      />
      {usernameInvalid ? (
        <Text style={styles.fieldError}>3 caractères minimum</Text>
      ) : null}

      <TextInput
        style={styles.input}
        placeholder="Email"
        placeholderTextColor={colors.muted}
        value={email}
        onChangeText={onChangeEmail}
        onBlur={() => handleBlur('email')}
        keyboardType="email-address"
        autoCapitalize="none"
        accessibilityLabel="Adresse email"
      />
      {emailInvalid ? (
        <Text style={styles.fieldError}>Adresse email invalide</Text>
      ) : null}

      <TextInput
        style={styles.input}
        placeholder="Mot de passe"
        placeholderTextColor={colors.muted}
        value={password}
        onChangeText={onChangePassword}
        onBlur={() => handleBlur('password')}
        secureTextEntry
        accessibilityLabel="Mot de passe"
      />
      {passwordInvalid ? (
        <Text style={styles.fieldError}>6 caractères minimum</Text>
      ) : null}

      {/* Date of birth (age gate) */}
      <Text style={styles.dobLabel}>{COPY_CONSENT.dobLabel}</Text>
      <View style={styles.dobRow}>
        <TextInput
          style={[styles.input, styles.dobField]}
          placeholder="JJ"
          placeholderTextColor={colors.muted}
          value={dobDay}
          onChangeText={(t) => onChangeDobDay(t.replace(/\D/g, '').slice(0, 2))}
          onBlur={() => handleBlur('dob')}
          keyboardType="number-pad"
          maxLength={2}
          accessibilityLabel="Jour de naissance"
        />
        <Text style={styles.dobSeparator}>/</Text>
        <TextInput
          style={[styles.input, styles.dobField]}
          placeholder="MM"
          placeholderTextColor={colors.muted}
          value={dobMonth}
          onChangeText={(t) =>
            onChangeDobMonth(t.replace(/\D/g, '').slice(0, 2))
          }
          onBlur={() => handleBlur('dob')}
          keyboardType="number-pad"
          maxLength={2}
          accessibilityLabel="Mois de naissance"
        />
        <Text style={styles.dobSeparator}>/</Text>
        <TextInput
          style={[styles.input, styles.dobFieldYear]}
          placeholder="AAAA"
          placeholderTextColor={colors.muted}
          value={dobYear}
          onChangeText={(t) => onChangeDobYear(t.replace(/\D/g, '').slice(0, 4))}
          onBlur={() => handleBlur('dob')}
          keyboardType="number-pad"
          maxLength={4}
          accessibilityLabel="Année de naissance"
        />
      </View>
      {showAgeError ? (
        <Text style={styles.fieldError}>{COPY_CONSENT.ageError}</Text>
      ) : null}

      {/* Consent checkboxes */}
      <View style={styles.consentBlock}>
        <Checkbox
          checked={acceptedTerms}
          onToggle={onToggleTerms}
          accessibilityLabel={`${COPY_CONSENT.termsPrefix}${COPY_CONSENT.termsLink}`}
        >
          <Text style={styles.consentText}>
            {COPY_CONSENT.termsPrefix}
            <Link href="/settings/terms" style={styles.consentLink}>
              {COPY_CONSENT.termsLink}
            </Link>
            {COPY_CONSENT.termsSuffix}
          </Text>
        </Checkbox>

        <Checkbox
          checked={acceptedPrivacy}
          onToggle={onTogglePrivacy}
          accessibilityLabel={`${COPY_CONSENT.privacyPrefix}${COPY_CONSENT.privacyLink}`}
        >
          <Text style={styles.consentText}>
            {COPY_CONSENT.privacyPrefix}
            <Link href="/settings/privacy-policy" style={styles.consentLink}>
              {COPY_CONSENT.privacyLink}
            </Link>
            {COPY_CONSENT.privacySuffix}
          </Text>
        </Checkbox>

        <Checkbox
          checked={marketingOptIn}
          onToggle={onToggleMarketing}
          accessibilityLabel={COPY_CONSENT.marketing}
        >
          <Text style={styles.consentText}>{COPY_CONSENT.marketing}</Text>
        </Checkbox>

        <Text style={styles.law25Note}>
          {COPY_CONSENT.law25Prefix}
          <Link href="/settings/privacy-policy" style={styles.consentLink}>
            {COPY_CONSENT.law25Link}
          </Link>
          {COPY_CONSENT.law25Suffix}
        </Text>
      </View>

      <Pressable
        style={[styles.primaryButton, submitDisabled && styles.disabledButton]}
        onPress={onSubmit}
        disabled={submitDisabled}
        accessibilityLabel="S'inscrire"
        accessibilityRole="button"
      >
        {isLoading ? (
          <ActivityIndicator color={colors.white} />
        ) : (
          <Text style={styles.primaryButtonText}>S'INSCRIRE</Text>
        )}
      </Pressable>
    </>
  );
}

export const SignUpForm = React.memo(SignUpFormComponent);
