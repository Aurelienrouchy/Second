/** Private contextual reading, never a fraud score or a financial permission. */
import {Timestamp} from 'firebase-admin/firestore';
import {HttpsError} from 'firebase-functions/v2/https';
import {db} from '../config/firebase';
import {supportUid, supportObject, supportId, supportRequestId, supportHash, supportSourceHash, supportRevision,
  supportCurrentAdminSession, supportAdmin} from './supportRequest';
import {assertRecentAccountAuthentication, assertAccountSecurityOpen} from './eligibility';
import {qualifiedClaim} from './productParcelRecourse';
import {productReviewCaseId, productReviewCaseRef} from './productReviewSource';
import {readProductReviewContributionProof} from './productReviewContributions';
import {eventProof} from './productReviewWorkflow';
import {readProductParcelSources} from './productReviewParcel';
import {parseRefundDecisionInput, readAdminRefundDecision, refundDecisionId, type RefundDecisionInput} from './refundDecision';
import {readDisputeDecision, type DisputeResolutionInput} from '../callable/payments/disputes';

export const PARCEL_CLAIM_HISTORY_CAPABILITY = 'parcel_claim_history_v1';
export const PARCEL_CLAIM_HISTORY_ENABLED: boolean = true;
export type ParcelClaimHistorySourceReference = {transactionId: string; disputeId: string; sourceHash: string};
export type ParcelClaimHistoryRequest = {
  capability: typeof PARCEL_CLAIM_HISTORY_CAPABILITY; mode: 'parcel_claim_history_observe'; expectedUid: string;
  transactionId: string; disputeId: string;
} & ({cursor?: null; expectedSource?: ParcelClaimHistorySourceReference} |
  {cursor: {lastId: string}; expectedSource: ParcelClaimHistorySourceReference});
const LIMIT = 10, DECISION_LIMIT = 3;
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const docId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && Buffer.byteLength(v, 'utf8') <= 1500 &&
  !v.includes('/') && !['.', '..'].includes(v) && !/^__.*__$/.test(v);
const native = (v: unknown): v is Timestamp => v instanceof Timestamp && Number.isSafeInteger(v.toMillis()) && v.toMillis() >= 0 && v.toMillis() <= Date.now();
const iso = (v: unknown) => native(v) ? v.toDate().toISOString() : null;
const context = (id: string) => ({kind: 'order' as const, id});
const noAuthority = {fraudEstablished: false, physicalReceiptVerified: false, rejectionPermissionGranted: false,
  financialPermissionGranted: false, inventoryPermissionGranted: false, bankArrivalVerified: false} as const;
const safeOrderId = (v: unknown) => {try {return supportId(v);} catch {return null;}};
const knownOtherReasons = new Set(['not_as_described', 'damaged', 'other', 'wrong_item', 'seller_no_show', 'buyer_no_show', 'payment_capture_anomaly']);
async function readOrUnknown<T>(read: () => Promise<T>): Promise<T | null> {
  try {return await read();} catch (e) {
    if (e instanceof HttpsError && ['failed-precondition', 'invalid-argument', 'not-found', 'unavailable'].includes(e.code)) return null;
    throw e;
  }
}

