import { financialRecoveryCommitCheckpoint } from "./financialRecoverySources";
import { financialRecoveryWalletFields } from "./financialRecoverySources";
import { financialRecoverySourceFields, prepareFinancialRecoverySource } from './financialRecoverySources';
import { FinancialRecoveryBlocked } from './financialRecoveryInterlock';
/** Manual-confirmation checkout. Every new provider confirmation has a durable
 * server authorization. Provider IO never runs in a Firestore transaction. */
import { createHash, randomUUID } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { db, FieldValue } from '../config/firebase';
import { assertPrivateAccountSession, withPrivateAccountSession } from './privateAccountSession';

/** Only private caller access/new authorization is session-gated. Native
 * evidence commits after an authorized POST remain autonomous below. */
type CheckoutSessionGuard = (tx?: FirebaseFirestore.Transaction) => Promise<unknown>;
import { getStripe } from '../config/stripe';
import { getShipEngine } from '../config/shipEngine';
import { assertNewPaymentsEnabled, isShippingEnabled } from '../config/featureFlags';
import { getCheckoutReturnUrl } from '../shared/checkoutRedirect';
import { isProductionRuntime } from '../config/runtimeEnvironment';
import { captureConnectObservationBarrier, observeConnectAccount } from './connectEligibility';
import { readReservedShippingPurchase, type ReservedShippingPurchase } from './reservedShippingPurchase';
import { acceptedOrderPurchasePolicy, acceptedQuotePurchasePolicy } from './purchasePolicy';
import { assertArticleSaleDeclaration } from './articleSaleDeclaration';
import { assertArticleChildSafetyAdmitted } from './tradeAdmission';
import { getServiceFeeConfig } from './fees';
import { readWalletPaymentReceipt } from './walletPurchase';
import { assertAccountRelationshipNewPair, assertRelationshipPurchaseRetirement, assertRelationshipPurchaseDraftNeutralization, ACCOUNT_RELATIONSHIP_CAPABILITY,
  type AccountRelationshipReference } from './accountRelationshipReview';
import {supportUid, supportObject, supportHash, supportSourceHash, supportRequestId} from './supportRequest';
import { isDefinitiveStripeFailure } from './payoutOutcome';
import { assertAvailableWalletFunds } from './walletFundsAdmission';
import { fraudReviewAllowsProgress } from './fraudReviewDecision';
import { prepareFraudCandidateProjection } from './fraudReviewCandidates';
import { hasCurrentRateQualification, consistentRateDetails, exactCents } from './shippingPurchaseRate';
import { assertNoActiveBankDispute } from './bankDispute';
import { assertNoUnsettledRefund } from './refundState';
import { articleReleaseUpdate, commitArticleRelease } from './articleReservation';
import { stripeIntentEvidence, exactMixedDebit, nativeTime, nonnegativeCents, type IntentEvidence } from './stripeCheckoutProof';

const sha = (v: unknown) => createHash('sha256').update(JSON.stringify(v) ?? 'undefined').digest('hex');
const orderRef = (id: string) => db.collection('transactions').doc(id);
const intentRef = (id: string) => db.collection('stripe_checkout_intents').doc(id);
const review = (reason = 'stripe_checkout_reconciliation_required') => new HttpsError('failed-precondition',
  'Le paiement doit être rapproché avant toute nouvelle demande. Contactez notre équipe.',
  { reason, action: 'contactSupport', paymentPermissionGranted: false });
const stale = () => new HttpsError('aborted', 'Les renseignements ou le prix accepté ont changé. Aucun nouvel accord de paiement n’a été autorisé.',
  { reason: 'stripe_checkout_stale', action: 'reviewPendingOrder', paymentPermissionGranted: false });
const uncertain = () => new HttpsError('unavailable', 'Le résultat du paiement est en cours de vérification. Ne relancez pas une confirmation.',
  { reason: 'stripe_checkout_unknown', action: 'refreshCheckout', paymentPermissionGranted: false });
export function checkoutId(v: unknown): string {
  if (typeof v !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(v)) throw new HttpsError('invalid-argument', 'transactionId invalide');
  return v;
}
function inputWallet(v: unknown): number {
  if (v === undefined) return 0;
  if (!nonnegativeCents(v)) throw new HttpsError('invalid-argument', 'Le montant du solde doit être un entier positif ou nul en cents.');
  return v;
}
interface Local { order: FirebaseFirestore.DocumentData; intent: FirebaseFirestore.DocumentData | null;
  intentSnapshot?: FirebaseFirestore.DocumentSnapshot;
  rows: { id: string; data: FirebaseFirestore.DocumentData }[]; }
type ResponseOperation = 'create' | 'confirm' | 'provider' | 'recovery' | 'action_secret' | 'retirement';
interface ResponseFence {
  operation: ResponseOperation;
  intentId: unknown; protocol: unknown; version: unknown; state: unknown;
  paymentIntentId: unknown; confirmAttemptId: unknown; retireOperationId: unknown;
  orderBinding: string;
}
/** Scalar causal identity only. FieldValue sentinels and native timestamps are
 * deliberately excluded; the financial proof validates native times on reads. */
function responseFence(operation: ResponseOperation, l: Local): ResponseFence {
  const i=l.intent, o=l.order;
  return {operation,intentId:i?.intentId??null,protocol:i?.protocol??null,version:i?.version??null,state:i?.state??null,
    paymentIntentId:i?.paymentIntentId??null,confirmAttemptId:i?.confirmAttemptId??null,retireOperationId:i?.retireOperationId??null,
    orderBinding:sha([o.buyerId,o.sellerId,o.articleId,o.status,o.totalAmount,o.currency??null,o.shippingQuoteId??null,
      o.shipEngineRateId??null,o.stripePaymentIntentId??null,o.walletAmountUsed??null,o.paidVia??null,
      o.walletCheckoutAttemptId??null,o.stripeCheckoutProtocol??null])};
}
function responseIsCurrent(l: Local, fence: ResponseFence): boolean {
  return sha(responseFence(fence.operation,l))===sha(fence);
}
/** One latest conflict per fixed operation slot (six), not an unbounded event
 * log or a monetary state. Never copy a provider secret or arbitrary metadata. */
function providerObservation(pi:any) {
  const text=(v:unknown)=>typeof v==='string' && v.length<=256?v:null;
  return {paymentIntentId:text(pi?.id),relatedPaymentIntentId:text(pi?.relatedPaymentIntentId),
    paymentIntentIdHash:typeof pi?.id==='string'?sha(pi.id):null,
    paymentIntentIdPrefix:typeof pi?.id==='string' && pi.id.length>256?pi.id.slice(0,256):null,
    chargeId:text(typeof pi?.latest_charge==='string'?pi.latest_charge:pi?.latest_charge?.id),
    amountCents:nonnegativeCents(pi?.amount)?pi.amount:null,receivedCents:nonnegativeCents(pi?.amount_received)?pi.amount_received:null,
    capturableCents:nonnegativeCents(pi?.amount_capturable)?pi.amount_capturable:null,currency:text(pi?.currency),status:text(pi?.status),
    // Fixed native attribution only; never arbitrary provider metadata/secrets.
    transactionId:text(pi?.metadata?.transactionId),buyerId:text(pi?.metadata?.buyerId),sellerId:text(pi?.metadata?.sellerId),
    checkoutIntentId:text(pi?.metadata?.checkoutIntentId)};
}
async function lateConflict(tx: FirebaseFirestore.Transaction,id:string,l:Local,fence:ResponseFence,reason:string,pi?:any,
  cause?:{actorId:string;requestId:string;operationId:string;payloadHash:string;localSourceHash:string},observedAt?:Timestamp) {
  // An already authorized POST remains factual even if its old intent/order
  // disappeared. Merge only this bounded evidence slot, never foreign state.
  await financialRecoveryCommitCheckpoint()({refs:[intentRef(id).path]});
  tx.set(intentRef(id),{lateResponseEvidence:{[fence.operation]:{reason,expected:fence,
    current:responseFence(fence.operation,l),observed:providerObservation(pi),...(cause?{cause}:{}),
    observedAt:observedAt??FieldValue.serverTimestamp()}}},{merge:true});
}
async function local(tx: FirebaseFirestore.Transaction, uid: string, id: string, authorize?: CheckoutSessionGuard): Promise<Local> {
  await authorize?.(tx);
  const order = (await tx.get(orderRef(id))).data();
  if (!order) throw new HttpsError('not-found', 'Commande introuvable');
  if (order.buyerId !== uid) throw new HttpsError('permission-denied', 'Pas votre commande');
  const intentSnapshot = await tx.get(intentRef(id)), intent = intentSnapshot.data() ?? null;
  const ledger = await tx.get(db.collection('wallets').doc(uid).collection('ledger').where('transactionId','==',id).limit(101));
  if (ledger.size >= 101) throw review();
  return { order, intent, intentSnapshot, rows: ledger.docs.map(d => ({ id:d.id, data:d.data() })) };
}
async function checkoutIntentFields(id:string,l:Local,patch:FirebaseFirestore.DocumentData) {
  if (!l.intent && !l.intentSnapshot) throw review();
  return financialRecoverySourceFields('card_intent',intentRef(id),l.intent ?? l.intentSnapshot!,patch);
}
const checkoutOrderFields=(id:string,l:Local,patch:FirebaseFirestore.DocumentData)=>
  financialRecoverySourceFields('purchase',orderRef(id),l.order,patch);
