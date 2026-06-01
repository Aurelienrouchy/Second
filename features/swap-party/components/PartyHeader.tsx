/**
 * PartyHeader Component — Swap Zone (DARK identity)
 * Sticky header with back button and zone name. The Swap Zone is always active
 * and open to everyone. Standard centered title (dark variant) — no eyebrow,
 * no status label, no countdown badge.
 */

import React from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Text } from '@/components/ui';
import { colors, spacing, radius, sizing, typography } from '@/constants/theme';
import type { PartyHeaderProps } from '../types';

export const PartyHeader = React.memo(function PartyHeader({
  party,
  onBack,
}: PartyHeaderProps) {
  return (
    <View style={styles.header}>
      <Pressable
        style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
        onPress={onBack}
        hitSlop={8}
      >
        <Ionicons name="chevron-back" size={sizing.iconMD} color={colors.cream} />
      </Pressable>

      <Text style={styles.headerTitle}>{party.name}</Text>

      <View style={styles.rightSpacer} />
    </View>
  );
});

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.deep,
    borderBottomWidth: 1,
    borderBottomColor: colors.darkBorderStrong,
  },
  pressed: {
    opacity: 0.7,
  },
  backButton: {
    width: sizing.avatarSM,
    height: sizing.avatarSM,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.whiteTranslucent,
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  headerTitle: {
    flex: 1,
    fontFamily: fonts.display,
    fontSize: 20,
    color: colors.cream,
    textAlign: 'center',
  },
  rightSpacer: {
    width: sizing.avatarSM,
  },
});
