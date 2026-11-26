import { phase1HttpsCallable as httpsCallable } from '@/services/phase1Callable';
import { functions } from '@/config/firebaseConfig';
import { assertTradeSessionCurrent, captureTradeSession } from '@/services/tradeOperation';
import type { LabelDocumentDirection, LabelDocumentObservation, LabelDocumentSourceCheck } from '@/types/labelDocument';

const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const labelId = (v: unknown): v is string => typeof v === 'string' && /^se-[a-zA-Z0-9-]+$/.test(v) && v.length <= 200;
const text = (v: unknown, max: number): v is string => typeof v === 'string' && !!v.trim() && v.length <= max && !/[\u0000-\u001f\u007f]/.test(v);
const time = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && Number.isFinite(new Date(v).getTime());
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const failure = () => new Error('Le document ne peut pas être confirmé pour cette commande. Actualisez la commande ou contactez notre équipe.');
function revision(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d+:\d+$/.test(v)) return false;
  const [seconds, nanos] = v.split(':').map(Number);
  return Number.isSafeInteger(seconds) && seconds >= 0 && seconds <= 253402300799 && Number.isSafeInteger(nanos) && nanos >= 0 && nanos < 1_000_000_000;
}
function httpsDocument(v: unknown): v is string {
  if (!text(v, 5000)) return false;
  try {const url = new URL(v); return url.protocol === 'https:' && !!url.hostname && !url.username && !url.password;} catch {return false;}
}
export function parseLabelDocumentObservation(v: unknown, uid: string, transactionId: string,
  direction: LabelDocumentDirection, expectedLabelId: string | null): LabelDocumentObservation {
  if (!record(v) || Object.keys(v).some(key => !['protocol', 'ownerId', 'transactionId', 'direction', 'labelId', 'sourceRevision',
    'sourceHash', 'purchaseQualification', 'observation', 'providerStatus', 'providerVoided', 'providerRevision', 'observedAtMs',
    'providerCreatedAtMs', 'documentUrl', 'reason', 'labelUsability', 'newPurchaseAuthorized'].includes(key)) ||
    v.protocol !== 'label_document_observation_v1' || v.ownerId !== uid || v.transactionId !== transactionId ||
    v.direction !== direction || v.labelId !== expectedLabelId || !(v.labelId === null || labelId(v.labelId)) ||
    !(v.sourceRevision === null || revision(v.sourceRevision)) || !hash(v.sourceHash) ||
    !['native_committed', 'historical_unknown', 'unqualified'].includes(String(v.purchaseQualification)) ||
    !['document_available', 'provider_voided', 'unknown', 'needs_review'].includes(String(v.observation)) ||
    !(v.providerStatus === null || text(v.providerStatus, 100)) || ![null, true, false].includes(v.providerVoided as boolean | null) ||
    v.providerRevision !== null || !time(v.observedAtMs) ||
    !(v.providerCreatedAtMs === null || time(v.providerCreatedAtMs) && v.providerCreatedAtMs <= v.observedAtMs) ||
    !(v.reason === null || text(v.reason, 200)) || v.newPurchaseAuthorized !== false ||
    v.labelUsability !== (v.observation === 'provider_voided' ? 'provider_voided' : 'not_certified')) throw failure();
  if (v.observation === 'document_available') {
    if (!labelId(v.labelId) || !revision(v.sourceRevision) || v.purchaseQualification === 'unqualified' ||
      v.providerStatus !== 'completed' || v.providerVoided !== false || !time(v.providerCreatedAtMs) || !httpsDocument(v.documentUrl) || v.reason !== null) throw failure();
  } else if (v.documentUrl !== null || v.reason === null || v.observation === 'provider_voided' &&
    (v.providerVoided !== true || !labelId(v.labelId) || !revision(v.sourceRevision) || !time(v.providerCreatedAtMs))) throw failure();
  return v as unknown as LabelDocumentObservation;
}

export const LabelDocumentService = {
  async observe(uid: string, transactionId: string, direction: LabelDocumentDirection,
    expectedLabelId: string | null, assertContext: () => void): Promise<LabelDocumentObservation> {
    const session = captureTradeSession(uid); assertContext();
    if (!text(transactionId, 200) || transactionId.includes('/') || !['forward', 'return'].includes(direction) ||
      !(expectedLabelId === null || labelId(expectedLabelId))) throw failure();
    const response = await httpsCallable<unknown, unknown>(functions, 'checkTrackingStatus')({mode: 'label_document_observe',
      expectedUid: uid, transactionId, direction, expectedLabelId});
    assertTradeSessionCurrent(session); assertContext();
    return parseLabelDocumentObservation(response.data, uid, transactionId, direction, expectedLabelId);
  },
  async confirmSource(uid: string, document: LabelDocumentObservation, assertContext: () => void): Promise<LabelDocumentSourceCheck> {
    const session = captureTradeSession(uid); assertContext();
    const examined = parseLabelDocumentObservation(document, uid, document.transactionId, document.direction, document.labelId);
    if (examined.observation !== 'document_available' || !examined.sourceRevision || !examined.labelId) throw failure();
    const response = await httpsCallable<unknown, unknown>(functions, 'checkTrackingStatus')({mode: 'label_document_observe', operation: 'source_check',
      expectedUid: uid, transactionId: examined.transactionId, direction: examined.direction, expectedLabelId: examined.labelId,
      expectedSourceHash: examined.sourceHash, expectedSourceRevision: examined.sourceRevision});
    assertTradeSessionCurrent(session); assertContext();
    const v = response.data;
    if (!record(v) || Object.keys(v).some(key => !['protocol', 'ownerId', 'transactionId', 'direction', 'labelId', 'sourceRevision',
      'sourceHash', 'purchaseQualification', 'observation', 'documentUrl', 'newPurchaseAuthorized'].includes(key)) ||
      v.protocol !== 'label_document_source_check_v1' || v.ownerId !== uid || v.transactionId !== examined.transactionId ||
      v.direction !== examined.direction || v.labelId !== examined.labelId || v.sourceHash !== examined.sourceHash ||
      v.sourceRevision !== examined.sourceRevision || v.purchaseQualification !== examined.purchaseQualification ||
      v.observation !== 'source_matches' || v.documentUrl !== null || v.newPurchaseAuthorized !== false) throw failure();
    return v as unknown as LabelDocumentSourceCheck;
  },
};
