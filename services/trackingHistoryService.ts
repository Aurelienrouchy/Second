import { phase1HttpsCallable as httpsCallable } from '@/services/phase1Callable';
import { functions } from '@/config/firebaseConfig';
import { DEV_COMMERCE_TESTING_ENABLED } from '@/config/featureFlags';
import { assertTradeSessionCurrent, captureTradeSession } from '@/services/tradeOperation';
import type { ObservedTrackingCapture, ObservedTrackingEvent, TrackingHistoryLeg, TrackingHistoryPage, TrackingHistoryPageReference } from '@/types/trackingHistory';

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const captureId = (v: unknown): v is string => typeof v === 'string' && /^tracking_[a-f0-9]{64}$/.test(v);
const id = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(v);
const utc = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const nullableText = (v: unknown, max: number) => v === null || typeof v === 'string' && v.length <= max;
const failure = () => new Error('Les événements de suivi ne peuvent pas être confirmés pour cette commande. Relisez la source enregistrée ou contactez notre équipe.');
const captureFields = ['captureId', 'sourceHash', 'readId', 'readVersion', 'displayHash', 'recordedAt', 'currentCapture', 'providerReadAt',
  'providerEventAt', 'providerStatusCode', 'trackingStatus', 'statusDescription', 'statusDescriptionTruncated', 'estimatedDeliveryAtUtc', 'totalEvents',
  'suppliedHistoryOnly', 'exhaustiveHistoryVerified', 'pickupAddress', 'pickupHours', 'pickupDeadline', 'pickupInstructions', 'pickupDetailsSource',
  'recipientReceiptVerified', 'financialEffectAuthorized'];
const mappedStatus: Record<string, string> = {UN: 'UNKNOWN', AC: 'TRANSIT', IT: 'IN_TRANSIT', DE: 'DELIVERED', EX: 'EXCEPTION',
  AT: 'DELIVERY_ATTEMPT', SP: 'DELIVERED_TO_SERVICE_POINT', NY: 'UNKNOWN'};
