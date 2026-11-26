/**
 * Types — Livraison : adresse et estimation de tarif.
 *
 * Éclaté depuis types/index.ts (1029 lignes, tous domaines mêlés).
 * `types/index.ts` reste le barrel public : les imports `from '@/types'`
 * sont inchangés.
 */

export interface ShippingAddress {
  name: string;
  street: string;
  city: string;
  province: string;
  postalCode: string;
  country: string;
  phoneNumber?: string;
}

/** Shipping estimate attached to chat offers (legacy field structure). */
export interface ShippingEstimate {
  carrier: string;
  serviceName: string;
  estimatedDays: string;
  amount: number;
  currency: string;
  /** @deprecated Legacy Intelcom field, kept for existing Firestore documents. */
  intelcomRateId?: string;
  /** @deprecated Legacy Intelcom field, kept for existing Firestore documents. */
  intelcomServiceLevel?: string;
}
