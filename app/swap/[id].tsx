/**
 * Swap Detail Screen -- Multi-Article Support
 * Design System: HTML UI Kit (Charcoal, Sage, Rust)
 * Phone 5: Demande recue -- Accepter / Refuser
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, ScrollView, Alert } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';

import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';

import { prepareImageForUpload } from '@/utils/imageUtils';
import { track } from '@/lib/analytics';
import { useUser } from '@/hooks/useAuth';
import { storage } from '@/config/firebaseConfig';
import {
  acceptSwap,
  declineSwap,
  cancelSwap,
  createSwapTopUpCheckout,
  setExchangeMode,
  uploadSwapPhotos,
  confirmShipping,
  confirmReception,
  rateSwap,
  subscribeToSwap,
  getSwapItems,
} from '@/services/swapService';
import { Swap, SwapExchangeMode } from '@/types';
import { colors, spacing } from '@/constants/theme';
import { Text } from '@/components/ui';
import { StripePayment, StripePaymentResult } from '@/components/StripePayment';
import {
  SwapDetailSkeleton,
  SwapTopBar,
  SwapProposalView,
  SwapStatusView,
  SwapActions,
  SwapContactButton,
  SwapStickyActions,
} from '@/features/swap';
import type { SwapActionHandlers, SwapParticipantContext } from '@/features/swap';

const SWAP_VIEW_SOURCES = ['my_swaps', 'push', 'post_proposal', 'deep_link'] as const;
type SwapViewSource = (typeof SWAP_VIEW_SOURCES)[number];

export default function SwapDetailScreen() {
  const { id, source: sourceParam } = useLocalSearchParams<{ id: string; source?: string }>();
  const viewSource: SwapViewSource = SWAP_VIEW_SOURCES.includes(sourceParam as SwapViewSource)
    ? (sourceParam as SwapViewSource)
    : 'deep_link';
  const user = useUser();
  const insets = useSafeAreaInsets();

  const [swap, setSwap] = useState<Swap | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);

  // Stripe top-up payment state
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [showStripePayment, setShowStripePayment] = useState(false);

  // -----------------------------------------------------------------------
  // Real-time subscription
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (!id) return;

    const unsubscribe = subscribeToSwap(id, (swapData) => {
      setSwap(swapData);
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, [id]);

  // Fire swap_viewed once, on the first real-time delivery of a loaded swap.
  // The not_found branch is intentionally not tracked (swap_viewed requires a
  // SwapStatus, unavailable when the swap does not exist — see notes).
  const viewedRef = useRef(false);
  useEffect(() => {
    if (isLoading || viewedRef.current || !swap || !id) return;
    viewedRef.current = true;
    track('swap_viewed', {
      swap_id: id,
      outcome: 'loaded',
      status: swap.status,
      is_initiator: swap.initiatorId === user?.id,
      is_top_up_payer: swap.cashTopUp?.payerId === user?.id,
      cash_top_up_cents: swap.cashTopUp?.amount ?? 0,
      ...(swap.exchangeMode ? { exchange_mode: swap.exchangeMode } : {}),
      source: viewSource,
    });
  }, [isLoading, swap, id, user?.id, viewSource]);

  // -----------------------------------------------------------------------
  // Derived participant context
  // -----------------------------------------------------------------------
  const participant = useMemo<SwapParticipantContext | null>(() => {
    if (!swap || !user) return null;

    const isInitiator = swap.initiatorId === user.id;
    const isReceiver = swap.receiverId === user.id;

    const payerId = swap.cashTopUp?.payerId;
    const payerName =
      payerId === swap.initiatorId
        ? swap.initiatorName
        : payerId === swap.receiverId
          ? swap.receiverName
          : '';

    return {
      isInitiator,
      isReceiver,
      isTopUpPayer: !!payerId && payerId === user.id,
      topUpPayerName: payerName,
      senderName: isInitiator ? swap.receiverName : swap.initiatorName,
      senderImage: isInitiator ? swap.receiverImage : swap.initiatorImage,
      senderItems: isInitiator
        ? getSwapItems(swap, 'receiver')
        : getSwapItems(swap, 'initiator'),
      myItems: isInitiator
        ? getSwapItems(swap, 'initiator')
        : getSwapItems(swap, 'receiver'),
      hasUploadedPhotos: isInitiator
        ? !!swap.initiatorPhotos
        : !!swap.receiverPhotos,
      hasConfirmedShipping: isInitiator
        ? !!swap.initiatorShippedAt
        : !!swap.receiverShippedAt,
      hasConfirmedReception: isInitiator
        ? !!swap.initiatorReceivedAt
        : !!swap.receiverReceivedAt,
      hasRated: isInitiator ? !!swap.initiatorRating : !!swap.receiverRating,
    };
  }, [swap, user]);

  // -----------------------------------------------------------------------
  // Action handlers
  // -----------------------------------------------------------------------
  const handleAccept = useCallback(
    async (surface: 'sticky_bar' | 'inline' = 'inline') => {
      if (!id) return;
      const cashTopUpCents = swap?.cashTopUp?.amount ?? 0;
      setIsProcessing(true);
      try {
        await acceptSwap(id);
        track('swap_accepted', {
          swap_id: id,
          outcome: 'success',
          surface,
          cash_top_up_cents: cashTopUpCents,
        });
      } catch (error) {
        if (__DEV__) console.error('Error accepting swap:', error);
        track('swap_accepted', {
          swap_id: id,
          outcome: 'error',
          surface,
          cash_top_up_cents: cashTopUpCents,
        });
        Alert.alert('Erreur', "Impossible d'accepter l'échange");
      } finally {
        setIsProcessing(false);
      }
    },
    [id, swap?.cashTopUp?.amount]
  );

  const handleDecline = useCallback(async () => {
    Alert.alert(
      "Refuser l'échange",
      'Es-tu sûr de vouloir refuser cette proposition ?',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Refuser',
          style: 'destructive',
          onPress: async () => {
            if (!id) return;
            const cashTopUpCents = swap?.cashTopUp?.amount ?? 0;
            setIsProcessing(true);
            try {
              await declineSwap(id);
              track('swap_declined', {
                swap_id: id,
                outcome: 'success',
                cash_top_up_cents: cashTopUpCents,
              });
            } catch (error) {
              if (__DEV__) console.error('Error declining swap:', error);
              track('swap_declined', {
                swap_id: id,
                outcome: 'error',
                cash_top_up_cents: cashTopUpCents,
              });
              Alert.alert('Erreur', "Impossible de refuser l'échange");
            } finally {
              setIsProcessing(false);
            }
          },
        },
      ]
    );
  }, [id]);

  const handlePayTopUp = useCallback(async () => {
    if (!id) return;
    setIsProcessing(true);
    try {
      const { clientSecret: secret } = await createSwapTopUpCheckout(id);
      // The native sheet displays the server-authoritative PaymentIntent amount.
      setClientSecret(secret);
      setShowStripePayment(true);
    } catch (error) {
      if (__DEV__) console.error('Error creating swap top-up checkout:', error);
      Alert.alert('Erreur', "Impossible d'initier le paiement du complément");
    } finally {
      setIsProcessing(false);
    }
  }, [id]);

  const handlePaymentResult = useCallback((result: StripePaymentResult) => {
    setShowStripePayment(false);
    setClientSecret(null);
    if (!result.success) {
      if (result.error !== 'cancelled') {
        Alert.alert('Paiement échoué', result.error || 'Veuillez réessayer.');
      }
      return;
    }
    // On success the webhook advances the swap (payment_pending -> accepted);
    // subscribeToSwap reflects it in real time. Nothing to write here.
    Alert.alert('Paiement confirmé !', "Le complément a bien été réglé.");
  }, []);

  const handleCancel = useCallback(async () => {
    Alert.alert(
      "Annuler l'échange",
      'Es-tu sûr de vouloir annuler cette proposition ?',
      [
        { text: 'Non', style: 'cancel' },
        {
          text: 'Oui, annuler',
          style: 'destructive',
          onPress: async () => {
            if (!id) return;
            setIsProcessing(true);
            try {
              await cancelSwap(id);
              router.back();
            } catch (error) {
              if (__DEV__) console.error('Error cancelling swap:', error);
              Alert.alert('Erreur', "Impossible d'annuler l'échange");
            } finally {
              setIsProcessing(false);
            }
          },
        },
      ]
    );
  }, [id]);

  const handleSetExchangeMode = useCallback(
    async (mode: SwapExchangeMode) => {
      if (!id) return;
      setIsProcessing(true);
      try {
        await setExchangeMode(id, mode);
      } catch (error) {
        if (__DEV__) console.error('Error setting exchange mode:', error);
        Alert.alert('Erreur', "Impossible de définir le mode d'échange");
      } finally {
        setIsProcessing(false);
      }
    },
    [id]
  );

  const handleUploadPhotos = useCallback(async () => {
    if (!id || !user) return;
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'] as const,
        allowsMultipleSelection: true,
        quality: 0.8,
        exif: false,
        selectionLimit: 4,
        preferredAssetRepresentationMode:
          ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
      });
      if (result.canceled) return;

      setIsProcessing(true);

      const uploadedUrls = await Promise.all(
        result.assets.map(async (asset, i) => {
          const compressedUri = await prepareImageForUpload(asset.uri);
          const response = await fetch(compressedUri);
          const blob = await response.blob();
          const storageRef = ref(
            storage,
            `swaps/${id}/photos/${user.id}_${i}_${Date.now()}.jpg`
          );
          await uploadBytes(storageRef, blob);
          return getDownloadURL(storageRef);
        })
      );

      await uploadSwapPhotos(id, user.id, uploadedUrls);
      Alert.alert('Photos envoyées', 'Tes photos ont bien été ajoutées.');
    } catch (error) {
      if (__DEV__) console.error('Error uploading photos:', error);
      Alert.alert('Erreur', "Impossible d'envoyer les photos");
    } finally {
      setIsProcessing(false);
    }
  }, [id, user]);

  const handleConfirmShipping = useCallback(async () => {
    if (!id || !user) return;
    Alert.alert("Confirmer l'envoi", 'As-tu bien envoyé ton article ?', [
      { text: 'Non', style: 'cancel' },
      {
        text: 'Oui, envoyé !',
        onPress: async () => {
          setIsProcessing(true);
          try {
            await confirmShipping(id, user.id);
          } catch (error) {
            if (__DEV__) console.error('Error confirming shipping:', error);
            Alert.alert('Erreur', "Impossible de confirmer l'envoi");
          } finally {
            setIsProcessing(false);
          }
        },
      },
    ]);
  }, [id, user]);

  const handleConfirmReception = useCallback(async () => {
    if (!id || !user) return;
    Alert.alert('Confirmer la réception', "As-tu bien reçu l'article ?", [
      { text: 'Non', style: 'cancel' },
      {
        text: 'Oui, reçu !',
        onPress: async () => {
          setIsProcessing(true);
          try {
            await confirmReception(id, user.id);
          } catch (error) {
            if (__DEV__) console.error('Error confirming reception:', error);
            Alert.alert('Erreur', 'Impossible de confirmer la réception');
          } finally {
            setIsProcessing(false);
          }
        },
      },
    ]);
  }, [id, user]);

  const handleRate = useCallback(
    async (score: number) => {
      if (!id || !user) return;
      setIsProcessing(true);
      try {
        await rateSwap(id, user.id, score);
        Alert.alert('Merci !', 'Ta note a été enregistrée.');
      } catch (error) {
        if (__DEV__) console.error('Error rating swap:', error);
        Alert.alert('Erreur', "Impossible d'enregistrer la note");
      } finally {
        setIsProcessing(false);
      }
    },
    [id, user]
  );

  const actionHandlers = useMemo<SwapActionHandlers>(
    () => ({
      onAccept: handleAccept,
      onDecline: handleDecline,
      onCancel: handleCancel,
      onPayTopUp: handlePayTopUp,
      onSetExchangeMode: handleSetExchangeMode,
      onUploadPhotos: handleUploadPhotos,
      onConfirmShipping: handleConfirmShipping,
      onConfirmReception: handleConfirmReception,
      onRate: handleRate,
    }),
    [
      handleAccept,
      handleDecline,
      handleCancel,
      handlePayTopUp,
      handleSetExchangeMode,
      handleUploadPhotos,
      handleConfirmShipping,
      handleConfirmReception,
      handleRate,
    ]
  );

  // -----------------------------------------------------------------------
  // Loading state
  // -----------------------------------------------------------------------
  if (isLoading) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <Stack.Screen options={{ headerShown: false }} />
        <SwapDetailSkeleton />
      </SafeAreaView>
    );
  }

  // -----------------------------------------------------------------------
  // Error state
  // -----------------------------------------------------------------------
  if (!swap || !participant) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.errorContainer}>
          <Ionicons name="alert-circle-outline" size={48} color={colors.muted} />
          <Text variant="body" style={styles.errorText}>
            Échange non trouvé
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------
  const showNewBadge = swap.status === 'proposed' && !participant.isInitiator;
  const otherUserId = participant.isInitiator ? swap.receiverId : swap.initiatorId;

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <Stack.Screen options={{ headerShown: false }} />

      <SwapTopBar showNewBadge={showNewBadge} />

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xl + spacing.lg }}
      >
        {/* Proposed status: detailed offer layout (receiver perspective) */}
        {swap.status === 'proposed' && !participant.isInitiator && (
          <SwapProposalView
            senderName={participant.senderName}
            senderImage={participant.senderImage}
            message={swap.message}
            senderItems={participant.senderItems}
            myItems={participant.myItems}
            cashTopUp={swap.cashTopUp}
          />
        )}

        {/* Proposed status: initiator sees their sent proposal */}
        {swap.status === 'proposed' && participant.isInitiator && (
          <View style={styles.initiatorPendingSection}>
            <View style={styles.pendingBadge}>
              <Ionicons name="time-outline" size={20} color={colors.sage} />
              <Text variant="body" style={styles.pendingText}>
                Ta proposition est en attente de réponse
              </Text>
            </View>
            <SwapProposalView
              senderName={participant.senderName}
              senderImage={participant.senderImage}
              message={swap.message}
              senderItems={participant.myItems}
              myItems={participant.senderItems}
              cashTopUp={swap.cashTopUp}
            />
          </View>
        )}

        {/* Other statuses: simplified layout */}
        {swap.status !== 'proposed' && (
          <SwapStatusView
            status={swap.status}
            senderName={participant.senderName}
            senderImage={participant.senderImage}
            senderItems={participant.senderItems}
            myItems={participant.myItems}
            cashTopUpAmount={swap.cashTopUp?.amount}
          />
        )}

        {/* Action buttons based on status.
            The proposed-receiver case is owned exclusively by the sticky bar
            below, so we skip the in-flow Accept/Decline to avoid duplicating
            the same actions on two surfaces. */}
        {!(swap.status === 'proposed' && !participant.isInitiator) && (
          <SwapActions
            status={swap.status}
            participant={participant}
            handlers={actionHandlers}
            isProcessing={isProcessing}
            exchangeMode={swap.exchangeMode}
          />
        )}

        {/* Contact button */}
        {swap.status !== 'declined' && swap.status !== 'cancelled' && (
          <SwapContactButton
            otherUserId={otherUserId}
            otherUserName={participant.senderName}
          />
        )}
      </ScrollView>

      {/* Sticky bottom -- proposed status only */}
      {swap.status === 'proposed' && !participant.isInitiator && (
        <SwapStickyActions
          onAccept={handleAccept}
          onDecline={handleDecline}
          isProcessing={isProcessing}
        />
      )}

      {/* Stripe Payment Sheet — cash top-up settlement */}
      {clientSecret && (
        <StripePayment
          clientSecret={clientSecret}
          visible={showStripePayment}
          onResult={handlePaymentResult}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.sm,
  },
  errorText: {
    color: colors.muted,
  },
  scrollView: {
    flex: 1,
  },
  initiatorPendingSection: {
    paddingTop: spacing.md,
  },
  pendingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 24,
    marginBottom: 16,
    backgroundColor: 'rgba(122, 140, 110, 0.08)',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(122, 140, 110, 0.2)',
  },
  pendingText: {
    flex: 1,
    fontSize: 14,
    color: colors.sage,
  },
});
