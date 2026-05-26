/**
 * Checkout Shipping — shared types and constants
 */

export interface ShippingEstimate {
  rateId: string;
  carrier: string;
  carrierCode: string;
  serviceName: string;
  amount: number;
  deliveryDays: string;
  deliveryType: 'home' | 'pickup_point';
}

export interface AddressFormValues {
  fullName: string;
  address: string;
  apartment: string;
  city: string;
  postalCode: string;
  province: string;
}

export const INITIAL_ADDRESS: AddressFormValues = {
  fullName: '',
  address: '',
  apartment: '',
  city: '',
  postalCode: '',
  province: '',
};

export const FALLBACK_ESTIMATES: ShippingEstimate[] = [
  {
    rateId: 'fallback_standard',
    carrier: 'Postes Canada',
    carrierCode: 'canada_post',
    serviceName: 'Standard',
    amount: 8.5,
    deliveryDays: '3-5 jours ouvrables',
    deliveryType: 'home',
  },
  {
    rateId: 'fallback_express',
    carrier: 'Postes Canada',
    carrierCode: 'canada_post',
    serviceName: 'Express',
    amount: 14.5,
    deliveryDays: '1-2 jours ouvrables',
    deliveryType: 'home',
  },
];
