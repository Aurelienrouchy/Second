/**
 * GuestState — unauthenticated profile view with connect CTA.
 * Extracted from profile screen.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { Avatar } from '@/components/ui';
import { colors, fonts, radius, spacing } from '@/constants/theme';

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
      <Pressable style={styles.connectButton} onPress={onConnect}>
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
    fontFamily: fonts.displayMedium,
    fontSize: 20,
    lineHeight: 26,
    color: colors.charcoal,
    marginBottom: spacing.sm,
  },
  guestSubtitle: {
    fontFamily: fonts.sans,
    fontSize: 14,
    lineHeight: 20,
    color: colors.muted,
    textAlign: 'center',
    marginBottom: spacing.lg,
    paddingHorizontal: spacing.lg,
  },
  connectButton: {
    backgroundColor: colors.charcoal,
    paddingHorizontal: spacing.xl,
    paddingVertical: 14,
    borderRadius: radius.sm,
    minWidth: 200,
    alignItems: 'center',
  },
  connectButtonText: {
    fontFamily: fonts.sansMedium,
    fontSize: 11,
    lineHeight: 15,
    letterSpacing: 2.16,
    color: colors.cream,
    textTransform: 'uppercase',
  },
});
