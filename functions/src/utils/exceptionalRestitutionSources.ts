/** Native source adapters for exceptional restitution. No banking mutation. */
import {Timestamp} from 'firebase-admin/firestore';
import {HttpsError} from 'firebase-functions/v2/https';
import {db,auth} from '../config/firebase';
import {getStripe} from '../config/stripe';
import {supportObject,supportId,supportAccountUid,supportHash,supportSourceHash,supportRevision,SUPPORT_COLLECTION} from './supportRequest';
import {readWithdrawalLocalEvidence,withdrawalFailureReturnMatches} from './payoutRecovery';
import {matchesWithdrawalPayout} from './payoutOutcome';
import {readWalletFinancialReview} from './walletFundsAdmission';
import {readAllocationHistoryIntent,allocationLocalMovementsVerified,readSettledAllocationIntent,refundAllocationRef} from './refundAllocation';
import {hasActiveBankDispute} from './bankDispute';
import {FinancialRecoveryBlocked} from './financialRecoveryInterlock';
import {recoveryInstallation,readFinancialRecoveryIdentityClaim} from '../config/recoveryControl';

type Data=FirebaseFirestore.DocumentData;
export type ExceptionalContext={kind:'withdrawal_misdirection';withdrawalRequestId:string}|{kind:'wallet_restitution';ownerId:string;supportRequestId:string}|
 {kind:'refund_error';transactionId:string;refundIntentId:string;harm:'buyer_shortfall'|'buyer_wrong_attribution'|'seller_undue_debit'|'seller_debt_compensation'};
export const exceptionalDebtCredit=(c:ExceptionalContext)=>c.kind==='refund_error'&&c.harm==='seller_debt_compensation';
export const exceptionalNative=(v:unknown):v is Timestamp=>v instanceof Timestamp&&v.toMillis()>0&&v.toMillis()<=Date.now();
export const exceptionalCents=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>=0;
export function parseExceptionalContext(raw:unknown):ExceptionalContext{
 const kind=(raw as any)?.kind,d=supportObject(raw,kind==='withdrawal_misdirection'?['kind','withdrawalRequestId']:kind==='wallet_restitution'?['kind','ownerId','supportRequestId']:['kind','transactionId','refundIntentId','harm']);
 if(kind==='withdrawal_misdirection')return {kind,withdrawalRequestId:supportId(d.withdrawalRequestId)};
 if(kind==='wallet_restitution')return {kind,ownerId:supportAccountUid(d.ownerId),supportRequestId:supportId(d.supportRequestId)};
 if(kind!=='refund_error'||!['buyer_shortfall','buyer_wrong_attribution','seller_undue_debit','seller_debt_compensation'].includes(d.harm))throw new HttpsError('invalid-argument','Source native de réparation requise.');
 return {kind,transactionId:supportId(d.transactionId),refundIntentId:supportId(d.refundIntentId),harm:d.harm};
}
export const exceptionalCaseId=(c:ExceptionalContext)=>'exception_'+supportHash(c);
export const exceptionalCaseRef=(c:ExceptionalContext)=>db.collection('admin_alerts').doc(exceptionalCaseId(c));
const eq=(a:unknown,b:unknown)=>supportSourceHash(a)===supportSourceHash(b);
export async function observeExceptionalProvider(c:ExceptionalContext){
 if(c.kind!=='withdrawal_misdirection')return {qualification:'not_required',proofHash:supportHash(c)};
 const w=(await db.collection('withdrawal_requests').doc(c.withdrawalRequestId).get()).data(),stripe=getStripe();
 if(!w||!stripe||typeof w.stripePayoutId!=='string'||typeof w.stripeTransferId!=='string')return {qualification:'unknown',proofHash:supportHash(['unknown',c])};
 try{
  const [p,t]=await Promise.all([stripe.payouts.retrieve(w.stripePayoutId,undefined,{stripeAccount:w.stripeAccountId}),stripe.transfers.retrieve(w.stripeTransferId)]);
  const native=matchesWithdrawalPayout(c.withdrawalRequestId,w,p)&&t.object==='transfer'&&t.id===w.stripeTransferId&&t.amount===w.amount&&t.currency==='cad'&&
   (typeof t.destination==='string'?t.destination:t.destination?.id)===w.stripeAccountId&&t.metadata?.firebaseUserId===w.userId&&t.metadata?.withdrawalRequestId===c.withdrawalRequestId&&t.amount_reversed===0&&t.reversed===false;
  let returned:any=null;
  if(native&&['failed','canceled'].includes(p.status)&&typeof p.failure_balance_transaction==='string'){
   const balance=await stripe.balanceTransactions.retrieve(p.failure_balance_transaction,undefined,{stripeAccount:w.stripeAccountId});
   if(withdrawalFailureReturnMatches(balance,p,w.amount))returned={id:balance.id,amountCents:balance.amount,currency:'CAD',source:p.id};
  }
  const fact={qualification:native&&p.status==='paid'?'paid_native_misdirection_review':returned?'returned_native_misdirection_review':'unknown',returned,
   withdrawalSourceHash:supportSourceHash(w),payoutId:p.id,payoutStatus:p.status,
   transferId:t.id,amountCents:w.amount,currency:'CAD',accountId:w.stripeAccountId,bankAccountId:w.payoutDestination?.bankAccountId??null};
  return {...fact,proofHash:supportHash(fact)};
 }catch(e){if(e instanceof FinancialRecoveryBlocked)throw e;return {qualification:'unknown',proofHash:supportHash(['unknown',c])};}
}
/** Immutable legal review grants servicing of a selected existing wallet,
 * never the subject's Firebase session or a freely chosen beneficiary. */
