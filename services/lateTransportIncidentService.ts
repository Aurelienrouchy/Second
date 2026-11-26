import { phase1HttpsCallable as httpsCallable } from '@/services/phase1Callable';
import { functions } from '@/config/firebaseConfig';
import { assertTradeSessionCurrent, captureTradeSession } from '@/services/tradeOperation';
import type { LateTransportIncident, LateTransportIncidentPage, LateTransportScope } from '@/types/lateTransportIncident';

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const id = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(v);
const incidentId = (v: unknown): v is string => typeof v === 'string' && /^late_[a-f0-9]{64}$/.test(v);
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const iso = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const failure = () => new Error('Ce dossier de suivi et de remboursement ne peut pas être confirmé. Relisez les observations enregistrées ou demandez un examen à notre équipe.');
function revision(v: unknown): boolean {
  if (v === null) return true;
  if (typeof v !== 'string' || !/^\d+:\d+$/.test(v)) return false;
  const [seconds, nanos] = v.split(':').map(Number);
  return Number.isSafeInteger(seconds) && seconds >= 0 && seconds <= 253402300799 && Number.isSafeInteger(nanos) && nanos >= 0 && nanos < 1_000_000_000;
}
function item(v: unknown): v is LateTransportIncident {
  if (!object(v) || Object.keys(v).some(key => !['incidentId', 'incidentRevision', 'incidentHash', 'financialSourceHash', 'leg', 'captureId', 'displayHash', 'trackingSourceHash', 'providerStatusCode',
    'providerObservedAt', 'providerOccurredAt', 'recordedAt', 'refund', 'temporalRelation', 'currentCapture', 'financialSourceCurrent',
    'recipientReceiptVerified', 'bankReceiptVerified', 'financialEffectAuthorized', 'inventoryReleaseAuthorized', 'humanReviewRequired'].includes(key)) ||
    !incidentId(v.incidentId) || !revision(v.incidentRevision) || !hash(v.incidentHash) || !(v.financialSourceHash === null || hash(v.financialSourceHash)) ||
    v.leg !== 'forward' || typeof v.captureId !== 'string' || !/^tracking_[a-f0-9]{64}$/.test(v.captureId) ||
    !hash(v.displayHash) || !hash(v.trackingSourceHash) || !['IT', 'DE'].includes(String(v.providerStatusCode)) ||
    !iso(v.providerObservedAt) || !iso(v.recordedAt) || Date.parse(v.providerObservedAt) > Date.parse(v.recordedAt) ||
    !(v.providerOccurredAt === null || iso(v.providerOccurredAt) && Date.parse(v.providerOccurredAt) <= Date.parse(v.providerObservedAt)) ||
    typeof v.currentCapture !== 'boolean' || typeof v.financialSourceCurrent !== 'boolean' || v.recipientReceiptVerified !== false ||
    v.bankReceiptVerified !== false || v.financialEffectAuthorized !== false || v.inventoryReleaseAuthorized !== false || v.humanReviewRequired !== true ||
    !object(v.refund) || Object.keys(v.refund).some(key => !['qualification', 'state', 'intentId', 'requestedAt', 'fundsAppliedAt'].includes(key)) ||
    !['native_intent', 'historical_unknown'].includes(String(v.refund.qualification)) || !['engaged', 'unknown', 'confirmed'].includes(String(v.refund.state))) return false;
  const refund = v.refund;
  if (refund.qualification === 'historical_unknown') {
    if (refund.state !== 'unknown' || refund.intentId !== null || refund.requestedAt !== null || refund.fundsAppliedAt !== null) return false;
  } else if (!id(refund.intentId) || !iso(refund.requestedAt) || Date.parse(refund.requestedAt) > Date.parse(v.recordedAt) ||
    (refund.state === 'confirmed' ? !iso(refund.fundsAppliedAt) || Date.parse(refund.fundsAppliedAt) < Date.parse(refund.requestedAt) ||
      Date.parse(refund.fundsAppliedAt) > Date.parse(v.recordedAt) : refund.fundsAppliedAt !== null)) return false;
  const expectedRelation = v.providerOccurredAt === null || refund.requestedAt === null ? 'unknown' :
    Date.parse(v.providerOccurredAt as string) > Date.parse(refund.requestedAt as string) ? 'after_refund_request' : 'before_or_at_refund_request';
  return v.temporalRelation === expectedRelation;
}
export const LateTransportIncidentService = {
  async read(uid: string, transactionId: string, scope: LateTransportScope, cursor: string | undefined,
    assertContext: () => void): Promise<LateTransportIncidentPage> {
    const session = captureTradeSession(uid); assertContext();
    if (!id(transactionId) || !['owner', 'admin'].includes(scope) || cursor !== undefined && !incidentId(cursor)) throw failure();
    const response = await httpsCallable<unknown, unknown>(functions, 'checkTrackingStatus')({mode: 'late_transport_incidents_observe',
      expectedUid: uid, transactionId, scope, ...(cursor ? {cursor} : {})});
    assertTradeSessionCurrent(session); assertContext(); const v = response.data;
    if (!object(v) || Object.keys(v).some(key => !['protocol', 'ownerId', 'transactionId', 'sourceRevision', 'items', 'cursor', 'hasMore'].includes(key)) ||
      v.protocol !== 'late_transport_incident_v1' || v.ownerId !== uid || v.transactionId !== transactionId || !revision(v.sourceRevision) ||
      !Array.isArray(v.items) || v.items.length > 20 || !v.items.every(item) || typeof v.hasMore !== 'boolean' || v.hasMore !== (v.cursor !== null) ||
      !(v.cursor === null || incidentId(v.cursor)) || cursor && v.cursor !== null && (v.cursor as string) <= cursor) throw failure();
    const items = v.items;
    if (new Set(items.map(record => record.incidentId)).size !== items.length || items.some((record, index) =>
      cursor && record.incidentId <= cursor || index > 0 && record.incidentId <= items[index - 1].incidentId ||
      v.cursor !== null && record.incidentId > (v.cursor as string))) throw failure();
    return v as unknown as LateTransportIncidentPage;
  },
};