async function qualifyCheckoutPost(uid:string,id:string,fence:ResponseFence,authorize?:CheckoutSessionGuard) {
  await db.runTransaction(async tx=>{
    const l=await local(tx,uid,id,authorize);
    if(!l.intent || !responseIsCurrent(l,fence))throw stale();
    await prepareFinancialRecoverySource('purchase',orderRef(id).path,l.order);
    await prepareFinancialRecoverySource('card_intent',intentRef(id).path,l.intent);
  });
}
function validIntent(l: Local, uid: string, id: string): boolean {
  const i = l.intent;
  return !!i && i.schemaVersion === 1 && i.protocol === 'server_manual_v1' && i.ownerId === uid && i.transactionId === id &&
    typeof i.intentId === 'string' && i.intentId.length > 0 && Number.isSafeInteger(i.version) && i.version > 0 && i.version < Number.MAX_SAFE_INTEGER &&
    nonnegativeCents(i.walletCents) && nonnegativeCents(i.totalCents) && i.totalCents > 0 && i.cardCents === i.totalCents-i.walletCents &&
    i.cardCents >= 50 && i.currency === 'CAD' && typeof i.sourceHash === 'string' && /^[a-f0-9]{64}$/.test(i.sourceHash) &&
    Number.isSafeInteger(i.sourceRevision) && i.sourceRevision>=0 && i.sellerId===l.order.sellerId &&
    i.totalCents===exactCents(l.order.totalAmount) && i.quoteId===l.order.shippingQuoteId && i.rateId===l.order.shipEngineRateId &&
    ['creating','prepared','confirming','unknown','action_required','requires_payment_method','requires_confirmation','requires_action','processing','succeeded','requires_capture','canceled'].includes(i.state);
}
function proofExpected(l: Local, uid: string, id: string) {
  const total = exactCents(l.order.totalAmount), wallet = l.intent?.protocol === 'server_manual_v1' ? l.intent.walletCents :
    (l.order.walletAmountUsed == null ? 0 : l.order.walletAmountUsed);
  if (!total || !nonnegativeCents(wallet) || wallet >= total || typeof l.order.sellerId !== 'string' ||
    (l.order.currency != null && l.order.currency !== 'CAD')) throw review();
  return { id: l.order.stripePaymentIntentId ?? l.intent?.paymentIntentId, orderId:id, buyerId:uid,
    sellerId:l.order.sellerId, cardCents:total-wallet, walletCents:wallet,
    ...(l.intent?.protocol === 'server_manual_v1' ? { intentId:l.intent.intentId } : {}) };
}
function assertNoNewExposure(l: Local) {
  const o = l.order;
  if (o.status !== 'pending_payment' || o.stripePaymentIntentId != null || l.rows.length || o.walletPayment != null || o.paidAt != null ||
    o.stripeChargeId != null || o.capturedCardCents != null || o.paidVia != null || (o.walletAmountUsed != null && o.walletAmountUsed !== 0) ||
    o.walletCheckoutAttemptId != null || o.walletCheckoutOutcome != null || o.checkoutLock != null || o.walletDebitReservedAt != null ||
    Object.prototype.hasOwnProperty.call(o,'serviceFeePercent')) throw review();
}
async function canonical(tx: FirebaseFirestore.Transaction, uid: string, id: string, l: Local, observed: boolean) {
  await assertAccountRelationshipNewPair(tx, uid, l.order.sellerId);
  assertNoActiveBankDispute(l.order); assertNoUnsettledRefund(l.order); assertNewPaymentsEnabled();
  if (!isShippingEnabled() || l.order.deliveryType !== 'shipping') throw new HttpsError('failed-precondition', 'Une commande expédiée avec devis accepté est nécessaire.');
  if (l.order.status !== 'pending_payment') throw review();
  return readReservedShippingPurchase(tx,uid,id,l.order,observed);
}
async function fresh(uid: string, id: string, validate: (l: Local) => void, authorize?: CheckoutSessionGuard) {
  const pre = await db.runTransaction(async tx => { const l=await local(tx,uid,id,authorize); validate(l); return canonical(tx,uid,id,l,false); });
  const stripe=getStripe(); if (!stripe) throw new HttpsError('unavailable','Paiement indisponible');
  try {
    await authorize?.();
    const barrier=await captureConnectObservationBarrier(pre.sellerId,pre.accountId,authorize);
    await authorize?.();
    const account=await stripe.accounts.retrieve(pre.accountId);
    await authorize?.();
    await observeConnectAccount(pre.sellerId,account,{barrier,expectedId:pre.accountId,transactionGuard:authorize});
  } catch (e) {if(e instanceof FinancialRecoveryBlocked)throw e; await authorize?.(); if(e instanceof HttpsError && e.code==='aborted') throw stale(); throw new HttpsError('failed-precondition','Cette vente est momentanément indisponible.'); }
  const prepared=await db.runTransaction(async tx=>{const l=await local(tx,uid,id,authorize);validate(l);return canonical(tx,uid,id,l,true);});
  const engine=getShipEngine(); if(!engine) throw new HttpsError('unavailable','Le tarif ne peut pas être vérifié.');
  let rates;
  await authorize?.();
  try { rates=await engine.getPurchaseRatesForShipment(prepared.quote.rates.shipmentId,prepared.context); }
  catch(recoveryError) {if(recoveryError instanceof FinancialRecoveryBlocked)throw recoveryError; await authorize?.(); throw new HttpsError('unavailable','Le tarif ne peut pas être vérifié. Aucun nouveau paiement n’a été effectué.'); }
  await authorize?.();
  if(!hasCurrentRateQualification(rates,prepared.context)) throw stale();
  const selected=prepared.quote.rates.rates.find((r:any)=>r.rateId===prepared.order.shipEngineRateId), live=rates.rates.find(r=>r.rateId===selected?.rateId);
  if(!live || supportSourceHash(live)!==supportSourceHash(selected) || rates.shipmentId!==selected.shipmentId ||
    !consistentRateDetails(prepared.quote.rates.qualification,rates.qualification,selected.rateId)) throw stale();
  return prepared;
}
function same(a: ReservedShippingPurchase,b: ReservedShippingPurchase) {
  if(a.hash!==b.hash || a.revision!==b.revision || sha(a.quote)!==sha(b.quote) || sha(a.order)!==sha(b.order)) throw stale();
}
function dto(i:any,e?:IntentEvidence) {
  return { protocol:'server_manual_v1',transactionId:i.transactionId,intentVersion:i.version,
    preparationState:i.state,providerStatus:e?.status ?? i.providerStatus ?? 'unknown',
    totalCents:i.totalCents,walletCents:i.walletCents,cardCents:i.cardCents,currency:'CAD',
    paymentPermissionGranted:false,confirmationRequired:!!e && ['unconfirmed','confirmation'].includes(e.state),
    settlementPending:!!e && ['processing','succeeded','authorized'].includes(e.state),
    action:i.state==='action_required'?'contactSupport':e?.state==='canceled'?'reviewCancellation':e?.state==='action'?'handleNextAction':i.state==='unknown'?'refreshCheckout':'confirmOnServer' };
}
async function action(id:string,uid:string,reason:string,fence:ResponseFence,pi?:any) {
  // Autonomous bounded evidence for already observed provider results. This
  // cannot create/confirm/cancel and must survive loss of the caller session.
  const applied=await db.runTransaction(async tx=>{
    const recoveryCommit = financialRecoveryCommitCheckpoint();const l=await local(tx,uid,id); const i=l.intent;
    if(i && i.ownerId!==uid) throw review();
    if(!responseIsCurrent(l,fence)){await lateConflict(tx,id,l,fence,reason,pi);return false;}
    await recoveryCommit({refs: [(intentRef(id)).path]});
    tx.set(intentRef(id),await checkoutIntentFields(id,l,{...(i??{}),schemaVersion:1,ownerId:uid,transactionId:id,state:'action_required',reason,
      ...(pi && typeof pi.id==='string' ? { observedPaymentIntentId:pi.id, observedAmount:nonnegativeCents(pi.amount)?pi.amount:null,
        observedReceived:nonnegativeCents(pi.amount_received)?pi.amount_received:null,observedCurrency:typeof pi.currency==='string'?pi.currency:null,
        observedStatus:typeof pi.status==='string'?pi.status:null } : {}),updatedAt:FieldValue.serverTimestamp()}),{merge:true});return true;});
  if(!applied)throw stale();
}
async function provider(l:Local,uid:string,id:string,authorize?:CheckoutSessionGuard) {
  await authorize?.();
  const expected=proofExpected(l,uid,id), stripe=getStripe(); if(!stripe) throw uncertain();
  if(typeof expected.id!=='string' || !/^pi_[A-Za-z0-9]+$/.test(expected.id)) throw review();
  let pi;
  try { pi=await stripe.paymentIntents.retrieve(expected.id); } catch(recoveryError) {if(recoveryError instanceof FinancialRecoveryBlocked)throw recoveryError; await authorize?.(); throw uncertain(); }
  await authorize?.();
  const evidence=stripeIntentEvidence(pi,expected);
  if(!evidence){await action(id,uid,'payment_intent_evidence_conflict',responseFence('provider',l),pi);throw review();}
  return {pi,evidence};
}
function assertMixedEvidence(l:Local,i:any) {
  if(i.walletCents===0) { if(l.rows.length || (l.order.walletAmountUsed!=null && l.order.walletAmountUsed!==0)) throw review(); return; }
  if(!exactMixedDebit(l.order,l.rows,i.walletCents,i.walletLedgerId) || !nativeTime(i.walletCommittedAt)) throw review();
}
async function readExisting(uid:string,id:string,l:Local,authorize?:CheckoutSessionGuard) {
  const {pi,evidence}=await provider(l,uid,id,authorize);
  if(l.intent?.protocol==='server_manual_v1') {
    if(!validIntent(l,uid,id)) throw review();
    let i=l.intent;
    if(i.walletCommittedAt!=null) assertMixedEvidence(l,i); else if(l.rows.length || l.order.walletAmountUsed>0) throw review();
    if(i.state==='unknown' || i.state==='confirming') {
      // A present live response can resolve the read, but cannot prove an earlier
      // confirm did NOT run when it still looks unconfirmed. Never auto-confirm.
      if(['unconfirmed','confirmation'].includes(evidence.state)) throw uncertain();
    }
    if(['unknown','confirming'].includes(i.state) && ['action','processing','succeeded','authorized','canceled'].includes(evidence.state) && nativeTime(i.authorizedAt)) {
      const captured=i;
      i=await db.runTransaction(async tx=>{
    const recoveryCommit = financialRecoveryCommitCheckpoint();const current=await local(tx,uid,id,authorize);
        if(sha(current.intent)!==sha(captured) || current.order.stripePaymentIntentId!==evidence.id) throw stale();
        if(captured.walletCommittedAt!=null) assertMixedEvidence(current,captured);
        const update={state:evidence.status,providerStatus:evidence.status,version:captured.version+1,
          receivedCents:evidence.receivedCents,capturableCents:evidence.capturableCents,updatedAt:FieldValue.serverTimestamp()};
        await authorize?.(tx);
        await recoveryCommit({refs: [(intentRef(id)).path]});
    tx.update(intentRef(id),await checkoutIntentFields(id,current,update));await recoveryCommit({refs: [(orderRef(id)).path]});
    tx.update(orderRef(id),await checkoutOrderFields(id,current,{walletCheckoutOutcome:FieldValue.delete()}));
        return {...captured,...update};});
    }
    const latest=await db.runTransaction(async tx=>{const current=await local(tx,uid,id,authorize);
      if(!responseIsCurrent(current,responseFence('provider',{...l,intent:i})))throw stale();
      return current;});
    if(!validIntent(latest,uid,id))throw review();
    i=latest.intent!;
    await authorize?.();
    const result:any=dto(i,evidence);
    if(evidence.state==='action' && i.authorizedAt!=null && nativeTime(i.authorizedAt) && i.state!=='action_required') {
      if(typeof pi.client_secret!=='string' || !pi.client_secret.startsWith(`${evidence.id}_secret_`) || pi.client_secret.length<=`${evidence.id}_secret_`.length) {await action(id,uid,'action_secret_identity_conflict',responseFence('action_secret',{...l,intent:i}),pi);throw review();}
      result.actionClientSecret=pi.client_secret;
    }
    return result;
  }
  await db.runTransaction(async tx=>{const current=await local(tx,uid,id,authorize);
    if(!responseIsCurrent(current,responseFence('provider',l)))throw stale();});
  await authorize?.();
  const wallet=proofExpected(l,uid,id).walletCents;
  if(wallet>0 && !exactMixedDebit(l.order,l.rows,wallet)) throw review();
  if(wallet===0 && l.rows.length) throw review();
  return { protocol:'legacy',transactionId:id,providerStatus:evidence.status,paymentPermissionGranted:false,
    settlementPending:['processing','succeeded','authorized'].includes(evidence.state),
    legacyCardCapabilityOpen:evidence.method==='automatic' && ['unconfirmed','action','confirmation'].includes(evidence.state),
    action:['processing','succeeded','authorized'].includes(evidence.state)?'awaitSettlement':'retireLegacyCheckout',
    retirementVersion:sha({order:l.order,rows:l.rows}),walletCents:wallet,cardCents:evidence.amountCents,currency:'CAD' };
}
/** Preparation creates no wallet debit and returns no client secret. */
export async function prepareStripeCheckout(uid:string,id:string,rawWallet:unknown,authorize?:CheckoutSessionGuard) {
  await authorize?.();
  const walletCents=inputWallet(rawWallet), first=await db.runTransaction(tx=>local(tx,uid,id,authorize));
  if(!first.intent && !first.order.stripePaymentIntentId && first.order.paidVia==='wallet') {
    const receipt=await readWalletPaymentReceipt(uid,id,authorize);if(receipt)return {protocol:'wallet_receipt',...receipt};
  }
  if(first.intent?.protocol==='server_manual_v1' && rawWallet!==undefined && first.intent.walletCents!==walletCents &&
    ['prepared','requires_payment_method','requires_confirmation','requires_action'].includes(first.intent.state))
    throw new HttpsError('failed-precondition','Le mode accepté diffère. Aucune nouvelle demande n’a été créée.');
  if(first.order.stripePaymentIntentId || first.intent?.paymentIntentId) return readExisting(uid,id,first,authorize);
  if(first.intent) {
    if(!validIntent(first,uid,id)) throw review();
    if(rawWallet!==undefined && first.intent.walletCents!==walletCents) throw new HttpsError('failed-precondition','Le mode accepté diffère. Aucune nouvelle demande n’a été créée.');
    // Recovery scans provider evidence, never creates to discover an effect.
    return recoverCreatedIntent(uid,id,first,authorize);
  }
  assertNoNewExposure(first);
  if (!acceptedOrderPurchasePolicy(first.order, id)) throw new HttpsError('failed-precondition', 'Acceptez la politique dans un nouveau devis avant ce paiement.',
    { reason: 'purchase_policy_acceptance_required', action: 'quoteShippingPurchase', paymentPermissionGranted: false });
  const prepared=await fresh(uid,id,assertNoNewExposure,authorize);
  if(walletCents>=prepared.totalCents || prepared.totalCents-walletCents<50) throw new HttpsError('invalid-argument','La portion carte doit rester d’au moins 50 cents.');
  const operation=randomUUID(), now=FieldValue.serverTimestamp();
  const decision=await db.runTransaction(async tx=>{
    const recoveryCommit = financialRecoveryCommitCheckpoint();
    const l=await local(tx,uid,id,authorize); if(l.intent) throw uncertain(); assertNoNewExposure(l);
    const current=await canonical(tx,uid,id,l,true);same(current,prepared);
    const article = (await tx.get(db.collection('articles').doc(current.articleId))).data();
    if (!article) throw review();
    assertArticleSaleDeclaration(current.articleId, article);
    await assertArticleChildSafetyAdmitted(tx, current.articleId, article);
    if (!acceptedQuotePurchasePolicy(l.order, id, current.quote)) throw review();
    const value={schemaVersion:1,protocol:'server_manual_v1',transactionId:id,ownerId:uid,sellerId:current.sellerId,
      intentId:operation,version:1,state:'creating',totalCents:current.totalCents,walletCents,cardCents:current.totalCents-walletCents,currency:'CAD',
      quoteId:current.order.shippingQuoteId,rateId:current.order.shipEngineRateId,sourceHash:current.hash,sourceRevision:current.revision,
      createdAt:now,updatedAt:now};
    const orderUpdate={serviceFeePercent:getServiceFeeConfig().percent,walletCheckoutAttemptId:operation,walletCheckoutOutcome:'creating',stripeCheckoutProtocol:'server_manual_v1',updatedAt:now};
    await authorize?.(tx);
    await recoveryCommit({refs: [(intentRef(id)).path]});
    tx.set(intentRef(id),await checkoutIntentFields(id,l,value));await recoveryCommit({refs: [(orderRef(id)).path]});
    tx.update(orderRef(id),await checkoutOrderFields(id,l,orderUpdate));
    return {intent:value,fence:responseFence('create',{...l,intent:value,order:{...l.order,...orderUpdate}})};
  });
  const {intent:i,fence}=decision;
  const stripe=getStripe()!;let pi;
  await authorize?.();
  await qualifyCheckoutPost(uid,id,fence,authorize);
  try { pi=await stripe.paymentIntents.create({amount:i.cardCents,currency:'cad',confirmation_method:'manual',payment_method_types:['card'],
    metadata:{transactionId:id,buyerId:uid,sellerId:i.sellerId,checkoutIntentId:i.intentId,
      ...(walletCents>0?{walletAmountUsed:String(walletCents),paymentType:'wallet_and_card',walletCheckoutAttemptId:operation}:{})}},
    {idempotencyKey:`checkout_create_${operation}`}); }
  catch(recoveryError) {if(recoveryError instanceof FinancialRecoveryBlocked)throw recoveryError; await markUnknown(uid,id,fence,'create');throw uncertain(); }
  const evidence=stripeIntentEvidence(pi,{orderId:id,buyerId:uid,sellerId:i.sellerId,cardCents:i.cardCents,walletCents,intentId:i.intentId});
  const knownId=typeof pi?.id==='string' && /^pi_[A-Za-z0-9]+$/.test(pi.id)?pi.id:null;
  // Preserve the real POST result even if the private caller was revoked.
  // This commit cannot initiate another provider request or return a secret.
  const applied=await db.runTransaction(async tx=>{
    const recoveryCommit = financialRecoveryCommitCheckpoint();
    const l=await local(tx,uid,id);
    if(!responseIsCurrent(l,fence)) {
      const currentId=l.intent?.paymentIntentId??l.order.stripePaymentIntentId;
      if(!evidence || (knownId && knownId!==currentId))await lateConflict(tx,id,l,fence,'create_response_conflict',pi);
      return false;
    }
    let current:ReservedShippingPurchase|null=null;
    try { await authorize?.(tx); current=await canonical(tx,uid,id,l,true); } catch(recoveryError) {if(recoveryError instanceof FinancialRecoveryBlocked)throw recoveryError; /* Keep the real provider identity; grant no new permission. */ }
    const usable=!!evidence && evidence.state==='unconfirmed' && !!current && current.hash===i.sourceHash && current.revision===i.sourceRevision;
    const fraudCandidates=knownId ? await prepareFraudCandidateProjection(tx,id,{...l.order,stripePaymentIntentId:knownId}) : null;
    await recoveryCommit({refs: [(intentRef(id)).path]});
    tx.update(intentRef(id),await checkoutIntentFields(id,l,{state:usable?'prepared':knownId?'action_required':'unknown',version:i.version+1,
      paymentIntentId:knownId,providerStatus:evidence?.status??'unknown',reason:usable?null:'create_response_or_source_requires_review',updatedAt:FieldValue.serverTimestamp()}));
    await recoveryCommit({refs: [(orderRef(id)).path]});
    tx.update(orderRef(id),await checkoutOrderFields(id,l,{...(knownId?{stripePaymentIntentId:knownId,stripeCheckoutCreatedAt:FieldValue.serverTimestamp()}:{}),
      walletCheckoutOutcome:usable?FieldValue.delete():'unknown'}));
    fraudCandidates?.commit();
    return true;
  });
  if(!applied)throw stale();
  if(!evidence || evidence.state!=='unconfirmed' || !knownId) throw review();
  const final=await db.runTransaction(tx=>local(tx,uid,id,authorize));
  if(!validIntent(final,uid,id) || final.intent!.state!=='prepared' || final.intent!.intentId!==i.intentId ||
    final.intent!.version!==i.version+1 || final.intent!.paymentIntentId!==knownId || final.order.stripePaymentIntentId!==knownId) throw stale();
  return dto(final.intent,evidence);
}
/** Bounded read-only provider scan: 5 pages / 500 entries from the known creation
 * time. Missing, ambiguous, saturated or unavailable results remain unknown. */
