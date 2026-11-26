/** GET-only, account-confined observations for an explicitly scoped report.
 * A balance movement is not a wallet movement or a permission to repair money. */
import {Timestamp} from 'firebase-admin/firestore';
import {HttpsError} from 'firebase-functions/v2/https';
import {getStripe} from '../config/stripe';
import {supportHash,supportSourceHash} from './supportRequest';

export type GlobalFinancialScope={accountKind:'platform'|'connected';accountId:string;platformAccountId:string;livemode:boolean;currency:'CAD';
  period:{fromSeconds:number;toSeconds:number};connectedReference:null|{kind:'withdrawal'|'current_account';id:string};
  epoch:null|{id:string;proofHash:string};boundaries:null|{opening:GlobalFinancialBoundary[];closing:GlobalFinancialBoundary[]};
  statementReference:null|{reportRunId:string;reportType:'balance.summary.1'|'balance.summary.2'};
  nativeCapture?:{protocol:'firestore_read_time_v1';readTime:{seconds:number;nanoseconds:number}};
  coverageMode?:'complete_known_sources_v1';controlBalanceMode?:'global_control_balance_v1'};
export type GlobalFinancialBoundary={balanceType:string;availableCents:number;pendingCents:number;evidenceReference:{reference:string;contentHash:string}};
export const GLOBAL_FINANCIAL_PROVIDER_LIMITS={pageSize:5,readBudgetMs:26000,timeoutMs:5000,parallel:3} as const;
type Data=Record<string,any>;
export const globalStripeId=(v:unknown,prefix:string):v is string=>typeof v==='string'&&new RegExp(`^${prefix}_[A-Za-z0-9_]{1,190}$`).test(v);
const sid=(v:any)=>typeof v==='string'?v:typeof v?.id==='string'&&!Array.isArray(v)?v.id:null;
const integer=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v);
const seconds=(v:unknown):v is number=>integer(v)&&v>=0&&v<=253402300799;
const short=(v:unknown)=>typeof v==='string'&&v.length<=200?v:null;
const sourceKind=(id:string|null)=>id?.startsWith('ch_')||id?.startsWith('py_')?'charge':id?.startsWith('re_')?'refund':
  id?.startsWith('du_')?'dispute':id?.startsWith('trr_')?'transfer_reversal':id?.startsWith('tr_')?'transfer':id?.startsWith('po_')?'payout':null;
const balanceTypes=['payments','issuing','refund_and_dispute_prefunding','risk_reserved'];
const exactSource=(v:any,id:string,object:string)=>typeof v==='string'?v===id:!!v&&typeof v==='object'&&!Array.isArray(v)&&v.id===id&&v.object===object;

/** Only allowlisted facts leave this module: no bank number, destination ID,
 * customer, metadata corpus, URL, secret or raw SDK response is persisted. */
function movement(v:any,scope:GlobalFinancialScope){
  const sourceId=sid(v?.source),kind=sourceKind(sourceId),fees=Array.isArray(v?.fee_details)&&v.fee_details.length<=30?v.fee_details:null;
  const reasons:string[]=[];
  if(v?.object!=='balance_transaction'||!globalStripeId(v.id,'txn')||v.currency!=='cad'||!integer(v.amount)||!integer(v.fee)||!integer(v.net)||
    !integer(v.amount-v.fee)||v.net!==v.amount-v.fee||!seconds(v.created)||v.created<scope.period.fromSeconds||v.created>=scope.period.toSeconds||
    !seconds(v.available_on)||!balanceTypes.includes(v.balance_type)||!['pending','available'].includes(v.status)||!short(v.type)||!short(v.reporting_category)||
    !fees||!fees.every((f:any)=>integer(f?.amount)&&f.currency==='cad'&&short(f.type))||!integer(fees.reduce((n:number,f:any)=>n+f.amount,0))||fees.reduce((n:number,f:any)=>n+f.amount,0)!==v.fee)
    reasons.push('provider_movement_shape_or_scope_unknown');
  if(sourceId===null||kind===null||!exactSource(v?.source,sourceId,kind))reasons.push('provider_source_identity_unknown');
  return {id:globalStripeId(v?.id,'txn')?v.id:null,sourceId,sourceObject:kind,type:short(v?.type),reportingCategory:short(v?.reporting_category),
    amountCents:integer(v?.amount)?v.amount:null,feeCents:integer(v?.fee)?v.fee:null,netCents:integer(v?.net)?v.net:null,
    currency:v?.currency==='cad'?'CAD':null,balanceType:balanceTypes.includes(v?.balance_type)?v.balance_type:null,
    status:['pending','available'].includes(v?.status)?v.status:null,createdSeconds:seconds(v?.created)?v.created:null,
    arithmeticQualified:!reasons.includes('provider_movement_shape_or_scope_unknown'),availableOnSeconds:seconds(v?.available_on)?v.available_on:null,feeDetails:fees?.map((f:any)=>({amountCents:integer(f?.amount)?f.amount:null,
      type:short(f?.type),currency:f?.currency==='cad'?'CAD':null}))??null,reasons};
}

