import { financialRecoveryCommitCheckpoint } from "../utils/financialRecoverySources";
import { financialRecoverySourceFields, prepareFinancialRecoverySource } from '../utils/financialRecoverySources';
import { FinancialRecoveryBlocked } from '../utils/financialRecoveryInterlock';
import { withFinancialRecoveryScope } from "../utils/financialRecoveryInterlock";
/**
 * F134 — Paid shop tier encashment rail.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `feeReductionForShopTier` (payments.ts) already LOWERS the buyer protection fee
 * for pro/premium shops, but nothing ever CHARGED the forfait and no expiry was
 * enforced — a tier, once set, granted a perpetual fee reduction (lost revenue).
 *
 * This callable is the missing encashment rail:
 *   1. The shop OWNER buys a tier for a number of months.
 *   2. We create a DIRECT PLATFORM CHARGE PaymentIntent (no transfer_data /
 *      on_behalf_of — consistent with vague 1 single-rail model; the forfait
 *      revenue is platform revenue, kept on the platform account).
 *   3. The webhook (`metadata.type === 'shop_tier'`) stamps `tier` +
 *      `tierPaidUntil` on the shop AFTER payment succeeds — the tier is NEVER
 *      granted before money lands. `tier`/`tierPaidUntil` are CF-only in
 *      firestore.rules so a client cannot self-attribute a tier.
 *   4. `resolveBuyerFeeReduction` (payments.ts) only honours a tier while
 *      `tierPaidUntil > now`; an expired forfait reverts to basic (reduction 0).
 *
 * v2, region northamerica-northeast1, memory 512MiB, STRIPE_SECRET_KEY secret,
 * auth + checkRateLimit, structured logging, never writes `undefined`.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import { db } from '../config/firebase';
import { getStripe } from '../config/stripe';
import { assertNewPaymentsEnabled } from '../config/featureFlags';
import { checkRateLimit, resolveCallerKey } from '../utils/rateLimit';
import { createHash } from 'node:crypto';
import { assertAccountOperationOpen } from '../utils/eligibility';
import { ELIGIBILITY_POLICY_VERSION } from '../shared/eligibility';
import { assertPrivateAccountSession, withPrivateAccountSession } from '../utils/privateAccountSession';
import { Timestamp } from 'firebase-admin/firestore';
import {buildNewShopTierTaxPricing,qualifiedShopTierTaxOperation,SHOP_TIER_TAX_PRICING_VERSION} from '../config/shopTierTax';

const REGION = 'northamerica-northeast1';
const RATE_LIMIT_WINDOW_MS = 60 * 1000;

export type PaidShopTier = 'pro' | 'premium';

/**
 * Monthly forfait price per paid tier, in CENTS (CAD). Server-owned config —
 * never trusted from the client. Override via env (SHOP_TIER_PRO_MONTHLY_CENTS /
 * SHOP_TIER_PREMIUM_MONTHLY_CENTS) without a code change. Pricing is a fondateur
 * business decision; these are placeholder defaults to calibrate.
 *   - pro     (Le Comptoir) → ~half the standard buyer fee reduction
 *   - premium (La Maison)   → 0% buyer fee (Second monetizes via the forfait)
 */
const TIER_MONTHLY_PRICE_CENTS: Record<PaidShopTier, number> = {
  pro: exactNewTierPrice(process.env.SHOP_TIER_PRO_MONTHLY_CENTS ?? '2999'),
  premium: exactNewTierPrice(process.env.SHOP_TIER_PREMIUM_MONTHLY_CENTS ?? '7999'),
};
function exactNewTierPrice(raw:string):number {
  // Keep module loading/history independent from a malformed current tariff.
  return /^[1-9]\d*$/.test(raw)&&Number.isSafeInteger(Number(raw))?Number(raw):NaN;
}

/** Returns the total forfait price (cents) for a tier over `periodMonths`. */
export function shopTierPriceCents(tier: PaidShopTier, periodMonths: number): number {
  const value=TIER_MONTHLY_PRICE_CENTS[tier]*periodMonths;
  if(!Number.isSafeInteger(value)||value<50)throw new HttpsError('failed-precondition','Le prix du forfait doit être corrigé.',
    {reason:'shop_tier_price_configuration_invalid',paymentPermissionGranted:false});
  return value;
}

export type ShopTierOperation = {
  action: 'account_forfait_operation'; ownerId: string; actorUid: string; shopId: string;
  tier: PaidShopTier; periodMonths: number; amountCents: number; idempotencyKey: string;
  inputHash: string; policyVersion: string; source: 'purchaseShopTier'; state: string;
  paymentIntentId: string | null; createdAt: Timestamp; settledAt?: Timestamp; canceledAt?: Timestamp; requestProtocol?: string;
};
/** The original native request fixes its price. Today's tariff is never proof
 * of what an older owner operation authorized. */
