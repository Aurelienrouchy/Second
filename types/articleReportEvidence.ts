export interface ArticleReportMediaProposal {
  index: number; sourceGeneration: string | null; sourceCrc32c: string | null;
  contentType: string | null; size: number | null; qualification: 'qualified' | 'needs_review';
}
export interface ArticleReportPreview {
  protocol: 'article_report_preview_v1'; actorUid: string; articleId: string; sellerId: string;
  articleRevision: string; contentHash: string; snapshot: Record<string, unknown>;
  expectedMedia: ArticleReportMediaProposal[]; mediaCount: number; conservation: 'ready' | 'needs_review';
  authenticityVerified: false; photoRightsVerified: false;
}
export interface ArticleReportAttempt {
  version: 1; uid: string; targetType: 'article'; targetId: string; requestId: string;
  reason: string; description: string | null; expectedArticleRevision: string;
  expectedArticleContentHash: string; expectedMedia: ArticleReportMediaProposal[];
}
export interface ArticleReportReceipt {
  protocol: 'article_report_receipt_v1'; actorUid: string; reportId: string; articleId: string; requestId: string;
  state?: 'recorded'; receivedAt: string; articleRevision: string; contentHash: string; tupleHash: string;
  conservation: 'pending' | 'preserved' | 'needs_review'; mediaCount: number; reason: string;
  description: string | null; status: string; authenticityVerified: false; photoRightsVerified: false;
}
export interface ArticleReportUnrecorded {
  protocol: 'article_report_receipt_v1'; actorUid: string; reportId: string; articleId: string; requestId: string;
  state: 'unrecorded' | 'historical_unknown'; conservation?: 'historical_unknown';
}
export interface ArticleReportNonexecution {
  protocol: 'article_report_nonexecution_v1'; actorUid: string; reportId: string; articleId: string; requestId: string;
  tupleHash: string; reason: string; description: string | null; articleRevision: string; contentHash: string;
  neutralizedAt: string; state: 'not_executed'; sourceExamined: false; reportCreated: false;
  authenticityVerified: false; photoRightsVerified: false;
}
export type ArticleReportObservation = ArticleReportReceipt | ArticleReportUnrecorded | ArticleReportNonexecution;
export interface AdminArticlePhotoEvidence {
  protocol: 'article_report_evidence_v1'; actorUid: string; reportId: string;
  conservation: 'historical_unknown' | 'pending' | 'preserved' | 'needs_review';
  articleId?: string; sellerId?: string; reporterId?: string; articleRevision?: string; contentHash?: string;
  capturedAt?: string; snapshot: Record<string, unknown> | null;
  media: {index: number; mediaId: string; state: 'pending' | 'preserved' | 'needs_review'; reason: string | null;
    contentType: string | null; size: number | null; sourceGeneration: string | null; privateGeneration: string | null}[];
  authenticityVerified: false; photoRightsVerified: false;
}
export interface AdminArticlePhoto {
  protocol: 'article_report_media_v1'; actorUid: string; reportId: string; articleId: string; mediaId: string;
  generation: string; sourceGeneration: string; contentType: string; size: number; dataUrl: string;
  authenticityVerified: false; photoRightsVerified: false;
}
