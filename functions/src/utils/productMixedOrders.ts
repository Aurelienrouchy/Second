/** Physically mixed orders: private native links, never contractual consolidation. */
import {Timestamp} from 'firebase-admin/firestore';
import {HttpsError} from 'firebase-functions/v2/https';
import {auth, db} from '../config/firebase';
import {providerUtc, savedLifecycleLabelIdentity} from '../config/shipEngine';
import {prepareOperationalNotices} from './notifications';
import {productReviewCaseId, productReviewCaseRef, productReviewContext, productReviewRoles, productReviewSourceView, PRODUCT_REVIEW_EFFECTS} from './productReviewSource';
import {productParcelRequested} from './productReviewParcel';
import {supportAdmin, supportCurrentAdminSession, supportDeclaredDate, supportHash, supportObject, supportRequestId, supportRevision, supportSourceHash, supportText, supportUid} from './supportRequest';

export const PRODUCT_MIXED_ORDERS_ENABLED: boolean = true;
export const PRODUCT_MIXED_ORDERS_CAPABILITY = 'product_review_mixed_orders_v1';
const HASH = /^[a-f0-9]{64}$/;
const has = (v: any, k: string) => Object.prototype.hasOwnProperty.call(v ?? {}, k);
const native = (v: unknown): v is Timestamp => v instanceof Timestamp && Number.isSafeInteger(v.toMillis()) && v.toMillis() >= 0 && v.toMillis() <= Date.now();
const documentId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && Buffer.byteLength(v, 'utf8') <= 1500 && !v.includes('/') && !['.', '..'].includes(v) && !/^__.*__$/.test(v);
function choice<T extends string>(v: unknown, a: readonly T[]): T {if (!a.includes(v as T)) throw new HttpsError('invalid-argument', 'Qualification explicite du mélange requise.'); return v as T;}
type Context = {kind: 'order'; id: string};
function contextInput(value: unknown): Context {const c = productReviewContext(value); if (c.kind !== 'order') throw new HttpsError('invalid-argument', 'Commande native requise.'); return {kind: 'order', id: c.id};}
export function productMixedOrdersRequested(raw: any) {
  if (raw.mixedOrdersCapability !== undefined && raw.mixedOrdersCapability !== PRODUCT_MIXED_ORDERS_CAPABILITY) throw new HttpsError('invalid-argument', 'Version du mélange invalide.');
  const enabled = raw.mixedOrdersCapability === PRODUCT_MIXED_ORDERS_CAPABILITY;
  if (enabled && !productParcelRequested(raw)) throw new HttpsError('invalid-argument', 'Contexte colis explicite requis.'); return enabled;
}
export function assertProductMixedOrdersNewOpen(enabled: boolean) {
  if (enabled && !PRODUCT_MIXED_ORDERS_ENABLED) throw new HttpsError('failed-precondition', 'Le parcours de mélange est en préparation.', {reason: 'product_mixed_orders_not_exposed'});
}
export const PRODUCT_MIXED_ORDERS_QUALIFICATION = {physicalMixVerified: false, otherBuyerContactsDisclosed: false, groupedLinkVisibleToParties: false, contractualConsolidationAuthorized: false,
  interceptionPromised: false, physicalRecoveryVerified: false, otherGuardsUnchanged: true} as const;
