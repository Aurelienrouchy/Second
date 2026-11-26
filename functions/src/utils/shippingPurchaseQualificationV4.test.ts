/** Author V4: private seeded corruption, never a demonstrated client forge or charge. */
import { expect, it } from 'vitest';
import { hasCurrentRateQualification, parsePurchaseRates, type PurchaseRateContext } from './shippingPurchaseRate';
import { purchaseRawRates, purchaseParcel, purchaseAddress } from './testHelpers/shippingPurchaseFixture';
const address = { name: purchaseAddress.name, addressLine1: purchaseAddress.street, cityLocality: purchaseAddress.city,
  stateProvince: 'QC', postalCode: 'H2X1A1', countryCode: 'CA', phone: '5145551234' };
const context = { shipFrom: address, shipTo: address, parcel: purchaseParcel } as PurchaseRateContext;
function complete() {
  const r: any = purchaseRawRates(); r.shipment_id = 'se-shipment';
  const a = { name: address.name, address_line1: address.addressLine1, city_locality: address.cityLocality, state_province: 'QC', postal_code: 'H2X1A1', country_code: 'CA', phone: address.phone };
  r.ship_from = a; r.ship_to = { ...a }; r.packages = [purchaseParcel]; r.total_weight = { value: 0.8, unit: 'kilogram' }; r.is_return = false;
  return r;
}
const negative = ['root_id','group_id','unknown_location','duplicate_root','duplicate_group','missing_field','unknown_state','absent_value','null_value','missing_value','group_id_absent','group_id_null','foreign_contact','empty_address','extra_address','missing_name','unknown_unit','two_packages','text_measure','wrong_weight','unsafe_weight','return_true','source_mismatch','rate_id_duplicate','rate_shipment','rate_component_negative','rate_component_text','rate_sum','detail_type','detail_duplicate','detail_overflow','no_source'];
it.each(negative)('V4 %s cannot qualify a persisted private source merely by version3', kind => {
  const data: any = structuredClone(parsePurchaseRates(complete(), undefined, context));
  const [root, group] = data.qualification.contexts;
  if (kind === 'root_id') root.shipmentId.value = 'se-other';
  if (kind === 'group_id') group.shipmentId.value = 'se-other';
  if (kind === 'unknown_location') root.location = 'future';
  if (kind === 'duplicate_root') data.qualification.contexts.push(structuredClone(root));
  if (kind === 'duplicate_group') data.qualification.contexts.push(structuredClone(group));
  if (kind === 'missing_field') delete group.packages;
  if (kind === 'unknown_state') root.shipTo.state = 'future';
  if (kind === 'absent_value') group.shipTo = { state: 'absent', value: {} };
  if (kind === 'null_value') group.shipTo = { state: 'null', value: {} };
  if (kind === 'missing_value') root.shipTo = { state: 'provided' };
  if (kind === 'group_id_absent') group.shipmentId = { state: 'absent' };
  if (kind === 'group_id_null') group.shipmentId = { state: 'null' };
  if (kind === 'foreign_contact') root.shipFrom.value.phone = 'OTHER';
  if (kind === 'empty_address') group.shipTo = { state: 'provided', value: {} };
  if (kind === 'extra_address') root.shipTo.value.internalNote = 'PRIVATE';
  if (kind === 'missing_name') delete root.shipTo.value.name;
  if (kind === 'unknown_unit') root.packages.value[0].weight.unit = 'unknown';
  if (kind === 'two_packages') root.packages.value.push(structuredClone(root.packages.value[0]));
  if (kind === 'text_measure') root.packages.value[0].dimensions.width = '20';
  if (kind === 'wrong_weight') group.totalWeight = { state: 'provided', value: 99 };
  if (kind === 'unsafe_weight') group.totalWeight = { state: 'provided', value: Infinity };
  if (kind === 'return_true') group.isReturn = { state: 'provided', value: true };
  if (kind === 'rate_id_duplicate') { data.rates.push(structuredClone(data.rates[0])); data.qualification.details.push(structuredClone(data.qualification.details[0])); }
  if (kind === 'rate_shipment') data.rates[0].shipmentId = 'se-other';
  if (kind === 'rate_component_negative') data.rates[0].componentsCents.insurance = -1;
  if (kind === 'rate_component_text') data.rates[0].componentsCents.insurance = '100';
  if (kind === 'rate_sum') data.rates[0].shippingCents = 999;
  if (kind === 'detail_type') data.qualification.details[0] = { rateId: 'se-rate', state: 'provided', entries: [{ type: 'future', cents: 1075 }] };
  if (kind === 'detail_duplicate') data.qualification.details.push(structuredClone(data.qualification.details[0]));
  if (kind === 'detail_overflow') data.qualification.details[0] = { rateId: 'se-rate', state: 'provided', entries: [{ type: 'shipping', cents: Number.MAX_SAFE_INTEGER }, { type: 'shipping', cents: 1 }, { type: 'discount', cents: -Number.MAX_SAFE_INTEGER }, { type: 'shipping', cents: 1074 }] };
  const source = kind === 'source_mismatch' ? { ...context, shipTo: { ...address, name: 'OTHER' } } : kind === 'no_source' ? undefined : context;
  const before = structuredClone(data);
  expect(hasCurrentRateQualification(data, source)).toBe(false); expect(data).toEqual(before);
});
it.each(['full','group_only','absent','null','normalized_units','reordered','signed_details'])('V4 legitimate %s proof remains bound and unchanged', kind => {
  let r: any = complete();
  if (kind === 'group_only') r = r.rate_response;
  if (kind === 'absent') { for (const k of ['shipment_id','ship_from','ship_to','packages','total_weight','is_return']) delete r[k]; }
  if (kind === 'null') { for (const k of ['ship_from','ship_to','packages','total_weight','is_return']) r[k] = null; }
  if (kind === 'normalized_units') { r.packages = [{ weight: { value: 800, unit: 'gram' }, dimensions: { length: 40/2.54, width: 20/2.54, height: 15/2.54, unit: 'inch' } }]; r.ship_to.postal_code = 'h2x 1a1'; }
  if (kind === 'signed_details') r.rate_response.rates[0].rate_details = [{ rate_detail_type: 'shipping', amount: { currency: 'CAD', amount: 11.75 } }, { rate_detail_type: 'discount', amount: { currency: 'CAD', amount: -1 } }];
  const data = parsePurchaseRates(r, undefined, context); if (kind === 'reordered') data.qualification.contexts.reverse();
  const before = structuredClone(data); expect(hasCurrentRateQualification(data, context)).toBe(true); expect(data).toEqual(before);
});
