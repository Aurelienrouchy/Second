/**
 * Admin Section Layout — central auth + role guard.
 *
 * SECURITY: prevents privilege escalation via /admin/* routes. All admin
 * screens are gated here in addition to per-screen checks (defense in
 * depth). Firestore rules also independently enforce the admin custom
 * claim (request.auth.token.admin) for sensitive collections.
 */
import { useUser, useIsLoading } from '@/contexts/AuthContext';
import { colors } from '@/constants/theme';
import { UserService } from '@/services/userService';
import { Redirect, Slot } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

type GuardState = 'checking' | 'allowed' | 'denied';

export default function AdminLayout() {
  const user = useUser();
  const isAuthLoading = useIsLoading();
  const [state, setState] = useState<GuardState>('checking');

  useEffect(() => {
    let cancelled = false;

    if (isAuthLoading) {
      setState('checking');
      return;
    }

    if (!user) {
      setState('denied');
      return;
    }

    setState('checking');
    UserService.isUserAdmin(user.id)
      .then((isAdmin) => {
        if (cancelled) return;
        setState(isAdmin ? 'allowed' : 'denied');
      })
      .catch((error) => {
        console.error('[AdminLayout] admin check failed:', error);
        if (cancelled) return;
        setState('denied');
      });

    return () => {
      cancelled = true;
    };
  }, [user, isAuthLoading]);

  if (state === 'checking') {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (state === 'denied') {
    return <Redirect href="/(tabs)" />;
  }

  return <Slot />;
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
});
