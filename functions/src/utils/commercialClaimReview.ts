/** Withdrawal is documentary. Re-examination requires a separate native operator admission. */
import {Timestamp} from 'firebase-admin/firestore';
import {HttpsError} from 'firebase-functions/v2/https';
import {db} from '../config/firebase';
import {supportUid, supportId, supportObject, supportRequestId, supportHash, supportSourceHash, supportRevision, supportText,
  supportCurrentAdminSession, supportAdmin} from './supportRequest';
import {assertAccountSecurityOpen, assertRecentAccountAuthentication} from './eligibility';
import {readProductReviewDocumentarySet} from './productReviewWorkflow';
import {prepareOperationalNotices, readOperationalNoticeReceipts} from './notifications';
import {qualifiedClaim} from './productParcelRecourse';
import {checkRateLimit} from './rateLimit';

export const COMMERCIAL_CLAIM_REVIEW_CAPABILITY = 'commercial_claim_review_v1';
export const COMMERCIAL_CLAIM_REVIEW_ENABLED: boolean = true;
const effects = {financialEffectAuthorized: false, claimClosed: false, fundsReleased: false, inventoryPermissionGranted: false,
  legalDeadlineExtended: false, originalDecisionReversed: false} as const;
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const native = (v: unknown): v is Timestamp => v instanceof Timestamp && v.toMillis() > 0 && v.toMillis() <= Date.now();
const orderRef = (id: string) => db.collection('transactions').doc(id);
const rootRef = (id: string, claimId: string) => orderRef(id).collection('commercial_claim_reviews').doc(supportHash(claimId));
const entryRef = (id: string, eid: string) => orderRef(id).collection('commercial_claim_review_entries').doc(eid);
const receiptRef = (id: string, uid: string, rid: string) => orderRef(id).collection('commercial_claim_review_commands').doc(supportHash([uid, rid]));
const entryId = (uid: string, rid: string) => 'cr_' + supportHash([uid, rid]);
type Set = Awaited<ReturnType<typeof readProductReviewDocumentarySet>>;
export type ClaimReviewReference = {entryId: string; contentHash: string};
export function parseClaimReviewReference(value: unknown): ClaimReviewReference {
  const v = supportObject(value, ['entryId', 'contentHash']);
  if (!/^cr_[a-f0-9]{64}$/.test(v.entryId ?? '') || !hash(v.contentHash)) throw new HttpsError('invalid-argument', 'Référence native du réexamen requise.');
  return {entryId: v.entryId, contentHash: v.contentHash};
}
function sourceReference(value: unknown) {
  const v = supportObject(value, ['sourceHash', 'claimRevision', 'claimHash', 'reviewVersion', 'reviewHash', 'corpusHash', 'membersHash']);
  if (!['sourceHash', 'claimHash', 'reviewHash', 'corpusHash', 'membersHash'].every(k => hash(v[k])) ||
      typeof v.claimRevision !== 'string' || !/^\d+:\d+$/.test(v.claimRevision) || !Number.isSafeInteger(v.reviewVersion) || v.reviewVersion < 0)
    throw new HttpsError('invalid-argument', 'Version exacte de la plainte et du corpus requise.');
  return {sourceHash: v.sourceHash, claimRevision: v.claimRevision, claimHash: v.claimHash, reviewVersion: v.reviewVersion,
    reviewHash: v.reviewHash, corpusHash: v.corpusHash, membersHash: v.membersHash};
}
const memberHash = (s: Set) => supportSourceHash({contributions: s.manifest.contributions, communications: s.manifest.communications,
  evidence: s.manifest.evidence, intents: s.manifest.intents, lookahead: s.manifest.lookahead, documentaryComplete: s.documentaryComplete,
  ...('parcelReview' in s.manifest ? {parcelReview: s.manifest.parcelReview} : {})});
