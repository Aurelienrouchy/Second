"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EMBEDDING_DIMENSIONS = exports.GEMINI_EMBEDDING_MODEL = exports.GEMINI_VISION_MODEL = void 0;
exports.getGeminiClient = getGeminiClient;
exports.generateContent = generateContent;
exports.generateEmbedding = generateEmbedding;
/**
 * Gemini AI Configuration
 * @google/genai v1.37.0
 * Model: gemini-3-flash-preview (latest)
 */
const genai_1 = require("@google/genai");
// Gemini model constants
exports.GEMINI_VISION_MODEL = 'gemini-3-flash-preview';
exports.GEMINI_EMBEDDING_MODEL = 'gemini-embedding-001';
exports.EMBEDDING_DIMENSIONS = 2048;
// Lazy-initialized Gemini client
let aiClient = null;
/**
 * Get or create Gemini AI client
 * @param apiKey - The Gemini API key
 */
function getGeminiClient(apiKey) {
    if (!aiClient) {
        aiClient = new genai_1.GoogleGenAI({ apiKey });
    }
    return aiClient;
}
/**
 * Generate content with Gemini vision model
 */
async function generateContent(apiKey, prompt, imageData) {
    const ai = getGeminiClient(apiKey);
    const contents = imageData
        ? [{ text: prompt }, { inlineData: imageData }]
        : [{ text: prompt }];
    const result = await ai.models.generateContent({
        model: exports.GEMINI_VISION_MODEL,
        contents,
    });
    return result;
}
/**
 * Generate embeddings with Gemini embedding model
 */
async function generateEmbedding(apiKey, text, taskType = 'RETRIEVAL_DOCUMENT') {
    const ai = getGeminiClient(apiKey);
    const result = await ai.models.embedContent({
        model: exports.GEMINI_EMBEDDING_MODEL,
        contents: text,
        config: { taskType, outputDimensionality: exports.EMBEDDING_DIMENSIONS },
    });
    return result;
}
//# sourceMappingURL=gemini.js.map