/**
 * Script de régénération des embeddings avec le modèle multimodal
 *
 * 1. Supprime tous les documents article_images (anciens embeddings 768 dims)
 * 2. Déclenche une mise à jour sur chaque article pour régénérer les embeddings (1408 dims)
 *
 * Usage: node regenerate-embeddings.js
 */

const admin = require('firebase-admin');

// Initialize Firebase Admin
const serviceAccount = require('../seconde-b47a6-firebase-adminsdk-fbsvc-26728f2671.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: 'seconde-b47a6',
});

const db = admin.firestore();

async function resetForceRegenerateFlags() {
  console.log('=== Étape 0: Réinitialisation des flags ===');

  const snapshot = await db.collection('articles')
    .where('forceRegenerateEmbedding', '==', true)
    .get();

  if (snapshot.empty) {
    console.log('Aucun flag à réinitialiser.');
    return;
  }

  const batch = db.batch();
  snapshot.docs.forEach(doc => {
    batch.update(doc.ref, { forceRegenerateEmbedding: admin.firestore.FieldValue.delete() });
  });

  await batch.commit();
  console.log(`✓ ${snapshot.size} flags réinitialisés\n`);
}

async function deleteAllArticleImages() {
  console.log('=== Étape 1: Suppression des anciens embeddings ===');

  const snapshot = await db.collection('article_images').get();
  console.log(`Trouvé ${snapshot.size} documents article_images à supprimer`);

  if (snapshot.empty) {
    console.log('Aucun document à supprimer.');
    return;
  }

  // Delete in batches of 500 (Firestore limit)
  const batchSize = 500;
  let deleted = 0;

  while (deleted < snapshot.size) {
    const batch = db.batch();
    const docsToDelete = snapshot.docs.slice(deleted, deleted + batchSize);

    docsToDelete.forEach(doc => {
      batch.delete(doc.ref);
    });

    await batch.commit();
    deleted += docsToDelete.length;
    console.log(`  Supprimé ${deleted}/${snapshot.size} documents`);
  }

  console.log('✓ Tous les anciens embeddings supprimés\n');
}

async function triggerEmbeddingRegeneration() {
  console.log('=== Étape 2: Déclenchement de la régénération ===');

  const articlesSnapshot = await db.collection('articles')
    .where('isActive', '==', true)
    .get();

  console.log(`Trouvé ${articlesSnapshot.size} articles actifs à traiter`);

  let processed = 0;
  const errors = [];

  for (const doc of articlesSnapshot.docs) {
    const articleId = doc.id;
    const article = doc.data();

    // Skip if no images
    if (!article.images || article.images.length === 0) {
      console.log(`  [${processed + 1}/${articlesSnapshot.size}] ${articleId}: Pas d'images, ignoré`);
      processed++;
      continue;
    }

    try {
      // Trigger the Cloud Function by setting forceRegenerateEmbedding
      // The onDocumentWritten trigger will detect this and regenerate embeddings
      await db.collection('articles').doc(articleId).update({
        forceRegenerateEmbedding: true,
      });

      console.log(`  [${processed + 1}/${articlesSnapshot.size}] ${articleId}: Mise à jour déclenchée (${article.images.length} images)`);

      // Wait a bit to avoid overwhelming the trigger
      await sleep(2000);

    } catch (error) {
      console.error(`  [${processed + 1}/${articlesSnapshot.size}] ${articleId}: ERREUR - ${error.message}`);
      errors.push({ articleId, error: error.message });
    }

    processed++;
  }

  console.log(`\n✓ ${processed} articles traités`);

  if (errors.length > 0) {
    console.log(`\n⚠ ${errors.length} erreurs:`);
    errors.forEach(e => console.log(`  - ${e.articleId}: ${e.error}`));
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log('========================================');
  console.log('RÉGÉNÉRATION DES EMBEDDINGS MULTIMODAUX');
  console.log('De 768 dimensions → 1408 dimensions');
  console.log('========================================\n');

  try {
    // Étape 0: Réinitialiser les flags existants
    await resetForceRegenerateFlags();

    // Étape 1: Supprimer les anciens embeddings
    await deleteAllArticleImages();

    // Étape 2: Déclencher la régénération
    await triggerEmbeddingRegeneration();

    console.log('\n========================================');
    console.log('TERMINÉ');
    console.log('Les embeddings seront régénérés par les triggers Cloud Functions.');
    console.log('Consultez les logs Firebase pour suivre la progression.');
    console.log('========================================');

  } catch (error) {
    console.error('\nErreur fatale:', error);
    process.exit(1);
  }

  process.exit(0);
}

main();
