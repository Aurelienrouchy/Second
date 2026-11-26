/** Canonical shipping quote → explicit price acceptance → recoverable reservation.
 * The reservation receipt grants no permission to pay. Card/wallet are a later step. */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Redirect, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Checkbox, ScreenHeader } from '@/components/ui';
import {OrdinaryShippingAddressChoice} from '@/components/OrdinaryShippingAddressChoice';
import { colors, radius, sizing, spacing, typography } from '@/constants/theme';
import { PAYMENTS_ENABLED, SHIPPING_ENABLED } from '@/config/featureFlags';
import { ShippingAddressForm, ShippingEstimateList, PriceBreakdown, PayButton, ShippingPurchaseConditions, ShippingCheckoutSkeleton, INITIAL_ADDRESS } from '@/features/checkout-shipping';
import type { AddressFormValues } from '@/features/checkout-shipping';
import { useAuthenticatedSession } from '@/hooks/useAuth';
import { useLabelLifecycleContext } from '@/hooks/useLabelLifecycleContext';
import { useTradeAdmissionError } from '@/hooks/useTradeAdmissionError';
import { ArticlesService } from '@/services/articlesService';
import { ShippingPurchaseService, isShippingQuoteExpiredError, shippingLaunchErrorMessage } from '@/services/shippingPurchaseService';
import { TransactionService } from '@/services/transactionService';
import { staleTradeOperation } from '@/services/tradeOperation';
import { getAuthSessionGeneration } from '@/store/authStore';
import { queryKeys } from '@/lib/queryKeys';
import { formatPriceWithCurrency } from '@/utils/formatPrice';
import { shippingOrderProgress } from '@/utils/shippingOrderProgress';
import {readScopedQuery} from '@/utils/readScopedQuery';
import type {AddressSuggestion} from '@/services/addressAutocompleteService';
import type { OrdinaryShippingAddressKind, ShippingPurchaseAddress, ShippingPurchaseQuote, ShippingPurchaseRate, ShippingReservationReceipt } from '@/types/shippingPurchase';
import {createOrdinaryAddressInteraction, ordinaryPhysicalAddress, ordinaryShippingAddressDeclaration} from '@/utils/ordinaryShippingAddress';
import type { User } from '@/types';

const CA_POSTAL = /^[ABCEGHJKLMNPRSTVXY]\d[ABCEGHJKLMNPRSTVWXYZ] ?\d[ABCEGHJKLMNPRSTVWXYZ]\d$/;
const QC_POSTAL = /^[GHJ]\d[ABCEGHJKLMNPRSTVWXYZ] ?\d[ABCEGHJKLMNPRSTVWXYZ]\d$/;
const newShippingEnabled = SHIPPING_ENABLED && PAYMENTS_ENABLED;
const monotonicNow = () => typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
function prefill(user: User | null): AddressFormValues {
  const physical = user?.address ? ordinaryPhysicalAddress({...user.address, country: 'CA'}) : null;
  return { ...INITIAL_ADDRESS, fullName: user?.displayName ?? '', address: user?.address?.street ?? '',
    city: user?.address?.city ?? '', province: user?.address ? user.address.province ?? '' : 'QC', postalCode: user?.address?.postalCode ?? '', apartment: physical?.line2 ?? '' };
}
function destination(values: AddressFormValues): ShippingPurchaseAddress | null {
  const name = values.fullName.trim(), street = values.address.trim(), city = values.city.trim();
  const postalCode = values.postalCode.trim().toUpperCase();
  if (!name || name.length > 100 || !street || street.length > 200 || !city || city.length > 100 ||
      values.province.trim().toUpperCase() !== 'QC' || !QC_POSTAL.test(postalCode) || values.apartment.trim().length > 200) return null;
  return { street, city, province: 'QC', postalCode: postalCode.replace(' ', ''), country: 'CA',
    ...(values.apartment.trim() ? { line2: values.apartment.trim() } : {}), name };
}

