/**
 * Profile feature — shared types.
 */

import type { Ionicons } from '@expo/vector-icons';

export interface MenuItem {
  id: string;
  title: string;
  subtitle?: string;
  icon: keyof typeof Ionicons.glyphMap;
  iconColor: string;
  iconBg: string;
  action: () => void;
}

export interface StatItemData {
  value: string | number;
  label: string;
  delay?: number;
}

// =============================================================================
// PROFIL PUBLIC (vendeur consulté) — ex-feature user-profile
// =============================================================================

export type ProfileTab = 'articles' | 'avis';

/**
 * Review as displayed in the user-profile UI.
 * Mapped from ReviewService's Review type in app/user/[id].tsx.
 */
export interface ProfileReview {
  id: string;
  reviewerName: string;
  reviewerImage?: string;
  reviewerId?: string;
  date: string;
  text: string;
  note: number;
}