async function recoverCreatedIntent(uid:string,id:string,first:Local,authorize?:CheckoutSessionGuard) {
  await authorize?.();
  const i=first.intent!, stripe=getStripe();
  if(!stripe || i.unknownOperation==='confirm' || i.authorizedAt!=null || !nativeTime(i.createdAt)) throw uncertain();
  const millis=i.createdAt instanceof Date?i.createdAt.getTime():i.createdAt.toMillis();
  let cursor:string|undefined, match:any=null, exhausted=false;
  try {
    for(let page=0;page<5;page++) {
      await authorize?.();
      const result=await stripe.paymentIntents.list({limit:100,created:{gte:Math.floor(millis/1000)-60},...(cursor?{starting_after:cursor}:{})});
      await authorize?.();
      for(const candidate of result.data) {
        if(candidate.metadata?.checkoutIntentId!==i.intentId)continue;
        if(match) {await action(id,uid,'create_recovery_ambiguous',responseFence('recovery',first),{...candidate,relatedPaymentIntentId:match.id});throw review();}
        match=candidate;
      }
      if(!result.has_more){exhausted=true;break;}
      cursor=result.data[result.data.length-1]?.id;if(!cursor)break;
    }
  } catch(e) {if(e instanceof FinancialRecoveryBlocked)throw e;if(e instanceof HttpsError)throw e;throw uncertain();}
  if(!exhausted || !match)throw uncertain();
  const evidence=stripeIntentEvidence(match,{orderId:id,buyerId:uid,sellerId:i.sellerId,cardCents:i.cardCents,walletCents:i.walletCents,intentId:i.intentId});
  if(!evidence || evidence.state!=='unconfirmed'){await action(id,uid,'create_recovery_evidence_conflict',responseFence('recovery',first),match);throw review();}
  await db.runTransaction(async tx=>{
    const recoveryCommit = financialRecoveryCommitCheckpoint();
    const l=await local(tx,uid,id,authorize);if(sha(l.intent)!==sha(i) || l.order.stripePaymentIntentId!=null || l.rows.length || l.order.walletAmountUsed>0)throw stale();
    const fraudCandidates=await prepareFraudCandidateProjection(tx,id,{...l.order,stripePaymentIntentId:evidence.id});
    await authorize?.(tx);
    await recoveryCommit({refs: [(intentRef(id)).path]});
    tx.update(intentRef(id),await checkoutIntentFields(id,l,{paymentIntentId:evidence.id,state:'prepared',providerStatus:evidence.status,version:i.version+1,recoveredAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp()}));
    await recoveryCommit({refs: [(orderRef(id)).path]});
    tx.update(orderRef(id),await checkoutOrderFields(id,l,{stripePaymentIntentId:evidence.id,walletCheckoutOutcome:FieldValue.delete(),stripeCheckoutCreatedAt:FieldValue.serverTimestamp()}));
    fraudCandidates.commit();
  });
  const current=await db.runTransaction(tx=>local(tx,uid,id,authorize));return readExisting(uid,id,current,authorize);
}
/** Autonomous preservation of an already authorized/dispatched attempt: a
 * revoked caller cannot erase its money/provider obligation. Never POST here. */
