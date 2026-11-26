/** E18: an accepted deadline after label creation opens an inquiry, never a
 * finding that no parcel was deposited, a cancellation, loss or money authority. */
import {FieldPath, Timestamp} from 'firebase-admin/firestore';
import {HttpsError} from 'firebase-functions/v2/https';
import {db} from '../config/firebase';
import {trackingIdentity, trackingProofMatches} from '../config/shipEngine';
import {acceptedOrderPurchasePolicy, acceptedQuotePurchasePolicy, nativePurchasePaymentSource, purchasePolicyTimeline} from './purchasePolicy';
import {exactMixedDebit} from './stripeCheckoutProof';
import {supportHash, supportSourceHash} from './supportRequest';
import {readProductReviewContributionProof} from './productReviewContributions';

export const LABEL_DEPOSIT_REVIEW_ENABLED: boolean = true;
export const LABEL_DEPOSIT_REVIEW_CAPABILITY = 'label_deposit_deadline_v1';
export function labelDepositReviewOptIn(value: unknown) {
  if (value === undefined) return false;
  if (value !== LABEL_DEPOSIT_REVIEW_CAPABILITY) throw new HttpsError('invalid-argument', 'Version de revue du délai après étiquette inconnue.');
  return true;
}
export function assertLabelDepositReviewOpen() {
  if (!LABEL_DEPOSIT_REVIEW_ENABLED) throw new HttpsError('failed-precondition', 'La revue du délai après étiquette est en préparation.',
    {reason: 'label_deposit_deadline_not_exposed'});
}
const at = (v: unknown) => v instanceof Timestamp && Number.isSafeInteger(v.toMillis()) && v.toMillis() >= 0 ? v.toMillis() : null;
const iso = (v: number | null) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? new Date(v).toISOString() : null;
const NO_EFFECTS = {physicalDepositVerified: false, absenceOfDepositVerified: false, terminalLossVerified: false,
  financialEffectAuthorized: false, inventoryReleaseAuthorized: false, labelVoidAuthorized: false} as const;

/** Re-read immutable acceptance, actual attributed payment and current label
 * in the caller's TX. No GET, profile, global wallet balance or invented clock. */
