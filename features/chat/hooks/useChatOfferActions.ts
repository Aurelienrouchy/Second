import { assertNewSaleAdmission, assertNewProposalAdmission } from '@/services/newSaleAdmission';
import { acknowledgeMeetupProposal } from '@/services/chat/offers';
/**
 * Offer and existing meetup actions tied to the current identity and conversation.
 * Every absent/stale context rejects explicitly; only a confirmed current operation resolves.
 * Locks are per message so another existing obligation remains available.
 */
import { useCallback } from 'react';
import { useTradeOperation } from '@/hooks/useTradeOperation';
import { staleTradeOperation } from '@/services/tradeOperation';
import { useShippingPurchaseContext } from '@/hooks/useShippingPurchaseContext';

import { ChatService } from '@/services/chatService';
import type { MeetupSpot } from '@/types';

interface UseChatOfferActionsParams {
  chatId: string | null;
  userId: string | undefined;
  otherParticipantId: string | undefined;
  sellerId?: string;
  acceptOffer: (messageId: string, offerId: string, assertContext?: () => void) => Promise<void>;
  rejectOffer: (messageId: string, offerId: string) => Promise<void>;
}

export function useChatOfferActions({
  chatId,
  userId,
  otherParticipantId,
  sellerId,
  acceptOffer,
  rejectOffer,
}: UseChatOfferActionsParams) {
  const context = useTradeOperation(JSON.stringify([chatId, otherParticipantId]), userId ?? null);
  const servicing = useShippingPurchaseContext(JSON.stringify(['existing-chat-obligation', chatId, otherParticipantId]), userId ?? null);
  const run = async (messageId: string, action: (assertCurrent: () => void) => Promise<unknown>, assertIntention?: () => void) => {
    if (!messageId) throw staleTradeOperation();
    const operation = context.start(messageId);
    if (!operation) throw Object.assign(new Error('Une action est déjà en cours pour cette conversation.'), { code: 'client/operation-pending' });
    const assertCurrent = () => { context.assertCurrent(operation); assertIntention?.(); };
    try {
      assertCurrent();
      if (!chatId || !userId) throw staleTradeOperation();
      const receipt = await action(assertCurrent);
      assertCurrent();
      if (typeof receipt === 'string') acknowledgeMeetupProposal(receipt, assertCurrent);
    } finally { context.finish(operation); }
  };
  const runExisting = async (messageId: string, action: (assertCurrent: () => void) => Promise<unknown>) => {
    if (!chatId || !userId || !messageId) throw staleTradeOperation();
    const operation = servicing.start(messageId); if (!operation) throw new Error('Une action est déjà en cours pour ce message.');
    const assertCurrent = () => servicing.assertCurrent(operation);
    try {assertCurrent(); await action(assertCurrent); assertCurrent();} finally {servicing.finish(operation);}
  };
  const handleAcceptOffer = useCallback((messageId: string, offerId: string) =>
    run(messageId, assertCurrent => acceptOffer(messageId, offerId, assertCurrent)), [context, acceptOffer]);
  const handleRejectOffer = useCallback((messageId: string, offerId: string) =>
    runExisting(messageId, () => rejectOffer(messageId, offerId)), [servicing.frame, servicing.focusRevision, rejectOffer]);
  const handleCounterPrice = useCallback((messageId: string, amount: number, message?: string, assertIntention?: () => void) =>
    run(messageId, async assertCurrent => {
      if (!otherParticipantId || !sellerId || !userId) throw staleTradeOperation();
      // The shared proposal journal identifies postal/meetup payloads before
      // its beforeNewDispatch gate; an exact replay keeps its native requestId.
      return ChatService.counterOfferPrice(chatId!, messageId, userId!, otherParticipantId, amount, message, assertCurrent, { deferAdoption: true, beforeNewDispatch: () => assertNewSaleAdmission(userId, userId === sellerId ? 'sell' : 'buy', assertCurrent) });
    }, assertIntention), [context, chatId, userId, otherParticipantId, sellerId]);
  const handleCounterLocation = useCallback((messageId: string, location: MeetupSpot, message?: string, assertIntention?: () => void) =>
    run(messageId, async assertCurrent => {
      if (!otherParticipantId || !sellerId || !userId) throw staleTradeOperation();
      await assertNewProposalAdmission(userId, userId === sellerId ? 'sell' : 'buy', { chatId: chatId!, originalMessageId: messageId, counterKind: 'location', location, ...(message ? { message } : {}) }, assertCurrent);
      assertCurrent();
      return ChatService.counterOfferLocation(chatId!, messageId, userId!, otherParticipantId, location, message, assertCurrent, { deferAdoption: true, beforeNewDispatch: () => assertNewSaleAdmission(userId, userId === sellerId ? 'sell' : 'buy', assertCurrent) });
    }, assertIntention), [context, chatId, userId, otherParticipantId, sellerId]);
  const handleCounterTime = useCallback((messageId: string, time: Date, message?: string, assertIntention?: () => void) =>
    run(messageId, async assertCurrent => {
      if (!otherParticipantId || !sellerId || !userId) throw staleTradeOperation();
      await assertNewProposalAdmission(userId, userId === sellerId ? 'sell' : 'buy', { chatId: chatId!, originalMessageId: messageId, counterKind: 'time', dateTime: time.toISOString(), ...(message ? { message } : {}) }, assertCurrent);
      assertCurrent();
      return ChatService.counterOfferTime(chatId!, messageId, userId!, otherParticipantId, time, message, assertCurrent, { deferAdoption: true, beforeNewDispatch: () => assertNewSaleAdmission(userId, userId === sellerId ? 'sell' : 'buy', assertCurrent) });
    }, assertIntention), [context, chatId, userId, otherParticipantId, sellerId]);
  const handleConfirmMeetup = useCallback((messageId: string) =>
    runExisting(messageId, assertCurrent => ChatService.confirmMeetup(chatId!, messageId, userId!, assertCurrent)), [servicing.frame, servicing.focusRevision, chatId, userId]);
  const handleReportNoShow = useCallback((messageId: string, reason?: string, details?: string, expectedDisputeId?: string | null) =>
    runExisting(messageId, assertCurrent => ChatService.reportNoShow(chatId!, messageId, userId!, reason, details, assertCurrent, expectedDisputeId)), [servicing.frame, servicing.focusRevision, chatId, userId]);
  const handleCancelMeetup = useCallback((messageId: string) =>
    runExisting(messageId, assertCurrent => ChatService.cancelMeetup(chatId!, messageId, userId!, assertCurrent)), [servicing.frame, servicing.focusRevision, chatId, userId]);
  const handleCompleteMeetup = useCallback((messageId: string) =>
    runExisting(messageId, assertCurrent => ChatService.completeMeetup(chatId!, messageId, userId!, assertCurrent)), [servicing.frame, servicing.focusRevision, chatId, userId]);

  return {
    handleAcceptOffer,
    handleRejectOffer,
    handleCounterPrice,
    handleCounterLocation,
    handleCounterTime,
    handleConfirmMeetup,
    handleReportNoShow,
    handleCancelMeetup,
    handleCompleteMeetup,
  };
}
