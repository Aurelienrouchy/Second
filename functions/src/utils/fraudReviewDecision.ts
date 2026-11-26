/** Human review of exact native risk sources; never a money/stock/identity decision. */
import {Timestamp} from 'firebase-admin/firestore';
import {HttpsError} from 'firebase-functions/v2/https';
import {db, FieldValue} from '../config/firebase';
import {fraudBusinessReviewKey, fraudGuardDigest, fraudReviewBlocksProgress} from '../shared/fraudReviewGuard';
import {fraudNativeBinding, qualifiedFraudObservation} from './fraudReview';
import {readFraudCaseHumanResolution, fraudDecisionRef, qualifiedFraudHumanDecision} from './fraudReviewResolutionProof';
import {supportAdmin, supportCurrentAdminSession, supportSourceHash} from './supportRequest';
import {prepareOperationalNotices} from './notifications';
import {readFraudOrderCases} from './fraudReviewCandidates';

type Data = FirebaseFirestore.DocumentData;
const id = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(v);
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const native = (v: unknown): v is Timestamp => v instanceof Timestamp && v.toMillis() >= 0 && v.toMillis() <= Date.now();
const revision = (s: FirebaseFirestore.DocumentSnapshot) => s.updateTime ? `${s.updateTime.seconds}:${s.updateTime.nanoseconds}` : null;
const effects = {guiltEstablished: false, financialEffectAuthorized: false, inventoryReleaseAuthorized: false,
  identityDecision: 'none', independentHoldsReleased: false, currentGuardStateVerified: false};
function object(value: any, keys: string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !keys.includes(k)))
    throw new HttpsError('invalid-argument', 'Paramètres de revue invalides.');
  return value;
}
function actor(request: any) {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Connexion requise.');
  if (request.data?.expectedUid !== uid) throw new HttpsError('permission-denied', 'La session a changé.');
  return uid as string;
}
async function currentAdmin(tx: FirebaseFirestore.Transaction, request: any, uid: string) {
  // Re-run native Auth/cutoff checks on each TX retry; role source is private.
  const claim = await supportCurrentAdminSession(request);
  await supportAdmin(tx, uid, claim);
}

/** Attributed cases AND exact native-reference candidates share the order TX. A bounded
 * overflow is explicit and cannot authorize a close. No provider GET. */
