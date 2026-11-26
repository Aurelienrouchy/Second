import type { ProductParcelReportReference } from '@/types/productParcelReport';
export function isProductParcelReportReference(value: unknown): value is ProductParcelReportReference {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false; const v = value as Record<string, unknown>;
  const keys = ['caseId', 'caseVersion', 'caseSourceHash', 'contributionId', 'contributionHash', 'sourceHash', 'topic', 'parcelCapability', 'actorRole', 'leg'];
  return Object.keys(v).length === keys.length && Object.keys(v).every(k => keys.includes(k)) && typeof v.caseId === 'string' && /^pr_[a-f0-9]{64}$/.test(v.caseId) &&
    typeof v.contributionId === 'string' && /^pc_[a-f0-9]{64}$/.test(v.contributionId) && typeof v.caseVersion === 'number' && Number.isSafeInteger(v.caseVersion) && v.caseVersion > 0 &&
    ['caseSourceHash', 'contributionHash', 'sourceHash'].every(k => typeof v[k] === 'string' && /^[a-f0-9]{64}$/.test(v[k])) && v.topic === 'parcel_delivery' && v.parcelCapability === 'product_review_parcel_v1' && ['buyer', 'seller'].includes(String(v.actorRole)) && ['forward', 'return'].includes(String(v.leg));
}
