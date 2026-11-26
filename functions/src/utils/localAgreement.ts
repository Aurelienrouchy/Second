/** Local agreements carry no platform money. This proof cannot qualify a
 * restored balance, provider payment or a later conversion to a paid rail. */
import {AsyncLocalStorage} from 'node:async_hooks';
import {createHash} from 'node:crypto';
import {FieldValue, Timestamp} from 'firebase-admin/firestore';
import {HttpsError} from 'firebase-functions/v2/https';
import {cashAmountsRemainUnfinanced, qualifiedCashAgreement,cashReservationWasReleased} from './cashMeetupContract';
import {privacyMarker} from './articlePrivacyContract';
import {swapProofObject} from './swapProofMedia';

type Data = FirebaseFirestore.DocumentData;
export type LocalAgreementDomain = 'purchase' | 'swap';
export type LocalAgreementWitness = {protocol:'local_agreement_source_v1'; installationId:string; epoch:string;
  ref:string; nativeSourceHash:string; financialSettlement:'not_asserted'};
type LocalControl = {installationId:string; epoch:string};
type LocalScope = {operation:string; control:LocalControl|null};
const scopes = new AsyncLocalStorage<LocalScope>();
const roots = ['articles','inventory_units','users','eligibility_audit','eligibility_profiles','automatic_decisions_log',
  'messages','chats','meetup_offer_threads','meetup_offer_requests','operational_notice_receipts','notifications',
  'swapParties','swapPartyItems','avis'];
const operations:Record<string,readonly string[]> = {
  'callable/offers.sendMeetupProposal': roots,
  'callable/offers.rejectMeetupProposal': roots,
  'callable/payments/meetup.acceptMeetupOffer': [...roots,'transactions'],
  'callable/payments/meetup.confirmMeetupTransaction': [...roots,'transactions'],
  'callable/payments/meetup.completeMeetupTransaction': [...roots,'transactions'],
  'callable/payments/meetup.reportMeetupNoShow': [...roots,'transactions','disputes'],
  'callable/payments/disputes.closeMeetupNoShow': [...roots,'transactions','disputes'],
  'callable/payments/disputes.cancelPendingTransaction': [...roots,'transactions'],
  'callable/payments/disputes.sellerCancelTransaction': [...roots,'transactions'],
  'callable/swaps.ensureGeneralistZone': roots,
  'callable/swaps.getActiveSwapPartyInfo': roots,
  'callable/swaps.proposeMultiSwap': [...roots,'swaps'],
  'callable/swaps.acceptSwap': [...roots,'swaps'],
  'callable/swaps.declineSwap': [...roots,'swaps'],
  'callable/swaps.cancelSwap': [...roots,'swaps'],
  'callable/swaps.setSwapExchangeMode': [...roots,'swaps'],
  'callable/swaps.uploadSwapPhotos': ['swaps'],
  'callable/swaps.confirmSwapShipping': ['swaps'],
  'callable/swaps.confirmSwapReception': [...roots,'swaps'],
  'callable/swaps.rateSwap': [...roots,'swaps'],
  'callable/swaps.openSwapDispute': ['swaps'],
  'callable/swaps.addItemToPartySecure': roots,
  'callable/swaps.removeItemFromPartySecure': roots,
  'callable/reviews.createReview': roots,
  'scheduled/swaps.expireStaleProposedSwaps': [...roots,'swaps'],
  'scheduled/offerExpiration.expirePhase1LocalOffers':['messages'],
};
export function localOperationAllows(operation:string, ref?:string):boolean {
  const allowed=operations[operation];
  if(!allowed)return false;
  if(ref===undefined)return true;
  const parts=ref.split('/');
  if(operation==='callable/payments/disputes.closeMeetupNoShow'&&parts.length===4&&parts[0]==='transactions'&&parts[2]==='dispute_decisions')return !!parts[1]&&/^(cash_preview_)?[a-f0-9]{64}$/.test(parts[3]);
  return parts.length===2 && !!parts[1] && allowed.includes(parts[0]);
}
export function withLocalAgreementScope<T>(operation:string, fn:()=>Promise<T>):Promise<T> {
  if(process.env.FINANCIAL_RECOVERY_ENVIRONMENT!=='unconfigured'||!localOperationAllows(operation))return fn();
  return scopes.run({operation,control:null},fn);
}
export function activeLocalAgreementScope():LocalScope|null {return scopes.getStore()??null;}
export function bindLocalAgreementControl(control:LocalControl):void {
  const scope=scopes.getStore();if(scope)scope.control={installationId:control.installationId,epoch:control.epoch};
}
const blocked=():never=>{throw new HttpsError('failed-precondition','Cet accord doit être qualifié avant toute nouvelle opération.',
  {reason:'local_agreement_unqualified',financialSettlement:'not_asserted'});};
