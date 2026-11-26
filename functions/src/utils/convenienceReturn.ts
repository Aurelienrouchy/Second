/** A conforming-item return requires the seller's native, explicit agreement.
 * These documentary commands never freeze funds, buy a label or settle costs. */
import {Timestamp} from 'firebase-admin/firestore';
import {HttpsError} from 'firebase-functions/v2/https';
import {db} from '../config/firebase';
import {supportHash, supportId, supportObject, supportRequestId, supportSourceHash, supportUid} from './supportRequest';
import {assertAccountSecurityOpen} from './eligibility';
import {prepareOperationalNotices} from './notifications';
import {frozenReturnContext} from './returnRequest';
import {checkRateLimit, resolveCallerKey} from './rateLimit';
import {readRefundAllocationSource} from './refundAllocation';
import {assertPrivateAccountSession, withPrivateAccountSession} from './privateAccountSession';

export const CONVENIENCE_RETURN_CAPABILITY = 'convenience_return_v1';
export const CONVENIENCE_RETURN_POLICY_CAPABILITY = 'convenience_return_v2';
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const native = (v: unknown): v is Timestamp => v instanceof Timestamp && Number.isSafeInteger(v.toMillis()) && v.toMillis() >= 0 && v.toMillis() <= Date.now();
const base = (id: string) => db.collection('transactions').doc(id);
const rootRef = (id: string, v2 = false) => base(id).collection('convenience_return').doc(v2 ? 'current_v2' : 'current');
const receiptRef = (id: string, uid: string, rid: string, v2 = false) => base(id).collection('convenience_return_commands')
  .doc(supportHash(v2 ? [CONVENIENCE_RETURN_POLICY_CAPABILITY, uid, rid] : [uid, rid]));
const effects = {fundsFrozen: false, financialEffectAuthorized: false, refundDecisionGranted: false,
  shippingPermissionGranted: false, costAllocation: 'instruction_required' as const};
const policyEffects = {...effects, costAllocation: 'buyer_return_article_only' as const};
export type ConvenienceReturnReference = {proposalId: string; contentHash: string; termsProtocol?: 'convenience_return_terms_v2'};
export function parseConvenienceReturnReference(raw: unknown): ConvenienceReturnReference {
  const r = supportObject(raw, ['proposalId', 'contentHash', 'termsProtocol']);
  if (!/^cr_[a-f0-9]{64}$/.test(r.proposalId ?? '') || !hash(r.contentHash) ||
      r.termsProtocol !== undefined && r.termsProtocol !== 'convenience_return_terms_v2')
    throw new HttpsError('invalid-argument', 'Accord vendeur natif exact requis.');
  return {proposalId: r.proposalId, contentHash: r.contentHash,
    ...(r.termsProtocol ? {termsProtocol: r.termsProtocol} : {})};
}
/** Only the frozen contract qualifies. No lookup of a current listing/profile. */
export function convenienceReturnTerms(id: string, order: FirebaseFirestore.DocumentData) {
  const item = order.articleSnapshot;
  const nativeListing = ['listing_content_v1', 'listing_content_v2'].includes(item?.listingContentVersion);
  const route = frozenReturnContext(id, {...order, returnRequest: {requestId: 'convenience_source_v1'}});
  if (!route || typeof order.articleId !== 'string' || !order.articleId || order.articleId.includes('/') ||
      !item || typeof item.title !== 'string' || !item.title.trim() || typeof item.description !== 'string' || !item.description.trim() ||
      !(nativeListing || ['single_article', 'set_as_one'].includes(item.saleUnit)) ||
      typeof order.buyerId !== 'string' || !order.buyerId || order.buyerId.includes('/') ||
      typeof order.sellerId !== 'string' || !order.sellerId || order.sellerId.includes('/') || order.buyerId === order.sellerId) return null;
  const {externalShipmentId: _externalShipmentId, ...physicalRoute} = route;
  const terms = {protocol: 'convenience_return_terms_v1', transactionId: id, buyerId: order.buyerId, sellerId: order.sellerId,
    reason: 'change_of_mind', articleId: order.articleId, article: {title: item.title, description: item.description,
      ...(nativeListing ? {listingContentVersion: item.listingContentVersion} : {saleUnit: item.saleUnit})},
    route: physicalRoute, scope: 'whole_transaction', costs: 'instruction_required', refund: 'not_decided',
    itemConformity: 'buyer_declared_conforming', physicalConditionVerified: false};
  const sourceHash = supportSourceHash([terms, Object.fromEntries(['articleSnapshot', 'shippingSnapshot', 'shippingAddress',
    'shipEngineLabelId', 'shipEngineRateId', 'deliveredAt', 'fundsReleaseAt', 'deliveryCorrection', 'currency', 'amount', 'totalAmount', 'sellerPayout']
    .map(key => [key, order[key] ?? null]))]);
  return {terms, sourceHash};
}
/** V2 is additive. Its monetary source is the original accepted purchase and
 * cumulative allocations, never a listing price or a reconstructed card split.
 * The article figure is a ceiling; agreement alone authorizes no settlement. */
