# Tech Spec: Visual Search & Similar Products - Embedding Architecture

**Date:** 2026-01-11
**Auteur:** Mary (Business Analyst)
**Version:** 1.0
**Stack:** React Native (Expo) + Firebase + Vertex AI

---

## 1. Vue d'Ensemble

### 1.1 Architecture Globale

```
┌─────────────────────────────────────────────────────────────────────┐
│                           CLIENT (React Native)                      │
├─────────────────────────────────────────────────────────────────────┤
│  VisualSearchService    │    RecommendationService                  │
│  - captureAndSearch()   │    - getSimilarProducts(articleId)        │
│  - searchByImage(uri)   │    - getRecommendedForYou()               │
└──────────────┬──────────┴──────────────────┬────────────────────────┘
               │                              │
               ▼                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      CLOUD FUNCTIONS (Firebase)                      │
├─────────────────────────────────────────────────────────────────────┤
│  visualSearch           │    getSimilarProducts                      │
│  - Receive base64 image │    - Get article embedding                 │
│  - Generate embedding   │    - Query similar vectors                 │
│  - Query vector DB      │    - Apply business filters                │
│  - Return results       │    - Return ranked results                 │
├─────────────────────────┴────────────────────────────────────────────┤
│  generateEmbedding (Firestore Trigger)                               │
│  - On article create/update                                          │
│  - Generate image embedding via Vertex AI                            │
│  - Store in embeddings collection                                    │
└──────────────┬───────────────────────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         VERTEX AI                                    │
├─────────────────────────────────────────────────────────────────────┤
│  Multimodal Embeddings API                                          │
│  Model: multimodalembedding@001                                      │
│  Output: 1408-dimension vector                                       │
│  Cost: $0.0001/image                                                 │
└─────────────────────────────────────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         FIRESTORE                                    │
├─────────────────────────────────────────────────────────────────────┤
│  Collection: embeddings/{articleId}                                  │
│  - embedding: vector(1408)                                           │
│  - articleId: string                                                 │
│  - createdAt: timestamp                                              │
│  Vector Index: cosine similarity                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. Data Model

### 2.1 Collection: `embeddings`

```typescript
interface ArticleEmbedding {
  articleId: string;
  embedding: number[];           // 1408-dimension vector
  imageUrl: string;              // Source image used for embedding
  createdAt: Timestamp;
  updatedAt: Timestamp;
  // Denormalized for filtering
  categoryIds: string[];
  brand: string | null;
  priceRange: 'low' | 'medium' | 'high';  // <20€, 20-100€, >100€
  isActive: boolean;
}
```

### 2.2 Firestore Vector Index

```javascript
// firestore.indexes.json - Ajouter
{
  "indexes": [
    {
      "collectionGroup": "embeddings",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "embedding", "vectorConfig": { "dimension": 1408, "flat": {} } },
        { "fieldPath": "isActive", "order": "ASCENDING" }
      ]
    }
  ]
}
```

---

## 3. Cloud Functions

### 3.1 `generateEmbedding` (Firestore Trigger)

**Trigger:** `onCreate` et `onUpdate` sur `articles/{articleId}`

```typescript
// functions/src/embeddings.ts