export function qualifiedShopTierOperation(value: any, operationId: string): value is ShopTierOperation {
  if (!value || value.action !== 'account_forfait_operation' || value.source !== 'purchaseShopTier' ||
      typeof value.ownerId !== 'string' || !value.ownerId || value.ownerId.includes('/') || value.actorUid !== value.ownerId ||
      typeof value.shopId !== 'string' || !value.shopId || value.shopId.length > 200 || value.shopId.includes('/') ||
      !['pro', 'premium'].includes(value.tier) || !Number.isSafeInteger(value.periodMonths) || value.periodMonths < 1 || value.periodMonths > 12 ||
      !Number.isSafeInteger(value.amountCents) || value.amountCents < 50 || typeof value.policyVersion !== 'string' || !value.policyVersion ||
      typeof value.idempotencyKey !== 'string' || !['reserved', 'pending', 'unknown', 'rejected', 'canceled', 'review_required', 'settled'].includes(value.state) ||
      !(value.createdAt instanceof Timestamp) || value.createdAt.toMillis() <= 0 || value.createdAt.toMillis() > Date.now() ||
      value.paymentIntentId !== null && (typeof value.paymentIntentId !== 'string' || !/^pi_[A-Za-z0-9_]+$/.test(value.paymentIntentId))) return false;
  if (value.requestProtocol === SHOP_TIER_PURCHASE_CAPABILITY) return nativeTierRequest(value,operationId);
  if (Object.prototype.hasOwnProperty.call(value,'requestProtocol')) return false;
  const prefix = `shop_tier_${value.shopId}_${value.tier}_${value.periodMonths}_`;
  if (!value.idempotencyKey.startsWith(prefix) || !/^\d+$/.test(value.idempotencyKey.slice(prefix.length))) return false;
  const expectedHash = createHash('sha256').update(JSON.stringify([value.ownerId, value.idempotencyKey])).digest('hex');
  return operationId === 'forfait_' + expectedHash && value.inputHash === expectedHash;
}
export function shopTierPaymentMatches(payment: any, operation: ShopTierOperation, operationId: string, captured: boolean): boolean {
  return ((operation as any).requestProtocol === undefined || nativeTierRequest(operation,operationId) && tierNativeTime((operation as any).postAuthorizedAt)) && payment?.object === 'payment_intent' && /^pi_[A-Za-z0-9_]+$/.test(payment.id ?? '') &&
    (operation.paymentIntentId === null || operation.paymentIntentId === payment.id) && payment.currency === 'cad' &&
    payment.amount === operation.amountCents && payment.metadata?.type === 'shop_tier' &&
    payment.metadata?.secondAccountOperationId === operationId && payment.metadata?.ownerId === operation.ownerId &&
    payment.metadata?.shopId === operation.shopId && payment.metadata?.tier === operation.tier &&
    payment.metadata?.periodMonths === String(operation.periodMonths) &&
    (!Object.prototype.hasOwnProperty.call(operation,'taxPricingVersion')||
      !!qualifiedShopTierTaxOperation(operation)&&payment.metadata?.shopTierPricingHash===(operation as any).pricing.hash) && payment.transfer_data == null &&
    payment.on_behalf_of == null && (payment.application_fee_amount == null || payment.application_fee_amount === 0) &&
    (!captured || payment.status === 'succeeded' && payment.amount_received === operation.amountCents);
}

export const SHOP_TIER_PURCHASE_CAPABILITY = 'shop_tier_purchase_v1';
type TierCommand = {shopId: string; tier: PaidShopTier; periodMonths: number};
const tierDigest = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const tierNativeTime = (v: any): v is Timestamp => v instanceof Timestamp && v.toMillis() > 0 && v.toMillis() <= Date.now();
const tierRequestId = (uid: string, requestId: string) => 'forfait_' + tierDigest([SHOP_TIER_PURCHASE_CAPABILITY, uid, requestId]);
const tierCommandHash = (uid: string, requestId: string, c: TierCommand) => tierDigest([SHOP_TIER_PURCHASE_CAPABILITY, uid, requestId, c.shopId, c.tier, c.periodMonths]);
const tierSlotRef = (uid: string, shopId: string) => db.collection('eligibility_audit').doc('forfait_slot_' + tierDigest([uid, shopId]));
const tierCreateBody = (op: any, id: string) => ({amount: op.amountCents, currency: 'cad', metadata: {type: 'shop_tier',
  shopId: op.shopId, ownerId: op.ownerId, tier: op.tier, periodMonths: String(op.periodMonths), secondAccountOperationId: id,
  ...(op.taxPricingVersion===SHOP_TIER_TAX_PRICING_VERSION?{shopTierPricingHash:op.pricing.hash}:{})}});
function nativeTierRequest(op: any, id: string): boolean {
  const c = op?.command;
  return !!op && op.requestProtocol === SHOP_TIER_PURCHASE_CAPABILITY && op.action === 'account_forfait_operation' && op.source === 'purchaseShopTier' &&
    typeof op.ownerId === 'string' && op.ownerId.length > 0 && !op.ownerId.includes('/') && op.actorUid === op.ownerId &&
    typeof op.requestId === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(op.requestId) &&
    !!c && typeof c.shopId === 'string' && c.shopId.length > 0 && c.shopId.length <= 128 && !c.shopId.includes('/') &&
    ['pro', 'premium'].includes(c.tier) && Number.isSafeInteger(c.periodMonths) && c.periodMonths >= 1 && c.periodMonths <= 12 &&
    Object.keys(c).sort().join(',') === 'periodMonths,shopId,tier' && op.shopId === c.shopId && op.tier === c.tier && op.periodMonths === c.periodMonths &&
    id === tierRequestId(op.ownerId, op.requestId) && op.inputHash === tierCommandHash(op.ownerId, op.requestId, c) &&
    op.idempotencyKey === 'shop_tier_request_' + id.slice('forfait_'.length) && typeof op.policyVersion === 'string' && !!op.policyVersion &&
    tierNativeTime(op.createdAt) && ['reserved','pending','unknown','rejected','canceled','review_required','settled'].includes(op.state) &&
    (!Object.prototype.hasOwnProperty.call(op,'taxPricingVersion')||!!qualifiedShopTierTaxOperation(op)) &&
    (op.amountCents === null || Number.isSafeInteger(op.amountCents) && op.amountCents >= 50) &&
    (op.paymentIntentId === null || typeof op.paymentIntentId === 'string' && /^pi_[A-Za-z0-9_]+$/.test(op.paymentIntentId)) &&
    (op.postAuthorizedAt === null && op.postAuthorizationId === null && op.postBodyHash === null ||
      tierNativeTime(op.postAuthorizedAt) && op.postAuthorizedAt.toMillis() >= op.createdAt.toMillis() &&
      op.postAuthorizationId === tierDigest([id,op.postAuthorizedAt.seconds,op.postAuthorizedAt.nanoseconds]) &&
      op.postBodyHash === tierDigest(tierCreateBody(op,id)));
}
export const shopTierSettlementHash = (r: any) => tierDigest([r.protocol, r.operationId, r.ownerId, r.shopId,
  r.tier, r.periodMonths, r.amountCents, r.currency, r.paymentIntentId, r.chargeId, r.recordedAt.toMillis(), r.paidUntil.toMillis(),
  ...(r.protocol==='shop_tier_settlement_v2'?[r.taxPricingVersion,r.pricingHash,r.taxDecisionHash,
    r.recordedAt.seconds,r.recordedAt.nanoseconds,r.paidUntil.seconds,r.paidUntil.nanoseconds]:[])]);
