/** Real erasure engine, native adapter and policy. External services only are
 * synthetic; these fixtures never load an environment file or a cloud account. */
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {Timestamp} from 'firebase-admin/firestore';
const h=await vi.hoisted(async()=>{
  const {createFirestoreMock}=await import('./testHelpers/firestoreMock'),fs=createFirestoreMock({enforceReadBeforeWrite:true}),db=fs.db as any;
  db.doc=(path:string)=>{const p=path.split('/');let ref:any=db.collection(p[0]).doc(p[1]);for(let i=2;i<p.length;i+=2)ref=ref.collection(p[i]).doc(p[i+1]);return ref;};
  return {fs,db,mode:'normal',generation:'1',hold:false,user:null as any,metadata:new Map<string,any>(),deletes:[] as any[],lists:[] as string[],
    failDeleteResponse:false,recreate:null as any,withdrawal:vi.fn(),processor:vi.fn(),writer:vi.fn()};
});
vi.mock('../config/firebase',()=>({get db(){return h.db;},FieldValue:h.fs.FieldValue,
  auth:{getUser:async(uid:string)=>{if(h.user?.uid!==uid)throw Object.assign(new Error('absent'),{code:'auth/user-not-found'});return h.user;},
    updateUser:async(uid:string,patch:any)=>{if(h.user?.uid!==uid)throw new Error('subject changed');h.user={...h.user,...patch};return h.user;},
    revokeRefreshTokens:async()=>{},deleteUser:async()=>{h.user=h.recreate;if(h.failDeleteResponse)throw new Error('lost Auth delete response');}},
  storage:{bucket:()=>{const file=(name:string,pin?:{generation:string})=>({name,
    getMetadata:async()=>{const m=h.metadata.get(name);if(!m||pin&&String(m.generation)!==pin.generation)throw Object.assign(new Error('absent'),{code:404});return [m];},
    delete:async(options:any)=>{const m=h.metadata.get(name);if(m&&String(m.generation)!==options.ifGenerationMatch)throw Object.assign(new Error('precondition'),{code:412});
      h.deletes.push({name,...options});h.metadata.delete(name);}});
    return {name:'demo-second.appspot.com',getFiles:async(options:any)=>{h.lists.push(options.prefix);const names=[...h.metadata.keys()].filter(n=>n.startsWith(options.prefix)&&
      (!options.pageToken||n>options.pageToken)).sort(),selected=names.slice(0,options.maxResults??20);
      return [selected.map(name=>file(name)),names.length>selected.length?{pageToken:selected.at(-1)}:{}];},file};}}}));
vi.mock('../config/recoveryControl',async original=>({...await original<typeof import('../config/recoveryControl')>(),
  readFinancialRecoveryControl:async()=>({control:{mode:h.mode,financialEnvironment:'unconfigured',installationId:'erasure-fixture',epoch:'initial',previousEpoch:null},
    installation:{prefix:'fixture',installationId:'erasure-fixture'},generation:h.generation,sha256:'a'.repeat(64)}),createRecoveryEvidence:async()=>{}}));
vi.mock('./privacyRetention',()=>({privacyRetentionDecision:async()=>({blocked:h.hold})}));
vi.mock('../callable/articlePrivacy',()=>({withdrawArticleForAccountErasure:(...args:any[])=>h.withdrawal(...args)}));
import {installFinancialSubjectTransactions} from './financialSubjectTransaction';
import {accountErasureId,accountErasureSourceHash} from './accountErasureContract';
import {createPhase1AccountErasureService,eraseStorageGeneration,erasurePostalFinalizationDisposition} from './accountErasureRuntime';
import {createAccountErasurePolicy} from './accountErasurePolicy';
import {withAccountErasureScope,accountErasureOrdinaryValue} from './accountErasureScope';
import {localAgreementSourceHash} from './localAgreement';
import {createCashAgreement} from './cashMeetup';
import {withDocumentaryProjection,identityProjectionFields} from './documentaryProjection';
installFinancialSubjectTransactions(h.db);
const uid='owner',requestId='native_request_12345678',commandId=accountErasureId(uid,requestId),key='aa'.repeat(32),path='account_erasure_commands/'+commandId;
const policy=()=>createAccountErasurePolicy({processors:(c)=>h.processor(c),apple:async()=>({state:'unknown',proofHash:'b'.repeat(64)}),writerQualification:c=>h.writer(c)});
const request=()=>({auth:{uid,token:{auth_time:Math.floor(Date.now()/1000),firebase:{sign_in_provider:'password'}}},
  data:{capability:'account_erasure_v1',mode:'delete',operation:'request',requestId,commandId,observationKey:key,expectedUid:uid,confirmed:true}});
