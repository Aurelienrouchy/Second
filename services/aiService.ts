/**
 * AI Service for Product Analysis
 * Uses Firebase Cloud Function to call Gemini API
 * Enhanced with image format support, progress callbacks, and better error handling
 */

import { functions, storage, auth } from '@/config/firebaseConfig';
import { httpsCallable } from '@react-native-firebase/functions';
import * as FileSystem from 'expo-file-system';
import * as ImageManipulator from 'expo-image-manipulator';
import { AI_CONFIG, getPhaseProgress } from '@/config/aiConfig';
import {
  AIAnalysisResult,
  AIAnalysisResponse,
  AIAnalysisOptions,
  AIErrorCode,
  AnalysisPhase,
  ProcessedImage,
  transformGeminiResponse,
  createConfidenceScore,
  createDetailedError,
  ConditionId,
} from '@/types/ai';

// Firebase Storage paths
const DRAFTS_STORAGE_PATH = 'drafts';

// Icon mapping for categories
const CATEGORY_ICONS: Record<string, string> = {
  women: '👩',
  men: '👨',
  kids: '👶',
  dresses: '👗',
  tops: '👚',
  shirts: '👔',
  pants: '👖',
  jeans: '👖',
  coats: '🧥',
  sweaters: '🧶',
  shoes: '👟',
  boots: '👢',
  bags: '👜',
  accessories: '💍',
  home: '🏠',
  entertainment: '🎮',
  pets: '🐾',
};

/**
 * Detect MIME type from file extension or URI
 */
function detectMimeType(uri: string): string {
  const extension = uri.split('.').pop()?.toLowerCase() || '';
  const mimeTypes: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    heic: 'image/heic',
    heif: 'image/heif',
  };
  return mimeTypes[extension] || 'image/jpeg';
}

/**
 * Check if format needs conversion (HEIC/HEIF)
 */
function needsConversion(mimeType: string): boolean {
  return mimeType === 'image/heic' || mimeType === 'image/heif';
}

/**
 * Get file info (size) for an image URI
 */
async function getFileInfo(uri: string): Promise<{ size: number; exists: boolean }> {
  try {
    const info = await FileSystem.getInfoAsync(uri);
    return {
      size: (info as any).size || 0,
      exists: info.exists,
    };
  } catch {
    return { size: 0, exists: false };
  }
}

/**
 * Compress image if needed
 */
async function compressImage(uri: string): Promise<string> {
  const result = await ImageManipulator.manipulateAsync(
    uri,
    [], // No transforms
    {
      compress: AI_CONFIG.image.compressionQuality,
      format: ImageManipulator.SaveFormat.JPEG,
    }
  );
  return result.uri;
}

/**
 * Convert HEIC/HEIF to JPEG
 */
async function convertToJpeg(uri: string): Promise<string> {
  const result = await ImageManipulator.manipulateAsync(
    uri,
    [], // No transforms
    {
      compress: AI_CONFIG.image.compressionQuality,
      format: ImageManipulator.SaveFormat.JPEG,
    }
  );
  return result.uri;
}

/**
 * Process image: detect format, convert if needed, compress if large
 * Returns processed image data with metadata
 */
async function processImage(uri: string): Promise<ProcessedImage> {
  const originalMimeType = detectMimeType(uri);
  const fileInfo = await getFileInfo(uri);

  let processedUri = uri;
  let wasConverted = false;
  let wasCompressed = false;
  let finalMimeType = originalMimeType;

  // Convert HEIC/HEIF to JPEG
  if (needsConversion(originalMimeType)) {
    console.log(`Converting ${originalMimeType} to JPEG...`);
    processedUri = await convertToJpeg(processedUri);
    wasConverted = true;
    finalMimeType = 'image/jpeg';
  }

  // Check size and compress if needed
  const currentInfo = await getFileInfo(processedUri);
  if (currentInfo.size > AI_CONFIG.image.targetSizeBytes) {
    console.log(`Compressing image from ${Math.round(currentInfo.size / 1024)}KB...`);
    processedUri = await compressImage(processedUri);
    wasCompressed = true;
    finalMimeType = 'image/jpeg';
  }

  // Validate final size
  const finalInfo = await getFileInfo(processedUri);
  if (finalInfo.size > AI_CONFIG.image.maxSizeBytes) {
    throw new Error('IMAGE_TOO_LARGE');
  }

  // Read as base64
  const base64 = await FileSystem.readAsStringAsync(processedUri, {
    encoding: FileSystem.EncodingType.Base64,
  });

  return {
    base64,
    mimeType: finalMimeType,
    originalFormat: originalMimeType,
    wasConverted,
    wasCompressed,
    originalSize: fileInfo.size,
    finalSize: finalInfo.size,
  };
}

