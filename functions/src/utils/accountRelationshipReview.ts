/** Human review of a native pair. A restriction is neither identity proof nor a finding of fraud. */
import {Timestamp} from 'firebase-admin/firestore';
import {HttpsError} from 'firebase-functions/v2/https';
import {db} from '../config/firebase';
import {projectSupportConfidential} from './supportConfidentiality';
import {supportUid, supportObject, supportId, supportRequestId, supportHash, supportSourceHash, supportRevision,
  supportText, supportCurrentAdminSession, supportAdmin, readSupportAccountSources} from './supportRequest';
import {assertRecentAccountAuthentication, assertAccountSecurityOpen} from './eligibility';
import {assertStoredAccountSecuritySession} from './storedAccountSecuritySession';
import {prepareOperationalNotices, readOperationalNoticeReceipts} from './notifications';
import {checkRateLimit} from './rateLimit';
import {observedSwapTopUpNeutralization} from './swapTopUpCheckoutProof';
import {hasUnavailableAccountStanding} from '../shared/accountStanding';

export const ACCOUNT_RELATIONSHIP_CAPABILITY = 'account_relationship_review_v1';
export const ACCOUNT_RELATIONSHIP_ENABLED: boolean = true;
export const ACCOUNT_RELATIONSHIP_INVENTORY_CAPABILITY='account_relationship_legacy_inventory_v1';
export const ACCOUNT_RELATIONSHIP_INVENTORY_V2_CAPABILITY='account_relationship_legacy_inventory_v2';
export const ACCOUNT_RELATIONSHIP_INVENTORY_ENABLED:boolean=true;
const effects = {commonIdentityVerified:false, fraudEstablished:false, refundAuthorized:false,
  globalBanAuthorized:false, inventoryPermissionGranted:false, fundsRecovered:false} as const;
const native = (v:any):v is Timestamp => v instanceof Timestamp&&v.toMillis()>0&&v.toMillis()<=Date.now();
const hash = (v:any):v is string => typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
type Order = {kind:'purchase'|'swap';id:string};
type Context = {supportRequestId:string;orders:Order[]};
type Reference = {pairId:string;id:string;contentHash:string;version:number};
type Source = {sourceHash:string;pairId:string;version:number};
type Command = {context:Context;source:Source;scope:'own'|'admin';action:'record_review'|'contest';
  pairAction:'retain_current'|'restrict_new_engagements'|'close_own_restriction';
  orderAction:'retain_current'|'retain_release_review'|'close_own_release_review';
  assessment:'relationship_examined'|'unresolved'|'no_relation_established';
  facts:{qualification:'declared'|'documentary'|'unknown'|'contradictory';text:string}[];
  privateReason:string|null;statement:string|null;reconsiderWhen:string|null;
  partyMessages:{userId:string;message:string}[];decisionReference:Reference|null;acknowledged:true};
