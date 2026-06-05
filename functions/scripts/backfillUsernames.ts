/**
 * One-shot BACKFILL of the usernames/ uniqueness registry.
 *
 * WHY (ordered prerequisite): the registry usernames/{username} -> {uid,...} is
 * the lock that guarantees a chosen handle is owned by exactly one user. Legacy
 * accounts received an AUTO-DERIVED username (assignUsername) and, depending on
 * when they were created, a registry entry may or may not exist for it. Before
 * we open the USER-CHOSEN handle in prod, EVERY users/* that already has a
 * `username` MUST have a matching usernames/{username} entry — otherwise a new
 * user could "choose" a handle a legacy user already wears, silently colliding.
 *
 * WHAT this does (idempotent, READ-MOSTLY, never destructive):
 *   - Scans every users/* document.
 *   - For each that has a non-empty string `username`:
 *       * If usernames/{username} does NOT exist  -> creates it { uid, createdAt }.
 *       * If it exists and already points to this uid -> no-op (idempotent).
 *       * If it exists but points to a DIFFERENT uid -> CONFLICT: logged and
 *         LEFT UNTOUCHED (two legacy users sharing a handle is a data anomaly to
 *         escalate manually; we NEVER overwrite an existing registry entry).
 *   - Re-running is safe: only missing entries get written.
 *
 * It does NOT touch users/* docs, does NOT rename anyone, does NOT delete.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * HOW TO RUN (founder, locally — NOT deployed):
 *
 *   1. Authenticate the Admin SDK against PROD. Either:
 *        export GOOGLE_APPLICATION_CREDENTIALS=/abs/path/to/serviceAccount.json
 *      OR (if gcloud ADC is set for the project):
 *        gcloud auth application-default login
 *        export GOOGLE_CLOUD_PROJECT=seconde-b47a6
 *
 *   2. From the functions/ directory:
 *        cd functions
 *        npm run backfill:usernames:dry   # report only, NO writes (run this first)
 *        npm run backfill:usernames       # live run (creates missing registry entries)
 *
 *      Both scripts compile scripts/ with the project tsc into ../lib-scripts/
 *      (gitignored) and run the compiled JS with plain node — no extra deps.
 *
 *   3. Inspect the summary. Any "CONFLICT" lines are anomalies to resolve by
 *      hand BEFORE opening the chosen-username flow.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import * as admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const DRY_RUN = process.argv.includes('--dry-run');
// Bounded batched commits to stay well under the 500-write limit.
const BATCH_LIMIT = 400;

interface Summary {
  scanned: number;
  withUsername: number;
  created: number;
  alreadyOk: number;
  conflicts: { username: string; userUid: string; registryUid: string }[];
}

async function run(): Promise<void> {
  const summary: Summary = {
    scanned: 0,
    withUsername: 0,
    created: 0,
    alreadyOk: 0,
    conflicts: [],
  };

  console.log(
    `[backfillUsernames] starting ${DRY_RUN ? '(DRY RUN — no writes)' : '(LIVE)'}…`
  );

  const usersSnap = await db.collection('users').get();
  summary.scanned = usersSnap.size;

  let batch = db.batch();
  let pending = 0;

  const flush = async (): Promise<void> => {
    if (pending === 0) return;
    if (!DRY_RUN) {
      await batch.commit();
    }
    batch = db.batch();
    pending = 0;
  };

  for (const userDoc of usersSnap.docs) {
    const uid = userDoc.id;
    const username = userDoc.get('username');

    if (typeof username !== 'string' || username.length === 0) {
      continue;
    }
    summary.withUsername += 1;

    const regRef = db.collection('usernames').doc(username);
    const regSnap = await regRef.get();

    if (!regSnap.exists) {
      // Missing → reserve it. (createdAt mirrors the user's createdAt when
      // available, else serverTimestamp; never undefined.)
      const userCreatedAt = userDoc.get('createdAt');
      batch.set(regRef, {
        uid,
        createdAt: userCreatedAt ?? admin.firestore.FieldValue.serverTimestamp(),
        backfilled: true,
      });
      summary.created += 1;
      pending += 1;
      if (pending >= BATCH_LIMIT) {
        await flush();
      }
      continue;
    }

    const registryUid = regSnap.get('uid');
    if (registryUid === uid) {
      summary.alreadyOk += 1;
    } else {
      // Anomaly: two users sharing a handle, OR registry points elsewhere.
      // NEVER overwrite — log for manual resolution.
      summary.conflicts.push({ username, userUid: uid, registryUid });
      console.warn(
        `[backfillUsernames] CONFLICT username="${username}" user=${uid} ` +
          `registryOwner=${registryUid} (left untouched)`
      );
    }
  }

  await flush();

  console.log('[backfillUsernames] DONE');
  console.log(`  users scanned        : ${summary.scanned}`);
  console.log(`  users with username  : ${summary.withUsername}`);
  console.log(`  registry created     : ${summary.created}${DRY_RUN ? ' (would create)' : ''}`);
  console.log(`  already correct      : ${summary.alreadyOk}`);
  console.log(`  CONFLICTS            : ${summary.conflicts.length}`);
  if (summary.conflicts.length > 0) {
    console.log('  --- conflicts (resolve manually before opening chosen-username) ---');
    for (const c of summary.conflicts) {
      console.log(`    "${c.username}": user ${c.userUid} vs registry ${c.registryUid}`);
    }
  }
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[backfillUsernames] FAILED', err);
    process.exit(1);
  });
