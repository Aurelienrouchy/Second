/**
 * Visual Search Service
 * Client service for searching products by image using Vertex AI embeddings
 */

import { auth, functions } from '@/config/firebaseConfig';
import { httpsCallable } from 'firebase/functions';
import * as FileSystem from 'expo-file-system/legacy';
import { prepareImageForUpload } from '@/utils/imageUtils';
import { getAuthSessionGeneration, useAuthStore } from '@/store/authStore';
import { staleTradeOperation } from '@/services/tradeOperation';
import { ArticlesService } from '@/services/articlesService';

// ============================================================
// Types
// ============================================================

export interface VisualSearchResult {
  articleId: string;
  similarity: number;
  title: string;
  price: number;
  imageUrl: string;
  brand?: string;
  size?: string;
  condition: string;
}

export interface VisualSearchFilters {
  categoryIds?: string[];
  priceRange?: 'low' | 'medium' | 'high';
  excludeArticleId?: string;
}

export interface VisualSearchResponse {
  results: VisualSearchResult[];
  queryEmbeddingGenerated?: boolean;
}

// ============================================================
// Image Processing
// ============================================================

const MAX_IMAGE_SIZE = 4 * 1024 * 1024;

/** Photo-picker/camera sources only: never fetch a remote URL supplied by a deep link. */
export function isVisualSearchImageUri(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 8192 && value.trim() === value &&
    !/[\u0000-\u0020\u007f]/.test(value) && /^(?:file:\/\/\/|content:\/\/|ph:\/\/|blob:)[^?#]+$/.test(value);
}

/** Guests are valid owners of an operation too; a later login invalidates their work. */
export function captureVisualSearchOwner(): () => void {
  const owner = auth.currentUser;
  const uid = owner?.uid ?? null;
  const generation = getAuthSessionGeneration();
  const assertCurrent = () => {
    if (auth.currentUser !== owner || (auth.currentUser?.uid ?? null) !== uid ||
        useAuthStore.getState().authenticatedUid !== uid || getAuthSessionGeneration() !== generation) {
      throw staleTradeOperation();
    }
  };
  assertCurrent();
  return assertCurrent;
}

async function processImageForSearch(uri: string, assertCurrent: () => void): Promise<string> {
  assertCurrent();
  if (!isVisualSearchImageUri(uri)) throw Object.assign(new Error('Photo locale invalide.'), {code: 'invalid-argument'});
  // Always strip the original metadata and encode a bounded JPEG, including small HEIC files.
  const processedUri = await prepareImageForUpload(uri);
  assertCurrent();
  const finalInfo = await FileSystem.getInfoAsync(processedUri);
  assertCurrent();
  if (!finalInfo.exists || finalInfo.isDirectory || !Number.isFinite(finalInfo.size) || finalInfo.size <= 0 || finalInfo.size > MAX_IMAGE_SIZE) {
    throw Object.assign(new Error('Photo trop volumineuse ou indisponible.'), {code: 'invalid-argument'});
  }
  const base64 = await FileSystem.readAsStringAsync(processedUri, {encoding: FileSystem.EncodingType.Base64});
  assertCurrent();
  if (!base64 || base64.length > Math.ceil(MAX_IMAGE_SIZE / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    throw Object.assign(new Error('Photo invalide.'), {code: 'invalid-argument'});
  }
  return base64;
}

// ============================================================
// Service
// ============================================================

/**
 * Search for similar products using an image
 *
 * @param imageUri - Local file URI of the image to search with
 * @param filters - Optional filters (category, price range)
 * @param limit - Max results to return (default 20)
 * @returns Array of visually similar products with similarity scores
 */
export async function searchByImage(
  imageUri: string,
  filters?: VisualSearchFilters,
  limit: number = 20,
  options?: {assertCurrent?: () => void}
): Promise<VisualSearchResult[]> {
  const assertOwner = captureVisualSearchOwner();
  const assertCurrent = () => {assertOwner(); options?.assertCurrent?.();};
  assertCurrent();
  const owner = auth.currentUser;
  // A refresh failure keeps the existing guest-compatible server contract, but never
  // swallows a session/focus change or substitutes the newly signed-in person's token.
  if (owner) {
    try {await owner.getIdToken(true);}
    catch {if (__DEV__) console.warn('[visualSearch] Token refresh failed');}
    assertCurrent();
  }
  const base64 = await processImageForSearch(imageUri, assertCurrent);
  assertCurrent();

  // Call Cloud Function — backend reads { imageBase64, filters, limit } only.
  const visualSearchFn = httpsCallable<
    { imageBase64: string; filters?: VisualSearchFilters; limit: number },
    VisualSearchResponse
  >(functions, 'visualSearch');

  assertCurrent();
  const response = await visualSearchFn({
    imageBase64: base64,
    filters,
    limit,
  });

  assertCurrent();

  // Fix Firebase Storage URLs that may have un-encoded paths
  return response.data.results.map(result => ({
    ...result,
    imageUrl: ArticlesService.fixStorageUrl(result.imageUrl),
  }));
}
