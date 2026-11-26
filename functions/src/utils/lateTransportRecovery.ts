/** Same-incident physical recovery review. No title certificate, finance, label
 * instruction or stock mutation. Only products consumes the native disposition. */
import {Timestamp} from 'firebase-admin/firestore';
import {createHash} from 'node:crypto';
import {HttpsError} from 'firebase-functions/v2/https';
import {db, auth} from '../config/firebase';
import {supportUid, supportObject, supportId, supportRequestId, supportHash, supportSourceHash, supportRevision,
  supportCurrentAdminSession, supportAdmin, supportText} from './supportRequest';
import {assertRecentAccountAuthentication} from './eligibility';
import {readLateTransportSupportSource, readLateTransportRecoveryFinance} from './lateTransportIncident';
import {readProductReviewDocumentarySet} from './productReviewWorkflow';
import {trackingIdentity, savedLifecycleLabelIdentity} from '../config/shipEngine';
import {prepareOperationalNotices} from './notifications';
import {hasActiveBankDispute} from './bankDispute';
import {hasUnsettledRefund} from './refundState';
import {hasUnsettledReturnRequest} from './returnRequest';
import {returnToSenderBlocksProgress} from '../shared/returnToSenderGuard';
import {deliveryCorrectionBlocksProgress} from './orderModeration';

export const LATE_TRANSPORT_RECOVERY_ENABLED: boolean = true;
export const LATE_TRANSPORT_RECOVERY_CAPABILITY = 'late_transport_recovery_v1';
const HASH = /^[a-f0-9]{64}$/;
const native = (v: unknown): v is Timestamp => v instanceof Timestamp && v.toMillis() > 0 && v.toMillis() <= Date.now();
const effects = {financialEffectAuthorized: false, inventoryReleaseAuthorized: false, relistAuthorized: false,
  physicalPossessionCertified: false, legalOwnershipCertified: false} as const;
const rows = (id: string, incident: string) => db.collection('transactions').doc(id).collection('late_transport_incidents').doc(incident).collection('physical_recovery');
const entryId = (uid: string, requestId: string) => 'entry_' + supportHash([uid, requestId]);
const entryName = (v: unknown): v is string => typeof v === 'string' && v.startsWith('entry_') && !v.includes('/') && Buffer.byteLength(v, 'utf8') <= 1500;
const closed = () => {if (!LATE_TRANSPORT_RECOVERY_ENABLED) throw new HttpsError('failed-precondition', 'Le parcours de récupération physique est en préparation.', {reason: 'late_transport_recovery_not_exposed'});};
type Source = {sourceHash: string; semanticHash: string; orderRevision: string; incidentRevision: string; incidentHash: string;
  financialSourceHash: string; stateVersion: number; corpusHash: string | null; membersHash: string | null};
type Command = {transactionId: string; incidentId: string; source: Source} & ({action: 'statement'; possession: 'held_by_me'|'not_held_by_me'|'unknown';
  restitution: 'returned_to_seller_declared'|'retained_by_buyer_declared'|'not_returned_declared'|'unknown'; narrative: string; occurredAt: string|null} |
  {action: 'retain_review'|'complete_own_review'; assessments: {criterion: string; qualification: 'examined'|'unknown'; summary: string}[];
    privateReason: string; partyMessage: string; examinedCorpus: true});
