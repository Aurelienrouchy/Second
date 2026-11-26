/** Pages over one native Firestore readTime. No total-row cutoff masquerades as completeness. */
import {Timestamp} from 'firebase-admin/firestore';
import {HttpsError} from 'firebase-functions/v2/https';
import {db} from '../config/firebase';
import {supportHash, supportSourceHash, supportRevision, supportObject, supportText, supportId} from './supportRequest';
import {privacyCaseRef, privacyReference, privacyJson, readPrivacyOperationCase, type PrivacyContext, type PrivacyEnvelope} from './privacyOperationsCore';

type Data = FirebaseFirestore.DocumentData;
const PAGE = 20, MAX_ENTRY_BYTES = 128 * 1024;
type Inventory = {id: string; collection: string; direct?: boolean; field?: string; op?: '=='|'array-contains'; fields: readonly string[]};
const INVENTORY: readonly Inventory[] = [
  {id: 'profile', collection: 'users', direct: true, fields: ['username', 'displayName', 'bio', 'email', 'phoneNumber', 'address', 'addresses', 'dateOfBirth', 'createdAt', 'preferences', 'styleProfile', 'onboardingCompleted', 'authProvider']},
  {id: 'eligibility', collection: 'eligibility_profiles', direct: true, fields: ['dateOfBirth', 'residence', 'sellerActivity', 'consents']},
  {id: 'wallet', collection: 'wallets', direct: true, fields: ['balance', 'pendingBalance', 'heldBalance', 'sellerDebt', 'currency', 'status']},
  {id: 'favorites', collection: 'favorites', direct: true, fields: ['articleIds', 'updatedAt']},
  {id: 'saved_searches', collection: 'users/{uid}/savedSearches', fields: ['name', 'query', 'filters', 'notifyNewItems', 'lastNotifiedAt', 'newItemsCount', 'createdAt']},
  {id: 'search_history', collection: 'users/{uid}/searchHistory', fields: ['query', 'timestamp']},
  {id: 'consents', collection: 'users/{uid}/consents', fields: ['type', 'consentType', 'version', 'policyVersion', 'acceptedAt', 'channel', 'value', 'enabled', 'recordedAt', 'consentRevision', 'state']},
  {id: 'ledger', collection: 'wallets/{uid}/ledger', fields: ['type', 'amount', 'currency', 'transactionId', 'createdAt']},
  {id: 'support', collection: 'support_requests', field: 'ownerId', fields: ['kind', 'status', 'receivedAtMs', 'receivedCivilDate', 'statutoryDueDate']},
  {id: 'articles', collection: 'articles', field: 'sellerId', fields: ['title', 'description', 'price', 'brand', 'size', 'condition', 'createdAt', 'isSold', 'isActive']},
  {id: 'drafts', collection: 'drafts', field: 'userId', fields: ['title', 'description', 'price', 'brand', 'size', 'condition', 'createdAt', 'updatedAt']},
  {id: 'notifications', collection: 'notifications', field: 'userId', fields: ['type', 'title', 'message', 'isRead', 'createdAt']},
  {id: 'messages_sent', collection: 'messages', field: 'senderId', fields: ['content', 'type', 'timestamp']},
  {id: 'chats', collection: 'chats', field: 'participants', op: 'array-contains', fields: ['createdAt', 'updatedAt']},
  {id: 'reviews_authored', collection: 'avis', field: 'reviewerId', fields: ['note', 'text', 'createdAt']},
  {id: 'reviews_received', collection: 'avis', field: 'vendeurId', fields: ['note', 'createdAt']},
  {id: 'purchases', collection: 'transactions', field: 'buyerId', fields: ['status', 'amount', 'totalAmount', 'serviceFee', 'shippingCost', 'deliveryType', 'createdAt', 'shippingAddress', 'shippingSnapshot.destination', 'meetupSpot']},
  {id: 'sales', collection: 'transactions', field: 'sellerId', fields: ['status', 'amount', 'sellerPayout', 'deliveryType', 'createdAt', 'shippingSnapshot.origin', 'meetupSpot']},
  {id: 'shipping_quotes', collection: 'shipping_quotes', field: 'ownerId', fields: ['articleId', 'state', 'createdAt', 'issuedAt', 'validUntil', 'source.destination']},
  {id: 'withdrawals', collection: 'withdrawal_requests', field: 'userId', fields: ['amount', 'currency', 'status', 'createdAt']},
  {id: 'swaps_initiated', collection: 'swaps', field: 'initiatorId', fields: ['status', 'createdAt', 'acceptedAt', 'completedAt']},
  {id: 'swaps_received', collection: 'swaps', field: 'receiverId', fields: ['status', 'createdAt', 'acceptedAt', 'completedAt']},
  {id: 'swap_items', collection: 'swapPartyItems', field: 'sellerId', fields: ['title', 'description', 'createdAt', 'status']},
  {id: 'eligibility_requests', collection: 'eligibility_requests', field: 'ownerId', fields: ['scope', 'status', 'reason', 'createdAt']},
  {id: 'eligibility_audit', collection: 'eligibility_audit', field: 'ownerId', fields: ['action', 'recordedAt']},
];
const ADDRESS_FIELDS = ['id', 'label', 'name', 'phone', 'email', 'street', 'line2', 'city', 'province', 'postalCode', 'country',
  'addressLine1', 'addressLine2', 'cityLocality', 'stateProvince', 'countryCode', 'isDefault'];