import { onDocumentCreated, onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { VertexAI } from '@google-cloud/vertexai';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

const vertexAI = new VertexAI({
  project: process.env.GCLOUD_PROJECT,
  location: 'us-central1',
});

const embeddingModel = vertexAI.getGenerativeModel({
  model: 'multimodalembedding@001',
});

// Prix range helper
function getPriceRange(price: number): 'low' | 'medium' | 'high' {
  if (price < 20) return 'low';
  if (price <= 100) return 'medium';
  return 'high';
}

export const generateEmbeddingOnCreate = onDocumentCreated(
  'articles/{articleId}',
  async (event) => {
    const articleId = event.params.articleId;
    const article = event.data?.data();

    if (!article || !article.images?.[0]?.url) {
      console.log(`No image for article ${articleId}, skipping embedding`);
      return;
    }

    await generateAndStoreEmbedding(articleId, article);
  }
);

export const generateEmbeddingOnUpdate = onDocumentUpdated(
  'articles/{articleId}',
  async (event) => {
    const articleId = event.params.articleId;
    const before = event.data?.before.data();
    const after = event.data?.after.data();

    if (!after) return;

    // Only regenerate if main image changed
    const beforeImage = before?.images?.[0]?.url;
    const afterImage = after?.images?.[0]?.url;

    if (beforeImage !== afterImage) {
      await generateAndStoreEmbedding(articleId, after);
    } else {
      // Update denormalized fields only
      await updateEmbeddingMetadata(articleId, after);
    }
  }
);

async function generateAndStoreEmbedding(
  articleId: string,
  article: FirebaseFirestore.DocumentData
) {
  const db = getFirestore();
  const imageUrl = article.images[0].url;

  try {
    // Download image and convert to base64
    const imageBase64 = await downloadImageAsBase64(imageUrl);

    // Generate embedding via Vertex AI
    const response = await embeddingModel.generateContent({
      contents: [{
        role: 'user',
        parts: [{
          inlineData: {
            mimeType: 'image/jpeg',
            data: imageBase64,
          },
        }],
      }],
    });

    const embedding = response.response.candidates?.[0]?.content?.parts?.[0]?.embedding;

    if (!embedding || embedding.length !== 1408) {
      throw new Error('Invalid embedding response');
    }

    // Store embedding
    await db.collection('embeddings').doc(articleId).set({
      articleId,
      embedding: FieldValue.vector(embedding),
      imageUrl,
      categoryIds: article.categoryIds || [],
      brand: article.brand || null,
      priceRange: getPriceRange(article.price),
      isActive: article.isActive ?? true,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    console.log(`Generated embedding for article ${articleId}`);
  } catch (error) {
    console.error(`Error generating embedding for ${articleId}:`, error);
  }
}

async function updateEmbeddingMetadata(
  articleId: string,
  article: FirebaseFirestore.DocumentData
) {
  const db = getFirestore();

  await db.collection('embeddings').doc(articleId).update({
    categoryIds: article.categoryIds || [],
    brand: article.brand || null,
    priceRange: getPriceRange(article.price),
    isActive: article.isActive ?? true,
    updatedAt: FieldValue.serverTimestamp(),
  });
}

async function downloadImageAsBase64(url: string): Promise<string> {
  const response = await fetch(url);
  const buffer = await response.arrayBuffer();
  return Buffer.from(buffer).toString('base64');
}
```

### 3.2 `visualSearch` (Callable Function)

```typescript
// functions/src/visualSearch.ts

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { VertexAI } from '@google-cloud/vertexai';
import { getFirestore, VectorQuery, VectorQuerySnapshot } from 'firebase-admin/firestore';

interface VisualSearchRequest {
  imageBase64: string;
  mimeType: 'image/jpeg' | 'image/png';
  filters?: {
    categoryIds?: string[];
    priceRange?: 'low' | 'medium' | 'high';
    excludeArticleId?: string;
  };
  limit?: number;
}

interface VisualSearchResult {
  articleId: string;
  similarity: number;
  // Denormalized article data for display
  title: string;
  price: number;
  imageUrl: string;
  brand?: string;
  condition: string;
}

export const visualSearch = onCall<VisualSearchRequest>(
  {
    timeoutSeconds: 60,
    memory: '512MiB',
  },
  async (request) => {
    const { imageBase64, mimeType, filters, limit = 20 } = request.data;

    if (!imageBase64) {
      throw new HttpsError('invalid-argument', 'Image is required');
    }

    const vertexAI = new VertexAI({
      project: process.env.GCLOUD_PROJECT,
      location: 'us-central1',
    });

    const embeddingModel = vertexAI.getGenerativeModel({
      model: 'multimodalembedding@001',
    });

    // 1. Generate embedding for search image
    const response = await embeddingModel.generateContent({
      contents: [{
        role: 'user',
        parts: [{
          inlineData: {
            mimeType,
            data: imageBase64,
          },
        }],
      }],
    });

    const queryEmbedding = response.response.candidates?.[0]?.content?.parts?.[0]?.embedding;

    if (!queryEmbedding) {
      throw new HttpsError('internal', 'Failed to generate embedding');
    }

    // 2. Query Firestore Vector Search
    const db = getFirestore();
    let query = db.collection('embeddings')
      .where('isActive', '==', true);

    // Apply filters
    if (filters?.categoryIds?.length) {
      query = query.where('categoryIds', 'array-contains-any', filters.categoryIds);
    }
    if (filters?.priceRange) {
      query = query.where('priceRange', '==', filters.priceRange);
    }

    // Vector similarity search
    const vectorQuery: VectorQuery = query.findNearest({
      vectorField: 'embedding',
      queryVector: queryEmbedding,
      limit: limit + 1, // +1 to filter out self if needed
      distanceMeasure: 'COSINE',
    });

    const snapshot: VectorQuerySnapshot = await vectorQuery.get();

    // 3. Fetch full article data and build results
    const results: VisualSearchResult[] = [];
    const articleIds = snapshot.docs
      .filter(doc => doc.id !== filters?.excludeArticleId)
      .slice(0, limit)
      .map(doc => doc.id);

    if (articleIds.length === 0) {
      return { results: [], query_embedding_generated: true };
    }

    // Batch fetch articles
    const articlesSnapshot = await db.collection('articles')
      .where('__name__', 'in', articleIds)
      .get();

    const articlesMap = new Map(
      articlesSnapshot.docs.map(doc => [doc.id, doc.data()])
    );

    // Build results with similarity scores
    for (const doc of snapshot.docs) {
      if (doc.id === filters?.excludeArticleId) continue;
      if (results.length >= limit) break;

      const article = articlesMap.get(doc.id);
      if (!article) continue;

      // Cosine distance to similarity (1 - distance)
      const distance = doc.get('__distance__') || 0;
      const similarity = Math.round((1 - distance) * 100);

      results.push({
        articleId: doc.id,
        similarity,
        title: article.title,
        price: article.price,
        imageUrl: article.images?.[0]?.url,
        brand: article.brand,
        condition: article.condition,
      });
    }

    return { results };
  }
);
```

### 3.3 `getSimilarProducts` (Callable Function)

```typescript
// functions/src/similarProducts.ts

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, VectorQuery } from 'firebase-admin/firestore';

interface SimilarProductsRequest {
  articleId: string;
  limit?: number;
  includeScore?: boolean;
}

interface SimilarProduct {
  articleId: string;
  similarity?: number;
  title: string;
  price: number;
  imageUrl: string;
  brand?: string;
  condition: string;
}

export const getSimilarProducts = onCall<SimilarProductsRequest>(
  { timeoutSeconds: 30 },
  async (request) => {
    const { articleId, limit = 10, includeScore = false } = request.data;

    if (!articleId) {
      throw new HttpsError('invalid-argument', 'articleId is required');
    }

    const db = getFirestore();

    // 1. Get source article embedding
    const embeddingDoc = await db.collection('embeddings').doc(articleId).get();

    if (!embeddingDoc.exists) {
      // Fallback to category-based search (existing behavior)
      return { results: [], fallback: true };
    }

    const embeddingData = embeddingDoc.data()!;
    const sourceEmbedding = embeddingData.embedding;

    // 2. Vector similarity search
    const vectorQuery: VectorQuery = db.collection('embeddings')
      .where('isActive', '==', true)
      .findNearest({
        vectorField: 'embedding',
        queryVector: sourceEmbedding,
        limit: limit + 1, // +1 to exclude self
        distanceMeasure: 'COSINE',
      });

    const snapshot = await vectorQuery.get();

    // 3. Fetch articles and build results
    const articleIds = snapshot.docs
      .filter(doc => doc.id !== articleId)
      .slice(0, limit)
      .map(doc => doc.id);

    if (articleIds.length === 0) {
      return { results: [] };
    }

    const articlesSnapshot = await db.collection('articles')
      .where('__name__', 'in', articleIds)
      .get();

    const articlesMap = new Map(
      articlesSnapshot.docs.map(doc => [doc.id, doc.data()])
    );

    const results: SimilarProduct[] = [];

    for (const doc of snapshot.docs) {
      if (doc.id === articleId) continue;
      if (results.length >= limit) break;

      const article = articlesMap.get(doc.id);
      if (!article) continue;

      const result: SimilarProduct = {
        articleId: doc.id,
        title: article.title,
        price: article.price,
        imageUrl: article.images?.[0]?.url,
        brand: article.brand,
        condition: article.condition,
      };

      if (includeScore) {
        const distance = doc.get('__distance__') || 0;
        result.similarity = Math.round((1 - distance) * 100);
      }

      results.push(result);
    }

    return { results };
  }
);
```

---

## 4. Client Services

### 4.1 `services/visualSearchService.ts`

```typescript
import { httpsCallable } from '@react-native-firebase/functions';
import functions from '@react-native-firebase/functions';
import * as FileSystem from 'expo-file-system';

export interface VisualSearchResult {
  articleId: string;
  similarity: number;
  title: string;
  price: number;
  imageUrl: string;
  brand?: string;
  condition: string;
}

export interface VisualSearchFilters {
  categoryIds?: string[];
  priceRange?: 'low' | 'medium' | 'high';
}

class VisualSearchServiceClass {
  /**
   * Search for similar products using an image
   */
  async searchByImage(
    imageUri: string,
    filters?: VisualSearchFilters
  ): Promise<VisualSearchResult[]> {
    // Read image and convert to base64
    const base64 = await FileSystem.readAsStringAsync(imageUri, {
      encoding: FileSystem.EncodingType.Base64,
    });

    // Determine MIME type
    const mimeType = imageUri.toLowerCase().endsWith('.png')
      ? 'image/png'
      : 'image/jpeg';

    const visualSearchFn = httpsCallable<
      { imageBase64: string; mimeType: string; filters?: VisualSearchFilters; limit?: number },
      { results: VisualSearchResult[] }
    >(functions(), 'visualSearch');

    const response = await visualSearchFn({
      imageBase64: base64,
      mimeType,
      filters,
      limit: 20,
    });

    return response.data.results;
  }
}

export const VisualSearchService = new VisualSearchServiceClass();
```

### 4.2 `services/recommendationService.ts`

```typescript
import { httpsCallable } from '@react-native-firebase/functions';
import functions from '@react-native-firebase/functions';

export interface SimilarProduct {
  articleId: string;
  similarity?: number;
  title: string;
  price: number;
  imageUrl: string;
  brand?: string;
  condition: string;
}

class RecommendationServiceClass {
  /**
   * Get AI-powered similar products for an article
   */
  async getSimilarProducts(
    articleId: string,
    limit: number = 10,
    includeScore: boolean = false
  ): Promise<SimilarProduct[]> {
    const getSimilarFn = httpsCallable<
      { articleId: string; limit: number; includeScore: boolean },
      { results: SimilarProduct[]; fallback?: boolean }
    >(functions(), 'getSimilarProducts');

    const response = await getSimilarFn({
      articleId,
      limit,
      includeScore,
    });

    return response.data.results;
  }
}

export const RecommendationService = new RecommendationServiceClass();
```

---

## 5. Migration: Générer Embeddings pour Articles Existants

### 5.1 Script de Migration (One-time)

```typescript
// functions/src/migration/generateAllEmbeddings.ts

import { onRequest } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';

export const migrateEmbeddings = onRequest(
  {
    timeoutSeconds: 540, // 9 minutes
    memory: '1GiB',
  },
  async (req, res) => {
    // Protect with secret key
    if (req.query.key !== process.env.MIGRATION_KEY) {
      res.status(403).send('Forbidden');
      return;
    }

    const db = getFirestore();
    const batchSize = 50;
    let processed = 0;
    let lastDoc: FirebaseFirestore.DocumentSnapshot | null = null;

    while (true) {
      let query = db.collection('articles')
        .where('isActive', '==', true)
        .orderBy('createdAt')
        .limit(batchSize);

      if (lastDoc) {
        query = query.startAfter(lastDoc);
      }

      const snapshot = await query.get();

      if (snapshot.empty) break;

      // Check which articles already have embeddings
      const articleIds = snapshot.docs.map(d => d.id);
      const existingEmbeddings = await db.collection('embeddings')
        .where('__name__', 'in', articleIds)
        .get();

      const existingIds = new Set(existingEmbeddings.docs.map(d => d.id));

      // Process only articles without embeddings
      for (const doc of snapshot.docs) {
        if (!existingIds.has(doc.id)) {
          // Trigger will handle this, or call generateAndStoreEmbedding directly
          // For now, just log
          console.log(`Need to generate embedding for: ${doc.id}`);
          processed++;
        }
      }

      lastDoc = snapshot.docs[snapshot.docs.length - 1];

      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    res.send(`Migration complete. Processed ${processed} articles.`);
  }
);
```

---

## 6. Estimation des Coûts (Rappel)

| Phase | Calcul | Coût |
|-------|--------|------|
| Migration initiale (10k articles) | 10,000 × $0.0001 | **$1.00** (one-time) |
| Nouveaux articles (500/mois) | 500 × $0.0001 | **$0.05/mois** |
| Visual Search (30k/mois) | 30,000 × $0.0001 | **$3.00/mois** |
| Firestore Vector reads | ~180k reads | **~$0.50/mois** |
| **Total mensuel estimé** | | **~$3.55/mois** |

---

## 7. Séquence d'Implémentation

| Étape | Tâche | Dépendances |
|-------|-------|-------------|
| 1 | Créer index Firestore vector | - |
| 2 | Implémenter `generateEmbedding` trigger | Étape 1 |
| 3 | Exécuter migration articles existants | Étape 2 |
| 4 | Implémenter `getSimilarProducts` | Étape 2 |
| 5 | Mettre à jour `SimilarProducts.tsx` | Étape 4 |
| 6 | Implémenter `visualSearch` | Étape 2 |
| 7 | Créer `VisualSearchService` client | Étape 6 |
| 8 | Créer composants UI Visual Search | Étape 7 |
| 9 | Intégrer dans SearchOverlay | Étape 8 |

---

## 8. Tests

### 8.1 Tests Cloud Functions

```typescript
// Test getSimilarProducts
describe('getSimilarProducts', () => {
  it('returns similar products for valid articleId', async () => {
    const result = await getSimilarProducts({ articleId: 'test-123', limit: 5 });
    expect(result.results).toHaveLength(5);
    expect(result.results[0]).toHaveProperty('articleId');
    expect(result.results[0]).toHaveProperty('similarity');
  });

  it('returns empty array for non-existent article', async () => {
    const result = await getSimilarProducts({ articleId: 'non-existent' });
    expect(result.results).toHaveLength(0);
    expect(result.fallback).toBe(true);
  });
});
```

### 8.2 Tests Client

```typescript
// Test VisualSearchService
describe('VisualSearchService', () => {
  it('converts image to base64 and calls function', async () => {
    const mockUri = '/path/to/test.jpg';
    const results = await VisualSearchService.searchByImage(mockUri);
    expect(Array.isArray(results)).toBe(true);
  });
});
```

---

## 9. Monitoring & Alertes

| Métrique | Seuil alerte |
|----------|--------------|
| Latence `visualSearch` | > 5s |
| Latence `getSimilarProducts` | > 2s |
| Erreurs embedding generation | > 5% |
| Coût Vertex AI journalier | > $1 |

---

## 10. Rollback Plan

1. **Si Vertex AI échoue:** Fallback automatique vers recherche par catégorie (déjà implémenté dans `SimilarProducts.tsx`)
2. **Si coûts excessifs:** Feature flag pour désactiver Visual Search
3. **Si embeddings corrompus:** Re-générer depuis les images originales

---

*Document généré par Mary, Business Analyst - BMAD Framework*
