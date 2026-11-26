/**
 * Types partagés — barrel.
 *
 * Le fichier faisait 1029 lignes, tous domaines mêlés. Il est désormais éclaté
 * par domaine métier ; ce barrel préserve l'API publique `@/types`, donc aucun
 * import existant n'a eu à changer.
 *
 * 9 types morts ont été retirés au passage (0 référence dans app/ comme dans
 * functions/) : Category, ConsentType, ConsentRecord, PrivacyIncident{,Severity,
 * Status}, LegacyOfferStatus, MeetupOffer, UserMeetupScore.
 *
 * Un type utilisé par une seule feature a vocation à descendre dans
 * `features/<x>/types.ts` : ce barrel ne garde que le réellement partagé.
 */

export * from './user';
export * from './article';
export * from './shipping';
export * from './chat';
export * from './transaction';
export * from './search';
export * from './shop';
export * from './notification';
export * from './meetup';
export * from './swap';
export * from './wallet';

export type { EligibilityScope, OwnerEligibility, EligibilityReview, AdminEligibilityReview } from './eligibility';
