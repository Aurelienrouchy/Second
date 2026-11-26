/** A native erasure capability is bound to one existing owner command and one
 * exact target. It cannot settle, remove or adopt a financial/contract source. */
import {AsyncLocalStorage} from 'node:async_hooks';
import {isDeepStrictEqual as same} from 'node:util';
import {Timestamp} from 'firebase-admin/firestore';
import {accountErasureId,accountErasureOwn,accountErasureSourceHash,hasAccountErasureFence} from './accountErasureContract';
import {readFinancialRecoveryControl,withFinancialRecoveryIoBudget} from '../config/recoveryControl';
import {minimizeDisposedArticleEvidence} from './accountErasureArticleDisposal';
import {localAgreementWitnessMatches} from './localAgreement';
type Data=FirebaseFirestore.DocumentData;
type Write={method:'create'|'set'|'update'|'delete';args:any[]};
export type AccountErasureScope={ownerId:string;commandId:string;targetPath:string;phase:'admit'|'ordinary'|'profile_delete'|'article_dispose'|'profile_minimize'};
const scope=new AsyncLocalStorage<AccountErasureScope>();
const fail=():never=>{throw new Error('Account erasure native intention, source, hold or target unqualified.');};
export const activeAccountErasureScope=()=>scope.getStore()??null;
export function withAccountErasureScope<T>(s:AccountErasureScope,fn:()=>Promise<T>):Promise<T>{
  if(scope.getStore()||typeof s.ownerId!=='string'||!s.ownerId||s.ownerId.includes('/')||!/^[a-f0-9]{64}$/.test(s.commandId)||
    !/^[^/]+\/[^/]+(?:\/[^/]+\/[^/]+)*$/.test(s.targetPath))return fail();
  return withFinancialRecoveryIoBudget(()=>scope.run(s,fn));
}
export function accountErasureOrdinaryValue(path:string,source:Data,uid:string,retainContractOffer=false):Data|undefined {
  const p=path.split('/'),root=p[0],own=(field:string)=>source[field]===uid;
  if(root==='users'&&p[1]===uid&&p.length===4&&['savedSearches','searchHistory','consents'].includes(p[2]))return undefined;
  if(root==='profile_privacy_media'&&p[1]===uid&&p.length===4&&p[2]==='sources'&&own('ownerId'))return undefined;
  if(root==='favorites'&&p[1]===uid&&p.length===2||['notifications','drafts'].includes(root)&&own('userId')||
    root==='usernames'&&own('uid')||root==='shipping_quotes'&&own('ownerId'))return undefined;
  if(root==='support_requests'&&p.length===2&&own('ownerId')&&['closed','resolved'].includes(source.status)&&
    (source.closedAt instanceof Timestamp||source.resolvedAt instanceof Timestamp)&&source.privacyRetention==null&&source.legalRetention==null)return undefined;
  if(root==='avis'&&own('reviewerId')){
    // Preserve the original number and contractual references; authored free
    // text and the public name/photo have no contract function.
    return {...source,text:'',reviewerName:'Utilisateur supprimé',reviewerImage:null};
  }
  if(root==='messages'&&own('senderId')){
    const result:Data={};
    for(const key of ['chatId','senderId','receiverId','timestamp','createdAt','isRead','readAt'])
      if(accountErasureOwn(source,key))result[key]=source[key];
    if(retainContractOffer&&source.type==='offer'&&source.offer&&['accepted','completed','expired'].includes(source.offer.status)){
      // This exact offer is still a native component of the cash contract.
      // No offer field is reconstructed or changed by erasure.
      result.type='offer';result.offer=source.offer;
    }else result.type='text';
    return {...result,content:'',senderName:'Utilisateur supprimé',senderImage:null,
      erasedContent:true};
  }
  if(root==='chats'&&Array.isArray(source.participants)&&source.participants.includes(uid)&&Array.isArray(source.participantsInfo)){
    const result:Data={...source,lastMessage:'',lastMessageType:'text',participantsInfo:source.participantsInfo.map((p:any)=>p?.userId===uid?
      {userId:uid,userName:'Utilisateur supprimé',userImage:null}:p)};
    return result;
  }
  return fail();
}
export async function accountErasureOrdinaryMutationValue(path:string,source:Data,uid:string,
  read:(path:string)=>Promise<Data|undefined>,control:{installationId:string;epoch:string}){
  let retain=false;
  if(/^messages\/[^/]+$/.test(path)&&source.type==='offer'&&typeof source.offer?.transactionId==='string'&&
    /^[A-Za-z0-9_-]{1,200}$/.test(source.offer.transactionId)){
    const id=source.offer.transactionId,parent=await read('transactions/'+id);
    if(parent&&[parent.buyerId,parent.sellerId].includes(uid)&&parent.offerMessageId===path.split('/')[1]){
      if(parent.chatId!==source.chatId||source.offer.amount!==parent.amount||
        ![parent.buyerId,parent.sellerId].includes(source.senderId)||![parent.buyerId,parent.sellerId].includes(source.receiverId)||
        source.senderId===source.receiverId||!(source.offer.acceptedAt instanceof Timestamp)||
        !(parent.cashAgreement?.acceptedAt instanceof Timestamp)||!source.offer.acceptedAt.isEqual(parent.cashAgreement.acceptedAt)||
        accountErasureSourceHash(source.offer.meetup?.location)!==accountErasureSourceHash(parent.meetupSpot)||
        !localAgreementWitnessMatches('purchase','transactions/'+id,parent,control))return fail();
      retain=true;
    }
  }
  return accountErasureOrdinaryValue(path,source,uid,retain);
}
export function accountErasurePublicProfile(source:Data,uid:string):Data {
  // Retain only explicit operational identifiers until the final native Auth
  // postcondition. Never copy arbitrary user/contact/preferences into a fence.
  const result:Data={uid,displayName:'Utilisateur supprimé',profileImage:null,isActive:false,
    preferences:{analyticsConsent:false,privacy:{showProfilePhoto:false}}};
  for(const key of ['stripeAccountId','stripeAccountCreationStartedAt'])if(accountErasureOwn(source,key))result[key]=source[key];
  return result;
}
export function accountErasureEligibilityTombstone(source:Data,uid:string):Data{
  if(!source.accountErasureFence||source.accountErasureFence.ownerId!==uid||!source.accountErasureRequest||
    ['bankOperation','connectOperation'].some(key=>accountErasureOwn(source,key))||source.accountClosure?.exceptionalRestitution!=null)
    return fail();
  const f=source.accountErasureFence,r=source.accountErasureRequest;
  return {accountErasureFence:{protocol:f.protocol,ownerId:uid,commandId:f.commandId,recordedAt:f.recordedAt},
    accountErasureRequest:{protocol:r.protocol,commandId:r.commandId,requestId:r.requestId,recordedAt:r.recordedAt},
    accountClosure:{schemaVersion:1,ownerId:uid,phase:'purging',status:'incomplete',requestedAt:r.recordedAt,leaseUntilMs:0}};
}
/** Called by the transaction adapter BEFORE forwarding ANY staged write. The
 * marker, intention, exact source and both preservation semaphores join the
 * SAME native read set. A malformed/null fence never becomes an exemption. */
