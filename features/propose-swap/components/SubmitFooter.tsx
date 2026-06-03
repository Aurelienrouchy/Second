/**
 * SubmitFooter — Sticky bottom CTA for submitting the swap proposal.
 */

import React from 'react';
import { View, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { Text } from '@/components/ui';
import { colors, fonts, spacing } from '@/constants/theme';

type SubmitFooterProps = {
  isSubmitting: boolean;
  isDisabled: boolean;
  onSubmit: () => void;
};

export const SubmitFooter = React.memo(function SubmitFooter({
  isSubmitting,
  isDisabled,
  onSubmit,
}: SubmitFooterProps) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
      <Pressable
        style={({ pressed }) => [
          styles.submitButton,
          (isDisabled || isSubmitting) && styles.submitButtonDisabled,
          pressed && styles.pressed,
        ]}
        onPress={onSubmit}
        disabled={isDisabled || isSubmitting}
      >
        {isSubmitting ? (
          <ActivityIndicator size="small" color={colors.cream} />
        ) : (
          <>
            <Ionicons
              name="swap-horizontal"
              size={16}
              color={colors.cream}
              style={styles.submitButtonIcon}
            />
            <Text style={styles.submitButtonText}>Envoyer la proposition</Text>
          </>
        )}
      </Pressable>
    </View>
  );
});

const styles = StyleSheet.create({
  footer: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 32,
    backgroundColor: colors.cream,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  submitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 8,
    backgroundColor: colors.charcoal,
  },
  submitButtonIcon: {
    marginRight: 4,
  },
  submitButtonDisabled: {
    backgroundColor: colors.muted,
    opacity: 0.5,
  },
  submitButtonText: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    fontWeight: '500',
    lineHeight: 14,
    letterSpacing: 2.16,
    textTransform: 'uppercase',
    color: colors.cream,
  },
  pressed: {
    opacity: 0.7,
  },
});
