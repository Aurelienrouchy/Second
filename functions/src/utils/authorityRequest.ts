/** Private documentary handling. A recorded examination is never a legal power,
 * permission to disclose, proof of external receipt, or an actual disclosure. */
import {Timestamp} from 'firebase-admin/firestore';
import {HttpsError} from 'firebase-functions/v2/https';
import {db} from '../config/firebase';
import {supportUid, supportObject, supportText, supportId, supportAccountUid, isSupportAccountUid, supportRequestId, supportHash,
  supportSourceHash, supportRevision, supportCurrentAdminSession} from './supportRequest';
import {assertRecentAccountAuthentication, assertAccountSecurityOpen} from './eligibility';
import {checkRateLimit} from './rateLimit';
import {SUPPORT_LEGAL_REVIEW_CAPABILITY, legalReviewEnvelope, legalReviewEarlyReceipt, commitLegalReviewReceipt,
  assertLegalReviewAdmin, type LegalReviewEnvelope, type LegalReviewReference} from './supportLegalReviewV2';
import {privateSupportEvidenceRef, savePrivateSupportCaseJpeg, readPrivateSupportCaseJpeg,
  type PrivateSupportEvidence, type PrivateSupportEvidenceRef} from './privateSupportCaseEvidence';
import {assertStoredAccountSecuritySession} from './storedAccountSecuritySession';
import {preparePrivacyPreservationCatalogueChange} from './privacyPreservationCatalogue';

export const AUTHORITY_REQUEST_CAPABILITY = 'authority_request_review_v1';
export const AUTHORITY_REQUEST_KIND = 'authority_request_private';
export const AUTHORITY_PACKAGE_FIELDS = ['transactionId', 'createdAt', 'status', 'deliveryType', 'buyerId', 'sellerId', 'articleTitle', 'amounts'] as const;
type Field = typeof AUTHORITY_PACKAGE_FIELDS[number];
type Source = {version:number;sourceHash:string};
type Evidence = {reference:string;description:string};
type Examination = {state:'unknown'|'declared_reviewed';reason:string;evidenceReferences:string[]};
type Review = {identity:Examination;power:Examination;legalBasis:Examination;delegation:Examination};
type Selection = {transactionIds:string[];fields:Field[];period:{from:string;to:string}|null};
type Reception = {requester:{name:string;organization:string;contact:string;capacity:string};externalReference:string;
  externallyReceivedAt:string|null;summary:string;evidenceReferences:Evidence[]};
type Command = {action:'receive';reception:Reception} | {action:'record_review'|'request_details'|'refuse'|'record_scope'|'prepare_package';
  caseId:string;source:Source;reason:string;review?:Review;evidenceReferences?:Evidence[];selection?:Selection;previewHash?:string};
type Descriptor = {caseId:string;action:Command['action'];payloadHash:string};
const effects = {privateDocumentaryOnly:true, legalAuthorityVerified:false, disclosureAuthorized:false,
  externalCommunicationPerformed:false, recipientReceiptVerified:false, targetNotified:false,
  sourcePreservationPerformed:false, financialEffect:'none'} as const;