export async function accountErasureNativePlan(writes:readonly Write[],
  read:(path:string)=>Promise<FirebaseFirestore.DocumentSnapshot>,
  preservation:()=>Promise<{blocked:boolean}>,project:(before:Data|undefined,write:Write)=>Data|undefined,
  articleHasRetainedContract:(articleId:string)=>Promise<boolean>):Promise<Set<Write>>{
  const s=scope.getStore(),allowed=new Set<Write>();if(!s||!writes.length)return allowed;
  const command=(await read('account_erasure_commands/'+s.commandId)).data(),profile=(await read('eligibility_profiles/'+s.ownerId)).data();
  if(!command||command.protocol!=='account_erasure_v1'||command.ownerId!==s.ownerId||command.commandId!==s.commandId||
    command.commandId!==accountErasureId(s.ownerId,command.requestId)||command.confirmed!==true||
    !(command.requestedAt instanceof Timestamp)||!command.actor||command.actor.uid!==s.ownerId||
    !['password','google.com','apple.com'].includes(command.actor.provider)||
    command.inputHash!==accountErasureSourceHash({protocol:command.protocol,ownerId:s.ownerId,requestId:command.requestId,
      commandId:s.commandId,intakeObservationKeyHash:command.intakeObservationKeyHash,confirmed:true,authSource:command.authSource,actor:command.actor})||
    profile?.accountErasureRequest?.commandId!==s.commandId||(await preservation()).blocked)return fail();
  const c=await readFinancialRecoveryControl();
  if(c.control.mode!=='normal'||c.control.previousEpoch!==null||c.control.financialEnvironment!=='unconfigured'||
    c.control.installationId!==command.control?.installationId||c.control.epoch!==command.control?.epoch||
    c.generation!==command.control?.generation||c.sha256!==command.control?.sourceHash)return fail();
  if(s.phase==='admit'){
    if(command.fenceCommitted||hasAccountErasureFence(profile)||command.inspection?.state!=='ready')return fail();
    const paths=new Set(['account_erasure_commands/'+s.commandId,'eligibility_profiles/'+s.ownerId,'users/'+s.ownerId]);
    if(writes.length>3||writes.some(w=>!paths.has(w.args[0]?.path)||w.method==='delete'||w.args.length!==2))return fail();
    for(const w of writes){const path=w.args[0].path,before=(await read(path)).data(),after=project(before,w);
      if(path==='users/'+s.ownerId){if(!before||!same(after,accountErasurePublicProfile(before,s.ownerId)))return fail();}
      else if(path==='eligibility_profiles/'+s.ownerId){
        const marker=after?.accountErasureFence;
        if(!before||!marker||marker.protocol!=='account_erasure_fence_v1'||marker.commandId!==s.commandId||marker.ownerId!==s.ownerId||
          !(marker.recordedAt instanceof Timestamp)||!same({...before,accountErasureFence:marker},after))return fail();
      }else if(!after||!same({...before,fenceCommitted:true,state:'erasing',version:before!.version+1,updatedAt:after.updatedAt},after))return fail();
      allowed.add(w);
    }
    if(!writes.some(w=>w.args[0].path==='eligibility_profiles/'+s.ownerId)||!writes.some(w=>w.args[0].path==='account_erasure_commands/'+s.commandId))return fail();
    return allowed;
  }
  const marker=profile?.accountErasureFence;
  if(!command.fenceCommitted||!marker||marker.protocol!=='account_erasure_fence_v1'||marker.commandId!==s.commandId||marker.ownerId!==s.ownerId||
    !['erasing','auth_deletion_pending'].includes(command.state))return fail();
  if(writes.length!==1)return fail();
  const w=writes[0],path=w.args[0]?.path,before=(await read(path)).data();
  if(path!==s.targetPath||!before||w.args.length!==(w.method==='delete'?1:2))return fail();
  if(s.phase==='article_dispose'){
    const p=path.split('/'),op=(await read('article_privacy_evidence/'+p[1])).data(),article=(await read('articles/'+p[1])).data();
    if(p[0]!=='article_privacy_evidence'||!op||op.ownerId!==s.ownerId||article?.privacyWithdrawal?.operationId!==op.operationId||
      await articleHasRetainedContract(p[1]))return fail();
    if(p.length===2){
      const after=project(before,w);if(!after||w.method!=='set'||!(after.updatedAt instanceof Timestamp)||
        !same(after,minimizeDisposedArticleEvidence(before,s.commandId,after.updatedAt)))return fail();
    }else if(p.length!==4||p[2]!=='public_projection_evidence'||w.method!=='delete'||before.operationId!==op.operationId)return fail();
  }else if(s.phase==='profile_minimize'){
    if(path!=='eligibility_profiles/'+s.ownerId||w.method!=='set'||command.authAbsenceVerified!==true||command.authDeletion?.state!=='absent'||
      !same(project(before,w),accountErasureEligibilityTombstone(before,s.ownerId)))return fail();
  }else if(s.phase==='profile_delete'){
    if(path!=='users/'+s.ownerId||w.method!=='delete'||command.authAbsenceVerified!==true||command.authDeletion?.state!=='absent')return fail();
  }else{
    const expected=await accountErasureOrdinaryMutationValue(path,before,s.ownerId,async p=>(await read(p)).data(),c.control),after=project(before,w);
    if(expected===undefined?w.method!=='delete':w.method!=='set'||!same(after,expected))return fail();
  }
  allowed.add(w);return allowed;
}
