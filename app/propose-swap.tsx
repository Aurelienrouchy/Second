/**
 * Proposer un échange — sélection d’articles, valeurs indicatives et message.
 */

import { randomUUID } from 'expo-crypto';
import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Alert,
  KeyboardAvoidingView,
  Pressable,
  Platform,
} from 'react-native';

import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { readScopedQuery } from '@/utils/readScopedQuery';
import { useLabelLifecycleContext } from '@/hooks/useLabelLifecycleContext';
import { getAuthSessionGeneration } from '@/store/authStore';
import { useUser, useAuthenticatedUid } from '@/hooks/useAuth';
import { useEligibility } from '@/hooks/useEligibility';
import { useTradeAdmissionError } from '@/hooks/useTradeAdmissionError';
import { useSwapAgreement } from '@/features/swap/hooks/useSwapAgreement';
import { isDefinitiveTradeRefusal } from '@/services/tradeOperation';
import { ArticlesService } from '@/services/articlesService';
import {
  proposeSwap,
  getPendingSwapProposal,
  getPartyItemsExtended,
  GENERALIST_ZONE_ID,
} from '@/services/swapService';
import { ModerationService } from '@/services/moderationService';
import { queryKeys } from '@/lib/queryKeys';
import { track } from '@/lib/analytics';
import { SwapItemInfo, SwapExchangeMode } from '@/types';
import {
  colors,
  fonts,
  spacing,
  radius,
  sizing,
  typography,
  components,
} from '@/constants/theme';
import { PAYMENTS_ENABLED } from '@/config/featureFlags';
import { useAuthSheetStore } from '@/store/authSheetStore';
import { Text, Button } from '@/components/ui';
import { SwapLaunchAdmissionSheet, SwapAgreementReview, SwapArrangementFields, SwapActionSheet , SwapItemSelector, SwapComparisonLayout ,
  ProposeSwapSkeleton,
  ProposeSwapTopBar,
  ArticleSelectionSection,
  ValueComparisonBox,
  SwapMessageInput,
  SubmitFooter,
} from '@/features/swap';

function complementInCents(value: string): number {
  const text = value.trim();
  if (!text) return 0;
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(text)) return Number.NaN;
  const cents = Math.round(Number(text.replace(',', '.')) * 100);
  return Number.isSafeInteger(cents) && cents >= 0 && cents <= 500000 ? cents : Number.NaN;
}

