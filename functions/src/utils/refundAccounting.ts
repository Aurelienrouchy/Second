/** Purchase bookkeeping only. Plans read before the money writer's first write;
 * commit never moves funds, releases stock or authorizes a provider request. */
import {Timestamp} from 'firebase-admin/firestore';
import {db,FieldValue} from '../config/firebase';
import {supportHash,supportSourceHash} from './supportRequest';
import {parsePurchaseRefundTerms,allocationLocalMovementsVerified,readAllocationHistoryIntent} from './refundAllocation';
import {nativePurchasePaymentSource,acceptedQuotePurchasePolicy,acceptedPurchaseTaxSnapshot} from './purchasePolicy';
import {hasActiveBankDispute} from './bankDispute';
import {exactCents} from './shippingPurchaseRate';
import {qualifiedManualRefundSettlement,type ManualRefundDocuments} from './manualRefundSettlement';

type Data=FirebaseFirestore.DocumentData;
export type PurchaseAccountingPayment={kind:'wallet_ledger'|'stripe_payment_intent';referenceId:string;
  amountCents:number;walletCents:number;cardCents:number;recordedAt:Timestamp};
type RefundCommit={intent:Data;settlement?:Data|null;localMoneyApplied?:boolean;nativeRepairQualified?:boolean;manualDocuments?:ManualRefundDocuments};
const native=(v:unknown):v is Timestamp=>v instanceof Timestamp&&v.toMillis()>0&&v.toMillis()<=Date.now();
const cents=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>=0;
const hash=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const protocol='purchase_platform_accounting_v1';
const own=(d:Data,key:string)=>Object.prototype.hasOwnProperty.call(d,key);
// The bank helper also marks ordinary allocation presence: that marker alone
// is not a bank event. A bank history plus a refund has no approved differential
// allocation, even when the bank-only history itself is closed.
function bankOverlap(order:Data,hasRefund:boolean) {
  return hasActiveBankDispute(order)||hasRefund&&(own(order,'bankDispute')||own(order,'disputeId')||own(order,'disputeClosedAt'));
}
const baseRef=(id:string)=>db.collection('platform_ledger').doc(`service_fee_revenue_${id}`);
const taxRef=(id:string)=>db.collection('platform_ledger').doc(`tax_collected_${id}`);
const counterRef=(id:string,intentId:string)=>db.collection('platform_ledger').doc(`purchase_refund_${supportHash([id,intentId])}`);
const components=['articleCents','buyerFeeCents','shippingCents','gstCents','qstCents'] as const;
function allocationSource(id:string,order:Data,rowId:string,r:Data) {
  try {
    const terms=parsePurchaseRefundTerms(r.terms),reservation=r.reservation;
    if(r.protocol!=='purchase_refund_allocation_record_v1'||r.transactionId!==id||r.refundIntentId!==rowId||
      r.buyerId!==order.buyerId||r.sellerId!==order.sellerId||!native(r.reservedAt)||!hash(r.basisHash)||
      !hash(r.reservationHash)||r.reservationHash!==supportSourceHash(reservation)||reservation?.protocol!=='purchase_refund_reservation_v1'||reservation.transactionId!==id||
      reservation.refundIntentId!==rowId||reservation.basisHash!==r.basisHash||reservation.termsHash!==supportHash(terms)||
      reservation.agreementCaptureHash!==supportSourceHash(r.agreementCapture??null)||
      r.basis?.transactionId!==id||r.basis.buyerId!==order.buyerId||r.basis.sellerId!==order.sellerId||supportSourceHash(r.basis)!==r.basisHash)return null;
    const source={protocol:'purchase_refund_accounting_source_v1',transactionId:id,refundIntentId:rowId,
      buyerId:order.buyerId,sellerId:order.sellerId,reservationHash:r.reservationHash,basisHash:r.basisHash,
      termsHash:reservation.termsHash,components:terms.refund,cardCents:terms.cardCents,walletCents:terms.walletCents,
      sellerDebitCents:terms.sellerDebitCents};
    return {source,sourceHash:supportSourceHash(source),terms,record:r};
  }catch{return null;}
}
function counterMatches(d:Data,s:NonNullable<ReturnType<typeof allocationSource>>,baseHash:string) {
  try {return d.type==='purchase_refund_counterentry'&&d.protocol===protocol&&d.currency==='cad'&&native(d.createdAt)&&
    d.baseHash===baseHash&&d.sourceHash===s.sourceHash&&supportSourceHash(d.source)===s.sourceHash&&d.transactionId===s.source.transactionId&&
    d.refundIntentId===s.source.refundIntentId&&d.serviceFee===-s.terms.refund.buyerFeeCents/100&&
    d.shippingCostCollected===-s.terms.refund.shippingCents/100&&d.gst===-s.terms.refund.gstCents/100&&
    d.qst===-s.terms.refund.qstCents/100&&d.taxCollected===-(s.terms.refund.gstCents+s.terms.refund.qstCents)/100&&
    d.grossRevenue===-(s.terms.refund.buyerFeeCents+s.terms.refund.shippingCents+s.terms.refund.gstCents+s.terms.refund.qstCents)/100;
  }catch{return false;}
}
function settled(c:RefundCommit,s:NonNullable<ReturnType<typeof allocationSource>>,order:Data,localVerified:boolean) {
  const i=c.intent,t=s.terms,r=s.record,a=c.settlement??r.settlement;
  const local=c.localMoneyApplied===true&&a?.protocol==='purchase_refund_allocation_settlement_v1'&&
    a.refundIntentId===i.intentId&&a.sellerDebitCents===t.sellerDebitCents;
  const repaired=c.nativeRepairQualified===true&&i.cardRepairSettlement?.protocol==='purchase_refund_repair_settlement_v1'&&
    i.cardRepairSettlement.refundIntentId===i.intentId&&i.cardRepairSettlement.originalRefundId===i.stripeRefundId&&
    /^rr_[a-f0-9]{64}$/.test(i.cardRepairSettlement.repairId??'')&&native(i.cardRepairSettlement.recordedAt)&&
    i.cardRepairSettlement.amountCents===t.cardCents&&hash(i.cardRepairSettlement.proofHash);
  return i.intentId===s.source.refundIntentId&&i.buyerId===order.buyerId&&i.sellerId===order.sellerId&&i.currency==='cad'&&
    i.allocation?.reservationHash===s.source.reservationHash&&i.allocation.basisHash===s.source.basisHash&&
    supportHash(i.allocation.terms)===s.source.termsHash&&i.cardAmountCents===t.cardCents&&i.walletAmountCents===t.walletCents&&
    i.sellerDebitCents===t.sellerDebitCents&&i.state==='succeeded'&&(native(i.fundsAppliedAt)&&localVerified||local)&&
    i.outstandingCardCents===0&&i.localOutstandingWalletCents===0&&i.localOutstandingSellerCents===0&&i.freezeCents===0&&
    !i.bankWaiting&&!i.legacyReconciliationRequired&&!i.duplicateCardSettlementCents&&!hasActiveBankDispute(order)&&
    (t.cardCents===0||c.manualDocuments&&['failed','canceled'].includes(i.providerStatus)&&i.cardRepairSettlement==null&&
      qualifiedManualRefundSettlement(s.source.transactionId,order,i,c.manualDocuments)||i.cardConfirmedCents===t.cardCents&&(i.providerStatus==='succeeded'||repaired));
}
/** service_fee_revenue remains the ORIGINAL gross record (including its old
 * original-margin enrichment); tax_collected is its PARALLEL tax register.
 * Only purchase_accounting_state.currentTotals describes qualified current
 * component totals. Unknown settlement never presents a net amount/margin.
 * At most 100 allocation/counter sources, one counter changed, <=5 small
 * writes. No full announcement, DOB, provider prose or proof corpus is copied.
 * A missing base with older refunds is an explicit gap, never a lone negative. */
