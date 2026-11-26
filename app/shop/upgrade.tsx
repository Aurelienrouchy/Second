/**
 * Shop Tier Upgrade Screen (F134)
 * Design System: Editorial Luxe — Cream, Charcoal, Rust, Sage
 *
 * Le propriétaire d'une boutique achète / renouvelle un forfait payant
 * (basic gratuit / pro / premium). Le bénéfice vendu = réduction des frais
 * ACHETEUR (pro 50%, premium 100% — la commission vendeur reste 0%). Le
 * paiement est une charge plateforme directe : `purchaseShopTier` retourne un
 * clientSecret confirmé via le Payment Sheet natif.
 * Le forfait n'est appliqué (tier + tierPaidUntil) qu'APRÈS confirmation du
 * paiement, côté serveur (webhook).
 */

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CancelledError, useQuery } from '@tanstack/react-query';

import { PAYMENTS_ENABLED } from '@/config/featureFlags';
import { runtimeEnvironment } from '@/config/firebaseEnvironment';
import { ScreenHeader } from '@/components/ui';
import { ShopService, type ShopTierPurchaseJournal, type ShopTierPurchaseObservation } from '@/services/shopService';
import type { Shop } from '@/types';
import { useStripe } from '@/lib/stripe';
import { useLabelLifecycleContext } from '@/hooks/useLabelLifecycleContext';
import { staleTradeOperation } from '@/services/tradeOperation';
import { track } from '@/lib/analytics';
import { queryKeys } from '@/lib/queryKeys';
import { useAuthenticatedUid, useUser } from '@/hooks/useAuth';
import { getAuthSessionGeneration } from '@/store/authStore';
import { APP_LOCALE } from '@/constants/locale';
import { colors, fonts, radius, spacing } from '@/constants/theme';
import { formatPriceWithCurrency } from '@/utils/formatPrice';

// =============================================================================
// CONSTANTS
// =============================================================================

type PaidTier = 'pro' | 'premium';

interface TierMeta {
  key: 'basic' | 'pro' | 'premium';
  name: string;
  /** Monthly price IN CENTS — display only (server is the source of truth). */
  monthlyCents: number;
  benefit: string;
  features: string[];
  accent: string;
}

/**
 * Display config. Prices mirror the server defaults in
 * functions/src/callable/shopTier.ts (pro 2999¢, premium 7999¢) but the actual
 * charged amount comes from the callable (`amountCents`) — never trusted here.
 */
const TIERS: readonly TierMeta[] = [
  {
    key: 'basic',
    name: 'Standard',
    monthlyCents: 0,
    benefit: 'Frais acheteur standard',
    features: ['0% de commission vendeur', 'Boutique vérifiée', 'Présence sur la carte'],
    accent: colors.muted,
  },
  {
    key: 'pro',
    name: 'Le Comptoir',
    monthlyCents: 2999,
    benefit: '-50% de frais acheteur',
    features: [
      '0% de commission vendeur',
      'Frais de protection acheteur réduits de moitié',
      'Visibilité renforcée',
    ],
    accent: colors.sage,
  },
  {
    key: 'premium',
    name: 'La Maison',
    monthlyCents: 7999,
    benefit: '0% de frais acheteur',
    features: [
      '0% de commission vendeur',
      'Aucun frais de protection pour vos acheteurs',
      'Mise en avant prioritaire',
    ],
    accent: colors.rust,
  },
] as const;

const PERIOD_OPTIONS = [1, 3, 6, 12] as const;
type Period = typeof PERIOD_OPTIONS[number];

function formatCents(cents: number): string {
  return formatPriceWithCurrency(cents / 100);
}

function formatTierName(tier: string | undefined): string {
  return TIERS.find((t) => t.key === tier)?.name ?? 'Standard';
}

