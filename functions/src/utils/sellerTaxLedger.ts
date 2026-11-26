/** Private factual seller events. Wallet cash, debt and reportable
 * consideration are separate quantities; this module never moves money. */
import {Timestamp} from 'firebase-admin/firestore';
import {HttpsError} from 'firebase-functions/v2/https';
import {db} from '../config/firebase';
import {supportHash,supportSourceHash} from './supportRequest';
import {nativePurchasePaymentSource} from './purchasePolicy';
import {qualifiedCashAgreement} from './cashMeetup';
import {exactCents} from './shippingPurchaseRate';
import {allocationLocalMovementsVerified,readAllocationHistoryIntent,readSettledAllocationIntent,parsePurchaseRefundTerms} from './refundAllocation';
import {qualifiedManualRefundSettlement,type ManualRefundDocuments} from './manualRefundSettlement';

type Data=FirebaseFirestore.DocumentData;
export const SELLER_TAX_POLICY_VERSION='ca_dpi_goods_2026_01';
export const SELLER_TAX_LEDGER_LIMITS={sourcePage:10,eventsPerSnapshot:500,linkedLedgerRows:100} as const;
export const taxId=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&v.length<=128&&!v.includes('/')&&!['.','..'].includes(v);
export const taxHash=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
export const taxCents=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
export const taxNative=(v:unknown):v is Timestamp=>v instanceof Timestamp&&v.toMillis()>0&&v.toMillis()<=Date.now();
export const taxSellerRef=(uid:string)=>db.collection('admin_alerts').doc('tax_seller_'+supportHash(uid));
export const taxOperatorRef=(year:number)=>db.collection('admin_alerts').doc('tax_operator_'+year);
export type SellerTaxSource={kind:'purchase'|'purchase_refund'|'swap';id:string;refundIntentId?:string};
/** Internal writer projection, never accepted by a callable. Documents here
 * are the exact prepared source/ledger/settlement values committed by writer. */
export type SellerTaxFinancialCommit={order:Data;commitTimestamp?:FirebaseFirestore.FieldValue;creditLedger?:{path:string;document:Data}[];
  refund?:{intent:Data;settlement:Data|null;localLedger?:{path:string;document:Data}[];repairRecord?:Data|null;manualDocuments?:ManualRefundDocuments}};
const financialOrderKeys=['buyerId','sellerId','currency','deliveryType','amount','sellerPayout','paidAt','purchasePolicy','purchasePolicyAcceptance',
  'shippingQuoteId','shipEngineRateId','stripePaymentIntentId','stripeChargeId','capturedCardCents','paidVia','walletAmountUsed','walletPayment','totalAmount','nonShipmentPolicyWindow',
  'sellerCreditRecordedAt','sellerCreditedCents','sellerPendingCreditCents','sellerDebtRepaidCents','paymentInventoryReconciliation','refundAllocationState',
  'bankDispute','disputeId','bankRefundReconciliation','manualRefundRestitution'] as const;
/** Read-only projection of the writer's final root patch, including its native
 * nested review fields. This never writes or supplies a recovery witness. */
export function sellerTaxFinancialOrderAfter(order:Data,patch:Data){const out={...order};for(const [path,value]of Object.entries(patch)){
  const [top,...parts]=path.split('.');if(!(financialOrderKeys as readonly string[]).includes(top))continue;
  if(!parts.length){out[top]=value;continue;}let node=out[top]={...(out[top]??{})};for(const p of parts.slice(0,-1))node=node[p]={...(node[p]??{})};node[parts.at(-1)!]=value;
}return out;}
function commitProjection(value:any,pending:unknown,replacement:unknown):any{if(pending!==undefined&&value===pending)return replacement;if(Array.isArray(value))return value.map(v=>commitProjection(v,pending,replacement));
  if(value&&typeof value==='object'&&Object.getPrototypeOf(value)===Object.prototype)return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,commitProjection(v,pending,replacement)]));return value;}
function financialFingerprint(value:SellerTaxFinancialCommit){return supportSourceHash(commitProjection({order:Object.fromEntries(financialOrderKeys.map(k=>[k,value.order[k]??null])),
  creditLedger:value.creditLedger??null,refund:value.refund?{intent:Object.fromEntries(['intentId','buyerId','sellerId','currency','state','providerStatus','stripeRefundId','paymentIntentId',
    'fundsAppliedAt','cardAmountCents','cardConfirmedCents','walletAmountCents','sellerDebitCents','outstandingCardCents','localOutstandingWalletCents','localOutstandingSellerCents',
    'freezeCents','bankWaiting','legacyReconciliationRequired','cardRepairSettlement','manualBankSettlement','allocation'].map(k=>[k,value.refund!.intent[k]??null])),
    settlement:value.refund.settlement,localLedger:value.refund.localLedger??null,repairRecord:value.refund.repairRecord??null,manualDocuments:value.refund.manualDocuments??null}:null},value.commitTimestamp,{clock:'native_commit_timestamp'}));}
