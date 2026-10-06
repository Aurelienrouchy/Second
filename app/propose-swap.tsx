/**
 * Proposer un échange — sélection d’articles, valeurs indicatives et message.
 */

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
import { useQuery } from '@tanstack/react-query';

import { useUser } from '@/hooks/useAuth';
import { ArticlesService } from '@/services/articlesService';
import { proposeSwap, getPartyItemsExtended, GENERALIST_ZONE_ID } from '@/services/swapService';
import { ModerationService } from '@/services/moderationService';
import { queryKeys } from '@/lib/queryKeys';
import { track } from '@/lib/analytics';
import { SwapItemInfo } from '@/types';
import { colors, fonts, spacing, radius, sizing } from '@/constants/theme';
import { PAYMENTS_ENABLED } from '@/config/featureFlags';
import { useAuthSheetStore } from '@/store/authSheetStore';
import { Text } from '@/components/ui';
import { SwapItemSelector, SwapSeparator } from '@/components/swap';
import {
  ProposeSwapSkeleton,
  ProposeSwapTopBar,
  ArticleSelectionSection,
  ValueComparisonBox,
  SwapMessageInput,
  SubmitFooter,
} from '@/features/propose-swap';

function isSwapItem(value: unknown): value is SwapItemInfo {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return typeof item.articleId === 'string' && item.articleId.length > 0
    && typeof item.title === 'string'
    && typeof item.price === 'number' && Number.isFinite(item.price) && item.price >= 0
    && (item.brand == null || typeof item.brand === 'string')
    && (item.imageUrl == null || typeof item.imageUrl === 'string');
}

