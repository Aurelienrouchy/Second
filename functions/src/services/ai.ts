/**
 * AI Services - Gemini integration utilities
 * Firebase Functions v7
 */
import { GoogleGenAI } from '@google/genai';
import {
  COLOR_REFERENCE,
  MATERIAL_REFERENCE,
  generateCompactCategoryPrompt,
  findCategoryByLabelFuzzy,
  findColorByNameOrAlias,
  findMaterialByNameOrAlias,
} from '../productReference';
import { matchBrand } from './brands';

// Gemini client is initialized per-request to use the secret
// Using new @google/genai SDK (GA since May 2025)
export const getGenAI = (): GoogleGenAI | null => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('GEMINI_API_KEY not found in environment');
    return null;
  }
  return new GoogleGenAI({ apiKey });
};

// Retry helper for Gemini API calls (handles 503 Service Unavailable)
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      lastError = error;
      const err = error as { status?: number; message?: string };
      const isRetryable =
        err.status === 503 ||
        err.status === 429 ||
        err.message?.includes('overloaded') ||
        err.message?.includes('rate limit');

      if (!isRetryable || attempt === maxRetries - 1) {
        throw error;
      }

      const delay = baseDelay * Math.pow(2, attempt); // Exponential backoff
      console.log(
        `Gemini API returned ${err.status || 'error'}, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

// Helper to estimate tokens (rough: ~4 chars per token for text, base64 is ~0.75 bytes per char)
export function estimateTokens(text: string, isBase64: boolean = false): number {
  if (isBase64) {
    // Base64 images: ~0.75 bytes per char, ~4 bytes per token
    return Math.ceil((text.length * 0.75) / 4);
  }
  return Math.ceil(text.length / 4);
}

// Cached prompt (generated once)
// Cache invalidated on deploy — prompt is rebuilt on first call
let cachedAnalysisPrompt: string | null = null;

export function generateSingleStepAnalysisPrompt(): string {
  // Use cached prompt if available
  if (cachedAnalysisPrompt) return cachedAnalysisPrompt;

  // Categories: compact grouped format (~500 tokens instead of ~37K!)
  const categoryLabels = generateCompactCategoryPrompt();

  // Colors: just names
  const colors = COLOR_REFERENCE.map((c) => c.name).join(', ');

  // Materials: just names
  const materials = MATERIAL_REFERENCE.map((m) => m.name).join(', ');

  cachedAnalysisPrompt = `Analyse cet article de mode seconde main. Réponds en JSON uniquement.

CATÉGORIES (choisis la plus précise):
${categoryLabels}

COULEURS: ${colors}
MATIÈRES: ${materials}
ÉTATS: Neuf avec étiquette, Très bon état, Bon état, Satisfaisant

RÈGLES IMPORTANTES pour title et description:
- title: 3-6 mots max, factuel, pas de superlatifs. Ex: "Robe fleurie Zara taille M"
- description: 2-3 phrases courtes (20-40 mots MAX), style naturel comme entre amis. Décris ce que tu vois: coupe, détails, état. Pas de langage marketing, pas de "sublime", "magnifique", "incontournable". Reste simple et honnête.

{
  "genre": "Femmes|Hommes|Enfants",
  "category": "Label exact de la liste",
  "title": "Titre court factuel",
  "description": "Description courte et naturelle, 20-40 mots max",
  "condition": "neuf|tres-bon-etat|bon-etat|satisfaisant",
  "color": "Couleur principale",
  "material": "Matière principale",
  "size": "Taille lue sur étiquette ou null",
  "brand": "Marque avec sa casse officielle (ex: Nike, Zara, COS, Sézane) ou null",
  "packageSize": "small|medium|large",
  "labelFound": true/false,
  "confidence": 0.0-1.0
}`;

  return cachedAnalysisPrompt;
}

/**
 * Get category icon based on the category path
 */
function getCategoryIcon(path: string[]): string {
  if (!path || path.length === 0) return '📦';

  const root = path[0];
  const type = path.length > 1 ? path[1] : '';

  // Root level icons
  const rootIcons: Record<string, string> = {
    women: '👗',
    men: '👔',
    kids: '👶',
    home: '🏠',
    beauty: '💄',
  };

  // Type-specific icons
  const typeIcons: Record<string, string> = {
    clothing: '👕',
    shoes: '👟',
    bags: '👜',
    accessories: '💍',
    jewelry: '💎',
  };

  return typeIcons[type] || rootIcons[root] || '📦';
}

/**
 * Validate and normalize AI response
 * Converts label strings to structured objects for frontend
 */
export async function validateAndNormalizeResponse(
  response: Record<string, unknown>
): Promise<Record<string, unknown>> {
  console.log('   [normalize] Starting validation & normalization...');

  const globalConfidence = (response.confidence as number) || 0.7;
  const topLevelCategory =
    (response._analysisMetadata as Record<string, string>)?.topLevelCategory || 'women';

  // ========================================
  // 1. CATEGORY: Label string → Structured object
  // ========================================
  let categoryResult: Record<string, unknown> = {
    categoryId: '',
    categoryPath: [] as string[],
    displayName: '',
    fullLabel: '',
    icon: '📦',
    confidence: globalConfidence,
    validated: false,
  };

  if (response.category && typeof response.category === 'string') {
    // New format: just a label string
    const categoryLabel = response.category;
    console.log(
      `   [normalize] Looking up category: "${categoryLabel}" (scope: ${topLevelCategory})`
    );

    // Use improved fuzzy matching
    const category = findCategoryByLabelFuzzy(categoryLabel, topLevelCategory);

    if (category) {
      categoryResult = {
        categoryId: category.id,
        categoryPath: category.path,
        displayName: category.label,
        fullLabel: category.fullLabel,
        icon: getCategoryIcon(category.path),
        confidence: globalConfidence,
        validated: true,
      };
      console.log(`Category matched: "${categoryLabel}" → ${category.id}`);
    } else {
      console.warn(`Category not found: "${categoryLabel}"`);
      categoryResult.displayName = categoryLabel;
    }
  } else if ((response.category as Record<string, unknown>)?.categoryId) {
    // Legacy format: already structured
    categoryResult = response.category as Record<string, unknown>;
  }

  // ========================================
  // 2. COLOR: Name string → Structured object
  // ========================================
  let colorsResult: Record<string, unknown>[] = [];
  if (response.color && typeof response.color === 'string') {
    const colorMatch = findColorByNameOrAlias(response.color);
    if (colorMatch) {
      colorsResult = [
        {
          id: colorMatch.id,
          name: colorMatch.name,
          hex: colorMatch.hex,
          confidence: globalConfidence,
          validated: true,
        },
      ];
    } else {
      colorsResult = [
        {
          id: '',
          name: response.color,
          hex: '#808080',
          confidence: globalConfidence * 0.5,
          validated: false,
        },
      ];
    }
  }

  // ========================================
  // 3. MATERIAL: Name string → Structured object
  // ========================================
  let materialsResult: Record<string, unknown>[] = [];
  if (response.material && typeof response.material === 'string') {
    const materialMatch = findMaterialByNameOrAlias(response.material);
    if (materialMatch) {
      materialsResult = [
        {
          id: materialMatch.id,
          name: materialMatch.name,
          confidence: globalConfidence,
          validated: true,
        },
      ];
    } else {
      materialsResult = [
        {
          id: '',
          name: response.material,
          confidence: globalConfidence * 0.5,
          validated: false,
        },
      ];
    }
  }

  // ========================================
  // 4. BRAND: Fuzzy match against brand database
  // ========================================
  let brandResult: Record<string, unknown> | null = null;
  if (response.brand && typeof response.brand === 'string') {
    console.log(`   [normalize] Matching brand: "${response.brand}"`);
    const brandMatch = await matchBrand(response.brand);
    brandResult = {
      detectedName: response.brand,
      ...brandMatch,
    };
    console.log(
      `   [normalize] Brand match result: ${brandMatch.matchType} (${brandMatch.confidence.toFixed(2)})`
    );
  }

  // ========================================
  // 5. CONDITION: Normalize to ConditionId (français-kebab) for frontend parity
  // Frontend indexes CONDITION_DISPLAY[conditionId] with these exact keys
  // (types/ai.ts ConditionId), so we must NOT convert to English here.
  // ========================================
  const conditionMap: Record<string, string> = {
    // français-kebab (canonical ConditionId — passthrough)
    neuf: 'neuf',
    'tres-bon-etat': 'tres-bon-etat',
    'bon-etat': 'bon-etat',
    satisfaisant: 'satisfaisant',
    // accented variants the LLM may produce
    'très bon état': 'tres-bon-etat',
    'tres bon etat': 'tres-bon-etat',
    'bon état': 'bon-etat',
    'bon etat': 'bon-etat',
    // English fallbacks (legacy / defensive)
    new_with_tags: 'neuf',
    very_good: 'tres-bon-etat',
    good: 'bon-etat',
    satisfactory: 'satisfaisant',
  };
  const condition =
    conditionMap[(response.condition as string)?.toLowerCase()] ||
    'tres-bon-etat';

  // ========================================
  // BUILD FINAL RESPONSE (matching frontend AIAnalysisResult type)
  // ========================================

  // NOTE: `confidence` is emitted as a numeric score in [0..1] (Option A).
  // The client (types/ai.ts → createConfidenceScore) recomposes the
  // 'high'|'medium'|'low' level from this number, so the server must NOT send
  // a pre-baked { level } object — doing so breaks createConfidenceScore (it
  // expects a number) and pins every field to 'low'.

  // Build colors object for frontend
  const colorsForFrontend = colorsResult.length > 0
    ? {
        primaryColorId: colorsResult[0].id || null,
        colorIds: colorsResult.map((c) => c.id).filter(Boolean),
        confidence: globalConfidence,
      }
    : {
        primaryColorId: null,
        colorIds: [],
        confidence: 0,
      };

  // Build materials object for frontend
  const materialsForFrontend = materialsResult.length > 0
    ? {
        primaryMaterialId: materialsResult[0].id || null,
        materialIds: materialsResult.map((m) => m.id).filter(Boolean),
        confidence: globalConfidence,
      }
    : {
        primaryMaterialId: null,
        materialIds: [],
        confidence: 0,
      };

  // Build size object for frontend
  const sizeForFrontend = response.size
    ? {
        detected: response.size as string,
        confidence: globalConfidence,
      }
    : null;

  // Build brand object for frontend
  const brandForFrontend = brandResult
    ? {
        detected: brandResult.matchedName || brandResult.detectedName || response.brand,
        confidence: (brandResult.confidence as number) ?? globalConfidence,
        matchType: brandResult.matchType,
      }
    : null;

  // Build condition object for frontend
  const conditionForFrontend = {
    conditionId: condition as string,
    confidence: globalConfidence,
  };

  return {
    title: response.title,
    titleConfidence: globalConfidence,
    description: response.description,
    descriptionConfidence: globalConfidence,
    category: categoryResult,
    condition: conditionForFrontend,
    colors: colorsForFrontend,
    materials: materialsForFrontend,
    size: sizeForFrontend,
    brand: brandForFrontend,
    packageSize: response.packageSize || 'medium',
    labelFound: response.labelFound || false,
    confidence: globalConfidence,
    _raw: {
      genre: response.genre,
      originalCategory: response.category,
      originalColor: response.color,
      originalMaterial: response.material,
      originalBrand: response.brand,
    },
  };
}

// Helper to get price range category
export function getPriceRange(price: number): string {
  if (price < 10) return 'under_10';
  if (price < 25) return '10_25';
  if (price < 50) return '25_50';
  if (price < 100) return '50_100';
  return 'over_100';
}

/**
 * Compute cosine similarity between two vectors
 * Returns a value between -1 and 1 (1 = identical)
 */
export function computeCosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dotProduct / denominator;
}
