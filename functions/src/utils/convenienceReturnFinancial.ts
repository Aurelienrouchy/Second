/** The platform purchases a G10 label; its cost is recovered exactly once by
 * withholding it from the gross article refund, never by a second buyer debit. */
import {Timestamp} from 'firebase-admin/firestore';
import {HttpsError} from 'firebase-functions/v2/https';
import {db} from '../config/firebase';
import {supportHash, supportId, supportSourceHash} from './supportRequest';
import type {ShipEngineLabel} from '../config/shipEngine';
import type {ConvenienceReturnReference} from './convenienceReturn';
import {bankDisputeSaleFunds, hasActiveBankDispute} from './bankDispute';

export type ConvenienceReturnCostTerms = {protocol: 'convenience_return_cost_terms_v1'; transactionId: string; buyerId: string; sellerId: string;
  requestId: string; agreement: ConvenienceReturnReference; basisHash: string; cumulativeHash: string; grossArticleCents: number;
  returnLabelCostCents: number; netRefundCents: number; currency: 'CAD'};
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const cents = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const own = (v: any, k: string) => v != null && Object.prototype.hasOwnProperty.call(v, k);
const reject = () => new HttpsError('failed-precondition', 'Le prix de l’article, la réserve et les frais de retour doivent être rapprochés.',
  {reason: 'convenience_return_financing_unqualified', newRefundPermissionGranted: false, labelPurchaseAuthorized: false});
export const costTermsHash = (terms: ConvenienceReturnCostTerms) => supportHash(terms);
export function convenienceReturnActualProofHash(label: ShipEngineLabel): string {
  return supportSourceHash({labelId: label.labelId, shipmentId: label.shipmentId ?? null, carrierId: label.carrierId ?? null,
    carrierCode: label.carrierCode, serviceCode: label.serviceCode ?? null, trackingNumber: label.trackingNumber,
    qualification: label.qualification ?? null});
}
/** Member-readable proof excludes the operator command and every document URL.
 * New financial authority additionally rereads the complete private record. */
export function publicConvenienceReturnCostResolution(raw: any) {
  const d = raw.document, label = d.actualLabel;
  const document = {protocol: d.protocol, transactionId: d.transactionId, resolutionId: d.resolutionId,
    buyerId: d.buyerId, sellerId: d.sellerId, requestId: d.requestId, purchaseExternalId: d.purchaseExternalId,
    financingTermsHash: d.financingTermsHash, actualProofHash: d.actualProofHash,
    actualLabel: {labelId: label.labelId, shipmentId: label.shipmentId, carrierId: label.carrierId,
      carrierCode: label.carrierCode, serviceCode: label.serviceCode, trackingNumber: label.trackingNumber,
      qualification: label.qualification}, originalReservationHash: d.originalReservationHash,
    acceptedCostCents: d.acceptedCostCents, actualCostCents: d.actualCostCents, deductionCents: d.deductionCents,
    grossArticleCents: d.grossArticleCents, netRefundCents: d.netRefundCents, platformVarianceCents: d.platformVarianceCents,
    currency: d.currency, recordedAt: d.recordedAt, documentFurnishing: d.documentFurnishing};
  return {protocol: raw.protocol, document, contentHash: supportSourceHash(document), privateContentHash: raw.contentHash};
}
/** Pure immutable-copy check used by historical label readers. New money also
 * qualifies the private resolution and its operator receipt under TX. */
