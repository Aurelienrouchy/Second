import { FinancialRecoveryBlocked } from "./financialRecoveryInterlock";
import { financialRecoverySourceFields, financialRecoveryCommitCheckpoint } from "./financialRecoverySources";
/** Repair of a reserved purchase-refund CARD obligation. Never writes wallets,
 * seller debt, inventory, allocation budgets or the original provider identity. */
import {Timestamp} from 'firebase-admin/firestore';
import {HttpsError} from 'firebase-functions/v2/https';
import {db,storage} from '../config/firebase';
import {createHash} from 'node:crypto';
import {createRecoveryEvidence,readFinancialRecoveryControl,readFinancialRecoveryIdentityClaim,readFinancialRecoveryPinnedObject,
  recoveryInstallation} from '../config/recoveryControl';
import {MANUAL_REFUND_CAPABILITY,MANUAL_REFUND_ATTESTATION,MANUAL_REFUND_EFFECTS,manualId,manualEvidenceId,
  manualObligationHash,manualEvidenceContent,qualifiedManualEvidence,manualEvidenceReference,manualReferenceMatches,
  qualifiedManualCommand,qualifiedManualRefundSettlement} from './manualRefundSettlement';
import {getStripe} from '../config/stripe';
import {supportUid, supportId, supportAccountUid, supportObject, supportHash, supportSourceHash, supportRevision, supportRequestId,
  supportCurrentAdminSession, supportAdmin} from './supportRequest';
import {assertAccountSecurityOpen, assertRecentAccountAuthentication} from './eligibility';
import {hasActiveBankDispute} from './bankDispute';
import {fraudReviewAllowsProgress} from './fraudReviewDecision';
import {readRefundAllocationSource, refundAllocationRef, refundHistoryRef, readAllocationHistoryIntent,
  allocationLocalMovementsVerified, parsePurchaseRefundTerms} from './refundAllocation';
import {prepareOperationalNotices} from './notifications';
import {refundResult, type IssueRefundResult} from './refundState';
import {preparePurchasePlatformAccounting} from './refundAccounting';
import {prepareSellerTaxFinancialEvent,sellerTaxFinancialOrderAfter} from './sellerTaxLedger';

export const PURCHASE_REFUND_REPAIR_ENABLED: boolean = true;
export const purchaseRefundRepairModes = ['purchase_refund_repair_source_observe', 'purchase_refund_repair_preview', 'purchase_refund_repair_command',
  'purchase_refund_manual_evidence_upload','purchase_refund_manual_evidence_read'];
const native = (v: any): v is Timestamp => v instanceof Timestamp && v.toMillis() > 0 && v.toMillis() <= Date.now();
const cents = (v: any): v is number => Number.isSafeInteger(v) && v >= 0;
const hash = (v: any): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const sid = (v: any) => typeof v === 'string' ? v : typeof v?.id === 'string' ? v.id : null;
const own = (v: any, k: string) => v != null && Object.prototype.hasOwnProperty.call(v, k);
const ref = (id: string) => db.collection('transactions').doc(id);
const repairs = (id: string) => ref(id).collection('refund_repairs');
const receiptRef = (id: string, uid: string, requestId: string) => ref(id).collection('refund_repair_commands').doc(supportHash([uid, requestId]));
const previewRef = (id: string, previewId: string) => ref(id).collection('refund_repair_previews').doc(previewId);
const effects = {walletCreditAuthorized: false, sellerDebitAuthorized: false, newReserveAuthorized: false,
  inventoryPermissionGranted: false, shippingPermissionGranted: false, bankArrivalVerified: false, externalPaymentAuthorized: false} as const;
type Command = {transactionId: string; refundIntentId: string; action: 'repair_original_method' | 'record_external_instruction';
  previewId: string; sourceHash: string; sourceRevision: string; terminalRefundId: string; terminalAttemptId: string;
  amountCents: number; currency: 'CAD'; note: string; partyMessage: string; acknowledged: true};
type ProviderRefund = {id: string; paymentIntentId: string | null; chargeId: string | null; amountCents: number;
  currency: string; status: string | null; failureReason: string | null; failureBalanceTransactionId: string | null;
  failureFundsReturnedToStripe: boolean};
type Provider = {qualification: 'current_original_method_capacity' | 'unknown'; reason: string | null;
  paymentIntentId: string; chargeId: string; amountCapturedCents: number | null; amountRefundedCents: number | null;
  capacityCents: number | null; refunds: ProviderRefund[]; proofHash: string; observedAt: Timestamp};
type Binding = {refundId: string; intentId: string; attemptId: string; amountCents: number; repairId: string | null};
function parseCommand(value: unknown): Command {
  const d = supportObject(value, ['transactionId', 'refundIntentId', 'action', 'previewId', 'sourceHash', 'sourceRevision',
    'terminalRefundId', 'terminalAttemptId', 'amountCents', 'currency', 'note', 'partyMessage', 'acknowledged']);
  if (!['repair_original_method', 'record_external_instruction'].includes(d.action) || !hash(d.previewId) || !hash(d.sourceHash) ||
      typeof d.sourceRevision !== 'string' || !/^\d+:\d+$/.test(d.sourceRevision) || !/^re_[A-Za-z0-9]+$/.test(d.terminalRefundId ?? '') ||
      !cents(d.amountCents) || d.amountCents < 1 || d.currency !== 'CAD' || d.acknowledged !== true ||
      typeof d.note !== 'string' || !d.note.trim() || d.note.length > 2000 || typeof d.partyMessage !== 'string' ||
      !d.partyMessage.trim() || d.partyMessage.length > 2000) throw new HttpsError('invalid-argument', 'Instruction de réparation et sources exactes requises.');
  return {...d, transactionId: supportId(d.transactionId), refundIntentId: supportId(d.refundIntentId),
    terminalAttemptId: supportId(d.terminalAttemptId), note: d.note.trim(), partyMessage: d.partyMessage.trim()} as Command;
}
function providerRefund(r: any): ProviderRefund | null {
  if (r?.object !== 'refund' || !/^re_[A-Za-z0-9]+$/.test(r.id ?? '') || !cents(r.amount) || r.amount < 1 || r.currency !== 'cad' ||
      !['pending', 'requires_action', 'succeeded', 'failed', 'canceled'].includes(r.status)) return null;
  return {id: r.id, paymentIntentId: sid(r.payment_intent), chargeId: sid(r.charge), amountCents: r.amount, currency: r.currency,
    status: r.status, failureReason: typeof r.failure_reason === 'string' ? r.failure_reason : null,
    failureBalanceTransactionId: sid(r.failure_balance_transaction), failureFundsReturnedToStripe: false};
}
async function observeProvider(paymentIntentId: string, chargeId: string, captured: number, bindings: Binding[]): Promise<Provider> {
  const unknown = (reason: string): Provider => ({qualification: 'unknown', reason, paymentIntentId, chargeId,
    amountCapturedCents: null, amountRefundedCents: null, capacityCents: null, refunds: [],
    proofHash: supportHash([paymentIntentId, chargeId, 'unknown', reason]), observedAt: Timestamp.now()});
  const stripe = getStripe(); if (!stripe) return unknown('provider_unavailable');
  try {
    const [pi, charge] = await Promise.all([stripe.paymentIntents.retrieve(paymentIntentId), stripe.charges.retrieve(chargeId)]);
    if (pi.id !== paymentIntentId || pi.status !== 'succeeded' || pi.currency !== 'cad' || pi.amount_received !== captured ||
        sid(pi.latest_charge) !== chargeId || charge.id !== chargeId || sid(charge.payment_intent) !== paymentIntentId ||
        charge.currency !== 'cad' || charge.status !== 'succeeded' || charge.paid !== true || charge.captured !== true || charge.disputed !== false ||
        charge.payment_method_details?.type !== 'card' || charge.amount_captured !== captured || !cents(charge.amount_refunded) ||
        charge.amount_refunded > captured) return unknown('original_method_source_unqualified');
    const rows: ProviderRefund[] = []; let after: string | undefined, complete = false;
    for (let page = 0; page < 3; page++) {
      const found = await stripe.refunds.list({charge: chargeId, limit: 100, ...(after ? {starting_after: after} : {})});
      for (const candidate of found.data) {
        // Exact GET, not a possibly earlier paginated listing observation.
        const current = await stripe.refunds.retrieve(candidate.id), r = providerRefund(current);
        const binding = bindings.find(b => b.refundId === candidate.id);
        if (!r || r.paymentIntentId !== paymentIntentId || r.chargeId !== chargeId || !binding || r.amountCents !== binding.amountCents)
          return unknown('refund_history_unqualified');
        if (['failed', 'canceled'].includes(r.status!)) {
          if (!/^txn_[A-Za-z0-9]+$/.test(r.failureBalanceTransactionId ?? '')) return unknown('failure_return_to_stripe_unknown');
          const movement = await stripe.balanceTransactions.retrieve(r.failureBalanceTransactionId!);
          r.failureFundsReturnedToStripe = movement.id === r.failureBalanceTransactionId && movement.object === 'balance_transaction' &&
            movement.currency === 'cad' && movement.amount === r.amountCents && sid(movement.source) === r.id && movement.type === 'refund_failure';
          if (!r.failureFundsReturnedToStripe) return unknown('failure_return_to_stripe_unknown');
        }
        rows.push(r);
      }
      if (!found.has_more) {complete = true; break;}
      if (!found.data.length) return unknown('refund_history_unqualified'); after = found.data[found.data.length - 1].id;
    }
    if (!complete || new Set(rows.map(r => r.id)).size !== rows.length || bindings.some(b => !rows.some(r => r.id === b.refundId)))
      return unknown('refund_history_incomplete');
    const occupied = rows.filter(r => !['failed', 'canceled'].includes(r.status!)).reduce((n, r) => n + r.amountCents, 0);
    if (!cents(occupied) || occupied > captured || rows.filter(r => r.status === 'succeeded').reduce((n, r) => n + r.amountCents, 0) !== charge.amount_refunded)
      return unknown('refund_capacity_unqualified');
    const body = {paymentIntentId, chargeId, amountCapturedCents: captured, amountRefundedCents: charge.amount_refunded,
      capacityCents: captured - occupied, refunds: rows.sort((a, b) => a.id.localeCompare(b.id))};
    return {qualification: 'current_original_method_capacity', reason: null, ...body, proofHash: supportHash(body), observedAt: Timestamp.now()};
  } catch (recoveryFailure) {
      if (recoveryFailure instanceof FinancialRecoveryBlocked) throw recoveryFailure;return unknown('provider_observation_unknown');}
}
function qualifiedRepairRecord(r: any, id: string, order: any) {
  return r?.protocol === 'purchase_refund_repair_record_v1' && r.transactionId === id && r.buyerId === order.buyerId && r.sellerId === order.sellerId &&
    /^rr_[a-f0-9]{64}$/.test(r.repairId ?? '') && r.commandHash === supportHash(r.command) && r.command?.action === 'repair_original_method' &&
    r.refundIntentId === r.command.refundIntentId && r.amountCents === r.command.amountCents && r.currency === 'CAD' &&
    r.idempotencyKey === `rf_repair_${r.repairId}` && supportId(r.attemptId) && native(r.reservedAt) &&
    r.reservationAuthority?.privateRoleAtCommit === true && Number.isSafeInteger(r.reservationAuthority.authTime) &&
    r.reservationAuthority.authTime > 0 && r.reservationAuthority.authTime * 1000 <= r.reservedAt.toMillis() &&
    r.reservedAt.toMillis() - r.reservationAuthority.authTime * 1000 <= 300_000;
}
async function source(tx: FirebaseFirestore.Transaction, id: string, order: any, intentId: string, omitRepairId?: string) {
  const historical = order.refund?.intentId !== intentId;
  const intent = historical ? await readAllocationHistoryIntent(tx, id, order, intentId) : order.refund;
  if (!intent?.allocation || intent.intentId !== intentId || intent.buyerId !== order.buyerId || intent.sellerId !== order.sellerId ||
      intent.currency !== 'cad' || !/^pi_[A-Za-z0-9]+$/.test(intent.paymentIntentId ?? '') || intent.paymentIntentId !== order.stripePaymentIntentId ||
      !/^ch_[A-Za-z0-9]+$/.test(order.stripeChargeId ?? '') || !/^re_[A-Za-z0-9]+$/.test(intent.stripeRefundId ?? '') ||
      !supportId(intent.attemptId) || !cents(intent.cardAmountCents) || intent.cardAmountCents < 1 || !native(intent.requestedAt) ||
      intent.previousRefundIds != null && (!Array.isArray(intent.previousRefundIds) || intent.previousRefundIds.length > 0) ||
      intent.legacyApplied || intent.legacyReconciliationRequired || !cents(intent.walletAmountCents) || !cents(intent.sellerDebitCents))
    throw new HttpsError('failed-precondition', 'Obligation native inconnue.', {reason: 'repair_native_source_unknown'});
  const allocation = (await tx.get(refundAllocationRef(id, intentId))).data();
  const terms = parsePurchaseRefundTerms(allocation?.terms);
  if (allocation?.protocol !== 'purchase_refund_allocation_record_v1' || allocation.transactionId !== id || allocation.refundIntentId !== intentId ||
      allocation.buyerId !== order.buyerId || allocation.sellerId !== order.sellerId || !native(allocation.reservedAt) ||
      allocation.reservationHash !== intent.allocation.reservationHash || allocation.reservationHash !== supportSourceHash(allocation.reservation) ||
      allocation.reservation.termsHash !== supportHash(terms) || allocation.reservationHash !== intent.allocation.reservationHash ||
      terms.cardCents !== intent.cardAmountCents || terms.walletCents !== intent.walletAmountCents || terms.sellerDebitCents !== intent.sellerDebitCents)
    throw new HttpsError('failed-precondition', 'Réservation initiale inconnue.', {reason: 'repair_native_source_unknown'});
  // The review flag remains an independent obligation. It is ignored only for
  // reading initial amounts, never cleared or used as a NEW financial permit.
  const money = await readRefundAllocationSource(tx, id, {...order, refundAllocationState: {...order.refundAllocationState, reviewRequired: false}});
  const entries = await tx.get(repairs(id).orderBy('__name__').limit(21));
  const valid = entries.size < 21 && entries.docs.every(row => qualifiedRepairRecord(row.data(), id, order));
  const all = entries.docs.map(row => row.data()), target = all.filter(r => r.refundIntentId === intentId).sort((a, b) => a.ordinal - b.ordinal);
  const bindings: Binding[] = [];
  const nativeAllocations: Array<{record: any; intent: any}> = [];
  for (const row of money.rows.docs) {
    const current = row.id === order.refund?.intentId ? order.refund : await readAllocationHistoryIntent(tx, id, order, row.id);
    if (!current || current.cardAmountCents > 0 && !/^re_[A-Za-z0-9]+$/.test(current.stripeRefundId ?? ''))
      throw new HttpsError('failed-precondition', 'Historique financier incomplet.', {reason: 'repair_native_source_unknown'});
    if (current.cardAmountCents > 0) bindings.push({refundId: current.stripeRefundId, intentId: row.id, attemptId: current.attemptId,
      amountCents: current.cardAmountCents, repairId: null});
    nativeAllocations.push({record: row.data(), intent: current});
  }
  for (const r of all) if (r.providerRefundId) bindings.push({refundId: r.providerRefundId, intentId: r.refundIntentId,
    attemptId: r.attemptId, amountCents: r.amountCents, repairId: r.repairId});
  const localVerified = await allocationLocalMovementsVerified(tx, id, order, intent, allocation) && cents(allocation.settlement?.debtCents);
  const claims = await tx.get(db.collection('disputes').where('transactionId', '==', id).limit(101));
  const blocked = hasActiveBankDispute(order) || order.refundedVia === 'chargeback' || order.disputeOutcome === 'lost';
  const riskClear = await fraudReviewAllowsProgress(tx, id, order);
  const complete = valid && claims.size < 101 && new Set(bindings.map(b => b.refundId)).size === bindings.length &&
    target.every((r, n) => r.ordinal === n + 1 && r.command.terminalRefundId ===
      (target.slice(0, n).filter(prior => prior.state !== 'not_executed').at(-1)?.providerRefundId ?? intent.stripeRefundId));
  if (!complete) throw new HttpsError('failed-precondition', 'Historique des tentatives incomplet.', {reason: 'repair_native_source_unknown'});
  const omitted = omitRepairId ? all.find(r => r.repairId === omitRepairId) : null;
  const examinedOrder = {...order};
  if (omitted && order.purchaseRefundRepairContext?.repairId === omitRepairId) {
    if (omitted.previousContext.present) examinedOrder.purchaseRefundRepairContext = omitted.previousContext.value;
    else delete examinedOrder.purchaseRefundRepairContext;
    examinedOrder.refund = {...order.refund};
    if (omitted.previousWatch.present) examinedOrder.refund.watch = omitted.previousWatch.value;
    else delete examinedOrder.refund.watch;
  }
  const examinedIntent = !historical && omitted ? examinedOrder.refund : intent;
  const sourceHash = supportSourceHash({order: examinedOrder, intent: examinedIntent, allocation, repairs: entries.docs.filter(r => r.id !== omitRepairId).map(r => [r.id, r.data()]),
    basisHash: money.basisHash, cumulativeHash: money.cumulativeHash,
    buyer: money.buyerRows.docs.map(r => [r.id, r.data()]), seller: money.sellerRows.docs.map(r => [r.id, r.data()]),
    claims: claims.docs.map(r => [r.id, r.data()]), riskClear});
  return {intent, allocation, terms, historical, money, all, target, bindings, localVerified, complete, blocked, riskClear, sourceHash, nativeAllocations, claims, bankHistoryPresent:['bankDispute','disputeId','disputeClosedAt','disputeOutcome','bankRefundReconciliation'].some(k=>own(order,k))};
}
function publicSource(s: Awaited<ReturnType<typeof source>>, id: string, revision: string | null, p: Provider | null) {
  const targetIds = new Set([s.intent.stripeRefundId, ...s.target.map(r => r.providerRefundId).filter(Boolean)]);
  const target = p?.refunds.filter(r => targetIds.has(r.id)) ?? [];
  const paid = target.filter(r => r.status === 'succeeded').reduce((n, r) => n + r.amountCents, 0);
  const known = s.complete && p?.qualification === 'current_original_method_capacity' && paid <= s.intent.cardAmountCents;
  const active = s.target.filter(r => r.state !== 'not_executed'), last = active[active.length - 1];
  const terminalRefundId = last ? last.providerRefundId ?? null : s.intent.stripeRefundId;
  const terminal = target.find(r => r.id === terminalRefundId);
  const canRepair = !!known && s.localVerified && s.all.length < 20 && !s.blocked && s.riskClear && !!terminal &&
    s.intent.manualBankSettlement==null &&
    ['failed', 'canceled'].includes(s.intent.providerStatus) && ['failed', 'canceled'].includes(terminal.status!) &&
    terminal.failureFundsReturnedToStripe && target.every(r => ['failed', 'canceled'].includes(r.status!)) &&
    active.every(r => r.providerRefundId && ['failed', 'canceled'].includes(r.providerStatus)) && p!.capacityCents! >= s.intent.cardAmountCents;
  return {protocol: 'purchase_refund_repair_source_v1', transactionId: id, refundIntentId: s.intent.intentId, sourceRevision: revision,
    sourceHash: s.sourceHash, qualification: s.complete ? 'native_reserved_obligation' : 'unknown',
    historical: s.historical, refundAttemptId: s.intent.attemptId, originalRefundId: s.intent.stripeRefundId, paymentIntentId: s.intent.paymentIntentId,
    allocation: {refundIntentId: s.intent.intentId, reservationHash: s.allocation.reservationHash,
      basisHash: s.allocation.basisHash, termsHash: s.allocation.reservation.termsHash, terms: s.terms},
    currency: 'CAD', obligationCardCents: s.intent.cardAmountCents, remainingCardCents: known ? s.intent.cardAmountCents - paid : null,
    cardAmountQualification: known ? 'current_provider_set' : 'unknown', localMovementsVerified: s.localVerified,
    localWalletCreditCents: s.localVerified ? s.intent.walletAmountCents : null, localSellerDebitCents: s.localVerified ? s.intent.sellerDebitCents : null,
    localSellerDebtCents: s.localVerified && cents(s.allocation.settlement.debtCents) ? s.allocation.settlement.debtCents : null,
    localReconciliationRequired: !s.localVerified, originalReservationPreserved: true,
    bankReviewRequired: s.blocked, riskReviewRequired: !s.riskClear, historyComplete: s.complete,
    terminalRefundId, terminalAttemptId: last?.attemptId ?? s.intent.attemptId,
    provider: p ? {...p, observedAt: p.observedAt.toDate().toISOString()} : null,
    repairHistory: s.target.map(r => ({repairId: r.repairId, ordinal: r.ordinal, providerRefundId: r.providerRefundId,
      providerStatus: r.providerStatus, state: r.state, amountCents: r.amountCents, reservedAt: r.reservedAt.toDate().toISOString(),
      observedAt: native(r.observedAt) ? r.observedAt.toDate().toISOString() : null})),
    canRepairOriginalMethodNow: canRepair, canRecordExternalInstructionNow: p !== null && s.complete, externalChannelQualification: 'not_defined', ...effects};
}
function receiptView(r: any, record: any = null) {
  const refusal = r.state === 'reserved' && record?.state === 'not_executed' && record.commandHash === r.payloadHash &&
    record.providerRefundId === null && record.externalAttemptedAtMs === null && typeof record.newEffectRefusedReason === 'string';
  const financial = record && record.repairId === r.repairId && record.commandHash === r.payloadHash && native(record.reservedAt)
    ? {repairId: record.repairId, attemptId: record.attemptId, refundId: record.providerRefundId,
      state: record.state, providerStatus: record.providerStatus, amountCents: record.amountCents,
      cardRepairedCents: record.cardRepairedCents ?? null, observedAt: native(record.observedAt) ? record.observedAt.toDate().toISOString() : null,
      bankArrivalVerified: false, localMovementsRepeated: false} : null;
  return {protocol: 'purchase_refund_repair_command_v1', actorId: r.actorId, requestId: r.requestId, command: r.command,
    payloadHash: r.payloadHash, state: refusal ? 'not_executed' : r.state, reason: refusal ? record.newEffectRefusedReason : r.reason, repairId: r.repairId,
    recordedAt: native(r.recordedAt) ? r.recordedAt.toDate().toISOString() : null, financial, ...effects};
}
async function ownReceipt(tx: FirebaseFirestore.Transaction, uid: string, requestId: string, command: Command) {
  const r = (await tx.get(receiptRef(command.transactionId, uid, requestId))).data();
  if (!r) return null;
  if (r.protocol !== 'purchase_refund_repair_command_v1' || r.actorId !== uid || r.requestId !== requestId || r.payloadHash !== supportHash(command) ||
      supportHash(r.command) !== r.payloadHash || !native(r.recordedAt) || !['reserved', 'committed', 'not_executed'].includes(r.state))
    throw new HttpsError('already-exists', 'Reçu de réparation différent ou mal qualifié.');
  const record = r.repairId ? (await tx.get(repairs(command.transactionId).doc(r.repairId))).data() : null;
  return {receipt: r, record, view: receiptView(r, record)};
}
async function operator(tx: FirebaseFirestore.Transaction, request: any) {
  await supportCurrentAdminSession(request);
  assertRecentAccountAuthentication(request.auth.token);
  // Private native role, not an old token claim, is required for NEW money.
  const [user, security] = await tx.getAll(db.collection('users').doc(request.auth.uid), db.collection('eligibility_profiles').doc(request.auth.uid));
  const privateUser = user.data();
  if (privateUser?.isAdmin !== true || own(privateUser, 'isActive') && privateUser.isActive !== true)
    throw new HttpsError('permission-denied', 'Rôle privé d’opérateur requis.');
  await assertAccountSecurityOpen(security.data(), tx, request.auth.uid);
}
async function load(id: string, intentId: string) {
  return db.runTransaction(async tx => {const snap = await tx.get(ref(id)), order = snap.data();
    if (!order) throw new HttpsError('not-found', 'Commande introuvable.');
    return {order, revision: supportRevision(snap), s: await source(tx, id, order, intentId)};});
}
/** SDK servicing is GET-only. Metadata can locate ONLY this previously reserved
 * native attempt; a lookup miss is never financial absence or a new POST right. */