function projectedLedger(rows:{path:string;document:Data}[],ownerId:string,id:string){
  if(rows.length>2||rows.some(r=>!r.path.startsWith(`wallets/${ownerId}/ledger/`)||r.path.split('/').length!==4||r.document.transactionId!==id))return null;
  return rows.map(r=>({id:r.path.split('/').at(-1)!,data:()=>r.document}));
}
function prospectiveLocalMovements(id:string,order:Data,intent:Data,allocation:Data,rows:{path:string;document:Data}[]){
  const at=intent.fundsAppliedAt,s=allocation.settlement;if(!taxNative(at)||s?.protocol!=='purchase_refund_allocation_settlement_v1'||s.refundIntentId!==intent.intentId||
    !taxNative(s.appliedAt)||!s.appliedAt.isEqual(at)||s.sellerDebitCents!==intent.sellerDebitCents||rows.length>2)return false;
  const expected=new Set<string>();
  if(intent.walletAmountCents>0){const path=`wallets/${order.buyerId}/ledger/refund_credit_${intent.intentId}`,r=rows.find(r=>r.path===path)?.document;expected.add(path);
    if(!r||r.type!=='refund_credit'||r.amount!==intent.walletAmountCents||r.transactionId!==id||r.refundIntentId!==intent.intentId||!taxNative(r.createdAt)||!r.createdAt.isEqual(at))return false;}
  if(intent.sellerDebitCents>0){const path=`wallets/${order.sellerId}/ledger/refund_debit_${intent.intentId}`,r=rows.find(r=>r.path===path)?.document;expected.add(path);
    if(!r||r.type!=='refund_debit'||!taxCents(r.amount)||!taxCents(r.debtRecorded)||r.amount+r.debtRecorded!==intent.sellerDebitCents||
      r.transactionId!==id||r.refundIntentId!==intent.intentId||!taxNative(r.createdAt)||!r.createdAt.isEqual(at))return false;}
  return rows.length===expected.size&&rows.every(r=>expected.has(r.path));
}
function prospectiveRepair(id:string,order:Data,intent:Data,record:Data|null|undefined){
  const m=intent.cardRepairSettlement,p=record?.proof;if(!record||!m||m.protocol!=='purchase_refund_repair_settlement_v1'||m.refundIntentId!==intent.intentId||
    m.originalRefundId!==intent.stripeRefundId||m.amountCents!==intent.cardAmountCents||!taxNative(m.recordedAt)||record.repairId!==m.repairId||
    record.protocol!=='purchase_refund_repair_record_v1'||record.transactionId!==id||
    record.refundIntentId!==intent.intentId||record.buyerId!==order.buyerId||record.sellerId!==order.sellerId||record.state!=='card_repaired'||record.providerStatus!=='succeeded'||
    record.cardRepairedCents!==intent.cardAmountCents||!taxNative(record.observedAt)||!p||p.qualification!=='current_original_method_capacity'||p.proofHash!==m.proofHash||
    p.paymentIntentId!==intent.paymentIntentId||p.chargeId!==order.stripeChargeId||!Array.isArray(p.refunds)||p.refunds.length>100||
    p.proofHash!==supportHash({paymentIntentId:p.paymentIntentId,chargeId:p.chargeId,amountCapturedCents:p.amountCapturedCents,amountRefundedCents:p.amountRefundedCents,capacityCents:p.capacityCents,refunds:p.refunds})||
    !Array.isArray(record.targetRefundIds))return false;
  const target=p.refunds.filter((r:Data)=>r.id===intent.stripeRefundId||record.targetRefundIds.includes(r.id));
  return target.filter((r:Data)=>r.status==='succeeded').reduce((n:number,r:Data)=>n+r.amountCents,0)===intent.cardAmountCents&&
    target.every((r:Data)=>r.status==='succeeded'||['failed','canceled'].includes(r.status)&&r.failureFundsReturnedToStripe===true)&&
    target.some((r:Data)=>r.id===record.providerRefundId&&r.status==='succeeded')&&intent.providerStatus!=='succeeded';
}
export function taxEventId(s:SellerTaxSource){return 'event_'+supportHash([s.kind,s.id,s.refundIntentId??null]);}
export function taxCalendar(at:unknown,timeZone:string):{year:number;quarter:number}|null{
  if(!taxNative(at)||!['UTC','America/Toronto'].includes(timeZone))return null;
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'numeric'}).formatToParts(at.toDate());
  const year=Number(parts.find(p=>p.type==='year')?.value),month=Number(parts.find(p=>p.type==='month')?.value);
  return Number.isInteger(year)&&month>=1&&month<=12?{year,quarter:Math.floor((month-1)/3)+1}:null;
}
function eventBody(ownerId:string,s:SellerTaxSource){return {protocol:'seller_tax_event_body_v1',ownerId,source:s,activityReference:s.kind==='swap'?'swap:'+s.id:'purchase:'+s.id,
  eventKind:s.kind==='purchase_refund'?'original_period_adjustment':'paid_or_credited',currency:'CAD',effectiveAt:null as Timestamp|null,
  adjustmentRecordedAt:null as Timestamp|null,grossConsiderationCents:null as number|null,platformFeesCents:null as number|null,platformTaxesCents:null as number|null,
  considerationDeltaCents:null as number|null,walletCreditCents:null as number|null,debtOffsetCents:null as number|null,
  activityCountImpact:s.kind==='purchase_refund'?0:1,originalEventId:s.kind==='purchase_refund'?taxEventId({kind:'purchase',id:s.id}):null,
  buyerPaymentRecordedAt:null as Timestamp|null,nonMonetaryValueCents:null as number|null,financialAccountValueIncluded:false};}
