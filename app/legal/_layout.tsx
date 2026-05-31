/**
 * Legal Layout — PUBLIC routes (no auth guard).
 *
 * Unlike app/settings/_layout.tsx (which redirects unauthenticated users), these
 * routes are reachable WITHOUT being signed in so the Terms and Privacy Policy
 * are accessible and readable at the moment of consent, before any box is
 * checked (Loi 25 art. 12). Same custom ScreenHeader pattern as settings.
 */

import { Stack } from 'expo-router';
import React from 'react';

export default function LegalLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        presentation: 'card',
      }}
    />
  );
}