const id=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,200}$/.test(value);
const time=(value:unknown)=>value instanceof Timestamp && value.toMillis()>0 && value.toMillis()<=Date.now()+60000 ||
  value instanceof FieldValue && value.isEqual(FieldValue.serverTimestamp());
/** Materialize only server-produced local agreement patches. Their exact native
 * dates can then be hashed before commit instead of treating any date as equal. */
export function localServerTimestamps(value:any,now=Timestamp.now()):any {
  if(value instanceof FieldValue&&value.isEqual(FieldValue.serverTimestamp()))return now;
  if(value instanceof Timestamp||value instanceof FieldValue||value===null||typeof value!=='object')return value;
  if(Array.isArray(value))return value.map(v=>localServerTimestamps(v,now));
  if(![Object.prototype,null].includes(Object.getPrototypeOf(value)))return blocked();
  return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,localServerTimestamps(v,now)]));
}
function canonical(value:any,root=false):any {
  if(value instanceof Timestamp)return {nativeSeconds:value.seconds,nativeNanoseconds:value.nanoseconds};
  if(value instanceof FieldValue || value===undefined || typeof value==='number'&&!Number.isFinite(value))return blocked();
  if(Array.isArray(value))return value.map(v=>canonical(v));
  if(value&&typeof value==='object') {
    if(![Object.prototype,null].includes(Object.getPrototypeOf(value)))return blocked();
    // updatedAt alone is participant-writable under the existing rules and has
    // no business authority. Every identity and contractual date stays exact.
    return Object.fromEntries(Object.keys(value).filter(k=>!root||!['localAgreementWitness','updatedAt','articlePrivacyWithdrawal','articlePrivacyWithdrawals'].includes(k)).sort().map(k=>[k,canonical(value[k])]));
  }
  return value;
}
export function localAgreementSourceHash(domain:LocalAgreementDomain, ref:string, value:Data):string {
  return createHash('sha256').update(JSON.stringify(['local_agreement_native_source_v1',domain,ref,canonical(value,true)])).digest('hex');
}
const purchaseFields=new Set(('sellerActivityAdmission inventoryUnitCommitment articleId buyerId sellerId articleSnapshot amount shippingCost serviceFee '+
  'totalAmount sellerPayout deliveryType currency paidVia chatId offerMessageId meetupSpot cashAgreement status createdAt updatedAt '+
  'meetupConfirmedAt meetupConfirmedBy meetupConfirmationNotice meetupCompletedAt meetupCompletedBy meetupCompletionNotice completedAt '+
  'disputed statusBeforeDispute noShowReport disputedAt cashReservationRelease counterReport cashReservationReviewRequired meetupNoShowResolution '+
  'cancelledAt cancelledBy cancelReason localCancellation localAgreementWitness articlePrivacyWithdrawal').split(' '));
const swapFields=new Set(('sellerActivityAdmissions proposalRequestId proposalRequestHash inventoryReservationStage initiatorId initiatorName initiatorImage '+
  'initiatorItems initiatorTotalValue receiverId receiverName receiverImage receiverItems receiverTotalValue articleIds status articleDeclarationProposalVersion '+
  'articleDeclarationProposalRecordedAt swapLaunchPolicyVersion exchangeMode exchangeAgreement message cashTopUp partyId createdAt updatedAt '+
  'inventoryUnitCommitments acceptedAt declinedAt declinedBy cancelReason initiatorCancellation initiatorReceivedAt receiverReceivedAt completedAt '+
  'initiatorPhotos receiverPhotos initiatorShippedAt receiverShippedAt '+
  'initiatorRating receiverRating statusBeforeDispute disputeReason disputeOpenedBy disputeOpenedAt localAgreementWitness articlePrivacyWithdrawals').split(' '));
