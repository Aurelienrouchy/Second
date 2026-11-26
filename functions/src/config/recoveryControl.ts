import { Storage, type Bucket } from '@google-cloud/storage';
import { AsyncLocalStorage } from 'node:async_hooks';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import {qualifyIndexedRecoveryManifest,indexedRecoveryManifestQualifiesSource,IndexedManifestUnqualified,INDEXED_MANIFEST_MAX_BYTES,
  type IndexedRecoveryManifest} from './financialRecoveryManifest';

/** This bucket/control is operated through independent IAM, outside Firestore
 * backup/restore. Runtime credentials may read control and create evidence only;
 * they must NOT have permission to update control, manifests, or delete permits. */
export interface RecoveryInstallation {
  bucket: string; controlObject: string; prefix: string; installationId: string;
  firestoreProjectId: string; firestoreDatabaseId: string;
  financialEnvironment: 'test' | 'live' | 'unconfigured'; stripePlatformAccountId: string | null;
}
export interface RecoveryControl {
  protocol: 'financial_recovery_control_v1'; installationId: string;
  firestoreProjectId: string; firestoreDatabaseId: string;
  financialEnvironment: 'test' | 'live' | 'unconfigured'; stripePlatformAccountId: string | null;
  epoch: string; mode: 'normal' | 'draining' | 'recovery'; previousEpoch: string | null;
  reconciliationManifest: { object: string; generation: string; sha256: string } | null;
  /** Commerce admission is independent of financial servicing. Its optional
   * migration field is interpreted only by the NEW-commerce guard. */
  businessAdmission?: unknown;
}
export interface QualifiedRecoveryControl {
  installation: RecoveryInstallation; control: RecoveryControl;
  generation: string; sha256: string;
}
export class FinancialRecoveryBlocked extends Error {
  readonly code = 'financial-recovery-closed';
  constructor(readonly reason: string) { super('Financial operations require recovery qualification'); this.name = 'FinancialRecoveryBlocked'; }
}
const token = (v: unknown, max = 180): v is string => typeof v === 'string' && v.length > 0 && v.length <= max && /^[a-zA-Z0-9_.:-]+$/.test(v);
const objectName = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 700 &&
  /^[a-zA-Z0-9_./-]+$/.test(v) && !v.startsWith('/') && !v.split('/').some(p => !p || p === '.' || p === '..');
export const recoveryDigest = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');
const RECOVERY_REQUEST_TIMEOUT_MS = 2500;
const guardIo = new AsyncLocalStorage<{usedMs:number; limitMs:number}>();
let recoveryClient: Storage | null = null;
const manifestCache = new Map<string, Record<string,unknown>[]>();
const indexedManifestCache=new Map<string,IndexedRecoveryManifest>();
const manifestNodeCache=new Map<string,IndexedRecoveryManifest>();
export async function withFinancialRecoveryIoBudget<T>(fn: () => Promise<T>): Promise<T> {
  if (guardIo.getStore()) return fn();
  return guardIo.run({usedMs:0,limitMs:10000}, fn);
}
/** Await the actual SDK operation; no abandoned Promise.race may finish a
 * permit while a transport still runs. The dedicated SDK also bounds/rejects
 * each request and disables its automatic retries. */
async function recoveryIo<T>(fn: () => Promise<T>): Promise<T> {
  const budget = guardIo.getStore();
  if (!budget || budget.limitMs - budget.usedMs < RECOVERY_REQUEST_TIMEOUT_MS) throw new FinancialRecoveryBlocked('io_budget_exhausted');
  const started = performance.now();
  try { return await fn(); } finally { budget.usedMs += performance.now() - started; }
}
/** Exact document path; IDs retain their native Unicode/spacing. Never trim,
 * normalize, or ASCII-fold an identity used by a manifest or witness. */
export function isFinancialRecoveryDocumentPath(ref: unknown): ref is string {
  if (typeof ref !== 'string' || !ref || Buffer.byteLength(ref,'utf8') > 6144 || /[\u0000-\u001f\u007f]/.test(ref) || /[\uD800-\uDFFF]/u.test(ref)) return false;
  const segments = ref.split('/');
  return segments.length >= 2 && segments.length % 2 === 0 && segments.every(segment =>
    segment.length > 0 && Buffer.byteLength(segment,'utf8') <= 1500 && segment !== '.' && segment !== '..' && !/^__.*__$/.test(segment));
}

