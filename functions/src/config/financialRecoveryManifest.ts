/** Prospective immutable manifest index. Pure parsing/routing only: no GCS,
 * Firestore, IAM claim, reconstruction or financial permission is created. */
import {createHash} from 'node:crypto';

export interface IndexedManifestContext {
  installationId:string;firestoreProjectId:string;firestoreDatabaseId:string;
  financialEnvironment:'test'|'live'|'unconfigured';stripePlatformAccountId:string|null;epoch:string;previousEpoch:string|null;
}
export interface IndexedManifestPin {object:string;generation:string;sha256:string;}
export type IndexedManifestNode=
  | {kind:'branch';prefix:string;children:{nibble:string;pin:IndexedManifestPin}[]}
  | {kind:'leaf';prefix:string;sources:{ref:string;nativeSourceHash:string}[]};
export interface IndexedRecoveryManifest {manifestId:string;node:IndexedManifestNode;}
export class IndexedManifestUnqualified extends Error {
  constructor(){super('Immutable recovery manifest index is unqualified');this.name='IndexedManifestUnqualified';}
}
export const INDEXED_MANIFEST_MAX_BYTES=32768;
const fields=['installationId','firestoreProjectId','firestoreDatabaseId','financialEnvironment','stripePlatformAccountId','epoch','previousEpoch'] as const;
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const exact=(v:unknown,keys:readonly string[]):v is Record<string,unknown>=>object(v)&&Object.keys(v).sort().join(',')===[...keys].sort().join(',');
const hash=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const prefix=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{0,64}$/.test(v);
const fail=():never=>{throw new IndexedManifestUnqualified();};
/** IDs are their exact native UTF-8 bytes, without normalization/trim/folding. */
export const indexedManifestRefHash=(ref:string)=>createHash('sha256').update(Buffer.from(ref,'utf8')).digest('hex');
function pin(raw:unknown,manifestPrefix:string):IndexedManifestPin {
  if(!exact(raw,['object','generation','sha256'])||typeof raw.object!=='string'||raw.object.length>700||
    !/^[a-zA-Z0-9_./-]+$/.test(raw.object)||!raw.object.startsWith(manifestPrefix)||raw.object.startsWith('/')||
    raw.object.split('/').some(s=>!s||s==='.'||s==='..')||typeof raw.generation!=='string'||
    !/^[1-9]\d{0,24}$/.test(raw.generation)||!hash(raw.sha256))return fail();
  return {object:raw.object,generation:raw.generation,sha256:raw.sha256};
}
/** Every node binds the complete installation/epoch, this manifest identity and
 * its exact hash prefix. A valid pin from a foreign subtree cannot be adopted. */
export function qualifyIndexedRecoveryManifest(bytes:Buffer,context:IndexedManifestContext,manifestPrefix:string,
  isDocumentPath:(ref:unknown)=>ref is string,expected?:{prefix:string;manifestId:string}):IndexedRecoveryManifest {
  if(bytes.length>INDEXED_MANIFEST_MAX_BYTES)return fail();
  const text=bytes.toString('utf8');if(!Buffer.from(text,'utf8').equals(bytes))return fail();
  let raw:unknown;try{raw=JSON.parse(text);}catch{return fail();}
  if(!exact(raw,['protocol',...fields,'manifestId','algorithm','node'])||
    raw.protocol!==(expected?'financial_recovery_manifest_node_v2':'financial_recovery_manifest_v2')||
    raw.algorithm!=='sha256_ref_utf8_hex_v1'||!hash(raw.manifestId)||fields.some(k=>raw[k]!==context[k])||
    expected&&raw.manifestId!==expected.manifestId)return fail();
  const n=raw.node,wanted=expected?.prefix??'';
  if(!object(n)||!prefix(n.prefix)||n.prefix!==wanted)return fail();
  if(n.kind==='branch'){
    if(!exact(n,['kind','prefix','children'])||n.prefix.length>=64||!Array.isArray(n.children)||n.children.length<1||n.children.length>16)return fail();
    const children:{nibble:string;pin:IndexedManifestPin}[]=[],nibbles=new Set<string>(),pins=new Set<string>();
    for(const c of n.children){
      if(!exact(c,['nibble','pin'])||typeof c.nibble!=='string'||!/^[a-f0-9]$/.test(c.nibble)||nibbles.has(c.nibble))return fail();
      const p=pin(c.pin,manifestPrefix),id=JSON.stringify([p.object,p.generation,p.sha256]);
      if(pins.has(id))return fail();nibbles.add(c.nibble);pins.add(id);children.push({nibble:c.nibble,pin:p});
    }
    children.sort((a,b)=>a.nibble.localeCompare(b.nibble));
    return {manifestId:raw.manifestId,node:{kind:'branch',prefix:n.prefix,children}};
  }
  if(n.kind!=='leaf'||!exact(n,['kind','prefix','sources'])||!Array.isArray(n.sources)||n.sources.length>128)return fail();
  const sources:{ref:string;nativeSourceHash:string}[]=[],refs=new Set<string>();
  for(const s of n.sources){
    if(!exact(s,['ref','nativeSourceHash'])||!isDocumentPath(s.ref)||!hash(s.nativeSourceHash)||refs.has(s.ref)||
      !indexedManifestRefHash(s.ref).startsWith(n.prefix))return fail();
    refs.add(s.ref);sources.push({ref:s.ref,nativeSourceHash:s.nativeSourceHash});
  }
  return {manifestId:raw.manifestId,node:{kind:'leaf',prefix:n.prefix,sources}};
}
/** One exact route, bounded by a 256-bit digest, never a listing/total scan.
 * Missing listed objects/errors must be thrown by the pinned reader; only a
 * qualified route or leaf that does not list this reference returns false. */
export async function indexedRecoveryManifestQualifiesSource(root:IndexedRecoveryManifest,ref:string,nativeSourceHash:string,
  read:(pin:IndexedManifestPin,expected:{prefix:string;manifestId:string})=>Promise<IndexedRecoveryManifest>):Promise<boolean> {
  const digest=indexedManifestRefHash(ref);let current=root;
  for(let depth=0;depth<=64;depth++){
    const node=current.node;
    if(node.prefix!==digest.slice(0,depth)||current.manifestId!==root.manifestId)return fail();
    if(node.kind==='leaf')return node.sources.some(s=>s.ref===ref&&s.nativeSourceHash===nativeSourceHash);
    const child=node.children.find(c=>c.nibble===digest[depth]);
    if(!child)return false;
    current=await read(child.pin,{prefix:digest.slice(0,depth+1),manifestId:root.manifestId});
  }
  return fail();
}
