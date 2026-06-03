/**
 * GuestState — unauthenticated profile view with connect CTA.
 * Extracted from profile screen.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { Avatar } from '@/components/ui';
import { colors, radius, spacing, typography } from '@/constants/theme';

// =============================================================================
// TYPES
// =============================================================================

interface GuestStateProps {
  onConnect: () => void;
}

// =============================================================================
// GUEST STATE
// =============================================================================

const GuestState = React.memo(function GuestState({
  onConnect,
}: GuestStateProps) {
  return (
    <Animated.View
      entering={FadeInDown.duration(400).delay(100)}
      style={styles.guestState}
    >
      <View style={styles.guestAvatarContainer}>
        <Avatar size="xxl" name="" />
      </View>
      <Text style={styles.guestTitle}>Pas encore connecté</Text>
      <Text style={styles.guestSubtitle}>
        Connectez-vous pour accéder à toutes les fonctionnalités
      </Text>
      <Pressable
        testID="profile-guest-connect"
        style={styles.connectButton}
        onPress={onConnect}
      >
        <Text style={styles.connectButtonText}>SE CONNECTER</Text>
      </Pressable>
    </Animated.View>
  );
});

export { GuestState };

// =============================================================================
// STYLES
// =============================================================================

const styles = StyleSheet.create({
  guestState: {
    alignItems: 'center',
    paddingVertical: spacing.lg,
  },
  guestAvatarContainer: {
    marginBottom: spacing.md,
  },
  guestTitle: {
    ...typography.h3,
    color: colors.charcoal,
    marginBottom: spacing.sm,
  },
  guestSubtitle: {
    ...typography.body,
    color: colors.muted,
    textAlign: 'center',
    marginBottom: spacing.lg,
    paddingHorizontal: spacing.lg,
  },
  connectButton: {
    backgroundColor: colors.charcoal,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.sm,
    minWidth: 200,
    alignItems: 'center',
  },
  connectButtonText: {
    ...typography.labelUppercase,
    color: colors.cream,
    textTransform: 'uppercase',
  },
});
