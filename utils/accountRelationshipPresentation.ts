import type { RelationshipCommand, RelationshipFact } from '@/types/accountRelationshipReview';
export const RELATIONSHIP_STATEMENT = 'Un lien entre comptes a été examiné. Cela ne confirme ni une identité commune ni une fraude.' as const;
export const RELATIONSHIP_PAIR_LABELS: Record<RelationshipCommand['pairAction'], string> = {
  retain_current: 'Conserver la situation actuelle de la paire',
  restrict_new_engagements: 'Restreindre les nouveaux engagements entre ces deux comptes',
  close_own_restriction: 'Clore la seule restriction de cette paire',
};
export const RELATIONSHIP_ORDER_LABELS: Record<RelationshipCommand['orderAction'], string> = {
  retain_current: 'Conserver les revues actuelles de libération',
  retain_release_review: 'Maintenir une revue de libération pour ces seules commandes',
  close_own_release_review: 'Clore la seule revue de libération pour ces commandes',
};
export const RELATIONSHIP_ASSESSMENT_LABELS: Record<RelationshipCommand['assessment'], string> = {
  relationship_examined: 'Lien examiné, sans identité commune ou fraude établie', unresolved: 'Lien non résolu',
  no_relation_established: 'Aucun lien établi par les sources examinées',
};
export const RELATIONSHIP_FACT_LABELS: Record<RelationshipFact['qualification'], string> = {
  declared: 'Déclaré', documentary: 'Documentaire', unknown: 'Inconnu', contradictory: 'Contradictoire',
};
/** Immediate choice invalidation also protects the interval before React commits. */
export function createRelationshipInteraction() {
  let epoch = 0;
  return {invalidate: () => {epoch++;}, capture: () => {const selected = epoch; return () => {
    if (selected !== epoch) throw new Error('Le dossier, la portée ou votre choix ont changé. Relisez les sources examinées.');
  };}};
}