const criteria = ['article_identity', 'physical_availability', 'contradictions', 'restitution_context'];
function input(value: unknown): Command {
  const c = supportObject(value, ['transactionId','incidentId','source','action','possession','restitution','narrative','occurredAt','assessments','privateReason','partyMessage','examinedCorpus']);
  const s = supportObject(c.source, ['sourceHash','semanticHash','orderRevision','incidentRevision','incidentHash','financialSourceHash','stateVersion','corpusHash','membersHash']);
  if (!['sourceHash','semanticHash','incidentHash','financialSourceHash'].every(k => HASH.test(s[k] ?? '')) ||
      !/^\d+:\d+$/.test(s.orderRevision ?? '') || !/^\d+:\d+$/.test(s.incidentRevision ?? '') || !Number.isSafeInteger(s.stateVersion) || s.stateVersion < 0 ||
      ![s.corpusHash,s.membersHash].every(v => v === null || HASH.test(v ?? '')) || !/^late_[a-f0-9]{64}$/.test(c.incidentId ?? ''))
    throw new HttpsError('invalid-argument', 'Sources natives exactes requises.');
  const common = {transactionId:supportId(c.transactionId),incidentId:c.incidentId,source:s as Source};
  if (c.action === 'statement') {
    if (!['held_by_me','not_held_by_me','unknown'].includes(c.possession) || !['returned_to_seller_declared','retained_by_buyer_declared','not_returned_declared','unknown'].includes(c.restitution) ||
        ['assessments','privateReason','partyMessage','examinedCorpus'].some(k => c[k] !== undefined) || c.occurredAt !== null &&
        (typeof c.occurredAt !== 'string' || !Number.isFinite(Date.parse(c.occurredAt)) || new Date(c.occurredAt).toISOString() !== c.occurredAt || Date.parse(c.occurredAt) > Date.now()))
      throw new HttpsError('invalid-argument', 'Constat propre déclaré ou inconnu requis.');
    return {...common,action:'statement',possession:c.possession,restitution:c.restitution,narrative:supportText(c.narrative,'Constat',2000),occurredAt:c.occurredAt};
  }
  if (!['retain_review','complete_own_review'].includes(c.action) || c.examinedCorpus !== true || !Array.isArray(c.assessments) || c.assessments.length !== criteria.length ||
      ['possession','restitution','narrative','occurredAt'].some(k => c[k] !== undefined)) throw new HttpsError('invalid-argument','Examen humain explicite requis.');
  const assessments = c.assessments.map((v: unknown) => {const a = supportObject(v,['criterion','qualification','summary']);
    if (!criteria.includes(a.criterion) || !['examined','unknown'].includes(a.qualification)) throw new HttpsError('invalid-argument','Appréciation invalide.');
    return {criterion:a.criterion,qualification:a.qualification as 'examined'|'unknown',summary:supportText(a.summary,'Appréciation',2000)};});
  if (new Set(assessments.map(a => a.criterion)).size !== criteria.length) throw new HttpsError('invalid-argument','Critères distincts requis.');
  return {...common,action:c.action,assessments,privateReason:supportText(c.privateReason,'Motivation',2000),partyMessage:supportText(c.partyMessage,'Message aux parties',2000),examinedCorpus:true};
}
async function proof(tx: FirebaseFirestore.Transaction, id: string, incident: string, name: string, value: any) {
  const d = value?.document;
  if (!d || value.protocol !== 'late_transport_recovery_entry_v1' || d.protocol !== value.protocol || d.entryId !== name ||
      d.transactionId !== id || d.incidentId !== incident || !native(d.recordedAt) || value.contentHash !== supportSourceHash(d) ||
      name !== entryId(d.actorId,d.requestId) || d.command?.transactionId!==id || d.command?.incidentId!==incident ||
      supportHash(d.command) !== d.payloadHash || !d.sourceCapture?.semantic || d.semanticHash!==supportSourceHash(d.sourceCapture.semantic) ||
      d.command.source?.semanticHash!==d.semanticHash || d.baseHash!==supportSourceHash({...d.sourceCapture.semantic,membersHash:null})) return null;
  try {if (supportHash(input(d.command))!==d.payloadHash) return null;} catch {return null;}
  const receipt = (await tx.get(rows(id,incident).doc('command_' + supportHash([d.actorId,d.requestId])))).data();
  if (!receipt || receipt.protocol!=='late_transport_recovery_command_v1' || receipt.state !== 'committed' || receipt.actorId !== d.actorId || receipt.requestId !== d.requestId ||
      supportHash(receipt.command)!==d.payloadHash ||
      receipt.payloadHash !== d.payloadHash || receipt.entryId !== name || receipt.entryHash !== value.contentHash ||
      !native(receipt.recordedAt) || !receipt.recordedAt.isEqual(d.recordedAt)) return null;
  return d;
}
/** The author of a still-consumable disposition must remain a native private
 * operator with an available, non-revoked Auth session. This is not the owner's
 * session and no old custom claim can replace the current private role. */
