/** Documentary GETs of the exact platform graph. No refund, transfer or
 * dispute mutation is implemented in this module. */
import {Timestamp} from 'firebase-admin/firestore';
import {getStripe} from '../config/stripe';
import {supportSourceHash} from './supportRequest';
import {bankId,bankStripeId,BANK_STATUSES} from './bankDisputeCaseSource';
export const BANK_RECONCILIATION_LIMITS={refunds:10,disputes:10,balanceTransactions:40,parallel:4,readBudgetMs:35000} as const;
const integer=(v:any):v is number=>Number.isSafeInteger(v);
const currency=(v:any):v is string=>typeof v==='string'&&/^[a-z]{3}$/.test(v);
const text=(v:any)=>typeof v==='string'&&v.length<=2000?v:null;
const time=(v:any)=>integer(v)&&v>0&&v<=253402300799?v:null;
const sid=(v:any,p:string)=>bankId(bankStripeId(v),p)?bankStripeId(v):null;
export type BankReconciliationIdentity={transactionId:string;disputeId:string;paymentIntentId:string;chargeId:string;capturedCardCents:number};
function piView(v:any){return {id:sid(v,'pi'),object:v?.object??null,chargeId:sid(v?.latest_charge,'ch'),currency:currency(v?.currency)?v.currency:null,
  livemode:typeof v?.livemode==='boolean'?v.livemode:null,status:text(v?.status),capturedCents:integer(v?.amount_received)?v.amount_received:null,
  directPlatformCharge:v?.transfer_data==null&&(v?.application_fee_amount==null||v.application_fee_amount===0)};}
function chargeView(v:any){return {id:sid(v,'ch'),object:v?.object??null,paymentIntentId:sid(v?.payment_intent,'pi'),currency:currency(v?.currency)?v.currency:null,
  livemode:typeof v?.livemode==='boolean'?v.livemode:null,capturedCents:integer(v?.amount_captured)?v.amount_captured:null,refundedCents:integer(v?.amount_refunded)?v.amount_refunded:null,
  paid:typeof v?.paid==='boolean'?v.paid:null,disputed:typeof v?.disputed==='boolean'?v.disputed:null,balanceTransactionId:sid(v?.balance_transaction,'txn')};}
function refundView(v:any){return {id:sid(v,'re'),object:v?.object??null,paymentIntentId:sid(v?.payment_intent,'pi'),chargeId:sid(v?.charge,'ch'),
  amountCents:integer(v?.amount)?v.amount:null,currency:currency(v?.currency)?v.currency:null,status:text(v?.status),createdSeconds:time(v?.created),
  balanceTransactionId:sid(v?.balance_transaction,'txn'),failureBalanceTransactionId:sid(v?.failure_balance_transaction,'txn'),failureReason:text(v?.failure_reason)};}
function disputeView(v:any){return {id:sid(v,'du'),object:v?.object??null,paymentIntentId:sid(v?.payment_intent,'pi'),chargeId:sid(v?.charge,'ch'),
  amountCents:integer(v?.amount)?v.amount:null,currency:currency(v?.currency)?v.currency:null,livemode:typeof v?.livemode==='boolean'?v.livemode:null,status:text(v?.status),
  createdSeconds:time(v?.created),balanceTransactionIds:Array.isArray(v?.balance_transactions)&&v.balance_transactions.length<=40?v.balance_transactions.map((b:any)=>sid(b,'txn')):null};}