async function observeRepairProvider(s: Awaited<ReturnType<typeof source>>, record: any): Promise<Provider> {
  const stripe = getStripe();
  if (stripe && !record.providerRefundId) {
    try {
      let after: string | undefined, found: any = null, complete = false;
      for (let page = 0; page < 3; page++) {
        const list = await stripe.refunds.list({payment_intent: s.intent.paymentIntentId, limit: 100, ...(after ? {starting_after: after} : {})});
        for (const r of list.data) if (r.metadata?.refundRepairId === record.repairId && r.metadata?.refundIntentId === record.refundIntentId &&
            r.metadata?.refundAttemptId === record.attemptId && r.metadata?.transactionId === record.transactionId) {
          if (found) throw new Error('Ambiguous repair'); found = r;
        }
        if (!list.has_more) {complete = true; break;}
        if (!list.data.length) throw new Error('Unknown pagination'); after = list.data[list.data.length - 1].id;
      }
      if (!complete) throw new Error('Incomplete repair lookup');
      if (found) {
        const exact = await stripe.refunds.retrieve(found.id), r = providerRefund(exact);
        if (!r || r.amountCents !== record.amountCents || r.paymentIntentId !== s.intent.paymentIntentId || r.chargeId !== record.chargeId ||
            exact.metadata?.refundRepairId !== record.repairId || exact.metadata?.refundIntentId !== record.refundIntentId ||
            exact.metadata?.refundAttemptId !== record.attemptId || exact.metadata?.transactionId !== record.transactionId)
          throw new Error('Unknown repair binding');
        // Preserve the genuine identity even when the wider capacity/bank
        // observation is unknown. It cannot become a first POST permission.
        await db.runTransaction(async tx => {const current = (await tx.get(repairs(record.transactionId).doc(record.repairId))).data();
          if (!current || current.commandHash !== record.commandHash || current.providerRefundId && current.providerRefundId !== r.id)
            throw new HttpsError('failed-precondition', 'Identité de réparation divergente.');
          if (!current.providerRefundId) tx.update(repairs(record.transactionId).doc(record.repairId), await financialRecoverySourceFields('refund_repair',repairs(record.transactionId).doc(record.repairId),current!,{providerRefundId: r.id}));
        });
        record.providerRefundId = r.id;
        return observeProvider(s.intent.paymentIntentId, record.chargeId, s.intent.capturedCardCents,
          [...s.bindings, {refundId: r.id, intentId: record.refundIntentId, attemptId: record.attemptId, amountCents: record.amountCents, repairId: record.repairId}]);
      }
    } catch (recoveryFailure) {
      if (recoveryFailure instanceof FinancialRecoveryBlocked) throw recoveryFailure;return {qualification: 'unknown', reason: 'repair_lookup_unknown', paymentIntentId: s.intent.paymentIntentId,
      chargeId: record.chargeId, amountCapturedCents: null, amountRefundedCents: null, capacityCents: null, refunds: [],
      proofHash: supportHash([record.repairId, 'unknown']), observedAt: Timestamp.now()};}
  }
  return observeProvider(s.intent.paymentIntentId, record.chargeId, s.intent.capturedCardCents, s.bindings);
}
/** A stored provider proof qualifies CARD coverage only. This never proves
 * banking arrival, local money, physical receipt or closure of any other case. */
export async function readRefundRepairCardSettlement(tx: FirebaseFirestore.Transaction, id: string, order: any, intent: any) {
  const marker = intent?.cardRepairSettlement;
  if (marker?.protocol !== 'purchase_refund_repair_settlement_v1' || marker.refundIntentId !== intent.intentId ||
      marker.originalRefundId !== intent.stripeRefundId || marker.amountCents !== intent.cardAmountCents ||
      !native(marker.recordedAt) || !hash(marker.proofHash) || hasActiveBankDispute(order)) return false;
  const record = (await tx.get(repairs(id).doc(marker.repairId))).data();
  if (!record || !qualifiedRepairRecord(record, id, order) || record.state !== 'card_repaired' || record.providerStatus !== 'succeeded' ||
      record.cardRepairedCents !== intent.cardAmountCents || record.proof?.proofHash !== marker.proofHash || !native(record.observedAt) ||
      record.proof.qualification !== 'current_original_method_capacity' || record.proof.proofHash !== supportHash({paymentIntentId: record.proof.paymentIntentId,
        chargeId: record.proof.chargeId, amountCapturedCents: record.proof.amountCapturedCents, amountRefundedCents: record.proof.amountRefundedCents,
        capacityCents: record.proof.capacityCents, refunds: record.proof.refunds})) return false;
  const target = record.proof.refunds.filter((p: any) => p.id === intent.stripeRefundId || record.targetRefundIds.includes(p.id));
  return target.filter((p: any) => p.status === 'succeeded').reduce((n: number, p: any) => n + p.amountCents, 0) === intent.cardAmountCents &&
    target.every((p: any) => p.status === 'succeeded' || ['failed', 'canceled'].includes(p.status) && p.failureFundsReturnedToStripe) &&
    target.some((p: any) => p.id === record.providerRefundId && p.status === 'succeeded') && intent.providerStatus !== 'succeeded';
}
/** Only the financial review explained by this bounded native allocation set
 * can finish. Other witnesses stay independent; unknown/pending reservations,
 * unmatched money or a bank/risk review cannot be cleared by a repair marker. */
