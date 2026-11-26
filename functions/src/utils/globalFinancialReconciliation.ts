/** Bounded documentary reconciliation. All money, native journals and financial
 * holds are read-only. Optional native readTime fixes reads of known sources;
 * it never certifies an exhaustive source set, drain or global balance. */
import {Timestamp} from 'firebase-admin/firestore';
import {randomUUID} from 'node:crypto';
import {HttpsError} from 'firebase-functions/v2/https';
import {db} from '../config/firebase';
import {supportUid,supportObject,supportRequestId,supportHash,supportSourceHash,supportAdmin} from './supportRequest';
import {assertPrivateAccountSession,withPrivateAccountSession} from './privateAccountSession';
import {assertRecentAccountAuthentication} from './eligibility';
import {nativePurchasePaymentSource,acceptedPurchaseTaxSnapshot,acceptedQuotePurchasePolicy} from './purchasePolicy';
import {inspectWalletInvariants} from './walletInvariantScan';
import {exactCents} from './shippingPurchaseRate';
import {qualifiedShopTierOperation,qualifiedShopTierSettlement} from '../callable/shopTier';
import {allocationLocalMovementsVerified,readAllocationHistoryIntent} from './refundAllocation';
import {readManualRefundDocuments} from './refundRepair';
import {qualifiedManualRefundSettlement,qualifiedManualCommand,manualId} from './manualRefundSettlement';
import {observeGlobalFinancialProviderPage,globalStripeId, type GlobalFinancialScope, type GlobalFinancialBoundary} from './globalFinancialProvider';
import {observeGlobalFinancialStatement} from './globalFinancialStatement';
import {globalControlBalanceEnabled,initialGlobalControlBalanceState,validGlobalControlBalanceState,globalControlBalanceView,
  prepareGlobalControlNativePage,prepareGlobalControlProviderPage,prepareGlobalControlAuditPage,type GlobalControlBalanceState} from './globalControlBalance';

type Data=FirebaseFirestore.DocumentData;
export const GLOBAL_FINANCIAL_RECONCILIATION_CAPABILITY='global_financial_reconciliation_v1';
export const GLOBAL_FINANCIAL_LIMITS={nativePageSize:10,providerPageSize:5,maxNativePages:2000,maxProviderPages:1000,maxAuditPages:2000,
  maxSources:20000,maxReferences:100000,maxPageBytes:450000,maxRunBytes:200000,maxClaimsPerReference:8,maxReadAttempts:5} as const;
const ROOTS=['transactions','swaps','withdrawal_requests','platform_ledger','eligibility_audit','wallets','admin_alerts','failed_operations'] as const;
const CHILDREN:Record<string,string[]>={transactions:['refund_allocations','refund_history','refund_repairs','refund_repair_commands'],swaps:['topup_refund','topup_release'],wallets:['ledger'],admin_alerts:['exceptional_commands','exceptional_evidence']};
const effects={financialEffectAuthorized:false,providerMutationAuthorized:false,holdReleaseAuthorized:false,globalBalanceReconciled:false,
  nativeSnapshotQualified:false,openingClosingQualified:false,bankArrivalVerified:false,taxPeriodQualified:false} as const;
const hash=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const integer=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v);
const cents=(v:unknown):v is number=>integer(v)&&v>=0;
const id=(v:unknown):v is string=>typeof v==='string'&&!!v&&v.length<=200&&!v.includes('/')&&!['.','..'].includes(v);
const native=(v:unknown):v is Timestamp=>v instanceof Timestamp&&v.toMillis()>0&&v.toMillis()<=Date.now();
const text=(v:unknown)=>typeof v==='string'&&v.length<=200?v:null;
const at=(v:unknown)=>native(v)?v.toDate().toISOString():null;
const own=(d:any,k:string)=>d!=null&&Object.prototype.hasOwnProperty.call(d,k);
const completeKnownSources=(s:GlobalFinancialScope)=>s.coverageMode==='complete_known_sources_v1';
const runRef=(rid:string)=>db.collection('admin_alerts').doc(rid);
const sub=(rid:string,name:string)=>runRef(rid).collection(name);
const sourceRef=(rid:string,path:string)=>sub(rid,'sources').doc(supportHash(path));
const linkRef=(rid:string,kind:string,providerId:string)=>sub(rid,'references').doc(supportHash([kind,providerId]));
type Link={kind:string;id:string};
type Claim={contract:string;kind:string;sourcePath:string;sourceHash:string;amountCents:number|null;paymentIntentId:string|null;chargeId:string|null;
  accountId:string|null;ownerId:string|null;localQualification:string;qualified:boolean;periodQualification:string;causalAt:string|null;causalEvent:string};
type Job={path:string;lastId:string|null};
type Run={protocol:string;actorId:string;requestId:string;scope:GlobalFinancialScope;scopeHash:string;version:number;state:string;phase:'native'|'provider'|'audit'|'statement'|'ready';
  rootIndex:number;lastId:string|null;queue:Job[];providerCursor:string|null;auditCursor:string|null;nativePages:number;providerPages:number;auditPages:number;
  sourceCount:number;referenceCount:number;providerCount:number;unknownCount:number;changedCount:number;nativeClosed:boolean;providerClosed:boolean;auditClosed:boolean;
  groups:Data[];lastPage:Data|null;createdAt:Timestamp;updatedAt:Timestamp;lease:Data|null;pendingCommand:Data|null;
  connectedOwnerId:string|null;auditStage:'sources'|'references';statement:Data|null;
  nativeCaptureFailure?:string|null;controlBalance?:GlobalControlBalanceState;
  epochQualification:'unknown';boundaryQualification:'declared_unverified'|'unknown'};

function boundary(value:any):GlobalFinancialBoundary{
  const v=supportObject(value,['balanceType','availableCents','pendingCents','evidenceReference']),r=supportObject(v.evidenceReference,['reference','contentHash']);
  if(!['payments','issuing','refund_and_dispute_prefunding','risk_reserved'].includes(v.balanceType)||!integer(v.availableCents)||!integer(v.pendingCents)||
    !integer(v.availableCents+v.pendingCents)||!id(r.reference)||!hash(r.contentHash))throw new HttpsError('invalid-argument','Borne documentaire explicite requise.');
  return {balanceType:v.balanceType,availableCents:v.availableCents,pendingCents:v.pendingCents,evidenceReference:{reference:r.reference,contentHash:r.contentHash}};
}
export function parseGlobalFinancialScope(raw:unknown):GlobalFinancialScope{
  const d=supportObject(raw,['accountKind','accountId','platformAccountId','livemode','currency','period','connectedReference','epoch','boundaries','statementReference','nativeCapture','coverageMode','controlBalanceMode']);
  const p=supportObject(d.period,['fromSeconds','toSeconds']);
  if(!['platform','connected'].includes(d.accountKind)||!globalStripeId(d.accountId,'acct')||!globalStripeId(d.platformAccountId,'acct')||typeof d.livemode!=='boolean'||d.currency!=='CAD'||
    !integer(p.fromSeconds)||p.fromSeconds<0||!integer(p.toSeconds)||p.toSeconds<=p.fromSeconds||p.toSeconds>Math.floor(Date.now()/1000)||
    d.accountKind==='platform'&&d.accountId!==d.platformAccountId||d.accountKind==='connected'&&d.accountId===d.platformAccountId)
    throw new HttpsError('invalid-argument','Compte, mode, devise et période UTC fermée explicites requis.');
  let connectedReference:GlobalFinancialScope['connectedReference']=null,epoch:GlobalFinancialScope['epoch']=null,boundaries:GlobalFinancialScope['boundaries']=null;
  if(d.connectedReference!==null){const c=supportObject(d.connectedReference,['kind','id']);if(!['withdrawal','current_account'].includes(c.kind)||!id(c.id))throw new HttpsError('invalid-argument','Source du compte connecté requise.');connectedReference={kind:c.kind,id:c.id};}
  if(d.accountKind==='platform'&&connectedReference!==null||d.accountKind==='connected'&&connectedReference===null)throw new HttpsError('invalid-argument','Périmètre connecté incohérent.');
  if(d.epoch!==null){const e=supportObject(d.epoch,['id','proofHash']);if(!id(e.id)||!hash(e.proofHash))throw new HttpsError('invalid-argument','Référence epoch exacte requise.');epoch={id:e.id,proofHash:e.proofHash};}
  if(d.boundaries!==null){const b=supportObject(d.boundaries,['opening','closing']);
    if(!Array.isArray(b.opening)||!Array.isArray(b.closing)||b.opening.length>4||b.closing.length>4)throw new HttpsError('invalid-argument','Bornes documentaires invalides.');
    const opening=b.opening.map(boundary),closing=b.closing.map(boundary);if(new Set(opening.map(v=>v.balanceType)).size!==opening.length||new Set(closing.map(v=>v.balanceType)).size!==closing.length)
      throw new HttpsError('invalid-argument','Une borne par compartiment est requise.');boundaries={opening,closing};}
  let statementReference:GlobalFinancialScope['statementReference']=null;
  if(d.statementReference!==null){const ref=supportObject(d.statementReference,['reportRunId','reportType']);
    if(!globalStripeId(ref.reportRunId,'frr')||!['balance.summary.1','balance.summary.2'].includes(ref.reportType))throw new HttpsError('invalid-argument','Référence du relevé existant invalide.');
    statementReference={reportRunId:ref.reportRunId,reportType:ref.reportType};}
  let nativeCapture:GlobalFinancialScope['nativeCapture'];
  if(own(d,'nativeCapture')){const c=supportObject(d.nativeCapture,['protocol','readTime']),t=supportObject(c.readTime,['seconds','nanoseconds']);
    if(c.protocol!=='firestore_read_time_v1'||!integer(t.seconds)||t.seconds<1||!integer(t.nanoseconds)||t.nanoseconds<0||t.nanoseconds>=1e9||t.nanoseconds%1000!==0||
      t.seconds*1000+t.nanoseconds/1e6>Date.now())throw new HttpsError('invalid-argument','Point de lecture Firestore exact requis.');
    nativeCapture={protocol:'firestore_read_time_v1',readTime:{seconds:t.seconds,nanoseconds:t.nanoseconds}};}
  if(own(d,'coverageMode')&&(d.coverageMode!=='complete_known_sources_v1'||!nativeCapture))throw new HttpsError('invalid-argument','Le parcours complet des sources connues exige un point natif explicite.');
  if(own(d,'controlBalanceMode')&&(d.controlBalanceMode!=='global_control_balance_v1'||d.coverageMode!=='complete_known_sources_v1'||!nativeCapture))throw new HttpsError('invalid-argument','Le contrôle de balance exige les sources complètes et un point natif explicite.');
  return {accountKind:d.accountKind,accountId:d.accountId,platformAccountId:d.platformAccountId,livemode:d.livemode,currency:'CAD',period:{fromSeconds:p.fromSeconds,toSeconds:p.toSeconds},connectedReference,epoch,boundaries,statementReference,
    ...(nativeCapture?{nativeCapture}:{}),...(own(d,'coverageMode')?{coverageMode:'complete_known_sources_v1' as const}:{}),...(own(d,'controlBalanceMode')?{controlBalanceMode:'global_control_balance_v1' as const}:{})};
}
async function authority(tx:FirebaseFirestore.Transaction,request:any){const session=await assertPrivateAccountSession(request,tx);await supportAdmin(tx,request.auth.uid,session.currentAdminClaim);}
class NativeCaptureUnavailable extends Error{constructor(readonly reason:string){super('Native capture unavailable');}}
function captureTime(scope:GlobalFinancialScope){const c=scope.nativeCapture,t=c?.readTime;
  if(c?.protocol!=='firestore_read_time_v1'||!t||!integer(t.seconds)||t.seconds<1||!integer(t.nanoseconds)||t.nanoseconds<0||t.nanoseconds>=1e9||t.nanoseconds%1000!==0)
    throw new NativeCaptureUnavailable('native_read_time_unqualified');
  const point=new Timestamp(t.seconds,t.nanoseconds),age=Date.now()-point.toMillis();
  if(age<0||age>7*86400000||age>3600000&&(t.seconds%60!==0||t.nanoseconds!==0))throw new NativeCaptureUnavailable('native_read_time_expired_or_unavailable');
  return point;
}
/** Only native financial reads enter the historical transaction. Private Auth,
 * account-security barriers, roles and documentary run journals stay current. */
async function nativeRead<T>(scope:GlobalFinancialScope,live:FirebaseFirestore.Transaction,request:any,fn:(tx:FirebaseFirestore.Transaction)=>Promise<T>):Promise<T>{
  if(!scope.nativeCapture)return fn(live);
  const point=captureTime(scope);await authority(live,request);
  let value:T;
  try{value=await db.runTransaction(async tx=>fn(new Proxy(tx,{get(target,key){
    if(key==='get')return async(ref:any)=>{let snapshot:any;try{snapshot=await target.get(ref);}catch{throw new NativeCaptureUnavailable('native_read_time_expired_or_unavailable');}
      if(!(snapshot.readTime instanceof Timestamp)||!snapshot.readTime.isEqual(point))throw new NativeCaptureUnavailable('native_read_time_not_observed');return snapshot;};
    if(['create','set','update','delete'].includes(String(key)))return ()=>{throw new NativeCaptureUnavailable('historical_write_forbidden');};
    const item=(target as any)[key];return typeof item==='function'?item.bind(target):item;
  }})),{readOnly:true,readTime:point});}
  catch(error){if(error instanceof NativeCaptureUnavailable)throw error;throw new NativeCaptureUnavailable('native_read_time_expired_or_unavailable');}
  // Native role/barrier reads belong to the CURRENT commit's read set, so a
  // concurrent change aborts/retries that commit; Auth is also fetched afresh.
  await authority(live,request);return value;
}
export type GlobalFinancialCapturePoint={protocol:'global_financial_native_capture_point_v1';
  nativeCapture:NonNullable<GlobalFinancialScope['nativeCapture']>;authorityReadMode:'current';knownSourcesOnly:true;globalBalanceReconciled:false;sourceSetExhaustive:false;
  precision?:'minute';readTimeVerified?:true;pitrEnabledVerified?:false;futureAvailabilityVerified?:false};