export function parseProductMixedOrderStatement(value: unknown) {
  const p = supportObject(value, ['protocol', 'kind', 'leg', 'labelId', 'observedAt', 'description', 'evidenceAvailability', 'evidenceLimitations', 'contestedDecision']);
  if (p.protocol !== 'product_mixed_order_statement_v1' || p.labelId !== null && (typeof p.labelId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(p.labelId))) throw new HttpsError('invalid-argument', 'Constat de mélange invalide.');
  const parent = p.contestedDecision === null ? null : supportObject(p.contestedDecision, ['decisionId', 'contentHash']);
  if (parent && (!/^md_[a-f0-9]{64}$/.test(parent.decisionId ?? '') || !HASH.test(parent.contentHash ?? ''))) throw new HttpsError('invalid-argument', 'Version de décision contestée invalide.');
  return {protocol: 'product_mixed_order_statement_v1' as const, kind: choice(p.kind, ['content_mixed', 'labels_swapped', 'unknown'] as const),
    leg: choice(p.leg, ['forward', 'return'] as const), labelId: p.labelId as string | null, observedAt: supportDeclaredDate(p.observedAt, Date.now()),
    description: supportText(p.description, 'Contenu observé, sans coordonnées d’autres acheteurs', 4000), evidenceAvailability: choice(p.evidenceAvailability, ['available', 'unavailable', 'unknown'] as const),
    evidenceLimitations: p.evidenceLimitations === null ? null : supportText(p.evidenceLimitations, 'Limites déclarées', 2000),
    contestedDecision: parent ? {decisionId: parent.decisionId as string, contentHash: parent.contentHash as string} : null};
}
export type ProductMixedOrderStatement = ReturnType<typeof parseProductMixedOrderStatement>;
const commandRef = (uid: string, id: string) => db.collection('product_mixed_order_commands').doc(supportHash([uid, id]));
const groupRef = (id: string) => db.collection('product_mixed_order_links').doc(id);
const groupId = (uid: string, id: string) => 'mg_' + supportHash([uid, id]);
const decisionId = (uid: string, id: string) => 'md_' + supportHash([uid, id]);
const signalRef = (c: Context, id: string) => productReviewCaseRef(c).collection('mixed_order_signals').doc(id);
const decisionRef = (c: Context, id: string) => productReviewCaseRef(c).collection('mixed_order_decisions').doc(id);
function guardInput(order: any, c: Context) {
  const g = order.productMixedOrderReview;
  if (!has(order, 'productMixedOrderReview')) return null;
  if (g?.protocol !== 'product_mixed_order_guard_v1' || g.transactionId !== c.id || g.caseId !== productReviewCaseId(c) || g.buyerId !== order.buyerId || g.sellerId !== order.sellerId ||
      g.reviewRequired !== true || !Number.isSafeInteger(g.version) || g.version < 1 || g.version >= Number.MAX_SAFE_INTEGER - 1 ||
      !/^ms_[a-f0-9]{64}$/.test(g.latestSignalId ?? '') || !HASH.test(g.latestSignalHash ?? '') || !native(g.firstObservedAt) || !native(g.lastObservedAt)) throw new HttpsError('failed-precondition', 'Témoin de mélange à rapprocher.');
  return g;
}
function commitSignal(tx: FirebaseFirestore.Transaction, c: Context, order: any, d: any, contentHash: string) {
  const old = guardInput(order, c);
  tx.create(signalRef(c, d.signalId), {protocol: 'product_mixed_order_signal_v1', signalId: d.signalId, document: d, contentHash});
  tx.update(db.collection('transactions').doc(c.id), {productMixedOrderReview: {protocol: 'product_mixed_order_guard_v1', transactionId: c.id, caseId: productReviewCaseId(c),
    buyerId: order.buyerId, sellerId: order.sellerId, version: (old?.version ?? 0) + 1, latestSignalId: d.signalId, latestSignalHash: contentHash,
    firstObservedAt: old?.firstObservedAt ?? d.recordedAt, lastObservedAt: d.recordedAt, reviewRequired: true}});
}
/** Participant declaration creates ONLY this order's review, in its existing contribution TX. */
export async function prepareProductMixedOrderSignal(tx: FirebaseFirestore.Transaction, context: {kind: string; id: string}, source: any, statement: ProductMixedOrderStatement | undefined, uid: string, contributionId: string) {
  if (!statement) return null;
  const c = contextInput(context), order = (await tx.get(db.collection('transactions').doc(c.id))).data();
  if (!order || order.buyerId !== source.document.nativeActors.buyerId || order.sellerId !== source.document.nativeActors.sellerId || ![order.buyerId, order.sellerId].includes(uid)) throw new HttpsError('permission-denied', 'Commande participante native requise.');
  guardInput(order, c);
  const id = 'ms_' + supportHash(['participant', contributionId]), prior = await tx.get(signalRef(c, id));
  if (prior.exists) throw new HttpsError('failed-precondition', 'Signal sans reçu à rapprocher.');
  if (statement.contestedDecision) {
    const p = await decisionProof(tx, c, statement.contestedDecision.decisionId, (await tx.get(decisionRef(c, statement.contestedDecision.decisionId))).data());
    if (!p || p.contentHash !== statement.contestedDecision.contentHash || !p.document.addressedTo.includes(uid)) throw new HttpsError('permission-denied', 'Décision propre native requise.');
  }
  return {order, commit(contributionHash: string, now: Timestamp) {
    const d = {protocol: 'product_mixed_order_signal_v1', signalId: id, transactionId: c.id, caseId: source.caseId, origin: 'participant_declaration',
      actorId: uid, contributionId, contributionHash, sourceHash: source.sourceHash, recordedAt: now, ...PRODUCT_MIXED_ORDERS_QUALIFICATION, ...PRODUCT_REVIEW_EFFECTS};
    commitSignal(tx, c, order, d, supportSourceHash(d));
  }};
}
type Binding = {context: Context; sourceHash: string; semanticSourceHash: string; corpusHash: string; membersHash: string; caseVersion: number};
function bindingInput(value: unknown): Binding {
  const r = supportObject(value, ['context', 'sourceHash', 'semanticSourceHash', 'corpusHash', 'membersHash', 'caseVersion']);
  if (![r.sourceHash, r.semanticSourceHash, r.corpusHash, r.membersHash].every(h => typeof h === 'string' && HASH.test(h)) || !Number.isSafeInteger(r.caseVersion) || r.caseVersion < 0) throw new HttpsError('invalid-argument', 'Sources de commande exactes requises.');
  return {context: contextInput(r.context), sourceHash: r.sourceHash, semanticSourceHash: r.semanticSourceHash, corpusHash: r.corpusHash, membersHash: r.membersHash, caseVersion: r.caseVersion};
}
type LinkCommand = {kind: 'link_orders'; members: {reference: Binding; buyerMessage: string; sellerMessage: string}[]; nature: ProductMixedOrderStatement['kind']; contradictions: 'present'|'not_established'|'unknown'; privateNote: string; evidenceLimitations: string; acknowledged: true};
type ReviewCommand = {kind: 'review_order'; reference: Binding; groupContextHash: string|null; action: 'maintain_review'|'resolve_own_review'; finding: 'resolved_for_order'|'unresolved'|'unknown'; contradictions: 'resolved_for_order'|'unresolved'|'unknown'; privateNote: string; buyerMessage: string; sellerMessage: string; evidenceLimitations: string; acknowledged: true};
type Command = LinkCommand | ReviewCommand;
function commandInput(value: unknown): Command {
  const c = supportObject(value, ['kind', 'members', 'nature', 'contradictions', 'privateNote', 'evidenceLimitations', 'acknowledged', 'reference', 'groupContextHash', 'action', 'finding', 'buyerMessage', 'sellerMessage']);
  if (c.acknowledged !== true) throw new HttpsError('invalid-argument', 'Confirmation explicite requise.');
  const common = {privateNote: supportText(c.privateNote, 'Motivation privée', 4000), evidenceLimitations: supportText(c.evidenceLimitations, 'Limites des preuves', 2000), acknowledged: true as const};
  if (c.kind === 'link_orders') {
    if (['reference', 'groupContextHash', 'action', 'finding', 'buyerMessage', 'sellerMessage'].some(k => has(c, k)) || !Array.isArray(c.members) || c.members.length < 2 || c.members.length > 5) throw new HttpsError('invalid-argument', 'Liaison bornée de deux à cinq commandes requise.');
    const members = c.members.map((v: unknown) => {const m = supportObject(v, ['reference', 'buyerMessage', 'sellerMessage']); return {reference: bindingInput(m.reference), buyerMessage: supportText(m.buyerMessage, 'Instruction acheteur', 4000), sellerMessage: supportText(m.sellerMessage, 'Instruction vendeur', 4000)};});
    if (new Set(members.map(m => m.reference.context.id)).size !== members.length) throw new HttpsError('invalid-argument', 'Commandes en double.');
    return {...common, kind: 'link_orders', members: members.sort((a,b) => a.reference.context.id < b.reference.context.id ? -1 : 1), nature: choice(c.nature, ['content_mixed', 'labels_swapped', 'unknown'] as const), contradictions: choice(c.contradictions, ['present', 'not_established', 'unknown'] as const)};
  }
  if (c.kind !== 'review_order' || ['members', 'nature'].some(k => has(c,k)) || c.groupContextHash !== null && !HASH.test(c.groupContextHash ?? '')) throw new HttpsError('invalid-argument', 'Réexamen individuel invalide.');
  const action = choice(c.action, ['maintain_review', 'resolve_own_review'] as const), finding = choice(c.finding, ['resolved_for_order', 'unresolved', 'unknown'] as const), contradictions = choice(c.contradictions, ['resolved_for_order', 'unresolved', 'unknown'] as const);
  if (action === 'resolve_own_review' && (finding !== 'resolved_for_order' || contradictions !== 'resolved_for_order')) throw new HttpsError('invalid-argument', 'Un constat inconnu ne termine pas la revue propre.');
  return {...common, kind: 'review_order', reference: bindingInput(c.reference), groupContextHash: c.groupContextHash, action, finding, contradictions, buyerMessage: supportText(c.buyerMessage, 'Instruction acheteur', 4000), sellerMessage: supportText(c.sellerMessage, 'Instruction vendeur', 4000)};
}
async function operator(tx: FirebaseFirestore.Transaction, request: any, uid: string) {
  const claim = await supportCurrentAdminSession(request), at = request.auth.token.auth_time * 1000;
  if (!Number.isSafeInteger(at) || at > Date.now() || Date.now()-at > 300_000) throw new HttpsError('permission-denied', 'Réauthentification récente requise.');
  await supportAdmin(tx, uid, claim); const role = await tx.get(db.collection('users').doc(uid));
  if (role.data()?.isAdmin !== true || role.data()?.isActive === false) throw new HttpsError('permission-denied', 'Rôle privé actuel requis.');
  return {actorId: uid, authTime: request.auth.token.auth_time, privateRoleRevision: supportRevision(role), privateRoleHash: supportSourceHash(role.data()), qualifiedAtCommit: true};
}
function authorityProof(d: any) {const a = d.authority; return documentId(d.actorId) && d.actorId.length <= 128 && documentId(d.requestId) && d.requestId.length >= 16 && d.requestId.length <= 128 && a?.actorId === d.actorId && a.qualifiedAtCommit === true && HASH.test(a.privateRoleHash ?? '') && Number.isSafeInteger(a.authTime) && a.authTime > 0 && Number.isSafeInteger(a.authTime*1000) && a.authTime*1000 <= d.recordedAt.toMillis() && d.recordedAt.toMillis()-a.authTime*1000 <= 300_000;}
async function authorityCurrent(tx: FirebaseFirestore.Transaction, d: any) {
  const role = (await tx.get(db.collection('users').doc(d.actorId))).data(); if (role?.isAdmin !== true || role.isActive === false) return false;
  try {const u = await auth.getUser(d.actorId), at = d.authority.authTime*1000, cutoff = u.tokensValidAfterTime == null ? null : Date.parse(u.tokensValidAfterTime);
    return u.uid === d.actorId && !u.disabled && Number.isSafeInteger(at) && at <= Date.now() && (cutoff === null || Number.isSafeInteger(cutoff) && at >= cutoff);
  } catch {return false;}
}
async function groupProof(tx: FirebaseFirestore.Transaction, id: string, raw: any) {
  try {
    const d = raw?.document;
    if (raw?.protocol !== 'product_mixed_order_link_v1' || d?.protocol !== raw.protocol || raw.groupId !== id || d.groupId !== id || !native(d.recordedAt) || !authorityProof(d) || id !== groupId(d.actorId,d.requestId) || raw.contentHash !== supportSourceHash(d)) return null;
    const c = commandInput(d.command); if (c.kind !== 'link_orders' || supportHash(c) !== d.payloadHash || !Array.isArray(d.captures) || d.captures.length !== c.members.length || d.financialEffectAuthorized !== false || d.inventoryEffectAuthorized !== false || d.shippingPermissionGranted !== false) return null;
    for (const m of c.members) {
      const capture = d.captures.find((r: any) => r.reference?.context?.id === m.reference.context.id), r = m.reference;
      if (!capture || capture.semantic?.protocol !== 'product_mixed_order_semantic_v1' || capture.manifest?.protocol !== 'product_review_documentary_corpus_v1' || capture.manifest.caseId !== productReviewCaseId(r.context) || supportHash(capture.manifest.context) !== supportHash(r.context) || supportHash(capture.reference) !== supportHash(r) || supportSourceHash(capture.semantic) !== r.semanticSourceHash || supportSourceHash(capture.manifest) !== r.corpusHash || capture.manifest.sourceHash !== r.sourceHash || capture.semantic.transactionId !== r.context.id || capture.semantic.buyerId === capture.semantic.sellerId) return null;
      const {sourceHash:_sourceHash, parcelReview:_parcelReview, ...body} = capture.manifest;
      if (supportSourceHash(body) !== r.membersHash) return null;
      const source = (await tx.get(productReviewCaseRef(r.context).collection('source_captures').doc(r.sourceHash))).data();
      if (source?.protocol !== 'product_review_source_capture_v1' || source.sourceHash !== r.sourceHash || supportSourceHash(source.document) !== r.sourceHash || !native(source.capturedAt) || supportHash(source.document.context) !== supportHash(r.context) ||
          source.document.nativeActors?.buyerId !== capture.semantic.buyerId || source.document.nativeActors?.sellerId !== capture.semantic.sellerId) return null;
    }
    const receipt = (await tx.get(commandRef(d.actorId,d.requestId))).data();
    if (receipt?.protocol !== 'product_mixed_order_command_v1' || receipt.state !== 'committed' || receipt.resultId !== id || receipt.actorId !== d.actorId || receipt.requestId !== d.requestId || receipt.payloadHash !== d.payloadHash || supportHash(receipt.command) !== d.payloadHash || !native(receipt.recordedAt) || !receipt.recordedAt.isEqual(d.recordedAt)) return null;
    return {document:d, command:c, contentHash:raw.contentHash as string};
  } catch (error) {if (error instanceof TypeError || error instanceof HttpsError && ['failed-precondition','invalid-argument'].includes(error.code)) return null; throw error;}
}
async function loadCase(tx: FirebaseFirestore.Transaction, c: Context) {
  const {readProductReviewDocumentarySet} = await import('./productReviewWorkflow');
  const set = await readProductReviewDocumentarySet(tx,c,false,true), order = (await tx.get(db.collection('transactions').doc(c.id))).data();
  if (!order || order.deliveryType !== 'shipping' || set.source.document.nativeActors.buyerId !== order.buyerId || set.source.document.nativeActors.sellerId !== order.sellerId) throw new HttpsError('failed-precondition','Contexte de commandes non qualifié.');
  const rows = await tx.get(productReviewCaseRef(c).collection('mixed_order_signals').orderBy('__name__').limit(101)), signals = [];
  for (const row of rows.docs.slice(0,100)) {
    const raw = row.data(), d = raw.document; let valid = false;
    try {valid = raw.protocol === 'product_mixed_order_signal_v1' && d?.protocol === raw.protocol && raw.signalId === row.id && d.signalId === row.id && /^ms_[a-f0-9]{64}$/.test(row.id) && d.transactionId === c.id && d.caseId === set.source.caseId && native(d.recordedAt) && raw.contentHash === supportSourceHash(d) && d.financialEffectAuthorized === false;
    if (valid && d.origin === 'participant_declaration') {const p = set.contributionRows.find(r => r.id === d.contributionId);
      valid = !!p?.proof?.command.mixedOrderStatement && p.contentHash === d.contributionHash && p.proof.actorId === d.actorId && p.proof.sourceHash === d.sourceHash && p.proof.recordedAt.isEqual(d.recordedAt) && row.id === 'ms_'+supportHash(['participant',d.contributionId]);
    } else if (valid && d.origin === 'operator_link') {
      const g = /^mg_[a-f0-9]{64}$/.test(d.groupId ?? '') ? await groupProof(tx,d.groupId,(await tx.get(groupRef(d.groupId))).data()) : null;
      const m = g?.document.captures.find((r:any)=>r.reference.context.id===c.id);
      valid = !!g && !!m && g.contentHash === d.groupHash && g.document.recordedAt.isEqual(d.recordedAt) && row.id === 'ms_'+supportHash([d.groupId,c.id]) && m.semantic.buyerId===order.buyerId && m.semantic.sellerId===order.sellerId;
    } else valid=false;
    } catch (error) {if (!(error instanceof TypeError) && !(error instanceof HttpsError && ['failed-precondition','invalid-argument'].includes(error.code))) throw error; valid = false;}
    signals.push({id:row.id,contentHash:valid?raw.contentHash as string:null,document:valid?d:null});
  }
  let guard:any=null; try {guard=guardInput(order,c);} catch { /* Unknown never qualifies. */ }
  const guardQualified=!!guard && rows.size>0 && rows.size<=100 && guard.version===signals.length && signals.every(r=>r.document) && signals.some(r=>r.id===guard.latestSignalId && r.contentHash===guard.latestSignalHash && r.document.recordedAt.isEqual(guard.lastObservedAt)) && signals.some(r=>r.document.recordedAt.isEqual(guard.firstObservedAt));
  const {sourceHash:_sourceHash,parcelReview:_parcelReview,...body}=set.manifest, membersHash=supportSourceHash(body);
  const declarations=set.contributionRows.filter(r=>r.proof?.command.mixedOrderStatement);
  const parcel='parcelSources' in set.source.document?set.source.document.parcelSources:null, legs=[];
  // A linked system review can have no statement by this buyer. Its forward
  // native label still belongs to this order; no other party's allegation is copied.
  const wanted=new Set<string>(declarations.length?declarations.map(r=>r.proof!.command.mixedOrderStatement.leg):['forward']);
  for(const leg of ['forward','return'] as const)if(wanted.has(leg)){
    const l=parcel?.legs.find(r=>r.leg===leg), t=l?.tracking, capture=t?.qualification==='native_current_capture'?(await tx.get(db.collection('transactions').doc(c.id).collection('tracking_history').doc(t.captureId))).data():null, info=capture?.info;
    const saved=savedLifecycleLabelIdentity(c.id,order,leg), created=saved?.providerCreatedAtMs??(leg==='return'?providerUtc(order.returnRequest?.labelProof?.providerCreatedAt):native(order.labelCreatedAt)?order.labelCreatedAt.toMillis():null);
    const tracking=t?.qualification==='native_current_capture' && capture && native(capture.recordedAt) && capture.displayHash===t.displayHash && HASH.test(info?.sourceContentHash??'') && Number.isSafeInteger(created) && created!>=0 && Number.isSafeInteger(info.providerEventAtMs) && info.providerEventAtMs>=created! && info.providerEventAtMs<=info.providerObservedAtMs && info.providerObservedAtMs<=capture.recordedAt.toMillis() && ['actual_delivery_date','normalized_event'].includes(info.providerEventTimeSource)
      ?{sourceHash:t.sourceHash,contentHash:info.sourceContentHash,statusCode:t.providerStatusCode,providerEventAtMs:t.providerEventAtMs,eventTimeSource:info.providerEventTimeSource}:null;
    legs.push({leg,identity:l?.identity??null,tracking,qualification:l?.qualification==='native_current_label' && tracking && declarations.filter(r=>r.proof!.command.mixedOrderStatement.leg===leg).every(r=>r.proof!.command.mixedOrderStatement.labelId!==null && r.proof!.command.mixedOrderStatement.labelId===l.identity?.labelId)?'native_current_label_capture':'unknown'});
  }
  const semantic={protocol:'product_mixed_order_semantic_v1',transactionId:c.id,buyerId:order.buyerId,sellerId:order.sellerId,articleId:order.articleId??null,
    articleSnapshotHash:supportSourceHash(order.articleSnapshot??null),shippingSnapshotHash:supportSourceHash(order.shippingSnapshot??null),guard:order.productMixedOrderReview??null,
    signals:signals.map(r=>({id:r.id,contentHash:r.contentHash})),link:order.productMixedOrderLink??null,legs};
  const complete=set.contributionRows.every(r=>r.proof) && set.communicationRows.every(r=>r.proof) && set.evidenceRows.every(r=>r.reference?.state==='received') && set.intentRows.every(r=>r.reference && ['received','not_executed'].includes(r.reference.state)) && Object.values(set.manifest.lookahead).every(v=>v===null) &&
    declarations.every(r=>r.proof!.command.mixedOrderStatement.evidenceAvailability==='unavailable' || set.evidenceRows.some(e=>e.reference?.state==='received' && e.reference.contributionId===r.id));
  const semanticSourceHash=supportSourceHash(semantic), reference:Binding={context:c,sourceHash:set.source.sourceHash,semanticSourceHash,corpusHash:set.corpusHash,membersHash,caseVersion:set.root?.version??0};
  return {context:c,set,order,signals,guardQualified,semantic,reference,ready:guardQualified && complete && set.source.document.sources.contractSnapshot.qualification==='native_order_snapshot_recorded' && legs.length>0 && legs.every(l=>l.qualification==='native_current_label_capture')};
}
type Case=Awaited<ReturnType<typeof loadCase>>;
async function current(tx:FirebaseFirestore.Transaction,c:Context,supplied?:any){
  const own=await loadCase(tx,c); if(supplied && supportSourceHash(supplied)!==supportSourceHash(own.order))throw new HttpsError('failed-precondition','Source de commande changée.');
  if(!has(own.order,'productMixedOrderLink'))return {own,group:null,groupContextHash:null,groupQualified:true,linkedCases:[own]};
  const p=own.order.productMixedOrderLink, signal=p?.protocol==='product_mixed_order_link_pointer_v1' && /^ms_[a-f0-9]{64}$/.test(p.signalId??'')?own.signals.find(r=>r.id===p.signalId&&r.contentHash===p.contentHash)?.document:null;
  const g=signal?.origin==='operator_link' && /^mg_[a-f0-9]{64}$/.test(signal.groupId??'')?await groupProof(tx,signal.groupId,(await tx.get(groupRef(signal.groupId))).data()):null;
  if(!g || g.contentHash!==signal.groupHash || !g.command.members.some(m=>m.reference.context.id===c.id))return {own,group:null,groupContextHash:null,groupQualified:false,linkedCases:[own]};
  const linkedCases:Case[]=[];
  for(const m of g.command.members){const item=m.reference.context.id===c.id?own:await loadCase(tx,m.reference.context), link=item.order.productMixedOrderLink;
    const linkedSignal=item.signals.find(r=>r.id===link?.signalId&&r.contentHash===link?.contentHash)?.document;
    if(link?.protocol!=='product_mixed_order_link_pointer_v1' || linkedSignal?.origin!=='operator_link' || linkedSignal.groupId!==g.document.groupId || linkedSignal.groupHash!==g.contentHash)return {own,group:g,groupContextHash:null,groupQualified:false,linkedCases:[own]};
    linkedCases.push(item);
  }
  const groupContextHash=supportSourceHash({context:c,groupId:g.document.groupId,contentHash:g.contentHash,members:linkedCases.map(m=>({context:m.context,semanticSourceHash:m.reference.semanticSourceHash,membersHash:m.reference.membersHash}))});
  return {own,group:g,groupContextHash,groupQualified:true,linkedCases};
}
async function decisionProof(tx:FirebaseFirestore.Transaction,c:Context,id:string,raw:any){
  try{const d=raw?.document;
    if(raw?.protocol!=='product_mixed_order_decision_v1'||d?.protocol!==raw.protocol||raw.decisionId!==id||d.decisionId!==id||id!==decisionId(d.actorId,d.requestId)||!native(d.recordedAt)||!authorityProof(d)||raw.contentHash!==supportSourceHash(d)||d.financialEffectAuthorized!==false||d.inventoryEffectAuthorized!==false||d.shippingPermissionGranted!==false)return null;
    const command=commandInput(d.command); if(command.kind!=='review_order'||supportHash(command.reference.context)!==supportHash(c)||supportHash(command)!==d.payloadHash||supportSourceHash(d.semantic)!==command.reference.semanticSourceHash||supportSourceHash(d.corpusCapture)!==command.reference.corpusHash||d.corpusCapture.sourceHash!==command.reference.sourceHash||d.semantic.protocol!=='product_mixed_order_semantic_v1'||d.corpusCapture.protocol!=='product_review_documentary_corpus_v1'||d.corpusCapture.caseId!==productReviewCaseId(c)||supportHash(d.corpusCapture.context)!==supportHash(c)||d.semantic.transactionId!==c.id||d.semantic.buyerId===d.semantic.sellerId||supportHash(d.addressedTo)!==supportHash([d.semantic.buyerId,d.semantic.sellerId]))return null;
    const {sourceHash:_sourceHash,parcelReview:_parcelReview,...body}=d.corpusCapture;if(supportSourceHash(body)!==command.reference.membersHash)return null;
    const r=(await tx.get(commandRef(d.actorId,d.requestId))).data(),capture=(await tx.get(productReviewCaseRef(c).collection('source_captures').doc(command.reference.sourceHash))).data();
    if(r?.protocol!=='product_mixed_order_command_v1'||r.actorId!==d.actorId||r.requestId!==d.requestId||r.state!=='committed'||r.resultId!==id||r.payloadHash!==d.payloadHash||supportHash(r.command)!==d.payloadHash||!native(r.recordedAt)||!r.recordedAt.isEqual(d.recordedAt)||capture?.protocol!=='product_review_source_capture_v1'||capture.sourceHash!==command.reference.sourceHash||supportSourceHash(capture.document)!==capture.sourceHash||!native(capture.capturedAt)||supportHash(capture.document.context)!==supportHash(c)||capture.document.nativeActors?.buyerId!==d.semantic.buyerId||capture.document.nativeActors?.sellerId!==d.semantic.sellerId)return null;
    return {document:d,command,contentHash:raw.contentHash as string};
  }catch(error){if(error instanceof TypeError||error instanceof HttpsError&&['failed-precondition','invalid-argument'].includes(error.code))return null;throw error;}
}
type State=Awaited<ReturnType<typeof current>>;
async function disposition(tx:FirebaseFirestore.Transaction,s:State){
  const p=s.own.order.productMixedOrderDecision;if(!has(s.own.order,'productMixedOrderDecision'))return {qualification:'unrecorded' as const,proof:null};
  if(p?.protocol!=='product_mixed_order_decision_pointer_v1'||!/^md_[a-f0-9]{64}$/.test(p.decisionId??'')||!HASH.test(p.contentHash??'')||p.transactionId!==s.own.context.id||supportHash(s.own.set.root?.latestMixedOrderDecision??null)!==supportHash(p))return {qualification:'unknown' as const,proof:null};
  const p2=await decisionProof(tx,s.own.context,p.decisionId,(await tx.get(decisionRef(s.own.context,p.decisionId))).data());if(!p2||p2.contentHash!==p.contentHash)return {qualification:'unknown' as const,proof:null};
  const same=p2.command.reference.semanticSourceHash===s.own.reference.semanticSourceHash&&p2.command.reference.membersHash===s.own.reference.membersHash&&p2.command.groupContextHash===s.groupContextHash&&s.groupQualified&&await authorityCurrent(tx,p2.document);
  return {qualification:same&&s.own.ready&&s.linkedCases.every(c=>c.ready)?'native_current_decision' as const:'historical_sources_changed' as const,proof:p2};
}
export function productMixedOrderBlocksRelease(order:any){return ['productMixedOrderReview','productMixedOrderLink','productMixedOrderDecision'].some(k=>has(order,k));}
/** Lift only this order's guard; all financial/transport/stock decisions remain separate. */
export async function productMixedOrderAllowsRelease(tx:FirebaseFirestore.Transaction,id:string,order:any):Promise<boolean>{
  if(!productMixedOrderBlocksRelease(order))return true;
  try{const s=await current(tx,{kind:'order',id},order),d=await disposition(tx,s);return PRODUCT_MIXED_ORDERS_ENABLED&&d.qualification==='native_current_decision'&&d.proof?.command.action==='resolve_own_review';}
  catch(error){if(error instanceof HttpsError&&['failed-precondition','invalid-argument','not-found'].includes(error.code))return false;throw error;}
}
function decisionView(p:NonNullable<Awaited<ReturnType<typeof decisionProof>>>,uid:string,admin:boolean){
  return {decisionId:p.document.decisionId,contentHash:p.contentHash,action:p.command.action,partyMessage:uid===p.document.semantic.buyerId?p.command.buyerMessage:uid===p.document.semantic.sellerId?p.command.sellerMessage:null,recordedAt:p.document.recordedAt.toDate().toISOString(),...(admin?{command:p.command,operatorId:p.document.actorId}:{}),...PRODUCT_MIXED_ORDERS_QUALIFICATION,...PRODUCT_REVIEW_EFFECTS};
}
function caseView(c:Case,uid:string,admin:boolean){return {reference:c.reference,caseId:c.set.source.caseId,source:productReviewSourceView(c.set.source,uid),guardQualification:c.guardQualified?'native_current_signals':'unknown',
  observations:c.set.contributionRows.filter(r=>r.proof?.command.mixedOrderStatement&&(admin||r.proof.actorId===uid)).map(r=>({contributionId:r.id,contentHash:r.contentHash,statement:r.proof!.command.mixedOrderStatement})),
  coverage:{...c.set.coverage,...c.set.documentaryCoverage},canConsiderResolution:admin&&c.ready};}
