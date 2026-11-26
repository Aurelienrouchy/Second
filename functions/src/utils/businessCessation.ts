/** Cessation servicing only. No endpoint changes the independent admission
 * control, settles an obligation, sends a message, or moves money. */
import {FieldValue,Timestamp} from 'firebase-admin/firestore';
import {HttpsError} from 'firebase-functions/v2/https';
import {db} from '../config/firebase';
import {createRecoveryEvidence,readFinancialRecoveryControl,readFinancialRecoveryIdentityClaim,
  readFinancialRecoveryPinnedObject,recoveryDigest,recoveryInstallation,FinancialRecoveryBlocked} from '../config/recoveryControl';
import {qualifiedBusinessAdmission} from './businessAdmission';
import {assertPrivateAccountSession,withPrivateAccountSession} from './privateAccountSession';
import {assertRecentAccountAuthentication} from './eligibility';
import {supportAdmin,supportAccountUid,supportHash,supportId,supportObject,supportRequestId,supportRevision,supportSourceHash,supportText} from './supportRequest';
import {withFinancialRecoveryIoBudget} from '../config/recoveryControl';

export const BUSINESS_CESSATION_CAPABILITY='business_cessation_v1';
const PROTOCOL='business_cessation_plan_v1',ROOT='admin_alerts',PAGE_SIZE=20;
const contact={responsible:'Direction Seconde' as const,email:'privacy@seconde.app' as const,availabilityVerified:false as const};
type Data=FirebaseFirestore.DocumentData;
type Reference={kind:'transaction'|'swap'|'withdrawal'|'wallet'|'support';id:string};
export type CessationCommand={action:'create_plan';reason:string}|
 {action:'advance_inventory'|'seal_inventory'|'export_next_page'|'seal_export';planId:string;expectedVersion:number}|
 {action:'link_claim';planId:string;supportRequestId:string;reference:Reference}|{action:'export_claim';planId:string;claimId:string};
type Source={id:string;collection:string;group?:true;routes:readonly string[]};
/** Explicit source universe, not a claim of finding unknown collections,
 * provider-only parcels, free text, devices, or future financial events. */
const SOURCES:readonly Source[]=[
 {id:'orders_and_returns',collection:'transactions',routes:['existing_order','refund_allocation','commercial_recourse','tracking_and_return']},
 {id:'swaps',collection:'swaps',routes:['existing_swap','swap_hold_assistance']},
 {id:'articles_and_reservations',collection:'articles',routes:['inventory_release_after_native_resolution']},
 {id:'shared_stock_units',collection:'inventory_units',routes:['inventory_release_after_native_resolution']},
 {id:'swap_party_stock',collection:'swapPartyItems',routes:['existing_swap']},
 {id:'shipping_quotes',collection:'shipping_quotes',routes:['existing_label_source']},
 {id:'shipping_packages',collection:'shipping_packages',routes:['existing_label_source']},
 {id:'parcel_label_cases',collection:'label_lifecycle_cases',routes:['label_lifecycle']},
 {id:'commercial_disputes',collection:'disputes',routes:['commercial_recourse']},
 {id:'support',collection:'support_requests',routes:['existing_support_case']},
 {id:'withdrawals',collection:'withdrawal_requests',routes:['payout_recovery','exceptional_restitution']},
 {id:'wallets',collection:'wallets',routes:['wallet_withdrawal','exceptional_restitution','global_financial_reconciliation']},
 {id:'return_instructions',collection:'commercial_return_instructions',group:true,routes:['commercial_return']},
 {id:'return_deposit',collection:'return_deposit',group:true,routes:['return_deposit']},
 {id:'return_to_sender',collection:'return_to_sender_cases',group:true,routes:['return_to_sender']},
 {id:'late_transport',collection:'late_transport_incidents',group:true,routes:['late_transport_recovery']},
 {id:'claim_reviews',collection:'commercial_claim_reviews',group:true,routes:['commercial_claim_review']},
 {id:'transport_reviews',collection:'transport_reviews',group:true,routes:['transport_review']},
 {id:'operator_financial_alerts',collection:'admin_alerts',routes:['global_financial_reconciliation','exceptional_restitution','orphan_capture_original_refund']},
];
export const BUSINESS_CESSATION_INVENTORY={protocol:'business_cessation_inventory_v1',sources:SOURCES.map(s=>({category:s.id,collection:s.collection,collectionGroup:s.group===true})),
 unknowns:['provider_only_objects_require_current_provider_reconciliation','unregistered_sources_and_free_text_require_operator_search',
 'future_events_require_further_inventory','financial_reserve_and_real_operating_continuity_not_verified'],sourceUniverseExhaustive:false} as const;
