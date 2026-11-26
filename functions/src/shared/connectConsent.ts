/** Shared app/server presentation. This is Second's copy version, not a
 * legal version or snapshot of Stripe's agreements. No server SDK imports. */
export const CONNECT_CONSENT_PRESENTATION_VERSION = 'second-connect-consent-v1';
export const CONNECT_CONSENT_AGREEMENT_URLS = {
  connectAccount: 'https://stripe.com/en-ca/legal/connect-account',
  servicesAgreement: 'https://stripe.com/en-ca/legal/ssa',
} as const;
/** Stripe provides these French translations for information. */
export const CONNECT_CONSENT_TRANSLATIONS_URL = 'https://stripe.com/fr-ca/legal/ssa-translations';
export const CONNECT_CONSENT_STATEMENT =
  'J’accepte l’Accord sur les comptes connectés Stripe et l’Accord de services Stripe pour créer mon compte de paiement.';

export interface PaymentAccountConsentInput {
  accepted: true;
  presentationVersion: typeof CONNECT_CONSENT_PRESENTATION_VERSION;
}