function sourceInput(value: unknown) {
  const v = supportObject(value, ['transactionId', 'disputeId', 'sourceHash']);
  if (!hash(v.sourceHash)) throw new HttpsError('invalid-argument', 'Source sélectionnée exacte requise.');
  return {transactionId: supportId(v.transactionId), disputeId: supportId(v.disputeId), sourceHash: v.sourceHash};
}
/** Old reports retain an identifiable origin only when their own immutable receipt agrees. */
async function reportOrigin(tx: FirebaseFirestore.Transaction, id: string, claimId: string, claim: any, order: any) {
  if (claim.reportOwnerId !== order.buyerId || !native(claim.createdAt)) return null;
  let requestId: string;
  try {requestId = supportRequestId(claim.reportRequestId);} catch {return null;}
  if (claimId !== 'problem_' + supportHash([order.buyerId, id, requestId])) return null;
  if (claim.productReview?.topic === 'parcel_delivery') {
    try {
      if (!await qualifiedClaim(tx, id, order.buyerId, claimId, claim, claim.productReview) ||
          claim.productReview.actorRole !== 'buyer' || claim.productReview.leg !== 'forward') return null;
      return {qualification: 'native_parcel_report_receipt' as const, kind: 'product_contribution' as const,
        key: supportHash([order.buyerId, id, claim.productReview.contributionId, 'forward']),
        contributionId: claim.productReview.contributionId as string, contributionHash: claim.productReview.contributionHash as string,
        requestId, recourseScope: claim.recourseScope as 'parcel_investigation' | 'buyer_delivery' | 'seller_return_parcel',
        reportedAt: claim.createdAt.toDate().toISOString()};
    } catch (e) {if (e instanceof HttpsError) return null; throw e;}
  }
  // A product reference with another topic does not qualify a parcel claim.
  if (claim.productReview != null) return null;
  const details = claim.details ?? null;
  if (details !== null && (typeof details !== 'string' || !details.trim() || details.trim() !== details || details.length > 1000)) return null;
  const extension = claim.setDeclaration === undefined ? {} : {setDeclaration: claim.setDeclaration};
  const payloadHash = supportHash({reason: claim.reason, details, ...extension});
  const receipt = (await tx.get(db.collection('transactions').doc(id).collection('problem_requests').doc(supportHash([order.buyerId, requestId])))).data();
  if (receipt?.protocol !== 'transaction_problem_report_v1' || receipt.ownerId !== order.buyerId || receipt.transactionId !== id ||
      receipt.requestId !== requestId || receipt.disputeId !== claimId || receipt.payloadHash !== payloadHash || claim.reportPayloadHash !== payloadHash ||
      receipt.state !== 'committed' || receipt.committed !== true || receipt.freezeCommitted !== true || receipt.reason !== null ||
      receipt.admissionVerified !== false || receipt.financialEffect !== 'none' || receipt.externalRecourseDeadlineExtended !== false ||
      receipt.productReview != null || supportHash(receipt.setDeclaration ?? null) !== supportHash(claim.setDeclaration ?? null) ||
      typeof receipt.reportedAt !== 'string' || !Number.isFinite(Date.parse(receipt.reportedAt)) || Date.parse(receipt.reportedAt) < 0 ||
      Date.parse(receipt.reportedAt) > claim.createdAt.toMillis()) return null;
  return {qualification: 'native_order_report_receipt' as const, kind: 'report_intent' as const,
    key: supportHash([order.buyerId, id, requestId]), contributionId: null, contributionHash: null, requestId,
    recourseScope: 'order_problem' as const, reportedAt: receipt.reportedAt};
}
async function parcelDeclaration(tx: FirebaseFirestore.Transaction, id: string, order: any, origin: Awaited<ReturnType<typeof reportOrigin>>) {
  if (origin?.kind !== 'product_contribution') return null;
  const c = context(id), raw = (await tx.get(productReviewCaseRef(c).collection('contributions').doc(origin.contributionId!))).data();
  const proof = await readProductReviewContributionProof(tx, c, origin.contributionId!, raw), statement = proof?.command.parcelStatement;
  if (!proof || raw?.contentHash !== origin.contributionHash || proof.actorId !== order.buyerId || proof.actorRole !== 'buyer' ||
      proof.topic !== 'parcel_delivery' || !statement || statement.leg !== 'forward') return null;
  return {qualification: 'native_actor_statement' as const, contributionId: origin.contributionId, contentHash: origin.contributionHash,
    receiptDeclared: statement.receipt, reasonDeclared: statement.reason, observedAtDeclared: statement.chronology.observedAt,
    recordedAt: iso(proof.recordedAt), declarationIsPhysicalProof: false};
}
/** The source/corpus was qualified when this immutable issue was recorded.
 * Current completeness/authority is deliberately not inferred from its pointer. */
