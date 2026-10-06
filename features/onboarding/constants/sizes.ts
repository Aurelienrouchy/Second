/**
 * Onboarding size constants — Tailles reelles (marche canadien / Montreal)
 */

import type { OnboardingPreferences, SizeSystem } from '../types';

export const SIZE_SYSTEM_OPTIONS: { id: SizeSystem; label: string }[] = [
  { id: 'US', label: 'US' },
  { id: 'EU', label: 'EU' },
];

export const SEXE_OPTIONS: { id: OnboardingPreferences['sex']; label: string }[] = [
  { id: 'femme', label: 'Femme' },
  { id: 'homme', label: 'Homme' },
  { id: 'les-deux', label: 'Les deux' },
  { id: 'enfant', label: 'Enfant' },
];

// Onboarding and sell selectors use the same catalog as the server reference.
export {
  SIZES_ADULT_TOPS_US, SIZES_ADULT_BOTTOMS_US, SIZES_ADULT_SHOES_US,
  SIZES_ADULT_TOPS_EU, SIZES_ADULT_BOTTOMS_EU, SIZES_ADULT_SHOES_EU,
  SIZES_KIDS_TOPS_US, SIZES_KIDS_BOTTOMS_US, SIZES_KIDS_SHOES_US,
  SIZES_KIDS_TOPS_EU, SIZES_KIDS_BOTTOMS_EU, SIZES_KIDS_SHOES_EU,
} from '@/data/sizes';
