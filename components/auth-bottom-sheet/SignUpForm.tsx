/**
 * SignUpForm — username/email/password sign-up with age gate (16+) and the
 * mandatory consent checkboxes (Terms + Privacy) plus an optional marketing
 * opt-in. Also exposes social auth + tab toggle.
 *
 * The create-account button stays disabled until the date of birth is a real
 * calendar date corresponding to age >= 16 AND both required boxes are checked.
 */

import { Ionicons } from '@expo/vector-icons';
import * as AppleAuthentication from 'expo-apple-authentication';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
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

  // Disponibilité Apple Sign-In au montage du formulaire (cf. SignInForm).
  const [appleAvailable, setAppleAvailable] = useState(false);
  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    let mounted = true;
    AppleAuthentication.isAvailableAsync()
      .then((available) => {
        if (mounted) setAppleAvailable(available);
      })
      .catch(() => {
        if (mounted) setAppleAvailable(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

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
      {appleAvailable ? (
        <Pressable
          testID="social-apple"
          style={styles.appleButton}
          onPress={() => onSocialAuth('Apple')}
          disabled={isLoading}
          accessibilityLabel="S'inscrire avec Apple"
          accessibilityRole="button"
        >
          <Ionicons name="logo-apple" size={20} color={colors.white} />
          <Text style={styles.appleButtonText}>Continuer avec Apple</Text>
        </Pressable>
      ) : Platform.OS !== 'ios' ? (
        <Text style={styles.message}>
          Compte créé avec Apple ? Connectez-vous depuis un iPhone, ou ajoutez
          un mot de passe depuis iOS pour vous connecter ici.
        </Text>
      ) : null}

      <Pressable
        testID="social-google"
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
        <Pressable
          testID="auth-tab-signin"
          style={styles.toggleTab}
          onPress={onSwitchToSignIn}
        >
          <Text style={styles.toggleTabText}>Se connecter</Text>
        </Pressable>
        <Pressable
          testID="auth-tab-signup"
          style={[styles.toggleTab, styles.toggleTabActive]}
        >
          <Text style={[styles.toggleTabText, styles.toggleTabTextActive]}>
            S'inscrire
          </Text>
        </Pressable>
      </View>

      {/* Form fields */}
      <TextInput
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
