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

/**
 * Prefix used by the backend for synthetic rates returned when ShipEngine is
 * unavailable. A `fallback_*` rate cannot be used to buy a real label, so the
 * card payment must be blocked and the buyer redirected to hand delivery.
 */
export const FALLBACK_RATE_PREFIX = 'fallback_';

/** True when the rate is a local/server fallback (ShipEngine down). */
export function isFallbackRate(rateId: string | undefined | null): boolean {
  return typeof rateId === 'string' && rateId.startsWith(FALLBACK_RATE_PREFIX);
}

/**
 * FR copy for the shipping checkout flow (DS Editorial Luxe, vouvoiement).
 * Sourced from the validated UX spec — do not paraphrase in components.
 */
export const CHECKOUT_COPY = {
  rateExpiredTitle: 'Tarif de livraison expiré',
  rateExpiredBody:
    "Le tarif d'expédition sélectionné n'est plus valide. Actualisez l'estimation pour obtenir un tarif à jour avant de payer.",
  rateExpiredCtaPrimary: "Actualiser l'estimation",
  rateExpiredCtaSecondary: 'Annuler',
  shippingDownTitle: 'Livraison momentanément indisponible',
  shippingDownBody:
    "Nous ne parvenons pas à calculer les frais d'expédition pour le moment. Réessayez dans quelques minutes, ou convenez d'une remise en main propre avec le vendeur·euse.",
  shippingDownCtaPrimary: 'Réessayer',
  shippingDownCtaSecondary: 'Proposer une remise en main propre',
  buyerProtectionTitle: 'Protection acheteur',
  buyerProtectionBody:
    "Votre paiement est sécurisé. Les fonds ne sont versés au vendeur·euse que 7 jours après la livraison. En cas de problème, vous pouvez nous le signaler durant ce délai.",
  meetupOptionTitle: 'Remise en main propre',
  meetupOptionDescription:
    "Réglez directement le vendeur·euse lors de la rencontre, en main propre. Aucun paiement n'est traité par l'application pour ce mode.",
  meetupNoCreditNote:
    "La remise en main propre se règle hors application. Le montant n'est pas crédité sur votre porte-monnaie Seconde.",
  meetupCtaBuyer: 'Proposer une rencontre',
  meetupConfirmedLabel: 'Échange confirmé',
} as const;
