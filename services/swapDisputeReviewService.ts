import { phase1HttpsCallable as httpsCallable } from '@/services/phase1Callable';
import {auth,functions} from '@/config/firebaseConfig';
import {isDeclaredSupportAccountId as nativeUid} from '@/utils/supportAccountIdentity';
import {captureTradeSession,assertTradeSessionCurrent} from '@/services/tradeOperation';
import {productReviewHash,productReviewEqual} from '@/services/productReviewService';
import {SWAP_DISPUTE_REVIEW_CAPABILITY,type SwapDisputeReviewAttempt,type SwapDisputeReviewPreview,type SwapDisputeReviewHistory,type SwapDisputeReviewReceipt} from '@/types/swapDisputeReview';
import {swapReviewObject as obj,swapReviewExact as exact,swapReviewHash as hash,swapReviewId as id,swapReviewDate as iso,swapReviewNoEffects as none,SWAP_REVIEW_EFFECTS as EFFECTS,isSwapReviewSource,isSwapReviewCapture,isSwapReviewCommand,isSwapReviewAttempt,swapReviewEntryId as eid} from '@/utils/swapDisputeReviewContract';
export const swapDisputeReviewFailure=()=>new Error('La source documentaire du Troc et son propre reçu doivent être relus.');
async function rpc(uid:string,input:Record<string,unknown>,guard:()=>void,privateRead:boolean){
 const session=captureTradeSession(uid),current=()=>{assertTradeSessionCurrent(session);guard();};current();const user=auth.currentUser;if(!user||user.uid!==uid)throw swapDisputeReviewFailure();
 if(privateRead){const token=await user.getIdTokenResult(true);current();const at=token.claims.auth_time,now=Math.floor(Date.now()/1000);if(auth.currentUser!==user||token.claims.admin!==true||typeof at!=='number'||!Number.isSafeInteger(at)||at<=0||at>now||now-at>300)throw new Error('Votre identité récente et votre accès privé doivent être requalifiés.');}else{await user.getIdToken();current();}
 const r=await httpsCallable<unknown,unknown>(functions,'resolveSwapDispute')({swapDisputeCapability:SWAP_DISPUTE_REVIEW_CAPABILITY,expectedUid:uid,expectedAdminUid:uid,...input});current();return r.data;
}
const admission=(v:unknown)=>obj(v)&&exact(v,['currentPrivateAdminQualified','recentAuthenticationQualified'])&&v.currentPrivateAdminQualified===true&&v.recentAuthenticationQualified===true;
const reference=(v:unknown,swapId:string,unknownVersion=false)=>obj(v)&&exact(v,['swapId','id','contentHash','version'])&&v.swapId===swapId&&eid(v.id)&&hash(v.contentHash)&&(unknownVersion?v.version===null:typeof v.version==='number'&&Number.isSafeInteger(v.version)&&v.version>0);
export const SwapDisputeReviewService={
 async preview(uid:string,swapId:string,guard:()=>void):Promise<SwapDisputeReviewPreview>{
  if(!id(swapId))throw swapDisputeReviewFailure();const v=await rpc(uid,{mode:'preview',swapId},guard,true);
  if(!obj(v)||!exact(v,['protocol','swapId','source','capture','canRecord','stageEnabled','admission',...EFFECTS])||v.protocol!=='swap_dispute_review_preview_v1'||v.swapId!==swapId||!isSwapReviewSource(v.source)||!isSwapReviewCapture(v.capture,swapId)||v.source.episodeHash!==v.capture.episodeHash||v.source.version!==v.capture.version||typeof v.canRecord!=='boolean'||typeof v.stageEnabled!=='boolean'||!admission(v.admission)||!none(v)||v.canRecord&&(!v.stageEnabled||!v.capture.coverage.historyQualified||v.capture.episode.qualification!=='native_dispute_episode'))throw swapDisputeReviewFailure();
  return v as unknown as SwapDisputeReviewPreview;
 },
 async history(uid:string,swapId:string,sourceHash:string,cursor:string|null,guard:()=>void):Promise<SwapDisputeReviewHistory>{
  if(!id(swapId)||!hash(sourceHash)||cursor!==null&&!eid(cursor))throw swapDisputeReviewFailure();const v=await rpc(uid,{mode:'history',swapId,sourceHash,cursor},guard,true);
  if(!obj(v)||!exact(v,['protocol','swapId','sourceHash','cursor','entries','hasMore','nextCursor','admission',...EFFECTS])||v.protocol!=='swap_dispute_review_history_v1'||v.swapId!==swapId||v.sourceHash!==sourceHash||v.cursor!==cursor||!admission(v.admission)||!none(v)||!Array.isArray(v.entries)||v.entries.length>20||typeof v.hasMore!=='boolean'||!(v.nextCursor===null||eid(v.nextCursor))||v.hasMore!==(v.nextCursor!==null)||v.hasMore&&v.entries.length!==20)throw swapDisputeReviewFailure();
  const ids:string[]=[];for(const r of v.entries){if(!obj(r)||!exact(r,['reference','qualification','entry']))throw swapDisputeReviewFailure();const e=r.entry;
   if(r.qualification==='unknown'){if(e!==null||!reference(r.reference,swapId,true))throw swapDisputeReviewFailure();}
   else if(r.qualification!=='native_documentary_entry'||!reference(r.reference,swapId)||!obj(e)||!exact(e,['actorId','requestId','recordedAt','command','sourceHash','episodeHash','notificationIds',...EFFECTS])||!nativeUid(e.actorId)||!id(e.requestId)||e.requestId.length<16||!iso(e.recordedAt)||!isSwapReviewCommand(e.command)||!hash(e.sourceHash)||!hash(e.episodeHash)||e.command.source.sourceHash!==e.sourceHash||e.command.source.episodeHash!==e.episodeHash||!obj(r.reference)||r.reference.version!==e.command.source.version+1||!Array.isArray(e.notificationIds)||e.notificationIds.length!==2||!e.notificationIds.every(id)||new Set(e.notificationIds).size!==2||!none(e))throw swapDisputeReviewFailure();
   if(!obj(r.reference)||!eid(r.reference.id))throw swapDisputeReviewFailure();if(r.qualification==='native_documentary_entry'&&obj(e)&&r.reference.id!==`sdr_${await productReviewHash([e.actorId,e.requestId])}`)throw swapDisputeReviewFailure();guard();ids.push(r.reference.id);
  }
  if(ids.some((x,i)=>cursor!==null&&x<=cursor||i>0&&x<=ids[i-1])||v.nextCursor!==null&&v.nextCursor!==ids.at(-1))throw swapDisputeReviewFailure();return v as unknown as SwapDisputeReviewHistory;
 },
 async command(a:SwapDisputeReviewAttempt,mode:'execute'|'observe'|'neutralize',guard:()=>void):Promise<SwapDisputeReviewReceipt>{
  if(!isSwapReviewAttempt(a,a.uid)||await productReviewHash(a.command)!==a.payloadHash)throw swapDisputeReviewFailure();guard();const entryId=`sdr_${await productReviewHash([a.uid,a.requestId])}`;guard();const v=await rpc(a.uid,{mode,swapId:a.swapId,requestId:a.requestId,command:a.command},guard,mode==='execute');
  if(!obj(v)||!exact(v,['protocol','swapId','actorId','requestId','payloadHash','state','recordedAt','reason','reference','commandCommitted','notificationCommitted','nonExecutionVerified',...EFFECTS])||v.protocol!=='swap_dispute_review_receipt_v1'||v.swapId!==a.swapId||v.actorId!==a.uid||v.requestId!==a.requestId||v.payloadHash!==a.payloadHash||!none(v))throw swapDisputeReviewFailure();
  if(v.state==='committed'){if(!reference(v.reference,a.swapId)||!obj(v.reference)||v.reference.id!==entryId||v.reference.version!==a.command.source.version+1||!iso(v.recordedAt)||v.reason!==null||v.commandCommitted!==true||v.notificationCommitted!==true||v.nonExecutionVerified!==false)throw swapDisputeReviewFailure();}
  else if(v.reference!==null||v.commandCommitted!==false||v.notificationCommitted!==false||(v.state==='not_executed'?!iso(v.recordedAt)||typeof v.reason!=='string'||!v.reason||v.reason.length>200||v.nonExecutionVerified!==true:v.state!=='unrecorded'||v.recordedAt!==null||v.reason!==null||v.nonExecutionVerified!==false))throw swapDisputeReviewFailure();
  return v as unknown as SwapDisputeReviewReceipt;
 },
 equal:productReviewEqual,
};
