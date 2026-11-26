import { phase1HttpsCallable as httpsCallable } from '@/services/phase1Callable';
import {CryptoDigestAlgorithm, digestStringAsync, digest} from 'expo-crypto';
import {functions} from '@/config/firebaseConfig';
import {assertTradeSessionCurrent, captureTradeSession} from '@/services/tradeOperation';
import {SELLER_TAX_CAPABILITY, SELLER_TAX_ASSISTANCE_REASONS} from '@/types/sellerTax';
import type {SellerTaxAttempt, SellerTaxCommand, SellerTaxScope, SellerTaxResponse, SellerTaxCollection,
  SellerTaxDocument, SellerTaxReceipt, SellerTaxDocumentReference, SellerTaxEvidenceReference, SellerTaxSource, SellerTaxSourceOwner,
  SellerTaxCaptureReference, SellerTaxCapture, SellerTaxPrivateCopy, SellerTaxPrivateCreditNote} from '@/types/sellerTax';

type Check = (value: unknown) => boolean;
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const shape = (v: unknown, fields: Record<string, Check>) => object(v) && Object.keys(v).length === Object.keys(fields).length &&
  Object.keys(v).every(k => Object.hasOwn(fields, k) && fields[k](v[k]));
const optionalShape = (v: unknown, fields: Record<string, Check>, optional: Record<string, Check>) => object(v) &&
  shape(v, {...fields, ...Object.fromEntries(Object.entries(optional).filter(([k]) => Object.hasOwn(v, k)))});
const one = (...values: readonly unknown[]): Check => v => values.includes(v);
const nullable = (check: Check): Check => v => v === null || check(v);
const array = (check: Check, max = 500): Check => v => Array.isArray(v) && v.length <= max && v.every(check);
const integer = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v);
const count = (v: unknown): v is number => integer(v) && v >= 0;
const bool = (v: unknown) => typeof v === 'boolean';
const no = one(false), yes = one(true);
export const sellerTaxId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 128 && !v.includes('/') && !['.', '..'].includes(v);
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const rid = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(v);
const iso = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const code = (v: unknown): v is string => typeof v === 'string' && /^[a-z0-9_]{1,200}$/.test(v);
const year = (v: unknown): v is number => integer(v) && v >= 2024 && v <= new Date().getUTCFullYear() + 1;
const nativeDocument = (v: unknown) => typeof v === 'string' && /^taxdoc_[a-f0-9]{64}$/.test(v);
const documentFields = {id: nativeDocument, contentHash: hash};
export const isSellerTaxDocumentReference = (v: unknown): v is SellerTaxDocumentReference => shape(v, documentFields);
export const isSellerTaxCaptureReference = (v: unknown): v is SellerTaxCaptureReference => shape(v, {id: x => typeof x === 'string' && /^capture_[a-f0-9]{64}$/.test(x), scopeHash: hash});
const readTime = (v: unknown) => shape(v, {seconds: x => count(x) && x > 0, nanoseconds: x => count(x) && x < 1e9 && x % 1000 === 0});
export const isSellerTaxEvidenceReference = (v: unknown): v is SellerTaxEvidenceReference => shape(v, {artifactId: hash,
  generation: x => typeof x === 'string' && /^[0-9]{1,30}$/.test(x), contentHash: hash});
export const isSellerTaxSource = (v: unknown): v is SellerTaxSource => object(v) && shape(v, v.kind === 'purchase_refund'
  ? {kind: one('purchase_refund'), id: sellerTaxId, refundIntentId: sellerTaxId} : {kind: one('purchase', 'swap'), id: sellerTaxId});