/** Caller may use a prospective native credit only before its first write and
 * must persist this SAME Timestamp/amount tuple in the original money commit. */
export async function readSellerTaxSource(tx:FirebaseFirestore.Transaction,ownerId:string,s:SellerTaxSource,
  prospective?:{sellerCreditRecordedAt:Timestamp;sellerCreditedCents:number;sellerPendingCreditCents:number;sellerDebtRepaidCents:number},financial?:SellerTaxFinancialCommit){
  if(!taxId(ownerId)||!s||typeof s!=='object'||!taxId(s.id)||!['purchase','purchase_refund','swap'].includes(s.kind)||s.kind==='purchase_refund'&&!taxId(s.refundIntentId))throw new HttpsError('invalid-argument','Source fiscale native requise.');
  const body=eventBody(ownerId,s),ref=db.collection(s.kind==='swap'?'swaps':'transactions').doc(s.id),nativeOrder=(await tx.get(ref)).data();
  const raw=financial?{...financial.order,...financial.refund?{refund:financial.refund.intent}:{}}:nativeOrder;
  if(financial&&(!nativeOrder||nativeOrder.sellerId!==ownerId||raw?.sellerId!==nativeOrder.sellerId||raw?.buyerId!==nativeOrder.buyerId))throw new HttpsError('failed-precondition','Source fiscale de l’écriture différente.');
  let qualified=false,reason='native_source_unqualified',observation:Data={sourceMissing:!raw};
  if(!raw) return {body,qualified,reason,observationHash:supportSourceHash(observation)};
  if(s.kind==='swap'){
    if(![raw.initiatorId,raw.receiverId].includes(ownerId))throw new HttpsError('permission-denied','Échange privé non autorisé.');
    // Neither the other member's current asking price nor the cash supplement
    // values the goods received. A documented consistent valuation is separate.
    observation={status:raw.status??null,initiatorId:raw.initiatorId??null,receiverId:raw.receiverId??null,
      initiatorReceivedAt:raw.initiatorReceivedAt??null,receiverReceivedAt:raw.receiverReceivedAt??null,
      paidAt:raw.topUpPaidAt??null,payerId:raw.cashTopUp?.payerId??null,topUpCents:raw.cashTopUp?.amount??null};
    body.effectiveAt=taxNative(raw.completedAt)?raw.completedAt:null;reason='barter_consideration_or_valuation_unknown';
    return {body,qualified,reason,observationHash:supportSourceHash(observation)};
  }
  if(raw.sellerId!==ownerId)throw new HttpsError('permission-denied','Vente privée non autorisée.');
  const payment=nativePurchasePaymentSource(raw,s.id),gross=exactCents(raw.sellerPayout??raw.amount),price=exactCents(raw.amount);
  body.buyerPaymentRecordedAt=taxNative(raw.paidAt)?raw.paidAt:null;
  if(raw.deliveryType==='meetup'){
    observation={cashAgreement:qualifiedCashAgreement(s.id,raw)?raw.cashAgreement.agreementId:null,status:raw.status??null,
      completedAt:raw.meetupCompletedAt??null,completedBy:raw.meetupCompletedBy??null,amountCents:price};
    reason='outside_payment_date_and_amount_require_seller_evidence';
    return {body,qualified,reason,observationHash:supportSourceHash(observation)};
  }
  const credit=prospective??raw;
  body.effectiveAt=taxNative(credit.sellerCreditRecordedAt)?credit.sellerCreditRecordedAt:null;
  body.grossConsiderationCents=taxCents(credit.sellerCreditedCents)?credit.sellerCreditedCents:null;
  body.walletCreditCents=taxCents(credit.sellerPendingCreditCents)?credit.sellerPendingCreditCents:null;
  body.debtOffsetCents=taxCents(credit.sellerDebtRepaidCents)?credit.sellerDebtRepaidCents:null;
  const rows=prospective||financial?.creditLedger?null:await tx.get(db.collection('wallets').doc(ownerId).collection('ledger').where('transactionId','==',s.id).limit(101));
  const sourceRows=financial?.creditLedger?projectedLedger(financial.creditLedger,ownerId,s.id):rows?.docs??null;
  const credits=sourceRows?.filter(d=>d.data().type==='sale_credit')??[],debts=sourceRows?.filter(d=>d.data().type==='debt_repayment')??[];
  const matches=(list:{id:string;data:()=>Data}[],amount:number|null)=>amount===0?list.length===0:list.length===1&&list[0].data().amount===amount&&
    taxNative(list[0].data().createdAt)&&taxNative(body.effectiveAt)&&list[0].data().createdAt.isEqual(body.effectiveAt);
  qualified=!!payment&&raw.currency==='CAD'&&gross!==null&&gross>0&&gross===price&&gross===body.grossConsiderationCents&&body.effectiveAt!==null&&
    body.walletCreditCents!==null&&body.debtOffsetCents!==null&&Number.isSafeInteger(body.walletCreditCents+body.debtOffsetCents)&&
    body.walletCreditCents+body.debtOffsetCents===gross&&(!!prospective||!!sourceRows&&sourceRows.length<=100&&matches(credits,body.walletCreditCents)&&matches(debts,body.debtOffsetCents))&&
    raw.paymentInventoryReconciliation==null;
  const componentsKnown=!!payment&&gross!==null&&gross===price&&gross===body.grossConsiderationCents;
  body.platformFeesCents=componentsKnown?0:null;body.platformTaxesCents=componentsKnown?0:null;body.considerationDeltaCents=componentsKnown?gross:null;
  reason=qualified?'native_credit_before_debt_offset':'native_credit_amount_date_or_contract_unknown';
  observation={payment,creditDate:credit.sellerCreditRecordedAt??null,gross:credit.sellerCreditedCents??null,pending:credit.sellerPendingCreditCents??null,debt:credit.sellerDebtRepaidCents??null,
    linkedRows:sourceRows?.filter(d=>['sale_credit','debt_repayment'].includes(d.data().type)).map(d=>({id:d.id,type:d.data().type,amount:d.data().amount,createdAt:d.data().createdAt??null})).sort((a,b)=>a.id.localeCompare(b.id))??null,
    inventoryReview:raw.paymentInventoryReconciliation??null};
  if(s.kind==='purchase_refund'){
    let intent=raw.refund;if(intent?.intentId!==s.refundIntentId)try{intent=await readAllocationHistoryIntent(tx,s.id,raw,s.refundIntentId!);}catch{intent=null;}
    const storedAllocation=(await tx.get(ref.collection('refund_allocations').doc(s.refundIntentId!))).data(),allocation=storedAllocation&&financial?.refund?{...storedAllocation,settlement:financial.refund.settlement}:storedAllocation,terms=allocation?.terms;
    const local=!!intent&&!!allocation&&(financial?.refund?.localLedger?prospectiveLocalMovements(s.id,raw,intent,allocation,financial.refund.localLedger):await allocationLocalMovementsVerified(tx,s.id,raw,intent,allocation));
    const repaired=financial?.refund?.repairRecord?prospectiveRepair(s.id,raw,intent,financial.refund.repairRecord):false;
    const manual=!!financial?.refund?.manualDocuments&&['failed','canceled'].includes(intent?.providerStatus)&&intent?.cardRepairSettlement==null&&
      qualifiedManualRefundSettlement(s.id,raw,intent,financial.refund.manualDocuments);
    const binding=!!intent&&!!allocation&&intent.state==='succeeded'&&intent.currency==='cad'&&intent.buyerId===raw.buyerId&&intent.sellerId===raw.sellerId&&
      intent.outstandingCardCents===0&&intent.freezeCents===0&&!intent.bankWaiting&&!intent.legacyReconciliationRequired&&!intent.duplicateCardSettlementCents&&raw.refundAllocationState?.reviewRequired!==true&&
      allocation.reservationHash===intent.allocation?.reservationHash&&allocation.reservationHash===supportSourceHash(allocation.reservation)&&
      allocation.reservation?.agreementCaptureHash===supportSourceHash(allocation.agreementCapture??null)&&terms?.cardCents===intent.cardAmountCents&&terms.walletCents===intent.walletAmountCents&&
      terms.sellerDebitCents===intent.sellerDebitCents&&taxNative(allocation.settlement?.appliedAt)&&taxNative(intent.fundsAppliedAt)&&allocation.settlement.appliedAt.isEqual(intent.fundsAppliedAt)&&
      (intent.cardAmountCents===0||allocation.settlement.providerRefundId===intent.stripeRefundId&&(manual||intent.cardConfirmedCents===intent.cardAmountCents&&(intent.providerStatus==='succeeded'||repaired)));
    const settled=qualified&&local&&(financial?.refund?binding:!!await readSettledAllocationIntent(tx,s.id,raw,intent))&&intent.localOutstandingWalletCents===0&&intent.localOutstandingSellerCents===0&&taxNative(intent.fundsAppliedAt)&&
      raw.bankDispute==null&&raw.disputeId==null&&raw.bankRefundReconciliation==null&&taxCents(terms?.refund?.articleCents)&&taxCents(terms?.sellerDebitCents)&&taxCents(terms?.platformArticleCostCents);
    let nativeAllocation=false;try{parsePurchaseRefundTerms(terms);nativeAllocation=!!allocation&&allocation.protocol==='purchase_refund_allocation_record_v1'&&allocation.transactionId===s.id&&allocation.refundIntentId===s.refundIntentId&&
      allocation.buyerId===raw.buyerId&&allocation.sellerId===ownerId&&allocation.reservation?.basisHash===allocation.basisHash&&allocation.basisHash===supportSourceHash(allocation.basis)&&
      allocation.basis?.transactionId===s.id&&allocation.basis?.buyerId===raw.buyerId&&allocation.basis?.sellerId===ownerId&&allocation.reservation.termsHash===supportHash(terms)&&
      allocation.reservationHash===supportSourceHash(allocation.reservation)&&price!==null&&terms.refund.articleCents<=price;}catch{nativeAllocation=false;}
    const mappingKnown=nativeAllocation&&taxCents(terms?.refund?.articleCents)&&taxCents(terms?.sellerDebitCents)&&taxCents(terms?.platformArticleCostCents);
    const exactSellerArticle=mappingKnown&&terms.sellerDebitCents===terms.refund.articleCents&&terms.platformArticleCostCents===0;
    const platformFunded=mappingKnown&&terms.sellerDebitCents===0&&terms.platformArticleCostCents===terms.refund.articleCents;
    qualified=!!(settled&&(exactSellerArticle||platformFunded));body.adjustmentRecordedAt=taxNative(intent?.fundsAppliedAt)?intent.fundsAppliedAt:null;
    body.considerationDeltaCents=exactSellerArticle||platformFunded?(platformFunded?0:-terms.refund.articleCents):null;
    body.grossConsiderationCents=null;body.platformFeesCents=mappingKnown?0:null;body.platformTaxesCents=mappingKnown?0:null;body.walletCreditCents=null;body.debtOffsetCents=null;
    reason=qualified?'native_adjustment_linked_to_original_period':'seller_adjustment_mapping_or_settlement_unknown';
    observation={...observation,refundIntentId:s.refundIntentId,intentState:intent?.state??null,appliedAt:intent?.fundsAppliedAt??null,outstandingCard:intent?.outstandingCardCents??null,
      reservationHash:allocation?.reservationHash??null,termsHash:terms?supportHash(terms):null,localVerified:local,bankOverlap:raw.bankDispute!=null||raw.disputeId!=null||raw.bankRefundReconciliation!=null};
  }
  return {body,qualified,reason,observationHash:supportSourceHash(observation)};
}
export async function planSellerTaxSource(tx:FirebaseFirestore.Transaction,ownerId:string,s:SellerTaxSource,prospective?:Parameters<typeof readSellerTaxSource>[3]){
  return planFacts(tx,ownerId,s,await readSellerTaxSource(tx,ownerId,s,prospective));
}
/** Prepared by genuine financial writers before their first write. No provider
 * call, fiscal admission, rate or current asking price is consulted here. The
 * final callback fingerprint binds the ACTUAL committed projection. */
