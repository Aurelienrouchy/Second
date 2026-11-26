/** A shop subscription is a separate supply from buyer protection. Neither a
 * service_fee_only policy nor TAX_ENABLED=false authorizes this new charge. */
import {createHash} from 'node:crypto';
import {HttpsError} from 'firebase-functions/v2/https';
import {getTaxConfig} from '../utils/fees';
import {qualifyDocumentedOperatorTax,qualifiedOperatorTaxDecision,operatorTaxDecisionHash,
  type OperatorTaxDecision,type ServiceFeeTaxContext} from './operatorServiceTax';

const RAW_POLICY=process.env.SHOP_TIER_TAX_POLICY_JSON;
export const SHOP_TIER_TAX_PRICING_VERSION='shop_tier_tax_pricing_v2' as const;
export interface ShopTierTaxPricing {
  protocol:typeof SHOP_TIER_TAX_PRICING_VERSION;currency:'CAD';priceMode:'exclusive'|'inclusive';priceCents:number;
  netCents:number;gstCents:number;qstCents:number;taxCents:number;totalCents:number;taxDecisionHash:string;hash:string;
}
const digest=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const invalid=()=>new HttpsError('failed-precondition','Le prix et le traitement fiscal du forfait doivent être documentés avant une nouvelle facturation.',
  {reason:'shop_tier_tax_qualification_required',taxQualification:'unknown',paymentPermissionGranted:false});
const integer=(n:unknown):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0;
function sum(...v:number[]) {const n=v.reduce((a,b)=>a+b,0);if(!Number.isSafeInteger(n))throw invalid();return n;}
function rate(n:number) {
  const v=String(n);if(!/^(?:0|1)(?:\.\d{1,6})?$/.test(v)||n<0||n>1)throw invalid();
  const [whole,decimal='']=v.split('.');return {numerator:Number(whole+decimal),denominator:10**decimal.length};
}
function rounded(cents:number,r:ReturnType<typeof rate>) {
  const product=cents*r.numerator;if(!Number.isSafeInteger(product))throw invalid();
  const q=Math.floor(product/r.denominator),rem=product%r.denominator;
  return q+(rem>=Math.ceil(r.denominator/2)?1:0);
}
/** Inclusive prices must have an exact net + separately rounded taxes
 * decomposition. No unexplained cent is assigned to a tax component. */
function amounts(priceCents:number,d:OperatorTaxDecision) {
  if(!integer(priceCents)||priceCents<50)throw invalid();
  const gst=rate(d.gstRate),qst=rate(d.qstRate);
  const result=(netCents:number)=>{const gstCents=rounded(netCents,gst),qstCents=rounded(netCents,qst);
    return {netCents,gstCents,qstCents,taxCents:sum(gstCents,qstCents),totalCents:sum(netCents,gstCents,qstCents)};};
  if(d.priceMode==='exclusive')return result(priceCents);
  const denominator=1000000,gstNumerator=gst.numerator*(denominator/gst.denominator),qstNumerator=qst.numerator*(denominator/qst.denominator),product=priceCents*denominator;
  if(![gstNumerator,qstNumerator,product].every(Number.isSafeInteger))throw invalid();
  const floor=Math.floor(product/(denominator+gstNumerator+qstNumerator));
  const candidates=[];
  for(let net=Math.max(1,floor-1);net<=floor+2;net++){const a=result(net);if(a.totalCents===priceCents)candidates.push(a);}
  if(candidates.length!==1)throw invalid();return candidates[0];
}
function pricing(priceCents:number,decision:OperatorTaxDecision):ShopTierTaxPricing {
  const body={protocol:SHOP_TIER_TAX_PRICING_VERSION,currency:'CAD' as const,priceMode:decision.priceMode,priceCents,
    ...amounts(priceCents,decision),taxDecisionHash:operatorTaxDecisionHash(decision)};
  return {...body,hash:digest(body)};
}
export function buildNewShopTierTaxPricing(priceCents:number,context:ServiceFeeTaxContext) {
  try{
    const c=getTaxConfig(),taxDecision=qualifyDocumentedOperatorTax(RAW_POLICY,'shop_tier_subscription',c.gstRate,c.qstRate,c.enabled,context);
    return {taxDecision,pricing:pricing(priceCents,taxDecision)};
  }catch{throw invalid();}
}
/** Original amounts and recorded decision only. No current tariff/policy/flag. */
export function qualifiedShopTierTaxPricing(raw:unknown,decisionRaw:unknown):ShopTierTaxPricing|null {
  const d=qualifiedOperatorTaxDecision(decisionRaw);
  if(!d||d.scope!=='shop_tier_subscription'||d.transportTreatment!=='no_transport_charge'||!raw||typeof raw!=='object'||Array.isArray(raw))return null;
  const v=raw as Record<string,unknown>;
  if(Object.keys(v).sort().join(',')!==['protocol','currency','priceMode','priceCents','netCents','gstCents','qstCents','taxCents','totalCents','taxDecisionHash','hash'].sort().join(',')||
    !integer(v.priceCents))return null;
  try{const canonical=pricing(v.priceCents,d);return Object.keys(canonical).every(k=>canonical[k as keyof ShopTierTaxPricing]===v[k])?canonical:null;}catch{return null;}
}
export function qualifiedShopTierTaxOperation(op:any):ShopTierTaxPricing|null {
  if(op?.taxPricingVersion!==SHOP_TIER_TAX_PRICING_VERSION)return null;
  const p=qualifiedShopTierTaxPricing(op.pricing,op.taxDecision);
  return p&&p.totalCents===op.amountCents?p:null;
}
