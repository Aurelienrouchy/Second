/**
 * AI callable functions
 * Firebase Functions v7 - using onCall
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import {
  getGenAI,
  GEMINI_FLASH_MODEL,
  generateSingleStepAnalysisPrompt,
  validateAndNormalizeResponse,
  retryWithBackoff,
  estimateTokens,
} from '../services/ai';
import { loadBrands } from '../services/brands';
import { brandDisplay } from '../utils/normalizeBrand';
import { parseModelJson } from '../utils/modelJson';
import { kidsBranchFromGenre, topLevelFromGenre } from '../utils/genre';
import { db, FieldValue } from '../config/firebase';
import * as logger from 'firebase-functions/logger';
import { assertPrivateAccountSession, withPrivateAccountSession } from '../utils/privateAccountSession';

interface ImageData {
  base64: string;
  mimeType: string;
}

// Rate limiting constants
const RATE_LIMIT_MAX_CALLS = 10;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

/** Photos par analyse : la limite du produit. */
const MAX_IMAGES = 5;
/** Plafond anti-abus du poids total reçu, encodé en base64. */
const MAX_TOTAL_BASE64_CHARS = 20 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

function rateLimitRef(userId: string) {
  return db.collection('rate_limits').doc(`${userId}_analyzeProduct`);
}

function millis(value: unknown): number {
  if (typeof value === 'number') return value;
  if (value instanceof Date) return value.getTime();
  const ts = value as { toMillis?: () => number } | null | undefined;
  return typeof ts?.toMillis === 'function' ? ts.toMillis() : 0;
}

/**
 * Horodatages (ms) des analyses débitées dans l'heure glissante. Une tranche
 * fixe rouvrait dix analyses d'un coup à son expiration : vingt en quelques
 * minutes, à cheval sur la frontière. Un document à l'ancien format (`count`,
 * `windowStartedAt`) reste compté jusqu'à la fin de sa tranche.
 */
function recentCalls(data: FirebaseFirestore.DocumentData | undefined, now: number): number[] {
  if (!data) return [];
  const since = now - RATE_LIMIT_WINDOW_MS;
  if (Array.isArray(data.calls)) {
    return data.calls.filter((t: unknown): t is number => typeof t === 'number' && t > since);
  }
  const started = millis(data.windowStartedAt);
  return started > since ? Array<number>(data.count ?? 0).fill(started) : [];
}

/**
 * Refuse, sans rien débiter, un compte dont la fenêtre horaire est pleine.
 *
 * Le quota était débité AVANT tout travail : une panne du modèle, une charge
 * invalide ou une réponse illisible coûtaient une analyse à l'utilisateur, qui
 * pouvait se retrouver bloqué une heure sans avoir rien obtenu. Il se débite
 * désormais après une analyse réussie (`consumeRateLimit`). Le pré-contrôle
 * n'étant plus atomique, une rafale simultanée du même compte peut dépasser
 * d'une ou deux unités — acceptable pour un garde-fou anti-abus.
 */
async function assertUnderRateLimit(userId: string): Promise<void> {
  const snap = await rateLimitRef(userId).get();
  if (recentCalls(snap.data(), Date.now()).length >= RATE_LIMIT_MAX_CALLS) {
    throw new HttpsError(
      'resource-exhausted',
      `Limite atteinte : maximum ${RATE_LIMIT_MAX_CALLS} analyses par heure. Réessayez plus tard.`
    );
  }
}

/** Débite une analyse réussie. Une panne de quota reste tolérée ; un refus
 * de la session actuelle doit toujours interrompre la réponse privée. */
async function consumeRateLimit(
  userId: string,
  request: Parameters<typeof assertPrivateAccountSession>[0]
): Promise<void> {
  const ref = rateLimitRef(userId);
  try {
    await db.runTransaction(async (tx) => {
      await assertPrivateAccountSession(request, tx);
      const snap = await tx.get(ref);
      await assertPrivateAccountSession(request, tx);
      const now = Date.now();
      const calls = [...recentCalls(snap.data(), now), now].slice(-RATE_LIMIT_MAX_CALLS);
      tx.set(ref, { userId, calls, updatedAt: FieldValue.serverTimestamp() });
    });
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    await assertPrivateAccountSession(request);
    logger.error('Rate limit consumption failed', { userId, error });
  }
}

