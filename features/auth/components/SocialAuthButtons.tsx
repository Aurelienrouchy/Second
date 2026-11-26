/**
 * SocialAuthButtons — Apple + Google buttons, factored out of the sign-in /
 * sign-up forms so they mount ONCE and survive the signIn↔signUp switch (no
 * remount, no re-query of Apple availability).
 *
 * Owns the single `AppleAuthentication.isAvailableAsync()` effect: even on iOS
 * Apple can be unavailable (simulator without an account, iOS < 13), so the
 * Apple button only renders once availability is confirmed. When unavailable
 * (incl. non-iOS), nothing is shown in its place — only the Google button.
 */

import { Ionicons } from '@expo/vector-icons';
import * as AppleAuthentication from 'expo-apple-authentication';
import React, { useEffect, useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';

import { colors } from '@/constants/theme';

import { styles } from './styles';

export interface SocialAuthButtonsProps {
  isLoading: boolean;
  onSocialAuth: (provider: 'Google' | 'Apple') => void;
}

function SocialAuthButtonsComponent({
  isLoading,
  onSocialAuth,
}: SocialAuthButtonsProps) {
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

  return (
    <View>
      {appleAvailable ? (
        <Pressable
          testID="social-apple"
          style={styles.appleButton}
          onPress={() => onSocialAuth('Apple')}
          disabled={isLoading}
          accessibilityLabel="Continuer avec Apple"
          accessibilityRole="button"
        >
          <Ionicons name="logo-apple" size={20} color={colors.white} />
          <Text style={styles.appleButtonText}>Continuer avec Apple</Text>
        </Pressable>
      ) : null}

      <Pressable
        testID="social-google"
        style={styles.socialButton}
        onPress={() => onSocialAuth('Google')}
        disabled={isLoading}
        accessibilityLabel="Continuer avec Google"
        accessibilityRole="button"
      >
        <Ionicons name="logo-google" size={18} color={colors.foreground} />
        <Text style={styles.socialButtonText}>Continuer avec Google</Text>
      </Pressable>
    </View>
  );
}

export const SocialAuthButtons = React.memo(SocialAuthButtonsComponent);