const C = 'support_requests';
const HASH = /^[a-f0-9]{64}$/;
const caseIdPattern = /^authority_[a-f0-9]{64}$/;
const stages = ['received', 'review_recorded', 'details_requested', 'refused', 'scope_recorded', 'package_prepared'];
const nativeStamp = (v:any):v is Timestamp => v instanceof Timestamp && v.toMillis()>0 && v.toMillis()<=Date.now();
const bounded = (v:unknown, max:number) => {
  if(Buffer.byteLength(JSON.stringify(v),'utf8')>max)throw new HttpsError('invalid-argument','Le dossier documentaire dépasse la taille admise.');
};
const caseRef = (id:string) => db.collection(C).doc(id);
const receiptRef = (id:string, uid:string, rid:string) => caseRef(id).collection('commands').doc('authority_cmd_'+supportHash([uid,rid]));
export const isAuthorityRequest = (value:any):boolean => value?.kind === AUTHORITY_REQUEST_KIND;
/** Use on every legacy reader/mutator, before projecting or recording it. */
export function assertNotAuthorityRequest(value:any):void {
  if(isAuthorityRequest(value))throw new HttpsError('permission-denied','Ce dossier relève du parcours administratif privé.');
}
const text = (v:unknown, name:string, max=2000) => supportText(v,name,max);
function iso(value:unknown, label:string):string {
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString()!==value)
    throw new HttpsError('invalid-argument',`${label} : date ISO exacte requise.`);
  return value;
}
function exactCaseId(value:unknown):string {
  if(typeof value!=='string'||!caseIdPattern.test(value))throw new HttpsError('invalid-argument','Dossier privé exact requis.');return value;
}
function sourceInput(raw:unknown):Source {
  const s=supportObject(raw,['version','sourceHash']);
  if(!Number.isSafeInteger(s.version)||s.version<1||!HASH.test(s.sourceHash??''))throw new HttpsError('invalid-argument','Version et empreinte actuelles requises.');
  return {version:s.version,sourceHash:s.sourceHash};
}
function evidenceInput(raw:unknown):Evidence[] {
  if(!Array.isArray(raw)||raw.length>10)throw new HttpsError('invalid-argument','Dix références documentaires au maximum.');
  const values=raw.map(v=>{const e=supportObject(v,['reference','description']);return {reference:text(e.reference,'Référence externe déclarée',300),description:text(e.description,'Description de la référence',1000)};});
  if(new Set(values.map(v=>v.reference)).size!==values.length)throw new HttpsError('invalid-argument','Références distinctes requises.');return values;
}
function receptionInput(raw:unknown):Reception {
  const r=supportObject(raw,['requester','externalReference','externallyReceivedAt','summary','evidenceReferences']);
  const q=supportObject(r.requester,['name','organization','contact','capacity']);
  const externallyReceivedAt=r.externallyReceivedAt===null?null:iso(r.externallyReceivedAt,'Réception externe déclarée');
  if(externallyReceivedAt!==null&&Date.parse(externallyReceivedAt)>Date.now())throw new HttpsError('invalid-argument','La réception déclarée ne peut être future.');
  return {requester:{name:text(q.name,'Nom déclaré',300),organization:text(q.organization,'Organisation déclarée',300),
    contact:text(q.contact,'Coordonnées déclarées',500),capacity:text(q.capacity,'Qualité déclarée',1000)},
    externalReference:text(r.externalReference,'Référence externe',300),externallyReceivedAt,summary:text(r.summary,'Objet de la demande',4000),evidenceReferences:evidenceInput(r.evidenceReferences)};
}
function reviewInput(raw:unknown):Review {
  const r=supportObject(raw,['identity','power','legalBasis','delegation']);
  const item=(value:unknown):Examination=>{const e=supportObject(value,['state','reason','evidenceReferences']);
    if(!['unknown','declared_reviewed'].includes(e.state)||!Array.isArray(e.evidenceReferences)||e.evidenceReferences.length>10)
      throw new HttpsError('invalid-argument','Qualification de chaque examen requise.');
    const refs=e.evidenceReferences.map((v:unknown)=>text(v,'Référence examinée',300));
    if(new Set(refs).size!==refs.length||e.state==='declared_reviewed'&&!refs.length)throw new HttpsError('invalid-argument','Un examen déclaré nécessite sa référence documentaire.');
    return {state:e.state,reason:text(e.reason,'Motivation de cet examen',2000),evidenceReferences:refs};};
  return {identity:item(r.identity),power:item(r.power),legalBasis:item(r.legalBasis),delegation:item(r.delegation)};
}
function selectionInput(raw:unknown):Selection {
  const s=supportObject(raw,['transactionIds','fields','period']);
  if(!Array.isArray(s.transactionIds)||!s.transactionIds.length||s.transactionIds.length>10||!Array.isArray(s.fields)||!s.fields.length||s.fields.length>AUTHORITY_PACKAGE_FIELDS.length)
    throw new HttpsError('invalid-argument','Une à dix transactions et des champs explicites requis.');
  const ids=s.transactionIds.map((v:unknown)=>supportId(v));
  if(new Set(ids).size!==ids.length||new Set(s.fields).size!==s.fields.length||s.fields.some((f:unknown)=>!(AUTHORITY_PACKAGE_FIELDS as readonly unknown[]).includes(f)))
    throw new HttpsError('invalid-argument','Transactions distinctes et champs admis requis.');
  let period:Selection['period']=null;
  if(s.period!==null){const p=supportObject(s.period,['from','to']);period={from:iso(p.from,'Début'),to:iso(p.to,'Fin')};if(period.from>period.to)throw new HttpsError('invalid-argument','Période incohérente.');}
  return {transactionIds:ids.slice().sort(),fields:s.fields.slice().sort() as Field[],period};
}
function commandInput(raw:unknown):Command {
  const c=supportObject(raw,['action','reception','caseId','source','reason','review','evidenceReferences','selection','previewHash']);
  if(c.action==='receive'){
    if(Object.keys(c).some(k=>!['action','reception'].includes(k)))throw new HttpsError('invalid-argument','Une réception initiale ne reprend aucun autre dossier.');
    return {action:'receive',reception:receptionInput(c.reception)};
  }
  if(!['record_review','request_details','refuse','record_scope','prepare_package'].includes(c.action)||c.reception!==undefined||
    (c.review!==undefined)!==(c.action==='record_review')||c.evidenceReferences!==undefined&&c.action!=='record_review'||(c.selection!==undefined)!==(c.action==='record_scope')||
    (c.previewHash!==undefined)!==(c.action==='prepare_package'))throw new HttpsError('invalid-argument','Commande privée et champs cohérents requis.');
  const base={action:c.action,caseId:exactCaseId(c.caseId),source:sourceInput(c.source),reason:text(c.reason,'Motivation privée',4000)};
  if(c.action==='record_review')return {...base,review:reviewInput(c.review),...(c.evidenceReferences===undefined?{}:{evidenceReferences:evidenceInput(c.evidenceReferences)})};
  if(c.action==='record_scope')return {...base,selection:selectionInput(c.selection)};
  if(c.action==='prepare_package'&&!HASH.test(c.previewHash??''))throw new HttpsError('invalid-argument','Aperçu natif exact requis.');
  return {...base,...(c.action==='prepare_package'?{previewHash:c.previewHash}:{})};
}
function descriptorInput(raw:unknown):Descriptor {
  const d=supportObject(raw,['caseId','action','payloadHash']);
  if(!['receive','record_review','request_details','refuse','record_scope','prepare_package'].includes(d.action)||!HASH.test(d.payloadHash??''))
    throw new HttpsError('invalid-argument','Descripteur exact de la commande requis.');
  return {caseId:exactCaseId(d.caseId),action:d.action,payloadHash:d.payloadHash};
}
async function currentAdmin(tx:FirebaseFirestore.Transaction,request:any):Promise<void> {
  await supportCurrentAdminSession(request);
  const uid=request.auth.uid, user=(await tx.get(db.collection('users').doc(uid))).data();
  if(!user||user.isAdmin!==true||Object.prototype.hasOwnProperty.call(user,'isActive')&&user.isActive!==true||request.auth.token.auth_time*1000>Date.now())
    throw new HttpsError('permission-denied','Rôle administratif privé actuel requis.');
  assertRecentAccountAuthentication(request.auth.token);
  await assertAccountSecurityOpen((await tx.get(db.collection('eligibility_profiles').doc(uid))).data(), tx, uid);
}
function qualifiedCase(snapshot:FirebaseFirestore.DocumentSnapshot):any|null {
  const d=snapshot.data();
  return d?.protocol==='authority_request_private_v1'&&isAuthorityRequest(d)&&d.ownerId===null&&caseIdPattern.test(snapshot.id)&&
    d.id===snapshot.id&&Number.isSafeInteger(d.version)&&d.version>0&&typeof d.initiatedByAdminId==='string'&&
    nativeStamp(d.recordedAt)&&nativeStamp(d.updatedAt)&&Number.isSafeInteger(d.receivedAtMs)&&d.receivedAtMs===d.recordedAt.toMillis()&&
    Object.entries(effects).every(([k,v])=>d[k]===v)?d:null;
}
function caseSource(snapshot:FirebaseFirestore.DocumentSnapshot):Source {
  const d=qualifiedCase(snapshot);if(!d)throw new HttpsError('failed-precondition','Source du dossier privé inconnue.');
  return {version:d.version,sourceHash:supportSourceHash({revision:supportRevision(snapshot),data:d})};
}
function caseView(snapshot:FirebaseFirestore.DocumentSnapshot) {
  const d=qualifiedCase(snapshot);if(!d)return null;
  let reception:Reception,review:Review|null=null,selection:Selection|null=null;
  try{reception=receptionInput(d.reception);if(d.review!==null)review=reviewInput(d.review);if(d.selection!==null)selection=selectionInput(d.selection);}catch{return null;}
  return {protocol:'authority_request_case_v1',id:snapshot.id,source:caseSource(snapshot),stage:stages.includes(d.stage)?d.stage:'unknown',
    initiatedByAdminId:d.initiatedByAdminId,receivedAt:d.recordedAt.toDate().toISOString(),updatedAt:d.updatedAt.toDate().toISOString(),
    reception,requesterVerified:false,externalEvidenceOriginalsStored:false,review,selection,privateReason:typeof d.privateReason==='string'?d.privateReason:null,
    preservation:{state:'documentary_request_only',scope:selection,sourcePreservationPerformed:false},
    latestPackage:d.latestPackage??null,...effects};
}
/** Exact native documentary source; no legal authority or release is inferred. */
export function authorityPreservationSourceQualified(snapshot: FirebaseFirestore.DocumentSnapshot): boolean {
  return qualifiedCase(snapshot) !== null && caseView(snapshot) !== null;
}
function receiptView(raw:any,replay:boolean) {
  return {protocol:'authority_request_command_v1',actorId:raw.actorId,requestId:raw.requestId,caseId:raw.caseId,action:raw.action,
    payloadHash:raw.payloadHash,state:raw.state,committed:raw.state==='committed',replay,resultVersion:raw.resultVersion??null,
    reason:raw.reason??null,recordedAt:nativeStamp(raw.recordedAt)?raw.recordedAt.toDate().toISOString():null,
    packageReference:raw.packageReference??null,...effects};
}
function receiptQualified(raw:any,id:string,uid:string,rid:string,hash:string,action:string):void {
  descriptorInput({caseId:id,action,payloadHash:hash});supportRequestId(rid);supportAccountUid(uid);
  if(raw.protocol!=='authority_request_command_v1'||raw.actorId!==uid||raw.requestId!==rid||raw.caseId!==id||raw.payloadHash!==hash||raw.action!==action||
    raw.command!==null&&supportHash(raw.command)!==hash)
    throw new HttpsError('already-exists','Cet identifiant correspond à une autre commande.');
  if(!['committed','not_executed'].includes(raw.state)||!nativeStamp(raw.recordedAt)||raw.command!==null&&raw.action!==raw.command.action||
    raw.state==='committed'&&(!raw.command||!Number.isSafeInteger(raw.resultVersion)||raw.resultVersion<1)||Object.entries(effects).some(([k,v])=>raw[k]!==v))
    throw new HttpsError('failed-precondition','Reçu historique non qualifié.');
  if(raw.command!==null)commandInput(raw.command);
}
function selectedValue(field:Field,id:string,d:any):{qualification:'native'|'unknown';value:any} {
  const nativeText=(v:unknown,max:number):v is string=>typeof v==='string'&&!!v.trim()&&v===v.trim()&&v.length<=max;
  let value:any=null;
  if(field==='transactionId')value=id;
  else if(field==='createdAt')value=nativeStamp(d.createdAt)?d.createdAt.toDate().toISOString():null;
  else if(field==='status')value=nativeText(d.status,100)?d.status:null;
  else if(field==='deliveryType')value=['meetup','shipping'].includes(d.deliveryType)?d.deliveryType:null;
  else if(field==='buyerId'||field==='sellerId')value=isSupportAccountUid(d[field])?d[field]:null;
  else if(field==='articleTitle')value=nativeText(d.articleSnapshot?.title,300)?d.articleSnapshot.title:null;
  else if(field==='amounts'){
    const numeric=(v:any)=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=1_000_000?v:null;
    value={unit:'dollars',currency:d.currency==='CAD'?'CAD':null,amount:numeric(d.amount),shippingCost:numeric(d.shippingCost),
      serviceFee:numeric(d.serviceFee),totalAmount:numeric(d.totalAmount),providerSettlementVerified:false};
    if(value.currency===null||[value.amount,value.shippingCost,value.serviceFee,value.totalAmount].some(v=>v===null))return {qualification:'unknown',value};
  }
  return {qualification:value===null?'unknown':'native',value};
}
async function packagePreview(tx:FirebaseFirestore.Transaction,snapshot:FirebaseFirestore.DocumentSnapshot) {
  const d=qualifiedCase(snapshot),view=caseView(snapshot);
  if(!d||!view||!view.selection||!['scope_recorded','package_prepared'].includes(d.stage)||!view.review||Object.values(view.review).some(e=>e.state!=='declared_reviewed'))
    throw new HttpsError('failed-precondition','Les quatre examens et la portée motivée doivent être enregistrés avant la préparation.');
  const selection=view.selection,items=[];
  for(const id of selection.transactionIds){
    const source=await tx.get(db.collection('transactions').doc(id)),data=source.data(),createdAt=data?.createdAt;
    const periodState=!data?'missing_source':!selection.period?'not_filtered':!nativeStamp(createdAt)?'unknown_date':
      createdAt.toDate().toISOString()<selection.period.from||createdAt.toDate().toISOString()>selection.period.to?'outside_period':'within_period';
    const included=!!data&&['not_filtered','within_period'].includes(periodState);
    items.push({transactionId:id,sourceRevision:supportRevision(source),sourceHash:supportSourceHash(data??null),periodState,
      fields:included?Object.fromEntries(selection.fields.map(field=>[field,selectedValue(field,id,data)])):{},
      omittedFields:AUTHORITY_PACKAGE_FIELDS.filter(field=>!selection.fields.includes(field))});
  }
  const document={protocol:'authority_request_package_snapshot_v1',caseId:snapshot.id,caseSource:view.source,selection,items,
    excludedCategories:['addresses','member_contacts','identity_documents','bank_details','payment_provider_identifiers','messages','support_correspondence','confidential_evidence'],
    periodBasis:'native_transaction_createdAt_only',missingValuesRemainUnknown:true,...effects};
  bounded(document,120_000);
  return {protocol:'authority_request_package_preview_v1',caseSource:view.source,sourceHash:supportSourceHash(document),snapshot:document,...effects};
}

