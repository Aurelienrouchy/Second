import React, {useCallback, useRef, useState} from 'react';
import {ActivityIndicator, Alert, Pressable, StyleSheet, View, useWindowDimensions} from 'react-native';
import {useLocalSearchParams} from 'expo-router';
import {Ionicons} from '@expo/vector-icons';
import {Text, Caption, Button} from '@/components/ui';
import {colors, spacing, radius, sizing, typography, components} from '@/constants/theme';
import {PAYMENTS_ENABLED} from '@/config/featureFlags';
import {track} from '@/lib/analytics';
import {openSwapDispute} from '@/services/swapService';
import {useAuthenticatedUid} from '@/hooks/useAuth';
import {useLabelLifecycleContext} from '@/hooks/useLabelLifecycleContext';
import type {SwapActionHandlers, SwapParticipantContext} from '../../types';
import type {SwapStatus} from '@/types';
interface SwapActionsProps {status: SwapStatus; participant: SwapParticipantContext; handlers: SwapActionHandlers; isProcessing: boolean; exchangeMode: string | undefined; sourceKey?: string; optionsOnly?: boolean; agreementReady?: boolean}
export const SwapActions = React.memo(function SwapActions({status, participant: p, handlers: h, isProcessing, exchangeMode, sourceKey, optionsOnly = false, agreementReady = true}: SwapActionsProps) {
  const active = ['accepted', 'photos_pending', 'shipping'].includes(status) && agreementReady;
  const handDelivery = exchangeMode === 'hand_delivery';
  const canReceive = active && !p.hasConfirmedReception && (handDelivery || status === 'shipping' && p.counterpartHasShipped === true);
  const canSend = agreementReady && status === 'shipping' && !handDelivery && !p.hasConfirmedShipping;
  if (optionsOnly) return <View style={styles.actionsSection}>
    {status === 'proposed' && p.isReceiver ? <Button variant="secondary" disabled={isProcessing} onPress={h.onDecline}>Refuser la proposition</Button> : null}
    {['proposed', 'payment_pending'].includes(status) && p.isInitiator ? <Button variant="danger" disabled={isProcessing} onPress={h.onCancel}>Annuler la proposition</Button> : null}
    {canSend && canReceive ? <Button variant="secondary" disabled={isProcessing} onPress={h.onConfirmShipping}>J’ai envoyé mes articles</Button> : null}
    {(active || status === 'completed') ? <DisputeButton disabled={isProcessing} status={status} sourceKey={sourceKey}/> : null}
  </View>;
  return <View style={styles.actionsSection}>
    {status === 'payment_pending' && PAYMENTS_ENABLED && p.isTopUpPayer ? <Button loading={isProcessing} onPress={h.onPayTopUp}>Régler le complément</Button> : null}
    {status === 'proposed' && p.isReceiver ? <Button loading={isProcessing} onPress={h.onAccept}>Accepter la proposition</Button> : null}
    {canReceive ? <Button loading={isProcessing} onPress={h.onConfirmReception}>J’ai reçu les articles</Button>
      : canSend ? <Button loading={isProcessing} onPress={h.onConfirmShipping}>J’ai envoyé mes articles</Button> : null}
    {agreementReady && status === 'photos_pending' && !handDelivery && !p.hasUploadedPhotos ? <Button loading={isProcessing} onPress={h.onUploadPhotos}>{p.hasSelectedPhotos ? 'Envoyer les photos' : 'Ajouter des photos'}</Button> : null}
    {status === 'completed' && !p.hasRated ? <RatingSection onRate={h.onRate} isProcessing={isProcessing}/> : null}
  </View>;
});

// ---------------------------------------------------------------------------
// Dispute button — self-contained: resolves the swapId from the route and
// calls the `openSwapDispute` callable with a predefined reason. Kept local
// so it does not need a new handler threaded through the screen.
// ---------------------------------------------------------------------------

interface DisputeButtonProps {
  disabled: boolean;
  status: SwapStatus;
  sourceKey?: string;
}

/** Predefined dispute reasons (the backend requires a non-empty reason). */
const DISPUTE_REASONS: readonly string[] = [
  "Je n'ai pas reçu l'article",
  "L'article ne correspond pas à la proposition",
  "L'article est endommagé",
  'Autre problème',
];

