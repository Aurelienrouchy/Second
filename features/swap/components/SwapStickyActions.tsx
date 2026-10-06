import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '@/components/ui';
import { colors, fonts, spacing, sizing, radius } from '@/constants/theme';

interface SwapStickyActionsProps { onAccept: () => void; onDecline: () => void; isProcessing: boolean; }
export const SwapStickyActions = React.memo(function SwapStickyActions({ onAccept, onDecline, isProcessing }: SwapStickyActionsProps) {
  return (
    <View style={styles.bar}>
      <Pressable style={({ pressed }) => [styles.accept, pressed && styles.pressed, isProcessing && styles.disabled]} onPress={onAccept} disabled={isProcessing} accessibilityRole="button" accessibilityLabel="Accepter la proposition" accessibilityState={{ disabled: isProcessing, busy: isProcessing }}>
        {isProcessing ? <ActivityIndicator size="small" color={colors.cream} /> : <Text style={styles.acceptText}>Accepter la proposition</Text>}
      </Pressable>
      <Pressable style={({ pressed }) => [styles.decline, pressed && styles.pressed, isProcessing && styles.disabled]} onPress={onDecline} disabled={isProcessing} accessibilityRole="button" accessibilityLabel="Refuser la proposition" accessibilityState={{ disabled: isProcessing }}>
        <Text style={styles.declineText}>Refuser</Text>
      </Pressable>
    </View>
  );
});
const styles = StyleSheet.create({
  bar: { gap: spacing.sm, padding: spacing.md, backgroundColor: colors.surfaceWarm, borderTopWidth: 1, borderTopColor: colors.border },
  accept: { minHeight: sizing.buttonHeight, paddingVertical: spacing.md, paddingHorizontal: spacing.md, backgroundColor: colors.primary, borderRadius: radius.xl, alignItems: 'center', justifyContent: 'center' },
  acceptText: { fontFamily: fonts.sansMedium, fontSize: 14, lineHeight: 21, color: colors.cream, textAlign: 'center' },
  decline: { minHeight: sizing.minTouchTarget, padding: spacing.sm, alignItems: 'center', justifyContent: 'center', borderRadius: radius.xl, borderWidth: 1, borderColor: colors.borderStrong },
  declineText: { fontFamily: fonts.sansMedium, fontSize: 14, lineHeight: 21, color: colors.foreground },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.5 },
});