/**
 * Fix Firebase Storage URL to ensure path is properly URL-encoded
 * React Native Firebase SDK sometimes returns URLs with un-encoded paths
 * which causes 400 errors when loading images
 */
function fixStorageUrl(url: string): string {
  try {
    // Parse the URL to extract the path
    const urlObj = new URL(url);

    // The path in Firebase Storage URLs is after /o/
    // e.g., /v0/b/bucket/o/drafts/draftId/file.jpg
    const pathMatch = urlObj.pathname.match(/\/o\/(.+)$/);
    if (!pathMatch) {
      return url; // Not a Firebase Storage URL format we recognize
    }

    const storagePath = pathMatch[1];

    // Check if already encoded (contains %2F)
    if (storagePath.includes('%2F')) {
      return url; // Already encoded
    }

    // Encode the path segments
    const encodedPath = storagePath
      .split('/')
      .map(segment => encodeURIComponent(segment))
      .join('%2F');

    // Reconstruct the URL
    const fixedUrl = url.replace(`/o/${storagePath}`, `/o/${encodedPath}`);
    console.log('[aiService] Fixed Storage URL encoding:', { original: url, fixed: fixedUrl });
    return fixedUrl;
  } catch (error) {
    console.warn('[aiService] Failed to fix Storage URL:', error);
    return url; // Return original if parsing fails
  }
}

/**
 * Upload a single image to Firebase Storage
 * Returns the download URL (properly URL-encoded)
 */
async function uploadImageToStorage(
  uri: string,
  draftId: string,
  index: number
): Promise<string> {
  const extension = uri.split('.').pop()?.split('?')[0] || 'jpg';
  const filename = `${draftId}_${index}_${Date.now()}.${extension}`;
  const storagePath = `${DRAFTS_STORAGE_PATH}/${draftId}/${filename}`;

  const reference = storage.ref(storagePath);

  // Upload the file
  await reference.putFile(uri);

  // Get the download URL
  const downloadUrl = await reference.getDownloadURL();

  // Fix URL encoding (React Native Firebase SDK sometimes returns un-encoded paths)
  const fixedUrl = fixStorageUrl(downloadUrl);

  return fixedUrl;
}

/**
 * Upload multiple images to Firebase Storage
 * Returns array of download URLs
 */
async function uploadImagesToStorage(
  uris: string[],
  draftId: string,
  onProgress?: (uploaded: number, total: number) => void
): Promise<string[]> {
  const urls: string[] = [];

  for (let i = 0; i < uris.length; i++) {
    const url = await uploadImageToStorage(uris[i], draftId, i);
    urls.push(url);
    onProgress?.(i + 1, uris.length);
  }

  return urls;
}

/**
 * Delete all images for a draft from Firebase Storage
 */
export async function deleteDraftImagesFromStorage(draftId: string): Promise<void> {
  try {
    const folderRef = storage.ref(`${DRAFTS_STORAGE_PATH}/${draftId}`);
    const listResult = await folderRef.listAll();

    // Delete all files in the folder
    await Promise.all(
      listResult.items.map(item => item.delete())
    );

    console.log(`[aiService] Deleted ${listResult.items.length} images for draft ${draftId}`);
  } catch (error: any) {
    // Ignore "object not found" errors (folder doesn't exist)
    if (error.code !== 'storage/object-not-found') {
      console.warn('[aiService] Failed to delete draft images:', error);
    }
  }
}

/**
 * Move draft images to articles folder (for publishing)
 * Returns new URLs in the articles folder
 */
export async function moveDraftImagesToArticles(
  storageUrls: string[],
  draftId: string,
  articleId: string
): Promise<string[]> {
  // For now, we'll keep images in draft folder and just reference them
  // A more complete solution would copy to articles folder and delete from drafts
  // But this adds complexity - for MVP, we just use the existing URLs
  console.log(`[aiService] Using draft images for article ${articleId}`);
  return storageUrls;
}

/**
 * Get icon for category based on categoryId
 */
