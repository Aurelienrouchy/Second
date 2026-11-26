import type { MeetupSupportReason, SupportKind, SupportRequest } from '@/types/supportRequest';
export const MEETUP_SUPPORT_LABELS: Record<MeetupSupportReason, string> = {
  article_refused: 'Article refusé pendant la rencontre', disagreement_after_declaration: 'Désaccord sur une remise déclarée', safety_or_pressure: 'Situation dangereuse ou pression',
};
export const supportRequestLabel = (request: SupportRequest) => request.meetupReason ? MEETUP_SUPPORT_LABELS[request.meetupReason] : SUPPORT_KIND_LABELS[request.kind];
export const SUPPORT_KIND_LABELS: Record<SupportKind, string> = {
  commercial_late: 'Difficulté liée à une commande', access_interruption: 'Interruption d’accès au compte',
  personal_data_access: 'Accès à mes renseignements personnels', personal_data_correction: 'Rectification de mes renseignements',
  automated_decision_review: 'Révision humaine d’une décision automatique',
  account_reconciliation: 'Rapprochement de comptes déclarés', restriction_circumvention: 'Examen d’un contournement de restriction déclaré',
  representation_review: 'Demande liée à un décès ou une incapacité déclarés',
  payment_account_review: 'Restriction de mon compte de paiement',
  activity_compliance_review: 'Examen humain d’une restriction de personne ou d’activité',
  swap_hold_assistance: 'Assistance pour le complément d’un troc',
  withdrawal_timing_assistance: 'Enquête sur un retrait',
};
export const SUPPORT_STATUS_LABELS: Record<SupportRequest['status'], string> = {
  submitted: 'Demande enregistrée', needs_information: 'Précisions demandées', withdrawn: 'Demande humaine retirée', answered: 'Réponse enregistrée',
};
export function declaredSupportDate(value: string): string | undefined {
  if (!value.trim()) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Indiquez une date réelle au format AAAA-MM-JJ.');
  const iso = `${value}T00:00:00.000Z`;
  if (!Number.isFinite(Date.parse(iso)) || new Date(iso).toISOString() !== iso || Date.parse(iso) > Date.now()) throw new Error('La date déclarée doit être réelle et non future.');
  return iso;
}
