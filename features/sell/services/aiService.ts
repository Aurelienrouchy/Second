/**
 * AI Service for Product Analysis
 * Uses Firebase Cloud Function to call Gemini API
 * Enhanced with image format support, progress callbacks, and better error handling
 */

import { functions, storage, auth } from '@/config/firebaseConfig';
import { httpsCallable } from 'firebase/functions';
import * as FileSystem from 'expo-file-system/legacy';
import { AI_CONFIG, getPhaseProgress } from '@/config/aiConfig';
import { randomUUID } from 'expo-crypto';
import { uploadPreparedJpeg } from '@/services/nativeStorageUpload';
import { captureTradeSession, assertTradeSessionCurrent, staleTradeOperation } from '@/services/tradeOperation';
import { privateMediaUrl } from '@/utils/privateMedia';
import { prepareImageForUpload } from '@/utils/imageUtils';
import { getCallableErrorCode } from '@/utils/callableError';
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

// Cadence de la progression simulée pendant l'attente du serveur, et nombre de
// pas qui la rapprochent de la phase suivante (pas décroissants).
const ANALYSIS_TICK_MS = 1_500;
const ANALYSIS_TICK_STEPS = 6;

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
 * Normalize image: resize to a bounded dimension + re-encode as JPEG.
 * Always applied so the bytes sent to analysis (base64) stay bounded even for
 * high-res camera photos. Passe par le point d'entrée unique de compression du
 * dépôt, avec le profil de l'analyse (plus fidèle) au lieu de celui d'affichage.
 */
async function normalizeImage(uri: string): Promise<string> {
  return prepareImageForUpload(uri, {
    maxDimension: AI_CONFIG.image.maxDimension,
    quality: AI_CONFIG.image.compressionQuality,
  });
}

/**
 * Normalise une photo : deux rendus JPEG (analyse et stockage), après
 * contrôle d'existence et de taille.
 */
async function processImage(uri: string): Promise<ProcessedImage> {
  const fileInfo = await getFileInfo(uri);

  // Photo disparue entre la sélection et l'analyse : sans ce garde, l'appel
  // payant partait quand même et l'échec ressortait en « Erreur serveur ».
  if (!fileInfo.exists) throw new Error('INVALID_IMAGE');

  // Deux rendus distincts : le modèle a besoin des 1600 px pour lire l'étiquette
  // (marque, taille), tandis que le fichier conservé — celui que l'acheteur
  // verra — passe par le point d'entrée unique de compression du dépôt.
  const analysisUri = await normalizeImage(uri);
  const processedUri = await prepareImageForUpload(uri);
  const finalMimeType = 'image/jpeg';

  // Validate final size
  const finalInfo = await getFileInfo(analysisUri);
  if (finalInfo.size > AI_CONFIG.image.maxSizeBytes) {
    throw new Error('IMAGE_TOO_LARGE');
  }

  // Read as base64
  const base64 = await FileSystem.readAsStringAsync(analysisUri, {
    encoding: FileSystem.EncodingType.Base64,
  });

  return {
    base64,
    mimeType: finalMimeType,
    processedUri,
  };
}

// fixStorageUrl moved to @/utils/fixStorageUrl.

/** Metadata is supplied at creation; a retained original is never patched. */
async function uploadImageToStorage(
  image: ProcessedImage,
  draftId: string,
  index: number,
  ownerUid: string,
  signal?: AbortSignal,
): Promise<string> {
  const user = auth.currentUser;
  const session = captureTradeSession(ownerUid);
  const current = () => {
    assertTradeSessionCurrent(session);
    if (auth.currentUser !== user) throw staleTradeOperation();
    if (signal?.aborted) throw new Error('Cancelled');
  };
  current();
  if (image.mimeType !== 'image/jpeg') throw new Error('Une photo JPEG préparée est nécessaire.');
  const bucket = storage.app.options.storageBucket;
  if (!bucket) throw new Error('Storage bucket not configured');
  const filename = `${draftId}_${index}_${randomUUID()}.jpg`;
  const storagePath = `${DRAFTS_STORAGE_PATH}/${ownerUid}/${draftId}/${filename}`;
  const canonicalUrl = privateMediaUrl(bucket, storagePath);
  await uploadPreparedJpeg({ownerUid, path: storagePath, localUri: image.processedUri, assertContext: current});
  current();
  return canonicalUrl;
}

/**
 * Retain each uploaded URL as it lands. Stored originals are immutable,
 * including after a failed analysis. Stop before the next upload on cancellation.
 */
async function uploadImagesToStorage(
  images: ProcessedImage[],
  draftId: string,
  uploadedUrls: string[],
  ownerUid: string,
  onProgress?: (uploaded: number, total: number) => void,
  signal?: AbortSignal
): Promise<void> {
  for (let i = 0; i < images.length; i++) {
    if (signal?.aborted) throw new Error('Cancelled');
    const url = await uploadImageToStorage(images[i], draftId, i, ownerUid, signal);
    uploadedUrls.push(url);
    onProgress?.(i + 1, images.length);
  }
}

/**
 * Compatibility contract for local draft discard. Storage originals are
 * immutable and no remote purge is currently performed or scheduled.
 * Always return false: removing the local draft does not confirm remote erasure.
 */
