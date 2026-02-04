/**
 * AI Analysis Types for Product Creation
 * Updated to use constrained IDs from reference data
 * Enhanced with phases, error handling, and label detection
 */

export type ConfidenceLevel = 'high' | 'medium' | 'low';

export interface ConfidenceScore {
  value: number; // 0.0 - 1.0
  level: ConfidenceLevel;
  fromLabel?: boolean; // True if data was extracted from product label
}

// ============================================
// Analysis Phase Types
// ============================================

export type AnalysisPhase = 'upload' | 'category' | 'analysis' | 'brand' | 'validation';

export interface AnalysisProgress {
  phase: AnalysisPhase;
  progress: number; // 0-100
  message: string;
}

// ============================================
// Error Types
// ============================================

export type AIErrorCode =
  | 'TIMEOUT'
  | 'IMAGE_TOO_LARGE'
  | 'UNSUPPORTED_FORMAT'
  | 'NETWORK_ERROR'
  | 'IMAGE_QUALITY_LOW'
  | 'API_ERROR'
  | 'PARSE_ERROR'
  | 'UNAUTHENTICATED'
  | 'INVALID_IMAGE';

export type RecoveryOption = 'retry' | 'manual_entry' | 'change_photos';

export interface AIAnalysisError {
  code: AIErrorCode;
  message: string;
  title?: string;
  icon?: string;
  recoveryOptions?: RecoveryOption[];
  retryable?: boolean;
}

// ============================================
// Label Detection Types
// ============================================

export interface LabelDetection {
  found: boolean;
  confidence: number;
  extractedData: {
    brand?: string;
    size?: string;
    material?: string;
    composition?: string;
    careInstructions?: string[];
    madeIn?: string;
  };
}

// ============================================
// Image Quality Types
// ============================================

export interface ImageQualityScore {
  score: number; // 0-1
  issues: ImageQualityIssue[];
  acceptable: boolean;
}

export type ImageQualityIssue = 'blur' | 'dark' | 'overexposed' | 'small' | 'cropped';

// ============================================
// Processed Image Type
// ============================================

export interface ProcessedImage {
  base64: string;
  mimeType: string;
  originalFormat: string;
  wasConverted: boolean;
  wasCompressed: boolean;
  originalSize: number;
  finalSize: number;
  quality?: ImageQualityScore;
}

// ============================================
// Category Types
// ============================================

export interface AICategory {
  categoryId: string;         // Unique ID (e.g., "men_tops_shirts")
  categoryPath: string[];     // Full path IDs (e.g., ["men", "men_clothing", "men_tops", "men_tops_shirts"])
  displayName: string;        // Human-readable (e.g., "Chemises")
  fullLabel: string;          // Full breadcrumb (e.g., "Hommes > Vêtements > Hauts > Chemises")
  icon?: string;              // Optional icon
  confidence: ConfidenceScore;
  validated?: boolean;        // Whether the categoryId was validated against reference
}

// ============================================
// Color Types
// ============================================

export interface AIColors {
  colorIds: string[];         // All detected color IDs (e.g., ["bleu-marine", "blanc"])
  primaryColorId: string;     // Main color ID (e.g., "bleu-marine")
  confidence: ConfidenceScore;
}

// ============================================
// Material Types
// ============================================

export interface AIMaterials {
  materialIds: string[];      // All detected material IDs (e.g., ["coton", "elasthanne"])
  primaryMaterialId: string;  // Main material ID (e.g., "coton")
  composition?: string | null; // e.g., "80% coton, 20% polyester" (from label)
  confidence: ConfidenceScore;
}

// ============================================
// Size Types
// ============================================

export interface AISize {
  detected?: string | null;   // Exact size from label (e.g., "M", "38", "40/42")
  normalized: string | null;  // Normalized size for the category type
  confidence: ConfidenceScore;
}

// ============================================
// Condition Types
// ============================================

export type ConditionId = 'neuf' | 'tres-bon-etat' | 'bon-etat' | 'satisfaisant';

export interface AICondition {
  conditionId: ConditionId;
  confidence: ConfidenceScore;
}