async function repairFinancialReviewResolved(tx: FirebaseFirestore.Transaction, id: string, order: any,
  s: Awaited<ReturnType<typeof source>>, selected: any, p: Provider) {
  if (s.blocked || !s.riskClear || !s.complete || p.qualification !== 'current_original_method_capacity' ||
      order.purchaseRefundRepairContext?.protocol !== 'purchase_refund_repair_context_v1' ||
      !s.all.some(r => r.repairId === order.purchaseRefundRepairContext.repairId) ||
      typeof order.refundBlocked !== 'boolean' || typeof order.refundAllocationState?.reviewRequired !== 'boolean' ||
      own(order, 'refundLegacyReconciliationRequired') && order.refundLegacyReconciliationRequired !== false) return false;
  if (s.all.some(r => r.state === 'not_executed' && r.externalAttemptedAtMs === null ? false :
      !r.providerRefundId || !p.refunds.some(proof => proof.id === r.providerRefundId))) return false;
  for (const item of s.nativeAllocations) {
    const intent = item.intent.intentId === selected.intentId ? selected : item.intent;
    if (intent.state !== 'succeeded' || intent.outstandingCardCents !== 0 || intent.freezeCents !== 0 ||
        intent.bankWaiting || intent.legacyReconciliationRequired ||
        !await allocationLocalMovementsVerified(tx, id, order, intent, item.record)) return false;
    const ids = new Set(s.bindings.filter(b => b.intentId === intent.intentId).map(b => b.refundId));
    const proofs = p.refunds.filter(r => ids.has(r.id));
    if (intent.cardAmountCents > 0 && (proofs.length !== ids.size ||
        proofs.filter(r => r.status === 'succeeded').reduce((n, r) => n + r.amountCents, 0) !== intent.cardAmountCents ||
        proofs.some(r => r.status !== 'succeeded' && !(['failed', 'canceled'].includes(r.status!) && r.failureFundsReturnedToStripe)))) return false;
  }
  return true;
}
async function prepareProviderRecord(tx: FirebaseFirestore.Transaction, id: string, order: any, s: Awaited<ReturnType<typeof source>>,
  record: any, p: Provider) {
  if(s.intent.manualBankSettlement!=null||order.manualRefundRestitution?.refundIntentId===s.intent.intentId){
    const own=p.refunds.find(r=>r.id===record.providerRefundId),ids=new Set(s.bindings.filter(b=>b.intentId===s.intent.intentId).map(b=>b.refundId));
    const unchangedFailure=p.qualification==='current_original_method_capacity'&&[...ids].every(id=>p.refunds.some(r=>r.id===id&&['failed','canceled'].includes(r.status!)&&r.failureFundsReturnedToStripe));
    const patched={...record,providerStatus:own?.status??record.providerStatus,proof:p,observedAt:p.observedAt,
      ...unchangedFailure?{}:{state:'reconciliation_required'}};
    const fields=await financialRecoverySourceFields('refund_repair',repairs(id).doc(record.repairId),record,patched);
    const plan=unchangedFailure?null:await prepareManualOriginalObservation(tx,id,order,s.intent,null,true);
    return {selected:s.intent,patched,commit:()=>{plan?.commit();tx.set(repairs(id).doc(record.repairId),fields);}};
  }
  const sameSource = p.qualification === 'current_original_method_capacity' && p.paymentIntentId === s.intent.paymentIntentId && p.chargeId === record.chargeId;
  const nativeIds = new Set(s.bindings.filter(b => b.intentId === s.intent.intentId).map(b => b.refundId));
  const attributable = p.refunds.filter(r => !s.bindings.some(b => b.refundId === r.id));
  const own = p.refunds.find(r => r.id === record.providerRefundId) ?? (record.providerRefundId == null && attributable.length === 1 ? attributable[0] : null);
  if (own) nativeIds.add(own.id);
  const relevant = p.refunds.filter(r => nativeIds.has(r.id));
  const paid = relevant.filter(r => r.status === 'succeeded').reduce((n, r) => n + r.amountCents, 0);
  const duplicate = sameSource && paid > s.intent.cardAmountCents;
  const repaired = sameSource && paid === s.intent.cardAmountCents &&
    s.target.every(r => r.state === 'not_executed' && r.externalAttemptedAtMs === null ||
      relevant.some(p => p.id === r.providerRefundId)) &&
    relevant.every(r => r.status === 'succeeded' || ['failed', 'canceled'].includes(r.status!) && r.failureFundsReturnedToStripe);
  const winner = repaired ? s.target.find(r => relevant.some(p => p.id === r.providerRefundId && p.status === 'succeeded')) : null;
  const ownRepaired = repaired && own?.status === 'succeeded';
  const state = duplicate ? 'reconciliation_required' : ownRepaired ? 'card_repaired' : !sameSource || !own ? 'unknown' :
    own.status === 'pending' || own.status === 'requires_action' ? own.status : ['failed', 'canceled'].includes(own.status!) ? 'failed' : 'reconciliation_required';
  const now = Timestamp.now(), alert = db.collection('admin_alerts').doc(`refund_repair_${record.repairId}_${state}`);
  const priorAlert = !repaired && ['unknown', 'failed', 'reconciliation_required'].includes(state) ? await tx.get(alert) : null;
  const notices = await prepareOperationalNotices(tx, [order.buyerId, order.sellerId].map(userId => ({
    eventKey: `refund_repair_status:${record.repairId}:${state}:${p.proofHash}`, userId, type: 'order_moderation',
    title: repaired ? 'Portion carte réparée' : 'Réparation du remboursement à suivre',
    message: repaired ? 'Le prestataire confirme la portion carte de cette obligation. Aucun crédit portefeuille ni débit vendeur n’est répété ; les autres examens et l’arrivée bancaire restent distincts.' :
      'La tentative de réparation reste à suivre ou à rapprocher. Cet avis ne confirme ni argent reçu, ni nouvelle permission financière ou de transport.',
    data: {ownerId: userId, transactionId: id, refundIntentId: s.intent.intentId, refundRepairId: record.repairId,
      repairState: state, bankArrivalVerified: 'false', localMovementsRepeated: 'false'},
  })));
  const watchBasis = winner ?? record;
  const watchUntilMs = repaired ? cents(watchBasis.settlementWatchUntilMs) && watchBasis.settlementWatchUntilMs > 0
    ? watchBasis.settlementWatchUntilMs : Date.now() + 31 * 24 * 60 * 60 * 1000 : null;
  const patched = {...record, state, providerRefundId: own?.id ?? record.providerRefundId,
    providerStatus: own?.status ?? record.providerStatus, proof: p, observedAt: p.observedAt,
    cardRepairedCents: ownRepaired ? s.intent.cardAmountCents : null,
    targetRefundIds: [...nativeIds].sort(), settlementWatchUntilMs: watchUntilMs, updatedAt: now};
  const selected = {...s.intent, state: repaired && s.localVerified ? 'succeeded' : 'reconciliation_required',
    providerStatus: sameSource ? p.refunds.find(r => r.id === s.intent.stripeRefundId)?.status ?? s.intent.providerStatus : s.intent.providerStatus,
    cardConfirmedCents: sameSource && paid <= s.intent.cardAmountCents ? paid : null,
    outstandingCardCents: sameSource && paid <= s.intent.cardAmountCents ? s.intent.cardAmountCents - paid : null,
    cardSatisfiedVia: repaired ? winner ? 'repair_original_method' : 'stripe' : null,
    cardRepairSettlement: repaired && winner ? {protocol: 'purchase_refund_repair_settlement_v1', refundIntentId: s.intent.intentId,
      originalRefundId: s.intent.stripeRefundId, repairId: winner.repairId, amountCents: s.intent.cardAmountCents,
      proofHash: p.proofHash, recordedAt: now} : null,
    watch: true, watchUntilMs};
  const ownReviewResolved = repaired && s.localVerified && await repairFinancialReviewResolved(tx, id, order, s, selected, p);
  const accounting = await preparePurchasePlatformAccounting(tx, id, order, {refundIntentId: s.intent.intentId});
  const update: FirebaseFirestore.UpdateData<FirebaseFirestore.DocumentData> = {
        refundBlocked: !ownReviewResolved, 'refundAllocationState.reviewRequired': !ownReviewResolved};
  if (ownReviewResolved) {
        update['purchaseRefundRepairContext.reviewRequired'] = false;
        update['purchaseRefundRepairContext.resolution'] = {protocol: 'purchase_refund_repair_review_resolution_v1',
          refundIntentId: s.intent.intentId, proofHash: p.proofHash,
          allocationManifestHash: supportHash(s.nativeAllocations.map(a => [a.record.refundIntentId, a.record.reservationHash])), recordedAt: now};
        // Restore only the already-settled financial engine projection. Claims,
        // returns, stock and every independent review keep their own witnesses.
        if (['refund_action_required', 'refund_in_progress'].includes(order.status)) {
          const latest = s.historical ? order.refund : selected;
          const openClaim = s.claims.docs.some(c => !['closed', 'resolved', 'dismissed'].includes(c.data().status));
          if (order.disputed === true || openClaim) update.status = 'disputed';
          else if (latest?.allocation?.terms.settlementKind === 'full_remaining') update.status = 'refunded';
          else if (['paid', 'label_created', 'shipped', 'delivered', 'return_requested', 'completed', 'meetup_completed'].includes(latest?.originalStatus))
            update.status = latest.originalStatus;
        }
      }
  if(own && !s.historical)update.refund=selected;
  const repairFields=await financialRecoverySourceFields('refund_repair',repairs(id).doc(record.repairId),record,patched);
  const winnerFields=winner && winner.repairId!==record.repairId ? await financialRecoverySourceFields('refund_repair',repairs(id).doc(winner.repairId),winner,{...winner,
    state:'card_repaired',providerStatus:'succeeded',proof:p,observedAt:p.observedAt,cardRepairedCents:s.intent.cardAmountCents,
    targetRefundIds:[...nativeIds].sort(),settlementWatchUntilMs:watchUntilMs,updatedAt:now}) : null;
  const orderFields=own ? await financialRecoverySourceFields('purchase',ref(id),order,update) : null;
  const taxSettlement=s.nativeAllocations.find(a=>a.record.refundIntentId===s.intent.intentId)?.record.settlement??null;
  const taxRepair=own&&selected.cardRepairSettlement?(winnerFields??(winner?.repairId===record.repairId?repairFields:null)):null;
  const fiscalProjection={order:orderFields?sellerTaxFinancialOrderAfter(order,orderFields):order,
    refund:{intent:own?selected:s.intent,settlement:taxSettlement,...taxRepair?{repairRecord:taxRepair}:{}}};
  const fiscal=await prepareSellerTaxFinancialEvent(tx,order.sellerId,{kind:'purchase_refund',id,refundIntentId:s.intent.intentId},fiscalProjection);
  return {selected, patched, commit: () => {
    fiscal.commit(fiscalProjection);
    accounting.commit({intent: own ? selected : s.intent, nativeRepairQualified: !!own && repaired && s.localVerified});
    tx.set(repairs(id).doc(record.repairId),repairFields);
    if(winnerFields && winner)tx.set(repairs(id).doc(winner.repairId),winnerFields);
    if(own && s.historical)tx.update(refundHistoryRef(id,s.intent.intentId),{currentIntent:selected});
    if(orderFields)tx.update(ref(id),orderFields);
    if (priorAlert && !priorAlert.exists) tx.create(alert, {kind: 'purchase_refund_action_required', severity: 'critical', refId: id,
      message: 'Une réparation carte nécessite un rapprochement. Les anciens effets et obligations sont conservés.',
      context: {refundIntentId: s.intent.intentId, refundRepairId: record.repairId, state, duplicateObserved: duplicate}, status: 'open', createdAt: now});
    notices.commit();
  }};
}
async function serviceRepair(id: string, repairId: string) {
  const first = await db.runTransaction(async tx => {const snap = await tx.get(ref(id)), order = snap.data(), r = (await tx.get(repairs(id).doc(repairId))).data();
    if (!order || !qualifiedRepairRecord(r, id, order)) return null;
    if (r!.state === 'not_executed' && r!.externalAttemptedAtMs === null && r!.providerRefundId === null) return null;
    try {return {record: r!, s: await source(tx, id, order, r!.refundIntentId, repairId)};} catch (e) {
      if (e instanceof FinancialRecoveryBlocked) throw e;
      if (e instanceof HttpsError && ['failed-precondition', 'invalid-argument'].includes(e.code)) return {record: r!, s: null}; throw e;
    }});
  if (!first) return;
  if (!first.s) {
    // Even when the financial corpus cannot qualify, an exact provider ID
    // remains observable. Record facts only; never reconstruct an allocation.
    const stripe = getStripe(); if (!stripe || !first.record.providerRefundId) return;
    let observed: ProviderRefund | null = null;
    try {observed = providerRefund(await stripe.refunds.retrieve(first.record.providerRefundId));} catch (recoveryFailure) {
      if (recoveryFailure instanceof FinancialRecoveryBlocked) throw recoveryFailure; /* explicit unknown below */ }
    if (observed && (observed.paymentIntentId !== first.record.paymentIntentId || observed.chargeId !== first.record.chargeId ||
        observed.amountCents !== first.record.amountCents)) observed = null;
    await db.runTransaction(async tx => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();const r = (await tx.get(repairs(id).doc(repairId))).data();
      if (!r || supportSourceHash(r) !== supportSourceHash(first.record)) return;
      const order = (await tx.get(ref(id))).data();
      const accounting = await preparePurchasePlatformAccounting(tx, id, order, {refundIntentId: r.refundIntentId});
      const fiscalProjection={order:sellerTaxFinancialOrderAfter(order??{}, {'refundAllocationState.reviewRequired':true})};
      const fiscal=await prepareSellerTaxFinancialEvent(tx,r.sellerId,{kind:'purchase_refund',id,refundIntentId:r.refundIntentId},fiscalProjection);
      fiscal.commit(fiscalProjection);
      accounting.commit(undefined, 'refund_repair_financial_source_unqualified');
      await recoveryCommit({refs: [(repairs(id).doc(repairId)).path]});
    tx.update(repairs(id).doc(repairId), await financialRecoverySourceFields('refund_repair',repairs(id).doc(repairId),r!,{state: 'reconciliation_required', nativeFinancialSourceQualification: 'unknown',
        unqualifiedSourceProviderObservation: observed, sourceObservationRecordedAt: Timestamp.now()}));
      await recoveryCommit({refs: [(ref(id)).path]});
    tx.update(ref(id), {refundBlocked: true, 'refundAllocationState.reviewRequired': true});
    });
    return;
  }
  const p = await observeRepairProvider(first.s, first.record);
  await db.runTransaction(async tx => {const order = (await tx.get(ref(id))).data(), current = (await tx.get(repairs(id).doc(repairId))).data();
    if (!order || !qualifiedRepairRecord(current, id, order) || current!.commandHash !== first.record.commandHash ||
        supportSourceHash(current) !== supportSourceHash(first.record)) return;
    if (native(current!.observedAt) && current!.observedAt.toMillis() > p.observedAt.toMillis()) return;
    const s = await source(tx, id, order, current!.refundIntentId, repairId);
    if (s.sourceHash !== first.s!.sourceHash) return;
    const prepared = await prepareProviderRecord(tx, id, order, s, current, p);
    prepared.commit();
  });
}
export async function observePurchaseRefundRepairs(id: string) {
  const page = await repairs(id).orderBy('__name__').limit(21).get();
  if (page.size >= 21) return;
  for (const row of page.docs) await serviceRepair(id, row.id);
}
/** Called by the existing signed-webhook observer. A reserved native repair,
 * not untrusted metadata alone, determines attribution and GET-only servicing. */
