import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Text } from '@/components/ui';
import { colors, spacing, typography } from '@/constants/theme';
type SubmitFooterProps = {isSubmitting: boolean; isDisabled: boolean; onSubmit: () => void; isSent?: boolean; onViewSwaps?: () => void; disabledReason?: string};
export const SubmitFooter = React.memo(function SubmitFooter({isSubmitting, isDisabled, onSubmit, isSent = false, onViewSwaps, disabledReason}: SubmitFooterProps) {
  const insets = useSafeAreaInsets();
  return <View style={[styles.footer, {paddingBottom: Math.max(insets.bottom, spacing.md)}]}>
    {isDisabled && !isSent && disabledReason ? <Text style={styles.prerequisite}>{disabledReason}</Text> : null}
    <Button testID="propose-swap-submit" loading={isSubmitting} disabled={!isSent && isDisabled} onPress={isSent ? onViewSwaps : onSubmit}>
      {isSent ? 'Voir mon échange' : 'Envoyer ma proposition'}
    </Button>
  </View>;
});
const styles = StyleSheet.create({footer: {paddingHorizontal: spacing.md, paddingTop: spacing.md, backgroundColor: colors.background, borderTopWidth: 1, borderTopColor: colors.border, gap: spacing.sm},
  prerequisite: {...typography.caption, color: colors.foregroundSecondary, textAlign: 'center'}});