async function markUnknown(uid:string,id:string,fence:ResponseFence,operation:string) {
  await db.runTransaction(async tx=>{
    const recoveryCommit = financialRecoveryCommitCheckpoint();const l=await local(tx,uid,id);if(!responseIsCurrent(l,fence))return;
    await recoveryCommit({refs: [(intentRef(id)).path]});
    tx.update(intentRef(id),await checkoutIntentFields(id,l,{state:'unknown',unknownOperation:operation,updatedAt:FieldValue.serverTimestamp()}));
    await recoveryCommit({refs: [(orderRef(id)).path]});
    tx.update(orderRef(id),await checkoutOrderFields(id,l,{walletCheckoutOutcome:'unknown'}));});
}
/** Latest live evidence does not automatically authorize a fresh attempt. */
export async function confirmStripePurchase(uid:string,id:string,data:any,authorize?:CheckoutSessionGuard) {
  await authorize?.();
  const expectedVersion=data.expectedIntentVersion;
  if(!Number.isSafeInteger(expectedVersion) || expectedVersion<1) throw new HttpsError('invalid-argument','expectedIntentVersion requis');
  if(data.paymentMethodId!=null && (typeof data.paymentMethodId!=='string' || !/^pm_[A-Za-z0-9]+$/.test(data.paymentMethodId))) throw new HttpsError('invalid-argument','paymentMethodId invalide');
  const first=await db.runTransaction(tx=>local(tx,uid,id,authorize));
  if(!validIntent(first,uid,id)) throw review();
  const original=first.intent!, {pi,evidence}=await provider(first,uid,id,authorize);
  if(original.version>Number.MAX_SAFE_INTEGER-2)throw review('stripe_checkout_version_exhausted');
  if(['processing','succeeded','authorized','canceled','action'].includes(evidence.state)) return readExisting(uid,id,first,authorize);
  if(original.state==='unknown' || original.state==='confirming') throw uncertain();
  if(original.state==='action_required' || original.version!==expectedVersion || !['prepared','requires_payment_method','requires_confirmation','requires_action'].includes(original.state)) throw stale();
  if(evidence.state==='unconfirmed' && !data.paymentMethodId) throw new HttpsError('invalid-argument','Un PaymentMethod carte est requis.');
  if(evidence.state==='confirmation' && (typeof pi.payment_method!=='string' || !/^pm_[A-Za-z0-9]+$/.test(pi.payment_method))) throw review();
  if(evidence.state==='confirmation' && data.paymentMethodId!=null && pi.payment_method!==data.paymentMethodId) throw review();
  const validate=(l:Local)=>{if(!validIntent(l,uid,id) || l.intent!.intentId!==original.intentId || l.intent!.version!==expectedVersion ||
    sha(l.intent)!==sha(original) || l.order.stripePaymentIntentId!==evidence.id) throw stale();
    if(l.intent!.walletCommittedAt!=null) assertMixedEvidence(l,l.intent); else if(l.rows.length || l.order.walletAmountUsed>0) throw review();};
  const prepared=await fresh(uid,id,validate,authorize);
  if(prepared.hash!==original.sourceHash) throw stale();
  const attempt=randomUUID(), ledgerRef=db.collection('wallets').doc(uid).collection('ledger').doc();
  const authorization=await db.runTransaction(async tx=>{
    const recoveryCommit = financialRecoveryCommitCheckpoint();
    const l=await local(tx,uid,id,authorize);validate(l);const current=await canonical(tx,uid,id,l,true);same(current,prepared);
    if (!await fraudReviewAllowsProgress(tx,id,l.order)) throw review('fraud_review_requires_human_decision');
    // Prepared is not an executed payment. Actual historical provider effects
    // were read above; this transaction may authorize a NEW card/ledger effect
    // only from the exact native accepted policy copied from its claimed quote.
    if (!acceptedQuotePurchasePolicy(l.order, id, current.quote)) throw review('purchase_policy_acceptance_requires_reconciliation');
    const article = (await tx.get(db.collection('articles').doc(current.articleId))).data();
    if (!article) throw review();
    assertArticleSaleDeclaration(current.articleId, article);
    await assertArticleChildSafetyAdmitted(tx, current.articleId, article);
    const i=l.intent!;
    const debit=i.walletCents>0 && i.walletCommittedAt==null;
    let balance:number|null=null;
    let recoveryWallet:FirebaseFirestore.DocumentData|null=null;
    if(debit) {
      await assertAvailableWalletFunds(tx,uid);
      const wallet=(await tx.get(db.collection('wallets').doc(uid))).data();
      recoveryWallet=wallet??null;
      if(!wallet || wallet.status!=='active' || typeof wallet.currency!=='string' || wallet.currency.toUpperCase()!=='CAD' || !nonnegativeCents(wallet.balance)) throw review();
      if((wallet.sellerDebt||0)>0) throw new HttpsError('failed-precondition','Votre compte présente un solde dû. L’utilisation du solde est suspendue.',{reason:'wallet_funds_blocked'});
      if(wallet.balance<i.walletCents) throw new HttpsError('failed-precondition','Solde insuffisant dans le porte-monnaie');
      balance=wallet.balance-i.walletCents;
    }
    const update:any={state:'confirming',version:i.version+1,confirmAttemptId:attempt,authorizedAt:FieldValue.serverTimestamp(),
      authorizedSourceHash:current.hash,authorizedObservationRevision:current.revision,paymentMethodId:data.paymentMethodId??pi.payment_method??null,updatedAt:FieldValue.serverTimestamp()};
    await authorize?.(tx);
    if(debit) {
      update.walletLedgerId=ledgerRef.id;update.walletCommittedAt=FieldValue.serverTimestamp();
      await recoveryCommit({refs: [(db.collection('wallets').doc(uid)).path]});
    tx.update(db.collection('wallets').doc(uid),await financialRecoveryWalletFields(db.collection('wallets').doc(uid),recoveryWallet!,{balance:FieldValue.increment(-i.walletCents),updatedAt:FieldValue.serverTimestamp()},{balance: ((recoveryWallet!)["balance"]??0) + (-i.walletCents)}));
      await recoveryCommit({refs: [(ledgerRef).path]});
    tx.set(ledgerRef,{type:'purchase_debit',amount:i.walletCents,balanceAfter:balance,transactionId:id,currency:'CAD',description:'Paiement partiel (porte-monnaie)',createdAt:FieldValue.serverTimestamp()});
      await recoveryCommit({refs: [(orderRef(id)).path]});
    tx.update(orderRef(id),await checkoutOrderFields(id,l,{walletAmountUsed:i.walletCents,paidVia:'wallet_and_card',walletDebitReservedAt:FieldValue.serverTimestamp()}));
    }
    await recoveryCommit({refs: [(intentRef(id)).path]});
    tx.update(intentRef(id),await checkoutIntentFields(id,l,update));await recoveryCommit({refs: [(orderRef(id)).path]});
    tx.update(orderRef(id),await checkoutOrderFields(id,l,{...(debit?{walletAmountUsed:i.walletCents,paidVia:'wallet_and_card'}:{}),walletCheckoutOutcome:'creating'}));
    const intent={...i,...update},order={...l.order,...(debit?{walletAmountUsed:i.walletCents,paidVia:'wallet_and_card'}:{})};
    return {intent,fence:responseFence('confirm',{...l,intent,order})};
  });
  const {intent:authorized,fence}=authorization;
  let confirmed;
  await authorize?.();
  await qualifyCheckoutPost(uid,id,fence,authorize);
  try { confirmed=await getStripe()!.paymentIntents.confirm(evidence.id,
    {return_url:getCheckoutReturnUrl(isProductionRuntime()?'production':'development'),use_stripe_sdk:true,...(data.paymentMethodId?{payment_method:data.paymentMethodId}:{})},
    {idempotencyKey:`checkout_confirm_${attempt}`}); }
  catch(error) {if(error instanceof FinancialRecoveryBlocked)throw error;
    const rejected=isDefinitiveStripeFailure(error)?stripeIntentEvidence((error as any).payment_intent,{...proofExpected(first,uid,id),id:evidence.id}):null;
    if(rejected?.state==='unconfirmed') {
      const hasReservedWallet=await db.runTransaction(async tx=>{
    const recoveryCommit = financialRecoveryCommitCheckpoint();const l=await local(tx,uid,id);if(!l.intent || !responseIsCurrent(l,fence))throw stale();
        if(l.intent.walletCommittedAt!=null)assertMixedEvidence(l,l.intent);
        await recoveryCommit({refs: [(intentRef(id)).path]});
    tx.update(intentRef(id),await checkoutIntentFields(id,l,{state:'requires_payment_method',providerStatus:rejected.status,version:authorized.version+1,
          lastAttemptRejected:true,rejectedAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp()}));
        await recoveryCommit({refs: [(orderRef(id)).path]});
    tx.update(orderRef(id),await checkoutOrderFields(id,l,{walletCheckoutOutcome:FieldValue.delete()}));
        return l.intent.walletCents>0 && l.intent.walletCommittedAt!=null;});
      throw new HttpsError('failed-precondition',hasReservedWallet
        ?'Ce moyen de paiement a été refusé. Le solde déjà réservé reste lié à la commande.'
        :'Ce moyen de paiement a été refusé.',
        {reason:'stripe_checkout_payment_method_rejected',action:'choosePaymentMethod',paymentPermissionGranted:false});
    }
    await markUnknown(uid,id,fence,'confirm');throw uncertain();
  }
  const result=stripeIntentEvidence(confirmed,{...proofExpected(first,uid,id),id:evidence.id});
  if(!result){await action(id,uid,'confirmation_response_conflict',fence,confirmed);throw review();}
  // Preserve the exact old response before applying it: a foreign current
  // PI/owner or changed ledger must never erase real post-authorization money.
  await db.runTransaction(async tx=>{
    const order=(await tx.get(orderRef(id))).data()??{},intent=(await tx.get(intentRef(id))).data()??null;
    await lateConflict(tx,id,{order,intent,rows:[]},fence,'confirmation_post_response_observed',confirmed);
  });
  // Applying financial state still requires its original current binding.
  await db.runTransaction(async tx=>{
    const recoveryCommit = financialRecoveryCommitCheckpoint();
    const l=await local(tx,uid,id);if(!l.intent || !responseIsCurrent(l,fence)) throw stale();
    if(l.intent.walletCommittedAt!=null) assertMixedEvidence(l,l.intent);
    await recoveryCommit({refs: [(intentRef(id)).path]});
    tx.update(intentRef(id),await checkoutIntentFields(id,l,{state:result.status,providerStatus:result.status,version:authorized.version+1,
      receivedCents:result.receivedCents,capturableCents:result.capturableCents,updatedAt:FieldValue.serverTimestamp()}));
    await recoveryCommit({refs: [(orderRef(id)).path]});
    tx.update(orderRef(id),await checkoutOrderFields(id,l,{walletCheckoutOutcome:FieldValue.delete()}));
  });
  const final=await db.runTransaction(tx=>local(tx,uid,id,authorize));return readExisting(uid,id,final,authorize);
}
/** Explicit buyer retirement of attributed, uncaptured legacy CARD ONLY.
 * Unknown results keep the real ID and reservation. No blind compensation. */
