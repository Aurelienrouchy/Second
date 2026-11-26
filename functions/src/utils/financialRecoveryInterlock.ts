import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import {activeLocalAgreementScope,bindLocalAgreementControl,localOperationAllows,withLocalAgreementScope} from './localAgreement';
import {bindLocalCatalogueControl,withLocalCatalogueScope} from './localCatalogue';
import { FinancialRecoveryBlocked, createRecoveryEvidence, readFinancialRecoveryControl, recoveryDigest, recoveryInstallation,
  recoveryManifestQualifiesSource, withFinancialRecoveryIoBudget, isFinancialRecoveryDocumentPath,
  type QualifiedRecoveryControl, type RecoveryInstallation } from '../config/recoveryControl';

export type FinancialRecoveryEffectKind = 'firestore_commit' | 'stripe_mutation' | 'shipengine_label_mutation' | 'webhook_admission';
export interface FinancialRecoverySource { refs?: readonly string[]; idempotencyKeys?: readonly string[]; sourceHash?: string; providerOperation?: string }
export interface FinancialRecoveryDescriptor { operation: string; sourceRefs?: readonly string[]; idempotencyKeys?: readonly string[] }
interface Scope { id: string; descriptor: FinancialRecoveryDescriptor; admitted: QualifiedRecoveryControl | null; sequence: number; pending: Promise<void> }
/** A platform without a financial provider may still maintain its catalogue.
 * Every effect is bounded by operation, kind and native source path; this is
 * independent of dev/prod and never qualifies money or restored balances. */
