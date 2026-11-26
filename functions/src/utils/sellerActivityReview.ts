/** Human examination of recorded seller facts. No activity threshold, fraud,
 * professional status, tax obligation or permission is inferred from volume. */
import {Timestamp} from 'firebase-admin/firestore';
import {HttpsError} from 'firebase-functions/v2/https';
import {auth, db} from '../config/firebase';
import {ELIGIBILITY_POLICY_VERSION, eligibilityVersion} from '../shared/eligibility';
import {quebecCivilDate} from '../shared/age';
import {ELIGIBILITY_COLLECTIONS as C, readEligibilityEvidence, assertRecentAccountAuthentication,
  assertAccountSecurityOpen} from './eligibility';
import {assertPrivateAccountSession, withPrivateAccountSession} from './privateAccountSession';
import {supportUid, supportObject, supportRequestId, supportText, supportAdmin,
  supportHash, supportSourceHash, supportRevision} from './supportRequest';
import {readSellerActivitySellerPage} from './sellerActivityFacts';
import {prepareOperationalNotices, readOperationalNoticeReceipt, type OperationalNoticeInput} from './notifications';

export const SELLER_ACTIVITY_REVIEW_CAPABILITY = 'seller_activity_review_v1';
export const SELLER_ACTIVITY_REVIEW_CRITERIA_VERSION = 'seller_activity_human_examination_v1';
const CRITERIA = [
  {code:'recorded_activity_clarification', label:'Préciser les circonstances des annonces ou commandes observées.'},
  {code:'declaration_consistency', label:'Clarifier la déclaration d’activité au regard des faits observés.'},
  {code:'source_unknowns_clarification', label:'Clarifier les dates, effets ou limites de couverture encore inconnus.'},
  {code:'account_age_clarification', label:'Clarifier les dates distinctes du profil et du compte Auth.'},
] as const;
type Data = FirebaseFirestore.DocumentData;
type Anchor = {kind:'order'|'article';id:string};
type Period = {fromInclusive:string;toExclusive:string};
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const noInference = {fraudEstablished:false, professionalClassification:null, taxRegistrationEstablished:false,
  financialEffect:'none', inventoryEffect:'none', automaticThresholdApplied:false} as const;
const nativeId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 &&
  Buffer.byteLength(v, 'utf8') <= 1500 && !v.includes('/') && !['.', '..'].includes(v) && !/^__.*__$/.test(v);
