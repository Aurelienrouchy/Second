import { financialRecoveryCommitCheckpoint } from "./financialRecoverySources";
import { financialRecoverySourceFields, prepareFinancialRecoverySource } from './financialRecoverySources';
import { FinancialRecoveryBlocked } from './financialRecoveryInterlock';
/** Manual Troc confirmations. Existing provider effects precede all NEW guards. */
import {Timestamp} from 'firebase-admin/firestore';
import {randomUUID} from 'node:crypto';
import {HttpsError} from 'firebase-functions/v2/https';
import {auth,db} from '../config/firebase';
import {getStripe} from '../config/stripe';
import {assertNewPaymentsEnabled} from '../config/featureFlags';
import {calculateFees,calculateServiceFee,calculateTaxOnServiceFee,serviceFeeTaxAdmission} from './fees';
import {qualifiedServiceFeeTaxAdmission,type ServiceFeeTaxContext} from '../config/operatorServiceTax';
import {supportUid,supportId,supportObject,supportHash,supportSourceHash,supportRequestId,supportCurrentAdminSession,supportAdmin} from './supportRequest';
import {assertAccountOperationOpen,assertAccountSecurityOpen,assertRecentAccountAuthentication} from './eligibility';
import {assertAccountRelationshipNewPair,readAccountRelationshipReviewProof, type AccountRelationshipReference} from './accountRelationshipReview';
import {swapTopUpIntentEvidence,swapTopUpProviderSnapshot,observedSwapTopUpNeutralization,type SwapTopUpExpected,type SwapTopUpAmounts} from './swapTopUpCheckoutProof';
import {getCheckoutReturnUrl} from '../shared/checkoutRedirect';
import {isProductionRuntime} from '../config/runtimeEnvironment';
import {assertOwnTradingEligibility,assertArticleNotModerationRestricted,assertArticleChildSafetyAdmitted} from './tradeAdmission';
import {evaluateEligibility} from '../shared/eligibility';
import {assertArticleHygieneAdmitted} from './articleHygiene';
import {assertArticleSaleDeclaration,saleDeclarationContent} from './articleSaleDeclaration';
import {inventoryEngagementMatches} from './inventoryUnit';
import {articlePrivacyWithdrawn} from './publicProfile';
import {assertPrivateAccountSession,withPrivateAccountSession} from './privateAccountSession';
import {hasNativeAcceptedSwapAgreement} from './swapLaunchPolicy';

export const SWAP_TOPUP_MANUAL_CAPABILITY='swap_topup_manual_v1';
export const SWAP_TOPUP_MANUAL_ENABLED:boolean=true;
type Command={action:'prepare'|'confirm'|'retire_legacy';scope:'own'|'admin';sourceHash:string;intentId:string|null;intentVersion:number|null;
  paymentIntentId:string|null;paymentMethodId:string|null;totalCents:number;relationshipReference:AccountRelationshipReference|null;acknowledged:true};
