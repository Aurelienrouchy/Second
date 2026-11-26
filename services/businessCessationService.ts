import { phase1HttpsCallable as httpsCallable } from '@/services/phase1Callable';
import { CryptoDigestAlgorithm, digest, digestStringAsync } from 'expo-crypto';
import { auth, functions } from '@/config/firebaseConfig';
import { captureTradeSession, assertTradeSessionCurrent, staleTradeOperation } from '@/services/tradeOperation';
import { purchaseRefundRecord as object, purchaseRefundExact as exact, purchaseRefundHash as hash, purchaseRefundIso as iso,
  purchaseRefundCanonical as canonical, purchaseRefundEqual as equal } from '@/utils/purchaseRefundContract';
import { isDeclaredSupportAccountId as uid } from '@/utils/supportAccountIdentity';
import { BUSINESS_CESSATION_CAPABILITY as capability, type BusinessCessationAccess as Access, type BusinessCessationCommand as Command,
  type BusinessCessationReference as Reference, type BusinessCessationReceipt as Receipt, type BusinessCessationStatus as Status,
  type BusinessCessationPlan as Plan, type BusinessCessationPage as Page, type BusinessCessationClaim as Claim,
  type BusinessCessationObligation as Obligation, type BusinessCessationExportTarget as ExportTarget,
  type BusinessCessationExport as Export, type BusinessCessationLane as Lane, type BusinessCessationOwnObligations as OwnObligations, type BusinessCessationDiscovery as Discovery } from '@/types/businessCessation';

