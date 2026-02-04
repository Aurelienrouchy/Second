/**
 * AI Service Configuration
 * Centralized configuration for AI product analysis
 */

export const AI_CONFIG = {
  // Timeout settings
  timeouts: {
    client: 90_000, // 90 seconds - aligned with server
    server: 120_000, // 120 seconds (Firebase Function timeout)
  },

  // Image processing settings
  image: {
    maxImages: 5,
    maxSizeBytes: 5 * 1024 * 1024, // 5MB
    targetSizeBytes: 2 * 1024 * 1024, // 2MB - compress if larger
    supportedFormats: ['jpeg', 'jpg', 'png', 'webp', 'heic', 'heif'] as const,
    compressionQuality: 0.8,
  },

  // Brand matching thresholds
  brandMatching: {
    strongThreshold: 0.75, // Lowered from 0.85 for better matching
    autoSelectThreshold: 0.90, // Auto-select only if very confident
    suggestionThreshold: 0.50, // Show suggestions above this
    fuseThreshold: 0.4, // Fuse.js threshold (higher = stricter)
    maxSuggestions: 5,
  },

  // Confidence levels
  confidence: {
    high: 0.8,
    medium: 0.5,
    thresholds: {
      autoFill: 0.7, // Auto-fill fields above this
      showWarning: 0.5, // Show warning below this
    },
  },

  // Progress phases for UI
  phases: {
    upload: { weight: 0.15, message: 'Envoi des images...' },
    category: { weight: 0.25, message: 'Détection de la catégorie...' },
    analysis: { weight: 0.40, message: 'Analyse en cours...' },
    brand: { weight: 0.15, message: 'Identification de la marque...' },
    validation: { weight: 0.05, message: 'Validation finale...' },
  },

  // Error messages localized (French)
  errors: {
    TIMEOUT: {
      title: 'Analyse trop longue',
      message: "L'analyse prend plus de temps que prévu. Veuillez réessayer.",
      icon: 'time-outline',
    },
    IMAGE_TOO_LARGE: {
      title: 'Image trop volumineuse',
      message: "L'image dépasse la taille maximale de 5MB.",
      icon: 'image-outline',
    },
    UNSUPPORTED_FORMAT: {
      title: 'Format non supporté',
      message: 'Seuls les formats JPEG, PNG, WebP et HEIC sont acceptés.',
      icon: 'document-outline',
    },
    NETWORK_ERROR: {
      title: 'Problème de connexion',
      message: 'Vérifiez votre connexion internet et réessayez.',
      icon: 'wifi-outline',
    },
    IMAGE_QUALITY_LOW: {
      title: 'Qualité insuffisante',
      message: "L'image semble floue ou de mauvaise qualité.",
      icon: 'eye-off-outline',
    },
    API_ERROR: {
      title: 'Erreur serveur',
      message: 'Une erreur est survenue. Veuillez réessayer.',
      icon: 'server-outline',
    },
    PARSE_ERROR: {
      title: 'Erreur de traitement',
      message: "Impossible de traiter la réponse de l'IA.",
      icon: 'code-outline',
    },
    UNAUTHENTICATED: {
      title: 'Non connecté',
      message: 'Vous devez être connecté pour utiliser cette fonctionnalité.',
      icon: 'person-outline',
    },
    INVALID_IMAGE: {
      title: 'Image invalide',
      message: "Impossible de lire l'image. Essayez avec une autre photo.",
      icon: 'close-circle-outline',
    },
  },

  // Recovery options for errors
  recoveryOptions: {
    TIMEOUT: ['retry', 'manual_entry'],
    IMAGE_TOO_LARGE: ['change_photos'],
    UNSUPPORTED_FORMAT: ['change_photos'],
    NETWORK_ERROR: ['retry'],
    IMAGE_QUALITY_LOW: ['change_photos', 'manual_entry'],
    API_ERROR: ['retry', 'manual_entry'],
    PARSE_ERROR: ['retry', 'manual_entry'],
    UNAUTHENTICATED: ['manual_entry'],
    INVALID_IMAGE: ['change_photos'],
  },
} as const;

// Type exports for configuration
export type AIErrorCode = keyof typeof AI_CONFIG.errors;
export type RecoveryOption = 'retry' | 'manual_entry' | 'change_photos';
export type AnalysisPhase = keyof typeof AI_CONFIG.phases;
export type SupportedImageFormat = (typeof AI_CONFIG.image.supportedFormats)[number];

// Helper to get error info by code
export function getErrorInfo(code: AIErrorCode) {
  return AI_CONFIG.errors[code] || AI_CONFIG.errors.API_ERROR;
}

// Helper to get recovery options for an error
export function getRecoveryOptions(code: AIErrorCode): RecoveryOption[] {
  return AI_CONFIG.recoveryOptions[code] || ['retry', 'manual_entry'];
}

// Helper to check if format is supported
export function isSupportedFormat(format: string): format is SupportedImageFormat {
  const normalizedFormat = format.toLowerCase().replace('image/', '');
  return AI_CONFIG.image.supportedFormats.includes(normalizedFormat as SupportedImageFormat);
}

// Helper to get phase progress percentage
export function getPhaseProgress(phase: AnalysisPhase): number {
  const phases = Object.keys(AI_CONFIG.phases) as AnalysisPhase[];
  const currentIndex = phases.indexOf(phase);
  let progress = 0;

  for (let i = 0; i < currentIndex; i++) {
    progress += AI_CONFIG.phases[phases[i]].weight;
  }

  // Add half of current phase
  progress += AI_CONFIG.phases[phase].weight / 2;

  return Math.round(progress * 100);
}