export async function previewProductMixedOrders(request:any){
  const uid=supportUid(request),raw=supportObject(request.data,['operation','expectedUid','context','contexts','scope','mixedOrdersCapability','parcelCapability']);
  if(!productMixedOrdersRequested(raw)||!['own','admin'].includes(raw.scope))throw new HttpsError('invalid-argument','Capacité et portée requises.');
  const group=raw.contexts!==undefined;
  if(group&&(raw.scope!=='admin'||raw.context!==undefined||!Array.isArray(raw.contexts)||raw.contexts.length<2||raw.contexts.length>5))throw new HttpsError('invalid-argument','Aperçu opérateur borné requis.');
  const contexts:Context[]=group?raw.contexts.map(contextInput):[contextInput(raw.context)];if(new Set(contexts.map(c=>c.id)).size!==contexts.length)throw new HttpsError('invalid-argument','Commandes en double.');contexts.sort((a,b)=>a.id<b.id?-1:1);
  return db.runTransaction(async tx=>{
    const admin=raw.scope==='admin';if(admin)await operator(tx,request,uid);
    if(group){const cases:Case[]=[];for(const c of contexts)cases.push(await loadCase(tx,c));
      return {protocol:'product_mixed_orders_link_preview_v1',actorId:uid,scope:'admin',members:cases.map(c=>caseView(c,uid,true)),canLinkCurrentSources:cases.every(c=>!has(c.order,'productMixedOrderLink'))&&cases.some(c=>c.set.contributionRows.some(r=>r.proof?.command.mixedOrderStatement)),maxOrders:5,...PRODUCT_MIXED_ORDERS_QUALIFICATION,...PRODUCT_REVIEW_EFFECTS};}
    const s=await current(tx,contexts[0]);if(!admin&&!productReviewRoles(s.own.set.source,uid).length)throw new HttpsError('permission-denied','Dossier propre requis.');const d=await disposition(tx,s);
    return {protocol:'product_mixed_order_preview_v1',actorId:uid,scope:raw.scope,...caseView(s.own,uid,admin),groupContextHash:s.groupContextHash,
      linkQualification:!has(s.own.order,'productMixedOrderLink')?'unlinked':s.groupQualified?'native_link_recorded':'unknown',
      ...(admin?{linkedMembers:s.linkedCases.map(c=>caseView(c,uid,true)),privateLink:s.group?{groupId:s.group.document.groupId,nature:s.group.command.nature,contradictions:s.group.command.contradictions,privateNote:s.group.command.privateNote,evidenceLimitations:s.group.command.evidenceLimitations,members:s.group.command.members}:null}:{}),
      linkInstruction:s.group?{qualification:'native_recorded_link_instruction',partyMessage:uid===s.own.order.buyerId?s.group.command.members.find(m=>m.reference.context.id===s.own.context.id)?.buyerMessage??null:uid===s.own.order.sellerId?s.group.command.members.find(m=>m.reference.context.id===s.own.context.id)?.sellerMessage??null:null,recordedAt:s.group.document.recordedAt.toDate().toISOString()}:{qualification:has(s.own.order,'productMixedOrderLink')?'unknown':'unrecorded',partyMessage:null,recordedAt:null},
      currentDecision:{qualification:d.qualification,decision:d.proof?decisionView(d.proof,uid,admin):null},canConsiderOwnResolution:admin&&s.groupQualified&&s.linkedCases.every(c=>c.ready),
      releaseAllowedByMixedOrderReviewOnly:PRODUCT_MIXED_ORDERS_ENABLED&&d.qualification==='native_current_decision'&&d.proof?.command.action==='resolve_own_review',...PRODUCT_MIXED_ORDERS_QUALIFICATION,...PRODUCT_REVIEW_EFFECTS};
  });
}
function receiptView(uid:string,id:string,c:Command,r?:any){return {protocol:'product_mixed_order_command_v1',actorId:uid,requestId:id,command:c,payloadHash:supportHash(c),state:r?.state??'unrecorded',reason:r?.reason??null,resultId:r?.resultId??null,recordedAt:native(r?.recordedAt)?r.recordedAt.toDate().toISOString():null,currentDecisionVerified:false,...PRODUCT_MIXED_ORDERS_QUALIFICATION,...PRODUCT_REVIEW_EFFECTS};}
function bindingMatches(a:Binding,b:Binding){return supportHash(a)===supportHash(b);}
async function captureReads(tx:FirebaseFirestore.Transaction,cases:Case[]){const result=[];for(const c of cases){const ref=productReviewCaseRef(c.context).collection('source_captures').doc(c.reference.sourceHash),snap=await tx.get(ref);
  if(snap.exists&&(snap.data()?.protocol!=='product_review_source_capture_v1'||snap.data()?.sourceHash!==c.reference.sourceHash||supportSourceHash(snap.data()?.document)!==c.reference.sourceHash))throw new HttpsError('failed-precondition','Capture historique inconnue.');result.push({c,ref,exists:snap.exists});}return result;}