async function convenienceReturnPolicyTerms(tx: FirebaseFirestore.Transaction, id: string, order: FirebaseFirestore.DocumentData) {
  const historical = convenienceReturnTerms(id, order);
  if (!historical) return null;
  let money;
  try {money = await readRefundAllocationSource(tx, id, order);} catch (error) {
    if (error instanceof HttpsError && error.code === 'failed-precondition') return null;
    throw error;
  }
  const terms = {...historical.terms, protocol: 'convenience_return_terms_v2', costs: 'buyer_pays_return',
    refund: {basis: 'article_price_only', currency: 'CAD', originalArticleCents: money.initial.articleCents,
      alreadyAllocatedArticleCents: money.used.articleCents, maximumRemainingArticleCents: money.remaining.articleCents,
      excluded: {outboundShippingCents: money.initial.shippingCents, serviceFeeCents: money.initial.buyerFeeCents,
        serviceTaxCents: money.initial.gstCents + money.initial.qstCents},
      paymentAllocation: 'original_payment_sources_required', execution: 'separate_native_instruction_required'},
    financing: 'instruction_required', sellerReturnLabelDebitAuthorized: false};
  return {terms, sourceHash: supportSourceHash([CONVENIENCE_RETURN_POLICY_CAPABILITY, historical.sourceHash,
    money.basisHash, money.cumulativeHash, terms])};
}
function openForAgreement(order: FirebaseFirestore.DocumentData) {
  // An optional documentary agreement has no validated commercial deadline.
  // Completed/released orders retain the same request/response opportunity.
  return ['delivered', 'completed'].includes(order.status) && order.deliveryType === 'shipping';
}
type Command = {action: 'request' | 'accept' | 'refuse'; sourceHash: string; expectedVersion: number;
  proposalId: string | null; conditionsAcknowledged: true; termsProtocol?: 'convenience_return_terms_v2'};
