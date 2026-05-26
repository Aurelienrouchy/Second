/**
 * User Profile feature — shared types.
 */

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
