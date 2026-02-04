/**
 * Backfill script: generate embeddings for all active articles missing them.
 *
 * Usage:
 *   cd functions
 *   GOOGLE_APPLICATION_CREDENTIALS="../seconde-b47a6-firebase-adminsdk-fbsvc-26728f2671.json" node backfill-embeddings.js
 */

const admin = require('firebase-admin');
const { PredictionServiceClient, helpers } = require('@google-cloud/aiplatform');

admin.initializeApp();
const db = admin.firestore();
const storage = admin.storage();
const FieldValue = admin.firestore.FieldValue;

// Vertex AI config
const VERTEX_PROJECT = 'seconde-b47a6';
const VERTEX_LOCATION = 'us-central1';
const EMBEDDING_MODEL = 'multimodalembedding@001';

const vertexClient = new PredictionServiceClient({
  apiEndpoint: `${VERTEX_LOCATION}-aiplatform.googleapis.com`,
});

function getPriceRange(price) {
  if (price < 20) return 'low';
  if (price <= 100) return 'medium';
  return 'high';
}

function parseFirebaseStorageUrl(url) {
  const match = url.match(
    /^https:\/\/firebasestorage\.googleapis\.com\/v0\/b\/([^/]+)\/o\/([^?]+)/
  );
  if (match) {
    return { bucketName: match[1], filePath: decodeURIComponent(match[2]) };
  }
  return null;
}

async function downloadImageAsBase64(imageUrl) {
  const parsed = parseFirebaseStorageUrl(imageUrl);
  if (parsed) {
    try {
      const bucket = storage.bucket(parsed.bucketName);
      const file = bucket.file(parsed.filePath);
      const [exists] = await file.exists();
      if (!exists) {
        console.error(`  File not found: ${parsed.filePath}`);
        return null;
      }
      const [buffer] = await file.download();
      return buffer.toString('base64');
    } catch (err) {
      console.error('  Storage download error:', err.message);
    }
  }

  // Fallback HTTP
  try {
    const response = await fetch(imageUrl);
    if (!response.ok) return null;
    const buf = await response.arrayBuffer();
    return Buffer.from(buf).toString('base64');
  } catch (err) {
    console.error('  HTTP download error:', err.message);
    return null;
  }
}

async function generateEmbedding(imageBase64) {
  const endpoint = `projects/${VERTEX_PROJECT}/locations/${VERTEX_LOCATION}/publishers/google/models/${EMBEDDING_MODEL}`;
  const instanceValue = helpers.toValue({ image: { bytesBase64Encoded: imageBase64 } });
  if (!instanceValue) return null;

  const [response] = await vertexClient.predict({ endpoint, instances: [instanceValue] });
  if (!response.predictions || response.predictions.length === 0) return null;

  const values = response.predictions[0]?.structValue?.fields?.imageEmbedding?.listValue?.values;
  if (!values) return null;

  return values.map(v => v.numberValue || 0);
}

async function main() {
  console.log('=== Embedding Backfill ===\n');

  // 1. Get all active articles with images
  const articlesSnap = await db.collection('articles')
    .where('isActive', '==', true)
    .get();

  console.log(`Found ${articlesSnap.size} active articles.\n`);

  let generated = 0;
  let skipped = 0;
  let failed = 0;

  for (const doc of articlesSnap.docs) {
    const article = doc.data();
    const articleId = doc.id;
    const imageUrl = article.images?.[0]?.url;

    if (!imageUrl) {
      console.log(`[SKIP] ${articleId} - no image`);
      skipped++;
      continue;
    }

    // Check if embedding already exists and is active
    const embDoc = await db.collection('embeddings').doc(articleId).get();
    if (embDoc.exists && embDoc.data()?.isActive === true && embDoc.data()?.embedding) {
      console.log(`[SKIP] ${articleId} - already has active embedding`);
      skipped++;
      continue;
    }

    console.log(`[GEN]  ${articleId} - "${article.title}"`);

    try {
      const base64 = await downloadImageAsBase64(imageUrl);
      if (!base64) {
        console.log(`  FAILED: could not download image`);
        failed++;
        continue;
      }

      const embedding = await generateEmbedding(base64);
      if (!embedding) {
        console.log(`  FAILED: could not generate embedding`);
        failed++;
        continue;
      }

      await db.collection('embeddings').doc(articleId).set({
        articleId,
        embedding: FieldValue.vector(embedding),
        imageUrl,
        categoryIds: article.categoryIds || (article.category ? [article.category] : []),
        brand: article.brand || null,
        priceRange: getPriceRange(article.price || 0),
        isActive: true,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      console.log(`  OK (${embedding.length} dims)`);
      generated++;

      // Small delay to avoid rate limiting
      await new Promise(r => setTimeout(r, 500));
    } catch (err) {
      console.error(`  ERROR: ${err.message}`);
      failed++;
    }
  }

  console.log(`\n=== Done ===`);
  console.log(`Generated: ${generated}`);
  console.log(`Skipped:   ${skipped}`);
  console.log(`Failed:    ${failed}`);

  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
