/**
 * Onboarding types
 */

export interface OnboardingPreferences {
  sex: 'femme' | 'homme' | 'les-deux' | 'enfant';
  sizesTop: string[];
  sizesBottom: string[];
  sizesShoes: string[];
}

export type SizeSystem = 'US' | 'EU';