export function recoveryInstallation(): RecoveryInstallation {
  const env = process.env;
  const bucket = env.FINANCIAL_RECOVERY_BUCKET ?? '', controlObject = env.FINANCIAL_RECOVERY_CONTROL_OBJECT ?? '',
    prefix = env.FINANCIAL_RECOVERY_PREFIX ?? '', installationId = env.FINANCIAL_RECOVERY_INSTALLATION_ID ?? '',
    firestoreProjectId = env.FINANCIAL_RECOVERY_FIRESTORE_PROJECT_ID ?? '', firestoreDatabaseId = env.FINANCIAL_RECOVERY_FIRESTORE_DATABASE_ID ?? '',
    financialEnvironment = env.FINANCIAL_RECOVERY_ENVIRONMENT, stripePlatformAccountId = env.FINANCIAL_RECOVERY_STRIPE_ACCOUNT_ID || null;
  if (!/^[a-z0-9][a-z0-9._-]{2,220}$/.test(bucket) || /(?:\.appspot\.com|\.firebasestorage\.app)$/.test(bucket) ||
      !objectName(controlObject) || !objectName(prefix) || controlObject.startsWith(`${prefix}/permits/`) ||
      controlObject.startsWith(`${prefix}/observations/`) || !token(installationId) || !token(firestoreProjectId) ||
      (!token(firestoreDatabaseId) && firestoreDatabaseId !== '(default)') ||
      env.GCLOUD_PROJECT !== firestoreProjectId || (env.FIRESTORE_DATABASE_ID ?? '(default)') !== firestoreDatabaseId ||
      (financialEnvironment !== 'test' && financialEnvironment !== 'live' && financialEnvironment !== 'unconfigured') ||
      (financialEnvironment === 'unconfigured' ? stripePlatformAccountId !== null : !/^acct_[A-Za-z0-9]{5,100}$/.test(stripePlatformAccountId ?? ''))) {
    throw new FinancialRecoveryBlocked('installation_unqualified');
  }
  return {bucket, controlObject, prefix, installationId, firestoreProjectId, firestoreDatabaseId, financialEnvironment, stripePlatformAccountId};
}
export function recoveryBucket(installation = recoveryInstallation()): Bucket {
  // An isolated SDK client is required: Storage File.save changes its client's
  // retryOptions internally. Never change the Firebase Admin shared client.
  recoveryClient ??= new Storage({projectId:installation.firestoreProjectId, timeout:RECOVERY_REQUEST_TIMEOUT_MS,
    retryOptions:{autoRetry:false,maxRetries:0,totalTimeout:RECOVERY_REQUEST_TIMEOUT_MS / 1000}});
  return recoveryClient.bucket(installation.bucket);
}
async function readGeneration(bucket: Bucket, object: string, generation?: string, maxBytes = 32768): Promise<{bytes: Buffer; generation: string;temporaryHold:boolean}> {
  const file = bucket.file(object, generation ? {generation} : undefined), [metadata] = await recoveryIo(() => file.getMetadata());
  const current = String(metadata.generation ?? '');
  if (!/^[1-9]\d{0,24}$/.test(current) || generation && current !== generation ||
      !/^\d+$/.test(String(metadata.size)) || Number(metadata.size) > maxBytes) throw new FinancialRecoveryBlocked('object_unqualified');
  // Generation-pinned metadata bounds the full immutable object; ranged reads
  // cannot validate CRC32C in the Storage SDK and must not be used here.
  const [bytes] = await recoveryIo(() => bucket.file(object, {generation: current}).download({validation: 'crc32c'}));
  if (bytes.length !== Number(metadata.size) || bytes.length > maxBytes) throw new FinancialRecoveryBlocked('object_unqualified');
  return {bytes, generation: current,temporaryHold:metadata.temporaryHold===true};
}
export async function readFinancialRecoveryControl(): Promise<QualifiedRecoveryControl> {
  return withFinancialRecoveryIoBudget(async () => {
  try {
    const installation = recoveryInstallation(), bucket = recoveryBucket(installation), read = await readGeneration(bucket, installation.controlObject);
    const c = JSON.parse(read.bytes.toString('utf8')) as RecoveryControl;
    const fields = ['protocol','installationId','firestoreProjectId','firestoreDatabaseId','financialEnvironment','stripePlatformAccountId','epoch','mode','previousEpoch','reconciliationManifest'];
    if (!c || typeof c !== 'object' || Array.isArray(c) || Object.keys(c).some(k=>!fields.includes(k)&&k!=='businessAdmission') || !fields.every(k => Object.prototype.hasOwnProperty.call(c, k)) ||
        c.protocol !== 'financial_recovery_control_v1' || c.installationId !== installation.installationId ||
        c.firestoreProjectId !== installation.firestoreProjectId || c.firestoreDatabaseId !== installation.firestoreDatabaseId ||
        c.financialEnvironment !== installation.financialEnvironment || c.stripePlatformAccountId !== installation.stripePlatformAccountId ||
        !token(c.epoch) || !['normal','draining','recovery'].includes(c.mode) ||
        c.previousEpoch !== null && (!token(c.previousEpoch) || c.previousEpoch === c.epoch)) throw new FinancialRecoveryBlocked('control_unqualified');
    const manifest = c.reconciliationManifest;
    if (manifest !== null && (!manifest || typeof manifest !== 'object' || Array.isArray(manifest) || Object.keys(manifest).sort().join(',') !== 'generation,object,sha256' ||
        !objectName(manifest.object) || !manifest.object.startsWith(`${installation.prefix}/manifests/`) ||
        !/^[1-9]\d{0,24}$/.test(manifest.generation) || !/^[a-f0-9]{64}$/.test(manifest.sha256))) throw new FinancialRecoveryBlocked('manifest_unqualified');
    // A new epoch after a restore cannot open without an independently written,
    // generation-pinned manifest. Existence/hash qualifies provenance only; it
    // does not certify restored wallets or grant an admin any opening authority.
    if (c.mode === 'normal' && c.previousEpoch !== null && !manifest) throw new FinancialRecoveryBlocked('manifest_required');
    if (manifest) {
      await qualifiedManifest(bucket, manifest, c,installation.prefix);
    }
    return {installation, control: c, generation: read.generation, sha256: recoveryDigest(read.bytes)};
  } catch (error) {
    if (error instanceof FinancialRecoveryBlocked) throw error;
    throw new FinancialRecoveryBlocked('control_unavailable');
  }
  });
}