const actions = ['operator_record', 'identity_record', 'evidence_event', 'ingest', 'scan', 'snapshot', 'assistance', 'declaration_prepare', 'filing_record', 'copy_record', 'copy_ack', 'credit_note_record', 'annual_capture_prepare', 'annual_capture_advance'] as const;
const commandVariants: Record<SellerTaxCommand['action'], Record<string, Check>> = {
  operator_record: {evidenceReference: isSellerTaxEvidenceReference}, identity_record: {evidenceReference: isSellerTaxEvidenceReference},
  evidence_event: {source: isSellerTaxSource, evidenceReference: isSellerTaxEvidenceReference},
  ingest: {source: isSellerTaxSource}, scan: {}, snapshot: {}, assistance: {reasonCode: one(...SELLER_TAX_ASSISTANCE_REASONS)},
  declaration_prepare: {kind: one('original', 'corrective', 'cancelled'), previousDeclaration: nullable(isSellerTaxDocumentReference)},
  filing_record: {declaration: isSellerTaxDocumentReference, evidenceReference: isSellerTaxEvidenceReference},
  copy_record: {declaration: isSellerTaxDocumentReference, evidenceReference: isSellerTaxEvidenceReference},
  copy_ack: {declaration: isSellerTaxDocumentReference, delivery: isSellerTaxDocumentReference},
  credit_note_record: {source: v => isSellerTaxSource(v) && v.kind === 'purchase_refund', evidenceReference: isSellerTaxEvidenceReference},
  annual_capture_prepare: {}, annual_capture_advance: {captureReference: isSellerTaxCaptureReference},
};
export function isSellerTaxScope(v: unknown): v is SellerTaxScope {
  return shape(v, {access: one('owner', 'admin'), subject: one('seller', 'operator'), ownerId: nullable(sellerTaxId), year}) && object(v) &&
    (v.subject === 'operator' ? v.access === 'admin' && v.ownerId === null : sellerTaxId(v.ownerId));
}
export function isSellerTaxCommand(v: unknown, scope: SellerTaxScope): v is SellerTaxCommand {
  if (!object(v) || typeof v.action !== 'string' || !Object.hasOwn(commandVariants, v.action) ||
      !optionalShape(v, {action: one(v.action), expectedVersion: count, ...commandVariants[v.action as SellerTaxCommand['action']]},
        ['snapshot', 'declaration_prepare'].includes(v.action) ? {captureReference: isSellerTaxCaptureReference} : {})) return false;
  if (scope.subject === 'operator') return scope.access === 'admin' && v.action === 'operator_record';
  if (v.action === 'operator_record' || scope.access === 'owner' && ['declaration_prepare', 'filing_record', 'copy_record', 'credit_note_record'].includes(v.action) ||
      scope.access === 'admin' && ['assistance', 'copy_ack'].includes(v.action)) return false;
  return v.action !== 'declaration_prepare' || (v.kind === 'original') === (v.previousDeclaration === null);
}
function canonical(v: unknown): unknown {return Array.isArray(v) ? v.map(canonical) : object(v)
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;}
export const sellerTaxEqual = (a: unknown, b: unknown) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
export const sellerTaxHash = (v: unknown) => digestStringAsync(CryptoDigestAlgorithm.SHA256, JSON.stringify(canonical(v)));
export const sellerTaxFailure = () => new Error('Le dossier fiscal, sa source ou le reçu exact ne peut pas être confirmé. Conservez la même commande et relisez-la.');
export function isSellerTaxAttempt(v: unknown, uid: string): v is SellerTaxAttempt {
  return object(v) && shape(v, {version: one(1), uid: one(uid), scope: isSellerTaxScope, requestId: rid, command: object, inputHash: hash}) &&
    sellerTaxId(uid) && isSellerTaxScope(v.scope) && isSellerTaxCommand(v.command, v.scope) && (v.scope.access !== 'owner' || v.scope.ownerId === uid);
}
const scan = (v: unknown) => shape(v, {phase: one('sales', 'initiated', 'received', 'done'), cursor: nullable(sellerTaxId),
  refundQueue: array(x => shape(x, {transactionId: sellerTaxId, cursor: nullable(sellerTaxId)}), 10), pages: count, closed: bool, issues: array(code, 200)}) &&
  object(v) && (v.closed !== true || v.phase === 'done' && Array.isArray(v.refundQueue) && v.refundQueue.length === 0);
const operatorFields = {status: one('documented_reporting_operator', 'documented_excluded_operator', 'unknown'), legalName: one('Seconde Technologies inc.'),
  identityAvailable: bool, timeZone: one('UTC', 'America/Toronto'), policyVersion: one('ca_dpi_goods_2026_01'), purpose: one('part_xx_reporting'),
  gstRegistrationDocumented: bool, qstRegistrationDocumented: bool, externalAssessmentVerified: no};
const identityFields = {personKind: one('individual'), identityDocumented: bool,
  residenceJurisdictions: array(x => typeof x === 'string' && /^[A-Z]{2}$/.test(x), 10),
  identifierStatus: one('external_identifier_documented', 'exception_documented', 'missing'),
  exceptionReason: nullable(one('jurisdiction_does_not_issue', 'jurisdiction_does_not_require_collection', 'government_verification_service')),
  completeForPreparation: bool, externalIdentityVerified: no, taxIdentifierValueAvailableInApp: no};
