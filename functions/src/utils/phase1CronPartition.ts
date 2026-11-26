/** Presence-only partition markers. They never qualify a source or a balance;
 * even malformed local markers stay outside the ordinary TEST jobs. */
const owns = (value: unknown, field: string): boolean => value !== null && typeof value === 'object' &&
  Object.prototype.hasOwnProperty.call(value, field);
export const hasPhase1LocalOfferOrigin = (value: unknown): boolean => owns(value, 'phase1Source');
export const hasPhase1LocalAgreement = (value: unknown): boolean => owns(value, 'localAgreementWitness');
