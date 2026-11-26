/**
 * Swap Detail Screen -- Multi-Article Support
 * Design System: HTML UI Kit (Charcoal, Sage, Rust)
 * Phone 5: Demande recue -- Accepter / Refuser
 */

import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { StyleSheet, ScrollView, Alert, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, router, useLocalSearchParams, useFocusEffect } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';

import { randomUUID } from 'expo-crypto';
import { useQueryClient } from '@tanstack/react-query';
import { createCompletedSwapCacheReconciler } from '@/lib/withdrawnArticleCache';
import { privateMediaUrl } from '@/utils/privateMedia';
import { prepareImageForUpload } from '@/utils/imageUtils';
import { uploadPreparedJpeg } from '@/services/nativeStorageUpload';
import { staleTradeOperation } from '@/services/tradeOperation';
import { track } from '@/lib/analytics';
import { useIsLoading, useAuthenticatedUid } from '@/hooks/useAuth';
import { useShippingPurchaseContext } from '@/hooks/useShippingPurchaseContext';
import { useLabelLifecycleContext } from '@/hooks/useLabelLifecycleContext';
import { getAuthSessionGeneration, useAuthStore } from '@/store/authStore';
import { useEligibility } from '@/hooks/useEligibility';
import { useTradeAdmissionError } from '@/hooks/useTradeAdmissionError';
import { useSwapAgreement } from '@/features/swap/hooks/useSwapAgreement';
import { useAuthSheetStore } from '@/store/authSheetStore';
import { auth, storage } from '@/config/firebaseConfig';
import {
  acceptSwap,
  declineSwap,
  cancelSwap,
  setExchangeMode,
  uploadSwapPhotos,
  confirmShipping,
  confirmReception,
  rateSwap,
  subscribeToSwap,
  getSwapItems,
  decodeSwapAgreementPreview,
} from '@/services/swapService';
import { Swap, SwapExchangeMode } from '@/types';
import { colors, spacing, typography } from '@/constants/theme';
import { Text, Button } from '@/components/ui';
import { SwapTopUpCheckoutPanel } from '@/components/SwapTopUpCheckoutPanel';
import { SwapTopUpCheckoutJournal } from '@/components/SwapTopUpCheckoutJournal';
import { createSwapTopUpInteraction } from '@/utils/swapTopUpCheckoutPresentation';
import {
  SwapDetailSkeleton,
  SwapTopBar,
  SwapProposalView,
  SwapStatusView,
  SwapHoldReviewNotice,
  SwapActions,
  SwapContactButton,
  SwapStickyActions,
  getSwapNextStep,
  getSwapPhotoCount,
  hasSwapAgreementConfirmations,
  SwapAgreementReview,
  SwapArrangementFields,
  SwapActionSheet,
  SwapProofPhotos,
  SwapLaunchAdmissionSheet,
} from '@/features/swap';
import type {
  SwapActionHandlers,
  SwapParticipantContext,
} from '@/features/swap';

const SWAP_VIEW_SOURCES = [
  'my_swaps',
  'push',
  'post_proposal',
  'deep_link',
] as const;
type SwapViewSource = (typeof SWAP_VIEW_SOURCES)[number];
interface LocalPhotoSelection {
  owner: NonNullable<typeof auth.currentUser>;
  uid: string;
  source: string;
  expiresAt: number;
  uris: string[];
}

