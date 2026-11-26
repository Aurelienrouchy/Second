import { hasMeetupAcceptanceAttempt } from '@/services/chat/offers';
import { assertNewSaleAdmission } from '@/services/newSaleAdmission';
import { useTradeAdmissionError } from '@/hooks/useTradeAdmissionError';
/**
 * Accept/reject confirmations capture one operation before opening the dialog.
 * Both actions share a synchronous lock; cancellation, blur and dossier changes invalidate it.
 * Reject remains an existing-obligation exit and has no new-sale admission gate here.
 */
import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { useTradeOperation } from '@/hooks/useTradeOperation';
import { Alert } from 'react-native';

import { track } from '@/lib/analytics';
import { formatPrice } from '@/utils/formatPrice';

import { errCode } from './utils';

interface UseOfferResponseDialogsParams {
  chatId: string;
  articleId?: string;
  messageId: string;
  amount: number;
  isMeetupOffer: boolean;
  /** Rôle de l'appelant — admission et analytique. */
  isSeller: boolean;
  onAcceptOffer?: (messageId: string, offerId: string) => Promise<void>;
  onRejectOffer: (messageId: string, offerId: string) => Promise<void>;
  onAccepted?: () => void | Promise<void>;
}

export function useOfferResponseDialogs({
  chatId,
  articleId,
  messageId,
  amount,
  isMeetupOffer,
  isSeller,
  onAcceptOffer,
  onRejectOffer,
  onAccepted,
}: UseOfferResponseDialogsParams) {
  const showAdmissionError = useTradeAdmissionError();
  const [isAccepting, setIsAccepting] = useState(false);
  const [isRejecting, setIsRejecting] = useState(false);

  const context = useTradeOperation(JSON.stringify([chatId, articleId, messageId, amount, isMeetupOffer, isSeller]));
  const [previousFrame, setPreviousFrame] = useState(context.frame);
  const [previousFocus, setPreviousFocus] = useState(context.focusRevision);
  if (previousFrame !== context.frame || previousFocus !== context.focusRevision) {
    setPreviousFrame(context.frame);
    setPreviousFocus(context.focusRevision);
    setIsAccepting(false);
    setIsRejecting(false);
  }
  const handleAccept = async () => {
    if (!context.isOriginCurrent() || !onAcceptOffer || isAccepting || isRejecting) return;
    const role: 'buyer' | 'seller' = isSeller ? 'seller' : 'buyer';
    let operation;
    try { operation = context.start(); }
    catch (error) { Alert.alert('Erreur', error instanceof Error ? error.message : 'Session indisponible.'); return; }
    if (!operation) return;
    let dispatched = false;
    let cancelled = false;
    const finish = () => {
      if (context.isCurrent(operation) && context.ownsLock(operation)) setIsAccepting(false);
      context.finish(operation);
    };
    setIsAccepting(true);
    const accept = async (previous: boolean) => {
      if (dispatched) return;
      if (cancelled || !context.isCurrent(operation) || !context.ownsLock(operation)) { finish(); return; }
      dispatched = true;
      try {
        context.assertCurrent(operation);
        // Postal acceptance checks these same foundations in the server transaction.
        // Keep the distinct meetup preflight; never delay the postal confirmation
        // with an equivalent extra network request.
        if (!previous && isMeetupOffer) await assertNewSaleAdmission(operation.session.uid, isSeller ? 'sell' : 'buy', () => context.assertCurrent(operation));
        context.assertCurrent(operation);
        await onAcceptOffer(messageId, messageId);
        context.assertCurrent(operation);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        track('offer_responded', {
          chat_id: chatId, message_id: messageId, article_id: articleId ?? '', action: 'accept',
          dialog_outcome: 'confirmed', result: 'success', offer_amount_cents: Math.round(amount * 100),
          is_meetup_offer: isMeetupOffer, role,
        });
        if (!isMeetupOffer) {context.assertCurrent(operation); await onAccepted?.();}
      } catch (error) {
        if (!context.isCurrent(operation)) return;
        const unknown = !!error && typeof error === 'object' && 'tradeRecovery' in error && error.tradeRecovery === true;
        if (__DEV__ && !unknown) console.error('Error accepting offer:', error);
        track('offer_responded', {
          chat_id: chatId, message_id: messageId, article_id: articleId ?? '', action: 'accept',
          dialog_outcome: 'confirmed', result: 'error', error_code: errCode(error),
          offer_amount_cents: Math.round(amount * 100), is_meetup_offer: isMeetupOffer, role,
        });
        if (!showAdmissionError(error, {isCurrent: () => context.isCurrent(operation), retry: () => {void handleAccept();}})) {
          Alert.alert('Erreur', error instanceof Error ? error.message : "Impossible d'accepter l'offre");
        }
      } finally { finish(); }
    };
    try {
      const previous = await hasMeetupAcceptanceAttempt(operation.session.uid, chatId, messageId, () => context.assertCurrent(operation));
      context.assertCurrent(operation);
      // The recorded intention already has the member's confirmation. Resume
      // that exact tuple while the normal loading indicator remains visible.
      if (previous) { await accept(true); return; }
      Alert.alert("Accepter l'offre", isMeetupOffer
        ? `Voulez-vous accepter cette offre de ${formatPrice(amount)} avec meetup ?`
        : `Voulez-vous accepter cette offre de ${formatPrice(amount)} ?`, [
        {text: 'Annuler', style: 'cancel', onPress: () => {
          if (dispatched) return;
          cancelled = true;
          if (context.isCurrent(operation)) track('offer_responded', {
            chat_id: chatId, message_id: messageId, article_id: articleId ?? '', action: 'accept',
            dialog_outcome: 'cancelled', offer_amount_cents: Math.round(amount * 100), is_meetup_offer: isMeetupOffer, role,
          });
          finish();
        }},
        {text: 'Accepter', onPress: () => accept(false)},
      ], {onDismiss: () => {if (!dispatched) {cancelled = true; finish();}}});
    } catch (error) {
      if (context.isCurrent(operation)) Alert.alert('Connexion indisponible', 'Impossible de confirmer cette offre pour le moment.', [
        {text: 'Fermer', style: 'cancel'},
        {text: 'Actualiser', onPress: () => {if (context.isCurrent(operation)) void handleAccept();}},
      ]);
      finish();
    }
  };

  const handleReject = async () => {
    if (!context.isOriginCurrent()) return;
    if (isAccepting || isRejecting) return;
    const role: 'buyer' | 'seller' = isSeller ? 'seller' : 'buyer';
    let operation;
    try { operation = context.start(); }
    catch (error) { Alert.alert('Erreur', error instanceof Error ? error.message : 'Session indisponible.'); return; }
    if (!operation) return;
    const finish = () => {
      if (context.isCurrent(operation) && context.ownsLock(operation)) setIsRejecting(false);
      context.finish(operation);
    };
    let dispatched = false;
    let cancelled = false;
    setIsRejecting(true);
    Alert.alert("Refuser l'offre", `Voulez-vous refuser cette offre de ${formatPrice(amount)} ?`, [
      {
        text: 'Annuler',
        style: 'cancel',
        onPress: () => {
          if (dispatched) return;
          cancelled = true;
          finish();
          if (!context.isCurrent(operation)) return;
          track('offer_responded', {
            chat_id: chatId,
            message_id: messageId,
            article_id: articleId ?? '',
            action: 'reject',
            dialog_outcome: 'cancelled',
            offer_amount_cents: Math.round(amount * 100),
            is_meetup_offer: isMeetupOffer,
            role,
          });
        },
      },
      {
        text: 'Refuser',
        style: 'destructive',
        onPress: async () => {
          if (dispatched) return;
          if (cancelled || !context.isCurrent(operation) || !context.ownsLock(operation)) { finish(); return; }
          dispatched = true;
          try {
            context.assertCurrent(operation);
            setIsRejecting(true);
            await onRejectOffer(messageId, messageId);
            context.assertCurrent(operation);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            track('offer_responded', {
              chat_id: chatId,
              message_id: messageId,
              article_id: articleId ?? '',
              action: 'reject',
              dialog_outcome: 'confirmed',
              result: 'success',
              offer_amount_cents: Math.round(amount * 100),
              is_meetup_offer: isMeetupOffer,
              role,
            });
          } catch (error) {
            if (!context.isCurrent(operation)) return;
            if (__DEV__) console.error('Error rejecting offer:', error);
            track('offer_responded', {
              chat_id: chatId,
              message_id: messageId,
              article_id: articleId ?? '',
              action: 'reject',
              dialog_outcome: 'confirmed',
              result: 'error',
              error_code: errCode(error),
              offer_amount_cents: Math.round(amount * 100),
              is_meetup_offer: isMeetupOffer,
              role,
            });
            // On surface le motif du serveur : refuser une offre déjà
            // acceptée est désormais explicitement rejeté, et l'utilisateur
            // doit comprendre pourquoi.
            const msg =
              error instanceof Error && error.message
                ? error.message
                : "Impossible de refuser l'offre";
            Alert.alert('Erreur', msg);
          } finally {
            finish();
          }
        },
      },
    ], { onDismiss: () => { if (!dispatched) { cancelled = true; finish(); } } });
  };

  // Les trois contre-offres — prix, lieu, horaire — vivent dans leur propre
  // hook : elles partagent l'état du panneau ouvert, les quatre champs de
  // saisie, le verrou `isCountering` et la validation du format d'horaire.
  // Deux cent seize lignes de moins ici, et un groupe testable seul.

  return { isAccepting, isRejecting, handleAccept, handleReject };
}