export async function prepareSellerTaxFinancialEvent(tx:FirebaseFirestore.Transaction,ownerId:string,s:SellerTaxSource,anticipated:SellerTaxFinancialCommit){
  const alertRef=db.collection('admin_alerts').doc('tax_source_gap_'+supportHash([ownerId,s])),priorAlert=await tx.get(alertRef),now=Timestamp.now();
  const gap=(reason:string)=>{tx.set(alertRef,{kind:'seller_tax_source_reconciliation_v1',ownerId,source:s,reason,status:'open',
    financialEffectAuthorized:false,createdAt:priorAlert.data()?.createdAt??now,updatedAt:now});};
  try{
    const fingerprint=financialFingerprint(anticipated),pending=anticipated.commitTimestamp,
      projection=pending?commitProjection(anticipated,pending,null) as SellerTaxFinancialCommit:anticipated,
      facts=await readSellerTaxSource(tx,ownerId,s,undefined,projection);
    if(pending){
      const eventId=taxEventId(s),ref=taxSellerRef(ownerId).collection('events').doc(eventId),old=(await tx.get(ref)).data();
      if(old&&(old.protocol!=='seller_tax_event_v1'||old.ownerId!==ownerId||old.eventId!==eventId||old.bodyHash!==supportSourceHash(old.body)))throw new HttpsError('failed-precondition','Événement fiscal historique non qualifié.');
      const moneyBodyHash=supportSourceHash(facts.body),versionHash=supportHash(['seller_tax_provisional_event_v1',ownerId,eventId,fingerprint,moneyBodyHash]),versionRef=ref.collection('versions').doc(versionHash),priorVersion=await tx.get(versionRef);
      const body={...facts.body,...s.kind==='purchase'?{effectiveAt:pending}:{adjustmentRecordedAt:pending}};
      const document={protocol:'seller_tax_provisional_event_v1',ownerId,eventId,body,bodyHash:null,moneyBodyHash,provisionalCommitHash:fingerprint,
        nativeCommitAt:pending,originalQualified:false,qualification:'unknown',reason:'native_commit_date_pending_qualification',versionHash,evidence:null,
        firstRecordedAt:old?.firstRecordedAt??pending,observedAt:pending};
      return {commit(actual:SellerTaxFinancialCommit){let same=false;try{same=financialFingerprint(actual)===fingerprint;}catch{/* unknown below */}
        if(!same){gap('financial_commit_projection_changed');return;}if(!priorVersion.exists)tx.create(versionRef,{...document,previousVersionHash:old?.versionHash??null});tx.set(ref,document);
      }};
    }
    const normal=await planFacts(tx,ownerId,s,facts),unknown=await planFacts(tx,ownerId,s,{...facts,qualified:false,reason:'financial_commit_projection_changed',body:eventBody(ownerId,s)});
    return {commit(actual:SellerTaxFinancialCommit){let same=false;try{same=financialFingerprint(actual)===fingerprint;}catch{/* preserve real financial effects, record unknown */}
      if(!same){unknown.commit();gap('financial_commit_projection_changed');return;}
      normal.commit();if(!facts.qualified)gap(facts.reason);else if(priorAlert.data()?.kind==='seller_tax_source_reconciliation_v1'&&priorAlert.data()?.ownerId===ownerId)tx.set(alertRef,{...priorAlert.data(),status:'resolved',resolvedAt:now,updatedAt:now});
    }};
  }catch(error){
    if(!(error instanceof HttpsError)||!['failed-precondition','invalid-argument','permission-denied'].includes(error.code))throw error;
    return {commit(_actual:SellerTaxFinancialCommit){gap('fiscal_source_or_history_unqualified');}};
  }
}
/** A documented external receipt/valuation does not become a verified bank
 * payment. It can supply previously unknown consideration under the captured
 * annual operator method, bound to the same native source and owner. */
