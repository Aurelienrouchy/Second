/** Private immutable human receipts; current permission is qualified elsewhere. */
import {Timestamp} from 'firebase-admin/firestore';
import {db} from '../config/firebase';
import {supportSourceHash} from './supportRequest';
import {fraudGuardDigest} from '../shared/fraudReviewGuard';

const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const id = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(v);
const native = (v: unknown): v is Timestamp => v instanceof Timestamp && v.toMillis() >= 0 && v.toMillis() <= Date.now();
export const fraudDecisionRef = (decisionId: string) => db.collection('fraud_review_decisions').doc(decisionId);
export function qualifiedFraudHumanDecision(record: any, decisionId: string) {
  const d = record?.document;
  if (record?.protocol !== 'fraud_human_decision_v1' || record.decisionId !== decisionId || !/^fd_[a-f0-9]{64}$/.test(decisionId) ||
      !d || d.protocol !== record.protocol || d.decisionId !== decisionId || record.contentHash !== supportSourceHash(d) ||
      !id(d.actorId) || !id(d.transactionId) || !id(d.buyerId) || !id(d.sellerId) || d.buyerId === d.sellerId ||
      typeof d.requestId !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(d.requestId) ||
      decisionId !== 'fd_' + fraudGuardDigest([d.actorId, d.requestId]) || !hash(d.payloadHash) ||
      !['retain_review', 'close_review_for_sources'].includes(d.action) || !native(d.decidedAt) ||
      typeof d.reason !== 'string' || !d.reason.trim() || d.reason.length > 2000 || !Array.isArray(d.cases) ||
      d.cases.length < 1 || d.cases.length > 30 || new Set(d.cases.map((c: any) => c.caseId)).size !== d.cases.length ||
      !d.cases.every((c: any) => typeof c?.caseId === 'string' && c.caseId.length > 0 && Buffer.byteLength(c.caseId, 'utf8') <= 1500 &&
        !c.caseId.includes('/') && (c.reviewKey === null || hash(c.reviewKey))) ||
      d.financialEffectAuthorized !== false || d.inventoryReleaseAuthorized !== false || d.guiltEstablished !== false ||
      d.independentHoldsReleased !== false || d.identityDecision !== 'none') return null;
  return d;
}
export async function readFraudCaseHumanResolution(tx: FirebaseFirestore.Transaction, caseId: string,
  reviewKey: string | null, data: any, order: any, transactionId: string) {
  const r = data?.humanResolution;
  if (!r || r.protocol !== 'fraud_case_human_resolution_v1' || !/^fd_[a-f0-9]{64}$/.test(r.decisionId ?? '') ||
      r.caseId !== caseId || r.transactionId !== transactionId || r.reviewKey !== reviewKey ||
      !id(r.actorId) || !native(r.decidedAt)) return null;
  const d = qualifiedFraudHumanDecision((await tx.get(fraudDecisionRef(r.decisionId))).data(), r.decisionId);
  const entry = d?.cases.find((c: any) => c.caseId === caseId);
  if (!d || d.transactionId !== transactionId || d.buyerId !== order.buyerId || d.sellerId !== order.sellerId ||
      d.actorId !== r.actorId || d.action !== r.action || !d.decidedAt.isEqual(r.decidedAt) || !entry || entry.reviewKey !== reviewKey) return null;
  return {action: d.action as 'retain_review' | 'close_review_for_sources', decisionId: r.decisionId as string,
    actorId: d.actorId as string, decidedAt: d.decidedAt as Timestamp};
}