async function walletAuthority(tx:FirebaseFirestore.Transaction,c:Extract<ExceptionalContext,{kind:'wallet_restitution'}>,wallet:Data,previous?:Data){
 const supportRef=db.collection(SUPPORT_COLLECTION).doc(c.supportRequestId),s=(await tx.get(supportRef)).data();
 if(!s||s.schemaVersion!==1||typeof s.ownerId!=='string'||!Number.isSafeInteger(s.receivedAtMs)||s.receivedAtMs<1||s.receivedAtMs>Date.now())return null;
 const commands=await tx.get(supportRef.collection('commands').orderBy('__name__').limit(101));
 const origin=commands.docs.filter(d=>d.data().actorRole==='owner'&&d.data().action==='submit'&&d.data().state==='committed');
 if(commands.size>=101||origin.length!==1||origin[0].data().protocol!=='support_command_v1'||origin[0].data().supportRequestId!==c.supportRequestId||
  origin[0].id!==supportHash([s.ownerId,origin[0].data().requestId])||origin[0].data().actorId!==s.ownerId||origin[0].data().ownerId!==s.ownerId||
  origin[0].data().payloadHash!==supportHash(origin[0].data().command)||origin[0].data().command?.kind!==s.kind)return null;
 if(s.ownerId===c.ownerId){
  if(!['account_reconciliation','access_interruption','representation_review','payment_account_review'].includes(s.kind))return null;
  return {kind:'native_owner_support_request',ownerId:c.ownerId,representativeUid:null,supportRequestId:c.supportRequestId,sourceHash:supportSourceHash(s)};
 }
 const r=s.accountReview;
 if(s.kind!=='representation_review'||r?.protocol!=='support_account_review_v2'||r.finding!=='representation_authority_confirmed'||r.subjectUid!==c.ownerId||
  r.representativeUid!==s.ownerId||r.representationAuthorityVerified!==true||r.authorityScope!=='selected_existing_obligations_only'||
  r.identityDocumentsReviewed!==true||r.authorityDocumentsReviewed!==true||!Number.isFinite(Date.parse(r.reviewDueAt))||Date.parse(r.reviewDueAt)<=Date.now()||!Array.isArray(r.obligations)||!Array.isArray(r.evidenceReads))return null;
 const obligation=r.obligations.find((o:Data)=>o.kind==='wallet'&&o.id===c.ownerId);
 if(!obligation)return null;
 const p=previous?.sourceCapture?.authority;
 if(!eq({collection:'wallets',id:c.ownerId,source:wallet},previous?.sourceCapture?.walletBasis??{collection:'wallets',id:c.ownerId,source:wallet})&&
  !(p?.sourceHash===supportSourceHash(s)&&previous?.reservation?.ownerId===c.ownerId))return null;
 const walletRevision=supportRevision(await tx.get(db.collection('wallets').doc(c.ownerId)));
 if(!previous&&(obligation.sourceHash!==supportSourceHash({collection:'wallets',id:c.ownerId,source:wallet})||!walletRevision||obligation.sourceRevision!==walletRevision))return null;
 if(previous&&p?.walletRevision!==obligation.sourceRevision)return null;
 const receipt=(await tx.get(supportRef.collection('commands').doc(r.decisionReceiptId))).data();
 if(receipt?.protocol!=='support_command_v1'||receipt.state!=='committed'||receipt.actorRole!=='admin'||receipt.ownerId!==s.ownerId||receipt.supportRequestId!==c.supportRequestId||
  receipt.actorId!==r.recordedBy||r.decisionReceiptId!==supportHash([receipt.actorId,receipt.requestId])||receipt.command?.action!=='record_account_review'||
  receipt.payloadHash!==supportHash(receipt.command)||receipt.command.accountReview?.subjectUid!==c.ownerId||receipt.command.accountReview?.finding!=='representation_authority_confirmed'||
  receipt.command.accountReview?.identityDocumentsReviewed!==true||receipt.command.accountReview?.authorityDocumentsReviewed!==true||
  supportHash(receipt.command.accountReview?.obligations)!==supportHash(r.obligations)||supportHash(receipt.command.accountReview?.evidenceReads)!==supportHash(r.evidenceReads))return null;
 return {kind:'human_qualified_representation',ownerId:c.ownerId,representativeUid:r.representativeUid,supportRequestId:c.supportRequestId,
  decisionReceiptId:r.decisionReceiptId,sourceHash:supportSourceHash(s),walletRevision:obligation.sourceRevision,evidenceReads:r.evidenceReads};
}
export async function readExceptionalPostClosureBasis(tx:FirebaseFirestore.Transaction,uid:string,closure:Data|undefined){
 if(closure?.schemaVersion!==1||closure.ownerId!==uid||!exceptionalNative(closure.requestedAt)||closure.phase!=='purging'||closure.status!=='incomplete'||closure.requiresOperator!==true||closure.leaseUntilMs!==0||!exceptionalNative(closure.authDeletedAt)||
  typeof closure.attemptId!=='string'||!closure.attemptId)return null;
 try{await auth.getUser(uid);return null;}catch(error){if((error as {code?:unknown})?.code!=='auth/user-not-found')return null;}
 const after=(a:Timestamp,b:Timestamp)=>a.seconds>b.seconds||a.seconds===b.seconds&&a.nanoseconds>=b.nanoseconds;
 const e=closure.lateFinancialEvent;if(!e||!exceptionalNative(e.recordedAt)||!after(e.recordedAt,closure.requestedAt)||!after(closure.authDeletedAt,closure.requestedAt))return null;
 if(e.source==='stripe_bank_dispute'&&typeof e.transactionId==='string'&&typeof e.disputeId==='string'){
  const order=(await tx.get(db.collection('transactions').doc(e.transactionId))).data(),bank=order?.bankDispute;
  if(!order||order.buyerId!==uid||bank?.id!==e.disputeId||bank.state!=='closed'||bank.outcome!=='lost'||bank.reconciliationRequired===true||!exceptionalNative(bank.closedAt)||!exceptionalNative(bank.ledgerReconciledAt))return null;
  const rows=await tx.get(db.collection('wallets').doc(uid).collection('ledger').where('transactionId','==',e.transactionId).limit(101)),credits=rows.docs.filter(d=>d.data().type==='refund_credit'&&d.data().disputeId===e.disputeId);
  if(rows.size>=101||credits.length!==1||!exceptionalCents(credits[0].data().amount)||credits[0].data().amount<1||!exceptionalNative(credits[0].data().createdAt)||!credits[0].data().createdAt.isEqual(bank.ledgerReconciledAt))return null;
  return {protocol:'exceptional_post_closure_servicing_v1',qualified:true,authState:'native_user_absent',ownerId:uid,lateEvent:e,orderHash:supportSourceHash(order),creditHash:supportSourceHash(credits[0].data())};
 }
 if(e.source==='seconde_compensation'&&typeof e.caseId==='string'&&/^exception_[a-f0-9]{64}$/.test(e.caseId)){
  const proof=await (await import('./exceptionalRestitution')).readExceptionalNativeAccounting(tx,e.caseId);
  if(!proof.qualified||proof.blockers.length||proof.case?.ownerId!==uid||proof.case?.funding!=='seconde_wallet_compensation'||proof.case.state!=='operator_attested')return null;
  return {protocol:'exceptional_post_closure_servicing_v1',qualified:true,authState:'native_user_absent',ownerId:uid,lateEvent:e,creditHash:supportSourceHash(proof.case.nativeWalletCredit)};
 }
 return null;
}
async function postClosureServicing(tx:FirebaseFirestore.Transaction,uid:string,closure:Data,authority:Data|null){
 return authority?.kind==='human_qualified_representation'?readExceptionalPostClosureBasis(tx,uid,closure):null;
}
export const exceptionalWalletConsumptionSlot=(corpus:Data)=>supportHash(['wallet_consumption_successor_v1',corpus.ownerId,corpus.closureRequestedAt,corpus.predecessorInstructionId??null]);
const consumptionPath=(key:string)=>recoveryInstallation().prefix+'/permits/manual-refunds/exceptional/'+key+'.json';
async function priorWalletConsumption(tx:FirebaseFirestore.Transaction,ownerId:string,wallet:Data,closure:Data,rows:FirebaseFirestore.QueryDocumentSnapshot[]){
 const marker=wallet.exceptionalRestitution;if(marker==null){const legacy=await readFinancialRecoveryIdentityClaim(consumptionPath(supportHash(['wallet_restitution',ownerId,closure.requestedAt.seconds,closure.requestedAt.nanoseconds])));
  return legacy?{reason:'wallet_legacy_consumption_native_history_missing',predecessor:null}:{reason:null,predecessor:null};}
 if(marker.protocol!=='exceptional_financial_restitution_v1'||marker.ownerId!==ownerId||!['operator_attested','voided'].includes(marker.state)||!/^exception_[a-f0-9]{64}$/.test(marker.caseId??''))return {reason:'wallet_prior_consumption_native_history_unknown',predecessor:null};
 const old=await (await import('./exceptionalRestitution')).readExceptionalNativeAccounting(tx,marker.caseId),r=old.case;
 if(!old.qualified||old.blockers.length||!r||r.context?.kind!=='wallet_restitution'||r.ownerId!==ownerId||r.instructionId!==marker.instructionId||r.state!==marker.state||!old.reserve||!exceptionalNative(r.preparedAt)||
  !exceptionalNative(r.sourceCapture?.facts?.closure?.requestedAt)||!r.sourceCapture.facts.closure.requestedAt.isEqual(closure.requestedAt))return {reason:'wallet_prior_consumption_native_history_unknown',predecessor:null};
 const claim=await readFinancialRecoveryIdentityClaim(consumptionPath(r.nativeObligationKey)),v=claim?.value,i=recoveryInstallation();
 if(claim?.temporaryHold!==true||v?.protocol!=='exceptional_restitution_lifetime_claim_v1'||v.obligationKey!==r.nativeObligationKey||v.caseId!==r.caseId||v.instructionId!==r.instructionId||v.inputHash!==r.instructionHash||v.ownerId!==ownerId||v.installationId!==i.installationId||v.firestoreProjectId!==i.firestoreProjectId||v.firestoreDatabaseId!==i.firestoreDatabaseId||v.financialEnvironment!==i.financialEnvironment||v.stripePlatformAccountId!==i.stripePlatformAccountId)return {reason:'wallet_prior_consumption_external_history_unknown',predecessor:null};
 const after=(a:Timestamp,b:Timestamp)=>a.seconds>b.seconds||a.seconds===b.seconds&&a.nanoseconds>b.nanoseconds,
  boundary=r.state==='voided'?r.voidedAt:r.preparedAt;let available=r.state==='voided'?old.returned?.balanceAfter:0;
 if(!exceptionalNative(boundary)||!exceptionalCents(available))return {reason:'wallet_prior_consumption_boundary_unknown',predecessor:null};
 const later=rows.filter(x=>exceptionalNative(x.data().createdAt)&&after(x.data().createdAt,boundary)&&!['exceptional_restitution_reserve','exceptional_restitution_void'].includes(x.data().type)).sort((a,b)=>a.data().createdAt.seconds-b.data().createdAt.seconds||a.data().createdAt.nanoseconds-b.data().createdAt.nanoseconds||a.id.localeCompare(b.id));
 for(const entry of later){const d=entry.data();if(['sale_credit','funds_held','debt_repayment'].includes(d.type))continue;let credit:number|null=null;
  if(d.type==='refund_credit'&&typeof d.transactionId==='string'){
   const order=(await tx.get(db.collection('transactions').doc(d.transactionId))).data();if(order?.buyerId===ownerId){
    if(typeof d.disputeId==='string'&&order.bankDispute?.id===d.disputeId&&order.bankDispute.state==='closed'&&order.bankDispute.outcome==='lost'&&order.bankDispute.reconciliationRequired!==true&&exceptionalNative(order.bankDispute.ledgerReconciledAt)&&order.bankDispute.ledgerReconciledAt.isEqual(d.createdAt))credit=d.amount;
    else if(typeof d.refundIntentId==='string'){const intent=order.refund?.intentId===d.refundIntentId?order.refund:await readAllocationHistoryIntent(tx,d.transactionId,order,d.refundIntentId),allocation=(await tx.get(refundAllocationRef(d.transactionId,d.refundIntentId))).data();
     if(intent&&allocation&&entry.id==='refund_credit_'+d.refundIntentId&&allocation.terms?.walletCents===d.amount&&exceptionalNative(allocation.settlement?.appliedAt)&&allocation.settlement.appliedAt.isEqual(d.createdAt)&&await allocationLocalMovementsVerified(tx,d.transactionId,order,intent,allocation))credit=d.amount;}
   }
  }else if(d.type==='exceptional_compensation_credit'&&typeof d.caseId==='string'){const p=await (await import('./exceptionalRestitution')).readExceptionalNativeAccounting(tx,d.caseId);
   if(p.qualified&&!p.blockers.length&&p.case?.ownerId===ownerId&&p.compensation&&eq(p.compensation,d))credit=d.balanceCreditCents;
  }else if(d.type==='withdrawal_failed'&&typeof d.withdrawalRequestId==='string'){const withdrawal=(await tx.get(db.collection('withdrawal_requests').doc(d.withdrawalRequestId))).data(),proof=withdrawal?await readWithdrawalLocalEvidence(tx,d.withdrawalRequestId,withdrawal):null;
   if(withdrawal?.userId===ownerId&&withdrawal.payoutRecovery?.state==='recovered'&&withdrawal.payoutRecovery.compensationLedgerId===entry.id&&exceptionalNative(withdrawal.payoutRecovery.compensatedAt)&&withdrawal.payoutRecovery.compensatedAt.isEqual(d.createdAt)&&proof?.existingCreditId===entry.id&&eq(proof.existingCredit,d))credit=d.amount;
  }else if(d.type==='funds_released'&&typeof d.transactionId==='string'){const order=(await tx.get(db.collection('transactions').doc(d.transactionId))).data(),debt=rows.filter(x=>x.data().type==='debt_repayment'&&x.data().transactionId===d.transactionId&&exceptionalNative(x.data().createdAt)&&x.data().createdAt.isEqual(d.createdAt));
   if(order?.sellerId===ownerId&&order.sellerReleasedCents===d.amount&&exceptionalNative(order.fundsReleasedAt)&&order.fundsReleasedAt.isEqual(d.createdAt)&&debt.length<=1&&exceptionalCents(debt[0]?.data().amount??0)&&(debt[0]?.data().amount??0)<=d.amount)credit=d.amount-(debt[0]?.data().amount??0);
  }
  if(!exceptionalCents(credit)||!exceptionalCents(available+credit!)||d.balanceAfter!==available+credit!)return {reason:'wallet_new_available_credits_unqualified',predecessor:null};available+=credit!;
 }
 return available===wallet.balance?{reason:null,predecessor:r.instructionId}:{reason:'wallet_available_corpus_overlaps_prior_consumption',predecessor:null};
}
export async function readExceptionalSource(tx:FirebaseFirestore.Transaction,c:ExceptionalContext,provider:Data|null,previous?:Data){
 const refs:string[]=[],facts:Data={context:c},revisions:any[]=[];let ownerId:string|null=null,maximumCents:number|null=null,reason:string|null=null,funding:string|null=null,warning:string|null=null;
 let wallet:Data|undefined,walletSnapshot:FirebaseFirestore.DocumentSnapshot|undefined,authority:Data|null=null,target:FirebaseFirestore.DocumentReference|undefined,nativeObligationKey:string|null=null;
 const take=async(r:FirebaseFirestore.DocumentReference)=>{const s=await tx.get(r);refs.push(r.path);revisions.push([r.path,supportRevision(s)]);return s.data();};
 if(c.kind==='withdrawal_misdirection'){
  target=db.collection('withdrawal_requests').doc(c.withdrawalRequestId);const w=await take(target);facts.withdrawal=w??null;
  if(!w||!exceptionalCents(w.amount)||w.amount<1||w.currency!=='cad'||typeof w.userId!=='string'||!w.withdrawalIntent||!w.payoutDestination)reason='withdrawal_native_source_unknown';
  else{
   ownerId=w.userId;const local=await readWithdrawalLocalEvidence(tx,c.withdrawalRequestId,w);
   facts.local=local?{debitId:local.debitId,existingCreditId:local.existingCreditId,originalIntentHash:w.withdrawalIntent.payloadHash}:null;
   if(!local||local.existingCreditId||w.payoutRecovery!=null&&!(previous&&w.exceptionalRestitution?.instructionId===previous.instructionId))reason='withdrawal_compensation_or_recovery_requires_reconciliation';
   else{maximumCents=w.amount;funding='seconde_compensation';nativeObligationKey=supportHash(['withdrawal_misdirection',c.withdrawalRequestId,w.withdrawalIntent.payloadHash]);}
   if(provider?.qualification!=='paid_native_misdirection_review'||provider.withdrawalSourceHash!==supportSourceHash(w))reason=reason??'current_paid_payout_required';
   facts.provider=provider??null;
  }
 }else if(c.kind==='wallet_restitution'){
  ownerId=c.ownerId;target=db.collection('wallets').doc(c.ownerId);wallet=await take(target);facts.wallet=wallet??null;
  const profile=await take(db.collection('eligibility_profiles').doc(c.ownerId)),closure=profile?.accountClosure;facts.closure=closure??null;
  authority=wallet?await walletAuthority(tx,c,wallet,previous):null;facts.authority=authority;
  const paused=closure?.phase==='paused'&&closure.authDeletedAt==null&&closure.providerDeletionStartedAt==null,
   postClosure=!paused&&closure?await postClosureServicing(tx,c.ownerId,closure,authority):null;facts.postClosure=postClosure;
  if(!wallet||Object.prototype.hasOwnProperty.call(wallet,'userId')&&wallet.userId!==c.ownerId||!['active','inactive'].includes(wallet.status)||typeof wallet.currency!=='string'||wallet.currency.toUpperCase()!=='CAD'||
   !['balance','pendingBalance','heldBalance','sellerDebt'].every(k=>exceptionalCents(wallet![k]))||wallet.pendingBalance!==0||wallet.heldBalance!==0||wallet.sellerDebt!==0||
   closure?.schemaVersion!==1||closure.ownerId!==c.ownerId||!exceptionalNative(closure.requestedAt)||!paused&&!postClosure)
   reason='wallet_closure_or_buckets_unknown';
  else{
   if(!authority)reason='native_owner_or_representation_authority_required';
   const review=await readWalletFinancialReview(tx,c.ownerId,'withdrawal',wallet,undefined,previous?.caseId);facts.review={...review,observedAt:null};
   if(review.reasons.some(r=>r!=='wallet_inactive'&&!(postClosure&&['account_unavailable','account_closing'].includes(r))))reason=reason??'wallet_obligations_require_review';
   const reserve=previous?.reservation;
   if(reserve){const debit=await take(target.collection('ledger').doc(reserve.ledgerId));facts.reservationDebit=debit??null;
    if(reserve.ownerId!==c.ownerId||debit?.type!=='exceptional_restitution_reserve'||debit.instructionId!==previous.instructionId||debit.amount!==reserve.amountCents||
     debit.caseId!==exceptionalCaseId(c)||wallet.exceptionalRestitution?.instructionId!==previous.instructionId)reason='wallet_reservation_source_unknown';
    else maximumCents=reserve.amountCents;
   }else maximumCents=wallet.balance;
   if(!maximumCents)reason=reason??'wallet_no_available_funds';
   funding='existing_wallet';
   // An account closure can receive more than one legitimate late credit.
   // Identify the actual funds, never the support ticket or closure alone.
   // Reserve/void ledgers only move that same corpus and are excluded.
   if(previous){
    nativeObligationKey=previous.nativeObligationKey;
    const corpus=previous.sourceCapture?.facts?.walletFundsCorpus;
    if(corpus!=null){facts.walletFundsCorpus=corpus;
     if(corpus.protocol!=='exceptional_wallet_funds_corpus_v1'||corpus.ownerId!==c.ownerId||corpus.availableCents!==reserve?.amountCents||
      nativeObligationKey!==supportHash(['wallet_restitution_funds_v1',corpus]))reason='wallet_funds_corpus_unknown';}
   }else{
    const rows=await tx.get(target.collection('ledger').orderBy('__name__').limit(1001)),economic=rows.docs.filter(d=>!['exceptional_restitution_reserve','exceptional_restitution_void'].includes(d.data().type));
    if(rows.size>=1001||!economic.length||economic.some(d=>typeof d.data().type!=='string'||!exceptionalCents(d.data().amount)||!exceptionalNative(d.data().createdAt)))reason=reason??'wallet_funds_corpus_unknown';
    else{const chain=await priorWalletConsumption(tx,c.ownerId,wallet,closure,rows.docs);if(chain.reason)reason=reason??chain.reason;
     const corpus={protocol:'exceptional_wallet_funds_corpus_v1',ownerId:c.ownerId,availableCents:wallet.balance,
      closureRequestedAt:{seconds:closure.requestedAt.seconds,nanoseconds:closure.requestedAt.nanoseconds},predecessorInstructionId:chain.predecessor,ledgerCount:economic.length,
      ledgerDigest:supportHash(economic.map(d=>[d.id,supportSourceHash(d.data())]))};facts.walletFundsCorpus=corpus;nativeObligationKey=supportHash(['wallet_restitution_funds_v1',corpus]);
     const slot=await readFinancialRecoveryIdentityClaim(consumptionPath(exceptionalWalletConsumptionSlot(corpus))),v=slot?.value,i=recoveryInstallation();
     if(slot&&(slot.temporaryHold!==true||v?.protocol!=='exceptional_wallet_consumption_successor_v1'||v.ownerId!==c.ownerId||v.fundsCorpusHash!==supportHash(corpus)||v.obligationKey!==nativeObligationKey||v.slotKey!==exceptionalWalletConsumptionSlot(corpus)||v.installationId!==i.installationId||v.firestoreProjectId!==i.firestoreProjectId||v.firestoreDatabaseId!==i.firestoreDatabaseId||v.financialEnvironment!==i.financialEnvironment||v.stripePlatformAccountId!==i.stripePlatformAccountId))reason=reason??'wallet_consumption_successor_already_reserved';
    }
   }
  }
 }else{
  target=db.collection('transactions').doc(c.transactionId);const order=await take(target);facts.order=order??null;
  const i=order?.refund?.intentId===c.refundIntentId?order.refund:order?await readAllocationHistoryIntent(tx,c.transactionId,order,c.refundIntentId):null;
  facts.intent=i??null;const allocation=order&&i?await take(refundAllocationRef(c.transactionId,c.refundIntentId)):null;facts.allocation=allocation??null;
  if(!order||!i||!allocation||i.currency!=='cad'||!await allocationLocalMovementsVerified(tx,c.transactionId,order,i,allocation)||hasActiveBankDispute(order))reason='refund_native_obligation_or_local_effects_unknown';
  else if(c.harm==='buyer_shortfall'){
   ownerId=order.buyerId;
   // Unallocated purchase components are NOT proof of an additional refund
   // owed. Only this already committed native card obligation has an existing
   // repair rail; a disputed extra entitlement requires its own native decision.
   if(exceptionalCents(i.outstandingCardCents)&&i.outstandingCardCents>0&&exceptionalCents(i.cardConfirmedCents)&&exceptionalCents(i.cardAmountCents)&&
    i.outstandingCardCents+i.cardConfirmedCents===i.cardAmountCents){maximumCents=i.outstandingCardCents;funding='original_refund_allocation';reason='use_original_refund_card_repair';}
   else reason='refund_shortfall_native_obligation_not_established';
  }else{
   ownerId=['seller_undue_debit','seller_debt_compensation'].includes(c.harm)?order.sellerId:order.buyerId;funding='seconde_compensation';
   if(['seller_undue_debit','seller_debt_compensation'].includes(c.harm)){
    const debit=await take(db.collection('wallets').doc(ownerId!).collection('ledger').doc('refund_debit_'+i.intentId));facts.originalDebit=debit??null;
    if(debit?.type!=='refund_debit'||debit.transactionId!==c.transactionId||debit.refundIntentId!==i.intentId||!exceptionalCents(debit.amount)||!exceptionalCents(debit.debtRecorded)||
     debit.amount+debit.debtRecorded!==i.sellerDebitCents||!exceptionalNative(debit.createdAt))reason='seller_original_debit_unknown';
    else if(c.harm==='seller_debt_compensation'){
     funding='seconde_wallet_compensation';maximumCents=debit.debtRecorded;
     walletSnapshot=await tx.get(db.collection('wallets').doc(ownerId!));refs.push(walletSnapshot.ref.path);revisions.push([walletSnapshot.ref.path,supportRevision(walletSnapshot)]);wallet=walletSnapshot.data();facts.wallet=wallet??null;
     if(wallet&&(Object.prototype.hasOwnProperty.call(wallet,'userId')&&wallet.userId!==ownerId||!['active','inactive'].includes(wallet.status)||typeof wallet.currency!=='string'||wallet.currency.toUpperCase()!=='CAD'||
      !['balance','pendingBalance','heldBalance','sellerDebt'].every(k=>exceptionalCents(wallet![k]))))reason='seller_compensation_wallet_unknown';
     const cashContext:ExceptionalContext={kind:'refund_error',transactionId:c.transactionId,refundIntentId:c.refundIntentId,harm:'seller_undue_debit'},cash=(await tx.get(exceptionalCaseRef(cashContext))).data();
     if(cash){const proof=await (await import('./exceptionalRestitution')).readExceptionalNativeAccounting(tx,exceptionalCaseId(cashContext));facts.previousCashHash=supportSourceHash(cash);
      if(!proof.qualified||proof.blockers.length)reason='prior_seller_cash_compensation_unknown';
      else if(cash.state==='prepared'&&cash.amountCents>debit.amount)reason='prior_seller_cash_debt_coverage_pending';
      else if(cash.state==='operator_attested')maximumCents=Math.max(0,maximumCents!-Math.max(0,cash.amountCents-debit.amount));
     }
     if(!maximumCents)reason=reason??'seller_debt_compensation_already_covered_or_absent';
     const profile=await take(db.collection('eligibility_profiles').doc(ownerId!));facts.ownerClosure=profile?.accountClosure??null;
    }else {
     // Paying cash does not cancel an uncollected seller debt. Never enlarge
     // this bank compensation by debtRecorded while leaving that debt live.
     maximumCents=debit.amount;
     if(debit.debtRecorded>0)warning='seller_debt_correction_not_included';
     if(debit.amount===0)reason='seller_debt_correction_requires_native_reconciliation';
    }
   }else{
    if(!exceptionalCents(i.cardAmountCents)||!exceptionalCents(i.walletAmountCents)||!await readSettledAllocationIntent(tx,c.transactionId,
     {...order,refundAllocationState:{...order.refundAllocationState,reviewRequired:false}},i))reason='buyer_original_restitution_not_settled';
    else maximumCents=i.cardAmountCents+i.walletAmountCents;
   }
   nativeObligationKey=supportHash(['refund_error',c.transactionId,i.intentId,i.attemptId,allocation.reservationHash,c.harm]);
  }
 }
 const sourceHash=supportSourceHash(facts),sourceRevision=supportHash(revisions);
 return {context:c,caseId:exceptionalCaseId(c),refs,facts,ownerId,beneficiaryId:ownerId,maximumCents,funding,reason,warning,sourceHash,sourceRevision,
  nativeObligationKey,wallet,walletSnapshot,authority,target};
}
