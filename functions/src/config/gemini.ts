/**
 * Gemini AI Configuration
 * @google/genai v1.37.0
 * Model: gemini-3-flash-preview (latest)
 */
import { GoogleGenAI } from '@google/genai';

// Gemini model constants
export const GEMINI_VISION_MODEL = 'gemini-3-flash-preview';
export const GEMINI_EMBEDDING_MODEL = 'gemini-embedding-001';
export const EMBEDDING_DIMENSIONS = 2048;

// Lazy-initialized Gemini client
let aiClient: GoogleGenAI | null = null;

/**
 * Get or create Gemini AI client
 * @param apiKey - The Gemini API key
 */
export function getGeminiClient(apiKey: string): GoogleGenAI {
  if (!aiClient) {
    aiClient = new GoogleGenAI({ apiKey });
  }
  return aiClient;
}

/**
 * Generate content with Gemini vision model
 */
export async function generateContent(
  apiKey: string,
  prompt: string,
  imageData?: { mimeType: string; data: string }
) {
  const ai = getGeminiClient(apiKey);

  const contents = imageData
    ? [{ text: prompt }, { inlineData: imageData }]
    : [{ text: prompt }];

  const result = await ai.models.generateContent({
    model: GEMINI_VISION_MODEL,
    contents,
  });

  return result;
}

/**
 * Generate embeddings with Gemini embedding model
 */
export async function generateEmbedding(
  apiKey: string,
  text: string,
  taskType: 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY' = 'RETRIEVAL_DOCUMENT'
) {
  const ai = getGeminiClient(apiKey);

  const result = await ai.models.embedContent({
    model: GEMINI_EMBEDDING_MODEL,
    contents: text,
    config: { taskType, outputDimensionality: EMBEDDING_DIMENSIONS },
  });

  return result;
}