function getCategoryIcon(categoryId: string): string {
  for (const [key, icon] of Object.entries(CATEGORY_ICONS)) {
    if (categoryId.includes(key)) {
      return icon;
    }
  }
  return '📦'; // Default icon
}

/**
 * Map Firebase error codes to our error codes
 */
function mapErrorCode(error: any): AIErrorCode {
  const code = error.code || '';
  const message = error.message || '';

  if (message === 'TIMEOUT' || code.includes('deadline')) {
    return 'TIMEOUT';
  }
  if (code.includes('unauthenticated')) {
    return 'UNAUTHENTICATED';
  }
  if (message.includes('network') || code.includes('network')) {
    return 'NETWORK_ERROR';
  }
  if (message.includes('IMAGE_TOO_LARGE')) {
    return 'IMAGE_TOO_LARGE';
  }
  if (message.includes('format') || message.includes('UNSUPPORTED')) {
    return 'UNSUPPORTED_FORMAT';
  }
  if (message.includes('parse') || message.includes('JSON')) {
    return 'PARSE_ERROR';
  }

  return 'API_ERROR';
}

/**
 * Analyze product images using Gemini AI
 * Sends all photos for better analysis (including label detection)
 * Returns structured data with constrained IDs for filtering
 */
export async function analyzeProductImage(imageUri: string): Promise<AIAnalysisResponse>;
export async function analyzeProductImage(imageUris: string[]): Promise<AIAnalysisResponse>;
export async function analyzeProductImage(
  input: string | string[],
  options?: AIAnalysisOptions
): Promise<AIAnalysisResponse>;
export async function analyzeProductImage(
  input: string | string[],
  options?: AIAnalysisOptions
): Promise<AIAnalysisResponse> {
  const startTime = Date.now();
  const { onProgress, onPhaseChange, signal, draftId } = options || {};

  // Generate a temporary draft ID if not provided
  const effectiveDraftId = draftId || `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  // Helper to update progress
  const updatePhase = (phase: AnalysisPhase) => {
    const phaseConfig = AI_CONFIG.phases[phase];
    onPhaseChange?.(phase, phaseConfig.message);
    onProgress?.(getPhaseProgress(phase));
  };

  // Track uploaded URLs for cleanup on error
  let uploadedStorageUrls: string[] = [];

  try {
    // Check for cancellation
    if (signal?.aborted) {
      throw new Error('Cancelled');
    }

    // Normalize to array
    const imageUris = Array.isArray(input) ? input : [input];

    // Validate image count
    if (imageUris.length === 0) {
      return {
        success: false,
        error: createDetailedError('INVALID_IMAGE', 'Aucune image fournie'),
      };
    }

    if (imageUris.length > AI_CONFIG.image.maxImages) {
      return {
        success: false,
        error: createDetailedError(
          'INVALID_IMAGE',
          `Maximum ${AI_CONFIG.image.maxImages} images autorisées`
        ),
      };
    }

    // Phase 1: Upload (image processing + Storage upload)
    updatePhase('upload');

    // Process all images (convert, compress, validate)
    const processedImages: ProcessedImage[] = [];
    const processedUris: string[] = [];

    for (const uri of imageUris) {
      if (signal?.aborted) throw new Error('Cancelled');

      try {
        const processed = await processImage(uri);
        processedImages.push(processed);

        // Get the processed URI for Storage upload
        // We need to reconstruct it from the original or use a temp file
        processedUris.push(uri); // For now use original, compression is done in processImage
      } catch (error: any) {
        const errorCode = error.message as AIErrorCode;
        if (['IMAGE_TOO_LARGE', 'UNSUPPORTED_FORMAT', 'INVALID_IMAGE'].includes(errorCode)) {
          return {
            success: false,
            error: createDetailedError(errorCode),
          };
        }
        throw error;
      }
    }

    // Verify user is authenticated before uploading
    if (!auth.currentUser) {
      console.error('[aiService] User not authenticated - cannot upload to Storage');
      return {
        success: false,
        error: createDetailedError('AUTH_REQUIRED', 'Veuillez vous connecter pour analyser des images'),
      };
    }

    // Upload images to Firebase Storage
    console.log(`[aiService] Uploading ${imageUris.length} image(s) to Storage... (user: ${auth.currentUser.uid})`);
    try {
      uploadedStorageUrls = await uploadImagesToStorage(
        imageUris, // Use original URIs (they work with putFile)
        effectiveDraftId,
        (uploaded, total) => {
          // Update progress during upload phase (0-30%)
          const uploadProgress = (uploaded / total) * 30;
          onProgress?.(Math.round(uploadProgress));
        }
      );
      console.log(`[aiService] Uploaded to Storage:`, {
        count: uploadedStorageUrls.length,
        urls: uploadedStorageUrls,
      });
    } catch (error: any) {
      console.error('[aiService] Storage upload failed:', error);
      return {
        success: false,
        error: createDetailedError('NETWORK_ERROR', 'Échec de l\'upload des images'),
      };
    }

    // Prepare images for API (base64 for LLM analysis)
    const images = processedImages.map((img) => ({
      base64: img.base64,
      mimeType: img.mimeType,
    }));

    console.log(`[aiService] Sending ${images.length} image(s) for AI analysis`);

    // Phase 2: Category detection
    updatePhase('category');

    // Create timeout promise
    const timeoutPromise = new Promise<never>((_, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error('TIMEOUT'));
      }, AI_CONFIG.timeouts.client);

      // Clean up timeout if signal is aborted
      signal?.addEventListener('abort', () => {
        clearTimeout(timeoutId);
        reject(new Error('Cancelled'));
      });
    });

    // Phase 3: Analysis
    updatePhase('analysis');

    // Call Firebase Cloud Function
    const analyzeFunction = httpsCallable(functions, 'analyzeProductImage');
    const callPromise = analyzeFunction({ images });

    // Race between call and timeout
    const response = (await Promise.race([callPromise, timeoutPromise])) as any;

    // Check for cancellation after API call
    if (signal?.aborted) throw new Error('Cancelled');

    if (response.data?.error) {
      return {
        success: false,
        error: createDetailedError('API_ERROR', response.data.error),
      };
    }

    // Phase 4: Brand matching (done on server, just update UI)
    updatePhase('brand');

    // Phase 5: Validation
    updatePhase('validation');

    // Transform the response
    const result = transformGeminiResponse(response.data);

    // Add icon if not present
    if (!result.category.icon && result.category.categoryId) {
      result.category.icon = getCategoryIcon(result.category.categoryId);
    }

    // Add metadata
    result.analyzedAt = new Date();
    result.processingTimeMs = Date.now() - startTime;

    // Final progress update
    onProgress?.(100);

    return {
      success: true,
      result,
      storageUrls: uploadedStorageUrls, // Return Storage URLs for draft/article
    };
  } catch (error: any) {
    console.error('AI analysis error:', error);

    // Cleanup uploaded images on error (unless cancelled by user)
    if (uploadedStorageUrls.length > 0 && error.message !== 'Cancelled') {
      console.log('[aiService] Cleaning up uploaded images after error...');
      deleteDraftImagesFromStorage(effectiveDraftId).catch(console.warn);
    }

    // Handle cancellation
    if (error.message === 'Cancelled' || signal?.aborted) {
      // User cancelled - keep images if they want to retry
      return {
        success: false,
        error: createDetailedError('API_ERROR', 'Analyse annulée'),
        storageUrls: uploadedStorageUrls, // Keep URLs so user can retry without re-upload
      };
    }

    const errorCode = mapErrorCode(error);
    return {
      success: false,
      error: createDetailedError(errorCode, error.message),
    };
  }
}

/**
 * Create a mock AI result for testing/fallback
 */
export function createMockAIResult(): AIAnalysisResult {
  return {
    title: '',
    titleConfidence: 0,

    description: '',
    descriptionConfidence: 0,

    category: {
      categoryId: '',
      categoryPath: [],
      displayName: '',
      fullLabel: '',
      icon: '📦',
      confidence: createConfidenceScore(0),
    },

    condition: {
      conditionId: 'bon-etat' as ConditionId,
      confidence: createConfidenceScore(0.5),
    },

    colors: {
      colorIds: [],
      primaryColorId: '',
      confidence: createConfidenceScore(0),
    },

    materials: {
      materialIds: [],
      primaryMaterialId: '',
      confidence: createConfidenceScore(0),
    },

    size: {
      detected: null,
      normalized: null,
      confidence: createConfidenceScore(0),
    },

    brand: {
      detected: null,
      confidence: createConfidenceScore(0),
      matchType: 'none',
      suggestions: [],
    },

    packageSize: {
      suggested: 'medium',
      confidence: createConfidenceScore(0.5),
    },

    labelFound: false,
    analyzedAt: new Date(),
    processingTimeMs: 0,
  };
}
