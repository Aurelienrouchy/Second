/** Private originals are retained. Confinement controls projections, not the
 * execution of the support request, retention periods, or external copies. */
import {createHash} from 'node:crypto';
import {Timestamp} from 'firebase-admin/firestore';
import {HttpsError} from 'firebase-functions/v2/https';
import {db} from '../config/firebase';
import {preparePrivacyPreservationCatalogueChange} from './privacyPreservationCatalogue';
import {SUPPORT_LEGAL_REVIEW_CAPABILITY, legalReviewEnvelope, legalReviewEarlyReceipt, commitLegalReviewReceipt,
  assertLegalReviewAdmin} from './supportLegalReviewV2';

export const SUPPORT_CONFIDENTIALITY_CAPABILITY = 'support_confidentiality_v1';
export const SUPPORT_CONFIDENTIALITY_ENABLED = true;
export const SUPPORT_CONFIDENTIAL_TEXT = 'Contenu conservé dans un espace confidentiel';
export const SUPPORT_CONFIDENTIAL_REASONS = ['credentials', 'financial_identifier', 'identity_information', 'other_sensitive_content'] as const;
const digest = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const HASH = /^[a-f0-9]{64}$/;
const TICKET_FIELDS = ['narrative', 'latestClarification', 'withdrawalReason', 'ownerMessage', 'internalNote',
  'ownerResponse.text', 'ownerResponse.legalBasis', 'ownerResponse.recourse', 'accountReview.reason',
  'transportInstruction.reason', 'transportInstruction.ownerMessage', 'representation.relationship', 'representation.authorityStatement',
  'privacyRetention.declaredScope.description'] as const;
const COMMAND_FIELDS = ['command.narrative', 'command.ownerMessage', 'command.internalNote', 'command.response.text',
  'command.response.legalBasis', 'command.response.recourse', 'command.accountReview.reason',
  'command.transportInstruction.reason', 'command.transportInstruction.ownerMessage', 'command.representation.relationship',
  'command.representation.authorityStatement', 'command.privacyScope.description'] as const;
const OWNER_FIELDS = new Set(['narrative', 'latestClarification', 'withdrawalReason', 'representation.relationship',
  'representation.authorityStatement', 'privacyRetention.declaredScope.description']);
const OWNER_COMMAND_FIELDS = new Set(['command.narrative', 'command.representation.relationship', 'command.representation.authorityStatement', 'command.privacyScope.description']);
const OWNER_ACTIONS = ['submit', 'clarify', 'withdraw', 'link_evidence'];
const ADMIN_ACTIONS = ['assign', 'request_details', 'respond', 'internal_note', 'record_account_review', 'record_transport_instruction'];
const TEXT_KEYS = new Set(['narrative', 'latestClarification', 'withdrawalReason', 'ownerMessage', 'internalNote', 'text', 'legalBasis', 'recourse', 'reason',
  'relationship', 'authorityStatement', 'description']);
const at = (value: any, path: string): unknown => path.split('.').reduce((v, k) => v?.[k], value);
export type SupportOpaqueCommandReference = {actorId: string; supportRequestId: string; requestId: string; payloadHash: string; action: string};
export type SupportConfidentialTarget = {document: 'ticket'|'command'; supportRequestId: string;
  command: SupportOpaqueCommandReference|null; field: string; revision: string|null; version: number|null;
  sourceHash: string; fieldHash: string|null; qualification: 'native_field'|'awaiting_native_command'};
export type SupportConfidentialCommand = {action: 'protect_own_field'|'confine_field'; target: SupportConfidentialTarget;
  reasonCode: typeof SUPPORT_CONFIDENTIAL_REASONS[number]; acknowledged: true};
export type SupportConfidentialReceipt = {protocol: 'support_confidentiality_receipt_v1'; actorId: string; requestId: string;
  payloadHash: string; state: 'unrecorded'|'committed'|'not_executed'; recordedAt: string|null; reason: string|null;
  target: SupportConfidentialTarget|null; opaqueCommandReference: SupportOpaqueCommandReference|null;
  confinement: 'confined'|'awaiting_native_command'|'not_recorded'; originalRetained: true;
  originalReadAuthorized: false; externalCopiesErased: false; supportExecutionVerified: false};
export type SupportConfidentialSource = {protocol: 'support_confidentiality_source_v1'; actorId: string; scope: 'owner'|'admin';
  supportRequestId: string; qualification: 'native_source'|'awaiting_native_command'|'unknown';
  fields: {target: SupportConfidentialTarget; canProtectOwnField: boolean; canConfineField: boolean; confined: boolean}[];
  opaqueCommandReference: SupportOpaqueCommandReference|null; originalReadAuthorized: false; newCommandsExposed: boolean};
// The support writer trims its copies. Bind the native revision separately and
// recognise both the command body and its trimmed ticket/snapshot projection.
function fieldFamily(path: string, action?: string): string|null {
  if (path === 'command.narrative') return action === 'submit' ? 'narrative' : action === 'withdraw' ? 'withdrawalReason' :
    ['clarify', 'link_evidence'].includes(action ?? '') ? 'latestClarification' : null;
  const parts = path.split('.'), key = parts.at(-1)!;
  if (key === 'reason') return parts.includes('accountReview') ? 'accountReview.reason' :
    parts.includes('transportInstruction') ? 'transportInstruction.reason' : null;
  if (key === 'description') return parts.some(v => ['privacyScope', 'declaredScope'].includes(v)) ? 'privacyScope.description' : null;
  return TEXT_KEYS.has(key) ? key : null;
}
const supportConfidentialFieldHash = (value: string, family: string) => digest(['support_confidential_text_v1', family, value.trim()]);
const guardRef = (id: string, uid: string, requestId: string) => db.collection('support_confidential_command_guards').doc(digest([id, uid, requestId]));
const receiptRef = (uid: string, requestId: string) => db.collection('support_confidentiality_commands').doc(digest([uid, requestId]));
const plain = (v: any): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(v));
const owns = (v: any, key: string) => Object.prototype.hasOwnProperty.call(v, key);
const nativeId = (v: any, minimum = 1) => typeof v === 'string' && v === v.trim() && v.length >= minimum && v.length <= 128 &&
  !v.includes('/') && v !== '.' && v !== '..' && !/^__.*__$/.test(v);