export function qualifiedConvenienceReturnCostResolution(id: string, order: any) {
  const raw = order.convenienceReturnCostResolution, d = raw?.document, reservation = order.convenienceReturnFinancialReservation;
  const t = reservation?.terms, p = d?.actualLabel?.qualification;
  if (raw?.protocol !== 'convenience_return_cost_resolution_v1' || !d || !hash(raw.privateContentHash) || raw.contentHash !== supportSourceHash(d) ||
      d.protocol !== 'convenience_return_cost_resolution_document_v1' || d.transactionId !== id || d.buyerId !== order.buyerId ||
      d.sellerId !== order.sellerId || !qualifiedConvenienceReturnCostTerms(t) || d.financingTermsHash !== reservation.termsHash ||
      d.requestId !== t.requestId || d.requestId !== order.returnRequest?.requestId || d.purchaseExternalId !== order.returnRequest?.purchaseExternalId ||
      !hash(d.actualProofHash) || d.actualProofHash !== convenienceReturnActualProofHash(d.actualLabel) ||
      !(d.recordedAt instanceof Timestamp) || d.recordedAt.toMillis() < 1 || d.recordedAt.toMillis() > Date.now() ||
      p?.currency !== 'CAD' || ![p.totalCents, p.shipmentCents, p.insuranceCents].every(cents) || p.totalCents !== p.shipmentCents + p.insuranceCents ||
      d.acceptedCostCents !== t.returnLabelCostCents || d.actualCostCents !== p.totalCents || d.grossArticleCents !== t.grossArticleCents ||
      d.deductionCents !== Math.min(t.returnLabelCostCents, p.totalCents) || d.netRefundCents !== t.grossArticleCents - d.deductionCents ||
      d.platformVarianceCents !== p.totalCents - d.deductionCents || d.currency !== 'CAD' ||
      d.originalReservationHash !== supportSourceHash({...reservation, consumedByRefundIntentId: null})) return null;
  return raw;
}
export function convenienceReturnCostResolutionSummary(raw: any) {
  const d = raw.document;
  return {kind: 'variance_adopted' as const, resolutionId: d.resolutionId, financingTermsHash: d.financingTermsHash,
    actualProofHash: d.actualProofHash, acceptedCostCents: d.acceptedCostCents, actualCostCents: d.actualCostCents,
    deductionCents: d.deductionCents, grossArticleCents: d.grossArticleCents, netRefundCents: d.netRefundCents,
    platformVarianceCents: d.platformVarianceCents, currency: 'CAD' as const};
}
export function qualifiedConvenienceReturnCostTerms(raw: any): raw is ConvenienceReturnCostTerms {
  if (!raw || Object.keys(raw).sort().join(',') !== ['protocol', 'transactionId', 'buyerId', 'sellerId', 'requestId', 'agreement', 'basisHash',
    'cumulativeHash', 'grossArticleCents', 'returnLabelCostCents', 'netRefundCents', 'currency'].sort().join(',')) return false;
  try {return raw.protocol === 'convenience_return_cost_terms_v1' && raw.currency === 'CAD' && !!supportId(raw.transactionId) &&
    !!supportId(raw.buyerId) && !!supportId(raw.sellerId) && raw.buyerId !== raw.sellerId && !!supportId(raw.requestId) &&
    raw.agreement?.termsProtocol === 'convenience_return_terms_v2' && /^cr_[a-f0-9]{64}$/.test(raw.agreement.proposalId ?? '') &&
    hash(raw.agreement.contentHash) && Object.keys(raw.agreement).sort().join(',') === 'contentHash,proposalId,termsProtocol' &&
    hash(raw.basisHash) && hash(raw.cumulativeHash) && [raw.grossArticleCents, raw.returnLabelCostCents, raw.netRefundCents].every(cents) &&
    raw.grossArticleCents > raw.returnLabelCostCents && raw.netRefundCents === raw.grossArticleCents - raw.returnLabelCostCents;
  } catch {return false;}
}
/** A proposal is not collateral. Every NEW purchase must be wholly covered by
 * this sale's still-held funds AND the actual wallet bucket under the same TX. */
async function heldCoverage(tx: FirebaseFirestore.Transaction, id: string, order: any, gross: number) {
  if (order.fundsReleasedAt != null || order.fundsReleaseAt == null || hasActiveBankDispute(order) || order.bankDispute != null ||
      order.refund != null || order.refundedAt != null || order.refundBlocked === true || order.buyerReport != null ||
      order.returnEscalatedAt != null || order.disputed === true && order.returnRequest?.reason !== 'change_of_mind') throw reject();
  const ref = db.collection('wallets').doc(order.sellerId), wallet = (await tx.get(ref)).data();
  const {readSellerAllocationConsumption} = await import('./refundAllocation');
  const funds = await bankDisputeSaleFunds(tx, ref, order, id), consumed = await readSellerAllocationConsumption(tx, id, order);
  const ledger = await tx.get(ref.collection('ledger').where('transactionId', '==', id).limit(101));
  const moves = ledger.docs.filter(row => row.data().type === 'funds_held').map(row => row.data());
  const moved = moves.reduce((n, row) => n + (cents(row.amount) ? row.amount : NaN), 0);
  if (!wallet || typeof wallet.currency !== 'string' || wallet.currency.toUpperCase() !== 'CAD' || !cents(wallet.heldBalance) || wallet.heldBalance < gross ||
      ledger.size >= 101 || moves.length === 0 || moves.some(row => row.transactionId !== id || !(row.createdAt instanceof Timestamp) ||
        row.createdAt.toMillis() < 1 || row.createdAt.toMillis() > Date.now()) || !cents(moved) || moved - consumed.heldCents < gross ||
      funds.heldCents - consumed.heldCents < gross) throw reject();
}
export async function readConvenienceReturnCostQuote(tx: FirebaseFirestore.Transaction, id: string, order: any,
  input: {requestId: string; agreement: ConvenienceReturnReference; costCents: number}) {
  if (own(order, 'convenienceReturnFinancialReservation') || !cents(input.costCents) ||
      input.agreement.termsProtocol !== 'convenience_return_terms_v2') throw reject();
  const {readRefundAllocationSource} = await import('./refundAllocation');
  const {readConvenienceReturnAgreement} = await import('./convenienceReturn');
  if (!await readConvenienceReturnAgreement(tx, id, order, input.agreement, {requireCurrentSource: false})) throw reject();
  const source = await readRefundAllocationSource(tx, id, order), gross = source.remaining.articleCents;
  if (gross < 1 || input.costCents >= gross || source.remainingSellerCents < gross ||
      source.remainingCardCents + source.remainingWalletCents < gross - input.costCents) throw reject();
  await heldCoverage(tx, id, order, gross);
  const terms: ConvenienceReturnCostTerms = {protocol: 'convenience_return_cost_terms_v1', transactionId: id, buyerId: order.buyerId,
    sellerId: order.sellerId, requestId: supportId(input.requestId), agreement: input.agreement, basisHash: source.basisHash,
    cumulativeHash: source.cumulativeHash, grossArticleCents: gross, returnLabelCostCents: input.costCents,
    netRefundCents: gross - input.costCents, currency: 'CAD'};
  if (!qualifiedConvenienceReturnCostTerms(terms)) throw reject();
  return terms;
}
/** Prepare all reads before returning a mutation; callers commit it atomically
 * with the sole label purchase authorization, before any provider I/O. */