async function decisionAuthorityCurrent(tx:FirebaseFirestore.Transaction,id:string,incident:string,state:any) {
  const p=state?.decision, unknown={qualified:false,actorId:null as string|null,sourceHash:supportHash(['no_qualified_current_authority'])};
  if(!entryName(p?.entryId) || !HASH.test(p?.contentHash ?? ''))return unknown;
  const row=(await tx.get(rows(id,incident).doc(p.entryId))).data(), d=await proof(tx,id,incident,p.entryId,row);
  if(!d || row!.contentHash!==p.contentHash || !['retain_review','complete_own_review'].includes(d.command.action) ||
      d.operatorAuthority?.protocol!=='late_recovery_operator_v1' || d.operatorAuthority.actorId!==d.actorId ||
      d.operatorAuthority.privateRoleQualifiedAtCommit!==true)return unknown;
  const privateRole=(await tx.get(db.collection('users').doc(d.actorId))).data();
  const role={isAdmin:privateRole?.isAdmin===true,isActive:privateRole?.isActive!==false};
  const authTime=d.operatorAuthority.authTime, authenticatedAt=typeof authTime==='number'?authTime*1000:NaN;
  try {
    const account=await auth.getUser(d.actorId), cutoff=account.tokensValidAfterTime==null?null:Date.parse(account.tokensValidAfterTime);
    const qualified=role.isAdmin && role.isActive && account.uid===d.actorId && !account.disabled &&
      Number.isSafeInteger(authTime) && authTime>0 && Number.isSafeInteger(authenticatedAt) && authenticatedAt<=Date.now() &&
      (cutoff===null || Number.isSafeInteger(cutoff) && authenticatedAt>=cutoff);
    return {qualified,actorId:d.actorId as string,sourceHash:supportHash([d.actorId,role,account.uid,account.disabled,
      cutoff===null?'absent':Number.isSafeInteger(cutoff)?cutoff:'unknown',authTime,qualified])};
  }catch {
    // Missing, disabled, revoked or unavailable authority is never permission.
    // The immutable instruction/receipt is preserved for its author and parties.
    return {qualified:false,actorId:d.actorId as string,sourceHash:supportHash([d.actorId,role,'auth_unavailable'])};
  }
}
async function current(tx: FirebaseFirestore.Transaction, id: string, incident: string, suppliedArticle?: FirebaseFirestore.DocumentData) {
  const orderSnap = await tx.get(db.collection('transactions').doc(id)), order = orderSnap.data();
  if (!order || !orderSnap.updateTime || typeof order.articleId !== 'string' || !order.articleId || order.articleId.includes('/')) throw new HttpsError('failed-precondition','Commande physique inconnue.');
  const incidentSource = await readLateTransportSupportSource(tx,id,incident,order.sellerId);
  if (!incidentSource) throw new HttpsError('failed-precondition','Incident tardif inconnu.');
  const articleSnap = await tx.get(db.collection('articles').doc(order.articleId)), article = articleSnap.data();
  const articleQualified = !!article && article.sellerId === order.sellerId && !!order.articleSnapshot &&
    typeof order.articleSnapshot === 'object' && !Array.isArray(order.articleSnapshot) && (order.articleSnapshot.id == null || order.articleSnapshot.id === order.articleId) &&
    (!suppliedArticle || supportSourceHash(suppliedArticle) === supportSourceHash(article));
  const finance = await readLateTransportRecoveryFinance(tx,id,order);
  const incidents = await tx.get(db.collection('transactions').doc(id).collection('late_transport_incidents').orderBy('__name__').limit(101));
  const reservations = await tx.get(db.collection('transactions').where('articleId','==',order.articleId).limit(101));
  const claims = await tx.get(db.collection('disputes').where('transactionId','==',id).limit(101));
  const stateSnap = await tx.get(rows(id,incident).doc('state')), state = stateSnap.data();
  const stateQualified = !state || state.protocol === 'late_transport_recovery_state_v1' && state.transactionId === id && state.incidentId === incident &&
    Number.isSafeInteger(state.version) && state.version >= 1 && state.buyerId === order.buyerId && state.sellerId === order.sellerId;
  const statements: {role:'buyer'|'seller';entryId:string;contentHash:string;document:any}[] = [];
  let statementsComplete = stateQualified;
  for (const role of ['buyer','seller'] as const) {
    const pointer = state?.statements?.[role];
    if (!pointer) continue;
    if (!entryName(pointer.entryId) || !HASH.test(pointer.contentHash ?? '')) {statementsComplete=false;continue;}
    const row = (await tx.get(rows(id,incident).doc(pointer.entryId))).data();
    const d = await proof(tx,id,incident,pointer.entryId,row);
    if (!d || d.command.action !== 'statement' || d.actorId !== order[`${role}Id`] || row!.contentHash !== pointer.contentHash) {statementsComplete=false;continue;}
    statements.push({role,entryId:pointer.entryId,contentHash:pointer.contentHash,document:d});
  }
  let set: Awaited<ReturnType<typeof readProductReviewDocumentarySet>> | null = null;
  try {set = await readProductReviewDocumentarySet(tx,{kind:'order',id},false,true);} catch (e) {
    if (!(e instanceof HttpsError && ['failed-precondition','not-found','permission-denied','invalid-argument'].includes(e.code))) throw e;
  }
  const m = set?.manifest;
  const members = m ? (({sourceHash:_s,parcelReview:_p,...body})=>body)(m) : null;
  const membersHash = members ? supportSourceHash(members) : null;
  const leg = set && 'parcelSources' in set.source.document ? set.source.document.parcelSources?.legs.find(v=>v.leg==='forward') : null;
  const identity=trackingIdentity(id,order,'forward'), tracking=leg?.tracking;
  // readProductReviewDocumentarySet qualifies this exact current capture against
  // the current label, denied native document, pointer and latest authorized GET.
  // A commercial observation need not exist after a refund, nor be refreshed
  // when the same DE is replayed. Never manufacture one to satisfy this reader.
  const capture=tracking?.qualification==='native_current_capture'
    ? (await tx.get(db.collection('transactions').doc(id).collection('tracking_history').doc(tracking.captureId))).data():null;
  const info=capture?.info;
  const savedLabel=savedLifecycleLabelIdentity(id,order,'forward');
  const labelCreatedAt=savedLabel?.providerCreatedAtMs ?? (native(order.labelCreatedAt)?order.labelCreatedAt.toMillis():null);
  const captureCurrent=!!identity && leg?.qualification==='native_current_label' && tracking?.qualification==='native_current_capture' &&
    capture?.protocol==='tracking_history_v1' && capture.captureId===tracking.captureId && capture.displayHash===tracking.displayHash &&
    capture.buyerId===order.buyerId && capture.sellerId===order.sellerId && native(capture.recordedAt) &&
    info?.transactionId===id && info.leg==='forward' && info.sourceHash===identity.sourceHash && info.readVersion===tracking.readVersion &&
    info.readId===order.trackingRead?.readId && info.readVersion===order.trackingRead?.version &&
    HASH.test(info.sourceContentHash ?? '') && Number.isSafeInteger(info.providerRequestedAtMs) &&
    Number.isSafeInteger(info.providerObservedAtMs) && info.providerRequestedAtMs<=info.providerObservedAtMs &&
    info.providerObservedAtMs<=capture.recordedAt.toMillis() && info.providerObservedAtMs<=Date.now();
  // The capture producer already checked the exact provider-label chronology
  // before its native commit. The saved label creation (or original native
  // creation recording) additionally bounds the physical occurrence here.
  const eventQualified=captureCurrent && Number.isSafeInteger(labelCreatedAt) && labelCreatedAt!>=0 &&
    Number.isSafeInteger(info.providerEventAtMs) && info.providerEventAtMs>=labelCreatedAt! &&
    info.providerEventAtMs<=info.providerObservedAtMs && ['AC','IT','DE','EX','AT','SP'].includes(info.providerStatusCode) &&
    ['actual_delivery_date','normalized_event'].includes(info.providerEventTimeSource);
  const trackingBusiness=eventQualified?{identity,code:info.providerStatusCode,eventAt:info.providerEventAtMs,
    labelCreatedAt,eventTimeSource:info.providerEventTimeSource,contentHash:info.sourceContentHash}:null;
  const articleContent = article ? Object.fromEntries(['sellerId','title','description','images','category','categoryIds','condition','size','brand','brandStatus','saleUnit',
    'hasKnownDefects','defectsDescription','hasAlterations','alterationsDescription','hygieneDeclaration','childSafetyDeclaration'].filter(k=>article[k]!==undefined).map(k=>[k,article[k]])) : null;
  const semantic = {protocol:'late_transport_recovery_semantic_v1',transactionId:id,incidentId:incident,articleId:order.articleId,buyerId:order.buyerId,sellerId:order.sellerId,
    articleSnapshot:order.articleSnapshot ?? null,articleContent,shippingSnapshot:order.shippingSnapshot ?? null,financialSourceHash:finance.sourceHash,
    trackingBusiness,membersHash,incidentManifest:incidents.docs.map(d=>[d.id,d.data().contentHash ?? null]),
    reservations:reservations.docs.filter(d=>d.id!==id).map(d=>[d.id,supportSourceHash(d.data())]),claims:claims.docs.map(d=>[d.id,supportSourceHash(d.data())])};
  const semanticHash = supportSourceHash(semantic);
  const baseHash = supportSourceHash({...semantic,membersHash:null});
  const pair = (role:string) => statements.find(v=>v.role===role)?.document;
  const seller = pair('seller'), buyer = pair('buyer');
  const noOtherReservation = reservations.size < 101 && reservations.docs.every(d=>d.id===id || ['cancelled','refunded','completed','meetup_completed'].includes(d.data().status));
  const allNative = incidents.size < 101 && claims.size < 101 && incidents.docs.every(d=>d.data().transactionId===id && d.data().protocol==='late_transport_incident_v1' && native(d.data().recordedAt) && d.data().buyerId===order.buyerId && d.data().sellerId===order.sellerId && d.data().contentHash===createHash('sha256').update(JSON.stringify(d.data().document)).digest('hex')) &&
    claims.docs.every(d=>d.data().transactionId===id && d.data().buyerId===order.buyerId && d.data().sellerId===order.sellerId &&
      native(d.data().createdAt) && ['closed','resolved','dismissed'].includes(d.data().status));
  const agreement = statementsComplete && seller?.baseHash===baseHash && buyer?.baseHash===baseHash && seller.command.occurredAt!==null && buyer.command.occurredAt!==null && seller.command.possession==='held_by_me' &&
    buyer.command.possession==='not_held_by_me' && seller.command.restitution==='returned_to_seller_declared' && buyer.command.restitution==='returned_to_seller_declared';
  const otherGuard = returnToSenderBlocksProgress(order) || hasUnsettledReturnRequest(order) || deliveryCorrectionBlocksProgress(order) ||
    Object.prototype.hasOwnProperty.call(order,'fraudReview') || order.productPhysicalReview!=null || order.disputeId!=null ||
    ['disputed','trackingReviewRequired','labelReconciliationRequired','returnReconciliationRequired'].some(k=>order[k]!=null && order[k]!==false) ||
    order.refundAllocationState?.reviewRequired===true || order.refundInventoryReviewRequired!=null && ![true,false].includes(order.refundInventoryReviewRequired);
  const ready = articleQualified && eventQualified && allNative && noOtherReservation && !!set?.documentaryComplete && agreement && finance.refund.state==='confirmed' && finance.refund.intentId===incidentSource.refundAtObservation.intentId &&
    !hasActiveBankDispute(order) && !hasUnsettledRefund(order) && !otherGuard && ['refunded','cancelled'].includes(order.status);
  const currentAuthority=await decisionAuthorityCurrent(tx,id,incident,state);
  const reference:Source = {sourceHash:supportSourceHash([order,supportRevision(orderSnap),incidentSource.reference,state ?? null,semanticHash,set?.corpusHash ?? null,currentAuthority.sourceHash]),
    semanticHash,orderRevision:supportRevision(orderSnap)!,incidentRevision:incidentSource.reference.incidentRevision,incidentHash:incidentSource.reference.incidentHash,
    financialSourceHash:finance.sourceHash,stateVersion:stateQualified ? state?.version ?? 0 : -1,corpusHash:set?.corpusHash ?? null,membersHash};
  return {order,orderSnap,article,articleQualified,incidentSource,finance,state,stateQualified,statements,statementsComplete,set,members,semantic,semanticHash,baseHash,ready,reference,currentAuthority};
}
async function disposition(tx: FirebaseFirestore.Transaction, id: string, incident: string, s: Awaited<ReturnType<typeof current>>) {
  const pointer = s.state?.decision;
  if (!pointer || !entryName(pointer.entryId) || !HASH.test(pointer.contentHash ?? '')) return null;
  const value = (await tx.get(rows(id,incident).doc(pointer.entryId))).data(), d = await proof(tx,id,incident,pointer.entryId,value);
  if (!d || value!.contentHash!==pointer.contentHash || !['retain_review','complete_own_review'].includes(d.command.action) ||
      d.operatorAuthority?.protocol!=='late_recovery_operator_v1' || d.operatorAuthority.actorId!==d.actorId || d.operatorAuthority.privateRoleQualifiedAtCommit!==true ||
      !HASH.test(d.operatorAuthority.privateRoleSourceHash ?? '') || !d.sourceCapture || supportSourceHash(d.sourceCapture.semantic)!==d.semanticHash ||
      d.sourceCapture.membersHash!==d.command.source.membersHash || (d.sourceCapture.manifest===null ? d.sourceCapture.membersHash!==null : supportSourceHash(d.sourceCapture.manifest)!==d.sourceCapture.membersHash) ||
      d.semanticHash!==d.command.source.semanticHash) return null;
  const currentDecision = s.currentAuthority.qualified && s.currentAuthority.actorId===d.actorId && d.semanticHash===s.semanticHash && supportHash(d.statementReferences)===supportHash(s.statements.map(v=>({role:v.role,entryId:v.entryId,contentHash:v.contentHash})));
  return {entryId:pointer.entryId,contentHash:pointer.contentHash,action:d.command.action,partyMessage:d.command.partyMessage,
    recordedAt:d.recordedAt.toDate().toISOString(),qualification:currentDecision?'native_current':'historical_or_changed',
    ownReviewComplete:!!currentDecision && s.ready && d.command.action==='complete_own_review' && d.command.examinedCorpus===true &&
      d.command.assessments.every((a:any)=>a.qualification==='examined'), ...effects};
}
function publicSource(uid: string, id: string, incident: string, s: Awaited<ReturnType<typeof current>>, decision: Awaited<ReturnType<typeof disposition>>, admin: boolean) {
  return {protocol:'late_transport_recovery_source_v1',ownerId:uid,transactionId:id,incidentId:incident,articleId:s.order.articleId,
    source:s.reference,qualification:s.stateQualified && s.articleQualified?'native_context':'unknown',
    statements:s.statements.map(v=>({role:v.role,actorId:v.document.actorId,entryId:v.entryId,contentHash:v.contentHash,
      possession:v.document.command.possession,restitution:v.document.command.restitution,occurredAt:v.document.command.occurredAt,
      narrative:admin || v.document.actorId===uid?v.document.command.narrative:null,recordedAt:v.document.recordedAt.toDate().toISOString(),
      currentBusinessContext:v.document.baseHash===s.baseHash,statementVerified:false})),
    statementSetComplete:s.statementsComplete,documentaryComplete:s.set?.documentaryComplete===true,
    productReviewContext:{kind:'order',id},productReviewCaseId:s.set?.source.caseId ?? null,
    evidenceReferences:s.set?.evidenceRows.filter(v=>v.reference && (admin || v.reference.actorId===uid)).map(v=>v.reference) ?? [],
    incident:s.incidentSource,refundCurrentlyRecorded:s.finance.refund,
    canRecordStatementNow:s.stateQualified && [s.order.buyerId,s.order.sellerId].includes(uid),
    canCompleteOwnReviewNow:admin && s.ready,criteria,currentDecision:decision, ...effects};
}
function receiptView(r:any) {return {protocol:'late_transport_recovery_command_v1',actorId:r.actorId,requestId:r.requestId,command:r.command,payloadHash:r.payloadHash,
  state:r.state,reason:r.reason ?? null,entryId:r.entryId ?? null,entryHash:r.entryHash ?? null,recordedAt:native(r.recordedAt)?r.recordedAt.toDate().toISOString():null,...effects};}
