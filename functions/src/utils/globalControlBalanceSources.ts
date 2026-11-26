/** Native control sources only. The caller supplies ONE read-only transaction
 * at its independently qualified readTime. No provider IO, account mutation,
 * historical zero backfill, or inference of coverage from an exhausted scan. */
import {Timestamp} from 'firebase-admin/firestore';
import {db} from '../config/firebase';
import {supportHash,supportSourceHash} from './supportRequest';
import {nativePurchasePaymentSource} from './purchasePolicy';
import {exactCents} from './shippingPurchaseRate';
import {qualifiedShopTierOperation,qualifiedShopTierSettlement} from '../callable/shopTier';
import {qualifiedShopTierTaxOperation,SHOP_TIER_TAX_PRICING_VERSION} from '../config/shopTierTax';
import {allocationLocalMovementsVerified,readAllocationHistoryIntent} from './refundAllocation';
import {readRefundRepairCardSettlement} from './refundRepair';

type Data=FirebaseFirestore.DocumentData;
export type GlobalControlSide='L'|'R'|'K';
export type GlobalControlEffect={effectId:string;eventId:string;componentId:string;representation:'closing_stock'|'period_variation'|'causal_evidence';
  side:GlobalControlSide;partition:string;accountId:string;balanceType:'payments'|'issuing'|'refund_and_dispute_prefunding'|'risk_reserved';currency:'CAD';amountCents:number;
  sourcePath:string;sourceHash:string;effectiveAt:Timestamp|null;providerRefs:{kind:string;id:string}[];qualification:'native_qualified'|'unknown';blockers:string[];
  providerExpectation?:{kind:'transfer';destinationAccountId:string}|{kind:'payout';destinationHash:string};
  feeDelegation?:{protocol:'shop_tier_processor_fee_v1';operationId:string;expectedGrossCents:number;pricingHash:string;settlementHash:string;joinProofHash:string}};
export type GlobalControlSourceRow={classId:string;sourcePath:string;sourceHash:string;effects:GlobalControlEffect[];blockers:string[]};
export type GlobalControlSourceCursor={catalogVersion:string;classIndex:number;parentCursor:string|null;currentParentId:string|null;rowCursor:string|null};
export type GlobalControlSourceScope={accountId:string;platformAccountId:string;accountKind:'platform'|'connected';livemode:boolean;currency:'CAD';readTime:Timestamp;
  period:{fromSeconds:number;toSeconds:number};platformContractHash:string|null;connectedOwnerId:string|null};
export type GlobalControlSourcePage={protocol:'global_control_source_page_v1';catalogVersion:string;rows:GlobalControlSourceRow[];blockers:string[];
  next:GlobalControlSourceCursor;closed:boolean};
export type GlobalControlNativeSource={classId:string;sourcePath:string;data:Data};
/** Missing joins are UNKNOWN; callers must explicitly supply absent snapshots
 * as null. No query, account or authorization can be supplied by source data. */
export type GlobalControlSourceJoins=Record<string,Data|null>;

const roots=['wallets','transactions','stripe_checkout_intents','withdrawal_requests','swaps','platform_ledger','eligibility_audit',
  'label_lifecycle_cases','label_lifecycle_commands','failed_operations','admin_alerts','disputes','automatic_decisions_log'];
const groups:[string,string][]=[['ledger','^wallets/[^/]+/ledger/[^/]+$'],
  ...['refund_allocations','refund_history','refund_repairs','refund_repair_commands','dispute_decisions'].map(n=>[n,`^transactions/[^/]+/${n}/[^/]+$`] as [string,string]),
  ...['topup_checkout','topup_checkout_commands','topup_refund','topup_release'].map(n=>[n,`^swaps/[^/]+/${n}/[^/]+$`] as [string,string]),
  ['topup_checkout_results','^swaps/[^/]+/topup_checkout_commands/[^/]+/results/[^/]+$'],
  ...['exceptional_commands','exceptional_evidence'].map(n=>[n,`^admin_alerts/[^/]+/${n}/[^/]+$`] as [string,string]),
  ['label_lifecycle_entries','^label_lifecycle_cases/[^/]+/entries/[^/]+$']];
/** Plain serializable registry: independent anchors must name this exact
 * catalogue AND compare each class's ordered path/hash count and digest. */
export const GLOBAL_CONTROL_SOURCE_CATALOG=[...roots.map(root=>({id:root,version:1,root,collectionGroup:null,namespace:`^${root}/[^/]+$`})),
  ...groups.map(([id,namespace])=>({id,version:1,root:null,collectionGroup:id==='topup_checkout_results'?'results':id==='label_lifecycle_entries'?'entries':id,namespace}))] as const;
export const GLOBAL_CONTROL_SOURCE_CATALOG_VERSION='global_control_source_catalog_v1_'+supportHash(GLOBAL_CONTROL_SOURCE_CATALOG);
export const GLOBAL_CONTROL_SOURCE_PAGE_SIZE=10;
export const initialGlobalControlSourceCursor=():GlobalControlSourceCursor=>({catalogVersion:GLOBAL_CONTROL_SOURCE_CATALOG_VERSION,classIndex:0,parentCursor:null,currentParentId:null,rowCursor:null});
const own=(d:Data,k:string)=>Object.prototype.hasOwnProperty.call(d,k);
const obj=(v:any):v is Data=>!!v&&typeof v==='object'&&!Array.isArray(v)&&!(v instanceof Timestamp);
const id=(v:any):v is string=>typeof v==='string'&&v.length>0&&v.length<=200&&!v.includes('/')&&!['.','..'].includes(v);
const hash=(v:any):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const cents=(v:any):v is number=>Number.isSafeInteger(v)&&v>=0;
const cad=(v:any)=>typeof v==='string'&&v.toUpperCase()==='CAD';
const time=(v:any,s:GlobalControlSourceScope):v is Timestamp=>v instanceof Timestamp&&v.seconds>0&&(v.seconds<s.readTime.seconds||v.seconds===s.readTime.seconds&&v.nanoseconds<=s.readTime.nanoseconds);
const sameTime=(a:any,b:any)=>a instanceof Timestamp&&b instanceof Timestamp&&a.isEqual(b);
// Match the bounded native provider codec, including its accepted underscores.
const stripe=(v:any,prefix:string)=>typeof v==='string'&&new RegExp('^'+prefix+'_[A-Za-z0-9_]{1,190}$').test(v);
const safeSum=(...values:number[])=>{const v=values.reduce((a,b)=>a+b,0);return Number.isSafeInteger(v)?v:null;};
const dollars=(v:any)=>typeof v==='number'?exactCents(Math.abs(v)):null;
const positiveDollars=(v:any)=>typeof v==='number'&&v>=0?exactCents(v):null;
const providerRefs=(d:Data)=>Object.entries({pi:d.paymentIntentId??d.stripePaymentIntentId,ch:d.chargeId??d.stripeChargeId,re:d.refundId??d.stripeRefundId,
  tr:d.stripeTransferId,po:d.stripePayoutId,txn:d.processorFeeBalanceTransactionId}).flatMap(([kind,v])=>stripe(v,kind)?[{kind,id:v as string}]:[]);
const walletComponent=(uid:string,bucket:string)=>`wallet:${uid}:${bucket}`;
const bucketPartition=(bucket:string)=>`wallet_${bucket==='balance'?'available':bucket==='pendingBalance'?'pending':'held'}_v1`;

/** Pure projection used by the pinned reader and focused local compositions.
 * A qualified partial fact may coexist with blockers; CORE must retain BOTH. */
