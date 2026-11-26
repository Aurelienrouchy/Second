/** Native swap events produce durable in-app notices. Optional push is resumed
 * independently; an event/decision is never a bank refund confirmation. */
import { onDocumentCreated, onDocumentUpdated } from 'firebase-functions/v2/firestore';
import * as logger from 'firebase-functions/logger';
import { Timestamp } from 'firebase-admin/firestore';
import { createHash } from 'node:crypto';
import { db, FieldValue } from '../config/firebase';
import {withDocumentaryProjection,swapEventNoticeInputs,recordProducerNoticeIds} from '../utils/documentaryProjection';
import { prepareOperationalNotices, readOperationalNoticeReceipts, type OperationalNoticeInput } from '../utils/notifications';

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value);

/** A producer's own immutable notice receipt takes priority over a trigger
 * mirror. Its protected marker alone is not evidence; reread ALL private receipts. */
async function producerReceipts(tx: FirebaseFirestore.Transaction, swapId: string, before: FirebaseFirestore.DocumentData | null,
  after: FirebaseFirestore.DocumentData, sourceAt: Timestamp) {
  const decision = after.disputeResolutionNotice;
  if (before?.status === 'disputed' && ['cancelled', 'completed'].includes(after.status) &&
      decision?.protocol === 'swap_dispute_notice_v1' && decision.swapId === swapId &&
      decision.initiatorId === after.initiatorId && decision.receiverId === after.receiverId &&
      decision.committedAt instanceof Timestamp && after.disputeResolvedAt instanceof Timestamp &&
      decision.committedAt.isEqual(after.disputeResolvedAt) && decision.committedAt.isEqual(sourceAt) && /^[a-f0-9]{64}$/.test(decision.decisionKey ?? '') &&
      Array.isArray(decision.notificationInputs) && decision.notificationInputs.length === 2 &&
      decision.notificationInputs.every((input: OperationalNoticeInput, index: number) =>
        input.userId === [after.initiatorId, after.receiverId][index] && input.type === 'swap_update' &&
        input.eventKey === `swap_dispute_decision:${swapId}:${decision.decisionKey}` && input.data?.swapId === swapId &&
        input.data?.decisionKey === decision.decisionKey && input.data?.actorUid === decision.actorUid &&
        input.data?.financialInstruction === decision.issue && input.data?.refundConfirmed === 'false')) {
    const receipts = await readOperationalNoticeReceipts(tx, decision.notificationInputs);
    if (Array.isArray(decision.notificationIds) && decision.notificationIds.length === 2 &&
        receipts.every((receipt, index) => !!receipt && receipt.notificationId === decision.notificationIds[index])) return receipts;
  }
  const phase = ['proposed_expired_7d', 'payment_pending_expired_7d'].includes(after.cancelReason)
    ? 'proposal' : typeof after.cancelReason === 'string' && after.cancelReason.startsWith('post_acceptance_expired_14d_from_') ? 'post_acceptance' : null;
  if (before && phase && ((phase === 'proposal' && after.status === 'cancelled') || (phase === 'post_acceptance' && after.status === 'expired'))) {
    const anchor = before.updatedAt instanceof Timestamp ? before.updatedAt.toMillis() : null;
    const eventKey = `swap_expired:${swapId}:${phase}:${before.status}:${anchor}`;
    const targets = [after.initiatorId, after.receiverId];
    const entries = await tx.getAll(...targets.map(userId => db.collection('operational_notice_receipts').doc('operational_' + digest([eventKey, userId]))));
    // Read the producer's frozen content, not today's copy. A source commit
    // timestamp binds it to THIS native transition, not another expiry phase.
    if (entries.every((entry, index) => {
      const receipt = entry.data();
      return receipt?.protocol === 'operational_notice_v1' && receipt.eventKey === eventKey && receipt.userId === targets[index] &&
        receipt.type === 'swap_update' && receipt.committedAt instanceof Timestamp && receipt.committedAt.isEqual(sourceAt) &&
        receipt.data?.swapId === swapId && receipt.data?.sourceStatus === before.status && receipt.data?.expiryPhase === phase;
    })) {
      const receipts = await readOperationalNoticeReceipts(tx, entries.map(entry => entry.data() as OperationalNoticeInput));
      if (receipts.every(Boolean)) return receipts;
    }
  }
  return null;
}