async function capturePoint(request:any,precision?:'minute'):Promise<GlobalFinancialCapturePoint>{
  await db.runTransaction(tx=>authority(tx,request));
  let snapshot:FirebaseFirestore.DocumentSnapshot;
  try{snapshot=await db.runTransaction(tx=>tx.get(runRef('global_financial_capture_clock')),{readOnly:true});}
  catch{throw new HttpsError('unavailable','Le point de lecture natif ne peut pas être obtenu.',{reason:'native_read_time_unavailable'});}
  if(!(snapshot.readTime instanceof Timestamp)||snapshot.readTime.nanoseconds%1000!==0)throw new HttpsError('unavailable','Horloge native non qualifiée.',{reason:'native_read_time_not_observed'});
  if(precision==='minute'){
    // The client chooses precision, never a timestamp. This recent minute GET
    // proves only that exact point now; it neither enables nor certifies PITR.
    const point=new Timestamp(Math.floor(snapshot.readTime.seconds/60)*60,0);
    if(point.seconds<1||point.toMillis()>Date.now())throw new HttpsError('unavailable','Point minute natif indisponible.',{reason:'native_read_time_not_observed'});
    await db.runTransaction(tx=>authority(tx,request));
    let pinned:FirebaseFirestore.DocumentSnapshot;
    try{pinned=await db.runTransaction(tx=>tx.get(runRef('global_financial_capture_clock')),{readOnly:true,readTime:point});}
    catch{throw new HttpsError('unavailable','Ce point minute ne peut pas être lu.',{reason:'native_read_time_unavailable'});}
    if(!(pinned.readTime instanceof Timestamp)||!pinned.readTime.isEqual(point))throw new HttpsError('unavailable','Point minute non observé.',{reason:'native_read_time_not_observed'});
    snapshot=pinned;
  }
  await db.runTransaction(tx=>authority(tx,request));
  return {protocol:'global_financial_native_capture_point_v1',nativeCapture:{protocol:'firestore_read_time_v1',
    readTime:{seconds:snapshot.readTime.seconds,nanoseconds:snapshot.readTime.nanoseconds}},authorityReadMode:'current',knownSourcesOnly:true,
    globalBalanceReconciled:false,sourceSetExhaustive:false,...precision==='minute'?{precision:'minute' as const,readTimeVerified:true as const,pitrEnabledVerified:false as const,futureAvailabilityVerified:false as const}:{}};
}
async function connectedOwner(tx:FirebaseFirestore.Transaction,s:GlobalFinancialScope){
  if(s.accountKind==='platform')return null;const c=s.connectedReference!;
  const d=(await tx.get(db.collection(c.kind==='withdrawal'?'withdrawal_requests':'users').doc(c.id))).data();
  if(!d||d.stripeAccountId!==s.accountId||c.kind==='withdrawal'&&(!id(d.userId)||!cents(d.amount)||d.amount===0||!native(d.createdAt)))
    throw new HttpsError('failed-precondition','Le compte connecté ne possède pas cette référence native.');
  // Historical withdrawal account ownership is independent of today's KYC/account.
  return c.kind==='withdrawal'?d.userId as string:c.id;
}
function nativeDocument(path:string){
  const a=path.split('/');if(a.length===2&&(ROOTS as readonly string[]).includes(a[0])&&id(a[1]))return db.collection(a[0]).doc(a[1]);
  if(a.length===4&&(CHILDREN[a[0]]??[]).includes(a[2])&&id(a[1])&&id(a[3]))return db.collection(a[0]).doc(a[1]).collection(a[2]).doc(a[3]);
  return null;
}
const refundView=(r:any)=>r?{intentId:text(r.intentId),attemptId:text(r.attemptId),state:text(r.state),providerStatus:text(r.providerStatus),
  paymentIntentId:globalStripeId(r.paymentIntentId,'pi')?r.paymentIntentId:null,refundId:globalStripeId(r.stripeRefundId,'re')?r.stripeRefundId:null,
  cardCents:cents(r.cardAmountCents)?r.cardAmountCents:null,walletCents:cents(r.walletAmountCents)?r.walletAmountCents:null,sellerDebitCents:cents(r.sellerDebitCents)?r.sellerDebitCents:null,
  fundsAppliedAt:at(r.fundsAppliedAt),outstandingCardCents:cents(r.outstandingCardCents)?r.outstandingCardCents:null,
  reservationHash:hash(r.allocation?.reservationHash)?r.allocation.reservationHash:null,termsHash:r.allocation?.terms?supportHash(r.allocation.terms):null,
  cardRepairHash:hash(r.cardRepairSettlement?.proofHash)?r.cardRepairSettlement.proofHash:null,
  manualSettlementHash:hash(r.manualBankSettlement?.recordHash)?r.manualBankSettlement.recordHash:null,
  manualVerificationBasis:r.manualBankSettlement?.verificationBasis==='human_operator_attestation'?'human_operator_attestation':null}:null;
const ledgerView=(d:Data)=>({type:text(d.type),amountCents:cents(d.amount)?d.amount:null,currency:['CAD','cad'].includes(d.currency)?'CAD':null,
  balanceAfterCents:cents(d.balanceAfter)?d.balanceAfter:null,debtRecordedCents:d.debtRecorded==null?null:cents(d.debtRecorded)?d.debtRecorded:null,
  createdAt:at(d.createdAt),transactionId:text(d.transactionId),swapId:text(d.swapId),refundIntentId:text(d.refundIntentId),disputeId:text(d.disputeId),
  withdrawalRequestId:text(d.withdrawalRequestId),withdrawalDebitLedgerId:text(d.withdrawalDebitLedgerId),paymentIntentId:text(d.paymentIntentId),caseId:text(d.caseId),instructionId:text(d.instructionId)});
function projected(path:string,d:Data,parent?:Data|null){
  const a=path.split('/'),kind=a[2]??a[0];let value:Data={};
  if(kind==='admin_alerts'){value=d.kind==='exceptional_financial_restitution'?{type:d.kind,protocol:text(d.protocol),caseId:text(d.caseId),ownerId:text(d.ownerId),beneficiaryId:text(d.beneficiaryId),
    amountCents:cents(d.amountCents)?d.amountCents:null,currency:d.currency??null,funding:text(d.funding),state:text(d.state),instructionId:text(d.instructionId),instructionHash:hash(d.instructionHash)?d.instructionHash:null,
    preparedAt:at(d.preparedAt),recordedAt:at(d.preparedAt),attestedAt:at(d.attestedAt),voidedAt:at(d.voidedAt),reconciliationRequired:d.reconciliationRequired===true,
    bankArrivalVerified:false,stripeSettlementGranted:false}: {irrelevant:true};
  }else if(kind==='exceptional_commands'){value={protocol:text(d.protocol),caseId:text(d.caseId),instructionId:text(d.instructionId),state:text(d.state),outcome:text(d.outcome),
    inputHash:hash(d.inputHash)?d.inputHash:null,action:text(d.command?.action),amountCents:cents(d.command?.amountCents)?d.command.amountCents:null,recordedAt:at(d.recordedAt),noProviderSettlement:true};
  }else if(kind==='exceptional_evidence'){value={protocol:text(d.protocol),caseId:text(d.caseId),state:text(d.state),purpose:text(d.purpose),contentHash:hash(d.contentHash)?d.contentHash:null,
    recordedAt:at(d.recordedAt),reservedAt:at(d.reservedAt),noPaymentClaim:true};
  }else if(kind==='transactions'){value={buyerId:text(d.buyerId),sellerId:text(d.sellerId),articleId:text(d.articleId),currency:d.currency??null,status:text(d.status),
    amountCents:exactCents(d.amount),feeCents:exactCents(d.serviceFee),shippingCents:exactCents(d.shippingCost),taxCents:exactCents(d.taxTotal),totalCents:exactCents(d.totalAmount),
    paidAt:at(d.paidAt),payment:nativePurchasePaymentSource(d,a[1]),paymentIntentId:text(d.stripePaymentIntentId),chargeId:text(d.stripeChargeId),capturedCardCents:cents(d.capturedCardCents)?d.capturedCardCents:null,
    walletCents:cents(d.walletAmountUsed)?d.walletAmountUsed:null,sellerCreditCents:cents(d.sellerCreditedCents)?d.sellerCreditedCents:null,
    sellerPendingCents:cents(d.sellerPendingCreditCents)?d.sellerPendingCreditCents:null,sellerDebtRepaidCents:cents(d.sellerDebtRepaidCents)?d.sellerDebtRepaidCents:null,
    refund:refundView(d.refund),disputeId:globalStripeId(d.bankDispute?.id??d.disputeId,'du')?d.bankDispute?.id??d.disputeId:null,
    bankState:text(d.bankDispute?.state),bankOutcome:text(d.bankDispute?.outcome),bankReview:own(d,'bankRefundReconciliation')||d.bankDispute?.reconciliationRequired===true,
    refundReview:d.refundBlocked===true,inventoryReview:d.paymentInventoryReconciliation!=null,
    manualRestitution:d.manualRefundRestitution?{instructionId:text(d.manualRefundRestitution.instructionId),state:text(d.manualRefundRestitution.state),
      obligationHash:hash(d.manualRefundRestitution.obligationHash)?d.manualRefundRestitution.obligationHash:null}:null};
  }else if(kind==='swaps'){value={initiatorId:text(d.initiatorId),receiverId:text(d.receiverId),status:text(d.status),paymentIntentId:text(d.topUpPaymentIntentId),
    payerId:text(d.cashTopUp?.payerId),baseCents:cents(d.cashTopUp?.amount)?d.cashTopUp.amount:null,paidAt:at(d.topUpPaidAt),refundedAt:at(d.topUpRefundedAt),
    settlementProtocol:text(d.topUpSettlement?.protocol),settlementState:text(d.topUpSettlement?.state),settlementPaymentIntentId:text(d.topUpSettlement?.paymentIntentId)};
  }else if(kind==='withdrawal_requests'){value={ownerId:text(d.userId),amountCents:cents(d.amount)?d.amount:null,currency:d.currency??null,status:text(d.status),
    createdAt:at(d.createdAt),transferRecordedAt:at(d.providerSubmission?.transfer?.observedAt),payoutRecordedAt:at(d.providerSubmission?.payout?.observedAt),completedAt:at(d.completedAt),
    accountId:text(d.stripeAccountId),transferId:text(d.stripeTransferId),payoutId:text(d.stripePayoutId),debitLedgerId:text(d.ledgerEntryId),
    destinationHash:supportHash([d.stripeAccountId??null,d.payoutDestination?.bankAccountId??null]),recoveryState:text(d.payoutRecovery?.state),
    reversalId:text(d.payoutRecovery?.reversalId),returnBalanceTransactionId:text(d.payoutRecovery?.returnBalanceTransactionId),compensationLedgerId:text(d.payoutRecovery?.compensationLedgerId),
    compensatedAt:at(d.payoutRecovery?.compensatedAt),reconciliationRequired:d.reconciliationRequired===true,intentHash:hash(d.withdrawalIntent?.payloadHash)?d.withdrawalIntent.payloadHash:null};
  }else if(kind==='wallets')value=inspectWalletInvariants(d);
  else if(kind==='ledger')value=ledgerView(d);
  else if(kind==='platform_ledger'){const signed=(v:any)=>typeof v==='number'&&exactCents(Math.abs(v))!==null?Math.sign(v)*exactCents(Math.abs(v))!:null;
    value={type:text(d.type),transactionId:text(d.transactionId),refundIntentId:text(d.refundIntentId),paymentIntentId:text(d.paymentIntentId),chargeId:text(d.chargeId),
      operationId:text(d.shopTierOperationId),createdAt:at(d.createdAt),currency:d.currency??null,sourceHash:hash(d.sourceHash??d.accountingSourceHash)?d.sourceHash??d.accountingSourceHash:null,
      protocol:text(d.protocol),qualification:text(d.qualification),projectionHash:hash(d.projectionHash)?d.projectionHash:null,baseHash:hash(d.baseHash)?d.baseHash:null,
      currentTotals:d.currentTotals?{serviceFeeCents:signed(d.currentTotals.serviceFee),shippingCents:signed(d.currentTotals.shippingCostCollected),taxCents:signed(d.currentTotals.taxCollected)}:null,
      serviceFeeCents:signed(d.serviceFee),shippingCents:signed(d.shippingCostCollected),taxCents:signed(d.taxCollected??d.taxTotal),
      amountCents:['manual_bank_transfer_reference','exceptional_restitution','exceptional_manual_bank_reference'].includes(d.type)&&cents(d.amountCents)?d.amountCents:signed(d.amount),
      caseId:text(d.caseId),instructionId:text(d.instructionId),funding:text(d.funding),state:text(d.state),reservedLiabilityCents:cents(d.reservedLiabilityCents)?d.reservedLiabilityCents:null,
      manuallyDisbursedCents:cents(d.manuallyDisbursedCents)?d.manuallyDisbursedCents:null,bankArrivalVerified:false,parallelTaxRegister:d.type==='tax_collected',totalsAreNotWalletMovements:true};
  }else if(kind==='failed_operations'&&d.orphanRefund?.protocol==='orphan_capture_original_refund_v1'){value={protocol:d.orphanRefund.protocol,operationId:a[1],commandId:text(d.orphanRefund.commandId),state:text(d.orphanRefund.state),paymentIntentId:text(d.orphanRefund.paymentIntentId),chargeId:text(d.orphanRefund.chargeId),refundId:text(d.orphanRefund.refundId),amountCents:cents(d.orphanRefund.amountCents)?d.orphanRefund.amountCents:null};
  }else if(kind==='eligibility_audit'){value=d.protocol==='orphan_capture_refund_command_v1'?{protocol:d.protocol,operationId:text(d.operationId),commandId:text(d.commandId),state:text(d.state),amountCents:cents(d.command?.amountCents)?d.command.amountCents:null,refundId:text(d.refundId),recordedAt:at(d.recordedAt)}:d.action==='account_forfait_operation'?{action:d.action,ownerId:text(d.ownerId),shopId:text(d.shopId),tier:text(d.tier),periodMonths:d.periodMonths??null,
    amountCents:cents(d.amountCents)?d.amountCents:null,state:text(d.state),paymentIntentId:text(d.paymentIntentId),chargeId:text(d.settlement?.chargeId),createdAt:at(d.createdAt),settledAt:at(d.settledAt),
    inputHash:hash(d.inputHash)?d.inputHash:null,settlementHash:hash(d.settlement?.proofHash)?d.settlement.proofHash:null,nativeOperationQualified:qualifiedShopTierOperation(d,a[1])}: {irrelevant:true};
  }else if(kind==='refund_history')value={transactionId:a[1],originalIntentHash:hash(d.originalIntentHash)?d.originalIntentHash:null,
    originalHashMatches:hash(d.originalIntentHash)&&d.originalIntentHash===supportSourceHash(d.originalIntent),current:refundView(d.currentIntent),archivedAt:at(d.archivedAt)};
  else if(kind==='refund_allocations')value={transactionId:a[1],refundIntentId:text(d.refundIntentId),protocol:text(d.protocol),basisHash:hash(d.basisHash)?d.basisHash:null,
    reservationHash:hash(d.reservationHash)?d.reservationHash:null,reservationMatches:hash(d.reservationHash)&&d.reservationHash===supportSourceHash(d.reservation),
    termsHash:d.terms?supportHash(d.terms):null,cardCents:cents(d.terms?.cardCents)?d.terms.cardCents:null,walletCents:cents(d.terms?.walletCents)?d.terms.walletCents:null,
    sellerDebitCents:cents(d.terms?.sellerDebitCents)?d.terms.sellerDebitCents:null,providerRefundId:text(d.settlement?.providerRefundId),appliedAt:at(d.settlement?.appliedAt),reservedAt:at(d.reservedAt)};
  else if(kind==='refund_repair_commands')value=d.protocol==='purchase_refund_external_manual_command_v1'?{
    type:'manual_bank_restitution',protocol:d.protocol,transactionId:a[1],refundIntentId:text(d.command?.refundIntentId),action:text(d.command?.action),
    instructionId:text(d.instructionId),payloadHash:hash(d.payloadHash)?d.payloadHash:null,state:text(d.state),manualState:text(d.manualState),currency:'CAD',
    amountCents:cents(d.command?.amountCents)?d.command.amountCents:null,recordedAt:at(d.recordedAt),verificationBasis:text(d.verificationBasis),bankArrivalVerified:false,
  }:d.protocol==='purchase_refund_manual_evidence_record_v1'?{type:'manual_restitution_evidence_integrity',transactionId:a[1],refundIntentId:text(d.refundIntentId),
    state:text(d.state),contentHash:hash(d.contentHash)?d.contentHash:null,recordedAt:at(d.recordedAt),reservedAt:at(d.reservedAt),noPaymentClaim:true}:{irrelevant:true};
  else if(kind==='refund_repairs')value={transactionId:a[1],protocol:text(d.protocol),refundIntentId:text(d.refundIntentId),repairId:text(d.repairId),paymentIntentId:text(d.paymentIntentId),
    chargeId:text(d.chargeId),providerRefundId:text(d.providerRefundId),amountCents:cents(d.amountCents)?d.amountCents:null,state:text(d.state),commandHash:hash(d.commandHash)?d.commandHash:null,
    commandMatches:hash(d.commandHash)&&d.commandHash===supportHash(d.command),reservedAt:at(d.reservedAt),observedAt:at(d.observedAt)};
  else if(kind==='topup_refund')value={swapId:a[1],protocol:text(d.protocol),intentId:text(d.intentId),state:text(d.state),paymentIntentId:text(d.paymentIntentId),
    refundId:text(d.providerRefundId??d.refundId??d.stripeRefundId),amountCents:cents(d.amountCents)?d.amountCents:null,baseCents:cents(d.baseCents)?d.baseCents:null,
    localAppliedAt:at(d.reconciledAt??d.committedAt??d.recordedAt),authorizedAt:at(d.postAuthorizedAt),bodyHash:hash(d.bodyHash)?d.bodyHash:null,bodyMatches:hash(d.bodyHash)&&d.bodyHash===supportHash(d.body)};
  else value={swapId:a[1],protocol:text(d.protocol),amountCents:cents(d.amountCents)?d.amountCents:null,paymentIntentId:text(d.paymentIntentId),recordedAt:at(d.recordedAt),creditLedgerId:text(d.creditLedgerId),releaseLedgerId:text(d.releaseLedgerId)};
  const recordedAt=value.paidAt??value.appliedAt??value.settledAt??value.createdAt??value.recordedAt??value.reservedAt??value.archivedAt??null;
  const parentIdentity=parent?{id:a[1],buyerId:text(parent.buyerId),sellerId:text(parent.sellerId),ownerId:text(parent.userId),paymentIntentId:text(parent.stripePaymentIntentId??parent.topUpPaymentIntentId)}:null;
  return {kind,id:a.at(-1),path,value,parentIdentity,recordedAt,sourceHash:supportSourceHash({kind,value,parentIdentity})};
}

