/** Domestic CA syntax/coherence, not deliverability or residence verification. */
export const CA_POSTAL_RE = /^[ABCEGHJKLMNPRSTVXY]\d[ABCEGHJKLMNPRSTVWXYZ]\d[ABCEGHJKLMNPRSTVWXYZ]\d$/;
export const CA_PROVINCE_CODES = new Set(['AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT']);
export interface CanadianAddress { street: string; city: string; province: string; postalCode: string; country: 'CA'; line2?: string; }
const provinces: Record<string, string> = { A: 'NL', B: 'NS', C: 'PE', E: 'NB', G: 'QC', H: 'QC', J: 'QC',
  K: 'ON', L: 'ON', M: 'ON', N: 'ON', P: 'ON', R: 'MB', S: 'SK', T: 'AB', V: 'BC', Y: 'YT' };
export function normalizeCanadianPostal(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim().toUpperCase();
  if (!/^[A-Z]\d[A-Z] ?\d[A-Z]\d$/.test(value)) return null;
  const postal = value.replace(' ', ''); return CA_POSTAL_RE.test(postal) ? postal : null;
}
export function postalMatchesProvince(postal: string, province: string): boolean {
  if (postal[0] === 'X') return province === (/^X0[ABC]/.test(postal) ? 'NU' : 'NT');
  return provinces[postal[0]] === province;
}
export function canadianCountry(raw: unknown): boolean { return raw === undefined || (typeof raw === 'string' && raw.trim().toUpperCase() === 'CA'); }
export function normalizeCanadianAddress(raw: unknown): CanadianAddress | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const a = raw as Record<string, unknown>;
  if (!canadianCountry(a.country) || typeof a.street !== 'string' || typeof a.city !== 'string' || typeof a.province !== 'string') return null;
  const street = a.street.trim(), city = a.city.trim(), province = a.province.trim().toUpperCase(), postalCode = normalizeCanadianPostal(a.postalCode);
  if (!street || street.length > 200 || !city || city.length > 100 || !CA_PROVINCE_CODES.has(province) || !postalCode || !postalMatchesProvince(postalCode, province)) return null;
  if (a.line2 !== undefined && (typeof a.line2 !== 'string' || a.line2.trim().length > 200)) return null;
  return { street, city, province, postalCode, country: 'CA', ...(typeof a.line2 === 'string' && a.line2.trim() ? { line2: a.line2.trim() } : {}) };
}
