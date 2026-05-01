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

// Adulte — Tailles US (canadiennes)
export const SIZES_ADULT_TOPS_US = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL'];
export const SIZES_ADULT_BOTTOMS_US = ['24', '25', '26', '27', '28', '29', '30', '31', '32', '33', '34', '36', '38', '40'];
export const SIZES_ADULT_SHOES_US = [
  '5', '5.5', '6', '6.5', '7', '7.5', '8', '8.5',
  '9', '9.5', '10', '10.5', '11', '11.5', '12', '13',
];

// Adulte — Tailles EU
export const SIZES_ADULT_TOPS_EU = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL'];
export const SIZES_ADULT_BOTTOMS_EU = ['32', '34', '36', '38', '40', '42', '44', '46', '48', '50', '52'];
export const SIZES_ADULT_SHOES_EU = [
  '35', '35.5', '36', '36.5', '37', '37.5', '38', '38.5',
  '39', '39.5', '40', '40.5', '41', '42', '43', '44', '45', '46',
];

// Enfant — Tailles US (canadiennes)
export const SIZES_KIDS_TOPS_US = [
  '2T', '3T', '4T', '5', '6', '6X', '7', '8',
  '10', '12', '14', '16',
];
export const SIZES_KIDS_BOTTOMS_US = [
  '2T', '3T', '4T', '5', '6', '6X', '7', '8',
  '10', '12', '14', '16',
];
export const SIZES_KIDS_SHOES_US = [
  '5C', '6C', '7C', '8C', '9C', '10C', '11C', '12C', '13C',
  '1Y', '2Y', '3Y', '4Y', '5Y', '6Y', '7Y',
];

// Enfant — Tailles EU
export const SIZES_KIDS_TOPS_EU = [
  '2 ans', '3 ans', '4 ans', '5 ans', '6 ans', '8 ans',
  '10 ans', '12 ans', '14 ans', '16 ans',
];
export const SIZES_KIDS_BOTTOMS_EU = [
  '2 ans', '3 ans', '4 ans', '5 ans', '6 ans', '8 ans',
  '10 ans', '12 ans', '14 ans', '16 ans',
];
export const SIZES_KIDS_SHOES_EU = [
  '20', '21', '22', '23', '24', '25', '26', '27',
  '28', '29', '30', '31', '32', '33', '34', '35',
];