function projection(path:string,d:Data,parent?:Data|null){try{return projected(path,d,parent);}catch{return {kind:path.split('/')[2]??path.split('/')[0],id:path.split('/').at(-1),path,
  value:{projectionUnknown:true},parentIdentity:null,recordedAt:null,sourceHash:supportHash([path,'unqualified_projection'])};}}
async function localLedger(tx:FirebaseFirestore.Transaction,ownerId:any,field:string,referenceId:string){
  if(!id(ownerId))return null;const q=await tx.get(db.collection('wallets').doc(ownerId).collection('ledger').where(field,'==',referenceId).limit(101));
  return q.size<101?q.docs.map(r=>({id:r.id,...ledgerView(r.data())})):null;
}
async function unsafeNativeClaims(tx:FirebaseFirestore.Transaction,record:ReturnType<typeof projection>,raw:Data,parent:Data|null,s:GlobalFinancialScope){
  const v=record.value,a=record.path.split('/'),claims:{claim:Claim;links:Link[]}[]=[],issues:string[]=[];
  const emit=(kind:string,contract:string,amountCents:number|null,links:Link[],qualified:boolean,localQualification:string,
    pi:string|null=null,ch:string|null=null,accountId:string|null=null,ownerId:string|null=null,periodAt?:unknown,causalEvent='native_recorded_at')=>{
    const causalAt=periodAt===undefined?record.recordedAt:at(periodAt),ms=causalAt===null?NaN:Date.parse(causalAt);
    const periodQualification=!Number.isFinite(ms)?'unknown':ms/1000>=s.period.fromSeconds&&ms/1000<s.period.toSeconds?'within_period':'outside_period';
    claims.push({claim:{contract,kind,sourcePath:record.path,sourceHash:record.sourceHash,amountCents,paymentIntentId:pi,chargeId:ch,accountId,ownerId,qualified,localQualification,periodQualification,causalAt,causalEvent},
      links:links.filter(l=>globalStripeId(l.id,l.kind))});};
  if(record.kind==='failed_operations'&&raw.orphanRefund?.protocol==='orphan_capture_original_refund_v1'||record.kind==='eligibility_audit'&&raw.protocol==='orphan_capture_refund_command_v1'){
    if(raw.state==='not_executed'&&native(raw.recordedAt))return {claims,issues};
    const op=record.kind==='failed_operations'?a[1]:raw.operationId,x=await (await import('./orphanCaptureRefund')).readOrphanCaptureRefundAccounting(tx,op,record.kind==='eligibility_audit'?a[1]:undefined);issues.push(...x.blockers);
    if(!x.qualified||!x.proof)return {claims,issues};if(record.kind==='eligibility_audit'){if(x.command?.commandId!==a[1]||supportSourceHash(x.command)!==supportSourceHash(raw))issues.push('orphan_capture_command_native_join_unknown');return {claims,issues};}
    const p=x.proof;if(s.accountKind==='platform'&&p.accountId===s.accountId&&p.livemode===s.livemode){
      emit('payment_intent',`orphan_capture:${op}`,p.capturedCents,[{kind:'pi',id:p.paymentIntentId},{kind:'ch',id:p.chargeId}],true,'native_unattributed_platform_capture',p.paymentIntentId,p.chargeId,null,null,Timestamp.fromMillis(p.capture.created*1000),'provider_capture_balance_transaction_created');
      for(const r of p.refunds)if(r.status==='succeeded')emit('refund',`orphan_capture_refund:${op}:${r.refundId}`,r.amountCents,[{kind:'re',id:r.refundId},{kind:'ch',id:p.chargeId},{kind:'pi',id:p.paymentIntentId}],true,'native_original_method_refund',p.paymentIntentId,p.chargeId,null,null,Timestamp.fromMillis(r.settlement.created*1000),'provider_original_refund_cash_created');
    }return {claims,issues};
  }
  const exceptionalCase=record.kind==='admin_alerts'&&raw.kind==='exceptional_financial_restitution'?a[1]:
    ['exceptional_commands','exceptional_evidence'].includes(record.kind)?a[1]:typeof raw.type==='string'&&raw.type.startsWith('exceptional_')?raw.caseId:null;
  if(typeof exceptionalCase==='string'&&/^exception_[a-f0-9]{64}$/.test(exceptionalCase)){
    if(raw.state==='not_executed'&&native(raw.recordedAt))return {claims,issues};
    if(record.kind==='exceptional_evidence'){
      const c=raw.context,target=c?.kind==='wallet_restitution'?db.collection('wallets').doc(c.ownerId):c?.kind==='withdrawal_misdirection'?db.collection('withdrawal_requests').doc(c.withdrawalRequestId):
        c?.kind==='refund_error'?db.collection('transactions').doc(c.transactionId):null;
      if(!target||!(await tx.get(target)).exists||!['upload_reserved','stored','stored_requires_review'].includes(raw.state)||!native(raw.reservedAt)||raw.caseId!==exceptionalCase||!hash(raw.inputHash))issues.push('exceptional_evidence_native_source_unknown');
      return {claims,issues};
    }
    const x=await (await import('./exceptionalRestitution')).readExceptionalNativeAccounting(tx,exceptionalCase),r=x.case;
    issues.push(...x.blockers);if(!x.qualified||!r)return {claims,issues};
    const expected=record.kind==='platform_ledger'?raw.type==='exceptional_restitution'?x.liability:x.reference:
      record.kind==='ledger'?raw.type==='exceptional_compensation_credit'?x.compensation:raw.type==='exceptional_restitution_reserve'?x.reserve:x.returned:null;
    if(expected&&supportSourceHash(raw)!==supportSourceHash(expected)||['platform_ledger','ledger'].includes(record.kind)&&!expected)issues.push('exceptional_financial_record_join_unknown');
    if(record.kind==='exceptional_commands'&&(raw.state!=='committed'||raw.inputHash!==supportHash(raw.command)||!native(raw.recordedAt)))issues.push('exceptional_command_receipt_unknown');
    if(record.kind==='admin_alerts'&&s.accountKind==='platform'){
      emit('exceptional_restitution',`exceptional:${r.caseId}`,r.amountCents,[],true,r.state==='operator_attested'?r.funding==='seconde_wallet_compensation'?'native_compensatory_wallet_credit':'human_operator_attested_bank_transfer':r.state==='voided'?'native_reservation_voided':'native_restitution_reserved',null,null,null,r.ownerId,
        r.attestedAt??r.voidedAt??r.preparedAt,'native_exceptional_restitution_recorded_at');
      if(r.state==='operator_attested'&&r.funding!=='seconde_wallet_compensation')issues.push('manual_bank_cash_outside_provider_scope');
    }
    return {claims,issues};
  }
  const addRefund=async(r:any,order:Data,tid:string)=>{
    const f=refundView(r);if(!f||!globalStripeId(f.refundId,'re'))return;
    let local=false;const allocation=r.allocation?(await tx.get(db.collection('transactions').doc(tid).collection('refund_allocations').doc(r.intentId))).data():null;
    if(allocation)try{local=await allocationLocalMovementsVerified(tx,tid,order,r,allocation);}catch(error){if(error instanceof NativeCaptureUnavailable)throw error;/* explicit local unknown */}
    const bound=id(r.intentId)&&r.buyerId===order.buyerId&&r.sellerId===order.sellerId&&r.currency==='cad'&&native(r.requestedAt)&&
      r.paymentIntentId===order.stripePaymentIntentId&&cents(f.cardCents)&&f.cardCents>0;
    emit('refund',`refund:${tid}:${r.intentId}`,f.cardCents,[{kind:'re',id:f.refundId}],bound,
      local&&r.state==='succeeded'&&r.outstandingCardCents===0?'native_local_settlement_recorded':local?'local_applied_card_obligation_open':'local_settlement_unknown',
      text(r.paymentIntentId),text(order.stripeChargeId),null,null,r.fundsAppliedAt,'native_refund_applied_at');
  };
  if(record.kind==='refund_repair_commands'&&s.accountKind==='platform'&&raw.protocol==='purchase_refund_external_manual_command_v1'){
    const intentId=raw.command?.refundIntentId,order=parent;
    if(!order||!id(intentId)){issues.push('manual_restitution_native_obligation_unknown');return {claims,issues};}
    const intent=order.refund?.intentId===intentId?order.refund:await readAllocationHistoryIntent(tx,a[1],order,intentId);
    if(raw.command?.action==='attest_manual_bank_transfer'&&raw.state==='committed'){
      const docs=intent?await readManualRefundDocuments(tx,a[1],intent):null;
      const event=!!intent&&!!docs&&qualifiedManualRefundSettlement(a[1],order,intent,docs)&&intent.manualBankSettlement.attestationId===a[3];
      const allocation=intent?(await tx.get(db.collection('transactions').doc(a[1]).collection('refund_allocations').doc(intentId))).data():null;
      const local=!!allocation&&!!intent&&await allocationLocalMovementsVerified(tx,a[1],order,intent,allocation);
      emit('manual_restitution',`manual_refund:${a[1]}:${intentId}`,v.amountCents,[],event&&local,'human_operator_attested_bank_transfer',null,null,null,order.buyerId,raw.recordedAt,'human_attestation_recorded_at');
      if(!event||!local)issues.push('manual_restitution_proof_or_native_money_unknown');
      if(intent?.providerStatus==='succeeded'||intent?.cardRepairSettlement!=null||intent?.duplicateCardSettlementCents)issues.push('manual_and_stripe_overlap_requires_reconciliation');
    }else if(raw.state==='committed'&&!qualifiedManualCommand(raw,a[1],intentId,raw.command?.action))issues.push('manual_instruction_receipt_unknown');
    return {claims,issues};
  }
  if(record.kind==='transactions'&&s.accountKind==='platform'){
    const p=v.payment,parts=[v.amountCents,v.feeCents,v.shippingCents,v.taxCents],total=v.totalCents;
    if(p){const base=(await tx.get(db.collection('platform_ledger').doc('service_fee_revenue_'+a[1]))).data();
      if(!base||base.type!=='service_fee_revenue'||base.transactionId!==a[1]||base.sellerId!==v.sellerId||!native(base.createdAt)||base.currency!=='cad'||
        exactCents(base.serviceFee)!==v.feeCents||exactCents(base.shippingCostCollected)!==v.shippingCents||exactCents(base.taxCollected)!==v.taxCents)
        issues.push('native_payment_platform_base_missing_or_conflicting');}
    const bound=!!p&&p.kind==='stripe_payment_intent'&&parts.every(cents)&&parts.reduce((n:number,x:number)=>n+x,0)===total&&
      p.amountCents===total&&p.referenceId===v.paymentIntentId&&cents(v.capturedCardCents)&&v.capturedCardCents>0&&p.amountCents-p.walletCents===v.capturedCardCents;
    let local=bound&&!v.inventoryReview&&!v.bankReview&&!v.refundReview;
    if(bound&&p.walletCents>0){const rows=await localLedger(tx,v.buyerId,'transactionId',a[1]),debits=rows?.filter(r=>r.type==='purchase_debit');
      if(!debits||debits.length!==1||debits[0].amountCents!==p.walletCents||debits[0].createdAt===null)local=false;}
    if(globalStripeId(v.paymentIntentId,'pi'))emit('purchase',`purchase:${a[1]}`,v.capturedCardCents,
      [{kind:'pi',id:v.paymentIntentId},...globalStripeId(v.chargeId,'ch')?[{kind:'ch',id:v.chargeId}]:[]],bound,
      local?'native_payment_recorded':'native_payment_or_local_effect_unknown',v.paymentIntentId,v.chargeId,null,null,raw.paidAt,'native_payment_recorded_at');
    await addRefund(raw.refund,raw,a[1]);
    if(globalStripeId(v.disputeId,'du'))emit('dispute',`purchase:${a[1]}`,cents(raw.bankDispute?.amountCents)?raw.bankDispute.amountCents:null,
      [{kind:'du',id:v.disputeId}],bound,'bank_obligation_separate',v.paymentIntentId,v.chargeId,null,null,raw.bankDispute?.openedAt,'native_bank_dispute_opened_at');
  }else if(record.kind==='refund_history'&&s.accountKind==='platform'&&parent){
    let r:any=null;try{r=await readAllocationHistoryIntent(tx,a[1],parent,a[3]);}catch(error){if(error instanceof NativeCaptureUnavailable)throw error;/* source remains unknown */}
    if(r)await addRefund(r,parent,a[1]);else issues.push('historical_refund_association_unknown');
  }else if(record.kind==='refund_repairs'&&s.accountKind==='platform'&&parent&&globalStripeId(v.providerRefundId,'re')){
    const bound=v.protocol==='purchase_refund_repair_record_v1'&&v.commandMatches&&v.paymentIntentId===parent.stripePaymentIntentId&&
      v.chargeId===parent.stripeChargeId&&native(raw.reservedAt)&&cents(v.amountCents)&&v.amountCents>0;
    emit('refund_repair',`refund:${a[1]}:${v.refundIntentId}`,v.amountCents,[{kind:'re',id:v.providerRefundId}],bound,
      v.state==='card_repaired'?'native_repair_recorded':'repair_obligation_open',v.paymentIntentId,v.chargeId,null,null,
      parent.refund?.cardRepairSettlement?.repairId===v.repairId?parent.refund.cardRepairSettlement.recordedAt:null,'native_card_repair_recorded_at');
  }else if(record.kind==='swaps'&&s.accountKind==='platform'&&globalStripeId(v.paymentIntentId,'pi')){
    const rows=await localLedger(tx,v.payerId===v.initiatorId?v.receiverId:v.initiatorId,'swapId',a[1]),credits=rows?.filter(r=>r.type==='sale_credit'&&r.paymentIntentId===v.paymentIntentId);
    const local=!!credits&&credits.length===1&&credits[0].amountCents===v.baseCents&&credits[0].createdAt!==null;
    const checkout=(await tx.get(db.collection('swaps').doc(a[1]).collection('topup_checkout').doc('current'))).data();
    const savedAmount=cents(v.baseCents)&&cents(raw.topUpFee)&&cents(raw.topUpTax??0)&&integer(v.baseCents+raw.topUpFee+(raw.topUpTax??0))?v.baseCents+raw.topUpFee+(raw.topUpTax??0):null;
    const captured=savedAmount!==null&&(!checkout||(checkout.providerId??checkout.paymentIntentId)===v.paymentIntentId&&checkout.amounts?.totalCents===savedAmount&&
      checkout.amounts?.baseCents===v.baseCents&&checkout.amounts?.currency==='CAD'&&checkout.provider?.receivedCents===savedAmount)?savedAmount:null;
    emit('swap',`swap:${a[1]}`,captured,[{kind:'pi',id:v.paymentIntentId}],id(v.initiatorId)&&id(v.receiverId)&&v.initiatorId!==v.receiverId&&
      [v.initiatorId,v.receiverId].includes(v.payerId)&&cents(v.baseCents)&&v.baseCents>0&&v.paidAt!==null&&captured!==null,
      local?'native_payee_credit_recorded':v.settlementState==='not_credited'?'native_capture_not_credited':'local_payee_credit_unknown',v.paymentIntentId,null,null,null,raw.topUpPaidAt,'native_topup_paid_at');
  }else if(record.kind==='topup_refund'&&s.accountKind==='platform'&&parent&&globalStripeId(v.refundId,'re')){
    emit('swap_refund',`swap_refund:${a[1]}:${v.intentId}`,v.amountCents,[{kind:'re',id:v.refundId}],v.protocol==='swap_topup_refund_v1'&&
      v.bodyMatches&&v.authorizedAt!==null&&v.paymentIntentId===parent.topUpPaymentIntentId&&cents(v.amountCents),
      v.state==='succeeded'?'native_swap_refund_recorded':'swap_refund_obligation_open',v.paymentIntentId,null,null,null,raw.reconciledAt??raw.committedAt,'native_topup_refund_recorded_at');
  }else if(record.kind==='withdrawal_requests'){
    const inScope=s.accountKind==='platform'||v.accountId===s.accountId;
    if(inScope){const rows=await localLedger(tx,v.ownerId,'withdrawalRequestId',a[1]),debits=rows?.filter(r=>r.type==='withdrawal');
      const local=!!debits&&debits.length===1&&debits[0].id===v.debitLedgerId&&debits[0].amountCents===v.amountCents&&debits[0].createdAt!==null;
      const bound=local&&cents(v.amountCents)&&v.amountCents>0&&v.createdAt!==null&&['cad','CAD'].includes(v.currency)&&globalStripeId(v.accountId,'acct');
      const state=v.reconciliationRequired?'withdrawal_obligation_open':v.status==='completed'?'native_payout_completion_recorded':v.recoveryState==='recovered'?'native_compensation_recorded':'native_debit_recorded';
      if(globalStripeId(v.transferId,'tr'))emit('withdrawal',`withdrawal:${a[1]}`,v.amountCents,[{kind:'tr',id:v.transferId}],bound,state,null,null,v.accountId,v.ownerId,
        raw.providerSubmission?.transfer?.observedAt??null,'native_transfer_recorded_at');
      if(s.accountKind==='connected'&&globalStripeId(v.payoutId,'po'))emit('withdrawal',`withdrawal:${a[1]}`,v.amountCents,[{kind:'po',id:v.payoutId}],bound,state,null,null,v.accountId,v.ownerId,
        raw.providerSubmission?.payout?.observedAt??raw.completedAt??null,'native_payout_recorded_at');
      if(s.accountKind==='platform'&&globalStripeId(v.reversalId,'trr')){
        const credit=rows?.filter(r=>r.type==='withdrawal_failed'&&r.id===v.compensationLedgerId),compensated=!!credit&&credit.length===1&&credit[0].amountCents===v.amountCents&&credit[0].createdAt===v.compensatedAt&&v.compensatedAt!==null;
        emit('withdrawal',`withdrawal:${a[1]}`,v.amountCents,[{kind:'trr',id:v.reversalId}],bound&&compensated,state,null,null,v.accountId,v.ownerId,
          raw.payoutRecovery?.compensatedAt??null,'native_withdrawal_compensation_recorded_at');}
    }
  }else if(record.kind==='eligibility_audit'&&v.action==='account_forfait_operation'&&s.accountKind==='platform'&&globalStripeId(v.paymentIntentId,'pi')){
    const ledger=(await tx.get(db.collection('platform_ledger').doc('shop_tier_revenue_'+v.paymentIntentId))).data();
    const settled=qualifiedShopTierSettlement(raw,a[1],ledger);
    emit('tier',`tier:${a[1]}`,v.amountCents,[{kind:'pi',id:v.paymentIntentId},...globalStripeId(v.chargeId,'ch')?[{kind:'ch',id:v.chargeId}]:[]],v.nativeOperationQualified,
      settled?'native_forfait_and_revenue_recorded':'forfait_settlement_unknown',v.paymentIntentId,v.chargeId,null,v.ownerId,raw.settledAt??null,'native_forfait_settled_at');
  }else if(record.kind==='platform_ledger'){
    if(id(raw.transactionId)){
      const order=(await tx.get(db.collection('transactions').doc(raw.transactionId))).data(),payment=order?nativePurchasePaymentSource(order,raw.transactionId):null;
      if(!order||!payment){issues.push('bookkeeping_native_payment_unknown');return {claims,issues};}
      const fee=exactCents(order.serviceFee),shipping=exactCents(order.shippingCost),tax=exactCents(order.taxTotal),article=exactCents(order.amount),total=exactCents(order.totalAmount);
      const baseSource={protocol:'purchase_platform_base_source_v1',transactionId:raw.transactionId,buyerId:order.buyerId,sellerId:order.sellerId,
        articleCents:article,buyerFeeCents:fee,shippingCents:shipping,taxCents:tax,totalCents:total,
        payment:{kind:payment.kind,referenceId:payment.referenceId,cardCents:payment.kind==='wallet_ledger'?0:payment.amountCents-payment.walletCents,walletCents:payment.walletCents}};
      const baseHash=supportSourceHash(baseSource),base=(await tx.get(db.collection('platform_ledger').doc('service_fee_revenue_'+raw.transactionId))).data();
      const baseMatches=!!base&&base.type==='service_fee_revenue'&&base.transactionId===raw.transactionId&&base.sellerId===order.sellerId&&base.currency==='cad'&&native(base.createdAt)&&
        exactCents(base.serviceFee)===fee&&exactCents(base.shippingCostCollected)===shipping&&exactCents(base.taxCollected)===tax&&
        cents(fee)&&cents(shipping)&&cents(tax)&&exactCents(base.grossRevenue)===fee+shipping+tax&&(!own(base,'accountingSourceHash')||base.accountingSourceHash===baseHash);
      if(!baseMatches)issues.push('bookkeeping_native_base_conflict');
      if(raw.type==='service_fee_revenue'){
        if(a[1]!=='service_fee_revenue_'+raw.transactionId||!baseMatches)issues.push('bookkeeping_base_identity_unknown');
      }else if(raw.type==='manual_bank_transfer_reference'){
        const intent=order.refund?.intentId===raw.refundIntentId?order.refund:await readAllocationHistoryIntent(tx,raw.transactionId,order,raw.refundIntentId);
        const docs=intent?await readManualRefundDocuments(tx,raw.transactionId,intent):null,m=intent?.manualBankSettlement;
        if(!docs||!qualifiedManualRefundSettlement(raw.transactionId,order,intent,docs)||raw.protocol!=='purchase_refund_manual_reference_v1'||
          !manualId(raw.attestationId)||raw.attestationId!==m.attestationId||raw.instructionId!==m.instructionId||raw.referenceHash!==m.transferReferenceHash||
          a[1]!=='manual_bank_transfer_'+raw.referenceHash||raw.amountCents!==m.amountCents||raw.currency!=='CAD')issues.push('manual_bank_reference_causal_source_unknown');
      }else if(raw.type==='tax_collected'){
        if(a[1]!=='tax_collected_'+raw.transactionId||raw.currency!=='cad'||!native(raw.createdAt)||!cents(tax)||tax===0||exactCents(raw.taxTotal)!==tax)issues.push('parallel_tax_register_conflict');
      }else if(raw.type==='purchase_refund_counterentry'){
        const allocation=id(raw.refundIntentId)?(await tx.get(db.collection('transactions').doc(raw.transactionId).collection('refund_allocations').doc(raw.refundIntentId))).data():null;
        let intent=order.refund;if(intent?.intentId!==raw.refundIntentId)try{intent=await readAllocationHistoryIntent(tx,raw.transactionId,order,raw.refundIntentId);}catch(error){if(error instanceof NativeCaptureUnavailable)throw error;intent=null;}
        const terms=allocation?.terms,source=raw.source,quote=id(order.shippingQuoteId)?(await tx.get(db.collection('shipping_quotes').doc(order.shippingQuoteId))).data():null;
        const originalTax=quote&&acceptedQuotePurchasePolicy(order,raw.transactionId,quote)?acceptedPurchaseTaxSnapshot(order,quote):null;
        const zeroLegacy=tax===0&&quote&&acceptedQuotePurchasePolicy(order,raw.transactionId,quote)&&[order,order.purchasePolicyAcceptance,quote,quote.source,quote.purchasePolicyAcceptance].every(d=>d&&!own(d,'pricingVersion')&&!own(d,'taxSnapshot'));
        const gst=originalTax?exactCents(originalTax.gst):zeroLegacy?0:null,qst=originalTax?exactCents(originalTax.qst):zeroLegacy?0:null;
        const qualified=allocation&&intent&&terms&&source&&raw.protocol==='purchase_platform_accounting_v1'&&raw.currency==='cad'&&native(raw.createdAt)&&
          a[1]==='purchase_refund_'+supportHash([raw.transactionId,raw.refundIntentId])&&raw.baseHash===baseHash&&raw.sourceHash===supportSourceHash(source)&&
          source.transactionId===raw.transactionId&&source.refundIntentId===raw.refundIntentId&&source.reservationHash===allocation.reservationHash&&source.basisHash===allocation.basisHash&&
          source.termsHash===supportHash(terms)&&supportHash(source.components)===supportHash(terms.refund)&&source.buyerId===order.buyerId&&source.sellerId===order.sellerId&&
          source.cardCents===terms.cardCents&&source.walletCents===terms.walletCents&&source.sellerDebitCents===terms.sellerDebitCents&&
          allocation.basis?.initial?.gstCents===gst&&gst!==null&&allocation.basis?.initial?.qstCents===qst&&qst!==null&&
          raw.serviceFee===-terms.refund.buyerFeeCents/100&&raw.shippingCostCollected===-terms.refund.shippingCents/100&&
          raw.gst===-terms.refund.gstCents/100&&raw.qst===-terms.refund.qstCents/100&&raw.taxCollected===-(terms.refund.gstCents+terms.refund.qstCents)/100&&
          raw.qualification==='qualified'&&intent.state==='succeeded'&&intent.outstandingCardCents===0&&native(intent.fundsAppliedAt)&&
          !own(order,'bankDispute')&&!own(order,'disputeId')&&!own(order,'bankRefundReconciliation')&&await allocationLocalMovementsVerified(tx,raw.transactionId,order,intent,allocation);
        if(!qualified)issues.push('refund_counter_current_allocation_unknown');
      }else if(a[1]==='purchase_accounting_state_'+raw.transactionId&&raw.protocol==='purchase_platform_accounting_v1'){
        const body=Object.fromEntries(['protocol','baseHash','qualification','reason','inspectedAllocations','historyComplete','taxRegisterIsParallel','currentTotals','netMargin','fiscalEffectiveDate'].map(k=>[k,raw[k]]));
        if(raw.projectionHash!==supportHash(body)||raw.baseHash!==baseHash||raw.qualification!=='qualified'||raw.historyComplete!==true||raw.taxRegisterIsParallel!==true||raw.currentTotals===null)
          issues.push('current_bookkeeping_projection_unknown');
      }else issues.push('bookkeeping_source_kind_unqualified');
    }else if(raw.type==='shop_tier_revenue'&&globalStripeId(raw.paymentIntentId,'pi')&&id(raw.shopTierOperationId)){
      const operation=(await tx.get(db.collection('eligibility_audit').doc(raw.shopTierOperationId))).data();
      if(a[1]!=='shop_tier_revenue_'+raw.paymentIntentId||!qualifiedShopTierSettlement(operation,raw.shopTierOperationId,raw))issues.push('forfait_revenue_native_settlement_unknown');
    }else issues.push('bookkeeping_source_origin_unknown');
  }else if(record.kind==='ledger'){
    const ownerId=a[1],wallet=(await tx.get(db.collection('wallets').doc(ownerId))).data();let associated=false;
    if(id(v.transactionId)){const order=(await tx.get(db.collection('transactions').doc(v.transactionId))).data();
      const buyer=['purchase_debit','refund_credit'].includes(v.type),seller=['sale_credit','debt_repayment','funds_held','funds_released','refund_debit','refund_hold','dispute_hold','dispute_hold_released'].includes(v.type);
      associated=!!order&&(buyer&&order.buyerId===ownerId||seller&&order.sellerId===ownerId);
      if(v.type==='purchase_debit')associated=associated&&nativePurchasePaymentSource(order,v.transactionId)?.walletCents===v.amountCents;
      if(['refund_credit','refund_debit'].includes(v.type)&&v.refundIntentId){let r=order?.refund;try{if(r?.intentId!==v.refundIntentId)r=await readAllocationHistoryIntent(tx,v.transactionId,order,v.refundIntentId);}catch(error){if(error instanceof NativeCaptureUnavailable)throw error;r=null;}
        associated=associated&&r?.intentId===v.refundIntentId&&native(r.fundsAppliedAt)&&
          (v.type==='refund_credit'?r.walletAmountCents===v.amountCents:cents(v.debtRecordedCents)&&r.sellerDebitCents===v.amountCents+v.debtRecordedCents);}
    }else if(id(v.swapId)){const swap=(await tx.get(db.collection('swaps').doc(v.swapId))).data();associated=!!swap&&[swap.initiatorId,swap.receiverId].includes(ownerId)&&
      (v.paymentIntentId===null||v.paymentIntentId===swap.topUpPaymentIntentId);
    }else if(id(v.withdrawalRequestId)){const w=(await tx.get(db.collection('withdrawal_requests').doc(v.withdrawalRequestId))).data();associated=!!w&&w.userId===ownerId&&w.amount===v.amountCents&&
      (v.type==='withdrawal'?w.ledgerEntryId===a[3]:v.type==='withdrawal_failed'&&w.payoutRecovery?.state==='recovered'&&w.payoutRecovery.compensationLedgerId===a[3]);}
    if(!associated||v.createdAt===null||!cents(v.amountCents)||!['CAD','cad'].includes(wallet?.currency)||v.currency===null)issues.push('wallet_ledger_origin_or_currency_unknown');
  }
  return {claims,issues};
}
async function nativeClaims(tx:FirebaseFirestore.Transaction,record:ReturnType<typeof projection>,raw:Data,parent:Data|null,s:GlobalFinancialScope){
  try{return await unsafeNativeClaims(tx,record,raw,parent,s);}catch(error){if(error instanceof NativeCaptureUnavailable)throw error;return {claims:[] as {claim:Claim;links:Link[]}[],issues:['native_financial_source_qualification_unavailable']};}
}