/** Dispatch ONLY from the existing admin callable. Old servers reject this
 * isolated envelope: no legacy supportRequestId or support action is supplied. */
export async function handleAuthorityRequestCommand(request:any) {
  const uid=supportUid(request),data=supportObject(request.data,['expectedUid','capability','requestId','mode','descriptor','command']);
  if(data.capability!==AUTHORITY_REQUEST_CAPABILITY||!['execute','observe','neutralize'].includes(data.mode))throw new HttpsError('invalid-argument','Protocole privé requis.');
  const rid=supportRequestId(data.requestId),descriptor=descriptorInput(data.descriptor),hash=descriptor.payloadHash;
  if(data.mode!=='execute'&&data.command!==undefined)throw new HttpsError('invalid-argument','Une reprise utilise seulement le descripteur sans renseignements privés.');
  const command:Command|null=data.mode==='execute'?commandInput(data.command):null;
  if(command){bounded(data.command,40_000);if(command.action!==descriptor.action||supportHash(data.command)!==hash||
    descriptor.caseId!==(command.action==='receive'?'authority_'+supportHash([uid,rid]):command.caseId))throw new HttpsError('invalid-argument','Le corps exact ne correspond pas au descripteur.');}
  if(descriptor.action==='receive'&&descriptor.caseId!=='authority_'+supportHash([uid,rid]))throw new HttpsError('invalid-argument','Le dossier initial ne correspond pas à cette réception.');
  const id=descriptor.caseId;
  const ref=caseRef(id),opRef=receiptRef(id,uid,rid);
  if(data.mode!=='observe'&&!(await opRef.get()).exists)await checkRateLimit(uid,true,{functionName:'administerSupportRequest',maxCallsAuthenticated:30,maxCallsUnauthenticated:0,windowMs:60_000});
  return db.runTransaction(async tx=>{
    const prior=(await tx.get(opRef)).data();
    if(prior){receiptQualified(prior,id,uid,rid,hash,descriptor.action);return receiptView(prior,true);}
    const now=Timestamp.now();
    const receipt=(state:'committed'|'not_executed',version:number|null,reason:string|null,packageReference:any=null)=>{
      const result={protocol:'authority_request_command_v1',actorId:uid,requestId:rid,caseId:id,action:descriptor.action,payloadHash:hash,
        command:data.mode==='execute'?data.command:null,state,resultVersion:version,reason,packageReference,recordedAt:now,...effects};
      tx.create(opRef,result);return receiptView(result,false);
    };
    if(data.mode==='observe')return {protocol:'authority_request_command_v1',actorId:uid,requestId:rid,caseId:id,action:descriptor.action,payloadHash:hash,
      state:'unrecorded',committed:false,replay:false,resultVersion:null,recordedAt:null,reason:null,packageReference:null,...effects};
    if(data.mode==='neutralize')return receipt('not_executed',null,'command_neutralized');
    if(!command)throw new HttpsError('invalid-argument','Corps exact de la nouvelle instruction requis.');
    await currentAdmin(tx,request); // Fresh Auth, private role, cutoff and barrier on EVERY retry.
    const snapshot=await tx.get(ref),current=qualifiedCase(snapshot);
    const catalogue = await preparePrivacyPreservationCatalogueChange(tx, {caseId: id, actorId: uid, requestId: rid, kind: AUTHORITY_REQUEST_KIND});
    if(command.action==='receive'){
      if(snapshot.exists)return receipt('not_executed',null,'source_unknown');
      const record={protocol:'authority_request_private_v1',schemaVersion:1,id,kind:AUTHORITY_REQUEST_KIND,ownerId:null,
        initiatedByAdminId:uid,version:1,stage:'received',reception:command.reception,review:null,selection:null,privateReason:null,latestPackage:null,
        receivedAtMs:now.toMillis(),recordedAt:now,updatedAt:now,...effects};
      bounded(record,80_000);catalogue.commit();tx.create(ref,record);return receipt('committed',1,null);
    }
    if(!current||!caseView(snapshot)||!stages.includes(current.stage))return receipt('not_executed',null,'source_unknown');
    if(supportHash(caseSource(snapshot))!==supportHash(command.source))return receipt('not_executed',null,'source_changed');
    if(current.version>=Number.MAX_SAFE_INTEGER)return receipt('not_executed',null,'version_exhausted');
    const version=current.version+1,patch:any={version,updatedAt:now,privateReason:command.reason};
    let packageReference:any=null,prepared:any=null;
    if(command.action==='record_review'){
      const allReferences=[...current.reception.evidenceReferences,...(command.evidenceReferences??[])];
      if(allReferences.length>10||new Set(allReferences.map((e:Evidence)=>e.reference)).size!==allReferences.length)return receipt('not_executed',null,'evidence_reference_conflict_or_limit');
      const known=new Set(allReferences.map((e:Evidence)=>e.reference));
      if(Object.values(command.review!).some(e=>e.evidenceReferences.some(reference=>!known.has(reference))))return receipt('not_executed',null,'evidence_reference_not_declared');
      patch.reception={...current.reception,evidenceReferences:allReferences};
      patch.review=command.review;patch.stage='review_recorded';patch.selection=null;patch.latestPackage=null;
    }else if(command.action==='request_details'){patch.stage='details_requested';patch.selection=null;patch.latestPackage=null;}
    else if(command.action==='refuse'){patch.stage='refused';patch.selection=null;patch.latestPackage=null;}
    else if(command.action==='record_scope'){
      if(!current.review||Object.values(current.review as Review).some(e=>e.state!=='declared_reviewed'))return receipt('not_executed',null,'examinations_unknown');
      if(['details_requested','refused'].includes(current.stage))return receipt('not_executed',null,'new_review_required');
      patch.selection=command.selection;patch.stage='scope_recorded';patch.latestPackage=null;
    }else{
      const preview=await packagePreview(tx,snapshot);
      if(preview.sourceHash!==command.previewHash)return receipt('not_executed',null,'package_source_changed');
      const packageId='authority_package_'+supportHash([uid,rid]),document={...preview.snapshot,preparedBy:uid,preparedAt:now,
        decision:{action:command.action,reason:command.reason,source:command.source,requestId:rid,resultVersion:version}};
      bounded(document,150_000);
      packageReference={id:packageId,contentHash:supportSourceHash(document),version,sourceHash:preview.sourceHash};
      prepared={protocol:'authority_request_package_v1',caseId:id,reference:packageReference,document,...effects};
      patch.stage='package_prepared';patch.latestPackage=packageReference;
    }
    bounded({...current,...patch},80_000);
    catalogue.commit();tx.update(ref,patch);
    if(prepared)tx.create(ref.collection('commands').doc(packageReference.id),prepared);
    return receipt('committed',version,null,packageReference);
  });
}