export async function readFraudCurrentCaseSet(tx: FirebaseFirestore.Transaction, transactionId: string, orderSnap: FirebaseFirestore.DocumentSnapshot) {
  const order = orderSnap.data();
  if (!order) return null;
  const nativeOrder = id(order.buyerId) && id(order.sellerId) && order.buyerId !== order.sellerId && order.currency === 'CAD';
  const page = await readFraudOrderCases(tx, transactionId, order);
  const inspected = page.docs, complete = page.complete;
  const paymentId = order.stripePaymentIntentId;
  const bound = inspected.length && nativeOrder && typeof paymentId === 'string' && /^pi_[A-Za-z0-9_]{1,190}$/.test(paymentId)
    ? await tx.get(db.collection('transactions').where('stripePaymentIntentId', '==', paymentId).limit(2)) : null;
  const uniqueOrder = bound?.size === 1 && bound.docs[0].id === transactionId;
  const rows = [];
  for (const snap of inspected) {
    const data = snap.data(), observationId = data.latestObservationId;
    const observationSnap = hash(observationId) ? await tx.get(snap.ref.collection('observations').doc(observationId)) : null;
    const proof = observationSnap?.data(), proofQualified = qualifiedFraudObservation(proof, snap.id, observationId);
    const qualified = nativeOrder && /^fr_[a-f0-9]{64}$/.test(snap.id) && data.protocol === 'fraud_review_case_v1' && data.caseId === snap.id &&
      data.transactionId === transactionId && ['review', 'early_fraud_warning'].includes(data.family) &&
      data.state === 'matched' && native(data.firstObservedAt) && data.resolutionState === 'human_review_required' &&
      data.financialDecision === 'none' && data.identityDecision === 'none' && proofQualified && proof?.binding?.transactionId === transactionId &&
      proof.binding.buyerId === order.buyerId && proof.binding.sellerId === order.sellerId && proof.payment && uniqueOrder &&
      fraudNativeBinding(transactionId, order, proof.payment, Timestamp.now()) !== null;
    const reviewKey = qualified ? fraudBusinessReviewKey(snap.id, proof!.current, proof!.payment, proof!.binding) : null;
    const historicalKey = data.humanResolution?.reviewKey === null ? null :
      hash(data.humanResolution?.reviewKey) ? data.humanResolution.reviewKey : reviewKey;
    const human = await readFraudCaseHumanResolution(tx, snap.id, historicalKey, data, order, transactionId);
    const applies = human && historicalKey === reviewKey;
    const humanUnqualified = Object.prototype.hasOwnProperty.call(data, 'humanResolution') && !human;
    const reference = {caseId: snap.id, caseRevision: revision(snap), caseSourceHash: supportSourceHash(data),
      observationId: proofQualified ? observationId : null, observationRevision: proofQualified && observationSnap ? revision(observationSnap) : null,
      observationHash: proofQualified ? proof!.semanticHash : null, reviewKey,
      qualification: qualified && !humanUnqualified ? 'native_current_case' : 'unknown',
      humanAction: applies ? human!.action : humanUnqualified ? 'unknown' : 'unreviewed',
      humanDecisionId: human?.decisionId ?? null};
    rows.push({snap, data, reference, human, applies: !!applies, qualified: qualified && !humanUnqualified});
  }
  const marker = order.fraudReview;
  let markerQualified = !fraudReviewBlocksProgress(order);
  if (fraudReviewBlocksProgress(order)) {
    markerQualified = marker?.protocol === 'fraud_review_guard_v1' && marker.transactionId === transactionId &&
      marker.source === 'stripe_radar' && marker.reviewRequired === true && marker.resolutionState === 'human_review_required' &&
      native(marker.firstObservedAt) && rows.some(r => r.snap.id === marker.caseId && r.qualified);
    if (!markerQualified && marker?.protocol === 'fraud_review_guard_v2' && marker.transactionId === transactionId &&
        marker.buyerId === order.buyerId && marker.sellerId === order.sellerId && marker.source === 'operator_fraud_review' &&
        marker.reviewRequired === true && native(marker.firstObservedAt) && /^fd_[a-f0-9]{64}$/.test(marker.decisionId ?? '')) {
      const nativeDecision = qualifiedFraudHumanDecision((await tx.get(fraudDecisionRef(marker.decisionId))).data(), marker.decisionId);
      markerQualified = !!nativeDecision && nativeDecision.action === 'retain_review' && nativeDecision.transactionId === transactionId &&
        nativeDecision.buyerId === order.buyerId && nativeDecision.sellerId === order.sellerId &&
        nativeDecision.decidedAt.isEqual(marker.firstObservedAt) && nativeDecision.source.caseSetHash === marker.reviewSetHash;
    }
  }
  const references = rows.map(row => row.reference);
  const source = {orderRevision: revision(orderSnap), orderSourceHash: supportSourceHash(order),
    caseSetHash: supportSourceHash({cases: references, complete})};
  return {order, nativeOrder, rows, source, markerQualified, complete, canClose: complete && nativeOrder && markerQualified && rows.length > 0 && rows.every(r => r.qualified),
    coverage: {inspected: rows.length, limit: 30, hasMore: !complete, completeCurrentCaseSet: complete,
      source: 'currently_attributed_native_cases', exhaustiveRiskHistoryVerified: false}};
}

/** Consumers call ONLY for NEW permissions, after their immutable historical
 * intents/receipts. Absent/malformed markers never override private open cases. */
export async function fraudReviewAllowsProgress(tx: FirebaseFirestore.Transaction, transactionId: string,
  order: Data, orderSnap?: FirebaseFirestore.DocumentSnapshot): Promise<boolean> {
  if (fraudReviewBlocksProgress(order)) return false;
  const snap = orderSnap ?? await tx.get(db.collection('transactions').doc(transactionId));
  const set = await readFraudCurrentCaseSet(tx, transactionId, snap);
  if (!set || !set.complete || fraudReviewBlocksProgress(set.order)) return false;
  return set.rows.every(row => row.qualified && row.applies && row.human?.action === 'close_review_for_sources');
}