export async function retireLegacyStripePurchase(uid:string,id:string,data:any,authorize?:CheckoutSessionGuard) {
  await authorize?.();
  const first=await db.runTransaction(tx=>local(tx,uid,id,authorize));
  if(first.intent?.protocol==='server_manual_v1') throw review();
  const walletCents=proofExpected(first,uid,id).walletCents;
  if(first.intent?.state==='retired' && first.intent.cardCapabilityNeutralized===true && first.intent.providerStatus==='canceled' &&
    first.intent.paymentIntentId===first.order.stripePaymentIntentId && nativeTime(first.intent.completedAt) &&
    first.intent.receivedCents===0 && first.intent.capturableCents===0 && first.intent.currency==='CAD' &&
    first.intent.walletCents===walletCents && (walletCents===0?first.rows.length===0:exactMixedDebit(first.order,first.rows,walletCents))) {
    return {transactionId:id,protocol:'legacy_retirement_v1',providerStatus:'canceled',cardCapabilityNeutralized:true,
      paymentPermissionGranted:false,walletObligationOpen:walletCents>0,walletCents,action:walletCents>0?'contactSupport':'requestNewQuote',replay:true};
  }
  const version=sha({order:first.order,rows:first.rows});
  const priorRetirement=first.intent?.protocol==='legacy_retirement_v1' ||
    Object.prototype.hasOwnProperty.call(first.intent??{},'retireOperationId');
  if(priorRetirement && (first.intent?.protocol!=='legacy_retirement_v1' ||
    first.intent.ownerId!==uid || first.intent.transactionId!==id || !nativeTime(first.intent.authorizedAt) ||
    typeof first.intent.retireOperationId!=='string' || !/^[A-Za-z0-9_-]{16,128}$/.test(first.intent.retireOperationId) ||
    first.intent.paymentIntentId!==first.order.stripePaymentIntentId || first.intent.walletCents!==walletCents ||
    first.intent.cardCents!==proofExpected(first,uid,id).cardCents || first.intent.currency!=='CAD' ||
    first.intent.expectedRetirementVersion!==version))throw review();
  const {evidence}=await provider(first,uid,id,authorize);
  if(evidence.method!=='automatic' || !['unconfirmed','confirmation','action','canceled'].includes(evidence.state) ||
    evidence.receivedCents!==0 || evidence.capturableCents!==0 || first.order.status!=='pending_payment' ||
    (walletCents===0 ? first.rows.length>0 || first.order.paidVia!=null : !exactMixedDebit(first.order,first.rows,walletCents)) ||
    first.order.paidAt!=null || first.order.stripeChargeId!=null || first.order.capturedCardCents!=null) throw review();
  assertNoActiveBankDispute(first.order);assertNoUnsettledRefund(first.order);
  if(data.expectedPaymentIntentId!==evidence.id || data.expectedRetirementVersion!==version) throw stale();
  // A timed-out/unfinished cancellation is observed with GET only. Even a
  // currently uncanceled PI cannot prove that the earlier POST did not run.
  if(priorRetirement && evidence.state!=='canceled')throw uncertain();
  const operation=priorRetirement?first.intent!.retireOperationId:randomUUID();
  const fence=priorRetirement?responseFence('retirement',first):await db.runTransaction(async tx=>{
    const recoveryCommit = financialRecoveryCommitCheckpoint();
    const l=await local(tx,uid,id,authorize);if(sha({order:l.order,rows:l.rows})!==version ||
      (l.intent?.retireOperationId!=null && l.intent.retireOperationId!==operation) || l.intent?.state==='retired') throw stale();
    assertNoActiveBankDispute(l.order);assertNoUnsettledRefund(l.order);
    const update={schemaVersion:1,protocol:'legacy_retirement_v1',transactionId:id,ownerId:uid,paymentIntentId:evidence.id,
      state:'retiring',retireOperationId:operation,walletCents,cardCents:evidence.amountCents,currency:'CAD',expectedRetirementVersion:version,authorizedAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp()};
    await authorize?.(tx);
    await recoveryCommit({refs: [(intentRef(id)).path]});
    tx.set(intentRef(id),await checkoutIntentFields(id,l,update),{merge:true});
    return responseFence('retirement',{...l,intent:{...l.intent,...update}});
  });
  let pi;
  await authorize?.();
  if(evidence.state!=='canceled')await qualifyCheckoutPost(uid,id,fence,authorize);
  try { pi=evidence.state==='canceled'?(await getStripe()!.paymentIntents.retrieve(evidence.id)):
    await getStripe()!.paymentIntents.cancel(evidence.id,{}, {idempotencyKey:`checkout_retire_${operation}`}); }
  catch(recoveryError) {if(recoveryError instanceof FinancialRecoveryBlocked)throw recoveryError;await action(id,uid,'legacy_retirement_unknown',fence);throw uncertain();}
  const canceled=stripeIntentEvidence(pi,proofExpected(first,uid,id));
  if(!canceled || canceled.state!=='canceled'){await action(id,uid,'legacy_retirement_not_canceled',fence,pi);throw review();}
  // Servicing this exact earlier cancellation conserves its native outcome.
  // The private boundary requalifies session before disclosing the receipt.
  await db.runTransaction(async tx=>{
    const recoveryCommit = financialRecoveryCommitCheckpoint();
    const l=await local(tx,uid,id);if(sha({order:l.order,rows:l.rows})!==version || !responseIsCurrent(l,fence)) throw stale();
    assertNoActiveBankDispute(l.order);assertNoUnsettledRefund(l.order);
    const ref=typeof l.order.articleId==='string'?db.collection('articles').doc(l.order.articleId):null;
    const article=ref?(await tx.get(ref)).data():null;
    const release=walletCents===0 && ref && article?await articleReleaseUpdate(tx,ref,article,id):null;
    await recoveryCommit({refs: [(intentRef(id)).path]});
    tx.update(intentRef(id),await checkoutIntentFields(id,l,{state:'retired',providerStatus:'canceled',cardCapabilityNeutralized:true,receivedCents:0,capturableCents:0,completedAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp()}));
    if(walletCents===0) { await recoveryCommit({refs: [(orderRef(id)).path]}); tx.update(orderRef(id),await checkoutOrderFields(id,l,{status:'cancelled',cancelReason:'buyer_retired_legacy_card',cancelledAt:FieldValue.serverTimestamp()})); }
    if(ref && release)commitArticleRelease(tx,ref,release);
  });
  return {transactionId:id,protocol:'legacy_retirement_v1',providerStatus:'canceled',cardCapabilityNeutralized:true,paymentPermissionGranted:false,walletObligationOpen:walletCents>0,walletCents,action:walletCents>0?'contactSupport':'requestNewQuote',replay:false};
}