export async function prepareConvenienceReturnCostReservation(tx: FirebaseFirestore.Transaction, id: string, order: any,
  terms: ConvenienceReturnCostTerms, expectedTermsHash: string) {
  if (!qualifiedConvenienceReturnCostTerms(terms) || costTermsHash(terms) !== expectedTermsHash) throw reject();
  const fresh = await readConvenienceReturnCostQuote(tx, id, order,
    {requestId: terms.requestId, agreement: terms.agreement, costCents: terms.returnLabelCostCents});
  if (costTermsHash(fresh) !== expectedTermsHash) throw reject();
  const record = {protocol: 'convenience_return_financing_v1', terms, termsHash: expectedTermsHash,
    reservedAt: Timestamp.now(), consumedByRefundIntentId: null};
  return {record, commit: () => tx.update(db.collection('transactions').doc(id), {convenienceReturnFinancialReservation: record})};
}
/** Qualified historical reservation; it is neither a paid-label receipt nor a
 * permission for a new refund. Unknown/void labels retain the reserved budget. */
export async function readConvenienceReturnFinancing(tx: FirebaseFirestore.Transaction, id: string, order: any) {
  const r = order.convenienceReturnFinancialReservation, t = r?.terms;
  if (r?.protocol !== 'convenience_return_financing_v1' || !qualifiedConvenienceReturnCostTerms(t) || t.transactionId !== id ||
      t.buyerId !== order.buyerId || t.sellerId !== order.sellerId || r.termsHash !== costTermsHash(t) ||
      !(r.reservedAt instanceof Timestamp) || r.reservedAt.toMillis() < 1 || r.reservedAt.toMillis() > Date.now() ||
      r.consumedByRefundIntentId !== null && (typeof r.consumedByRefundIntentId !== 'string' || !r.consumedByRefundIntentId || r.consumedByRefundIntentId.includes('/'))) return null;
  const {readConvenienceReturnAgreement} = await import('./convenienceReturn');
  if (!await readConvenienceReturnAgreement(tx, id, order, t.agreement, {requireCurrentSource: false})) return null;
  const request = order.returnRequest;
  if (!request || request.reason !== 'change_of_mind' || request.requestId !== t.requestId ||
      request.quote?.convenienceReturnFinancialTermsHash !== r.termsHash ||
      !qualifiedConvenienceReturnCostTerms(request.quote?.convenienceReturnFinancialTerms) ||
      costTermsHash(request.quote?.convenienceReturnFinancialTerms) !== r.termsHash ||
      request.acceptance?.convenienceReturnFinancialTermsHash !== r.termsHash || request.quote?.expectedCostCents !== t.returnLabelCostCents) return null;
  return r as {protocol: 'convenience_return_financing_v1'; terms: ConvenienceReturnCostTerms; termsHash: string;
    reservedAt: Timestamp; consumedByRefundIntentId: string | null};
}
export async function readEffectiveConvenienceReturnFinancing(tx: FirebaseFirestore.Transaction, id: string, order: any) {
  const reservation = await readConvenienceReturnFinancing(tx, id, order);
  if (!reservation) return null;
  let resolution = null;
  if (own(order, 'convenienceReturnCostResolution')) {
    const {readConvenienceReturnCostResolution} = await import('./convenienceReturnIncident');
    resolution = await readConvenienceReturnCostResolution(tx, id, order);
    if (!resolution) return null;
  }
  const terms = resolution ? {...reservation.terms, returnLabelCostCents: resolution.document.deductionCents,
    netRefundCents: resolution.document.netRefundCents} : reservation.terms;
  return {reservation, originalTerms: reservation.terms, terms, termsHash: reservation.termsHash,
    consumedByRefundIntentId: reservation.consumedByRefundIntentId,
    costResolution: resolution ? convenienceReturnCostResolutionSummary(resolution) : null};
}