function command(raw: unknown, v2 = false): Command {
  const c = supportObject(raw, ['action', 'sourceHash', 'expectedVersion', 'proposalId', 'conditionsAcknowledged', ...(v2 ? ['termsProtocol'] : [])]);
  if (!['request', 'accept', 'refuse'].includes(c.action) || !hash(c.sourceHash) ||
      !Number.isSafeInteger(c.expectedVersion) || c.expectedVersion < 0 || c.conditionsAcknowledged !== true ||
      v2 && c.termsProtocol !== 'convenience_return_terms_v2' ||
      (c.action === 'request' ? c.proposalId !== null || c.expectedVersion !== 0 : !/^cr_[a-f0-9]{64}$/.test(c.proposalId ?? '')))
    throw new HttpsError('invalid-argument', 'Choix explicite et version exacte requis.');
  return {action: c.action, sourceHash: c.sourceHash, expectedVersion: c.expectedVersion,
    proposalId: c.proposalId, conditionsAcknowledged: true, ...(v2 ? {termsProtocol: 'convenience_return_terms_v2' as const} : {})};
}
function receiptView(id: string, uid: string, rid: string, value: any, c: Command, v2 = false) {
  const version = v2 ? 'v2' : 'v1', selectedEffects = v2 ? policyEffects : effects;
  if (!value) return {protocol: `convenience_return_receipt_${version}`, transactionId: id, ownerId: uid, requestId: rid,
    command: c, payloadHash: supportHash(c), state: 'absent', recordedAt: null, reason: null, ...selectedEffects};
  if (value.protocol !== `convenience_return_command_${version}` || value.transactionId !== id || value.ownerId !== uid || value.requestId !== rid ||
      value.payloadHash !== supportHash(c) || supportHash(value.command) !== supportHash(c) || !native(value.recordedAt) ||
      !['committed', 'not_executed', 'neutralized'].includes(value.state))
    throw new HttpsError('failed-precondition', 'Le reçu de cette intention doit être rapproché.');
  return {protocol: `convenience_return_receipt_${version}`, transactionId: id, ownerId: uid, requestId: rid,
    command: c, payloadHash: value.payloadHash, state: value.state as 'committed' | 'not_executed' | 'neutralized',
    recordedAt: value.recordedAt.toDate().toISOString(), reason: value.reason ?? null, ...selectedEffects};
}
async function nativeAgreement(tx: FirebaseFirestore.Transaction, id: string, order: FirebaseFirestore.DocumentData, raw: any, v2 = false) {
  const version = v2 ? 'v2' : 'v1';
  const p = raw?.proposal;
  if (raw?.protocol !== `convenience_return_${version}` || !p || raw.contentHash !== supportSourceHash(p) ||
      p.protocol !== `convenience_return_proposal_${version}` || p.transactionId !== id || p.buyerId !== order.buyerId || p.sellerId !== order.sellerId ||
      p.proposalId !== 'cr_' + supportHash(v2 ? [CONVENIENCE_RETURN_POLICY_CAPABILITY, p.buyerId, p.requestId] : [p.buyerId, p.requestId]) ||
      !native(p.requestedAt) || !hash(p.sourceHash) || v2 && p.terms?.protocol !== 'convenience_return_terms_v2' ||
      !['pending', 'accepted', 'refused'].includes(raw.state) || raw.version !== (raw.state === 'pending' ? 1 : 2)) return null;
  const request = (await tx.get(receiptRef(id, p.buyerId, p.requestId, v2))).data();
  const extension = v2 ? {termsProtocol: 'convenience_return_terms_v2' as const} : {};
  const rc: Command = {action: 'request', sourceHash: p.sourceHash, expectedVersion: 0, proposalId: null, conditionsAcknowledged: true, ...extension};
  if (request?.state !== 'committed' || receiptView(id, p.buyerId, p.requestId, request, rc, v2).state !== 'committed' || !request.recordedAt.isEqual(p.requestedAt)) return null;
  if (raw.state !== 'pending') {
    const response = raw.response;
    if (!response || response.actorId !== p.sellerId || !native(response.recordedAt) || typeof response.requestId !== 'string') return null;
    const r = (await tx.get(receiptRef(id, p.sellerId, response.requestId, v2))).data();
    const c: Command = {action: raw.state === 'accepted' ? 'accept' : 'refuse', sourceHash: p.sourceHash,
      expectedVersion: 1, proposalId: p.proposalId, conditionsAcknowledged: true, ...extension};
    if (r?.state !== 'committed' || receiptView(id, p.sellerId, response.requestId, r, c, v2).state !== 'committed' || !r.recordedAt.isEqual(response.recordedAt)) return null;
  }
  return raw;
}
/** Re-read both command proofs. Only a previously reserved financing reader
 * may omit the CURRENT monetary comparison to inspect its own native capture. */
