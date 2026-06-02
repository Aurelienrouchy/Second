/**
 * SwapStickyActions
 * Sticky bottom bar with Accept / Decline buttons for proposed swaps.
 */

import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { Text } from '@/components/ui';
import { colors, fonts, spacing } from '@/constants/theme';

interface SwapStickyActionsProps {
  onAccept: () => void;
  onDecline: () => void;
  isProcessing: boolean;
}

export const SwapStickyActions = React.memo(function SwapStickyActions({
  onAccept,
  onDecline,
  isProcessing,
}: SwapStickyActionsProps) {
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[styles.stickyBottom, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}
    >
      <Pressable
        style={({ pressed }) => [styles.declineBtn, pressed && { opacity: 0.7 }]}
        onPress={onDecline}
        disabled={isProcessing}
      >
        {isProcessing ? (
          <ActivityIndicator size="small" color={colors.charcoal} />
        ) : (
          <Text style={styles.declineBtnText}>Refuser</Text>
        )}
      </Pressable>

      <Pressable
        style={({ pressed }) => [styles.acceptBtn, pressed && { opacity: 0.7 }]}
        onPress={onAccept}
        disabled={isProcessing}
      >
        {isProcessing ? (
          <ActivityIndicator size="small" color={colors.surface} />
        ) : (
          <>
            <Ionicons name="checkmark" size={18} color={colors.surface} />
            <Text style={styles.acceptBtnText}>Accepter le swap</Text>
          </>
        )}
      </Pressable>
    </View>
  );
});

const styles = StyleSheet.create({
  stickyBottom: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 24,
    paddingVertical: 16,
    paddingBottom: 32,
    backgroundColor: colors.cream,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  declineBtn: {
    flex: 1,
    paddingVertical: 15,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  declineBtnText: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    fontWeight: '500',
    letterSpacing: 0.12,
    textTransform: 'uppercase',
    color: colors.charcoal,
  },
  acceptBtn: {
    flex: 2,
    flexDirection: 'row',
    paddingVertical: 15,
    backgroundColor: colors.sage,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  acceptBtnText: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    fontWeight: '500',
    letterSpacing: 0.12,
    textTransform: 'uppercase',
    color: colors.surface,
  },
});
