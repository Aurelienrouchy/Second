import { describe, expect, it } from 'vitest';
import { getMaterialItems, materials } from '@/data/materials';
import { getSizesForCategory, SIZE_DATA } from '@/data/sizes';
import { SIZE_REFERENCE } from '@/functions/src/productReference';

describe('sell selectors and server AI reference', () => {
  it('sorts materials by displayed French label without mutating IDs or source order', () => {
    const before = materials.map(m => m.id);
    const items = getMaterialItems();
    expect(items.map(m => m.label)).toEqual(items.map(m => m.label).sort((a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base' })));
    expect(items.map(m => m.value).sort()).toEqual([...before].sort());
    expect(materials.map(m => m.id)).toEqual(before);
    expect(items.findIndex(m => m.value === 'elasthanne')).toBeLessThan(items.findIndex(m => m.value === 'fourrure'));
  });
  it.each(SIZE_DATA.map(item => [item.categoryType]))('offers exactly the sizes the server may suggest for %s', (categoryType) => {
    const server = SIZE_REFERENCE.find(item => item.categoryType === categoryType)!;
    const client = SIZE_DATA.find(item => item.categoryType === categoryType)!;
    expect(server.sizes).toEqual([...new Set(client.sizes)]);
  });
  it('has no duplicate clothing sizes and includes the extended adult catalog', () => {
    const sizes = getSizesForCategory(['women', 'women_clothing']);
    expect(sizes).toContain('5XL');
    expect(new Set(sizes).size).toBe(sizes.length);
  });
});