export function unconfiguredEffectAllowed(operation: string, kind: FinancialRecoveryEffectKind, source: FinancialRecoverySource): boolean {
  if (kind !== 'firestore_commit' || source.idempotencyKeys?.length) return false;
  if(operation==='callable/articlePrivacy.withdrawArticlePrivacy')return source.providerOperation===undefined&&!!source.refs?.length&&source.refs.every(ref=>
    /^(articles|article_privacy_evidence|article_privacy_commands|transactions|swaps|swapPartyItems|search_index|embeddings|avis)\/[^/]+$/.test(ref)||
    /^article_privacy_evidence\/[^/]+\/public_projection_evidence\/[a-f0-9]{64}$/.test(ref));
  if(localOperationAllows(operation)) {
    if(source.providerOperation==='new_commerce_admission')return !source.refs?.length;
    return source.providerOperation===undefined && !!source.refs?.length && source.refs.every(ref=>localOperationAllows(operation,ref));
  }
  const roots: Record<string, readonly string[]> = {
    'callable/products.createArticle': ['articles', 'inventory_units'],
    'callable/products.updateArticle': ['articles', 'inventory_units'],
    'callable/products.toggleArticleSold': ['articles', 'inventory_units', 'article_sold_requests'],
    'callable/products.incrementProductView': ['articles', 'search_index', 'article_views'],
    'callable/products.toggleProductLike': ['favorites'],
    'callable/products.markSavedSearchViewed': [],
  };
  const allowed = roots[operation];
  if (!allowed) return false;
  if (source.providerOperation === 'new_commerce_admission') return !source.refs?.length &&
    ['callable/products.createArticle','callable/products.updateArticle','callable/products.toggleArticleSold'].includes(operation);
  if (source.providerOperation !== undefined || !source.refs?.length) return false;
  return source.refs.every(ref => {
    if (operation === 'callable/products.markSavedSearchViewed') return /^users\/[^/]+\/savedSearches\/[^/]+$/.test(ref);
    if (operation === 'callable/products.updateArticle' && /^articles\/[^/]+\/retired_media\/[a-f0-9]{64}$/.test(ref)) return true;
    const parts = ref.split('/');
    return parts.length === 2 && !!parts[1] && allowed.includes(parts[0]);
  });
}
const scopes = new AsyncLocalStorage<Scope>();
const safeList = (values?: readonly string[]): string[] => {
  if (!values) return [];
  if (!Array.isArray(values) || values.length > 30 || values.some(v => typeof v !== 'string' || !v || Buffer.byteLength(v,'utf8') > 6144 || /[\u0000-\u001f]/.test(v) || /[\uD800-\uDFFF]/u.test(v))) throw new FinancialRecoveryBlocked('source_unqualified');
  return [...new Set(values)].sort();
};
function sourceProjection(source: FinancialRecoverySource = {}): Record<string, unknown> {
  if (source.sourceHash !== undefined && !/^[a-f0-9]{64}$/.test(source.sourceHash) ||
      source.providerOperation !== undefined && !/^[a-zA-Z0-9_.:/-]{1,180}$/.test(source.providerOperation)) throw new FinancialRecoveryBlocked('source_unqualified');
  return {refs: safeList(source.refs), idempotencyKeyHashes: safeList(source.idempotencyKeys).map(recoveryDigest),
    sourceHash: source.sourceHash ?? null, providerOperation: source.providerOperation ?? null};
}
export async function withFinancialRecoveryScope<T>(descriptor: FinancialRecoveryDescriptor, fn: () => Promise<T>): Promise<T> {
  if (scopes.getStore()) return fn();
  if (!/^[a-zA-Z0-9_.:/-]{1,180}$/.test(descriptor.operation)) throw new FinancialRecoveryBlocked('operation_unqualified');
  const scope: Scope = {id: randomUUID(), descriptor: {operation: descriptor.operation, sourceRefs: safeList(descriptor.sourceRefs),
    idempotencyKeys: safeList(descriptor.idempotencyKeys)}, admitted: null, sequence: 0, pending: Promise.resolve()};
  return withFinancialRecoveryIoBudget(() => withLocalCatalogueScope(descriptor.operation,()=>withLocalAgreementScope(descriptor.operation,()=>scopes.run(scope, async () => {
    let completed = false;
    try { const value = await fn(); completed = true; return value; }
    finally {
      // No timeout/lease expiry closes an abandoned invocation. This is proof
      // only that this invocation ended, NEVER that a payment settled.
      await scope.pending.catch(() => undefined);
      if (scope.admitted) await createRecoveryEvidence(permitPath(scope, 'execution-finished'), {
        protocol: 'financial_recovery_execution_finished_v1', invocationId: scope.id, epoch: scope.admitted.control.epoch,
        handlerReturned: completed, financialSettlement: 'not_asserted', effectAssertions: scope.sequence,
      }, scope.admitted.installation);
    }
  }))));
}
function permitPath(scope: Scope, suffix: string): string {
  const a = scope.admitted!; return `${a.installation.prefix}/permits/${a.control.epoch}/${scope.id}/${suffix}.json`;
}
async function assertEffect(scope: Scope, kind: FinancialRecoveryEffectKind, source: FinancialRecoverySource): Promise<void> {
  if (!scope.admitted) {
    const current = await readFinancialRecoveryControl();
    if (current.control.mode !== 'normal') throw new FinancialRecoveryBlocked(`mode_${current.control.mode}`);
    if (current.control.financialEnvironment === 'unconfigured' && !unconfiguredEffectAllowed(scope.descriptor.operation, kind, source)) {
      throw new FinancialRecoveryBlocked('financial_provider_unconfigured');
    }
    scope.admitted = current;
    bindLocalCatalogueControl(current.control);
    if(current.control.financialEnvironment==='unconfigured'&&activeLocalAgreementScope())bindLocalAgreementControl(current.control);
    scope.sequence++;
    await createRecoveryEvidence(permitPath(scope, 'admission'), {
      protocol: 'financial_recovery_permit_v1', invocationId: scope.id, installationId: current.control.installationId,
      epoch: current.control.epoch, controlGeneration: current.generation, controlHash: current.sha256,
      operation: scope.descriptor.operation, ...sourceProjection({refs: scope.descriptor.sourceRefs, idempotencyKeys: scope.descriptor.idempotencyKeys}),
      firstEffect: kind, firstSource: sourceProjection(source), financialSettlement: 'not_asserted',
    }, current.installation);
  } else {
    if (scope.admitted.control.financialEnvironment === 'unconfigured' && !unconfiguredEffectAllowed(scope.descriptor.operation, kind, source)) {
      throw new FinancialRecoveryBlocked('financial_provider_unconfigured');
    }
    const sequence = ++scope.sequence;
    await createRecoveryEvidence(permitPath(scope, `effect-${String(sequence).padStart(6, '0')}`), {
      protocol: 'financial_recovery_effect_assertion_v1', invocationId: scope.id, epoch: scope.admitted.control.epoch,
      sequence, kind, ...sourceProjection(source), financialSettlement: 'not_asserted',
    }, scope.admitted.installation);
  }
  // Race with draining is represented by the still-open permit; the operator
  // must drain actual executions, never infer they ended from elapsed time.
  const after = await readFinancialRecoveryControl();
  const current = scope.admitted;
  if (after.control.mode !== 'normal' || after.control.epoch !== current.control.epoch || after.generation !== current.generation || after.sha256 !== current.sha256) {
    throw new FinancialRecoveryBlocked('effect_control_changed');
  }
}
export async function assertFinancialRecoveryEffect(kind: FinancialRecoveryEffectKind, source: FinancialRecoverySource = {}): Promise<void> {
  const scope = scopes.getStore();
  if (!scope) throw new FinancialRecoveryBlocked('scope_missing');
  // Concurrent effects in one invocation must not acquire two permits or race
  // sequence numbers. A failed assertion poisons subsequent effect attempts.
  const next = scope.pending.then(() => assertEffect(scope, kind, source));
  scope.pending = next; await next;
}
export interface FinancialRecoveryWitness {
  protocol: 'financial_recovery_source_witness_v1'; installationId: string; epoch: string;
  ref: string; nativeSourceHash: string;
}
function sourceIdentity(ref: string, hash: string): void {
  if (!isFinancialRecoveryDocumentPath(ref) ||
      !/^[a-f0-9]{64}$/.test(hash)) throw new FinancialRecoveryBlocked('source_identity_unqualified');
}
/** These roots may hold a LOCAL agreement while no provider is configured.
 * Even the generic factories must not mint or validate a financial witness
 * for them, including through an old witness or a purported manifest. */
