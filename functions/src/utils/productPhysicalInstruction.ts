import {productParcelRequested, assertProductParcelNewOpen, PRODUCT_PARCEL_REVIEW_ENABLED} from './productReviewParcel';
/** Source-bound physical handling, never money, certification or medical advice. */
import { Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { db } from '../config/firebase';
import { PRODUCT_REVIEW_EFFECTS, productReviewCaseId, productReviewCaseRef, productReviewContext, productReviewRoles,
  productReviewSourceView, type ProductReviewContext } from './productReviewSource';
import { readProductReviewDocumentarySet, type Reference, type EvidenceReference } from './productReviewWorkflow';
import { prepareOperationalNotices } from './notifications';
import {productMaterialRequested, assertProductMaterialNewOpen} from './productReviewMaterial';
import { supportAdmin, supportCurrentAdminSession, supportHash, supportId, supportObject, supportRequestId,
  supportRevision, supportSourceHash, supportText, supportUid } from './supportRequest';

export const PRODUCT_PHYSICAL_ACTIONS = ['maintain_stop', 'allow_forward_only', 'allow_return_only', 'no_reship_separate_handling'] as const;
export const PRODUCT_PHYSICAL_CRITERIA = ['manufacturer_model_lot', 'recall_applicability', 'corrective_action', 'hygiene_condition', 'route_handling_limits', 'documentation_limits'] as const;
const referenceSet = {protocol: 'product_physical_references_v1', documents: [
  {id: 'hc_recalls', url: 'https://www.canada.ca/en/health-canada/services/consumer-product-safety/reports-publications/industry-professionals/recalling-consumer-products-guide-industry.html'},
  {id: 'hc_second_hand', url: 'https://www.canada.ca/en/health-canada/services/consumer-product-safety/reports-publications/industry-professionals/industry-guide-second-hand-products-including-children-products/guidance-document.html'}],
  criteria: PRODUCT_PHYSICAL_CRITERIA, exhaustiveLegalGuidanceVerified: false, contentFetchedNow: false};
type Leg = 'forward' | 'return';
type Context = ProductReviewContext & {kind: 'order'};
type Set = Awaited<ReturnType<typeof readProductReviewDocumentarySet>>;
type Assessment = {criterion: typeof PRODUCT_PHYSICAL_CRITERIA[number]; qualification: 'unknown' | 'declared' | 'examined' | 'not_applicable'; summary: string};
type SignalReference = {id: string; contentHash: string};
type Command = {parcelCapability?: 'product_review_parcel_v1'; materialCapability?: 'product_review_material_v1'; context: Context; sourceHash: string; semanticSourceHash: string; caseVersion: number; guardVersion: number | null;
  signalReferences: SignalReference[]; action: typeof PRODUCT_PHYSICAL_ACTIONS[number]; leg: Leg | 'none'; routeSourceHash: string | null;
  assessments: Assessment[]; privateNote: string; partyMessage: string; separateHandlingSummary: string | null;
  referenceSetHash: string; documentsConsidered: string[]; acknowledged: true;
  documentaryCorpus: {hash: string; membersHash: string; contributionReferences: Reference[]; evidenceReferences: EvidenceReference[]}};
const HASH = /^[a-f0-9]{64}$/;
const native = (v: unknown): v is Timestamp => v instanceof Timestamp && v.toMillis() > 0 && v.toMillis() <= Date.now();
const documentId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && Buffer.byteLength(v, 'utf8') <= 1500 && !v.includes('/') && !['.', '..'].includes(v) && !/^__.*__$/.test(v);
function contextInput(raw: unknown): Context {
  const c = productReviewContext(raw);
  if (c.kind !== 'order') throw new HttpsError('invalid-argument', 'Commande native requise pour une instruction de transport.');
  return {...c, kind: 'order'};
}
const receiptRef = (uid: string, requestId: string) => db.collection('product_physical_commands').doc(supportHash([uid, requestId]));
const instructionId = (uid: string, requestId: string) => 'pi_' + supportHash([uid, requestId]);
function input(raw: unknown): Command {
  const c = supportObject(raw, ['context', 'sourceHash', 'semanticSourceHash', 'caseVersion', 'guardVersion', 'signalReferences', 'action', 'leg', 'routeSourceHash',
    'assessments', 'privateNote', 'partyMessage', 'separateHandlingSummary', 'referenceSetHash', 'documentsConsidered', 'acknowledged', 'documentaryCorpus', 'parcelCapability', 'materialCapability']);
  const parcel = productParcelRequested(c), material = productMaterialRequested(c);
  if (material && !parcel) throw new HttpsError('invalid-argument', 'Les nouveaux marqueurs physiques appartiennent au tuple colis opté.');
  const corpus = supportObject(c.documentaryCorpus, ['hash', 'membersHash', 'contributionReferences', 'evidenceReferences']);
  if (![c.sourceHash, c.semanticSourceHash, c.referenceSetHash, corpus.hash, corpus.membersHash].every(h => typeof h === 'string' && HASH.test(h)) ||
      !Number.isSafeInteger(c.caseVersion) || c.caseVersion < 0 || c.guardVersion !== null && (!Number.isSafeInteger(c.guardVersion) || c.guardVersion < 1) ||
      !(PRODUCT_PHYSICAL_ACTIONS as readonly unknown[]).includes(c.action) || !['none', 'forward', 'return'].includes(c.leg) || c.acknowledged !== true ||
      !Array.isArray(c.documentsConsidered) || c.documentsConsidered.length > 2 || new globalThis.Set(c.documentsConsidered).size !== c.documentsConsidered.length ||
      c.documentsConsidered.some((id: unknown) => !referenceSet.documents.some(d => d.id === id))) throw new HttpsError('invalid-argument', 'Instruction, sources et appréciations explicites requises.');
  const positive = ['allow_forward_only', 'allow_return_only'].includes(c.action);
  if (positive ? c.leg !== (c.action === 'allow_forward_only' ? 'forward' : 'return') || !HASH.test(c.routeSourceHash ?? '') : c.leg !== 'none' || c.routeSourceHash !== null)
    throw new HttpsError('invalid-argument', 'Trajet exact de l’instruction requis.');
  if (!Array.isArray(c.assessments) || c.assessments.length !== PRODUCT_PHYSICAL_CRITERIA.length) throw new HttpsError('invalid-argument', 'Tous les critères motivés sont requis.');
  const assessments = c.assessments.map((v: unknown): Assessment => {
    const a = supportObject(v, ['criterion', 'qualification', 'summary']);
    if (!(PRODUCT_PHYSICAL_CRITERIA as readonly unknown[]).includes(a.criterion) || !['unknown', 'declared', 'examined', 'not_applicable'].includes(a.qualification)) throw new HttpsError('invalid-argument', 'Appréciation invalide.');
    return {criterion: a.criterion, qualification: a.qualification, summary: supportText(a.summary, 'Appréciation', 2000)};
  });
  if (new globalThis.Set(assessments.map((a: Assessment) => a.criterion)).size !== PRODUCT_PHYSICAL_CRITERIA.length) throw new HttpsError('invalid-argument', 'Critères en double.');
  const refs = (values: unknown): Reference[] => {
    if (!Array.isArray(values) || values.length > 100) throw new HttpsError('invalid-argument', 'Références hors limite.');
    const result = values.map(v => {const r = supportObject(v, ['id', 'contentHash']);
      if (!documentId(r.id) || !HASH.test(r.contentHash ?? '')) throw new HttpsError('invalid-argument', 'Référence native invalide.'); return {id: r.id, contentHash: r.contentHash};});
    if (new globalThis.Set(result.map(r => r.id)).size !== result.length) throw new HttpsError('invalid-argument', 'Référence en double.'); return result;
  };
  const signalReferences = refs(c.signalReferences);
  if (signalReferences.some(r => !/^ps_[a-f0-9]{64}$/.test(r.id))) throw new HttpsError('invalid-argument', 'Signal natif invalide.');
  if (!Array.isArray(corpus.evidenceReferences) || corpus.evidenceReferences.length > 100) throw new HttpsError('invalid-argument', 'Pièces hors limite.');
  const evidenceReferences: EvidenceReference[] = corpus.evidenceReferences.map((v: unknown) => {
    const r = supportObject(v, ['id', 'contentHash', 'actorId', 'actorRole', 'contributionId', 'contributionHash', 'sourceHash', 'generation', 'crc32c', 'sha256', 'typeDeclared', 'state', 'receiptHash']);
    if (!/^pf_[a-f0-9]{64}$/.test(r.id ?? '') || !['contentHash', 'contributionHash', 'sourceHash', 'sha256', 'receiptHash'].every(k => HASH.test(r[k] ?? '')) ||
        !['buyer', 'seller'].includes(r.actorRole) || !/^pc_[a-f0-9]{64}$/.test(r.contributionId ?? '') ||
        typeof r.generation !== 'string' || !/^\d+$/.test(r.generation) || typeof r.crc32c !== 'string' || !/^[A-Za-z0-9+/]{6}==$/.test(r.crc32c) ||
        !['received_item_photo', 'supporting_document_image', 'expertise_image'].includes(r.typeDeclared) || r.state !== 'received') throw new HttpsError('invalid-argument', 'Pièce native invalide.');
    return {...r, actorId: supportId(r.actorId, 'Auteur')} as EvidenceReference;
  });
  if (new globalThis.Set(evidenceReferences.map(r => r.id)).size !== evidenceReferences.length) throw new HttpsError('invalid-argument', 'Pièce en double.');
  const separateHandlingSummary = c.action === 'no_reship_separate_handling' ? supportText(c.separateHandlingSummary, 'Traitement séparé', 4000) : null;
  if (c.action !== 'no_reship_separate_handling' && c.separateHandlingSummary !== null) throw new HttpsError('invalid-argument', 'Le traitement séparé appartient à son action dédiée.');
  return {...(parcel ? {parcelCapability: 'product_review_parcel_v1' as const, ...(material ? {materialCapability: 'product_review_material_v1' as const} : {})} : {}),
    context: contextInput(c.context), sourceHash: c.sourceHash, semanticSourceHash: c.semanticSourceHash, caseVersion: c.caseVersion, guardVersion: c.guardVersion,
    signalReferences, action: c.action, leg: c.leg, routeSourceHash: c.routeSourceHash, assessments: assessments.sort((a: Assessment, b: Assessment) => a.criterion < b.criterion ? -1 : a.criterion > b.criterion ? 1 : 0),
    privateNote: supportText(c.privateNote, 'Motivation privée', 4000), partyMessage: supportText(c.partyMessage, 'Message aux parties', 4000), separateHandlingSummary,
    referenceSetHash: c.referenceSetHash, documentsConsidered: [...c.documentsConsidered].sort(), acknowledged: true,
    documentaryCorpus: {hash: corpus.hash, membersHash: corpus.membersHash, contributionReferences: refs(corpus.contributionReferences), evidenceReferences}};
}
function members(manifest: Set['manifest']) {
  // Availability is derived from these same immutable member hashes; do not
  // require a different reader capability to requalify a native safety guard.
  const {sourceHash: _sourceHash, parcelReview: _parcelReview, ...body} = manifest;
  return body;
}
/** These are safety/registered-route facts, not financial approval or mutable
 * bookkeeping of the admitted label/return protocol. Those consumers retain
 * their own native source/quote/ledger/effect gates. */
function semanticSource(context: Context, order: FirebaseFirestore.DocumentData, article: FirebaseFirestore.DocumentData | undefined) {
  const articleSafety = article ? Object.fromEntries(['sellerId', 'title', 'description', 'category', 'categoryIds', 'condition', 'size', 'brandStatus', 'brand',
    'materials', 'material', 'hasKnownDefects', 'defectsDescription', 'hasAlterations', 'alterationsDescription', 'images', 'hygieneDeclaration', 'childSafetyDeclaration', 'saleUnit']
    .filter(k => article[k] !== undefined).map(k => [k, article[k]])) : null;
  return {protocol: 'product_physical_semantic_source_v1', transactionId: context.id, articleId: order.articleId ?? null,
    buyerId: order.buyerId ?? null, sellerId: order.sellerId ?? null, deliveryType: order.deliveryType ?? null,
    articleSnapshotHash: supportSourceHash(order.articleSnapshot ?? null), articleSafetyContentHash: supportSourceHash(articleSafety),
    shippingSnapshotHash: supportSourceHash(order.shippingSnapshot ?? null), shippingAddressHash: supportSourceHash(order.shippingAddress ?? null),
    ...(Object.prototype.hasOwnProperty.call(order,'operationalRoutes') || Object.prototype.hasOwnProperty.call(order,'labelRouteReview')
      ? {routeAmendmentSourceHash:supportSourceHash({operationalRoutes:order.operationalRoutes??null,review:order.labelRouteReview??null})} : {}),
    guard: order.productPhysicalReview ?? null};
}
function routeSourceHash(context: Context, order: FirebaseFirestore.DocumentData, leg: Leg): string | null {
  const s = order.shippingSnapshot;
  if (order.deliveryType !== 'shipping' || s?.schemaVersion !== 1 || s.provider !== 'shipengine' || !s.origin || !s.destination || !s.parcel || !s.rate) return null;
  return supportSourceHash({protocol: 'product_physical_registered_route_v1', transactionId: context.id, leg,
    buyerId: order.buyerId, sellerId: order.sellerId, articleId: order.articleId, shippingSnapshot: s,
    ...(leg === 'return' ? {outboundLabelId: order.shipEngineLabelId ?? null} : {})});
}
async function current(tx: FirebaseFirestore.Transaction, context: Context, suppliedOrder?: FirebaseFirestore.DocumentData, material = false, parcel = false) {
  const set = await readProductReviewDocumentarySet(tx, context, material, parcel), order = (await tx.get(db.collection('transactions').doc(context.id))).data();
  if (!order || order.buyerId !== set.source.document.nativeActors.buyerId || order.sellerId !== set.source.document.nativeActors.sellerId ||
      suppliedOrder && supportSourceHash(suppliedOrder) !== supportSourceHash(order)) throw new HttpsError('failed-precondition', 'Source native de commande à rapprocher.');
  const page = await tx.get(productReviewCaseRef(context).collection('physical_signals').orderBy('__name__').limit(101));
  const signals = page.docs.slice(0, 100).map(row => {
    const d = row.data().document, c = set.contributionRows.find(r => r.id === d?.contributionId), proof = c?.proof;
    const qualified = row.data().protocol === 'product_physical_signal_v1' && d?.protocol === row.data().protocol && d.signalId === row.id &&
      row.data().signalId === row.id && /^ps_[a-f0-9]{64}$/.test(row.id) && d.transactionId === context.id && d.caseId === set.source.caseId &&
      d.buyerId === order.buyerId && d.sellerId === order.sellerId && ['buyer', 'seller'].includes(d.actorRole) &&
      d.actorId === order[`${d.actorRole}Id`] && ['recall', 'hygiene'].includes(d.topic) && native(d.recordedAt) &&
      row.data().contentHash === supportSourceHash(d) && proof && proof.actorId === d.actorId && proof.actorRole === d.actorRole &&
      proof.topic === d.topic && c?.contentHash === d.contributionHash && proof.sourceHash === d.sourceHash && proof.recordedAt.isEqual(d.recordedAt) &&
      row.id === 'ps_' + supportHash([proof.actorId, proof.requestId]) && d.physicalFactsVerified === false && d.financialEffectAuthorized === false;
    return {id: row.id, contentHash: qualified ? row.data().contentHash as string : null, qualified: !!qualified};
  });
  const routes:{forward:string|null;return:string|null}={forward:routeSourceHash(context,order,'forward'),return:routeSourceHash(context,order,'return')};
  for(const leg of ['forward','return'] as const)if(Object.prototype.hasOwnProperty.call(order.operationalRoutes??{},leg)){
    const {readAcceptedRouteAmendment}=await import('./labelRouteAmendment');
    const amendment=await readAcceptedRouteAmendment(tx,{transactionId:context.id,leg},order);
    routes[leg]=amendment?supportSourceHash({protocol:'product_physical_amended_route_v1',transactionId:context.id,leg,proposal:amendment.proposal,context:amendment.context}):null;
  }
  const guard = order.productPhysicalReview;
  const guardQualified = guard?.protocol === 'product_physical_review_guard_v1' && guard.transactionId === context.id && guard.caseId === set.source.caseId &&
    guard.buyerId === order.buyerId && guard.sellerId === order.sellerId && guard.reviewRequired === true && guard.source === 'explicit_participant_product_review' &&
    Number.isSafeInteger(guard.version) && guard.version > 0 && guard.version === signals.length && native(guard.firstObservedAt) && native(guard.lastObservedAt) &&
    page.size > 0 && page.size <= 100 && signals.every(r => r.qualified) && signals.some(r => r.id === guard.latestSignalId) &&
    page.docs.find(r => r.id === guard.latestSignalId)?.data().document.recordedAt.isEqual(guard.lastObservedAt) &&
    page.docs.some(r => r.data().document.recordedAt.isEqual(guard.firstObservedAt));
  const article = typeof order.articleId === 'string' && documentId(order.articleId) ? (await tx.get(db.collection('articles').doc(order.articleId))).data() : undefined;
  const semantic = semanticSource(context, order, article);
  return {set, order, signals, guardQualified: !!guardQualified, guardVersion: guardQualified ? guard.version as number : null,
    semantic, semanticSourceHash: supportSourceHash(semantic), membersHash: supportSourceHash(members(set.manifest)),
    routes};
}
async function operator(tx: FirebaseFirestore.Transaction, request: any, uid: string) {
  const claim = await supportCurrentAdminSession(request); await supportAdmin(tx, uid, claim);
  const role = await tx.get(db.collection('users').doc(uid));
  return {protocol: 'current_product_physical_operator_v1', actorId: uid, authTime: request.auth.token.auth_time,
    nativeAdminClaimObserved: claim, authorityQualifiedAtCommit: true, privateRoleRevision: supportRevision(role), privateRoleSourceHash: supportSourceHash(role.data() ?? null)};
}
function positiveReady(state: Awaited<ReturnType<typeof current>>) {
  return state.guardQualified && state.set.documentaryComplete && state.set.source.document.sources.contractSnapshot.qualification === 'native_order_snapshot_recorded' &&
    state.set.source.document.articleSource.present && state.set.source.document.articleSource.sourceHash !== null &&
    state.set.source.document.sources.currentListing.qualification === 'current_listing_recorded';
}
async function nativeProof(tx: FirebaseFirestore.Transaction, context: Context, id: string, raw: any) {
  const d = raw?.document;
  if (raw?.protocol !== 'product_physical_instruction_v1' || d?.protocol !== raw.protocol || raw.instructionId !== id || d.instructionId !== id ||
      id !== instructionId(d.actorId, d.requestId) || d.caseId !== productReviewCaseId(context) || !native(d.recordedAt) || supportSourceHash(d) !== raw.contentHash ||
      d.operatorAuthority?.protocol !== 'current_product_physical_operator_v1' || d.operatorAuthority.actorId !== d.actorId || d.operatorAuthority.authorityQualifiedAtCommit !== true ||
      !Number.isSafeInteger(d.operatorAuthority.authTime) || d.operatorAuthority.authTime < 1 || !Number.isSafeInteger(d.operatorAuthority.authTime * 1000) ||
      d.operatorAuthority.authTime * 1000 > d.recordedAt.toMillis() || typeof d.operatorAuthority.nativeAdminClaimObserved !== 'boolean' || !HASH.test(d.operatorAuthority.privateRoleSourceHash ?? '') ||
      !Number.isSafeInteger(d.caseVersion) || d.caseVersion < 1 || d.physicalComplianceVerified !== false || d.financialEffectAuthorized !== false) return null;
  let c: Command; try {c = input(d.command);} catch {return null;}
  if (supportHash(c.context) !== supportHash(context) || supportHash(c) !== d.payloadHash || supportSourceHash(d.semanticSource) !== c.semanticSourceHash ||
      d.semanticSource?.protocol !== 'product_physical_semantic_source_v1' || d.semanticSource.transactionId !== context.id ||
      d.caseVersion !== c.caseVersion + 1 || d.corpusCapture?.protocol !== 'product_review_documentary_corpus_v1' ||
      supportHash(d.corpusCapture.context) !== supportHash(context) || d.corpusCapture.caseId !== productReviewCaseId(context) || d.corpusCapture.sourceHash !== c.sourceHash ||
      supportSourceHash(d.corpusCapture) !== c.documentaryCorpus.hash || supportSourceHash(members(d.corpusCapture)) !== c.documentaryCorpus.membersHash ||
      supportHash(d.referenceSetCapture) !== c.referenceSetHash || supportHash(d.signalReferences) !== supportHash(c.signalReferences) ||
      !Array.isArray(d.addressedTo) || d.addressedTo.length !== 2 || d.addressedTo.some((p: any) => !['buyer', 'seller'].includes(p.role) || d.semanticSource[`${p.role}Id`] !== p.uid)) return null;
  if (new globalThis.Set(d.addressedTo.map((p: any) => p.role)).size !== 2 || d.semanticSource.buyerId === d.semanticSource.sellerId) return null;
  if (['allow_forward_only', 'allow_return_only'].includes(c.action) && (d.corpusCapture.documentaryComplete !== true || c.guardVersion === null ||
      d.semanticSource.guard?.version !== c.guardVersion || c.assessments.some(a => !['examined', 'not_applicable'].includes(a.qualification)) ||
      c.documentsConsidered.length !== referenceSet.documents.length ||
      supportHash(c.documentaryCorpus.contributionReferences) !== supportHash(d.corpusCapture.contributions.map((r: any) => ({id: r.id, contentHash: r.contentHash}))) ||
      supportHash(c.documentaryCorpus.evidenceReferences) !== supportHash(d.corpusCapture.evidence.map((r: any) => r.reference)))) return null;
  const receipt = (await tx.get(receiptRef(d.actorId, d.requestId))).data();
  const capture = (await tx.get(productReviewCaseRef(context).collection('source_captures').doc(c.sourceHash))).data();
  if (receipt?.protocol !== 'product_physical_command_v1' || receipt.state !== 'committed' || receipt.instructionId !== id || receipt.payloadHash !== d.payloadHash ||
      receipt.actorId !== d.actorId || receipt.requestId !== d.requestId || receipt.caseVersion !== d.caseVersion || !native(receipt.recordedAt) || !receipt.recordedAt.isEqual(d.recordedAt) ||
      supportHash(receipt.command) !== d.payloadHash || capture?.protocol !== 'product_review_source_capture_v1' || capture.sourceHash !== c.sourceHash ||
      supportSourceHash(capture.document) !== c.sourceHash || supportHash(capture.document.context) !== supportHash(context) || !native(capture.capturedAt) ||
      capture.document.nativeActors?.buyerId !== d.semanticSource.buyerId || capture.document.nativeActors?.sellerId !== d.semanticSource.sellerId) return null;
  return {document: d, command: c, contentHash: raw.contentHash as string};
}
async function proof(tx: FirebaseFirestore.Transaction, context: Context, id: string, raw: any) {
  try {return await nativeProof(tx, context, id, raw);} catch (error) {
    if (error instanceof TypeError || error instanceof HttpsError && ['failed-precondition', 'invalid-argument'].includes(error.code)) return null;
    throw error;
  }
}
async function permissionForCurrent(tx: FirebaseFirestore.Transaction, state: Awaited<ReturnType<typeof current>>, leg: Leg) {
  const context: Context = {kind: 'order', id: state.semantic.transactionId}, pointer = state.order.productPhysicalInstruction;
  if (!positiveReady(state) || pointer?.protocol !== 'product_physical_instruction_pointer_v1' || pointer.transactionId !== context.id || pointer.caseId !== state.set.source.caseId ||
      !/^pi_[a-f0-9]{64}$/.test(pointer.instructionId ?? '') || !HASH.test(pointer.contentHash ?? '') ||
      supportHash(state.set.root?.latestPhysicalInstruction) !== supportHash(pointer)) return false;
  const p = await proof(tx, context, pointer.instructionId, (await tx.get(productReviewCaseRef(context).collection('physical_instructions').doc(pointer.instructionId))).data());
  if (p?.document.corpusCapture?.parcelReview != null && !PRODUCT_PARCEL_REVIEW_ENABLED) return false;
  return !!p && p.contentHash === pointer.contentHash && p.document.caseVersion === pointer.caseVersion && p.command.action === (leg === 'forward' ? 'allow_forward_only' : 'allow_return_only') && p.command.leg === leg &&
    p.command.guardVersion === state.guardVersion && p.command.semanticSourceHash === state.semanticSourceHash && p.command.routeSourceHash === state.routes[leg] &&
    p.command.referenceSetHash === supportHash(referenceSet) && p.command.documentaryCorpus.membersHash === state.membersHash &&
    supportHash(p.command.signalReferences) === supportHash(state.signals.map(r => ({id: r.id, contentHash: r.contentHash})));
}
type CurrentInstructionProjection = {
  qualification: 'unrecorded' | 'unknown' | 'historical_sources_changed' | 'native_current_instruction';
  instruction: null | {protocol: 'product_physical_current_instruction_v1'; instructionId: string; contentHash: string;
    action: Command['action']; leg: Command['leg']; partyMessage: string; separateHandlingSummary: string | null; recordedAt: string;
    appliesToCurrentSources: boolean; currentInstructionVerified: boolean; physicalComplianceVerified: false;
    financialEffectAuthorized: false; shippingPermissionGranted: false};
};
/** Current identity comes from both native pointers and the immutable receipt,
 * never history ordering. Even a qualified message grants no transport authority. */
async function currentInstructionProjection(tx: FirebaseFirestore.Transaction, state: Awaited<ReturnType<typeof current>>, uid: string, admin: boolean): Promise<CurrentInstructionProjection> {
  const context: Context = {kind: 'order', id: state.semantic.transactionId}, pointer = state.order.productPhysicalInstruction;
  const orderHasPointer = Object.prototype.hasOwnProperty.call(state.order, 'productPhysicalInstruction');
  const caseHasPointer = !!state.set.root && Object.prototype.hasOwnProperty.call(state.set.root, 'latestPhysicalInstruction');
  if (!orderHasPointer && !caseHasPointer) return {qualification: 'unrecorded', instruction: null};
  if (pointer?.protocol !== 'product_physical_instruction_pointer_v1' || pointer.transactionId !== context.id || pointer.caseId !== state.set.source.caseId ||
      !/^pi_[a-f0-9]{64}$/.test(pointer.instructionId ?? '') || !HASH.test(pointer.contentHash ?? '') || !caseHasPointer ||
      supportHash(state.set.root!.latestPhysicalInstruction) !== supportHash(pointer)) return {qualification: 'unknown', instruction: null};
  const p = await proof(tx, context, pointer.instructionId, (await tx.get(productReviewCaseRef(context).collection('physical_instructions').doc(pointer.instructionId))).data());
  if (!p || p.contentHash !== pointer.contentHash || p.document.caseVersion !== pointer.caseVersion ||
      !admin && !p.document.addressedTo.some((party: any) => party.uid === uid)) return {qualification: 'unknown', instruction: null};
  const sourcesQualified = positiveReady(state);
  const sameSources = p.command.guardVersion === state.guardVersion && p.command.semanticSourceHash === state.semanticSourceHash &&
    p.command.referenceSetHash === supportHash(referenceSet) && p.command.documentaryCorpus.membersHash === state.membersHash &&
    supportHash(p.command.signalReferences) === supportHash(state.signals.map(r => ({id: r.id, contentHash: r.contentHash}))) &&
    (p.command.leg === 'none' ? p.command.routeSourceHash === null : p.command.routeSourceHash === state.routes[p.command.leg]);
  const appliesToCurrentSources = sourcesQualified && sameSources && (p.command.leg === 'none' || await permissionForCurrent(tx, state, p.command.leg));
  return {qualification: appliesToCurrentSources ? 'native_current_instruction' : sourcesQualified ? 'historical_sources_changed' : 'unknown',
    instruction: {protocol: 'product_physical_current_instruction_v1', instructionId: pointer.instructionId, contentHash: p.contentHash,
      action: p.command.action, leg: p.command.leg, partyMessage: p.command.partyMessage, separateHandlingSummary: p.command.separateHandlingSummary,
      recordedAt: p.document.recordedAt.toDate().toISOString(), appliesToCurrentSources, currentInstructionVerified: appliesToCurrentSources,
      physicalComplianceVerified: false, financialEffectAuthorized: false, shippingPermissionGranted: false}};
}
/** Leg-only guard. A true result lifts only this safety stop; all commercial,
 * provider, banking, refund, moderation and fraud checks remain at consumers. */
export async function productPhysicalAllowsLeg(tx: FirebaseFirestore.Transaction, order: FirebaseFirestore.DocumentData, leg: Leg, transactionId?: string): Promise<boolean> {
  if (!Object.prototype.hasOwnProperty.call(order, 'productPhysicalReview')) {
    if (Object.prototype.hasOwnProperty.call(order, 'productPhysicalInstruction')) return false;
    // No backfill or historical receipt mutation. A pre-writer explicit safety
    // contribution is still a review, never evidence that transport is safe.
    if (!transactionId || !documentId(transactionId)) return false;
    const nativeOrder = (await tx.get(db.collection('transactions').doc(transactionId))).data();
    if (!nativeOrder || supportSourceHash(nativeOrder) !== supportSourceHash(order)) return false;
    const context: Context = {kind: 'order', id: transactionId}, root = await tx.get(productReviewCaseRef(context));
    if (!root.exists) return true;
    if (root.data()?.protocol !== 'product_review_case_v1' || root.data()?.caseId !== productReviewCaseId(context)) return false;
    const rows = await tx.get(productReviewCaseRef(context).collection('contributions').orderBy('__name__').limit(101));
    return rows.size <= 100 && !rows.docs.some(row => ['recall', 'hygiene'].includes(row.data().document?.topic));
  }
  const guard = order.productPhysicalReview;
  if (typeof guard?.transactionId !== 'string' || !documentId(guard.transactionId)) return false;
  const context: Context = {kind: 'order', id: guard.transactionId};
  if (transactionId != null && transactionId !== context.id) return false;
  try {
    const state = await current(tx, context, order);
    return permissionForCurrent(tx, state, leg);
  } catch (error) {if (!(error instanceof HttpsError) || !['failed-precondition', 'invalid-argument', 'not-found'].includes(error.code)) throw error; return false;}
}
export async function previewProductPhysicalInstruction(request: any) {
  const uid = supportUid(request), raw = supportObject(request.data, ['operation', 'expectedUid', 'context', 'scope', 'materialCapability', 'parcelCapability']), context = contextInput(raw.context);
  const material = productMaterialRequested(raw), parcel = productParcelRequested(raw);
  if (!['own', 'admin'].includes(raw.scope)) throw new HttpsError('invalid-argument', 'Portée invalide.');
  return db.runTransaction(async tx => {
    const admin = raw.scope === 'admin'; if (admin) await operator(tx, request, uid);
    const state = await current(tx, context, undefined, material, parcel);
    if (!admin && !productReviewRoles(state.set.source, uid).length) throw new HttpsError('permission-denied', 'Commande non autorisée.');
    return {protocol: 'product_physical_preview_v1', actorId: uid, scope: raw.scope, context, caseId: state.set.source.caseId,
      ...(parcel ? {parcelCapability: 'product_review_parcel_v1', ...(material ? {materialCapability: 'product_review_material_v1'} : {})} : {}),
      source: productReviewSourceView(state.set.source, uid), semanticSourceHash: state.semanticSourceHash, caseVersion: state.set.root?.version ?? 0,
      guardQualification: state.guardQualified ? 'native_current_signals' : 'unknown', guardVersion: state.guardVersion,
      signalReferences: state.signals, routes: state.routes, referenceSet, referenceSetHash: supportHash(referenceSet),
      documentaryCorpus: {hash: state.set.corpusHash, membersHash: state.membersHash,
        contributionReferences: admin ? state.set.contributionRows.map(r => ({id: r.id, contentHash: r.contentHash, qualification: r.proof ? 'native_contribution' : 'unknown'})) : [],
        evidenceReferences: admin ? state.set.evidenceRows.map(r => r.reference ? {qualification: 'native_stored_file', evidence: r.reference} : {qualification: 'unknown', evidenceId: r.id, evidence: null}) : []},
      coverage: {...state.set.coverage, ...state.set.documentaryCoverage}, canConsiderRouteForSources: admin && positiveReady(state),
      options: admin ? [...PRODUCT_PHYSICAL_ACTIONS] : [], currentForwardAllowedBySafety: Object.prototype.hasOwnProperty.call(state.order, 'productPhysicalReview')
        ? await permissionForCurrent(tx, state, 'forward') : await productPhysicalAllowsLeg(tx, state.order, 'forward', context.id),
      currentReturnAllowedBySafety: Object.prototype.hasOwnProperty.call(state.order, 'productPhysicalReview')
        ? await permissionForCurrent(tx, state, 'return') : await productPhysicalAllowsLeg(tx, state.order, 'return', context.id), decisionPermissionGranted: false,
      currentInstruction: await currentInstructionProjection(tx, state, uid, admin),
      physicalComplianceVerified: false, fundsFrozenBySafetySignal: false, commercialHandlingIsSeparate: true, ...PRODUCT_REVIEW_EFFECTS};
  });
}
function receiptView(uid: string, requestId: string, command: Command, data?: any) {
  return {protocol: 'product_physical_command_v1', actorId: uid, requestId, command, payloadHash: supportHash(command), caseId: productReviewCaseId(command.context),
    instructionId: data?.instructionId ?? null, caseVersionAtCommit: data?.caseVersion ?? null, state: data?.state ?? 'unrecorded', reason: data?.reason ?? null,
    recordedAt: native(data?.recordedAt) ? data.recordedAt.toDate().toISOString() : null, currentInstructionVerified: false, physicalComplianceVerified: false,
    fundsFrozenBySafetySignal: false, commercialHandlingIsSeparate: true, ...PRODUCT_REVIEW_EFFECTS};
}
export async function commandProductPhysicalInstruction(request: any) {
  const uid = supportUid(request), raw = supportObject(request.data, ['operation', 'expectedUid', 'requestId', 'action', 'command', 'materialCapability', 'parcelCapability']);
  const material = productMaterialRequested(raw), parcel = productParcelRequested(raw);
  if (!['execute', 'observe', 'neutralize'].includes(raw.action)) throw new HttpsError('invalid-argument', 'Action de journal invalide.');
  const requestId = supportRequestId(raw.requestId), command = input(raw.command), hash = supportHash(command), id = instructionId(uid, requestId), ref = productReviewCaseRef(command.context);
  return db.runTransaction(async tx => {
    const prior = (await tx.get(receiptRef(uid, requestId))).data();
    if (prior) {
      if (prior.protocol !== 'product_physical_command_v1' || prior.actorId !== uid || prior.requestId !== requestId || prior.payloadHash !== hash ||
          supportHash(prior.command) !== hash || !native(prior.recordedAt) || !['committed', 'not_executed'].includes(prior.state)) throw new HttpsError('already-exists', 'Intention différente ou reçu inconnu.');
      if (prior.state === 'committed') {
        const p = await proof(tx, command.context, id, (await tx.get(ref.collection('physical_instructions').doc(id))).data());
        if (!p || prior.instructionId !== id || p.document.payloadHash !== hash || p.document.caseVersion !== prior.caseVersion) throw new HttpsError('failed-precondition', 'Reçu physique natif à rapprocher.');
      } else if (prior.instructionId !== null || prior.caseVersion !== null || !['requester_neutralized', 'source_changed', 'incomplete_physical_sources', 'document_capacity_requires_review'].includes(prior.reason)) throw new HttpsError('failed-precondition', 'Non-exécution à rapprocher.');
      return receiptView(uid, requestId, command, prior);
    }
    if (raw.action === 'observe') return receiptView(uid, requestId, command);
    const now = Timestamp.now(), noEffect = (reason: string) => {
      const value = {protocol: 'product_physical_command_v1', actorId: uid, requestId, command, payloadHash: hash, state: 'not_executed', reason, instructionId: null, caseVersion: null, recordedAt: now};
      tx.create(receiptRef(uid, requestId), value); return receiptView(uid, requestId, command, value);
    };
    if (raw.action === 'neutralize') return noEffect('requester_neutralized');
    if (parcel !== (command.parcelCapability === 'product_review_parcel_v1') || parcel && material !== (command.materialCapability === 'product_review_material_v1'))
      throw new HttpsError('invalid-argument', 'Les capacités physiques doivent correspondre au tuple natif opté.');
    assertProductMaterialNewOpen(material); assertProductParcelNewOpen(parcel);
    const authority = await operator(tx, request, uid);
    let state: Awaited<ReturnType<typeof current>>;
    try {state = await current(tx, command.context, undefined, material, parcel);} catch (error) {
      if (error instanceof HttpsError && ['failed-precondition', 'invalid-argument', 'not-found'].includes(error.code)) return noEffect('incomplete_physical_sources');
      throw error;
    }
    if (command.sourceHash !== state.set.source.sourceHash || command.semanticSourceHash !== state.semanticSourceHash || command.caseVersion !== (state.set.root?.version ?? 0) ||
        command.guardVersion !== state.guardVersion || command.documentaryCorpus.hash !== state.set.corpusHash || command.documentaryCorpus.membersHash !== state.membersHash ||
        supportHash(command.signalReferences) !== supportHash(state.signals.map(r => ({id: r.id, contentHash: r.contentHash}))) || command.referenceSetHash !== supportHash(referenceSet)) return noEffect('source_changed');
    const positive = command.action === 'allow_forward_only' || command.action === 'allow_return_only';
    if (command.documentaryCorpus.contributionReferences.some(r => !state.set.contributionRows.some(row => row.proof && row.id === r.id && row.contentHash === r.contentHash)) ||
        command.documentaryCorpus.evidenceReferences.some(r => !state.set.evidenceRows.some(row => row.reference && supportHash(row.reference) === supportHash(r)))) return noEffect('incomplete_physical_sources');
    if (positive && (!positiveReady(state) || command.routeSourceHash !== state.routes[command.leg as Leg] || command.assessments.some(a => !['examined', 'not_applicable'].includes(a.qualification)) ||
        command.documentsConsidered.length !== referenceSet.documents.length ||
        supportHash(command.documentaryCorpus.contributionReferences) !== supportHash(state.set.contributionRows.map(r => ({id: r.id, contentHash: r.contentHash}))) ||
        supportHash(command.documentaryCorpus.evidenceReferences) !== supportHash(state.set.evidenceRows.map(r => r.reference)))) return noEffect('incomplete_physical_sources');
    if (!state.set.root || state.set.root.version >= Number.MAX_SAFE_INTEGER - 1) return noEffect('incomplete_physical_sources');
    const captureRef = ref.collection('source_captures').doc(command.sourceHash), capture = await tx.get(captureRef);
    if (capture.exists && (capture.data()?.protocol !== 'product_review_source_capture_v1' || capture.data()?.sourceHash !== command.sourceHash || supportSourceHash(capture.data()?.document) !== command.sourceHash)) return noEffect('incomplete_physical_sources');
    const instructionRef = ref.collection('physical_instructions').doc(id);
    if ((await tx.get(instructionRef)).exists) throw new HttpsError('failed-precondition', 'Instruction sans reçu à rapprocher.');
    const addressedTo = (['buyer', 'seller'] as const).map(role => ({role, uid: state.order[`${role}Id`]}));
    const notices = await prepareOperationalNotices(tx, addressedTo.map(p => ({eventKey: `product_physical_instruction_v1:${id}:${p.uid}`, userId: p.uid,
      type: 'product_review_update', title: 'Instruction pour le transport', message: `${command.partyMessage}\n\nLes recours et le traitement commercial restent distincts. Cette instruction ne décide ni d’un remboursement ni d’un gel de fonds.`,
      data: {ownerId: p.uid, productReviewCaseId: state.set.source.caseId, contextKind: 'order', contextId: command.context.id, productPhysicalInstructionId: id}})));
    const caseVersion = state.set.root.version + 1, document = {protocol: 'product_physical_instruction_v1', instructionId: id, caseId: state.set.source.caseId,
      actorId: uid, requestId, command, payloadHash: hash, caseVersion, semanticSource: state.semantic, signalReferences: command.signalReferences,
      corpusCapture: state.set.manifest, referenceSetCapture: referenceSet, operatorAuthority: authority, addressedTo, recordedAt: now,
      physicalComplianceVerified: false, ...PRODUCT_REVIEW_EFFECTS};
    if (Buffer.byteLength(JSON.stringify(document), 'utf8') > 800_000) return noEffect('document_capacity_requires_review');
    const contentHash = supportSourceHash(document), pointer = {protocol: 'product_physical_instruction_pointer_v1', transactionId: command.context.id,
      caseId: state.set.source.caseId, instructionId: id, contentHash, caseVersion};
    if (!capture.exists) tx.create(captureRef, {protocol: 'product_review_source_capture_v1', sourceHash: command.sourceHash, document: state.set.source.document, capturedAt: now});
    tx.create(instructionRef, {protocol: document.protocol, instructionId: id, document, contentHash});
    tx.update(ref, {version: caseVersion, latestPhysicalInstruction: pointer});
    tx.update(db.collection('transactions').doc(command.context.id), {productPhysicalInstruction: pointer});
    const value = {protocol: 'product_physical_command_v1', actorId: uid, requestId, command, payloadHash: hash, state: 'committed', reason: null, instructionId: id, caseVersion, recordedAt: now};
    tx.create(receiptRef(uid, requestId), value); notices.commit(); return receiptView(uid, requestId, command, value);
  });
}
export async function readProductPhysicalInstructions(request: any) {
  const uid = supportUid(request), raw = supportObject(request.data, ['operation', 'expectedUid', 'context', 'scope', 'cursor', 'materialCapability', 'parcelCapability']), context = contextInput(raw.context);
  const material = productMaterialRequested(raw), parcel = productParcelRequested(raw);
  const cursor = raw.cursor == null ? null : supportObject(raw.cursor, ['lastId']).lastId;
  if (!['own', 'admin'].includes(raw.scope) || cursor !== null && !documentId(cursor)) throw new HttpsError('invalid-argument', 'Lecteur physique invalide.');
  return db.runTransaction(async tx => {
    const admin = raw.scope === 'admin'; if (admin) await operator(tx, request, uid);
    const root = (await tx.get(productReviewCaseRef(context))).data();
    if (!root || root.protocol !== 'product_review_case_v1' || root.caseId !== productReviewCaseId(context)) throw new HttpsError('failed-precondition', 'Dossier natif à rapprocher.');
    if (!admin && ![root.nativeActors?.buyerId, root.nativeActors?.sellerId].includes(uid)) throw new HttpsError('permission-denied', 'Dossier non autorisé.');
    let query: FirebaseFirestore.Query = productReviewCaseRef(context).collection('physical_instructions').orderBy('__name__').limit(21);
    if (cursor) query = query.startAfter(cursor);
    const page = await tx.get(query), inspected = page.docs.slice(0, 20), entries = [];
    for (const row of inspected) {
      const p = await proof(tx, context, row.id, row.data());
      if (!p || !parcel && p.command.parcelCapability != null || !admin && !p.document.addressedTo.some((party: any) => party.uid === uid)) entries.push({qualification: 'unknown', instructionId: row.id, instruction: null});
      else entries.push({qualification: 'native_instruction', instruction: {protocol: 'product_physical_instruction_view_v1', instructionId: row.id,
        ...(p.command.parcelCapability ? {parcelCapability: p.command.parcelCapability, ...(p.command.materialCapability ? {materialCapability: p.command.materialCapability} : {})} : {}),
        contentHash: p.contentHash, action: p.command.action, leg: p.command.leg, partyMessage: p.command.partyMessage,
        separateHandlingSummary: p.command.separateHandlingSummary, privateNote: admin ? p.command.privateNote : null,
        assessments: admin ? p.command.assessments : [], documentsConsidered: admin ? p.command.documentsConsidered : [],
        contributionReferences: admin ? p.command.documentaryCorpus.contributionReferences : [], evidenceReferences: admin ? p.command.documentaryCorpus.evidenceReferences : [],
        caseVersionAtCommit: p.document.caseVersion, semanticSourceHash: p.command.semanticSourceHash, recordedAt: p.document.recordedAt.toDate().toISOString(),
        currentInstructionVerified: false, physicalComplianceVerified: false, ...PRODUCT_REVIEW_EFFECTS}});
    }
    return {protocol: 'product_physical_instructions_page_v1', ...(parcel ? {parcelCapability: 'product_review_parcel_v1', ...(material ? {materialCapability: 'product_review_material_v1'} : {})} : {}), actorId: uid, scope: raw.scope, context, caseId: productReviewCaseId(context), entries,
      nextCursor: page.size > 20 ? {lastId: inspected.at(-1)!.id} : null, coverage: {inspected: inspected.length, limit: 20, hasMore: page.size > 20, exhaustiveHistoryVerified: false},
      readAt: Timestamp.now().toDate().toISOString(), privateAnalysisVisible: admin, originalsAccessGranted: false, physicalComplianceVerified: false, ...PRODUCT_REVIEW_EFFECTS};
  });
}
