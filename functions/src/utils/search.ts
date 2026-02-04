/**
 * Search utilities
 */

/**
 * Generate search keywords from text
 * Creates individual words, bigrams, and prefixes for fuzzy searching
 */
export function generateSearchKeywords(text: string): string[] {
  if (!text) return [];

  const words = text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 2);

  const keywords = new Set<string>();

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
export function calculatePopularityScore(
  views: number,
  likes: number,
  createdAt: Date
): number {
  const now = new Date();
  const ageInDays =
    (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24);

  // Decay factor: newer items get higher scores
  const ageFactor = Math.exp(-ageInDays / 30); // 30-day half-life

  // Engagement score
  const engagementScore = views * 0.1 + likes * 2;

  // Final score with time decay
  return engagementScore * ageFactor;
}
