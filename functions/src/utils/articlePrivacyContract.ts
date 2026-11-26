import {createHash} from 'node:crypto';
import {Timestamp} from 'firebase-admin/firestore';
function canonical(value:any):any{
  if(value instanceof Timestamp)return {seconds:value.seconds,nanoseconds:value.nanoseconds};
  if(Array.isArray(value))return value.map(canonical);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,canonical(item)]));
  return value;
}
/** Preserve the existing withdrawal receipt format exactly. */
export const articlePrivacyHash=(parts:unknown[])=>createHash('sha256').update(JSON.stringify(canonical(parts))).digest('hex');
export function privacyMarker(value:unknown,articleId?:string):value is {schemaVersion:1;articleId:string;operationId:string;withdrawnAt:Timestamp}{
  const v=value as Record<string,any>;
  return !!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')==='articleId,operationId,schemaVersion,withdrawnAt'&&
    v.schemaVersion===1&&typeof v.articleId==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v.articleId)&&(!articleId||v.articleId===articleId)&&
    typeof v.operationId==='string'&&/^[a-f0-9]{64}$/.test(v.operationId)&&v.withdrawnAt instanceof Timestamp&&
    v.withdrawnAt.toMillis()>0&&v.withdrawnAt.toMillis()<=Date.now()+60000;
}
