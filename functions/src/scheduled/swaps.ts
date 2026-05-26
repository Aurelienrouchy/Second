/**
 * Scheduled swap functions
 * Firebase Functions v7 - using onSchedule
 */
import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as logger from 'firebase-functions/logger';
import { db, FieldValue } from '../config/firebase';
import { sendPushNotification } from '../utils/notifications';

/**
 * Cleanup pending swaps and items when a swap party ends.
 * - Cancels all swaps in status 'proposed' linked to this party
 * - Resets isPending on swapPartyItems that were pending
 * - Notifies affected participants whose swaps were cancelled
 */
async function cleanupEndedParty(partyId: string, partyName: string): Promise<void> {
  // 1. Cancel all 'proposed' swaps linked to this party
  const proposedSwapsSnapshot = await db
    .collection('swaps')
    .where('partyId', '==', partyId)
    .where('status', '==', 'proposed')
    .get();

  if (proposedSwapsSnapshot.empty) {
    logger.info('[swapPartyCleanup] No proposed swaps to cancel', { partyId });
  } else {
    logger.info('[swapPartyCleanup] Cancelling proposed swaps', {
      partyId,
      count: proposedSwapsSnapshot.docs.length,
    });

    // Collect unique user IDs to notify
    const usersToNotify = new Set<string>();

    const batch = db.batch();
    for (const swapDoc of proposedSwapsSnapshot.docs) {
      const swap = swapDoc.data();
      batch.update(swapDoc.ref, {
        status: 'cancelled',
        cancelReason: 'party_ended',
        updatedAt: FieldValue.serverTimestamp(),
      });
      if (swap.initiatorId) usersToNotify.add(swap.initiatorId);
      if (swap.receiverId) usersToNotify.add(swap.receiverId);
    }
    await batch.commit();

    // Notify affected users
    for (const userId of usersToNotify) {
      try {
        await sendPushNotification(
          userId,
          'Swap Zone terminée',
          `La Swap Zone "${partyName}" est terminée. Tes propositions en attente ont été annulées.`,
          { partyId, partyName },
          'swap_update'
        );
      } catch (notifError) {
        logger.error('[swapPartyCleanup] Failed to notify user', { userId, error: notifError });
      }
    }
  }

  // 2. Reset isPending on all pending items in this party
  const pendingItemsSnapshot = await db
    .collection('swapPartyItems')
    .where('partyId', '==', partyId)
    .where('isPending', '==', true)
    .get();

  if (!pendingItemsSnapshot.empty) {
    logger.info('[swapPartyCleanup] Resetting pending items', {
      partyId,
      count: pendingItemsSnapshot.docs.length,
    });

    const itemsBatch = db.batch();
    for (const itemDoc of pendingItemsSnapshot.docs) {
      itemsBatch.update(itemDoc.ref, { isPending: false });
    }
    await itemsBatch.commit();
  }
}

/**
 * Update swap party statuses automatically
 * Runs every 5 minutes to transition parties: upcoming -> active -> ended
 * When a party transitions to 'ended', cleanup pending swaps and items.
 */
export const updateSwapPartyStatuses = onSchedule({ schedule: 'every 5 minutes', region: 'northamerica-northeast1', memory: '512MiB' }, async () => {
  logger.info('Checking swap party statuses...');
  const now = new Date();

  try {
    // Get all non-ended parties
    const partiesSnapshot = await db
      .collection('swapParties')
      .where('status', 'in', ['upcoming', 'active'])
      .get();

    let updatedCount = 0;

    for (const partyDoc of partiesSnapshot.docs) {
      const party = partyDoc.data();
      const startDate = party.startDate?.toDate();
      const endDate = party.endDate?.toDate();
      let newStatus: string | null = null;

      if (party.status === 'upcoming' && startDate && now >= startDate) {
        newStatus = 'active';
      } else if (party.status === 'active' && endDate && now >= endDate) {
        newStatus = 'ended';
      }

      if (newStatus) {
        await db.collection('swapParties').doc(partyDoc.id).update({
          status: newStatus,
          updatedAt: FieldValue.serverTimestamp(),
        });
        updatedCount++;
        logger.info(`Updated party ${partyDoc.id} status to ${newStatus}`);

        // Cleanup when a party ends: cancel proposed swaps, reset pending items
        if (newStatus === 'ended') {
          await cleanupEndedParty(partyDoc.id, party.name || 'Swap Zone');
        }
      }
    }

    logger.info('Swap party status check complete', { updatedCount });
  } catch (error) {
    logger.error('Error updating swap party statuses', { error });
  }
});

/**
 * Send swap zone reminders 3 days before start
 * Runs daily at 10:00 AM Montreal time
 */
export const sendSwapZoneReminders = onSchedule(
  {
    schedule: '0 10 * * *',
    region: 'northamerica-northeast1',
    timeZone: 'America/Montreal',
    memory: '512MiB',
  },
  async () => {
    try {
      // Calculate the target date (3 days from now)
      const now = new Date();
      const targetDate = new Date(now);
      targetDate.setDate(targetDate.getDate() + 3);

      // Set to start of day
      const startOfDay = new Date(targetDate);
      startOfDay.setHours(0, 0, 0, 0);

      // Set to end of day
      const endOfDay = new Date(targetDate);
      endOfDay.setHours(23, 59, 59, 999);

      logger.info('Looking for swap parties starting soon', {
        startOfDay: startOfDay.toISOString(),
        endOfDay: endOfDay.toISOString(),
      });

      // Find swap parties starting in 3 days
      const partiesSnapshot = await db
        .collection('swapParties')
        .where('startDate', '>=', startOfDay)
        .where('startDate', '<=', endOfDay)
        .where('status', '==', 'upcoming')
        .get();

      if (partiesSnapshot.empty) {
        logger.info('No swap parties starting in 3 days');
        return;
      }

      logger.info('Found swap parties to notify about', { count: partiesSnapshot.docs.length });

      // Process each party
      for (const partyDoc of partiesSnapshot.docs) {
        const partyData = partyDoc.data();
        const partyId = partyDoc.id;
        const partyName = partyData.name || 'Swap Zone';

        // Get all participants
        const participantsSnapshot = await db
          .collection('swapPartyParticipants')
          .where('partyId', '==', partyId)
          .get();

        if (participantsSnapshot.empty) {
          logger.info('No participants for party', { partyId });
          continue;
        }

        const userIds = participantsSnapshot.docs.map(
          (doc) => doc.data().userId
        );
        logger.info('Notifying participants for party', { partyName, participantCount: userIds.length });

        // Send notifications to all participants
        await Promise.all(
          userIds.map(async (userId) => {
            // Check user's notification preferences
            const userDoc = await db.collection('users').doc(userId).get();
            if (userDoc.exists) {
              const userPrefs = userDoc.data()?.preferences?.notifications;
              if (userPrefs?.swapZoneReminder === false) {
                logger.info('User has swap zone reminder notifications disabled', { userId });
                return;
              }
            }

            await sendPushNotification(
              userId,
              'Swap Zone dans 3 jours !',
              `N'oubliez pas d'ajouter vos articles à "${partyName}"`,
              {
                partyId,
                partyName,
                daysUntil: '3',
              },
              'swap_zone_reminder'
            );
          })
        );

        logger.info('Sent reminders for party', { partyName });
      }
    } catch (error) {
      logger.error('Error in sendSwapZoneReminders', { error });
    }
  }
);