export function classifyGlobalControlSource(input:GlobalControlNativeSource,s:GlobalControlSourceScope,joins:GlobalControlSourceJoins={}):GlobalControlSourceRow{
  const {classId,sourcePath,data:d}=input,p=sourcePath.split('/'),key=p.at(-1)!,effects:GlobalControlEffect[]=[],blockers:string[]=[];
  const sourceHash=supportSourceHash(d),row:GlobalControlSourceRow={classId,sourcePath,sourceHash,effects,blockers};
  const issue=(code:string)=>{if(!blockers.includes(code))blockers.push(code);};
  const get=(path:string)=>{if(!own(joins,path)){issue('native_join_not_read');return null;}return joins[path];};
  const refundContext=()=>{
    const txid=d.transactionId??(p[0]==='transactions'?p[1]:null),intentId=d.refundIntentId??key,o=txid?joins[`transactions/${txid}`]:null,
      intent=o&&o.refund?.intentId===intentId?o.refund:txid?joins[`transactions/${txid}/refund_history/${intentId}`]?.currentIntent:null,
      proof=txid?joins[`@refund-event/${txid}/${intentId}`]:null;
    return {txid,intentId,intent,proof,order:o};
  };
  const economicEvent=(representation:GlobalControlEffect['representation'],componentId:string,event:string)=>{
    if(representation!=='period_variation')return componentId;
    const txid=classId==='transactions'||classId==='stripe_checkout_intents'?key:d.transactionId??(p[0]==='transactions'?p[1]:null);
    if(classId==='withdrawal_requests')return `withdrawal:${key}:${/transfer/.test(event)?'transfer':/payout_paid/.test(event)?'payout':'reserve'}`;
    if(classId==='ledger'&&d.type==='withdrawal')return `withdrawal:${d.withdrawalRequestId}:reserve`;
    if(classId==='ledger'&&(/^exceptional_restitution_/.test(d.type)||d.type==='exceptional_compensation_credit')||classId==='platform_ledger'&&d.type==='exceptional_restitution')
      return `exceptional:${d.caseId}:${/void/.test(event)||d.type==='exceptional_restitution_void'?'void':/attest/.test(event)||d.type==='exceptional_compensation_credit'?'attest':'prepare'}`;
    if(classId==='platform_ledger'&&d.type==='shop_tier_revenue')return `shop_tier:${d.shopTierOperationId}:capture`;
    if(classId==='refund_allocations'||classId==='platform_ledger'&&d.type==='purchase_refund_counterentry'||classId==='ledger'&&/^refund_/.test(d.type)){
      const r=refundContext();
      return `refund:${txid}:${d.refundIntentId??key}:${d.type==='refund_hold'?'hold':event.endsWith(':card_repair')?`card_repair:${r.proof?.repairId??'unknown'}`:
        r.intent?.cardRepairSettlement||['failed','canceled'].includes(r.intent?.providerStatus)?'local_settlement':'settlement'}`;
    }
    if(txid){
      if(classId==='stripe_checkout_intents'&&/wallet_commit$/.test(event)||classId==='ledger'&&d.type==='purchase_debit'&&joins[`stripe_checkout_intents/${txid}`]?.walletLedgerId===key)return `purchase:${txid}:wallet_commit`;
      if(/seller_allocation$/.test(event)||classId==='ledger'&&['sale_credit','debt_repayment'].includes(d.type))return `purchase:${txid}:seller_allocation`;
      if(classId==='ledger'&&d.type==='funds_held')return `purchase:${txid}:hold:${d.createdAt.seconds}:${d.createdAt.nanoseconds}`;
      if(classId==='ledger'&&d.type==='funds_released')return `purchase:${txid}:release:${d.createdAt.seconds}:${d.createdAt.nanoseconds}`;
      return `purchase:${txid}:capture`;
    }
    return event;
  };
  const eventRefs=(eventId:string)=>{
    if(/^withdrawal:/.test(eventId)){
      const w=classId==='withdrawal_requests'?d:joins[`withdrawal_requests/${d.withdrawalRequestId}`];
      return /:transfer$/.test(eventId)&&stripe(w?.stripeTransferId,'tr')?[{kind:'tr',id:w!.stripeTransferId}]:
        /:payout$/.test(eventId)&&stripe(w?.stripePayoutId,'po')?[{kind:'po',id:w!.stripePayoutId}]:[];
    }
    if(/^purchase:/.test(eventId)){
      if(!/:capture$/.test(eventId))return [];
      const txid=classId==='transactions'?key:d.transactionId??key,o=classId==='transactions'?d:joins[`transactions/${txid}`];
      return o?[...providerRefs(o),...stripe(d.processorFeeBalanceTransactionId,'txn')?[{kind:'txn',id:d.processorFeeBalanceTransactionId}]:[]]:[];
    }
    if(/^refund:/.test(eventId)){
      if(/:hold$/.test(eventId))return [];
      const {intent:i,proof,order:o}=refundContext();
      if(!i||!cents(i.cardAmountCents)){issue('refund_card_native_source_unknown');return [];}
      if(!proof?.localVerified)issue('refund_local_committed_movements_unqualified');
      if(i.cardAmountCents===0)return [];
      if(!o||i.paymentIntentId!==o.stripePaymentIntentId||!stripe(i.paymentIntentId,'pi')||!stripe(o.stripeChargeId,'ch')){issue('refund_original_payment_edge_unqualified');return [];}
      const original=[{kind:'pi',id:i.paymentIntentId},{kind:'ch',id:o.stripeChargeId}];
      if(i.cardRepairSettlement){
        if(!proof?.repairQualified){issue('refund_card_repair_settlement_unqualified');return [];}
        return /:card_repair:/.test(eventId)?[{kind:'re',id:proof.repairRefundId},...original]:[];
      }
      if(['failed','canceled'].includes(i.providerStatus)){
        // refund.ts retains status/current-observation origin, but no complete
        // native failure BT/cash-return proof. Never call this cash-zero proof.
        issue('refund_card_cash_nonexecution_unproved');return [];
      }
      if(i.providerStatus!=='succeeded'||i.cardConfirmedCents!==i.cardAmountCents||!stripe(i.stripeRefundId,'re')){issue('refund_card_provider_outcome_unknown');return [];}
      return [{kind:'re',id:i.stripeRefundId},...original];
    }
    return providerRefs(d);
  };
  const effect=(componentId:string,partition:string,side:GlobalControlSide,amountCents:number,representation:GlobalControlEffect['representation'],effectiveAt:Timestamp|null,
    event:string,accountId=s.platformAccountId,refs?:{kind:string;id:string}[])=>{
    if(accountId!==s.accountId)return;
    if(!hash(s.platformContractHash)){issue('native_account_contract_unqualified');return;}
    if(!Number.isSafeInteger(amountCents)||representation==='closing_stock'&&side!=='K'&&amountCents<0){issue('native_amount_unsafe');return;}
    if(representation==='period_variation'&&!time(effectiveAt,s)){issue('native_effect_period_unknown');return;}
    const eventId=economicEvent(representation,componentId,event);
    const providerExpectation=classId==='withdrawal_requests'&&representation==='period_variation'?
      eventId.endsWith(':transfer')&&accountId===s.platformAccountId?{kind:'transfer' as const,destinationAccountId:d.stripeAccountId}:
        eventId.endsWith(':payout')?{kind:'payout' as const,destinationHash:supportHash([d.stripeAccountId,d.withdrawalIntent.bankAccountId])}:null:null;
    effects.push({effectId:supportHash(['global_control_effect_v1',accountId,componentId,event]),eventId,componentId,representation,side,partition,accountId,balanceType:'payments',
      currency:'CAD',amountCents,sourcePath,sourceHash,effectiveAt,providerRefs:refs??(representation==='period_variation'?eventRefs(eventId):providerRefs(d)),qualification:'native_qualified',blockers:[],
      ...(providerExpectation?{providerExpectation}:{})});
  };
  const stock=(componentId:string,partition:string,side:GlobalControlSide,n:number,account=s.platformAccountId)=>effect(componentId,partition,side,n,'closing_stock',s.readTime,'closing',account);
  const delta=(componentId:string,partition:string,side:GlobalControlSide,n:number,at:any,event=sourcePath,account=s.platformAccountId)=>effect(componentId,partition,side,n,'period_variation',at,event,account);
  const evidence=(componentId:string,partition:string,n=0,side:GlobalControlSide='L',at:Timestamp|null=null)=>effect(componentId,partition,side,n,'causal_evidence',at,sourcePath);
  const walletDelta=(uid:string,bucket:string,n:number,at:any,event=sourcePath)=>delta(walletComponent(uid,bucket),bucketPartition(bucket),'L',n,at,event);
  if(!obj(d)||!id(key)){issue('native_source_malformed');return row;}
  const descriptor=GLOBAL_CONTROL_SOURCE_CATALOG.find(c=>c.id===classId);
  if(!descriptor||!new RegExp(descriptor.namespace).test(sourcePath)){issue('native_source_class_unsupported');return row;}
  if(own(d,'livemode')&&d.livemode!==s.livemode){issue('native_financial_environment_conflict');return row;}
  if(own(d,'currency')&&!cad(d.currency)){issue('native_currency_unsupported');return row;}
  const root=()=>get(p.slice(0,2).join('/'));
  const parentRequired=()=>{const parent=root();if(!parent)issue('native_parent_missing');return parent;};
  const exceptional=()=>{
    const caseId=classId==='admin_alerts'?key:classId.startsWith('exceptional_')?p[1]:d.caseId,
      joined=typeof caseId==='string'?get(`@exceptional-event/${caseId}`):null;
    for(const code of joined?.blockers??[])issue(code);
    if(!joined?.qualified){for(const code of joined?.blockers??['exceptional_native_history_unknown'])issue(code);return null;}
    return joined;
  };
  if(classId==='exceptional_commands'||classId==='exceptional_evidence'){
    if(s.accountKind!=='platform')return row;
    const expected=classId==='exceptional_commands'?'er_':'xe_';
    if(d.caseId!==p[1]||key!==expected+supportHash([d.actorId,d.requestId])||!id(d.actorId)||!hash(d.inputHash)){issue('exceptional_journal_identity_unknown');return row;}
    if(d.state==='not_executed'&&time(d.recordedAt,s))return row;
    if(classId==='exceptional_evidence'){
      // Proof collection legitimately precedes the monetary case. It is not a
      // liability; unknown bytes/parents still cannot certify a settlement.
      if(!['upload_reserved','stored','stored_requires_review'].includes(d.state)||!time(d.reservedAt,s)||!hash(d.sourceHash)||!hash(d.sourceRevision)||
        !['identity_destination','harm_or_authority','execution'].includes(d.purpose))issue('exceptional_evidence_record_unknown');
      const target=d.context?.kind==='wallet_restitution'?`wallets/${d.context.ownerId}`:d.context?.kind==='withdrawal_misdirection'?`withdrawal_requests/${d.context.withdrawalRequestId}`:
        d.context?.kind==='refund_error'?`transactions/${d.context.transactionId}`:null;
      if(!target||!get(target))issue('exceptional_evidence_native_source_missing');
      if(d.state==='stored'&&(!hash(d.contentHash)||!time(d.recordedAt,s)||d.storageProof?.temporaryHold!==true||!/^\d{1,30}$/.test(d.storageProof?.generation??'')||
        d.storageProof?.sha256!==d.file?.sha256))issue('exceptional_evidence_storage_proof_unknown');
      evidence(`exceptional:${p[1]}:proof:${key}`,'exceptional_private_evidence_integrity_v1',0,'K',time(d.recordedAt,s)?d.recordedAt:null);return row;
    }
    if(d.state!=='committed'||d.inputHash!==supportHash(d.command)||!time(d.recordedAt,s)||!exceptional())issue('exceptional_command_causal_source_unknown');
    else evidence(`exceptional:${p[1]}:command:${key}`,'exceptional_human_command_v1',0,'K',d.recordedAt);
    return row;
  }
  if(classId==='wallets'){
    if(s.accountKind!=='platform')return row;
    if(!cad(d.currency)||!['active','inactive'].includes(d.status)){issue('wallet_identity_or_currency_unqualified');return row;}
    for(const b of ['balance','pendingBalance','heldBalance']){
      if(!own(d,b)||!cents(d[b]))issue(`wallet_${b}_missing_or_malformed`);else stock(walletComponent(key,b),bucketPartition(b),'L',d[b]);
    }
    if(!own(d,'sellerDebt')||!cents(d.sellerDebt))issue('wallet_sellerDebt_missing_or_malformed');
    else if(d.sellerDebt>0){evidence(`wallet:${key}:debt`,'seller_debt_not_receivable_v1',d.sellerDebt,'R');issue('seller_debt_receivable_funding_and_account_unproved');}
    return row;
  }
  if(classId==='stripe_checkout_intents'){
    if(s.accountKind!=='platform')return row;
    const o=get(`transactions/${key}`);
    if(!o||d.schemaVersion!==1||d.protocol!=='server_manual_v1'||d.transactionId!==key||d.ownerId!==o.buyerId||d.sellerId!==o.sellerId||
      !id(d.ownerId)||!id(d.sellerId)||!cad(d.currency)||![d.walletCents,d.cardCents,d.totalCents].every(cents)||safeSum(d.walletCents,d.cardCents)!==d.totalCents){issue('checkout_native_identity_or_amount_unqualified');return row;}
    const component=`checkout:${key}:wallet`,partition='checkout_wallet_committed_v1';
    if(d.walletCommittedAt!=null){
      const l=id(d.walletLedgerId)?get(`wallets/${d.ownerId}/ledger/${d.walletLedgerId}`):null;
      if(!time(d.walletCommittedAt,s)||!l||l.type!=='purchase_debit'||l.transactionId!==key||l.amount!==d.walletCents||!sameTime(l.createdAt,d.walletCommittedAt)||o.walletAmountUsed!==d.walletCents){issue('checkout_wallet_commit_unqualified');}
      else {
        const attributed=time(o.paidAt,s)&&nativePurchasePaymentSource(o,key)!==null;
        stock(component,partition,'L',attributed?0:d.walletCents);
        delta(component,partition,'L',d.walletCents,d.walletCommittedAt,`${sourcePath}:wallet_commit`);
        if(attributed)delta(component,partition,'L',-d.walletCents,o.paidAt,`${sourcePath}:wallet_attributed`);
      }
    }else {stock(component,partition,'L',0);if(d.walletCents>0&&o.walletAmountUsed>0)issue('checkout_wallet_debit_without_commit');}
    if(!cents(d.receivedCents)||!cents(d.capturableCents)||!['prepared','requires_payment_method','requires_confirmation','requires_action','processing','requires_capture','succeeded','canceled','retired'].includes(d.state))issue('checkout_card_capture_unknown');
    else if(d.receivedCents>d.cardCents||d.capturableCents>d.cardCents||d.state==='canceled'&&(d.receivedCents!==0||d.capturableCents!==0))issue('checkout_card_capture_contradiction');
    if(d.state==='retired'&&!(d.cardCapabilityNeutralized===true&&d.receivedCents===0&&d.capturableCents===0))issue('checkout_retirement_unqualified');
    if(cents(d.receivedCents))evidence(`checkout:${key}:card`,'checkout_card_observation_v1',d.receivedCents);
    return row;
  }
  if(classId==='transactions'){
    if(s.accountKind!=='platform')return row;
    if(!id(d.buyerId)||!id(d.sellerId)||d.buyerId===d.sellerId){issue('purchase_parties_unknown');return row;}
    if(d.deliveryType==='meetup'&&d.cashAgreement?.platformMoneyObligationCents===0&&!d.stripePaymentIntentId&&!d.walletPayment&&!d.refund)return row;
    const payment=nativePurchasePaymentSource(d,key),component=`purchase:${key}:unallocated`,partition='purchase_unallocated_member_funds_v1';
    if(!payment){
      if(d.status==='pending_payment'&&d.paidAt==null)return row;
      issue('purchase_original_payment_unqualified');return row;
    }
    const payout=exactCents(d.sellerPayout),total=exactCents(d.totalAmount),amount=exactCents(d.amount);
    if(!time(d.paidAt,s)||payout===null||total===null||amount===null||payment.amountCents!==total||payout!==amount){issue('purchase_capture_components_unqualified');return row;}
    if(payment.kind==='wallet_ledger'){
      const l=id(payment.referenceId)?get(`wallets/${d.buyerId}/ledger/${payment.referenceId}`):null;
      if(!l||l.type!=='purchase_debit'||l.transactionId!==key||l.amount!==total||!sameTime(l.createdAt,d.paidAt))issue('purchase_wallet_payment_missing');
    }else if(!stripe(d.stripePaymentIntentId,'pi')||!stripe(d.stripeChargeId,'ch')||!cents(d.capturedCardCents)||d.capturedCardCents!==(payment.amountCents-(payment.walletCents??0)))issue('purchase_card_capture_unqualified');
    const attributed=own(d,'sellerCreditRecordedAt');
    if(attributed&&(!time(d.sellerCreditRecordedAt,s)||![d.sellerCreditedCents,d.sellerPendingCreditCents,d.sellerDebtRepaidCents].every(cents)||d.sellerCreditedCents!==payout||safeSum(d.sellerPendingCreditCents,d.sellerDebtRepaidCents)!==payout))issue('purchase_seller_allocation_unqualified');
    else {
      stock(component,partition,'L',attributed?0:payout);delta(component,partition,'L',payout,d.paidAt,`${sourcePath}:capture`);
      if(attributed)delta(component,partition,'L',-payout,d.sellerCreditRecordedAt,`${sourcePath}:seller_allocation`);
    }
    if(d.bankDispute!=null||d.disputeId!=null)issue('purchase_bank_obligation_partition_unqualified');
    if(d.refund&&!id(d.refund.intentId))issue('purchase_refund_identity_unknown');
    return row;
  }
  if(classId==='withdrawal_requests'){
    const i=d.withdrawalIntent,submission=d.providerSubmission;
    if(d.status==='not_executed'&&d.ledgerEntryId==null){if(d.nonExecution?.qualified!==true)issue('withdrawal_non_execution_proof_unqualified');return row;}
    if(!id(d.userId)||!id(d.ledgerEntryId)||!cents(d.amount)||d.amount<=0||!stripe(d.stripeAccountId,'acct')||!i||i.schemaVersion!==1||i.ownerId!==d.userId||i.withdrawalRequestId!==key||
      i.amountCents!==d.amount||i.currency!=='CAD'||i.accountId!==d.stripeAccountId||i.debitLedgerId!==d.ledgerEntryId||!hash(i.payloadHash)||!time(i.committedAt,s)){
      issue('withdrawal_native_intent_unqualified');return row;
    }
    const l=get(`wallets/${d.userId}/ledger/${d.ledgerEntryId}`);
    if(!l||l.type!=='withdrawal'||l.withdrawalRequestId!==key||l.amount!==d.amount||l.withdrawalIntentHash!==i.payloadHash||!sameTime(l.createdAt,i.committedAt)){
      issue('withdrawal_debit_unqualified');return row;
    }
    if(!submission||submission.schemaVersion!==1||submission.ownerId!==d.userId||submission.withdrawalRequestId!==key||submission.accountId!==d.stripeAccountId||submission.amountCents!==d.amount||submission.payloadHash!==i.payloadHash){issue('withdrawal_submission_unqualified');return row;}
    const tr=submission.transfer,po=submission.payout,component=`withdrawal:${key}:transit`,partition='withdrawal_transit_v1';
    if(tr?.state==='not_started'&&tr.providerId==null&&!d.stripeTransferId){
      stock(component,partition,'L',d.amount);delta(component,partition,'L',d.amount,i.committedAt,`${sourcePath}:debit`);return row;
    }
    if(tr?.state!=='created'||tr.providerId!==d.stripeTransferId||!stripe(d.stripeTransferId,'tr')||!time(tr.observedAt,s)){issue('withdrawal_transfer_outcome_unknown');return row;}
    const account=d.stripeAccountId;
    // A native completed transfer changes WHICH account carries the same
    // obligation. The platform cash preflight is not proof of bank arrival.
    stock(component,partition,'L',0);delta(component,partition,'L',d.amount,i.committedAt,`${sourcePath}:debit`);
    delta(component,partition,'L',-d.amount,tr.observedAt,`${sourcePath}:transfer_out`);
    let closed=false;
    if(d.status==='completed'&&d.payoutOutcome==='paid'&&stripe(d.stripePayoutId,'po')&&po?.state==='created'&&po.providerId===d.stripePayoutId&&time(d.completedAt,s)){
      if(!stripe(i.bankAccountId,'ba')||i.bankAccountId!==submission.bankAccountId||i.bankAccountId!==d.payoutDestination?.bankAccountId||
        d.payoutDestination.accountId!==d.stripeAccountId)issue('withdrawal_frozen_bank_destination_unqualified');else closed=true;
    }
    else if(d.status==='failed'){
      const recovery=d.payoutRecovery;
      if(recovery?.state==='recovered'&&time(recovery.reconciledAt,s))issue('withdrawal_recovery_account_movements_require_native_receipts');
      else issue('withdrawal_failed_funds_location_unknown');
    }else if(!['processing'].includes(d.status)||!['pending','in_transit'].includes(d.payoutOutcome)||po?.state!=='created'||po.providerId!==d.stripePayoutId||!stripe(d.stripePayoutId,'po'))issue('withdrawal_payout_outcome_unknown');
    stock(component,partition,'L',closed?0:d.amount,account);delta(component,partition,'L',d.amount,tr.observedAt,`${sourcePath}:transfer_in`,account);
    if(closed)delta(component,partition,'L',-d.amount,d.completedAt,`${sourcePath}:payout_paid`,account);
    return row;
  }
  if(classId==='ledger'){
    if(s.accountKind!=='platform')return row;
    const uid=p[1],wallet=parentRequired();
    if(!wallet||!cents(d.amount)||!cents(d.balanceAfter)||!time(d.createdAt,s)){issue('wallet_ledger_amount_time_or_parent_unknown');return row;}
    let o:Data|null=null;
    if(id(d.transactionId))o=get(`transactions/${d.transactionId}`);else if(id(d.swapId))o=get(`swaps/${d.swapId}`);
    if(d.type==='exceptional_compensation_credit'){
      const x=exceptional(),r=x?.case;
      if(!r||r.ownerId!==uid||r.funding!=='seconde_wallet_compensation'||r.instructionId!==d.instructionId||!x.compensation||supportSourceHash(x.compensation)!==sourceHash)issue('exceptional_compensation_ledger_native_join_unknown');
      else {walletDelta(uid,'balance',d.balanceCreditCents,d.createdAt);
        stock(`exceptional:${r.caseId}:funded_debt_offset`,'funded_debt_recovery_v1','K',d.debtOffsetCents);
        delta(`exceptional:${r.caseId}:funded_debt_offset`,'funded_debt_recovery_v1','K',d.debtOffsetCents,d.createdAt);}
    }else if(d.type==='exceptional_restitution_reserve'||d.type==='exceptional_restitution_void'){
      const x=exceptional(),r=x?.case,expected=d.type==='exceptional_restitution_reserve'?x?.reserve:x?.returned;
      if(!r||r.ownerId!==uid||r.context.kind!=='wallet_restitution'||r.instructionId!==d.instructionId||!expected||supportSourceHash(expected)!==sourceHash)
        issue('exceptional_wallet_ledger_native_join_unknown');
      else walletDelta(uid,'balance',d.type==='exceptional_restitution_reserve'?-d.amount:d.amount,d.createdAt);
    }else if(d.type==='purchase_debit'){
      const checkout=id(d.transactionId)?get(`stripe_checkout_intents/${d.transactionId}`):null;
      if(!o||o.buyerId!==uid||(o.walletPayment?.ledgerId!==key&&checkout?.walletLedgerId!==key)||d.amount!==(checkout?.walletLedgerId===key?checkout.walletCents:o.walletPayment?.amountCents))issue('wallet_purchase_debit_association_unknown');
      else walletDelta(uid,'balance',-d.amount,d.createdAt);
    }else if(d.type==='sale_credit'){
      if(!o||id(d.transactionId)&&(o.sellerId!==uid||d.amount!==o.sellerPendingCreditCents||!sameTime(d.createdAt,o.sellerCreditRecordedAt))||id(d.swapId)&&(![o.initiatorId,o.receiverId].includes(uid)||d.amount!==o.cashTopUp?.amount||!sameTime(d.createdAt,o.topUpPaidAt)))issue('wallet_sale_credit_association_unknown');
      else walletDelta(uid,'pendingBalance',d.amount,d.createdAt);
    }else if(d.type==='funds_held'){
      if(!o||id(d.transactionId)&&o.sellerId!==uid||id(d.swapId)&&![o.initiatorId,o.receiverId].includes(uid))issue('wallet_hold_association_unknown');
      else {walletDelta(uid,'pendingBalance',-d.amount,d.createdAt);walletDelta(uid,'heldBalance',d.amount,d.createdAt);}
    }else if(d.type==='funds_released'){
      // A release may simultaneously repay debt. Without the native split,
      // moving its gross amount into available would invent member money.
      if(!o||id(d.transactionId)&&o.sellerId!==uid||id(d.swapId)&&![o.initiatorId,o.receiverId].includes(uid))issue('wallet_release_association_unknown');
      else {const siblings=id(d.transactionId)?get(`@ledger-event/${sourcePath}`):null,
          debtRows=siblings?.rows?.filter((r:Data)=>r.data.type==='debt_repayment')??[],
          debt=id(d.transactionId)?siblings&&!siblings.saturated&&debtRows.length<=1?(debtRows[0]?.data.amount??0):null:0;
        if(!cents(debt)||debt>d.amount)issue('wallet_release_debt_split_unknown');else {walletDelta(uid,'heldBalance',-d.amount,d.createdAt);walletDelta(uid,'balance',d.amount-debt,d.createdAt);}}
    }else if(d.type==='withdrawal'){
      const w=id(d.withdrawalRequestId)?get(`withdrawal_requests/${d.withdrawalRequestId}`):null;
      if(!w||w.userId!==uid||w.ledgerEntryId!==key||w.amount!==d.amount||w.withdrawalIntent?.payloadHash!==d.withdrawalIntentHash)issue('wallet_withdrawal_association_unknown');
      else walletDelta(uid,'balance',-d.amount,d.createdAt);
    }else if(d.type==='refund_credit'){
      const r=id(d.transactionId)&&id(d.refundIntentId)?get(`transactions/${d.transactionId}/refund_allocations/${d.refundIntentId}`):null;
      if(!o||o.buyerId!==uid||!r||r.buyerId!==uid||r.terms?.walletCents!==d.amount||!sameTime(r.settlement?.appliedAt,d.createdAt)||key!==`refund_credit_${d.refundIntentId}`)issue('wallet_refund_credit_association_unknown');
      else walletDelta(uid,'balance',d.amount,d.createdAt);
    }else if(d.type==='refund_hold'){
      if(!o||o.sellerId!==uid||o.refund?.intentId!==d.refundIntentId||o.refund.freezeCents!==d.amount)issue('wallet_refund_hold_association_unknown');
      else {walletDelta(uid,'balance',-d.amount,d.createdAt);walletDelta(uid,'heldBalance',d.amount,d.createdAt);}
    }else if(d.type==='refund_debit'){
      const r=id(d.transactionId)&&id(d.refundIntentId)?get(`transactions/${d.transactionId}/refund_allocations/${d.refundIntentId}`):null,settlement=r?.settlement;
      if(!o||o.sellerId!==uid||!r||!sameTime(settlement?.appliedAt,d.createdAt)||!['fromPendingCents','fromHeldCents','fromBalanceCents','debtCents'].every(k=>cents(settlement[k]))||
        safeSum(settlement.fromPendingCents,settlement.fromHeldCents,settlement.fromBalanceCents)!==d.amount||settlement.debtCents!==d.debtRecorded)issue('wallet_refund_debit_split_unknown');
      else {for(const [bucket,k] of [['pendingBalance','fromPendingCents'],['heldBalance','fromHeldCents'],['balance','fromBalanceCents']])walletDelta(uid,bucket,-settlement[k],d.createdAt);}
    }else if(d.type==='debt_repayment'){
      if(!o||o.sellerId!==uid||o.sellerDebtRepaidCents!==d.amount||!sameTime(d.createdAt,o.sellerCreditRecordedAt))issue('wallet_debt_repayment_funding_unknown');
      else {stock(`purchase:${d.transactionId}:debt_recovery`,'funded_debt_recovery_v1','K',d.amount);delta(`purchase:${d.transactionId}:debt_recovery`,'funded_debt_recovery_v1','K',d.amount,d.createdAt);}
    }else issue('wallet_ledger_type_unsupported');
    return row;
  }
  if(classId==='platform_ledger'){
    if(s.accountKind!=='platform')return row;
    const txid=d.transactionId,o=id(txid)?get(`transactions/${txid}`):null;
    if(d.type==='exceptional_restitution'||d.type==='exceptional_manual_bank_reference'){
      const x=exceptional(),r=x?.case;
      if(!x||!r||!time(r.preparedAt,s)||key!==(d.type==='exceptional_restitution'?'exceptional_restitution_'+r.caseId:'manual_bank_transfer_'+x.reference?.referenceHash)||
        supportSourceHash(d)!==supportSourceHash(d.type==='exceptional_restitution'?x.liability:x.reference)){issue('exceptional_platform_native_join_unknown');return row;}
      if(d.type==='exceptional_manual_bank_reference'){evidence(`exceptional:${r.caseId}:bank_reference`,'exceptional_manual_bank_reference_v1',r.amountCents,'K',r.attestedAt);return row;}
      const component=`exceptional:${r.caseId}:liability`,partition=r.funding==='existing_wallet'?'wallet_restitution_payable_v1':'seconde_compensation_payable_v1';
      stock(component,partition,'L',d.reservedLiabilityCents);delta(component,partition,'L',r.amountCents,r.preparedAt,sourcePath+':prepare');
      if(['seconde_compensation','seconde_wallet_compensation'].includes(r.funding)){
        const charge=r.state==='voided'?0:-r.amountCents;
        stock(`exceptional:${r.caseId}:expense`,'seconde_compensation_expense_v1','K',charge);
        delta(`exceptional:${r.caseId}:expense`,'seconde_compensation_expense_v1','K',-r.amountCents,r.preparedAt,sourcePath+':prepare');
        if(r.state==='voided')delta(`exceptional:${r.caseId}:expense`,'seconde_compensation_expense_v1','K',r.amountCents,r.voidedAt,sourcePath+':void');
      }
      if(r.state==='voided')delta(component,partition,'L',-r.amountCents,r.voidedAt,sourcePath+':void');
      if(r.state==='operator_attested'){
        delta(component,partition,'L',-r.amountCents,r.attestedAt,sourcePath+':attest');
        if(r.funding==='seconde_wallet_compensation')evidence(`exceptional:${r.caseId}:wallet_credit`,'native_compensatory_wallet_credit_v1',r.amountCents,'K',r.attestedAt);
        else {evidence(`exceptional:${r.caseId}:bank_execution`,'human_bank_disbursement_outside_stripe_v1',d.manuallyDisbursedCents,'K',r.attestedAt);issue('manual_bank_cash_outside_provider_scope');}
      }
      return row;
    }else if(d.type==='service_fee_revenue'){
      const current=id(txid)?get(`platform_ledger/purchase_accounting_state_${txid}`):null,
        fee=positiveDollars(d.serviceFee),shipping=positiveDollars(d.shippingCostCollected),tax=positiveDollars(d.taxCollected),processor=own(d,'processorFees')?positiveDollars(d.processorFees):null;
      if(!o||!time(d.createdAt,s)||!current||current.protocol!=='purchase_platform_accounting_v1'||current.qualification!=='qualified'||current.historyComplete!==true||current.taxRegisterIsParallel!==true||
        current.baseHash!==d.accountingSourceHash||!hash(d.accountingSourceHash)||[fee,shipping,tax].some(v=>v===null)||!current.currentTotals){issue('platform_purchase_accounting_unknown');return row;}
      const netFee=positiveDollars(current.currentTotals.serviceFee),netShipping=positiveDollars(current.currentTotals.shippingCostCollected),netTax=positiveDollars(current.currentTotals.taxCollected);
      if([netFee,netShipping,netTax].some(v=>v===null)){issue('platform_current_components_unknown');return row;}
      stock(`purchase:${txid}:platform_revenue`,'platform_revenue_v1','K',netFee!+netShipping!);
      delta(`purchase:${txid}:platform_revenue`,'platform_revenue_v1','K',fee!+shipping!,d.createdAt);
      stock(`purchase:${txid}:tax`,'platform_tax_obligation_v1','L',netTax!);delta(`purchase:${txid}:tax`,'platform_tax_obligation_v1','L',tax!,d.createdAt);
      const payment=nativePurchasePaymentSource(o,txid);
      if(payment?.kind==='wallet_ledger'){
        if(processor!==null&&processor!==0)issue('wallet_only_processor_fee_conflict');
        else {stock(`purchase:${txid}:processor_fee`,'processor_fee_v1','K',0);delta(`purchase:${txid}:processor_fee`,'processor_fee_v1','K',0,d.createdAt);}
      }else if(processor===null||!stripe(d.processorFeeChargeId,'ch')||d.processorFeeChargeId!==o.stripeChargeId||!stripe(d.processorFeeBalanceTransactionId,'txn'))issue('processor_fee_provenance_unknown');
      else {stock(`purchase:${txid}:processor_fee`,'processor_fee_v1','K',-processor);delta(`purchase:${txid}:processor_fee`,'processor_fee_v1','K',-processor,d.createdAt);}
      // Carrier costs may be paid by another bank/account: never subtract them
      // from Stripe cash or K merely because this accounting row records one.
      if(positiveDollars(d.carrierCost)!==null)evidence(`purchase:${txid}:carrier_cost`,'carrier_cost_outside_stripe_cash_v1',positiveDollars(d.carrierCost)!,'K');else issue('carrier_cost_native_amount_unknown');
    }else if(d.type==='tax_collected'){
      const base=id(txid)?get(`platform_ledger/service_fee_revenue_${txid}`):null;
      if(!base||positiveDollars(d.taxTotal)===null||positiveDollars(d.taxTotal)!==positiveDollars(base.taxCollected))issue('parallel_tax_register_conflict');
      else evidence(`purchase:${txid}:tax`,'parallel_tax_register_v1',positiveDollars(d.taxTotal)!);
    }else if(d.type==='purchase_refund_counterentry'){
      const r=id(txid)&&id(d.refundIntentId)?get(`transactions/${txid}/refund_allocations/${d.refundIntentId}`):null;
      if(d.protocol!=='purchase_platform_accounting_v1'||d.qualification!=='qualified'||!r||!time(d.createdAt,s)||!obj(d.source)||d.sourceHash!==supportSourceHash(d.source)||
        d.source?.reservationHash!==r.reservationHash||d.source?.termsHash!==supportHash(r.terms)||[d.serviceFee,d.shippingCostCollected,d.taxCollected].some(v=>typeof v!=='number'||v>0||dollars(v)===null))issue('platform_refund_counterentry_unknown');
      else {delta(`purchase:${txid}:platform_revenue`,'platform_revenue_v1','K',-(dollars(d.serviceFee)!+dollars(d.shippingCostCollected)!),d.createdAt);
        delta(`purchase:${txid}:tax`,'platform_tax_obligation_v1','L',-dollars(d.taxCollected)!,d.createdAt);}
    }else if(d.protocol==='purchase_platform_accounting_v1'&&key===`purchase_accounting_state_${txid}`){
      if(d.qualification!=='qualified'||d.historyComplete!==true||!d.currentTotals)issue('platform_current_accounting_unknown');
    }else if(d.type==='shipping_cost_variance'){if(positiveDollars(d.actualShippingCost)===null)issue('carrier_cost_native_amount_unknown');else evidence(`purchase:${txid}:carrier_cost`,'carrier_cost_outside_stripe_cash_v1',positiveDollars(d.actualShippingCost)!,'K');}
    else if(d.type==='shop_tier_revenue'){
      const operation=id(d.shopTierOperationId)?get(`eligibility_audit/${d.shopTierOperationId}`):null,
        pricing=operation?qualifiedShopTierTaxOperation(operation):null,settlement=operation?.settlement;
      if(d.shopTierPricingVersion!==SHOP_TIER_TAX_PRICING_VERSION||!operation||!pricing||settlement?.protocol!=='shop_tier_settlement_v2'||
        !qualifiedShopTierOperation(operation,d.shopTierOperationId)||!qualifiedShopTierSettlement(operation,d.shopTierOperationId,d)||
        key!==`shop_tier_revenue_${operation.paymentIntentId}`||!time(d.createdAt,s)||!time(operation.createdAt,s)||!time(operation.settledAt,s)||
        !sameTime(settlement.recordedAt,d.createdAt)||!stripe(d.paymentIntentId,'pi')||!stripe(d.chargeId,'ch')){
        issue('shop_tier_accounting_partition_requires_native_settlement');return row;
      }
      const component=`shop_tier:${d.shopTierOperationId}`,event=`${sourcePath}:capture`;
      stock(`${component}:revenue`,'shop_tier_revenue_v2','K',pricing.netCents);
      delta(`${component}:revenue`,'shop_tier_revenue_v2','K',pricing.netCents,d.createdAt,event);
      stock(`${component}:tax`,'platform_tax_obligation_v1','L',pricing.taxCents);
      delta(`${component}:tax`,'platform_tax_obligation_v1','L',pricing.taxCents,d.createdAt,event);
      // Explicit documentary delegation, NOT a numeric assertion of fee=0.
      // CORE alone may resolve the exact provider fee/feeDetails in this account.
      const before=effects.length;
      effect(`${component}:processor_fee`,'processor_fee_v1','K',0,'causal_evidence',d.createdAt,event,s.platformAccountId,
        [{kind:'pi',id:d.paymentIntentId},{kind:'ch',id:d.chargeId}]);
      const marker=effects[before];
      if(marker){marker.eventId=`shop_tier:${d.shopTierOperationId}:capture`;marker.feeDelegation={protocol:'shop_tier_processor_fee_v1',operationId:d.shopTierOperationId,
        expectedGrossCents:pricing.totalCents,pricingHash:pricing.hash,settlementHash:settlement.proofHash,
        joinProofHash:supportSourceHash({protocol:'shop_tier_processor_fee_native_join_v1',sourcePath,sourceHash,
          operationRef:`eligibility_audit/${d.shopTierOperationId}`,operationSourceHash:supportSourceHash(operation),pricing,settlement})};}
    }
    else issue('platform_ledger_type_unsupported');
    return row;
  }
  if(classId==='refund_allocations'){
    const o=parentRequired(),i=o?.refund?.intentId===key?o.refund:get(`transactions/${p[1]}/refund_history/${key}`)?.currentIntent;
    if(!o||d.protocol!=='purchase_refund_allocation_record_v1'||d.transactionId!==p[1]||d.refundIntentId!==key||d.buyerId!==o.buyerId||d.sellerId!==o.sellerId||
      !obj(d.reservation)||!obj(d.basis)||d.reservationHash!==supportSourceHash(d.reservation)||d.reservation?.termsHash!==supportHash(d.terms)||d.basisHash!==supportSourceHash(d.basis)||!i||i.intentId!==key||i.allocation?.reservationHash!==d.reservationHash){issue('refund_allocation_native_association_unknown');return row;}
    const decision=id(d.reservation?.decisionId)?get(`transactions/${p[1]}/dispute_decisions/${d.reservation.decisionId}`):null;
    if(!decision||decision.kind!=='admin_financial_decision_v1'||decision.refundIntentId!==key||decision.effectsCommitted!==true||!time(decision.committedAt,s))issue('refund_obligation_decision_native_proof_unknown');
    const amount=i.outstandingCardCents,component=`refund:${p[1]}:${key}:card`,partition='refund_card_obligation_v1';
    if(!cents(i.cardAmountCents)||!cents(i.cardConfirmedCents)||!cents(amount)||amount>i.cardAmountCents||safeSum(amount,i.cardConfirmedCents)!==i.cardAmountCents)issue('refund_card_obligation_unknown');
    else if(amount>0&&!time(i.fundsAppliedAt,s)){
      issue('refund_obligation_wallet_overlap_unqualified');
      evidence(component,partition,amount);
    }else {
      stock(component,partition,'L',amount);
      // A reservation is a real new obligation only after a native decision
      // authorizes it; an agreement/request or recovery locator alone is not.
      const proof=refundContext().proof;
      if(i.cardRepairSettlement&&!proof?.repairQualified)issue('refund_card_repair_settlement_unqualified');
      if(time(i.fundsAppliedAt,s)){
        // The frozen allocation's card share and its actual local settlement
        // establish the gross reassignment BEFORE separate card satisfaction.
        // A rejected late R2 proof cannot replace that history with today's
        // outstanding=0. Without local proof, keep the variation unknown.
        if(i.cardRepairSettlement){
          if(proof?.localVerified===true)delta(component,partition,'L',d.terms.cardCents,i.fundsAppliedAt,`${sourcePath}:local_commit`);
          else issue('refund_local_historical_card_obligation_unknown');
        }else delta(component,partition,'L',amount,i.fundsAppliedAt,`${sourcePath}:local_commit`);
        if(i.cardRepairSettlement&&proof?.repairQualified)delta(component,partition,'L',-i.cardAmountCents,proof.repairAt,`${sourcePath}:card_repair`);
      }
      else if(amount>0)issue('refund_obligation_decision_or_period_unknown');
    }
    if(!cents(i.localOutstandingWalletCents)||i.localOutstandingWalletCents!==0||!cents(i.localOutstandingSellerCents)||i.localOutstandingSellerCents!==0)issue('refund_local_obligation_partition_unknown');
    if(time(i.fundsAppliedAt,s)){
      const settlement=d.settlement,cost=d.terms?.platformArticleCostCents,debt=settlement?.debtCents;
      if(!sameTime(settlement?.appliedAt,i.fundsAppliedAt)||!cents(cost)||!cents(debt))issue('refund_platform_loss_source_unknown');
      else {const n=safeSum(cost,debt);if(n===null)issue('refund_platform_loss_amount_unsafe');else {
        stock(`refund:${p[1]}:${key}:platform_loss`,'refund_platform_funded_loss_v1','K',-n);
        delta(`refund:${p[1]}:${key}:platform_loss`,'refund_platform_funded_loss_v1','K',-n,i.fundsAppliedAt,`${sourcePath}:loss`);
      }}
    }
    if(i.bankWaiting||i.legacyReconciliationRequired||o.refundAllocationState?.reviewRequired)issue('refund_current_review_or_bank_obligation_unknown');
    return row;
  }
  if(classId==='refund_history'){
    const o=parentRequired();if(!o||d.protocol!=='purchase_refund_history_v1'||d.transactionId!==p[1]||d.intentId!==key||d.buyerId!==o.buyerId||d.sellerId!==o.sellerId||
      !obj(d.originalIntent)||d.originalIntentHash!==supportSourceHash(d.originalIntent)||d.currentIntent?.intentId!==key||!get(`transactions/${p[1]}/refund_allocations/${key}`))issue('refund_history_native_association_unknown');
    return row; // Its allocation owns the unique logical obligation.
  }
  if(classId==='refund_repairs'||classId==='refund_repair_commands'){
    const o=parentRequired();if(!o||!id(d.refundIntentId??d.command?.refundIntentId)){issue('refund_repair_native_association_unknown');return row;}
    if(classId==='refund_repairs'&&(d.protocol!=='purchase_refund_repair_record_v1'||!['reserved','succeeded','card_repaired','failed','not_executed','reconciliation_required','unknown'].includes(d.state)))issue('refund_repair_state_unknown');
    if(classId==='refund_repairs'&&!['not_executed','card_repaired'].includes(d.state)&&!refundContext().proof?.repairQualified)issue('refund_repair_provider_observation_required');
    return row; // A repair attempt NEVER creates a second logical refund.
  }
  if(classId==='swaps'){
    if(!id(d.initiatorId)||!id(d.receiverId)||d.initiatorId===d.receiverId){issue('swap_parties_unknown');return row;}
    const hints=Object.keys(d).some(k=>/^topup|^refund|paymentintent|stripecharge/i.test(k));
    if(d.cashTopUp==null&&!hints)return row;
    if(!d.cashTopUp||!cents(d.cashTopUp.amount)||![d.initiatorId,d.receiverId].includes(d.cashTopUp.payerId)){issue('swap_topup_source_unknown');return row;}
    if(d.topUpPaidAt==null){if(d.topUpPaymentStatus&&!['pending','unpaid'].includes(d.topUpPaymentStatus))issue('swap_topup_capture_unknown');return row;}
    if(!time(d.topUpPaidAt,s)||!stripe(d.topUpPaymentIntentId??d.stripePaymentIntentId,'pi'))issue('swap_topup_capture_identity_unknown');
    // Wallet buckets own the held stock; this source proves attribution only.
    evidence(`swap:${key}:hold`,'swap_hold_attribution_v1',d.cashTopUp.amount);
    return row;
  }
  if(classId==='topup_checkout'||classId==='topup_checkout_commands'||classId==='topup_checkout_results'){
    const swap=parentRequired();if(!swap)return row;
    if(classId==='topup_checkout'&&key==='current'){
      if(d.protocol!=='swap_server_manual_v1'||d.swapId!==p[1]||!id(d.intentId)||!id(d.payerId)||!id(d.payeeId)||![swap.initiatorId,swap.receiverId].includes(d.payerId)||
        ![swap.initiatorId,swap.receiverId].includes(d.payeeId)||d.payerId===d.payeeId||!cents(d.amounts?.totalCents))issue('swap_checkout_protocol_unsupported');
      if(['unknown','creating','confirming'].includes(d.state))issue('swap_checkout_provider_outcome_unknown');
    }
    if(classId==='topup_checkout_results'&&d.protocol!=='swap_topup_command_v1')issue('swap_checkout_receipt_unknown');
    return row;
  }
  if(classId==='topup_refund'||classId==='topup_release'){
    const swap=parentRequired();if(!swap)return row;
    if(classId==='topup_release'){
      if(d.protocol!=='swap_topup_release_v1'||d.swapId!==p[1]||!id(d.releaseLedgerId)||!id(d.payeeId)||!cents(d.amountCents))issue('swap_release_receipt_unknown');
      else {const l=get(`wallets/${d.payeeId}/ledger/${d.releaseLedgerId}`);if(!l||l.type!=='funds_released'||l.swapId!==p[1]||l.amount!==d.amountCents||!sameTime(l.createdAt,d.recordedAt))issue('swap_release_ledger_unknown');}
    }else if(key==='committed'){
      if(d.protocol!=='swap_topup_refund_committed_v1'||d.swapId!==p[1]||!stripe(d.refundId,'re')||!cents(d.amountCents)||!time(d.recordedAt,s))issue('swap_refund_committed_receipt_unknown');
    }else if(d.protocol==='swap_topup_refund_v1'){
      if(!cents(d.amountCents)||!time(d.authorizedAt,s)||!id(d.intentId))issue('swap_refund_native_intent_unknown');
      else {const component=`swap_refund:${p[1]}:${d.intentId}`,settled=d.state==='succeeded'&&get(`swaps/${p[1]}/topup_refund/committed`);
        stock(component,'swap_refund_obligation_v1','L',settled?0:d.amountCents);delta(component,'swap_refund_obligation_v1','L',d.amountCents,d.authorizedAt,`${sourcePath}:reserved`);
        if(settled&&time(settled.recordedAt,s))delta(component,'swap_refund_obligation_v1','L',-d.amountCents,settled.recordedAt,`${sourcePath}:settled`);else if(d.state!=='never_authorized')issue('swap_refund_provider_outcome_unknown');}
    }else if(d.protocol==='swap_topup_refund_preparation_v1'){if(!['never_authorized','authorized'].includes(d.state))issue('swap_refund_preparation_state_unknown');}
    else issue('swap_refund_source_type_unsupported');
    return row;
  }
  if(classId==='label_lifecycle_cases'||classId==='label_lifecycle_commands'||classId==='label_lifecycle_entries'){
    const doc=obj(d.document)?d.document:d,transactionId=doc.transactionId??doc.command?.transactionId;
    if(!id(transactionId)||!get(`transactions/${transactionId}`)){issue('label_lifecycle_native_parent_unknown');return row;}
    if(d.document&&d.contentHash!==supportSourceHash(d.document))issue('label_lifecycle_document_hash_conflict');
    const result=doc.labelPurchaseResult??doc.receipt?.labelPurchaseResult;
    if(result){if(!cents(result.costCents))issue('label_lifecycle_cost_unknown');else evidence(`label:${transactionId}:${doc.leg??doc.command?.leg??'unknown'}`,'carrier_cost_outside_stripe_cash_v1',result.costCents,'K');}
    // The purchase belongs to ShipEngine's funding account. A replacement
    // authorization/void request is neither a Stripe debit nor a new refund.
    return row;
  }
  if(classId==='dispute_decisions'){
    const o=parentRequired();if(!o)return row;
    if(key.startsWith('preview_')||d.outcome==='not_executed')return row;
    if(d.kind!=='admin_financial_decision_v1'||!id(d.refundIntentId)||!get(`transactions/${p[1]}/refund_allocations/${d.refundIntentId}`))issue('financial_decision_obligation_not_bound_to_allocation');
    return row;
  }
  if(classId==='disputes'){
    if(!id(d.transactionId)||!get(`transactions/${d.transactionId}`))issue('bank_or_commercial_case_parent_unknown');
    if(d.stripeDisputeId||d.bankDisputeId||d.provider==='stripe')issue('bank_dispute_partition_unsupported');
    return row;
  }
  if(classId==='automatic_decisions_log'){
    if(d.protocol==='swap_funds_released_v1'&&!get(`swaps/${d.swapId}/topup_release/committed`))issue('automatic_swap_release_receipt_missing');
    return row; // Explanation journals point to the already counted effect.
  }
  if(classId==='eligibility_audit'){
    if(d.protocol==='orphan_capture_refund_command_v1'){
      if(d.state==='not_executed'&&time(d.recordedAt,s))return row;
      const x=get(`@orphan-capture/${d.operationId}`);
      if(!x?.qualified||x.command?.commandId!==key||supportSourceHash(x.command)!==sourceHash)issue('orphan_capture_command_native_join_unknown');
      else {for(const b of x.blockers??[])issue(b);evidence(`orphan:${d.operationId}:command:${key}`,'orphan_capture_command_v1',0,'K',d.recordedAt);}return row;
    }
    if(d.action==='account_forfait_operation'&&d.source==='purchaseShopTier'){
      if(d.taxPricingVersion!==SHOP_TIER_TAX_PRICING_VERSION||!qualifiedShopTierOperation(d,key)||!qualifiedShopTierTaxOperation(d))issue('shop_tier_native_partition_unsupported');
      else if(d.state==='settled'){
        const ledger=stripe(d.paymentIntentId,'pi')?get(`platform_ledger/shop_tier_revenue_${d.paymentIntentId}`):null;
        if(!qualifiedShopTierSettlement(d,key,ledger))issue('shop_tier_native_partition_unsupported');
      }else if(!['rejected','canceled'].includes(d.state))issue('shop_tier_unsettled_capture_observation_required');
    }else if(/^shop_tier_|^forfait/.test(d.protocol??'')||d.type==='shop_tier')issue('shop_tier_native_partition_unsupported');
    return row;
  }
  if(classId==='failed_operations'||classId==='admin_alerts'){
    if(classId==='failed_operations'&&d.orphanRefund?.protocol==='orphan_capture_original_refund_v1'){
      const x=get(`@orphan-capture/${key}`),proof=x?.proof;
      if(!x?.qualified||!proof||supportSourceHash(x.case)!==sourceHash){issue('orphan_capture_native_obligation_unknown');return row;}
      for(const b of x.blockers??[])issue(b);
      if(proof.accountId!==s.platformAccountId||proof.livemode!==s.livemode||proof.currency!=='CAD'){issue('orphan_capture_account_scope_unknown');return row;}
      const component=`orphan:${key}:principal`,at=(seconds:number)=>Timestamp.fromMillis(seconds*1000),captureAt=at(proof.capture.created),refs=[{kind:'pi',id:proof.paymentIntentId},{kind:'ch',id:proof.chargeId},{kind:'txn',id:proof.capture.id}];
      stock(component,'orphan_original_card_obligation_v1','L',proof.refundableCents);
      effect(component,'orphan_original_card_obligation_v1','L',proof.capturedCents,'period_variation',captureAt,`orphan:${key}:capture`,s.platformAccountId,refs);
      let fees=proof.capture.fee;
      effect(`orphan:${key}:fees`,'processor_fee_v1','K',-proof.capture.fee,'period_variation',captureAt,`orphan:${key}:capture`,s.platformAccountId,refs);
      for(const r of proof.refunds){
        if(r.status==='succeeded'&&r.settlement){const rr=[{kind:'pi',id:proof.paymentIntentId},{kind:'ch',id:proof.chargeId},{kind:'re',id:r.refundId},{kind:'txn',id:r.settlement.id}],t=at(r.settlement.created),event=`orphan:${key}:refund:${r.refundId}`;
          effect(component,'orphan_original_card_obligation_v1','L',-r.amountCents,'period_variation',t,event,s.platformAccountId,rr);
          effect(`orphan:${key}:fees`,'processor_fee_v1','K',-r.settlement.fee,'period_variation',t,event,s.platformAccountId,rr);fees+=r.settlement.fee;
        }else if(['failed','canceled'].includes(r.status))issue('orphan_failed_refund_fee_history_requires_reconciliation');
      }
      for(const dispute of proof.disputes){for(const b of dispute.balances){const event=`orphan:${key}:dispute:${b.id}`,t=at(b.created),rr=[{kind:'dp',id:dispute.disputeId},{kind:'txn',id:b.id},{kind:'ch',id:proof.chargeId}];
        effect(component,'orphan_original_card_obligation_v1','L',b.amount,'period_variation',t,event,s.platformAccountId,rr);
        effect(`orphan:${key}:fees`,'processor_fee_v1','K',-b.fee,'period_variation',t,event,s.platformAccountId,rr);fees+=b.fee;}}
      stock(`orphan:${key}:fees`,'processor_fee_v1','K',-fees);return row;
    }
    if(classId==='admin_alerts'&&d.kind==='exceptional_financial_restitution'){
      const x=exceptional();if(x)evidence(`exceptional:${key}:case`,'exceptional_native_case_v1',0,'K',d.preparedAt);return row;
    }
    // Work queues are locators, never additional liabilities. Unknown/orphan
    // FINANCIAL locators remain blockers; unrelated support rows are outside.
    const financial=/refund|payout|withdrawal|payment|stripe|label|swap_topup|accounting|revenue/.test(String(d.type??d.kind??''));
    if(!financial)return row;
    const target=id(d.payload?.transactionId)?`transactions/${d.payload.transactionId}`:id(d.payload?.withdrawalRequestId)?`withdrawal_requests/${d.payload.withdrawalRequestId}`:
      id(d.refId)?`${/swap/.test(String(d.type??d.kind))?'swaps':/payout|withdrawal/.test(String(d.type??d.kind))?'withdrawal_requests':'transactions'}/${d.refId}`:null;
    if(!target||!get(target))issue('financial_locator_orphan_or_unsupported');
    return row;
  }
  issue('native_source_class_unsupported');return row;
}

