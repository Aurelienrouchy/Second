/** Documentary authenticity provenance for an explicit, separate money decision. */
import {Timestamp} from 'firebase-admin/firestore';
import {HttpsError} from 'firebase-functions/v2/https';
import {db} from '../config/firebase';
import {productReviewCaseId, productReviewCaseRef, type ProductReviewContext} from './productReviewSource';
import {readProductReviewDocumentarySet} from './productReviewWorkflow';
import {supportObject, supportHash, supportSourceHash} from './supportRequest';
import {committedReturnReceipt} from './returnRequest';
import {trackingProofMatches, trackingObservationDisposition} from '../config/shipEngine';
import {parseLateCommercialReference, readLateCommercialFinancialBasis, type LateCommercialReference} from './lateCommercialRecourse';

const HASH = /^[a-f0-9]{64}$/;
export type ProductFinancialReference = {caseId: string; topic: 'authenticity' | 'nonconformity' | 'parcel_delivery'; caseVersion: number; caseSourceHash: string;
  issueId: string; issueHash: string; corpusHash: string; membersHash: string; authorizationSourceHash: string; materialCapability?: 'product_review_material_v1'; parcelCapability?: 'product_review_parcel_v1'; lateCommercial?: LateCommercialReference};
export const productFinancialReviewError = () => new HttpsError('failed-precondition', 'Le dossier de l’article et son issue doivent être examinés sur leur version actuelle avant une nouvelle décision financière.',
  {reason: 'product_financial_review_required', newRefundPermissionGranted: false, authenticityVerified: false, expertiseVerified: false});
export function parseProductFinancialReference(value: unknown): ProductFinancialReference {
  const r = supportObject(value, ['caseId', 'topic', 'caseVersion', 'caseSourceHash', 'issueId', 'issueHash', 'corpusHash', 'membersHash', 'authorizationSourceHash', 'materialCapability', 'parcelCapability', 'lateCommercial']);
  if (typeof r.caseId !== 'string' || !/^pr_[a-f0-9]{64}$/.test(r.caseId) || !['authenticity', 'nonconformity', 'parcel_delivery'].includes(r.topic) ||
      !Number.isSafeInteger(r.caseVersion) || r.caseVersion < 1 || typeof r.issueId !== 'string' || !/^pe_[a-f0-9]{64}$/.test(r.issueId) ||
      !['caseSourceHash', 'issueHash', 'corpusHash', 'membersHash', 'authorizationSourceHash'].every(k => HASH.test(r[k] ?? '')) ||
      r.materialCapability !== undefined && r.materialCapability !== 'product_review_material_v1' || r.topic === 'nonconformity' && r.materialCapability === undefined || r.parcelCapability !== undefined && r.parcelCapability !== 'product_review_parcel_v1' || r.topic === 'parcel_delivery' && r.parcelCapability === undefined)
    throw new HttpsError('invalid-argument', 'Référence native du dossier et de son issue requise.');
  return {caseId: r.caseId, topic: r.topic as ProductFinancialReference['topic'], caseVersion: r.caseVersion, caseSourceHash: r.caseSourceHash,
    issueId: r.issueId, issueHash: r.issueHash, corpusHash: r.corpusHash, membersHash: r.membersHash, authorizationSourceHash: r.authorizationSourceHash,
    ...(r.materialCapability ? {materialCapability: 'product_review_material_v1' as const} : {}), ...(r.parcelCapability ? {parcelCapability: 'product_review_parcel_v1' as const} : {}),
    ...(r.lateCommercial !== undefined ? {lateCommercial:parseLateCommercialReference(r.lateCommercial)} : {})};
}
export async function productFinancialContextRequired(tx: FirebaseFirestore.Transaction, transactionId: string, order: FirebaseFirestore.DocumentData) {
  if (order.cashAgreement != null || order.swapId != null || order.paidVia === 'cash') return false;
  const context: ProductReviewContext = {kind: 'order', id: transactionId}, ref = productReviewCaseRef(context), root = (await tx.get(ref)).data();
  if (!root) return false;
  if (root.protocol !== 'product_review_case_v1' || root.caseId !== productReviewCaseId(context) || supportHash(root.context) !== supportHash(context)) return true;
  return !(await tx.get(ref.collection('contributions').where('document.topic', 'in', ['authenticity', 'nonconformity', 'parcel_delivery']).limit(1))).empty;
}
type Manifest = Awaited<ReturnType<typeof readProductReviewDocumentarySet>>['manifest'];
const members = (d: Manifest) => ({protocol: 'product_financial_members_v1', caseId: d.caseId, context: d.context,
  contributions: d.contributions, communications: d.communications, evidence: d.evidence, intents: d.intents,
  documentaryComplete: d.documentaryComplete, lookahead: d.lookahead, ...('parcelReview' in d ? {parcelReview: d.parcelReview} : {})});
