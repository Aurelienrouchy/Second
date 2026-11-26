import {createHash} from 'node:crypto';
import type {AdminFinancialAttempt, AdminFinancialDecision, AdminFinancialPreview} from '@/services/adminFinancialDecisionJournal';
import type {IssueRefundResult} from '@/types/transaction';

const sha = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, canonical(entry)]));
  return value;
}

/** Native I/O fixtures only: real services, journal validation and guards run. */
export function historicalAdminPreview(actorUid: string, decisionType: AdminFinancialPreview['decisionType'] = 'refund_without_return',
  overrides: Partial<AdminFinancialPreview> = {}): AdminFinancialPreview {
  return {protocol: 'admin_financial_preview_v1', previewId: 'a'.repeat(64), sourceHash: 'b'.repeat(64), sourceVersion: 1,
    actorUid, transactionId: 'tx_1', expectedDisputeId: 'dispute_1', decisionType, currency: 'CAD',
    totalCents: decisionType === 'dismissed' ? 0 : 5000, cardCents: decisionType === 'dismissed' ? 0 : 4000,
    walletCents: decisionType === 'dismissed' ? 0 : 1000, sellerDebitCents: decisionType === 'dismissed' ? 0 : 5000,
    monetaryContext: 'new_instruction', ...(decisionType === 'refund_without_return' ? {moneyMovementPlanned: true} : {}),
    buyerId: 'buyer', sellerId: 'seller', sourceStatus: 'disputed', remainingOpenDisputeIds: [], retainedObligations: [],
    inventoryPermissionGranted: false, physicalPossession: 'unknown', bilateralAgreementVerified: false, ...overrides};
}

export function historicalAdminAttempt(preview: AdminFinancialPreview,
  options: {requestId?: string; note?: string} = {}): AdminFinancialAttempt {
  if (preview.decisionType !== 'refund_without_return') throw new Error('Refund preview required by this fixture.');
  return {version: 1, adminUid: preview.actorUid, transactionId: preview.transactionId, disputeId: preview.expectedDisputeId,
    requestId: options.requestId ?? 'historical_refund_request_0001', note: options.note ?? 'Décision documentaire synthétique après examen du dossier.',
    previewId: preview.previewId, expectedSourceHash: preview.sourceHash, expectedTotalCents: preview.totalCents,
    expectedCardCents: preview.cardCents, expectedWalletCents: preview.walletCents, expectedSellerDebitCents: preview.sellerDebitCents,
    decisionType: 'refund_without_return'};
}

export function historicalAdminFinancialDecision(attempt: AdminFinancialAttempt,
  financialOverrides: Partial<IssueRefundResult> = {}): AdminFinancialDecision {
  const input = {adminUid: attempt.adminUid, transactionId: attempt.transactionId, expectedDisputeId: attempt.disputeId, requestId: attempt.requestId,
    previewId: attempt.previewId, expectedSourceHash: attempt.expectedSourceHash, expectedTotalCents: attempt.expectedTotalCents,
    expectedCardCents: attempt.expectedCardCents, expectedWalletCents: attempt.expectedWalletCents,
    expectedSellerDebitCents: attempt.expectedSellerDebitCents, decisionType: attempt.decisionType, note: attempt.note};
  return {protocol: 'admin_financial_decision_v1', transactionId: attempt.transactionId, expectedDisputeId: attempt.disputeId,
    actorUid: attempt.adminUid, requestId: attempt.requestId, decisionId: sha(['refund', attempt.transactionId, attempt.adminUid, attempt.requestId]),
    payloadHash: sha(canonical(input)), previewId: attempt.previewId, sourceHash: attempt.expectedSourceHash, note: attempt.note,
    decisionType: 'refund_without_return', currency: 'CAD', totalCents: attempt.expectedTotalCents, cardCents: attempt.expectedCardCents,
    walletCents: attempt.expectedWalletCents, sellerDebitCents: attempt.expectedSellerDebitCents, inventoryPermissionGranted: false,
    physicalPossession: 'unknown', bilateralAgreementVerified: false, outcome: 'reserved', buyerId: 'buyer', sellerId: 'seller',
    committedAt: '2026-11-25T20:00:00.000Z', decisionCommitted: true, effectsCommitted: true, intentionNeutralized: false, lateRequestBlocked: false,
    refundIntentId: 'refund_intent_1', financial: {success: false, status: 'pending', intentId: 'refund_intent_1', refundId: 're_pending',
      outstandingCardCents: attempt.expectedCardCents, actionRequired: false, localReconciliationRequired: false, bankWaiting: false,
      message: 'Le remboursement reste en cours de confirmation.', ...financialOverrides}, disputesClosed: 0, remainingOpenDisputeIds: [attempt.disputeId],
    retainedObligations: [], manualCorrectionRequired: true};
}