export function qualifiedShopTierSettlement(operation: any, operationId: string, ledger: any): boolean {
  const hasPricing=Object.prototype.hasOwnProperty.call(operation??{},'taxPricingVersion'),pricing=hasPricing?qualifiedShopTierTaxOperation(operation):null;
  if (!qualifiedShopTierOperation(operation,operationId) || operation.state !== 'settled' || !tierNativeTime(operation.settledAt) ||
      typeof operation.paymentIntentId !== 'string' || !ledger || ledger.type !== 'shop_tier_revenue' ||
      ledger.shopId !== operation.shopId || ledger.ownerId !== operation.ownerId || ledger.tier !== operation.tier ||
      ledger.periodMonths !== operation.periodMonths || ledger.amount !== (pricing?pricing.netCents:operation.amountCents) / 100 || ledger.paymentIntentId !== operation.paymentIntentId ||
      !/^ch_[A-Za-z0-9_]+$/.test(ledger.chargeId ?? '') || ledger.currency !== 'cad' || !tierNativeTime(ledger.createdAt)) return false;
  if (!Object.prototype.hasOwnProperty.call(operation,'settlement')) return (operation as any).requestProtocol === undefined;
  const r = (operation as any).settlement;
  if(hasPricing&&(!pricing||ledger.shopTierPricingVersion!==SHOP_TIER_TAX_PRICING_VERSION||ledger.taxAccounting!=='revenue_excludes_tax_with_informational_components_v1'||
    ledger.pricingHash!==pricing.hash||ledger.taxDecisionHash!==pricing.taxDecisionHash||ledger.netRevenueCents!==pricing.netCents||
    ledger.gstCents!==pricing.gstCents||ledger.qstCents!==pricing.qstCents||ledger.taxCollectedCents!==pricing.taxCents||
    ledger.totalCollectedCents!==pricing.totalCents||r?.taxPricingVersion!==SHOP_TIER_TAX_PRICING_VERSION||r.pricingHash!==pricing.hash||
    r.taxDecisionHash!==pricing.taxDecisionHash))return false;
  return !!r && r.protocol === (pricing?'shop_tier_settlement_v2':'shop_tier_settlement_v1') && r.operationId === operationId && r.ownerId === operation.ownerId &&
    r.shopId === operation.shopId && r.tier === operation.tier && r.periodMonths === operation.periodMonths && r.amountCents === operation.amountCents &&
    r.currency === 'CAD' && r.paymentIntentId === operation.paymentIntentId && r.chargeId === ledger.chargeId &&
    tierNativeTime(r.recordedAt) && r.paidUntil instanceof Timestamp && r.paidUntil.toMillis() > r.recordedAt.toMillis() &&
    r.recordedAt.isEqual(operation.settledAt) && r.recordedAt.isEqual(ledger.createdAt) && r.proofHash === shopTierSettlementHash(r) &&
    ledger.shopTierOperationId === operationId && ledger.shopTierSettlementHash === r.proofHash;
}
const tierNonExecutionHash = (p: any) => tierDigest([p.protocol,p.operationId,p.ownerId,p.requestId,p.inputHash,p.amountCents,p.reason,p.recordedAt.seconds,p.recordedAt.nanoseconds]);
const tierCancellationHash = (p: any) => tierDigest([p.protocol,p.operationId,p.inputHash,p.paymentIntentId,p.amountCents,p.currency,p.providerStatus,p.source,p.observedAt.seconds,p.observedAt.nanoseconds]);
export function shopTierCancellationProof(op: any,id: string,payment: any,source: 'provider_get'|'signed_webhook'|'provider_cancel_response') {
  const proof = {protocol:'shop_tier_cancellation_v1',operationId:id,inputHash:op.inputHash,paymentIntentId:payment.id,
    amountCents:op.amountCents,currency:'CAD',providerStatus:'canceled',source,observedAt:Timestamp.now()};
  return {...proof,proofHash:tierCancellationHash(proof)};
}
async function tierTerminalReceipt(tx: FirebaseFirestore.Transaction,op: any,id: string) {
  if (!op) return null;
  if (op.state === 'settled' && op.paymentIntentId) {
    const ledger = (await tx.get(db.collection('platform_ledger').doc('shop_tier_revenue_' + op.paymentIntentId))).data();
    if (qualifiedShopTierSettlement(op,id,ledger) && op.settlement) return {outcome:'settled',recordedAt:op.settlement.recordedAt,
      paidUntil:op.settlement.paidUntil,proofHash:op.settlement.proofHash};
  }
  const p = op.rejectionProof;
  if (nativeTierRequest(op,id) && op.state === 'rejected' && op.postAuthorizedAt === null && op.paymentIntentId === null && p &&
      p.protocol === 'shop_tier_pre_authorization_non_execution_v1' && p.operationId === id && p.ownerId === op.ownerId && p.requestId === op.requestId &&
      p.inputHash === op.inputHash && p.amountCents === op.amountCents && p.reason === 'requester_neutralized' &&
      tierNativeTime(p.recordedAt) && p.proofHash === tierNonExecutionHash(p)) return {outcome:'not_executed',recordedAt:p.recordedAt,paidUntil:null,proofHash:p.proofHash};
  const c = op.cancellation;
  if (nativeTierRequest(op,id) && op.state === 'canceled' && tierNativeTime(op.postAuthorizedAt) && c && c.protocol === 'shop_tier_cancellation_v1' &&
      c.operationId === id && c.inputHash === op.inputHash && c.paymentIntentId === op.paymentIntentId && c.amountCents === op.amountCents &&
      c.currency === 'CAD' && c.providerStatus === 'canceled' && ['provider_get','signed_webhook','provider_cancel_response'].includes(c.source) &&
      tierNativeTime(c.observedAt) && c.proofHash === tierCancellationHash(c)) return {outcome:'canceled',recordedAt:c.observedAt,paidUntil:null,proofHash:c.proofHash};
  return null;
}
async function tierOwner(tx: FirebaseFirestore.Transaction,request: any,c: TierCommand) {
  await assertPrivateAccountSession(request,tx);
  const shop = (await tx.get(db.collection('shops').doc(c.shopId))).data();
  if (!shop || shop.ownerId !== request.auth.uid) throw new HttpsError('permission-denied','Cette boutique ne vous appartient plus.');
  if (shop.status !== 'approved') throw new HttpsError('failed-precondition','Votre boutique doit être approuvée avant de payer un forfait.');
  await prepareFinancialRecoverySource('shop_entitlement',db.collection('shops').doc(c.shopId).path,shop);
  assertNewPaymentsEnabled(); await assertAccountOperationOpen(tx,request.auth.uid);return shop;
}
async function currentTierTaxPricing(tx:FirebaseFirestore.Transaction,uid:string,c:TierCommand) {
  const user=(await tx.get(db.collection('users').doc(uid))).data();
  const primary=Array.isArray(user?.addresses)?user.addresses.filter((a:any)=>a?.isDefault===true):[];
  return buildNewShopTierTaxPricing(shopTierPriceCents(c.tier,c.periodMonths),{recipientUid:uid,source:'payer_declared_primary_address',
    address:primary.length===1?primary[0]:null,nativeSourceReference:tierDigest(['native_shop_primary_address',uid,c.shopId]),transport:'none'});
}
async function assertNewTierTaxPricing(tx:FirebaseFirestore.Transaction,uid:string,c:TierCommand,op:any) {
  const prior=qualifiedShopTierTaxOperation(op),current=await currentTierTaxPricing(tx,uid,c);
  if(!prior||prior.hash!==current.pricing.hash)throw new HttpsError('failed-precondition',
    'Le prix ou le traitement fiscal du forfait a changé. Aucune nouvelle facturation autorisée.',
    {reason:'shop_tier_tax_qualification_required',paymentPermissionGranted:false});
}
async function handleShopTierPurchaseRequest(request: any) {
  const d = request.data, uid = request.auth.uid;
  if (!d || typeof d !== 'object' || Array.isArray(d) || d.capability !== SHOP_TIER_PURCHASE_CAPABILITY || d.expectedUid !== uid ||
      !['prepare','observe','neutralize','cancel_known_unconfirmed'].includes(d.mode) || typeof d.requestId !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(d.requestId) ||
      Object.keys(d).some(k=>!['capability','mode','expectedUid','requestId','command','cancelAcknowledged'].includes(k)) ||
      (d.mode === 'cancel_known_unconfirmed' ? d.cancelAcknowledged !== true : Object.prototype.hasOwnProperty.call(d,'cancelAcknowledged'))) throw new HttpsError('invalid-argument','Intention durable de forfait requise.');
  const raw = d.command;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).sort().join(',') !== 'periodMonths,shopId,tier' ||
      typeof raw.shopId !== 'string' || !raw.shopId || raw.shopId.length > 128 || raw.shopId.includes('/') || !['pro','premium'].includes(raw.tier) ||
      !Number.isSafeInteger(raw.periodMonths) || raw.periodMonths < 1 || raw.periodMonths > 12) throw new HttpsError('invalid-argument','Boutique, forfait et durée exacts requis.');
  const c: TierCommand = {shopId:raw.shopId,tier:raw.tier,periodMonths:raw.periodMonths}, rid = d.requestId, id = tierRequestId(uid,rid);
  const ref = db.collection('eligibility_audit').doc(id), slotRef = tierSlotRef(uid,c.shopId), inputHash = tierCommandHash(uid,rid,c);
  const matches = (op: any) => nativeTierRequest(op,id) && op.ownerId === uid && op.requestId === rid && op.inputHash === inputHash;
  const current = async(tx: FirebaseFirestore.Transaction) => {await assertPrivateAccountSession(request,tx);const op = (await tx.get(ref)).data();
    if (op && !matches(op)) throw new HttpsError('already-exists','Cette référence désigne une autre intention ou une source à rapprocher.');return op;};
  const base = () => ({action:'account_forfait_operation',source:'purchaseShopTier',ownerId:uid,actorUid:uid,shopId:c.shopId,tier:c.tier,periodMonths:c.periodMonths,
    requestProtocol:SHOP_TIER_PURCHASE_CAPABILITY,requestId:rid,command:c,inputHash,policyVersion:ELIGIBILITY_POLICY_VERSION,
    idempotencyKey:'shop_tier_request_' + id.slice('forfait_'.length),paymentIntentId:null,postAuthorizedAt:null,postAuthorizationId:null,postBodyHash:null,
    createdAt:Timestamp.now(),updatedAt:Timestamp.now()});
  if (d.mode === 'prepare') await checkRateLimit(uid,true,{functionName:'shopTierDurablePrepare',maxCallsAuthenticated:5,maxCallsUnauthenticated:0,windowMs:60000});
  const initial = await db.runTransaction(async tx => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
    const op = await current(tx), receipt = await tierTerminalReceipt(tx,op,id);if (receipt) return op;
    const opSnapshot=await tx.get(ref);
    if (d.mode === 'neutralize' && (!op || op.state === 'reserved' && op.postAuthorizedAt === null && op.paymentIntentId === null)) {
      const native = op ?? {...base(),amountCents:null,state:'reserved'}, p = {protocol:'shop_tier_pre_authorization_non_execution_v1',operationId:id,
        ownerId:uid,requestId:rid,inputHash,amountCents:native.amountCents,reason:'requester_neutralized',recordedAt:Timestamp.now()};
      const tombstone = {...native,state:'rejected',rejectionProof:{...p,proofHash:tierNonExecutionHash(p)},updatedAt:p.recordedAt};
      if (op) { await recoveryCommit({refs: [(ref).path]}); tx.update(ref,await financialRecoverySourceFields('shop_tier',ref,op,tombstone)); }else { await recoveryCommit({refs: [(ref).path]}); tx.create(ref,await financialRecoverySourceFields('shop_tier',ref,opSnapshot,tombstone)); }return tombstone;
    }
    if (op || d.mode !== 'prepare') return op;
    const shop = await tierOwner(tx,request,c);
    const noCurrentEntitlement = !['pro','premium'].includes(shop.tier) && shop.tierPaidUntil == null && shop.tierPaymentIntentId == null;
    const entitlementMatches = (v: any, r: any) => r?.outcome==='settled' && r.paidUntil instanceof Timestamp &&
      shop.tierPaymentIntentId===v.paymentIntentId && shop.tierPaidUntil instanceof Timestamp && shop.tierPaidUntil.isEqual(r.paidUntil) &&
      (shop.tier===v.tier || shop.tier==='basic'&&r.paidUntil.toMillis()<=Date.now());
    let entitlement: any = null;
    const slotSnapshot=await tx.get(slotRef),slot=slotSnapshot.data();
    if (slot) {
      if (slot.protocol !== 'shop_tier_request_slot_v1' || slot.ownerId !== uid || slot.shopId !== c.shopId || slot.legacyHistoryQualified !== true ||
          !/^forfait_[a-f0-9]{64}$/.test(slot.currentOperationId ?? '')) throw new HttpsError('failed-precondition','L’historique des forfaits doit être rapproché.');
      const previous = (await tx.get(db.collection('eligibility_audit').doc(slot.currentOperationId))).data();
      if (!await tierTerminalReceipt(tx,previous,slot.currentOperationId)) throw new HttpsError('failed-precondition','Reprenez la demande précédente avant un nouveau forfait.',{reason:'forfait_previous_request_unsettled'});
      entitlement=slot.entitlement;
      if (entitlement===null ? !noCurrentEntitlement : !entitlement || !/^forfait_[a-f0-9]{64}$/.test(entitlement.operationId ?? ''))
        throw new HttpsError('failed-precondition','Le forfait actuel doit être rapproché.',{reason:'forfait_shop_history_unqualified'});
      if (entitlement) {
        const entitled=(await tx.get(db.collection('eligibility_audit').doc(entitlement.operationId))).data();
        const proof=await tierTerminalReceipt(tx,entitled,entitlement.operationId);
        if (!entitlementMatches(entitled,proof)||proof?.proofHash!==entitlement.proofHash)
          throw new HttpsError('failed-precondition','Le forfait actuel doit être rapproché.',{reason:'forfait_shop_history_unqualified'});
      }
    } else {
      // One-time legacy admission. Installing this native slot also bars new V1
      // creations below; an exact existing V1 operation keeps its servicing.
      const history = await tx.get(db.collection('eligibility_audit').where('ownerId','==',uid).where('action','==','account_forfait_operation').limit(101));
      if (history.size > 100) throw new HttpsError('failed-precondition','La couverture de l’historique des forfaits doit être examinée.');
      for (const old of history.docs) {
        const v = old.data();if (v.shopId !== c.shopId || old.id === id) continue;
        const terminal=await tierTerminalReceipt(tx,v,old.id);
        if (terminal) {if(entitlementMatches(v,terminal))entitlement={operationId:old.id,proofHash:terminal.proofHash};continue;}
        if (qualifiedShopTierOperation(v,old.id) && v.state === 'settled') {
          const ledger = (await tx.get(db.collection('platform_ledger').doc('shop_tier_revenue_' + v.paymentIntentId))).data();
          if (qualifiedShopTierSettlement(v,old.id,ledger)) continue;
        }
        if (qualifiedShopTierOperation(v,old.id) && v.state === 'canceled' && v.paymentIntentId && tierNativeTime(v.canceledAt)) continue;
        throw new HttpsError('failed-precondition','Une ancienne demande de forfait reste à rapprocher.',{reason:'forfait_legacy_request_unsettled'});
      }
      if (!noCurrentEntitlement && !entitlement) throw new HttpsError('failed-precondition','Le forfait actuel manque de preuve native exacte.',{reason:'forfait_shop_history_unqualified'});
    }
    const {pricing,taxDecision}=await currentTierTaxPricing(tx,uid,c),amountCents=pricing.totalCents;
    if (!Number.isSafeInteger(amountCents) || amountCents < 50) throw new HttpsError('failed-precondition','Le prix du forfait est invalide.');
    const value = {...base(),amountCents,state:'reserved',taxPricingVersion:SHOP_TIER_TAX_PRICING_VERSION,pricing,taxDecision};
    await recoveryCommit({refs: [(ref).path]});
    tx.create(ref,await financialRecoverySourceFields('shop_tier',ref,opSnapshot,value));await recoveryCommit({refs: [(slotRef).path]});
    tx.set(slotRef,await financialRecoverySourceFields('shop_tier',slotRef,slotSnapshot,{protocol:'shop_tier_request_slot_v1',ownerId:uid,shopId:c.shopId,currentOperationId:id,
      currentRequestId:rid,legacyHistoryQualified:true,entitlement,updatedAt:Timestamp.now()}));return value;
  });
  let payment: any = null, providerReason: string | null = null, cancelResponseObserved = false;
  if (initial && !await db.runTransaction(tx=>tierTerminalReceipt(tx,initial,id)) && initial.state !== 'review_required') {
    const stripe = getStripe();
    if (stripe) {
      await checkRateLimit(uid,true,{functionName:'shopTierDurableProvider',maxCallsAuthenticated:10,maxCallsUnauthenticated:0,windowMs:60000});
      const authorize = d.mode === 'prepare' ? await db.runTransaction(async tx => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
        const op = await current(tx);if (!op || op.state !== 'reserved' || op.postAuthorizedAt !== null || op.paymentIntentId !== null) return null;
        await tierOwner(tx,request,c);const slot = (await tx.get(slotRef)).data();
        await assertNewTierTaxPricing(tx,uid,c,op);
        if (slot?.protocol !== 'shop_tier_request_slot_v1' || slot.ownerId !== uid || slot.shopId !== c.shopId || slot.currentOperationId !== id)
          throw new HttpsError('failed-precondition','L’intention courante de la boutique a changé.');
        const at = Timestamp.now(), token = tierDigest([id,at.seconds,at.nanoseconds]);
        const idempotencyKey: ShopTierOperation['idempotencyKey'] = op.idempotencyKey;
        await recoveryCommit({refs: [(ref).path]});
    tx.update(ref,await financialRecoverySourceFields('shop_tier',ref,op,{state:'unknown',postAuthorizedAt:at,postAuthorizationId:token,postBodyHash:tierDigest(tierCreateBody(op,id)),updatedAt:at}));
        return {...op,idempotencyKey,postAuthorizedAt:at,postAuthorizationId:token};
      }) : null;
      try {
        if (authorize) {
          await db.runTransaction(async tx=>{const op=await current(tx);
            if(!op || op.postAuthorizationId!==authorize.postAuthorizationId || op.postBodyHash!==tierDigest(tierCreateBody(authorize,id)))
              throw new HttpsError('aborted','L’intention de forfait a changé.');
            await tierOwner(tx,request,c);await prepareFinancialRecoverySource('shop_tier',ref.path,op);
            await assertNewTierTaxPricing(tx,uid,c,op);
            const slot=(await tx.get(slotRef)).data();if(!slot || slot.currentOperationId!==id)throw new HttpsError('aborted','La boutique a changé.');
            await prepareFinancialRecoverySource('shop_tier',slotRef.path,slot);});
          payment = await stripe.paymentIntents.create(tierCreateBody(authorize,id),{idempotencyKey:authorize.idempotencyKey});
        }
        else {
          const op = await db.runTransaction(current);
          if (op && tierNativeTime(op.postAuthorizedAt)) {
            if (op.paymentIntentId) payment = await stripe.paymentIntents.retrieve(op.paymentIntentId);
            else {const found = await stripe.paymentIntents.search({query:`metadata['secondAccountOperationId']:'${id}'`,limit:2});
              if (found.has_more === false && found.data.length === 1) payment = found.data[0];else providerReason = 'forfait_provider_identity_unknown';}
          }
        }
      } catch(recoveryError) {if(recoveryError instanceof FinancialRecoveryBlocked)throw recoveryError;providerReason = 'forfait_provider_outcome_unknown';}
      if (d.mode === 'cancel_known_unconfirmed' && payment) {
        const cancel = await db.runTransaction(async tx => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
          const op = await current(tx);if (!op || await tierTerminalReceipt(tx,op,id)) return null;
          if (Object.prototype.hasOwnProperty.call(op,'cancelAuthorization')) {providerReason='forfait_cancel_outcome_unknown';return null;}
          if (!qualifiedShopTierOperation(op,id) || !shopTierPaymentMatches(payment,op,id,false) ||
              !['requires_payment_method','requires_confirmation','requires_action'].includes(payment.status)) {
            providerReason='forfait_payment_not_cancelable';return null;
          }
          const at=Timestamp.now(), body={cancellation_reason:'requested_by_customer' as const};
          const authorization={protocol:'shop_tier_cancel_authorization_v1',operationId:id,inputHash,actorUid:uid,requestId:rid,
            paymentIntentId:payment.id,amountCents:op.amountCents,currency:'CAD',observedProviderStatus:payment.status,
            acknowledged:true,authorizedAt:at,idempotencyKey:'cancel_shop_tier_'+id.slice('forfait_'.length),bodyHash:tierDigest(body)};
          await recoveryCommit({refs: [(ref).path]});
    tx.update(ref,await financialRecoverySourceFields('shop_tier',ref,op,{cancelAuthorization:authorization,updatedAt:at}));return authorization;
        });
        if (cancel) {
          try {
            const canceled=await stripe.paymentIntents.cancel(cancel.paymentIntentId,{cancellation_reason:'requested_by_customer'},
              {idempotencyKey:cancel.idempotencyKey});
            const valid=await db.runTransaction(async tx=>{
              const op=await current(tx);
              const exact=matches(op)&&qualifiedShopTierOperation(op,id)&&shopTierPaymentMatches(canceled,op,id,false)&&canceled.status==='canceled';
              await assertPrivateAccountSession(request,tx);return exact;
            });
            if (valid) {payment=canceled;providerReason=null;cancelResponseObserved=true;}else {payment=null;providerReason='forfait_cancel_outcome_unknown';}
          } catch(recoveryError) {if(recoveryError instanceof FinancialRecoveryBlocked)throw recoveryError;payment=null;providerReason='forfait_cancel_outcome_unknown';}
        }
      }
      if (payment) await db.runTransaction(async tx => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
        const op = await current(tx);if (!matches(op) || await tierTerminalReceipt(tx,op,id)) return;
        if (!qualifiedShopTierOperation(op,id) || !shopTierPaymentMatches(payment,op,id,false)) {providerReason = 'forfait_provider_identity_unknown';return;}
        const status = payment.status;
        if (!['requires_payment_method','requires_confirmation','requires_action','processing','requires_capture','canceled','succeeded'].includes(status)) {providerReason='forfait_provider_status_unknown';return;}
        const cancel = status === 'canceled' ? shopTierCancellationProof(op,id,payment,cancelResponseObserved?'provider_cancel_response':'provider_get') : null;
        await assertPrivateAccountSession(request,tx);
        await recoveryCommit({refs: [(ref).path]});
    tx.update(ref,await financialRecoverySourceFields('shop_tier',ref,op,{paymentIntentId:payment.id,state:cancel?'canceled':'pending',...(cancel?{cancellation:cancel,canceledAt:cancel.observedAt}:{}),
          providerObservation:{protocol:'shop_tier_payment_observation_v1',paymentIntentId:payment.id,providerStatus:status,observedAt:Timestamp.now()},updatedAt:Timestamp.now()}));
      });
    } else providerReason = 'forfait_provider_unavailable';
  }
  return db.runTransaction(async tx => {
    const op = await current(tx), receipt = await tierTerminalReceipt(tx,op,id), observed = op?.providerObservation;
    let state = !op?'unrecorded':receipt?receipt.outcome==='not_executed'?'not_executed':receipt.outcome:['review_required','settled','canceled','rejected'].includes(op.state)?'review_required':op.postAuthorizedAt===null?'reserved':'unknown';
    let secret: string | null = null, providerStatus: string | null = null;
    if (!receipt && payment && op && qualifiedShopTierOperation(op,id) && shopTierPaymentMatches(payment,op,id,false) && !providerReason) {
      providerStatus = payment.status;
      if (['requires_payment_method','requires_confirmation','requires_action'].includes(payment.status)) {
        state = 'payable';
        if (d.mode === 'prepare' && !Object.prototype.hasOwnProperty.call(op,'cancelAuthorization')) {
          await tierOwner(tx,request,c);
          await prepareFinancialRecoverySource('shop_tier',ref.path,op);
          if (typeof payment.client_secret !== 'string' || !payment.client_secret.startsWith(payment.id+'_secret_')) state='unknown';else secret=payment.client_secret;
        }
      } else state = payment.status==='succeeded'?'activation_pending':payment.status==='canceled'?'unknown':'processing';
    }
    if (!receipt && op && Object.prototype.hasOwnProperty.call(op,'cancelAuthorization') && state==='payable') {
      state='unknown';secret=null;providerReason='forfait_cancel_outcome_unknown';
    }
    if (!providerStatus && observed?.paymentIntentId===op?.paymentIntentId && tierNativeTime(observed?.observedAt) &&
        ['requires_payment_method','requires_confirmation','requires_action','processing','requires_capture','canceled','succeeded'].includes(observed.providerStatus)) providerStatus=observed.providerStatus;
    if(receipt)providerStatus=receipt.outcome==='settled'?'succeeded':receipt.outcome==='canceled'?'canceled':null;
    return {protocol:'shop_tier_purchase_command_v1',actorId:uid,requestId:rid,command:c,operationId:id,requestRecorded:!!op,state,
      ...(op&&qualifiedShopTierTaxOperation(op)?{pricing:qualifiedShopTierTaxOperation(op)}:{}),
      amountCents:op?.amountCents??null,currency:'CAD',paymentIntentId:op?.paymentIntentId??null,providerStatus,postAuthorized:!!op&&tierNativeTime(op.postAuthorizedAt),
      clientSecret:secret,terminal:!!receipt,receipt:receipt?{protocol:'shop_tier_purchase_receipt_v1',outcome:receipt.outcome,operationId:id,
        paymentIntentId:op?.paymentIntentId??null,amountCents:op?.amountCents??null,currency:'CAD',recordedAt:receipt.recordedAt.toDate().toISOString(),
        paidUntil:receipt.paidUntil?.toDate().toISOString()??null,proofHash:receipt.proofHash}:null,reason:receipt?null:providerReason,readAt:Timestamp.now().toDate().toISOString()};
  });
}