export type SwapTopUpCommand=Command;
const hash=(v:any):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const native=(v:any):v is Timestamp=>v instanceof Timestamp&&v.toMillis()>0&&v.toMillis()<=Date.now();
const swapRef=(id:string)=>db.collection('swaps').doc(id);
const currentRef=(id:string)=>swapRef(id).collection('topup_checkout').doc('current');
const commandRef=(id:string,uid:string,rid:string)=>swapRef(id).collection('topup_checkout_commands').doc(supportHash([uid,rid]));
const resultRef=(id:string,uid:string,rid:string)=>commandRef(id,uid,rid).collection('results').doc('receipt');
const retirementRef=(id:string)=>swapRef(id).collection('topup_checkout').doc('legacy_retirement');
const unknown=()=>new HttpsError('failed-precondition','Le résultat du complément doit être rapproché. Aucun nouveau paiement n’est autorisé.',{reason:'swap_topup_reconciliation_required',paymentPermissionGranted:false});
function commandInput(raw:unknown):Command {
  const c=supportObject(raw,['action','scope','sourceHash','intentId','intentVersion','paymentIntentId','paymentMethodId','totalCents','relationshipReference','acknowledged']);
  if(!['prepare','confirm','retire_legacy'].includes(c.action)||!['own','admin'].includes(c.scope)||c.scope==='admin'&&c.action!=='retire_legacy'||!hash(c.sourceHash)||
    c.acknowledged!==true||!Number.isSafeInteger(c.totalCents)||c.totalCents<=0||c.intentId!==null&&typeof c.intentId!=='string'||
    c.intentVersion!==null&&(!Number.isSafeInteger(c.intentVersion)||c.intentVersion<1)||c.paymentIntentId!==null&&!/^pi_[A-Za-z0-9]+$/.test(c.paymentIntentId)||
    c.paymentMethodId!==null&&!/^pm_[A-Za-z0-9]+$/.test(c.paymentMethodId)||c.action!=='confirm'&&c.paymentMethodId!==null||
    c.action==='prepare'&&(c.intentId!==null||c.intentVersion!==null||c.paymentIntentId!==null)||c.action==='confirm'&&(c.intentId===null||c.intentVersion===null||c.paymentIntentId===null)||
    c.action==='retire_legacy'&&(c.paymentIntentId===null||c.intentId!==null||c.intentVersion!==null)||c.scope==='own'&&c.relationshipReference!==null)throw new HttpsError('invalid-argument','Intention exacte de complément requise.');
  const r=relationshipInput(c.relationshipReference);
  if(c.scope==='admin'&&!r)throw new HttpsError('invalid-argument','La neutralisation opérateur doit viser sa décision native.');
  return {action:c.action,scope:c.scope,sourceHash:c.sourceHash,intentId:c.intentId,intentVersion:c.intentVersion,paymentIntentId:c.paymentIntentId,
    paymentMethodId:c.paymentMethodId,totalCents:c.totalCents,relationshipReference:r,acknowledged:true};
}
function relationshipInput(raw:unknown):AccountRelationshipReference|null {
  if(raw===null||raw===undefined)return null;
  const r=supportObject(raw,['pairId','id','contentHash','version']);
  if(!/^arp_[a-f0-9]{64}$/.test(r.pairId??'')||!/^ar_[a-f0-9]{64}$/.test(r.id??'')||!hash(r.contentHash)||!Number.isSafeInteger(r.version)||r.version<1)
    throw new HttpsError('invalid-argument','Décision de paire exacte requise.');
  return r as AccountRelationshipReference;
}
async function local(tx:FirebaseFirestore.Transaction,id:string) {
  const snap=await tx.get(swapRef(id)),swap=snap.data();if(!swap)throw unknown();
  const parties=[swap.initiatorId,swap.receiverId],top=swap.cashTopUp;
  if(!parties.every(v=>typeof v==='string'&&v&&!v.includes('/'))||parties[0]===parties[1]||!native(swap.createdAt)||
    !top||!Number.isSafeInteger(top.amount)||top.amount<=0||!parties.includes(top.payerId))throw unknown();
  const payerId=top.payerId,payeeId=parties.find(v=>v!==payerId)!;
  const intentSnapshot=await tx.get(currentRef(id)), intent=intentSnapshot.data()??null,retirement=(await tx.get(retirementRef(id))).data()??null;
  const ledger=await tx.get(db.collection('wallets').doc(payeeId).collection('ledger').where('swapId','==',id).limit(101));
  if(ledger.size>100)throw unknown();
  const agreement={swapId:id,parties,baseCents:top.amount,payerId,payeeId,acceptedAt:swap.acceptedAt??null,
    itemSnapshots:[swap.initiatorItems??null,swap.receiverItems??null],proposalVersion:swap.articleDeclarationProposalVersion??null};
  const source={...agreement,status:swap.status,paymentIntentId:swap.topUpPaymentIntentId??null,
    paidAt:swap.topUpPaidAt??null,chargeId:swap.topUpChargeId??null,
    legacyRetirement:retirement?.protocol==='swap_topup_retirement_receipt_v1'?supportSourceHash(retirement):null};
  let taxContext:ServiceFeeTaxContext|undefined;
  if(!intent&&!swap.topUpPaymentIntentId){
    const payer=(await tx.get(db.collection('users').doc(payerId))).data();
    const selected=Array.isArray(payer?.addresses)?payer.addresses.filter((a:any)=>a?.isDefault===true):[];
    taxContext={recipientUid:payerId,source:'payer_declared_primary_address',address:selected.length===1?selected[0]:null,
      nativeSourceReference:supportHash(['native_primary_address',payerId]),transport:'none'};
  }
  const hasAdmission=intent!=null&&Object.prototype.hasOwnProperty.call(intent,'taxAdmission');
  const recordedAdmission=hasAdmission?qualifiedServiceFeeTaxAdmission(intent.taxAdmission):null;
  if(hasAdmission&&!recordedAdmission)throw unknown();
  // Replays use their original opaque proof and original amounts before any
  // present policy. Only an unstarted payment builds a new qualification.
  const taxAdmission=recordedAdmission??(!intent&&!swap.topUpPaymentIntentId?
    serviceFeeTaxAdmission(calculateServiceFee(top.amount/100),taxContext):undefined);
  return {id,snap,swap,parties,payerId,payeeId,intent,intentSnapshot,retirement,rows:ledger.docs,taxContext,taxAdmission,
    agreementHash:supportSourceHash(agreement),sourceHash:taxAdmission?supportSourceHash([source,taxAdmission]):supportSourceHash(source)};
}
type Local=Awaited<ReturnType<typeof local>>;
function amounts(l:Local):SwapTopUpAmounts {
  if(l.intent?.protocol==='swap_server_manual_v1'){
    const a=l.intent.amounts;if(!a||a.currency!=='CAD'||![a.baseCents,a.serviceFeeCents,a.taxCents,a.totalCents].every(Number.isSafeInteger)||
      a.baseCents<=0||a.serviceFeeCents<0||a.taxCents<0||a.totalCents!==a.baseCents+a.serviceFeeCents+a.taxCents)throw unknown();
    return a;
  }
  if(l.swap.topUpPaymentIntentId){const serviceFeeCents=l.swap.topUpFee,taxCents=l.swap.topUpTax??0;
    if(!Number.isSafeInteger(serviceFeeCents)||serviceFeeCents<0||!Number.isSafeInteger(taxCents)||taxCents<0)throw unknown();
    return {baseCents:l.swap.cashTopUp.amount,serviceFeeCents,taxCents,totalCents:l.swap.cashTopUp.amount+serviceFeeCents+taxCents,currency:'CAD'};}
  const fees=calculateFees(l.swap.cashTopUp.amount/100,0,undefined,l.taxContext),totalCents=Math.round(fees.buyerTotal*100),serviceFeeCents=Math.round(fees.serviceFee*100);
  return {baseCents:l.swap.cashTopUp.amount,serviceFeeCents,taxCents:totalCents-l.swap.cashTopUp.amount-serviceFeeCents,totalCents,currency:'CAD'};
}
function expected(l:Local):SwapTopUpExpected {return {...amounts(l),swapId:l.id,payerId:l.payerId,payeeId:l.payeeId,
  ...(l.intent?.protocol==='swap_server_manual_v1'?(l.intent.providerId?{paymentIntentId:l.intent.providerId}:{}):l.swap.topUpPaymentIntentId?{paymentIntentId:l.swap.topUpPaymentIntentId}:{}),
  ...(l.intent?.protocol==='swap_server_manual_v1'?{intentId:l.intent.intentId}:{})};}
async function actor(tx:FirebaseFirestore.Transaction,request:any,l:Local,scope:'own'|'admin',r?:AccountRelationshipReference|null) {
  await assertPrivateAccountSession(request,tx);
  await supportCurrentAdminSession(request);await assertAccountSecurityOpen((await tx.get(db.collection('eligibility_profiles').doc(request.auth.uid))).data(), tx, request.auth.uid);
  if(request.auth.token.auth_time*1000>Date.now())throw new HttpsError('permission-denied','Horloge de session non qualifiée.');
  if(scope==='own'){if(request.auth.uid!==l.payerId)throw new HttpsError('permission-denied','Complément privé indisponible.');return;}
  await supportAdmin(tx,request.auth.uid,false);assertRecentAccountAuthentication(request.auth.token);
  if(!r)throw new HttpsError('permission-denied','Décision native requise.');
  const d=await readAccountRelationshipReviewProof(tx,r),root=(await tx.get(db.collection('account_relationship_pairs').doc(r.pairId))).data();
  if(!d||d.actorId!==request.auth.uid||d.command.scope!=='admin'||d.command.pairAction!=='restrict_new_engagements'||
    !d.command.context.orders.some((o:any)=>o.kind==='swap'&&o.id===l.id)||supportHash(d.parties)!==supportHash([...l.parties].sort())||
    root?.pairRestriction?.blocked!==true||supportHash(root.pairRestriction.reference)!==supportHash(r))throw new HttpsError('permission-denied','Décision de paire actuelle non qualifiée.');
  const user=await auth.getUser(d.actorId),cutoff=user.tokensValidAfterTime==null?null:Date.parse(user.tokensValidAfterTime),at=d.authority.authTime*1000;
  if(user.uid!==d.actorId||user.disabled||!Number.isSafeInteger(at)||at>Date.now()||cutoff!==null&&(!Number.isSafeInteger(cutoff)||at<cutoff))
    throw new HttpsError('permission-denied','Autorité de la décision à réexaminer.');
}
/** Reads of an engaged payment use current private authority, independently
 * of new commerce. Exact opaque command receipts are served before this gate. */