function notices(id: string, claimId: string, eid: string, buyer: string, seller: string, action: string) {
  return [buyer, seller].map(userId => ({eventKey: `commercial_claim_review_v1:${eid}`, userId, type: 'order_moderation',
    title: 'Suivi de la réclamation', message: action === 'withdraw_claim'
      ? 'Un retrait documentaire a été enregistré. Il ne clôture pas la plainte et ne décide ni des fonds ni du retour.'
      : 'Une demande de réexamen avec un nouvel élément a été enregistrée. Une admission opérateur distincte reste nécessaire.',
    data: {ownerId: userId, transactionId: id, disputeId: claimId}}));
}
async function entryProof(tx: FirebaseFirestore.Transaction, id: string, ref: ClaimReviewReference) {
  const raw = (await tx.get(entryRef(id, ref.entryId))).data(), d = raw?.document;
  if (raw?.protocol !== 'commercial_claim_review_entry_v1' || !d || d.protocol !== raw.protocol || raw.contentHash !== ref.contentHash ||
      supportSourceHash(d) !== ref.contentHash || d.transactionId !== id || d.entryId !== ref.entryId || !native(d.recordedAt) ||
      d.entryId !== entryId(d.actorId, d.requestId) || d.command.transactionId!==id || d.payloadHash !== supportHash(d.command) || d.actorId !== d.capture.buyerId ||
      d.capture.claimId !== d.command.claimId || supportSourceHash(d.capture) !== d.command.source.sourceHash ||
      !['withdraw_claim', 'request_reexamination'].includes(d.command.action) || Object.entries(effects).some(([k,v]) => d[k] !== v)) return null;
  const r = (await tx.get(receiptRef(id, d.actorId, d.requestId))).data();
  if (r?.protocol !== 'commercial_claim_review_command_v1' || r.actorId !== d.actorId || r.requestId !== d.requestId || r.state !== 'committed' ||
      r.payloadHash !== d.payloadHash || supportHash(r.command) !== d.payloadHash || supportHash(r.reference) !== supportHash(ref) ||
      !native(r.recordedAt) || !r.recordedAt.isEqual(d.recordedAt)) return null;
  const n = await readOperationalNoticeReceipts(tx, notices(id, d.command.claimId, d.entryId, d.capture.buyerId, d.capture.sellerId, d.command.action));
  if (n.some((v,i) => !v || v.notificationId !== r.notificationIds?.[i])) return null;
  return d;
}
/** Only a native original report receipt qualifies ownership. A ticket or an allegation is insufficient. */
async function originalClaim(tx: FirebaseFirestore.Transaction, id: string, cid: string, claim: any, order: any) {
  if (!claim || claim.transactionId !== id || claim.buyerId !== order.buyerId || claim.sellerId !== order.sellerId ||
      !native(claim.createdAt) || !['open', 'resolved'].includes(claim.status)) return false;
  if(claim.source==='late_commercial_support') {
    try {
      // Late import avoids an initialization dependency between intake and its
      // existing operator engine. No provider or financial IO is performed.
      const late=await import('./lateCommercialRecourse'),r=late.parseLateCommercialReference(claim.lateCommercial?.reference),d=await late.readLateCommercialAdmissionProof(tx,id,r);
      return !!d && !d.command.claimReexamination && d.command.decision==='admit_examination' && d.capture.buyerId===order.buyerId &&
        d.capture.sellerId===order.sellerId && cid==='late_'+supportHash([d.capture.clockOriginSupportRequestId,id]) &&
        supportHash(claim.productReview)===supportHash(d.capture.link);
    } catch(e) {if(e instanceof HttpsError)return false;throw e;}
  }
  if(claim.reportOwnerId!==order.buyerId) return false;
  let rid: string; try {rid = supportRequestId(claim.reportRequestId);} catch {return false;}
  if (cid !== 'problem_' + supportHash([order.buyerId, id, rid])) return false;
  if (claim.productReview?.topic === 'parcel_delivery') return qualifiedClaim(tx, id, order.buyerId, cid, claim, claim.productReview);
  const r = (await tx.get(orderRef(id).collection('problem_requests').doc(supportHash([order.buyerId, rid])))).data();
  const payload = {reason: claim.reason, details: claim.details ?? null,
    ...(claim.setDeclaration !== undefined ? {setDeclaration: claim.setDeclaration} : {}), ...(claim.productReview !== undefined ? {productReview: claim.productReview} : {})};
  return r?.protocol === 'transaction_problem_report_v1' && r.ownerId === order.buyerId && r.transactionId === id && r.requestId === rid &&
    r.disputeId === cid && r.state === 'committed' && r.committed === true && r.freezeCommitted === true && r.reason === null &&
    r.payloadHash === supportHash(payload) && claim.reportPayloadHash === r.payloadHash && r.financialEffect === 'none' &&
    supportHash(r.productReview ?? null) === supportHash(claim.productReview ?? null) && supportHash(r.setDeclaration ?? null) === supportHash(claim.setDeclaration ?? null);
}
async function current(tx: FirebaseFirestore.Transaction, id: string, cid: string, suppliedSet?: Set, admitted?: any) {
  const os = await tx.get(orderRef(id)), order = os.data(), cs = await tx.get(db.collection('disputes').doc(cid)), actual = cs.data();
  if (!order || !actual || !['open','resolved'].includes(actual.status) || actual.transactionId !== id || actual.buyerId !== order.buyerId || actual.sellerId !== order.sellerId ||
      typeof order.buyerId !== 'string' || typeof order.sellerId !== 'string' || order.buyerId === order.sellerId || order.cashAgreement || order.swapId || order.paidVia === 'cash')
    throw new HttpsError('failed-precondition', 'Commande et plainte natives à rapprocher.');
  let claim = actual, revision = supportRevision(cs);
  if (admitted) {
    // Undo ONLY this admission's known documentary transition for stable association.
    // Any later classification, independent change or different admission stays stale.
    if (actual.status !== 'open' || supportHash(actual.lateCommercial) !== supportHash(admitted.appliedLateCommercial) ||
        supportHash(actual.productReview) !== supportHash(admitted.capture.link) || !native(actual.reviewedAt) || !actual.reviewedAt.isEqual(admitted.recordedAt))
      throw new HttpsError('failed-precondition', 'Le réexamen a changé depuis son admission.');
    claim = {...actual};
    for (const key of ['status', 'lateCommercial', 'productReview', 'reviewedAt']) {
      if (Object.prototype.hasOwnProperty.call(admitted.capture.claimSnapshot, key)) claim[key] = admitted.capture.claimSnapshot[key]; else delete claim[key];
    }
    revision = admitted.capture.claimRevision;
  }
  const rs = await tx.get(rootRef(id, cid)), root = rs.data();
  let origin = claim;
  if (root) {
    if (root.protocol !== 'commercial_claim_review_root_v1' || root.transactionId !== id || root.claimId !== cid || root.buyerId !== order.buyerId ||
        root.sellerId !== order.sellerId || !['withdrawn','reexamination_requested'].includes(root.state) ||
        !Number.isSafeInteger(root.version) || root.version < 1 || root.version >= Number.MAX_SAFE_INTEGER)
      throw new HttpsError('failed-precondition', 'Historique du retrait à rapprocher.');
    const first = await entryProof(tx, id, parseClaimReviewReference(root.origin));
    if (!first || first.command.action !== 'withdraw_claim' || first.command.claimId !== cid) throw new HttpsError('failed-precondition', 'Origine du retrait inconnue.');
    const latest=await entryProof(tx,id,parseClaimReviewReference(root.latest));
    if(!latest || latest.command.claimId!==cid || latest.capture.reviewVersion+1!==root.version ||
        latest.command.action!==(root.state==='withdrawn' ? 'withdraw_claim' : 'request_reexamination') ||
        !native(root.recordedAt) || !root.recordedAt.isEqual(latest.recordedAt)) throw new HttpsError('failed-precondition','Pointeur courant du retrait à rapprocher.');
    origin = first.capture.originClaim;
  }
  if (!revision || !await originalClaim(tx, id, cid, origin, order)) throw new HttpsError('failed-precondition', 'Le reçu original de la plainte doit être retrouvé.');
  // This new capability reads the entire current P corpus, including native V4
  // members. It never retrogrades a parcel/material contribution by its topic.
  const material = true, parcel = true;
  const set = suppliedSet ?? await readProductReviewDocumentarySet(tx, {kind: 'order', id}, material, parcel);
  const capture = {protocol: 'commercial_claim_review_source_capture_v1', transactionId: id, claimId: cid, buyerId: order.buyerId, sellerId: order.sellerId,
    claimRevision: revision, claimHash: supportSourceHash(claim), claimSnapshot: claim, originClaim: origin,
    reviewVersion: root?.version ?? 0, reviewHash: supportSourceHash(root ?? null),
    caseVersion: set.root?.version ?? null, caseHash: supportSourceHash(set.root ?? null), corpusHash: set.corpusHash, membersHash: memberHash(set),
    manifest: set.manifest, materialCapability: material ? 'product_review_material_v1' : null, parcelCapability: parcel ? 'product_review_parcel_v1' : null,
    orderSemanticHash: supportSourceHash(Object.fromEntries(['buyerId','sellerId','articleId','articleSnapshot','paidVia','totalAmount','currency',
      'capturedCardCents','walletAmountUsed','stripePaymentIntentId','sellerCreditedCents','paidAt','fundsReleasedAt','bankDispute','returnRequest','deliveryCorrection']
      .map(k => [k, order[k] ?? null])))};
  const sourceHash = supportSourceHash(capture), reference = {sourceHash, claimRevision: revision, claimHash: capture.claimHash,
    reviewVersion: capture.reviewVersion, reviewHash: capture.reviewHash, corpusHash: set.corpusHash, membersHash: capture.membersHash};
  return {order,claim,actual,root,set,capture,reference};
}
function entryView(d: any, reference: ClaimReviewReference) {
  return {reference, claimId: d.command.claimId, action: d.command.action, narrative: d.command.narrative,
    withdrawal: d.command.withdrawal, newContribution: d.command.newContribution, recordedAt: d.recordedAt.toDate().toISOString(),
    originalClaimStatus: d.capture.claimSnapshot.status, historicalOnly: true, ...effects};
}
function commandInput(raw: unknown) {
  const v = supportObject(raw, ['transactionId','claimId','action','source','narrative','withdrawal','newContribution','acknowledged']);
  if (!['withdraw_claim','request_reexamination'].includes(v.action) || v.acknowledged !== true) throw new HttpsError('invalid-argument', 'Choix documentaire explicite requis.');
  const withdrawal = v.withdrawal === null ? null : parseClaimReviewReference(v.withdrawal);
  let newContribution = null;
  if (v.newContribution !== null) {
    const n = supportObject(v.newContribution,['id','contentHash','topic','materialCapability','parcelCapability']);
    if (!/^pc_[a-f0-9]{64}$/.test(n.id ?? '') || !hash(n.contentHash) || !['authenticity','nonconformity'].includes(n.topic) ||
        n.materialCapability !== undefined && n.materialCapability !== 'product_review_material_v1' || n.topic === 'nonconformity' && !n.materialCapability ||
        n.parcelCapability !== undefined && n.parcelCapability !== 'product_review_parcel_v1') throw new HttpsError('invalid-argument','Nouvel élément natif exact requis.');
    newContribution = {id:n.id,contentHash:n.contentHash,topic:n.topic,...(n.materialCapability ? {materialCapability:n.materialCapability} : {}),...(n.parcelCapability ? {parcelCapability:n.parcelCapability} : {})};
  }
  if (v.action === 'withdraw_claim' ? withdrawal !== null || newContribution !== null : !withdrawal || !newContribution) throw new HttpsError('invalid-argument','Retrait préalable et nouvel élément distincts requis.');
  return {transactionId:supportId(v.transactionId),claimId:supportId(v.claimId),action:v.action,source:sourceReference(v.source),narrative:supportText(v.narrative,'Motivation'),withdrawal,newContribution,acknowledged:true};
}
export async function handleCommercialClaimReview(request:any) {
  const uid = supportUid(request), r = supportObject(request.data,['expectedUid','capability','mode','transactionId','claimId','scope','cursor','requestId','action','command']);
  if (r.capability !== COMMERCIAL_CLAIM_REVIEW_CAPABILITY) throw new HttpsError('invalid-argument','Version du suivi de plainte requise.');
  if (r.mode === 'command') {
    const command = commandInput(r.command), rid = supportRequestId(r.requestId), payloadHash = supportHash(command), eid = entryId(uid,rid);
    if (!['execute','observe','neutralize'].includes(r.action)) throw new HttpsError('invalid-argument','Action du journal requise.');
    if(r.action==='execute' && !(await receiptRef(command.transactionId,uid,rid).get()).exists)
      await checkRateLimit(uid,true,{functionName:'commercialClaimReview',maxCallsAuthenticated:10,maxCallsUnauthenticated:0,windowMs:60000});
    return db.runTransaction(async tx => {
      const rr = receiptRef(command.transactionId,uid,rid), prior = (await tx.get(rr)).data();
      const view = (d?:any) => ({protocol:'commercial_claim_review_command_v1',actorId:uid,requestId:rid,command,payloadHash,state:d?.state ?? 'unrecorded',
        reason:d?.reason ?? null,reference:d?.reference ?? null,recordedAt:native(d?.recordedAt) ? d.recordedAt.toDate().toISOString() : null,...effects});
      if (prior) {
        if (prior.protocol !== 'commercial_claim_review_command_v1' || prior.actorId !== uid || prior.requestId !== rid || prior.payloadHash !== payloadHash ||
            supportHash(prior.command) !== payloadHash || !native(prior.recordedAt) || !['committed','not_executed'].includes(prior.state)) throw new HttpsError('already-exists','Intention différente.');
        if (prior.state === 'committed' && !await entryProof(tx,command.transactionId,parseClaimReviewReference(prior.reference))) throw new HttpsError('unavailable','Reçu du retrait à rapprocher.');
        return view(prior);
      }
      if (r.action === 'observe') return view();
      const now = Timestamp.now(), reject = (reason:string) => {const d = {protocol:'commercial_claim_review_command_v1',actorId:uid,requestId:rid,command,payloadHash,state:'not_executed',reason,reference:null,recordedAt:now};tx.create(rr,d);return view(d);};
      if (r.action === 'neutralize') return reject('requester_neutralized');
      if (!COMMERCIAL_CLAIM_REVIEW_ENABLED) return reject('commercial_claim_review_not_exposed');
      const ownOrder=(await tx.get(orderRef(command.transactionId))).data();
      if(!ownOrder || ownOrder.buyerId!==uid) return reject('not_the_native_buyer');
      let s:Awaited<ReturnType<typeof current>>;
      try {s = await current(tx,command.transactionId,command.claimId);} catch(e) {if(e instanceof HttpsError && e.code === 'failed-precondition') return reject('claim_source_unqualified');throw e;}
      if (s.order.buyerId !== uid) return reject('not_the_native_buyer');
      if (supportHash(s.reference) !== supportHash(command.source)) return reject('source_changed');
      const authMs=request.auth.token?.auth_time*1000;
      if(!Number.isSafeInteger(authMs) || authMs<1 || authMs>Date.now()) return reject('participant_session_unavailable');
      try {await supportCurrentAdminSession(request);} catch(e) {if(e instanceof HttpsError && e.code==='permission-denied' || (e as {code?:string})?.code==='auth/user-not-found')return reject('participant_session_unavailable');throw e;}
      try {await assertAccountSecurityOpen((await tx.get(db.collection('eligibility_profiles').doc(uid))).data(), tx, uid);} catch(e) {if(e instanceof HttpsError && e.code==='failed-precondition')return reject('participant_security_restricted');throw e;}
      if (command.action === 'request_reexamination') {
        if (s.root?.state !== 'withdrawn' || supportHash(s.root.latest) !== supportHash(command.withdrawal)) return reject('withdrawal_changed');
        const w = await entryProof(tx,command.transactionId,command.withdrawal!);
        const n = command.newContribution!, selected = s.set.contributionRows.find(c => c.id === n.id);
        if (!w || w.command.action !== 'withdraw_claim' || w.command.claimId !== command.claimId || !selected?.proof || selected.contentHash !== n.contentHash ||
            selected.proof.actorId !== uid || selected.proof.actorRole !== 'buyer' || selected.proof.topic !== n.topic ||
            n.topic === 'nonconformity' && !selected.proof.command.materialStatement ||
            w.capture.manifest.contributions.some((c:any) => c.id === n.id) || selected.proof.recordedAt.toMillis() < w.recordedAt.toMillis()) return reject('new_element_unqualified');
        if (!s.set.documentaryComplete || s.set.coverage.contributionsHasMore || s.set.coverage.communicationsHasMore ||
            s.set.documentaryCoverage.evidenceHasMore || s.set.documentaryCoverage.intentsHasMore) return reject('corpus_requires_review');
        if ((n.materialCapability === 'product_review_material_v1') !== (s.capture.materialCapability !== null) ||
            (n.parcelCapability === 'product_review_parcel_v1') !== (s.capture.parcelCapability !== null)) return reject('documentary_version_changed');
      } else if (s.root?.state === 'withdrawn') return reject('already_withdrawn');
      const document = {protocol:'commercial_claim_review_entry_v1',entryId:eid,transactionId:command.transactionId,actorId:uid,requestId:rid,command,payloadHash,capture:s.capture,recordedAt:now,...effects};
      if (Buffer.byteLength(JSON.stringify(document),'utf8') > 800000) return reject('document_capacity_requires_review');
      const contentHash = supportSourceHash(document), reference = {entryId:eid,contentHash};
      const notice = await prepareOperationalNotices(tx,notices(command.transactionId,command.claimId,eid,s.order.buyerId,s.order.sellerId,command.action));
      const root = {protocol:'commercial_claim_review_root_v1',transactionId:command.transactionId,claimId:command.claimId,buyerId:uid,sellerId:s.order.sellerId,
        version:s.capture.reviewVersion + 1,state:command.action === 'withdraw_claim' ? 'withdrawn' : 'reexamination_requested',
        origin:s.root?.origin ?? reference,latest:reference,materialCapability:s.capture.materialCapability,parcelCapability:s.capture.parcelCapability,recordedAt:now};
      tx.set(rootRef(command.transactionId,command.claimId),root);
      tx.create(entryRef(command.transactionId,eid),{protocol:document.protocol,document,contentHash});
      const result = {protocol:'commercial_claim_review_command_v1',actorId:uid,requestId:rid,command,payloadHash,state:'committed',reason:null,reference,recordedAt:now,notificationIds:notice.notificationIds};
      tx.create(rr,result); notice.commit();return view(result);
    });
  }
  const id = supportId(r.transactionId), cursor = r.cursor == null ? null : supportObject(r.cursor,['lastId']).lastId;
  if (cursor !== null && (typeof cursor !== 'string' || !cursor || cursor.includes('/') || Buffer.byteLength(cursor,'utf8') > 1500)) throw new HttpsError('invalid-argument','Curseur invalide.');
  if (!['own','admin'].includes(r.scope) || !['source_observe','history_observe'].includes(r.mode)) throw new HttpsError('invalid-argument','Lecture explicite requise.');
  return db.runTransaction(async tx => {
    const order = (await tx.get(orderRef(id))).data();
    if (!order || (r.scope === 'own' && order.buyerId !== uid)) throw new HttpsError('permission-denied','Pas votre plainte.');
    if (r.scope === 'admin') {await supportCurrentAdminSession(request);await supportAdmin(tx,uid,false);assertRecentAccountAuthentication(request.auth.token);}
    if (r.mode === 'source_observe' && r.claimId != null) {
      const cid = supportId(r.claimId);let s:Awaited<ReturnType<typeof current>>;
      try {s = await current(tx,id,cid);} catch(e) {if(e instanceof HttpsError && e.code === 'failed-precondition') return {protocol:'commercial_claim_review_source_v1',actorId:uid,scope:r.scope,transactionId:id,claimId:cid,qualification:'unknown',source:null,...effects};throw e;}
      const withdrawal = s.root?.state === 'withdrawn' ? await entryProof(tx,id,parseClaimReviewReference(s.root.latest)) : null;
      const own = s.set.contributionRows.filter(c => withdrawal && c.proof?.actorId === order.buyerId && c.proof.actorRole === 'buyer' &&
        ['authenticity','nonconformity'].includes(c.proof.topic) && c.proof.recordedAt.toMillis() >= withdrawal.recordedAt.toMillis() &&
        !withdrawal.capture.manifest.contributions.some((p:any)=>p.id===c.id));
      return {protocol:'commercial_claim_review_source_v1',actorId:uid,scope:r.scope,transactionId:id,claimId:cid,qualification:'native_original_claim',source:{reference:s.reference,
        originalDisputeId:cid,originalCreatedAt:s.capture.originClaim.createdAt.toDate().toISOString(),currentStatus:s.actual.status,
        caseId:s.set.source.caseId,documentarySourceHash:s.set.source.sourceHash,materialCapability:'product_review_material_v1',parcelCapability:'product_review_parcel_v1',
        initialResolution:s.actual.status === 'resolved' ? {resolution:['dismissed','refunded','buyer_upheld'].includes(s.actual.resolution) ? s.actual.resolution : null,resolvedAt:native(s.actual.resolvedAt) ? s.actual.resolvedAt.toDate().toISOString() : null} : null,
        reviewState:s.root?.state ?? 'unrecorded',latestReference:s.root?.latest ?? null,
        newContributionCandidates:own.map(c => ({id:c.id,contentHash:c.contentHash,topic:c.proof!.topic,
          ...(s.capture.materialCapability ? {materialCapability:s.capture.materialCapability} : {}),...(s.capture.parcelCapability ? {parcelCapability:s.capture.parcelCapability} : {})})),
        documentaryComplete:s.set.documentaryComplete,operatorAdmissionRequired:true},...effects};
    }
    let q:FirebaseFirestore.Query = r.mode === 'source_observe' ? db.collection('disputes').where('transactionId','==',id).orderBy('__name__').limit(21) :
      orderRef(id).collection('commercial_claim_review_entries').orderBy('__name__').limit(21);
    if (cursor) q=q.startAfter(cursor);
    const page=await tx.get(q),rows=page.docs.slice(0,20),items=[];
    for (const row of rows) {
      if (r.mode === 'source_observe') {
        const c=row.data(),root=(await tx.get(rootRef(id,row.id))).data();let original=c;
        if(root?.protocol==='commercial_claim_review_root_v1' && root.transactionId===id && root.claimId===row.id && root.buyerId===order.buyerId && root.sellerId===order.sellerId) {
          try {const origin=await entryProof(tx,id,parseClaimReviewReference(root.origin));if(origin?.command.claimId===row.id) original=origin.capture.originClaim;}catch(e){if(!(e instanceof HttpsError))throw e;}
        }
        const qualified=await originalClaim(tx,id,row.id,original,order);
        items.push(qualified ? {qualification:'native_original_claim',claimId:row.id,status:c.status,reason:c.reason,createdAt:c.createdAt.toDate().toISOString()} : {qualification:'unknown',claimId:row.id,status:null,reason:null,createdAt:null});
      } else {
        const reference={entryId:row.id,contentHash:row.data().contentHash},d=await entryProof(tx,id,reference);
        items.push(d && d.capture.buyerId===order.buyerId ? {qualification:'native_recorded_entry',entry:entryView(d,reference)} : {qualification:'unknown',entryId:row.id,entry:null});
      }
    }
    return {protocol:r.mode === 'source_observe' ? 'commercial_claim_review_claims_v1' : 'commercial_claim_review_history_v1',actorId:uid,scope:r.scope,transactionId:id,items,
      nextCursor:page.size>20 ? {lastId:rows.at(-1)!.id} : null,coverage:{inspected:rows.length,limit:20,hasMore:page.size>20,exhaustiveHistoryVerified:false},...effects};
  });
}