export async function preparePurchasePlatformAccounting(tx:FirebaseFirestore.Transaction,id:string,order:Data|null|undefined,
  options:{payment?:PurchaseAccountingPayment;refundIntentId?:string}={}) {
  const sale=order??{},revenue=(await tx.get(baseRef(id))).data(),tax=(await tx.get(taxRef(id))).data();
  const projectionRef=db.collection('platform_ledger').doc(`purchase_accounting_state_${id}`),previousProjection=(await tx.get(projectionRef)).data();
  const alertRef=db.collection('admin_alerts').doc(`purchase_accounting_${supportHash(id)}`),alert=await tx.get(alertRef);
  const rows=await tx.get(db.collection('transactions').doc(id).collection('refund_allocations').orderBy('__name__').limit(101));
  const overlappingBank=bankOverlap(sale,rows.size>0||sale.refund!=null||options.refundIntentId!=null);
  const sources=rows.docs.slice(0,100).map(r=>({id:r.id,source:allocationSource(id,sale,r.id,r.data())}));
  const counters=new Map<string,Data|null>();
  if(revenue)for(const row of sources)counters.set(row.id,(await tx.get(counterRef(id,row.id))).data()??null);
  if(options.refundIntentId&&!counters.has(options.refundIntentId))
    counters.set(options.refundIntentId,(await tx.get(counterRef(id,options.refundIntentId))).data()??null);
  const amount=exactCents(sale.amount),fee=exactCents(sale.serviceFee),shipping=exactCents(sale.shippingCost),taxTotal=exactCents(sale.taxTotal),total=exactCents(sale.totalAmount);
  let reason:string|null=null;
  if(!order||typeof sale.buyerId!=='string'||!sale.buyerId||typeof sale.sellerId!=='string'||!sale.sellerId||sale.buyerId===sale.sellerId||
    amount===null||fee===null||shipping===null||taxTotal===null||total===null||amount+fee+shipping+taxTotal!==total)reason='native_sale_amounts_unqualified';
  if(sale.actualShippingCost!=null&&exactCents(sale.actualShippingCost)===null)reason=reason??'native_carrier_cost_unqualified';
  // Original acceptance and its exact native quote qualify EACH component.
  // A self-consistent allocation hash or unchanged total cannot replace that
  // source. Explicit legacy zero remains zero, without inventing a snapshot.
  const quote=typeof sale.shippingQuoteId==='string'&&sale.shippingQuoteId&&sale.shippingQuoteId.length<=200&&!sale.shippingQuoteId.includes('/')
    ?(await tx.get(db.collection('shipping_quotes').doc(sale.shippingQuoteId))).data():null;
  const quoteQualified=!!quote&&acceptedQuotePurchasePolicy(sale,id,quote);
  const acceptedTax=quoteQualified?acceptedPurchaseTaxSnapshot(sale,quote):null;
  const taxCapturePresent=[sale,sale.purchasePolicyAcceptance??{},quote??{},quote?.source??{},quote?.purchasePolicyAcceptance??{}]
    .some(d=>own(d,'taxSnapshot')||own(d,'pricingVersion'));
  const legacyZero=quoteQualified&&taxTotal===0&&!taxCapturePresent;
  const originalGst=acceptedTax?exactCents(acceptedTax.gst):legacyZero?0:null;
  const originalQst=acceptedTax?exactCents(acceptedTax.qst):legacyZero?0:null;
  if(originalGst===null||originalQst===null||originalGst+originalQst!==taxTotal)
    reason=reason??'original_tax_components_unqualified';
  let payment=options.payment;
  if(!payment){const p=nativePurchasePaymentSource(sale,id);if(p&&native(sale.paidAt))payment={kind:p.kind,referenceId:p.referenceId,
    amountCents:p.amountCents,walletCents:p.walletCents??(p.kind==='wallet_ledger'?p.amountCents:0),
    cardCents:p.kind==='wallet_ledger'?0:p.amountCents-(p.walletCents??0),recordedAt:sale.paidAt};}
  if(!payment||!native(payment.recordedAt)||!payment.referenceId||payment.amountCents!==total||
    !cents(payment.walletCents)||!cents(payment.cardCents)||payment.walletCents+payment.cardCents!==total||
    (payment.kind==='wallet_ledger'?payment.cardCents!==0:payment.referenceId!==sale.stripePaymentIntentId))reason=reason??'native_payment_unqualified';
  // Wallet-only prospective debits are written by the same caller. Historical
  // and mixed sources must still have their one exact original debit.
  if(payment&&payment.walletCents>0&&typeof sale.buyerId==='string'&&sale.buyerId&&!sale.buyerId.includes('/')&&!(options.payment?.kind==='wallet_ledger')){
    const debit=await tx.get(db.collection('wallets').doc(sale.buyerId).collection('ledger').where('transactionId','==',id).limit(101));
    const matches=debit.docs.filter(d=>d.data().type==='purchase_debit');
    if(debit.size>=101||matches.length!==1||matches[0].data().amount!==payment.walletCents||!native(matches[0].data().createdAt))reason=reason??'native_wallet_payment_unqualified';
  }
  const baseSource={protocol:'purchase_platform_base_source_v1',transactionId:id,buyerId:sale.buyerId??null,sellerId:sale.sellerId??null,
    articleCents:amount,buyerFeeCents:fee,shippingCents:shipping,taxCents:taxTotal,totalCents:total,
    payment:payment?{kind:payment.kind,referenceId:payment.referenceId,cardCents:payment.cardCents,walletCents:payment.walletCents}:null};
  const baseHash=supportSourceHash(baseSource);
  if(revenue&&(revenue.type!=='service_fee_revenue'||revenue.transactionId!==id||revenue.sellerId!==sale.sellerId||revenue.currency!=='cad'||
    !native(revenue.createdAt)||exactCents(revenue.serviceFee)!==fee||exactCents(revenue.shippingCostCollected)!==shipping||
    exactCents(revenue.taxCollected)!==taxTotal||exactCents(revenue.grossRevenue)!==fee!+shipping!+taxTotal!||
    revenue.accountingSourceHash!=null&&revenue.accountingSourceHash!==baseHash))reason=reason??'accounting_base_conflict';
  if(taxTotal!>0?(tax?tax.type!=='tax_collected'||tax.transactionId!==id||tax.currency!=='cad'||exactCents(tax.taxTotal)!==taxTotal||!native(tax.createdAt):!!revenue):!!tax)
    reason=reason??'accounting_tax_register_conflict';
  if(!revenue&&(rows.size>0||sale.refund!=null||tax))reason=reason??'refund_or_tax_precedes_accounting_base';
  if(rows.size>=101||sources.some(r=>!r.source))reason=reason??'refund_allocation_history_unqualified';
  const ownSource=sources.find(r=>r.id===options.refundIntentId)?.source;
  const savedIntent=options.refundIntentId?(sale.refund?.intentId===options.refundIntentId?sale.refund:
    await readAllocationHistoryIntent(tx,id,sale,options.refundIntentId)):null;
  const localVerified=!!ownSource&&!!savedIntent&&await allocationLocalMovementsVerified(tx,id,sale,savedIntent,ownSource.record);
  const sums={articleCents:0,buyerFeeCents:0,shippingCents:0,gstCents:0,qstCents:0};
  let usedCard=0,usedWallet=0;
  const initial=sources.find(r=>r.source)?.source?.record.basis.initial;
  for(const r of sources)if(r.source){
    const b=r.source.record.basis,initial=b.initial;
    if(b.protocol!=='purchase_refund_basis_v1'||b.articleId!==sale.articleId||!initial||
      !components.every(k=>cents(initial[k]))||initial.articleCents!==amount||initial.buyerFeeCents!==fee||initial.shippingCents!==shipping||
      initial.gstCents!==originalGst||initial.qstCents!==originalQst||b.totalCents!==total||b.cardCents!==payment?.cardCents||b.walletCents!==payment?.walletCents||
      b.quoteId!==sale.shippingQuoteId||b.policyHash!==sale.purchasePolicy?.hash||
      b.payment?.kind!==payment?.kind||b.payment?.referenceId!==payment?.referenceId||b.payment?.amountCents!==total||b.payment?.walletCents!==payment?.walletCents)
      reason=reason??'refund_original_basis_conflict';
    for(const k of components)sums[k]+=r.source.terms.refund[k];
    usedCard+=r.source.terms.cardCents;usedWallet+=r.source.terms.walletCents;
  }
  if(!Object.values(sums).every(cents)||sums.articleCents>amount!||sums.buyerFeeCents>fee!||sums.shippingCents>shipping!||sums.gstCents+sums.qstCents>taxTotal!)reason=reason??'refund_component_budget_conflict';
  if(initial&&(sums.gstCents>initial.gstCents||sums.qstCents>initial.qstCents)||new Set(sources.filter(r=>r.source).map(r=>r.source!.source.basisHash)).size>1)
    reason=reason??'refund_original_component_budget_conflict';
  if(!cents(usedCard)||!cents(usedWallet)||usedCard>(payment?.cardCents??0)||usedWallet>(payment?.walletCents??0))reason=reason??'refund_payment_budget_conflict';
  if(overlappingBank)reason=reason??'bank_refund_accounting_overlap_unknown';
  return {willCreateBase:!revenue&&!reason,commit:(change?:RefundCommit,reasonOverride?:string)=>{
    let currentReason=reasonOverride??reason;
    const own=sources.find(r=>r.id===options.refundIntentId),source=own?.source;
    const current=source&&change?settled(change,source,sale,localVerified):false;
    if(options.refundIntentId&&(!source||!change))currentReason=currentReason??'refund_allocation_unqualified';
    if(overlappingBank)currentReason=currentReason??'bank_refund_accounting_overlap_unknown';
    if(!revenue&&!currentReason){
      tx.create(baseRef(id),{type:'service_fee_revenue',transactionId:id,sellerId:sale.sellerId,serviceFee:fee!/100,
        shippingCostCollected:shipping!/100,taxCollected:taxTotal!/100,grossRevenue:(fee!+shipping!+taxTotal!)/100,
        carrierCost:exactCents(sale.actualShippingCost)!==null&&sale.actualShippingCost!=null?sale.actualShippingCost:shipping!/100,carrierCostEstimated:sale.actualShippingCost==null,currency:'cad',createdAt:FieldValue.serverTimestamp(),accountingSourceHash:baseHash});
      if(taxTotal!>0)tx.create(taxRef(id),{type:'tax_collected',transactionId:id,taxTotal:taxTotal!/100,currency:'cad',createdAt:FieldValue.serverTimestamp()});
    }
    if(source&&change&&revenue){
      const prior=counters.get(source.source.refundIntentId),observation={state:change.intent.state??null,
        qualified:current,cardConfirmedCents:change.intent.cardConfirmedCents??null,outstandingCardCents:change.intent.outstandingCardCents??null,
        localOutstandingWalletCents:change.intent.localOutstandingWalletCents??null,localOutstandingSellerCents:change.intent.localOutstandingSellerCents??null,
        repairQualified:change.nativeRepairQualified===true,manualSettlementHash:change.manualDocuments&&current?change.intent.manualBankSettlement?.recordHash??null:null,bankOverlap:overlappingBank};
      const observationHash=supportHash(observation),qualification=current&&!currentReason?'qualified':'reconciliation_required';
      if(prior&&!counterMatches(prior,source,baseHash)){
        currentReason=currentReason??'refund_counterentry_conflict';
        if(prior.qualification!=='reconciliation_required')tx.update(counterRef(id,source.source.refundIntentId),{qualification:'reconciliation_required'});
      }
      else if(prior){if(prior.observationHash!==observationHash||prior.qualification!==qualification){tx.update(counterRef(id,source.source.refundIntentId),
        {qualification,observation,observationHash,observedAt:FieldValue.serverTimestamp()});counters.set(source.source.refundIntentId,{...prior,qualification});}}
      else if(current&&!currentReason){const f=source.terms.refund,row={type:'purchase_refund_counterentry',protocol,currency:'cad',transactionId:id,
        refundIntentId:source.source.refundIntentId,source:source.source,sourceHash:source.sourceHash,baseHash,
        serviceFee:-f.buyerFeeCents/100,shippingCostCollected:-f.shippingCents/100,taxCollected:-(f.gstCents+f.qstCents)/100,
        gst:-f.gstCents/100,qst:-f.qstCents/100,grossRevenue:-(f.buyerFeeCents+f.shippingCents+f.gstCents+f.qstCents)/100,
        qualification,observation,observationHash,createdAt:FieldValue.serverTimestamp(),observedAt:FieldValue.serverTimestamp(),
        taxRegisterIsParallel:true,fiscalEffectiveDate:null};tx.create(counterRef(id,source.source.refundIntentId),row);counters.set(source.source.refundIntentId,row);}
      else currentReason=currentReason??'refund_current_settlement_unqualified';
    }
    if(options.refundIntentId&&(!source||!revenue||!change)){
      const prior=counters.get(options.refundIntentId);
      if(prior&&prior.qualification!=='reconciliation_required')tx.update(counterRef(id,options.refundIntentId),{qualification:'reconciliation_required'});
    }
    const refunded={buyerFeeCents:0,shippingCents:0,taxCents:0};
    for(const row of sources){const d=counters.get(row.id);if(!row.source||!d||d.qualification!=='qualified'||
      // A new same-commit row has not yet received its native timestamp.
      !(row.id===options.refundIntentId&&current||counterMatches(d,row.source,baseHash))){currentReason=currentReason??'refund_current_accounting_unknown';continue;}
      refunded.buyerFeeCents+=row.source.terms.refund.buyerFeeCents;refunded.shippingCents+=row.source.terms.refund.shippingCents;
      refunded.taxCents+=row.source.terms.refund.gstCents+row.source.terms.refund.qstCents;}
    const projection={protocol,baseHash,qualification:currentReason?'reconciliation_required':'qualified',reason:currentReason,
      inspectedAllocations:sources.length,historyComplete:rows.size<101,taxRegisterIsParallel:true,
      // Tax register verifies this amount; it is NEVER added to revenue.taxCollected.
      currentTotals:currentReason?null:{serviceFee:(fee!-refunded.buyerFeeCents)/100,shippingCostCollected:(shipping!-refunded.shippingCents)/100,
        taxCollected:(taxTotal!-refunded.taxCents)/100},netMargin:null,fiscalEffectiveDate:null};
    const projectionHash=supportHash(projection);
    let sameProjection=false;
    try{sameProjection=previousProjection?.projectionHash===projectionHash&&
      supportHash(Object.fromEntries(Object.keys(projection).map(k=>[k,previousProjection?.[k]])))===projectionHash;}catch{/* replace only the current derived projection */}
    if(!sameProjection)tx.set(projectionRef,
      {...projection,transactionId:id,projectionHash,observedAt:FieldValue.serverTimestamp()});
    if(currentReason&&!alert.exists)tx.create(alertRef,{kind:'purchase_platform_accounting_reconciliation',severity:'warning',refId:id,
      protocol,reason:currentReason,status:'open',createdAt:FieldValue.serverTimestamp(),financialMovementAuthorized:false});
  }};
}