export async function readLabelDepositDeadline(tx: FirebaseFirestore.Transaction, transactionId: string,
  order: FirebaseFirestore.DocumentData, now = Timestamp.now()) {
  const policy = acceptedOrderPurchasePolicy(order, transactionId), clock = purchasePolicyTimeline(order, transactionId);
  const payment = nativePurchasePaymentSource(order, transactionId), nowMs = now.toMillis();
  let accepted = false, paymentQualified = false;
  if (policy && payment && clock.nonShipmentStartsAtMs !== null && clock.nonShipmentExpiresAtMs !== null &&
      clock.nonShipmentStartsAtMs <= nowMs) {
    const quote = (await tx.get(db.collection('shipping_quotes').doc(policy.quoteId))).data();
    accepted = !!quote && quote.transactionId === transactionId && quote.state === 'claimed' && quote.ownerId === order.buyerId &&
      quote.sellerId === order.sellerId && quote.articleId === order.articleId && quote.acceptedRateId === order.shipEngineRateId &&
      quote.acceptedTotal === order.totalAmount && acceptedQuotePurchasePolicy(order, transactionId, quote);
    if (accepted && payment.kind === 'wallet_ledger') {
      const debit = (await tx.get(db.collection('wallets').doc(order.buyerId).collection('ledger').doc(payment.referenceId))).data();
      paymentQualified = debit?.type === 'purchase_debit' && debit.transactionId === transactionId && debit.amount === payment.amountCents &&
        debit.currency === 'CAD' && debit.createdAt instanceof Timestamp && debit.createdAt.isEqual(order.paidAt);
    } else if (accepted && payment.walletCents > 0) {
      const ledger = await tx.get(db.collection('wallets').doc(order.buyerId).collection('ledger').where('transactionId', '==', transactionId).limit(101));
      paymentQualified = ledger.size < 101 && exactMixedDebit(order, ledger.docs.map(d => ({id: d.id, data: d.data()})), payment.walletCents);
    } else paymentQualified = accepted && payment.kind === 'stripe_payment_intent';
  }
  const windowQualified = accepted && paymentQualified;
  const candidate = trackingIdentity(transactionId, order, 'forward');
  const {labelLifecycleIdentityQualified} = await import('./labelLifecycle');
  const identity = candidate && await labelLifecycleIdentityQualified(tx, transactionId, order, 'forward') ? candidate : null;
  const observation = order.trackingObservation;
  const qualifiedObservation = identity && at(observation?.recordedAt) !== null && at(observation.recordedAt)! <= nowMs && trackingProofMatches(transactionId, order, observation, 'forward') ? observation : null;
  // Identity/read authorization alone does not qualify the occurrence clock.
  // The native provider event must follow this label's provider creation and
  // precede the exact GET observation; missing/future/malformed time is unknown.
  const eventQualified = qualifiedObservation && Number.isSafeInteger(qualifiedObservation.providerEventAtMs) &&
    Number.isSafeInteger(qualifiedObservation.providerLabelCreatedAtMs) && qualifiedObservation.providerLabelCreatedAtMs >= 0 &&
    qualifiedObservation.providerEventAtMs >= qualifiedObservation.providerLabelCreatedAtMs &&
    qualifiedObservation.providerEventAtMs <= qualifiedObservation.observedAtMs &&
    qualifiedObservation.providerEventAtMs <= nowMs &&
    ['actual_delivery_date', 'normalized_event'].includes(qualifiedObservation.providerEventTimeSource) &&
    qualifiedObservation.providerRevision === null;
  const carrierScan = eventQualified && ['AC', 'IT', 'DE', 'EX', 'AT', 'SP'].includes(qualifiedObservation.statusCode);
  const scanState = carrierScan ? 'carrier_scan_recorded' : qualifiedObservation?.statusCode === 'NY' ? 'no_acceptance_scan_recorded' : 'unknown';
  // Native contribution proof, not a regex over a statement. `deposit` is a
  // recipient-location observation; only explicit sender -> carrier handover
  // by the seller can be a DECLARATION of this parcel's initial deposit.
  const context = {kind: 'order' as const, id: transactionId};
  const caseId = 'pr_' + supportHash([context.kind, context.id]);
  const contributions = await tx.get(db.collection('product_review_cases').doc(caseId).collection('contributions').orderBy(FieldPath.documentId()).limit(21));
  let complete = contributions.size <= 20;
  const members: unknown[] = [];
  let declared = false;
  for (const row of contributions.docs.slice(0, 20)) {
    const value = row.data();
    members.push([row.id, value.contentHash ?? null, row.updateTime]);
    if (value.document?.command?.parcelStatement == null) continue;
    const proof = await readProductReviewContributionProof(tx, context, row.id, value);
    if (!proof) {complete = false; continue;}
    const p = proof.command.parcelStatement;
    if (p.leg !== 'forward' || p.labelId !== identity?.labelId) continue;
    if (proof.actorId === order.sellerId && proof.actorRole === 'seller' &&
        p.handover.some((h: any) => h.from === 'sender' && h.to === 'carrier')) declared = true;
  }
  const deadlineSourceHash = windowQualified ? supportSourceHash([policy, order.purchasePolicyAcceptance, order.nonShipmentPolicyWindow]) : null;
  const labelSourceHash = identity?.sourceHash ?? null;
  const source = {protocol: 'label_deposit_deadline_source_v1' as const, transactionId,
    deadlineQualification: windowQualified ? 'native_accepted_window' : 'unknown',
    policyVersion: windowQualified ? policy!.policyVersion : null, policyHash: windowQualified ? policy!.hash : null,
    startsAt: windowQualified ? iso(clock.nonShipmentStartsAtMs) : null, expiresAt: windowQualified ? iso(clock.nonShipmentExpiresAtMs) : null,
    deadlineReached: windowQualified && clock.nonShipmentExpiresAtMs! <= nowMs,
    deadlineSourceHash, labelQualification: identity ? 'native_current_label' : 'unknown', labelId: identity?.labelId ?? null, labelSourceHash,
    carrierScanQualification: scanState, observedStatusCode: qualifiedObservation?.statusCode ?? null,
    providerObservedAt: qualifiedObservation ? iso(qualifiedObservation.observedAtMs) : null,
    providerEventAt: eventQualified ? iso(qualifiedObservation.providerEventAtMs) : null,
    depositDeclaration: declared ? 'sender_handover_declared' : complete ? 'not_recorded' : 'unknown',
    declarationManifestComplete: complete, declarationManifestHash: supportSourceHash([caseId, members, complete]),
    currentOrderStatus: typeof order.status === 'string' ? order.status : null,
    resolutionPaths: [
      {kind: 'participant_parcel_investigation', context, contributionEndpoint: 'submitReport', capability: 'product_review_v1',
        parcelCapability: 'product_review_parcel_v1', recourseEndpoint: 'reportTransactionProblem', recourseCapability: 'product_parcel_report_v1',
        explicitParticipantStatementRequired: true, automaticComplaintCreated: false, permissionGranted: false},
      {kind: 'native_bilateral_refund_agreement', transactionId, endpoint: 'adminRefundTransaction', capability: 'purchase_refund_v1',
        sourceMode: 'purchase_refund_source_observe', bothNativeAcceptancesRequired: true, separateOperatorDecisionRequired: true, permissionGranted: false},
      {kind: 'label_lifecycle_review', context: {transactionId, leg: 'forward'}, endpoint: 'checkTrackingStatus', capability: 'label_lifecycle_v1',
        sourceMode: 'label_lifecycle_source_observe', buyerRefundAuthorized: false, permissionGranted: false},
    ], ...NO_EFFECTS};
  // This hash describes business evidence; the time of this read is not a new
  // source/incident identity. The enclosing transport source also binds order,
  // case versions, ledger and all commercial claims before human instruction.
  return {...source, sourceHash: supportSourceHash(source)};
}
export function labelDepositReviewIdentity(source: Awaited<ReturnType<typeof readLabelDepositDeadline>>) {
  return source.deadlineQualification === 'native_accepted_window' && source.labelQualification === 'native_current_label'
    ? 'case_' + supportHash(['label_deposit_deadline', source.transactionId, source.deadlineSourceHash, source.labelSourceHash]) : null;
}
export function labelDepositDeadlineCloseQualified(source: Awaited<ReturnType<typeof readLabelDepositDeadline>>) {
  return source.deadlineQualification === 'native_accepted_window' && source.labelQualification === 'native_current_label' &&
    source.declarationManifestComplete && source.currentOrderStatus !== null;
}
/** Exact immutable origin remains readable after scans/statuses change. Only
 * a current source may qualify an instruction; this shape is historical. */