export async function planSellerTaxEvidenceEvent(tx:FirebaseFirestore.Transaction,ownerId:string,s:SellerTaxSource,input:Data,proof:Data,operatorVersionHash:string,timeZone:string){
  const facts=await readSellerTaxSource(tx,ownerId,s);
  if(input.nativeSourceHash!==facts.observationHash||input.sourceKind!==s.kind||input.sourceId!==s.id||input.ownerId!==ownerId||
    !taxCents(input.considerationCents)||typeof input.effectiveAt!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(input.effectiveAt)||
    !Number.isFinite(Date.parse(input.effectiveAt))||Date.parse(input.effectiveAt)>Date.now()||!taxHash(operatorVersionHash)||
    !['seller_attested_cash_receipt','documented_consistent_barter_fmv'].includes(input.method)||proof.protocol!=='seller_tax_evidence_proof_v1'||proof.subject!=='seller'||proof.ownerId!==ownerId||proof.purpose!=='valuation'||
    taxCalendar(Timestamp.fromDate(new Date(input.effectiveAt)),timeZone)?.year!==proof.year)throw new HttpsError('failed-precondition','Le reçu ou la valorisation ne correspond pas à cette activité native.');
  const raw=(await tx.get(db.collection(s.kind==='swap'?'swaps':'transactions').doc(s.id))).data()!;
  if(s.kind==='purchase'?(input.method!=='seller_attested_cash_receipt'||!qualifiedCashAgreement(s.id,raw)||raw.status!=='meetup_completed'||
    !taxNative(raw.meetupCompletedAt)||input.considerationCents!==exactCents(raw.amount)):
    s.kind!=='swap'||input.method!=='documented_consistent_barter_fmv'||![raw.initiatorId,raw.receiverId].includes(ownerId)||
      !taxNative(raw.initiatorReceivedAt)||!taxNative(raw.receiverReceivedAt)||!['completed','disputed'].includes(raw.status))
    throw new HttpsError('failed-precondition','L’activité ou sa réception native reste à qualifier.');
  const body={...facts.body,effectiveAt:Timestamp.fromDate(new Date(input.effectiveAt)),grossConsiderationCents:input.considerationCents,platformFeesCents:0,platformTaxesCents:0,
    considerationDeltaCents:input.considerationCents,nonMonetaryValueCents:s.kind==='swap'?input.considerationCents:null};
  return planFacts(tx,ownerId,s,{body,qualified:true,reason:input.method,observationHash:facts.observationHash},
    {proof,operatorVersionHash,method:input.method,nativeSourceHash:facts.observationHash,externalPaymentVerified:false});
}
function resolvedProvisional(raw:Data,ownerId:string,s:SellerTaxSource,facts:Awaited<ReturnType<typeof readSellerTaxSource>>){
  const eventId=taxEventId(s),body=raw.body,date=s.kind==='purchase'?body?.effectiveAt:body?.adjustmentRecordedAt,
    undated={...body,...s.kind==='purchase'?{effectiveAt:null}:{adjustmentRecordedAt:null}};
  if(raw.protocol!=='seller_tax_provisional_event_v1'||raw.ownerId!==ownerId||raw.eventId!==eventId||!body||supportHash(body.source)!==supportHash(s)||raw.bodyHash!==null||
    !taxNative(raw.nativeCommitAt)||!taxNative(date)||!date.isEqual(raw.nativeCommitAt)||!taxHash(raw.provisionalCommitHash)||!taxHash(raw.moneyBodyHash)||
    raw.moneyBodyHash!==supportSourceHash(undated)||raw.versionHash!==supportHash(['seller_tax_provisional_event_v1',ownerId,eventId,raw.provisionalCommitHash,raw.moneyBodyHash]))
    throw new HttpsError('failed-precondition','Reçu fiscal de commit non qualifié.');
  const bodyHash=supportSourceHash(body),same=bodyHash===supportSourceHash(facts.body),qualified=same&&facts.qualified;
  return {...raw,protocol:'seller_tax_event_v1',bodyHash,originalQualified:qualified,qualification:qualified?'native_fact':'unknown',
    reason:same?facts.reason:'original_facts_changed',observationHash:facts.observationHash};
}
/** Pure entry qualification for a fixed-point annual capture. Both the head
 * and every monetary source/join are read through the caller's SAME readTime.
 * No historical identity, rate or operator decision is reconstructed. */