const hash=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const planId=(v:unknown):v is string=>typeof v==='string'&&/^bc_[a-f0-9]{64}$/.test(v);
const claimId=(v:unknown):v is string=>typeof v==='string'&&/^cc_[a-f0-9]{64}$/.test(v);
const integer=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>=0;
const native=(v:unknown):v is Timestamp=>v instanceof Timestamp&&v.seconds>0&&v.toMillis()<=Date.now();
const iso=(v:unknown)=>native(v)?v.toDate().toISOString():null;
const planRef=(id:string)=>db.collection(ROOT).doc(id);
const operationRef=(uid:string,rid:string)=>db.collection(ROOT).doc('business_cessation_operations').collection('cessation_commands').doc(supportHash([uid,rid]));
const pageRef=(id:string,n:number)=>planRef(id).collection('cessation_pages').doc(String(n).padStart(12,'0'));
const claimRef=(id:string)=>db.collection(ROOT).doc(id);
function failure(reason:string):never{throw new HttpsError('failed-precondition','Le plan et ses sources doivent être relus ou qualifiés.',{reason});}
async function authority(tx:FirebaseFirestore.Transaction,r:any,recent=false){
 const session=await assertPrivateAccountSession(r,tx);await supportAdmin(tx,r.auth.uid,session.currentAdminClaim);
 const privateUser=(await tx.get(db.collection('users').doc(r.auth.uid))).data();if(privateUser?.isAdmin!==true)throw new HttpsError('permission-denied','Rôle administratif privé actuel requis.');
 if(recent)assertRecentAccountAuthentication(r.auth.token);
}
function command(raw:unknown):CessationCommand{
 const v=supportObject(raw,['action','reason','planId','expectedVersion','supportRequestId','reference','claimId']);
 if(v.action==='create_plan'){supportObject(v,['action','reason']);return {action:v.action,reason:supportText(v.reason,'Motif',1500)};}
 if(!planId(v.planId))throw new HttpsError('invalid-argument','Plan natif requis.');
 if(v.action==='export_claim'){supportObject(v,['action','planId','claimId']);if(!claimId(v.claimId))throw new HttpsError('invalid-argument','Réclamation native requise.');return {action:v.action,planId:v.planId,claimId:v.claimId};}
 if(v.action==='link_claim'){
  supportObject(v,['action','planId','supportRequestId','reference']);const ref=supportObject(v.reference,['kind','id']);
  if(!['transaction','swap','withdrawal','wallet','support'].includes(ref.kind))throw new HttpsError('invalid-argument','Obligation native requise.');
  return {action:v.action,planId:v.planId,supportRequestId:supportId(v.supportRequestId),reference:{kind:ref.kind,id:ref.kind==='wallet'?supportAccountUid(ref.id):supportId(ref.id)}};
 }
 supportObject(v,['action','planId','expectedVersion']);
 if(!['advance_inventory','seal_inventory','export_next_page','seal_export'].includes(v.action)||!integer(v.expectedVersion)||v.expectedVersion<1)throw new HttpsError('invalid-argument','Commande du plan invalide.');
 return {action:v.action,planId:v.planId,expectedVersion:v.expectedVersion} as CessationCommand;
}
function checkedPlan(d:Data|undefined,id:string):Data{
 if(!d||d.protocol!==PROTOCOL||d.planId!==id||!planId(id)||!integer(d.version)||d.version<1||
  !d.capture||!integer(d.capture.seconds)||d.capture.seconds<1||!integer(d.capture.nanoseconds)||d.capture.nanoseconds>=1e9||d.capture.nanoseconds%1000!==0||
  !d.inventory||!integer(d.inventory.sourceIndex)||d.inventory.sourceIndex>SOURCES.length||d.inventory.sourceCount!==SOURCES.length||
  !integer(d.inventory.pageCount)||!integer(d.inventory.rowCount)||!integer(d.inventory.unknownCount)||!hash(d.inventory.digest)||
  d.inventory.cursor!==null&&typeof d.inventory.cursor!=='string'||typeof d.inventory?.complete!=='boolean'||
  !d.export||!integer(d.export.pageCount)||d.export.pageCount>d.inventory.pageCount||!hash(d.export.digest)||typeof d.export.sealed!=='boolean')failure('cessation_plan_unqualified');
 return d;
}
function planView(d:Data){return {protocol:PROTOCOL,planId:d.planId,version:d.version,createdBy:d.createdBy,reason:d.reason,capture:d.capture,
 inventory:d.inventory,export:{pageCount:d.export.pageCount,digest:d.export.digest,sealed:d.export.sealed,policyQualified:!!d.export.policyPin},
 inventorySettlesObligations:false,allObligationsResolved:false,reserveFinancingVerified:false,independentArchiveRecorded:d.export.sealed===true,
 outsideAppFutureAvailabilityVerified:false,createdAt:iso(d.createdAt),updatedAt:iso(d.updatedAt)};}
function receipt(r:any,uid:string,rid:string,inputHash:string){
 if(r&&(r.protocol!=='business_cessation_receipt_v1'||r.actorUid!==uid||r.requestId!==rid||r.inputHash!==inputHash||
  !native(r.recordedAt)||r.claimId!==null&&!claimId(r.claimId)||r.resultingVersion!==null&&(!integer(r.resultingVersion)||r.resultingVersion<1)||
  (r.state==='not_executed'?(r.action!==null||r.planId!==null||r.claimId!==null||r.resultingVersion!==null):
   !planId(r.planId)||!['create_plan','advance_inventory','seal_inventory','export_next_page','seal_export','link_claim','export_claim'].includes(r.action))||
  r.state==='pending'&&!['export_next_page','seal_export','export_claim'].includes(r.action)||
  !['recorded','not_executed','pending'].includes(r.state)||r.receiptHash!==supportHash({actorUid:uid,requestId:rid,inputHash,state:r.state,
   action:r.action,planId:r.planId,claimId:r.claimId,resultingVersion:r.resultingVersion})))failure('cessation_receipt_conflict');
 return {protocol:'business_cessation_receipt_v1',actorUid:uid,requestId:rid,inputHash,state:r?.state??'unrecorded',action:r?.action??null,
  planId:r?.planId??null,claimId:r?.claimId??null,resultingVersion:r?.resultingVersion??null,receiptHash:r?.receiptHash??null,
  recordedAt:iso(r?.recordedAt),newCommerceActivated:false,financialEffectExecuted:false};
}
function makeReceipt(uid:string,rid:string,inputHash:string,state:'recorded'|'not_executed'|'pending',c:CessationCommand|null,version:number|null,claim:string|null=null){
 const body={actorUid:uid,requestId:rid,inputHash,state,action:c?.action??null,planId:c?.action==='create_plan'?'bc_'+supportHash([uid,rid]):c?.planId??null,
  claimId:claim,resultingVersion:version};return {protocol:'business_cessation_receipt_v1',...body,receiptHash:supportHash(body),recordedAt:FieldValue.serverTimestamp()};
}
/** The point comes from a native read, never from a client clock. Minute
 * precision permits PITR only when the actual SDK read at that point succeeds. */
