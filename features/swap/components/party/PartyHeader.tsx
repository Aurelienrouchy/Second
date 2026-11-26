import React from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Text } from '@/components/ui';
import { colors, spacing, radius, sizing, typography } from '@/constants/theme';
import type { PartyHeaderProps } from '@/features/swap/types';

export const PartyHeader = React.memo(function PartyHeader({
  onBack,
  onMySwaps,
}: PartyHeaderProps) {
  return (
    <View style={styles.header}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Retour"
        style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
        onPress={onBack}
      >
        <Ionicons
          name="chevron-back"
          size={sizing.iconMD}
          color={colors.foreground}
        />
      </Pressable>
      {onMySwaps ? (
        <View style={styles.titleSpacer} />
      ) : (
        <Text style={styles.headerTitle} accessibilityRole="header">
          LE TROC
        </Text>
      )}
      {onMySwaps ? (
        <Pressable
          onPress={onMySwaps}
          style={styles.mySwaps}
          accessibilityRole="button"
        >
          <Text style={styles.mySwapsLabel}>Mes échanges</Text>
          <Ionicons
            name="arrow-forward"
            size={sizing.iconSM}
            color={colors.foreground}
          />
        </Pressable>
      ) : (
        <View style={styles.rightSpacer} />
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.background,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  pressed: { opacity: 0.7 },
  backButton: {
    width: sizing.minTouchTarget,
    height: sizing.minTouchTarget,
    borderRadius: radius.full,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  headerTitle: {
    ...typography.trocScreenTitle,
    flex: 1,
    color: colors.foreground,
    textAlign: 'left',
  },
  mySwaps: {
    minHeight: sizing.minTouchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexShrink: 1,
  },
  mySwapsLabel: { ...typography.bodySmall, color: colors.foreground },
  titleSpacer: { flex: 1 },
  rightSpacer: { width: sizing.minTouchTarget },
});