export async function previewFraudReviewDecision(request: any) {
  const uid = actor(request), raw = object(request.data, ['mode', 'expectedUid', 'transactionId']);
  if (!id(raw.transactionId)) throw new HttpsError('invalid-argument', 'Commande exacte requise.');
  return db.runTransaction(async tx => {
    await currentAdmin(tx, request, uid);
    const snap = await tx.get(db.collection('transactions').doc(raw.transactionId));
    const set = await readFraudCurrentCaseSet(tx, raw.transactionId, snap);
    if (!set) throw new HttpsError('failed-precondition', 'Source de commande non qualifiée.');
    return {protocol: 'fraud_review_preview_v1', actorId: uid, transactionId: raw.transactionId, readAt: Timestamp.now().toDate().toISOString(),
      source: set.source, cases: set.rows.map(r => r.reference), coverage: set.coverage,
      canCloseOwnReview: set.canClose, canRetainReview: set.nativeOrder && set.rows.length > 0, markerQualification: set.markerQualified ? 'native_or_absent' : 'unknown',
      options: ['retain_review', 'close_review_for_sources'], ...effects};
  });
}
function commandInput(value: any) {
  const c = object(value, ['transactionId', 'source', 'action', 'reason', 'acknowledged']);
  const s = object(c.source, ['orderRevision', 'orderSourceHash', 'caseSetHash']);
  if (!id(c.transactionId) || !['retain_review', 'close_review_for_sources'].includes(c.action) || c.acknowledged !== true ||
      typeof c.reason !== 'string' || !c.reason.trim() || c.reason.length > 2000 ||
      typeof s.orderRevision !== 'string' || !/^\d{1,20}:\d{1,9}$/.test(s.orderRevision) || !hash(s.orderSourceHash) || !hash(s.caseSetHash))
    throw new HttpsError('invalid-argument', 'Instruction humaine motivée et sources exactes requises.');
  return {transactionId: c.transactionId as string, source: {orderRevision: s.orderRevision as string,
    orderSourceHash: s.orderSourceHash as string, caseSetHash: s.caseSetHash as string},
    action: c.action as 'retain_review' | 'close_review_for_sources', reason: c.reason.trim(), acknowledged: true};
}
function view(uid: string, requestId: string, payloadHash: string, command: ReturnType<typeof commandInput>, receipt?: any, decision?: any) {
  return {protocol: 'fraud_review_command_v1', actorId: uid, requestId, payloadHash, transactionId: command.transactionId, action: command.action,
    state: receipt?.state ?? 'unrecorded', decisionId: receipt?.decisionId ?? null,
    recordedAt: native(receipt?.recordedAt) ? receipt.recordedAt.toDate().toISOString() : null,
    reason: receipt?.reason ?? null, ownMarkerRemovedAtCommit: decision?.markerMutation === 'removed', ...effects};
}

