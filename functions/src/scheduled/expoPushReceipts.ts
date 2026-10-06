import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as logger from 'firebase-functions/logger';
import { reconcileExpoPushReceipts } from '../utils/expoPush';

export const checkExpoPushReceipts = onSchedule(
  { schedule: 'every 15 minutes', region: 'northamerica-northeast1' },
  async () => {
    try {
      await reconcileExpoPushReceipts();
    } catch {
      logger.warn('Expo receipt reconciliation failed; receipts retained for retry');
    }
  },
);
