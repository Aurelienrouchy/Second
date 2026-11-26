import React from 'react';
import { Pressable, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Text } from '@/components/ui';
import {
  colors,
  components,
  sizing,
  spacing,
  typography,
} from '@/constants/theme';

interface TrocFilterRowProps {
  chips: readonly {
    key: string;
    label: string;
    active: boolean;
    onPress: () => void;
  }[];
}
export function TrocFilterRow({ chips }: TrocFilterRowProps) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
    >
      {chips.map(({ key, label, active, onPress }) => (
        <Pressable
          key={key}
          testID={`filter-chip-${key}`}
          accessibilityRole="button"
          accessibilityState={{ selected: active }}
          accessibilityLabel={label}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            onPress();
          }}
          style={({ pressed }) => [
            styles.chip,
            active && styles.active,
            pressed && styles.pressed,
          ]}
        >
          <Text style={[styles.label, active && styles.activeLabel]}>
            {label}
          </Text>
          <Ionicons
            name="chevron-down"
            size={sizing.iconSM}
            color={active ? colors.white : colors.foreground}
          />
        </Pressable>
      ))}
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  row: {
    gap: spacing.sm,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.md,
  },
  chip: {
    minHeight: sizing.minTouchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surfaceWarm,
  },
  active: { backgroundColor: colors.primaryDark },
  label: { ...typography.caption, color: colors.foreground },
  activeLabel: { color: colors.white },
  pressed: { opacity: components.troc.pressedOpacity },
});