function assertFinancialSourceKindConfigured(ref:string):void {
  if(!['transactions','swaps','disputes'].includes(ref.split('/')[0]))return;
  if(process.env.FINANCIAL_RECOVERY_ENVIRONMENT==='unconfigured'||activeLocalAgreementScope()||
      scopes.getStore()?.admitted?.control.financialEnvironment==='unconfigured')throw new FinancialRecoveryBlocked('financial_provider_unconfigured');
}
function sourceWitness(scope: Scope, ref: string, hash: string): FinancialRecoveryWitness {
  assertFinancialSourceKindConfigured(ref);
  return {protocol: 'financial_recovery_source_witness_v1', installationId: scope.admitted!.control.installationId,
    epoch: scope.admitted!.control.epoch, ref, nativeSourceHash: hash};
}
/** Domain callers hash their explicit native financial components, excluding
 * this witness. Existing restored data is never auto-adopted. */
export async function assertFinancialRecoverySource(input: {ref: string; nativeSourceHash: string; witness?: unknown;
  nextSourceHash?: string}): Promise<FinancialRecoveryWitness> {
  sourceIdentity(input.ref, input.nativeSourceHash);
  assertFinancialSourceKindConfigured(input.ref);
  if (input.nextSourceHash !== undefined) sourceIdentity(input.ref, input.nextSourceHash);
  await assertFinancialRecoveryEffect('firestore_commit', {refs: [input.ref], sourceHash: input.nativeSourceHash});
  assertFinancialSourceKindConfigured(input.ref);
  const scope = scopes.getStore()!, expected = sourceWitness(scope, input.ref, input.nativeSourceHash), w = input.witness;
  const matches = !!w && typeof w === 'object' && !Array.isArray(w) && Object.keys(w).length === 5 &&
    Object.entries(expected).every(([key,value]) => (w as unknown as Record<string, unknown>)[key] === value);
  if (!matches && !await recoveryManifestQualifiesSource(scope.admitted!, input.ref, input.nativeSourceHash)) {
    throw new FinancialRecoveryBlocked('source_not_reconciled');
  }
  // assertEffect qualified the immutable generation/hash manifest root. V1
  // entries are cached; V2 may read pinned children within the same IO budget.
  // The source lookup never caches the mutable recovery control.
  return sourceWitness(scope, input.ref, input.nextSourceHash ?? input.nativeSourceHash);
}
/** Only for a source proven absent and created atomically by this transaction.
 * It cannot qualify an existing row, fabricate historical value, or authorize
 * credit from an old/unreconciled payment. Domain code must prove those inputs. */
