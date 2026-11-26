import {articleAvailability} from '@/utils/articleAvailability';
const projection = (state: string) => ({protocol: 'inventory_article_availability_v1', state});

it('distinguishes the native reservation lock from a final consumed item', () => {
  expect(articleAvailability({isSold: true, inventoryAvailability: projection('engaged')})).toBe('reserved');
  expect(articleAvailability({isSold: true, inventoryAvailability: projection('consumed')})).toBe('sold');
});
it.each([undefined, null, {}, {state: 'engaged'}, {protocol: 'other', state: 'engaged'}, projection('available'), projection('unknown')])('does not infer final sale or reservation from an unqualified sold lock', inventoryAvailability => {
  expect(articleAvailability({isSold: true, inventoryAvailability})).toBe('unavailable');
});
it('keeps new articles available and inactive sources closed', () => {
  expect(articleAvailability({isSold: false})).toBe('available');
  expect(articleAvailability({isSold: false, inventoryAvailability: projection('engaged')})).toBe('reserved');
  expect(articleAvailability({isSold: true, isActive: false, inventoryAvailability: projection('engaged')})).toBe('unavailable');
});