export default function ProposeSwapScreen() {
  const {
    receiverItems: receiverItemsJson,
    partyId,
    targetArticleId,
    receiverId,
    receiverName,
    receiverImage,
  } = useLocalSearchParams<{
    receiverItems?: string;
    partyId?: string;
    targetArticleId?: string;
    receiverId?: string;
    receiverName?: string;
    receiverImage?: string;
  }>();
  const user = useUser();

  // --- React Query: fetch target article when navigating via targetArticleId ---
  const { data: targetArticle, isLoading: isLoadingTarget, isError: isTargetError, refetch: refetchTarget } = useQuery({
    queryKey: queryKeys.articles.detail(targetArticleId ?? ''),
    queryFn: () => ArticlesService.getArticleById(targetArticleId!),
    enabled: !!targetArticleId && !receiverItemsJson,
    staleTime: 5 * 60 * 1000,
  });

  // --- React Query: fetch current user's articles ---
  const { data: userArticlesRaw, isLoading: isLoadingUserItems, isError: isUserItemsError, refetch: refetchUserItems } = useQuery({
    queryKey: queryKeys.articles.userList(user?.id ?? ''),
    queryFn: () => ArticlesService.getUserArticles(user!.id),
    enabled: !!user?.id,
    staleTime: 5 * 60 * 1000,
  });

  const effectivePartyId = partyId ?? GENERALIST_ZONE_ID;

  // --- React Query: fetch receiver's articles (for receiver selector) ---
  const { data: receiverArticlesRaw, isLoading: isLoadingReceiverItems, isError: isReceiverItemsError, refetch: refetchReceiverItems } = useQuery({
    queryKey: queryKeys.articles.userList(receiverId ?? ''),
    queryFn: () => ArticlesService.getUserArticles(receiverId!),
    enabled: !!receiverId,
    staleTime: 5 * 60 * 1000,
  });

  // --- React Query: the zone's deposited items (to scope the receiver
  // selector to what THEY actually deposited, when possible) ---
  const { data: zoneItems = [], isLoading: isLoadingZoneItems, isError: isZoneItemsError, refetch: refetchZoneItems } = useQuery({
    queryKey: queryKeys.swapParties.items(effectivePartyId),
    queryFn: () => getPartyItemsExtended(effectivePartyId),
    enabled: !!receiverId,
    staleTime: 5 * 60 * 1000,
  });

  // Set of article ids the receiver has deposited in the zone.
  const receiverZoneArticleIds = useMemo<Set<string>>(() => {
    if (!receiverId) return new Set();
    return new Set(
      zoneItems.filter((i) => i.sellerId === receiverId).map((i) => i.articleId)
    );
  }, [zoneItems, receiverId]);

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

  // Derive available items from receiver articles query (receiver side).
  // Restrict to items the receiver has actually deposited in the zone — a swap
  // can only target zone stock, so never fall back to their full inventory.
  const receiverAvailableItems = useMemo<SwapItemInfo[]>(() => {
    if (!receiverArticlesRaw) return [];
    const active = receiverArticlesRaw.filter((a) => a.isActive !== false && !a.isSold);
    const inZone = active.filter((a) => receiverZoneArticleIds.has(a.id));
    return inZone.map((a) => ({
      articleId: a.id,
      title: a.title,
      price: a.price,
      imageUrl: a.images?.[0]?.url,
      brand: a.brand,
      size: a.size,
    }));
  }, [receiverArticlesRaw, receiverZoneArticleIds]);

  // Derive initial receiver items from params or target article query
  const initialReceiverItems = useMemo<SwapItemInfo[]>(() => {
    if (receiverItemsJson) {
      try {
        const parsed: unknown = JSON.parse(receiverItemsJson);
        const items: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
        if (!items.every(isSwapItem)) return [];
        return [...new Map(items.map((item) => [item.articleId, item])).values()];
      } catch (error) {
        if (__DEV__) console.error('Error parsing receiver items:', error);
        return [];
      }
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
  }, [receiverItemsJson, targetArticle]);

  // Local state for mutable selections (seeded from query-derived data)
  const [receiverItems, setReceiverItems] = useState<SwapItemInfo[]>([]);
  const [initiatorItems, setInitiatorItems] = useState<SwapItemInfo[]>([]);
  const [message, setMessage] = useState('');
  const [showItemSelector, setShowItemSelector] = useState(false);
  const [showReceiverSelector, setShowReceiverSelector] = useState(false);
  const [complementAmount, setComplementAmount] = useState('');
  const [complementPayer, setComplementPayer] = useState<'initiator' | 'receiver'>('initiator');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSent, setIsSent] = useState(false);
  const [receiverSeeded, setReceiverSeeded] = useState(false);
  const submissionLockRef = React.useRef(false);

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
        initialReceiverItems.reduce((sum, i) => sum + (i.price || 0), 0) * 100
      ),
    });
  }, [initialReceiverItems, targetArticleId, receiverId]);

  const isLoading = isLoadingTarget && !receiverItemsJson;
  const displayedReceiverName = receiverName?.trim() || targetArticle?.sellerName || 'ce membre';
  const targetUnavailable = !!targetArticleId && !receiverItemsJson && !isLoading && !isTargetError
    && (!targetArticle || targetArticle.isSold || targetArticle.isActive === false || targetArticle.sellerId !== receiverId);
  const invalidInitialSelection = !!receiverItemsJson && initialReceiverItems.length === 0;
  const routeError = !receiverId
    ? 'Le destinataire de cet échange est introuvable. Revenez aux articles pour choisir un membre.'
    : user?.id === receiverId
      ? 'Vous ne pouvez pas proposer un échange avec vous-même.'
      : isTargetError
        ? 'Impossible de charger cet article. Veuillez réessayer.'
        : targetUnavailable
          ? 'Cet article n’est plus disponible pour un échange.'
          : invalidInitialSelection
            ? 'Cette sélection d’articles est indisponible. Revenez aux articles pour la refaire.'
            : null;

  // Calculate total values
  const receiverTotal = useMemo(
    () => receiverItems.reduce((sum, item) => sum + item.price, 0),
    [receiverItems]
  );

  const initiatorTotal = useMemo(
    () => initiatorItems.reduce((sum, item) => sum + item.price, 0),
    [initiatorItems]
  );

  // Handle item removal
  const handleRemoveInitiatorItem = useCallback((articleId: string) => {
    setInitiatorItems((prev) => prev.filter((item) => item.articleId !== articleId));
  }, []);

  const handleRemoveReceiverItem = useCallback((articleId: string) => {
    setReceiverItems((prev) => prev.filter((item) => item.articleId !== articleId));
  }, []);

  // Open selectors
  const handleSignIn = useCallback(() => {
    useAuthSheetStore.getState().show('Connectez-vous pour proposer un échange.');
  }, []);
  const handleOpenInitiatorSelector = useCallback(() => {
    if (!user) { handleSignIn(); return; }
    setShowItemSelector(true);
  }, [user, handleSignIn]);
  const handleOpenReceiverSelector = useCallback(() => setShowReceiverSelector(true), []);

  // Submit swap proposal
  const handleSubmit = useCallback(async () => {
    // A ref locks synchronously, before React renders the disabled button.
    // Keep it locked after success while the confirmation is still visible.
    if (submissionLockRef.current || isSent) return;
    if (!user) { handleSignIn(); return; }
    // The UI captures the complement in DOLLARS; the backend expects CENTS.
    const complementCents = PAYMENTS_ENABLED ? Math.round(Number(complementAmount) * 100) : 0;
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

    if (routeError || !receiverId || initiatorItems.length === 0 || receiverItems.length === 0) {
      track('swap_proposal_sent', { ...proposalBase, outcome: 'validation_failed' });
      Alert.alert('Proposition incomplète', routeError || 'Choisissez au moins un article de chaque côté.');
      return;
    }

    submissionLockRef.current = true;
    let sent = false;
    setIsSubmitting(true);
    try {
      // Check if users are blocked before proceeding
      const blocked = await ModerationService.areUsersBlocked(user.id, receiverId || '');
      if (blocked) {
        track('swap_proposal_sent', { ...proposalBase, outcome: 'blocked_user' });
        Alert.alert('Action impossible', 'Vous ne pouvez pas proposer un échange avec ce membre.');
        return;
      }

      const swapId = await proposeSwap({
        initiatorId: user.id,
        initiatorName: user.displayName || 'Utilisateur',
        initiatorImage: user.profileImage,
        initiatorItems,
        receiverId: receiverId || '',
        receiverName: receiverName || '',
        receiverImage: receiverImage || '',
        receiverItems,
        message: message || undefined,
        cashTopUp:
          hasCashTopUp
            ? {
                amount: complementCents,
                payerId: complementPayer === 'initiator' ? user.id : receiverId || '',
              }
            : undefined,
        partyId: effectivePartyId,
      });

      sent = true;
      setIsSent(true);
      track('swap_proposal_sent', { ...proposalBase, outcome: 'success', swap_id: swapId });
      Alert.alert(
        'Votre proposition a été envoyée',
        'Vous pouvez retrouver la réponse et suivre cet échange dans votre espace.',
        [{ text: 'Voir mes échanges', onPress: () => router.push('/my-swaps') }]
      );
    } catch (error) {
      if (__DEV__) console.error('Error proposing swap:', error);
      track('swap_proposal_sent', { ...proposalBase, outcome: 'error' });
      Alert.alert('Envoi impossible', 'Votre proposition n’a pas pu être envoyée. Votre sélection est conservée, vous pouvez réessayer.');
    } finally {
      if (!sent) submissionLockRef.current = false;
      setIsSubmitting(false);
    }
  }, [
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
  ]);

  const handleBack = useCallback(() => {
    if (submissionLockRef.current && !isSent) return;
    if (isSent) { router.push('/my-swaps'); return; }
    track('swap_propose_abandoned', {
      initiator_items_count: initiatorItems.length,
      receiver_items_count: receiverItems.length,
      had_message: message.trim().length > 0,
    });
    router.back();
  }, [initiatorItems.length, receiverItems.length, message, isSent]);

  // --- Loading state ---
  if (isLoading) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <Stack.Screen options={{ headerShown: false }} />
        <ProposeSwapTopBar onBack={handleBack} />
        <ProposeSwapSkeleton />
      </SafeAreaView>
    );
  }

  if (routeError) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <Stack.Screen options={{ headerShown: false }} />
        <ProposeSwapTopBar onBack={handleBack} />
        <View style={styles.errorContainer}>
          <View style={styles.contextCard}>
            <Text style={styles.contextTitle} accessibilityRole="header">Échange indisponible</Text>
            <Text style={styles.contextCopy}>{routeError}</Text>
            <Pressable style={styles.stateButton} accessibilityRole="button" onPress={isTargetError ? () => { void refetchTarget(); } : handleBack}>
              <Text style={styles.stateButtonText}>{isTargetError ? 'Réessayer' : 'Revenir aux articles'}</Text>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  const bothSidesSelected = initiatorItems.length > 0 && receiverItems.length > 0;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ProposeSwapTopBar onBack={handleBack} disabled={isSubmitting} />

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.contextCard}>
            <Text style={styles.contextTitle} accessibilityRole="header">Avec {displayedReceiverName}</Text>
            <Text style={styles.contextCopy}>{isSent ? 'Votre proposition a été envoyée.' : 'Composez votre proposition en choisissant les articles de chaque côté.'}</Text>
            {!user && (
              <Pressable style={styles.stateButton} onPress={handleSignIn} accessibilityRole="button">
                <Text style={styles.stateButtonText}>Se connecter pour proposer un échange</Text>
              </Pressable>
            )}
          </View>
          <ArticleSelectionSection
            label={`Les articles de ${displayedReceiverName}`}
            items={receiverItems}
            variant="their"
            addButtonLabel="Ajouter des articles"
            onRemoveItem={handleRemoveReceiverItem}
            onAdd={handleOpenReceiverSelector}
            disabled={isSubmitting || isSent}
          />

          <SwapSeparator />

          <ArticleSelectionSection
            label="Vos articles"
            items={initiatorItems}
            variant="mine"
            addButtonLabel="Ajouter des articles"
            onRemoveItem={handleRemoveInitiatorItem}
            onAdd={handleOpenInitiatorSelector}
            disabled={isSubmitting || isSent}
          />

          {bothSidesSelected && (
            <ValueComparisonBox
              initiatorTotal={initiatorTotal}
              receiverTotal={receiverTotal}
              complementAmount={complementAmount}
              complementPayer={complementPayer}
              receiverName={displayedReceiverName}
              onComplementAmountChange={setComplementAmount}
              onComplementPayerChange={setComplementPayer}
              disabled={isSubmitting || isSent}
            />
          )}

          <SwapMessageInput value={message} onChangeText={setMessage} disabled={isSubmitting || isSent} />
        </ScrollView>

        <SubmitFooter
          isSubmitting={isSubmitting}
          isDisabled={!bothSidesSelected || !user}
          onSubmit={handleSubmit}
          isSent={isSent}
          onViewSwaps={() => router.push('/my-swaps')}
          disabledReason={!user ? 'Connectez-vous pour envoyer votre proposition.' : undefined}
        />
      </KeyboardAvoidingView>

      {/* Item Selector Modals */}
      <SwapItemSelector
        items={allAvailableItems}
        selectedItems={initiatorItems}
        onSelectionChange={setInitiatorItems}
        visible={showItemSelector}
        onClose={() => setShowItemSelector(false)}
        title="Choisissez vos articles"
        isLoading={isLoadingUserItems}
        errorMessage={isUserItemsError ? 'Impossible de charger vos articles.' : undefined}
        onRetry={() => { void refetchUserItems(); }}
        emptyMessage="Vous n’avez aucun article disponible. Publiez un article pour le proposer en échange."
        emptyActionLabel="Publier un article"
        onEmptyAction={() => { setShowItemSelector(false); router.push('/(tabs)/sell'); }}
      />

      <SwapItemSelector
        items={receiverAvailableItems}
        selectedItems={receiverItems}
        onSelectionChange={setReceiverItems}
        visible={showReceiverSelector}
        onClose={() => setShowReceiverSelector(false)}
        title={`Choisissez les articles de ${displayedReceiverName}`}
        isLoading={isLoadingReceiverItems || isLoadingZoneItems}
        errorMessage={isReceiverItemsError || isZoneItemsError ? 'Impossible de charger les articles de ce membre.' : undefined}
        onRetry={() => { void refetchReceiverItems(); void refetchZoneItems(); }}
        emptyMessage="Ce membre n’a pas d’autre article disponible dans l’espace échanges."
      />
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
    backgroundColor: colors.surfaceWarm,
    borderRadius: radius.xl,
    padding: spacing.md,
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  contextTitle: {
    fontFamily: fonts.displayMedium,
    fontSize: 24,
    lineHeight: 30,
    color: colors.foreground,
  },
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
    borderRadius: radius.xl,
    backgroundColor: colors.charcoal,
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
