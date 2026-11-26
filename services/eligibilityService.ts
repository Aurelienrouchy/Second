import { phase1HttpsCallable as httpsCallable } from '@/services/phase1Callable';
import { randomUUID } from 'expo-crypto';
import { auth, functions } from '@/config/firebaseConfig';
import { getAuthSessionGeneration, useAuthStore } from '@/store/authStore';
import {parseSellerActivityAdminOrigin} from '@/services/sellerActivityReviewService';
import type { OwnerEligibility, EligibilityRecorded, EligibilityReviewRecorded, EligibilityReviewDetail,
  EligibilityPage, EligibilityReview, AdminEligibilityReviewSummary, AdminEligibilityReviewDetail,
  DeclareSellerActivityInput, RequestEligibilityReviewInput, AddEligibilityReviewDetailsInput,
  FlagEligibilityInput, DecideEligibilityReviewInput, EligibilityReviewStatus, GetAdminEligibilityReviewInput,
  SellerActivityReceipt, SellerActivityAdmission, SellerActivityReference, SellerActivityRecorded, SellerActivityHistory,
  SellerActivityPageCursors, SellerActivityHistoryPage, AdminEligibilityRelatedSale, SellerActivityRelatedSwap, SellerActivityOriginalCommand } from '@/types/eligibility';

