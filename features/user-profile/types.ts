/**
 * User Profile feature — shared types.
 */

export type ProfileTab = 'articles' | 'avis';

export interface Review {
  id: string;
  reviewerName: string;
  reviewerImage?: string;
  reviewerId?: string;
  date: string;
  text: string;
  note: number;
}
