/**
 * SignUpForm — username/email/password sign-up (also exposes social auth + tab toggle).
 */

import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';

import { colors } from '@/constants/theme';

import { styles } from './styles';

export interface SignUpFormProps {
  email: string;
  password: string;
  username: string;
  isLoading: boolean;
  message?: string;
  onChangeEmail: (value: string) => void;
  onChangePassword: (value: string) => void;
  onChangeUsername: (value: string) => void;
  onSubmit: () => void;
  onSwitchToSignIn: () => void;
  onSocialAuth: (provider: 'Google' | 'Apple') => void;
}

function SignUpFormComponent({
  email,
  password,
  username,
  isLoading,
  message,
  onChangeEmail,
  onChangePassword,
  onChangeUsername,
  onSubmit,
  onSwitchToSignIn,
  onSocialAuth,
}: SignUpFormProps) {
  const submitDisabled =
    !email.trim() || !password.trim() || !username.trim() || isLoading;

  return (
    <>
      <Text style={styles.title}>Bienvenue sur</Text>
      <Text style={styles.subtitle}>Seconde</Text>
      <Text style={styles.message}>{message}</Text>

      {/* Social auth */}
      <Pressable
        style={styles.appleButton}
        onPress={() => onSocialAuth('Apple')}
        disabled={isLoading}
      >
        <Ionicons name="logo-apple" size={20} color={colors.white} />
        <Text style={styles.appleButtonText}>Continuer avec Apple</Text>
      </Pressable>

      <Pressable
        style={styles.socialButton}
        onPress={() => onSocialAuth('Google')}
        disabled={isLoading}
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
        autoCapitalize="none"
      />
      <TextInput
        style={styles.input}
        placeholder="Email"
        placeholderTextColor={colors.muted}
        value={email}
        onChangeText={onChangeEmail}
        keyboardType="email-address"
        autoCapitalize="none"
      />
      <TextInput
        style={styles.input}
        placeholder="Mot de passe"
        placeholderTextColor={colors.muted}
        value={password}
        onChangeText={onChangePassword}
        secureTextEntry
      />

      <Pressable
        style={[styles.primaryButton, submitDisabled && styles.disabledButton]}
        onPress={onSubmit}
        disabled={submitDisabled}
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