/** GET-only dispatch from readSupportRequests. Never call a mutator to preview. */
export async function readAuthorityRequests(request:any) {
  const uid=supportUid(request),data=supportObject(request.data,['expectedUid','capability','operation','caseId','cursor','eventsCursor','source','packageReference']);
  if(data.capability!==AUTHORITY_REQUEST_CAPABILITY||!['list','detail','preview_package','read_package'].includes(data.operation))throw new HttpsError('invalid-argument','Lecture privée explicite requise.');
  const id=data.operation==='list'?null:exactCaseId(data.caseId);
  if(data.operation==='list'&&(data.caseId!==undefined||data.source!==undefined)||data.operation!=='list'&&data.cursor!==undefined||data.operation!=='preview_package'&&data.source!==undefined||
    data.operation!=='detail'&&data.eventsCursor!==undefined||data.operation!=='read_package'&&data.packageReference!==undefined)
    throw new HttpsError('invalid-argument','Paramètres de lecture incompatibles.');
  const cursor=data.cursor===undefined?null:supportId(data.cursor),eventsCursor=data.eventsCursor===undefined?null:supportId(data.eventsCursor),expected=data.operation==='preview_package'?sourceInput(data.source):null;
  return db.runTransaction(async tx=>{
    await currentAdmin(tx,request);
    if(!id){
      let query=db.collection(C).orderBy('__name__','desc').limit(21);if(cursor)query=query.startAfter(cursor);
      const page=await tx.get(query),rows=page.docs.slice(0,20),hasMore=page.size>20;
      const items=rows.filter(doc=>isAuthorityRequest(doc.data())).map(caseView).filter(v=>v!==null);
      const last=rows.at(-1);
      return {protocol:'authority_request_list_v1',actorId:uid,items,hasMore,cursor:hasMore&&last?last.id:null,
        inspectedCount:rows.length,hiddenOrUnknownCount:rows.length-items.length,completeSelectedPage:true,completeHistory:!cursor&&!hasMore&&items.length===rows.length,...effects};
    }
    const snapshot=await tx.get(caseRef(id)),view=caseView(snapshot);
    if(!view)throw new HttpsError('failed-precondition','Dossier absent ou source historique inconnue.');
    if(data.operation==='preview_package'){
      if(supportHash(expected)!==supportHash(view.source))throw new HttpsError('failed-precondition','La source du dossier a changé.');
      return {protocol:'authority_request_preview_read_v1',actorId:uid,caseId:id,preview:await packagePreview(tx,snapshot),...effects};
    }
    if(data.operation==='read_package'){
      const reference=packageReferenceInput(data.packageReference),raw=await readPackage(tx,id,reference);
      return {protocol:'authority_request_package_read_v1',actorId:uid,caseId:id,package:raw,qualification:raw?'native_private_snapshot':'unknown',...effects};
    }
    let eventsQuery=caseRef(id).collection('commands').orderBy('__name__','desc').limit(11);if(eventsCursor)eventsQuery=eventsQuery.startAfter(eventsCursor);
    const entries=await tx.get(eventsQuery),inspected=entries.docs.slice(0,10),last=inspected.at(-1);
    const events=inspected.map(doc=>{
      if(doc.data().protocol==='authority_request_package_v1')return {id:doc.id,qualification:'package_reference_only',packageReference:doc.data().reference??null};
      const raw=doc.data();try{receiptQualified(raw,id,raw.actorId,raw.requestId,raw.payloadHash,raw.action);}catch{return {id:doc.id,qualification:'unknown'};}
      return {id:doc.id,qualification:'native',receipt:receiptView(raw,false),command:raw.command};
    });
    let latestPackage:any=null;
    const reference=view.latestPackage;
    if(reference&&typeof reference.id==='string'&&/^authority_package_[a-f0-9]{64}$/.test(reference.id)){
      latestPackage=await readPackage(tx,id,reference);
    }
    return {protocol:'authority_request_detail_v1',actorId:uid,case:view,events,earlierEventsExist:entries.size>10,eventsCursor:entries.size>10&&last?last.id:null,
      latestPackage,packageQualification:reference?(latestPackage?'native_private_snapshot':'unknown'):'not_prepared',...effects};
  });
}
function packageReferenceInput(value:unknown) {
  const r=supportObject(value,['id','contentHash','version','sourceHash']);
  if(typeof r.id!=='string'||!/^authority_package_[a-f0-9]{64}$/.test(r.id)||!HASH.test(r.contentHash??'')||!HASH.test(r.sourceHash??'')||!Number.isSafeInteger(r.version)||r.version<1)
    throw new HttpsError('invalid-argument','Référence exacte du paquet privé requise.');
  return {id:r.id,contentHash:r.contentHash,version:r.version,sourceHash:r.sourceHash};
}
async function readPackage(tx:FirebaseFirestore.Transaction,id:string,reference:any) {
  const raw=(await tx.get(caseRef(id).collection('commands').doc(reference.id))).data();
  if(raw?.protocol!=='authority_request_package_v1'||raw.caseId!==id||supportHash(raw.reference)!==supportHash(reference)||
    raw.document?.caseId!==id||supportSourceHash(raw.document)!==reference.contentHash||Object.entries(effects).some(([k,v])=>raw[k]!==v))return null;
  return raw;
}

