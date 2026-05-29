/**
 * Checkout Shipping feature — barrel exports.
 */

export { ShippingAddressForm } from './components/ShippingAddressForm';
export { ShippingEstimateList } from './components/ShippingEstimateList';
export { PriceBreakdown } from './components/PriceBreakdown';
export { PayButton } from './components/PayButton';
export { ShippingCheckoutSkeleton } from './components/ShippingCheckoutSkeleton';

export type { ShippingEstimate, AddressFormValues } from './types';
export {
  INITIAL_ADDRESS,
  FALLBACK_ESTIMATES,
  FALLBACK_RATE_PREFIX,
  isFallbackRate,
  CHECKOUT_COPY,
} from './types';
