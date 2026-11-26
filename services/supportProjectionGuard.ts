import type {QueryClient} from '@tanstack/react-query';
import type {SupportConfidentialReceipt} from '@/types/supportConfidentiality';
/** Monotone, content-free fence: no pre-confinement response can become a current projection. */
let generation=0;
const listeners=new Set<()=>void>(),qualified=new WeakMap<object,number>();
const fencedReceipts=new WeakMap<QueryClient,Set<string>>();
const prefixes=new Set(['support-owner-list','support-owner-detail','support-admin-list','support-admin-detail']);
export const getSupportProjectionGeneration=()=>generation;
export const subscribeSupportProjection=(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};};
export function assertSupportProjectionGeneration(expected:number){if(expected!==generation)throw new Error('La projection du dossier a changé. Relisez sa version confidentielle actuelle.');}
export function qualifySupportProjection<T extends object>(value:T,expected:number):T {assertSupportProjectionGeneration(expected);const seen=new WeakSet<object>();const visit=(v:unknown)=>{if(!v||typeof v!=='object'||seen.has(v))return;seen.add(v);qualified.set(v,expected);for(const child of Object.values(v))visit(child);};visit(value);assertSupportProjectionGeneration(expected);return value;}
export const isSupportProjectionCurrent=(value:unknown):boolean=>!!value&&typeof value==='object'&&qualified.get(value)===generation;
export const areSupportProjectionPagesCurrent=(pages:readonly unknown[]|undefined):boolean=>!!pages&&pages.length>0&&pages.every(isSupportProjectionCurrent);
/** A qualified immutable receipt fences once; observing it again must not reset a new form. */
export async function renewSupportProjections(client:QueryClient,receipt:SupportConfidentialReceipt){if(receipt.state!=='committed')throw new Error('Le confinement doit avoir un reçu natif qualifié.');const key=JSON.stringify([receipt.actorId,receipt.requestId,receipt.payloadHash]),seen=fencedReceipts.get(client)??new Set<string>();if(seen.has(key))return;seen.add(key);fencedReceipts.set(client,seen);generation++;for(const listener of [...listeners])listener();const filter={predicate:(query:{queryKey:readonly unknown[]})=>prefixes.has(String(query.queryKey[0]))};await client.cancelQueries(filter,{revert:false});await client.invalidateQueries({...filter,refetchType:'active'});}
