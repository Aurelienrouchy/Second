/**
 * SignUpForm — username/email/password fields with the age gate (16+) and the
 * mandatory consent checkboxes (Terms + Privacy) plus an optional marketing
 * opt-in, ending with the create-account CTA.
 *
 * Fields only: the title, social buttons, divider and the signIn/signUp toggle
 * are rendered ONCE by AuthBottomSheet (shared chrome), so switching modes only
 * re-animates these fields — never the chrome.
 *
 * The create-account button stays disabled until the date of birth is a real
 * calendar date corresponding to age >= 16 AND both required boxes are checked.
 */

import { BottomSheetTextInput } from '@gorhom/bottom-sheet';
import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

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
    <View>
      <BottomSheetTextInput
        testID="signup-username-input"
        style={styles.input}
        placeholder="Nom d'affichage"
        placeholderTextColor={colors.muted}
        value={username}
        onChangeText={onChangeUsername}
        onBlur={() => handleBlur('username')}
        autoCapitalize="words"
        accessibilityLabel="Nom d'affichage"
      />
      {usernameInvalid ? (
        <Text style={styles.fieldError}>3 caractères minimum</Text>
      ) : null}

      <BottomSheetTextInput
        testID="signup-email-input"
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

      <BottomSheetTextInput
        testID="signup-password-input"
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

      {/* Date of birth (age gate) + consent checkboxes — shared with social flow */}
      <ConsentFields
        dobDay={dobDay}
        dobMonth={dobMonth}
        dobYear={dobYear}
        acceptedTerms={acceptedTerms}
        acceptedPrivacy={acceptedPrivacy}
        marketingOptIn={marketingOptIn}
        showAgeError={showAgeError}
        onChangeDobDay={onChangeDobDay}
        onChangeDobMonth={onChangeDobMonth}
        onChangeDobYear={onChangeDobYear}
        onBlurDob={() => handleBlur('dob')}
        onToggleTerms={onToggleTerms}
        onTogglePrivacy={onTogglePrivacy}
        onToggleMarketing={onToggleMarketing}
      />

      <Pressable
        testID="signup-submit"
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
    </View>
  );
}

export const SignUpForm = React.memo(SignUpFormComponent);
