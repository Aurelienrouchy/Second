import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Checkbox, ScreenHeader } from '@/components/ui';
import { RefundStatusNotice } from '@/components/RefundStatusNotice';
import { OrderArticleSummary } from '@/features/orders';
import { useWallet } from '@/features/wallet/hooks/useWallet';
import { WalletService } from '@/features/wallet/services/walletService';
import { useAuthenticatedSession, useUser } from '@/hooks/useAuth';
import { useLabelLifecycleContext } from '@/hooks/useLabelLifecycleContext';
import { ShippingPurchaseService } from '@/services/shippingPurchaseService';
import { APP_LOCALE } from '@/constants/locale';
import { useTradeAdmissionError } from '@/hooks/useTradeAdmissionError';
import { TransactionService } from '@/services/transactionService';
import {isDefinitiveTradeRefusal} from '@/services/tradeOperation';
import { ManualPaymentService, canReadExistingCheckoutWithoutCreation, exactPaymentCents, hasExistingPaymentExposure, hasConfirmedPurchasePayment } from '@/services/manualPaymentService';
import { getPaymentBlockReason } from '@/utils/refundPresentation';
import { getTransactionArticlePresentation } from '@/utils/transactionArticlePresentation';
import {readScopedQuery} from '@/utils/readScopedQuery';
import { formatPriceWithCurrency } from '@/utils/formatPrice';
import { CardField, useStripe } from '@/lib/stripe';
import type { StripeCardFieldProps } from '@/lib/stripe.types';
import { CHECKOUT_RETURN_URL } from '@/config/stripeConfig';
import { getAuthSessionGeneration } from '@/store/authStore';
import { queryKeys } from '@/lib/queryKeys';
import { DEV_COMMERCE_TESTING_ENABLED, PAYMENTS_ENABLED, SHIPPING_ENABLED } from '@/config/featureFlags';
import { colors, sizing, spacing, typography } from '@/constants/theme';
import type { Transaction } from '@/types/transaction';
import type { CheckoutObservation, ManualCheckout, ManualPaymentAttempt } from '@/types/manualPayment';

const cardStyle: StripeCardFieldProps['cardStyle'] = { backgroundColor: colors.surface, textColor: colors.foreground, placeholderColor: colors.muted };
const canUseNativeCard = Platform.OS !== 'web';
const exactWalletAttempt = (attempt: ManualPaymentAttempt | null, order: Transaction, uid: string) =>
  !!attempt && attempt.version === 1 && attempt.uid === uid && attempt.transactionId === order.id &&
  attempt.mode === 'wallet' && attempt.phase === 'wallet_requested' && attempt.intentVersion === undefined &&
  attempt.legacyRetirement === undefined && Number.isSafeInteger(attempt.totalCents) && attempt.totalCents > 0 &&
  attempt.totalCents === exactPaymentCents(order.totalAmount) && attempt.walletCents === attempt.totalCents;

