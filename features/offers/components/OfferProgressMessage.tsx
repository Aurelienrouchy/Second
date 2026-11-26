import React, {useState} from 'react';
import {ActivityIndicator, Alert, Pressable, StyleSheet, Text, View} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import {useRouter} from 'expo-router';
import {ConversationProgressNotice} from '@/components/ConversationProgressNotice';
import {RecourseReasonSheet} from '@/components/RecourseReasonSheet';
import {SHIPPING_ENABLED} from '@/config/featureFlags';
import {colors, fonts, radius, spacing, typography} from '@/constants/theme';
import {useLabelLifecycleContext} from '@/hooks/useLabelLifecycleContext';
import {track} from '@/lib/analytics';
import {shippingOrderProgress} from '@/utils/shippingOrderProgress';
import type {MessageOfferWithMeetup} from '@/types';
import type {OfferBubbleProps} from './OfferBubble';
import {styles} from './offer-bubble/styles';
import {getMeetupActionState} from './offer-bubble/utils';
import {useOfferTransaction} from './offer-bubble/useOfferTransaction';
import {useMeetupDialogs} from './offer-bubble/useMeetupDialogs';
import {MeetupActions} from './offer-bubble/MeetupActions';

/** Current actions are their own list entry. The proposal and historical
 * milestones never contain these callbacks. All operations keep their original
 * session, focus, native receipt and synchronous navigation guards. */
