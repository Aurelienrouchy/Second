import { describe, expect, it } from 'vitest';
import { validateCanadianAddress } from './addressValidation';

const address = { street: ' 123 rue Test ', city: ' Montréal ', province: 'qc', postalCode: 'h2x1y4', country: 'CA' };

describe('Canadian address save validation', () => {
  it('normalizes an address from either autocomplete or manual entry', () => {
    expect(validateCanadianAddress(address)).toEqual({ valid: true, address: {
      street: '123 rue Test', city: 'Montréal', province: 'QC', postalCode: 'H2X 1Y4', country: 'Canada',
    } });
  });
  it.each([
    [{ street: '' }, 'missing_fields'],
    [{ city: '' }, 'missing_fields'],
    [{ postalCode: '' }, 'missing_fields'],
    [{ province: 'ZZ' }, 'province'],
    [{ postalCode: '12345' }, 'postal_code'],
    [{ postalCode: 'D2X 1Y4' }, 'postal_code'],
    [{ country: 'US' }, 'country'],
  ])('rejects incomplete or unsupported values before persistence', (change, error) => {
    expect(validateCanadianAddress({ ...address, ...change })).toEqual({ valid: false, error });
  });
});
