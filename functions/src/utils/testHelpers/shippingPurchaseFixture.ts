/** Explicit new-operation author fixtures, never FirestoreMock defaults. */
import { SELLER_ACTIVITY_STATEMENTS, SELLER_ACTIVITY_STATEMENT_VERSION } from '../../shared/eligibility';
import { parsePurchaseRates } from '../shippingPurchaseRate';
export const purchaseAddress = { name: 'Acheteur Exemple', street: '123 Exemple', city: 'Montréal', province: 'QC', postalCode: 'H2X1A1', country: 'CA' };
export const purchaseParcel = { weight: { value: 0.8, unit: 'kilogram' }, dimensions: { length: 40, width: 20, height: 15, unit: 'centimeter' } };
export const personalProfile = (uid: string, kind: 'personal' | 'professional' = 'personal') => ({ version: 1,
  activityDeclaration: { kind, actorUid: uid, recordedAt: new Date('2026-10-10T16:00:00Z'), declarationVersion: 1,
    statementVersion: SELLER_ACTIVITY_STATEMENT_VERSION, statement: SELLER_ACTIVITY_STATEMENTS[kind] } });
export const purchaseAccount = (uid = 'seller') => ({ id: 'acct_purchase', type: 'custom', business_type: 'individual', country: 'CA', metadata: { firebaseUserId: uid },
  individual: { dob: { year: 2000, month: 1, day: 1 }, address: { line1: '999 Adresse privée', city: 'Montréal', state: 'QC', postal_code: 'H2X1A1', country: 'CA' } },
  charges_enabled: true, payouts_enabled: true, details_submitted: true, requirements: { currently_due: [], past_due: [] }, external_accounts: { data: [] } });
export const purchaseRawRates = () => ({ rate_response: { shipment_id: 'se-shipment', status: 'completed', errors: null, created_at: '2026-10-10T16:00:00Z',
  rates: [{ rate_id: 'se-rate', rate_type: 'shipment', carrier_id: 'se-carrier', carrier_code: 'canada_post', carrier_friendly_name: 'Canada Post', service_code: 'expedited', service_type: 'Parcel',
    shipping_amount: { amount: 9, currency: 'cad' }, insurance_amount: { amount: 1, currency: 'cad' }, confirmation_amount: { amount: 0.5, currency: 'cad' }, other_amount: { amount: 0.25, currency: 'cad' },
    validation_status: 'valid', warning_messages: [], error_messages: [], estimated_delivery_days: 3 }] } });
export const purchaseRates = () => parsePurchaseRates(purchaseRawRates());
export function seedPurchase(fs: { setDoc(path: string, data: any): void }) {
  fs.setDoc('articles/article', { sellerId: 'seller', price: 50, title: 'Manteau', description: 'Article personnel', images: ['public-image'], isActive: true, isSold: false, isShipping: true, packageSize: 'medium' });
  fs.setDoc('users/buyer', { dateOfBirth: '2000-01-01', isActive: true, addresses: [{ ...purchaseAddress, province: 'ON', postalCode: 'M5V1A1' }] });
  fs.setDoc('users/seller', { dateOfBirth: '2000-01-01', isActive: true, displayName: 'Vendeur réel', stripeAccountId: 'acct_purchase', stripeChargesEnabled: true,
    phoneNumber: '5145559876', addresses: [{ ...purchaseAddress, name: 'Vendeur réel', street: '999 Origine privée', isDefault: true }] });
  fs.setDoc('eligibility_profiles/seller', personalProfile('seller'));
  fs.setDoc('shipping_packages/article', { schemaVersion: 1, ownerId: 'seller', articleId: 'article', version: 1, source: 'seller_declared', measurementVerified: false, parcel: purchaseParcel });
}
