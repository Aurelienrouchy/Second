/** Immutable private display captures. This fingerprint includes provider text
 * and locations; it never replaces the historical financial tracking hash. */
import { createHash } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { db } from '../config/firebase';
import { providerUtc, trackingIdentity, ShipEngineClient, type QualifiedTracking, type TrackingLeg } from '../config/shipEngine';
import { devShippingOrder } from '../config/devShippingSimulation';
import { prepareOperationalNotices } from './notifications';
import { prepareLateTransportIncident } from './lateTransportIncident';

const PROTOCOL = 'tracking_history_v1';
const PAGE_SIZE = 50;
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const text = (value: unknown, max: number) => {
  if (typeof value !== 'string' || !value) return { value: null, truncated: false };
  return { value: value.slice(0, max), truncated: value.length > max };
};
const captureRef = (id: string, captureId: string) => db.collection('transactions').doc(id).collection('tracking_history').doc(captureId);
const pointerField = (leg: TrackingLeg) => leg === 'forward' ? 'trackingHistoryCapture' : 'returnTrackingHistoryCapture';
const fail = () => new HttpsError('failed-precondition', 'La capture du suivi doit être rapprochée. Actualisez ou contactez le support.');

/** Called only after the caller requalifies proof/read/unique native identity
 * inside THIS transaction. Every supplied event is retained in provider order;
 * field truncation is explicit, with original content covered by its own hash. */
