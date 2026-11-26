/** Phase-one erasure adapter. Financial data is observed or preserved, never
 * adopted, settled, rewritten or deleted by this protocol. */
import {Timestamp} from 'firebase-admin/firestore';
import {auth,db,storage} from '../config/firebase';
import {readFinancialRecoveryControl,withFinancialRecoveryIoBudget,createRecoveryEvidence} from '../config/recoveryControl';
import {createAccountErasureService,erasureNativeAuth,sameErasureAuth,type AccountErasureRuntime,type ErasureInspection} from './accountErasure';
import {accountErasureSourceHash,accountErasureOwn} from './accountErasureContract';
import {accountErasureOrdinaryMutationValue,accountErasurePublicProfile,accountErasureEligibilityTombstone,withAccountErasureScope} from './accountErasureScope';
import {assertPrivateAccountSession} from './privateAccountSession';
import {privacyRetentionDecision} from './privacyRetention';
import {localAgreementWitnessMatches} from './localAgreement';
import {financialSubjectGuardRef} from './financialSubjectTransaction';
import {withdrawArticleForAccountErasure} from '../callable/articlePrivacy';
import {disposedArticleEvidence,minimizeDisposedArticleEvidence} from './accountErasureArticleDisposal';
import {storageObjectPath} from './articleMedia';
import {swapProofMetadataMatches,type SwapProofObject} from './swapProofMedia';
type Data=FirebaseFirestore.DocumentData;
type Category='profile'|'favorites'|'saved_searches'|'search_history'|'consents'|'notifications'|'drafts'|'communications'|'reviews'|'articles'|'media'|'contracts'|'support';
export type ErasureDisposition={action:'erase'|'retain'|'review';purpose:string|null;reviewAt:Timestamp|null};
export interface AccountErasurePolicy {
  version:string;
  /** A policy choice is operational authority, never an automatic legal or RPR
   * attestation. Retention needs an identified purpose and a bounded review. */
  disposition:(category:Category,source:Data,command:Data)=>ErasureDisposition;
  /** Inspect actual provider-native deletion results. Historical use must not
   * be represented by a disabled capture key or a client success assertion. */
  processors:(command:Data)=>Promise<{verified:boolean;proofHash:string;reason:string|null}>;
  apple:(command:Data,code:string,idToken:string)=>Promise<{state:'revoked'|'unknown';proofHash:string}>;
  /** Independent, explicit inventory/writer-drain qualification for THIS
   * deployment and control generation; absence never authorizes destruction. */
  writerQualification:(command:Data,phase?:'admission'|'completion')=>Promise<{verified:boolean;sourceHash:string}>;
}
const PAGE=20,jobRef=(id:string)=>db.collection('account_erasure_commands').doc(id),
  profileRef=(uid:string)=>db.collection('eligibility_profiles').doc(uid),
  scanRef=(id:string)=>jobRef(id).collection('internal').doc('inspection');
const fail=():never=>{throw new Error('Native erasure source requires reconciliation.');};
const hash=accountErasureSourceHash;
type Phase={category:Category;collection:string;field?:string;direct?:boolean;op?:'=='|'array-contains';financial?:'wallet'|'contract'|'review'};
const inspectionPhases:readonly Phase[]=[
  {category:'profile',collection:'users',direct:true},{category:'contracts',collection:'wallets',direct:true,financial:'wallet'},
  {category:'profile',collection:'eligibility_profiles',direct:true},
  {category:'contracts',collection:'wallets/{uid}/ledger',financial:'review'},
  {category:'contracts',collection:'transactions',field:'buyerId',financial:'contract'},
  {category:'contracts',collection:'transactions',field:'sellerId',financial:'contract'},
  {category:'contracts',collection:'swaps',field:'initiatorId',financial:'contract'},
  {category:'contracts',collection:'swaps',field:'receiverId',financial:'contract'},
  {category:'contracts',collection:'disputes',field:'buyerId',financial:'review'},
  {category:'contracts',collection:'disputes',field:'sellerId',financial:'review'},
  {category:'contracts',collection:'withdrawal_requests',field:'userId',financial:'review'},
  {category:'support',collection:'support_requests',field:'ownerId'},
  {category:'contracts',collection:'eligibility_audit',field:'ownerId'},
  {category:'articles',collection:'articles',field:'sellerId'},
];
const erasurePhases:readonly Phase[]=[
  {category:'articles',collection:'articles',field:'sellerId'},
  {category:'favorites',collection:'favorites',direct:true},
  {category:'saved_searches',collection:'users/{uid}/savedSearches'},
  {category:'search_history',collection:'users/{uid}/searchHistory'},
  {category:'consents',collection:'users/{uid}/consents'},
  {category:'media',collection:'profile_privacy_media/{uid}/sources'},
  {category:'notifications',collection:'notifications',field:'userId'},
  {category:'drafts',collection:'drafts',field:'userId'},
  {category:'communications',collection:'messages',field:'senderId'},
  {category:'communications',collection:'chats',field:'participants',op:'array-contains'},
  {category:'reviews',collection:'avis',field:'reviewerId'},
  {category:'profile',collection:'usernames',field:'uid'},
  {category:'profile',collection:'shipping_quotes',field:'ownerId'},
  {category:'support',collection:'support_requests',field:'ownerId'},
];
export const ACCOUNT_ERASURE_INVENTORY={protocol:'phase1_account_erasure_inventory_v1',inspection:inspectionPhases,
  erasure:erasurePhases,storage:['users/{uid}/','products/{uid}/','drafts/{uid}/','avatars/{uid}',
    'article_privacy_media_by_native_reference','chat_media_by_native_reference_and_generation',
    'swap_postal_media_by_native_reference_and_generation','swap_postal_owner_orphans_by_qualified_parent'],
  retainedPrivateContracts:'native_local_witness_exact',excludedProcessors:'policy_and_provider_receipts',
  financialSettlement:'not_asserted'} as const;
