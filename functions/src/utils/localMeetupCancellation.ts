import {Timestamp} from 'firebase-admin/firestore';
import {HttpsError} from 'firebase-functions/v2/https';
import {db} from '../config/firebase';
import {assertPrivateAccountSession} from './privateAccountSession';
import {assertLocalAgreementReadable} from './localAgreement';
import {assertFinancialRecoveryEffect} from './financialRecoveryInterlock';
import {financialRecoverySourceFields} from './financialRecoverySources';
import {articleReleaseUpdate,commitArticleRelease} from './articleReservation';
import {prepareOperationalNotices} from './notifications';

/** Separate local cancellation: it cannot enter payment neutralization,
 * refund/ledger code or adopt an old source merely because no PI is present. */
export async function cancelLocalMeetup(request:any,sellerOnly=false) {
  const uid=request.auth?.uid,id=request.data?.transactionId;
  if(typeof id!=='string'||!/^[A-Za-z0-9_-]{1,200}$/.test(id))throw new HttpsError('invalid-argument','Commande requise.');
  return db.runTransaction(async tx=>{
    await assertPrivateAccountSession(request,tx);
    const ref=db.collection('transactions').doc(id),order=(await tx.get(ref)).data();
    if(!order)throw new HttpsError('not-found','Commande introuvable.');
    if(sellerOnly?order.sellerId!==uid:![order.buyerId,order.sellerId].includes(uid))throw new HttpsError('permission-denied','Vous ne pouvez pas annuler cet accord.');
    await assertFinancialRecoveryEffect('firestore_commit',{refs:[ref.path]});
    assertLocalAgreementReadable('purchase',ref.path,order);
    if(order.status==='cancelled'&&order.localCancellation)return {success:true,replay:true,currentStatus:'cancelled',cancellationCommitted:true,walletRefundCommitted:true,refundedCents:0,moneyMoved:false};
    if(!['meetup_pending','meetup_confirmed'].includes(order.status))throw new HttpsError('failed-precondition','Cet accord ne peut plus être annulé.');
    const articleRef=db.collection('articles').doc(order.articleId),article=(await tx.get(articleRef)).data();
    const release=article?await articleReleaseUpdate(tx,articleRef,article,id):null;
    if(!release)throw new HttpsError('failed-precondition','La réservation exacte de cet accord doit être retrouvée.');
    const messageRef=db.collection('messages').doc(order.offerMessageId),message=(await tx.get(messageRef)).data();
    if(!message||message.chatId!==order.chatId||message.offer?.transactionId!==id||message.offer.status!=='accepted')throw new HttpsError('failed-precondition','La proposition liée doit être retrouvée.');
    const notices=await prepareOperationalNotices(tx,[order.buyerId,order.sellerId].map(userId=>({eventKey:`local_cancellation:${id}`,userId,type:'order_cancelled',
      title:'Rencontre annulée',message:'La rencontre est annulée et la réservation de l’article est libérée.',data:{transactionId:id,chatId:order.chatId,cancelledBy:uid}})));
    const cancelledAt=Timestamp.now();
    const fields=await financialRecoverySourceFields('purchase',ref,order,{status:'cancelled',cancelledAt,cancelledBy:uid,
      localCancellation:{protocol:'local_cash_cancellation_v1',transactionId:id,agreementId:order.cashAgreement.agreementId,actorUid:uid,cancelledAt,
        platformMoneyObligationCents:0,moneyMoved:false}});
    await assertPrivateAccountSession(request,tx);
    tx.update(ref,fields);commitArticleRelease(tx,articleRef,release);
    tx.update(messageRef,{'offer.status':'expired','offer.expiredReason':'meetup_cancelled','offer.expiredAt':cancelledAt});notices.commit();
    return {success:true,replay:false,currentStatus:'cancelled',cancellationCommitted:true,walletRefundCommitted:true,refundedCents:0,moneyMoved:false};
  });
}