function identity(domain:LocalAgreementDomain,value:Data):unknown {
  return domain==='purchase'?[value.buyerId,value.sellerId,value.articleId,value.chatId,value.offerMessageId,value.cashAgreement?.agreementId]:
    [value.initiatorId,value.receiverId,value.proposalRequestId,value.proposalRequestHash,value.exchangeAgreement?.sourceHash];
}
/** A postal handover is a member declaration, never a label/provider proof. */
function memberPhotoProof(value:any, ownerId:string, swapId:string, acceptedAt:unknown):boolean {
  if(!value||typeof value!=='object'||Array.isArray(value)||
      Object.keys(value).sort().join(',')!=='isValidated,objects,photos,uploadedAt,userId'||value.userId!==ownerId||value.isValidated!==false||
      !time(value.uploadedAt)||!(acceptedAt instanceof Timestamp)||!(value.uploadedAt instanceof Timestamp)||
      value.uploadedAt.toMillis()<acceptedAt.toMillis()||!Array.isArray(value.photos)||!value.photos.length||value.photos.length>10||!Array.isArray(value.objects)||value.objects.length!==value.photos.length)return false;
  return new Set(value.photos).size===value.photos.length&&value.photos.every((url:unknown,index:number)=>{
    if(typeof url!=='string')return false;
    try {
      const parsed=new URL(url),emulator=process.env.FIREBASE_STORAGE_EMULATOR_HOST;
      if(parsed.username||parsed.password||!(parsed.protocol==='https:'&&parsed.hostname==='firebasestorage.googleapis.com'||
          parsed.protocol==='http:'&&emulator&&parsed.host===emulator))return false;
      const marker='/o/',markerIndex=parsed.pathname.indexOf(marker);
      if(markerIndex<0)return false;
      const path=decodeURIComponent(parsed.pathname.slice(markerIndex+marker.length)),parts=path.split('/');
      return parts.length===5&&parts[0]==='swaps'&&parts[1]===swapId&&parts[2]==='photos'&&parts[3]===ownerId&&
        !!parts[4]&&!['.','..'].includes(parts[4])&&swapProofObject(value.objects[index],swapId,ownerId)&&value.objects[index].path===path;
    }catch{return false;}
  });
}
function postalDeclarationsQualify(ref:string,value:Data):boolean {
  const id=ref.split('/')[1],photos=['initiatorPhotos','receiverPhotos'] as const,shipped=['initiatorShippedAt','receiverShippedAt'] as const;
  for(let i=0;i<2;i++) {
    const owner=i===0?value.initiatorId:value.receiverId;
    if(Object.prototype.hasOwnProperty.call(value,photos[i])&&!memberPhotoProof(value[photos[i]],owner,id,value.acceptedAt))return false;
    if(Object.prototype.hasOwnProperty.call(value,shipped[i])&&(!(value[shipped[i]] instanceof Timestamp)||
        !time(value[shipped[i]])||!value.initiatorPhotos||!value.receiverPhotos||
        value[shipped[i]].toMillis()<value[photos[i]].uploadedAt.toMillis()))return false;
  }
  if(['photos_pending','shipping','completed'].includes(value.status)&&!(value.acceptedAt instanceof Timestamp))return false;
  if(value.exchangeMode!=='shipping')return !shipped.some(key=>Object.prototype.hasOwnProperty.call(value,key));
  if(value.status==='accepted')return false;
  if(['shipping','completed'].includes(value.status)&&!photos.every(key=>value[key]))return false;
  for(const [received,sent]of [['initiatorReceivedAt','receiverShippedAt'],['receiverReceivedAt','initiatorShippedAt']]) {
    if(Object.prototype.hasOwnProperty.call(value,received)&&(!(value[received] instanceof Timestamp)||!(value[sent] instanceof Timestamp)||
      value[received].toMillis()<value[sent].toMillis()))return false;
  }
  return value.status!=='completed'||['initiatorReceivedAt','receiverReceivedAt',...shipped].every(key=>value[key] instanceof Timestamp);
}
export function localAgreementShape(domain:LocalAgreementDomain, ref:string,value:Data|undefined):boolean {
  if(!value || !new RegExp(`^${domain==='purchase'?'transactions':'swaps'}/[A-Za-z0-9_-]{1,200}$`).test(ref))return false;
  const allowed=domain==='purchase'?purchaseFields:swapFields;
  if(Object.keys(value).some(key=>!allowed.has(key)))return false;
  if(domain==='purchase'&&Object.prototype.hasOwnProperty.call(value,'articlePrivacyWithdrawal')&&!privacyMarker(value.articlePrivacyWithdrawal,value.articleId))return false;
  if(domain==='swap'&&Object.prototype.hasOwnProperty.call(value,'articlePrivacyWithdrawals')){
    const markers=value.articlePrivacyWithdrawals;
    if(!markers||typeof markers!=='object'||Array.isArray(markers)||Object.entries(markers).some(([articleId,marker])=>
      !value.articleIds?.includes(articleId)||!privacyMarker(marker,articleId)))return false;
  }
  if(domain==='purchase') {
    if(!id(value.buyerId)||!id(value.sellerId)||value.buyerId===value.sellerId||value.currency!=='CAD'||value.paidVia!=='cash'||
        !['meetup_pending','meetup_confirmed','meetup_completed','disputed','cancelled'].includes(value.status)||!cashAmountsRemainUnfinanced(value)||
        !time(value.cashAgreement?.acceptedAt))return false;
    if(!qualifiedCashAgreement(ref.split('/')[1],value))return false;
    if(value.status==='disputed')return cashReservationWasReleased(ref.split('/')[1],value);
    if(value.status==='cancelled'&&!cashReservationWasReleased(ref.split('/')[1],value)) {
      const c=value.localCancellation;
      return c?.protocol==='local_cash_cancellation_v1'&&c.transactionId===ref.split('/')[1]&&c.agreementId===value.cashAgreement.agreementId&&
        [value.buyerId,value.sellerId].includes(c.actorUid)&&c.moneyMoved===false&&c.platformMoneyObligationCents===0&&time(c.cancelledAt)&&
        value.cancelledBy===c.actorUid&&value.cancelledAt instanceof Timestamp&&value.cancelledAt.isEqual(c.cancelledAt);
    }
    return true;
  }
  return id(value.initiatorId)&&id(value.receiverId)&&value.initiatorId!==value.receiverId && value.cashTopUp===null &&
    ['hand_delivery','shipping'].includes(value.exchangeMode) && value.exchangeAgreement?.protocol==='swap_exchange_agreement_v1' &&
    value.exchangeAgreement.scope==='new_proposal' && value.exchangeAgreement.exchangeMode===value.exchangeMode &&postalDeclarationsQualify(ref,value)&&
    /^[a-f0-9]{64}$/.test(value.exchangeAgreement.sourceHash??'') && id(value.proposalRequestId) &&
    /^[a-f0-9]{64}$/.test(value.proposalRequestHash??'') && ['proposed','accepted','photos_pending','shipping','completed','declined','cancelled','disputed'].includes(value.status)&&
    (!['statusBeforeDispute','disputeReason','disputeOpenedBy','disputeOpenedAt'].some(k=>Object.prototype.hasOwnProperty.call(value,k))||value.status==='disputed')&&
    (value.status!=='disputed'||['accepted','photos_pending','shipping','completed'].includes(value.statusBeforeDispute)&&
      [value.initiatorId,value.receiverId].includes(value.disputeOpenedBy)&&typeof value.disputeReason==='string'&&
      value.disputeReason.trim().length>0&&value.disputeReason.length<=1000&&time(value.disputeOpenedAt)&&
      value.acceptedAt instanceof Timestamp&&value.disputeOpenedAt instanceof Timestamp&&value.disputeOpenedAt.toMillis()>=value.acceptedAt.toMillis());
}
function exactLocalSwapDispute(before:Data|undefined,after:Data):void{
  if(!before||!['accepted','photos_pending','shipping','completed'].includes(before.status)||after.status!=='disputed'||after.statusBeforeDispute!==before.status||
    ['statusBeforeDispute','disputeReason','disputeOpenedBy','disputeOpenedAt'].some(k=>Object.prototype.hasOwnProperty.call(before,k)))return blocked();
  const stable=(v:Data)=>Object.fromEntries(Object.entries(v).filter(([k])=>!['status','statusBeforeDispute','disputeReason','disputeOpenedBy','disputeOpenedAt'].includes(k)));
  if(JSON.stringify(canonical(stable(before),true))!==JSON.stringify(canonical(stable(after),true)))return blocked();
}
function exactPostalDeclaration(operation:string,before:Data|undefined,after:Data):void {
  const photos=operation==='callable/swaps.uploadSwapPhotos',shipping=operation==='callable/swaps.confirmSwapShipping';
  if(!photos&&!shipping)return;
  if(!before||before.status!==(photos?'photos_pending':'shipping'))return blocked();
  const fields=photos?['initiatorPhotos','receiverPhotos']:['initiatorShippedAt','receiverShippedAt'];
  const changed=fields.filter(key=>JSON.stringify(canonical(before[key]??null))!==JSON.stringify(canonical(after[key]??null)));
  if(changed.length!==1||before[changed[0]]!=null||after[changed[0]]==null)return blocked();
  const mutable=new Set([...fields,'updatedAt','localAgreementWitness',...(photos?['status']:[])]);
  const stable=(value:Data)=>Object.fromEntries(Object.entries(value).filter(([key])=>!mutable.has(key)));
  if(JSON.stringify(canonical(stable(before),true))!==JSON.stringify(canonical(stable(after),true)))return blocked();
  if(photos&&after.status!==(after.initiatorPhotos&&after.receiverPhotos?'shipping':'photos_pending'))return blocked();
  if(shipping&&(before.exchangeMode!=='shipping'||after.status!==before.status))return blocked();
}
export function localAgreementWitnessMatches(domain:LocalAgreementDomain, ref:string,value:Data,control:LocalControl):boolean {
  const witness=value.localAgreementWitness;
  return localAgreementShape(domain,ref,value)&&witness?.protocol==='local_agreement_source_v1'&&
    Object.keys(witness).sort().join(',')==='epoch,financialSettlement,installationId,nativeSourceHash,protocol,ref'&&
    witness.installationId===control.installationId&&witness.epoch===control.epoch&&witness.ref===ref&&
    witness.financialSettlement==='not_asserted'&&witness.nativeSourceHash===localAgreementSourceHash(domain,ref,value);
}
/** Existing records need their exact local witness; absence of Stripe fields
 * is not an adoption/reconciliation of an old or restored source. */