export const ACCOUNT_ERASURE_INVENTORY_HASH=hash(ACCOUNT_ERASURE_INVENTORY);
async function page(tx:FirebaseFirestore.Transaction,phase:Phase,uid:string,lastId:string|null){
  const c=db.collection(phase.collection.replace('{uid}',uid));
  if(phase.direct)return {rows:[await tx.get(c.doc(uid))],more:false};
  let q:FirebaseFirestore.Query=phase.field?c.where(phase.field,phase.op??'==',uid):c;
  q=q.orderBy('__name__').limit(PAGE+1);if(lastId)q=q.startAfter(lastId);
  const result=await tx.get(q);return {rows:result.docs.slice(0,PAGE),more:result.size>PAGE};
}
async function causal(tx:FirebaseFirestore.Transaction,uid:string){
  const refs=[financialSubjectGuardRef(db,uid),db.doc('privacy_preservation_catalogues/native_support_v1'),
    db.doc('privacy_retention_guards/'+uid),db.doc('financial_subject_catalogue_unknown/native_v1')];
  const rows=await Promise.all(refs.map(r=>tx.get(r)));
  return hash(rows.map((s,i)=>({path:refs[i].path,value:s.data()??null})));
}
function disposition(policy:AccountErasurePolicy,category:Category,source:Data,command:Data){
  const d=policy.disposition(category,source,command);
  if(!d||!['erase','retain','review'].includes(d.action)||d.action==='retain'&&
    (typeof d.purpose!=='string'||!d.purpose||!(d.reviewAt instanceof Timestamp)||d.reviewAt.toMillis()<=Date.now()))return fail();
  return d;
}
async function nativeWork(tx:FirebaseFirestore.Transaction,initial:Data,needFence=true){
  const [snapshot,profile]=await Promise.all([tx.get(jobRef(initial.commandId)),tx.get(profileRef(initial.ownerId))]),job=snapshot.data();
  if(!job||job.inputHash!==initial.inputHash||job.ownerId!==initial.ownerId||
    profile.data()?.accountErasureRequest?.commandId!==initial.commandId||
    needFence&&(job.fenceCommitted!==true||profile.data()?.accountErasureFence?.commandId!==initial.commandId)||
    (await privacyRetentionDecision(tx,initial.ownerId)).blocked)return fail();
  return job;
}
export function createPhase1AccountErasureRuntime(policy:AccountErasurePolicy):AccountErasureRuntime {
  if(!/^[A-Za-z0-9_.:-]{1,128}$/.test(policy.version))return fail();
  const control=()=>withFinancialRecoveryIoBudget(async()=>{
    const q=await readFinancialRecoveryControl();
    if(q.control.mode!=='normal'||q.control.previousEpoch!==null||q.control.financialEnvironment!=='unconfigured')return fail();
    return {installationId:q.control.installationId,epoch:q.control.epoch,generation:q.generation,sourceHash:q.sha256};
  });
  const assertControl=async(command:Data)=>{if(!sameErasureControl(await control(),command.control))return fail();};
  const assertWork=assertAccountErasureContinuation;
  async function inspect(command:Data):Promise<ErasureInspection>{
    const q=await control(),writers=await policy.writerQualification(command);
    if(!sameErasureControl(q,command.control)||!writers.verified)return {state:'awaiting_review',reasons:['writer_inventory_requires_review'],
      cursor:{phase:0,lastId:null},sourceHash:writers.sourceHash,policyVersion:policy.version};
    const native=await auth.getUser(command.ownerId);
    if(native.disabled||!sameErasureAuth(erasureNativeAuth(native),command.authSource))return fail();
    return db.runTransaction(async tx=>{
      await nativeWork(tx,command,false);
      const scanSnap=await tx.get(scanRef(command.commandId)),prior=scanSnap.data(),causalHash=await causal(tx,command.ownerId);
      const scan=prior?.causalHash===causalHash&&prior.policyVersion===policy.version?prior:
        {phase:0,lastId:null,root:hash(['account_erasure_inventory_v1',command.commandId,causalHash]),causalHash,policyVersion:policy.version,reasons:[],obligations:false};
      if(scan.phase>=inspectionPhases.length)return {state:scan.obligations?'awaiting_obligations':scan.reasons.length?'awaiting_review':'ready',
        reasons:scan.reasons,cursor:{phase:scan.phase,lastId:null},sourceHash:scan.root,policyVersion:policy.version};
      const phase=inspectionPhases[scan.phase],result=await page(tx,phase,command.ownerId,scan.lastId),reasons=new Set<string>(scan.reasons),entries:Data[]=[],retentions:Data[]=[];
      let obligations=scan.obligations;
      for(const row of result.rows){if(!row.exists)continue;const source=row.data()!;
        entries.push({path:row.ref.path,sourceHash:hash(source),revision:row.updateTime??null});
        if(phase.collection==='users'&&['stripeAccountId','stripeAccountCreationStartedAt'].some(k=>source[k]!=null))reasons.add('financial_identity_requires_reconciliation');
        if(phase.collection==='eligibility_profiles'&&(['bankOperation','connectOperation'].some(k=>accountErasureOwn(source,k))||
          source.accountClosure?.exceptionalRestitution!=null||source.accountClosure?.requiresOperator===true))reasons.add('financial_account_operation_requires_reconciliation');
        if(phase.collection==='eligibility_profiles'&&accountErasureOwn(source,'accountSecurityBarrier'))reasons.add('security_evidence_requires_targeted_review');
        if(phase.financial==='wallet'||phase.financial==='review')reasons.add('historical_financial_source_requires_reconciliation');
        if(phase.financial==='contract'){
          const domain=phase.collection==='transactions'?'purchase':'swap';
          if(!localAgreementWitnessMatches(domain,row.ref.path,source,q))reasons.add('historical_contract_requires_reconciliation');
          else if(!(domain==='purchase'?['meetup_completed','cancelled']:['completed','cancelled','declined']).includes(source.status))obligations=true;
          else {
            const d=disposition(policy,'contracts',source,command);
            if(d.action!=='retain')reasons.add('contract_retention_requires_review');
            else retentions.push({path:row.ref.path,sourceHash:hash(source),purpose:d.purpose,reviewAt:d.reviewAt});
          }
        }
        if(phase.collection==='articles'&&accountErasureOwn(source,'financialRecoveryWitness'))reasons.add('historical_article_financial_source_requires_reconciliation');
        if(phase.collection==='eligibility_audit'&&source.action==='account_forfait_operation')reasons.add('historical_forfait_requires_reconciliation');
        if(phase.category==='support'){
          const d=disposition(policy,'support',source,command);if(d.action==='review')reasons.add('support_retention_requires_review');
          else if(d.action==='retain')retentions.push({path:row.ref.path,sourceHash:hash(source),purpose:d.purpose,reviewAt:d.reviewAt});
        }
      }
      const next={...scan,phase:result.more?scan.phase:scan.phase+1,lastId:result.more?result.rows.at(-1)!.id:null,
        root:hash([scan.root,entries]),reasons:[...reasons].sort(),obligations,updatedAt:Timestamp.now()};
      // The exact original contracts remain in their native private sources.
      // The disposition record stores references/hashes and a bounded review,
      // rather than duplicating all ordinary deleted personal data.
      for(const r of retentions)tx.set(jobRef(command.commandId).collection('retained').doc(hash(r.path)),
        {protocol:'account_erasure_retained_source_v1',...r,policyVersion:policy.version,recordedAt:Timestamp.now()});
      tx.set(scanRef(command.commandId),next);
      const finished=next.phase>=inspectionPhases.length;
      return {state:!finished?'more':obligations?'awaiting_obligations':next.reasons.length?'awaiting_review':'ready',
        reasons:next.reasons,cursor:{phase:next.phase,lastId:next.lastId},sourceHash:next.root,policyVersion:policy.version};
    });
  }
  async function admit(command:Data,inspection:ErasureInspection):Promise<'admitted'|'changed'>{
    await assertControl(command);
    return withAccountErasureScope({ownerId:command.ownerId,commandId:command.commandId,targetPath:'users/'+command.ownerId,phase:'admit'},()=>db.runTransaction(async tx=>{
      const live=await nativeWork(tx,command,false),scan=(await tx.get(scanRef(command.commandId))).data(),
        profile=(await tx.get(profileRef(command.ownerId))).data(),user=(await tx.get(db.doc('users/'+command.ownerId))).data(),currentCausal=await causal(tx,command.ownerId);
      if(live.version!==command.version||scan?.root!==inspection.sourceHash||scan?.causalHash!==currentCausal||scan?.phase!==inspectionPhases.length||
        scan.reasons.length||scan.obligations||profile?.accountErasureFence!==undefined)return 'changed';
      const native=await auth.getUser(command.ownerId);
      if(native.disabled||!sameErasureAuth(erasureNativeAuth(native),command.authSource))return fail();
      const now=Timestamp.now();
      tx.update(profileRef(command.ownerId),{accountErasureFence:{protocol:'account_erasure_fence_v1',ownerId:command.ownerId,commandId:command.commandId,recordedAt:now}});
      if(user)tx.set(db.doc('users/'+command.ownerId),accountErasurePublicProfile(user,command.ownerId));
      tx.update(jobRef(command.commandId),{fenceCommitted:true,state:'erasing',version:live.version+1,updatedAt:now});
      return 'admitted';
    }));
  }
  async function retain(command:Data,path:string,source:Data,d:ErasureDisposition){
    await db.runTransaction(async tx=>{await nativeWork(tx,command);const actual=(await tx.get(db.doc(path))).data();
      if(hash(actual??null)!==hash(source))return fail();
      tx.set(jobRef(command.commandId).collection('retained').doc(hash(path)),{protocol:'account_erasure_retained_source_v1',
        path,sourceHash:hash(source),purpose:d.purpose,reviewAt:d.reviewAt,policyVersion:policy.version,recordedAt:Timestamp.now()});});
  }
  async function eraseDocument(command:Data,row:FirebaseFirestore.DocumentSnapshot){
    await withAccountErasureScope({ownerId:command.ownerId,commandId:command.commandId,targetPath:row.ref.path,phase:'ordinary'},()=>db.runTransaction(async tx=>{
      await nativeWork(tx,command);const current=await tx.get(row.ref);if(!current.exists)return;
      const expected=await accountErasureOrdinaryMutationValue(row.ref.path,current.data()!,command.ownerId,
        async path=>(await tx.get(db.doc(path))).data(),command.control);
      if(expected===undefined)tx.delete(row.ref);else tx.set(row.ref,expected);
    }));
  }
  async function step(command:Data){
    await assertWork(command);
    const cursor:Data=command.cursor?.kind==='erasure_cursor_v1'?command.cursor:{kind:'erasure_cursor_v1',phase:0,lastId:null,mediaPhase:0,pageToken:null};
    const result=(state:any,next=cursor,completedSteps=3)=>({state,cursor:next,completedSteps,sourceHash:hash(next)});
    if(cursor.phase<erasurePhases.length){
      const phase=erasurePhases[cursor.phase],rows=await db.runTransaction(async tx=>{await nativeWork(tx,command);return page(tx,phase,command.ownerId,cursor.lastId);});
      for(const row of rows.rows){if(!row.exists)continue;const source=row.data()!,d=disposition(policy,phase.category,source,command);
        if(d.action==='review')return result('awaiting_review');
        if(d.action==='retain'){await retain(command,row.ref.path,source,d);continue;}
        if(phase.category==='articles'){
          const evidenceRef=db.doc('article_privacy_evidence/'+row.id);
          if(disposedArticleEvidence((await evidenceRef.get()).data()))continue;
          const withdrawal=await withdrawArticleForAccountErasure(command.commandId,row.id);
          if(!withdrawal.publicWithdrawalComplete)return result('awaiting_review');
          const evidence=(await evidenceRef.get()).data()!;
          const contracts=await db.runTransaction(async tx=>{
            await nativeWork(tx,command);
            const [orders,swaps]=await Promise.all([tx.get(db.collection('transactions').where('articleId','==',row.id).limit(101)),
              tx.get(db.collection('swaps').where('articleIds','array-contains',row.id).limit(101))]);
            if(orders.size>100||swaps.size>100)return null;
            return [...orders.docs.map(d=>d.data()),...swaps.docs.filter(d=>d.data().acceptedAt!=null).map(d=>d.data())];
          });
          if(contracts===null)return result('awaiting_review');
          const mediaDisposition=disposition(policy,'media',{...evidence,retainedContracts:contracts},command);
          if(mediaDisposition.action==='review')return result('awaiting_review');
          // Public originals have already been copied and revoked by the
          // generation-qualified privacy protocol. Retaining a contract keeps
          // its private copy only, not a publicly accessible original.
          for(const media of evidence.media){
            if(media.state!=='revoked')return result('awaiting_review');
            if(media.sourcePath&&media.sourceGeneration)await eraseStorageGeneration(command,media.sourcePath,media.sourceGeneration,assertWork);
            if(mediaDisposition.action==='erase'&&media.privatePath&&media.privateGeneration)
              await eraseStorageGeneration(command,media.privatePath,media.privateGeneration,assertWork);
          }
          if(mediaDisposition.action==='retain'){await retain(command,evidenceRef.path,evidence,mediaDisposition);continue;}
          const captured=await evidenceRef.collection('public_projection_evidence').orderBy('__name__').limit(PAGE).get();
          for(const projection of captured.docs)await withAccountErasureScope({ownerId:command.ownerId,commandId:command.commandId,
            targetPath:projection.ref.path,phase:'article_dispose'},()=>db.runTransaction(async tx=>{
              await nativeWork(tx,command);if((await tx.get(projection.ref)).exists)tx.delete(projection.ref);
            }));
          if(captured.size===PAGE)return result('more');
          await withAccountErasureScope({ownerId:command.ownerId,commandId:command.commandId,targetPath:evidenceRef.path,phase:'article_dispose'},()=>db.runTransaction(async tx=>{
            await nativeWork(tx,command);const current=(await tx.get(evidenceRef)).data()!;
            if(disposedArticleEvidence(current))return;
            tx.set(evidenceRef,minimizeDisposedArticleEvidence(current,command.commandId,Timestamp.now()));
          }));
          continue;
        }
        if(phase.collection==='messages'&&source.image){
          const links=[source.image.url,source.image.thumbnail].filter((v:unknown):v is string=>typeof v==='string'&&!!v);
          for(const link of [...new Set<string>(links)]){
            const target=storageObjectPath(link,storage.bucket().name);
            if(!target)continue; // Remove the app's reference; never fetch or
            // claim control of an arbitrary external host supplied as content.
            if(!target.startsWith('chat_images/'+source.chatId+'/')&&!['users','products','drafts'].some(root=>target.startsWith(root+'/'+command.ownerId+'/')))
              return result('awaiting_review');
            const file=storage.bucket().file(target);let metadata;
            try{[metadata]=await file.getMetadata();}catch(error){if((error as any)?.code!==404)throw error;}
            if(!metadata)continue;
            const generation=String(metadata.generation??'');if(!/^[1-9]\d{0,24}$/.test(generation))return fail();
            const scopedChat=target.startsWith('chat_images/'+source.chatId+'/'+command.ownerId+'/'),
              scopedOwner=['users','products','drafts'].some(root=>target.startsWith(root+'/'+command.ownerId+'/'));
            if(scopedChat||scopedOwner){
              const declared=link===source.image.url?source.image.generation:source.image.thumbnailGeneration;
              if(scopedChat&&(typeof declared!=='string'||!/^[1-9]\d{0,31}$/.test(declared)))return result('awaiting_review');
              await eraseStorageGeneration(command,target,declared??generation,assertWork);continue;
            }
            // A different uploader's new UID namespace is not owned by the
            // requesting subject. Only this sender's reference is removed.
            if(/^chat_images\/[^/]+\/[^/]+\/[^/]+$/.test(target))continue;
            const reviewRef=jobRef(command.commandId).collection('media_reviews').doc(hash([row.ref.path,target,generation]));
            await db.runTransaction(async tx=>{await nativeWork(tx,command);const current=await tx.get(row.ref),review=await tx.get(reviewRef);
              if(hash(current.data()??null)!==hash(source))return fail();
              if(!review.exists)tx.create(reviewRef,{protocol:'account_erasure_chat_media_review_v1',ownerId:command.ownerId,commandId:command.commandId,
                sourceMessageId:row.id,sourceChatId:source.chatId,sourceMessageHash:hash(source),sourceRevision:row.updateTime??null,
                path:target,generation,crc32c:metadata!.crc32c??null,size:Number(metadata!.size),contentType:metadata!.contentType??null,
                nativeCreatedAt:metadata!.timeCreated??null,state:'review_required',createdAt:Timestamp.now(),
                reviewDueAt:Timestamp.fromMillis(Date.now()+30*86400_000),reason:'legacy_shared_media_uploader_not_natively_recorded'});
            });
          }
        }
        await eraseDocument(command,row);
      }
      return result('more',{...cursor,phase:rows.more?cursor.phase:cursor.phase+1,lastId:rows.more?rows.rows.at(-1)!.id:null});
    }
    // UID folders are not a shared chat namespace. Every observed object gets
    // its own immutable generation intention before a delete request.
    const prefixes=[`users/${command.ownerId}/`,`products/${command.ownerId}/`,`drafts/${command.ownerId}/`,`profile_privacy/${command.ownerId}/`];
    if(cursor.mediaPhase<prefixes.length){
      const [files,next]=await storage.bucket().getFiles({prefix:prefixes[cursor.mediaPhase],maxResults:PAGE,autoPaginate:false,
        ...(cursor.pageToken?{pageToken:cursor.pageToken}:{})});
      for(const file of files){
        const [m]=await file.getMetadata(),gen=String(m.generation??'');if(!/^[1-9]\d{0,24}$/.test(gen))return fail();
        const d=disposition(policy,'media',{path:file.name,generation:gen,createdAt:m.timeCreated},command);
        if(d.action!=='erase')return result('awaiting_review');
        await eraseStorageGeneration(command,file.name,gen,assertWork);
      }
      return result('more',{...cursor,mediaPhase:next?.pageToken?cursor.mediaPhase:cursor.mediaPhase+1,pageToken:next?.pageToken??null},4);
    }
    // Contract proofs remain private evidence under the existing local
    // contract policy. Only this owner's unreferenced objects are disposed.
    if(!cursor.swapMediaDone){
      const side=cursor.swapMediaSide===1?1:0,field=side===0?'initiatorId':'receiverId';
      let swapId=typeof cursor.swapMediaCurrentId==='string'?cursor.swapMediaCurrentId:null;
      if(!swapId){
        const row=await db.runTransaction(async tx=>{await nativeWork(tx,command);
          let query=db.collection('swaps').where(field,'==',command.ownerId).orderBy('__name__').limit(1);
          if(cursor.swapMediaAfterId)query=query.startAfter(cursor.swapMediaAfterId);
          return (await tx.get(query)).docs[0];});
        if(!row)return result('more',{...cursor,swapMediaSide:1,swapMediaAfterId:null,swapMediaDone:side===1},4);
        swapId=row.id;
      }
      const parentPath='swaps/'+swapId,parent=await db.runTransaction(async tx=>{await nativeWork(tx,command);
        return (await tx.get(db.doc(parentPath))).data();});
      if(!parent||parent[field]!==command.ownerId||!localAgreementWitnessMatches('swap',parentPath,parent,command.control))return fail();
      const d=disposition(policy,'contracts',parent,command);if(d.action!=='retain')return result('awaiting_review');
      const objects:SwapProofObject[]=parent[side===0?'initiatorPhotos':'receiverPhotos']?.objects??[];
      for(const object of objects){
        let metadata;try{[metadata]=await storage.bucket().file(object.path,{generation:object.generation}).getMetadata();}
        catch(error){if(Number((error as any)?.code)!==404)throw error;}
        if(!metadata||!swapProofMetadataMatches(metadata,object))return result('awaiting_review');
        await db.runTransaction(async tx=>{await nativeWork(tx,command);const live=(await tx.get(db.doc(parentPath))).data();
          if(hash(live??null)!==hash(parent))return fail();
          tx.set(jobRef(command.commandId).collection('retained').doc(hash(['storage',object.path,object.generation])),{
            protocol:'account_erasure_retained_media_v1',path:object.path,generation:object.generation,parentPath,parentSourceHash:hash(parent),
            sourceHash:hash(object),purpose:d.purpose,reviewAt:d.reviewAt,policyVersion:policy.version,recordedAt:Timestamp.now()});
        });
      }
      const prefix=`swaps/${swapId}/photos/${command.ownerId}/`,[files,next]=await storage.bucket().getFiles({prefix,maxResults:PAGE,autoPaginate:false,
        ...(cursor.swapMediaPageToken?{pageToken:cursor.swapMediaPageToken}:{})});
      for(const file of files){
        if(!file.name.startsWith(prefix)||file.name.slice(prefix.length).includes('/'))return fail();
        const [metadata]=await file.getMetadata(),generation=String(metadata.generation??''),proof=objects.find(object=>object.path===file.name);
        if(proof){if(!swapProofMetadataMatches(metadata,proof))return result('awaiting_review');continue;}
        if(!/^[1-9]\d{0,24}$/.test(generation))return fail();
        await eraseStorageGeneration(command,file.name,generation,assertWork);
      }
      return result('more',{...cursor,swapMediaSide:side,swapMediaCurrentId:next?.pageToken?swapId:null,
        swapMediaPageToken:next?.pageToken??null,swapMediaAfterId:next?.pageToken?cursor.swapMediaAfterId??null:swapId},4);
    }
    if(!cursor.chatMediaDone){
      const chatId=typeof cursor.chatMediaCurrentId==='string'?cursor.chatMediaCurrentId:null;
      let currentId=chatId;
      if(!currentId){
        const chat=await db.runTransaction(async tx=>{await nativeWork(tx,command);
          let q=db.collection('chats').where('participants','array-contains',command.ownerId).orderBy('__name__').limit(1);
          if(cursor.chatMediaAfterId)q=q.startAfter(cursor.chatMediaAfterId);
          return (await tx.get(q)).docs[0];});
        if(!chat)return result('more',{...cursor,chatMediaDone:true},4);
        currentId=chat.id;
      }
      const prefix=`chat_images/${currentId}/${command.ownerId}/`;
      const [files,next]=await storage.bucket().getFiles({prefix,maxResults:PAGE,autoPaginate:false,
        ...(cursor.chatMediaPageToken?{pageToken:cursor.chatMediaPageToken}:{})});
      for(const file of files){const [m]=await file.getMetadata();await eraseStorageGeneration(command,file.name,String(m.generation),assertWork);}
      return result('more',{...cursor,chatMediaCurrentId:next?.pageToken?currentId:null,chatMediaPageToken:next?.pageToken??null,
        chatMediaAfterId:next?.pageToken?cursor.chatMediaAfterId??null:currentId},4);
    }
    if(!cursor.legacyAvatarDone){
      const file=storage.bucket().file(`avatars/${command.ownerId}`);let metadata;
      try{[metadata]=await file.getMetadata();}catch(error){if((error as any)?.code!==404)throw error;}
      if(metadata)await eraseStorageGeneration(command,file.name,String(metadata.generation),assertWork);
      return result('more',{...cursor,legacyAvatarDone:true},4);
    }
    const mediaReviews=await jobRef(command.commandId).collection('media_reviews').where('state','in',['review_required','erase_prepared']).limit(1).get();
    if(!mediaReviews.empty)return result('awaiting_review',cursor,5);
    const processors=await policy.processors(command);
    if(!processors.verified)return {...result('awaiting_review',cursor,5),reasons:[processors.reason??'processor_confirmation_pending']};
    const completionWriters=await policy.writerQualification(command,'completion');
    if(!completionWriters.verified)return {...result('awaiting_review',cursor,5),reasons:['completion_writer_receipt_pending']};
    // Disable, revoke and delete each has its own durable native intention.
    // A retry reconciles actual Auth absence; it never recreates the subject.
    const live=(await jobRef(command.commandId).get()).data()!;
    if(live.authDeletion?.state!=='prepared'&&live.authDeletion?.state!=='absent'){
      await db.runTransaction(async tx=>{const j=await nativeWork(tx,command);tx.update(jobRef(command.commandId),{
        authDeletion:{state:'prepared',subject:j.authSource,preparedAt:Timestamp.now(),processorProofHash:processors.proofHash}});});
    }
    const prepared=(await jobRef(command.commandId).get()).data()!;await assertWork(prepared);
    let native;try{native=await auth.getUser(command.ownerId);}catch(error){if((error as any)?.code!=='auth/user-not-found')throw error;}
    if(native){
      if(!sameErasureAuth(erasureNativeAuth(native),command.authSource))return fail();
      try{
        const disabled=await auth.updateUser(command.ownerId,{disabled:true});
        if(!sameErasureAuth(erasureNativeAuth(disabled),command.authSource))return fail();
        await assertWork(prepared);await auth.revokeRefreshTokens(command.ownerId);
        await assertWork(prepared);await auth.deleteUser(command.ownerId);
      }catch(error){if((error as any)?.code!=='auth/user-not-found')throw error;}
    }
    try{await auth.getUser(command.ownerId);return result('auth_deletion_pending',cursor,6);}
    catch(error){if((error as any)?.code!=='auth/user-not-found')throw error;}
    await db.runTransaction(async tx=>{await nativeWork(tx,command);tx.update(jobRef(command.commandId),{
      authAbsenceVerified:true,authDeletion:{...prepared.authDeletion,state:'absent',observedAt:Timestamp.now()}});});
    await withAccountErasureScope({ownerId:command.ownerId,commandId:command.commandId,targetPath:'users/'+command.ownerId,phase:'profile_delete'},()=>db.runTransaction(async tx=>{
      await nativeWork(tx,command);const user=await tx.get(db.doc('users/'+command.ownerId));if(user.exists)tx.delete(user.ref);
    }));
    await withAccountErasureScope({ownerId:command.ownerId,commandId:command.commandId,targetPath:'eligibility_profiles/'+command.ownerId,phase:'profile_minimize'},()=>db.runTransaction(async tx=>{
      await nativeWork(tx,command);const profile=(await tx.get(profileRef(command.ownerId))).data();if(!profile)return fail();
      tx.set(profileRef(command.ownerId),accountErasureEligibilityTombstone(profile,command.ownerId));
    }));
    // Qualification includes absence of escaped writers, current processor
    // results and the bounded retention schedule. Closed access alone cannot
    // reach this postcondition.
    const finalWriters=await policy.writerQualification(command,'completion');
    if(!finalWriters.verified)return result('awaiting_review',cursor,6);
    return {...result('completed',cursor,7),allRequiredEffectsVerified:true as const,authAbsenceVerified:true as const};
  }
  return {db,auth,assertOwner:(request,tx)=>assertPrivateAccountSession(request,tx),control,inspect,admit,step,
    authorizeApple:policy.apple,policyVersion:policy.version};
}
function sameErasureControl(a:Data,b:Data){return !!b&&a.installationId===b.installationId&&a.epoch===b.epoch&&a.generation===b.generation&&a.sourceHash===b.sourceHash;}
export async function assertAccountErasureContinuation(command:Data){
  await withFinancialRecoveryIoBudget(async()=>{
    const q=await readFinancialRecoveryControl();
    if(q.control.mode!=='normal'||q.control.previousEpoch!==null||q.control.financialEnvironment!=='unconfigured'||
      !sameErasureControl({installationId:q.control.installationId,epoch:q.control.epoch,generation:q.generation,sourceHash:q.sha256},command.control))return fail();
  });
  await db.runTransaction(tx=>nativeWork(tx,command));
  try{const current=await auth.getUser(command.ownerId);if(!sameErasureAuth(erasureNativeAuth(current),command.authSource))return fail();}
  catch(error){if((error as any)?.code!=='auth/user-not-found'||command.authDeletion?.state!=='prepared'&&command.authDeletion?.state!=='absent')throw error;}
}
/** A late postal event cannot delete an immutable proof of the retained
 * contract. An orphan is deletable only under its exact native owner/parent. */