const fail = () => new Error('Le dossier de continuité doit être relu avec sa référence exacte. Aucun règlement, arrêt commercial ou accès futur n’est confirmé par cette lecture.');
const count = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const text = (v: unknown, max = 2000): v is string => typeof v === 'string' && v.length > 0 && v.length <= max && !/[\u0000-\u001f\u007f]/.test(v);
const id = (v: unknown): v is string => text(v, 200) && v.trim() === v && !v.includes('/') && v !== '.' && v !== '..';
const named = (v: unknown, prefix: string): v is string => typeof v === 'string' && new RegExp(`^${prefix}_[a-f0-9]{64}$`).test(v);
const generation = (v: unknown): v is string => typeof v === 'string' && /^[1-9]\d{0,29}$/.test(v);
const nullableDate = (v: unknown) => v === null || iso(v);
const revision = (v: unknown) => v === null || typeof v === 'string' && /^\d+:\d{1,9}$/.test(v);
const contact = (v: unknown) => object(v) && exact(v, ['responsible', 'email', 'availabilityVerified']) && v.responsible === 'Direction Seconde' && v.email === 'privacy@seconde.app' && v.availabilityVerified === false;
const capture = (v: unknown) => object(v) && exact(v, ['seconds', 'nanoseconds']) && count(v.seconds) && v.seconds > 0 && count(v.nanoseconds) && v.nanoseconds < 1_000_000_000 && v.nanoseconds % 1000 === 0;
const commandActions = ['create_plan', 'advance_inventory', 'seal_inventory', 'export_next_page', 'seal_export', 'link_claim', 'export_claim'];
const belongs = (access: Access, action: Command['action']) => access === 'owner' ? ['link_claim', 'export_claim'].includes(action) : !['link_claim', 'export_claim'].includes(action);
const lanes: Lane[] = ['purchases', 'sales', 'swaps_initiated', 'swaps_received', 'withdrawals', 'wallet', 'support'];
const hashValue = (v: unknown) => digestStringAsync(CryptoDigestAlgorithm.SHA256, JSON.stringify(canonical(v)));
function guard(owner: string, callback: () => void) {
  const sdk = auth.currentUser, session = captureTradeSession(owner);
  const current = () => {assertTradeSessionCurrent(session); if (auth.currentUser !== sdk) throw staleTradeOperation(); callback();}; current(); return current;
}
export function isBusinessCessationObligation(v: unknown): v is Obligation {
  return object(v) && exact(v, ['kind', 'id']) && ['transaction', 'swap', 'withdrawal', 'wallet', 'support'].includes(String(v.kind)) && (v.kind === 'wallet' ? uid(v.id) : id(v.id));
}
export function isBusinessCessationCommand(v: unknown): v is Command {
  if (!object(v) || !commandActions.includes(String(v.action))) return false;
  if (v.action === 'create_plan') return exact(v, ['action', 'reason']) && typeof v.reason === 'string' && v.reason.trim() === v.reason && v.reason.length > 0 && v.reason.length <= 1500;
  if (!named(v.planId, 'bc')) return false;
  if (v.action === 'link_claim') return exact(v, ['action', 'planId', 'supportRequestId', 'reference']) && id(v.supportRequestId) && isBusinessCessationObligation(v.reference);
  if (v.action === 'export_claim') return exact(v, ['action', 'planId', 'claimId']) && named(v.claimId, 'cc');
  return exact(v, ['action', 'planId', 'expectedVersion']) && count(v.expectedVersion) && v.expectedVersion > 0;
}
export function isBusinessCessationReference(v: unknown, owner: string, access?: Access): v is Reference {
  return object(v) && exact(v, ['uid', 'access', 'requestId', 'inputHash']) && uid(owner) && v.uid === owner && ['admin', 'owner'].includes(String(v.access)) && (!access || v.access === access) &&
    typeof v.requestId === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(v.requestId) && hash(v.inputHash);
}
export function isBusinessCessationPlan(v: unknown): v is Plan {
  if (!object(v) || !exact(v, ['protocol', 'planId', 'version', 'createdBy', 'reason', 'capture', 'inventory', 'export', 'inventorySettlesObligations', 'allObligationsResolved', 'reserveFinancingVerified', 'independentArchiveRecorded', 'outsideAppFutureAvailabilityVerified', 'createdAt', 'updatedAt']) ||
    v.protocol !== 'business_cessation_plan_v1' || !named(v.planId, 'bc') || !count(v.version) || v.version < 1 || !uid(v.createdBy) || typeof v.reason !== 'string' || !v.reason || v.reason.length > 1500 || !capture(v.capture) || !object(v.inventory) || !object(v.export) ||
    !exact(v.inventory, ['sourceIndex', 'sourceCount', 'cursor', 'pageCount', 'rowCount', 'unknownCount', 'digest', 'complete']) || !exact(v.export, ['pageCount', 'digest', 'sealed', 'policyQualified'])) return false;
  const i = v.inventory, e = v.export;
  return ['sourceIndex', 'sourceCount', 'pageCount', 'rowCount', 'unknownCount'].every(k => count(i[k])) && Number(i.sourceCount) > 0 && Number(i.sourceIndex) <= Number(i.sourceCount) &&
    Number(i.unknownCount) <= Number(i.rowCount) && (i.cursor === null || text(i.cursor, 2000)) && hash(i.digest) && typeof i.complete === 'boolean' && (!i.complete || i.sourceIndex === i.sourceCount && i.cursor === null) &&
    count(e.pageCount) && e.pageCount <= Number(i.pageCount) && hash(e.digest) && typeof e.sealed === 'boolean' && typeof e.policyQualified === 'boolean' && (!e.sealed || i.complete && e.pageCount === i.pageCount && e.policyQualified) &&
    v.inventorySettlesObligations === false && v.allObligationsResolved === false && v.reserveFinancingVerified === false && v.independentArchiveRecorded === e.sealed && v.outsideAppFutureAvailabilityVerified === false && nullableDate(v.createdAt) && nullableDate(v.updatedAt);
}
async function rpc(owner: string, endpoint: 'readSupportRequests' | 'administerSupportRequest' | 'commandSupportRequest', body: Record<string, unknown>, current: () => void) {
  current(); const result = await httpsCallable<unknown, unknown>(functions, endpoint)({capability, expectedUid: owner, ...body}); current(); return result.data;
}
async function receipt(v: unknown, a: Reference, current: () => void): Promise<Receipt> {
  if (!object(v) || !exact(v, ['protocol', 'actorUid', 'requestId', 'inputHash', 'state', 'action', 'planId', 'claimId', 'resultingVersion', 'receiptHash', 'recordedAt', 'newCommerceActivated', 'financialEffectExecuted']) ||
    v.protocol !== 'business_cessation_receipt_v1' || v.actorUid !== a.uid || v.requestId !== a.requestId || v.inputHash !== a.inputHash || !['unrecorded', 'not_executed', 'pending', 'recorded'].includes(String(v.state)) ||
    v.action !== null && (!commandActions.includes(String(v.action)) || !belongs(a.access, v.action as Command['action'])) || v.planId !== null && !named(v.planId, 'bc') || v.claimId !== null && !named(v.claimId, 'cc') ||
    v.resultingVersion !== null && (!count(v.resultingVersion) || v.resultingVersion < 1) || v.receiptHash !== null && !hash(v.receiptHash) || !nullableDate(v.recordedAt) || v.newCommerceActivated !== false || v.financialEffectExecuted !== false) throw fail();
  if (v.state === 'unrecorded') {if (['action', 'planId', 'claimId', 'resultingVersion', 'receiptHash', 'recordedAt'].some(k => v[k] !== null)) throw fail();}
  else {
    const expected = await hashValue({actorUid: v.actorUid, requestId: v.requestId, inputHash: v.inputHash, state: v.state, action: v.action, planId: v.planId, claimId: v.claimId, resultingVersion: v.resultingVersion}); current(); if (expected !== v.receiptHash) throw fail();
    if (v.state === 'not_executed' ? ['action', 'planId', 'claimId', 'resultingVersion'].some(k => v[k] !== null) : v.action === null || v.planId === null) throw fail();
    if (v.state === 'pending' && !['export_next_page', 'seal_export', 'export_claim'].includes(String(v.action))) throw fail();
    if (v.action === 'create_plan' && v.planId !== `bc_${await hashValue([a.uid, a.requestId])}`) throw fail(); current();
  }
  return v as unknown as Receipt;
}
function exportedRow(v: unknown): boolean {
  return object(v) && exact(v, ['rowId', 'category', 'status', 'obligationState', 'responsible', 'recoveryRoutes', 'physicalCompletionVerified', 'financialSettlementVerified']) && hash(v.rowId) && text(v.category, 100) &&
    (v.status === null || text(v.status, 100)) && ['open', 'unknown'].includes(String(v.obligationState)) && v.responsible === 'Direction Seconde' && Array.isArray(v.recoveryRoutes) && v.recoveryRoutes.length <= 20 && v.recoveryRoutes.every(r => text(r, 100)) && v.physicalCompletionVerified === false && v.financialSettlementVerified === false;
}
/** Hash real bounded bytes before any local file is written or shared. */
async function verifyExport(v: Export, target: ExportTarget, owner: string, current: () => void) {
  const value = v.bytesBase64, alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  if (!value || value.length > 2_796_204 || value.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw fail();
  const size = value.length / 4 * 3 - (value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0), bytes = new Uint8Array(size); let offset = 0;
  for (let i = 0; i < value.length; i += 4) {const a = alphabet.indexOf(value[i]), b = alphabet.indexOf(value[i + 1]), c = value[i + 2] === '=' ? 0 : alphabet.indexOf(value[i + 2]), d = value[i + 3] === '=' ? 0 : alphabet.indexOf(value[i + 3]);
    if (value[i + 2] === '=' && (b & 15) !== 0 || value[i + 3] === '=' && value[i + 2] !== '=' && (c & 3) !== 0) throw fail();
    bytes[offset++] = a << 2 | b >> 4; if (offset < size) bytes[offset++] = b << 4 | c >> 2; if (offset < size) bytes[offset++] = c << 6 | d;
  }
  try {
    const computed = Array.from(new Uint8Array(await digest(CryptoDigestAlgorithm.SHA256, bytes)), b => b.toString(16).padStart(2, '0')).join(''); current(); if (computed !== v.contentHash) throw fail();
    const parsed: unknown = JSON.parse(decodeURIComponent(Array.from(bytes, b => `%${b.toString(16).padStart(2, '0')}`).join('')));
    if (!object(parsed) || parsed.planId !== target.planId || parsed.containsPrivateEvidence !== false || !contact(parsed.contact)) throw fail();
    if (target.kind === 'claim') {
      if (!exact(parsed, ['protocol', 'claimId', 'planId', 'ownerUid', 'supportRequestId', 'reference', 'sourceHash', 'sourceRevision', 'recordedAt', 'contact', 'obligationResolved', 'financialEffectExecuted', 'containsPrivateEvidence']) ||
        parsed.protocol !== 'business_cessation_claim_archive_v1' || parsed.claimId !== target.claimId || parsed.ownerUid !== owner || !id(parsed.supportRequestId) || !isBusinessCessationObligation(parsed.reference) || !hash(parsed.sourceHash) || !revision(parsed.sourceRevision) || !iso(parsed.recordedAt) || parsed.obligationResolved !== false || parsed.financialEffectExecuted !== false) throw fail();
    } else if (!exact(parsed, ['protocol', 'planId', 'capture', 'pageNumber', 'category', 'inventoryPageDigest', 'rows', 'contact', 'reserveFinancingVerified', 'allObligationsResolved', 'containsPrivateEvidence']) || parsed.protocol !== 'business_cessation_expurgated_archive_v1' || parsed.pageNumber !== target.pageNumber || !capture(parsed.capture) || !text(parsed.category, 100) || !hash(parsed.inventoryPageDigest) || !Array.isArray(parsed.rows) || parsed.rows.length > 20 || !parsed.rows.every(exportedRow) || parsed.reserveFinancingVerified !== false || parsed.allObligationsResolved !== false) throw fail();
    current();
  } finally {bytes.fill(0);}
}
async function checkedClaim(v: unknown, owner: string, claimId: string, current: () => void): Promise<Claim> {
  if (!object(v) || !exact(v, ['protocol', 'claimId', 'planId', 'ownerUid', 'supportRequestId', 'reference', 'sourceHash', 'sourceRevision', 'status', 'contact', 'recordedAt', 'obligationResolved', 'financialEffectExecuted', 'archive']) || v.protocol !== 'business_cessation_claim_v1' || v.claimId !== claimId || !named(v.planId, 'bc') || v.ownerUid !== owner || !id(v.supportRequestId) || !isBusinessCessationObligation(v.reference) || !hash(v.sourceHash) || !revision(v.sourceRevision) || v.status !== 'recorded_for_servicing' || !contact(v.contact) || !nullableDate(v.recordedAt) || v.obligationResolved !== false || v.financialEffectExecuted !== false || !object(v.archive) || !exact(v.archive, ['state', 'contentHash', 'generation']) || !['not_recorded', 'pending', 'recorded'].includes(String(v.archive.state)) || (v.archive.state === 'recorded' ? !hash(v.archive.contentHash) || !generation(v.archive.generation) : v.archive.contentHash !== null || v.archive.generation !== null)) throw fail();
    if (claimId !== `cc_${await hashValue([owner, v.planId, v.supportRequestId, v.reference])}`) throw fail(); current(); return v as unknown as Claim;
}

export const BusinessCessationService = {
  async status(owner: string, callback: () => void): Promise<Status> {
    const current = guard(owner, callback), v = await rpc(owner, 'readSupportRequests', {mode: 'status'}, current);
    if (!object(v) || !exact(v, ['protocol', 'newCommerce', 'reason', 'controlGeneration', 'planId', 'servicingIndependentlyGuarded', 'declaredContact', 'reserveFinancingVerified', 'cessationActivatedByThisRequest']) || v.protocol !== 'business_cessation_status_v1' || !['open', 'stop_new', 'unqualified'].includes(String(v.newCommerce)) || v.reason !== null && !text(v.reason) || v.controlGeneration !== null && !generation(v.controlGeneration) || v.planId !== null && !named(v.planId, 'bc') || v.servicingIndependentlyGuarded !== true || !contact(v.declaredContact) || v.reserveFinancingVerified !== false || v.cessationActivatedByThisRequest !== false) throw fail();
    current(); return v as unknown as Status;
  },
  async plan(owner: string, planId: string, callback: () => void): Promise<Plan> {
    const current = guard(owner, callback); if (!named(planId, 'bc')) throw fail(); const v = await rpc(owner, 'readSupportRequests', {mode: 'plan', planId}, current); if (!isBusinessCessationPlan(v) || v.planId !== planId) throw fail(); current(); return v;
  },
  async page(owner: string, plan: Plan, pageNumber: number, callback: () => void): Promise<Page> {
    const current = guard(owner, callback); if (!isBusinessCessationPlan(plan) || !count(pageNumber) || pageNumber >= plan.inventory.pageCount) throw fail();
    const v = await rpc(owner, 'readSupportRequests', {mode: 'inventory_page', planId: plan.planId, pageNumber}, current);
    if (!object(v) || !exact(v, ['protocol', 'planId', 'pageNumber', 'category', 'capture', 'previousDigest', 'digest', 'rows', 'knownSourcesOnly']) || v.protocol !== 'business_cessation_page_v1' || v.planId !== plan.planId || v.pageNumber !== pageNumber || !text(v.category, 100) || !equal(v.capture, plan.capture) || !hash(v.previousDigest) || !hash(v.digest) || v.knownSourcesOnly !== true || !Array.isArray(v.rows) || v.rows.length > 20 || !v.rows.every(row => object(row) && exact(row, ['rowId', 'category', 'sourceRef', 'sourceHash', 'sourceRevision', 'status', 'obligationState', 'responsible', 'recoveryRoutes', 'physicalCompletionVerified', 'financialSettlementVerified']) && exportedRow(Object.fromEntries(Object.keys(row).filter(k => !['sourceRef', 'sourceHash', 'sourceRevision'].includes(k)).map(k => [k, row[k]]))) && row.category === v.category && text(row.sourceRef, 2000) && hash(row.sourceHash) && revision(row.sourceRevision))) throw fail();
    if (v.digest !== await hashValue({planId: v.planId, pageNumber: v.pageNumber, category: v.category, capture: v.capture, previousDigest: v.previousDigest, rows: v.rows})) throw fail(); current(); return v as unknown as Page;
  },
  async claim(owner: string, claimId: string, callback: () => void): Promise<Claim> {
    const current = guard(owner, callback); if (!named(claimId, 'cc')) throw fail(); const v = await rpc(owner, 'readSupportRequests', {mode: 'claim', claimId}, current);
    return checkedClaim(v, owner, claimId, current);
  },
  async obligations(owner: string, lane: Lane, cursor: string | null, callback: () => void): Promise<OwnObligations> {
    const current = guard(owner, callback); if (!lanes.includes(lane) || cursor !== null && !uid(cursor)) throw fail(); const v = await rpc(owner, 'readSupportRequests', {mode: 'own_obligations', lane, cursor}, current);
    const kind = lane === 'purchases' || lane === 'sales' ? 'transaction' : lane.startsWith('swaps_') ? 'swap' : lane === 'withdrawals' ? 'withdrawal' : lane;
    if (!object(v) || !exact(v, ['protocol', 'lane', 'items', 'cursor', 'hasMore', 'claimPermissionGranted']) || v.protocol !== 'business_cessation_own_obligations_v1' || v.lane !== lane || !Array.isArray(v.items) || v.items.length > 20 || typeof v.hasMore !== 'boolean' || (v.cursor !== null && !uid(v.cursor)) || v.hasMore && v.cursor === null || v.claimPermissionGranted !== false || !v.items.every(item => object(item) && exact(item, ['reference', 'status', 'recordedAt', 'amountCents', 'currency', 'sourceHash', 'sourceRevision']) && isBusinessCessationObligation(item.reference) && item.reference.kind === kind && (kind !== 'wallet' || item.reference.id === owner) && (item.status === null || text(item.status, 100)) && nullableDate(item.recordedAt) && (item.amountCents === null || count(item.amountCents)) && (item.currency === null || item.currency === 'CAD') && hash(item.sourceHash) && revision(item.sourceRevision))) throw fail();
    if (new Set(v.items.map(item => JSON.stringify((item as {reference: Obligation}).reference))).size !== v.items.length || cursor !== null && v.hasMore && v.cursor === cursor) throw fail(); current(); return v as unknown as OwnObligations;
  },
  async discover(owner: string, access: Access, cursor: string | null, callback: () => void): Promise<Discovery> {
    const current = guard(owner, callback), validCursor = (v: unknown): v is string => typeof v === 'string' && /^bcd_[A-Za-z0-9_-]+$/.test(v) && v.length < 1000;
    if (!['admin', 'owner'].includes(access) || cursor !== null && !validCursor(cursor)) throw fail();
    const mode = access === 'admin' ? 'plans' : 'own_claims', v = await rpc(owner, 'readSupportRequests', {mode, cursor}, current);
    if (!object(v) || !exact(v, ['protocol', 'items', 'cursor', 'hasMore']) || v.protocol !== (access === 'admin' ? 'business_cessation_plans_v1' : 'business_cessation_own_claims_v1') || !Array.isArray(v.items) || v.items.length > 20 || typeof v.hasMore !== 'boolean' || v.cursor !== null && !validCursor(v.cursor) || v.hasMore && v.cursor === null || v.hasMore && v.cursor === cursor) throw fail();
    if (access === 'admin') {
      if (!v.items.every(isBusinessCessationPlan) || new Set(v.items.map(p => p.planId)).size !== v.items.length) throw fail();
      current(); return v as unknown as Discovery;
    }
    const items: Claim[] = [];
    for (const item of v.items) {if (!object(item) || !named(item.claimId, 'cc')) throw fail(); items.push(await checkedClaim(item, owner, item.claimId, current)); current();}
    if (new Set(items.map(c => c.claimId)).size !== items.length) throw fail(); current(); return {...v, items} as unknown as Discovery;
  },
  async reference(owner: string, access: Access, requestId: string, command: Command, callback: () => void): Promise<Reference> {
    const current = guard(owner, callback); if (!isBusinessCessationCommand(command) || !belongs(access, command.action)) throw fail(); const inputHash = await hashValue(command); current(); const a = {uid: owner, access, requestId, inputHash}; if (!isBusinessCessationReference(a, owner, access)) throw fail(); return a;
  },
  async command(a: Reference, mode: 'execute' | 'observe' | 'neutralize' | 'resume', callback: () => void, command?: Command): Promise<Receipt> {
    const current = guard(a.uid, callback); if (!isBusinessCessationReference(a, a.uid)) throw fail();
    if (mode === 'execute' && (!command || !equal(a, await this.reference(a.uid, a.access, a.requestId, command, current)))) throw fail(); current();
    const endpoint = mode === 'observe' ? 'readSupportRequests' : a.access === 'admin' ? 'administerSupportRequest' : 'commandSupportRequest';
    const v = await receipt(await rpc(a.uid, endpoint, {mode, requestId: a.requestId, inputHash: a.inputHash, ...(mode === 'execute' ? {command} : {})}, current), a, current); current(); return v;
  },
  async export(owner: string, target: ExportTarget, callback: () => void): Promise<Export> {
    const current = guard(owner, callback); if (!named(target.planId, 'bc') || (target.kind === 'claim' ? !named(target.claimId, 'cc') : !count(target.pageNumber))) throw fail();
    const v = await rpc(owner, 'readSupportRequests', target.kind === 'claim' ? {mode: 'claim_export_read', claimId: target.claimId} : {mode: 'export_read', planId: target.planId, pageNumber: target.pageNumber}, current);
    if (!object(v) || !exact(v, ['protocol', 'planId', ...(target.kind === 'claim' ? ['claimId'] : ['pageNumber']), 'contentHash', 'generation', 'bytesBase64', 'mimeType', 'independentArchiveRecorded', 'outsideAppFutureAvailabilityVerified', 'containsPrivateEvidence']) ||
      v.protocol !== (target.kind === 'claim' ? 'business_cessation_claim_export_read_v1' : 'business_cessation_export_read_v1') || v.planId !== target.planId || (target.kind === 'claim' ? v.claimId !== target.claimId : v.pageNumber !== target.pageNumber) || !hash(v.contentHash) || !generation(v.generation) || typeof v.bytesBase64 !== 'string' || v.mimeType !== 'application/json' || v.independentArchiveRecorded !== true || v.outsideAppFutureAvailabilityVerified !== false || v.containsPrivateEvidence !== false) throw fail();
    const result = v as unknown as Export; await verifyExport(result, target, owner, current); current(); return result;
  },
};