export async function observePurchaseRefundRepairIdentity(id: string, provider: any): Promise<IssueRefundResult | null> {
  const rows = await repairs(id).orderBy('__name__').limit(21).get();
  if (rows.size >= 21) return null;
  const matches = rows.docs.filter(row => row.data().providerRefundId === provider.id || row.data().providerRefundId == null &&
    provider.metadata?.refundRepairId === row.id && provider.metadata?.refundAttemptId === row.data().attemptId &&
    provider.metadata?.refundIntentId === row.data().refundIntentId && provider.metadata?.transactionId === id);
  if (matches.length !== 1) return null;
  await serviceRepair(id, matches[0].id);
  const loaded = await load(id, matches[0].data().refundIntentId); return refundResult(loaded.s.intent, true);
}
async function performRepair(id: string, repairId: string, request: any) {
  // Real external evidence wins, even with a revoked operator or a closed stage.
  await serviceRepair(id, repairId);
  const snap = await ref(id).get(), order = snap.data(), record = (await repairs(id).doc(repairId).get()).data();
  if (!order || !qualifiedRepairRecord(record, id, order) || record!.providerRefundId || record!.newEffectRefusedReason) return;
  if (!PURCHASE_REFUND_REPAIR_ENABLED) return;
  const initial = await db.runTransaction(async tx => {
    const root = (await tx.get(ref(id))).data(), r = (await tx.get(repairs(id).doc(repairId))).data();
    if (!root || !qualifiedRepairRecord(r, id, root) || r!.providerRefundId || r!.actorId !== request.auth.uid) return null;
    await operator(tx, request);
    return {s: await source(tx, id, root, r!.refundIntentId, repairId), r: r!};
  });
  if (!initial) return;
  if (initial.s.sourceHash !== initial.r.command.sourceHash) {await refuseNewRepair(id, repairId, 'source_changed'); return;}
  const p = await observeRepairProvider(initial.s, initial.r);
  if (initial.r.providerRefundId) return;
  if (p.qualification !== 'current_original_method_capacity') return;
  const withoutOwn = {...initial.s, target: initial.s.target.filter(r => r.repairId !== repairId), all: initial.s.all.filter(r => r.repairId !== repairId)};
  const view = publicSource(withoutOwn, id, initial.r.command.sourceRevision, p);
  if (!view.canRepairOriginalMethodNow || view.terminalRefundId !== initial.r.command.terminalRefundId ||
      view.terminalAttemptId !== initial.r.command.terminalAttemptId || view.remainingCardCents !== initial.r.amountCents) return;
  const allowed = await db.runTransaction(async tx => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
    const root = (await tx.get(ref(id))).data(), r = (await tx.get(repairs(id).doc(repairId))).data();
    if (!root || !qualifiedRepairRecord(r, id, root) || r!.providerRefundId || r!.actorId !== request.auth.uid) return false;
    if(!await manualRefundNewProviderEffectAllowed(tx,id,root,root.refund?.intentId===r!.refundIntentId?root.refund:await readAllocationHistoryIntent(tx,id,root,r!.refundIntentId)))return false;
    await operator(tx, request);
    const current = await source(tx, id, root, r!.refundIntentId, repairId);
    if (current.sourceHash !== r!.command.sourceHash || current.blocked || !current.riskClear || !current.complete || !current.localVerified ||
        r!.newEffectRefusedReason || r!.externalAttemptedAtMs != null && (!Number.isSafeInteger(r!.externalAttemptedAtMs) || Date.now() - r!.externalAttemptedAtMs >= 23 * 60 * 60 * 1000)) {
      await recoveryCommit({refs: [(repairs(id).doc(repairId)).path]});
    tx.update(repairs(id).doc(repairId), await financialRecoverySourceFields('refund_repair',repairs(id).doc(repairId),r!,{state: r!.externalAttemptedAtMs === null ? 'not_executed' : 'reconciliation_required',
        newEffectRefusedReason: 'source_changed'})); return false;
    }
    assertRecentAccountAuthentication(request.auth.token);
    await recoveryCommit({refs: [(repairs(id).doc(repairId)).path]});
    tx.update(repairs(id).doc(repairId), await financialRecoverySourceFields('refund_repair',repairs(id).doc(repairId),r!, {externalAttemptedAtMs: r!.externalAttemptedAtMs ?? Date.now(), state: 'unknown',
      firstIoAuthorization: r!.firstIoAuthorization ?? {actorId: request.auth.uid, authTime: request.auth.token.auth_time,
        sourceHash: current.sourceHash, recordedAt: Timestamp.now()}}));
    return true;
  });
  if (!allowed) return;
  try {
    const {createNativePurchaseRefundCardRequest} = await import('./refund');
    const created = await createNativePurchaseRefundCardRequest({transactionId: id, paymentIntentId: initial.s.intent.paymentIntentId,
      amountCents: initial.r.amountCents, refundIntentId: initial.r.refundIntentId, refundAttemptId: initial.r.attemptId,
      idempotencyKey: initial.r.idempotencyKey, refundRepairId: repairId});
    const response = providerRefund(created);
    if (response && response.paymentIntentId === initial.s.intent.paymentIntentId && response.chargeId === initial.r.chargeId &&
        response.amountCents === initial.r.amountCents) await db.runTransaction(async tx => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
      const current = (await tx.get(repairs(id).doc(repairId))).data();
      if (current && current.commandHash === initial.r.commandHash && current.providerRefundId == null)
        { await recoveryCommit({refs: [(repairs(id).doc(repairId)).path]}); tx.update(repairs(id).doc(repairId), await financialRecoverySourceFields('refund_repair',repairs(id).doc(repairId),current!,{providerRefundId: response.id, providerResponseStatus: response.status})); }
    });
  } catch (recoveryFailure) {
      if (recoveryFailure instanceof FinancialRecoveryBlocked) throw recoveryFailure; /* Unknown may have escaped: only the same durable tuple is serviced. */ }
  await serviceRepair(id, repairId);
}
export async function handlePurchaseRefundRepair(request: any) {
  const uid = supportUid(request), raw = request.data;
  if(raw.capability===MANUAL_REFUND_CAPABILITY)return handleManualRefund(request,uid,raw);
  if (raw.capability !== 'purchase_refund_repair_v1') throw new HttpsError('invalid-argument', 'Version de réparation explicite requise.');
  if (raw.mode === 'purchase_refund_repair_command') {
    supportObject(raw, ['mode', 'capability', 'expectedUid', 'requestId', 'modeAction', 'command']);
    const command = parseCommand(raw.command), requestId = supportRequestId(raw.requestId), payloadHash = supportHash(command);
    if (!['execute', 'observe', 'neutralize', 'recover'].includes(raw.modeAction)) throw new HttpsError('invalid-argument', 'Action du journal inconnue.');
    const result = await db.runTransaction(async tx => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
      const previous = await ownReceipt(tx, uid, requestId, command); if (previous) return previous.view;
      const base = {protocol: 'purchase_refund_repair_command_v1', actorId: uid, requestId, command, payloadHash,
        state: 'unrecorded', reason: null, repairId: null, recordedAt: null};
      if (raw.modeAction === 'observe' || raw.modeAction === 'recover') return receiptView(base);
      const refuse = (reason: string) => {const r = {...base, state: 'not_executed', reason, recordedAt: Timestamp.now()};
        tx.create(receiptRef(command.transactionId, uid, requestId), r); return receiptView(r);};
      if (raw.modeAction === 'neutralize') return refuse('requester_neutralized');
      if (!PURCHASE_REFUND_REPAIR_ENABLED) return refuse('purchase_refund_repair_not_exposed');
      const snap = await tx.get(ref(command.transactionId)), order = snap.data();
      if (!order) return refuse('repair_native_source_unknown');
      await operator(tx, request);
      const preview = (await tx.get(previewRef(command.transactionId, command.previewId))).data();
      if (preview?.protocol !== 'purchase_refund_repair_preview_v1' || preview.actorId !== uid || !native(preview.createdAt) ||
          preview.transactionId !== command.transactionId || preview.refundIntentId !== command.refundIntentId ||
          preview.action !== command.action || preview.sourceHash !== command.sourceHash || preview.sourceRevision !== command.sourceRevision)
        return refuse('repair_preview_unqualified');
      let s: Awaited<ReturnType<typeof source>>;
      try {s = await source(tx, command.transactionId, order, command.refundIntentId);} catch (e) {
      if (e instanceof FinancialRecoveryBlocked) throw e;
        if (e instanceof HttpsError && e.code === 'failed-precondition') return refuse('repair_native_source_unknown'); throw e;
      }
      if (s.sourceHash !== command.sourceHash || supportRevision(snap) !== command.sourceRevision) return refuse('source_changed');
      const v = publicSource(s, command.transactionId, supportRevision(snap), preview.provider);
      const monetary = command.action === 'repair_original_method';
      if(monetary&&order.manualRefundRestitution!=null)return refuse('manual_refund_obligation_reserved');
      if (!s.complete || command.amountCents !== (monetary ? v.remainingCardCents : s.intent.cardAmountCents) ||
          command.terminalRefundId !== (monetary ? v.terminalRefundId : s.intent.stripeRefundId) ||
          command.terminalAttemptId !== (monetary ? v.terminalAttemptId : s.intent.attemptId) || monetary && !v.canRepairOriginalMethodNow)
        return refuse('repair_current_proof_required');
      const now = Timestamp.now(), repairId = command.action === 'repair_original_method' ? 'rr_' + supportHash([uid, requestId]) : null;
      const notices = await prepareOperationalNotices(tx, [order.buyerId, order.sellerId].map(userId => ({
        eventKey: `purchase_refund_repair_instruction:${uid}:${requestId}`, userId, type: 'order_moderation', title: 'Suivi du remboursement',
        message: command.partyMessage, data: {ownerId: userId, transactionId: command.transactionId, refundIntentId: command.refundIntentId,
          refundRepairId: repairId ?? 'documentary', bankArrivalVerified: 'false', externalPaymentAuthorized: 'false'},
      })));
      const receipt = {...base, state: repairId ? 'reserved' : 'committed', reason: null, repairId, recordedAt: now,
        buyerId: order.buyerId, sellerId: order.sellerId};
      assertRecentAccountAuthentication(request.auth.token);
      if (repairId) {
        const missingRepair=await tx.get(repairs(command.transactionId).doc(repairId));
        const orderFields=await financialRecoverySourceFields('purchase',ref(command.transactionId),order,{purchaseRefundRepairContext:{protocol:'purchase_refund_repair_context_v1',repairId,refundIntentId:command.refundIntentId,reviewRequired:true},'refund.watch':true});
        await recoveryCommit({refs: [(repairs(command.transactionId).doc(repairId)).path]});
    tx.create(repairs(command.transactionId).doc(repairId), await financialRecoverySourceFields('refund_repair',repairs(command.transactionId).doc(repairId),missingRepair, {protocol: 'purchase_refund_repair_record_v1', repairId,
          transactionId: command.transactionId, refundIntentId: command.refundIntentId, actorId: uid, command, commandHash: payloadHash,
          buyerId: order.buyerId, sellerId: order.sellerId, ordinal: s.target.length + 1, attemptId: repairId,
          paymentIntentId: s.intent.paymentIntentId, chargeId: order.stripeChargeId, amountCents: command.amountCents, currency: 'CAD', idempotencyKey: `rf_repair_${repairId}`,
          state: 'reserved', providerRefundId: null, providerStatus: null, cardRepairedCents: null,
          externalAttemptedAtMs: null, observedAt: null, reservedAt: now, proof: null, targetRefundIds: [],
          reservationAuthority: {privateRoleAtCommit: true, authTime: request.auth.token.auth_time},
          previousContext: {present: own(order, 'purchaseRefundRepairContext'), value: order.purchaseRefundRepairContext ?? null},
          previousWatch: {present: own(order.refund, 'watch'), value: order.refund?.watch ?? null}}));
        await recoveryCommit({refs: [(ref(command.transactionId)).path]});
    tx.update(ref(command.transactionId),orderFields);
      }
      await recoveryCommit({refs: [(receiptRef(command.transactionId, uid, requestId)).path]});
    tx.create(receiptRef(command.transactionId, uid, requestId), receipt); notices.commit(); return receiptView(receipt);
    });
    if (result.state !== 'reserved' || !result.repairId || !['execute', 'recover'].includes(raw.modeAction)) return result;
    if (raw.modeAction === 'recover') await serviceRepair(command.transactionId, result.repairId);
    else try {await performRepair(command.transactionId, result.repairId, request);} catch (e) {
      if (e instanceof FinancialRecoveryBlocked) throw e;
      // A true own receipt/effect remains readable after role/session loss.
      // The failed NEW admission never changes or neutralizes that intention.
      if (!(e instanceof HttpsError && ['permission-denied', 'failed-precondition'].includes(e.code))) throw e;
    }
    return db.runTransaction(async tx => (await ownReceipt(tx, uid, requestId, command))!.view);
  }
  if (raw.mode === 'purchase_refund_repair_source_observe') {
    supportObject(raw, ['mode', 'capability', 'expectedUid', 'transactionId', 'scope', 'refundIntentId', 'cursor', 'instructionCursor']);
    if (!['own', 'admin'].includes(raw.scope)) throw new HttpsError('invalid-argument', 'Portée native requise.');
    const id = supportId(raw.transactionId), intentId = raw.refundIntentId === undefined ? null : supportId(raw.refundIntentId);
    const cursor = raw.cursor == null ? null : supportObject(raw.cursor, ['lastId']).lastId;
    if (cursor !== null && (typeof cursor !== 'string' || !cursor || cursor.includes('/') || Buffer.byteLength(cursor, 'utf8') > 1500))
      throw new HttpsError('invalid-argument', 'Curseur inconnu.');
    const instructionCursor = raw.instructionCursor == null ? null : supportObject(raw.instructionCursor, ['lastId']).lastId;
    if (instructionCursor !== null && (typeof instructionCursor !== 'string' || !instructionCursor || instructionCursor.includes('/') || Buffer.byteLength(instructionCursor, 'utf8') > 1500))
      throw new HttpsError('invalid-argument', 'Curseur d’instruction inconnu.');
    return db.runTransaction(async tx => {
      if (raw.scope === 'admin') {await supportCurrentAdminSession(request); await supportAdmin(tx, uid, false);}
      const snap = await tx.get(ref(id)), order = snap.data();
      if (!order || raw.scope === 'own' && ![order.buyerId, order.sellerId].includes(uid)) throw new HttpsError('permission-denied', 'Partie native requise.');
      let query: FirebaseFirestore.Query = ref(id).collection('refund_allocations').orderBy('__name__').limit(21); if (cursor) query = query.startAfter(cursor);
      const page = await tx.get(query), inspected = page.docs.slice(0, 20);
      let instructionsQuery: FirebaseFirestore.Query = ref(id).collection('refund_repair_commands').orderBy('__name__').limit(21);
      if (instructionCursor) instructionsQuery = instructionsQuery.startAfter(instructionCursor);
      const instructionsPage = await tx.get(instructionsQuery), instructionsInspected = instructionsPage.docs.slice(0, 20);
      const instructions = instructionsInspected.flatMap(row => {const d = row.data();
        if (d.protocol !== 'purchase_refund_repair_command_v1' || !['committed', 'reserved'].includes(d.state) || d.command?.transactionId !== id ||
            d.buyerId !== order.buyerId || d.sellerId !== order.sellerId || d.payloadHash !== supportHash(d.command) || !native(d.recordedAt)) return [];
        return [{instructionId: row.id, refundIntentId: d.command.refundIntentId, action: d.command.action,
          partyMessage: d.command.partyMessage, recordedAt: d.recordedAt.toDate().toISOString(), externalPaymentAuthorized: false,
          fundsReceivedVerified: false}];});
      let selected = null; let reason = null;
      if (intentId) try {const s = await source(tx, id, order, intentId); selected = publicSource(s, id, supportRevision(snap), null);} catch (e) {
      if (e instanceof FinancialRecoveryBlocked) throw e;
        if (!(e instanceof HttpsError && ['failed-precondition', 'invalid-argument'].includes(e.code))) throw e; reason = 'repair_native_source_unknown';
      }
      return {protocol: 'purchase_refund_repair_observation_v1', actorId: uid, scope: raw.scope, transactionId: id,
        sourceRevision: supportRevision(snap), selected, reason, candidates: inspected.map(row => ({refundIntentId: row.id,
          qualification: row.data().protocol === 'purchase_refund_allocation_record_v1' && row.data().transactionId === id &&
            row.data().buyerId === order.buyerId && row.data().sellerId === order.sellerId ? 'native_allocation_reference' : 'unknown',
          historical: row.id !== order.refund?.intentId})), cursor: page.size > 20 ? {lastId: inspected[inspected.length - 1].id} : null,
        instructions: {entries: instructions, cursor: instructionsPage.size > 20 ? {lastId: instructionsInspected[instructionsInspected.length - 1].id} : null},
        historicalReadOnly: true, ...effects};
    });
  }
  if (raw.mode !== 'purchase_refund_repair_preview') throw new HttpsError('invalid-argument', 'Mode de réparation inconnu.');
  supportObject(raw, ['mode', 'capability', 'expectedUid', 'transactionId', 'refundIntentId', 'action']);
  if (!PURCHASE_REFUND_REPAIR_ENABLED) throw new HttpsError('failed-precondition', 'La réparation est en préparation.', {reason: 'purchase_refund_repair_not_exposed'});
  if (!['repair_original_method', 'record_external_instruction'].includes(raw.action)) throw new HttpsError('invalid-argument', 'Instruction inconnue.');
  const id = supportId(raw.transactionId), intentId = supportId(raw.refundIntentId);
  await db.runTransaction(tx => operator(tx, request));
  let initial = await load(id, intentId);
  if (raw.action === 'repair_original_method' && initial.s.localVerified && !['failed', 'canceled'].includes(initial.s.intent.providerStatus)) {
    // Service a genuine old provider outcome before constructing a NEW preview.
    // Local movements are already qualified; this cannot create them again.
    const {observePurchaseRefund} = await import('./refund');
    await observePurchaseRefund(id, initial.s.intent.stripeRefundId);
    initial = await load(id, intentId);
  }
  const p = await observeProvider(initial.s.intent.paymentIntentId, initial.order.stripeChargeId,
    initial.s.intent.capturedCardCents, initial.s.bindings);
  return db.runTransaction(async tx => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
    await operator(tx, request);
    const snap = await tx.get(ref(id)), order = snap.data(); if (!order) throw new HttpsError('not-found', 'Commande introuvable.');
    const s = await source(tx, id, order, intentId), v = publicSource(s, id, supportRevision(snap), p);
    if (s.sourceHash !== initial.s.sourceHash || supportRevision(snap) !== initial.revision) throw new HttpsError('aborted', 'Les sources ont changé.');
    const previewId = supportHash([uid, id, intentId, raw.action, v.sourceHash, p.proofHash]);
    const previous = await tx.get(previewRef(id, previewId));
    if (!previous.exists) { await recoveryCommit({refs: [(previewRef(id, previewId)).path]}); tx.create(previewRef(id, previewId), {protocol: 'purchase_refund_repair_preview_v1', previewId, actorId: uid,
      transactionId: id, refundIntentId: intentId, action: raw.action, sourceHash: s.sourceHash, sourceRevision: supportRevision(snap), provider: p, createdAt: Timestamp.now()}); }
    return {protocol: 'purchase_refund_repair_preview_v1', actorId: uid, previewId, action: raw.action, source: v, ...effects};
  });
}
/** The existing observer preserves a proven repair when the SAME original
 * failed refund is observed again. A later contradictory original outcome
 * requires reconciliation; it never credits/debits local money again. */