/** Server-manual card authorization; native authentication never establishes settlement. */
export default function PaymentScreen() {
  const { transactionId } = useLocalSearchParams<{ transactionId: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { uid } = useAuthenticatedSession();
  const normalUser = useUser();
  const normalPurchaseAccess = !!normalUser && normalUser.id === uid;
  const generation = getAuthSessionGeneration();
  const context = useLabelLifecycleContext(transactionId ?? '', uid);
  const scope = JSON.stringify([uid, generation, transactionId, context.focusRevision]);
  const stripe = useStripe();
  const showAdmissionError = useTradeAdmissionError();
  const [walletSelected, setWalletSelected] = useState(false);
  const [cardComplete, setCardComplete] = useState(false);
  const [cardFormVersion, setCardFormVersion] = useState(0);
  const [observed, setObserved] = useState<{ scope: string; value: CheckoutObservation } | null>(null);
  const [busy, setBusy] = useState<{ scope: string; label: string } | null>(null);
  const [notice, setNotice] = useState('');
  const [optionsScope, setOptionsScope] = useState<string | null>(null);
  const [acceptedKey, setAcceptedKey] = useState<string | null>(null);
  const acceptance = useRef<{ key: string; epoch: number } | null>(null);
  const inputEpoch = useRef(0);
  const recoveredPayment = useRef<string | null>(null);
  const [previousScope, setPreviousScope] = useState(scope);
  if (previousScope !== scope) {
    setPreviousScope(scope); setObserved(null); setBusy(null); setNotice(''); setAcceptedKey(null); setCardComplete(false); setWalletSelected(false);
  }
  const working = busy?.scope === scope;
  const observation = observed?.scope === scope && context.focused ? observed.value : null;
  const manual = observation?.protocol === 'server_manual_v1' ? observation : null;
  const manualCanConfirm = !!manual?.confirmationRequired && manual.action === 'confirmOnServer';
  const legacy = observation?.protocol === 'legacy' ? observation : null;
  const queryKey = [...queryKeys.payments.transaction(transactionId ?? '', uid ?? ''), generation, context.focusRevision];
  const orderQuery = useQuery({ queryKey, enabled: !!uid && !!transactionId && context.focused, staleTime: 0, gcTime: 0, retry: false,
    queryFn: ({signal}) => readScopedQuery(signal, () => {
      const operation = context.capture(); return () => context.assertCurrent(operation);
    }, async current => {
      const order = await TransactionService.getTransaction(transactionId, {expectedUid: uid!, assertCurrent: current});
      current();
      if (!order || order.id !== transactionId || order.buyerId !== uid) throw new Error('Commande inaccessible.');
      return order;
    }),
  });
  const journalQuery = useQuery({ queryKey: ['manual-payment', uid, generation, transactionId, context.focusRevision],
    enabled: !!uid && !!transactionId && context.focused, staleTime: 0, gcTime: 0, retry: false,
    queryFn: ({signal}) => readScopedQuery(signal, () => {
      const operation = context.capture(); return () => context.assertCurrent(operation);
    }, current => ManualPaymentService.readAttempt(uid!, transactionId, current)),
  });
  const order = orderQuery.data ?? null;
  const preparationQuery = useQuery({queryKey: ['purchase-preparation-policy', uid, generation, transactionId, context.focusRevision, orderQuery.dataUpdatedAt],
    enabled: !!uid && !!transactionId && context.focused && orderQuery.isSuccess && !orderQuery.isFetching && !orderQuery.isError,
    staleTime: 0, gcTime: 0, retry: false, queryFn: ({signal}) => readScopedQuery(signal, () => {
      const operation = context.capture(); return () => context.assertCurrent(operation);
    }, current => ShippingPurchaseService.readPreparationPolicy(uid!, transactionId, current))});
  const preparation = context.focused && orderQuery.isSuccess && !orderQuery.isFetching && !orderQuery.isError && preparationQuery.isSuccess && !preparationQuery.isFetching && !preparationQuery.isError ? preparationQuery.data : null;
  const saved = journalQuery.data ?? null;
  const { wallet, refetch: refreshWallet } = useWallet(!!uid && PAYMENTS_ENABLED && context.focused, uid ?? undefined);
  const totalCents = order ? exactPaymentCents(order.totalAmount) : null;
  const walletBalance = wallet?.hasWallet && Number.isSafeInteger(wallet.balance) && wallet.balance >= 0 ? wallet.balance : 0;
  const chosenWallet = saved?.walletCents ?? (walletSelected && totalCents !== null ? Math.min(walletBalance, totalCents) : 0);
  const payable = !!order && !!uid && getPaymentBlockReason(order, uid) === null && order.deliveryType === 'shipping';
  const nativeEnabled = normalPurchaseAccess && PAYMENTS_ENABLED && SHIPPING_ENABLED && canUseNativeCard;
  const cleanOrder = payable && typeof order?.shippingQuoteId === 'string' && typeof order.shipEngineRateId === 'string';
  const gateKey = manual ? JSON.stringify([scope, manual.transactionId, manual.intentVersion, manual.totalCents, manual.walletCents, manual.cardCents]) : null;
  const accepted = gateKey !== null && acceptedKey === gateKey;
  const paymentSourcesReady = context.focused && orderQuery.isSuccess && !orderQuery.isFetching && !orderQuery.isError &&
    journalQuery.isSuccess && !journalQuery.isFetching && !journalQuery.isError;
  const walletResumeAvailable = nativeEnabled && cleanOrder && paymentSourcesReady && !!uid && !!order && exactWalletAttempt(saved, order, uid) &&
    order.currency === 'CAD' && order.shippingAddress?.province === 'QC' && order.shippingAddress.country === 'CA' &&
    order.stripePaymentIntentId == null && order.stripeCheckoutProtocol == null && order.stripeChargeId == null;

  const changeInput = (change: () => void) => {
    let operation;
    try { operation = context.start(); } catch { return; }
    if (!operation) return;
    inputEpoch.current++; acceptance.current = null; setAcceptedKey(null); change(); context.finish(operation);
  };
  const freshOrder = async (assertCurrent: () => void): Promise<Transaction> => {
    assertCurrent();
    const fresh = await TransactionService.getTransaction(transactionId); assertCurrent();
    if (!fresh || fresh.id !== transactionId || fresh.buyerId !== uid) throw new Error('Commande inaccessible.');
    queryClient.setQueryData(queryKey, fresh);
    return fresh;
  };
  const setObservation = async (response: CheckoutObservation, initial: ManualPaymentAttempt | undefined, assertCurrent: () => void) => {
    assertCurrent();
    let next = initial;
    if (response.protocol === 'server_manual_v1') {
      next = { version: 1, uid: uid!, transactionId, totalCents: response.totalCents, walletCents: response.walletCents,
        mode: 'card', intentVersion: response.intentVersion,
        phase: response.confirmationRequired && response.action === 'confirmOnServer' || response.action === 'handleNextAction' ? 'prepared' : 'reconciliation_required' };
      await ManualPaymentService.remember(next, assertCurrent); assertCurrent();
    }
    setObserved({ scope, value: response }); acceptance.current = null; setAcceptedKey(null);
    setCardComplete(false); setCardFormVersion(value => value + 1);
    await journalQuery.refetch(); assertCurrent();
    return next;
  };
  const confirmSettlement = async (attempt: ManualPaymentAttempt | undefined, assertCurrent: () => void, wait: boolean) => {
    for (let count = 0; count < (wait ? 8 : 1); count++) {
      const fresh = await freshOrder(assertCurrent);
      if (hasConfirmedPurchasePayment(fresh, uid!, attempt)) {
        const latest = await ManualPaymentService.readAttempt(uid!, transactionId, assertCurrent); assertCurrent();
        if (latest) await ManualPaymentService.remember({ ...latest, phase: 'settled' }, assertCurrent);
        assertCurrent();
        void queryClient.invalidateQueries({ queryKey: queryKeys.orders.all }); void refreshWallet();
        setNotice('Le paiement de cette commande est enregistré.');
        assertCurrent(); router.replace({pathname: '/orders/[id]', params: {id: transactionId}});
        return true;
      }
      if (getPaymentBlockReason(fresh, uid!) !== null) {
        setNotice('Cette commande a évolué. Consultez son suivi pour connaître la suite.'); return false;
      }
      if (wait && count < 7) { await new Promise<void>(resolve => setTimeout(resolve, 1000)); assertCurrent(); }
    }
    setNotice('Le paiement n’est pas encore confirmé dans la commande. Vérifiez son résultat ; ne renvoyez pas une nouvelle demande.'); return false;
  };
  const confirmCard = async (submittedOrder: Transaction, attempt: ManualPaymentAttempt, checkout: ManualCheckout,
    assertCurrent: () => void, paymentMethodId?: string): Promise<CheckoutObservation | null> => {
    if (attempt.mode !== 'card') throw new Error('Ce paiement doit être repris depuis le mode choisi.');
    const submittedPaymentIntentId = submittedOrder.stripePaymentIntentId;
    try {
      return await ManualPaymentService.confirm(uid!, submittedOrder, attempt, checkout, assertCurrent, paymentMethodId);
    } catch (confirmationError) {
      assertCurrent();
      recoveredPayment.current = JSON.stringify([scope, submittedOrder.stripePaymentIntentId, submittedOrder.walletCheckoutAttemptId, submittedOrder.walletCheckoutOutcome]);
      const code = confirmationError && typeof confirmationError === 'object' && 'code' in confirmationError ? confirmationError.code : null;
      if (isDefinitiveTradeRefusal(confirmationError) || code === 'unauthenticated' || code === 'functions/unauthenticated') throw confirmationError;
      const unconfirmed = (cause: unknown) => Object.assign(new Error('Le paiement n’est pas encore confirmé. Actualisez le paiement pour connaître son résultat.'), {cause});
      try {
        // A webhook may have committed this very payment before the POST's
        // response fence. Re-read once; never repeat confirmation or create a PI.
        const current = await freshOrder(assertCurrent);
        const latest = await ManualPaymentService.readAttempt(uid!, transactionId, assertCurrent); assertCurrent();
        recoveredPayment.current = JSON.stringify([scope, current.stripePaymentIntentId, current.walletCheckoutAttemptId, current.walletCheckoutOutcome]);
        if (latest && latest.uid === uid && latest.transactionId === transactionId && latest.mode === 'card' &&
            ['confirmation_requested', 'settled'].includes(latest.phase) && latest.intentVersion === checkout.intentVersion &&
            latest.totalCents === attempt.totalCents && latest.walletCents === attempt.walletCents &&
            submittedPaymentIntentId && current.stripePaymentIntentId === submittedPaymentIntentId &&
            hasConfirmedPurchasePayment(current, uid!, latest)) {
          await ManualPaymentService.remember({...latest, phase: 'settled'}, assertCurrent); assertCurrent();
          void queryClient.invalidateQueries({queryKey: queryKeys.orders.all}); void refreshWallet();
          setNotice('Le paiement de cette commande est enregistré.');
          router.replace({pathname: '/orders/[id]', params: {id: transactionId}});
          return null;
        }
      } catch (readError) {assertCurrent(); throw unconfirmed(readError);}
      throw unconfirmed(confirmationError);
    }
  };
  const perform = async (label: string, work: (assertCurrent: () => void) => Promise<void>) => {
    if (!uid || !transactionId) return;
    let operation;
    try { operation = context.start(); } catch { return; }
    if (!operation) return;
    const assertCurrent = () => context.assertCurrent(operation);
    setBusy({ scope, label }); setNotice('');
    try { await ManualPaymentService.run(uid, transactionId, assertCurrent, () => work(assertCurrent)); }
    catch (error) {
      if (context.isCurrent(operation)) {
        setObserved(null); acceptance.current = null; setAcceptedKey(null);
        setNotice(error instanceof Error ? error.message : 'Le paiement reste à vérifier dans la commande.');
        showAdmissionError(error, { isCurrent: () => context.isCurrent(operation) });
      }
    } finally {
      if (context.isCurrent(operation)) { setBusy(null); void journalQuery.refetch(); }
      context.finish(operation);
    }
  };
  const prepare = () => perform('Préparation du paiement…', async assertCurrent => {
    if (!nativeEnabled || !cleanOrder || saved || totalCents === null || totalCents <= 0 || hasExistingPaymentExposure(order!)) return;
    const fresh = await freshOrder(assertCurrent);
    if (getPaymentBlockReason(fresh, uid!) !== null || exactPaymentCents(fresh.totalAmount) !== totalCents || hasExistingPaymentExposure(fresh)) throw new Error('La commande a changé. Vérifiez son état.');
    await ShippingPurchaseService.assertNewPreparationPolicy(uid!, fresh, assertCurrent); assertCurrent();
    if (chosenWallet > 0 && chosenWallet < totalCents && totalCents - chosenWallet < 50) throw new Error('La portion carte doit être d’au moins 0,50 $. Désactivez le solde pour payer par carte, ou choisissez le solde intégral si disponible.');
    const attempt: ManualPaymentAttempt = { version: 1, uid: uid!, transactionId, totalCents, walletCents: chosenWallet,
      mode: chosenWallet === totalCents ? 'wallet' : 'card', phase: chosenWallet === totalCents ? 'wallet_requested' : 'prepare_requested' };
    await ManualPaymentService.remember(attempt, assertCurrent); assertCurrent();
    if (attempt.mode === 'wallet') {
      const receipt = await WalletService.payWithWallet(transactionId, { expectedUid: uid!, assertCurrent }); assertCurrent();
      if (receipt.currentStatus === 'refunded' || receipt.currentStatus === 'disputed') { setNotice('Un ancien paiement a été retrouvé ; consultez l’état actuel de la commande.'); return; }
      await confirmSettlement(attempt, assertCurrent, false);
    } else {
      const response = await ManualPaymentService.observe(uid!, fresh, attempt, assertCurrent, false);
      await setObservation(response, attempt, assertCurrent);
      setNotice('Renseignez votre carte, puis confirmez le montant du paiement.');
    }
  });
  const resumeWallet = () => perform('Paiement avec votre solde…', async assertCurrent => {
    if (!nativeEnabled || !paymentSourcesReady || !saved || saved.mode !== 'wallet') return;
    const fresh = await freshOrder(assertCurrent);
    const attempt = await ManualPaymentService.readAttempt(uid!, transactionId, assertCurrent); assertCurrent();
    if (!exactWalletAttempt(attempt, fresh, uid!) || attempt!.totalCents !== saved.totalCents || attempt!.walletCents !== saved.walletCents) {
      throw new Error('Le montant du paiement a changé. Consultez la commande avant de poursuivre.');
    }
    if (hasConfirmedPurchasePayment(fresh, uid!, attempt!)) {await confirmSettlement(attempt!, assertCurrent, false); return;}
    if (getPaymentBlockReason(fresh, uid!) !== null || fresh.deliveryType !== 'shipping' || fresh.currency !== 'CAD' ||
        !fresh.shippingQuoteId || !fresh.shipEngineRateId || fresh.shippingAddress?.province !== 'QC' || fresh.shippingAddress.country !== 'CA' ||
        fresh.stripePaymentIntentId != null || fresh.stripeCheckoutProtocol != null || fresh.stripeChargeId != null) {
      throw new Error('Ce paiement ne peut pas être repris avec votre solde. Consultez la commande.');
    }
    await ShippingPurchaseService.assertNewPreparationPolicy(uid!, fresh, assertCurrent); assertCurrent();
    // This is an explicit replay of the same order's atomic wallet command.
    // It never observes through card checkout or creates another payment.
    await WalletService.payWithWallet(transactionId, {expectedUid: uid!, assertCurrent}); assertCurrent();
    await confirmSettlement(attempt!, assertCurrent, false);
  });
  const verify = () => perform('Vérification de la commande…', async assertCurrent => {
    const fresh = await freshOrder(assertCurrent);
    const attempt = await ManualPaymentService.readAttempt(uid!, transactionId, assertCurrent); assertCurrent();
    if (attempt?.mode === 'wallet') {
      if (hasConfirmedPurchasePayment(fresh, uid!, attempt) || getPaymentBlockReason(fresh, uid!) !== null) {
        await confirmSettlement(attempt, assertCurrent, false); return;
      }
      if (!exactWalletAttempt(attempt, fresh, uid!)) throw new Error('Le montant du paiement a changé. Consultez la commande avant de poursuivre.');
      setNotice('Le paiement avec votre solde n’est pas encore confirmé. Vous pouvez le reprendre ci-dessous.');
      return;
    }
    if (getPaymentBlockReason(fresh, uid!) !== null) { await confirmSettlement(attempt ?? undefined, assertCurrent, false); return; }
    let recoveryOnly = true;
    if (!hasExistingPaymentExposure(fresh)) {
      // The app may have persisted the preparation before its first RPC.
      // Reuse that exact authorized preparation only; later phases and native
      // payment witnesses can never enter this first-preparation branch.
      if (!nativeEnabled || !attempt || attempt.mode !== 'card' || attempt.phase !== 'prepare_requested' ||
          attempt.intentVersion !== undefined || attempt.legacyRetirement !== undefined || attempt.uid !== uid ||
          attempt.transactionId !== transactionId || exactPaymentCents(fresh.totalAmount) !== attempt.totalCents ||
          !Number.isSafeInteger(attempt.walletCents) || attempt.walletCents < 0 || attempt.totalCents - attempt.walletCents < 50 ||
          fresh.deliveryType !== 'shipping' || typeof fresh.shippingQuoteId !== 'string' || !fresh.shippingQuoteId ||
          typeof fresh.shipEngineRateId !== 'string' || !fresh.shipEngineRateId ||
          fresh.shippingAddress?.province !== 'QC' || fresh.shippingAddress.country !== 'CA') {
        throw new Error('Impossible de reprendre ce paiement pour le moment. Votre demande est conservée. Contactez notre équipe si le problème persiste.');
      }
      await ShippingPurchaseService.assertNewPreparationPolicy(uid!, fresh, assertCurrent); assertCurrent();
      recoveryOnly = false;
    }
    const response = await ManualPaymentService.observe(uid!, fresh, attempt?.mode === 'card' ? attempt : undefined, assertCurrent, recoveryOnly);
    await setObservation(response, attempt ?? undefined, assertCurrent);
    if (response.protocol === 'wallet_receipt' || response.settlementPending) await confirmSettlement(attempt ?? undefined, assertCurrent, false);
    else if (response.protocol === 'legacy') setNotice('Ce paiement utilise un ancien parcours. Consultez son état ; aucun nouveau moyen de paiement n’est lancé automatiquement.');
    else if (response.action === 'handleNextAction') setNotice('Une authentification est requise pour ce paiement existant.');
    else if (response.action === 'contactSupport' || response.action === 'reviewCancellation') setNotice('Ce paiement nécessite un examen. Consultez la commande ou contactez notre équipe.');
    else setNotice('L’état du paiement a été relu. Une confirmation explicite reste nécessaire avant tout nouvel envoi.');
  });
  useEffect(() => {
    if (!uid || !order || !context.focused || working || observation || orderQuery.isFetching || orderQuery.isError ||
        !journalQuery.isSuccess || journalQuery.isFetching || !canReadExistingCheckoutWithoutCreation(order)) return;
    const recoveryKey = JSON.stringify([scope, order.stripePaymentIntentId, order.walletCheckoutAttemptId, order.walletCheckoutOutcome]);
    if (recoveredPayment.current === recoveryKey) return;
    recoveredPayment.current = recoveryKey;
    // Observe an existing payment only. Authentication and payment confirmation
    // still require their own visible action; no new card payment is sent.
    void verify();
  }, [uid, order, scope, context.focused, working, observation, orderQuery.isFetching, orderQuery.isError, journalQuery.isSuccess, journalQuery.isFetching, verify]);
  const authenticate = async (first: ManualCheckout, acceptedAttempt: ManualPaymentAttempt, assertCurrent: () => void) => {
    if (first.action !== 'handleNextAction' || !first.actionClientSecret || !nativeEnabled) throw new Error('L’authentification ne peut pas être lancée depuis ce contexte.');
    const actionOrder = await freshOrder(assertCurrent);
    if (getPaymentBlockReason(actionOrder, uid!) !== null) { await confirmSettlement(acceptedAttempt, assertCurrent, false); return; }
    if (exactPaymentCents(actionOrder.totalAmount) !== acceptedAttempt.totalCents || !actionOrder.stripePaymentIntentId ||
        !first.actionClientSecret.startsWith(`${actionOrder.stripePaymentIntentId}_secret_`)) throw new Error('Le contexte de ce paiement a changé. Vérifiez la commande.');
    await ManualPaymentService.remember({ ...acceptedAttempt, intentVersion: first.intentVersion, phase: 'authentication_requested' }, assertCurrent); assertCurrent();
    const result = await stripe.handleNextAction(first.actionClientSecret, CHECKOUT_RETURN_URL); assertCurrent();
    await ManualPaymentService.remember({ ...acceptedAttempt, intentVersion: first.intentVersion, phase: 'authentication_returned' }, assertCurrent);
    const fresh = await freshOrder(assertCurrent);
    if (getPaymentBlockReason(fresh, uid!) !== null) { await confirmSettlement(acceptedAttempt, assertCurrent, false); return; }
    const response = await ManualPaymentService.observe(uid!, fresh, acceptedAttempt, assertCurrent, true);
    const next = await setObservation(response, acceptedAttempt, assertCurrent);
    if (result.error) {
      setNotice(result.error.code === 'Canceled' ? 'L’authentification a été fermée. Le paiement reste à vérifier.' : 'L’authentification n’a pas abouti. L’état de la commande a été relu.'); return;
    }
    if (response.protocol === 'server_manual_v1' && response.confirmationRequired && response.providerStatus === 'requires_confirmation' && next) {
      const final = await confirmCard(fresh, next, response, assertCurrent);
      if (!final) return;
      await setObservation(final, next, assertCurrent);
    }
    await confirmSettlement(next, assertCurrent, true);
  };
  const charge = () => perform('Confirmation du paiement…', async assertCurrent => {
    if (!nativeEnabled || !manualCanConfirm || !manual || !saved || !gateKey || acceptance.current?.key !== gateKey || acceptance.current.epoch !== inputEpoch.current) return;
    const fresh = await freshOrder(assertCurrent);
    if (getPaymentBlockReason(fresh, uid!) !== null || exactPaymentCents(fresh.totalAmount) !== saved.totalCents) throw new Error('La commande ne permet plus cette confirmation.');
    if (ShippingPurchaseService.requiresPreparationPolicy(fresh)) {
      // Read an engaged effect before the new-authorization window; never gate servicing by a later expiry.
      const existing = await ManualPaymentService.observe(uid!, fresh, saved, assertCurrent, true); assertCurrent();
      if (existing.protocol !== 'server_manual_v1' || !existing.confirmationRequired || existing.action !== 'confirmOnServer' || existing.intentVersion !== manual.intentVersion ||
        existing.providerStatus !== manual.providerStatus || existing.preparationState !== manual.preparationState) {
        const next = await setObservation(existing, saved, assertCurrent); assertCurrent();
        if (existing.protocol === 'wallet_receipt' || existing.settlementPending) await confirmSettlement(next, assertCurrent, false);
        else setNotice('L’état du paiement existant a changé. Relisez son résultat ou poursuivez son authentification avant tout nouvel envoi.');
        return;
      }
      await ShippingPurchaseService.assertNewPreparationPolicy(uid!, fresh, assertCurrent); assertCurrent();
    }
    let paymentMethodId: string | undefined;
    if (manual.providerStatus === 'requires_payment_method') {
      if (!cardComplete) throw new Error('Complétez les renseignements de la carte.');
      const epoch = inputEpoch.current;
      const result = await stripe.createPaymentMethod({ paymentMethodType: 'Card' }); assertCurrent();
      if (epoch !== inputEpoch.current) throw new Error('La saisie de carte a changé. Confirmez à nouveau votre choix.');
      if (result.error || !result.paymentMethod || !/^pm_[A-Za-z0-9]+$/.test(result.paymentMethod.id)) throw new Error(result.error?.message ?? 'Le moyen de paiement n’a pas pu être préparé.');
      paymentMethodId = result.paymentMethod.id;
    }
    const response = await confirmCard(fresh, saved, manual, assertCurrent, paymentMethodId);
    if (!response) return;
    const next = await setObservation(response, saved, assertCurrent);
    if (response.protocol === 'server_manual_v1' && response.action === 'handleNextAction' && next) await authenticate(response, next, assertCurrent);
    else await confirmSettlement(next, assertCurrent, true);
  });
  const continueAuthentication = () => perform('Authentification du paiement…', async assertCurrent => {
    if (!manual || !saved || !nativeEnabled) return;
    const fresh = await freshOrder(assertCurrent);
    const response = await ManualPaymentService.observe(uid!, fresh, saved, assertCurrent, true);
    const next = await setObservation(response, saved, assertCurrent);
    if (response.protocol === 'server_manual_v1' && response.action === 'handleNextAction' && next) await authenticate(response, next, assertCurrent);
  });
  const cancelOrder = () => {
    if (!payable || working) return;
    Alert.alert('Demander l’annulation', 'L’annulation et toute restitution du solde doivent être confirmées par le dossier de commande.', [
      { text: 'Retour', style: 'cancel' }, { text: 'Demander l’annulation', style: 'destructive', onPress: () => {
        void perform('Vérification de l’annulation…', async assertCurrent => {
          const fresh = await freshOrder(assertCurrent);
          if (getPaymentBlockReason(fresh, uid!) !== null) throw new Error('La commande a changé. Consultez son dossier.');
          const response = await TransactionService.cancelPendingOrder(transactionId, uid!, assertCurrent); assertCurrent();
          const current = await freshOrder(assertCurrent);
          if (response.cancellationCommitted !== true || current.status !== 'cancelled' || current.pendingCancellation?.state !== 'committed' ||
              current.pendingCancellation.transactionId !== current.id || current.pendingCancellation.buyerId !== uid ||
              current.pendingCancellation.sellerId !== current.sellerId || current.pendingCancellation.walletRefundCents !== response.refundedCents ||
              current.pendingCancellation.cardCapabilityNeutralized !== true) throw new Error('L’annulation reste à vérifier dans le dossier.');
          setNotice('L’annulation est enregistrée. Consultez cette commande avant de commencer un nouvel achat.');
        });
      } },
    ]);
  };
  const retireLegacy = () => {
    if (!legacy || !order || saved?.legacyRetirement || working) return;
    Alert.alert('Fermer l’ancien paiement carte', 'Cette action demande la neutralisation de l’ancien paiement carte. Toute obligation liée au solde restera dans le dossier.', [
      { text: 'Retour', style: 'cancel' }, { text: 'Demander la fermeture', style: 'destructive', onPress: () => {
        void perform('Fermeture de l’ancien paiement…', async assertCurrent => {
          const fresh = await freshOrder(assertCurrent);
          const result = await ManualPaymentService.retire(uid!, fresh, legacy, assertCurrent);
          setObserved(null); await freshOrder(assertCurrent);
          setNotice(result.walletObligationOpen ? 'La carte est neutralisée. Le solde reste à rapprocher avec notre équipe.' : 'L’ancien paiement carte est neutralisé. Consultez la commande avant un nouvel achat.');
        });
      } },
    ]);
  };
  const viewOrder = () => {
    try { context.capture(); } catch { return; }
    if (order?.buyerId === uid) router.push({ pathname: '/orders/[id]', params: { id: transactionId } });
  };
  const help = () => router.push('/settings/help');
  const openOption = (action: () => void) => {
    if (working) return;
    try {context.capture();} catch {return;}
    setOptionsScope(null); action();
  };
  const refreshPayment = () => {
    if (saved || order && hasExistingPaymentExposure(order)) {void verify(); return;}
    void orderQuery.refetch(); void journalQuery.refetch(); void preparationQuery.refetch();
  };
  if (!uid || !transactionId) return <View style={styles.container}><ScreenHeader title="Paiement" onBack={() => router.back()} />
    <View style={styles.content}><Text style={styles.body}>Connectez-vous avec le compte de l’acheteur pour consulter ce paiement.</Text><Button onPress={help}>Contacter l’équipe</Button></View></View>;
  return <View style={styles.container}>
    <ScreenHeader title="Paiement" onBack={() => router.back()} rightContent={<Pressable
      accessibilityRole="button" accessibilityLabel="Options du paiement" style={styles.optionsButton} disabled={working}
      onPress={() => {try {context.capture(); setOptionsScope(scope);} catch {/* Inactive visit. */}}}>
      <Ionicons name="ellipsis-horizontal" size={sizing.iconMD} color={colors.foreground}/>
    </Pressable>}/>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {orderQuery.isPending || journalQuery.isPending ? <Text style={styles.body}>Chargement de votre paiement…</Text> : null}
      {orderQuery.isError || journalQuery.isError ? <><Text style={styles.notice}>Impossible de retrouver votre paiement. Réessayez avant de poursuivre.</Text>
        <Button onPress={() => {try {context.capture(); void orderQuery.refetch(); void journalQuery.refetch();} catch {/* Inactive visit. */}}}>Réessayer</Button></> : null}
      {order && <>
        <OrderArticleSummary terms={getTransactionArticlePresentation(order)} compact />
        <View style={styles.total}><Text style={styles.caption}>{payable ? 'Total à payer' : 'Total de la commande'}</Text>
          <Text style={styles.amount}>{totalCents !== null ? formatPriceWithCurrency(totalCents / 100) : 'À vérifier'}</Text></View>
        {DEV_COMMERCE_TESTING_ENABLED ? <Text style={styles.caption}>Paiement de test · Aucun débit réel</Text> : null}
        <RefundStatusNotice transaction={order} perspective="buyer" />
        {payable && preparation?.qualification === 'accepted_v2_source' && preparation.pendingPayment ? <Text style={styles.caption}>
          {preparation.pendingPayment.state === 'elapsed' ? 'Le délai de paiement est dépassé. Actualisez pour connaître la suite.' :
            `À régler avant le ${new Date(preparation.pendingPayment.expiresAtMs).toLocaleString(APP_LOCALE, {day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'America/Toronto'})}.`}
        </Text> : null}
        {!payable ? <><Text style={styles.body}>Consultez votre commande pour connaître la suite.</Text><Button onPress={viewOrder}>Suivre ma commande</Button></> : <>
          {!nativeEnabled && <Text style={styles.body}>{!canUseNativeCard ? 'Le paiement par carte est disponible dans l’application mobile.' : 'Le paiement est actuellement indisponible.'}</Text>}
          {!normalPurchaseAccess && <Text style={styles.body}>Complétez votre profil pour poursuivre le paiement.</Text>}
          {walletResumeAvailable ? <Button loading={working} disabled={working} onPress={() => {void resumeWallet();}}>Reprendre le paiement avec mon solde</Button> : null}
          {nativeEnabled && cleanOrder && !saved && !hasExistingPaymentExposure(order) && journalQuery.isSuccess && !orderQuery.isError && <>
            {walletBalance > 0 && <Checkbox checked={walletSelected} disabled={working} onToggle={() => changeInput(() => setWalletSelected(value => !value))}>
              <Text style={styles.body}>Utiliser mon solde ({formatPriceWithCurrency(walletBalance / 100)} disponible)</Text>
            </Checkbox>}
            {chosenWallet > 0 ? <Text style={styles.body}>{formatPriceWithCurrency(chosenWallet / 100)} avec mon solde{chosenWallet !== totalCents ? ` · ${formatPriceWithCurrency(((totalCents ?? 0) - chosenWallet) / 100)} par carte` : ''}</Text> : null}
            <Button loading={working} disabled={working || totalCents === null} onPress={() => {void prepare();}}>{chosenWallet === totalCents ? 'Payer avec mon solde' : 'Continuer par carte'}</Button>
          </>}
          {manual && nativeEnabled && !journalQuery.isError && <>
            {manual.walletCents > 0 ? <Text style={styles.body}>{formatPriceWithCurrency(manual.walletCents / 100)} avec mon solde · {formatPriceWithCurrency(manual.cardCents / 100)} par carte</Text> : null}
            {manualCanConfirm && manual.providerStatus === 'requires_payment_method' && <CardField key={`${scope}/${manual.intentVersion}/${cardFormVersion}`} style={styles.cardField} cardStyle={cardStyle}
              countryCode="CA" postalCodeEnabled disabled={working} dangerouslyGetFullCardDetails={false}
              onCardChange={details => changeInput(() => setCardComplete(details.complete))} />}
            {manualCanConfirm && <><Checkbox checked={accepted} disabled={working} onToggle={() => {
                let operation;
                try {operation = context.start();} catch {return;}
                if (!operation || !gateKey) return;
                acceptance.current = accepted ? null : {key: gateKey, epoch: inputEpoch.current}; setAcceptedKey(accepted ? null : gateKey); context.finish(operation);
              }}><Text style={styles.body}>Je confirme le paiement de ce total : {manual.walletCents > 0
                ? `${formatPriceWithCurrency(manual.walletCents / 100)} par solde et ${formatPriceWithCurrency(manual.cardCents / 100)} par carte.`
                : `${formatPriceWithCurrency(manual.cardCents / 100)} par carte.`}</Text></Checkbox>
              <Button loading={working} disabled={working || !accepted || manual.providerStatus === 'requires_payment_method' && !cardComplete} onPress={() => {void charge();}}>Confirmer le paiement</Button></>}
            {manual.action === 'handleNextAction' && <Button disabled={working} loading={working} onPress={() => {void continueAuthentication();}}>Poursuivre l’authentification</Button>}
          </>}
          {!walletResumeAvailable && !manualCanConfirm && manual?.action !== 'handleNextAction' && (saved || hasExistingPaymentExposure(order)) ?
            <Button disabled={working} loading={working} onPress={() => {void verify();}}>Actualiser le paiement</Button> : null}
        </>}
      </>}
      {notice ? <Text accessibilityRole="alert" style={styles.notice}>{notice}</Text> : null}
      {working ? <View accessibilityLiveRegion="polite" style={styles.progress}><ActivityIndicator size="small" color={colors.primary}/><Text style={styles.caption}>{busy?.label}</Text></View> : null}
    </ScrollView>
    <Modal visible={optionsScope === scope && context.focused} presentationStyle="pageSheet" animationType="slide" onRequestClose={() => setOptionsScope(null)}>
      <SafeAreaProvider><View style={styles.container}><ScreenHeader title="Options du paiement" onBack={() => setOptionsScope(null)}/>
        <ScrollView contentContainerStyle={styles.content}>
          <Pressable accessibilityRole="button" style={styles.optionRow} disabled={working} onPress={() => openOption(refreshPayment)}>
            <Ionicons name="refresh-outline" size={sizing.iconSM} color={colors.foreground}/><Text style={styles.optionLabel}>Actualiser le paiement</Text><Ionicons name="chevron-forward" size={sizing.iconSM} color={colors.muted}/>
          </Pressable>
          {order ? <Pressable accessibilityRole="button" style={styles.optionRow} disabled={working} onPress={() => openOption(viewOrder)}>
            <Ionicons name="receipt-outline" size={sizing.iconSM} color={colors.foreground}/><Text style={styles.optionLabel}>Voir ma commande</Text><Ionicons name="chevron-forward" size={sizing.iconSM} color={colors.muted}/>
          </Pressable> : null}
          {payable ? <Pressable accessibilityRole="button" style={styles.optionRow} disabled={working} onPress={() => openOption(cancelOrder)}>
            <Ionicons name="close-outline" size={sizing.iconSM} color={colors.foreground}/><Text style={styles.optionLabel}>Annuler la commande</Text><Ionicons name="chevron-forward" size={sizing.iconSM} color={colors.muted}/>
          </Pressable> : null}
          {legacy?.action === 'retireLegacyCheckout' && !legacy.settlementPending && !saved?.legacyRetirement ? <Pressable accessibilityRole="button" style={styles.optionRow} disabled={working} onPress={() => openOption(retireLegacy)}>
            <Ionicons name="card-outline" size={sizing.iconSM} color={colors.foreground}/><Text style={styles.optionLabel}>Fermer l’ancien paiement</Text><Ionicons name="chevron-forward" size={sizing.iconSM} color={colors.muted}/>
          </Pressable> : null}
          <Pressable accessibilityRole="button" style={styles.optionRow} disabled={working} onPress={() => openOption(help)}>
            <Ionicons name="chatbubble-outline" size={sizing.iconSM} color={colors.foreground}/><Text style={styles.optionLabel}>Contacter Seconde</Text><Ionicons name="chevron-forward" size={sizing.iconSM} color={colors.muted}/>
          </Pressable>
          {DEV_COMMERCE_TESTING_ENABLED ? <View style={styles.testHelp}><Text style={styles.caption}>Carte de test</Text><Text selectable style={styles.body}>4000 0037 2000 0278 · date future · CVC 123</Text><Text style={styles.caption}>Aucun débit réel.</Text></View> : null}
        </ScrollView>
      </View></SafeAreaProvider>
    </Modal>
  </View>;
}
const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: colors.background}, content: {padding: spacing.lg, gap: spacing.lg},
  body: {...typography.bodySmall, color: colors.foregroundSecondary}, amount: {...typography.h1, color: colors.foreground},
  caption: {...typography.caption, color: colors.muted}, notice: {...typography.bodySmall, color: colors.danger},
  total: {gap: spacing.xs}, progress: {flexDirection: 'row', alignItems: 'center', gap: spacing.sm},
  optionsButton: {minWidth: sizing.minTouchTarget, minHeight: sizing.minTouchTarget, alignItems: 'center', justifyContent: 'center'},
  optionRow: {minHeight: sizing.minTouchTarget, paddingVertical: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border},
  optionLabel: {...typography.body, color: colors.foreground, flex: 1},
  testHelp: {marginTop: spacing.md, gap: spacing.sm},
  cardField: {height: spacing['4xl'], width: '100%'},
});
