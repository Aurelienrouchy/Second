import { describe, expect, it } from 'vitest';

import { applyPendingEdits } from './pendingEdits';

const fields = { title: 'Robe fleurie', description: 'Portée deux fois', price: 25, brand: 'Zara', size: 'M' };

describe('applyPendingEdits', () => {
  it('sans saisie en cours, rend les champs tels quels', () => {
    expect(applyPendingEdits(fields, {})).toEqual(fields);
  });

  it('applique ce qui est tapé mais pas encore « Confirmé », nettoyé comme à la confirmation', () => {
    expect(
      applyPendingEdits(fields, { title: '  Robe d’été  ', price: '22,50', brand: ' ' }),
    ).toEqual({ ...fields, title: 'Robe d’été', price: 22.5, brand: '' });
  });

  it('un prix illisible vaut 0, comme à la confirmation — la validation le refuse ensuite', () => {
    expect(applyPendingEdits(fields, { price: 'abc' }).price).toBe(0);
  });
});
