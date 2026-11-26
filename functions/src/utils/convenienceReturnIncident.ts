/** Native G10 incident decisions. Retiring a return is not a provider void or
 * a refund; adopting a real label price never changes the accepted buyer cap. */
import {Timestamp} from 'firebase-admin/firestore';
import {HttpsError} from 'firebase-functions/v2/https';
import {db, FieldValue} from '../config/firebase';
import {getShipEngine, returnLabelPurchaseContextHash, type ShipEngineLabel} from '../config/shipEngine';
import {supportAdmin, supportCurrentAdminSession, supportHash, supportId, supportObject, supportRequestId,
  supportSourceHash, supportUid, supportText} from './supportRequest';
import {assertPrivateAccountSession, withPrivateAccountSession} from './privateAccountSession';
import {assertRecentAccountAuthentication} from './eligibility';
import {frozenReturnContext, qualifiedReturnRequest, qualifiedReturnQuote, committedReturnReceipt, returnHash} from './returnRequest';
import {readConvenienceReturnFinancing, qualifiedConvenienceReturnCostResolution,
  convenienceReturnActualProofHash, convenienceReturnCostResolutionSummary, publicConvenienceReturnCostResolution} from './convenienceReturnFinancial';
import {hasActiveBankDispute} from './bankDispute';
import {hasUnsettledRefund} from './refundState';
import {prepareOperationalNotices} from './notifications';
import {checkRateLimit} from './rateLimit';

export const CONVENIENCE_RETURN_INCIDENT_CAPABILITY = 'convenience_return_incident_v1';
type Basis = 'native_before_purchase' | 'native_post_validation_rejected' | 'operator_platform_risk_assumption';
type TerminalBasis = Basis | 'owner_intent_not_deposited';
type Command = {action: 'close_unfurnished_return' | 'adopt_label_cost_variance'; sourceHash: string; expectedVersion: number;
  returnRequestId: string; purchaseExternalId: string | null; quoteId: string | null; financingTermsHash: string | null;
  basis: Basis | null; actualProofHash: string | null; platformRiskAccepted: boolean; note: string; acknowledged: true};
const effects = {financialEffectAuthorized: false, refundDecisionGranted: false, shippingPermissionGranted: false};
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const native = (value: unknown): value is Timestamp => value instanceof Timestamp && value.toMillis() > 0 && value.toMillis() <= Date.now();
const own = (value: any, key: string) => value != null && Object.prototype.hasOwnProperty.call(value, key);
const base = (id: string) => db.collection('transactions').doc(id);
const entry = (id: string, key: string) => base(id).collection('convenience_return').doc(key);
const terminalRef = (id: string, requestId: string) => entry(id, 'terminal_request_' + supportHash(requestId));
const purchaseTerminalRef = (id: string, externalId: string) => entry(id, 'terminal_purchase_' + supportHash(externalId));
const receiptRef = (id: string, uid: string, requestId: string) => base(id).collection('convenience_return_commands')
  .doc(supportHash(['incident_v1', uid, requestId]));