// Firebase actor/owner identities are exact native strings. Text trimming must
// never adopt another account; ticket, request and command IDs stay strict.
const nativeUid = (v: any) => typeof v === 'string' && v.length >= 1 && v.length <= 128 &&
  !v.includes('/') && v !== '.' && v !== '..' && !/^__.*__$/.test(v);
function nativeReference(v: any): v is SupportOpaqueCommandReference {
  return plain(v) && Object.keys(v).length === 5 && ['actorId', 'supportRequestId', 'requestId', 'payloadHash', 'action'].every(k => owns(v, k)) &&
    nativeUid(v.actorId) && nativeId(v.supportRequestId) && nativeId(v.requestId, 16) && HASH.test(v.payloadHash ?? '') &&
    [...OWNER_ACTIONS, ...ADMIN_ACTIONS].includes(v.action);
}
const hashMap = (v: any): v is Record<string, true> => plain(v) && Object.keys(v).length <= 1000 &&
  Object.entries(v).every(([h, flag]) => HASH.test(h) && flag === true);
function commandFieldAllowed(field: string, action: string) {
  if (field === 'command.narrative') return OWNER_ACTIONS.includes(action);
  if (field.startsWith('command.representation.')) return action === 'submit';
  if (field === 'command.privacyScope.description') return ['submit', 'clarify'].includes(action);
  if (field === 'command.ownerMessage') return action === 'request_details';
  if (field === 'command.internalNote') return action === 'internal_note';
  if (field.startsWith('command.response.')) return action === 'respond';
  if (field === 'command.accountReview.reason') return action === 'record_account_review';
  return field.startsWith('command.transportInstruction.') && action === 'record_transport_instruction';
}
function qualifiedGuard(v: any): boolean {
  return plain(v) && Object.keys(v).every(k => ['protocol', 'reference', 'ownerId', 'fields', 'fieldHashes', 'recordedAt'].includes(k)) &&
    v.protocol === SUPPORT_CONFIDENTIALITY_CAPABILITY && nativeReference(v.reference) && nativeUid(v.ownerId) && v.recordedAt instanceof Timestamp &&
    Array.isArray(v.fields) && v.fields.length >= 1 && v.fields.length <= COMMAND_FIELDS.length && new Set(v.fields).size === v.fields.length &&
    v.fields.every((f: unknown) => typeof f === 'string' && (COMMAND_FIELDS as readonly string[]).includes(f)) &&
    hashMap(v.fieldHashes);
}
type CopyConfinement = {field: string; fieldHash: string; reference: SupportOpaqueCommandReference; version: number; recordedAt: string};
function copyConfinements(ticket: any): CopyConfinement[]|null {
  const copies = ticket?.supportConfidentiality?.copies;
  if (copies === undefined) return [];
  return Array.isArray(copies) && copies.length <= 1000 && copies.every(c => plain(c) &&
    Object.keys(c).length === 5 && ['field', 'fieldHash', 'reference', 'version', 'recordedAt'].every(k => owns(c, k)) &&
    ['ownerMessage', 'internalNote', 'ownerResponse.text', 'ownerResponse.legalBasis', 'ownerResponse.recourse', 'accountReview.reason',
      'transportInstruction.reason', 'transportInstruction.ownerMessage'].includes(c.field) && HASH.test(c.fieldHash ?? '') && nativeReference(c.reference) &&
    COMMAND_FIELDS.some(field => commandFieldAllowed(field, c.reference.action) && adminCopyFields(field).includes(c.field)) &&
    Number.isSafeInteger(c.version) && c.version >= 1 && typeof c.recordedAt === 'string' && Number.isFinite(Date.parse(c.recordedAt))) ? copies : null;
}
function markerHashes(ticket: any): Record<string, true>|null {
  if (!Object.prototype.hasOwnProperty.call(ticket ?? {}, 'supportConfidentiality')) return {};
  const m = ticket.supportConfidentiality;
  return plain(m) && m.protocol === SUPPORT_CONFIDENTIALITY_CAPABILITY && hashMap(m.hashes) && copyConfinements(ticket) !== null ? m.hashes : null;
}
export function supportConfidentialityProjection(ticket: any) {
  const hashes = markerHashes(ticket);
  return {protocol: 'support_confidentiality_projection_v1' as const,
    state: hashes === null ? 'unknown' as const : Object.keys(hashes).length || copyConfinements(ticket)!.length ? 'fields_confined' as const : 'not_recorded' as const,
    originalRetained: true as const, originalReadAuthorized: false as const, externalCopiesErased: false as const};
}
/** Apply the CURRENT ticket marker even to immutable old snapshots. No native
 * original or receipt is rewritten. An unknown marker never exposes free text. */