async function capture(r:any){
 await db.runTransaction(tx=>authority(tx,r,true));
 const clock=await db.runTransaction(tx=>tx.get(planRef('business_cessation_capture_clock')),{readOnly:true});
 if(!(clock.readTime instanceof Timestamp)||clock.readTime.nanoseconds%1000!==0)failure('cessation_native_read_time_unavailable');
 const point=new Timestamp(Math.floor(clock.readTime.seconds/60)*60,0);
 const pinned=await db.runTransaction(tx=>tx.get(planRef('business_cessation_capture_clock')),{readOnly:true,readTime:point});
 if(!(pinned.readTime instanceof Timestamp)||!pinned.readTime.isEqual(point))failure('cessation_native_read_time_not_observed');
 await db.runTransaction(tx=>authority(tx,r,true));return {seconds:point.seconds,nanoseconds:point.nanoseconds};
}
async function inventoryPage(r:any,p:Data){
 const source=SOURCES[p.inventory.sourceIndex];if(!source)failure('cessation_inventory_already_complete');
 const point=new Timestamp(p.capture.seconds,p.capture.nanoseconds),age=Date.now()-point.toMillis();
 if(age<0||age>7*86400000)failure('cessation_native_read_time_expired');
 await db.runTransaction(tx=>authority(tx,r,true));
 let result:{rows:Data[];last:string|null;more:boolean};
 try{result=await db.runTransaction(async tx=>{
  let q:FirebaseFirestore.Query=(source.group?db.collectionGroup(source.collection):db.collection(source.collection)).orderBy('__name__').limit(PAGE_SIZE+1);
  if(p.inventory.cursor)q=q.startAfter(source.group?db.doc(p.inventory.cursor):p.inventory.cursor);
  const snap=await tx.get(q);if(!(snap.readTime instanceof Timestamp)||!snap.readTime.isEqual(point))failure('cessation_native_read_time_not_observed');
  const selected=snap.docs.slice(0,PAGE_SIZE),rows=selected.map(s=>{
   const d=s.data(),status=typeof d.status==='string'&&/^[a-zA-Z0-9_.:-]{1,80}$/.test(d.status)?d.status:null;
   const active=['pending','accepted','payment_pending','photos_pending','shipping','shipped','paid','label_created','delivered','disputed','processing','open','received','in_review','awaiting_information','reserved','held'];
   return {rowId:supportHash([source.id,s.ref.path]),category:source.id,sourceRef:s.ref.path,sourceHash:supportSourceHash({ref:s.ref.path,source:d}),
    sourceRevision:supportRevision(s),status,obligationState:status&&active.includes(status)?'open':'unknown',responsible:'Direction Seconde',
    recoveryRoutes:[...source.routes],physicalCompletionVerified:false,financialSettlementVerified:false};
  });
  return {rows,last:selected.length?(source.group?selected.at(-1)!.ref.path:selected.at(-1)!.id):null,more:snap.size>PAGE_SIZE};
 },{readOnly:true,readTime:point});}catch(error){if(error instanceof HttpsError)throw error;failure('cessation_native_read_time_unavailable');}
 await db.runTransaction(tx=>authority(tx,r,true));return {source,...result};
}
type ArchivePolicy={pin:{object:string;generation:string;sha256:string};prefix:string;proofHash:string};
const stableArchive=(body:Data):Data=>JSON.parse(JSON.stringify(body,(_key,value)=>value&&typeof value==='object'&&!Array.isArray(value)?
 Object.fromEntries(Object.keys(value).sort().map(key=>[key,value[key]])):value));
