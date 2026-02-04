/**
 * Scheduled swap functions
 * Firebase Functions v7 - using onSchedule
 */
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { db, FieldValue } from '../config/firebase';
import { sendPushNotification } from '../utils/notifications';

/**
 * Update swap party statuses automatically
 * Runs every 5 minutes to transition parties: upcoming -> active -> ended
 */
export const updateSwapPartyStatuses = onSchedule({ schedule: 'every 5 minutes', memory: '512MiB' }, async () => {
  console.log('Checking swap party statuses...');
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
        console.log(`Updated party ${partyDoc.id} status to ${newStatus}`);
      }
    }

    console.log(
      `Swap party status check complete. Updated ${updatedCount} parties.`
    );
  } catch (error) {
    console.error('Error updating swap party statuses:', error);
  }
});

/**
 * Send swap zone reminders 3 days before start
 * Runs daily at 10:00 AM Paris time
 */
export const sendSwapZoneReminders = onSchedule(
  {
    schedule: '0 10 * * *',
    timeZone: 'Europe/Paris',
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

      console.log(
        `Looking for swap parties starting between ${startOfDay.toISOString()} and ${endOfDay.toISOString()}`
      );

      // Find swap parties starting in 3 days
      const partiesSnapshot = await db
        .collection('swapParties')
        .where('startDate', '>=', startOfDay)
        .where('startDate', '<=', endOfDay)
        .where('status', '==', 'upcoming')
        .get();

      if (partiesSnapshot.empty) {
        console.log('No swap parties starting in 3 days');
        return;
      }

      console.log(
        `Found ${partiesSnapshot.docs.length} swap parties to notify about`
      );

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
          console.log(`No participants for party ${partyId}`);
          continue;
        }

        const userIds = participantsSnapshot.docs.map(
          (doc) => doc.data().userId
        );
        console.log(
          `Notifying ${userIds.length} participants for party ${partyName}`
        );

        // Send notifications to all participants
        await Promise.all(
          userIds.map(async (userId) => {
            // Check user's notification preferences
            const userDoc = await db.collection('users').doc(userId).get();
            if (userDoc.exists) {
              const userPrefs = userDoc.data()?.preferences?.notifications;
              if (userPrefs?.swapZoneReminder === false) {
                console.log(
                  `User ${userId} has swap zone reminder notifications disabled`
                );
                return;
              }
            }

            await sendPushNotification(
              userId,
              '📦 Swap Zone dans 3 jours !',
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

        console.log(`Sent reminders for party ${partyName}`);
      }
    } catch (error) {
      console.error('Error in sendSwapZoneReminders:', error);
    }
  }
);
