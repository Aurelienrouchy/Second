"use strict";
/**
 * Search utilities
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeSearchText = normalizeSearchText;
exports.generateSearchKeywords = generateSearchKeywords;
exports.calculatePopularityScore = calculatePopularityScore;
/**
 * Normalize free text for search indexing AND query matching.
 *
 * NOTE: this exact function is duplicated verbatim in
 * `services/articlesService.ts` (client). There is no shared module possible
 * between Cloud Functions and the Expo app, so the two copies MUST stay in
 * sync — any change here must be mirrored there (and vice-versa), otherwise
 * the keywords written by the indexer and the keyword built by the client
 * query diverge and matches silently break.
 *
 * Steps: NFD decompose -> strip diacritics -> lowercase -> strip punctuation
 * -> collapse whitespace -> trim.
 */
function normalizeSearchText(input) {
    return (input !== null && input !== void 0 ? input : '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '') // strip diacritiques
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ') // strip ponctuation
        .replace(/\s+/g, ' ')
        .trim();
}
/**
 * Generate search keywords from text
 * Creates individual words, bigrams, and prefixes for fuzzy searching
 */
function generateSearchKeywords(text) {
    if (!text)
        return [];
    const words = normalizeSearchText(text)
        .split(' ')
        .filter((word) => word.length > 2);
    const keywords = new Set();
    // Add individual words
    words.forEach((word) => keywords.add(word));
    // Add word combinations (bigrams)
    for (let i = 0; i < words.length - 1; i++) {
        keywords.add(`${words[i]} ${words[i + 1]}`);
    }
    // Add partial matches (prefixes)
    words.forEach((word) => {
        if (word.length > 3) {
            for (let i = 3; i <= word.length; i++) {
                keywords.add(word.substring(0, i));
            }
        }
    });
    return Array.from(keywords);
}
/**
 * Calculate popularity score for ranking
 * Uses time decay and engagement metrics
 */
function calculatePopularityScore(views, likes, createdAt) {
    const now = new Date();
    const ageInDays = (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24);
    // Decay factor: newer items get higher scores
    const ageFactor = Math.exp(-ageInDays / 30); // 30-day half-life
    // Engagement score
    const engagementScore = views * 0.1 + likes * 2;
    // Final score with time decay
    return engagementScore * ageFactor;
}
//# sourceMappingURL=search.js.map