export async function financialRecoveryNewSourceWitness(ref: string, initialSourceHash: string): Promise<FinancialRecoveryWitness> {
  sourceIdentity(ref, initialSourceHash);
  assertFinancialSourceKindConfigured(ref);
  await assertFinancialRecoveryEffect('firestore_commit', {refs: [ref], sourceHash: initialSourceHash});
  assertFinancialSourceKindConfigured(ref);
  return sourceWitness(scopes.getStore()!, ref, initialSourceHash);
}
export interface RecoveryProviderObservation {
  provider: 'stripe' | 'shipengine'; eventId: string; eventType: string; payloadHash: string;
  accountId: string | null; liveMode: boolean | null; objectIds: readonly string[];
  facts: Record<string, string | number | boolean | null>;
}
export async function preserveFinancialRecoveryObservation(observation: RecoveryProviderObservation): Promise<void> {
  const installation = qualifiedFinancialRecoveryEnvironment();
  if (!/^[a-f0-9]{64}$/.test(observation.payloadHash) || !/^[a-zA-Z0-9_.:-]{1,200}$/.test(observation.eventId) ||
      !/^[a-zA-Z0-9_.:-]{1,180}$/.test(observation.eventType) || observation.accountId !== null && !/^acct_[A-Za-z0-9]{5,100}$/.test(observation.accountId) ||
      observation.liveMode !== null && observation.liveMode !== (installation.financialEnvironment === 'live')) throw new FinancialRecoveryBlocked('observation_unqualified');
  const objectIds = safeList(observation.objectIds);
  if (Object.keys(observation.facts).length > 24 || Object.entries(observation.facts).some(([key,value]) =>
    !/^[a-zA-Z][a-zA-Z0-9_]{0,59}$/.test(key) || !(value === null || typeof value === 'boolean' || typeof value === 'number' && Number.isSafeInteger(value) ||
      typeof value === 'string' && value.length <= 200 && /^[a-zA-Z0-9_. :/-]*$/.test(value)))) throw new FinancialRecoveryBlocked('observation_unqualified');
  const key = recoveryDigest(JSON.stringify([observation.provider, observation.accountId, observation.eventId, observation.payloadHash]));
  await createRecoveryEvidence(`${installation.prefix}/observations/${observation.provider}/${key}.json`, {
    protocol: 'financial_recovery_observation_v1', installationId: installation.installationId,
    firestoreProjectId: installation.firestoreProjectId, firestoreDatabaseId: installation.firestoreDatabaseId,
    financialEnvironment: installation.financialEnvironment, stripePlatformAccountId: installation.stripePlatformAccountId,
    ...observation, objectIds,
  }, installation);
}
/** Bounded causal fact after a provider response. It remains writable when the
 * control has closed; it never authorizes a Firestore settlement or new POST. */
