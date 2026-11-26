/** A quota is an independent one-document transaction, never an agreement
 * effect. Its exact helper-produced write cannot authorize another path. */
import {AsyncLocalStorage} from 'node:async_hooks';
import {isDeepStrictEqual} from 'node:util';
type Scope={path:string;write:{method:'set'|'update';value:unknown}|null};
const scopes=new AsyncLocalStorage<Scope>();
export function withRateLimitScope<T>(path:string,fn:()=>Promise<T>):Promise<T>{
  if(!/^rate_limits\/[^/]+$/.test(path)||scopes.getStore())throw new Error('Independent quota scope invalid.');
  return scopes.run({path,write:null},fn);
}
export function recordRateLimitWrite(method:'set'|'update',value:unknown):void{
  const scope=scopes.getStore();if(!scope||scope.write)throw new Error('Independent quota write invalid.');
  const copy=(v:any):any=>v&&typeof v==='object'&&Object.getPrototypeOf(v)===Object.prototype?
    Object.fromEntries(Object.entries(v).map(([k,x])=>[k,copy(x)])):v;
  scope.write={method,value:copy(value)};
}
export function qualifyRateLimitTransaction(writes:readonly {method:string;args:any[]}[]):boolean{
  const scope=scopes.getStore();if(!scope)return false;
  const w=writes[0];
  if(writes.length!==1||!scope.write||!w||w.method!==scope.write.method||w.args.length!==2||w.args[0]?.path!==scope.path||
    !isDeepStrictEqual(w.args[1],scope.write.value))throw new Error('Independent quota transaction contains another effect.');
  // A retry gets a fresh declaration; the same native transaction attempt
  // cannot silently append a second write or reuse another invocation's quota.
  scope.write=null;return true;
}