async function begin(){const s=createPhase1AccountErasureService(policy());await s.handle(request());return s;}
async function finish(s:Awaited<ReturnType<typeof begin>>){let receipt:any;for(let i=0;i<150;i++){
  receipt=await s.advance(commandId);if(['completed','awaiting_review','awaiting_obligations','awaiting_apple_authorization'].includes(receipt.state))return receipt;
}throw new Error('fixture failed to converge');}
async function admitted(){const s=await begin();for(let i=0;i<30;i++){await s.advance(commandId);if(h.fs.getDoc(path)?.fenceCommitted)return {s,command:h.fs.getDoc(path)!};}throw new Error('not admitted');}
function postalFixture(){
  const acceptedAt=Timestamp.fromMillis(Date.now()-500000),uploadedAt=Timestamp.fromMillis(Date.now()-400000),
      shippedAt=Timestamp.fromMillis(Date.now()-300000),receivedAt=Timestamp.fromMillis(Date.now()-200000),completedAt=Timestamp.fromMillis(Date.now()-100000),id='postal-completed';
    const own=`swaps/${id}/photos/${uid}/proof.jpg`,peer=`swaps/${id}/photos/other/proof.jpg`,orphan=`swaps/${id}/photos/${uid}/orphan.jpg`,
      url=(p:string)=>'https://firebasestorage.googleapis.com/v0/b/demo-second.appspot.com/o/'+encodeURIComponent(p)+'?alt=media';
    const object=(path:string,generation:string)=>({path,generation,crc32c:'AAAAAA==',contentType:'image/jpeg',size:100});
    const base:any={initiatorId:uid,receiverId:'other',status:'completed',cashTopUp:null,exchangeMode:'shipping',
      proposalRequestId:'postal-request',proposalRequestHash:'f'.repeat(64),exchangeAgreement:{protocol:'swap_exchange_agreement_v1',scope:'new_proposal',
        exchangeMode:'shipping',sourceHash:'e'.repeat(64)},createdAt:acceptedAt,acceptedAt,completedAt,
      initiatorPhotos:{userId:uid,photos:[url(own)],objects:[object(own,'51')],uploadedAt,isValidated:false},
      receiverPhotos:{userId:'other',photos:[url(peer)],objects:[object(peer,'52')],uploadedAt,isValidated:false},
      initiatorShippedAt:shippedAt,receiverShippedAt:shippedAt,initiatorReceivedAt:receivedAt,receiverReceivedAt:receivedAt};
    const contract={...base,localAgreementWitness:{protocol:'local_agreement_source_v1',installationId:'erasure-fixture',epoch:'initial',ref:'swaps/'+id,
      nativeSourceHash:localAgreementSourceHash('swap','swaps/'+id,base),financialSettlement:'not_asserted'}};
    h.fs.setDoc('swaps/'+id,contract);
    for(const [path,generation]of [[own,'51'],[peer,'52'],[orphan,'53']])h.metadata.set(path,{...object(path,generation),cacheControl:'private, no-store',metadata:{}});
  return {own,peer,orphan,contract,id};
}
beforeEach(()=>{
  h.fs.reset();h.mode='normal';h.generation='1';h.hold=false;h.metadata.clear();h.deletes=[];h.lists=[];h.failDeleteResponse=false;h.recreate=null;
  h.user={uid,disabled:false,metadata:{creationTime:new Date(Date.now()-400*86400_000).toISOString()},tokensValidAfterTime:new Date(0).toISOString(),
    providerData:[{providerId:'password',uid:'fixture@example.invalid'}]};
  h.fs.setDoc('users/'+uid,{uid,displayName:'Old ordinary member',email:'fixture@example.invalid',addresses:[{street:'synthetic'}],preferences:{analyticsConsent:true}});
  h.processor.mockReset();h.processor.mockResolvedValue({verified:true,proofHash:'b'.repeat(64),reason:null});
  h.writer.mockReset();h.writer.mockResolvedValue({verified:true,sourceHash:'c'.repeat(64)});h.withdrawal.mockReset();
  vi.stubEnv('GCLOUD_PROJECT','demo-second');vi.stubEnv('SECONDE_ENV','development');vi.stubEnv('SECONDE_PROJECT_ID','demo-second');
  vi.stubEnv('FINANCIAL_RECOVERY_ENVIRONMENT','unconfigured');
});
afterEach(()=>vi.unstubAllEnvs());
describe('qualified native erasure execution',()=>{
  it('finishes an old used ordinary account and paginates past multiple source pages',async()=>{
    for(let i=0;i<73;i++)h.fs.setDoc('users/'+uid+'/savedSearches/'+String(i).padStart(4,'0'),{query:'private_'+i});
    h.fs.setDoc('favorites/'+uid,{articleIds:['old']});h.fs.setDoc('drafts/old',{userId:uid,title:'private'});
    h.fs.setDoc('notifications/old',{userId:uid,title:'private'});h.fs.setDoc('usernames/old',{uid});
    h.fs.setDoc('messages/old',{senderId:uid,receiverId:'other',chatId:'thread',type:'text',content:'private text',senderName:'old'});
    const s=await begin();expect((await finish(s)).deletionComplete).toBe(true);
    expect(h.user).toBeNull();expect(h.fs.getDoc('users/'+uid)).toBeUndefined();
    expect(h.fs.writeOps.filter(v=>v.method==='delete'&&v.path.startsWith('users/'+uid+'/savedSearches/'))).toHaveLength(73);
    expect(h.fs.getDoc('messages/old')).toMatchObject({content:'',erasedContent:true});
    expect(h.fs.getDoc('favorites/'+uid)).toBeUndefined();expect(h.fs.getDoc('eligibility_profiles/'+uid)?.accountErasureFence.commandId).toBe(commandId);
    expect(h.fs.writeOps.filter(v=>/^(wallets|platform_ledger|withdrawal_requests)\//.test(v.path))).toHaveLength(0);
  });
  it('never upgrades a historical wallet, debt or financial witness through unconfigured',async()=>{
    h.fs.setDoc('wallets/'+uid,{balance:0,pendingBalance:0,heldBalance:0,sellerDebt:0});
    const s=await begin(),result=await finish(s);expect(result.state).toBe('awaiting_review');expect(result.accountAccessClosed).toBe(false);
    expect(h.fs.getDoc('wallets/'+uid)).toEqual({balance:0,pendingBalance:0,heldBalance:0,sellerDebt:0});expect(h.user).not.toBeNull();
  });
  it('does not close Auth while a hold or writer inventory is unqualified',async()=>{
    h.writer.mockResolvedValue({verified:false,sourceHash:'c'.repeat(64)});const s=await begin();expect((await finish(s)).state).toBe('awaiting_review');
    h.writer.mockResolvedValue({verified:true,sourceHash:'c'.repeat(64)});h.hold=true;
    await expect(s.advance(commandId)).rejects.toThrow();expect(h.fs.getDoc(path)?.fenceCommitted).toBe(false);expect(h.user.disabled).toBe(false);
  });
  it('preserves the exact concluded local contract while completing ordinary erasure',async()=>{
    const acceptedAt=Timestamp.fromMillis(Date.now()-200000),completedAt=Timestamp.fromMillis(Date.now()-100000),id='local-order';
    const base:any={buyerId:uid,sellerId:'other',status:'meetup_completed',deliveryType:'meetup',articleId:'article',chatId:'chat',offerMessageId:'offer',
      amount:80,totalAmount:80,sellerPayout:80,shippingCost:0,serviceFee:0,currency:'CAD',paidVia:'cash',meetupSpot:{name:'synthetic'},
      articleSnapshot:{id:'article',title:'exact original'},createdAt:acceptedAt,meetupCompletedAt:completedAt};
    base.cashAgreement={...createCashAgreement(id,base,uid,'other'),acceptedAt};
    const contract={...base,localAgreementWitness:{protocol:'local_agreement_source_v1',installationId:'erasure-fixture',epoch:'initial',ref:'transactions/'+id,
      nativeSourceHash:localAgreementSourceHash('purchase','transactions/'+id,base),financialSettlement:'not_asserted'}};
    h.fs.setDoc('transactions/'+id,contract);
    const offer={status:'expired',transactionId:id,amount:80,meetup:{location:base.meetupSpot},acceptedAt};
    h.fs.setDoc('messages/offer',{senderId:uid,receiverId:'other',chatId:'chat',type:'offer',content:'ordinary personal text',offer});
    const s=await begin(),result=await finish(s);expect(result.deletionComplete).toBe(true);expect(h.fs.getDoc('transactions/'+id)).toEqual(contract);
    expect(h.fs.getDoc('messages/offer')).toMatchObject({content:'',offer});
    const retained=h.fs.writeOps.filter(v=>v.path.startsWith(path+'/retained/'));expect(retained.some(v=>v.data.path==='transactions/'+id)).toBe(true);
    expect(h.fs.writeOps.filter(v=>v.path==='transactions/'+id)).toHaveLength(0);
  });
  it('finishes a new-version member with profile photos, chat photos and orphan uploads in owner-only namespaces',async()=>{
    h.user.metadata.creationTime=new Date(Date.now()-1000).toISOString();
    h.fs.setDoc('eligibility_profiles/'+uid,{dateOfBirth:'1990-01-01',residence:{postalCode:'private'},activityDeclaration:{statement:'private'}});
    h.fs.setDoc('profile_privacy_media/'+uid+'/sources/old',{ownerId:uid,sourceUrl:'synthetic bearer URL',privatePath:'profile_privacy/'+uid+'/op/photo'});
    h.fs.setDoc('chats/chat',{participants:[uid,'other'],participantsInfo:[{userId:uid,userName:'Private owner',userImage:'private'},
      {userId:'other',userName:'Other member',userImage:null}],lastMessage:'private preview',lastMessageType:'image'});
    const main='chat_images/chat/'+uid+'/main.jpg',thumb='chat_images/chat/'+uid+'/thumb.jpg',
      url=(p:string)=>'https://firebasestorage.googleapis.com/v0/b/demo-second.appspot.com/o/'+encodeURIComponent(p)+'?alt=media';
    h.fs.setDoc('messages/photo',{senderId:uid,receiverId:'other',chatId:'chat',type:'image',content:'Photo',
      image:{url:url(main),thumbnail:url(thumb),generation:'11',thumbnailGeneration:'12'}});
    for(const [path,generation] of [[main,'11'],[thumb,'12'],['users/'+uid+'/avatar.jpg','13'],['profile_privacy/'+uid+'/op/photo','14']])
      h.metadata.set(path,{generation,contentType:'image/jpeg',size:100});
    for(let i=0;i<43;i++)h.metadata.set('chat_images/chat/'+uid+'/orphan_'+String(i).padStart(4,'0')+'.jpg',{generation:String(100+i)});
    const foreign='chat_images/chat/other/photo.jpg';h.metadata.set(foreign,{generation:'99'});
    const s=await begin();expect((await finish(s)).deletionComplete).toBe(true);
    expect([...h.metadata.keys()]).toEqual([foreign]);expect(h.fs.getDoc('messages/photo')).not.toHaveProperty('image');
    expect(h.fs.getDoc('chats/chat')).toMatchObject({lastMessage:'',participantsInfo:[{userId:uid,userName:'Utilisateur supprimé',userImage:null},
      {userId:'other',userName:'Other member',userImage:null}]});
    expect(h.fs.getDoc('eligibility_profiles/'+uid)).not.toHaveProperty('dateOfBirth');expect(h.fs.getDoc('eligibility_profiles/'+uid)).not.toHaveProperty('residence');
    expect(h.fs.getDoc('profile_privacy_media/'+uid+'/sources/old')).toBeUndefined();
    expect(h.lists).toContain('chat_images/chat/'+uid+'/');expect(h.lists).not.toContain('chat_images/chat/');
    expect(h.deletes).toHaveLength(47);expect(h.deletes.every(d=>d.ifGenerationMatch&&!d.prefix)).toBe(true);
  });
  it('retains generation-bound private postal proofs and erases only this participant orphan uploads',async()=>{
    const {own,peer,orphan,contract,id}=postalFixture();
    const result=await finish(await begin());expect(result.deletionComplete).toBe(true);
    expect(h.metadata.has(orphan)).toBe(false);expect(h.metadata.has(own)).toBe(true);expect(h.metadata.has(peer)).toBe(true);
    expect(h.deletes).toEqual([{name:orphan,ifGenerationMatch:'53'}]);expect(h.fs.getDoc('swaps/'+id)).toEqual(contract);
    const retained=h.fs.writeOps.filter(v=>v.path.startsWith(path+'/retained/'));
    expect(retained.some(v=>v.data.path===own&&v.data.generation==='51'&&v.data.reviewAt instanceof Timestamp)).toBe(true);
    expect(h.lists).toContain(`swaps/${id}/photos/${uid}/`);expect(h.lists).not.toContain(`swaps/${id}/photos/`);
  });
  it.each(['public_token','changed_generation','missing_object'])('does not complete erasure with a %s postal proof',async failure=>{
    const {own,orphan}=postalFixture(),metadata=h.metadata.get(own);
    if(failure==='public_token')metadata.metadata.firebaseStorageDownloadTokens='synthetic';
    if(failure==='changed_generation')metadata.generation='61';
    if(failure==='missing_object')h.metadata.delete(own);
    const result=await finish(await begin());expect(result.state).toBe('awaiting_review');expect(result.deletionComplete).not.toBe(true);
    expect(h.user).not.toBeNull();expect(h.metadata.has(orphan)).toBe(true);expect(h.deletes).toHaveLength(0);
  });
  it('late finalization protects a referenced private contract generation and qualifies only an owner orphan',async()=>{
    const {own,peer,orphan}=postalFixture(),{command}=await admitted();
    expect(await erasurePostalFinalizationDisposition(command,own,'51')).toBe('retain');
    expect(await erasurePostalFinalizationDisposition(command,orphan,'53')).toBe('erase');
    await eraseStorageGeneration(command,orphan,'53');
    expect(h.metadata.has(own)).toBe(true);expect(h.metadata.has(peer)).toBe(true);expect(h.metadata.has(orphan)).toBe(false);
    await expect(erasurePostalFinalizationDisposition(command,own,'99')).rejects.toThrow();
    await expect(erasurePostalFinalizationDisposition(command,peer,'52')).rejects.toThrow();
    await expect(erasurePostalFinalizationDisposition(command,'swaps/unknown/photos/owner/orphan.jpg','53')).rejects.toThrow();
    h.hold=true;await expect(erasurePostalFinalizationDisposition(command,own,'51')).rejects.toThrow();
    expect(h.deletes).toEqual([{name:orphan,ifGenerationMatch:'53'}]);
  });
  it('does not call unknown or unaccepted contracts concluded just because their status is terminal',async()=>{
    h.fs.setDoc('swaps/old',{initiatorId:uid,receiverId:'other',status:'completed',completedAt:Timestamp.now()});
    expect((await finish(await begin())).state).toBe('awaiting_review');expect(h.user).not.toBeNull();
  });
  it('does not continue after a newly added native hold or changed control generation',async()=>{
    const {s}=await admitted();h.hold=true;await expect(s.advance(commandId)).rejects.toThrow();h.hold=false;h.generation='2';
    await expect(s.advance(commandId)).rejects.toThrow();expect(h.user).not.toBeNull();
  });
  it('resumes a fenced review through erasing before the real native mutation plan',async()=>{
    const {s,command}=await admitted();
    h.fs.setDoc('drafts/resumable',{userId:uid,title:'ordinary content'});
    h.fs.setDoc(path,{...h.fs.getDoc(path),state:'awaiting_review',reasons:['native_execution_requires_review'],
      cursor:{kind:'erasure_cursor_v1',phase:7,lastId:null,mediaPhase:0,pageToken:null}});
    expect((await finish(s)).deletionComplete).toBe(true);
    expect(h.fs.getDoc('drafts/resumable')).toBeUndefined();
    expect(h.fs.getDoc(path)?.inputHash).toBe(command.inputHash);
    expect(h.fs.getDoc(path)?.observationKeyHash).toBe(command.observationKeyHash);
    expect(h.fs.writeOps.some(w=>w.path===path&&w.method==='update'&&w.data.state==='erasing'&&w.data.version===command.version+1)).toBe(true);
  });
  it('rechecks holds and the exact fence/control before any resumed erasure effect',async()=>{
    const {s}=await admitted(),review={...h.fs.getDoc(path),state:'awaiting_review'};
    h.fs.setDoc(path,review);h.fs.setDoc('drafts/resumable',{userId:uid,title:'held content'});h.hold=true;
    await expect(s.advance(commandId)).rejects.toThrow();
    expect(h.fs.getDoc('drafts/resumable')).toBeDefined();expect(h.user).not.toBeNull();
    h.hold=false;h.fs.setDoc(path,review);h.generation='2';
    await expect(s.advance(commandId)).rejects.toThrow();expect(h.fs.getDoc('drafts/resumable')).toBeDefined();
    h.generation='1';h.fs.setDoc(path,review);h.fs.setDoc('eligibility_profiles/'+uid,{accountErasureRequest:{commandId},accountErasureFence:null});
    await expect(s.advance(commandId)).rejects.toThrow();expect(h.fs.getDoc('drafts/resumable')).toBeDefined();
  });
  it('reconciles Auth deletion after its response was lost and never deletes a recreated subject',async()=>{
    const s=await begin();h.failDeleteResponse=true;await expect(finish(s)).rejects.toThrow('lost Auth delete response');
    expect(h.user).toBeNull();h.failDeleteResponse=false;expect((await finish(s)).deletionComplete).toBe(true);
  });
  it('stops a recreated Auth identity before external or profile disposal',async()=>{
    const {s}=await admitted();h.user={...h.user,metadata:{creationTime:new Date(Date.now()-1000).toISOString()}};
    await expect(s.advance(commandId)).rejects.toThrow();expect(h.fs.getDoc('users/'+uid)).toBeDefined();expect(h.deletes).toHaveLength(0);
  });
  it('qualifies one immutable GCS generation and reconciles a lost response with absence',async()=>{
    const {command}=await admitted(),name='drafts/'+uid+'/old/image';h.metadata.set(name,{generation:'11'});
    await eraseStorageGeneration(command,name,'11');await eraseStorageGeneration(command,name,'11');
    expect(h.deletes).toEqual([{name,ifGenerationMatch:'11'}]);
  });
  it('does not delete a replacement GCS generation or a shared chat prefix',async()=>{
    const {command}=await admitted(),name='drafts/'+uid+'/old/image';h.metadata.set(name,{generation:'12'});
    await eraseStorageGeneration(command,name,'11');expect(h.deletes).toHaveLength(0);expect(h.metadata.get(name).generation).toBe('12');
    expect(h.deletes.some(v=>v.prefix||v.name.startsWith('chat_images/'))).toBe(false);
  });
  it('rejects a widened native plan before any write, including financial targets',async()=>{
    const {command}=await admitted();h.fs.setDoc('drafts/a',{userId:uid,title:'ordinary'});const count=h.fs.writeOps.length;
    await expect(withAccountErasureScope({ownerId:uid,commandId:command.commandId,targetPath:'drafts/a',phase:'ordinary'},()=>h.db.runTransaction(async(tx:any)=>{
      tx.delete(h.db.doc('drafts/a'));tx.set(h.db.doc('wallets/'+uid),{balance:0});
    }))).rejects.toThrow();expect(h.fs.writeOps).toHaveLength(count);expect(h.fs.getDoc('drafts/a')).toBeDefined();
  });
  it('closes counterparty Admin SDK contractual effects through the native adapter',async()=>{
    await admitted();vi.stubEnv('FINANCIAL_RECOVERY_ENVIRONMENT','test');const count=h.fs.writeOps.length;
    await expect(h.db.runTransaction(async(tx:any)=>tx.create(h.db.doc('transactions/late'),{buyerId:'other',sellerId:uid,status:'paid'}))).rejects.toThrow();
    expect(h.fs.writeOps).toHaveLength(count);expect(h.fs.getDoc('transactions/late')).toBeUndefined();
  });
  it('never resurrects identity from an old event while the original user source still exists',async()=>{
    await admitted();h.fs.setDoc('users/'+uid,{displayName:'Must not escape',profileImage:'https://example.invalid/image',preferences:{privacy:{showProfilePhoto:true}}});
    h.fs.setDoc('avis/review',{reviewerId:uid,reviewerName:'Old',reviewerImage:'image',text:'ordinary',note:5});
    await withDocumentaryProjection({kind:'identity',ownerId:uid,path:'avis/review'},()=>h.db.runTransaction(async(tx:any)=>{
      const owner=(await tx.get(h.db.doc('users/'+uid))).data(),target=(await tx.get(h.db.doc('avis/review'))).data();
      tx.update(h.db.doc('avis/review'),identityProjectionFields('avis/review',uid,target,owner));
    }));
    expect(h.fs.getDoc('avis/review')).toMatchObject({reviewerName:'Utilisateur',reviewerImage:null,note:5});
  });
  it('does not reconstruct contract offer fields while erasing free text and photos',()=>{
    const source={senderId:uid,type:'offer',content:'private',image:{url:'private'},offer:{status:'accepted',amount:80,meetup:{location:{name:'exact'}}}};
    const after=accountErasureOrdinaryValue('messages/contract',source,uid,true)!;expect(after.offer).toEqual(source.offer);expect(after.content).toBe('');
    expect(after).not.toHaveProperty('image');expect(accountErasureSourceHash(after.offer)).toBe(accountErasureSourceHash(source.offer));
  });
});