export function localAgreementFields(domain:LocalAgreementDomain,ref:string,before:Data|undefined,after:Data,provedAbsent:boolean):LocalAgreementWitness {
  const scope=scopes.getStore();
  if(!scope?.control||!localOperationAllows(scope.operation,ref)||!localAgreementShape(domain,ref,after)||
      (before ? !localAgreementWitnessMatches(domain,ref,before,scope.control)||JSON.stringify(identity(domain,before))!==JSON.stringify(identity(domain,after)) : !provedAbsent))return blocked();
  if(scope.operation==='callable/swaps.openSwapDispute')exactLocalSwapDispute(before,after);
  exactPostalDeclaration(scope.operation,before,after);
  return {protocol:'local_agreement_source_v1',...scope.control,ref,nativeSourceHash:localAgreementSourceHash(domain,ref,after),financialSettlement:'not_asserted'};
}
/** The native adapter independently rereads both states, including merged
 * patches. A raw write, erased paid history or missing witness cannot pass. */
export function assertLocalAgreementMutation(domain:LocalAgreementDomain,ref:string,before:Data|undefined,after:Data|undefined):void {
  if(!after)return blocked();
  const scope=scopes.getStore();
  if(!scope?.control||!localOperationAllows(scope.operation,ref)||!localAgreementWitnessMatches(domain,ref,after,scope.control)||
      before&&(!localAgreementWitnessMatches(domain,ref,before,scope.control)||JSON.stringify(identity(domain,before))!==JSON.stringify(identity(domain,after))))return blocked();
  if(scope.operation==='callable/swaps.openSwapDispute')exactLocalSwapDispute(before,after);
  exactPostalDeclaration(scope.operation,before,after);
}
export function assertLocalAgreementReadable(domain:LocalAgreementDomain,ref:string,value:Data):void {
  const scope=scopes.getStore();
  if(!scope?.control||!localAgreementWitnessMatches(domain,ref,value,scope.control))return blocked();
}

