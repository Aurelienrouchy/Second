/** Operational relay of a RECORDED bank observation, not a fresh Stripe GET. */
import {Timestamp} from 'firebase-admin/firestore';
import {quebecCivilDate} from '../shared/age';
import {supportRevision, supportSourceHash} from './supportRequest';

export async function readSupportBankDeadlineItem(tx: FirebaseFirestore.Transaction,
  snapshot: FirebaseFirestore.DocumentSnapshot, nowMs = Date.now()) {
  const root = snapshot.data(), pointer = root?.latestObservation;
  const observation = pointer && typeof pointer.id === 'string' && /^bo_[a-f0-9]{64}$/.test(pointer.id)
    ? (await tx.get(snapshot.ref.collection('observations').doc(pointer.id))).data() : null;
  const document = observation?.document, semantic = document?.semantic;
  const qualified = root?.protocol === 'bank_dispute_case_v1' && root.disputeId === snapshot.id && /^du_[A-Za-z0-9_]{1,190}$/.test(snapshot.id) &&
    Number.isSafeInteger(root.version) && root.version >= 1 &&
    typeof root.transactionId === 'string' && root.transactionId.length > 0 &&
    document?.protocol === 'bank_case_observation_v1' && document.providerQualified === true &&
    document.transactionId === root.transactionId && document.disputeId === snapshot.id && observation?.contentHash === pointer?.contentHash && supportSourceHash(document ?? null) === pointer?.contentHash &&
    pointer.id === 'bo_' + supportSourceHash({transactionId: document.transactionId, semantic, reason: null}) &&
    semantic?.disputeId === snapshot.id && document?.observedAt instanceof Timestamp &&
    document.observedAt.toMillis() > 0 && document.observedAt.toMillis() <= nowMs &&
    /^pi_[A-Za-z0-9_]{1,190}$/.test(semantic.paymentIntentId ?? '') && /^ch_[A-Za-z0-9_]{1,190}$/.test(semantic.chargeId ?? '') &&
    semantic.currency === 'CAD' && Number.isSafeInteger(semantic.amountCents) && semantic.amountCents > 0 && typeof semantic.livemode === 'boolean' &&
    ['needs_response', 'under_review', 'warning_needs_response', 'warning_under_review', 'won', 'lost', 'warning_closed', 'prevented'].includes(semantic.status) &&
    Number.isSafeInteger(semantic.dueBySeconds) && semantic.dueBySeconds >= 0 && semantic.dueBySeconds <= 253402300799 &&
    semantic.dueQualification === (semantic.dueBySeconds === 0 ? 'provider_no_response_allowed' : 'provider_timestamp');
  const dueMs = qualified && semantic.dueBySeconds > 0 ? semantic.dueBySeconds * 1000 : null;
  const actionable = qualified && ['needs_response', 'warning_needs_response'].includes(semantic.status) && dueMs !== null;
  const dueDate = dueMs === null ? null : quebecCivilDate(new Date(dueMs));
  const state = !qualified ? 'unknown' as const : !actionable ? 'not_actionable' as const : dueMs! < nowMs
    ? 'overdue' as const : dueDate === quebecCivilDate(new Date(nowMs)) ? 'due_today' as const : 'pending' as const;
  return {id: snapshot.id, kind: 'bank_dispute' as const, status: qualified ? semantic.status as string : null,
    version: Number.isSafeInteger(root?.version) && root!.version > 0 ? root!.version as number : null, assignedAdminId: null,
    sourceRevision: supportRevision(snapshot), responseRecorded: qualified && semantic.hasEvidence === true,
    responseCompletenessVerified: false, providerObservedAt: qualified ? document.observedAt.toDate().toISOString() : null,
    currentProviderStateVerified: false, transactionId: qualified ? root!.transactionId as string : null,
    clock: {qualification: qualified ? 'native_provider_observation' as const : 'unknown' as const,
      receivedAt: null, receivedCivilDate: null, statutoryDueDate: null, recordedDueDate: dueDate,
      providerDueAt: dueMs === null ? null : new Date(dueMs).toISOString(), state,
      reason: qualified ? null : 'native_bank_observation_missing_or_incoherent' as const,
      clockOriginSupportRequestId: null, basis: 'recorded_provider_evidence_deadline' as const,
      earliestExternalReceiptVerified: false, deadlineExtended: false}};
}
