"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.analyzeProductImage = void 0;
/**
 * AI callable functions
 * Firebase Functions v7 - using onCall
 */
const https_1 = require("firebase-functions/v2/https");
const ai_1 = require("../services/ai");
const brands_1 = require("../services/brands");
const normalizeBrand_1 = require("../utils/normalizeBrand");
const firebase_1 = require("../config/firebase");
// Rate limiting constants
const RATE_LIMIT_MAX_CALLS = 10;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
/**
 * Check and update rate limit for a user.
 * Uses Firestore doc `rate_limits/{userId}_analyzeProduct` with a sliding window.
 * Throws HttpsError('resource-exhausted') if the limit is exceeded.
 */
async function checkRateLimit(userId) {
    const rateLimitRef = firebase_1.db.collection('rate_limits').doc(`${userId}_analyzeProduct`);
    await firebase_1.db.runTransaction(async (tx) => {
        var _a, _b, _c, _d, _e;
        const snap = await tx.get(rateLimitRef);
        const now = Date.now();
        const windowStart = now - RATE_LIMIT_WINDOW_MS;
        if (snap.exists) {
            const data = snap.data();
            const windowStartedAt = (_d = (_c = (_b = (_a = data.windowStartedAt) === null || _a === void 0 ? void 0 : _a.toMillis) === null || _b === void 0 ? void 0 : _b.call(_a)) !== null && _c !== void 0 ? _c : data.windowStartedAt) !== null && _d !== void 0 ? _d : 0;
            const count = (_e = data.count) !== null && _e !== void 0 ? _e : 0;
            if (windowStartedAt > windowStart) {
                // Still within the current window
                if (count >= RATE_LIMIT_MAX_CALLS) {
                    throw new https_1.HttpsError('resource-exhausted', `Limite atteinte : maximum ${RATE_LIMIT_MAX_CALLS} analyses par heure. Réessayez plus tard.`);
                }
                tx.update(rateLimitRef, { count: firebase_1.FieldValue.increment(1) });
            }
            else {
                // Window expired, reset
                tx.set(rateLimitRef, {
                    userId,
                    count: 1,
                    windowStartedAt: firebase_1.FieldValue.serverTimestamp(),
                });
            }
        }
        else {
            // First call ever
            tx.set(rateLimitRef, {
                userId,
                count: 1,
                windowStartedAt: firebase_1.FieldValue.serverTimestamp(),
            });
        }
    });
}
/**
 * Analyze product image(s) with AI
 * Returns structured product data for the sell flow
 */