/** Deterministic direct joins. No filtered query can saturate silently: every
 * journal family is enumerated independently by its collection-group class,
 * including children whose native parent has disappeared. */
function joinPaths(input:GlobalControlNativeSource){
  const {classId:c,sourcePath:path,data:d}=input,p=path.split('/'),key=p.at(-1)!,paths=new Set<string>();
  const add=(root:string,k:any)=>{if(id(k))paths.add(`${root}/${k}`);};
  if(p.length>2)paths.add(p.slice(0,2).join('/'));
  if(c==='stripe_checkout_intents'){add('transactions',key);if(id(d.ownerId)&&id(d.walletLedgerId))paths.add(`wallets/${d.ownerId}/ledger/${d.walletLedgerId}`);}
  if(c==='transactions'&&d.walletPayment?.ledgerId&&id(d.buyerId)&&id(d.walletPayment.ledgerId))paths.add(`wallets/${d.buyerId}/ledger/${d.walletPayment.ledgerId}`);
  if(c==='withdrawal_requests'&&id(d.userId)&&id(d.ledgerEntryId))paths.add(`wallets/${d.userId}/ledger/${d.ledgerEntryId}`);
  if(c==='ledger'){
    add('transactions',d.transactionId);add('swaps',d.swapId);add('withdrawal_requests',d.withdrawalRequestId);add('stripe_checkout_intents',d.transactionId);
    if(id(d.transactionId)&&id(d.refundIntentId))paths.add(`transactions/${d.transactionId}/refund_allocations/${d.refundIntentId}`);
  }
  if(c==='platform_ledger'&&id(d.transactionId)){
    add('transactions',d.transactionId);add('platform_ledger',`purchase_accounting_state_${d.transactionId}`);add('platform_ledger',`service_fee_revenue_${d.transactionId}`);
    if(id(d.refundIntentId))paths.add(`transactions/${d.transactionId}/refund_allocations/${d.refundIntentId}`);
  }
  if(c==='platform_ledger'&&d.type==='shop_tier_revenue')add('eligibility_audit',d.shopTierOperationId);
  if(c==='eligibility_audit'&&d.action==='account_forfait_operation'&&stripe(d.paymentIntentId,'pi'))add('platform_ledger',`shop_tier_revenue_${d.paymentIntentId}`);
  if(c==='refund_allocations'){
    paths.add(`transactions/${p[1]}/refund_history/${key}`);
    if(id(d.reservation?.decisionId))paths.add(`transactions/${p[1]}/dispute_decisions/${d.reservation.decisionId}`);
  }
  if(c==='refund_history')paths.add(`transactions/${p[1]}/refund_allocations/${key}`);
  if(c==='dispute_decisions'&&id(d.refundIntentId))paths.add(`transactions/${p[1]}/refund_allocations/${d.refundIntentId}`);
  if(c==='topup_release'&&id(d.payeeId)&&id(d.releaseLedgerId))paths.add(`wallets/${d.payeeId}/ledger/${d.releaseLedgerId}`);
  if(c==='topup_refund')paths.add(`swaps/${p[1]}/topup_refund/committed`);
  if(c.startsWith('label_lifecycle')){const v=obj(d.document)?d.document:d;add('transactions',v.transactionId??v.command?.transactionId);}
  if(c==='disputes')add('transactions',d.transactionId);
  if(c==='automatic_decisions_log'&&id(d.swapId))paths.add(`swaps/${d.swapId}/topup_release/committed`);
  if(c==='failed_operations'||c==='admin_alerts'){
    add('transactions',d.payload?.transactionId);add('withdrawal_requests',d.payload?.withdrawalRequestId);
    add(/swap/.test(String(d.type??d.kind))?'swaps':/payout|withdrawal/.test(String(d.type??d.kind))?'withdrawal_requests':'transactions',d.refId);
  }
  if(c==='exceptional_evidence'){
    if(d.context?.kind==='wallet_restitution')add('wallets',d.context.ownerId);
    if(d.context?.kind==='withdrawal_misdirection')add('withdrawal_requests',d.context.withdrawalRequestId);
    if(d.context?.kind==='refund_error')add('transactions',d.context.transactionId);
  }
  return [...paths];
}