export type AccountRelationshipCommand = Command;
export type AccountRelationshipReference = Reference;
export type AccountRelationshipContext = Context;
const pairId = (uids:string[]) => 'arp_'+supportHash([...uids].sort());
const pairRef = (id:string) => db.collection('account_relationship_pairs').doc(id);
const eid = (uid:string,rid:string) => 'ar_'+supportHash([uid,rid]);
const entryRef = (r:Reference) => pairRef(r.pairId).collection('entries').doc(r.id);
const receiptRef = (sid:string,uid:string,rid:string) => db.collection('support_requests').doc(sid).collection('relationship_commands').doc(supportHash([uid,rid]));
const orderKey = (o:Order) => supportHash(o);
function documentCursor(raw:unknown) {
  if(typeof raw!=='string'||!raw||raw.includes('/')||raw==='.'||raw==='..'||/^__.*__$/.test(raw)||Buffer.byteLength(raw,'utf8')>1500)
    throw new HttpsError('invalid-argument','Curseur de document invalide.');return raw;
}
function contextInput(raw:unknown):Context {
  const c=supportObject(raw,['supportRequestId','orders']);
  if(!Array.isArray(c.orders)||c.orders.length<1||c.orders.length>10)throw new HttpsError('invalid-argument','Une à dix commandes exactes requises.');
  const orders=c.orders.map((r:any)=>{const o=supportObject(r,['kind','id']);if(!['purchase','swap'].includes(o.kind))throw new HttpsError('invalid-argument','Origine de commande requise.');return {kind:o.kind,id:supportId(o.id)} as Order;});
  if(new Set(orders.map(orderKey)).size!==orders.length)throw new HttpsError('invalid-argument','Commandes distinctes requises.');
  return {supportRequestId:supportId(c.supportRequestId),orders};
}
function referenceInput(raw:unknown):Reference {
  const r=supportObject(raw,['pairId','id','contentHash','version']);
  if(!/^arp_[a-f0-9]{64}$/.test(r.pairId??'')||!/^ar_[a-f0-9]{64}$/.test(r.id??'')||!hash(r.contentHash)||!Number.isSafeInteger(r.version)||r.version<1)
    throw new HttpsError('invalid-argument','Référence exacte de décision requise.');
  return {pairId:r.pairId,id:r.id,contentHash:r.contentHash,version:r.version};
}
function commandInput(raw:unknown):Command {
  const c=supportObject(raw,['context','source','scope','action','pairAction','orderAction','assessment','facts','privateReason','statement','reconsiderWhen','partyMessages','decisionReference','acknowledged']);
  const s=supportObject(c.source,['sourceHash','pairId','version']);
  if(!hash(s.sourceHash)||!/^arp_[a-f0-9]{64}$/.test(s.pairId??'')||!Number.isSafeInteger(s.version)||s.version<0||
    !['own','admin'].includes(c.scope)||c.action!==(c.scope==='own'?'contest':'record_review')||c.acknowledged!==true||
    !['retain_current','restrict_new_engagements','close_own_restriction'].includes(c.pairAction)||
    !['retain_current','retain_release_review','close_own_release_review'].includes(c.orderAction)||
    !['relationship_examined','unresolved','no_relation_established'].includes(c.assessment)||!Array.isArray(c.facts)||c.facts.length>10||
    !Array.isArray(c.partyMessages)||c.partyMessages.length>2)throw new HttpsError('invalid-argument','Portées, sources et intention explicites requises.');
  const facts=c.facts.map((v:any)=>{const f=supportObject(v,['qualification','text']);if(!['declared','documentary','unknown','contradictory'].includes(f.qualification))throw new HttpsError('invalid-argument','Qualification documentaire requise.');
    return {qualification:f.qualification,text:supportText(f.text,'Observation examinée',1000)};});
  const partyMessages=c.partyMessages.map((v:any)=>{const m=supportObject(v,['userId','message']);return {userId:supportId(m.userId),message:supportText(m.message,'Message communiqué à cette partie',2000)};});
  if(c.scope==='own'&&(c.pairAction!=='retain_current'||c.orderAction!=='retain_current'||c.assessment!=='unresolved'||c.statement===null||c.privateReason!==null||c.reconsiderWhen!==null||facts.length||partyMessages.length||c.decisionReference===null)||
    c.scope==='admin'&&(c.privateReason===null||c.reconsiderWhen===null||c.statement!==null||c.decisionReference!==null||partyMessages.length!==2||new Set(partyMessages.map((m:any)=>m.userId)).size!==2))
    throw new HttpsError('invalid-argument','Contestation et décision opérateur ont des portées distinctes.');
  return {context:contextInput(c.context),source:{sourceHash:s.sourceHash,pairId:s.pairId,version:s.version},scope:c.scope,action:c.action,
    pairAction:c.pairAction,orderAction:c.orderAction,assessment:c.assessment,facts,partyMessages,
    privateReason:c.privateReason===null?null:supportText(c.privateReason,'Motivation privée',4000),
    statement:c.statement===null?null:supportText(c.statement,'Motif de contestation',4000),
    reconsiderWhen:c.reconsiderWhen===null?null:supportText(c.reconsiderWhen,'Condition de réexamen',2000),
    decisionReference:c.decisionReference===null?null:referenceInput(c.decisionReference),acknowledged:true};
}
async function currentActor(tx:FirebaseFirestore.Transaction,request:any,admin:boolean) {
  await supportCurrentAdminSession(request);
  if(admin){await supportAdmin(tx,request.auth.uid,false);assertRecentAccountAuthentication(request.auth.token);}
  if(request.auth.token.auth_time*1000>Date.now())throw new HttpsError('permission-denied','Session actuelle non qualifiée.');
  await assertAccountSecurityOpen((await tx.get(db.collection('eligibility_profiles').doc(request.auth.uid))).data(), tx, request.auth.uid);
}
async function readOrder(tx:FirebaseFirestore.Transaction,o:Order) {
  const snap=await tx.get(db.collection(o.kind==='purchase'?'transactions':'swaps').doc(o.id)),d=snap.data();
  const uids=d?(o.kind==='purchase'?[d.buyerId,d.sellerId]:[d.initiatorId,d.receiverId]):[];
  const partiesNative=uids.length===2&&uids.every(v=>typeof v==='string'&&v&&!v.includes('/')&&v.length<=200)&&uids[0]!==uids[1]&&native(d?.createdAt);
  let origin:any=null;
  if(partiesNative&&o.kind==='swap'&&native(d!.acceptedAt))origin={kind:'native_swap_agreement',acceptedAt:d!.acceptedAt};
  else if(partiesNative&&o.kind==='swap'&&d!.articleDeclarationProposalVersion===1&&native(d!.articleDeclarationProposalRecordedAt)&&
    d!.articleDeclarationProposalRecordedAt.toMillis()<=d!.createdAt.toMillis())origin={kind:'native_swap_proposal',recordedAt:d!.articleDeclarationProposalRecordedAt};
  if(partiesNative&&o.kind==='purchase'&&d!.deliveryType==='shipping'&&d!.articleSnapshot&&typeof d!.articleSnapshot==='object'&&
    d!.purchasePolicyAcceptance?.schemaVersion===1&&d!.purchasePolicyAcceptance?.transactionId===o.id&&d!.purchasePolicyAcceptance?.acceptedBy===d!.buyerId&&
    d!.purchasePolicyAcceptance.quoteId===d!.shippingQuoteId&&d!.purchasePolicyAcceptance.rateId===d!.shipEngineRateId&&hash(d!.purchasePolicyAcceptance.policyHash)&&
    Number.isSafeInteger(d!.purchasePolicyAcceptance.totalCents)&&d!.purchasePolicyAcceptance.totalCents>0&&native(d!.purchasePolicyAcceptance.acceptedAt))
    origin={kind:'native_shipping_acceptance',capture:d!.purchasePolicyAcceptance};
  // Malformed historical references qualify only the origin as unknown. This
  // syntax-only check never catches a Firestore read failure or stops a page's
  // inspected-document cursor from progressing.
  const lookupId=(value:unknown):string|null=>{try{const parsed=supportId(value);return parsed===value?parsed:null;}catch{return null;}};
  const offerMessageId=lookupId(d?.offerMessageId),chatId=lookupId(d?.chatId);
  if(partiesNative&&o.kind==='purchase'&&d!.deliveryType==='meetup'&&offerMessageId&&chatId) {
    const m=(await tx.get(db.collection('messages').doc(offerMessageId))).data();
    const chat=(await tx.get(db.collection('chats').doc(chatId))).data();
    if(m?.type==='offer'&&m.chatId===d!.chatId&&m.offer?.transactionId===o.id&&native(m.offer.acceptedAt)&&
      Array.isArray(chat?.participants)&&chat.participants.length===2&&uids.every(v=>chat.participants.includes(v)))
      origin={kind:'native_meetup_agreement',messageId:d!.offerMessageId,acceptedAt:m.offer.acceptedAt};
  }
  return {snap,data:d,uids:partiesNative?uids.slice().sort() as string[]:[],reference:{...o,revision:supportRevision(snap),
    sourceHash:supportSourceHash(d??null),originHash:origin?supportSourceHash(origin):null,
    originQualification:origin?.kind==='native_swap_proposal'?'native_proposal':origin?'native_agreement':'unknown'}};
}
async function sources(tx:FirebaseFirestore.Transaction,c:Context) {
  const ticketSnap=await tx.get(db.collection('support_requests').doc(c.supportRequestId)),ticket=ticketSnap.data();
  const orders=[];for(const o of c.orders)orders.push(await readOrder(tx,o));
  const parties=orders[0]?.uids??[];
  if(!ticket||ticket.schemaVersion!==1||!['account_reconciliation','restriction_circumvention'].includes(ticket.kind)||
    !Number.isSafeInteger(ticket.version)||ticket.version<1||!Number.isSafeInteger(ticket.receivedAtMs)||ticket.receivedAtMs<1||ticket.receivedAtMs>Date.now()||
    parties.length!==2||!parties.includes(ticket.ownerId)||orders.some(o=>supportHash(o.uids)!==supportHash(parties))||
    ticket.transactionId!=null&&!c.orders.some(o=>o.kind==='purchase'&&o.id===ticket.transactionId))return null;
  const submitted=await tx.get(ticketSnap.ref.collection('commands').where('action','==','submit').limit(2));
  const receipt=submitted.size===1?submitted.docs[0].data():null;
  const ticketNative=receipt?.protocol==='support_command_v1'&&receipt.state==='committed'&&receipt.actorId===ticket.ownerId&&receipt.supportRequestId===c.supportRequestId&&
    receipt.payloadHash===supportHash(receipt.command)&&receipt.ownerSnapshot?.ownerId===ticket.ownerId&&receipt.ownerSnapshot?.kind===ticket.kind&&
    receipt.ownerSnapshot.receivedAtMs===ticket.receivedAtMs&&submitted.docs[0].id===supportHash([receipt.actorId,receipt.requestId]);
  const pid=pairId(parties),rootSnap=await tx.get(pairRef(pid)),root=rootSnap.data();
  let rootQualified=!root||root.protocol==='account_relationship_pair_v1'&&root.pairId===pid&&supportHash(root.parties)===supportHash(parties)&&
    Number.isSafeInteger(root.version)&&root.version>0&&Object.prototype.hasOwnProperty.call(root,'pairRestriction')&&
    typeof root.orderReviews==='object'&&!Array.isArray(root.orderReviews)&&root.orderReviews!==null&&Object.keys(root.orderReviews).length<=100;
  if(rootQualified&&root)rootQualified=await qualifiedRoot(tx,pid,parties,root)&&
    (root.pairRestriction===null||!!await restrictionProof(tx,pid,parties,root.version,root.pairRestriction))&&
    (await Promise.all(c.orders.map(async o=>root.orderReviews[orderKey(o)]===undefined||
      !!await restrictionProof(tx,pid,parties,root.version,root.orderReviews[orderKey(o)],o)))).every(Boolean);
  const accounts=await readSupportAccountSources(tx,{...ticket,relatedAccountIds:parties});
  const legacyPaymentReview=await readLegacyPaymentReview(tx,orders);
  const capture={protocol:'account_relationship_source_v1',context:c,pairId:pid,parties,ticketVersion:ticket.version,ticketRevision:supportRevision(ticketSnap),
    ticketHash:supportSourceHash(ticket),ticketOriginHash:ticketNative?supportSourceHash(receipt):null,
    orders:orders.map(o=>o.reference),accounts,legacyPaymentReview,version:rootQualified?root?.version??0:null,pairSourceHash:supportSourceHash(root??null)};
  return {ticket,ticketSnap,orders,parties,pid,root,rootQualified,ticketNative,capture,sourceHash:supportSourceHash(capture),
    complete:ticketNative&&rootQualified&&orders.every(o=>o.reference.originQualification!=='unknown')};
}
const emptyLegacyPaymentReview=()=>({orders:[] as {order:Order;state:'native_manual_protocol_recorded'|'neutralization_observed'|'legacy_exposure_requires_review'|'unknown';externalConfirmationPrevented:boolean;providerObservedAt:string|null}[],
  coverage:{selectedSwapCount:0,selectedOnly:true as const,exhaustivePairSwapHistoryVerified:false as const}});