async function archivePolicy():Promise<ArchivePolicy>{
 const installation=recoveryInstallation(),pin={object:process.env.BUSINESS_CESSATION_ARCHIVE_POLICY_OBJECT??'',generation:process.env.BUSINESS_CESSATION_ARCHIVE_POLICY_GENERATION??'',sha256:process.env.BUSINESS_CESSATION_ARCHIVE_POLICY_SHA256??''};
 const bytes=await readFinancialRecoveryPinnedObject(pin),v=supportObject(JSON.parse(bytes.toString('utf8')),
  ['protocol','installationId','firestoreProjectId','firestoreDatabaseId','archivePrefix','contact','retrievalTest']);
 if(v.protocol!=='business_cessation_archive_policy_v1'||v.installationId!==installation.installationId||v.firestoreProjectId!==installation.firestoreProjectId||
  v.firestoreDatabaseId!==installation.firestoreDatabaseId||v.archivePrefix!==`${installation.prefix}/permits/business-continuity/`||
  v.contact!=='privacy@seconde.app')failure('cessation_independent_archive_policy_unqualified');
 const t=supportObject(v.retrievalTest,['object','generation','sha256']),testBytes=await readFinancialRecoveryPinnedObject(t as {object:string;generation:string;sha256:string}),
  test=supportObject(JSON.parse(testBytes.toString('utf8')),['protocol','installationId','archivePrefix','result','testedAt']);
 if(test.protocol!=='business_cessation_archive_read_test_v1'||test.installationId!==installation.installationId||test.archivePrefix!==v.archivePrefix||
  test.result!=='read_verified'||typeof test.testedAt!=='string'||!Number.isFinite(Date.parse(test.testedAt))||Date.parse(test.testedAt)>Date.now())failure('cessation_outside_app_channel_unqualified');
 return {pin,prefix:v.archivePrefix,proofHash:supportHash({policy:pin,retrievalTest:t})};
}
function archivePage(p:Data,page:Data){
 const rows=page.rows.map((row:Data)=>({rowId:row.rowId,category:row.category,status:row.status,obligationState:row.obligationState,responsible:row.responsible,
  recoveryRoutes:row.recoveryRoutes,physicalCompletionVerified:false,financialSettlementVerified:false}));
 return {protocol:'business_cessation_expurgated_archive_v1',planId:p.planId,capture:p.capture,pageNumber:page.pageNumber,category:page.category,
  inventoryPageDigest:page.digest,rows,contact,reserveFinancingVerified:false,allObligationsResolved:false,containsPrivateEvidence:false};
}
function checkedPage(raw:Data|undefined,p:Data,n:number):Data{
 if(!raw||raw.protocol!=='business_cessation_page_v1'||raw.planId!==p.planId||raw.pageNumber!==n||supportHash(raw.capture)!==supportHash(p.capture)||
  !Array.isArray(raw.rows)||raw.rows.length>PAGE_SIZE||!hash(raw.previousDigest)||raw.digest!==supportHash({planId:p.planId,pageNumber:n,category:raw.category,
   capture:raw.capture,previousDigest:raw.previousDigest,rows:raw.rows}))failure('cessation_page_unqualified');return raw;
}
async function reserveExport(r:any,rid:string,inputHash:string,c:CessationCommand,policy:ArchivePolicy){
 if(c.action!=='export_next_page'&&c.action!=='seal_export')failure('cessation_export_action_required');
 const op=operationRef(r.auth.uid,rid);
 return db.runTransaction(async tx=>{
  await assertPrivateAccountSession(r,tx);const old=(await tx.get(op)).data();if(old){receipt(old,r.auth.uid,rid,inputHash);if(old.state!=='pending')return old;}
  await authority(tx,r,true);const p=checkedPlan((await tx.get(planRef(c.planId))).data(),c.planId);
  if(old?.state==='pending'){
   if(supportHash(old.command)!==inputHash||supportHash(old.policy)!==supportHash(policy)||p.exportPending?.operationId!==op.id||p.exportPending?.inputHash!==inputHash)failure('cessation_export_reservation_unqualified');return old;
  }
  if(p.version!==c.expectedVersion||p.exportPending||!p.inventory.complete||p.inventory.sourceIndex!==SOURCES.length||p.export.sealed)failure('cessation_export_source_changed');
  if(c.action==='export_next_page'&&p.export.pageCount>=p.inventory.pageCount||c.action==='seal_export'&&p.export.pageCount!==p.inventory.pageCount)failure('cessation_export_cursor_mismatch');
  if(p.export.policyPin&&supportHash(p.export.policyPin)!==supportHash(policy.pin))failure('cessation_export_policy_changed');
  const stored={...makeReceipt(r.auth.uid,rid,inputHash,'pending',c,p.version),command:c,policy};
  tx.create(op,stored);tx.update(planRef(c.planId),{exportPending:{operationId:op.id,actorUid:r.auth.uid,inputHash}});return stored;
 });
}
async function exportCommand(r:any,rid:string,inputHash:string,c:CessationCommand){
 if(c.action!=='export_next_page'&&c.action!=='seal_export')failure('cessation_export_action_required');
 const policy=await archivePolicy(),reserved=await reserveExport(r,rid,inputHash,c,policy);
 if(reserved.state!=='pending')return receipt(reserved,r.auth.uid,rid,inputHash);
 const source=await db.runTransaction(async tx=>{
  await authority(tx,r,true);const p=checkedPlan((await tx.get(planRef(c.planId))).data(),c.planId);
  if(p.version!==c.expectedVersion||p.exportPending?.operationId!==operationRef(r.auth.uid,rid).id||p.exportPending?.inputHash!==inputHash)failure('cessation_export_source_changed');
  const n=p.export.pageCount,page=c.action==='export_next_page'?checkedPage((await tx.get(pageRef(c.planId,n))).data(),p,n):null;
  return {p,page,n};
 });
 const body=stableArchive(source.page?archivePage(source.p,source.page):{protocol:'business_cessation_archive_manifest_v1',planId:c.planId,capture:source.p.capture,
  pageCount:source.p.export.pageCount,digest:source.p.export.digest,inventoryDigest:source.p.inventory.digest,policyHash:policy.proofHash,
  contact,reserveFinancingVerified:false,allObligationsResolved:false,outsideAppFutureAvailabilityVerified:false,knownSourcesOnly:true});
 const object=`${policy.prefix}${c.planId}/${source.page?'pages/'+String(source.n).padStart(12,'0'):'manifest'}.json`,contentHash=recoveryDigest(JSON.stringify(body));
 await createRecoveryEvidence(object,body);const stored=await readFinancialRecoveryIdentityClaim(object);
 if(!stored||!stored.temporaryHold||stored.sha256!==contentHash||supportHash(stored.value)!==supportHash(body))failure('cessation_archive_write_unqualified');
 const after=await archivePolicy();if(supportHash(after)!==supportHash(policy))failure('cessation_export_policy_changed');
 await db.runTransaction(async tx=>{
  await assertPrivateAccountSession(r,tx);const old=(await tx.get(operationRef(r.auth.uid,rid))).data();receipt(old,r.auth.uid,rid,inputHash);
  if(old?.state==='recorded')return;await authority(tx,r,true);
  const p=checkedPlan((await tx.get(planRef(c.planId))).data(),c.planId);
  if(old?.state!=='pending'||p.version!==c.expectedVersion||p.exportPending?.operationId!==operationRef(r.auth.uid,rid).id||
   supportHash(old.policy)!==supportHash(policy)||p.exportPending.inputHash!==inputHash)failure('cessation_export_source_changed');
  const proof={object,generation:stored.generation,sha256:stored.sha256,policyHash:policy.proofHash};
  const next=source.page?{...p.export,pageCount:p.export.pageCount+1,digest:supportHash({previous:p.export.digest,pageNumber:source.n,proof}),policyPin:policy.pin,lastProof:proof}:
   {...p.export,sealed:true,policyPin:policy.pin,manifest:proof};
  tx.update(planRef(c.planId),{version:p.version+1,export:next,exportPending:null,updatedAt:FieldValue.serverTimestamp()});
  if(source.page)tx.create(planRef(c.planId).collection('cessation_exports').doc(String(source.n).padStart(12,'0')),{protocol:'business_cessation_archive_pin_v1',planId:c.planId,pageNumber:source.n,...proof});
  tx.set(operationRef(r.auth.uid,rid),makeReceipt(r.auth.uid,rid,inputHash,'recorded',c,p.version+1));
 });
 return receipt((await operationRef(r.auth.uid,rid).get()).data(),r.auth.uid,rid,inputHash);
}
async function ownObligation(tx:FirebaseFirestore.Transaction,uid:string,ref:Reference){
 const collection={transaction:'transactions',swap:'swaps',withdrawal:'withdrawal_requests',wallet:'wallets',support:'support_requests'}[ref.kind],s=await tx.get(db.collection(collection).doc(ref.id)),d=s.data();
 const own=!!d&&(ref.kind==='transaction'?(d.buyerId===uid||d.sellerId===uid):ref.kind==='swap'?(d.initiatorId===uid||d.receiverId===uid):
  ref.kind==='withdrawal'?d.userId===uid:ref.kind==='wallet'?s.id===uid:d.ownerId===uid);
 if(!own)throw new HttpsError('permission-denied','Cette obligation native ne vous appartient pas.');return {sourceHash:supportSourceHash({ref:s.ref.path,source:d}),sourceRevision:supportRevision(s)};
}
function checkedClaim(raw:Data|undefined,uid:string,id:string):Data{
 if(!raw||raw.protocol!=='business_cessation_claim_v1'||raw.claimId!==id||raw.ownerUid!==uid||!planId(raw.planId)||!hash(raw.sourceHash)||
  id!=='cc_'+supportHash([uid,raw.planId,raw.supportRequestId,raw.reference]))throw new HttpsError('permission-denied','Réclamation privée indisponible.');return raw;
}
function claimView(c:Data){return {protocol:c.protocol,claimId:c.claimId,planId:c.planId,ownerUid:c.ownerUid,supportRequestId:c.supportRequestId,
 reference:c.reference,sourceHash:c.sourceHash,sourceRevision:c.sourceRevision,status:'recorded_for_servicing',contact,recordedAt:iso(c.recordedAt),
 obligationResolved:false,financialEffectExecuted:false,archive:{state:c.archivePin?'recorded':c.exportPending?'pending':'not_recorded',
 contentHash:c.archivePin?.sha256??null,generation:c.archivePin?.generation??null}};}
