import { afterEach, describe, expect, it, vi } from 'vitest';
import { ShipEngineClient } from './shipEngine';
afterEach(() => vi.unstubAllGlobals());
describe('ShipEngine estimate uses the actual flattened variant without a payable ID', () => {
  it('sends carrier IDs and real zones/date/weight, never shipment street placeholders', async () => {
    const requests: { url: string; body: any }[] = [];
    vi.stubGlobal('fetch', async (url: string, options: any) => {
      requests.push({ url, body: options.body ? JSON.parse(options.body) : null });
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => url.endsWith('/carriers') ?
        { carriers: [{ carrier_id: 'se-12345' }] } : [{ rate_id: 'ignored', carrier_id: 'se-12345', carrier_code: 'canada_post',
          carrier_friendly_name: 'Postes Canada', service_code: 'parcel', service_type: 'Parcel', shipping_amount: { amount: 6, currency: 'cad' }, estimated_delivery_days: 2 }] };
    });
    const engine = new ShipEngineClient({ apiKey: 'fake_local_key', baseUrl: 'https://example.invalid' });
    const from = { country: 'CA' as const, postalCode: 'H2X1A1', city: 'Montréal', province: 'QC' }, to = { ...from, postalCode: 'G1R1A1', city: 'Québec' };
    const result = await engine.getRateEstimates(from, to, { weight: { value: 0.5, unit: 'kilogram' } }, '2026-10-10T16:00:00Z');
    expect(requests[1].url).toBe('https://example.invalid/v1/rates/estimate');
    expect(requests[1].body).toEqual({ carrier_ids: ['se-12345'], from_country_code: 'CA', from_postal_code: 'H2X1A1', from_city_locality: 'Montréal',
      from_state_province: 'QC', to_country_code: 'CA', to_postal_code: 'G1R1A1', to_city_locality: 'Québec', to_state_province: 'QC',
      weight: { value: 0.5, unit: 'kilogram' }, ship_date: '2026-10-10T16:00:00Z' });
    expect(result[0]).not.toHaveProperty('rateId'); expect(JSON.stringify(requests[1].body)).not.toMatch(/street|address_line1|shipment/);
  });
  it('no carriers means no estimate request, no empty filter interpreted as all carriers', async () => {
    const fetch = vi.fn(async () => ({ ok: true, headers: { get: () => null }, json: async () => ({ carriers: [] }) })); vi.stubGlobal('fetch', fetch);
    const engine = new ShipEngineClient({ apiKey: 'fake_local_key', baseUrl: 'https://example.invalid' });
    const zone = { country: 'CA' as const, postalCode: 'H2X1A1', city: 'Montréal', province: 'QC' };
    expect(await engine.getRateEstimates(zone, zone, { weight: { value: 0.5, unit: 'kilogram' } }, '2026-10-10T16:00:00Z')).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