export async function readConvenienceReturnAgreement(tx: FirebaseFirestore.Transaction, id: string, order: FirebaseFirestore.DocumentData,
  reference: ConvenienceReturnReference, options: {requireCurrentSource?: boolean} = {}) {
  const v2 = reference.termsProtocol === 'convenience_return_terms_v2';
  const raw = await nativeAgreement(tx, id, order, (await tx.get(rootRef(id, v2))).data(), v2);
  if (!raw || raw.state !== 'accepted' || raw.proposal.proposalId !== reference.proposalId || raw.contentHash !== reference.contentHash) return null;
  if (options.requireCurrentSource === false) return raw;
  const current = v2 ? await convenienceReturnPolicyTerms(tx, id, order) : convenienceReturnTerms(id, order);
  return current && current.sourceHash === raw.proposal.sourceHash && supportSourceHash(current.terms) === supportSourceHash(raw.proposal.terms) ? raw : null;
}
/** Re-read the seller and buyer command proofs inside the NEW-effect TX. */
export async function readConvenienceReturnAdmission(tx: FirebaseFirestore.Transaction, id: string, order: FirebaseFirestore.DocumentData, reference: ConvenienceReturnReference) {
  return !!await readConvenienceReturnAgreement(tx, id, order, reference);
}
export async function handleConvenienceReturn(request: any) {
  return withPrivateAccountSession(request, () => handlePrivateConvenienceReturn(request));
}
async function handlePrivateConvenienceReturn(request: any) {
  const uid = supportUid(request), input = supportObject(request.data, ['capability', 'expectedUid', 'transactionId', 'mode', 'requestId', 'command']);
  if (input.capability === CONVENIENCE_RETURN_POLICY_CAPABILITY &&
      (input.mode === 'reception_preview' || input.command?.action === 'confirm_return_received')) {
    const {handleConvenienceReturnReception} = await import('./convenienceReturnReception');
    return handleConvenienceReturnReception(request);
  }
  const id = supportId(input.transactionId), mode = input.mode, v2 = input.capability === CONVENIENCE_RETURN_POLICY_CAPABILITY;
  const version = v2 ? 'v2' : 'v1', selectedEffects = v2 ? policyEffects : effects;
  if (![CONVENIENCE_RETURN_CAPABILITY, CONVENIENCE_RETURN_POLICY_CAPABILITY].includes(input.capability) || !['preview', 'execute', 'observe', 'neutralize'].includes(mode))
    throw new HttpsError('invalid-argument', 'Version et action de demande d’accord requises.');
  const c = mode === 'preview' ? null : command(input.command, v2), rid = c ? supportRequestId(input.requestId) : null;
  if (c) {
    const ownReceipt = (await receiptRef(id, uid, rid!, v2).get()).data();
    if (ownReceipt) return receiptView(id, uid, rid!, ownReceipt, c, v2);
    if (mode === 'observe') return receiptView(id, uid, rid!, null, c, v2);
  }
  const caller = resolveCallerKey(request);
  await checkRateLimit(caller.callerKey, caller.isAuthenticated, {functionName: 'convenienceReturn',
    maxCallsAuthenticated: 20, maxCallsUnauthenticated: 0, windowMs: 60_000});
  return db.runTransaction(async tx => {
    await assertPrivateAccountSession(request, tx);
    // Own exact receipt is recoverable even if the order/profile no longer qualifies.
    const rref = c ? receiptRef(id, uid, rid!, v2) : null, old = rref ? (await tx.get(rref)).data() : null;
    if (old) return receiptView(id, uid, rid!, old, c!, v2);
    if (mode === 'observe') return receiptView(id, uid, rid!, null, c!, v2);
    if (mode === 'neutralize') {
      const record = {protocol: `convenience_return_command_${version}`, transactionId: id, ownerId: uid, requestId: rid,
        command: c, payloadHash: supportHash(c), state: 'neutralized', reason: 'owner_neutralized', recordedAt: Timestamp.now()};
      tx.create(rref!, record); return receiptView(id, uid, rid!, record, c!, v2);
    }
    const order = (await tx.get(base(id))).data();
    if (!order || ![order.buyerId, order.sellerId].includes(uid)) throw new HttpsError('permission-denied', 'Commande privée réservée à ses membres.');
    const raw = (await tx.get(rootRef(id, v2))).data(), qualified = raw ? await nativeAgreement(tx, id, order, raw, v2) : null;
    const source = v2 ? await convenienceReturnPolicyTerms(tx, id, order) : convenienceReturnTerms(id, order);
    const sourceMatches = !!source && (!raw || !!qualified && raw.proposal.sourceHash === source.sourceHash &&
      supportSourceHash(raw.proposal.terms) === supportSourceHash(source.terms));
    // New agreements use the priced V2 policy. Existing V1 commands and
    // responses retain their original documentary meaning and receipts.
    const canRequest = v2 && !raw && sourceMatches && openForAgreement(order) && typeof source!.terms.refund === 'object' &&
      source!.terms.refund.maximumRemainingArticleCents > 0;
    const canRespond = !!qualified && raw!.state === 'pending' && sourceMatches;
    if (mode === 'preview') return {protocol: `convenience_return_preview_${version}`, transactionId: id, ownerId: uid,
      role: uid === order.buyerId ? 'buyer' : 'seller', source: source ? {sourceHash: source.sourceHash, version: qualified ? raw!.version : raw ? null : 0} : null,
      state: raw ? qualified ? raw.state : 'unknown' : 'none', sourceCurrentlyMatches: sourceMatches,
      proposal: qualified ? {proposalId: raw!.proposal.proposalId, contentHash: raw!.contentHash, terms: raw!.proposal.terms,
        requestedAt: raw!.proposal.requestedAt.toDate().toISOString(), respondedAt: raw!.response?.recordedAt?.toDate().toISOString() ?? null} : null,
      terms: source?.terms ?? null, canRequest: uid === order.buyerId && canRequest, canRespond: uid === order.sellerId && canRespond, ...selectedEffects};
    const profile = (await tx.get(db.collection('eligibility_profiles').doc(uid))).data();
    await assertAccountSecurityOpen(profile, tx, uid);
    const allowed = c!.action === 'request' ? uid === order.buyerId && canRequest : uid === order.sellerId && canRespond && c!.proposalId === raw!.proposal.proposalId;
    const matches = !!source && c!.sourceHash === source.sourceHash && c!.expectedVersion === (qualified ? raw!.version : raw ? null : 0);
    const now = Timestamp.now(), record = {protocol: `convenience_return_command_${version}`, transactionId: id, ownerId: uid, requestId: rid,
      command: c, payloadHash: supportHash(c), state: allowed && matches ? 'committed' : 'not_executed',
      reason: allowed && matches ? null : !v2 && c!.action === 'request' ? 'priced_policy_v2_required' : 'current_source_or_permission_changed', recordedAt: now};
    const notices = allowed && matches ? await prepareOperationalNotices(tx, [order.buyerId, order.sellerId].map(userId => ({
      eventKey: `convenience_return_${version}:${supportHash([id, uid, rid])}`, userId, type: 'product_review_update',
      title: 'Retour pour changement d’avis', message: c!.action === 'request' ? v2
        ? 'L’acheteur demande un retour d’un article déclaré conforme : retour à sa charge, remboursement prévu du prix de l’article uniquement. Port aller, frais de service et taxes de service exclus. Aucun paiement ni remboursement n’est exécuté.'
        : 'L’acheteur demande votre accord explicite pour un retour d’un article déclaré conforme. Aucun fonds n’est gelé et aucun coût ni remboursement n’est décidé.'
        : c!.action === 'accept' ? v2
          ? 'Le vendeur accepte le retour aux conditions présentées : retour à charge de l’acheteur et prix de l’article uniquement prévu au remboursement. Le financement du retour et l’instruction du remboursement restent distincts ; aucune étiquette n’est achetée.'
          : 'Le vendeur accepte le principe du retour sur le trajet et le colis présentés. Les coûts et le remboursement demandent une instruction distincte ; aucune étiquette n’est achetée.'
          : 'Le vendeur refuse le retour pour simple changement d’avis. Le signalement d’une non-conformité et le support restent accessibles.',
      data: {ownerId: userId, transactionId: id}}))) : null;
    tx.create(rref!, record);
    if (allowed && matches) {
      if (c!.action === 'request') {
        const proposal = {protocol: `convenience_return_proposal_${version}`, transactionId: id, buyerId: order.buyerId, sellerId: order.sellerId,
          proposalId: 'cr_' + supportHash(v2 ? [CONVENIENCE_RETURN_POLICY_CAPABILITY, uid, rid] : [uid, rid]),
          requestId: rid, sourceHash: source!.sourceHash, terms: source!.terms, requestedAt: now};
        tx.create(rootRef(id, v2), {protocol: `convenience_return_${version}`, proposal, contentHash: supportSourceHash(proposal), state: 'pending', version: 1});
      } else tx.update(rootRef(id, v2), {state: c!.action === 'accept' ? 'accepted' : 'refused', version: 2,
        response: {actorId: uid, requestId: rid, recordedAt: now}});
      notices!.commit();
    }
    return receiptView(id, uid, rid!, record, c!, v2);
  });
}