// Mapping from conditionId to display value (for backward compatibility)
export const CONDITION_DISPLAY: Record<ConditionId, string> = {
  'neuf': 'neuf',
  'tres-bon-etat': 'très bon état',
  'bon-etat': 'bon état',
  'satisfaisant': 'satisfaisant',
};

// ============================================
// Package Size Types
// ============================================

export interface AIPackageSize {
  suggested: 'small' | 'medium' | 'large';
  confidence: ConfidenceScore;
}

// ============================================
// Brand Types
// ============================================

export interface AIBrand {
  detected: string | null;
  confidence: ConfidenceScore;
  brandId?: string | null;       // Matched brand ID from database
  brandName?: string | null;     // Matched brand name from database
  matchType?: 'exact' | 'fuzzy' | 'none';
  matchConfidence?: number;      // Brand matching confidence (0-1)
  needsConfirmation?: boolean;   // True if match is strong but not auto-select worthy
  suggestions?: BrandSuggestion[];
  fromLabel?: boolean;           // True if detected from product label
}

export interface BrandSuggestion {
  brandId: string;
  brandName: string;
  score: number;
}

// ============================================
// Full Analysis Result
// ============================================

export interface AIAnalysisResult {
  // Core fields
  title: string;
  titleConfidence: number;

  description: string;
  descriptionConfidence: number;

  category: AICategory;

  condition: AICondition;

  colors: AIColors;

  materials: AIMaterials;

  size: AISize;

  brand: AIBrand;

  packageSize: AIPackageSize;

  // Label detection (enhanced)
  labelFound?: boolean;
  labelDetection?: LabelDetection;

  // Metadata (added by client)
  analyzedAt?: Date;
  processingTimeMs?: number;

  // Analysis metadata from server
  _analysisMetadata?: {
    topLevelCategory: string;
    topLevelConfidence: number;
    twoStepApproach: boolean;
  };
}

// ============================================
// Request/Response Types
// ============================================

export interface AIAnalysisRequest {
  imageBase64: string;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/heic';
}

export interface AIAnalysisMultiImageRequest {
  images: Array<{
    base64: string;
    mimeType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/heic';
  }>;
}

export interface AIAnalysisResponse {
  success: boolean;
  result?: AIAnalysisResult;
  error?: AIAnalysisError;
  storageUrls?: string[]; // Firebase Storage URLs of uploaded images
}

// ============================================
// Progress Callback Options
// ============================================

export interface AIAnalysisOptions {
  onProgress?: (progress: number) => void;
  onPhaseChange?: (phase: AnalysisPhase, message: string) => void;
  signal?: AbortSignal; // For cancellation support
  draftId?: string; // Draft ID for organizing Storage uploads
}

// ============================================
// Helper Functions
// ============================================

export function getConfidenceLevel(value: number): ConfidenceLevel {
  if (value >= 0.8) return 'high';
  if (value >= 0.5) return 'medium';
  return 'low';
}

export function createConfidenceScore(value: number, fromLabel?: boolean): ConfidenceScore {
  return {
    value,
    level: getConfidenceLevel(value),
    fromLabel,
  };
}

/**
 * Create a detailed error object with recovery options
 */