export async function prepareOriginalRefundRepairObservation(tx: FirebaseFirestore.Transaction, id: string, order: any, intent: any, provider: any) {
  if(intent.manualBankSettlement!=null||order.manualRefundRestitution!=null)return prepareManualOriginalObservation(tx,id,order,intent,provider);
  if (!own(order, 'purchaseRefundRepairContext') && !own(intent, 'cardRepairSettlement')) return null;
  const page = await tx.get(repairs(id).orderBy('__name__').limit(21));
  const rows = page.docs.filter(r => r.data().refundIntentId === intent.intentId);
  if (!rows.length) return null;
  const r = providerRefund(provider), exact = r && r.id === intent.stripeRefundId && r.paymentIntentId === intent.paymentIntentId &&
    r.chargeId === order.stripeChargeId && r.amountCents === intent.cardAmountCents;
  if (exact && ['failed', 'canceled'].includes(r.status!) && intent.providerStatus === r.status && !intent.cardRepairSettlement)
    return {result: refundResult(intent, true), commit: () => { /* the known original failure adds no new financial evidence */ }};
  if (exact && ['failed', 'canceled'].includes(r.status!) && await readRefundRepairCardSettlement(tx, id, order, intent)) {
    const proof = rows.find(row => row.id === intent.cardRepairSettlement.repairId)?.data()?.proof;
    const original = proof?.refunds?.find((p: any) => p.id === r.id);
    if (original?.status === r.status && original.failureBalanceTransactionId === r.failureBalanceTransactionId)
      return {result: refundResult(intent, true), commit: () => { /* exact old failure cannot erase the repaired obligation */ }};
  }
  const selected = {...intent, state: 'reconciliation_required', outstandingCardCents: null,
    ...(exact ? {providerStatus: r.status, failureReason: r.failureReason} : {})};
  const alert = db.collection('admin_alerts').doc(`refund_repair_original_${id}_${intent.intentId}`), prior = await tx.get(alert);
  const accounting = await preparePurchasePlatformAccounting(tx, id, order, {refundIntentId: intent.intentId});
  const orderFields=await financialRecoverySourceFields('purchase',ref(id),order,{...(order.refund?.intentId===intent.intentId?{refund:selected}:{}),refundBlocked:true,'refundAllocationState.reviewRequired':true});
  const taxAllocation=(await tx.get(refundAllocationRef(id,intent.intentId))).data();
  const fiscalProjection={order:sellerTaxFinancialOrderAfter(order,orderFields),refund:{intent:selected,settlement:taxAllocation?.settlement??null}};
  const fiscal=await prepareSellerTaxFinancialEvent(tx,order.sellerId,{kind:'purchase_refund',id,refundIntentId:intent.intentId},fiscalProjection);
  return {result: refundResult(selected, true), commit: () => {
    fiscal.commit(fiscalProjection);
    accounting.commit({intent: selected}, 'refund_repair_original_outcome_unqualified');
    if (order.refund?.intentId !== intent.intentId) tx.update(refundHistoryRef(id, intent.intentId), {currentIntent: selected});
    tx.update(ref(id),orderFields);
    if (!prior.exists) tx.create(alert, {kind: 'purchase_refund_action_required', severity: 'critical', refId: id,
      context: {refundIntentId: intent.intentId, originalOutcome: exact ? r.status : 'unknown', repairHistoryIncomplete: page.size >= 21},
      message: 'L’issue originale et les réparations doivent être rapprochées sans nouveau mouvement local.', status: 'open', createdAt: Timestamp.now()});
  }};
}
async function refuseNewRepair(id: string, repairId: string, reason: string) {
  await db.runTransaction(async tx => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();const r = (await tx.get(repairs(id).doc(repairId))).data();
    if (!r || r.providerRefundId || r.newEffectRefusedReason) return;
    await recoveryCommit({refs: [(repairs(id).doc(repairId)).path]});
    tx.update(repairs(id).doc(repairId), await financialRecoverySourceFields('refund_repair',repairs(id).doc(repairId),r!,{state: r.externalAttemptedAtMs === null ? 'not_executed' : 'reconciliation_required', newEffectRefusedReason: reason}));
  });
}

// H18: separate native manual restitution. No provider-status substitution.
type ManualData=FirebaseFirestore.DocumentData;
type ManualAction='prepare_manual_bank_transfer'|'attest_manual_bank_transfer'|'void_unexecuted_manual_instruction';
type ManualEvidenceRef={evidenceId:string;generation:string;sha256:string;contentHash:string};
type ManualCommand={transactionId:string;refundIntentId:string;action:ManualAction;previewId:string;sourceHash:string;sourceRevision:string;
  amountCents:number;currency:'CAD';beneficiaryId:string;instructionId:string|null;beneficiaryEvidence:ManualEvidenceRef|null;paymentEvidence:ManualEvidenceRef|null;
  attestation:{version:typeof MANUAL_REFUND_ATTESTATION;beneficiaryIdentityAndDestinationVerified:boolean;transferExecutedAndReceiptVerified:boolean;neverExecuted:boolean};
  note:string;partyMessage:string;acknowledged:true};
const manualActions=['prepare_manual_bank_transfer','attest_manual_bank_transfer','void_unexecuted_manual_instruction'];
const manualDoc=(id:string,key:string)=>ref(id).collection('refund_repair_commands').doc(key);
const manualCommandId=(uid:string,rid:string)=>'manual_'+supportHash([uid,rid]);
const evidenceKey=(uid:string,rid:string)=>'me_'+supportHash([uid,rid]);
const exactRevision=(s:any)=>typeof s==='string'&&/^\d+:\d+$/.test(s);
const binaryHash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
function parseManualReference(raw:any):ManualEvidenceRef|null{
  if(raw===null)return null;
  const d=supportObject(raw,['evidenceId','generation','sha256','contentHash']);
  if(!manualEvidenceId(d.evidenceId)||typeof d.generation!=='string'||!/^\d{1,30}$/.test(d.generation)||!hash(d.sha256)||!hash(d.contentHash))
    throw new HttpsError('invalid-argument','Référence native de preuve requise.');
  return d as ManualEvidenceRef;
}
function parseManualCommand(raw:any):ManualCommand{
  const d=supportObject(raw,['transactionId','refundIntentId','action','previewId','sourceHash','sourceRevision','amountCents','currency','beneficiaryId',
    'instructionId','beneficiaryEvidence','paymentEvidence','attestation','note','partyMessage','acknowledged']);
  const a=supportObject(d.attestation,['version','beneficiaryIdentityAndDestinationVerified','transferExecutedAndReceiptVerified','neverExecuted']);
  if(!manualActions.includes(d.action)||!hash(d.previewId)||!hash(d.sourceHash)||!exactRevision(d.sourceRevision)||!cents(d.amountCents)||d.amountCents<1||
    d.currency!=='CAD'||d.acknowledged!==true||a.version!==MANUAL_REFUND_ATTESTATION||
    !['beneficiaryIdentityAndDestinationVerified','transferExecutedAndReceiptVerified','neverExecuted'].every(k=>typeof a[k]==='boolean')||
    typeof d.note!=='string'||!d.note.trim()||d.note.length>2000||typeof d.partyMessage!=='string'||!d.partyMessage.trim()||d.partyMessage.length>2000||
    !(d.instructionId===null||manualId(d.instructionId)))throw new HttpsError('invalid-argument','Instruction manuelle et attestation explicites requises.');
  const beneficiaryEvidence=parseManualReference(d.beneficiaryEvidence),paymentEvidence=parseManualReference(d.paymentEvidence);
  const prepare=d.action==='prepare_manual_bank_transfer',attest=d.action==='attest_manual_bank_transfer';
  if(!beneficiaryEvidence||prepare!== (d.instructionId===null)||attest!==(paymentEvidence!==null)||
    a.beneficiaryIdentityAndDestinationVerified!==true||a.transferExecutedAndReceiptVerified!==attest||a.neverExecuted!==(!prepare&&!attest))
    throw new HttpsError('invalid-argument','Les attestations ne correspondent pas à cette instruction.');
  return {...d,transactionId:supportId(d.transactionId),refundIntentId:supportId(d.refundIntentId),beneficiaryId:supportAccountUid(d.beneficiaryId),
    beneficiaryEvidence,paymentEvidence,attestation:a,note:d.note.trim(),partyMessage:d.partyMessage.trim()} as ManualCommand;
}
function manualReceiptView(r:ManualData){return {protocol:'purchase_refund_external_manual_command_v1',actorId:r.actorId,requestId:r.requestId,
  command:r.command,payloadHash:r.payloadHash,state:r.state,reason:r.reason??null,instructionId:r.instructionId??null,manualState:r.manualState??'none',
  recordedAt:native(r.recordedAt)?r.recordedAt.toDate().toISOString():null,verificationBasis:r.verificationBasis??null,...MANUAL_REFUND_EFFECTS};}
