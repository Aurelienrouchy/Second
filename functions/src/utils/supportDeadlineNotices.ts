/** Shared durable deadline relay used by the native observer and daily catch-up. */
import {Timestamp} from 'firebase-admin/firestore';
import {db, auth} from '../config/firebase';
import {SUPPORT_COLLECTION, supportDeadlineItem, supportDeadlineAlertId, supportHash} from './supportRequest';
import {readSupportBankDeadlineItem} from './supportBankDeadline';
import {prepareOperationalNotices, supportDeadlineNoticeInput} from './notifications';
const SUPPORT_MONITOR_LEASE_MS = 10 * 60_000;
const monitorId = (v: unknown): v is string => typeof v === 'string' && !!v && !v.includes('/') &&
  !['.', '..'].includes(v) && Buffer.byteLength(v, 'utf8') <= 1500;
/** Recipient pages are committed BEFORE the monitor advances. A failed page
 * resumes from its native cursor; old notice receipts prevent duplicates. */
export async function recordSupportDeadlineAlert(id: string, cycleId: string, lockRef: FirebaseFirestore.DocumentReference | null, ownerId: string | null, bank: boolean) {
  for (let pages = 0; pages < 20; pages++) {
    const finished = await db.runTransaction(async tx => {
      if (lockRef) {
        const lease = (await tx.get(lockRef)).data()?.scanLease;
        if (lease?.ownerId !== ownerId || !(lease.lockedUntil instanceof Timestamp) || lease.lockedUntil.toMillis() <= Date.now()) {
          throw new Error('Support deadline monitor checkpoint changed.');
        }
      }
      const caseRef = db.collection(bank ? 'bank_dispute_cases' : SUPPORT_COLLECTION).doc(id), source = await tx.get(caseRef),
        item = bank ? await readSupportBankDeadlineItem(tx, source) : supportDeadlineItem(source);
      const alertId = item && supportDeadlineAlertId(item);
      if (!item || !alertId) return true;
      const ref = caseRef.collection('deadline_alerts').doc(alertId), prior = (await tx.get(ref)).data(), nowMs = Date.now();
      if (prior && (prior.protocol !== 'support_deadline_alert_v1' || prior.alertId !== alertId || prior.supportRequestId !== id ||
          prior.clockState !== item.clock.state || prior.clockQualification !== item.clock.qualification ||
          !Number.isSafeInteger(prior.firstObservedAtMs) || prior.firstObservedAtMs < 1 || prior.firstObservedAtMs > nowMs ||
          !Number.isSafeInteger(prior.observedAtMs) || prior.observedAtMs < prior.firstObservedAtMs || prior.observedAtMs > nowMs ||
          !prior.recipientScan || typeof prior.recipientScan.cycleId !== 'string' || typeof prior.recipientScan.completed !== 'boolean' || typeof prior.recipientScan.awaitingAdmin !== 'boolean' ||
          prior.recipientScan.afterId !== null && !monitorId(prior.recipientScan.afterId) ||
          !Number.isSafeInteger(prior.recipientScan.inspected) || prior.recipientScan.inspected < 0 ||
          !Number.isSafeInteger(prior.recipientScan.noticesPrepared) || prior.recipientScan.noticesPrepared < 0)) {
        throw new Error('Support deadline alert requires reconciliation.');
      }
      if (prior?.recipientScan.cycleId === cycleId && prior.recipientScan.completed) return true;
      const previous = prior?.recipientScan.cycleId === cycleId ? prior.recipientScan : {afterId: null, inspected: 0, noticesPrepared: 0};
      let query = db.collection('users').where('isAdmin', '==', true).orderBy('__name__').limit(50);
      if (previous.afterId) query = query.startAfter(previous.afterId);
      const candidates = await tx.get(query), recipients: string[] = [];
      for (const row of candidates.docs) {
        const data = row.data();
        if (data.isAdmin !== true || Object.prototype.hasOwnProperty.call(data, 'isActive') && data.isActive !== true) continue;
        try {if (!(await auth.getUser(row.id)).disabled) recipients.push(row.id);}
        catch (error) {if ((error as {code?: string})?.code !== 'auth/user-not-found') throw error;}
      }
      const notices = await prepareOperationalNotices(tx, recipients.map(uid => supportDeadlineNoticeInput(uid, id, alertId,
        item.clock.state as 'unknown'|'due_today'|'overdue'|'pending', bank ? 'bank_dispute_cases' : SUPPORT_COLLECTION)));
      const completed = candidates.size < 50, awaitingAdmin = completed && previous.noticesPrepared + recipients.length === 0;
      const recipientScan = {cycleId, completed: completed && !awaitingAdmin, awaitingAdmin,
        afterId: awaitingAdmin ? null : candidates.docs.at(-1)?.id ?? previous.afterId,
        inspected: previous.inspected + candidates.size, noticesPrepared: previous.noticesPrepared + recipients.length};
      notices.commit();
      tx.set(ref, {protocol: 'support_deadline_alert_v1', supportRequestId: id, alertId, kind: item.kind,
        clockState: item.clock.state, clockQualification: item.clock.qualification, statutoryDueDate: item.clock.statutoryDueDate,
        firstObservedAtMs: prior?.firstObservedAtMs ?? nowMs, observedAtMs: nowMs, recipientScan,
        responseCompletenessVerified: false, deviceDeliveryVerified: false, readingVerified: false, deadlineExtended: false});
      if (lockRef) tx.update(lockRef, {'scanLease.lockedUntil': Timestamp.fromMillis(nowMs + SUPPORT_MONITOR_LEASE_MS)});
      return awaitingAdmin ? 'awaiting_admin' as const : completed;
    });
    if (finished === 'awaiting_admin') return false;
    if (finished) return true;
  }
  return false; // Bounded fan-out; the source-page checkpoint has not advanced.
}

/** The existing webhook/GET cannot ACK a known short deadline before its
 * alert and notice outbox are durable. Retrying an old event also services it. */
export async function relayNativeBankDeadline(disputeId: string) {
  const ref = db.collection('bank_dispute_cases').doc(disputeId), initial = (await ref.get()).data();
  if (!initial) throw new Error('Native bank deadline case unavailable.');
  const cycleId = 'bank_observation_' + supportHash(initial.latestObservation ?? null);
  if (await recordSupportDeadlineAlert(disputeId, cycleId, null, null, true)) return;
  const pending = await db.runTransaction(async tx => {
    const item = await readSupportBankDeadlineItem(tx, await tx.get(ref)), id = supportDeadlineAlertId(item);
    if (!id) return true;
    const alert = (await tx.get(ref.collection('deadline_alerts').doc(id))).data();
    return alert?.protocol === 'support_deadline_alert_v1' && alert.alertId === id &&
      (alert.recipientScan?.completed === true || alert.recipientScan?.awaitingAdmin === true);
  });
  if (!pending) throw new Error('Bank deadline admin notice fan-out remains resumable before acknowledgement.');
}