async function commitSwapEvent(swapId: string, eventId: string, sourceAt: Timestamp,
  before: FirebaseFirestore.DocumentData | null, after: FirebaseFirestore.DocumentData) {
  if (!id(swapId) || typeof eventId !== 'string' || !eventId || eventId.length > 500 || !(sourceAt instanceof Timestamp) ||
      !id(after.initiatorId) || !id(after.receiverId) || after.initiatorId === after.receiverId) throw new Error('Native swap event identity unqualified');
  const inputs = swapEventNoticeInputs(swapId, before, after, eventId); if (!inputs.length) return;
  const statusSource = [swapId, eventId, sourceAt.toMillis(), before?.status ?? null, after.status, after.initiatorId, after.receiverId];
  // Preserve the V1 hash for status events already committed before partial
  // progress notices existed. A redelivery must observe its historical receipt.
  const sourceHash = digest(before?.status === after.status
    ? [...statusSource, 'partial_progress_v1', ...inputs.map(input => [input.userId, input.data?.progressField ?? null])]
    : statusSource);
  const ref = db.collection('swaps').doc(swapId), eventRef = ref.collection('notice_events').doc(digest(eventId));
  await withDocumentaryProjection({kind:'swap_notice',swapId,eventId,sourceAt,before,after},()=>db.runTransaction(async tx => {
    const current = (await tx.get(ref)).data(), prior = (await tx.get(eventRef)).data();
    if (prior) {
      if (prior.protocol !== 'swap_notice_event_v1' || prior.sourceHash !== sourceHash || prior.swapId !== swapId ||
          prior.eventId !== eventId || !(prior.committedAt instanceof Timestamp)) throw new Error('Swap notice event receipt conflict');
      return; // A user-deleted notice is never resurrected.
    }
    if (!current || current.initiatorId !== after.initiatorId || current.receiverId !== after.receiverId) {
      throw new Error('Native swap event parties changed; reconciliation required');
    }
    // This is a dated historical event, not a current permission. Newer status
    // changes do not rewrite its content or authorize a financial action.
    const producer = await producerReceipts(tx, swapId, before, after, sourceAt);
    const notices = producer ? null : await prepareOperationalNotices(tx, inputs);
    if(producer)recordProducerNoticeIds(producer.map(receipt=>receipt!.notificationId));
    tx.create(eventRef, { protocol: 'swap_notice_event_v1', swapId, eventId, sourceHash, sourceAt,
      sourceStatus: before?.status ?? null, recordedStatus: after.status, initiatorId: after.initiatorId, receiverId: after.receiverId,
      notificationIds: producer ? producer.map(receipt => receipt!.notificationId) : notices!.notificationIds,
      noticeSource: producer ? 'native_producer_receipts' : 'native_event', deviceDeliveryVerified: false,
      readingVerified: false, committedAt: FieldValue.serverTimestamp() });
    notices?.commit();
  }));
}

export const onSwapCreated = onDocumentCreated({ document: 'swaps/{swapId}', region: 'northamerica-northeast1',
  memory: '512MiB', retry: true }, async event => {
  const snapshot = event.data; if (!snapshot) return;
  try { await commitSwapEvent(event.params.swapId, event.id, snapshot.updateTime, null, snapshot.data()); }
  catch (error) { logger.error('Swap creation notice remains uncommitted; event will retry', { swapId: event.params.swapId,
    error: error instanceof Error ? error.message : 'unknown' }); throw error; }
});

export const onSwapStatusUpdated = onDocumentUpdated({ document: 'swaps/{swapId}', region: 'northamerica-northeast1',
  memory: '512MiB', retry: true }, async event => {
  const before = event.data?.before.data(), after = event.data?.after.data();
    if (!before || !after) return;
  try { await commitSwapEvent(event.params.swapId, event.id, event.data!.after.updateTime, before, after); }
  catch (error) { logger.error('Swap status notice remains uncommitted; event will retry', { swapId: event.params.swapId,
    error: error instanceof Error ? error.message : 'unknown' }); throw error; }
});
