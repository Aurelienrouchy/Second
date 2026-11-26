import type { ProductCommercialReturnCommand, ProductCommercialReturnReference } from '@/types/productCommercialReturn';
export const PRODUCT_COMMERCIAL_RETURN_ACTIONS = ['maintain_review', 'refuse_return', 'instruct_return'] as const;
export const PRODUCT_COMMERCIAL_RETURN_LABELS = {maintain_review: 'Maintenir l’examen du retour', refuse_return: 'Refuser le retour pour les sources examinées', instruct_return: 'Instruire le retour de la commande entière'} as const;
export const commercialObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
export const commercialExact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && Object.keys(v).every(k => keys.includes(k));
export const commercialHash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
export const commercialId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(v);
export const commercialIso = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
export const commercialEffects = ['authenticityVerified', 'recallApplicabilityVerified', 'childSafetyVerified', 'hygieneVerified', 'speciesOrProvenanceVerified', 'financialEffectAuthorized', 'inventoryEffectAuthorized', 'shippingPermissionGranted', 'physicalContentsVerified', 'legalDeadlineEstablished'];
export function isProductCommercialReturnReference(v: unknown): v is ProductCommercialReturnReference {
  return commercialObject(v) && commercialExact(v, ['instructionId', 'contentHash']) && typeof v.instructionId === 'string' && /^pri_[a-f0-9]{64}$/.test(v.instructionId) && commercialHash(v.contentHash);
}
export function isProductCommercialReturnCommand(v: unknown, evidenceReference: (value: unknown) => boolean): v is ProductCommercialReturnCommand {
  const parcel = commercialObject(v) && Object.prototype.hasOwnProperty.call(v, 'parcelCapability');
  return commercialObject(v) && commercialExact(v, ['transactionId', 'disputeId', 'returnRequestId', 'previewId', 'sourceHash', 'semanticSourceHash', 'caseVersion', 'corpusHash', 'membersHash',
    'contributionReferences', 'evidenceReferences', 'action', 'privateNote', 'partyMessage', 'acknowledged', ...(parcel ? ['parcelCapability'] : [])]) && (!parcel || v.parcelCapability === 'product_review_parcel_v1') && commercialId(v.transactionId) && commercialId(v.disputeId) &&
    (v.returnRequestId === null || typeof v.returnRequestId === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(v.returnRequestId)) &&
    ['previewId', 'sourceHash', 'semanticSourceHash', 'corpusHash', 'membersHash'].every(k => commercialHash(v[k])) &&
    typeof v.caseVersion === 'number' && Number.isSafeInteger(v.caseVersion) && v.caseVersion > 0 && PRODUCT_COMMERCIAL_RETURN_ACTIONS.includes(v.action as 'maintain_review') &&
    ['privateNote', 'partyMessage'].every(k => typeof v[k] === 'string' && !!v[k].trim() && v[k].trim() === v[k] && v[k].length <= 4000) && v.acknowledged === true &&
    Array.isArray(v.contributionReferences) && v.contributionReferences.length <= 100 && v.contributionReferences.every(r => commercialObject(r) && commercialExact(r, ['id', 'contentHash']) &&
      typeof r.id === 'string' && /^pc_[a-f0-9]{64}$/.test(r.id) && commercialHash(r.contentHash)) && new Set(v.contributionReferences.map(r => r.id)).size === v.contributionReferences.length &&
    Array.isArray(v.evidenceReferences) && v.evidenceReferences.length <= 100 && v.evidenceReferences.every(evidenceReference) &&
    new Set(v.evidenceReferences.map(r => commercialObject(r) ? r.id : null)).size === v.evidenceReferences.length;
}