export function projectSupportConfidential<T>(value: T, ticket: any, commandGuard?: any): T {
  const hashes = markerHashes(ticket), guardHashes = commandGuard?.fieldHashes ?? {}, copies = copyConfinements(ticket);
  const unknown = hashes === null || commandGuard != null && !qualifiedGuard(commandGuard);
  const visit = (v: any, path = ''): any => {
    const family = fieldFamily(path, (value as any)?.command?.action);
    if (typeof v === 'string') {
      const guardApplies = commandGuard && (OWNER_ACTIONS.includes(commandGuard.reference?.action) || commandGuard.fields?.includes(path));
      if (family && (unknown || hashes?.[supportConfidentialFieldHash(v, family)] || guardApplies && guardHashes[supportConfidentialFieldHash(v, family)])) return SUPPORT_CONFIDENTIAL_TEXT;
      const field = path.startsWith('ownerSnapshot.') ? path.slice('ownerSnapshot.'.length) : path;
      const root = path.startsWith('ownerSnapshot.') ? (value as any)?.ownerSnapshot : value;
      for (const copy of copies ?? []) if (copy.field === field && family && copy.fieldHash === supportConfidentialFieldHash(v, family)) {
        // Views omit private provenance. The current raw ticket may supply it
        // only for the same native version, never for an older snapshot.
        const raw = (root as any)?.version === ticket?.version ? ticket : root;
        const same = copyProvenance(raw, copy);
        if (same === null) throw new HttpsError('failed-precondition', 'Provenance de la copie confidentielle à rapprocher.');
        if (same) return SUPPORT_CONFIDENTIAL_TEXT;
      }
      return v;
    }
    if (Array.isArray(v)) return v.map(item => visit(item, path));
    if (!v || typeof v !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(v))) return v;
    return Object.fromEntries(Object.entries(v).filter(([k]) => k !== 'supportFieldSources').map(([k, item]) => [k, visit(item, path ? path + '.' + k : k)]));
  };
  return visit(value);
}
export async function readSupportConfidentialCommandGuard(tx: FirebaseFirestore.Transaction, id: string, uid: string, requestId: string, payloadHash: string) {
  const guard = (await tx.get(guardRef(id, uid, requestId))).data() ?? null;
  if (guard && (!qualifiedGuard(guard) || guard.reference?.actorId !== uid ||
      guard.reference?.supportRequestId !== id || guard.reference?.requestId !== requestId || guard.reference?.payloadHash !== payloadHash)) {
    throw new HttpsError('failed-precondition', 'Référence de protection privée à rapprocher.');
  }
  return guard;
}
export function materializeSupportConfidentialGuard(guard: any, command: any): any {
  if (!guard) return null;
  if (!qualifiedGuard(guard) || command != null && command.action !== guard.reference.action)
    throw new HttpsError('failed-precondition', 'Protection privée de la commande non qualifiée.');
  const fieldHashes = {...(guard.fieldHashes ?? {})};
  for (const field of guard.fields) {const value = at({command}, field), family = fieldFamily(field, command?.action);
    if (typeof value === 'string' && family) fieldHashes[supportConfidentialFieldHash(value, family)] = true;}
  if (!hashMap(fieldHashes)) throw new HttpsError('failed-precondition', 'Capacité de protection privée à rapprocher.');
  return {...guard, fieldHashes};
}
export function confidentialSupportRecord(record: any, command: any, guard: any): any {
  if (!guard) return record;
  if (!qualifiedGuard(guard) || command?.action !== guard.reference.action) {
    throw new HttpsError('failed-precondition', 'Protection privée de la commande non qualifiée.');
  }
  const hashes = markerHashes(record);
  if (!hashes) throw new HttpsError('failed-precondition', 'Protection privée du dossier à rapprocher.');
  const next = {...hashes};
  // A participant can protect their own owner-authored ticket fields. An old
  // administrator's own command is protected by its exact command guard; it
  // cannot quarantine a later operator's current field merely by equal text.
  if (OWNER_ACTIONS.includes(command?.action)) for (const field of guard.fields) {const value = at({command}, field), family = fieldFamily(field, command?.action);
    if (typeof value === 'string' && family) next[supportConfidentialFieldHash(value, family)] = true;}
  if (Object.keys(next).length > 1000) throw new HttpsError('resource-exhausted', 'Protection privée à rapprocher manuellement.');
  return {...record, supportConfidentiality: {...record.supportConfidentiality, protocol: SUPPORT_CONFIDENTIALITY_CAPABILITY, hashes: next}};
}

function adminCopyFields(commandField: string): string[] {
  if (commandField.startsWith('command.response.')) return [commandField.replace('command.response.', 'ownerResponse.')];
  if (commandField.startsWith('command.transportInstruction.')) return [commandField.slice('command.'.length),
    ...(commandField === 'command.transportInstruction.ownerMessage' ? ['ownerMessage'] : [])];
  return ['command.ownerMessage', 'command.internalNote', 'command.accountReview.reason'].includes(commandField) ? [commandField.slice('command.'.length)] : [];
}
function sameReference(a: SupportOpaqueCommandReference, b: SupportOpaqueCommandReference) {
  return ['actorId', 'supportRequestId', 'requestId', 'payloadHash', 'action'].every(key => a[key as keyof typeof a] === b[key as keyof typeof b]);
}
function copyProvenance(record: any, copy: CopyConfinement): boolean|null {
  const sources = record?.supportFieldSources;
  if (sources != null && !plain(sources)) return null;
  if (sources && owns(sources, copy.field)) {
    const ref = sources[copy.field];
    return nativeReference(ref) ? sameReference(ref, copy.reference) : null;
  }
  const parent = copy.field.includes('.') ? at(record, copy.field.slice(0, copy.field.lastIndexOf('.'))) as any : null;
  if (parent?.recordedBy !== undefined) {
    if (!nativeUid(parent.recordedBy) || typeof parent.recordedAt !== 'string' || !Number.isFinite(Date.parse(parent.recordedAt))) return null;
    if (parent.recordedBy !== copy.reference.actorId || parent.recordedAt !== copy.recordedAt) return false;
    if (parent.requestId !== undefined && parent.requestId !== copy.reference.requestId ||
        parent.payloadHash !== undefined && parent.payloadHash !== copy.reference.payloadHash) return false;
    return true;
  }
  // The command's own result version is native proof for legacy scalar copies.
  // A later version with no provenance is ambiguous; never leak or attribute it.
  return record?.version === copy.version ? true : null;
}
/** Server-only provenance; never included in support DTOs. Each later write
 * replaces only its own fields, so identical text by another author is distinct. */