const operator = (v: unknown) => shape(v, operatorFields), identity = (v: unknown) => shape(v, identityFields);
const ref = isSellerTaxDocumentReference;
const scopeFields = {protocol: one(SELLER_TAX_CAPABILITY), subject: one('seller', 'operator'), ownerId: nullable(sellerTaxId), year};
function caseView(v: unknown, scope: SellerTaxScope) {
  if (!object(v) || v.subject !== scope.subject || v.ownerId !== scope.ownerId || v.year !== scope.year) return false;
  if (v.opaque === true) return shape(v, {...scopeFields, opaque: yes});
  return shape(v, {...scopeFields, opaque: no, version: count, operator: nullable(x => shape(x, {...operatorFields, versionHash: hash})),
    identity: nullable(x => shape(x, {...identityFields, versionHash: hash, operatorVersionHash: hash})), lastSnapshot: nullable(ref), lastDeclaration: nullable(ref),
    scan, createdAt: nullable(iso), fiscalFactsAreCertified: no, filingPerformedByApplication: no, taxRegistrationCertified: no,
    financialEffectAuthorized: no, administrativeView: one(scope.access === 'admin')}) && (scope.subject === 'operator' || v.operator === null);
}
function receipt(v: unknown): v is SellerTaxReceipt {
  if (!shape(v, {protocol: one('seller_tax_command_v1'), actorId: sellerTaxId, requestId: rid, inputHash: hash, subject: one('seller', 'operator'), ownerId: nullable(sellerTaxId), year,
    action: one(...actions), status: one('pending', 'completed', 'not_executed', 'unknown'), versionBefore: count, versionAfter: count,
    documentReference: nullable(ref), reason: nullable(code), recordedAt: iso, completedAt: nullable(iso), financialEffectAuthorized: no, authorityFilingPerformed: no}) || !object(v)) return false;
  return v.status === 'completed' ? Number(v.versionAfter) === Number(v.versionBefore) + 1 && ref(v.documentReference) && iso(v.completedAt) && String(v.completedAt) >= String(v.recordedAt)
    : v.versionAfter === v.versionBefore && v.documentReference === null && (v.status === 'not_executed' ? iso(v.completedAt) && String(v.completedAt) >= String(v.recordedAt) : v.completedAt === null);
}
const quarter = (v: unknown) => shape(v, {quarter: one(1, 2, 3, 4), grossConsiderationCents: integer, adjustmentsCents: integer,
  considerationCents: integer, platformFeesCents: integer, platformTaxesCents: integer, activityCount: count});
