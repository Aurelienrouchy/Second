/**
 * AI callable functions
 * Firebase Functions v7 - using onCall
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import {
  getGenAI,
  generateSingleStepAnalysisPrompt,
  validateAndNormalizeResponse,
  retryWithBackoff,
  estimateTokens,
} from '../services/ai';
import { loadBrands } from '../services/brands';

interface ImageData {
  base64: string;
  mimeType: string;
}

/**
 * Analyze product image(s) with AI
 * Returns structured product data for the sell flow
 */
export const analyzeProductImage = onCall(
  {
    memory: '1GiB',
    timeoutSeconds: 120,
    minInstances: 1, // Keep one instance warm to avoid cold starts
  },
  async (request) => {
    const totalStartTime = Date.now();
    const timings: Record<string, number> = {};
    const tokenCounts: Record<string, number> = {};

    // Verify authentication
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    // Support both single image (legacy) and multiple images
    const { imageBase64, mimeType, images } = request.data;

    // Build images array
    let imageDataArray: ImageData[] = [];

    if (images && Array.isArray(images)) {
      // New format: array of images
      imageDataArray = images.map((img: { base64: string; mimeType?: string }) => ({
        base64: img.base64,
        mimeType: img.mimeType || 'image/jpeg',
      }));
    } else if (imageBase64 && mimeType) {
      // Legacy format: single image
      imageDataArray = [{ base64: imageBase64, mimeType }];
    }

    if (imageDataArray.length === 0) {
      throw new HttpsError('invalid-argument', 'At least one image is required');
    }

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
      throw new HttpsError('failed-precondition', 'AI service not configured');
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
      console.log('-'.repeat(40));
      console.log('📝 PROMPT SENT TO GEMINI:');
      console.log('-'.repeat(40));
      console.log(analysisPrompt);
      console.log('-'.repeat(40));

      // Build contents array for new SDK (text first, then images)
      const contents = [{ text: analysisPrompt }, ...buildImageParts()];

      // Start brand preloading in parallel
      const brandsPreloadStart = Date.now();
      const brandsPreloadPromise = loadBrands();

      const apiStart = Date.now();
      const analysisResult = await retryWithBackoff(() =>
        ai.models.generateContent({
          model: 'gemini-2.5-flash', // Latest stable model
          contents,
        })
      );
      const apiTime = Date.now() - apiStart;
      timings['api'] = apiTime;
      console.log(`   ⏱️  API call: ${apiTime}ms`);

      // Ensure brands are loaded (should be ready by now)
      await brandsPreloadPromise;
      const brandsPreloadTime = Date.now() - brandsPreloadStart;
      timings['brands_preload'] = brandsPreloadTime;
      console.log(`   ⏱️  Brands preload (parallel): ${brandsPreloadTime}ms`);

      const responseText = analysisResult.text || '';
      const responseTokens = estimateTokens(responseText);
      tokenCounts['response'] = responseTokens;
      console.log(`   Response tokens: ~${responseTokens}`);

      // Parse response
      let jsonResponse: Record<string, unknown>;
      try {
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          jsonResponse = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error('No JSON found in response');
        }
      } catch {
        console.error('   ❌ Failed to parse response:', responseText);
        throw new HttpsError('internal', 'Failed to parse AI response');
      }

      // Map genre to topLevelCategory for compatibility
      const genreMap: Record<string, string> = {
        femmes: 'women',
        hommes: 'men',
        enfants: 'kids',
      };
      const topCategory =
        genreMap[(jsonResponse.genre as string)?.toLowerCase()] || 'women';
      console.log(`   Genre: ${jsonResponse.genre} → topCategory: ${topCategory}`);

      const analysisTotalTime = Date.now() - analysisStartTime;
      timings['analysis_total'] = analysisTotalTime;
      console.log(`   ⏱️  Analysis total: ${analysisTotalTime}ms`);

      // Add metadata to response
      jsonResponse._analysisMetadata = {
        topLevelCategory: topCategory,
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
        await validateAndNormalizeResponse(jsonResponse);

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

      return normalizedResponse;
    } catch (error: unknown) {
      const err = error as { message?: string; code?: string; status?: number };
      console.error('Gemini API error - Full details:', {
        message: err.message,
        code: err.code,
        status: err.status,
      });

      if (err.code === 'functions/failed-precondition') {
        throw error;
      }

      // Return more specific error codes for the client
      if (err.status === 503 || err.message?.includes('overloaded')) {
        throw new HttpsError(
          'unavailable',
          'AI service temporarily unavailable. Please try again.'
        );
      }
      if (err.status === 429 || err.message?.includes('rate limit')) {
        throw new HttpsError(
          'resource-exhausted',
          'Too many requests. Please wait and try again.'
        );
      }

      throw new HttpsError(
        'internal',
        'AI analysis failed: ' + (err.message || 'Unknown error')
      );
    }
  }
);

