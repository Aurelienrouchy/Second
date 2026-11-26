/** Preservation for written privacy requests. A response is not a disposal authority. */
import { Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { db } from '../config/firebase';
import { SUPPORT_KINDS, supportHash, supportObject, supportSourceHash, supportText, isSupportAccountUid } from './supportRequest';
import {preparePrivacyPreservationCatalogueChange} from './privacyPreservationCatalogue';

export const PRIVACY_RETENTION_CAPABILITY = 'privacy_retention_v1';
export const PRIVACY_RETENTION_CATEGORIES = ['account_profile', 'saved_searches', 'search_history', 'consents',
  'notifications', 'articles', 'drafts', 'communications', 'reviews', 'swaps', 'swap_zone', 'favorites',
  'media', 'transactions', 'support', 'other_or_unknown'] as const;
export type PrivacyCategory = typeof PRIVACY_RETENTION_CATEGORIES[number];
type Scope = {protocol: 'privacy_scope_v1'; categories: PrivacyCategory[];
  objects: {category: PrivacyCategory; id: string}[]; description: string | null};
type Protection = {allPersonalData: boolean; categories: Partial<Record<PrivacyCategory, null | string[]>>};
const uidValid = isSupportAccountUid;
const idValid = (v: unknown): v is string => typeof v === 'string' && !!v && Buffer.byteLength(v, 'utf8') <= 1500 &&
  !v.includes('/') && !['.', '..'].includes(v) && !/^__.*__$/.test(v);
const stamp = (v: unknown): v is Timestamp => v instanceof Timestamp && v.toMillis() > 0 && v.toMillis() <= Date.now();
const category = (v: unknown): v is PrivacyCategory => (PRIVACY_RETENTION_CATEGORIES as readonly unknown[]).includes(v);
export const isPrivacyRequest = (kind: unknown) => kind === 'personal_data_access' || kind === 'personal_data_correction';
const guardRef = (uid: string) => db.collection('privacy_retention_guards').doc(uid);
const unknownProtection = (): Protection => ({allPersonalData: true, categories: {}});

export function parsePrivacyScope(value: unknown): Scope | null {
  if (value === undefined) return null;
  const s = supportObject(value, ['protocol', 'categories', 'objects', 'description']);
  if (s.protocol !== 'privacy_scope_v1' || !Array.isArray(s.categories) || !s.categories.length || s.categories.length > 16 ||
      s.categories.some(c => !category(c)) || new Set(s.categories).size !== s.categories.length ||
      !Array.isArray(s.objects) || s.objects.length > 20) throw new HttpsError('invalid-argument', 'Périmètre déclaré de confidentialité invalide.');
  const objects = s.objects.map((value: unknown) => {
    const o = supportObject(value, ['category', 'id']);
    if (!category(o.category) || !s.categories.includes(o.category) || !idValid(o.id) || Buffer.byteLength(o.id, 'utf8') > 128)
      throw new HttpsError('invalid-argument', 'Objet déclaré et catégorie requis.');
    return {category: o.category, id: o.id};
  });
  if (new Set(objects.map(o => supportHash(o))).size !== objects.length) throw new HttpsError('invalid-argument', 'Objet déclaré répété.');
  return {protocol: 'privacy_scope_v1', categories: [...s.categories].sort(), objects,
    description: s.description === null ? null : supportText(s.description, 'Périmètre déclaré', 2000)};
}
function protection(value: any): Protection | null {
  if (!value || typeof value.allPersonalData !== 'boolean' || !value.categories || typeof value.categories !== 'object' || Array.isArray(value.categories)) return null;
  if (!value.allPersonalData && Object.keys(value.categories).length === 0) return null;
  for (const [key, ids] of Object.entries(value.categories)) if (!category(key) || ids !== null &&
    (!Array.isArray(ids) || !ids.length || ids.length > 100 || ids.some(id => !idValid(id)) || new Set(ids).size !== ids.length)) return null;
  return {allPersonalData: value.allPersonalData, categories: value.categories};
}
function union(a: Protection, b: Protection): Protection {
  const out: Protection = {allPersonalData: a.allPersonalData || b.allPersonalData, categories: {...a.categories}};
  for (const [key, ids] of Object.entries(b.categories) as [PrivacyCategory, null | string[]][]) {
    if (Object.prototype.hasOwnProperty.call(out.categories, key) && out.categories[key] === null) continue;
    const merged = ids === null ? null : [...new Set([...(out.categories[key] ?? []), ...ids])].sort();
    out.categories[key] = merged !== null && merged.length > 100 ? null : merged;
  }
  return out;
}
function guardProtection(raw: any, uid: string): Protection | null {
  return raw?.protocol === 'privacy_retention_guard_v1' && raw.ownerId === uid &&
    Number.isSafeInteger(raw.version) && raw.version > 0 && stamp(raw.recordedAt) &&
    ['bounded_complete', 'unknown'].includes(raw.legacyCoverage) && raw.releaseAuthorized === false &&
    raw.legacyCoverage === 'bounded_complete' ? protection(raw.protection) : null;
}
async function legacyProtection(tx: FirebaseFirestore.Transaction, uid: string): Promise<{value: Protection; complete: boolean}> {
  const page = await tx.get(db.collection('support_requests').where('ownerId', '==', uid).limit(101));
  if (page.size > 100) return {value: unknownProtection(), complete: false};
  let value: Protection = {allPersonalData: false, categories: {}};
  for (const row of page.docs) {
    const ticket = row.data();
    if (ticket.schemaVersion !== 1 || !(SUPPORT_KINDS as readonly unknown[]).includes(ticket.kind)) return {value: unknownProtection(), complete: false};
    if (!isPrivacyRequest(ticket.kind)) continue;
    const h = ticket.privacyRetention, p = h?.protocol === 'support_privacy_retention_v1' &&
      h.ownerId === uid && h.supportRequestId === row.id && h.releaseAuthorized === false ? protection(h.protection) : null;
    value = union(value, p ?? unknownProtection());
  }
  return {value, complete: true};
}
async function objectOwned(tx: FirebaseFirestore.Transaction, uid: string, c: PrivacyCategory, id: string): Promise<boolean> {
  const userSub: Partial<Record<PrivacyCategory, string>> = {saved_searches: 'savedSearches', search_history: 'searchHistory', consents: 'consents'};
  if (userSub[c]) return (await tx.get(db.collection('users').doc(uid).collection(userSub[c]!).doc(id))).exists;
  if (c === 'account_profile' || c === 'favorites') return id === uid;
  const collections: Partial<Record<PrivacyCategory, string>> = {notifications: 'notifications', articles: 'articles', drafts: 'drafts',
    communications: 'messages', reviews: 'avis', swaps: 'swaps', swap_zone: 'swapPartyItems', transactions: 'transactions', support: 'support_requests'};
  const collection = collections[c]; if (!collection) return false;
  const d = (await tx.get(db.collection(collection).doc(id))).data(); if (!d) return false;
  if (c === 'articles' || c === 'swap_zone') return d.sellerId === uid;
  if (c === 'notifications' || c === 'drafts') return d.userId === uid;
  if (c === 'communications') return d.senderId === uid;
  if (c === 'reviews') return d.reviewerId === uid || d.vendeurId === uid;
  if (c === 'swaps') return d.initiatorId === uid || d.receiverId === uid;
  if (c === 'transactions') return d.buyerId === uid || d.sellerId === uid;
  return d.ownerId === uid;
}
async function scopeProtection(tx: FirebaseFirestore.Transaction, uid: string, scope: Scope | null): Promise<Protection> {
  if (!scope || scope.categories.includes('other_or_unknown')) return unknownProtection();
  const p: Protection = {allPersonalData: false, categories: {}};
  for (const c of scope.categories) {
    const objects = scope.objects.filter(o => o.category === c);
    let qualified = objects.length > 0;
    for (const object of objects) if (!await objectOwned(tx, uid, c, object.id)) qualified = false;
    p.categories[c] = qualified ? objects.map(o => o.id).sort() : null;
  }
  return p;
}
/** Prepare BEFORE any writes in the ticket transaction; commit alongside its
 * version and exact command receipt. Categories can only grow in this packet. */
export async function preparePrivacyRetention(tx: FirebaseFirestore.Transaction, id: string, next: any,
  actorId: string, requestId: string, payloadHash: string, declaredValue?: unknown) {
  if (!isPrivacyRequest(next.kind)) {
    if (declaredValue !== undefined) throw new HttpsError('invalid-argument', 'Un périmètre privé nécessite une demande d’accès ou de rectification.');
    return null;
  }
  const uid = next.ownerId;
  if (!uidValid(uid) || !uidValid(actorId)) throw new HttpsError('failed-precondition', 'Compte privé non qualifié.');
  const catalogue = await preparePrivacyPreservationCatalogueChange(tx, {caseId: id, actorId, requestId, kind: next.kind});
  const gref = guardRef(uid), old = (await tx.get(gref)).data(), known = guardProtection(old, uid);
  const legacy = old ? null : await legacyProtection(tx, uid);
  const oldHold = next.privacyRetention, oldProtection = oldHold?.protocol === 'support_privacy_retention_v1' &&
    oldHold.ownerId === uid && oldHold.supportRequestId === id && oldHold.releaseAuthorized === false ? protection(oldHold.protection) : null;
  const declaredScope = declaredValue === undefined ? oldHold?.declaredScope ?? null : parsePrivacyScope(declaredValue);
  const added = oldHold && declaredValue === undefined ? oldProtection ?? unknownProtection() : await scopeProtection(tx, uid, declaredScope);
  const retained = oldHold ? union(oldProtection ?? unknownProtection(), added) : added;
  const merged = union(old ? known ?? unknownProtection() : legacy!.value, retained), now = Timestamp.now();
  const hold = {protocol: 'support_privacy_retention_v1', ownerId: uid, supportRequestId: id, kind: next.kind,
    state: 'protected_pending_review', declaredScope, protection: retained,
    initialReceivedAtMs: Number.isSafeInteger(next.receivedAtMs) && next.receivedAtMs > 0 ? next.receivedAtMs : null,
    clockOriginSupportRequestId: next.clockOriginSupportRequestId ?? id,
    source: {supportRequestId: id, ticketVersion: next.version, actorId, requestId, payloadHash}, recordedAt: now,
    reason: 'written_access_or_correction_request', reviewCondition: 'qualified_completion_and_recourse_retention_review',
    releaseAuthorized: false, legalExpiryEstablished: false, responseClosesPreservation: false};
  const oldVersion = old?.version;
  const version = typeof oldVersion === 'number' && Number.isSafeInteger(oldVersion) && oldVersion > 0 && oldVersion < Number.MAX_SAFE_INTEGER ? oldVersion + 1 : 1;
  const guard = {protocol: 'privacy_retention_guard_v1', ownerId: uid, version, protection: merged,
    legacyCoverage: old ? known ? 'bounded_complete' : 'unknown' : legacy!.complete ? 'bounded_complete' : 'unknown',
    latestSource: hold.source, recordedAt: now, releaseAuthorized: false,
    ...(old && !known ? {priorUnqualifiedGuardHash: supportSourceHash(old)} : {})};
  return {hold, commit() {catalogue.commit(); tx.set(gref, guard, {merge: true});}};
}
/** Read the SAME guard at the actual Firestore mutation. A concurrent written
 * request changes it and retries that mutation; no pre-BulkWriter permission. */
export async function privacyRetentionDecision(tx: FirebaseFirestore.Transaction, uid: string,
  target?: {category: PrivacyCategory; id: string}) {
  if (!uidValid(uid)) return {blocked: true, qualification: 'unknown' as const};
  const raw = (await tx.get(guardRef(uid))).data();
  const legacy = raw ? null : await legacyProtection(tx, uid), p = raw ? guardProtection(raw, uid) : legacy!.value;
  if (!p) return {blocked: true, qualification: 'unknown' as const};
  const has = Object.keys(p.categories).length > 0 || p.allPersonalData;
  const ids = target ? p.categories[target.category] : undefined;
  const blocked = p.allPersonalData || (!target ? has : Object.prototype.hasOwnProperty.call(p.categories, target.category) &&
    (ids === null || Array.isArray(ids) && ids.includes(target.id)));
  return {blocked, qualification: blocked ? 'native_preservation' as const : 'no_targeted_preservation' as const};
}
export function privacyRetentionView(ticket: any) {
  const h = ticket?.privacyRetention;
  let declaredScope: Scope | null = null, scopeQualified = true;
  try {declaredScope = h?.declaredScope === null ? null : parsePrivacyScope(h?.declaredScope);} catch {scopeQualified = false;}
  const p = h?.protocol === 'support_privacy_retention_v1' && uidValid(h.ownerId) && h.ownerId === ticket.ownerId &&
    idValid(h.supportRequestId) && h.kind === ticket.kind && isPrivacyRequest(h.kind) && stamp(h.recordedAt) &&
    h.source?.supportRequestId === h.supportRequestId && h.source.ticketVersion === ticket.version &&
    uidValid(h.source.actorId) && idValid(h.source.requestId) && /^[a-f0-9]{64}$/.test(h.source.payloadHash ?? '') &&
    h.releaseAuthorized === false && h.legalExpiryEstablished === false && scopeQualified ? protection(h.protection) : null;
  return {protocol: 'support_privacy_retention_view_v1', qualification: p ? 'native_preservation' : 'unknown',
    state: 'protected_pending_review', declaredScope: p ? declaredScope : null,
    protectedCategories: p ? p.allPersonalData ? ['other_or_unknown'] : Object.keys(p.categories) : ['other_or_unknown'],
    protectedObjects: p ? Object.entries(p.categories).flatMap(([category, ids]) => (ids ?? []).map(id => ({category, id}))) : [],
    initialReceivedAt: Number.isSafeInteger(ticket.receivedAtMs) && ticket.receivedAtMs > 0 ? new Date(ticket.receivedAtMs).toISOString() : null,
    ticketVersion: Number.isSafeInteger(ticket.version) ? ticket.version : null,
    reviewCondition: 'qualified_completion_and_recourse_retention_review', releaseAuthorized: false,
    legalExpiryEstablished: false, responseClosesPreservation: false, historicalDeletionReversed: false};
}