async function ownManualReceipt(tx:FirebaseFirestore.Transaction,uid:string,rid:string,c:ManualCommand){
  const value=(await tx.get(manualDoc(c.transactionId,manualCommandId(uid,rid)))).data();if(!value)return null;
  if(value.protocol!=='purchase_refund_external_manual_command_v1'||value.actorId!==uid||value.requestId!==rid||value.payloadHash!==supportHash(c)||
    supportHash(value.command)!==value.payloadHash||!native(value.recordedAt)||!['committed','not_executed'].includes(value.state))
    throw new HttpsError('already-exists','Reçu manuel différent ou inconnu.');return manualReceiptView(value);
}
export async function readManualRefundDocuments(tx:FirebaseFirestore.Transaction,id:string,intent:any){
  const m=intent?.manualBankSettlement;if(!manualId(m?.instructionId)||!manualId(m?.attestationId))return null;
  const p=(await tx.get(manualDoc(id,m.instructionId))).data(),a=(await tx.get(manualDoc(id,m.attestationId))).data();
  const bi=p?.command?.beneficiaryEvidence?.evidenceId,ei=a?.command?.paymentEvidence?.evidenceId;
  if(!manualEvidenceId(bi)||!manualEvidenceId(ei))return null;
  return {preparation:p,attestation:a,beneficiary:(await tx.get(manualDoc(id,bi))).data(),payment:(await tx.get(manualDoc(id,ei))).data()};
}
export async function readManualRefundSettlement(tx:FirebaseFirestore.Transaction,id:string,order:any,intent:any):Promise<boolean>{
  const docs=await readManualRefundDocuments(tx,id,intent);return ['failed','canceled'].includes(intent.providerStatus)&&intent.cardRepairSettlement==null&&
    !intent.duplicateCardSettlementCents&&!!docs&&qualifiedManualRefundSettlement(id,order,intent,docs);
}
// Lookup identity survives a restore before provider/local outcomes. The full
// original obligation remains a separately validated claim payload.
const claimObject=(id:string,intent:any)=>`${recoveryInstallation().prefix}/permits/manual-refunds/${supportHash([id,intent.intentId,intent.allocation?.reservationHash??null])}.json`;
async function manualPolicy(){
  const q=await readFinancialRecoveryControl();
  const pin={object:process.env.FINANCIAL_RECOVERY_MANUAL_REFUND_POLICY_OBJECT??'',generation:process.env.FINANCIAL_RECOVERY_MANUAL_REFUND_POLICY_GENERATION??'',
    sha256:process.env.FINANCIAL_RECOVERY_MANUAL_REFUND_POLICY_SHA256??''};
  const bytes=await readFinancialRecoveryPinnedObject(pin);let p:any;
  try{p=JSON.parse(bytes.toString('utf8'));}catch{throw new FinancialRecoveryBlocked('manual_refund_policy_unknown');}
  const expected={protocol:'financial_recovery_manual_refund_policy_v1',installationId:q.installation.installationId,
    firestoreProjectId:q.installation.firestoreProjectId,firestoreDatabaseId:q.installation.firestoreDatabaseId,financialEnvironment:q.installation.financialEnvironment,
    stripePlatformAccountId:q.installation.stripePlatformAccountId,epoch:q.control.epoch,bucket:q.installation.bucket,
    prefix:`${q.installation.prefix}/permits/manual-refunds`,claimNamespace:'lifetime_installation_obligation',claimProtection:'temporary_hold',
    runtimeObjectPermissions:'create_get_only_no_update_delete',holdReleaseAuthority:'independent_iam_only',historicalClaimsComplete:true,
    legacyManualWritersDrained:true,lifecycleDeletion:'prevented_by_held_objects',namespaceMigration:'independently_qualified_only'};
  if(!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).length!==Object.keys(expected).length+3||Object.entries(expected).some(([k,v])=>p[k]!==v)||
    typeof p.continuityId!=='string'||!/^[A-Za-z0-9_.:-]{1,180}$/.test(p.continuityId)||!Number.isSafeInteger(p.protectedSinceMs)||p.protectedSinceMs<1||
    !Number.isSafeInteger(p.qualifiedThroughMs)||p.qualifiedThroughMs<p.protectedSinceMs||p.qualifiedThroughMs>Date.now())
    throw new FinancialRecoveryBlocked('manual_refund_store_continuity_unknown');
  return {q,policyHash:supportSourceHash(pin),storeHash:supportSourceHash(p),continuityId:p.continuityId};
}
async function manualClaim(id:string,order:any,intent:any){
  const found=await readFinancialRecoveryIdentityClaim(claimObject(id,intent));
  if(!found)return null;const v=found.value,i=recoveryInstallation();
  if(!found.temporaryHold||v.protocol!=='financial_recovery_manual_refund_claim_v1'||v.installationId!==i.installationId||v.firestoreProjectId!==i.firestoreProjectId||
    v.firestoreDatabaseId!==i.firestoreDatabaseId||v.financialEnvironment!==i.financialEnvironment||v.stripePlatformAccountId!==i.stripePlatformAccountId||
    v.obligationHash!==manualObligationHash(id,order,intent)||v.transactionId!==id||v.refundIntentId!==intent.intentId||!manualId(v.instructionId)||!hash(v.payloadHash)||
    !hash(v.policyHash)||!hash(v.storeHash)||typeof v.continuityId!=='string')throw new FinancialRecoveryBlocked('manual_refund_claim_unknown');
  return found;
}
async function reserveManualClaim(id:string,order:any,intent:any,instructionId:string,payloadHash:string){
  const policy=await manualPolicy(),old=await manualClaim(id,order,intent);
  if(old)throw new FinancialRecoveryBlocked('manual_refund_prior_claim_requires_reconciliation');
  const i=policy.q.installation,value={protocol:'financial_recovery_manual_refund_claim_v1',installationId:i.installationId,firestoreProjectId:i.firestoreProjectId,
    firestoreDatabaseId:i.firestoreDatabaseId,financialEnvironment:i.financialEnvironment,stripePlatformAccountId:i.stripePlatformAccountId,
    obligationHash:manualObligationHash(id,order,intent),transactionId:id,refundIntentId:intent.intentId,instructionId,payloadHash,
    policyHash:policy.policyHash,storeHash:policy.storeHash,continuityId:policy.continuityId};
  await createRecoveryEvidence(claimObject(id,intent),value,i);return manualClaim(id,order,intent);
}
async function reserveManualBankReference(id:string,order:any,intent:any,instructionId:string,payment:ManualData){
  const policy=await manualPolicy(),i=policy.q.installation;
  const object=`${i.prefix}/permits/manual-refunds/references/${payment.execution.referenceHash}.json`;
  const binding={protocol:'financial_recovery_manual_bank_reference_v1',installationId:i.installationId,firestoreProjectId:i.firestoreProjectId,
    firestoreDatabaseId:i.firestoreDatabaseId,financialEnvironment:i.financialEnvironment,stripePlatformAccountId:i.stripePlatformAccountId,
    obligationHash:manualObligationHash(id,order,intent),transactionId:id,refundIntentId:intent.intentId,instructionId,
    paymentEvidenceHash:payment.contentHash,referenceHash:payment.execution.referenceHash,amountCents:intent.cardAmountCents,currency:'CAD'};
  const qualify=(read:Awaited<ReturnType<typeof readFinancialRecoveryIdentityClaim>>)=>{
    if(!read?.temporaryHold||supportHash(read.value)!==supportHash(binding))throw new FinancialRecoveryBlocked('manual_bank_reference_already_bound');
  };
  const old=await readFinancialRecoveryIdentityClaim(object);
  // Recording the SAME real payment is documentary, not another permission to
  // execute it. A reference can never move to another obligation or artifact.
  if(old){qualify(old);return;}
  try{await createRecoveryEvidence(object,binding,i);}catch(e){
    if(!(e instanceof FinancialRecoveryBlocked&&e.reason==='manual_refund_claim_already_reserved'))throw e;
  }
  qualify(await readFinancialRecoveryIdentityClaim(object));
}
async function manualState(tx:FirebaseFirestore.Transaction,id:string,order:any,s:Awaited<ReturnType<typeof source>>){
  const m=order.manualRefundRestitution;if(m===undefined)return {state:s.intent.manualBankSettlement==null?'none':'unknown',marker:null,preparation:null,beneficiary:null,payment:null};
  if(m?.protocol!=='purchase_refund_manual_lock_v1'||!manualId(m.instructionId)||m.refundIntentId!==s.intent.intentId||
    m.obligationHash!==manualObligationHash(id,order,s.intent))return {state:'unknown',marker:m,preparation:null,beneficiary:null,payment:null};
  const p=(await tx.get(manualDoc(id,m.instructionId))).data();
  if(!qualifiedManualCommand(p,id,s.intent.intentId,'prepare_manual_bank_transfer')||p!.payloadHash!==m.instructionHash||p!.obligationHash!==m.obligationHash)
    return {state:'unknown',marker:m,preparation:p,beneficiary:null,payment:null};
  const b=(await tx.get(manualDoc(id,p!.command.beneficiaryEvidence.evidenceId))).data();
  const e=manualEvidenceId(m.paymentEvidenceId)?(await tx.get(manualDoc(id,m.paymentEvidenceId))).data():null;
  let state='unknown';
  if(m.state==='prepared'&&qualifiedManualEvidence(b,id,s.intent.intentId,order.buyerId,s.intent.cardAmountCents,'beneficiary_verification')&&manualReferenceMatches(b,p!.command.beneficiaryEvidence))state='prepared';
  else if(m.state==='manual_operator_attested'&&await readManualRefundSettlement(tx,id,order,s.intent))state='manual_operator_attested';
  else if(m.state==='voided'&&manualId(m.voidId)){
    const v=(await tx.get(manualDoc(id,m.voidId))).data();
    if(qualifiedManualCommand(v,id,s.intent.intentId,'void_unexecuted_manual_instruction')&&v!.command.instructionId===m.instructionId&&
      v!.command.attestation.neverExecuted===true&&m.paymentEvidenceId===null)state='voided';
  }else if(m.state==='reconciliation_required'&&s.intent.manualBankSettlement!=null)state='reconciliation_required';
  return {state,marker:m,preparation:p,beneficiary:b,payment:e};
}
/** NEW POST only; genuine provider outcomes are serviced before this guard. */
export async function manualRefundNewProviderEffectAllowed(tx:FirebaseFirestore.Transaction,id:string,order:any,intent:any){
  if(!intent?.allocation)return order.manualRefundRestitution===undefined;
  const claim=await manualClaim(id,order,intent),m=order.manualRefundRestitution;
  if(!claim&&m===undefined)return true;
  if(!m||m.refundIntentId!==intent.intentId)return false;
  const s=await source(tx,id,order,intent.intentId),state=await manualState(tx,id,order,s);
  return state.state==='voided'&&claim?.value.instructionId===m.instructionId;
}
function manualFinancialReady(s:Awaited<ReturnType<typeof source>>,id:string,revision:string|null,p:Provider|null){
  const old=publicSource(s,id,revision,p);return old.canRepairOriginalMethodNow===true&&!s.intent.manualBankSettlement&&
    !s.bankHistoryPresent&&
    s.target.every(r=>r.state==='not_executed'&&r.externalAttemptedAtMs===null||r.providerRefundId&&['failed','canceled'].includes(r.providerStatus));
}
async function manualView(tx:FirebaseFirestore.Transaction,id:string,order:any,s:Awaited<ReturnType<typeof source>>,revision:string|null,p:Provider|null,admin:boolean,
  continuityKnown=false){
  const st=await manualState(tx,id,order,s),ready=manualFinancialReady(s,id,revision,p),m=st.marker;
  const reason=!continuityKnown?'manual_refund_continuity_unqualified':!s.localVerified?'local_movements_unqualified':s.blocked?'bank_review_required':!s.riskClear?'risk_review_required':
    !ready&&st.state!=='manual_operator_attested'?'original_rail_terminal_proof_required':st.state==='unknown'?'manual_native_state_unknown':null;
  return {protocol:'purchase_refund_external_manual_source_v1',transactionId:id,refundIntentId:s.intent.intentId,sourceHash:s.sourceHash,sourceRevision:revision,
    beneficiaryId:order.buyerId,amountCents:s.intent.cardAmountCents,currency:'CAD',remainingCents:st.state==='manual_operator_attested'?0:p?.qualification==='current_original_method_capacity'?s.intent.cardAmountCents:null,
    localMovementsVerified:s.localVerified,originalRailTerminalVerified:ready,bankReviewRequired:s.blocked,riskReviewRequired:!s.riskClear,state:st.state,
    instructionId:manualId(m?.instructionId)?m.instructionId:null,instructionHash:admin&&hash(m?.instructionHash)?m.instructionHash:null,
    beneficiaryEvidence:admin&&qualifiedManualEvidence(st.beneficiary??undefined,id,s.intent.intentId,order.buyerId,s.intent.cardAmountCents,'beneficiary_verification')?manualEvidenceReference(st.beneficiary!):null,
    paymentEvidence:admin&&qualifiedManualEvidence(st.payment??undefined,id,s.intent.intentId,order.buyerId,s.intent.cardAmountCents,'payment_execution')?manualEvidenceReference(st.payment!):null,
    canPrepare:admin&&continuityKnown&&ready&&st.state==='none',canAttest:admin&&continuityKnown&&ready&&st.state==='prepared',
    canVoid:admin&&continuityKnown&&ready&&st.state==='prepared'&&m?.paymentEvidenceId===null,
    reason,verificationBasis:st.state==='manual_operator_attested'?'human_operator_attestation':null,...MANUAL_REFUND_EFFECTS};
}
async function manualFinancialReviewResolved(tx:FirebaseFirestore.Transaction,id:string,order:any,s:Awaited<ReturnType<typeof source>>,selected:any,p:Provider){
  if(s.blocked||!s.riskClear||!s.complete||p.qualification!=='current_original_method_capacity'||typeof order.refundBlocked!=='boolean'||
    typeof order.refundAllocationState?.reviewRequired!=='boolean'||own(order,'refundLegacyReconciliationRequired')&&order.refundLegacyReconciliationRequired!==false)return false;
  for(const item of s.nativeAllocations){
    const i=item.intent.intentId===selected.intentId?selected:item.intent;
    if(i.state!=='succeeded'||i.outstandingCardCents!==0||i.freezeCents!==0||i.bankWaiting||i.legacyReconciliationRequired||
      !await allocationLocalMovementsVerified(tx,id,order,i,item.record))return false;
    if(i.intentId===selected.intentId||i.cardAmountCents===0)continue;
    if(i.manualBankSettlement!=null){if(!await readManualRefundSettlement(tx,id,order,i))return false;continue;}
    const ids=new Set(s.bindings.filter(b=>b.intentId===i.intentId).map(b=>b.refundId)),proofs=p.refunds.filter(f=>ids.has(f.id));
    if(proofs.length!==ids.size||proofs.filter(f=>f.status==='succeeded').reduce((n,f)=>n+f.amountCents,0)!==i.cardAmountCents||
      proofs.some(f=>f.status!=='succeeded'&&!(['failed','canceled'].includes(f.status!)&&f.failureFundsReturnedToStripe)))return false;
  }
  return true;
}
function manualJpeg(bytes:Buffer){
  if(bytes.length<16||bytes[0]!==255||bytes[1]!==216||bytes.at(-2)!==255||bytes.at(-1)!==217)throw new HttpsError('invalid-argument','JPEG préparé requis.');
  let p=2,dim:{width:number;height:number}|null=null;
  for(let n=0;n<200&&p+3<bytes.length;n++){
    if(bytes[p++]!==255)break;while(bytes[p]===255)p++;const m=bytes[p++];if(m===218){if(dim)return dim;break;}
    if([217,0,216].includes(m)||p+2>bytes.length)break;const len=bytes.readUInt16BE(p);if(len<2||p+len>bytes.length)break;
    if([192,194].includes(m)){if(len<11||bytes[p+2]!==8||![1,3].includes(bytes[p+7])||len!==8+3*bytes[p+7])break;
      dim={height:bytes.readUInt16BE(p+3),width:bytes.readUInt16BE(p+5)};}p+=len;
  }throw new HttpsError('invalid-argument','Dimensions JPEG non qualifiées.');
}
function evidenceReceipt(r:ManualData|undefined,uid:string,rid:string,id:string,intentId:string,inputHash:string){
  return {protocol:'purchase_refund_external_manual_evidence_v1',actorId:uid,requestId:rid,transactionId:id,refundIntentId:intentId,
    beneficiaryId:r?.beneficiaryId??null,amountCents:r?.amountCents??null,currency:'CAD',purpose:r?.purpose??null,instructionId:r?.instructionId??null,inputHash,
    state:r?.state==='not_executed'?'not_executed':r?.state==='stored'?'stored':r?.state==='stored_requires_review'?'stored_requires_review':r?'upload_unknown':'unrecorded',
    reason:r?.reason??null,evidence:r?.state==='stored'||r?.state==='stored_requires_review'?manualEvidenceReference(r):null,
    recordedAt:native(r?.recordedAt)?r!.recordedAt.toDate().toISOString():null,externalAuthenticityVerified:false,bankArrivalVerified:false};
}
function qualifiedEvidenceIntent(r:any,uid:string,rid:string,id:string,intentId:string,inputHash:string){
  return r?.protocol==='purchase_refund_manual_evidence_record_v1'&&r.actorId===uid&&r.requestId===rid&&r.transactionId===id&&r.refundIntentId===intentId&&
    r.evidenceId===evidenceKey(uid,rid)&&r.inputHash===inputHash&&['upload_reserved','stored','stored_requires_review','not_executed'].includes(r.state)&&native(r.reservedAt);
}
async function observeManualFile(r:ManualData){
  if(typeof r.privatePath!=='string'||r.privatePath!==`refund_manual_evidence/${supportHash([r.transactionId,r.refundIntentId])}/${r.evidenceId}.jpg`)
    throw new HttpsError('failed-precondition','Chemin privé natif inconnu.');
  const recorded=r.state==='stored'||r.state==='stored_requires_review',pin=r.storageProof;
  if(recorded?(pin?.protocol!=='native_manual_refund_evidence_storage_v1'||typeof pin.generation!=='string'||!/^\d{1,30}$/.test(pin.generation)||
    typeof pin.crc32c!=='string'||!pin.crc32c||pin.sha256!==r.file?.sha256||pin.byteLength!==r.file?.byteLength||
    pin.contentType!=='image/jpeg'||pin.temporaryHold!==true||!native(pin.observedAt)):
    r.state!=='upload_reserved'||pin!==null)
    throw new HttpsError('failed-precondition','Témoin natif de génération non qualifié.');
  const bucket=storage.bucket(),[m]=await bucket.file(r.privatePath).getMetadata();
  const generation=String(m.generation??'');
  if(!/^\d{1,30}$/.test(generation)||m.contentType!=='image/jpeg'||Number(m.size)!==r.file.byteLength||typeof m.crc32c!=='string'||!m.crc32c||
    m.metadata?.inputHash!==r.inputHash||m.metadata?.evidenceId!==r.evidenceId||m.temporaryHold!==true)
    throw new HttpsError('failed-precondition','Métadonnées natives de preuve divergentes.');
  // Once received, even identical bytes at a later generation are another
  // source. Only upload_reserved may establish its FIRST immutable pin.
  if(recorded&&(generation!==pin.generation||m.crc32c!==pin.crc32c))
    throw new HttpsError('failed-precondition','La génération native du justificatif a changé.');
  const [bytes]=await bucket.file(r.privatePath,{generation:recorded?pin.generation:generation}).download({validation:'crc32c'});
  if(bytes.length!==r.file.byteLength||binaryHash(bytes)!==r.file.sha256||supportHash(manualJpeg(bytes))!==supportHash({width:r.file.width,height:r.file.height}))
    throw new HttpsError('failed-precondition','Bytes natifs de preuve divergents.');
  return {bytes,proof:{protocol:'native_manual_refund_evidence_storage_v1',generation,crc32c:m.crc32c,sha256:binaryHash(bytes),byteLength:bytes.length,
    contentType:'image/jpeg',temporaryHold:true,observedAt:Timestamp.now()}};
}
async function serviceManualEvidence(uid:string,rid:string,id:string,intentId:string,inputHash:string){
  const first=await db.runTransaction(async tx=>{const r=(await tx.get(manualDoc(id,evidenceKey(uid,rid)))).data();
    if(r&&!qualifiedEvidenceIntent(r,uid,rid,id,intentId,inputHash))throw new HttpsError('already-exists','Dépôt privé différent.');return r;});
  if(!first||first.state!=='upload_reserved')return evidenceReceipt(first,uid,rid,id,intentId,inputHash);
  let stored:Awaited<ReturnType<typeof observeManualFile>>;
  try{stored=await observeManualFile(first);}catch(e){if(e instanceof FinancialRecoveryBlocked)throw e;return evidenceReceipt(first,uid,rid,id,intentId,inputHash);}
  return db.runTransaction(async tx=>{const r=(await tx.get(manualDoc(id,first.evidenceId))).data();
    if(!qualifiedEvidenceIntent(r,uid,rid,id,intentId,inputHash))throw new HttpsError('failed-precondition','Intention privée divergente.');
    if(r!.state!=='upload_reserved')return evidenceReceipt(r,uid,rid,id,intentId,inputHash);
    const order=(await tx.get(ref(id))).data();let current=false;
    if(order)try{const s=await source(tx,id,order,intentId);current=manualObligationHash(id,order,s.intent)===r!.obligationHash&&
      (r!.purpose==='beneficiary_verification'||order.manualRefundRestitution?.instructionId===r!.instructionId&&order.manualRefundRestitution?.paymentEvidenceId===r!.evidenceId);}
      catch(e){if(e instanceof FinancialRecoveryBlocked)throw e;}
    const next:ManualData={...r!,state:current?'stored':'stored_requires_review',storageProof:stored.proof,recordedAt:Timestamp.now(),reason:current?null:'source_changed'};
    next.contentHash=supportSourceHash(manualEvidenceContent(next));
    tx.update(manualDoc(id,first.evidenceId),next);return evidenceReceipt(next,uid,rid,id,intentId,inputHash);
  });
}
function bankDay(d:Date){return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);}
function exactBankDay(v:any,createdAt:Timestamp){return typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&
  Number.isFinite(Date.parse(v+'T12:00:00Z'))&&new Date(v+'T12:00:00Z').toISOString().slice(0,10)===v&&v>=bankDay(createdAt.toDate())&&v<=bankDay(new Date());}