function summary(v: unknown): boolean {
  if (!object(v)) return false;
  const captured = v.nativeEventSnapshotVerified === true;
  if (!shape(v, {protocol: one('seller_tax_annual_summary_v1'), ownerId: sellerTaxId, year, currency: one('CAD'), timeZone: one('UTC', 'America/Toronto', 'unqualified'),
    policyVersion: one('ca_dpi_goods_2026_01'), quarters: array(quarter, 4), annualActivityCount: nullable(count), annualConsiderationCents: nullable(count),
    smallGoodsExclusionCandidate: nullable(bool), activityCountBasis: one('one_native_agreement_per_seller'), exclusionDoesNotDetermineProfessionalStatus: yes,
    qualification: one('unknown', captured ? 'fixed_native_sources' : 'recorded_events_only'), issues: array(code, 1000), sourceReferences: array(x => shape(x, {eventId: sellerTaxId, bodyHash: hash, versionHash: hash, currentObservationHash: hash}), captured ? 0 : 500),
    eventSetHash: hash, completeSourceUniverseVerified: no, nativeEventSnapshotVerified: one(captured), withdrawalsOrReleasesCounted: no, eventsInspected: count,
    hasMore: captured ? no : bool, nextCursor: captured ? one(null) : nullable(sellerTaxId),
    ...captured ? {captureReference: isSellerTaxCaptureReference, nativeReadTime: readTime, knownNativeSourceSetClosed: yes, legalSourceUniverseVerified: no} : {}}) || !Array.isArray(v.quarters) || v.quarters.length !== 4 ||
      !v.quarters.every((q: unknown, i: number) => object(q) && q.quarter === i + 1) || v.hasMore !== (v.nextCursor !== null)) return false;
  if (v.qualification === 'unknown') return v.annualActivityCount === null && v.annualConsiderationCents === null && v.smallGoodsExclusionCandidate === null;
  return count(v.annualActivityCount) && count(v.annualConsiderationCents) && typeof v.smallGoodsExclusionCandidate === 'boolean' &&
    v.smallGoodsExclusionCandidate === (v.annualActivityCount < 30 && v.annualConsiderationCents <= 280000) && Array.isArray(v.issues) && v.issues.length === 0;
}
export function isSellerTaxCapture(v: unknown): v is SellerTaxCapture {
  if (!shape(v, {protocol: one('seller_tax_annual_capture_v1'), ownerId: sellerTaxId, year, reference: isSellerTaxCaptureReference,
    status: one('capturing', 'complete', 'unavailable'), reason: nullable(one('native_read_time_expired_or_unavailable')), version: count, readTime,
    context: x => shape(x, {operatorVersionHash: nullable(hash), operatorStatus: one('documented_reporting_operator', 'documented_excluded_operator', 'unknown'),
      timeZone: one('UTC', 'America/Toronto', 'unqualified'), identityVersionHash: nullable(hash), identityReady: bool, policyVersion: one('ca_dpi_goods_2026_01')}),
    pages: count, cursor: x => shape(x, {phase: one('events', 'sales', 'initiated', 'received', 'ledger', 'done'), lastId: nullable(sellerTaxId),
      refundQueue: array(j => shape(j, {transactionId: sellerTaxId, lastId: nullable(sellerTaxId)}), 10)}),
    sourcesInspected: count, unknownSources: count, otherYearSources: count, entriesHash: hash, summary: nullable(summary), knownNativeSourcesOnly: yes,
    legalSourceUniverseVerified: no, authorityReadMode: one('current'), financialEffectAuthorized: no}) || !object(v)) return false;
  if ((v.status === 'unavailable') !== (v.reason !== null) || (v.status === 'complete') !== (v.summary !== null)) return false;
  return v.summary === null || object(v.summary) && v.summary.nativeEventSnapshotVerified === true && v.summary.ownerId === v.ownerId && v.summary.year === v.year &&
    sellerTaxEqual(v.summary.captureReference, v.reference) && sellerTaxEqual(v.summary.nativeReadTime, v.readTime) && v.summary.eventSetHash === v.entriesHash &&
    v.summary.eventsInspected === v.sourcesInspected && object(v.cursor) && v.cursor.phase === 'done' && Array.isArray(v.cursor.refundQueue) && v.cursor.refundQueue.length === 0;
}
const event = (v: unknown) => shape(v, {protocol: one('seller_tax_event_body_v1'), ownerId: sellerTaxId, source: isSellerTaxSource,
  activityReference: x => typeof x === 'string' && x.length > 0 && x.length <= 150, eventKind: one('paid_or_credited', 'original_period_adjustment'), currency: one('CAD'),
  effectiveAt: nullable(iso), adjustmentRecordedAt: nullable(iso), grossConsiderationCents: nullable(count), platformFeesCents: nullable(count), platformTaxesCents: nullable(count),
  considerationDeltaCents: nullable(integer), walletCreditCents: nullable(count), debtOffsetCents: nullable(count), activityCountImpact: one(0, 1), originalEventId: nullable(sellerTaxId),
  buyerPaymentRecordedAt: nullable(iso), nonMonetaryValueCents: nullable(count), financialAccountValueIncluded: no});
const evidence = (v: unknown) => shape(v, {purpose: one('operator', 'identity', 'filing', 'delivery', 'credit_note', 'valuation', 'coverage'),
  reference: isSellerTaxEvidenceReference, contentHash: hash, generation: x => typeof x === 'string' && /^\d{1,30}$/.test(x), issuedAt: iso, externalAuthenticityVerified: no}) &&
  object(v) && object(v.reference) && v.reference.contentHash === v.contentHash && v.reference.generation === v.generation;
const snapshotFields = {summary, operatorVersionHash: nullable(hash), operatorQualification: one('documented_reporting_operator', 'documented_excluded_operator', 'unknown'),
  identityVersionHash: nullable(hash), identityReady: bool, sourceScan: scan, refundHistoryCoverageVerified: bool};
