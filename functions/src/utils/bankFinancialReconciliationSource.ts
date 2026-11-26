/** Read-only local facts. Recorded reserves and verified local ledger effects
 * are separate; neither is a net bank settlement. */
import {db} from '../config/firebase';
import {bankCaseRef,bankId,bankNative} from './bankDisputeCaseSource';
import {supportHash,supportSourceHash,supportRevision} from './supportRequest';
import {allocationLocalMovementsVerified,readAllocationHistoryIntent} from './refundAllocation';
const object=(v:any)=>!!v&&typeof v==='object'&&!Array.isArray(v);
const text=(v:any)=>typeof v==='string'&&v.length<=200?v:null;
const cents=(v:any)=>Number.isSafeInteger(v)&&v>=0;
export async function readBankFinancialNativeSource(tx:FirebaseFirestore.Transaction,transactionId:string,disputeId:string){
  const ref=db.collection('transactions').doc(transactionId),snap=await tx.get(ref),order=snap.data(),bankSnap=await tx.get(bankCaseRef(disputeId)),bank=bankSnap.data();
  const parties=[order?.buyerId,order?.sellerId],nativeParties=parties.every(v=>typeof v==='string'&&v.length>0&&v.length<=200&&!v.includes('/'))&&parties[0]!==parties[1];
  const bound=!!order&&nativeParties&&(bank?.protocol==='bank_dispute_case_v1'&&bank.transactionId===transactionId&&bank.disputeId===disputeId||
    order.bankDispute?.id===disputeId||order.bankDispute?.conflictingDisputeId===disputeId||order.disputeId===disputeId);
  let unique=false;if(bankId(order?.stripePaymentIntentId,'pi')){const q=await tx.get(db.collection('transactions').where('stripePaymentIntentId','==',order!.stripePaymentIntentId).limit(2));unique=q.size===1&&q.docs[0].id===transactionId;}
  const qualified=bound&&unique&&bankId(order?.stripeChargeId,'ch')&&Number.isSafeInteger(order?.capturedCardCents)&&order!.capturedCardCents>0&&
    bankNative(order?.createdAt)&&['CAD','cad'].includes(order?.currency);
  const reasons:string[]=[],manifest:any[]=[],ledgers:any[]=[],allocations:any[]=[],repairs:any[]=[],histories:any[]=[];
  if(!qualified)reasons.push('native_payment_identity_unknown');
  if(bank&&(bank.protocol!=='bank_dispute_case_v1'||bank.transactionId!==transactionId||bank.disputeId!==disputeId))reasons.push('native_bank_case_unknown');
  if(nativeParties)for(const [i,uid] of parties.entries()){
    const page=await tx.get(db.collection('wallets').doc(uid).collection('ledger').where('transactionId','==',transactionId).limit(101));
    if(page.size>100)reasons.push('local_ledger_coverage_unknown');
    manifest.push({kind:i===0?'buyer_ledger':'seller_ledger',count:page.size,hash:supportSourceHash(page.docs.map(d=>[d.id,supportRevision(d),supportSourceHash(d.data())]))});
    for(const row of page.docs.slice(0,100)){const d=row.data();if(d.transactionId!==transactionId||!bankNative(d.createdAt)||!Number.isSafeInteger(d.amount))reasons.push('local_ledger_evidence_unknown');
      ledgers.push({id:row.id,ownerRole:i===0?'buyer':'seller',transactionId,
      type:text(d.type)??'unknown',amountCents:Number.isSafeInteger(d.amount)?d.amount:null,debtCents:Number.isSafeInteger(d.debtRecorded)?d.debtRecorded:null,
      refundIntentId:text(d.refundIntentId),disputeId:bankId(d.disputeId,'du')?d.disputeId:null,
      createdAt:bankNative(d.createdAt)?d.createdAt.toDate().toISOString():null,sourceHash:supportSourceHash(d),
      qualification:d.transactionId===transactionId&&bankNative(d.createdAt)&&Number.isSafeInteger(d.amount)?'native_recorded_ledger_movement':'unknown',
      providerSettlementVerified:false});}
  }
  for(const kind of ['refund_allocations','refund_history','refund_repairs'] as const){
    const page=await tx.get(ref.collection(kind).orderBy('__name__').limit(21));if(page.size>20)reasons.push('local_financial_history_coverage_unknown');
    manifest.push({kind,count:page.size,hash:supportSourceHash(page.docs.map(d=>[d.id,supportRevision(d),supportSourceHash(d.data())]))});
    for(const row of page.docs.slice(0,20)){
      const d=row.data();
      if(kind==='refund_history'){histories.push({id:row.id,sourceHash:supportSourceHash(d),recordedAt:bankNative(d.archivedAt)?d.archivedAt.toDate().toISOString():null,
        qualification:d.protocol==='purchase_refund_history_v1'&&d.transactionId===transactionId&&d.intentId===row.id&&
          d.buyerId===order?.buyerId&&d.sellerId===order?.sellerId&&d.originalIntentHash===supportSourceHash(d.originalIntent??null)?'native_recorded_history':'unknown'});continue;}
      if(kind==='refund_allocations'){
        let intent:any=null,localVerified=false;
        if(order){try{intent=order.refund?.intentId===row.id?order.refund:await readAllocationHistoryIntent(tx,transactionId,order,row.id);
          localVerified=!!intent&&await allocationLocalMovementsVerified(tx,transactionId,order,intent,d)&&
            ['sellerDebitCents','fromPendingCents','fromHeldCents','fromBalanceCents','debtCents'].every(k=>cents(d.settlement?.[k]));}catch{/* Local unknown remains unknown; no money is changed. */}}
        const reservationQualified=d.protocol==='purchase_refund_allocation_record_v1'&&d.transactionId===transactionId&&d.refundIntentId===row.id&&
          d.buyerId===order?.buyerId&&d.sellerId===order?.sellerId&&bankNative(d.reservedAt)&&d.reservationHash===supportSourceHash(d.reservation??null)&&
          object(d.terms)&&d.reservation?.termsHash===supportHash(d.terms)&&['cardCents','walletCents','sellerDebitCents'].every(k=>cents(d.terms[k]));
        allocations.push({id:row.id,sourceHash:supportSourceHash(d),reservationQualification:reservationQualified?'native_reservation':'unknown',
          localMovementsQualification:localVerified?'native_local_effects':'unknown',reservedAt:bankNative(d.reservedAt)?d.reservedAt.toDate().toISOString():null,
          appliedAt:localVerified?d.settlement.appliedAt.toDate().toISOString():null,
          providerRefundId:bankId(intent?.stripeRefundId,'re')?intent.stripeRefundId:null,
          terms:reservationQualified?{cardCents:d.terms.cardCents,walletCents:d.terms.walletCents,sellerDebitCents:d.terms.sellerDebitCents}:null,
          localEffects:localVerified?{sellerDebitCents:d.settlement.sellerDebitCents,fromPendingCents:d.settlement.fromPendingCents,fromHeldCents:d.settlement.fromHeldCents,
            fromBalanceCents:d.settlement.fromBalanceCents,debtCents:d.settlement.debtCents}:null,providerSettlementVerified:false});
        if(!reservationQualified)reasons.push('local_allocation_unknown');
      }else{
        const associated=d.protocol==='purchase_refund_repair_record_v1'&&d.transactionId===transactionId&&d.repairId===row.id&&
          d.buyerId===order?.buyerId&&d.sellerId===order?.sellerId&&d.paymentIntentId===order?.stripePaymentIntentId&&d.chargeId===order?.stripeChargeId&&
          bankNative(d.reservedAt)&&object(d.command)&&d.commandHash===supportHash(d.command);
        repairs.push({id:row.id,sourceHash:supportSourceHash(d),qualification:associated?'native_recorded_repair':'unknown',refundIntentId:text(d.refundIntentId),
          providerRefundId:bankId(d.providerRefundId,'re')?d.providerRefundId:null,state:text(d.state)??'unknown',
          amountCents:Number.isSafeInteger(d.amountCents)?d.amountCents:null,currency:d.currency==='CAD'?'CAD':null,
          reservedAt:bankNative(d.reservedAt)?d.reservedAt.toDate().toISOString():null,observedAt:bankNative(d.observedAt)?d.observedAt.toDate().toISOString():null,
          providerSettlementVerified:false,localEffectsVerified:false});if(!associated)reasons.push('local_repair_unknown');
      }
    }
  }
  const currentRefund=order?.refund?{intentId:text(order.refund.intentId),
    state:text(order.refund.state)??'unknown',providerRefundId:bankId(order.refund.stripeRefundId,'re')?order.refund.stripeRefundId:null,
    cardCents:Number.isSafeInteger(order.refund.cardAmountCents)?order.refund.cardAmountCents:null,walletCents:Number.isSafeInteger(order.refund.walletAmountCents)?order.refund.walletAmountCents:null,
    sellerDebitCents:Number.isSafeInteger(order.refund.sellerDebitCents)?order.refund.sellerDebitCents:null,
    fundsAppliedAt:bankNative(order.refund.fundsAppliedAt)?order.refund.fundsAppliedAt.toDate().toISOString():null,financialSettlementVerified:false}:null;
  const capture={protocol:'bank_financial_native_source_v1',transactionId,disputeId,orderRevision:supportRevision(snap),orderHash:supportSourceHash(order??null),
    bankRevision:supportRevision(bankSnap),bankHash:supportSourceHash(bank??null),parties:nativeParties?parties:null,manifest,
    identityQualified:qualified,localCoverageQualified:reasons.length===0};
  return {sourceHash:supportSourceHash(capture),capture,qualified,order,identity:qualified?{transactionId,disputeId,paymentIntentId:order!.stripePaymentIntentId,
    chargeId:order!.stripeChargeId,capturedCardCents:order!.capturedCardCents}:null,
    localEvidence:{ledgers,allocations,repairs,histories,currentRefund,reasons:[...new Set(reasons)],amountsAreSeparateRecordedFacts:true,
      netFinancialResolutionQualified:false,financialEffectAuthorized:false}};
}
export type BankFinancialNativeSource=Awaited<ReturnType<typeof readBankFinancialNativeSource>>;
