/**
 * PartyHeader Component
 * Sticky header with back button, party name/status, and countdown badge
 */

import React from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Text } from '@/components/ui';
import { colors, fonts } from '@/constants/theme';
import type { PartyHeaderProps } from '../types';

export const PartyHeader = React.memo(function PartyHeader({
  party,
  countdownDays,
  onBack,
}: PartyHeaderProps) {
  return (
    <View style={styles.header}>
      <Pressable
        style={({ pressed }) => [styles.backButton, pressed && { opacity: 0.7 }]}
        onPress={onBack}
      >
        <Ionicons name="chevron-back" size={20} color={colors.charcoal} />
      </Pressable>

      <View style={styles.headerTitleSection}>
        <Text style={styles.headerLabel}>
          Swap Zone · {party.status === 'active' ? 'En cours' : 'À venir'}
        </Text>
        <Text style={styles.headerTitle}>{party.name}</Text>
      </View>

      {countdownDays !== null && (
        <View style={styles.countdownBadge}>
          <Text style={styles.badgeText}>J-{countdownDays}</Text>
        </View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 14,
    backgroundColor: 'rgba(245, 240, 232, 0.95)',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: 12,
  },
  backButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.borderStrong,
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
    color: colors.sage,
    marginBottom: 1,
  },
  headerTitle: {
    fontFamily: fonts.display,
    fontSize: 18,
    fontWeight: '300',
    color: colors.charcoal,
  },
  countdownBadge: {
    backgroundColor: 'rgba(122, 140, 110, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(122, 140, 110, 0.2)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  badgeText: {
    fontSize: 9,
    fontFamily: fonts.sansMedium,
    letterSpacing: 0.9,
    textTransform: 'uppercase',
    color: colors.sage,
  },
});
