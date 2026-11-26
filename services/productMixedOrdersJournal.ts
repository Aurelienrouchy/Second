import AsyncStorage from '@/utils/environmentStorage';
import {captureTradeSession,assertTradeSessionCurrent} from '@/services/tradeOperation';
import {productReviewEqual} from '@/services/productReviewService';
import {isProductMixedOrderAttempt,ProductMixedOrdersService} from '@/services/productMixedOrdersService';
import type {ProductMixedOrderAttempt} from '@/types/productMixedOrders';
const prefix='second:product-mixed-orders:v1:',key=(uid:string,id:string)=>prefix+JSON.stringify([uid,id]),locks=new Set<string>();
const fail=()=>new Error('Le même reçu de mélange doit être relu avant une autre intention.');
function fence(uid:string,guard:()=>void){const s=captureTradeSession(uid);return()=>{assertTradeSessionCurrent(s);guard();};}
async function list(uid:string,guard:()=>void):Promise<ProductMixedOrderAttempt[]>{const current=fence(uid,guard);current();const keys=await AsyncStorage.getAllKeys();current();const own:string[]=[];for(const k of keys){if(!k.startsWith(prefix))continue;let p:unknown;try{p=JSON.parse(k.slice(prefix.length));}catch{continue;}if(!Array.isArray(p)||p[0]!==uid)continue;if(p.length!==2||typeof p[1]!=='string'||k!==key(uid,p[1]))throw fail();own.push(k);}const rows=await AsyncStorage.multiGet(own);current();const result:ProductMixedOrderAttempt[]=[];for(const[k,raw]of rows){if(raw===null)continue;const a:unknown=JSON.parse(raw);if(!isProductMixedOrderAttempt(a,uid)||k!==key(uid,a.requestId))throw fail();result.push(a);}return result;}
async function same(a:ProductMixedOrderAttempt,current:()=>void){const raw=await AsyncStorage.getItem(key(a.uid,a.requestId));current();if(raw===null||!productReviewEqual(JSON.parse(raw),a))throw fail();}
async function work(a:ProductMixedOrderAttempt,mode:'execute'|'observe'|'resume'|'neutralize'|'acknowledge',guard:()=>void,verifyNew?:()=>Promise<void>){if(!isProductMixedOrderAttempt(a,a.uid))throw fail();const current=fence(a.uid,guard),slot=key(a.uid,a.requestId);current();if(locks.has(slot))throw fail();locks.add(slot);try{
  if(mode==='execute'){const prior=await AsyncStorage.getItem(slot);current();if(prior!==null)throw fail();await AsyncStorage.setItem(slot,JSON.stringify(a));current();await same(a,current);await ProductMixedOrdersService.command(a,'execute',current);current();return ProductMixedOrdersService.command(a,'observe',current);}
  await same(a,current);const receipt=await ProductMixedOrdersService.command(a,'observe',current);current();if(mode==='observe')return receipt;
  if(mode==='acknowledge'){if(receipt.state==='unrecorded')throw fail();await same(a,current);await AsyncStorage.removeItem(slot);current();return receipt;}
  if(receipt.state!=='unrecorded')return receipt;if(mode==='resume'){if(!verifyNew)throw fail();await verifyNew();current();}await ProductMixedOrdersService.command(a,mode==='resume'?'execute':'neutralize',current);current();return ProductMixedOrdersService.command(a,'observe',current);
}finally{locks.delete(slot);}}
export const ProductMixedOrdersJournal={list,execute:(a:ProductMixedOrderAttempt,g:()=>void)=>work(a,'execute',g),observe:(a:ProductMixedOrderAttempt,g:()=>void)=>work(a,'observe',g),neutralize:(a:ProductMixedOrderAttempt,g:()=>void)=>work(a,'neutralize',g),acknowledge:(a:ProductMixedOrderAttempt,g:()=>void)=>work(a,'acknowledge',g),resume:(a:ProductMixedOrderAttempt,g:()=>void,v:()=>Promise<void>)=>work(a,'resume',g,v)};