async function viewer(tx:FirebaseFirestore.Transaction,request:any,l:Local,scope:'own'|'admin',r?:AccountRelationshipReference|null) {
  await assertPrivateAccountSession(request,tx);
  if(scope==='admin')await actor(tx,request,l,scope,r);
  else if(request.auth.uid!==l.payerId)throw new HttpsError('permission-denied','Complément privé indisponible.');
}
async function newPayment(tx:FirebaseFirestore.Transaction,request:any,l:Local) {
  await actor(tx,request,l,'own');assertNewPaymentsEnabled();
  if(l.swap.status!=='payment_pending'||!native(l.swap.acceptedAt)||l.swap.topUpPaidAt!=null||l.swap.topUpChargeId!=null||l.rows.length)throw unknown();
  if(l.intent&&(l.intent.agreementHash!==l.agreementHash||l.intent.payerId!==l.payerId||l.intent.payeeId!==l.payeeId||l.intent.amounts?.baseCents!==l.swap.cashTopUp.amount))throw unknown();
  await assertAccountRelationshipNewPair(tx,l.payerId,l.payeeId);
  // The accepted native contract fixes this existing obligation. A proposal,
  // unknown legacy source or altered agreement still needs NEW admission.
  const commercialAcquisition=!hasNativeAcceptedSwapAgreement(l.swap);
  const payer=await assertAccountOperationOpen(tx,l.payerId,false,true,commercialAcquisition),payee=await assertAccountOperationOpen(tx,l.payeeId,false,true,commercialAcquisition);
  const primary=Array.isArray(payer.user?.addresses)?payer.user.addresses.filter((v:any)=>v?.isDefault===true):[];
  const taxContext:ServiceFeeTaxContext={recipientUid:l.payerId,
    source:'payer_declared_primary_address',address:primary.length===1?primary[0]:null,
    nativeSourceReference:supportHash(['native_primary_address',l.payerId]),transport:'none'};
  const a=amounts(l),currentTaxAdmission=serviceFeeTaxAdmission(a.serviceFeeCents/100,taxContext);
  if((a.taxCents>0||l.taxAdmission||currentTaxAdmission)&&(!l.taxAdmission||!currentTaxAdmission||
    supportHash(l.taxAdmission)!==supportHash(currentTaxAdmission)||
    Math.round(calculateTaxOnServiceFee(a.serviceFeeCents/100,taxContext).taxTotal*100)!==a.taxCents))throw new HttpsError('failed-precondition',
      'Le traitement fiscal accepté du complément doit être examiné avant une nouvelle autorisation.',
      {reason:'service_fee_tax_qualification_required',paymentPermissionGranted:false});
  await assertOwnTradingEligibility(payer,'buy', tx, l.payerId,commercialAcquisition);
  // Both parties supply their own items. Counterparty eligibility remains private.
  if(!evaluateEligibility(payer,'sell').allowed||!evaluateEligibility(payee,'sell').allowed)throw unknown();
  const ids=new Set<string>();
  for(const [items,owner] of [[l.swap.initiatorItems,l.swap.initiatorId],[l.swap.receiverItems,l.swap.receiverId]] as const){
    if(!Array.isArray(items)||!items.length||items.length>20)throw unknown();
    for(const item of items){
      if(typeof item?.articleId!=='string'||!item.articleId||item.articleId.includes('/')||ids.has(item.articleId))throw unknown();ids.add(item.articleId);
      const article=(await tx.get(db.collection('articles').doc(item.articleId))).data(),w=item.saleDeclarationProposalWitness;
      const hasUnit=article&&Object.prototype.hasOwnProperty.call(article,'inventoryUnit');
      const capture=Array.isArray(l.swap.inventoryUnitCommitments)?l.swap.inventoryUnitCommitments.find((v:any)=>v.articleId===item.articleId):null;
      const ownUnit=hasUnit&&capture&&await inventoryEngagementMatches(tx,item.articleId,article,{kind:'swap',id:l.id,sourceArticleId:item.articleId},capture);
      if(!article||article.sellerId!==owner||article.isActive!==true||article.isSold===true&&!ownUnit||hasUnit&&!ownUnit||articlePrivacyWithdrawn(article)||article.activeTransactionId!=null)throw unknown();
      assertArticleNotModerationRestricted(article);assertArticleHygieneAdmitted(article);assertArticleSaleDeclaration(item.articleId,article);
      await assertArticleChildSafetyAdmitted(tx,item.articleId,article);
      if(w?.schemaVersion!==1||w.source!=='native_article_at_proposal'||w.articleId!==item.articleId||w.sellerId!==owner||w.contentHash!==article.saleDeclaration.contentHash||
        !native(w.declaration?.declaredAt)||!w.declaration.declaredAt.isEqual(article.saleDeclaration.declaredAt)||
        ['schemaVersion','version','scope','source','accepted','articleId','actorUid','quantity','contentHash','requestHash','previousContentHash','saleUnit',
          ...(article.saleDeclaration.version==='personal_item_v3'?['counterfeitStatus']:[])].some(k=>w.declaration[k]!==article.saleDeclaration[k])||
        supportHash(w.content)!==supportHash(saleDeclarationContent(article)))throw unknown();
    }
  }
  if(!payee.user?.stripeChargesEnabled||!payee.user?.stripePayoutsEnabled||!/^acct_[A-Za-z0-9]+$/.test(payee.user.stripeAccountId??''))throw unknown();
}
function receiptView(uid:string,id:string,rid:string,c:Command,value?:any) {return {protocol:'swap_topup_command_v1',actorId:uid,swapId:id,requestId:rid,command:c,payloadHash:supportHash(c),
  state:value?.state??'unrecorded',reason:value?.reason??null,result:value?.result??null,futureEffectsNeutralized:value?.reason==='requester_neutralized'||native(value?.futureEffectsNeutralizedAt),
  recordedAt:native(value?.recordedAt)?value.recordedAt.toDate().toISOString():null,paymentPermissionGranted:false};}