async function readLegacyPaymentReview(tx:FirebaseFirestore.Transaction,orders:Awaited<ReturnType<typeof readOrder>>[]) {
  const view=emptyLegacyPaymentReview();
  for(const o of orders.filter(o=>o.reference.kind==='swap')){
    const swap=o.data,order={kind:'swap' as const,id:o.reference.id},base=swap?.cashTopUp;
    let state:'native_manual_protocol_recorded'|'neutralization_observed'|'legacy_exposure_requires_review'|'unknown'='unknown',observedAt:string|null=null;
    const payerId=base?.payerId,payeeId=o.uids.find(uid=>uid!==payerId);
    if(swap&&o.uids.includes(payerId)&&payeeId&&Number.isSafeInteger(base.amount)&&base.amount>0){
      const ref=db.collection('swaps').doc(order.id),intent=(await tx.get(ref.collection('topup_checkout').doc('current'))).data();
      const retired=(await tx.get(ref.collection('topup_checkout').doc('legacy_retirement'))).data();
      const p=intent?.provider;
      if(intent?.protocol==='swap_server_manual_v1'&&intent.swapId===order.id&&intent.payerId===payerId&&intent.payeeId===payeeId&&
        intent.amounts?.baseCents===base.amount&&intent.amounts.currency==='CAD'&&intent.providerId===swap.topUpPaymentIntentId&&
        p?.id===intent.providerId&&p.method==='manual'&&p.source==='retrieve'&&native(p.observedAt)&&hash(intent.activeCommand)){
        const command=ref.collection('topup_checkout_commands').doc(intent.activeCommand),nativeOperation=(await tx.get(command)).data();
        if(nativeOperation?.protocol==='swap_topup_operation_v1'&&nativeOperation.intentId===intent.intentId&&native(nativeOperation.postAuthorizedAt)&&
          nativeOperation.expected?.swapId===order.id&&nativeOperation.expected.payerId===payerId&&nativeOperation.expected.payeeId===payeeId&&
          nativeOperation.expected.baseCents===base.amount&&nativeOperation.payloadHash===supportHash(nativeOperation.command)){
          state='native_manual_protocol_recorded';observedAt=p.observedAt.toDate().toISOString();}
      }
      if(state==='unknown'&&observedSwapTopUpNeutralization(retired,order.id,payerId,payeeId)&&supportSourceHash(retired!.document)===retired!.contentHash&&
        retired!.document.paymentIntentId===swap.topUpPaymentIntentId){
        const d=retired!.document,command=ref.collection('topup_checkout_commands').doc(supportHash([d.actorId,d.requestId]));
        const operation=(await tx.get(command)).data(),receipt=(await tx.get(command.collection('results').doc('receipt'))).data();
        if(operation?.command?.action==='retire_legacy'&&operation.payloadHash===d.payloadHash&&supportHash(operation.command)===d.payloadHash&&
          receipt?.state==='received'&&receipt.payloadHash===d.payloadHash&&receipt.result?.legacyExternalConfirmationPrevented===true){
          state='neutralization_observed';observedAt=d.provider.observedAt.toDate().toISOString();}
      }
      if(state==='unknown'&&typeof swap.topUpPaymentIntentId==='string'&&/^pi_[A-Za-z0-9]+$/.test(swap.topUpPaymentIntentId)&&swap.topUpPaidAt==null)
        state='legacy_exposure_requires_review';
    }
    view.orders.push({order,state,externalConfirmationPrevented:['native_manual_protocol_recorded','neutralization_observed'].includes(state),providerObservedAt:observedAt});
  }
  view.coverage.selectedSwapCount=view.orders.length;return view;
}
function notices(d:any) {return d.parties.map((userId:string)=>({eventKey:`account_relationship:${d.entryId}`,userId,type:'order_moderation',title:'Examen d’un lien entre comptes',
  message:d.command.scope==='admin'?d.command.partyMessages.find((m:any)=>m.userId===userId).message:
    'Une contestation a été reçue pour réexamen. Cela ne modifie pas les fonds, les restrictions existantes ou les autres recours.',
  data:{ownerId:userId,supportRequestId:d.command.context.supportRequestId,accountRelationshipCapability:ACCOUNT_RELATIONSHIP_CAPABILITY,
    accountRelationshipPairId:d.pairId,accountRelationshipEntryId:d.entryId,accountRelationshipEntryHash:supportSourceHash(d),accountRelationshipVersion:String(d.version)}}));}
