/**
 * Lightweight anti-overlap lock for scheduled jobs that perform PAYABLE external
 * operations (F82). Cloud Scheduler can overrun (a slow run still executing when
 * the next tick fires) or retry, so two concurrent invocations of the same job
 * could both pick the same docs and each pay for a duplicate side-effect (e.g. a
 * second ShipEngine label). This lock makes a job run at most once at a time.
 *
 * Mechanism: a `job_locks/{jobName}` doc holding `lockedUntil`. acquireJobLock
 * runs a runTransaction that only takes the lock if it is free OR expired (TTL),
 * so a crashed run that never released its lock cannot wedge the job forever.
 * releaseJobLock clears it best-effort at the end.
 */
import * as logger from 'firebase-functions/logger';
import { db, FieldValue } from '../config/firebase';
import { Timestamp } from 'firebase-admin/firestore';

/**
 * Try to acquire the named lock for `ttlMs`. Returns true if acquired (caller
 * MUST run + releaseJobLock in a finally), false if another run holds it.
 */
export async function acquireJobLock(jobName: string, ttlMs: number): Promise<boolean> {
  const lockRef = db.collection('job_locks').doc(jobName);
  const now = Date.now();

  try {
    return await db.runTransaction(async (tx) => {
      const snap = await tx.get(lockRef);
      const data = snap.exists ? snap.data()! : null;
      const lockedUntilMs =
        data?.lockedUntil instanceof Timestamp ? data.lockedUntil.toMillis() : 0;

      // Free OR expired (a previous run crashed without releasing).
      if (!data || lockedUntilMs <= now) {
        tx.set(
          lockRef,
          {
            lockedAt: FieldValue.serverTimestamp(),
            lockedUntil: Timestamp.fromMillis(now + ttlMs),
          },
          { merge: true }
        );
        return true;
      }
      return false;
    });
  } catch (err) {
    // On a contention/error, be conservative: do NOT run (avoid double-pay).
    logger.warn('[jobLock] acquire failed — skipping run', {
      jobName,
      error: err instanceof Error ? err.message : err,
    });
    return false;
  }
}

/** Release the named lock (best-effort; never throws). */
export async function releaseJobLock(jobName: string): Promise<void> {
  try {
    await db.collection('job_locks').doc(jobName).set(
      {
        lockedUntil: Timestamp.fromMillis(0),
        releasedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  } catch (err) {
    logger.warn('[jobLock] release failed', {
      jobName,
      error: err instanceof Error ? err.message : err,
    });
  }
}
