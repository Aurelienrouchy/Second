/**
 * SwapActions
 * Renders the appropriate action UI based on the current swap status.
 * All callbacks are received via props from the screen.
 */

import React, { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Text, Caption } from '@/components/ui';
import { colors, fonts, spacing, radius, sizing } from '@/constants/theme';
import { PAYMENTS_ENABLED } from '@/config/featureFlags';
import { track } from '@/lib/analytics';
import { openSwapDispute } from '@/services/swapService';
import type { SwapActionHandlers, SwapParticipantContext } from '../types';
import type { SwapStatus } from '@/types';

interface SwapActionsProps {
  status: SwapStatus;
  participant: SwapParticipantContext;
  handlers: SwapActionHandlers;
  isProcessing: boolean;
  exchangeMode: string | undefined;
}

export const SwapActions = React.memo(function SwapActions({
  status,
  participant,
  handlers,
  isProcessing,
  exchangeMode,
}: SwapActionsProps) {
  const { id: swapId } = useLocalSearchParams<{ id: string }>();
  const {
    isInitiator,
    isReceiver,
    isTopUpPayer,
    topUpPayerName,
    hasUploadedPhotos,
    hasConfirmedShipping,
    hasConfirmedReception,
    hasRated,
  } = participant;

  return (
    <View style={styles.actionsSection}>
      {/* Payment pending — payer settles the cash complement */}
      {status === 'payment_pending' && PAYMENTS_ENABLED && isTopUpPayer && (
        <Pressable
          accessibilityRole="button"
          style={({ pressed }) => [styles.actionButton, pressed && styles.pressed]}
          onPress={handlers.onPayTopUp}
          disabled={isProcessing}
        >
          {isProcessing ? (
            <ActivityIndicator size="small" color={colors.cream} />
          ) : (
            <>
              <Ionicons name="lock-closed-outline" size={20} color={colors.cream} />
              <Text variant="body" style={styles.actionButtonText}>
                Régler le complément
              </Text>
            </>
          )}
        </Pressable>
      )}

      {/* Payment pending — the other party waits for the payment */}
      {status === 'payment_pending' && (PAYMENTS_ENABLED ? !isTopUpPayer : true) && (
        <View style={styles.waitingCard}>
          <Ionicons name="hourglass-outline" size={24} color={colors.rust} />
          <Text variant="body" style={styles.waitingText}>
            {PAYMENTS_ENABLED ? `En attente du paiement de ${topUpPayerName || 'l’autre membre'}` : 'Ce complément appartient à un ancien échange. Les paiements sont indisponibles actuellement.'}
          </Text>
        </View>
      )}

      {/* Proposed - Receiver can accept/decline */}
      {status === 'proposed' && isReceiver && (
        <>
          <Pressable
            accessibilityRole="button"
            style={({ pressed }) => [styles.acceptBtn, pressed && styles.pressed]}
            onPress={handlers.onAccept}
            disabled={isProcessing}
          >
            {isProcessing ? (
              <ActivityIndicator size="small" color={colors.cream} />
            ) : (
              <>
                <Ionicons name="checkmark" size={20} color={colors.cream} />
                <Text variant="body" style={styles.acceptButtonText}>
                  Accepter
                </Text>
              </>
            )}
          </Pressable>

          <Pressable
            accessibilityRole="button"
            style={({ pressed }) => [styles.declineBtn, pressed && styles.pressed]}
            onPress={handlers.onDecline}
            disabled={isProcessing}
          >
            <Ionicons name="close" size={20} color={colors.rust} />
            <Text variant="body" style={styles.declineButtonText}>
              Refuser
            </Text>
          </Pressable>
        </>
      )}

      {/* Proposed - Initiator can cancel */}
      {status === 'proposed' && isInitiator && (
        <Pressable
          accessibilityRole="button"
          style={({ pressed }) => [styles.declineBtn, pressed && styles.pressed]}
          onPress={handlers.onCancel}
          disabled={isProcessing}
        >
          <Text variant="body" style={styles.declineButtonText}>
            Annuler la proposition
          </Text>
        </Pressable>
      )}

      {/* Accepted - Choose exchange mode */}
      {status === 'accepted' && !exchangeMode && (
        <ExchangeModeSelector
          onSelect={(mode) => {
            track('swap_exchange_mode_selected', { swap_id: swapId ?? '', mode });
            handlers.onSetExchangeMode(mode);
          }}
          isProcessing={isProcessing}
        />
      )}

      {/* Photos Pending - Upload photos */}
      {status === 'photos_pending' && !hasUploadedPhotos && (
        <PhotoUploadSection
          onUpload={handlers.onUploadPhotos}
          isProcessing={isProcessing}
        />
      )}

      {/* Photos uploaded - waiting for other */}
      {status === 'photos_pending' && hasUploadedPhotos && (
        <View style={styles.waitingCard}>
          <Ionicons name="hourglass-outline" size={24} color={colors.rust} />
          <Text variant="body" style={styles.waitingText}>
            {"Vos photos sont ajoutées. Vous attendez celles de l’autre membre."}
          </Text>
        </View>
      )}

      {/* Shipping - Confirm shipping */}
      {status === 'shipping' && !hasConfirmedShipping && (
        <Pressable
          accessibilityRole="button"
          style={({ pressed }) => [styles.actionButton, pressed && styles.pressed]}
          onPress={handlers.onConfirmShipping}
          disabled={isProcessing}
        >
          {isProcessing ? (
            <ActivityIndicator size="small" color={colors.cream} />
          ) : (
            <>
              <Ionicons name={exchangeMode === 'hand_delivery' ? 'hand-left-outline' : 'send'} size={20} color={colors.cream} />
              <Text variant="body" style={styles.actionButtonText}>
                {exchangeMode === 'hand_delivery' ? "J'ai remis mes articles" : "J'ai envoyé mes articles"}
              </Text>
            </>
          )}
        </Pressable>
      )}

      {/* Shipping - Confirm reception */}
      {status === 'shipping' && hasConfirmedShipping && !hasConfirmedReception && (
        <Pressable
          accessibilityRole="button"
          style={({ pressed }) => [styles.actionButton, pressed && styles.pressed]}
          onPress={handlers.onConfirmReception}
          disabled={isProcessing}
        >
          {isProcessing ? (
            <ActivityIndicator size="small" color={colors.cream} />
          ) : (
            <>
              <Ionicons name="cube" size={20} color={colors.cream} />
              <Text variant="body" style={styles.actionButtonText}>
                {"J'ai reçu les articles"}
              </Text>
            </>
          )}
        </Pressable>
      )}

      {status === 'shipping' && hasConfirmedReception && (
        <View style={styles.waitingCard}>
          <Ionicons name="time-outline" size={24} color={colors.primary} />
          <Text style={styles.waitingText}>Réception confirmée. Vous attendez la confirmation de l’autre membre.</Text>
        </View>
      )}

      {status === 'completed' && hasRated && <Text style={styles.waitingText}>Votre évaluation a été enregistrée. Merci !</Text>}

      {/* Dispute escape hatch — available once the swap is locked in
          (post-acceptance) and through the post-completion protection window.
          Exposing it from 'accepted'/'photos_pending' is the exit for a top-up
          payer stranded by a silent counterparty (F51). The backend
          (openSwapDispute, DISPUTABLE_SWAP_STATUSES) is the source of truth on
          eligibility — it FREEZES the swap; an admin then resolves it. */}
      {(status === 'accepted' ||
        status === 'photos_pending' ||
        status === 'shipping' ||
        status === 'completed') && <DisputeButton disabled={isProcessing} status={status} />}

      {/* Completed - Rate */}
      {status === 'completed' && !hasRated && (
        <RatingSection onRate={handlers.onRate} isProcessing={isProcessing} />
      )}
    </View>
  );
});

