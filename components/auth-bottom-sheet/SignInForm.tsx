/**
 * SignInForm — email/password sign-in (also exposes social auth + tab toggle).
 */

import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';

import { colors } from '@/constants/theme';

import { styles } from './styles';

export interface SignInFormProps {
  email: string;
  password: string;
  isLoading: boolean;
  message?: string;
  onChangeEmail: (value: string) => void;
  onChangePassword: (value: string) => void;
  onSubmit: () => void;
  onSwitchToSignUp: () => void;
  onForgotPassword: () => void;
  onSocialAuth: (provider: 'Google' | 'Apple') => void;
}

function SignInFormComponent({
  email,
  password,
  isLoading,
  message,
  onChangeEmail,
  onChangePassword,
  onSubmit,
  onSwitchToSignUp,
  onForgotPassword,
  onSocialAuth,
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
    <>
      <Text style={styles.title}>Content de</Text>
      <Text style={styles.subtitle}>te revoir</Text>
      {message ? <Text style={styles.message}>{message}</Text> : null}

      {/* Social auth */}
      <Pressable
        style={styles.appleButton}
        onPress={() => onSocialAuth('Apple')}
        disabled={isLoading}
        accessibilityLabel="Se connecter avec Apple"
        accessibilityRole="button"
      >
        <Ionicons name="logo-apple" size={20} color={colors.white} />
        <Text style={styles.appleButtonText}>Continuer avec Apple</Text>
      </Pressable>

      <Pressable
        style={styles.socialButton}
        onPress={() => onSocialAuth('Google')}
        disabled={isLoading}
        accessibilityLabel="Se connecter avec Google"
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
        <Pressable style={[styles.toggleTab, styles.toggleTabActive]}>
          <Text style={[styles.toggleTabText, styles.toggleTabTextActive]}>
            Se connecter
          </Text>
        </Pressable>
        <Pressable style={styles.toggleTab} onPress={onSwitchToSignUp}>
          <Text style={styles.toggleTabText}>S'inscrire</Text>
        </Pressable>
      </View>

      {/* Form fields */}
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

      <Pressable
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

      <Pressable style={styles.linkButton} onPress={onForgotPassword} accessibilityLabel="Mot de passe oublié" accessibilityRole="link">
        <Text style={styles.linkButtonText}>Mot de passe oublié ?</Text>
      </Pressable>
    </>
  );
}

export const SignInForm = React.memo(SignInFormComponent);
