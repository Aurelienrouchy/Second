/** Declared routing observations and the ONLY release qualification for their own guard. */
import {Timestamp} from 'firebase-admin/firestore';
import {HttpsError} from 'firebase-functions/v2/https';
import {auth, db} from '../config/firebase';
import {providerUtc, savedLifecycleLabelIdentity} from '../config/shipEngine';
import {prepareOperationalNotices} from './notifications';
import {productReviewCaseId, productReviewCaseRef, productReviewContext, productReviewRoles, productReviewSourceView, PRODUCT_REVIEW_EFFECTS} from './productReviewSource';
import {operatorProductParcelSources, productParcelRequested} from './productReviewParcel';
import {supportAdmin, supportCurrentAdminSession, supportDeclaredDate, supportHash, supportObject, supportRequestId, supportRevision, supportSourceHash, supportText, supportUid} from './supportRequest';

export const PRODUCT_ROUTING_REVIEW_ENABLED: boolean = true;
export const PRODUCT_ROUTING_CAPABILITY = 'product_review_routing_v1';
const HASH = /^[a-f0-9]{64}$/;
const native = (v: unknown): v is Timestamp => v instanceof Timestamp && v.toMillis() >= 0 && v.toMillis() <= Date.now();
const has = (v: any, key: string) => Object.prototype.hasOwnProperty.call(v ?? {}, key);
const documentId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && Buffer.byteLength(v, 'utf8') <= 1500 && !v.includes('/') && !['.', '..'].includes(v) && !/^__.*__$/.test(v);
function choice<T extends string>(v: unknown, allowed: readonly T[]): T {
  if (!allowed.includes(v as T)) throw new HttpsError('invalid-argument', 'Qualification de routage explicite requise.'); return v as T;
}
const text = (v: unknown, max = 1000) => v === null ? null : supportText(v, 'Observation de routage', max);
export function productRoutingRequested(raw: any) {
  if (raw.routingCapability !== undefined && raw.routingCapability !== PRODUCT_ROUTING_CAPABILITY) throw new HttpsError('invalid-argument', 'Version de routage invalide.');
  const selected = raw.routingCapability === PRODUCT_ROUTING_CAPABILITY;
  if (selected && !productParcelRequested(raw)) throw new HttpsError('invalid-argument', 'Le routage requiert le contexte colis natif.');
  return selected;
}
export function assertProductRoutingNewOpen(selected: boolean) {
  if (selected && !PRODUCT_ROUTING_REVIEW_ENABLED) throw new HttpsError('failed-precondition', 'Le parcours de routage est en préparation.', {reason: 'product_routing_not_exposed'});
}
export function parseProductRoutingStatement(value: unknown) {
  const p = supportObject(value, ['protocol', 'leg', 'labelId', 'kind', 'phase', 'correctionReported', 'issuer', 'source', 'occurredAt', 'reference', 'previousPlace', 'observedPlace', 'evidenceAvailability', 'evidenceLimitations']);
  if (p.protocol !== 'product_routing_statement_v1' || p.labelId !== null && (typeof p.labelId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(p.labelId))) throw new HttpsError('invalid-argument', 'Constat de routage invalide.');
  // Observed places are NOT new contractual addresses: foreign transit is allowed.
  const place = (v: unknown) => {if (v === null) return null; const a = supportObject(v, ['country', 'province', 'city', 'postalCode', 'detail']);
    return {country: text(a.country, 100), province: text(a.province, 100), city: text(a.city, 300), postalCode: text(a.postalCode, 100), detail: text(a.detail)};};
  const kind = choice(p.kind, ['transit_observation_only', 'correction_reported', 'destination_disputed', 'unknown'] as const);
  const correctionReported = choice(p.correctionReported, ['declared_yes', 'declared_no', 'unknown'] as const);
  if (kind === 'transit_observation_only' && correctionReported !== 'declared_no' || kind === 'correction_reported' && correctionReported !== 'declared_yes') throw new HttpsError('invalid-argument', 'Nature et correction déclarées contradictoires.');
  return {protocol: 'product_routing_statement_v1' as const, leg: choice(p.leg, ['forward', 'return'] as const), labelId: p.labelId as string | null, kind,
    phase: choice(p.phase, ['intermediate_transit', 'delivery_attempt', 'final_delivery', 'unknown'] as const), correctionReported,
    issuer: text(p.issuer, 500), source: choice(p.source, ['participant_observation', 'carrier_message', 'document_reference', 'unknown'] as const),
    occurredAt: supportDeclaredDate(p.occurredAt, Date.now()), reference: text(p.reference, 500), previousPlace: place(p.previousPlace), observedPlace: place(p.observedPlace),
    evidenceAvailability: choice(p.evidenceAvailability, ['available', 'unavailable', 'unknown'] as const), evidenceLimitations: text(p.evidenceLimitations, 2000)};
}
export type ProductRoutingStatement = ReturnType<typeof parseProductRoutingStatement>;
export const PRODUCT_ROUTING_QUALIFICATION = {routingFactsVerified: false, carrierCorrectionVerified: false, contractAddressChanged: false,
  interceptionPromised: false, physicalRecoveryVerified: false, routingReviewDoesNotApproveMoney: true} as const;