function qualifiedManifestSources(bytes: Buffer, control: RecoveryControl): Record<string, unknown>[] {
  const value = JSON.parse(bytes.toString('utf8')) as Record<string, unknown>;
  const fields = ['protocol','installationId','firestoreProjectId','firestoreDatabaseId','financialEnvironment','stripePlatformAccountId','epoch','previousEpoch','sources'];
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== fields.length ||
      !fields.every(k => Object.prototype.hasOwnProperty.call(value, k)) || value.protocol !== 'financial_recovery_manifest_v1' ||
      ['installationId','firestoreProjectId','firestoreDatabaseId','financialEnvironment','stripePlatformAccountId','epoch','previousEpoch']
        .some(k => value[k] !== (control as unknown as Record<string, unknown>)[k]) ||
      !Array.isArray(value.sources) || value.sources.length > 2000) throw new FinancialRecoveryBlocked('manifest_sources_unqualified');
  const sources = value.sources as Record<string, unknown>[];
  if (sources.some(s => !s || typeof s !== 'object' || Array.isArray(s) || Object.keys(s).sort().join(',') !== 'nativeSourceHash,ref' ||
      !isFinancialRecoveryDocumentPath(s.ref) ||
      typeof s.nativeSourceHash !== 'string' || !/^[a-f0-9]{64}$/.test(s.nativeSourceHash)) ||
      new Set(sources.map(s => s.ref)).size !== sources.length) throw new FinancialRecoveryBlocked('manifest_sources_unqualified');
  return sources;
}
async function qualifiedManifest(bucket: Bucket, manifest: NonNullable<RecoveryControl['reconciliationManifest']>, control: RecoveryControl,
  installationPrefix:string): Promise<Record<string,unknown>[]|IndexedRecoveryManifest> {
  const key = JSON.stringify([bucket.name,manifest.object,manifest.generation,manifest.sha256,control.installationId,
    control.firestoreProjectId,control.firestoreDatabaseId,control.financialEnvironment,control.stripePlatformAccountId,control.epoch,control.previousEpoch]);
  const cached = manifestCache.get(key);
  if (cached) return cached;
  const indexedKey=JSON.stringify([key,installationPrefix]),indexedCached=indexedManifestCache.get(indexedKey);
  if(indexedCached)return indexedCached;
  const read = await readGeneration(bucket, manifest.object, manifest.generation, 1024 * 1024);
  if (recoveryDigest(read.bytes) !== manifest.sha256) throw new FinancialRecoveryBlocked('manifest_unqualified');
  const protocol=(JSON.parse(read.bytes.toString('utf8')) as {protocol?:unknown}|null)?.protocol;
  if(protocol==='financial_recovery_manifest_v2'){
    let indexed:IndexedRecoveryManifest;
    try{indexed=qualifyIndexedRecoveryManifest(read.bytes,control,`${installationPrefix}/manifests/`,isFinancialRecoveryDocumentPath);}
    catch(error){if(error instanceof IndexedManifestUnqualified)throw new FinancialRecoveryBlocked('manifest_sources_unqualified');throw error;}
    if(indexedManifestCache.size>=20)indexedManifestCache.delete(indexedManifestCache.keys().next().value!);
    indexedManifestCache.set(indexedKey,indexed);return indexed;
  }
  const sources=qualifiedManifestSources(read.bytes, control);
  if (manifestCache.size >= 20) manifestCache.delete(manifestCache.keys().next().value!);
  manifestCache.set(key,sources); return sources;
}
export async function recoveryManifestQualifiesSource(qualified: QualifiedRecoveryControl, ref: string, nativeSourceHash: string): Promise<boolean> {
  // Catalogue permission cannot qualify a restored wallet/order or financial
  // identity, including when a matching manifest object has been supplied.
  if (qualified.control.financialEnvironment === 'unconfigured') return false;
  const manifest = qualified.control.reconciliationManifest;
  if (!manifest) return false;
  const sources = await qualifiedManifest(recoveryBucket(qualified.installation),manifest,qualified.control,qualified.installation.prefix);
  if(!Array.isArray(sources)){
    if(!isFinancialRecoveryDocumentPath(ref)||!/^[a-f0-9]{64}$/.test(nativeSourceHash))return false;
    const context=qualified.control,installation=qualified.installation,bucket=recoveryBucket(installation);
    try{return await indexedRecoveryManifestQualifiesSource(sources,ref,nativeSourceHash,async(pin,expected)=>{
      const key=JSON.stringify([bucket.name,installation.prefix,manifest.object,manifest.generation,manifest.sha256,context.installationId,
        context.firestoreProjectId,context.firestoreDatabaseId,context.financialEnvironment,context.stripePlatformAccountId,
        context.epoch,context.previousEpoch,expected.manifestId,expected.prefix,pin.object,pin.generation,pin.sha256]);
      const cached=manifestNodeCache.get(key);if(cached)return cached;
      let read:Awaited<ReturnType<typeof readGeneration>>;
      try{read=await readGeneration(bucket,pin.object,pin.generation,INDEXED_MANIFEST_MAX_BYTES);}
      catch(error){if(error instanceof FinancialRecoveryBlocked)throw error;throw new FinancialRecoveryBlocked('manifest_node_unavailable');}
      if(recoveryDigest(read.bytes)!==pin.sha256)throw new FinancialRecoveryBlocked('manifest_node_unqualified');
      const node=qualifyIndexedRecoveryManifest(read.bytes,context,`${installation.prefix}/manifests/`,isFinancialRecoveryDocumentPath,expected);
      if(manifestNodeCache.size>=256)manifestNodeCache.delete(manifestNodeCache.keys().next().value!);
      manifestNodeCache.set(key,node);return node;
    });}catch(error){if(error instanceof IndexedManifestUnqualified)throw new FinancialRecoveryBlocked('manifest_node_unqualified');throw error;}
  }
  // Missing or bounded-out entries remain closed; a manifest is never a claim
  // that all database rows, orphan provider effects, or wallets were restored.
  return sources.some(s => s.ref === ref && s.nativeSourceHash === nativeSourceHash);
}

