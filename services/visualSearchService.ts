/**
 * Visual Search Service
 * Client service for searching products by image using Vertex AI embeddings
 */

import { functions } from '@/config/firebaseConfig';
import { httpsCallable } from '@react-native-firebase/functions';
import * as FileSystem from 'expo-file-system';
import * as ImageManipulator from 'expo-image-manipulator';
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

const MAX_IMAGE_SIZE = 4 * 1024 * 1024; // 4MB max for Vertex AI
const TARGET_IMAGE_SIZE = 1 * 1024 * 1024; // 1MB target

/**
 * Detect MIME type from URI extension
 */
function detectMimeType(uri: string): string {
  const extension = uri.split('.').pop()?.toLowerCase()?.split('?')[0] || '';
  if (extension === 'png') return 'image/png';
  return 'image/jpeg';
}

/**
 * Process image for visual search: compress and convert to base64
 */
async function processImageForSearch(uri: string): Promise<{ base64: string; mimeType: string }> {
  let processedUri = uri;
  const mimeType = detectMimeType(uri);

  // Convert HEIC/HEIF and compress
  const needsConversion = mimeType === 'image/heic' || mimeType === 'image/heif';
  const fileInfo = await FileSystem.getInfoAsync(uri);
  const fileSize = (fileInfo as any).size || 0;

  if (needsConversion || fileSize > TARGET_IMAGE_SIZE) {
    const result = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: 1024 } }], // Resize to reasonable dimension
      { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG }
    );
    processedUri = result.uri;
  }

  // Validate final size
  const finalInfo = await FileSystem.getInfoAsync(processedUri);
  const finalSize = (finalInfo as any).size || 0;
  if (finalSize > MAX_IMAGE_SIZE) {
    // Extra compression pass
    const result = await ImageManipulator.manipulateAsync(
      processedUri,
      [{ resize: { width: 768 } }],
      { compress: 0.6, format: ImageManipulator.SaveFormat.JPEG }
    );
    processedUri = result.uri;
  }

  const base64 = await FileSystem.readAsStringAsync(processedUri, {
    encoding: FileSystem.EncodingType.Base64,
  });

  return { base64, mimeType: 'image/jpeg' };
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
  limit: number = 20
): Promise<VisualSearchResult[]> {
  // Process image to base64
  const { base64, mimeType } = await processImageForSearch(imageUri);

  // Call Cloud Function
  const visualSearchFn = httpsCallable<
    { imageBase64: string; mimeType: string; filters?: VisualSearchFilters; limit: number },
    VisualSearchResponse
  >(functions, 'visualSearch');

  const response = await visualSearchFn({
    imageBase64: base64,
    mimeType,
    filters,
    limit,
  });

  // Fix Firebase Storage URLs that may have un-encoded paths
  return response.data.results.map(result => ({
    ...result,
    imageUrl: ArticlesService.fixStorageUrl(result.imageUrl),
  }));
}