/** Existing late-commercial engine calls this basis; no new financial engine or claim is created. */
export async function readClaimReexaminationBasis(tx:FirebaseFirestore.Transaction,id:string,reference:ClaimReviewReference,suppliedSet?:Set,admitted?:any) {
  const request=await entryProof(tx,id,parseClaimReviewReference(reference));
  if (!request || request.command.action !== 'request_reexamination') throw new HttpsError('failed-precondition','Demande native de réexamen requise.');
  const cid=request.command.claimId,s=await current(tx,id,cid,suppliedSet,admitted);
  if (s.root?.state !== 'reexamination_requested' || supportHash(s.root.latest)!==supportHash(reference)) throw new HttpsError('failed-precondition','Le retrait ou la demande de réexamen a changé.');
  const w=await entryProof(tx,id,request.command.withdrawal),n=request.command.newContribution,selected=s.set.contributionRows.find(c=>c.id===n.id);
  if (!w || w.command.claimId!==cid || w.command.action!=='withdraw_claim' || !selected?.proof || selected.contentHash!==n.contentHash ||
      selected.proof.actorId!==s.order.buyerId || selected.proof.actorRole!=='buyer' || selected.proof.topic!==n.topic ||
      s.capture.materialCapability !== (n.materialCapability ?? null) || s.capture.parcelCapability !== (n.parcelCapability ?? null)) throw new HttpsError('failed-precondition','Nouvel élément et corpus à rapprocher.');
  const link={protocol:'late_commercial_support_link_v1' as const,transactionId:id,caseId:s.set.source.caseId,topic:n.topic,contributionId:n.id,contributionHash:n.contentHash,sourceHash:request.capture.manifest.sourceHash,
    ...(n.materialCapability ? {materialCapability:n.materialCapability} : {}),...(n.parcelCapability ? {parcelCapability:n.parcelCapability} : {})};
  const ledger=await tx.get(db.collection('wallets').doc(s.order.sellerId).collection('ledger').where('transactionId','==',id).limit(101));
  const releases=ledger.docs.filter(r=>r.data().type==='funds_released');
  const currency=typeof s.order.currency==='string' && s.order.currency.toUpperCase()==='CAD' ? 'CAD' : null;
  const qualified=ledger.size<=100 && native(s.order.fundsReleasedAt) && releases.length>0 && currency!==null &&
    releases.every(r=>Number.isSafeInteger(r.data().amount) && r.data().amount>=0 && native(r.data().createdAt));
  const amount=qualified ? releases.reduce((n,r)=>n+r.data().amount,0) : null;
  const amountQualified=amount!==null && Number.isSafeInteger(amount) && Number.isSafeInteger(s.order.sellerCreditedCents) && amount<=s.order.sellerCreditedCents;
  const financialSituation={releaseQualification:amountQualified ? 'native_release_movement' : 'unknown',releasedAt:native(s.order.fundsReleasedAt) ? s.order.fundsReleasedAt.toDate().toISOString() : null,
    releasedAmountCents:amountQualified ? amount : null,currency,amountBasis:'historical_release_movement',currentHeldAmountCents:null,currentAvailableAmountCents:null,withdrawalAttribution:'unknown',bankReceiptVerified:false};
  // Current membership, not a later read's sourceHash, associates the native
  // corpus. The existing money engine separately requalifies its live guards.
  const {manifest:_manifest,corpusHash:_corpusHash,...stable}=s.capture;
  const capture={...stable,protocol:'commercial_claim_reexamination_basis_v1',reexamination:reference,withdrawal:request.command.withdrawal,link,
    ledgerCoverage:ledger.size<=100 ? 'bounded_complete' : 'unknown',ledgerHash:supportSourceHash(releases.map(r=>[r.id,r.data()])),
    ledgerHashBasis:'attributed_release_movements',financialSituation,
    // Only real attributed release movements qualify the historical financial observation.
    initialReceivedAtMs:s.capture.originClaim.createdAt.toMillis()};
  return {...s,link,capture,sourceHash:supportSourceHash(capture),originalDisputeId:cid};
}
