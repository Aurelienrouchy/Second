/**
 * ┌────────────────────────────────────────────────────────────────────────┐
 * │  RUN MANUEL APRÈS REVIEW — NE PAS auto-exécuter, NE PAS déployer.        │
 * │  Ce fichier N'EST PAS un Cloud Function et N'EST PAS exporté depuis      │
 * │  functions/src/index.ts. Il ne crée donc aucun orphelin en prod.        │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * Backfill `search_index.categoryIds` (finding C1).
 *
 * Avant ce fix, le trigger `updateSearchIndex` n'écrivait jamais `categoryIds`
 * dans les docs `search_index`. Le filtre catégorie en recherche textuelle
 * était donc mort. Le trigger est désormais corrigé pour les futures écritures ;
 * ce script rattrape les docs `search_index` EXISTANTS en recopiant
 * `categoryIds` depuis l'article source `articles/{id}`.
 *
 * USAGE (depuis ./functions, avec des identifiants admin — service account ou
 * `gcloud auth application-default login` + GOOGLE_APPLICATION_CREDENTIALS) :
 *
 *   1. Vérifier que le code est buildé :   npm run build
 *   2. Lancer en DRY-RUN d'abord :         node lib/scripts/backfillSearchIndexCategoryIds.js --dry-run
 *   3. Relire le compte de docs touchés, PUIS exécuter pour de vrai :
 *                                          node lib/scripts/backfillSearchIndexCategoryIds.js
 *
 * Idempotent : ré-exécutable sans dommage (n'écrit que si la valeur diffère).
 */
import * as admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

const DRY_RUN = process.argv.includes('--dry-run');
const BATCH_SIZE = 400; // < 500 (limite Firestore batch)

async function run(): Promise<void> {
  console.log(`[backfillSearchIndexCategoryIds] start (dryRun=${DRY_RUN})`);

  const searchIndexSnap = await db.collection('search_index').get();
  console.log(`[backfillSearchIndexCategoryIds] ${searchIndexSnap.size} docs search_index`);

  let scanned = 0;
  let updated = 0;
  let skipped = 0;
  let missingArticle = 0;

  let batch = db.batch();
  let pending = 0;

  for (const idxDoc of searchIndexSnap.docs) {
    scanned++;
    const idxData = idxDoc.data();

    // articleId = doc id (le trigger utilise articleId comme doc id)
    const articleId = (idxData.articleId as string) || idxDoc.id;

    const articleSnap = await db.collection('articles').doc(articleId).get();
    if (!articleSnap.exists) {
      missingArticle++;
      continue;
    }

    const articleCategoryIds: string[] = articleSnap.data()?.categoryIds || [];
    const existing: string[] = idxData.categoryIds || [];

    // Skip si déjà identique (idempotence)
    const same =
      existing.length === articleCategoryIds.length &&
      existing.every((v, i) => v === articleCategoryIds[i]);
    if (same) {
      skipped++;
      continue;
    }

    if (DRY_RUN) {
      updated++;
      continue;
    }

    batch.update(idxDoc.ref, { categoryIds: articleCategoryIds });
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
    `[backfillSearchIndexCategoryIds] done — scanned=${scanned} updated=${updated} skipped=${skipped} missingArticle=${missingArticle}`
  );
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[backfillSearchIndexCategoryIds] FAILED', err);
    process.exit(1);
  });