/** Only actual native helpers can qualify the already committed movements and
 * the winning repair. This is a transient join, never a new persisted proof or
 * a provider observation. All helper reads use the SAME pinned transaction. */
async function qualifyRefundJoin(tx:FirebaseFirestore.Transaction,input:GlobalControlNativeSource,joins:GlobalControlSourceJoins,s:GlobalControlSourceScope){
  const p=input.sourcePath.split('/'),d=input.data,c=input.classId,
    relevant=c==='refund_allocations'||c==='refund_repairs'||c==='platform_ledger'&&d.type==='purchase_refund_counterentry'||c==='ledger'&&/^refund_/.test(d.type),
    transactionId=d.transactionId??(p[0]==='transactions'?p[1]:null),intentId=d.refundIntentId??(c==='refund_allocations'?p.at(-1):null);
  if(!relevant||!id(transactionId)||!id(intentId))return;
  const order=joins[`transactions/${transactionId}`];if(!order)return;
  const pinned=new Proxy(tx,{get(target,key){
    if(key==='get')return async(ref:any)=>{const snapshot=await target.get(ref);
      if(!(snapshot.readTime instanceof Timestamp)||!snapshot.readTime.isEqual(s.readTime))throw new Error('global_control_source_join_read_time_not_observed');return snapshot;};
    const value=(target as any)[key];return typeof value==='function'?value.bind(target):value;
  }});
  const allocationPath=`transactions/${transactionId}/refund_allocations/${intentId}`;
  if(!own(joins,allocationPath))joins[allocationPath]=(await pinned.get(db.doc(allocationPath))).data()??null;
  const allocation=joins[allocationPath];
  // Native helpers expect an already parsed allocation; malformed imported
  // rows must remain unknown rather than throwing before their row is kept.
  if(!allocation||!obj(allocation.terms)||!obj(allocation.reservation))return;
  const intent=order.refund?.intentId===intentId?order.refund:await readAllocationHistoryIntent(pinned,transactionId,order,intentId);
  if(!intent||!allocation)return;
  if(order.refund?.intentId!==intentId&&!own(joins,`transactions/${transactionId}/refund_history/${intentId}`))
    joins[`transactions/${transactionId}/refund_history/${intentId}`]=(await pinned.get(db.doc(`transactions/${transactionId}/refund_history/${intentId}`))).data()??null;
  const localVerified=await allocationLocalMovementsVerified(pinned,transactionId,order,intent,allocation),marker=intent.cardRepairSettlement;
  let repairQualified=false,record:Data|null=null;
  if(marker?.protocol==='purchase_refund_repair_settlement_v1'&&id(marker.repairId)&&time(marker.recordedAt,s)){
    const repairPath=`transactions/${transactionId}/refund_repairs/${marker.repairId}`;
    record=(await pinned.get(db.doc(repairPath))).data()??null;joins[repairPath]=record;
    const proof=record?.proof;
    repairQualified=localVerified&&!!record&&time(record.observedAt,s)&&stripe(record.providerRefundId,'re')&&
      record.chargeId===order.stripeChargeId&&proof?.paymentIntentId===intent.paymentIntentId&&proof?.chargeId===order.stripeChargeId&&
      Array.isArray(proof.refunds)&&proof.refunds.length<=300&&proof.refunds.every((r:any)=>obj(r)&&r.paymentIntentId===intent.paymentIntentId&&r.chargeId===order.stripeChargeId)&&
      Array.isArray(record.targetRefundIds)&&record.targetRefundIds.length<=300&&
      await readRefundRepairCardSettlement(pinned,transactionId,order,intent);
  }
  joins[`@refund-event/${transactionId}/${intentId}`]={localVerified,repairQualified,
    ...(repairQualified?{repairId:marker.repairId,repairRefundId:record!.providerRefundId,repairAt:marker.recordedAt}:{}),
    nativeJoinHash:supportSourceHash({intent,allocation,repair:record})};
}