export function labelDepositOriginQualified(origin: any, transactionId: string) {
  const s = origin?.deadline;
  if (!s || typeof s !== 'object' || Array.isArray(s)) return false;
  const {sourceHash, ...body} = s;
  let bodyHash: string;
  try {bodyHash = supportSourceHash(body);} catch (error) {if (error instanceof HttpsError && error.code === 'failed-precondition') return false; throw error;}
  return bodyHash === sourceHash && origin?.kind === 'system' && origin.source === 'accepted_contract_deadline' && origin.reportedBy === null &&
    s?.protocol === 'label_deposit_deadline_source_v1' && s.transactionId === transactionId &&
    s.deadlineQualification === 'native_accepted_window' && s.labelQualification === 'native_current_label' &&
    s.deadlineReached === true && /^[a-f0-9]{64}$/.test(s.sourceHash ?? '') &&
    /^[a-f0-9]{64}$/.test(s.deadlineSourceHash ?? '') && /^[a-f0-9]{64}$/.test(s.labelSourceHash ?? '') &&
    typeof s.startsAt === 'string' && Number.isFinite(Date.parse(s.startsAt)) && typeof s.expiresAt === 'string' && Number.isFinite(Date.parse(s.expiresAt)) &&
    Date.parse(s.expiresAt) > Date.parse(s.startsAt) &&
    s.physicalDepositVerified === false && s.absenceOfDepositVerified === false && s.terminalLossVerified === false &&
    s.financialEffectAuthorized === false && s.inventoryReleaseAuthorized === false && s.labelVoidAuthorized === false;
}