export function supportAdminCopySources(record: any, command: any, reference: SupportOpaqueCommandReference) {
  const sources = record.supportFieldSources ?? {};
  if (!plain(sources) || Object.keys(sources).length > TICKET_FIELDS.length ||
      Object.values(sources).some(v => !nativeReference(v))) throw new HttpsError('failed-precondition', 'Provenance privée des champs à rapprocher.');
  const next = {...sources};
  for (const field of COMMAND_FIELDS) if (commandFieldAllowed(field, command.action) && typeof at({command}, field) === 'string') {
    for (const copyField of adminCopyFields(field)) next[copyField] = reference;
  }
  return next;
}

// Lazy domain imports keep the shared PURE projection usable by supportRequest
// without a module-initialisation cycle through its command handlers.
const domain = () => import('./supportRequest');
export async function parseSupportOpaqueCommandReference(value: unknown): Promise<SupportOpaqueCommandReference> {
  const s = await domain(), r = s.supportObject(value, ['actorId', 'supportRequestId', 'requestId', 'payloadHash', 'action']);
  if (!nativeReference(r)) throw new HttpsError('invalid-argument', 'Référence opaque invalide.');
  return {actorId: r.actorId, supportRequestId: s.supportId(r.supportRequestId),
    requestId: s.supportRequestId(r.requestId), payloadHash: r.payloadHash, action: r.action};
}
export async function parseSupportConfidentialTarget(value: unknown): Promise<SupportConfidentialTarget> {
  const s = await domain(), t = s.supportObject(value, ['document', 'supportRequestId', 'command', 'field', 'revision', 'version', 'sourceHash', 'fieldHash', 'qualification']);
  if (!['ticket', 'command'].includes(t.document) || !['native_field', 'awaiting_native_command'].includes(t.qualification) ||
      !HASH.test(t.sourceHash ?? '') || !((t.document === 'ticket' ? TICKET_FIELDS : COMMAND_FIELDS) as readonly string[]).includes(t.field) ||
      t.revision !== null && (typeof t.revision !== 'string' || !/^\d+:\d+$/.test(t.revision)) ||
      t.version !== null && (!Number.isSafeInteger(t.version) || t.version < 1) ||
      t.fieldHash !== null && !HASH.test(t.fieldHash ?? '') || t.qualification === 'native_field' && (!t.revision || !t.fieldHash) ||
      t.qualification === 'awaiting_native_command' && (t.document !== 'command' || t.revision !== null || t.version !== null || t.fieldHash !== null))
    throw new HttpsError('invalid-argument', 'Cible native exacte requise.');
  const command = t.document === 'command' ? await parseSupportOpaqueCommandReference(t.command) : null;
  const supportRequestId = s.supportId(t.supportRequestId);
  if (t.document === 'ticket' && t.command !== null || command && command.supportRequestId !== supportRequestId)
    throw new HttpsError('invalid-argument', 'Contexte de la cible différent.');
  return {...t, supportRequestId, command} as SupportConfidentialTarget;
}
export async function parseSupportConfidentialCommand(value: unknown): Promise<SupportConfidentialCommand> {
  const s = await domain(), c = s.supportObject(value, ['action', 'target', 'reasonCode', 'acknowledged']);
  if (!['protect_own_field', 'confine_field'].includes(c.action) || !(SUPPORT_CONFIDENTIAL_REASONS as readonly unknown[]).includes(c.reasonCode) || c.acknowledged !== true)
    throw new HttpsError('invalid-argument', 'Protection et motif structuré explicites requis.');
  return {...c, target: await parseSupportConfidentialTarget(c.target)} as SupportConfidentialCommand;
}
function operationRef(r: SupportOpaqueCommandReference) {
  return db.collection('support_requests').doc(r.supportRequestId).collection('commands').doc(digest([r.actorId, r.requestId]));
}
async function source(tx: FirebaseFirestore.Transaction, uid: string, id: string, command: SupportOpaqueCommandReference|null, admin: boolean) {
  const s = await domain(), ticketSnap = await tx.get(db.collection('support_requests').doc(id)), ticket = ticketSnap.data();
  if (ticket?.kind === 'authority_request_private')
    throw new HttpsError('permission-denied', 'Ce dossier relève du parcours administratif privé.');
  const ownCommand = command?.actorId === uid;
  const op = command ? (await tx.get(operationRef(command))).data() : null;
  const opNative = !!command && op?.protocol === 'support_command_v1' && op.actorId === command.actorId && op.requestId === command.requestId &&
    op.supportRequestId === id && op.action === command.action && op.payloadHash === command.payloadHash &&
    ['committed', 'not_executed'].includes(op.state) && op.command && s.supportHash(op.command) === op.payloadHash;
  const awaiting = !!command && !op && ownCommand && OWNER_ACTIONS.includes(command.action) &&
    (ticket?.schemaVersion === 1 && ticket.ownerId === uid || command.action === 'submit' && command.supportRequestId === 'support_' + s.supportHash([uid, command.requestId]));
  if (!admin && !(command ? ownCommand && (opNative || awaiting) : ticket?.schemaVersion === 1 && ticket.ownerId === uid))
    throw new HttpsError('permission-denied', 'Source personnelle non autorisée.');
  if (admin && (!ticket || ticket.schemaVersion !== 1)) throw new HttpsError('failed-precondition', 'Dossier natif indisponible.');
  const snap = command ? await tx.get(operationRef(command)) : ticketSnap;
  const revision = s.supportRevision(snap), body = command ? op : ticket;
  const guard = command ? await readSupportConfidentialCommandGuard(tx, id, command.actorId, command.requestId, command.payloadHash) : null;
  const fields: SupportConfidentialSource['fields'] = [];
  for (const field of command ? COMMAND_FIELDS : TICKET_FIELDS) {
    const value = at(body, field);
    const technical = awaiting && OWNER_COMMAND_FIELDS.has(field) && commandFieldAllowed(field, command!.action);
    if (technical || typeof value === 'string' && value && (!command || opNative) && revision) {
      const ownField = command ? ownCommand : ticket?.ownerId === uid && OWNER_FIELDS.has(field);
      if (!admin && !ownField) continue;
      const target: SupportConfidentialTarget = {document: command ? 'command' : 'ticket', supportRequestId: id, command,
        field, revision: technical ? null : revision, version: technical ? null : Number.isSafeInteger(ticket?.version) ? ticket!.version : null,
        fieldHash: technical ? null : supportConfidentialFieldHash(value as string, fieldFamily(field, op?.action)!), qualification: technical ? 'awaiting_native_command' : 'native_field', sourceHash: ''};
      target.sourceHash = s.supportHash({...target, sourceHash: null});
      const hashes = markerHashes(ticket);
      const copied = command ? [] : (copyConfinements(ticket) ?? []).filter(copy => copy.field === field && copy.fieldHash === target.fieldHash)
        .map(copy => copyProvenance(ticket, copy));
      if (copied.includes(null)) throw new HttpsError('failed-precondition', 'Provenance de la copie confidentielle à rapprocher.');
      fields.push({target, canProtectOwnField: ownField && SUPPORT_CONFIDENTIALITY_ENABLED, canConfineField: admin && SUPPORT_CONFIDENTIALITY_ENABLED,
        confined: hashes === null || !!target.fieldHash && (hashes?.[target.fieldHash] === true || guard?.fieldHashes?.[target.fieldHash] === true) ||
          guard?.fields?.includes(field) === true || copied.includes(true)});
    }
  }
  return {ticket, op, guard, fields, awaiting, opNative, reference: ownCommand ? command : null};
}
function viewReceipt(raw: any, uid: string, rid: string, payloadHash: string): SupportConfidentialReceipt {
  return {protocol: 'support_confidentiality_receipt_v1', actorId: uid, requestId: rid, payloadHash,
    state: raw?.state ?? 'unrecorded', recordedAt: raw?.recordedAt instanceof Timestamp ? raw.recordedAt.toDate().toISOString() : null,
    reason: raw?.reason ?? null, target: raw?.command?.target ?? null, opaqueCommandReference: raw?.opaqueCommandReference ?? null,
    confinement: raw?.confinement ?? 'not_recorded', originalRetained: true, originalReadAuthorized: false,
    externalCopiesErased: false, supportExecutionVerified: false};
}
export async function handleSupportConfidentiality(request: any, endpoint: 'owner'|'admin'|'read') {
  const s = await domain(), uid = s.supportUid(request), r = s.supportObject(request.data,
    ['expectedUid', 'capability', 'operation', 'scope', 'supportRequestId', 'reference', 'requestId', 'command', 'mode']);
  if (r.capability !== SUPPORT_CONFIDENTIALITY_CAPABILITY) throw new HttpsError('invalid-argument', 'Capacité privée invalide.');
  const allowed = r.operation === 'command' ? ['expectedUid', 'capability', 'operation', 'requestId', 'command', 'mode'] :
    ['receipt_observe', 'receipt_neutralize', 'servicing_observe', 'servicing_neutralize'].includes(r.operation) ? ['expectedUid', 'capability', 'operation', 'reference'] :
    ['expectedUid', 'capability', 'operation', 'scope', 'supportRequestId', 'reference', ...(r.operation === 'original_read' ? ['requestId'] : [])];
  if (Object.keys(r).some(key => !allowed.includes(key))) throw new HttpsError('invalid-argument', 'Conservez uniquement la référence privée, sans recopier son contenu.');
  if (['receipt_observe', 'receipt_neutralize', 'servicing_observe', 'servicing_neutralize'].includes(r.operation)) {
    const reference = await parseSupportOpaqueCommandReference(r.reference);
    if (reference.actorId !== uid) throw new HttpsError('permission-denied', 'Référence propre requise.');
    const servicing = r.operation.startsWith('servicing_'), neutralize = r.operation.endsWith('_neutralize');
    if (reference.action === 'submit' && reference.supportRequestId !== 'support_' + s.supportHash([uid, reference.requestId]))
      throw new HttpsError('invalid-argument', 'Référence de dépôt propre différente.');
    return db.runTransaction(async tx => {
      // Metadata-only servicing is also available when a protection instruction
      // was refused or never executed. It certifies no confinement and returns
      // no original body. The full native tuple still binds every operation.
      const guard = servicing ? null : await readSupportConfidentialCommandGuard(tx, reference.supportRequestId, uid, reference.requestId, reference.payloadHash);
      if (!servicing && (!guard || s.supportHash(guard.reference) !== s.supportHash(reference))) throw new HttpsError('failed-precondition', 'Confinement natif exact requis.');
      const opRef = operationRef(reference), old = (await tx.get(opRef)).data();
      if (old && (old.protocol !== 'support_command_v1' || old.actorId !== uid || old.requestId !== reference.requestId ||
          old.supportRequestId !== reference.supportRequestId || old.payloadHash !== reference.payloadHash || old.action !== reference.action ||
          !['committed', 'not_executed'].includes(old.state) || !Number.isSafeInteger(old.recordedAtMs) || old.recordedAtMs < 1 ||
          old.state === 'committed' && (!nativeUid(old.ownerId) || !Number.isSafeInteger(old.resultVersion) || old.resultVersion < 1 ||
            !old.command || s.supportHash(old.command) !== reference.payloadHash || !old.ownerSnapshot || old.ownerSnapshot.id !== reference.supportRequestId ||
            old.ownerSnapshot.ownerId !== old.ownerId || old.ownerSnapshot.version !== old.resultVersion))) throw new HttpsError('failed-precondition', 'Reçu propre non qualifié.');
      const now = Timestamp.now();
      if (!old && neutralize) tx.create(opRef, {protocol: 'support_command_v1', actorId: uid,
        ownerId: guard?.ownerId ?? null, supportRequestId: reference.supportRequestId, requestId: reference.requestId, action: reference.action,
        actorRole: OWNER_ACTIONS.includes(reference.action) ? 'owner' : 'admin', payloadHash: reference.payloadHash,
        state: 'not_executed', reason: 'command_neutralized', resultVersion: null, ownerSnapshot: null, command: null, recordedAtMs: now.toMillis()});
      return {protocol: 'support_confidential_opaque_receipt_v1', actorId: uid, reference,
        state: old?.state ?? (neutralize ? 'not_executed' : 'unrecorded'),
        reason: old?.reason ?? (neutralize && !old ? 'command_neutralized' : null),
        resultVersion: old?.resultVersion ?? null, recordedAt: old ? new Date(old.recordedAtMs).toISOString() :
          neutralize ? now.toDate().toISOString() : null,
        confinement: servicing ? 'not_recorded' : 'confined', originalRetained: true, originalReadAuthorized: false, externalCopiesErased: false};
    });
  }
  if (r.operation === 'command') {
    const command = await parseSupportConfidentialCommand(r.command), requestId = s.supportRequestId(r.requestId), payloadHash = s.supportHash(command);
    if (!['execute', 'observe', 'neutralize'].includes(r.mode) || endpoint === 'read') throw new HttpsError('invalid-argument', 'Mode privé invalide.');
    return db.runTransaction(async tx => {
      const ref = receiptRef(uid, requestId), old = (await tx.get(ref)).data();
      if (old) {
        if (old.actorId !== uid || old.requestId !== requestId || old.payloadHash !== payloadHash || old.protocol !== SUPPORT_CONFIDENTIALITY_CAPABILITY ||
            !['committed', 'not_executed'].includes(old.state)) throw new HttpsError('already-exists', 'Identifiant privé déjà engagé.');
        return viewReceipt(old, uid, requestId, payloadHash);
      }
      if (r.mode === 'observe') return viewReceipt(null, uid, requestId, payloadHash);
      const now = Timestamp.now();
      const finish = (reason: string|null, extras: any = {}) => {
        const entry = {protocol: SUPPORT_CONFIDENTIALITY_CAPABILITY, actorId: uid, requestId, payloadHash, command,
          state: reason ? 'not_executed' : 'committed', recordedAt: now, reason, confinement: 'not_recorded', ...extras};
        tx.create(ref, entry); return viewReceipt(entry, uid, requestId, payloadHash);
      };
      if (r.mode === 'neutralize') return finish('command_neutralized');
      if (!SUPPORT_CONFIDENTIALITY_ENABLED) return finish('support_confidentiality_not_exposed');
      const admin = command.action === 'confine_field';
      if (admin) {
        if (endpoint !== 'admin') throw new HttpsError('permission-denied', 'Instruction opérateur distincte requise.');
        await s.supportCurrentAdminSession(request); await s.supportAdmin(tx, uid, false);
        (await import('./eligibility')).assertRecentAccountAuthentication(request.auth.token);
      }
      const c = command.target, current = await source(tx, uid, c.supportRequestId, c.command, admin);
      const target = current.fields.find(row => row.target.field === c.field)?.target;
      // A pending-own target may acquire its exact native body while in flight;
      // it still binds the same UID/request/hash, never another submitted text.
      const pendingMatch = c.qualification === 'awaiting_native_command' && c.command?.actorId === uid && OWNER_ACTIONS.includes(c.command.action) &&
        OWNER_COMMAND_FIELDS.has(c.field) && (current.ticket?.schemaVersion === 1 && current.ticket.ownerId === uid ||
          c.command.action === 'submit' && c.command.supportRequestId === 'support_' + s.supportHash([uid, c.command.requestId])) &&
        c.sourceHash === s.supportHash({...c, sourceHash: null});
      if (!target || !pendingMatch && s.supportHash(target) !== s.supportHash(c)) return finish('source_changed');
      const fieldHash = target.fieldHash, ticket = current.ticket;
      const hashes = markerHashes(ticket);
      if (!hashes) return finish('confinement_source_unknown');
      // Global hashes remain appropriate for owner-authored fields and an
      // operator's explicit confinement. Protecting one's old admin command
      // instead adds provenance-scoped copies: equal text by B is not A's copy.
      const protectTicket = command.action === 'confine_field' || c.document === 'ticket' || c.command && OWNER_ACTIONS.includes(c.command.action);
      const nextHashes = {...hashes, ...(fieldHash && protectTicket ? {[fieldHash]: true as const} : {})};
      if (Object.keys(nextHashes).length > 1000) return finish('confinement_capacity_requires_review');
      const copies = [...copyConfinements(ticket)!];
      if (!protectTicket && fieldHash && c.command && current.op?.state === 'committed') {
        const op = current.op;
        if (!Number.isSafeInteger(op.resultVersion) || op.resultVersion < 1 || !Number.isSafeInteger(op.recordedAtMs) ||
            op.recordedAtMs < 1 || !op.ownerSnapshot || op.ownerSnapshot.id !== c.supportRequestId ||
            op.ownerSnapshot.version !== op.resultVersion) return finish('copy_provenance_unknown');
        for (const field of commandFieldAllowed(c.field, c.command.action) ? adminCopyFields(c.field) : []) {
          const copy: CopyConfinement = {field, fieldHash, reference: c.command, version: op.resultVersion,
            recordedAt: new Date(op.recordedAtMs).toISOString()};
          if (!copies.some(old => digest(old) === digest(copy))) copies.push(copy);
        }
      }
      if (copies.length > 1000) return finish('confinement_capacity_requires_review');
      let guard: any = null;
      if (c.command) {
        const fields = [...new Set([...(current.guard?.fields ?? []), c.field])];
        guard = {protocol: SUPPORT_CONFIDENTIALITY_CAPABILITY, reference: c.command, ownerId: ticket?.ownerId ?? uid, fields,
          fieldHashes: {...(current.guard?.fieldHashes ?? {}), ...(fieldHash ? {[fieldHash]: true} : {})}, recordedAt: now};
        if (!qualifiedGuard(guard)) return finish('confinement_source_unknown');
      }
      const catalogue = await preparePrivacyPreservationCatalogueChange(tx, {caseId: c.supportRequestId,
        actorId: uid, requestId, kind: 'support_confidential_confinement'});
      const notices = ticket ? await (await import('./notifications')).prepareOperationalNotices(tx, [{
        eventKey: `support_confidentiality:${uid}:${requestId}`, userId: ticket.ownerId, type: 'order_moderation',
        title: 'Protection du dossier de support', message: 'Un contenu du dossier est désormais conservé dans un espace confidentiel. Cette protection ne prouve pas son effacement ailleurs.',
        data: {ownerId: ticket.ownerId, supportRequestId: c.supportRequestId, ...(ticket.transactionId ? {transactionId: ticket.transactionId} : {})},
      }]) : null;
      if (ticket && fieldHash && (protectTicket || copies.length) || guard) catalogue.commit();
      if (ticket && fieldHash && (protectTicket || copies.length)) tx.update(db.collection('support_requests').doc(c.supportRequestId),
        {supportConfidentiality: {protocol: SUPPORT_CONFIDENTIALITY_CAPABILITY, hashes: nextHashes, copies}});
      if (guard) tx.set(guardRef(c.supportRequestId, c.command!.actorId, c.command!.requestId), guard);
      notices?.commit();
      return finish(null, {confinement: fieldHash ? 'confined' : 'awaiting_native_command',
        opaqueCommandReference: current.reference});
    });
  }
  if (endpoint !== 'read' || !['source_observe', 'original_read'].includes(r.operation) || !['owner', 'admin'].includes(r.scope))
    throw new HttpsError('invalid-argument', 'Lecture privée invalide.');
  const id = s.supportId(r.supportRequestId), command = r.reference == null ? null : await parseSupportOpaqueCommandReference(r.reference);
  if (command && command.supportRequestId !== id) throw new HttpsError('invalid-argument', 'Dossier de référence différent.');
  return db.runTransaction(async tx => {
    const admin = r.scope === 'admin';
    if (admin) {await s.supportCurrentAdminSession(request); await s.supportAdmin(tx, uid, false);
      (await import('./eligibility')).assertRecentAccountAuthentication(request.auth.token);}
    const current = await source(tx, uid, id, command, admin);
    if (r.operation === 'original_read') {
      // No confidential-reader authority has been designated by the company.
      // An ordinary support/admin role never upgrades this default denial.
      const rid = s.supportRequestId(r.requestId), audit = db.collection('support_confidential_access').doc(digest([uid, rid]));
      const old = (await tx.get(audit)).data(), targetHash = s.supportHash({id, command});
      if (old && (old.protocol !== SUPPORT_CONFIDENTIALITY_CAPABILITY || old.actorId !== uid || old.targetHash !== targetHash ||
          old.outcome !== 'denied' || !(old.recordedAt instanceof Timestamp))) throw new HttpsError('already-exists', 'Accès privé déjà journalisé pour une autre cible.');
      if (!old) tx.create(audit, {protocol: SUPPORT_CONFIDENTIALITY_CAPABILITY, actorId: uid, targetHash,
        outcome: 'denied', reason: 'confidential_authority_not_configured', recordedAt: Timestamp.now()});
      return {protocol: 'support_confidential_original_v1', actorId: uid, access: 'denied',
        reason: 'confidential_authority_not_configured', original: null, accessAudited: true};
    }
    return {protocol: 'support_confidentiality_source_v1', actorId: uid, scope: r.scope, supportRequestId: id,
      qualification: current.awaiting ? 'awaiting_native_command' : current.fields.length ? 'native_source' : 'unknown',
      fields: current.fields, opaqueCommandReference: current.reference, originalReadAuthorized: false,
      newCommandsExposed: SUPPORT_CONFIDENTIALITY_ENABLED} satisfies SupportConfidentialSource;
  });
}

