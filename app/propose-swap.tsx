/**
 * Propose Swap Screen — Phone 4: Proposer un échange
 * Design System: HTML UI Kit (Cream, Charcoal, Sage, Rust)
 * Features: Multi-article selection, value difference calculation, optional message
 * Match: Exact HTML UI Kit design specifications
 */

import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Alert,
  KeyboardAvoidingView,
} from 'react-native';

import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';

import { useUser } from '@/hooks/useAuth';
import { ArticlesService } from '@/services/articlesService';
import { proposeSwap, getPartyItemsExtended, GENERALIST_ZONE_ID } from '@/services/swapService';
import { ModerationService } from '@/services/moderationService';
import { queryKeys } from '@/lib/queryKeys';
import { SwapItemInfo } from '@/types';
import { colors } from '@/constants/theme';
import { SwapItemSelector, SwapSeparator } from '@/components/swap';
import {
  ProposeSwapSkeleton,
  ProposeSwapTopBar,
  ArticleSelectionSection,
  ValueComparisonBox,
  SwapMessageInput,
  SubmitFooter,
} from '@/features/propose-swap';

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
  const { data: targetArticle, isLoading: isLoadingTarget } = useQuery({
    queryKey: queryKeys.articles.detail(targetArticleId ?? ''),
    queryFn: () => ArticlesService.getArticleById(targetArticleId!),
    enabled: !!targetArticleId && !receiverItemsJson,
    staleTime: 5 * 60 * 1000,
  });

  // --- React Query: fetch current user's articles ---
  const { data: userArticlesRaw } = useQuery({
    queryKey: queryKeys.articles.userList(user?.id ?? ''),
    queryFn: () => ArticlesService.getUserArticles(user!.id),
    enabled: !!user?.id,
    staleTime: 5 * 60 * 1000,
  });

  const effectivePartyId = partyId ?? GENERALIST_ZONE_ID;

  // --- React Query: fetch receiver's articles (for receiver selector) ---
  const { data: receiverArticlesRaw } = useQuery({
    queryKey: queryKeys.articles.userList(receiverId ?? ''),
    queryFn: () => ArticlesService.getUserArticles(receiverId!),
    enabled: !!receiverId,
    staleTime: 5 * 60 * 1000,
  });

  // --- React Query: the zone's deposited items (to scope the receiver
  // selector to what THEY actually deposited, when possible) ---
  const { data: zoneItems } = useQuery({
    queryKey: queryKeys.swapParties.detail(effectivePartyId),
    queryFn: () => getPartyItemsExtended(effectivePartyId),
    enabled: !!receiverId,
    staleTime: 5 * 60 * 1000,
  });

  // Set of article ids the receiver has deposited in the zone.
  const receiverZoneArticleIds = useMemo<Set<string>>(() => {
    if (!zoneItems || !receiverId) return new Set();
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
        const parsed = JSON.parse(receiverItemsJson);
        return Array.isArray(parsed) ? parsed : [parsed];
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
  const [receiverSeeded, setReceiverSeeded] = useState(false);

  // Seed receiver items once when initial data becomes available
  React.useEffect(() => {
    if (!receiverSeeded && initialReceiverItems.length > 0) {
      setReceiverItems(initialReceiverItems);
      setReceiverSeeded(true);
    }
  }, [initialReceiverItems, receiverSeeded]);

  const isLoading = isLoadingTarget && !receiverItemsJson;

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
  const handleOpenInitiatorSelector = useCallback(() => setShowItemSelector(true), []);
  const handleOpenReceiverSelector = useCallback(() => setShowReceiverSelector(true), []);

  // Submit swap proposal
  const handleSubmit = useCallback(async () => {
    if (!user || initiatorItems.length === 0 || receiverItems.length === 0) {
      Alert.alert('Erreur', "Sélectionne des articles de chaque côté");
      return;
    }

    setIsSubmitting(true);
    try {
      // Check if users are blocked before proceeding
      const blocked = await ModerationService.areUsersBlocked(user.id, receiverId || '');
      if (blocked) {
        Alert.alert('Action impossible', 'Tu ne peux pas proposer un échange avec cet utilisateur.');
        return;
      }

      // The UI captures the complement in DOLLARS; the backend expects CENTS.
      const complementDollars = Number(complementAmount);
      const complementCents = Math.round(complementDollars * 100);

      await proposeSwap({
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
          complementCents > 0
            ? {
                amount: complementCents,
                payerId: complementPayer === 'initiator' ? user.id : receiverId || '',
              }
            : undefined,
        partyId: effectivePartyId,
      });

      Alert.alert(
        'Proposition envoyée !',
        "Ta proposition d'échange a été envoyée avec succès.",
        [{ text: 'OK', onPress: () => router.push('/my-swaps') }]
      );
    } catch (error) {
      if (__DEV__) console.error('Error proposing swap:', error);
      Alert.alert('Erreur', "Impossible d'envoyer la proposition");
    } finally {
      setIsSubmitting(false);
    }
  }, [
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
  ]);

  // --- Loading state ---
  if (isLoading) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <Stack.Screen options={{ headerShown: false }} />
        <ProposeSwapSkeleton />
      </SafeAreaView>
    );
  }

  const bothSidesSelected = initiatorItems.length > 0 && receiverItems.length > 0;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />

      <KeyboardAvoidingView style={styles.flex} behavior="height">
        <ProposeSwapTopBar />

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <ArticleSelectionSection
            label="Leur article"
            items={receiverItems}
            variant="their"
            addButtonLabel="+ Ajouter"
            onRemoveItem={handleRemoveReceiverItem}
            onAdd={handleOpenReceiverSelector}
          />

          <SwapSeparator />

          <ArticleSelectionSection
            label="Mon article proposé"
            items={initiatorItems}
            variant="mine"
            addButtonLabel="+ Ajouter un article"
            onRemoveItem={handleRemoveInitiatorItem}
            onAdd={handleOpenInitiatorSelector}
          />

          {bothSidesSelected && (
            <ValueComparisonBox
              initiatorTotal={initiatorTotal}
              receiverTotal={receiverTotal}
              complementAmount={complementAmount}
              complementPayer={complementPayer}
              receiverName={receiverName}
              onComplementAmountChange={setComplementAmount}
              onComplementPayerChange={setComplementPayer}
            />
          )}

          <SwapMessageInput value={message} onChangeText={setMessage} />
        </ScrollView>

        <SubmitFooter
          isSubmitting={isSubmitting}
          isDisabled={!bothSidesSelected}
          onSubmit={handleSubmit}
        />
      </KeyboardAvoidingView>

      {/* Item Selector Modals */}
      <SwapItemSelector
        items={allAvailableItems}
        selectedItems={initiatorItems}
        onSelectionChange={setInitiatorItems}
        visible={showItemSelector}
        onClose={() => setShowItemSelector(false)}
        title="Sélectionner mes articles"
      />

      <SwapItemSelector
        items={receiverAvailableItems}
        selectedItems={receiverItems}
        onSelectionChange={setReceiverItems}
        visible={showReceiverSelector}
        onClose={() => setShowReceiverSelector(false)}
        title="Sélectionner l'article à recevoir"
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
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 120,
  },
});