export async function erasurePostalFinalizationDisposition(command:Data,path:string,generation:string):Promise<'retain'|'erase'> {
  const parts=path.split('/');if(!/^[1-9]\d{0,24}$/.test(generation)||parts.length!==5||parts[0]!=='swaps'||parts[2]!=='photos'||parts[3]!==command.ownerId||
    !/^[A-Za-z0-9_-]{1,200}$/.test(parts[1])||!parts[4]||['.','..'].includes(parts[4]))return fail();
  await assertAccountErasureContinuation(command);
  const parent=await db.runTransaction(async tx=>{await nativeWork(tx,command);return (await tx.get(db.doc('swaps/'+parts[1]))).data();});
  if(!parent||![parent.initiatorId,parent.receiverId].includes(command.ownerId)||
    !['completed','cancelled','declined'].includes(parent.status)||!localAgreementWitnessMatches('swap','swaps/'+parts[1],parent,command.control))return fail();
  const objects:SwapProofObject[]=parent[parent.initiatorId===command.ownerId?'initiatorPhotos':'receiverPhotos']?.objects??[],proof=objects.find(v=>v.path===path);
  if(!proof)return 'erase';
  if(proof.generation!==generation)return fail();
  const [metadata]=await storage.bucket().file(path,{generation}).getMetadata();if(!swapProofMetadataMatches(metadata,proof))return fail();
  return 'retain';
}
export async function eraseStorageGeneration(command:Data,path:string,generation:string,assertWork=assertAccountErasureContinuation){
  const ref=jobRef(command.commandId).collection('effects').doc(hash(['storage',path,generation])),bucket=storage.bucket(),
    file=bucket.file(path,{generation});
  await assertWork(command);
  const intent=await db.runTransaction(async tx=>{await nativeWork(tx,command);const old=(await tx.get(ref)).data();
    const identity={protocol:'account_erasure_storage_effect_v1',commandId:command.commandId,ownerId:command.ownerId,path,generation};
    if(old){if(hash(old.identity)!==hash(identity))return fail();return old;}
    const value={identity,state:'prepared',preparedAt:Timestamp.now()};tx.create(ref,value);return value;});
  if(intent.state==='absent')return;
  await withFinancialRecoveryIoBudget(async()=>{
    const c=await readFinancialRecoveryControl();
    if(!sameErasureControl({installationId:c.control.installationId,epoch:c.control.epoch,generation:c.generation,sourceHash:c.sha256},command.control))return fail();
    await createRecoveryEvidence(`${c.installation.prefix}/permits/${c.control.epoch}/account-erasure/${command.commandId}/${ref.id}.json`,
      {protocol:'account_erasure_exact_generation_intent_v1',commandId:command.commandId,inputHash:command.inputHash,targetHash:hash([path,generation]),
        epoch:c.control.epoch,financialSettlement:'not_asserted'},c.installation);
  });
  let metadata;try{[metadata]=await file.getMetadata();}catch(error){if((error as any)?.code!==404)throw error;}
  if(metadata){
    if(String(metadata.generation)!==generation)return fail();
    await assertWork(command);await file.delete({ifGenerationMatch:generation});
  }
  try{await file.getMetadata();return fail();}catch(error){if((error as any)?.code!==404)throw error;}
  await db.runTransaction(async tx=>{await nativeWork(tx,command);const old=(await tx.get(ref)).data();if(hash(old?.identity)!==hash(intent.identity))return fail();
    tx.update(ref,{state:'absent',observedAt:Timestamp.now()});});
}
export const createPhase1AccountErasureService=(policy:AccountErasurePolicy)=>createAccountErasureService(createPhase1AccountErasureRuntime(policy));