function providerFlowComparison(r:Run){
  const unknown=(reason:string,observedNetCents:number|null=null,differenceCents:number|null=null)=>({qualification:'unknown',reason,observedNetCents,
    statementNetCents:r.statement?.summary?.periodNetCents??null,differenceCents,balanceType:null});
  if(!r.providerClosed||r.statement?.openingClosingQualified!==true)return unknown('provider_pages_or_statement_incomplete');
  if(r.groups.some(g=>g.balanceType!=='payments'||g.currency!=='CAD'||g.qualification!=='observed_provider_movements_only')||
    r.groups.reduce((n,g)=>n+g.movements,0)!==r.providerCount)return unknown('provider_compartment_or_arithmetic_coverage_unknown');
  const observed=r.groups.reduce((n,g)=>n+g.netCents,0),expected=r.statement.summary?.periodNetCents;
  if(!integer(observed)||!integer(expected)||!integer(observed-expected))return unknown('provider_flow_arithmetic_unknown');
  if(observed!==expected)return unknown('statement_flow_differs_from_observed_provider_rows',observed,observed-expected);
  // This compares an observed one-compartment flow with a provider statement.
  // It neither allocates the opening balance to buckets nor freezes the DB.
  return {qualification:'observed_provider_flow_matches_statement',reason:null,observedNetCents:observed,statementNetCents:expected,differenceCents:0,balanceType:'payments'};
}
function reportView(rid:string,r:Run,opaque=false){
  const base={protocol:GLOBAL_FINANCIAL_RECONCILIATION_CAPABILITY,runReference:{runId:rid,scopeHash:r.scopeHash},actorId:r.actorId,state:r.state,version:r.version,
    createdAt:at(r.createdAt),lastPageReference:opaque?null:r.lastPage,opaque,...effects,
    openingClosingQualified:!opaque&&r.statement?.openingClosingQualified===true};
  if(opaque)return base;
  return {...base,scope:r.scope,nextPhase:r.phase,limits:GLOBAL_FINANCIAL_LIMITS,
    ...(completeKnownSources(r.scope)?{effectiveLimits:{protocol:'global_financial_effective_limits_v1',coverageMode:'complete_known_sources_v1',
      total:{nativePages:null,providerPages:null,auditPages:null,sources:null,references:null,readAttemptsPerCommand:null},
      perCall:{nativePageSize:GLOBAL_FINANCIAL_LIMITS.nativePageSize,providerPageSize:GLOBAL_FINANCIAL_LIMITS.providerPageSize,externalPages:1},
      maxPageBytes:GLOBAL_FINANCIAL_LIMITS.maxPageBytes,maxRunBytes:GLOBAL_FINANCIAL_LIMITS.maxRunBytes,maxGroups:200,maxClaimsPerReference:GLOBAL_FINANCIAL_LIMITS.maxClaimsPerReference,
      maxMovementIdsPerReference:20,maxPendingChildren:40,safeIntegerMaximum:Number.MAX_SAFE_INTEGER,automaticLoop:false}}:{}),
    coverage:{native:{pages:r.nativePages,sources:r.sourceCount,closed:r.nativeClosed,cursor:{rootIndex:r.rootIndex,lastId:r.lastId,pendingChildren:r.queue.length}},
      provider:{pages:r.providerPages,movements:r.providerCount,closed:r.providerClosed,cursor:r.providerCursor},audit:{pages:r.auditPages,closed:r.auditClosed,cursor:r.auditCursor,stage:r.auditStage},
      changedSources:r.changedCount,unknownFacts:r.unknownCount,scopeOnly:true,liveScansAreAsOfSnapshot:false,externalExhaustivenessVerified:false,
      connectedPayoutsIncluded:r.scope.accountKind==='connected',otherAccountsReconciled:false,epochQualification:r.epochQualification,
      ...(r.scope.nativeCapture?{nativeCapture:{...r.scope.nativeCapture,readMode:'firestore_read_only_at_read_time',authorityReadMode:'current',
        nativeAccountReferenceReadMode:'captured_at_read_time',providerObservationReadMode:'current_get',knownSourcesOnly:true,sourceSetExhaustive:false,writerDrainQualified:false,
        periodCoveredByNativeCapture:r.scope.nativeCapture.readTime.seconds>=r.scope.period.toSeconds,
        state:r.nativeCaptureFailure?'read_time_unavailable':r.nativeClosed&&r.auditClosed?'captured_known_sources_complete':'capture_in_progress',lastFailureReason:r.nativeCaptureFailure??null}}:{}),
      snapshotMissingProofs:['qualified_external_epoch_manifest','writer_drain_covering_entire_capture','complete_native_source_set_bound_to_manifest']},
    ...(globalControlBalanceEnabled(r.scope)?{controlBalance:globalControlBalanceView(r.controlBalance)}:{}),
    groups:r.groups,qualification:r.state==='sealed'?'documented_with_unknowns':'in_progress',openingClosing:{qualification:r.boundaryQualification,
      provided:r.scope.boundaries,providerStatementsVerified:r.statement?.openingClosingQualified===true,statement:r.statement?{...r.statement,startedAt:at(r.statement.startedAt),observedAt:at(r.statement.observedAt)}:null,
      liveProviderBridgeQualified:providerFlowComparison(r).qualification==='observed_provider_flow_matches_statement',providerFlowComparison:providerFlowComparison(r)},financialTotalsAcrossLedgersProvided:false};
}
function validRun(raw:any):raw is Run{return raw?.protocol===GLOBAL_FINANCIAL_RECONCILIATION_CAPABILITY&&id(raw.actorId)&&id(raw.requestId)&&
  (!own(raw.scope,'coverageMode')||raw.scope.coverageMode==='complete_known_sources_v1'&&raw.scope.nativeCapture?.protocol==='firestore_read_time_v1'&&
    integer(raw.scope.nativeCapture.readTime?.seconds)&&raw.scope.nativeCapture.readTime.seconds>0&&integer(raw.scope.nativeCapture.readTime?.nanoseconds)&&
    raw.scope.nativeCapture.readTime.nanoseconds>=0&&raw.scope.nativeCapture.readTime.nanoseconds<1e9&&raw.scope.nativeCapture.readTime.nanoseconds%1000===0)&&
  (!own(raw.scope,'controlBalanceMode')||raw.scope.controlBalanceMode==='global_control_balance_v1'&&completeKnownSources(raw.scope)&&validGlobalControlBalanceState(raw.controlBalance))&&
  hash(raw.scopeHash)&&supportHash(raw.scope)===raw.scopeHash&&integer(raw.version)&&raw.version>=0&&Array.isArray(raw.queue)&&raw.queue.length<=40&&
  ['native','provider','audit','statement','ready'].includes(raw.phase)&&['active','waiting_provider','waiting_native_capture','budget_exhausted','sealed'].includes(raw.state)&&native(raw.createdAt)&&native(raw.updatedAt)&&
  integer(raw.rootIndex)&&raw.rootIndex>=0&&raw.rootIndex<=ROOTS.length&&[raw.nativePages,raw.providerPages,raw.auditPages,raw.sourceCount,raw.referenceCount,raw.providerCount,raw.unknownCount,raw.changedCount].every(cents)&&
  Array.isArray(raw.groups)&&raw.groups.length<=200&&['sources','references'].includes(raw.auditStage)&&raw.queue.every((j:any)=>typeof j.path==='string'&&
    j.path.split('/').length===3&&!!nativeDocument(j.path+'/cursor_check')&&(j.lastId===null||id(j.lastId)))&&
  (raw.lastId===null||id(raw.lastId))&&(raw.providerCursor===null||globalStripeId(raw.providerCursor,'txn'))&&(raw.auditCursor===null||id(raw.auditCursor));}
