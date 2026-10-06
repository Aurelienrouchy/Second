import { describe, expect, it } from 'vitest';
import { SIZES_ADULT_TOPS_EU as onboardingTops } from './sizes';
import { SIZES_ADULT_TOPS_EU } from '@/data/sizes';

describe('onboarding size catalog', () => {
  it('shares the extended clothing catalog with the sell selectors', () => {
    expect(onboardingTops).toEqual(SIZES_ADULT_TOPS_EU);
    expect(onboardingTops).toContain('5XL');
  });
});