// A displayed offer is bound to its native operation and pricing, never a local tariff.
const offerKey = (offer: ShopTierPurchaseObservation | null) => offer ? JSON.stringify([
  offer.actorId, offer.requestId, offer.operationId, offer.command.shopId, offer.command.tier, offer.command.periodMonths,
  offer.paymentIntentId, offer.amountCents, offer.pricing?.hash ?? null, offer.readAt,
]) : null;
const sameOffer = (fresh: ShopTierPurchaseObservation, accepted: ShopTierPurchaseObservation) =>
  fresh.actorId === accepted.actorId && fresh.requestId === accepted.requestId && fresh.operationId === accepted.operationId &&
  fresh.command.shopId === accepted.command.shopId && fresh.command.tier === accepted.command.tier && fresh.command.periodMonths === accepted.command.periodMonths &&
  fresh.paymentIntentId === accepted.paymentIntentId && fresh.amountCents === accepted.amountCents && (fresh.pricing?.hash ?? null) === (accepted.pricing?.hash ?? null);

// =============================================================================
// SCREEN
// =============================================================================

export default function ShopUpgradeScreen() {
  const { shopId: routeShopId } = useLocalSearchParams<{ shopId?: string | string[] }>();
  const shopId = typeof routeShopId === 'string' && routeShopId === routeShopId.trim() && routeShopId.length <= 128 && !routeShopId.includes('/') ? routeShopId : '';
  const router = useRouter();
  const user = useUser();
  // Historical requests survive an absent/incomplete normal commerce profile.
  const uid = useAuthenticatedUid();
  const context = useLabelLifecycleContext(`shop-upgrade:${shopId}`, uid);
  const { initPaymentSheet, presentPaymentSheet } = useStripe();
  type Operation = {handle: NonNullable<ReturnType<typeof context.start>>; uid: string; shopId: string};
  const lock = useRef<Operation | null>(null);
  const dialog = useRef<symbol | null>(null);
  const automaticallyObserved = useRef<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<{frame: symbol; focus: string; observation: ShopTierPurchaseObservation} | null>(null);
  const [newChoice, setNewChoice] = useState<{frame: symbol; focus: string} | null>(null);
  const [selectedTier, setSelectedTier] = useState<PaidTier>('pro');
  const [periodMonths, setPeriodMonths] = useState<Period>(1);
  const [mountedAt] = useState(() => Date.now());
  const [previousContext, setPreviousContext] = useState({frame: context.frame, focus: context.focusRevision});
  if (previousContext.frame !== context.frame || previousContext.focus !== context.focusRevision) {
    setPreviousContext({frame: context.frame, focus: context.focusRevision}); setBusy(false);
  }
  useLayoutEffect(() => {lock.current = null; dialog.current = null;}, [context.frame, context.focusRevision]);
  const { data: shop = null, isLoading: shopLoading } = useQuery<Shop | null>({
    queryKey: queryKeys.shops.detail(shopId), queryFn: () => ShopService.getShopById(shopId), enabled: !!shopId,
    staleTime: 30 * 1000,
  });
  const journalQuery = useQuery<ShopTierPurchaseJournal | null>({
    queryKey: ['shop-tier-purchase-journal', uid, shopId, getAuthSessionGeneration(), context.focusRevision],
    queryFn: async ({signal}) => {
      try {
        if (signal.aborted) throw new CancelledError({revert: true});
        const operation = context.capture();
        return await ShopService.getShopTierPurchaseJournal(uid!, shopId, () => context.assertCurrent(operation));
      } catch (error) {
        if (signal.aborted || error && typeof error === 'object' && 'code' in error && error.code === 'client/stale-operation') throw new CancelledError({revert: true});
        throw error;
      }
    },
    enabled: !!uid && !!shopId && context.focused, staleTime: 0, gcTime: 0, retry: false,
  });
  const journal = journalQuery.data ?? null;
  const journalReady = journalQuery.isSuccess && journalQuery.data !== undefined;
  const currentView = view?.frame === context.frame && view.focus === context.focusRevision && context.focused &&
    view.observation.actorId === uid && view.observation.requestId === journal?.requestId ? view.observation : null;
  const displayedOfferKey = offerKey(currentView), latestOffer = useRef<string | null>(null);
  useLayoutEffect(() => {latestOffer.current = displayedOfferKey;}, [displayedOfferKey]);
  const acknowledged = !!currentView?.receipt && currentView.receipt.proofHash === journal?.acknowledgedReceipt;
  const choosingAnother = newChoice?.frame === context.frame && newChoice.focus === context.focusRevision && context.focused;
  const isOwner = !!shop && !!user && user.id === uid && shop.ownerId === uid;
  const canChoose = PAYMENTS_ENABLED && isOwner && journalReady && (!journal || acknowledged && choosingAnother);
  const canResume = PAYMENTS_ENABLED && !!user && user.id === uid && !!journal && !journal.cancelRequested && !journal.neutralizeRequested && !journal.acknowledgedReceipt &&
    !!currentView && (currentView.state === 'payable' || currentView.state === 'reserved');
  const canCancel = !!journal && !journal.acknowledgedReceipt && currentView?.state === 'payable' && !!currentView.paymentIntentId;
  const canNeutralize = !!currentView && !currentView.postAuthorized && currentView.paymentIntentId === null && ['unrecorded','reserved'].includes(currentView.state);
  const selectedMeta = TIERS.find(tier => tier.key === selectedTier)!;
  const estimatedTotalCents = selectedMeta.monthlyCents * periodMonths;
  const activeTierLabel = !shop ? null : shop.tier && shop.tier !== 'basic' && shop.tierPaidUntil && shop.tierPaidUntil.getTime() > mountedAt
    ? `Forfait affiché : ${formatTierName(shop.tier)} jusqu’au ${shop.tierPaidUntil.toLocaleDateString(APP_LOCALE)}` : 'Forfait affiché : Standard ou période expirée';

  const guard = (operation: Operation) => {
    context.assertCurrent(operation.handle);
    if (lock.current !== operation || operation.uid !== uid || operation.shopId !== shopId) throw staleTradeOperation();
  };
  const start = (): Operation | null => {
    if (!uid || !shopId || lock.current) return null;
    const handle = context.start(); if (!handle) return null;
    const operation = {handle, uid, shopId}; lock.current = operation; setBusy(true); return operation;
  };
  const perform = async (action: (operation: Operation) => Promise<ShopTierPurchaseObservation>) => {
    let operation: Operation | null = null;
    try {
      operation = start(); if (!operation) return;
      guard(operation);
      const observation = await action(operation);
      guard(operation);
      setView({frame: context.frame, focus: context.focusRevision, observation});
      if (observation.receipt?.outcome === 'settled') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      return observation;
    } catch (error: unknown) {
      if (!operation) return;
      try {guard(operation);} catch {return;}
      // A transport/SDK error invalidates an offer, never its durable intention.
      setView(null);
      Alert.alert('Paiement à vérifier', error instanceof Error ? error.message : 'Vérifiez le suivi de votre paiement.');
    } finally {
      if (operation) {
        try {guard(operation); await journalQuery.refetch();} catch { /* The next current screen reloads the same durable UID/shop tuple. */ }
        context.finish(operation.handle);
        if (lock.current === operation) {lock.current = null; setBusy(false);}
      }
    }
  };

  const handleNewPurchase = () => {
    if (!canChoose || busy) return;
    const command = {shopId, tier: selectedTier, periodMonths};
    void perform(async operation => {
      setNewChoice(null);
      const observed = await ShopService.beginShopTierPurchase(operation.uid, command, true, () => guard(operation));
      guard(operation);
      track('shop_upgrade_submitted', {shop_id: command.shopId, tier: command.tier, period_months: command.periodMonths,
        estimated_total_cents: estimatedTotalCents, current_tier: shop?.tier ?? 'basic', success: true});
      return observed;
    });
  };
  const handleObserve = () => {void perform(operation => ShopService.observeShopTierPurchase(operation.uid, operation.shopId, () => guard(operation)));};
  useEffect(() => {
    if (!context.focused || !journal || currentView || busy) return;
    const key = JSON.stringify([uid, shopId, journal.requestId, getAuthSessionGeneration(), context.focusRevision]);
    if (automaticallyObserved.current === key) return;
    automaticallyObserved.current = key;
    handleObserve();
  }, [uid, shopId, journal, currentView, busy, context.frame, context.focusRevision, context.focused, handleObserve]);
  const handleResume = () => {
    if (!canResume || busy) return;
    void perform(operation => ShopService.resumeShopTierPurchase(operation.uid, operation.shopId, () => guard(operation)));
  };
  const handleConfirm = () => {
    const accepted = currentView;
    if (!canResume || !accepted?.clientSecret || accepted.amountCents === null || !accepted.paymentIntentId || busy) return;
    const displayedKey = offerKey(accepted);
    void perform(async operation => {
      const currentOffer = () => {guard(operation); if (latestOffer.current !== displayedKey) throw staleTradeOperation();};
      currentOffer();
      // Refresh THIS request and its exact frozen tax components before SDK confirmation.
      const fresh = await ShopService.resumeShopTierPurchase(operation.uid, operation.shopId, currentOffer);
      currentOffer();
      if (fresh.state !== 'payable' || !fresh.clientSecret || !sameOffer(fresh, accepted)) return {...fresh, clientSecret: null};
      await ShopService.recordShopTierPaymentSheet(operation.uid, operation.shopId, fresh, currentOffer);
      currentOffer();
      const initialized = await initPaymentSheet({paymentIntentClientSecret: fresh.clientSecret, merchantDisplayName: 'Seconde',
        googlePay: {merchantCountryCode: 'CA', testEnv: runtimeEnvironment.name !== 'production'}, style: 'alwaysLight', returnURL: runtimeEnvironment.name === 'production'
          ? `${runtimeEnvironment.appScheme}://checkout/success`
          : `${runtimeEnvironment.appScheme}:///checkout/success`});
      currentOffer();
      if (initialized.error) throw new Error(initialized.error.message);
      await ShopService.assertShopTierPaymentSession(operation.uid, currentOffer);
      currentOffer();
      const beforePresentation = await ShopService.observeShopTierPurchase(operation.uid, operation.shopId, currentOffer);
      currentOffer();
      if (beforePresentation.state !== 'payable' || !sameOffer(beforePresentation, accepted)) return {...beforePresentation, clientSecret: null};
      const result = await presentPaymentSheet();
      currentOffer();
      track('payment_sheet_completed', {source: 'shop_upgrade', context_id: operation.shopId, amount_cents: fresh.amountCents!,
        result: !result.error ? 'success' : result.error.code === 'Canceled' ? 'cancelled' : 'failed'});
      // Even Canceled says nothing about provider cancellation or settlement.
      return ShopService.observeShopTierPurchase(operation.uid, operation.shopId, () => guard(operation));
    });
  };
  const handleCancel = async () => {
    const accepted = currentView;
    if (!canCancel || !accepted?.paymentIntentId || accepted.amountCents === null || busy || dialog.current) return;
    let captured: ReturnType<typeof context.capture>;
    try {captured = context.capture();} catch {return;}
    const fresh = await perform(operation => ShopService.observeShopTierPurchase(operation.uid, operation.shopId, () => guard(operation)));
    try {context.assertCurrent(captured);} catch {return;}
    if (!fresh || fresh.state !== 'payable' || !fresh.paymentIntentId || fresh.amountCents === null || fresh.requestId !== accepted.requestId || fresh.paymentIntentId !== accepted.paymentIntentId || fresh.amountCents !== accepted.amountCents) return;
    const paymentIntentId = fresh.paymentIntentId;
    const token = Symbol(); dialog.current = token;
    const closeDialog = () => {if (dialog.current === token) dialog.current = null;};
    Alert.alert('Annuler ce paiement non confirmé',
      `${formatTierName(fresh.command.tier)} · ${fresh.command.periodMonths} mois · ${formatCents(fresh.amountCents)}. Fermer la fenêtre de paiement ne suffit pas à l’annuler.`, [
      {text: 'Conserver', style: 'cancel', onPress: closeDialog},
      {text: 'Annuler ce paiement', style: 'destructive', onPress: () => {
        if (dialog.current !== token) return;
        closeDialog();
        try {context.assertCurrent(captured);} catch {return;}
        void perform(operation => ShopService.cancelShopTierPurchase(operation.uid, operation.shopId, paymentIntentId, true, () => guard(operation), fresh.requestId));
      }},
    ], {onDismiss: closeDialog});
  };
  const handleNeutralize = () => {
    if (!canNeutralize || busy || dialog.current || !currentView) return;
    const requestId = currentView.requestId;
    let captured: ReturnType<typeof context.capture>;
    try {captured = context.capture();} catch {return;}
    const token = Symbol(); dialog.current = token;
    const closeDialog = () => {if (dialog.current === token) dialog.current = null;};
    Alert.alert('Abandonner cette demande', 'L’abandon doit être confirmé avant de commencer un autre paiement.', [
      {text: 'Conserver', style: 'cancel', onPress: closeDialog},
      {text: 'Confirmer l’abandon', onPress: () => {
        if (dialog.current !== token) return;
        closeDialog();
        try {context.assertCurrent(captured);} catch {return;}
        void perform(operation => ShopService.neutralizeShopTierPurchase(operation.uid, operation.shopId, () => guard(operation), requestId));
      }},
    ], {onDismiss: closeDialog});
  };
  const handleAcknowledge = () => {
    const proof = currentView?.receipt?.proofHash;
    if (!proof || busy) return;
    void perform(operation => ShopService.acknowledgeShopTierPurchase(operation.uid, operation.shopId, proof, () => guard(operation)));
  };
  const handleChooseAnother = () => {
    if (!acknowledged || busy || !PAYMENTS_ENABLED || !isOwner) return;
    try {context.capture();} catch {return;}
    setNewChoice({frame: context.frame, focus: context.focusRevision});
  };
  const statusText = currentView?.receipt?.outcome === 'settled'
    ? `Paiement confirmé. Période payée jusqu’au ${new Date(currentView.receipt.paidUntil!).toLocaleDateString(APP_LOCALE)}.`
    : currentView?.receipt?.outcome === 'canceled' ? 'Paiement annulé.'
      : currentView?.receipt?.outcome === 'not_executed' ? 'Demande abandonnée. Aucun paiement ne sera lancé.'
        : currentView?.state === 'payable' ? 'Paiement en attente de confirmation. Vous pouvez le reprendre ou l’annuler.'
          : currentView?.state === 'activation_pending' ? 'Paiement reçu. Activation du forfait en attente.'
            : currentView?.state === 'processing' ? 'Paiement en cours de traitement. Vérifiez son résultat avant de réessayer.'
              : 'Résultat du paiement à vérifier. Votre demande est sauvegardée.';

  return (
    <View style={styles.container}>
      <ScreenHeader title="Forfait boutique" onBack={() => router.back()} />
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {!!activeTierLabel && <View style={styles.activeBanner}><Ionicons name="ribbon-outline" size={18} color={colors.primary} /><Text style={styles.activeBannerText}>{activeTierLabel}</Text></View>}
        {!uid && <Text style={styles.errorSubtitle}>Connectez-vous au compte concerné pour consulter ses demandes de forfait.</Text>}
        {uid && !journalReady && !journalQuery.isError && <ActivityIndicator size="small" color={colors.primary} />}
        {journalQuery.isError && <View style={styles.activeBanner}><Text style={styles.activeBannerText}>Le suivi conservé est indisponible. Aucun nouveau paiement ne sera préparé.</Text><Pressable onPress={() => {if (!lock.current) void journalQuery.refetch();}}><Text style={styles.cancelButtonText}>Réessayer</Text></Pressable></View>}
        {journal && (
          <View>
            <Text style={styles.sectionTitle}>SUIVI DU FORFAIT</Text>
            <Text style={styles.footerLabel}>{formatTierName(journal.command.tier)} · {journal.command.periodMonths} mois</Text>
            <Text style={styles.intro}>{statusText}</Text>
            {(currentView?.amountCents ?? journal.native.amountCents) !== null && <Text style={styles.footerTotal}>{formatCents((currentView?.amountCents ?? journal.native.amountCents)!)}</Text>}
            {currentView?.pricing ? <View>
              <Text style={styles.offerNotice}>Prix : {formatCents(currentView.pricing.priceCents)} {currentView.pricing.priceMode === 'exclusive' ? 'HT (taxes en sus)' : 'TTC (taxes incluses)'}.</Text>
              <Text style={styles.offerNotice}>Net {formatCents(currentView.pricing.netCents)} · TPS {formatCents(currentView.pricing.gstCents)} · TVQ {formatCents(currentView.pricing.qstCents)} · taxes {formatCents(currentView.pricing.taxCents)} · total {formatCents(currentView.pricing.totalCents)} CAD.</Text>
            </View> : currentView && currentView.amountCents !== null ? <Text style={styles.offerNotice}>Le détail des taxes de cette ancienne demande est indisponible.</Text> : null}
            <Pressable style={[styles.payButton, busy && styles.payButtonDisabled]} disabled={busy} onPress={handleObserve}><Text style={styles.payButtonText}>{busy ? 'ACTUALISATION…' : 'ACTUALISER'}</Text></Pressable>
            {canResume && !currentView?.clientSecret && <Pressable style={styles.cancelButton} disabled={busy} onPress={handleResume}><Text style={styles.cancelButtonText}>Reprendre ce paiement</Text></Pressable>}
            {canCancel && <Pressable style={styles.cancelButton} disabled={busy} onPress={handleCancel}><Text style={styles.cancelButtonText}>Annuler ce paiement non confirmé</Text></Pressable>}
            {canNeutralize && <Pressable style={styles.cancelButton} disabled={busy} onPress={handleNeutralize}><Text style={styles.cancelButtonText}>Abandonner cette demande</Text></Pressable>}
            {currentView?.terminal && !acknowledged && <Pressable style={styles.cancelButton} disabled={busy} onPress={handleAcknowledge}><Text style={styles.cancelButtonText}>J’ai pris connaissance du résultat</Text></Pressable>}
            {acknowledged && !choosingAnother && PAYMENTS_ENABLED && isOwner && <Pressable style={styles.cancelButton} disabled={busy} onPress={handleChooseAnother}><Text style={styles.cancelButtonText}>Choisir un nouveau forfait ou renouvellement</Text></Pressable>}
          </View>
        )}
        {!PAYMENTS_ENABLED && <Text style={styles.intro}>Les nouvelles souscriptions payantes ne sont pas disponibles. Le suivi et les recours des demandes existantes restent accessibles.</Text>}
        {uid && journalReady && !journal && !isOwner && !shopLoading && <Text style={styles.errorSubtitle}>Aucune demande n’est conservée pour cette boutique. Sa gestion est réservée à son propriétaire.</Text>}
        {canChoose && (
          <View>
            <Text style={styles.intro}>Choisissez votre forfait et sa durée. Vous confirmerez le total avant de payer.</Text>
            {TIERS.map(tier => {
              const selectable = tier.key !== 'basic', selected = selectable && selectedTier === tier.key;
              return (
                <Pressable key={tier.key} style={[styles.tierCard, selected && tierStyles[tier.key].selectedCard, !selectable && styles.tierCardDisabled]}
                  disabled={!selectable || busy} onPress={() => {if (!lock.current && selectable) setSelectedTier(tier.key as PaidTier);}}>
                  <View style={styles.tierHeader}><Text style={styles.tierName}>{tier.name}</Text><Text style={[styles.tierPrice, tierStyles[tier.key].accentText]}>{tier.monthlyCents === 0 ? 'Gratuit' : `${formatCents(tier.monthlyCents)}/mois`}</Text></View>
                  <Text style={[styles.tierBenefit, tierStyles[tier.key].accentText]}>{tier.benefit}</Text>
                  {tier.features.map(feature => <View key={feature} style={styles.featureRow}><Ionicons name="checkmark-circle" size={16} color={tier.accent} /><Text style={styles.featureText}>{feature}</Text></View>)}
                </Pressable>
              );
            })}
            <Text style={styles.sectionTitle}>DURÉE</Text>
            <View style={styles.periodRow}>{PERIOD_OPTIONS.map(months => <Pressable key={months} style={[styles.periodChip, periodMonths === months && styles.periodChipActive]} disabled={busy} onPress={() => {if (!lock.current) setPeriodMonths(months);}}><Text style={[styles.periodChipText, periodMonths === months && styles.periodChipTextActive]}>{months} mois</Text></Pressable>)}</View>
          </View>
        )}
      </ScrollView>
      <SafeAreaView edges={['bottom']} style={styles.footer}>
        {busy && <ActivityIndicator size="small" color={colors.primary} />}
        {canChoose && <View><View style={styles.footerSummary}><Text style={styles.footerLabel}>{selectedMeta.name} · {periodMonths} mois · estimation</Text><Text style={styles.footerTotal}>{formatCents(estimatedTotalCents)}</Text></View><Pressable style={[styles.payButton, busy && styles.payButtonDisabled]} disabled={busy} onPress={handleNewPurchase}><Text style={styles.payButtonText}>CONTINUER</Text></Pressable></View>}
        {canResume && currentView?.clientSecret && currentView.amountCents !== null && <View>{currentView.pricing ? <>
          <Text style={styles.offerNotice}>Prix : {formatCents(currentView.pricing.priceCents)} {currentView.pricing.priceMode === 'exclusive' ? 'HT — taxes en sus' : 'TTC — taxes incluses'}.</Text>
          <Text style={styles.offerNotice}>Net {formatCents(currentView.pricing.netCents)} · TPS {formatCents(currentView.pricing.gstCents)} · TVQ {formatCents(currentView.pricing.qstCents)} · total à payer {formatCents(currentView.pricing.totalCents)} CAD.</Text>
        </> : <Text style={styles.offerNotice}>Détail des taxes indisponible pour cette ancienne demande.</Text>}<Text style={styles.offerNotice}>{formatTierName(currentView.command.tier)} · {currentView.command.periodMonths} mois · total {formatCents(currentView.amountCents)}. {currentView.amountCents !== TIERS.find(tier => tier.key === currentView.command.tier)!.monthlyCents * currentView.command.periodMonths ? 'Ce total diffère de l’estimation affichée.' : ''}</Text><Pressable style={[styles.payButton, busy && styles.payButtonDisabled]} disabled={busy} onPress={handleConfirm}><Ionicons name="lock-closed-outline" size={16} color={colors.cream} /><Text style={styles.payButtonText}>PAYER {formatCents(currentView.amountCents)}</Text></Pressable></View>}
      </SafeAreaView>
    </View>
  );
}

