/**
 * ProposeSwapTopBar — Sticky header with back button and title.
 */

import React from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Text } from '@/components/ui';
import { colors, fonts, spacing, radius, sizing } from '@/constants/theme';

interface ProposeSwapTopBarProps {
  onBack?: () => void;
  disabled?: boolean;
}

export const ProposeSwapTopBar = React.memo(function ProposeSwapTopBar({
  onBack,
  disabled = false,
}: ProposeSwapTopBarProps) {
  return (
    <View style={styles.topBar}>
      <Pressable
        style={styles.backButton}
        onPress={onBack ?? (() => router.back())}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel="Revenir à l’écran précédent"
        accessibilityState={{ disabled }}
      >
        <Ionicons name="chevron-back" size={20} color={colors.charcoal} />
      </Pressable>
      <View style={styles.heading}>
        <Text style={styles.eyebrow}>Espace échanges</Text>
        <Text style={styles.title} accessibilityRole="header">Proposer un échange</Text>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    backgroundColor: colors.background,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backButton: {
    width: sizing.minTouchTarget,
    height: sizing.minTouchTarget,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    justifyContent: 'center',
    alignItems: 'center',
  },
  heading: { flex: 1, gap: spacing.xs },
  eyebrow: {
    fontFamily: fonts.sansMedium,
    fontSize: 11,
    lineHeight: 16,
    color: colors.primary,
  },
  title: {
    fontFamily: fonts.displayMedium,
    fontSize: 26,
    lineHeight: 30,
    color: colors.charcoal,
    flex: 1,
  },
});