/** Pure Firestore read. No original bytes, expert certification or provider IO. */
export async function readProductFinancialSource(tx: FirebaseFirestore.Transaction, transactionId: string, order: FirebaseFirestore.DocumentData, caseId: string, expectedDisputeId: string, topic: ProductFinancialReference['topic'] = 'authenticity', material = false, parcel = false, lateCommercial?: LateCommercialReference) {
  const context: ProductReviewContext = {kind: 'order', id: transactionId}, expectedCaseId = productReviewCaseId(context);
  if (caseId !== expectedCaseId || topic === 'nonconformity' && !material || topic === 'parcel_delivery' && !parcel || order.cashAgreement != null || order.swapId != null || order.paidVia === 'cash') throw productFinancialReviewError();
  const claims = await tx.get(db.collection('disputes').where('transactionId', '==', transactionId).orderBy('__name__').limit(101));
  const target = claims.docs.find(d => d.id === expectedDisputeId);
  if (claims.size > 100 || !target || claims.docs.some(d => d.data().transactionId !== transactionId || d.data().buyerId !== order.buyerId ||
      d.data().sellerId !== order.sellerId || !(d.data().createdAt instanceof Timestamp) || d.data().createdAt.toMillis() < 0 ||
      d.data().createdAt.toMillis() > Date.now()) || target.data().source === 'system_transport_review') throw productFinancialReviewError();
  const set = await readProductReviewDocumentarySet(tx, context, material, parcel), root = set.root;
  if ((target.data().source === 'late_commercial_support' || target.data().lateCommercial?.claimReexamination !== undefined) !== !!lateCommercial || lateCommercial && topic === 'parcel_delivery') throw productFinancialReviewError();
  const lateBasis = lateCommercial ? await readLateCommercialFinancialBasis(tx, transactionId, order, target.data(), lateCommercial, set, expectedDisputeId) : null;
  if (!root || root.protocol !== 'product_review_case_v1' || root.caseId !== expectedCaseId ||
      set.source.document.nativeActors.buyerId !== order.buyerId || set.source.document.nativeActors.sellerId !== order.sellerId ||
      !(topic === 'parcel_delivery' ? set.parcelReview?.integrityQualified === true : set.documentaryComplete) || root.version !== root.latestOutcome?.caseVersion) throw productFinancialReviewError();
  const row = set.communicationRows.find(r => r.id === root.latestOutcome.eventId), issue = row?.proof;
  const authenticity = set.contributionRows.filter(r => r.proof?.topic === topic);
  if (!issue || issue.kind !== 'issue_outcome' || issue.actorRole !== 'operator' || !(topic === 'parcel_delivery' ? ['review_documented', 'information_incomplete'].includes(issue.command.result) && issue.command.parcelAssessment : issue.command.result === 'review_documented') || issue.caseVersion !== root.version ||
      row!.contentHash !== root.latestOutcome.contentHash || !authenticity.length || !issue.command.documentaryCorpus ||
      authenticity.some(r => !issue.command.contributionReferences.some((c: any) => c.id === r.id && c.contentHash === r.contentHash))) throw productFinancialReviewError();
  if (topic === 'nonconformity') {
    const claim = target.data(), link = claim.productReview;
    const selected = authenticity.find(r => r.id === link?.contributionId);
    const report = claim.reportOwnerId === order.buyerId && typeof claim.reportRequestId === 'string'
      ? (await tx.get(db.collection('transactions').doc(transactionId).collection('problem_requests').doc(supportHash([order.buyerId, claim.reportRequestId])))).data() : null;
    if (link?.topic !== topic || link.caseId !== caseId || !selected?.proof?.command.materialStatement || selected.proof.actorId !== order.buyerId ||
        selected.contentHash !== link.contributionHash || !lateBasis && (report?.protocol !== 'transaction_problem_report_v1' || report.state !== 'committed' ||
        report.disputeId !== expectedDisputeId || report.ownerId !== order.buyerId || report.payloadHash !== claim.reportPayloadHash ||
        supportHash(report.productReview) !== supportHash(link))) throw productFinancialReviewError();
  }
  const parcelSources = 'parcelSources' in set.source.document ? set.source.document.parcelSources : null;
  if (topic === 'parcel_delivery') {
    const claim = target.data(), link = claim.productReview, selected = authenticity.find(r => r.id === link?.contributionId), statement = selected?.proof?.command.parcelStatement;
    const ownerId = claim.reportOwnerId, role = ownerId === order.buyerId ? 'buyer' : ownerId === order.sellerId ? 'seller' : null;
    const report = role && typeof claim.reportRequestId === 'string' ? (await tx.get(db.collection('transactions').doc(transactionId)
      .collection('problem_requests').doc(supportHash([ownerId, claim.reportRequestId])))).data() : null;
    const assessment = issue.command.parcelAssessment;
    if (link?.topic !== topic || link.caseId !== caseId || link.parcelCapability !== 'product_review_parcel_v1' || !statement || !role ||
        selected!.proof.actorId !== ownerId || selected!.proof.actorRole !== role || link.actorRole !== role || link.leg !== statement.leg ||
        selected!.contentHash !== link.contributionHash || report?.protocol !== 'transaction_parcel_report_v1' || report.state !== 'committed' ||
        report.disputeId !== expectedDisputeId || report.ownerId !== ownerId || report.payloadHash !== claim.reportPayloadHash ||
        supportHash(report.productReview) !== supportHash(link) || !assessment || assessment.leg !== statement.leg || assessment.labelId !== statement.labelId ||
        !parcelSources?.legs.some(l => l.leg === assessment.leg && l.qualification === 'native_current_label' && l.identity?.labelId === assessment.labelId)) throw productFinancialReviewError();
  }
  const capture = (await tx.get(productReviewCaseRef(context).collection('documentary_captures').doc(issue.command.documentaryCorpus.hash))).data(), previous = capture?.document;
  if (capture?.protocol !== 'product_review_documentary_capture_v1' || !(capture.capturedAt instanceof Timestamp) ||
      capture.capturedAt.toMillis() > Date.now() || !previous || previous.protocol !== 'product_review_documentary_corpus_v1' ||
      previous.caseId !== expectedCaseId || supportHash(previous.context) !== supportHash(context) ||
      supportSourceHash(previous) !== issue.command.documentaryCorpus.hash || previous.sourceHash !== issue.sourceHash ||
      !Array.isArray(previous.communications) || previous.communications.some((c: any) => c.id === issue.eventId)) throw productFinancialReviewError();
  // The issue's own append is the only allowed difference from its immutable
  // preview. An unsent/unknown file intent or any later contribution/contest
  // changes members even when no case-version writer ran.
  const own = set.manifest.communications.find(r => r.id === issue.eventId);
  if (!own) throw productFinancialReviewError();
  const afterIssue = {...previous, communications: [...previous.communications, own].sort((a, b) => Buffer.compare(Buffer.from(a.id), Buffer.from(b.id)))};
  const memberDocument = members(set.manifest), membersHash = supportSourceHash(memberDocument);
  if (supportSourceHash(members(afterIssue)) !== membersHash) throw productFinancialReviewError();
  const authorizationDocument = {protocol: 'product_financial_authorization_source_v1', transactionId, caseId: expectedCaseId,
    buyerId: order.buyerId, sellerId: order.sellerId, articleId: order.articleId ?? null, articleSnapshotHash: supportSourceHash(order.articleSnapshot ?? null),
    financialFactsHash: supportSourceHash(Object.fromEntries(['paidVia', 'totalAmount', 'currency', 'walletAmountUsed', 'capturedCardCents',
      'stripePaymentIntentId', 'sellerCreditedCents', 'paidAt', 'bankDispute', 'disputeId', 'disputeOutcome', 'disputeFreezeCents', 'fundsReleasedAt',
      'returnToSenderGuard', 'returnRequest', 'returnRequestedAt', 'deliveryCorrection', 'trackingReviewRequired', 'trackingReviewReason',
      'purchasePolicyReviewRequired', 'labelReconciliationRequired', 'refundLegacyReconciliationRequired', 'moderationInstruction', 'productPhysicalReview',
      ...(['nonconformity', 'parcel_delivery'].includes(topic) ? ['productCommercialReturnInstruction', 'returnDeliveredAt', 'returnDeliveryProof'] : []),
      ...(parcel ? ['parcelRecourseGuard', 'sellerParcelReport'] : [])]
      .map(key => [key, order[key] ?? null]))),
    ...(['nonconformity', 'parcel_delivery'].includes(topic) ? {returnObservationSourceHash: supportSourceHash(order.returnTrackingObservation ?
      Object.fromEntries(['sourceHash', 'statusCode', 'providerEventAtMs', 'providerLabelCreatedAtMs', 'observedContentHash', 'providerEventTimeSource', 'providerRevision']
        .map(key => [key, order.returnTrackingObservation[key] ?? null])) : null)} : {}),
    ...(parcel ? {parcelSourceHash: supportSourceHash(parcelSources)} : {}),
    disputeId: expectedDisputeId, disputeSetHash: supportSourceHash(claims.docs.map(d => [d.id, d.data()])),
    articleSource: set.source.document.articleSource, caseSourceHash: supportSourceHash(root), caseVersion: root.version,
    issueId: issue.eventId, issueHash: row!.contentHash, membersHash,
    ...(lateBasis ? {lateCommercial:lateBasis} : {})};
  const reference: ProductFinancialReference = {caseId: expectedCaseId, topic, caseVersion: root.version,
    caseSourceHash: authorizationDocument.caseSourceHash, issueId: issue.eventId, issueHash: row!.contentHash!,
    corpusHash: set.corpusHash, membersHash, authorizationSourceHash: supportSourceHash(authorizationDocument),
    ...(material ? {materialCapability: 'product_review_material_v1' as const} : {}), ...(parcel ? {parcelCapability: 'product_review_parcel_v1' as const} : {}),
    ...(lateBasis ? {lateCommercial:lateBasis.reference} : {})};
  const returnObservation = order.returnTrackingObservation;
  const returned = topic === 'nonconformity' && committedReturnReceipt(transactionId, order) && order.returnDeliveredAt instanceof Timestamp &&
    order.returnDeliveredAt.toMillis() >= 0 && order.returnDeliveredAt.toMillis() <= Date.now() && returnObservation?.statusCode === 'DE' &&
    trackingProofMatches(transactionId, order, returnObservation, 'return') && Number.isSafeInteger(returnObservation.providerEventAtMs) &&
    ['accept', 'replay'].includes(trackingObservationDisposition(order, returnObservation, 'return')) &&
    authenticity.some(r => r.proof?.actorId === order.sellerId && r.proof.actorRole === 'seller' &&
      r.proof.command.materialStatement?.receivedScope === 'return_received' && r.proof.command.materialStatement.chronology.receivedAt !== null);
  const parcelReturned = topic === 'parcel_delivery' && issue.command.parcelAssessment?.leg === 'return' && committedReturnReceipt(transactionId, order) &&
    order.returnDeliveredAt instanceof Timestamp && order.returnDeliveredAt.toMillis() >= 0 && order.returnDeliveredAt.toMillis() <= Date.now() && returnObservation?.statusCode === 'DE' &&
    trackingProofMatches(transactionId, order, returnObservation, 'return') && Number.isSafeInteger(returnObservation.providerEventAtMs) &&
    ['accept', 'replay'].includes(trackingObservationDisposition(order, returnObservation, 'return')) && authenticity.some(r =>
      r.proof?.actorId === order.sellerId && r.proof.actorRole === 'seller' && r.proof.command.parcelStatement?.leg === 'return' &&
      r.proof.command.parcelStatement.receipt === 'received' && r.proof.command.parcelStatement.chronology.receivedAt !== null);
  return {protocol: 'product_financial_source_v1', reference,
    ...(lateBasis ? {lateCommercial:lateBasis} : {}),
    ...(topic === 'nonconformity' ? {materialReturnReview: {qualification: returned ? 'native_parcel_with_actor_return_declaration' : order.returnRequest == null ? 'not_applicable' : 'unknown',
      qualifiesOwnReturnForFinancialReview: returned, physicalContentsVerified: false, faultEstablished: false}} : {}),
    ...(topic === 'parcel_delivery' ? {parcelReview: {integrityQualified: set.parcelReview?.integrityQualified === true, documentaryComplete: set.documentaryComplete,
      assessment: issue.command.parcelAssessment, qualification: 'native_operator_assessment_of_available_sources', responsibilityEstablished: false,
      insurancePaymentPromised: false, costDecisionGranted: false}, parcelReturnReview: {qualifiesOwnReturnForFinancialReview: parcelReturned,
      qualification: parcelReturned ? 'native_parcel_with_actor_return_declaration' : 'unknown', physicalContentsVerified: false, faultEstablished: false}} : {}),
    issue: {eventId: issue.eventId, contentHash: row!.contentHash, caseVersion: issue.caseVersion, result: issue.command.result,
      text: issue.command.text, motivation: issue.command.privateNote, sourceHash: issue.sourceHash, recordedAt: issue.recordedAt.toDate().toISOString()},
    contributionReferences: set.contributionRows.map(r => ({id: r.id, contentHash: r.contentHash, actorId: r.proof?.actorId ?? null,
      actorRole: r.proof?.actorRole ?? null, topic: r.proof?.topic ?? null, qualification: r.proof ? 'native_contribution' : 'unknown'})),
    evidenceReferences: set.evidenceRows.map(r => r.reference), coverage: {...set.coverage, ...set.documentaryCoverage},
    capture: {corpus: set.manifest, authorization: authorizationDocument},
    authenticityVerified: false, expertiseVerified: false, newRefundPermissionGranted: false, inventoryPermissionGranted: false};
}
/** Full current preview vs stable post-reserve authorization are separate. */
export function productFinancialReferenceCurrent(current: ProductFinancialReference, expected: ProductFinancialReference, reserved = false) {
  return supportHash(reserved ? {...current, corpusHash: expected.corpusHash} : current) === supportHash(expected);
}
