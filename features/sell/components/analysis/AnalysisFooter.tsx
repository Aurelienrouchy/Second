import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, components, sizing, spacing, typography } from '@/constants/theme';
import { PHOTO_GRID_GUTTER } from '../../utils/photosReview';
import { Button } from '@/components/ui/Button';

type ScreenState = 'loading' | 'complete' | 'error';

interface AnalysisFooterProps {
  screenState: ScreenState;
  bottomInset: number;
  onContinue: () => void;
  onRetry: () => void;
  onManualEntry: () => void;
  /** The model succeeded; only local saving/opening needs to be retried. */
  handoffError?: boolean;
  /** Qualified details are being saved/opened; no intermediate action is required. */
  opening?: boolean;
  disabled?: boolean;
  /** False when retrying would fail again (quota reached): manual entry only. */
  canRetry?: boolean;
}

export const AnalysisFooter = React.memo(function AnalysisFooter({
  screenState,
  bottomInset,
  onContinue,
  onRetry,
  onManualEntry,
  handoffError = false,
  opening = false,
  disabled = false,
  canRetry = true,
}: AnalysisFooterProps) {
  return (
    <View style={[styles.footer, { paddingBottom: bottomInset + spacing.md }]}>
      {screenState === 'complete' && !opening && (
        <>
          {handoffError && <Text style={styles.handoffMessage}>Les détails sont prêts. Réessayez pour les ouvrir.</Text>}
          <Button variant="primary" size="default" fullWidth onPress={onContinue} disabled={disabled}
            testID="sell-photos-review-continue"
            rightIcon={<Ionicons name="arrow-forward" size={sizing.iconSM} color={colors.foreground} />}>
            {handoffError ? 'Réessayer' : 'Voir les détails'}
          </Button>
          {!handoffError && <Pressable style={styles.manualLink} onPress={onRetry} disabled={disabled} testID="sell-analysis-relaunch">
            <Text style={styles.manualLinkText}>Relancer l&apos;analyse</Text>
          </Pressable>}
        </>
      )}

      {screenState === 'error' && (
        <>
          {canRetry && (
            <Pressable
              testID="sell-analysis-retry"
              style={({ pressed }) => [
                styles.primaryButton,
                pressed && { opacity: 0.7 },
              ]}
              onPress={onRetry}
            >
              <Ionicons name="refresh-outline" size={18} color={colors.foreground} />
              <Text style={styles.primaryButtonText}>RÉESSAYER</Text>
            </Pressable>
          )}
          <Pressable
            testID="sell-analysis-manual"
            style={({ pressed }) => [
              styles.manualLink,
              pressed && { opacity: 0.7 },
            ]}
            onPress={onManualEntry}
          >
            <Text style={styles.manualLinkText}>Remplir manuellement</Text>
          </Pressable>
        </>
      )}

      {screenState === 'loading' && (
        <Pressable
          testID="sell-analysis-manual"
          style={({ pressed }) => [
            styles.manualLink,
            pressed && { opacity: 0.7 },
          ]}
          onPress={onManualEntry}
        >
          <Text style={styles.manualLinkText}>
            Remplir manuellement
          </Text>
        </Pressable>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  footer: {
    backgroundColor: colors.cream,
    paddingTop: spacing.md,
    paddingHorizontal: PHOTO_GRID_GUTTER,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  primaryButton: {
    ...components.button.container,
    ...components.button.primary,
  },
  primaryButtonText: {
    ...components.button.label,
    ...components.button.primaryLabel,
  },
  handoffMessage: {
    ...typography.caption,
    color: colors.muted,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  manualLink: {
    minHeight: sizing.minTouchTarget,
    paddingVertical: spacing.sm,
    justifyContent: 'center',
    alignItems: 'center',
  },
  manualLinkText: {
    ...typography.caption,
    color: colors.muted,
  },
});