async function getRun(tx:FirebaseFirestore.Transaction,rid:string,scopeHash:string){
  const raw=(await tx.get(runRef(rid))).data();if(raw?.kind!=='global_financial_reconciliation'||!validRun(raw.run)||raw.run.scopeHash!==scopeHash)
    throw new HttpsError('failed-precondition','Référence de rapprochement native inconnue.');return raw.run;
}
function pageReference(v:any,complete=false){const r=supportObject(v,['id','contentHash']);if(!(complete?/^page_[1-9]\d{0,15}$/.test(r.id)&&cents(Number(r.id.slice(5))):/^page_\d{1,8}$/.test(r.id))||!hash(r.contentHash))throw new HttpsError('invalid-argument','Référence de page requise.');return {id:r.id,contentHash:r.contentHash};}
function sourcePeriod(record:ReturnType<typeof projection>,s:GlobalFinancialScope){const ms=record.recordedAt===null?NaN:Date.parse(record.recordedAt);
  return !Number.isFinite(ms)?'unknown':ms/1000>=s.period.fromSeconds&&ms/1000<s.period.toSeconds?'within_period':'outside_period';}
async function nativePage(tx:FirebaseFirestore.Transaction,rid:string,r:Run,documentary=tx){
  let rootIndex=r.rootIndex,lastId=r.lastId,queue=r.queue.map(j=>({...j}));const job=queue[0];
  if(!job&&rootIndex>=ROOTS.length)return {records:[],claims:[] as {claim:Claim;links:Link[]}[],issues:[] as string[],next:{rootIndex,lastId,queue},closed:true};
  const collection=job?db.collection(job.path):db.collection(ROOTS[rootIndex]);let query:FirebaseFirestore.Query=collection.orderBy('__name__').limit(GLOBAL_FINANCIAL_LIMITS.nativePageSize+1);
  const cursor=job?job.lastId:lastId;if(cursor)query=query.startAfter(cursor);const page=await tx.get(query),selected=page.docs.slice(0,GLOBAL_FINANCIAL_LIMITS.nativePageSize);
  const records:Data[]=[],claims:{claim:Claim;links:Link[]}[]=[],issues:string[]=[];
  for(const doc of selected){const path=doc.ref.path,d=doc.data();let parent:Data|null=null;
    if(job)parent=(await tx.get(db.collection(path.split('/')[0]).doc(path.split('/')[1]))).data()??null;
    const connectedRelevant=r.scope.accountKind==='platform'||(job?path.split('/')[0]==='wallets'&&path.split('/')[1]===r.connectedOwnerId:
      ROOTS[rootIndex]==='withdrawal_requests'&&d.stripeAccountId===r.scope.accountId||ROOTS[rootIndex]==='wallets'&&doc.id===r.connectedOwnerId);
    if(!connectedRelevant)continue;
    const record=projection(path,d,parent),period=sourcePeriod(record,r.scope),facts=await nativeClaims(tx,record,d,parent,r.scope);
    const knownIrrelevant=record.value.irrelevant===true;
    if(!knownIrrelevant){const prior=await documentary.get(sourceRef(rid,path));if(prior.exists)issues.push('native_source_seen_twice');
      records.push({...record,periodQualification:period,issues:facts.issues,firstSeenAt:Timestamp.now()});claims.push(...facts.claims);
      if(period==='unknown'||record.value.projectionUnknown||facts.issues.length)issues.push('native_financial_source_unknown');}
    if(!job)for(const child of CHILDREN[ROOTS[rootIndex]]??[])queue.push({path:path+'/'+child,lastId:null});
  }
  const more=page.size>GLOBAL_FINANCIAL_LIMITS.nativePageSize,last=selected.at(-1)?.id??cursor;
  if(job){if(more)queue[0].lastId=last;else queue.shift();}else if(more)lastId=last;else{rootIndex++;lastId=null;}
  return {records,claims,issues,next:{rootIndex,lastId,queue},closed:queue.length===0&&rootIndex>=ROOTS.length};
}