async function proof(tx:FirebaseFirestore.Transaction,r:Reference) {
  const raw=(await tx.get(entryRef(r))).data(),d=raw?.document;
  if(raw?.protocol!=='account_relationship_entry_v1'||!d||raw.contentHash!==r.contentHash||supportSourceHash(d)!==r.contentHash||d.entryId!==r.id||d.pairId!==r.pairId||
    d.version!==r.version||!native(d.recordedAt)||eid(d.actorId,d.requestId)!==r.id||!Array.isArray(d.parties)||d.parties.length!==2||pairId(d.parties)!==r.pairId)return null;
  let command:Command;try{command=commandInput(d.command);}catch{return null;}
  if(command.source.version!==d.version-1||command.source.pairId!==r.pairId||supportSourceHash(d.sourceCapture)!==command.source.sourceHash||
    supportHash(d.sourceCapture.context)!==supportHash(command.context)||supportHash(d.sourceCapture.parties)!==supportHash(d.parties)||
    Object.entries(effects).some(([k,v])=>d[k]!==v)||command.scope==='admin'&&(d.authority?.actorId!==d.actorId||d.authority.privateRoleQualified!==true||
      !Number.isSafeInteger(d.authority.authTime)||d.authority.authTime<1||d.authority.authTime*1000>d.recordedAt.toMillis()))return null;
  const receipt=(await tx.get(receiptRef(command.context.supportRequestId,d.actorId,d.requestId))).data();
  if(receipt?.protocol!=='account_relationship_command_v1'||receipt.state!=='committed'||receipt.actorId!==d.actorId||receipt.requestId!==d.requestId||
    receipt.payloadHash!==supportHash(command)||supportHash(receipt.command)!==receipt.payloadHash||supportHash(receipt.reference)!==supportHash(r)||
    !native(receipt.recordedAt)||!receipt.recordedAt.isEqual(d.recordedAt))return null;
  const nr=await readOperationalNoticeReceipts(tx,notices(d));
  if(!Array.isArray(receipt.notificationIds)||nr.some((p,i)=>!p||p.notificationId!==receipt.notificationIds[i]))return null;
  return d;
}
/** Pure native proof reader; callers separately requalify current authority. */
export const readAccountRelationshipReviewProof=proof;
/** A current restriction is an explicit authority for THIS selected purchase,
 * never a general administrative payment permission. Re-read on every retry. */
async function currentPurchaseRetirementActor(tx:FirebaseFirestore.Transaction,request:any) {
  await currentActor(tx,request,true);
  // This effect requires the decision's own author as the current actor below.
  // One current private read therefore qualifies both identities. Keep legacy
  // readers/lifts elsewhere unchanged; a present standing value is exact-true.
  if(hasUnavailableAccountStanding((await tx.get(db.collection('users').doc(request.auth.uid))).data()))
    throw new HttpsError('permission-denied','Statut actuel de l’auteur administratif non qualifié.');
}
export async function assertRelationshipPurchaseRetirement(tx:FirebaseFirestore.Transaction,request:any,id:string,buyerId:string,sellerId:string,rawReference:unknown) {
  await currentPurchaseRetirementActor(tx,request);
  const r=referenceInput(rawReference),d=await proof(tx,r),parties=[buyerId,sellerId].sort();
  const root=(await tx.get(pairRef(r.pairId))).data(),order=await readOrder(tx,{kind:'purchase',id});
  const original=d?.sourceCapture?.orders?.find((o:any)=>o.kind==='purchase'&&o.id===id);
  if(!d||d.actorId!==request.auth.uid||d.command.scope!=='admin'||d.command.pairAction!=='restrict_new_engagements'||
    !d.command.context.orders.some((o:Order)=>o.kind==='purchase'&&o.id===id)||supportHash(d.parties)!==supportHash(parties)||
    supportHash(order.uids)!==supportHash(parties)||order.reference.originQualification==='unknown'||
    !original?.originHash||original.originHash!==order.reference.originHash||!root||!await qualifiedRoot(tx,r.pairId,parties,root)||
    root.pairRestriction?.blocked!==true||supportHash(root.pairRestriction.reference)!==supportHash(r)||
    !await restrictionProof(tx,r.pairId,parties,root.version,root.pairRestriction)||!await liftAuthorityCurrent(tx,d))
    throw new HttpsError('permission-denied','Décision actuelle et achat natif sélectionné requis.');
  return r;
}
/** A documentary fence closes only its author's exact unstarted draft. A
 * changed/lifted restriction or an expired former session cannot confer a new
 * payment permission, and need not prevent fencing that obsolete draft. */
export async function assertRelationshipPurchaseDraftNeutralization(tx:FirebaseFirestore.Transaction,request:any,id:string,rawReference:unknown) {
  await currentPurchaseRetirementActor(tx,request);
  const r=referenceInput(rawReference),d=await proof(tx,r),order=(await tx.get(db.collection('transactions').doc(id))).data();
  const original=d?.sourceCapture?.orders?.find((o:any)=>o.kind==='purchase'&&o.id===id);
  if(!d||d.actorId!==request.auth.uid||d.command.scope!=='admin'||d.command.pairAction!=='restrict_new_engagements'||
    !d.command.context.orders.some((o:Order)=>o.kind==='purchase'&&o.id===id)||!hash(original?.originHash)||
    original.originQualification!=='native_agreement'||order&&supportHash([order.buyerId,order.sellerId].sort())!==supportHash(d.parties))
    throw new HttpsError('permission-denied','Ancienne décision native propre et achat identique requis.');
  return r;
}
async function restrictionProof(tx:FirebaseFirestore.Transaction,pid:string,parties:string[],version:number,value:any,order?:Order) {
  let r:Reference;try{r=referenceInput(value?.reference);}catch{return null;}
  if(r.pairId!==pid||r.version>version||typeof value.blocked!=='boolean')return null;
  const d=await proof(tx,r);if(!d||d.command.scope!=='admin'||supportHash(d.parties)!==supportHash(parties))return null;
  if(order)return supportHash(value.order)===supportHash(order)&&d.command.context.orders.some((v:Order)=>orderKey(v)===orderKey(order))&&
    d.command.orderAction===(value.blocked?'retain_release_review':'close_own_release_review')?d:null;
  return d.command.pairAction===(value.blocked?'restrict_new_engagements':'close_own_restriction')?d:null;
}
async function qualifiedRoot(tx:FirebaseFirestore.Transaction,pid:string,parties:string[],root:any) {
  if(root.protocol!=='account_relationship_pair_v1'||root.pairId!==pid||supportHash(root.parties)!==supportHash(parties)||
    !Number.isSafeInteger(root.version)||root.version<1||!Object.prototype.hasOwnProperty.call(root,'pairRestriction'))return false;
  let r:Reference;try{r=referenceInput(root.currentReference);}catch{return false;}
  const d=r.pairId===pid&&r.version===root.version?await proof(tx,r):null;
  return !!d&&supportHash(d.parties)===supportHash(parties);
}
/** A native historical receipt remains valid evidence, but its author must
 * still hold authority whenever that receipt admits a NEW effect. */
