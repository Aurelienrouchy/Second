import type { CommercialClaimReviewCommand } from '@/types/commercialClaimReview';
export const COMMERCIAL_CLAIM_ACTION_LABELS: Record<CommercialClaimReviewCommand['action'], string> = {
  withdraw_claim: 'Consigner un retrait documentaire de cette plainte', request_reexamination: 'Demander un réexamen distinct avec un nouvel élément',
};
export const COMMERCIAL_CLAIM_LIMITS = 'Le retrait ne clôt pas la plainte, ne libère aucun fonds, ne rembourse personne et ne remet aucun article en vente. La date initiale, les preuves, les réceptions, les décisions, la banque et le retour restent conservés et distincts.';
export function createCommercialClaimInteraction() {
  let epoch = 0;
  return {invalidate: () => {epoch++;}, capture: () => {const captured = epoch; return () => {
    if (captured !== epoch) throw new Error('Votre choix ou les sources de la plainte ont changé. Relisez le dossier exact.');
  };}};
}