async function authority(tx:FirebaseFirestore.Transaction, request:any, uid:string) {
  await supportCurrentAdminSession(request); assertRecentAccountAuthentication(request.auth.token); await supportAdmin(tx,uid,false);
  const role = await tx.get(db.collection('users').doc(uid));
  return {protocol:'late_recovery_operator_v1',actorId:uid,authTime:request.auth.token.auth_time,
    privateRoleQualifiedAtCommit:true,privateRoleSourceHash:supportSourceHash(role.data() ?? null),privateRoleRevision:supportRevision(role)};
}
/** Routing stays in the existing support endpoints. Old support DTOs never
 * contain this capability or its new fields. Servicing is SDK-only FIRST. */
export async function handleLateTransportRecovery(request:any, endpoint:'read'|'owner'|'admin') {
  const uid=supportUid(request), raw=request.data;
  if (raw.capability!==LATE_TRANSPORT_RECOVERY_CAPABILITY) throw new HttpsError('invalid-argument','Version récupération requise.');
  if (endpoint==='read') {
    supportObject(raw,['capability','expectedUid','mode','transactionId','incidentId','scope','cursor']);
    const id=supportId(raw.transactionId), incident=String(raw.incidentId);
    if (!/^late_[a-f0-9]{64}$/.test(incident) || !['owner','admin'].includes(raw.scope) || !['source','history'].includes(raw.mode) || raw.cursor!=null && !entryName(raw.cursor))
      throw new HttpsError('invalid-argument','Dossier et portée exacts requis.');
    closed();
    return db.runTransaction(async tx=>{
      const admin=raw.scope==='admin'; if(admin) await authority(tx,request,uid);
      if(!admin){const o=(await tx.get(db.collection('transactions').doc(id))).data();
        if(!o || ![o.buyerId,o.sellerId].includes(uid)) throw new HttpsError('permission-denied','Dossier privé.');}
      const s=await current(tx,id,incident);
      const d=await disposition(tx,id,incident,s), source=publicSource(uid,id,incident,s,d,admin);
      if(raw.mode==='source') return source;
      let query=rows(id,incident).orderBy('__name__').startAt('entry_').endBefore('entry`').limit(21);
      if(raw.cursor) query=rows(id,incident).orderBy('__name__').startAfter(raw.cursor).endBefore('entry`').limit(21);
      const page=await tx.get(query), inspected=page.docs.slice(0,20), items=[];
      for(const row of inspected){const p=await proof(tx,id,incident,row.id,row.data());
        if(!p){items.push({entryId:row.id,qualification:'historical_unknown'});continue;}
        const own=p.actorId===uid;
        if(p.command.action==='statement' && !admin && !own) continue;
        items.push({entryId:row.id,contentHash:row.data().contentHash,qualification:'native_record',actorId:p.actorId,action:p.command.action,
          command:admin || own?p.command:null,partyMessage:p.command.action==='statement'?null:p.command.partyMessage,
          recordedAt:p.recordedAt.toDate().toISOString(),currentPermissionGranted:false,...effects});
      }
      return {protocol:'late_transport_recovery_history_v1',ownerId:uid,transactionId:id,incidentId:incident,source,items,
        cursor:page.size>20?inspected[inspected.length-1].id:null,...effects};
    });
  }
  supportObject(raw,['capability','expectedUid','mode','operation','requestId','command']);
  const command=input(raw.command), id=command.transactionId, incident=command.incidentId;
  if(endpoint==='owner' ? command.action!=='statement' : command.action==='statement') throw new HttpsError('invalid-argument','Action incompatible avec cet endpoint.');
  if(!['preview','command'].includes(raw.mode)) throw new HttpsError('invalid-argument','Mode inconnu.');
  const hash=supportHash(command);
  if(raw.mode==='preview') {
    if(endpoint!=='admin' || raw.requestId!==undefined || raw.operation!==undefined) throw new HttpsError('invalid-argument','Aperçu opérateur requis.');
    closed(); return db.runTransaction(async tx=>{await authority(tx,request,uid);const s=await current(tx,id,incident);
      if(supportHash(command.source)!==supportHash(s.reference)) throw new HttpsError('failed-precondition','La source a changé.');
      const previewId='preview_'+supportHash([uid,hash]), ref=rows(id,incident).doc(previewId), previous=await tx.get(ref);
      if(previous.exists && previous.data()?.payloadHash!==hash) throw new HttpsError('already-exists','Aperçu différent.');
      const view=publicSource(uid,id,incident,s,await disposition(tx,id,incident,s),true);
      if(!previous.exists) tx.create(ref,{protocol:'late_transport_recovery_preview_v1',actorId:uid,payloadHash:hash,createdAt:Timestamp.now()});
      return {protocol:'late_transport_recovery_preview_v1',actorId:uid,previewId,payloadHash:hash,source:view,...effects};});
  }
  const requestId=supportRequestId(raw.requestId), name=entryId(uid,requestId), ref=rows(id,incident).doc('command_'+supportHash([uid,requestId]));
  if(!['execute','observe','neutralize'].includes(raw.operation)) throw new HttpsError('invalid-argument','Opération exacte requise.');
  return db.runTransaction(async tx=>{
    const previous=(await tx.get(ref)).data();
    if(previous){if(previous.protocol!=='late_transport_recovery_command_v1' || previous.actorId!==uid || previous.requestId!==requestId ||
      previous.payloadHash!==hash || supportHash(previous.command)!==hash || !native(previous.recordedAt) || !['committed','not_executed'].includes(previous.state))
        throw new HttpsError('already-exists','Cette intention possède un autre contenu.');return receiptView(previous);}
    const base={protocol:'late_transport_recovery_command_v1',actorId:uid,requestId,command,payloadHash:hash};
    if(raw.operation==='observe') return receiptView({...base,state:'unrecorded'});
    const now=Timestamp.now(), refuse=(reason:string)=>{const r={...base,state:'not_executed',reason,entryId:null,entryHash:null,recordedAt:now};tx.create(ref,r);return receiptView(r);};
    if(raw.operation==='neutralize') return refuse('requester_neutralized');
    if(!LATE_TRANSPORT_RECOVERY_ENABLED) return refuse('late_transport_recovery_not_exposed');
    const admin=endpoint==='admin', operator=admin?await authority(tx,request,uid):null;
    if(!admin) {await supportCurrentAdminSession(request);const o=(await tx.get(db.collection('transactions').doc(id))).data();
      if(!o || ![o.buyerId,o.sellerId].includes(uid)) return refuse('native_party_changed');}
    let s:Awaited<ReturnType<typeof current>>;
    try{s=await current(tx,id,incident);}catch(e){if(e instanceof HttpsError && ['failed-precondition','not-found'].includes(e.code))return refuse('source_unknown');throw e;}
    if(!admin && ![s.order.buyerId,s.order.sellerId].includes(uid)) return refuse('native_party_changed');
    if(!s.stateQualified || supportHash(command.source)!==supportHash(s.reference)) return refuse('source_changed');
    if(command.action!=='statement') {
      const preview=(await tx.get(rows(id,incident).doc('preview_'+supportHash([uid,hash])))).data();
      if(preview?.protocol!=='late_transport_recovery_preview_v1' || preview.actorId!==uid || preview.payloadHash!==hash || !native(preview.createdAt)) return refuse('preview_unqualified');
      if(command.action==='complete_own_review' && (!s.ready || command.assessments.some(a=>a.qualification!=='examined'))) return refuse('physical_recovery_sources_incomplete');
    }
    if(s.reference.stateVersion>=Number.MAX_SAFE_INTEGER-1) return refuse('state_capacity_requires_review');
    const sourceCapture={semantic:s.semantic,membersHash:s.reference.membersHash,manifest:s.members};
    const document={protocol:'late_transport_recovery_entry_v1',entryId:name,transactionId:id,incidentId:incident,articleId:s.order.articleId,
      actorId:uid,requestId,command,payloadHash:hash,baseHash:s.baseHash,semanticHash:s.semanticHash,
      statementReferences:s.statements.map(v=>({role:v.role,entryId:v.entryId,contentHash:v.contentHash})),sourceCapture,
      operatorAuthority:operator,recordedAt:now,...effects};
    if(Buffer.byteLength(JSON.stringify(document),'utf8')>800000) return refuse('document_capacity_requires_review');
    if((await tx.get(rows(id,incident).doc(name))).exists) return refuse('entry_without_receipt_requires_review');
    const contentHash=supportSourceHash(document), value={protocol:document.protocol,document,contentHash};
    const notices=await prepareOperationalNotices(tx,[s.order.buyerId,s.order.sellerId].map(userId=>({
      eventKey:`late_transport_recovery:${id}:${incident}:${name}`,userId,type:'order_moderation',title:'Suivi de la récupération de l’article',
      message:'Un constat ou un examen humain de récupération physique a été enregistré. Consultez le dossier privé ; les fonds, les autres gardes et la remise en vente restent distincts.',
      data:{ownerId:userId,transactionId:id,lateTransportIncidentId:incident,lateTransportRecoveryEntryId:name,lateTransportRecoveryCapability:LATE_TRANSPORT_RECOVERY_CAPABILITY}})));
    const pointer={entryId:name,contentHash};
    tx.create(rows(id,incident).doc(name),value);
    tx.set(rows(id,incident).doc('state'),{protocol:'late_transport_recovery_state_v1',transactionId:id,incidentId:incident,buyerId:s.order.buyerId,sellerId:s.order.sellerId,
      version:s.reference.stateVersion+1,statements:command.action==='statement'?{...(s.state?.statements ?? {}),[uid===s.order.buyerId?'buyer':'seller']:pointer}:s.state?.statements ?? {},
      decision:command.action==='statement'?s.state?.decision ?? null:pointer,updatedAt:now});
    if(admin) tx.update(s.orderSnap.ref,{lateTransportRecoveryReview:{protocol:'late_transport_recovery_pointer_v1',incidentId:incident,...pointer}});
    const r={...base,state:'committed',reason:null,entryId:name,entryHash:contentHash,recordedAt:now};tx.create(ref,r);notices.commit();return receiptView(r);
  });
}
/** Called only by the stock consumer under its article/order transaction. A
 * client boolean, historical disposition or partial source can never qualify. */
export async function lateTransportRecoveryOwnReviewQualified(tx:FirebaseFirestore.Transaction,id:string,order:FirebaseFirestore.DocumentData,article:FirebaseFirestore.DocumentData) {
  if(!LATE_TRANSPORT_RECOVERY_ENABLED) return false;
  const p=order.lateTransportRecoveryReview;
  if(p?.protocol!=='late_transport_recovery_pointer_v1' || !/^late_[a-f0-9]{64}$/.test(p.incidentId ?? '') || !entryName(p.entryId) || !HASH.test(p.contentHash ?? '')) return false;
  try{const s=await current(tx,id,p.incidentId,article);
    if(supportSourceHash(s.order)!==supportSourceHash(order))return false;
    const d=await disposition(tx,id,p.incidentId,s);return !!d?.ownReviewComplete && d.entryId===p.entryId && d.contentHash===p.contentHash;
  }catch(e){if(e instanceof HttpsError && ['failed-precondition','not-found','permission-denied','invalid-argument'].includes(e.code))return false;throw e;}
}