async function provider(l:Local,request:any) {
  await assertPrivateAccountSession(request);
  const stripe=getStripe();if(!stripe)throw unknown();const e=expected(l);let pid=e.paymentIntentId;
  if(!pid&&l.intent?.protocol==='swap_server_manual_v1'){
    const page=await stripe.paymentIntents.search({query:`metadata['swapCheckoutIntentId']:'${l.intent.intentId}'`,limit:2});
    await assertPrivateAccountSession(request);
    if(page.data.length!==1||page.has_more)throw unknown();pid=page.data[0].id;
  }
  if(!pid||!/^pi_[A-Za-z0-9]+$/.test(pid))throw unknown();
  await assertPrivateAccountSession(request);
  const pi=await stripe.paymentIntents.retrieve(pid);await assertPrivateAccountSession(request);
  const evidence=swapTopUpIntentEvidence(pi,{...e,paymentIntentId:pid});if(!evidence)throw unknown();return {pi,evidence};
}
function result(l:Local,p:Awaited<ReturnType<typeof provider>>,allowActionSecret=false) {
  const e=p.evidence,manual=l.intent?.protocol==='swap_server_manual_v1';
  const credits=l.rows.filter(r=>r.data().type==='sale_credit'),credit=credits[0]?.data();
  const settled=e?.state==='succeeded'&&l.swap.topUpPaymentIntentId===e.id&&native(l.swap.topUpPaidAt)&&credits.length===1&&
    credit.amount===l.swap.cashTopUp.amount&&credit.swapId===l.id&&credit.currency==='CAD'&&credit.paymentIntentId===e.id&&
    native(credit.createdAt)&&credit.createdAt.isEqual(l.swap.topUpPaidAt);
  return {protocol:'swap_topup_payment_v1',swapId:l.id,paymentIntentId:e.id,intentId:manual?l.intent!.intentId:null,intentVersion:manual?l.intent!.version:null,
    amounts:amounts(l),providerStatus:e?.status??'unknown',confirmationMethod:e?.method??'unknown',
    action:e&&['succeeded','processing','authorized'].includes(e.state)?'awaitSettlement':e?.state==='canceled'?'reviewCancellation':e?.state==='action'&&manual?'handleNextAction':manual&&['creating','confirming','unknown'].includes(l.intent!.state)?'awaitSettlement':manual?'confirmOnServer':'reviewLegacyExposure',
    legacyExternalConfirmationPrevented:e?.method==='manual'||e?.state==='canceled',settlementReceiptVerified:settled===true,
    ...(allowActionSecret&&e?.state==='action'&&manual&&l.intent!.payerId===l.payerId&&l.intent!.payeeId===l.payeeId&&
      l.intent!.agreementHash===l.agreementHash&&l.intent!.reviewRequired!==true&&native(l.intent!.authorizedAt)&&typeof p!.pi.client_secret==='string'&&p!.pi.client_secret.startsWith(`${e.id}_secret_`)?{actionClientSecret:p!.pi.client_secret}:{}),
    paymentPermissionGranted:false};
}
function preparation(l:Local) {
  const retired=observedSwapTopUpNeutralization(l.retirement,l.id,l.payerId,l.payeeId)&&
    l.retirement!.document.paymentIntentId===l.swap.topUpPaymentIntentId&&supportSourceHash(l.retirement!.document)===l.retirement!.contentHash;
  const qualification=l.intent?l.intent.protocol==='swap_server_manual_v1'?'native_manual_intention':'unknown':
    l.swap.topUpPaymentIntentId?retired?'native_legacy_neutralized':'native_legacy_exposure':
    l.swap.topUpCheckoutState!=null||l.swap.topUpPaidAt!=null||l.swap.topUpChargeId!=null||l.rows.length||l.retirement?'unknown':'native_unstarted';
  return {qualification,canPrepareNow:SWAP_TOPUP_MANUAL_ENABLED&&['native_unstarted','native_legacy_neutralized'].includes(qualification)&&
    l.swap.status==='payment_pending'&&native(l.swap.acceptedAt)&&l.swap.topUpPaidAt==null&&l.swap.topUpChargeId==null&&!l.rows.length};
}
/** A current pre-payment state alone can be read before an authorized POST
 * actually reaches Stripe. Only a provider event attributed to THAT exact
 * idempotent confirm proves its failed/action phase completed. One bounded
 * page is a positive-proof lookup, never an exhaustive absence assertion. */