export async function commandProductMixedOrders(request:any){
  const uid=supportUid(request),raw=supportObject(request.data,['operation','expectedUid','requestId','action','command','mixedOrdersCapability','parcelCapability']);if(!productMixedOrdersRequested(raw))throw new HttpsError('invalid-argument','Capacité de mélange requise.');
  const requestId=supportRequestId(raw.requestId),command=commandInput(raw.command),hash=supportHash(command),id=command.kind==='link_orders'?groupId(uid,requestId):decisionId(uid,requestId);
  if(!['execute','observe','neutralize'].includes(raw.action))throw new HttpsError('invalid-argument','Action de journal invalide.');
  return db.runTransaction(async tx=>{
    const prior=(await tx.get(commandRef(uid,requestId))).data();if(prior){
      if(prior.protocol!=='product_mixed_order_command_v1'||prior.actorId!==uid||prior.requestId!==requestId||prior.payloadHash!==hash||supportHash(prior.command)!==hash||!native(prior.recordedAt))throw new HttpsError('already-exists','Intention différente ou reçu inconnu.');
      if(prior.state==='committed'){const p=command.kind==='link_orders'?await groupProof(tx,id,(await tx.get(groupRef(id))).data()):await decisionProof(tx,command.reference.context,id,(await tx.get(decisionRef(command.reference.context,id))).data());if(!p||p.document.payloadHash!==hash||prior.resultId!==id)throw new HttpsError('failed-precondition','Reçu natif à rapprocher.');}
      else if(prior.state!=='not_executed'||prior.resultId!==null||!['requester_neutralized','source_changed','incomplete_mixed_order_sources','existing_link_requires_review','document_capacity_requires_review'].includes(prior.reason))throw new HttpsError('failed-precondition','Non-exécution à rapprocher.');return receiptView(uid,requestId,command,prior);
    }
    if(raw.action==='observe')return receiptView(uid,requestId,command);const now=Timestamp.now(),noEffect=(reason:string)=>{const r={protocol:'product_mixed_order_command_v1',actorId:uid,requestId,command,payloadHash:hash,state:'not_executed',reason,resultId:null,recordedAt:now};tx.create(commandRef(uid,requestId),r);return receiptView(uid,requestId,command,r);};
    if(raw.action==='neutralize')return noEffect('requester_neutralized');assertProductMixedOrdersNewOpen(true);const authority=await operator(tx,request,uid);
    let cases:Case[],state:State|null=null;
    try{if(command.kind==='link_orders'){cases=[];for(const m of command.members)cases.push(await loadCase(tx,m.reference.context));}else{state=await current(tx,command.reference.context);cases=[state.own];}}
    catch(error){if(error instanceof HttpsError&&['failed-precondition','invalid-argument','not-found'].includes(error.code))return noEffect('incomplete_mixed_order_sources');throw error;}
    if(command.kind==='link_orders'?!command.members.every((m,i)=>bindingMatches(m.reference,cases[i].reference)):!bindingMatches(command.reference,cases[0].reference)||command.groupContextHash!==state!.groupContextHash)return noEffect('source_changed');
    if(cases.some(c=>c.set.root&&(!Number.isSafeInteger(c.set.root.version)||c.set.root.version>=Number.MAX_SAFE_INTEGER-1)))return noEffect('incomplete_mixed_order_sources');
    if(command.kind==='link_orders'&&cases.some(c=>has(c.order,'productMixedOrderLink')))return noEffect('existing_link_requires_review');
    if(command.kind==='review_order'&&!cases[0].set.root)return noEffect('incomplete_mixed_order_sources');
    if(command.kind==='link_orders'&&!cases.some(c=>c.set.contributionRows.some(r=>r.proof?.command.mixedOrderStatement))||command.kind==='review_order'&&(!state!.own.guardQualified||command.action==='resolve_own_review'&&(!state!.groupQualified||!state!.linkedCases.every(c=>c.ready))))return noEffect('incomplete_mixed_order_sources');
    for(const c of cases)try{guardInput(c.order,c.context);}catch{return noEffect('incomplete_mixed_order_sources');}
    const captures=await captureReads(tx,cases),ref=command.kind==='link_orders'?groupRef(id):decisionRef(command.reference.context,id);if((await tx.get(ref)).exists)return noEffect('incomplete_mixed_order_sources');
    if(command.kind==='link_orders')for(const c of cases){const sid='ms_'+supportHash([id,c.context.id]);if((await tx.get(signalRef(c.context,sid))).exists)return noEffect('incomplete_mixed_order_sources');}
    const document=command.kind==='link_orders'?{protocol:'product_mixed_order_link_v1',groupId:id,actorId:uid,requestId,payloadHash:hash,command,authority,captures:cases.map(c=>({reference:c.reference,semantic:c.semantic,manifest:c.set.manifest})),recordedAt:now,...PRODUCT_MIXED_ORDERS_QUALIFICATION,...PRODUCT_REVIEW_EFFECTS}:
      {protocol:'product_mixed_order_decision_v1',decisionId:id,caseId:cases[0].set.source.caseId,actorId:uid,requestId,payloadHash:hash,command,authority,semantic:cases[0].semantic,corpusCapture:cases[0].set.manifest,addressedTo:[cases[0].order.buyerId,cases[0].order.sellerId],recordedAt:now,...PRODUCT_MIXED_ORDERS_QUALIFICATION,...PRODUCT_REVIEW_EFFECTS};
    if(Buffer.byteLength(JSON.stringify(document),'utf8')>800_000)return noEffect('document_capacity_requires_review');const contentHash=supportSourceHash(document);
    const notices=await prepareOperationalNotices(tx,cases.flatMap(c=>[c.order.buyerId,c.order.sellerId].map(userId=>({eventKey:`product_mixed_order_v1:${id}:${c.context.id}:${userId}`,userId,type:'product_review_update',title:'Examen du colis',message:'Une instruction concernant le contenu ou l’étiquette de votre commande a été enregistrée. Consultez votre dossier privé. Les autres décisions et recours restent distincts.',data:{ownerId:userId,productReviewCaseId:c.set.source.caseId,contextKind:'order',contextId:c.context.id}}))));
    for(const row of captures)if(!row.exists)tx.create(row.ref,{protocol:'product_review_source_capture_v1',sourceHash:row.c.reference.sourceHash,document:row.c.set.source.document,capturedAt:now});
    tx.create(ref,command.kind==='link_orders'?{protocol:document.protocol,groupId:id,document,contentHash}:{protocol:document.protocol,decisionId:id,document,contentHash});
    for(const c of cases){const rootRef=productReviewCaseRef(c.context),orderRef=db.collection('transactions').doc(c.context.id);
      if(command.kind==='link_orders'){
        const signal={protocol:'product_mixed_order_signal_v1',signalId:'ms_'+supportHash([id,c.context.id]),transactionId:c.context.id,caseId:c.set.source.caseId,origin:'operator_link',groupId:id,groupHash:contentHash,recordedAt:now,...PRODUCT_MIXED_ORDERS_QUALIFICATION,...PRODUCT_REVIEW_EFFECTS};commitSignal(tx,c.context,c.order,signal,supportSourceHash(signal));
        const pointer={protocol:'product_mixed_order_link_pointer_v1',signalId:signal.signalId,contentHash:supportSourceHash(signal)};tx.update(orderRef,{productMixedOrderLink:pointer});
        if(!c.set.root)tx.create(rootRef,{protocol:'product_review_case_v1',caseId:c.set.source.caseId,context:c.context,articleId:c.set.source.document.articleId,nativeActors:c.set.source.document.nativeActors,version:1,createdAt:now,state:'awaiting_review',systemReviewOrigin:'operator_mixed_order_link',...PRODUCT_REVIEW_EFFECTS});
        else tx.update(rootRef,{version:c.set.root.version+1,state:'awaiting_review'});
      }else{const pointer={protocol:'product_mixed_order_decision_pointer_v1',transactionId:c.context.id,decisionId:id,contentHash};tx.update(orderRef,{productMixedOrderDecision:pointer});tx.update(rootRef,{version:c.set.root!.version+1,latestMixedOrderDecision:pointer});}
    }
    const receipt={protocol:'product_mixed_order_command_v1',actorId:uid,requestId,command,payloadHash:hash,state:'committed',reason:null,resultId:id,recordedAt:now};tx.create(commandRef(uid,requestId),receipt);notices.commit();return receiptView(uid,requestId,command,receipt);
  });
}
export async function readProductMixedOrderHistory(request:any){
  const uid=supportUid(request),raw=supportObject(request.data,['operation','expectedUid','context','scope','stream','cursor','mixedOrdersCapability','parcelCapability']);if(!productMixedOrdersRequested(raw)||!['own','admin'].includes(raw.scope)||!['signals','decisions'].includes(raw.stream))throw new HttpsError('invalid-argument','Portée et flux explicites requis.');
  const c=contextInput(raw.context),cursor=raw.cursor==null?null:supportObject(raw.cursor,['lastId']).lastId;if(cursor!==null&&!documentId(cursor))throw new HttpsError('invalid-argument','Curseur invalide.');
  return db.runTransaction(async tx=>{
    const admin=raw.scope==='admin';if(admin)await operator(tx,request,uid);const own=await loadCase(tx,c);if(!admin&&!productReviewRoles(own.set.source,uid).length)throw new HttpsError('permission-denied','Commande privée.');
    let query=productReviewCaseRef(c).collection(raw.stream==='signals'?'mixed_order_signals':'mixed_order_decisions').orderBy('__name__').limit(21);if(cursor)query=query.startAfter(cursor);const page=await tx.get(query),inspected=page.docs.slice(0,20),entries=[];
    for(const row of inspected){if(raw.stream==='decisions'){const p=await decisionProof(tx,c,row.id,row.data());entries.push(p&&(admin||p.document.addressedTo.includes(uid))?{qualification:'native_recorded_decision',decision:decisionView(p,uid,admin)}:{qualification:'unknown',entryId:row.id,decision:null});}
      else{const s=own.signals.find(r=>r.id===row.id),d=s?.document;if(!d){entries.push({qualification:'unknown',entryId:row.id,signal:null});continue;}
        let message:null|string=null;if(d.origin==='operator_link'){const g=await groupProof(tx,d.groupId,(await tx.get(groupRef(d.groupId))).data()),m=g?.command.members.find(m=>m.reference.context.id===c.id);message=uid===own.order.buyerId?m?.buyerMessage??null:uid===own.order.sellerId?m?.sellerMessage??null:null;}
        entries.push({qualification:'native_recorded_signal',signal:{signalId:row.id,origin:d.origin,recordedAt:d.recordedAt.toDate().toISOString(),partyMessage:message,...(admin?{nativeReference:d}:{}),...PRODUCT_MIXED_ORDERS_QUALIFICATION,...PRODUCT_REVIEW_EFFECTS}});
      }}
    return {protocol:'product_mixed_order_history_page_v1',actorId:uid,scope:raw.scope,stream:raw.stream,caseId:own.set.source.caseId,entries,nextCursor:page.size>20?{lastId:inspected.at(-1)!.id}:null,coverage:{inspected:inspected.length,limit:20,hasMore:page.size>20,exhaustiveHistoryVerified:false},currentDecisionVerified:false,...PRODUCT_MIXED_ORDERS_QUALIFICATION,...PRODUCT_REVIEW_EFFECTS};
  });
}