/**
 * purchaseShopTier — shop OWNER buys a paid tier (pro|premium) for N months.
 *
 * Input:
 *   shopId       (string, required) — the shop the caller owns
 *   tier         ('pro' | 'premium', required)
 *   periodMonths (integer 1..12, required)
 *
 * Output: { success, clientSecret, paymentIntentId, tier, periodMonths, amountCents }
 *
 * The tier is NOT applied here — only after payment succeeds (webhook). This
 * callable creates the PaymentIntent (idempotent on the active forfait PI) and
 * returns the clientSecret for the client to confirm.
 */
export const purchaseShopTier = onCall(
  { region: REGION, memory: '512MiB', secrets: ['STRIPE_SECRET_KEY'] },
  async (request) => withFinancialRecoveryScope({operation: "callable/shopTier.purchaseShopTier"}, async () => withPrivateAccountSession(request, async () => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentification requise');
    }

    if (request.data?.capability !== undefined || request.data?.mode !== undefined || request.data?.requestId !== undefined) {
      return handleShopTierPurchaseRequest(request);
    }
    assertNewPaymentsEnabled();

    const { callerKey, isAuthenticated } = resolveCallerKey(request);
    await checkRateLimit(callerKey, isAuthenticated, {
      functionName: 'purchaseShopTier',
      maxCallsAuthenticated: 5,
      maxCallsUnauthenticated: 0,
      windowMs: RATE_LIMIT_WINDOW_MS,
    });

    const data = (request.data ?? {}) as {
      shopId?: unknown;
      tier?: unknown;
      periodMonths?: unknown;
    };

    if (typeof data.shopId !== 'string' || data.shopId.trim().length === 0) {
      throw new HttpsError('invalid-argument', 'shopId is required');
    }
    if (data.tier !== 'pro' && data.tier !== 'premium') {
      throw new HttpsError('invalid-argument', 'tier must be "pro" or "premium"');
    }
    if (
      typeof data.periodMonths !== 'number' ||
      !Number.isInteger(data.periodMonths) ||
      data.periodMonths < 1 ||
      data.periodMonths > 12
    ) {
      throw new HttpsError('invalid-argument', 'periodMonths must be an integer between 1 and 12');
    }

    const shopId = data.shopId.trim();
    const tier = data.tier as PaidShopTier;
    const periodMonths = data.periodMonths;
    const ownerUid = request.auth.uid;

    const stripe = getStripe();
    if (!stripe) {
      throw new HttpsError('failed-precondition', 'Stripe API not configured');
    }

    const shopRef = db.collection('shops').doc(shopId);
    const shopSnap = await shopRef.get();
    if (!shopSnap.exists) {
      throw new HttpsError('not-found', 'Boutique introuvable');
    }
    const shop = shopSnap.data()!;
    if (shop.ownerId !== ownerUid) {
      throw new HttpsError('permission-denied', 'Vous n\'êtes pas le propriétaire de cette boutique');
    }
    // B10: only an APPROVED shop earns the buyer-fee reduction (reductionForShopDoc
    // returns 0 otherwise). Refuse the purchase for pending/rejected/suspended shops
    // so we never encash a forfait that grants no benefit (no auto-refund exists).
    if (shop.status !== 'approved') {
      throw new HttpsError(
        'failed-precondition',
        'Votre boutique doit être approuvée avant de souscrire à un forfait.'
      );
    }

    // DIRECT PLATFORM CHARGE — no transfer_data / on_behalf_of (vague 1 model):
    // forfait revenue stays on the platform account.
    //
    // B11: the idempotency key includes the shop's CURRENT tierPaidUntil so a
    // LEGITIMATE renewal (which extends tierPaidUntil once the previous PI is
    // applied) produces a DISTINCT key — Stripe no longer dedups it inside the 24h
    // window. A true retry of the SAME attempt (before the webhook stamps the new
    // tierPaidUntil) keeps the same key and is still deduped, so no double-charge.
    const currentUntilMs =
      shop.tierPaidUntil && typeof shop.tierPaidUntil.toMillis === 'function'
        ? shop.tierPaidUntil.toMillis()
        : 0;
    const idempotencyKey = `shop_tier_${shopId}_${tier}_${periodMonths}_${currentUntilMs}`;
    const operationId = 'forfait_' + createHash('sha256').update(JSON.stringify([ownerUid, idempotencyKey])).digest('hex');
    const operationRef = db.collection('eligibility_audit').doc(operationId);
    const operation = await db.runTransaction(async tx => {
      await assertPrivateAccountSession(request, tx);
      const previous = (await tx.get(operationRef)).data();
      if (previous) {
        if (!qualifiedShopTierOperation(previous, operationId) || previous.ownerId !== ownerUid || previous.shopId !== shopId ||
            previous.idempotencyKey !== idempotencyKey || previous.tier !== tier || previous.periodMonths !== periodMonths) {
          throw new HttpsError('failed-precondition', 'Cette demande de forfait doit être examinée.');
        }
        // Recovery reads an existing provider identity; never create to discover
        // whether the first call (possibly interrupted) reached Stripe.
        if (typeof previous.paymentIntentId !== 'string') throw new HttpsError('failed-precondition',
          'Le résultat de votre demande de forfait doit être vérifié. Contactez notre équipe.',
          { reason: 'forfait_operation_unsettled', action: 'contactSupport' });
        if (['rejected', 'canceled', 'review_required', 'settled'].includes(previous.state)) throw new HttpsError('failed-precondition',
          'Cette demande a déjà une issue ou nécessite un examen. Actualisez votre boutique.', { reason: 'forfait_operation_not_payable', action: 'contactSupport' });
        return { existing: true as const, paymentIntentId: previous.paymentIntentId, amountCents: previous.amountCents };
      }
      throw new HttpsError('failed-precondition','Mettez l’application à jour pour démarrer une nouvelle demande de forfait.',
        {reason:'forfait_durable_request_required',action:'updateApp'});
    });
    const amountCents = operation.amountCents;
    await db.runTransaction(async tx => {await assertPrivateAccountSession(request,tx);});
    let paymentIntent;
    try {paymentIntent = await stripe.paymentIntents.retrieve(operation.paymentIntentId);}
    catch(recoveryError) {if(recoveryError instanceof FinancialRecoveryBlocked)throw recoveryError;throw new HttpsError('unavailable','Le paiement du forfait ne peut pas être relu actuellement. Réessayez avec la même demande.');}

    const nativeOperation = (await operationRef.get()).data();
    if (!qualifiedShopTierOperation(nativeOperation, operationId) || !shopTierPaymentMatches(paymentIntent, nativeOperation, operationId, false)) {
      throw new HttpsError('failed-precondition', 'Le paiement du forfait doit être rapproché.', { reason: 'forfait_payment_identity_unknown', action: 'contactSupport' });
    }


    await db.runTransaction(async tx => {
      await assertPrivateAccountSession(request, tx);
      const witness = (await tx.get(operationRef)).data();
      if (!qualifiedShopTierOperation(witness, operationId) || !shopTierPaymentMatches(paymentIntent, witness, operationId, false) ||
          !['reserved', 'pending', 'unknown'].includes(witness.state) ||
          !['requires_payment_method', 'requires_confirmation', 'requires_action'].includes(paymentIntent.status)) {
        throw new HttpsError('failed-precondition',
          'Ce paiement est en cours ou a déjà une issue. Actualisez votre boutique avant de poursuivre.',
          {reason: 'forfait_operation_not_payable', action: 'contactSupport'});
      }
      // Historical GET keeps its native price; issuing a new confirmation
      // secret still requires today's owner, shop and account admission.
      await tierOwner(tx,request,{shopId,tier,periodMonths});
      await prepareFinancialRecoverySource('shop_tier',operationRef.path,witness);
    });

    logger.info('[purchaseShopTier] PaymentIntent created', {
      shopId,
      tier,
      periodMonths,
      amountCents,
      paymentIntentId: paymentIntent.id,
    });

    return {
      success: true as const,
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      tier,
      periodMonths,
      amountCents,
    };
  }))
);
