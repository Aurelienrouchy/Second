/**
 * Checkbox — Seconde UI Kit
 *
 * Sober, DS-driven checkbox. The label is passed as `children` so callers can
 * embed inline links (e.g. "J'accepte les <Link>Conditions</Link>").
 */

import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { colors, radius, spacing } from '@/constants/theme';

export interface CheckboxProps {
  checked: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  disabled?: boolean;
  accessibilityLabel?: string;
  testID?: string;
}

function CheckboxComponent({
  checked,
  onToggle,
  children,
  disabled = false,
  accessibilityLabel,
  testID,
}: CheckboxProps) {
  return (
    <Pressable
      style={styles.row}
      onPress={onToggle}
      disabled={disabled}
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled }}
      accessibilityLabel={accessibilityLabel}
      hitSlop={spacing.sm}
      testID={testID}
    >
      <View style={[styles.box, checked && styles.boxChecked]}>
        {checked ? (
          <Ionicons name="checkmark" size={14} color={colors.white} />
        ) : null}
      </View>
      <View style={styles.labelWrap}>{children}</View>
    </Pressable>
  );
}

export const Checkbox = React.memo(CheckboxComponent);

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  box: {
    width: 20,
    height: 20,
    borderRadius: radius.xs,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 1,
  },
  boxChecked: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  labelWrap: {
    flex: 1,
  },
});
