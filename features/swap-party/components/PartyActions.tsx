/**
 * PartyActions Component
 * Join/Leave buttons for a swap party
 */

import React from 'react';
import { View, StyleSheet, Pressable, ActivityIndicator } from 'react-native';

import { Text } from '@/components/ui';
import { colors, fonts, spacing } from '@/constants/theme';
import type { PartyActionsProps } from '../types';

export const PartyActions = React.memo(function PartyActions({
  isJoined,
  isJoining,
  onJoin,
  onLeave,
}: PartyActionsProps) {
  // Swap Zone is always active — no 'ended' state to guard against.
  if (!isJoined) {
    return (
      <View style={styles.actionSection}>
        <Pressable
          style={({ pressed }) => [styles.joinButton, pressed && { opacity: 0.7 }]}
          onPress={onJoin}
          disabled={isJoining}
        >
          {isJoining ? (
            <ActivityIndicator size="small" color={colors.white} />
          ) : (
            <Text style={styles.joinButtonText}>Rejoindre la Swap Zone</Text>
          )}
        </Pressable>
      </View>
    );
  }

  return (
    <Pressable
      style={({ pressed }) => [styles.leaveButton, pressed && { opacity: 0.7 }]}
      onPress={onLeave}
    >
      <Text style={styles.leaveButtonText}>Quitter la Swap Zone</Text>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  actionSection: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
  },
  joinButton: {
    backgroundColor: colors.sage,
    paddingVertical: 14,
    paddingHorizontal: spacing.lg,
    borderRadius: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  joinButtonText: {
    fontSize: 12,
    fontFamily: fonts.sansMedium,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: colors.white,
  },
  leaveButton: {
    marginHorizontal: spacing.lg,
    marginVertical: spacing.lg,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  leaveButtonText: {
    fontSize: 12,
    fontFamily: fonts.sansMedium,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: colors.danger,
  },
});