/** An operator-owned immutable qualification object. Its pin is supplied by
 * deployment configuration, never by a restored document or an app admin. */
export async function readFinancialRecoveryPinnedObject(pin: {object:string;generation:string;sha256:string}): Promise<Buffer> {
  return withFinancialRecoveryIoBudget(async()=>{
    const installation=recoveryInstallation();
    if(!objectName(pin.object)||!pin.object.startsWith(`${installation.prefix}/manifests/`)||
      !/^[1-9]\d{0,24}$/.test(pin.generation)||!/^[a-f0-9]{64}$/.test(pin.sha256))throw new FinancialRecoveryBlocked('identity_policy_pin_unqualified');
    try{const read=await readGeneration(recoveryBucket(installation),pin.object,pin.generation);
      if(recoveryDigest(read.bytes)!==pin.sha256)throw new FinancialRecoveryBlocked('identity_policy_pin_unqualified');
      return read.bytes;
    }catch(error){if(error instanceof FinancialRecoveryBlocked)throw error;throw new FinancialRecoveryBlocked('identity_policy_unavailable');}
  });
}
/** Exact lifetime claim lookup. A missing claim is only a fact; the identity
 * policy or independent manifest must separately qualify a new claim. */
export async function readFinancialRecoveryIdentityClaim(object:string):Promise<{value:Record<string,unknown>;generation:string;sha256:string;temporaryHold:boolean}|null>{
  return withFinancialRecoveryIoBudget(async()=>{
    const installation=recoveryInstallation();
    if(!objectName(object)||![`${installation.prefix}/permits/connect-identities/`,`${installation.prefix}/permits/manual-refunds/`,`${installation.prefix}/permits/business-continuity/`].some(p=>object.startsWith(p)))throw new FinancialRecoveryBlocked('identity_claim_path_unqualified');
    try{const read=await readGeneration(recoveryBucket(installation),object);
      const value:unknown=JSON.parse(read.bytes.toString('utf8'));
      if(!value||typeof value!=='object'||Array.isArray(value))throw new FinancialRecoveryBlocked('identity_claim_unqualified');
      return {value:value as Record<string,unknown>,generation:read.generation,sha256:recoveryDigest(read.bytes),temporaryHold:read.temporaryHold};
    }catch(error){if((error as {code?:unknown})?.code===404)return null;
      if(error instanceof FinancialRecoveryBlocked)throw error;throw new FinancialRecoveryBlocked('identity_claim_unavailable');}
  });
}

