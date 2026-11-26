/** The seller declares receipt of the conforming article. This native record
 * is an input to a separate financial instruction, never an automatic refund. */
import {Timestamp} from 'firebase-admin/firestore';
import {HttpsError} from 'firebase-functions/v2/https';
import {db} from '../config/firebase';
import {committedReturnReceipt} from './returnRequest';
import {supportHash, supportId, supportObject, supportRequestId, supportSourceHash, supportUid} from './supportRequest';
import {assertPrivateAccountSession} from './privateAccountSession';
import {prepareOperationalNotices} from './notifications';
import {checkRateLimit} from './rateLimit';
import {hasActiveBankDispute} from './bankDispute';
import {hasUnsettledRefund} from './refundState';
import type {ConvenienceReturnReference} from './convenienceReturn';

export type ConvenienceReturnFinancialReference = {protocol: 'convenience_return_financial_review_v1'; proposalId: string;
  agreementContentHash: string; requestId: string; financingTermsHash: string; receptionRequestId: string; receptionHash: string};
type Command = {action: 'confirm_return_received'; sourceHash: string; returnRequestId: string; labelId: string;
  financingTermsHash: string; agreement: ConvenienceReturnReference; contentConforming: true; conditionsAcknowledged: true};
const effects = {financialEffectAuthorized: false, refundDecisionGranted: false, physicalContentsVerified: false};
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const native = (v: unknown): v is Timestamp => v instanceof Timestamp && v.toMillis() > 0 && v.toMillis() <= Date.now();
const orderRef = (id: string) => db.collection('transactions').doc(id);
const receptionRef = (id: string, requestId: string) => orderRef(id).collection('convenience_return').doc('reception_' + supportHash(requestId));
const receiptRef = (id: string, uid: string, requestId: string) => orderRef(id).collection('convenience_return_commands')
  .doc(supportHash(['convenience_return_reception_v1', uid, requestId]));
function parseCommand(value: unknown): Command {
  const c = supportObject(value, ['action', 'sourceHash', 'returnRequestId', 'labelId', 'financingTermsHash', 'agreement', 'contentConforming', 'conditionsAcknowledged']);
  const a = supportObject(c.agreement, ['proposalId', 'contentHash', 'termsProtocol']);
  if (c.action !== 'confirm_return_received' || !hash(c.sourceHash) || !hash(c.financingTermsHash) ||
      c.contentConforming !== true || c.conditionsAcknowledged !== true || a.termsProtocol !== 'convenience_return_terms_v2' ||
      !/^cr_[a-f0-9]{64}$/.test(a.proposalId ?? '') || !hash(a.contentHash))
    throw new HttpsError('invalid-argument', 'La source, l’étiquette et la déclaration explicite du vendeur sont requises.');
  return {action: 'confirm_return_received', sourceHash: c.sourceHash, returnRequestId: supportRequestId(c.returnRequestId),
    labelId: supportId(c.labelId), financingTermsHash: c.financingTermsHash,
    agreement: {proposalId: a.proposalId, contentHash: a.contentHash, termsProtocol: a.termsProtocol},
    contentConforming: true, conditionsAcknowledged: true};
}
async function currentSource(tx: FirebaseFirestore.Transaction, id: string, order: any, legacySource = false) {
  if (order.returnRequest?.schemaVersion !== 2 || order.returnRequest.reason !== 'change_of_mind' ||
      !committedReturnReceipt(id, order) || order.returnLabelId !== order.returnRequest.labelProof?.labelId ||
      Object.prototype.hasOwnProperty.call(order.labelLifecycleCurrent ?? {}, 'return')) return null;
  const {readEffectiveConvenienceReturnFinancing} = await import('./convenienceReturnFinancial');
  const {readConvenienceReturnAgreement} = await import('./convenienceReturn');
  const financing = await readEffectiveConvenienceReturnFinancing(tx, id, order);
  if (!financing) return null;
  const agreement = await readConvenienceReturnAgreement(tx, id, order, financing.terms.agreement, {requireCurrentSource: false});
  if (!agreement) return null;
  const stableVariance = !!financing.costResolution && !legacySource;
  const {labelUrl: _labelUrl, ...stableLabelProof} = order.returnRequest.labelProof;
  const source = {protocol: stableVariance ? 'convenience_return_reception_source_v2' : 'convenience_return_reception_source_v1', transactionId: id, buyerId: order.buyerId, sellerId: order.sellerId,
    returnRequestId: order.returnRequest.requestId, labelId: order.returnLabelId, financingTermsHash: financing.termsHash,
    agreement: financing.terms.agreement, agreementContentHash: agreement.contentHash, labelProof: stableVariance ? stableLabelProof : order.returnRequest.labelProof,
    ...(financing.costResolution ? {costResolution: financing.costResolution} : {})};
  return {source, sourceHash: supportSourceHash(source), financing};
}
function reference(document: any, contentHash: string): ConvenienceReturnFinancialReference {
  return {protocol: 'convenience_return_financial_review_v1', proposalId: document.command.agreement.proposalId,
    agreementContentHash: document.command.agreement.contentHash, requestId: document.command.returnRequestId,
    financingTermsHash: document.command.financingTermsHash, receptionRequestId: document.receptionRequestId, receptionHash: contentHash};
}
function receiptView(id: string, uid: string, requestId: string, command: Command, raw: any) {
  if (raw && (raw.protocol !== 'convenience_return_reception_command_v1' || raw.transactionId !== id || raw.ownerId !== uid ||
      raw.requestId !== requestId || raw.payloadHash !== supportHash(command) || supportHash(raw.command) !== supportHash(command) ||
      !['committed', 'not_executed', 'neutralized'].includes(raw.state) || !native(raw.recordedAt) ||
      raw.state === 'committed' && (!raw.reception || raw.reception.receptionRequestId !== requestId || !hash(raw.reception.receptionHash))))
    throw new HttpsError('failed-precondition', 'Le reçu de cette déclaration doit être rapproché.');
  return {protocol: 'convenience_return_reception_receipt_v1', transactionId: id, ownerId: uid, requestId,
    command, payloadHash: supportHash(command), state: raw?.state ?? 'absent', recordedAt: raw?.recordedAt.toDate().toISOString() ?? null,
    reason: raw?.reason ?? null, reception: raw?.reception ?? null, ...effects};
}
/** Historical proof remains readable after financial consumption. The caller
 * must independently qualify the current reserve before a NEW settlement. */
