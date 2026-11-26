/**
 * Brand matching service
 * Fuzzy matching with Fuse.js
 */
import Fuse from 'fuse.js';
import { HttpsError } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import { db } from '../config/firebase';
import { brandDisplay, brandDocId, brandKey } from '../utils/normalizeBrand';

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

function buildFuseIndex(brands: BrandDocument[]): Fuse<BrandDocument> {
  return new Fuse(brands, {
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
}

/** Longueur maximale d'un nom de marque accepte depuis l'IA. */
export const AI_BRAND_MAX_LENGTH = 40;

const AI_BRAND_SHAPE = /^[\p{L}\p{N}][\p{L}\p{N} '&.\-+/]*$/u;

const AI_BRAND_REJECTED = new Set([
  'unknown', 'inconnu', 'inconnue', 'n/a', 'na', 'none', 'null', 'undefined',
  'sans marque', 'no brand', 'aucune', 'aucune marque', 'marque', 'brand',
  'generique', 'generic', 'vintage', 'handmade', 'fait main',
]);

/**
 * Un texte lu par le modele n'est pas forcement une marque. On refuse ce qui
 * ne peut pas en etre une avant d'ecrire quoi que ce soit au catalogue :
 * le referentiel est partage par tous les vendeurs.
 */
export function isPlausibleBrandName(raw: string | null | undefined): boolean {
  if (!raw) return false;
  const name = raw.trim();
  if (name.length < 2 || name.length > AI_BRAND_MAX_LENGTH) return false;
  if (/^\d+$/.test(name)) return false;
  if (!AI_BRAND_SHAPE.test(name)) return false;
  return !AI_BRAND_REJECTED.has(name.toLowerCase());
}

/**
 * Inscrit au catalogue une marque lue par l'IA qui n'y figurait pas, et la
 * rend immediatement rapprochable (cache + index Fuse mis a jour).
 *
 * N'est appelee que lorsque le rapprochement flou n'a RIEN propose : une
 * marque proche d'une entree existante doit etre rapprochee, pas dupliquee.
 * Renvoie null si le nom n'est pas plausible ou si l'ecriture echoue — le
 * parcours d'analyse continue alors comme avant.
 */
export async function ensureBrandDocument(
  detectedBrand: string | null | undefined,
  authorize?: (tx?: FirebaseFirestore.Transaction) => Promise<void>
): Promise<BrandDocument | null> {
  if (!isPlausibleBrandName(detectedBrand)) return null;

  const label = brandDisplay(detectedBrand);
  const searchKey = brandKey(detectedBrand);
  const docId = brandDocId(detectedBrand);
  if (!docId) return null;

  try {
    const ref = db.collection('brands').doc(docId);
    const readOrCreate = async (tx?: FirebaseFirestore.Transaction) => {
      await authorize?.(tx);
      const existing = await (tx ? tx.get(ref) : ref.get());
      await authorize?.(tx);
      if (existing.exists) {
        // Present au catalogue mais absent du cache : on recharge plutot que
        // d'ecraser une entree du referentiel.
        const data = existing.data() || {};
        return { created: false, brand: {
          id: docId,
          name: data.name || data.label || label,
          aliases: data.aliases || [],
          popularity: data.popularity || 0,
        } as BrandDocument };
      }

      const data = {
        // Contrat de la recherche dans l'app.
        label,
        value: searchKey,
        searchKey,
        // Contrat du rapprochement IA.
        name: label,
        aliases: [],
        popularity: 0,
        // Tracable et purgeable : cette entree vient d'une lecture de photo.
        isCustom: true,
        source: 'ai',
        createdAt: new Date().toISOString(),
      };
      if (tx) tx.set(ref, data);
      else await ref.set(data);
      return { created: true, brand: { id: docId, name: label, aliases: [], popularity: 0 } as BrandDocument };
    };
    // The interactive analysis joins its containment read to the brand write.
    // Existing callers without a callback keep their previous read/set path.
    const result = authorize ? await db.runTransaction(readOrCreate) : await readOrCreate();
    await authorize?.();
    rememberBrand(result.brand);
    if (result.created) logger.info('AI brand added to catalogue', { brandId: docId });
    return result.brand;
  } catch (error) {
    if (authorize && error instanceof HttpsError) throw error;
    await authorize?.();
    logger.error('AI brand could not be added to catalogue', { error });
    return null;
  }
}

/** Ajoute la marque au cache chaud et reconstruit l'index de rapprochement. */
function rememberBrand(brand: BrandDocument): void {
  if (!brandsCache) return;
  if (brandsCache.some((b) => b.id === brand.id)) return;
  brandsCache = [...brandsCache, brand];
  brandsFuse = buildFuseIndex(brandsCache);
}

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
  brandsFuse = buildFuseIndex(brandsCache);
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