export function deleteDraftImagesFromStorage(_draftId: string, _ownerUid?: string): Promise<boolean> {
  return Promise.resolve(false);
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

  if (code.includes('resource-exhausted')) {
    return 'QUOTA_EXCEEDED';
  }
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
export async function analyzeProductImage(
  imageUris: string[],
  options?: AIAnalysisOptions
): Promise<AIAnalysisResponse> {
  const startTime = Date.now();
  const ownerUid = auth.currentUser?.uid;
  const assertOwner = () => { if (!ownerUid || auth.currentUser?.uid !== ownerUid) throw new Error('Account changed during analysis'); };
  const { onProgress, onPhaseChange, signal, draftId } = options || {};

  // Generate a temporary draft ID if not provided
  const effectiveDraftId = draftId || `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  // Helper to update progress
  const updatePhase = (phase: AnalysisPhase) => {
    const phaseConfig = AI_CONFIG.phases[phase];
    onPhaseChange?.(phase, phaseConfig.message);
    onProgress?.(getPhaseProgress(phase));
  };

  const uploadedStorageUrls: string[] = [];

  try {
    // Check for cancellation
    if (signal?.aborted) {
      throw new Error('Cancelled');
    }

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

    for (const uri of imageUris) {
      if (signal?.aborted) throw new Error('Cancelled');

      try {
        const processed = await processImage(uri);
        processedImages.push(processed);
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
      if (__DEV__) console.error('[aiService] User not authenticated - cannot upload to Storage');
      return {
        success: false,
        error: createDetailedError('UNAUTHENTICATED', 'Veuillez vous connecter pour analyser des images'),
      };
    }

    assertOwner();
    // Upload images to Firebase Storage
    if (__DEV__) console.log(`[aiService] Uploading ${imageUris.length} image(s) to Storage... (user: ${auth.currentUser.uid})`);
    try {
      await uploadImagesToStorage(
        processedImages,
        effectiveDraftId,
        uploadedStorageUrls,
        ownerUid!,
        (done, total) => {
          // L'envoi converge vers la valeur de la phase suivante : il la
          // dépassait (30 %), et la barre reculait ensuite à 28 %.
          const floor = getPhaseProgress('upload');
          const ceiling = getPhaseProgress('category');
          onProgress?.(Math.round(floor + (done / total) * (ceiling - floor)));
        },
        signal
      );
      if (__DEV__) console.log(`[aiService] Uploaded to Storage:`, {
        count: uploadedStorageUrls.length,

      });
    } catch (error: any) {
      // An abandon is handled by the outer catch, which keeps the images.
      if (error?.message === 'Cancelled') throw error;
      if (__DEV__) console.error('[aiService] Storage upload failed:', error);
      return {
        success: false,
        error: createDetailedError('NETWORK_ERROR', 'Échec de l\'upload des images'),
      };
    }

    assertOwner();
    if (signal?.aborted) throw new Error('Cancelled');
    // Prepare images for API (base64 for LLM analysis)
    const images = processedImages.map((img) => ({
      base64: img.base64,
      mimeType: img.mimeType,
    }));

    if (__DEV__) console.log(`[aiService] Sending ${images.length} image(s) for AI analysis`);

    // Phase 2: Category detection
    updatePhase('category');

    // Phase 3: Analysis
    updatePhase('analysis');

    // The screen may have been left during the upload: don't start the paid call.
    // Contrôlé AVANT d'armer le minuteur : armé plus haut, il survivait à
    // l'abandon et rejetait dans le vide 130 s plus tard.
    if (signal?.aborted) throw new Error('Cancelled');

    // Create timeout promise. We keep the timer id around so it can be cleared
    // once the race settles — otherwise the timer survives a successful call and
    // fires (harmlessly) ~90s later, leaking a pending timer until then.
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error('TIMEOUT'));
      }, AI_CONFIG.timeouts.client);

      // Clean up timeout if signal is aborted
      signal?.addEventListener('abort', () => {
        clearTimeout(timeoutId);
        reject(new Error('Cancelled'));
      });
    });

    // Call Firebase Cloud Function. Without an explicit timeout the SDK gives
    // up at 70 s, while the server may work for 120 s.
    const analyzeFunction = httpsCallable(functions, 'analyzeProductImage', {
      timeout: AI_CONFIG.timeouts.client,
    });
    const callPromise = analyzeFunction({ images });

    // La barre se figeait sur la valeur de « analyse » pendant toute l'attente
    // réelle. Elle avance désormais par pas décroissants vers la phase suivante,
    // qu'elle n'atteint jamais : aucun recul possible à la reprise.
    const analysisCeiling = getPhaseProgress('brand');
    let simulated = getPhaseProgress('analysis');
    const ticker = onProgress
      ? setInterval(() => {
          simulated += (analysisCeiling - simulated) / ANALYSIS_TICK_STEPS;
          onProgress?.(Math.round(simulated));
        }, ANALYSIS_TICK_MS)
      : undefined;

    // Race between call and timeout
    let response: any;
    try {
      response = await Promise.race([callPromise, timeoutPromise]);
    } finally {
      // Always clear the timer once the race settles (success, timeout or error).
      clearTimeout(timeoutId);
      if (ticker) clearInterval(ticker);
    }

    assertOwner();
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
    if (__DEV__) console.error('AI analysis error:', error);

    // Handle cancellation
    if (error.message === 'Cancelled' || signal?.aborted) {
      // User cancelled - keep images if they want to retry
      return {
        success: false,
        error: createDetailedError('API_ERROR', 'Analyse annulée'),
        storageUrls: uploadedStorageUrls, // Keep URLs so user can retry without re-upload
      };
    }

    // The server's message is shown when it authored one, in French, for the
    // codes where it carries the actual cause. Otherwise — raw SDK codes such
    // as « deadline-exceeded », our own « TIMEOUT » — the code's default copy.
    const errorCode = mapErrorCode(error);
    const serverAuthored = ['invalid-argument', 'failed-precondition', 'resource-exhausted', 'unavailable']
      .includes(getCallableErrorCode(error) ?? '');
    return {
      success: false,
      error: createDetailedError(errorCode, serverAuthored ? error.message : undefined),
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
      // A default, not a detection: no « IA » indicator on it.
      confidence: createConfidenceScore(0),
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
