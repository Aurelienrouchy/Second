/**
 * SubmitFooter — Sticky bottom CTA for submitting the swap proposal.
 */

import React from 'react';
import { View, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { Text } from '@/components/ui';
import { colors, fonts, spacing, radius, sizing } from '@/constants/theme';

type SubmitFooterProps = {
  isSubmitting: boolean;
  isDisabled: boolean;
  onSubmit: () => void;
  isSent?: boolean;
  onViewSwaps?: () => void;
  disabledReason?: string;
};

export const SubmitFooter = React.memo(function SubmitFooter({
  isSubmitting,
  isDisabled,
  onSubmit,
  isSent = false,
  onViewSwaps,
  disabledReason,
}: SubmitFooterProps) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
      {isDisabled && !isSent && (
        <Text style={styles.prerequisite}>{disabledReason || 'Choisissez au moins un article de chaque côté.'}</Text>
      )}
      <Pressable
        testID="propose-swap-submit"
        style={({ pressed }) => [
          styles.submitButton,
          ((!isSent && isDisabled) || isSubmitting) && styles.submitButtonDisabled,
          pressed && styles.pressed,
        ]}
        onPress={isSent ? onViewSwaps : onSubmit}
        disabled={(!isSent && isDisabled) || isSubmitting}
        accessibilityRole="button"
        accessibilityState={{ disabled: (!isSent && isDisabled) || isSubmitting, busy: isSubmitting }}
      >
        {isSubmitting ? (
          <>
            <ActivityIndicator size="small" color={colors.cream} />
            <Text style={styles.submitButtonText}>Envoi…</Text>
          </>
        ) : (
          <>
            <Ionicons
              name="swap-horizontal"
              size={16}
              color={colors.cream}
              style={styles.submitButtonIcon}
            />
            <Text style={styles.submitButtonText}>{isSent ? 'Voir mes échanges' : 'Envoyer la proposition'}</Text>
          </>
        )}
      </Pressable>
    </View>
  );
});

const styles = StyleSheet.create({
  footer: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    backgroundColor: colors.background,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  prerequisite: {
    fontFamily: fonts.sans,
    fontSize: 12,
    lineHeight: 18,
    color: colors.foregroundSecondary,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  submitButton: {
    minHeight: sizing.buttonHeight,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius.xl,
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
    fontSize: 14,
    lineHeight: 20,
    flexShrink: 1,
    textAlign: 'center',
    color: colors.cream,
  },
  pressed: {
    opacity: 0.7,
  },
});