/** Read before any writes; native witness and contribution commit in the caller's TX. */
export async function prepareProductRoutingSignal(tx: FirebaseFirestore.Transaction, context: {kind: string; id: string}, source: any, statement: ProductRoutingStatement | undefined) {
  if (!statement) return null;
  const orderRef = db.collection('transactions').doc(context.id), order = (await tx.get(orderRef)).data();
  if (context.kind !== 'order' || !order || order.buyerId !== source.document.nativeActors.buyerId || order.sellerId !== source.document.nativeActors.sellerId)
    throw new HttpsError('failed-precondition', 'Parties natives du routage inconnues.');
  const guard = order.productRoutingReview;
  if (has(order, 'productRoutingReview') && (guard?.protocol !== 'product_routing_guard_v1' || guard.transactionId !== context.id || guard.caseId !== source.caseId ||
      guard.buyerId !== order.buyerId || guard.sellerId !== order.sellerId || !Number.isSafeInteger(guard.version) || guard.version < 1 || guard.version >= Number.MAX_SAFE_INTEGER - 1 ||
      !native(guard.firstObservedAt) || !native(guard.lastObservedAt))) throw new HttpsError('failed-precondition', 'Témoin de routage à rapprocher.');
  const requiresReview = statement.kind !== 'transit_observation_only';
  return {order, requiresReview, commit(contributionId: string, contributionHash: string, now: Timestamp) {
    if (requiresReview) tx.update(orderRef, {productRoutingReview: {protocol: 'product_routing_guard_v1', transactionId: context.id, caseId: source.caseId,
      buyerId: order.buyerId, sellerId: order.sellerId, version: (guard?.version ?? 0) + 1, latestContributionId: contributionId, latestContributionHash: contributionHash,
      firstObservedAt: guard?.firstObservedAt ?? now, lastObservedAt: now, reviewRequired: true, source: 'explicit_participant_routing_statement'}});
  }};
}
type Context = {kind: 'order'; id: string};
function contextInput(raw: unknown): Context {const c = productReviewContext(raw); if (c.kind !== 'order') throw new HttpsError('invalid-argument', 'Commande native requise.'); return {kind: 'order', id: c.id};}
async function current(tx: FirebaseFirestore.Transaction, context: Context, supplied?: any) {
  const {readProductReviewDocumentarySet} = await import('./productReviewWorkflow');
  const set = await readProductReviewDocumentarySet(tx, context, false, true), order = (await tx.get(db.collection('transactions').doc(context.id))).data();
  if (!order || supplied && supportSourceHash(supplied) !== supportSourceHash(order) || order.buyerId !== set.source.document.nativeActors.buyerId || order.sellerId !== set.source.document.nativeActors.sellerId)
    throw new HttpsError('failed-precondition', 'Source native du routage inconnue.');
  const observations = set.contributionRows.filter(r => r.proof?.command.routingStatement).map(r => ({id: r.id, contentHash: r.contentHash!, proof: r.proof!, statement: r.proof!.command.routingStatement as ProductRoutingStatement}));
  const guardRows = observations.filter(r => r.statement.kind !== 'transit_observation_only'), guard = order.productRoutingReview;
  const guardQualified = guard?.protocol === 'product_routing_guard_v1' && guard.transactionId === context.id && guard.caseId === set.source.caseId && guard.reviewRequired === true &&
    guard.source === 'explicit_participant_routing_statement' && guard.buyerId === order.buyerId && guard.sellerId === order.sellerId && guardRows.length > 0 &&
    guard.version === guardRows.length && native(guard.firstObservedAt) && native(guard.lastObservedAt) &&
    guardRows.some(r => r.id === guard.latestContributionId && r.contentHash === guard.latestContributionHash && r.proof.recordedAt.isEqual(guard.lastObservedAt)) &&
    guardRows.some(r => r.proof.recordedAt.isEqual(guard.firstObservedAt));
  const {sourceHash: _sourceHash, parcelReview: _parcelReview, ...memberBody} = set.manifest;
  const membersHash = supportSourceHash(memberBody), parcel = 'parcelSources' in set.source.document ? set.source.document.parcelSources : null;
  const legs = [];
  for (const leg of ['forward', 'return'] as const) {
    if (!observations.some(r => r.statement.leg === leg)) continue;
    const actual = parcel?.legs.find(l => l.leg === leg), t = actual?.tracking;
    const capture = t?.qualification === 'native_current_capture' ? (await tx.get(db.collection('transactions').doc(context.id).collection('tracking_history').doc(t.captureId))).data() : null;
    const info = capture?.info, saved = savedLifecycleLabelIdentity(context.id, order, leg);
    const created = saved?.providerCreatedAtMs ?? (leg === 'return' ? providerUtc(order.returnRequest?.labelProof?.providerCreatedAt) : native(order.labelCreatedAt) ? order.labelCreatedAt.toMillis() : null);
    const tracking = t?.qualification === 'native_current_capture' && !!capture && native(capture.recordedAt) && capture.displayHash === t.displayHash && HASH.test(info?.sourceContentHash ?? '') &&
      Number.isSafeInteger(info.providerEventAtMs) && Number.isSafeInteger(created) && created! >= 0 &&
      info.providerEventAtMs >= created! && info.providerEventAtMs <= info.providerObservedAtMs && info.providerObservedAtMs <= capture.recordedAt.toMillis() &&
      ['actual_delivery_date', 'normalized_event'].includes(info.providerEventTimeSource)
      ? {sourceHash: t.sourceHash, contentHash: info.sourceContentHash, statusCode: t.providerStatusCode, providerEventAtMs: t.providerEventAtMs, eventTimeSource: info.providerEventTimeSource} : null;
    const route = actual && has(actual, 'currentRoute') ? actual.currentRoute : leg === 'forward' ? parcel?.contractRoute : parcel?.returnRoute;
    const labelQualified = actual?.qualification === 'native_current_label' && !!actual.identity && route?.qualification !== 'unknown' && !!route &&
      observations.filter(r => r.statement.leg === leg).every(r => r.statement.labelId !== null && r.statement.labelId === actual.identity!.labelId);
    legs.push({leg, qualification: labelQualified && tracking ? 'native_current_route_capture' : 'unknown', identity: actual?.identity ?? null, routeSourceHash: route?.sourceHash ?? null, tracking});
  }
  const semantic = {protocol: 'product_routing_semantic_v1', transactionId: context.id, caseId: set.source.caseId, buyerId: order.buyerId, sellerId: order.sellerId,
    articleId: order.articleId ?? null, articleSnapshotHash: supportSourceHash(order.articleSnapshot ?? null), shippingSnapshotHash: supportSourceHash(order.shippingSnapshot ?? null),
    guard: guard ?? null, legs};
  const integrity = set.manifest.parcelReview?.integrityQualified === true && observations.length > 0 && observations.every(r => r.statement.evidenceAvailability !== 'unknown' &&
    (r.statement.evidenceAvailability !== 'available' || set.evidenceRows.some(e => e.reference?.state === 'received' && e.reference.contributionId === r.id)));
  return {set, order, observations, guardQualified: !!guardQualified, semantic, semanticSourceHash: supportSourceHash(semantic), membersHash,
    ready: !!guardQualified && integrity && set.source.document.sources.contractSnapshot.qualification === 'native_order_snapshot_recorded' && legs.length > 0 && legs.every(l => l.qualification === 'native_current_route_capture')};
}
type Current = Awaited<ReturnType<typeof current>>;
type Command = {context: Context; sourceHash: string; semanticSourceHash: string; corpusHash: string; membersHash: string; caseVersion: number;
  action: 'maintain_review' | 'routing_resolved_for_current_sources'; routingFinding: 'correction_examined' | 'no_destination_error_established' | 'unresolved';
  destinationFinding: 'native_destination_examined' | 'unknown'; contradictions: 'resolved_for_reviewed_sources' | 'unresolved' | 'unknown';
  privateNote: string; partyMessage: string; evidenceLimitations: string; acknowledged: true};