/** V1 original_read remains denied above. V2 serves one exact native field
 * once, after its audit commits. A historical receipt never replays its text. */
export async function handleSupportOriginalV2(request: any, endpoint: 'admin'|'read') {
  const s = await domain(), uid = s.supportUid(request);
  if (request.data?.operation === 'source_observe') {
    const data = s.supportObject(request.data, ['capability', 'area', 'expectedUid', 'operation', 'caseId', 'reference']);
    if (data.capability !== SUPPORT_LEGAL_REVIEW_CAPABILITY || data.area !== 'confidential_original' || endpoint !== 'read') {
      throw new HttpsError('invalid-argument', 'Lecture administrative V2 exacte requise.');
    }
    const id = s.supportId(data.caseId), command = data.reference == null ? null : await parseSupportOpaqueCommandReference(data.reference);
    if (command && command.supportRequestId !== id) throw new HttpsError('invalid-argument', 'Contexte de commande différent.');
    return db.runTransaction(async tx => {
      await assertLegalReviewAdmin(tx, request);
      const current = await source(tx, uid, id, command, true), ticket = await tx.get(db.collection('support_requests').doc(id));
      return {protocol: 'support_confidential_source_v2', actorId: uid, caseId: id, fields: current.fields,
        context: {revision: s.supportRevision(ticket), version: s.supportVersion(current.ticket),
          sourceHash: s.supportSourceHash({revision: s.supportRevision(ticket), ticket: current.ticket})},
        original: null, legalAuthorityVerified: false, authorizationScope: 'one_exact_field_per_instruction'};
    });
  }
  const env = legalReviewEnvelope(request, 'confidential_original', ['read_original_field']);
  const historical = await db.runTransaction(tx => legalReviewEarlyReceipt(tx, request, env));
  if (historical) return historical;
  await (await import('./rateLimit')).checkRateLimit(uid, true, {functionName: 'supportConfidentialOriginalV2',
    maxCallsAuthenticated: 20, maxCallsUnauthenticated: 0, windowMs: 60_000});
  return db.runTransaction(async tx => {
    const prior = await legalReviewEarlyReceipt(tx, request, env);
    if (prior) return prior;
    await assertLegalReviewAdmin(tx, request);
    const command = s.supportObject(env.command, ['action', 'target', 'context', 'purpose', 'reason', 'necessityAccepted', 'minimizationAccepted']);
    const target = await parseSupportConfidentialTarget(command.target), context = s.supportObject(command.context, ['revision', 'version', 'sourceHash']);
    if (target.supportRequestId !== env.descriptor.caseId || target.qualification !== 'native_field' ||
        command.necessityAccepted !== true || command.minimizationAccepted !== true) {
      throw new HttpsError('invalid-argument', 'Une cible native et les attestations de nécessité et de minimisation sont requises.');
    }
    const reason = s.supportText(command.reason, 'Motivation de l’accès limité', 2000), id = env.descriptor.caseId;
    const current = await source(tx, uid, id, target.command, true), ticket = await tx.get(db.collection('support_requests').doc(id));
    const nativeContext = {revision: s.supportRevision(ticket), version: s.supportVersion(current.ticket),
      sourceHash: s.supportSourceHash({revision: s.supportRevision(ticket), ticket: current.ticket})};
    const nativeTarget = current.fields.find(row => row.target.field === target.field)?.target;
    if (!nativeTarget || s.supportHash(nativeTarget) !== s.supportHash(target) || s.supportHash(context) !== s.supportHash(nativeContext)) {
      return commitLegalReviewReceipt(tx, env, null, null, 'source_changed');
    }
    const purposes: Record<string, readonly string[]> = {
      support_handling: ['commercial_late', 'access_interruption', 'swap_hold_assistance', 'withdrawal_timing_assistance',
        'account_reconciliation', 'restriction_circumvention', 'representation_review', 'payment_account_review', 'activity_compliance_review'],
      privacy_rights: ['personal_data_access', 'personal_data_correction'],
      security_review: ['access_interruption', 'account_reconciliation', 'restriction_circumvention', 'automated_decision_review', 'activity_compliance_review'],
    };
    if (typeof command.purpose !== 'string' || !purposes[command.purpose]?.includes(current.ticket?.kind ?? '')) {
      throw new HttpsError('invalid-argument', 'La finalité doit correspondre au contexte natif de ce dossier.');
    }
    const original = at(target.document === 'ticket' ? current.ticket : current.op, target.field);
    if (typeof original !== 'string' || !original) return commitLegalReviewReceipt(tx, env, null, null, 'source_changed');
    const auditId = 'confidential_access_' + s.supportHash([uid, env.requestId]);
    const audit = {protocol: 'support_confidential_access_v2', actorId: uid, requestId: env.requestId,
      caseId: id, payloadHash: env.descriptor.payloadHash, target, context: nativeContext, purpose: command.purpose, reason,
      necessityAccepted: true, minimizationAccepted: true, authTime: request.auth.token.auth_time, recordedAt: Timestamp.now(),
      outcome: 'single_field_release_committed', recipientDeliveryVerified: false,
      legalAuthorityVerified: false, corporateDelegationInferred: false};
    const reference = {id: auditId, contentHash: s.supportSourceHash(audit)};
    tx.create(db.collection('support_confidential_access').doc(auditId), audit);
    const receipt = commitLegalReviewReceipt(tx, env, reference);
    return {protocol: 'support_confidential_original_v2', actorId: uid, caseId: id, field: target.field,
      original, accessAudited: true, auditReference: reference, receipt, authorizationScope: 'current_exact_field_only',
      legalAuthorityVerified: false, corporateDelegationInferred: false, financialEffect: 'none'};
  });
}
