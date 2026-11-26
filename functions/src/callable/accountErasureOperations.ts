/** Real operator queue. It never manufactures financial reconciliation, ends
 * a hold, restores an account, or changes an observation capability. */
import {onCall,HttpsError} from 'firebase-functions/v2/https';
import {Timestamp} from 'firebase-admin/firestore';
import {db} from '../config/firebase';
import {assertPrivateAccountSession,withPrivateAccountSession} from '../utils/privateAccountSession';
import {accountErasureSourceHash,accountErasureReceipt} from '../utils/accountErasureContract';
import {eraseStorageGeneration} from '../utils/accountErasureRuntime';
const hash=accountErasureSourceHash,id=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v),
  deny=():never=>{throw new HttpsError('permission-denied','Accès opérateur qualifié requis.');};
export async function handleAccountErasureOperations(request:any){
  if(!request.auth||request.data?.expectedUid!==request.auth.uid)return deny();
  return withPrivateAccountSession(request,async()=>{
    const session=await assertPrivateAccountSession(request),token=request.auth.token,
      provider=token?.firebase?.sign_in_provider,authTime=token?.auth_time;
    if(!['password','google.com','apple.com'].includes(provider)||!Number.isSafeInteger(authTime)||
      Date.now()-authTime*1000>5*60000||authTime*1000>Date.now()+60000)return deny();
    const operator=(await db.collection('users').doc(request.auth.uid).get()).data();
    if(!session.currentAdminClaim&&operator?.isAdmin!==true)return deny();
    const input=request.data,action=input.action;
    if(!['list','inspect','resume','erase_media'].includes(action))throw new HttpsError('invalid-argument','Action opérateur invalide.');
    const fields=action==='list'?['expectedUid','action','afterCommandId']:action==='inspect'?['expectedUid','action','commandId']:
      action==='resume'?['expectedUid','action','commandId','expectedVersion','requestId']:
        ['expectedUid','action','commandId','reviewId','expectedReviewHash','requestId','ownershipVerified','reason'];
    if(Object.keys(input).some(k=>!fields.includes(k)))throw new HttpsError('invalid-argument','Champ opérateur inattendu.');
    if(action==='list'){
      let q=db.collection('account_erasure_commands').where('state','in',
        ['requested','inspecting','awaiting_obligations','awaiting_review','awaiting_apple_authorization','erasing','auth_deletion_pending','needs_attention']).orderBy('__name__').limit(26);
      if(input.afterCommandId!==undefined){if(!id(input.afterCommandId))throw new HttpsError('invalid-argument','Curseur invalide.');q=q.startAfter(input.afterCommandId);}
      const page=await q.get(),rows=page.docs.slice(0,25);
      return {kind:'account_erasure_operator_queue_v1',items:rows.map(row=>{const d=row.data();return {commandId:row.id,ownerId:d.ownerId,
        state:d.state,version:d.version,reviewDueAt:d.reviewDueAt instanceof Timestamp?d.reviewDueAt.toDate().toISOString():null,
        accountAccessClosed:d.fenceCommitted===true};}),afterCommandId:page.size>25?rows.at(-1)!.id:null};
    }
    if(!id(input.commandId))throw new HttpsError('invalid-argument','Commande invalide.');
    const ref=db.collection('account_erasure_commands').doc(input.commandId),job=(await ref.get()).data();
    if(!job||job.protocol!=='account_erasure_v1')throw new HttpsError('not-found','Demande introuvable.');
    if(action==='inspect'){
      const [retained,reviews,processors]=await Promise.all([ref.collection('retained').limit(26).get(),ref.collection('media_reviews').limit(26).get(),ref.collection('processors').get()]);
      return {kind:'account_erasure_operator_review_v1',ownerId:job.ownerId,receipt:accountErasureReceipt(job,Date.now(),'operator'),
        nativeReasons:[...(Array.isArray(job.reasons)?job.reasons:[]),...(job.inspection?.reasons??[])],
        retained:retained.docs.slice(0,25).map(d=>({id:d.id,path:d.data().path,sourceHash:d.data().sourceHash,purpose:d.data().purpose,
          reviewAt:d.data().reviewAt instanceof Timestamp?d.data().reviewAt.toDate().toISOString():null})),retainedHasMore:retained.size>25,
        media:reviews.docs.slice(0,25).map(d=>{const v=d.data();return {id:d.id,reviewHash:hash(v),state:v.state,path:v.path,generation:v.generation,
          sourceMessageId:v.sourceMessageId,sourceChatId:v.sourceChatId,sourceMessageHash:v.sourceMessageHash,
          contentType:v.contentType,size:v.size,nativeCreatedAt:v.nativeCreatedAt};}),mediaHasMore:reviews.size>25,
        processors:processors.docs.map(d=>({id:d.id,state:d.data().state,proofHash:d.data().proofHash??null})),
        financialQualificationGranted:false,legalAuthorityAutomaticallyVerified:false};
    }
    if(typeof input.requestId!=='string'||!/^[A-Za-z0-9_-]{16,128}$/.test(input.requestId))throw new HttpsError('invalid-argument','Identité opérateur durable requise.');
    if(action==='erase_media'){
      if(!id(input.reviewId)||!id(input.expectedReviewHash)||input.ownershipVerified!==true||typeof input.reason!=='string'||
        input.reason.trim().length<20||input.reason.length>2000)throw new HttpsError('invalid-argument','Examen réel de la génération et motivation requis.');
      const reviewRef=ref.collection('media_reviews').doc(input.reviewId),operationId=hash([request.auth.uid,input.requestId]),
        review=await db.runTransaction(async tx=>{
          await assertPrivateAccountSession(request,tx);
          const [j,r]=await Promise.all([tx.get(ref),tx.get(reviewRef)]),value=r.data();
          if(!value||j.data()?.inputHash!==job.inputHash||value.commandId!==job.commandId||value.ownerId!==job.ownerId||
            !['review_required','erase_prepared','erased'].includes(value.state)||value.state==='review_required'&&hash(value)!==input.expectedReviewHash||
            ['erase_prepared','erased'].includes(value.state)&&value.operatorOperationId!==operationId||!/^chat_images\/[^/]+\/[^/]+$/.test(value.path)||
            !value.path.startsWith('chat_images/'+value.sourceChatId+'/')||!/^[1-9]\d{0,24}$/.test(value.generation))throw new HttpsError('aborted','Relisez cette génération native.');
          if(value.state==='review_required')tx.update(reviewRef,{state:'erase_prepared',operatorOperationId:operationId,
            operatorAttestation:{actorUid:request.auth.uid,statementVersion:'erasure_media_generation_review_v1',
              ownershipVerifiedByOperator:true,sourceReviewHash:input.expectedReviewHash,reason:input.reason.trim(),recordedAt:Timestamp.now(),
              legalAuthorityAutomaticallyVerified:false,rprDesignationAutomaticallyVerified:false}});
          return value;
        });
      if(review.state==='erased')return {kind:'account_erasure_operator_media_v1',commandId:job.commandId,reviewId:input.reviewId,
        state:'generation_absence_verified',financialQualificationGranted:false};
      await eraseStorageGeneration(job,review.path,review.generation);
      await db.runTransaction(async tx=>{
        await assertPrivateAccountSession(request,tx);const [r,j]=await Promise.all([tx.get(reviewRef),tx.get(ref)]),live=j.data();
        if(!live||r.data()?.operatorOperationId!==operationId||live.inputHash!==job.inputHash)throw new HttpsError('aborted','Reçu opérateur modifié.');
        tx.update(reviewRef,{state:'erased',verifiedAt:Timestamp.now()});
        if(!['completed','not_executed'].includes(live.state))tx.update(ref,{state:live.fenceCommitted?'erasing':'inspecting',version:live.version+1,updatedAt:Timestamp.now()});
      });
      return {kind:'account_erasure_operator_media_v1',commandId:job.commandId,reviewId:input.reviewId,state:'generation_absence_verified',
        financialQualificationGranted:false};
    }
    if(!Number.isSafeInteger(input.expectedVersion)||input.expectedVersion<1)throw new HttpsError('invalid-argument','Version courante requise.');
    return db.runTransaction(async tx=>{
      await assertPrivateAccountSession(request,tx);const live=(await tx.get(ref)).data(),opRef=ref.collection('operator_commands').doc(hash([request.auth.uid,input.requestId])),prior=(await tx.get(opRef)).data();
      if(!live||live.inputHash!==job.inputHash)throw new HttpsError('aborted','Intention native modifiée.');
      if(prior){if(prior.action!=='resume'||prior.expectedVersion!==input.expectedVersion)throw new HttpsError('aborted','Identité de reprise réutilisée.');return accountErasureReceipt(live);}
      if(live.version!==input.expectedVersion||['completed','not_executed'].includes(live.state)||live.state==='awaiting_apple_authorization')
        throw new HttpsError('failed-precondition','Cette reprise ne peut pas remplacer l’autorisation Apple ni une version différente.');
      const patch={state:live.fenceCommitted?'erasing':'inspecting',version:live.version+1,updatedAt:Timestamp.now()};
      tx.create(opRef,{protocol:'account_erasure_operator_command_v1',action:'resume',actorUid:request.auth.uid,expectedVersion:input.expectedVersion,
        commandId:job.commandId,requestId:input.requestId,recordedAt:Timestamp.now(),destructiveAuthorityChanged:false,
        financialQualificationGranted:false,legalAuthorityAutomaticallyVerified:false});
      tx.update(ref,patch);return accountErasureReceipt({...live,...patch});
    });
  });
}
export const manageAccountErasure=onCall({region:'northamerica-northeast1',memory:'512MiB',timeoutSeconds:120},handleAccountErasureOperations);