type RunReference={runId:string;scopeHash:string};
type PageReference={id:string;contentHash:string};
export type GlobalFinancialCommandReceipt={protocol:'global_financial_command_receipt_v1';actorId:string;requestId:string;action:'prepare'|'advance'|'seal';inputHash:string;
  runReference:RunReference;status:'completed'|'pending'|'unknown'|'not_executed';versionBefore:number;versionAfter:number;pageReference:PageReference|null;createdAt:string;completedAt:string|null;
  disposition:null|{reason:string;observedVersion:number}};
type Entry={entryId:string;kind:'native_source'|'provider_movement'|'source_audit'|'reference_audit'|'provider_statement';qualification:string;reasonCodes:string[];
  source:null|{path:string;sourceHash:string};providerMovementId:string|null;contractReferences:string[];amountCents:number|null;feeCents:number|null;netCents:number|null;
  currency:'CAD'|null;balanceType:string|null;type:string|null;reportingCategory:string|null};
export type GlobalFinancialPageView={protocol:'global_financial_page_v1';runReference:RunReference;reference:PageReference;sequence:number;phase:'native'|'provider'|'audit'|'statement'|'ready';createdAt:string;entries:Entry[]};
export type GlobalFinancialReportView=ReturnType<typeof reportView>;
const entry=(entryId:string,kind:Entry['kind'],qualification:string,reasonCodes:string[],extra:Partial<Entry>={}):Entry=>({entryId,kind,qualification,
  reasonCodes:[...new Set(reasonCodes)].slice(0,30),source:null,providerMovementId:null,contractReferences:[],amountCents:null,feeCents:null,netCents:null,currency:null,
  balanceType:null,type:null,reportingCategory:null,...extra});
const commandRef=(rid:string,uid:string,requestId:string)=>sub(rid,'commands').doc(supportHash([uid,requestId]));
const makeRunId=(uid:string,requestId:string)=>'gfr_'+supportHash([GLOBAL_FINANCIAL_RECONCILIATION_CAPABILITY,uid,requestId]);
function runReference(value:any):RunReference{const r=supportObject(value,['runId','scopeHash']);
  if(typeof r.runId!=='string'||!/^gfr_[a-f0-9]{64}$/.test(r.runId)||!hash(r.scopeHash))throw new HttpsError('invalid-argument','Référence native de rapport requise.');
  return {runId:r.runId,scopeHash:r.scopeHash};}
function qualifiedCommand(c:any,ref:RunReference,uid:string,requestId:string){return c?.protocol==='global_financial_command_receipt_v1'&&c.actorId===uid&&c.requestId===requestId&&
  supportHash(c.runReference)===supportHash(ref)&&['prepare','advance','seal'].includes(c.action)&&hash(c.inputHash)&&c.inputHash===supportHash(c.input)&&
  c.input?.action===c.action&&c.input?.actorId===uid&&c.input?.requestId===requestId&&supportHash(c.input?.runReference)===supportHash(ref)&&
  ['completed','pending','unknown','not_executed'].includes(c.status)&&cents(c.versionBefore)&&cents(c.versionAfter)&&c.input.expectedVersion===c.versionBefore&&native(c.createdAt)&&
  (c.status==='not_executed'?c.action!=='prepare'&&native(c.completedAt)&&c.completedAt.toMillis()>=c.createdAt.toMillis()&&c.versionAfter===c.versionBefore&&
    c.pageReference===null&&c.attempts===0&&cents(c.disposition?.observedVersion)&&
    ['version_changed','report_sealed','lease_owned_by_another_command','another_command_pending','report_requires_seal'].includes(c.disposition?.reason):
    c.status==='completed'?native(c.completedAt)&&c.versionAfter>=c.versionBefore:c.completedAt===null&&c.versionAfter===c.versionBefore);}
function receiptView(c:Data|null){return c?{protocol:c.protocol,actorId:c.actorId,requestId:c.requestId,action:c.action,inputHash:c.inputHash,runReference:c.runReference,
  status:c.status,versionBefore:c.versionBefore,versionAfter:c.versionAfter,pageReference:c.pageReference??null,createdAt:at(c.createdAt),completedAt:at(c.completedAt),disposition:c.disposition??null}:null;}
function checkedReceipt(c:Data|undefined,ref:RunReference,uid:string,rid:string,inputHash?:string){
  if(c&&!qualifiedCommand(c,ref,uid,rid)||c&&inputHash&&c.inputHash!==inputHash)throw new HttpsError('already-exists','Cette commande possède une autre source native.');return c??null;
}
function command(uid:string,rid:string,action:string,ref:RunReference,version:number,scope?:GlobalFinancialScope){
  const input={actorId:uid,requestId:rid,action,runReference:ref,expectedVersion:version,...scope?{scope}:{}};
  return {protocol:'global_financial_command_receipt_v1',actorId:uid,requestId:rid,action,runReference:ref,input,inputHash:supportHash(input),status:'pending',
    versionBefore:version,versionAfter:version,pageReference:null,createdAt:Timestamp.now(),completedAt:null,attempts:0,disposition:null};
}
function guardBytes(value:any,max:number){if(Buffer.byteLength(JSON.stringify(value),'utf8')>max)throw new HttpsError('resource-exhausted','La preuve bornée dépasse la taille autorisée.');}
function storedPage(rid:string,r:Run,entries:Entry[],phase:Run['phase']){
  const core={protocol:'global_financial_page_v1',runReference:{runId:rid,scopeHash:r.scopeHash},sequence:r.version+1,phase,createdAt:at(Timestamp.now()),entries};
  const reference={id:'page_'+core.sequence,contentHash:supportHash(core)},view={...core,reference};guardBytes(view,GLOBAL_FINANCIAL_LIMITS.maxPageBytes);return {view,reference};
}
async function referencePlans(tx:FirebaseFirestore.Transaction,rid:string,scopeHash:string,facts:{claim:Claim;links:Link[]}[]){
  const pending=new Map<string,{ref:FirebaseFirestore.DocumentReference;data:Data;created:boolean}>(),issues:string[]=[];
  for(const {claim,links}of facts)for(const link of links){const ref=linkRef(rid,link.kind,link.id);let plan=pending.get(ref.id);
    if(!plan){const raw=(await tx.get(ref)).data();if(raw&&(raw.protocol!=='global_financial_reference_v1'||raw.scopeHash!==scopeHash||raw.kind!==link.kind||raw.providerId!==link.id||
        !Array.isArray(raw.claims)||raw.claims.length>GLOBAL_FINANCIAL_LIMITS.maxClaimsPerReference||!Array.isArray(raw.movementIds)||raw.movementIds.length>20)){
        issues.push('native_reference_index_unqualified');continue;}
      plan={ref,data:raw?{...raw,claims:[...raw.claims],movementIds:[...raw.movementIds]}:{protocol:'global_financial_reference_v1',scopeHash,kind:link.kind,providerId:link.id,claims:[],movementIds:[]},created:!raw};pending.set(ref.id,plan);}
    if(!plan.data.claims.some((v:Claim)=>supportHash(v)===supportHash(claim))){
      if(plan.data.claims.length>=GLOBAL_FINANCIAL_LIMITS.maxClaimsPerReference){issues.push('native_reference_claim_coverage_saturated');plan.data.saturated=true;}
      else plan.data.claims.push(claim);}
  }
  return {plans:[...pending.values()],issues,created:[...pending.values()].filter(p=>p.created).length};
}
async function currentRecord(tx:FirebaseFirestore.Transaction,path:string){const ref=nativeDocument(path);if(!ref)return null;const raw=(await tx.get(ref)).data();if(!raw)return null;
  const a=path.split('/'),parent=a.length===4?(await tx.get(db.collection(a[0]).doc(a[1]))).data()??null:null;return {record:projection(path,raw,parent),raw,parent};}
function primaryLinks(row:Data,s:GlobalFinancialScope):Link[]{const kinds=row.sourceObject==='charge'?(s.accountKind==='connected'?['tr']:['pi','ch']):
  row.sourceObject==='refund'?['re']:row.sourceObject==='dispute'?['du']:row.sourceObject==='payout'?['po']:row.sourceObject==='transfer_reversal'?['trr']:row.sourceObject==='transfer'?['tr']:[];
  return (row.links??[]).filter((v:any)=>kinds.includes(v.kind)&&globalStripeId(v.id,v.kind));}