async function manualEvidenceOperation(request:any,uid:string,raw:any){
  const observe=raw.modeAction==='observe'||raw.modeAction==='neutralize';
  if(observe)supportObject(raw,['mode','capability','expectedUid','requestId','modeAction','transactionId','refundIntentId','expectedInputHash']);
  else supportObject(raw,['mode','capability','expectedUid','requestId','modeAction','transactionId','refundIntentId','previewId','sourceHash','sourceRevision','purpose','instructionId','file','bytesBase64','execution']);
  if(!['execute','observe','neutralize'].includes(raw.modeAction))throw new HttpsError('invalid-argument','Action de dépôt inconnue.');
  const id=supportId(raw.transactionId),intentId=supportId(raw.refundIntentId),rid=supportRequestId(raw.requestId),key=evidenceKey(uid,rid);
  if(observe){if(!hash(raw.expectedInputHash))throw new HttpsError('invalid-argument','Hash du dépôt requis.');
    await db.runTransaction(async tx=>{const old=(await tx.get(manualDoc(id,key))).data();
      if(old&&!qualifiedEvidenceIntent(old,uid,rid,id,intentId,raw.expectedInputHash))throw new HttpsError('already-exists','Dépôt privé différent.');
      if(!old&&raw.modeAction==='neutralize')tx.create(manualDoc(id,key),{protocol:'purchase_refund_manual_evidence_record_v1',actorId:uid,requestId:rid,transactionId:id,
        refundIntentId:intentId,evidenceId:key,inputHash:raw.expectedInputHash,state:'not_executed',reason:'requester_neutralized',reservedAt:Timestamp.now(),recordedAt:Timestamp.now()});
    });return serviceManualEvidence(uid,rid,id,intentId,raw.expectedInputHash);
  }
  const f=supportObject(raw.file,['sha256','byteLength','contentType','width','height']);
  if(!hash(raw.previewId)||!hash(raw.sourceHash)||!exactRevision(raw.sourceRevision)||!['beneficiary_verification','payment_execution'].includes(raw.purpose)||
    !(raw.instructionId===null||manualId(raw.instructionId))||!hash(f.sha256)||!Number.isSafeInteger(f.byteLength)||f.byteLength<1||f.byteLength>2*1024*1024||
    f.contentType!=='image/jpeg'||!['width','height'].every(k=>Number.isSafeInteger(f[k])&&f[k]>=1&&f[k]<=1200))throw new HttpsError('invalid-argument','Fichier préparé et sources exactes requis.');
  let execution:null|{referenceHash:string;executedDate:string}=null;
  if(raw.purpose==='payment_execution'){
    const e=supportObject(raw.execution,['transferReference','executedDate']);
    if(typeof e.transferReference!=='string'||e.transferReference.trim().normalize('NFC').length<3||e.transferReference.length>200||/[\u0000-\u001f\u007f]/.test(e.transferReference)||!manualId(raw.instructionId))
      throw new HttpsError('invalid-argument','Référence bancaire privée bornée requise.');
    execution={referenceHash:supportHash(e.transferReference.trim().normalize('NFC').toUpperCase()),executedDate:e.executedDate};
  }else if(raw.execution!==null||raw.instructionId!==null)throw new HttpsError('invalid-argument','La preuve de bénéficiaire précède l’instruction.');
  const input={transactionId:id,refundIntentId:intentId,previewId:raw.previewId,sourceHash:raw.sourceHash,sourceRevision:raw.sourceRevision,
    purpose:raw.purpose,instructionId:raw.instructionId,file:f,execution},inputHash=supportHash(input);
  // Native own receipt FIRST. Existing deposits never need volatile bytes again.
  const existing=await db.runTransaction(async tx=>{const r=(await tx.get(manualDoc(id,key))).data();
    if(r&&!qualifiedEvidenceIntent(r,uid,rid,id,intentId,inputHash))throw new HttpsError('already-exists','Dépôt privé différent.');return r;});
  if(existing)return serviceManualEvidence(uid,rid,id,intentId,inputHash);
  if(typeof raw.bytesBase64!=='string'||raw.bytesBase64.length>Math.ceil(2*1024*1024/3)*4||raw.bytesBase64.length%4!==0||! /^(?:[A-Za-z0-9+/]+={0,2})$/.test(raw.bytesBase64))
    throw new HttpsError('invalid-argument','Bytes JPEG bornés requis.');
  const bytes=Buffer.from(raw.bytesBase64,'base64');
  if(bytes.toString('base64')!==raw.bytesBase64||bytes.length!==f.byteLength||binaryHash(bytes)!==f.sha256||supportHash(manualJpeg(bytes))!==supportHash({width:f.width,height:f.height}))
    throw new HttpsError('invalid-argument','Fichier différent de l’intention.');
  const reserved=await db.runTransaction(async tx=>{
    const prior=(await tx.get(manualDoc(id,key))).data();
    if(prior){if(!qualifiedEvidenceIntent(prior,uid,rid,id,intentId,inputHash))throw new HttpsError('already-exists','Dépôt privé différent.');return null;}
    await operator(tx,request);const snap=await tx.get(ref(id)),order=snap.data();if(!order)throw new HttpsError('not-found','Commande introuvable.');
    const s=await source(tx,id,order,intentId),st=await manualState(tx,id,order,s),preview=(await tx.get(previewRef(id,raw.previewId))).data();
    if(preview?.protocol!=='purchase_refund_external_manual_preview_v1'||preview.actorId!==uid||preview.sourceHash!==s.sourceHash||preview.sourceRevision!==supportRevision(snap)||
      raw.sourceHash!==s.sourceHash||raw.sourceRevision!==supportRevision(snap)||!native(preview.createdAt)||Date.now()-preview.createdAt.toMillis()>300000||
      !manualFinancialReady(s,id,supportRevision(snap),preview.provider))throw new HttpsError('failed-precondition','Aperçu actuel et obligation native requis.');
    if(raw.purpose==='beneficiary_verification'?st.state!=='none'||preview.action!=='prepare_manual_bank_transfer':
      st.state!=='prepared'||st.marker?.instructionId!==raw.instructionId||st.marker.paymentEvidenceId!==null||preview.action!=='attest_manual_bank_transfer'||!exactBankDay(execution!.executedDate,st.preparation!.recordedAt))
      throw new HttpsError('failed-precondition','Instruction et destination natives requises.');
    const value={protocol:'purchase_refund_manual_evidence_record_v1',evidenceId:key,actorId:uid,requestId:rid,transactionId:id,refundIntentId:intentId,
      beneficiaryId:order.buyerId,sellerId:order.sellerId,amountCents:s.intent.cardAmountCents,currency:'CAD',purpose:raw.purpose,instructionId:raw.instructionId,
      instructionHash:st.preparation?.payloadHash??null,obligationHash:manualObligationHash(id,order,s.intent),sourceHash:s.sourceHash,sourceRevision:supportRevision(snap),inputHash,
      file:f,privatePath:`refund_manual_evidence/${supportHash([id,intentId])}/${key}.jpg`,execution,state:'upload_reserved',reservedAt:Timestamp.now(),recordedAt:null,storageProof:null,contentHash:null};
    const fields=raw.purpose==='payment_execution'?await financialRecoverySourceFields('purchase',ref(id),order,{'manualRefundRestitution.paymentEvidenceId':key}):null;
    const checkpoint=financialRecoveryCommitCheckpoint();await checkpoint({refs:[manualDoc(id,key).path,...fields?[ref(id).path]:[]]});
    tx.create(manualDoc(id,key),value);if(fields)tx.update(ref(id),fields);return value;
  });
  if(reserved){
    // A create-only held object cannot be overwritten by an old/later sender.
    await db.runTransaction(tx=>operator(tx,request));
    try{await storage.bucket().file(reserved.privatePath).save(bytes,{resumable:false,validation:'crc32c',preconditionOpts:{ifGenerationMatch:0},
      metadata:{contentType:'image/jpeg',cacheControl:'private, no-store',temporaryHold:true,metadata:{evidenceId:key,inputHash}}});}
    catch(e){if(e instanceof FinancialRecoveryBlocked)throw e;/* GET-only observation below owns response-loss recovery. */}
  }
  return serviceManualEvidence(uid,rid,id,intentId,inputHash);
}
async function handleManualRefund(request:any,uid:string,raw:any):Promise<any>{
  if(raw.mode==='purchase_refund_manual_evidence_upload')return manualEvidenceOperation(request,uid,raw);
  if(raw.mode==='purchase_refund_manual_evidence_read'){
    supportObject(raw,['mode','capability','expectedUid','transactionId','refundIntentId','evidence']);
    const id=supportId(raw.transactionId),intentId=supportId(raw.refundIntentId),reference=parseManualReference(raw.evidence);
    if(!reference)throw new HttpsError('invalid-argument','Preuve native requise.');
    const r=await db.runTransaction(async tx=>{await operator(tx,request);const r=(await tx.get(manualDoc(id,reference.evidenceId))).data();
      if(!r||r.transactionId!==id||r.refundIntentId!==intentId||!['stored','stored_requires_review'].includes(r.state)||!manualReferenceMatches(r,reference))
        throw new HttpsError('failed-precondition','Preuve privée non qualifiée.');return r;});
    const stored=await observeManualFile(r);if(stored.proof.generation!==reference.generation||stored.proof.sha256!==reference.sha256)
      throw new HttpsError('failed-precondition','Génération de preuve différente.');
    await db.runTransaction(tx=>operator(tx,request));return {protocol:'purchase_refund_external_manual_evidence_file_v1',actorId:uid,transactionId:id,
      refundIntentId:intentId,evidence:reference,purpose:r.purpose,dataUrl:'data:image/jpeg;base64,'+stored.bytes.toString('base64'),bankArrivalVerified:false};
  }
  if(raw.mode==='purchase_refund_repair_source_observe'){
    supportObject(raw,['mode','capability','expectedUid','transactionId','refundIntentId','scope','cursor','instructionCursor']);
    if(!['own','admin'].includes(raw.scope))throw new HttpsError('invalid-argument','Portée native requise.');
    const id=supportId(raw.transactionId),intentId=raw.refundIntentId==null?null:supportId(raw.refundIntentId);
    return db.runTransaction(async tx=>{
      if(raw.scope==='admin'){await supportCurrentAdminSession(request);await supportAdmin(tx,uid,false);}
      const snap=await tx.get(ref(id)),order=snap.data();if(!order||raw.scope==='own'&&![order.buyerId,order.sellerId].includes(uid))throw new HttpsError('permission-denied','Partie native requise.');
      let selected=null,reason=null;if(intentId)try{const s=await source(tx,id,order,intentId);selected=await manualView(tx,id,order,s,supportRevision(snap),null,raw.scope==='admin');}
      catch(e){if(e instanceof FinancialRecoveryBlocked)throw e;if(!(e instanceof HttpsError))throw e;reason='manual_native_source_unknown';}
      return {protocol:'purchase_refund_external_manual_observation_v1',actorId:uid,scope:raw.scope,transactionId:id,sourceRevision:supportRevision(snap),selected,reason};
    });
  }
  if(raw.mode==='purchase_refund_repair_preview'){
    supportObject(raw,['mode','capability','expectedUid','transactionId','refundIntentId','action']);
    if(!manualActions.includes(raw.action))throw new HttpsError('invalid-argument','Instruction manuelle inconnue.');
    const id=supportId(raw.transactionId),intentId=supportId(raw.refundIntentId);
    await db.runTransaction(tx=>operator(tx,request));const initial=await load(id,intentId);
    const provider=await observeProvider(initial.s.intent.paymentIntentId,initial.order.stripeChargeId,initial.s.intent.capturedCardCents,initial.s.bindings);
    let continuityKnown=false;try{await manualPolicy();const claim=await manualClaim(id,initial.order,initial.s.intent);
      continuityKnown=initial.order.manualRefundRestitution===undefined?!claim:claim?.value.instructionId===initial.order.manualRefundRestitution.instructionId;
    }catch(e){if(!(e instanceof FinancialRecoveryBlocked))throw e;}
    return db.runTransaction(async tx=>{await operator(tx,request);const snap=await tx.get(ref(id)),order=snap.data();if(!order)throw new HttpsError('not-found','Commande introuvable.');
      const s=await source(tx,id,order,intentId);if(s.sourceHash!==initial.s.sourceHash||supportRevision(snap)!==initial.revision)throw new HttpsError('aborted','Sources modifiées.');
      const v=await manualView(tx,id,order,s,supportRevision(snap),provider,true,continuityKnown),previewId=supportHash([uid,id,intentId,raw.action,s.sourceHash,provider.proofHash,continuityKnown]);
      const previous=await tx.get(previewRef(id,previewId));if(!previous.exists){const checkpoint=financialRecoveryCommitCheckpoint();await checkpoint({refs:[previewRef(id,previewId).path]});
        tx.create(previewRef(id,previewId),{protocol:'purchase_refund_external_manual_preview_v1',actorId:uid,previewId,transactionId:id,refundIntentId:intentId,action:raw.action,
          sourceHash:s.sourceHash,sourceRevision:supportRevision(snap),provider,continuityKnown,createdAt:Timestamp.now()});}
      return {protocol:'purchase_refund_external_manual_preview_v1',actorId:uid,previewId,action:raw.action,source:v,bankArrivalVerified:false,stripeSettlementGranted:false};
    });
  }
  if(raw.mode!=='purchase_refund_repair_command')throw new HttpsError('invalid-argument','Mode manuel inconnu.');
  supportObject(raw,['mode','capability','expectedUid','requestId','modeAction','command']);
  if(!['execute','recover','observe','neutralize'].includes(raw.modeAction))throw new HttpsError('invalid-argument','Action de journal inconnue.');
  const c=parseManualCommand(raw.command),rid=supportRequestId(raw.requestId),cid=manualCommandId(uid,rid),payloadHash=supportHash(c);
  type ExecutionSource={order:ManualData;revision:string|null;s:Awaited<ReturnType<typeof source>>;st:Awaited<ReturnType<typeof manualState>>;
    b:ManualData|undefined;e:ManualData|undefined|null};
  const initial=await db.runTransaction<{done:ReturnType<typeof manualReceiptView>}|ExecutionSource>(async tx=>{
    const previous=await ownManualReceipt(tx,uid,rid,c);if(previous)return {done:previous};
    const base={protocol:'purchase_refund_external_manual_command_v1',actorId:uid,requestId:rid,command:c,payloadHash,state:'unrecorded',reason:null,
      instructionId:null,manualState:'none',recordedAt:null,verificationBasis:null};
    if(raw.modeAction==='observe'||raw.modeAction==='recover')return {done:manualReceiptView(base)};
    if(raw.modeAction==='neutralize'){const value={...base,state:'not_executed',reason:'requester_neutralized',recordedAt:Timestamp.now()};
      tx.create(manualDoc(c.transactionId,cid),value);return {done:manualReceiptView(value)};}
    await operator(tx,request);const snap=await tx.get(ref(c.transactionId)),order=snap.data();if(!order)throw new HttpsError('not-found','Commande introuvable.');
    const s=await source(tx,c.transactionId,order,c.refundIntentId),preview=(await tx.get(previewRef(c.transactionId,c.previewId))).data();
    if(preview?.protocol!=='purchase_refund_external_manual_preview_v1'||preview.actorId!==uid||preview.action!==c.action||preview.sourceHash!==c.sourceHash||
      preview.sourceRevision!==c.sourceRevision||!native(preview.createdAt)||Date.now()-preview.createdAt.toMillis()>300000||preview.continuityKnown!==true||
      s.sourceHash!==c.sourceHash||supportRevision(snap)!==c.sourceRevision||c.amountCents!==s.intent.cardAmountCents||c.beneficiaryId!==order.buyerId)
      throw new HttpsError('failed-precondition','Aperçu et source actuels requis.');
    const st=await manualState(tx,c.transactionId,order,s),b=(await tx.get(manualDoc(c.transactionId,c.beneficiaryEvidence!.evidenceId))).data();
    const e=c.paymentEvidence?(await tx.get(manualDoc(c.transactionId,c.paymentEvidence.evidenceId))).data():null;
    if(!qualifiedManualEvidence(b,c.transactionId,c.refundIntentId,order.buyerId,c.amountCents,'beneficiary_verification')||!manualReferenceMatches(b,c.beneficiaryEvidence)||
      b!.obligationHash!==manualObligationHash(c.transactionId,order,s.intent)||(c.action==='prepare_manual_bank_transfer'?(st.state!=='none'):
      st.state!=='prepared'||st.marker?.instructionId!==c.instructionId))throw new HttpsError('failed-precondition','Preuves et instruction natives requises.');
    return {order,revision:supportRevision(snap),s,st,b,e};
  });
  if('done'in initial)return initial.done;
  const pre=initial;
  const provider=await observeProvider(pre.s.intent.paymentIntentId,pre.order.stripeChargeId,pre.s.intent.capturedCardCents,pre.s.bindings);
  if(!manualFinancialReady(pre.s,c.transactionId,pre.revision,provider))throw new HttpsError('failed-precondition','Échec terminal et retour des fonds Stripe non qualifiés.');
  await manualPolicy();
  await observeManualFile(pre.b!);
  if(c.action==='attest_manual_bank_transfer'){
    if(!qualifiedManualEvidence(pre.e!,c.transactionId,c.refundIntentId,pre.order.buyerId,c.amountCents,'payment_execution')||!manualReferenceMatches(pre.e!,c.paymentEvidence)||
      pre.e!.instructionId!==c.instructionId||pre.e!.obligationHash!==manualObligationHash(c.transactionId,pre.order,pre.s.intent)||
      pre.e!.instructionHash!==pre.st.preparation?.payloadHash)throw new HttpsError('failed-precondition','Preuve bancaire exécutée native requise.');
    await observeManualFile(pre.e!);
    await reserveManualBankReference(c.transactionId,pre.order,pre.s.intent,c.instructionId!,pre.e!);
  }
  if(c.action==='prepare_manual_bank_transfer')await reserveManualClaim(c.transactionId,pre.order,pre.s.intent,cid,payloadHash);
  else {const claim=await manualClaim(c.transactionId,pre.order,pre.s.intent);
    if(!claim||claim.value.instructionId!==c.instructionId||claim.value.payloadHash!==pre.st.preparation?.payloadHash)throw new FinancialRecoveryBlocked('manual_refund_claim_changed');}
  return db.runTransaction(async tx=>{
    const previous=await ownManualReceipt(tx,uid,rid,c);if(previous)return previous;
    await operator(tx,request);const snap=await tx.get(ref(c.transactionId)),order=snap.data();if(!order)throw new HttpsError('not-found','Commande introuvable.');
    const s=await source(tx,c.transactionId,order,c.refundIntentId),st=await manualState(tx,c.transactionId,order,s);
    if(s.sourceHash!==c.sourceHash||supportRevision(snap)!==c.sourceRevision||!manualFinancialReady(s,c.transactionId,c.sourceRevision,provider))throw new HttpsError('aborted','Sources modifiées.');
    const claim=await manualClaim(c.transactionId,order,s.intent);
    if(!claim||claim.value.instructionId!==(c.action==='prepare_manual_bank_transfer'?cid:c.instructionId)||claim.value.payloadHash!==(c.action==='prepare_manual_bank_transfer'?payloadHash:st.preparation?.payloadHash))
      throw new FinancialRecoveryBlocked('manual_refund_claim_changed');
    const now=Timestamp.now(),instructionId=c.action==='prepare_manual_bank_transfer'?cid:c.instructionId!,state=c.action==='prepare_manual_bank_transfer'?'prepared':c.action==='attest_manual_bank_transfer'?'manual_operator_attested':'voided';
    const receipt={protocol:'purchase_refund_external_manual_command_v1',actorId:uid,requestId:rid,command:c,payloadHash,state:'committed',reason:null,instructionId,
      manualState:state,recordedAt:now,verificationBasis:state==='manual_operator_attested'?'human_operator_attestation':null,
      provider,targetRefundIds:s.bindings.filter(b=>b.intentId===c.refundIntentId).map(b=>b.refundId).sort(),
      buyerId:order.buyerId,sellerId:order.sellerId,obligationHash:manualObligationHash(c.transactionId,order,s.intent),authority:{privateRoleAtCommit:true,authTime:request.auth.token.auth_time}};
    let marker:any,selected:any=null;
    const b=(await tx.get(manualDoc(c.transactionId,c.beneficiaryEvidence!.evidenceId))).data(),e=c.paymentEvidence?(await tx.get(manualDoc(c.transactionId,c.paymentEvidence.evidenceId))).data():null;
    if(!qualifiedManualEvidence(b,c.transactionId,c.refundIntentId,order.buyerId,c.amountCents,'beneficiary_verification')||!manualReferenceMatches(b,c.beneficiaryEvidence)||
      b!.contentHash!==pre.b!.contentHash)throw new HttpsError('aborted','Preuve bénéficiaire modifiée.');
    if(c.action==='prepare_manual_bank_transfer'){
      if(st.state!=='none')throw new HttpsError('aborted','Une instruction existe déjà.');
      marker={protocol:'purchase_refund_manual_lock_v1',refundIntentId:c.refundIntentId,obligationHash:receipt.obligationHash,instructionId,instructionHash:payloadHash,state,
        amountCents:c.amountCents,beneficiaryId:order.buyerId,beneficiaryEvidenceId:b!.evidenceId,paymentEvidenceId:null,attestationId:null,recordedAt:now,updatedAt:now};
    }else{
      if(st.state!=='prepared'||st.marker?.instructionId!==c.instructionId||!manualReferenceMatches(b,st.preparation!.command.beneficiaryEvidence))throw new HttpsError('aborted','Instruction modifiée.');
      marker={...st.marker,state,updatedAt:now};
      if(c.action==='void_unexecuted_manual_instruction'){
        if(st.marker.paymentEvidenceId!==null)throw new HttpsError('failed-precondition','Une preuve d’exécution est réservée : revue requise.');marker.voidId=cid;
      }else{
        if(!qualifiedManualEvidence(e??undefined,c.transactionId,c.refundIntentId,order.buyerId,c.amountCents,'payment_execution')||!manualReferenceMatches(e??undefined,c.paymentEvidence)||
          e!.contentHash!==pre.e!.contentHash||st.marker.paymentEvidenceId!==e!.evidenceId||e!.instructionHash!==st.preparation!.payloadHash||
          !exactBankDay(e!.execution?.executedDate,st.preparation!.recordedAt))throw new HttpsError('aborted','Preuve bancaire modifiée.');
        const uniqueRef=db.collection('platform_ledger').doc('manual_bank_transfer_'+e!.execution.referenceHash),used=await tx.get(uniqueRef);
        if(used.exists)throw new HttpsError('already-exists','Cette référence bancaire est déjà rapprochée.');
        const settlement:any={protocol:'purchase_refund_manual_settlement_v1',verificationBasis:'human_operator_attestation',instructionId,attestationId:cid,
          amountCents:c.amountCents,beneficiaryId:order.buyerId,obligationHash:receipt.obligationHash,recordedAt:now,beneficiaryEvidenceHash:b!.contentHash,paymentEvidenceHash:e!.contentHash,
          transferReferenceHash:e!.execution.referenceHash,executedDate:e!.execution.executedDate,attestationHash:payloadHash,preparationHash:st.preparation!.payloadHash};
        settlement.recordHash=supportSourceHash(settlement);
        selected={...s.intent,state:'succeeded',outstandingCardCents:0,manualBankSettlement:settlement,manualConfirmedCents:c.amountCents,
          cardSatisfiedVia:'human_operator_attested_bank_transfer',watch:true,watchUntilMs:Date.now()+31*86400000};
        // Keep genuine Stripe status and confirmed cents unchanged.
        if(!qualifiedManualRefundSettlement(c.transactionId,order,selected,{preparation:st.preparation!,attestation:receipt,beneficiary:b,payment:e??undefined}))
          throw new HttpsError('failed-precondition','Règlement manuel non qualifié.');
        marker.attestationId=cid;
        // All reads/plans finish before this reserved uniqueness write.
        marker.uniqueReference={ref:uniqueRef,document:{type:'manual_bank_transfer_reference',protocol:'purchase_refund_manual_reference_v1',transactionId:c.transactionId,
          refundIntentId:c.refundIntentId,instructionId,attestationId:cid,referenceHash:e!.execution.referenceHash,amountCents:c.amountCents,currency:'CAD',createdAt:now}};
      }
    }
    const unique=marker.uniqueReference;delete marker.uniqueReference;
    const reviewResolved=selected&&await manualFinancialReviewResolved(tx,c.transactionId,order,s,selected,provider);
    const update:any={manualRefundRestitution:marker,...selected&&!s.historical?{refund:selected}:{}};
    if(reviewResolved){update.refundBlocked=false;update['refundAllocationState.reviewRequired']=false;
      if(['refund_action_required','refund_in_progress'].includes(order.status)&&order.disputed!==true&&
        s.claims.docs.every(c=>['closed','resolved','dismissed'].includes(c.data().status))){const latest=s.historical?order.refund:selected;
        if(latest.allocation.terms.settlementKind==='full_remaining')update.status='refunded';
        else if(['paid','label_created','shipped','delivered','return_requested','completed','meetup_completed'].includes(latest.originalStatus))update.status=latest.originalStatus;
      }
    }
    const orderFields=await financialRecoverySourceFields('purchase',ref(c.transactionId),order,update);
    const accountingOrder={...order,...reviewResolved?{refundBlocked:false,refundAllocationState:{...order.refundAllocationState,reviewRequired:false}}:{}};
    const accounting=selected?await preparePurchasePlatformAccounting(tx,c.transactionId,accountingOrder,{refundIntentId:c.refundIntentId}):null;
    const manualDocuments=selected?{preparation:st.preparation!,attestation:receipt,beneficiary:b!,payment:e!}:null;
    const fiscalProjection=selected?{order:sellerTaxFinancialOrderAfter(order,orderFields),refund:{intent:selected,settlement:s.allocation.settlement,manualDocuments:manualDocuments!}}:null;
    const fiscal=fiscalProjection?await prepareSellerTaxFinancialEvent(tx,order.sellerId,{kind:'purchase_refund',id:c.transactionId,refundIntentId:c.refundIntentId},fiscalProjection):null;
    const notices=await prepareOperationalNotices(tx,[order.buyerId,order.sellerId].map(userId=>({eventKey:`manual_refund:${cid}`,userId,type:'order_moderation',title:'Suivi de la restitution',
      message:c.partyMessage,data:{ownerId:userId,transactionId:c.transactionId,refundIntentId:c.refundIntentId,manualState:state,bankArrivalVerified:'false'}})));
    const checkpoint=financialRecoveryCommitCheckpoint();await checkpoint({refs:[ref(c.transactionId).path,manualDoc(c.transactionId,cid).path]});
    if(fiscal&&fiscalProjection)fiscal.commit(fiscalProjection);
    if(accounting&&selected)accounting.commit({intent:selected,manualDocuments:manualDocuments!});
    if(unique)tx.create(unique.ref,unique.document);
    if(selected&&s.historical)tx.update(refundHistoryRef(c.transactionId,c.refundIntentId),{currentIntent:selected});
    tx.update(ref(c.transactionId),orderFields);tx.create(manualDoc(c.transactionId,cid),receipt);notices.commit();return manualReceiptView(receipt);
  });
}

