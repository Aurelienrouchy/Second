export interface ArticlePrivacyWithdrawalAttempt {
  version: 1;
  ownerId: string;
  articleId: string;
  requestId: string;
}
export interface ArticlePrivacyWithdrawalReceipt {
  kind: 'article_privacy_withdrawal_v1';
  ownerId: string;
  articleId: string;
  requestId: string;
  operationId: string | null;
  state: 'unrecorded' | 'pending' | 'needs_review' | 'completed' | 'not_executed';
  intentCommitted: boolean;
  replay: boolean;
  publicWithdrawalComplete: boolean;
  privateEvidenceAvailable: boolean;
  mediaTotal: number;
  mediaRevoked: number;
  mediaNeedsReview: number;
  createdAt: string | null;
  updatedAt: string | null;
  completedAt: string | null;
  downloadedCopiesRecallable: false;
  noWithdrawalEffectsCommitted?: true;
  lateRequestBlocked?: true;
  nonExecutionCommittedAt?: string;
}
export interface PrivateArticleAccess {
  articleId: string;
  transactionId?: string;
  swapId?: string;
  sourceReferenceHashes?: string[];
}
export interface PrivateArticleMediaReference {
  mediaId: string;
  evidenceId: string;
  contentType: string;
  size: number;
  generation: string;
  sourceReferenceHash: string;
  mediaBasis: 'source_generation_at_withdrawal';
  historicalPixelsVerified: false;
}
/** Provenance is explicit: withdrawal dossier or only the viewer's frozen contract. */
export interface PrivateArticleEvidence {
  kind: 'private_article_evidence_v1';
  state: 'recorded';
  publicReferenceUseAllowed: false;
  publicReferenceHashes: [];
  viewerId: string;
  ownerId: string;
  articleId: string;
  evidenceId: string;
  evidenceScope: 'owner_dossier' | 'transaction_contract' | 'swap_contract';
  contractId: string | null;
  ownerWithdrawalAttempt: ArticlePrivacyWithdrawalAttempt | null;
  capturedAt: string;
  sourceUpdatedAt: string | null;
  snapshot: Record<string, unknown>;
  mediaRefs: PrivateArticleMediaReference[];
  mediaNeedsReview: number;
}
export interface PrivateArticleEvidenceUnrecorded {
  kind: 'private_article_evidence_v1';
  state: 'unrecorded';
  publicReferenceUseAllowed: boolean;
  publicReferenceHashes: string[];
  viewerId: string;
  ownerId: string;
  articleId: string;
  ownerWithdrawalAttempt: null;
  evidenceId: null;
  capturedAt: null;
  sourceUpdatedAt: null;
  snapshot: null;
  mediaRefs: [];
  mediaNeedsReview: 0;
}
export type PrivateArticleEvidenceRead = PrivateArticleEvidence | PrivateArticleEvidenceUnrecorded;
export interface PrivateArticleMedia {
  kind: 'private_article_media_v1';
  viewerId: string;
  articleId: string;
  evidenceId: string;
  mediaId: string;
  generation: string;
  contentType: string;
  size: number;
  sourceReferenceHash: string;
  mediaBasis: 'source_generation_at_withdrawal';
  historicalPixelsVerified: false;
  dataUrl: string;
}
export interface PrivateProfileMedia {
  kind: 'private_profile_media_v1';
  viewerId: string;
  ownerId: string;
  mode: 'observe' | 'read';
  state: 'unrecorded' | 'pending' | 'copied' | 'revoked' | 'needs_review';
  mediaId: string | null;
  evidenceId: string | null;
  generation: string | null;
  contentType: string | null;
  size: number | null;
  dataUrl: string | null;
  publicWithdrawalComplete: boolean;
  downloadedCopiesRecallable: false;
}
