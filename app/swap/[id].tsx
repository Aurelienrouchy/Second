/**
 * Swap Detail Screen -- Multi-Article Support
 * Design System: HTML UI Kit (Charcoal, Sage, Rust)
 * Phone 5: Demande recue -- Accepter / Refuser
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';

import { ref, uploadBytes } from 'firebase/storage';

import { randomUUID } from 'expo-crypto';
import { privateMediaUrl, PRIVATE_IMAGE_UPLOAD_METADATA } from '@/utils/privateMedia';
import { prepareImageForUpload } from '@/utils/imageUtils';
import { track } from '@/lib/analytics';
import { useUser, useIsLoading } from '@/hooks/useAuth';
import { useAuthSheetStore } from '@/store/authSheetStore';
import { PAYMENTS_ENABLED } from '@/config/featureFlags';
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
import { Text, Button } from '@/components/ui';
import { StripePayment, StripePaymentResult } from '@/components/StripePayment';
import {
  SwapDetailSkeleton,
  SwapTopBar,
  SwapProposalView,
  SwapStatusView,
  SwapActions,
  SwapContactButton,
  SwapStickyActions,
  getSwapNextStep,
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
  const isAuthLoading = useIsLoading();
  const showAuth = useAuthSheetStore(state => state.show);

  const [delivery, setDelivery] = useState<{ key: string; swap: Swap | null } | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const userId = user?.id;
  const subscriptionKey = `${id ?? ''}:${userId ?? ''}:${retryCount}`;
  const swap = delivery?.key === subscriptionKey ? delivery.swap : null;
  const isLoading = !!id && !!userId && delivery?.key !== subscriptionKey;
  const viewedRef = useRef<string | null>(null);
  const processingRef = useRef(false);
  const confirmationRef = useRef(false);
  const beginProcessing = useCallback(() => { processingRef.current = true; setIsProcessing(true); }, []);
  const endProcessing = useCallback(() => { processingRef.current = false; setIsProcessing(false); }, []);

  // Stripe top-up payment state
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [showStripePayment, setShowStripePayment] = useState(false);

  // -----------------------------------------------------------------------
  // Real-time subscription
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (!id || !userId) return;

    const unsubscribe = subscribeToSwap(id, (swapData) => {
      setDelivery({ key: subscriptionKey, swap: swapData });
    });

    return () => unsubscribe();
  }, [id, userId, subscriptionKey]);

  // Fire swap_viewed once, on the first real-time delivery of a loaded swap.
  // The not_found branch is intentionally not tracked (swap_viewed requires a
  // SwapStatus, unavailable when the swap does not exist — see notes).
  useEffect(() => {
    const viewKey = `${id ?? ''}:${userId ?? ''}`;
    if (isLoading || viewedRef.current === viewKey || !swap || !id) return;
    viewedRef.current = viewKey;
    track('swap_viewed', {
      swap_id: id,
      outcome: 'loaded',
      status: swap.status,
      is_initiator: swap.initiatorId === userId,
      is_top_up_payer: swap.cashTopUp?.payerId === userId,
      cash_top_up_cents: swap.cashTopUp?.amount ?? 0,
      ...(swap.exchangeMode ? { exchange_mode: swap.exchangeMode } : {}),
      source: viewSource,
    });
  }, [isLoading, swap, id, userId, viewSource]);

  // -----------------------------------------------------------------------
  // Derived participant context
  // -----------------------------------------------------------------------
  const participant = useMemo<SwapParticipantContext | null>(() => {
    if (!swap || !user) return null;

    const isInitiator = swap.initiatorId === user.id;
    const isReceiver = swap.receiverId === user.id;
    if (!isInitiator && !isReceiver) return null;

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
        ? !!swap.initiatorPhotos?.photos.length
        : !!swap.receiverPhotos?.photos.length,
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
      if (!id || processingRef.current) return;
      const cashTopUpCents = swap?.cashTopUp?.amount ?? 0;
      beginProcessing();
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
        endProcessing();
      }
    },
    [id, swap?.cashTopUp?.amount, beginProcessing, endProcessing]
  );

  const handleDecline = useCallback(async () => {
    if (processingRef.current || confirmationRef.current) return;
    confirmationRef.current = true;
    Alert.alert(
      "Refuser l'échange",
      'Souhaitez-vous refuser cette proposition ?',
      [
        { text: 'Revenir à la proposition', style: 'cancel', onPress: () => { confirmationRef.current = false; } },
        {
          text: 'Refuser',
          style: 'destructive',
          onPress: async () => {
            confirmationRef.current = false;
            if (!id || processingRef.current) return;
            const cashTopUpCents = swap?.cashTopUp?.amount ?? 0;
            beginProcessing();
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
              endProcessing();
            }
          },
        },
      ],
      { cancelable: true, onDismiss: () => { confirmationRef.current = false; } }
    );
  }, [id, swap?.cashTopUp?.amount, beginProcessing, endProcessing]);

  const handlePayTopUp = useCallback(async () => {
    if (!PAYMENTS_ENABLED || !id || processingRef.current) return;
    const cashTopUpCents = swap?.cashTopUp?.amount ?? 0;
    beginProcessing();
    try {
      const { clientSecret: secret } = await createSwapTopUpCheckout(id);
      // The native sheet displays the server-authoritative PaymentIntent amount.
      setClientSecret(secret);
      setShowStripePayment(true);
      track('swap_topup_payment_started', {
        swap_id: id,
        cash_top_up_cents: cashTopUpCents,
        outcome: 'sheet_presented',
      });
    } catch (error) {
      if (__DEV__) console.error('Error creating swap top-up checkout:', error);
      track('swap_topup_payment_started', {
        swap_id: id,
        cash_top_up_cents: cashTopUpCents,
        outcome: 'init_failed',
      });
      Alert.alert('Erreur', "Impossible d'initier le paiement du complément");
    } finally {
      endProcessing();
    }
  }, [id, swap?.cashTopUp?.amount, beginProcessing, endProcessing]);

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
    if (processingRef.current || confirmationRef.current) return;
    confirmationRef.current = true;
    Alert.alert(
      "Annuler l'échange",
      'Souhaitez-vous annuler cette proposition ?',
      [
        { text: 'Conserver la proposition', style: 'cancel', onPress: () => { confirmationRef.current = false; } },
        {
          text: 'Oui, annuler',
          style: 'destructive',
          onPress: async () => {
            confirmationRef.current = false;
            if (!id || processingRef.current) return;
            beginProcessing();
            try {
              await cancelSwap(id);
              track('swap_cancelled', { swap_id: id, outcome: 'success' });
              if (router.canGoBack()) router.back();
              else router.replace('/my-swaps');
            } catch (error) {
              if (__DEV__) console.error('Error cancelling swap:', error);
              track('swap_cancelled', { swap_id: id, outcome: 'error' });
              Alert.alert('Erreur', "Impossible d'annuler l'échange");
            } finally {
              endProcessing();
            }
          },
        },
      ],
      { cancelable: true, onDismiss: () => { confirmationRef.current = false; } }
    );
  }, [id, beginProcessing, endProcessing]);

  const handleSetExchangeMode = useCallback(
    async (mode: SwapExchangeMode) => {
      if (!id || processingRef.current) return;
      beginProcessing();
      try {
        await setExchangeMode(id, mode);
      } catch (error) {
        if (__DEV__) console.error('Error setting exchange mode:', error);
        Alert.alert('Erreur', "Impossible de définir le mode d'échange");
      } finally {
        endProcessing();
      }
    },
    [id, beginProcessing, endProcessing]
  );

  const handleUploadPhotos = useCallback(async () => {
    if (!id || !user || processingRef.current) return;
    beginProcessing();
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
      if (result.canceled) {
        track('swap_photos_uploaded', {
          swap_id: id,
          photos_count: 0,
          outcome: 'picker_cancelled',
        });
        return;
      }

      if (!result.assets.length || result.assets.length > 4) {
        Alert.alert('Choisir vos photos', 'Sélectionnez 1 à 4 photos de vos articles.');
        return;
      }

      const uploadedUrls = await Promise.all(
        result.assets.map(async (asset, i) => {
          const compressedUri = await prepareImageForUpload(asset.uri);
          const response = await fetch(compressedUri);
          const blob = await response.blob();
          const storageRef = ref(
            storage,
            `swaps/${id}/photos/${user.id}/${i}_${randomUUID()}.jpg`
          );
          await uploadBytes(storageRef, blob, PRIVATE_IMAGE_UPLOAD_METADATA);
          return privateMediaUrl(storageRef.bucket, storageRef.fullPath);
        })
      );

      await uploadSwapPhotos(id, user.id, uploadedUrls);
      track('swap_photos_uploaded', {
        swap_id: id,
        photos_count: uploadedUrls.length,
        outcome: 'success',
      });
      Alert.alert('Photos envoyées', 'Vos photos ont bien été ajoutées.');
    } catch (error) {
      if (__DEV__) console.error('Error uploading photos:', error);
      track('swap_photos_uploaded', {
        swap_id: id,
        photos_count: 0,
        outcome: 'error',
      });
      Alert.alert('Erreur', "Impossible d'envoyer les photos");
    } finally {
      endProcessing();
    }
  }, [id, user, beginProcessing, endProcessing]);

  const handleConfirmShipping = useCallback(async () => {
    if (!id || !user || processingRef.current || confirmationRef.current) return;
    const handDelivery = swap?.exchangeMode === 'hand_delivery';
    confirmationRef.current = true;
    Alert.alert(handDelivery ? 'Confirmer la remise' : 'Confirmer l’envoi', handDelivery ? 'Avez-vous remis vos articles au membre ?' : 'Avez-vous envoyé vos articles au membre ?', [
      { text: 'Pas encore', style: 'cancel', onPress: () => { confirmationRef.current = false; } },
      { text: handDelivery ? 'Oui, articles remis' : 'Oui, articles envoyés', onPress: async () => {
        confirmationRef.current = false;
        if (processingRef.current) return;
        beginProcessing();
        try {
          await confirmShipping(id, user.id);
          track('swap_shipping_confirmed', { swap_id: id, exchange_mode: swap?.exchangeMode ?? '', outcome: 'success' });
        } catch (error) {
          if (__DEV__) console.error('Error confirming shipping:', error);
          track('swap_shipping_confirmed', { swap_id: id, exchange_mode: swap?.exchangeMode ?? '', outcome: 'error' });
          Alert.alert('Erreur', handDelivery ? 'Impossible de confirmer la remise.' : 'Impossible de confirmer l’envoi.');
        } finally { endProcessing(); }
      } },
    ], { cancelable: true, onDismiss: () => { confirmationRef.current = false; } });
  }, [id, user, swap?.exchangeMode, beginProcessing, endProcessing]);

  const handleConfirmReception = useCallback(async () => {
    if (!id || !user || processingRef.current || confirmationRef.current) return;
    confirmationRef.current = true;
    Alert.alert('Confirmer la réception', 'Avez-vous reçu les articles convenus ?', [
      { text: 'Pas encore', style: 'cancel', onPress: () => { confirmationRef.current = false; } },
      { text: 'Oui, articles reçus', onPress: async () => {
        confirmationRef.current = false;
        if (processingRef.current) return;
        beginProcessing();
        try {
          await confirmReception(id, user.id);
          track('swap_reception_confirmed', { swap_id: id, exchange_mode: swap?.exchangeMode ?? '', outcome: 'success' });
        } catch (error) {
          if (__DEV__) console.error('Error confirming reception:', error);
          track('swap_reception_confirmed', { swap_id: id, exchange_mode: swap?.exchangeMode ?? '', outcome: 'error' });
          Alert.alert('Erreur', 'Impossible de confirmer la réception.');
        } finally { endProcessing(); }
      } },
    ], { cancelable: true, onDismiss: () => { confirmationRef.current = false; } });
  }, [id, user, swap?.exchangeMode, beginProcessing, endProcessing]);

  const swapInitiatorId = swap?.initiatorId;

  const handleRate = useCallback(
    async (score: number) => {
      if (!id || !user || processingRef.current) return;
      beginProcessing();
      try {
        await rateSwap(id, user.id, score);
        track('swap_rated', {
          swap_id: id,
          score,
          is_initiator: swapInitiatorId === user.id,
        });
        Alert.alert('Merci !', 'Votre évaluation a été enregistrée.');
      } catch (error) {
        if (__DEV__) console.error('Error rating swap:', error);
        Alert.alert('Erreur', "Impossible d'enregistrer la note");
      } finally {
        endProcessing();
      }
    },
    [id, user, swapInitiatorId, beginProcessing, endProcessing]
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

  if (!user && !isAuthLoading) {
    return <SafeAreaView style={styles.container} edges={['bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <SwapTopBar />
      <ScrollView contentContainerStyle={styles.errorContainer}>
        <Ionicons name="swap-horizontal-outline" size={44} color={colors.primary} />
        <Text variant="h1" center>Retrouvez votre échange</Text>
        <Text style={styles.errorText}>Connectez-vous avec le compte qui participe à cet échange.</Text>
        <Button style={styles.stateButton} onPress={() => showAuth('Connectez-vous pour consulter votre échange', undefined, { source: 'swap', gateKey: 'swap_detail' })}>Se connecter</Button>
      </ScrollView>
    </SafeAreaView>;
  }
  if (isLoading || isAuthLoading) {
    return <SafeAreaView style={styles.container} edges={['bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <SwapTopBar />
      <ScrollView><SwapDetailSkeleton /></ScrollView>
    </SafeAreaView>;
  }
  if (!swap || !participant) {
    return <SafeAreaView style={styles.container} edges={['bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <SwapTopBar />
      <ScrollView contentContainerStyle={styles.errorContainer}>
        <Ionicons name="alert-circle-outline" size={44} color={colors.primary} />
        <Text variant="h1" center>Échange indisponible</Text>
        <Text style={styles.errorText}>Cet échange n’a pas pu être chargé. Vérifiez votre connexion et le compte utilisé.</Text>
        <Button style={styles.stateButton} onPress={() => setRetryCount(count => count + 1)}>Réessayer</Button>
        <Button variant="ghost" style={styles.stateButton} onPress={() => router.replace('/my-swaps')}>Voir mes échanges</Button>
      </ScrollView>
    </SafeAreaView>;
  }
  const otherUserId = participant.isInitiator ? swap.receiverId : swap.initiatorId;
  const payer = swap.cashTopUp?.payerId === user?.id ? 'you' : swap.cashTopUp?.payerId === otherUserId ? 'other' : 'unknown';
  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <SwapTopBar />
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        {swap.status === 'proposed' ? (
          <SwapProposalView
            senderName={participant.senderName}
            senderImage={participant.senderImage}
            message={swap.message}
            senderItems={participant.senderItems}
            myItems={participant.myItems}
            cashTopUp={swap.cashTopUp}
            isInitiator={participant.isInitiator}
            currentUserId={user?.id}
            otherUserId={otherUserId}
          />
        ) : (
          <SwapStatusView
            status={swap.status}
            senderName={participant.senderName}
            senderImage={participant.senderImage}
            senderItems={participant.senderItems}
            myItems={participant.myItems}
            cashTopUpAmount={swap.cashTopUp?.amount}
            cashTopUpPayer={payer}
            isInitiator={participant.isInitiator}
            nextStep={getSwapNextStep(swap, user?.id || '')}
          />
        )}
        {!(swap.status === 'proposed' && participant.isReceiver) && (
          <SwapActions status={swap.status} participant={participant} handlers={actionHandlers} isProcessing={isProcessing} exchangeMode={swap.exchangeMode} />
        )}
        {swap.status !== 'declined' && swap.status !== 'cancelled' && <SwapContactButton otherUserId={otherUserId} otherUserName={participant.senderName} />}
      </ScrollView>
      {swap.status === 'proposed' && participant.isReceiver && <SwapStickyActions onAccept={() => handleAccept('sticky_bar')} onDecline={handleDecline} isProcessing={isProcessing} />}
      {PAYMENTS_ENABLED && clientSecret && <StripePayment clientSecret={clientSecret} visible={showStripePayment} onResult={handlePaymentResult} />}
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  errorContainer: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', gap: spacing.md, padding: spacing.lg },
  errorText: { color: colors.foregroundSecondary, textAlign: 'center' },
  stateButton: { height: 'auto', minHeight: 48, paddingVertical: spacing.md },
  scrollView: { flex: 1 },
  scrollContent: { paddingBottom: spacing.xl },
});