async function attributeMovement(tx:FirebaseFirestore.Transaction,rid:string,r:Run,row:Data,financial=tx){
  const reasons:string[]=[...(row.reasons??[])],refs:{ref:FirebaseFirestore.DocumentReference;data:Data}[]=[],claims:Claim[]=[];
  for(const link of primaryLinks(row,r.scope)){const ref=linkRef(rid,link.kind,link.id),d=(await tx.get(ref)).data();
    if(!d)continue;if(d.protocol!=='global_financial_reference_v1'||d.scopeHash!==r.scopeHash||d.kind!==link.kind||d.providerId!==link.id||
      !Array.isArray(d.claims)||d.claims.length>GLOBAL_FINANCIAL_LIMITS.maxClaimsPerReference||d.saturated===true||!Array.isArray(d.movementIds)||d.movementIds.length>20){reasons.push('native_reference_coverage_unknown');continue;}
    refs.push({ref,data:d});claims.push(...d.claims);}
  const contracts=[...new Set(claims.map(c=>c.contract))];if(contracts.length!==1)reasons.push(contracts.length?'native_provider_reference_ambiguous':'provider_movement_unattributed');
  let valid=false;const seen=new Set<string>();
  for(const c of claims){if(!id(c.sourcePath?.split('/').at(-1))||!hash(c.sourceHash)){reasons.push('native_claim_shape_unknown');continue;}
    const key=supportHash(c);if(seen.has(key))continue;seen.add(key);const now=await currentRecord(financial,c.sourcePath);
    if(!now||now.record.sourceHash!==c.sourceHash){reasons.push('native_source_changed_since_capture');continue;}
    const fresh=await nativeClaims(financial,now.record,now.raw,now.parent,r.scope);
    if(!fresh.claims.some(v=>supportHash(v.claim)===key)){reasons.push('native_claim_changed_since_capture');continue;}
    const amount=Number.isSafeInteger(row.amountCents)?Math.abs(row.amountCents):null;
    let exact=c.qualified===true&&c.amountCents===amount;
    if(row.facts?.paymentIntentId!=null&&c.paymentIntentId!==row.facts.paymentIntentId)exact=false;
    if(row.facts?.chargeId!=null&&c.chargeId!==null&&c.chargeId!==row.facts.chargeId)exact=false;
    if(c.kind==='withdrawal'){
      exact=exact&&globalStripeId(c.accountId,'acct')&&(r.scope.accountKind==='platform'?row.facts?.destinationAccountId==null||row.facts.destinationAccountId===c.accountId:c.accountId===r.scope.accountId);
      if(row.sourceObject==='payout'&&row.facts?.destinationHash!==now.record.value.destinationHash)exact=false;
    }
    if(exact)valid=true;else reasons.push('native_provider_amount_or_edge_unknown');
    if(!['native_payment_recorded','native_payee_credit_recorded','native_forfait_and_revenue_recorded','native_local_settlement_recorded','native_repair_recorded',
      'native_swap_refund_recorded','native_payout_completion_recorded','native_compensation_recorded','native_debit_recorded'].includes(c.localQualification))reasons.push(c.localQualification);
  }
  if(!valid&&contracts.length===1)reasons.push('native_association_not_qualified');
  const unique=[...new Set(reasons)],qualified=contracts.length===1&&valid&&unique.length===0&&row.providerEdgeQualified===true;
  return {entry:entry(row.id,'provider_movement',qualified?'native_provider_edge_observed':'unknown',unique,{providerMovementId:row.id,contractReferences:contracts.slice(0,8),
    amountCents:row.amountCents,feeCents:row.feeCents,netCents:row.netCents,currency:row.currency,balanceType:row.balanceType,type:row.type,reportingCategory:row.reportingCategory}),refs,qualified};
}
function addGroups(groups:Data[],rows:Data[]){const next=groups.map(g=>({...g}));let unknown=0;
  for(const row of rows){if(!row.arithmeticQualified||row.reasons?.includes('provider_movement_changed_during_read')){unknown++;continue;}
    const identity={balanceType:row.balanceType,status:row.status,type:row.type,reportingCategory:row.reportingCategory,currency:'CAD'},key=supportHash(identity);
    let group=next.find(g=>g.groupHash===key);if(!group){if(next.length>=200){unknown++;continue;}group={...identity,groupHash:key,movements:0,
      amountCents:0,feeCents:0,netCents:0,qualification:'observed_provider_movements_only',nativeLedgerIncluded:false};next.push(group);}
    if(![group.amountCents+row.amountCents,group.feeCents+row.feeCents,group.netCents+row.netCents].every(integer)){unknown++;group.qualification='unknown_arithmetic_overflow';continue;}
    group.movements++;group.amountCents+=row.amountCents;group.feeCents+=row.feeCents;group.netCents+=row.netCents;
  }return {groups:next,unknown};
}
async function auditPage(tx:FirebaseFirestore.Transaction,rid:string,r:Run,financial=tx){
  let query:FirebaseFirestore.Query=sub(rid,r.auditStage).orderBy('__name__').limit(GLOBAL_FINANCIAL_LIMITS.nativePageSize+1);if(r.auditCursor)query=query.startAfter(r.auditCursor);
  const page=await tx.get(query),selected=page.docs.slice(0,GLOBAL_FINANCIAL_LIMITS.nativePageSize),entries:Entry[]=[];let changed=0;
  for(const doc of selected){const d=doc.data();if(r.auditStage==='sources'){
      const now=await currentRecord(financial,d.path);let consistent=now?.record.sourceHash===d.sourceHash;
      if(consistent&&now){const fresh=await nativeClaims(financial,now.record,now.raw,now.parent,r.scope);consistent=supportHash(fresh)===d.claimsHash;}
      if(!consistent)changed++;entries.push(entry(doc.id,'source_audit',consistent?'source_reobserved':'unknown',consistent?[]:['native_source_changed_or_missing'],
        {source:typeof d.path==='string'&&hash(d.sourceHash)?{path:d.path,sourceHash:d.sourceHash}:null}));
    }else{const cs=Array.isArray(d.claims)?d.claims:[],hasMovement=Array.isArray(d.movementIds)&&d.movementIds.length>0,expected=cs.some((c:Claim)=>c.qualified===true&&c.periodQualification==='within_period');
      const reasons=d.saturated?['native_reference_claim_coverage_saturated']:!hasMovement&&expected?['native_reference_not_observed_in_provider_scope']:
        !hasMovement&&cs.some((c:Claim)=>c.qualified===true&&c.periodQualification==='unknown')?['native_reference_causal_period_unknown']:[];
      for(const c of cs.slice(0,GLOBAL_FINANCIAL_LIMITS.maxClaimsPerReference)){const now=typeof c.sourcePath==='string'?await currentRecord(financial,c.sourcePath):null;
        if(!now||now.record.sourceHash!==c.sourceHash||!(await nativeClaims(financial,now.record,now.raw,now.parent,r.scope)).claims.some(v=>supportHash(v.claim)===supportHash(c)))
          reasons.push('native_reference_causal_source_changed');}
      entries.push(entry(doc.id,'reference_audit',reasons.length?'unknown':'recorded_reference_reviewed',reasons,{contractReferences:[...new Set(cs.map((c:Claim)=>c.contract))].slice(0,8) as string[]}));}
  }
  const closed=page.size<=GLOBAL_FINANCIAL_LIMITS.nativePageSize,stage=r.auditStage==='sources'&&closed?'references':r.auditStage;
  return {entries,changed,nextCursor:closed?null:selected.at(-1)!.id,stage,closed:closed&&r.auditStage==='references'};
}

/** Final disclosure always requalifies the current private role. A historical
 * command grants its actor an opaque receipt, never its former report body. */
async function response(request:any,ref:RunReference,requestId:string|null=null,page:PageReference|null=null){
  return db.runTransaction(async tx=>{await assertPrivateAccountSession(request,tx);const r=await getRun(tx,ref.runId,ref.scopeHash),uid=request.auth.uid;
    const c=requestId?checkedReceipt((await tx.get(commandRef(ref.runId,uid,requestId))).data(),ref,uid,requestId):null;
    let admin=true;try{await authority(tx,request);}catch(error){if(error instanceof HttpsError&&error.code==='permission-denied')admin=false;else throw error;}
    if(!admin&&r.actorId!==uid&&!c)throw new HttpsError('permission-denied','Reçu propre requis.');
    let pageView:Data|null=null;if(page&&admin){const p=(await tx.get(sub(ref.runId,'pages').doc(page.id))).data();
      const {reference,...core}=p?.view??{};if(!p||p.protocol!=='global_financial_page_record_v1'||supportHash(core)!==page.contentHash||
        reference?.id!==page.id||reference.contentHash!==page.contentHash||supportHash(core.runReference)!==supportHash(ref))throw new HttpsError('failed-precondition','Page native non qualifiée.');pageView=p.view;}
    return {runReference:ref,unrecorded:false,reportView:reportView(ref.runId,r,!admin),commandReceipt:receiptView(c),pageView};
  });
}
function finishCommand(c:Data,r:Run,page:PageReference|null){return {...c,status:'completed',versionAfter:r.version,pageReference:page,completedAt:Timestamp.now()};}
function writeRun(tx:FirebaseFirestore.Transaction,rid:string,r:Run){
  if(completeKnownSources(r.scope)&&!validRun(r))throw new HttpsError('resource-exhausted','Les compteurs natifs doivent rester des entiers sûrs.');
  guardBytes(r,GLOBAL_FINANCIAL_LIMITS.maxRunBytes);tx.update(runRef(rid),{run:r,updatedAt:r.updatedAt});}
function writePage(tx:FirebaseFirestore.Transaction,rid:string,page:ReturnType<typeof storedPage>){tx.create(sub(rid,'pages').doc(page.reference.id),{protocol:'global_financial_page_record_v1',view:page.view});}
function advanceRun(r:Run,page:ReturnType<typeof storedPage>,changes:Partial<Run>):Run{return {...r,...changes,...(r.scope.nativeCapture?{nativeCaptureFailure:null}:{}),version:r.version+1,lastPage:page.reference,updatedAt:Timestamp.now(),lease:null,pendingCommand:null};}
async function prepareReport(request:any,scope:GlobalFinancialScope,requestId:string){
  const uid=request.auth.uid,ref={runId:makeRunId(uid,requestId),scopeHash:supportHash(scope)},c=command(uid,requestId,'prepare',ref,0,scope);
  await db.runTransaction(async tx=>{await assertPrivateAccountSession(request,tx);const raw=(await tx.get(runRef(ref.runId))).data(),old=checkedReceipt((await tx.get(commandRef(ref.runId,uid,requestId))).data(),ref,uid,requestId,c.inputHash);
    if(raw||old){if(!raw||raw.kind!=='global_financial_reconciliation'||!validRun(raw.run)||!old||old.status!=='completed'||raw.run.scopeHash!==ref.scopeHash)
      throw new HttpsError('failed-precondition','Reçu de création incomplet.');return;}
    await authority(tx,request);assertRecentAccountAuthentication(request.auth.token);const ownerId=await nativeRead(scope,tx,request,financial=>connectedOwner(financial,scope)),now=Timestamp.now();
    const run:Run={protocol:GLOBAL_FINANCIAL_RECONCILIATION_CAPABILITY,actorId:uid,requestId,scope,scopeHash:ref.scopeHash,version:0,state:'active',phase:'native',rootIndex:0,lastId:null,queue:[],
      providerCursor:null,auditCursor:null,auditStage:'sources',nativePages:0,providerPages:0,auditPages:0,sourceCount:0,referenceCount:0,providerCount:0,unknownCount:1,changedCount:0,
      nativeClosed:false,providerClosed:false,auditClosed:false,groups:[],lastPage:null,createdAt:now,updatedAt:now,lease:null,pendingCommand:null,connectedOwnerId:ownerId,statement:null,
      epochQualification:'unknown',boundaryQualification:scope.boundaries?'declared_unverified':'unknown',
      ...(globalControlBalanceEnabled(scope)?{controlBalance:initialGlobalControlBalanceState(scope)!}:{})};
    guardBytes(run,GLOBAL_FINANCIAL_LIMITS.maxRunBytes);tx.create(runRef(ref.runId),{kind:'global_financial_reconciliation',status:'open',run,createdAt:now,updatedAt:now});
    tx.create(commandRef(ref.runId,uid,requestId),finishCommand(c,run,null));});return response(request,ref,requestId);
}