const LEGAL_V2_ACTIONS = ['upload_evidence', 'read_evidence', 'authorize_package', 'read_authorized_package', 'attest_human_send', 'record_external_receipt'];
const LEGAL_EVIDENCE_PURPOSES = ['identity', 'power', 'legal_basis', 'delegation', 'human_send', 'external_receipt'];
type LegalProof = {readReference: LegalReviewReference; evidence: PrivateSupportEvidenceRef};
type LegalExamination = {state: 'supported'|'unknown'|'insufficient'; reason: string; proofReads: LegalProof[]};
type LegalExaminations = {identity: LegalExamination; power: LegalExamination; legalBasis: LegalExamination; delegation: LegalExamination};
const legalCollection = (id: string, name: string) => caseRef(id).collection(name);
function legalReference(value: unknown, prefix: string): LegalReviewReference {
  const item = supportObject(value, ['id', 'contentHash']);
  if (typeof item.id !== 'string' || !new RegExp('^' + prefix + '[a-f0-9]{64}$').test(item.id) || !HASH.test(item.contentHash ?? '')) {
    throw new HttpsError('invalid-argument', 'Référence documentaire V2 exacte requise.');
  }
  return {id: item.id, contentHash: item.contentHash};
}
function legalProof(value: unknown): LegalProof {
  const item = supportObject(value, ['readReference', 'evidence']);
  return {readReference: legalReference(item.readReference, 'authority_read_'), evidence: privateSupportEvidenceRef(item.evidence)};
}
function legalExaminations(value: unknown): LegalExaminations {
  const all = supportObject(value, ['identity', 'power', 'legalBasis', 'delegation']), result: Record<string, LegalExamination> = {};
  for (const key of ['identity', 'power', 'legalBasis', 'delegation']) {
    const item = supportObject(all[key], ['state', 'reason', 'proofReads']);
    if (!['supported', 'unknown', 'insufficient'].includes(item.state) || !Array.isArray(item.proofReads) || item.proofReads.length > 3 ||
        item.state === 'supported' && item.proofReads.length === 0) throw new HttpsError('invalid-argument', 'Chaque examen humain doit rester explicitement qualifié.');
    result[key] = {state: item.state, reason: text(item.reason, 'Motivation de l’examen', 2000), proofReads: item.proofReads.map(legalProof)};
  }
  return result as LegalExaminations;
}
async function legalCase(tx: FirebaseFirestore.Transaction, request: any, id: string, expected: unknown) {
  await assertLegalReviewAdmin(tx, request);
  const snapshot = await tx.get(caseRef(exactCaseId(id))), record = qualifiedCase(snapshot), view = caseView(snapshot);
  if (!record || !view) throw new HttpsError('failed-precondition', 'Le dossier documentaire natif doit être qualifié.');
  const source = caseSource(snapshot);
  if (expected !== undefined && supportHash(sourceInput(expected)) !== supportHash(source)) throw new HttpsError('aborted', 'La source du dossier a changé. Relisez-la.');
  return {snapshot, record, view, source};
}
async function currentLegalPackage(tx: FirebaseFirestore.Transaction, current: Awaited<ReturnType<typeof legalCase>>, rawReference: unknown) {
  const reference = packageReferenceInput(rawReference), id = current.snapshot.id, raw = await readPackage(tx, id, reference), d = raw?.document;
  if (!raw || current.record.stage !== 'package_prepared' || reference.version !== current.record.version ||
      supportHash(current.record.latestPackage) !== supportHash(reference) || !nativeStamp(d?.preparedAt) || !isSupportAccountUid(d?.preparedBy) ||
      d?.decision?.action !== 'prepare_package' || d.decision.resultVersion !== reference.version || d.decision.source?.version !== reference.version - 1 ||
      supportHash(d.decision.source) !== supportHash(d.caseSource)) throw new HttpsError('failed-precondition', 'Le paquet doit être le résultat causal actuellement sélectionné.');
  const snapshot = {...d}; delete snapshot.preparedBy; delete snapshot.preparedAt; delete snapshot.decision;
  if (supportSourceHash(snapshot) !== reference.sourceHash) throw new HttpsError('failed-precondition', 'L’aperçu d’origine du paquet doit être qualifié.');
  const original = (await tx.get(receiptRef(id, d.preparedBy, supportRequestId(d.decision.requestId)))).data();
  if (!original) throw new HttpsError('failed-precondition', 'Le reçu causal du paquet est absent.');
  receiptQualified(original, id, d.preparedBy, d.decision.requestId, supportHash(original.command), 'prepare_package');
  if (original.state !== 'committed' || supportHash(original.packageReference) !== supportHash(reference) ||
      original.command?.previewHash !== reference.sourceHash || original.command.caseId !== id ||
      supportHash(original.command.source) !== supportHash(d.decision.source) || original.command.reason !== d.decision.reason) {
    throw new HttpsError('failed-precondition', 'Le reçu causal du paquet est incohérent.');
  }
  const fresh = await packagePreview(tx, current.snapshot);
  if (supportHash(fresh.snapshot.selection) !== supportHash(d.selection) || supportHash(fresh.snapshot.items) !== supportHash(d.items)) {
    throw new HttpsError('aborted', 'La portée ou une source sélectionnée du paquet a changé.');
  }
  if (!Array.isArray(d.items) || !d.items.length || d.items.some((item: any) => !['not_filtered', 'within_period'].includes(item.periodState) ||
      d.selection.fields.some((field: string) => item.fields?.[field]?.qualification !== 'native'))) {
    throw new HttpsError('failed-precondition', 'Les champs et les sources sélectionnés doivent tous être qualifiés avant une autorisation technique.');
  }
  const payload = {protocol: 'authority_disclosure_payload_v2', caseId: id, packageReference: reference, selection: d.selection,
    items: d.items.map((item: any) => ({transactionId: item.transactionId, fields: item.fields})),
    excludedCategories: d.excludedCategories, legalAuthorityVerified: false};
  return {reference, payload, payloadContentHash: supportSourceHash(payload)};
}
async function authorityLegalProof(tx: FirebaseFirestore.Transaction, request: any, id: string, source: Source,
  selected: LegalProof, purpose: string) {
  const record = (await tx.get(legalCollection(id, 'legal_v2_evidence_reads').doc(selected.readReference.id))).data();
  const evidence = (await tx.get(legalCollection(id, 'review_evidence').doc(selected.evidence.evidenceId))).data();
  if (!record || record.protocol !== 'authority_evidence_read_v2' || record.actorId !== request.auth.uid || record.authTime !== request.auth.token.auth_time ||
      record.caseId !== id || !nativeStamp(record.recordedAt) || record.recordedAt.toMillis() < Date.now() - 30 * 60_000 ||
      supportSourceHash(record) !== selected.readReference.contentHash || supportHash(record.source) !== supportHash(source) || record.purpose !== purpose ||
      supportHash(record.evidence) !== supportHash(selected.evidence) || !evidence || evidence.supportRequestId !== id || evidence.purpose !== purpose || evidence.storageHold !== 'temporary_hold' ||
      supportHash(privateSupportEvidenceRef({evidenceId: evidence.evidenceId, generation: evidence.generation, sha256: evidence.sha256, sizeBytes: evidence.sizeBytes})) !== supportHash(selected.evidence)) {
    throw new HttpsError('failed-precondition', 'Relisez cette preuve native avec votre connexion administrative et la source courante.');
  }
  const receipt = (await tx.get(db.collection('support_legal_review_commands').doc(supportHash(['authority_request', record.actorId, record.requestId])))).data();
  if (!receipt || receipt.protocol !== 'support_legal_review_command_v2' || receipt.area !== 'authority_request' || receipt.state !== 'committed' ||
      receipt.actorId !== record.actorId || receipt.requestId !== record.requestId || receipt.reasonCode !== null || !nativeStamp(receipt.recordedAt) ||
      receipt.descriptor?.caseId !== id || receipt.descriptor?.action !== 'read_evidence' || receipt.descriptor?.payloadHash !== record.payloadHash ||
      supportHash(receipt.reference) !== supportHash(selected.readReference) || supportHash(receipt.evidence) !== supportHash(selected.evidence)) {
    throw new HttpsError('failed-precondition', 'Le reçu causal de lecture de la preuve doit être qualifié.');
  }
  await assertStoredAccountSecuritySession(tx, request.auth.uid, record.authTime);
  return {file: evidence as PrivateSupportEvidence, capture: {readReference: selected.readReference, evidence: selected.evidence,
    evidenceSourceHash: supportSourceHash(evidence), purpose}};
}
async function authorityLegalReviewProofs(tx: FirebaseFirestore.Transaction, request: any, id: string, source: Source, review: LegalExaminations) {
  const captures = [], files = new Map<string, PrivateSupportEvidence>();
  for (const [key, item] of Object.entries(review)) {
    const purpose = key === 'legalBasis' ? 'legal_basis' : key;
    for (const selected of item.proofReads) {
      const proof = await authorityLegalProof(tx, request, id, source, selected, purpose);
      captures.push(proof.capture); files.set(proof.file.evidenceId, proof.file);
    }
  }
  if (files.size > 10) throw new HttpsError('invalid-argument', 'Dix preuves natives maximum pour cette décision.');
  return {captures, files: [...files.values()]};
}
async function currentLegalAuthorization(tx: FirebaseFirestore.Transaction, request: any, current: Awaited<ReturnType<typeof legalCase>>,
  packageValue: unknown, authorizationValue: unknown) {
  const pack = await currentLegalPackage(tx, current, packageValue), reference = legalReference(authorizationValue, 'authority_auth_');
  const authorization = (await tx.get(legalCollection(current.snapshot.id, 'legal_v2_authorizations').doc(reference.id))).data();
  if (!authorization || authorization.protocol !== 'authority_package_authorization_v2' || supportSourceHash(authorization) !== reference.contentHash ||
      authorization.caseId !== current.snapshot.id || authorization.actorId !== request.auth.uid || authorization.authTime !== request.auth.token.auth_time ||
      !nativeStamp(authorization.recordedAt) || supportHash(authorization.source) !== supportHash(current.source) ||
      supportHash(authorization.packageReference) !== supportHash(pack.reference) || authorization.payloadContentHash !== pack.payloadContentHash ||
      authorization.legalAuthorityVerified !== false || authorization.authorizationScope !== 'exact_current_package_only') {
    throw new HttpsError('failed-precondition', 'Une autorisation technique exacte doit être examinée avec cette connexion administrative.');
  }
  const review = legalExaminations(authorization.review);
  if (Object.values(review).some(item => item.state !== 'supported')) throw new HttpsError('failed-precondition', 'Un des examens reste inconnu.');
  const proofs = await authorityLegalReviewProofs(tx, request, current.snapshot.id, current.source, review);
  if (supportHash(proofs.captures) !== supportHash(authorization.proofs)) throw new HttpsError('aborted', 'Les preuves liées à l’autorisation ont changé.');
  return {pack, authorization, reference, proofs};
}