const declarationFields = {declaration: ref, declarationKind: one('original', 'corrective', 'cancelled'), documentReferenceId: x => typeof x === 'string' && /^SECONDE_[a-f0-9]{64}$/.test(x)} satisfies Record<string, Check>;
const eventFields = {eventId: sellerTaxId, event, eventBodyHash: hash, qualification: one('native_fact', 'documented_evidence', 'unknown'), reason: code, source: isSellerTaxSource};
const documentVariants: Record<SellerTaxCommand['action'], Record<string, Check>> = {
  operator_record: {operator}, identity_record: {identity, operatorVersionHash: hash}, ingest: eventFields, evidence_event: eventFields,
  scan: {scan, events: array(sellerTaxId, 30), liveSourceSnapshotVerified: no, refundHistoryCoverageVerified: bool}, snapshot: snapshotFields,
  declaration_prepare: {...snapshotFields, declarationKind: one('original', 'corrective', 'cancelled'), previousDeclaration: nullable(ref), previousDocumentReferenceId: nullable(declarationFields.documentReferenceId),
    documentReferenceId: declarationFields.documentReferenceId, status: one('prepared_for_external_validation'), requirementsUnknown: array(code, 30), officialReturnCreated: no, filingPerformed: no},
  assistance: {reasonCode: one(...SELLER_TAX_ASSISTANCE_REASONS), state: one('assistance_requested'), identifierValueProvided: no, accountRestrictedByThisAction: no},
  filing_record: {...declarationFields, state: one('external_receipt_recorded'), authority: one('CRA'), reportedExternalStatus: one('received', 'accepted', 'rejected'), reportedReceivedAt: iso,
    confirmationReferenceHash: hash, submittedFileHash: hash, authorityAcceptanceVerified: no, submittedContentBinding: one('external_receipt_claim'), externalReturnSchemaVerified: no},
  copy_record: {...declarationFields, state: one('external_delivery_evidence_recorded'), filingReference: ref, channel: one('secure_external_vault', 'postal_receipt', 'in_person_receipt'),
    reportedDeliveredAt: iso, deliveredFileHash: hash, reportedCopyScope: one('single_seller'), copyContentVerified: no, sellerAccessVerified: no},
  copy_ack: {...declarationFields, delivery: ref, state: one('owner_acknowledged_access'), acknowledgedAt: iso},
  credit_note_record: {source: x => isSellerTaxSource(x) && x.kind === 'purchase_refund', state: one('external_credit_note_recorded'), currentAccountingQualification: code,
    originalInvoiceAuthenticityVerified: no, issuedAt: iso, originalInvoiceReferenceHash: hash, gstCents: count, qstCents: count, buyerFeeCents: count, registrationLegallyVerified: no},
  annual_capture_prepare: {capture: isSellerTaxCapture}, annual_capture_advance: {capture: isSellerTaxCapture},
};
export function isSellerTaxDocument(v: unknown, scope: SellerTaxScope): v is SellerTaxDocument {
  if (!object(v) || typeof v.kind !== 'string' || !Object.hasOwn(documentVariants, v.kind) || !optionalShape(v, {protocol: one('seller_tax_document_v1'),
    kind: one(v.kind), subject: one(scope.subject), ownerId: one(scope.ownerId), year: one(scope.year), actorId: sellerTaxId, recordedAt: iso,
    externalFactsVerified: no, financialEffectAuthorized: no, evidence: nullable(evidence), ...documentVariants[v.kind as SellerTaxCommand['action']]},
    ['snapshot', 'declaration_prepare'].includes(v.kind) ? {captureReference: isSellerTaxCaptureReference} : ['copy_record', 'credit_note_record'].includes(v.kind) ? {
      [v.kind === 'copy_record' ? 'copyAccess' : 'creditNoteAccess']: x => shape(x, {individualFileRecorded: yes, individualizationBasis: one('independent_qualified_attestation'), legalAuthenticityVerified: no})} : {})) return false;
  if (object(v.summary) && (v.summary.ownerId !== scope.ownerId || v.summary.year !== scope.year) || object(v.event) && v.event.ownerId !== scope.ownerId) return false;
  if (object(v.capture) && (v.capture.ownerId !== scope.ownerId || v.capture.year !== scope.year) ||
      v.captureReference !== undefined && (!object(v.summary) || !sellerTaxEqual(v.captureReference, v.summary.captureReference))) return false;
  return true;
}
const kindsForCollection: Record<SellerTaxCollection, SellerTaxCommand['action'][]> = {events: ['ingest', 'evidence_event', 'scan'], identities: ['identity_record', 'operator_record'], snapshots: ['snapshot'],
  declarations: ['declaration_prepare'], filings: ['filing_record'], deliveries: ['copy_record', 'copy_ack'], assistance: ['assistance'], credit_notes: ['credit_note_record'], captures: ['annual_capture_prepare', 'annual_capture_advance']};