function capture(v: unknown): v is ObservedTrackingCapture {
  return object(v) && Object.keys(v).every(key => captureFields.includes(key)) && captureId(v.captureId) && hash(v.sourceHash) && id(v.readId) &&
    typeof v.readVersion === 'number' && Number.isSafeInteger(v.readVersion) && v.readVersion >= 1 && hash(v.displayHash) && utc(v.recordedAt) &&
    typeof v.currentCapture === 'boolean' && utc(v.providerReadAt) && Date.parse(v.providerReadAt) <= Date.parse(v.recordedAt) &&
    (v.providerEventAt === null || utc(v.providerEventAt) && Date.parse(v.providerEventAt) <= Date.parse(v.providerReadAt)) &&
    typeof v.providerStatusCode === 'string' && ['UN', 'AC', 'IT', 'DE', 'EX', 'AT', 'NY', 'SP'].includes(v.providerStatusCode) &&
    v.trackingStatus === mappedStatus[v.providerStatusCode] && nullableText(v.statusDescription, 2000) && typeof v.statusDescriptionTruncated === 'boolean' &&
    (v.estimatedDeliveryAtUtc === null || utc(v.estimatedDeliveryAtUtc)) && typeof v.totalEvents === 'number' && Number.isSafeInteger(v.totalEvents) &&
    v.totalEvents >= 0 && v.totalEvents <= 1000 && v.suppliedHistoryOnly === true && v.exhaustiveHistoryVerified === false &&
    [v.pickupAddress, v.pickupHours, v.pickupDeadline, v.pickupInstructions].every(value => value === null) &&
    v.pickupDetailsSource === 'not_provided_by_tracking_capture' && v.recipientReceiptVerified === false && v.financialEffectAuthorized === false;
}
function event(v: unknown, index: number, readAt: string, simulation: boolean): v is ObservedTrackingEvent {
  return object(v) && Object.keys(v).every(key => ['index', 'occurredAtUtc', 'occurredAtQualified', 'occurrenceSource', 'statusCode',
    'description', 'city', 'province', 'textTruncated', 'originalTextHash'].includes(key)) && v.index === index &&
    (v.occurredAtUtc === null ? v.occurredAtQualified === false && v.occurrenceSource === null : utc(v.occurredAtUtc) &&
      Date.parse(v.occurredAtUtc) <= Date.parse(readAt) && v.occurredAtQualified === true &&
      (v.occurrenceSource === 'provider_occurred_at' || simulation && v.occurrenceSource === 'member_test_action')) &&
    nullableText(v.statusCode, 64) && nullableText(v.description, 2000) && nullableText(v.city, 160) && nullableText(v.province, 100) &&
    typeof v.textTruncated === 'boolean' && hash(v.originalTextHash);
}
function pageReference(v: TrackingHistoryPageReference): boolean {
  return captureId(v.captureId) && hash(v.expectedSourceHash) && hash(v.expectedDisplayHash) && Number.isSafeInteger(v.expectedReadVersion) && v.expectedReadVersion >= 1 &&
    object(v.cursor) && Object.keys(v.cursor).every(key => ['captureId', 'offset'].includes(key)) && v.cursor.captureId === v.captureId &&
    typeof v.cursor.offset === 'number' && Number.isSafeInteger(v.cursor.offset) && v.cursor.offset > 0 && v.cursor.offset < 1000 && v.cursor.offset % 50 === 0;
}
function parse(v: unknown, uid: string, transactionId: string, leg: TrackingHistoryLeg, requested: TrackingHistoryPageReference | undefined, simulation: boolean): TrackingHistoryPage {
  if (!object(v) || Object.keys(v).some(key => !['protocol', 'ownerId', 'transactionId', 'leg', 'capture', 'reason', 'events'].includes(key)) ||
    v.protocol !== 'tracking_history_v1' || v.ownerId !== uid || v.transactionId !== transactionId || v.leg !== leg || !object(v.events) ||
    Object.keys(v.events).some(key => !['items', 'hasMore', 'cursor'].includes(key)) || !Array.isArray(v.events.items) || v.events.items.length > 50 ||
    typeof v.events.hasMore !== 'boolean' || v.events.hasMore !== (v.events.cursor !== null)) throw failure();
  if (v.capture === null) {
    if (requested || v.reason !== 'unrecorded' || v.events.items.length || v.events.hasMore || v.events.cursor !== null) throw failure();
    return v as unknown as TrackingHistoryPage;
  }
  if (!capture(v.capture) || v.reason !== null || requested && (v.capture.captureId !== requested.captureId || v.capture.sourceHash !== requested.expectedSourceHash ||
    v.capture.readVersion !== requested.expectedReadVersion || v.capture.displayHash !== requested.expectedDisplayHash)) throw failure();
  const offset = requested?.cursor.offset ?? 0;
  if (offset > v.capture.totalEvents || v.events.items.length !== Math.min(50, v.capture.totalEvents - offset) ||
    !v.events.items.every((item, index) => event(item, offset + index, (v.capture as ObservedTrackingCapture).providerReadAt, simulation)) ||
    v.events.hasMore !== (offset + v.events.items.length < v.capture.totalEvents)) throw failure();
  if (v.events.cursor !== null && (!object(v.events.cursor) || Object.keys(v.events.cursor).some(key => !['captureId', 'offset'].includes(key)) ||
    v.events.cursor.captureId !== v.capture.captureId || v.events.cursor.offset !== offset + v.events.items.length)) throw failure();
  return v as unknown as TrackingHistoryPage;
}
export function nextTrackingHistoryPage(page: TrackingHistoryPage): TrackingHistoryPageReference | undefined {
  return page.capture && page.events.hasMore && page.events.cursor ? {captureId: page.capture.captureId, expectedSourceHash: page.capture.sourceHash,
    expectedReadVersion: page.capture.readVersion, expectedDisplayHash: page.capture.displayHash, cursor: {...page.events.cursor}} : undefined;
}
export const TrackingHistoryService = {
  async read(uid: string, transactionId: string, leg: TrackingHistoryLeg, requested: TrackingHistoryPageReference | undefined,
    assertContext: () => void, simulatedLeg = false): Promise<TrackingHistoryPage> {
    const session = captureTradeSession(uid); assertContext();
    if (!id(transactionId) || !['forward', 'return'].includes(leg) || requested && !pageReference(requested)) throw failure();
    const response = await httpsCallable<unknown, unknown>(functions, 'checkTrackingStatus')({mode: 'tracking_history_observe',
      expectedUid: uid, transactionId, leg, ...(requested ?? {})});
    assertTradeSessionCurrent(session); assertContext(); return parse(response.data, uid, transactionId, leg, requested, DEV_COMMERCE_TESTING_ENABLED && simulatedLeg);
  },
};