async function preserveCaptureFailure<T>(request:any,ref:RunReference,requestId:string,initial:Data,expectedVersion:number,fn:()=>Promise<T>):Promise<T|null>{
  try{return await fn();}catch(error){
    if(!(error instanceof NativeCaptureUnavailable))throw error;
    await db.runTransaction(async tx=>{await authority(tx,request);const r=await getRun(tx,ref.runId,ref.scopeHash),cref=commandRef(ref.runId,request.auth.uid,requestId),
      old=checkedReceipt((await tx.get(cref)).data(),ref,request.auth.uid,requestId,initial.inputHash);
      if(!r.scope.nativeCapture)throw error;
      if(old?.status==='completed'||old?.status==='not_executed'||r.version!==expectedVersion||r.pendingCommand&&r.pendingCommand.id!==cref.id)return;
      // No page, cursor, version or prior pending identity is consumed. A
      // permanently expired point requires a separately prepared new report.
      writeRun(tx,ref.runId,{...r,state:'waiting_native_capture',nativeCaptureFailure:error.reason,lease:null,
        pendingCommand:{id:cref.id,inputHash:initial.inputHash},updatedAt:Timestamp.now()});
      tx.set(cref,{...(old??initial),status:'unknown',lastReason:error.reason});
    });
    return null;
  }
}
function pauseControl(tx:FirebaseFirestore.Transaction,rid:string,r:Run,cref:FirebaseFirestore.DocumentReference,c:Data,reason:string){
  writeRun(tx,rid,{...r,controlBalance:{...r.controlBalance!,lastFailureReason:reason},lease:null,pendingCommand:{id:cref.id,inputHash:c.inputHash},updatedAt:Timestamp.now()});
  tx.set(cref,{...c,status:'unknown',lastReason:reason});
}
async function advanceReport(request:any,ref:RunReference,requestId:string,expectedVersion:number,seal:boolean){
  const uid=request.auth.uid,action=seal?'seal':'advance',initial=command(uid,requestId,action,ref,expectedVersion),cref=commandRef(ref.runId,uid,requestId);
  const start=await preserveCaptureFailure(request,ref,requestId,initial,expectedVersion,()=>db.runTransaction(async tx=>{await assertPrivateAccountSession(request,tx);const r=await getRun(tx,ref.runId,ref.scopeHash),old=checkedReceipt((await tx.get(cref)).data(),ref,uid,requestId,initial.inputHash);
    if(old?.status==='completed'||old?.status==='not_executed')return {external:false};
    await authority(tx,request);assertRecentAccountAuthentication(request.auth.token);
    // Only an ABSENT command can be disposed without execution. A native
    // lease/intent naming this key is not absence, even if its receipt is lost.
    if(!old&&(r.pendingCommand?.id===cref.id||r.lease?.commandId===cref.id))throw new HttpsError('failed-precondition','L’intention documentaire native doit être rapprochée.');
    const leaseActive=!!r.lease&&integer(r.lease.expiresAtMs)&&r.lease.expiresAtMs>Date.now();
    const disposition=!old?(r.version!==expectedVersion?'version_changed':r.state==='sealed'?'report_sealed':
      r.pendingCommand&&r.pendingCommand.id!==cref.id?'another_command_pending':leaseActive?'lease_owned_by_another_command':
        !seal&&(r.state==='budget_exhausted'||r.phase==='ready')?'report_requires_seal':null):null;
    if(disposition){
      // This immutable receipt also bars a delayed execute of the exact tuple.
      // It never overwrites an already authorized pending/unknown operation.
      tx.create(cref,{...initial,status:'not_executed',completedAt:Timestamp.now(),disposition:{reason:disposition,observedVersion:r.version}});
      return {external:false};
    }
    if(r.version!==expectedVersion||r.state==='sealed')throw new HttpsError('failed-precondition','La version native a changé.');
    if(leaseActive)return {external:false};
    if(r.pendingCommand&&r.pendingCommand.id!==cref.id)throw new HttpsError('failed-precondition','Reprenez la commande documentaire précédente avant de sceller ou avancer.');
    const c=old??initial;
    if(seal){const p=storedPage(ref.runId,r,[entry('seal','reference_audit','documentary_only',[r.scope.nativeCapture?'known_source_capture_is_not_exhaustive_balance_proof':'live_scans_do_not_prove_as_of_snapshot',
        ...!r.nativeClosed?['native_coverage_incomplete']:[],...!r.providerClosed?['provider_coverage_incomplete']:[],...!r.auditClosed?['source_recheck_incomplete']:[],
        ...r.statement?.openingClosingQualified===true?[]:['opening_closing_unknown']])],r.phase);
      const n=advanceRun(r,p,{state:'sealed',unknownCount:r.unknownCount+(!r.nativeClosed||!r.providerClosed||!r.auditClosed?1:0)});writePage(tx,ref.runId,p);writeRun(tx,ref.runId,n);tx.set(cref,finishCommand(c,n,p.reference));return {external:false};}
    if(r.state==='budget_exhausted'||r.phase==='ready')throw new HttpsError('failed-precondition','Le parcours documentaire est à sceller explicitement.');
    if(r.phase==='native'){
      if(r.controlBalance&&['opening','sources'].includes(r.controlBalance.stage)){
        const plan=await prepareGlobalControlNativePage(tx,fn=>nativeRead(r.scope,tx,request,fn),ref.runId,r.scope,r.controlBalance,()=>authority(tx,request),r.connectedOwnerId);
        if(plan.reason){pauseControl(tx,ref.runId,r,cref,c,plan.reason);return {external:false};}
        const p=storedPage(ref.runId,r,plan.entries as Entry[],'native'),n=advanceRun(r,p,{controlBalance:plan.state,nativePages:r.nativePages+1,state:'active'});
        plan.commit();writePage(tx,ref.runId,p);writeRun(tx,ref.runId,n);tx.set(cref,finishCommand(c,n,p.reference));return {external:false};
      }
      const npage=await nativeRead(r.scope,tx,request,financial=>nativePage(financial,ref.runId,r,tx)),refs=await referencePlans(tx,ref.runId,r.scopeHash,npage.claims),over=!completeKnownSources(r.scope)&&(r.nativePages>=GLOBAL_FINANCIAL_LIMITS.maxNativePages||
        r.sourceCount+npage.records.length>GLOBAL_FINANCIAL_LIMITS.maxSources||r.referenceCount+refs.created>GLOBAL_FINANCIAL_LIMITS.maxReferences);
      const entries=over?[entry('budget','native_source','unknown',['native_coverage_budget_exhausted'])]:npage.records.map(d=>entry(supportHash(d.path),'native_source',
        d.issues.length||d.periodQualification==='unknown'||d.value.projectionUnknown?'unknown':'native_record_observed',d.issues.length?d.issues:d.periodQualification==='unknown'?['native_period_unknown']:[],
        {source:{path:d.path,sourceHash:d.sourceHash},contractReferences:[...new Set(npage.claims.filter(v=>v.claim.sourcePath===d.path).map(v=>v.claim.contract))],
          amountCents:cents(d.value.amountCents)?d.value.amountCents:null,currency:['cad','CAD'].includes(d.value.currency)?'CAD':null,type:d.value.type??null}));
      const p=storedPage(ref.runId,r,entries,'native'),n=advanceRun(r,p,over?{state:'budget_exhausted',unknownCount:r.unknownCount+1}:{...npage.next,nativePages:r.nativePages+1,
        sourceCount:r.sourceCount+npage.records.length,referenceCount:r.referenceCount+refs.created,nativeClosed:npage.closed,phase:npage.closed?'provider':'native',unknownCount:r.unknownCount+npage.issues.length+refs.issues.length});
      if(!over){for(const d of npage.records){const facts=npage.claims.filter(v=>v.claim.sourcePath===d.path);tx.create(sourceRef(ref.runId,d.path),{...d,claimsHash:supportHash({claims:facts,issues:d.issues})});}
        for(const plan of refs.plans)tx.set(plan.ref,plan.data);}
      writePage(tx,ref.runId,p);writeRun(tx,ref.runId,n);tx.set(cref,finishCommand(c,n,p.reference));return {external:false};
    }
    if(r.phase==='audit'){
      if(r.controlBalance&&r.auditClosed&&r.controlBalance.stage!=='complete'){
        const plan=await prepareGlobalControlAuditPage(tx,ref.runId,r.scope,r.controlBalance,()=>authority(tx,request));
        if(plan.reason){pauseControl(tx,ref.runId,r,cref,c,plan.reason);return {external:false};}
        const p=storedPage(ref.runId,r,plan.entries as Entry[],'audit'),n=advanceRun(r,p,{controlBalance:plan.state,auditPages:r.auditPages+1,phase:plan.state.stage==='complete'?'statement':'audit',state:'active'});
        plan.commit();writePage(tx,ref.runId,p);writeRun(tx,ref.runId,n);tx.set(cref,finishCommand(c,n,p.reference));return {external:false};
      }
      const over=!completeKnownSources(r.scope)&&r.auditPages>=GLOBAL_FINANCIAL_LIMITS.maxAuditPages,a=over?{entries:[entry('budget','source_audit','unknown',['audit_coverage_budget_exhausted'])],changed:0,nextCursor:r.auditCursor,stage:r.auditStage,closed:false}:await nativeRead(r.scope,tx,request,financial=>auditPage(tx,ref.runId,r,financial));
      const p=storedPage(ref.runId,r,a.entries,'audit'),n=advanceRun(r,p,{auditPages:r.auditPages+(over?0:1),auditCursor:a.nextCursor,auditStage:a.stage,auditClosed:a.closed,phase:a.closed&&!r.controlBalance?'statement':'audit',
        changedCount:r.changedCount+a.changed,unknownCount:r.unknownCount+a.entries.filter(e=>e.qualification==='unknown').length,state:over?'budget_exhausted':'active'});
      writePage(tx,ref.runId,p);writeRun(tx,ref.runId,n);tx.set(cref,finishCommand(c,n,p.reference));return {external:false};
    }
    if(!completeKnownSources(r.scope)&&(r.phase==='provider'&&r.providerPages>=GLOBAL_FINANCIAL_LIMITS.maxProviderPages||c.attempts>=GLOBAL_FINANCIAL_LIMITS.maxReadAttempts)){
      const p=storedPage(ref.runId,r,[entry('budget','provider_movement','unknown',['provider_read_coverage_budget_exhausted'])],r.phase),n=advanceRun(r,p,{state:'budget_exhausted',unknownCount:r.unknownCount+1});
      writePage(tx,ref.runId,p);writeRun(tx,ref.runId,n);tx.set(cref,finishCommand(c,n,p.reference));return {external:false};}
    if(completeKnownSources(r.scope)&&(!cents(c.attempts)||c.attempts>=Number.MAX_SAFE_INTEGER))throw new HttpsError('resource-exhausted','Le compteur natif de reprise doit rester un entier sûr.');
    const token=randomUUID(),lease={id:token,commandId:cref.id,expiresAtMs:Date.now()+40000,phase:r.phase,cursor:r.providerCursor,version:r.version};
    writeRun(tx,ref.runId,{...r,lease,pendingCommand:{id:cref.id,inputHash:c.inputHash},updatedAt:Timestamp.now()});
    tx.set(cref,{...c,status:'pending',attempts:(c.attempts??0)+1,leaseId:token});return {external:true,r,token};
  }));
  if(!start?.external||!start.r||!start.token)return response(request,ref,requestId);
  const externalRun=start.r,guard=()=>db.runTransaction(tx=>authority(tx,request));
  const result=externalRun.phase==='statement'?await observeGlobalFinancialStatement(externalRun.scope,guard):await observeGlobalFinancialProviderPage(externalRun.scope,externalRun.providerCursor,guard);
  await preserveCaptureFailure(request,ref,requestId,initial,expectedVersion,()=>db.runTransaction(async tx=>{await authority(tx,request);const r=await getRun(tx,ref.runId,ref.scopeHash),c=checkedReceipt((await tx.get(cref)).data(),ref,uid,requestId,initial.inputHash);
    if(c?.status==='completed')return;if(!c||r.version!==expectedVersion||r.lease?.id!==start.token||r.lease.commandId!==cref.id||r.phase!==externalRun.phase||r.providerCursor!==externalRun.providerCursor)
      throw new HttpsError('aborted','La page documentaire a changé. Reprenez son reçu exact.');
    if(externalRun.phase==='statement'){
      const statement=result as Awaited<ReturnType<typeof observeGlobalFinancialStatement>>,p=storedPage(ref.runId,r,[entry('statement','provider_statement',statement.qualification,
        statement.reason?[statement.reason]:[],{currency:statement.summary?.currency??null,netCents:statement.summary?.periodNetCents??null})],'statement');
      const n=advanceRun(r,p,{phase:'ready',state:'active',statement,unknownCount:r.unknownCount+(statement.openingClosingQualified?0:1)});
      writePage(tx,ref.runId,p);writeRun(tx,ref.runId,n);tx.set(cref,finishCommand(c,n,p.reference));return;
    }
    const provider=result as Awaited<ReturnType<typeof observeGlobalFinancialProviderPage>>;
    if(!provider.complete){writeRun(tx,ref.runId,{...r,state:'waiting_provider',lease:null,updatedAt:Timestamp.now()});tx.set(cref,{...c,status:'unknown',lastReason:provider.reason});return;}
    const entries:Entry[]=[],referenceWrites=new Map<string,{ref:FirebaseFirestore.DocumentReference;data:Data}>(),movementWrites:{ref:FirebaseFirestore.DocumentReference;data:Data}[]=[];let duplicate=false;
    for(const row of provider.rows){const mref=sub(ref.runId,'movements').doc(row.id),prior=await tx.get(mref);
      if(prior.exists){duplicate=true;entries.push(entry(row.id,'provider_movement','unknown',['provider_movement_already_observed'],{providerMovementId:row.id}));continue;}
      const observed=await nativeRead(r.scope,tx,request,financial=>attributeMovement(tx,ref.runId,r,row,financial));entries.push(observed.entry);
      movementWrites.push({ref:mref,data:{protocol:'global_financial_movement_v1',scopeHash:r.scopeHash,provider:row,entry:observed.entry,observedAt:provider.observedAt}});
      for(const ref of observed.refs){let plan=referenceWrites.get(ref.ref.id);if(!plan){plan={ref:ref.ref,data:{...ref.data,movementIds:[...ref.data.movementIds]}};referenceWrites.set(ref.ref.id,plan);}
        if(!plan.data.movementIds.includes(row.id)){if(plan.data.movementIds.length>=20)plan.data.saturated=true;else plan.data.movementIds.push(row.id);}}
    }
    const control=r.controlBalance&&!duplicate?await prepareGlobalControlProviderPage(tx,ref.runId,r.scope,r.controlBalance,provider.rows,()=>authority(tx,request)):null;
    if(control?.reason){pauseControl(tx,ref.runId,r,cref,c,control.reason);return;}
    const p=storedPage(ref.runId,r,entries,'provider'),g=addGroups(r.groups,duplicate?[]:provider.rows),n=advanceRun(r,p,{providerPages:r.providerPages+1,providerCount:r.providerCount+movementWrites.length,
      providerCursor:duplicate?r.providerCursor:provider.nextCursor,providerClosed:!duplicate&&!provider.hasMore,phase:!duplicate&&!provider.hasMore?'audit':'provider',
      ...(control?{controlBalance:control.state}:{}),groups:g.groups,unknownCount:r.unknownCount+entries.filter(e=>e.qualification==='unknown').length+g.unknown,state:duplicate?'budget_exhausted':'active'});
    control?.commit();for(const w of movementWrites)tx.create(w.ref,w.data);for(const w of referenceWrites.values())tx.set(w.ref,w.data);
    writePage(tx,ref.runId,p);writeRun(tx,ref.runId,n);tx.set(cref,finishCommand(c,n,p.reference));
  }));return response(request,ref,requestId);
}

/** Capability dispatched by the existing support callables. No provider POST,
 * wallet/order mutation, repair permission or background job exists here. */
export async function handleGlobalFinancialReconciliation(request:any){return withPrivateAccountSession(request,async()=>{
  const uid=supportUid(request),mode=request.data?.mode,allowed=mode==='capture_point'?['capability','expectedUid','mode','precision']:mode==='prepare'?['capability','expectedUid','mode','requestId','scope']:
    mode==='advance'||mode==='seal'?['capability','expectedUid','mode','runReference','requestId','expectedVersion']:
      mode==='page'?['capability','expectedUid','mode','runReference','pageReference']:['capability','expectedUid','mode','runReference','requestId'];
  const d=supportObject(request.data,allowed);if(d.capability!==GLOBAL_FINANCIAL_RECONCILIATION_CAPABILITY||!['prepare','advance','seal','observe','page','capture_point'].includes(mode))
    throw new HttpsError('invalid-argument','Opération documentaire explicite requise.');
  if(mode==='capture_point'){
    if(own(d,'precision')&&d.precision!=='minute')throw new HttpsError('invalid-argument','Précision du point natif invalide.');
    return capturePoint(request,d.precision);
  }
  if(mode==='prepare')try{return await prepareReport(request,parseGlobalFinancialScope(d.scope),supportRequestId(d.requestId));}
    catch(error){if(!(error instanceof NativeCaptureUnavailable))throw error;throw new HttpsError('unavailable','Ce point natif ne peut plus être lu. Choisissez un nouveau point pour un nouveau rapport.',
      {reason:error.reason,action:'captureNewNativePoint',requestId:d.requestId});}
  const ref=runReference(d.runReference),rid=d.requestId===undefined?null:supportRequestId(d.requestId);
  if(mode==='observe'){
    const absent=await db.runTransaction(async tx=>{await assertPrivateAccountSession(request,tx);const exists=await tx.get(runRef(ref.runId));if(exists.exists)return false;
      if(!rid||ref.runId!==makeRunId(uid,rid))throw new HttpsError('permission-denied','Référence propre de création requise.');return true;});
    if(absent)return {runReference:ref,unrecorded:true,reportView:null,commandReceipt:null,pageView:null};return response(request,ref,rid);
  }
  if(mode==='page'){
    let selected:ReturnType<typeof pageReference>;try{selected=pageReference(d.pageReference);}catch(error){
      // V1 parsing remains exact. Only a qualified opt-in run may name a page
      // sequence beyond the old eight-digit syntax; no artificial total cap.
      if(typeof d.pageReference?.id!=='string'||!/^page_[1-9]\d{8,15}$/.test(d.pageReference.id)||!hash(d.pageReference.contentHash))throw error;
      const complete=await db.runTransaction(async tx=>{await authority(tx,request);return completeKnownSources((await getRun(tx,ref.runId,ref.scopeHash)).scope);});
      if(!complete)throw error;selected=pageReference(d.pageReference,true);
    }return response(request,ref,null,selected);
  }
  if(!rid||!cents(d.expectedVersion))throw new HttpsError('invalid-argument','Commande et version natives requises.');
  return advanceReport(request,ref,rid,d.expectedVersion,mode==='seal');
});}