/** Only known contact fields, never the opposite endpoint or an arbitrary nested address map. */
function captureField(data: Data, key: string) {
  const parts = key.split('.'); let value: any = data;
  for (const part of parts) {
    if (!value || typeof value !== 'object' || !Object.prototype.hasOwnProperty.call(value, part)) return {present: false};
    value = value[part];
  }
  if (['address', 'addresses', 'shippingAddress', 'shippingSnapshot.destination', 'shippingSnapshot.origin', 'source.destination'].includes(key)) {
    const address = (raw: any) => raw && typeof raw === 'object' && !Array.isArray(raw)
      ? Object.fromEntries(ADDRESS_FIELDS.filter(field => Object.prototype.hasOwnProperty.call(raw, field)).map(field => [field, privacyJson(raw[field])]))
      : privacyJson(raw);
    value = Array.isArray(value) ? value.map(address) : address(value);
  }
  return {present: true, value: privacyJson(value)};
}
export const PRIVACY_INVENTORY = {version: 'privacy_native_inventory_v1', phases: INVENTORY.map(({id, collection, field, op}) => ({id, collection, field: field ?? null, op: op ?? null})),
  unknowns: ['external_auth_storage_stripe_processors_require_separate_current_inventory',
    'unregistered_locations_and_free_text_require_human_search', 'local_device_drafts_and_search_caches_not_read_by_server', 'third_party_and_confidential_fields_excluded_pending_minimization_review'],
  legalSourceUniverseVerified: false} as const;
