/**
 * Scheduled cleanup of expired draft images from Firebase Storage
 * Firebase Functions v7 - using onSchedule
 *
 * Draft images are uploaded to `drafts/{draftId}/` during AI analysis.
 * If the user abandons the flow, these images are never cleaned up.
 * This function runs daily and deletes draft files older than 14 days.
 */
import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as logger from 'firebase-functions/logger';
import { storage } from '../config/firebase';

/** Draft expiration: 14 days (matches client-side draftService.ts) */
const DRAFT_EXPIRATION_MS = 14 * 24 * 60 * 60 * 1000;

export const cleanupExpiredDrafts = onSchedule(
  {
    schedule: 'every 24 hours',
    timeZone: 'America/Toronto',
    region: 'northamerica-northeast1',
    memory: '512MiB',
  },
  async () => {
    const bucket = storage.bucket();
    const cutoff = Date.now() - DRAFT_EXPIRATION_MS;
    let deleted = 0;
    let errors = 0;

    try {
      const [files] = await bucket.getFiles({ prefix: 'drafts/' });

      logger.info(`Found ${files.length} files under drafts/`);

      for (const file of files) {
        try {
          const [metadata] = await file.getMetadata();
          const timeCreated = metadata.timeCreated;
          if (!timeCreated) continue;
          const created = new Date(timeCreated).getTime();

          if (created < cutoff) {
            await file.delete();
            deleted++;
          }
        } catch (fileError) {
          errors++;
          logger.warn(`Failed to process file ${file.name}:`, fileError);
        }
      }

      logger.info(`Draft cleanup complete: ${deleted} expired files deleted, ${errors} errors`);
    } catch (error) {
      logger.error('Error during draft cleanup:', error);
    }
  }
);