export default function SwapDetailScreen() {
  const { id, source: sourceParam } = useLocalSearchParams<{
    id: string;
    source?: string;
  }>();
  const viewSource: SwapViewSource = SWAP_VIEW_SOURCES.includes(
    sourceParam as SwapViewSource,
  )
    ? (sourceParam as SwapViewSource)
    : 'deep_link';
  const userId = useAuthenticatedUid();
  const queryClient = useQueryClient();
  const generation = useAuthStore(getAuthSessionGeneration);
  const isAuthLoading = useIsLoading();
  const showAuth = useAuthSheetStore((state) => state.show);

  const [delivery, setDelivery] = useState<{
    key: string;
    swap: Swap | null;
    checking?: boolean;
  } | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [admissionOpen, setAdmissionOpen] = useState(false);
  const context = useShippingPurchaseContext(JSON.stringify(['swap-detail', id, retryCount]), userId);
  const subscriptionKey = JSON.stringify([id, userId, generation, retryCount, context.focusRevision]);
  const canMutate = !!userId && context.focused;
  const mutationAllowed = useCallback(() => {try {context.capture(); return canMutate;} catch {return false;}}, [canMutate, context]);
  const swap = context.focused && delivery?.key === subscriptionKey ? delivery.swap : null;
  const processingRef = useRef(false);
  const pickerRef = useRef<symbol | null>(null);
  const eligibility = useEligibility();
  const showAdmissionError = useTradeAdmissionError();
  const [tool, setTool] = useState<'options' | 'payment' | 'conditions' | 'photos' | 'hold' | 'payment-history' | null>(null);
  const [review, setReview] = useState<{action: 'accept' | 'prepare'; key: string} | null>(null);
  const [preparationMode, setPreparationMode] = useState<SwapExchangeMode | null>(null);
  const [preparationArrangements, setPreparationArrangements] = useState('');
  const nativeTerms = swap?.exchangeAgreement;
  const commercialSource = swap ? [swap.initiatorId, swap.receiverId, getSwapItems(swap, 'initiator'), getSwapItems(swap, 'receiver'), swap.message ?? null, swap.cashTopUp ?? null] : null;
  const termsSource = nativeTerms ? [nativeTerms.protocol, nativeTerms.scope, nativeTerms.sourceHash, nativeTerms.termsVersion,
    nativeTerms.termsText, nativeTerms.exchangeMode, nativeTerms.arrangements] : null;
  const historySourceKey = JSON.stringify(['swap-existing-action', id, swap?.status, swap?.updatedAt?.getTime() ?? null, swap?.initiatorShippedAt ?? null, swap?.receiverShippedAt ?? null, swap?.initiatorReceivedAt ?? null, swap?.receiverReceivedAt ?? null, commercialSource, nativeTerms?.exchangeMode ?? swap?.exchangeMode ?? null, termsSource]);
  const historyContext = useLabelLifecycleContext(historySourceKey, userId);
  const photoContextRef = useRef({key: '', sourceReady: false, context: historyContext});
  const [selectedPhotos, setSelectedPhotos] = useState<LocalPhotoSelection | null>(null);
  const selectedPhotosRef = useRef<LocalPhotoSelection | null>(null);
  const pickerOwnerRef = useRef<Pick<LocalPhotoSelection, 'owner' | 'uid'> | null>(null);
  const clearSelectedPhotos = useCallback(() => {selectedPhotosRef.current = null; setSelectedPhotos(null);}, [setSelectedPhotos]);
  // This describes local files only. Every explicit send captures the CURRENT
  // session generation again; no permission is carried through the picker.
  const photoSourceKey = JSON.stringify([id, userId, historySourceKey]);
  useLayoutEffect(() => {
    photoContextRef.current = {key: photoSourceKey, sourceReady: !!swap, context: historyContext};
    if (swap && selectedPhotosRef.current && selectedPhotosRef.current.source !== photoSourceKey) clearSelectedPhotos();
  }, [photoSourceKey, historyContext, swap, clearSelectedPhotos]);
  useFocusEffect(useCallback(() => () => {
    pickerRef.current = null; pickerOwnerRef.current = null; clearSelectedPhotos();
  }, [clearSelectedPhotos]));
  useEffect(() => {
    pickerRef.current = null; pickerOwnerRef.current = null; selectedPhotosRef.current = null;
    let cancelled = false;
    void Promise.resolve().then(() => {if (!cancelled) setSelectedPhotos(null);});
    return () => {cancelled = true;};
  }, [id, userId, setSelectedPhotos]);
  useEffect(() => useAuthStore.subscribe(state => {
    const pickerOwner = pickerOwnerRef.current;
    if (pickerOwner && (state.authenticatedUid !== pickerOwner.uid || auth.currentUser !== pickerOwner.owner)) {
      pickerRef.current = null; pickerOwnerRef.current = null;
    }
    const selected = selectedPhotosRef.current;
    if (selected && (state.authenticatedUid !== selected.uid || auth.currentUser !== selected.owner)) clearSelectedPhotos();
  }), [clearSelectedPhotos]);
  useEffect(() => {
    if (!selectedPhotos) return;
    const timer = setTimeout(() => {
      if (selectedPhotosRef.current === selectedPhotos) clearSelectedPhotos();
    }, Math.max(0, selectedPhotos.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [selectedPhotos, clearSelectedPhotos]);
  const sourceKey = JSON.stringify(['swap-agreement', id, commercialSource,
    nativeTerms?.exchangeMode ?? swap?.exchangeMode ?? preparationMode, nativeTerms?.arrangements ?? preparationArrangements.trim()]);
  const agreement = useSwapAgreement(userId, sourceKey, nativeTerms ?? null);
  const storedAgreement = useMemo(() => {
    if (!swap?.exchangeAgreement) return null;
    try { return decodeSwapAgreementPreview({...swap.exchangeAgreement, initiatorId: swap.initiatorId,
      receiverId: swap.receiverId, initiatorItems: getSwapItems(swap, 'initiator'), receiverItems: getSwapItems(swap, 'receiver'),
      cashTopUp: swap.cashTopUp ?? null, message: swap.message?.trim() || null}); } catch { return null; }
  }, [swap]);
  const agreementReady = !!swap && !!storedAgreement && hasSwapAgreementConfirmations(swap);
  const ownAdmission = eligibility.data?.swapLaunch?.policyVersion === '2026-10-17.v1' && eligibility.data.swapLaunch.allowed === true && !eligibility.isFetching && !eligibility.isError;
  const effectiveMode = storedAgreement?.exchangeMode ?? swap?.exchangeMode ?? preparationMode;
  const effectiveArrangements = storedAgreement?.arrangements ?? preparationArrangements;
  const readAgreement = async (action: 'accept' | 'prepare') => {
    let operation: ReturnType<typeof agreement.context.capture> | null = null;
    try {
      if (!swap || !userId || processingRef.current) return;
      operation = agreement.context.capture();
      if (storedAgreement) agreement.show(storedAgreement);
      else if (swap.status === 'accepted' && effectiveMode && effectiveArrangements.trim()) {
        await agreement.read({operation: 'swap_exchange_preview', expectedUid: userId, swapId: swap.id,
          exchangeMode: effectiveMode, arrangements: effectiveArrangements.trim()});
      }
      setReview({action, key: sourceKey});
    } catch {if (operation && agreement.context.isCurrent(operation)) Alert.alert('Lecture impossible', 'La proposition n’a pas pu être chargée. Réessayez dans un instant.');}
  };
  const isLoading = !!id && !!userId && (delivery?.key !== subscriptionKey || delivery.checking === true);
  const viewedRef = useRef<string | null>(null);
  const confirmationRef = useRef<symbol | null>(null);
  const processingOwner = useRef<symbol | null>(null);
  const beginProcessing = useCallback(() => {
    const token = Symbol(); processingOwner.current = token;
    processingRef.current = true; setIsProcessing(true); return token;
  }, [setIsProcessing]);
  const endProcessing = useCallback((token: symbol) => {
    if (processingOwner.current !== token) return;
    processingOwner.current = null; processingRef.current = false; setIsProcessing(false);
  }, []);
  const [previousActionContext, setPreviousActionContext] = useState({frame: historyContext.frame, focus: historyContext.focusRevision});
  if (previousActionContext.frame !== historyContext.frame || previousActionContext.focus !== historyContext.focusRevision) {
    setPreviousActionContext({frame: historyContext.frame, focus: historyContext.focusRevision}); setIsProcessing(false);
  }
  useLayoutEffect(() => {
    processingOwner.current = null; processingRef.current = false; confirmationRef.current = null;
  }, [historyContext.frame, historyContext.focusRevision]);

  const topUpContext = useLabelLifecycleContext(`swap-detail-topup:${id}`, userId);
  const topUpKey = JSON.stringify([id, userId, generation, topUpContext.focusRevision]);
  const [topUpInteraction] = useState(createSwapTopUpInteraction);
  const [topUpView, setTopUpView] = useState<{key: string; revision: number} | null>(null);
  const assertTopUpChoice = topUpInteraction.capture();
  const assertTopUpSelection = () => {topUpContext.capture(); assertTopUpChoice();};

  // -----------------------------------------------------------------------
  // Real-time subscription
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (!id || !userId || !context.focused) return;
    try {
      const operation = context.capture();
      const reconcileCatalogue = createCompletedSwapCacheReconciler(queryClient, operation.session.uid,
        () => context.assertCurrent(operation));
      return subscribeToSwap(id, (swapData) => {
        context.assertCurrent(operation); setDelivery({ key: subscriptionKey, swap: swapData });
        // Reception RPC success alone does not establish completion. Both
        // participants reconcile from this current server-authorized delivery.
        void reconcileCatalogue(swapData).catch(() => undefined);
      }, {expectedUid: operation.session.uid, assertContext: () => context.assertCurrent(operation), onChecking: () => {context.assertCurrent(operation); setDelivery({key: subscriptionKey, swap: null, checking: true});}});
    } catch {void Promise.resolve().then(() => setDelivery({key: subscriptionKey, swap: null}));}
  // subscriptionKey owns the captured identity, route, focus and generation.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, userId, subscriptionKey, context.focused, queryClient]);

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
    if (!swap || !userId) return null;

    const isInitiator = swap.initiatorId === userId;
    const isReceiver = swap.receiverId === userId;
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
      isTopUpPayer: !!payerId && payerId === userId,
      topUpPayerName: payerName,
      senderName: isInitiator ? swap.receiverName : swap.initiatorName,
      senderImage: isInitiator ? swap.receiverImage : swap.initiatorImage,
      senderItems: isInitiator
        ? getSwapItems(swap, 'receiver')
        : getSwapItems(swap, 'initiator'),
      myItems: isInitiator
        ? getSwapItems(swap, 'initiator')
        : getSwapItems(swap, 'receiver'),
      hasUploadedPhotos: getSwapPhotoCount(swap, isInitiator ? 'initiator' : 'receiver') > 0,
      hasSelectedPhotos: !!selectedPhotos && selectedPhotos.uid === userId && selectedPhotos.source === photoSourceKey,
      hasConfirmedShipping: isInitiator
        ? !!swap.initiatorShippedAt
        : !!swap.receiverShippedAt,
      counterpartHasShipped: isInitiator ? !!swap.receiverShippedAt : !!swap.initiatorShippedAt,
      hasConfirmedReception: isInitiator
        ? !!swap.initiatorReceivedAt
        : !!swap.receiverReceivedAt,
      hasRated: isInitiator ? !!swap.initiatorRating : !!swap.receiverRating,
    };
  }, [swap, userId, selectedPhotos, photoSourceKey]);

  // -----------------------------------------------------------------------
  // Action handlers
  // -----------------------------------------------------------------------
  const handleAccept = useCallback(
    async (surface: 'sticky_bar' | 'inline' = 'inline') => {
      if (!id || !mutationAllowed() || processingRef.current) return;
      let errorOperation: ReturnType<typeof agreement.context.capture>;
      try {errorOperation = agreement.context.capture();} catch {return;}
      const cashTopUpCents = swap?.cashTopUp?.amount ?? 0;
      const processing = beginProcessing();
      try {
        if (!ownAdmission || !storedAgreement) throw new Error('Relisez vos renseignements et les conditions de la proposition.');
        const consent = agreement.captureConsent();
        const result = await acceptSwap(id, consent.acknowledgement, consent.assertCurrent);
        consent.assertCurrent();
        setReview(null);
        if (result.replay || !['accepted', 'photos_pending', 'payment_pending'].includes(result.status)) return;
        track('swap_accepted', {
          swap_id: id,
          outcome: 'success',
          surface,
          cash_top_up_cents: cashTopUpCents,
        });
      } catch (error) {
        if (!agreement.context.isCurrent(errorOperation)) return;
        if (__DEV__) console.error('Error accepting swap:', error);
        track('swap_accepted', {
          swap_id: id,
          outcome: 'error',
          surface,
          cash_top_up_cents: cashTopUpCents,
        });
        if (!showAdmissionError(error, {isCurrent: () => agreement.context.isCurrent(errorOperation)}))
          Alert.alert('Acceptation impossible', 'Relisez vos renseignements et confirmez les conditions exactes de la proposition. Les renseignements de l’autre membre restent privés.');
      } finally {
        endProcessing(processing);
      }
    },
    [id, swap?.cashTopUp?.amount, beginProcessing, endProcessing, mutationAllowed, ownAdmission, storedAgreement, agreement, showAdmissionError],
  );

  const handleDecline = useCallback(async () => {
    if (!mutationAllowed() || processingRef.current || confirmationRef.current) return;
    let operation: ReturnType<typeof historyContext.capture>;
    try { operation = historyContext.capture(); } catch { return; }
    const confirmation = Symbol(); confirmationRef.current = confirmation;
    let dispatched = false;
    const closeConfirmation = () => {if (confirmationRef.current === confirmation) confirmationRef.current = null;};
    Alert.alert(
      "Refuser l'échange",
      'Souhaitez-vous refuser cette proposition ?',
      [
        {
          text: 'Revenir à la proposition',
          style: 'cancel',
          onPress: () => {
            closeConfirmation();
          },
        },
        {
          text: 'Refuser',
          style: 'destructive',
          onPress: async () => {
            if (dispatched || confirmationRef.current !== confirmation || !id || !historyContext.isCurrent(operation) || processingRef.current) return;
            dispatched = true; closeConfirmation();
            const cashTopUpCents = swap?.cashTopUp?.amount ?? 0;
            const processing = beginProcessing();
            try {
              await declineSwap(id, {expectedUid: operation.base.session.uid, assertCurrent: () => historyContext.assertCurrent(operation)});
              historyContext.assertCurrent(operation);
              track('swap_declined', {
                swap_id: id,
                outcome: 'success',
                cash_top_up_cents: cashTopUpCents,
              });
            } catch (error) {
              if (!historyContext.isCurrent(operation)) return;
              if (__DEV__) console.error('Error declining swap:', error);
              track('swap_declined', {
                swap_id: id,
                outcome: 'error',
                cash_top_up_cents: cashTopUpCents,
              });
              Alert.alert('Erreur', "Impossible de refuser l'échange");
            } finally {
              endProcessing(processing);
            }
          },
        },
      ],
      {
        cancelable: true,
        onDismiss: () => {
          closeConfirmation();
        },
      },
    );
  }, [id, swap?.cashTopUp?.amount, beginProcessing, endProcessing, mutationAllowed, historyContext]);

  const handlePayTopUp = useCallback(() => {
    if (!id || !userId) return;
    try {topUpContext.capture(); topUpInteraction.invalidate(); setTopUpView(previous => ({key: topUpKey, revision: (previous?.revision ?? 0) + 1})); setTool('payment');}
    catch { /* Reading a payment never falls back to the old autonomous sheet. */ }
  }, [id, userId, topUpContext, topUpInteraction, topUpKey, setTool, setTopUpView]);

  const handleCancel = useCallback(async () => {
    if (!mutationAllowed() || processingRef.current || confirmationRef.current) return;
    let operation: ReturnType<typeof historyContext.capture>;
    try { operation = historyContext.capture(); } catch { return; }
    const confirmation = Symbol(); confirmationRef.current = confirmation;
    let dispatched = false;
    const closeConfirmation = () => {if (confirmationRef.current === confirmation) confirmationRef.current = null;};
    Alert.alert(
      "Annuler l'échange",
      'Souhaitez-vous annuler cette proposition ?',
      [
        {
          text: 'Conserver la proposition',
          style: 'cancel',
          onPress: () => {
            closeConfirmation();
          },
        },
        {
          text: 'Oui, annuler',
          style: 'destructive',
          onPress: async () => {
            if (dispatched || confirmationRef.current !== confirmation || !id || !historyContext.isCurrent(operation) || processingRef.current) return;
            dispatched = true; closeConfirmation();
            const processing = beginProcessing();
            try {
              await cancelSwap(id, {expectedUid: operation.base.session.uid, assertCurrent: () => historyContext.assertCurrent(operation)});
              historyContext.assertCurrent(operation);
              track('swap_cancelled', { swap_id: id, outcome: 'success' });
              if (router.canGoBack()) router.back();
              else router.replace('/my-swaps');
            } catch (error) {
              if (!historyContext.isCurrent(operation)) return;
              if (__DEV__) console.error('Error cancelling swap:', error);
              track('swap_cancelled', { swap_id: id, outcome: 'error' });
              Alert.alert('Erreur', "Impossible d'annuler l'échange");
            } finally {
              endProcessing(processing);
            }
          },
        },
      ],
      {
        cancelable: true,
        onDismiss: () => {
          closeConfirmation();
        },
      },
    );
  }, [id, beginProcessing, endProcessing, mutationAllowed, historyContext]);

  const handleSetExchangeMode = async (mode: SwapExchangeMode) => {
      if (!id || !mutationAllowed() || processingRef.current) return;
      try {
        agreement.invalidate(); setPreparationMode(mode);
      } catch (error) {
        if (__DEV__) console.error('Error setting exchange mode:', error);
        Alert.alert('Erreur', "Impossible de définir le mode d'échange");
      }
  };
  const prepareConfirmedAgreement = async () => {
    if (!swap || !userId || !storedAgreement || !agreementReady || processingRef.current) return;
    let operation: ReturnType<typeof historyContext.capture>; try {operation = historyContext.capture();} catch {return;}
    const processing = beginProcessing();
    try {
      // Both members already confirmed this exact source. Advance preparation
      // without displaying or constructing a third contractual confirmation.
      await setExchangeMode(swap.id, storedAgreement.exchangeMode, {expectedUid: userId,
        agreementProtocol: storedAgreement.protocol, expectedSourceHash: storedAgreement.sourceHash,
        arrangements: storedAgreement.arrangements}, () => historyContext.assertCurrent(operation));
    } catch {if (historyContext.isCurrent(operation)) Alert.alert('Préparation indisponible', 'Réessayez dans un instant. Votre échange est conservé.');}
    finally {endProcessing(processing);}
  };
  const handlePrepare = async () => {
    if (!id || !mutationAllowed() || processingRef.current) return;
    let operation: ReturnType<typeof agreement.context.capture>; try {operation = agreement.context.capture();} catch {return;}
    const processing = beginProcessing();
    try {
      const consent = agreement.captureConsent();
      const result = await setExchangeMode(id, consent.preview.exchangeMode,
        {...consent.acknowledgement, arrangements: consent.preview.arrangements}, consent.assertCurrent);
      consent.assertCurrent();
      if (result.success) setReview(null);
    } catch {if (agreement.context.isCurrent(operation)) Alert.alert('Préparation indisponible', 'La préparation n’a pas pu être confirmée. Votre échange est conservé.');}
    finally { endProcessing(processing); }
  };

  const handleUploadPhotos = useCallback(async () => {
    if (!id || !userId || !mutationAllowed() || processingRef.current || pickerRef.current) return;
    let operation: ReturnType<typeof historyContext.capture>;
    try {operation = historyContext.capture();} catch {return;}
    const selection = selectedPhotosRef.current;
    if (selection) {
      const assertPhotoCurrent = () => {
        const current = photoContextRef.current;
        current.context.assertCurrent(operation);
        if (selectedPhotosRef.current !== selection || selection.uid !== operation.base.session.uid ||
            auth.currentUser !== selection.owner || Date.now() >= selection.expiresAt ||
            !current.sourceReady || current.key !== selection.source) throw staleTradeOperation();
      };
      const processing = beginProcessing();
      try {
        assertPhotoCurrent();
        const uploadedUrls = await Promise.all(selection.uris.map(async (uri, i) => {
          const compressedUri = await prepareImageForUpload(uri);
          assertPhotoCurrent();
          const storagePath = `swaps/${id}/photos/${userId}/${i}_${randomUUID()}.jpg`;
          await uploadPreparedJpeg({ownerUid: operation.base.session.uid, path: storagePath, localUri: compressedUri,
            assertContext: assertPhotoCurrent});
          assertPhotoCurrent();
          return privateMediaUrl(storage.app.options.storageBucket!, storagePath);
        }));
        assertPhotoCurrent();
        await uploadSwapPhotos(id, operation.base.session.uid, uploadedUrls, assertPhotoCurrent);
        if (selectedPhotosRef.current === selection) clearSelectedPhotos();
        track('swap_photos_uploaded', {swap_id: id, photos_count: uploadedUrls.length, outcome: 'success'});
      } catch {
        if (photoContextRef.current.context.isCurrent(operation)) {
          Alert.alert('Envoi des photos indisponible', 'Relisez cet échange et réessayez. Vos articles sont conservés.');
        }
      } finally {endProcessing(processing);}
      return;
    }

    const owner = auth.currentUser;
    if (!owner || owner.uid !== userId) return;
    const picker = Symbol(); pickerRef.current = picker; pickerOwnerRef.current = {owner, uid: userId};
    const source = photoSourceKey;
    const expiresAt = Date.now() + 120_000;
    const processing = beginProcessing();
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'] as const, allowsMultipleSelection: true, quality: 0.8, exif: false, selectionLimit: 4,
        preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
      });
      // A native picker may cause normal same-owner foreground hydration. It
      // returns LOCAL FILES ONLY. A separate tap will acquire a new permission.
      // The synchronous Auth watcher also invalidates an intermediate B in A→B→A.
      if (pickerRef.current !== picker || auth.currentUser !== owner ||
          useAuthStore.getState().authenticatedUid !== userId || Date.now() >= expiresAt) return;
      if (result.canceled) return;
      if (!result.assets.length || result.assets.length > 4) {
        Alert.alert('Choisir vos photos', 'Sélectionnez 1 à 4 photos de vos articles.'); return;
      }
      const selected = {owner, uid: userId, source, expiresAt, uris: result.assets.map(asset => asset.uri)};
      selectedPhotosRef.current = selected; setSelectedPhotos(selected);
    } catch {
      if (pickerRef.current === picker && auth.currentUser === owner) {
        Alert.alert('Photos indisponibles', 'Choisissez à nouveau vos photos depuis cet échange.');
      }
    } finally {
      if (pickerRef.current === picker) {pickerRef.current = null; pickerOwnerRef.current = null;}
      endProcessing(processing);
    }
  }, [id, userId, beginProcessing, endProcessing, mutationAllowed, historyContext, photoSourceKey, clearSelectedPhotos]);

  const handleConfirmShipping = useCallback(async () => {
    if (!id || !userId || !mutationAllowed() || processingRef.current || confirmationRef.current)
      return;
    const handDelivery = swap?.exchangeMode === 'hand_delivery';
    let operation: ReturnType<typeof historyContext.capture>;
    try { operation = historyContext.capture(); } catch { return; }
    const confirmation = Symbol(); confirmationRef.current = confirmation;
    let dispatched = false;
    const closeConfirmation = () => {if (confirmationRef.current === confirmation) confirmationRef.current = null;};
    Alert.alert(
      handDelivery ? 'Confirmer la remise' : 'Confirmer l’envoi',
      handDelivery
        ? 'Avez-vous remis vos articles au membre ?'
        : 'Avez-vous envoyé vos articles au membre ?',
      [
        {
          text: 'Pas encore',
          style: 'cancel',
          onPress: () => {
            closeConfirmation();
          },
        },
        {
          text: handDelivery ? 'Oui, articles remis' : 'Oui, articles envoyés',
          onPress: async () => {
            if (dispatched || confirmationRef.current !== confirmation || !historyContext.isCurrent(operation) || processingRef.current) return;
            dispatched = true; closeConfirmation();
            const processing = beginProcessing();
            try {
              await confirmShipping(id, operation.base.session.uid, () => historyContext.assertCurrent(operation));
              historyContext.assertCurrent(operation);
              track('swap_shipping_confirmed', {
                swap_id: id,
                exchange_mode: swap?.exchangeMode ?? '',
                outcome: 'success',
              });
            } catch (error) {
              if (!historyContext.isCurrent(operation)) return;
              if (__DEV__) console.error('Error confirming shipping:', error);
              track('swap_shipping_confirmed', {
                swap_id: id,
                exchange_mode: swap?.exchangeMode ?? '',
                outcome: 'error',
              });
              Alert.alert(
                'Erreur',
                handDelivery
                  ? 'Impossible de confirmer la remise.'
                  : 'Impossible de confirmer l’envoi.',
              );
            } finally {
              endProcessing(processing);
            }
          },
        },
      ],
      {
        cancelable: true,
        onDismiss: () => {
          closeConfirmation();
        },
      },
    );
  }, [id, userId, swap?.exchangeMode, beginProcessing, endProcessing, mutationAllowed, historyContext]);

  const handleConfirmReception = useCallback(async () => {
    if (!id || !userId || !mutationAllowed() || processingRef.current || confirmationRef.current)
      return;
    let operation: ReturnType<typeof historyContext.capture>;
    try { operation = historyContext.capture(); } catch { return; }
    const confirmation = Symbol(); confirmationRef.current = confirmation;
    let dispatched = false;
    const closeConfirmation = () => {if (confirmationRef.current === confirmation) confirmationRef.current = null;};
    Alert.alert(
      'Confirmer la réception',
      'Avez-vous reçu les articles convenus ?',
      [
        {
          text: 'Pas encore',
          style: 'cancel',
          onPress: () => {
            closeConfirmation();
          },
        },
        {
          text: 'Oui, articles reçus',
          onPress: async () => {
            if (dispatched || confirmationRef.current !== confirmation || !historyContext.isCurrent(operation) || processingRef.current) return;
            dispatched = true; closeConfirmation();
            const processing = beginProcessing();
            try {
              await confirmReception(id, operation.base.session.uid, () => historyContext.assertCurrent(operation));
              historyContext.assertCurrent(operation);
              track('swap_reception_confirmed', {
                swap_id: id,
                exchange_mode: swap?.exchangeMode ?? '',
                outcome: 'success',
              });
            } catch (error) {
              if (!historyContext.isCurrent(operation)) return;
              if (__DEV__) console.error('Error confirming reception:', error);
              track('swap_reception_confirmed', {
                swap_id: id,
                exchange_mode: swap?.exchangeMode ?? '',
                outcome: 'error',
              });
              Alert.alert('Erreur', 'Impossible de confirmer la réception.');
            } finally {
              endProcessing(processing);
            }
          },
        },
      ],
      {
        cancelable: true,
        onDismiss: () => {
          closeConfirmation();
        },
      },
    );
  }, [id, userId, swap?.exchangeMode, beginProcessing, endProcessing, mutationAllowed, historyContext]);

  const swapInitiatorId = swap?.initiatorId;

  const handleRate = useCallback(
    async (score: number) => {
      if (!id || !userId || !mutationAllowed() || processingRef.current) return;
      let operation: ReturnType<typeof historyContext.capture>;
      try {operation = historyContext.capture();} catch {return;}
      const processing = beginProcessing();
      try {
        await rateSwap(id, operation.base.session.uid, score, undefined, () => historyContext.assertCurrent(operation));
        historyContext.assertCurrent(operation);
        track('swap_rated', {
          swap_id: id,
          score,
          is_initiator: swapInitiatorId === userId,
        });

      } catch (error) {
        if (!historyContext.isCurrent(operation)) return;
        if (__DEV__) console.error('Error rating swap:', error);
        Alert.alert('Erreur', "Impossible d'enregistrer la note");
      } finally {
        endProcessing(processing);
      }
    },
    [id, userId, swapInitiatorId, beginProcessing, endProcessing, mutationAllowed, historyContext],
  );

  const actionHandlers: SwapActionHandlers = {
    onAccept: () => {void readAgreement('accept');}, onDecline: handleDecline, onCancel: handleCancel,
    onPayTopUp: handlePayTopUp, onSetExchangeMode: handleSetExchangeMode, onUploadPhotos: handleUploadPhotos,
    onConfirmShipping: handleConfirmShipping, onConfirmReception: handleConfirmReception, onRate: handleRate,
  };

  if (!userId && !isAuthLoading) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <Stack.Screen options={{ headerShown: false }} />
        <SwapTopBar />
        <ScrollView contentContainerStyle={styles.errorContainer}>
          <Text style={styles.stateTitle} center>
            Retrouvez votre échange
          </Text>
          <Text style={styles.errorText}>
            Connectez-vous avec le compte qui participe à cet échange.
          </Text>
          <Button
            style={styles.stateButton}
            onPress={() =>
              showAuth(
                'Connectez-vous pour consulter votre échange',
                undefined,
                { source: 'swap', gateKey: 'swap_detail' },
              )
            }
          >
            Se connecter
          </Button>
        </ScrollView>
      </SafeAreaView>
    );
  }
  if (isLoading || isAuthLoading) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <Stack.Screen options={{ headerShown: false }} />
        <SwapTopBar />
        <ScrollView>
          <SwapDetailSkeleton />
        </ScrollView>
      </SafeAreaView>
    );
  }
  if (!swap || !participant || !userId) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <Stack.Screen options={{ headerShown: false }} />
        <SwapTopBar />
        <ScrollView contentContainerStyle={styles.errorContainer}>
          <Text style={styles.stateTitle} center>
            Échange indisponible
          </Text>
          <Text style={styles.errorText}>
            Cet échange n’a pas pu être chargé. Vérifiez votre connexion et le
            compte utilisé.
          </Text>
          <Button
            style={styles.stateButton}
            onPress={() => setRetryCount((count) => count + 1)}
          >
            Réessayer
          </Button>
          <Button
            variant="ghost"
            style={styles.stateButton}
            onPress={() => router.replace('/my-swaps')}
          >
            Voir mes échanges
          </Button>
        </ScrollView>
      </SafeAreaView>
    );
  }
  const otherUserId = participant.isInitiator
    ? swap.receiverId
    : swap.initiatorId;
  const payer =
    swap.cashTopUp?.payerId === userId
      ? 'you'
      : swap.cashTopUp?.payerId === otherUserId
        ? 'other'
        : 'unknown';
  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <SwapTopBar
        isProposal={swap.status === 'proposed'}
        memberName={participant.senderName}
        onOptions={() => {try {historyContext.capture(); setTool('options');} catch {return;}}}
      />
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
      >
        {swap.status === 'proposed' ? (
          <SwapProposalView
            swapId={swap.id}
            articlePrivacyWithdrawals={swap.articlePrivacyWithdrawals}
            senderName={participant.senderName}
            senderImage={participant.senderImage}
            message={swap.message}
            senderItems={participant.senderItems}
            myItems={participant.myItems}
            cashTopUp={swap.cashTopUp}
            isInitiator={participant.isInitiator}
            currentUserId={userId ?? undefined}
            otherUserId={otherUserId}
          />
        ) : (
          <SwapStatusView
            swapId={swap.id}
            articlePrivacyWithdrawals={swap.articlePrivacyWithdrawals}
            acceptedAgreement={!!swap.acceptedAt && Number.isFinite(swap.acceptedAt.getTime()) && !['proposed', 'declined'].includes(swap.status)}
            status={swap.status}
            senderName={participant.senderName}
            senderImage={participant.senderImage}
            senderItems={participant.senderItems}
            myItems={participant.myItems}
            cashTopUpAmount={swap.cashTopUp?.amount}
            cashTopUpPayer={payer}
            isInitiator={participant.isInitiator}
            nextStep={
              getSwapNextStep(swap, userId || '')
            }
          />
        )}
        {effectiveMode ? <View style={styles.arrangement}>
          <Text style={styles.arrangementTitle}>{effectiveMode === 'shipping' ? 'Envoi postal entre membres' : 'Remise en main propre'}</Text>
          {effectiveArrangements ? <Text style={styles.arrangementBody}>{effectiveArrangements}</Text> : null}
          {effectiveMode === 'shipping' ? <Text style={styles.arrangementBody}>Envoi et frais à organiser entre vous.</Text> : null}
        </View> : null}
        {swap.status === 'proposed' && participant.isReceiver && !ownAdmission ? <View style={styles.arrangement}>
          <Text style={styles.arrangementBody}>{eligibility.isError ? 'Impossible de charger vos renseignements pour le moment.' : 'Complétez vos renseignements pour proposer un échange.'}</Text>
          <Button variant="secondary" onPress={() => setAdmissionOpen(true)}>Compléter mes renseignements</Button>
        </View> : null}
        {swap.status === 'accepted' && (!agreementReady || effectiveMode === 'shipping') ? <View style={styles.arrangement}>
          {!storedAgreement ? <SwapArrangementFields mode={effectiveMode} arrangements={effectiveArrangements} fixedMode={!!swap.exchangeMode} disabled={isProcessing}
            onMode={mode => {void handleSetExchangeMode(mode);}} onArrangements={text => {agreement.invalidate(); setPreparationArrangements(text);}}/> : null}
          <Button loading={agreement.reading || isProcessing} disabled={!effectiveMode || !effectiveArrangements.trim()} onPress={() => {if (agreementReady) void prepareConfirmedAgreement(); else void readAgreement('prepare');}}>Préparer l’échange</Button>
        </View> : null}
        {canMutate && !(swap.status === 'proposed' && participant.isReceiver) ? <SwapActions status={swap.status} participant={participant} handlers={actionHandlers}
          isProcessing={isProcessing} exchangeMode={effectiveMode ?? undefined} sourceKey={historySourceKey} agreementReady={agreementReady}/> : null}
      </ScrollView>
      {canMutate && swap.status === 'proposed' && participant.isReceiver && (
        <SwapStickyActions
          onAccept={() => {void readAgreement('accept');}}
          onDecline={handleDecline}
          isProcessing={isProcessing}
          acceptDisabled={!ownAdmission || !storedAgreement || agreement.reading}
        />
      )}
      <SwapActionSheet visible={tool !== null} title={tool === 'payment' ? 'Complément' : tool === 'conditions' ? 'Détails de l’échange' : tool === 'photos' ? 'Photos de l’échange' : tool === 'hold' ? 'Suivi du complément' : tool === 'payment-history' ? 'Historique du paiement' : 'Options'} onClose={() => setTool(null)}>
        {tool === 'options' ? <>
          <SwapContactButton otherUserId={otherUserId} otherUserName={participant.senderName}/>
          {storedAgreement ? <Button variant="secondary" onPress={() => setTool('conditions')}>Voir les détails et conditions</Button> : null}
          {getSwapPhotoCount(swap, 'initiator') || getSwapPhotoCount(swap, 'receiver') ? <Button variant="secondary" onPress={() => setTool('photos')}>Voir les photos de l’échange</Button> : null}
          {swap.cashTopUp ? <Button variant="secondary" onPress={handlePayTopUp}>Voir le paiement</Button> : null}
          {canMutate ? <SwapActions optionsOnly status={swap.status} participant={participant} handlers={actionHandlers} isProcessing={isProcessing} exchangeMode={effectiveMode ?? undefined} sourceKey={historySourceKey} agreementReady={agreementReady}/> : null}
          <Button variant="secondary" onPress={() => {setTool(null); router.push({pathname: '/settings/support', params: {swapId: swap.id}});}}>Obtenir de l’aide</Button>
        </> : null}
        {tool === 'photos' ? <SwapProofPhotos swap={swap} uid={userId}/> : null}
        {tool === 'conditions' && storedAgreement ? <SwapAgreementReview compact readOnly preview={storedAgreement} uid={userId} accepted={false} onToggle={() => {}}
          swapId={swap.id} acceptedAgreement={!!swap.acceptedAt} articlePrivacyWithdrawals={swap.articlePrivacyWithdrawals}/> : null}
        {tool === 'hold' && swap.cashTopUp ? <SwapHoldReviewNotice swapId={swap.id} sourceKey={JSON.stringify([swap.status, swap.updatedAt?.getTime(), swap.cashTopUp])}/> : null}
        {tool === 'payment-history' && swap.cashTopUp ? <SwapTopUpCheckoutJournal uid={userId} scope="own"/> : null}
        {tool === 'payment' && swap.cashTopUp ? <>
          {swap.cashTopUp.payerId === userId && topUpView?.key === topUpKey ? <SwapTopUpCheckoutPanel key={JSON.stringify([topUpKey, topUpView.revision])} uid={userId} swapId={swap.id} scope="own" assertSelection={assertTopUpSelection}/> : null}
          <Button variant="secondary" onPress={() => setTool('hold')}>Suivi du complément</Button>
          <Button variant="ghost" onPress={() => setTool('payment-history')}>Historique du paiement</Button>
        </> : null}
      </SwapActionSheet>
      <SwapActionSheet visible={!!review && review.key === sourceKey && !!agreement.preview && ['proposed', 'accepted'].includes(swap.status)} title={review?.action === 'accept' ? 'Accepter la proposition' : 'Préparer l’échange'}
        onClose={() => {if (!isProcessing) {setReview(null); agreement.invalidate();}}}
        footer={<Button loading={isProcessing} disabled={!agreement.accepted} onPress={() => {if (review?.action === 'accept') void handleAccept('sticky_bar'); else void handlePrepare();}}>{review?.action === 'accept' ? 'Accepter la proposition' : 'Confirmer la préparation'}</Button>}>
        {agreement.preview ? <SwapAgreementReview compact preview={agreement.preview} uid={userId} accepted={agreement.accepted} disabled={isProcessing}
          swapId={swap.id} acceptedAgreement={!!swap.acceptedAt} articlePrivacyWithdrawals={swap.articlePrivacyWithdrawals}
          onToggle={() => {try {agreement.toggle();} catch {agreement.invalidate();}}}/> : null}
      </SwapActionSheet>
      <SwapLaunchAdmissionSheet visible={admissionOpen} onClose={() => setAdmissionOpen(false)} onAllowed={() => {setAdmissionOpen(false); void eligibility.refetch();}}/>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  errorContainer: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
  },
  errorText: { color: colors.foregroundSecondary, textAlign: 'center' },
  stateTitle: { ...typography.trocScreenTitle, color: colors.foreground },
  stateButton: { height: 'auto', minHeight: 48, paddingVertical: spacing.md },
  scrollView: { flex: 1 },
  scrollContent: { paddingBottom: spacing.xl },
  arrangement: {padding: spacing.md, gap: spacing.sm},
  arrangementTitle: {...typography.label, color: colors.foreground},
  arrangementBody: {...typography.bodySmall, color: colors.foregroundSecondary},
  readOnlyNotice: {...typography.bodySmall, color: colors.foregroundSecondary, margin: spacing.md},
});