export async function readSellerTaxCaptureEntry(tx:FirebaseFirestore.Transaction,ownerId:string,s:SellerTaxSource,operatorVersionHash:string|null){
  const eventId=taxEventId(s),facts=await readSellerTaxSource(tx,ownerId,s);let head=(await tx.get(taxSellerRef(ownerId).collection('events').doc(eventId))).data();
  if(head?.protocol==='seller_tax_provisional_event_v1')head=resolvedProvisional(head,ownerId,s,facts);
  if(head&&(head.protocol!=='seller_tax_event_v1'||head.ownerId!==ownerId||head.eventId!==eventId||head.bodyHash!==supportSourceHash(head.body)||supportHash(head.body?.source)!==supportHash(s)))
    return {source:s,eventId,body:facts.body,qualification:'unknown',reason:'event_source_unqualified',observationHash:facts.observationHash,versionHash:null};
  const documented=head?.qualification==='documented_evidence'&&head.evidence?.proof?.protocol==='seller_tax_evidence_proof_v1'&&head.evidence.proof.ownerId===ownerId&&
    head.evidence.operatorVersionHash===operatorVersionHash&&taxHash(operatorVersionHash)&&head.evidence.nativeSourceHash===facts.observationHash&&
    ['seller_attested_cash_receipt','documented_consistent_barter_fmv'].includes(head.evidence.method);
  const same=!head||head.bodyHash===supportSourceHash(facts.body),qualified=documented||facts.qualified&&same;
  return {source:s,eventId,body:documented?head!.body:facts.body,qualification:qualified?documented?'documented_evidence':'native_fact':'unknown',
    reason:qualified?documented?head!.evidence.method:facts.reason:!same?'original_facts_changed':facts.reason,
    observationHash:facts.observationHash,versionHash:head?.versionHash??null};
}
async function planFacts(tx:FirebaseFirestore.Transaction,ownerId:string,s:SellerTaxSource,facts:Awaited<ReturnType<typeof readSellerTaxSource>>,evidence:Data|null=null){
  const eventId=taxEventId(s),ref=taxSellerRef(ownerId).collection('events').doc(eventId);let old=(await tx.get(ref)).data();
  if(old?.protocol==='seller_tax_provisional_event_v1')old=resolvedProvisional(old,ownerId,s,facts);
  const now=Timestamp.now();
  if(old&&(old.protocol!=='seller_tax_event_v1'||old.ownerId!==ownerId||old.eventId!==eventId||old.bodyHash!==supportSourceHash(old.body)))throw new HttpsError('failed-precondition','Événement fiscal historique non qualifié.');
  // Re-scanning a cash/barter agreement must not erase its already captured
  // external receipt merely because the native agreement cannot supply that
  // outside amount. A changed native source still makes it unknown.
  if(!evidence&&old?.evidence?.proof?.protocol==='seller_tax_evidence_proof_v1'&&old.evidence.proof.ownerId===ownerId&&
    old.evidence.nativeSourceHash===facts.observationHash&&['seller_attested_cash_receipt','documented_consistent_barter_fmv'].includes(old.evidence.method)){
    facts={...facts,body:old.body,qualified:true,reason:old.evidence.method};evidence=old.evidence;
  }
  const bodyHash=supportSourceHash(facts.body);
  const changed=!!old&&old.originalQualified===true&&old.bodyHash!==bodyHash,qualification=changed?'unknown':facts.qualified?evidence?'documented_evidence':'native_fact':'unknown';
  const evidenceIdentity=evidence?{...evidence,proof:Object.fromEntries(Object.entries(evidence.proof).filter(([k])=>k!=='observedAt'))}:null;
  const versionHash=supportHash([bodyHash,facts.observationHash,qualification,evidenceIdentity]),versionRef=ref.collection('versions').doc(versionHash),version=await tx.get(versionRef);
  const document={protocol:'seller_tax_event_v1',ownerId,eventId,body:changed?old!.body:facts.body,bodyHash:changed?old!.bodyHash:bodyHash,
    originalQualified:old?.originalQualified===true||facts.qualified,qualification,reason:changed?'original_facts_changed':facts.reason,observationHash:facts.observationHash,
    versionHash,evidence:changed?old?.evidence??null:evidence,firstRecordedAt:old?.firstRecordedAt??now,observedAt:now};
  return {eventId,document,commit(){if(old?.versionHash===versionHash)return;if(!version.exists)tx.create(versionRef,{...document,previousVersionHash:old?.versionHash??null});tx.set(ref,document);}};
}
export async function readSellerTaxAnnualSummary(tx:FirebaseFirestore.Transaction,ownerId:string,year:number,timeZone:string){
  const page=await tx.get(taxSellerRef(ownerId).collection('events').orderBy('__name__').limit(SELLER_TAX_LEDGER_LIMITS.eventsPerSnapshot+1)),rows=page.docs.slice(0,SELLER_TAX_LEDGER_LIMITS.eventsPerSnapshot);
  const quarters=Array.from({length:4},(_,i)=>({quarter:i+1,grossConsiderationCents:0,adjustmentsCents:0,considerationCents:0,platformFeesCents:0,platformTaxesCents:0,activityCount:0}));
  const activities=Array.from({length:4},()=>new Set<string>()),all=new Set<string>(),issues:string[]=[],references:{eventId:string;bodyHash:string;versionHash:string;currentObservationHash:string}[]=[];
  if(!['UTC','America/Toronto'].includes(timeZone))issues.push('period_policy_unknown');
  if(page.size>rows.length)issues.push('event_coverage_saturated');
  for(const row of rows){let d=row.data(),captured:Awaited<ReturnType<typeof readSellerTaxSource>>|null=null;
    if(d.protocol==='seller_tax_provisional_event_v1'){try{captured=await readSellerTaxSource(tx,ownerId,d.body?.source);d=resolvedProvisional(d,ownerId,d.body.source,captured);}catch(e){if(e instanceof HttpsError&&['failed-precondition','invalid-argument','permission-denied'].includes(e.code)){issues.push('provisional_event_source_unqualified');continue;}throw e;}}
    if(d.protocol!=='seller_tax_event_v1'||d.ownerId!==ownerId||d.eventId!==row.id||d.bodyHash!==supportSourceHash(d.body)){issues.push('event_source_unqualified');continue;}
    const period=taxCalendar(d.body.effectiveAt,timeZone);if(!period){issues.push('event_period_unknown');continue;}if(period.year!==year)continue;
    let current:Awaited<ReturnType<typeof readSellerTaxSource>>;try{current=captured??await readSellerTaxSource(tx,ownerId,d.body.source);}catch(e){if(e instanceof HttpsError&&e.code==='permission-denied'){issues.push('current_source_unavailable');continue;}throw e;}
    references.push({eventId:row.id,bodyHash:d.bodyHash,versionHash:d.versionHash,currentObservationHash:current.observationHash});
    const documented=d.qualification==='documented_evidence'&&d.evidence?.proof?.protocol==='seller_tax_evidence_proof_v1'&&
      d.evidence.nativeSourceHash===current.observationHash&&taxHash(d.evidence.operatorVersionHash)&&['seller_attested_cash_receipt','documented_consistent_barter_fmv'].includes(d.evidence.method);
    if(!documented&&(d.qualification!=='native_fact'||!current.qualified||supportSourceHash(current.body)!==d.bodyHash)||!Number.isSafeInteger(d.body.considerationDeltaCents)){
      issues.push(!current.qualified?current.reason:d.reason??'event_consideration_unknown');continue;}
    const q=quarters[period.quarter-1],delta=d.body.considerationDeltaCents;q.considerationCents+=delta;
    if(d.body.eventKind==='paid_or_credited'){if(!taxCents(d.body.grossConsiderationCents)||!taxCents(d.body.platformFeesCents)||!taxCents(d.body.platformTaxesCents)){issues.push('event_components_unknown');continue;}
      q.grossConsiderationCents+=d.body.grossConsiderationCents;q.platformFeesCents+=d.body.platformFeesCents;q.platformTaxesCents+=d.body.platformTaxesCents;
      activities[period.quarter-1].add(d.body.activityReference);all.add(d.body.activityReference);
    }else{q.adjustmentsCents+=delta;if(!references.some(v=>v.eventId===d.body.originalEventId)&&!(await tx.get(taxSellerRef(ownerId).collection('events').doc(d.body.originalEventId))).exists)issues.push('adjustment_original_missing');}
  }
  for(let i=0;i<quarters.length;i++){quarters[i].activityCount=activities[i].size;if(!Object.values(quarters[i]).every(Number.isSafeInteger)||quarters[i].considerationCents<0)issues.push('annual_amount_arithmetic_or_original_unknown');}
  const total=quarters.reduce((n,q)=>n+q.considerationCents,0);if(!Number.isSafeInteger(total))issues.push('annual_total_overflow');
  return {protocol:'seller_tax_annual_summary_v1',ownerId,year,currency:'CAD',timeZone,policyVersion:SELLER_TAX_POLICY_VERSION,quarters,annualActivityCount:issues.length?null:all.size,
    annualConsiderationCents:issues.length?null:total,smallGoodsExclusionCandidate:issues.length?null:all.size<30&&total<=280000,
    activityCountBasis:'one_native_agreement_per_seller',exclusionDoesNotDetermineProfessionalStatus:true,qualification:issues.length?'unknown':'recorded_events_only',issues:[...new Set(issues)],
    sourceReferences:references,eventSetHash:supportHash(references),completeSourceUniverseVerified:false,nativeEventSnapshotVerified:false,withdrawalsOrReleasesCounted:false,
    eventsInspected:rows.length,hasMore:page.size>rows.length,nextCursor:page.size>rows.length?rows.at(-1)!.id:null};
}
