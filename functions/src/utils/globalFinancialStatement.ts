/** Read an EXISTING provider report. Never creates a report, accepts a URL from
 * a client, follows a redirect or promotes a declared figure to provider proof. */
import {Timestamp} from 'firebase-admin/firestore';
import {HttpsError} from 'firebase-functions/v2/https';
import {getStripe} from '../config/stripe';
import {supportHash,supportSourceHash} from './supportRequest';
import type {GlobalFinancialScope} from './globalFinancialProvider';

export const GLOBAL_FINANCIAL_STATEMENT_LIMITS={bytes:65536,rows:20,readBudgetMs:22000,timeoutMs:5000} as const;
const integer=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v);
/** CSV money is MAJOR units; no floating multiplication, grouping, prefix parse,
 * exponent, fractional cent or unsafe integer silently changes the amount. */
export function globalStatementCents(value:unknown):number|null{
  if(typeof value!=='string'||!/^[-]?(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value))return null;
  const negative=value.startsWith('-'),[whole,decimal='']=(negative?value.slice(1):value).split('.');
  const amount=BigInt(whole)*BigInt(100)+BigInt(decimal.padEnd(2,'0'));
  if(amount>BigInt(Number.MAX_SAFE_INTEGER))return null;return Number(negative?-amount:amount);
}
function csvRows(input:string){
  if(Buffer.byteLength(input,'utf8')>GLOBAL_FINANCIAL_STATEMENT_LIMITS.bytes)throw new Error('oversize');
  const rows:string[][]=[];let row:string[]=[],cell='',quoted=false,closed=false;
  const finish=()=>{row.push(cell);cell='';closed=false;};
  for(let i=0;i<input.length;i++){const c=input[i];
    if(quoted){if(c==='"'){if(input[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else cell+=c;continue;}
    if(c==='"'){if(cell||closed)throw new Error('quote');quoted=true;continue;}
    if(closed&&c!==','&&c!=='\r'&&c!=='\n')throw new Error('trailing');
    if(c===','){finish();continue;}if(c==='\r'||c==='\n'){if(c==='\r'){if(input[i+1]!=='\n')throw new Error('newline');i++;}
      finish();rows.push(row);row=[];if(rows.length>GLOBAL_FINANCIAL_STATEMENT_LIMITS.rows)throw new Error('rows');continue;}cell+=c;
  }
  if(quoted)throw new Error('truncated');if(cell||row.length||closed){finish();rows.push(row);}
  return rows;
}
export function parseGlobalFinancialStatementCsv(input:string,reportType:string){
  try{
    if(reportType!=='balance.summary.1')return {qualification:'unknown' as const,reason:'statement_version_schema_unqualified',summary:null};
    const rows=csvRows(input.replace(/^\uFEFF/,'')),headers=rows.shift();
    if(!headers||headers.length<3||headers.length>4||new Set(headers).size!==headers.length||
      !['category','currency','net_amount'].every(k=>headers.includes(k))||headers.some(k=>!['category','currency','net_amount','description'].includes(k))||rows.length!==4)
      throw new Error('schema');
    const amounts:Record<string,number>={};
    for(const row of rows){if(row.length!==headers.length)throw new Error('columns');const d=Object.fromEntries(headers.map((key,i)=>[key,row[i]]));
      if(!['starting_balance','ending_balance','activity','payouts'].includes(d.category)||own(amounts,d.category)||d.currency?.toLowerCase()!=='cad')throw new Error('identity');
      const cents=globalStatementCents(d.net_amount);if(cents===null)throw new Error('amount');amounts[d.category]=cents;}
    const activity=amounts.activity+amounts.payouts;
    if(!integer(activity)||!integer(amounts.starting_balance+activity)||amounts.starting_balance+activity!==amounts.ending_balance)
      throw new Error('signed_bridge');
    return {qualification:'native_csv_components' as const,reason:null,summary:{currency:'CAD' as const,openingCents:amounts.starting_balance,
      closingCents:amounts.ending_balance,activityNetCents:amounts.activity,payoutNetCents:amounts.payouts,periodNetCents:activity,
      scope:'provider_currency_summary' as const,balanceType:null,bucketAllocationQualified:false as const}};
  }catch{return {qualification:'unknown' as const,reason:'statement_csv_incomplete_or_ambiguous',summary:null};}
}
const own=(v:object,k:string)=>Object.prototype.hasOwnProperty.call(v,k);
export async function observeGlobalFinancialStatement(scope:GlobalFinancialScope,guard?:()=>Promise<unknown>){
  const startedAt=Timestamp.now(),stripe=getStripe(),reference=scope.statementReference,key=process.env.STRIPE_SECRET_KEY?.trim();
  const unknown=(reason:string)=>({protocol:'global_financial_statement_v1' as const,qualification:'unknown' as const,reason,reference,
    scopeHash:supportHash(scope),summary:null,fileId:null,fileHash:null,proofHash:null,observedAt:Timestamp.now(),startedAt,openingClosingQualified:false as const});
  if(!reference)return unknown('provider_statement_not_selected');
  const mode=/^(sk|rk)_live_/.test(key??'')?true:/^(sk|rk)_test_/.test(key??'')?false:null;
  if(!stripe||!key||mode!==scope.livemode)return unknown('provider_statement_configuration_unknown');
  const rootOptions={timeout:GLOBAL_FINANCIAL_STATEMENT_LIMITS.timeoutMs,maxNetworkRetries:0},options={...rootOptions,...scope.accountKind==='connected'?{stripeAccount:scope.accountId}:{}};
  const deadline=Date.now()+GLOBAL_FINANCIAL_STATEMENT_LIMITS.readBudgetMs;
  const read=async(fn:()=>Promise<any>)=>{if(Date.now()+GLOBAL_FINANCIAL_STATEMENT_LIMITS.timeoutMs>deadline)throw new Error('budget');await guard?.();const value=await fn();await guard?.();return value;};
  try{
    const account=await read(()=>stripe.accounts.retrieveCurrent({},rootOptions));if(account?.object!=='account'||account.id!==scope.platformAccountId||
      scope.accountKind==='platform'&&scope.accountId!==account.id)return unknown('provider_statement_account_unknown');
    if(scope.accountKind==='connected'){const connected=await read(()=>stripe.accounts.retrieve(scope.accountId,{},rootOptions));
      if(connected?.object!=='account'||connected.id!==scope.accountId)return unknown('provider_statement_account_unknown');}
    const run=await read(()=>stripe.reporting.reportRuns.retrieve(reference.reportRunId,{},options)),p=run?.parameters;
    if(run?.object!=='reporting.report_run'||run.id!==reference.reportRunId||run.report_type!==reference.reportType||run.status!=='succeeded'||run.livemode!==scope.livemode||
      !p||p.interval_start!==scope.period.fromSeconds||p.interval_end!==scope.period.toSeconds||p.currency!=='cad'||
      p.timezone!=null&&!['UTC','Etc/UTC'].includes(p.timezone)||p.payout!=null||p.reporting_category!=null||
      p.connected_account!=null&&p.connected_account!==scope.accountId||scope.accountKind==='platform'&&p.connected_account!=null)
      return unknown('provider_statement_run_scope_unqualified');
    const result=run.result;if(result?.object!=='file'||!/^file_[A-Za-z0-9]+$/.test(result.id??'')||result.purpose!=='report_run'||result.type!=='csv'||
      !integer(result.size)||result.size<1||result.size>GLOBAL_FINANCIAL_STATEMENT_LIMITS.bytes)return unknown('provider_statement_file_unqualified');
    const file=await read(()=>stripe.files.retrieve(result.id,{},options));
    const fixedUrl=`https://files.stripe.com/v1/files/${result.id}/contents`;
    if(file?.object!=='file'||file.id!==result.id||file.purpose!=='report_run'||file.type!=='csv'||file.size!==result.size||
      file.url!==fixedUrl||result.url!==fixedUrl)return unknown('provider_statement_file_binding_unqualified');
    if(Date.now()+GLOBAL_FINANCIAL_STATEMENT_LIMITS.timeoutMs>deadline)return unknown('provider_statement_budget_exhausted');
    await guard?.();const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),GLOBAL_FINANCIAL_STATEMENT_LIMITS.timeoutMs);
    let bytes:Uint8Array;
    try{
      const response=await fetch(fixedUrl,{method:'GET',redirect:'error',signal:controller.signal,headers:{Authorization:'Basic '+Buffer.from(key+':').toString('base64'),
        ...scope.accountKind==='connected'?{'Stripe-Account':scope.accountId}:{}}});
      if(!response.ok||!response.body)throw new Error('download');const length=response.headers.get('content-length');
      if(length!==null&&(!/^\d+$/.test(length)||Number(length)!==file.size))throw new Error('length');
      const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
      try{while(true){const next=await reader.read();if(next.done)break;size+=next.value.byteLength;if(size>file.size||size>GLOBAL_FINANCIAL_STATEMENT_LIMITS.bytes)throw new Error('oversize');chunks.push(next.value);}}
      catch(error){await reader.cancel().catch(()=>{});throw error;}
      if(size!==file.size)throw new Error('truncated');bytes=Buffer.concat(chunks);
    }finally{clearTimeout(timer);}
    await guard?.();const decoded=new TextDecoder('utf-8',{fatal:true}).decode(bytes),parsed=parseGlobalFinancialStatementCsv(decoded,reference.reportType);
    if(parsed.qualification!=='native_csv_components')return unknown(parsed.reason!);
    const fileHash=supportHash(Buffer.from(bytes).toString('base64')),proof={reference,scopeHash:supportHash(scope),fileId:file.id,fileHash,
      period:scope.period,accountId:scope.accountId,platformAccountId:scope.platformAccountId,livemode:scope.livemode,summary:parsed.summary};
    return {protocol:'global_financial_statement_v1' as const,qualification:'native_provider_statement' as const,reason:null,reference,
      scopeHash:supportHash(scope),summary:parsed.summary,fileId:file.id,fileHash,proofHash:supportSourceHash(proof),observedAt:Timestamp.now(),startedAt,openingClosingQualified:true as const};
  }catch(error){if(error instanceof HttpsError&&['unauthenticated','permission-denied'].includes(error.code))throw error;return unknown('provider_statement_read_unavailable_or_unqualified');}
}
