import AsyncStorage from '@/utils/environmentStorage';
import {captureTradeSession,assertTradeSessionCurrent} from '@/services/tradeOperation';
import {productReviewEqual,productReviewHash} from '@/services/productReviewService';
import {SwapDisputeReviewService,swapDisputeReviewFailure} from '@/services/swapDisputeReviewService';
import {isSwapReviewAttempt} from '@/utils/swapDisputeReviewContract';
import type {SwapDisputeReviewAttempt} from '@/types/swapDisputeReview';
const prefix='second:swap-dispute-review:v1:',locks=new Set<string>();
const slot=(a:SwapDisputeReviewAttempt)=>prefix+JSON.stringify([a.uid,a.swapId,a.requestId]);
function fence(uid:string,guard:()=>void){const session=captureTradeSession(uid);return()=>{assertTradeSessionCurrent(session);guard();};}
async function qualified(a:SwapDisputeReviewAttempt,current:()=>void){if(!isSwapReviewAttempt(a,a.uid)||await productReviewHash(a.command)!==a.payloadHash)throw swapDisputeReviewFailure();current();}
async function list(uid:string,guard:()=>void):Promise<SwapDisputeReviewAttempt[]>{const current=fence(uid,guard);current();const keys=await AsyncStorage.getAllKeys();current();const own:string[]=[];
 for(const k of keys){if(!k.startsWith(prefix))continue;let parts:unknown;try{parts=JSON.parse(k.slice(prefix.length));}catch{throw swapDisputeReviewFailure();}if(!Array.isArray(parts)||parts[0]!==uid)continue;if(parts.length!==3||parts.some(x=>typeof x!=='string'))throw swapDisputeReviewFailure();own.push(k);}
 const rows=await AsyncStorage.multiGet(own);current();const attempts:SwapDisputeReviewAttempt[]=[];for(const[k,raw]of rows){if(raw===null)continue;const a:unknown=JSON.parse(raw);if(!isSwapReviewAttempt(a,uid)||slot(a)!==k)throw swapDisputeReviewFailure();await qualified(a,current);attempts.push(a);}return attempts;
}
async function same(a:SwapDisputeReviewAttempt,current:()=>void){const raw=await AsyncStorage.getItem(slot(a));current();if(raw===null||!productReviewEqual(JSON.parse(raw),a))throw swapDisputeReviewFailure();}
async function run(a:SwapDisputeReviewAttempt,mode:'execute'|'observe'|'neutralize'|'acknowledge',guard:()=>void,verifyNew?:()=>Promise<void>){const current=fence(a.uid,guard),key=slot(a);current();await qualified(a,current);if(locks.has(key))throw swapDisputeReviewFailure();locks.add(key);
 try{if(mode==='execute'){const prior=await AsyncStorage.getItem(key);current();if(prior!==null)throw swapDisputeReviewFailure();await AsyncStorage.setItem(key,JSON.stringify(a));current();await same(a,current);if(!verifyNew)throw swapDisputeReviewFailure();await verifyNew();current();await SwapDisputeReviewService.command(a,'execute',current);current();return SwapDisputeReviewService.command(a,'observe',current);}
  await same(a,current);const receipt=await SwapDisputeReviewService.command(a,'observe',current);current();if(mode==='observe')return receipt;
  if(mode==='acknowledge'){if(!['committed','not_executed'].includes(receipt.state)||receipt.recordedAt===null)throw swapDisputeReviewFailure();await same(a,current);await AsyncStorage.removeItem(key);current();return receipt;}
  if(['committed','not_executed'].includes(receipt.state))return receipt;await SwapDisputeReviewService.command(a,'neutralize',current);current();return SwapDisputeReviewService.command(a,'observe',current);
 }finally{locks.delete(key);}}
export const SwapDisputeReviewJournal={list,execute:(a:SwapDisputeReviewAttempt,g:()=>void,v:()=>Promise<void>)=>run(a,'execute',g,v),observe:(a:SwapDisputeReviewAttempt,g:()=>void)=>run(a,'observe',g),neutralize:(a:SwapDisputeReviewAttempt,g:()=>void)=>run(a,'neutralize',g),acknowledge:(a:SwapDisputeReviewAttempt,g:()=>void)=>run(a,'acknowledge',g)};