/** Opt-in operator scope. The old buyer operation above keeps its own effects;
 * this scope only retires external card capability and never edits an order,
 * its reservation, a wallet, a refund or a business decision. */
export const RELATIONSHIP_PURCHASE_RETIREMENT_CAPABILITY='relationship_purchase_retirement_v1';
type RelationshipRetirementCommand={transactionId:string;scope:'admin';sourceHash:string;paymentIntentId:string;
  totalCents:number;walletCents:number;relationshipReference:AccountRelationshipReference;acknowledged:true};
const relationshipHash=(v:any):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const relationshipTime=(v:any):v is Timestamp=>v instanceof Timestamp&&v.toMillis()>0&&v.toMillis()<=Date.now();
function relationshipCommand(raw:unknown):RelationshipRetirementCommand {
  const c=supportObject(raw,['transactionId','scope','sourceHash','paymentIntentId','totalCents','walletCents','relationshipReference','acknowledged']);
  const r=supportObject(c.relationshipReference,['pairId','id','contentHash','version']);
  if(c.scope!=='admin'||!relationshipHash(c.sourceHash)||!/^pi_[A-Za-z0-9]+$/.test(c.paymentIntentId??'')||
    !Number.isSafeInteger(c.totalCents)||c.totalCents<=0||!nonnegativeCents(c.walletCents)||c.walletCents>=c.totalCents||c.acknowledged!==true||
    !/^arp_[a-f0-9]{64}$/.test(r.pairId??'')||!/^ar_[a-f0-9]{64}$/.test(r.id??'')||!relationshipHash(r.contentHash)||!Number.isSafeInteger(r.version)||r.version<1)
    throw new HttpsError('invalid-argument','Achat, source et décision exacts requis.');
  return {transactionId:checkoutId(c.transactionId),scope:'admin',sourceHash:c.sourceHash,paymentIntentId:c.paymentIntentId,
    totalCents:c.totalCents,walletCents:c.walletCents,relationshipReference:{pairId:r.pairId,id:r.id,contentHash:r.contentHash,version:r.version},acknowledged:true};
}
async function relationshipLocal(tx:FirebaseFirestore.Transaction,id:string) {
  const order=(await tx.get(orderRef(id))).data();
  if(!order||order.currency!=='CAD'||![order.buyerId,order.sellerId].every(v=>typeof v==='string'&&v.length>0&&v.length<=200&&!v.includes('/'))||
    order.buyerId===order.sellerId||!relationshipTime(order.createdAt))throw review();
  const l=await local(tx,order.buyerId,id);
  const sellerLedger=await tx.get(db.collection('wallets').doc(order.sellerId).collection('ledger').where('transactionId','==',id).limit(101));
  if(sellerLedger.size>100)throw review();
  return {...l,sellerRows:sellerLedger.docs.map(d=>({id:d.id,data:d.data()})),buyerId:order.buyerId as string,sellerId:order.sellerId as string};
}
type RelationshipLocal=Awaited<ReturnType<typeof relationshipLocal>>;
function relationshipLocalHash(l:RelationshipLocal,r:AccountRelationshipReference) {
  const fields=l.intent?Object.fromEntries(Object.entries(l.intent).filter(([k])=>!['relationshipRetirement','relationshipRetirementFences','financialRecoveryWitness'].includes(k))):null;
  const intent=fields&&Object.keys(fields).length?fields:null;
  const order=Object.fromEntries(Object.entries(l.order).filter(([key])=>key!=='financialRecoveryWitness'));
  return supportSourceHash({order,intent,rows:l.rows,sellerRows:l.sellerRows,relationshipReference:r});
}
async function relationshipProvider(l:RelationshipLocal,id:string,request:any) {
  await assertPrivateAccountSession(request);
  const expected=proofExpected(l,l.buyerId,id),stripe=getStripe();
  if(!stripe||typeof expected.id!=='string'||!/^pi_[A-Za-z0-9]+$/.test(expected.id))throw uncertain();
  const pi=await stripe.paymentIntents.retrieve(expected.id);
  await assertPrivateAccountSession(request);
  const evidence=stripeIntentEvidence(pi,expected);
  if(!evidence||pi.object!=='payment_intent'||pi.on_behalf_of!=null)throw review();
  const captureMethod=['automatic','automatic_async','manual'].includes(pi.capture_method)?pi.capture_method:'unknown';
  return {evidence,captureMethod,observedAt:Timestamp.now()};
}
type RelationshipProvider=Awaited<ReturnType<typeof relationshipProvider>>;
function relationshipSourceHash(l:RelationshipLocal,r:AccountRelationshipReference,p:RelationshipProvider) {
  return supportSourceHash({protocol:RELATIONSHIP_PURCHASE_RETIREMENT_CAPABILITY,localSourceHash:relationshipLocalHash(l,r),provider:p.evidence,captureMethod:p.captureMethod});
}
function relationshipWallet(l:RelationshipLocal,id:string) {
  const amount=proofExpected(l,l.buyerId,id).walletCents;
  return {amount,qualified:amount===0?l.rows.length===0&&l.order.paidVia==null:exactMixedDebit(l.order,l.rows,amount)};
}
function relationshipMayRetire(l:RelationshipLocal,id:string,p:RelationshipProvider) {
  const wallet=relationshipWallet(l,id),e=p.evidence,o=l.order;
  try{assertNoActiveBankDispute(o);assertNoUnsettledRefund(o);}catch(recoveryError){if(recoveryError instanceof FinancialRecoveryBlocked)throw recoveryError;return false;}
  return l.intent?.protocol!=='server_manual_v1'&&l.intent?.retireOperationId==null&&l.intent?.relationshipRetirement==null&&
    l.intent?.confirmAttemptId==null&&l.intent?.authorizedAt==null&&!['creating','confirming','unknown','processing','succeeded','requires_capture'].includes(l.intent?.state)&&
    e.method==='automatic'&&['automatic','automatic_async'].includes(p.captureMethod)&&['unconfirmed','confirmation','action','canceled'].includes(e.state)&&
    e.receivedCents===0&&e.capturableCents===0&&o.status==='pending_payment'&&o.paidAt==null&&o.stripeChargeId==null&&o.capturedCardCents==null&&
    l.sellerRows.length===0&&wallet.qualified&&o.walletPayment==null&&o.fundsReleasedAt==null&&o.sellerCreditedCents==null;
}
function relationshipReceipt(uid:string,rid:string,c:RelationshipRetirementCommand,record?:any) {
  const fenced=record?.protocol==='relationship_purchase_retirement_fence_v1'&&record.state==='not_executed';
  if(record&&((!fenced&&(record.protocol!=='relationship_purchase_retirement_command_v1'||record.state==='not_executed'))||record.actorId!==uid||record.requestId!==rid||
    record.payloadHash!==supportHash(c)||supportHash(record.command)!==supportHash(c)||!['authorized','unknown','received','not_executed'].includes(record.state)||
    record.operationId!==supportHash([uid,rid])||!relationshipTime(record.recordedAt)||
    (fenced?(record.authorizedAt!==null||record.reason!=='requester_neutralized_before_authorization'||record.result!==null):
      !relationshipHash(record.localSourceHash)||!relationshipTime(record.authorizedAt)||record.recordedAt.toMillis()<record.authorizedAt.toMillis())))
    throw new HttpsError('already-exists','Une autre intention ou une preuve inconnue existe pour cet achat.');
  const result=record?.result;
  if(record&&record.state!=='received'&&result!=null)throw review();
  if(record?.state==='received'&&(!relationshipTime(record.authorizedAt)||!relationshipTime(record.providerObservedAt)||
    record.providerObservedAt.toMillis()<record.authorizedAt.toMillis()||!result||result.transactionId!==c.transactionId||
    result.providerStatus!=='canceled'||result.cardCapabilityNeutralized!==true||result.walletCents!==c.walletCents||result.totalCents!==c.totalCents||
    result.walletObligationOpen!==(c.walletCents>0)||result.orderChanged!==false||result.stockChanged!==false||result.fundsMoved!==false||result.paymentPermissionGranted!==false))throw review();
  return {protocol:'relationship_purchase_retirement_command_v1',actorId:uid,requestId:rid,command:c,payloadHash:supportHash(c),
    state:record?.state??'unrecorded',reason:record?.reason??null,result:result?{transactionId:c.transactionId,providerStatus:'canceled',cardCapabilityNeutralized:true,
      walletObligationOpen:c.walletCents>0,walletCents:c.walletCents,totalCents:c.totalCents,paymentPermissionGranted:false,orderChanged:false,stockChanged:false,fundsMoved:false,
      providerObservedAt:record.providerObservedAt.toDate().toISOString()}:null,
    recordedAt:record?.recordedAt.toDate().toISOString()??null,preAuthorizationFenceSupported:true,paymentPermissionGranted:false};
}
function relationshipFences(intent:any):Record<string,any> {
  const fences=intent?.relationshipRetirementFences;
  if(fences==null)return {};
  if(typeof fences!=='object'||Array.isArray(fences)||Object.keys(fences).length>32||Object.keys(fences).some(k=>!relationshipHash(k)))throw review();
  return fences;
}
function relationshipOwnRecordValue(intent:any,uid:string,rid:string,c:RelationshipRetirementCommand) {
  const record=intent?.relationshipRetirement,fence=relationshipFences(intent)[supportHash([uid,rid])];
  if(fence){
    // A fence and a post authorization for one operation contradict each
    // other. Never project an absence proof over a possible external effect.
    if(record?.actorId===uid&&record.requestId===rid)throw review();
    relationshipReceipt(uid,rid,c,fence);return fence;
  }
  if(!record||record.actorId!==uid||record.requestId!==rid)return null;
  relationshipReceipt(uid,rid,c,record);return record;
}
async function relationshipOwnRecord(request:any,uid:string,rid:string,c:RelationshipRetirementCommand) {
  // A caller can inspect only the exact tuple it supplied, not discover another
  // actor's command or the current commerce after losing administrative access.
  return db.runTransaction(async tx=>{
    await assertPrivateAccountSession(request,tx);
    return relationshipOwnRecordValue((await tx.get(intentRef(c.transactionId))).data(),uid,rid,c);
  });
}
async function completeRelationshipRetirement(request:any,uid:string,rid:string,c:RelationshipRetirementCommand,record:any,p:RelationshipProvider) {
  return db.runTransaction(async tx=>{
    const recoveryCommit = financialRecoveryCommitCheckpoint();
    await assertPrivateAccountSession(request,tx);
    const l=await relationshipLocal(tx,c.transactionId),current=l.intent?.relationshipRetirement;
    relationshipReceipt(uid,rid,c,current);
    if(!current||current.operationId!==record.operationId||!['authorized','unknown'].includes(current.state)||
      relationshipLocalHash(l,c.relationshipReference)!==record.localSourceHash)throw stale();
    await assertPrivateAccountSession(request,tx);
    await assertRelationshipPurchaseRetirement(tx,request,c.transactionId,l.buyerId,l.sellerId,c.relationshipReference);
    if(p.evidence.id!==c.paymentIntentId||p.evidence.method!=='automatic'||p.evidence.state!=='canceled'||
      p.evidence.receivedCents!==0||p.evidence.capturableCents!==0||p.evidence.amountCents!==c.totalCents-c.walletCents||
      !['automatic','automatic_async'].includes(p.captureMethod))throw review();
    const result={transactionId:c.transactionId,providerStatus:'canceled',cardCapabilityNeutralized:true,walletObligationOpen:c.walletCents>0,
      walletCents:c.walletCents,totalCents:c.totalCents,paymentPermissionGranted:false,orderChanged:false,stockChanged:false,fundsMoved:false};
    const next={...current,state:'received',reason:null,result,
      providerObservedAt:current.providerObservation && relationshipTime(current.providerObservedAt)?current.providerObservedAt:p.observedAt,recordedAt:Timestamp.now()};
    await assertPrivateAccountSession(request,tx);
    await recoveryCommit({refs: [(intentRef(c.transactionId)).path]});
    tx.set(intentRef(c.transactionId),await checkoutIntentFields(c.transactionId,l,{relationshipRetirement:next}),{merge:true});return relationshipReceipt(uid,rid,c,next);
  });
}
/** Safe GET entry: always dispatched by readSupportRequests, never by the old
 * mutating checkout callable. Old servers reject the new reader operation. */