async function liftAuthorityCurrent(tx:FirebaseFirestore.Transaction,d:any):Promise<boolean> {
  try {
    const role=(await tx.get(db.collection('users').doc(d.actorId))).data();
    if(role?.isAdmin!==true||hasUnavailableAccountStanding(role))return false;
    // Confinement is authoritative as soon as its native transaction commits,
    // even when Auth revocation is still unknown. Join this read set before
    // any new admission/release; only a currently qualified native recovery
    // may pass, and it cannot renew the historical author's authentication.
    await assertStoredAccountSecuritySession(tx,d.actorId,d.authority.authTime);
    return true;
  }catch{return false;}
}
/** Native pair and explicitly named order scopes never substitute one another. */
export async function accountRelationshipAllowsNewPair(tx:FirebaseFirestore.Transaction,a:string,b:string):Promise<boolean> {
  if(![a,b].every(v=>typeof v==='string'&&v.length>0&&v.length<=200&&!v.includes('/')))return false;
  if(a===b)return false;const parties=[a,b].sort(),pid=pairId(parties),root=(await tx.get(pairRef(pid))).data();
  if(!root)return true;
  if(!await qualifiedRoot(tx,pid,parties,root))return false;
  if(root.pairRestriction===null)return true;
  const d=await restrictionProof(tx,pid,parties,root.version,root.pairRestriction);
  return !!d&&root.pairRestriction.blocked===false&&await liftAuthorityCurrent(tx,d);
}
export async function accountRelationshipAllowsRelease(tx:FirebaseFirestore.Transaction,o:Order,a:string,b:string):Promise<boolean> {
  if(a===b||![a,b].every(v=>typeof v==='string'&&v.length>0&&v.length<=200&&!v.includes('/')))return false;
  const parties=[a,b].sort(),pid=pairId(parties),root=(await tx.get(pairRef(pid))).data();if(!root)return true;
  if(!await qualifiedRoot(tx,pid,parties,root)||!root.orderReviews||typeof root.orderReviews!=='object'||Array.isArray(root.orderReviews))return false;
  const current=root.orderReviews[orderKey(o)];if(current===undefined)return true;
  const d=await restrictionProof(tx,pid,parties,root.version,current,o);
  return !!d&&current.blocked===false&&await liftAuthorityCurrent(tx,d);
}
export async function assertAccountRelationshipNewPair(tx:FirebaseFirestore.Transaction,a:string,b:string) {
  if(!await accountRelationshipAllowsNewPair(tx,a,b))throw new HttpsError('failed-precondition',
    'Cette nouvelle opération doit être examinée. Les commandes et le support restent accessibles.',
    {reason:'account_pair_review_required',action:'contactSupport',fraudEstablished:false});
}
const entryView=(d:any,uid:string,admin:boolean)=>({reference:{pairId:d.pairId,id:d.entryId,contentHash:supportSourceHash(d),version:d.version},
  context:d.command.context,
  action:d.command.action,assessment:d.command.assessment,pairAction:d.command.pairAction,orderAction:d.command.orderAction,
  statement:admin||d.actorId===uid?d.command.statement:null,privateReason:admin?d.command.privateReason:null,facts:admin?d.command.facts:null,
  reconsiderWhen:admin?d.command.reconsiderWhen:null,message:d.command.partyMessages.find((m:any)=>m.userId===uid)?.message??null,
  partyMessages:admin?d.command.partyMessages:null,
  relatedDecision:d.command.decisionReference,orders:admin?d.command.context.orders:null,recordedAt:d.recordedAt.toDate().toISOString(),historicalOnly:true,...effects});
const view=(uid:string,rid:string,c:Command,value?:any)=>({protocol:'account_relationship_command_v1',actorId:uid,requestId:rid,command:c,payloadHash:supportHash(c),
  state:value?.state??'unrecorded',reason:value?.reason??null,reference:value?.reference??null,
  recordedAt:native(value?.recordedAt)?value.recordedAt.toDate().toISOString():null,...effects});
/** Private, read-only inventory. An ID cursor is navigation, never proof that
 * all earlier pages were inspected. Single-field initiator queries cover both
 * native directions; unknown/missing historical identities and provider-only
 * intents cannot be exhaustively inventoried from Firestore. */