/**
 * Photos reçues, validées AVANT tout débit et tout appel au modèle : 1 à 5,
 * des images, non vides, sous un plafond de poids. Rien n'était borné — un
 * client pouvait faire facturer à la plateforme l'analyse de n'importe quel
 * fichier, en n'importe quel nombre.
 */
function readImages(data: unknown): ImageData[] {
  const { imageBase64, mimeType, images } = (data ?? {}) as {
    imageBase64?: unknown;
    mimeType?: unknown;
    images?: unknown;
  };

  let raw: unknown[] = [];
  if (Array.isArray(images)) {
    raw = images;
  } else if (imageBase64 && mimeType) {
    // Legacy format: single image
    raw = [{ base64: imageBase64, mimeType }];
  }

  if (raw.length === 0) {
    throw new HttpsError('invalid-argument', 'Au moins une photo est requise.');
  }
  if (raw.length > MAX_IMAGES) {
    throw new HttpsError('invalid-argument', `Maximum ${MAX_IMAGES} photos par analyse.`);
  }

  const parsed = raw.map((img) => {
    const { base64, mimeType: type } = (img ?? {}) as { base64?: unknown; mimeType?: unknown };
    const resolvedType = typeof type === 'string' && type ? type : 'image/jpeg';
    if (typeof base64 !== 'string' || base64.length === 0) {
      throw new HttpsError('invalid-argument', 'Photo invalide.');
    }
    if (!ALLOWED_MIME_TYPES.has(resolvedType)) {
      throw new HttpsError('invalid-argument', 'Format de photo non pris en charge.');
    }
    return { base64, mimeType: resolvedType };
  });

  const total = parsed.reduce((sum, img) => sum + img.base64.length, 0);
  if (total > MAX_TOTAL_BASE64_CHARS) {
    throw new HttpsError('invalid-argument', 'Photos trop volumineuses.');
  }
  return parsed;
}

/** Motifs de fin qui signalent un refus du filtre de sécurité du modèle. */
const SAFETY_FINISH_REASONS = new Set([
  'SAFETY',
  'PROHIBITED_CONTENT',
  'IMAGE_SAFETY',
  'BLOCKLIST',
  'SPII',
]);

/**
 * Analyze product image(s) with AI
 * Returns structured product data for the sell flow
 */