async function productIssue(tx: FirebaseFirestore.Transaction, id: string, order: any, origin: Awaited<ReturnType<typeof reportOrigin>>) {
  const c = context(id), ref = productReviewCaseRef(c), root = (await tx.get(ref)).data();
  const empty = {qualification: 'unknown' as const, caseId: productReviewCaseId(c), caseVersion: null, caseSourceHash: null, issue: null,
    currentCorpusQualified: false, financialPermissionGranted: false};
  if (!root || root.protocol !== 'product_review_case_v1' || root.caseId !== productReviewCaseId(c) ||
      supportHash(root.context) !== supportHash(c) || !Number.isSafeInteger(root.version) || root.version < 1) return empty;
  const common = {...empty, caseVersion: root.version as number, caseSourceHash: supportSourceHash(root)};
  const pointer = root.latestOutcome;
  if (!/^pe_[a-f0-9]{64}$/.test(pointer?.eventId ?? '') || !hash(pointer?.contentHash)) return common;
  const raw = (await tx.get(ref.collection('communications').doc(pointer.eventId))).data();
  const proof = await eventProof(tx, c, pointer.eventId, raw);
  if (!proof || proof.kind !== 'issue_outcome' || proof.actorRole !== 'operator' || raw?.contentHash !== pointer.contentHash ||
      proof.caseVersion !== pointer.caseVersion || !proof.addressedTo.some((r: any) => r.role === 'buyer' && r.uid === order.buyerId)) return common;
  return {...common, qualification: 'native_historical_issue' as const, issue: {eventId: proof.eventId as string, contentHash: raw!.contentHash as string,
    caseVersion: proof.caseVersion as number, result: proof.command.result as string, motivation: proof.command.privateNote as string,
    sourceHash: proof.sourceHash as string, recordedAt: iso(proof.recordedAt),
    parcelAssessment: proof.command.parcelAssessment ?? null, scope: 'order_product_case' as const,
    claimOriginIncluded: origin?.kind === 'product_contribution' ? proof.command.contributionReferences.some((r: any) =>
      r.id === origin.contributionId && r.contentHash === origin.contributionHash) : null, physicalFindingVerified: false}};
}
/** Use the money engine's existing exact receipt and ledger readers. No IO or NEW authority. */
async function decisions(tx: FirebaseFirestore.Transaction, id: string, claimId: string, order: any) {
  const page = await tx.get(db.collection('transactions').doc(id).collection('dispute_decisions')
    .where('expectedDisputeId', '==', claimId).orderBy('__name__').limit(DECISION_LIMIT + 1));
  const entries = [];
  for (const row of page.docs.slice(0, DECISION_LIMIT)) {
    const d = row.data(), unknown = {decisionId: row.id, qualification: 'unknown', kind: null, outcome: null, recordedAt: null,
      motivation: null, productReference: null, financialEffect: null};
    if (d.transactionId !== id || d.expectedDisputeId !== claimId || d.buyerId !== order.buyerId || d.sellerId !== order.sellerId || !native(d.committedAt) ||
        !docId(d.actorUid) || typeof d.requestId !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(d.requestId) ||
        typeof d.note !== 'string' || !d.note.trim() || d.note.trim() !== d.note || d.note.length > 500) {
      entries.push(unknown); continue;
    }
    try {
      if (d.kind === 'admin_financial_decision_v1') {
        const input: RefundDecisionInput = parseRefundDecisionInput(d.actorUid, {transactionId: id, expectedDisputeId: claimId,
          expectedAdminUid: d.actorUid, requestId: d.requestId, previewId: d.previewId, expectedSourceHash: d.sourceHash,
          expectedTotalCents: d.totalCents, expectedCardCents: d.cardCents, expectedWalletCents: d.walletCents,
          expectedSellerDebitCents: d.sellerDebitCents, decisionType: d.decisionType, note: d.note,
          ...(d.returnToSender ? {returnToSender: d.returnToSender} : {}), ...(d.transportReview ? {transportReview: d.transportReview} : {}),
          ...(d.productReview ? {productReview: d.productReview} : {}), ...(d.allocation ? {allocation: d.allocation, allocationCapability: 'purchase_refund_v1'} : {}),
          ...(d.resume ? {resume: d.resume} : {})});
        if (refundDecisionId(input) !== row.id) {entries.push(unknown); continue;}
        const observed = await readAdminRefundDecision(tx, input, order);
        const settled = 'financial' in observed && observed.financial.success === true;
        entries.push({decisionId: row.id, qualification: 'native_historical_decision', kind: 'refund', outcome: observed.outcome,
          recordedAt: iso(d.committedAt), motivation: input.note, productReference: input.productReview ?? null,
          financialEffect: {qualification: settled ? 'native_refund_effect' : 'unknown', currency: 'CAD',
            totalCents: settled ? input.expectedTotalCents : null, cardCents: settled ? input.expectedCardCents : null,
            walletCents: settled ? input.expectedWalletCents : null, sellerDebitCents: settled ? input.expectedSellerDebitCents : null,
            refundIntentId: 'refundIntentId' in observed ? observed.refundIntentId : null, bankArrivalVerified: false}});
      } else {
        const input: DisputeResolutionInput = {transactionId: id, expectedDisputeId: claimId, adminUid: d.actorUid,
          requestId: d.requestId, note: d.note, ...(d.previewId ? {previewId: d.previewId, expectedSourceHash: d.examinedSourceHash ?? d.sourceHash} : {}),
          ...(d.productReview ? {productReview: d.productReview} : {}), ...(d.allocation ? {allocation: d.allocation} : {})};
        const observed = await readDisputeDecision(tx, input, order);
        if (!observed || observed.decisionId !== row.id) {entries.push(unknown); continue;}
        entries.push({decisionId: row.id, qualification: 'native_historical_decision', kind: 'commercial_classification', outcome: observed.outcome,
          recordedAt: iso(d.committedAt), motivation: input.note, productReference: input.productReview ?? null,
          financialEffect: null});
      }
    } catch (e) {if (e instanceof HttpsError) entries.push(unknown); else throw e;}
  }
  return {entries, coverage: {inspected: Math.min(page.size, DECISION_LIMIT), limit: DECISION_LIMIT, hasMore: page.size > DECISION_LIMIT,
    legacyWithoutTargetField: 'unknown', exhaustiveDecisionsVerified: false}};
}
async function line(tx: FirebaseFirestore.Transaction, row: FirebaseFirestore.QueryDocumentSnapshot, buyerId: string, selectedOrigin: string | null) {
  const claim = row.data(), id = safeOrderId(claim.transactionId), orderSnap = id ? await tx.get(db.collection('transactions').doc(id)) : null;
  const order = orderSnap?.data(), associated = !!order && order.deliveryType === 'shipping' && order.buyerId === buyerId &&
    docId(order.sellerId) && order.sellerId !== buyerId && claim.buyerId === buyerId && claim.sellerId === order.sellerId;
  // The buyerId of a sale is not proof that its buyer filed a seller's return
  // claim. Filter that other participant only when its native receipt proves it.
  if (associated && claim.reportOwnerId === order!.sellerId && claim.productReview?.topic === 'parcel_delivery' &&
      claim.productReview.actorRole === 'seller' && await readOrUnknown(() => qualifiedClaim(tx, id!, order!.sellerId, row.id, claim, claim.productReview))) return null;
  const origin = associated && (claim.reason === 'not_received_despite_delivered' || knownOtherReasons.has(claim.reason))
    ? await readOrUnknown(() => reportOrigin(tx, id!, row.id, claim, order)) : null;
  // A known reason alone does not make an otherwise contradictory/legacy row
  // safe to discard. Only a qualified native origin supports this filtering.
  if (origin && knownOtherReasons.has(claim.reason)) return null;
  const source = {claimRevision: supportRevision(row), claimSourceHash: supportSourceHash(claim),
    orderRevision: associated ? supportRevision(orderSnap!) : null, orderSourceHash: associated ? supportSourceHash(order) : null};
  const parcel = associated ? await readOrUnknown(() => readProductParcelSources(tx, id!, order!)) : null, forward = parcel?.legs.find(l => l.leg === 'forward');
  const bank = associated ? order!.bankDispute : null;
  return {disputeId: row.id, transactionId: associated ? id : null, qualification: origin ? origin.qualification : 'unknown', source,
    claimOwnershipQualification: origin ? 'native_buyer_report' : 'unknown',
    reason: claim.reason === 'not_received_despite_delivered' ? 'not_received_despite_delivered' : null,
    recordedAt: iso(claim.createdAt), recordedAtQualification: native(claim.createdAt) ? 'native_timestamp' : 'unknown',
    origin: origin ? {...origin, sameOriginAsSelected: selectedOrigin === null ? null : origin.key === selectedOrigin,
      retriesAreDistinctClaims: false} : null,
    declaration: associated ? await readOrUnknown(() => parcelDeclaration(tx, id!, order, origin)) : null,
    carrierObservation: forward?.observation.qualification === 'native_current_observation' ? {
      qualification: 'native_current_observation', labelId: forward.identity!.labelId, statusCode: forward.observation.statusCode,
      providerEventAtMs: Number.isSafeInteger(forward.observation.providerEventAtMs) && forward.observation.providerEventAtMs >= 0 ? forward.observation.providerEventAtMs : null,
      observationIsPhysicalReceipt: false} : {qualification: 'unknown', labelId: null,
      statusCode: null, providerEventAtMs: null, observationIsPhysicalReceipt: false},
    productReview: associated ? await readOrUnknown(() => productIssue(tx, id!, order, origin)) : null,
    decisions: associated ? await decisions(tx, id!, row.id, order) : {entries: [], coverage: {inspected: 0, limit: DECISION_LIMIT,
      hasMore: false, legacyWithoutTargetField: 'unknown', exhaustiveDecisionsVerified: false}},
    bank: {qualification: 'unknown', nativeMarkerPresent: bank != null || associated && (order!.disputeId != null || order!.disputeOutcome != null),
      commercialDecisionIsBankOutcome: false, bankSettlementVerified: false}, ...noAuthority};
}
export async function readParcelClaimHistory(request: any) {
  const uid = supportUid(request), raw = supportObject(request.data, ['expectedUid', 'capability', 'mode', 'transactionId', 'disputeId', 'cursor', 'expectedSource']);
  if (raw.capability !== PARCEL_CLAIM_HISTORY_CAPABILITY || raw.mode !== 'parcel_claim_history_observe')
    throw new HttpsError('invalid-argument', 'Version du lecteur privé requise.');
  const id = supportId(raw.transactionId), disputeId = supportId(raw.disputeId);
  const cursor = raw.cursor == null ? null : supportObject(raw.cursor, ['lastId']).lastId;
  if (cursor !== null && !docId(cursor)) throw new HttpsError('invalid-argument', 'Curseur natif invalide.');
  const expected = raw.expectedSource === undefined ? null : sourceInput(raw.expectedSource);
  if (cursor && !expected) throw new HttpsError('invalid-argument', 'Conservez le contexte sélectionné pour la page suivante.');
  return db.runTransaction(async tx => {
    await supportCurrentAdminSession(request); await supportAdmin(tx, uid, false);
    assertRecentAccountAuthentication(request.auth.token);
    await assertAccountSecurityOpen((await tx.get(db.collection('eligibility_profiles').doc(uid))).data(), tx, uid);
    if (!PARCEL_CLAIM_HISTORY_ENABLED) throw new HttpsError('failed-precondition', 'Le lecteur comparatif est en préparation.', {reason: 'parcel_claim_history_not_exposed'});
    const orderSnap = await tx.get(db.collection('transactions').doc(id)), claimSnap = await tx.get(db.collection('disputes').doc(disputeId));
    const order = orderSnap.data(), claim = claimSnap.data();
    if (!order || !claim || order.deliveryType !== 'shipping' || !docId(order.buyerId) || !docId(order.sellerId) || order.buyerId === order.sellerId ||
        claim.transactionId !== id || claim.buyerId !== order.buyerId || claim.sellerId !== order.sellerId || claim.reason !== 'not_received_despite_delivered')
      throw new HttpsError('permission-denied', 'Contexte opérateur non qualifié.');
    // Apply the same native ownership distinction to the selected context as
    // to history rows, before opening any query about this sale's buyer.
    if (claim.reportOwnerId === order.sellerId && claim.productReview?.topic === 'parcel_delivery' &&
        claim.productReview.actorRole === 'seller' && await readOrUnknown(() => qualifiedClaim(tx, id, order.sellerId, disputeId, claim, claim.productReview)))
      throw new HttpsError('permission-denied', 'Contexte opérateur non qualifié.');
    const capture = {protocol: 'parcel_claim_history_source_v1', transactionId: id, disputeId,
      orderRevision: supportRevision(orderSnap), orderSourceHash: supportSourceHash(order),
      claimRevision: supportRevision(claimSnap), claimSourceHash: supportSourceHash(claim)};
    const source = {transactionId: id, disputeId, sourceHash: supportSourceHash(capture)};
    if (expected && supportHash(source) !== supportHash(expected)) throw new HttpsError('failed-precondition', 'Le contexte sélectionné a changé.', {reason: 'parcel_claim_history_source_changed'});
    let query: FirebaseFirestore.Query = db.collection('disputes').where('buyerId', '==', order.buyerId).orderBy('__name__').limit(LIMIT + 1);
    if (cursor) query = query.startAfter(cursor);
    const page = await tx.get(query), inspected = page.docs.slice(0, LIMIT), entries = [];
    const selected = await readOrUnknown(() => reportOrigin(tx, id, disputeId, claim, order));
    for (const row of inspected) {
      const entry = await line(tx, row, order.buyerId, selected?.key ?? null);
      if (entry) entries.push(entry);
    }
    return {protocol: 'parcel_claim_history_page_v1', actorId: uid, source: {...source, ...capture, qualification: 'native_selected_order_claim'},
      selectedOrigin: selected ? {key: selected.key, qualification: selected.qualification} : null, entries,
      nextCursor: page.size > LIMIT ? {lastId: inspected.at(-1)!.id} : null, readAt: Timestamp.now().toDate().toISOString(),
      coverage: {inspected: inspected.length, limit: LIMIT, hasMore: page.size > LIMIT, association: 'native_buyer_field_only',
        historicalWithoutBuyerField: 'unknown', reasonFilter: 'nonreceipt_or_unqualified', unknownRowsIncluded: true, exhaustiveHistoryVerified: false, totalClaims: null},
      repetitionIsFraudEvidence: false, ...noAuthority};
  });
}
export type ParcelClaimHistoryPage = Awaited<ReturnType<typeof readParcelClaimHistory>>;