const captureRef = (caseId: string, id: string) => privacyCaseRef(caseId).collection('privacy_captures').doc(id);
function checked(raw: Data|undefined, context: PrivacyContext, reference: ReturnType<typeof privacyReference>) {
  if (!raw || raw.protocol !== 'privacy_native_capture_v1' || raw.ownerId !== context.ownerId || raw.caseId !== context.caseId ||
      raw.reference?.id !== reference.id || raw.reference?.contentHash !== reference.contentHash ||
      supportSourceHash(raw.scope) !== reference.contentHash || raw.scope.caseSourceHash !== context.sourceHash ||
      !['capturing', 'complete', 'unavailable'].includes(raw.status) || !Number.isSafeInteger(raw.version) || raw.version < 0 ||
      !Array.isArray(raw.cursor?.chats) || raw.cursor.chats.length > PAGE || raw.cursor.chats.some((job: any) =>
        typeof job?.chatId !== 'string' || !job.chatId || job.chatId.includes('/') || job.lastId !== null && (typeof job.lastId !== 'string' || job.lastId.includes('/'))) ||
      !Number.isSafeInteger(raw.cursor?.phase) || raw.cursor.phase < 0 || raw.cursor.phase > INVENTORY.length ||
      raw.cursor.lastId !== null && (typeof raw.cursor.lastId !== 'string' || raw.cursor.lastId.includes('/'))) {
    throw new HttpsError('failed-precondition', 'Capture, périmètre et dossier courants doivent être rapprochés.');
  }
  return raw;
}
export function privacyCaptureView(capture: Data) {
  return {protocol: capture.protocol, reference: capture.reference, caseId: capture.caseId, ownerId: capture.ownerId,
    status: capture.status, version: capture.version, nativeReadTime: {seconds: capture.scope.readTime.seconds, nanoseconds: capture.scope.readTime.nanoseconds},
    cursor: {protocol: 'privacy_capture_position_v1', phase: INVENTORY[capture.cursor.phase]?.id ?? 'done',
      afterId: capture.cursor.lastId, pendingChatPages: capture.cursor.chats.length},
    pages: capture.pages, inspected: capture.inspected, unknownEntries: capture.unknownEntries, reason: capture.reason,
    knownNativeSourceSetClosed: capture.status === 'complete', inventory: PRIVACY_INVENTORY,
    externalSourcesSearched: false, legalSourceUniverseVerified: false, legalRequestCompleted: false};
}
export async function preparePrivacyCapture(tx: FirebaseFirestore.Transaction, context: PrivacyContext, env: PrivacyEnvelope) {
  supportObject(env.command, ['action']);
  const point = context.snapshot.readTime;
  if (!(point instanceof Timestamp) || point.toMillis() <= 0 || point.toMillis() > Date.now() || point.nanoseconds % 1000 !== 0) {
    throw new HttpsError('unavailable', 'Point Firestore natif indisponible ; aucune capture courante de remplacement n’est inventée.');
  }
  const scope = {caseId: context.caseId, ownerId: context.ownerId, caseSourceHash: context.sourceHash,
    readTime: {seconds: point.seconds, nanoseconds: point.nanoseconds}, inventoryVersion: PRIVACY_INVENTORY.version};
  const reference = {id: 'privacy_capture_' + supportHash([env.uid, env.requestId, context.caseId]), contentHash: supportSourceHash(scope)};
  const capture = {protocol: 'privacy_native_capture_v1', reference, caseId: context.caseId, ownerId: context.ownerId, scope,
    status: 'capturing', version: 0, cursor: {phase: 0, lastId: null, chats: []}, pages: 0, inspected: 0, unknownEntries: 0,
    reason: null, createdAt: Timestamp.now()};
  return {reference, commit: () => tx.create(captureRef(context.caseId, reference.id), capture)};
}
class NativePointUnavailable extends Error {}
export async function observePrivacyCapturePage(request: any, caseId: string, rawReference: unknown, expectedVersion: unknown) {
  const reference = privacyReference(rawReference);
  const initial = await db.runTransaction(async tx => {
    const context = await readPrivacyOperationCase(tx, request, caseId), value = checked((await tx.get(captureRef(caseId, reference.id))).data(), context, reference);
    if (value.version !== expectedVersion || value.status !== 'capturing') throw new HttpsError('aborted', 'Relisez la capture avant de continuer.');
    return {context, capture: value};
  });
  const c = initial.capture, p = c.scope.readTime;
  const authorize = () => db.runTransaction(tx => readPrivacyOperationCase(tx, request, caseId));
  try {
    if (!Number.isSafeInteger(p?.seconds) || p.seconds < 1 || !Number.isSafeInteger(p.nanoseconds) || p.nanoseconds < 0 ||
        p.nanoseconds >= 1e9 || p.nanoseconds % 1000 !== 0) throw new NativePointUnavailable();
    const point = new Timestamp(p.seconds, p.nanoseconds);
    if (Date.now() < point.toMillis() || Date.now() - point.toMillis() > 3600_000) throw new NativePointUnavailable();
    await authorize();
    const page = await db.runTransaction(async tx => {
      const get = async (resource: FirebaseFirestore.DocumentReference|FirebaseFirestore.Query) => {
        const snap: any = await tx.get(resource as FirebaseFirestore.DocumentReference);
        if (!(snap.readTime instanceof Timestamp) || !snap.readTime.isEqual(point)) throw new NativePointUnavailable();
        return snap;
      };
      const job = c.cursor.chats[0], phase = job ? {id: 'chat_messages', collection: 'messages', field: 'chatId', fields: ['content', 'type', 'timestamp']} : INVENTORY[c.cursor.phase];
      if (!phase) return {entries: [] as Data[], next: {phase: INVENTORY.length, lastId: null, chats: []}, inspected: 0};
      if (job) {
        const chat = (await get(db.collection('chats').doc(job.chatId))).data();
        if (!Array.isArray(chat?.participants) || !chat.participants.includes(c.ownerId)) throw new NativePointUnavailable();
      }
      const collection = phase.collection.replace('{uid}', c.ownerId), ref = db.collection(collection);
      let rows: FirebaseFirestore.DocumentSnapshot[], more = false;
      if (phase.direct) rows = [await get(ref.doc(c.ownerId))];
      else {
        let query: FirebaseFirestore.Query = phase.field ? ref.where(phase.field, phase.op ?? '==', job ? job.chatId : c.ownerId) : ref;
        query = query.orderBy('__name__').limit(PAGE + 1); if (job ? job.lastId : c.cursor.lastId) query = query.startAfter(job ? job.lastId : c.cursor.lastId);
        const result = await get(query); rows = result.docs.slice(0, PAGE); more = result.size > PAGE;
      }
      const entries = rows.map(row => {
        const data = row.data(), values: Data = {};
        let qualification = row.exists ? 'native_selected_fields' : 'native_document_absent';
        try {for (const key of phase.fields) if (data) {const field = captureField(data, key); if (field.present) values[key] = field.value;}}
        catch {qualification = 'projection_requires_manual_review';}
        if (Buffer.byteLength(JSON.stringify(values), 'utf8') > MAX_ENTRY_BYTES) qualification = 'projection_requires_manual_review';
        const entry = {sourcePath: row.ref.path, sourceRevision: supportRevision(row), sourceHash: supportSourceHash(data ?? null),
          phase: phase.id, exists: row.exists, qualification, values: qualification === 'projection_requires_manual_review' ? null : values,
          thirdPartyMinimizationVerified: false, sourceUniverseVerified: false};
        return {...entry, id: 'privacy_source_' + supportHash([phase.id, row.ref.path]), contentHash: supportSourceHash(entry)};
      });
      const chats = [...c.cursor.chats];
      if (job) {if (more) chats[0] = {...job, lastId: rows.at(-1)!.id}; else chats.shift();}
      else if (phase.id === 'chats') for (const row of rows) chats.push({chatId: row.id, lastId: null});
      return {entries, next: {phase: job ? c.cursor.phase : more ? c.cursor.phase : c.cursor.phase + 1,
        lastId: job ? c.cursor.lastId : more ? rows.at(-1)!.id : null, chats}, inspected: rows.length};
    }, {readOnly: true, readTime: point});
    await authorize();
    return {...initial, reference, page, unavailable: false};
  } catch (error) {
    // Current authority failures are never relabelled as an expired historical point.
    await authorize();
    if (error instanceof HttpsError && ['permission-denied', 'unauthenticated'].includes(error.code)) throw error;
    return {...initial, reference, page: null, unavailable: true};
  }
}
export async function preparePrivacyCaptureAdvance(tx: FirebaseFirestore.Transaction, context: PrivacyContext,
  observed: Awaited<ReturnType<typeof observePrivacyCapturePage>>) {
  const c = checked((await tx.get(captureRef(context.caseId, observed.reference.id))).data(), context, observed.reference);
  if (c.version !== observed.capture.version || supportHash(c.cursor) !== supportHash(observed.capture.cursor)) throw new HttpsError('aborted', 'La capture a avancé.');
  const entries: Data[] = observed.page?.entries ?? [], existing: (Data|undefined)[] = [];
  for (const entry of entries) existing.push((await tx.get(captureRef(context.caseId, c.reference.id).collection('entries').doc(entry.id))).data());
  existing.forEach((row, i) => {if (row && row.contentHash !== entries[i].contentHash) throw new HttpsError('failed-precondition', 'Source contradictoire au même point natif.');});
  const cursor = observed.page?.next ?? c.cursor;
  const next = {...c, version: c.version + 1, status: observed.unavailable ? 'unavailable' : cursor.phase === INVENTORY.length && cursor.chats.length === 0 ? 'complete' : 'capturing', cursor,
    pages: c.pages + (observed.unavailable ? 0 : 1), inspected: c.inspected + (observed.page?.inspected ?? 0),
    unknownEntries: c.unknownEntries + entries.filter(e => e.qualification === 'projection_requires_manual_review').length,
    reason: observed.unavailable ? 'fixed_native_read_point_unavailable' : null};
  return {reference: c.reference, commit() {
    entries.forEach((entry, i) => {if (!existing[i]) tx.create(captureRef(context.caseId, c.reference.id).collection('entries').doc(entry.id), entry);});
    tx.set(captureRef(context.caseId, c.reference.id), next);
  }};
}
export async function readPrivacyCapture(tx: FirebaseFirestore.Transaction, context: PrivacyContext, raw: unknown, after?: unknown) {
  const reference = privacyReference(raw), c = checked((await tx.get(captureRef(context.caseId, reference.id))).data(), context, reference);
  let query = captureRef(context.caseId, reference.id).collection('entries').orderBy('__name__').limit(PAGE + 1);
  if (after != null) query = query.startAfter(supportId(after));
  const page = await tx.get(query), rows = page.docs.slice(0, PAGE);
  return {capture: privacyCaptureView(c), entries: rows.map(row => row.data()),
    nextCursor: page.size > PAGE ? rows.at(-1)!.id : null, exhaustiveLegalSearchVerified: false};
}
export async function preparePrivacyCopy(tx: FirebaseFirestore.Transaction, context: PrivacyContext, env: PrivacyEnvelope) {
  const command = supportObject(env.command, ['action', 'captureReference', 'selections', 'reason', 'minimizationAccepted', 'necessityAccepted']);
  const reference = privacyReference(command.captureReference), c = checked((await tx.get(captureRef(context.caseId, reference.id))).data(), context, reference);
  if (c.status !== 'complete' || command.minimizationAccepted !== true || command.necessityAccepted !== true ||
      !Array.isArray(command.selections) || command.selections.length < 1 || command.selections.length > 20) {
    throw new HttpsError('failed-precondition', 'Capture complète des sources connues et sélection minimisée explicite requises.');
  }
  const entries = [], seen = new Set<string>();
  for (const raw of command.selections) {
    const selection = supportObject(raw, ['entry', 'fields']), entry = privacyReference(selection.entry);
    const row = (await tx.get(captureRef(context.caseId, reference.id).collection('entries').doc(entry.id))).data();
    if (!row || seen.has(entry.id) || row.contentHash !== entry.contentHash || row.qualification !== 'native_selected_fields' ||
        !row.values || !Array.isArray(selection.fields) || !selection.fields.length || selection.fields.length > 20 ||
        new Set(selection.fields).size !== selection.fields.length || selection.fields.some((key: unknown) => typeof key !== 'string' || !Object.prototype.hasOwnProperty.call(row.values, key))) {
      throw new HttpsError('failed-precondition', 'Champs exacts des sources natives effectivement examinés requis.');
    }
    seen.add(entry.id); entries.push({entry, sourcePath: row.sourcePath,
      values: Object.fromEntries(selection.fields.map((field: string) => [field, row.values[field]]))});
  }
  const copy = {protocol: 'privacy_selected_copy_v1', caseId: context.caseId, ownerId: context.ownerId, captureReference: reference,
    entries, reason: supportText(command.reason, 'Motivation de la communication minimisée'),
    recordedBy: env.uid, recordedAt: Timestamp.now(), minimizationAccepted: true, necessityAccepted: true,
    legalRequestCompleted: false, recipientReadingVerified: false, externalSourcesSearched: false};
  const result = {id: 'privacy_copy_' + supportHash([env.uid, env.requestId]), contentHash: supportSourceHash(copy)};
  return {reference: result, commit: () => tx.create(privacyCaseRef(context.caseId).collection('privacy_copies').doc(result.id), {...copy, reference: result})};
}
