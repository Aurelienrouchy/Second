/**
 * PartyHeader Component — Swap Zone (DARK identity)
 * Sticky header with back button and zone name. The Swap Zone is always active
 * and open to everyone — no status label, no countdown badge.
 */

import React from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Text } from '@/components/ui';
import { colors, fonts, spacing, radius, sizing } from '@/constants/theme';
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
      >
        <Ionicons name="chevron-back" size={20} color={colors.cream} />
      </Pressable>

      <View style={styles.headerTitleSection}>
        <Text style={styles.headerLabel}>Swap Zone</Text>
        <Text style={styles.headerTitle}>{party.name}</Text>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md - 2,
    backgroundColor: colors.deep,
    borderBottomWidth: 1,
    borderBottomColor: colors.darkBorder,
    gap: spacing.md - 4,
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
  headerTitleSection: {
    flex: 1,
  },
  headerLabel: {
    fontSize: 9,
    fontFamily: fonts.sansMedium,
    letterSpacing: 1.35,
    textTransform: 'uppercase',
    color: colors.rust,
    marginBottom: 1,
  },
  headerTitle: {
    fontFamily: fonts.display,
    fontSize: 18,
    color: colors.cream,
  },
});