/** Immutable create with collision qualification. Never overwrite evidence. */
export async function createRecoveryEvidence(object: string, value: Record<string, unknown>, installation = recoveryInstallation()): Promise<void> {
  const write = async () => {
  if (!objectName(object) || ![`${installation.prefix}/permits/`, `${installation.prefix}/observations/`].some(p => object.startsWith(p))) {
    throw new FinancialRecoveryBlocked('evidence_path_unqualified');
  }
  const bytes = Buffer.from(JSON.stringify(value));
  if (bytes.length > 32768) throw new FinancialRecoveryBlocked('evidence_too_large');
  const bucket = recoveryBucket(installation);
  const lifetimeClaim=[`${installation.prefix}/permits/connect-identities/`,`${installation.prefix}/permits/manual-refunds/`,`${installation.prefix}/permits/business-continuity/`].some(p=>object.startsWith(p));
  let existing:Awaited<ReturnType<typeof readGeneration>>|undefined;
  try {
    await recoveryIo(() => bucket.file(object).save(bytes, {resumable: false, timeout:RECOVERY_REQUEST_TIMEOUT_MS,
      validation: 'crc32c', preconditionOpts: {ifGenerationMatch: 0}, metadata: {contentType: 'application/json', cacheControl: 'private, no-store',
        ...(lifetimeClaim?{temporaryHold:true}:{})}}));
  } catch (error) {
    if ((error as {code?: number})?.code !== 412) throw new FinancialRecoveryBlocked('evidence_unavailable');
    // A manual bank action has no provider idempotency lookup. An earlier
    // claim without its native receipt is UNKNOWN, including the same tuple
    // after database restoration; it cannot recreate execution authority.
    if(object.startsWith(`${installation.prefix}/permits/manual-refunds/`))throw new FinancialRecoveryBlocked('manual_refund_claim_already_reserved');
    existing = await readGeneration(bucket, object);
    if (recoveryDigest(existing.bytes) !== recoveryDigest(bytes)) throw new FinancialRecoveryBlocked('evidence_collision');
  }
  if(lifetimeClaim){
    // ifGenerationMatch protects only creation, not preservation. GCS object
    // holds also prevent lifecycle Delete/replacement. Verify the actual hold
    // without ever updating/re-holding an old unprotected historical object.
    existing??=await readGeneration(bucket,object);
    if(recoveryDigest(existing.bytes)!==recoveryDigest(bytes))throw new FinancialRecoveryBlocked('evidence_collision');
    if(!existing.temporaryHold)throw new FinancialRecoveryBlocked('identity_claim_unprotected');
  }
  };
  // Provider facts remain preservable after a guard budget is exhausted. This
  // bounded observation budget cannot authorize a new POST/ledger/stock write.
  if (object.startsWith(`${installation.prefix}/observations/`)) return guardIo.run({usedMs:0,limitMs:5000},write);
  return withFinancialRecoveryIoBudget(write);
}
