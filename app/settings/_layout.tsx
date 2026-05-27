/**
 * Settings Layout
 * All screens use the custom ScreenHeader component (headerShown: false).
 */

import { Redirect, Stack } from 'expo-router';
import React from 'react';
import { useUser } from '@/contexts/AuthContext';

export default function SettingsLayout() {
  const user = useUser();

  if (!user) {
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