async function readRelationshipLegacyInventory(request:any) {
  const uid=supportUid(request),raw=supportObject(request.data,['capability','inventoryCapability','expectedUid','operation','scope','decisionReference','expectedSource','cursor']);
  const v2=raw.inventoryCapability===ACCOUNT_RELATIONSHIP_INVENTORY_V2_CAPABILITY;
  if(raw.capability!==ACCOUNT_RELATIONSHIP_CAPABILITY||!v2&&raw.inventoryCapability!==ACCOUNT_RELATIONSHIP_INVENTORY_CAPABILITY||
    raw.operation!=='legacy_inventory'||raw.scope!=='admin')throw new HttpsError('invalid-argument','Lecture privée versionnée de la paire requise.');
  const r=referenceInput(raw.decisionReference),wanted=raw.expectedSource==null?null:supportObject(raw.expectedSource,['sourceHash']).sourceHash;
  if(wanted!==null&&!hash(wanted))throw new HttpsError('invalid-argument','Source d’inventaire exacte requise.');
  let cursor:{kind?:'purchase'|'swap';direction:'first_to_second'|'second_to_first';lastId:string|null;sourceHash:string}|null=null;
  if(raw.cursor!=null){
    const c=supportObject(raw.cursor,v2?['kind','direction','lastId','sourceHash']:['direction','lastId','sourceHash']);
    if(v2&&!['purchase','swap'].includes(c.kind)||!['first_to_second','second_to_first'].includes(c.direction)||!hash(c.sourceHash)||wanted!==c.sourceHash)
      throw new HttpsError('invalid-argument','Curseur lié à la source exacte requis.');
    cursor={...(v2?{kind:c.kind}:{}),direction:c.direction,lastId:c.lastId===null?null:documentCursor(c.lastId),sourceHash:c.sourceHash};
  }
  return db.runTransaction(async tx=>{
    await currentActor(tx,request,true);
    if(!ACCOUNT_RELATIONSHIP_INVENTORY_ENABLED)throw new HttpsError('failed-precondition','L’inventaire de la paire est en préparation.',
      {reason:'account_relationship_inventory_not_exposed'});
    const d=await proof(tx,r);
    if(!d||d.command.scope!=='admin'||!d.parties.every((v:any)=>typeof v==='string'&&v.length>0&&v.length<=200&&!v.includes('/'))||d.parties[0]===d.parties[1])
      throw new HttpsError('permission-denied','Décision privée non qualifiée.');
    const parties=[...d.parties].sort(),rootSnap=await tx.get(pairRef(r.pairId)),root=rootSnap.data();
    const rootQualified=!!root&&supportHash(root.parties)===supportHash(parties)&&await qualifiedRoot(tx,r.pairId,parties,root);
    const authorityQualified=await liftAuthorityCurrent(tx,d);
    const sourceDocument={protocol:v2?'account_relationship_inventory_source_v2':'account_relationship_inventory_source_v1',decisionReference:r,parties,
      pairRevision:supportRevision(rootSnap),pairSourceHash:supportSourceHash(root??null),decisionAuthorityCurrent:authorityQualified};
    const sourceHash=supportSourceHash(sourceDocument);
    if(wanted!==null&&wanted!==sourceHash)throw new HttpsError('failed-precondition','La source de l’inventaire a changé. Reprenez depuis une nouvelle lecture.',
      {reason:'account_relationship_inventory_source_changed'});
    const kind=cursor?.kind??(v2?'purchase':'swap'),purchase=kind==='purchase';
    const direction=cursor?.direction??'first_to_second',first=direction==='first_to_second',from=parties[first?0:1],to=parties[first?1:0];
    let q:FirebaseFirestore.Query=db.collection(purchase?'transactions':'swaps').where(purchase?'buyerId':'initiatorId','==',from).orderBy('__name__').limit(21);
    if(cursor?.lastId)q=q.startAfter(cursor.lastId);
    const page=await tx.get(q),inspected=page.docs.slice(0,20),orders=[];
    for(const row of inspected){
      const data=row.data();
      // Third-party agreements are inspected for cursor progression, never
      // projected. Only the exact native pair can enter this inventory.
      if(data[purchase?'buyerId':'initiatorId']!==from||data[purchase?'sellerId':'receiverId']!==to)continue;
      orders.push(await readOrder(tx,{kind,id:row.id}));
    }
    const paymentReview=await readLegacyPaymentReview(tx,orders),rows=[];
    const currentReferenceUsable=rootQualified&&authorityQualified&&d.actorId===uid&&d.command.pairAction==='restrict_new_engagements'&&
      root!.pairRestriction?.blocked===true&&supportHash(root!.pairRestriction.reference)===supportHash(r);
    for(const order of orders){
      const data=order.data!,selected=d.command.context.orders.some((o:Order)=>o.kind===kind&&o.id===order.snap.id);
      if(purchase){
        const intention=(await tx.get(db.collection('stripe_checkout_intents').doc(order.snap.id))).data(),retired=intention?.relationshipRetirement;
        const totalCandidate=typeof data.totalAmount==='number'?Math.round(data.totalAmount*100):NaN;
        const totalCents=Number.isSafeInteger(totalCandidate)&&totalCandidate>=0&&Math.abs(data.totalAmount*100-totalCandidate)<0.0000001?totalCandidate:null;
        const walletCandidate=data.walletAmountUsed??0,walletCents=Number.isSafeInteger(walletCandidate)&&walletCandidate>=0&&
          (totalCents===null||walletCandidate<=totalCents)?walletCandidate:null;
        const paymentReferenceQualification=typeof data.stripePaymentIntentId==='string'&&/^pi_[A-Za-z0-9]+$/.test(data.stripePaymentIntentId)?'native_reference_present':
          data.stripePaymentIntentId==null?'reference_absent_outcome_unknown':'malformed_reference_unknown';
        let checkoutIdQualified=true;try{supportId(order.snap.id);}catch{checkoutIdQualified=false;}
        // Inventory reports recorded evidence only. Its rows cannot authorize a
        // provider mutation; the separate current GET preview must qualify it.
        const neutralized=retired?.protocol==='relationship_purchase_retirement_command_v1'&&retired.state==='received'&&
          retired.command?.scope==='admin'&&retired.command.acknowledged===true&&retired.command.transactionId===order.snap.id&&retired.command.paymentIntentId===data.stripePaymentIntentId&&
          retired.operationId===supportHash([retired.actorId,retired.requestId])&&hash(retired.command.sourceHash)&&hash(retired.localSourceHash)&&
          retired.payloadHash===supportHash(retired.command)&&retired.result?.cardCapabilityNeutralized===true&&
          retired.result?.providerStatus==='canceled'&&retired.result.transactionId===order.snap.id&&
          retired.result.totalCents===retired.command.totalCents&&retired.result.walletCents===retired.command.walletCents&&
          retired.result.walletObligationOpen===(retired.command.walletCents>0)&&retired.result.orderChanged===false&&retired.result.stockChanged===false&&
          retired.result.fundsMoved===false&&retired.result.paymentPermissionGranted===false&&native(retired.authorizedAt)&&native(retired.providerObservedAt)&&
          retired.providerObservedAt.toMillis()>=retired.authorizedAt.toMillis()&&native(retired.recordedAt);
        rows.push({kind:'purchase',id:order.snap.id,source:{revision:order.reference.revision,sourceHash:order.reference.sourceHash,
          originQualification:order.reference.originQualification,originHash:order.reference.originHash},direction,
          createdAt:native(data.createdAt)?data.createdAt.toDate().toISOString():null,
          status:['pending_payment','meetup_pending','meetup_confirmed','meetup_completed','paid','label_created','shipped','delivered','completed',
            'return_requested','delivery_failed','lost','cancelled','disputed','refund_in_progress','refund_action_required','refunded'].includes(data.status)?data.status:'unknown',
          payment:{state:neutralized?'neutralization_observed':intention?.protocol==='server_manual_v1'?'unknown':
            paymentReferenceQualification==='native_reference_present'?'legacy_exposure_requires_review':'unknown',
            externalConfirmationPrevented:neutralized,providerStatus:neutralized?'canceled':'unknown',currentProviderStateVerified:false},
          purchase:{paymentReferenceQualification,totalCents,walletCents,currency:data.currency==='CAD'?'CAD':null},
          selectedInDecision:selected,newNativeReviewRequired:!selected||!currentReferenceUsable,
          checkoutReference:checkoutIdQualified?{transactionId:order.snap.id,relationshipReference:r}:null,
          coverage:'native_pair_row_only',paymentPermissionGranted:false,externalExposureExhaustivelyResolved:false});continue;
      }
      const payment=paymentReview.orders.find(v=>v.order.id===order.snap.id)!;
      const top=data.cashTopUp,payer=top?.payerId,base=top?.amount;
      const topQualified=Number.isSafeInteger(base)&&base>0&&parties.includes(payer);
      const intention=(await tx.get(order.snap.ref.collection('topup_checkout').doc('current'))).data();
      const providerStatus=payment.state==='neutralization_observed'?'canceled':payment.state==='native_manual_protocol_recorded'&&
        ['requires_payment_method','requires_confirmation','requires_action','processing','succeeded','requires_capture','canceled'].includes(intention?.provider?.status)?intention!.provider.status:'unknown';
      let checkoutIdQualified=true;try{supportId(order.snap.id);}catch{checkoutIdQualified=false;}
      rows.push({...(v2?{kind:'swap',id:order.snap.id}:{}),swapId:order.snap.id,source:{revision:order.reference.revision,sourceHash:order.reference.sourceHash,
        originQualification:order.reference.originQualification,originHash:order.reference.originHash},
        direction,createdAt:native(data.createdAt)?data.createdAt.toDate().toISOString():null,acceptedAt:native(data.acceptedAt)?data.acceptedAt.toDate().toISOString():null,
        status:['proposed','payment_pending','accepted','photos_pending','shipping','completed','cancelled','declined','expired','disputed'].includes(data.status)?data.status:'unknown',
        topUp:{qualification:topQualified?'native_declared':'unknown',baseCents:topQualified?base:null,
          payerRole:topQualified?(payer===parties[0]?'first_party':'second_party'):null,
          paymentReferenceQualification:typeof data.topUpPaymentIntentId==='string'&&/^pi_[A-Za-z0-9]+$/.test(data.topUpPaymentIntentId)?'native_reference_present':
            data.topUpPaymentIntentId==null?'reference_absent_outcome_unknown':'malformed_reference_unknown'},
        payment:{...payment,providerStatus,currentProviderStateVerified:false},
        selectedInDecision:selected,newNativeReviewRequired:!selected||!currentReferenceUsable,
        checkoutReference:checkoutIdQualified?{swapId:order.snap.id,relationshipReference:r}:null,
        coverage:'native_pair_row_only',paymentPermissionGranted:false,externalExposureExhaustivelyResolved:false});
    }
    const hasMore=page.size>20,nextCursor=hasMore?{...(v2?{kind}:{}),direction,lastId:inspected.at(-1)!.id,sourceHash}:
      first?{...(v2?{kind}:{}),direction:'second_to_first',lastId:null,sourceHash}:
        v2&&purchase?{kind:'swap',direction:'first_to_second',lastId:null,sourceHash}:null;
    return {protocol:v2?'account_relationship_legacy_inventory_v2':'account_relationship_legacy_inventory_v1',actorId:uid,scope:'admin',decisionReference:r,
      source:{sourceHash,pairRevision:supportRevision(rootSnap),pairVersion:rootQualified?root!.version:null,
        qualification:rootQualified?'native_pair_current':'historical_pair_current_unknown'},
      readAt:page.readTime.toDate().toISOString(),rows,nextCursor,
      coverage:{...(v2?{kind,exhaustivePairPurchaseHistoryVerified:false}:{}),direction,inspected:inspected.length,limit:20,hasMoreInDirection:hasMore,directionTailReached:!hasMore,
        resumedAfterId:cursor?.lastId??null,snapshotConsistencyVerified:false,exhaustivePairSwapHistoryVerified:false,
        missingHistoricalPartyFields:'unknown',orphanProviderIntents:'unknown',providerQueriesPerformed:false},
      ...(v2?{selectedDecisionChangesRequiredForOtherOrders:true}:{}),selectedDecisionChangesRequiredForOtherSwaps:true,currentPermissionsGranted:false,...effects};
  });
}
export type AccountRelationshipInventoryPage=Awaited<ReturnType<typeof readRelationshipLegacyInventory>>;
export async function handleAccountRelationshipReview(request:any,endpoint:'owner'|'admin'|'read') {
  if(endpoint==='read'&&['purchase_legacy_preview','purchase_legacy_observe'].includes(request.data?.operation)){
    const {readRelationshipPurchaseRetirement}=await import('./stripeCheckout');return readRelationshipPurchaseRetirement(request);
  }
  if(endpoint==='read'&&request.data?.operation==='legacy_inventory')return readRelationshipLegacyInventory(request);
  const uid=supportUid(request),raw=supportObject(request.data,['capability','expectedUid','operation','scope','context','cursor','decisionReference','requestId','mode','command']);
  if(raw.capability!==ACCOUNT_RELATIONSHIP_CAPABILITY)throw new HttpsError('invalid-argument','Version explicite de l’examen requise.');
  if(endpoint!=='read') {
    const c=commandInput(raw.command),rid=supportRequestId(raw.requestId),ref=receiptRef(c.context.supportRequestId,uid,rid);
    if(c.scope!==(endpoint==='admin'?'admin':'own')||!['execute','observe','neutralize'].includes(raw.mode))throw new HttpsError('invalid-argument','Portée et mode explicites requis.');
    if(raw.mode==='execute'&&ACCOUNT_RELATIONSHIP_ENABLED&&!(await ref.get()).exists)await checkRateLimit(uid,true,
      {functionName:endpoint==='admin'?'adminAccountRelationship':'contestAccountRelationship',maxCallsAuthenticated:endpoint==='admin'?30:10,maxCallsUnauthenticated:0,windowMs:60000});
    return db.runTransaction(async tx=>{
      const prior=(await tx.get(ref)).data();if(prior){if(prior.protocol!=='account_relationship_command_v1'||prior.actorId!==uid||prior.requestId!==rid||
        prior.payloadHash!==supportHash(c)||supportHash(prior.command)!==supportHash(c)||!['committed','not_executed'].includes(prior.state)||!native(prior.recordedAt))throw new HttpsError('already-exists','Intention différente ou inconnue.');
        if(prior.state==='committed'&&!await proof(tx,referenceInput(prior.reference)))throw new HttpsError('unavailable','Preuve historique à rapprocher.');return view(uid,rid,c,prior);}
      if(raw.mode==='observe')return view(uid,rid,c);
      const now=Timestamp.now(),refuse=(reason:string)=>{const record={protocol:'account_relationship_command_v1',actorId:uid,requestId:rid,command:c,payloadHash:supportHash(c),state:'not_executed',reason,reference:null,recordedAt:now};tx.create(ref,record);return view(uid,rid,c,record);};
      if(raw.mode==='neutralize')return refuse('requester_neutralized');
      if(!ACCOUNT_RELATIONSHIP_ENABLED)return refuse('account_relationship_review_not_exposed');
      await currentActor(tx,request,endpoint==='admin');
      const s=await sources(tx,c.context);if(!s||!s.parties.includes(uid)&&endpoint==='owner')return refuse('native_sources_unknown');
      if(!s.rootQualified||!s.ticketNative||c.source.pairId!==s.pid||c.source.sourceHash!==s.sourceHash||c.source.version!==s.capture.version)return refuse('source_changed');
      if(endpoint==='admin'&&(!s.complete||c.partyMessages.some(m=>!s.parties.includes(m.userId))))return refuse('native_sources_unknown');
      const related=c.decisionReference?await proof(tx,c.decisionReference):null;
      if(c.action==='contest'&&(!related||related.command.scope!=='admin'||related.pairId!==s.pid||!related.parties.includes(uid)||
        supportHash(related.command.context)!==supportHash(c.context)))return refuse('decision_reference_unqualified');
      const version=s.capture.version!+1;if(!Number.isSafeInteger(version)||version>Number.MAX_SAFE_INTEGER-1)return refuse('native_sources_unknown');
      const id=eid(uid,rid),document={protocol:'account_relationship_entry_v1',entryId:id,pairId:s.pid,parties:s.parties,version,actorId:uid,requestId:rid,
        command:c,sourceCapture:s.capture,recordedAt:now,authority:endpoint==='admin'?{actorId:uid,authTime:request.auth.token.auth_time,privateRoleQualified:true}:null,...effects};
      const reference={pairId:s.pid,id,contentHash:supportSourceHash(document),version},entry=entryRef(reference),noticesReady=await prepareOperationalNotices(tx,notices(document));
      if((await tx.get(entry)).exists)return refuse('entry_without_receipt');
      const orderReviews={...(s.root?.orderReviews??{})};
      if(c.orderAction!=='retain_current')for(const o of c.context.orders)orderReviews[orderKey(o)]={order:o,blocked:c.orderAction==='retain_release_review',reference};
      if(Object.keys(orderReviews).length>100||Buffer.byteLength(JSON.stringify(orderReviews),'utf8')>250000)return refuse('pair_order_coverage_exceeded');
      const root={protocol:'account_relationship_pair_v1',pairId:s.pid,parties:s.parties,version,
        pairRestriction:c.pairAction==='retain_current'?s.root?.pairRestriction??null:{blocked:c.pairAction==='restrict_new_engagements',reference},
        orderReviews,reviewRequested:c.action==='contest',currentReference:reference,updatedAt:now};
      const alert=db.collection('admin_alerts').doc(`account_relationship_${id}`);
      if((await tx.get(alert)).exists)return refuse('entry_without_receipt');
      tx.set(pairRef(s.pid),root);tx.create(entry,{protocol:document.protocol,document,contentHash:reference.contentHash});
      tx.create(alert,{type:'account_relationship_review',severity:'info',supportRequestId:c.context.supportRequestId,pairId:s.pid,entryId:id,createdAt:now,
        message:c.action==='contest'?'Contestation à réexaminer sur une version exacte.':'Examen humain enregistré, sans constat automatique de fraude.'});
      const record={protocol:'account_relationship_command_v1',actorId:uid,requestId:rid,command:c,payloadHash:supportHash(c),state:'committed',reason:null,reference,recordedAt:now,notificationIds:noticesReady.notificationIds};
      tx.create(ref,record);noticesReady.commit();return view(uid,rid,c,record);
    });
  }
  if(!['own','admin'].includes(raw.scope)||!['preview','history'].includes(raw.operation))throw new HttpsError('invalid-argument','Lecture native requise.');
  if(!ACCOUNT_RELATIONSHIP_ENABLED)throw new HttpsError('failed-precondition','Examen des relations en préparation.',{reason:'account_relationship_review_not_exposed'});
  const suppliedContext=raw.context===undefined?null:contextInput(raw.context),admin=raw.scope==='admin',selected=raw.decisionReference===undefined?null:referenceInput(raw.decisionReference);
  if(!suppliedContext&&!selected)throw new HttpsError('invalid-argument','Contexte sélectionné ou référence native adressée requise.');
  return db.runTransaction(async tx=>{
    if(admin)await currentActor(tx,request,true);
    const selectedEntry=selected?await proof(tx,selected):null;
    if(selected&&(!selectedEntry||!admin&&!selectedEntry.parties.includes(uid)))throw new HttpsError('permission-denied','Référence personnelle non qualifiée.');
    // A native notice reference can resolve its immutable context without
    // allowing an owner to enumerate a third party's ticket or UID.
    const context=suppliedContext??selectedEntry!.command.context as Context;
    if(selectedEntry&&supportHash(selectedEntry.command.context)!==supportHash(context))throw new HttpsError('permission-denied','Contexte différent de la référence native.');
    const s=await sources(tx,context);
    if(!s&&selectedEntry)return {protocol:'account_relationship_preview_v1',actorId:uid,scope:raw.scope,context,
      source:{sourceHash:null,pairId:selectedEntry.pairId,version:null,qualification:'unknown'},ticket:null,accounts:null,orders:[],
      ...(admin?{pairRestriction:null,orderReviews:{}}:{}),ownScopes:null,canRecordReview:false,canContest:false,
      selectedDecision:entryView(selectedEntry,uid,admin),legacyPaymentReview:emptyLegacyPaymentReview(),entries:[],nextCursor:null,coverage:{inspected:0,limit:20,hasMore:null,exhaustiveHistoryVerified:false},
      statement:'La décision historique est qualifiée ; ses sources actuelles restent à rapprocher.',...effects};
    if(!s||!admin&&!s.parties.includes(uid)||selectedEntry&&selectedEntry.pairId!==s.pid||!admin&&s.ticket.ownerId!==uid&&!selectedEntry)
      throw new HttpsError('permission-denied','Référence personnelle non qualifiée.');
    let entries:any[]=[],nextCursor:any=null,coverage:any=null;
    if(raw.operation==='history'){
      const cursor=raw.cursor==null?null:documentCursor(supportObject(raw.cursor,['lastId']).lastId);let q:FirebaseFirestore.Query=pairRef(s.pid).collection('entries').orderBy('__name__').limit(21);if(cursor)q=q.startAfter(cursor);
      const page=await tx.get(q),inspected=page.docs.slice(0,20);
      for(const row of inspected){const v=row.data(),d=v.document;const p=hash(v.contentHash)&&Number.isSafeInteger(d?.version)?await proof(tx,{pairId:s.pid,id:row.id,contentHash:v.contentHash,version:d.version}):null;
        if(p&&!admin&&!p.parties.includes(uid))continue;entries.push(p?{qualification:'native_relationship_entry',entry:entryView(p,uid,admin)}:{qualification:'unknown',entryId:row.id,entry:null});}
      nextCursor=page.size>20?{lastId:inspected.at(-1)!.id}:null;coverage={inspected:inspected.length,limit:20,hasMore:page.size>20,exhaustiveHistoryVerified:false};
    }
    const ownOrders=s.orders.filter(o=>o.uids.includes(uid)).map(o=>o.reference);
    return {protocol:'account_relationship_preview_v1',actorId:uid,scope:raw.scope,context,
      source:{sourceHash:s.sourceHash,pairId:s.pid,version:s.capture.version,qualification:s.complete?'native_current':'unknown'},
      ticket:admin?projectSupportConfidential({id:context.supportRequestId,version:s.ticket.version,receivedAt:new Date(s.ticket.receivedAtMs).toISOString(),narrative:s.ticket.narrative},s.ticket):null,
      accounts:admin?s.capture.accounts:null,orders:admin?s.capture.orders:ownOrders,
      ...(admin?{pairRestriction:s.root?.pairRestriction??null,orderReviews:s.root?.orderReviews??{}}:{}),
      ownScopes:admin?null:{newEngagements:!s.rootQualified?'unknown':s.root?.pairRestriction?.blocked===true?'restricted_by_review':'no_own_restriction',
        orderReleaseReviews:ownOrders.map(o=>({order:{kind:o.kind,id:o.id},state:!s.rootQualified?'unknown':
          s.root?.orderReviews?.[orderKey(o)]?.blocked===true?'retained_for_review':'no_own_review'})),currentPermissionsGranted:false},
      canRecordReview:admin&&s.complete,canContest:!admin&&selectedEntry?.command.scope==='admin'&&s.rootQualified&&s.ticketNative,
      selectedDecision:selectedEntry?entryView(selectedEntry,uid,admin):null,legacyPaymentReview:s.capture.legacyPaymentReview,entries,nextCursor,coverage,
      statement:'Un lien entre comptes a été examiné. Cela ne confirme ni une identité commune ni une fraude.',...effects};
  });
}
