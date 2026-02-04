"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BRAND_MATCHING = void 0;
exports.loadBrands = loadBrands;
exports.getBrandsFuse = getBrandsFuse;
exports.matchBrand = matchBrand;
exports.clearBrandsCache = clearBrandsCache;
/**
 * Brand matching service
 * Fuzzy matching with Fuse.js
 */
const fuse_js_1 = __importDefault(require("fuse.js"));
const firebase_1 = require("../config/firebase");
// Brand matching thresholds
exports.BRAND_MATCHING = {
    autoSelectThreshold: 0.9, // Auto-select without confirmation
    strongThreshold: 0.75, // Strong match (lowered from 0.85)
    suggestionThreshold: 0.5, // Show in suggestions
    fuseThreshold: 0.4, // Fuse.js threshold
    maxSuggestions: 5,
};
// In-memory cache for brands
let brandsCache = null;
let brandsCacheTimestamp = 0;
let brandsFuse = null;
const BRANDS_CACHE_TTL = 60 * 60 * 1000; // 1 hour
/**
 * Load brands from Firestore with caching
 */
async function loadBrands() {
    const now = Date.now();
    // Return cached brands if still valid
    if (brandsCache && now - brandsCacheTimestamp < BRANDS_CACHE_TTL) {
        console.log(`   [brands] Using cached brands (${brandsCache.length} brands, age: ${Math.round((now - brandsCacheTimestamp) / 1000)}s)`);
        return brandsCache;
    }
    const loadStart = Date.now();
    console.log('   [brands] Loading brands from Firestore...');
    const brandsSnapshot = await firebase_1.db.collection('brands').get();
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
    brandsFuse = new fuse_js_1.default(brandsCache, {
        keys: [
            { name: 'name', weight: 1.0 },
            { name: 'aliases', weight: 0.8 },
        ],
        threshold: exports.BRAND_MATCHING.fuseThreshold,
        includeScore: true,
        ignoreLocation: true,
        minMatchCharLength: 2,
        findAllMatches: true,
    });
    const fuseTime = Date.now() - fuseStart;
    console.log(`   [brands] Loaded ${brandsCache.length} brands (Firestore: ${firestoreTime}ms, Fuse index: ${fuseTime}ms)`);
    return brandsCache;
}
/**
 * Get or build Fuse index
 */
async function getBrandsFuse() {
    if (!brandsFuse ||
        !brandsCache ||
        Date.now() - brandsCacheTimestamp >= BRANDS_CACHE_TTL) {
        await loadBrands();
    }
    return brandsFuse;
}
/**
 * Fuzzy match a detected brand name against the brands database
 */
async function matchBrand(detectedBrand) {
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
    const exactMatch = brands.find((b) => {
        var _a;
        return b.name.toLowerCase() === normalizedInput ||
            ((_a = b.aliases) === null || _a === void 0 ? void 0 : _a.some((a) => a.toLowerCase() === normalizedInput));
    });
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
        limit: exports.BRAND_MATCHING.maxSuggestions,
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
    const isAutoSelect = confidence >= exports.BRAND_MATCHING.autoSelectThreshold;
    const isStrongMatch = confidence >= exports.BRAND_MATCHING.strongThreshold;
    // Filter suggestions
    const suggestions = results
        .filter((r) => 1 - (r.score || 0) >= exports.BRAND_MATCHING.suggestionThreshold)
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
function clearBrandsCache() {
    brandsCache = null;
    brandsCacheTimestamp = 0;
    brandsFuse = null;
}
//# sourceMappingURL=brands.js.map