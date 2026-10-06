/**
 * Swap Firestore triggers
 * Firebase Functions v7 - using onDocumentCreated/onDocumentUpdated
 */
import {
  onDocumentCreated,
  onDocumentUpdated,
} from 'firebase-functions/v2/firestore';
import * as logger from 'firebase-functions/logger';
import { sendSwapNotification } from '../utils/notifications';

/** Resolve items arrays with backward compat for legacy single-item swaps */
function getSwapItems(swap: any, side: 'initiator' | 'receiver'): any[] {
  if (side === 'initiator') {
    return swap.initiatorItems || (swap.initiatorItem ? [swap.initiatorItem] : []);
  }
  return swap.receiverItems || (swap.receiverItem ? [swap.receiverItem] : []);
}

/**
 * Send notification when a swap is proposed
 */
export const onSwapCreated = onDocumentCreated(
  { document: 'swaps/{swapId}', region: 'northamerica-northeast1', memory: '512MiB' },
  async (event) => {
    try {
      const snapshot = event.data;
      if (!snapshot) return;

      const swap = snapshot.data();
      const swapId = event.params.swapId;

      if (!swap.receiverId) {
        logger.info('No receiver for swap notification');
        return;
      }

      // Build notification
      const title = "Nouvelle proposition d'échange";

      // Handle both single-item (legacy) and multi-item formats
      const receiverItemsArray = getSwapItems(swap, 'receiver');
      const initiatorItemsArray = getSwapItems(swap, 'initiator');

      let body: string;
      if (receiverItemsArray.length === 0) {
        body = `${swap.initiatorName} te propose un échange`;
      } else if (receiverItemsArray.length === 1) {
        body = `${swap.initiatorName} te propose un échange pour "${receiverItemsArray[0]?.title}"`;
      } else {
        // Multiple items: show count
        const receiverCount = receiverItemsArray.length;
        const initiatorCount = initiatorItemsArray.length;
        body = `${initiatorCount} article(s) proposé(s) pour ${receiverCount} article(s)`;
      }

      await sendSwapNotification(swap.receiverId, swapId, title, body, swap);
      logger.info('Swap proposal notification processed');
    } catch (error) {
      console.error('Error sending swap proposal notification:', error);
    }
  }
);

/**
 * Helper to get swap description for notifications
 */
function getSwapDescription(swap: any): string {
  const initiatorItems = getSwapItems(swap, 'initiator');
  const receiverItems = getSwapItems(swap, 'receiver');

  if (initiatorItems.length === 0 && receiverItems.length === 0) {
    return 'l\'échange';
  }

  if (initiatorItems.length === 1 && receiverItems.length === 1) {
    return `l'échange de "${receiverItems[0]?.title || 'article'}"`;
  }

  // Multi-article: show count format
  return `l'échange (${initiatorItems.length} article(s) pour ${receiverItems.length} article(s))`;
}

/**
 * Send notification when swap status changes
 */
export const onSwapStatusUpdated = onDocumentUpdated(
  { document: 'swaps/{swapId}', region: 'northamerica-northeast1', memory: '512MiB' },
  async (event) => {
    try {
      const before = event.data?.before?.data();
      const after = event.data?.after?.data();
      const swapId = event.params.swapId;

      if (!before || !after) return;

      // Only process if status changed
      if (before.status === after.status) {
        return;
      }

      const newStatus = after.status;
      let targetUserId: string;
      let title: string;
      let body: string;

      switch (newStatus) {
        case 'accepted':
          // When the transition comes from 'payment_pending', the receiver
          // accepted by settling the cash top-up — notify BOTH parties so the
          // receiver also gets confirmation, not just the initiator.
          if (before.status === 'payment_pending') {
            await sendSwapNotification(
              after.initiatorId,
              swapId,
              'Échange accepté !',
              `${after.receiverName} a accepté ${getSwapDescription(after)}`,
              after
            );
            await sendSwapNotification(
              after.receiverId,
              swapId,
              'Échange accepté !',
              `Tu as accepté ${getSwapDescription(after)}`,
              after
            );
            return;
          }
          targetUserId = after.initiatorId;
          title = 'Échange accepté !';
          body = `${after.receiverName} a accepté ${getSwapDescription(after)}`;
          break;

        case 'payment_pending':
          // The receiver accepted a swap with a cash top-up — notify the payer
          // (could be either party) that payment is required to proceed.
          if (after.cashTopUp?.payerId) {
            await sendSwapNotification(
              after.cashTopUp.payerId,
              swapId,
              'Paiement requis',
              'Ton échange est accepté. Règle le complément pour lancer l\'échange.',
              after
            );
          }
          return;

        case 'disputed':
          // Notify both parties that a dispute was opened.
          await sendSwapNotification(
            after.initiatorId,
            swapId,
            'Litige ouvert',
            'Un litige a été ouvert sur cet échange. Notre équipe va l\'examiner.',
            after
          );
          await sendSwapNotification(
            after.receiverId,
            swapId,
            'Litige ouvert',
            'Un litige a été ouvert sur cet échange. Notre équipe va l\'examiner.',
            after
          );
          return;

        case 'declined':
          targetUserId = after.initiatorId;
          title = 'Échange refusé';
          body = `${after.receiverName} a refusé ${getSwapDescription(after)}`;
          break;

        case 'cancelled':
          targetUserId = after.receiverId;
          title = 'Échange annulé';
          body = `${after.initiatorName} a annulé ${getSwapDescription(after)}`;
          break;

        case 'photos_pending':
          // Notify both parties
          await sendSwapNotification(
            after.initiatorId,
            swapId,
            'Photos requises',
            "N'oublie pas d'envoyer les photos de ton article",
            after
          );
          await sendSwapNotification(
            after.receiverId,
            swapId,
            'Photos requises',
            "N'oublie pas d'envoyer les photos de ton article",
            after
          );
          return;

        case 'shipping':
          // Notify both parties
          await sendSwapNotification(
            after.initiatorId,
            swapId,
            'Prêt à expédier',
            'Les photos sont validées, tu peux envoyer ton article',
            after
          );
          await sendSwapNotification(
            after.receiverId,
            swapId,
            'Prêt à expédier',
            'Les photos sont validées, tu peux envoyer ton article',
            after
          );
          return;

        case 'completed':
          // Notify both parties
          await sendSwapNotification(
            after.initiatorId,
            swapId,
            'Échange terminé !',
            "L'échange est complet. N'oublie pas de laisser une note.",
            after
          );
          await sendSwapNotification(
            after.receiverId,
            swapId,
            'Échange terminé !',
            "L'échange est complet. N'oublie pas de laisser une note.",
            after
          );
          return;

        default:
          return;
      }

      await sendSwapNotification(targetUserId, swapId, title, body, after);
    } catch (error) {
      console.error('Error sending swap status notification:', error);
    }
  }
);