export async function readRelationshipPurchaseRetirement(request:any) {
  return withPrivateAccountSession(request,()=>readRelationshipPurchaseRetirementPrivate(request));
}
async function readRelationshipPurchaseRetirementPrivate(request:any) {
  const uid=supportUid(request),observe=request.data?.operation==='purchase_legacy_observe';
  const raw=supportObject(request.data,observe?['capability','operation','expectedUid','requestId','command']:
    ['capability','operation','expectedUid','transactionId','relationshipReference']);
  if(raw.capability!==ACCOUNT_RELATIONSHIP_CAPABILITY||!['purchase_legacy_preview','purchase_legacy_observe'].includes(raw.operation))throw review();
  if(observe){
    const rid=supportRequestId(raw.requestId),c=relationshipCommand(raw.command),prior=await relationshipOwnRecord(request,uid,rid,c);
    if(!prior||['received','not_executed'].includes(prior.state))return relationshipReceipt(uid,rid,c,prior);
    let l:RelationshipLocal;
    try{l=await db.runTransaction(async tx=>{await assertPrivateAccountSession(request,tx);const value=await relationshipLocal(tx,c.transactionId);
      await assertPrivateAccountSession(request,tx);
      await assertRelationshipPurchaseRetirement(tx,request,c.transactionId,value.buyerId,value.sellerId,c.relationshipReference);return value;});}
    catch(error){if(error instanceof FinancialRecoveryBlocked)throw error;if(error instanceof HttpsError&&['permission-denied','unauthenticated','failed-precondition'].includes(error.code))return relationshipReceipt(uid,rid,c,prior);throw error;}
    let p:RelationshipProvider;try{p=await relationshipProvider(l,c.transactionId,request);}catch(recoveryError){if(recoveryError instanceof FinancialRecoveryBlocked)throw recoveryError;return relationshipReceipt(uid,rid,c,prior);}
    if(p.evidence.state!=='canceled')return relationshipReceipt(uid,rid,c,prior);
    return completeRelationshipRetirement(request,uid,rid,c,prior,p);
  }
  const id=checkoutId(raw.transactionId),r=relationshipCommand({transactionId:id,scope:'admin',sourceHash:'0'.repeat(64),paymentIntentId:'pi_placeholder',
    totalCents:1,walletCents:0,relationshipReference:raw.relationshipReference,acknowledged:true}).relationshipReference;
  const first=await db.runTransaction(async tx=>{await assertPrivateAccountSession(request,tx);const l=await relationshipLocal(tx,id);await assertRelationshipPurchaseRetirement(tx,request,id,l.buyerId,l.sellerId,r);return l;});
  const p=await relationshipProvider(first,id,request);
  return db.runTransaction(async tx=>{
    await assertPrivateAccountSession(request,tx);
    const l=await relationshipLocal(tx,id);await assertRelationshipPurchaseRetirement(tx,request,id,l.buyerId,l.sellerId,r);
    if(relationshipLocalHash(l,r)!==relationshipLocalHash(first,r))throw stale();
    const totalCents=exactCents(l.order.totalAmount)!,wallet=relationshipWallet(l,id),sourceHash=relationshipSourceHash(l,r,p),canNeutralize=relationshipMayRetire(l,id,p);
    return {protocol:'relationship_purchase_legacy_preview_v1',actorId:uid,transactionId:id,relationshipReference:r,sourceHash,buyerId:l.buyerId,sellerId:l.sellerId,
      amounts:{totalCents,walletCents:wallet.amount,cardCents:p.evidence.amountCents,currency:'CAD'},
      provider:{status:p.evidence.status,confirmationMethod:p.evidence.method,state:p.evidence.state,captureMethod:p.captureMethod,observedAt:p.observedAt.toDate().toISOString()},
      wallet:{qualification:wallet.qualified?wallet.amount===0?'none':'native_debit':'unknown',obligationOpen:wallet.amount>0},canNeutralize,
      reason:canNeutralize?null:'native_or_provider_obligation_requires_review',commandTemplate:canNeutralize?{transactionId:id,scope:'admin',sourceHash,
        paymentIntentId:p.evidence.id,totalCents,walletCents:wallet.amount,relationshipReference:r,acknowledged:true}:null,
      preAuthorizationFenceSupported:true,paymentPermissionGranted:false};
  });
}
export async function retireRelationshipLegacyPurchase(request:any) {
  return withPrivateAccountSession(request,()=>retireRelationshipLegacyPurchasePrivate(request));
}
async function retireRelationshipLegacyPurchasePrivate(request:any) {
  const uid=supportUid(request),raw=supportObject(request.data,['capability','expectedUid','requestId','mode','command']);
  if(raw.capability!==RELATIONSHIP_PURCHASE_RETIREMENT_CAPABILITY||!['execute','neutralize'].includes(raw.mode))throw review();
  const rid=supportRequestId(raw.requestId),c=relationshipCommand(raw.command),prior=await relationshipOwnRecord(request,uid,rid,c);
  // Exact replay is documentary only. Even authorized/unknown NEVER repeats a
  // POST; recovery is the explicit safe reader and the same operation.
  if(prior)return relationshipReceipt(uid,rid,c,prior);
  if(raw.mode==='neutralize')return db.runTransaction(async tx=>{
    const recoveryCommit = financialRecoveryCommitCheckpoint();
    await assertPrivateAccountSession(request,tx);
    const currentSnapshot=await tx.get(intentRef(c.transactionId)),current=currentSnapshot.data(),existing=relationshipOwnRecordValue(current,uid,rid,c);
    if(existing)return relationshipReceipt(uid,rid,c,existing);
    await assertPrivateAccountSession(request,tx);
    await assertRelationshipPurchaseDraftNeutralization(tx,request,c.transactionId,c.relationshipReference);
    const fences=relationshipFences(current);
    if(Object.keys(fences).length>=32)throw new HttpsError('resource-exhausted','La clôture de cette intention doit être rapprochée.',{reason:'relationship_retirement_fence_capacity'});
    const operationId=supportHash([uid,rid]),fence={protocol:'relationship_purchase_retirement_fence_v1',actorId:uid,requestId:rid,operationId,
      command:c,payloadHash:supportHash(c),state:'not_executed',reason:'requester_neutralized_before_authorization',result:null,authorizedAt:null,recordedAt:Timestamp.now()};
    await assertPrivateAccountSession(request,tx);
    await recoveryCommit({refs: [(intentRef(c.transactionId)).path]});
    tx.set(intentRef(c.transactionId),await financialRecoverySourceFields('card_intent',intentRef(c.transactionId),currentSnapshot,{relationshipRetirementFences:{...fences,[operationId]:fence}}),{merge:true});
    return relationshipReceipt(uid,rid,c,fence);
  });
  const first=await db.runTransaction(async tx=>{await assertPrivateAccountSession(request,tx);const l=await relationshipLocal(tx,c.transactionId);
    await assertPrivateAccountSession(request,tx);
    await assertRelationshipPurchaseRetirement(tx,request,c.transactionId,l.buyerId,l.sellerId,c.relationshipReference);return l;});
  const p=await relationshipProvider(first,c.transactionId,request);
  if(c.sourceHash!==relationshipSourceHash(first,c.relationshipReference,p)||c.paymentIntentId!==p.evidence.id||
    c.totalCents!==exactCents(first.order.totalAmount)||c.walletCents!==relationshipWallet(first,c.transactionId).amount||!relationshipMayRetire(first,c.transactionId,p))throw stale();
  const operationId=supportHash([uid,rid]);
  const authorization=await db.runTransaction(async tx=>{
    const recoveryCommit = financialRecoveryCommitCheckpoint();
    await assertPrivateAccountSession(request,tx);
    const l=await relationshipLocal(tx,c.transactionId),existing=relationshipOwnRecordValue(l.intent,uid,rid,c);
    if(existing)return {record:existing,postAuthorized:false};
    await assertPrivateAccountSession(request,tx);
    await assertRelationshipPurchaseRetirement(tx,request,c.transactionId,l.buyerId,l.sellerId,c.relationshipReference);
    if(l.intent?.relationshipRetirement!=null||relationshipLocalHash(l,c.relationshipReference)!==relationshipLocalHash(first,c.relationshipReference)||!relationshipMayRetire(l,c.transactionId,p))throw stale();
    const now=Timestamp.now(),value={protocol:'relationship_purchase_retirement_command_v1',actorId:uid,requestId:rid,command:c,payloadHash:supportHash(c),
      operationId,localSourceHash:relationshipLocalHash(l,c.relationshipReference),state:'authorized',reason:null,result:null,authorizedAt:now,recordedAt:now};
    await assertPrivateAccountSession(request,tx);
    await recoveryCommit({refs: [(intentRef(c.transactionId)).path]});
    tx.set(intentRef(c.transactionId),await checkoutIntentFields(c.transactionId,l,{relationshipRetirement:value}),{merge:true});return {record:value,postAuthorized:true};
  });
  const record=authorization.record;if(!authorization.postAuthorized)return relationshipReceipt(uid,rid,c,record);
  await assertPrivateAccountSession(request);
  await db.runTransaction(async tx=>{
    await assertPrivateAccountSession(request,tx);
    const l=await relationshipLocal(tx,c.transactionId),current=l.intent?.relationshipRetirement;
    if(current?.operationId!==record.operationId || current.state!=='authorized' || relationshipLocalHash(l,c.relationshipReference)!==record.localSourceHash)throw stale();
    await prepareFinancialRecoverySource('purchase',orderRef(c.transactionId).path,l.order);
    await prepareFinancialRecoverySource('card_intent',intentRef(c.transactionId).path,l.intent!);
  });
  try{
    let canceled=p;
    if(p.evidence.state!=='canceled'){
      const pi=await getStripe()!.paymentIntents.cancel(c.paymentIntentId,{}, {idempotencyKey:`relationship_purchase_retire_${operationId}`});
      const observedAt=Timestamp.now();
      await db.runTransaction(async tx=>{
    const recoveryCommit = financialRecoveryCommitCheckpoint();
        const order=(await tx.get(orderRef(c.transactionId))).data()??{},intent=(await tx.get(intentRef(c.transactionId))).data()??null;
        const current=intent?.relationshipRetirement;
        const cause={actorId:uid,requestId:rid,operationId,payloadHash:supportHash(c),localSourceHash:record.localSourceHash};
        const fence:ResponseFence={operation:'retirement',intentId:operationId,protocol:record.protocol,version:null,state:'authorized',
          paymentIntentId:c.paymentIntentId,confirmAttemptId:null,retireOperationId:operationId,orderBinding:record.localSourceHash};
        const proof={protocol:'relationship_purchase_retirement_provider_observation_v1',cause,expected:fence,
          observed:providerObservation(pi),observedAt};
        if(current?.operationId===operationId && current.actorId===uid && current.requestId===rid &&
          current.payloadHash===cause.payloadHash && supportHash(current.command)===cause.payloadHash &&
          current.localSourceHash===record.localSourceHash && relationshipTime(current.authorizedAt) &&
          current.authorizedAt.isEqual(record.authorizedAt) && ['authorized','unknown'].includes(current.state) &&
          current.providerObservation==null && current.providerObservedAt==null) {
          await recoveryCommit({refs: [(intentRef(c.transactionId)).path]});
    tx.set(intentRef(c.transactionId),{relationshipRetirement:{...current,providerObservation:proof,providerObservedAt:observedAt}},{merge:true});
        } else await lateConflict(tx,c.transactionId,{order,intent,rows:[]},fence,'relationship_retirement_post_response_observed',pi,cause,observedAt);
      });
      const evidence=stripeIntentEvidence(pi,proofExpected(first,first.buyerId,c.transactionId));
      if(!evidence||pi.object!=='payment_intent'||pi.on_behalf_of!=null)throw review();
      canceled={evidence,captureMethod:['automatic','automatic_async','manual'].includes(pi.capture_method)?pi.capture_method:'unknown',observedAt};
    }else canceled=await relationshipProvider(first,c.transactionId,request); // Already canceled: GET only.
    return await completeRelationshipRetirement(request,uid,rid,c,record,canceled);
  }catch(recoveryError){if(recoveryError instanceof FinancialRecoveryBlocked)throw recoveryError;
    return db.runTransaction(async tx=>{
    const recoveryCommit = financialRecoveryCommitCheckpoint();
      const local=await relationshipLocal(tx,c.transactionId),current=local.intent?.relationshipRetirement;
      relationshipReceipt(uid,rid,c,current);if(!current||current.operationId!==operationId)throw stale();
      if(current.state==='received')return relationshipReceipt(uid,rid,c,current);
      const next={...current,state:'unknown',reason:'provider_outcome_or_current_source_requires_reconciliation',recordedAt:Timestamp.now()};
      await recoveryCommit({refs: [(intentRef(c.transactionId)).path]});
    tx.set(intentRef(c.transactionId),await checkoutIntentFields(c.transactionId,local,{relationshipRetirement:next}),{merge:true});return relationshipReceipt(uid,rid,c,next);
    });
  }
}
