import type {ComponentProps} from 'react';
import {ActivityIndicator, Pressable, StyleSheet, Text, View} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import {colors, sizing, spacing, typography} from '@/constants/theme';

export interface OrderOption {
  label: string;
  icon: ComponentProps<typeof Ionicons>['name'];
  onPress: () => void;
  loading?: boolean;
}

/** Presentation only: each row invokes its parent's already scoped action. */
export function OrderOptionsList({items}: {items: OrderOption[]}) {
  return <View>{items.map(item => <Pressable key={item.label} accessibilityRole="button" style={styles.row} disabled={item.loading} onPress={item.onPress}>
    <Ionicons name={item.icon} size={spacing.lg} color={colors.muted} /><Text style={styles.label}>{item.label}</Text>
    {item.loading ? <ActivityIndicator color={colors.muted} /> : <Ionicons name="chevron-forward" size={spacing.md} color={colors.muted} />}
  </Pressable>)}</View>;
}

const styles = StyleSheet.create({
  row: {flexDirection: 'row', gap: spacing.md, alignItems: 'center', minHeight: sizing.minTouchTarget, paddingVertical: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border},
  label: {...typography.body, color: colors.foreground, flex: 1},
});