const DisputeButton = React.memo(function DisputeButton({
  disabled,
  status,
  sourceKey,
}: DisputeButtonProps) {
  const { fontScale } = useWindowDimensions();
  const { id: swapId } = useLocalSearchParams<{ id: string }>();
  const uid = useAuthenticatedUid();
  const context = useLabelLifecycleContext(JSON.stringify(['swap-dispute', swapId, sourceKey ?? null]), uid);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const dialogRef = useRef(false);

  const submitDispute = useCallback(
    async (reason: string, operation: ReturnType<typeof context.capture>) => {
      dialogRef.current = false;
      if (!swapId || submittingRef.current || !context.isCurrent(operation)) return;
      submittingRef.current = true;
      setIsSubmitting(true);
      try {
        await openSwapDispute(swapId, reason, {expectedUid: operation.base.session.uid, assertCurrent: () => context.assertCurrent(operation)});
        context.assertCurrent(operation);
        track('swap_dispute_opened', {
          swap_id: swapId,
          reason,
          status,
          outcome: 'success',
        });
        Alert.alert(
          'Litige ouvert',
          'Votre signalement a été enregistré. Les actions de l’échange sont suspendues pendant son examen.',
        );
      } catch (error) {
        // A successful status transition can unmount this button before its
        // callable returns. An obsolete surface must not announce a failure.
        if (!context.isCurrent(operation)) return;
        if (__DEV__) console.error('Error opening swap dispute:', error);
        track('swap_dispute_opened', {
          swap_id: swapId,
          reason,
          status,
          outcome: 'error',
        });
        Alert.alert(
          'Erreur',
          "Impossible d'ouvrir le litige. Veuillez réessayer plus tard.",
        );
      } finally {
        submittingRef.current = false;
        setIsSubmitting(false);
      }
    },
    [swapId, status, context],
  );

  const handlePress = useCallback(() => {
    if (disabled || submittingRef.current || dialogRef.current) return;
    let operation: ReturnType<typeof context.capture>;
    try { operation = context.capture(); } catch { return; }
    dialogRef.current = true;
    Alert.alert(
      'Ouvrir un litige',
      'Quel est le problème avec cet échange ?',
      [
        ...DISPUTE_REASONS.map((reason) => ({
          text: reason,
          onPress: () => submitDispute(reason, operation),
        })),
        {
          text: 'Annuler',
          style: 'cancel' as const,
          onPress: () => {
            dialogRef.current = false;
          },
        },
      ],
      {
        cancelable: true,
        onDismiss: () => {
          dialogRef.current = false;
        },
      },
    );
  }, [disabled, submitDispute, context]);

  return (
    <Pressable
      style={({ pressed }) => [styles.disputeButton, pressed && styles.pressed]}
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel="Ouvrir un litige"
      accessibilityState={{
        disabled: disabled || isSubmitting,
        busy: isSubmitting,
      }}
      disabled={disabled || isSubmitting}
    >
      {isSubmitting ? (
        <ActivityIndicator size="small" color={colors.rust} />
      ) : (
        <>
          <Ionicons name="alert-circle-outline" size={20} color={colors.rust} />
          <Text key={fontScale} variant="body" style={styles.disputeButtonText}>
            Ouvrir un litige
          </Text>
        </>
      )}
    </Pressable>
  );
});

// ---------------------------------------------------------------------------
// Sub-components (private, same file since they are tightly coupled to actions)
// ---------------------------------------------------------------------------

interface RatingSectionProps {
  onRate: (score: number) => void;
  isProcessing: boolean;
}

const RATING_SCORES = [1, 2, 3, 4, 5] as const;

const RatingSection = React.memo(function RatingSection({
  onRate,
  isProcessing,
}: RatingSectionProps) {
  const { fontScale } = useWindowDimensions();
  return (
    <View style={styles.ratingSection}>
      <Text key={fontScale} variant="h3" style={styles.sectionTitle}>
        {"Comment s'est passé l'échange ?"}
      </Text>
      <View style={styles.ratingButtons}>
        {RATING_SCORES.map((score) => (
          <Pressable
            key={score}
            style={({ pressed }) => [
              styles.ratingButton,
              pressed && styles.pressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel={`Évaluer l’échange : ${score} sur 5`}
            onPress={() => onRate(score)}
            disabled={isProcessing}
          >
            <Ionicons name="star" size={32} color={colors.primary} />
            <Caption key={`caption-${fontScale}`} style={styles.ratingScore}>
              {score}
            </Caption>
          </Pressable>
        ))}
      </View>
    </View>
  );
});

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  actionsSection: {padding: spacing.md, gap: spacing.md},
  pressed: {opacity: 0.7},
  waitingText: {...typography.bodySmall, color: colors.foregroundSecondary, textAlign: 'center'},
  disputeButton: {minHeight: sizing.minTouchTarget, padding: spacing.md, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.xs, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: spacing.sm},
  disputeButtonText: {...typography.bodySmall, color: colors.foreground},
  photosSection: {gap: spacing.md}, sectionTitle: {...typography.h3, color: colors.foreground},
  sectionDesc: {...typography.bodySmall, color: colors.foregroundSecondary},
  actionButton: {...components.button.primary, padding: spacing.md, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: spacing.sm},
  actionButtonText: {...components.button.primaryLabel},
  ratingSection: {gap: spacing.md}, ratingButtons: {flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm},
  ratingButton: {minWidth: sizing.minTouchTarget, minHeight: sizing.minTouchTarget, padding: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.xs, alignItems: 'center'},
  ratingScore: {...typography.caption, color: colors.foreground},
});