type Edge={objectId:string;field:'charge.balance_transaction'|'refund.balance_transaction'|'refund.failure_balance_transaction'|'dispute.balance_transactions';balanceTransactionId:string};
export function bankBalanceMovement(v:any,edges:Edge[],sources:Set<string>){
  const feeDetails=Array.isArray(v?.fee_details)&&v.fee_details.length<=50?v.fee_details.map((f:any)=>({amountCents:integer(f?.amount)?f.amount:null,
    currency:currency(f?.currency)?f.currency:null,type:text(f?.type),applicationId:f?.application===null?null:text(f?.application),description:f?.description===null?null:text(f?.description)})):null;
  const type=text(v?.type),category=text(v?.reporting_category),sourceId=typeof bankStripeId(v?.source)==='string'?bankStripeId(v.source):null;
  const balanceType=['payments','issuing','refund_and_dispute_prefunding','risk_reserved'].includes(v?.balance_type)?v.balance_type:null;
  const status=['pending','available'].includes(v?.status)?v.status:null;
  const family=type==='charge'||type==='payment'?'charge_principal':['refund','payment_refund'].includes(type??'')?'refund_principal':
    ['refund_failure','payment_failure_refund'].includes(type??'')?'refund_reversal':category==='dispute'?'dispute_principal':category==='dispute_reversal'?'dispute_reversal':
    ['stripe_fee','stripe_fx_fee','tax_fee','fee_credit_funding'].includes(type??'')?'fee_movement':
    ['reserve_hold','reserve_release','reserve_transaction','reserved_funds','payment_network_reserve_hold','payment_network_reserve_release','payout_minimum_balance_hold','payout_minimum_balance_release'].includes(type??'')?'reserve_movement':'unknown';
  const arithmetic=integer(v?.amount)&&integer(v?.fee)&&integer(v?.net)&&integer(v.amount-v.fee)&&v.net===v.amount-v.fee;
  // A native reference names BOTH its txn and its associated Stripe object.
  // Charge -> ch, Refund (including failure reversal) -> re, Dispute -> du.
  // No other object of the same graph can substitute for that exact source.
  // Unqualified provider variants remain unknown rather than an alias guess.
  const provenance=sourceId!==null&&edges.length>0&&edges.every(e=>{
    const prefix=e.field==='charge.balance_transaction'?'ch':e.field==='refund.balance_transaction'||e.field==='refund.failure_balance_transaction'?'re':
      e.field==='dispute.balance_transactions'?'du':null;
    return prefix!==null&&bankId(e.objectId,prefix)&&sources.has(e.objectId)&&bankId(e.balanceTransactionId,'txn')&&
      v?.id===e.balanceTransactionId&&sourceId===e.objectId;
  });
  const qualified=v?.object==='balance_transaction'&&bankId(v.id,'txn')&&arithmetic&&currency(v.currency)&&balanceType!==null&&status!==null&&
    provenance&&category!==null&&family!=='unknown'&&time(v.available_on)!==null&&time(v.created)!==null&&feeDetails!==null&&
    feeDetails.every((f:any)=>f.amountCents!==null&&f.currency===v.currency&&f.type!==null)&&
    integer(feeDetails.reduce((n:number,f:any)=>n+f.amountCents,0))&&feeDetails.reduce((n:number,f:any)=>n+f.amountCents,0)===v.fee;
  return {id:sid(v,'txn'),qualification:qualified?'native_referenced_movement':'unknown',amountCents:integer(v?.amount)?v.amount:null,
    feeCents:integer(v?.fee)?v.fee:null,netCents:integer(v?.net)?v.net:null,feeDetails,currency:currency(v?.currency)?v.currency:null,
    balanceType,status,availableOnSeconds:time(v?.available_on),createdSeconds:time(v?.created),sourceId,type,reportingCategory:category,
    family,netArithmeticQualified:arithmetic,edges,providerRestitutionVerified:false,financialEffectAuthorized:false};
}
/** One bounded page per object kind. A remaining page is explicitly unknown,
 * never a complete set. Every inspected object and referenced txn is GET again. */