export const newEligibilityRequestId = (): string => randomUUID();
/** Guard both ends of every operation. A→B→A must not accept an earlier response. */
async function call<I, O>(uid: string, name: string, payload: I, assertContext?: () => void): Promise<O> {
  const generation = getAuthSessionGeneration();
  const current = () => auth.currentUser?.uid === uid && useAuthStore.getState().authenticatedUid === uid &&
    generation === getAuthSessionGeneration();
  if (!current()) throw Object.assign(new Error('La session a changé. Reconnectez-vous.'), { code: 'functions/unauthenticated' });
  assertContext?.();
  const result = await httpsCallable<I, O>(functions, name)(payload);
  if (!current()) throw Object.assign(new Error('La session a changé. Actualisez vos renseignements.'), { code: 'functions/unauthenticated' });
  assertContext?.();
  return result.data;
}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const unknownActivity = () => new Error('L’historique déclaratif ou sa source ne peut pas être vérifié. Relisez la même page.');
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function id(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 1500 || value.includes('/') || value !== value.trim() || value === '.' || value === '..' || /^__.*__$/.test(value)) throw unknownActivity();
  return value;
}
/** Request keys use the callable's historical text contract, not the document-ID contract. */
function requestKey(value: unknown, canonical = false): string {
  if (typeof value !== 'string' || value.length > 128 || !value.trim() || value.includes('/') || value.trim() === '.' || value.trim() === '..' ||
      canonical && value !== value.trim()) throw unknownActivity();
  return value;
}
function text(value: unknown, max = 8000): string {
  if (typeof value !== 'string' || value.length > max) throw unknownActivity(); return value;
}
function date(value: unknown): string | null {
  if (value === null) return null;
  const result = text(value, 40);
  if (!Number.isFinite(Date.parse(result)) || new Date(result).toISOString() !== result) throw unknownActivity(); return result;
}
const nullableText = (value: unknown, max = 8000) => value === null ? null : text(value, max);
function reference(value: unknown): SellerActivityReference | null {
  if (value === null) return null;
  if (!object(value) || value.collection !== 'eligibility_audit' && value.collection !== 'eligibility_profiles') throw unknownActivity();
  return {collection: value.collection, id: id(value.id)};
}
function originalCommand(value: unknown): SellerActivityOriginalCommand {
  if (!object(value) || Object.keys(value).some(key => !['kind','statementVersion','personalDeclarationAccepted','expectedVersion','requestId','quebecResidenceDeclaration','expectedUid'].includes(key)) ||
      value.kind !== 'personal' && value.kind !== 'professional' || value.personalDeclarationAccepted != null && typeof value.personalDeclarationAccepted !== 'boolean' ||
      value.kind === 'personal' && value.personalDeclarationAccepted !== true || value.kind === 'professional' && value.personalDeclarationAccepted === true || !hash(value.expectedVersion)) throw unknownActivity();
  let residence: DeclareSellerActivityInput['quebecResidenceDeclaration'];
  if (value.quebecResidenceDeclaration !== undefined) {
    const r = value.quebecResidenceDeclaration;
    if (!object(r) || Object.keys(r).sort().join(',') !== 'accepted,country,province,version' || r.version !== '2026-10-17.v1' || r.country !== 'CA' || r.province !== 'QC' || typeof r.accepted !== 'boolean') throw unknownActivity();
    residence = {version: r.version, country: r.country, province: r.province, accepted: r.accepted};
  }
  return {kind: value.kind, statementVersion: text(value.statementVersion, 200),
    ...(Object.hasOwn(value, 'personalDeclarationAccepted') ? {personalDeclarationAccepted: value.personalDeclarationAccepted as boolean | null} : {}),
    expectedVersion: value.expectedVersion, requestId: requestKey(value.requestId), ...(value.expectedUid !== undefined ? {expectedUid: id(value.expectedUid)} : {}),
    ...(residence ? {quebecResidenceDeclaration: residence} : {})};
}
export function parseSellerActivityReceipt(value: unknown, ownerId: string): SellerActivityReceipt {
  if (!object(value) || value.protocol !== 'seller_activity_declaration_v1' || value.ownerId !== ownerId || value.legalEffectiveDate !== null || value.legallyVerified !== false ||
      value.actorUid !== null && value.actorUid !== ownerId) throw unknownActivity();
  const common = {protocol: 'seller_activity_declaration_v1' as const, id: id(value.id), ownerId, actorUid: value.actorUid as string | null,
    recordedAt: date(value.recordedAt), legalEffectiveDate: null, legallyVerified: false as const};
  if (value.qualification === 'historical_incomplete') {
    if (['requestId','inputHash','receiptHash','command','statement','statementVersion','accepted','resultingDeclaration','previous'].some(key => value[key] !== null)) throw unknownActivity();
    return {...common, qualification: 'historical_incomplete', requestId: null, inputHash: null, receiptHash: null, command: null, statement: null,
      statementVersion: null, accepted: null, resultingDeclaration: null, previous: null};
  }
  if (value.qualification !== 'native_original' || value.actorUid !== ownerId || !hash(value.inputHash) || !hash(value.receiptHash) || value.accepted !== true || !object(value.resultingDeclaration)) throw unknownActivity();
  const command = originalCommand(value.command), d = value.resultingDeclaration;
  const recordedAt = date(d.recordedAt), statement = text(value.statement), statementVersion = text(value.statementVersion, 200);
  const canonicalRequestId = requestKey(value.requestId, true);
  if (!recordedAt || recordedAt !== common.recordedAt || command.requestId.trim() !== canonicalRequestId || command.statementVersion !== statementVersion || command.expectedUid !== undefined && command.expectedUid !== ownerId ||
      d.kind !== command.kind || d.statementVersion !== statementVersion || d.statement !== statement || d.ownerId !== ownerId || d.actorUid !== ownerId || d.accepted !== true ||
      d.personalDeclarationAccepted !== (command.personalDeclarationAccepted ?? null) ||
      d.recordedAtMs !== Date.parse(recordedAt) || typeof d.declarationVersion !== 'number' || !Number.isSafeInteger(d.declarationVersion) || d.declarationVersion < 1 || d.legalEffectiveDate !== null || d.legallyVerified !== false) throw unknownActivity();
  let previous: SellerActivityReceipt['previous'] = null;
  if (value.previous !== null) {
    if (!object(value.previous) || value.previous.hash !== null && !hash(value.previous.hash)) throw unknownActivity();
    previous = {qualification: text(value.previous.qualification, 100), reference: reference(value.previous.reference), hash: value.previous.hash as string | null};
  }
  return {...common, qualification: 'native_original', requestId: canonicalRequestId, inputHash: value.inputHash, receiptHash: value.receiptHash, command,
    statement, statementVersion, accepted: true, previous, resultingDeclaration: {kind: command.kind, statementVersion, statement, ownerId, actorUid: ownerId,
      accepted: true, personalDeclarationAccepted: command.personalDeclarationAccepted ?? null, recordedAt, recordedAtMs: Date.parse(recordedAt), declarationVersion: d.declarationVersion, legalEffectiveDate: null, legallyVerified: false}};
}
function admission(value: unknown, ownerId: string, kind: 'purchase' | 'swap', agreementId: string, phase?: 'proposal' | 'acceptance'): SellerActivityAdmission {
  if (!object(value) || value.protocol !== 'seller_activity_admission_capture_v1' || !object(value.agreement) || value.agreement.kind !== kind || value.agreement.id !== agreementId ||
      value.legalEffectiveDate !== null || value.legallyVerified !== false || !Array.isArray(value.parties)) throw unknownActivity();
  if (value.qualification === 'historical_incomplete') {
    if (value.parties.length || value.capturedAt !== null || value.captureHash !== null) throw unknownActivity();
    return {qualification: 'historical_incomplete', protocol: value.protocol, agreement: {kind, id: agreementId}, capturedAt: null, parties: [], captureHash: null, legalEffectiveDate: null, legallyVerified: false};
  }
  const capturedAt = date(value.capturedAt), p = value.parties[0], actualPhase = value.agreement.phase;
  if (value.qualification !== 'native_capture' || !capturedAt || !hash(value.captureHash) || value.parties.length !== 1 || !object(p) || p.ownerId !== ownerId || !object(p.activity) || !object(p.admission) ||
      p.activity.kind !== 'personal' || p.activity.legalEffectiveDate !== null || p.activity.legallyVerified !== false || p.admission.allowed !== true ||
      !(kind === 'purchase' ? actualPhase === 'shipping_reservation' || actualPhase === 'cash_agreement' : actualPhase === phase) ||
      typeof p.admission.scope !== 'string' || !['sell','new_paid_shipping','swap'].includes(p.admission.scope) || p.activity.declarationVersion !== null &&
        (typeof p.activity.declarationVersion !== 'number' || !Number.isSafeInteger(p.activity.declarationVersion) || p.activity.declarationVersion < 1) || p.activity.hash !== null && !hash(p.activity.hash)) throw unknownActivity();
  if (kind === 'swap' ? p.admission.scope !== 'swap' : p.admission.scope === 'swap') throw unknownActivity();
  return {qualification: 'native_capture', protocol: value.protocol, agreement: {kind, id: agreementId, phase: actualPhase as NonNullable<SellerActivityAdmission['agreement']['phase']>,
    sourceHash: nullableText(value.agreement.sourceHash, 200)}, capturedAt, captureHash: value.captureHash,
    parties: [{ownerId, activity: {kind: 'personal', statementVersion: nullableText(p.activity.statementVersion, 200), declarationVersion: p.activity.declarationVersion as number | null,
      recordedAt: date(p.activity.recordedAt), qualification: text(p.activity.qualification, 100), reference: reference(p.activity.reference), hash: p.activity.hash as string | null,
      legalEffectiveDate: null, legallyVerified: false}, admission: {scope: p.admission.scope as 'sell' | 'new_paid_shipping' | 'swap', allowed: true, policyVersion: text(p.admission.policyVersion, 200)}}],
    legalEffectiveDate: null, legallyVerified: false};
}
function page<T>(value: unknown, cursor: string | null | undefined, parse: (raw: unknown) => T): EligibilityPage<T> {
  if (!object(value) || !Array.isArray(value.items) || value.items.length > 20 || typeof value.hasMore !== 'boolean' || value.hasMore !== (value.cursor !== null)) throw unknownActivity();
  const next = value.cursor === null ? null : id(value.cursor);
  if (next && cursor && next <= cursor) throw unknownActivity();
  return {items: value.items.map(parse), cursor: next, hasMore: value.hasMore};
}
function currentEligibility(value: unknown): OwnerEligibility {
  if (!object(value) || !hash(value.version) || typeof value.policyVersion !== 'string' || !object(value.decisions)) throw unknownActivity();
  return value as unknown as OwnerEligibility;
}
function activityHistory(value: unknown, ownerId: string, cursors: SellerActivityPageCursors = {}): SellerActivityHistory {
  if (!object(value) || value.protocol !== 'seller_activity_history_page_v1' || !object(value.history) || value.history.coverage !== 'owner_audit_page' || !object(value.relatedSwaps)) throw unknownActivity();
  const history: SellerActivityHistoryPage = {...page(value.history, cursors.cursor, item => parseSellerActivityReceipt(item, ownerId)), coverage: 'owner_audit_page'};
  const relatedSales = page<AdminEligibilityRelatedSale>(value.relatedSales, cursors.relatedSalesCursor, item => {
    if (!object(item) || item.deliveryType !== null && item.deliveryType !== 'meetup' && item.deliveryType !== 'shipping') throw unknownActivity();
    const saleId = id(item.id);
    return {id: saleId, status: nullableText(item.status, 200), deliveryType: item.deliveryType as AdminEligibilityRelatedSale['deliveryType'], createdAt: date(item.createdAt), sellerActivityAdmission: admission(item.sellerActivityAdmission, ownerId, 'purchase', saleId)};
  });
  const swaps = (raw: unknown, cursor?: string | null) => page<SellerActivityRelatedSwap>(raw, cursor, item => {
    if (!object(item)) throw unknownActivity(); const swapId = id(item.id);
    return {id: swapId, status: nullableText(item.status, 200), createdAt: date(item.createdAt), acceptedAt: date(item.acceptedAt),
      proposal: admission(item.proposal, ownerId, 'swap', swapId, 'proposal'), acceptance: admission(item.acceptance, ownerId, 'swap', swapId, 'acceptance')};
  });
  return {protocol: 'seller_activity_history_page_v1', history, relatedSales, relatedSwaps: {initiated: swaps(value.relatedSwaps.initiated, cursors.initiatedSwapsCursor), received: swaps(value.relatedSwaps.received, cursors.receivedSwapsCursor)}, currentEligibility: currentEligibility(value.currentEligibility)};
}
function declarationRecorded(value: unknown, uid: string, input: DeclareSellerActivityInput): SellerActivityRecorded {
  if (!object(value) || value.recorded !== true || typeof value.alreadyRecorded !== 'boolean') throw unknownActivity();
  const original = parseSellerActivityReceipt(value.declarationReceipt, uid), eligibility = currentEligibility(value.eligibility), current = currentEligibility(value.currentEligibility);
  if (eligibility.version !== current.version || original.qualification === 'native_original' && (original.requestId !== requestKey(input.requestId).trim() || !original.command ||
      JSON.stringify(originalCommand(original.command)) !== JSON.stringify(originalCommand(input)))) throw unknownActivity();
  return {recorded: true, alreadyRecorded: value.alreadyRecorded, declarationReceipt: original, eligibility, currentEligibility: current};
}
export const EligibilityService = {
  getMine: (uid: string) => call<Record<string, never>, OwnerEligibility>(uid, 'getMyEligibility', {}),
  declareActivity: async (uid: string, input: DeclareSellerActivityInput): Promise<SellerActivityRecorded> => declarationRecorded(await call<typeof input, unknown>(uid, 'declareSellerActivity', {
    kind: input.kind, statementVersion: input.statementVersion, personalDeclarationAccepted: input.personalDeclarationAccepted,
    expectedVersion: input.expectedVersion, requestId: input.requestId,
    ...(input.expectedUid !== undefined ? {expectedUid: input.expectedUid} : {}),
    ...(input.quebecResidenceDeclaration !== undefined ? { quebecResidenceDeclaration: input.quebecResidenceDeclaration } : {}) }), uid, input),
  getActivityHistory: async (uid: string, cursors: SellerActivityPageCursors = {}, assertContext?: () => void): Promise<SellerActivityHistory> =>
    activityHistory(await call<Record<string, unknown>, unknown>(uid, 'getMyEligibility', {operation: 'seller_activity_history', expectedUid: uid,
      ...(cursors.cursor !== undefined ? {cursor: cursors.cursor} : {}), ...(cursors.relatedSalesCursor !== undefined ? {relatedSalesCursor: cursors.relatedSalesCursor} : {}),
      ...(cursors.initiatedSwapsCursor !== undefined ? {initiatedSwapsCursor: cursors.initiatedSwapsCursor} : {}),
      ...(cursors.receivedSwapsCursor !== undefined ? {receivedSwapsCursor: cursors.receivedSwapsCursor} : {})}, assertContext), uid, cursors),
  requestReview: (uid: string, input: RequestEligibilityReviewInput) => call<typeof input, EligibilityReviewRecorded>(uid, 'requestEligibilityReview', {
    kind: input.kind, scope: input.scope, reason: input.reason, expectedVersion: input.expectedVersion, requestId: input.requestId,
    ...(input.proposedDateOfBirth !== undefined ? { proposedDateOfBirth: input.proposedDateOfBirth } : {}),
    ...(input.priorReviewId !== undefined ? { priorReviewId: input.priorReviewId } : {}) }),
  addDetails: (uid: string, input: AddEligibilityReviewDetailsInput) => call<typeof input, EligibilityReviewRecorded>(uid, 'addEligibilityReviewDetails', {
    reviewId: input.reviewId, details: input.details, expectedRequestVersion: input.expectedRequestVersion,
    expectedVersion: input.expectedVersion, requestId: input.requestId }),
  getReview: (uid: string, reviewId: string, assertContext?: () => void) => call<{ reviewId: string }, EligibilityReviewDetail>(uid, 'getEligibilityReview', { reviewId }, assertContext),
  listMine: (uid: string, cursor?: string) => call<{ cursor?: string }, EligibilityPage<EligibilityReview>>(uid, 'listMyEligibilityReviews', cursor ? { cursor } : {}),
  listAdmin: (uid: string, status?: EligibilityReviewStatus, cursor?: string) =>
    call<{ status?: EligibilityReviewStatus; cursor?: string }, EligibilityPage<AdminEligibilityReviewSummary>>(uid, 'listAdminEligibilityReviews', {
      ...(status ? { status } : {}), ...(cursor ? { cursor } : {}) }),
  getAdminReview: async (uid: string, reviewId: string, relatedSalesCursor?: string | null, cursors: SellerActivityPageCursors = {}, assertContext?: () => void): Promise<AdminEligibilityReviewDetail> => {
    const raw = await call<GetAdminEligibilityReviewInput, unknown>(uid, 'getAdminEligibilityReview', {reviewId,
      ...(relatedSalesCursor !== undefined ? {relatedSalesCursor} : {}), ...(cursors.cursor !== undefined ? {activityHistoryCursor: cursors.cursor} : {}),
      ...(cursors.initiatedSwapsCursor !== undefined ? {initiatedSwapsCursor: cursors.initiatedSwapsCursor} : {}),
      ...(cursors.receivedSwapsCursor !== undefined ? {receivedSwapsCursor: cursors.receivedSwapsCursor} : {})}, assertContext);
    if (!object(raw) || !object(raw.request) || raw.request.id !== reviewId || !object(raw.signals)) throw unknownActivity();
    const ownerId = id(raw.request.ownerId), eligibility = currentEligibility(raw.eligibility);
    if (Object.hasOwn(raw.request, 'sellerActivityReview')) raw.request = {...raw.request, sellerActivityReview: parseSellerActivityAdminOrigin(raw.request.sellerActivityReview, raw.request.createdAt)};
    // Older response versions remain older. They gain no reconstructed history.
    if (raw.history === undefined && raw.relatedSwaps === undefined) return raw as unknown as AdminEligibilityReviewDetail;
    const history = activityHistory({protocol: 'seller_activity_history_page_v1', history: raw.history, relatedSales: raw.relatedSales,
      relatedSwaps: raw.relatedSwaps, currentEligibility: eligibility}, ownerId, {...cursors, relatedSalesCursor});
    return {request: raw.request as unknown as AdminEligibilityReviewDetail['request'], eligibility, signals: raw.signals as AdminEligibilityReviewDetail['signals'],
      relatedSales: history.relatedSales, history: history.history, relatedSwaps: history.relatedSwaps};
  },
  getAdminActivityHistory: async (uid: string, reviewId: string, ownerId: string, expectedVersion: string, expectedRequestVersion: number,
    cursors: SellerActivityPageCursors = {}, assertContext?: () => void): Promise<SellerActivityHistory> => {
    const result = await EligibilityService.getAdminReview(uid, reviewId, cursors.relatedSalesCursor, cursors, assertContext);
    assertContext?.();
    if (result.request.ownerId !== ownerId || result.request.requestVersion !== expectedRequestVersion || result.eligibility.version !== expectedVersion || !result.history || !result.relatedSwaps) throw unknownActivity();
    return {protocol: 'seller_activity_history_page_v1', history: result.history, relatedSales: result.relatedSales,
      relatedSwaps: result.relatedSwaps, currentEligibility: result.eligibility};
  },
  flag: (uid: string, input: FlagEligibilityInput) => call<typeof input, EligibilityRecorded & { signalId: string }>(uid, 'flagEligibilityForReview', {
    ownerId: input.ownerId, scope: input.scope, internalNote: input.internalNote, expectedVersion: input.expectedVersion, requestId: input.requestId }),
  decide: (uid: string, input: DecideEligibilityReviewInput) => call<typeof input, EligibilityReviewRecorded>(uid, 'decideEligibilityReview', {
    reviewId: input.reviewId, outcome: input.outcome, ownerReason: input.ownerReason, expectedVersion: input.expectedVersion,
    expectedRequestVersion: input.expectedRequestVersion, requestId: input.requestId,
    ...(input.internalNote !== undefined ? { internalNote: input.internalNote } : {}),
    ...(input.clearSignalIds !== undefined ? { clearSignalIds: input.clearSignalIds } : {}),
    ...(input.legalBasis !== undefined ? { legalBasis: input.legalBasis } : {}),
    ...(input.recourse !== undefined ? { recourse: input.recourse } : {}) }),
};