export async function preserveFinancialRecoveryEffectResponse(provider: 'stripe' | 'shipengine', operation: string,
  response: unknown, requestHash: string): Promise<void> {
  const scope = scopes.getStore();
  if (!scope?.admitted) throw new FinancialRecoveryBlocked('response_scope_missing');
  if (scope.admitted.control.financialEnvironment === 'unconfigured') throw new FinancialRecoveryBlocked('financial_provider_unconfigured');
  const value = response && typeof response === 'object' ? response as Record<string, unknown> : {};
  const facts: Record<string, string | number | boolean | null> = {operation, requestHash};
  for (const key of ['status','http_status','amount','amount_received','amount_refunded','amount_reversed','currency','created','livemode','deleted','approved','voided']) {
    const v = value[key];
    if (v === null || typeof v === 'boolean' || typeof v === 'number' && Number.isSafeInteger(v) ||
        typeof v === 'string' && v.length <= 120 && /^[a-zA-Z0-9_. :/-]*$/.test(v)) facts[key] = v;
  }
  for (const key of ['shipment_cost','insurance_cost']) {
    const v = value[key] as {amount?: unknown; currency?: unknown} | undefined;
    if (v && typeof v.amount === 'number' && Number.isSafeInteger(Math.round(v.amount * 100)) && Math.abs(v.amount * 100 - Math.round(v.amount * 100)) < 0.00001 &&
        typeof v.currency === 'string' && /^[a-zA-Z]{3}$/.test(v.currency)) {
      facts[`${key}_cents`] = Math.round(v.amount * 100); facts[`${key}_currency`] = v.currency;
    }
  }
  const ids = ['id','payment_intent','charge','destination','transfer','label_id','shipment_id'].map(k => value[k])
    .map(v => typeof v === 'string' && /^[a-zA-Z0-9_-]{1,150}$/.test(v) ? v : null).filter((v): v is string => v !== null);
  const resultHash = recoveryDigest(JSON.stringify({ids,facts}));
  await createRecoveryEvidence(`${scope.admitted.installation.prefix}/observations/${provider}/responses/${scope.id}-${resultHash}.json`, {
    protocol: 'financial_recovery_effect_response_v1', invocationId: scope.id, epoch: scope.admitted.control.epoch,
    provider, operation, requestHash, objectIds: ids, facts, responseHash: resultHash, financialSettlement: 'not_asserted',
  }, scope.admitted.installation);
}
export function qualifiedFinancialRecoveryEnvironment(): RecoveryInstallation & {financialEnvironment:'test'|'live';stripePlatformAccountId:string} {
  const installation = recoveryInstallation();
  if (installation.financialEnvironment === 'unconfigured' || !installation.stripePlatformAccountId) {
    throw new FinancialRecoveryBlocked('financial_provider_unconfigured');
  }
  return {...installation,financialEnvironment:installation.financialEnvironment,stripePlatformAccountId:installation.stripePlatformAccountId};
}
export async function readFinancialRecoveryState(): Promise<{
  protocol: 'financial_recovery_status_v1'; mode: 'normal' | 'draining' | 'recovery' | 'unavailable'; epoch: string | null;
  previousEpoch: string | null; controlGeneration: string | null; admissionControlOpen: boolean; reason: string | null;
  sourceQualification: 'required_per_source'; drainState: 'not_measured'; reopeningAuthority: 'independent_iam';
}> {
  try {
    const qualified = await readFinancialRecoveryControl();
    return {protocol: 'financial_recovery_status_v1', mode: qualified.control.mode, epoch: qualified.control.epoch,
      previousEpoch: qualified.control.previousEpoch, controlGeneration: qualified.generation,
      admissionControlOpen: qualified.control.mode === 'normal' && qualified.control.financialEnvironment !== 'unconfigured',
      reason: qualified.control.financialEnvironment === 'unconfigured' ? 'financial_provider_unconfigured' : null,
      sourceQualification: 'required_per_source', drainState: 'not_measured', reopeningAuthority: 'independent_iam'};
  } catch (error) {
    return {protocol: 'financial_recovery_status_v1', mode: 'unavailable', epoch: null, previousEpoch: null, controlGeneration: null,
      admissionControlOpen: false, reason: error instanceof FinancialRecoveryBlocked ? error.reason : 'control_unavailable',
      sourceQualification: 'required_per_source', drainState: 'not_measured', reopeningAuthority: 'independent_iam'};
  }
}
export { FinancialRecoveryBlocked };