export async function commandFraudReviewDecision(request: any) {
  const uid = actor(request), raw = object(request.data, ['mode', 'expectedUid', 'requestId', 'operation', 'command']);
  if (typeof raw.requestId !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(raw.requestId) ||
      !['execute', 'observe', 'neutralize'].includes(raw.operation)) throw new HttpsError('invalid-argument', 'Intention stable et opération requises.');
  const command = commandInput(raw.command), payloadHash = fraudGuardDigest(command), commandId = fraudGuardDigest([uid, raw.requestId]);
  const ref = db.collection('fraud_review_commands').doc(commandId), decisionId = 'fd_' + commandId;
  return db.runTransaction(async tx => {
    const receipt = (await tx.get(ref)).data();
    // TRUE historical receipt first: changed reserves, sources or role do not
    // rewrite the native origin or grant a fresh instruction on replay.
    if (receipt) {
      if (receipt.protocol !== 'fraud_review_command_v1' || receipt.actorId !== uid || receipt.requestId !== raw.requestId ||
          receipt.payloadHash !== payloadHash || fraudGuardDigest(receipt.command) !== payloadHash ||
          !['committed', 'not_executed'].includes(receipt.state) || !native(receipt.recordedAt))
        throw new HttpsError('already-exists', 'Cette référence désigne une autre intention ou un reçu inconnu.');
      if (receipt.state === 'not_executed') return view(uid, raw.requestId, payloadHash, command, receipt);
      const d = qualifiedFraudHumanDecision((await tx.get(fraudDecisionRef(decisionId))).data(), decisionId);
      if (!d || receipt.decisionId !== decisionId || d.actorId !== uid || d.requestId !== raw.requestId || d.payloadHash !== payloadHash ||
          d.transactionId !== command.transactionId || d.action !== command.action || !d.decidedAt.isEqual(receipt.recordedAt))
        throw new HttpsError('failed-precondition', 'Le reçu historique de décision doit être rapproché.');
      return view(uid, raw.requestId, payloadHash, command, receipt, d);
    }
    await currentAdmin(tx, request, uid);
    if (raw.operation === 'observe') return view(uid, raw.requestId, payloadHash, command);
    const recordedAt = Timestamp.now();
    const notExecuted = (reason: string) => {
      const record = {protocol: 'fraud_review_command_v1', actorId: uid, requestId: raw.requestId, payloadHash,
        command, state: 'not_executed', decisionId: null, recordedAt, reason};
      tx.create(ref, record); return view(uid, raw.requestId, payloadHash, command, record);
    };
    if (raw.operation === 'neutralize') return notExecuted('requester_neutralized');
    const orderRef = db.collection('transactions').doc(command.transactionId), snap = await tx.get(orderRef);
    const set = await readFraudCurrentCaseSet(tx, command.transactionId, snap);
    if (!set || !set.nativeOrder) return notExecuted('native_order_source_unqualified');
    if (!['orderRevision', 'orderSourceHash', 'caseSetHash'].every(k => command.source[k as keyof typeof command.source] === set.source[k as keyof typeof set.source]))
      return notExecuted('source_changed');
    if (set.rows.length === 0) return notExecuted('no_attributed_case');
    if (command.action === 'close_review_for_sources' && !set.canClose) return notExecuted('case_set_or_marker_unqualified');
    const changes = set.rows.filter(row => !row.applies || row.human?.action !== command.action);
    const remove = command.action === 'close_review_for_sources' && fraudReviewBlocksProgress(set.order);
    const create = command.action === 'retain_review' && !fraudReviewBlocksProgress(set.order);
    const notices = changes.length || remove || create ? await prepareOperationalNotices(tx,
      [set.order.buyerId, set.order.sellerId].map(userId => ({eventKey: `fraud_human_review:v1:${decisionId}`, userId,
        type: 'order_moderation', title: 'Examen du paiement', message: command.action === 'close_review_for_sources'
          ? 'L’équipe a fermé la revue de paiement pour les sources examinées. Cette décision ne confirme ni un remboursement, ni une réception bancaire, ni une autorisation d’expédier. Les autres dossiers et obligations restent à vérifier.'
          : 'L’équipe maintient la revue de paiement de cette commande. Consultez le dossier et contactez le support pour la suite. Cet avis ne constitue pas une accusation et ne décide pas du remboursement ou des fonds déjà traités.',
        data: {ownerId: userId, transactionId: command.transactionId, fraudDecisionId: decisionId}}))) : null;
    const existing = await tx.get(fraudDecisionRef(decisionId));
    if (existing.exists) throw new HttpsError('failed-precondition', 'Une décision sans reçu de commande doit être rapprochée.');
    const document = {protocol: 'fraud_human_decision_v1', decisionId, actorId: uid, requestId: raw.requestId, payloadHash,
      transactionId: command.transactionId, buyerId: set.order.buyerId, sellerId: set.order.sellerId,
      action: command.action, reason: command.reason, source: set.source, cases: set.rows.map(row => row.reference),
      coverage: set.coverage, decidedAt: recordedAt, markerMutation: remove ? 'removed' : create ? 'created' : 'unchanged',
      changedCaseIds: changes.map(row => row.snap.id), ...effects};
    tx.create(fraudDecisionRef(decisionId), {protocol: document.protocol, decisionId, document, contentHash: supportSourceHash(document)});
    for (const row of changes) tx.update(row.snap.ref, {
      ...(row.qualified ? {buyerId: set.order.buyerId, sellerId: set.order.sellerId, attributionQualified: true} : {}),
      humanResolution: {protocol: 'fraud_case_human_resolution_v1',
      caseId: row.snap.id, transactionId: command.transactionId, decisionId, reviewKey: row.reference.reviewKey,
      action: command.action, actorId: uid, decidedAt: recordedAt}});
    if (remove) tx.update(orderRef, {fraudReview: FieldValue.delete()});
    if (create) tx.update(orderRef, {fraudReview: {protocol: 'fraud_review_guard_v2', transactionId: command.transactionId,
      buyerId: set.order.buyerId, sellerId: set.order.sellerId, source: 'operator_fraud_review', reviewRequired: true,
      resolutionState: 'human_review_required', firstObservedAt: recordedAt, decisionId, reviewSetHash: set.source.caseSetHash}});
    notices?.commit();
    const record = {protocol: 'fraud_review_command_v1', actorId: uid, requestId: raw.requestId, payloadHash,
      command, state: 'committed', decisionId, recordedAt, reason: null};
    tx.create(ref, record);
    return view(uid, raw.requestId, payloadHash, command, record, document);
  });
}