export async function recordTrackingHistory(tx: FirebaseFirestore.Transaction, transactionId: string,
  order: FirebaseFirestore.DocumentData, tracking: QualifiedTracking) {
  const proof = tracking.proof, leg = proof.leg;
  const sourceContentHash = hash([tracking.statusCode, tracking.statusDescription,
    tracking.estimatedDeliveryDate ?? null, tracking.actualDeliveryDate ?? null, tracking.events]);
  const events = tracking.events.map((event, index) => {
    const description = text(event.description, 2000), city = text(event.cityLocality, 160), province = text(event.stateProvince, 100);
    const code = text(event.statusCode, 64), occurredAtMs = providerUtc(event.occurredAt);
    return { index, occurredAtUtc: occurredAtMs === null ? null : new Date(occurredAtMs).toISOString(),
      occurredAtQualified: occurredAtMs !== null, occurrenceSource: occurredAtMs === null ? null : proof.provider === 'seconde_dev_simulation' ? 'member_test_action' : 'provider_occurred_at',
      statusCode: code.value, description: description.value, city: city.value, province: province.value,
      textTruncated: description.truncated || city.truncated || province.truncated || code.truncated,
      originalTextHash: hash([event.description, event.cityLocality ?? null, event.stateProvince ?? null, event.statusCode ?? null]) };
  });
  if (events.length > 1000) throw fail();
  const statusDescription = text(tracking.statusDescription, 2000);
  const info = { transactionId, leg, sourceHash: proof.sourceHash, readId: proof.readId, readVersion: proof.readVersion,
    observationSource: proof.provider, sourceContentHash, providerStatusCode: tracking.statusCode, trackingStatus: ShipEngineClient.mapStatus(tracking.statusCode),
    statusDescription: statusDescription.value, statusDescriptionTruncated: statusDescription.truncated,
    providerRequestedAtMs: proof.requestedAtMs, providerObservedAtMs: proof.observedAtMs,
    providerEventAtMs: proof.providerEventAtMs, providerEventTimeSource: proof.providerEventTimeSource,
    estimatedDeliveryAtUtc: providerUtc(tracking.estimatedDeliveryDate) === null ? null : new Date(providerUtc(tracking.estimatedDeliveryDate)!).toISOString(),
    totalEvents: events.length, suppliedHistoryOnly: true, exhaustiveHistoryVerified: false,
    pickupAddress: null, pickupHours: null, pickupDeadline: null, pickupInstructions: null,
    pickupDetailsSource: 'not_provided_by_tracking_capture', recipientReceiptVerified: false, financialEffectAuthorized: false };
  const pages = Array.from({ length: Math.ceil(events.length / PAGE_SIZE) }, (_unused, page) => events.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE));
  const pageHashes = pages.map(page => hash(page)), displayHash = hash([PROTOCOL, info, pageHashes]);
  const captureId = 'tracking_' + hash([transactionId, leg, proof.readId, proof.readVersion, displayHash]);
  const ref = captureRef(transactionId, captureId), existing = (await tx.get(ref)).data();
  if (existing && (existing.protocol !== PROTOCOL || existing.displayHash !== displayHash || existing.buyerId !== order.buyerId ||
      existing.sellerId !== order.sellerId || !(existing.recordedAt instanceof Timestamp))) throw fail();
  // Repeated provider reads can create another capture, but the SAME observed
  // AT/SP content has one durable essential notice per native recipient.
  const pointNotice = ['AT', 'SP'].includes(tracking.statusCode) ? await prepareOperationalNotices(tx,
    [order.buyerId, order.sellerId].map(userId => ({
      eventKey: `tracking_contact_v1:${transactionId}:${leg}:${hash([proof.sourceHash, tracking.statusCode, proof.providerEventAtMs, sourceContentHash])}`,
      userId, type: 'order_moderation',
      title: tracking.statusCode === 'AT' ? 'Tentative de livraison signalée' : 'Point de collecte signalé',
      message: tracking.statusCode === 'AT'
        ? 'Le transporteur indique une tentative de livraison. Consultez le suivi pour les renseignements fournis et la prochaine étape à vérifier. Cette indication ne confirme pas la réception du colis.'
        : 'Le transporteur indique une arrivée en point de collecte. Les coordonnées et les modalités de retrait restent à vérifier auprès du transporteur ; cette indication ne confirme pas la réception par le destinataire.',
      data: { ownerId: userId, transactionId, trackingLeg: leg, providerStatusCode: tracking.statusCode,
        trackingSourceHash: proof.sourceHash, trackingObservationHash: sourceContentHash,
        recipientReceiptVerified: 'false', financialEffectAuthorized: 'false' },
    }))) : null;
  const recordedAt = existing?.recordedAt ?? Timestamp.now();
  const lateTransport = await prepareLateTransportIncident(tx, transactionId, order, tracking,
    { captureId, displayHash, sourceContentHash });
  if (!existing) {
    tx.create(ref, { protocol: PROTOCOL, captureId, buyerId: order.buyerId, sellerId: order.sellerId, info, pageHashes,
      displayHash, recordedAt });
    pages.forEach((items, page) => tx.create(ref.collection('pages').doc(String(page)),
      { protocol: PROTOCOL, captureId, displayHash, offset: page * PAGE_SIZE, items, pageHash: pageHashes[page] }));
  }
  tx.update(db.collection('transactions').doc(transactionId), { [pointerField(leg)]: { protocol: PROTOCOL, captureId,
    sourceHash: proof.sourceHash, readVersion: proof.readVersion, displayHash, recordedAt } });
  // Capture and the financial release guard serialize on the SAME order lock.
  // A current AT/SP contradicting its historical delivery cannot leave a gap
  // before applyTrackingOutcome's later correction transaction. An undated
  // snapshot qualifies only the contradiction/review, never a new scan epoch.
  if (leg === 'forward' && ['AT', 'SP'].includes(tracking.statusCode) &&
      (order.deliveredAt != null || order.deliveryTrackingProof != null || order.fundsReleasedAt != null ||
        ['delivered', 'completed'].includes(order.status))) {
    tx.update(db.collection('transactions').doc(transactionId), { trackingReviewRequired: true,
      ...(order.trackingReviewRequired === true ? {} : { trackingReviewReason: 'current_tracking_contact_contradicts_delivery',
        trackingOwnerMessage: 'Le suivi actuel doit être rapproché avec la livraison enregistrée. Cet avis ne décide pas du remboursement ni des fonds déjà libérés.' }) });
  }
  pointNotice?.commit();
  lateTransport?.commit();
}

/** Data-only owner reader: one source transaction + immutable capture/page.
 * Subsequent pages MUST name the exact capture/hash/version, never a new GET. */
