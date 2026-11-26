import { afterEach, expect, it, vi } from 'vitest';
import { ShipEngineClient } from './shipEngine';
import { parsePurchaseRates } from '../utils/shippingPurchaseRate';
import { purchaseRawRates } from '../utils/testHelpers/shippingPurchaseFixture';
afterEach(() => vi.unstubAllGlobals());
it('strict POST uses declared units/complete contact and GET reuses original shipment identity', async () => {
  const requests: any[] = [];
  vi.stubGlobal('fetch', async (url: string, options: any) => { requests.push({ url, method: options.method, body: options.body ? JSON.parse(options.body) : null });
    const raw = purchaseRawRates(); return { ok: true, status: 200, headers: { get: () => null }, json: async () => url.endsWith('/carriers') ? { carriers: [{ carrier_id: 'se-carrier' }] } : options.method === 'GET' ? [raw.rate_response] : raw }; });
  const client = new ShipEngineClient({ apiKey: 'local_fake', baseUrl: 'https://example.invalid' });
  const address = { name: 'Nom réel', addressLine1: '123 Exemple', cityLocality: 'Montréal', stateProvince: 'QC', postalCode: 'H2X1A1', countryCode: 'CA' };
  const parcel = { weight: { value: 1.1, unit: 'kilogram' as const }, dimensions: { length: 35, width: 26, height: 12, unit: 'centimeter' as const } };
  const first = await client.getPurchaseRates({ ...address, phone: '5145550000' }, address, parcel);
  const again = await client.getPurchaseRatesForShipment(first.shipmentId);
  expect(again.rates).toEqual(first.rates); expect(again.shipmentId).toBe(first.shipmentId);
  expect(again.qualification.contexts.map(p => p.location)).toEqual(['group']);
  expect(first.qualification.contexts.map(p => p.location)).toEqual(['root', 'group']); expect(first.rates[0].shippingCents).toBe(1075);
  expect(requests[1].body.shipment.packages).toEqual([parcel]); expect(requests[1].body.shipment.ship_to).not.toHaveProperty('phone');
  expect(requests[2]).toEqual({ url: 'https://example.invalid/v1/shipments/se-shipment/rates', method: 'GET', body: null });
});
it.each(['insurance_amount', 'confirmation_amount', 'other_amount', 'shipping_amount'])('omitted %s is unknown, not zero', field => {
  const raw: any = purchaseRawRates(); delete raw.rate_response.rates[0][field]; expect(() => parsePurchaseRates(raw)).toThrow();
});
it.each(['USD', 'NaN', 'negative', 'subcent', 'estimate', 'invalid', 'warning', 'errors', 'status', 'identity', 'duplicate', 'missing_currency', 'unknown_envelope', 'different_shipment'])('unqualified %s cannot enter a payable quote', type => {
  const raw: any = purchaseRawRates(), rate = raw.rate_response.rates[0];
  if (type === 'USD') rate.shipping_amount.currency = 'USD';
  if (type === 'NaN') rate.shipping_amount.amount = NaN;
  if (type === 'negative') rate.shipping_amount.amount = -1;
  if (type === 'subcent') rate.shipping_amount.amount = 1.001;
  if (type === 'estimate') rate.rate_type = 'estimate';
  if (type === 'invalid') rate.validation_status = 'invalid';
  if (type === 'warning') rate.warning_messages = ['Address partially valid'];
  if (type === 'errors') raw.rate_response.errors = ['error'];
  if (type === 'status') raw.rate_response.status = 'working';
  if (type === 'identity') rate.rate_id = 'fallback_1';
  if (type === 'duplicate') raw.rate_response.rates.push(structuredClone(rate));
  if (type === 'missing_currency') delete rate.other_amount.currency;
  if (type === 'unknown_envelope') return expect(() => parsePurchaseRates({ unknown: raw })).toThrow();
  expect(() => parsePurchaseRates(raw, type === 'different_shipment' ? 'se-other' : undefined)).toThrow();
});
it('one invalid rate does not erase a complete valid alternative; no fabricated delivery date', () => {
  const raw: any = purchaseRawRates(); const invalid = structuredClone(raw.rate_response.rates[0]); invalid.rate_id = 'se-invalid'; invalid.validation_status = 'unknown';
  raw.rate_response.rates.push(invalid); delete raw.rate_response.rates[0].estimated_delivery_days;
  expect(parsePurchaseRates(raw).rates).toHaveLength(1); expect(parsePurchaseRates(raw).rates[0].estimatedDeliveryDays).toBeNull();
});

it('documented delivery_days is displayed as an estimate, not a delivery guarantee', () => {
  const raw: any = purchaseRawRates(); raw.rate_response.rates[0].delivery_days = 4; raw.rate_response.rates[0].estimated_delivery_days = 9;
  expect(parsePurchaseRates(raw).rates[0].estimatedDeliveryDays).toBe(4);
});
it('invalid group cannot qualify itself from a different valid shipment group', () => {
  const bad: any = purchaseRawRates().rate_response; bad.rates[0].validation_status = 'invalid';
  const good: any = purchaseRawRates().rate_response; good.shipment_id = 'se-other';
  expect(() => parsePurchaseRates([bad, good], 'se-shipment')).toThrow();
  expect(parsePurchaseRates([bad, good], 'se-other').rates).toHaveLength(1);
});

it('documented null delivery_days remains unknown rather than borrowing a conflicting secondary estimate', () => {
  const raw: any = purchaseRawRates(); raw.rate_response.rates[0].delivery_days = null;
  expect(parsePurchaseRates(raw).rates[0].estimatedDeliveryDays).toBeNull();
});