export async function readGlobalControlSourcePage(tx:FirebaseFirestore.Transaction,s:GlobalControlSourceScope,cursor:GlobalControlSourceCursor):Promise<GlobalControlSourcePage>{
  if(cursor.catalogVersion!==GLOBAL_CONTROL_SOURCE_CATALOG_VERSION||!Number.isInteger(cursor.classIndex)||cursor.classIndex<0||cursor.classIndex>GLOBAL_CONTROL_SOURCE_CATALOG.length||
    cursor.parentCursor!==null||cursor.currentParentId!==null||cursor.rowCursor!==null&&typeof cursor.rowCursor!=='string')throw new Error('global_control_source_cursor_unqualified');
  if(!(s.readTime instanceof Timestamp)||!stripe(s.accountId,'acct')||!stripe(s.platformAccountId,'acct')||s.currency!=='CAD')throw new Error('global_control_source_scope_unqualified');
  const c=GLOBAL_CONTROL_SOURCE_CATALOG[cursor.classIndex],rows:GlobalControlSourceRow[]=[],blockers:string[]=[];
  if(!c)return {protocol:'global_control_source_page_v1',catalogVersion:GLOBAL_CONTROL_SOURCE_CATALOG_VERSION,rows,blockers,next:{...cursor},closed:true};
  let query:FirebaseFirestore.Query=(c.root?db.collection(c.root):db.collectionGroup(c.collectionGroup!)).orderBy('__name__').limit(GLOBAL_CONTROL_SOURCE_PAGE_SIZE+1);
  if(cursor.rowCursor){if(!new RegExp(c.namespace).test(cursor.rowCursor)&&c.root)throw new Error('global_control_source_cursor_namespace_unqualified');query=query.startAfter(db.doc(cursor.rowCursor));}
  const page=await tx.get(query);
  if(!(page.readTime instanceof Timestamp)||!page.readTime.isEqual(s.readTime))throw new Error('global_control_source_read_time_not_observed');
  for(const doc of page.docs.slice(0,GLOBAL_CONTROL_SOURCE_PAGE_SIZE)){
    if(!new RegExp(c.namespace).test(doc.ref.path))continue;
    const input={classId:c.id,sourcePath:doc.ref.path,data:doc.data()},joins:GlobalControlSourceJoins={};
    for(const path of joinPaths(input)){
      const snapshot=await tx.get(db.doc(path));
      if(!(snapshot.readTime instanceof Timestamp)||!snapshot.readTime.isEqual(s.readTime))throw new Error('global_control_source_join_read_time_not_observed');
      joins[path]=snapshot.data()??null;
    }
    await qualifyRefundJoin(tx,input,joins,s);
    const orphanOperation=c.id==='failed_operations'&&input.data.orphanRefund?.protocol==='orphan_capture_original_refund_v1'?doc.id:
      c.id==='eligibility_audit'&&input.data.protocol==='orphan_capture_refund_command_v1'?input.data.operationId:null;
    if(typeof orphanOperation==='string'&&/^capture_[a-f0-9]{64}$/.test(orphanOperation)&&input.data.state!=='not_executed'){
      const pinned=new Proxy(tx,{get(target,key){if(key==='get')return async(ref:any)=>{const snap=await target.get(ref);if(!(snap.readTime instanceof Timestamp)||!snap.readTime.isEqual(s.readTime))throw new Error('global_control_source_join_read_time_not_observed');return snap;};const value=(target as any)[key];return typeof value==='function'?value.bind(target):value;}});
      joins[`@orphan-capture/${orphanOperation}`]=await (await import('./orphanCaptureRefund')).readOrphanCaptureRefundAccounting(pinned,orphanOperation,c.id==='eligibility_audit'?doc.id:undefined);
    }
    const exceptionalCase=c.id==='admin_alerts'&&input.data.kind==='exceptional_financial_restitution'?doc.id:
      c.id==='exceptional_commands'?input.sourcePath.split('/')[1]:['ledger','platform_ledger'].includes(c.id)&&input.data.type?.startsWith('exceptional_')?input.data.caseId:null;
    if(typeof exceptionalCase==='string'&&/^exception_[a-f0-9]{64}$/.test(exceptionalCase)){
      const pinned=new Proxy(tx,{get(target,key){if(key==='get')return async(ref:any)=>{const snap=await target.get(ref);
        if(!(snap.readTime instanceof Timestamp)||!snap.readTime.isEqual(s.readTime))throw new Error('global_control_source_join_read_time_not_observed');return snap;};
        const value=(target as any)[key];return typeof value==='function'?value.bind(target):value;}});
      joins[`@exceptional-event/${exceptionalCase}`]=await (await import('./exceptionalRestitution')).readExceptionalNativeAccounting(pinned,exceptionalCase);
    }
    if(c.id==='ledger'&&['funds_released','debt_repayment'].includes(input.data.type)&&id(input.data.transactionId)&&time(input.data.createdAt,s)){
      const siblings=await tx.get(db.collection('wallets').doc(input.sourcePath.split('/')[1]).collection('ledger')
        .where('transactionId','==',input.data.transactionId).where('createdAt','==',input.data.createdAt).limit(4));
      if(!(siblings.readTime instanceof Timestamp)||!siblings.readTime.isEqual(s.readTime))throw new Error('global_control_source_join_read_time_not_observed');
      joins[`@ledger-event/${input.sourcePath}`]={rows:siblings.docs.slice(0,3).map(row=>({id:row.id,data:row.data()})),saturated:siblings.size>3};
    }
    const row=classifyGlobalControlSource(input,s,joins);rows.push(row);
    for(const code of row.blockers)if(!blockers.includes(code))blockers.push(code);
  }
  const more=page.size>GLOBAL_CONTROL_SOURCE_PAGE_SIZE,next={...cursor,classIndex:more?cursor.classIndex:cursor.classIndex+1,
    rowCursor:more?page.docs[GLOBAL_CONTROL_SOURCE_PAGE_SIZE-1].ref.path:null};
  return {protocol:'global_control_source_page_v1',catalogVersion:GLOBAL_CONTROL_SOURCE_CATALOG_VERSION,rows,blockers,next,closed:next.classIndex===GLOBAL_CONTROL_SOURCE_CATALOG.length};
}