export async function observeBankFinancialGraph(identity:BankReconciliationIdentity){
  const stripe=getStripe(),startedAt=Timestamp.now(),deadline=Date.now()+BANK_RECONCILIATION_LIMITS.readBudgetMs,reasons=new Set<string>();
  const options={timeout:7000,maxNetworkRetries:0};
  const read=async(fn:()=>Promise<any>)=>{if(Date.now()+7500>deadline){reasons.add('provider_read_budget');return null;}try{return await fn();}catch{reasons.add('provider_read_unavailable');return null;}};
  const parallel=async<T>(items:T[],fn:(v:T)=>Promise<any>)=>{const out:any[]=[];for(let i=0;i<items.length;i+=4)out.push(...await Promise.all(items.slice(i,i+4).map(fn)));return out;};
  let accountId:string|null=null,livemode:boolean|null=null,pi:any=null,charge:any=null,refunds:any[]=[],disputes:any[]=[],movements:any[]=[],manifestStable=false;
  const coverage:any={refunds:{inspected:0,limit:10,complete:false},disputes:{inspected:0,limit:10,complete:false},balanceTransactions:{referenced:0,inspected:0,limit:40,complete:false},
    manifestRechecked:false,manifestStable:false,exhaustiveExternalHistoryVerified:false};
  const key=process.env.STRIPE_SECRET_KEY?.trim(),expectedMode=/^(sk|rk)_live_/.test(key??'')?true:/^(sk|rk)_test_/.test(key??'')?false:null;
  if(!stripe||expectedMode===null)reasons.add('platform_provider_unavailable');
  else{
    const first=await parallel(['account','pi','charge'],v=>read(()=>v==='account'?stripe.accounts.retrieveCurrent({},options):v==='pi'?stripe.paymentIntents.retrieve(identity.paymentIntentId,{},options):stripe.charges.retrieve(identity.chargeId,{},options)));
    if(first[0]?.object==='account'&&bankId(first[0].id,'acct'))accountId=first[0].id;else reasons.add('platform_account_unknown');
    pi=piView(first[1]);charge=chargeView(first[2]);livemode=pi.livemode;
    const binding=accountId!==null&&pi.id===identity.paymentIntentId&&pi.object==='payment_intent'&&pi.chargeId===identity.chargeId&&pi.currency==='cad'&&pi.livemode===expectedMode&&
      pi.status==='succeeded'&&pi.directPlatformCharge&&pi.capturedCents===identity.capturedCardCents&&charge.id===identity.chargeId&&charge.object==='charge'&&
      charge.paymentIntentId===identity.paymentIntentId&&charge.currency==='cad'&&charge.livemode===pi.livemode&&charge.paid===true&&charge.capturedCents===identity.capturedCardCents;
    if(!binding)reasons.add('platform_payment_binding_unknown');
    if(binding){
      const list=async()=>parallel(['refunds','disputes'],kind=>read(()=>kind==='refunds'?stripe.refunds.list({payment_intent:identity.paymentIntentId,limit:11},options):stripe.disputes.list({payment_intent:identity.paymentIntentId,limit:11},options)));
      const pages=await list();
      const ids=(page:any,prefix:string)=>page?.object==='list'&&Array.isArray(page.data)&&page.data.length<=11&&typeof page.has_more==='boolean'&&
        page.data.every((d:any)=>bankId(d.id,prefix))&&new Set(page.data.map((d:any)=>d.id)).size===page.data.length?page.data.slice(0,10).map((d:any)=>d.id) as string[]:null;
      const refundIds=ids(pages[0],'re'),disputeIds=ids(pages[1],'du');
      coverage.refunds={inspected:refundIds?.length??0,limit:10,complete:refundIds!==null&&pages[0].has_more===false&&pages[0].data.length<=10};
      coverage.disputes={inspected:disputeIds?.length??0,limit:10,complete:disputeIds!==null&&pages[1].has_more===false&&pages[1].data.length<=10};
      if(!coverage.refunds.complete||!coverage.disputes.complete)reasons.add('provider_object_pages_incomplete');
      const rawRefunds=await parallel(refundIds??[],id=>read(()=>stripe.refunds.retrieve(id,{},options)));
      for(const r of rawRefunds)if(r&&(r.balance_transaction!==null&&!sid(r.balance_transaction,'txn')||
        r.failure_balance_transaction!=null&&!sid(r.failure_balance_transaction,'txn')))reasons.add('refund_movement_reference_malformed');
      refunds=rawRefunds.map((v,i)=>({...refundView(v),requestedId:refundIds![i]}));
      const selectedDisputes=[...new Set([...(disputeIds??[]),identity.disputeId])];
      disputes=(await parallel(selectedDisputes,id=>read(()=>stripe.disputes.retrieve(id,{},options)))).map((v,i)=>({...disputeView(v),requestedId:selectedDisputes[i]}));
      const objectSources=new Set<string>([identity.chargeId]),edges:Edge[]=[];
      const edge=(objectId:string,field:Edge['field'],id:any)=>{if(bankId(id,'txn'))edges.push({objectId,field,balanceTransactionId:id});else reasons.add('balance_transaction_reference_unknown');};
      edge(identity.chargeId,'charge.balance_transaction',charge.balanceTransactionId);
      for(const r of refunds){const valid=r.id===r.requestedId&&r.object==='refund'&&r.paymentIntentId===identity.paymentIntentId&&r.chargeId===identity.chargeId&&r.currency==='cad'&&integer(r.amountCents)&&r.amountCents>0&&
        ['pending','requires_action','succeeded','failed','canceled'].includes(r.status);if(valid)objectSources.add(r.id!);else reasons.add('refund_identity_unknown');
        r.associationQualified=valid;if(r.balanceTransactionId!==null)edge(r.requestedId,'refund.balance_transaction',r.balanceTransactionId);else if(r.status==='succeeded')reasons.add('refund_movement_missing');
        if(r.failureBalanceTransactionId!==null)edge(r.requestedId,'refund.failure_balance_transaction',r.failureBalanceTransactionId);else if(['failed','canceled'].includes(r.status))reasons.add('refund_failure_movement_unknown');}
      for(const d of disputes){const valid=d.id===d.requestedId&&d.object==='dispute'&&d.paymentIntentId===identity.paymentIntentId&&d.chargeId===identity.chargeId&&d.currency==='cad'&&d.livemode===livemode&&integer(d.amountCents)&&d.amountCents>0&&BANK_STATUSES.includes(d.status);
        d.associationQualified=valid;if(valid)objectSources.add(d.id!);else reasons.add('dispute_identity_unknown');
        if(d.balanceTransactionIds===null)reasons.add('dispute_movement_references_unknown');else for(const id of d.balanceTransactionIds)edge(d.requestedId,'dispute.balance_transactions',id);}
      const btIds=[...new Set(edges.map(e=>e.balanceTransactionId))].sort();coverage.balanceTransactions.referenced=btIds.length;
      const chosen=btIds.slice(0,40),rows=await parallel(chosen,id=>read(()=>stripe.balanceTransactions.retrieve(id,{},options)));
      movements=rows.map((v,i)=>({...bankBalanceMovement(v,edges.filter(e=>e.balanceTransactionId===chosen[i]),objectSources),
        ...(v?.id!==chosen[i]?{qualification:'unknown'}:{}),requestedId:chosen[i],platformAccountId:accountId,livemode}));
      if(movements.some(m=>m.id!==m.requestedId||m.qualification==='unknown'))reasons.add('balance_movement_unknown');
      coverage.balanceTransactions={referenced:btIds.length,inspected:chosen.length,limit:40,complete:btIds.length<=40&&rows.every((v,i)=>v?.id===chosen[i])&&
        movements.every(m=>m.qualification==='native_referenced_movement')};
      if(!coverage.balanceTransactions.complete)reasons.add('balance_movement_coverage_unknown');
      const again=await parallel(['pi','charge'],v=>read(()=>v==='pi'?stripe.paymentIntents.retrieve(identity.paymentIntentId,{},options):stripe.charges.retrieve(identity.chargeId,{},options)));
      const finalPages=await list(),finalMovements=await parallel(chosen,id=>read(()=>stripe.balanceTransactions.retrieve(id,{},options)));
      const initial={pi,charge,refunds:refunds.map(({requestedId,associationQualified,...r})=>r),disputes:disputes.map(({requestedId,associationQualified,...d})=>d)};
      const final={pi:piView(again[0]),charge:chargeView(again[1]),refunds:finalPages[0]?.data?.map(refundView)??null,disputes:finalPages[1]?.data?.map(disputeView)??null};
      coverage.manifestRechecked=again.every(Boolean)&&finalPages.every(Boolean)&&finalMovements.every(Boolean);
      manifestStable=coverage.manifestRechecked&&coverage.refunds.complete&&coverage.disputes.complete&&finalPages.every(p=>p.has_more===false)&&
        supportSourceHash(initial)===supportSourceHash(final)&&rows.every((v,i)=>{
          const exactEdges=edges.filter(e=>e.balanceTransactionId===chosen[i]);
          return supportSourceHash(bankBalanceMovement(v,exactEdges,objectSources))===supportSourceHash(bankBalanceMovement(finalMovements[i],exactEdges,objectSources));
        });
      coverage.manifestStable=manifestStable;if(!manifestStable)reasons.add('provider_manifest_changed_or_unknown');
    }
  }
  const groups:any[]=[];
  for(const m of movements){if(m.qualification!=='native_referenced_movement')continue;const key=[m.platformAccountId,m.livemode,m.currency,m.balanceType,m.status,m.family].join(':');
    let g=groups.find(v=>v.key===key);if(!g){g={key,platformAccountId:m.platformAccountId,livemode:m.livemode,currency:m.currency,balanceType:m.balanceType,status:m.status,family:m.family,
      balanceTransactionIds:[],amountCents:0,feeCents:0,netCents:0};groups.push(g);}g.balanceTransactionIds.push(m.id);g.amountCents+=m.amountCents;g.feeCents+=m.feeCents;g.netCents+=m.netCents;
    if(![g.amountCents,g.feeCents,g.netCents].every(integer))reasons.add('observed_group_amount_overflow');}
  for(const g of groups)for(const field of ['amountCents','feeCents','netCents'])if(!integer(g[field]))g[field]=null;
  return {protocol:'bank_financial_graph_v1',identity,platformAccountId:accountId,livemode,pi,charge,refunds,disputes,movements,groups,coverage,
    qualification:reasons.size===0?'complete_referenced_manifest':'unknown',reasons:[...reasons],startedAt:startedAt.toDate().toISOString(),observedAt:Timestamp.now().toDate().toISOString(),
    totalsAreObservedBalanceMovementsOnly:true,netFinancialResolutionQualified:false,financialEffectAuthorized:false};
}
export type BankFinancialGraph=Awaited<ReturnType<typeof observeBankFinancialGraph>>;