function commandInput(raw: unknown): Command {
  const d = supportObject(raw, ['action', 'sourceHash', 'expectedVersion', 'returnRequestId', 'purchaseExternalId', 'quoteId',
    'financingTermsHash', 'basis', 'actualProofHash', 'platformRiskAccepted', 'note', 'acknowledged']);
  if (!['close_unfurnished_return', 'adopt_label_cost_variance'].includes(d.action) || !hash(d.sourceHash) ||
      !Number.isSafeInteger(d.expectedVersion) || d.expectedVersion < 1 || d.acknowledged !== true || typeof d.platformRiskAccepted !== 'boolean' ||
      d.financingTermsHash !== null && !hash(d.financingTermsHash) || d.actualProofHash !== null && !hash(d.actualProofHash) ||
      (d.action === 'close_unfurnished_return' ? !['native_before_purchase', 'native_post_validation_rejected', 'operator_platform_risk_assumption'].includes(d.basis) ||
        (d.basis === 'operator_platform_risk_assumption') !== d.platformRiskAccepted : d.basis !== null || !hash(d.actualProofHash) || d.platformRiskAccepted !== true))
    throw new HttpsError('invalid-argument', 'Source exacte et responsabilité explicite de la plateforme requises.');
  return {action: d.action, sourceHash: d.sourceHash, expectedVersion: d.expectedVersion, returnRequestId: supportRequestId(d.returnRequestId),
    purchaseExternalId: d.purchaseExternalId === null ? null : supportId(d.purchaseExternalId), quoteId: d.quoteId === null ? null : supportId(d.quoteId),
    financingTermsHash: d.financingTermsHash, basis: d.basis, actualProofHash: d.actualProofHash, platformRiskAccepted: d.platformRiskAccepted,
    note: supportText(d.note, 'Motivation opérateur', 2000), acknowledged: true};
}
function receiptView(id: string, uid: string, requestId: string, command: Command, raw: any) {
  if (raw && (raw.protocol !== 'convenience_return_incident_command_v1' || raw.transactionId !== id || raw.ownerId !== uid ||
      raw.requestId !== requestId || raw.payloadHash !== supportHash(command) || supportHash(raw.command) !== supportHash(command) ||
      !native(raw.recordedAt) || !['committed', 'not_executed', 'neutralized'].includes(raw.state)))
    throw new HttpsError('failed-precondition', 'Le reçu de cette instruction doit être rapproché.');
  return {protocol: 'convenience_return_incident_receipt_v1', transactionId: id, ownerId: uid, requestId, command,
    payloadHash: supportHash(command), state: raw?.state ?? 'absent', recordedAt: raw?.recordedAt.toDate().toISOString() ?? null,
    reason: raw?.reason ?? null, result: raw?.result ?? null, ...effects};
}
function terminalSummary(raw: any) {
  const d = raw.document;
  return {kind: 'closed' as const, terminalId: d.terminalId, returnRequestId: d.returnRequestId, basis: d.basis as TerminalBasis,
    providerOutcome: d.providerOutcome as 'not_invoked' | 'validation_rejected' | 'unknown' | 'purchased_unfurnished',
    platformAssumedRisk: d.basis === 'operator_platform_risk_assumption'};
}
export async function readConvenienceReturnTerminal(tx: FirebaseFirestore.Transaction, id: string, requestId: string,
  purchaseExternalId?: string | null) {
  const raw = (await tx.get(terminalRef(id, requestId))).data(), d = raw?.document;
  if (!raw) return null;
  if (raw.protocol === 'convenience_return_predeposit_terminal_v1') {
    const reference = d?.convenienceReturn;
    if (!d || raw.contentHash !== supportSourceHash(d) || d.protocol !== 'convenience_return_predeposit_terminal_document_v1' ||
        d.transactionId !== id || d.returnRequestId !== requestId || !native(d.recordedAt) ||
        d.basis !== 'owner_intent_not_deposited' || d.providerOutcome !== 'not_invoked' || d.purchaseExternalId !== null ||
        typeof d.buyerId !== 'string' || d.actorId !== d.buyerId || typeof d.sellerId !== 'string' || d.buyerId === d.sellerId ||
        reference?.termsProtocol !== 'convenience_return_terms_v2' || !hash(reference.contentHash) ||
        !/^cr_[a-f0-9]{64}$/.test(reference.proposalId ?? '') ||
        d.terminalId !== 'not_deposited_' + supportHash([d.actorId, requestId, reference]) || purchaseExternalId != null)
      throw new HttpsError('failed-precondition', 'Le reçu d’abandon de cette intention doit être rapproché.');
    return {raw, summary: terminalSummary(raw)};
  }
  if (raw.protocol !== 'convenience_return_terminal_v1' || !d || raw.contentHash !== supportSourceHash(d) ||
      d.transactionId !== id || d.returnRequestId !== requestId || !native(d.recordedAt) ||
      !['native_before_purchase', 'native_post_validation_rejected', 'operator_platform_risk_assumption'].includes(d.basis) ||
      d.terminalId !== 'closed_' + supportHash([d.actorId, d.incidentRequestId]) || d.capture?.returnRequest?.requestId !== requestId ||
      purchaseExternalId != null && d.purchaseExternalId !== purchaseExternalId)
    throw new HttpsError('failed-precondition', 'La clôture native de ce retour doit être rapprochée.');
  const receipt = (await tx.get(receiptRef(id, d.actorId, d.incidentRequestId))).data();
  if (receipt?.state !== 'committed' || receipt.command?.action !== 'close_unfurnished_return' ||
      receipt.command.returnRequestId !== requestId || receipt.payloadHash !== supportHash(receipt.command) ||
      !receipt.recordedAt?.isEqual(d.recordedAt) || supportHash(receipt.result) !== supportHash(terminalSummary(raw)))
    throw new HttpsError('failed-precondition', 'Le reçu de clôture doit être rapproché.');
  if (d.purchaseExternalId) {
    const tombstone = (await tx.get(purchaseTerminalRef(id, d.purchaseExternalId))).data();
    if (tombstone?.protocol !== 'convenience_return_purchase_tombstone_v1' || tombstone.terminalId !== d.terminalId ||
        tombstone.returnRequestId !== requestId || tombstone.contentHash !== raw.contentHash)
      throw new HttpsError('failed-precondition', 'Le témoin d’achat clôturé doit être rapproché.');
  }
  return {raw, summary: terminalSummary(raw)};
}
/** Same request tombstone is read by deposit in its transaction. An absence
 * is retired only while native state is strictly absent; no provider GET is evidence. */