// ---------------------------------------------------------------------------
// Dispute button — self-contained: resolves the swapId from the route and
// calls the `openSwapDispute` callable with a predefined reason. Kept local
// so it does not need a new handler threaded through the screen.
// ---------------------------------------------------------------------------

interface DisputeButtonProps {
  disabled: boolean;
  status: SwapStatus;
}

/** Predefined dispute reasons (the backend requires a non-empty reason). */
const DISPUTE_REASONS: readonly string[] = [
  "Je n'ai pas reçu l'article",
  "L'article ne correspond pas à la proposition",
  "L'article est endommagé",
  'Autre problème',
];

const DisputeButton = React.memo(function DisputeButton({ disabled, status }: DisputeButtonProps) {
  const { id: swapId } = useLocalSearchParams<{ id: string }>();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const dialogRef = useRef(false);

  const submitDispute = useCallback(
    async (reason: string) => {
      dialogRef.current = false;
      if (!swapId || submittingRef.current) return;
      submittingRef.current = true;
      setIsSubmitting(true);
      try {
        await openSwapDispute(swapId, reason);
        track('swap_dispute_opened', { swap_id: swapId, reason, status, outcome: 'success' });
        Alert.alert(
          'Litige ouvert',
          "Votre signalement a été enregistré. Les actions de l’échange sont suspendues pendant son examen."
        );
      } catch (error) {
        if (__DEV__) console.error('Error opening swap dispute:', error);
        track('swap_dispute_opened', { swap_id: swapId, reason, status, outcome: 'error' });
        Alert.alert('Erreur', "Impossible d'ouvrir le litige. Veuillez réessayer plus tard.");
      } finally {
        submittingRef.current = false;
        setIsSubmitting(false);
      }
    },
    [swapId, status]
  );

  const handlePress = useCallback(() => {
    if (disabled || submittingRef.current || dialogRef.current) return;
    dialogRef.current = true;
    Alert.alert(
      'Ouvrir un litige',
      'Quel est le problème avec cet échange ?',
      [
        ...DISPUTE_REASONS.map((reason) => ({
          text: reason,
          onPress: () => submitDispute(reason),
        })),
        { text: 'Annuler', style: 'cancel' as const, onPress: () => { dialogRef.current = false; } },
      ],
      { cancelable: true, onDismiss: () => { dialogRef.current = false; } }
    );
  }, [disabled, submitDispute]);

  return (
    <Pressable
      style={({ pressed }) => [styles.disputeButton, pressed && styles.pressed]}
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel="Ouvrir un litige"
      accessibilityState={{ disabled: disabled || isSubmitting, busy: isSubmitting }}
      disabled={disabled || isSubmitting}
    >
      {isSubmitting ? (
        <ActivityIndicator size="small" color={colors.rust} />
      ) : (
        <>
          <Ionicons name="alert-circle-outline" size={20} color={colors.rust} />
          <Text variant="body" style={styles.disputeButtonText}>
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

interface ExchangeModeSelectorProps {
  onSelect: (mode: 'hand_delivery' | 'shipping') => void;
  isProcessing: boolean;
}

const ExchangeModeSelector = React.memo(function ExchangeModeSelector({
  onSelect,
  isProcessing,
}: ExchangeModeSelectorProps) {
  return (
    <View style={styles.modeSelection}>
      <Text variant="h3" style={styles.modeTitle}>
        {"Comment souhaitez-vous échanger ?"}
      </Text>

      <Pressable
        accessibilityRole="button"
        style={({ pressed }) => [styles.modeButton, pressed && styles.pressed]}
        onPress={() => onSelect('hand_delivery')}
        disabled={isProcessing}
      >
        <Ionicons name="hand-left-outline" size={24} color={colors.sage} />
        <View style={styles.modeContent}>
          <Text variant="body" style={styles.modeButtonTitle}>
            En main propre
          </Text>
          <Caption>Convenez d’un lieu et d’un moment avec le membre.</Caption>
        </View>
        <Ionicons name="chevron-forward" size={20} color={colors.muted} />
      </Pressable>

      <Pressable
        accessibilityRole="button"
        style={({ pressed }) => [styles.modeButton, pressed && styles.pressed]}
        onPress={() => onSelect('shipping')}
        disabled={isProcessing}
      >
        <Ionicons name="send-outline" size={24} color={colors.sage} />
        <View style={styles.modeContent}>
          <Text variant="body" style={styles.modeButtonTitle}>
            Envoi postal
          </Text>
          <Caption>Organisez l’envoi et les frais avec le membre.</Caption>
        </View>
        <Ionicons name="chevron-forward" size={20} color={colors.muted} />
      </Pressable>
    </View>
  );
});

interface PhotoUploadSectionProps {
  onUpload: () => void;
  isProcessing: boolean;
}

const PhotoUploadSection = React.memo(function PhotoUploadSection({
  onUpload,
  isProcessing,
}: PhotoUploadSectionProps) {
  return (
    <View style={styles.photosSection}>
      <Text variant="h3" style={styles.sectionTitle}>
        Ajoutez des photos de vos articles
      </Text>
      <Caption style={styles.sectionDesc}>
        {"Ajoutez 1 à 4 photos pour montrer l’état de vos articles avant la remise ou l’envoi."}
      </Caption>

      <Pressable
        accessibilityRole="button"
        style={({ pressed }) => [styles.uploadButton, pressed && styles.pressed]}
        onPress={onUpload}
        disabled={isProcessing}
      >
        {isProcessing ? (
          <ActivityIndicator size="small" color={colors.cream} />
        ) : (
          <>
            <Ionicons name="camera-outline" size={20} color={colors.cream} />
            <Text variant="body" style={styles.uploadButtonText}>
              Ajouter des photos
            </Text>
          </>
        )}
      </Pressable>
    </View>
  );
});

interface RatingSectionProps {
  onRate: (score: number) => void;
  isProcessing: boolean;
}

const RATING_SCORES = [1, 2, 3, 4, 5] as const;

const RatingSection = React.memo(function RatingSection({
  onRate,
  isProcessing,
}: RatingSectionProps) {
  return (
    <View style={styles.ratingSection}>
      <Text variant="h3" style={styles.sectionTitle}>
        {"Comment s'est passé l'échange ?"}
      </Text>
      <View style={styles.ratingButtons}>
        {RATING_SCORES.map((score) => (
          <Pressable
            key={score}
            style={({ pressed }) => [styles.ratingButton, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={`Évaluer l’échange : ${score} sur 5`}
            onPress={() => onRate(score)}
            disabled={isProcessing}
          >
            <Ionicons name="star" size={32} color={colors.primary} />
            <Caption style={styles.ratingScore}>{score}</Caption>
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
  pressed: { opacity: 0.7 },
  actionsSection: {
    paddingHorizontal: spacing.md,
    gap: spacing.md,
  },
  acceptBtn: {
    minHeight: sizing.minTouchTarget,
    flex: 2,
    flexDirection: 'row',
    paddingVertical: 15,
    backgroundColor: colors.primary,
    borderRadius: radius.xl,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  acceptButtonText: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    fontWeight: '500',
    color: colors.cream,
  },
  declineBtn: {
    minHeight: sizing.minTouchTarget,
    flex: 1,
    paddingVertical: 15,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    borderRadius: radius.xl,
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  declineButtonText: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    fontWeight: '500',
    color: colors.rust,
  },
  modeSelection: {
    backgroundColor: colors.surfaceWarm,
    borderRadius: radius.xl,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  modeTitle: {
    fontFamily: fonts.display,
    fontSize: 18,
    color: colors.charcoal,
    marginBottom: 16,
    textAlign: 'center',
  },
  modeButton: {
    minHeight: sizing.minTouchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    backgroundColor: colors.background,
    borderRadius: radius.xl,
    marginBottom: 8,
    gap: 12,
  },
  modeContent: {
    flex: 1,
  },
  modeButtonTitle: {
    fontFamily: fonts.sansMedium,
    fontSize: 14,
    fontWeight: '500',
    color: colors.charcoal,
  },
  photosSection: {
    backgroundColor: colors.surfaceWarm,
    borderRadius: radius.xl,
    padding: spacing.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  sectionTitle: {
    fontFamily: fonts.display,
    fontSize: 18,
    color: colors.charcoal,
    marginBottom: 8,
    textAlign: 'center',
  },
  sectionDesc: {
    fontFamily: fonts.sans,
    fontSize: 13,
    color: colors.muted,
    textAlign: 'center',
    marginBottom: 24,
  },
  uploadButton: {
    minHeight: sizing.minTouchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: radius.xl,
    gap: 8,
  },
  uploadButtonText: {
    fontFamily: fonts.sansMedium,
    fontSize: 14,
    fontWeight: '500',
    color: colors.surface,
  },
  waitingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceWarm,
    padding: 16,
    borderRadius: radius.xl,
    gap: 12,
  },
  waitingText: {
    flex: 1,
    fontFamily: fonts.sansMedium,
    fontSize: 14,
    fontWeight: '500',
    color: colors.foregroundSecondary,
  },
  actionButton: {
    minHeight: sizing.minTouchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    paddingVertical: 16,
    borderRadius: radius.xl,
    gap: 12,
  },
  actionButtonText: {
    fontFamily: fonts.sansMedium,
    fontSize: 14,
    fontWeight: '500',
    color: colors.surface,
  },
  ratingSection: {
    backgroundColor: colors.surfaceWarm,
    borderRadius: radius.xl,
    padding: spacing.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  ratingButtons: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginTop: spacing.md,
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  ratingButton: {
    minWidth: sizing.minTouchTarget,
    minHeight: sizing.minTouchTarget,
    alignItems: 'center',
  },
  ratingScore: {
    marginTop: 4,
  },
  disputeButton: {
    minHeight: sizing.minTouchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceWarm,
    marginTop: 12,
    paddingVertical: 14,
    borderRadius: radius.xl,
    gap: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  disputeButtonText: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    fontWeight: '500',
    color: colors.rust,
  },
});