export async function parseSellerTaxResponse(raw: unknown, scope: SellerTaxScope, pending?: SellerTaxAttempt, collection?: SellerTaxCollection, cursor: string | null = null): Promise<SellerTaxResponse> {
  if (!shape(raw, {caseView: x => caseView(x, scope), commandReceipt: nullable(receipt), page: nullable(object)}) || !object(raw) || !object(raw.caseView)) throw sellerTaxFailure();
  if (pending) {
    if (!sellerTaxEqual(pending.scope, scope)) throw sellerTaxFailure();
    const r = raw.commandReceipt;
    if (r !== null && (!receipt(r) || r.actorId !== pending.uid || r.requestId !== pending.requestId || r.inputHash !== pending.inputHash || r.action !== pending.command.action ||
      r.subject !== scope.subject || r.ownerId !== scope.ownerId || r.year !== scope.year || r.versionBefore !== pending.command.expectedVersion ||
      r.documentReference !== null && r.documentReference.id !== 'taxdoc_' + await sellerTaxHash([pending.uid, pending.requestId]))) throw sellerTaxFailure();
  } else if (raw.commandReceipt !== null) throw sellerTaxFailure();
  if (raw.caseView.opaque === true && (raw.page !== null || raw.commandReceipt === null)) throw sellerTaxFailure();
  if (collection === undefined) {if (raw.page !== null) throw sellerTaxFailure();}
  else {
    const p = raw.page;
    if (!shape(p, {collection: one(collection), entries: array(x => shape(x, {reference: ref, document: d => isSellerTaxDocument(d, scope)}), 10),
      hasMore: bool, nextCursor: nullable(sellerTaxId), inspected: x => count(x) && x <= 10, completeHistory: no}) || !object(p) || !Array.isArray(p.entries) ||
      p.entries.length > Number(p.inspected) || p.hasMore !== (p.nextCursor !== null) || p.hasMore === true && p.inspected !== 10) throw sellerTaxFailure();
    const ids: string[] = [];
    for (const e of p.entries) {
      if (!object(e) || !ref(e.reference) || !isSellerTaxDocument(e.document, scope) || !kindsForCollection[collection].includes(e.document.kind) ||
          cursor !== null && e.reference.id <= cursor || ids.length > 0 && e.reference.id <= ids[ids.length - 1] || p.nextCursor !== null && e.reference.id > String(p.nextCursor)) throw sellerTaxFailure();
      ids.push(e.reference.id);
    }
  }
  // Every field and every nested variant was validated above; private body hashes
  // remain opaque references and are never recomputed from the redacted body.
  return raw as unknown as SellerTaxResponse;
}
async function rpc(uid: string, scope: SellerTaxScope, mode: 'observe' | 'page' | 'execute' | 'neutralize', fields: Record<string, unknown>, guard: () => void, pending?: SellerTaxAttempt, collection?: SellerTaxCollection, cursor: string | null = null) {
  const session = captureTradeSession(uid), current = () => {assertTradeSessionCurrent(session); guard();}; current();
  if (!isSellerTaxScope(scope) || scope.access === 'owner' && scope.ownerId !== uid) throw sellerTaxFailure();
  const endpoint = mode === 'observe' || mode === 'page' ? 'readSupportRequests' : scope.access === 'admin' ? 'administerSupportRequest' : 'executeSupportOwnerCommand';
  const response = await httpsCallable<unknown, unknown>(functions, endpoint)({capability: SELLER_TAX_CAPABILITY, expectedUid: uid, ...scope, mode, ...fields}); current();
  const result = await parseSellerTaxResponse(response.data, scope, pending, collection, cursor); current(); return result;
}
/** Decode only a bounded canonical file in volatile memory; never put its bytes in a query or journal. */
export async function verifySellerTaxCopyBytes(copy: Pick<SellerTaxPrivateCopy, 'availability' | 'file' | 'dataBase64'>): Promise<void> {
  if (copy.availability !== 'available' || !copy.file || !copy.dataBase64) throw sellerTaxFailure();
  const value = copy.dataBase64, size = copy.file.sizeBytes;
  if (value.length !== Math.ceil(size / 3) * 4) throw sellerTaxFailure();
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/', bytes = new Uint8Array(size);
  let offset = 0;
  for (let i = 0; i < value.length; i += 4) {
    const a = alphabet.indexOf(value[i]), b = alphabet.indexOf(value[i + 1]), c = value[i + 2] === '=' ? 0 : alphabet.indexOf(value[i + 2]), d = value[i + 3] === '=' ? 0 : alphabet.indexOf(value[i + 3]);
    const last = i + 4 === value.length, padding = last ? (3 - size % 3) % 3 : 0;
    if (a < 0 || b < 0 || c < 0 || d < 0 || (value[i + 2] === '=') !== (padding === 2) || (value[i + 3] === '=') !== (padding > 0)) throw sellerTaxFailure();
    if (value[i + 2] === '=' && (b & 15) !== 0 || value[i + 3] === '=' && value[i + 2] !== '=' && (c & 3) !== 0) throw sellerTaxFailure();
    bytes[offset++] = a << 2 | b >> 4;
    if (offset < size) bytes[offset++] = b << 4 | c >> 2;
    if (offset < size) bytes[offset++] = c << 6 | d;
  }
  const computed = Array.from(new Uint8Array(await digest(CryptoDigestAlgorithm.SHA256, bytes)), b => b.toString(16).padStart(2, '0')).join('');
  if (computed !== copy.file.contentHash) throw sellerTaxFailure();
}
export const SellerTaxService = {
  async privateCreditNote(uid: string, scope: SellerTaxScope, creditNote: SellerTaxDocumentReference, guard: () => void): Promise<SellerTaxPrivateCreditNote> {
    const session = captureTradeSession(uid), current = () => {assertTradeSessionCurrent(session); guard();}; current();
    if (!isSellerTaxScope(scope) || scope.access !== 'owner' || scope.subject !== 'seller' || scope.ownerId !== uid || !ref(creditNote)) throw sellerTaxFailure();
    const {data} = await httpsCallable<unknown, unknown>(functions, 'readSupportRequests')({capability: SELLER_TAX_CAPABILITY, expectedUid: uid, ...scope, mode: 'credit_note_read', creditNote}); current();
    if (!shape(data, {creditNoteView: x => shape(x, {protocol: one('seller_tax_private_credit_note_v1'), ownerId: one(uid), year: one(scope.year),
      creditNote: v => ref(v) && sellerTaxEqual(v, creditNote), sourceVersionHash: hash, source: v => isSellerTaxSource(v) && v.kind === 'purchase_refund',
      issuedAt: iso, originalInvoiceReferenceHash: hash, gstCents: count, qstCents: count, buyerFeeCents: count,
      availability: one('available', 'unavailable'), reason: nullable(one('individual_file_not_recorded')),
      file: nullable(v => shape(v, {contentHash: hash, generation: v => typeof v === 'string' && /^\d{1,30}$/.test(v), contentType: one('application/pdf', 'application/xml', 'text/xml'), sizeBytes: v => count(v) && v > 0 && v <= 5242880})),
      dataBase64: nullable(v => typeof v === 'string' && v.length > 0 && v.length <= 6990508), individualizationBasis: nullable(one('independent_qualified_attestation')), legalAuthenticityVerified: no, deviceReadVerified: no})}) || !object(data) || !object(data.creditNoteView)) throw sellerTaxFailure();
    const c = data.creditNoteView;
    if (c.availability === 'unavailable' ? c.reason !== 'individual_file_not_recorded' || c.file !== null || c.dataBase64 !== null || c.individualizationBasis !== null
      : c.reason !== null || c.file === null || c.dataBase64 === null || c.individualizationBasis !== 'independent_qualified_attestation') throw sellerTaxFailure();
    const copy = c as unknown as SellerTaxPrivateCreditNote;
    if (copy.availability === 'available') {await verifySellerTaxCopyBytes(copy); current();}
    return copy;
  },
  async capture(uid: string, scope: SellerTaxScope, reference: SellerTaxCaptureReference, guard: () => void): Promise<SellerTaxCapture> {
    const session = captureTradeSession(uid), current = () => {assertTradeSessionCurrent(session); guard();}; current();
    if (!isSellerTaxScope(scope) || scope.subject !== 'seller' || scope.access === 'owner' && scope.ownerId !== uid || !isSellerTaxCaptureReference(reference)) throw sellerTaxFailure();
    const {data} = await httpsCallable<unknown, unknown>(functions, 'readSupportRequests')({capability: SELLER_TAX_CAPABILITY, expectedUid: uid, ...scope, mode: 'annual_capture_observe', captureReference: reference}); current();
    if (!shape(data, {captureView: isSellerTaxCapture}) || !object(data) || !isSellerTaxCapture(data.captureView) || data.captureView.ownerId !== scope.ownerId || data.captureView.year !== scope.year || !sellerTaxEqual(data.captureView.reference, reference)) throw sellerTaxFailure();
    return data.captureView;
  },
  async privateCopy(uid: string, scope: SellerTaxScope, delivery: SellerTaxDocumentReference, guard: () => void): Promise<SellerTaxPrivateCopy> {
    const session = captureTradeSession(uid), current = () => {assertTradeSessionCurrent(session); guard();}; current();
    if (!isSellerTaxScope(scope) || scope.access !== 'owner' || scope.subject !== 'seller' || scope.ownerId !== uid || !ref(delivery)) throw sellerTaxFailure();
    const {data} = await httpsCallable<unknown, unknown>(functions, 'readSupportRequests')({capability: SELLER_TAX_CAPABILITY, expectedUid: uid, ...scope, mode: 'copy_read', delivery}); current();
    if (!shape(data, {copyView: x => shape(x, {protocol: one('seller_tax_private_copy_v1'), ownerId: one(uid), year: one(scope.year), availability: one('available', 'unavailable'),
      reason: nullable(one('individual_file_not_recorded')), declaration: ref, filing: ref, delivery: v => ref(v) && sellerTaxEqual(v, delivery), sourceVersionHash: hash,
      file: nullable(v => shape(v, {contentHash: hash, generation: v => typeof v === 'string' && /^\d{1,30}$/.test(v), contentType: one('application/pdf', 'application/xml', 'text/xml'), sizeBytes: v => count(v) && v > 0 && v <= 5242880})),
      dataBase64: nullable(v => typeof v === 'string' && v.length > 0 && v.length <= 6990508), individualizationBasis: nullable(one('independent_qualified_attestation')), legalAuthenticityVerified: no, deviceReadVerified: no})}) || !object(data) || !object(data.copyView)) throw sellerTaxFailure();
    const c = data.copyView;
    if (c.availability === 'unavailable' ? c.reason !== 'individual_file_not_recorded' || c.file !== null || c.dataBase64 !== null || c.individualizationBasis !== null
      : c.reason !== null || c.file === null || c.dataBase64 === null || c.individualizationBasis !== 'independent_qualified_attestation') throw sellerTaxFailure();
    const copy = c as unknown as SellerTaxPrivateCopy;
    if (copy.availability === 'available') {await verifySellerTaxCopyBytes(copy); current();}
    return copy;
  },
  async sourceOwner(uid: string, transactionId: string, partyRole: 'buyer' | 'seller', guard: () => void): Promise<SellerTaxSourceOwner> {
    const session = captureTradeSession(uid), current = () => {assertTradeSessionCurrent(session); guard();}; current();
    if (!sellerTaxId(transactionId) || !['buyer', 'seller'].includes(partyRole)) throw sellerTaxFailure();
    const {data} = await httpsCallable<unknown, unknown>(functions, 'readSupportRequests')({capability: SELLER_TAX_CAPABILITY, expectedUid: uid, mode: 'source_owner', access: 'admin',
      source: {kind: 'purchase', id: transactionId, partyRole}}); current();
    if (!shape(data, {sourceOwnerView: x => shape(x, {protocol: one('seller_tax_source_owner_v1'), kind: one('purchase'), transactionId: one(transactionId),
      partyRole: one(partyRole), ownerId: sellerTaxId, sourceVersionHash: hash})}) || !object(data)) throw sellerTaxFailure();
    return data.sourceOwnerView as SellerTaxSourceOwner;
  },
  observe: (uid: string, scope: SellerTaxScope, guard: () => void) => rpc(uid, scope, 'observe', {}, guard),
  page: (uid: string, scope: SellerTaxScope, collection: SellerTaxCollection, cursor: string | null, guard: () => void) => rpc(uid, scope, 'page', {collection, cursor}, guard, undefined, collection, cursor),
  async attempt(uid: string, scope: SellerTaxScope, requestId: string, command: SellerTaxCommand, guard: () => void): Promise<SellerTaxAttempt> {
    const session = captureTradeSession(uid); assertTradeSessionCurrent(session); guard();
    if (!isSellerTaxScope(scope) || !isSellerTaxCommand(command, scope) || !rid(requestId) || scope.access === 'owner' && scope.ownerId !== uid) throw sellerTaxFailure();
    const inputHash = await sellerTaxHash({subject: scope.subject, ownerId: scope.ownerId, year: scope.year, command}); assertTradeSessionCurrent(session); guard();
    return {version: 1, uid, scope, requestId, command, inputHash};
  },
  async command(attempt: SellerTaxAttempt, mode: 'execute' | 'observe' | 'neutralize', guard: () => void) {
    if (!isSellerTaxAttempt(attempt, attempt.uid) || attempt.inputHash !== await sellerTaxHash({subject: attempt.scope.subject, ownerId: attempt.scope.ownerId, year: attempt.scope.year, command: attempt.command})) throw sellerTaxFailure();
    guard(); return rpc(attempt.uid, attempt.scope, mode, {requestId: attempt.requestId, ...(mode === 'observe' ? {} : {command: attempt.command})}, guard, attempt);
  },
};
