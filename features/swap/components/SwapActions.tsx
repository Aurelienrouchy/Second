/**
 * SwapActions
 * Renders the appropriate action UI based on the current swap status.
 * All callbacks are received via props from the screen.
 */

import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Text, Caption } from '@/components/ui';
import { colors, fonts } from '@/constants/theme';
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
  const {
    isInitiator,
    isReceiver,
    hasUploadedPhotos,
    hasConfirmedShipping,
    hasConfirmedReception,
    hasRated,
  } = participant;

  return (
    <View style={styles.actionsSection}>
      {/* Proposed - Receiver can accept/decline */}
      {status === 'proposed' && isReceiver && (
        <>
          <Pressable
            style={({ pressed }) => [styles.acceptBtn, pressed && { opacity: 0.7 }]}
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
            style={({ pressed }) => [styles.declineBtn, pressed && { opacity: 0.7 }]}
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
          style={({ pressed }) => [styles.declineBtn, pressed && { opacity: 0.7 }]}
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
          onSelect={handlers.onSetExchangeMode}
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
            {"En attente des photos de l'autre participant"}
          </Text>
        </View>
      )}

      {/* Shipping - Confirm shipping */}
      {status === 'shipping' && !hasConfirmedShipping && (
        <Pressable
          style={({ pressed }) => [styles.actionButton, pressed && { opacity: 0.7 }]}
          onPress={handlers.onConfirmShipping}
          disabled={isProcessing}
        >
          {isProcessing ? (
            <ActivityIndicator size="small" color={colors.cream} />
          ) : (
            <>
              <Ionicons name="send" size={20} color={colors.cream} />
              <Text variant="body" style={styles.actionButtonText}>
                {"J'ai envoyé mon article"}
              </Text>
            </>
          )}
        </Pressable>
      )}

      {/* Shipping - Confirm reception */}
      {status === 'shipping' && hasConfirmedShipping && !hasConfirmedReception && (
        <Pressable
          style={({ pressed }) => [styles.actionButton, pressed && { opacity: 0.7 }]}
          onPress={handlers.onConfirmReception}
          disabled={isProcessing}
        >
          {isProcessing ? (
            <ActivityIndicator size="small" color={colors.cream} />
          ) : (
            <>
              <Ionicons name="cube" size={20} color={colors.cream} />
              <Text variant="body" style={styles.actionButtonText}>
                {"J'ai reçu l'article"}
              </Text>
            </>
          )}
        </Pressable>
      )}

      {/* Completed - Rate */}
      {status === 'completed' && !hasRated && (
        <RatingSection onRate={handlers.onRate} isProcessing={isProcessing} />
      )}
    </View>
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
        {"Comment veux-tu échanger ?"}
      </Text>

      <Pressable
        style={({ pressed }) => [styles.modeButton, pressed && { opacity: 0.7 }]}
        onPress={() => onSelect('hand_delivery')}
        disabled={isProcessing}
      >
        <Ionicons name="hand-left-outline" size={24} color={colors.sage} />
        <View style={styles.modeContent}>
          <Text variant="body" style={styles.modeButtonTitle}>
            En main propre
          </Text>
          <Caption>Retrouvez-vous pour échanger</Caption>
        </View>
        <Ionicons name="chevron-forward" size={20} color={colors.muted} />
      </Pressable>

      <Pressable
        style={({ pressed }) => [styles.modeButton, pressed && { opacity: 0.7 }]}
        onPress={() => onSelect('shipping')}
        disabled={isProcessing}
      >
        <Ionicons name="send-outline" size={24} color={colors.sage} />
        <View style={styles.modeContent}>
          <Text variant="body" style={styles.modeButtonTitle}>
            Envoi postal
          </Text>
          <Caption>Envoyez-vous les articles par la poste</Caption>
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
        Envoie des photos de ton article
      </Text>
      <Caption style={styles.sectionDesc}>
        {"Prends 2-4 photos de l'article avant de l'envoyer"}
      </Caption>

      <Pressable
        style={({ pressed }) => [styles.uploadButton, pressed && { opacity: 0.7 }]}
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
            style={({ pressed }) => [styles.ratingButton, pressed && { opacity: 0.7 }]}
            onPress={() => onRate(score)}
            disabled={isProcessing}
          >
            <Ionicons name="star" size={32} color="#FFD700" />
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
  actionsSection: {
    marginTop: 20,
    paddingHorizontal: 24,
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
    marginBottom: 8,
  },
  acceptButtonText: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    fontWeight: '500',
    color: colors.cream,
  },
  declineBtn: {
    flex: 1,
    paddingVertical: 15,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    borderRadius: 8,
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
    backgroundColor: colors.surface,
    borderRadius: 8,
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
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    backgroundColor: colors.sageLight,
    borderRadius: 8,
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
    backgroundColor: colors.surface,
    borderRadius: 8,
    padding: 24,
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.sage,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 100,
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
    backgroundColor: 'rgba(255, 193, 7, 0.1)',
    padding: 16,
    borderRadius: 8,
    gap: 12,
  },
  waitingText: {
    flex: 1,
    fontFamily: fonts.sansMedium,
    fontSize: 14,
    fontWeight: '500',
    color: colors.muted,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.sage,
    paddingVertical: 16,
    borderRadius: 8,
    gap: 12,
  },
  actionButtonText: {
    fontFamily: fonts.sansMedium,
    fontSize: 14,
    fontWeight: '500',
    color: colors.surface,
  },
  ratingSection: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  ratingButtons: {
    flexDirection: 'row',
    gap: 16,
    marginTop: 16,
  },
  ratingButton: {
    alignItems: 'center',
  },
  ratingScore: {
    marginTop: 4,
  },
});