/** A position, never an authority. No raw account identity is embedded in a
 * cursor, and a token from another reader/actor cannot silently move a page. */
function discoveryCursor(raw:unknown,mode:'plans'|'own_claims',uid:string):string|null{
 if(raw===null)return null;
 if(typeof raw!=='string'||raw.length>1000||!/^bcd_[A-Za-z0-9_-]+$/.test(raw))throw new HttpsError('invalid-argument','Curseur de page native invalide.');
 try{const encoded=raw.slice(4),bytes=Buffer.from(encoded,'base64url');if(bytes.toString('base64url')!==encoded)throw Error('encoding');
  const c=supportObject(JSON.parse(bytes.toString('utf8')),['version','mode','actorHash','afterId','hash']);
  if(c.version!==1||c.mode!==mode||c.actorHash!==supportHash(uid)||(mode==='plans'?!planId(c.afterId):!claimId(c.afterId))||
   c.hash!==supportHash({version:1,mode,actorHash:c.actorHash,afterId:c.afterId}))throw Error('scope');return c.afterId;
 }catch{throw new HttpsError('invalid-argument','Ce curseur ne correspond pas au lecteur et au compte courants.');}
}
function nextDiscoveryCursor(afterId:string,mode:'plans'|'own_claims',uid:string):string{
 const body={version:1,mode,actorHash:supportHash(uid),afterId};return 'bcd_'+Buffer.from(JSON.stringify({...body,hash:supportHash(body)})).toString('base64url');
}
async function exportClaimCommand(r:any,rid:string,inputHash:string,c:Extract<CessationCommand,{action:'export_claim'}>){
 const policy=await archivePolicy(),op=operationRef(r.auth.uid,rid);
 const source=await db.runTransaction(async tx=>{
  await assertPrivateAccountSession(r,tx);const old=(await tx.get(op)).data();if(old){receipt(old,r.auth.uid,rid,inputHash);if(old.state!=='pending')return {done:old};}
  const claim=checkedClaim((await tx.get(claimRef(c.claimId))).data(),r.auth.uid,c.claimId);if(claim.planId!==c.planId)failure('cessation_claim_source_conflict');
  if(claim.archivePin){if(old)failure('cessation_claim_archive_conflict');const done=makeReceipt(r.auth.uid,rid,inputHash,'recorded',c,null,c.claimId);tx.create(op,done);return {done};}
  if(old){if(supportHash(old.command)!==inputHash||supportHash(old.policy)!==supportHash(policy)||claim.exportPending?.operationId!==op.id)failure('cessation_claim_archive_conflict');}
  else{if(claim.exportPending)failure('cessation_claim_archive_pending');
   tx.create(op,{...makeReceipt(r.auth.uid,rid,inputHash,'pending',c,null,c.claimId),command:c,policy});
   tx.update(claimRef(c.claimId),{exportPending:{operationId:op.id,actorUid:r.auth.uid,inputHash}});}
  return {claim};
 });
 if(source.done)return receipt((await op.get()).data(),r.auth.uid,rid,inputHash);
 const claim=source.claim!,body=stableArchive({protocol:'business_cessation_claim_archive_v1',claimId:c.claimId,planId:c.planId,ownerUid:r.auth.uid,
  supportRequestId:claim.supportRequestId,reference:claim.reference,sourceHash:claim.sourceHash,sourceRevision:claim.sourceRevision,
  recordedAt:iso(claim.recordedAt),contact,obligationResolved:false,financialEffectExecuted:false,containsPrivateEvidence:false});
 if(!body.recordedAt)failure('cessation_claim_recorded_time_unavailable');
 const object=`${policy.prefix}${c.planId}/claims/${c.claimId}.json`,sha256=recoveryDigest(JSON.stringify(body));
 await createRecoveryEvidence(object,body);const stored=await readFinancialRecoveryIdentityClaim(object);
 if(!stored||!stored.temporaryHold||stored.sha256!==sha256||supportHash(stored.value)!==supportHash(body))failure('cessation_claim_archive_unqualified');
 if(supportHash(await archivePolicy())!==supportHash(policy))failure('cessation_export_policy_changed');
 await db.runTransaction(async tx=>{
  await assertPrivateAccountSession(r,tx);const old=(await tx.get(op)).data();receipt(old,r.auth.uid,rid,inputHash);if(old?.state==='recorded')return;
  const current=checkedClaim((await tx.get(claimRef(c.claimId))).data(),r.auth.uid,c.claimId);
  if(old?.state!=='pending'||current.archivePin||current.exportPending?.operationId!==op.id||current.exportPending?.inputHash!==inputHash||
   supportHash(old.policy)!==supportHash(policy)||current.sourceHash!==claim.sourceHash||current.sourceRevision!==claim.sourceRevision||
   supportHash(current.reference)!==supportHash(claim.reference))failure('cessation_claim_archive_conflict');
  tx.update(claimRef(c.claimId),{exportPending:null,archivePin:{object,generation:stored.generation,sha256:stored.sha256,policyHash:policy.proofHash}});
  tx.set(op,makeReceipt(r.auth.uid,rid,inputHash,'recorded',c,null,c.claimId));
 });return receipt((await op.get()).data(),r.auth.uid,rid,inputHash);
}
async function execute(r:any,rid:string,inputHash:string,c:CessationCommand,entry:'owner'|'admin'|'read'){
 const old=await db.runTransaction(async tx=>{await assertPrivateAccountSession(r,tx);return (await tx.get(operationRef(r.auth.uid,rid))).data();});
 if(old){const view=receipt(old,r.auth.uid,rid,inputHash);if(old.state!=='pending')return view;if(!['export_next_page','seal_export','export_claim'].includes(c.action)||supportHash(old.command)!==inputHash)failure('cessation_pending_command_mismatch');}
 if(!['link_claim','export_claim'].includes(c.action)&&entry!=='admin')throw new HttpsError('permission-denied','Commande administrative requise.');
 if(['link_claim','export_claim'].includes(c.action)&&entry!=='owner')throw new HttpsError('permission-denied','Commande propriétaire requise.');
 if(c.action==='export_claim')return exportClaimCommand(r,rid,inputHash,c);
 if(c.action==='export_next_page'||c.action==='seal_export')return exportCommand(r,rid,inputHash,c);
 const point=c.action==='create_plan'?await capture(r):null;
 const expected=c.action==='advance_inventory'?await db.runTransaction(async tx=>{await authority(tx,r,true);return checkedPlan((await tx.get(planRef(c.planId))).data(),c.planId);}):null;
 const page=expected?await inventoryPage(r,expected):null;
 await db.runTransaction(async tx=>{
  await assertPrivateAccountSession(r,tx);const op=operationRef(r.auth.uid,rid),first=(await tx.get(op)).data();if(first){receipt(first,r.auth.uid,rid,inputHash);return;}
  if(c.action!=='link_claim')await authority(tx,r,true);
  if(c.action==='create_plan'){
   const id='bc_'+supportHash([r.auth.uid,rid]),exists=await tx.get(planRef(id));if(exists.exists)failure('cessation_plan_without_receipt');
   const d={protocol:PROTOCOL,planId:id,version:1,createdBy:r.auth.uid,reason:c.reason,capture:point,
    inventory:{sourceIndex:0,sourceCount:SOURCES.length,cursor:null,pageCount:0,rowCount:0,unknownCount:0,digest:supportHash(['business_cessation_inventory_v1',id,point]),complete:false},
    export:{pageCount:0,digest:supportHash(['business_cessation_archive_v1',id,point]),sealed:false,policyPin:null},exportPending:null,
    createdAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp()};
   tx.create(planRef(id),d);tx.create(op,makeReceipt(r.auth.uid,rid,inputHash,'recorded',c,1));return;
  }
  const p=checkedPlan((await tx.get(planRef(c.planId))).data(),c.planId);
  if(c.action==='link_claim'){
   const support=(await tx.get(db.collection('support_requests').doc(c.supportRequestId))).data();
   if(!support||support.ownerId!==r.auth.uid||support.kind!=='access_interruption')throw new HttpsError('permission-denied','Une demande privée d’interruption d’accès est requise.');
   const basis=await ownObligation(tx,r.auth.uid,c.reference),id='cc_'+supportHash([r.auth.uid,c.planId,c.supportRequestId,c.reference]),prior=await tx.get(claimRef(id));
   if(prior.exists){const d=prior.data()!;if(d.protocol!=='business_cessation_claim_v1'||d.ownerUid!==r.auth.uid||supportHash(d.reference)!==supportHash(c.reference))failure('cessation_claim_source_conflict');}
   else tx.create(claimRef(id),{protocol:'business_cessation_claim_v1',claimId:id,planId:c.planId,ownerUid:r.auth.uid,supportRequestId:c.supportRequestId,
    reference:c.reference,...basis,status:'recorded_for_servicing',contact,recordedAt:FieldValue.serverTimestamp(),obligationResolved:false,financialEffectExecuted:false});
   tx.create(op,makeReceipt(r.auth.uid,rid,inputHash,'recorded',c,p.version,id));return;
  }
  if(p.version!==c.expectedVersion||p.exportPending)failure('cessation_plan_version_changed');
  if(c.action==='seal_inventory'){
   if(p.inventory.sourceIndex!==SOURCES.length||p.inventory.cursor!==null||p.inventory.complete)failure('cessation_inventory_incomplete');
   tx.update(planRef(c.planId),{version:p.version+1,'inventory.complete':true,updatedAt:FieldValue.serverTimestamp()});
  }else{
   if(!page||!expected||supportHash(expected.inventory)!==supportHash(p.inventory)||p.inventory.complete)failure('cessation_inventory_source_changed');
   const n=p.inventory.pageCount,base={planId:c.planId,pageNumber:n,category:page.source.id,capture:p.capture,previousDigest:p.inventory.digest,rows:page.rows},digest=supportHash(base);
   const absent=await tx.get(pageRef(c.planId,n));if(absent.exists)failure('cessation_page_without_receipt');
   tx.create(pageRef(c.planId,n),{protocol:'business_cessation_page_v1',...base,digest,knownSourcesOnly:true});
   tx.update(planRef(c.planId),{version:p.version+1,inventory:{...p.inventory,sourceIndex:p.inventory.sourceIndex+(page.more?0:1),cursor:page.more?page.last:null,
    pageCount:n+1,rowCount:p.inventory.rowCount+page.rows.length,unknownCount:p.inventory.unknownCount+page.rows.filter(row=>row.obligationState==='unknown').length,digest},updatedAt:FieldValue.serverTimestamp()});
  }
  tx.create(op,makeReceipt(r.auth.uid,rid,inputHash,'recorded',c,p.version+1));
 });return receipt((await operationRef(r.auth.uid,rid).get()).data(),r.auth.uid,rid,inputHash);
}
export async function handleBusinessCessation(request:any,entry:'owner'|'admin'|'read'){
 return withFinancialRecoveryIoBudget(()=>withPrivateAccountSession(request,async()=>{
  if(!request.auth)throw new HttpsError('unauthenticated','Authentification requise.');
  const d=supportObject(request.data,['capability','expectedUid','mode','requestId','inputHash','command','planId','pageNumber','claimId','lane','cursor']);
  if(d.capability!==BUSINESS_CESSATION_CAPABILITY||supportAccountUid(d.expectedUid)!==request.auth.uid)throw new HttpsError('permission-denied','Session du dossier modifiée.');
  const uid=request.auth.uid;
  if(['execute','observe','neutralize','resume'].includes(d.mode)){
   supportObject(d,d.mode==='execute'?['capability','expectedUid','mode','requestId','inputHash','command']:['capability','expectedUid','mode','requestId','inputHash']);
   const rid=supportRequestId(d.requestId);if(!hash(d.inputHash))throw new HttpsError('invalid-argument','Empreinte exacte requise.');
   const first=await db.runTransaction(async tx=>{await assertPrivateAccountSession(request,tx);const op=operationRef(uid,rid),old=(await tx.get(op)).data();
    if(old)return receipt(old,uid,rid,d.inputHash);if(d.mode==='neutralize'){tx.create(op,makeReceipt(uid,rid,d.inputHash,'not_executed',null,null));return null;}
    return receipt(undefined,uid,rid,d.inputHash);});
   if(d.mode==='observe')return first;
   if(d.mode==='neutralize')return first??receipt((await operationRef(uid,rid).get()).data(),uid,rid,d.inputHash);
   if(first?.state==='recorded'||first?.state==='not_executed')return first;
   let c:CessationCommand;
   if(d.mode==='resume'){
    if(first?.state!=='pending')failure('cessation_no_pending_export');
    const stored=(await operationRef(uid,rid).get()).data();c=command(stored?.command);
   }else c=command(d.command);
   if(supportHash(c)!==d.inputHash)throw new HttpsError('invalid-argument','Empreinte de commande divergente.');
   return execute(request,rid,d.inputHash,c,entry);
  }
  if(entry!=='read')throw new HttpsError('invalid-argument','Utilisez le lecteur de dossiers.');
  if(d.mode==='plans'||d.mode==='own_claims'){
   supportObject(d,['capability','expectedUid','mode','cursor']);const mode=d.mode as 'plans'|'own_claims',after=discoveryCursor(d.cursor,mode,uid);
   const page=await db.runTransaction(async tx=>{
    if(mode==='plans')await authority(tx,request);else await assertPrivateAccountSession(request,tx);
    let q:FirebaseFirestore.Query=db.collection(ROOT).where('protocol','==',mode==='plans'?PROTOCOL:'business_cessation_claim_v1');
    if(mode==='own_claims')q=q.where('ownerUid','==',uid);
    q=q.orderBy('__name__').limit(PAGE_SIZE+1);if(after)q=q.startAfter(after);
    const snapshots=await tx.get(q),rows=snapshots.docs.slice(0,PAGE_SIZE),hasMore=snapshots.size>PAGE_SIZE;
    // Unknown or contradictory native records never become positive history.
    const items=rows.map(s=>mode==='plans'?planView(checkedPlan(s.data(),s.id)):claimView(checkedClaim(s.data(),uid,s.id)));
    return {protocol:mode==='plans'?'business_cessation_plans_v1':'business_cessation_own_claims_v1',items,
     cursor:hasMore?nextDiscoveryCursor(rows.at(-1)!.id,mode,uid):null,hasMore};
   });
   if(mode==='plans')await db.runTransaction(tx=>authority(tx,request));else await assertPrivateAccountSession(request);
   return page;
  }
  if(d.mode==='own_obligations'){
   supportObject(d,['capability','expectedUid','mode','lane','cursor']);
   const lanes={purchases:{collection:'transactions',field:'buyerId',kind:'transaction'},sales:{collection:'transactions',field:'sellerId',kind:'transaction'},
    swaps_initiated:{collection:'swaps',field:'initiatorId',kind:'swap'},swaps_received:{collection:'swaps',field:'receiverId',kind:'swap'},
    withdrawals:{collection:'withdrawal_requests',field:'userId',kind:'withdrawal'},wallet:{collection:'wallets',field:null,kind:'wallet'},
    support:{collection:'support_requests',field:'ownerId',kind:'support'}};
   if(typeof d.lane!=='string'||!Object.prototype.hasOwnProperty.call(lanes,d.lane)||d.cursor!==null&&(typeof d.cursor!=='string'||!d.cursor||d.cursor.includes('/')||d.cursor.length>1500))throw new HttpsError('invalid-argument','Page d’obligations privées invalide.');
   const lane=lanes[d.lane as keyof typeof lanes];if(lane.kind==='wallet'&&d.cursor!==null)throw new HttpsError('invalid-argument','Le portefeuille est une source native unique.');
   return db.runTransaction(async tx=>{
    await assertPrivateAccountSession(request,tx);let selected:FirebaseFirestore.DocumentSnapshot[],hasMore=false;
    if(lane.kind==='wallet'){const s=await tx.get(db.collection('wallets').doc(uid));selected=s.exists?[s]:[];}
    else{let q=db.collection(lane.collection).where(lane.field!,'==',uid).orderBy('__name__').limit(PAGE_SIZE+1);if(d.cursor)q=q.startAfter(d.cursor);
     const page=await tx.get(q);selected=page.docs.slice(0,PAGE_SIZE);hasMore=page.size>PAGE_SIZE;}
    const items=selected.map(s=>{const v=s.data()!,currency=typeof v.currency==='string'&&v.currency.toUpperCase()==='CAD'?'CAD':null;
     const raw=lane.kind==='wallet'?v.balance:lane.kind==='withdrawal'?v.amount:lane.kind==='transaction'?v.totalAmount:undefined;
     const cents=lane.kind==='transaction'&&typeof raw==='number'?Math.round(raw*100):raw;
     const amountCents=currency==='CAD'&&integer(cents)&&(lane.kind!=='transaction'||Math.abs(raw*100-cents)<0.000001)?cents:null;
     return {reference:{kind:lane.kind,id:s.id},status:typeof v.status==='string'&&/^[a-zA-Z0-9_.:-]{1,80}$/.test(v.status)?v.status:null,
      recordedAt:iso(v.createdAt??v.receivedAt??v.activatedAt),amountCents,currency:amountCents===null?null:currency,
      sourceHash:supportSourceHash({ref:s.ref.path,source:v}),sourceRevision:supportRevision(s)};});
    return {protocol:'business_cessation_own_obligations_v1',lane:d.lane,items,cursor:hasMore?selected.at(-1)!.id:null,hasMore,claimPermissionGranted:false};
   });
  }
  if(d.mode==='status'){
   supportObject(d,['capability','expectedUid','mode']);await assertPrivateAccountSession(request);
   try{const q=await readFinancialRecoveryControl(),a=qualifiedBusinessAdmission(q);return {protocol:'business_cessation_status_v1',newCommerce:a?.state??'unqualified',
    reason:a?null:'business_admission_configuration_required',controlGeneration:q.generation,planId:a?.planId??null,servicingIndependentlyGuarded:true,
    declaredContact:contact,reserveFinancingVerified:false,cessationActivatedByThisRequest:false};}
   catch(error){return {protocol:'business_cessation_status_v1',newCommerce:'unqualified',reason:error instanceof FinancialRecoveryBlocked?error.reason:'control_unavailable',
    controlGeneration:null,planId:null,servicingIndependentlyGuarded:true,declaredContact:contact,reserveFinancingVerified:false,cessationActivatedByThisRequest:false};}
  }
  if(d.mode==='claim'||d.mode==='claim_export_read'){
   supportObject(d,['capability','expectedUid','mode','claimId']);if(!claimId(d.claimId))throw new HttpsError('invalid-argument','Réclamation exacte requise.');
   const claim=await db.runTransaction(async tx=>{await assertPrivateAccountSession(request,tx);return checkedClaim((await tx.get(claimRef(d.claimId))).data(),uid,d.claimId);});
   if(d.mode==='claim')return claimView(claim);
   const installation=recoveryInstallation(),expected=`${installation.prefix}/permits/business-continuity/${claim.planId}/claims/${d.claimId}.json`;
   if(claim.archivePin?.object!==expected||!hash(claim.archivePin.sha256))failure('cessation_claim_archive_not_recorded');
   const read=await readFinancialRecoveryIdentityClaim(expected);
   if(!read||!read.temporaryHold||read.generation!==claim.archivePin.generation||read.sha256!==claim.archivePin.sha256||read.value.ownerUid!==uid||read.value.claimId!==d.claimId)failure('cessation_claim_archive_generation_changed');
   await assertPrivateAccountSession(request);const bytes=Buffer.from(JSON.stringify(read.value));if(recoveryDigest(bytes)!==read.sha256)failure('cessation_archive_bytes_changed');
   return {protocol:'business_cessation_claim_export_read_v1',planId:claim.planId,claimId:d.claimId,contentHash:read.sha256,generation:read.generation,
    bytesBase64:bytes.toString('base64'),mimeType:'application/json',independentArchiveRecorded:true,outsideAppFutureAvailabilityVerified:false,containsPrivateEvidence:false};
  }
  supportObject(d,d.mode==='plan'?['capability','expectedUid','mode','planId']:['capability','expectedUid','mode','planId','pageNumber']);
  if(!planId(d.planId)||!['plan','inventory_page','export_read'].includes(d.mode)||d.mode!=='plan'&&!integer(d.pageNumber))throw new HttpsError('invalid-argument','Lecture du plan invalide.');
  const result:Data=await db.runTransaction(async tx=>{
   await authority(tx,request);const p=checkedPlan((await tx.get(planRef(d.planId))).data(),d.planId);
   if(d.mode==='plan')return planView(p);
   if(d.pageNumber>=p.inventory.pageCount)throw new HttpsError('not-found','Page du plan absente.');
   if(d.mode==='inventory_page')return checkedPage((await tx.get(pageRef(d.planId,d.pageNumber))).data(),p,d.pageNumber);
   const pin=(await tx.get(planRef(d.planId).collection('cessation_exports').doc(String(d.pageNumber).padStart(12,'0')))).data();
   if(pin?.protocol!=='business_cessation_archive_pin_v1'||pin.planId!==d.planId||pin.pageNumber!==d.pageNumber||!hash(pin.sha256))failure('cessation_archive_pin_unqualified');return pin;
  });
  if(d.mode!=='export_read')return result;
  const installation=recoveryInstallation(),expected=`${installation.prefix}/permits/business-continuity/${d.planId}/pages/${String(d.pageNumber).padStart(12,'0')}.json`;
  if(result.object!==expected)failure('cessation_archive_pin_unqualified');
  const read=await readFinancialRecoveryIdentityClaim(result.object);
  if(!read||!read.temporaryHold||read.generation!==result.generation||read.sha256!==result.sha256)failure('cessation_archive_generation_changed');
  const bytes=Buffer.from(JSON.stringify(read.value));if(recoveryDigest(bytes)!==read.sha256)failure('cessation_archive_bytes_changed');
  await db.runTransaction(tx=>authority(tx,request));
  return {protocol:'business_cessation_export_read_v1',planId:d.planId,pageNumber:d.pageNumber,contentHash:read.sha256,generation:read.generation,
   bytesBase64:bytes.toString('base64'),mimeType:'application/json',independentArchiveRecorded:true,outsideAppFutureAvailabilityVerified:false,containsPrivateEvidence:false};
 }));
}