async function prepareLegalAuthorityCommand(tx: FirebaseFirestore.Transaction, request: any, env: LegalReviewEnvelope): Promise<any> {
  const early = await legalReviewEarlyReceipt(tx, request, env);
  if (early) return {terminal: early};
  const keys: Record<string, string[]> = {
    upload_evidence: ['purpose', 'jpegBase64'], read_evidence: ['evidence'],
    authorize_package: ['packageReference', 'review', 'reason'], read_authorized_package: ['packageReference', 'authorizationReference'],
    attest_human_send: ['packageReference', 'authorizationReference', 'recipient', 'channel', 'sentAt', 'externalReference', 'proofRead', 'reason'],
    record_external_receipt: ['sendReference', 'receivedAt', 'externalReference', 'proofRead', 'reason'],
  };
  const command = supportObject(env.command, ['action', 'caseId', 'source', ...keys[env.descriptor.action]]);
  if (command.caseId !== env.descriptor.caseId) throw new HttpsError('invalid-argument', 'Le dossier exact diffère de cette instruction.');
  if (command.action !== 'upload_evidence') bounded(command, 40_000);
  const current = await legalCase(tx, request, env.descriptor.caseId, command.source), id = current.snapshot.id;
  const catalogue = await preparePrivacyPreservationCatalogueChange(tx, {caseId: id, actorId: env.uid,
    requestId: env.requestId, kind: 'authority_request_v2:' + command.action});
  const base = {current, source: current.source, command, catalogue};
  if (command.action === 'upload_evidence') {
    if (!LEGAL_EVIDENCE_PURPOSES.includes(command.purpose) || typeof command.jpegBase64 !== 'string') throw new HttpsError('invalid-argument', 'Portée et JPEG privé requis.');
    const evidenceId = 'spe_' + supportHash([id, env.uid, env.requestId]);
    if ((await tx.get(legalCollection(id, 'review_evidence').doc(evidenceId))).exists) {
      throw new HttpsError('failed-precondition', 'L’attachement sans son reçu doit être rapproché ; il n’est pas adopté automatiquement.');
    }
    return {...base, kind: 'upload', files: [], identity: supportHash({source: current.source, purpose: command.purpose})};
  }
  if (command.action === 'read_evidence') {
    const selected = privateSupportEvidenceRef(command.evidence), evidence = (await tx.get(legalCollection(id, 'review_evidence').doc(selected.evidenceId))).data();
    if (!evidence || evidence.protocol !== 'private_support_evidence_v1' || evidence.storageHold !== 'temporary_hold' || evidence.supportRequestId !== id || !LEGAL_EVIDENCE_PURPOSES.includes(evidence.purpose) ||
        supportHash(privateSupportEvidenceRef({evidenceId: evidence.evidenceId, generation: evidence.generation, sha256: evidence.sha256, sizeBytes: evidence.sizeBytes})) !== supportHash(selected)) {
      throw new HttpsError('failed-precondition', 'La pièce privée exacte doit être qualifiée.');
    }
    return {...base, kind: 'read_evidence', evidence, files: [evidence as PrivateSupportEvidence],
      identity: supportHash({source: current.source, evidenceSource: supportSourceHash(evidence)})};
  }
  if (command.action === 'authorize_package') {
    const review = legalExaminations(command.review), reason = text(command.reason, 'Motivation de l’autorisation technique', 4000);
    if (Object.values(review).some(item => item.state !== 'supported')) return {terminal: commitLegalReviewReceipt(tx, env, null, null, 'examinations_unknown')};
    const pack = await currentLegalPackage(tx, current, command.packageReference), proofs = await authorityLegalReviewProofs(tx, request, id, current.source, review);
    return {...base, kind: 'authorize', review, reason, pack, proofs, files: proofs.files,
      identity: supportHash({source: current.source, packageReference: pack.reference, payloadContentHash: pack.payloadContentHash, proofs: proofs.captures})};
  }
  if (command.action === 'record_external_receipt') {
    const selectedSend = legalReference(command.sendReference, 'authority_event_');
    const send = (await tx.get(legalCollection(id, 'legal_v2_events').doc(selectedSend.id))).data();
    const receivedAt = iso(command.receivedAt, 'Accusé externe déclaré'), reason = text(command.reason, 'Motivation du rapprochement', 4000);
    if (!send || send.protocol !== 'authority_human_send_attestation_v2' || send.caseId !== id || supportSourceHash(send) !== selectedSend.contentHash ||
        !nativeStamp(send.recordedAt) || !Number.isFinite(Date.parse(send.sentAt)) || Date.parse(receivedAt) < Date.parse(send.sentAt) || Date.parse(receivedAt) > Date.now()) {
      throw new HttpsError('failed-precondition', 'Un envoi humain causal et une date d’accusé cohérente sont requis.');
    }
    const proof = await authorityLegalProof(tx, request, id, current.source, legalProof(command.proofRead), 'external_receipt');
    return {...base, kind: 'external_receipt', selectedSend, send, receivedAt, reason, proof, files: [proof.file],
      externalReference: text(command.externalReference, 'Référence externe de l’accusé', 300),
      identity: supportHash({source: current.source, selectedSend, proof: proof.capture})};
  }
  const authorized = await currentLegalAuthorization(tx, request, current, command.packageReference, command.authorizationReference);
  if (command.action === 'read_authorized_package') return {...base, kind: 'read_package', authorized, files: authorized.proofs.files,
    identity: supportHash({source: current.source, authorization: authorized.reference, payloadContentHash: authorized.pack.payloadContentHash, proofs: authorized.proofs.captures})};
  const recipient = supportObject(command.recipient, ['name', 'organization', 'contact', 'capacity']);
  const selectedRecipient = {name: text(recipient.name, 'Destinataire déclaré', 300), organization: text(recipient.organization, 'Organisation destinataire', 300),
    contact: text(recipient.contact, 'Coordonnées destinataire', 500), capacity: text(recipient.capacity, 'Qualité destinataire', 1000)};
  const sentAt = iso(command.sentAt, 'Date d’envoi humain déclarée');
  if (supportHash(selectedRecipient) !== supportHash(current.record.reception.requester) ||
      !['secure_email', 'registered_mail', 'secure_portal', 'in_person'].includes(command.channel) ||
      Date.parse(sentAt) > Date.now() || Date.parse(sentAt) < authorized.authorization.recordedAt.toMillis()) {
    throw new HttpsError('failed-precondition', 'Destinataire examiné, canal explicite et envoi non futur après autorisation sont requis.');
  }
  const proof = await authorityLegalProof(tx, request, id, current.source, legalProof(command.proofRead), 'human_send');
  const files = new Map<string, PrivateSupportEvidence>(authorized.proofs.files.map(file => [file.evidenceId, file])); files.set(proof.file.evidenceId, proof.file);
  if (files.size > 10) throw new HttpsError('invalid-argument', 'Dix pièces natives maximum.');
  return {...base, kind: 'human_send', authorized, recipient: selectedRecipient, channel: command.channel, sentAt, proof,
    externalReference: text(command.externalReference, 'Référence externe de l’envoi', 300), reason: text(command.reason, 'Motivation de l’attestation', 4000),
    files: [...files.values()], identity: supportHash({source: current.source, authorization: authorized.reference,
      payloadContentHash: authorized.pack.payloadContentHash, proofs: authorized.proofs.captures, sendProof: proof.capture})};
}

