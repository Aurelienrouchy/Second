/**
 * Brand matching service
 * Fuzzy matching with Fuse.js
 */
import Fuse from 'fuse.js';
import { db } from '../config/firebase';

// Types
export interface BrandDocument {
  id: string;
  name: string;
  aliases?: string[];
  popularity?: number;
}

export interface BrandMatchResult {
  brandId: string | null;
  brandName: string | null;
  confidence: number;
  matchType: 'exact' | 'fuzzy' | 'none';
  needsConfirmation: boolean;
  suggestions: Array<{
    brandId: string;
    brandName: string;
    score: number;
  }>;
}

// Brand matching thresholds
export const BRAND_MATCHING = {
  autoSelectThreshold: 0.9, // Auto-select without confirmation
  strongThreshold: 0.75, // Strong match (lowered from 0.85)
  suggestionThreshold: 0.5, // Show in suggestions
  fuseThreshold: 0.4, // Fuse.js threshold
  maxSuggestions: 5,
};

// In-memory cache for brands
let brandsCache: BrandDocument[] | null = null;
let brandsCacheTimestamp: number = 0;
let brandsFuse: Fuse<BrandDocument> | null = null;
const BRANDS_CACHE_TTL = 60 * 60 * 1000; // 1 hour

/**
 * Load brands from Firestore with caching
 */
export async function loadBrands(): Promise<BrandDocument[]> {
  const now = Date.now();

  // Return cached brands if still valid
  if (brandsCache && now - brandsCacheTimestamp < BRANDS_CACHE_TTL) {
    console.log(
      `   [brands] Using cached brands (${brandsCache.length} brands, age: ${Math.round((now - brandsCacheTimestamp) / 1000)}s)`
    );
    return brandsCache;
  }

  const loadStart = Date.now();
  console.log('   [brands] Loading brands from Firestore...');
  const brandsSnapshot = await db.collection('brands').get();
  const firestoreTime = Date.now() - loadStart;

  brandsCache = brandsSnapshot.docs.map((doc) => ({
    id: doc.id,
    name: doc.data().name || doc.id,
    aliases: doc.data().aliases || [],
    popularity: doc.data().popularity || 0,
  }));

  brandsCacheTimestamp = now;

  // Rebuild Fuse index
  const fuseStart = Date.now();
  brandsFuse = new Fuse(brandsCache, {
    keys: [
      { name: 'name', weight: 1.0 },
      { name: 'aliases', weight: 0.8 },
    ],
    threshold: BRAND_MATCHING.fuseThreshold,
    includeScore: true,
    ignoreLocation: true,
    minMatchCharLength: 2,
    findAllMatches: true,
  });
  const fuseTime = Date.now() - fuseStart;

  console.log(
    `   [brands] Loaded ${brandsCache.length} brands (Firestore: ${firestoreTime}ms, Fuse index: ${fuseTime}ms)`
  );
  return brandsCache;
}

/**
 * Get or build Fuse index
 */
export async function getBrandsFuse(): Promise<Fuse<BrandDocument>> {
  if (
    !brandsFuse ||
    !brandsCache ||
    Date.now() - brandsCacheTimestamp >= BRANDS_CACHE_TTL
  ) {
    await loadBrands();
  }
  return brandsFuse!;
}

/**
 * Fuzzy match a detected brand name against the brands database
 */
export async function matchBrand(
  detectedBrand: string | null
): Promise<BrandMatchResult> {
  if (!detectedBrand || detectedBrand.trim() === '') {
    return {
      brandId: null,
      brandName: null,
      confidence: 0,
      matchType: 'none',
      needsConfirmation: false,
      suggestions: [],
    };
  }

  const normalizedInput = detectedBrand.trim().toLowerCase();
  const brands = await loadBrands();

  // 1. Try exact match first (case-insensitive)
  const exactMatch = brands.find(
    (b) =>
      b.name.toLowerCase() === normalizedInput ||
      b.aliases?.some((a) => a.toLowerCase() === normalizedInput)
  );

  if (exactMatch) {
    return {
      brandId: exactMatch.id,
      brandName: exactMatch.name,
      confidence: 1.0,
      matchType: 'exact',
      needsConfirmation: false,
      suggestions: [],
    };
  }

  // 2. Fuzzy search
  const fuse = await getBrandsFuse();
  const results = fuse.search(detectedBrand, {
    limit: BRAND_MATCHING.maxSuggestions,
  });

  if (results.length === 0) {
    return {
      brandId: null,
      brandName: null,
      confidence: 0,
      matchType: 'none',
      needsConfirmation: false,
      suggestions: [],
    };
  }

  // Convert Fuse score to confidence
  const topResult = results[0];
  const confidence = 1 - (topResult.score || 0);

  const isAutoSelect = confidence >= BRAND_MATCHING.autoSelectThreshold;
  const isStrongMatch = confidence >= BRAND_MATCHING.strongThreshold;

  // Filter suggestions
  const suggestions = results
    .filter((r) => 1 - (r.score || 0) >= BRAND_MATCHING.suggestionThreshold)
    .map((r) => ({
      brandId: r.item.id,
      brandName: r.item.name,
      score: 1 - (r.score || 0),
    }));

  return {
    brandId: isStrongMatch ? topResult.item.id : null,
    brandName: isStrongMatch ? topResult.item.name : null,
    confidence: confidence,
    matchType: isStrongMatch ? 'fuzzy' : 'none',
    needsConfirmation: isStrongMatch && !isAutoSelect,
    suggestions,
  };
}

/**
 * Clear brands cache
 */
export function clearBrandsCache(): void {
  brandsCache = null;
  brandsCacheTimestamp = 0;
  brandsFuse = null;
}
