import { getCallableErrorCode, mapCallableError } from '@/utils/callableError';
import type { EligibilityScope, EligibilityReviewStatus, DateOfBirthCopy } from '@/types/eligibility';
export const ELIGIBILITY_SCOPE_LABELS: Record<EligibilityScope, string> = { buy: 'Nouveaux achats', sell: 'Nouvelles ventes', new_paid_shipping: 'Nouvelles expéditions payées' };
export const ELIGIBILITY_REVIEW_LABELS: Record<EligibilityReviewStatus, string> = {
  submitted: 'Demande reçue', needs_information: 'Précisions demandées', approved: 'Examen terminé', rejected: 'Refus maintenu',
};
export function declaredDateLabel(date: string | null, copy: DateOfBirthCopy | null): string {
  if (date) return date;
  if (!copy || copy.type === 'missing') return 'Non renseignée';
  return `Source enregistrée à examiner (${copy.type})`;
}
export function eligibilityErrorMessage(error: unknown): string {
  if (getCallableErrorCode(error) === 'aborted') return 'Ce dossier a changé. Actualisez-le avant de prendre une décision.';
  return mapCallableError(error, { title: 'Vérification impossible', message: 'Impossible de vérifier vos renseignements. Réessayez.' }).message;
}
export function isEligibilityConflict(error: unknown): boolean { return getCallableErrorCode(error) === 'aborted'; }
export function isEligibilityResponseUncertain(error: unknown): boolean {
  return ['unavailable', 'deadline-exceeded', 'internal', 'unknown', 'cancelled'].includes(getCallableErrorCode(error) ?? 'unknown');
}