exports.analyzeProductImage = (0, https_1.onCall)({
    region: 'northamerica-northeast1',
    memory: '512MiB',
    timeoutSeconds: 120,
    minInstances: 0,
    secrets: ['GEMINI_API_KEY'],
}, async (request) => {
    var _a, _b, _c, _d;
    const totalStartTime = Date.now();
    const timings = {};
    const tokenCounts = {};
    // Verify authentication
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'User must be authenticated');
    }
    // Rate limiting: max 10 calls per hour per user
    await checkRateLimit(request.auth.uid);
    // Support both single image (legacy) and multiple images
    const { imageBase64, mimeType, images } = request.data;
    // Build images array
    let imageDataArray = [];
    if (images && Array.isArray(images)) {
        // New format: array of images
        imageDataArray = images.map((img) => ({
            base64: img.base64,
            mimeType: img.mimeType || 'image/jpeg',
        }));
    }
    else if (imageBase64 && mimeType) {
        // Legacy format: single image
        imageDataArray = [{ base64: imageBase64, mimeType }];
    }
    if (imageDataArray.length === 0) {
        throw new https_1.HttpsError('invalid-argument', 'At least one image is required');
    }
    // Calculate image stats
    const imageSizes = imageDataArray.map((img) => img.base64.length);
    const totalImageBytes = imageSizes.reduce((a, b) => a + b, 0);
    const imageTokens = imageDataArray.reduce((sum, img) => sum + (0, ai_1.estimateTokens)(img.base64, true), 0);
    console.log('='.repeat(60));
    console.log('🔍 ANALYSIS START (SINGLE-STEP OPTIMIZED)');
    console.log('='.repeat(60));
    console.log(`📸 Images: ${imageDataArray.length}`);
    console.log(`📏 Image sizes: ${imageSizes.map((s) => `${Math.round(s / 1024)}KB`).join(', ')}`);
    console.log(`📊 Total image data: ${Math.round(totalImageBytes / 1024)}KB`);
    console.log(`🎯 Estimated image tokens: ~${imageTokens.toLocaleString()}`);
    tokenCounts['images'] = imageTokens;
    const ai = (0, ai_1.getGenAI)();
    if (!ai) {
        console.error('Gemini API key not configured');
        throw new https_1.HttpsError('failed-precondition', 'AI service not configured');
    }
    try {
        // Helper to build image parts for Gemini (new SDK format)
        const buildImageParts = () => imageDataArray.map((imgData) => ({
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
        const analysisPrompt = (0, ai_1.generateSingleStepAnalysisPrompt)();
        const promptTokens = (0, ai_1.estimateTokens)(analysisPrompt);
        tokenCounts['prompt'] = promptTokens;
        console.log(`   Prompt tokens: ~${promptTokens} (was ~37K with old 2-step!)`);
        console.log(`   Total tokens: ~${(promptTokens + imageTokens).toLocaleString()}`);
        console.log('-'.repeat(40));
        console.log('📝 PROMPT SENT TO GEMINI:');
        console.log('-'.repeat(40));
        console.log(analysisPrompt);
        console.log('-'.repeat(40));
        // Build contents array for new SDK (text first, then images)
        const contents = [{ text: analysisPrompt }, ...buildImageParts()];
        // Start brand preloading in parallel
        const brandsPreloadStart = Date.now();
        const brandsPreloadPromise = (0, brands_1.loadBrands)();
        const apiStart = Date.now();
        const analysisResult = await (0, ai_1.retryWithBackoff)(() => ai.models.generateContent({
            model: 'gemini-2.5-flash', // Latest stable model
            contents,
        }));
        const apiTime = Date.now() - apiStart;
        timings['api'] = apiTime;
        console.log(`   ⏱️  API call: ${apiTime}ms`);
        // Ensure brands are loaded (should be ready by now)
        await brandsPreloadPromise;
        const brandsPreloadTime = Date.now() - brandsPreloadStart;
        timings['brands_preload'] = brandsPreloadTime;
        console.log(`   ⏱️  Brands preload (parallel): ${brandsPreloadTime}ms`);
        const responseText = analysisResult.text || '';
        const responseTokens = (0, ai_1.estimateTokens)(responseText);
        tokenCounts['response'] = responseTokens;
        console.log(`   Response tokens: ~${responseTokens}`);
        // Parse response
        let jsonResponse;
        try {
            const jsonMatch = responseText.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                jsonResponse = JSON.parse(jsonMatch[0]);
            }
            else {
                throw new Error('No JSON found in response');
            }
        }
        catch (_e) {
            console.error('   ❌ Failed to parse response:', responseText);
            throw new https_1.HttpsError('internal', 'Failed to parse AI response');
        }
        // Best-effort casing normalization of the detected brand before any
        // downstream matching (matchBrand) — Gemini returns inconsistent casing
        // (e.g. "SELECTED"/"selected"/"Selected"). The canonical normalization at
        // storage (products.ts) remains the primary guard.
        if (jsonResponse.brand && typeof jsonResponse.brand === 'string') {
            jsonResponse.brand = (0, normalizeBrand_1.brandDisplay)(jsonResponse.brand);
        }
        // Map genre to topLevelCategory for compatibility
        const genreMap = {
            femmes: 'women',
            hommes: 'men',
            enfants: 'kids',
        };
        const topCategory = genreMap[(_a = jsonResponse.genre) === null || _a === void 0 ? void 0 : _a.toLowerCase()] || 'women';
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
        const normalizedResponse = await (0, ai_1.validateAndNormalizeResponse)(jsonResponse);
        const postProcessTime = Date.now() - postProcessStart;
        timings['post_processing'] = postProcessTime;
        console.log(`   ⏱️  Post-processing: ${postProcessTime}ms`);
        // ========================================
        // FINAL SUMMARY
        // ========================================
        const totalTime = Date.now() - totalStartTime;
        timings['total'] = totalTime;
        const totalTokens = (tokenCounts['prompt'] || 0) + (tokenCounts['images'] || 0);
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
        console.log(`   Images:            ~${(_b = tokenCounts['images']) === null || _b === void 0 ? void 0 : _b.toLocaleString()}`);
        console.log(`   TOTAL INPUT:       ~${totalTokens.toLocaleString()}`);
        console.log(`   (Old 2-step would have been: ~${(tokenCounts['images'] * 2 + 37000).toLocaleString()})`);
        console.log('='.repeat(60));
        return normalizedResponse;
    }
    catch (error) {
        const err = error;
        console.error('Gemini API error - Full details:', {
            message: err.message,
            code: err.code,
            status: err.status,
        });
        if (err.code === 'functions/failed-precondition') {
            throw error;
        }
        // Return more specific error codes for the client
        if (err.status === 503 || ((_c = err.message) === null || _c === void 0 ? void 0 : _c.includes('overloaded'))) {
            throw new https_1.HttpsError('unavailable', 'AI service temporarily unavailable. Please try again.');
        }
        if (err.status === 429 || ((_d = err.message) === null || _d === void 0 ? void 0 : _d.includes('rate limit'))) {
            throw new https_1.HttpsError('resource-exhausted', 'Too many requests. Please wait and try again.');
        }
        throw new https_1.HttpsError('internal', 'AI analysis failed: ' + (err.message || 'Unknown error'));
    }
});
//# sourceMappingURL=ai.js.map