export function createDetailedError(
  code: AIErrorCode,
  message?: string
): AIAnalysisError {
  const errorDefaults: Record<AIErrorCode, { title: string; message: string; icon: string; retryable: boolean }> = {
    TIMEOUT: {
      title: 'Analyse trop longue',
      message: "L'analyse prend plus de temps que prévu.",
      icon: 'time-outline',
      retryable: true,
    },
    IMAGE_TOO_LARGE: {
      title: 'Image trop volumineuse',
      message: "L'image dépasse la taille maximale de 5MB.",
      icon: 'image-outline',
      retryable: false,
    },
    UNSUPPORTED_FORMAT: {
      title: 'Format non supporté',
      message: 'Seuls les formats JPEG, PNG, WebP et HEIC sont acceptés.',
      icon: 'document-outline',
      retryable: false,
    },
    NETWORK_ERROR: {
      title: 'Problème de connexion',
      message: 'Vérifiez votre connexion internet et réessayez.',
      icon: 'wifi-outline',
      retryable: true,
    },
    IMAGE_QUALITY_LOW: {
      title: 'Qualité insuffisante',
      message: "L'image semble floue ou de mauvaise qualité.",
      icon: 'eye-off-outline',
      retryable: false,
    },
    API_ERROR: {
      title: 'Erreur serveur',
      message: 'Une erreur est survenue. Veuillez réessayer.',
      icon: 'server-outline',
      retryable: true,
    },
    PARSE_ERROR: {
      title: 'Erreur de traitement',
      message: "Impossible de traiter la réponse de l'IA.",
      icon: 'code-outline',
      retryable: true,
    },
    UNAUTHENTICATED: {
      title: 'Non connecté',
      message: 'Vous devez être connecté pour utiliser cette fonctionnalité.',
      icon: 'person-outline',
      retryable: false,
    },
    INVALID_IMAGE: {
      title: 'Image invalide',
      message: "Impossible de lire l'image. Essayez avec une autre photo.",
      icon: 'close-circle-outline',
      retryable: false,
    },
  };

  const recoveryOptionsMap: Record<AIErrorCode, RecoveryOption[]> = {
    TIMEOUT: ['retry', 'manual_entry'],
    IMAGE_TOO_LARGE: ['change_photos'],
    UNSUPPORTED_FORMAT: ['change_photos'],
    NETWORK_ERROR: ['retry'],
    IMAGE_QUALITY_LOW: ['change_photos', 'manual_entry'],
    API_ERROR: ['retry', 'manual_entry'],
    PARSE_ERROR: ['retry', 'manual_entry'],
    UNAUTHENTICATED: ['manual_entry'],
    INVALID_IMAGE: ['change_photos'],
  };

  const defaults = errorDefaults[code] || errorDefaults.API_ERROR;

  return {
    code,
    message: message || defaults.message,
    title: defaults.title,
    icon: defaults.icon,
    recoveryOptions: recoveryOptionsMap[code] || ['retry', 'manual_entry'],
    retryable: defaults.retryable,
  };
}

/**
 * Transform raw Gemini response to AIAnalysisResult
 * Handles both new format and potential edge cases
 */
export function transformGeminiResponse(raw: any): AIAnalysisResult {
  return {
    title: raw.title || '',
    titleConfidence: raw.titleConfidence || 0.5,

    description: raw.description || '',
    descriptionConfidence: raw.descriptionConfidence || 0.5,

    category: {
      categoryId: raw.category?.categoryId || '',
      categoryPath: raw.category?.categoryPath || [],
      displayName: raw.category?.displayName || '',
      fullLabel: raw.category?.fullLabel || '',
      icon: raw.category?.icon,
      confidence: createConfidenceScore(raw.category?.confidence || 0.5),
      validated: raw.category?.validated !== false,
    },

    condition: {
      conditionId: (raw.condition?.conditionId || 'bon-etat') as ConditionId,
      confidence: createConfidenceScore(raw.condition?.confidence || 0.5),
    },

    colors: {
      colorIds: raw.colors?.colorIds || [],
      primaryColorId: raw.colors?.primaryColorId || '',
      confidence: createConfidenceScore(raw.colors?.confidence || 0.5),
    },

    materials: {
      materialIds: raw.materials?.materialIds || [],
      primaryMaterialId: raw.materials?.primaryMaterialId || '',
      composition: raw.materials?.composition,
      confidence: createConfidenceScore(raw.materials?.confidence || 0.5),
    },

    size: {
      detected: raw.size?.detected || null,
      normalized: raw.size?.normalized || null,
      confidence: createConfidenceScore(raw.size?.confidence || 0.5),
    },

    brand: {
      detected: raw.brand?.detected || null,
      confidence: createConfidenceScore(raw.brand?.confidence || 0.5),
    },

    packageSize: {
      suggested: raw.packageSize?.suggested || 'medium',
      confidence: createConfidenceScore(raw.packageSize?.confidence || 0.5),
    },

    labelFound: raw.labelFound || false,
  };
}