/** Each invocation reads at most one small page. Any transport failure retains
 * the caller's cursor. Unsupported but observed sources stay explicit unknowns. */
export async function observeGlobalFinancialProviderPage(scope:GlobalFinancialScope,cursor:string|null,guard?:()=>Promise<unknown>){
  const stripe=getStripe(),startedAt=Timestamp.now(),deadline=Date.now()+GLOBAL_FINANCIAL_PROVIDER_LIMITS.readBudgetMs;
  const rootOptions={timeout:GLOBAL_FINANCIAL_PROVIDER_LIMITS.timeoutMs,maxNetworkRetries:0};
  const options={...rootOptions,...scope.accountKind==='connected'?{stripeAccount:scope.accountId}:{}};
  let failed=false;
  const read=async(fn:()=>Promise<any>)=>{if(Date.now()+GLOBAL_FINANCIAL_PROVIDER_LIMITS.timeoutMs+250>deadline){failed=true;return null;}
    try{await guard?.();const result=await fn();await guard?.();return result;}catch(error){
      if(error instanceof HttpsError&&['unauthenticated','permission-denied'].includes(error.code))throw error;
      failed=true;return null;}};
  const unavailable=(reason:string)=>({protocol:'global_financial_provider_page_v1' as const,complete:false,reason,
    accountQualified:false,scopeHash:supportHash(scope),requestedCursor:cursor,nextCursor:cursor,hasMore:true,rows:[] as Data[],
    startedAt,observedAt:Timestamp.now(),providerRequestIds:[] as string[]});
  const key=process.env.STRIPE_SECRET_KEY?.trim(),mode=/^(sk|rk)_live_/.test(key??'')?true:/^(sk|rk)_test_/.test(key??'')?false:null;
  if(!stripe||mode===null||mode!==scope.livemode)return unavailable('provider_mode_or_configuration_unknown');
  const platform=await read(()=>stripe.accounts.retrieveCurrent({},rootOptions));
  if(platform?.object!=='account'||platform.id!==scope.platformAccountId)return unavailable('platform_account_identity_unknown');
  if(scope.accountKind==='platform'&&scope.accountId!==platform.id)return unavailable('account_scope_conflict');
  if(scope.accountKind==='connected'){
    const connected=await read(()=>stripe.accounts.retrieve(scope.accountId,{},rootOptions));
    if(connected?.object!=='account'||connected.id!==scope.accountId||scope.accountId===platform.id)return unavailable('connected_account_identity_unknown');
  }
  const page=await read(()=>stripe.balanceTransactions.list({currency:'cad',created:{gte:scope.period.fromSeconds,lt:scope.period.toSeconds},
    limit:GLOBAL_FINANCIAL_PROVIDER_LIMITS.pageSize,...cursor?{starting_after:cursor}:{}},options));
  if(!page||page.object!=='list'||!Array.isArray(page.data)||page.data.length>GLOBAL_FINANCIAL_PROVIDER_LIMITS.pageSize||typeof page.has_more!=='boolean'||
    page.has_more&&page.data.length===0||!page.data.every((v:any)=>globalStripeId(v?.id,'txn'))||new Set(page.data.map((v:any)=>v.id)).size!==page.data.length||
    page.data.some((v:any)=>v.id===cursor))return unavailable('provider_page_unavailable_or_malformed');
  const rows:Data[]=[],requestIds:string[]=[];
  const inspect=async(listed:any)=>{
    const raw=await read(()=>stripe.balanceTransactions.retrieve(listed.id,{expand:['source']},options));
    if(!raw||raw.id!==listed.id){failed=true;return null;}
    const m=movement(raw,scope),movementSourceHash=supportHash(m),links:{kind:string;id:string}[]=[],facts:Data={};
    const link=(kind:string,id:any)=>{if(globalStripeId(id,kind))links.push({kind,id});};
    let object:any=null,edge=false;
    if(m.sourceObject==='charge'&&m.sourceId){
      object=await read(()=>stripe.charges.retrieve(m.sourceId!,{},options));
      if(object?.object==='charge'&&object.id===m.sourceId&&object.currency==='cad'&&object.livemode===scope.livemode&&
        sid(object.balance_transaction)===raw.id&&integer(object.amount_captured)&&object.amount_captured>0&&raw.amount===object.amount_captured){
        link('ch',object.id);facts.chargeId=object.id;facts.capturedCents=object.amount_captured;
        if(scope.accountKind==='connected'&&globalStripeId(sid(object.source_transfer),'tr')){
          link('tr',sid(object.source_transfer));facts.transferId=sid(object.source_transfer);edge=true;
        }else if(scope.accountKind==='platform'&&globalStripeId(sid(object.payment_intent),'pi')){
          const pi=await read(()=>stripe.paymentIntents.retrieve(sid(object.payment_intent)!,{},options));
          edge=pi?.object==='payment_intent'&&pi.id===sid(object.payment_intent)&&pi.livemode===scope.livemode&&pi.currency==='cad'&&
            pi.status==='succeeded'&&sid(pi.latest_charge)===object.id&&pi.amount_received===object.amount_captured&&
            pi.transfer_data==null&&pi.on_behalf_of==null&&(pi.application_fee_amount==null||pi.application_fee_amount===0);
          if(edge){link('pi',pi.id);facts.paymentIntentId=pi.id;}
        }
      }
    }else if(m.sourceObject==='refund'&&m.sourceId){
      object=await read(()=>stripe.refunds.retrieve(m.sourceId!,{},options));
      const original=sid(object?.balance_transaction)===raw.id,failure=sid(object?.failure_balance_transaction)===raw.id;
      edge=object?.object==='refund'&&object.id===m.sourceId&&object.currency==='cad'&&integer(object.amount)&&object.amount>0&&
        (original&&raw.amount===-object.amount&&['refund','payment_refund'].includes(raw.type)||
          failure&&raw.amount===object.amount&&['refund_failure','payment_failure_refund'].includes(raw.type))&&
        ['pending','requires_action','succeeded','failed','canceled'].includes(object.status);
      if(edge){link('re',object.id);link('pi',sid(object.payment_intent));link('ch',sid(object.charge));facts.refundId=object.id;
        facts.paymentIntentId=sid(object.payment_intent);facts.chargeId=sid(object.charge);facts.refundStatus=object.status;facts.refundCents=object.amount;facts.refundFailureMovement=failure;
        if(scope.accountKind==='connected'){link('trr',sid(object.source_transfer_reversal));facts.reversalId=sid(object.source_transfer_reversal);}}
    }else if(m.sourceObject==='transfer'&&m.sourceId&&scope.accountKind==='platform'){
      object=await read(()=>stripe.transfers.retrieve(m.sourceId!,{},options));
      edge=object?.object==='transfer'&&object.id===m.sourceId&&object.currency==='cad'&&object.livemode===scope.livemode&&
        sid(object.balance_transaction)===raw.id&&integer(object.amount)&&object.amount>0&&raw.amount===-object.amount&&raw.type==='transfer'&&globalStripeId(sid(object.destination),'acct');
      if(edge){link('tr',object.id);facts.transferId=object.id;facts.amountCents=object.amount;facts.destinationAccountId=sid(object.destination);}
    }else if(m.sourceObject==='transfer_reversal'&&m.sourceId&&scope.accountKind==='platform'){
      const transferId=sid(typeof raw.source==='object'?raw.source?.transfer:null);
      if(globalStripeId(transferId,'tr'))object=await read(()=>stripe.transfers.retrieveReversal(transferId,m.sourceId!,{},options));
      edge=object?.object==='transfer_reversal'&&object.id===m.sourceId&&object.currency==='cad'&&sid(object.transfer)===transferId&&
        sid(object.balance_transaction)===raw.id&&integer(object.amount)&&object.amount>0&&raw.amount===object.amount&&raw.type==='transfer_refund';
      if(edge){link('trr',object.id);link('tr',transferId);facts.transferId=transferId;facts.reversalId=object.id;facts.amountCents=object.amount;}
    }else if(m.sourceObject==='payout'&&m.sourceId){
      object=await read(()=>stripe.payouts.retrieve(m.sourceId!,{},options));
      const original=sid(object?.balance_transaction)===raw.id,failure=sid(object?.failure_balance_transaction)===raw.id;
      edge=object?.object==='payout'&&object.id===m.sourceId&&object.currency==='cad'&&object.livemode===scope.livemode&&integer(object.amount)&&object.amount>0&&
        (original&&raw.amount===-object.amount&&raw.type==='payout'||failure&&raw.amount===object.amount&&['payout_failure','payout_cancel'].includes(raw.type));
      if(edge){link('po',object.id);facts.payoutId=object.id;facts.amountCents=object.amount;facts.payoutStatus=object.status;facts.payoutFailureMovement=failure;
        facts.destinationHash=supportHash([scope.accountId,sid(object.destination)]);}
    }else if(m.sourceObject==='dispute'&&m.sourceId&&scope.accountKind==='platform'){
      object=await read(()=>stripe.disputes.retrieve(m.sourceId!,{},options));
      edge=object?.object==='dispute'&&object.id===m.sourceId&&object.currency==='cad'&&object.livemode===scope.livemode&&integer(object.amount)&&object.amount>0&&
        Array.isArray(object.balance_transactions)&&object.balance_transactions.some((b:any)=>sid(b)===raw.id)&&
        (raw.reporting_category==='dispute'&&raw.amount===-object.amount||raw.reporting_category==='dispute_reversal'&&raw.amount===object.amount);
      if(edge){link('du',object.id);link('pi',sid(object.payment_intent));link('ch',sid(object.charge));facts.disputeId=object.id;
        facts.paymentIntentId=sid(object.payment_intent);facts.disputeStatus=short(object.status);facts.amountCents=object.amount;}
    }
    if(!edge)m.reasons.push('exact_provider_object_edge_unknown');
    const requestId=short(raw.lastResponse?.requestId);if(requestId)requestIds.push(requestId);
    return {...m,movementSourceHash,links,facts,providerEdgeQualified:edge,qualification:m.reasons.length?'unknown':'account_scoped_provider_movement',
      proofHash:supportSourceHash({movement:m,links,facts,accountId:scope.accountId,platformAccountId:scope.platformAccountId,livemode:scope.livemode})};
  };
  for(let i=0;i<page.data.length;i+=GLOBAL_FINANCIAL_PROVIDER_LIMITS.parallel){
    const batch=await Promise.all(page.data.slice(i,i+GLOBAL_FINANCIAL_PROVIDER_LIMITS.parallel).map(inspect));
    for(const row of batch)if(row)rows.push(row);
  }
  // Listing is not exact-object proof. Recheck the movement identity/amounts
  // without making a later status transition look like an immutable balance.
  for(let i=0;i<rows.length;i+=GLOBAL_FINANCIAL_PROVIDER_LIMITS.parallel){
    const observed=await Promise.all(rows.slice(i,i+GLOBAL_FINANCIAL_PROVIDER_LIMITS.parallel).map(async row=>{
      const again=await read(()=>stripe.balanceTransactions.retrieve(row.id,{},options));
      if(!again||supportHash(movement(again,scope))!==row.movementSourceHash){
        row.reasons.push('provider_movement_changed_during_read');row.qualification='unknown';
      }
    }));void observed;
  }
  if(failed||rows.length!==page.data.length)return unavailable('provider_read_failed_or_budget_exhausted');
  return {protocol:'global_financial_provider_page_v1' as const,complete:true,reason:null,accountQualified:true,scopeHash:supportHash(scope),
    requestedCursor:cursor,nextCursor:page.has_more?page.data.at(-1).id:null,hasMore:page.has_more,rows,
    startedAt,observedAt:Timestamp.now(),providerRequestIds:[...new Set(requestIds)].slice(0,20)};
}