export async function readTrackingHistory(uid: string, raw: any) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
      Object.keys(raw).some(key => !['mode', 'expectedUid', 'transactionId', 'leg', 'captureId', 'expectedSourceHash', 'expectedReadVersion', 'expectedDisplayHash', 'cursor'].includes(key)) ||
      raw.expectedUid !== uid || typeof raw.transactionId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(raw.transactionId)) {
    throw new HttpsError('invalid-argument', 'Compte et commande exacts requis.');
  }
  const leg: TrackingLeg = raw.leg ?? 'forward';
  if (!['forward', 'return'].includes(leg)) throw new HttpsError('invalid-argument', 'Sens de suivi invalide.');
  const explicit = raw.captureId !== undefined;
  if (explicit && (typeof raw.captureId !== 'string' || !/^tracking_[a-f0-9]{64}$/.test(raw.captureId) ||
      !/^[a-f0-9]{64}$/.test(raw.expectedSourceHash ?? '') || !/^[a-f0-9]{64}$/.test(raw.expectedDisplayHash ?? '') ||
      !Number.isSafeInteger(raw.expectedReadVersion) || raw.expectedReadVersion < 1) ||
      !explicit && (raw.cursor != null || raw.expectedSourceHash != null || raw.expectedReadVersion != null || raw.expectedDisplayHash != null)) {
    throw new HttpsError('invalid-argument', 'Capture et versions exactes requises.');
  }
  const offset = raw.cursor?.offset ?? 0;
  if (raw.cursor != null && (!raw.cursor || typeof raw.cursor !== 'object' || Array.isArray(raw.cursor) ||
      Object.keys(raw.cursor).some(key => !['captureId', 'offset'].includes(key)) || raw.cursor.captureId !== raw.captureId) ||
      !Number.isSafeInteger(offset) || offset < 0 || offset > 1000 || offset % PAGE_SIZE !== 0) throw new HttpsError('invalid-argument', 'Curseur invalide.');
  return db.runTransaction(async tx => {
    const order = (await tx.get(db.collection('transactions').doc(raw.transactionId))).data();
    if (!order) throw new HttpsError('not-found', 'Commande introuvable.');
    if (order.buyerId !== uid && order.sellerId !== uid) throw new HttpsError('permission-denied', 'Pas votre commande.');
    const pointer = order[pointerField(leg)];
    if (!explicit && pointer === undefined) return { protocol: PROTOCOL, ownerId: uid, transactionId: raw.transactionId,
      leg, capture: null, reason: 'unrecorded', events: { items: [], cursor: null, hasMore: false } };
    const captureId = explicit ? raw.captureId : pointer?.captureId;
    if (typeof captureId !== 'string' || !/^tracking_[a-f0-9]{64}$/.test(captureId)) throw fail();
    const record = (await tx.get(captureRef(raw.transactionId, captureId))).data(), info = record?.info;
    if (!record || record.protocol !== PROTOCOL || record.captureId !== captureId || record.buyerId !== order.buyerId ||
        record.sellerId !== order.sellerId || !(record.recordedAt instanceof Timestamp) || !info || info.transactionId !== raw.transactionId ||
        info.leg !== leg || !Number.isSafeInteger(info.readVersion) || info.readVersion < 1 || !/^[a-f0-9]{64}$/.test(info.sourceHash ?? '') ||
        typeof info.readId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(info.readId) ||
        !Number.isSafeInteger(info.providerRequestedAtMs) || info.providerRequestedAtMs < 0 || !Number.isSafeInteger(info.providerObservedAtMs) ||
        info.providerObservedAtMs < info.providerRequestedAtMs || info.providerObservedAtMs > record.recordedAt.toMillis() ||
        !(info.providerEventAtMs === null || Number.isSafeInteger(info.providerEventAtMs) && info.providerEventAtMs >= 0 && info.providerEventAtMs <= info.providerObservedAtMs) ||
        !Number.isSafeInteger(info.totalEvents) || info.totalEvents < 0 || info.totalEvents > 1000 || !Array.isArray(record.pageHashes) ||
        record.pageHashes.length !== Math.ceil(info.totalEvents / PAGE_SIZE) || record.pageHashes.some((value: unknown) => typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) ||
        record.displayHash !== hash([PROTOCOL, info, record.pageHashes])) throw fail();
    const pointerMatches = pointer?.protocol === PROTOCOL && pointer.captureId === captureId && pointer.displayHash === record.displayHash &&
      pointer.sourceHash === info.sourceHash && pointer.readVersion === info.readVersion && pointer.recordedAt instanceof Timestamp && pointer.recordedAt.isEqual(record.recordedAt);
    if (!explicit && !pointerMatches) throw fail();
    const currentRead = leg === 'forward' ? order.trackingRead : order.returnTrackingRead;
    const currentCapture = pointerMatches && trackingIdentity(raw.transactionId, order, leg)?.sourceHash === info.sourceHash &&
      currentRead?.schemaVersion === 1 && currentRead.readId === info.readId && currentRead.version === info.readVersion &&
      currentRead.sourceHash === info.sourceHash && currentRead.leg === leg && currentRead.authorizedAt instanceof Timestamp;
    if (explicit && (raw.expectedSourceHash !== info.sourceHash || raw.expectedReadVersion !== info.readVersion || raw.expectedDisplayHash !== record.displayHash)) {
      throw new HttpsError('failed-precondition', 'Les versions de cette capture ne concordent pas.');
    }
    if (offset > info.totalEvents || offset === info.totalEvents && info.totalEvents !== 0) throw new HttpsError('invalid-argument', 'Curseur au-delà des événements fournis.');
    let items: any[] = [];
    if (info.totalEvents) {
      const pageNo = offset / PAGE_SIZE, page = (await tx.get(captureRef(raw.transactionId, captureId).collection('pages').doc(String(pageNo)))).data();
      if (!page || page.protocol !== PROTOCOL || page.captureId !== captureId || page.displayHash !== record.displayHash || page.offset !== offset ||
          !Array.isArray(page.items) || page.items.length !== Math.min(PAGE_SIZE, info.totalEvents - offset) ||
          page.pageHash !== record.pageHashes[pageNo] || hash(page.items) !== page.pageHash) throw fail();
      items = page.items.map((item: any, index: number) => {
        const fields = ['index', 'occurredAtUtc', 'occurredAtQualified', 'occurrenceSource', 'statusCode', 'description', 'city', 'province', 'textTruncated', 'originalTextHash'];
        const nullableText = (value: unknown, max: number) => value === null || typeof value === 'string' && value.length <= max;
        const occurredMs = providerUtc(item?.occurredAtUtc);
        if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).some(key => !fields.includes(key)) ||
            item.index !== offset + index || !(item.occurredAtUtc === null && item.occurredAtQualified === false && item.occurrenceSource === null ||
              occurredMs !== null && item.occurredAtQualified === true &&
                (item.occurrenceSource === 'provider_occurred_at' && info.observationSource !== 'seconde_dev_simulation' ||
                 item.occurrenceSource === 'member_test_action' && info.observationSource === 'seconde_dev_simulation' && devShippingOrder(order))) ||
            !nullableText(item.statusCode, 64) || !nullableText(item.description, 2000) || !nullableText(item.city, 160) || !nullableText(item.province, 100) ||
            typeof item.textTruncated !== 'boolean' || !/^[a-f0-9]{64}$/.test(item.originalTextHash ?? '')) throw fail();
        return Object.fromEntries(fields.map(field => [field, item[field]]));
      });
    }
    const hasMore = offset + items.length < info.totalEvents;
    return { protocol: PROTOCOL, ownerId: uid, transactionId: raw.transactionId, leg,
      capture: { captureId, sourceHash: info.sourceHash, readId: info.readId, readVersion: info.readVersion, displayHash: record.displayHash,
        recordedAt: record.recordedAt.toDate().toISOString(), currentCapture,
        providerReadAt: new Date(info.providerObservedAtMs).toISOString(), providerEventAt: info.providerEventAtMs === null ? null : new Date(info.providerEventAtMs).toISOString(),
        providerStatusCode: info.providerStatusCode, trackingStatus: info.trackingStatus, statusDescription: info.statusDescription,
        statusDescriptionTruncated: info.statusDescriptionTruncated, estimatedDeliveryAtUtc: info.estimatedDeliveryAtUtc,
        totalEvents: info.totalEvents, suppliedHistoryOnly: true, exhaustiveHistoryVerified: false,
        pickupAddress: null, pickupHours: null, pickupDeadline: null, pickupInstructions: null,
        pickupDetailsSource: 'not_provided_by_tracking_capture', recipientReceiptVerified: false, financialEffectAuthorized: false },
      reason: null, events: { items, hasMore, cursor: hasMore ? { captureId, offset: offset + items.length } : null } };
  });
}