async function confirmationCompletion(l:Local,p:Awaited<ReturnType<typeof provider>>,request:any) {
  await assertPrivateAccountSession(request);
  if(!l.intent||!hash(l.intent.activeCommand)||!['unconfirmed','confirmation'].includes(p.evidence.state)||
    !['confirming','unknown'].includes(l.intent.state))return null;
  const operationId=l.intent.activeCommand,operation=(await swapRef(l.id).collection('topup_checkout_commands').doc(operationId).get()).data();
  if(!operation||operation.command?.action!=='confirm'||operation.actorId!==l.payerId||operation.intentId!==l.intent.intentId||
    operation.providerId!==p.evidence.id||!native(operation.postAuthorizedAt)||operation.payloadHash!==supportHash(operation.command)||
    operationId!==supportHash([operation.actorId,operation.requestId])||supportHash(operation.expected)!==supportHash(expected(l)))return null;
  const stripe=getStripe();if(!stripe)return null;
  const idempotencyKey=`swap_manual_confirm_${operationId}`,gte=Math.floor(operation.postAuthorizedAt.toMillis()/1000),lte=Math.floor(Date.now()/1000);
  await assertPrivateAccountSession(request);
  const page=await stripe.events.list({types:['payment_intent.payment_failed','payment_intent.requires_action'],created:{gte,lte},limit:100});
  await assertPrivateAccountSession(request);
  for(const event of page.data){
    const pi=event.data.object as any,e=swapTopUpIntentEvidence(pi,operation.expected);
    if(event.object!=='event'||!/^evt_[A-Za-z0-9]+$/.test(event.id)||event.account!=null||event.context!=null||
      !Number.isSafeInteger(event.created)||event.created<gte||event.created>lte||event.livemode!==p.pi.livemode||
      event.request?.idempotency_key!==idempotencyKey||typeof event.request.id!=='string'||!/^req_[A-Za-z0-9]+$/.test(event.request.id)||
      pi.object!=='payment_intent'||!e||e.method!=='manual'||
      !(event.type==='payment_intent.payment_failed'&&e.state==='unconfirmed'||event.type==='payment_intent.requires_action'&&e.state==='action'))continue;
    const document={protocol:'swap_topup_confirmation_completion_v1',operationId,payloadHash:operation.payloadHash,postAuthorizedAt:operation.postAuthorizedAt,
      paymentIntentId:e.id,eventId:event.id,eventType:event.type,eventCreatedSeconds:event.created,stripeRequestId:event.request.id,idempotencyKey,
      livemode:event.livemode,eventEvidence:e,observedAt:Timestamp.now(),source:'stripe_events_get'};
    return {document,contentHash:supportSourceHash(document)};
  }
  // Missing, over-bound, old, unattributable and unavailable remain unknown.
  return null;
}
async function observeProvider(id:string,uid:string,scope:'own'|'admin',request:any,r?:AccountRelationshipReference|null) {
  const l=await db.runTransaction(async tx=>{await assertPrivateAccountSession(request,tx);const v=await local(tx,id);await viewer(tx,request,v,scope,r);return v;});
  let p=await provider(l,request);
  const completion=await confirmationCompletion(l,p,request);
  if(completion)p=await provider(l,request); // Current PI AFTER the proof, not its event snapshot.
  const latest=await db.runTransaction(async tx=>{
    const recoveryCommit = financialRecoveryCommitCheckpoint();await assertPrivateAccountSession(request,tx);const now=await local(tx,id);await viewer(tx,request,now,scope,r);if(supportHash(now.intent)!==supportHash(l.intent)||now.swap.topUpPaymentIntentId!==l.swap.topUpPaymentIntentId)throw unknown();
    if(now.intent?.protocol!=='swap_server_manual_v1')return now;
    const op=now.intent.activeCommand?await tx.get(swapRef(id).collection('topup_checkout_commands').doc(now.intent.activeCommand)):null,d=op?.data();
    if(!d||d.intentId!==now.intent.intentId||!native(d.postAuthorizedAt))throw unknown();
    const completionQualified=completion&&completion.document.operationId===now.intent.activeCommand&&completion.document.payloadHash===d.payloadHash&&
      completion.document.paymentIntentId===p.evidence.id&&completion.document.postAuthorizedAt.isEqual(d.postAuthorizedAt)&&d.command.action==='confirm';
    const conclusive=d.command.action==='prepare'||['action','processing','succeeded','authorized','canceled'].includes(p.evidence.state)||
      !!completionQualified&&['unconfirmed','confirmation'].includes(p.evidence.state);
    const update={providerId:p.evidence.id,provider:swapTopUpProviderSnapshot(p.pi,p.evidence,'retrieve'),
      ...(conclusive&&['creating','confirming','unknown'].includes(now.intent.state)?{state:p.evidence.status,version:now.intent.version+1}:{}),
      reviewRequired:!!d.futureEffectsNeutralizedAt||now.intent.agreementHash!==now.agreementHash};
    const rr=op!.ref.collection('results').doc('receipt'),prior=(await tx.get(rr)).data();
    await viewer(tx,request,now,scope,r);
    if(!prior&&conclusive){ await recoveryCommit({refs: [(rr).path]}); tx.create(rr,{protocol:'swap_topup_command_v1',actorId:d.actorId,requestId:d.requestId,command:d.command,payloadHash:d.payloadHash,
      state:'received',reason:null,result:{providerStatus:p.evidence.status,paymentIntentId:p.evidence.id,intentId:d.intentId,financialSettlementVerified:false,
        legacyExternalConfirmationPrevented:p.evidence.method==='manual'||p.evidence.state==='canceled'},recordedAt:Timestamp.now()}); }
    if(completionQualified&&!d.confirmationCompletion){ await recoveryCommit({refs: [(op!.ref).path]}); tx.update(op!.ref,{confirmationCompletion:completion}); }
    await recoveryCommit({refs: [(currentRef(id)).path]});
    tx.update(currentRef(id),await financialRecoverySourceFields('swap_topup',currentRef(id),now.intent!,update));
    if(now.swap.topUpPaidAt==null&&d.command.action==='prepare'){ await recoveryCommit({refs: [(swapRef(id)).path]}); tx.update(swapRef(id),await financialRecoverySourceFields('swap',swapRef(id),now.swap,{topUpPaymentIntentId:p.evidence.id,topUpFee:d.expected.serviceFeeCents,
      topUpTax:d.expected.taxCents,topUpCheckoutProtocol:'swap_server_manual_v1',topUpCheckoutState:p.evidence.status})); }
    return {...now,intent:{...now.intent,...update}};
  });
  return result(latest,p,scope==='own'&&uid===latest.payerId);
}
async function recoverRetirement(id:string,uid:string,rid:string,c:Command,request:any) {
  const l=await db.runTransaction(async tx=>{await assertPrivateAccountSession(request,tx);return local(tx,id);}),op=commandRef(id,uid,rid),rr=resultRef(id,uid,rid);
  const operation=(await op.get()).data();if(!operation||operation.payloadHash!==supportHash(c)||!native(operation.postAuthorizedAt)||
    operation.command.action!=='retire_legacy')throw unknown();
  const stripe=getStripe();if(!stripe)throw unknown();
  await assertPrivateAccountSession(request);
  const pi=await stripe.paymentIntents.retrieve(operation.providerId);await assertPrivateAccountSession(request);const e=swapTopUpIntentEvidence(pi,operation.expected);
  if(!e||e.state!=='canceled'||e.method!=='automatic'||e.receivedCents!==0||e.capturableCents!==0)throw unknown();
  return db.runTransaction(async tx=>{
    const recoveryCommit = financialRecoveryCommitCheckpoint();await assertPrivateAccountSession(request,tx);const receipt=(await tx.get(rr)).data();if(receipt)return receipt;
    const now=await local(tx,id),current=(await tx.get(op)).data();
    if(current?.payloadHash!==operation.payloadHash||now.swap.topUpPaymentIntentId!==e.id||now.payerId!==l.payerId||now.payeeId!==l.payeeId||
      now.swap.topUpPaidAt!=null||now.rows.length)throw unknown();
    const provider=swapTopUpProviderSnapshot(pi,e,'retrieve'),document={swapId:id,payerId:now.payerId,payeeId:now.payeeId,paymentIntentId:e.id,
      actorId:uid,requestId:rid,payloadHash:supportHash(c),provider,recordedAt:Timestamp.now()};
    const record={protocol:'swap_topup_command_v1',actorId:uid,requestId:rid,command:c,payloadHash:supportHash(c),state:'received',reason:null,
      result:{providerStatus:e.status,paymentIntentId:e.id,intentId:operation.intentId,financialSettlementVerified:false,legacyExternalConfirmationPrevented:true},recordedAt:Timestamp.now()};
    await recoveryCommit({refs: [(retirementRef(id)).path]});
    tx.set(retirementRef(id),{protocol:'swap_topup_retirement_receipt_v1',document,contentHash:supportSourceHash(document)});await recoveryCommit({refs: [(rr).path]});
    tx.create(rr,record);return record;
  });
}
/** Called by the existing signed webhook, before its existing ledger engine.
 * No current role, commerce flag or changed review can erase a real charge. */
export async function qualifyManualSwapTopUpSettlement(tx:FirebaseFirestore.Transaction,id:string,swap:any,pi:any):Promise<boolean> {
  const i=(await tx.get(currentRef(id))).data();
  if(!i||i.protocol!=='swap_server_manual_v1'||i.swapId!==id||i.providerId!==pi.id||swap.topUpPaymentIntentId!==pi.id||
    i.payerId!==swap.cashTopUp?.payerId||![swap.initiatorId,swap.receiverId].includes(i.payerId)||
    i.payeeId!==(i.payerId===swap.initiatorId?swap.receiverId:swap.initiatorId)||i.amounts?.baseCents!==swap.cashTopUp?.amount||
    !native(i.authorizedAt)||!hash(i.activeCommand))return false;
  const operation=(await tx.get(swapRef(id).collection('topup_checkout_commands').doc(i.activeCommand))).data();
  const e=swapTopUpIntentEvidence(pi,{...i.amounts,swapId:id,payerId:i.payerId,payeeId:i.payeeId,paymentIntentId:i.providerId,intentId:i.intentId});
  const qualified=!!e&&e.state==='succeeded'&&operation?.command?.action==='confirm'&&operation.actorId===i.payerId&&operation.intentId===i.intentId&&
    operation.providerId===pi.id&&native(operation.postAuthorizedAt)&&operation.payloadHash===supportHash(operation.command)&&
    supportHash(operation.expected)===supportHash({...i.amounts,swapId:id,payerId:i.payerId,payeeId:i.payeeId,paymentIntentId:i.providerId,intentId:i.intentId});
  if(qualified && swap.status==='payment_pending') {
    await prepareFinancialRecoverySource('swap_topup',currentRef(id).path,i);
    await prepareFinancialRecoverySource('swap_topup',swapRef(id).collection('topup_checkout_commands').doc(i.activeCommand).path,operation);
  }
  return qualified;
}
/** Distinct refund/reconciliation proof: the native confirmation is exact, but
 * the provider's actually captured amount may differ from the accepted quote.
 * This MUST NOT authorize fulfillment, settlement credit or a new payment. */