export async function readConvenienceReturnFinancialReception(tx: FirebaseFirestore.Transaction, id: string, order: any,
  expected?: ConvenienceReturnFinancialReference) {
  if (typeof order.returnRequest?.requestId !== 'string') return null;
  const raw = (await tx.get(receptionRef(id, order.returnRequest.requestId))).data(), d = raw?.document;
  if (!d || d.sourceProtocol !== undefined && d.sourceProtocol !== 'convenience_return_reception_source_v2') return null;
  let source = await currentSource(tx, id, order, d.sourceProtocol === undefined);
  if (!source) return null;
  // Already-native V1 receipts are never rewritten or silently rehashed. A
  // receipt made before deferred furnishing used labelUrl=null; reconstruct
  // precisely that original source only after the native clock proves the
  // later transition. Every other identity/cost/source field stays current.
  if (d.sourceProtocol === undefined && source.financing.costResolution && d.sourceHash !== source.sourceHash) {
    const {returnDocumentFurnished} = await import('./returnDepositDeadline');
    const clock = (await tx.get(orderRef(id).collection('return_deposit').doc('current'))).data();
    if (clock?.entries?.[0]?.origin === 'member_document_furnishing_v1' && native(d.recordedAt) &&
        native(clock.availableAt) && d.recordedAt.toMillis() <= clock.availableAt.toMillis() &&
        await returnDocumentFurnished(tx, id, order)) {
      const historical = {...source.source, labelProof: {...source.source.labelProof, labelUrl: null}};
      source = {...source, source: historical, sourceHash: supportSourceHash(historical)};
    }
  }
  if (raw?.protocol !== 'convenience_return_reception_record_v1' || !d || raw.contentHash !== supportSourceHash(d) ||
      d.protocol !== 'convenience_return_reception_v1' || d.transactionId !== id || d.buyerId !== order.buyerId || d.sellerId !== order.sellerId ||
      d.actorId !== order.sellerId || !native(d.recordedAt) || d.contentConformity !== 'seller_declared_conforming' || d.physicalContentsVerified !== false ||
      d.commandHash !== supportHash(d.command) || d.sourceHash !== source.sourceHash || d.command.sourceHash !== source.sourceHash ||
      d.command.returnRequestId !== source.source.returnRequestId || d.command.labelId !== source.source.labelId ||
      d.command.financingTermsHash !== source.source.financingTermsHash ||
      supportHash(d.command.agreement) !== supportHash(source.source.agreement)) return null;
  let command: Command;
  try {command = parseCommand(d.command);} catch {return null;}
  const receipt = (await tx.get(receiptRef(id, d.actorId, d.receptionRequestId))).data();
  const result = reference(d, raw.contentHash);
  if (receipt?.state !== 'committed' || receiptView(id, d.actorId, d.receptionRequestId, command, receipt).state !== 'committed' ||
      !receipt.recordedAt.isEqual(d.recordedAt) || supportHash(receipt.reception) !== supportHash(result) ||
      expected && supportHash(expected) !== supportHash(result)) return null;
  return {reference: result, target: d};
}
/** Boundary session guards are supplied by handleConvenienceReturn. */
export async function handleConvenienceReturnReception(request: any) {
  const uid = supportUid(request), input = supportObject(request.data, ['capability', 'expectedUid', 'transactionId', 'mode', 'requestId', 'command']);
  const id = supportId(input.transactionId), mode = input.mode;
  if (input.capability !== 'convenience_return_v2' || !['reception_preview', 'execute', 'observe', 'neutralize'].includes(mode))
    throw new HttpsError('invalid-argument', 'Version et action de réception explicites requises.');
  const command = mode === 'reception_preview' ? null : parseCommand(input.command), requestId = command ? supportRequestId(input.requestId) : null;
  if (command) {
    const old = (await receiptRef(id, uid, requestId!).get()).data();
    if (old || mode === 'observe') return receiptView(id, uid, requestId!, command, old);
  }
  await checkRateLimit(uid, true, {functionName: 'convenienceReturnReception', maxCallsAuthenticated: 15, maxCallsUnauthenticated: 0, windowMs: 60_000});
  return db.runTransaction(async tx => {
    await assertPrivateAccountSession(request, tx);
    const ownRef = command ? receiptRef(id, uid, requestId!) : null, old = ownRef ? (await tx.get(ownRef)).data() : null;
    if (old || mode === 'observe') return receiptView(id, uid, requestId!, command!, old);
    if (mode === 'neutralize') {
      const record = {protocol: 'convenience_return_reception_command_v1', transactionId: id, ownerId: uid, requestId,
        command, payloadHash: supportHash(command), state: 'neutralized', reason: 'owner_neutralized', reception: null, recordedAt: Timestamp.now()};
      tx.create(ownRef!, record); return receiptView(id, uid, requestId!, command!, record);
    }
    const order = (await tx.get(orderRef(id))).data();
    if (!order || ![order.buyerId, order.sellerId].includes(uid)) throw new HttpsError('permission-denied', 'Commande privée réservée à ses membres.');
    const current = await currentSource(tx, id, order), recorded = current ? await readConvenienceReturnFinancialReception(tx, id, order) : null;
    const nativeRef = current ? receptionRef(id, current.source.returnRequestId) : null, raw = nativeRef ? (await tx.get(nativeRef)).data() : null;
    const allowed = uid === order.sellerId && !!current && !raw && order.status === 'return_requested' &&
      !hasActiveBankDispute(order) && !hasUnsettledRefund(order) && current.financing.consumedByRefundIntentId === null;
    if (mode === 'reception_preview') return {protocol: 'convenience_return_reception_preview_v1', transactionId: id, ownerId: uid,
      role: uid === order.sellerId ? 'seller' : 'buyer', state: raw ? recorded ? 'recorded' : 'unknown' : current ? 'none' : 'unknown',
      source: current ? {sourceHash: current.sourceHash, returnRequestId: current.source.returnRequestId, labelId: current.source.labelId,
        financingTermsHash: current.source.financingTermsHash, agreement: current.source.agreement} : null,
      canConfirm: allowed, reception: recorded?.reference ?? null, ...effects};
    const matches = !!current && command!.sourceHash === current.sourceHash && command!.returnRequestId === current.source.returnRequestId &&
      command!.labelId === current.source.labelId && command!.financingTermsHash === current.source.financingTermsHash &&
      supportHash(command!.agreement) === supportHash(current.source.agreement);
    const at = Timestamp.now(), committed = allowed && matches;
    const document = committed ? {protocol: 'convenience_return_reception_v1', transactionId: id, buyerId: order.buyerId, sellerId: order.sellerId,
      actorId: uid, receptionRequestId: requestId,
      ...(current!.source.protocol === 'convenience_return_reception_source_v2' ? {sourceProtocol: current!.source.protocol} : {}),
      command, commandHash: supportHash(command), sourceHash: current!.sourceHash,
      contentConformity: 'seller_declared_conforming', physicalContentsVerified: false, recordedAt: at} : null;
    const result = document ? reference(document, supportSourceHash(document)) : null;
    const notices = committed ? await prepareOperationalNotices(tx, [order.buyerId, order.sellerId].map(userId => ({
      eventKey: `convenience_return_reception_v1:${supportHash([id, uid, requestId])}`, userId, type: 'product_review_update',
      title: 'Réception du retour déclarée par le vendeur', message: 'Le vendeur déclare avoir reçu l’article retourné conforme. Le coût accepté du retour sera déduit du prix de l’article dans une instruction financière distincte. Aucun remboursement n’est exécuté par cette déclaration.',
      data: {ownerId: userId, transactionId: id}}))) : null;
    const receipt = {protocol: 'convenience_return_reception_command_v1', transactionId: id, ownerId: uid, requestId,
      command, payloadHash: supportHash(command), state: committed ? 'committed' : 'not_executed',
      reason: committed ? null : 'current_reception_source_or_permission_changed', reception: result, recordedAt: at};
    tx.create(ownRef!, receipt);
    if (committed) {
      tx.create(nativeRef!, {protocol: 'convenience_return_reception_record_v1', document, contentHash: supportSourceHash(document)});
      notices!.commit();
    }
    return receiptView(id, uid, requestId!, command!, receipt);
  });
}
