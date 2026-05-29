/**
 * ┌────────────────────────────────────────────────────────────────────────┐
 * │  RUN MANUEL APRÈS REVIEW — NE PAS auto-exécuter, NE PAS déployer.        │
 * │  Ce fichier N'EST PAS un Cloud Function et N'EST PAS exporté depuis      │
 * │  functions/src/index.ts. Il ne crée donc aucun orphelin en prod.        │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * Migration `articles.size` (et miroir `search_index.size`) : string -> objet
 * ArticleSize { value, system } (findings L1/L2 + contrat de types).
 *
 * Règles :
 *  - size string non vide  -> { value: <string>, system: 'EU' }  (défaut EU)
 *  - size null/vide/absent -> laissé null (aucune écriture)
 *  - size déjà objet       -> skip (idempotent)
 *
 * Le système par défaut est 'EU' : la marketplace est canadienne mais le stock
 * historique a été saisi en tailles européennes. Ajuster ce défaut ici si la
 * convention diffère, AVANT d'exécuter.
 *
 * USAGE (depuis ./functions, identifiants admin requis) :
 *
 *   1. npm run build
 *   2. DRY-RUN :   node lib/scripts/migrateArticleSize.js --dry-run
 *   3. Relire les compteurs, PUIS pour de vrai :
 *                  node lib/scripts/migrateArticleSize.js
 *
 * Idempotent : ré-exécutable (skip les size déjà objet).
 */
import * as admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

const DRY_RUN = process.argv.includes('--dry-run');
const DEFAULT_SYSTEM: 'US' | 'EU' = 'EU';
const BATCH_SIZE = 400;

type ArticleSize = { value: string; system: 'US' | 'EU' };

/**
 * Convert a legacy size value into an ArticleSize object, or null if it should
 * be left untouched / cleared.
 * Returns `undefined` when no write is needed (already an object, or empty).
 */
function toArticleSize(raw: unknown): ArticleSize | null | undefined {
  // Already migrated -> no write
  if (raw && typeof raw === 'object' && 'value' in (raw as Record<string, unknown>)) {
    return undefined;
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed.length === 0) return undefined; // empty string -> leave as-is
    return { value: trimmed, system: DEFAULT_SYSTEM };
  }
  // null / undefined / number -> leave null, no write
  return undefined;
}

async function migrateCollection(collectionName: string): Promise<void> {
  const snap = await db.collection(collectionName).get();
  console.log(`[migrateArticleSize] ${collectionName}: ${snap.size} docs`);

  let scanned = 0;
  let updated = 0;
  let skipped = 0;

  let batch = db.batch();
  let pending = 0;

  for (const docSnap of snap.docs) {
    scanned++;
    const newSize = toArticleSize(docSnap.data()?.size);

    if (newSize === undefined) {
      skipped++;
      continue;
    }

    if (DRY_RUN) {
      updated++;
      continue;
    }

    batch.update(docSnap.ref, { size: newSize });
    pending++;
    updated++;

    if (pending >= BATCH_SIZE) {
      await batch.commit();
      batch = db.batch();
      pending = 0;
    }
  }

  if (!DRY_RUN && pending > 0) {
    await batch.commit();
  }

  console.log(
    `[migrateArticleSize] ${collectionName}: scanned=${scanned} updated=${updated} skipped=${skipped}`
  );
}

async function run(): Promise<void> {
  console.log(
    `[migrateArticleSize] start (dryRun=${DRY_RUN}, defaultSystem=${DEFAULT_SYSTEM})`
  );
  await migrateCollection('articles');
  await migrateCollection('search_index');
  console.log('[migrateArticleSize] done');
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[migrateArticleSize] FAILED', err);
    process.exit(1);
  });
