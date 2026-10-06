export interface CanadianAddressInput {
  street: string;
  city: string;
  province: string;
  postalCode: string;
  country: string;
}

const PROVINCES = new Set(['AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT']);
const POSTAL_CODE = /^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z] ?\d[ABCEGHJ-NPRSTV-Z]\d$/;

/** One save gate for manual, Google Places and fallback autocomplete addresses. */
export function validateCanadianAddress(input: CanadianAddressInput):
  | { valid: true; address: CanadianAddressInput }
  | { valid: false; error: 'missing_fields' | 'province' | 'postal_code' | 'country' } {
  const address = {
    street: input.street.trim(),
    city: input.city.trim(),
    province: input.province.trim().toUpperCase(),
    postalCode: input.postalCode.trim().toUpperCase().replace(/\s+/g, ''),
    country: input.country.trim(),
  };
  if (!address.street || !address.city || !address.province || !address.postalCode) {
    return { valid: false, error: 'missing_fields' };
  }
  if (!['canada', 'ca'].includes(address.country.toLowerCase())) return { valid: false, error: 'country' };
  if (!PROVINCES.has(address.province)) return { valid: false, error: 'province' };
  if (!POSTAL_CODE.test(address.postalCode)) return { valid: false, error: 'postal_code' };
  address.postalCode = `${address.postalCode.slice(0, 3)} ${address.postalCode.slice(3)}`;
  address.country = 'Canada';
  return { valid: true, address };
}