export default function ShippingCheckoutScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ articleId?: string; negotiatedPrice?: string; existingTransactionId?: string; chatId?: string; offerMessageId?: string }>();
  const articleId = typeof params.articleId === 'string' ? params.articleId : '';
  const chatId = typeof params.chatId === 'string' ? params.chatId : '';
  const offerMessageId = typeof params.offerMessageId === 'string' ? params.offerMessageId : '';
  const agreementRequested = params.chatId != null || params.offerMessageId != null;
  const agreementInvalid = agreementRequested && (!/^[A-Za-z0-9_-]{1,200}$/.test(chatId) || !/^[A-Za-z0-9_-]{1,200}$/.test(offerMessageId)) || params.negotiatedPrice != null;
  const existingTransactionId = typeof params.existingTransactionId === 'string' ? params.existingTransactionId : '';
  const { uid, identity } = useAuthenticatedSession();
  const generation = getAuthSessionGeneration();
  const dossier = useLabelLifecycleContext(JSON.stringify([articleId, existingTransactionId, chatId, offerMessageId]), uid);
  const showAdmissionError = useTradeAdmissionError();
  const [addressForm, setAddressForm] = useState<AddressFormValues>(() => prefill(identity));
  const [editingAddress, setEditingAddress] = useState(() => !destination(prefill(identity)));
  const [addressKind, setAddressKind] = useState<OrdinaryShippingAddressKind | null>(null);
  const [addressAccepted, setAddressAccepted] = useState(false);
  const [inputInteraction] = useState(createOrdinaryAddressInteraction);
  const [, setInputRenderRevision] = useState(0);
  const [quoteState, setQuoteState] = useState<{ quote: ShippingPurchaseQuote; source: string; focus: string; receivedAt: number } | null>(null);
  const [quoteClock, setQuoteClock] = useState(monotonicNow);
  const [selectedRateId, setSelectedRateId] = useState<string | null>(null);
  const [acceptedKey, setAcceptedKey] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<ShippingReservationReceipt | null>(null);
  const [notice, setNotice] = useState('');
  const [working, setWorking] = useState<'quote' | 'reserve' | 'verify' | 'restart' | null>(null);
  const inputEpoch = useRef(0);
  const recoveredReservation = useRef<string | null>(null);
  const routedReservation = useRef<string | null>(null);
  const [screenOwner, setScreenOwner] = useState({ uid, generation, articleId, existingTransactionId, chatId, offerMessageId });
  if (screenOwner.uid !== uid || screenOwner.generation !== generation || screenOwner.articleId !== articleId || screenOwner.existingTransactionId !== existingTransactionId || screenOwner.chatId !== chatId || screenOwner.offerMessageId !== offerMessageId) {
    inputInteraction.invalidate();
    if (screenOwner.uid !== uid) {setAddressForm(prefill(identity)); setEditingAddress(!destination(prefill(identity)));}
    setAddressKind(null); setAddressAccepted(false);
    setScreenOwner({ uid, generation, articleId, existingTransactionId, chatId, offerMessageId });
    setQuoteState(null); setSelectedRateId(null); setAcceptedKey(null); setReceipt(null); setNotice(''); setWorking(null);
  }
  const focusKey = JSON.stringify([dossier.frame.toString(), dossier.focusRevision, uid, generation]);
  const [previousFocus, setPreviousFocus] = useState(focusKey);
  if (previousFocus !== focusKey) { inputInteraction.invalidate(); setPreviousFocus(focusKey); setWorking(null); setReceipt(null); }
  const inputGuard = inputInteraction.capture();
  const advanceInput = () => {inputInteraction.invalidate(); inputEpoch.current++; setInputRenderRevision(n => n + 1);};

  const articleQuery = useQuery({ queryKey: queryKeys.articles.detail(articleId),
    queryFn: () => ArticlesService.getArticleById(articleId), enabled: !existingTransactionId && newShippingEnabled && !!articleId && !!uid,
    staleTime: 10 * 60 * 1000, retry: false });
  const article = articleQuery.data ?? null;
  useFocusEffect(useCallback(() => {
    if (!existingTransactionId && newShippingEnabled && uid && articleId) void articleQuery.refetch();
  }, [uid, articleId, existingTransactionId, articleQuery.refetch]));
  const attemptQuery = useQuery({ queryKey: ['shipping-reservation', uid, generation, articleId, dossier.focusRevision],
    queryFn: ({signal}) => readScopedQuery(signal, () => {
      const operation = dossier.capture(); return () => dossier.assertCurrent(operation);
    }, current => ShippingPurchaseService.readAttempt(uid!, articleId, current)), enabled: !existingTransactionId && !!uid && !!articleId && dossier.focused, staleTime: 0, gcTime: 0, retry: false });
  const existingQuery = useQuery({ queryKey: ['shipping-existing-order', uid, generation, existingTransactionId, dossier.focusRevision],
    queryFn: ({signal}) => readScopedQuery(signal, () => {
      const operation = dossier.capture(); return () => dossier.assertCurrent(operation);
    }, async current => {
      const existing = await TransactionService.readExistingShippingReservation(uid!, existingTransactionId, current);
      current();
      if (existing.transactionId !== existingTransactionId) throw new Error('Commande inaccessible.');
      return existing;
    }), enabled: !!uid && !!existingTransactionId && dossier.focused, staleTime: 0, gcTime: 0, retry: false });

  const pendingAttempt = !existingTransactionId ? attemptQuery.data ?? null : null;
  const knownReceipt = existingTransactionId
    ? existingQuery.data?.transactionId === existingTransactionId ? existingQuery.data : null
    : receipt ?? pendingAttempt?.receipt ?? null;
  const currentOrderQuery = useQuery({
    queryKey: ['shipping-current-order', uid, generation, knownReceipt?.transactionId, dossier.focusRevision],
    enabled: !!uid && !!knownReceipt && dossier.focused,
    staleTime: 0, gcTime: 0, retry: false,
    queryFn: ({signal}) => readScopedQuery(signal, () => {
      const operation = dossier.capture(); return () => dossier.assertCurrent(operation);
    }, async current => {
      const order = await TransactionService.getTransaction(knownReceipt!.transactionId, {expectedUid: uid!, assertCurrent: current});
      current();
      if (!order || order.id !== knownReceipt!.transactionId || existingTransactionId && order.id !== existingTransactionId || order.buyerId !== uid) throw new Error('Commande inaccessible.');
      return order;
    }),
  });
  const currentOrder = currentOrderQuery.data ?? null;
  const currentOrderReady = dossier.focused && currentOrderQuery.isSuccess && !currentOrderQuery.isFetching && !currentOrderQuery.isError &&
    !!uid && !!currentOrder && currentOrder.id === knownReceipt?.transactionId && (!existingTransactionId || currentOrder.id === existingTransactionId) && currentOrder.buyerId === uid;
  const existingProgress = currentOrderReady ? shippingOrderProgress(currentOrder, uid) : null;
  const continueExistingOrder = () => {
    if (!currentOrderReady || !currentOrder || !existingProgress) return;
    try {dossier.capture();} catch {return;}
    router.push(newShippingEnabled && existingProgress.destination === 'payment'
      ? {pathname: '/payment/[transactionId]', params: {transactionId: currentOrder.id}}
      : {pathname: '/orders/[id]', params: {id: currentOrder.id}});
  };
  useEffect(() => {
    // Continue only after this visit received an authoritative reservation and
    // reread its order. A saved receipt alone does not authorize payment.
    if (existingTransactionId || !uid || !receipt || !dossier.focused || working || currentOrderQuery.isFetching ||
        currentOrderQuery.isError || !currentOrder || currentOrder.id !== receipt.transactionId) return;
    const navigationKey = JSON.stringify([uid, generation, receipt.transactionId, dossier.focusRevision]);
    if (routedReservation.current === navigationKey) return;
    try { dossier.capture(); } catch { return; }
    const next = shippingOrderProgress(currentOrder, uid);
    if (!next) return;
    routedReservation.current = navigationKey;
    if (newShippingEnabled && next.destination === 'payment') {
      router.replace({pathname: '/payment/[transactionId]', params: {transactionId: currentOrder.id}});
    } else {
      router.replace({pathname: '/orders/[id]', params: {id: currentOrder.id}});
    }
  }, [uid, generation, existingTransactionId, receipt, dossier, working,
    currentOrderQuery.isFetching, currentOrderQuery.isError, currentOrder, router]);
  const cancelledWithProof = !!pendingAttempt && ShippingPurchaseService.hasCommittedCancellation(currentOrder, pendingAttempt);
  const articleSource = JSON.stringify(article ? [article.id, article.sellerId, article.isActive, article.isSold, article.isShipping,
    article.title, article.description, article.price, article.images, article.category, article.categoryIds, article.condition,
    article.size, article.brand, article.brandStatus, article.colors, article.materials, article.packageSize, article.shopId,
    article.hasKnownDefects, article.defectsDescription, article.hasAlterations, article.alterationsDescription] : null);
  const source = JSON.stringify([uid, generation, articleId, chatId, offerMessageId, agreementInvalid, articleSource, addressForm, addressKind, addressAccepted]);
  const action = useLabelLifecycleContext(source, uid);
  const [previousActionFrame, setPreviousActionFrame] = useState(action.frame);
  if (previousActionFrame !== action.frame) { setPreviousActionFrame(action.frame); setWorking(null); }
  const currentQuote = quoteState?.source === source && quoteState.focus === dossier.focusRevision ? quoteState.quote : null;
  const remainingMs = currentQuote && quoteState ? Math.max(0, currentQuote.validUntil - currentQuote.serverTime -
    Math.max(0, quoteClock - quoteState.receivedAt)) : 0;
  const quoteExpired = !!currentQuote && remainingMs <= 0;
  useEffect(() => {
    if (!currentQuote || !quoteState || !dossier.focused || quoteExpired) return;
    const left = currentQuote.validUntil - currentQuote.serverTime - Math.max(0, monotonicNow() - quoteState.receivedAt);
    const timer = setTimeout(() => setQuoteClock(monotonicNow()), Math.max(0, Math.ceil(left)));
    return () => clearTimeout(timer);
  }, [currentQuote, quoteState, dossier.focused, quoteClock, quoteExpired]);
  const quoteStillLive = () => !!currentQuote && !!quoteState && currentQuote.validUntil - currentQuote.serverTime >
    Math.max(0, monotonicNow() - quoteState.receivedAt);
  const selectedRate = currentQuote?.rates.find(rate => rate.rateId === selectedRateId) ?? null;
  const currentAcceptanceKey = currentQuote && selectedRate
    ? JSON.stringify([source, dossier.focusRevision, currentQuote.quoteId, selectedRate.rateId, selectedRate.totalAmount, currentQuote.purchasePolicy,
      currentQuote.pricingVersion, currentQuote.taxSnapshot, ...(currentQuote.transport ? [currentQuote.transport] : [])]) : null;
  const reservationContext = useLabelLifecycleContext(currentAcceptanceKey ?? 'shipping-quote-unselected', uid);
  const accepted = !!currentQuote?.transport && !quoteExpired && currentAcceptanceKey !== null && acceptedKey === currentAcceptanceKey;
  const shippingDestination = destination(addressForm);
  const canRequestQuote = !existingTransactionId && newShippingEnabled && !!uid && !!article && article.sellerId !== uid &&
    article.isActive === true && article.isShipping === true && !article.isSold && !!shippingDestination && !!addressKind && addressAccepted &&
    attemptQuery.isSuccess && !pendingAttempt && !knownReceipt && !working && !agreementInvalid;

  const changeAddress = <K extends keyof AddressFormValues>(field: K, value: AddressFormValues[K]) => {
    try { inputGuard(); dossier.capture(); } catch { return; }
    advanceInput();
    setAddressForm(previous => ({ ...previous, [field]: value }));
    setAddressKind(null); setAddressAccepted(false);
    setQuoteState(null); setSelectedRateId(null); setAcceptedKey(null); setNotice('');
  };
  const selectAddressSuggestion = (suggestion: AddressSuggestion): boolean => {
    try {inputGuard(); dossier.capture();} catch {return false;}
    if (suggestion.province.trim().toUpperCase() !== 'QC') return false;
    const next = {...addressForm, address: suggestion.street, city: suggestion.city, province: suggestion.province, postalCode: suggestion.postalCode};
    advanceInput(); setAddressForm(next); setAddressKind(null); setAddressAccepted(false);
    setQuoteState(null); setSelectedRateId(null); setAcceptedKey(null); setNotice('');
    setEditingAddress(!destination(next));
    return true;
  };
  const changeAddressDeclaration = (kind: OrdinaryShippingAddressKind | null, accepted: boolean) => {
    try {inputGuard(); dossier.capture();} catch {return;}
    advanceInput(); setAddressKind(kind); setAddressAccepted(accepted);
    setQuoteState(null); setSelectedRateId(null); setAcceptedKey(null); setNotice('');
  };
  const selectRate = (rate: ShippingPurchaseRate) => {
    try { inputGuard(); action.capture(); } catch { return; }
    if (!quoteStillLive() || !currentQuote?.rates.some(item => item === rate)) return;
    advanceInput(); setSelectedRateId(rate.rateId); setAcceptedKey(null);
  };
  const requestQuote = async () => {
    if (!uid || !canRequestQuote || !shippingDestination || !addressKind || !addressAccepted) return;
    try {inputGuard();} catch {return;}
    let operation;
    try { operation = action.start(); } catch { return; }
    if (!operation) return;
    const epoch = inputEpoch.current;
    const assertCurrent = () => { action.assertCurrent(operation); inputGuard(); if (inputEpoch.current !== epoch) throw staleTradeOperation(); };
    setWorking('quote'); setQuoteState(null); setSelectedRateId(null); setAcceptedKey(null); setNotice('');
    try {
      const prior = await attemptQuery.refetch(); assertCurrent();
      if (prior.isError) throw prior.error;
      if (prior.data) { setNotice('Retrouvons votre réservation avant de poursuivre.'); return; }
      const shippingUseDeclaration = await ordinaryShippingAddressDeclaration(shippingDestination, addressKind); assertCurrent();
      const response = await ShippingPurchaseService.quote(uid, articleId, {...shippingDestination, shippingUseDeclaration}, assertCurrent,
        offerMessageId ? {chatId, offerMessageId} : undefined);
      assertCurrent();
      const receivedAt = monotonicNow(); setQuoteClock(receivedAt);
      setQuoteState({ quote: response, source, focus: dossier.focusRevision, receivedAt });
    } catch (error) {
      if (!action.isCurrent(operation) || inputEpoch.current !== epoch) return;
      const launchMessage = shippingLaunchErrorMessage(error);
      if (launchMessage) setNotice(launchMessage);
      else if (!showAdmissionError(error, { isCurrent: () => action.isCurrent(operation) && inputEpoch.current === epoch, retry: () => { void requestQuote(); } })) {
        Alert.alert('Devis indisponible', error instanceof Error ? error.message : 'Impossible de vérifier ce devis. Votre saisie est conservée.');
      }
    } finally { if (action.isCurrent(operation)) setWorking(null); action.finish(operation); }
  };
  const reserve = async () => {
    if (!uid || !accepted || !currentQuote || !selectedRate || pendingAttempt || !canRequestQuote) return;
    try {inputGuard();} catch {return;}
    if (!quoteStillLive()) { setQuoteClock(monotonicNow()); setAcceptedKey(null); setNotice('Ce devis est expiré pour une nouvelle réservation. Refaites le devis puis acceptez son nouveau total.'); return; }
    let operation;
    try { operation = reservationContext.start(); } catch { return; }
    if (!operation) return;
    const epoch = inputEpoch.current;
    const assertCurrent = () => { reservationContext.assertCurrent(operation); inputGuard(); if (inputEpoch.current !== epoch) throw staleTradeOperation(); };
    setWorking('reserve'); setNotice('');
    try {
      const response = await TransactionService.reserveShippingPurchase(uid, articleId, currentQuote.destination, {
        deliveryType: 'shipping', quoteId: currentQuote.quoteId, rateId: selectedRate.rateId, expectedTotal: selectedRate.totalAmount,
        purchasePolicyAccepted: true, expectedPurchasePolicyVersion: currentQuote.purchasePolicy.policyVersion,
        expectedPurchasePolicyHash: currentQuote.purchasePolicy.hash, purchasePolicy: currentQuote.purchasePolicy,
        ...(currentQuote.transport ? {expectedTransportTermsHash: currentQuote.transport.termsHash} : {}),
      }, assertCurrent);
      assertCurrent(); setReceipt(response);
      await attemptQuery.refetch(); assertCurrent();
    } catch (error) {
      if (!reservationContext.isCurrent(operation) || inputEpoch.current !== epoch) return;
      const reread = await attemptQuery.refetch();
      if (!reservationContext.isCurrent(operation) || inputEpoch.current !== epoch) return;
      const errorNavigation = dossier.capture();
      setQuoteState(null); setSelectedRateId(null); setAcceptedKey(null);
      if (reread.isError || reread.data) setNotice(isShippingQuoteExpiredError(error)
        ? 'Le devis a expiré. Actualisez le suivi pour connaître l’état de votre réservation.'
        : 'La réservation n’est pas encore confirmée. Votre demande est conservée.');
      else if (isShippingQuoteExpiredError(error)) setNotice('Ce devis a expiré. Actualisez les tarifs avant de continuer.');
      else if (shippingLaunchErrorMessage(error)) setNotice(shippingLaunchErrorMessage(error)!);
      else if (!showAdmissionError(error, { isCurrent: () => dossier.isCurrent(errorNavigation) && inputEpoch.current === epoch })) {
        setNotice(error instanceof Error ? error.message : 'La réservation n’a pas été confirmée. Votre saisie est conservée. Réessayez dans un instant.');
      }
    } finally { if (reservationContext.isCurrent(operation)) setWorking(null); reservationContext.finish(operation); }
  };
  const verifyPrevious = async () => {
    if (existingTransactionId || !uid || !pendingAttempt) return;
    let operation;
    try { operation = dossier.start(); } catch { return; }
    if (!operation) return;
    const assertCurrent = () => dossier.assertCurrent(operation);
    setWorking('verify'); setNotice('');
    try {
      const response = await TransactionService.reserveShippingPurchase(uid, pendingAttempt.articleId, pendingAttempt.destination,
        pendingAttempt.input, assertCurrent, true);
      assertCurrent(); setReceipt(response);
      await attemptQuery.refetch(); assertCurrent();
    } catch (error) {
      if (!dossier.isCurrent(operation)) return;
      const reread = await attemptQuery.refetch();
      if (!dossier.isCurrent(operation)) return;
      if (!showAdmissionError(error, { isCurrent: () => dossier.isCurrent(operation), retry: () => { void verifyPrevious(); } })) {
        setNotice(reread.isError || reread.data ? 'Impossible de confirmer la réservation pour le moment. Votre demande est conservée.'
          : error instanceof Error ? error.message : 'La réservation n’a pas été confirmée. Demandez un nouveau devis si vous souhaitez poursuivre.');
      }
    } finally { if (dossier.isCurrent(operation)) setWorking(null); dossier.finish(operation); }
  };
  useEffect(() => {
    if (existingTransactionId || !uid || !dossier.focused || !pendingAttempt || knownReceipt || working || attemptQuery.isFetching) return;
    const recoveryKey = JSON.stringify([uid, generation, articleId, dossier.focusRevision, pendingAttempt.destination, pendingAttempt.input]);
    if (recoveredReservation.current === recoveryKey) return;
    recoveredReservation.current = recoveryKey;
    // Reuse only the already accepted, persisted quote/rate/total. This
    // idempotent reservation recovery never starts a payment or a new quote.
    void verifyPrevious();
  }, [uid, generation, articleId, existingTransactionId, dossier.focusRevision, dossier.focused, pendingAttempt, knownReceipt, working, attemptQuery.isFetching, verifyPrevious]);
  const startNewPurchase = async () => {
    if (existingTransactionId || !uid || !pendingAttempt?.receipt || !cancelledWithProof || !newShippingEnabled || currentOrderQuery.isFetching || working) return;
    let operation;
    try { operation = dossier.start(); } catch { return; }
    if (!operation) return;
    const assertCurrent = () => dossier.assertCurrent(operation);
    setWorking('restart'); setNotice('');
    try {
      await ShippingPurchaseService.startNewAfterCancellation(uid, articleId, pendingAttempt.receipt.transactionId, assertCurrent,
        async () => {
          const order = await TransactionService.getTransaction(pendingAttempt.receipt!.transactionId);
          assertCurrent(); return order;
        });
      assertCurrent();
      setReceipt(null); setQuoteState(null); setSelectedRateId(null); setAcceptedKey(null);
      const reread = await attemptQuery.refetch(); assertCurrent();
      if (reread.isError || reread.data) throw new Error('Impossible de confirmer l’annulation pour le moment. Actualisez son suivi avant de continuer.');
      await articleQuery.refetch(); assertCurrent();
      setNotice('Votre annulation est confirmée. Vous pouvez demander un nouveau devis.');
    } catch (error) {
      if (dossier.isCurrent(operation)) setNotice(error instanceof Error ? error.message : 'Impossible de confirmer l’annulation pour le moment. Votre demande est conservée.');
    } finally { if (dossier.isCurrent(operation)) setWorking(null); dossier.finish(operation); }
  };

  if (!uid) return <Redirect href="/(tabs)" />;
  if (!articleId && !existingTransactionId) return <Redirect href="/checkout" />;
  const header = <ScreenHeader title="Livraison et réservation" onBack={() => router.back()} />;
  const servicing = <>
    <Button variant="secondary" onPress={() => router.push('/my-orders')}>Mes commandes existantes</Button>
    <Button variant="ghost" onPress={() => router.push('/settings/help')}>Contacter notre équipe</Button>
  </>;
  if (existingTransactionId) return <View style={styles.container}>{header}<View style={styles.content}>
    {existingQuery.isPending ? <Text style={styles.body}>Lecture de la commande existante…</Text> : existingQuery.isError ? <>
      <Text style={styles.notice}>Impossible de vérifier cette commande.</Text><Button onPress={() => { void existingQuery.refetch(); }}>Réessayer</Button>
    </> : <><Text style={styles.title}>Commande retrouvée</Text>
      {currentOrderQuery.isError ? <><Text style={styles.notice}>Impossible d’actualiser la commande.</Text><Button onPress={() => {try {dossier.capture(); void currentOrderQuery.refetch();} catch {/* Inactive. */}}}>Réessayer</Button></>
        : !currentOrderReady ? <Text style={styles.body}>Actualisation de la commande…</Text> : null}
      {existingProgress ? <Button onPress={continueExistingOrder}>{newShippingEnabled && existingProgress.destination === 'payment' ? 'Continuer vers le paiement' : 'Suivre ma commande'}</Button> : null}</>}
    {servicing}</View></View>;
  if (knownReceipt) return <View style={styles.container}>{header}<View style={styles.content}>
    <Text style={styles.title}>{currentOrder?.status === 'cancelled' ? 'Commande annulée' : receipt?.replay === false ? 'Article réservé — paiement en attente' : 'Réservation retrouvée'}</Text>
    <Text style={styles.body}>{receipt?.replay === false ? 'Réservation enregistrée, paiement en attente.' : 'Consultez la commande pour connaître l’état du paiement et de la livraison.'}</Text>
    {pendingAttempt ? <Text style={styles.body}>Total accepté : {formatPriceWithCurrency(pendingAttempt.input.expectedTotal)}</Text> : null}
    {existingProgress ? <Button disabled={!!working} onPress={continueExistingOrder}>{newShippingEnabled && existingProgress.destination === 'payment' ? 'Continuer vers le paiement' : 'Suivre ma commande'}</Button> : null}
    {currentOrderQuery.isPending ? <Text style={styles.body}>Lecture de l’état actuel de la commande…</Text> : null}
    {currentOrderQuery.isError ? <><Text style={styles.notice}>L’état actuel de la commande n’a pas pu être vérifié. Aucun nouveau devis n’est permis.</Text>
      <Button variant="ghost" onPress={() => { void currentOrderQuery.refetch(); }}>Relire la commande</Button></> : null}
    {currentOrder?.status === 'cancelled' ? <Text style={styles.body}>{cancelledWithProof
      ? 'Le reçu de l’annulation est enregistré. Un nouvel achat nécessite un nouveau devis et une nouvelle acceptation.'
      : 'L’annulation n’est pas encore confirmée. Consultez la commande avant un nouvel achat.'}</Text> : null}
    {cancelledWithProof && newShippingEnabled ? <Button disabled={!!working || currentOrderQuery.isFetching || currentOrderQuery.isError}
      loading={working === 'restart'} onPress={() => { void startNewPurchase(); }}>Commencer un nouvel achat</Button> : null}
    {notice ? <Text accessibilityRole="alert" style={styles.notice}>{notice}</Text> : null}
    {servicing}
  </View></View>;
  if (attemptQuery.isPending) return <View style={styles.container}>{header}<ShippingCheckoutSkeleton /></View>;
  if (attemptQuery.isError) return <View style={styles.container}>{header}<View style={styles.content}>
    <Text style={styles.notice}>Impossible de retrouver votre réservation. Votre saisie est conservée.</Text>
    <Button onPress={() => { void attemptQuery.refetch(); }}>Réessayer</Button>{servicing}
  </View></View>;
  if (pendingAttempt) return <View style={styles.container}>{header}<View style={styles.content}>
    <Text style={styles.title}>Reprendre votre réservation</Text>
    <Text style={styles.body}>Retrouvons votre réservation avant de poursuivre le paiement.</Text>
    <Text style={styles.body}>{pendingAttempt.destination.name} · {pendingAttempt.destination.street} · {pendingAttempt.destination.city} · {pendingAttempt.destination.province} · {pendingAttempt.destination.postalCode}</Text>
    <Text style={styles.body}>Total accepté : {formatPriceWithCurrency(pendingAttempt.input.expectedTotal)}</Text>
    {pendingAttempt.input.purchasePolicy ? <>
      <Text style={styles.body}>Protection : {pendingAttempt.input.purchasePolicy.parameters.deliveryProtectionMs / 86400000} jours après la livraison. Délai d’expédition : {pendingAttempt.input.purchasePolicy.parameters.nonShipmentMs / 86400000} jours après le paiement.</Text>
    </> : null}
    {notice ? <Text accessibilityRole="alert" style={styles.notice}>{notice}</Text> : null}
    <Button loading={working === 'verify'} disabled={!!working} onPress={() => { void verifyPrevious(); }}>Actualiser</Button>
    {servicing}
  </View></View>;
  if (!newShippingEnabled) return <Redirect href={{ pathname: '/checkout', params: { articleId } }} />;
  if (articleQuery.isPending) return <View style={styles.container}>{header}<ShippingCheckoutSkeleton /></View>;

  return <View style={styles.container}>{header}<KeyboardAvoidingView style={styles.flex}
    behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={insets.top + spacing.xl}>
    <ScrollView style={styles.flex} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {articleQuery.isError ? <><Text style={styles.notice}>Impossible de relire cet article.</Text><Button onPress={() => { void articleQuery.refetch(); }}>Relire l’article</Button></>
        : !article ? <Text style={styles.notice}>Article introuvable.</Text> : <Text style={styles.title}>{typeof currentQuote?.item.title === 'string' ? currentQuote.item.title : article.title}</Text>}
      {article && (article.isSold || article.isActive !== true || article.isShipping !== true) ? <Text style={styles.notice}>Cet article n’est pas disponible pour une nouvelle réservation expédiée.</Text> : null}
      {article?.sellerId === uid ? <Text style={styles.notice}>Vous ne pouvez pas acheter votre propre article.</Text> : null}
      {agreementInvalid ? <Text style={styles.notice}>Revenez à l’offre acceptée dans votre conversation pour commander à ce prix.</Text>
        : offerMessageId ? <Text style={styles.body}>{currentQuote?.offer ? `Offre acceptée : ${formatPriceWithCurrency(currentQuote.offer.amount)}` : 'Le devis reprendra le prix de votre offre acceptée.'}</Text> : null}
      {!editingAddress && shippingDestination ? <View style={styles.addressCard}>
        <View style={styles.addressHeader}><Text style={styles.title}>Livrer à</Text><Pressable accessibilityRole="button" accessibilityLabel="Modifier l’adresse de livraison" style={styles.modify}
          onPress={() => {try {inputGuard(); dossier.capture(); setEditingAddress(true);} catch {/* Inactive. */}}}><Text style={styles.modifyText}>Modifier</Text></Pressable></View>
        <Text style={styles.body}>{addressForm.fullName}</Text><Text style={styles.body}>{addressForm.address}{addressForm.apartment ? `, ${addressForm.apartment}` : ''}</Text>
        <Text style={styles.body}>{addressForm.city}, {addressForm.province} {addressForm.postalCode}</Text>
      </View> : <><ShippingAddressForm values={addressForm} onChangeField={changeAddress} onSelectAddress={selectAddressSuggestion}
        scopeKey={JSON.stringify([uid, generation, articleId, chatId, offerMessageId, dossier.focusRevision])} disabled={!!working || !dossier.focused}
        destinationProvinceError={!!addressForm.province && addressForm.province.trim().toUpperCase() !== 'QC'}
        postalCodeError={!!addressForm.postalCode.trim() && (!CA_POSTAL.test(addressForm.postalCode.trim().toUpperCase()) ||
          (addressForm.province === 'QC' && !QC_POSTAL.test(addressForm.postalCode.trim().toUpperCase())))} />
        {shippingDestination ? <Button variant="ghost" disabled={!!working} onPress={() => {try {inputGuard(); dossier.capture(); setEditingAddress(false);} catch {/* Inactive. */}}}>Utiliser cette adresse</Button> : null}</>}
      <OrdinaryShippingAddressChoice kind={addressKind} accepted={addressAccepted} disabled={!!working}
        onKind={kind => changeAddressDeclaration(kind, false)} onAccepted={() => {if (addressKind) changeAddressDeclaration(addressKind, !addressAccepted);}}/>
      <Button disabled={!canRequestQuote} loading={working === 'quote'} onPress={() => { void requestQuote(); }}>{quoteExpired ? 'Actualiser les tarifs' : 'Voir les tarifs de livraison'}</Button>
      {currentQuote ? <View>
        <Text style={styles.caption}>{quoteExpired ? 'Tarif expiré. Actualisez les tarifs avant de continuer.' : `Tarif proposé jusqu’à ${new Date(currentQuote.validUntil).toLocaleTimeString('fr-CA', {hour: '2-digit', minute: '2-digit', timeZone: 'America/Toronto'})}, heure du Québec.`}</Text>
      </View> : null}
      {notice ? <Text accessibilityRole="alert" style={styles.notice}>{notice}</Text> : null}
      {currentQuote || working === 'quote' ? <ShippingEstimateList rates={currentQuote?.rates ?? []} selectedRateId={selectedRateId} onSelect={selectRate} loading={working === 'quote'} disabled={!!working || quoteExpired} /> : null}
      {selectedRate && currentQuote ? <><PriceBreakdown rate={selectedRate} taxSnapshot={currentQuote.taxSnapshot} />
        {currentQuote.transport && currentAcceptanceKey ? <ShippingPurchaseConditions quote={currentQuote} rate={selectedRate} sourceKey={currentAcceptanceKey}
          disabled={!!working || !dossier.focused} assertCurrent={() => {inputGuard(); reservationContext.capture();}}
          onSupport={() => router.push('/settings/help')}/> : <Text accessibilityRole="alert" style={styles.notice}>Les conditions de livraison ne sont pas disponibles. Actualisez les tarifs pour continuer.</Text>}
        <Checkbox checked={accepted} disabled={!!working || quoteExpired || !currentQuote.transport}
        accessibilityLabel={`J’accepte le total de ${formatPriceWithCurrency(selectedRate.totalAmount)} et les conditions de l’achat`}
        onToggle={() => {
          try { inputGuard(); action.capture(); } catch { return; }
          if (!currentQuote.transport) return;
          if (!quoteStillLive()) { setQuoteClock(monotonicNow()); setAcceptedKey(null); return; }
          advanceInput(); setAcceptedKey(accepted ? null : currentAcceptanceKey);
        }}><Text style={styles.body}>J’accepte le total et les conditions de l’achat.</Text></Checkbox></> : null}
      {article && article.isHandDelivery !== false ? <Button variant="ghost" disabled={!!working}
        onPress={() => router.replace({ pathname: '/checkout/meetup', params: { articleId } })}>Proposer une remise en main propre</Button> : null}
    </ScrollView>
    {selectedRate ? <PayButton totalAmount={selectedRate.totalAmount} accepted={accepted} submitting={working === 'reserve'}
      disabled={!canRequestQuote || quoteExpired || !currentQuote?.transport} onPress={() => { void reserve(); }} /> : null}
  </KeyboardAvoidingView></View>;
}
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background }, flex: { flex: 1 },
  content: { padding: spacing.lg, gap: spacing.md }, title: { ...typography.h3, color: colors.foreground },
  body: { ...typography.body, color: colors.foregroundSecondary }, caption: { ...typography.caption, color: colors.muted },
  notice: { ...typography.body, color: colors.danger },
  addressCard: {padding: spacing.md, borderRadius: radius.sm, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.surface, gap: spacing.xs},
  addressHeader: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md},
  modify: {minHeight: sizing.minTouchTarget, justifyContent: 'center', paddingHorizontal: spacing.sm}, modifyText: {...typography.bodySmall, color: colors.primary},
});