export default function ProposeSwapScreen() {
  const {
    receiverArticleIds: receiverArticleIdsJson,
    partyId,
    targetArticleId,
    receiverId,
    receiverName,
  } = useLocalSearchParams<{
    receiverArticleIds?: string;
    partyId?: string;
    targetArticleId?: string;
    receiverId?: string;
    receiverName?: string;
  }>();
  const user = useUser();
  const uid = useAuthenticatedUid();
  const eligibility = useEligibility();
  const showAdmissionError = useTradeAdmissionError();
  const queryClient = useQueryClient();
  const formContext = useLabelLifecycleContext(JSON.stringify(['swap-proposal-form', receiverId, targetArticleId]), uid);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [admissionOpen, setAdmissionOpen] = useState(false);
  const requestIdRef = React.useRef<string | null>(null);
  const submissionOwnerRef = React.useRef<symbol | null>(null);
  const pendingProposal = useQuery({queryKey: ['pending-swap-proposal', uid, getAuthSessionGeneration(), formContext.focusRevision], enabled: !!uid && formContext.focused, staleTime: 0, gcTime: 0, retry: false,
    queryFn: ({signal}) => readScopedQuery(signal, () => {const op = formContext.capture(); return () => formContext.assertCurrent(op);}, assertCurrent => getPendingSwapProposal(uid!, assertCurrent)),
  });
  const [resuming, setResuming] = useState(false);
  const resumeProposal = async () => {
    if (!pendingProposal.data || resuming || !uid) return;
    let op: ReturnType<typeof formContext.capture>; try {op = formContext.capture();} catch {return;}
    setResuming(true);
    try {
      const swapId = await proposeSwap(pendingProposal.data, () => formContext.assertCurrent(op)); formContext.assertCurrent(op);
      void queryClient.invalidateQueries({queryKey: queryKeys.swaps.userList(uid)});
      router.replace({pathname: '/swap/[id]', params: {id: swapId, source: 'post_proposal'}});
    } catch {if (formContext.isCurrent(op)) Alert.alert('Votre proposition est conservée', 'L’envoi n’a pas encore pu être confirmé. Vous pouvez retrouver vos échanges ou réessayer ce même envoi.');}
    finally {if (formContext.isCurrent(op)) setResuming(false);}
  };

  // --- React Query: fetch target article when navigating via targetArticleId ---
  const {
    data: targetArticle,
    isLoading: isLoadingTarget,
    isError: isTargetError,
    refetch: refetchTarget,
  } = useQuery({
    queryKey: queryKeys.articles.detail(targetArticleId ?? ''),
    queryFn: () => ArticlesService.getArticleById(targetArticleId!),
    enabled: !!targetArticleId && !receiverArticleIdsJson,
    staleTime: 5 * 60 * 1000,
  });

  // --- React Query: fetch current user's articles ---
  const {
    data: userArticlesRaw,
    isLoading: isLoadingUserItems,
    isError: isUserItemsError,
    refetch: refetchUserItems,
  } = useQuery({
    queryKey: [...queryKeys.articles.userList(uid ?? ''), getAuthSessionGeneration(), formContext.focusRevision],
    queryFn: ({signal}) => readScopedQuery(signal, () => {const operation = formContext.capture(); return () => formContext.assertCurrent(operation);}, () => ArticlesService.getUserArticles(uid!)),
    enabled: !!uid && formContext.focused,
    staleTime: 5 * 60 * 1000,
  });

  const effectivePartyId = partyId ?? GENERALIST_ZONE_ID;

  // --- React Query: the zone's deposited items (to scope the receiver
  // selector to what THEY actually deposited, when possible) ---
  const {
    data: zoneItems = [],
    isLoading: isLoadingZoneItems,
    isError: isZoneItemsError,
    refetch: refetchZoneItems,
  } = useQuery({
    queryKey: queryKeys.swapParties.items(effectivePartyId),
    queryFn: () => getPartyItemsExtended(effectivePartyId),
    enabled: !!receiverId,
    staleTime: 5 * 60 * 1000,
  });

  // Derive available items from user articles query (initiator side)
  const allAvailableItems = useMemo<SwapItemInfo[]>(() => {
    if (!userArticlesRaw) return [];
    return userArticlesRaw
      .filter((a) => a.isActive !== false && !a.isSold)
      .map((a) => ({
        articleId: a.id,
        title: a.title,
        price: a.price,
        imageUrl: a.images?.[0]?.url,
        brand: a.brand,
        size: a.size,
      }));
  }, [userArticlesRaw]);

  // Ce que l'autre a déposé dans la zone, et rien d'autre. getPartyItemsExtended
  // a déjà écarté les articles vendus, retirés ou qui ne lui appartiennent pas.
  const receiverAvailableItems = useMemo<SwapItemInfo[]>(() => {
    if (!receiverId) return [];
    return zoneItems
      .filter((i) => i.sellerId === receiverId)
      .map((i) => ({
        articleId: i.articleId,
        title: i.title,
        price: i.price,
        imageUrl: i.imageUrl,
        brand: i.brand,
        size: i.size,
      }));
  }, [zoneItems, receiverId]);

  // Route params carry only IDs. Media URLs contain percent-encoded Storage
  // paths, which Expo Router decodes again inside useLocalSearchParams.
  // Resolve the actual selection from the same current catalogue projection.
  const requestedReceiverIds = useMemo<string[]>(() => {
    if (!receiverArticleIdsJson) return [];
    try {
      const parsed: unknown = JSON.parse(receiverArticleIdsJson);
      if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > 20 ||
        !parsed.every((id): id is string => typeof id === 'string' && id.trim().length > 0)) return [];
      return [...new Set(parsed)];
    } catch { return []; }
  }, [receiverArticleIdsJson]);

  const initialReceiverItems = useMemo<SwapItemInfo[]>(() => {
    if (receiverArticleIdsJson) {
      const items = requestedReceiverIds.map(id => receiverAvailableItems.find(item => item.articleId === id));
      return items.every((item): item is SwapItemInfo => !!item) ? items : [];
    }
    if (targetArticle) {
      return [
        {
          articleId: targetArticle.id,
          title: targetArticle.title,
          price: targetArticle.price,
          imageUrl: targetArticle.images?.[0]?.url,
          brand: targetArticle.brand,
          size: targetArticle.size,
        },
      ];
    }
    return [];
  }, [receiverArticleIdsJson, requestedReceiverIds, receiverAvailableItems, targetArticle]);

  // Local state for mutable selections (seeded from query-derived data)
  const [receiverItems, setReceiverItems] = useState<SwapItemInfo[]>([]);
  const [initiatorItems, setInitiatorItems] = useState<SwapItemInfo[]>([]);
  const [message, setMessage] = useState('');
  const [showItemSelector, setShowItemSelector] = useState(false);
  const [showReceiverSelector, setShowReceiverSelector] = useState(false);
  const [complementAmount, setComplementAmount] = useState('');
  const [complementPayer, setComplementPayer] = useState<
    'initiator' | 'receiver'
  >('initiator');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSent, setIsSent] = useState(false);
  const [submissionUnknown, setSubmissionUnknown] = useState(false);
  const [receiverSeeded, setReceiverSeeded] = useState(false);
  const [exchangeMode, setExchangeMode] = useState<SwapExchangeMode | null>(null);
  const [arrangements, setArrangements] = useState('');
  const formOwnerKey = JSON.stringify([uid, receiverId, targetArticleId, receiverArticleIdsJson, effectivePartyId]);
  const [previousFormOwner, setPreviousFormOwner] = useState(formOwnerKey);
  if (previousFormOwner !== formOwnerKey) {
    setPreviousFormOwner(formOwnerKey); setInitiatorItems([]); setReceiverItems([]); setMessage(''); setComplementAmount('');
    setComplementPayer('initiator'); setIsSubmitting(false); setIsSent(false); setSubmissionUnknown(false); setReceiverSeeded(false);
    setExchangeMode(null); setArrangements(''); setReviewOpen(false); setAdmissionOpen(false);
  }
  const agreement = useSwapAgreement(uid, JSON.stringify(['proposal', receiverId, initiatorItems, receiverItems, message,
    exchangeMode, arrangements, complementAmount, complementPayer, eligibility.data?.version, eligibility.dataUpdatedAt]));
  const submissionLockRef = React.useRef(false);
  React.useLayoutEffect(() => {submissionLockRef.current = false; submissionOwnerRef.current = null; requestIdRef.current = null;}, [formOwnerKey]);
  const change = <T,>(setter: (value: T) => void, value: T) => { agreement.invalidate(); setter(value); };
  const ownAdmission = eligibility.data?.swapLaunch?.policyVersion === '2026-10-17.v1' && eligibility.data.swapLaunch.allowed === true && !eligibility.isFetching && !eligibility.isError;
  const handleReadAgreement = async () => {
    let operation: ReturnType<typeof agreement.context.capture> | null = null;
    try {
      if (!uid || !receiverId || !exchangeMode || !arrangements.trim() || !ownAdmission || submissionLockRef.current) return;
      operation = agreement.context.capture();
      const cashCents = PAYMENTS_ENABLED ? complementInCents(complementAmount) : 0;
      if (!Number.isFinite(cashCents)) {Alert.alert('Montant invalide', 'Indiquez un complément entre 0 et 5 000 $, avec deux décimales au maximum.'); return;}
      await agreement.read({ operation: 'swap_proposal_preview', expectedUid: uid, receiverId,
        initiatorArticleIds: initiatorItems.map(item => item.articleId), receiverArticleIds: receiverItems.map(item => item.articleId),
        exchangeMode, arrangements: arrangements.trim(), message: message.trim() || null,
        ...(cashCents > 0 ? { cashTopUp: { amount: cashCents,
          payerId: complementPayer === 'initiator' ? uid : receiverId } } : {}) });
      setReviewOpen(true);
    } catch {if (operation && agreement.context.isCurrent(operation)) Alert.alert('Proposition indisponible', 'Votre proposition n’a pas pu être chargée. Votre sélection est conservée.');}
  };

  // Seed receiver items once when initial data becomes available
  // (state adjustment during render — https://react.dev/learn/you-might-not-need-an-effect)
  if (!receiverSeeded && initialReceiverItems.length > 0) {
    setReceiverSeeded(true);
    setReceiverItems(initialReceiverItems);
  }

  // Fire swap_propose_opened once the receiver side is known (params or the
  // target-article query resolving). entry_source is derived from the nav shape.
  const proposeOpenedRef = React.useRef(false);
  React.useEffect(() => {
    if (proposeOpenedRef.current || initialReceiverItems.length === 0) return;
    proposeOpenedRef.current = true;
    track('swap_propose_opened', {
      entry_source: targetArticleId
        ? 'article_detail'
        : initialReceiverItems.length > 1
          ? 'zone_multi'
          : 'zone_single',
      receiver_id: receiverId || '',
      initial_receiver_items_count: initialReceiverItems.length,
      initial_total_value_cents: Math.round(
        initialReceiverItems.reduce((sum, i) => sum + (i.price || 0), 0) * 100,
      ),
    });
  }, [initialReceiverItems, targetArticleId, receiverId]);

  const isLoading = receiverArticleIdsJson ? isLoadingZoneItems : isLoadingTarget;
  const initialSelectionError = receiverArticleIdsJson ? isZoneItemsError : isTargetError;
  const displayedReceiverName =
    receiverName?.trim() || targetArticle?.sellerName || 'ce membre';
  const receiverImage = targetArticle && targetArticle.sellerId === receiverId
    ? targetArticle.sellerImage
    : zoneItems.find(item => item.sellerId === receiverId)?.sellerImage;
  const targetUnavailable =
    !!targetArticleId &&
    !receiverArticleIdsJson &&
    !isLoading &&
    !isTargetError &&
    (!targetArticle ||
      targetArticle.isSold ||
      targetArticle.isActive === false ||
      targetArticle.sellerId !== receiverId);
  const invalidInitialSelection =
    !!receiverArticleIdsJson && !isLoading && !isZoneItemsError && initialReceiverItems.length === 0;
  const routeError = !receiverId
    ? 'Le destinataire de cet échange est introuvable. Revenez aux articles pour choisir un membre.'
    : user?.id === receiverId
      ? 'Vous ne pouvez pas proposer un échange avec vous-même.'
      : initialSelectionError
        ? 'Impossible de charger les articles. Veuillez réessayer.'
        : targetUnavailable
          ? 'Cet article n’est plus disponible pour un échange.'
          : invalidInitialSelection
            ? 'Cette sélection d’articles est indisponible. Revenez aux articles pour la refaire.'
            : null;

  // Calculate total values
  const receiverTotal = useMemo(
    () => receiverItems.reduce((sum, item) => sum + item.price, 0),
    [receiverItems],
  );

  const initiatorTotal = useMemo(
    () => initiatorItems.reduce((sum, item) => sum + item.price, 0),
    [initiatorItems],
  );

  // Handle item removal
  const handleRemoveInitiatorItem = (articleId: string) => {
    agreement.invalidate();
    setInitiatorItems((prev) =>
      prev.filter((item) => item.articleId !== articleId),
    );
  };

  const handleRemoveReceiverItem = (articleId: string) => {
    agreement.invalidate();
    setReceiverItems((prev) =>
      prev.filter((item) => item.articleId !== articleId),
    );
  };

  // Open selectors
  const handleSignIn = useCallback(() => {
    useAuthSheetStore
      .getState()
      .show('Connectez-vous pour proposer un échange.');
  }, []);
  const handleOpenInitiatorSelector = useCallback(() => {
    if (!user || user.id !== uid) {
      handleSignIn();
      return;
    }
    setShowItemSelector(true);
  }, [user, uid, handleSignIn]);
  const handleOpenReceiverSelector = useCallback(
    () => setShowReceiverSelector(true),
    [],
  );

  // Submit swap proposal
  const handleSubmit = useCallback(async () => {
    // A ref locks synchronously, before React renders the disabled button.
    // Keep it locked after success while the confirmation is still visible.
    if (submissionLockRef.current || isSent || pendingProposal.data || pendingProposal.isFetching || pendingProposal.isError) return;
    if (!user || user.id !== uid) {
      handleSignIn();
      return;
    }
    // The UI captures the complement in DOLLARS; the backend expects CENTS.
    const complementCents = PAYMENTS_ENABLED
      ? complementInCents(complementAmount)
      : 0;
    if (!Number.isFinite(complementCents)) {Alert.alert('Montant invalide', 'Indiquez un complément entre 0 et 5 000 $, avec deux décimales au maximum.'); return;}
    const hasCashTopUp = complementCents > 0;
    const proposalBase = {
      receiver_id: receiverId || '',
      initiator_items_count: initiatorItems.length,
      receiver_items_count: receiverItems.length,
      initiator_total_cents: Math.round(initiatorTotal * 100),
      receiver_total_cents: Math.round(receiverTotal * 100),
      has_cash_top_up: hasCashTopUp,
      cash_top_up_cents: hasCashTopUp ? complementCents : 0,
      ...(hasCashTopUp ? { cash_payer: complementPayer } : {}),
      has_message: message.trim().length > 0,
    } as const;

    if (
      routeError ||
      !receiverId ||
      initiatorItems.length === 0 ||
      receiverItems.length === 0
    ) {
      track('swap_proposal_sent', {
        ...proposalBase,
        outcome: 'validation_failed',
      });
      Alert.alert(
        'Proposition incomplète',
        routeError || 'Choisissez au moins un article de chaque côté.',
      );
      return;
    }

    let errorOperation: ReturnType<typeof agreement.context.capture>;
    try {errorOperation = agreement.context.capture();} catch {return;}
    submissionLockRef.current = true;
    const submissionOwner = Symbol(); submissionOwnerRef.current = submissionOwner;
    let sent = false;
    let requestStarted = false;
    setIsSubmitting(true);
    try {
      const consent = agreement.captureConsent();
      // Check if users are blocked before proceeding
      const blocked = await ModerationService.areUsersBlocked(
        user.id,
        receiverId || '',
      );
      consent.assertCurrent();
      if (blocked) {
        track('swap_proposal_sent', {
          ...proposalBase,
          outcome: 'blocked_user',
        });
        Alert.alert(
          'Action impossible',
          'Vous ne pouvez pas proposer un échange avec ce membre.',
        );
        return;
      }

      requestStarted = true;
      requestIdRef.current ??= randomUUID();
      const swapId = await proposeSwap({
        clientRequestId: requestIdRef.current,
        ...consent.acknowledgement,
        exchangeMode: consent.preview.exchangeMode,
        arrangements: consent.preview.arrangements,
        initiatorId: user.id,
        initiatorName: user.displayName || 'Utilisateur',
        initiatorImage: user.profileImage,
        initiatorItems: consent.preview.initiatorItems,
        receiverId: receiverId || '',
        receiverName: receiverName || '',
        receiverImage: receiverImage || '',
        receiverItems: consent.preview.receiverItems,
        message: consent.preview.message || undefined,
        cashTopUp: consent.preview.cashTopUp ?? undefined,
        partyId: effectivePartyId,
      }, consent.assertCurrent);
      consent.assertCurrent();

      sent = true;
      // A previously visited list may be cached for ten minutes. Invalidate it
      // before exposing the success navigation, so the new proposal is visible.
      void queryClient.invalidateQueries({queryKey: queryKeys.swaps.userList(user.id)});
      consent.assertCurrent();
      setReviewOpen(false);
      setIsSent(true);
      track('swap_proposal_sent', {
        ...proposalBase,
        outcome: 'success',
        swap_id: swapId,
      });
      router.replace({pathname: '/swap/[id]', params: {id: swapId, source: 'post_proposal'}});
    } catch (error) {
      if (!agreement.context.isCurrent(errorOperation)) return;
      if (__DEV__) console.error('Error proposing swap:', error);
      track('swap_proposal_sent', { ...proposalBase, outcome: 'error' });
      if (showAdmissionError(error, {isCurrent: () => agreement.context.isCurrent(errorOperation)})) return;
      if (requestStarted && !isDefinitiveTradeRefusal(error)) {
        sent = true; setSubmissionUnknown(true);
        Alert.alert('Envoi en attente de confirmation', 'Consultez Mes échanges pour retrouver votre proposition avant d’en préparer une autre.');
      } else Alert.alert('Envoi impossible', 'La proposition n’a pas été confirmée. Relisez ses conditions et vos renseignements avant un nouvel envoi.');
    } finally {
      if (submissionOwnerRef.current === submissionOwner) {
        if (!sent) {submissionLockRef.current = false; requestIdRef.current = null;}
        setIsSubmitting(false);
      }
      void queryClient.invalidateQueries({queryKey: ['pending-swap-proposal', uid]});
    }
  }, [
    pendingProposal.data, pendingProposal.isError, pendingProposal.isFetching,
    initiatorTotal,
    receiverTotal,
    user,
    initiatorItems,
    receiverItems,
    receiverId,
    receiverName,
    receiverImage,
    message,
    complementAmount,
    complementPayer,
    effectivePartyId,
    isSent,
    routeError,
    handleSignIn,
    queryClient,
    agreement, uid, showAdmissionError,
  ]);

  const handleBack = useCallback(() => {
    if (submissionLockRef.current && !isSent && !submissionUnknown) return;
    if (isSent) {
      router.push('/my-swaps');
      return;
    }
    track('swap_propose_abandoned', {
      initiator_items_count: initiatorItems.length,
      receiver_items_count: receiverItems.length,
      had_message: message.trim().length > 0,
    });
    router.back();
  }, [initiatorItems.length, receiverItems.length, message, isSent, submissionUnknown]);

  // --- Loading state ---
  if (isLoading) {
    return (
      <SafeAreaView style={styles.container} edges={[]}>
        <Stack.Screen options={{ headerShown: false }} />
        <ProposeSwapTopBar onBack={handleBack} />
        <ProposeSwapSkeleton />
      </SafeAreaView>
    );
  }

  if (routeError) {
    return (
      <SafeAreaView style={styles.container} edges={[]}>
        <Stack.Screen options={{ headerShown: false }} />
        <ProposeSwapTopBar onBack={handleBack} />
        <View style={styles.errorContainer}>
          <View style={styles.contextCard}>
            <Text style={styles.contextTitle} accessibilityRole="header">
              Échange indisponible
            </Text>
            <Text style={styles.contextCopy}>{routeError}</Text>
            <Pressable
              style={styles.stateButton}
              accessibilityRole="button"
              onPress={
                initialSelectionError
                  ? () => {
                      if (receiverArticleIdsJson) void refetchZoneItems();
                      else void refetchTarget();
                    }
                  : handleBack
              }
            >
              <Text style={styles.stateButtonText}>
                {initialSelectionError ? 'Réessayer' : 'Revenir aux articles'}
              </Text>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  const bothSidesSelected =
    initiatorItems.length > 0 && receiverItems.length > 0;

  return (
    <SafeAreaView style={styles.container} edges={[]}>
      <Stack.Screen options={{ headerShown: false }} />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ProposeSwapTopBar
          onBack={handleBack}
          disabled={isSubmitting}
          memberName={displayedReceiverName}
        />

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {(isSent || !user) && (
            <View style={styles.contextCard}>
              {isSent && (
                <Text style={styles.contextCopy}>
                  Votre proposition a été envoyée.
                </Text>
              )}
              {!user && (
                <Pressable
                  style={styles.stateButton}
                  onPress={handleSignIn}
                  accessibilityRole="button"
                >
                  <Text style={styles.stateButtonText}>
                    Se connecter pour proposer un échange
                  </Text>
                </Pressable>
              )}
            </View>
          )}
          {submissionUnknown || pendingProposal.data || pendingProposal.isError ? <View style={styles.contextCard}>
            <Text style={styles.contextCopy}>Une proposition est en attente de confirmation. Retrouvez-la avant de préparer un nouvel échange.</Text>
            {pendingProposal.data ? <Button loading={resuming} onPress={() => {void resumeProposal();}}>Reprendre l’envoi de ma proposition</Button> : null}
            <Button variant="secondary" onPress={() => router.push('/my-swaps')}>Voir mes échanges</Button>
          </View> : null}
          <SwapComparisonLayout
            received={
              <ArticleSelectionSection
                label="Vous recevez"
                items={receiverItems}
                variant="their"
                addButtonLabel="Ajouter une pièce"
                onRemoveItem={handleRemoveReceiverItem}
                onAdd={handleOpenReceiverSelector}
                disabled={isSubmitting || isSent || submissionUnknown}
              />
            }
            proposed={
              <ArticleSelectionSection
                label="Vous proposez"
                items={initiatorItems}
                variant="mine"
                addButtonLabel="Ajouter une pièce"
                onRemoveItem={handleRemoveInitiatorItem}
                onAdd={handleOpenInitiatorSelector}
                disabled={isSubmitting || isSent || submissionUnknown}
              />
            }
          />
          <Text style={styles.contextCopy}>Choisissez entre 1 et 20 articles de chaque côté.</Text>

          {bothSidesSelected && (
            <ValueComparisonBox
              initiatorTotal={initiatorTotal}
              receiverTotal={receiverTotal}
              complementAmount={complementAmount}
              complementPayer={complementPayer}
              receiverName={displayedReceiverName}
              onComplementAmountChange={value => change(setComplementAmount, value)}
              onComplementPayerChange={value => change(setComplementPayer, value)}
              disabled={isSubmitting || isSent || submissionUnknown}
            />
          )}

          <SwapMessageInput
            value={message}
            onChangeText={value => change(setMessage, value)}
            disabled={isSubmitting || isSent || submissionUnknown}
          />
          <SwapArrangementFields mode={exchangeMode} arrangements={arrangements} disabled={isSubmitting || isSent || submissionUnknown}
            onMode={value => change(setExchangeMode, value)} onArrangements={value => change(setArrangements, value)} />
          {!ownAdmission ? <View style={styles.contextCard}>
            <Text style={styles.contextCopy}>{eligibility.isFetching ? 'Lecture de vos critères pour Le Troc…' : eligibility.isError
              ? 'Vos critères pour un nouveau Troc ne peuvent pas être relus.'
              : 'Complétez vos renseignements pour proposer un échange.'}</Text>
            <Button variant="secondary" onPress={() => setAdmissionOpen(true)}>Compléter mes renseignements</Button>
            {eligibility.isError ? <Button variant="ghost" onPress={() => { agreement.invalidate(); void eligibility.refetch(); }}>Relire mes critères</Button> : null}
          </View> : null}

        </ScrollView>

        <SubmitFooter
          isSubmitting={isSubmitting || agreement.reading}
          isDisabled={!bothSidesSelected || !user || user.id !== uid || !ownAdmission || !exchangeMode || !arrangements.trim() || submissionUnknown || !!pendingProposal.data || pendingProposal.isFetching || pendingProposal.isError || agreement.reading}
          onSubmit={() => {void handleReadAgreement();}}
          isSent={isSent}
          onViewSwaps={() => router.push('/my-swaps')}
          disabledReason={
            !user ? 'Connectez-vous pour envoyer votre proposition.' : !bothSidesSelected ? 'Choisissez les articles à échanger.' : !exchangeMode ? 'Choisissez une modalité.' : !arrangements.trim() ? 'Précisez le lieu ou l’organisation de l’envoi.' : undefined
          }
        />
      </KeyboardAvoidingView>

      <SwapActionSheet visible={reviewOpen && !!agreement.preview} title="Votre proposition" onClose={() => {if (!isSubmitting) {setReviewOpen(false); agreement.invalidate();}}}
        footer={<Button loading={isSubmitting} disabled={!agreement.accepted || submissionUnknown} onPress={() => {void handleSubmit();}}>Envoyer ma proposition</Button>}>
        {agreement.preview && uid ? <SwapAgreementReview compact preview={agreement.preview} uid={uid} accepted={agreement.accepted} disabled={isSubmitting || submissionUnknown}
          onToggle={() => {try {agreement.toggle();} catch {agreement.invalidate();}}}/> : null}
      </SwapActionSheet>
      {/* Item Selector Modals */}
      <SwapItemSelector
        items={allAvailableItems}
        selectedItems={initiatorItems}
        onSelectionChange={value => change(setInitiatorItems, value.slice(0, 20))}
        visible={showItemSelector}
        onClose={() => setShowItemSelector(false)}
        title="Choisissez vos articles"
        isLoading={isLoadingUserItems}
        errorMessage={
          isUserItemsError ? 'Impossible de charger vos articles.' : undefined
        }
        onRetry={() => {
          void refetchUserItems();
        }}
        emptyMessage="Vous n’avez aucun article disponible. Publiez un article pour le proposer en échange."
        emptyActionLabel="Publier un article"
        onEmptyAction={() => {
          setShowItemSelector(false);
          router.push('/(tabs)/sell');
        }}
      />

      <SwapItemSelector
        items={receiverAvailableItems}
        selectedItems={receiverItems}
        onSelectionChange={value => change(setReceiverItems, value.slice(0, 20))}
        visible={showReceiverSelector}
        onClose={() => setShowReceiverSelector(false)}
        title={`Choisissez les articles de ${displayedReceiverName}`}
        isLoading={isLoadingZoneItems}
        errorMessage={
          isZoneItemsError
            ? 'Impossible de charger les articles de ce membre.'
            : undefined
        }
        onRetry={() => {
          void refetchZoneItems();
        }}
        emptyMessage="Ce membre n’a pas d’autre article disponible dans Le Troc."
      />
      <SwapLaunchAdmissionSheet visible={admissionOpen} onClose={() => setAdmissionOpen(false)} onAllowed={() => {setAdmissionOpen(false); void eligibility.refetch();}}/>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  flex: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
  },
  contextCard: {
    backgroundColor: colors.background,
    borderBottomWidth: components.troc.borderWidth,
    borderBottomColor: colors.borderStrong,
    paddingBottom: spacing.md,
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  contextTitle: { ...typography.trocScreenTitle, color: colors.foreground },
  contextCopy: {
    fontFamily: fonts.sans,
    fontSize: 14,
    lineHeight: 21,
    color: colors.foregroundSecondary,
  },
  errorContainer: { flex: 1, padding: spacing.md, justifyContent: 'center' },
  stateButton: {
    minHeight: sizing.minTouchTarget,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.none,
    backgroundColor: colors.primaryDark,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stateButtonText: {
    fontFamily: fonts.sansMedium,
    fontSize: 14,
    lineHeight: 20,
    color: colors.cream,
    textAlign: 'center',
  },
});