const caseFields=new Set(('transactionId type buyerId sellerId articleId articleTitle reportedBy reportedAgainst reason details status '+
  'statusBeforeDispute createdAt cashAgreementId reservationReleaseId counterReportedBy counterReason counterDetails counterReportedAt '+
  'resolution resolvedBy resolvedAt resolutionDecisionId resolutionNote localAgreementWitness').split(' '));
/** A documentary absence case is qualified only by its exact native released
 * cash parent. This never admits a financial dispute or invents a paid source. */
export function localCashCaseFields(ref:string,before:Data|undefined,after:Data,parent:Data):Omit<LocalAgreementWitness,'protocol'>&{protocol:'local_cash_case_v1'} {
  const scope=scopes.getStore();
  const parentRef='transactions/'+after.transactionId;
  if(!scope?.control||!localOperationAllows(scope.operation,ref)||!localAgreementWitnessMatches('purchase',parentRef,parent,scope.control)||
      !cashReservationWasReleased(after.transactionId,parent)||parent.noShowReport?.disputeId!==ref.split('/')[1]||
      Object.keys(after).some(k=>!caseFields.has(k))||after.type!=='meetup_no_show'||!['open','resolved'].includes(after.status)||
      after.cashAgreementId!==parent.cashAgreement.agreementId||after.reservationReleaseId!==parent.cashReservationRelease.releaseId||
      after.buyerId!==parent.buyerId||after.sellerId!==parent.sellerId||after.articleId!==parent.articleId||
      after.reportedBy!==parent.noShowReport.reportedBy||after.reportedAgainst!==parent.noShowReport.reportedAgainst||
      after.reason!==parent.noShowReport.reason||(after.details??null)!==(parent.noShowReport.details??null)||
      !(after.createdAt instanceof Timestamp)||!after.createdAt.isEqual(parent.noShowReport.reportedAt))return blocked();
  const hash=(row:Data)=>createHash('sha256').update(JSON.stringify(['local_cash_case_v1',ref,canonical(row,true)])).digest('hex');
  if(before&&(before.localAgreementWitness?.protocol!=='local_cash_case_v1'||before.localAgreementWitness.installationId!==scope.control.installationId||
      before.localAgreementWitness.epoch!==scope.control.epoch||before.localAgreementWitness.ref!==ref||before.localAgreementWitness.financialSettlement!=='not_asserted'||
      Object.keys(before.localAgreementWitness).sort().join(',')!=='epoch,financialSettlement,installationId,nativeSourceHash,protocol,ref'||
      before.localAgreementWitness.nativeSourceHash!==hash(before)||
      [before.transactionId,before.buyerId,before.sellerId,before.cashAgreementId,before.reservationReleaseId].join('|')!==
        [after.transactionId,after.buyerId,after.sellerId,after.cashAgreementId,after.reservationReleaseId].join('|')))return blocked();
  if('counterReportedBy' in after&&(!parent.counterReport||after.counterReportedBy!==parent.counterReport.reportedBy||
      after.counterReason!==parent.counterReport.reason||(after.counterDetails??null)!==(parent.counterReport.details??null)||
      !(after.counterReportedAt instanceof Timestamp)||!after.counterReportedAt.isEqual(parent.counterReport.reportedAt)))return blocked();
  if(after.status==='resolved'&&(scope.operation!=='callable/payments/disputes.closeMeetupNoShow'||after.resolution!=='buyer_upheld'||
      !id(after.resolvedBy)||!time(after.resolvedAt)||!/^[a-f0-9]{64}$/.test(after.resolutionDecisionId??'')))return blocked();
  return {protocol:'local_cash_case_v1',...scope.control,ref,nativeSourceHash:hash(after),financialSettlement:'not_asserted'};
}
export function assertLocalCashDecision(ref:string,before:Data|undefined,after:Data,parent:Data):void {
  const scope=scopes.getStore();
  if(!scope?.control||scope.operation!=='callable/payments/disputes.closeMeetupNoShow'||before||!localOperationAllows(scope.operation,ref)||
      !localAgreementWitnessMatches('purchase',`transactions/${ref.split('/')[1]}`,parent,scope.control)||
      !cashReservationWasReleased(ref.split('/')[1],parent)||after.transactionId!==ref.split('/')[1]||
      !(after.protocol==='cash_case_preview_v1'&&after.moneyMovementPlanned===false||after.kind==='cash_case_decision_v1'&&after.moneyMoved===false)||
      after.buyerId!==parent.buyerId||after.sellerId!==parent.sellerId||after.expectedDisputeId!==parent.noShowReport?.disputeId||
      Object.keys(after).some(k=>/stripe|wallet|ledger|payout|paymentIntent|refund/i.test(k)))return blocked();
}
