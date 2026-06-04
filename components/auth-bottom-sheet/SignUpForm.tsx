/**
 * SignUpForm — display-name / email / password fields + create-account CTA.
 *
 * Scope (post-split): credentials ONLY. The age gate (DOB) + consent checkboxes
 * + the @pseudo choice moved to the mandatory full-screen route
 * app/complete-profile.tsx, reached right after the account is created. So this
 * form just validates the three credential fields and submits.
 *
 * NOTE on naming (audit B8): the field below is the public DISPLAY NAME
 * (placeholder "Nom d'affichage", autoCapitalize:words, freely editable later).
 * It is NOT the @pseudo/handle (that is chosen on the consent route and is
 * immutable). Hence `displayName`, not `username`.
 *
 * Fields only: the title, social buttons, divider and the signIn/signUp toggle
 * are rendered ONCE by AuthBottomSheet (shared chrome), so switching modes only
 * re-animates these fields — never the chrome.
 */

import { BottomSheetTextInput } from '@gorhom/bottom-sheet';
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { COPY_USERNAME } from '@/constants/authMessages';
import { colors } from '@/constants/theme';

import { styles } from './styles';

export interface SignUpFormProps {
  email: string;
  password: string;
  displayName: string;
  isLoading: boolean;
  onChangeEmail: (value: string) => void;
  onChangePassword: (value: string) => void;
  onChangeDisplayName: (value: string) => void;
  onSubmit: () => void;
}

function SignUpFormComponent({
  email,
  password,
  displayName,
  isLoading,
  onChangeEmail,
  onChangePassword,
  onChangeDisplayName,
  onSubmit,
}: SignUpFormProps) {
  const [touched, setTouched] = useState({
    displayName: false,
    email: false,
    password: false,
  });

  const handleBlur = useCallback(
    (field: 'displayName' | 'email' | 'password') => {
      setTouched((prev) => ({ ...prev, [field]: true }));
    },
    [],
  );

  const displayNameInvalid =
    touched.displayName && displayName.trim().length < 3;
  const emailInvalid =
    touched.email && (!email.includes('@') || !email.includes('.'));
  const passwordInvalid = touched.password && password.length < 6;

  const submitDisabled =
    !email.trim() ||
    !password.trim() ||
    !displayName.trim() ||
    isLoading;

  return (
    <View>
      <BottomSheetTextInput
        testID="signup-displayname-input"
        style={styles.input}
        placeholder="Nom d'affichage"
        placeholderTextColor={colors.muted}
        value={displayName}
        onChangeText={onChangeDisplayName}
        onBlur={() => handleBlur('displayName')}
        autoCapitalize="words"
        accessibilityLabel="Nom d'affichage"
      />
      {displayNameInvalid ? (
        <Text style={styles.fieldError}>3 caractères minimum</Text>
      ) : (
        <Text style={styles.fieldHint}>{COPY_USERNAME.displayNameHint}</Text>
      )}

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
          <Text style={styles.primaryButtonText}>{"S'INSCRIRE"}</Text>
        )}
      </Pressable>
    </View>
  );
}

export const SignUpForm = React.memo(SignUpFormComponent);
