import type { ArticleChildSafetyDeclarationInput } from '@/functions/src/shared/articleChildSafety';
export type ArticleChildSafetyDraft = Partial<ArticleChildSafetyDeclarationInput>;
export type ArticleChildSafetyDeclaration = ArticleChildSafetyDeclarationInput;
export interface ArticleChildSafetySource {
  protocol: 'article_child_safety_source_v1'; articleId: string; sellerId: string | null; sourceHash: string;
  requirement: 'not_required' | 'seller_statement_required' | 'human_review_required' | 'daywear_statement';
  reasons: string[]; statementQualification: 'native_current' | 'not_applicable' | 'unknown';
  declaration: (ArticleChildSafetyDeclarationInput & {actorUid: string; declaredAtMs: number; statementHash: string}) | null;
  physicalComplianceVerified: false; platformCertificationGranted: false;
}