function commandInput(value: unknown): Command {
  const c = supportObject(value, ['context', 'sourceHash', 'semanticSourceHash', 'corpusHash', 'membersHash', 'caseVersion', 'action', 'routingFinding', 'destinationFinding', 'contradictions', 'privateNote', 'partyMessage', 'evidenceLimitations', 'acknowledged']);
  if (![c.sourceHash, c.semanticSourceHash, c.corpusHash, c.membersHash].every(h => typeof h === 'string' && HASH.test(h)) || !Number.isSafeInteger(c.caseVersion) || c.caseVersion < 0 || c.acknowledged !== true) throw new HttpsError('invalid-argument', 'Sources et examen exacts requis.');
  const action = choice(c.action, ['maintain_review', 'routing_resolved_for_current_sources'] as const), routingFinding = choice(c.routingFinding, ['correction_examined', 'no_destination_error_established', 'unresolved'] as const),
    destinationFinding = choice(c.destinationFinding, ['native_destination_examined', 'unknown'] as const), contradictions = choice(c.contradictions, ['resolved_for_reviewed_sources', 'unresolved', 'unknown'] as const);
  if (action === 'routing_resolved_for_current_sources' && (routingFinding === 'unresolved' || destinationFinding !== 'native_destination_examined' || contradictions !== 'resolved_for_reviewed_sources')) throw new HttpsError('invalid-argument', 'Une appréciation inconnue ne lève pas la revue de routage.');
  return {context: contextInput(c.context), sourceHash: c.sourceHash, semanticSourceHash: c.semanticSourceHash, corpusHash: c.corpusHash, membersHash: c.membersHash, caseVersion: c.caseVersion,
    action, routingFinding, destinationFinding, contradictions, privateNote: supportText(c.privateNote, 'Motivation privée', 4000), partyMessage: supportText(c.partyMessage, 'Message aux parties', 4000),
    evidenceLimitations: supportText(c.evidenceLimitations, 'Limites des éléments examinés', 2000), acknowledged: true};
}
const receiptRef = (uid: string, id: string) => db.collection('product_routing_commands').doc(supportHash([uid, id]));
const decisionId = (uid: string, id: string) => 'rd_' + supportHash([uid, id]);
async function operator(tx: FirebaseFirestore.Transaction, request: any, uid: string) {
  const currentClaim = await supportCurrentAdminSession(request), at = request.auth.token.auth_time * 1000;
  if (!Number.isSafeInteger(at) || at > Date.now() || Date.now() - at > 300_000) throw new HttpsError('permission-denied', 'Réauthentification récente requise.');
  await supportAdmin(tx, uid, currentClaim);
  const role = await tx.get(db.collection('users').doc(uid));
  if (role.data()?.isAdmin !== true || role.data()?.isActive === false) throw new HttpsError('permission-denied', 'Rôle privé actuel requis.');
  return {actorId: uid, authTime: request.auth.token.auth_time, privateRoleRevision: supportRevision(role), privateRoleHash: supportSourceHash(role.data()), qualifiedAtCommit: true};
}
async function nativeProof(tx: FirebaseFirestore.Transaction, context: Context, id: string, raw: any) {
  const d = raw?.document;
  if (raw?.protocol !== 'product_routing_decision_v1' || d?.protocol !== raw.protocol || d.decisionId !== id || raw.decisionId !== id || !native(d.recordedAt) ||
      !documentId(d.actorId) || typeof d.requestId !== 'string' || id !== decisionId(d.actorId, d.requestId) || raw.contentHash !== supportSourceHash(d) ||
      d.caseId !== productReviewCaseId(context) || d.authority?.actorId !== d.actorId || d.authority.qualifiedAtCommit !== true || !HASH.test(d.authority.privateRoleHash ?? '') ||
      !Number.isSafeInteger(d.authority.authTime) || d.authority.authTime < 1 || !Number.isSafeInteger(d.authority.authTime * 1000) ||
      d.authority.authTime * 1000 > d.recordedAt.toMillis() || d.recordedAt.toMillis() - d.authority.authTime * 1000 > 300_000) return null;
  let c: Command; try {c = commandInput(d.command);} catch {return null;}
  if (supportHash(c.context) !== supportHash(context) || supportHash(c) !== d.payloadHash || supportSourceHash(d.semantic) !== c.semanticSourceHash || d.semantic?.protocol !== 'product_routing_semantic_v1' ||
      d.semantic.transactionId !== context.id || d.semantic.caseId !== productReviewCaseId(context) ||
      !Array.isArray(d.addressedTo) || d.addressedTo.length !== 2 || d.semantic.buyerId === d.semantic.sellerId ||
      supportHash(d.addressedTo) !== supportHash([d.semantic.buyerId, d.semantic.sellerId]) ||
      supportSourceHash(d.corpusCapture) !== c.corpusHash || d.corpusCapture?.caseId !== productReviewCaseId(context) || d.corpusCapture.sourceHash !== c.sourceHash ||
      supportHash(d.corpusCapture.context) !== supportHash(context) || d.financialEffectAuthorized !== false || d.inventoryEffectAuthorized !== false || d.shippingPermissionGranted !== false) return null;
  const {sourceHash: _sourceHash, parcelReview: _parcelReview, ...members} = d.corpusCapture;
  if (supportSourceHash(members) !== c.membersHash) return null;
  const receipt = (await tx.get(receiptRef(d.actorId, d.requestId))).data(), capture = (await tx.get(productReviewCaseRef(context).collection('source_captures').doc(c.sourceHash))).data();
  if (receipt?.protocol !== 'product_routing_command_v1' || receipt.state !== 'committed' || receipt.actorId !== d.actorId || receipt.requestId !== d.requestId || receipt.decisionId !== id ||
      receipt.payloadHash !== d.payloadHash || supportHash(receipt.command) !== d.payloadHash || !native(receipt.recordedAt) || !receipt.recordedAt.isEqual(d.recordedAt) ||
      capture?.protocol !== 'product_review_source_capture_v1' || capture.sourceHash !== c.sourceHash || supportSourceHash(capture.document) !== c.sourceHash || !native(capture.capturedAt) ||
      supportHash(capture.document.context) !== supportHash(context) || capture.document.nativeActors?.buyerId !== d.semantic.buyerId || capture.document.nativeActors?.sellerId !== d.semantic.sellerId) return null;
  return {document: d, command: c, contentHash: raw.contentHash as string};
}
async function proof(tx: FirebaseFirestore.Transaction, context: Context, id: string, raw: any) {
  try {return await nativeProof(tx, context, id, raw);} catch (error) {
    if (error instanceof TypeError || error instanceof HttpsError && ['failed-precondition', 'invalid-argument'].includes(error.code)) return null; throw error;
  }
}
async function authorityCurrent(tx: FirebaseFirestore.Transaction, d: any) {
  const role = (await tx.get(db.collection('users').doc(d.actorId))).data();
  if (role?.isAdmin !== true || role.isActive === false) return false;
  try {const u = await auth.getUser(d.actorId), at = d.authority.authTime * 1000, cutoff = u.tokensValidAfterTime == null ? null : Date.parse(u.tokensValidAfterTime);
    return u.uid === d.actorId && !u.disabled && Number.isSafeInteger(at) && at <= Date.now() && (cutoff === null || Number.isSafeInteger(cutoff) && at >= cutoff);
  } catch {return false;}
}
async function currentDecision(tx: FirebaseFirestore.Transaction, s: Current) {
  const p = s.order.productRoutingDecision;
  if (!has(s.order, 'productRoutingDecision')) return {qualification: 'unrecorded' as const, proof: null};
  if (p?.protocol !== 'product_routing_decision_pointer_v1' || !/^rd_[a-f0-9]{64}$/.test(p.decisionId ?? '') || !HASH.test(p.contentHash ?? '') ||
      p.caseId !== s.set.source.caseId || p.transactionId !== s.semantic.transactionId || supportHash(s.set.root?.latestRoutingDecision ?? null) !== supportHash(p)) return {qualification: 'unknown' as const, proof: null};
  const d = await proof(tx, {kind: 'order', id: s.semantic.transactionId}, p.decisionId, (await tx.get(productReviewCaseRef({kind: 'order', id: s.semantic.transactionId}).collection('routing_decisions').doc(p.decisionId))).data());
  if (!d || d.contentHash !== p.contentHash) return {qualification: 'unknown' as const, proof: null};
  const same = d.command.semanticSourceHash === s.semanticSourceHash && d.command.membersHash === s.membersHash && await authorityCurrent(tx, d.document);
  return {qualification: same && s.ready ? 'native_current_decision' as const : 'historical_sources_changed' as const, proof: d};
}
/** Any malformed presence closes NEW release. No flag from the client is accepted. */
export function productRoutingBlocksRelease(order: any) {return has(order, 'productRoutingReview') || has(order, 'productRoutingDecision');}
export async function productRoutingAllowsRelease(tx: FirebaseFirestore.Transaction, transactionId: string, order: any): Promise<boolean> {
  if (!productRoutingBlocksRelease(order)) return true;
  try {const s = await current(tx, {kind: 'order', id: transactionId}, order), d = await currentDecision(tx, s);
    return PRODUCT_ROUTING_REVIEW_ENABLED && s.ready && d.qualification === 'native_current_decision' && d.proof?.command.action === 'routing_resolved_for_current_sources';
  } catch (error) {if (error instanceof HttpsError && ['failed-precondition', 'invalid-argument', 'not-found'].includes(error.code)) return false; throw error;}
}
function projection(d: NonNullable<Awaited<ReturnType<typeof proof>>>, admin: boolean) {
  return {decisionId: d.document.decisionId, contentHash: d.contentHash, action: d.command.action, partyMessage: d.command.partyMessage,
    recordedAt: d.document.recordedAt.toDate().toISOString(), ...(admin ? {command: d.command, operatorId: d.document.actorId} : {}), ...PRODUCT_ROUTING_QUALIFICATION, ...PRODUCT_REVIEW_EFFECTS};
}
export async function previewProductRoutingReview(request: any) {
  const uid = supportUid(request), raw = supportObject(request.data, ['operation', 'expectedUid', 'context', 'scope', 'routingCapability', 'parcelCapability']);
  if (!productRoutingRequested(raw) || !['own', 'admin'].includes(raw.scope)) throw new HttpsError('invalid-argument', 'Capacité et portée explicites requises.');
  const context = contextInput(raw.context);
  return db.runTransaction(async tx => {
    const admin = raw.scope === 'admin'; if (admin) await operator(tx, request, uid);
    const s = await current(tx, context);
    if (!admin && !productReviewRoles(s.set.source, uid).length) throw new HttpsError('permission-denied', 'Commande privée.');
    const d = await currentDecision(tx, s), parcel = 'parcelSources' in s.set.source.document ? s.set.source.document.parcelSources : null;
    return {protocol: 'product_routing_preview_v1', actorId: uid, context, scope: raw.scope, caseId: s.set.source.caseId, source: productReviewSourceView(s.set.source, uid),
      sourceHash: s.set.source.sourceHash, semanticSourceHash: s.semanticSourceHash, corpusHash: s.set.corpusHash, membersHash: s.membersHash, caseVersion: s.set.root?.version ?? 0,
      guardQualification: s.guardQualified ? 'native_current_routing_signals' : 'unknown', observations: s.observations.filter(r => admin || r.proof.actorId === uid).map(r => ({contributionId: r.id, contentHash: r.contentHash, statement: r.statement})),
      nativeRoutes: admin && parcel ? operatorProductParcelSources(parcel, s.set.source.sourceHash, s.set.corpusHash, true) : null,
      coverage: {...s.set.coverage, ...s.set.documentaryCoverage}, canConsiderRoutingResolution: admin && s.ready,
      options: admin ? ['maintain_review', 'routing_resolved_for_current_sources'] : [],
      currentDecision: {qualification: d.qualification, decision: d.proof ? projection(d.proof, admin) : null},
      releaseAllowedByRoutingOnly: PRODUCT_ROUTING_REVIEW_ENABLED && s.ready && d.qualification === 'native_current_decision' && d.proof?.command.action === 'routing_resolved_for_current_sources',
      ...PRODUCT_ROUTING_QUALIFICATION, ...PRODUCT_REVIEW_EFFECTS};
  });
}
function receiptView(uid: string, requestId: string, command: Command, r?: any) {
  return {protocol: 'product_routing_command_v1', actorId: uid, requestId, command, payloadHash: supportHash(command), caseId: productReviewCaseId(command.context),
    decisionId: r?.decisionId ?? null, state: r?.state ?? 'unrecorded', reason: r?.reason ?? null, recordedAt: native(r?.recordedAt) ? r.recordedAt.toDate().toISOString() : null,
    currentDecisionVerified: false, ...PRODUCT_ROUTING_QUALIFICATION, ...PRODUCT_REVIEW_EFFECTS};
}
export async function commandProductRoutingReview(request: any) {
  const uid = supportUid(request), raw = supportObject(request.data, ['operation', 'expectedUid', 'requestId', 'action', 'command', 'routingCapability', 'parcelCapability']);
  if (!productRoutingRequested(raw)) throw new HttpsError('invalid-argument', 'Capacité de routage requise.');
  const requestId = supportRequestId(raw.requestId), command = commandInput(raw.command), payloadHash = supportHash(command), id = decisionId(uid, requestId), ref = productReviewCaseRef(command.context);
  if (!['execute', 'observe', 'neutralize'].includes(raw.action)) throw new HttpsError('invalid-argument', 'Action invalide.');
  return db.runTransaction(async tx => {
    const prior = (await tx.get(receiptRef(uid, requestId))).data();
    if (prior) {
      if (prior.protocol !== 'product_routing_command_v1' || prior.actorId !== uid || prior.requestId !== requestId || prior.payloadHash !== payloadHash || supportHash(prior.command) !== payloadHash || !native(prior.recordedAt)) throw new HttpsError('already-exists', 'Intention différente ou inconnue.');
      if (prior.state === 'committed') {const p = await proof(tx, command.context, id, (await tx.get(ref.collection('routing_decisions').doc(id))).data());
        if (!p || prior.decisionId !== id || p.document.payloadHash !== payloadHash) throw new HttpsError('failed-precondition', 'Reçu de routage à rapprocher.');
      } else if (prior.state !== 'not_executed' || prior.decisionId !== null || !['requester_neutralized', 'source_changed', 'incomplete_routing_sources', 'document_capacity_requires_review'].includes(prior.reason)) throw new HttpsError('failed-precondition', 'Non-exécution à rapprocher.');
      return receiptView(uid, requestId, command, prior);
    }
    if (raw.action === 'observe') return receiptView(uid, requestId, command);
    const now = Timestamp.now(), noEffect = (reason: string) => {const r = {protocol: 'product_routing_command_v1', actorId: uid, requestId, command, payloadHash, decisionId: null, state: 'not_executed', reason, recordedAt: now}; tx.create(receiptRef(uid, requestId), r); return receiptView(uid, requestId, command, r);};
    if (raw.action === 'neutralize') return noEffect('requester_neutralized');
    assertProductRoutingNewOpen(true);
    const authority = await operator(tx, request, uid);
    let s: Current; try {s = await current(tx, command.context);} catch (error) {if (error instanceof HttpsError && ['failed-precondition', 'invalid-argument', 'not-found'].includes(error.code)) return noEffect('incomplete_routing_sources'); throw error;}
    if (command.sourceHash !== s.set.source.sourceHash || command.semanticSourceHash !== s.semanticSourceHash || command.corpusHash !== s.set.corpusHash || command.membersHash !== s.membersHash || command.caseVersion !== (s.set.root?.version ?? 0)) return noEffect('source_changed');
    if (!s.set.root || !Number.isSafeInteger(s.set.root.version) || s.set.root.version >= Number.MAX_SAFE_INTEGER - 1 || !s.guardQualified || command.action === 'routing_resolved_for_current_sources' && !s.ready) return noEffect('incomplete_routing_sources');
    const captureRef = ref.collection('source_captures').doc(command.sourceHash), capture = await tx.get(captureRef), entryRef = ref.collection('routing_decisions').doc(id), entry = await tx.get(entryRef);
    if (entry.exists || capture.exists && (capture.data()?.sourceHash !== command.sourceHash || supportSourceHash(capture.data()?.document) !== command.sourceHash)) return noEffect('incomplete_routing_sources');
    const document = {protocol: 'product_routing_decision_v1', decisionId: id, caseId: s.set.source.caseId, actorId: uid, requestId, payloadHash, command,
      semantic: s.semantic, corpusCapture: s.set.manifest, authority, addressedTo: [s.order.buyerId, s.order.sellerId], recordedAt: now, ...PRODUCT_ROUTING_QUALIFICATION, ...PRODUCT_REVIEW_EFFECTS};
    if (Buffer.byteLength(JSON.stringify(document), 'utf8') > 800_000) return noEffect('document_capacity_requires_review');
    const notices = await prepareOperationalNotices(tx, [s.order.buyerId, s.order.sellerId].map(userId => ({eventKey: `product_routing_decision_v1:${id}:${userId}`, userId,
      type: 'product_review_update', title: 'Routage de la commande', message: 'Une instruction sur le routage de votre commande a été enregistrée. Consultez le dossier privé ; les décisions commerciales restent distinctes.', data: {ownerId: userId, productReviewCaseId: s.set.source.caseId, contextKind: 'order', contextId: command.context.id}})));
    const contentHash = supportSourceHash(document), pointer = {protocol: 'product_routing_decision_pointer_v1', transactionId: command.context.id, caseId: s.set.source.caseId, decisionId: id, contentHash};
    if (!capture.exists) tx.create(captureRef, {protocol: 'product_review_source_capture_v1', sourceHash: command.sourceHash, document: s.set.source.document, capturedAt: now});
    tx.create(entryRef, {protocol: document.protocol, decisionId: id, document, contentHash});
    tx.update(ref, {version: s.set.root.version + 1, latestRoutingDecision: pointer});
    tx.update(db.collection('transactions').doc(command.context.id), {productRoutingDecision: pointer});
    const receipt = {protocol: 'product_routing_command_v1', actorId: uid, requestId, command, payloadHash, decisionId: id, state: 'committed', reason: null, recordedAt: now};
    tx.create(receiptRef(uid, requestId), receipt); notices.commit(); return receiptView(uid, requestId, command, receipt);
  });
}
export async function readProductRoutingDecisions(request: any) {
  const uid = supportUid(request), raw = supportObject(request.data, ['operation', 'expectedUid', 'context', 'scope', 'cursor', 'routingCapability', 'parcelCapability']);
  if (!productRoutingRequested(raw) || !['own', 'admin'].includes(raw.scope)) throw new HttpsError('invalid-argument', 'Capacité et portée requises.');
  const context = contextInput(raw.context), cursor = raw.cursor == null ? null : supportObject(raw.cursor, ['lastId']).lastId;
  if (cursor !== null && !documentId(cursor)) throw new HttpsError('invalid-argument', 'Curseur invalide.');
  return db.runTransaction(async tx => {
    const admin = raw.scope === 'admin'; if (admin) await operator(tx, request, uid);
    const root = (await tx.get(productReviewCaseRef(context))).data();
    if (!root || root.protocol !== 'product_review_case_v1' || root.caseId !== productReviewCaseId(context)) throw new HttpsError('failed-precondition', 'Dossier à rapprocher.');
    if (!admin && ![root.nativeActors?.buyerId, root.nativeActors?.sellerId].includes(uid)) throw new HttpsError('permission-denied', 'Dossier privé.');
    let query = productReviewCaseRef(context).collection('routing_decisions').orderBy('__name__').limit(21); if (cursor) query = query.startAfter(cursor);
    const page = await tx.get(query), inspected = page.docs.slice(0, 20), entries = [];
    for (const row of inspected) {const p = await proof(tx, context, row.id, row.data()); entries.push(p && (admin || p.document.addressedTo?.includes(uid)) ? {qualification: 'native_recorded_decision', decision: projection(p, admin)} : {qualification: 'unknown', decisionId: row.id, decision: null});}
    return {protocol: 'product_routing_decisions_page_v1', actorId: uid, scope: raw.scope, caseId: productReviewCaseId(context), entries,
      nextCursor: page.size > 20 ? {lastId: inspected.at(-1)!.id} : null, coverage: {inspected: inspected.length, limit: 20, hasMore: page.size > 20, exhaustiveHistoryVerified: false},
      currentDecisionVerified: false, ...PRODUCT_ROUTING_QUALIFICATION, ...PRODUCT_REVIEW_EFFECTS};
  });
}