const validUid = (v: unknown): v is string => nativeId(v) && v.length <= 128;
function nativeInputId(value: unknown): string {
  if (!nativeId(value)) throw new HttpsError('invalid-argument','Identifiant natif invalide.');
  return value;
}
function anchorInput(value: unknown): Anchor {
  const v = supportObject(value,['kind','id']);
  if (!['order','article'].includes(v.kind)) throw new HttpsError('invalid-argument','Source annonce ou commande requise.');
  return {kind:v.kind,id:nativeInputId(v.id)};
}
function periodInput(value: unknown): Period {
  const v = supportObject(value,['fromInclusive','toExclusive']);
  const iso = (s: unknown): s is string => typeof s === 'string' && Number.isSafeInteger(Date.parse(s)) &&
    Date.parse(s) >= 0 && new Date(s).toISOString() === s;
  if (!iso(v.fromInclusive) || !iso(v.toExclusive) || v.fromInclusive >= v.toExclusive || Date.parse(v.toExclusive) > Date.now())
    throw new HttpsError('invalid-argument','Période UTC explicite, réelle et non future requise.');
  return {fromInclusive:v.fromInclusive,toExclusive:v.toExclusive};
}
function cursorInput(value: unknown): string|null {return value == null ? null : nativeInputId(value);}
async function adminSession(tx: FirebaseFirestore.Transaction, request: any, recent = true) {
  const session = await assertPrivateAccountSession(request,tx);
  await supportAdmin(tx,session.uid,session.currentAdminClaim);
  if (recent) {
    assertRecentAccountAuthentication(request.auth.token);
    await assertAccountSecurityOpen((await tx.get(db.collection(C.profiles).doc(session.uid))).data(), tx, session.uid);
  }
}
async function authCreation(ownerId: string) {
  let record;
  try {record=await auth.getUser(ownerId);} catch (error) {
    if ((error as {code?:unknown})?.code !== 'auth/user-not-found') throw new HttpsError('unavailable','La source Auth ne peut pas être consultée.');
    return {qualification:'unknown' as const,at:null,reason:'auth_account_not_found',source:'firebase_auth' as const};
  }
  const value = record.metadata?.creationTime, ms = typeof value === 'string' ? Date.parse(value) : NaN;
  return record.uid === ownerId && Number.isSafeInteger(ms) && ms >= 0 && ms <= Date.now() ?
    {qualification:'native_auth_metadata' as const,at:new Date(ms).toISOString(),reason:null,source:'firebase_auth' as const} :
    {qualification:'unknown' as const,at:null,reason:'auth_creation_unqualified',source:'firebase_auth' as const};
}
async function source(tx: FirebaseFirestore.Transaction, actorId: string, anchor: Anchor, period: Period, cursor: string|null) {
  const ref=db.collection(anchor.kind==='order'?'transactions':'articles').doc(anchor.id), snap=await tx.get(ref), native=snap.data();
  const revision=supportRevision(snap);
  if (!native || !validUid(native.sellerId) || !revision || anchor.kind==='order' &&
      (!validUid(native.buyerId) || native.buyerId===native.sellerId)) throw new HttpsError('failed-precondition','Source native non qualifiée.');
  const anchorSource={...anchor,sellerId:native.sellerId,revision,sourceHash:supportSourceHash(native)};
  const scopeHash=supportSourceHash({protocol:SELLER_ACTIVITY_REVIEW_CAPABILITY,actorId,anchor:anchorSource,period});
  const page=await readSellerActivitySellerPage(tx,native.sellerId,scopeHash,cursor);
  const evidence=await readEligibilityEvidence(tx,native.sellerId);
  const eligibilitySnapshot=await tx.get(db.collection(C.profiles).doc(native.sellerId));
  const declarationKind=['personal','professional'].includes(evidence.profile?.activityDeclaration?.kind) ? evidence.profile!.activityDeclaration.kind as string : null;
  if (!evidence.user) throw new HttpsError('failed-precondition','Le propriétaire natif doit être rapproché avant un examen.');
  const profile={...page.profile,authCreatedAt:await authCreation(native.sellerId)};
  const items=page.items.map(item=>({...item,periodMembership:item.createdAt.at===null?'unknown' as const:
    item.createdAt.at>=period.fromInclusive && item.createdAt.at<period.toExclusive?'inside' as const:'outside' as const}));
  const facts={profile,items,pagination:page.pagination,coverage:{...page.coverage,period,
    periodDateField:'transactions.createdAt',unknownDatesIncluded:true,periodCoverageVerified:false},
    activityDeclaration:{kind:declarationKind,
      source:{revision:supportRevision(eligibilitySnapshot),sourceHash:supportSourceHash(eligibilitySnapshot.data() ?? null)},
      qualification:declarationKind ? 'recorded_declaration_only':'unknown',legallyVerified:false}};
  // readAt is a display clock, never part of the reviewed native identity.
  const reviewedSource={anchor:anchorSource,period,cursor,facts,eligibilityVersion:eligibilityVersion(evidence)};
  return {ownerId:native.sellerId,evidence,reviewedSource,sourceHash:supportSourceHash(reviewedSource)};
}
export function sellerActivityReviewNotice(ownerId: string, reviewId: string, event: string): OperationalNoticeInput {
  const opening=event==='opened', response=event.startsWith('decision_');
  return {eventKey:`seller-activity-review:${reviewId}:${event}`,userId:ownerId,type:'eligibility_review',
    title:opening?'Un examen de votre activité a été ouvert':response?'Votre dossier d’examen a reçu une réponse':'Votre recours a été enregistré',
    message:opening?'Consultez le motif du dossier et apportez vos précisions dans les conditions d’accès de votre compte.':
      response?'Consultez le motif de la réponse, les renseignements demandés et les possibilités de recours dans votre dossier.':
      'Votre demande liée au dossier précédent est disponible dans les conditions d’accès de votre compte.',
    data:{reviewId,event,reviewCapability:SELLER_ACTIVITY_REVIEW_CAPABILITY}};
}
/** This is server provenance, not an owner supplied classification. */
export function isSellerActivityReview(record: Data|undefined): boolean {
  const origin=record?.sellerActivityReview;
  return record?.kind==='review' && record.scope==='sell' && origin?.protocol===SELLER_ACTIVITY_REVIEW_CAPABILITY &&
    hash(origin.sourceHash) && Array.isArray(origin.signalIds) && origin.signalIds.length===1 &&
    typeof origin.signalIds[0]==='string' && validUid(origin.openedBy);
}
export function sellerActivityAdminReviewDto(record: Data) {
  if (!isSellerActivityReview(record)) return null;
  const v=record.sellerActivityReview;
  return {protocol:SELLER_ACTIVITY_REVIEW_CAPABILITY,sourceHash:v.sourceHash,criteriaVersion:v.criteriaVersion,
    criteriaCodes:v.criteriaCodes,signalIds:v.signalIds,openedBy:v.openedBy,reviewedSource:v.reviewedSource};
}
function commandInput(value: unknown) {
  const v=supportObject(value,['anchor','period','cursor','expectedSourceHash','expectedEligibilityVersion','criteriaVersion',
    'criteriaCodes','ownerReason','internalNote']);
  const anchor=anchorInput(v.anchor),period=periodInput(v.period),cursor=cursorInput(v.cursor);
  if (!hash(v.expectedSourceHash) || !hash(v.expectedEligibilityVersion) || typeof v.criteriaVersion!=='string' ||
      !Array.isArray(v.criteriaCodes) || !v.criteriaCodes.length || v.criteriaCodes.length>CRITERIA.length ||
      new Set(v.criteriaCodes).size!==v.criteriaCodes.length || v.criteriaCodes.some((c:unknown)=>typeof c!=='string'))
    throw new HttpsError('invalid-argument','Source, version et critères examinés requis.');
  return {anchor,period,cursor,expectedSourceHash:v.expectedSourceHash,expectedEligibilityVersion:v.expectedEligibilityVersion,
    criteriaVersion:v.criteriaVersion,criteriaCodes:v.criteriaCodes as string[],ownerReason:supportText(v.ownerReason,'Motif communiqué',2000),
    internalNote:v.internalNote==null?null:supportText(v.internalNote,'Motif opérateur',2000)};
}
async function receiptView(tx: FirebaseFirestore.Transaction, record: Data, actorId: string, requestId: string, payloadHash: string, replay: boolean) {
  if (record.protocol!==SELLER_ACTIVITY_REVIEW_CAPABILITY || record.actorUid!==actorId || record.requestId!==requestId || record.inputHash!==payloadHash)
    throw new HttpsError('already-exists','Cet identifiant correspond à une autre commande.');
  const identity='activity_review_'+supportHash([actorId,requestId]);
  if (record.action!=='seller_activity_review_open' || !['committed','not_executed'].includes(record.state) ||
      !(record.createdAt instanceof Timestamp) || record.createdAt.toMillis()<1 || record.createdAt.toMillis()>Date.now() ||
      (record.descriptorOnly === true ? record.command !== null || record.state !== 'not_executed' : record.inputHash!==supportHash(record.command)) || record.state==='committed' &&
      (record.reviewId!=='review_'+identity || record.signalId!=='signal_'+identity || !validUid(record.ownerId) ||
       !record.ownerNotice || supportHash(record.ownerNotice)!==supportHash(sellerActivityReviewNotice(record.ownerId,record.reviewId,'opened'))))
    throw new HttpsError('failed-precondition','Le reçu natif doit être rapproché.');
  const notice=record.state==='committed'?await readOperationalNoticeReceipt(tx,record.ownerNotice):null;
  if (record.state==='committed' && !notice) throw new HttpsError('failed-precondition','La preuve de notification manque.');
  return {protocol:SELLER_ACTIVITY_REVIEW_CAPABILITY,actorId,requestId,payloadHash,state:record.state,
    committed:record.state==='committed',replay,reviewId:record.reviewId??null,signalId:record.signalId??null,
    reason:record.reason??null,recordedAt:record.createdAt.toDate().toISOString(),notice,...noInference};
}
/** Existing support endpoints dispatch here; no new Cloud Function or job. */
export async function handleSellerActivityReview(request: any) {
  return withPrivateAccountSession(request,async()=>{
    const uid=supportUid(request), raw=supportObject(request.data,['capability','mode','expectedUid','expectedAdminUid',
      'anchor','period','cursor','requestId','command','descriptor']);
    if (raw.capability!==SELLER_ACTIVITY_REVIEW_CAPABILITY || raw.expectedAdminUid!==uid)
      throw new HttpsError('invalid-argument','Contexte administratif explicite requis.');
    if (raw.mode==='seller_activity_review_preview') {
      if (raw.command!==undefined || raw.requestId!==undefined || raw.descriptor!==undefined) throw new HttpsError('invalid-argument','L’aperçu ne reçoit aucune commande.');
      const anchor=anchorInput(raw.anchor),period=periodInput(raw.period),cursor=cursorInput(raw.cursor);
      const result=await db.runTransaction(async tx=>{
        await adminSession(tx,request);
        const current=await source(tx,uid,anchor,period,cursor);
        await adminSession(tx,request);
        return {protocol:SELLER_ACTIVITY_REVIEW_CAPABILITY,actorId:uid,sellerId:current.ownerId,readAt:Timestamp.now().toDate().toISOString(),
          ...current.reviewedSource,sourceHash:current.sourceHash,criteriaVersion:SELLER_ACTIVITY_REVIEW_CRITERIA_VERSION,criteria:CRITERIA,
          reviewScope:'sell',reviewRequiredByOperator:true,...noInference};
      });
      await db.runTransaction(tx=>adminSession(tx,request));
      return result;
    }
    if (!['execute','observe','neutralize'].includes(raw.mode) || raw.anchor!==undefined || raw.period!==undefined || raw.cursor!==undefined)
      throw new HttpsError('invalid-argument','Mode de commande invalide.');
    const requestId=supportRequestId(raw.requestId);
    if (raw.descriptor!==undefined && (raw.mode==='execute' || raw.command!==undefined))
      throw new HttpsError('invalid-argument','Le descripteur est réservé à la lecture ou à la neutralisation du reçu.');
    const descriptor=raw.descriptor===undefined?null:supportObject(raw.descriptor,['payloadHash']);
    if (descriptor && !hash(descriptor.payloadHash)) throw new HttpsError('invalid-argument','Empreinte de la commande requise.');
    const command=descriptor?null:commandInput(raw.command),payloadHash=descriptor?.payloadHash ?? supportHash(command);
    const operationId='activity_review_'+supportHash([uid,requestId]), opRef=db.collection(C.audit).doc(operationId);
    const reviewId='review_'+operationId,signalId='signal_'+operationId,reviewRef=db.collection(C.requests).doc(reviewId);
    const result=await db.runTransaction(async tx=>{
      await assertPrivateAccountSession(request,tx);
      const previous=(await tx.get(opRef)).data();
      if (previous) return receiptView(tx,previous,uid,requestId,payloadHash,true);
      // Observation and late-command neutralisation disclose no target facts
      // and cannot acquire a NEW authority after role/admission policy loss.
      if (raw.mode==='observe') return {protocol:SELLER_ACTIVITY_REVIEW_CAPABILITY,actorId:uid,requestId,payloadHash,
        state:'unrecorded',committed:false,replay:false,reviewId:null,signalId:null,reason:null,recordedAt:null,notice:null,...noInference};
      const now=Timestamp.now();
      const refuse=(reason:string)=>{
        const record={protocol:SELLER_ACTIVITY_REVIEW_CAPABILITY,action:'seller_activity_review_open',actorUid:uid,requestId,
          inputHash:payloadHash,command,descriptorOnly:descriptor!==null,state:'not_executed',reason,createdAt:now,reviewId:null,signalId:null};
        tx.create(opRef,record);
        return {protocol:SELLER_ACTIVITY_REVIEW_CAPABILITY,actorId:uid,requestId,payloadHash,state:'not_executed',committed:false,
          replay:false,reviewId:null,signalId:null,reason,recordedAt:now.toDate().toISOString(),notice:null,...noInference};
      };
      if (raw.mode==='neutralize') return refuse('command_neutralized');
      if (!command) throw new HttpsError('invalid-argument','Une nouvelle ouverture exige sa commande complète.');
      await adminSession(tx,request);
      const existing=(await tx.get(reviewRef)).data();
      if (existing) throw new HttpsError('failed-precondition','Dossier existant sans reçu qualifié.');
      if (command.criteriaVersion!==SELLER_ACTIVITY_REVIEW_CRITERIA_VERSION ||
          command.criteriaCodes.some(code=>!CRITERIA.some(c=>c.code===code))) return refuse('criteria_version_changed');
      let current: Awaited<ReturnType<typeof source>>;
      try {current=await source(tx,uid,command.anchor,command.period,command.cursor);} catch (error) {
        if (!(error instanceof HttpsError) || error.code!=='failed-precondition') throw error;
        await adminSession(tx,request);return refuse('source_unqualified');
      }
      if (current.sourceHash!==command.expectedSourceHash || eligibilityVersion(current.evidence)!==command.expectedEligibilityVersion) {
        await adminSession(tx,request); return refuse('source_changed');
      }
      const evidence=current.evidence, profile=evidence.profile??{};
      // One linked open seller-activity examination per seller. A different RID
      // cannot duplicate the block/notice from the same or another fact page.
      const active=profile.sellerActivityReview;
      const activeRequest=typeof active?.reviewId==='string'?(await tx.get(db.collection(C.requests).doc(active.reviewId))).data():null;
      if (active && (!activeRequest || !isSellerActivityReview(activeRequest) || activeRequest.ownerId!==current.ownerId))
        throw new HttpsError('failed-precondition','Le dossier courant nécessite un rapprochement.');
      if (activeRequest && activeRequest.status!=='approved') {await adminSession(tx,request);return refuse('review_already_open');}
      if (command.criteriaCodes.includes('declaration_consistency') && !current.evidence.profile?.activityDeclaration)
        return refuse('criterion_source_unknown');
      const noticeInput=sellerActivityReviewNotice(current.ownerId,reviewId,'opened');
      const notices=await prepareOperationalNotices(tx,[noticeInput]);
      await adminSession(tx,request);
      const origin={protocol:SELLER_ACTIVITY_REVIEW_CAPABILITY,openedBy:uid,sourceHash:current.sourceHash,
        criteriaVersion:command.criteriaVersion,criteriaCodes:command.criteriaCodes,signalIds:[signalId],reviewedSource:current.reviewedSource};
      const record={ownerId:current.ownerId,kind:'review',scope:'sell',status:'submitted',version:1,reason:command.ownerReason,
        proposedDateOfBirth:null,originalDateOfBirth:null,originalDateOfBirthCopy:null,nativeSourceDocumentVersion:null,
        priorReviewId:null,policyVersion:ELIGIBILITY_POLICY_VERSION,createdAt:now,updatedAt:now,receivedAtMs:now.toMillis(),
        receivedCivilDate:quebecCivilDate(now.toDate()),statutoryDueDate:null,submittedAtMs:now.toMillis(),
        statutoryResponseDays:null,deadlineCalendarPolicy:null,ownerDecisionReason:null,internalNote:command.internalNote,
        latestOwnerDetails:null,sellerActivityReview:origin};
      const next={...profile,version:(Number.isSafeInteger(profile.version)?profile.version:0)+1,policyVersion:ELIGIBILITY_POLICY_VERSION,
        updatedAt:now,sellerActivityReview:{protocol:SELLER_ACTIVITY_REVIEW_CAPABILITY,reviewId,sourceHash:current.sourceHash},
        activeReviews:{...(profile.activeReviews??{}),[reviewId]:{scope:'sell',active:true}},
        signals:{...(profile.signals??{}),[signalId]:{scope:'sell',active:true,internalNote:command.internalNote,
          actorUid:uid,recordedAt:now,reviewId,sourceHash:current.sourceHash}}};
      tx.create(reviewRef,record);tx.set(db.collection(C.profiles).doc(current.ownerId),next);
      tx.create(opRef,{protocol:SELLER_ACTIVITY_REVIEW_CAPABILITY,action:'seller_activity_review_open',actorUid:uid,ownerId:current.ownerId,
        requestId,inputHash:payloadHash,command,state:'committed',reason:null,createdAt:now,reviewId,signalId,ownerNotice:noticeInput});
      notices.commit();
      // The notice plan writes its native receipt atomically with the case.
      return {protocol:SELLER_ACTIVITY_REVIEW_CAPABILITY,actorId:uid,requestId,payloadHash,state:'committed',committed:true,replay:false,
        reviewId,signalId,reason:null,recordedAt:now.toDate().toISOString(),notice:{notificationId:notices.notificationIds[0],
          inAppCommitted:true,deviceDeliveryVerified:false,readingVerified:false},...noInference};
    });
    if (result.state==='unrecorded') return result;
    // Read the actual immutable notice receipt after the atomic commit, rather
    // than manufacturing its timestamp or returning a provisional notice DTO.
    return db.runTransaction(async tx=>{
      await assertPrivateAccountSession(request,tx);
      const recorded=(await tx.get(opRef)).data();
      if (!recorded) throw new HttpsError('unavailable','Relisez le reçu de cette même commande.');
      return receiptView(tx,recorded,uid,requestId,payloadHash,result.replay);
    });
  });
}
