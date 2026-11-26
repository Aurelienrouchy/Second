/** A current platform balance observation is not a reservation or a promise
 * that a later transfer will succeed. No provider mutation is performed here. */
import {Timestamp} from 'firebase-admin/firestore';
import {createHash} from 'node:crypto';
import {getStripe} from '../config/stripe';
import {isDevCommerceStripeTestRuntime} from '../config/runtimeEnvironment';

export const PLATFORM_CASH_PREFLIGHT_ENABLED:boolean=true;
export const PLATFORM_CASH_REFUSAL_REASONS=['platform_cash_preflight_not_exposed','platform_cash_observation_unknown',
  'platform_cash_unavailable','platform_cash_insufficient'] as const;
export type PlatformCashRefusalReason=typeof PLATFORM_CASH_REFUSAL_REASONS[number];
type StripeClient=NonNullable<ReturnType<typeof getStripe>>;
export type PlatformCashObservation={protocol:'platform_cash_preflight_v1';qualification:'available'|'not_exposed'|'unknown'|'unavailable'|'insufficient';
  reason:PlatformCashRefusalReason|null;requestedCents:number;currency:'CAD';platformAccountId:string|null;livemode:boolean|null;
  availableCents:number|null;accountRequestId:string|null;balanceRequestId:string|null;observedAt:Timestamp;cashReserved:false;concurrentCapacityGuaranteed:false;
  testMode?:'seconde_dev_commerce_v1';accountRestrictionsQualification?:'not_exposed_in_stripe_test_mode'};
export const platformCashObservationHash=(p:PlatformCashObservation)=>createHash('sha256').update(JSON.stringify([p.protocol,p.qualification,p.reason,p.requestedCents,
  p.currency,p.platformAccountId,p.livemode,p.availableCents,p.accountRequestId,p.balanceRequestId,p.observedAt.seconds,p.observedAt.nanoseconds,
  p.cashReserved,p.concurrentCapacityGuaranteed,...(p.testMode||p.accountRestrictionsQualification?[p.testMode??null,p.accountRestrictionsQualification??null]:[])])).digest('hex');
export function platformCashRefusalMessage(reason:PlatformCashRefusalReason){
  return reason==='platform_cash_insufficient'?'Le disponible CAD observé sur le compte de paiement de la plateforme ne permet pas ce retrait. Aucun fonds de votre porte-monnaie n’a été débité.':
    reason==='platform_cash_unavailable'?'Le compte de paiement de la plateforme est actuellement indisponible pour cette demande. Aucun fonds de votre porte-monnaie n’a été débité.':
    reason==='platform_cash_preflight_not_exposed'?'La vérification préalable du disponible de la plateforme est en préparation. Ce retrait n’a pas été engagé.':
    'Le disponible du compte de paiement de la plateforme n’a pas pu être qualifié. Aucun fonds de votre porte-monnaie n’a été débité.';
}
/** Both GETs use the same authenticated platform client as transfers.create,
 * never a connected-account header. Balance has no account ID of its own. */
export async function observePlatformCash(stripe:StripeClient,amountCents:number,destinationAccountId:string):Promise<PlatformCashObservation>{
  const result:PlatformCashObservation={protocol:'platform_cash_preflight_v1',qualification:'unknown',reason:'platform_cash_observation_unknown',requestedCents:amountCents,
    currency:'CAD',platformAccountId:null,livemode:null,availableCents:null,accountRequestId:null,balanceRequestId:null,observedAt:Timestamp.now(),
    cashReserved:false,concurrentCapacityGuaranteed:false};
  if(!PLATFORM_CASH_PREFLIGHT_ENABLED)return {...result,qualification:'not_exposed',reason:'platform_cash_preflight_not_exposed'};
  if(!Number.isSafeInteger(amountCents)||amountCents<1||!/^acct_[A-Za-z0-9_]{1,190}$/.test(destinationAccountId))return result;
  // Never persist or log the secret; only qualify the mode of this configured
  // client. An unsupported credential form is unknown, not an assumed mode.
  const key=process.env.STRIPE_SECRET_KEY?.trim(),mode=/^(?:sk|rk)_live_/.test(key??'')?true:/^(?:sk|rk)_test_/.test(key??'')?false:null;
  if(mode===null)return result;
  try{
    const [account,balance]=await Promise.all([stripe.accounts.retrieveCurrent(),stripe.balance.retrieve()]);
    result.observedAt=Timestamp.now();
    if(account.object!=='account'||!/^acct_[A-Za-z0-9_]{1,190}$/.test(account.id)||account.id===destinationAccountId||
      balance.object!=='balance'||typeof balance.livemode!=='boolean'||balance.livemode!==mode||!Array.isArray(balance.available)||
      balance.available.length>250||balance.available.some(row=>!Number.isSafeInteger(row?.amount)||typeof row?.currency!=='string'||!/^([a-z]{3})$/.test(row.currency))||
      new Set(balance.available.map(row=>row.currency)).size!==balance.available.length)return result;
    result.platformAccountId=account.id;result.livemode=balance.livemode;
    result.accountRequestId=/^req_[A-Za-z0-9_]{1,190}$/.test(account.lastResponse?.requestId??'')?account.lastResponse.requestId:null;
    result.balanceRequestId=/^req_[A-Za-z0-9_]{1,190}$/.test(balance.lastResponse?.requestId??'')?balance.lastResponse.requestId:null;
    if(!result.accountRequestId||!result.balanceRequestId)return result;
    const requirements=account.requirements;
    // Stripe's own sandbox platform response omits `requirements` even while
    // its test balance is available. Record that omission explicitly; it is
    // never relabelled as an unrestricted account. Production and any exposed
    // (including malformed/restricted) requirements keep their strict guard.
    const omittedTestRequirements=!Object.prototype.hasOwnProperty.call(account,'requirements')&&requirements===undefined&&
      isDevCommerceStripeTestRuntime()&&mode===false&&account.id===process.env.FINANCIAL_RECOVERY_STRIPE_ACCOUNT_ID;
    if(omittedTestRequirements){
      result.testMode='seconde_dev_commerce_v1';
      result.accountRestrictionsQualification='not_exposed_in_stripe_test_mode';
    }else{
      if(!requirements || typeof requirements!=='object' || Array.isArray(requirements) ||
        !Object.prototype.hasOwnProperty.call(requirements,'disabled_reason'))return result;
      const disabled=requirements.disabled_reason;
      if(disabled!==null){
        if(typeof disabled!=='string'||!disabled)return result;
        return {...result,qualification:'unavailable',reason:'platform_cash_unavailable'};
      }
    }
    const cad=balance.available.find(row=>row.currency==='cad');
    if(!cad)return result; // No CAD row is not evidence of zero available CAD.
    result.availableCents=cad.amount;
    return cad.amount<amountCents?{...result,qualification:'insufficient',reason:'platform_cash_insufficient'}:
      {...result,qualification:'available',reason:null};
  }catch{return result;}
}