export async function prepareConvenienceReturnAbsentIntent(tx: FirebaseFirestore.Transaction, id: string, order: any,
  actorId: string, requestId: string, reference: import('./convenienceReturn').ConvenienceReturnReference) {
  if (actorId !== order.buyerId || reference.termsProtocol !== 'convenience_return_terms_v2')
    throw new HttpsError('permission-denied', 'Seul l’acheteur peut abandonner sa propre intention.');
  const {readConvenienceReturnAgreement} = await import('./convenienceReturn');
  if (!await readConvenienceReturnAgreement(tx, id, order, reference, {requireCurrentSource: false}))
    throw new HttpsError('failed-precondition', 'L’accord historique exact doit être qualifié.');
  const terminal = await readConvenienceReturnTerminal(tx, id, requestId);
  if (terminal) return terminal;
  const other = order.returnRequest?.requestId !== requestId && order.returnRequest?.schemaVersion === 2 &&
    order.returnRequest.reason === 'change_of_mind' && qualifiedReturnRequest(id, order);
  const strictlyAbsent = !own(order, 'returnRequest') && !own(order, 'returnLabelPending') && !own(order, 'returnRequestedAt') &&
    !own(order, 'convenienceReturnFinancialReservation') && order.returnLabelId == null && order.returnTrackingNumber == null &&
    order.returnReconciliationRequired !== true && order.status !== 'return_requested';
  if (!strictlyAbsent && !other)
    throw new HttpsError('failed-precondition', 'Une demande native existe ; son état doit être conservé.');
  const document = {protocol: 'convenience_return_predeposit_terminal_document_v1', transactionId: id,
    actorId, buyerId: order.buyerId, sellerId: order.sellerId, returnRequestId: requestId, purchaseExternalId: null,
    convenienceReturn: reference, terminalId: 'not_deposited_' + supportHash([actorId, requestId, reference]),
    basis: 'owner_intent_not_deposited', providerOutcome: 'not_invoked', recordedAt: Timestamp.now()};
  const raw = {protocol: 'convenience_return_predeposit_terminal_v1', document, contentHash: supportSourceHash(document)};
  tx.create(terminalRef(id, requestId), raw);
  // No active-order field or financial record is created, removed or reopened.
  return {raw, summary: terminalSummary(raw)};
}
export function convenienceReturnTerminalView(id: string, order: any, terminal: NonNullable<Awaited<ReturnType<typeof readConvenienceReturnTerminal>>>) {
  const d = terminal.raw.document;
  return {protocol: 'return_request_v2' as const, transactionId: id, success: false, replay: true, requestId: d.returnRequestId,
    version: d.capture?.returnRequest.version ?? null, requestRecorded: !!d.capture, fundsFrozen: false, labelCommitted: false, status: 'closed',
    actionRequired: false, shippingPermissionGranted: false, quote: null, currentOrderStatus: order.status ?? 'unknown',
    returnTrackingNumber: null, returnLabelUrl: null, returnLabelCost: null, reason: 'convenience_return_closed', terminalCapture: terminal.summary};
}
/** A late callback records identity/cost only, never a PDF or an active order. */
export async function recordConvenienceReturnLateObservation(tx: FirebaseFirestore.Transaction, id: string,
  terminal: NonNullable<Awaited<ReturnType<typeof readConvenienceReturnTerminal>>>, reason: string, label?: ShipEngineLabel) {
  const observed = label ? {labelId: label.labelId, shipmentId: label.shipmentId ?? null, trackingNumber: label.trackingNumber,
    carrierCode: label.carrierCode, qualification: label.qualification ?? null} : null;
  const key = 'late_' + supportHash([terminal.summary.terminalId, reason, observed]), ref = entry(id, key);
  if ((await tx.get(ref)).exists) return;
  tx.create(ref, {protocol: 'convenience_return_terminal_observation_v1', transactionId: id, terminalId: terminal.summary.terminalId,
    returnRequestId: terminal.summary.returnRequestId, reason, observed, recordedAt: Timestamp.now(), pdfDisclosed: false, financialEffect: 'none'});
}
export async function readConvenienceReturnCostResolution(tx: FirebaseFirestore.Transaction, id: string, order: any) {
  const raw = qualifiedConvenienceReturnCostResolution(id, order), d = raw?.document;
  if (!raw || !d) return null;
  const stored = (await tx.get(entry(id, d.resolutionId))).data(), privateDocument = stored?.document;
  if (!stored || !privateDocument || stored.contentHash !== raw.privateContentHash ||
      supportSourceHash(privateDocument) !== stored.contentHash ||
      supportSourceHash(publicConvenienceReturnCostResolution(stored)) !== supportSourceHash(raw)) return null;
  const receipt = (await tx.get(receiptRef(id, privateDocument.actorId, privateDocument.incidentRequestId))).data();
  if (receipt?.protocol !== 'convenience_return_incident_command_v1' || receipt.ownerId !== privateDocument.actorId ||
      receipt.requestId !== privateDocument.incidentRequestId || receipt.transactionId !== id ||
      receipt.state !== 'committed' || receipt.command?.action !== 'adopt_label_cost_variance' ||
      receipt.command.actualProofHash !== d.actualProofHash || receipt.command.financingTermsHash !== d.financingTermsHash ||
      receipt.payloadHash !== supportHash(receipt.command) || privateDocument.commandHash !== receipt.payloadHash ||
      supportHash(privateDocument.command) !== receipt.payloadHash || !receipt.recordedAt?.isEqual(d.recordedAt) ||
      supportHash(receipt.result) !== supportHash(convenienceReturnCostResolutionSummary(raw))) return null;
  return raw;
}
function rejectedPost(id: string, order: any, context: any): boolean {
  const r = order.returnRequest, o = r?.purchaseObservation, e = o?.evidence;
  return o?.protocol === 'convenience_return_purchase_observation_v1' && o.source === 'native_return_label_post' &&
    o.transactionId === id && o.returnRequestId === r.requestId && o.purchaseExternalId === r.purchaseExternalId &&
    o.requestSourceHash === r.sourceHash && o.quoteHash === returnHash(r.quote) && o.acceptanceHash === returnHash(r.acceptance) &&
    o.outcome === 'rejected' && native(o.recordedAt) && e?.stage === 'return_label_post' && e.httpStatus === 400 &&
    e.purchaseExternalId === r.purchaseExternalId && e.requestedRateId === r.quote.rateId &&
    e.contextHash === returnLabelPurchaseContextHash(context, r.quote.rateId, r.purchaseExternalId) &&
    typeof e.requestId === 'string' && !!e.requestId && Array.isArray(e.errors) && e.errors.length > 0 &&
    e.errors.every((v: any) => v.source === 'shipengine' && v.type === 'validation' && typeof v.code === 'string' && !!v.code);
}
async function source(tx: FirebaseFirestore.Transaction, id: string, actorId: string, operator: boolean) {
  const snapshot = await tx.get(base(id)), order = snapshot.data();
  if (!order || !operator && ![order.buyerId, order.sellerId].includes(actorId)) throw new HttpsError('permission-denied', 'Commande privée.');
  const pointer = (await tx.get(entry(id, 'terminal_current'))).data();
  const terminal = pointer?.returnRequestId ? await readConvenienceReturnTerminal(tx, id, pointer.returnRequestId) : null;
  const r = order.returnRequest, qualified = r?.schemaVersion === 2 && r.reason === 'change_of_mind' && qualifiedReturnRequest(id, order);
  const context = qualified ? frozenReturnContext(id, order) : null;
  const financing = own(order, 'convenienceReturnFinancialReservation') ? await readConvenienceReturnFinancing(tx, id, order) : null;
  const claims = await tx.get(db.collection('disputes').where('transactionId', '==', id).limit(101));
  const noOtherClaims = claims.size < 101 && claims.docs.every(row => ['closed', 'resolved', 'dismissed'].includes(row.data().status));
  const previous = r?.convenienceReturnBasis?.preReturnState;
  const previousQualified = previous === undefined || previous.status === 'delivered' &&
    typeof previous.disputedPresent === 'boolean' && previous.disputed === false;
  const independent = !noOtherClaims || hasActiveBankDispute(order) || hasUnsettledRefund(order) || order.refund != null ||
    own(order, 'bankRefundReconciliation') || order.buyerReport != null || order.returnEscalatedAt != null ||
    order.labelReconciliationRequired === true || order.trackingReviewRequired === true || order.deliveryCorrectionBlocked === true ||
    order.productPhysicalReview != null || order.moderationInstruction?.action === 'pause' || !previousQualified;
  const clock = await tx.get(base(id).collection('return_deposit').doc('current'));
  const unfurnished = qualified && !clock.exists && order.returnLabelId == null && order.returnTrackingNumber == null &&
    !r.labelProof && !r.committedAt && ['delivered'].includes(order.status) && order.disputed === true && order.fundsReleasedAt == null;
  const beforePurchase = !!unfurnished && !own(r, 'authorizedAt') && !own(r, 'purchaseExternalId') &&
    !own(r, 'observedLabel') && !own(r, 'purchaseObservation') && !own(order, 'convenienceReturnFinancialReservation');
  const purchaseQualified = !!unfurnished && !!context && qualifiedReturnQuote(id, order) && !!financing && financing.consumedByRefundIntentId === null &&
    native(r.authorizedAt) && r.purchaseExternalId === `sr_${returnHash([id, r.requestId, r.quote.quoteId, 'label']).slice(0,40)}`;
  const postRejected = purchaseQualified && rejectedPost(id, order, context);
  const rootResolution = own(order, 'convenienceReturnCostResolution');
  const costResolution = rootResolution ? await readConvenienceReturnCostResolution(tx, id, order) : null;
  return {snapshot, order, r, qualified, context, financing, terminal, costResolution, independent, unfurnished: !!unfurnished,
    beforePurchase: !!beforePurchase && !independent, postRejected: !!postRejected && !independent,
    riskAssumption: !!purchaseQualified && !independent && !rootResolution,
    canAdopt: !!purchaseQualified && !independent && !rootResolution,
    sourceHash: supportSourceHash({protocol: 'convenience_return_incident_source_v1', transactionId: id, order,
      claims: claims.docs.map(row => [row.id, row.data()]), terminal: terminal?.raw.contentHash ?? null, clock: clock.data() ?? null})};
}
async function actualLabel(s: Awaited<ReturnType<typeof source>>) {
  if (!s.canAdopt || !s.context) return null;
  const engine = getShipEngine(); if (!engine) return null;
  try {
    const label = await engine.readReturnPurchasedLabel(s.context, s.r.quote.rateId, s.r.purchaseExternalId, s.r.observedLabel?.labelId);
    const p = label.qualification;
    if (p?.currency !== 'CAD' || p.rateIdentitySource !== 'return_shipment' || !Number.isSafeInteger(p.totalCents) || p.totalCents < 0 ||
        p.totalCents !== p.shipmentCents + p.insuranceCents || label.carrierId !== s.context.carrierId ||
        label.carrierCode !== s.context.carrierCode || label.serviceCode !== s.context.serviceCode || !label.shipmentId ||
        !label.labelDownload?.href?.startsWith('https://')) return null;
    return label;
  } catch {return null;}
}
function variance(s: Awaited<ReturnType<typeof source>>, label: ShipEngineLabel | null) {
  if (!label && s.costResolution) {
    const d = s.costResolution.document;
    return {qualification: 'exact_provider_label' as const, actualProofHash: d.actualProofHash, acceptedCostCents: d.acceptedCostCents,
      actualCostCents: d.actualCostCents, deductionCents: d.deductionCents, grossArticleCents: d.grossArticleCents,
      netRefundCents: d.netRefundCents, platformVarianceCents: d.platformVarianceCents, currency: 'CAD' as const};
  }
  if (!label || !s.financing) return null;
  const t = s.financing.terms, actual = label.qualification!.totalCents, deduction = Math.min(t.returnLabelCostCents, actual);
  return {qualification: 'exact_provider_label' as const, actualProofHash: convenienceReturnActualProofHash(label),
    acceptedCostCents: t.returnLabelCostCents, actualCostCents: actual, deductionCents: deduction,
    grossArticleCents: t.grossArticleCents, netRefundCents: t.grossArticleCents - deduction,
    platformVarianceCents: actual - deduction, currency: 'CAD' as const};
}
function preview(id: string, uid: string, operator: boolean, s: Awaited<ReturnType<typeof source>>, label: ShipEngineLabel | null) {
  const v = variance(s, label), sourceHash = supportSourceHash([s.sourceHash, v?.actualProofHash ?? null]);
  return {protocol: 'convenience_return_incident_preview_v1', transactionId: id, ownerId: uid,
    role: operator ? 'operator' : uid === s.order.buyerId ? 'buyer' : 'seller',
    state: s.unfurnished ? 'unfurnished' : committedReturnReceipt(id, s.order) ? 'label_ready' : !s.r && s.terminal ? 'closed' : 'unknown',
    source: s.qualified ? {sourceHash, version: s.r.version, returnRequestId: s.r.requestId, purchaseExternalId: s.r.purchaseExternalId ?? null,
      quoteId: s.r.quote?.quoteId ?? null, financingTermsHash: s.financing?.termsHash ?? null} : null,
    closeBasis: {nativeBeforePurchase: s.beforePurchase, nativePostValidationRejected: s.postRejected && !label,
      operatorPlatformRiskAssumption: s.riskAssumption},
    variance: v, canClose: operator && (s.beforePurchase || s.postRejected || s.riskAssumption), canAdopt: operator && !!v && s.canAdopt,
    terminal: !s.r ? s.terminal?.summary ?? null : null, ...effects};
}
export async function handleConvenienceReturnIncident(request: any) {
  return withPrivateAccountSession(request, async () => {
    const uid = supportUid(request), input = supportObject(request.data, ['capability', 'expectedUid', 'expectedAdminUid', 'transactionId', 'scope', 'mode', 'requestId', 'command']);
    const id = supportId(input.transactionId), mode = input.mode, operator = input.scope === 'operator';
    if (input.capability !== CONVENIENCE_RETURN_INCIDENT_CAPABILITY || !['owner', 'operator'].includes(input.scope) ||
        !['preview', 'execute', 'observe', 'neutralize'].includes(mode) || operator && input.expectedAdminUid !== uid)
      throw new HttpsError('invalid-argument', 'Version, compte et périmètre exacts requis.');
    const c = mode === 'preview' ? null : commandInput(input.command), rid = c ? supportRequestId(input.requestId) : null;
    if (c) {
      const old = (await receiptRef(id, uid, rid!).get()).data();
      if (old || mode === 'observe') return receiptView(id, uid, rid!, c, old);
    }
    await checkRateLimit(uid, true, {functionName: 'convenienceReturnIncident', maxCallsAuthenticated: 12, maxCallsUnauthenticated: 0, windowMs: 60_000});
    if (mode === 'neutralize') return db.runTransaction(async tx => {
      await assertPrivateAccountSession(request, tx);
      const ref = receiptRef(id, uid, rid!), old = (await tx.get(ref)).data(); if (old) return receiptView(id, uid, rid!, c!, old);
      const raw = {protocol: 'convenience_return_incident_command_v1', transactionId: id, ownerId: uid, requestId: rid,
        command: c, payloadHash: supportHash(c), state: 'neutralized', reason: 'owner_neutralized', result: null, recordedAt: Timestamp.now()};
      tx.create(ref, raw); return receiptView(id, uid, rid!, c!, raw);
    });
    const read = async (tx: FirebaseFirestore.Transaction) => {
      await assertPrivateAccountSession(request, tx);
      if (operator) await supportAdmin(tx, uid, await supportCurrentAdminSession(request));
      return source(tx, id, uid, operator);
    };
    if (mode === 'execute') {
      if (!operator) throw new HttpsError('permission-denied', 'Instruction opérateur requise.');
      assertRecentAccountAuthentication(request.auth.token);
    }
    const before = await db.runTransaction(read), label = await actualLabel(before);
    if (mode === 'preview') {
      const after = await db.runTransaction(read);
      return preview(id, uid, operator, after, after.sourceHash === before.sourceHash ? label : null);
    }
    return db.runTransaction(async tx => {
      await assertPrivateAccountSession(request, tx);
      const ref = receiptRef(id, uid, rid!), old = (await tx.get(ref)).data(); if (old) return receiptView(id, uid, rid!, c!, old);
      await supportAdmin(tx, uid, await supportCurrentAdminSession(request)); assertRecentAccountAuthentication(request.auth.token);
      const current = await source(tx, id, uid, true), view = preview(id, uid, true, current, label), r = current.r;
      let reason: string | null = null;
      if (!r || c!.sourceHash !== view.source?.sourceHash || c!.expectedVersion !== r.version || c!.returnRequestId !== r.requestId ||
          c!.purchaseExternalId !== (r.purchaseExternalId ?? null) || c!.quoteId !== (r.quote?.quoteId ?? null) ||
          c!.financingTermsHash !== (current.financing?.termsHash ?? null) || before.sourceHash !== current.sourceHash) reason = 'incident_source_changed';
      else if (c!.action === 'close_unfurnished_return' ? !view.canClose ||
          !(c!.basis === 'native_before_purchase' ? view.closeBasis.nativeBeforePurchase : c!.basis === 'native_post_validation_rejected'
            ? view.closeBasis.nativePostValidationRejected : view.closeBasis.operatorPlatformRiskAssumption)
          : !view.canAdopt || c!.actualProofHash !== view.variance?.actualProofHash) reason = 'incident_permission_or_proof_changed';
      const at = Timestamp.now(), resultId = (c!.action === 'close_unfurnished_return' ? 'closed_' : 'variance_') + supportHash([uid, rid]);
      let terminal: any = null, resolution: any = null, result: any = null;
      if (!reason && c!.action === 'close_unfurnished_return') {
        if (await readConvenienceReturnTerminal(tx, id, r.requestId)) reason = 'return_already_closed';
        else {
          const document = {protocol: 'convenience_return_terminal_document_v1', transactionId: id, terminalId: resultId,
            actorId: uid, incidentRequestId: rid, returnRequestId: r.requestId, purchaseExternalId: r.purchaseExternalId ?? null,
            basis: c!.basis, providerOutcome: c!.basis === 'native_before_purchase' ? 'not_invoked' : c!.basis === 'native_post_validation_rejected'
              ? 'validation_rejected' : label ? 'purchased_unfurnished' : 'unknown',
            privateNote: c!.note, command: c, commandHash: supportHash(c), recordedAt: at,
            capture: {returnRequest: r, financing: current.order.convenienceReturnFinancialReservation ?? null, context: current.context,
              actualLabelIdentity: label ? {labelId: label.labelId, proofHash: convenienceReturnActualProofHash(label),
                actualCostCents: label.qualification!.totalCents} : null,
              activeOrder: Object.fromEntries(['status', 'disputed', 'statusBeforeDispute', 'returnLabelPending', 'returnRequestedAt',
                'returnReconciliationRequired', 'returnReconciliationReason'].map(k => [k, current.order[k] ?? null]))}};
          terminal = {protocol: 'convenience_return_terminal_v1', document, contentHash: supportSourceHash(document)};
          result = terminalSummary(terminal);
        }
      } else if (!reason) {
        const v = view.variance!;
        const document = {protocol: 'convenience_return_cost_resolution_document_v1', transactionId: id, resolutionId: resultId,
          buyerId: current.order.buyerId, sellerId: current.order.sellerId, actorId: uid, incidentRequestId: rid, command: c,
          commandHash: supportHash(c), requestId: r.requestId, purchaseExternalId: r.purchaseExternalId,
          financingTermsHash: current.financing!.termsHash, actualProofHash: v.actualProofHash, actualLabel: label,
          originalReservationHash: supportSourceHash({...current.order.convenienceReturnFinancialReservation, consumedByRefundIntentId: null}),
          acceptedCostCents: v.acceptedCostCents, actualCostCents: v.actualCostCents, deductionCents: v.deductionCents,
          grossArticleCents: v.grossArticleCents, netRefundCents: v.netRefundCents, platformVarianceCents: v.platformVarianceCents,
          currency: 'CAD', recordedAt: at, documentFurnishing: 'buyer_read_required', privateNote: c!.note};
        resolution = {protocol: 'convenience_return_cost_resolution_v1', document, contentHash: supportSourceHash(document)};
        result = convenienceReturnCostResolutionSummary(resolution);
      }
      if (resolution) {
        const forwardOwners = await tx.get(db.collection('transactions').where('shipEngineLabelId', '==', label!.labelId).limit(2));
        const returnOwners = await tx.get(db.collection('transactions').where('returnLabelId', '==', label!.labelId).limit(2));
        if (forwardOwners.size > 0 || returnOwners.docs.some(owner => owner.id !== id)) {
          reason = 'return_label_owner_requires_reconciliation'; resolution = null; result = null;
        }
      }
      const notices = !reason ? await prepareOperationalNotices(tx, [current.order.buyerId, current.order.sellerId].map(userId => ({
        eventKey: `convenience_return_incident_v1:${supportHash([id, uid, rid])}`, userId, type: 'product_review_update',
        title: terminal ? 'Demande de retour clôturée' : 'Coût réel du retour examiné',
        message: terminal ? 'Cette demande et son ancienne étiquette éventuelle ne peuvent plus être utilisées. Aucun remboursement ni mouvement de fonds n’est exécuté par la clôture.'
          : 'La déduction du retour est limitée au coût accepté ou au coût réel si celui-ci est inférieur. Un excès éventuel est assumé par Seconde. Consultez cette commande avant tout dépôt.',
        data: {ownerId: userId, transactionId: id}}))) : null;
      const receipt = {protocol: 'convenience_return_incident_command_v1', transactionId: id, ownerId: uid, requestId: rid,
        command: c, payloadHash: supportHash(c), state: reason ? 'not_executed' : 'committed', reason, result, recordedAt: at};
      tx.create(ref, receipt);
      if (terminal) {
        tx.create(terminalRef(id, r.requestId), terminal);
        if (r.purchaseExternalId) tx.create(purchaseTerminalRef(id, r.purchaseExternalId), {protocol: 'convenience_return_purchase_tombstone_v1',
          terminalId: resultId, returnRequestId: r.requestId, contentHash: terminal.contentHash});
        tx.set(entry(id, 'terminal_current'), {returnRequestId: r.requestId, terminalId: resultId});
        const update: any = {returnRequest: FieldValue.delete(), returnLabelPending: FieldValue.delete(), returnRequestedAt: FieldValue.delete(),
          returnReconciliationRequired: FieldValue.delete(), returnReconciliationReason: FieldValue.delete(),
          convenienceReturnFinancialReservation: FieldValue.delete(), status: 'delivered'};
        const previous = r.convenienceReturnBasis?.preReturnState;
        if (previous?.disputedPresent === true) update.disputed = previous.disputed;
        else if (previous?.disputedPresent === false) update.disputed = FieldValue.delete();
        else update.disputed = false; // qualified legacy writer: delivered, no independent claim, own G10 hold only
        tx.update(base(id), update);
      } else if (resolution) {
        const p = label!.qualification!;
        const labelProof = {schemaVersion: 2, labelId: label!.labelId, shipmentId: label!.shipmentId, carrierId: label!.carrierId,
          carrierCode: label!.carrierCode, serviceCode: label!.serviceCode, outboundLabelId: current.context!.outboundLabelId,
          trackingNumber: label!.trackingNumber, labelUrl: null, cost: p.totalCents / 100, currency: 'CAD',
          shipmentCents: p.shipmentCents, insuranceCents: p.insuranceCents, totalCents: p.totalCents,
          providerCreatedAt: p.providerCreatedAt, rateDetails: p.rateDetails};
        tx.create(entry(id, resultId), resolution);
        tx.update(base(id), {convenienceReturnCostResolution: publicConvenienceReturnCostResolution(resolution), status: 'return_requested', disputed: true,
          'returnRequest.state': 'committed', 'returnRequest.version': r.version + 1, 'returnRequest.committedAt': at,
          'returnRequest.labelProof': labelProof, 'returnRequest.observedLabel': FieldValue.delete(), returnLabelId: label!.labelId, returnTrackingNumber: label!.trackingNumber,
          returnLabelUrl: null, returnCarrierCode: label!.carrierCode, returnLabelCost: p.totalCents / 100,
          returnReason: 'change_of_mind', returnLabelPending: null, returnReconciliationRequired: false, returnReconciliationReason: null});
      }
      notices?.commit(); return receiptView(id, uid, rid!, c!, receipt);
    });
  });
}