export function OfferProgressMessage({message, chatId, currentUserId, sellerId, articleId,
  onConfirmMeetup, onReportNoShow, onCancelMeetup, onCompleteMeetup}: OfferBubbleProps) {
  const router = useRouter();
  const offer = message.offer as MessageOfferWithMeetup | undefined;
  const optionsContext = useLabelLifecycleContext(JSON.stringify(['meetup-options', chatId, message.id, offer]), currentUserId);
  const [optionsSession, setOptionsSession] = useState<ReturnType<typeof optionsContext.capture> | null>(null);
  const isMeetupOffer = !!offer?.meetup;
  const {transactionId, transaction: linkedOrder, isLoading: isLoadingTransaction, canStartCheckout,
    blocked: paymentBlocked, refresh: refreshPayment, beginPayment} = useOfferTransaction({
    status: offer?.status ?? 'pending', isMeetupOffer, chatId, currentUserId, messageId: message.id,
    linkedTransactionId: offer?.transactionId, sellerId,
  });
  const isSeller = !!sellerId && currentUserId === sellerId, isBuyer = !!sellerId && currentUserId !== sellerId;
  const {isExiting, guardExit, handleConfirmMeetup, handleCancelMeetup, handleContestNoShow, handleReportNoShow,
    handleCompleteMeetup, reportSheetProps, openMeetupSupport} = useMeetupDialogs({chatId, articleId,
    messageId: message.id, amount: offer?.amount ?? 0, isSeller, transactionId,
    onConfirmMeetup, onCancelMeetup, onReportNoShow, onCompleteMeetup});
  if (!offer || !['accepted', 'completed'].includes(offer.status)) return null;
  const {amount, status, meetup} = offer;
  const {canConfirm, canComplete, canReportNoShow, canCancel, canContest} = getMeetupActionState({
    isBuyer, isSeller, offerStatus: status, isMeetupOffer, currentUserId, meetup,
  });
  const secondaryOptions = [
    ...(canReportNoShow && onReportNoShow ? [{label: 'Signaler une absence', action: handleReportNoShow}] : []),
    ...(canCancel && onCancelMeetup ? [{label: 'Annuler la rencontre', action: guardExit(handleCancelMeetup)}] : []),
    ...(isMeetupOffer && ['accepted', 'completed'].includes(offer.status) ? [
      {label: 'Article refusé pendant la rencontre', action: () => openMeetupSupport('article_refused')},
      {label: 'Désaccord sur la remise', action: () => openMeetupSupport('disagreement_after_declaration')},
      {label: 'Situation dangereuse ou pression', action: () => openMeetupSupport('safety_or_pressure')},
    ] : []),
  ];
  const optionsVisible = optionsSession !== null && optionsContext.isCurrent(optionsSession);
  const progress = linkedOrder ? shippingOrderProgress(linkedOrder, currentUserId) : null;
  const canPay = isBuyer && status === 'accepted' && !isMeetupOffer && SHIPPING_ENABLED && (!!transactionId || canStartCheckout);
  const navigate = (work: () => void) => {try {if (!beginPayment()) return;} catch {return;} work();};
  const handlePayment = () => {
    if (!canPay || isLoadingTransaction) return;
    navigate(() => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      track('offer_pay_tapped', {chat_id: chatId, article_id: articleId ?? undefined, offer_amount_cents: Math.round(amount * 100),
        transaction_exists: !!transactionId, destination: transactionId ? 'payment' : articleId ? 'checkout' : 'error'});
      if (transactionId) router.push({pathname: '/payment/[transactionId]', params: {transactionId}});
      else if (articleId) router.push({pathname: '/checkout/shipping', params: {articleId, chatId, offerMessageId: message.id}});
      else Alert.alert('Erreur', 'Impossible de procéder au paiement');
    });
  };
  return <><ConversationProgressNotice title={isMeetupOffer ? 'Votre rencontre' : progress?.title ?? (isSeller ? 'En attente du paiement' : 'Finaliser l’achat')}>
    {isSeller && !isMeetupOffer && !linkedOrder && !offer.transactionId && articleId ? <Pressable accessibilityRole="button" style={styles.cancelMeetupButton}
      onPress={() => navigate(() => router.push({pathname: '/article/shipping/[id]', params: {id: articleId, returnChatId: chatId}}))}>
      <Text style={styles.cancelMeetupText}>Préparer mon colis</Text></Pressable> : null}
    {!isMeetupOffer && !canPay && (linkedOrder || offer.transactionId) ? <Pressable accessibilityRole="button" style={styles.paymentButton}
      onPress={() => navigate(() => router.push({pathname: progress?.destination === 'tracking' ? '/orders/tracking/[id]' : '/orders/[id]',
        params: {id: linkedOrder?.id ?? offer.transactionId!}} as never))}>
      <Text style={styles.paymentButtonText}>{progress?.action ?? 'Voir la commande'}</Text></Pressable> : null}
    {!isMeetupOffer && paymentBlocked && !linkedOrder ? <Pressable accessibilityRole="button" onPress={refreshPayment}>
      <Text style={styles.expiryText}>Actualiser la commande</Text></Pressable> : null}
    {canPay ? <Pressable accessibilityRole="button" style={styles.paymentButton} onPress={handlePayment} disabled={isLoadingTransaction}>
      {isLoadingTransaction ? <ActivityIndicator size="small" color={colors.foreground}/> : <><Ionicons name="card" size={18} color={colors.foreground}/>
        <Text style={styles.paymentButtonText}>Payer maintenant</Text></>}
    </Pressable> : null}
        {(canConfirm || canComplete) && (
          <MeetupActions
            confirmLabel={canConfirm ? 'Confirmer le rendez-vous' : 'Rencontre effectuée'}
            onConfirm={
              canConfirm && onConfirmMeetup
                ? handleConfirmMeetup
                : canComplete && onCompleteMeetup
                  ? handleCompleteMeetup
                  : undefined
            }
          />
        )}

        {/* Contestation d'un signalement d'absence (partie visée uniquement) */}
        {canContest && onReportNoShow && (
          <Pressable
            style={[
              styles.actionButton,
              styles.noShowButton,
              styles.contestButton,
              isExiting && styles.disabledButton,
            ]}
            onPress={guardExit(handleContestNoShow)}
            disabled={isExiting}
          >
            <Ionicons name="chatbox-ellipses-outline" size={16} color={colors.dangerDark} />
            <Text style={styles.noShowButtonText}>Donner ma version</Text>
          </Pressable>
        )}

        {/* Meetup Completed Badge */}
        {isMeetupOffer && meetup?.completedAt && (
          <View style={styles.completedBadge}>
            <Ionicons name="checkmark-done-circle" size={18} color={colors.success} />
            <Text style={styles.completedText}>Transaction terminée</Text>
          </View>
        )}

        {secondaryOptions.length > 0 ? <Pressable accessibilityRole="button" accessibilityLabel="Options de la rencontre"
          accessibilityState={{expanded: optionsVisible}}
          hitSlop={spacing.sm}
          disabled={isExiting} style={menuStyles.trigger} onPress={() => {
            if (optionsVisible) {setOptionsSession(null); return;}
            try {setOptionsSession(optionsContext.capture());} catch { /* Departed conversations cannot open options. */ }
          }}><Ionicons name="ellipsis-horizontal" size={spacing.md} color={colors.muted}/>
          <Text style={menuStyles.triggerText}>Options de la rencontre</Text></Pressable> : null}
        {optionsVisible ? <View style={menuStyles.menu}>
        {secondaryOptions.map(option => <Pressable key={option.label} accessibilityRole="button" style={menuStyles.option}
          disabled={isExiting} onPress={() => {
            if (!optionsSession || !optionsContext.isCurrent(optionsSession)) return;
            setOptionsSession(null);
            void option.action();
          }}><Text style={menuStyles.optionText}>{option.label}</Text></Pressable>)}
        <Pressable accessibilityRole="button" style={menuStyles.option} onPress={() => setOptionsSession(null)}>
          <Text style={menuStyles.triggerText}>Fermer</Text>
        </Pressable>
        </View> : null}

  </ConversationProgressNotice>
  {reportSheetProps ? <RecourseReasonSheet {...reportSheetProps}/> : null}</>;
}

const menuStyles = StyleSheet.create({
  trigger: {alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm},
  triggerText: {...typography.caption, color: colors.muted},
  menu: {backgroundColor: colors.surfaceWarm, paddingHorizontal: spacing.md, borderRadius: radius.md},
  option: {paddingVertical: spacing.sm},
  optionText: {...typography.bodySmall, fontFamily: fonts.sansMedium, color: colors.foreground},
});
