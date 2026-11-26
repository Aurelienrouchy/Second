/** Exact native Troc identity mapped to the existing direct-charge proof. */
import {Timestamp} from 'firebase-admin/firestore';
import {stripeIntentEvidence, type IntentEvidence} from './stripeCheckoutProof';
export type SwapTopUpAmounts={baseCents:number;serviceFeeCents:number;taxCents:number;totalCents:number;currency:'CAD'};
export type SwapTopUpExpected=SwapTopUpAmounts&{swapId:string;payerId:string;payeeId:string;paymentIntentId?:string;intentId?:string};
export function swapTopUpIntentEvidence(pi:any,e:SwapTopUpExpected):IntentEvidence|null {
  if(pi?.metadata?.type!=='swap_topup'||pi.metadata.swapId!==e.swapId||pi.metadata.payerId!==e.payerId||pi.metadata.payeeId!==e.payeeId||
    pi.metadata.topUpAmount!==String(e.baseCents)||pi.metadata.topUpFee!==String(e.serviceFeeCents)||
    ![e.baseCents,e.serviceFeeCents,e.taxCents,e.totalCents].every(Number.isSafeInteger)||e.baseCents<=0||e.serviceFeeCents<0||e.taxCents<0||
    e.totalCents!==e.baseCents+e.serviceFeeCents+e.taxCents||typeof pi.livemode!=='boolean'||
    e.intentId&&(pi.metadata.swapCheckoutIntentId!==e.intentId||pi.capture_method!=='automatic'))return null;
  // Normalize FROM the provider's native Troc keys, never from caller values.
  return stripeIntentEvidence({...pi,metadata:{...pi.metadata,transactionId:pi.metadata.swapId,buyerId:pi.metadata.payerId,
    sellerId:pi.metadata.payeeId,checkoutIntentId:pi.metadata.swapCheckoutIntentId}},
    {id:e.paymentIntentId,orderId:e.swapId,buyerId:e.payerId,sellerId:e.payeeId,cardCents:e.totalCents,walletCents:0,...(e.intentId?{intentId:e.intentId}:{})});
}
export function swapTopUpProviderSnapshot(pi:any,e:IntentEvidence,source:'retrieve'|'response') {
  return {id:e.id,status:e.status,method:e.method,amountCents:e.amountCents,receivedCents:e.receivedCents,capturableCents:e.capturableCents,
    livemode:pi.livemode,source,observedAt:Timestamp.now()};
}
export function observedSwapTopUpNeutralization(raw:any,swapId:string,payerId:string,payeeId:string) {
  const d=raw?.document,p=d?.provider;
  return raw?.protocol==='swap_topup_retirement_receipt_v1'&&d?.swapId===swapId&&d.payerId===payerId&&d.payeeId===payeeId&&
    typeof d.paymentIntentId==='string'&&/^pi_[A-Za-z0-9]+$/.test(d.paymentIntentId)&&p?.id===d.paymentIntentId&&p.status==='canceled'&&
    p.method==='automatic'&&p.receivedCents===0&&p.capturableCents===0&&p.source==='retrieve'&&typeof p.livemode==='boolean'&&
    p.observedAt instanceof Timestamp&&p.observedAt.toMillis()>0&&p.observedAt.toMillis()<=Date.now();
}
