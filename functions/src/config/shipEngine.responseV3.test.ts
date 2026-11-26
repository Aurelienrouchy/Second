/** Author V3 boundaries: normalized echoes never certify physical measurements. */
import { expect, it } from 'vitest';
import { parsePurchaseRates, type PurchaseRateContext } from '../utils/shippingPurchaseRate';
import { purchaseRawRates } from '../utils/testHelpers/shippingPurchaseFixture';
const address = { name: 'Nom Réel', addressLine1: '123 Exemple', cityLocality: 'Montréal', stateProvince: 'QC', postalCode: 'H2X1A1', countryCode: 'CA' };
const context: PurchaseRateContext = { shipFrom: address, shipTo: address,
  parcel: { weight: { value: 1, unit: 'kilogram' }, dimensions: { length: 25.4, width: 12.7, height: 2.54, unit: 'centimeter' } } };
const echo = () => ({ name: ' nom réel ', address_line1: '123  exemple', city_locality: 'MONTRÉAL', state_province: 'qc', postal_code: 'h2x 1a1', country_code: 'ca', phone: null, address_line2: '' });
const parse = (raw: any) => parsePurchaseRates(raw, 'se-shipment', context);
it('matching root/group/rate identities, lexical postal/case/space and documented units retain private proof', () => {
  const r: any = purchaseRawRates(); r.shipment_id = 'se-shipment'; r.ship_to = echo(); r.ship_from = echo(); r.is_return = false;
  r.packages = [{ weight: { value: 1000, unit: 'gram' }, dimensions: { length: 10, width: 5, height: 1, unit: 'inch' } }];
  r.rate_response.rates[0].shipment_id = 'se-shipment';
  const parsed = parse(r); expect(parsed.rates[0].shippingCents).toBe(1075);
  expect(parsed.qualification.contexts[0]).toMatchObject({ shipTo: { state: 'provided', value: { postal_code: 'H2X1A1' } }, packages: { state: 'provided', value: [context.parcel] } });
});
it.each(['kilogram','gram','pound','ounce'])('documented %s conversion does not mutate the declaration or invent measured accuracy', unit => {
  const factor = { kilogram: 1, gram: 0.001, pound: 0.45359237, ounce: 0.028349523125 }[unit]!;
  const r: any = purchaseRawRates(); r.packages = [{ weight: { value: 1 / factor, unit }, dimensions: context.parcel.dimensions }];
  expect(parse(r).qualification.contexts[0].packages).toMatchObject({ state: 'provided', value: [{ weight: { value: 1, unit: 'kilogram' } }] });
});
it.each(['absent','null'])('optional %s address/package is unobserved, not a verified match', kind => {
  const r: any = purchaseRawRates(); if (kind === 'null') { r.ship_to = null; r.ship_from = null; r.packages = null; }
  expect(parse(r).qualification.contexts[0]).toMatchObject({ shipTo: { state: kind }, packages: { state: kind } });
});
it.each(['unknown_unit','empty_packages','two_packages','dimensions_missing','text_weight','zero','country_missing','line2','email','company','rate_null_id','group_destination'])('%s explicit ambiguous evidence cannot be projected away', kind => {
  const r: any = purchaseRawRates(); r.ship_to = echo(); r.packages = [structuredClone(context.parcel)];
  if (kind === 'unknown_unit') r.packages[0].weight.unit = 'ton';
  if (kind === 'empty_packages') r.packages = [];
  if (kind === 'two_packages') r.packages.push(structuredClone(context.parcel));
  if (kind === 'dimensions_missing') delete r.packages[0].dimensions;
  if (kind === 'text_weight') r.packages[0].weight.value = '1';
  if (kind === 'zero') r.packages[0].weight.value = 0;
  if (kind === 'country_missing') delete r.ship_to.country_code;
  if (kind === 'line2') r.ship_to.address_line2 = 'foreign unit';
  if (kind === 'email') r.ship_to.email = 'foreign@example.invalid';
  if (kind === 'company') r.ship_to.company_name = 'different recipient';
  if (kind === 'rate_null_id') r.rate_response.rates[0].shipment_id = null;
  if (kind === 'group_destination') r.rate_response.ship_to = { ...echo(), address_line1: 'different' };
  expect(() => parse(r)).toThrow();
});
it.each(['unknown_type','NaN','subcent','unsafe','positive_discount','mixed_currency','mixed_rate_contradiction'])('%s cannot turn explicit details into another price', kind => {
  const r: any = purchaseRawRates(), rate = r.rate_response.rates[0];
  rate.rate_details = [{ rate_detail_type: 'shipping', amount: { currency: 'CAD', amount: 10.75 } }];
  if (kind === 'unknown_type') rate.rate_details[0].rate_detail_type = 'future_unknown';
  if (kind === 'NaN') rate.rate_details[0].amount.amount = NaN;
  if (kind === 'subcent') rate.rate_details[0].amount.amount = 10.751;
  if (kind === 'unsafe') rate.rate_details[0].amount.amount = Number.MAX_SAFE_INTEGER;
  if (kind === 'positive_discount') rate.rate_details = [{ rate_detail_type: 'shipping', amount: { currency: 'CAD', amount: 11.75 } }, { rate_detail_type: 'discount', amount: { currency: 'CAD', amount: 1 } }];
  if (kind === 'mixed_currency') rate.rate_details.push({ rate_detail_type: 'tax', amount: { currency: 'USD', amount: 0 } });
  if (kind === 'mixed_rate_contradiction') { const other = structuredClone(rate); other.rate_id = 'se-other'; other.rate_details[0].amount.amount = 100; r.rate_response.rates.push(other); }
  expect(() => parse(r)).toThrow();
});
it('valid neighbor cannot qualify an invalid rate; optional memos are not transported', () => {
  const r: any = purchaseRawRates(); const invalid = structuredClone(r.rate_response.rates[0]); invalid.rate_id = 'se-invalid'; invalid.validation_status = 'invalid';
  invalid.rate_details = [{ rate_detail_type: 'shipping', amount: { currency: 'CAD', amount: 100 } }]; r.rate_response.rates.push(invalid);
  r.rate_response.rates[0].rate_details = [{ rate_detail_type: 'shipping', amount: { currency: 'CAD', amount: 10.75 }, carrier_memo: 'PRIVATE' }];
  const p = parse(r); expect(p.rates).toHaveLength(1); expect(p.qualification.details).toEqual([{ rateId: 'se-rate', state: 'provided', entries: [{ type: 'shipping', cents: 1075 }] }]);
  expect(JSON.stringify(p)).not.toContain('PRIVATE');
});
it('explicit total_weight cannot contradict the declared single parcel', () => {
  const r: any = purchaseRawRates(); r.total_weight = { value: 99, unit: 'kilogram' };
  expect(() => parse(r)).toThrow();
});
it('aggregate mass accepts documented units, distinct from assessed volumetric carrier_weight', () => {
  const r: any = purchaseRawRates(); r.total_weight = { value: 1000, unit: 'gram' };
  r.rate_response.rates[0].carrier_weight = { value: 9, unit: 'pound' };
  expect(parse(r).qualification.contexts[0]).toMatchObject({ totalWeight: { state: 'provided', value: 1 } });
  expect(parse(r).rates[0].shippingCents).toBe(1075);
});
