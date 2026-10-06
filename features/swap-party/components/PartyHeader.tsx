import React from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Text } from '@/components/ui';
import { colors, spacing, radius, sizing, typography } from '@/constants/theme';
import type { PartyHeaderProps } from '../types';

export const PartyHeader = React.memo(function PartyHeader({ onBack }: PartyHeaderProps) {
  return (
    <View style={styles.header}>
      <Pressable accessibilityRole="button" accessibilityLabel="Retour" style={({ pressed }) => [styles.backButton, pressed && styles.pressed]} onPress={onBack}>
        <Ionicons name="chevron-back" size={sizing.iconMD} color={colors.cream} />
      </Pressable>
      <Text style={styles.headerTitle} accessibilityRole="header">Espace échanges</Text>
      <View style={styles.rightSpacer} />
    </View>
  );
});

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, backgroundColor: colors.deep, borderBottomWidth: 1, borderBottomColor: colors.darkBorder },
  pressed: { opacity: 0.7 },
  backButton: { width: sizing.minTouchTarget, height: sizing.minTouchTarget, borderRadius: radius.full, backgroundColor: colors.darkSurface1, justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  headerTitle: { ...typography.h2, flex: 1, color: colors.cream, textAlign: 'center' },
  rightSpacer: { width: sizing.minTouchTarget },
});
