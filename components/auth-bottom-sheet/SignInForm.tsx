/**
 * SignInForm — email/password fields + sign-in CTA + « Mot de passe oublié ».
 *
 * Fields only: the title, social buttons, divider and the signIn/signUp toggle
 * are rendered ONCE by AuthBottomSheet (shared chrome), so switching modes only
 * re-animates these fields — never the chrome.
 */

import { BottomSheetTextInput } from '@gorhom/bottom-sheet';
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { colors } from '@/constants/theme';
import { track } from '@/lib/analytics';

import { styles } from './styles';

export interface SignInFormProps {
  email: string;
  password: string;
  isLoading: boolean;
  onChangeEmail: (value: string) => void;
  onChangePassword: (value: string) => void;
  onSubmit: () => void;
  onForgotPassword: () => void;
}

function SignInFormComponent({
  email,
  password,
  isLoading,
  onChangeEmail,
  onChangePassword,
  onSubmit,
  onForgotPassword,
}: SignInFormProps) {
  const [touched, setTouched] = useState({
    email: false,
    password: false,
  });

  const handleBlur = useCallback((field: 'email' | 'password') => {
    setTouched((prev) => ({ ...prev, [field]: true }));
  }, []);

  const emailInvalid =
    touched.email && (!email.includes('@') || !email.includes('.'));
  const passwordInvalid = touched.password && password.length < 6;

  const submitDisabled = !email.trim() || !password.trim() || isLoading;

  return (
    <View>
      <BottomSheetTextInput
        testID="signin-email-input"
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
        testID="signin-password-input"
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

      <Pressable
        testID="signin-submit"
        style={[styles.primaryButton, submitDisabled && styles.disabledButton]}
        onPress={onSubmit}
        disabled={submitDisabled}
        accessibilityLabel="Se connecter"
        accessibilityRole="button"
      >
        {isLoading ? (
          <ActivityIndicator color={colors.white} />
        ) : (
          <Text style={styles.primaryButtonText}>SE CONNECTER</Text>
        )}
      </Pressable>

      <Pressable
        testID="signin-forgot-password"
        style={styles.linkButton}
        onPress={onForgotPassword}
        accessibilityLabel="Mot de passe oublié"
        accessibilityRole="link"
      >
        <Text style={styles.linkButtonText}>Mot de passe oublié ?</Text>
      </Pressable>
    </View>
  );
}

export const SignInForm = React.memo(SignInFormComponent);