export async function qualifyManualSwapTopUpRefundSource(tx:FirebaseFirestore.Transaction,id:string,swap:any,pi:any):Promise<boolean> {
  const i=(await tx.get(currentRef(id))).data();
  if(!i||i.protocol!=='swap_server_manual_v1'||i.swapId!==id||i.providerId!==pi?.id||swap.topUpPaymentIntentId!==pi.id||
    i.payerId!==swap.cashTopUp?.payerId||![swap.initiatorId,swap.receiverId].includes(i.payerId)||
    i.payeeId!==(i.payerId===swap.initiatorId?swap.receiverId:swap.initiatorId)||i.amounts?.baseCents!==swap.cashTopUp?.amount||
    !native(i.authorizedAt)||!hash(i.activeCommand))return false;
  const operation=(await tx.get(swapRef(id).collection('topup_checkout_commands').doc(i.activeCommand))).data();
  const a=i.amounts;
  return [a?.baseCents,a?.serviceFeeCents,a?.taxCents,a?.totalCents].every(Number.isSafeInteger)&&a.baseCents>0&&
    a.serviceFeeCents>=0&&a.taxCents>=0&&a.totalCents===a.baseCents+a.serviceFeeCents+a.taxCents&&a.currency==='CAD'&&
    operation?.command?.action==='confirm'&&operation.actorId===i.payerId&&operation.intentId===i.intentId&&operation.providerId===pi.id&&
    native(operation.postAuthorizedAt)&&operation.payloadHash===supportHash(operation.command)&&
    supportHash(operation.expected)===supportHash({...a,swapId:id,payerId:i.payerId,payeeId:i.payeeId,paymentIntentId:i.providerId,intentId:i.intentId})&&
    pi.status==='succeeded'&&pi.currency==='cad'&&pi.confirmation_method==='manual'&&pi.capture_method==='automatic'&&
    typeof pi.livemode==='boolean'&&Number.isSafeInteger(pi.amount)&&pi.amount>0&&pi.amount_received===pi.amount&&pi.amount_capturable===0&&
    pi.transfer_data==null&&(pi.application_fee_amount==null||pi.application_fee_amount===0)&&
    pi.metadata?.type==='swap_topup'&&pi.metadata.swapId===id&&pi.metadata.payerId===i.payerId&&pi.metadata.payeeId===i.payeeId&&
    pi.metadata.topUpAmount===String(a.baseCents)&&pi.metadata.topUpFee===String(a.serviceFeeCents)&&pi.metadata.swapCheckoutIntentId===i.intentId;
}
export async function handleSwapTopUpCheckout(request:any) {
  return withPrivateAccountSession(request,async()=>{
  const uid=supportUid(request),raw=supportObject(request.data,['capability','expectedUid','swapId','scope','mode','relationshipReference','requestId','command']);
  if(raw.capability!==SWAP_TOPUP_MANUAL_CAPABILITY)throw new HttpsError('invalid-argument','Version explicite du complément requise.');
  const id=supportId(raw.swapId);
  if(raw.mode==='preview') {
    if(!['own','admin'].includes(raw.scope))throw new HttpsError('invalid-argument','Portée exacte requise.');
    const relationshipReference=relationshipInput(raw.relationshipReference);
    if(raw.scope==='own'&&relationshipReference!==null||raw.scope==='admin'&&!relationshipReference)throw new HttpsError('invalid-argument','Portée de décision exacte requise.');
    await db.runTransaction(async tx=>{await assertPrivateAccountSession(request,tx);const v=await local(tx,id);await viewer(tx,request,v,raw.scope,relationshipReference);});
    let payment:any=null;try{payment=await observeProvider(id,uid,raw.scope,request,relationshipReference);}catch(recoveryError){if(recoveryError instanceof FinancialRecoveryBlocked)throw recoveryError;/* Unknown never proves no exposed secret. */}
    const current=await db.runTransaction(async tx=>{await assertPrivateAccountSession(request,tx);const v=await local(tx,id);await viewer(tx,request,v,raw.scope,relationshipReference);return v;});
    return {protocol:'swap_topup_preview_v1',actorId:uid,scope:raw.scope,swapId:id,sourceHash:current.sourceHash,amounts:amounts(current),payment,preparation:preparation(current),
      manualEnabled:SWAP_TOPUP_MANUAL_ENABLED,legacyCoverage:'selected_swap_only',exhaustivePairSwapHistoryVerified:false,paymentPermissionGranted:false};
  }
  if(!['execute','observe','neutralize'].includes(raw.mode))throw new HttpsError('invalid-argument','Mode de journal invalide.');
  const c=commandInput(raw.command),rid=supportRequestId(raw.requestId),op=commandRef(id,uid,rid),rr=resultRef(id,uid,rid);
  const first=await db.runTransaction(async tx=>{
    const recoveryCommit = financialRecoveryCommitCheckpoint();await assertPrivateAccountSession(request,tx);const receipt=(await tx.get(rr)).data(),opSnapshot=await tx.get(op),intent=opSnapshot.data();
    if(receipt){if(receipt.actorId!==uid||receipt.requestId!==rid||receipt.payloadHash!==supportHash(c)||supportHash(receipt.command)!==supportHash(c))throw unknown();return {receipt,intent,ready:false};}
    if(intent&&(intent.actorId!==uid||intent.requestId!==rid||intent.payloadHash!==supportHash(c)||supportHash(intent.command)!==supportHash(c)))throw new HttpsError('already-exists','Intention différente.');
    if(raw.mode==='observe')return {receipt:null,intent,ready:false};
    const refuse=(reason:string)=>{const receipt={protocol:'swap_topup_command_v1',actorId:uid,requestId:rid,command:c,payloadHash:supportHash(c),state:'not_executed',reason,result:null,recordedAt:Timestamp.now()};tx.create(rr,receipt);return {receipt,intent,ready:false};};
    if(raw.mode==='neutralize'){if(!intent)return refuse('requester_neutralized');const at=Timestamp.now();await recoveryCommit({refs: [(op).path]});
    tx.update(op,await financialRecoverySourceFields('swap_topup',op,intent,{futureEffectsNeutralizedAt:at}));if(!intent.postAuthorizedAt)return refuse('requester_neutralized');return {receipt:null,intent:{...intent,futureEffectsNeutralizedAt:at},ready:false};}
    if(intent)return {receipt:null,intent,ready:false};
    if(!SWAP_TOPUP_MANUAL_ENABLED)return refuse('swap_topup_manual_not_exposed');
    const l=await local(tx,id);await actor(tx,request,l,c.scope,c.relationshipReference);
    if(c.sourceHash!==l.sourceHash||c.totalCents!==amounts(l).totalCents)return refuse('source_changed');
    if(c.action==='prepare'){
      await newPayment(tx,request,l);
      if(l.intent)return refuse('existing_intention_requires_observation');
      if(l.swap.topUpPaymentIntentId&&(!observedSwapTopUpNeutralization(l.retirement,id,l.payerId,l.payeeId)||l.retirement!.document.paymentIntentId!==l.swap.topUpPaymentIntentId||supportSourceHash(l.retirement!.document)!==l.retirement!.contentHash))return refuse('legacy_capability_not_neutralized');
      if(!l.swap.topUpPaymentIntentId&&l.swap.topUpCheckoutState!=null)return refuse('legacy_outcome_unknown');
      const intentId=randomUUID(),amount=amounts(l);
      const current={protocol:'swap_server_manual_v1',intentId,version:1,swapId:id,payerId:l.payerId,payeeId:l.payeeId,amounts:amount,sourceHash:l.sourceHash,
        ...(l.taxAdmission?{taxAdmission:l.taxAdmission}:{}),
        providerId:null,provider:null,state:'creating',agreementHash:l.agreementHash,createdAt:Timestamp.now(),activeCommand:supportHash([uid,rid])};
      await prepareFinancialRecoverySource('swap',swapRef(id).path,l.swap);
      await recoveryCommit({refs: [(currentRef(id)).path]});
    tx.create(currentRef(id),await financialRecoverySourceFields('swap_topup',currentRef(id),l.intentSnapshot,current));const d={protocol:'swap_topup_operation_v1',actorId:uid,requestId:rid,command:c,payloadHash:supportHash(c),intentId,
        ...(l.taxAdmission?{taxAdmission:l.taxAdmission}:{}),
        version:1,providerId:null,sourceHash:l.sourceHash,expected:{...amount,swapId:id,payerId:l.payerId,payeeId:l.payeeId,intentId},createdAt:Timestamp.now(),futureEffectsNeutralizedAt:null};await recoveryCommit({refs: [(op).path]});
    tx.create(op,await financialRecoverySourceFields('swap_topup',op,opSnapshot,d));return {receipt:null,intent:d,ready:true};
    }
    // Confirmation and retirement reserve only AFTER an exact current GET.
    return {receipt:null,intent:null,ready:true};
  });
  if(first.receipt)return receiptView(uid,id,rid,c,first.receipt);
  if(first.intent&&!first.ready){
    // An exact SDK journal observation may recover a lost response, but never
    // sends a new create/confirm/cancel. Current NEW permissions are irrelevant.
    if(c.action==='retire_legacy'){try{return receiptView(uid,id,rid,c,await recoverRetirement(id,uid,rid,c,request));}catch(recoveryError){if(recoveryError instanceof FinancialRecoveryBlocked)throw recoveryError;}}
    let payment:any=null;try{payment=await observeProvider(id,uid,c.scope,request,c.relationshipReference);}catch(recoveryError){if(recoveryError instanceof FinancialRecoveryBlocked)throw recoveryError;}
    const completed=(await rr.get()).data();if(completed)return {...receiptView(uid,id,rid,c,completed),...(payment?{payment}:{})};
    return {...receiptView(uid,id,rid,c,{state:'unknown',futureEffectsNeutralizedAt:first.intent.futureEffectsNeutralizedAt}),...(payment?{payment}:{})};
  }
  if(raw.mode==='observe'||raw.mode==='neutralize')return receiptView(uid,id,rid,c);
  const stripe=getStripe();if(!stripe)throw unknown();
  let operation:FirebaseFirestore.DocumentData=first.intent??{},pi:any;
  if(c.action!=='prepare'){
    const l=await db.runTransaction(async tx=>{await assertPrivateAccountSession(request,tx);return local(tx,id);}),p=await provider(l,request);
    if(['processing','succeeded','authorized'].includes(p.evidence.state))return {...receiptView(uid,id,rid,c,{state:'engaged'}),payment:result(l,p,c.scope==='own'&&uid===l.payerId)};
    operation=await db.runTransaction(async tx=>{
    const recoveryCommit = financialRecoveryCommitCheckpoint();await assertPrivateAccountSession(request,tx);
      const current=await local(tx,id);await actor(tx,request,current,c.scope,c.relationshipReference);
      if(current.sourceHash!==c.sourceHash||supportHash(current.intent)!==supportHash(l.intent)||c.paymentIntentId!==p.evidence.id||c.totalCents!==p.evidence.amountCents||
        (await tx.get(op)).exists)throw unknown();
      const opMissing=await tx.get(op);
      if(c.action==='confirm'){
        await newPayment(tx,request,current);
        if(p.evidence.method!=='manual'||!current.intent||current.intent.intentId!==c.intentId||current.intent.version!==c.intentVersion||
          ['creating','confirming','unknown'].includes(current.intent.state)||!['unconfirmed','confirmation'].includes(p.evidence.state)||
          p.evidence.state==='unconfirmed'&&!c.paymentMethodId)throw unknown();
      }else if(p.evidence.method!=='automatic'||!['unconfirmed','confirmation','action','canceled'].includes(p.evidence.state)||p.evidence.receivedCents!==0||p.evidence.capturableCents!==0||
        current.swap.topUpPaymentIntentId!==p.evidence.id||current.swap.topUpPaidAt!=null||current.swap.topUpChargeId!=null||current.rows.length||current.intent||
        current.retirement?.protocol==='swap_topup_retirement_intention_v1')throw unknown();
      const d={protocol:'swap_topup_operation_v1',actorId:uid,requestId:rid,command:c,payloadHash:supportHash(c),intentId:current.intent?.intentId??randomUUID(),
        version:current.intent?.version??null,providerId:p.evidence.id,sourceHash:current.sourceHash,expected:expected(current),createdAt:Timestamp.now(),futureEffectsNeutralizedAt:null};
      await recoveryCommit({refs: [(op).path]});
    tx.create(op,await financialRecoverySourceFields('swap_topup',op,opMissing,d));if(c.action==='confirm'){ await recoveryCommit({refs: [(currentRef(id)).path]}); tx.update(currentRef(id),await financialRecoverySourceFields('swap_topup',currentRef(id),current.intent!,{state:'confirming',activeCommand:supportHash([uid,rid]),authorizedAt:Timestamp.now()})); }
      else { await recoveryCommit({refs: [(retirementRef(id)).path]}); tx.set(retirementRef(id),{protocol:'swap_topup_retirement_intention_v1',actorId:uid,requestId:rid,paymentIntentId:p.evidence.id,sourceHash:current.sourceHash,createdAt:Timestamp.now()}); }return d;
    });
  }
  // One new POST per native operation. Replays use GET and cannot repeat an
  // uncertain create/confirm/cancel or manufacture another identity.
  const permitted=await db.runTransaction(async tx=>{
    const recoveryCommit = financialRecoveryCommitCheckpoint();await assertPrivateAccountSession(request,tx);const d=(await tx.get(op)).data(),l=await local(tx,id);if(!d||d.futureEffectsNeutralizedAt||d.postAuthorizedAt)return false;
    await actor(tx,request,l,c.scope,c.relationshipReference);if(c.action!=='retire_legacy')await newPayment(tx,request,l);
    if(l.sourceHash!==operation.sourceHash||c.action==='retire_legacy'&&(l.swap.topUpPaymentIntentId!==operation.providerId||l.swap.topUpPaidAt!=null||l.swap.topUpChargeId!=null||l.rows.length))return false;
    await prepareFinancialRecoverySource('swap',swapRef(id).path,l.swap);
    if(l.intent)await prepareFinancialRecoverySource('swap_topup',currentRef(id).path,l.intent);
    await recoveryCommit({refs: [(op).path]});
    tx.update(op,await financialRecoverySourceFields('swap_topup',op,d,{postAuthorizedAt:Timestamp.now()}));return true;});
  if(!permitted)return receiptView(uid,id,rid,c,{state:'unknown'});
  await assertPrivateAccountSession(request);
  await db.runTransaction(async tx=>{
    await assertPrivateAccountSession(request,tx);
    const d=(await tx.get(op)).data(),l=await local(tx,id);
    if(!d || d.payloadHash!==supportHash(c) || !native(d.postAuthorizedAt) || d.futureEffectsNeutralizedAt || l.sourceHash!==operation.sourceHash)throw unknown();
    await prepareFinancialRecoverySource('swap',swapRef(id).path,l.swap);
    await prepareFinancialRecoverySource('swap_topup',op.path,d);
    if(l.intent)await prepareFinancialRecoverySource('swap_topup',currentRef(id).path,l.intent);
  });
  try {
    if(c.action==='prepare')pi=await stripe.paymentIntents.create({amount:operation.expected.totalCents,currency:'cad',confirmation_method:'manual',capture_method:'automatic',payment_method_types:['card'],
      metadata:{type:'swap_topup',swapId:id,payerId:operation.expected.payerId,payeeId:operation.expected.payeeId,topUpAmount:String(operation.expected.baseCents),
        topUpFee:String(operation.expected.serviceFeeCents),swapCheckoutIntentId:operation.intentId}}, {idempotencyKey:`swap_manual_create_${operation.intentId}`});
    else if(c.action==='confirm')pi=await stripe.paymentIntents.confirm(operation.providerId,{...(c.paymentMethodId?{payment_method:c.paymentMethodId}:{}),
      use_stripe_sdk:true,return_url:getCheckoutReturnUrl(isProductionRuntime()?'production':'development')},{idempotencyKey:`swap_manual_confirm_${supportHash([uid,rid])}`});
    else {const latest=await stripe.paymentIntents.retrieve(operation.providerId),e=swapTopUpIntentEvidence(latest,operation.expected);
      if(!e||!['unconfirmed','confirmation','action','canceled'].includes(e.state)||e.receivedCents!==0||e.capturableCents!==0)throw unknown();
      await db.runTransaction(async tx=>{await assertPrivateAccountSession(request,tx);const current=await local(tx,id);
        await actor(tx,request,current,c.scope,c.relationshipReference);
        if(current.sourceHash!==operation.sourceHash)throw unknown();});
      if(e.state!=='canceled')await stripe.paymentIntents.cancel(operation.providerId,{}, {idempotencyKey:`swap_manual_retire_${supportHash([uid,rid])}`});
      await assertPrivateAccountSession(request);
      pi=await stripe.paymentIntents.retrieve(operation.providerId);}
  }catch(error:any){if(error instanceof FinancialRecoveryBlocked)throw error;
    const declined=error?.type==='StripeCardError'&&c.action==='confirm'?swapTopUpIntentEvidence(error.payment_intent,operation.expected):null;
    if(declined?.state==='unconfirmed')pi=error.payment_intent;
    else return receiptView(uid,id,rid,c,{state:'unknown'});
  }
  await assertPrivateAccountSession(request);
  const evidence=swapTopUpIntentEvidence(pi,{...operation.expected,...(c.action==='prepare'?{intentId:operation.intentId}:{}),...(operation.providerId?{paymentIntentId:operation.providerId}:{})});
  if(!evidence||c.action==='retire_legacy'&&evidence.state!=='canceled')return receiptView(uid,id,rid,c,{state:'unknown'});
  const completed=await db.runTransaction(async tx=>{
    const recoveryCommit = financialRecoveryCommitCheckpoint();await assertPrivateAccountSession(request,tx);
    const recorded=(await tx.get(rr)).data();if(recorded)return recorded;
    const d=(await tx.get(op)).data(),l=await local(tx,id);if(!d||d.payloadHash!==supportHash(c))throw unknown();
    const observed=swapTopUpProviderSnapshot(pi,evidence,c.action==='retire_legacy'?'retrieve':'response');
    await assertPrivateAccountSession(request,tx);
    if(c.action==='retire_legacy'){
      if(l.swap.topUpPaymentIntentId!==evidence.id||l.swap.topUpPaidAt!=null||l.rows.length)throw unknown();
      const document={swapId:id,payerId:l.payerId,payeeId:l.payeeId,paymentIntentId:evidence.id,actorId:uid,requestId:rid,payloadHash:supportHash(c),provider:observed,recordedAt:Timestamp.now()};
      await recoveryCommit({refs: [(retirementRef(id)).path]});
    tx.set(retirementRef(id),{protocol:'swap_topup_retirement_receipt_v1',document,contentHash:supportSourceHash(document)});
    }else {
      if(!l.intent||l.intent.intentId!==operation.intentId||l.intent.activeCommand!==supportHash([uid,rid]))throw unknown();
      await recoveryCommit({refs: [(currentRef(id)).path]});
    tx.update(currentRef(id),await financialRecoverySourceFields('swap_topup',currentRef(id),l.intent,{providerId:evidence.id,provider:observed,state:evidence.status,version:l.intent.version+1,
        ...(c.action==='confirm'?{authorizedAt:d.postAuthorizedAt}:{}),reviewRequired:!!d.futureEffectsNeutralizedAt||l.sourceHash!==operation.sourceHash}));
      if(l.swap.topUpPaidAt==null){ await recoveryCommit({refs: [(swapRef(id)).path]}); tx.update(swapRef(id),await financialRecoverySourceFields('swap',swapRef(id),l.swap,{topUpPaymentIntentId:evidence.id,topUpFee:operation.expected.serviceFeeCents,
        topUpTax:operation.expected.taxCents,topUpCheckoutProtocol:'swap_server_manual_v1',topUpCheckoutState:evidence.status})); }
    }
    const receipt={protocol:'swap_topup_command_v1',actorId:uid,requestId:rid,command:c,payloadHash:supportHash(c),state:'received',reason:null,
      result:{providerStatus:evidence.status,paymentIntentId:evidence.id,intentId:operation.intentId,financialSettlementVerified:false,legacyExternalConfirmationPrevented:evidence.method==='manual'||evidence.state==='canceled'},recordedAt:Timestamp.now()};
    await recoveryCommit({refs: [(rr).path]});
    tx.create(rr,receipt);return receipt;
  });
  let payment:any=null;try{payment=await observeProvider(id,uid,c.scope,request,c.relationshipReference);}catch(recoveryError){if(recoveryError instanceof FinancialRecoveryBlocked)throw recoveryError;}
  return {...receiptView(uid,id,rid,c,completed),...(payment?{payment}:{})};
  });
}
