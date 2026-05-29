/**
 * Article detail screen helpers.
 */

import { APP_LOCALE } from '@/constants/locale';
import type { Article } from '@/types';

/** Build tags from real Article fields: size, condition, color, material, pattern */
export const buildTags = (article: Article) => {
  const tags: string[] = [];
  if (article.size?.value) tags.push(`Taille ${article.size.value}`);
  if (article.condition) tags.push(article.condition);
  if (article.colors && article.colors.length > 0) {
    article.colors.forEach((c) => tags.push(c));
  } else if (article.color) {
    tags.push(article.color);
  }
  if (article.materials && article.materials.length > 0) {
    article.materials.forEach((m) => tags.push(m));
  } else if (article.material) {
    tags.push(article.material);
  }
  if (article.pattern) tags.push(article.pattern);
  return tags;
};

/** Compute discount percentage from price + originalPrice */
export const getDiscountPercent = (price: number, originalPrice?: number) => {
  if (!originalPrice || originalPrice <= price) return null;
  return Math.round((1 - price / originalPrice) * 100);
};

/** Ionicons icon name for meetup spot category (emojis banned by DS). */
export const spotIcon = (category?: string): string => {
  switch (category) {
    case 'cafe': return 'cafe-outline';
    case 'metro': return 'train-outline';
    case 'park': return 'leaf-outline';
    case 'library': return 'book-outline';
    case 'mall': return 'storefront-outline';
    case 'community_center': return 'people-outline';
    default: return 'location-outline';
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
  return date.toLocaleDateString(APP_LOCALE);
};
