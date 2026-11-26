/** Domestic CA normalization is shared by new shipping and historical returns.
 * Quebec admission is applied explicitly at NEW-operation entry points. */
import { HttpsError } from 'firebase-functions/v2/https';
import { ShipEngineAddress } from '../../config/shipEngine';
import { normalizeCanadianAddress } from '../../shared/canadianAddress';
export { CA_POSTAL_RE, CA_PROVINCE_CODES } from '../../shared/canadianAddress';

export function validateBuyerShippingAddress(raw: unknown): { street: string; city: string; province: string; postalCode: string } {
  const address = normalizeCanadianAddress(raw);
  if (!address) throw new HttpsError('invalid-argument', 'Une adresse canadienne complète et cohérente est requise.');
  const { street, city, province, postalCode } = address;
  return { street, city, province, postalCode };
}

/** Complete addresses only. A postal zone or article city is never a street.
 * Try every real candidate, default first; no QC restriction for old returns. */
export function resolveSellerOriginAddress(sellerData: Record<string, any>, _articleData: Record<string, any>): ShipEngineAddress | null {
  const addresses: unknown[] = Array.isArray(sellerData.addresses) ? sellerData.addresses : [];
  const candidates = [...addresses.filter((a: any) => a?.isDefault === true), ...addresses.filter((a: any) => a?.isDefault !== true)];
  for (const raw of candidates) {
    const address = normalizeCanadianAddress(raw);
    if (!address) continue;
    const name = typeof sellerData.displayName === 'string' && sellerData.displayName.trim() ? sellerData.displayName.trim() : 'Vendeur';
    const phone = typeof sellerData.phoneNumber === 'string' && sellerData.phoneNumber.trim() ? sellerData.phoneNumber.trim() : null;
    return { name, addressLine1: address.street, cityLocality: address.city, stateProvince: address.province, postalCode: address.postalCode,
      countryCode: address.country, ...(address.line2 ? { addressLine2: address.line2 } : {}), ...(phone ? { phone } : {}) };
  }
  return null;
}

/**
 * Verifies, server-side, that a negotiated (off-list) purchase amount is backed
 * by a real accepted offer for THIS buyer + article.
 *
 * Why (P1 — negotiated amount must be bound to an accepted offer):
 * `createTransaction` previously accepted ANY positive `amount <= articleData.price`
 * as a "negotiated price", trusting that the chat offer/accept flow had validated
 * it. A malicious or buggy client could therefore pay an arbitrary lower amount
 * (e.g. 1$ on a 500$ article) without any seller-accepted offer. We now require,
 * for every off-list amount, the existence of an offer message that:
 *   - lives in a chat for THIS article (chat.articleId === articleId),
 *   - was SENT by the buyer (senderId === buyerId — the buyer proposes, the
 *     seller accepts by flipping offer.status to 'accepted'),
 *   - has offer.status === 'accepted',
 *   - has offer.amount === the requested amount (exact match).
 *
 * Reads happen OUTSIDE runTransaction (no I/O inside a Firestore transaction).
 * The article price invariant is still re-checked atomically inside the tx.
 *
 * Throws HttpsError('failed-precondition') when no matching accepted offer is
 * found. Returns the matched offer message id (for logging / linkage).
 */