/** Additive V2 on the existing callables. No provider mutation or actual
 * external communication is performed by these documentary instructions. */
export async function handleAuthorityRequestV2(request: any, endpoint: 'admin'|'read') {
  const uid = supportUid(request);
  if (request.data?.operation === 'detail') {
    const data = supportObject(request.data, ['capability', 'area', 'expectedUid', 'operation', 'caseId', 'evidenceCursor', 'authorizationCursor', 'eventCursor']);
    if (data.capability !== SUPPORT_LEGAL_REVIEW_CAPABILITY || data.area !== 'authority_request' || endpoint !== 'read') throw new HttpsError('invalid-argument', 'Lecture privée V2 explicite requise.');
    const id = exactCaseId(data.caseId);
    return db.runTransaction(async tx => {
      const current = await legalCase(tx, request, id, undefined);
      const page = async (collection: string, cursor: unknown) => {
        let query = legalCollection(id, collection).orderBy('__name__').limit(21);
        if (cursor !== undefined && cursor !== null) query = query.startAfter(supportId(cursor));
        const snapshot = await tx.get(query), rows = snapshot.docs.slice(0, 20), last = rows.at(-1);
        return {rows, hasMore: snapshot.size > 20, cursor: snapshot.size > 20 ? last?.id ?? null : null};
      };
      const evidence = await page('review_evidence', data.evidenceCursor), authorizations = await page('legal_v2_authorizations', data.authorizationCursor), events = await page('legal_v2_events', data.eventCursor);
      return {protocol: 'authority_request_detail_v2', actorId: uid, caseId: id, source: current.source, case: current.view,
        evidence: {items: evidence.rows.map(doc => {const item = doc.data();return {evidence: privateSupportEvidenceRef({evidenceId: item.evidenceId,
          generation: item.generation, sha256: item.sha256, sizeBytes: item.sizeBytes}), purpose: item.purpose,
          uploadedAt: nativeStamp(item.recordedAt) ? item.recordedAt.toDate().toISOString() : null};}), hasMore: evidence.hasMore, cursor: evidence.cursor},
        authorizations: {items: authorizations.rows.map(doc => {const record = doc.data();return {reference: {id: doc.id, contentHash: supportSourceHash(record)},
          record: {...record, recordedAt: nativeStamp(record.recordedAt) ? record.recordedAt.toDate().toISOString() : null}};}), hasMore: authorizations.hasMore, cursor: authorizations.cursor},
        events: {items: events.rows.map(doc => {const record = doc.data();return {reference: {id: doc.id, contentHash: supportSourceHash(record)},
          record: {...record, recordedAt: nativeStamp(record.recordedAt) ? record.recordedAt.toDate().toISOString() : null}};}), hasMore: events.hasMore, cursor: events.cursor},
        legalAuthorityVerified: false, externalCommunicationPerformed: false, financialEffect: 'none'};
    });
  }
  const env = legalReviewEnvelope(request, 'authority_request', LEGAL_V2_ACTIONS);
  if (env.mode === 'execute' && endpoint === 'read' && !['read_evidence', 'read_authorized_package'].includes(env.descriptor.action)) {
    throw new HttpsError('invalid-argument', 'Cette nouvelle instruction nécessite le parcours administratif.');
  }
  const prepared = await db.runTransaction(tx => prepareLegalAuthorityCommand(tx, request, env));
  if (prepared.terminal) return prepared.terminal;
  await checkRateLimit(uid, true, {functionName: 'authorityRequestReviewV2', maxCallsAuthenticated: 30, maxCallsUnauthenticated: 0, windowMs: 60_000});
  let uploaded: PrivateSupportEvidence|null = null, bytes: Buffer|null = null;
  if (prepared.kind === 'upload') uploaded = await savePrivateSupportCaseJpeg(env.descriptor.caseId, uid, env.requestId, prepared.command.jpegBase64, {temporaryHold: true});
  else if (prepared.kind === 'read_evidence') bytes = await readPrivateSupportCaseJpeg(prepared.evidence);
  else for (const file of prepared.files as PrivateSupportEvidence[]) await readPrivateSupportCaseJpeg(file);
  return db.runTransaction(async tx => {
    const current = await prepareLegalAuthorityCommand(tx, request, env);
    if (current.terminal) return current.terminal;
    if (current.kind !== prepared.kind || current.identity !== prepared.identity) return commitLegalReviewReceipt(tx, env, null, null, 'source_changed');
    const id = env.descriptor.caseId, now = Timestamp.now();
    const createArtifact = (collection: string, artifactId: string, record: any, evidence: PrivateSupportEvidenceRef|null = null) => {
      const reference = {id: artifactId, contentHash: supportSourceHash(record)};
      current.catalogue.commit();
      tx.create(legalCollection(id, collection).doc(artifactId), record);
      return {reference, receipt: commitLegalReviewReceipt(tx, env, reference, evidence)};
    };
    if (current.kind === 'upload') {
      if (!uploaded) throw new HttpsError('unavailable', 'Le résultat natif de la pièce reste inconnu.');
      const record = {...uploaded, purpose: current.command.purpose, sourceAtUpload: current.source, recordedAt: now};
      return createArtifact('review_evidence', uploaded.evidenceId, record, privateSupportEvidenceRef({evidenceId: uploaded.evidenceId,
        generation: uploaded.generation, sha256: uploaded.sha256, sizeBytes: uploaded.sizeBytes})).receipt;
    }
    if (current.kind === 'read_evidence') {
      if (!bytes) throw new HttpsError('unavailable', 'La lecture native de la pièce reste inconnue.');
      const evidence = privateSupportEvidenceRef(current.command.evidence), readId = 'authority_read_' + supportHash([uid, env.requestId]);
      const record = {protocol: 'authority_evidence_read_v2', actorId: uid, authTime: request.auth.token.auth_time, requestId: env.requestId,
        payloadHash: env.descriptor.payloadHash, caseId: id, source: current.source, evidence, purpose: current.evidence.purpose, recordedAt: now,
        recipientDeliveryVerified: false, humanInspectionAutomaticallyVerified: false};
      const result = createArtifact('legal_v2_evidence_reads', readId, record, evidence);
      return {protocol: 'authority_evidence_read_result_v2', actorId: uid, caseId: id, evidence, readReference: result.reference,
        purpose: record.purpose, jpegBase64: bytes.toString('base64'), receipt: result.receipt};
    }
    if (current.kind === 'authorize') {
      const record = {protocol: 'authority_package_authorization_v2', actorId: uid, authTime: request.auth.token.auth_time,
        caseId: id, source: current.source, packageReference: current.pack.reference, payloadContentHash: current.pack.payloadContentHash,
        review: current.review, proofs: current.proofs.captures, reason: current.reason, recordedAt: now,
        authorizationScope: 'exact_current_package_only', humanExaminationsRecorded: true, corporateDelegationAutomaticallyInferred: false,
        legalAuthorityVerified: false, externalCommunicationPerformed: false, financialEffect: 'none'};
      return createArtifact('legal_v2_authorizations', 'authority_auth_' + supportHash([uid, env.requestId]), record).receipt;
    }
    if (current.kind === 'read_package') {
      const record = {protocol: 'authority_package_access_v2', actorId: uid, authTime: request.auth.token.auth_time,
        caseId: id, source: current.source, authorizationReference: current.authorized.reference,
        packageReference: current.authorized.pack.reference, payloadContentHash: current.authorized.pack.payloadContentHash,
        recordedAt: now, legalAuthorityVerified: false};
      const result = createArtifact('legal_v2_access', 'authority_access_' + supportHash([uid, env.requestId]), record);
      return {protocol: 'authority_authorized_package_read_v2', actorId: uid, caseId: id,
        payload: current.authorized.pack.payload, payloadContentHash: current.authorized.pack.payloadContentHash,
        receipt: result.receipt, externalCommunicationPerformed: false, legalAuthorityVerified: false};
    }
    if (current.kind === 'human_send') {
      const record = {protocol: 'authority_human_send_attestation_v2', actorId: uid, caseId: id, source: current.source,
        authorizationReference: current.authorized.reference, packageReference: current.authorized.pack.reference,
        payloadContentHash: current.authorized.pack.payloadContentHash, recipient: current.recipient, channel: current.channel,
        sentAt: current.sentAt, externalReference: current.externalReference, proof: current.proof.capture,
        reason: current.reason, recordedAt: now, humanSendAttested: true, externalCommunicationIndependentlyVerified: false,
        legalAuthorityVerified: false, financialEffect: 'none'};
      return createArtifact('legal_v2_events', 'authority_event_' + supportHash([uid, env.requestId]), record).receipt;
    }
    const record = {protocol: 'authority_external_receipt_recorded_v2', actorId: uid, caseId: id, source: current.source,
      sendReference: current.selectedSend, authorizationReference: current.send.authorizationReference,
      packageReference: current.send.packageReference, payloadContentHash: current.send.payloadContentHash,
      recipient: current.send.recipient, channel: current.send.channel, receivedAt: current.receivedAt,
      externalReference: current.externalReference, proof: current.proof.capture, reason: current.reason, recordedAt: now,
      externalAcknowledgmentRecorded: true, externalReceiptIndependentlyVerified: false, currentDisclosurePermissionGranted: false,
      legalAuthorityVerified: false, financialEffect: 'none'};
    return createArtifact('legal_v2_events', 'authority_event_' + supportHash([uid, env.requestId]), record).receipt;
  });
}
