/**
 * Settings Layout
 * All screens use the custom ScreenHeader component (headerShown: false).
 */

import { Redirect, Stack, usePathname } from 'expo-router';
import React from 'react';
import { useAuthenticatedUid, useUser } from '@/hooks/useAuth';
import { captureTradeSession } from '@/services/tradeOperation';

export default function SettingsLayout() {
  const user = useUser();
  const uid = useAuthenticatedUid();
  const pathname = usePathname();
  const publicHelp = pathname === '/settings/help' || pathname === '/settings/account-access' || pathname === '/settings/account-control';
  const servicingPath = ['/settings', '/settings/eligibility', '/settings/decisions', '/settings/privacy', '/settings/account-security', '/settings/account-control',
    '/settings/stripe-onboarding', '/settings/bank-account', '/settings/notifications', '/settings/export-data', '/settings/tax', '/settings/erase-account'].includes(pathname) ||
    pathname === '/settings/support' || /^\/settings\/support\/[^/]+$/.test(pathname);
  let servicingSession = false;
  try { if (uid && servicingPath) { captureTradeSession(uid); servicingSession = true; } } catch { /* A cached UID grants no access. */ }

  if (!user && !publicHelp && !servicingSession) {
    return <Redirect href="/(tabs)/profile" />;
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        presentation: 'card',
      }}
    />
  );
}
