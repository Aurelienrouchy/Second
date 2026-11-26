/** Request boundary follows the primary rates guide, not a claim of real API failure. */
import { afterEach, expect, it, vi } from 'vitest';
import { ShipEngineClient } from './shipEngine';
import { purchaseRawRates } from '../utils/testHelpers/shippingPurchaseFixture';
afterEach(() => vi.unstubAllGlobals());
const a = { name: 'Nom réel', addressLine1: '123 Exemple', cityLocality: 'Montréal', stateProvince: 'QC', postalCode: 'H2X1A1', countryCode: 'CA' };
const parcel = { weight: { value: 0.8, unit: 'kilogram' as const }, dimensions: { length: 30, width: 20, height: 10, unit: 'centimeter' as const } };
const client = () => new ShipEngineClient({ apiKey: 'local_fake', baseUrl: 'https://example.invalid' });
it('POST includes only actual qualified carrier IDs read from current account, not omission or invented ID', async () => {
  const requests: any[] = [];
  vi.stubGlobal('fetch', async (url: string, options: any) => {
    const body = options.body ? JSON.parse(options.body) : null; requests.push({ url, body });
    if (url.endsWith('/carriers')) return { ok: true, headers: { get: () => null }, json: async () => ({ carriers: [
      { carrier_id: 'se-carrier', connection_status: 'approved' }, { carrier_id: 'se-carrier' },
      { carrier_id: 'se-other' }, { carrier_id: 'se-pending', connection_status: 'pending_approval' },
      { carrier_id: 'invalid' }, { carrier_id: 'se-unknown', connection_status: 'unexpected' },
    ] }) };
    // This boundary assertion encodes the guide's requested shape only.
    expect(body?.rate_options?.carrier_ids).toEqual(['se-carrier', 'se-other']);
    return { ok: true, headers: { get: () => null }, json: async () => purchaseRawRates() };
  });
  expect((await client().getPurchaseRates(a, a, parcel)).rates[0].carrierId).toBe('se-carrier');
  expect(requests[0].url).toBe('https://example.invalid/v1/carriers'); expect(requests[1].url).toBe('https://example.invalid/v1/rates');
});
it.each(['empty', 'pending', 'malformed', 'list_error'])('carrier discovery %s: no rate POST, no empty selection interpreted as all', async mode => {
  const calls: string[] = [];
  vi.stubGlobal('fetch', async (url: string) => { calls.push(url);
    if (mode === 'list_error') return { ok: false, status: 400, headers: { get: () => null }, text: async () => 'Carrier list unavailable' };
    return { ok: true, headers: { get: () => null }, json: async () => mode === 'malformed' ? { carriers: {} } :
      { carriers: mode === 'pending' ? [{ carrier_id: 'se-pending', connection_status: 'pending_approval' }] : [] } };
  });
  await expect(client().getPurchaseRates(a, a, parcel)).rejects.toBeDefined(); expect(calls).toEqual(['https://example.invalid/v1/carriers']);
});
it('provider response with an unrequested carrier cannot qualify a quote through a valid-looking rate', async () => {
  vi.stubGlobal('fetch', async (url: string) => ({ ok: true, headers: { get: () => null }, json: async () => url.endsWith('/carriers') ?
    { carriers: [{ carrier_id: 'se-other', connection_status: 'approved' }] } : purchaseRawRates() }));
  await expect(client().getPurchaseRates(a, a, parcel)).rejects.toBeDefined();
});