/** Preserve the real manual event while fresh original Stripe contradictions
 * reopen review. No local financial writer is re-entered. */
async function prepareManualOriginalObservation(tx:FirebaseFirestore.Transaction,id:string,order:any,intent:any,provider:any,forceReconciliation=false){
  const r=providerRefund(provider),exact=!!r&&r.id===intent.stripeRefundId&&r.paymentIntentId===intent.paymentIntentId&&r.chargeId===order.stripeChargeId&&r.amountCents===intent.cardAmountCents;
  const docs=await readManualRefundDocuments(tx,id,intent),recorded=!!docs&&qualifiedManualRefundSettlement(id,order,intent,docs);
  const m=order.manualRefundRestitution;
  if(!forceReconciliation&&exact&&['failed','canceled'].includes(r!.status!)&&intent.providerStatus===r!.status){
    if(recorded){const original=docs!.attestation?.provider?.refunds?.find((x:any)=>x.id===r!.id);
      if(original?.failureBalanceTransactionId===r!.failureBalanceTransactionId)return {result:refundResult(intent,true),commit:()=>{}};
    }else if(m?.refundIntentId===intent.intentId&&m.state==='prepared'){
      const p=(await tx.get(manualDoc(id,m.instructionId))).data();
      if(qualifiedManualCommand(p,id,intent.intentId,'prepare_manual_bank_transfer')&&p!.payloadHash===m.instructionHash)
        return {result:refundResult(intent,true),commit:()=>{}};
    }
  }
  const selected={...intent,state:'reconciliation_required',outstandingCardCents:null,
    ...(exact?{providerStatus:r!.status,failureReason:r!.failureReason}:{}),
    ...(recorded&&exact&&r!.status==='succeeded'?{duplicateCardSettlementCents:intent.cardAmountCents}:{})};
  const alert=db.collection('admin_alerts').doc('manual_refund_original_'+supportHash([id,intent.intentId])),old=await tx.get(alert);
  const accounting=await preparePurchasePlatformAccounting(tx,id,order,{refundIntentId:intent.intentId});
  const patch:any={refundBlocked:true,'refundAllocationState.reviewRequired':true,...order.refund?.intentId===intent.intentId?{refund:selected}:{}};
  if(m?.refundIntentId===intent.intentId)patch.manualRefundRestitution={...m,state:'reconciliation_required',updatedAt:Timestamp.now()};
  const fields=await financialRecoverySourceFields('purchase',ref(id),order,patch);
  const allocation=(await tx.get(refundAllocationRef(id,intent.intentId))).data();
  const projection={order:sellerTaxFinancialOrderAfter(order,fields),refund:{intent:selected,settlement:allocation?.settlement??null,...docs?{manualDocuments:docs}:{}}};
  const fiscal=await prepareSellerTaxFinancialEvent(tx,order.sellerId,{kind:'purchase_refund',id,refundIntentId:intent.intentId},projection);
  return {result:refundResult(selected,true),commit:()=>{
    fiscal.commit(projection);accounting.commit({intent:selected},'manual_refund_original_outcome_requires_reconciliation');
    if(order.refund?.intentId!==intent.intentId)tx.update(refundHistoryRef(id,intent.intentId),{currentIntent:selected});
    tx.update(ref(id),fields);
    if(!old.exists)tx.create(alert,{kind:'purchase_refund_action_required',severity:'critical',refId:id,context:{refundIntentId:intent.intentId,
      originalOutcome:exact?r!.status:'unknown',manualEventPreserved:recorded},message:'Restitution manuelle et issue Stripe à rapprocher. Aucun nouveau mouvement.',status:'open',createdAt:Timestamp.now()});
  }};
}
