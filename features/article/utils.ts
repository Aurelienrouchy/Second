/**
 * Article detail screen helpers.
 */

import type { Article } from '@/types';

/** Build tags from real Article fields: size, condition, color, material, pattern */
export const buildTags = (article: Article) => {
  const tags: string[] = [];
  if (article.size) tags.push(`Taille ${article.size}`);
  if (article.condition) tags.push(article.condition);
  if (article.color) tags.push(article.color);
  if (article.material) tags.push(article.material);
  if (article.pattern) tags.push(article.pattern);
  return tags;
};

/** Compute discount percentage from price + originalPrice */
export const getDiscountPercent = (price: number, originalPrice?: number) => {
  if (!originalPrice || originalPrice <= price) return null;
  return Math.round((1 - price / originalPrice) * 100);
};

/** Emoji for meetup spot category */
export const spotEmoji = (category: string) => {
  switch (category) {
    case 'cafe': return '☕';
    case 'metro': return '🚇';
    case 'park': return '🌳';
    case 'library': return '📚';
    default: return '📍';
  }
};

/** Format date relative to now in French. */
export const formatArticleDate = (date: Date) => {
  const now = new Date();
  const diffInMs = now.getTime() - date.getTime();
  const diffInDays = Math.floor(diffInMs / (1000 * 60 * 60 * 24));

  if (diffInDays === 0) return 'Aujourd\'hui';
  if (diffInDays === 1) return 'Hier';
  if (diffInDays < 7) return `Il y a ${diffInDays}j`;
  if (diffInDays < 30) return `Il y a ${Math.floor(diffInDays / 7)} sem.`;
  return date.toLocaleDateString('fr-FR');
};