// =============================================================================
// STYLES
// =============================================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.lg,
    paddingBottom: spacing.xl,
  },
  skeletonContent: {
    padding: spacing.lg,
  },
  skeletonTitle: { marginBottom: spacing.lg },
  skeletonCard: { marginBottom: spacing.md },
  selectedCardBasic: { borderColor: colors.muted, borderWidth: 2 },
  selectedCardPro: { borderColor: colors.sage, borderWidth: 2 },
  selectedCardPremium: { borderColor: colors.rust, borderWidth: 2 },
  accentBasic: { color: colors.muted },
  accentPro: { color: colors.sage },
  accentPremium: { color: colors.rust },
  radioBorderBasic: { borderColor: colors.muted },
  radioBorderPro: { borderColor: colors.sage },
  radioBorderPremium: { borderColor: colors.rust },
  radioFillBasic: { backgroundColor: colors.muted },
  radioFillPro: { backgroundColor: colors.sage },
  radioFillPremium: { backgroundColor: colors.rust },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    gap: spacing.sm,
  },
  errorTitle: {
    fontFamily: fonts.displayMedium,
    fontSize: 18,
    color: colors.charcoal,
    textAlign: 'center',
  },
  errorSubtitle: {
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.muted,
    textAlign: 'center',
  },
  activeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primaryLight,
    borderRadius: radius.sm,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  activeBannerText: {
    flex: 1,
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    color: colors.primary,
  },
  intro: {
    fontFamily: fonts.sans,
    fontSize: 14,
    lineHeight: 20,
    color: colors.foregroundSecondary,
    marginBottom: spacing.lg,
  },
  tierCard: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  tierCardDisabled: {
    opacity: 0.7,
  },
  tierHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  tierTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  tierName: {
    fontFamily: fonts.displaySemiBold,
    fontSize: 18,
    color: colors.charcoal,
  },
  currentBadge: {
    backgroundColor: colors.surfaceWarm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  currentBadgeText: {
    fontFamily: fonts.sansMedium,
    fontSize: 10,
    color: colors.muted,
  },
  tierPrice: {
    fontFamily: fonts.sansMedium,
    fontSize: 14,
  },
  tierBenefit: {
    fontFamily: fonts.sansMedium,
    fontSize: 15,
    marginBottom: spacing.sm,
  },
  tierFeatures: {
    gap: spacing.xs + 2,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  featureText: {
    flex: 1,
    fontFamily: fonts.sans,
    fontSize: 13,
    color: colors.foregroundSecondary,
  },
  radio: {
    position: 'absolute',
    top: spacing.md,
    right: spacing.md,
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  sectionTitle: {
    fontFamily: fonts.sansMedium,
    fontSize: 9,
    letterSpacing: 1.8,
    color: colors.muted,
    marginTop: spacing.sm,
    marginBottom: spacing.sm + 4,
    textTransform: 'uppercase',
  },
  periodRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  periodChip: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceWarm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  periodChipActive: {
    backgroundColor: colors.charcoal,
    borderColor: colors.charcoal,
  },
  periodChipText: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    color: colors.muted,
  },
  periodChipTextActive: {
    color: colors.cream,
  },
  footer: {
    backgroundColor: colors.cream,
    paddingTop: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  offerNotice: {
    fontFamily: fonts.sans,
    fontSize: 13,
    color: colors.foregroundSecondary,
    marginBottom: spacing.sm,
  },
  cancelButton: { paddingVertical: spacing.md, alignItems: 'center' },
  cancelButtonText: { fontFamily: fonts.sansMedium, color: colors.foregroundSecondary },
  footerSummary: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  footerLabel: {
    fontFamily: fonts.sans,
    fontSize: 13,
    color: colors.muted,
  },
  footerTotal: {
    fontFamily: fonts.displaySemiBold,
    fontSize: 20,
    color: colors.rust,
  },
  payButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.rust,
    paddingVertical: 14,
    borderRadius: radius.md,
    gap: 8,
  },
  payButtonDisabled: {
    opacity: 0.6,
  },
  payButtonText: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    letterSpacing: 2.16,
    color: colors.cream,
    textTransform: 'uppercase',
  },
});

const tierStyles = {
  basic: { selectedCard: styles.selectedCardBasic, accentText: styles.accentBasic, radioBorder: styles.radioBorderBasic, radioFill: styles.radioFillBasic },
  pro: { selectedCard: styles.selectedCardPro, accentText: styles.accentPro, radioBorder: styles.radioBorderPro, radioFill: styles.radioFillPro },
  premium: { selectedCard: styles.selectedCardPremium, accentText: styles.accentPremium, radioBorder: styles.radioBorderPremium, radioFill: styles.radioFillPremium },
};
