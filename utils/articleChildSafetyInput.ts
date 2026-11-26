import { parseChildSafetyDeclaration } from '@/functions/src/shared/articleChildSafety';
import type { ArticleChildSafetyDeclaration, ArticleChildSafetyDraft, ArticleChildSafetySource } from '@/types/articleChildSafety';
export function isArticleChildSafetySource(raw: unknown, articleId: string): raw is ArticleChildSafetySource {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const v = raw as Record<string, unknown>, keys = ['protocol', 'articleId', 'sellerId', 'sourceHash', 'requirement', 'reasons', 'statementQualification', 'declaration', 'physicalComplianceVerified', 'platformCertificationGranted'];
  if (Object.keys(v).length !== keys.length || Object.keys(v).some(k => !keys.includes(k)) || v.protocol !== 'article_child_safety_source_v1' || v.articleId !== articleId ||
    !(v.sellerId === null || typeof v.sellerId === 'string' && v.sellerId.length > 0 && v.sellerId.length <= 128 && !v.sellerId.includes('/')) ||
    typeof v.sourceHash !== 'string' || !/^[a-f0-9]{64}$/.test(v.sourceHash) || !['not_required', 'seller_statement_required', 'human_review_required', 'daywear_statement'].includes(String(v.requirement)) ||
    !['native_current', 'not_applicable', 'unknown'].includes(String(v.statementQualification)) || !Array.isArray(v.reasons) || new Set(v.reasons).size !== v.reasons.length ||
    v.reasons.some(r => !['canonical_category_unknown', 'previous_child_safety_review', 'canonical_sleepwear', 'sleep_or_use_uncertain', 'safety_concern_or_unknown', 'sleepwear_label_unknown'].includes(r)) ||
    v.physicalComplianceVerified !== false || v.platformCertificationGranted !== false) return false;
  if (v.declaration === null) return v.statementQualification !== 'native_current';
  if (v.statementQualification !== 'native_current' || typeof v.declaration !== 'object' || Array.isArray(v.declaration)) return false;
  const d = v.declaration as Record<string, unknown>, statementKeys = ['protocol', 'intendedUse', 'labelStatus', 'labelText', 'sleepwearStyle', 'safetyConcern', 'observation'];
  return Object.keys(d).length === 10 && Object.keys(d).every(k => [...statementKeys, 'actorUid', 'declaredAtMs', 'statementHash'].includes(k)) &&
    !!parseChildSafetyDeclaration(Object.fromEntries(statementKeys.map(k => [k, d[k]]))) && d.actorUid === v.sellerId && typeof d.declaredAtMs === 'number' && Number.isSafeInteger(d.declaredAtMs) && d.declaredAtMs > 0 && Number.isFinite(new Date(d.declaredAtMs).getTime()) &&
    typeof d.statementHash === 'string' && /^[a-f0-9]{64}$/.test(d.statementHash);
}
/** Nullable dependent text/style does not supply any of the three mandatory choices. */
export function articleChildSafetyInput(d: ArticleChildSafetyDraft | null | undefined): ArticleChildSafetyDeclaration | null {
  if (!d) return null;
  return parseChildSafetyDeclaration({protocol: 'article_child_safety_statement_v1', intendedUse: d.intendedUse, labelStatus: d.labelStatus,
    labelText: d.labelText ?? null, sleepwearStyle: d.sleepwearStyle ?? null, safetyConcern: d.safetyConcern, observation: d.observation ?? null});
}
export function articleChildSafetyEditKey(fields: Record<string, unknown>, images: {url: string}[]): string {
  return JSON.stringify(['title', 'description', 'categoryIds', 'condition', 'size', 'sizeSystem', 'brand', 'brandStatus', 'colors', 'materials',
    'hasKnownDefects', 'defectsDescription', 'hasAlterations', 'alterationsDescription', 'saleUnit'].map(key => fields[key] ?? null).concat([images.map(i => i.url)]));
}