export const analyzeProductImage = onCall(
  {
    region: 'northamerica-northeast1',
    memory: '512MiB',
    timeoutSeconds: 120,
    minInstances: 0,
    secrets: ['GEMINI_API_KEY'],
  },
  async (request) => withPrivateAccountSession(request, async () => {
    const totalStartTime = Date.now();
    const timings: Record<string, number> = {};
    const tokenCounts: Record<string, number> = {};

    // Verify authentication
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Vous devez être connecté.');
    }
    const uid = request.auth.uid;

    // Validate first: a rejected payload must cost neither a model call nor quota.
    const imageDataArray = readImages(request.data);

    // Rate limiting: max 10 successful analyses per hour per user
    await assertUnderRateLimit(uid);
    await assertPrivateAccountSession(request);

    // Calculate image stats
    const imageSizes = imageDataArray.map((img) => img.base64.length);
    const totalImageBytes = imageSizes.reduce((a, b) => a + b, 0);
    const imageTokens = imageDataArray.reduce(
      (sum, img) => sum + estimateTokens(img.base64, true),
      0
    );

    console.log('='.repeat(60));
    console.log('🔍 ANALYSIS START (SINGLE-STEP OPTIMIZED)');
    console.log('='.repeat(60));
    console.log(`📸 Images: ${imageDataArray.length}`);
    console.log(
      `📏 Image sizes: ${imageSizes.map((s) => `${Math.round(s / 1024)}KB`).join(', ')}`
    );
    console.log(`📊 Total image data: ${Math.round(totalImageBytes / 1024)}KB`);
    console.log(`🎯 Estimated image tokens: ~${imageTokens.toLocaleString()}`);
    tokenCounts['images'] = imageTokens;

    const ai = getGenAI();
    if (!ai) {
      console.error('Gemini API key not configured');
      throw new HttpsError('failed-precondition', "Le service d'analyse est indisponible.");
    }

    try {
      // Helper to build image parts for Gemini (new SDK format)
      const buildImageParts = () =>
        imageDataArray.map((imgData) => ({
          inlineData: {
            mimeType: imgData.mimeType,
            data: imgData.base64,
          },
        }));

      // ========================================
      // SINGLE-STEP ANALYSIS (Ultra-compact prompt)
      // ========================================
      console.log('-'.repeat(40));
      console.log('📍 SINGLE-STEP: Full analysis with compact categories');
      const analysisStartTime = Date.now();

      const analysisPrompt = generateSingleStepAnalysisPrompt();
      const promptTokens = estimateTokens(analysisPrompt);
      tokenCounts['prompt'] = promptTokens;
      console.log(`   Prompt tokens: ~${promptTokens} (was ~37K with old 2-step!)`);
      console.log(
        `   Total tokens: ~${(promptTokens + imageTokens).toLocaleString()}`
      );

      // Build contents array for new SDK (text first, then images)
      const contents = [{ text: analysisPrompt }, ...buildImageParts()];

      // Start brand preloading in parallel
      const brandsPreloadStart = Date.now();
      const brandsPreloadPromise = loadBrands();

      const apiStart = Date.now();
      const analysisResult = await retryWithBackoff(async () => {
        // The callback runs again after every backoff. A native refusal is not
        // retryable; the finally also requalifies failed provider attempts.
        await assertPrivateAccountSession(request);
        try {
          return await ai.models.generateContent({
            model: GEMINI_FLASH_MODEL,
            contents,
            // Tenir le modèle à une réponse JSON : c'est ce que le prompt demande.
            config: { responseMimeType: 'application/json' },
          });
        } finally {
          await assertPrivateAccountSession(request);
        }
      });
      const apiTime = Date.now() - apiStart;
      timings['api'] = apiTime;
      console.log(`   ⏱️  API call: ${apiTime}ms`);

      // Ensure brands are loaded (should be ready by now)
      await brandsPreloadPromise;
      await assertPrivateAccountSession(request);
      const brandsPreloadTime = Date.now() - brandsPreloadStart;
      timings['brands_preload'] = brandsPreloadTime;
      console.log(`   ⏱️  Brands preload (parallel): ${brandsPreloadTime}ms`);

      const responseText = analysisResult.text || '';
      const responseTokens = estimateTokens(responseText);
      tokenCounts['response'] = responseTokens;
      console.log(`   Response tokens: ~${responseTokens}`);

      // Une réponse vide est presque toujours un refus du filtre de sécurité.
      // Elle finissait en « Failed to parse AI response », indiscernable d'une
      // panne : le vendeur réessayait la même photo, qui serait refusée encore.
      if (!responseText.trim()) {
        const finishReason = analysisResult.candidates?.[0]?.finishReason;
        const blockReason = analysisResult.promptFeedback?.blockReason;
        console.error('   ❌ Empty response', { finishReason, blockReason });
        const moderated =
          !!blockReason || SAFETY_FINISH_REASONS.has(String(finishReason ?? ''));
        throw new HttpsError(
          'failed-precondition',
          moderated
            ? 'Cette photo a été refusée par la modération automatique. Essayez avec une autre photo.'
            : "L'analyse n'a rien renvoyé. Réessayez."
        );
      }

      // Parse response
      let jsonResponse: Record<string, unknown>;
      try {
        jsonResponse = parseModelJson(responseText);
      } catch {
        console.error('   ❌ Failed to parse response:', responseText);
        throw new HttpsError('internal', "Impossible de lire la réponse de l'analyse. Réessayez.");
      }

      // Best-effort casing normalization of the detected brand before any
      // downstream matching (matchBrand) — Gemini returns inconsistent casing
      // (e.g. "SELECTED"/"selected"/"Selected"). The canonical normalization at
      // storage (products.ts) remains the primary guard.
      if (jsonResponse.brand && typeof jsonResponse.brand === 'string') {
        jsonResponse.brand = brandDisplay(jsonResponse.brand);
      }

      // Map genre to topLevelCategory. An unknown genre stays unknown: the
      // category is then left for the seller to choose (see topLevelFromGenre).
      const topCategory = topLevelFromGenre(jsonResponse.genre);
      const kidsBranch = kidsBranchFromGenre(jsonResponse.genre);
      console.log(`   Genre: ${jsonResponse.genre} → topCategory: ${topCategory}`);

      const analysisTotalTime = Date.now() - analysisStartTime;
      timings['analysis_total'] = analysisTotalTime;
      console.log(`   ⏱️  Analysis total: ${analysisTotalTime}ms`);

      // Add metadata to response
      jsonResponse._analysisMetadata = {
        ...(topCategory ? { topLevelCategory: topCategory } : {}),
        ...(kidsBranch ? { kidsBranch } : {}),
        singleStepApproach: true,
      };

      // ========================================
      // POST-PROCESSING: Validation & Brand Matching
      // ========================================
      console.log('-'.repeat(40));
      console.log('📍 POST-PROCESSING: Validation & Brand Matching');
      const postProcessStart = Date.now();

      // Validate and normalize the response (includes brand fuzzy matching)
      const normalizedResponse =
        await validateAndNormalizeResponse(jsonResponse, async (tx) => {
          await assertPrivateAccountSession(request, tx);
        });
      await assertPrivateAccountSession(request);

      const postProcessTime = Date.now() - postProcessStart;
      timings['post_processing'] = postProcessTime;
      console.log(`   ⏱️  Post-processing: ${postProcessTime}ms`);

      // ========================================
      // FINAL SUMMARY
      // ========================================
      const totalTime = Date.now() - totalStartTime;
      timings['total'] = totalTime;
      const totalTokens =
        (tokenCounts['prompt'] || 0) + (tokenCounts['images'] || 0);

      console.log('='.repeat(60));
      console.log('📊 ANALYSIS COMPLETE - SUMMARY');
      console.log('='.repeat(60));
      console.log(`⏱️  TIMINGS:`);
      console.log(`   API call:          ${timings['api']}ms`);
      console.log(`   Brands preload:    ${timings['brands_preload']}ms`);
      console.log(`   Post-processing:   ${timings['post_processing']}ms`);
      console.log(`   TOTAL:             ${totalTime}ms`);
      console.log('');
      console.log(`🎯 TOKEN ESTIMATES (SINGLE-STEP):`);
      console.log(`   Prompt:            ~${tokenCounts['prompt']}`);
      console.log(`   Images:            ~${tokenCounts['images']?.toLocaleString()}`);
      console.log(`   TOTAL INPUT:       ~${totalTokens.toLocaleString()}`);
      console.log(
        `   (Old 2-step would have been: ~${(tokenCounts['images']! * 2 + 37000).toLocaleString()})`
      );
      console.log('='.repeat(60));

      // Débit APRÈS une analyse réussie, et seulement alors.
      await consumeRateLimit(uid, request);

      return normalizedResponse;
    } catch (error: unknown) {
      // Nos propres refus remontent tels quels. La garde précédente comparait
      // `err.code` à 'functions/failed-precondition', préfixe que seul le
      // client porte : elle ne se déclenchait jamais.
      if (error instanceof HttpsError) {
        throw error;
      }

      const err = error as { message?: string; code?: string; status?: number };
      console.error('Gemini API error - Full details:', {
        message: err.message,
        code: err.code,
        status: err.status,
      });

      // Return more specific error codes for the client — en français, et
      // jamais le message brut du fournisseur.
      if (err.status === 503 || err.message?.includes('overloaded')) {
        throw new HttpsError(
          'unavailable',
          "Le service d'analyse est momentanément saturé. Réessayez dans quelques instants."
        );
      }
      if (err.status === 429 || err.message?.includes('rate limit')) {
        throw new HttpsError(
          'resource-exhausted',
          'Trop de demandes. Patientez un instant, puis réessayez.'
        );
      }

      throw new HttpsError('internal', "L'analyse a échoué. Réessayez dans un instant.");
    }
  })
);

