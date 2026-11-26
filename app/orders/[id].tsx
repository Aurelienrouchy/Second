import {useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import {Modal, Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {Ionicons} from '@expo/vector-icons';
import {BottomSheetModalProvider} from '@gorhom/bottom-sheet';
import {useFocusEffect, useLocalSearchParams, useRouter} from 'expo-router';
import {CancelledError, useQuery} from '@tanstack/react-query';
import {Button, ScreenHeader, Skeleton} from '@/components/ui';
import {BankDisputeOwnerPanel} from '@/components/BankDisputeOwnerPanel';
import {ConvenienceReturnPanel} from '@/components/ConvenienceReturnPanel';
import {ReturnDepositDeadlinePanel} from '@/components/ReturnDepositDeadlinePanel';
import {DevShippingControls} from '@/components/DevShippingControls';
import {parseBankDisputeCaseNotice} from '@/services/bankDisputeCaseNoticeService';
import type {BankDisputeCaseNotice} from '@/types/bankDisputeCase';
import type {Transaction} from '@/types';
import {OrderArticleSummary, ShipmentTracking, BuyerReceiptDeclaration, OrderPolicyDates, OrderOptionsList, type OrderOption} from '@/features/orders';
import {useOrderLabelDocument} from '@/features/orders/hooks/useOrderLabelDocument';
import {orderDetailPresentation, orderMilestones} from '@/features/orders/lib/orderDetailPresentation';
import {useAuthGuardSession, useAuthenticatedUid} from '@/hooks/useAuth';
import {useShippingPurchaseContext} from '@/hooks/useShippingPurchaseContext';
import {ArticleModerationService} from '@/services/articleModerationService';
import {getAuthSessionGeneration} from '@/store/authStore';
import {ArticlesService} from '@/services/articlesService';
import {TransactionService, getDeliveryCorrectionReview} from '@/services/transactionService';
import {ManualPaymentService, canReadExistingCheckoutWithoutCreation, exactPaymentCents} from '@/services/manualPaymentService';
import {assertTradeSessionCurrent, captureTradeSession} from '@/services/tradeOperation';
import {getTransactionArticlePresentation} from '@/utils/transactionArticlePresentation';
import {getPaymentBlockReason, getRefundPresentation, hasBankObligation} from '@/utils/refundPresentation';
import {formatPrice} from '@/utils/formatPrice';
import {APP_LOCALE} from '@/constants/locale';
import {colors, fonts, radius, sizing, spacing, typography} from '@/constants/theme';
import {DEV_COMMERCE_TESTING_ENABLED, PAYMENTS_ENABLED, SHIPPING_ENABLED} from '@/config/featureFlags';
import {TransportReviewService} from '@/services/transportReviewService';
import {hasRecordedOrderLabel} from '@/utils/conversationTimeline';

async function readCurrentOrderData<T>(signal: AbortSignal, qualify: () => () => void, read: (assertCurrent: () => void) => Promise<T>): Promise<T> {
  let assertCurrent: (() => void) | null = null;
  try {
    if (signal.aborted) throw new CancelledError({silent: true});
    assertCurrent = qualify(); assertCurrent();
    const result = await read(assertCurrent);
    if (signal.aborted) throw new CancelledError({silent: true});
    assertCurrent(); return result;
  } catch (error) {
    if (signal.aborted) throw new CancelledError({silent: true});
    try {(assertCurrent ?? qualify())();} catch {throw new CancelledError({silent: true});}
    throw error;
  }
}

const amountLabel = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0
  ? formatPrice(value) : 'Montant indisponible';

/** Existing order access remains independent from listing availability and new-sale admission. */
export default function OrderDetailScreen() {
  const { id, bankCaseNotice } = useLocalSearchParams<{ id: string; bankCaseNotice?: string | string[] }>();
  const router = useRouter();
  const { normalUser } = useAuthGuardSession();
  const uid = useAuthenticatedUid();
  let bankNoticeReference: BankDisputeCaseNotice | undefined, invalidBankNotice = false;
  if (bankCaseNotice !== undefined) {
    try {
      const parsed = uid && typeof bankCaseNotice === 'string' && bankCaseNotice.length <= 12000
        ? parseBankDisputeCaseNotice(JSON.parse(bankCaseNotice), uid) : null;
      if (!parsed || parsed.transactionId !== id) invalidBankNotice = true;
      else bankNoticeReference = parsed;
    } catch { invalidBankNotice = true; }
  }
  const canStartPurchase = !!normalUser && normalUser.id === uid;
  const generation = getAuthSessionGeneration();
  const scope = useMemo(() => ({ uid: uid, generation, id }), [uid, generation, id]);
  const currentScope = useRef<typeof scope | null>(scope);
  const active = useRef(false);
  useLayoutEffect(() => {
    currentScope.current = scope;
    return () => { currentScope.current = null; };
  }, [scope]);
  const assertScope = useCallback(() => {
    if (!scope.uid || currentScope.current !== scope || generation !== getAuthSessionGeneration()) throw new Error('La session a changé.');
    const session = captureTradeSession(scope.uid);
    assertTradeSessionCurrent(session);
    return session;
  }, [scope, generation]);
  const validId = typeof id === 'string' && id.length > 0 && !id.includes('/');
  const moderationContext = useShippingPurchaseContext(JSON.stringify(['order-moderation', id]), scope.uid ?? null);
  const orderQuery = useQuery({
    queryKey: ['order-detail', scope.uid, generation, id, moderationContext.focusRevision],
    enabled: !!scope.uid && validId && moderationContext.focused,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    queryFn: ({signal}) => readCurrentOrderData(signal, () => {
      const operation = moderationContext.capture();
      return () => {assertScope(); moderationContext.assertCurrent(operation);};
    }, async assertCurrent => {
      const session = assertScope();
      const order = await TransactionService.getTransaction(id, { expectedUid: session.uid,
        assertCurrent });
      assertTradeSessionCurrent(session); assertScope();
      if (!order || order.id !== id || (order.buyerId !== session.uid && order.sellerId !== session.uid)) {
        throw new Error('Commande inaccessible.');
      }
      return order;
    }),
  });
  const order = orderQuery.data?.id === id && scope.uid &&
    (orderQuery.data.buyerId === scope.uid || orderQuery.data.sellerId === scope.uid) ? orderQuery.data : null;
  const correctionSourceKey = JSON.stringify(['order-correction-source', order]);
  const correctionContext = useShippingPurchaseContext(correctionSourceKey, scope.uid ?? null);
  const correctionQuery = useQuery({queryKey: ['order-delivery-correction', scope.uid, generation, id, correctionContext.focusRevision, correctionSourceKey],
    enabled: !!order && !!scope.uid && correctionContext.focused && !orderQuery.isFetching && !orderQuery.isError && !!getDeliveryCorrectionReview(order), staleTime: 0, gcTime: 0, retry: false, structuralSharing: false,
    queryFn: ({signal}) => readCurrentOrderData(signal, () => {const operation = correctionContext.capture();
      return () => {assertScope(); correctionContext.assertCurrent(operation);};}, current => TransportReviewService.source(scope.uid!, id, 'owner', null, current))});
  const correctionObservation = correctionContext.focused && !orderQuery.isFetching && !orderQuery.isError && correctionQuery.isSuccess && !correctionQuery.isFetching && !correctionQuery.isError ? correctionQuery.data : null;
  const deliveryCorrection = order ? getDeliveryCorrectionReview(order, correctionObservation) : null;
  const moderationQuery = useQuery({ queryKey: ['order-moderation', scope.uid, generation, id, moderationContext.focusRevision],
    queryFn: ({signal}) => readCurrentOrderData(signal, () => {
      const operation = moderationContext.capture();
      return () => {assertScope(); moderationContext.assertCurrent(operation);};
    }, current => ArticleModerationService.readOrderModeration(scope.uid!, id, current)), enabled: !!order && moderationContext.focused, staleTime: 0, gcTime: 0, retry: false });
  const paymentAttemptQuery = useQuery({
    queryKey: ['order-existing-payment', scope.uid, generation, id, moderationContext.focusRevision],
    enabled: !!order && order.buyerId === scope.uid && order.status === 'pending_payment' && moderationContext.focused,
    staleTime: 0, gcTime: 0, retry: false,
    queryFn: ({signal}) => readCurrentOrderData(signal, () => {
      const operation = moderationContext.capture();
      return () => {assertScope(); moderationContext.assertCurrent(operation);};
    }, current => ManualPaymentService.readAttempt(scope.uid!, id, current)),
  });
  const localPaymentAttempt = paymentAttemptQuery.data;
  const existingPaymentReadable = !!order && order.buyerId === scope.uid && order.status === 'pending_payment' &&
    (canReadExistingCheckoutWithoutCreation(order) || !!localPaymentAttempt && localPaymentAttempt.uid === scope.uid &&
      localPaymentAttempt.transactionId === order.id && localPaymentAttempt.totalCents === exactPaymentCents(order.totalAmount));
  const articleQuery = useQuery({
    queryKey: ['order-detail', scope.uid, generation, id, 'legacy-listing', order?.articleId],
    enabled: !!order && !order.articleSnapshot && moderationContext.focused,
    staleTime: 10 * 60 * 1000,
    queryFn: ({signal}) => readCurrentOrderData(signal, () => {
      const operation = moderationContext.capture();
      return () => {assertScope(); moderationContext.assertCurrent(operation);};
    }, async () => {
      const session = assertScope();
      const article = await ArticlesService.getArticleById(order!.articleId);
      assertTradeSessionCurrent(session); assertScope();
      return article;
    }),
  });
  useFocusEffect(useCallback(() => {
    active.current = true;
    return () => { active.current = false; };
  }, [scope, validId]));
  useEffect(() => {
    if (!scope.uid || !validId || !moderationContext.focused) return;
    let session: ReturnType<typeof captureTradeSession>;
    let operation: ReturnType<typeof moderationContext.capture>;
    try { session = assertScope(); operation = moderationContext.capture(); } catch { return; }
    let mounted = true;
    const refresh = () => {
      try { assertTradeSessionCurrent(session); assertScope(); moderationContext.assertCurrent(operation); } catch { return; }
      if (mounted && active.current) {
        void orderQuery.refetch();
        if (order) void moderationQuery.refetch();
      }
    };
    const stop = TransactionService.subscribeToTransaction(id, refresh, refresh);
    return () => { mounted = false; stop(); };
  }, [scope, validId, assertScope, orderQuery.refetch, moderationQuery.refetch, id, !!order, moderationContext.frame, moderationContext.focusRevision, moderationContext.focused]);
  const navigate = (destination: 'chat' | 'payment' | 'help') => {
    if (!active.current || !order) return;
    try { assertScope(); } catch { return; }
    if (destination === 'chat' && order.chatId) {
      router.push({ pathname: '/chat/[id]', params: { id: order.chatId, transactionId: order.id } });
    } else if (destination === 'payment' && order.buyerId === scope.uid && order.status === 'pending_payment' &&
        (existingPaymentReadable || !deliveryCorrection && canStartPurchase && PAYMENTS_ENABLED && SHIPPING_ENABLED && getPaymentBlockReason(order, scope.uid!) === null)) {
      router.push({ pathname: '/payment/[transactionId]', params: { transactionId: order.id } });
    } else if (destination === 'help') router.push({ pathname: '/settings/support', params: { transactionId: order.id, kind: 'commercial_late' } } as never);
  };

  const [toolSelection, setToolSelection] = useState<{key: string; tool: OrderTool} | null>(null);
  const scopeKey = JSON.stringify([scope.uid, generation, id]);
  const tool = toolSelection?.key === scopeKey ? toolSelection.tool : null;
  const bankNoticeOpened = useRef<string | null>(null);
  useEffect(() => {
    const noticeKey = JSON.stringify([scopeKey, bankCaseNotice]);
    if (!order || bankCaseNotice === undefined || bankNoticeOpened.current === noticeKey) return;
    bankNoticeOpened.current = noticeKey;
    setToolSelection({key: scopeKey, tool: 'bank'});
  }, [order, bankCaseNotice, scopeKey]);
  const openTool = (next: OrderTool) => {
    if (!active.current || !uid) return;
    try {assertScope(); moderationContext.capture();} catch {return;}
    setToolSelection({key: scopeKey, tool: next});
  };
  const closeTool = () => setToolSelection(null);
  const label = useOrderLabelDocument(order ?? {id: String(id), buyerId: '', sellerId: ''} as Transaction, null,
    () => {assertScope(); moderationContext.capture();});
  const currentOrderReady = !!order && moderationContext.focused && !orderQuery.isFetching && !orderQuery.isError &&
    moderationQuery.isSuccess && !moderationQuery.isFetching && !moderationQuery.isError;
  const linkedSupport = () => navigate('help');

  if (!uid || !validId || !order) {
    const loading = !!uid && validId && !orderQuery.isError && orderQuery.isPending;
    return <View style={styles.container}>
      <ScreenHeader title="Commande" onBack={() => router.back()} />
      {loading ? <View style={styles.content}>
        <Skeleton width="100%" height={spacing['4xl']} borderRadius={radius.lg} />
        <Skeleton width="100%" height={spacing['4xl']} borderRadius={radius.lg} />
      </View> : <View style={styles.empty}>
        <Text style={styles.title}>{!uid ? 'Connectez-vous pour continuer' : 'Cette commande est indisponible'}</Text>
        {!!uid && validId && orderQuery.isError ? <Button onPress={() => {void orderQuery.refetch();}}>Réessayer</Button> : null}
        <Button variant="secondary" onPress={() => router.push(uid && validId
          ? {pathname: '/settings/support', params: {transactionId: String(id), kind: 'commercial_late'}} as never
          : '/settings/help')}>Besoin d’aide ?</Button>
        {!!uid && validId && bankNoticeReference ? <Button variant="ghost" onPress={() => openTool('bank')}>Consulter mon avis de paiement</Button> : null}
      </View>}
      {!!uid && validId && tool === 'bank' && bankNoticeReference ? <Modal visible presentationStyle="pageSheet" animationType="slide" onRequestClose={closeTool}>
        <SafeAreaProvider style={styles.container}><View style={styles.container}><ScreenHeader title="Votre paiement" onBack={closeTool} />
          <ScrollView contentContainerStyle={styles.toolContent}>
            <BankDisputeOwnerPanel uid={uid} transactionId={String(id)} noticeReference={bankNoticeReference} compact
              sourceKey={JSON.stringify([scopeKey, bankCaseNotice, 'unavailable'])} assertSelection={assertScope} />
          </ScrollView>
        </View></SafeAreaProvider>
      </Modal> : null}
    </View>;
  }

  const seller = order.sellerId === uid;
  const perspective = seller ? 'seller' : 'buyer';
  const terms = getTransactionArticlePresentation(order, articleQuery.data);
  const paymentAllowed = !deliveryCorrection && canStartPurchase && PAYMENTS_ENABLED && SHIPPING_ENABLED && !seller && getPaymentBlockReason(order, uid) === null;
  const moderated = moderationQuery.data?.moderation?.action === 'pause' || moderationQuery.data?.moderation?.progressAllowed === false;
  const moderationUnknown = !moderationQuery.isSuccess || moderationQuery.isError || orderQuery.isError;
  const readFailed = moderationQuery.isError || orderQuery.isError;
  const presentation = moderationUnknown ? {title: readFailed ? 'Votre commande doit être actualisée' : 'Votre commande',
    description: readFailed ? 'Impossible de vérifier son état pour le moment.' : 'Actualisation en cours…', attention: readFailed}
    : moderated ? {title: 'Votre commande est en cours d’examen', description: 'Notre équipe vous tiendra informé.', attention: true}
    : orderDetailPresentation(order, uid, !!deliveryCorrection);
  const dev = order.carrierCode === 'seconde_dev';
  const milestones = orderMilestones(order);
  const hasReturn = order.returnRequest != null || order.returnLabelId != null || order.status === 'return_requested';
  const needsBank = bankCaseNotice !== undefined || hasBankObligation(order);
  const hasDecisionContext = !!order.fundsReleasedAt || ['completed', 'cancelled', 'refunded', 'refund_in_progress', 'refund_action_required'].includes(order.status);
  const attentionTool: OrderTool = needsBank ? 'bank' : hasReturn ? 'return' : 'help';
  const canOpenLabel = seller && !moderationUnknown && order.deliveryType === 'shipping' && order.status === 'label_created' && hasRecordedOrderLabel(order) && !presentation.attention;
  const canTrack = order.deliveryType === 'shipping' && order.status === 'shipped';
  const openTracking = () => {
    try {assertScope(); moderationContext.capture();} catch {return;}
    router.push({pathname: '/orders/tracking/[id]', params: {id: order.id}} as never);
  };
  const canConfirmReceipt = !seller && order.deliveryType === 'shipping' && order.status === 'delivered' && !presentation.attention;
  const primaryLabel = presentation.attention ? 'Voir les détails' : order.status === 'pending_payment' && !seller && (existingPaymentReadable || paymentAllowed)
    ? existingPaymentReadable ? 'Reprendre le paiement' : 'Payer ma commande'
      : canOpenLabel ? 'Voir mon étiquette' : canTrack ? 'Suivre mon colis' : canConfirmReceipt ? 'J’ai reçu mon colis'
        : order.status === 'completed' && seller ? 'Ouvrir mon porte-monnaie' : null;
  const primary = () => {
    if (!currentOrderReady && !presentation.attention) return;
    try {assertScope(); moderationContext.capture();} catch {return;}
    if (presentation.attention) openTool(attentionTool);
    else if (order.status === 'pending_payment') navigate('payment');
    else if (canOpenLabel) void label.open('forward', order.shipEngineLabelId ?? null);
    else if (canTrack) openTracking();
    else if (canConfirmReceipt) openTool('receipt');
    else if (order.status === 'completed' && seller) router.push('/wallet');
  };
  const toolTitle: Record<OrderTool, string> = {menu: 'Aide et options', amounts: 'Détail du montant', return: 'Votre retour', report: 'Signaler un problème',
    receipt: 'Réception du colis', bank: 'Votre paiement', help: 'Besoin d’aide ?', test: 'Tester la livraison', convenience: 'Retour convenu', deadline: 'Délai du retour', dates: 'Délais de la commande'};
  const menuItems: OrderOption[] = [
    {label: 'Actualiser la commande', icon: 'refresh-outline', loading: orderQuery.isFetching, onPress: () => {void orderQuery.refetch();}},
    ...(!seller && order.deliveryType === 'shipping' ? [{label: 'Signaler un problème', icon: 'flag-outline' as const, onPress: () => openTool('report')}] : []),
    ...(order.deliveryType === 'shipping' ? [{label: 'Retours', icon: 'return-down-back-outline' as const, onPress: () => openTool('return')}] : []),
    ...(!seller && order.deliveryType === 'shipping' ? [{label: 'Réception du colis', icon: 'checkmark-circle-outline' as const, onPress: () => openTool('receipt')}] : []),
    ...(order.deliveryType === 'shipping' ? [{label: 'Délais', icon: 'time-outline' as const, onPress: () => openTool('dates')}] : []),
    ...(hasReturn && !!order.returnLabelId ? [{label: 'Délai de dépôt du retour', icon: 'calendar-outline' as const, onPress: () => openTool('deadline')}] : []),
    ...(needsBank ? [{label: 'Question sur le paiement', icon: 'card-outline' as const, onPress: () => openTool('bank')}] : []),
    ...(seller && order.shipEngineLabelId && (presentation.attention || !['paid', 'label_created'].includes(order.status))
      ? [{label: 'Consulter l’étiquette', icon: 'document-outline' as const, loading: label.loading, onPress: () => {void label.open('forward', order.shipEngineLabelId ?? null);}}] : []),
    ...(presentation.attention ? [{label: 'Article reçu ou accord de remboursement', icon: 'chatbox-outline' as const, onPress: () => {
      try {assertScope(); moderationContext.capture(); router.push({pathname: '/product-review', params: {contextKind: 'order', contextId: order.id}} as never); closeTool();} catch {/* Changed owner. */}
    }}] : []),
    ...(hasDecisionContext ? [{label: 'Décisions et recours', icon: 'help-circle-outline' as const, onPress: () => {
      try {assertScope(); moderationContext.capture(); router.push({pathname: '/orders/decisions/[id]', params: {id: order.id}} as never); closeTool();} catch {/* Changed owner. */}
    }}] : []),
    {label: 'Contacter Seconde', icon: 'chatbubbles-outline', onPress: linkedSupport},
    ...(dev && DEV_COMMERCE_TESTING_ENABLED ? [{label: 'Outils de test', icon: 'flask-outline' as const, onPress: () => openTool('test')}] : []),
  ];
  return <View style={styles.container}>
    <ScreenHeader title="Commande" onBack={() => router.back()} showBorder={false} rightContent={
      <Pressable accessibilityRole="button" accessibilityLabel="Aide et options de la commande" style={styles.headerAction} onPress={() => openTool('menu')}>
        <Ionicons name="ellipsis-horizontal" size={spacing.lg} color={colors.foreground} />
      </Pressable>} />
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.hero}>
        {dev ? <Text style={styles.eyebrow}>Test</Text> : null}
        <Text accessibilityRole="header" style={styles.heroTitle}>{presentation.title}</Text>
        {presentation.description ? <Text style={styles.heroDescription}>{dev && canOpenLabel ? 'Consultez votre étiquette de test.' : presentation.description}</Text> : null}
        {primaryLabel ? <Button fullWidth loading={label.loading} disabled={!currentOrderReady && !presentation.attention || label.loading} onPress={primary}>{primaryLabel}</Button> : null}
        {!label.loading && label.message ? <Text accessibilityRole="alert" style={styles.caption}>{label.message}</Text> : null}
        {orderQuery.isError ? <Text accessibilityRole="alert" style={styles.caption}>Impossible d’actualiser la commande. Réessayez depuis les options.</Text> : null}
      </View>
      <OrderArticleSummary terms={terms} compact />
      <View style={styles.amountRow}>
        <Text style={styles.caption}>{seller ? 'Prix de l’article' : 'Montant total'}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Voir le détail du montant" style={styles.amountTouch} hitSlop={spacing.sm} onPress={() => openTool('amounts')}>
          <View style={styles.amountAction}><Text style={styles.amount}>{amountLabel(seller ? order.amount : order.totalAmount)}</Text><Ionicons name="chevron-forward" size={spacing.md} color={colors.muted} /></View>
        </Pressable>
      </View>
      {milestones.length ? <View style={styles.timeline}>
        {milestones.map((event, index) => <View key={event.title} style={styles.timelineRow}>
          <View style={styles.timelineMarker}><View style={styles.dot} />{index < milestones.length - 1 ? <View style={styles.line} /> : null}</View>
          <View style={styles.eventText}><Text style={styles.eventTitle}>{event.title}</Text>
            <Text style={styles.caption}>{event.at.toLocaleString(APP_LOCALE, {day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit'})}</Text></View>
        </View>)}
      </View> : null}
      {!dev && order.trackingNumber ? <View style={styles.tracking}><Text style={styles.caption}>Numéro de suivi</Text><Text selectable style={styles.trackingNumber}>{order.trackingNumber}</Text></View> : null}
      {order.deliveryType === 'shipping' && primaryLabel !== 'Suivre mon colis' ? <Pressable accessibilityRole="button" style={styles.rowLink}
        disabled={!moderationContext.focused || orderQuery.isFetching || orderQuery.isError} onPress={openTracking}>
        <Ionicons name="cube-outline" size={spacing.lg} color={colors.primary}/><Text style={styles.rowLinkText}>Suivre mon colis</Text>
        <Ionicons name="chevron-forward" size={spacing.md} color={colors.muted}/>
      </Pressable> : null}
      {order.chatId ? <Pressable accessibilityRole="button" style={styles.rowLink} onPress={() => navigate('chat')}>
        <Ionicons name="chatbubble-outline" size={spacing.lg} color={colors.primary} /><Text style={styles.rowLinkText}>Ouvrir la conversation</Text>
        <Ionicons name="chevron-forward" size={spacing.md} color={colors.muted} />
      </Pressable> : null}
    </ScrollView>
    <Modal visible={tool !== null} presentationStyle="pageSheet" animationType="slide" onRequestClose={closeTool}>
      <SafeAreaProvider style={styles.container}><BottomSheetModalProvider>
        <View style={styles.container}>
          <ScreenHeader title={tool ? toolTitle[tool] : ''} onBack={tool === 'menu' ? closeTool : () => openTool('menu')} />
          <ScrollView contentContainerStyle={styles.toolContent} keyboardShouldPersistTaps="handled">
            {tool === 'menu' ? <OrderOptionsList items={menuItems} /> : tool === 'amounts' ? <View style={styles.amountDetails}>
              <View style={styles.priceLine}><Text style={styles.body}>Article</Text><Text style={styles.body}>{amountLabel(order.amount)}</Text></View>
              {!seller && order.deliveryType === 'shipping' ? <View style={styles.priceLine}><Text style={styles.body}>Livraison</Text><Text style={styles.body}>{amountLabel(order.shippingCost)}</Text></View> : null}
              {!seller && order.serviceFee !== undefined ? <View style={styles.priceLine}><Text style={styles.body}>Frais de service</Text><Text style={styles.body}>{amountLabel(order.serviceFee)}</Text></View> : null}
              {!seller && order.taxTotal !== undefined && order.taxTotal > 0 ? <View style={styles.priceLine}><Text style={styles.body}>Taxes</Text><Text style={styles.body}>{amountLabel(order.taxTotal)}</Text></View> : null}
              <View style={styles.priceLine}><Text style={styles.eventTitle}>{seller ? 'Prix de l’article' : 'Total'}</Text><Text style={styles.eventTitle}>{amountLabel(seller ? order.amount : order.totalAmount)}</Text></View>
            </View> : tool === 'return' || tool === 'report' ? <>
                <ShipmentTracking key={`${scopeKey}/${tool}`} transaction={order} tool={tool} onStatusUpdate={() => {void orderQuery.refetch();}} />
                {tool === 'return' ? <Button variant="ghost" onPress={() => openTool('convenience')}>Retour convenu entre membres</Button> : null}
              </>
              : tool === 'receipt' ? <BuyerReceiptDeclaration transactionId={order.id} onHumanRecourse={linkedSupport} compact />
                : tool === 'bank' ? invalidBankNotice ? <><Text style={styles.body}>Cet avis de paiement ne peut pas être ouvert. Reprenez-le depuis la notification.</Text><Button variant="secondary" onPress={linkedSupport}>Contacter Seconde</Button></>
                  : <BankDisputeOwnerPanel uid={uid} transactionId={order.id} disputeId={order.bankDispute?.id} noticeReference={bankNoticeReference} compact
                    sourceKey={JSON.stringify([uid, generation, order.id, bankCaseNotice ?? null, order.bankDispute?.id ?? null, moderationContext.focusRevision])} assertSelection={assertScope} />
                  : tool === 'convenience' ? <ConvenienceReturnPanel uid={uid} transactionId={order.id} compact
                    sourceKey={JSON.stringify([uid, generation, order.id, order.status, order.shipEngineLabelId ?? null, order.returnLabelId ?? null, moderationContext.focusRevision])} onRecorded={() => {void orderQuery.refetch();}} />
                    : tool === 'deadline' ? <ReturnDepositDeadlinePanel uid={uid} transactionId={order.id} scope="owner" compact
                      sourceKey={JSON.stringify([uid, generation, order.id, order.status, order.returnLabelId ?? null, moderationContext.focusRevision])} onRecorded={() => {void orderQuery.refetch();}} />
                      : tool === 'dates' ? <OrderPolicyDates order={order} onSupport={linkedSupport} />
                        : tool === 'test' ? <DevShippingControls transaction={order} onStatusUpdate={() => {void orderQuery.refetch();}} />
                        : tool === 'help' ? <>
                          <Text style={styles.title}>{presentation.title}</Text>
                          <Text style={styles.body}>{getRefundPresentation(order, perspective)?.message ?? 'Notre équipe peut vous accompagner pour la suite de cette commande.'}</Text>
                          <Button onPress={linkedSupport}>Contacter Seconde</Button>
                        </> : null}
          </ScrollView>
        </View>
      </BottomSheetModalProvider></SafeAreaProvider>
    </Modal>
  </View>;
}

type OrderTool = 'menu' | 'amounts' | 'return' | 'report' | 'receipt' | 'bank' | 'help' | 'test' | 'convenience' | 'deadline' | 'dates';
const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: colors.background},
  content: {paddingHorizontal: spacing.lg, paddingBottom: spacing['3xl'], gap: spacing.xl},
  hero: {paddingTop: spacing.lg, gap: spacing.lg},
  heroTitle: {...typography.h1, color: colors.foreground},
  heroDescription: {...typography.body, color: colors.foregroundSecondary},
  eyebrow: {...typography.caption, color: colors.primary, fontFamily: fonts.sansMedium},
  title: {...typography.h3, color: colors.foreground},
  body: {...typography.body, color: colors.foreground},
  caption: {...typography.caption, color: colors.muted},
  amountAction: {flexDirection: 'row', gap: spacing.sm, alignItems: 'center'},
  amountTouch: {minHeight: sizing.minTouchTarget, justifyContent: 'center', paddingVertical: spacing.sm},
  amountRow: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'},
  amount: {...typography.h2, color: colors.foreground, fontVariant: ['tabular-nums']},
  timeline: {gap: spacing.sm},
  timelineRow: {flexDirection: 'row', gap: spacing.md},
  timelineMarker: {alignItems: 'center', width: spacing.md},
  dot: {width: spacing.sm, height: spacing.sm, marginTop: spacing.xs, borderRadius: radius.full, backgroundColor: colors.primary},
  line: {flex: 1, width: StyleSheet.hairlineWidth, backgroundColor: colors.border, minHeight: spacing.lg, marginTop: spacing.xs},
  eventText: {gap: spacing.xs, paddingBottom: spacing.md, flex: 1},
  eventTitle: {...typography.bodySmall, fontFamily: fonts.sansMedium, color: colors.foreground},
  tracking: {gap: spacing.xs},
  trackingNumber: {...typography.bodySmall, color: colors.foreground, fontVariant: ['tabular-nums']},
  rowLink: {flexDirection: 'row', gap: spacing.md, alignItems: 'center', minHeight: sizing.minTouchTarget, paddingVertical: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border},
  rowLinkText: {...typography.body, color: colors.foreground, flex: 1},
  helpLink: {alignSelf: 'center', padding: spacing.sm},
  helpText: {...typography.caption, color: colors.muted, textDecorationLine: 'underline'},
  headerAction: {padding: spacing.sm},
  empty: {flex: 1, padding: spacing.lg, gap: spacing.lg, justifyContent: 'center'},
  toolContent: {padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing['3xl']},
  amountDetails: {gap: spacing.lg},
  priceLine: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md},
});
